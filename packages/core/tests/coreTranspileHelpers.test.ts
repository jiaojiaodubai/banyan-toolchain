import { assert } from "chai";
import vm from "node:vm";
import {
  assertKnownTranspileHelpers,
  buildTranspileHelperSource,
  transpileHelperNames,
} from "../src/sandbox/transpileHelpers";

/**
 * The ledger must carry what the toolchain really leaves in a serialized
 * fragment — no more (an unused entry pretends to support a helper) and no less
 * (a missing one fails with a bare `ReferenceError` inside style execution).
 * These tests measure that instead of trusting a hand-written list.
 */
describe("core transpile helper ledger", function () {
  it("installs every helper idempotently and invisibly", function () {
    const context = vm.createContext({});
    const source = buildTranspileHelperSource();
    vm.runInContext(source, context);
    vm.runInContext(source, context);

    for (const name of transpileHelperNames()) {
      const descriptor = vm.runInContext(
        `Object.getOwnPropertyDescriptor(globalThis, ${JSON.stringify(name)})`,
        context,
      ) as PropertyDescriptor | undefined;
      assert.isDefined(descriptor, `${name} should be installed`);
      assert.equal(descriptor?.enumerable, false);
      assert.equal(descriptor?.writable, false);
    }
  });

  it("runs `__name` with the semantics esbuild emits", function () {
    const context = vm.createContext({});
    vm.runInContext(buildTranspileHelperSource(), context);

    const named = vm.runInContext(
      "const applied = __name(function () { return 42; }, 'answer'); applied",
      context,
    ) as () => number;

    assert.equal(named(), 42);
    assert.equal(named.name, "answer");
  });

  it("accepts ledger helpers, local declarations, and literals", function () {
    assert.doesNotThrow(() =>
      assertKnownTranspileHelpers("const a = __name(fn, 'fn');", "utilities"),
    );
    assert.doesNotThrow(() =>
      assertKnownTranspileHelpers("var __local = 1; __local;", "utilities"),
    );
    assert.doesNotThrow(() =>
      assertKnownTranspileHelpers(
        'const text = "__notAReference"; // __alsoNot\n/* __norThis */ text;',
        "utilities",
      ),
    );
    assert.doesNotThrow(() =>
      assertKnownTranspileHelpers(
        "__banyanHostUtils__.text('x');",
        "utilities",
      ),
    );
  });

  it("names the missing helper when a fragment uses an unknown one", function () {
    assert.throws(
      () =>
        assertKnownTranspileHelpers(
          "const a = __notRegistered(fn);",
          "banyan-style-utils.js",
        ),
      /banyan-style-utils\.js[\s\S]*__notRegistered[\s\S]*src\/sandbox\/transpileHelpers\.ts/,
    );
  });
});
