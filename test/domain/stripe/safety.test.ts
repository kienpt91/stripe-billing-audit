import { describe, expect, it } from "vitest";
import { validateRead } from "../../../src/domain/stripe/allowlist.js";
import { parseApiBase } from "../../../src/domain/stripe/api-base.js";
import { classifyKey } from "../../../src/domain/stripe/key.js";
import { containsSecret, redactSecrets } from "../../../src/domain/stripe/redact.js";
import { RequestBudget } from "../../../src/domain/budget.js";
import { fakeKey } from "../../support/keys.js";

describe("classifyKey", () => {
  it("detects kind and mode from the prefix", () => {
    expect(classifyKey(fakeKey("rk", "live"))).toEqual({ ok: true, value: { kind: "restricted", mode: "live" } });
    expect(classifyKey(fakeKey("rk", "test"))).toEqual({ ok: true, value: { kind: "restricted", mode: "test" } });
    expect(classifyKey(fakeKey("sk", "live"))).toEqual({ ok: true, value: { kind: "secret", mode: "live" } });
    expect(classifyKey(`  ${fakeKey("sk", "test")}\n`)).toEqual({ ok: true, value: { kind: "secret", mode: "test" } });
  });

  it("refuses missing, publishable and malformed keys without echoing the input", () => {
    const pk = fakeKey("pk", "live");
    for (const input of [undefined, "", "   ", pk, "rk_live_", "whsec_abcdefghijkl", `${fakeKey("rk", "live")} extra`, "rk_prod_AAAAAAAAAAAA"]) {
      const r = classifyKey(input);
      expect(r.ok).toBe(false);
      if (!r.ok && input && input.trim().length > 16) expect(r.error).not.toContain(input.trim().slice(-8));
    }
  });
});

describe("parseApiBase", () => {
  it("defaults to the real API", () => {
    expect(parseApiBase(undefined)).toEqual({ ok: true, value: { origin: "https://api.stripe.com", overridden: false } });
  });

  it("accepts loopback origins only", () => {
    expect(parseApiBase("http://127.0.0.1:4010")).toEqual({ ok: true, value: { origin: "http://127.0.0.1:4010", overridden: true } });
    expect(parseApiBase("http://127.1.2.3/").ok).toBe(true);
    expect(parseApiBase("http://[::1]:9").ok).toBe(true);
    expect(parseApiBase("http://0x7f.1:80").ok).toBe(true); // the URL parser canonicalises it to 127.0.0.1
  });

  it.each([
    "https://api.stripe.com",
    "http://localhost:4010",
    "http://example.com",
    "http://10.0.0.1",
    "http://127.0.0.1:1@evil.example",
    "http://user:pw@127.0.0.1",
    "http://127.0.0.1/path",
    "http://127.0.0.1/?x=1",
    "http://127.0.0.1/#x",
    "ftp://127.0.0.1",
    "nonsense",
    "http://127.0.0.1.evil.example",
  ])("refuses %s", (raw) => {
    expect(parseApiBase(raw).ok).toBe(false);
  });
});

describe("validateRead allowlist", () => {
  it("allows the endpoints the audit reads", () => {
    expect(validateRead("/v1/account", {}).ok).toBe(true);
    expect(validateRead("/v1/subscriptions", { status: "all", limit: "100", starting_after: "sub_1" }).ok).toBe(true);
    expect(validateRead("/v1/customers/cus_ABC123", {}).ok).toBe(true);
    expect(validateRead("/v1/events", { delivery_success: "false", limit: "25" }).ok).toBe(true);
  });

  it.each([
    ["/v1/charges", {}],
    ["/v1/customers", {}],
    ["/v1/customers/cus_ABC/sources", {}],
    ["/v1/customers/cus_ABC/../../v1/charges", {}],
    ["/v1/payment_methods", {}],
    ["/v1/account", { expand: "x" }],
    ["/v1/subscriptions", { "expand[]": "customer" }],
    ["/v1/invoices", { status: "open&x=1" }],
    ["/v1/invoices", { status: "" }],
    ["/v1/prices", { status: "all" }],
    ["//v1/account", {}],
    ["/v1/account?x=1", {}],
    ["/v1/account/", {}],
  ])("refuses %s %j", (path, query) => {
    expect(validateRead(path, query as Record<string, string>).ok).toBe(false);
  });
});

describe("redactSecrets", () => {
  it("replaces key-shaped values and exact secrets", () => {
    const k = fakeKey("rk", "live");
    expect(redactSecrets(`error for ${k} here`)).toBe("error for [redacted] here");
    expect(redactSecrets(`whsec_${"A".repeat(20)} and ${fakeKey("sk", "test")}`)).toBe("[redacted] and [redacted]");
    expect(redactSecrets("custom-secret-value", ["custom-secret-value"])).toBe("[redacted]");
    expect(redactSecrets("short", ["abc"])).toBe("short");
  });

  it("reports whether text holds a secret, repeatedly", () => {
    const k = fakeKey("rk", "test");
    expect(containsSecret(`x ${k}`)).toBe(true);
    expect(containsSecret(`x ${k}`)).toBe(true);
    expect(containsSecret("nothing here")).toBe(false);
    expect(containsSecret("custom-secret-value", ["custom-secret-value"])).toBe(true);
  });
});

describe("RequestBudget", () => {
  it("hands out exactly `max` requests", () => {
    const b = new RequestBudget(2);
    expect([b.tryTake(), b.tryTake(), b.tryTake()]).toEqual([true, true, false]);
    expect(b.used).toBe(2);
    expect(b.remaining).toBe(0);
  });

  it("treats a negative or fractional cap as the nearest sane value", () => {
    expect(new RequestBudget(-3).tryTake()).toBe(false);
    expect(new RequestBudget(1.9).remaining).toBe(1);
  });
});
