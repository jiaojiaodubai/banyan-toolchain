# Host integration

How a host runs Banyan Style with `@banyan/core`, and where the boundary between
the two runs. `src/host.ts` is the contract; this document is the prose around
it, so a host implementation can be written without reading the whole source.

## Who owns what

| The core owns                                                                                                                                 | The host owns                                                                                  |
| --------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Style loading: transpile-helper ledger, sandbox-visible utilities, the style `console`, context view, export extraction, contract validation  | The isolation mechanism: what a context is, its realm semantics, its permission model          |
| Input validation (`generate-input`) and output normalization (units, RichText, HTML markup, citations/bibliography)                           | Everything the style can reach outside the sandbox: files, DOM, items, relations               |
| Records as data (`StyleMessage`, `style.diagnostics`, `code`)                                                                                 | Logging, notifications, dialogs — how anything is presented to a user                          |
| Declared parameters: normalizing declarations, running `applicable`/`forcedValue`/`validate`, resolving effective values and validation state | Rendering widgets, persisting values, reading `states[id]` (including `validation`)            |
| The author contract (`src/types/*`) and the schema data the behaviour rests on (`src/schema/*`)                                               | Item preparation: turning its own model (Zotero items, RDF, an API) into the Banyan item shape |
| One generation at a time per style instance, and a generate timeout                                                                           | Scheduling around it: when to call `generate()`, what to do with the result, retries           |

Two rules follow from that table:

1. **The core never prints and never notifies.** Records come back as data and
   failures as exceptions; presentation is the host's decision.
2. **A capability is never approximated.** What a style can read decides what it
   produces, so a host implements a capability or the core reports it missing at
   the point of use — dropping markup, faking a file read or guessing a relation
   would make the same style render differently per host.

## What a host has to provide

Five parts, each independent — a host may implement them in any order, but none
is optional for a working integration:

| Part               | Requirement                                                                                                                                                    | Where it is checked                            |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| Execution          | `SandboxRuntime.createContext()` plus all ten `SandboxContext` methods, honouring the realm notes below; one context per style, no shared realm between styles | `createStyle` at load; every generate          |
| Three capabilities | `parseHtml`, `readFile`, `resolveMultilingualItems` — implement, never approximate                                                                             | At the point of use (`requireCapability`)      |
| Item preparation   | Produce the `src/types/item.d.ts` shape (`id` as a string, `itemType` and the normalized fields), or reuse the core's conversion helpers                       | When the style reads `contexts[i].item`        |
| Output handling    | Read `style.diagnostics` (settled per run) and/or pass a `messageSink`; decide what a user sees, per severity                                                  | After `createStyle` and after every generate   |
| Failure handling   | Catch the exception, branch on `code`, keep the original stack; decide which codes deserve a dialog                                                            | Around `createStyle` and around every generate |

A host that also wants fail-fast assembly implements `assertReady()` — usually
`assertHostCapabilities(capabilities)`, which lists everything missing at once.

### Output: data first, stream optional

```ts
const style = await createStyle(host, code, { messageSink });
style.diagnostics; // findings of the load + the latest run
await style.generate(contexts, storedOptionValues);
style.diagnostics; // the same array, now with this run's findings
```

`style.diagnostics` is the primary channel: deduplicated, capped, settled per
run, and stable by reference. `messageSink` is for callers that need records as
they happen, including the `trace` lines that are never kept. Neither is a host
capability — a host decides per call site whether it wants a log at all.

## The contract

```ts
const style = await createStyle(host, code, options?);

interface StyleHost {
  runtime: SandboxRuntime;                 // required
  capabilities?: Partial<StyleHostCapabilities>; // may be attached late
  assertReady?(): void;                    // optional readiness gate
}

interface CreateStyleOptions {
  messageSink?: StyleMessageSink;          // records as they happen, traces included
  generateTimeoutMs?: number;              // async generate budget (default 15 min)
  evaluateTimeoutMs?: number;              // best-effort sync budget, see below
}
```

### `SandboxRuntime` — isolation is yours

```ts
interface SandboxRuntime {
  createContext(options?: { name?: string }): SandboxContext;
}
```

`createStyle` asks for **one context per style** and does the assembling itself:
it generates the source fragments, installs the utilities and the context view,
evaluates the style code and extracts the exports. A host decides what a context
_is_: a Gecko sandbox with a null principal, `node:vm` with a fresh realm, a
Worker, an iframe — whatever its platform offers. `dev/node-host/runtime.ts` is a
reference for the Node case, and its header states the important limitation:
`node:vm` is a _correctness_ host, not a security boundary. A host that runs
untrusted styles needs process/Worker isolation, resource limits and its own
permission policy; the core cannot provide that.

