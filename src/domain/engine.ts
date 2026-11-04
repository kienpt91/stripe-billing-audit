import { FACT_KEYS, FACT_LABELS, type FactKey, type Facts, type PartialCause, type UnreadableReason } from "./facts.js";
import { RULES } from "./rules/index.js";
import type { Category, Finding, Rule, RuleContext, RuleData, Thresholds } from "./rule.js";
import { severityRank } from "./severity.js";

/** `inconclusive`: the check found nothing, but only in a slice of the data (see `PartialFact`). */
export type CheckStatus = "passed" | "failed" | "not_applicable" | "skipped" | "inconclusive";

export interface CheckResult {
  readonly id: string;
  readonly category: Category;
  readonly summary: string;
  readonly status: CheckStatus;
  /** Why the check did not run, did not apply or could not conclude. */
  readonly detail: string | null;
}

/** A resource that was read only in part, and why. */
export interface PartialFact {
  readonly resource: string;
  readonly cause: PartialCause;
  readonly detail: string;
}

export interface SkippedCheck {
  readonly checkId: string;
  readonly reason: UnreadableReason;
  readonly resource: string;
  readonly detail: string;
}

export interface Evaluation {
  readonly findings: readonly Finding[];
  readonly checks: readonly CheckResult[];
  readonly skipped: readonly SkippedCheck[];
  /** Resources read only in part: a page cap, a lookup cap, or a failure part way through. */
  readonly partial: readonly PartialFact[];
  /** Objects that did not have the expected shape and were left out. */
  readonly malformed: number;
}

/**
 * Runs every rule over the facts. A rule whose required facts could not be read is skipped, with the reason,
 * instead of guessing. Findings are ordered worst first, then in rule order.
 */
export function evaluate(facts: Facts, thresholds: Thresholds, rules: readonly Rule[] = RULES): Evaluation {
  const partialKeys = new Set<FactKey>();
  const partial: PartialFact[] = [];
  let malformed = 0;
  for (const key of FACT_KEYS) {
    const fact = facts[key];
    if (fact.status === "ok") {
      if (fact.partial !== null) {
        partialKeys.add(key);
        partial.push({ resource: FACT_LABELS[key], cause: fact.partial.cause, detail: fact.partial.detail });
      }
      malformed += fact.malformed;
    }
  }
  const ctx: RuleContext = { mode: facts.mode, nowSeconds: facts.nowSeconds, thresholds, partial: partialKeys };
  const findings: Finding[] = [];
  const checks: CheckResult[] = [];
  const skipped: SkippedCheck[] = [];

  for (const rule of rules) {
    const blocked = rule.requires.map((k) => facts[k]).find((f) => f.status === "unreadable");
    if (blocked && blocked.status === "unreadable") {
      skipped.push({ checkId: rule.id, reason: blocked.reason, resource: blocked.resource, detail: blocked.detail });
      checks.push({ id: rule.id, category: rule.category, summary: rule.summary, status: "skipped", detail: `${blocked.resource}: ${blocked.detail}` });
      continue;
    }
    const data: Record<string, unknown> = {};
    for (const key of FACT_KEYS) {
      const fact = facts[key];
      if (fact.status === "ok") data[key] = fact.value;
    }
    const outcome = rule.evaluate(data as RuleData<FactKey>, ctx);
    if (outcome.status === "failed") {
      findings.push({ id: rule.id, category: rule.category, severity: outcome.severity, title: outcome.title, evidence: outcome.evidence, why: rule.why, fix: rule.fix });
      checks.push({ id: rule.id, category: rule.category, summary: rule.summary, status: "failed", detail: null });
      continue;
    }
    // Nothing found, or nothing to look at, in a slice of the data proves nothing about the rest.
    const slices = rule.requires.filter((k) => partialKeys.has(k) && !(outcome.status === "not_applicable" && outcome.independentOfData));
    if (slices.length > 0) {
      const detail = slices.map((k) => `${FACT_LABELS[k]}: ${partial.find((p) => p.resource === FACT_LABELS[k])?.detail ?? "partial"}`).join("; ");
      checks.push({ id: rule.id, category: rule.category, summary: rule.summary, status: "inconclusive", detail });
    } else if (outcome.status === "not_applicable") {
      checks.push({ id: rule.id, category: rule.category, summary: rule.summary, status: "not_applicable", detail: outcome.reason });
    } else {
      checks.push({ id: rule.id, category: rule.category, summary: rule.summary, status: "passed", detail: null });
    }
  }

  const order = new Map(rules.map((r, i) => [r.id, i]));
  findings.sort((a, b) => severityRank(b.severity) - severityRank(a.severity) || (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  return { findings, checks, skipped, partial, malformed };
}
