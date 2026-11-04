import type { Mode } from "./stripe/key.js";
import type { SafeUrl } from "./stripe/identifiers.js";

/** Why a resource could not be read. Only `permission` and `api_error`/`budget` change the exit code. */
export type UnreadableReason = "permission" | "not_available" | "api_error" | "budget" | "disabled";

/** Why a fact covers only part of what exists. */
export type PartialCause = "cap" | "api_error" | "budget";

export interface PartialCoverage {
  readonly cause: PartialCause;
  /** What was examined and what was not, for the report. */
  readonly detail: string;
}

export type Fact<T> =
  | {
      readonly status: "ok";
      readonly value: T;
      /**
       * Null when everything that exists was read. Otherwise the value is a slice, and a rule that finds
       * nothing in it cannot say the rest is fine: the check is reported as inconclusive.
       */
      readonly partial: PartialCoverage | null;
      /** Objects whose shape was not understood and that were left out. */
      readonly malformed: number;
    }
  | {
      readonly status: "unreadable";
      readonly reason: UnreadableReason;
      /** Human label of the resource, for example "webhook endpoints". */
      readonly resource: string;
      readonly detail: string;
    };

export interface AccountFacts {
  readonly id: string | null;
  readonly country: string | null;
  readonly defaultCurrency: string | null;
  /** The API version the account uses by default, from the `Stripe-Version` response header. */
  readonly apiVersion: string | null;
}

export interface WebhookEndpoint {
  readonly id: string;
  readonly status: "enabled" | "disabled" | "unknown";
  readonly url: SafeUrl | null;
  readonly enabledEvents: readonly string[];
  /** Null when the endpoint follows the account default version. */
  readonly apiVersion: string | null;
  readonly livemode: boolean | null;
}

export type TaxBehavior = "inclusive" | "exclusive" | "unspecified";

export interface Price {
  readonly id: string;
  readonly currency: string | null;
  readonly recurring: boolean;
  readonly taxBehavior: TaxBehavior;
  readonly productId: string | null;
  readonly livemode: boolean | null;
}

export interface Product {
  readonly id: string;
  readonly hasTaxCode: boolean;
  readonly livemode: boolean | null;
}

export type SubscriptionStatus = "incomplete" | "incomplete_expired" | "trialing" | "active" | "past_due" | "canceled" | "unpaid" | "paused" | "unknown";

export interface Subscription {
  readonly id: string;
  readonly status: SubscriptionStatus;
  readonly customerId: string | null;
  readonly collection: "charge_automatically" | "send_invoice" | "unknown";
  readonly cancelAtPeriodEnd: boolean;
  readonly cancelAt: number | null;
  readonly currentPeriodStart: number | null;
  readonly currentPeriodEnd: number | null;
  readonly trialEnd: number | null;
  readonly created: number | null;
  /** The subscription itself (not the customer) has a default payment method or source. */
  readonly hasOwnPaymentMethod: boolean;
  readonly automaticTax: boolean | null;
  readonly currency: string | null;
  readonly priceIds: readonly string[];
  readonly trialEndBehavior: "create_invoice" | "pause" | "cancel" | null;
  readonly livemode: boolean | null;
}

export type InvoiceStatus = "draft" | "open" | "paid" | "uncollectible" | "void" | "unknown";

export interface Invoice {
  readonly id: string;
  readonly status: InvoiceStatus;
  readonly created: number | null;
  readonly dueDate: number | null;
  readonly amountDue: number;
  readonly currency: string | null;
  readonly subscriptionId: string | null;
  readonly collection: "charge_automatically" | "send_invoice" | "unknown";
  readonly attemptCount: number;
  readonly nextPaymentAttempt: number | null;
  readonly autoAdvance: boolean | null;
  readonly livemode: boolean | null;
}

export interface PortalConfiguration {
  readonly id: string;
  readonly isDefault: boolean;
  readonly active: boolean;
  readonly paymentMethodUpdate: boolean;
  readonly subscriptionCancel: boolean;
  readonly cancellationReasons: boolean;
  readonly hasPrivacyPolicyUrl: boolean;
  readonly hasTermsUrl: boolean;
  readonly livemode: boolean | null;
}

export interface TaxSettings {
  readonly status: "active" | "pending" | "unknown";
  readonly missingFields: readonly string[];
  readonly hasDefaultTaxBehavior: boolean;
  readonly hasDefaultTaxCode: boolean;
  readonly livemode: boolean | null;
}

export interface TaxRegistration {
  readonly id: string;
  readonly country: string | null;
}

/** What is known about a customer, and nothing personal: only whether a default payment method exists. */
export interface CustomerPaymentState {
  readonly id: string;
  readonly hasDefaultPaymentMethod: boolean;
}

export interface CustomerLookup {
  readonly checked: readonly CustomerPaymentState[];
  /** Customers that would have needed a lookup; larger than `checked.length` when a cap stopped it. */
  readonly wanted: number;
}

export interface FailedEvent {
  readonly id: string;
  readonly type: string;
  readonly created: number | null;
  readonly pendingWebhooks: number;
}

export interface FactValues {
  readonly account: AccountFacts;
  readonly webhookEndpoints: readonly WebhookEndpoint[];
  readonly subscriptions: readonly Subscription[];
  readonly openInvoices: readonly Invoice[];
  readonly uncollectibleInvoices: readonly Invoice[];
  readonly prices: readonly Price[];
  readonly products: readonly Product[];
  readonly portalConfigurations: readonly PortalConfiguration[];
  readonly taxSettings: TaxSettings | null;
  readonly taxRegistrations: readonly TaxRegistration[];
  readonly customers: CustomerLookup;
  readonly failedEvents: readonly FailedEvent[];
}

export type FactKey = keyof FactValues;

export const FACT_KEYS: readonly FactKey[] = [
  "account",
  "webhookEndpoints",
  "subscriptions",
  "openInvoices",
  "uncollectibleInvoices",
  "prices",
  "products",
  "portalConfigurations",
  "taxSettings",
  "taxRegistrations",
  "customers",
  "failedEvents",
];

export type Facts = { readonly [K in FactKey]: Fact<FactValues[K]> } & {
  readonly mode: Mode;
  /** Epoch seconds at which the audit ran. */
  readonly nowSeconds: number;
};

/** Labels used in reports for each resource. */
export const FACT_LABELS: Readonly<Record<FactKey, string>> = {
  account: "account",
  webhookEndpoints: "webhook endpoints",
  subscriptions: "subscriptions",
  openInvoices: "open invoices",
  uncollectibleInvoices: "uncollectible invoices",
  prices: "prices",
  products: "products",
  portalConfigurations: "billing portal configurations",
  taxSettings: "tax settings",
  taxRegistrations: "tax registrations",
  customers: "customer payment state",
  failedEvents: "events with failed webhook deliveries",
};
