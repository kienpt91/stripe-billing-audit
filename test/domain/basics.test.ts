import { describe, expect, it } from "vitest";
import { formatMoney, totalsByCurrency } from "../../src/domain/money.js";
import { atLeast, isSeverity, severityRank, worst } from "../../src/domain/severity.js";
import { daysBetween, isoDate, isoDateTime } from "../../src/domain/time.js";
import { prng } from "../support/prng.js";

describe("calendar arithmetic", () => {
  it("formats known dates", () => {
    expect(isoDate(0)).toBe("1970-01-01");
    expect(isoDate(951_782_400)).toBe("2000-02-29");
    expect(isoDate(1_709_164_800)).toBe("2024-02-29");
    expect(isoDate(4_102_444_800)).toBe("2100-01-01");
    expect(isoDate(-86_400)).toBe("1969-12-31");
    expect(isoDateTime(1_793_000_000)).toBe("2026-10-26T07:33:20Z");
    expect(isoDateTime(-1)).toBe("1969-12-31T23:59:59Z");
  });

  it("counts whole days, rounding down", () => {
    expect(daysBetween(0, 86_399)).toBe(0);
    expect(daysBetween(0, 86_400)).toBe(1);
    expect(daysBetween(86_400, 0)).toBe(-1);
  });

  it("agrees with a successor relation over many days (property)", () => {
    const rand = prng(3);
    for (let i = 0; i < 400; i++) {
      const t = Math.floor(rand() * 4_000_000_000);
      const next = isoDate(t + 86_400);
      const today = isoDate(t);
      expect(next > today).toBe(true);
      expect(isoDateTime(t).slice(0, 10)).toBe(today);
    }
  });
});

describe("money", () => {
  it("formats two-, zero- and three-decimal currencies", () => {
    expect(formatMoney(123_456, "usd")).toBe("1,234.56 USD");
    expect(formatMoney(5, "eur")).toBe("0.05 EUR");
    expect(formatMoney(1_500, "jpy")).toBe("1,500 JPY");
    expect(formatMoney(1_234, "kwd")).toBe("1.234 KWD");
    expect(formatMoney(-250, "usd")).toBe("-2.50 USD");
  });

  it("totals per currency in code order (unknown sorts as a code)", () => {
    expect(totalsByCurrency([{ amount: 100, currency: "usd" }, { amount: 200, currency: "eur" }, { amount: 50, currency: "usd" }, { amount: 7, currency: null }])).toBe(
      "2.00 EUR, 0.07 UNKNOWN, 1.50 USD",
    );
  });
});

describe("severity", () => {
  it("orders worst first", () => {
    expect(severityRank("critical")).toBeGreaterThan(severityRank("high"));
    expect(severityRank("info")).toBe(0);
    expect(atLeast("medium", "low")).toBe(true);
    expect(atLeast("low", "medium")).toBe(false);
    expect(atLeast("high", "high")).toBe(true);
    expect(worst(["low", "high", "info"])).toBe("high");
    expect(worst([])).toBeNull();
    expect(isSeverity("high")).toBe(true);
    expect(isSeverity("severe")).toBe(false);
  });
});
