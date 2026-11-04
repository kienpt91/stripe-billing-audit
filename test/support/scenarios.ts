import { evaluate } from "../../src/domain/engine.js";
import { exitCodeFor } from "../../src/domain/exit-code.js";
import type { Facts } from "../../src/domain/facts.js";
import { buildReport, type AuditReport } from "../../src/domain/report.js";
import { safeUrl } from "../../src/domain/stripe/identifiers.js";
import { DAY, NOW, THRESHOLDS, account, endpoint, facts, invoice, ok, portal, price, product, sub, taxSettings, unreadable } from "./builders.js";

/** An account with a realistic spread of billing gaps, and one resource the key could not read. */
export function troubledFacts(): Facts {
  const failing = sub({ id: "sub_1PastDueAaaaa", status: "past_due", currentPeriodStart: NOW - 40 * DAY, customerId: "cus_1PastDueAaaaa", hasOwnPaymentMethod: false });
  const trial = sub({ id: "sub_1TrialBbbbbbb", status: "trialing", trialEnd: NOW + 2 * DAY, customerId: "cus_1TrialBbbbbbb", hasOwnPaymentMethod: false, trialEndBehavior: "create_invoice" });
  const leaving = sub({ id: "sub_1LeavingCcccc", cancelAtPeriodEnd: true, currentPeriodEnd: NOW + 9 * DAY });
  const untaxed = sub({ id: "sub_1UntaxedDdddd", automaticTax: false, currency: "eur" });
  return facts({
    webhookEndpoints: ok([
      endpoint({ id: "we_1HttpEeeeeeee", url: safeUrl("http://hooks.example.com/stripe/whsec0123456789abcdefghij?token=abc"), enabledEvents: ["checkout.session.completed", "invoice.paid"], apiVersion: "2020-08-27" }),
      endpoint({ id: "we_1OffFfffffffff", status: "disabled", enabledEvents: ["*"] }),
    ]),
    subscriptions: ok([failing, trial, leaving, untaxed, sub()]),
    customers: ok({ checked: [{ id: "cus_1PastDueAaaaa", hasDefaultPaymentMethod: false }, { id: "cus_1TrialBbbbbbb", hasDefaultPaymentMethod: false }], wanted: 2 }),
    openInvoices: ok([
      invoice({ id: "in_1StaleGgggggg", created: NOW - 35 * DAY, subscriptionId: failing.id }),
      invoice({ id: "in_1ExhaustedHhhh", created: NOW - 5 * DAY, attemptCount: 4, nextPaymentAttempt: null, autoAdvance: false, amountDue: 12_500 }),
    ]),
    uncollectibleInvoices: unreadable("permission", "uncollectible invoices", "HTTP 403: the key lacks the read permission for this resource"),
    prices: ok([price({ taxBehavior: "unspecified" }), price({ id: "price_1EurIiiiiiii", currency: "eur" })]),
    products: ok([product({ hasTaxCode: false })]),
    portalConfigurations: ok([portal({ active: false })]),
    taxSettings: ok(taxSettings({ status: "pending", missingFields: ["head_office.address"], hasDefaultTaxBehavior: false, hasDefaultTaxCode: false })),
  });
}

export function reportFor(f: Facts, over: { failOn?: "info" | "low" | "medium" | "high" | "critical" } = {}): AuditReport {
  const evaluation = evaluate(f, THRESHOLDS);
  const failOn = over.failOn ?? "medium";
  return buildReport({
    tool: { name: "stripe-billing-audit", version: "0.1.0" },
    facts: f,
    evaluation,
    keyKind: "restricted",
    options: { failOn, thresholds: THRESHOLDS, customerLookup: true, includeEvents: false },
    warnings: [],
    requestsUsed: 17,
    exitCode: exitCodeFor(evaluation, failOn),
  });
}

export function cleanReport(): AuditReport {
  return reportFor(facts({ account: ok(account()), failedEvents: ok([]) }));
}
