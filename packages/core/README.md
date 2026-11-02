# Banyan Core

`@banyan/core` is the host-agnostic runtime for Banyan Style, a JavaScript style
format for citations and bibliographies. The core loads a style script, runs it
in an isolated context the host provides, and hands back normalized output, so
the same style produces the same result on every host.

## What it contains

| Area                  | Content                                                                                                                     |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `sandbox/createStyle` | Style loading: evaluate the script, bridge values, validate the contract, run `generate()`                                  |
| `sandbox/*`           | The `console` a style sees, the utility table, transpile helpers, runtime errors                                            |
| `validation/*`        | Style/citation/cite parameters, field presets, item field validators, citation contexts                                     |
| `output/*`            | Generate-result normalization (units, RichText, HTML)                                                                       |
| `items/*`, `units/*`  | Item conversion helpers (extra field, creators, language), text-case and unit normalization                                 |
| `richText/*`          | RichText model and HTML rendering                                                                                           |
| `messages`            | The record model for what a run reports (`StyleMessage`) plus `style.diagnostics`                                           |
| `schema/*`            | Zotero and CSL facts: constant tables, runtime models (`ZOTERO_SCHEMA`, `CSL_SCHEMA`), query predicates and the JSON assets |
| `types/*`             | The author contract: Item, Style, Unit and the utility surface                                                              |

The core never prints, never touches a host's globals, database, filesystem or
UI, and assumes no particular DOM or thread model.

## How a host uses it

A host supplies two things and receives the rest:

```ts
import { createStyle } from "@banyan/core/sandbox/createStyle";

const style = await createStyle(
  {
    runtime: myRuntime, // SandboxRuntime: context creation and value bridging
    capabilities: {
      parseHtml, // the three capabilities output depends on
      readFile,
      resolveMultilingualItems,
    },
    assertReady: () => assertHostCapabilities(myCapabilities),
  },
  styleSource,
);

const result = await style.generate(contexts); // { citations, bibliography }
for (const finding of style.diagnostics) present(finding);
```

- **Output equivalence** depends on the three capabilities; a missing one is
  reported where it is used instead of being approximated.
- **What a run reports** comes back as data (`style.diagnostics`, settled per
  run; read it after `generate()` settles) and, optionally, as a stream
  (`messageSink`). Severity is the core's; where records go is the caller's
  decision.
- **Failures** travel as exceptions carrying a mechanical `code`
  (`style-load`, `style-contract`, `host-capability`, `generate`,
  `generate-input`, `generate-output`, `generate-timeout`).
- **Item conversion** helpers ship with the core so hosts produce the same item
  shape; a host may prepare items its own way as long as the shape matches.

The full contract — responsibilities per side, every `SandboxRuntime` /
`SandboxContext` method, capability failure modes, item preparation, value
crossing and scheduling, and a minimal host — is
[dev/hostIntegration.md](dev/hostIntegration.md).

## Public surface

The package root re-exports the main contracts, and stable subpaths exist for
adapters and authoring tooling: `@banyan/core/host`,
`@banyan/core/sandbox/createStyle`, `@banyan/core/messages`,
`@banyan/core/schema/*`, `@banyan/core/types/*`, and one per module directory.
The `src/types/` declarations are the shared source for style authoring: an
editor can generate its global declarations from them instead of keeping a
second hand-copied contract. The style-facing globals are declared there as
`ScriptContexts`, `ScriptOptions` and the `StyleUtils` surface, next to the
result and item shapes. The schema JSON models are readable through
`@banyan/core/schema/zotero-schema.json` and
`@banyan/core/schema/csl-schema.json` (assets, not modules).

## Maturity and distribution

The package is pre-1.0 and still maturing: hosts consume it from this repository
by pinning a commit, and minor revisions may change the contract. It is not
published to npm; a host updates its pinned revision explicitly when it adopts a
newer commit. The integration shape is:

```json
{
  "dependencies": {
    "@banyan/core": "github:jiaojiaodubai/banyan-core#<commit>"
  }
}
```

A local `link:` checkout works the same way during development. `dist/` is
committed on purpose: a `link:` or pinned-Git consumer runs no build step, so
the compiled package has to be in the checkout. It is generated output — never
edit it and never lint it by hand (`.prettierignore` and the ESLint ignore list
skip it) — and `pnpm check:dist` rebuilds and fails when the committed artifact
is stale. If the package later moves to install-time builds (`prepare`, no
tracked `dist/`), that is one deliberate distribution change, not a side effect
of ignoring a build directory.

