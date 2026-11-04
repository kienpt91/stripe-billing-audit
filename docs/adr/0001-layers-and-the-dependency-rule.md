# 0001. Layers and a mechanically enforced dependency rule

Status: accepted

## Context

The tool has rules that decide what is wrong with a billing setup, and plumbing that talks to a payment API with a secret key. The rules have to stay testable and reviewable on their own; the plumbing is where the risk is.

## Decision

Four layers, imports point inward only:

```
src/domain          pure: facts, rules, severity, exit codes, key and URL safety, money, calendar
src/application     use cases: decode API JSON into facts, collect them, run the audit, render reports
src/infrastructure  the HTTP reader (global fetch) and the command line parser
src/composition     wires the real adapters, reads the environment, decides what is printed
src/bin.ts          the entry point; imports composition only
```

`test/architecture/layers.test.ts` reads every file under `src`, extracts its imports and fails when

- a layer imports a layer it must not (domain, application, infrastructure, composition, in that order);
- the domain or the application imports a Node built-in or a package;
- the domain or the application touches a clock, randomness, `fetch`, timers, the process, globals or `console`;
- anything outside the composition layer reads `process.env`;
- the infrastructure issues a request whose method is not `GET`;
- any file imports `fs`, `child_process`, `net`, `http(s)`, `tls`, `dns`, `vm` and similar: the tool has no filesystem, process or raw socket access, only `fetch`.

The checker has tests of its own with violating snippets.

## Consequences

- Time reaches the rules only as a number in the facts (`nowSeconds`), so every rule is a pure function and its tests need no fake clock.
- Calendar arithmetic (`isoDate`) is implemented in the domain instead of using `Date`.
- "The tool never writes to disk" is a property of the source tree that a test checks, not a promise in the README.
- Pagination and failure handling live in the application against a `StripeReader` port, so they are tested with an in-memory fake and again against a real loopback server.
