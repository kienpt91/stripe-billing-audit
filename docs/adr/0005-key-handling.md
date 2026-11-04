# 0005. How the API key is handled

Status: accepted

## Decision

- The key comes only from the `STRIPE_API_KEY` environment variable. It is never a command-line argument (it would show up in the process list and shell history), and a positional argument is rejected without being echoed.
- It is classified from its prefix and nothing else: `rk_` restricted, `sk_` unrestricted secret, `pk_` publishable (refused), `live` or `test` mode. No call is made to "validate" it.
- An unrestricted `sk_` key is refused unless `--allow-unrestricted-key` is passed; then the report carries a warning. A restricted key is the intended credential.
- The mode is printed in every report and in the JSON, so a run against live data is never a surprise.
- The key lives in one string in the composition layer and in the `Authorization` header of the HTTP reader. It is not in a fact, a report, an error or a log line. Failures are reported as a kind and an HTTP status plus Stripe's machine-readable error code (only when it matches `[a-z_]{1,40}`); the error message, which can echo part of the key, is never read.
- As the last line of defence, everything printed passes through `redactSecrets`, which replaces anything shaped like a Stripe key or signing secret, and the exact key, with `[redacted]`. If redaction changed anything, a notice goes to standard error.
- The key is never written anywhere: the source tree cannot import `fs`.
- Test keys are assembled at run time (`fakeKey`), so the repository contains no key-shaped literal. The secret scanner (pre-commit, pre-push, CI) enforces that.

## Consequences

- A hostile or compromised server that echoes the key back in a body, an id or a URL still cannot make the tool print it (tested).
- The user sees why a key was refused (missing, publishable, malformed, unrestricted) without the value being repeated.
