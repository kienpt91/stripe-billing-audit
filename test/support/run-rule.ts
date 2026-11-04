import { evaluate } from "../../src/domain/engine.js";
import type { Finding, Rule, Thresholds } from "../../src/domain/rule.js";
import { facts, THRESHOLDS } from "./builders.js";

export interface RuleRun {
  readonly status: "passed" | "failed" | "not_applicable" | "skipped";
  readonly finding: Finding | undefined;
  readonly detail: string | null;
}

/** Runs one rule over facts that are healthy except for what the test overrides. */
export function run(rule: Rule, over: Parameters<typeof facts>[0] = {}, thresholds: Thresholds = THRESHOLDS): RuleRun {
  const result = evaluate(facts(over), thresholds, [rule]);
  const check = result.checks[0];
  if (!check) throw new Error("no check result");
  return { status: check.status, finding: result.findings[0], detail: check.detail };
}
