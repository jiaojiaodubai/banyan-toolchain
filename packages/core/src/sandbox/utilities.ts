// Runtime utilities exposed to user style scripts.
//
// The table lives in the core and is host-agnostic: each entry generates the
// source that the sandbox evaluates, plus (when it needs host abilities) a
// handler built from `StyleHostCapabilities`. Realm mechanics stay with the
// host and reach the core only through `SandboxContext`.
import type { ScriptItem } from "../types/style";
import type { StyleUtils } from "../types/styleUtils";
import type {
  AffixUnit,
  FallbackUnit,
  GroupUnit,
  LinkUnit,
  PrintableValue,
  RenderStyle,
  WithStyleUnit,
  TextCaseForm,
  TextCaseUnit,
  TextUnit,
  Unit,
  WhenUnit,
} from "../types/unit";
import type { ResolvedHost, SandboxContext } from "../host";
import { requireCapability } from "../host";
import { isBanyanItem } from "../items/fields";
import {
  findLanguageMatch,
  normalizeStyleLanguageTag,
  type StyleLanguageCandidate,
} from "../items/language";
import { sanitizeLink } from "../richText/html";
import { plainTextOfUnit } from "../units/compile";
import { normalizeTextValue } from "../units/unit";
import { toHostUnit } from "../units/normalize";
import { splitTextUnitByMarkup } from "../output/markup";
import { unitFromHtml, unitToHtml as unitToMarkup } from "../units/htmlUnit";
import { errorMessageOf } from "./runtimeErrors";
import {
  buildTranspileHelperSource,
  serializeRuntimeFunction,
} from "./transpileHelpers";

type IsAsync<T> = T extends (...args: never[]) => Promise<unknown>
  ? true
  : false;
type IsSync<T> = T extends (...args: never[]) => Promise<unknown>
  ? false
  : true;
/**
 * Utilities whose contract is "return a result object, never throw", so they
 * need the instance's declarations and run state. They are installed by
 * `installDependencyUtilities()` instead of the serialized table below.
 */
export type DependencyUtilityName = "callStyle" | "loadResource";
type TableStyleUtils = Omit<StyleUtils, DependencyUtilityName>;
type AsyncKeys<T> = {
  [K in keyof T]: IsAsync<T[K]> extends true ? K : never;
}[keyof T];
type SyncKeys<T> = {
  [K in keyof T]: IsSync<T[K]> extends true ? K : never;
}[keyof T];
type AsyncStyleUtils = Pick<TableStyleUtils, AsyncKeys<TableStyleUtils>>;
type SyncStyleUtils = Pick<TableStyleUtils, SyncKeys<TableStyleUtils>>;
export type SandboxGlobal = Record<string, unknown>;
type UnknownArgsFunction = (...args: unknown[]) => unknown;
type UnknownArgsVoidFunction = (...args: unknown[]) => void;
type UnknownPromiseFunction = (...args: unknown[]) => Promise<unknown>;
type RuntimeSerializableFunction = (...args: never[]) => unknown;
type LanguagePreference = string | readonly string[];

type UtilityDefinitionMap = {
  [K in keyof TableStyleUtils]: K extends AsyncKeys<TableStyleUtils>
    ? HostAsyncUtilityEntry
    : K extends SyncKeys<TableStyleUtils>
      ? LocalUtilityEntry | HostSyncUtilityEntry
      : never;
};

type UtilityFactoryMap = {
  [K in keyof TableStyleUtils]: K extends AsyncKeys<TableStyleUtils>
    ? HostAsyncUtilityFactoryEntry<K>
    : K extends SyncKeys<TableStyleUtils>
      ? LocalUtilityFactoryEntry<K> | HostSyncUtilityFactoryEntry<K>
      : never;
};

type LocalUtilityEntry = {
  runtimeSource: string;
  buildHostHandler?: undefined;
};

type HostSyncUtilityEntry = {
  runtimeSource: string;
  buildHostHandler: (
    context: SandboxContext,
    host: ResolvedHost,
  ) => UnknownArgsFunction;
};

type HostAsyncUtilityEntry = {
  runtimeSource: string;
  buildHostHandler: (
    context: SandboxContext,
    host: ResolvedHost,
  ) => UnknownArgsVoidFunction;
};

type LocalUtilityFactoryEntry<K extends keyof StyleUtils> = {
  buildRuntimeSource: (name: K) => string;
  buildHostHandler?: undefined;
  requires?: undefined;
};

