# 0002. Read-only by construction

Status: accepted

## Context

The tool is pointed at a live payment account by someone who has not read its code. "It only reads" has to be true of the design, not of the current implementation.

## Decision

Four independent barriers, each tested:

1. **The reader has no write path.** `StripeReader` exposes `get(path, query)`. The HTTP adapter hard-codes `method: "GET"`, and the architecture test fails on any other method literal in the infrastructure layer.
2. **A hard allowlist.** `validateRead` accepts eleven paths (`/v1/account`, `webhook_endpoints`, `subscriptions`, `invoices`, `prices`, `products`, `billing_portal/configurations`, `tax/settings`, `tax/registrations`, `events`, and `customers/cus_...`) with a fixed set of query parameters per path and a strict value grammar (`[A-Za-z0-9_]{1,64}`). The adapter calls it before every request. There is no `expand`, so no related object is pulled in.
3. **The key goes to one of two places.** `https://api.stripe.com`, or a loopback IP origin named with `--api-base` for tests. Host names are refused (a name can resolve anywhere), as are credentials, paths and queries. Redirects are never followed (`redirect: "error"`), so the `Authorization` header cannot be forwarded. `NODE_TLS_REJECT_UNAUTHORIZED=0` is refused when the real API is the target, and so is `NODE_USE_ENV_PROXY` (it would make `fetch` send the key to the proxy named in `HTTP_PROXY` / `HTTPS_PROXY`). `NODE_EXTRA_CA_CERTS` is allowed, because corporate networks need it, and is shown as a warning in the report. Node command-line flags (`--use-openssl-ca`, `--use-env-proxy`) cannot be seen from inside the process and are not checked.
4. **No other ways out.** The source tree cannot import `fs`, `child_process`, `net`, `http` and friends (ADR 0001), so the report goes to standard output and nothing is written to disk.

Every request, retries included, takes one unit from a run-wide budget (`--max-requests`, default 150). Listings stop at a page cap (`--max-pages`, default 5 pages of 100). Responses are limited to 5 MiB, requests to 15 s. HTTP 429 and 5xx are retried at most three times with exponential backoff, honouring `Retry-After` up to ten seconds.

## Consequences

- A permission test is possible by construction: the fake server records every request, and the end-to-end tests assert that all of them are `GET` and on the allowlist.
- Adding a check that needs a new endpoint means editing the allowlist, which is a visible, reviewed line in the domain layer.
- The tool cannot be pointed at a staging proxy with a name; that is deliberate.
- The restricted key is still the primary control: if the key can only read, even a bug here cannot write. The tool refuses unrestricted `sk_` keys unless `--allow-unrestricted-key` is given (ADR 0005).
