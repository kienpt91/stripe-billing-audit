import { describe, expect, it } from "vitest";
import {
  PAGE_SIZE,
  apiVersion,
  decodeAccount,
  decodeCustomer,
  decodeEvent,
  decodeInvoice,
  decodePage,
  decodePortalConfiguration,
  decodePrice,
  decodeProduct,
  decodeSubscription,
  decodeTaxRegistration,
  decodeTaxSettings,
  decodeWebhookEndpoint,
  record,
} from "../../src/application/decode.js";
import { hostileString, prng } from "../support/prng.js";

const decoders = [decodeWebhookEndpoint, decodePrice, decodeProduct, decodeSubscription, decodeInvoice, decodePortalConfiguration, decodeTaxRegistration, decodeCustomer, decodeEvent] as const;

describe("decoders reject what they cannot trust", () => {
  it("return null for non-objects and objects without a valid id", () => {
    for (const decode of decoders) {
      for (const input of [null, undefined, 5, "x", [], {}, { id: 5 }, { id: "bad id" }, { id: "\u001b[31m" }]) expect(decode(input)).toBeNull();
    }
    expect(decodeTaxSettings(null)).toBeNull();
    expect(decodeTaxSettings([])).toBeNull();
  });

  it("never throw on hostile or random input (property)", () => {
    const rand = prng(21);
    const keys = ["id", "status", "url", "enabled_events", "items", "customer", "data", "features", "business_profile", "automatic_tax", "default_source", "trial_settings", "parent", "type"];
    for (let i = 0; i < 400; i++) {
      const obj: Record<string, unknown> = { id: rand() < 0.8 ? `x_${hostileString(rand, 6).replace(/\W/g, "a")}` : hostileString(rand) };
      for (const k of keys) {
        const roll = rand();
        obj[k] = roll < 0.2 ? hostileString(rand) : roll < 0.4 ? Math.floor(rand() * 1e15) : roll < 0.5 ? [hostileString(rand), null, {}] : roll < 0.6 ? { enabled: hostileString(rand), data: [null, 1, {}], id: hostileString(rand) } : roll < 0.7 ? null : undefined;
      }
      for (const decode of decoders) expect(() => decode(obj)).not.toThrow();
      expect(() => decodeAccount(obj, hostileString(rand))).not.toThrow();
      expect(() => decodeTaxSettings(obj)).not.toThrow();
    }
  });
});

describe("decodeAccount", () => {
  it("keeps the id, country, currency and the validated version header", () => {
    expect(decodeAccount({ id: "acct_1Abc", country: "DE", default_currency: "eur", email: "owner@example.com" }, "2025-09-30.clover")).toEqual({
      id: "acct_1Abc",
      country: "DE",
      defaultCurrency: "eur",
      apiVersion: "2025-09-30.clover",
    });
  });

  it("drops malformed values", () => {
    expect(decodeAccount({ id: 5, country: "Germany", default_currency: "EURO" }, "latest; rm -rf")).toEqual({ id: null, country: null, defaultCurrency: null, apiVersion: null });
    expect(decodeAccount("junk", null).id).toBeNull();
    expect(apiVersion("2020-08-27")).toBe("2020-08-27");
    expect(apiVersion("2020-8-27")).toBeNull();
  });
});

describe("decodeWebhookEndpoint", () => {
  it("decodes the fields and drops the secret", () => {
    const e = decodeWebhookEndpoint({
      id: "we_1Abc",
      status: "enabled",
      url: "https://user:pw@hooks.example.com/stripe/s3cretsecretsecretsecret?token=x",
      enabled_events: ["invoice.paid", "*", "bad event", 5, "x".repeat(200)],
      api_version: "2020-08-27",
      livemode: true,
      secret: ["whsec", "x".repeat(24)].join("_"),
    });
    expect(e).toMatchObject({ id: "we_1Abc", status: "enabled", enabledEvents: ["invoice.paid", "*"], apiVersion: "2020-08-27", livemode: true });
    expect(e?.url?.display).toBe("https://hooks.example.com/stripe/…");
    expect(JSON.stringify(e)).not.toContain("whsec_");
  });

  it("falls back for unknown status, bad URL and wrong list type, and caps the event list", () => {
    expect(decodeWebhookEndpoint({ id: "we_1", status: "weird", url: "nope", enabled_events: "invoice.paid", livemode: "yes" })).toMatchObject({ status: "unknown", url: null, enabledEvents: [], livemode: null });
    expect(decodeWebhookEndpoint({ id: "we_1", enabled_events: Array.from({ length: 1000 }, () => "a.b") })?.enabledEvents).toHaveLength(300);
  });
});