type HostSyncUtilityFactoryEntry<K extends keyof StyleUtils> = {
  buildRuntimeSource: (name: K) => string;
  buildHostHandler: (
    name: K,
    context: SandboxContext,
    host: ResolvedHost,
  ) => UnknownArgsFunction;
  requires?: UtilityCapability;
};

type HostAsyncUtilityFactoryEntry<K extends keyof StyleUtils> = {
  buildRuntimeSource: (name: K) => string;
  buildHostHandler: (
    name: K,
    context: SandboxContext,
    host: ResolvedHost,
  ) => UnknownArgsVoidFunction;
  /**
   * Capability the utility needs. The entry declares it so the bridge can
   * report a missing capability by itself (see `guardMissingCapability`);
   * utilities that declare nothing work on any host.
   */
  requires?: UtilityCapability;
};

function capabilityUnavailableMessage(
  capability: UtilityCapability,
  utilityName: string,
): string {
  return `The host does not provide the "${capability}" capability; ${utilityName} is unavailable.`;
}

/**
 * Report a missing capability before the handler runs.
 *
 * A utility that quietly works around an absent capability would make the same
 * style render differently per host, so the requirement is declared next to the
 * utility and enforced here — no handler has to remember to check, and none can
 * substitute a different result.
 */
function guardMissingCapability(
  handler: UnknownArgsFunction,
  host: ResolvedHost,
  capability: UtilityCapability,
  utilityName: string,
): UnknownArgsFunction {
  return (...args: unknown[]) => {
    requireCapability(
      host.capabilities[capability],
      capabilityUnavailableMessage(capability, utilityName),
    );
    return handler(...args);
  };
}

/** Host capability a utility cannot work without. */
type UtilityCapability = "parseHtml" | "resolveMultilingualItems";

/**
 * The two dependency utilities, as host-side async functions.
 *
 * They are installed separately from the serialized utility table because their
 * contract differs: a missing capability or an unusable dependency must produce
 * a returned failure result, never a thrown error. Only `createStyle()` has the
 * run state they need (declarations, chain, budget), so it supplies them.
 */
export interface DependencyUtilityServices {
  callStyle(
    id: unknown,
    contexts: unknown,
    optionValues: unknown,
  ): Promise<unknown>;
  loadResource(id: unknown): Promise<unknown>;
}

export const DEPENDENCY_UTILITY_NAMES = ["callStyle", "loadResource"] as const;

function buildDependencyUtilitiesSource(): string {
  // Kept as source text for the same reason as the main table: it must run in
  // the sandbox realm. `resourceCache` lives in that realm and holds the pending
  // promise too, so a resource — even one whose read is still in flight — is
  // handed back as the *same* frozen object, not a per-call copy.
  return [
    "(function (__host) {",
    '  "use strict";',
    "  function deepFreeze(value) {",
    '    if (!value || typeof value !== "object" || Object.isFrozen(value)) {',
    "      return value;",
    "    }",
    "    Object.freeze(value);",
    "    var keys = Object.keys(value);",
    "    for (var index = 0; index < keys.length; index += 1) {",
    "      deepFreeze(value[keys[index]]);",
    "    }",
    "    return value;",
    "  }",
    "  function rejectWith(reject, name, reason) {",
    '    var error = new Error(typeof reason === "string" ? reason : String(reason));',
    '    error.code = "host-capability";',
    "    error.sourcePath = name;",
    "    reject(error);",
    "  }",
    "  var resourceCache = Object.create(null);",
    "  var callStyle = function (id, contexts, optionValues) {",
    "    return new Promise(function (resolve, reject) {",
    "      __host.callStyle(id, contexts, optionValues, resolve, function (reason) {",
    '        rejectWith(reject, "callStyle", reason);',
    "      });",
    "    });",
    "  };",
    "  var loadResource = function (id) {",
    "    var key = String(id);",
    "    var cached = resourceCache[key];",
    "    if (cached) {",
    "      return cached;",
    "    }",
    "    var promise = new Promise(function (resolve, reject) {",
    "      __host.loadResource(id, function (value) {",
    "        if (value && value.ok === true) {",
    "          deepFreeze(value.data);",
    "        } else {",
    "          // A failure stays retryable, so it must not be memoized.",
    "          delete resourceCache[key];",
    "        }",
    "        resolve(value);",
    "      }, function (reason) {",
    "        delete resourceCache[key];",
    '        rejectWith(reject, "loadResource", reason);',
    "      });",
    "    });",
    "    resourceCache[key] = promise;",
    "    return promise;",
    "  };",
    "  Object.defineProperties(globalThis, {",
    "    callStyle: { value: callStyle, writable: false, configurable: false, enumerable: true },",
    "    loadResource: { value: loadResource, writable: false, configurable: false, enumerable: true },",
    "  });",
    "})(__banyanDependencyUtils__);",
  ].join("\n");
}

