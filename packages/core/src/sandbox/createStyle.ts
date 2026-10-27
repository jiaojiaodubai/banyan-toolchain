/**
 * Load a user style script into a sandbox and expose it as a `Style`.
 *
 * The core generates everything the sandbox needs (helper ledger, utilities, the
 * style `console`, context view, the wrapper that extracts exports) and hands
 * the host's context back as one `StyleInstance`; the host supplies the context
 * and the capabilities only.
 */
import type {
  CitationContext,
  CitationParam,
  CiteParam,
  Style,
  StyleOptionParam,
  StyleOptionValues,
  StyleResult,
} from "../types/style";
import { resolveHost, type SandboxContext, type StyleHost } from "../host";
import type { StyleInstance } from "../messages";
import {
  createStyleMessageReporter,
  type StyleMessageReporter,
  type StyleMessageSink,
} from "../messages";
import {
  createGenerateOutputNormalizer,
  normalizeStyleCitationType,
} from "../output/normalizeGenerateResult";
import {
  installContextViewRuntime,
  installSandboxContexts,
  installSandboxOptions,
} from "./contextView";
import { installStyleConsole } from "./console";
import { installUtilities } from "./utilities";
import {
  normalizeCitationParams,
  normalizeCiteParams,
  normalizeStyleParams,
} from "../validation/params";
import { normalizeCitationContexts } from "../validation/contexts";
import { normalizeFieldPresets } from "../validation/fieldPresets";
import { normalizeItemFieldValidators } from "../validation/itemFieldValidators";
import {
  resolveCitationParamValues,
  resolveCiteParamValues,
  resolveStyleOptionState,
} from "../validation/paramValues";
import {
  createBanyanRuntimeError,
  errorMessageOf,
  GENERATE_TIMEOUT_MS,
  inheritSandboxErrorMetadata,
  toHostGenerateError,
  withGenerateTimeout,
  withRuntimeCode,
  type SandboxScriptError,
} from "./runtimeErrors";

export type CreateStyleOptions = {
  /**
   * Optional outlet for the records as they happen, traces included. Findings
   * are also readable afterwards through `style.diagnostics`.
   */
  messageSink?: StyleMessageSink;
  /**
   * Async budget for one `generate()` call, in milliseconds. The default is
   * `GENERATE_TIMEOUT_MS` (15 minutes); hosts and tests override it so a stuck
   * style cannot pin a document for that long.
   */
  generateTimeoutMs?: number;
  /**
   * Best-effort synchronous budget for evaluating the style script and invoking
   * its `generate()`, in milliseconds. It is passed to `SandboxContext.evaluate`
   * and each host applies it where its platform supports one (the Node host
   * does; Gecko ignores it). Omitted by default: a host that needs protection
   * from `while (true) {}` opts in.
   */
  evaluateTimeoutMs?: number;
};
let generateBridgeInvocationSequence = 0;

/** One bridged run: the host promise plus a way to release its sandbox slot. */
type GenerateRun = {
  promise: Promise<unknown>;
  /**
   * Drop the callback global and closures even if the style never settles, and
   * discard a result that arrives after the run was abandoned.
   */
  cancel: () => void;
};

/**
 * Names the sandbox must export. Defined once; wrapper and extraction
 * are both generated from this list — no manual string duplication.
 */
const STYLE_EXPORTS = [
  "INFO",
  "generate",
  "STYLE_OPTIONS",
  "CITATION_PARAMS",
  "CITE_PARAMS",
  "ITEM_FIELD_PRESETS",
  "ITEM_FIELD_VALIDATORS",
] as const;

