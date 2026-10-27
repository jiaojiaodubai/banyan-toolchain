/**
 * The test kit CLI: `run`, `unit`, `rdf dump|build`.
 *
 * Exit codes: 0 success, 1 error, 2 snapshot mismatch.
 *
 * `runCli()` takes its argv and output sinks explicitly, so the CLI behavior
 * (exit codes, argument handling, snapshot mismatch) is testable in-process —
 * no child process, no captured pipes. The bin entry only calls it.
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import util from "node:util";
import { TestLibrary } from "./library/library";
import { lintStyleSource } from "./lint";
import {
  ITEM_DATABASE_SCHEMA,
  parseItemDatabase,
} from "./library/item-database";
import { parseZoteroRdf } from "./rdf/parse";
import { serializeZoteroRdf } from "./rdf/serialize";
import { buildContexts, type ContextsInput } from "./run/contexts";
import { runStyleIsolated } from "./run/isolate";
import { renderDocument, renderFragment, renderResult } from "./run/render";
import { loadStyle, readStyleFile, runStyle } from "./run/runner";
import {
  buildSnapshotPayload,
  checkSnapshot,
  writeSnapshot,
} from "./run/snapshot";
import type {
  Style,
  StyleDiagnostic,
  StyleInstance,
  StyleMessage,
  StyleOptionValues,
  StyleResult,
} from "./banyan";

export const EXIT_OK = 0;
export const EXIT_ERROR = 1;
export const EXIT_SNAPSHOT_MISMATCH = 2;

const USAGE = `banyan-style-test-kit — offline Banyan style testing

Usage:
  banyan-style-test-kit run --style <file.js> (--rdf <file.rdf> | --items-json <file.json>)
                     (--contexts <file.json> | --items <ref,ref>...) [options]
  banyan-style-test-kit unit --style <file.js> [--json]
  banyan-style-test-kit lint --style <file.js> [--json]
  banyan-style-test-kit items validate --items-json <file.json> [--json]
  banyan-style-test-kit items dump --items-json <file.json> [--json]
  banyan-style-test-kit items schema
  banyan-style-test-kit rdf dump --rdf <file.rdf> [--json]
  banyan-style-test-kit rdf build --rdf <file.rdf> [--out <file>]

run options:
  --items-json <file>   Simple Banyan item database (JSON) instead of RDF
  --style-dir <dir>     Directory the sandbox may read (default: cwd)
  --options <file>      Style option values as a JSON object (string|boolean)
  --snapshot <file>     Compare the run against a baseline (exit 2 on mismatch)
  --check | --update    Check the baseline explicitly / write it
  --document            Print a complete HTML document instead of a fragment
  --json                Print INFO, diagnostics and the structured result
  --isolated            Run the style in a resource-limited child process
  --timeout <ms>        Wall-clock limit for --isolated (default 30000);
                        in-process: synchronous evaluate budget
  --memory <mb>         Heap limit for --isolated (default 256)
  --max-output <bytes>  Result size limit for --isolated (default 4194304)

Commands:
  run             Execute a style against test data and print (or snapshot) the output.
  unit            Load a style and print its INFO / controls / presets / diagnostics.
  lint            Lint a style with the shared Banyan ESLint rules.
  items validate  Validate a simple JSON item database (exit 1 on errors).
  items dump      Load a JSON database and print the normalized item records.
  items schema    Print the JSON Schema of the simple item database.
  rdf dump        Parse Zotero RDF and print the normalized item records.
  rdf build       Round-trip a Zotero RDF file through parse + serialize.

Exit codes: 0 success, 1 error, 2 snapshot mismatch.`;

export interface CliIo {
  stdout(text: string): void;
  stderr(text: string): void;
}

const processIo: CliIo = {
  stdout: (text) => console.log(text),
  stderr: (text) => console.error(text),
};

type Values = Record<string, string | boolean | string[] | undefined>;

interface RunOptions {
  style: string;
  rdf: string;
  itemsJson?: string;
  contexts?: string;
  items?: string[];
  optionsFile?: string;
  styleDir: string;
  snapshot?: string;
  check: boolean;
  update: boolean;
  document: boolean;
  json: boolean;
  out?: string;
  isolated: boolean;
  timeoutMs?: number;
  memoryMb?: number;
  maxOutputBytes?: number;
}

export async function runCli(
  argv: readonly string[],
  io: CliIo = processIo,
): Promise<number> {
  let values: Values;
  let positionals: string[];
  try {
    const parsed = util.parseArgs({
      allowPositionals: true,
      args: [...argv],
      options: {
        style: { type: "string" },
        rdf: { type: "string" },
        "items-json": { type: "string" },
        contexts: { type: "string" },
        items: { type: "string", multiple: true },
        options: { type: "string" },
        "style-dir": { type: "string" },
        snapshot: { type: "string" },
        check: { type: "boolean", default: false },
        update: { type: "boolean", default: false },
        document: { type: "boolean", default: false },
        json: { type: "boolean", default: false },
        isolated: { type: "boolean", default: false },
        timeout: { type: "string" },
        memory: { type: "string" },
        "max-output": { type: "string" },
        out: { type: "string" },
        help: { type: "boolean", default: false },
      },
    });
    values = parsed.values as Values;
    positionals = parsed.positionals;
  } catch (error) {
    io.stderr(`Argument error: ${errorText(error)}`);
    io.stderr(USAGE);
    return EXIT_ERROR;
  }

  if (values.help || !positionals.length) {
    io.stdout(USAGE);
    return values.help ? EXIT_OK : EXIT_ERROR;
  }

  const [command, subcommand] = positionals;
  try {
    const options = toRunOptions(values);
    switch (command) {
      case "run":
        return await commandRun(options, io);
      case "unit":
        return await commandUnit(options, io);
      case "lint":
        return await commandLint(options, io);
      case "items":
        return await commandItems(options, subcommand, io);
      case "rdf":
        return await commandRdf(options, subcommand, io);
      default:
        io.stderr(`Unknown command: ${command}`);
        io.stderr(USAGE);
        return EXIT_ERROR;
    }
  } catch (error) {
    io.stderr(errorText(error));
    return EXIT_ERROR;
  }
}

function toRunOptions(values: Values): RunOptions {
  const stringValue = (name: string): string | undefined => {
    const value = values[name];
    return typeof value === "string" ? value : undefined;
  };
  const numberValue = (name: string): number | undefined => {
    const raw = stringValue(name);
    if (raw === undefined || !raw.trim()) return undefined;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed < 0) {
      throw new Error(`--${name} must be a non-negative number.`);
    }
    return parsed;
  };
  return {
    style: stringValue("style") ?? "",
    rdf: stringValue("rdf") ?? "",
    itemsJson: stringValue("items-json"),
    contexts: stringValue("contexts"),
    items: Array.isArray(values.items) ? (values.items as string[]) : undefined,
    optionsFile: stringValue("options"),
    styleDir: stringValue("style-dir") ?? process.cwd(),
    snapshot: stringValue("snapshot"),
    check: values.check === true,
    update: values.update === true,
    document: values.document === true,
    json: values.json === true,
    out: stringValue("out"),
    isolated: values.isolated === true,
    timeoutMs: numberValue("timeout"),
    memoryMb: numberValue("memory"),
    maxOutputBytes: numberValue("max-output"),
  };
}

function errorText(error: unknown): string {
  if (error instanceof Error) {
    const code = (error as { code?: unknown }).code;
    return typeof code === "string"
      ? `[${code}] ${error.message}`
      : error.message;
  }
  return String(error);
}

async function loadContextsInput(options: RunOptions): Promise<ContextsInput> {
  if (options.contexts) {
    return JSON.parse(
      await readFile(options.contexts, "utf8"),
    ) as ContextsInput;
  }
  if (options.items?.length) {
    // `--items a,b` may repeat; each occurrence is one citation context.
    return options.items.map((refs) => ({
      cites: refs
        .split(",")
        .map((ref) => ref.trim())
        .filter(Boolean)
        .map((item) => ({ item })),
    }));
  }
  throw new Error("Provide --contexts <file.json> or --items <ref,ref>.");
}

interface RunOutcome {
  info: Partial<Style["INFO"]> | undefined;
  result: StyleResult;
  messages: StyleMessage[];
  diagnostics: readonly StyleDiagnostic[];
  libraryDiagnostics: readonly StyleDiagnostic[];
  styleOptions?: StyleOptionValues;
  dataSource: "rdf" | "json";
  isolation?: { timedOut: boolean; elapsedMs: number };
}

/** The test data for one run: a Zotero RDF document or a JSON item database. */
type RunDataSource =
  { kind: "rdf"; rdf: string } | { kind: "json"; database: unknown };

