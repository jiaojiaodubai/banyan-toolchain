# Banyan Toolchain

One workspace for the parts that must agree about Banyan style declarations:

- `@banyan/core` — the host-agnostic runtime: sandbox bridge, normalization,
  fallback, rendering and the domain schema.
- `@banyan/style-contract` — executor-neutral declaration facts, stable
  diagnostic identifiers, caps, reserved keys, schema facts and policy.
- `eslint-plugin-banyan-style` — the first-party authoring linter. It consumes
  the contract and ships as one self-contained ESM bundle.
- `@banyan/style-test-kit` — offline style execution, RDF/library fixtures,
  snapshots and the lint CLI.
- `@banyan/conformance` — canonical fixtures that run through both the linter
  and the runtime and compare diagnostic identifiers.

The Zotero host product (`../Banyan`) and the full style library
(`../banyan-styles`) are separate repositories. They consume a toolchain
revision; they are not workspace packages.

## Why one workspace

The linter and the runtime answer the same questions about a style declaration
but operate on different inputs: an AST versus a sandbox value. A second,
hand-maintained copy of the caps, denied keys, schema vocabulary or diagnostic
names drifts from the one the runtime executes. The contract owns those facts;
each executor owns only its projection:

```text
                 @banyan/style-contract
                    ↑              ↑
         @banyan/core      eslint-plugin-banyan-style
                    ↑              ↑
              @banyan/style-test-kit
                    ↑
               @banyan/conformance
```

Hard rules:

- `style-contract` imports no Node, ESLint, Zotero or sandbox API.
- `core` must not depend on ESLint.
- the lint bundle may inline the contract's pure code, never the core runtime.
- the runtime always keeps its own final fallback, even if lint is disabled.

## What a consumer can rely on

- **Contract facts.** `@banyan/style-contract` exports the caps, reserved keys,
  parameter field sets, denied preset keys, key normalization, the
  `ContractDiagnosticId` catalogue, `ContractFinding`, `EXECUTOR_POLICY` and the
  generated Zotero/CSL facts. Both executors read them; neither restates them.
- **Diagnostic identity.** A finding is a `diagnosticId` plus a declaration
  `path`. The runtime attaches it as `StyleMessage.finding`; the linter maps
  `(rule, messageId)` to the same value. Severity and prose differ by design,
  and identifier renames are breaking.
- **Lint artifact.** One ESM bundle plus a build-metadata file. A host copies
  those two files next to its style typings; it does not install the package at
  runtime.
- **Manifest and lock.** `toolchain.manifest.json` names the revision, the
  contract and schema revisions, the supported Node/ESLint ranges and the hash
  of every artifact. A consumer's `toolchain.lock.json` repeats those facts and
  adds the local source path it resolves against; a host that copies the lint
  bundle into its own tree (`Banyan`) also records those copies' hashes.

## Documents

- [`CHANGELOG.md`](CHANGELOG.md) — what moved between toolchain revisions, at
  the surface listed above.
- [`docs/architecture/lint-runtime-contract.md`](docs/architecture/lint-runtime-contract.md)
  — the two executors, the diagnostic protocol and the executor policy.
- [`AGENTS.md`](AGENTS.md) — working rules for contributors and coding agents.
- each package keeps its own `README.md`, `CHANGELOG.md` and, where a host needs
  more, a `docs/` directory.

## Commands

```bash
pnpm install
pnpm build            # contract → core → lint bundle
pnpm test             # build, then every package suite and the parity corpus
pnpm check            # build, typecheck, lint, tests, artifact pack/verify/smoke
pnpm parity           # conformance fixtures only
pnpm test:eslint10    # replay the conformance corpus with ESLint 10
pnpm gen:schema       # regenerate Zotero/CSL tables and the contract facts
pnpm contract:revision # print the contract source hash the manifest records
pnpm pack:artifacts   # tarballs + lint bundle under artifacts/
pnpm manifest         # hash the artifacts into toolchain.manifest.json
```

`pnpm gen:schema` writes `packages/style-contract/src/generated/schema-facts.ts`.
The output is committed; `pnpm --filter @banyan/core check:schema-facts` detects
a stale projection.

## Artifacts and versions

Distribution is keyed by a **toolchain revision**, not by a set of npm versions.
`pnpm pack:artifacts` produces:

- `artifacts/banyan-style-contract-<version>.tgz`
- `artifacts/banyan-core-<version>.tgz`
- `artifacts/eslint-plugin-banyan-style-<version>.tgz`
- `artifacts/banyan-style-test-kit-<version>.tgz`
- `artifacts/eslint-plugin-banyan-style.mjs` and its build metadata

`toolchain.manifest.json` records the source revision, a contract **source**
hash, the schema revision, the supported Node/ESLint ranges, package versions
and the SHA-256 of every artifact.

- `toolchainRevision` is the newest commit that changed a build input. Root
  documentation (root `*.md`, `docs/**`), CI configuration (`.github/**`) and
  the manifest itself are excluded, so a root-docs-only or CI-only commit does
  not move the revision. Package documentation travels inside the artifacts, so
  it stays a build input.
- `contractRevision` is computed from tracked contract build inputs
  (`package.json`, both tsconfigs and `src/**`) using their Git blob bytes, not
  from the gitignored `dist/`. A consumer can re-derive it at the named
  revision with `pnpm contract:revision`.
- `supportedNode` is copied from the root `engines.node`; `supportedEslint` is
  copied from the lint package's peer range. Both are checked against those
  package files, and the ESLint 10 half is exercised by `pnpm test:eslint10`.
- Artifact hashes sort entries by code unit rather than locale, include
  directories and symlinks, hash symlink targets without following them, and
  reject unsupported entry types instead of silently omitting them.

A consumer keeps one `toolchain.lock.json` pointing at that revision; it must
not add independent core/lint/test-kit pins. `pnpm smoke:artifacts` installs the
four tarballs named by the manifest into a throwaway consumer, using the
documented `overrides` mapping, and imports the runtime, contract and lint
bundle.

The manifest check walks Git history, so CI checks out with `fetch-depth: 0`.
A shallow checkout can build the artifacts but cannot verify
`toolchainRevision`.

Local development in `Banyan` and `banyan-styles` uses `link:` to this checkout.
CI must install the hashed artifacts from the manifest instead of relying on a
sibling directory. npm publication is deliberately deferred until there are
external consumers, multiple supported versions or a real registry need.

## Layout

```text
packages/
  core/                 runtime, schema generators, host contract tests
  style-contract/       shared facts, diagnostics, generated schema projection
  eslint-plugin/        rules, flat-config factory, build.mjs
  style-test-kit/       offline runner, fixtures, CLI
  conformance/          fixtures/ and the lint/runtime parity runner
tools/
  pack-artifacts.mjs
  artifact-names.mjs
  generate-toolchain-manifest.mjs
  check-artifacts.mjs
  source-revision.mjs
  contract-revision.mjs
  verify-eslint10.mjs
docs/
  architecture/         contract and executor design
```

## Status

Pre-1.0 and unpublished. Consumers take one toolchain revision through
`toolchain.lock.json`; the packages are not published to npm, and independent
pins are not supported. Before `1.0.0`, minor package versions may change the
contract: [`CHANGELOG.md`](CHANGELOG.md) records exactly what moved between
revisions, and the architecture document explains how the executors are allowed
to differ.
