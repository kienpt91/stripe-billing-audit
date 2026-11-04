import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RequestBudget } from "../../src/domain/budget.js";
import { HttpStripeReader, type HttpReaderOptions } from "../../src/infrastructure/stripe/http-reader.js";
import { FakeStripe } from "../support/fake-stripe.ts";
import { cleanWorld } from "../support/stripe-fixtures.ts";
import { fakeKey } from "../support/keys.js";

const KEY = fakeKey("rk", "test");
let server: FakeStripe;
let sleeps: number[];

beforeEach(async () => {
  server = await new FakeStripe(cleanWorld(1_793_000_000, false), KEY).start();
  sleeps = [];
});
afterEach(async () => {
  await server.stop();
});

function reader(over: Partial<HttpReaderOptions> = {}): HttpStripeReader {
  return new HttpStripeReader({
    origin: server.url,
    apiKey: KEY,
    userAgent: "test-agent",
    timeoutMs: 2000,
    maxResponseBytes: 1_000_000,
    maxRetries: 2,
    maxBackoffMs: 5000,
    budget: new RequestBudget(50),
    sleep: async (ms) => void sleeps.push(ms),
    ...over,
  });
}

describe("a successful read", () => {
  it("sends GET with the bearer key and returns the body and the account API version", async () => {
    const r = await reader().get("/v1/account");
    expect(r).toMatchObject({ ok: true, stripeVersion: "2025-09-30.clover", body: { id: "acct_1QAbCdEfGhIjKlMn" } });
    expect(server.requests).toEqual([{ method: "GET", path: "/v1/account", query: {}, authorization: `Bearer ${KEY}` }]);
  });

  it("passes the allowlisted query parameters through", async () => {
    await reader().get("/v1/subscriptions", { status: "all", limit: "100" });
    expect(server.requests[0]?.query).toEqual({ status: "all", limit: "100" });
  });
});

describe("the allowlist", () => {
  it("refuses a path or parameter that is not allowed without sending anything", async () => {
    expect(await reader().get("/v1/charges")).toMatchObject({ ok: false, kind: "refused" });
    expect(await reader().get("/v1/account", { expand: "x" })).toMatchObject({ ok: false, kind: "refused" });
    expect(await reader().get("/v1/customers/cus_1/../../charges")).toMatchObject({ ok: false, kind: "refused" });
    expect(server.requests).toHaveLength(0);
  });
});

describe("HTTP statuses", () => {
  it("classifies 401, 403, 404 and other client errors and keeps only a well-formed error code", async () => {
    server.overrides.set("/v1/webhook_endpoints", (_req, res) => {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message: `bad ${KEY}`, code: "parameter_invalid_integer" } }));
      return true;
    });
    expect(await reader({ apiKey: "wrong" }).get("/v1/account")).toEqual({ ok: false, kind: "auth", status: 401, code: "api_key_invalid" });
    server.denied.add("/v1/subscriptions");
    const denied = await reader().get("/v1/subscriptions");
    expect(denied).toEqual({ ok: false, kind: "permission", status: 403, code: null });
    expect(JSON.stringify(denied)).not.toContain(KEY);
    expect(await reader().get("/v1/customers/cus_missing")).toMatchObject({ ok: false, kind: "not_found", status: 404, code: "resource_missing" });
    expect(await reader().get("/v1/webhook_endpoints")).toEqual({ ok: false, kind: "rejected", status: 400, code: "parameter_invalid_integer" });
  });

  it("ignores an error code of the wrong shape and an oversized error body", async () => {
    server.overrides.set("/v1/products", (_req, res) => {
      res.writeHead(403, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { code: "Not A Code!" } }));
      return true;
    });
    server.overrides.set("/v1/prices", (_req, res) => {
      res.writeHead(403);
      res.end("x".repeat(200_000));
      return true;
    });
    expect(await reader().get("/v1/products")).toMatchObject({ kind: "permission", code: null });
    expect(await reader().get("/v1/prices")).toMatchObject({ kind: "permission", code: null });
  });
});

