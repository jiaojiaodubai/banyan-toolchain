# Agent guide

This repository is the Banyan toolchain: the shared style contract, the runtime,
the first-party ESLint plugin, the test kit and the conformance corpus.
[`README.md`](README.md) is the entry point; each package keeps its own README
and CHANGELOG.

## Boundaries

- `@banyan/style-contract` owns the declaration facts: caps, reserved keys,
  denied preset keys, key normalization, diagnostic ids and the generated
  Zotero/CSL vocabulary. `core` and the lint package consume them; neither keeps
  a second copy.
- `core` must not depend on ESLint. The lint bundle must not import the core
  runtime; it may inline the contract's pure code.
- The runtime keeps the final fallback even when lint is disabled.
- Diagnostic ids are append-only. Renaming or removing one is a breaking change.

## Change discipline

- Consumer-visible changes get an entry in the root [`CHANGELOG.md`](CHANGELOG.md).
  Public docs — README, `docs/`, package docs — describe the current state only;
  do not add migration narratives or decision history there.
- A change to the contract's build inputs moves `toolchainRevision` and the
  artifact hashes. Run `pnpm gen:schema` when the Zotero/CSL schema dependency
  moves, and commit the regenerated facts.
- Local engineering records (decisions, rejected alternatives, migration notes)
  live in the gitignored `internal/` directory. Read `internal/README.md` before
  re-opening a boundary decision, keep that record current when one changes, and
  never commit the directory.

## Commands

```bash
pnpm install          # pnpm 10.24.0; Node ^22.18.0 || >=24
pnpm build            # contract → core → lint bundle
pnpm check            # the CI gate: build, typecheck, lint, tests, artifacts
pnpm test             # build, then every package suite and the parity corpus
pnpm parity           # conformance fixtures only
pnpm test:eslint10    # replay the parity corpus with ESLint 10
```

`pnpm check` walks Git history; a shallow checkout fails the manifest check.
`pnpm lint` runs Prettier over all Markdown, `tools/**` and root JSON, then each
package's own check. Format documentation before finishing.

## Conventions

- Root documentation is English; the lint and test-kit package docs are Chinese.
  Match the language of the file you edit.
- `packages/core/dist/` is committed and generated: never edit it by hand.
  `pnpm check:dist` rebuilds and fails when the committed artifact is stale.
- Do not add compatibility aliases for renamed contracts before `1.0.0`.
- Before `1.0.0`, a minor package version may contain a contract change; patch
  versions stay compatible.
