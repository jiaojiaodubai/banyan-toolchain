import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import js from "@eslint/js";
import { ESLint } from "eslint";
import { createBanyanStyleConfig } from "../src/eslint-plugin-banyan-style.mjs";

const typingsDir = fileURLToPath(
  new URL("./fixtures/typings/", import.meta.url),
);

async function lintStyleScript(code, options = {}) {
  const eslint = new ESLint({
    overrideConfigFile: true,
    overrideConfig: [
      js.configs.recommended,
      createBanyanStyleConfig({ typingsDir, ...options }),
    ],
  });
  return eslint.lintText(code, { filePath: "style.js" });
}

function assertIncludesAll(actual, expected) {
  for (const item of expected) {
    assert.ok(
      actual.includes(item),
      `expected ${JSON.stringify(actual)} to include ${item}`,
    );
  }
}

const validInfo = `
const INFO = {
  id: "test-style",
  title: "Test Style",
  description: "For lint tests",
  citationType: "intext-citation",
  creator: [{ type: "author", name: "Tester" }],
  tags: [],
  documentation: [],
  license: "MIT",
  updated: "2026-06-15",
};
`;

async function lintParamEntry(entry, preamble = "") {
  const [result] = await lintStyleScript(`
${validInfo}
${preamble}
const STYLE_OPTIONS = [${entry}];
function generate() {
  return { citations: [], bibliography: [] };
}
`);
  return result.messages
    .filter((message) => message.ruleId?.startsWith("banyanStyle/"))
    .map((message) => message.messageId);
}