/**
 * Install `callStyle()` and `loadResource()` in a context.
 *
 * Called by `createStyle()` once the declarations are normalized, because the
 * services need the run state the style's own exports describe.
 */
export function installDependencyUtilities(
  context: SandboxContext,
  services: DependencyUtilityServices,
): void {
  const bridge = context.createObject();
  for (const name of DEPENDENCY_UTILITY_NAMES) {
    context.defineFunction(bridge, name, (...args: unknown[]) => {
      const resolve = args[args.length - 2];
      const reject = args[args.length - 1];
      if (typeof resolve !== "function" || typeof reject !== "function") {
        throw new TypeError(
          `Host bridge '${name}' expects resolve/reject callbacks.`,
        );
      }
      // A dependency argument graph is sandbox-owned (a `contexts` view or a
      // plain object literal), so it is cloned into the host realm first, like
      // the capability utilities do.
      const params = args
        .slice(0, -2)
        .map((argument) => context.cloneToHost(argument));
      settleBridgePromise(
        (services[name] as (...args: unknown[]) => Promise<unknown>)(...params),
        context,
        resolve as (value: unknown) => void,
        reject as (reason: unknown) => void,
      );
    });
  }

  context.defineGlobal("__banyanDependencyUtils__", bridge);
  try {
    context.evaluate(buildDependencyUtilitiesSource(), {
      filename: "banyan-dependency-utils.js",
    });
  } finally {
    context.deleteGlobal("__banyanDependencyUtils__");
  }
}

function runtimeSafeString(value: unknown): string {
  switch (typeof value) {
    case "string":
      return value;
    case "number":
    case "boolean":
      return String(value);
    default:
      return "";
  }
}

function hostUuid(): string {
  return crypto.randomUUID();
}

export function runtimeSafeRecord(
  object: Record<string, unknown>,
): Record<string, string> {
  const target = object && typeof object === "object" ? object : {};
  return new Proxy(target, {
    set() {
      // The docs promise that writes are ignored, and style code is strict
      // mode: returning false would throw instead of ignoring the write.
      return true;
    },
    defineProperty() {
      return true;
    },
    deleteProperty() {
      // Same promise as `set`: deleting a key from the readonly view is a
      // write, and strict mode would throw if the trap returned false.
      return true;
    },
    setPrototypeOf() {
      return false;
    },
    preventExtensions() {
      return false;
    },
    get(currentTarget, prop) {
      if (typeof prop !== "string") {
        return "";
      }
      try {
        return runtimeSafeString(
          (currentTarget as Record<string, unknown>)[prop],
        );
      } catch {
        return "";
      }
    },
  }) as Record<string, string>;
}

function runtimeGetExtraValue(
  item: { extra?: Record<string, unknown> } | null | undefined,
  key: string,
): string;
function runtimeGetExtraValue(
  item: { extra?: Record<string, unknown> } | null | undefined,
  key: string,
  mode: "string",
): string;
function runtimeGetExtraValue(
  item: { extra?: Record<string, unknown> } | null | undefined,
  key: string,
  mode: "array",
): string[];
function runtimeGetExtraValue(
  item: { extra?: Record<string, unknown> } | null | undefined,
  key: string,
  mode?: "string" | "array",
): string | string[] {
  const source =
    item && typeof item === "object"
      ? (item as Record<string, unknown>).extra
      : undefined;
  const extra =
    source && typeof source === "object"
      ? (source as Record<string, unknown>)
      : {};
  const value = extra[runtimeSafeString(key)];

  if (mode === "array") {
    // The `"array"` mode exposes repeated `extra` keys: a community convention
    // Banyan reads but never writes.
    if (value === undefined) {
      return [];
    }
    return Array.isArray(value)
      ? value.map(runtimeSafeString)
      : [runtimeSafeString(value)];
  }
  if (Array.isArray(value)) {
    return runtimeSafeString(value[0]);
  }
  return runtimeSafeString(value);
}

