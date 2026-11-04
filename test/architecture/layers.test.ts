import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = resolve(import.meta.dirname, "../../src");

type Layer = "domain" | "application" | "infrastructure" | "composition" | "entry";

/** Which layers a layer may import from: domain <- application <- infrastructure <- composition. */
const ALLOWED: Record<Layer, readonly Layer[]> = {
  domain: ["domain"],
  application: ["domain", "application"],
  infrastructure: ["domain", "application", "infrastructure"],
  composition: ["domain", "application", "infrastructure", "composition"],
  entry: ["composition"],
};

/** Node built-ins and packages may only be imported where IO happens. */
const EXTERNAL_OK: Record<Layer, boolean> = { domain: false, application: false, infrastructure: true, composition: true, entry: false };

/** Clocks, randomness, IO and the process: never in the pure layers. */
const FORBIDDEN_IN_PURE =
  /\bDate\.now\b|\bnew Date\b|Math\.random|performance\.now|\bprocess\.|\brequire\(|\bfetch\(|\bsetTimeout\b|\bsetInterval\b|\bglobalThis\b|\bcrypto\.|\bconsole\./;

/** Only the composition layer may read the environment. */
const ENV_ACCESS = /\bprocess\.env\b/;

/** The HTTP adapter has no way to issue anything but GET. */
const NON_GET_METHOD = /\bmethod\s*:\s*["'`](?!GET["'`])/i;

function layerOf(file: string): Layer {
  const first = relative(SRC, file).split(/[\\/]/)[0] ?? "";
  return first === "domain" || first === "application" || first === "infrastructure" || first === "composition" ? first : "entry";
}

export function importsOf(source: string): string[] {
  const out: string[] = [];
  const re = /(?:^|\n)\s*(?:import|export)\s[^'";]*?from\s*['"]([^'"]+)['"]|(?:^|\n)\s*import\s*['"]([^'"]+)['"]|\bimport\(\s*['"]([^'"]+)['"]\s*\)/g;
  for (const m of source.matchAll(re)) out.push((m[1] ?? m[2] ?? m[3]) as string);
  return out;
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

export function violations(file: string, source: string): string[] {
  const layer = layerOf(file);
  const code = stripComments(source);
  const found: string[] = [];
  for (const spec of importsOf(code)) {
    if (spec.startsWith(".")) {
      const targetLayer = layerOf(resolve(dirname(file), spec));
      if (!ALLOWED[layer].includes(targetLayer)) found.push(`${layer} must not import ${targetLayer}: ${spec}`);
    } else if (!EXTERNAL_OK[layer]) {
      found.push(`${layer} must not import ${spec}`);
    }
  }
  if ((layer === "domain" || layer === "application") && FORBIDDEN_IN_PURE.test(code)) {
    found.push(`${layer} touches the clock, randomness, IO or the process`);
  }
  if (layer !== "composition" && ENV_ACCESS.test(code)) found.push(`${layer} reads process.env`);
  if (layer === "infrastructure" && NON_GET_METHOD.test(code)) found.push("infrastructure issues a request that is not GET");
  return found;
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : full.endsWith(".ts") ? [full] : [];
  });
}

describe("dependency rule over the real source tree", () => {
  const files = walk(SRC);

  it.each(files.map((f) => [relative(SRC, f), f] as const))("%s respects the layers", (_name, file) => {
    expect(violations(file, readFileSync(file, "utf8"))).toEqual([]);
  });
});

describe("the checker itself", () => {
  const domainFile = join(SRC, "domain/x.ts");
  const appFile = join(SRC, "application/x.ts");
  const infraFile = join(SRC, "infrastructure/x.ts");
  const compFile = join(SRC, "composition/x.ts");

  it("flags inward-rule violations", () => {
    expect(violations(domainFile, 'import { a } from "../application/a.js";')).toHaveLength(1);
    expect(violations(domainFile, 'export { b } from "../infrastructure/b.js";')).toHaveLength(1);
    expect(violations(appFile, 'import { x } from "../infrastructure/x.js";')).toHaveLength(1);
    expect(violations(infraFile, 'import { x } from "../composition/x.js";')).toHaveLength(1);
  });

  it("flags node built-ins and packages in the pure layers", () => {
    expect(violations(domainFile, 'import { readFile } from "node:fs";')).toHaveLength(1);
    expect(violations(appFile, 'import pg from "pg";')).toHaveLength(1);
    expect(violations(domainFile, 'const m = await import("node:crypto");')).toHaveLength(1);
    expect(violations(domainFile, 'import "node:os";')).toHaveLength(1);
  });

  it("lets infrastructure and composition use node and import inward", () => {
    expect(violations(infraFile, 'import { x } from "../domain/x.js"; import { z } from "node:http";')).toEqual([]);
    expect(violations(compFile, 'import { x } from "../infrastructure/x.js"; import { z } from "node:fs";')).toEqual([]);
  });

  it("flags clocks, randomness, IO, console and process access in the pure layers", () => {
    expect(violations(domainFile, "const t = Date.now();")).toHaveLength(1);
    expect(violations(appFile, "const r = Math.random();")).toHaveLength(1);
    expect(violations(domainFile, "const e = process.argv;")).toHaveLength(1);
    expect(violations(appFile, 'await fetch("x");')).toHaveLength(1);
    expect(violations(appFile, "console.log(1);")).toHaveLength(1);
  });

  it("allows the environment only in the composition layer", () => {
    expect(violations(infraFile, "const k = process.env.X;")).toHaveLength(1);
    expect(violations(compFile, "const k = process.env.X;")).toEqual([]);
  });

  it("flags a request method other than GET in infrastructure", () => {
    expect(violations(infraFile, 'await fetch(u, { method: "POST" });')).toHaveLength(1);
    expect(violations(infraFile, 'await fetch(u, { method: "GET" });')).toEqual([]);
  });

  it("ignores forbidden words that only appear in comments", () => {
    expect(violations(domainFile, "// Date.now() in a comment\n/* process.exit */\nconst a = 1;")).toEqual([]);
  });

  it("finds multi-line imports", () => {
    expect(importsOf('import {\n  a,\n  b,\n} from "../x.js";')).toEqual(["../x.js"]);
  });
});
