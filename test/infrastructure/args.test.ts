import { describe, expect, it } from "vitest";
import { parseCommand, type AuditOptions } from "../../src/infrastructure/cli/args.js";
import { fakeKey } from "../support/keys.js";

const audit = (argv: string[]): AuditOptions => {
  const r = parseCommand(argv);
  if (!r.ok || r.value.kind !== "audit") throw new Error(`expected an audit command: ${JSON.stringify(r)}`);
  return r.value.options;
};

describe("parseCommand", () => {
  it("defaults to a terminal audit with documented limits", () => {
    expect(audit([])).toEqual({
      format: "terminal",
      failOn: "medium",
      allowUnrestrictedKey: false,
      apiBase: undefined,
      pastDueDays: 7,
      trialDays: 7,
      staleInvoiceDays: 14,
      maxPages: 5,
      maxRequests: 150,
      timeoutMs: 15_000,
      skipCustomerLookup: false,
      includeEvents: false,
    });
  });

  it("reads every option", () => {
    const o = audit(["--markdown", "--fail-on", "high", "--allow-unrestricted-key", "--api-base", "http://127.0.0.1:1", "--past-due-days", "3", "--trial-days", "0", "--stale-invoice-days", "30", "--max-pages", "2", "--max-requests", "40", "--timeout-ms", "900", "--skip-customer-lookup", "--include-events"]);
    expect(o).toMatchObject({ format: "markdown", failOn: "high", allowUnrestrictedKey: true, apiBase: "http://127.0.0.1:1", pastDueDays: 3, trialDays: 0, staleInvoiceDays: 30, maxPages: 2, maxRequests: 40, timeoutMs: 900, skipCustomerLookup: true, includeEvents: true });
    expect(audit(["--json"]).format).toBe("json");
  });

  it("recognises help, version and the checklist in each format", () => {
    expect(parseCommand(["--help"])).toEqual({ ok: true, value: { kind: "help" } });
    expect(parseCommand(["-h"])).toEqual({ ok: true, value: { kind: "help" } });
    expect(parseCommand(["--version"])).toEqual({ ok: true, value: { kind: "version" } });
    expect(parseCommand(["--checklist"])).toEqual({ ok: true, value: { kind: "checklist", format: "terminal" } });
    expect(parseCommand(["--checklist", "--markdown"])).toEqual({ ok: true, value: { kind: "checklist", format: "markdown" } });
    expect(parseCommand(["--checklist", "--json"])).toEqual({ ok: true, value: { kind: "checklist", format: "json" } });
  });

  it.each([
    [["--json", "--markdown"], "Choose one"],
    [["--fail-on", "severe"], "--fail-on must be one of"],
    [["--past-due-days", "-1"], "--past-due-days"],
    [["--past-due-days", "abc"], "--past-due-days"],
    [["--max-pages", "0"], "--max-pages"],
    [["--max-pages", "51"], "--max-pages"],
    [["--max-requests", "99999"], "--max-requests"],
    [["--timeout-ms", "10"], "--timeout-ms"],
    [["--trial-days", "1.5"], "--trial-days"],
    [["--nope"], "nope"],
    [["not-a-flag"], "STRIPE_API_KEY"],
    [["--api-base"], "api-base"],
  ])("rejects %j", (argv, message) => {
    const r = parseCommand(argv);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain(message);
  });

  it("never echoes a positional argument, which might be a pasted key", () => {
    const r = parseCommand([fakeKey("rk", "live", "SECRETSECRETSECRET1")]);
    expect(r.ok === false && r.error).not.toContain("SECRET");
  });
});
