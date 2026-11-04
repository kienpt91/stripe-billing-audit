import type { AccountFacts, CustomerLookup, CustomerPaymentState, Fact, FactKey, Facts, TaxSettings, UnreadableReason } from "../domain/facts.js";
import { FACT_LABELS } from "../domain/facts.js";
import { customersToCheck } from "../domain/rules/support.js";
import type { Mode } from "../domain/stripe/key.js";
import {
  PAGE_SIZE,
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
} from "./decode.js";
import { AuthenticationError, type ApiResult, type Clock, type StripeReader } from "./ports.js";

export interface CollectOptions {
  /** Pages of 100 objects read per listing at most. */
  readonly maxPages: number;
  /** Customers looked up for the payment-method checks at most. */
  readonly maxCustomerLookups: number;
  readonly customerLookup: boolean;
  readonly includeEvents: boolean;
}

type Failure = Extract<ApiResult, { ok: false }>;

function unreadable(key: FactKey, reason: UnreadableReason, detail: string): Fact<never> {
  return { status: "unreadable", reason, resource: FACT_LABELS[key], detail };
}

function http(f: Failure): string {
  return f.status === null ? "" : `HTTP ${f.status}`;
}

/** Turns a failed read into the fact that stands in for the resource. A 401 aborts the whole audit. */
function failure(key: FactKey, f: Failure, page: number): Fact<never> {
  const where = page > 1 ? ` (page ${page})` : "";
  const code = f.code === null ? "" : `, ${f.code}`;
  switch (f.kind) {
    case "auth":
      throw new AuthenticationError();
    case "permission":
      return unreadable(key, "permission", `${http(f)}: the key lacks the read permission for this resource${code}${where}`);
    case "not_found":
      return unreadable(key, "not_available", `${http(f)}: not available on this account${where}`);
    case "rate_limited":
      return unreadable(key, "api_error", `${http(f)}: still rate limited after retries${where}`);
    case "server":
      return unreadable(key, "api_error", `${http(f)}: Stripe server error${where}`);
    case "timeout":
      return unreadable(key, "api_error", `request timed out${where}`);
    case "network":
      return unreadable(key, "api_error", `network error${where}`);
    case "malformed":
      return unreadable(key, "api_error", `the response was not valid JSON${where}`);
    case "too_large":
      return unreadable(key, "api_error", `the response was larger than the size limit${where}`);
    case "budget":
      return unreadable(key, "budget", `the request budget was spent${where}`);
    case "refused":
      return unreadable(key, "api_error", `the request was refused by the path allowlist${where}`);
  }
}

/** Reads a listing page by page up to the page cap, decoding every object. */
async function listAll<T extends { readonly id: string }>(
  api: StripeReader,
  key: FactKey,
  path: string,
  query: Readonly<Record<string, string>>,
  decode: (raw: unknown) => T | null,
  maxPages: number,
): Promise<Fact<readonly T[]>> {
  const items = new Map<string, T>();
  let malformed = 0;
  let cursor: string | null = null;
  for (let page = 1; page <= Math.max(1, maxPages); page++) {
    const params: Record<string, string> = { ...query, limit: String(PAGE_SIZE) };
    if (cursor !== null) params.starting_after = cursor;
    const result = await api.get(path, params);
    if (!result.ok) return failure(key, result, page);
    const decoded = decodePage(result.body, decode);
    if (decoded === null) return unreadable(key, "api_error", `unexpected response shape${page > 1 ? ` (page ${page})` : ""}`);
    malformed += decoded.malformed;
    for (const item of decoded.items) items.set(item.id, item);
    if (!decoded.hasMore) return { status: "ok", value: [...items.values()], truncated: false, malformed };
    if (decoded.lastId === null || decoded.lastId === cursor) return unreadable(key, "api_error", "pagination did not advance");
    cursor = decoded.lastId;
  }
  return { status: "ok", value: [...items.values()], truncated: true, malformed };
}

async function readAccount(api: StripeReader): Promise<Fact<AccountFacts>> {
  const result = await api.get("/v1/account");
  if (!result.ok) return failure("account", result, 1);
  return { status: "ok", value: decodeAccount(result.body, result.stripeVersion), truncated: false, malformed: 0 };
}

