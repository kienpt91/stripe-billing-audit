# Security

## Reporting a vulnerability

Please use GitHub's private vulnerability reporting for this repository, or email kienphan.dev@gmail.com. Do not open a public issue for a vulnerability. This is a personal open-source project maintained on a best-effort basis: there is no service level and no bounty.

## What the tool is, and the safety boundary

`stripe-billing-audit` is defensive, read-only tooling. It reads the billing configuration of a Stripe account and prints a report. The boundary, enforced in code and covered by tests:

- **It never writes to Stripe.** The HTTP adapter can only issue `GET` (the architecture test fails on any other method), every request is checked against a hard allowlist of eleven paths with fixed query parameters, and the end-to-end tests assert that every request the fake server received was a `GET` on that list.
- **It never writes to disk and starts no process.** No file in `src` may import `fs`, `child_process`, `net`, `http(s)`, `tls`, `dns` or `vm` (checked by `test/architecture/layers.test.ts`). The only network access is global `fetch`. Output goes to standard output and standard error.
- **The key goes to one place.** `https://api.stripe.com`, or a loopback IP named with `--api-base` for tests. Host names, credentials, paths and queries in `--api-base` are refused. Redirects are never followed. `NODE_TLS_REJECT_UNAUTHORIZED=0` is refused when the real API is the target.
- **The key comes from the environment only** (`STRIPE_API_KEY`), never from an argument. It is not stored, logged, written to a report or included in an error, and everything printed passes through a redaction step that replaces anything shaped like a Stripe key or signing secret. Unrestricted `sk_` keys are refused unless `--allow-unrestricted-key` is given. See [ADR 0005](docs/adr/0005-key-handling.md).
- **Personal data is neither requested nor kept.** No search, no `expand`, no customer listing. Decoders pick named fields and drop everything else; ids are shortened in reports; webhook URLs are reduced to scheme, host and a masked path. Customer objects are retrieved only for the payment-method checks (disable with `--skip-customer-lookup`), and event payloads only with `--include-events`. See [ADR 0004](docs/adr/0004-personal-data-policy.md) for what this does and does not guarantee.
- **Bounded.** A request budget for the whole run, page caps per listing, 5 MiB per response, a per-request timeout, and capped retries with backoff on HTTP 429 and 5xx.

## Threat model

The API's answers are **untrusted**: a compromised proxy, a mock server on the wrong port or a crafted account (webhook URLs and event types are attacker-influenced in a shared account) can send anything.

| Threat | What the tool does about it | Residual risk |
| --- | --- | --- |
| The key is leaked through output, logs or an error message | The key is a local variable and a request header. Errors carry only a failure kind, an HTTP status and a well-formed error code, never the server's message (which can echo the key). A last-line redaction replaces key-shaped text and the exact key. A server that echoes the key in ids, URLs and event types is a tested case. | The redaction pattern knows the Stripe key and webhook secret shapes; a different secret in a response would not be recognised, but responses are decoded to typed fields, so free text rarely reaches the output. |
| The key is sent to the wrong host | Fixed origin or loopback IP; names refused; no redirects; the allowlist rejects other paths. | `HTTPS_PROXY`-style settings of the process environment are not consulted by `fetch` unless Node is started with `NODE_USE_ENV_PROXY`; if you enable that, the proxy sees the traffic. |
| The tool changes something in the account | GET only, allowlist, architecture test, end-to-end assertion on recorded requests. | A restricted key remains the primary control. A bug in the allowlist would still only reach GET endpoints. |
| Hostile JSON crashes the tool or fills memory | 5 MiB response cap read as a stream, strict decoders that never throw on wrong types, page and request caps, objects beyond 100 per page ignored, repeated ids de-duplicated, a cursor that does not advance ends the listing. Tests run every endpoint against `null`, arrays, strings, junk entries, invalid JSON, 100 000-level nesting, an endless cursor and control characters. | A server that answers slowly but within the timeout stretches the run up to the budget times the timeout. |
| Terminal escape sequences or bidi text in the output | Every dynamic string is shown through `visibleText`: control characters, ESC, bidi overrides, zero-width characters and lone surrogates become visible escapes. Property tests feed random hostile strings. | None known for a terminal; text you paste elsewhere is your responsibility. |
| Markup injection in the Markdown report | Dynamic text only appears in code spans and fenced blocks whose delimiter is longer than any backtick inside; titles are escaped. | A renderer that treats fenced blocks specially is outside the tool's control. |
| Personal data ends up in a report sent to a client | Allowlist decoders, truncated ids, masked URLs; tests plant emails, names, addresses and phone numbers in every fixture and check all three output formats. | Customer and event responses carry personal data over TLS into the memory of the process, where the decoder drops it. Use `--skip-customer-lookup` and leave `--include-events` off to avoid those two calls. |
| A webhook URL carries a secret | The report shows scheme, host and a path whose long segments are masked; query, fragment and credentials are dropped. | A short secret in a path segment (under 20 characters) is shown. |
| The report claims "clean" when it could not look | Unreadable resources skip the checks that need them, with the reason. Exit code 3 or 4 outranks findings and clean. | The tool trusts what the API returns for readable resources. |
| Supply chain | No runtime dependencies; four development dependencies, pinned, at least seven days old; `--ignore-scripts`; SHA-pinned actions; secret scanner in hooks and CI. | A compromised development dependency could affect the build. |

## What is and is not guaranteed

Guaranteed, by tests in this repository: GET only, allowlisted paths only, no filesystem or process access from the source tree, no key or key-shaped text in any output the fake servers could provoke, no personal data from fixtures in any output.

Not verified: behaviour against a real Stripe account (the fake server reproduces the shape of the objects from the public API reference, not recorded production traffic), the exact permission names shown in the Stripe dashboard for a restricted key, Windows, and behaviour under `NODE_USE_ENV_PROXY`.

## Dependency policy

- No runtime dependencies. Development dependencies: `typescript`, `vitest`, `@vitest/coverage-v8`, `@types/node`; exact pins and a committed `package-lock.json`.
- Every locked package was published at least seven days before it was added (`npm run check:deps-age`; resolved with `npm install --before=...`). Installs and builds run with `--ignore-scripts`; no dependency needs an install script.
- GitHub Actions are pinned to full commit SHAs; the workflows default to `contents: read`. Dependabot proposes updates after a seven-day cooldown and ignores major bumps of `typescript` and `@types/node`.
