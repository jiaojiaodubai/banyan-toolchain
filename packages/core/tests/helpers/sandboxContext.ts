import type { SandboxContext } from "../../src/host";

/** Data-only copy, like a real `cloneToHost`: functions do not survive. */
function cloneData<T>(value: T): T {
  if (value === undefined) {
    return value;
  }
  return JSON.parse(JSON.stringify(value)) as T;
}

/**
 * Contract-shaped sandbox context for validator tests.
 *
 * `cloneToHost` is data-only and `importValue` hands over a fresh copy, as the
 * real hosts do; `exportValue` keeps callables so predicates can be re-attached
 * as host wrappers. A validator that crosses a predicate the wrong way, or that
 * relies on a function surviving `cloneToHost`, fails here instead of passing.
 */
export function createIdentitySandboxContext(
  evaluate?: (source: string) => unknown,
): SandboxContext {
  const globals = new Map<string, unknown>();
  return {
    evaluate: (source) => evaluate?.(source),
    defineGlobal: (name, value) => {
      globals.set(name, value);
    },
    readGlobal: (name) => globals.get(name),
    deleteGlobal: (name) => {
      globals.delete(name);
    },
    createObject: () => ({}),
    defineFunction: (target, name, fn) => {
      (target as Record<string, unknown>)[name] = fn;
    },
    deferHostTask: (callback) => callback(),
    importValue: (value) => cloneData(value),
    exportValue: (value) => value,
    cloneToHost: (value) => cloneData(value),
  };
}
