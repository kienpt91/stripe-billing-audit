/**
 * Stripe API objects in the shape the real API returns them, including the fields the audit must never
 * keep (emails, names, addresses, secrets). Builders take overrides; `now` is epoch seconds.
 */
const DAY = 86_400;

type Json = Record<string, unknown>;

export interface World {
  now: number;
  livemode: boolean;
  stripeVersion: string | null;
  account: Json;
  webhookEndpoints: Json[];
  subscriptions: Json[];
  invoices: Json[];
  prices: Json[];
  products: Json[];
  portalConfigurations: Json[];
  taxSettings: Json | null;
  taxRegistrations: Json[];
  customers: Record<string, Json>;
  failedEvents: Json[];
}

export function webhookEndpoint(w: { livemode: boolean }, over: Json = {}): Json {
  return {
    id: "we_1QAbCdEfGhIjKlMn",
    object: "webhook_endpoint",
    api_version: null,
    application: null,
    created: 1_700_000_000,
    description: null,
    enabled_events: ["*"],
    livemode: w.livemode,
    metadata: {},
    secret: ["whsec", "NEVERNEVERNEVERNEVERNEVER"].join("_"),
    status: "enabled",
    url: "https://app.example.com/webhooks/stripe",
    ...over,
  };
}

export function subscription(w: { livemode: boolean; now: number }, over: Json = {}): Json {
  return {
    id: "sub_1QAbCdEfGhIjKlMn",
    object: "subscription",
    automatic_tax: { enabled: true, liability: null },
    cancel_at: null,
    cancel_at_period_end: false,
    collection_method: "charge_automatically",
    created: w.now - 100 * DAY,
    currency: "usd",
    customer: "cus_1QAbCdEfGhIjKlMn",
    default_payment_method: "pm_1QAbCdEfGhIjKlMn",
    default_source: null,
    description: "Plan for Jane Doe <jane.doe@example.org>",
    items: {
      object: "list",
      data: [{ id: "si_1QAbCdEfGhIjKlMn", object: "subscription_item", current_period_start: w.now - 10 * DAY, current_period_end: w.now + 20 * DAY, price: { id: "price_1QAbCdEfGhIjKlMn", object: "price", currency: "usd" }, quantity: 1 }],
      has_more: false,
    },
    latest_invoice: "in_1QAbCdEfGhIjKlMn",
    livemode: w.livemode,
    metadata: { buyer_email: "jane.doe@example.org" },
    status: "active",
    trial_end: null,
    trial_settings: { end_behavior: { missing_payment_method: "create_invoice" } },
    ...over,
  };
}

export function invoice(w: { livemode: boolean; now: number }, over: Json = {}): Json {
  return {
    id: "in_1QAbCdEfGhIjKlMn",
    object: "invoice",
    amount_due: 4900,
    attempt_count: 0,
    auto_advance: true,
    collection_method: "charge_automatically",
    created: w.now - 30 * DAY,
    currency: "usd",
    customer: "cus_1QAbCdEfGhIjKlMn",
    customer_email: "jane.doe@example.org",
    customer_name: "Jane Doe",
    customer_address: { line1: "1 Main Street", city: "Springfield" },
    due_date: null,
    livemode: w.livemode,
    next_payment_attempt: w.now + DAY,
    parent: { subscription_details: { subscription: null } },
    status: "open",
    ...over,
  };
}

export function price(w: { livemode: boolean }, over: Json = {}): Json {
  return { id: "price_1QAbCdEfGhIjKlMn", object: "price", active: true, currency: "usd", livemode: w.livemode, product: "prod_1QAbCdEfGhIjKlMn", recurring: { interval: "month", interval_count: 1 }, tax_behavior: "exclusive", type: "recurring", unit_amount: 4900, ...over };
}

export function product(w: { livemode: boolean }, over: Json = {}): Json {
  return { id: "prod_1QAbCdEfGhIjKlMn", object: "product", active: true, livemode: w.livemode, name: "Pro plan", tax_code: "txcd_10103001", ...over };
}

export function portalConfiguration(w: { livemode: boolean }, over: Json = {}): Json {
  return {
    id: "bpc_1QAbCdEfGhIjKlMn",
    object: "billing_portal.configuration",
    active: true,
    business_profile: { headline: null, privacy_policy_url: "https://example.com/privacy", terms_of_service_url: "https://example.com/terms" },
    features: {
      customer_update: { enabled: true },
      invoice_history: { enabled: true },
      payment_method_update: { enabled: true },
      subscription_cancel: { enabled: true, mode: "at_period_end", cancellation_reason: { enabled: true, options: ["too_expensive", "other"] } },
      subscription_update: { enabled: false },
    },
    is_default: true,
    livemode: w.livemode,
    ...over,
  };
}

