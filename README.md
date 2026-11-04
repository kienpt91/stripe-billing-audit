# stripe-billing-audit

A read-only command-line audit of the billing setup of a Stripe account. Point it at a **restricted key with read permissions** and it reports concrete gaps in webhook endpoints, subscriptions, failed-payment handling, invoices, the Billing portal, tax settings and currencies, each with the evidence it saw, why it matters and a suggested fix. It is meant for the request "review our Stripe billing and make it reliable": run it first, hand the Markdown report to the client, and fix the findings.

- **Read-only by construction.** GET requests to a fixed allowlist of eleven paths. It never writes to Stripe, and the source tree cannot write to disk or start a process (an architecture test fails otherwise).
- **No personal data in the report.** Customer emails, names and addresses are never kept or printed; the tool lists no customers and searches nothing, and reads a customer object only for two checks (`--skip-customer-lookup` turns that off); ids are shortened; webhook URLs are masked. Read [what exactly that means](#personal-data) before you rely on it.
- **Honest about what it cannot see.** A resource the key cannot read skips the checks that need it, with the reason, and the run exits 4 instead of pretending to be clean. A check that found nothing in only part of the data (a page cap, the customer lookup cap, a lookup that failed part way) is reported as **inconclusive**, never as passed, and the exit code says so. Retry and dunning settings are not exposed by the Stripe API; the report says so and `--checklist` lists what to look at by hand.
- **Zero runtime dependencies.** Node 24 built-ins only (`fetch`, `parseArgs`).

It has been tested against a fake Stripe server on loopback, not against a real Stripe account (see [Limitations](#limitations-and-what-was-not-verified)).

## Quick start

Create a restricted key in the Stripe dashboard (Developers, API keys, Create restricted key) with the **Read** permission for the resources in [docs/checks.md](docs/checks.md#permissions): webhook endpoints, subscriptions, invoices, customers, prices, products, the customer portal, tax settings and tax registrations (events too if you want `--include-events`). Then:

```sh
npm ci --ignore-scripts && npm run build        # Node 24 or newer
export STRIPE_API_KEY=rk_live_...               # a restricted key; read from the environment only
node dist/bin.js                                # terminal report
node dist/bin.js --markdown > stripe-audit.md   # a report to send to a client
node dist/bin.js --json | jq .summary           # machine-readable
node dist/bin.js --fail-on high                 # for CI: exit 1 when a finding is high or worse
node dist/bin.js --checklist                    # the manual items the API cannot show (no key needed)
```

The default caps read the newest 500 objects per listing (`--max-pages 5`) and look up 50 customers. On a larger account a default run therefore ends with exit code 5 and says which checks are inconclusive; raise `--max-pages` (up to 50), or pass `--allow-partial-coverage` to accept that. See [Incomplete coverage](#incomplete-coverage).

The key is never a command-line argument. The report starts with the mode (`LIVE` or `TEST`, from the key prefix). An unrestricted `sk_` key is refused unless you pass `--allow-unrestricted-key` (the tool still only reads, but the key could write).

## Demo

The output below is real. It comes from `npm run demo`, which starts the real compiled CLI against the fake Stripe server of the test suite inside a container with no network (the transcript with every run is in [docs/demo-output.txt](docs/demo-output.txt)). The account is invented; nothing here touched Stripe.

### A healthy account: exit code 0

```text
stripe-billing-audit 0.1.0: read-only Stripe billing audit
Account acct_1QAbCd…, US, default currency usd
Mode: LIVE   Key: restricted   Account API version: 2025-09-30.clover
Checked 2026-11-04T15:00:54Z, 10 requests (GET only)
Warning: API base overridden to http://127.0.0.1:43335; this is a test setup, not Stripe.

No findings.

Checks not run (switched off by the options):
  - webhook-deliveries-failing: not requested; events can embed personal data, pass --include-events
    to read them

Not readable through the Stripe API (see --checklist for what to check by hand):
- Retry schedule and the state after the last retry
- Failed-payment and renewal emails

Summary: 0 findings; checks: 22 passed, 0 failed, 2 not applicable, 1 skipped, 0 inconclusive; exit code 0 (nothing at or above the fail-on severity)
[exit code 0]  (10 requests, all GET)
```

### An account with billing gaps: exit code 1

This is the beginning and the end of a report with 17 findings; the full transcript has all of them.

```text
stripe-billing-audit 0.1.0: read-only Stripe billing audit
Account acct_1QAbCd…, US, default currency usd
Mode: LIVE   Key: restricted   Account API version: 2025-09-30.clover
Checked 2026-11-04T15:00:54Z, 12 requests (GET only)
Warning: API base overridden to http://127.0.0.1:45419; this is a test setup, not Stripe.

[HIGH] webhook-lifecycle-events-missing: 3 subscription lifecycle events not delivered
  Evidence:
    - Not delivered to any enabled endpoint: customer.subscription.updated,
      customer.subscription.deleted, invoice.payment_failed.
    - we_1HttpE… (http://hooks.example.com/stripe/…) subscribes to 2 events.
  Why it matters:
    A subscription business learns about renewals, failures and cancellations through these events.
    If one is not delivered to anything, your records and the customer's access stop matching what
    Stripe bills.
  Fix:
    Add the missing events to an enabled endpoint (or use all events), and make the handler
    idempotent on the event id. Handle checkout.session.completed to provision, invoice.paid to
    extend access, invoice.payment_failed to start recovery, customer.subscription.updated and
    customer.subscription.deleted to change or end access.

[HIGH] webhook-endpoint-http: 1 endpoint on plain HTTP
  Evidence:
    - we_1HttpE… (http://hooks.example.com/stripe/…) uses http.
  Why it matters:
    Event payloads carry billing data and travel in clear over HTTP, and the request cannot be
    trusted to come from where it claims. Stripe requires HTTPS for live-mode endpoints.
  Fix:
    Serve the endpoint over HTTPS with a valid certificate and update the endpoint URL. Keep
    verifying the Stripe-Signature header regardless of the transport.

[HIGH] subscription-delinquent: 1 subscription failing for 7+ days
  Evidence:
    - past_due: 1 subscription, oldest since 2026-09-30 (35 days): sub_1PastD….
    - Threshold: 7 days, counted from the oldest open invoice of the subscription, or from the start
      of its current period when no open invoice was listed (so a lower bound).
  Why it matters:
    A subscription that stays in a failing state is revenue you are owed and have not collected, and
    usually a customer who still has, or has silently lost, access. The longer it lasts the less
    likely it is recovered.
  Fix:
    Decide the end state of failed payments (Dashboard, Billing, Revenue recovery: cancel, mark
    unpaid or leave past due), contact the customers with the oldest failures, and make the
    application treat past_due and unpaid explicitly instead of as active. The Billing portal link
    lets a customer update the card themselves.

[HIGH] customer-no-default-payment-method: 1 subscription with no payment method on file, set to charge automatically
  Evidence:
    - 1 subscription: sub_1PastD….
    - Neither the subscription nor its customer has a default payment method or source.
  Why it matters:
    A subscription set to charge automatically with no default payment method on the subscription or
    the customer will fail its next renewal. It becomes past_due, costs a failed-payment cycle and
    often a customer.
  Fix:
    Ask these customers to add a payment method (the Billing portal's update-payment-method link
    works), or switch the subscription to send_invoice if invoicing is intended. Collect the payment
    method at checkout with setup_future_usage or a Checkout subscription session so it is saved as
    the default.

[HIGH] trial-ending-without-payment-method: 1 trial ending within 7 days with no payment method
  Evidence:
    - sub_1Trial…; the first ends 2026-11-06 (in 1 days).
    - Behaviour when the trial ends without a payment method: create_invoice.
  Why it matters:
    When a trial ends with no payment method the first invoice cannot be paid: the customer is
    cancelled, paused or left past due, depending on the trial settings, at the moment they have
    just decided to stay.
  Fix:
    Collect a payment method before the trial ends (Checkout with payment_method_collection=always,
[... 140 lines left out of this transcript ...]
[LOW] currency-mixed: 2 currencies in use
  Evidence:
    - Active recurring prices: eur (1), usd (1).
    - Live subscriptions: eur (1), usd (4).
    - Account default currency: usd.
  Why it matters:
    Several currencies multiply the reporting, tax and reconciliation work, expose you to
    exchange-rate swings on settlement and make revenue figures hard to compare. It is sometimes
    deliberate, so this is for review, not a defect.
  Fix:
    Confirm that each currency is intended. If not, archive the prices in the stray currency and
    move the subscriptions. If it is, make sure your reporting, tax settings and payouts handle each
    currency.

Checks not run (switched off by the options):
  - webhook-deliveries-failing: not requested; events can embed personal data, pass --include-events
    to read them

Not readable through the Stripe API (see --checklist for what to check by hand):
- Retry schedule and the state after the last retry
- Failed-payment and renewal emails

Summary: 17 findings (7 high, 6 medium, 4 low); checks: 4 passed, 17 failed, 3 not applicable, 1 skipped, 0 inconclusive; exit code 1 (findings at or above medium)
[exit code 1]  (12 requests, all GET)
```

### A key that cannot read everything: exit code 4

The key may not read tax data or the Billing portal. The checks that need them are listed as skipped, with the HTTP status, instead of silently passing.

```text
stripe-billing-audit 0.1.0: read-only Stripe billing audit
Account acct_1QAbCd…, US, default currency usd
Mode: LIVE   Key: restricted   Account API version: 2025-09-30.clover
Checked 2026-11-04T15:00:54Z, 12 requests (GET only)
Warning: API base overridden to http://127.0.0.1:41801; this is a test setup, not Stripe.

[HIGH] webhook-lifecycle-events-missing: 3 subscription lifecycle events not delivered
  Evidence:
    - Not delivered to any enabled endpoint: customer.subscription.updated,
      customer.subscription.deleted, invoice.payment_failed.
    - we_1HttpE… (http://hooks.example.com/stripe/…) subscribes to 2 events.
  Why it matters:
[... 162 lines left out of this transcript ...]
    lacks the read permission for this resource
  - portal-missing: billing portal configurations: HTTP 403: the key lacks the read permission for
    this resource
  - portal-no-payment-method-update: billing portal configurations: HTTP 403: the key lacks the read
    permission for this resource
  - portal-no-cancellation: billing portal configurations: HTTP 403: the key lacks the read
    permission for this resource
  - portal-no-legal-links: billing portal configurations: HTTP 403: the key lacks the read
    permission for this resource
  - tax-automatic-disabled: tax registrations: HTTP 403: the key lacks the read permission for this
    resource
  - tax-settings-incomplete: tax settings: HTTP 403: the key lacks the read permission for this
    resource

Checks not run (switched off by the options):
  - webhook-deliveries-failing: not requested; events can embed personal data, pass --include-events
    to read them

Not readable through the Stripe API (see --checklist for what to check by hand):
- Retry schedule and the state after the last retry
- Failed-payment and renewal emails

Summary: 13 findings (5 high, 5 medium, 3 low); checks: 4 passed, 13 failed, 0 not applicable, 8 skipped, 0 inconclusive; exit code 4 (checks skipped: a resource was not available to this key)
[exit code 4]  (12 requests, all GET)
```

### Partial coverage: exit code 5, and exit code 3

A listing longer than the page cap leaves the checks that found nothing in it inconclusive, and the run exits 5 (`--allow-partial-coverage` accepts that and the run exits 0, with the same report). An API failure in the middle of the customer lookups is reported as such and exits 3, whatever the options:

```text
[... 13 lines left out of this transcript ...]
  - subscription-delinquent: subscriptions: stopped at the page cap (1 page of 100); older objects
    were not examined
  - subscription-cancel-at-period-end-no-winback: subscriptions: stopped at the page cap (1 page of
    100); older objects were not examined
  - customer-no-default-payment-method: subscriptions: stopped at the page cap (1 page of 100);
    older objects were not examined
  - trial-ending-without-payment-method: subscriptions: stopped at the page cap (1 page of 100);
    older objects were not examined
  - tax-automatic-disabled: subscriptions: stopped at the page cap (1 page of 100); older objects
    were not examined
  - tax-settings-incomplete: subscriptions: stopped at the page cap (1 page of 100); older objects
    were not examined
  - currency-mixed: subscriptions: stopped at the page cap (1 page of 100); older objects were not
    examined

Partial coverage (what was not examined, so counts above are lower bounds):
  - subscriptions [cap]: stopped at the page cap (1 page of 100); older objects were not examined

Not readable through the Stripe API (see --checklist for what to check by hand):
- Retry schedule and the state after the last retry
- Failed-payment and renewal emails

Summary: 0 findings; checks: 17 passed, 0 failed, 0 not applicable, 1 skipped, 7 inconclusive; exit code 5 (partial coverage: a cap left checks inconclusive)
[exit code 5]  (10 requests, all GET)

[... 34 lines left out of this transcript ...]

Summary: 0 findings; checks: 17 passed, 0 failed, 0 not applicable, 1 skipped, 7 inconclusive; exit code 0 (nothing at or above the fail-on severity)
[exit code 0]  (10 requests, all GET)

[... 5 lines left out of this transcript ...]

No findings.

Checks not run (switched off by the options):
  - webhook-deliveries-failing: not requested; events can embed personal data, pass --include-events
    to read them

Inconclusive checks (they found nothing, but only in the part of the data that was examined):
  - customer-no-default-payment-method: customer payment state: stopped after 2 of 5 customers: HTTP
    503: Stripe server error
  - trial-ending-without-payment-method: customer payment state: stopped after 2 of 5 customers:
    HTTP 503: Stripe server error

Partial coverage (what was not examined, so counts above are lower bounds):
  - customer payment state [error]: stopped after 2 of 5 customers: HTTP 503: Stripe server error

Not readable through the Stripe API (see --checklist for what to check by hand):
- Retry schedule and the state after the last retry
- Failed-payment and renewal emails

Summary: 0 findings; checks: 21 passed, 0 failed, 1 not applicable, 1 skipped, 2 inconclusive; exit code 3 (API errors left the audit incomplete)
[exit code 3]  (16 requests, all GET)
```

### Gating and refusing

`--fail-on critical` on the same account prints the same report and exits 0, because nothing is critical (the end of the output):

```text
[... 231 lines left out of this transcript ...]

Summary: 17 findings (7 high, 6 medium, 4 low); checks: 4 passed, 17 failed, 3 not applicable, 1 skipped, 0 inconclusive; exit code 0 (nothing at or above the fail-on severity)
[exit code 0]  (12 requests, all GET)
```

An unrestricted key is refused before any request is made:

```text
[stderr]
stripe-billing-audit: STRIPE_API_KEY is an unrestricted secret key (sk_...). Create a restricted key with read permissions, or pass --allow-unrestricted-key to accept the risk.
Run with --help for usage.
[exit code 2]  (no requests were made)
```

## Options and exit codes

| Option | Meaning |
| --- | --- |
| `--json` | machine-readable report; `schemaVersion` in the output, shape in [docs/json-output.md](docs/json-output.md) |
| `--markdown` | report to hand to a client |
| `--checklist` | print the manual checklist (combine with `--markdown` or `--json`); needs no key and makes no request |
| `--fail-on <severity>` | exit 1 when a finding is at least this severe: `critical`, `high`, `medium` (default), `low`, `info` |
| `--past-due-days <n>` | subscriptions failing at least this long are reported (default 7) |
| `--trial-days <n>` | trials ending within this many days need a payment method (default 7) |
| `--stale-invoice-days <n>` | invoices open at least this long are reported (default 14) |
| `--max-pages <n>` | pages of 100 objects per listing (default 5); a cut listing is reported as partial coverage, counts become lower bounds, and checks that found nothing in it are inconclusive |
| `--allow-partial-coverage` | do not exit 5 when a cap left checks inconclusive (see below); the report still shows them |
| `--max-requests <n>` | request budget for the whole run, retries included (default 150) |
| `--timeout-ms <n>` | per-request timeout (default 15000) |
| `--skip-customer-lookup` | do not retrieve customers; the two payment-method checks are skipped |
| `--include-events` | also read recent events with failed webhook deliveries (event payloads can embed personal data; they are discarded unread) |
| `--allow-unrestricted-key` | accept a full secret key (`sk_...`) and print a warning |
| `--api-base <url>` | a loopback IP origin instead of `api.stripe.com`, for tests against a fake server; any other value is refused |
| `-h`, `--help`, `-v`, `--version` | usage and version |

| Exit code | Meaning |
| --- | --- |
| 0 | no finding at or above `--fail-on`, and every check ran on all the data it needed |
| 1 | findings at or above `--fail-on` |
| 2 | usage error: bad option, missing, publishable, malformed or unrestricted key, refused API base, unsafe environment (`NODE_USE_ENV_PROXY`, `NODE_TLS_REJECT_UNAUTHORIZED=0`) |
| 3 | API or authentication error: HTTP 401, server errors or timeouts that persisted, the request budget was spent, or a lookup failed part way (some customers were checked, then an error): the audit is incomplete |
| 4 | a resource was not available to the key (HTTP 403, no permission) or to the account (HTTP 404): the checks that need it did not run and are listed |
| 5 | a cap (`--max-pages`, the 50-customer lookup) left checks **inconclusive**: they found nothing, but only in the part of the data that was examined. Raise the cap, or accept this case with `--allow-partial-coverage` |

Codes 3, 4 and 5 outrank 1 in that order, on purpose: a verdict on part of the account must not look like a verdict on all of it. The report still lists every finding. Checks you switched off yourself (`--skip-customer-lookup`, events not requested) do not change the code.

### Incomplete coverage

A check that finds nothing in a slice of the data cannot say the rest is fine, so it is never reported as `passed`. It is reported as **inconclusive**, with the cause, in the terminal report, in the Markdown report and in the JSON (`checks[].status`, `partial`):

- **cap**: a listing stopped at `--max-pages` (the newest objects are read first, older ones were not examined) or the customer lookup stopped at its cap of 50. Exit 5 unless `--allow-partial-coverage`.
- **error**: a lookup failed after some customers were checked (`stopped after 12 of 40 customers: HTTP 503`), or the request budget ran out between two lookups. Exit 3, always: `--allow-partial-coverage` does not cover failures.

A check that *does* find something in the slice is still a finding, with "at least" counts.

## What it checks

Twenty-five checks; the full catalogue with severities, why each matters and the fix is in [docs/checks.md](docs/checks.md).

| Area | Checks |
| --- | --- |
| Webhooks | no enabled endpoint (`webhook-none-enabled`); disabled endpoints; subscription lifecycle events not delivered (`checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.paid`, `invoice.payment_failed`); plain HTTP; API version drift between endpoint and account; duplicate endpoints; development hosts on live endpoints; failed deliveries (`--include-events`) |
| Subscriptions | `past_due`, `unpaid` or `incomplete` beyond N days; cancellation scheduled at period end with no way back or no cancellation reasons collected (win-back) |
| Payment methods | active subscriptions that charge automatically with no default payment method; trials ending soon with no payment method |
| Invoices and dunning | invoices open beyond N days; uncollectible invoices; invoices left open after their retries ended |
| Billing portal | no active configuration; no payment-method update; no cancellation; no privacy and terms links |
| Tax | automatic tax off on subscriptions where the account has active tax registrations; automatic tax on but tax settings pending; prices with no tax behavior; products with no tax code |
| Account | mixed currencies; objects of the other mode (test objects in a live run) |

Retry schedule and dunning emails are **not readable** through the API. The report states that and `--checklist` covers them; where the API shows the effect (invoices that ran out of retries and stayed open) a check reports it as evidence.

## Report formats

- **Terminal**: findings worst first, then skipped, switched-off and inconclusive checks, partial coverage, what the API cannot show, then a summary line. Every control character, escape sequence and bidi override in API-derived text is shown as a visible escape.
- **Markdown** (`--markdown`): headings and tables for a client. API-derived text appears only inside code spans and fenced blocks, so it cannot turn into markup.
- **JSON** (`--json`): stable schema with `schemaVersion`; see [docs/json-output.md](docs/json-output.md).

## Personal data

What is guaranteed, and by which tests:

- The tool does not call any listing of customers, any search endpoint or any `expand`. Every Stripe object is decoded by a function that picks named fields (ids, enums, counts, timestamps, booleans); emails, names, phone numbers, addresses, descriptions and metadata are dropped on arrival. The tests plant them in every fixture and assert that none reaches the terminal, Markdown or JSON output with every option on.
- Ids are shortened (`sub_1QwErT…`). Webhook URLs are reduced to scheme, host and path; every path segment that is not a short lowercase word (letters and hyphens, at most 20 characters) is replaced by `…`, and the query string, fragment and credentials are dropped. **Not masked:** the host (it identifies the endpoint, so a secret placed in a subdomain would be shown) and a secret that is itself a short lowercase word in a path segment. Duplicate endpoints are detected on a fingerprint of the whole URL, which is never printed.

What is not guaranteed: the Stripe API cannot filter fields, so a response to `GET /v1/customers/{id}` (used, for at most 50 customers, to learn whether a default payment method exists) and to `GET /v1/events` (only with `--include-events`) contains personal data in its body. That body travels over TLS to the machine running the tool, the decoder keeps one boolean (or the event type, time and counter), and the rest is discarded in memory: nothing is stored, logged or printed. `--skip-customer-lookup` and leaving events off remove those two calls. Invoice, subscription and account listings also carry some personal or business fields (customer email on invoices, free-text descriptions, the owner's email) that the decoders drop. See [ADR 0004](docs/adr/0004-personal-data-policy.md).

## Architecture

```
src/domain          facts, the 25 rules, severity, exit codes, key / URL / allowlist safety, money, calendar   (pure)
src/application     decode API JSON into facts, collect them (pagination, failures), run the audit, render reports
src/infrastructure  the GET-only HTTP reader on global fetch; the command-line parser
src/composition     wires the adapters, reads the environment, redacts output, picks the exit code
src/bin.ts          entry point
```

Imports point inward only, and `test/architecture/layers.test.ts` enforces it over the real source tree: the domain and application import no Node built-in and touch no clock, randomness, `fetch`, timers, globals or console; only the composition layer reads `process.env`; the infrastructure issues only `GET`; and no file in `src` may import `fs`, `child_process`, `net`, `http(s)`, `tls`, `dns` or `vm`. A rule is a pure function from facts to an outcome (`passed`, `not_applicable`, `failed` with evidence), so each is tested with a one-line fixture. Decisions are recorded in [docs/adr](docs/adr):

1. [Layers and the dependency rule](docs/adr/0001-layers-and-the-dependency-rule.md)
2. [Read-only by construction](docs/adr/0002-read-only-by-construction.md)
3. [Unreadable facts and skipped checks instead of guesses](docs/adr/0003-unreadable-facts-instead-of-guesses.md)
4. [Personal data: little is fetched, none is kept or printed](docs/adr/0004-personal-data-policy.md)
5. [How the API key is handled](docs/adr/0005-key-handling.md)
6. [Zero runtime dependencies and the supply-chain policy](docs/adr/0006-no-runtime-dependencies.md)
7. [Report formats and the JSON schema version](docs/adr/0007-report-formats-and-schema.md)

## Threat model (summary)

The API's answers are untrusted (a crafted account, a proxy, a mock on the wrong port). The key is read from the environment, sent only to `api.stripe.com` or a loopback IP, never follows a redirect, and is never in a fact, error or report; a last-line redaction removes key-shaped text from everything printed, usage errors included. The tool refuses to run with `NODE_USE_ENV_PROXY` (the key would go to a proxy) or `NODE_TLS_REJECT_UNAUTHORIZED=0`, and reports `NODE_EXTRA_CA_CERTS`. Hostile JSON (huge bodies, wrong types, deep nesting, endless cursors, control characters) cannot crash the tool or reach the terminal unescaped. The full table with residual risks is in [SECURITY.md](SECURITY.md).

## Tests and coverage

Run in a throwaway container, offline. Every test talks to an in-memory fake or to a fake Stripe server on a loopback port (`node:http`) that serves objects in the shape of the public API reference, checks the bearer key, pages lists, denies paths like a restricted key and misbehaves on demand.

| Layer | Tests | What they cover |
| --- | ---: | --- |
| Domain | 154 | every rule over small fixtures (passed, failed, not applicable, skipped), severity and exit-code precedence, report model, key classification, API base restriction, path allowlist, redaction, request budget, calendar and money arithmetic, id shortening, URL masking and fingerprints, partial coverage in the engine (inconclusive versus passed, not applicable and failed), exit-code precedence; property tests for text sanitising, id truncation and calendar arithmetic |
| Application | 58 | decoders against hostile and random input (property test: never throws) and against fixtures with planted personal data; the collector against an in-memory API: pagination (property test: exactly `min(total, cap)` objects, no duplicates, whatever the page size), caps, non-advancing cursors, every failure kind, bounded customer lookup including a failure part way through it (every failure kind, cap versus error versus budget); terminal, Markdown and JSON renderers with golden files and property tests over hostile strings |
| Infrastructure | 32 | the HTTP reader against a real loopback server: bearer key, allowlist refusal, 401/403/404/4xx, 429 with `Retry-After` and exponential backoff, 5xx, budget, timeout, size limit on a streamed body, invalid JSON, a redirect that must not be followed, unreachable host, key never echoed; the argument parser |
| Architecture | 50 | the dependency rule over every source file, plus tests of the checker itself |
| End to end | 129 | 124 through `runCli` with real `fetch` against the fake Stripe server (clean and troubled accounts, test and live keys, every exit code, thresholds, options, every output format, personal data and secrets never printed, a matrix of nine hostile answers on each of nine endpoints, an oversized body, a server that echoes the key; failures in the middle of the customer lookup, the page cap and the 50-customer cap with and without `--allow-partial-coverage`, a 404, an environment proxy, a key typed as an option name); 5 through the compiled `dist/bin.js` as a child process in an empty directory (nothing is written there) |
| Docs | 26 | `docs/checks.md` is generated from the rule catalogue and must match it, version and changelog agree, no runtime dependencies, exact pins, every option and exit code is in this README, no broken relative links |
| **Total** | **449** | all passing |

Coverage, measured with `npm run coverage` (V8; the thresholds below fail the run and CI):

| Layer | Statements | Lines | Threshold |
| --- | ---: | ---: | --- |
| `src/domain` | 99.84 % | 100 % | 95 % lines and statements |
| `src/application` | 99.44 % | 99.66 % | 90 % |
| `src/infrastructure` | 94.92 % | 97.80 % | (overall) |
| `src/composition` | 90.16 % | 92.59 % | (overall) |
| **All files** | **98.71 %** | **99.23 %** | 85 % |

Branches overall: 95.14 %, functions 97.35 %.

`src/composition/main.ts` (the three lines that connect `process` to `runCli`) is exercised only by the compiled-binary tests, which run in a child process that V8 coverage in the test process does not see; `src/bin.ts` is excluded for the same reason.

Run it yourself without a host Node install:

```sh
docker run --rm -v "$PWD":/work -w /work node:24 sh -c 'npm ci --ignore-scripts && npm run typecheck && npm run coverage'
```

## Limitations and what was not verified

- **Not tested against a real Stripe account.** The fake server reproduces the shape of the objects from the public API reference, not recorded production traffic. A field Stripe returns differently from what the decoders expect shows up as a missing value (a skipped or `not_applicable` check, or objects counted as ignored), not as a crash, but it can also mean a check misses something real. The first real run is the real test; please read the evidence lines.
- **Permission names are unverified.** `docs/checks.md` lists the endpoints and the resource behind each. How the dashboard names the matching restricted-key permissions was not checked; a missing permission shows up as a skipped check with HTTP 403.
- **Approximations, stated in the evidence:** the age of a failing subscription is counted from its oldest open invoice, or from its current period start when no open invoice was listed (a lower bound); the win-back check can only see whether the Billing portal lets customers undo a cancellation and asks why, not whether you send a win-back email; the account's default API version is taken from the `Stripe-Version` response header of the account call; "development host" for webhook URLs is a list of common patterns (localhost, private ranges, `.local`, `.test`, ngrok, Cloudflare quick tunnels and similar).
- **Not read at all:** retry and dunning settings, email settings, your webhook handler's code. Connect platforms and multi-account setups were not considered.
- **Caps are strict by default:** 5 pages of 100 objects per listing, 50 customer lookups. A check that found nothing in a capped listing is inconclusive and the run exits 5 until you raise `--max-pages` or pass `--allow-partial-coverage`; the customer lookup cap is not configurable. Findings in a capped listing are real but their counts are lower bounds.
- Developed and tested on macOS (editing) and Linux (containers); Windows was not tried. Node 24 is required. The tool refuses `NODE_USE_ENV_PROXY`; Node command-line flags (`--use-openssl-ca`, `--use-env-proxy`) and operating-system proxy or trust-store settings cannot be seen from inside the process and are not checked.
- No real MCP or other client is involved; this is a plain CLI.

## Development

```sh
npm ci --ignore-scripts
npm run typecheck && npm test      # offline suite
npm run coverage                   # with thresholds
npm run build                      # dist/
npm run demo                       # build, then run the demo transcript (see above)
npm run check:deps-age             # every locked package at least 7 days old
sh scripts/secret-scan.sh --tree   # also run by the git hooks (lefthook) and CI
```

Git hooks ([lefthook](https://github.com/evilmartians/lefthook)) run the secret scanner before a commit and a push, and a message guard on commits. Key-shaped strings in tests are assembled at run time and never written literally; `.secret-scan-allow` is empty. Releases are cut from a tag by a workflow that verifies, builds, checksums and attests; see [RELEASING.md](RELEASING.md). Changes are listed in [CHANGELOG.md](CHANGELOG.md).

## License

MIT, see [LICENSE](LICENSE). Copyright (c) 2026 Kien Phan.
