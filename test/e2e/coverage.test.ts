import { describe, expect, it } from "vitest";
import { NOW } from "../support/builders.js";
import { cli } from "../support/cli-harness.js";
import { cleanWorld, customer, subscription, type World } from "../support/stripe-fixtures.ts";

/** Loose view of the JSON report, so these tests describe the output and not the internal types. */
interface Report {
  exitCode: number;
  summary: { checks: Record<string, number> };
  checks: Array<{ id: string; status: string; detail: string | null }>;
  partial: Array<{ resource: string; cause: string; detail: string }>;
  findings: Array<{ id: string }>;
}

/** `n` active subscriptions, none with a payment method of its own, whose customers all have one. */
function needyWorld(n: number): World {
  const world = cleanWorld(NOW);
  const id = (i: number): string => String(i).padStart(8, "0");
  world.subscriptions = Array.from({ length: n }, (_, i) => subscription(world, { id: `sub_${id(i)}`, customer: `cus_${id(i)}`, default_payment_method: null }));
  world.customers = Object.fromEntries(Array.from({ length: n }, (_, i) => [`cus_${id(i)}`, customer({ id: `cus_${id(i)}` })]));
  return world;
}

const MANY = (n: number): World => {
  const world = cleanWorld(NOW);
  const template = world.subscriptions[0] as Record<string, unknown>;
  world.subscriptions = Array.from({ length: n }, (_, i) => ({ ...template, id: `sub_${String(i).padStart(8, "0")}` }));
  return world;
};

const unavailable = (status: number) => (_req: unknown, res: { writeHead(s: number): void; end(b: string): void }) => {
  res.writeHead(status);
  res.end("{}");
  return true;
};

describe("a failure in the middle of the customer lookup", () => {
  it("is reported as incomplete coverage, never as a pass, and exits 3", async () => {
    const r = await cli(["--json"], { world: needyWorld(5), setup: (s) => s.overrides.set("/v1/customers/cus_00000002", unavailable(503)) });
    const report = JSON.parse(r.out) as Report;
    expect(r.code).toBe(3);
    for (const id of ["customer-no-default-payment-method", "trial-ending-without-payment-method"]) {
      const check = report.checks.find((c) => c.id === id);
      expect(check?.status, id).not.toBe("passed");
    }
    const check = report.checks.find((c) => c.id === "customer-no-default-payment-method");
    expect(check?.status).toBe("inconclusive");
    expect(check?.detail).toContain("2 of 5 customers");
    expect(check?.detail).toContain("HTTP 503");
    expect(report.partial).toEqual([{ resource: "customer payment state", cause: "api_error", detail: expect.stringContaining("HTTP 503") }]);
    expect(report.summary.checks.inconclusive).toBeGreaterThan(0);
  });

  it("is labelled as an error and not as the page cap, in the terminal report", async () => {
    const r = await cli([], { world: needyWorld(5), setup: (s) => s.overrides.set("/v1/customers/cus_00000002", unavailable(503)) });
    expect(r.code).toBe(3);
    expect(r.out).toContain("Inconclusive checks");
    expect(r.out).toContain("2 of 5 customers");
    expect(r.out).not.toContain("page cap");
    expect(r.out).toContain("exit code 3");
  });

  it("is reported when the request budget runs out between two lookups", async () => {
    // ten requests read the account, the listings and the tax data; the budget then allows three lookups
    const r = await cli(["--json", "--max-requests", "13"], { world: needyWorld(5) });
    const report = JSON.parse(r.out) as Report;
    expect(r.code).toBe(3);
    expect(report.partial).toEqual([{ resource: "customer payment state", cause: "budget", detail: expect.stringContaining("3 of 5 customers") }]);
    expect(report.checks.find((c) => c.id === "customer-no-default-payment-method")?.status).toBe("inconclusive");
  });

  it("is reported in Markdown too", async () => {
    const r = await cli(["--markdown"], { world: needyWorld(5), setup: (s) => s.overrides.set("/v1/customers/cus_00000002", unavailable(503)) });
    expect(r.out).toContain("## Inconclusive checks");
    expect(r.out).toContain("`customer-no-default-payment-method`");
  });
});

describe("a listing cut by the page cap", () => {
  it("makes the checks that found nothing inconclusive and exits 5", async () => {
    const r = await cli(["--json", "--max-pages", "1"], { world: MANY(150) });
    const report = JSON.parse(r.out) as Report;
    expect(r.code).toBe(5);
    expect(report.exitCode).toBe(5);
    expect(report.findings).toEqual([]);
    expect(report.partial).toEqual([{ resource: "subscriptions", cause: "cap", detail: expect.stringContaining("page cap") }]);
    expect(report.checks.find((c) => c.id === "subscription-delinquent")).toMatchObject({ status: "inconclusive", detail: expect.stringContaining("page cap") });
    expect(report.checks.find((c) => c.id === "webhook-none-enabled")?.status).toBe("passed");
  });

  it("is shown in the terminal and in the Markdown report", async () => {
    const terminal = await cli(["--max-pages", "1"], { world: MANY(150) });
    expect(terminal.code).toBe(5);
    expect(terminal.out).toContain("Inconclusive checks");
    expect(terminal.out).toContain("subscription-delinquent");
    expect(terminal.out).toContain("exit code 5 (");
    expect((await cli(["--markdown", "--max-pages", "1"], { world: MANY(150) })).out).toContain("## Inconclusive checks");
  });

  it("can be accepted with --allow-partial-coverage, and is still shown", async () => {
    const r = await cli(["--json", "--max-pages", "1", "--allow-partial-coverage"], { world: MANY(150) });
    const report = JSON.parse(r.out) as Report;
    expect(r.code).toBe(0);
    expect(report.checks.find((c) => c.id === "subscription-delinquent")?.status).toBe("inconclusive");
    expect(report.partial).toHaveLength(1);
  });

  it("does not hide a failure behind the allowance: an error in the middle still exits 3", async () => {
    const r = await cli(["--allow-partial-coverage"], { world: needyWorld(5), setup: (s) => s.overrides.set("/v1/customers/cus_00000002", unavailable(503)) });
    expect(r.code).toBe(3);
  });

  it("covers the customer lookup cap of 50", async () => {
    const r = await cli(["--json"], { world: needyWorld(60) });
    const report = JSON.parse(r.out) as Report;
    expect(r.code).toBe(5);
    expect(report.partial).toEqual([{ resource: "customer payment state", cause: "cap", detail: expect.stringContaining("50 of 60 customers") }]);
    expect(report.checks.find((c) => c.id === "customer-no-default-payment-method")?.status).toBe("inconclusive");
  });

  it("stays at exit 0 when the whole listing fits", async () => {
    expect((await cli(["--max-pages", "2"], { world: MANY(150) })).code).toBe(0);
  });
});

describe("a resource that does not exist for this account", () => {
  it("skips the checks and exits 4, like a missing permission", async () => {
    const r = await cli(["--json"], { setup: (s) => s.overrides.set("/v1/billing_portal/configurations", unavailable(404)) });
    const report = JSON.parse(r.out) as Report & { skipped: Array<{ reason: string }> };
    const notRead = report.skipped.filter((s) => s.reason !== "disabled");
    expect(notRead.length).toBeGreaterThan(0);
    expect(notRead.every((s) => s.reason === "not_available")).toBe(true);
    expect(r.code).toBe(4);
  });
});
