import { daysBetween, isoDate } from "../time.js";
import { defineRule, failed, notApplicable, passed } from "../rule.js";
import type { Invoice, Subscription } from "../facts.js";
import { atLeast, isBilling, plural, sampleIds } from "./support.js";

const DELINQUENT = ["past_due", "unpaid", "incomplete"] as const;

/** Start of the failure for one subscription, and how we know. */
function failingSince(s: Subscription, openInvoices: readonly Invoice[] | undefined): number | null {
  const oldestOpen = (openInvoices ?? [])
    .filter((i) => i.subscriptionId === s.id && i.created !== null)
    .reduce<number | null>((acc, i) => (acc === null || (i.created as number) < acc ? (i.created as number) : acc), null);
  if (oldestOpen !== null) return oldestOpen;
  return s.status === "incomplete" ? s.created : (s.currentPeriodStart ?? s.created);
}

export const subscriptionDelinquent = defineRule({
  id: "subscription-delinquent",
  category: "subscriptions",
  summary: "No subscription stays past_due, unpaid or incomplete beyond the threshold",
  severity: "high; medium when only incomplete subscriptions are stale",
  requires: ["subscriptions"],
  why: "A subscription that stays in a failing state is revenue you are owed and have not collected, and usually a customer who still has, or has silently lost, access. The longer it lasts the less likely it is recovered.",
  fix: "Decide the end state of failed payments (Dashboard, Billing, Revenue recovery: cancel, mark unpaid or leave past due), contact the customers with the oldest failures, and make the application treat past_due and unpaid explicitly instead of as active. The Billing portal link lets a customer update the card themselves.",
  evaluate({ subscriptions, openInvoices }, ctx) {
    const limit = ctx.thresholds.pastDueDays;
    const stale = subscriptions
      .filter((s) => (DELINQUENT as readonly string[]).includes(s.status))
      .map((s) => ({ s, since: failingSince(s, openInvoices) }))
      .filter((x): x is { s: Subscription; since: number } => x.since !== null && daysBetween(x.since, ctx.nowSeconds) >= limit);
    if (stale.length === 0) return passed;
    const lower = atLeast(ctx.truncated.has("subscriptions"));
    const evidence: string[] = [];
    for (const status of DELINQUENT) {
      const group = stale.filter((x) => x.s.status === status);
      if (group.length === 0) continue;
      const oldest = Math.min(...group.map((x) => x.since));
      evidence.push(`${status}: ${lower}${plural(group.length, "subscription")}, oldest since ${isoDate(oldest)} (${daysBetween(oldest, ctx.nowSeconds)} days): ${sampleIds(group.map((x) => x.s.id))}.`);
    }
    evidence.push(`Threshold: ${limit} days, counted from the oldest open invoice of the subscription, or from the start of its current period when no open invoice was listed (so a lower bound).`);
    const severe = stale.some((x) => x.s.status !== "incomplete");
    return failed(severe ? "high" : "medium", `${lower}${plural(stale.length, "subscription")} failing for ${limit}+ days`, evidence);
  },
});

export const subscriptionCancelWithoutWinback = defineRule({
  id: "subscription-cancel-at-period-end-no-winback",
  category: "subscriptions",
  summary: "Subscriptions set to cancel can be reactivated and their reasons are collected",
  severity: "low without a self-service way back; info when only cancellation reasons are missing",
  requires: ["subscriptions", "portalConfigurations"],
  why: "A customer who has scheduled a cancellation is the cheapest customer to keep. Without a way to undo it themselves, and without the reason they leave, there is nothing to win them back with before the period ends.",
  fix: "Enable cancellation in the Billing portal configuration (customers then see an option to keep their subscription while a cancellation is pending), turn on cancellation reasons, and send a win-back message from the customer.subscription.updated event while cancel_at_period_end is true. The API cannot show whether such a message exists; see --checklist.",
  evaluate({ subscriptions, portalConfigurations }, ctx) {
    const pending = subscriptions.filter((s) => s.cancelAtPeriodEnd && isBilling(s));
    if (pending.length === 0) return notApplicable("no subscription is set to cancel at period end");
    const active = portalConfigurations.filter((c) => c.active);
    const lower = atLeast(ctx.truncated.has("subscriptions"));
    const header = `${lower}${plural(pending.length, "subscription")} set to cancel at period end: ${sampleIds(pending.map((s) => s.id))}.`;
    const ends = pending.map((s) => s.currentPeriodEnd).filter((e): e is number => e !== null);
    const soonest = ends.length > 0 ? `Earliest period end: ${isoDate(Math.min(...ends))}.` : "Period end dates were not available.";
    if (!active.some((c) => c.subscriptionCancel)) {
      return failed("low", "Pending cancellations have no self-service way back", [header, soonest, "No active Billing portal configuration has cancellation enabled, so customers cannot undo a pending cancellation there."]);
    }
    if (!active.some((c) => c.cancellationReasons)) {
      return failed("info", "Pending cancellations, no cancellation reasons collected", [header, soonest, "The Billing portal lets customers cancel but does not ask why, so there is no data to target a win-back offer."]);
    }
    return passed;
  },
});
