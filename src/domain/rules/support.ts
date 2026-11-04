import type { FactValues, Subscription } from "../facts.js";
import { shortId } from "../stripe/identifiers.js";

/** `sub_1Abc…, sub_2Def… (+7 more)`. */
export function sampleIds(ids: readonly string[], max = 5): string {
  const shown = ids.slice(0, max).map(shortId).join(", ");
  return ids.length > max ? `${shown} (+${ids.length - max} more)` : shown;
}

/** `at least ` when the listing was cut at a cap, so a count is not mistaken for a total. */
export function atLeast(truncated: boolean): string {
  return truncated ? "at least " : "";
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** A subscription that is, or is about to be, billed. */
export function isBilling(s: Subscription): boolean {
  return s.status === "active" || s.status === "trialing" || s.status === "past_due";
}

/** Subscriptions that are live right now (billing or already failing). */
export function isLive(s: Subscription): boolean {
  return s.status === "active" || s.status === "trialing" || s.status === "past_due" || s.status === "unpaid";
}

/**
 * Whether this looks like a subscription business: there are subscriptions or recurring prices. When
 * neither listing could be read the check assumes it does, because it is the audit's purpose.
 */
export function isSubscriptionBusiness(data: Partial<FactValues>): boolean {
  if (data.subscriptions === undefined && data.prices === undefined) return true;
  return (data.subscriptions?.length ?? 0) > 0 || (data.prices?.some((p) => p.recurring) ?? false);
}

/** Customers whose default payment method has to be looked up to judge a subscription. */
export function customersToCheck(subscriptions: readonly Subscription[]): string[] {
  const ids = new Set<string>();
  for (const s of subscriptions) {
    if (isBilling(s) && s.collection === "charge_automatically" && !s.hasOwnPaymentMethod && s.customerId !== null) ids.add(s.customerId);
  }
  return [...ids];
}