export async function createStyle(
  host: StyleHost,
  code: string,
  options: CreateStyleOptions = {},
): Promise<StyleInstance> {
  // 0) Readiness gate: a binding that installs host globals asserts them here,
  //    so a setup mistake fails at the call site instead of mid-execution.
  host.assertReady?.();

  const resolved = resolveHost(host);
  // Findings come back as data (`style.diagnostics`); a caller that wants the
  // records as they happen passes a sink.
  const styleIdentity: { id?: string; title?: string } = {};
  const messages = createStyleMessageReporter(options.messageSink, () =>
    styleIdentity.id || styleIdentity.title
      ? { style: { ...styleIdentity } }
      : undefined,
  );
  // Output normalization carries the host's HTML parser. Capabilities are read
  // on use, so a binding may still fill them in after the style was created.
  const normalizeGenerateResult = createGenerateOutputNormalizer(
    () => resolved.capabilities.parseHtml,
  );

  // 1) Ask the host for a context and evaluate the user code there
  const context = resolved.runtime.createContext({
    name: "Banyan:StyleSandbox",
  });
  installUtilities(context, resolved);
  installStyleConsole(context, messages);
  installContextViewRuntime(context);
  const evaluateTimeoutMs = resolveEvaluateTimeout(options.evaluateTimeoutMs);
  const exports = evalAndExtract(code, context, evaluateTimeoutMs);

  // The contract check runs on the raw exports: `bridgeAndNormalize` always
  // supplies a generate wrapper, so checking the bridged object could never
  // catch a style that forgot to define one.
  assertStyleExports(exports);

  // 2) Bridge values across compartments and normalize
  const bridged = bridgeAndNormalize(
    exports,
    context,
    normalizeGenerateResult,
    messages,
    resolveGenerateTimeout(options.generateTimeoutMs),
    evaluateTimeoutMs,
    styleIdentity,
  );

  return { ...bridged, diagnostics: messages.diagnostics };
}

/**
 * Keep `timeoutMs` out of the object when no budget was requested: an
 * `exactOptionalPropertyTypes` host must not receive `{ timeoutMs: undefined }`.
 */
function evaluateOptions(
  filename: string,
  timeoutMs: number | undefined,
): { filename: string; timeoutMs?: number } {
  return timeoutMs === undefined ? { filename } : { filename, timeoutMs };
}

function exportGenerateFn(
  raw: unknown,
  context: SandboxContext,
  timeoutMs: number | undefined,
): unknown {
  if (typeof raw !== "function") {
    return raw;
  }

  try {
    context.defineGlobal("__banyan_generate_raw__", raw);
    context.evaluate(
      [
        "this.__banyan_generate_invoke__ = function (callbackName) {",
        "  const callbacks = globalThis[callbackName];",
        '  if (!callbacks || typeof callbacks.resolve !== "function" || typeof callbacks.reject !== "function") {',
        '    throw new Error("Banyan generate bridge callbacks are unavailable.");',
        "  }",
        "  const resolve = callbacks.resolve;",
        "  const reject = callbacks.reject;",
        "  const rejectWith = function (error) {",
        "    const message =",
        '      error && typeof error.message === "string" && error.message',
        "        ? error.message",
        "        : String(error);",
        "    const wrapped = new Error(message);",
        '    if (error && typeof error.name === "string" && error.name) wrapped.name = error.name;',
        '    if (error && typeof error.fileName === "string" && error.fileName) wrapped.fileName = error.fileName;',
        '    if (error && typeof error.lineNumber === "number") wrapped.lineNumber = error.lineNumber;',
        '    if (error && typeof error.columnNumber === "number") wrapped.columnNumber = error.columnNumber;',
        '    if (error && typeof error.stack === "string" && error.stack) wrapped.stack = error.stack;',
        '    if (error && typeof error.code === "string" && error.code) wrapped.code = error.code;',
        '    if (error && typeof error.sourcePath === "string" && error.sourcePath) wrapped.sourcePath = error.sourcePath;',
        "    wrapped.cause = error;",
        "    reject(wrapped);",
        "  };",
        "  try {",
        "    const rawOut = __banyan_generate_raw__();",
        "    Promise.resolve(rawOut).then(",
        "      resolve,",
        "      rejectWith,",
        "    );",
        "    return;",
        "  } catch (error) {",
        "    rejectWith(error);",
        "  }",
        "};",
      ].join("\n"),
      evaluateOptions("banyan-style-runtime.js", timeoutMs),
    );

    const runGenerateBridge = (
      resolveBridge: (value: unknown) => void,
      rejectBridge: (reason: unknown) => void,
    ): (() => void) => {
      generateBridgeInvocationSequence += 1;
      const callbackName = `__banyan_generate_callbacks_${generateBridgeInvocationSequence}`;
      const callbackContainer = context.createObject();
      let cleanedUp = false;
      let settled = false;
      // A timeout releases the queue but cannot stop the style's promise chain.
      // `aborted` makes the abandoned run drop its eventual result instead of
      // cloning it back into a host that has already moved on.
      let aborted = false;

      const cleanup = () => {
        if (cleanedUp) {
          return;
        }
        cleanedUp = true;
        context.deleteGlobal(callbackName);
      };

      const onResolve = (value: unknown) => {
        if (settled || aborted) {
          return;
        }
        settled = true;

        try {
          // MDN recommends not cloning Promise objects across realms. Keep
          // the Promise in the host realm, and only clone the resolved value
          // back on a host task.
          // https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Content_scripts/cloneInto
          context.deferHostTask(() => {
            try {
              resolveBridge(context.cloneToHost(value));
            } catch (error) {
              rejectBridge(toHostGenerateError(error));
            }
          });
        } catch (error) {
          rejectBridge(toHostGenerateError(error));
        } finally {
          cleanup();
        }
      };

      const onReject = (reason: unknown) => {
        if (settled || aborted) {
          return;
        }
        settled = true;

        try {
          context.deferHostTask(() => {
            try {
              rejectBridge(toHostGenerateError(reason));
            } catch (error) {
              rejectBridge(toHostGenerateError(error));
            }
          });
        } catch (error) {
          rejectBridge(toHostGenerateError(error));
        } finally {
          cleanup();
        }
      };

      try {
        context.defineFunction(callbackContainer, "resolve", onResolve);
        context.defineFunction(callbackContainer, "reject", onReject);
        context.defineGlobal(callbackName, callbackContainer);
        context.evaluate(
          `__banyan_generate_invoke__(${JSON.stringify(callbackName)});`,
          evaluateOptions("banyan-style-runtime.js", timeoutMs),
        );
      } catch (error) {
        settled = true;
        cleanup();
        rejectBridge(toHostGenerateError(error));
      }
      return () => {
        aborted = true;
        cleanup();
      };
    };

    return function banyanHostGenerate(): GenerateRun {
      let cancel = () => {};
      const promise = new Promise<unknown>((resolve, reject) => {
        cancel = runGenerateBridge(resolve, reject);
      });
      return { promise, cancel };
    };
  } catch (error) {
    throw toHostGenerateError(error);
  }
}

