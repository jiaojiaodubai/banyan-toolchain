import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CONTRACT_DIAGNOSTIC_IDS,
  DELEGATION_TIMEOUT_MS,
  DENIED_NORMALIZED_PRESET_KEYS,
  DENIED_PRESET_KEYS,
  DEPENDENCY_KEYS,
  EXECUTOR_POLICY,
  isDeniedPresetKey,
  isReservedDeclarationKey,
  isValidExtraKey,
  isValidResourcePath,
  LINT_ONLY_DIAGNOSTICS,
  MAX_DELEGATION_CALLS,
  MAX_DELEGATION_DEPTH,
  MAX_PRESETS,
  MAX_RESOURCE_BYTES,
  MAX_STATES,
  MAX_STYLE_DEPENDENCIES,
  MAX_STYLE_OPTIONS,
  MAX_STYLE_RESOURCES,
  normalizeExtraKey,
  normalizeStateKey,
  RESOURCE_FORMATS,
  RESOURCE_KEYS,
  RESOURCE_TIMEOUT_MS,
  RUNTIME_ONLY_DIAGNOSTICS,
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

  it("keeps the two executor-only sets disjoint and in the catalogue", function () {
    const lintOnly = new Set(LINT_ONLY_DIAGNOSTICS);
    const runtimeOnly = new Set(RUNTIME_ONLY_DIAGNOSTICS);
    const known = new Set(CONTRACT_DIAGNOSTIC_IDS);
    for (const id of runtimeOnly) {
      assert.ok(!lintOnly.has(id), `both executors claim ${id}`);
      assert.ok(known.has(id), id);
    }
    for (const id of [...lintOnly, ...runtimeOnly]) {
      assert.ok(!(id in EXECUTOR_POLICY), id);
    }
  });

  it("classifies every dependency/resource identifier", function () {
    // Declaration-class ids are produced by both executors, so neither
    // executor-only list may claim them; every other new id must be claimed by
    // exactly one of the three groups.
    const declarationClass = new Set([
      "dependency.export.not-array",
      "dependency.entry.not-object",
      "dependency.id.invalid",
      "dependency.id.duplicate",
      "dependency.id.self",
      "dependency.limit",
      "resource.export.not-array",
      "resource.entry.not-object",
      "resource.id.invalid",
      "resource.id.duplicate",
      "resource.path.invalid",
      "resource.format.invalid",
      "resource.validate.invalid",
      "resource.limit",
    ]);
    const claimed = new Set([
      ...declarationClass,
      ...LINT_ONLY_DIAGNOSTICS,
      ...RUNTIME_ONLY_DIAGNOSTICS,
    ]);
    const dependencyIds = CONTRACT_DIAGNOSTIC_IDS.filter((id) =>
      /^(dependency|delegation|resource|lint\.resource)\./.test(id),
    );
    assert.ok(dependencyIds.length >= 28);
    for (const id of dependencyIds) {
      assert.ok(claimed.has(id), `${id} is not classified`);
    }
    for (const id of declarationClass) {
      assert.ok(!LINT_ONLY_DIAGNOSTICS.includes(id), id);
      assert.ok(!RUNTIME_ONLY_DIAGNOSTICS.includes(id), id);
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

  it("truncates rather than rejects a static cap overflow", function () {
    for (const id of ["dependency.limit", "resource.limit"]) {
      assert.equal(EXECUTOR_POLICY[id].runtime, "warning", id);
      assert.equal(EXECUTOR_POLICY[id].lint, "error", id);
    }
  });
});

describe("dependency and resource constants", function () {
  it("keeps the documented caps", function () {
    assert.equal(MAX_STYLE_DEPENDENCIES, 4);
    assert.equal(MAX_DELEGATION_DEPTH, 3);
    assert.equal(MAX_DELEGATION_CALLS, 16);
    assert.equal(DELEGATION_TIMEOUT_MS, 30_000);
    assert.equal(MAX_STYLE_RESOURCES, 8);
    assert.equal(MAX_RESOURCE_BYTES, 4 * 1024 * 1024);
    assert.equal(RESOURCE_TIMEOUT_MS, 10_000);
    assert.deepEqual([...RESOURCE_FORMATS], ["json", "text"]);
  });

  it("declares only known dependency/resource keys", function () {
    assert.deepEqual([...DEPENDENCY_KEYS], ["id"]);
    assert.deepEqual([...RESOURCE_KEYS].sort(), [
      "format",
      "id",
      "path",
      "validate",
    ]);
  });
});

describe("resource paths", function () {
  it("accepts a plain relative path", function () {
    for (const value of [
      "assets/journal-abbrev.json",
      "words.txt",
      "a/b/c.json",
      "assets/2024-01.json",
      "版本/缩写.json",
    ]) {
      assert.equal(isValidResourcePath(value), true, value);
    }
  });

  it("rejects escapes and non-paths", function () {
    for (const value of [
      "",
      " ",
      " assets/x.json",
      "assets/x.json ",
      "/etc/passwd",
      "../secret.json",
      "assets/../../secret.json",
      "assets\\words.json",
      "C:/words.json",
      "file:///etc/passwd",
      "https://example.com/x.json",
      "assets//words.json",
      "assets/",
      "assets/./words.json",
      "words\0.json",
      "a".repeat(513),
      null,
      42,
    ]) {
      assert.equal(isValidResourcePath(value), false, JSON.stringify(value));
    }
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
