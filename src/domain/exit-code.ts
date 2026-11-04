import type { Evaluation } from "./engine.js";
import { atLeast, type Severity } from "./severity.js";

export const EXIT_CLEAN = 0;
export const EXIT_FINDINGS = 1;
export const EXIT_USAGE = 2;
export const EXIT_API = 3;
export const EXIT_PERMISSION = 4;
export const EXIT_PARTIAL = 5;

/**
 * Precedence, worst first. Anything that means the audit did not see everything outranks the findings, so
 * that a verdict on part of the account never looks like a verdict on all of it. The report still lists every
 * finding.
 *
 * 3: a resource could not be read, or was read only in part, because of an API error or the request budget.
 * 4: a resource was not available to this key (missing permission, HTTP 403) or this account (HTTP 404), so
 *    the checks that need it did not run.
 * 5: a listing or lookup stopped at a cap and checks found nothing in the part that was examined
 *    (`inconclusive`). `allowPartialCoverage` accepts this one case.
 * 1: findings at or above `failOn`.
 * 0: otherwise.
 *
 * Checks the user switched off (`disabled`) never change the code.
 */
export function exitCodeFor(evaluation: Evaluation, failOn: Severity, allowPartialCoverage = false): number {
  if (evaluation.skipped.some((s) => s.reason === "api_error" || s.reason === "budget")) return EXIT_API;
  if (evaluation.partial.some((p) => p.cause === "api_error" || p.cause === "budget")) return EXIT_API;
  if (evaluation.skipped.some((s) => s.reason === "permission" || s.reason === "not_available")) return EXIT_PERMISSION;
  if (!allowPartialCoverage && evaluation.checks.some((c) => c.status === "inconclusive")) return EXIT_PARTIAL;
  return evaluation.findings.some((f) => atLeast(f.severity, failOn)) ? EXIT_FINDINGS : EXIT_CLEAN;
}
