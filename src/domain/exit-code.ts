import type { Evaluation } from "./engine.js";
import { atLeast, type Severity } from "./severity.js";

export const EXIT_CLEAN = 0;
export const EXIT_FINDINGS = 1;
export const EXIT_USAGE = 2;
export const EXIT_API = 3;
export const EXIT_PERMISSION = 4;

/**
 * 3: a resource could not be read because of an API problem, so the audit is incomplete.
 * 4: checks were impossible with this key's permissions; they are listed as skipped.
 * 1: findings at or above `failOn`. 0: nothing to report.
 * A run that could not read something because of the API or the key's permissions never exits 0 or 1: the
 * first two outrank findings because a verdict on part of the account must not look like a verdict on all of
 * it. The report still lists every finding. Checks the user switched off (`disabled`) do not change the code.
 */
export function exitCodeFor(evaluation: Evaluation, failOn: Severity): number {
  if (evaluation.skipped.some((s) => s.reason === "api_error" || s.reason === "budget")) return EXIT_API;
  if (evaluation.skipped.some((s) => s.reason === "permission")) return EXIT_PERMISSION;
  return evaluation.findings.some((f) => atLeast(f.severity, failOn)) ? EXIT_FINDINGS : EXIT_CLEAN;
}
