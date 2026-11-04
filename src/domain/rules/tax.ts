import { defineRule, failed, notApplicable, passed } from "../rule.js";
import type { FactValues } from "../facts.js";
import { atLeast, isBilling, plural, sampleIds } from "./support.js";

/** Whether the account collects tax through Stripe, judged from what could be read. */
function taxInUse(data: Partial<FactValues>): boolean {
  return (
    (data.taxRegistrations?.length ?? 0) > 0 ||
    data.taxSettings?.status === "active" ||
    (data.subscriptions?.some((s) => s.automaticTax === true) ?? false)
  );
}

export const taxAutomaticDisabled = defineRule({
  id: "tax-automatic-disabled",
  category: "tax",
  summary: "Subscriptions use automatic tax where the account is registered to collect tax",
  severity: "high",
  requires: ["subscriptions", "taxRegistrations"],
  why: "You are registered to collect tax, but these subscriptions are billed without calculating it. The tax is then either not collected, which you owe anyway, or collected by hand and inconsistently.",
  fix: "Enable automatic tax on the subscriptions (automatic_tax[enabled]=true on new ones, and update existing ones), set a tax behavior on the prices, and make sure customers have a valid address. Review the invoices already issued with your accountant.",
  evaluate({ subscriptions, taxRegistrations }, ctx) {
    if (taxRegistrations.length === 0) return notApplicable("no active tax registration");
    const off = subscriptions.filter((s) => isBilling(s) && s.automaticTax === false);
    if (off.length === 0) return passed;
    const billing = subscriptions.filter(isBilling).length;
    const lower = atLeast(ctx.partial.has("subscriptions"));
    return failed("high", `${lower}${plural(off.length, "subscription")} without automatic tax`, [
      `${plural(taxRegistrations.length, "active tax registration")}, and ${lower}${off.length} of ${billing} billing subscriptions have automatic tax off: ${sampleIds(off.map((s) => s.id))}.`,
    ]);
  },
});

export const taxSettingsIncomplete = defineRule({
  id: "tax-settings-incomplete",
  category: "tax",
  summary: "Tax settings are complete where subscriptions use automatic tax",
  severity: "high",
  requires: ["taxSettings", "subscriptions"],
  why: "Automatic tax cannot calculate anything until the head office address and tax settings are complete. Invoices and checkouts then fail to compute tax or fall back to no tax.",
  fix: "Complete the missing tax settings (Dashboard, Tax, Settings) and check that Stripe Tax shows the status as active.",
  evaluate({ taxSettings, subscriptions }) {
    const using = subscriptions.filter((s) => isBilling(s) && s.automaticTax === true);
    if (using.length === 0) return notApplicable("no subscription uses automatic tax");
    if (taxSettings?.status === "active") return passed;
    const missing = taxSettings?.missingFields ?? [];
    return failed("high", "Automatic tax is on but tax settings are not active", [
      `${plural(using.length, "subscription")} use automatic tax: ${sampleIds(using.map((s) => s.id))}.`,
      taxSettings === null ? "Tax settings are not configured on this account." : `Tax settings status: ${taxSettings.status}${missing.length > 0 ? `; missing: ${missing.join(", ")}` : ""}.`,
    ]);
  },
});

export const taxBehaviorUnspecified = defineRule({
  id: "tax-price-behavior-unspecified",
  category: "tax",
  summary: "Active prices state whether tax is inclusive or exclusive",
  severity: "medium",
  requires: ["prices"],
  why: "A price with no tax behavior leaves it to chance whether the displayed amount includes tax. With automatic tax the calculation can fail, and customers are charged a total they did not expect.",
  fix: "Set tax_behavior to inclusive or exclusive on each price (prices are immutable in most fields, so create a replacement price and archive the old one), or set a default tax behavior in the tax settings.",
  evaluate({ prices, taxRegistrations, taxSettings, subscriptions }, ctx) {
    if (!taxInUse({ taxRegistrations, taxSettings, subscriptions })) return notApplicable("tax is not collected through Stripe");
    const bad = prices.filter((p) => p.taxBehavior === "unspecified");
    if (bad.length === 0) return passed;
    if (taxSettings?.hasDefaultTaxBehavior === true) return passed;
    const lower = atLeast(ctx.partial.has("prices"));
    return failed("medium", `${lower}${plural(bad.length, "active price")} with no tax behavior`, [
      `${sampleIds(bad.map((p) => p.id))}.`,
      taxSettings === null || taxSettings === undefined ? "No default tax behavior could be read from the tax settings." : "The tax settings define no default tax behavior.",
    ]);
  },
});

export const taxProductCodeMissing = defineRule({
  id: "tax-product-code-missing",
  category: "tax",
  summary: "Active products carry a tax code",
  severity: "low",
  requires: ["products"],
  why: "Tax rates depend on what is sold. A product without a tax code is taxed with the account's default code, which is wrong for software, services and digital goods that have their own treatment.",
  fix: "Set the right tax code on each product (Dashboard, Product catalog) or set a sensible default tax code in the tax settings.",
  evaluate({ products, taxRegistrations, taxSettings, subscriptions }, ctx) {
    if (!taxInUse({ taxRegistrations, taxSettings, subscriptions })) return notApplicable("tax is not collected through Stripe");
    if (taxSettings?.hasDefaultTaxCode === true) return passed;
    const bad = products.filter((p) => !p.hasTaxCode);
    if (bad.length === 0) return passed;
    const lower = atLeast(ctx.partial.has("products"));
    return failed("low", `${lower}${plural(bad.length, "active product")} with no tax code`, [`${sampleIds(bad.map((p) => p.id))}; the tax settings define no default tax code.`]);
  },
});