export function runtimeFormatDate<T>(
  value: string | number,
  callback: (parts: { year: string; month: string; day: string }) => T,
): T | string {
  if (typeof value === "number") {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return callback({
      year: String(date.getUTCFullYear()),
      month: String(date.getUTCMonth() + 1).padStart(2, "0"),
      day: String(date.getUTCDate()).padStart(2, "0"),
    });
  }

  const source = value.trim();
  if (!source) return value;

  type DateParts = { year: string; month: string; day: string };
  const monthNames: Record<string, number> = {
    jan: 1,
    january: 1,
    feb: 2,
    february: 2,
    mar: 3,
    march: 3,
    apr: 4,
    april: 4,
    may: 5,
    jun: 6,
    june: 6,
    jul: 7,
    july: 7,
    aug: 8,
    august: 8,
    sep: 9,
    sept: 9,
    september: 9,
    oct: 10,
    october: 10,
    nov: 11,
    november: 11,
    dec: 12,
    december: 12,
  };
  const createParts = (
    year: string,
    month = "",
    day = "",
  ): DateParts | undefined => {
    const yearNumber = Number(year);
    const monthNumber = month ? Number(month) : 0;
    const dayNumber = day ? Number(day) : 0;
    if (!/^\d{1,4}$/.test(year) || yearNumber < 1) return undefined;
    if (month && (monthNumber < 1 || monthNumber > 12)) return undefined;
    if (day) {
      const date = new Date(Date.UTC(yearNumber, monthNumber - 1, dayNumber));
      if (
        dayNumber < 1 ||
        dayNumber > 31 ||
        date.getUTCFullYear() !== yearNumber ||
        date.getUTCMonth() !== monthNumber - 1 ||
        date.getUTCDate() !== dayNumber
      ) {
        return undefined;
      }
    }
    return {
      year: year.padStart(4, "0"),
      month: month ? String(monthNumber).padStart(2, "0") : "",
      day: day ? String(dayNumber).padStart(2, "0") : "",
    };
  };
  const numeric = /^(\d{4})[-/.]?(\d{2})[-/.]?(\d{2})$/.exec(source);
  const yearOnly = /^(\d{1,4})$/.exec(source);
  const yearMonth = /^(\d{1,4})[-/.](\d{1,2})(?:$|[T\s])/.exec(source);
  const ymd = /^(\d{1,4})[-/.](\d{1,2})[-/.](\d{1,2})(?:$|[T\s])/.exec(source);
  const slashDate = /^(\d{1,2})[/-](\d{1,2})[/-](\d{1,4})(?:$|\s)/.exec(source);
  const named =
    /^(?:(\d{1,2})\s+)?([A-Za-z]+)(?:\s+(\d{1,2}))?,?\s+(\d{1,4})$/.exec(
      source,
    );
  const yearNamed = /^(\d{1,4})\s+([A-Za-z]+)(?:\s+(\d{1,2}))?$/.exec(source);
  const chinese = /^(\d{1,4})年(?:\s*(\d{1,2})月)?(?:\s*(\d{1,2})日)?$/.exec(
    source,
  );
  let parts: DateParts | undefined;

  if (numeric) {
    parts = createParts(numeric[1] ?? "", numeric[2] ?? "", numeric[3] ?? "");
  } else if (yearOnly) {
    parts = createParts(yearOnly[1] ?? "");
  } else if (ymd) {
    parts = createParts(ymd[1] ?? "", ymd[2] ?? "", ymd[3] ?? "");
  } else if (yearMonth) {
    parts = createParts(yearMonth[1] ?? "", yearMonth[2] ?? "");
  } else if (slashDate) {
    const first = Number(slashDate[1] ?? 0);
    const second = Number(slashDate[2] ?? 0);
    const month = first > 12 ? second : first;
    const day = first > 12 ? first : second;
    parts = createParts(slashDate[3] ?? "", String(month), String(day));
  } else if (named || yearNamed) {
    const monthName = (named ? named[2] : yearNamed?.[2])?.toLowerCase();
    const month = monthNames[monthName ?? ""];
    const year = (named ? named[4] : yearNamed?.[1]) ?? "";
    const day = (named ? named[1] || named[3] : yearNamed?.[3]) ?? "";
    if (month && year) parts = createParts(year, String(month), day);
  } else if (chinese) {
    parts = createParts(chinese[1] ?? "", chinese[2] ?? "", chinese[3] ?? "");
  }

  return parts ? callback(parts) : value;
}

