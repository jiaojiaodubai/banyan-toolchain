/* eslint-disable @typescript-eslint/no-explicit-any -- declarations are dynamic here */
import { assert } from "chai";
import {
  normalizeCitationParams,
  normalizeCiteParams,
  normalizeStyleParams,
} from "../src/validation/params";
import {
  createStyleMessageReporter,
  type StyleMessageReporter,
} from "../src/messages";
import { resolveStyleOptionState } from "../src/validation/paramValues";
import { createIdentitySandboxContext } from "./helpers/sandboxContext";

describe("parameter normalization", function () {
  let context: ReturnType<typeof createIdentitySandboxContext>;
  let messages: StyleMessageReporter;

  beforeEach(function () {
    context = createIdentitySandboxContext();
    messages = createStyleMessageReporter();
  });

  it("normalizes boolean and enumerated state parameters", function () {
    const result = normalizeStyleParams(
      [
        { id: "useIbid", kind: "state", label: "Use ibid", defaultValue: true },
        {
          id: "mode",
          kind: "state",
          label: "Mode",
          states: { auto: "Auto", full: "Full" },
          defaultValue: "full",
        },
      ],
      context,
      messages,
    );

    assert.equal(result?.length, 2);
    const [useIbid, mode] = result as any[];
    assert.equal(useIbid.kind, "state");
    assert.isTrue(useIbid.defaultValue);
    assert.deepEqual(mode.states, { auto: "Auto", full: "Full" });
    assert.equal(mode.defaultValue, "full");
  });

  it("normalizes value presets, rich format and validator", function () {
    const result = normalizeStyleParams(
      [
        {
          id: "maxNames",
          kind: "value",
          label: "Max names",
          defaultValue: "3",
          presets: ["1", { label: "All", value: "99" }],
          validate: (value: string) => /^\d+$/.test(value),
        },
        {
          id: "prefix",
          kind: "value",
          label: "Prefix",
          format: "rich",
        },
      ],
      context,
      messages,
    );

    const [max, prefix] = result as any[];
    assert.equal(max.defaultValue, "3");
    assert.deepEqual(max.presets, [
      { label: "1", value: "1" },
      { label: "All", value: "99" },
    ]);
    assert.isTrue(
      resolveStyleOptionState(result, { maxNames: "3" }).states.maxNames
        ?.validation?.valid,
    );
    assert.isFalse(
      resolveStyleOptionState(result, { maxNames: "x" }).states.maxNames
        ?.validation?.valid,
    );
    assert.equal(prefix.format, "rich");
  });

  it("normalizes citation and cite scope callbacks", function () {
    const citation = normalizeCitationParams(
      [
        {
          id: "sort",
          kind: "state",
          label: "Sort",
          defaultValue: false,
          applicable: (c: any, options: any) =>
            c.id === "c1" && options.mode === "auto",
        },
      ],
      context,
      messages,
    );
    const sort = citation?.[0] as any;
    assert.isTrue(sort.applicable({ id: "c1" }, { mode: "auto" }));
    assert.isFalse(sort.applicable({ id: "c2" }, { mode: "auto" }));

    const cite = normalizeCiteParams(
      [
        {
          id: "page",
          kind: "value",
          label: "Page",
          applicable: (c: any, citationArg: any, options: any) =>
            c.item.id === 1 &&
            citationArg.id === "c1" &&
            options.mode === "auto",
          forcedValue: (c: any) => (c.item.id === 1 ? "1" : null),
        },
      ],
      context,
      messages,
    );
    const page = cite?.[0] as any;
    assert.isTrue(
      page.applicable({ item: { id: 1 } }, { id: "c1" }, { mode: "auto" }),
    );
    assert.equal(page.forcedValue({ item: { id: 1 } }), "1");
    assert.isNull(page.forcedValue({ item: { id: 2 } }));
  });

  it("normalizes cite-only lists with value fields", function () {
    const result = normalizeCiteParams(
      [
        {
          id: "pages",
          kind: "list",
          label: "Pages",
          min: 1,
          fields: [
            { id: "start", kind: "value", label: "Start", defaultValue: "" },
            {
              id: "end",
              kind: "value",
              label: "End",
              defaultValue: "",
              format: "plain",
            },
          ],
          defaultValue: [{ start: "1", end: "2" }],
        },
      ],
      context,
      messages,
    );

    const list = result?.[0] as any;
    assert.equal(list.kind, "list");
    assert.equal(list.fields.length, 2);
    assert.equal(list.min, 1);
    assert.deepEqual(list.defaultValue, [{ start: "1", end: "2" }]);
    assert.equal(
      normalizeCitationParams(
        [{ id: "x", kind: "list", label: "X", fields: [] }],
        context,
        messages,
      ),
      undefined,
    );
  });

  it("ignores a static forced list when every declared row is invalid", function () {
    const fields = [{ id: "value", kind: "value" as const, label: "Value" }];
    const malformed = normalizeCiteParams(
      [
        {
          id: "rows",
          kind: "list",
          label: "Rows",
          fields,
          forcedValue: [null],
        },
      ],
      context,
      messages,
    );
    const malformedParam = malformed?.[0] as any;
    assert.notProperty(malformedParam, "forcedValue");
    assert.equal(
      (resolveStyleOptionState(malformed as any, {}).states.rows as any).mode,
      "free",
    );

    const explicitEmpty = normalizeCiteParams(
      [
        {
          id: "rows",
          kind: "list",
          label: "Rows",
          fields,
          forcedValue: [],
        },
      ],
      context,
      messages,
    );
    assert.deepEqual((explicitEmpty?.[0] as any).forcedValue, []);

    const mixed = normalizeCiteParams(
      [
        {
          id: "rows",
          kind: "list",
          label: "Rows",
          fields,
          forcedValue: [null, { value: "kept" }],
        },
      ],
      context,
      messages,
    );
    assert.deepEqual((mixed?.[0] as any).forcedValue, [{ value: "kept" }]);
  });

  it("warns when a declared list value is outside its row bounds", function () {
    const result = normalizeCiteParams(
      [
        {
          id: "pages",
          kind: "list",
          label: "Pages",
          min: 2,
          max: 3,
          fields: [{ id: "start", kind: "value", label: "Start" }],
          defaultValue: [{ start: "1" }],
          forcedValue: [
            { start: "2" },
            { start: "3" },
            { start: "4" },
            { start: "5" },
          ],
        },
      ],
      context,
      messages,
    );

    assert.equal(result?.length, 1);
    const text = messages.diagnostics.map((item) => item.message).join("\n");
    assert.match(text, /defaultValue has 1 row, below min 2/);
    assert.match(text, /forcedValue has 4 rows, above max 3/);
  });

  it("drops state validators and list fields that are not values", function () {
    const result = normalizeCiteParams(
      [
        {
          id: "mode",
          kind: "state",
          label: "Mode",
          defaultValue: false,
          validate: () => true,
        },
        {
          id: "rows",
          kind: "list",
          label: "Rows",
          validate: () => true,
          fields: [
            { id: "ok", kind: "value", label: "OK" },
            { id: "bad", kind: "state", label: "Bad" },
          ],
        },
      ],
      context,
      messages,
    );

    assert.equal(result?.length, 2);
    assert.notProperty(result?.[0] as object, "validate");
    const rows = result?.[1] as any;
    assert.equal(rows.fields.length, 1);
    assert.equal(rows.fields[0].id, "ok");
    assert.isTrue(
      messages.diagnostics.some((item) =>
        item.message.includes("validate is not available on list parameters"),
      ),
    );
    const listWarning = messages.diagnostics.find((item) =>
      item.message.includes("validate is not available on list parameters"),
    );
    assert.deepEqual(listWarning?.detail, {
      declaration: { export: "CITE_PARAMS", id: "rows", index: 1 },
    });
    const fieldWarning = messages.diagnostics.find((item) =>
      item.message.includes("list fields must be value parameters"),
    );
    assert.deepEqual(fieldWarning?.detail, {
      declaration: {
        export: "CITE_PARAMS",
        id: "rows",
        index: 1,
        field: "bad",
        fieldIndex: 1,
      },
    });
  });

  it("reports declaration keys it does not use", function () {
    normalizeStyleParams(
      [
        {
          id: "typo",
          kind: "value",
          label: "Typo",
          statr: "x",
        },
      ],
      context,
      messages,
    );
    normalizeCiteParams(
      [
        {
          id: "rows",
          kind: "list",
          label: "Rows",
          fields: [{ id: "start", kind: "value", label: "Start" }],
          defaultValue: [{ statr: "1" }],
        },
      ],
      context,
      messages,
    );

    const text = messages.diagnostics.map((item) => item.message).join("\n");
    assert.match(text, /'typo': unknown key 'statr' is ignored/);
    assert.match(text, /unknown field 'statr' is ignored/);
  });

  it("rejects reserved keys and reports state/preset truncation", function () {
    const states = Object.fromEntries(
      Array.from({ length: 21 }, (_, index) => [`s${index}`, `S${index}`]),
    );
    const presets = Array.from({ length: 51 }, (_, index) => `p${index}`);

    const result = normalizeStyleParams(
      [
        { id: "__proto__", kind: "value", label: "Bad" },
        {
          id: "mode",
          kind: "state",
          label: "Mode",
          states,
          defaultValue: "s0",
        },
        {
          id: "form",
          kind: "value",
          label: "Form",
          presets,
        },
      ],
      context,
      messages,
    );

    assert.equal(result?.length, 2);
    const [mode, form] = result as any[];
    assert.equal(Object.keys(mode.states).length, 20);
    assert.equal(form.presets.length, 50);
    const text = messages.diagnostics.map((item) => item.message).join("\n");
    assert.match(text, /cannot be used as a parameter id/);
    assert.match(text, /states are capped at 20/);
    assert.match(text, /presets are capped at 50/);
  });

  it("keeps a truncated default and static forced state selectable", function () {
    const states = Object.fromEntries(
      Array.from({ length: 25 }, (_, index) => [`s${index}`, `S${index}`]),
    );

    const result = normalizeStyleParams(
      [
        {
          id: "mode",
          kind: "state",
          label: "Mode",
          states,
          defaultValue: "s24",
          forcedValue: "s23",
        },
      ],
      context,
      messages,
    );

    const mode = result?.[0] as any;
    assert.equal(Object.keys(mode.states).length, 20);
    assert.equal(mode.defaultValue, "s24");
    assert.equal(mode.forcedValue, "s23");
    assert.property(mode.states, "s24");
    assert.property(mode.states, "s23");
    assert.notProperty(mode.states, "s22");
    assert.match(
      messages.diagnostics.map((item) => item.message).join("\n"),
      /dropped: .*s22/,
    );
  });

  it("trims declared state values before matching trimmed keys", function () {
    const states = Object.fromEntries(
      Array.from({ length: 25 }, (_, index) => [`s${index}`, `S${index}`]),
    );

    const result = normalizeStyleParams(
      [
        {
          id: "mode",
          kind: "state",
          label: "Mode",
          states: { ...states, " padded ": "Padded" },
          defaultValue: " s24 ",
          forcedValue: " padded ",
        },
      ],
      context,
      messages,
    );

    const mode = result?.[0] as any;
    assert.equal(mode.defaultValue, "s24");
    assert.equal(mode.forcedValue, "padded");
    assert.property(mode.states, "s24");
    assert.property(mode.states, "padded");
    assert.notProperty(mode.states, " s24 ");
  });

  it("rejects a reserved key as a list field id", function () {
    const result = normalizeCiteParams(
      [
        {
          id: "rows",
          kind: "list",
          label: "Rows",
          fields: [
            { id: "__proto__", kind: "value", label: "Bad" },
            { id: "ok", kind: "value", label: "OK" },
          ],
        },
      ],
      context,
      messages,
    );

    const list = result?.[0] as any;
    assert.equal(list.fields.length, 1);
    assert.equal(list.fields[0].id, "ok");
    assert.isTrue(
      messages.diagnostics.some((item) =>
        item.message.includes("cannot be used as a field id"),
      ),
    );
  });

  it("drops unknown kinds and applies the style option cap", function () {
    assert.equal(
      normalizeStyleParams(
        [{ id: "old", type: "text", label: "Old", value: "" }],
        context,
        messages,
      ),
      undefined,
    );
    assert.equal(
      normalizeStyleParams(
        {
          mode: {
            id: "mode",
            kind: "state",
            label: "Mode",
            defaultValue: false,
          },
        },
        context,
        messages,
      ),
      undefined,
    );

    const make = (count: number) =>
      Array.from({ length: count }, (_, index) => ({
        id: `opt${index}`,
        kind: "state" as const,
        label: `Option ${index}`,
        defaultValue: false,
      }));
    assert.equal(normalizeStyleParams(make(17), context, messages)?.length, 16);
  });
});
