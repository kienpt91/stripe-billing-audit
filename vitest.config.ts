import { defineConfig } from "vitest/config";

// Offline suite: every test talks to a fake Stripe server on loopback or to in-memory fakes.
// No network, no real Stripe account.
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    exclude: ["node_modules/**"],
    // Generous: the suite starts real loopback servers and, in CI, shares a busy runner.
    testTimeout: 60_000,
    hookTimeout: 900_000,
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/bin.ts"],
      reporter: ["text", "json-summary"],
      thresholds: {
        "src/domain/**": { lines: 95, statements: 95 },
        "src/application/**": { lines: 90, statements: 90 },
        lines: 85,
        statements: 85,
      },
    },
  },
});
