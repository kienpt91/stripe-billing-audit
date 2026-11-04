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
    "includeEvents": false
  },
  "summary": {
    "findings": 16,
    "bySeverity": { "critical": 0, "high": 7, "medium": 6, "low": 3, "info": 0 },
    "checks": { "passed": 5, "failed": 16, "not_applicable": 3, "skipped": 1 }
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
    // status: "passed" | "failed" | "not_applicable" | "skipped"; detail says why for the last two
  ],
  "skipped": [                                      // checks that could not read what they need
    { "checkId": "invoice-uncollectible", "reason": "permission", "resource": "uncollectible invoices", "detail": "HTTP 403: …" }
    // reason: "permission" | "not_available" | "api_error" | "budget" | "disabled"
  ],
  "truncated": ["subscriptions"],                   // listings cut at the page cap: counts are lower bounds
  "ignoredObjects": 0,                              // objects with an unexpected shape that were left out
  "notReadable": [ { "id": "retry-schedule", "area": "Failed payments", "title": "…" } ],  // what the API cannot show, see --checklist
  "warnings": [],                                   // for example: unrestricted key in use
  "requests": { "used": 17 },                       // GET requests made, retries included
  "exitCode": 1
}
```

Notes for consumers:

- `evidence` strings are made of validated ids, enumerations, counts, dates and amounts; they contain no customer personal data, but treat them as text, not markup.
- `exitCode` is the process exit code: 0 clean, 1 findings at or above `options.failOn`, 3 when a resource could not be read because of an API error or the request budget, 4 when checks were skipped for lack of permission. 2 (usage error) never produces a report.
- `--checklist --json` prints `{ "schemaVersion": 1, "items": [{ "id", "area", "title", "detail" }] }`.
