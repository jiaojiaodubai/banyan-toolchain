/**
 * What a run reports.
 *
 * A run produces records; failures travel as exceptions instead, and
 * `code` says which part failed. Severity describes the record:
 *
 * - `trace` — a stream: budgeted per run and never kept.
 * - `info` / `warning` / `error` — findings: kept as data, deduplicated and
 *   capped, with one notice when further findings are dropped.
 *
 * The core never prints: a caller that wants records as they happen passes a
 * sink, and findings are readable afterwards through `style.diagnostics`.
 */
import type { RuntimeCode } from "./sandbox/runtimeErrors";
import type { ContractFinding } from "@banyan/style-contract";
import type {
  CitationContext,
  Style,
  StyleOptionValues,
  StyleResult,
} from "./types/style";

export type StyleSeverity = "trace" | "info" | "warning" | "error";

/** Reserved `source` values; a subsystem may also use its own name. */
export type StyleMessageSource = "style" | "host" | "core";

/** Top-level style export a declaration finding can point at. */
export type StyleDeclarationExport =
  | "STYLE_OPTIONS"
  | "CITATION_PARAMS"
  | "CITE_PARAMS"
  | "ITEM_FIELD_PRESETS"
  | "ITEM_FIELD_VALIDATORS";

/**
 * Machine-readable facts about one record.
 *
 * `message` stays the human line; `detail` is what a host groups, filters, or
 * navigates by without parsing that line. The core fills the keys it owns and
 * leaves the rest open to hosts.
 */
export interface StyleDeclarationLocation {
  /** The top-level export that owns the declaration. */
  export: StyleDeclarationExport;
  /** Parameter/preset id, when the declaration has one. */
  id?: string;
  /** Zero-based entry index in the exported array. */
  index?: number;
  /** List-field id inside a list parameter. */
  field?: string;
  /** Zero-based index of a list field inside its `fields` array. */
  fieldIndex?: number;
  /** `ITEM_FIELD_VALIDATORS` group (a Zotero item type). */
  group?: string;
}

export interface StyleMessageDetail {
  /** Style identity, present once `INFO` is readable. */
  style?: { id?: string; title?: string };
  /**
   * The declaration the finding belongs to. `export` is present on every
   * finding the core attributes; inner scopes add `id`/`field` as they narrow.
   */
  declaration?: StyleDeclarationLocation;
  /** Hosts may add their own facts; the keys above are the core's own. */
  [key: string]: unknown;
}

/**
 * A scope's addition to `detail`: the outer scope supplies `export`, while an
 * inner scope narrows it with `id`/`field` and must not be able to drop it.
 * Only `withDetail()` consumes this shape; records carry `StyleMessageDetail`.
 */
export interface StyleMessageDetailPatch {
  style?: { id?: string; title?: string };
  declaration?: Partial<StyleDeclarationLocation>;
  [key: string]: unknown;
}

export interface StyleMessage {
  severity: StyleSeverity;
  /** Who produced it: `style` (author code), `host`, `core`, or a subsystem. */
  source: string;
  /** What the run was doing (see `RuntimeCode`). */
  code: RuntimeCode;
  /** One line, ready to be shown as is. */
  message: string;
  /** Values a host may render instead of parsing `message` (see `StyleMessageDetail`). */
  detail?: StyleMessageDetail;
  /**
   * Executor-neutral finding identity. `code` still says which run phase
   * produced the record; this says which declaration rule it violated.
   */
  finding?: ContractFinding;
}

/** A message before the reporter fills in the code. */
export type StyleMessageInput = Omit<StyleMessage, "code">;

export type StyleMessageSink = (message: StyleMessage) => void;

/** Severities a caller keeps: `trace` is a stream, the rest are findings. */
export type StyleDiagnosticLevel = Exclude<StyleSeverity, "trace">;

export type StyleDiagnostic = StyleMessage & { severity: StyleDiagnosticLevel };

export type StyleDiagnostics = StyleDiagnostic[];

/**
 * Findings one style keeps. One additional entry may be the truncation notice
 * once the cap is reached, so `diagnostics.length` can be one larger.
 */
export const MAX_DIAGNOSTICS = 200;

/** Trace lines one run may emit before the rest is suppressed. */
export const MAX_TRACE_LINES_PER_RUN = 1_000;