describe("decodePrice and decodeProduct", () => {
  it("reads recurrence from the recurring object or the type, currency, tax behavior and product", () => {
    expect(decodePrice({ id: "price_1", currency: "usd", recurring: { interval: "month" }, tax_behavior: "inclusive", product: "prod_1", livemode: false })).toEqual({
      id: "price_1",
      currency: "usd",
      recurring: true,
      taxBehavior: "inclusive",
      productId: "prod_1",
      livemode: false,
    });
    expect(decodePrice({ id: "price_2", type: "recurring", product: { id: "prod_2" } })).toMatchObject({ recurring: true, taxBehavior: "unspecified", productId: "prod_2", currency: null });
    expect(decodePrice({ id: "price_3", type: "one_time", tax_behavior: "weird" })).toMatchObject({ recurring: false, taxBehavior: "unspecified" });
  });

  it("notes only whether a product has a tax code", () => {
    expect(decodeProduct({ id: "prod_1", tax_code: "txcd_10000000", name: "Secret product" })).toEqual({ id: "prod_1", hasTaxCode: true, livemode: null });
    expect(decodeProduct({ id: "prod_2", tax_code: null })?.hasTaxCode).toBe(false);
    expect(decodeProduct({ id: "prod_3", tax_code: "" })?.hasTaxCode).toBe(false);
  });
});

describe("decodeSubscription", () => {
  const raw = {
    id: "sub_1Abc",
    status: "past_due",
    customer: "cus_1Abc",
    collection_method: "charge_automatically",
    cancel_at_period_end: true,
    cancel_at: 1_800_000_000,
    created: 1_700_000_000,
    trial_end: 1_750_000_000,
    default_payment_method: "pm_1Abc",
    automatic_tax: { enabled: true },
    currency: "usd",
    items: { data: [{ price: { id: "price_1Abc" }, current_period_start: 1_790_000_000, current_period_end: 1_792_600_000 }, { price: "price_2Abc" }] },
    trial_settings: { end_behavior: { missing_payment_method: "cancel" } },
    livemode: true,
    description: "Jane Doe's plan",
  };

  it("decodes the fields, reading the period from the first item on recent API versions", () => {
    expect(decodeSubscription(raw)).toEqual({
      id: "sub_1Abc",
      status: "past_due",
      customerId: "cus_1Abc",
      collection: "charge_automatically",
      cancelAtPeriodEnd: true,
      cancelAt: 1_800_000_000,
      currentPeriodStart: 1_790_000_000,
      currentPeriodEnd: 1_792_600_000,
      trialEnd: 1_750_000_000,
      created: 1_700_000_000,
      hasOwnPaymentMethod: true,
      automaticTax: true,
      currency: "usd",
      priceIds: ["price_1Abc", "price_2Abc"],
      trialEndBehavior: "cancel",
      livemode: true,
    });
  });

  it("prefers the subscription-level period and accepts an expanded customer and a default source", () => {
    const s = decodeSubscription({ ...raw, current_period_start: 5, current_period_end: 6, customer: { id: "cus_2Abc", email: "x@example.com" }, default_payment_method: null, default_source: "card_1" });
    expect(s).toMatchObject({ currentPeriodStart: 5, currentPeriodEnd: 6, customerId: "cus_2Abc", hasOwnPaymentMethod: true });
    expect(JSON.stringify(s)).not.toContain("example.com");
  });

  it("falls back for unknown values and out-of-range numbers", () => {
    const s = decodeSubscription({ id: "sub_1", status: "mystery", created: -5, trial_end: 1e18, cancel_at_period_end: "yes", automatic_tax: { enabled: "true" }, items: { data: "x" } });
    expect(s).toMatchObject({ status: "unknown", created: null, trialEnd: null, cancelAtPeriodEnd: false, automaticTax: null, priceIds: [], collection: "unknown", hasOwnPaymentMethod: false });
  });
});

describe("decodeInvoice", () => {
  it("reads the subscription from either API shape and drops customer data", () => {
    const base = { id: "in_1Abc", status: "open", created: 1_700_000_000, due_date: null, amount_due: 4900, currency: "usd", collection_method: "charge_automatically", attempt_count: 3, next_payment_attempt: null, auto_advance: false, livemode: true, customer_email: "a@example.com", customer_name: "Jane" };
    const old = decodeInvoice({ ...base, subscription: "sub_1Abc" });
    const recent = decodeInvoice({ ...base, parent: { subscription_details: { subscription: "sub_2Abc" } } });
    expect(old).toMatchObject({ subscriptionId: "sub_1Abc", amountDue: 4900, attemptCount: 3, nextPaymentAttempt: null, autoAdvance: false });
    expect(recent?.subscriptionId).toBe("sub_2Abc");
    expect(JSON.stringify([old, recent])).not.toMatch(/example\.com|Jane/);
  });

  it("zeroes absurd amounts and counts", () => {
    expect(decodeInvoice({ id: "in_1", amount_due: 1e30, attempt_count: -1, status: "weird" })).toMatchObject({ amountDue: 0, attemptCount: 0, status: "unknown", subscriptionId: null });
  });
});

