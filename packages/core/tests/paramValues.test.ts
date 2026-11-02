import { assert } from "chai";
import type {
  CitationContext,
  Cite,
  CitationParam,
  CiteParam,
  StyleOptionParam,
} from "../src/types/style";
import {
  resolveCitationParamValues,
  resolveCiteParamValues,
  resolveStyleOptionState,
} from "../src/validation/paramValues";

describe("parameter value resolution", function () {
  it("fills style defaults and reads forced values", function () {
    const params: StyleOptionParam[] = [
      {
        id: "mode",
        kind: "state",
        label: "Mode",
        states: { auto: "Auto", full: "Full" },
        defaultValue: "auto",
      },
      {
        id: "form",
        kind: "state",
        label: "Form",
        states: { short: "Short", long: "Long" },
        defaultValue: "short",
        forcedValue: (values) => (values.mode === "full" ? "long" : null),
      },
    ];

    const defaults = resolveStyleOptionState(params, {});
    assert.deepEqual(defaults.storedValues, { mode: "auto", form: "short" });
    assert.deepEqual(defaults.effectiveValues, {
      mode: "auto",
      form: "short",
    });
    assert.deepEqual(defaults.states.form, {
      mode: "free",
      value: "short",
    });

    const forced = resolveStyleOptionState(params, {
      mode: "full",
      form: "short",
    });
    assert.deepEqual(forced.storedValues, { mode: "full", form: "short" });
    assert.deepEqual(forced.effectiveValues, {
      mode: "full",
      form: "long",
    });
    assert.deepEqual(forced.states.form, {
      mode: "forced",
      value: "long",
    });
  });

  it("uses a forced function with several conditions and null for free", function () {
    const params: StyleOptionParam[] = [
      {
        id: "kind",
        kind: "state",
        label: "Kind",
        states: { a: "A", b: "B", c: "C" },
        defaultValue: "c",
      },
      {
        id: "form",
        kind: "value",
        label: "Form",
        defaultValue: "default",
        forcedValue: (values) => {
          if (values.kind === "a") return "A";
          if (values.kind === "b") return "B";
          return null;
        },
      },
    ];

    const c = resolveStyleOptionState(params, { form: "mine", kind: "c" });
    assert.equal(c.effectiveValues.form, "mine");

    const a = resolveStyleOptionState(params, { form: "mine", kind: "a" });
    assert.equal(a.effectiveValues.form, "A");
    assert.equal(a.storedValues.form, "mine");

    const b = resolveStyleOptionState(params, { kind: "b" });
    assert.equal(b.effectiveValues.form, "B");
  });

  it("resolves citation and cite parameters with effective parent values", function () {
    const citation: CitationContext = {
      id: "c1",
      page: 1,
      cites: [{ item: { id: 1 } as never }],
      params: {},
    };
    const citationParams: CitationParam[] = [
      {
        id: "mode",
        kind: "state",
        label: "Mode",
        states: { short: "Short", full: "Full" },
        defaultValue: "short",
      },
      {
        id: "header",
        kind: "value",
        label: "Header",
        defaultValue: "",
        applicable: (_citation, options) => options.styleMode !== "off",
      },
    ];

    const result = resolveCitationParamValues(citationParams, citation, {
      styleMode: "on",
    });
    assert.equal(result.effectiveValues.mode, "short");
    assert.equal(result.effectiveValues.header, "");
    assert.equal(result.citation.params.mode, "short");

    const hidden = resolveCitationParamValues(citationParams, citation, {
      styleMode: "off",
    });
    assert.deepEqual(hidden.states.header, {
      mode: "hidden",
      value: "",
    });

    const cite: Cite = {
      item: { id: 1 } as never,
      params: { page: "9" },
    };
    const citeParams: CiteParam[] = [
      {
        id: "page",
        kind: "value",
        label: "Page",
        defaultValue: "",
      },
      {
        id: "detail",
        kind: "value",
        label: "Detail",
        defaultValue: "",
        applicable: (current, parent, options) =>
          current.params?.page === "9" &&
          parent.id === "c1" &&
          options.styleMode === "on",
      },
    ];
    const citeResult = resolveCiteParamValues(
      citeParams,
      cite,
      result.citation,
      {
        styleMode: "on",
      },
    );
    assert.equal(citeResult.effectiveValues.page, "9");
    assert.equal(citeResult.effectiveValues.detail, "");

    const hiddenDetail = resolveCiteParamValues(
      citeParams,
      cite,
      result.citation,
      {
        styleMode: "off",
      },
    );
    assert.deepEqual(hiddenDetail.states.detail, {
      mode: "hidden",
      value: "",
    });
  });

  it("preserves unknown citation/cite params but drops unknown style options", function () {
    const citation: CitationContext = {
      id: "c1",
      page: 1,
      cites: [],
      params: { pluginFlag: "keep" },
    };
    const result = resolveCitationParamValues(
      [
        {
          id: "declared",
          kind: "value",
          label: "Declared",
          defaultValue: "d",
        },
      ],
      citation,
      {},
    );
    assert.deepEqual(result.effectiveValues, {
      pluginFlag: "keep",
      declared: "d",
    });
    assert.deepEqual(
      resolveStyleOptionState([], { pluginFlag: "drop" }).effectiveValues,
      {},
    );
  });

  it("runs a validator only for free values and exposes its result", function () {
    const params: StyleOptionParam[] = [
      {
        id: "mode",
        kind: "state",
        label: "Mode",
        states: { short: "Short", full: "Full" },
        defaultValue: "short",
      },
      {
        id: "label",
        kind: "value",
        label: "Label",
        defaultValue: "",
        validate: (value, values) =>
          value ? true : `missing label in ${values.mode} mode`,
      },
    ];

    const invalid = resolveStyleOptionState(params, { mode: "full" });
    assert.deepEqual(invalid.states.label?.validation, {
      valid: false,
      message: "missing label in full mode",
    });

    const valid = resolveStyleOptionState(params, { label: "x" });
    assert.deepEqual(valid.states.label?.validation, { valid: true });

    const skipped = resolveStyleOptionState(
      params,
      { label: "" },
      { validate: false },
    );
    assert.isUndefined(skipped.states.label?.validation);

    const hidden = resolveCitationParamValues(
      [
        {
          id: "hidden",
          kind: "value",
          label: "Hidden",
          applicable: () => false,
          validate: () => {
            throw new Error("must not run");
          },
        },
      ],
      { id: "c1", page: 1, cites: [], params: {} },
      {},
    );
    assert.isUndefined(hidden.states.hidden?.validation);

    const forced = resolveStyleOptionState(
      [
        {
          id: "forced",
          kind: "value",
          label: "Forced",
          forcedValue: () => "locked",
          validate: () => {
            throw new Error("must not run");
          },
        },
      ],
      {},
    );
    assert.isUndefined(forced.states.forced?.validation);
  });

  it("turns false, messages, throws and malformed results into validation", function () {
    const params: StyleOptionParam[] = [
      { id: "no", kind: "value", label: "No", validate: () => false },
      {
        id: "message",
        kind: "value",
        label: "Message",
        validate: () => "  not a number  ",
      },
      {
        id: "throws",
        kind: "value",
        label: "Throws",
        validate: () => {
          throw new Error("boom");
        },
      },
      {
        id: "crossRealm",
        kind: "value",
        label: "Cross realm",
        validate: () => {
          throw { message: "sandbox boom" };
        },
      },
      {
        id: "unsupported",
        kind: "value",
        label: "Unsupported",
        validate: () => 42 as never,
      },
      {
        id: "async",
        kind: "value",
        label: "Async",
        validate: (() => Promise.resolve(true)) as never,
      },
    ];

    const states = resolveStyleOptionState(params, {}).states;
    assert.deepEqual(states.no?.validation, { valid: false });
    assert.deepEqual(states.message?.validation, {
      valid: false,
      message: "not a number",
    });
    assert.deepEqual(states.throws?.validation, {
      valid: false,
      message: "boom",
    });
    assert.deepEqual(states.crossRealm?.validation, {
      valid: false,
      message: "sandbox boom",
    });
    assert.isFalse(states.unsupported?.validation?.valid);
    assert.match(
      states.unsupported?.validation?.message ?? "",
      /unsupported result/,
    );
    assert.match(
      states.async?.validation?.message ?? "",
      /must return synchronously/,
    );
  });

  it("gives citation validators the effective citation and options", function () {
    const params: CitationParam[] = [
      {
        id: "header",
        kind: "value",
        label: "Header",
        defaultValue: "",
        validate: (value, citation, options) =>
          value === "x" && citation.id === "c1" && options.mode === "short"
            ? true
            : "wrong scope",
      },
    ];

    const valid = resolveCitationParamValues(
      params,
      { id: "c1", page: 1, cites: [], params: { header: "x" } },
      { mode: "short" },
    );
    assert.deepEqual(valid.states.header?.validation, { valid: true });

    const invalid = resolveCitationParamValues(
      params,
      { id: "c2", page: 1, cites: [], params: { header: "x" } },
      { mode: "short" },
    );
    assert.deepEqual(invalid.states.header?.validation, {
      valid: false,
      message: "wrong scope",
    });
  });

  it("validates list fields once per row with cite scope", function () {
    const params: CiteParam[] = [
      {
        id: "pages",
        kind: "list",
        label: "Pages",
        fields: [
          {
            id: "start",
            kind: "value",
            label: "Start",
            defaultValue: "",
            validate: (value, row, cite, citation, options) =>
              /^\d+$/.test(value)
                ? true
                : `${value} at ${String(cite.item.id)}/${citation.id}/${String(options.mode)}/${row.end}`,
          },
          {
            id: "end",
            kind: "value",
            label: "End",
            defaultValue: "",
          },
        ],
      },
    ];
    const cite: Cite = {
      item: { id: 7 } as never,
      params: { pages: [{ start: "1" }, { start: "x" }] },
    };

    const result = resolveCiteParamValues(
      params,
      cite,
      { id: "c1", page: 1, cites: [], params: {} },
      { mode: "short" },
    );

    assert.deepEqual(result.states.pages?.fieldValidation?.start, [
      { valid: true, source: "provided" },
      { valid: false, message: "x at 7/c1/short/", source: "provided" },
    ]);
    assert.notProperty(result.states.pages?.fieldValidation ?? {}, "end");

    const skipped = resolveCiteParamValues(
      params,
      cite,
      { id: "c1", page: 1, cites: [], params: {} },
      {},
      { validate: false },
    );
    assert.isUndefined(skipped.states.pages?.fieldValidation);
  });

  it("marks a list cell that was filled from the field default", function () {
    const params: CiteParam[] = [
      {
        id: "pages",
        kind: "list",
        label: "Pages",
        fields: [
          {
            id: "start",
            kind: "value",
            label: "Start",
            defaultValue: "?",
            validate: (value) => (value === "?" ? "fill in a page" : true),
          },
        ],
      },
    ];
    const cite: Cite = {
      item: { id: 7 } as never,
      params: { pages: [{ start: "3" }, {}] },
    };

    const result = resolveCiteParamValues(
      params,
      cite,
      { id: "c1", page: 1, cites: [], params: {} },
      {},
    );

    assert.deepEqual(result.states.pages?.fieldValidation?.start, [
      { valid: true, source: "provided" },
      { valid: false, message: "fill in a page", source: "default" },
    ]);
    // The row was patched, so the parameter-level source says so too.
    assert.equal(result.valueSources.pages, "repaired");
  });

  it("reports whether a stored value was provided, defaulted or repaired", function () {
    const params: StyleOptionParam[] = [
      {
        id: "mode",
        kind: "state",
        label: "Mode",
        states: { auto: "Auto", full: "Full" },
        defaultValue: "auto",
      },
      {
        id: "count",
        kind: "value",
        label: "Count",
        defaultValue: "3",
      },
    ];

    const supplied = resolveStyleOptionState(params, {
      mode: "full",
      count: "9",
    });
    assert.deepEqual(supplied.valueSources, {
      mode: "provided",
      count: "provided",
    });

    const missing = resolveStyleOptionState(params, {});
    assert.deepEqual(missing.valueSources, {
      mode: "default",
      count: "default",
    });
    assert.deepEqual(missing.storedValues, { mode: "auto", count: "3" });

    const repaired = resolveStyleOptionState(params, {
      mode: "bogus",
      count: 9,
    });
    assert.deepEqual(repaired.valueSources, {
      mode: "invalid",
      count: "invalid",
    });
    // The fallback value is still usable; the source is what tells the host
    // that it was not the caller's choice.
    assert.deepEqual(repaired.storedValues, { mode: "auto", count: "3" });

    const cite: Cite = {
      item: { id: 1 } as never,
      params: { pages: "not rows" },
    };
    const citeResult = resolveCiteParamValues(
      [
        {
          id: "pages",
          kind: "list",
          label: "Pages",
          fields: [{ id: "start", kind: "value", label: "Start" }],
        },
      ],
      cite,
      { id: "c1", page: 1, cites: [], params: {} },
      {},
    );
    assert.equal(citeResult.valueSources.pages, "invalid");
    assert.deepEqual(citeResult.storedValues.pages, []);
  });

  it("marks a list whose rows were dropped or patched", function () {
    const params: CiteParam[] = [
      {
        id: "pages",
        kind: "list",
        label: "Pages",
        fields: [
          { id: "start", kind: "value", label: "Start", defaultValue: "?" },
          { id: "end", kind: "value", label: "End", defaultValue: "-" },
        ],
      },
    ];
    const citation = { id: "c1", page: 1, cites: [], params: {} };
    const cite = (params_: Record<string, unknown>): Cite => ({
      item: { id: 1 } as never,
      params: params_ as Cite["params"],
    });

    const mixed = resolveCiteParamValues(
      params,
      cite({
        pages: [{ start: "1", end: "2" }, null, { start: 42 }, { end: "9" }],
      }),
      citation,
      {},
    );
    assert.equal(mixed.valueSources.pages, "repaired");
    assert.deepEqual(mixed.storedValues.pages, [
      { start: "1", end: "2" },
      { start: "?", end: "-" },
      { start: "?", end: "9" },
    ]);

    // Nothing usable: the same fallback as a wrong-kind value.
    const unusable = resolveCiteParamValues(
      params,
      cite({ pages: [null, "nope"] }),
      citation,
      {},
    );
    assert.equal(unusable.valueSources.pages, "invalid");
    assert.deepEqual(unusable.storedValues.pages, []);

    // A supplied empty list is a real choice, not a repair.
    const empty = resolveCiteParamValues(
      params,
      cite({ pages: [] }),
      citation,
      {},
    );
    assert.equal(empty.valueSources.pages, "provided");
    assert.deepEqual(empty.storedValues.pages, []);
  });

  it("normalizes list rows and hides them with the default", function () {
    const cite: Cite = {
      item: { id: 1 } as never,
      params: { rows: [{ start: "1", end: "2", extra: "x" }] },
    };
    const params: CiteParam[] = [
      {
        id: "rows",
        kind: "list",
        label: "Rows",
        applicable: () => false,
        fields: [
          { id: "start", kind: "value", label: "Start", defaultValue: "" },
          { id: "end", kind: "value", label: "End", defaultValue: "" },
        ],
        defaultValue: [{ start: "0", end: "0" }],
      },
    ];
    const result = resolveCiteParamValues(
      params,
      cite,
      { id: "c1", page: 1, cites: [], params: {} },
      {},
    );
    assert.deepEqual(result.effectiveValues.rows, [{ start: "0", end: "0" }]);
    assert.deepEqual(result.storedValues.rows, [{ start: "1", end: "2" }]);
  });
});
