import { defineRule, failed, passed } from "../rule.js";
import type { FactValues } from "../facts.js";
import { isLive, plural } from "./support.js";

export const currencyMixed = defineRule({
  id: "currency-mixed",
  category: "account",
  summary: "Recurring prices and live subscriptions use one currency",
  requires: ["prices", "subscriptions"],
  why: "Several currencies multiply the reporting, tax and reconciliation work, expose you to exchange-rate swings on settlement and make revenue figures hard to compare. It is sometimes deliberate, so this is for review, not a defect.",
  fix: "Confirm that each currency is intended. If not, archive the prices in the stray currency and move the subscriptions. If it is, make sure your reporting, tax settings and payouts handle each currency.",
  evaluate({ prices, subscriptions, account }) {
    const priceCounts = new Map<string, number>();
    for (const p of prices.filter((x) => x.recurring && x.currency !== null)) priceCounts.set(p.currency as string, (priceCounts.get(p.currency as string) ?? 0) + 1);
    const subCounts = new Map<string, number>();
    for (const s of subscriptions.filter((x) => isLive(x) && x.currency !== null)) subCounts.set(s.currency as string, (subCounts.get(s.currency as string) ?? 0) + 1);
    const all = new Set([...priceCounts.keys(), ...subCounts.keys()]);
    if (all.size <= 1) return passed;
    const fmt = (m: Map<string, number>): string => [...m.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([c, n]) => `${c} (${n})`).join(", ") || "none";
    return failed("low", `${plural(all.size, "currency", "currencies")} in use`, [
      `Active recurring prices: ${fmt(priceCounts)}.`,
      `Live subscriptions: ${fmt(subCounts)}.`,
      `Account default currency: ${account?.defaultCurrency ?? "not read"}.`,
    ]);
  },
});

const MODE_FACTS = ["webhookEndpoints", "subscriptions", "openInvoices", "uncollectibleInvoices", "prices", "products", "portalConfigurations"] as const;

function livemodeOf(data: Partial<FactValues>, key: (typeof MODE_FACTS)[number]): (boolean | null)[] {
  const list = data[key] as ReadonlyArray<{ readonly livemode: boolean | null }> | undefined;
  return (list ?? []).map((x) => x.livemode);
}

export const livemodeMismatch = defineRule({
  id: "livemode-mismatch",
  category: "account",
  summary: "Every object returned belongs to the mode of the key",
  requires: [],
  why: "Stripe keeps test and live data apart, so objects of the other mode in one listing mean the key, the base URL or something in between is not what it appears to be, and every conclusion of this audit is suspect.",
  fix: "Check which key and API base you are using. Re-run with a key of the intended mode, and look for a proxy or mock server in front of the API.",
  evaluate(data, ctx) {
    const expected = ctx.mode === "live";
    const wrong: string[] = [];
    for (const key of MODE_FACTS) {
      const n = livemodeOf(data, key).filter((m) => m !== null && m !== expected).length;
      if (n > 0) wrong.push(`${plural(n, "object")} in ${key}`);
    }
    if (wrong.length === 0) return passed;
    return failed("medium", `Objects of the ${expected ? "test" : "live"} mode in a ${ctx.mode}-mode run`, [`${wrong.join(", ")} report livemode=${String(!expected)}.`]);
  },
});

