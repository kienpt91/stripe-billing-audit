import { daysBetween, isoDate } from "../time.js";
import { defineRule, failed, passed } from "../rule.js";
import { totalsByCurrency } from "../money.js";
import { atLeast, plural, sampleIds } from "./support.js";

export const invoiceStuckOpen = defineRule({
  id: "invoice-stuck-open",
  category: "invoices",
  summary: "No invoice stays open beyond the threshold",
  requires: ["openInvoices"],
  why: "An open invoice that nobody pays and nothing closes is revenue that is neither collected nor written off. It keeps the customer past due, inflates receivables and hides failed payment flows.",
  fix: "Follow up with the customer (the hosted invoice page has a pay button), retry or collect the payment, or void or mark the invoice uncollectible if it will not be paid. Add an alert for invoices open longer than your collection policy.",
  evaluate({ openInvoices }, ctx) {
    const limit = ctx.thresholds.staleInvoiceDays;
    const stale = openInvoices.filter((i) => {
      const reference = i.dueDate ?? i.created;
      return reference !== null && daysBetween(reference, ctx.nowSeconds) >= limit;
    });
    if (stale.length === 0) return passed;
    const lower = atLeast(ctx.truncated.has("openInvoices"));
    const oldest = Math.min(...stale.map((i) => i.dueDate ?? i.created ?? ctx.nowSeconds));
    return failed("medium", `${lower}${plural(stale.length, "invoice")} open for ${limit}+ days`, [
      `${lower}${plural(stale.length, "invoice")}, total due ${totalsByCurrency(stale.map((i) => ({ amount: i.amountDue, currency: i.currency })))}: ${sampleIds(stale.map((i) => i.id))}.`,
      `Oldest reference date: ${isoDate(oldest)} (${daysBetween(oldest, ctx.nowSeconds)} days), counted from the due date, or the creation date when there is none.`,
    ]);
  },
});

export const invoiceUncollectible = defineRule({
  id: "invoice-uncollectible",
  category: "invoices",
  summary: "No invoice is marked uncollectible",
  requires: ["uncollectibleInvoices"],
  why: "Uncollectible invoices are written-off revenue. A growing count points to a failed-payment process that gives up too early, or to customers who keep access without paying.",
  fix: "Review why these invoices could not be collected, whether the customers still have access, and whether the retry and cancellation settings need to change. Mark an invoice paid if it was settled out of band.",
  evaluate({ uncollectibleInvoices }, ctx) {
    if (uncollectibleInvoices.length === 0) return passed;
    const lower = atLeast(ctx.truncated.has("uncollectibleInvoices"));
    return failed("low", `${lower}${plural(uncollectibleInvoices.length, "invoice")} marked uncollectible`, [
      `Total ${totalsByCurrency(uncollectibleInvoices.map((i) => ({ amount: i.amountDue, currency: i.currency })))}: ${sampleIds(uncollectibleInvoices.map((i) => i.id))}.`,
    ]);
  },
});

export const dunningRetriesExhausted = defineRule({
  id: "dunning-retries-exhausted",
  category: "invoices",
  summary: "No automatically charged invoice is left open after its retries ended",
  requires: ["openInvoices"],
  why: "An invoice that was attempted, has no next attempt scheduled and is still open is out of retries and out of sight: Stripe will not try again and nothing else is going to collect it.",
  fix: "Review the retry settings (Dashboard, Billing, Revenue recovery). Choose what happens when the last retry fails (cancel the subscription, mark it unpaid or leave it past due), and contact the customer or collect manually for these invoices.",
  evaluate({ openInvoices }, ctx) {
    const done = openInvoices.filter((i) => i.collection === "charge_automatically" && i.attemptCount >= 1 && i.nextPaymentAttempt === null);
    if (done.length === 0) return passed;
    const lower = atLeast(ctx.truncated.has("openInvoices"));
    const attempts = done.map((i) => i.attemptCount);
    return failed("medium", `${lower}${plural(done.length, "invoice")} open with no retry left`, [
      `${sampleIds(done.map((i) => i.id))}; attempts per invoice between ${Math.min(...attempts)} and ${Math.max(...attempts)}, no next attempt scheduled.`,
      `Total due ${totalsByCurrency(done.map((i) => ({ amount: i.amountDue, currency: i.currency })))}.`,
    ]);
  },
});
