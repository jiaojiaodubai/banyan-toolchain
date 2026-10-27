/**
 * The two things the core needs from a host, and nothing else.
 *
 * The core never touches host globals: it generates source fragments, bridges
 * values and validates outputs, while every execution, isolation and I/O
 * decision stays with the caller. Collecting those parts in one `StyleHost`
 * object makes "the host is assembled" the same thing as "the parts were
 * handed over", so install-order rules become structural (see
 * `dev/hostIntegration.md`).
 */
import type { ScriptItem } from "./types/style";
import type { ReadOptions } from "./types/styleUtils";
import { createBanyanRuntimeError } from "./sandbox/runtimeErrors";

/**
 * Minimal structural view of parsed HTML. A DOM element satisfies it as is, so
 * hosts with a DOM do not need an adapter, and the core needs no DOM lib.
 */
export interface HtmlNodeLike {
  readonly nodeType: number;
  readonly nodeValue?: string | null;
  readonly tagName?: string;
  readonly textContent?: string | null;
  readonly childNodes: ArrayLike<HtmlNodeLike>;
  getAttribute?(name: string): string | null;
}

export type HtmlRootLike = HtmlNodeLike;

export interface EvaluateOptions {
  filename?: string;
  /**
   * Best-effort synchronous budget. Hosts without one (Gecko) ignore it; the
   * core still enforces the asynchronous generate timeout by itself.
   */
  timeoutMs?: number;
}

/**
 * Execution primitives of one isolated context. The core generates the source
 * it evaluates and the values it exposes; the host decides isolation, realm
 * semantics and the permission model.
 */
export interface SandboxContext {
  /** Evaluate a core-generated source fragment and return the host-side value. */
  evaluate(source: string, options?: EvaluateOptions): unknown;
  /** Expose a host value to the context (functions become callable there). */
  defineGlobal(name: string, value: unknown): void;
  /** Read a context global, bridged to the host. */
  readGlobal(name: string): unknown;
  deleteGlobal(name: string): void;
  /** Create an object owned by the context (export container, host bridge). */
  createObject(): Record<string, unknown>;
  /**
   * Attach a host callback to a context-owned object, so context code can call
   * it. The host decides the realm semantics: Gecko exports the function into
   * the sandbox, a `vm` host wraps it in a realm-side closure.
   */
  defineFunction(
    target: Record<string, unknown>,
    name: string,
    fn: (...args: unknown[]) => unknown,
  ): void;
  /**
   * Run a host task later, outside the current sandbox execution.
   *
   * Callbacks that fire while the sandbox is still running must not bridge
   * values straight back: Gecko clones a value on a host task (its own main
   * thread queue), while a `vm` host can use a microtask.
   */
  deferHostTask(callback: () => void): void;
  /** Host value -> context value; cross-boundary semantics are the host's. */
  importValue<T>(value: T): T;
  /**
   * Read a context value on the host: functions stay callable and nothing is
   * copied. The result still belongs to the context, so use `cloneToHost`
   * before keeping or forwarding the data.
   */
  exportValue<T>(value: T): T;
  /**
   * Copy a context value into the host realm, data only: functions are not
   * carried over. Predicates are therefore read through `exportValue` and
   * re-attached by the caller as host wrappers.
   */
  cloneToHost<T>(value: T): T;
}

export interface SandboxRuntime {
  createContext(options?: { name?: string }): SandboxContext;
}

/**
 * Capabilities every host provides: the three that output equivalence depends
 * on. A missing one is reported at the point of use (`requireCapability`)
 * instead of being approximated.
 */
export interface RequiredHostCapabilities {
  /** Parse an HTML fragment; the core asks whenever `content` carries markup. */
  parseHtml(html: string): HtmlRootLike | null;
  /** Read a file from the host's style directory. */
  readFile(relPath: string, options?: ReadOptions): Promise<Uint8Array>;
  /** Resolve items related to `item` through the multilingual relation. */
  resolveMultilingualItems(item: ScriptItem): Promise<ScriptItem[]>;
}

