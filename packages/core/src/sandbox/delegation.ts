/**
 * Style-to-style delegation: `STYLE_DEPENDENCIES` plus the `callStyle()` utility.
 *
 * The core never resolves an id by itself — a host capability (`resolveStyle`)
 * does — and it never owns the called style's context. What it does own is the
 * chain (so a cycle is refused before any queue is joined), the per-run budget,
 * the timeout and the failure model: every failure is a returned result with a
 * `reason`, plus one finding on the caller.
 *
 * Child instances are private to the parent that created them: a host's
 * top-level `A` and `B` can call each other without sharing a `generate()`
 * queue, because each parent caches its own child instance. A chain never
 * repeats an id, so those private queues cannot form a wait cycle either.
 */
import type {
  CitationContext,
  Style,
  StyleOptionValues,
  StyleResult,
} from "../types/style";
import type {
  CallStyleFailureReason,
  CallStyleResult,
} from "../types/styleUtils";
import type { StyleInstance } from "../messages";
import type { StyleMessage, StyleMessageReporter } from "../messages";
import type {
  ResolvedHost,
  ResolvedStyleSource,
  StyleHost,
  StyleHostCapabilities,
} from "../host";
import { errorMessageOf } from "./runtimeErrors";
import { normalizeCitationContexts } from "../validation/contexts";
import { isDeadlineError, withDeadline } from "./deadline";
import {
  DELEGATION_TIMEOUT_MS,
  MAX_DELEGATION_CALLS,
  MAX_DELEGATION_DEPTH,
} from "@banyan/style-contract";

/** What a child instance is created with; never part of the public options. */
export interface StyleCreateChildOptions {
  messageSink?: (message: StyleMessage) => void;
  generateTimeoutMs?: number;
  delegation: StyleDelegationOptions;
}

/**
 * Run-scoped state shared by every style in one top-level chain.
 *
 * Owned by the root instance's run: the budget, the deadline and the timeout
 * breaker are the same objects for the root and for every descendant.
 */
export interface DelegationRunState {
  /** Absolute deadline of the top-level run, in ms since the epoch. */
  deadline: number;
  /** `callStyle()` calls left in this run; the whole chain shares it. */
  budget: { calls: number };
  /** Ids whose call timed out in this run: fail fast instead of blocking again. */
  timedOut: Set<string>;
}

/**
 * Parameters the delegation module hands to `createStyle()` for a child
 * instance. Deliberately not part of the public `CreateStyleOptions`: only
 * `callStyle()` creates children.
 */
export interface StyleDelegationOptions {
  /** Ancestor ids, ending with the id this child was resolved by. */
  chain: string[];
  run: DelegationRunState;
  /** The instance's current run cancel hook; the parent calls it on timeout. */
  registerRunCancel?(cancel: (() => void) | null): void;
}

export interface DelegationRuntime {
  /** Ancestor ids plus this style's own id, once it is known. */
  readonly chain: string[];
  /** Record the style's own id after `INFO` is readable. */
  completeIdentity(styleId: string): void;
  /** Fill in what the declaration pass resolved. */
  configure(style: {
    styleName: string;
    citationType: Style["INFO"]["citationType"];
    dependencies: string[] | undefined;
  }): void;
  /** Reset the run state (root only) and hand out a fresh deadline. */
  beginRun(): void;
  /** The child instance's run cancel hook, if this instance is a delegate. */
  registerRunCancel(cancel: (() => void) | null): void;
  callStyle(
    id: unknown,
    contexts: unknown,
    optionValues: unknown,
  ): Promise<CallStyleResult>;
}

export interface DelegationRuntimeParams {
  host: () => ResolvedHost;
  messages: StyleMessageReporter;
  /** Options only present for a child instance created by `callStyle()`. */
  delegation?: StyleDelegationOptions;
  /** Async budget of one top-level generate, for the run deadline. */
  runTimeoutMs(): number;
  /** Creates a child style instance; `createStyle` supplies itself. */
  createChild(
    host: StyleHost,
    code: string,
    options: StyleCreateChildOptions,
  ): Promise<StyleInstance>;
}