`SandboxContext` is the set of primitives the core needs (all of them are used):

| Method                                                                  | Meaning                                                          | Realm note                                                                                                                                                                                                                                                             |
| ----------------------------------------------------------------------- | ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `evaluate(source, options?)`                                            | Run a core-generated fragment, return its value                  | `options.filename` for stack traces; `options.timeoutMs` where the platform supports it (Gecko ignores it). The core passes it for style load and for the synchronous part of `generate()` when `createStyle(..., { evaluateTimeoutMs })` is set                       |
| `defineGlobal(name, value)` / `readGlobal(name)` / `deleteGlobal(name)` | Expose a host value to the context, read one back                | A host decides whether globals are enumerable, writable, configurable — but it **must allow replacing an existing global of the same name**: the core installs `console` this way, and an environment that already provides one (Gecko's sandbox, `node:vm`) is normal |
| `createObject()`                                                        | An object _owned by the context_ (export container, host bridge) | Must belong to the sandbox realm, not the host's                                                                                                                                                                                                                       |
| `defineFunction(target, name, fn)`                                      | Attach a host callback to a context-owned object                 | The host decides the wrap: Gecko exports the function into the sandbox, `vm` wraps it in a realm-side closure                                                                                                                                                          |
| `deferHostTask(callback)`                                               | Run a host task after the current sandbox execution              | Callbacks that fire while the sandbox runs must not bridge values straight back: Gecko clones on a host task, `vm` can use a microtask                                                                                                                                 |
| `importValue(value)`                                                    | Host value → context value                                       | Binary must be rebuilt with the _realm's_ constructors (`Uint8Array`, `ArrayBuffer`, `DataView`), not JSON-round-tripped                                                                                                                                               |
| `exportValue(value)`                                                    | Context value → host, nothing copied                             | Functions stay callable; the result still belongs to the context, so use `cloneToHost` before keeping it                                                                                                                                                               |
| `cloneToHost(value)`                                                    | Context value → host, **data only**                              | Functions are not carried over; predicates are therefore read through `exportValue` and re-attached as host wrappers                                                                                                                                                   |

### Capabilities

```ts
interface RequiredHostCapabilities {
  // a conforming host implements all three
  parseHtml(html: string): HtmlRootLike | null;
  readFile(relPath: string, options?: ReadOptions): Promise<Uint8Array>;
  resolveMultilingualItems(item: ScriptItem): Promise<ScriptItem[]>;
}
```

- **`parseHtml`** is asked for whenever a style returns `content` carrying
  markup. Return a node-like root (`nodeType` 1 with `childNodes`); a `null` or
  non-element result is reported as a host error, not silently left as text.
- **`readFile`** serves the style's own directory (`readBytes` / `readText` /
  `readJSON`). Path rules are the host's: which directory that is, what a
  `relPath` may contain, whether symlinks are followed and whether a size limit
  applies.
- **`resolveMultilingualItems`** answers the multilingual relation query
  behind `getMultilingualItems()`. Items are re-read from the host's own source
  of truth, which is what makes a stale snapshot resolve to the surviving item.
- **Output is not a capability.** What a run reports comes back as data on the
  style instance, and a caller that wants the records as they happen passes a
  sink per style (`messageSink`); presentation stays outside the contract. See
  "What a run says" below.
- **Schema data is not a capability.** Zotero item types, creator types,
  base-field aliases and the CSL vocabulary are the core's own concern
  (`src/schema/*`), generated from the Zotero and CSL schemas; a host that
  supplied its own tables would make the same style behave differently.

`StyleHost.capabilities` may be assembled in stages: `createStyle` reads it
**through the host object on every use**, so a binding can hand over the runtime
first and attach capabilities before the first call. Nothing is preflighted;
a missing required capability is reported where it is used
(`requireCapability`, `code: "host-capability"`, naming the capability).
A host that prefers to fail while assembling calls `assertHostCapabilities()`
from `assertReady()`, which lists everything missing at once.

## What a run says

A style gets the familiar `console`, installed by the core so one call means the
same thing on every host:

