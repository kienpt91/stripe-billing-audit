import { describe, expect, it } from "vitest";
import {
  LIFECYCLE_EVENTS,
  webhookApiVersionDrift,
  webhookDeliveriesFailing,
  webhookDevelopmentUrl,
  webhookDuplicateUrls,
  webhookEndpointDisabled,
  webhookEndpointHttp,
  webhookLifecycleEventsMissing,
  webhookNoneEnabled,
} from "../../../src/domain/rules/webhooks.js";
import { safeUrl } from "../../../src/domain/stripe/identifiers.js";
import { account, DAY, endpoint, NOW, ok, price } from "../../support/builders.js";
import { run } from "../../support/run-rule.js";

describe("webhook-none-enabled", () => {
  it("passes with one enabled endpoint", () => {
    expect(run(webhookNoneEnabled).status).toBe("passed");
  });

  it("is critical when live subscriptions have no endpoint at all", () => {
    const r = run(webhookNoneEnabled, { webhookEndpoints: ok([]) });
    expect(r.finding?.severity).toBe("critical");
    expect(r.finding?.evidence[0]).toContain("No webhook endpoints are configured on this live-mode account");
    expect(r.finding?.evidence.join(" ")).toContain("1 live subscription");
  });

  it("is high without subscriptions and lists disabled endpoints", () => {
    const r = run(webhookNoneEnabled, { webhookEndpoints: ok([endpoint({ status: "disabled" })]), subscriptions: ok([]) });
    expect(r.finding?.severity).toBe("high");
    expect(r.finding?.evidence[0]).toContain("1 webhook endpoint configured, none enabled: we_1AbC");
  });

  it("does not mention subscriptions when they could not be read", () => {
    const r = run(webhookNoneEnabled, { webhookEndpoints: ok([]), subscriptions: { status: "unreadable", reason: "permission", resource: "subscriptions", detail: "x" } });
    expect(r.finding?.evidence.join(" ")).not.toContain("live subscription");
    expect(r.finding?.severity).toBe("high");
  });
});

describe("webhook-endpoint-disabled", () => {
  it("flags a disabled endpoint next to an enabled one", () => {
    const r = run(webhookEndpointDisabled, { webhookEndpoints: ok([endpoint(), endpoint({ id: "we_2ZzZzZzZzZz", status: "disabled" })]) });
    expect(r.finding?.severity).toBe("medium");
    expect(r.finding?.evidence).toHaveLength(1);
  });

  it("leaves the all-disabled case to webhook-none-enabled", () => {
    expect(run(webhookEndpointDisabled, { webhookEndpoints: ok([endpoint({ status: "disabled" })]) }).status).toBe("not_applicable");
  });

  it("passes when nothing is disabled", () => {
    expect(run(webhookEndpointDisabled).status).toBe("passed");
  });
});

describe("webhook-lifecycle-events-missing", () => {
  it("passes when one endpoint receives everything via a wildcard", () => {
    expect(run(webhookLifecycleEventsMissing).status).toBe("passed");
  });

  it("combines events across endpoints", () => {
    const a = endpoint({ enabledEvents: ["invoice.paid", "invoice.payment_failed"] });
    const b = endpoint({ id: "we_2ZzZzZzZzZz", enabledEvents: ["checkout.session.completed", "customer.subscription.updated", "customer.subscription.deleted"] });
    expect(run(webhookLifecycleEventsMissing, { webhookEndpoints: ok([a, b]) }).status).toBe("passed");
  });

  it("names the events that no endpoint receives", () => {
    const r = run(webhookLifecycleEventsMissing, { webhookEndpoints: ok([endpoint({ enabledEvents: ["checkout.session.completed", "invoice.paid"] })]) });
    expect(r.finding?.severity).toBe("high");
    expect(r.finding?.evidence[0]).toBe("Not delivered to any enabled endpoint: customer.subscription.updated, customer.subscription.deleted, invoice.payment_failed.");
    expect(r.finding?.evidence[1]).toContain("subscribes to 2 events");
  });

  it("is only medium when just checkout.session.completed is missing", () => {
    const events = LIFECYCLE_EVENTS.filter((e) => e !== "checkout.session.completed");
    expect(run(webhookLifecycleEventsMissing, { webhookEndpoints: ok([endpoint({ enabledEvents: [...events] })]) }).finding?.severity).toBe("medium");
  });

  it("ignores disabled endpoints", () => {
    const r = run(webhookLifecycleEventsMissing, { webhookEndpoints: ok([endpoint(), endpoint({ id: "we_2ZzZzZzZzZz", status: "disabled", enabledEvents: [] })]) });
    expect(r.status).toBe("passed");
  });

  it("does not apply without subscriptions or recurring prices, or without enabled endpoints", () => {
    expect(run(webhookLifecycleEventsMissing, { subscriptions: ok([]), prices: ok([price({ recurring: false })]), webhookEndpoints: ok([endpoint({ enabledEvents: [] })]) }).status).toBe("not_applicable");
    expect(run(webhookLifecycleEventsMissing, { webhookEndpoints: ok([endpoint({ status: "disabled" })]) }).status).toBe("not_applicable");
  });

  it("applies when only prices are recurring", () => {
    expect(run(webhookLifecycleEventsMissing, { subscriptions: ok([]), webhookEndpoints: ok([endpoint({ enabledEvents: [] })]) }).status).toBe("failed");
  });
});

