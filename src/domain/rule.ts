import type { FactKey, FactValues } from "./facts.js";
import type { Severity } from "./severity.js";
import type { Mode } from "./stripe/key.js";

export type Category = "webhooks" | "subscriptions" | "invoices" | "customers" | "portal" | "tax" | "account";

export interface Thresholds {
  /** A subscription past due (or unpaid, or incomplete) for at least this many days is reported. */
  readonly pastDueDays: number;
  /** A trial that ends within this many days is checked for a payment method. */
  readonly trialDays: number;
  /** An invoice open for at least this many days is reported. */
  readonly staleInvoiceDays: number;
}

export interface RuleContext {
  readonly mode: Mode;
  readonly nowSeconds: number;
  readonly thresholds: Thresholds;
  /** Facts whose listing stopped at a cap: counts are lower bounds. */
  readonly truncated: ReadonlySet<FactKey>;
}

export interface Finding {
  readonly id: string;
  readonly category: Category;
  readonly severity: Severity;
  readonly title: string;
  /** What was observed, one line per observation. Never contains personal data or secrets. */
  readonly evidence: readonly string[];
  readonly why: string;
  readonly fix: string;
}

export type Outcome =
  | { readonly status: "passed" }
  | { readonly status: "not_applicable"; readonly reason: string }
  | { readonly status: "failed"; readonly severity: Severity; readonly title: string; readonly evidence: readonly string[] };

/** Facts a rule asked for are present; the others may be missing. */
export type RuleData<K extends FactKey> = Pick<FactValues, K> & Partial<Omit<FactValues, K>>;

export interface Rule {
  readonly id: string;
  readonly category: Category;
  /** One line, shown in the check list of the report. */
  readonly summary: string;
  /** The severities this rule can report, for the documentation (docs/checks.md). */
  readonly severity: string;
  readonly requires: readonly FactKey[];
  readonly why: string;
  readonly fix: string;
  readonly evaluate: (data: RuleData<FactKey>, ctx: RuleContext) => Outcome;
}

export interface RuleSpec<K extends FactKey> {
  readonly id: string;
  readonly category: Category;
  readonly summary: string;
  readonly severity: string;
  readonly requires: readonly K[];
  readonly why: string;
  readonly fix: string;
  readonly evaluate: (data: RuleData<K>, ctx: RuleContext) => Outcome;
}

/** Keeps `evaluate` typed to the facts the rule declared, and stores it in the uniform `Rule` shape. */
export function defineRule<K extends FactKey>(spec: RuleSpec<K>): Rule {
  return spec as unknown as Rule;
}

export const passed: Outcome = { status: "passed" };

export function notApplicable(reason: string): Outcome {
  return { status: "not_applicable", reason };
}

export function failed(severity: Severity, title: string, evidence: readonly string[]): Outcome {
  return { status: "failed", severity, title, evidence };
}
