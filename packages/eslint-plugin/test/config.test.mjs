import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import js from "@eslint/js";
import { ESLint } from "eslint";
import banyanStyle, {
  createBanyanStyleConfig,
  diagnosticIdFor,
} from "../src/eslint-plugin-banyan-style.mjs";
import { CONTRACT_DIAGNOSTIC_IDS } from "@banyan/style-contract";

const typingsDir = fileURLToPath(
  new URL("./fixtures/typings/", import.meta.url),
);

const validInfo = `
const INFO = {
  id: "test-style",
  title: "Test Style",
  description: "For config tests",
  citationType: "intext-citation",
  creator: [{ type: "author", name: "Tester" }],
  tags: [],
  documentation: [],
  license: "MIT",
  updated: "2026-10-25",
};
`;

describe("shared flat config", function () {
  it("exposes every rule on the default export", function () {
    assert.deepEqual(Object.keys(banyanStyle.rules).sort(), [
      "require-style-contract",
      "validate-field-presets",
      "validate-item-field-validators",
      "validate-params",
      "warn-empty-style-options",
      "warn-item-field-misuse",
      "warn-param-count",
      "warn-risky-runtime-pattern",
    ]);
  });

  it("documents every rule with a stable URL, type, schema and messages", function () {
    for (const [name, rule] of Object.entries(banyanStyle.rules)) {
      assert.ok(
        rule.meta.type === "problem" || rule.meta.type === "suggestion",
        name,
      );
      assert.match(rule.meta.docs.description, /\S/, name);
      assert.equal(
        rule.meta.docs.url,
        `https://github.com/jiaojiaodubai/banyan-toolchain/blob/main/packages/eslint-plugin/docs/rules.md#${name}`,
        name,
      );
      assert.ok(Array.isArray(rule.meta.schema), name);
      assert.ok(Object.keys(rule.meta.messages).length > 0, name);
    }
  });

  it("maps every rule message to a contract diagnostic", function () {
    const known = new Set(CONTRACT_DIAGNOSTIC_IDS);
    for (const [ruleName, rule] of Object.entries(banyanStyle.rules)) {
      for (const messageId of Object.keys(rule.meta.messages)) {
        const id = diagnosticIdFor(`banyanStyle/${ruleName}`, messageId);
        assert.ok(id, `unmapped diagnostic: ${ruleName}/${messageId}`);
        assert.ok(
          known.has(id),
          `unknown diagnostic '${id}' for ${ruleName}/${messageId}`,
        );
      }
    }
  });

  it("builds a config with author globals, plugin and recommended rules", function () {
    const config = createBanyanStyleConfig({ typingsDir });

    assert.equal(config.name, "banyan-style/recommended");
    assert.deepEqual(config.files, ["**/*.js"]);
    assert.equal(config.plugins.banyanStyle, banyanStyle);
    assert.equal(config.languageOptions.globals.contexts, "readonly");
    assert.equal(config.languageOptions.globals.options, "readonly");
    assert.equal(config.languageOptions.globals.console, "readonly");
    assert.equal(config.languageOptions.globals.formatDate, "readonly");
    assert.equal(config.languageOptions.globals.joinText, "readonly");
    assert.equal(config.rules["banyanStyle/require-style-contract"], "error");
    assert.deepEqual(config.rules["banyanStyle/warn-param-count"], [
      "warn",
      { warnCount: 12 },
    ]);
  });

  it("merges custom files, globals and warnCount", function () {
    const config = createBanyanStyleConfig({
      typingsDir,
      files: ["styles/**/style.js"],
      globals: { document: "readonly" },
      warnCount: 8,
    });

    assert.deepEqual(config.files, ["styles/**/style.js"]);
    assert.equal(config.languageOptions.globals.document, "readonly");
    assert.deepEqual(config.rules["banyanStyle/warn-param-count"], [
      "warn",
      { warnCount: 8 },
    ]);
  });

  it("lints a style through the shared config", async function () {
    const eslint = new ESLint({
      overrideConfigFile: true,
      overrideConfig: [
        js.configs.recommended,
        createBanyanStyleConfig({ typingsDir }),
      ],
    });
    const [result] = await eslint.lintText(
      `
${validInfo}
function generate() {
  return {
    citations: contexts.map((context) => ({ id: context.id, content: formatDate("2026") })),
    bibliography: [],
  };
}
`,
      { filePath: "style.js" },
    );

    assert.deepEqual(result.messages, []);
  });
});
