# Checks

Every check is a pure rule over facts read from the account. A check has an id, a severity, evidence (what was observed), why it matters and a suggested fix. A check whose data could not be read is **skipped** with the reason, never guessed; a check that does not apply (for example "no subscription is set to cancel") says so; a check that found nothing, but only in part of the data (a listing stopped at `--max-pages`, the customer lookup stopped at its cap of 50, or a lookup failed part way), is **inconclusive** with the cause and is never reported as passed. A check that finds something is still a finding, with "at least" counts. The terminal report lists findings and the checks that did not conclude; `--json` and `--markdown` also list every check with its status.

Severity is what the finding reports, and `--fail-on` gates on it:

| Severity | Meaning |
| --- | --- |
| critical | Billing events are not reaching the application for live subscriptions. |
| high | Money is being lost or collected wrongly now, or will be at the next renewal. |
| medium | A gap that turns into support load, churn or lost revenue. |
| low | Worth reviewing; often a deliberate choice. |
| info | Context for a decision. |

The thresholds behind some checks are options: `--past-due-days` (7), `--trial-days` (7) and `--stale-invoice-days` (14).

## Permissions

A restricted key needs read access to the resource behind each endpoint the audit calls. The Stripe dashboard names the permissions per resource; a check whose resource the key cannot read (HTTP 403), or that the account does not have (HTTP 404), is skipped, listed with the HTTP status, and the run ends with exit code 4.

| Endpoint (GET) | Used by |
| --- | --- |
| `/v1/account` | account id, country, default currency, default API version (from the `Stripe-Version` response header) |
| `/v1/webhook_endpoints` | the webhook checks |
| `/v1/subscriptions` (every status except canceled, which is the API default) | the subscription, payment method, tax and currency checks |
| `/v1/invoices` (`status=open`, `status=uncollectible`) | the invoice and dunning checks |
| `/v1/prices`, `/v1/products` (`active=true`) | tax behavior, tax code and currency checks |
| `/v1/billing_portal/configurations` | the Billing portal checks and the win-back check |
| `/v1/tax/settings`, `/v1/tax/registrations` (`status=active`) | the tax checks |
| `/v1/customers/{id}` (only customers of subscriptions with no payment method of their own, at most 50) | the payment method checks; off with `--skip-customer-lookup` |
| `/v1/events` (`delivery_success=false`, one page of 25) | `webhook-deliveries-failing`; only with `--include-events` |

The permission names in the dashboard have not been checked against a real account for this project; if a check is skipped with HTTP 403, enable the read permission of that resource and run again.

## Coverage and caps

Listings are read newest first, up to `--max-pages` pages of 100 objects (default 5), and the payment-method checks look up at most 50 customers. When a cap stops a listing or the lookups, every check that needs that resource and found nothing is **inconclusive** (JSON: `checks[].status`, with `partial[]` naming the resource, the cause and what was not examined), and the run exits **5** unless `--allow-partial-coverage` is given. If a lookup fails after some progress (an HTTP error, a timeout, a malformed answer) or the request budget runs out, the cause is `api_error` or `budget`, the checks are inconclusive in the same way, and the run exits **3**; the allowance does not cover that. Raising `--max-pages` (up to 50) is the way to a conclusive run on a large account; the customer lookup cap is fixed at 50.

## What the API cannot show

Retry and dunning settings, the emails Stripe sends, and how your webhook handler behaves are not exposed by the API. The audit does not guess them. `stripe-billing-audit --checklist` prints the manual items, and every report lists the two that matter most for failed payments. Where the API shows the *effect* of a setting (invoices that ran out of retries and are still open), a check reports it as evidence.

## Catalogue

<!-- checks:start -->