export interface StyleMessageReporter {
  /**
   * Code the next message is attributed to: the current run while one is open,
   * otherwise the last run that settled (load findings before the first run).
   */
  readonly code: RuntimeCode;
  /**
   * Load findings plus the latest generate run's, deduplicated by
   * severity/source/code/message/detail and capped at `MAX_DIAGNOSTICS`, plus a
   * one-time truncation notice when more arrive. A generate run replaces its
   * own previous findings and keeps the load ones.
   *
   * The array is live and stable by reference. When a run starts, its previous
   * findings are removed before the new ones arrive, so during a run the array
   * can be missing that code's entries; read it after the generate promise
   * settles for the complete view.
   */
  readonly diagnostics: readonly StyleDiagnostic[];
  /** Send one message: to the sink, and to `diagnostics` when it is a finding. */
  report(input: StyleMessageInput): void;
  /**
   * Start a run: attribute messages to `code`, drop the findings of the previous
   * run with the same code, and give traces a fresh budget. Returns the restore
   * function (idempotent).
   */
  beginRun(code: RuntimeCode): () => void;
}

/**
 * `createStyle()` result: the style contract plus what its runs reported.
 * `diagnostics` is a host-side view, not something a style exports.
 *
 * Unlike an author script's `generate` (which may be synchronous), the
 * host-side entry point always returns a promise: the bridge settles the
 * style's sync or async result through the host realm either way.
 */
export interface StyleInstance extends Omit<Style, "generate"> {
  generate(
    contexts: CitationContext[],
    options?: StyleOptionValues,
  ): Promise<StyleResult>;
  readonly diagnostics: readonly StyleDiagnostic[];
}

/** Stable keys for detail JSON cannot represent, so bad values stay distinct. */
const unserializableDetailIds = new WeakMap<object, number>();
let nextUnserializableDetailId = 0;

/** A finding's detail is part of its identity, but a bad value must not throw. */
function detailKey(detail: StyleMessageDetail | undefined): string {
  if (!detail) return "";
  try {
    const serialized = JSON.stringify(detail);
    if (serialized !== undefined) return serialized;
  } catch {
    // Fall through to the identity-backed key.
  }
  let id = unserializableDetailIds.get(detail);
  if (id === undefined) {
    id = nextUnserializableDetailId;
    nextUnserializableDetailId += 1;
    unserializableDetailIds.set(detail, id);
  }
  return `unserializable:${id}`;
}

/**
 * Detail keys whose value is an object another scope may extend. A new nested
 * key must be added here, or the shallow spread below would replace it whole.
 */
const NESTED_DETAIL_KEYS = ["style", "declaration"] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Merge two detail records, keeping the nested style/declaration objects. */
function mergeDetail(
  base: StyleMessageDetailPatch | undefined,
  extra: StyleMessageDetailPatch | undefined,
): StyleMessageDetailPatch | undefined {
  if (!base) return extra;
  if (!extra) return base;
  const merged: StyleMessageDetailPatch = { ...base, ...extra };
  for (const key of NESTED_DETAIL_KEYS) {
    const baseValue = base[key];
    const extraValue = extra[key];
    if (isRecord(baseValue) && isRecord(extraValue)) {
      merged[key] = { ...baseValue, ...extraValue };
    }
  }
  return merged;
}

/** Attach declaration/group facts to every record a subsystem reports. */
export function withDetail(
  messages: StyleMessageReporter,
  detail: StyleMessageDetailPatch,
): StyleMessageReporter {
  return {
    get code() {
      return messages.code;
    },
    get diagnostics() {
      return messages.diagnostics;
    },
    report(input) {
      const merged = mergeDetail(detail, input.detail);
      messages.report(
        merged
          ? // Every `withDetail()` chain starts at a scope that supplies
            // `declaration.export`; the inner patch may only narrow it.
            { ...input, detail: merged as StyleMessageDetail }
          : input,
      );
    },
    beginRun(runCode) {
      return messages.beginRun(runCode);
    },
  };
}