| Console call                            | Severity  | Finding (read back) | Sink (optional)      |
| --------------------------------------- | --------- | ------------------- | -------------------- |
| `log`, `debug`, `trace`, `dir`, `table` | `trace`   | no                  | yes                  |
| `info`                                  | `info`    | yes                 | yes                  |
| `warn`                                  | `warning` | yes                 | yes                  |
| `error`, failed `assert`                | `error`   | yes                 | yes                  |
| `count`, `time`, `group`, `clear`, …    | –         | no                  | no (they do nothing) |

Two ways to consume the same records, with different guarantees:

- **Findings are data.** `style.diagnostics` holds what the style load reported
  plus what the latest generate run reported. Entries are deduplicated by
  severity/source/code/message/detail and capped at `MAX_DIAGNOSTICS`; when
  more arrive, one extra `warning` from `core` says further findings were
  suppressed. A new run replaces its own previous findings, so the array cannot
  grow run over run.
  The array identity is stable, so a caller may keep the reference, but it is
  also _live_: a run removes its predecessor's entries before its own arrive.
  Read it after `generate()` settles; a mid-run read may be incomplete.
- **The sink is a stream.** `createStyle(host, code, { messageSink })` receives
  every record as it happens, traces included. `trace` lines are budgeted per
  run (`MAX_TRACE_LINES_PER_RUN`, one notice when the budget is exhausted) and
  exist only here: they are never kept.
- **Nothing here is fatal.** A style that wants to report a problem uses
  `console.warn`/`error` and keeps going; a style that cannot continue `throw`s.
- **Codes** say what a record came from: `style-load` while the script is
  evaluated and validated, `generate` during a run. The same codes appear on
  failures, so a host can treat a style's own complaint and a style's own crash
  consistently.
- **`detail` is the machine-readable location.** `message` stays the line to
  show; `detail.style` names the style once `INFO` is readable, and
  `detail.declaration` names the export (`STYLE_OPTIONS`, `CITATION_PARAMS`,
  `CITE_PARAMS`, `ITEM_FIELD_PRESETS`, `ITEM_FIELD_VALIDATORS`) plus its
  `id`/`index`, and `field`/`fieldIndex` or `group` when narrower. A host that
  groups or navigates findings reads these keys instead of parsing `message`,
  and does not have to re-parse `INFO` out of the source.

## Declared parameters

A style may declare author inputs. Everything it exports is a top-level binding
(`const INFO`, `function generate`, `const STYLE_OPTIONS`, …); there is no
`style` object form. The core normalizes the declarations (dropping what it
cannot use, with a `warning` finding and a `source` naming the validator); the
host renders widgets and persists stored values:

| Export                  | Where the value lives              | Scope                                                       |
| ----------------------- | ---------------------------------- | ----------------------------------------------------------- |
| `STYLE_OPTIONS`         | `style.generate(contexts, values)` | Document-wide; effective values become the `options` global |
| `CITATION_PARAMS`       | `CitationContext.params`           | One citation                                                |
| `CITE_PARAMS`           | `Cite.params`                      | One cited item; the only scope that allows `list` rows      |
| `ITEM_FIELD_PRESETS`    | —                                  | Item context-menu shortcuts                                 |
| `ITEM_FIELD_VALIDATORS` | —                                  | Read-only field checks shown in the item menu               |

- **Kinds**: `state` (boolean or `states` enum; no validator), `value` (always a
  string; `format:"rich"` means restricted markup, so a style converts it with
  `htmlToUnit()` — the core does not parse it for the style), and `list` (cite
  scope only; `fields` are value parameters; `min`/`max` are editor bounds the
  core does not enforce). List rows are `Record<string, string>`. Parameter,
  field and `ITEM_FIELD_PRESETS` declarations are arrays; the object-map form
  is rejected, not silently unwrapped.
- **The core runs every parameter callback during resolution.** `applicable`
  hides a parameter when it returns `false`; `forcedValue` returns `T` to lock
  it or `null` to leave it free (a throw, `undefined`, or a wrong-kind value
  also leaves it free); `validate` runs only for a **free** value. A validator
  returns `true` when the value is usable, or `false`/a message when not; a
  throwing validator becomes invalid with the thrown message. Validation runs
  inside the style's sandbox, so it may call sandbox utilities such as
  `htmlToUnit()`; it is synchronous, like the other resolution callbacks, and
  cannot await `readFile` or the multilingual utilities.
