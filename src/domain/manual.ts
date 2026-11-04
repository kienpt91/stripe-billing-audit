export interface ManualItem {
  readonly id: string;
  readonly area: string;
  readonly title: string;
  /** What to look at and what good looks like. */
  readonly detail: string;
  /** Shown in every report as something the API cannot tell, not only in --checklist. */
  readonly inEveryReport: boolean;
}

/** Billing reliability items that the Stripe API does not expose. They are never guessed. */
export const MANUAL_ITEMS: readonly ManualItem[] = [
  {
    id: "retry-schedule",
    area: "Failed payments",
    title: "Retry schedule and the state after the last retry",
    detail:
      "Dashboard, Billing, Revenue recovery, Retries. Smart Retries (or a custom schedule) is on, the number of retries and the window suit your product, and the setting for what happens to the subscription when the last retry fails (cancel, mark unpaid, leave past due) matches how your application treats access. Retry settings cannot be read through the API.",
    inEveryReport: true,
  },
  {
    id: "dunning-emails",
    area: "Failed payments",
    title: "Failed-payment and renewal emails",
    detail:
      "Dashboard, Settings, Billing, Subscriptions and emails. Emails for failed payments, upcoming renewals and expiring cards are on or replaced by your own, and each carries a link where the customer can update the card (a Billing portal session). Email settings cannot be read through the API.",
    inEveryReport: true,
  },
  {
    id: "webhook-handler",
    area: "Webhooks",
    title: "Webhook handler quality",
    detail:
      "In your code, not in Stripe: the Stripe-Signature header is verified against the raw body with the endpoint's signing secret, the handler answers 2xx fast and does the work asynchronously, processing is idempotent on event.id, out-of-order delivery is tolerated (fetch the current object instead of trusting the payload), and events can be replayed after an outage.",
    inEveryReport: false,
  },
  {
    id: "webhook-alerts",
    area: "Webhooks",
    title: "Alerts for failing webhook endpoints",
    detail: "Dashboard, Developers, Webhooks. Email alerts for failing endpoints go to a mailbox somebody reads, and someone owns the response.",
    inEveryReport: false,
  },
  {
    id: "entitlement-sync",
    area: "Application",
    title: "Access follows subscription state",
    detail:
      "The application grants and removes access from subscription status (active, trialing, past_due, unpaid, canceled, paused) according to a written policy, and a scheduled reconciliation compares your records with the Stripe API so a missed webhook cannot leave a customer with the wrong access for long.",
    inEveryReport: false,
  },
  {
    id: "winback",
    area: "Retention",
    title: "Win-back after a cancellation",
    detail:
      "A message or offer goes out when a cancellation is scheduled (customer.subscription.updated with cancel_at_period_end) and after it takes effect (customer.subscription.deleted), and the cancellation reasons collected by the Billing portal are read by someone.",
    inEveryReport: false,
  },
  {
    id: "api-version",
    area: "API",
    title: "API version pinned in code",
    detail: "The SDK and the Stripe-Version header your application sends are pinned and upgraded on purpose, with a test against the new version before the account default or a webhook endpoint is moved.",
    inEveryReport: false,
  },
  {
    id: "keys-and-access",
    area: "Security",
    title: "Keys and dashboard access",
    detail:
      "Each service uses its own restricted key with the permissions it needs, no secret key is in a client or a repository, keys are rotated on a schedule and when people leave, two-step verification is required for every dashboard user, and roles follow least privilege.",
    inEveryReport: false,
  },
  {
    id: "test-clocks",
    area: "Testing",
    title: "Lifecycle tested with test clocks",
    detail: "Trial end, successful and failed renewals, upgrades with proration and cancellation have been exercised in test mode with test clocks and the webhook handler observed through each of them.",
    inEveryReport: false,
  },
  {
    id: "sca-3ds",
    area: "Payments",
    title: "Authentication-required payments",
    detail: "Off-session renewals that need 3D Secure move the invoice to a state your application handles (invoice.payment_action_required), and customers receive a link to authenticate. Radar rules do not block legitimate renewals.",
    inEveryReport: false,
  },
  {
    id: "customer-emails",
    area: "Customer communication",
    title: "Receipts, invoices and branding",
    detail: "Receipts and invoice emails are on, carry the support contact and legal details of the business, and the invoice footer and tax IDs are filled in for the countries you invoice.",
    inEveryReport: false,
  },
  {
    id: "disputes",
    area: "Disputes",
    title: "Dispute handling",
    detail: "charge.dispute.created reaches a human who submits evidence before the deadline, and refunds follow a written policy.",
    inEveryReport: false,
  },
];
