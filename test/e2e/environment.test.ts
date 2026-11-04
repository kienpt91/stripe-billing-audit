import { describe, expect, it } from "vitest";
import { cli } from "../support/cli-harness.js";
import { fakeKey } from "../support/keys.js";

describe("the environment", () => {
  it("refuses to run when fetch would use an environment proxy", async () => {
    const key = fakeKey("rk", "live");
    const r = await cli([], { env: { STRIPE_API_KEY: key, NODE_USE_ENV_PROXY: "1" } });
    expect(r.code).toBe(2);
    expect(r.err).toContain("NODE_USE_ENV_PROXY");
    expect(r.server.requests).toHaveLength(0);
  });

  it("warns about extra trusted certificate authorities", async () => {
    const r = await cli(["--json"], { env: { STRIPE_API_KEY: fakeKey("rk", "live"), NODE_EXTRA_CA_CERTS: "/etc/ssl/corp.pem" } });
    expect((JSON.parse(r.out) as { warnings: string[] }).warnings.join(" ")).toContain("NODE_EXTRA_CA_CERTS");
  });

  it("does not echo a key that was typed as an option name", async () => {
    const key = fakeKey("rk", "live", "TYPEDASANOPTIONNAME12345");
    const r = await cli([`--${key}`], { noBase: true });
    expect(r.code).toBe(2);
    expect(r.err).not.toContain("TYPEDASANOPTION");
  });
});
