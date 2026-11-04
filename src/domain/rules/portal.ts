import { defineRule, failed, notApplicable, passed } from "../rule.js";
import type { PortalConfiguration } from "../facts.js";
import { isSubscriptionBusiness } from "./support.js";
import { shortId } from "../stripe/identifiers.js";

/** The configuration a portal session uses unless the application names another one. */
function effective(configs: readonly PortalConfiguration[]): PortalConfiguration | null {
  const active = configs.filter((c) => c.active);
  return active.find((c) => c.isDefault) ?? active[0] ?? null;
}

const NOTE = "Sessions created through the API can name another configuration; this check reads the default one.";

export const portalMissing = defineRule({
  id: "portal-missing",
  category: "portal",
  summary: "An active Billing portal configuration exists",
  severity: "medium",
  requires: ["portalConfigurations"],
  why: "Without the Billing portal customers cannot update a card, download invoices or cancel on their own. Every one of those becomes a support ticket, and a failed card that the customer cannot fix is lost revenue.",
  fix: "Save a portal configuration (Dashboard, Settings, Billing, Customer portal) with payment method updates, invoice history and cancellation enabled, then create portal sessions from your account page and from failed-payment emails.",
  evaluate({ portalConfigurations, subscriptions, prices }) {
    if (!isSubscriptionBusiness({ subscriptions, prices })) return notApplicable("no subscriptions or recurring prices");
    return effective(portalConfigurations) === null
      ? failed("medium", "No active Billing portal configuration", [`${portalConfigurations.length === 0 ? "No portal configuration exists" : `${portalConfigurations.length} portal configuration${portalConfigurations.length === 1 ? "" : "s"} listed, none active`}.`])
      : passed;
  },
});

export const portalNoPaymentMethodUpdate = defineRule({
  id: "portal-no-payment-method-update",
  category: "portal",
  summary: "The Billing portal lets customers update their payment method",
  severity: "medium",
  requires: ["portalConfigurations"],
  why: "Cards expire and get replaced. If customers cannot update the card themselves, every failed renewal needs your intervention and the failed-payment email has nowhere useful to point.",
  fix: "Enable Payment methods, Update, in the portal configuration, and link to a portal session from your failed-payment emails.",
  evaluate({ portalConfigurations }) {
    const config = effective(portalConfigurations);
    if (config === null) return notApplicable("no active portal configuration; reported by portal-missing");
    return config.paymentMethodUpdate ? passed : failed("medium", "Portal does not allow updating the payment method", [`${shortId(config.id)} has payment method updates disabled.`, NOTE]);
  },
});

export const portalNoCancellation = defineRule({
  id: "portal-no-cancellation",
  category: "portal",
  summary: "The Billing portal lets customers cancel",
  severity: "medium",
  requires: ["portalConfigurations"],
  why: "Customers who cannot cancel easily write to support, dispute the charge with their bank or complain publicly, and several jurisdictions require cancellation to be as easy as sign-up.",
  fix: "Enable Subscriptions, Cancel, in the portal configuration (consider cancel at period end, and ask for a reason), or provide an equally direct cancellation path in your application.",
  evaluate({ portalConfigurations }) {
    const config = effective(portalConfigurations);
    if (config === null) return notApplicable("no active portal configuration; reported by portal-missing");
    return config.subscriptionCancel ? passed : failed("medium", "Portal does not allow cancelling a subscription", [`${shortId(config.id)} has cancellation disabled.`, NOTE]);
  },
});

export const portalNoLegalLinks = defineRule({
  id: "portal-no-legal-links",
  category: "portal",
  summary: "The Billing portal links to a privacy policy and terms of service",
  severity: "low",
  requires: ["portalConfigurations"],
  why: "Customers manage payment data in the portal. Missing privacy and terms links are a trust and compliance gap on a page that carries your brand.",
  fix: "Add the privacy policy and terms of service URLs to the portal's business information.",
  evaluate({ portalConfigurations }) {
    const config = effective(portalConfigurations);
    if (config === null) return notApplicable("no active portal configuration; reported by portal-missing");
    const missing = [!config.hasPrivacyPolicyUrl && "privacy policy", !config.hasTermsUrl && "terms of service"].filter((x): x is string => x !== false);
    return missing.length === 0 ? passed : failed("low", "Portal has no legal links", [`${shortId(config.id)} has no ${missing.join(" and no ")} URL.`]);
  },
});