function hostText(value: PrintableValue, style?: RenderStyle): TextUnit {
  return {
    value: normalizeTextValue(value),
    ...(style || {}),
  };
}

/**
 * `plainText()` is the *visible* text of a unit, so it parses the same markup
 * the output normalizer does: without that, `<i>`/`nocase` markup and HTML
 * entities would leak into comparisons and string logic. Text without markup
 * still needs no parser (entities are decoded by the splitter itself), so a
 * host that has not supplied `parseHtml` only fails when markup is present.
 */
function hostPlainText(
  input: Unit | readonly Unit[],
  capabilities: ResolvedHost["capabilities"],
): string {
  const units: readonly Unit[] = Array.isArray(input) ? input : [input];
  const splitText = (base: TextUnit) =>
    splitTextUnitByMarkup(base, (html) =>
      requireCapability(
        capabilities.parseHtml,
        'The host does not provide the "parseHtml" capability; plainText cannot read markup.',
      )(html),
    );
  return units.map((unit) => plainTextOfUnit(unit, { splitText })).join("");
}

function hostGroup(units: Unit[], delimiter?: Unit): GroupUnit {
  const normalized = toHostUnit(delimiter);
  return {
    type: "group",
    units: Array.isArray(units) ? units : [],
    ...(normalized === undefined ? {} : { delimiter: normalized }),
  };
}

function hostAffix(unit: Unit, prefix?: Unit, suffix?: Unit): AffixUnit;
function hostAffix(input: Unit, prefix?: Unit, suffix?: Unit): AffixUnit {
  const resolvedPrefix = toHostUnit(prefix);
  const resolvedSuffix = toHostUnit(suffix);
  return {
    type: "affix",
    unit: input,
    ...(resolvedPrefix === undefined ? {} : { prefix: resolvedPrefix }),
    ...(resolvedSuffix === undefined ? {} : { suffix: resolvedSuffix }),
  };
}

function hostFallback(units: Unit[]): FallbackUnit {
  return { type: "fall", units };
}

function hostChoose(
  condition: boolean,
  trueUnit: Unit,
  elseUnit?: Unit,
): WhenUnit {
  return {
    type: "when",
    condition,
    trueUnit,
    ...(elseUnit === undefined ? {} : { elseUnit }),
  };
}

function hostTextCase(
  unit: Unit,
  form: TextCaseForm,
  ignoreWords?: string[],
): TextCaseUnit;
function hostTextCase(
  input: Unit,
  form: TextCaseForm,
  ignoreWords?: string[],
): TextCaseUnit {
  return {
    type: "text-case",
    unit: input,
    form,
    ...(ignoreWords === undefined ? {} : { ignoreWords }),
  };
}

function hostWithStyle(input: Unit, style: RenderStyle): WithStyleUnit {
  return {
    type: "style",
    unit: input,
    style,
  };
}

function hostLink(input: Unit, link: string): LinkUnit {
  return {
    type: "link",
    unit: input,
    link: sanitizeLink(link) ?? "",
  };
}

function normalizeLanguagePreferences(language: LanguagePreference): string[] {
  const inputs = Array.isArray(language) ? language : [language];
  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const input of inputs) {
    // Styles may pass tags the dialog's strict validation refuses (script and
    // variant subtags, macro-regions), so only empty values are dropped here.
    const value = normalizeStyleLanguageTag(input);
    if (!value || seen.has(value)) {
      continue;
    }
    seen.add(value);
    normalized.push(value);
  }

  return normalized;
}

function serializeHostSyncRuntimeFunction(
  exportedName: keyof StyleUtils,
): string {
  return `const ${exportedName} = function (...args) { return __host.${exportedName}(...args); };`;
}

function serializeReadonlyHostAsyncRuntimeFunction(
  exportedName: keyof StyleUtils,
): string {
  return `const ${exportedName} = function (...args) { return new Promise((resolve, reject) => { __host.${exportedName}(...args, (value) => { resolve(typeof __banyanWrapContextView__ === "function" ? __banyanWrapContextView__(value) : value); }, (reason) => { const error = new Error(typeof reason === "string" ? reason : String(reason)); error.code = "host-capability"; error.sourcePath = ${JSON.stringify(exportedName)}; reject(error); }); }); };`;
}