## Versioning

Pre-1.0 (`0.y.z`) is the deliberate window for contract cleanup: **minor
releases may contain breaking changes**, patch releases stay compatible, and
renamed contracts are not kept as aliases. Every public contract change gets an
entry in [`CHANGELOG.md`](CHANGELOG.md); after `1.0.0` normal semantic versioning
applies. `dist/` is part of the release contract, so a tag never points at a
tree whose committed artifact differs from a fresh build.

## Development

```bash
pnpm install
pnpm lint:fix
pnpm lint:check        # prettier + eslint + typecheck + debt/docs guards
pnpm typecheck
pnpm test              # unit + contract tests (the default full check)
pnpm test:node         # unit tests only
pnpm test:contract     # contract tests against the dev Node host
pnpm build             # dist/ is committed: hosts consume it through the link
pnpm check:dist        # build, then fail if the committed dist/ is stale
pnpm gen:schema        # regenerate src/types/item.d.ts + src/schema/*
pnpm coverage          # c8 report; a diagnostic, not a threshold gate
pnpm fuzz              # deterministic hostile-input smoke
pnpm bench             # smoke performance baseline (not a CI gate)
```

CI runs `pnpm lint:check`, `pnpm test` and `pnpm check:dist` on every push and
pull request (`.github/workflows/ci.yml`). Coverage, fuzz and bench are local
diagnostics: shared-runner noise would make performance a false gate, and
coverage is not a release contract. Their methods and baselines are recorded in
[`dev/coverage.md`](dev/coverage.md), [`dev/fuzzing.md`](dev/fuzzing.md) and
[`dev/performance.md`](dev/performance.md).

`dev/node-host/` is a development-time host built on `node:vm`. It verifies
behaviour, not security: a tool that executes untrusted styles must add
process/Worker isolation, resource limits, a read-only file allowlist, and no
network or host secrets.

## Schema data

The core owns the facts its behaviour depends on and exposes them, so hosts and
tools read the same contracts instead of keeping copies. Three shapes, split by
what they are good at:

| Export                                   | Shape                                         | Content                                                                                                                                      |
| ---------------------------------------- | --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `@banyan/core` (index) / `…/schema`      | `ZOTERO_SCHEMA`, `CSL_SCHEMA`, `CSL_M_SCHEMA` | The trimmed models: per-item-type fields, base fields, creator types, primary creator; official CSL; and the separate, complete CSL-M schema |
| `@banyan/core` (index) / `…/schema`      | query predicates                              | `isZoteroField`, `isZoteroItemField`, `resolveZoteroField`, `isCslVariable`, `isCslMItemType`, `isCslMOnlyItemType`, …                       |
| `@banyan/core/schema/zoteroSchema`       | TS constants                                  | Valid item types, creator types, per-type fields, global field set, primary creator types, base-field aliases, Zotero -> CSL creator names   |
| `@banyan/core/schema/cslSchema`          | TS constants                                  | Official CSL item types and variable sets (names, dates, numbers, titles, strings)                                                           |
| `@banyan/core/schema/cslmSchema`         | TS constants                                  | Complete CSL-M schema, plus its `CSL_M_ONLY_*` delta for CSL-M-specific names                                                                |
| `@banyan/core/schema/zotero-schema.json` | JSON                                          | Same data as `ZOTERO_SCHEMA`, for tools                                                                                                      |
| `@banyan/core/schema/csl-schema.json`    | JSON                                          | Same data as `CSL_SCHEMA`, for tools                                                                                                         |

A host that converts its own item model (or generates one) imports the model
from the package index: no file access, no JSON loader, no `resolveJsonModule`
setting. The constants are the fast path for per-item membership questions, and
the predicates answer them without indexing the tables. Name matching is exact
and case-sensitive, like `Zotero.ItemFields.getID`. The JSON assets are for
tools in other languages; the test keeps them identical to the modules.

The Zotero and official CSL data come from two development dependencies without
a `package.json` (installed as git dependencies, pinned by the lockfile).
`pnpm gen:schema` renders `src/types/item.d.ts` and the generated
`src/schema/*.ts` / `src/schema/*.json` artifacts from them; the generated files
are committed, and the test suite re-renders them from the installed schemas so
a schema bump cannot slip through unnoticed. `src/schema/cslmSchema.ts` is the
one curated schema: CSL-M is defined by citeproc-js, not by the official
`csl-schema` package, and it stays separate from CSL instead of being merged
into it.
See [dev/schemaSources.md](dev/schemaSources.md).
