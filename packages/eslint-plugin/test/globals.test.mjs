import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { extractStyleUtilsReadonlyGlobals } from "../src/eslint-style-utils-globals.mjs";

const typingsDir = fileURLToPath(
  new URL("./fixtures/typings/", import.meta.url),
);

describe("style utils globals", function () {
  it("collects StyleUtils keys and intersected UnitUtils keys", function () {
    const globals = extractStyleUtilsReadonlyGlobals(typingsDir);

    assert.deepEqual(globals, {
      callStyle: "readonly",
      compileUnit: "readonly",
      formatDate: "readonly",
      joinText: "readonly",
      loadResource: "readonly",
      plainText: "readonly",
    });
  });

  it("keeps the dependency/resource API available with older typings", function () {
    const globals = extractStyleUtilsReadonlyGlobals(typingsDir);

    assert.equal(globals.callStyle, "readonly");
    assert.equal(globals.loadResource, "readonly");
  });

  it("explains a missing typings directory", function () {
    assert.throws(
      () => extractStyleUtilsReadonlyGlobals("/definitely/not/a/dir"),
      /Cannot read .*styleUtils\.d\.ts/,
    );
  });
});
