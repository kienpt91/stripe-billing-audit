import { describe, expect, it } from "vitest";
import { collectFacts, type CollectOptions } from "../../src/application/collect.js";
import { AuthenticationError } from "../../src/application/ports.js";
import type { Facts } from "../../src/domain/facts.js";
import { NOW } from "../support/builders.js";
import { FakeReader, body, clock, fail, healthyReader, paged } from "../support/fake-reader.js";
import { int, prng } from "../support/prng.js";

const OPTIONS: CollectOptions = { maxPages: 5, maxCustomerLookups: 50, customerLookup: true, includeEvents: false };
const collect = (reader: FakeReader, options: Partial<CollectOptions> = {}): Promise<Facts> => collectFacts(reader, clock, "live", { ...OPTIONS, ...options });

function subs(n: number, over: Record<string, unknown> = {}): { id: string }[] {
  return Array.from({ length: n }, (_, i) => ({ id: `sub_${String(i).padStart(6, "0")}`, status: "active", customer: `cus_${i}`, collection_method: "charge_automatically", ...over }));
}

describe("collectFacts on a healthy account", () => {
  it("fills every fact, stamps the mode and time and reads the account version from the header", async () => {
    const facts = await collect(healthyReader());
    expect(facts.mode).toBe("live");
    expect(facts.nowSeconds).toBe(NOW);
    expect(facts.account).toMatchObject({ status: "ok", value: { id: "acct_1AbCdEfGhIjKl", apiVersion: "2025-09-30.clover", defaultCurrency: "usd" } });
    expect(facts.webhookEndpoints).toMatchObject({ status: "ok", truncated: false, value: [{ id: "we_1AbCdEfGhIjKl" }] });
    expect(facts.taxSettings).toMatchObject({ status: "ok", value: { status: "active", hasDefaultTaxCode: true } });
  });

  it("only reads allowlisted listing endpoints, always with limit and the intended filters", async () => {
    const reader = healthyReader();
    await collect(reader);
    expect(reader.calls.map((c) => `${c.path}?${new URLSearchParams(c.query)}`)).toEqual([
      "/v1/account?",
      "/v1/webhook_endpoints?limit=100",
      "/v1/subscriptions?status=all&limit=100",
      "/v1/invoices?status=open&limit=100",
      "/v1/invoices?status=uncollectible&limit=100",
      "/v1/prices?active=true&limit=100",
      "/v1/products?active=true&limit=100",
      "/v1/billing_portal/configurations?limit=100",
      "/v1/tax/settings?",
      "/v1/tax/registrations?status=active&limit=100",
    ]);
  });

  it("marks events and customers as switched off rather than reading them", async () => {
    const facts = await collect(healthyReader(), { customerLookup: false });
    expect(facts.failedEvents).toMatchObject({ status: "unreadable", reason: "disabled" });
    expect(facts.customers).toMatchObject({ status: "unreadable", reason: "disabled" });
  });
});

describe("pagination", () => {
  it("follows cursors across pages and returns every object once", async () => {
    const reader = healthyReader().on("/v1/subscriptions", paged(subs(250), 100));
    const facts = await collect(reader);
    expect(facts.subscriptions).toMatchObject({ status: "ok", truncated: false });
    expect(facts.subscriptions.status === "ok" && facts.subscriptions.value).toHaveLength(250);
    expect(reader.calls.filter((c) => c.path === "/v1/subscriptions").map((c) => c.query.starting_after)).toEqual([undefined, "sub_000099", "sub_000199"]);
  });

  it("stops at the page cap and says the listing is truncated", async () => {
    const facts = await collect(healthyReader().on("/v1/subscriptions", paged(subs(1000), 100)), { maxPages: 3 });
    expect(facts.subscriptions).toMatchObject({ status: "ok", truncated: true });
    expect(facts.subscriptions.status === "ok" && facts.subscriptions.value).toHaveLength(300);
  });

  it("returns exactly min(total, cap) objects, no duplicates, whatever the server's page size (property)", async () => {
    const rand = prng(99);
    for (let i = 0; i < 60; i++) {
      const total = int(rand, 0, 400);
      const pageSize = int(rand, 1, 100);
      const maxPages = int(rand, 1, 6);
      const facts = await collect(healthyReader().on("/v1/subscriptions", paged(subs(total), pageSize)), { maxPages });
      const value = facts.subscriptions.status === "ok" ? facts.subscriptions.value : [];
      expect(value.length).toBe(Math.min(total, maxPages * pageSize));
      expect(new Set(value.map((s) => s.id)).size).toBe(value.length);
      expect(facts.subscriptions.status === "ok" && facts.subscriptions.truncated).toBe(total > maxPages * pageSize);
    }
  });

  it("deduplicates objects a misbehaving server repeats", async () => {
    const dup = [{ id: "sub_1" }, { id: "sub_1" }, { id: "sub_2" }];
    const facts = await collect(healthyReader().on("/v1/subscriptions", () => body({ data: dup, has_more: false })));
    expect(facts.subscriptions.status === "ok" && facts.subscriptions.value.map((s) => s.id)).toEqual(["sub_1", "sub_2"]);
  });

  it("gives up on a server whose cursor does not advance instead of looping", async () => {
    const reader = healthyReader().on("/v1/subscriptions", () => body({ data: [{ id: "sub_1" }], has_more: true }));
    const facts = await collect(reader, { maxPages: 50 });
    expect(facts.subscriptions).toMatchObject({ status: "unreadable", reason: "api_error", detail: "pagination did not advance" });
    expect(reader.calls.filter((c) => c.path === "/v1/subscriptions")).toHaveLength(2);
  });

  it("treats has_more with no usable last id as not advancing, and counts malformed objects", async () => {
    const facts = await collect(
      healthyReader()
        .on("/v1/subscriptions", () => body({ data: [{ id: "not an id" }], has_more: true }))
        .on("/v1/prices", () => body({ data: [{ id: "price_1" }, 5], has_more: false })),
    );
    expect(facts.subscriptions).toMatchObject({ status: "unreadable", detail: "pagination did not advance" });
    expect(facts.prices).toMatchObject({ status: "ok", malformed: 1 });
  });
});