function defineLocalUtility<K extends keyof SyncStyleUtils>(
  runtime: SyncStyleUtils[K],
): LocalUtilityFactoryEntry<K> {
  return {
    buildRuntimeSource: (name) =>
      serializeRuntimeFunction(name, runtime as RuntimeSerializableFunction),
  };
}

function defineCloningHostSyncUtility<K extends keyof SyncStyleUtils>(
  host: SyncStyleUtils[K],
): HostSyncUtilityFactoryEntry<K> {
  return {
    buildRuntimeSource: (name) => serializeHostSyncRuntimeFunction(name),
    buildHostHandler:
      (_name, context, _host) =>
      (...args: unknown[]) =>
        cloneHostUtilityResult((host as UnknownArgsFunction)(...args), context),
  };
}

/**
 * A sync utility that reads host state without declaring a capability.
 *
 * The capability is optional at the call boundary: the utility itself decides
 * whether a missing one matters (plainText only needs `parseHtml` for markup).
 */
function defineHostSyncUtility<K extends keyof SyncStyleUtils>(
  build: (host: ResolvedHost) => (...args: never[]) => unknown,
): HostSyncUtilityFactoryEntry<K> {
  return {
    buildRuntimeSource: (name) => serializeHostSyncRuntimeFunction(name),
    buildHostHandler: (name, context, host) =>
      createSyncHostBridgeHandler(
        name,
        build(host) as SyncStyleUtils[K],
        context,
      ),
  };
}

function cloneHostUtilityResult<T>(value: T, context: SandboxContext): T {
  if (!value || typeof value !== "object") {
    return value;
  }
  return context.importValue(value);
}

function defineCapabilitySyncUtility<K extends keyof SyncStyleUtils>(
  requires: UtilityCapability,
  build: (host: ResolvedHost) => (...args: never[]) => unknown,
): HostSyncUtilityFactoryEntry<K> {
  return {
    requires,
    buildRuntimeSource: (name) => serializeHostSyncRuntimeFunction(name),
    buildHostHandler: (name, context, host) =>
      createSyncHostBridgeHandler(
        name,
        build(host) as SyncStyleUtils[K],
        context,
      ),
  };
}

function createSyncHostBridgeHandler<K extends keyof SyncStyleUtils>(
  _name: K,
  handler: SyncStyleUtils[K],
  context: SandboxContext,
): UnknownArgsFunction {
  return (...args: unknown[]) =>
    cloneHostUtilityResult(
      (handler as unknown as UnknownArgsFunction)(...args),
      context,
    );
}

function defineReadonlyCapabilityAsyncUtility<K extends keyof AsyncStyleUtils>(
  requires: UtilityCapability,
  build: (host: ResolvedHost) => (...args: never[]) => Promise<unknown>,
): HostAsyncUtilityFactoryEntry<K> {
  return {
    requires,
    buildRuntimeSource: (name) =>
      serializeReadonlyHostAsyncRuntimeFunction(name),
    buildHostHandler: (name, context, host) =>
      createAsyncHostBridgeHandler(
        name,
        build(host) as AsyncStyleUtils[K],
        context,
      ),
  };
}

function materializeUtilityDefinitions(
  definitions: UtilityFactoryMap,
): UtilityDefinitionMap {
  const materialized: Record<
    string,
    LocalUtilityEntry | HostSyncUtilityEntry | HostAsyncUtilityEntry
  > = {};

  for (const name of Object.keys(definitions) as Array<keyof TableStyleUtils>) {
    const definition = definitions[name] as {
      buildRuntimeSource: (name: keyof TableStyleUtils) => string;
      buildHostHandler?: (
        name: keyof TableStyleUtils,
        context: SandboxContext,
        host: ResolvedHost,
      ) => UnknownArgsFunction;
      requires?: UtilityCapability;
    };

    const runtimeSource = definition.buildRuntimeSource(name);
    const buildHostHandlerFactory = definition.buildHostHandler;

    if (!buildHostHandlerFactory) {
      materialized[name] = { runtimeSource };
      continue;
    }

    const requires = definition.requires;

    materialized[name] = {
      runtimeSource,
      buildHostHandler: (context: SandboxContext, host: ResolvedHost) => {
        const handler = buildHostHandlerFactory(name, context, host);
        return requires
          ? guardMissingCapability(handler, host, requires, name)
          : handler;
      },
    };
  }

  return materialized as UtilityDefinitionMap;
}