async function loadDataSource(options: RunOptions): Promise<RunDataSource> {
  if (options.rdf && options.itemsJson) {
    throw new Error("Use either --rdf or --items-json, not both.");
  }
  if (options.rdf) {
    return { kind: "rdf", rdf: await readFile(options.rdf, "utf8") };
  }
  if (options.itemsJson) {
    return {
      kind: "json",
      database: JSON.parse(await readFile(options.itemsJson, "utf8")),
    };
  }
  throw new Error("--rdf or --items-json is required (test data).");
}

function libraryFrom(source: RunDataSource): TestLibrary {
  return source.kind === "rdf"
    ? TestLibrary.fromRdf(source.rdf)
    : TestLibrary.fromItemDatabase(source.database);
}

/** Read `--options`: a JSON object of `string | boolean` style option values. */
async function loadStyleOptions(
  options: RunOptions,
): Promise<StyleOptionValues | undefined> {
  if (!options.optionsFile) return undefined;
  const raw: unknown = JSON.parse(await readFile(options.optionsFile, "utf8"));
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(
      "--options must point to a JSON object mapping option ids to values.",
    );
  }
  const values: StyleOptionValues = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value !== "string" && typeof value !== "boolean") {
      throw new Error(`Option "${key}" must be a string or a boolean.`);
    }
    values[key] = value;
  }
  return values;
}

