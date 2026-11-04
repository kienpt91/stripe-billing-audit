import type { Rule } from "../rule.js";
import { paymentMethodMissingOnActive, trialEndingWithoutPaymentMethod } from "./customers.js";
import { subscriptionCancelWithoutWinback, subscriptionDelinquent } from "./subscriptions.js";
import { dunningRetriesExhausted, invoiceStuckOpen, invoiceUncollectible } from "./invoices.js";
import { portalMissing, portalNoCancellation, portalNoLegalLinks, portalNoPaymentMethodUpdate } from "./portal.js";
import { taxAutomaticDisabled, taxBehaviorUnspecified, taxProductCodeMissing, taxSettingsIncomplete } from "./tax.js";
import {
  webhookApiVersionDrift,
  webhookDeliveriesFailing,
  webhookDevelopmentUrl,
  webhookDuplicateUrls,
  webhookEndpointDisabled,
  webhookEndpointHttp,
  webhookLifecycleEventsMissing,
  webhookNoneEnabled,
} from "./webhooks.js";

/** Every check, in report order. Adding a rule means adding it here and documenting it in docs/checks.md. */
export const RULES: readonly Rule[] = [
  webhookNoneEnabled,
  webhookEndpointDisabled,
  webhookLifecycleEventsMissing,
  webhookEndpointHttp,
  webhookApiVersionDrift,
  webhookDuplicateUrls,
  webhookDevelopmentUrl,
  webhookDeliveriesFailing,
  subscriptionDelinquent,
  subscriptionCancelWithoutWinback,
  paymentMethodMissingOnActive,
  trialEndingWithoutPaymentMethod,
  invoiceStuckOpen,
  invoiceUncollectible,
  dunningRetriesExhausted,
  portalMissing,
  portalNoPaymentMethodUpdate,
  portalNoCancellation,
  portalNoLegalLinks,
  taxAutomaticDisabled,
  taxSettingsIncomplete,
  taxBehaviorUnspecified,
  taxProductCodeMissing,
];
