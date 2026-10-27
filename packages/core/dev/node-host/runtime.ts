/**
 * Node host binding for development-time verification (`node:vm` runtime plus
 * `createNodeHost()`).
 *
 * This file is **not** part of the published core and no host imports it: it
 * lives under `dev/` so the core can be exercised end to end while the API
 * settles, and it is kept roughly in sync with `dev/hostIntegration.md`.
 *
 * A production Node host adds DOM (`linkedom`), RDF relations and process-level
 * isolation; `node:vm` is a correctness host, not a security boundary.
 *
 * Run the dev-side contract tests with:
 *   node --import tsx ./node_modules/mocha/bin/mocha.js --timeout 10000 "dev/node-host/*.test.ts"
 */
import vm from "node:vm";
import type {
  EvaluateOptions,
  SandboxContext,
  SandboxRuntime,
  StyleHost,
  StyleHostCapabilities,
} from "../../src/host";

type VmGlobal = Record<string, unknown>;

type RealmHelpers = {
  createObject: () => Record<string, unknown>;
  wrapFunction: (
    fn: (...args: unknown[]) => unknown,
  ) => (...args: unknown[]) => unknown;
  parse: (json: string) => unknown;
  stringify: (value: unknown) => string;
  isBinary: (value: unknown) => boolean;
  copyBinary: (value: unknown) => unknown;
};

/** Typed arrays the realm exposes, keyed by their `Object.prototype.toString` tag. */
type RealmTypedArrayConstructor = new (buffer: ArrayBuffer) => ArrayBufferView;

function createRealmHelpers(context: vm.Context): RealmHelpers {
  const RealmUint8Array = vm.runInContext(
    "Uint8Array",
    context,
  ) as Uint8ArrayConstructor;
  const RealmArrayBuffer = vm.runInContext(
    "ArrayBuffer",
    context,
  ) as ArrayBufferConstructor;
  const RealmDataView = vm.runInContext(
    "DataView",
    context,
  ) as DataViewConstructor;
  const realmTypedArrays = vm.runInContext(
    `({
      Uint8Array, Uint8ClampedArray, Int8Array, Uint16Array, Int16Array,
      Uint32Array, Int32Array, Float32Array, Float64Array,
      BigInt64Array, BigUint64Array
    })`,
    context,
  ) as Record<string, RealmTypedArrayConstructor>;

  return {
    createObject: vm.runInContext("(() => ({}))", context) as () => Record<
      string,
      unknown
    >,
    wrapFunction: vm.runInContext(
      "((fn) => (...args) => fn(...args))",
      context,
    ) as (
      fn: (...args: unknown[]) => unknown,
    ) => (...args: unknown[]) => unknown,
    parse: vm.runInContext("((json) => JSON.parse(json))", context) as (
      json: string,
    ) => unknown,
    // Runs inside the context, so a context-owned value is reduced to a
    // primitive the host can safely parse back.
    stringify: vm.runInContext(
      "((value) => JSON.stringify(value))",
      context,
    ) as (value: unknown) => string,
    isBinary: (value) =>
      value instanceof ArrayBuffer || ArrayBuffer.isView(value),
    // Rebuilds the value with the *realm's* constructors over a realm-owned
    // buffer, so the style still sees a typed array rather than a plain object.
    copyBinary: (value) => {
      const bytes = new Uint8Array(
        value instanceof ArrayBuffer
          ? value
          : (value as ArrayBufferView).buffer,
        value instanceof ArrayBuffer
          ? 0
          : (value as ArrayBufferView).byteOffset,
        value instanceof ArrayBuffer
          ? value.byteLength
          : (value as ArrayBufferView).byteLength,
      );
      const buffer = new RealmArrayBuffer(bytes.byteLength);
      new RealmUint8Array(buffer).set(bytes);

      if (value instanceof ArrayBuffer) {
        return buffer;
      }
      if (value instanceof DataView) {
        return new RealmDataView(buffer);
      }

      const tag = Object.prototype.toString.call(value);
      const name = tag.slice("[object ".length, -1);
      const RealmConstructor = realmTypedArrays[name];
      if (!RealmConstructor) {
        throw new Error(
          `The Node sandbox cannot copy ${name} into the style context.`,
        );
      }
      return new RealmConstructor(buffer);
    },
  };
}

