import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { CSL_NAME_VARIABLES, ZOTERO_ITEM_TYPES } from "@banyan/core/schema";
import {
  DENIED_NORMALIZED_PRESET_KEYS,
  SCHEMA_FACTS,
} from "@banyan/style-contract";
import { PRESET_DENIED_KEYS } from "eslint-plugin-banyan-style";
import {
  lintFixture,
  loadFixtures,
  runtimeFixture,
  type Fixture,
} from "../src/parity.ts";

const fixtures = await loadFixtures();

function sorted(values: Iterable<string>): string[] {
  return [...new Set(values)].sort();
}

describe("lint/runtime conformance", function () {
  it("loads a non-empty canonical corpus", function () {
    assert.ok(fixtures.length >= 8, `only ${fixtures.length} fixtures`);
    assert.deepEqual(
      new Set(fixtures.map((fixture) => fixture.id)).size,
      fixtures.length,
    );
  });

  for (const fixture of fixtures) {
    it(fixture.id, async function () {
      const [lint, runtime] = await Promise.all([
        lintFixture(fixture),
        runtimeFixture(fixture),
      ]);

      assert.deepEqual(
        lint.unmapped,
        [],
        `lint emitted rule messages without a contract diagnostic`,
      );
      assert.deepEqual(
        sorted(lint.ids),
        sorted(fixture.expect.lint),
        `lint ids for ${fixture.description}`,
      );
      assert.deepEqual(
        sorted(runtime),
        sorted(fixture.expect.runtime),
        `runtime ids for ${fixture.description}`,
      );
    });
  }
});

describe("generated facts stay single-sourced", function () {
  it("projects the same Zotero item types as the core", function () {
    assert.deepEqual(
      sorted(SCHEMA_FACTS.zoteroItemTypes),
      sorted(ZOTERO_ITEM_TYPES),
    );
  });

  it("projects the same CSL name variables as the core", function () {
    assert.deepEqual(
      sorted(SCHEMA_FACTS.cslNameVariables),
      sorted(CSL_NAME_VARIABLES),
    );
  });

  it("gives lint and runtime the same denied preset keys", function () {
    assert.deepEqual(
      sorted(DENIED_NORMALIZED_PRESET_KEYS),
      sorted(PRESET_DENIED_KEYS),
    );
  });

  it("records a schema revision in the contract", function () {
    assert.match(
      SCHEMA_FACTS.schemaRevision,
      /^zotero-\d+\+csl-[0-9a-f]{12}\+cslm-[0-9a-f]{12}$/,
    );
  });
});

describe("lint bundle boundary", function () {
  it("does not import the core runtime or ESLint itself", async function () {
    const entry = fileURLToPath(
      import.meta.resolve("eslint-plugin-banyan-style"),
    );
    const bundle = await readFile(entry, "utf8");
    assert.doesNotMatch(bundle, /@banyan\/core/);
    assert.doesNotMatch(bundle, /from\s+["']eslint["']/);
    assert.match(bundle, /MAX_STYLE_OPTIONS/, "contract facts are inlined");
  });
});

export type { Fixture };