async function executeRun(
  options: RunOptions,
  contextsInput: ContextsInput,
  source: RunDataSource,
  library: TestLibrary | undefined,
): Promise<RunOutcome> {
  const styleOptions = await loadStyleOptions(options);
  const dataSource = source.kind;

  if (options.isolated) {
    const isolated = await runStyleIsolated({
      code: await readStyleFile(options.style),
      ...(source.kind === "rdf"
        ? { rdf: source.rdf }
        : { itemsJson: source.database }),
      contexts: contextsInput,
      styleDir: options.styleDir,
      timeoutMs: options.timeoutMs,
      memoryMb: options.memoryMb,
      maxOutputBytes: options.maxOutputBytes,
      styleOptions,
    });
    return {
      info: isolated.info,
      result: isolated.result,
      messages: isolated.messages,
      diagnostics: isolated.diagnostics,
      libraryDiagnostics: isolated.libraryDiagnostics,
      ...(isolated.styleOptions ? { styleOptions: isolated.styleOptions } : {}),
      dataSource,
      isolation: isolated.isolation,
    };
  }

  const activeLibrary = library ?? libraryFrom(source);
  const contexts = buildContexts(activeLibrary, contextsInput);
  const run = await runStyle(
    {
      code: await readStyleFile(options.style),
      library: activeLibrary,
      styleDir: options.styleDir,
      timeoutMs: options.timeoutMs,
      styleOptions,
    },
    contexts,
  );
  return {
    info: run.style.INFO,
    result: run.result,
    messages: run.messages,
    diagnostics: run.style.diagnostics,
    libraryDiagnostics: [...activeLibrary.diagnostics],
    ...(run.styleOptions ? { styleOptions: run.styleOptions } : {}),
    dataSource,
  };
}

