/**
 * Realm helpers for the `node:vm` sandbox runtime.
 *
 * Data crosses the boundary as JSON: host values are rebuilt **inside** the
 * context (realm isolation), while `cloneToHost` parses the serialized text in
 * the host realm so a clone never keeps a sandbox prototype. Host callbacks are
 * wrapped in realm-side closures so style code cannot reach the host prototype
 * chain, and binary values keep their type by being rebuilt with the realm's own
 * constructors.
 *
 * `node:vm` isolates prototypes, not compute or data — see
 * [docs/security.md](../../docs/security.md).
 */
import vm from "node:vm";

type VmGlobal = Record<string, unknown>;

/** Typed arrays the realm exposes, keyed by their `Object.prototype.toString` tag. */
type RealmTypedArrayConstructor = new (buffer: ArrayBuffer) => ArrayBufferView;

export type RealmHelpers = {
  createObject: () => Record<string, unknown>;
  wrapFunction: (
    fn: (...args: unknown[]) => unknown,
  ) => (...args: unknown[]) => unknown;
  parse: (json: string) => unknown;
  stringify: (value: unknown) => string | undefined;
  isBinary: (value: unknown) => boolean;
  copyBinary: (value: unknown) => unknown;
};

export function createRealmHelpers(context: vm.Context): RealmHelpers {
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
    ) as (value: unknown) => string | undefined,
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

export type { VmGlobal };
