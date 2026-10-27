import { assert } from "chai";
import fc from "fast-check";
import { applyTextCase } from "../src/units/compile";

/**
 * Property-based checks are not a replacement for the Zotero differential
 * fixtures; they cover the invariants that should hold for arbitrary author
 * input, including strings the examples never contain.
 */
describe("property invariants", function () {
  it("keeps lower/upper/small-caps idempotent for arbitrary text", function () {
    fc.assert(
      fc.property(fc.string(), (input) => {
        for (const form of ["lower", "upper", "small-caps"] as const) {
          const once = applyTextCase(input, form);
          assert.equal(
            applyTextCase(once, form),
            once,
            `${form} must be idempotent for ${JSON.stringify(input)}`,
          );
        }
      }),
      { numRuns: 200 },
    );
  });
});
