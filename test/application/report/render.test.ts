import { describe, expect, it } from "vitest";
import { renderChecklistJson, renderJson } from "../../../src/application/report/json.js";
import { renderChecklistMarkdown, renderMarkdown } from "../../../src/application/report/markdown.js";
import { renderChecklistTerminal, renderTerminal } from "../../../src/application/report/terminal.js";
import { MANUAL_ITEMS } from "../../../src/domain/manual.js";
import { REPORT_SCHEMA_VERSION, type AuditReport } from "../../../src/domain/report.js";
import { expectGolden } from "../../support/golden.js";
import { hostileString, prng } from "../../support/prng.js";
import { facts, unreadable } from "../../support/builders.js";
import { cleanReport, reportFor, troubledFacts } from "../../support/scenarios.js";

const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u202a-\u202e\u200b-\u200f\u2028\u2029\u2060-\u206f\ufeff]/;

describe("golden reports", () => {
  const troubled = reportFor(troubledFacts());

  it("terminal, with findings", () => expectGolden("troubled.txt", renderTerminal(troubled)));
  it("terminal, clean", () => expectGolden("clean.txt", renderTerminal(cleanReport())));
  it("markdown, with findings", () => expectGolden("troubled.md", renderMarkdown(troubled)));
  it("markdown, clean", () => expectGolden("clean.md", renderMarkdown(cleanReport())));
  it("json, with findings", () => expectGolden("troubled.json", renderJson(troubled)));
  it("checklist, terminal", () => expectGolden("checklist.txt", renderChecklistTerminal()));
  it("checklist, markdown", () => expectGolden("checklist.md", renderChecklistMarkdown()));
});

describe("json report", () => {
  it("is valid JSON with a schema version and no undefined holes", () => {
    const parsed = JSON.parse(renderJson(reportFor(troubledFacts()))) as AuditReport;
    expect(parsed.schemaVersion).toBe(REPORT_SCHEMA_VERSION);
    expect(Object.keys(parsed)).toEqual(["schemaVersion", "tool", "generatedAt", "account", "options", "summary", "findings", "checks", "skipped", "truncated", "ignoredObjects", "notReadable", "warnings", "requests", "exitCode"]);
    expect(parsed.findings.every((f) => typeof f.id === "string" && Array.isArray(f.evidence))).toBe(true);
  });

  it("lists the manual checklist", () => {
    const parsed = JSON.parse(renderChecklistJson()) as { schemaVersion: number; items: { id: string }[] };
    expect(parsed.items.map((i) => i.id)).toEqual(MANUAL_ITEMS.map((m) => m.id));
  });
});

describe("a report built from hostile text", () => {
  function hostile(rand: () => number): AuditReport {
    const base = reportFor(troubledFacts());
    const h = () => hostileString(rand, 80).replace(/`/g, "'");
    return {
      ...base,
      warnings: [h()],
      truncated: [h()],
      account: { ...base.account, id: h(), apiVersion: h() },
      findings: base.findings.map((f) => ({ ...f, title: h(), evidence: [h(), h()] })),
      skipped: [{ checkId: h(), reason: "permission", resource: h(), detail: h() }],
    };
  }

  it("never prints a control or bidi character on a terminal (property)", () => {
    const rand = prng(5);
    for (let i = 0; i < 100; i++) expect(renderTerminal(hostile(rand))).not.toMatch(CONTROL);
  });

  it("keeps hostile text inside code spans and fences in markdown (property)", () => {
    const rand = prng(6);
    for (let i = 0; i < 100; i++) {
      const md = renderMarkdown(hostile(rand));
      // outside fences and code spans there is no raw angle bracket, link or control character
      const outside = md.replace(/(`{3,})[\s\S]*?\1/g, "").replace(/(`+)[^`\n]*?\1/g, "");
      expect(outside).not.toMatch(CONTROL);
      expect(outside).not.toMatch(/<[a-zA-Z/!]/);
      expect(outside).not.toMatch(/\]\(/);
    }
  });
});

describe("checks the options switched off", () => {
  const off = reportFor(facts({ failedEvents: unreadable("disabled", "events", "not requested; pass --include-events") }));

  it("are listed apart from checks the key could not run", () => {
    expect(renderTerminal(off)).toContain("Checks not run (switched off by the options):\n  - webhook-deliveries-failing: not requested; pass --include-events");
    expect(renderTerminal(off)).not.toContain("Skipped checks");
    expect(renderMarkdown(off)).toContain("## Checks not run");
    expect(renderMarkdown(off)).not.toContain("## Checks that could not run");
  });
});

describe("report content", () => {
  it("says the audit is read-only and keeps personal data out", () => {
    const md = renderMarkdown(reportFor(troubledFacts()));
    expect(md).toContain("read-only GET requests");
    expect(md).not.toMatch(/@[a-z]+\.[a-z]+/);
  });

  it("hides the webhook secret and query of a URL in every format", () => {
    const r = reportFor(troubledFacts());
    for (const text of [renderTerminal(r), renderMarkdown(r), renderJson(r)]) {
      expect(text).not.toContain("whsec0123456789");
      expect(text).not.toContain("token=abc");
    }
  });
});