/** Optional synchronous budget; absent means "let the host decide". */
function resolveEvaluateTimeout(value: number | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(
      "createStyle option evaluateTimeoutMs must be a positive finite number when provided.",
    );
  }
  return value;
}

/** Fail on host misuse instead of silently clamping to the default budget. */
function resolveGenerateTimeout(value: number | undefined): number {
  if (value === undefined) {
    return GENERATE_TIMEOUT_MS;
  }
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(
      "createStyle option generateTimeoutMs must be a positive finite number.",
    );
  }
  return value;
}

/**
 * Evaluate user code in sandbox and programmatically extract exports.
 *
 * The wrapper string is minimal and mechanically generated from
 * STYLE_EXPORTS — no hand-written capture code in the eval'd string. The utility
 * table is installed non-writable and non-configurable, so a style cannot
 * replace it; such an attempt fails while the script is evaluated.
 */
function evalAndExtract(
  code: string,
  context: SandboxContext,
  timeoutMs: number | undefined,
): Record<string, unknown> {
  // Prepare the export container in the context
  context.defineGlobal("__banyan_exports__", context.createObject());

  // Build minimal wrapper: IIFE that runs user code, then copies the known
  // top-level export names into __banyan_exports__. Generated programmatically
  // from STYLE_EXPORTS; there is no second export shape to fall back to.
  const exportLines = STYLE_EXPORTS.map(
    (name) => `  if(typeof ${name}!=="undefined")__e.${name}=${name};`,
  ).join("\n");

  const wrapped =
    '"use strict";\n' +
    "(function(__e){\n" +
    code +
    "\n" +
    exportLines +
    "\n" +
    "})(__banyan_exports__);\n";

  try {
    context.evaluate(wrapped, evaluateOptions("banyan-style.js", timeoutMs));
  } catch (e) {
    const wrappedError = new Error(
      `Failed to evaluate style script: ${String(e)}`,
    ) as SandboxScriptError;
    wrappedError.code = "style-load";
    wrappedError.sourcePath = "banyan-style.js";
    wrappedError.cause = e;
    inheritSandboxErrorMetadata(wrappedError, e);
    throw wrappedError;
  }

  // Read exports from the container
  const raw = context.readGlobal("__banyan_exports__");
  const waived = context.exportValue(raw) as Record<string, unknown>;
  const exports: Record<string, unknown> = {};
  for (const name of STYLE_EXPORTS) {
    exports[name] = waived[name];
  }

  // Cleanup
  context.deleteGlobal("__banyan_exports__");

  return exports;
}

