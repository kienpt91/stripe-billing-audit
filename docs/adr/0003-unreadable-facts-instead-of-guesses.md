# 0003. Unreadable facts and skipped checks instead of guesses

Status: accepted

## Context

A restricted key rarely has every permission, Stripe exposes some settings only in the dashboard (retry schedule, dunning and receipt emails), and an API call can fail. An audit that treats "could not read" as "nothing wrong" produces a false clean bill of health.

## Decision

- Every resource the checks need is read into a `Fact<T>`: either `ok` (with a `partial` marker, see below, and a `malformed` counter) or `unreadable` with a reason (`permission`, `not_available`, `api_error`, `budget`, `disabled`) and a short detail.
- Each rule declares the facts it `requires`. If one is unreadable the engine skips the rule, records why, and never calls it. A rule cannot accidentally run on missing data.
- **Partial coverage is a first-class outcome.** A fact that was read only in part (`partial`) carries a cause: `cap` (a listing stopped at `--max-pages`, the customer lookup at its cap of 50, the events at one page), `api_error` or `budget` (a lookup failed, or the request budget ran out, after some progress). A rule that finds *nothing* in such a slice cannot say the rest is fine, so the engine reports its check as `inconclusive`, with the cause, instead of `passed` (or `not_applicable`, unless the reason does not depend on the data, like the mode of the key). A rule that finds something still reports a finding, with "at least" counts. The report lists the partial resources with their cause, in the terminal, Markdown and JSON.
- **Exit codes** follow, in order of precedence:
  - `3`: a resource could not be read because of an API error or the request budget, **or** was read only in part because of one (a lookup failed after some customers were checked). `--allow-partial-coverage` does not cover this.
  - `4`: a resource was not available to the key (HTTP 403) or to the account (HTTP 404), so its checks did not run.
  - `5`: a cap left at least one check inconclusive. This is the default behaviour; `--allow-partial-coverage` accepts it (the report still shows the inconclusive checks).
  - `1`: findings at or above `--fail-on`.
  - `0`: otherwise.

  `3`, `4` and `5` outrank `1`: a run that did not see everything must not look like a verdict on everything. The report still lists every finding. Checks the user switched off (`--skip-customer-lookup`, events not requested) do not change the exit code.
- The default is strict on purpose. The default caps (5 pages of 100 per listing, 50 customer lookups) are small, so on a larger account a default run exits 5; raise `--max-pages` or accept it explicitly. The alternative, a clean exit with a footnote, is the false assurance this decision exists to prevent.
- Things the API cannot show at all (retry settings, email settings) are never guessed. Every report says so and points to `--checklist`, a list of manual items.
- Where a finding rests on an approximation, the evidence says so. Example: the age of a past-due subscription is counted from its oldest open invoice, or from the start of its current period when no open invoice was listed, and the evidence calls that a lower bound.

## Consequences

- The skipped list tells the person running the audit exactly which permission to add.
- A key limited to a few resources produces a useful partial report and exit code 4 instead of a misleading clean one.
- Each rule's `not_applicable` and `inconclusive` outcome (for example "no subscription is set to cancel") is also visible in the check list, so a reader can tell "passed" from "nothing to check".
