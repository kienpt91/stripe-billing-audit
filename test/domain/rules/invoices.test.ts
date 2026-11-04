import { describe, expect, it } from "vitest";
import { dunningRetriesExhausted, invoiceStuckOpen, invoiceUncollectible } from "../../../src/domain/rules/invoices.js";
import { DAY, invoice, NOW, ok } from "../../support/builders.js";
import { run } from "../../support/run-rule.js";

describe("invoice-stuck-open", () => {
  it("passes for no invoices and for recent ones", () => {
    expect(run(invoiceStuckOpen).status).toBe("passed");
    expect(run(invoiceStuckOpen, { openInvoices: ok([invoice({ created: NOW - 3 * DAY })]) }).status).toBe("passed");
  });

  it("totals the amounts per currency and names the oldest date", () => {
    const r = run(invoiceStuckOpen, {
      openInvoices: ok([invoice({ created: NOW - 30 * DAY }), invoice({ id: "in_2b", created: NOW - 20 * DAY, amountDue: 1000, currency: "eur" }), invoice({ id: "in_3c", created: NOW - 2 * DAY })], { partial: true }),
    });
    expect(r.finding?.severity).toBe("medium");
    expect(r.finding?.title).toBe("at least 2 invoices open for 14+ days");
    expect(r.finding?.evidence[0]).toBe("at least 2 invoices, total due 10.00 EUR, 49.00 USD: in_1AbCdE…, in_2b.");
    expect(r.finding?.evidence[1]).toContain("Oldest reference date: 2026-09-26 (30 days)");
  });

  it("uses the due date when there is one", () => {
    expect(run(invoiceStuckOpen, { openInvoices: ok([invoice({ created: NOW - 90 * DAY, dueDate: NOW + 5 * DAY })]) }).status).toBe("passed");
    expect(run(invoiceStuckOpen, { openInvoices: ok([invoice({ created: NOW - 1 * DAY, dueDate: NOW - 20 * DAY })]) }).status).toBe("failed");
    expect(run(invoiceStuckOpen, { openInvoices: ok([invoice({ created: null, dueDate: null })]) }).status).toBe("passed");
  });
});

describe("invoice-uncollectible", () => {
  it("passes with none and reports totals otherwise", () => {
    expect(run(invoiceUncollectible).status).toBe("passed");
    const r = run(invoiceUncollectible, { uncollectibleInvoices: ok([invoice({ status: "uncollectible" }), invoice({ id: "in_2", amountDue: 100, status: "uncollectible", currency: null })]) });
    expect(r.finding?.severity).toBe("low");
    expect(r.finding?.evidence[0]).toBe("Total 1.00 UNKNOWN, 49.00 USD: in_1AbCdE…, in_2.");
  });
});

describe("dunning-retries-exhausted", () => {
  const done = (over = {}) => invoice({ attemptCount: 4, nextPaymentAttempt: null, autoAdvance: false, ...over });

  it("flags attempted invoices with no next attempt", () => {
    const r = run(dunningRetriesExhausted, { openInvoices: ok([done(), done({ id: "in_2", attemptCount: 2 })]) });
    expect(r.finding?.severity).toBe("medium");
    expect(r.finding?.evidence[0]).toContain("between 2 and 4 attempts each");
    expect(r.finding?.evidence[1]).toBe("Total due 98.00 USD.");
  });

  it("says how many attempts when they are all equal", () => {
    expect(run(dunningRetriesExhausted, { openInvoices: ok([done()]) }).finding?.evidence[0]).toContain("4 attempts each, no next attempt scheduled");
  });

  it("ignores invoices that are still scheduled, never attempted or sent for manual payment", () => {
    expect(run(dunningRetriesExhausted, { openInvoices: ok([invoice({ attemptCount: 1, nextPaymentAttempt: NOW + DAY })]) }).status).toBe("passed");
    expect(run(dunningRetriesExhausted, { openInvoices: ok([done({ attemptCount: 0 })]) }).status).toBe("passed");
    expect(run(dunningRetriesExhausted, { openInvoices: ok([done({ collection: "send_invoice" })]) }).status).toBe("passed");
  });
});
