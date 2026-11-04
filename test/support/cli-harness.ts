import { runCli, type Deps } from "../../src/composition/compose.js";
import { FakeStripe } from "./fake-stripe.ts";
import { fakeKey } from "./keys.js";
import { NOW } from "./builders.js";
import { cleanWorld, type World } from "./stripe-fixtures.ts";

export const KEY = fakeKey("rk", "live");

export interface CliRun {
  readonly code: number;
  readonly out: string;
  readonly err: string;
  readonly server: FakeStripe;
}

export interface CliOptions {
  readonly world?: World;
  readonly env?: Record<string, string | undefined>;
  readonly serverKey?: string;
  readonly deps?: Deps;
  readonly setup?: (server: FakeStripe) => void;
  /** Leave out --api-base (for tests that never reach the network). */
  readonly noBase?: boolean;
}

/** Runs the CLI in-process against a fresh fake Stripe server and returns what it printed. */
export async function cli(args: readonly string[], options: CliOptions = {}): Promise<CliRun> {
  const world = options.world ?? cleanWorld(NOW, true);
  const server = await new FakeStripe(world, options.serverKey ?? KEY).start();
  try {
    options.setup?.(server);
    const out: string[] = [];
    const err: string[] = [];
    const env = "env" in options ? options.env : { STRIPE_API_KEY: KEY };
    const code = await runCli(
      options.noBase ? args : ["--api-base", server.url, ...args],
      env ?? {},
      { out: (t) => out.push(t), err: (t) => err.push(t) },
      { clock: { nowSeconds: () => NOW }, sleep: async () => undefined, ...options.deps },
    );
    return { code, out: out.join(""), err: err.join(""), server };
  } finally {
    await server.stop();
  }
}
