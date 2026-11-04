import { describe, expect, it } from "vitest";
import { paymentMethodMissingOnActive, trialEndingWithoutPaymentMethod } from "../../../src/domain/rules/customers.js";
import { subscriptionCancelWithoutWinback, subscriptionDelinquent } from "../../../src/domain/rules/subscriptions.js";
import { customersToCheck } from "../../../src/domain/rules/support.js";
import { DAY, invoice, NOW, ok, portal, sub } from "../../support/builders.js";
import { run } from "../../support/run-rule.js";

describe("subscription-delinquent", () => {
  it("passes for healthy subscriptions and for failures younger than the threshold", () => {
    expect(run(subscriptionDelinquent).status).toBe("passed");
    expect(run(subscriptionDelinquent, { subscriptions: ok([sub({ status: "past_due", currentPeriodStart: NOW - 3 * DAY })]) }).status).toBe("passed");
  });

  it("measures from the oldest open invoice when there is one", () => {
    const s = sub({ id: "sub_1pastdueaaaa", status: "past_due", currentPeriodStart: NOW - 2 * DAY });
    const r = run(subscriptionDelinquent, {
      subscriptions: ok([s]),
      openInvoices: ok([invoice({ subscriptionId: s.id, created: NOW - 20 * DAY }), invoice({ id: "in_2second", subscriptionId: s.id, created: NOW - 9 * DAY })]),
    });
    expect(r.finding?.severity).toBe("high");
    expect(r.finding?.evidence[0]).toBe("past_due: 1 subscription, oldest since 2026-10-06 (20 days): sub_1pastd….");
    expect(r.finding?.evidence[1]).toContain("Threshold: 7 days");
  });

  it("falls back to the period start, or creation for incomplete, and groups by status", () => {
    const r = run(subscriptionDelinquent, {
      subscriptions: ok(
        [
          sub({ id: "sub_1pastdueaaaa", status: "past_due", currentPeriodStart: NOW - 10 * DAY }),
          sub({ id: "sub_2unpaidbbbb", status: "unpaid", currentPeriodStart: null, created: NOW - 40 * DAY }),
          sub({ id: "sub_3incompleteccc", status: "incomplete", currentPeriodStart: NOW - 99 * DAY, created: NOW - 8 * DAY }),
        ],
        { truncated: true },
      ),
    });
    expect(r.finding?.title).toBe("at least 3 subscriptions failing for 7+ days");
    expect(r.finding?.evidence).toHaveLength(4);
    expect(r.finding?.evidence[2]).toContain("incomplete: at least 1 subscription, oldest since 2026-10-18 (8 days)");
  });

  it("is medium when only incomplete subscriptions are stale", () => {
    expect(run(subscriptionDelinquent, { subscriptions: ok([sub({ status: "incomplete", created: NOW - 9 * DAY })]) }).finding?.severity).toBe("medium");
  });

  it("honours a custom threshold and skips subscriptions with no usable date", () => {
    const s = sub({ status: "past_due", currentPeriodStart: NOW - 3 * DAY });
    expect(run(subscriptionDelinquent, { subscriptions: ok([s]) }, { pastDueDays: 2, trialDays: 7, staleInvoiceDays: 14 }).status).toBe("failed");
    expect(run(subscriptionDelinquent, { subscriptions: ok([sub({ status: "past_due", currentPeriodStart: null, created: null })]) }).status).toBe("passed");
  });
});

describe("subscription-cancel-at-period-end-no-winback", () => {
  const pending = sub({ cancelAtPeriodEnd: true });

  it("does not apply when nothing is set to cancel", () => {
    expect(run(subscriptionCancelWithoutWinback).status).toBe("not_applicable");
    expect(run(subscriptionCancelWithoutWinback, { subscriptions: ok([sub({ cancelAtPeriodEnd: true, status: "canceled" })]) }).status).toBe("not_applicable");
  });

  it("is low when the portal cannot undo a cancellation", () => {
    const r = run(subscriptionCancelWithoutWinback, { subscriptions: ok([pending]), portalConfigurations: ok([portal({ subscriptionCancel: false })]) });
    expect(r.finding?.severity).toBe("low");
    expect(r.finding?.evidence[1]).toBe("Earliest period end: 2026-11-15.");
  });

  it("is low without any portal and says when dates are missing", () => {
    const r = run(subscriptionCancelWithoutWinback, { subscriptions: ok([{ ...pending, currentPeriodEnd: null }]), portalConfigurations: ok([]) });
    expect(r.finding?.evidence[1]).toBe("Period end dates were not available.");
  });

  it("is info when the portal lets customers cancel but collects no reasons", () => {
    const r = run(subscriptionCancelWithoutWinback, { subscriptions: ok([pending]), portalConfigurations: ok([portal({ cancellationReasons: false })]) });
    expect(r.finding?.severity).toBe("info");
  });

  it("passes with a portal that allows cancellation and asks why", () => {
    expect(run(subscriptionCancelWithoutWinback, { subscriptions: ok([pending]) }).status).toBe("passed");
  });
});

