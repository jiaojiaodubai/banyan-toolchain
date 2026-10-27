import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CONTRACT_DIAGNOSTIC_IDS,
  DENIED_NORMALIZED_PRESET_KEYS,
  DENIED_PRESET_KEYS,
  EXECUTOR_POLICY,
  isDeniedPresetKey,
  isReservedDeclarationKey,
  isValidExtraKey,
  LINT_ONLY_DIAGNOSTICS,
  MAX_PRESETS,
  MAX_STATES,
  MAX_STYLE_OPTIONS,
  normalizeExtraKey,
  normalizeStateKey,
  SCHEMA_FACTS,
} from "../dist/index.js";

describe("declaration constants", function () {
  it("keeps the documented caps", function () {
    assert.equal(MAX_STYLE_OPTIONS, 16);
    assert.equal(MAX_STATES, 20);
    assert.equal(MAX_PRESETS, 50);
  });

  it("reserves only __proto__ as a declaration key", function () {
    assert.equal(isReservedDeclarationKey("__proto__"), true);
    assert.equal(isReservedDeclarationKey("constructor"), false);
    assert.equal(isReservedDeclarationKey("prototype"), false);
  });

  it("trims state keys", function () {
    assert.equal(normalizeStateKey("  auto  "), "auto");
    assert.equal(normalizeStateKey(42), "");
  });
});

describe("extra-key normalization", function () {
  it("normalizes camelCase, separators and case", function () {
    assert.equal(normalizeExtraKey("itemType"), "item-type");
    assert.equal(normalizeExtraKey("Book  Author"), "book-author");
    assert.equal(normalizeExtraKey("date2"), "date2");
  });

  it("accepts a key that can be read back, and rejects others", function () {
    assert.equal(isValidExtraKey("版本说明2"), true);
    assert.equal(isValidExtraKey("citation-key"), true);
    assert.equal(isValidExtraKey("a.b"), false);
    assert.equal(isValidExtraKey(""), false);
  });

  it("matches denied keys through the normalized form", function () {
    assert.equal(DENIED_NORMALIZED_PRESET_KEYS.size, DENIED_PRESET_KEYS.size);
    assert.equal(isDeniedPresetKey("itemType"), true);
    assert.equal(isDeniedPresetKey("date-added"), true);
    assert.equal(isDeniedPresetKey("status"), false);
  });
});

describe("diagnostic catalogue", function () {
  it("has unique identifiers", function () {
    assert.equal(
      new Set(CONTRACT_DIAGNOSTIC_IDS).size,
      CONTRACT_DIAGNOSTIC_IDS.length,
    );
  });

  it("keeps every policy key in the catalogue", function () {
    const known = new Set(CONTRACT_DIAGNOSTIC_IDS);
    for (const id of Object.keys(EXECUTOR_POLICY)) {
      assert.ok(known.has(id), id);
    }
  });

  it("keeps lint-only identifiers out of the runtime policy", function () {
    for (const id of LINT_ONLY_DIAGNOSTICS) {
      assert.ok(!(id in EXECUTOR_POLICY), id);
    }
  });

  it("records the reviewed strictness for key drift cases", function () {
    assert.deepEqual(EXECUTOR_POLICY["param.states.key.whitespace"], {
      canonical:
        "State keys are trimmed before lookup. Two keys that collide after trimming are a declaration error.",
      runtime: "warning",
      lint: "error",
    });
    assert.equal(
      EXECUTOR_POLICY["param.state.default.missing"].runtime,
      "warning",
    );
    assert.equal(EXECUTOR_POLICY["param.state.default.missing"].lint, "error");
  });
});

describe("generated schema facts", function () {
  it("carries a revision and the domain vocabulary", function () {
    assert.match(
      SCHEMA_FACTS.schemaRevision,
      /^zotero-\d+\+csl-[0-9a-f]{12}\+cslm-[0-9a-f]{12}$/,
    );
    assert.ok(SCHEMA_FACTS.zoteroItemTypes.includes("book"));
    assert.ok(SCHEMA_FACTS.cslNameVariables.includes("author"));
    assert.equal(
      SCHEMA_FACTS.zoteroItemTypes.length,
      new Set(SCHEMA_FACTS.zoteroItemTypes).size,
    );
  });
});
