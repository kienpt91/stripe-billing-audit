# 0004. Personal data: little is fetched, none is kept or printed

Status: accepted

## Context

Billing audits are done by freelancers and consultants for clients. The report goes into tickets and email. Customer emails, names and addresses must not end up there, and the tool should not collect them to begin with. The Stripe API cannot filter the fields of an object, so some responses contain them whether asked or not.

## Decision

- **Allowlist decoders.** Every Stripe object is decoded by a function that picks the named fields it needs (`src/application/decode.ts`). Everything else, including `email`, `name`, `phone`, `address`, `description` and `metadata`, is dropped in that function. Decoded facts carry ids, enums, counts, timestamps and booleans.
- **No expansion, no search.** The allowlist has no `expand` parameter and no search endpoint.
- **Customers: payment state only.** The payment-method checks need to know whether a customer has a default payment method. That information exists only on the customer object, so the tool retrieves `GET /v1/customers/{id}` for the customers of subscriptions that have no payment method of their own, at most 50 per run, and decodes a single boolean. `--skip-customer-lookup` disables this and the two checks that need it.
- **Events: opt-in.** Event payloads embed full objects. Reading failed webhook deliveries (`/v1/events?delivery_success=false`, one page of 25) is off unless `--include-events` is given, and only the type, time and delivery counter are decoded; `data` is never read.
- **Ids are shortened** in every report (`sub_1QwErT…`). **Webhook URLs** often carry a secret, so they are reduced to scheme, host and path, where every path segment that is not a short lowercase word (letters and hyphens, at most 20 characters) is replaced by `…`, and the query string, fragment and credentials are dropped. What is not masked: the host (it identifies the endpoint, so a secret placed in a subdomain would be shown) and a secret that is itself a short lowercase word in a path segment. Endpoints are compared for duplicates on a fingerprint of the whole URL (query included), which is never printed.
- **Tests plant personal data** in every fixture (emails, names, addresses, phone numbers, a webhook signing secret, a URL token) and assert that none of it appears in the terminal, JSON or Markdown output, with every option on.

## Consequences

- "Never reads personal data" is accurate for what is requested and kept, not for what Stripe returns in the body of a customer or event response. The README says exactly that: the response travels over TLS to the machine running the tool and is discarded in memory by the decoder; nothing is stored, logged or printed.
- Anyone who needs the stronger guarantee can run with `--skip-customer-lookup` and without `--include-events`. Then no customer or event object is requested. Some listings still carry personal fields in their bodies that cannot be filtered out by the API (invoices: customer email, name and address; subscriptions: free-text description and metadata; the account object: the owner's email), and the decoders drop them on arrival.