describe("decodePortalConfiguration, tax and customers and events", () => {
  it("reads the portal features that matter", () => {
    const c = decodePortalConfiguration({
      id: "bpc_1",
      is_default: true,
      active: true,
      features: { payment_method_update: { enabled: true }, subscription_cancel: { enabled: true, cancellation_reason: { enabled: false } } },
      business_profile: { privacy_policy_url: "https://example.com/privacy", terms_of_service_url: null },
      livemode: false,
    });
    expect(c).toEqual({ id: "bpc_1", isDefault: true, active: true, paymentMethodUpdate: true, subscriptionCancel: true, cancellationReasons: false, hasPrivacyPolicyUrl: true, hasTermsUrl: false, livemode: false });
    expect(decodePortalConfiguration({ id: "bpc_2" })).toMatchObject({ isDefault: false, active: false, paymentMethodUpdate: false });
  });

  it("reads tax settings and registrations", () => {
    expect(decodeTaxSettings({ status: "pending", status_details: { pending: { missing_fields: ["head_office.address", "bad field!"] } }, defaults: { tax_behavior: "inclusive", tax_code: null }, livemode: true })).toEqual({
      status: "pending",
      missingFields: ["head_office.address"],
      hasDefaultTaxBehavior: true,
      hasDefaultTaxCode: false,
      livemode: true,
    });
    expect(decodeTaxSettings({ status: "other", defaults: { tax_behavior: "inferred_by_currency" } })).toMatchObject({ status: "unknown", hasDefaultTaxBehavior: false });
    expect(decodeTaxRegistration({ id: "taxreg_1", country: "DE", state: "x" })).toEqual({ id: "taxreg_1", country: "DE" });
  });

  it("keeps only the default payment method state of a customer", () => {
    const raw = { id: "cus_1Abc", email: "jane@example.com", name: "Jane Doe", phone: "+1 555", address: { line1: "1 Main" }, invoice_settings: { default_payment_method: "pm_1" } };
    const c = decodeCustomer(raw);
    expect(c).toEqual({ id: "cus_1Abc", hasDefaultPaymentMethod: true });
    expect(JSON.stringify(c)).not.toMatch(/jane|555|Main/i);
    expect(decodeCustomer({ id: "cus_2", default_source: "card_1" })?.hasDefaultPaymentMethod).toBe(true);
    expect(decodeCustomer({ id: "cus_3", invoice_settings: { default_payment_method: null } })?.hasDefaultPaymentMethod).toBe(false);
  });

  it("keeps the type, time and counter of an event and never its payload", () => {
    const e = decodeEvent({ id: "evt_1", type: "invoice.paid", created: 1_700_000_000, pending_webhooks: 2, data: { object: { customer_email: "a@example.com" } } });
    expect(e).toEqual({ id: "evt_1", type: "invoice.paid", created: 1_700_000_000, pendingWebhooks: 2 });
    expect(decodeEvent({ id: "evt_1", type: "bad type!" })).toBeNull();
  });
});

describe("decodePage", () => {
  const decode = (raw: unknown) => (record(raw)?.id === "ok" ? { id: "x_ok" } : null);

  it("counts malformed items, reads has_more strictly and reports the cursor", () => {
    const page = decodePage({ object: "list", data: [{ id: "ok" }, { id: "bad" }, 7], has_more: "true" }, decode);
    expect(page).toEqual({ items: [{ id: "x_ok" }], malformed: 2, hasMore: false, lastId: null });
    expect(decodePage({ data: [{ id: "sub_1" }], has_more: true }, () => ({ id: "x" }))).toMatchObject({ hasMore: true, lastId: "sub_1" });
  });

  it("rejects non-list bodies and ignores objects beyond the page size", () => {
    for (const body of [null, "x", [], {}, { data: "x" }]) expect(decodePage(body, decode)).toBeNull();
    const huge = decodePage({ data: Array.from({ length: PAGE_SIZE + 50 }, () => ({ id: "ok" })) }, decode);
    expect(huge?.items).toHaveLength(PAGE_SIZE);
  });
});
