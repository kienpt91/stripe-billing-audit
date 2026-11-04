import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { validateRead } from "../../src/domain/stripe/allowlist.js";
import type { AuditReport } from "../../src/domain/report.js";
import { NOW } from "../support/builders.js";
import { cli, KEY } from "../support/cli-harness.js";
import { fakeKey } from "../support/keys.js";
import { cleanWorld, troubledWorld } from "../support/stripe-fixtures.ts";

const PII = /jane\.doe|Jane|1 Main Street|Springfield|\+1 555|owner@example\.org|Example Inc|whsec|NEVERNEVER|token=abc|whsec0123/;
const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u202a-\u202e\u200b-\u200f]/;
const pkg = JSON.parse(readFileSync(resolve(import.meta.dirname, "../../package.json"), "utf8")) as { version: string };

describe("a healthy account", () => {
  it("exits 0, reports the mode and reads with GET only on allowlisted paths", async () => {
    const r = await cli([]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("No findings.");
    expect(r.out).toContain("Mode: LIVE");
    expect(r.out).toContain("0 failed");
    expect(r.err).toBe("");
    expect(r.server.requests.length).toBeGreaterThan(8);
    for (const q of r.server.requests) {
      expect(q.method).toBe("GET");
      expect(validateRead(q.path, q.query).ok, q.path).toBe(true);
      expect(q.authorization).toBe(`Bearer ${KEY}`);
    }
  });

  it("reads customers only when a subscription lacks its own payment method, and never events by default", async () => {
    const r = await cli([]);
    expect(r.server.requests.some((q) => q.path.startsWith("/v1/customers"))).toBe(false);
    expect(r.server.requests.some((q) => q.path === "/v1/events")).toBe(false);
  });

  it("prints the test mode for a test key", async () => {
    const key = fakeKey("rk", "test");
    const r = await cli([], { world: cleanWorld(NOW, false), env: { STRIPE_API_KEY: key }, serverKey: key });
    expect(r.code).toBe(0);
    expect(r.out).toContain("Mode: TEST");
  });
});

describe("an account with billing gaps", () => {
  const ids = [
    "webhook-lifecycle-events-missing",
    "webhook-endpoint-http",
    "webhook-endpoint-disabled",
    "webhook-api-version-drift",
    "subscription-delinquent",
    "customer-no-default-payment-method",
    "trial-ending-without-payment-method",
    "invoice-stuck-open",
    "dunning-retries-exhausted",
    "invoice-uncollectible",
    "portal-missing",
    "tax-automatic-disabled",
    "tax-settings-incomplete",
    "tax-price-behavior-unspecified",
    "tax-product-code-missing",
    "currency-mixed",
    "subscription-cancel-at-period-end-no-winback",
  ];

  it("exits 1 and reports each gap in the terminal report", async () => {
    const r = await cli([], { world: troubledWorld(NOW) });
    expect(r.code).toBe(1);
    for (const id of ids) expect(r.out, id).toContain(id);
    expect(r.out).toContain("exit code 1 (findings at or above medium)");
  });

  it("looks customers up only for the subscriptions that need it", async () => {
    const r = await cli([], { world: troubledWorld(NOW) });
    expect(r.server.requests.filter((q) => q.path.startsWith("/v1/customers/")).map((q) => q.path)).toEqual(["/v1/customers/cus_1PastDueAaaaaaaa", "/v1/customers/cus_1TrialBbbbbbbbbb"]);
  });

  it("writes a JSON report with a schema version", async () => {
    const r = await cli(["--json"], { world: troubledWorld(NOW) });
    const report = JSON.parse(r.out) as AuditReport;
    expect(report.schemaVersion).toBe(1);
    expect(report.account).toMatchObject({ mode: "live", keyKind: "restricted", id: "acct_1QAbCd…", apiVersion: "2025-09-30.clover" });
    expect(report.findings.map((f) => f.id)).toEqual(expect.arrayContaining(ids));
    expect(report.exitCode).toBe(1);
  });

  it("writes a Markdown report for a client", async () => {
    const r = await cli(["--markdown"], { world: troubledWorld(NOW) });
    expect(r.out).toContain("# Stripe billing audit");
    expect(r.out).toContain("#### `webhook-endpoint-http`");
    expect(r.out).toContain("read-only GET requests");
  });

  it("never contains personal data, secrets or URL tokens, in any format and with every option on", async () => {
    for (const format of [[], ["--json"], ["--markdown"]]) {
      const r = await cli([...format, "--include-events"], { world: troubledWorld(NOW) });
      expect(r.out + r.err).not.toMatch(PII);
      expect(r.out + r.err).not.toContain(KEY);
    }
  });

  it("gates on --fail-on", async () => {
    expect((await cli(["--fail-on", "critical"], { world: troubledWorld(NOW) })).code).toBe(0);
    expect((await cli(["--fail-on", "high"], { world: troubledWorld(NOW) })).code).toBe(1);
    expect((await cli(["--fail-on", "info"], { world: cleanWorld(NOW) })).code).toBe(0);
  });

  it("applies the thresholds", async () => {
    const strict = await cli(["--json", "--past-due-days", "100", "--stale-invoice-days", "100"], { world: troubledWorld(NOW) });
    const ids = (JSON.parse(strict.out) as AuditReport).findings.map((f) => f.id);
    expect(ids).not.toContain("subscription-delinquent");
    expect(ids).not.toContain("invoice-stuck-open");
  });

  it("reads failed event deliveries only with --include-events", async () => {
    const r = await cli(["--include-events"], { world: troubledWorld(NOW) });
    expect(r.out).toContain("webhook-deliveries-failing");
    expect(r.server.requests.find((q) => q.path === "/v1/events")?.query).toEqual({ delivery_success: "false", limit: "25" });
  });

  it("skips the customer checks, without failing, with --skip-customer-lookup", async () => {
    const r = await cli(["--skip-customer-lookup", "--json"], { world: troubledWorld(NOW) });
    const report = JSON.parse(r.out) as AuditReport;
    expect(r.server.requests.some((q) => q.path.startsWith("/v1/customers"))).toBe(false);
    expect(report.skipped.map((s) => s.checkId)).toEqual(expect.arrayContaining(["customer-no-default-payment-method", "trial-ending-without-payment-method"]));
    expect(report.skipped.every((s) => s.reason === "disabled")).toBe(true);
    expect(r.code).toBe(1);
  });
});

describe("a key with too few permissions", () => {
  it("exits 4 and lists the checks that could not run", async () => {
    const r = await cli([], { world: troubledWorld(NOW), setup: (s) => s.denied.add("/v1/tax/registrations").add("/v1/billing_portal") });
    expect(r.code).toBe(4);
    expect(r.out).toContain("Skipped checks");
    expect(r.out).toContain("tax-automatic-disabled: tax registrations: HTTP 403");
    expect(r.out).toContain("portal-missing: billing portal configurations: HTTP 403");
    expect(r.out).toContain("exit code 4 (checks skipped: a resource was not available to this key)");
    expect(r.out).not.toContain(KEY);
  });

  it("is not tricked into a clean exit by the missing data", async () => {
    const r = await cli([], { world: cleanWorld(NOW), setup: (s) => s.denied.add("/v1/subscriptions") });
    expect(r.code).toBe(4);
  });
});

describe("API trouble", () => {
  it("exits 3 for server errors that persist, after retrying with backoff", async () => {
    const sleeps: number[] = [];
    const r = await cli([], {
      deps: { sleep: async (ms) => void sleeps.push(ms) },
      setup: (s) =>
        s.overrides.set("/v1/prices", (_req, res) => {
          res.writeHead(503);
          res.end("{}");
          return true;
        }),
    });
    expect(r.code).toBe(3);
    expect(r.out).toContain("prices: HTTP 503");
    expect(sleeps).toEqual([500, 1000, 2000]);
  });

  it("recovers from a rate limit", async () => {
    const r = await cli([], {
      setup: (s) =>
        s.overrides.set("/v1/subscriptions", (_req, res, hit) => {
          if (hit > 1) return false;
          res.writeHead(429, { "retry-after": "1" });
          res.end("{}");
          return true;
        }),
    });
    expect(r.code).toBe(0);
  });

  it("exits 3 when the key is rejected", async () => {
    const r = await cli([], { serverKey: fakeKey("rk", "live", "ANOTHERKEYANOTHERKEY0000") });
    expect(r.code).toBe(3);
    expect(r.err).toContain("Stripe rejected the API key (HTTP 401)");
    expect(r.out).toBe("");
    expect(r.err).not.toContain(KEY);
  });

  it("exits 3 and names the budget when the request budget is too small", async () => {
    const r = await cli(["--max-requests", "4"]);
    expect(r.code).toBe(3);
    expect(r.out).toContain("request budget");
    expect(r.server.requests).toHaveLength(4);
  });

  it("reports listings cut by the page cap", async () => {
    const world = cleanWorld(NOW);
    const template = world.subscriptions[0] as Record<string, unknown>;
    world.subscriptions = Array.from({ length: 150 }, (_, i) => ({ ...template, id: `sub_${String(i).padStart(8, "0")}` }));
    const r = await cli(["--max-pages", "1"], { world });
    expect(r.out).toContain("Partial coverage");
    expect(r.out).toContain("subscriptions [cap]: stopped at the page cap (1 page of 100)");
    expect(r.code).toBe(5);
  });
});

describe("usage errors", () => {
  it("exits 2 without a key and says how to set one", async () => {
    const r = await cli([], { env: {}, noBase: true });
    expect(r.code).toBe(2);
    expect(r.err).toContain("STRIPE_API_KEY is not set");
    expect(r.out).toBe("");
  });

  it("refuses a publishable key and a malformed one without echoing it", async () => {
    for (const value of [fakeKey("pk", "live"), "garbage-garbage-garbage"]) {
      const r = await cli([], { env: { STRIPE_API_KEY: value }, noBase: true });
      expect(r.code).toBe(2);
      expect(r.err).not.toContain(value);
    }
  });

  it("refuses an unrestricted key unless told otherwise, and then warns", async () => {
    const sk = fakeKey("sk", "live");
    const refused = await cli([], { env: { STRIPE_API_KEY: sk }, serverKey: sk });
    expect(refused.code).toBe(2);
    expect(refused.err).toContain("unrestricted secret key");
    expect(refused.server.requests).toHaveLength(0);
    const allowed = await cli(["--allow-unrestricted-key"], { env: { STRIPE_API_KEY: sk }, serverKey: sk });
    expect(allowed.code).toBe(0);
    expect(allowed.out).toContain("Warning: An unrestricted secret key is in use");
    expect(allowed.out).toContain("Key: secret");
    expect(allowed.out + allowed.err).not.toContain(sk);
  });

  it("refuses an API base that is not loopback", async () => {
    for (const base of ["https://api.stripe.com", "http://localhost:4000", "http://example.com", "http://127.0.0.1:1@evil.test"]) {
      const r = await cli(["--api-base", base], { noBase: true });
      expect(r.code, base).toBe(2);
    }
  });

  it("refuses to disable certificate verification for the real API", async () => {
    const r = await cli([], { env: { STRIPE_API_KEY: KEY, NODE_TLS_REJECT_UNAUTHORIZED: "0" }, noBase: true });
    expect(r.code).toBe(2);
    expect(r.err).toContain("NODE_TLS_REJECT_UNAUTHORIZED=0");
  });

  it("rejects bad options and unexpected arguments", async () => {
    for (const args of [["--fail-on", "x"], ["--wat"], ["extra"], ["--json", "--markdown"]]) {
      const r = await cli(args, { noBase: true });
      expect(r.code, args.join(" ")).toBe(2);
      expect(r.err).toContain("--help");
    }
  });
});

describe("informational modes", () => {
  it("prints help and the version without a key", async () => {
    const help = await cli(["--help"], { env: {}, noBase: true });
    expect(help.code).toBe(0);
    expect(help.out).toContain("Exit codes:");
    const version = await cli(["--version"], { env: {}, noBase: true });
    expect(version.out).toBe(`stripe-billing-audit ${pkg.version}\n`);
  });

  it("prints the manual checklist in each format without a key or a network", async () => {
    const text = await cli(["--checklist"], { env: {}, noBase: true });
    expect(text.code).toBe(0);
    expect(text.out).toContain("Retry schedule and the state after the last retry");
    expect((await cli(["--checklist", "--markdown"], { env: {}, noBase: true })).out).toContain("- [ ] **Retry schedule");
    expect((JSON.parse((await cli(["--checklist", "--json"], { env: {}, noBase: true })).out) as { items: unknown[] }).items.length).toBeGreaterThan(5);
  });
});

describe("hostile API behaviour", () => {
  const paths = ["/v1/account", "/v1/webhook_endpoints", "/v1/subscriptions", "/v1/invoices", "/v1/prices", "/v1/products", "/v1/billing_portal/configurations", "/v1/tax/settings", "/v1/tax/registrations"];
  const bodies: Array<[string, string]> = [
    ["null", "null"],
    ["an array", "[]"],
    ["a string", '"oops"'],
    ["data of the wrong type", '{"object":"list","data":"x","has_more":false}'],
    ["junk entries", '{"object":"list","data":[null,1,"x",[],{},{"id":5},{"id":"\\u001b]0;pwn\\u0007"}],"has_more":false}'],
    ["a never-ending cursor", '{"object":"list","data":[{"id":"x_1"}],"has_more":true}'],
    ["invalid JSON", "{not json"],
    ["deep nesting", "[".repeat(100_000) + "]".repeat(100_000)],
    ["control characters in every string", JSON.stringify({ object: "list", data: [{ id: "we_\u001b[31mred", url: "https://x.test/\u001b]8;;evil\u0007", status: "enabled\u202e", enabled_events: ["\u001b[2J", "invoice.paid"], api_version: "\u0007" }], has_more: false })],
  ];

  it.each(paths.flatMap((p) => bodies.map(([name, body]) => [p, name, body] as const)))("survives %s answering with %s", async (path, _name, body) => {
    const r = await cli([], {
      world: troubledWorld(NOW),
      setup: (s) =>
        s.overrides.set(path, (_req, res) => {
          res.writeHead(200, { "content-type": "application/json", "stripe-version": "2020-08-27 <b>x</b>" });
          res.end(body);
          return true;
        }),
    });
    expect([0, 1, 3, 4]).toContain(r.code);
    expect(r.out + r.err).not.toMatch(CONTROL);
    expect(r.out + r.err).not.toContain(KEY);
  });

  it("survives a response larger than the size limit", async () => {
    const r = await cli([], {
      setup: (s) =>
        s.overrides.set("/v1/products", (_req, res) => {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ object: "list", data: [], has_more: false, padding: "x".repeat(6 * 1024 * 1024) }));
          return true;
        }),
    });
    expect(r.code).toBe(3);
    expect(r.out).toContain("larger than the size limit");
  });

  it("never prints a key the server echoes back", async () => {
    const r = await cli(["--json"], {
      world: troubledWorld(NOW),
      setup: (s) => {
        s.denied.add("/v1/tax/settings");
        s.overrides.set("/v1/webhook_endpoints", (_req, res) => {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ object: "list", has_more: false, data: [{ id: `we_${KEY}`, status: "enabled", url: `https://hooks.example.com/${KEY}`, enabled_events: [KEY, "invoice.paid"] }] }));
          return true;
        });
      },
    });
    expect(r.out + r.err).not.toContain(KEY);
    expect(r.out + r.err).not.toMatch(/[rs]k_(live|test)_[A-Za-z0-9]{8,}/);
  });
});