- Hosts do not call `validate` themselves. They resolve the values they are
  about to show or commit and read the result from `states`:
  - `states[id].validation` is `{ valid, message? }` for a free `value` with a
    validator.
  - `states[id].fieldValidation[fieldId][rowIndex]` holds the same shape for
    each row of a free `list`. Its `source` is `provided` when the row supplied
    the field, or `default` when the core filled the field's declared default
    because the row omitted it. An invalid `default` cell belongs to the
    declaration, not to the user's input: show it as a hint, not as an error the
    user must clear.
  - Hidden and forced parameters have no validation; their `mode` already
    answers whether the input is editable.
  - List validation runs per row per resolution; the core does not currently
    cache results across resolutions. A caller that re-resolves large drafts on
    every keystroke should account for that cost when sizing its own update
    cycle.
- `resolveStyleOptionState()` / `resolveCitationParamValues()` /
  `resolveCiteParamValues()` default to running validators, with the
  **effective** scope values that `applicable` and `forcedValue` saw. A UI
  therefore re-resolves its draft on every edit, exactly as it already does for
  `mode`. `generate()` passes `{ validate: false }`: validation is editor
  feedback, not part of rendering.
- Resolution also returns `valueSources[id]`: `provided` (the caller's value was
  usable), `default` (nothing was stored for it), `invalid` (the caller's value
  was unusable; the core fell back to the declared default), or `repaired` (a
  list was usable only after the core dropped unusable rows or filled a field
  from its default). `invalid` and `repaired` are not silently equivalent to a
  stored choice — a host that persists values can warn, reset, or show exactly
  what was kept instead of saving the core's repair as the user's input.
- `style.generate(contexts, values?)` resolves all three scopes for every run.
  The sandbox reads effective values; `citation.source` keeps the original
  stored values.

## Failures

