# Stripe billing audit

| | |
| --- | --- |
| Account | `acct_1AbCdE…` |
| Mode | live |
| Key | restricted, read-only requests |
| Account API version | `2025-09-30.clover` |
| Checked | `2026-10-26T07:33:20Z` |
| Tool | `stripe-billing-audit 0.1.0` |

## Summary

| Severity | Findings |
| --- | ---: |
| Critical | 0 |
| High | 7 |
| Medium | 6 |
| Low | 3 |
| Info | 0 |

25 checks ran: 5 passed, 16 failed, 3 not applicable, 1 skipped.

## Findings

### High

#### `webhook-lifecycle-events-missing`: 3 subscription lifecycle events not delivered

**Evidence**

```
Not delivered to any enabled endpoint: customer.subscription.updated, customer.subscription.deleted, invoice.payment_failed.
we_1HttpE… (http://hooks.example.com/stripe/…) subscribes to 2 events.
```

**Why it matters**

A subscription business learns about renewals, failures and cancellations through these events. If one is not delivered to anything, your records and the customer's access stop matching what Stripe bills.

**Suggested fix**

Add the missing events to an enabled endpoint (or use all events), and make the handler idempotent on the event id. Handle checkout.session.completed to provision, invoice.paid to extend access, invoice.payment_failed to start recovery, customer.subscription.updated and customer.subscription.deleted to change or end access.

#### `webhook-endpoint-http`: 1 endpoint on plain HTTP

**Evidence**

```
we_1HttpE… (http://hooks.example.com/stripe/…) uses http.
```

**Why it matters**

Event payloads carry billing data and travel in clear over HTTP, and the request cannot be trusted to come from where it claims. Stripe requires HTTPS for live-mode endpoints.

**Suggested fix**

Serve the endpoint over HTTPS with a valid certificate and update the endpoint URL. Keep verifying the Stripe-Signature header regardless of the transport.

#### `subscription-delinquent`: 1 subscription failing for 7\+ days

**Evidence**

```
past_due: 1 subscription, oldest since 2026-09-21 (35 days): sub_1PastD….
Threshold: 7 days, counted from the oldest open invoice of the subscription, or from the start of its current period when no open invoice was listed (so a lower bound).
```

**Why it matters**

A subscription that stays in a failing state is revenue you are owed and have not collected, and usually a customer who still has, or has silently lost, access. The longer it lasts the less likely it is recovered.

**Suggested fix**

Decide the end state of failed payments (Dashboard, Billing, Revenue recovery: cancel, mark unpaid or leave past due), contact the customers with the oldest failures, and make the application treat past_due and unpaid explicitly instead of as active. The Billing portal link lets a customer update the card themselves.

#### `customer-no-default-payment-method`: 1 subscription with no payment method on file, set to charge automatically

**Evidence**

```
1 subscription: sub_1PastD….
Neither the subscription nor its customer has a default payment method or source.
```

**Why it matters**

A subscription set to charge automatically with no default payment method on the subscription or the customer will fail its next renewal. It becomes past_due, costs a failed-payment cycle and often a customer.

**Suggested fix**

