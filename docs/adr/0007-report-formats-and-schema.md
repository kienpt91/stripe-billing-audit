# 0007. Report formats and the JSON schema version

Status: accepted

## Decision

One `AuditReport` value is built in the domain and rendered three ways in the application layer: terminal text, Markdown for a client, and JSON.

- The JSON carries `schemaVersion` (currently 1) and a fixed key order. The version changes only when a key is removed, renamed or changes meaning; adding a key does not. The shape is documented in `docs/json-output.md` and pinned by a golden-file test and a key-order test.
- Terminal output makes every control character, escape sequence, bidi override and zero-width character visible (`\x1B`, `\u{202E}`). Markdown output puts every dynamic string inside a code span or a fenced block whose fence is longer than any backtick run inside; static text is ours.
- Golden files for the terminal, Markdown and JSON output are compared in tests; `UPDATE_GOLDEN=1` rewrites them for a deliberate change.
- Every finding carries an id, severity, evidence lines, why it matters and a suggested fix. Evidence is built from validated, typed facts only.
- The report lists every check with its status (`passed`, `failed`, `not_applicable`, `skipped`, `inconclusive`), so a clean run shows what was and was not looked at. Resources read only in part are listed under `partial` with their cause (`cap`, `api_error`, `budget`) and what was and was not examined; the terminal and Markdown reports have a section for inconclusive checks and one for partial coverage.

## Consequences

- A script can gate on the exit code, or parse the JSON and rely on the version.
- The Markdown report is safe to paste into a client document without review for injected markup.
