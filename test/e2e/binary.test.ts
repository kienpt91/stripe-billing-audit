import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AuditReport } from "../../src/domain/report.js";
import { FakeStripe } from "../support/fake-stripe.ts";
import { fakeKey } from "../support/keys.js";
import { cleanWorld, troubledWorld, type World } from "../support/stripe-fixtures.ts";

/**
 * The real binary: the project is compiled with its own build config, then `dist/bin.js` is started as a
 * child process in an empty directory, with a minimal environment, against a fake Stripe server.
 */
const ROOT = resolve(import.meta.dirname, "../..");
const KEY = fakeKey("rk", "live");
let dist = "";
let work = "";

beforeAll(() => {
  dist = mkdtempSync(join(tmpdir(), "sba-dist-"));
  work = mkdtempSync(join(tmpdir(), "sba-cwd-"));
  execFileSync(process.execPath, [join(ROOT, "node_modules/typescript/bin/tsc"), "-p", join(ROOT, "tsconfig.build.json"), "--outDir", dist], { cwd: ROOT, stdio: "pipe" });
}, 900_000);

afterAll(() => {
  rmSync(dist, { recursive: true, force: true });
  rmSync(work, { recursive: true, force: true });
});

interface Result {
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly server: FakeStripe;
}

async function bin(args: string[], world: World, env: Record<string, string> = { STRIPE_API_KEY: KEY }): Promise<Result> {
  const server = await new FakeStripe(world, KEY).start();
  try {
    return await new Promise<Result>((done, fail) => {
      const child = spawn(process.execPath, [join(dist, "bin.js"), "--api-base", server.url, ...args], { cwd: work, env: { PATH: process.env.PATH ?? "" , ...env }, stdio: ["ignore", "pipe", "pipe"] });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (d: Buffer) => (stdout += d.toString("utf8")));
      child.stderr.on("data", (d: Buffer) => (stderr += d.toString("utf8")));
      child.on("error", fail);
      child.on("close", (code) => done({ code, stdout, stderr, server }));
    });
  } finally {
    await server.stop();
  }
}

const now = (): number => Math.floor(Date.now() / 1000);

describe("dist/bin.js", () => {
  it("audits a healthy account and exits 0", async () => {
    const r = await bin([], cleanWorld(now()));
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("No findings.");
    expect(r.stderr).toBe("");
  }, 60_000);

  it("reports gaps with exit code 1, as JSON that parses, and prints neither the key nor personal data", async () => {
    const r = await bin(["--json"], troubledWorld(now()));
    expect(r.code).toBe(1);
    const report = JSON.parse(r.stdout) as AuditReport;
    expect(report.schemaVersion).toBe(1);
    expect(report.findings.length).toBeGreaterThan(10);
    expect(r.stdout + r.stderr).not.toContain(KEY);
    expect(r.stdout + r.stderr).not.toMatch(/jane\.doe|Jane|whsec|token=abc|\+1 555/);
    for (const q of r.server.requests) expect(q.method).toBe("GET");
  }, 60_000);

  it("leaves the working directory untouched", async () => {
    await bin([], troubledWorld(now()));
    await bin(["--markdown"], troubledWorld(now()));
    expect(readdirSync(work)).toEqual([]);
  }, 60_000);

  it("exits 2 without a key and 4 when the key cannot read what the checks need", async () => {
    expect((await bin([], cleanWorld(now()), {})).code).toBe(2);
    const server = await new FakeStripe(cleanWorld(now()), KEY).start();
    server.denied.add("/v1/webhook_endpoints");
    try {
      const code = await new Promise<number | null>((done) => {
        const child = spawn(process.execPath, [join(dist, "bin.js"), "--api-base", server.url], { cwd: work, env: { PATH: process.env.PATH ?? "", STRIPE_API_KEY: KEY }, stdio: "ignore" });
        child.on("close", done);
      });
      expect(code).toBe(4);
    } finally {
      await server.stop();
    }
  }, 60_000);

  it("prints the checklist and version without a key", async () => {
    const r = await bin(["--checklist"], cleanWorld(now()), {});
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("Billing reliability checklist");
    expect(r.server.requests).toHaveLength(0);
  }, 60_000);
});
