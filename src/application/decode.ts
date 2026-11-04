/**
 * Anti-corruption layer between Stripe's JSON and the domain facts. Every decoder picks the named fields
 * it needs and nothing else, so personal data in a response (emails, names, addresses, phone numbers)
 * is dropped here and cannot reach a report. Wrong types never throw: a field of the wrong type is
 * treated as absent, an object without a valid id is rejected.
 */
import type {
  AccountFacts,
  CustomerPaymentState,
  FailedEvent,
  Invoice,
  InvoiceStatus,
  PortalConfiguration,
  Price,
  Product,
  Subscription,
  SubscriptionStatus,
  TaxBehavior,
  TaxRegistration,
  TaxSettings,
  WebhookEndpoint,
} from "../domain/facts.js";
import { safeUrl, validId } from "../domain/stripe/identifiers.js";

type Json = Record<string, unknown>;

export function record(value: unknown): Json | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Json) : null;
}

function str(value: unknown, pattern: RegExp): string | null {
  return typeof value === "string" && pattern.test(value) ? value : null;
}

function bool(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

/** A Unix timestamp in a plausible range, otherwise null. */
function timestamp(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= 10_000_000_000 ? value : null;
}

function count(value: unknown): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= 1e12 ? value : 0;
}

function present(value: unknown): boolean {
  return (typeof value === "string" && value.length > 0) || record(value) !== null;
}