describe("webhook-endpoint-http", () => {
  const http = endpoint({ url: safeUrl("http://hooks.example.com/stripe") });

  it("flags plain http, more severely in live mode", () => {
    expect(run(webhookEndpointHttp, { webhookEndpoints: ok([http]) }).finding?.severity).toBe("high");
    expect(run(webhookEndpointHttp, { webhookEndpoints: ok([http]), mode: "test" }).finding?.severity).toBe("medium");
  });

  it("leaves development hosts to their own check and ignores disabled endpoints", () => {
    expect(run(webhookEndpointHttp, { webhookEndpoints: ok([endpoint({ url: safeUrl("http://localhost:3000/x") })]) }).status).toBe("passed");
    expect(run(webhookEndpointHttp, { webhookEndpoints: ok([{ ...http, status: "disabled" }]) }).status).toBe("passed");
  });
});

describe("webhook-api-version-drift", () => {
  it("flags endpoints pinned to another version than the account's", () => {
    const r = run(webhookApiVersionDrift, { webhookEndpoints: ok([endpoint({ apiVersion: "2020-08-27" })]) });
    expect(r.finding?.evidence[0]).toBe("Account default version: 2025-09-30.clover.");
    expect(r.finding?.evidence[1]).toContain("is pinned to 2020-08-27");
  });

  it("passes for endpoints on the default or on the same version", () => {
    expect(run(webhookApiVersionDrift, { webhookEndpoints: ok([endpoint(), endpoint({ apiVersion: "2025-09-30.clover" })]) }).status).toBe("passed");
  });

  it("does not guess when the account version is unknown", () => {
    expect(run(webhookApiVersionDrift, { account: ok(account({ apiVersion: null })), webhookEndpoints: ok([endpoint({ apiVersion: "2020-08-27" })]) }).status).toBe("not_applicable");
  });
});

describe("webhook-duplicate-urls", () => {
  const a = endpoint({ id: "we_1aaaaaaaaaaa", enabledEvents: ["invoice.paid"] });
  const b = endpoint({ id: "we_2bbbbbbbbbbb", enabledEvents: ["invoice.paid", "invoice.payment_failed"] });

  it("flags two endpoints with overlapping events on one URL", () => {
    const r = run(webhookDuplicateUrls, { webhookEndpoints: ok([a, b]) });
    expect(r.finding?.severity).toBe("low");
    expect(r.finding?.evidence[0]).toContain("we_1aaaaa…, we_2bbbbb…");
  });

  it("treats a wildcard as overlapping with everything", () => {
    expect(run(webhookDuplicateUrls, { webhookEndpoints: ok([a, { ...b, enabledEvents: ["*"] }]) }).status).toBe("failed");
  });

  it("passes for disjoint events, different URLs, unreadable URLs and disabled endpoints", () => {
    expect(run(webhookDuplicateUrls, { webhookEndpoints: ok([a, { ...b, enabledEvents: ["invoice.voided"] }]) }).status).toBe("passed");
    expect(run(webhookDuplicateUrls, { webhookEndpoints: ok([a, { ...b, url: safeUrl("https://other.example.com/x") }]) }).status).toBe("passed");
    expect(run(webhookDuplicateUrls, { webhookEndpoints: ok([{ ...a, url: null }, { ...b, url: null }]) }).status).toBe("passed");
    expect(run(webhookDuplicateUrls, { webhookEndpoints: ok([a, { ...b, status: "disabled" }]) }).status).toBe("passed");
  });
});

describe("webhook-development-url-in-live-mode", () => {
  const dev = endpoint({ url: safeUrl("https://abc.ngrok-free.app/hooks") });

  it("flags live endpoints on development hosts", () => {
    const r = run(webhookDevelopmentUrl, { webhookEndpoints: ok([dev]) });
    expect(r.finding?.severity).toBe("high");
    expect(r.finding?.evidence[0]).toContain("abc.ngrok-free.app");
  });

  it("does not apply to test mode and passes for production URLs", () => {
    expect(run(webhookDevelopmentUrl, { webhookEndpoints: ok([dev]), mode: "test" }).status).toBe("not_applicable");
    expect(run(webhookDevelopmentUrl).status).toBe("passed");
  });
});

describe("webhook-deliveries-failing", () => {
  const ev = (id: string, type: string, age: number) => ({ id, type, created: NOW - age * DAY, pendingWebhooks: 1 });

  it("summarises failed deliveries", () => {
    const r = run(webhookDeliveriesFailing, {
      failedEvents: ok([ev("evt_1", "invoice.paid", 2), ev("evt_2", "invoice.paid", 5), ev("evt_3", "customer.subscription.deleted", 1)], { truncated: true }),
    });
    expect(r.finding?.title).toBe("at least 3 recent events with failed webhook deliveries");
    expect(r.finding?.evidence[0]).toBe("Most frequent types: invoice.paid (2), customer.subscription.deleted (1).");
    expect(r.finding?.evidence[1]).toBe("Oldest listed failure: 2026-10-21 (5 days ago).");
  });

  it("passes with none", () => {
    expect(run(webhookDeliveriesFailing, { failedEvents: ok([]) }).status).toBe("passed");
  });

  it("is skipped when events were not requested", () => {
    expect(run(webhookDeliveriesFailing, { failedEvents: { status: "unreadable", reason: "disabled", resource: "events", detail: "off" } }).status).toBe("skipped");
  });

  it("copes with a missing created time", () => {
    const r = run(webhookDeliveriesFailing, { failedEvents: ok([{ id: "evt_1", type: "x", created: null, pendingWebhooks: 0 }]) });
    expect(r.finding?.evidence[1]).toContain("0 days ago");
  });
});
