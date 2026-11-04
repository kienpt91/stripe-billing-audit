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
| High | 0 |
| Medium | 0 |
| Low | 0 |
| Info | 0 |

25 checks ran: 23 passed, 0 failed, 2 not applicable, 0 skipped, 0 inconclusive.

## Findings

No findings.

## Not visible through the Stripe API

These matter for reliable billing but Stripe does not expose them, so they were not guessed. Check them by hand:

- **Retry schedule and the state after the last retry**: Dashboard, Billing, Revenue recovery, Retries. Smart Retries (or a custom schedule) is on, the number of retries and the window suit your product, and the setting for what happens to the subscription when the last retry fails (cancel, mark unpaid, leave past due) matches how your application treats access. Retry settings cannot be read through the API.
- **Failed\-payment and renewal emails**: Dashboard, Settings, Billing, Subscriptions and emails. Emails for failed payments, upcoming renewals and expiring cards are on or replaced by your own, and each carries a link where the customer can update the card (a Billing portal session). Email settings cannot be read through the API.

## Scope and method

The audit made 17 read-only GET requests to a fixed list of Stripe endpoints. It wrote nothing to the account. It does not request customer emails, names or addresses, and this report contains none; object ids are shortened. The API key is not stored or printed.