export function createStyleMessageReporter(
  sink?: StyleMessageSink,
  /**
   * Facts shared by every record, read when a record is reported. The core
   * uses it for the style identity once `INFO` has been copied to the host.
   */
  baseDetail?: () => StyleMessageDetail | undefined,
): StyleMessageReporter {
  // One array for the instance's lifetime: `createStyle` hands this reference
  // over, so a caller that holds it sees each run's settlement.
  const diagnostics: StyleDiagnostic[] = [];
  const seen = new Set<string>();
  let code: RuntimeCode = "style-load";
  // Code of the one truncation notice, or null while there is room again. It
  // follows the run that filled the cap, so a later run can report its own.
  let overflowNoticeCode: RuntimeCode | null = null;
  // Set when a run settles: a style's dangling async work can still report
  // afterwards, and those findings belong to the run that produced them, not to
  // a new load phase. The next `beginRun` clears it.
  let closedRunCode: RuntimeCode | null = null;
  // The load phase is a run too: its trace output is budgeted from the start,
  // and `beginRun` saves/restores this budget around a generate run.
  let traceBudget: { lines: number; truncated: boolean } = {
    lines: 0,
    truncated: false,
  };

  /** The code a message is filed under right now. */
  const attributedCode = (): RuntimeCode =>
    code === "style-load" && closedRunCode ? closedRunCode : code;

  const keyOf = (message: StyleDiagnostic): string =>
    `${message.severity}\u0000${message.source}\u0000${message.code}\u0000${message.message}\u0000${detailKey(
      message.detail,
    )}\u0000${message.finding ? JSON.stringify(message.finding) : ""}`;

  /** Forget one code's findings: a new run replaces its own, not the load's. */
  const dropCode = (dropped: RuntimeCode): void => {
    if (!diagnostics.some((message) => message.code === dropped)) {
      return;
    }
    for (let index = diagnostics.length - 1; index >= 0; index -= 1) {
      if (diagnostics[index]?.code === dropped) {
        diagnostics.splice(index, 1);
      }
    }
    if (overflowNoticeCode === dropped) {
      overflowNoticeCode = null;
    }
    seen.clear();
    for (const message of diagnostics) {
      seen.add(keyOf(message));
    }
  };

  /** One clear signal that findings were dropped, instead of a silent cut. */
  const reportOverflow = (noticeCode: RuntimeCode): void => {
    if (overflowNoticeCode !== null) {
      return;
    }
    overflowNoticeCode = noticeCode;
    const notice: StyleDiagnostic = {
      severity: "warning",
      source: "core",
      code: noticeCode,
      message: `Findings exceeded ${MAX_DIAGNOSTICS}; further findings are suppressed.`,
    };
    diagnostics.push(notice);
    seen.add(keyOf(notice));
    emit(notice);
  };

  const emit = (message: StyleMessage): void => {
    try {
      sink?.(message);
    } catch {
      // A sink must not break the run it reports on.
    }
  };

  const report = (input: StyleMessageInput): void => {
    // `baseDetail()` and `input.detail` are both complete records; `mergeDetail`
    // accepts patches so inner scopes can narrow a declaration.
    const detail = mergeDetail(baseDetail?.(), input.detail) as
      StyleMessageDetail | undefined;
    const record: StyleMessageInput = detail ? { ...input, detail } : input;
    if (record.severity === "trace") {
      if (traceBudget.lines >= MAX_TRACE_LINES_PER_RUN) {
        if (!traceBudget.truncated) {
          traceBudget.truncated = true;
          report({
            severity: "warning",
            source: "core",
            message: `Trace output exceeded ${MAX_TRACE_LINES_PER_RUN} lines; further lines are suppressed.`,
          });
        }
        return;
      }
      traceBudget.lines += 1;
      emit({ ...record, code: attributedCode() });
      return;
    }

    const message: StyleDiagnostic = {
      ...record,
      severity: record.severity,
      code: attributedCode(),
    };
    const key = keyOf(message);
    if (!seen.has(key)) {
      if (diagnostics.length < MAX_DIAGNOSTICS) {
        seen.add(key);
        diagnostics.push(message);
      } else {
        reportOverflow(message.code);
      }
    }
    emit(message);
  };

  return {
    get code() {
      return attributedCode();
    },
    get diagnostics() {
      return diagnostics;
    },
    report,
    beginRun(runCode: RuntimeCode): () => void {
      const previousCode = code;
      const previousBudget = traceBudget;
      code = runCode;
      closedRunCode = null;
      traceBudget = { lines: 0, truncated: false };
      dropCode(runCode);
      let restored = false;
      return () => {
        if (restored) {
          return;
        }
        restored = true;
        code = previousCode;
        closedRunCode = runCode;
        traceBudget = previousBudget;
      };
    },
  };
}
