import type {
  AccountFacts,
  Fact,
  FactKey,
  FactValues,
  Facts,
  Invoice,
  PortalConfiguration,
  Price,
  Product,
  Subscription,
  TaxSettings,
  WebhookEndpoint,
} from "../../src/domain/facts.js";
import { safeUrl } from "../../src/domain/stripe/identifiers.js";
import type { Thresholds } from "../../src/domain/rule.js";

/** 2026-10-26T07:33:20Z */
export const NOW = 1_793_000_000;
export const DAY = 86_400;

export const THRESHOLDS: Thresholds = { pastDueDays: 7, trialDays: 7, staleInvoiceDays: 14 };

export function ok<T>(value: T, extra: { truncated?: boolean; malformed?: number } = {}): Fact<T> {
  return { status: "ok", value, truncated: extra.truncated ?? false, malformed: extra.malformed ?? 0 };
}

export function unreadable(reason: "permission" | "not_available" | "api_error" | "budget" | "disabled", resource = "things", detail = "HTTP 403"): Fact<never> {
  return { status: "unreadable", reason, resource, detail };
}

export function endpoint(over: Partial<WebhookEndpoint> = {}): WebhookEndpoint {
  return {
    id: "we_1AbCdEfGhIjKl",
    status: "enabled",
    url: safeUrl("https://app.example.com/webhooks/stripe"),
    enabledEvents: ["*"],
    apiVersion: null,
    livemode: true,
    ...over,
  };
}

export function sub(over: Partial<Subscription> = {}): Subscription {
  return {
    id: "sub_1AbCdEfGhIjKl",
    status: "active",
    customerId: "cus_1AbCdEfGhIjKl",
    collection: "charge_automatically",
    cancelAtPeriodEnd: false,
    cancelAt: null,
    currentPeriodStart: NOW - 10 * DAY,
    currentPeriodEnd: NOW + 20 * DAY,
    trialEnd: null,
    created: NOW - 100 * DAY,
    hasOwnPaymentMethod: true,
    automaticTax: true,
    currency: "usd",
    priceIds: ["price_1AbCdEfGhIjKl"],
    trialEndBehavior: null,
    livemode: true,
    ...over,
  };
}

export function invoice(over: Partial<Invoice> = {}): Invoice {
  return {
    id: "in_1AbCdEfGhIjKl",
    status: "open",
    created: NOW - 30 * DAY,
    dueDate: null,
    amountDue: 4900,
    currency: "usd",
    subscriptionId: null,
    collection: "charge_automatically",
    attemptCount: 0,
    nextPaymentAttempt: NOW + DAY,
    autoAdvance: true,
    livemode: true,
    ...over,
  };
}

export function price(over: Partial<Price> = {}): Price {
  return { id: "price_1AbCdEfGhIjKl", currency: "usd", recurring: true, taxBehavior: "exclusive", productId: "prod_1AbCdEfGhIjKl", livemode: true, ...over };
}

export function product(over: Partial<Product> = {}): Product {
  return { id: "prod_1AbCdEfGhIjKl", hasTaxCode: true, livemode: true, ...over };
}

export function portal(over: Partial<PortalConfiguration> = {}): PortalConfiguration {
  return {
    id: "bpc_1AbCdEfGhIjKl",
    isDefault: true,
    active: true,
    paymentMethodUpdate: true,
    subscriptionCancel: true,
    cancellationReasons: true,
    hasPrivacyPolicyUrl: true,
    hasTermsUrl: true,
    livemode: true,
    ...over,
  };
}

export function taxSettings(over: Partial<TaxSettings> = {}): TaxSettings {
  return { status: "active", missingFields: [], hasDefaultTaxBehavior: true, hasDefaultTaxCode: true, livemode: true, ...over };
}

export function account(over: Partial<AccountFacts> = {}): AccountFacts {
  return { id: "acct_1AbCdEfGhIjKl", country: "US", defaultCurrency: "usd", apiVersion: "2025-09-30.clover", ...over };
}

/** A healthy subscription business: every check passes or does not apply. */
export function cleanValues(): FactValues {
  return {
    account: account(),
    webhookEndpoints: [endpoint()],
    subscriptions: [sub()],
    openInvoices: [],
    uncollectibleInvoices: [],
    prices: [price()],
    products: [product()],
    portalConfigurations: [portal()],
    taxSettings: taxSettings(),
    taxRegistrations: [{ id: "taxreg_1AbCdEfGhIjKl", country: "US" }],
    customers: { checked: [], wanted: 0 },
    failedEvents: [],
  };
}

export function facts(over: { [K in FactKey]?: Fact<FactValues[K]> } & { mode?: "live" | "test" } = {}): Facts {
  const v = cleanValues();
  const base = Object.fromEntries((Object.keys(v) as FactKey[]).map((k) => [k, ok(v[k])])) as { [K in FactKey]: Fact<FactValues[K]> };
  return { ...base, mode: "live", nowSeconds: NOW, ...over } as Facts;
}
