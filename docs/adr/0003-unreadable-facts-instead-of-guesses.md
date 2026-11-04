# 0003. Unreadable facts and skipped checks instead of guesses

Status: accepted

## Context

A restricted key rarely has every permission, Stripe exposes some settings only in the dashboard (retry schedule, dunning and receipt emails), and an API call can fail. An audit that treats "could not read" as "nothing wrong" produces a false clean bill of health.

## Decision

- Every resource the checks need is read into a `Fact<T>`: either `ok` (with `truncated` and `malformed` counters) or `unreadable` with a reason (`permission`, `not_available`, `api_error`, `budget`, `disabled`) and a short detail.
- Each rule declares the facts it `requires`. If one is unreadable the engine skips the rule, records why, and never calls it. A rule cannot accidentally run on missing data.
- Things the API cannot show at all (retry settings, email settings) are never guessed. Every report says so and points to `--checklist`, a list of manual items.
- Exit codes follow from this: `4` when a check was skipped because of missing permissions, `3` when it was skipped because of API errors or the request budget, `1` for findings, `0` otherwise. `3` and `4` outrank `1`: a run that could not see everything must not look like a verdict on everything. The report still lists every finding. Checks the user switched off (`--skip-customer-lookup`, events not requested) do not change the exit code.
- A listing cut by the page cap is flagged, and counts in the evidence say "at least".
- Where a finding rests on an approximation, the evidence says so. Example: the age of a past-due subscription is counted from its oldest open invoice, or from the start of its current period when no open invoice was listed, and the evidence calls that a lower bound.

## Consequences

- The skipped list tells the person running the audit exactly which permission to add.
- A key limited to a few resources produces a useful partial report and exit code 4 instead of a misleading clean one.
- Each rule's `not_applicable` outcome (for example "no subscription is set to cancel") is also visible in the check list, so a reader can tell "passed" from "nothing to check".