describe("failures", () => {
  it("maps each failure kind to a reason and keeps going with the other resources", async () => {
    const reader = healthyReader()
      .on("/v1/webhook_endpoints", fail("permission", 403))
      .on("/v1/subscriptions", fail("rate_limited", 429))
      .on("/v1/prices", fail("server", 503))
      .on("/v1/products", fail("timeout", null))
      .on("/v1/invoices", fail("malformed", 200))
      .on("/v1/billing_portal/configurations", fail("budget", null))
      .on("/v1/tax/registrations", fail("network", null));
    const facts = await collect(reader);
    const reasons = (f: { status: string; reason?: string }) => (f.status === "unreadable" ? f.reason : "ok");
    expect(reasons(facts.webhookEndpoints)).toBe("permission");
    expect(reasons(facts.subscriptions)).toBe("api_error");
    expect(reasons(facts.prices)).toBe("api_error");
    expect(reasons(facts.products)).toBe("api_error");
    expect(reasons(facts.openInvoices)).toBe("api_error");
    expect(reasons(facts.portalConfigurations)).toBe("budget");
    expect(reasons(facts.taxRegistrations)).toBe("api_error");
    expect(facts.webhookEndpoints).toMatchObject({ detail: "HTTP 403: the key lacks the read permission for this resource" });
    expect(facts.subscriptions).toMatchObject({ detail: "HTTP 429: still rate limited after retries" });
    expect(facts.account.status).toBe("ok");
  });

  it("includes the machine-readable error code and the page of a late failure", async () => {
    const reader = healthyReader().on("/v1/subscriptions", (q) => (q.starting_after ? fail("permission", 403, "secret_key_required") : body({ data: [{ id: "sub_1" }], has_more: true })));
    const facts = await collect(reader);
    expect(facts.subscriptions).toMatchObject({ status: "unreadable", reason: "permission", detail: "HTTP 403: the key lacks the read permission for this resource, secret_key_required (page 2)" });
  });

  it("treats a missing endpoint as not available, other shapes as api errors", async () => {
    const reader = healthyReader().on("/v1/billing_portal/configurations", fail("not_found", 404)).on("/v1/products", fail("too_large", 200)).on("/v1/prices", fail("refused", null)).on("/v1/invoices", () => body("not a list"));
    const facts = await collect(reader);
    expect(facts.portalConfigurations).toMatchObject({ reason: "not_available" });
    expect(facts.products).toMatchObject({ reason: "api_error", detail: "the response was larger than the size limit" });
    expect(facts.prices).toMatchObject({ reason: "api_error" });
    expect(facts.openInvoices).toMatchObject({ reason: "api_error", detail: "unexpected response shape" });
  });

  it("aborts the audit when the key is rejected, wherever that happens", async () => {
    await expect(collect(healthyReader().on("/v1/account", fail("auth", 401)))).rejects.toBeInstanceOf(AuthenticationError);
    await expect(collect(healthyReader().on("/v1/prices", fail("auth", 401)))).rejects.toThrow("HTTP 401");
  });

  it("reads tax settings: a 404 means not configured, other failures are failures", async () => {
    expect((await collect(healthyReader().on("/v1/tax/settings", fail("not_found", 404)))).taxSettings).toMatchObject({ status: "ok", value: null });
    expect((await collect(healthyReader().on("/v1/tax/settings", fail("permission", 403)))).taxSettings).toMatchObject({ reason: "permission" });
    expect((await collect(healthyReader().on("/v1/tax/settings", body("junk")))).taxSettings).toMatchObject({ reason: "api_error" });
  });

  it("reports an unreadable account with the reason", async () => {
    expect((await collect(healthyReader().on("/v1/account", fail("permission", 403)))).account).toMatchObject({ status: "unreadable", reason: "permission" });
  });
});