describe("payment method rules", () => {
  const needy = sub({ id: "sub_1needyaaaaaa", hasOwnPaymentMethod: false, customerId: "cus_1needyaaaaaa" });
  const lookup = (id: string, has: boolean, wanted = 1) => ok({ checked: [{ id, hasDefaultPaymentMethod: has }], wanted });

  it("flags active subscriptions whose customer has no default payment method", () => {
    const r = run(paymentMethodMissingOnActive, { subscriptions: ok([needy]), customers: lookup("cus_1needyaaaaaa", false) });
    expect(r.finding?.severity).toBe("high");
    expect(r.finding?.evidence[0]).toBe("1 subscription: sub_1needy….");
  });

  it("passes when the customer has a default or the subscription has its own", () => {
    expect(run(paymentMethodMissingOnActive, { subscriptions: ok([needy]), customers: lookup("cus_1needyaaaaaa", true) }).status).toBe("passed");
    expect(run(paymentMethodMissingOnActive, { subscriptions: ok([sub()]) }).status).toBe("passed");
    expect(run(paymentMethodMissingOnActive, { subscriptions: ok([{ ...needy, collection: "send_invoice" }]) }).status).toBe("passed");
    expect(run(paymentMethodMissingOnActive, { subscriptions: ok([{ ...needy, customerId: null }]) }).status).toBe("passed");
  });

  it("reports how many customers were not checked", () => {
    const r = run(paymentMethodMissingOnActive, { subscriptions: ok([needy, { ...needy, id: "sub_2other", customerId: "cus_2other" }]), customers: lookup("cus_1needyaaaaaa", false, 5) });
    expect(r.finding?.evidence[2]).toBe("Payment methods were checked for 1 of 5 customers; the rest were left out by the request cap.");
  });

  it("is skipped when customer lookup is off", () => {
    expect(run(paymentMethodMissingOnActive, { customers: { status: "unreadable", reason: "disabled", resource: "customers", detail: "off" } }).status).toBe("skipped");
  });

  it("selects the customers whose payment method matters", () => {
    const subs = [needy, sub(), { ...needy, id: "sub_2", customerId: "cus_2" }, { ...needy, id: "sub_3", status: "canceled" as const, customerId: "cus_3" }, { ...needy, id: "sub_4", customerId: "cus_1needyaaaaaa" }];
    expect(customersToCheck(subs)).toEqual(["cus_1needyaaaaaa", "cus_2"]);
  });
});

describe("trial-ending-without-payment-method", () => {
  const trial = (over = {}) => sub({ id: "sub_1trialaaaaaa", status: "trialing", trialEnd: NOW + 3 * DAY, hasOwnPaymentMethod: false, customerId: "cus_1trialaaaaaa", ...over });
  const customers = (has: boolean) => ok({ checked: [{ id: "cus_1trialaaaaaa", hasDefaultPaymentMethod: has }], wanted: 1 });

  it("does not apply when no trial is about to end", () => {
    expect(run(trialEndingWithoutPaymentMethod).status).toBe("not_applicable");
    expect(run(trialEndingWithoutPaymentMethod, { subscriptions: ok([trial({ trialEnd: NOW + 30 * DAY })]) }).status).toBe("not_applicable");
  });

  it("is high when the trial would create an invoice that cannot be paid", () => {
    const r = run(trialEndingWithoutPaymentMethod, { subscriptions: ok([trial({ trialEndBehavior: "create_invoice" })]), customers: customers(false) });
    expect(r.finding?.severity).toBe("high");
    expect(r.finding?.evidence[0]).toBe("sub_1trial…; the first ends 2026-10-29 (in 3 days).");
    expect(r.finding?.evidence[1]).toBe("Behaviour when the trial ends without a payment method: create_invoice.");
  });

  it("is high when the behaviour is not set, medium when it is cancel or pause", () => {
    expect(run(trialEndingWithoutPaymentMethod, { subscriptions: ok([trial()]), customers: customers(false) }).finding?.evidence[1]).toContain("not set (Stripe default: create_invoice)");
    expect(run(trialEndingWithoutPaymentMethod, { subscriptions: ok([trial({ trialEndBehavior: "cancel" })]), customers: customers(false) }).finding?.severity).toBe("medium");
  });

  it("passes when a payment method exists", () => {
    expect(run(trialEndingWithoutPaymentMethod, { subscriptions: ok([trial()]), customers: customers(true) }).status).toBe("passed");
    expect(run(trialEndingWithoutPaymentMethod, { subscriptions: ok([trial({ hasOwnPaymentMethod: true })]) }).status).toBe("passed");
  });
});
