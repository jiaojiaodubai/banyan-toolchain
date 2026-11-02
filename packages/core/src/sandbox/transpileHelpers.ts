/**
 * Transpile-helper ledger.
 *
 * Function bodies that reach the sandbox are serialized from the *host* bundle
 * (`Function.prototype.toString`), so a toolchain that rewrites functions can
 * leave references to its own helpers behind: esbuild emits `__name` when it
 * keeps names, and tsx enables that. The sandbox has no such helpers, and a
 * missing one fails with a bare `ReferenceError` deep inside style execution.
 *
 * The core owns both halves of the answer:
 * - a fixed ledger, installed idempotently before any generated source runs;
 * - a generation-time scan of every serialized fragment, so an unknown helper
 *   fails loudly at creation time with the helper's name in the message.
 *
 * The ledger carries what the toolchains actually leave behind, not everything
 * a bundler can emit: object spread, class fields and async/await are native at
 * the targets in use (`firefox115`, ES2022), CJS interop helpers live at module
 * scope and never inside a serialized function body, and `keepNames` is only
 * enabled by the toolchains that opt into it. `dev/node-host/helperLedger.test.ts`
 * measures the generated sources against a real style build, so an entry cannot
 * linger as decoration and a new one cannot go unnoticed: the scan below fails
 * loudly and names it.
 */

/** Helpers currently emitted by the toolchains this project builds with. */
const TRANSPILE_HELPERS: Record<string, string> = {
  // esbuild: `var __defProp = Object.defineProperty;`
  __defProp: "Object.defineProperty",
  // esbuild (`keepNames`), verbatim:
  // `var __name = (target, value) => __defProp(target, "name", { value, configurable: true });`
  __name:
    'function (target, value) { __defProp(target, "name", { value: value, configurable: true }); return target; }',
};

/** Identifiers a generated fragment may reference without defining them. */
export function transpileHelperNames(): string[] {
  return Object.keys(TRANSPILE_HELPERS);
}

/**
 * Ledger bodies, keyed by helper name.
 *
 * Exposed for the tests that check the ledger against what the toolchain emits,
 * so they read the same source the sandbox installs.
 */
export function transpileHelperBodies(): Readonly<Record<string, string>> {
  return TRANSPILE_HELPERS;
}

/**
 * Source that installs the ledger, guarded so repeated evaluation is a no-op
 * and the helpers stay invisible to style authors (non-enumerable, like the
 * utility table itself).
 */
export function buildTranspileHelperSource(): string {
  const lines = ["(function () {", '  "use strict";'];
  lines.push("  const define = function (name, value) {");
  lines.push('    if (typeof globalThis[name] !== "undefined") return;');
  lines.push("    Object.defineProperty(globalThis, name, {");
  lines.push("      value: value,");
  lines.push("      writable: false,");
  lines.push("      configurable: false,");
  lines.push("      enumerable: false,");
  lines.push("    });");
  lines.push("  };");
  for (const [name, body] of Object.entries(TRANSPILE_HELPERS)) {
    lines.push(`  define(${JSON.stringify(name)}, ${body});`);
  }
  lines.push("})();");
  return lines.join("\n");
}

/**
 * Blank out comments and string bodies so the scan only sees code. Generated
 * fragments are ours, so a lexical pass is enough; template literals with
 * nested substitution stay as `` because the substitution itself is code.
 */
function stripLiteralsAndComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1 ")
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/'(?:[^'\\]|\\.)*'/g, "''")
    .replace(/`(?:[^`\\]|\\.)*`/g, "``");
}

/** `__`-prefixed identifiers the fragment references without declaring them. */
function freeHelperReferences(source: string): string[] {
  const code = stripLiteralsAndComments(source);
  const declared = new Set<string>();
  const declaration = /(?:var|let|const|function)\s+(__[A-Za-z_$][\w$]*)/g;
  let declarationMatch: RegExpExecArray | null;
  while ((declarationMatch = declaration.exec(code))) {
    const name = declarationMatch[1];
    if (name) declared.add(name);
  }

  const found = new Set<string>();
  const reference = /(^|[^\w$.'"])(__[A-Za-z_$][\w$]*)/g;
  let match: RegExpExecArray | null;
  while ((match = reference.exec(code))) {
    const name = match[2];
    if (name && !declared.has(name)) {
      found.add(name);
    }
  }
  return Array.from(found);
}

/** Prefixes the core itself defines (bridge, context view, exports container). */
const CORE_OWNED_PREFIX = "__banyan";

/**
 * Serialize one runtime function as sandbox source under a fixed binding name.
 *
 * The function runs on the host (`Function.prototype.toString`), so the result
 * must pass the ledger scan before it is evaluated; scanning here rather than
 * at each call site means no generated fragment can skip it. A function whose
 * own name differs from the binding keeps that name as an alias, so stack
 * traces and self-references stay readable.
 */
export function serializeRuntimeFunction(
  bindingName: string,
  fn: (...args: never[]) => unknown,
): string {
  const serialized = `const ${bindingName} = ${fn.toString()};`;
  assertKnownTranspileHelpers(serialized, bindingName);
  const originalName = fn.name?.trim();

  if (
    !originalName ||
    originalName === bindingName ||
    !/^[A-Za-z_$][\w$]*$/.test(originalName)
  ) {
    return serialized;
  }

  return `${serialized}\nconst ${originalName} = ${bindingName};`;
}

/**
 * Fail fast when a generated fragment references a helper the ledger does not
 * carry, naming both the helper and where to register it.
 */
export function assertKnownTranspileHelpers(
  source: string,
  fragmentName: string,
): void {
  const unknown = freeHelperReferences(source).filter(
    (name) =>
      !name.startsWith(CORE_OWNED_PREFIX) &&
      !Object.prototype.hasOwnProperty.call(TRANSPILE_HELPERS, name),
  );
  if (!unknown.length) {
    return;
  }
  throw new Error(
    `Serialized fragment "${fragmentName}" references transpile helper(s) ${unknown
      .map((name) => `"${name}"`)
      .join(
        ", ",
      )} that the core does not provide. Add them to src/sandbox/transpileHelpers.ts.`,
  );
}
