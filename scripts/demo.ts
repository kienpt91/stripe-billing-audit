// Runs the real CLI (dist/bin.js, build it first) against the fake Stripe server of the test suite and prints a
// transcript. No network, no Stripe account: the fake server serves invented objects in the API's shape.
//   npm run demo > docs/demo-output.txt        (run inside a container without network, see README)
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { FakeStripe } from "../test/support/fake-stripe.ts";
import { cleanWorld, troubledWorld, type World } from "../test/support/stripe-fixtures.ts";
import { fakeKey } from "../test/support/keys.ts";

const bin = resolve(import.meta.dirname, "../dist/bin.js");
const key = fakeKey("rk", "live");
const now = Math.floor(Date.now() / 1000);

/** Long reports are shown in part: the first `head` and the last `tail` lines. */
interface Excerpt {
  readonly head: number;
  readonly tail: number;
}

function excerpt(text: string, part?: Excerpt): string {
  if (!part) return text;
  const lines = text.split("\n");
  if (lines.length <= part.head + part.tail + 1) return text;
  return [...lines.slice(0, part.head), `[... ${lines.length - part.head - part.tail} lines left out of this transcript ...]`, ...lines.slice(lines.length - part.tail)].join("\n");
}

async function run(title: string, command: string, args: string[], world: World, options: { setup?: (s: FakeStripe) => void; env?: Record<string, string>; serverKey?: string; part?: Excerpt } = {}): Promise<void> {
  const { setup, env = { STRIPE_API_KEY: key }, serverKey = key, part } = options;
  const server = await new FakeStripe(world, serverKey).start();
  setup?.(server);
  const result = await new Promise<{ code: number | null; out: string; err: string }>((done, fail) => {
    const child = spawn(process.execPath, [bin, "--api-base", server.url, ...args], { env: { PATH: process.env.PATH ?? "", ...env }, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    child.stdout.on("data", (d: Buffer) => (out += d.toString("utf8")));
    child.stderr.on("data", (d: Buffer) => (err += d.toString("utf8")));
    child.on("error", fail);
    child.on("close", (code) => done({ code, out, err }));
  });
  await server.stop();
  process.stdout.write(`\n${"=".repeat(100)}\n# ${title}\n$ ${command}\n${"=".repeat(100)}\n`);
  process.stdout.write(excerpt(result.out, part));
  if (result.err) process.stdout.write(`[stderr]\n${result.err}`);
  const methods = [...new Set(server.requests.map((r) => r.method))].join("/");
  process.stdout.write(`[exit code ${result.code}]  (${server.requests.length === 0 ? "no requests were made" : `${server.requests.length} requests, all ${methods}`})\n`);
}

await run("A healthy account", "STRIPE_API_KEY=<restricted live key> stripe-billing-audit", [], cleanWorld(now));
await run("An account with billing gaps", "STRIPE_API_KEY=<restricted live key> stripe-billing-audit", [], troubledWorld(now), { part: { head: 70, tail: 24 } });
await run("The same account, gating only on critical findings", "stripe-billing-audit --fail-on critical", ["--fail-on", "critical"], troubledWorld(now), { part: { head: 0, tail: 3 } });
await run("A key that cannot read tax data or the Billing portal", "stripe-billing-audit", [], troubledWorld(now), {
  setup: (s) => void s.denied.add("/v1/tax/registrations").add("/v1/tax/settings").add("/v1/billing_portal"),
  part: { head: 12, tail: 24 },
});
await run("An unrestricted secret key is refused", "STRIPE_API_KEY=<secret key> stripe-billing-audit", [], cleanWorld(now), { env: { STRIPE_API_KEY: fakeKey("sk", "live") }, serverKey: fakeKey("sk", "live") });
await run("A report to hand to a client", "stripe-billing-audit --markdown", ["--markdown"], troubledWorld(now), { part: { head: 60, tail: 22 } });
await run("Machine-readable output", "stripe-billing-audit --json", ["--json"], troubledWorld(now), { part: { head: 44, tail: 24 } });
