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

  it("keeps a valid note kind and a zero page", function () {
    const contexts = normalizeCitationContexts([
      { id: "note-1", page: 0, noteType: "endnote", cites: [] },
      { id: "note-2", page: 4, noteType: "footnote", cites: [] },
    ]);

    assert.equal(contexts[0].noteType, "endnote");
    assert.equal(contexts[0].page, 0);
    assert.equal(contexts[1].noteType, "footnote");
  });

  it("rejects an unknown note kind and points at the field", function () {
    try {
      normalizeCitationContexts([
        { id: "ctx-1", page: 1, noteType: "sidenote", cites: [] },
      ]);
      assert.fail("expected an unknown note kind to throw");
    } catch (error) {
      const record = error as {
        code?: unknown;
        sourcePath?: unknown;
        message?: unknown;
      };
      assert.match(
        String(record.message),
        /noteType that is neither "footnote" nor "endnote"/,
      );
      assert.equal(record.code, "generate-input");
      assert.equal(record.sourcePath, "contexts[0].noteType");
    }
    for (const noteType of [null, "", "Footnote"]) {
      assert.throws(
        () =>
          normalizeCitationContexts([
            { id: "ctx", page: 1, noteType, cites: [] },
          ]),
        /noteType that is neither "footnote" nor "endnote"/,
        String(noteType),
      );
    }
  });

  it("keeps legacy contexts without a note kind unchanged", function () {
    const contexts = normalizeCitationContexts([
      { id: "legacy-1", page: 7, cites: [] },
    ]);

    // Absent, not defaulted to "footnote": an old host did not state a kind and
    // filling one in would fabricate a host fact.
    assert.equal("noteType" in contexts[0], false);
    assert.equal(contexts[0].page, 7);
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
