export const HELP = `stripe-billing-audit: read-only audit of a Stripe account's billing setup

Usage:
  STRIPE_API_KEY=rk_... stripe-billing-audit [options]
  stripe-billing-audit --checklist [--markdown | --json]

The key is read from the STRIPE_API_KEY environment variable only. Use a restricted key with read
permissions. The tool sends GET requests to a fixed list of endpoints and never writes to Stripe.

Output (default is a terminal report):
  --json                     machine-readable report (schemaVersion in the output)
  --markdown                 report to hand to a client
  --checklist                print the manual items the API cannot show (no key needed)

Gating:
  --fail-on <severity>       exit 1 when a finding is at least this severe:
                             critical, high, medium (default), low, info
  --allow-partial-coverage   do not exit 5 when a listing or lookup stopped at a cap and a check found
                             nothing in the part that was examined (the report still says so)

Thresholds:
  --past-due-days <n>        subscriptions failing at least this long are reported (default 7)
  --trial-days <n>           trials ending within this many days need a payment method (default 7)
  --stale-invoice-days <n>   invoices open at least this long are reported (default 14)

Limits:
  --max-pages <n>            pages of 100 objects per listing (default 5)
  --max-requests <n>         request budget for the whole run, retries included (default 150)
  --timeout-ms <n>           per-request timeout (default 15000)

Data:
  --skip-customer-lookup     do not retrieve customers (disables the payment-method checks)
  --include-events           also read recent events with failed webhook deliveries; event
                             payloads can embed personal data, which is discarded unread

Safety:
  --allow-unrestricted-key   accept a full secret key (sk_...); the tool still only reads
  --api-base <url>           loopback origin to use instead of api.stripe.com, for tests

Other:
  -h, --help                 show this text
  -v, --version              show the version

Exit codes:
  0  no finding at or above --fail-on, every check ran on all the data it needed
  1  findings at or above --fail-on
  2  usage error (bad option, missing or unsuitable key, unsafe environment)
  3  API or authentication error: a resource could not be read, or only in part, so the audit is incomplete
  4  a resource was not available to the key (no permission, or not found), so some checks could not run
  5  a cap (--max-pages, the 50-customer lookup) left checks inconclusive: they found nothing, but only in
     part of the data; raise the cap, or accept it with --allow-partial-coverage
  Codes 3, 4 and 5 outrank 1: a verdict on part of the account must not look like a verdict on all of it.
`;
