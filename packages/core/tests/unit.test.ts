import { assert } from "chai";
import type { GroupUnit, RichText, Unit } from "../src/types/unit";
import {
  applyTextCase,
  compile,
  plainText,
  unitUtils,
} from "../src/units/unit";

const { affix, fallback, group, link, text, textCase, when, withStyle } =
  unitUtils;

describe("unit helpers", function () {
  it("treats a structured RichText value as a Unit", function () {
    const value: RichText = {
      text: "See generally",
      marks: [{ type: "italic", start: 0, end: 13, value: true }],
    };
    assert.deepEqual(compile(group([value, " (2024)"], "")), {
      text: "See generally (2024)",
      marks: [{ type: "italic", start: 0, end: 13, value: true }],
    });
  });

  it("combines visible units with delimiters while skipping empty candidates", function () {
    assert.deepEqual(
      compile(group(["Smith", "", text("2024", { bold: true })], ", ")),
      {
        text: "Smith, 2024",
        marks: [{ type: "bold", start: 7, end: 11, value: true }],
      },
    );
  });

  it("adds affixes only when the main unit has visible text", function () {
    assert.deepEqual(compile(affix("2024", "(", ")")), {
      text: "(2024)",
      marks: [],
    });
    assert.deepEqual(compile(affix("", "(", ")")), { text: "", marks: [] });
    assert.deepEqual(compile(affix(text(""), "(", ")")), {
      text: "",
      marks: [],
    });
  });

  it("uses fallback and when to choose the first visible branch", function () {
    assert.deepEqual(compile(fallback(["", text("Untitled"), "Ignored"])), {
      text: "Untitled",
      marks: [],
    });
    assert.deepEqual(compile(when(false, "Shown", "Hidden")), {
      text: "Hidden",
      marks: [],
    });
    assert.deepEqual(compile(when(false, "Shown")), { text: "", marks: [] });
    // `0` is a printable unit, so the branch must be taken, not skipped.
    assert.deepEqual(compile(when(false, "Shown", 0)), {
      text: "0",
      marks: [],
    });
    assert.deepEqual(compile(when(true, 0)), { text: "0", marks: [] });
    assert.deepEqual(compile(affix(0, "(", ")")), { text: "(0)", marks: [] });
  });

  it("applies style and link marks over nested unit output", function () {
    assert.deepEqual(
      compile(
        link(
          withStyle(group([text("A", { italic: true }), "B"]), {
            bold: true,
          }),
          "https://example.test/ref",
        ),
      ),
      {
        text: "AB",
        marks: [
          { type: "bold", start: 0, end: 2, value: true },
          {
            type: "link",
            start: 0,
            end: 2,
            value: "https://example.test/ref",
          },
          { type: "italic", start: 0, end: 1, value: true },
        ],
      },
    );
  });

  it("keeps plainText useful for sorting keys across declarative units", function () {
    assert.equal(
      plainText(group(["Smith", affix("2024", " (", ")")], "")),
      "Smith (2024)",
    );
  });

  it("demonstrates why Unit arrays must not be joined by script authors", function () {
    const parts = [affix("A", "", "."), affix("B", "", ".")];

    assert.equal(parts.join(" "), "[object Object] [object Object]");
    assert.equal(plainText(group(parts, " ")), "A. B.");
  });

  it("supports deterministic case transforms that do not require Zotero utilities", function () {
    assert.deepEqual(compile(textCase("Mixed Case", "lower")), {
      text: "mixed case",
      marks: [],
    });
    assert.deepEqual(compile(textCase("Mixed Case", "upper")), {
      text: "MIXED CASE",
      marks: [],
    });
  });

  it("maps small-caps to real Unicode small capitals", function () {
    // Hard-coded on purpose: a constant code-point offset produces unrelated
    // phonetic letters, and deriving the expectation from the implementation
    // would hide exactly that mistake.
    assert.equal(applyTextCase("RNA", "small-caps"), "ʀɴᴀ");
    assert.equal(applyTextCase("Mixed Case", "small-caps"), "ᴍɪxᴇᴅ ᴄᴀꜱᴇ");
    assert.equal(applyTextCase("DNA 2024", "small-caps", ["DNA"]), "DNA 2024");
    // Already-small-cap letters must survive a second pass unchanged.
    assert.equal(applyTextCase("ɪ", "small-caps"), "ɪ");
    assert.equal(
      applyTextCase(applyTextCase("I", "small-caps"), "small-caps"),
      "ɪ",
    );
  });

  it("does not shift mark ranges when a case mapping changes length", function () {
    assert.deepEqual(
      compile(textCase(group([text("ß", { bold: true }), "x"]), "upper")),
      {
        text: "SSX",
        marks: [{ type: "bold", start: 0, end: 2, value: true }],
      },
    );
  });

  it("protects ignored words with Unicode boundaries and trimmed spellings", function () {
    assert.equal(applyTextCase("CAFÉ DNA", "lower", ["CAFÉ"]), "CAFÉ dna");
    assert.equal(applyTextCase("DNA test", "lower", [" DNA "]), "DNA test");
    assert.equal(applyTextCase("DNA smith", "name", ["DNA"]), "DNA Smith");
    // The name form restores the declared spelling too; this is the documented
    // meaning of "left untouched", not a title-case-only list.
    assert.equal(
      applyTextCase("VAN DER BERG", "name", ["der"]),
      "Van der Berg",
    );
    assert.equal(applyTextCase("café DNA", "small-caps", ["café"]), "café ᴅɴᴀ");
  });

  it("keeps Greek final sigma context across mark boundaries", function () {
    // A word-internal sigma before a letter in the next run must stay σ.
    assert.deepEqual(
      compile(textCase(group([text("ΑΣ", { bold: true }), "Α"]), "lower")),
      {
        text: "ασα",
        marks: [{ type: "bold", start: 0, end: 2, value: true }],
      },
    );
    // A word-final sigma in a later run must become ς.
    assert.deepEqual(
      compile(textCase(group([text("ΟΔΟ", { bold: true }), "Σ"]), "lower")),
      {
        text: "οδος",
        marks: [{ type: "bold", start: 0, end: 3, value: true }],
      },
    );
    // The same at a punctuation boundary.
    assert.deepEqual(
      compile(textCase(group([text("ΟΔΟΣ", { bold: true }), "!"]), "lower")),
      {
        text: "οδος!",
        marks: [{ type: "bold", start: 0, end: 4, value: true }],
      },
    );
  });

  it("bounds shared and cyclic trees on the public compile path", function () {
    let shared: Unit = "x";
    for (let depth = 0; depth < 20; depth += 1) {
      shared = { type: "group", units: [shared, shared] };
    }
    assert.throws(
      () => compile(shared),
      /expands beyond 100000 visited nodes/,
      "a shared sub-unit must not expand exponentially",
    );

    const cyclic: GroupUnit = { type: "group", units: [] };
    cyclic.units.push(cyclic);
    assert.throws(
      () => compile(cyclic),
      /nested deeper than 100 levels/,
      "a cycle must be reported, not overflow the stack",
    );
  });

  it("counts empty candidates toward the compile budget", function () {
    const empty = {
      type: "group",
      units: Array.from({ length: 100_001 }, () => null),
    } as unknown as Unit;
    assert.throws(() => compile(empty), /expands beyond 100000 visited nodes/);
  });

  it("keeps hard line breaks through title case", function () {
    assert.deepEqual(compile(textCase(text("one\ntwo"), "title")), {
      text: "One\nTwo",
      marks: [],
    });
    assert.deepEqual(
      compile(textCase(group([text("one", { bold: true }), "\ntwo"]), "title")),
      {
        text: "One\nTwo",
        marks: [{ type: "bold", start: 0, end: 3, value: true }],
      },
    );
  });

  it("whitelists style keys and colors on the public compile path", function () {
    const unit = {
      type: "style",
      unit: { value: "original" },
      style: {
        value: "overridden",
        link: "javascript:alert(1)",
        color: "red;background:url(x)",
        bold: true,
      },
    };

    assert.deepEqual(compile(unit as never), {
      text: "original",
      marks: [{ type: "bold", start: 0, end: 8, value: true }],
    });
  });
});
