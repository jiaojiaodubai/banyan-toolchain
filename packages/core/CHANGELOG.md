# Changelog

All notable changes to `@banyan/core` are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning follows the
policy at the bottom of this file.

## [0.1.0] - 2026-11-02

The first release.

### Added

- Host-agnostic core runtime: style loading, sandbox assembly, export contract
  checks, parameter resolution, Unit compilation, text-case, output
  normalization, diagnostics and schema data.
- `@banyan/style-contract` dependency for caps, reserved keys, parameter field
  sets, denied preset keys, key normalization and generated Zotero/CSL facts.
  The item-type, CSL and denied-key tables come from that contract rather than a
  second copy inside the core.
- `STYLE_DEPENDENCIES` and the `callStyle(id, contexts, optionValues?)` utility:
  a style may run another style's `generate()` over a batch of contexts and get
  its normalized `citations` / `bibliography` back. Only declared ids resolve;
  cycle, depth (three styles including the top level), per-run call budget (16),
  remaining-time timeout (30 s per call, covering `resolveStyle()` and the
  child's load as well as its `generate()`) and `citationType` agreement are
  checked in the core, and every failure is a returned
  `{ ok: false, reason, message }` result plus one finding on the caller.
- `STYLE_RESOURCES` and the `loadResource(id)` utility: a declared, byte- and
  time-capped asset read. An asset's id is also its file name, so the core reads
  `assets/<id>` (lowercase letters, digits and single hyphens; no extension)
  from the style directory, enforces a 4 MiB cap and a 10 s deadline, decodes
  UTF-8, parses JSON and caches the frozen result for the instance's lifetime; a
  read still in flight is shared with concurrent callers, so the instance sees
  one read per resource. Assets are shared, publicly maintained data, so there
  is no per-style `path` or `validate()`; failures are returned, not thrown, and
  `timeout` is remembered for the rest of the run. `loadResource()` is the only
  style-facing file read: no raw `read*` utility is exposed.
- Optional host capability `resolveStyle(id)` returning a called style's `code`
  and its own directory's `readFile`. `REQUIRED_HOST_CAPABILITIES` and
  `assertHostCapabilities()` are unchanged; without the capability delegation
  degrades to `unresolved`.
- Child instances are private to the parent that created them, so two top-level
  styles that call each other cannot deadlock on their serialized `generate()`
  queues. A delegated style's findings are forwarded to the caller with
  `detail.via`; a timed-out child is discarded and skipped for the rest of the
  run.
- A style instance's load now also normalizes `STYLE_DEPENDENCIES` and
  `STYLE_RESOURCES` and exposes them on `Style` / `StyleInstance`; a host can
  preflight an install before a document is touched.
- `validation/dependencies` and `validation/resources` normalizers, exported
  from the package index, with the same `warn(messages, …)` shape as the other
  declaration validators.
- `dev/hostIntegration.md` documents the optional capability, the resource
  snapshot semantics and the `readFile` directory rule.
- Note-citation contexts may carry the host's note kind: an optional
  `CitationContext.noteType` (`"footnote"` / `"endnote"`), absent for in-text
  citations and for legacy hosts that do not distinguish notes. Endnote hosts
  send `page: 0`, a no-page sentinel, so per-page styles do not restart endnote
  numbering; styles must not group endnote contexts by page. The kind is a
  per-context host fact, not a request-level flag, because one document can mix
  notes. An unknown kind fails as `generate-input` at
  `contexts[i].noteType`, using the style contract's `NOTE_TYPES` /
  `isNoteType()` facts.
- Optional `StyleMessage.finding` with a stable `diagnosticId`, a declaration
  path and structured data. The runtime phase remains in `StyleMessage.code`.
- `StyleHost` / `SandboxRuntime` / `SandboxContext` ports with a minimal
  `SandboxContext`; the host owns isolation, capabilities and value bridging.
- Three explicit capabilities: `parseHtml`, `readFile`,
  `resolveMultilingualItems`; a missing capability fails at the point of use
  instead of degrading.
- `StyleInstance.diagnostics` plus optional `messageSink`; closed `RuntimeCode`
  values (`style-load`, `style-contract`, `host-capability`, `generate`,
  `generate-input`, `generate-output`, `generate-timeout`).
- Declared parameter model: `STYLE_OPTIONS` / `CITATION_PARAMS` /
  `CITE_PARAMS`, `state` / `value` / `list`, `applicable` / `forcedValue` /
  `validate`, stored/effective resolution and `valueSources`.
- Per-cell list provenance: `ParamValidation.source` (`provided` / `default`)
  in addition to parameter-level `valueSources`.
- `ITEM_FIELD_PRESETS` / `ITEM_FIELD_VALIDATORS` support, including an
  asynchronous field-check runner with a per-check timeout.
- Field-preset diagnostics classify a written `type:` value: a CSL or CSL-M item
  type is a warning (Zotero's documented escape hatch for types it does not
  have), a Zotero-only or unknown value is an error because citeproc would treat
  the item as untyped, and a key neither schema nor the sandbox reads
  (`creators-ext`) is a warning because citeproc ignores it.
- State values are matched after trim. Two keys that collide after trimming are
  reported, the first spelling wins, and the later duplicate is dropped instead
  of silently overwriting the default.
- A missing enum `defaultValue` is reported before falling back to the first
  state.
- One Unit compiler for generate output, `plainText` and `htmlToUnit`; built-in
  text-case implementations with a Zotero differential test.
- Core-owned Zotero / CSL schema generation, public models, query predicates
  and generated JSON assets, guarded by drift tests. CSL-M ships as a separate,
  complete schema (`CSL_M_*` tables and `CSL_M_SCHEMA`, plus the `CSL_M_ONLY_*`
  delta); queries expose both the complete schema and its delta, and CSL and
  CSL-M are never merged into one vocabulary.
- `evaluateTimeoutMs` for hosts whose `evaluate` supports a synchronous budget;
  `generateTimeoutMs` for the async generate budget.
- Aggregate `pnpm test` script (unit + contract); CI workflow running lint,
  tests and `check:dist`; source debt tags and contract/docs name checks
  enforced by `pnpm lint:check`.
- Coverage (`pnpm coverage`), deterministic hostile-input fuzz (`pnpm fuzz`)
  and property-based text-case invariants (`fast-check`).
- Performance benchmark harness (`pnpm bench`) and methodology notes in
  `dev/performance.md`, `dev/coverage.md` and `dev/fuzzing.md`.

### Notes

- `Item.id` is an opaque string; persistent references live in the host-private
  `z:uri` extension, not in the core contract.
- `generate()` has one host-facing form: always a Promise.
- Validators are synchronous; hosts read validation from `ParamState` rather
  than invoking style validators themselves.
- A generate timeout abandons the wait but cannot interrupt the sandboxed
  promise chain; hosts that need strict isolation must recreate the instance.
- Guards on the edges of these features are part of the contract: a root style
  without a usable `INFO.id` still occupies one slot of the delegation chain, so
  the depth limit keeps counting styles; a `readFile` refusal that a host marks
  `reason: "too-large"` is reported as `resource.too-large` instead of
  `resource.missing`; and the delegation budget covers resolution and the
  child's load, not only its `generate()`, so a host that never settles cannot
  hold the caller past it.

## Versioning policy

This project is pre-1.0 (`0.y.z`). Until `1.0.0`:

- **Minor (`0.y`) releases may contain breaking contract changes.** This is the
  deliberate window to finish naming and shape decisions before compatibility
  promises start.
- **Patch (`0.y.z`) releases contain compatible fixes only.**
- Every public contract change (exported type, export path, documented runtime
  behavior, error code, `dist/` shape) gets a CHANGELOG entry. Breaking entries
  say what breaks and why.
- No compatibility aliases are kept for renamed contracts before 1.0; the
  CHANGELOG is the migration path.
- After `1.0.0`, normal semantic versioning applies: breaking changes only in
  major releases, deprecations announced for at least one minor release.
- `dist/` is committed and `pnpm check:dist` must pass in CI; a release tag
  never points at a tree whose committed artifact differs from a fresh build.