describe("rate limits and server errors", () => {
  it("honours Retry-After (in seconds, capped) and then succeeds, spending budget on each attempt", async () => {
    const budget = new RequestBudget(10);
    server.overrides.set("/v1/account", (_req, res, hit) => {
      if (hit > 2) return false;
      res.writeHead(429, { "retry-after": hit === 1 ? "2" : "9999" });
      res.end("{}");
      return true;
    });
    const r = await reader({ budget, maxBackoffMs: 3000 }).get("/v1/account");
    expect(r.ok).toBe(true);
    expect(sleeps).toEqual([2000, 3000]);
    expect(budget.used).toBe(3);
  });

  it("backs off exponentially without Retry-After and gives up after the retries", async () => {
    server.overrides.set("/v1/account", (_req, res) => {
      res.writeHead(429);
      res.end("{}");
      return true;
    });
    expect(await reader().get("/v1/account")).toMatchObject({ ok: false, kind: "rate_limited", status: 429 });
    expect(sleeps).toEqual([500, 1000]);
    expect(server.requests).toHaveLength(3);
  });

  it("retries a 5xx and reports it when it persists", async () => {
    server.overrides.set("/v1/account", (_req, res) => {
      res.writeHead(503);
      res.end("{}");
      return true;
    });
    expect(await reader({ maxRetries: 1 }).get("/v1/account")).toMatchObject({ ok: false, kind: "server", status: 503 });
    expect(server.requests).toHaveLength(2);
  });
});

describe("limits", () => {
  it("stops when the request budget is spent, retries included", async () => {
    const r = reader({ budget: new RequestBudget(2) });
    expect((await r.get("/v1/account")).ok).toBe(true);
    expect((await r.get("/v1/account")).ok).toBe(true);
    expect(await r.get("/v1/account")).toMatchObject({ ok: false, kind: "budget" });
    expect(server.requests).toHaveLength(2);
  });

  it("stops retrying when the budget runs out in the middle", async () => {
    server.overrides.set("/v1/account", (_req, res) => {
      res.writeHead(500);
      res.end("{}");
      return true;
    });
    expect(await reader({ budget: new RequestBudget(2) }).get("/v1/account")).toMatchObject({ ok: false, kind: "budget" });
    expect(server.requests).toHaveLength(2);
  });

  it("times out a server that does not answer", async () => {
    server.overrides.set("/v1/account", () => new Promise<boolean>(() => undefined));
    const started = Date.now();
    expect(await reader({ timeoutMs: 150 }).get("/v1/account")).toMatchObject({ ok: false, kind: "timeout" });
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it("refuses a response above the size limit, even when it is streamed without a length", async () => {
    server.overrides.set("/v1/account", (_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.write("[");
      for (let i = 0; i < 200; i++) res.write(`"${"x".repeat(1000)}",`);
      res.end('"end"]');
      return true;
    });
    expect(await reader({ maxResponseBytes: 50_000 }).get("/v1/account")).toMatchObject({ ok: false, kind: "too_large", status: 200 });
  });

  it("reports invalid JSON as malformed", async () => {
    server.overrides.set("/v1/account", (_req, res) => {
      res.writeHead(200);
      res.end("<html>not json</html>");
      return true;
    });
    expect(await reader().get("/v1/account")).toMatchObject({ ok: false, kind: "malformed", status: 200 });
  });
});

describe("the key never leaves for another host", () => {
  it("does not follow a redirect", async () => {
    const seen: Array<string | undefined> = [];
    const other = createServer((req, res) => {
      seen.push(req.headers.authorization);
      res.end("{}");
    });
    await new Promise<void>((resolve) => other.listen(0, "127.0.0.1", resolve));
    const target = `http://127.0.0.1:${(other.address() as AddressInfo).port}/steal`;
    server.overrides.set("/v1/account", (_req, res) => {
      res.writeHead(302, { location: target });
      res.end();
      return true;
    });
    const r = await reader({ maxRetries: 0 }).get("/v1/account");
    other.closeAllConnections();
    await new Promise<void>((resolve) => other.close(() => resolve()));
    expect(r).toMatchObject({ ok: false });
    expect(seen).toEqual([]);
  });

  it("reports an unreachable server as a network error after retrying", async () => {
    const dead = reader({ origin: "http://127.0.0.1:1", maxRetries: 1 });
    expect(await dead.get("/v1/account")).toMatchObject({ ok: false, kind: "network" });
    expect(sleeps).toEqual([500]);
  });

  it("never reflects the key in any result", async () => {
    server.denied.add("/v1/account");
    const results = [await reader().get("/v1/account"), await reader({ origin: "http://127.0.0.1:1", maxRetries: 0 }).get("/v1/account")];
    expect(JSON.stringify(results)).not.toContain(KEY);
  });
});