Ask these customers to add a payment method (the Billing portal's update-payment-method link works), or switch the subscription to send_invoice if invoicing is intended. Collect the payment method at checkout with setup_future_usage or a Checkout subscription session so it is saved as the default.

#### `trial-ending-without-payment-method`: 1 trial ending within 7 days with no payment method

**Evidence**

```
sub_1Trial…; the first ends 2026-10-28 (in 2 days).
Behaviour when the trial ends without a payment method: create_invoice.
```

**Why it matters**

When a trial ends with no payment method the first invoice cannot be paid: the customer is cancelled, paused or left past due, depending on the trial settings, at the moment they have just decided to stay.

**Suggested fix**

Collect a payment method before the trial ends (Checkout with payment_method_collection=always, or a reminder email from the customer.subscription.trial_will_end event, sent three days before). Set trial_settings.end_behavior.missing_payment_method deliberately: cancel or pause rather than create_invoice.

#### `tax-automatic-disabled`: 1 subscription without automatic tax

**Evidence**

```
1 active tax registration, and 1 of 5 billing subscriptions have automatic tax off: sub_1Untax….
```

**Why it matters**

You are registered to collect tax, but these subscriptions are billed without calculating it. The tax is then either not collected, which you owe anyway, or collected by hand and inconsistently.

**Suggested fix**

Enable automatic tax on the subscriptions (automatic_tax[enabled]=true on new ones, and update existing ones), set a tax behavior on the prices, and make sure customers have a valid address. Review the invoices already issued with your accountant.

#### `tax-settings-incomplete`: Automatic tax is on but tax settings are not active

**Evidence**

```
4 subscriptions use automatic tax: sub_1PastD…, sub_1Trial…, sub_1Leavi…, sub_1AbCdE….
Tax settings status: pending; missing: head_office.address.
```

**Why it matters**

Automatic tax cannot calculate anything until the head office address and tax settings are complete. Invoices and checkouts then fail to compute tax or fall back to no tax.

**Suggested fix**

Complete the missing tax settings (Dashboard, Tax, Settings) and check that Stripe Tax shows the status as active.

### Medium

#### `webhook-endpoint-disabled`: 1 webhook endpoint disabled

**Evidence**

```
we_1OffFf… (https://app.example.com/webhooks/stripe) is disabled.
```

**Why it matters**

Stripe disables an endpoint that keeps failing, and a disabled endpoint silently stops receiving events. It is also a sign that someone's handler was broken for days.

**Suggested fix**

Find out why deliveries failed (Dashboard, Webhooks, the endpoint's event deliveries), fix the handler, then re-enable the endpoint or delete it if it is obsolete. Replay the missed events from the dashboard or reconcile against the API.

#### `webhook-api-version-drift`: API version differs from the account's on 1 endpoint

**Evidence**

```
Account default version: 2025-09-30.clover.
we_1HttpE… (http://hooks.example.com/stripe/…) is pinned to 2020-08-27.
```

**Why it matters**

The payload of an event follows the API version of its endpoint. If the endpoint and the account differ, the shape your handler receives differs from what the rest of your code reads from the API, and an account upgrade changes only one of them.

**Suggested fix**

Choose one version on purpose: set the endpoint's version to the one your handler was written against, or upgrade handler and account together. Test the handler against payloads of the target version before switching.

#### `invoice-stuck-open`: 1 invoice open for 14\+ days

**Evidence**

```
1 invoice, total due 49.00 USD: in_1Stale….
Oldest reference date: 2026-09-21 (35 days), counted from the due date, or the creation date when there is none.
```

**Why it matters**

An open invoice that nobody pays and nothing closes is revenue that is neither collected nor written off. It keeps the customer past due, inflates receivables and hides failed payment flows.

**Suggested fix**

Follow up with the customer (the hosted invoice page has a pay button), retry or collect the payment, or void or mark the invoice uncollectible if it will not be paid. Add an alert for invoices open longer than your collection policy.

#### `dunning-retries-exhausted`: 1 invoice open with no retry left

**Evidence**

```
in_1Exhau…; 4 attempts each, no next attempt scheduled.
Total due 125.00 USD.
```

**Why it matters**

An invoice that was attempted, has no next attempt scheduled and is still open is out of retries and out of sight: Stripe will not try again and nothing else is going to collect it.

**Suggested fix**

Review the retry settings (Dashboard, Billing, Revenue recovery). Choose what happens when the last retry fails (cancel the subscription, mark it unpaid or leave it past due), and contact the customer or collect manually for these invoices.

#### `portal-missing`: No active Billing portal configuration

**Evidence**

```
1 portal configuration listed, none active.
```

**Why it matters**

Without the Billing portal customers cannot update a card, download invoices or cancel on their own. Every one of those becomes a support ticket, and a failed card that the customer cannot fix is lost revenue.

**Suggested fix**

Save a portal configuration (Dashboard, Settings, Billing, Customer portal) with payment method updates, invoice history and cancellation enabled, then create portal sessions from your account page and from failed-payment emails.

#### `tax-price-behavior-unspecified`: 1 active price with no tax behavior

**Evidence**

```
price_1AbCdE….
The tax settings define no default tax behavior.
```

**Why it matters**

A price with no tax behavior leaves it to chance whether the displayed amount includes tax. With automatic tax the calculation can fail, and customers are charged a total they did not expect.

**Suggested fix**

Set tax_behavior to inclusive or exclusive on each price (prices are immutable in most fields, so create a replacement price and archive the old one), or set a default tax behavior in the tax settings.

### Low

#### `subscription-cancel-at-period-end-no-winback`: Pending cancellations have no self\-service way back

**Evidence**

```
1 subscription set to cancel at period end: sub_1Leavi….
Earliest period end: 2026-11-04.
No active Billing portal configuration has cancellation enabled, so customers cannot undo a pending cancellation there.
```

**Why it matters**

A customer who has scheduled a cancellation is the cheapest customer to keep. Without a way to undo it themselves, and without the reason they leave, there is nothing to win them back with before the period ends.

**Suggested fix**

Enable cancellation in the Billing portal configuration (customers then see an option to keep their subscription while a cancellation is pending), turn on cancellation reasons, and send a win-back message from the customer.subscription.updated event while cancel_at_period_end is true. The API cannot show whether such a message exists; see --checklist.

#### `tax-product-code-missing`: 1 active product with no tax code

**Evidence**

```
prod_1AbCdE…; the tax settings define no default tax code.
```

**Why it matters**

Tax rates depend on what is sold. A product without a tax code is taxed with the account's default code, which is wrong for software, services and digital goods that have their own treatment.

**Suggested fix**

Set the right tax code on each product (Dashboard, Product catalog) or set a sensible default tax code in the tax settings.

#### `currency-mixed`: 2 currencies in use

**Evidence**

```
Active recurring prices: eur (1), usd (1).
Live subscriptions: eur (1), usd (4).
Account default currency: usd.
```

**Why it matters**

Several currencies multiply the reporting, tax and reconciliation work, expose you to exchange-rate swings on settlement and make revenue figures hard to compare. It is sometimes deliberate, so this is for review, not a defect.

**Suggested fix**

Confirm that each currency is intended. If not, archive the prices in the stray currency and move the subscriptions. If it is, make sure your reporting, tax settings and payouts handle each currency.

## Checks that could not run

These checks need a resource the key could not read. No conclusion is drawn for them.

| Check | Resource | Reason |
| --- | --- | --- |
| `invoice-uncollectible` | `uncollectible invoices` | `HTTP 403: the key lacks the read permission for this resource` |

## Not visible through the Stripe API

These matter for reliable billing but Stripe does not expose them, so they were not guessed. Check them by hand:

- **Retry schedule and the state after the last retry**: Dashboard, Billing, Revenue recovery, Retries. Smart Retries (or a custom schedule) is on, the number of retries and the window suit your product, and the setting for what happens to the subscription when the last retry fails (cancel, mark unpaid, leave past due) matches how your application treats access. Retry settings cannot be read through the API.
- **Failed\-payment and renewal emails**: Dashboard, Settings, Billing, Subscriptions and emails. Emails for failed payments, upcoming renewals and expiring cards are on or replaced by your own, and each carries a link where the customer can update the card (a Billing portal session). Email settings cannot be read through the API.

## Scope and method

The audit made 17 read-only GET requests to a fixed list of Stripe endpoints. It wrote nothing to the account. It does not request customer emails, names or addresses, and this report contains none; object ids are shortened. The API key is not stored or printed.
