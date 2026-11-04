import { isoDate, daysBetween } from "../time.js";
import { defineRule, failed, notApplicable, passed } from "../rule.js";
import type { CustomerLookup, Subscription } from "../facts.js";
import { plural, sampleIds } from "./support.js";

/** Subscriptions of this status are billed automatically and need a payment method on file. */
function withoutPaymentMethod(subs: readonly Subscription[], lookup: CustomerLookup): { missing: Subscription[]; unchecked: number } {
  const state = new Map(lookup.checked.map((c) => [c.id, c.hasDefaultPaymentMethod]));
  const missing: Subscription[] = [];
  let unchecked = 0;
  for (const s of subs) {
    if (s.collection !== "charge_automatically" || s.hasOwnPaymentMethod || s.customerId === null) continue;
    const has = state.get(s.customerId);
    if (has === undefined) unchecked += 1;
    else if (!has) missing.push(s);
  }
  return { missing, unchecked };
}

function coverage(lookup: CustomerLookup, unchecked: number): string[] {
  return unchecked > 0 || lookup.wanted > lookup.checked.length
    ? [`Payment methods were checked for ${lookup.checked.length} of ${lookup.wanted} customers; the rest were left out by the request cap.`]
    : [];
}

export const paymentMethodMissingOnActive = defineRule({
  id: "customer-no-default-payment-method",
  category: "customers",
  summary: "Active subscriptions that charge automatically have a payment method",
  requires: ["subscriptions", "customers"],
  why: "A subscription set to charge automatically with no default payment method on the subscription or the customer will fail its next renewal. It becomes past_due, costs a failed-payment cycle and often a customer.",
  fix: "Ask these customers to add a payment method (the Billing portal's update-payment-method link works), or switch the subscription to send_invoice if invoicing is intended. Collect the payment method at checkout with setup_future_usage or a Checkout subscription session so it is saved as the default.",
  evaluate({ subscriptions, customers }) {
    const live = subscriptions.filter((s) => s.status === "active" || s.status === "past_due");
    const { missing, unchecked } = withoutPaymentMethod(live, customers);
    if (missing.length === 0) return passed;
    return failed("high", `${plural(missing.length, "subscription")} charge automatically with no payment method on file`, [
      `${plural(missing.length, "subscription")}: ${sampleIds(missing.map((s) => s.id))}.`,
      "Neither the subscription nor its customer has a default payment method or source.",
      ...coverage(customers, unchecked),
    ]);
  },
});

export const trialEndingWithoutPaymentMethod = defineRule({
  id: "trial-ending-without-payment-method",
  category: "customers",
  summary: "Trials that end soon have a payment method",
  requires: ["subscriptions", "customers"],
  why: "When a trial ends with no payment method the first invoice cannot be paid: the customer is cancelled, paused or left past due, depending on the trial settings, at the moment they have just decided to stay.",
  fix: "Collect a payment method before the trial ends (Checkout with payment_method_collection=always, or a reminder email from the customer.subscription.trial_will_end event, sent three days before). Set trial_settings.end_behavior.missing_payment_method deliberately: cancel or pause rather than create_invoice.",
  evaluate({ subscriptions, customers }, ctx) {
    const horizon = ctx.nowSeconds + ctx.thresholds.trialDays * 86_400;
    const soon = subscriptions.filter((s) => s.status === "trialing" && s.trialEnd !== null && s.trialEnd <= horizon);
    if (soon.length === 0) return notApplicable(`no trial ends within ${ctx.thresholds.trialDays} days`);
    const { missing, unchecked } = withoutPaymentMethod(soon, customers);
    if (missing.length === 0) return passed;
    const first = Math.min(...missing.map((s) => s.trialEnd ?? horizon));
    const risky = missing.some((s) => s.trialEndBehavior === "create_invoice" || s.trialEndBehavior === null);
    return failed(risky ? "high" : "medium", `${plural(missing.length, "trial")} ending within ${ctx.thresholds.trialDays} days with no payment method`, [
      `${sampleIds(missing.map((s) => s.id))}; the first ends ${isoDate(first)} (in ${Math.max(0, daysBetween(ctx.nowSeconds, first))} days).`,
      `Behaviour when the trial ends without a payment method: ${[...new Set(missing.map((s) => s.trialEndBehavior ?? "not set (Stripe default: create_invoice)"))].join(", ")}.`,
      ...coverage(customers, unchecked),
    ]);
  },
});
