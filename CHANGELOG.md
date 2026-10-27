# Changelog

This file records every change at the toolchain's consumer-facing surface:
package entry points, the shared style contract, diagnostic identifiers, the
lint bundle and its build metadata, and the manifest / lock format. Work that
stays inside an implementation is not recorded here — a revision with no entry
did not change anything a consumer can observe.

Each package also keeps its own `CHANGELOG.md` for its own API history; this
file records the toolchain revision and the surfaces that span packages.

## How a revision is identified

Distribution is keyed by a **toolchain revision**, not by npm versions.

- `toolchainRevision` is the newest commit that changed a build input. A
  docs-only or CI-only commit does not move it and gets no entry here.
- `contractRevision` hashes the contract's tracked build inputs.
- `schemaRevision` names the generated Zotero / CSL vocabulary as
  `zotero-<version>+csl-<hash>+cslm-<hash>`.
- Package versions are listed for reading and troubleshooting only.
- A consumer keeps one `toolchain.lock.json` that names the revision and
  verifies artifact hashes. Independent package pins are not supported.

Diagnostic identifiers (`ContractDiagnosticId`) are append-only. Renaming or
removing one is a breaking change even while the packages are private, because
fixtures, locks and stored reports keep the string. Severity and English prose
are not part of that contract; the identifier is.

## PENDING — 2026-10-27

The first toolchain revision and public release. The four distributed packages
are all 0.1.0: `@banyan/core`, `@banyan/style-contract`,
`eslint-plugin-banyan-style` and `@banyan/style-test-kit`; `@banyan/conformance`
is 0.1.0 as well. Schema
`zotero-45+csl-0ee62cac6648+cslm-e507b2fb131c`. Node `^22.18.0 || >=24`;
ESLint `>=9 <11`.

### Added

- `@banyan/style-contract`, importable by hosts and by the lint build, with no
  Node, ESLint, Zotero or sandbox dependency: declaration caps
  (`STYLE_OPTIONS` 16, warning threshold 12, states 20, state scan 1000,
  presets 50), reserved keys, parameter field sets, denied preset keys in raw
  and normalized form, key normalization, the `ContractDiagnosticId`
  catalogue, `ContractFinding`, `EXECUTOR_POLICY` and the generated
  Zotero / CSL facts.
- `StyleMessage.finding` carries `diagnosticId`, `path` and optional `data`.
  `StyleMessage.code` stays the run phase (`style-load`, `generate`, ...).
- Every lint rule message maps to the same identifier through
  `RULE_MESSAGE_DIAGNOSTICS`; a test fails when a message has no mapping.
- Static-only advisories never appear as runtime findings; author advice uses
  `lint.*` identifiers (recursion, unbounded loops, item-field labels, parameter
  count), and unresolvable keys use the matching `*.dynamic` identifier.
- `@banyan/conformance`: canonical fixtures executed through the built lint
  bundle and through the real Node sandbox host, compared by identifier.
- `toolchain.manifest.json` plus `pnpm pack:artifacts`: four tarballs and the
  lint bundle with its metadata, each recorded by SHA-256. `pnpm smoke:artifacts`
  installs exactly those files into a throwaway consumer.
- The linter ships as one self-contained ESM bundle,
  `eslint-plugin-banyan-style.mjs`, plus `eslint-plugin-banyan-style.build.json`
  (version, schema revision, diagnostic count). The bundle inlines the
  contract's pure code and the style-utils globals extractor; it never imports
  `@banyan/core` or ESLint. Node built-ins stay external.
- `@banyan/style-test-kit` exposes `src/index.ts` as its entry and `./src/*`,
  because the style library imports the source entry explicitly.
- Both ESLint 9 and ESLint 10 are supported; `pnpm test:eslint10` replays the
  conformance corpus on 10.
- Consumers keep one `toolchain.lock.json` instead of per-repository Git pins.
  `Banyan` additionally records the hashes of its generated addon copies, and
  `pnpm check:consumers` verifies both sibling locks against the manifest.

### Declaration behavior

Runtime findings are warnings with a defined fallback; the linter reports a
definite error where it can prove one. Renaming a diagnostic identifier is a
breaking change; adding one is not.

- State keys are trimmed before lookup; a key that needs trimming is reported
  as `param.states.key.whitespace`.
- Two keys that collide after trimming are reported as
  `param.states.key.duplicate`; the first spelling wins and later duplicates are
  dropped instead of silently overwriting.
- A `states` declaration without `defaultValue` is reported as
  `param.state.default.missing`. The runtime still falls back to the first
  state; lint rejects the omission.
- A default that is not one of the declared keys is reported as
  `param.state.default.invalid`; a `state` parameter that declares no `states`
  and gets a non-boolean default is reported as
  `param.state.default.boolean-invalid`. Both still fall back, to the first
  state key and to `false` respectively.
- `states: {}` is reported as `param.states.empty`; the runtime degrades to a
  boolean state.
- An empty `STYLE_OPTIONS` array is reported as `param.style-options.empty` and
  ignored by both executors.
- An item type mapped to an empty checker array is reported as
  `validator.group.empty` and ignored; an unknown item type is reported as
  `validator.group.unknown-item-type`.
- Statically certain cap overflows are reported as `param.style-options.limit`,
  `param.states.limit` and `param.presets.limit`; the runtime truncates.
- Denied preset keys are matched in normalized form, so `itemType`, `ItemType`
  and `item type` all report `preset.field.key.denied`.
