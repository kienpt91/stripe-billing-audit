import { describe, expect, it } from "vitest";
import { portalMissing, portalNoCancellation, portalNoLegalLinks, portalNoPaymentMethodUpdate } from "../../../src/domain/rules/portal.js";
import { ok, portal } from "../../support/builders.js";
import { run } from "../../support/run-rule.js";

describe("portal-missing", () => {
  it("flags a subscription business without an active configuration", () => {
    expect(run(portalMissing, { portalConfigurations: ok([]) }).finding?.evidence[0]).toBe("No portal configuration exists.");
    expect(run(portalMissing, { portalConfigurations: ok([portal({ active: false })]) }).finding?.evidence[0]).toBe("1 portal configuration listed, none active.");
  });

  it("passes with an active configuration and does not apply without subscriptions", () => {
    expect(run(portalMissing).status).toBe("passed");
    expect(run(portalMissing, { portalConfigurations: ok([]), subscriptions: ok([]), prices: ok([]) }).status).toBe("not_applicable");
  });
});

describe("portal feature rules", () => {
  const rules = [portalNoPaymentMethodUpdate, portalNoCancellation, portalNoLegalLinks];

  it("pass on a complete default configuration", () => {
    for (const r of rules) expect(run(r).status).toBe("passed");
  });

  it("defer to portal-missing when there is no active configuration", () => {
    for (const r of rules) expect(run(r, { portalConfigurations: ok([]) }).status).toBe("not_applicable");
  });

  it("flag the missing feature on the default configuration", () => {
    expect(run(portalNoPaymentMethodUpdate, { portalConfigurations: ok([portal({ paymentMethodUpdate: false })]) }).finding?.severity).toBe("medium");
    expect(run(portalNoCancellation, { portalConfigurations: ok([portal({ subscriptionCancel: false })]) }).finding?.evidence[0]).toBe("bpc_1AbCdE… has cancellation disabled.");
    expect(run(portalNoLegalLinks, { portalConfigurations: ok([portal({ hasPrivacyPolicyUrl: false, hasTermsUrl: false })]) }).finding?.evidence[0]).toBe("bpc_1AbCdE… has no privacy policy and no terms of service URL.");
    expect(run(portalNoLegalLinks, { portalConfigurations: ok([portal({ hasTermsUrl: false })]) }).finding?.evidence[0]).toContain("has no terms of service URL");
  });

  it("reads the default configuration, else the first active one", () => {
    const secondary = portal({ id: "bpc_2other", isDefault: false, subscriptionCancel: false });
    expect(run(portalNoCancellation, { portalConfigurations: ok([secondary, portal()]) }).status).toBe("passed");
    expect(run(portalNoCancellation, { portalConfigurations: ok([portal({ active: false }), secondary]) }).status).toBe("failed");
  });
});
