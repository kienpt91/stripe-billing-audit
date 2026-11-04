# JSON output

`stripe-billing-audit --json` prints one JSON document. `schemaVersion` is an integer that changes only when a key is removed or renamed, or when a key changes meaning; keys may be added without a bump. The key order below is fixed and checked by a test, and `test/golden/troubled.json` pins a full example.

```jsonc
{
  "schemaVersion": 1,
  "tool": { "name": "stripe-billing-audit", "version": "0.1.0" },
  "generatedAt": "2026-10-26T07:33:20Z",          // UTC, second precision
  "account": {
    "id": "acct_1QAbCd…",                           // shortened; null when the account could not be read
    "mode": "live",                                 // "live" | "test", from the key prefix
    "keyKind": "restricted",                        // "restricted" | "secret"
    "country": "US",                                // null when not read
    "defaultCurrency": "usd",                       // null when not read
    "apiVersion": "2025-09-30.clover"               // account default version from the Stripe-Version response header; null when not reported
  },
  "options": {
    "failOn": "medium",
    "thresholds": { "pastDueDays": 7, "trialDays": 7, "staleInvoiceDays": 14 },
    "customerLookup": true,
    "includeEvents": false,
    "allowPartialCoverage": false
  },
  "summary": {
    "findings": 16,
    "bySeverity": { "critical": 0, "high": 7, "medium": 6, "low": 3, "info": 0 },
    "checks": { "passed": 5, "failed": 16, "not_applicable": 3, "skipped": 1, "inconclusive": 0 }
  },
  "findings": [                                     // worst first, then in catalogue order
    {
      "id": "webhook-endpoint-http",                // a stable check id, see docs/checks.md
      "category": "webhooks",                       // webhooks | subscriptions | invoices | customers | portal | tax | account
      "severity": "high",                           // critical | high | medium | low | info
      "title": "1 endpoint on plain HTTP",
      "evidence": ["we_1HttpE… (http://hooks.example.com/stripe/…) uses http."],
      "why": "…",
      "fix": "…"
    }
  ],
  "checks": [                                       // every check, in catalogue order
    { "id": "webhook-none-enabled", "category": "webhooks", "summary": "…", "status": "passed", "detail": null }
    // status: "passed" | "failed" | "not_applicable" | "skipped" | "inconclusive"
    // detail says why for the last three; "inconclusive" means the check found nothing, but only in part of the data (see "partial")
  ],
  "skipped": [                                      // checks that could not read what they need
    { "checkId": "invoice-uncollectible", "reason": "permission", "resource": "uncollectible invoices", "detail": "HTTP 403: …" }
    // reason: "permission" | "not_available" | "api_error" | "budget" | "disabled"
  ],
  "partial": [                                      // resources read only in part: counts for them are lower bounds
    { "resource": "subscriptions", "cause": "cap", "detail": "stopped at the page cap (5 pages of 100); older objects were not examined" }
    // cause: "cap" (page cap, 50-customer cap, one page of events) | "api_error" | "budget" (a failure or the budget ended a lookup after some progress)
  ],
  "ignoredObjects": 0,                              // objects with an unexpected shape that were left out
  "notReadable": [ { "id": "retry-schedule", "area": "Failed payments", "title": "…" } ],  // what the API cannot show, see --checklist
  "warnings": [],                                   // for example: unrestricted key in use
  "requests": { "used": 17 },                       // GET requests made, retries included
  "exitCode": 1
}
```

Notes for consumers:

- `evidence` strings are made of validated ids, enumerations, counts, dates and amounts; they contain no customer personal data, but treat them as text, not markup.
- `exitCode` is the process exit code, in order of precedence: 3 when a resource could not be read, or was read only in part, because of an API error or the request budget; 4 when checks were skipped because a resource was not available to the key (403) or the account (404); 5 when a cap left checks inconclusive and `options.allowPartialCoverage` is false; 1 findings at or above `options.failOn`; 0 otherwise. 2 (usage error) never produces a report.
- A check with status `inconclusive` is never a pass. Treat `partial` the way you treat `skipped`: it says what was not examined.
- `--checklist --json` prints `{ "schemaVersion": 1, "items": [{ "id", "area", "title", "detail" }] }`.
