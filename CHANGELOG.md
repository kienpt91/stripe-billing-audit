# Changelog

## 0.1.0

First release.

- Read-only audit of a Stripe account's billing setup with a restricted key from `STRIPE_API_KEY`: 25 checks over webhook endpoints, subscriptions, payment methods, invoices and dunning, the Billing portal, tax settings and currencies.
- Terminal report, `--json` (schema version 1) and `--markdown` output; `--checklist` for the manual items the API cannot show.
- Exit codes: 0 clean, 1 findings at or above `--fail-on`, 2 usage error, 3 API or authentication error, 4 permission error that made checks impossible.
- GET-only reader with a hard path allowlist, request budget, page caps, timeouts, backoff on 429 and 5xx, response size limit and no redirects.
- No runtime dependencies. Tests against a fake Stripe server on loopback.
