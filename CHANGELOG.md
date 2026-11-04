# Changelog

## 0.1.0

First release.

- Read-only audit of a Stripe account's billing setup with a restricted key from `STRIPE_API_KEY`: 25 checks over webhook endpoints, subscriptions, payment methods, invoices and dunning, the Billing portal, tax settings and currencies.
- Terminal report, `--json` (schema version 1) and `--markdown` output; `--checklist` for the manual items the API cannot show.
- Exit codes: 0 clean, 1 findings at or above `--fail-on`, 2 usage error, 3 API or authentication error (including a lookup that failed part way), 4 a resource the key or the account cannot give (403, 404) made checks impossible, 5 a cap left checks inconclusive (`--allow-partial-coverage` accepts that case).
- Incomplete coverage is explicit: a check that found nothing in only part of the data (page cap, 50-customer cap, failure part way) is `inconclusive` with the cause, never `passed`; partial resources are listed in the terminal, Markdown and JSON reports.
- Webhook URLs are shown with every path segment that is not a short lowercase word masked; duplicate endpoints are compared on a fingerprint of the whole URL.
- Usage errors are redacted; `NODE_USE_ENV_PROXY` is refused and `NODE_EXTRA_CA_CERTS` is reported.
- GET-only reader with a hard path allowlist, request budget, page caps, timeouts, backoff on 429 and 5xx, response size limit and no redirects.
- No runtime dependencies. Tests against a fake Stripe server on loopback.
