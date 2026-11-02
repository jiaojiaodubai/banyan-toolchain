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

## a757b75 — 2026-11-02

The first toolchain revision and public release. Five packages make up the
ecosystem — `@banyan/core`, `@banyan/style-contract`,
`eslint-plugin-banyan-style`, `@banyan/style-test-kit` and
`@banyan/conformance` — and all of them are 0.1.0. Schema
`zotero-45+csl-0ee62cac6648+cslm-e507b2fb131c`. Node `^22.18.0 || >=24`;
ESLint `>=9 <11`. Nothing is published to npm: a consumer pins one toolchain
revision through `toolchain.lock.json` and installs the hashed artifacts
described under "Distribution" below.

### Packages

- **`@banyan/style-contract`** — the executor-neutral declaration facts. It has
  no Node, ESLint, Zotero or sandbox dependency, so a host and the lint build
  can both read it: declaration caps (`STYLE_OPTIONS` 16, warning threshold 12,
  states 20, state scan 1000, presets 50), reserved keys, parameter field sets,
  denied preset keys in raw and normalized form, key normalization, the
  dependency and resource caps and key sets, `isValidResourcePath()`, the
  `ContractDiagnosticId` catalogue, `ContractFinding`, `EXECUTOR_POLICY` and the
  generated Zotero / CSL facts.
- **`@banyan/core`** — the host-agnostic runtime: style loading, sandbox
  assembly, export contract checks, parameter resolution, Unit compilation,
  text-case, output normalization, diagnostics and the schema tables.
- **`eslint-plugin-banyan-style`** — the authoring linter. It consumes the
  contract and ships as one self-contained ESM bundle.
- **`@banyan/style-test-kit`** — offline style execution, RDF and library
  fixtures, deterministic snapshots, the lint CLI and the dependency checker.
- **`@banyan/conformance`** — canonical fixtures that run through both the
  linter and the runtime and compare diagnostic identifiers.

### The runtime

`@banyan/core` is the single implementation of the author contract. A host
supplies one runtime port, a capability set and an optional readiness gate;
everything else is the core's.

- The host contract is a `SandboxRuntime` (create a context; evaluate, define
  and read globals, bridge values, defer a host task) plus a set of
  capabilities. `parseHtml`, `readFile` and `resolveMultilingualItems` are
  required — a missing one fails at the point of use instead of degrading — and
  `resolveStyle` is optional, for delegation only (see below).
  `REQUIRED_HOST_CAPABILITIES` and `assertHostCapabilities()` describe the
  required set; a host may also declare readiness through `assertReady`.
- A style is evaluated, its exports are checked against the declaration
  contract, and the instance exposes exactly what the author wrote plus the
  normalized declarations (`STYLE_OPTIONS`, `CITATION_PARAMS`, `CITE_PARAMS`,
  `STYLE_DEPENDENCIES`, `STYLE_RESOURCES`, `ITEM_FIELD_PRESETS`,
  `ITEM_FIELD_VALIDATORS`). `generate()` has one host-facing form: always a
  Promise, with `generateTimeoutMs` as its budget.
- Parameters have one resolver. `state` (boolean or `states` enum), `value`
  (plain or rich markup) and `list` (repeated value fields) each declare a
  `defaultValue` and may add `applicable`, `forcedValue` or `validate`; the
  runtime resolves all three scopes before `generate()`, and
  `citation.source` keeps the stored values. Per-cell list provenance is
  `ParamValidation.source` (`provided` / `default`).
- Output has one Unit compiler for `generate()` results, `plainText()` and
  `htmlToUnit()`, with built-in text-case implementations checked against
  Zotero's behaviour. All three resolve markup and entities the same way, so
  `plainText()` is the text a reader sees rather than the stored source, and
  `title` case keeps the spaces and skip-word positions around `nocase` and
  small-caps runs.
