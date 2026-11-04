import { evaluate } from "../domain/engine.js";
import { exitCodeFor } from "../domain/exit-code.js";
import type { KeyKind, Mode } from "../domain/stripe/key.js";
import { buildReport, type AuditReport } from "../domain/report.js";
import type { Thresholds } from "../domain/rule.js";
import type { Severity } from "../domain/severity.js";
import { collectFacts, type CollectOptions } from "./collect.js";
import type { Clock, StripeReader } from "./ports.js";

export interface AuditRequest {
  readonly tool: { readonly name: string; readonly version: string };
  readonly mode: Mode;
  readonly keyKind: KeyKind;
  readonly failOn: Severity;
  readonly thresholds: Thresholds;
  readonly collect: CollectOptions;
  readonly warnings: readonly string[];
}

/**
 * The audit use case: read the facts, run the checks, build the report.
 * @throws AuthenticationError when Stripe rejects the key.
 */
export async function runAudit(api: StripeReader, clock: Clock, request: AuditRequest, requestsUsed: () => number): Promise<AuditReport> {
  const facts = await collectFacts(api, clock, request.mode, request.collect);
  const evaluation = evaluate(facts, request.thresholds);
  return buildReport({
    tool: request.tool,
    facts,
    evaluation,
    keyKind: request.keyKind,
    options: { failOn: request.failOn, thresholds: request.thresholds, customerLookup: request.collect.customerLookup, includeEvents: request.collect.includeEvents },
    warnings: request.warnings,
    requestsUsed: requestsUsed(),
    exitCode: exitCodeFor(evaluation, request.failOn),
  });
}
