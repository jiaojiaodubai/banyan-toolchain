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
      compileUnit: "readonly",
      formatDate: "readonly",
      joinText: "readonly",
      plainText: "readonly",
    });
  });

  it("explains a missing typings directory", function () {
    assert.throws(
      () => extractStyleUtilsReadonlyGlobals("/definitely/not/a/dir"),
      /Cannot read .*styleUtils\.d\.ts/,
    );
  });
});
