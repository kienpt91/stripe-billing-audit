import { daysBetween, isoDate } from "../time.js";
import { defineRule, failed, notApplicable, passed } from "../rule.js";
import type { WebhookEndpoint } from "../facts.js";
import { atLeast, isLive, isSubscriptionBusiness, plural, sampleIds } from "./support.js";
import { shortId } from "../stripe/identifiers.js";

/** The events a subscription business needs to keep its own records in step with Stripe. */
export const LIFECYCLE_EVENTS = [
  "checkout.session.completed",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "invoice.paid",
  "invoice.payment_failed",
] as const;

const enabled = (e: WebhookEndpoint): boolean => e.status === "enabled";

function label(e: WebhookEndpoint): string {
  return `${shortId(e.id)} (${e.url?.display ?? "unreadable URL"})`;
}

function covers(e: WebhookEndpoint, event: string): boolean {
  return e.enabledEvents.includes("*") || e.enabledEvents.includes(event);
}

export const webhookNoneEnabled = defineRule({
  id: "webhook-none-enabled",
  category: "webhooks",
  summary: "At least one webhook endpoint exists and is enabled",
  requires: ["webhookEndpoints"],
  why: "Without an enabled endpoint Stripe has nowhere to tell your application that a payment failed, a subscription was cancelled or an invoice was paid. Access, emails and your own records then drift from what Stripe bills.",
  fix: "Create a webhook endpoint (Dashboard, Developers, Webhooks) that points to an HTTPS URL of your application, subscribe it to the lifecycle events listed by webhook-lifecycle-events-missing, verify the signature in the handler and answer 2xx quickly. Re-enable a disabled endpoint after fixing the URL it points to.",
  evaluate({ webhookEndpoints, subscriptions }, ctx) {
    const on = webhookEndpoints.filter(enabled);
    if (on.length > 0) return passed;
    const billing = subscriptions?.filter(isLive).length ?? 0;
    const evidence =
      webhookEndpoints.length === 0
        ? [`No webhook endpoints are configured on this ${ctx.mode}-mode account.`]
        : [`${plural(webhookEndpoints.length, "webhook endpoint")} configured, none enabled: ${sampleIds(webhookEndpoints.map((e) => e.id))}.`];
    if (subscriptions !== undefined) evidence.push(`${plural(billing, "live subscription")} depend on events that are never delivered.`);
    evidence.push("This API lists dashboard-managed endpoints only; a listener started with the Stripe CLI is not an endpoint.");
    return failed(billing > 0 ? "critical" : "high", "No enabled webhook endpoint", evidence);
  },
});

export const webhookEndpointDisabled = defineRule({
  id: "webhook-endpoint-disabled",
  category: "webhooks",
  summary: "No webhook endpoint is left disabled",
  requires: ["webhookEndpoints"],
  why: "Stripe disables an endpoint that keeps failing, and a disabled endpoint silently stops receiving events. It is also a sign that someone's handler was broken for days.",
  fix: "Find out why deliveries failed (Dashboard, Webhooks, the endpoint's event deliveries), fix the handler, then re-enable the endpoint or delete it if it is obsolete. Replay the missed events from the dashboard or reconcile against the API.",
  evaluate({ webhookEndpoints }) {
    const off = webhookEndpoints.filter((e) => e.status === "disabled");
    if (off.length === 0) return passed;
    if (!webhookEndpoints.some(enabled)) return notApplicable("every endpoint is disabled; reported by webhook-none-enabled");
    return failed("medium", `${plural(off.length, "webhook endpoint")} disabled`, off.map((e) => `${label(e)} is disabled.`));
  },
});

export const webhookLifecycleEventsMissing = defineRule({
  id: "webhook-lifecycle-events-missing",
  category: "webhooks",
  summary: "Enabled endpoints together receive the subscription lifecycle events",
  requires: ["webhookEndpoints"],
  why: "A subscription business learns about renewals, failures and cancellations through these events. If one is not delivered to anything, your records and the customer's access stop matching what Stripe bills.",
  fix: "Add the missing events to an enabled endpoint (or use all events), and make the handler idempotent on the event id. Handle checkout.session.completed to provision, invoice.paid to extend access, invoice.payment_failed to start recovery, customer.subscription.updated and customer.subscription.deleted to change or end access.",
  evaluate({ webhookEndpoints, subscriptions, prices }) {
    if (!isSubscriptionBusiness({ subscriptions, prices })) return notApplicable("no subscriptions or recurring prices");
    const on = webhookEndpoints.filter(enabled);
    if (on.length === 0) return notApplicable("no enabled endpoint; reported by webhook-none-enabled");
    const missing = LIFECYCLE_EVENTS.filter((event) => !on.some((e) => covers(e, event)));
    if (missing.length === 0) return passed;
    const evidence = [`Not delivered to any enabled endpoint: ${missing.join(", ")}.`];
    for (const e of on.slice(0, 5)) {
      evidence.push(`${label(e)} subscribes to ${e.enabledEvents.includes("*") ? "all events" : plural(e.enabledEvents.length, "event")}.`);
    }
    const critical = missing.some((m) => m !== "checkout.session.completed");
    return failed(critical ? "high" : "medium", `${plural(missing.length, "subscription lifecycle event")} not delivered`, evidence);
  },
});