export function customer(over: Json = {}): Json {
  return {
    id: "cus_1QAbCdEfGhIjKlMn",
    object: "customer",
    address: { line1: "1 Main Street", city: "Springfield", postal_code: "12345" },
    default_source: null,
    email: "jane.doe@example.org",
    invoice_settings: { default_payment_method: "pm_1QAbCdEfGhIjKlMn" },
    name: "Jane Doe",
    phone: "+1 555 0100",
    ...over,
  };
}

export function failedEvent(w: { now: number }, over: Json = {}): Json {
  return { id: "evt_1QAbCdEfGhIjKlMn", object: "event", created: w.now - 2 * DAY, pending_webhooks: 1, type: "invoice.payment_failed", data: { object: { customer_email: "jane.doe@example.org" } }, ...over };
}

/** A healthy subscription business: no finding is expected. */
export function cleanWorld(now: number, livemode = true): World {
  const w = { now, livemode };
  return {
    now,
    livemode,
    stripeVersion: "2025-09-30.clover",
    account: { id: "acct_1QAbCdEfGhIjKlMn", object: "account", country: "US", default_currency: "usd", email: "owner@example.org", business_profile: { name: "Example Inc" } },
    webhookEndpoints: [webhookEndpoint(w)],
    // the canceled subscription is never listed by the API without status=canceled
    subscriptions: [subscription(w), subscription(w, { id: "sub_1CanceledZzzzzzzz", status: "canceled", cancel_at_period_end: true })],
    invoices: [],
    prices: [price(w)],
    products: [product(w)],
    portalConfigurations: [portalConfiguration(w)],
    taxSettings: { object: "tax.settings", status: "active", defaults: { tax_behavior: "exclusive", tax_code: "txcd_10103001" }, livemode },
    taxRegistrations: [{ id: "taxreg_1QAbCdEfGhIjKlMn", object: "tax.registration", country: "US", status: "active" }],
    customers: { cus_1QAbCdEfGhIjKlMn: customer() },
    failedEvents: [],
  };
}

/** The same business with a realistic spread of billing gaps. */
export function troubledWorld(now: number, livemode = true): World {
  const w = { now, livemode };
  const world = cleanWorld(now, livemode);
  return {
    ...world,
    webhookEndpoints: [
      webhookEndpoint(w, { id: "we_1HttpEeeeeeeeeee", url: "http://hooks.example.com/stripe/whsec0123456789abcdefghij?token=abc", enabled_events: ["checkout.session.completed", "invoice.paid"], api_version: "2020-08-27" }),
      webhookEndpoint(w, { id: "we_1OffFffffffffffff", status: "disabled", url: "https://old.example.com/hook" }),
    ],
    subscriptions: [
      subscription(w, { id: "sub_1PastDueAaaaaaaa", status: "past_due", customer: "cus_1PastDueAaaaaaaa", default_payment_method: null, items: { object: "list", data: [{ current_period_start: now - 40 * DAY, current_period_end: now - 10 * DAY, price: { id: "price_1QAbCdEfGhIjKlMn" } }], has_more: false } }),
      subscription(w, { id: "sub_1TrialBbbbbbbbbb", status: "trialing", customer: "cus_1TrialBbbbbbbbbb", default_payment_method: null, trial_end: now + 2 * DAY }),
      subscription(w, { id: "sub_1LeavingCcccccccc", cancel_at_period_end: true }),
      subscription(w, { id: "sub_1UntaxedDdddddddd", automatic_tax: { enabled: false }, currency: "eur" }),
      subscription(w),
    ],
    invoices: [
      invoice(w, { id: "in_1StaleGgggggggggg", created: now - 35 * DAY, parent: { subscription_details: { subscription: "sub_1PastDueAaaaaaaa" } } }),
      invoice(w, { id: "in_1ExhaustedHhhhhhhh", created: now - 5 * DAY, attempt_count: 4, next_payment_attempt: null, auto_advance: false, amount_due: 12_500 }),
      invoice(w, { id: "in_1UncollectibleIiiiii", status: "uncollectible", amount_due: 2_000 }),
    ],
    prices: [price(w, { tax_behavior: "unspecified" }), price(w, { id: "price_1EurIiiiiiiiiiii", currency: "eur" })],
    products: [product(w, { tax_code: null })],
    portalConfigurations: [portalConfiguration(w, { active: false })],
    taxSettings: { object: "tax.settings", status: "pending", status_details: { pending: { missing_fields: ["head_office.address"] } }, defaults: { tax_behavior: null, tax_code: null }, livemode },
    customers: {
      cus_1PastDueAaaaaaaa: customer({ id: "cus_1PastDueAaaaaaaa", invoice_settings: { default_payment_method: null } }),
      cus_1TrialBbbbbbbbbb: customer({ id: "cus_1TrialBbbbbbbbbb", invoice_settings: { default_payment_method: null } }),
    },
    failedEvents: [failedEvent(w), failedEvent(w, { id: "evt_2QAbCdEfGhIjKlMn", type: "customer.subscription.deleted", created: now - 4 * DAY })],
  };
}