const UTILITY_DEFINITION_FACTORIES = {
  getMultilingualItems: defineReadonlyCapabilityAsyncUtility(
    "resolveMultilingualItems",
    (host) => (item: ScriptItem) => readMultilingualItemsForStyle(item, host),
  ),
  getMultilingualItem: defineReadonlyCapabilityAsyncUtility(
    "resolveMultilingualItems",
    (host) => (item: ScriptItem, language: LanguagePreference) =>
      readMultilingualItemForStyle(item, language, host),
  ),
  text: defineCloningHostSyncUtility(hostText),
  plainText: defineHostSyncUtility((host) => {
    return (input: Unit | readonly Unit[]) =>
      hostPlainText(input, host.capabilities);
  }),
  textCase: defineCloningHostSyncUtility(hostTextCase),
  uuid: defineCloningHostSyncUtility(hostUuid),
  getExtraValue: defineLocalUtility(runtimeGetExtraValue),
  formatDate: defineLocalUtility(runtimeFormatDate),
  htmlToUnit: defineCapabilitySyncUtility("parseHtml", (host) => {
    // The capability guard around the handler reports a missing `parseHtml`
    // at call time; resolving it here must not throw while the table is built.
    return (html: string) => {
      const parseHtml = host.capabilities.parseHtml;
      if (!parseHtml) {
        throw new Error('htmlToUnit requires the "parseHtml" capability.');
      }
      return unitFromHtml(html, parseHtml);
    };
  }),
  unitToHtml: defineCloningHostSyncUtility(unitToMarkup),
  safeString: defineLocalUtility(runtimeSafeString),
  safeRecord: defineLocalUtility(runtimeSafeRecord),
  affix: defineCloningHostSyncUtility(hostAffix),
  group: defineCloningHostSyncUtility(hostGroup),
  fallback: defineCloningHostSyncUtility(hostFallback),
  when: defineCloningHostSyncUtility(hostChoose),
  withStyle: defineCloningHostSyncUtility(hostWithStyle),
  link: defineCloningHostSyncUtility(hostLink),
} as const satisfies UtilityFactoryMap;

const UTILITY_DEFINITIONS = materializeUtilityDefinitions(
  UTILITY_DEFINITION_FACTORIES,
);

export const RUNTIME_UTILITY_NAMES = Object.keys(UTILITY_DEFINITIONS) as Array<
  keyof TableStyleUtils
>;

function buildSandboxUtilitiesSource(): string {
  // The sandbox evaluates script text, so the utility table is generated as one
  // source string. Composing it from typed TypeScript functions keeps every body
  // type-checked and debuggable in the host bundle.
  const lines = ["(function (__host) {", '  "use strict";'];

  for (const name of RUNTIME_UTILITY_NAMES) {
    lines.push(`  ${UTILITY_DEFINITIONS[name].runtimeSource}`);
  }

  lines.push("  Object.defineProperties(globalThis, {");
  for (const name of RUNTIME_UTILITY_NAMES) {
    lines.push(
      `    ${name}: { value: ${name}, writable: false, configurable: false, enumerable: true },`,
    );
  }
  lines.push("  });");
  lines.push("})(__banyanHostUtils__);");
  return lines.join("\n");
}

let sandboxUtilitiesSourceCache: string | null = null;

// Built on first use, not at import time: the builder scans serialized
// fragments and throws when a toolchain helper is unregistered, and that
// failure belongs to style creation, not to loading the core module.
function getSandboxUtilitiesSource(): string {
  sandboxUtilitiesSourceCache ??= buildSandboxUtilitiesSource();
  return sandboxUtilitiesSourceCache;
}

/**
 * Serialized sources of one sandbox, in installation order. Exposed for the
 * contract test, which asserts that everything serialized here passes the
 * helper-ledger scan.
 */
export function buildSandboxRuntimeSources(): {
  helpersSource: string;
  utilitiesSource: string;
} {
  return {
    helpersSource: buildTranspileHelperSource(),
    utilitiesSource: getSandboxUtilitiesSource(),
  };
}

/**
 * Install the style utilities in a context: helper ledger first (the source
 * below is serialized from this bundle and may reference toolchain helpers),
 * then the utility table, with the host bridge visible only while it is being
 * read.
 */
