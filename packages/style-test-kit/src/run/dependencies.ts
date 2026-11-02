/**
 * Style directories as a dependency graph: the index behind `resolveStyle()`
 * and the `deps` command.
 *
 * A style is found by its `INFO.id`, never by a path the author typed: the
 * index loads every configured directory once with the core's own loader, so
 * the dependency list and the resource declarations are the *normalized* ones
 * (a declaration the core dropped is not part of the graph).
 *
 * The index is also where cross-file facts are checked, because a single style
 * file cannot know them: a missing dependency, a cycle, a chain past the depth
 * limit, and a declared resource that is absent, oversized, unparsable or
 * rejected by its own `validate()`.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  createStyle,
  type ResolvedStyleSource,
  type StyleHost,
  type StyleInstance,
  type StyleResource,
} from "../banyan";
import {
  MAX_DELEGATION_DEPTH,
  MAX_RESOURCE_BYTES,
} from "@banyan/style-contract";
import { createConfinedReadFile } from "../runtime/capabilities";
import { createNodeHost } from "../runtime/node-host";

/** The style file every style directory is expected to contain. */
export const STYLE_FILE_NAME = "style.js";

export interface StyleIndexEntry {
  id: string;
  /** Directory the style's resources resolve against. */
  dir: string;
  /** Source of `<dir>/style.js`. */
  code: string;
  info: StyleInstance["INFO"];
  /** The loaded instance, kept so a resource `validate()` can be called. */
  style: StyleInstance;
  dependencies: readonly string[];
  resources: readonly StyleResource[];
  /** Declaration findings of the load, if any. */
  diagnostics: readonly { severity: string; message: string }[];
}

export interface StyleIndex {
  entries: Map<string, StyleIndexEntry>;
  /** Load failures, keyed by directory: a broken style cannot be indexed. */
  failures: {
    dir: string;
    message: string;
    /** Structured cause, so consumers never parse `message` to classify it. */
    kind: "load" | "duplicate-id";
  }[];
}

export interface DependencyIndexOptions {
  /** Per-file read limit for a style's resources (default 16 MiB). */
  maxFileBytes?: number;
  /**
   * Synchronous budget for evaluating each style's script (default 2 s).
   *
   * Indexing loads every style, and a style whose top level never returns would
   * otherwise hang the whole command: `deps` is a CI preflight, so a broken
   * file must become a reported failure, not a stuck process. Hosts without a
   * synchronous budget ignore it.
   */
  evaluateTimeoutMs?: number;
}

/** Enough for a large style file; small enough to fail a runaway loop quickly. */
const DEFAULT_INDEX_EVALUATE_TIMEOUT_MS = 2_000;

function hostForStyleDir(
  styleDir: string,
  evaluateTimeoutMs: number,
): StyleHost {
  // Deliberately without `resolveStyle`: indexing must not recurse into other
  // styles, and a style never delegates during its load anyway.
  return createNodeHost(
    {
      parseHtml: () => null,
      readFile: createConfinedReadFile(styleDir),
      resolveMultilingualItems: async () => [],
    },
    { timeoutMs: evaluateTimeoutMs },
  );
}

/**
 * Load every style in the given directories.
 *
 * Directories are read once; the same id twice is a failure, because a host
 * cannot know which of the two a dependency means.
 */
export async function indexStyles(
  stylePaths: readonly string[],
  options: DependencyIndexOptions = {},
): Promise<StyleIndex> {
  const evaluateTimeoutMs =
    options.evaluateTimeoutMs ?? DEFAULT_INDEX_EVALUATE_TIMEOUT_MS;
  const entries = new Map<string, StyleIndexEntry>();
  const failures: StyleIndex["failures"] = [];

  for (const rawDir of stylePaths) {
    const dir = path.resolve(rawDir);
    let code: string;
    try {
      code = await readFile(path.join(dir, STYLE_FILE_NAME), "utf8");
    } catch (error) {
      failures.push({
        dir,
        message: `cannot read ${STYLE_FILE_NAME}: ${
          error instanceof Error ? error.message : String(error)
        }`,
        kind: "load",
      });
      continue;
    }

    let style: StyleInstance;
    try {
      style = await createStyle(hostForStyleDir(dir, evaluateTimeoutMs), code, {
        // The host's own default covers `evaluate`; passing it here too keeps
        // the budget in force for a host that assembles its context lazily.
        evaluateTimeoutMs,
      });
    } catch (error) {
      failures.push({
        dir,
        message: error instanceof Error ? error.message : String(error),
        kind: "load",
      });
      continue;
    }

    const id = String(style.INFO?.id ?? "").trim();
    if (!id) {
      failures.push({
        dir,
        message: "style INFO has no usable id",
        kind: "load",
      });
      continue;
    }
    if (entries.has(id)) {
      failures.push({
        dir,
        message: `duplicate style id '${id}' (also at ${entries.get(id)!.dir})`,
        kind: "duplicate-id",
      });
      continue;
    }

    entries.set(id, {
      id,
      dir,
      code,
      info: style.INFO,
      style,
      dependencies: (style.STYLE_DEPENDENCIES ?? []).map(
        (dependency) => dependency.id,
      ),
      resources: style.STYLE_RESOURCES ?? [],
      diagnostics: style.diagnostics,
    });
  }

  return { entries, failures };
}