/** An id that is either a string or an expanded object with an `id`. */
function refId(value: unknown): string | null {
  return validId(value) ?? validId(record(value)?.id);
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T | null {
  return typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : null;
}

const CURRENCY = /^[a-z]{3}$/;
const VERSION = /^\d{4}-\d{2}-\d{2}(\.[a-z]{1,20})?$/;
const EVENT_TYPE = /^[A-Za-z0-9_.*]{1,100}$/;
const FIELD_NAME = /^[A-Za-z0-9_.[\]]{1,80}$/;

export function apiVersion(value: unknown): string | null {
  return str(value, VERSION);
}

export function decodeAccount(raw: unknown, versionHeader: string | null): AccountFacts {
  const o = record(raw) ?? {};
  return {
    id: validId(o.id),
    country: str(o.country, /^[A-Z]{2}$/),
    defaultCurrency: str(o.default_currency, CURRENCY),
    apiVersion: apiVersion(versionHeader),
  };
}

export function decodeWebhookEndpoint(raw: unknown): WebhookEndpoint | null {
  const o = record(raw);
  const id = validId(o?.id);
  if (!o || id === null) return null;
  const events = Array.isArray(o.enabled_events) ? o.enabled_events.slice(0, 300).flatMap((e) => (str(e, EVENT_TYPE) ? [e as string] : [])) : [];
  return {
    id,
    status: oneOf(o.status, ["enabled", "disabled"]) ?? "unknown",
    url: safeUrl(o.url),
    enabledEvents: events,
    apiVersion: apiVersion(o.api_version),
    livemode: bool(o.livemode),
  };
}

export function decodePrice(raw: unknown): Price | null {
  const o = record(raw);
  const id = validId(o?.id);
  if (!o || id === null) return null;
  return {
    id,
    currency: str(o.currency, CURRENCY),
    recurring: record(o.recurring) !== null || o.type === "recurring",
    taxBehavior: oneOf<TaxBehavior>(o.tax_behavior, ["inclusive", "exclusive", "unspecified"]) ?? "unspecified",
    productId: refId(o.product),
    livemode: bool(o.livemode),
  };
}

export function decodeProduct(raw: unknown): Product | null {
  const o = record(raw);
  const id = validId(o?.id);
  if (!o || id === null) return null;
  return { id, hasTaxCode: present(o.tax_code), livemode: bool(o.livemode) };
}

const SUBSCRIPTION_STATUSES: readonly SubscriptionStatus[] = ["incomplete", "incomplete_expired", "trialing", "active", "past_due", "canceled", "unpaid", "paused"];

export function decodeSubscription(raw: unknown): Subscription | null {
  const o = record(raw);
  const id = validId(o?.id);
  if (!o || id === null) return null;
  const items = Array.isArray(record(o.items)?.data) ? (record(o.items)?.data as unknown[]).slice(0, 20) : [];
  const firstItem = record(items[0]);
  const priceIds = items.flatMap((item) => {
    const price = refId(record(item)?.price);
    return price === null ? [] : [price];
  });
  const behavior = oneOf(record(record(o.trial_settings)?.end_behavior)?.missing_payment_method, ["create_invoice", "pause", "cancel"] as const);
  return {
    id,
    status: oneOf(o.status, SUBSCRIPTION_STATUSES) ?? "unknown",
    customerId: refId(o.customer),
    collection: oneOf(o.collection_method, ["charge_automatically", "send_invoice"] as const) ?? "unknown",
    cancelAtPeriodEnd: o.cancel_at_period_end === true,
    cancelAt: timestamp(o.cancel_at),
    // Recent API versions moved the billing period from the subscription to its items.
    currentPeriodStart: timestamp(o.current_period_start) ?? timestamp(firstItem?.current_period_start),
    currentPeriodEnd: timestamp(o.current_period_end) ?? timestamp(firstItem?.current_period_end),
    trialEnd: timestamp(o.trial_end),
    created: timestamp(o.created),
    hasOwnPaymentMethod: present(o.default_payment_method) || present(o.default_source),
    automaticTax: bool(record(o.automatic_tax)?.enabled),
    currency: str(o.currency, CURRENCY),
    priceIds,
    trialEndBehavior: behavior,
    livemode: bool(o.livemode),
  };
}

const INVOICE_STATUSES: readonly InvoiceStatus[] = ["draft", "open", "paid", "uncollectible", "void"];

export function decodeInvoice(raw: unknown): Invoice | null {
  const o = record(raw);
  const id = validId(o?.id);
  if (!o || id === null) return null;
  const subscription = refId(o.subscription) ?? refId(record(record(o.parent)?.subscription_details)?.subscription);
  return {
    id,
    status: oneOf(o.status, INVOICE_STATUSES) ?? "unknown",
    created: timestamp(o.created),
    dueDate: timestamp(o.due_date),
    amountDue: count(o.amount_due),
    currency: str(o.currency, CURRENCY),
    subscriptionId: subscription,
    collection: oneOf(o.collection_method, ["charge_automatically", "send_invoice"] as const) ?? "unknown",
    attemptCount: count(o.attempt_count),
    nextPaymentAttempt: timestamp(o.next_payment_attempt),
    autoAdvance: bool(o.auto_advance),
    livemode: bool(o.livemode),
  };
}

export function decodePortalConfiguration(raw: unknown): PortalConfiguration | null {
  const o = record(raw);
  const id = validId(o?.id);
  if (!o || id === null) return null;
  const features = record(o.features);
  const cancel = record(features?.subscription_cancel);
  const profile = record(o.business_profile);
  return {
    id,
    isDefault: o.is_default === true,
    active: o.active === true,
    paymentMethodUpdate: record(features?.payment_method_update)?.enabled === true,
    subscriptionCancel: cancel?.enabled === true,
    cancellationReasons: record(cancel?.cancellation_reason)?.enabled === true,
    hasPrivacyPolicyUrl: present(profile?.privacy_policy_url),
    hasTermsUrl: present(profile?.terms_of_service_url),
    livemode: bool(o.livemode),
  };
}

export function decodeTaxSettings(raw: unknown): TaxSettings | null {
  const o = record(raw);
  if (!o) return null;
  const pending = record(record(o.status_details)?.pending);
  const missing = Array.isArray(pending?.missing_fields) ? pending.missing_fields.slice(0, 20).flatMap((f) => (str(f, FIELD_NAME) ? [f as string] : [])) : [];
  const defaults = record(o.defaults);
  return {
    status: oneOf(o.status, ["active", "pending"] as const) ?? "unknown",
    missingFields: missing,
    hasDefaultTaxBehavior: oneOf(defaults?.tax_behavior, ["inclusive", "exclusive"] as const) !== null,
    hasDefaultTaxCode: present(defaults?.tax_code),
    livemode: bool(o.livemode),
  };
}

export function decodeTaxRegistration(raw: unknown): TaxRegistration | null {
  const o = record(raw);
  const id = validId(o?.id);
  return !o || id === null ? null : { id, country: str(o.country, /^[A-Z]{2}$/) };
}

/** Only whether a default payment method exists. Name, email, address and phone are never read. */
export function decodeCustomer(raw: unknown): CustomerPaymentState | null {
  const o = record(raw);
  const id = validId(o?.id);
  if (!o || id === null) return null;
  return { id, hasDefaultPaymentMethod: present(record(o.invoice_settings)?.default_payment_method) || present(o.default_source) };
}

/** Only the type, time and delivery counter. The event payload (`data`) is never read. */
export function decodeEvent(raw: unknown): FailedEvent | null {
  const o = record(raw);
  const id = validId(o?.id);
  const type = str(o?.type, EVENT_TYPE);
  if (!o || id === null || type === null) return null;
  return { id, type, created: timestamp(o.created), pendingWebhooks: count(o.pending_webhooks) };
}

export interface DecodedPage<T> {
  readonly items: readonly T[];
  readonly malformed: number;
  readonly hasMore: boolean;
  /** Id of the last raw object, the cursor for the next page. */
  readonly lastId: string | null;
}

export const PAGE_SIZE = 100;

/** Decodes a Stripe list envelope; null when the body is not one. */
export function decodePage<T>(body: unknown, decode: (raw: unknown) => T | null): DecodedPage<T> | null {
  const o = record(body);
  if (!o || !Array.isArray(o.data)) return null;
  const raw = o.data.slice(0, PAGE_SIZE);
  const items: T[] = [];
  let malformed = 0;
  for (const entry of raw) {
    const item = decode(entry);
    if (item === null) malformed += 1;
    else items.push(item);
  }
  return { items, malformed, hasMore: o.has_more === true, lastId: validId(record(raw[raw.length - 1])?.id) };
}
