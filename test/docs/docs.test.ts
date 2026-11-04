import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { VERSION } from "../../src/composition/version.js";
import { FACT_LABELS } from "../../src/domain/facts.js";
import { RULES } from "../../src/domain/rules/index.js";
import { HELP } from "../../src/infrastructure/cli/help.js";

const ROOT = resolve(import.meta.dirname, "../..");
const read = (path: string): string => readFileSync(join(ROOT, path), "utf8");

function generatedChecks(): string {
  const out: string[] = ["| Check | Area | Severity | Needs |", "| --- | --- | --- | --- |"];
  for (const r of RULES) out.push(`| [\`${r.id}\`](#${r.id}) | ${r.category} | ${r.severity} | ${r.requires.length === 0 ? "nothing" : r.requires.map((k) => FACT_LABELS[k]).join(", ")} |`);
  out.push("");
  for (const r of RULES) {
    out.push(`### ${r.id}`, "", `${r.summary}. Severity: ${r.severity}.`, "", `**Why it matters.** ${r.why}`, "", `**Suggested fix.** ${r.fix}`, "");
  }
  return out.join("\n");
}

const START = "<!-- checks:start -->";
const END = "<!-- checks:end -->";

describe("docs/checks.md", () => {
  it("contains exactly the generated catalogue of checks (UPDATE_DOCS=1 rewrites it)", () => {
    const path = join(ROOT, "docs/checks.md");
    const current = read("docs/checks.md");
    const head = current.slice(0, current.indexOf(START) + START.length);
    const tail = current.slice(current.indexOf(END));
    const expected = `${head}\n\n${generatedChecks()}\n${tail}`;
    if (process.env.UPDATE_DOCS === "1") writeFileSync(path, expected);
    else expect(current).toBe(expected);
  });

  it("is listed with every rule id", () => {
    const text = read("docs/checks.md");
    for (const r of RULES) expect(text).toContain(`### ${r.id}`);
  });
});

describe("version and changelog", () => {
  it("keeps VERSION, package.json and package-lock.json in step", () => {
    const pkg = JSON.parse(read("package.json")) as { version: string };
    const lock = JSON.parse(read("package-lock.json")) as { version: string; packages: Record<string, { version: string }> };
    expect(pkg.version).toBe(VERSION);
    expect(lock.version).toBe(VERSION);
    expect(lock.packages[""]?.version).toBe(VERSION);
  });

  it("has a changelog entry for the current version", () => {
    expect(read("CHANGELOG.md")).toContain(`## ${VERSION}`);
  });

  it("has no runtime dependencies", () => {
    const pkg = JSON.parse(read("package.json")) as { dependencies?: Record<string, string> };
    expect(pkg.dependencies ?? {}).toEqual({});
  });

  it("pins every development dependency exactly", () => {
    const pkg = JSON.parse(read("package.json")) as { devDependencies: Record<string, string> };
    for (const [name, version] of Object.entries(pkg.devDependencies)) expect(version, name).toMatch(/^\d+\.\d+\.\d+$/);
  });
});

describe("the README", () => {
  it("documents every command-line option", () => {
    const readme = read("README.md");
    const flags = new Set(HELP.match(/--[a-z][a-z-]+/g));
    expect(flags.size).toBeGreaterThan(10);
    for (const flag of flags) expect(readme, flag).toContain(flag);
  });

  it("documents every exit code", () => {
    const readme = read("README.md");
    for (const code of ["0", "1", "2", "3", "4"]) expect(readme).toMatch(new RegExp(`\\|\\s*${code}\\s*\\|`));
  });
});

describe("claims the code does not support", () => {
  const files = ["README.md", "SECURITY.md", "docs/adr/0004-personal-data-policy.md", "docs/adr/0006-no-runtime-dependencies.md", "docs/adr/0002-read-only-by-construction.md"];

  it("do not say that personal data is never requested: customer objects are retrieved for two checks", () => {
    for (const f of files) expect(read(f), f).not.toMatch(/never requested|neither requested|nor requested|never fetched/i);
  });

  it("do not say that no package has an install script: the lock file lists optional native packages with one", () => {
    for (const f of files) expect(read(f), f).not.toMatch(/none of the packages needs an install script|no dependency needs an install script|no package needs an install script/i);
  });
});

describe("markdown links", () => {
  function markdownFiles(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      if (name === "node_modules" || name === ".git" || name === "dist" || name === "coverage") return [];
      const full = join(dir, name);
      return statSync(full).isDirectory() ? markdownFiles(full) : full.endsWith(".md") ? [full] : [];
    });
  }

  it.each(markdownFiles(ROOT).map((f) => [f.slice(ROOT.length + 1), f] as const))("%s has no broken relative link", (_name, file) => {
    const text = readFileSync(file, "utf8").replace(/```[\s\S]*?```/g, "");
    for (const m of text.matchAll(/\]\((?!https?:|mailto:|#)([^)#\s]+)(?:#[^)]*)?\)/g)) {
      const target = resolve(dirname(file), m[1] as string);
      expect(existsSync(target), `${file}: ${m[1]}`).toBe(true);
    }
  });
});