async function readTaxSettings(api: StripeReader): Promise<Fact<TaxSettings | null>> {
  const result = await api.get("/v1/tax/settings");
  if (!result.ok) {
    // No settings object at all means tax has not been set up on the account.
    if (result.kind === "not_found") return { status: "ok", value: null, truncated: false, malformed: 0 };
    return failure("taxSettings", result, 1);
  }
  const value = decodeTaxSettings(result.body);
  return value === null ? unreadable("taxSettings", "api_error", "unexpected response shape") : { status: "ok", value, truncated: false, malformed: 0 };
}

async function readCustomers(api: StripeReader, ids: readonly string[], cap: number): Promise<Fact<CustomerLookup>> {
  const checked: CustomerPaymentState[] = [];
  let malformed = 0;
  let stopped = false;
  for (const id of ids.slice(0, Math.max(0, cap))) {
    const result = await api.get(`/v1/customers/${id}`);
    if (!result.ok) {
      if (result.kind === "not_found") continue;
      const fact = failure("customers", result, 1);
      if (checked.length === 0 || (fact.status === "unreadable" && fact.reason === "permission")) return fact;
      stopped = true;
      break;
    }
    const customer = decodeCustomer(result.body);
    if (customer === null) malformed += 1;
    else checked.push(customer);
  }
  return { status: "ok", value: { checked, wanted: ids.length }, truncated: stopped || ids.length > cap, malformed };
}

/**
 * Reads everything the checks need, sequentially (kind to rate limits, easy to budget). A resource that
 * cannot be read becomes an `unreadable` fact with the reason; the audit goes on with the rest.
 * @throws AuthenticationError when Stripe rejects the key.
 */
export async function collectFacts(api: StripeReader, clock: Clock, mode: Mode, options: CollectOptions): Promise<Facts> {
  const pages = options.maxPages;
  const account = await readAccount(api);
  const webhookEndpoints = await listAll(api, "webhookEndpoints", "/v1/webhook_endpoints", {}, decodeWebhookEndpoint, pages);
  const subscriptions = await listAll(api, "subscriptions", "/v1/subscriptions", { status: "all" }, decodeSubscription, pages);
  const openInvoices = await listAll(api, "openInvoices", "/v1/invoices", { status: "open" }, decodeInvoice, pages);
  const uncollectibleInvoices = await listAll(api, "uncollectibleInvoices", "/v1/invoices", { status: "uncollectible" }, decodeInvoice, pages);
  const prices = await listAll(api, "prices", "/v1/prices", { active: "true" }, decodePrice, pages);
  const products = await listAll(api, "products", "/v1/products", { active: "true" }, decodeProduct, pages);
  const portalConfigurations = await listAll(api, "portalConfigurations", "/v1/billing_portal/configurations", {}, decodePortalConfiguration, pages);
  const taxSettings = await readTaxSettings(api);
  const taxRegistrations = await listAll(api, "taxRegistrations", "/v1/tax/registrations", { status: "active" }, decodeTaxRegistration, pages);
  const failedEvents: Facts["failedEvents"] = options.includeEvents
    ? await readEvents(api)
    : unreadable("failedEvents", "disabled", "not requested; events can embed personal data, pass --include-events to read them");

  let customers: Facts["customers"];
  if (!options.customerLookup) customers = unreadable("customers", "disabled", "switched off with --skip-customer-lookup");
  else if (subscriptions.status === "unreadable") customers = unreadable("customers", subscriptions.reason, "needs the subscription listing");
  else customers = (await readCustomers(api, customersToCheck(subscriptions.value), options.maxCustomerLookups));

  return {
    mode,
    nowSeconds: clock.nowSeconds(),
    account,
    webhookEndpoints,
    subscriptions,
    openInvoices,
    uncollectibleInvoices,
    prices,
    products,
    portalConfigurations,
    taxSettings,
    taxRegistrations,
    customers,
    failedEvents,
  };
}

async function readEvents(api: StripeReader): Promise<Facts["failedEvents"]> {
  const result = await api.get("/v1/events", { delivery_success: "false", limit: "25" });
  if (!result.ok) return failure("failedEvents", result, 1);
  const page = decodePage(result.body, decodeEvent);
  if (page === null) return unreadable("failedEvents", "api_error", "unexpected response shape");
  return { status: "ok", value: page.items, truncated: page.hasMore, malformed: page.malformed };
}