class NodeSandboxContext implements SandboxContext {
  private readonly helpers: RealmHelpers;

  constructor(
    private readonly global: VmGlobal,
    private readonly context: vm.Context,
    private readonly timeoutMs?: number,
  ) {
    this.helpers = createRealmHelpers(context);
  }

  evaluate(source: string, options?: EvaluateOptions): unknown {
    return vm.runInContext(source, this.context, {
      filename: options?.filename ?? "banyan-style.js",
      timeout: options?.timeoutMs ?? this.timeoutMs,
    });
  }

  defineGlobal(name: string, value: unknown): void {
    this.global[name] = value;
  }

  readGlobal(name: string): unknown {
    return this.global[name];
  }

  deleteGlobal(name: string): void {
    delete this.global[name];
  }

  createObject(): Record<string, unknown> {
    return this.helpers.createObject();
  }

  defineFunction(
    target: Record<string, unknown>,
    name: string,
    fn: (...args: unknown[]) => unknown,
  ): void {
    // Wrapping in the realm keeps `fn.constructor` out of reach of style code.
    target[name] = this.helpers.wrapFunction(fn);
  }

  deferHostTask(callback: () => void): void {
    queueMicrotask(callback);
  }

  importValue<T>(value: T): T {
    // Binary keeps its type: `readBytes()` promises a `Uint8Array`, and a JSON
    // round-trip would hand the style `{ "0": 65 }` instead. Everything else
    // crosses as data: a JSON round-trip inside the context yields
    // context-owned objects instead of host-realm ones. That also means this
    // development binding cannot carry `BigInt`, `undefined`, functions or
    // cycles; a host that needs them defines its own bridge semantics.
    if (this.helpers.isBinary(value)) {
      return this.helpers.copyBinary(value) as T;
    }
    return this.helpers.parse(JSON.stringify(value ?? null)) as T;
  }

  exportValue<T>(value: T): T {
    return value;
  }

  cloneToHost<T>(value: T): T {
    // `JSON.stringify(undefined)` is not valid JSON text; a generate() that
    // returns nothing must reach the normalizer as `undefined` so it can report
    // `generate-output`, not fail inside the host bridge.
    if (value === undefined) {
      return value;
    }
    const serialized = this.helpers.stringify(value);
    if (serialized === undefined) {
      return value;
    }
    // Parse on the host side: `JSON.parse` inside the context would rebuild a
    // context-owned object and hand it back as if it were host data. The
    // serialized text is the only thing that crosses.
    return JSON.parse(serialized) as T;
  }
}

export interface NodeSandboxRuntimeOptions {
  /** Default synchronous budget for every `evaluate` call. */
  timeoutMs?: number;
  /** Allow `eval` / `new Function` inside the sandbox (off by default). */
  allowCodeGeneration?: boolean;
}

export function createNodeSandboxRuntime(
  options: NodeSandboxRuntimeOptions = {},
): SandboxRuntime {
  return {
    createContext(contextOptions?: { name?: string }): SandboxContext {
      const global: VmGlobal = {};
      if (contextOptions?.name) {
        global.__banyanHostName__ = contextOptions.name;
      }
      const context = vm.createContext(global, {
        name: contextOptions?.name ?? "banyan-style",
        codeGeneration: {
          strings: options.allowCodeGeneration === true,
          wasm: false,
        },
      });
      return new NodeSandboxContext(global, context, options.timeoutMs);
    },
  };
}

/**
 * Assemble a Node host: runtime plus whatever capabilities the caller has.
 *
 * The factory is the ordering guarantee — runtime and capabilities both exist
 * before the host is returned, and there is nothing left to install afterwards.
 *
 * Development-time host, so the parameter stays partial on purpose: the contract
 * tests assemble deliberately incomplete hosts to check that a missing
 * capability is reported instead of approximated.
 */
export function createNodeHost(
  capabilities: Partial<StyleHostCapabilities> = {},
  options: NodeSandboxRuntimeOptions = {},
): StyleHost {
  const runtime = createNodeSandboxRuntime(options);
  return { runtime, capabilities };
}
