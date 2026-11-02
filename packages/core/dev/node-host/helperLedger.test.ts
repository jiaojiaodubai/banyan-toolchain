import { assert } from "chai";
import { createStyle } from "../../src/sandbox/createStyle";
import type {
  SandboxContext,
  SandboxRuntime,
  StyleHostCapabilities,
} from "../../src/host";
import {
  transpileHelperBodies,
  transpileHelperNames,
} from "../../src/sandbox/transpileHelpers";
import { createNodeSandboxRuntime } from "./runtime";

/**
 * Ledger evidence, checked against a real style build: the ledger must carry
 * what the toolchain really leaves in a serialized fragment — no more (an
 * unused entry pretends to support a helper) and no less (a missing one fails
 * with a bare `ReferenceError` inside style execution).
 *
 * This needs a working sandbox host, so it lives next to the development-time
 * Node binding instead of in the unit-test tree.
 */
const INFO = `const INFO = { id: "probe", name: "Probe", title: "Probe", updated: "2026-01-01", citationType: "intext-citation" };`;

function createSourceCapture(): {
  runtime: SandboxRuntime;
  sources: string[];
} {
  const sources: string[] = [];
  const base = createNodeSandboxRuntime();

  return {
    sources,
    runtime: {
      createContext(options) {
        const context = base.createContext(options);
        const wrapper: SandboxContext = {
          evaluate: (source, evaluateOptions) => {
            sources.push(source);
            return context.evaluate(source, evaluateOptions);
          },
          defineGlobal: (name, value) => context.defineGlobal(name, value),
          readGlobal: (name) => context.readGlobal(name),
          deleteGlobal: (name) => context.deleteGlobal(name),
          createObject: () => context.createObject(),
          defineFunction: (target, name, fn) =>
            context.defineFunction(target, name, fn),
          deferHostTask: (callback) => context.deferHostTask(callback),
          importValue: (value) => context.importValue(value),
          exportValue: (value) => context.exportValue(value),
          cloneToHost: (value) => context.cloneToHost(value),
        };
        return wrapper;
      },
    },
  };
}

function helperReferences(source: string): string[] {
  const found: string[] = [];
  for (const match of source.matchAll(/(^|[^\w$.'"])(__[A-Za-z_$][\w$]*)/g)) {
    found.push(match[2]);
  }
  return found;
}

describe("transpile helper ledger against a real build", function () {
  it("carries exactly the helpers the toolchain leaves behind", async function () {
    const capture = createSourceCapture();
    // Building a style serializes every fragment, and the scan inside rejects
    // any helper that is not registered.
    await createStyle(
      // Only the build is exercised, so no host capability is needed yet.
      {
        runtime: capture.runtime,
        capabilities: {} as StyleHostCapabilities,
      },
      `${INFO}\nfunction generate() { return { citations: [], bibliography: [] }; }`,
    );

    const mentioned = new Set<string>();
    for (const source of capture.sources) {
      for (const name of helperReferences(source)) {
        mentioned.add(name);
      }
    }

    const ledger = new Set(transpileHelperNames());
    const bodies = transpileHelperBodies();

    const needed = new Set<string>();
    const visit = (names: Iterable<string>): void => {
      for (const name of names) {
        if (needed.has(name) || !ledger.has(name)) {
          continue;
        }
        needed.add(name);
        visit(helperReferences(bodies[name] ?? ""));
      }
    };
    visit(mentioned);

    assert.deepEqual(
      [...needed].sort(),
      transpileHelperNames().sort(),
      "the ledger must match the helpers the current toolchain emits",
    );
  });
});