async function commandRun(options: RunOptions, io: CliIo): Promise<number> {
  if (!options.style) {
    throw new Error("--style is required.");
  }
  const source = await loadDataSource(options);
  const contextsInput = await loadContextsInput(options);
  // In-process runs use the parsed library directly; isolated runs rebuild the
  // same data source inside the child process.
  const library = options.isolated ? undefined : libraryFrom(source);
  const run = await executeRun(options, contextsInput, source, library);

  if (options.snapshot) {
    if (options.check && options.update) {
      throw new Error("--check and --update are mutually exclusive.");
    }
    const payload = buildSnapshotPayload(run.info, run.result, run.diagnostics);
    if (options.update) {
      await writeSnapshot(options.snapshot, payload);
      io.stdout(`Snapshot written: ${options.snapshot}`);
      return EXIT_OK;
    }
    const check = await checkSnapshot(options.snapshot, payload);
    if (check.match) {
      io.stdout(`Snapshot OK: ${options.snapshot}`);
      return EXIT_OK;
    }
    io.stderr(`Snapshot MISMATCH: ${options.snapshot}`);
    io.stderr(check.diff);
    return EXIT_SNAPSHOT_MISMATCH;
  }

  if (options.document) {
    io.stdout(renderDocument(run.result));
  } else if (options.json) {
    io.stdout(
      JSON.stringify(
        {
          style: run.info,
          dataSource: run.dataSource,
          styleOptions: run.styleOptions,
          isolation: run.isolation,
          diagnostics: run.diagnostics,
          libraryDiagnostics: run.libraryDiagnostics,
          result: run.result,
          rendered: renderResult(run.result),
        },
        null,
        2,
      ),
    );
  } else {
    io.stdout(renderFragment(run.result));
  }

  reportDiagnostics(run, io);
  return EXIT_OK;
}

/**
 * The style metadata a `unit` run reports. Callbacks (`applicable`,
 * `forcedValue` as a function, `validate`, preset visibility, field checks) are
 * summarized as "declared" rather than serialized.
 */
function summarizeStyle(style: StyleInstance) {
  type ParamLike = {
    id: string;
    label: string;
    kind: "state" | "value" | "list";
    description?: string;
    defaultValue?: unknown;
    states?: Record<string, string>;
    presets?: readonly (string | { label: string; value: string })[];
    format?: "plain" | "rich";
    fields?: readonly { id: string; label: string }[];
    min?: number;
    max?: number;
    applicable?: unknown;
    forcedValue?: unknown;
    validate?: unknown;
  };

  const paramShape = (param: ParamLike) => ({
    id: param.id,
    label: param.label,
    kind: param.kind,
    ...(param.description ? { description: param.description } : {}),
    ...(param.defaultValue !== undefined
      ? { defaultValue: param.defaultValue }
      : {}),
    ...(param.states ? { states: param.states } : {}),
    ...(param.presets
      ? {
          presets: param.presets.map((preset) =>
            typeof preset === "string" ? preset : { ...preset },
          ),
        }
      : {}),
    ...(param.format ? { format: param.format } : {}),
    ...(param.fields
      ? {
          fields: param.fields.map((field) => ({
            id: field.id,
            label: field.label,
          })),
        }
      : {}),
    ...(param.min !== undefined ? { min: param.min } : {}),
    ...(param.max !== undefined ? { max: param.max } : {}),
    ...(typeof param.applicable === "function" ? { hasApplicable: true } : {}),
    ...(param.forcedValue !== undefined ? { hasForcedValue: true } : {}),
    ...(typeof param.validate === "function" ? { hasValidate: true } : {}),
  });

  const params = (declaration: readonly unknown[] | undefined): ParamLike[] =>
    (declaration ?? []) as unknown as ParamLike[];

  return {
    styleOptionParams: params(style.STYLE_OPTIONS).map(paramShape),
    citationParams: params(style.CITATION_PARAMS).map(paramShape),
    citeParams: params(style.CITE_PARAMS).map(paramShape),
    itemFieldPresets: (style.ITEM_FIELD_PRESETS ?? []).map((preset) => ({
      id: preset.id,
      label: preset.label,
      fields: preset.fields,
      ...(typeof preset.visible === "function" ? { hasVisible: true } : {}),
    })),
    itemFieldValidators: Object.fromEntries(
      Object.entries(style.ITEM_FIELD_VALIDATORS ?? {}).map(
        ([itemType, validators]) => [
          itemType,
          (validators ?? []).map((validator) => validator.description),
        ],
      ),
    ),
  };
}