describe("style author lint rules", function () {
  it("accepts the documented minimal style contract", async function () {
    const [result] = await lintStyleScript(`
${validInfo}
function generate() {
  return { citations: contexts.map((ctx) => ({ id: ctx.id, content: "" })), bibliography: [] };
}
`);

    assert.deepEqual(result.messages, []);
  });

  it("provides options as a readonly author global", async function () {
    const [result] = await lintStyleScript(`
${validInfo}
const STYLE_OPTIONS = [
  { id: "mode", kind: "state", label: "Mode", defaultValue: false },
];
function generate() {
  const mode = options.mode;
  return { citations: contexts.map((ctx) => ({ id: ctx.id, content: String(mode) })), bibliography: [] };
}
`);

    assert.deepEqual(result.messages, []);
  });

  it("accepts well-formed parameter declarations", async function () {
    const [result] = await lintStyleScript(`
${validInfo}
const STYLE_OPTIONS = [
  { id: "mode", kind: "state", label: "Mode", states: { auto: "Auto", full: "Full" }, defaultValue: "auto" },
  { id: "useIbid", kind: "state", label: "Ibid", defaultValue: true },
  { id: "maxNames", kind: "value", label: "Max names", defaultValue: "3", presets: ["1", { label: "All", value: "99" }], validate: (value) => /^\\d+$/.test(value) },
];
const CITE_PARAMS = [
  { id: "pages", kind: "list", label: "Pages", fields: [{ id: "start", kind: "value", label: "Start" }] },
  { id: "pageKind", kind: "state", label: "Page kind", states: { page: "Page" }, defaultValue: "page", applicable: (cite) => cite.item.itemType === "book" },
  { id: "form", kind: "state", label: "Form", defaultValue: false, forcedValue: (cite) => cite.item.itemType === "book" ? true : null },
];
function generate() {
  return { citations: contexts.map((ctx) => ({ id: ctx.id, content: String(options.mode) })), bibliography: [] };
}
`);

    assert.deepEqual(result.messages, []);
  });

  it("reports invalid parameter declarations", async function () {
    const [result] = await lintStyleScript(`
${validInfo}
const STYLE_OPTIONS = [
  { id: "mode", kind: "state", label: "Mode", states: { auto: "Auto" }, defaultValue: "missing", validate: () => true },
  { id: "mode", kind: "state", label: "Duplicated", defaultValue: false },
  { id: "badValue", kind: "value", label: "Bad", defaultValue: 3, format: "html", validate: /x/ },
  { id: "badList", kind: "list", label: "Bad list", fields: [] },
];
const CITE_PARAMS = [
  { id: "badField", kind: "list", label: "Rows", fields: [{ id: "x", kind: "state", label: "X" }] },
  { id: "badBounds", kind: "list", label: "Bounds", min: -1, fields: [{ id: "x", kind: "value", label: "X" }] },
];
function generate() {
  return { citations: [], bibliography: [] };
}
`);

    const ids = result.messages.map((message) => message.messageId);
    assertIncludesAll(ids, [
      "defaultNotInStates",
      "stateValidate",
      "paramIdDuplicate",
      "valueDefaultInvalid",
      "formatInvalid",
      "validateMustBeFunction",
      "listOnlyCite",
      "listFieldKindInvalid",
      "boundInvalid",
    ]);
  });

  describe("validate-params contract matrix", function () {
    const cases = [
      {
        name: "accepts a boolean toggle default",
        entry: `{ id: "p", kind: "state", label: "P", defaultValue: true }`,
        expected: [],
      },
      {
        name: "rejects a string default for a boolean toggle",
        entry: `{ id: "p", kind: "state", label: "P", defaultValue: "on" }`,
        expected: ["booleanDefaultInvalid"],
      },
      {
        name: "accepts a state key default",
        entry: `{ id: "p", kind: "state", label: "P", states: { a: "A" }, defaultValue: "a" }`,
        expected: [],
      },
      {
        name: "rejects a numeric enum default",
        entry: `{ id: "p", kind: "state", label: "P", states: { a: "A" }, defaultValue: 1 }`,
        expected: ["defaultNotInStates"],
      },
      {
        name: "rejects a boolean enum default",
        entry: `{ id: "p", kind: "state", label: "P", states: { a: "A" }, defaultValue: true }`,
        expected: ["defaultNotInStates"],
      },
      {
        name: "rejects an empty enum default",
        entry: `{ id: "p", kind: "state", label: "P", states: { a: "A" }, defaultValue: "" }`,
        expected: ["defaultNotInStates"],
      },
      {
        name: "rejects an unknown enum default",
        entry: `{ id: "p", kind: "state", label: "P", states: { a: "A" }, defaultValue: "b" }`,
        expected: ["defaultNotInStates"],
      },
      {
        name: "rejects a missing enum default",
        entry: `{ id: "p", kind: "state", label: "P", states: { a: "A" } }`,
        expected: ["stateDefaultMissing"],
      },
      {
        name: "rejects a dynamic enum key",
        entry: `{ id: "p", kind: "state", label: "P", states: { [stateKey]: "A" }, defaultValue: "a" }`,
        preamble: `const stateKey = "a";`,
        expected: ["stateKeyMustBeStatic"],
      },
      {
        name: "accepts a value string default",
        entry: `{ id: "p", kind: "value", label: "P", defaultValue: "x" }`,
        expected: [],
      },
      {
        name: "rejects a numeric value default",
        entry: `{ id: "p", kind: "value", label: "P", defaultValue: 1 }`,
        expected: ["valueDefaultInvalid"],
      },
    ];

    for (const testCase of cases) {
      it(testCase.name, async function () {
        const ids = await lintParamEntry(
          testCase.entry,
          testCase.preamble ?? "",
        );
        assert.deepEqual([...ids].sort(), [...testCase.expected].sort());
      });
    }
  });

  it("warns from 12 style parameters and errors above 16", async function () {
    const makeEntries = (count) =>
      Array.from(
        { length: count },
        (_, index) =>
          `  { id: "mode${index}", kind: "state", label: "Mode ${index}", defaultValue: false },`,
      ).join("\n");

    const [twelve] = await lintStyleScript(`
${validInfo}
const STYLE_OPTIONS = [
${makeEntries(12)}
];
function generate() {
  return { citations: [], bibliography: [] };
}
`);
    assertIncludesAll(
      twelve.messages.map((message) => message.messageId),
      ["manyOptions"],
    );

    const [seventeen] = await lintStyleScript(`
${validInfo}
const STYLE_OPTIONS = [
${makeEntries(17)}
];
function generate() {
  return { citations: [], bibliography: [] };
}
`);
    assertIncludesAll(
      seventeen.messages.map((message) => message.messageId),
      ["tooManyStyleOptions"],
    );
  });

  it("reports missing INFO and generate entries", async function () {
    const [result] = await lintStyleScript(`const helper = () => null;`);

    assertIncludesAll(
      result.messages.map((message) => message.messageId),
      ["missingEntries"],
    );
    assert.match(result.messages[0].message, /INFO, generate/);
  });

  it("validates INFO fields that are part of the authoring contract", async function () {
    const [result] = await lintStyleScript(`
const INFO = {
  id: "bad-style",
  title: "Bad Style",
  description: "Bad",
  citationType: "bibliography-only",
  creator: [{ type: "author" }],
  tags: "style",
  documentation: [],
  license: "MIT",
  updated: 20260615,
};
function generate() { return { citations: [], bibliography: [] }; }
`);

    assertIncludesAll(
      result.messages.map((message) => message.messageId),
      [
        "infoFieldMustBeArray",
        "infoFieldMustBeString",
        "infoCitationTypeInvalid",
        "creatorMissingFields",
      ],
    );
  });

  it("warns about sandbox reliability risks described in the guidelines", async function () {
    const [result] = await lintStyleScript(`
${validInfo}
function generate() {
  while (true) break;
  for (;;) break;
  for (let i = 0; i < 100000; i++) {}
  return recur();
}
function recur() {
  return recur();
}
`);

    assertIncludesAll(
      result.messages.map((message) => message.messageId),
      ["unboundedWhile", "unboundedFor", "largeSyncLoop", "directRecursion"],
    );
  });

  describe("warn-risky-runtime-pattern recursion scope", function () {
    const cases = [
      {
        name: "detects a recursive function declaration",
        code: `function recur() { return recur(); }`,
        expected: 1,
      },
      {
        name: "detects a recursive arrow binding",
        code: `const recur = (depth) => (depth > 0 ? recur(depth - 1) : 0);`,
        expected: 1,
      },
      {
        name: "detects a recursive function-expression binding",
        code: `const recur = function () { return recur(); };`,
        expected: 1,
      },
      {
        name: "detects a named recursive function expression",
        code: `const named = function inner() { return inner(); };`,
        expected: 1,
      },
      {
        name: "detects an assignment-target arrow",
        code: `let recur; recur = () => recur();`,
        expected: 1,
      },
      {
        name: "detects recursion through an object binding",
        code: `const style = { generate: () => style.generate() };`,
        expected: 1,
      },
      {
        name: "detects recursion through this in an object method",
        code: `const helpers = { recur() { return this.recur(); } };`,
        expected: 1,
      },
      {
        name: "ignores a shadowed local binding",
        code: `function recur() {
  const recur = () => 1;
  return recur();
}`,
        expected: 0,
      },
      {
        name: "ignores a shadowed assignment target",
        code: `let recur;
recur = () => {
  let recur;
  return recur();
};`,
        expected: 0,
      },
      {
        name: "ignores indirect recursion through a nested function",
        code: `const recur = () => {
  function inner() { return recur(); }
  return inner();
};`,
        expected: 0,
      },
      {
        name: "ignores an unrelated member with the same name",
        code: `const formatter = { format: (value) => value };
const format = (value) => formatter.format(value);`,
        expected: 0,
      },
      {
        name: "ignores this inside an arrow property",
        code: `const helpers = { recur: () => this.recur() };`,
        expected: 0,
      },
      {
        name: "ignores this inside a plain function",
        code: `function recur() { return this.recur(); }`,
        expected: 0,
      },
      {
        name: "ignores recursion through an alias",
        code: `const alias = recur;
function recur() { return alias(); }`,
        expected: 0,
      },
      {
        name: "ignores recursion through destructuring",
        code: `const api = { recur: () => 1 };
const { recur } = api;
const wrapper = () => recur();`,
        expected: 0,
      },
    ];

    for (const testCase of cases) {
      it(testCase.name, async function () {
        const [result] = await lintStyleScript(`
${validInfo}
${testCase.code}
function generate() { return { citations: [], bibliography: [] }; }
`);
        const count = result.messages.filter(
          (message) => message.messageId === "directRecursion",
        ).length;
        assert.equal(count, testCase.expected);
      });
    }
  });

  it("warns when an item is read by Zotero's label or as record metadata", async function () {
    const [result] = await lintStyleScript(`
${validInfo}
function generate() {
  return {
    citations: contexts.map((ctx) => {
      const { item } = ctx.cites[0];
      const parts = [
        item.version,
        ctx.cites[0].item.publication,
        item.abstract,
        item.notes,
      ];
      return { id: ctx.id, content: parts.join(" ") };
    }),
    bibliography: [],
  };
}
`);

    const messages = result.messages.map((message) => message.message);
    assert.equal(messages.length, 4, messages.join(" | "));
    assert.match(
      messages[0],
      /'version' is Zotero's label for 'versionNumber'; read 'versionNumber' instead\./,
    );
    assert.match(
      messages[1],
      /'publication' is Zotero's label for 'publicationTitle'/,
    );
    assert.match(
      messages[2],
      /'abstract' is Zotero's label for 'abstractNote', which a Banyan item does not carry\./,
    );
    assert.match(messages[3], /A Banyan item does not carry 'notes'\./);
  });

  it("warns on removed identity fields and host-private keys", async function () {
    const [result] = await lintStyleScript(`
${validInfo}
function generate() {
  return {
    citations: contexts.map((ctx) => {
      const { item } = ctx.cites[0];
      const parts = [item.key, item.uri, item.relations, item["z:uri"]];
      return { id: ctx.id, content: parts.join(" ") };
    }),
    bibliography: [],
  };
}
`);

    const messages = result.messages.map((message) => message.message);
    assert.equal(messages.length, 4, messages.join(" | "));
    assert.match(messages[0], /does not carry 'key'\./);
    assert.match(messages[1], /does not carry 'uri'\./);
    assert.match(messages[2], /does not carry 'relations'\./);
    assert.match(messages[3], /Host-private field 'z:uri' must not be read/);
  });

  it("leaves real field reads, ambiguous labels and other objects alone", async function () {
    const [result] = await lintStyleScript(`
${validInfo}
function generate() {
  return {
    citations: contexts.map((ctx) => {
      const { item } = ctx.cites[0];
      const style = { version: 2 };
      const parts = [
        item.title,
        item.versionNumber,
        item.publicationTitle,
        item.format,
        style.version,
      ];
      return { id: ctx.id, content: parts.join(" ") };
    }),
    bibliography: [],
  };
}
`);

    assert.deepEqual(result.messages, []);
  });

  it("accepts a well-formed ITEM_FIELD_PRESETS declaration", async function () {
    const [result] = await lintStyleScript(`
${validInfo}
const ITEM_FIELD_PRESETS = [
  {
    id: "classic",
    label: "古籍",
    visible: (item) => item.itemType === "book",
    fields: { type: "classic" },
  },
  {
    id: "foreign-law",
    label: "外国法（补法域）",
    fields: { jurisdiction: null },
  },
];
function generate() { return { citations: [], bibliography: [] }; }
`);

    assert.deepEqual(result.messages, []);
  });

  it("accepts a named function referenced by ITEM_FIELD_PRESETS.visible", async function () {
    const [result] = await lintStyleScript(`
${validInfo}
function statuteItem(item) { return item.itemType === "statute"; }
const ITEM_FIELD_PRESETS = [
  { id: "genre-law", label: "法律", visible: statuteItem, fields: { genre: "law" } },
];
function generate() { return { citations: [], bibliography: [] }; }
`);

    assert.deepEqual(result.messages, []);
  });

  it("honors a custom STYLE_OPTIONS warning threshold", async function () {
    const makeEntries = (count) =>
      Array.from(
        { length: count },
        (_, index) =>
          `  { id: "mode${index}", kind: "state", label: "Mode ${index}", defaultValue: false },`,
      ).join("\n");

    const [eight] = await lintStyleScript(
      `
${validInfo}
const STYLE_OPTIONS = [
${makeEntries(8)}
];
function generate() { return { citations: [], bibliography: [] }; }
`,
      { warnCount: 8 },
    );
    assertIncludesAll(
      eight.messages.map((message) => message.messageId),
      ["manyOptions"],
    );

    const [seven] = await lintStyleScript(
      `
${validInfo}
const STYLE_OPTIONS = [
${makeEntries(7)}
];
function generate() { return { citations: [], bibliography: [] }; }
`,
      { warnCount: 8 },
    );
    assert.deepEqual(seven.messages, []);
  });

  it("validates ITEM_FIELD_PRESETS shape and writable keys", async function () {
    const [result] = await lintStyleScript(`
${validInfo}
const ITEM_FIELD_PRESETS = [
  {
    id: "dup",
    label: { "zh-CN": "古籍" },
    visible: "always",
    fields: { extra: "x", author: "Someone", type: 42, status: "" },
  },
  { id: "dup", fields: {} },
  { id: "", label: "无名", fields: { type: "classic" } },
];
function generate() { return { citations: [], bibliography: [] }; }
`);

    assertIncludesAll(
      result.messages.map((message) => message.messageId),
      [
        "presetLabelInvalid",
        "presetVisibleInvalid",
        "fieldKeyDenied",
        "fieldKeyIsNameVariable",
        "fieldValueInvalid",
        "presetIdDuplicate",
        "fieldsMustBeNonEmptyObject",
        "presetIdInvalid",
      ],
    );
  });

  it("rejects the object-map form the runtime no longer accepts", async function () {
    const [result] = await lintStyleScript(`
${validInfo}
const ITEM_FIELD_PRESETS = {
  classic: { id: "classic", fields: { type: "classic" } },
};
function generate() { return { citations: [], bibliography: [] }; }
`);

    assert.deepEqual(
      result.messages.map((message) => message.messageId),
      ["presetsMustBeArray"],
    );
  });

  it("rejects keys that cannot be read back from the extra field", async function () {
    const [result] = await lintStyleScript(`
${validInfo}
const ITEM_FIELD_PRESETS = [
  { id: "dots", fields: { "citation.key": "x", "版本说明2": "y", status: "z" } },
];
function generate() { return { citations: [], bibliography: [] }; }
`);

    assert.deepEqual(
      result.messages.map((message) => message.messageId),
      ["fieldKeyInvalidSyntax"],
    );
  });

  it("rejects an ITEM_FIELD_PRESETS that is not an array", async function () {
    const [result] = await lintStyleScript(`
${validInfo}
const ITEM_FIELD_PRESETS = "classic";
function generate() { return { citations: [], bibliography: [] }; }
`);

    assertIncludesAll(
      result.messages.map((message) => message.messageId),
      ["presetsMustBeArray"],
    );
  });

  it("reports a preset without fields", async function () {
    const [result] = await lintStyleScript(`
${validInfo}
const ITEM_FIELD_PRESETS = [{ id: "missing" }];
function generate() { return { citations: [], bibliography: [] }; }
`);

    assertIncludesAll(
      result.messages.map((message) => message.messageId),
      ["fieldsMissing"],
    );
  });

  it("accepts a well-formed ITEM_FIELD_VALIDATORS declaration", async function () {
    const [result] = await lintStyleScript(`
${validInfo}
const ITEM_FIELD_VALIDATORS = {
  book: [
    { description: "必须填写标题", check: (item) => Boolean(item.title) },
    { description: "必须填写日期", check: (item) => Boolean(item.date) },
    {
      description: "题名不得为空",
      check: async (item) => Boolean(await item.title),
    },
  ],
  journalArticle: [
    { description: "language 必须填写", check: (item) => Boolean(item.language) },
  ],
};
function generate() { return { citations: [], bibliography: [] }; }
`);

    assert.deepEqual(result.messages, []);
  });

  it("rejects a non-object ITEM_FIELD_VALIDATORS declaration", async function () {
    const [result] = await lintStyleScript(`
${validInfo}
const ITEM_FIELD_VALIDATORS = [
  { book: [] },
];
function generate() { return { citations: [], bibliography: [] }; }
`);

    assertIncludesAll(
      result.messages.map((message) => message.messageId),
      ["validatorsMustBeObject"],
    );
  });

  it("validates ITEM_FIELD_VALIDATORS checker shape", async function () {
    const [result] = await lintStyleScript(`
${validInfo}
const ITEM_FIELD_VALIDATORS = {
  book: [
    { description: "", check: () => true },
    { description: "same", check: "not a function" },
    { description: "same", check: () => true },
  ],
  journalArticle: "not an array",
};
function generate() { return { citations: [], bibliography: [] }; }
`);

    assertIncludesAll(
      result.messages.map((message) => message.messageId),
      [
        "groupMustBeArray",
        "descriptionInvalid",
        "descriptionDuplicate",
        "checkInvalid",
      ],
    );
  });

  it("rejects empty ITEM_FIELD_VALIDATORS groups", async function () {
    const [result] = await lintStyleScript(`
${validInfo}
const ITEM_FIELD_VALIDATORS = {
  book: [],
  journalArticle: "not an array",
};
function generate() { return { citations: [], bibliography: [] }; }
`);

    const ids = result.messages.map((message) => message.messageId);
    assert.equal(
      ids.filter((id) => id === "groupEmpty").length,
      1,
      ids.join(" | "),
    );
    assert.equal(
      ids.filter((id) => id === "groupMustBeArray").length,
      1,
      ids.join(" | "),
    );
  });

  it("validates ITEM_FIELD_VALIDATORS keys statically", async function () {
    const [result] = await lintStyleScript(`
${validInfo}
const itemType = "book";
const ITEM_FIELD_VALIDATORS = {
  [itemType]: [{ description: "动态键", check: () => true }],
  ["journalArticle"]: [{ description: "静态计算键", check: () => true }],
  get book() { return []; },
  ...{},
};
function generate() { return { citations: [], bibliography: [] }; }
`);

    const ids = result.messages.map((message) => message.messageId);
    assert.deepEqual(ids, ["groupKeyMustBeStatic"]);
  });

  it("reports state keys that need trimming or collide after trimming", async function () {
    const ids = await lintParamEntry(`
      {
        id: "mode",
        kind: "state",
        label: "Mode",
        states: { " auto ": "Auto", auto: "Auto again", full: "Full" },
        defaultValue: "auto",
      }
    `);

    assertIncludesAll(ids, ["stateKeyWhitespace", "stateKeyDuplicate"]);
  });

  it("warns when STYLE_OPTIONS is empty", async function () {
    const [result] = await lintStyleScript(`
${validInfo}
const STYLE_OPTIONS = [];
function generate() { return { citations: [], bibliography: [] }; }
`);

    const ids = result.messages.map((message) => message.messageId);
    assert.deepEqual(ids, ["emptyStyleOptions"]);
  });

  it("rejects reserved parameter ids", async function () {
    const ids = await lintParamEntry(`
      { id: "__proto__", kind: "state", label: "Mode", defaultValue: false }
    `);

    assertIncludesAll(ids, ["paramIdReserved"]);
  });

  it("rejects an item type outside the schema revision", async function () {
    const [result] = await lintStyleScript(`
${validInfo}
const ITEM_FIELD_VALIDATORS = {
  bookk: [{ description: "Typo", check: () => true }],
};
function generate() { return { citations: [], bibliography: [] }; }
`);

    const ids = result.messages.map((message) => message.messageId);
    assert.deepEqual(ids, ["unknownItemType"]);
  });

  it("rejects statically certain state and preset caps", async function () {
    const states = Array.from(
      { length: 21 },
      (_, index) => `s${index}: "S${index}"`,
    ).join(", ");
    const presets = Array.from(
      { length: 51 },
      (_, index) => `"p${index}"`,
    ).join(", ");
    const [result] = await lintStyleScript(`
${validInfo}
const STYLE_OPTIONS = [
  { id: "mode", kind: "state", label: "Mode", states: { ${states} }, defaultValue: "s0" },
  { id: "value", kind: "value", label: "Value", presets: [${presets}] },
];
function generate() { return { citations: [], bibliography: [] }; }
`);

    const ids = result.messages.map((message) => message.messageId);
    assertIncludesAll(ids, ["tooManyStates", "tooManyPresets"]);
  });
});
