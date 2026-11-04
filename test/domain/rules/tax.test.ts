import { describe, expect, it } from "vitest";
import { taxAutomaticDisabled, taxBehaviorUnspecified, taxProductCodeMissing, taxSettingsIncomplete } from "../../../src/domain/rules/tax.js";
import { ok, price, product, sub, taxSettings } from "../../support/builders.js";
import { run } from "../../support/run-rule.js";

describe("tax-automatic-disabled", () => {
  it("flags billing subscriptions without automatic tax when registrations exist", () => {
    const r = run(taxAutomaticDisabled, { subscriptions: ok([sub({ automaticTax: false }), sub({ id: "sub_2ok" })]) });
    expect(r.finding?.severity).toBe("high");
    expect(r.finding?.evidence[0]).toBe("1 active tax registration, and 1 of 2 billing subscriptions have automatic tax off: sub_1AbCdE….");
  });

  it("does not apply without registrations and ignores unknown or cancelled subscriptions", () => {
    expect(run(taxAutomaticDisabled, { taxRegistrations: ok([]), subscriptions: ok([sub({ automaticTax: false })]) }).status).toBe("not_applicable");
    expect(run(taxAutomaticDisabled, { subscriptions: ok([sub({ automaticTax: null }), sub({ automaticTax: false, status: "canceled" })]) }).status).toBe("passed");
  });

  it("is skipped when registrations cannot be read", () => {
    expect(run(taxAutomaticDisabled, { taxRegistrations: { status: "unreadable", reason: "permission", resource: "tax registrations", detail: "HTTP 403" } }).status).toBe("skipped");
  });
});

describe("tax-settings-incomplete", () => {
  it("flags automatic tax with pending or missing settings", () => {
    const pending = run(taxSettingsIncomplete, { taxSettings: ok(taxSettings({ status: "pending", missingFields: ["head_office"] })) });
    expect(pending.finding?.evidence[1]).toBe("Tax settings status: pending; missing: head_office.");
    expect(run(taxSettingsIncomplete, { taxSettings: ok(null) }).finding?.evidence[1]).toBe("Tax settings are not configured on this account.");
    expect(run(taxSettingsIncomplete, { taxSettings: ok(taxSettings({ status: "unknown" })) }).finding?.evidence[1]).toBe("Tax settings status: unknown.");
  });

  it("passes when active and does not apply when no subscription uses automatic tax", () => {
    expect(run(taxSettingsIncomplete).status).toBe("passed");
    expect(run(taxSettingsIncomplete, { subscriptions: ok([sub({ automaticTax: false })]), taxSettings: ok(null) }).status).toBe("not_applicable");
  });
});

describe("tax-price-behavior-unspecified", () => {
  const unspecified = ok([price({ taxBehavior: "unspecified" })]);

  it("flags unspecified behavior when tax is in use and no default exists", () => {
    const r = run(taxBehaviorUnspecified, { prices: unspecified, taxSettings: ok(taxSettings({ hasDefaultTaxBehavior: false })) });
    expect(r.finding?.evidence[1]).toBe("The tax settings define no default tax behavior.");
    expect(run(taxBehaviorUnspecified, { prices: unspecified, taxSettings: ok(null) }).finding?.evidence[1]).toContain("No default tax behavior could be read");
  });

  it("passes with a default behavior, does not apply when tax is not collected", () => {
    expect(run(taxBehaviorUnspecified, { prices: unspecified }).status).toBe("passed");
    expect(run(taxBehaviorUnspecified, { prices: unspecified, taxRegistrations: ok([]), taxSettings: ok(null), subscriptions: ok([sub({ automaticTax: false })]) }).status).toBe("not_applicable");
  });

  it("applies when only a subscription uses automatic tax", () => {
    expect(run(taxBehaviorUnspecified, { prices: unspecified, taxRegistrations: ok([]), taxSettings: ok(null) }).status).toBe("failed");
  });
});

describe("tax-product-code-missing", () => {
  it("flags products without a code when no default code exists", () => {
    const r = run(taxProductCodeMissing, { products: ok([product({ hasTaxCode: false })]), taxSettings: ok(taxSettings({ hasDefaultTaxCode: false })) });
    expect(r.finding?.severity).toBe("low");
  });

  it("passes with a default code or with codes on every product and does not apply without tax", () => {
    expect(run(taxProductCodeMissing, { products: ok([product({ hasTaxCode: false })]) }).status).toBe("passed");
    expect(run(taxProductCodeMissing, { products: ok([product()]), taxSettings: ok(taxSettings({ hasDefaultTaxCode: false })) }).status).toBe("passed");
    expect(run(taxProductCodeMissing, { taxRegistrations: ok([]), taxSettings: ok(null), subscriptions: ok([]) }).status).toBe("not_applicable");
  });
});
