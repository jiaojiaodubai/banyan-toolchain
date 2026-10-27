// Runtime utilities exposed to user style scripts.
//
// The table lives in the core and is host-agnostic: each entry generates the
// source that the sandbox evaluates, plus (when it needs host abilities) a
// handler built from `StyleHostCapabilities`. Realm mechanics stay with the
// host and reach the core only through `SandboxContext`.
import type { ScriptItem } from "../types/style";
import type {
  ReadOptions,
  ReadUTF8Options,
  StyleUtils,
} from "../types/styleUtils";
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
import type {
  ResolvedHost,
  SandboxContext,
  StyleHostCapabilities,
} from "../host";
import { requireCapability } from "../host";
import { isBanyanItem } from "../items/fields";
import {
  findLanguageMatch,
  normalizeStyleLanguageTag,
  type StyleLanguageCandidate,
} from "../items/language";
import { sanitizeLink } from "../richText/html";
import { normalizeTextValue, plainText as plainUnitText } from "../units/unit";
import { toHostUnit } from "../units/normalize";
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
type AsyncKeys<T> = {
  [K in keyof T]: IsAsync<T[K]> extends true ? K : never;
}[keyof T];
type SyncKeys<T> = {
  [K in keyof T]: IsSync<T[K]> extends true ? K : never;
}[keyof T];
type AsyncStyleUtils = Pick<StyleUtils, AsyncKeys<StyleUtils>>;
type SyncStyleUtils = Pick<StyleUtils, SyncKeys<StyleUtils>>;
export type SandboxGlobal = Record<string, unknown>;
type UnknownArgsFunction = (...args: unknown[]) => unknown;
type UnknownArgsVoidFunction = (...args: unknown[]) => void;
type UnknownPromiseFunction = (...args: unknown[]) => Promise<unknown>;
type RuntimeSerializableFunction = (...args: never[]) => unknown;
type LanguagePreference = string | readonly string[];

type UtilityDefinitionMap = {
  [K in keyof StyleUtils]: K extends AsyncKeys<StyleUtils>
    ? HostAsyncUtilityEntry
    : K extends SyncKeys<StyleUtils>
      ? LocalUtilityEntry | HostSyncUtilityEntry
      : never;
};

type UtilityFactoryMap = {
  [K in keyof StyleUtils]: K extends AsyncKeys<StyleUtils>
    ? HostAsyncUtilityFactoryEntry<K>
    : K extends SyncKeys<StyleUtils>
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
type UtilityCapability = "parseHtml" | "readFile" | "resolveMultilingualItems";

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

function hostPlainText(input: Unit | readonly Unit[]): string {
  return plainUnitText(input);
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

function serializeHostAsyncRuntimeFunction(
  exportedName: keyof StyleUtils,
): string {
  return `const ${exportedName} = function (...args) { return new Promise((resolve, reject) => { __host.${exportedName}(...args, resolve, (reason) => { const error = new Error(typeof reason === "string" ? reason : String(reason)); error.code = "host-capability"; error.sourcePath = ${JSON.stringify(exportedName)}; reject(error); }); }); };`;
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

function defineCapabilityAsyncUtility<K extends keyof AsyncStyleUtils>(
  requires: UtilityCapability,
  build: (host: ResolvedHost) => (...args: never[]) => Promise<unknown>,
): HostAsyncUtilityFactoryEntry<K> {
  return {
    requires,
    buildRuntimeSource: (name) => serializeHostAsyncRuntimeFunction(name),
    buildHostHandler: (name, context, host) =>
      createAsyncHostBridgeHandler(
        name,
        build(host) as AsyncStyleUtils[K],
        context,
      ),
  };
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

  for (const name of Object.keys(definitions) as Array<keyof StyleUtils>) {
    const definition = definitions[name] as {
      buildRuntimeSource: (name: keyof StyleUtils) => string;
      buildHostHandler?: (
        name: keyof StyleUtils,
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
  readBytes: defineCapabilityAsyncUtility(
    "readFile",
    (host) => (relPath: string, options?: ReadOptions) =>
      readBytes(relPath, options, host),
  ),
  readText: defineCapabilityAsyncUtility(
    "readFile",
    (host) => (relPath: string, options?: ReadUTF8Options) =>
      readText(relPath, options, host),
  ),
  readJSON: defineCapabilityAsyncUtility(
    "readFile",
    (host) => (relPath: string, options?: ReadUTF8Options) =>
      readJSON(relPath, options, host),
  ),
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
  plainText: defineCloningHostSyncUtility(hostPlainText),
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
  keyof StyleUtils
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

function assertFileReadAvailable(
  host: ResolvedHost,
): NonNullable<StyleHostCapabilities["readFile"]> {
  return requireCapability(
    host.capabilities.readFile,
    'The host does not provide the "readFile" capability; readBytes/readText/readJSON are unavailable.',
  );
}

async function readBytes(
  relPath: string,
  options: ReadOptions | undefined,
  host: ResolvedHost,
): Promise<Uint8Array> {
  return assertFileReadAvailable(host)(relPath, options);
}

async function readText(
  relPath: string,
  options: ReadUTF8Options | undefined,
  host: ResolvedHost,
): Promise<string> {
  const bytes = await assertFileReadAvailable(host)(relPath, options);
  return new TextDecoder().decode(bytes);
}

async function readJSON<T = unknown>(
  relPath: string,
  options: ReadUTF8Options | undefined,
  host: ResolvedHost,
): Promise<T> {
  return JSON.parse(await readText(relPath, options, host)) as T;
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