async function commandUnit(options: RunOptions, io: CliIo): Promise<number> {
  if (!options.style) {
    throw new Error("--style is required.");
  }
  const library = TestLibrary.empty();
  const loaded = await loadStyle({
    code: await readStyleFile(options.style),
    library,
    styleDir: options.styleDir,
    timeoutMs: options.timeoutMs,
  });
  const style = loaded.style;
  const info = style.INFO;
  const summary = summarizeStyle(style);

  if (options.json) {
    io.stdout(
      JSON.stringify(
        {
          INFO: info,
          ...summary,
          diagnostics: style.diagnostics,
        },
        null,
        2,
      ),
    );
  } else {
    io.stdout(`${info.title} (${info.id})`);
    io.stdout(`  citationType: ${info.citationType}`);
    io.stdout(`  description:  ${info.description}`);
    const ids = (params: { id: string; kind?: string }[]): string =>
      params.length
        ? ` (${params
            .map((param) =>
              param.kind ? `${param.id}:${param.kind}` : param.id,
            )
            .join(", ")})`
        : "";
    io.stdout(
      `  style options:   ${summary.styleOptionParams.length}${ids(summary.styleOptionParams)}`,
    );
    io.stdout(
      `  citation params: ${summary.citationParams.length}${ids(summary.citationParams)}`,
    );
    io.stdout(
      `  cite params:     ${summary.citeParams.length}${ids(summary.citeParams)}`,
    );
    io.stdout(
      `  field presets:   ${summary.itemFieldPresets.length}${ids(summary.itemFieldPresets)}`,
    );
    const validatorTypes = Object.entries(summary.itemFieldValidators);
    if (validatorTypes.length) {
      io.stdout(
        `  field validators: ${validatorTypes
          .map(
            ([itemType, descriptions]) => `${itemType}=${descriptions.length}`,
          )
          .join(", ")}`,
      );
    }
  }
  reportDiagnostics(
    {
      diagnostics: style.diagnostics,
      libraryDiagnostics: library.diagnostics,
    },
    io,
  );
  return EXIT_OK;
}

async function commandLint(options: RunOptions, io: CliIo): Promise<number> {
  if (!options.style) {
    throw new Error("--style is required.");
  }

  const messages = await lintStyleSource(
    await readFile(options.style, "utf8"),
    { filePath: options.style },
  );

  if (options.json) {
    io.stdout(JSON.stringify(messages, null, 2));
  } else if (!messages.length) {
    io.stdout("No lint issues.");
  } else {
    for (const message of messages) {
      const severity = message.severity === 2 ? "error" : "warning";
      const line = message.line ?? 1;
      const column = message.column ?? 1;
      const rule = message.ruleId ? ` (${message.ruleId})` : "";
      io.stdout(
        `${options.style}:${line}:${column} ${severity} ${message.message}${rule}`,
      );
    }
  }

  return messages.some((message) => message.severity === 2)
    ? EXIT_ERROR
    : EXIT_OK;
}

/**
 * `items`: validate, dump or describe the simple JSON item database
 * (`docs/item-json.md`). Validation never throws on record findings; errors
 * are reported and turn into exit code 1.
 */
