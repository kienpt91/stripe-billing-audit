import type { CheckResult, Evaluation, SkippedCheck } from "./engine.js";
import type { Facts } from "./facts.js";
import type { Finding, Thresholds } from "./rule.js";
import { MANUAL_ITEMS, type ManualItem } from "./manual.js";
import { SEVERITIES, type Severity } from "./severity.js";
import { shortId } from "./stripe/identifiers.js";
import type { KeyKind, Mode } from "./stripe/key.js";
import { isoDateTime } from "./time.js";

/** Bumped when the JSON shape changes incompatibly. */
export const REPORT_SCHEMA_VERSION = 1;

export interface AuditReport {
  readonly schemaVersion: typeof REPORT_SCHEMA_VERSION;
  readonly tool: { readonly name: string; readonly version: string };
  readonly generatedAt: string;
  readonly account: {
    readonly id: string | null;
    readonly mode: Mode;
    readonly keyKind: KeyKind;
    readonly country: string | null;
    readonly defaultCurrency: string | null;
    readonly apiVersion: string | null;
  };
  readonly options: {
    readonly failOn: Severity;
    readonly thresholds: Thresholds;
    readonly customerLookup: boolean;
    readonly includeEvents: boolean;
  };
  readonly summary: {
    readonly findings: number;
    readonly bySeverity: Readonly<Record<Severity, number>>;
    readonly checks: Readonly<Record<CheckResult["status"], number>>;
  };
  readonly findings: readonly Finding[];
  readonly checks: readonly CheckResult[];
  readonly skipped: readonly SkippedCheck[];
  /** Resources listed only up to a cap: counts for them are lower bounds. */
  readonly truncated: readonly string[];
  /** Objects with an unexpected shape that were left out. */
  readonly ignoredObjects: number;
  readonly notReadable: ReadonlyArray<Pick<ManualItem, "id" | "area" | "title">>;
  readonly warnings: readonly string[];
  readonly requests: { readonly used: number };
  readonly exitCode: number;
}

export interface ReportInput {
  readonly tool: { readonly name: string; readonly version: string };
  readonly facts: Facts;
  readonly evaluation: Evaluation;
  readonly keyKind: KeyKind;
  readonly options: AuditReport["options"];
  readonly warnings: readonly string[];
  readonly requestsUsed: number;
  readonly exitCode: number;
}

export function buildReport(input: ReportInput): AuditReport {
  const { facts, evaluation } = input;
  const account = facts.account.status === "ok" ? facts.account.value : null;
  const bySeverity = Object.fromEntries(SEVERITIES.map((s) => [s, evaluation.findings.filter((f) => f.severity === s).length])) as Record<Severity, number>;
  const statuses: CheckResult["status"][] = ["passed", "failed", "not_applicable", "skipped"];
  const checks = Object.fromEntries(statuses.map((s) => [s, evaluation.checks.filter((c) => c.status === s).length])) as Record<CheckResult["status"], number>;
  return {
    schemaVersion: REPORT_SCHEMA_VERSION,
    tool: input.tool,
    generatedAt: isoDateTime(facts.nowSeconds),
    account: {
      id: account?.id != null ? shortId(account.id) : null,
      mode: facts.mode,
      keyKind: input.keyKind,
      country: account?.country ?? null,
      defaultCurrency: account?.defaultCurrency ?? null,
      apiVersion: account?.apiVersion ?? null,
    },
    options: input.options,
    summary: { findings: evaluation.findings.length, bySeverity, checks },
    findings: evaluation.findings,
    checks: evaluation.checks,
    skipped: evaluation.skipped,
    truncated: evaluation.truncated,
    ignoredObjects: evaluation.malformed,
    notReadable: MANUAL_ITEMS.filter((m) => m.inEveryReport).map(({ id, area, title }) => ({ id, area, title })),
    warnings: input.warnings,
    requests: { used: input.requestsUsed },
    exitCode: input.exitCode,
  };
}