/**
 * The capability set of a host. Zotero schema data is the core's own concern
 * and never part of this contract, so every host consults the same tables
 * (`dev/hostIntegration.md`).
 */
export type StyleHostCapabilities = RequiredHostCapabilities;

/** Keys of the required set, kept in step with the interface by this type. */
const REQUIRED_CAPABILITY_KEYS: Record<keyof RequiredHostCapabilities, true> = {
  parseHtml: true,
  readFile: true,
  resolveMultilingualItems: true,
};

/** Capabilities a conforming host has to provide (see `dev/hostIntegration.md`). */
export const REQUIRED_HOST_CAPABILITIES = Object.keys(
  REQUIRED_CAPABILITY_KEYS,
) as Array<keyof RequiredHostCapabilities>;

/**
 * Report every missing required capability at once.
 *
 * `createStyle` deliberately does not preflight capabilities: a missing one is
 * reported when the style actually needs it, which keeps the check free for a
 * complete host (`dev/hostIntegration.md`, "Capabilities"). A host that would
 * rather assert completeness while assembling — `assertReady` is the natural
 * place — calls this instead of listing the capabilities itself.
 */
export function assertHostCapabilities(
  capabilities: Partial<StyleHostCapabilities> | undefined,
): void {
  const missing = REQUIRED_HOST_CAPABILITIES.filter(
    (name) => !capabilities?.[name],
  );
  if (!missing.length) {
    return;
  }
  const listed = missing.map((name) => `"${name}"`).join(", ");
  throw createBanyanRuntimeError(
    `The host does not provide the ${listed} capabilit${missing.length === 1 ? "y" : "ies"}.`,
    { code: "host-capability" },
  );
}

/**
 * Take a capability the core cannot do without.
 *
 * A missing capability has no acceptable substitute — approximating it would
 * make the same style render differently per host — so it fails here, naming
 * what the host has to provide.
 */
export function requireCapability<T>(
  capability: T | undefined,
  message: string,
): T {
  if (!capability) {
    throw createBanyanRuntimeError(message, {
      code: "host-capability",
    });
  }
  return capability;
}

/**
 * Values a host bridges in, or that a style declares, reach the core as
 * `unknown`. A callable one stays callable — and stays typed, because
 * `typeof value === "function"` narrows to `Function`, which no signature
 * accepts.
 */
export function isSandboxCallable(
  value: unknown,
): value is (...args: unknown[]) => unknown {
  return typeof value === "function";
}

/**
 * One access path to a host. `createStyle` takes this object as its first
 * argument and reads capabilities through it on every use, so a binding may
 * build the host first and fill in parts later, as long as everything is ready
 * before the first call.
 */
export interface StyleHost {
  runtime: SandboxRuntime;
  /**
   * What the host can do for the core. The contract requires all three fields,
   * but a binding may assemble the object in stages; the core reads through it
   * on every use, so a capability attached before the first call is enough.
   * `assertReady` is the place to fail fast, with
   * `assertHostCapabilities()` listing what is missing.
   */
  capabilities?: Partial<StyleHostCapabilities>;
  /**
   * Optional readiness gate, called once before the first context is created.
   * A binding that installs host globals asserts that here (naming whatever is
   * missing), so a setup mistake surfaces at the call site instead of turning
   * into an obscure ReferenceError halfway through style execution.
   */
  assertReady?(): void;
}

/** Host parts with defaults applied; created once per style instance. */
export interface ResolvedHost {
  readonly runtime: SandboxRuntime;
  readonly capabilities: Partial<StyleHostCapabilities>;
}

const EMPTY_CAPABILITIES: Partial<StyleHostCapabilities> = {};

export function resolveHost(host: StyleHost): ResolvedHost {
  return {
    runtime: host.runtime,
    // Read through on every access instead of snapshotting: a binding may build
    // the host first and fill capabilities in later (before the first call, as
    // `StyleHost` requires), and that has to work whether it mutates the
    // capabilities object or replaces it.
    get capabilities() {
      return host.capabilities ?? EMPTY_CAPABILITIES;
    },
  };
}