export interface StyleResolver {
  index(): Promise<StyleIndex>;
  resolveStyle(id: string): Promise<ResolvedStyleSource | null>;
}

/**
 * Lazily indexed `resolveStyle` implementation for `createTestKitHost()`.
 *
 * The index is built on the first delegation and reused afterwards, so a run
 * pays one load per style directory rather than one per call.
 */
export function createTestKitStyleResolver(
  stylePaths: readonly string[],
  options: DependencyIndexOptions = {},
): StyleResolver {
  let pending: Promise<StyleIndex> | undefined;
  const index = (): Promise<StyleIndex> => {
    pending ??= indexStyles(stylePaths, options);
    return pending;
  };

  return {
    index,
    async resolveStyle(id: string): Promise<ResolvedStyleSource | null> {
      const entry = (await index()).entries.get(id);
      if (!entry) {
        return null;
      }
      return {
        code: entry.code,
        readFile: createConfinedReadFile(entry.dir, options.maxFileBytes),
      };
    },
  };
}

export type DependencyIssueKind =
  | "load"
  | "duplicate-id"
  | "missing-dependency"
  | "cycle"
  | "depth"
  | "resource-missing"
  | "resource-too-large"
  | "resource-invalid";

export interface DependencyIssue {
  severity: "error" | "warning";
  kind: DependencyIssueKind;
  message: string;
  /** Style the issue belongs to, when it has one. */
  style?: string;
  /** Declared dependency or resource id involved. */
  target?: string;
}

export interface DependencyReport {
  styles: {
    id: string;
    dir: string;
    title: string;
    citationType: string;
    dependencies: string[];
    resources: { id: string; path: string; format: string }[];
  }[];
  issues: DependencyIssue[];
}

/** Declared ids of one indexed style; an unindexed id has no outgoing edge. */
function nextIds(
  entries: Map<string, StyleIndexEntry>,
  id: string,
): readonly string[] {
  return entries.get(id)?.dependencies ?? [];
}

/** Report one cycle per canonical rotation (`a -> b -> a`, not `b -> a -> b`). */
function findCycles(entries: Map<string, StyleIndexEntry>): string[][] {
  const cycles: string[][] = [];
  const seen = new Set<string>();
  const state = new Map<string, "waiting" | "done">();
  const stack: string[] = [];

  const visit = (id: string): void => {
    state.set(id, "waiting");
    stack.push(id);
    for (const next of nextIds(entries, id)) {
      if (!entries.has(next)) continue;
      if (state.get(next) === "waiting") {
        const start = stack.indexOf(next);
        const cycle = [...stack.slice(start), next];
        const key = cycle.slice(0, -1).sort().join("\u0000");
        if (!seen.has(key)) {
          seen.add(key);
          cycles.push(cycle);
        }
      } else if (state.get(next) !== "done") {
        visit(next);
      }
    }
    stack.pop();
    state.set(id, "done");
  };

  for (const id of entries.keys()) {
    if (!state.has(id)) visit(id);
  }
  return cycles;
}

/** Find chains longer than the runtime's limit, one report per chain. */
function findTooDeepChains(entries: Map<string, StyleIndexEntry>): string[][] {
  const tooDeep: string[][] = [];
  const seen = new Set<string>();

  const walk = (chain: string[]): void => {
    const current = chain[chain.length - 1]!;
    for (const next of nextIds(entries, current)) {
      if (!entries.has(next) || chain.includes(next)) continue;
      const extended = [...chain, next];
      if (extended.length > MAX_DELEGATION_DEPTH) {
        const key = extended.join("\u0000");
        if (!seen.has(key)) {
          seen.add(key);
          tooDeep.push(extended);
        }
        // Longer chains through this branch are a consequence of the same
        // problem, not a second one.
        continue;
      }
      walk(extended);
    }
  };

  for (const id of entries.keys()) {
    walk([id]);
  }
  return tooDeep;
}