| Check | Area | Severity | Needs |
| --- | --- | --- | --- |
| [`webhook-none-enabled`](#webhook-none-enabled) | webhooks | critical when live subscriptions exist, otherwise high | webhook endpoints |
| [`webhook-endpoint-disabled`](#webhook-endpoint-disabled) | webhooks | medium | webhook endpoints |
| [`webhook-lifecycle-events-missing`](#webhook-lifecycle-events-missing) | webhooks | high; medium when only checkout.session.completed is missing | webhook endpoints |
| [`webhook-endpoint-http`](#webhook-endpoint-http) | webhooks | high in live mode, medium in test mode | webhook endpoints |
| [`webhook-api-version-drift`](#webhook-api-version-drift) | webhooks | medium | webhook endpoints, account |
| [`webhook-duplicate-urls`](#webhook-duplicate-urls) | webhooks | low | webhook endpoints |
| [`webhook-development-url-in-live-mode`](#webhook-development-url-in-live-mode) | webhooks | high | webhook endpoints |
| [`webhook-deliveries-failing`](#webhook-deliveries-failing) | webhooks | high | events with failed webhook deliveries |
| [`subscription-delinquent`](#subscription-delinquent) | subscriptions | high; medium when only incomplete subscriptions are stale | subscriptions |
| [`subscription-cancel-at-period-end-no-winback`](#subscription-cancel-at-period-end-no-winback) | subscriptions | low without a self-service way back; info when only cancellation reasons are missing | subscriptions, billing portal configurations |
| [`customer-no-default-payment-method`](#customer-no-default-payment-method) | customers | high | subscriptions, customer payment state |
| [`trial-ending-without-payment-method`](#trial-ending-without-payment-method) | customers | high; medium when every affected trial cancels or pauses | subscriptions, customer payment state |
| [`invoice-stuck-open`](#invoice-stuck-open) | invoices | medium | open invoices |
| [`invoice-uncollectible`](#invoice-uncollectible) | invoices | low | uncollectible invoices |
| [`dunning-retries-exhausted`](#dunning-retries-exhausted) | invoices | medium | open invoices |
| [`portal-missing`](#portal-missing) | portal | medium | billing portal configurations |
| [`portal-no-payment-method-update`](#portal-no-payment-method-update) | portal | medium | billing portal configurations |
| [`portal-no-cancellation`](#portal-no-cancellation) | portal | medium | billing portal configurations |
| [`portal-no-legal-links`](#portal-no-legal-links) | portal | low | billing portal configurations |
| [`tax-automatic-disabled`](#tax-automatic-disabled) | tax | high | subscriptions, tax registrations |
| [`tax-settings-incomplete`](#tax-settings-incomplete) | tax | high | tax settings, subscriptions |
| [`tax-price-behavior-unspecified`](#tax-price-behavior-unspecified) | tax | medium | prices |
| [`tax-product-code-missing`](#tax-product-code-missing) | tax | low | products |
| [`currency-mixed`](#currency-mixed) | account | low | prices, subscriptions |
| [`livemode-mismatch`](#livemode-mismatch) | account | medium | nothing |

### webhook-none-enabled

At least one webhook endpoint exists and is enabled. Severity: critical when live subscriptions exist, otherwise high.

**Why it matters.** Without an enabled endpoint Stripe has nowhere to tell your application that a payment failed, a subscription was cancelled or an invoice was paid. Access, emails and your own records then drift from what Stripe bills.

**Suggested fix.** Create a webhook endpoint (Dashboard, Developers, Webhooks) that points to an HTTPS URL of your application, subscribe it to the lifecycle events listed by webhook-lifecycle-events-missing, verify the signature in the handler and answer 2xx quickly. Re-enable a disabled endpoint after fixing the URL it points to.

### webhook-endpoint-disabled

No webhook endpoint is left disabled. Severity: medium.

**Why it matters.** Stripe disables an endpoint that keeps failing, and a disabled endpoint silently stops receiving events. It is also a sign that someone's handler was broken for days.

**Suggested fix.** Find out why deliveries failed (Dashboard, Webhooks, the endpoint's event deliveries), fix the handler, then re-enable the endpoint or delete it if it is obsolete. Replay the missed events from the dashboard or reconcile against the API.

### webhook-lifecycle-events-missing

Enabled endpoints together receive the subscription lifecycle events. Severity: high; medium when only checkout.session.completed is missing.

**Why it matters.** A subscription business learns about renewals, failures and cancellations through these events. If one is not delivered to anything, your records and the customer's access stop matching what Stripe bills.

**Suggested fix.** Add the missing events to an enabled endpoint (or use all events), and make the handler idempotent on the event id. Handle checkout.session.completed to provision, invoice.paid to extend access, invoice.payment_failed to start recovery, customer.subscription.updated and customer.subscription.deleted to change or end access.

### webhook-endpoint-http

Enabled endpoints use HTTPS. Severity: high in live mode, medium in test mode.

**Why it matters.** Event payloads carry billing data and travel in clear over HTTP, and the request cannot be trusted to come from where it claims. Stripe requires HTTPS for live-mode endpoints.

**Suggested fix.** Serve the endpoint over HTTPS with a valid certificate and update the endpoint URL. Keep verifying the Stripe-Signature header regardless of the transport.

### webhook-api-version-drift

Endpoint API versions match the account's default version. Severity: medium.

**Why it matters.** The payload of an event follows the API version of its endpoint. If the endpoint and the account differ, the shape your handler receives differs from what the rest of your code reads from the API, and an account upgrade changes only one of them.

**Suggested fix.** Choose one version on purpose: set the endpoint's version to the one your handler was written against, or upgrade handler and account together. Test the handler against payloads of the target version before switching.

### webhook-duplicate-urls

No two enabled endpoints deliver the same events to the same URL. Severity: low.

**Why it matters.** An event delivered twice to the same handler is processed twice unless the handler deduplicates, which means double provisioning, double emails or double credits.

**Suggested fix.** Delete the endpoint that is not needed or split the events so that each is delivered once, and deduplicate on event.id in the handler anyway.

### webhook-development-url-in-live-mode

Live-mode endpoints do not point to development hosts. Severity: high.

**Why it matters.** A live endpoint that points to localhost, a private address or a development tunnel is either dead, so live events are lost, or served by someone's laptop, so live billing data leaves production.

**Suggested fix.** Point live endpoints to a production HTTPS URL and delete the development endpoint. Use test mode and the Stripe CLI for local development.

### webhook-deliveries-failing

Recent events were delivered successfully (needs --include-events). Severity: high.

**Why it matters.** Events whose delivery failed are changes your application has not seen: payments, cancellations or renewals that your records may not reflect. Stripe retries for up to three days, then gives up.

**Suggested fix.** Open the failing events in the dashboard (Developers, Webhooks, the endpoint), fix the handler, resend the events that were missed, and alert on repeated failures. Reconcile against the API after an outage.

### subscription-delinquent

No subscription stays past_due, unpaid or incomplete beyond the threshold. Severity: high; medium when only incomplete subscriptions are stale.

**Why it matters.** A subscription that stays in a failing state is revenue you are owed and have not collected, and usually a customer who still has, or has silently lost, access. The longer it lasts the less likely it is recovered.

**Suggested fix.** Decide the end state of failed payments (Dashboard, Billing, Revenue recovery: cancel, mark unpaid or leave past due), contact the customers with the oldest failures, and make the application treat past_due and unpaid explicitly instead of as active. The Billing portal link lets a customer update the card themselves.

### subscription-cancel-at-period-end-no-winback

Subscriptions set to cancel can be reactivated and their reasons are collected. Severity: low without a self-service way back; info when only cancellation reasons are missing.

**Why it matters.** A customer who has scheduled a cancellation is the cheapest customer to keep. Without a way to undo it themselves, and without the reason they leave, there is nothing to win them back with before the period ends.

**Suggested fix.** Enable cancellation in the Billing portal configuration (customers then see an option to keep their subscription while a cancellation is pending), turn on cancellation reasons, and send a win-back message from the customer.subscription.updated event while cancel_at_period_end is true. The API cannot show whether such a message exists; see --checklist.

### customer-no-default-payment-method

Active subscriptions that charge automatically have a payment method. Severity: high.

**Why it matters.** A subscription set to charge automatically with no default payment method on the subscription or the customer will fail its next renewal. It becomes past_due, costs a failed-payment cycle and often a customer.

**Suggested fix.** Ask these customers to add a payment method (the Billing portal's update-payment-method link works), or switch the subscription to send_invoice if invoicing is intended. Collect the payment method at checkout with setup_future_usage or a Checkout subscription session so it is saved as the default.

### trial-ending-without-payment-method

Trials that end soon have a payment method. Severity: high; medium when every affected trial cancels or pauses.

**Why it matters.** When a trial ends with no payment method the first invoice cannot be paid: the customer is cancelled, paused or left past due, depending on the trial settings, at the moment they have just decided to stay.

**Suggested fix.** Collect a payment method before the trial ends (Checkout with payment_method_collection=always, or a reminder email from the customer.subscription.trial_will_end event, sent three days before). Set trial_settings.end_behavior.missing_payment_method deliberately: cancel or pause rather than create_invoice.

### invoice-stuck-open

No invoice stays open beyond the threshold. Severity: medium.

**Why it matters.** An open invoice that nobody pays and nothing closes is revenue that is neither collected nor written off. It keeps the customer past due, inflates receivables and hides failed payment flows.

**Suggested fix.** Follow up with the customer (the hosted invoice page has a pay button), retry or collect the payment, or void or mark the invoice uncollectible if it will not be paid. Add an alert for invoices open longer than your collection policy.

### invoice-uncollectible

No invoice is marked uncollectible. Severity: low.

**Why it matters.** Uncollectible invoices are written-off revenue. A growing count points to a failed-payment process that gives up too early, or to customers who keep access without paying.

**Suggested fix.** Review why these invoices could not be collected, whether the customers still have access, and whether the retry and cancellation settings need to change. Mark an invoice paid if it was settled out of band.

### dunning-retries-exhausted

No automatically charged invoice is left open after its retries ended. Severity: medium.

**Why it matters.** An invoice that was attempted, has no next attempt scheduled and is still open is out of retries and out of sight: Stripe will not try again and nothing else is going to collect it.

**Suggested fix.** Review the retry settings (Dashboard, Billing, Revenue recovery). Choose what happens when the last retry fails (cancel the subscription, mark it unpaid or leave it past due), and contact the customer or collect manually for these invoices.

### portal-missing

An active Billing portal configuration exists. Severity: medium.

**Why it matters.** Without the Billing portal customers cannot update a card, download invoices or cancel on their own. Every one of those becomes a support ticket, and a failed card that the customer cannot fix is lost revenue.

**Suggested fix.** Save a portal configuration (Dashboard, Settings, Billing, Customer portal) with payment method updates, invoice history and cancellation enabled, then create portal sessions from your account page and from failed-payment emails.

### portal-no-payment-method-update

The Billing portal lets customers update their payment method. Severity: medium.

**Why it matters.** Cards expire and get replaced. If customers cannot update the card themselves, every failed renewal needs your intervention and the failed-payment email has nowhere useful to point.

**Suggested fix.** Enable Payment methods, Update, in the portal configuration, and link to a portal session from your failed-payment emails.

### portal-no-cancellation

The Billing portal lets customers cancel. Severity: medium.

**Why it matters.** Customers who cannot cancel easily write to support, dispute the charge with their bank or complain publicly, and several jurisdictions require cancellation to be as easy as sign-up.

**Suggested fix.** Enable Subscriptions, Cancel, in the portal configuration (consider cancel at period end, and ask for a reason), or provide an equally direct cancellation path in your application.

### portal-no-legal-links

The Billing portal links to a privacy policy and terms of service. Severity: low.

**Why it matters.** Customers manage payment data in the portal. Missing privacy and terms links are a trust and compliance gap on a page that carries your brand.

**Suggested fix.** Add the privacy policy and terms of service URLs to the portal's business information.

### tax-automatic-disabled

Subscriptions use automatic tax where the account is registered to collect tax. Severity: high.

**Why it matters.** You are registered to collect tax, but these subscriptions are billed without calculating it. The tax is then either not collected, which you owe anyway, or collected by hand and inconsistently.

**Suggested fix.** Enable automatic tax on the subscriptions (automatic_tax[enabled]=true on new ones, and update existing ones), set a tax behavior on the prices, and make sure customers have a valid address. Review the invoices already issued with your accountant.

### tax-settings-incomplete

Tax settings are complete where subscriptions use automatic tax. Severity: high.

**Why it matters.** Automatic tax cannot calculate anything until the head office address and tax settings are complete. Invoices and checkouts then fail to compute tax or fall back to no tax.

**Suggested fix.** Complete the missing tax settings (Dashboard, Tax, Settings) and check that Stripe Tax shows the status as active.

### tax-price-behavior-unspecified

Active prices state whether tax is inclusive or exclusive. Severity: medium.

**Why it matters.** A price with no tax behavior leaves it to chance whether the displayed amount includes tax. With automatic tax the calculation can fail, and customers are charged a total they did not expect.

**Suggested fix.** Set tax_behavior to inclusive or exclusive on each price (prices are immutable in most fields, so create a replacement price and archive the old one), or set a default tax behavior in the tax settings.

### tax-product-code-missing

Active products carry a tax code. Severity: low.

**Why it matters.** Tax rates depend on what is sold. A product without a tax code is taxed with the account's default code, which is wrong for software, services and digital goods that have their own treatment.

**Suggested fix.** Set the right tax code on each product (Dashboard, Product catalog) or set a sensible default tax code in the tax settings.

### currency-mixed

Recurring prices and live subscriptions use one currency. Severity: low.

**Why it matters.** Several currencies multiply the reporting, tax and reconciliation work, expose you to exchange-rate swings on settlement and make revenue figures hard to compare. It is sometimes deliberate, so this is for review, not a defect.

**Suggested fix.** Confirm that each currency is intended. If not, archive the prices in the stray currency and move the subscriptions. If it is, make sure your reporting, tax settings and payouts handle each currency.

### livemode-mismatch

Every object returned belongs to the mode of the key. Severity: medium.

**Why it matters.** Stripe keeps test and live data apart, so objects of the other mode in one listing mean the key, the base URL or something in between is not what it appears to be, and every conclusion of this audit is suspect.

**Suggested fix.** Check which key and API base you are using. Re-run with a key of the intended mode, and look for a proxy or mock server in front of the API.

<!-- checks:end -->