export function installUtilities(
  context: SandboxContext,
  host: ResolvedHost,
): void {
  const hostBridge = context.createObject();
  for (const [name, fn] of Object.entries(
    createHostUtilityHandlers(context, host),
  )) {
    if (typeof fn !== "function") continue;
    context.defineFunction(hostBridge, name, fn);
  }

  context.defineGlobal("__banyanHostUtils__", hostBridge);
  try {
    context.evaluate(buildTranspileHelperSource(), {
      filename: "banyan-transpile-helpers.js",
    });
    context.evaluate(getSandboxUtilitiesSource(), {
      filename: "banyan-style-utils.js",
    });
  } finally {
    context.deleteGlobal("__banyanHostUtils__");
  }
}

function createHostUtilityHandlers(
  context: SandboxContext,
  host: ResolvedHost,
): Record<string, UnknownArgsFunction> {
  const handlers: Record<string, UnknownArgsFunction> = {};

  for (const name of RUNTIME_UTILITY_NAMES) {
    const buildHostHandler = UTILITY_DEFINITIONS[name].buildHostHandler;
    if (!buildHostHandler) {
      continue;
    }
    handlers[name] = buildHostHandler(context, host);
  }

  return handlers;
}

function createAsyncHostBridgeHandler<K extends keyof AsyncStyleUtils>(
  name: K,
  host: AsyncStyleUtils[K],
  context: SandboxContext,
): UnknownArgsVoidFunction {
  const hostBridge = host as UnknownPromiseFunction;

  return (...args: unknown[]) => {
    const resolve = args[args.length - 2];
    const reject = args[args.length - 1];
    // Capability arguments come from the sandbox object graph. Cross-realm
    // proxies can look empty to the host, so hand the capability host-owned
    // data instead of the raw wrapper.
    const params = args
      .slice(0, -2)
      .map((argument) => context.cloneToHost(argument));

    if (typeof resolve !== "function" || typeof reject !== "function") {
      throw new TypeError(
        `Host bridge '${name}' expects resolve/reject callbacks.`,
      );
    }

    settleBridgePromise(
      Promise.resolve(hostBridge(...params)),
      context,
      resolve as (value: unknown) => void,
      reject as (reason: unknown) => void,
    );
  };
}

function settleBridgePromise(
  promise: Promise<unknown>,
  context: SandboxContext,
  resolve: (value: unknown) => void,
  reject: (reason: unknown) => void,
): void {
  Promise.resolve(promise).then(
    (value) => {
      try {
        resolve(context.importValue(value));
      } catch (error) {
        reject(errorMessageOf(error));
      }
    },
    (error) => {
      reject(errorMessageOf(error));
    },
  );
}

/**
 * Resolve the multilingual group of a style item through the host.
 *
 * The relation is data the style can observe, so it cannot be approximated:
 * a host without it is reported rather than answered with an empty group.
 */
async function readMultilingualItemsForStyle<T extends ScriptItem>(
  item: T,
  host: ResolvedHost,
): Promise<T[]> {
  if (!isBanyanItem(item)) {
    throw new TypeError(
      "Multilingual utilities expect a Banyan item from citation contexts.",
    );
  }

  const resolveMultilingualItems = requireCapability(
    host.capabilities.resolveMultilingualItems,
    'The host does not provide the "resolveMultilingualItems" capability; getMultilingualItems/getMultilingualItem are unavailable.',
  );
  return (await resolveMultilingualItems(item)) as T[];
}

async function readMultilingualItemForStyle<T extends ScriptItem>(
  item: T,
  language: LanguagePreference,
  host: ResolvedHost,
): Promise<T> {
  const preferences = normalizeLanguagePreferences(language);
  if (!preferences.length) {
    throw new TypeError(
      "getMultilingualItem expects a non-empty language selector.",
    );
  }

  if (!isBanyanItem(item)) {
    throw new TypeError(
      "Multilingual utilities expect a Banyan item from citation contexts.",
    );
  }

  const relatedItems = await readMultilingualItemsForStyle(item, host);
  // Normalized once, not per preference: `Intl.Locale` is the expensive part.
  const candidates: StyleLanguageCandidate<T>[] = [];
  for (const candidate of [item, ...relatedItems]) {
    const candidateLanguage = normalizeStyleLanguageTag(candidate.language);
    if (!candidateLanguage) {
      continue;
    }
    candidates.push({
      item: candidate,
      language: candidateLanguage,
      isSource: candidate === item,
    });
  }
  for (const preference of preferences) {
    const match = findLanguageMatch(candidates, preference);
    if (match) {
      return match;
    }
  }

  return item;
}