type ChildResolution =
  | { ok: true; instance: StyleInstance; slot: ChildSlot }
  | { ok: false; reason: "unresolved" | "failed"; message: string };

interface ChildSlot {
  instance?: StyleInstance;
  creation?: Promise<ChildResolution>;
  cancel?: (() => void) | null;
}

/** Cap a host-supplied message so one failure cannot flood the finding budget. */
function truncate(text: string, limit = 300): string {
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

/**
 * Time kept back from the parent's budget so the caller can still run its own
 * fallback after an abandoned call. Without it, a child that consumed the whole
 * remainder would race the parent's own generate timeout.
 */
const FALLBACK_RESERVE_MS = 250;

/**
 * Chain label for a root style that declares no usable `INFO.id`.
 *
 * It keeps the root's depth slot without becoming a callable id: `callStyle()`
 * only accepts ids declared in `STYLE_DEPENDENCIES`, and this string is not a
 * valid one.
 */
const ROOT_CHAIN_PLACEHOLDER = "(root)";

export function createDelegationRuntime(
  params: DelegationRuntimeParams,
): DelegationRuntime {
  const isRoot = params.delegation === undefined;
  const chain: string[] = params.delegation ? [...params.delegation.chain] : [];
  const run: DelegationRunState = params.delegation?.run ?? {
    deadline: Number.POSITIVE_INFINITY,
    budget: { calls: MAX_DELEGATION_CALLS },
    timedOut: new Set<string>(),
  };
  // One cache per parent instance: a child instance belongs to exactly one
  // parent, so two hosts' top-level styles never share a generate queue.
  const children = new Map<string, ChildSlot>();

  let styleName = "unknown-style";
  let citationType: Style["INFO"]["citationType"] = "intext-citation";
  let declared = new Set<string>();

  /**
   * Time budget for one resolution step. `resolveStyle()` and the child's own
   * load are host work like any other: a host that never settles either must not
   * hold the caller past this point, because the caller can only use its
   * fallback once `callStyle()` returns. Capped by the run's remainder so a
   * resolution cannot borrow time the caller's own fallback needs.
   */
  const resolutionTimeout = (): number =>
    Math.min(DELEGATION_TIMEOUT_MS, run.deadline - Date.now());

  const report = (
    reason: CallStyleFailureReason,
    message: string,
    id: string,
  ): void => {
    params.messages.report({
      severity: "warning",
      source: "delegation",
      message,
      finding: {
        diagnosticId: `delegation.${reason}`,
        path: [id],
        data: { id, reason },
      },
    });
  };

  const fail = (
    reason: CallStyleFailureReason,
    message: string,
    id: string,
    reported = false,
  ): CallStyleResult => {
    if (!reported) report(reason, message, id);
    return { ok: false, reason, message };
  };

  /**
   * Build (or reuse) the private child instance for `id`.
   *
   * The caller races this against `resolutionTimeout()`: this function itself is
   * unbounded because the host call it awaits has no cancellation, and a
   * resolution that outlives its budget must be abandoned, not awaited.
   *
   * The resolved source's `readFile` *replaces* the parent's, so the child reads
   * its own assets and cannot reach the parent's directory. `assertReady` is not
   * inherited: a child may legitimately lack `readFile`, and the parent's
   * readiness gate would turn that into a load failure.
   */
  const ensureChild = async (id: string): Promise<ChildResolution> => {
    const existing = children.get(id);
    if (existing?.instance) {
      return { ok: true, instance: existing.instance, slot: existing };
    }
    if (existing?.creation) {
      return existing.creation;
    }

    const slot: ChildSlot = existing ?? {};
    children.set(id, slot);
    const resolveStyle = params.host().capabilities.resolveStyle;
    if (!resolveStyle) {
      children.delete(id);
      return {
        ok: false,
        reason: "unresolved",
        message: `the host does not provide the "resolveStyle" capability, so style '${id}' cannot be resolved`,
      };
    }

    slot.creation = (async (): Promise<ChildResolution> => {
      let source: ResolvedStyleSource | null;
      try {
        source = await resolveStyle(id);
      } catch (error) {
        children.delete(id);
        return {
          ok: false,
          reason: "unresolved",
          message: `resolveStyle('${id}') failed: ${truncate(errorMessageOf(error))}`,
        };
      }
      if (!source || typeof source.code !== "string") {
        children.delete(id);
        return {
          ok: false,
          reason: "unresolved",
          message: `the host did not resolve style '${id}'`,
        };
      }

      const parent = params.host();
      const capabilities: Partial<StyleHostCapabilities> = {
        ...parent.capabilities,
      };
      if (source.readFile) {
        capabilities.readFile = source.readFile;
      } else {
        delete capabilities.readFile;
      }
      const childHost: StyleHost = {
        runtime: parent.runtime,
        capabilities,
      };

      try {
        const childChain = [...chain, id];
        const instance = await params.createChild(childHost, source.code, {
          generateTimeoutMs: DELEGATION_TIMEOUT_MS,
          // A delegated style's findings belong to the caller's run: forward
          // them with `via` naming the chain, so a host can tell a child's
          // complaint from its own.
          messageSink: (message) => {
            if (message.severity === "trace") {
              return;
            }
            params.messages.report({
              severity: message.severity,
              source: message.source,
              message: message.message,
              detail: { ...message.detail, via: childChain },
              ...(message.finding ? { finding: message.finding } : {}),
            });
          },
          delegation: {
            chain: childChain,
            run,
            registerRunCancel: (cancel) => {
              slot.cancel = cancel;
            },
          },
        });
        slot.instance = instance;
        return { ok: true, instance, slot };
      } catch (error) {
        children.delete(id);
        return {
          ok: false,
          reason: "failed",
          message: `style '${id}' could not be loaded: ${truncate(
            errorMessageOf(error),
          )}`,
        };
      }
    })();

    return slot.creation;
  };

  const callStyle = async (
    idRaw: unknown,
    contextsRaw: unknown,
    optionValuesRaw: unknown,
  ): Promise<CallStyleResult> => {
    const id = typeof idRaw === "string" ? idRaw.trim() : "";
    if (!id || !declared.has(id)) {
      return fail(
        "undeclared",
        `callStyle('${id}'): '${id}' is not declared in STYLE_DEPENDENCIES`,
        id,
      );
    }
    // Cycle and depth are synchronous checks made *before* any instance or
    // queue is touched; joining a queue first is what turns a cycle into a
    // deadlock.
    if (chain.includes(id)) {
      return fail(
        "cycle",
        `callStyle('${id}'): '${id}' is already in the call chain (${[
          ...chain,
          id,
        ].join(" -> ")})`,
        id,
      );
    }
    if (chain.length >= MAX_DELEGATION_DEPTH) {
      return fail(
        "depth",
        `callStyle('${id}'): the call chain (${chain.join(
          " -> ",
        )}) is already ${MAX_DELEGATION_DEPTH} styles long`,
        id,
      );
    }
    if (run.timedOut.has(id)) {
      return fail(
        "timeout",
        `callStyle('${id}'): a previous call to '${id}' timed out in this run`,
        id,
      );
    }
    if (run.budget.calls <= 0) {
      return fail(
        "budget",
        `callStyle('${id}'): this run already used its ${MAX_DELEGATION_CALLS} delegation calls`,
        id,
      );
    }
    run.budget.calls -= 1;

    if (params.host().capabilities.resolveStyle === undefined) {
      return fail(
        "unresolved",
        `callStyle('${id}'): the host does not provide the "resolveStyle" capability`,
        id,
      );
    }

    let contexts: CitationContext[];
    try {
      contexts = normalizeCitationContexts(contextsRaw);
    } catch (error) {
      return fail(
        "failed",
        `callStyle('${id}'): unusable contexts: ${truncate(
          errorMessageOf(error),
        )}`,
        id,
      );
    }

    const resolveTimeoutMs = resolutionTimeout();
    if (!(resolveTimeoutMs > 0)) {
      run.timedOut.add(id);
      return fail(
        "timeout",
        `callStyle('${id}'): the parent run has no time left to resolve it`,
        id,
      );
    }

    let resolution: ChildResolution;
    try {
      resolution = await withDeadline(
        ensureChild(id),
        resolveTimeoutMs,
        `Style '${id}' was not resolved within ${resolveTimeoutMs} ms.`,
      );
    } catch (error) {
      // `ensureChild()` returns its own failures as results, so a rejection here
      // is the deadline (or a defect): both are results, never a throw.
      if (isDeadlineError(error)) {
        // The host call keeps running; drop the slot so no later call joins the
        // abandoned promise, and fail fast for the rest of this run.
        children.delete(id);
        run.timedOut.add(id);
        return fail(
          "timeout",
          `callStyle('${id}'): the host did not resolve and load it within ${resolveTimeoutMs} ms; it is skipped for the rest of this run`,
          id,
        );
      }
      return fail(
        "failed",
        `callStyle('${id}'): resolving the style failed: ${truncate(
          errorMessageOf(error),
        )}`,
        id,
      );
    }
    if (!resolution.ok) {
      return fail(
        resolution.reason,
        `callStyle('${id}'): ${resolution.message}`,
        id,
      );
    }

    const child = resolution.instance;
    const childCitationType = child.INFO?.citationType;
    if (childCitationType !== citationType) {
      return fail(
        "citation-type-mismatch",
        `callStyle('${id}'): style '${styleName}' is ${citationType}, but '${id}' is ${
          typeof childCitationType === "string" ? childCitationType : "unknown"
        }`,
        id,
      );
    }

    const optionValues =
      optionValuesRaw && typeof optionValuesRaw === "object"
        ? (optionValuesRaw as StyleOptionValues)
        : {};

    const remaining = run.deadline - Date.now();
    if (!(remaining > 0)) {
      run.timedOut.add(id);
      return fail(
        "timeout",
        `callStyle('${id}'): the parent run has no time left`,
        id,
      );
    }
    const timeoutMs = Math.min(DELEGATION_TIMEOUT_MS, remaining);

    let result: StyleResult;
    try {
      result = await withDeadline(
        child.generate(contexts, optionValues),
        timeoutMs,
        `Style '${id}' did not finish within ${timeoutMs} ms.`,
      );
    } catch (error) {
      const timedOut =
        isDeadlineError(error) ||
        (error as { code?: unknown } | null)?.code === "generate-timeout";
      if (timedOut) {
        // The sandbox promise chain cannot be interrupted. Release the child's
        // queue, drop the instance and fail fast for the rest of the run.
        resolution.slot.cancel?.();
        resolution.slot.cancel = null;
        children.delete(id);
        run.timedOut.add(id);
        return fail(
          "timeout",
          `callStyle('${id}'): the style did not finish within ${timeoutMs} ms; it is skipped for the rest of this run`,
          id,
        );
      }
      return fail(
        "failed",
        `callStyle('${id}'): the style's generate() failed: ${truncate(
          errorMessageOf(error),
        )}`,
        id,
      );
    }

    return {
      ok: true,
      citations: result.citations.map((citation) => citation.content),
      bibliography: result.bibliography,
    };
  };

  return {
    get chain() {
      return chain;
    },
    completeIdentity(styleId: string) {
      if (!isRoot) {
        // A child's chain already ends with the id it was resolved by. The
        // requested id is what cycle detection compares, so an `INFO.id` that
        // differs from it must not be appended a second time.
        return;
      }
      // The root occupies one slot even without a usable `INFO.id`: the depth
      // limit counts styles, and "-1 because the root had no id" would let a
      // chain run one style deeper than documented. The placeholder can never
      // match a requested id, so it cannot fake a cycle either.
      const own = styleId || ROOT_CHAIN_PLACEHOLDER;
      if (!chain.includes(own)) {
        chain.push(own);
      }
    },
    configure({ styleName: name, citationType: type, dependencies }) {
      styleName = name;
      citationType = type;
      declared = new Set(dependencies ?? []);
    },
    beginRun() {
      if (!isRoot) {
        return;
      }
      run.budget.calls = MAX_DELEGATION_CALLS;
      run.timedOut.clear();
      run.deadline =
        Date.now() + Math.max(1, params.runTimeoutMs() - FALLBACK_RESERVE_MS);
    },
    registerRunCancel(cancel) {
      params.delegation?.registerRunCancel?.(cancel);
    },
    callStyle,
  };
}