| Channel                                      | Content                                                                                                                                                                                                                                                                                              | Who presents it                                                  |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `StyleInstance.diagnostics`                  | The load's findings plus the latest run's: unusable presets, ignored keys, advisories, and the style's own `console.info/warn/error` (`{ severity, source, code, message, detail }`)                                                                                                                 | The host: log, show, assert, ignore                              |
| Thrown error with `code`                     | `style-load` (a script that does not evaluate), `style-contract` (missing/invalid exports), `host-capability` (missing or failing capability), `generate` (the style's own code threw), `generate-input` (shape of `contexts`), `generate-output` (unusable `generate()` result), `generate-timeout` | The host: which of these a user should see is a product decision |
| `StyleInstance.generate(contexts, options?)` | The normalized `{ citations, bibliography }`                                                                                                                                                                                                                                                         | The host                                                         |

`code` is deliberately mechanical: a host maps it to its own UI ("this is
an environment problem", "this is the style's fault") instead of guessing from
the message. Check it with `isRuntimeCode()` before branching — a host error may
carry its own `code` — and read `sourcePath` (a style-fragment location, or the
`generate()` field path) for detail. Errors keep their stack.

## Preparing style input

Styles read the shape in `src/types/item.d.ts` (`@banyan/core/types/item`) and
`src/types/style.d.ts` (contexts). The core does not know where items come from,
so the host converts them — and should use the core's helpers so every host
produces the same shape:

```ts
import {
  stripExcludedFields,
  assignBaseFieldAliases,
} from "@banyan/core/items/fields";
import { parseExtraMap } from "@banyan/core/items/extra";
import { bindCreatorsExt } from "@banyan/core/items/creatorsExt";

const item = zoteroItem.toJSON();
stripExcludedFields(item); // record metadata + long text
assignBaseFieldAliases(String(item.itemType), item); // bookTitle -> publicationTitle, ...
item.id = String(zoteroItem.id); // host-local handle, encoded once as a string
item["z:uri"] = Zotero.URI.getItemURI(zoteroItem); // host-private extension
delete item.key; // host record details, not style fields
delete item.uri;
delete item.relations;
item.extra = parseExtraMap(String(item.extra ?? "")); // "key: value" lines -> map
bindCreatorsExt(item); // creators-ext records onto creators
```

- `assignBaseFieldAliases` resolves against the core's own Zotero schema data, so
  type-specific fields land on their base names identically everywhere. Do not
  pass a field table — the core owns it.
- `id` is the host-local handle the core uses to identify a cite. It is always a
  **string**: a host whose storage uses numbers (Zotero) encodes them once, and
  a host whose handles are URIs, UUIDs or API slugs needs no lossy conversion.
  The core never parses it. Host-private
  identity fields are not part of the core contract: a host may add them under
  a namespaced key (Zotero uses `z:uri` for the item URI), and the core
  never reads them. `key`, `uri` and `relations` are host record details and
  must not be copied onto the style-facing item.
- The core's `isBanyanItem()` guard is what the multilingual utilities expect
  (`id` + `itemType`); a host that hands over something else gets a `TypeError`
  telling it so.
- `getItemDisplayLabel()` and friends exist for hosts that need the same
  user-facing label the citation dialog shows.

## Value crossing and scheduling

- Values that cross the boundary keep their identity, not their realm: use
  `exportValue` to _call_ a context function, `cloneToHost` to _keep_ data.
- `generate()` has one host-facing form and always returns a promise. A style's
  own `generate()` may be synchronous or return a promise; the core's bridge
  settles either through the host realm, so a host always awaits the same thing.
- A style instance holds one context, so **generations are serialized**: a second
  `generate()` call waits for the first to finish (or fail / time out) rather than
  overwriting the `contexts` global mid-run. Hosts may therefore share one style
  instance across call sites, but must not expect parallel execution.
- The core enforces its own async generate timeout (`createStyle(host, code,
{ generateTimeoutMs })`, 15 minutes by default). For a synchronous
  `while (true) {}` the core has no portable interrupt: a host whose `evaluate`
  supports `timeoutMs` opts in with `createStyle(..., { evaluateTimeoutMs })`,
  which the core passes to style load and to the synchronous part of `generate()`.
  Gecko ignores it, so untrusted styles still need process-level limits; the
  invalid numeric value of either option is a **host programming error** and is
  thrown as a `RangeError` by `createStyle`, not as a run failure with a `code`.
- **A timeout does not stop execution.** `generate-timeout` rejects the host
  promise and releases the queue, but the style's promise chain keeps running in
  the same context; a later `generate()` installs new `contexts` / `options`
  globals that the abandoned chain can still read. Serialization is about
  settlement, not execution. A host that needs strict isolation after a timeout
  should discard the style instance and create it again rather than reuse it.

## Watching one style

```ts
const style = await createStyle(host, code, {
  messageSink: (message) =>
    panel.push(`${message.severity}: ${message.message}`),
});
```

The sink is per style instance, so an editor preview or a test can watch one
style without touching the host. Sink failures are swallowed: logging must not
break the run it reports on. Where each severity ends up is the caller's call —
a debug console, a panel, a log file:

```ts
const messageSink = (message: StyleMessage) => {
  const line = `${message.source} (${message.code}): ${message.message}`;
  if (message.severity === "warning" || message.severity === "error") {
    myLogger.warn(line, message.detail);
  } else {
    myLogger.debug(line, message.detail);
  }
};
```

## A minimal host

```ts
import { createStyle } from "@banyan/core/sandbox/createStyle";

const style = await createStyle(
  {
    runtime: myRuntime, // SandboxRuntime
    capabilities: {
      parseHtml: (html) => myDocument.querySelector(html) /* ... */,
      readFile: async (relPath) => myFs.read(baseDir, relPath),
      resolveMultilingualItems: async (item) => mySource.relatedOf(item),
    },
    assertReady: () => {
      /* throw if a global or a capability is missing */
    },
  },
  styleSource,
);

const result = await style.generate(contexts); // { citations, bibliography }
for (const diagnostic of style.diagnostics) {
  // Findings of the load and of the latest run; trace lines never reach here.
  myUi.report(`[${diagnostic.source}] ${diagnostic.message}`);
}
```

Reference bindings to read next:

- `dev/node-host/` — the development-time Node host plus the contract tests that
  pin every behaviour described above (`pnpm test:contract`).
- A binding for another platform is a separate project; start from
  `dev/node-host/runtime.ts`, port each `SandboxContext` method, and keep the
  realm notes above next to the code.

## Checklist for a new host

1. Decide the isolation story before anything else; state its limits in your own
   docs, and do not run untrusted styles on a mechanism you only trust for
   correctness.
2. Implement `SandboxRuntime` and the ten `SandboxContext` methods, honouring the
   realm notes above (binary rebuilds, deferred callbacks, data-only clones).
3. Implement the three required capabilities. Do not approximate a missing one.
4. Convert your items with the core's helpers, or implement the same shape; keep
   `id` (a string the host owns and encodes once) and `itemType` so the
   multilingual utilities work.
5. Decide how `style.diagnostics`, the seven `code` values and (if you want live
   output) a per-style `messageSink` surface — the core will not decide for you.
6. Assert your own setup in `assertReady()` (with `assertHostCapabilities()` if
   you want the list) and run the contract tests you can reuse from
   `dev/node-host/coreContract.test.ts`.
