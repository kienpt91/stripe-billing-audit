# 0006. Zero runtime dependencies and the supply-chain policy

Status: accepted

## Decision

- **No runtime dependencies.** HTTP is global `fetch`, argument parsing is `node:util`'s `parseArgs`, and there is no hashing, crypto or filesystem code at all. `npm ls --omit=dev` is empty. A tool that holds a payment key should not execute code from transitive packages.
- **Development dependencies are four**: `typescript`, `vitest`, `@vitest/coverage-v8`, `@types/node`. They run in tests and the build only, nothing from them is in `dist`.
- **Exact pins** and a committed lock file. Every locked package, direct and transitive, was published at least seven days before the date it was added (`npm install --before=...`, checked with `npm run check:deps-age`). Installs use `--ignore-scripts`, so no dependency script is executed. The lock file lists optional platform-native packages of the toolchain (for example `fsevents`, which declares an install script for macOS); they are installed without running it and are not part of `dist`.
- **Builds and tests run in throwaway containers** during development, and CI uses `npm ci --ignore-scripts`.
- **GitHub Actions are pinned to full commit SHAs.** The workflows have `contents: read` by default; the release workflow gets write permissions only in the job that creates the release.
- **Dependabot** proposes updates only after a seven-day cooldown and ignores major bumps of `typescript` and `@types/node`.
- Node 24 is the minimum (`engines`). Its `fetch`, `AbortSignal.timeout` and `parseArgs` are the features used.

## Consequences

- Nothing to audit but this repository for the code that touches the key.
- Upgrades of the toolchain are deliberate, reviewed pull requests.