- Diagnostics are data. `StyleMessage.finding` carries `diagnosticId`, a
  declaration `path` and optional `data`; `StyleMessage.code` stays the run
  phase, and thrown errors carry a closed `RuntimeCode`: `style-load`,
  `style-contract`, `host-capability`, `generate`, `generate-input`,
  `generate-output`, `generate-timeout`. A style's findings reach the host as
  `StyleInstance.diagnostics` or through an optional per-run `messageSink`.
- Schema data is the core's own. Zotero item types, creator types, base-field
  aliases and the CSL vocabulary are generated from the Zotero and CSL schemas,
  guarded by drift tests; CSL-M ships as a separate complete schema and is never
  merged into the CSL vocabulary.
- `evaluateTimeoutMs` lets a host bound a synchronous evaluation;
  `generateTimeoutMs` bounds the async run. A generate timeout abandons the wait
  but cannot interrupt the sandboxed promise chain, so strict isolation is a
  host concern.

### Style dependencies and resources

Two optional, statically declared exports let a style use something it does not
own, without turning a declaration problem into a failed document.

- `STYLE_DEPENDENCIES` (`{ id }[]`, at most 4) with `callStyle(id, contexts,
optionValues?)`: the called style's own `generate()` runs over the batch, and
  the caller gets its normalized `citations` and `bibliography`. A chain may not
  repeat an id (`cycle`) or grow past three styles including the top level
  (`depth`); one top-level run may make 16 calls (`budget`); one call is bounded
  by the smaller of the remaining run budget and 30 seconds (`timeout`), and
  that budget covers resolving and loading the child as well as its
  `generate()`. The called style must agree on `INFO.citationType`
  (`citation-type-mismatch`). Child instances are private to the parent that
  created them, so two top-level styles that call each other cannot deadlock on
  their serialized `generate()` queues.
- `STYLE_RESOURCES` (`{ id, path, format, validate? }[]`, at most 8) with
  `loadResource(id)`: the core checks the path itself (no `..`, absolute path,
  backslash, NUL or URL scheme), caps the read at 4 MiB and 10 seconds, decodes
  UTF-8, parses JSON when the format says so and runs the declared `validate()`.
  Success is an instance-level frozen snapshot and concurrent calls share one
  in-flight read; failures are not cached, except `timeout`.
- Neither utility throws. Every failure is a
  `{ ok: false, reason, message }` result plus one `warning` finding on the
  caller (`unresolved`, `undeclared`, `cycle`, `depth`, `budget`, `timeout`,
  `failed`, `citation-type-mismatch` for a call; `undeclared`, `unavailable`,
  `missing`, `too-large`, `invalid`, `timeout` for a read), so a style can keep
  its fallback branch.
- The only new host surface is the optional `resolveStyle(id)` capability,
  returning a style's `code` and its own directory's `readFile`; without it
  every delegated call degrades to `unresolved`. A delegated style's findings
  reach the caller with `detail.via` naming the chain.

### The linter

- The rules answer the questions the runtime asks, on the AST: parameters and
  presets, item-field presets and validators, dependency and resource
  declarations, and author advice that is statically provable (`lint.*`
  identifiers: recursion, unbounded loops, item-field labels, parameter count).
  Static-only advisories never appear as runtime findings.
- `validate-style-dependencies` and `validate-style-resources` check shape,
  ids, paths, formats and caps; `warn-undeclared-resource-read` suggests the
  declared path when a style calls `readBytes` / `readText` / `readJSON` with a
  literal path directly. `callStyle` and `loadResource` are author globals even
  with older style typings.
- Every rule message maps to the same identifier through
  `RULE_MESSAGE_DIAGNOSTICS`; a test fails when a message has no mapping.
- The package ships as one self-contained ESM bundle,
  `eslint-plugin-banyan-style.mjs`, plus `eslint-plugin-banyan-style.build.json`
  (version, schema revision, diagnostic count). The bundle inlines the
  contract's pure code and the style-utils globals extractor; it never imports
  `@banyan/core` or ESLint. Node built-ins stay external.