async function checkResources(
  entry: StyleIndexEntry,
  options: DependencyIndexOptions,
): Promise<DependencyIssue[]> {
  const issues: DependencyIssue[] = [];
  const readFile = createConfinedReadFile(entry.dir, options.maxFileBytes);

  for (const resource of entry.resources) {
    let bytes: Uint8Array;
    try {
      bytes = await readFile(resource.path, {
        maxBytes: MAX_RESOURCE_BYTES + 1,
      });
    } catch (error) {
      // A refusal by the host's own cap is a size problem, not a missing file;
      // the confined `readFile` marks it so both executors classify it alike.
      const refusedForSize =
        !!error &&
        typeof error === "object" &&
        (error as { reason?: unknown }).reason === "too-large";
      issues.push({
        severity: "error",
        kind: refusedForSize ? "resource-too-large" : "resource-missing",
        style: entry.id,
        target: resource.id,
        message: `resource '${resource.id}' (${resource.path}) ${
          refusedForSize ? "is too large to check" : "cannot be read"
        }: ${error instanceof Error ? error.message : String(error)}`,
      });
      continue;
    }

    if (bytes.byteLength > MAX_RESOURCE_BYTES) {
      issues.push({
        severity: "error",
        kind: "resource-too-large",
        style: entry.id,
        target: resource.id,
        message: `resource '${resource.id}' (${resource.path}) exceeds ${MAX_RESOURCE_BYTES} bytes`,
      });
      continue;
    }

    let data: unknown;
    try {
      const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      data = resource.format === "json" ? (JSON.parse(text) as unknown) : text;
    } catch (error) {
      issues.push({
        severity: "error",
        kind: "resource-invalid",
        style: entry.id,
        target: resource.id,
        message: `resource '${resource.id}' (${resource.path}) cannot be parsed as ${resource.format}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      });
      continue;
    }

    if (resource.validate) {
      const verdict = resource.validate(data);
      if (verdict !== true) {
        issues.push({
          severity: "error",
          kind: "resource-invalid",
          style: entry.id,
          target: resource.id,
          message: `resource '${resource.id}' (${resource.path}) did not pass validate(): ${
            typeof verdict === "string" ? verdict : "returned false"
          }`,
        });
      }
    }
  }

  return issues;
}

/**
 * Build the dependency report for a set of style directories.
 *
 * Errors make `deps` exit non-zero; a host can also call this to preflight an
 * install before a document is touched.
 */
export async function analyzeDependencies(
  stylePaths: readonly string[],
  options: DependencyIndexOptions = {},
): Promise<DependencyReport> {
  const { entries, failures } = await indexStyles(stylePaths, options);
  const issues: DependencyIssue[] = [];

  for (const failure of failures) {
    // A style that cannot be indexed is a directory problem, not a style id
    // one; the record says which, so the classification never depends on
    // message wording.
    issues.push({
      severity: "error",
      kind: failure.kind,
      message: `${failure.dir}: ${failure.message}`,
    });
  }

  for (const entry of entries.values()) {
    for (const dependency of entry.dependencies) {
      if (!entries.has(dependency)) {
        issues.push({
          severity: "error",
          kind: "missing-dependency",
          style: entry.id,
          target: dependency,
          message: `style '${entry.id}' depends on '${dependency}', which is not among the indexed style directories`,
        });
      }
    }
    issues.push(...(await checkResources(entry, options)));
  }

  for (const cycle of findCycles(entries)) {
    issues.push({
      severity: "error",
      kind: "cycle",
      target: cycle[0]!,
      message: `dependency cycle: ${cycle.join(" -> ")}`,
    });
  }

  for (const chain of findTooDeepChains(entries)) {
    issues.push({
      severity: "error",
      kind: "depth",
      target: chain[0]!,
      message: `call chain is ${chain.length} styles long, past the ${MAX_DELEGATION_DEPTH}-style limit: ${chain.join(
        " -> ",
      )}`,
    });
  }

  return {
    styles: [...entries.values()].map((entry) => ({
      id: entry.id,
      dir: entry.dir,
      title: entry.info.title ?? "",
      citationType: entry.info.citationType ?? "",
      dependencies: [...entry.dependencies],
      resources: entry.resources.map((resource) => ({
        id: resource.id,
        path: resource.path,
        format: resource.format,
      })),
    })),
    issues,
  };
}

export function dependencyReportHasErrors(report: DependencyReport): boolean {
  return report.issues.some((issue) => issue.severity === "error");
}
