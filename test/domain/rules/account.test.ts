import { describe, expect, it } from "vitest";
import { currencyMixed, livemodeMismatch } from "../../../src/domain/rules/account.js";
import { account, endpoint, ok, price, sub } from "../../support/builders.js";
import { run } from "../../support/run-rule.js";

describe("currency-mixed", () => {
  it("passes with one currency", () => {
    expect(run(currencyMixed).status).toBe("passed");
  });

  it("lists currencies of prices and subscriptions and the account default", () => {
    const r = run(currencyMixed, { prices: ok([price(), price({ id: "price_2eur", currency: "eur" }), price({ id: "price_3one", currency: "gbp", recurring: false })]), subscriptions: ok([sub(), sub({ id: "sub_2", currency: "eur" }), sub({ id: "sub_3", currency: "chf", status: "canceled" })]) });
    expect(r.finding?.title).toBe("2 currencies in use");
    expect(r.finding?.evidence).toEqual(["Active recurring prices: eur (1), usd (1).", "Live subscriptions: eur (1), usd (1).", "Account default currency: usd."]);
  });

  it("copes with no data about subscriptions or the account", () => {
    const r = run(currencyMixed, { prices: ok([price({ currency: "eur" })]), subscriptions: ok([sub()]), account: ok(account({ defaultCurrency: null })) });
    expect(r.finding?.evidence[1]).toBe("Live subscriptions: usd (1).");
    expect(r.finding?.evidence[2]).toBe("Account default currency: not read.");
  });
});

describe("livemode-mismatch", () => {
  it("passes when every object matches the key's mode", () => {
    expect(run(livemodeMismatch).status).toBe("passed");
    expect(run(livemodeMismatch, { mode: "test", webhookEndpoints: ok([endpoint({ livemode: false })]), subscriptions: ok([]), prices: ok([]), products: ok([]), portalConfigurations: ok([]) }).status).toBe("passed");
  });

  it("flags objects of the other mode in either direction", () => {
    const live = run(livemodeMismatch, { webhookEndpoints: ok([endpoint({ livemode: false })]), prices: ok([price({ livemode: false }), price({ livemode: null })]) });
    expect(live.finding?.title).toBe("Objects of the test mode in a live-mode run");
    expect(live.finding?.evidence[0]).toBe("1 object in webhookEndpoints, 1 object in prices report livemode=false.");
    const test = run(livemodeMismatch, { mode: "test", subscriptions: ok([sub({ livemode: true })]) });
    expect(test.finding?.title).toBe("Objects of the live mode in a test-mode run");
  });
});