async function commandItems(
  options: RunOptions,
  subcommand: string | undefined,
  io: CliIo,
): Promise<number> {
  if (subcommand === "schema") {
    io.stdout(JSON.stringify(ITEM_DATABASE_SCHEMA, null, 2));
    return EXIT_OK;
  }
  if (subcommand !== "validate" && subcommand !== "dump") {
    throw new Error(
      `Unknown items subcommand: ${subcommand ?? "(none)"} (use validate, dump or schema).`,
    );
  }
  if (!options.itemsJson) {
    throw new Error("--items-json is required.");
  }
  let database: unknown;
  try {
    database = JSON.parse(await readFile(options.itemsJson, "utf8"));
  } catch (error) {
    throw new Error(`Cannot read ${options.itemsJson}: ${errorText(error)}`);
  }

  const parsed = parseItemDatabase(database);
  const errors = parsed.issues.filter((issue) => issue.severity === "error");
  const warnings = parsed.issues.filter(
    (issue) => issue.severity === "warning",
  );

  if (subcommand === "validate") {
    if (options.json) {
      io.stdout(
        JSON.stringify(
          {
            items: parsed.items.length,
            groups: parsed.groups.length,
            issues: parsed.issues,
          },
          null,
          2,
        ),
      );
    } else {
      io.stdout(
        `${parsed.items.length} item(s), ${parsed.groups.length} multilingual group(s), ${errors.length} error(s), ${warnings.length} warning(s)`,
      );
      for (const issue of parsed.issues) {
        io.stderr(
          `${issue.path || "(root)"}: ${issue.severity}: ${issue.message}`,
        );
      }
    }
    return errors.length ? EXIT_ERROR : EXIT_OK;
  }

  if (options.json) {
    io.stdout(
      JSON.stringify(
        {
          items: parsed.items,
          multilingual: parsed.groups,
          issues: parsed.issues,
        },
        null,
        2,
      ),
    );
  } else {
    for (const item of parsed.items) {
      io.stdout(`${item.id} [${item.itemType}]`);
      for (const [field, value] of Object.entries(item)) {
        if (
          field === "id" ||
          field === "itemType" ||
          field === "creators" ||
          field === "tags" ||
          field === "extra" ||
          field === "year" ||
          field === "firstCreator"
        ) {
          continue;
        }
        io.stdout(`  ${field}: ${String(value)}`);
      }
      if (item.year) io.stdout(`  year: ${item.year}`);
      if (item.firstCreator) {
        io.stdout(`  firstCreator: ${item.firstCreator}`);
      }
      if (item.creators.length) {
        io.stdout(
          `  creators: ${item.creators
            .map(
              (creator) =>
                `${creator.creatorType}:${creator.name ?? [creator.lastName, creator.firstName].filter(Boolean).join(", ")}`,
            )
            .join("; ")}`,
        );
      }
      if (item.tags?.length) io.stdout(`  tags: ${item.tags.join(", ")}`);
      for (const [key, value] of Object.entries(item.extra ?? {})) {
        io.stdout(
          `  extra.${key}: ${Array.isArray(value) ? value.join(" / ") : value}`,
        );
      }
    }
    if (parsed.groups.length) {
      io.stdout(
        `multilingual: ${parsed.groups.map((group) => group.join("+")).join(" | ")}`,
      );
    }
    for (const issue of parsed.issues) {
      io.stderr(
        `${issue.path || "(root)"}: ${issue.severity}: ${issue.message}`,
      );
    }
  }
  return errors.length ? EXIT_ERROR : EXIT_OK;
}

async function commandRdf(
  options: RunOptions,
  subcommand: string | undefined,
  io: CliIo,
): Promise<number> {
  if (!options.rdf) {
    throw new Error("--rdf is required.");
  }
  const xml = await readFile(options.rdf, "utf8");
  const items = parseZoteroRdf(xml);

  switch (subcommand) {
    case "dump": {
      if (options.json) {
        io.stdout(JSON.stringify(items, null, 2));
        return EXIT_OK;
      }
      for (const item of items) {
        io.stdout(
          `${item.node} [${item.itemType}]${item.key ? ` key=${item.key}` : ""}`,
        );
        for (const [field, value] of Object.entries(item.fields)) {
          io.stdout(`  ${field}: ${value}`);
        }
        for (const creator of item.creators) {
          const name =
            creator.name ?? `${creator.lastName}, ${creator.firstName}`;
          io.stdout(`  creator(${creator.creatorType}): ${name}`);
        }
        for (const tag of item.tags) io.stdout(`  tag: ${tag}`);
        for (const [predicate, targets] of Object.entries(item.relations)) {
          io.stdout(`  relation ${predicate}: ${targets.join(", ")}`);
        }
      }
      return EXIT_OK;
    }
    case "build": {
      const rebuilt = serializeZoteroRdf(items);
      if (options.out) {
        await writeFile(options.out, rebuilt, "utf8");
        io.stdout(`Wrote ${options.out}`);
      } else {
        io.stdout(rebuilt);
      }
      return EXIT_OK;
    }
    default:
      throw new Error("Usage: rdf <dump|build> --rdf <file.rdf>");
  }
}

function reportDiagnostics(
  run: Pick<RunOutcome, "diagnostics" | "libraryDiagnostics">,
  io: CliIo,
): void {
  for (const message of [...run.libraryDiagnostics, ...run.diagnostics]) {
    io.stderr(
      `[${message.severity}] (${message.source}/${message.code}) ${message.message}`,
    );
  }
}

/** True when this module is the process entry point (`node src/cli.ts`). */
function isEntryPoint(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return pathToFileURL(path.resolve(entry)).href === import.meta.url;
  } catch {
    return false;
  }
}

if (isEntryPoint()) {
  process.exitCode = await runCli(process.argv.slice(2));
}