export const webhookEndpointHttp = defineRule({
  id: "webhook-endpoint-http",
  category: "webhooks",
  summary: "Enabled endpoints use HTTPS",
  requires: ["webhookEndpoints"],
  why: "Event payloads carry billing data and travel in clear over HTTP, and the request cannot be trusted to come from where it claims. Stripe requires HTTPS for live-mode endpoints.",
  fix: "Serve the endpoint over HTTPS with a valid certificate and update the endpoint URL. Keep verifying the Stripe-Signature header regardless of the transport.",
  evaluate({ webhookEndpoints }, ctx) {
    const insecure = webhookEndpoints.filter((e) => enabled(e) && e.url?.scheme === "http" && !e.url.development);
    if (insecure.length === 0) return passed;
    return failed(ctx.mode === "live" ? "high" : "medium", `${plural(insecure.length, "endpoint")} on plain HTTP`, insecure.map((e) => `${label(e)} uses http.`));
  },
});

export const webhookApiVersionDrift = defineRule({
  id: "webhook-api-version-drift",
  category: "webhooks",
  summary: "Endpoint API versions match the account's default version",
  requires: ["webhookEndpoints", "account"],
  why: "The payload of an event follows the API version of its endpoint. If the endpoint and the account differ, the shape your handler receives differs from what the rest of your code reads from the API, and an account upgrade changes only one of them.",
  fix: "Choose one version on purpose: set the endpoint's version to the one your handler was written against, or upgrade handler and account together. Test the handler against payloads of the target version before switching.",
  evaluate({ webhookEndpoints, account }) {
    if (account.apiVersion === null) return notApplicable("Stripe did not report the account's API version in a response header");
    const drifted = webhookEndpoints.filter((e) => enabled(e) && e.apiVersion !== null && e.apiVersion !== account.apiVersion);
    if (drifted.length === 0) return passed;
    return failed(
      "medium",
      `${plural(drifted.length, "endpoint")} use a different API version than the account`,
      [`Account default version: ${account.apiVersion}.`, ...drifted.slice(0, 5).map((e) => `${label(e)} is pinned to ${e.apiVersion}.`)],
    );
  },
});

export const webhookDuplicateUrls = defineRule({
  id: "webhook-duplicate-urls",
  category: "webhooks",
  summary: "No two enabled endpoints deliver the same events to the same URL",
  requires: ["webhookEndpoints"],
  why: "An event delivered twice to the same handler is processed twice unless the handler deduplicates, which means double provisioning, double emails or double credits.",
  fix: "Delete the endpoint that is not needed or split the events so that each is delivered once, and deduplicate on event.id in the handler anyway.",
  evaluate({ webhookEndpoints }) {
    const groups = new Map<string, WebhookEndpoint[]>();
    for (const e of webhookEndpoints.filter(enabled)) {
      if (e.url === null) continue;
      groups.set(e.url.display, [...(groups.get(e.url.display) ?? []), e]);
    }
    const overlapping = [...groups.entries()].filter(([, list]) =>
      list.some((a, i) => list.slice(i + 1).some((b) => a.enabledEvents.includes("*") || b.enabledEvents.includes("*") || a.enabledEvents.some((x) => b.enabledEvents.includes(x)))),
    );
    if (overlapping.length === 0) return passed;
    return failed(
      "low",
      "Several endpoints deliver the same events to one URL",
      overlapping.map(([url, list]) => `${url} is used by ${list.map((e) => shortId(e.id)).join(", ")}.`),
    );
  },
});

export const webhookDevelopmentUrl = defineRule({
  id: "webhook-development-url-in-live-mode",
  category: "webhooks",
  summary: "Live-mode endpoints do not point to development hosts",
  requires: ["webhookEndpoints"],
  why: "A live endpoint that points to localhost, a private address or a development tunnel is either dead, so live events are lost, or served by someone's laptop, so live billing data leaves production.",
  fix: "Point live endpoints to a production HTTPS URL and delete the development endpoint. Use test mode and the Stripe CLI for local development.",
  evaluate({ webhookEndpoints }, ctx) {
    if (ctx.mode !== "live") return notApplicable("test-mode run");
    const dev = webhookEndpoints.filter((e) => enabled(e) && e.url?.development === true);
    if (dev.length === 0) return passed;
    return failed("high", `${plural(dev.length, "live endpoint")} point to a development host`, dev.map((e) => `${label(e)} looks like a development address.`));
  },
});

export const webhookDeliveriesFailing = defineRule({
  id: "webhook-deliveries-failing",
  category: "webhooks",
  summary: "Recent events were delivered successfully (needs --include-events)",
  requires: ["failedEvents"],
  why: "Events whose delivery failed are changes your application has not seen: payments, cancellations or renewals that your records may not reflect. Stripe retries for up to three days, then gives up.",
  fix: "Open the failing events in the dashboard (Developers, Webhooks, the endpoint), fix the handler, resend the events that were missed, and alert on repeated failures. Reconcile against the API after an outage.",
  evaluate({ failedEvents }, ctx) {
    if (failedEvents.length === 0) return passed;
    const byType = new Map<string, number>();
    for (const e of failedEvents) byType.set(e.type, (byType.get(e.type) ?? 0) + 1);
    const top = [...byType.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 5);
    const oldest = Math.min(...failedEvents.map((e) => e.created ?? ctx.nowSeconds));
    const lower = atLeast(ctx.truncated.has("failedEvents"));
    return failed("high", `${lower}${plural(failedEvents.length, "recent event")} with failed webhook deliveries`, [
      `Most frequent types: ${top.map(([t, n]) => `${t} (${n})`).join(", ")}.`,
      `Oldest listed failure: ${isoDate(oldest)} (${plural(Math.max(0, daysBetween(oldest, ctx.nowSeconds)), "day")} ago).`,
    ]);
  },
});
