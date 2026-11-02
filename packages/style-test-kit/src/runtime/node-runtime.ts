/**
 * The testkit's `SandboxRuntime`: `node:vm` + realm isolation, implementing the
 * core's `SandboxRuntime` contract.
 *
 * Differences from a browser/Gecko host runtime, on purpose and declared in
 * [docs/security.md](../../docs/security.md):
 *
 * - `eval` / `new Function` are disabled by default
 *   (`codeGeneration: { strings: false }`);
 * - every `evaluate` carries a synchronous timeout budget, so a sync dead loop
 *   in a style surfaces as an error instead of hanging the CLI.
 */
import vm from "node:vm";
import type {
  EvaluateOptions,
  SandboxContext,
  SandboxRuntime,
} from "../banyan";
import { createRealmHelpers, type RealmHelpers, type VmGlobal } from "./realm";

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
    // context-owned objects instead of host-realm ones.
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
  /** Default synchronous budget (ms) for every `evaluate` call. */
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