describe("customer payment state", () => {
  const needy = subs(3, { default_payment_method: null });
  const reader = (): FakeReader =>
    healthyReader()
      .on("/v1/subscriptions", paged(needy))
      .on("/v1/customers/cus_0", body({ id: "cus_0", email: "a@example.com", invoice_settings: { default_payment_method: "pm_1" } }))
      .on("/v1/customers/cus_1", body({ id: "cus_1", email: "b@example.com", invoice_settings: { default_payment_method: null } }))
      .on("/v1/customers/cus_2", fail("not_found", 404));

  it("looks up only the customers whose subscriptions lack a payment method and keeps no personal data", async () => {
    const r = reader();
    const facts = await collect(r);
    expect(facts.customers).toMatchObject({ status: "ok", value: { checked: [{ id: "cus_0", hasDefaultPaymentMethod: true }, { id: "cus_1", hasDefaultPaymentMethod: false }], wanted: 3 } });
    expect(JSON.stringify(facts)).not.toContain("@example.com");
    expect(r.calls.filter((c) => c.path.startsWith("/v1/customers/"))).toHaveLength(3);
  });

  it("does not look anyone up when every subscription has a payment method", async () => {
    const r = healthyReader().on("/v1/subscriptions", paged(subs(2, { default_payment_method: "pm_1" })));
    const facts = await collect(r);
    expect(facts.customers).toMatchObject({ status: "ok", value: { checked: [], wanted: 0 } });
    expect(r.calls.some((c) => c.path.startsWith("/v1/customers"))).toBe(false);
  });

  it("honours the lookup cap and flags the result as partial", async () => {
    const facts = await collect(reader(), { maxCustomerLookups: 1 });
    expect(facts.customers).toMatchObject({ status: "ok", truncated: true, value: { wanted: 3 } });
    expect(facts.customers.status === "ok" && facts.customers.value.checked).toHaveLength(1);
  });

  it("returns what it has when the budget runs out mid-way, and nothing when it runs out at once", async () => {
    const partial = await collect(reader().on("/v1/customers/cus_1", fail("budget", null)));
    expect(partial).toMatchObject({ customers: { status: "ok", truncated: true } });
    const none = await collect(reader().on("/v1/customers/cus_0", fail("budget", null)));
    expect(none.customers).toMatchObject({ status: "unreadable", reason: "budget" });
  });

  it("makes the whole fact unreadable on a permission error and depends on the subscription listing", async () => {
    expect((await collect(reader().on("/v1/customers/cus_1", fail("permission", 403)))).customers).toMatchObject({ status: "unreadable", reason: "permission" });
    expect((await collect(reader().on("/v1/subscriptions", fail("permission", 403)))).customers).toMatchObject({ status: "unreadable", reason: "permission", detail: "needs the subscription listing" });
  });

  it("counts a customer object it cannot decode as malformed", async () => {
    const facts = await collect(reader().on("/v1/customers/cus_0", body("junk")));
    expect(facts.customers).toMatchObject({ status: "ok", malformed: 1 });
  });
});

describe("events", () => {
  it("reads one page of failed deliveries only when asked, and keeps no payload", async () => {
    const r = healthyReader().on("/v1/events", () => body({ data: [{ id: "evt_1", type: "invoice.paid", created: NOW - 100, pending_webhooks: 1, data: { object: { customer_email: "a@example.com" } } }], has_more: true }));
    const facts = await collect(r, { includeEvents: true });
    expect(facts.failedEvents).toMatchObject({ status: "ok", truncated: true, value: [{ id: "evt_1", type: "invoice.paid" }] });
    expect(JSON.stringify(facts)).not.toContain("@example.com");
    expect(r.calls.find((c) => c.path === "/v1/events")?.query).toEqual({ delivery_success: "false", limit: "25" });
  });

  it("reports failures and bad bodies", async () => {
    expect((await collect(healthyReader().on("/v1/events", fail("permission", 403)), { includeEvents: true })).failedEvents).toMatchObject({ reason: "permission" });
    expect((await collect(healthyReader().on("/v1/events", body(5)), { includeEvents: true })).failedEvents).toMatchObject({ reason: "api_error" });
  });
});
