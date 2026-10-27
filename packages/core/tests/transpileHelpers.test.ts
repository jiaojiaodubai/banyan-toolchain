import { assert } from "chai";
import { buildSandboxRuntimeSources } from "../src/sandbox/utilities";
import {
  assertKnownTranspileHelpers,
  transpileHelperNames,
} from "../src/sandbox/transpileHelpers";

describe("sandbox runtime source contract", function () {
  it("serializes every fragment without an unregistered transpile helper", function () {
    // The ledger scan is already applied while building these sources; this
    // asserts the positive direction explicitly and reports the fragments.
    const sources = buildSandboxRuntimeSources();

    assert.isNotEmpty(sources.utilitiesSource);
    assert.include(sources.utilitiesSource, "__banyanHostUtils__");

    for (const [fragmentName, source] of Object.entries(sources)) {
      assert.doesNotThrow(
        () => assertKnownTranspileHelpers(source, fragmentName),
        `${fragmentName} should only use registered helpers`,
      );
    }
  });

  it("installs each ledger helper through the same preamble", function () {
    const { helpersSource } = buildSandboxRuntimeSources();
    for (const name of transpileHelperNames()) {
      assert.include(helpersSource, JSON.stringify(name));
    }
  });
});
