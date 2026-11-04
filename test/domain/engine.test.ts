import { describe, expect, it } from "vitest";
import { evaluate } from "../../src/domain/engine.js";
import { EXIT_API, EXIT_CLEAN, EXIT_FINDINGS, EXIT_PERMISSION, exitCodeFor } from "../../src/domain/exit-code.js";
import { buildReport, REPORT_SCHEMA_VERSION } from "../../src/domain/report.js";
import { defineRule, failed, notApplicable, passed } from "../../src/domain/rule.js";
import { RULES } from "../../src/domain/rules/index.js";
import { MANUAL_ITEMS } from "../../src/domain/manual.js";
import type { Severity } from "../../src/domain/severity.js";
import { account, facts, NOW, ok, THRESHOLDS, unreadable } from "../support/builders.js";

const base = { category: "account", why: "w", fix: "f" } as const;
const needsSubs = defineRule({ ...base, id: "needs-subs", summary: "s", requires: ["subscriptions"], evaluate: () => passed });
const bad = (id: string, severity: Severity) => defineRule({ ...base, id, summary: id, requires: [], evaluate: () => failed(severity, `${id} title`, ["e"]) });
const na = defineRule({ ...base, id: "na", summary: "s", requires: [], evaluate: () => notApplicable("because") });

describe("evaluate", () => {
  it("records passed, failed and not applicable checks and orders findings worst first", () => {
    const result = evaluate(facts(), THRESHOLDS, [bad("a-low", "low"), bad("b-crit", "critical"), na, needsSubs, bad("c-high", "high")]);
    expect(result.findings.map((f) => f.id)).toEqual(["b-crit", "c-high", "a-low"]);
    expect(result.checks.map((c) => [c.id, c.status])).toEqual([
      ["a-low", "failed"],
      ["b-crit", "failed"],
      ["na", "not_applicable"],
      ["needs-subs", "passed"],
      ["c-high", "failed"],
    ]);
    expect(result.findings[0]).toMatchObject({ title: "b-crit title", why: "w", fix: "f", evidence: ["e"] });
  });

  it("skips a rule whose required fact cannot be read instead of guessing", () => {
    const result = evaluate(facts({ subscriptions: unreadable("permission", "subscriptions", "HTTP 403") }), THRESHOLDS, [needsSubs]);
    expect(result.checks[0]).toMatchObject({ status: "skipped", detail: "subscriptions: HTTP 403" });
    expect(result.skipped).toEqual([{ checkId: "needs-subs", reason: "permission", resource: "subscriptions", detail: "HTTP 403" }]);
  });

  it("collects truncation and malformed counts from readable facts only", () => {
    const result = evaluate(facts({ subscriptions: ok([], { truncated: true, malformed: 2 }), prices: ok([], { malformed: 1 }), products: unreadable("api_error") }), THRESHOLDS, []);
    expect(result.truncated).toEqual(["subscriptions"]);
    expect(result.malformed).toBe(3);
  });
});

describe("exitCodeFor", () => {
  const withSkips = (reason: "permission" | "api_error" | "budget" | "disabled" | "not_available") =>
    evaluate(facts({ subscriptions: unreadable(reason) }), THRESHOLDS, [needsSubs, bad("x", "critical")]);

  it("is 0 when nothing reaches the threshold and 1 when something does", () => {
    const result = evaluate(facts(), THRESHOLDS, [bad("x", "medium")]);
    expect(exitCodeFor(result, "high")).toBe(EXIT_CLEAN);
    expect(exitCodeFor(result, "medium")).toBe(EXIT_FINDINGS);
    expect(exitCodeFor(result, "info")).toBe(EXIT_FINDINGS);
    expect(exitCodeFor(evaluate(facts(), THRESHOLDS, [passedRule()]), "info")).toBe(EXIT_CLEAN);
  });

  it("ranks API problems over missing permissions over findings", () => {
    expect(exitCodeFor(withSkips("permission"), "high")).toBe(EXIT_PERMISSION);
    expect(exitCodeFor(withSkips("api_error"), "high")).toBe(EXIT_API);
    expect(exitCodeFor(withSkips("budget"), "high")).toBe(EXIT_API);
  });

  it("does not count checks the user switched off or that the account cannot have", () => {
    expect(exitCodeFor(withSkips("disabled"), "high")).toBe(EXIT_FINDINGS);
    expect(exitCodeFor(withSkips("not_available"), "high")).toBe(EXIT_FINDINGS);
  });
});

function passedRule() {
  return defineRule({ ...base, id: "p", summary: "p", requires: [], evaluate: () => passed });
}

describe("buildReport", () => {
  const evaluation = evaluate(facts({ subscriptions: unreadable("permission") }), THRESHOLDS, [needsSubs, bad("x", "high")]);
  const report = buildReport({
    tool: { name: "stripe-billing-audit", version: "1.2.3" },
    facts: facts({ account: ok(account({ id: "acct_1AbCdEfGhIjKlMnOp" })) }),
    evaluation,
    keyKind: "restricted",
    options: { failOn: "high", thresholds: THRESHOLDS, customerLookup: true, includeEvents: false },
    warnings: ["w"],
    requestsUsed: 12,
    exitCode: 4,
  });

  it("carries a schema version, a shortened account id and the run time", () => {
    expect(report.schemaVersion).toBe(REPORT_SCHEMA_VERSION);
    expect(report.account).toMatchObject({ id: "acct_1AbCdE…", mode: "live", keyKind: "restricted" });
    expect(report.generatedAt).toBe("2026-10-26T07:33:20Z");
    expect(report.requests).toEqual({ used: 12 });
  });

  it("summarises findings and checks", () => {
    expect(report.summary.findings).toBe(1);
    expect(report.summary.bySeverity).toEqual({ critical: 0, high: 1, medium: 0, low: 0, info: 0 });
    expect(report.summary.checks).toEqual({ passed: 0, failed: 1, not_applicable: 0, skipped: 1 });
    expect(report.notReadable.map((n) => n.id)).toEqual(MANUAL_ITEMS.filter((m) => m.inEveryReport).map((m) => m.id));
  });

  it("copes with an unreadable account", () => {
    const r = buildReport({
      tool: { name: "t", version: "0" },
      facts: facts({ account: unreadable("api_error") }),
      evaluation,
      keyKind: "secret",
      options: { failOn: "low", thresholds: THRESHOLDS, customerLookup: false, includeEvents: true },
      warnings: [],
      requestsUsed: 0,
      exitCode: 3,
    });
    expect(r.account.id).toBeNull();
    expect(r.account.apiVersion).toBeNull();
  });
});

describe("rule catalogue", () => {
  it("has unique, kebab-case ids and complete text", () => {
    const ids = RULES.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const r of RULES) {
      expect(r.id).toMatch(/^[a-z]+(-[a-z0-9]+)+$/);
      expect(r.summary.length).toBeGreaterThan(10);
      expect(r.why.length).toBeGreaterThan(40);
      expect(r.fix.length).toBeGreaterThan(40);
    }
  });

  it("passes on the healthy fixture and nothing is skipped", () => {
    const result = evaluate(facts({ failedEvents: ok([]) }), THRESHOLDS);
    expect(result.findings).toEqual([]);
    expect(result.skipped).toEqual([]);
    expect(NOW).toBeGreaterThan(0);
  });
});
