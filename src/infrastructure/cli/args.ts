import { parseArgs } from "node:util";
import { err, ok, type Result } from "../../domain/result.js";
import { SEVERITIES, isSeverity, type Severity } from "../../domain/severity.js";

export type Format = "terminal" | "json" | "markdown";

export interface AuditOptions {
  readonly format: Format;
  readonly failOn: Severity;
  readonly allowUnrestrictedKey: boolean;
  readonly apiBase: string | undefined;
  readonly pastDueDays: number;
  readonly trialDays: number;
  readonly staleInvoiceDays: number;
  readonly maxPages: number;
  readonly maxRequests: number;
  readonly timeoutMs: number;
  readonly skipCustomerLookup: boolean;
  readonly includeEvents: boolean;
  readonly allowPartialCoverage: boolean;
}

export type Command =
  | { readonly kind: "help" }
  | { readonly kind: "version" }
  | { readonly kind: "checklist"; readonly format: Format }
  | { readonly kind: "audit"; readonly options: AuditOptions };

const DEFAULTS = { failOn: "medium", pastDueDays: 7, trialDays: 7, staleInvoiceDays: 14, maxPages: 5, maxRequests: 150, timeoutMs: 15_000 } as const;

function integer(name: string, raw: string | undefined, fallback: number, min: number, max: number): Result<number> {
  if (raw === undefined) return ok(fallback);
  if (!/^\d{1,9}$/.test(raw)) return err(`--${name} must be a whole number between ${min} and ${max}.`);
  const n = Number(raw);
  return n >= min && n <= max ? ok(n) : err(`--${name} must be a whole number between ${min} and ${max}.`);
}

/** Parses the command line. Nothing is read from the environment here, and no secret is ever an argument. */
export function parseCommand(argv: readonly string[]): Result<Command> {
  let parsed;
  try {
    parsed = parseArgs({
      args: [...argv],
      allowPositionals: true,
      strict: true,
      options: {
        help: { type: "boolean", short: "h" },
        version: { type: "boolean", short: "v" },
        json: { type: "boolean" },
        markdown: { type: "boolean" },
        checklist: { type: "boolean" },
        "fail-on": { type: "string" },
        "allow-unrestricted-key": { type: "boolean" },
        "api-base": { type: "string" },
        "past-due-days": { type: "string" },
        "trial-days": { type: "string" },
        "stale-invoice-days": { type: "string" },
        "max-pages": { type: "string" },
        "max-requests": { type: "string" },
        "timeout-ms": { type: "string" },
        "skip-customer-lookup": { type: "boolean" },
        "include-events": { type: "boolean" },
        "allow-partial-coverage": { type: "boolean" },
      },
    });
  } catch (error) {
    return err(`${error instanceof Error ? error.message.split("\n")[0] : "invalid arguments"}`);
  }
  const v = parsed.values;
  if (parsed.positionals.length > 0) return err("Unexpected argument. The key is read from STRIPE_API_KEY, never from the command line.");
  if (v.help) return ok({ kind: "help" });
  if (v.version) return ok({ kind: "version" });
  if (v.json && v.markdown) return err("Choose one of --json and --markdown.");
  const format: Format = v.json ? "json" : v.markdown ? "markdown" : "terminal";
  if (v.checklist) return ok({ kind: "checklist", format });

  const failOn = v["fail-on"] ?? DEFAULTS.failOn;
  if (!isSeverity(failOn)) return err(`--fail-on must be one of ${SEVERITIES.join(", ")}.`);
  const pastDueDays = integer("past-due-days", v["past-due-days"], DEFAULTS.pastDueDays, 0, 3650);
  const trialDays = integer("trial-days", v["trial-days"], DEFAULTS.trialDays, 0, 365);
  const staleInvoiceDays = integer("stale-invoice-days", v["stale-invoice-days"], DEFAULTS.staleInvoiceDays, 0, 3650);
  const maxPages = integer("max-pages", v["max-pages"], DEFAULTS.maxPages, 1, 50);
  const maxRequests = integer("max-requests", v["max-requests"], DEFAULTS.maxRequests, 1, 2000);
  const timeoutMs = integer("timeout-ms", v["timeout-ms"], DEFAULTS.timeoutMs, 500, 120_000);
  for (const r of [pastDueDays, trialDays, staleInvoiceDays, maxPages, maxRequests, timeoutMs]) if (!r.ok) return r;
  const n = (r: Result<number>): number => (r.ok ? r.value : 0);

  return ok({
    kind: "audit",
    options: {
      format,
      failOn,
      allowUnrestrictedKey: v["allow-unrestricted-key"] === true,
      apiBase: v["api-base"],
      pastDueDays: n(pastDueDays),
      trialDays: n(trialDays),
      staleInvoiceDays: n(staleInvoiceDays),
      maxPages: n(maxPages),
      maxRequests: n(maxRequests),
      timeoutMs: n(timeoutMs),
      skipCustomerLookup: v["skip-customer-lookup"] === true,
      includeEvents: v["include-events"] === true,
      allowPartialCoverage: v["allow-partial-coverage"] === true,
    },
  });
}