- Both ESLint 9 and ESLint 10 are supported; `pnpm test:eslint10` replays the
  conformance corpus on 10.

### The test kit

- `@banyan/style-test-kit` runs a style offline through the same core and the
  same toolchain revision as the linter: `node:vm` realms with the required
  capabilities, Zotero RDF parsing and serialization, a JSON item database with
  a generated schema, deterministic snapshots, and an optional process-isolated
  runner with wall-clock, heap and output-size limits. The default in-process
  runner is documented as a correctness boundary; untrusted styles must use
  `--isolated` or an external container.
- The CLI covers `run`, `unit`, `items validate|dump|schema`, `rdf dump|build`
  and `deps`. `deps` indexes one or more style directories and reports
  duplicate or missing styles, cycles, chains past the depth limit, and
  resources that are missing, oversized, unparsable or rejected by `validate()`;
  it exits non-zero for CI. Each style's top level runs under a synchronous
  budget (`evaluateTimeoutMs`, 2 s by default) so a style that never returns is
  a reported load failure, and index and issue records carry a machine-readable
  `kind` instead of a classification parsed out of a message.
- `createTestKitHost({ stylePaths })` and the repeatable `--style-path` option
  also implement `resolveStyle`, resolving an id by `INFO.id` to
  `<dir>/style.js` with `readFile` confined to that style's directory under the
  same containment, symlink and size rules as `--style-dir`. Public API:
  `analyzeDependencies()`, `indexStyles()` and `createTestKitStyleResolver()`.

### Conformance

`@banyan/conformance` holds the canonical fixtures — parameters and presets,
state-key handling, denied preset keys, empty groups, unknown item types, and
the dependency and resource declarations. Each fixture runs through the built
lint bundle and through the real Node sandbox host and is compared by
diagnostic identifier, so the two executors cannot drift silently. The same
corpus also checks the generated Zotero/CSL facts and the lint bundle boundary.

### Distribution

- `toolchain.manifest.json` records the revision, the contract and schema
  revisions, the supported Node/ESLint ranges, the package versions and the
  SHA-256 of every artifact.
- `pnpm pack:artifacts` produces the four tarballs and the lint bundle with its
  metadata; `pnpm smoke:artifacts` installs exactly those files into a
  throwaway consumer, and `pnpm check:artifacts` re-derives every hash.
- Consumers keep one `toolchain.lock.json` instead of per-repository Git pins.
  `Banyan` additionally records the hashes of its generated addon copies, and
  `pnpm check:consumers` verifies both sibling locks against the manifest.
- The workspace's own gate is `pnpm check`: build, typecheck, lint, every
  package suite, the parity corpus, ESLint 10, artifact pack/verify and the
  install smoke test.

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
- Declaration problems are findings, not load failures: an unusable entry is
  dropped (dependency/resource `id.invalid`, `id.duplicate`, `path.invalid`,
  `format.invalid`, `validate.invalid`, `dependency.id.self`) and both executors
  report the same identifier. A cap overflow is `dependency.limit` /
  `resource.limit`; the runtime keeps the first entries and warns, lint errors.
- A call refuses to touch the host for an undeclared id, refuses a repeated id
  or a chain past three styles before any queue is joined, and refuses a style
  whose `INFO.citationType` differs. The depth limit counts styles, not ids: a
  top-level style without a usable `INFO.id` still occupies one chain slot.
- A resource is validated before the host sees the path. When a host's own size
  cap refuses a read it marks the error `reason: "too-large"`, which the core
  reports as `resource.too-large`; an unmarked refusal stays `resource.missing`
  rather than guessing.
- A delegated style's resources resolve through its own `readFile`, never the
  caller's. `readBytes` / `readText` / `readJSON` keep their signatures and
  host-policy paths; `loadResource()` is the checked path above them.
