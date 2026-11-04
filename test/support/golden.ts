import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { expect } from "vitest";

const DIR = resolve(import.meta.dirname, "../golden");

/** Compares text with test/golden/<name>. Run with UPDATE_GOLDEN=1 to rewrite the files after a deliberate change. */
export function expectGolden(name: string, actual: string): void {
  const path = resolve(DIR, name);
  if (process.env.UPDATE_GOLDEN === "1") {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, actual);
    return;
  }
  if (!existsSync(path)) throw new Error(`missing golden file ${name}; run with UPDATE_GOLDEN=1 and review it`);
  expect(actual).toBe(readFileSync(path, "utf8"));
}
