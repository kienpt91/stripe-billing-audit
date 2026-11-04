import { runAudit } from "../application/audit.js";
import { AuthenticationError, type Clock } from "../application/ports.js";
import { renderChecklistJson, renderJson } from "../application/report/json.js";
import { renderChecklistMarkdown, renderMarkdown } from "../application/report/markdown.js";
import { renderChecklistTerminal, renderTerminal } from "../application/report/terminal.js";
import { RequestBudget } from "../domain/budget.js";
import { EXIT_API, EXIT_CLEAN, EXIT_USAGE } from "../domain/exit-code.js";
import { parseApiBase } from "../domain/stripe/api-base.js";
import { classifyKey } from "../domain/stripe/key.js";
import { containsSecret, redactSecrets } from "../domain/stripe/redact.js";
import { clip } from "../domain/text/text.js";
import { parseCommand, type AuditOptions, type Format } from "../infrastructure/cli/args.js";
import { HELP } from "../infrastructure/cli/help.js";
import { HttpStripeReader } from "../infrastructure/stripe/http-reader.js";
import { TOOL_NAME, VERSION } from "./version.js";

export interface Io {
  out(text: string): void;
  err(text: string): void;
}

export interface Deps {
  readonly fetch?: typeof fetch;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly clock?: Clock;
}

const systemClock: Clock = { nowSeconds: () => Math.floor(Date.now() / 1000) };

/** Request ceiling for any single response body. A page of 100 subscriptions is well under 1 MiB. */
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
const MAX_CUSTOMER_LOOKUPS = 50;

function usage(io: Io, message: string): number {
  io.err(`${TOOL_NAME}: ${message}\nRun with --help for usage.\n`);
  return EXIT_USAGE;
}

function checklist(format: Format): string {
  return format === "json" ? renderChecklistJson() : format === "markdown" ? renderChecklistMarkdown() : renderChecklistTerminal();
}

async function audit(options: AuditOptions, env: Readonly<Record<string, string | undefined>>, io: Io, deps: Deps): Promise<number> {
  const key = classifyKey(env.STRIPE_API_KEY);
  if (!key.ok) return usage(io, key.error);
  const base = parseApiBase(options.apiBase);
  if (!base.ok) return usage(io, base.error);
  if (!base.value.overridden && env.NODE_TLS_REJECT_UNAUTHORIZED === "0") {
    return usage(io, "NODE_TLS_REJECT_UNAUTHORIZED=0 disables certificate checks; refusing to send an API key to api.stripe.com that way.");
  }
  const warnings: string[] = [];
  if (key.value.kind === "secret") {
    if (!options.allowUnrestrictedKey) {
      return usage(io, "STRIPE_API_KEY is an unrestricted secret key (sk_...). Create a restricted key with read permissions, or pass --allow-unrestricted-key to accept the risk.");
    }
    warnings.push("An unrestricted secret key is in use. This tool only sends GET requests, but the key itself could write. Prefer a restricted key with read permissions.");
  }
  if (base.value.overridden) warnings.push(`API base overridden to ${base.value.origin}; this is a test setup, not Stripe.`);

  // The key lives only in this variable and in the reader's Authorization header.
  const apiKey = (env.STRIPE_API_KEY ?? "").trim();
  const budget = new RequestBudget(options.maxRequests);
  const reader = new HttpStripeReader({
    origin: base.value.origin,
    apiKey,
    userAgent: `${TOOL_NAME}/${VERSION}`,
    timeoutMs: options.timeoutMs,
    maxResponseBytes: MAX_RESPONSE_BYTES,
    maxRetries: 3,
    maxBackoffMs: 10_000,
    budget,
    ...(deps.fetch ? { fetch: deps.fetch } : {}),
    ...(deps.sleep ? { sleep: deps.sleep } : {}),
  });

  try {
    const report = await runAudit(
      reader,
      deps.clock ?? systemClock,
      {
        tool: { name: TOOL_NAME, version: VERSION },
        mode: key.value.mode,
        keyKind: key.value.kind,
        failOn: options.failOn,
        thresholds: { pastDueDays: options.pastDueDays, trialDays: options.trialDays, staleInvoiceDays: options.staleInvoiceDays },
        collect: { maxPages: options.maxPages, maxCustomerLookups: MAX_CUSTOMER_LOOKUPS, customerLookup: !options.skipCustomerLookup, includeEvents: options.includeEvents },
        warnings,
      },
      () => budget.used,
    );
    const text = options.format === "json" ? renderJson(report) : options.format === "markdown" ? renderMarkdown(report) : renderTerminal(report);
    if (containsSecret(text, [apiKey])) io.err(`${TOOL_NAME}: the report contained key-shaped text, which was redacted.\n`);
    io.out(redactSecrets(text, [apiKey]));
    return report.exitCode;
  } catch (error) {
    if (error instanceof AuthenticationError) {
      io.err(`${TOOL_NAME}: Stripe rejected the API key (HTTP 401). Check that STRIPE_API_KEY is current and belongs to this account.\n`);
      return EXIT_API;
    }
    const detail = error instanceof Error ? `${error.name}: ${error.message}` : "unknown error";
    io.err(`${TOOL_NAME}: unexpected error, the audit did not complete: ${redactSecrets(clip(detail, 200), [apiKey])}\n`);
    return EXIT_API;
  }
}

/** Runs the CLI with everything it touches passed in: arguments, environment, output and (for tests) the network. */
export async function runCli(argv: readonly string[], env: Readonly<Record<string, string | undefined>>, io: Io, deps: Deps = {}): Promise<number> {
  const command = parseCommand(argv);
  if (!command.ok) return usage(io, command.error);
  switch (command.value.kind) {
    case "help":
      io.out(HELP);
      return EXIT_CLEAN;
    case "version":
      io.out(`${TOOL_NAME} ${VERSION}\n`);
      return EXIT_CLEAN;
    case "checklist":
      io.out(checklist(command.value.format));
      return EXIT_CLEAN;
    case "audit":
      return audit(command.value.options, env, io, deps);
  }
}