/**
 * Bridge values across compartments and build the host-side Style.
 *
 * The style script exports a single `generate()` function that returns
 * `{ citations, bibliography }`.  The host wrapper injects `contexts`
 * as a readonly global before calling it, then normalizes the output.
 */
function bridgeAndNormalize(
  exports: Record<string, unknown>,
  context: SandboxContext,
  normalizeGenerateResult: ReturnType<typeof createGenerateOutputNormalizer>,
  messages: StyleMessageReporter,
  generateTimeoutMs: number,
  evaluateTimeoutMs: number | undefined,
  styleIdentity: { id?: string; title?: string },
): Omit<StyleInstance, "diagnostics"> {
  // --- Clone INFO into host compartment ---
  let INFO = exports.INFO;
  if (INFO) {
    try {
      INFO = context.cloneToHost(INFO);
    } catch (error) {
      // Never hand a sandbox-realm object to the host: that is exactly what
      // `cloneToHost` is for. Loading then fails on the missing citationType
      // (style-contract), and the finding says why the metadata vanished.
      INFO = {};
      messages.report({
        severity: "warning",
        source: "core",
        message: `INFO could not be copied into the host realm: ${errorMessageOf(error)}`,
      });
    }
  }

  const infoRecord = (INFO ?? null) as Partial<
    Pick<Style["INFO"], "title" | "id" | "citationType">
  > | null;
  // Attribute every later finding to the style that produced it. The identity
  // is filled before the declaration validators run, so their warnings already
  // carry it; the host no longer has to parse INFO out of the source.
  const styleId =
    typeof infoRecord?.id === "string" ? infoRecord.id.trim() : "";
  const styleTitle =
    typeof infoRecord?.title === "string" ? infoRecord.title.trim() : "";
  if (styleId) styleIdentity.id = styleId;
  if (styleTitle) styleIdentity.title = styleTitle;
  const styleName = styleTitle || styleId || "unknown-style";

  // --- Export generate from sandbox to host ---
  const generateRaw = exportGenerateFn(
    exports.generate,
    context,
    evaluateTimeoutMs,
  );

  // --- Normalize the three parameter scopes ---
  const rawStyleOptions = exports.STYLE_OPTIONS as unknown;
  const rawCitationParams = exports.CITATION_PARAMS as unknown;
  const rawCiteParams = exports.CITE_PARAMS as unknown;
  const styleOptions: StyleOptionParam[] | undefined = rawStyleOptions
    ? normalizeStyleParams(rawStyleOptions, context, messages)
    : undefined;
  const citationParams: CitationParam[] | undefined = rawCitationParams
    ? normalizeCitationParams(rawCitationParams, context, messages)
    : undefined;
  const citeParams: CiteParam[] | undefined = rawCiteParams
    ? normalizeCiteParams(rawCiteParams, context, messages)
    : undefined;

  // --- Normalize ITEM_FIELD_PRESETS ---
  const itemFieldPresets = normalizeFieldPresets(
    exports.ITEM_FIELD_PRESETS as unknown,
    context,
    messages,
  );

  // --- Normalize ITEM_FIELD_VALIDATORS ---
  const itemFieldValidators = normalizeItemFieldValidators(
    exports.ITEM_FIELD_VALIDATORS as unknown,
    context,
    messages,
  );

  const citationType = normalizeStyleCitationType(
    infoRecord?.citationType,
    styleName,
  );

  // --- Host-side generate wrapper ---
  //
  // A style owns exactly one sandbox context, and every generation writes the
  // shared `contexts` global and runs inside the shared diagnostic budget. Two
  // overlapping calls would therefore have one run read the other's inputs, so
  // generations are serialized per style instance: a call waits for the
  // previous one to settle instead of overwriting its inputs. Callers may still
  // call `generate()` concurrently — they just run one after another.
  let generationQueue: Promise<void> = Promise.resolve();

  function exclusive<T>(run: () => Promise<T>): Promise<T> {
    const result = generationQueue.then(run, run);
    generationQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  function normalizeOutFor(contexts: CitationContext[]) {
    return (out: unknown): StyleResult =>
      normalizeGenerateResult(
        out,
        contexts,
        styleName,
        citationType,
      ) as StyleResult;
  }

  /**
   * The one entry point. A style's `generate()` may be synchronous or return a
   * promise; the bridge keeps the promise in the host realm and settles it on a
   * host task, so the host always awaits the same thing.
   *
   * `options` is the host's stored value set. Every run resolves style,
   * citation and cite parameters first; the style only reads effective values.
   * The output's `source` is built from the original contexts, so resolving a
   * default or forced value never writes it back to the document.
   */
  const generate = (
    contexts: CitationContext[],
    options: StyleOptionValues = {},
  ): Promise<StyleResult> =>
    exclusive(async () => {
      // Parameter callbacks run in the sandbox and may report findings; open the
      // run before resolving them so those findings belong to this run instead
      // of being filed as permanent load-time diagnostics.
      const restoreRun = messages.beginRun("generate");
      try {
        const normalizedContexts = normalizeCitationContexts(contexts);
        // Validation is editor feedback, not part of rendering; a run resolves
        // applicability and forced values but does not call validators.
        const resolveOptions = { validate: false };
        const styleState = resolveStyleOptionState(
          styleOptions,
          options,
          resolveOptions,
        );
        const effectiveContexts = normalizedContexts.map((citation) => {
          const resolvedCitation = resolveCitationParamValues(
            citationParams,
            citation,
            styleState.effectiveValues,
            resolveOptions,
          );
          const effectiveCitation = resolvedCitation.citation;
          effectiveCitation.cites = effectiveCitation.cites.map(
            (cite) =>
              resolveCiteParamValues(
                citeParams,
                cite,
                effectiveCitation,
                styleState.effectiveValues,
                resolveOptions,
              ).cite,
          );
          return effectiveCitation;
        });

        // Inject contexts and options as readonly globals with safe fallback.
        installSandboxContexts(effectiveContexts, context);
        installSandboxOptions(styleState.effectiveValues, context);

        const normalizeOut = normalizeOutFor(normalizedContexts);
        const run = (generateRaw as () => GenerateRun)();
        try {
          const out = await withGenerateTimeout(
            run.promise,
            styleName,
            generateTimeoutMs,
          ).catch((error: unknown) => {
            throw withRuntimeCode(error, "generate");
          });
          return normalizeOut(out);
        } finally {
          // Also runs on timeout: a stuck style must not keep the callback
          // global (and its host closures) alive for the context's lifetime.
          run.cancel();
        }
      } finally {
        restoreRun();
      }
    });

  const bridged = { INFO, generate } as Omit<StyleInstance, "diagnostics">;
  if (styleOptions) bridged.STYLE_OPTIONS = styleOptions;
  if (citationParams) bridged.CITATION_PARAMS = citationParams;
  if (citeParams) bridged.CITE_PARAMS = citeParams;
  if (itemFieldPresets) bridged.ITEM_FIELD_PRESETS = itemFieldPresets;
  if (itemFieldValidators) {
    bridged.ITEM_FIELD_VALIDATORS = itemFieldValidators;
  }
  return bridged;
}

/** Raw-export contract check, before the bridge supplies its own wrapper. */
function assertStyleExports(exports: Record<string, unknown>): void {
  if (!exports.INFO || typeof exports.INFO !== "object") {
    throw createBanyanRuntimeError("Style script must define INFO object.", {
      code: "style-contract",
      sourcePath: "INFO",
    });
  }
  if (typeof exports.generate !== "function") {
    throw createBanyanRuntimeError(
      "Style script must define a top-level function generate().",
      {
        code: "style-contract",
        sourcePath: "generate",
      },
    );
  }
}
