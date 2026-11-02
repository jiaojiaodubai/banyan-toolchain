import { assert } from "chai";
import { normalizeCitationContexts } from "../src/validation/contexts";

describe("citation context normalization", function () {
  it("defaults params and trims the id", function () {
    const contexts = normalizeCitationContexts([
      { id: " ctx-1 ", page: 1, cites: [] },
    ]);

    assert.deepEqual(contexts, [
      { id: "ctx-1", page: 1, cites: [], params: {} },
    ]);
  });

  it("keeps the caller's params object", function () {
    const contexts = normalizeCitationContexts([
      { id: "ctx-1", page: 2, cites: [], params: { prefix: "see" } },
    ]);

    assert.deepEqual(contexts[0], {
      id: "ctx-1",
      page: 2,
      cites: [],
      params: { prefix: "see" },
    });
  });

  it("reports duplicate ids", function () {
    assert.throws(
      () =>
        normalizeCitationContexts([
          { id: "dup", page: 1, cites: [] },
          { id: "dup", page: 2, cites: [] },
        ]),
      /duplicate context id "dup"/,
    );
  });

  it("requires a finite page and an object-shaped params", function () {
    assert.throws(
      () => normalizeCitationContexts([{ id: "ctx-1", cites: [] }]),
      /without a finite number page/,
    );
    assert.throws(
      () =>
        normalizeCitationContexts([
          { id: "ctx-1", page: 1, cites: [], params: [] },
        ]),
      /params that is not an object/,
    );
  });

  it("rejects malformed cite entries", function () {
    const base = { id: "ctx-1", page: 1, params: {} };

    assert.throws(
      () => normalizeCitationContexts([{ ...base, cites: [null] }]),
      /contexts\[0\]\.cites\[0\] that is not an object/,
    );
    assert.throws(
      () =>
        normalizeCitationContexts([
          { ...base, cites: [{ item: {}, params: [] }] },
        ]),
      /cites\[0\]\.params that is not an object/,
    );
    assert.throws(
      () => normalizeCitationContexts([{ ...base, cites: [{ params: {} }] }]),
      /cites\[0\]\.item that is not an object/,
    );
    assert.doesNotThrow(() =>
      normalizeCitationContexts([
        { ...base, cites: [{ item: {}, params: {} }] },
      ]),
    );
  });
});
