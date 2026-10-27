import { assert } from "chai";
import {
  createStyleMessageReporter,
  MAX_DIAGNOSTICS,
  MAX_TRACE_LINES_PER_RUN,
  withDetail,
  type StyleMessage,
} from "../src/messages";

/**
 * The reporter is the single place that decides what a message *is*: a trace
 * line that may be dropped, or a finding a host keeps. Presentation is not its
 * business, so the sink is everything it hands out.
 */
describe("style message reporter", function () {
  function collect(): {
    sink: StyleMessage[];
    reporter: ReturnType<typeof createStyleMessageReporter>;
  } {
    const sink: StyleMessage[] = [];
    const reporter = createStyleMessageReporter((message) =>
      sink.push(message),
    );
    return { sink, reporter };
  }

  it("sends every severity to the sink with source and code", function () {
    const { sink, reporter } = collect();

    reporter.report({ severity: "trace", source: "style", message: "step" });
    reporter.report({ severity: "info", source: "style", message: "note" });
    reporter.report({
      severity: "warning",
      source: "field-presets",
      message: "ignored",
    });

    assert.deepEqual(
      sink.map((message) => [message.severity, message.source, message.code]),
      [
        ["trace", "style", "style-load"],
        ["info", "style", "style-load"],
        ["warning", "field-presets", "style-load"],
      ],
    );
  });

  it("keeps findings and leaves traces out of them", function () {
    const { reporter } = collect();

    reporter.report({ severity: "trace", source: "style", message: "step" });
    reporter.report({ severity: "info", source: "style", message: "note" });
    reporter.report({
      severity: "error",
      source: "style",
      message: "assertion failed",
    });

    assert.deepEqual(
      reporter.diagnostics.map((message) => message.severity),
      ["info", "error"],
    );
  });

  it("deduplicates findings and caps how many it keeps", function () {
    const { reporter, sink } = collect();

    for (let index = 0; index < 5; index++) {
      reporter.report({
        severity: "warning",
        source: "style",
        message: "same warning",
      });
    }
    assert.lengthOf(reporter.diagnostics, 1);

    for (let index = 0; index < MAX_DIAGNOSTICS + 10; index++) {
      reporter.report({
        severity: "warning",
        source: "style",
        message: `warning ${index}`,
      });
    }
    assert.lengthOf(
      reporter.diagnostics,
      MAX_DIAGNOSTICS + 1,
      "one extra entry tells the host the cap was reached",
    );
    const notice = reporter.diagnostics.at(-1);
    assert.equal(notice?.source, "core");
    assert.equal(notice?.severity, "warning");
    assert.equal(notice?.code, "style-load");
    assert.match(notice?.message ?? "", /Findings exceeded 200/);
    assert.isTrue(
      sink.some((message) => /Findings exceeded 200/.test(message.message)),
      "a sink must hear about the cap too",
    );
  });

  it("reports the cap only when a finding was actually dropped", function () {
    const exact = createStyleMessageReporter();
    for (let index = 0; index < MAX_DIAGNOSTICS; index++) {
      exact.report({
        severity: "warning",
        source: "style",
        message: `exact ${index}`,
      });
    }
    assert.lengthOf(exact.diagnostics, MAX_DIAGNOSTICS);
    assert.notInclude(
      exact.diagnostics.map((message) => message.message),
      `Findings exceeded ${MAX_DIAGNOSTICS}; further findings are suppressed.`,
    );

    const over = createStyleMessageReporter();
    for (let index = 0; index < MAX_DIAGNOSTICS + 1; index++) {
      over.report({
        severity: "warning",
        source: "style",
        message: `over ${index}`,
      });
    }
    assert.lengthOf(over.diagnostics, MAX_DIAGNOSTICS + 1);
    assert.match(
      over.diagnostics.at(-1)?.message ?? "",
      /Findings exceeded 200/,
    );
  });

  it("keeps detail JSON cannot serialize distinct, but stable per object", function () {
    const { reporter } = collect();
    const first = { value: BigInt(1) };
    const second = { value: BigInt(2) };

    reporter.report({
      severity: "warning",
      source: "style",
      message: "same text",
      detail: first,
    });
    reporter.report({
      severity: "warning",
      source: "style",
      message: "same text",
      detail: second,
    });
    reporter.report({
      severity: "warning",
      source: "style",
      message: "same text",
      detail: first,
    });

    assert.lengthOf(
      reporter.diagnostics,
      2,
      "different unserializable details must not fold into one finding",
    );
  });

  it("gives the overflow notice back when its run is replaced", function () {
    const { reporter } = collect();
    const fill = () => {
      for (let index = 0; index < MAX_DIAGNOSTICS + 1; index++) {
        reporter.report({
          severity: "warning",
          source: "style",
          message: `warning ${index}`,
        });
      }
    };

    const firstRun = reporter.beginRun("generate");
    fill();
    firstRun();
    assert.equal(reporter.diagnostics.at(-1)?.code, "generate");

    const secondRun = reporter.beginRun("generate");
    assert.lengthOf(
      reporter.diagnostics,
      0,
      "the new run drops the previous run's findings and notice",
    );
    fill();
    secondRun();
    assert.lengthOf(reporter.diagnostics, MAX_DIAGNOSTICS + 1);
    assert.equal(reporter.diagnostics.at(-1)?.code, "generate");
  });

  it("replaces a run's findings instead of piling them up", function () {
    const { reporter } = collect();

    reporter.report({ severity: "warning", source: "core", message: "load" });
    const findings = reporter.diagnostics;
    assert.deepEqual(
      findings.map((message) => message.code),
      ["style-load"],
    );

    const firstRun = reporter.beginRun("generate");
    reporter.report({ severity: "warning", source: "style", message: "run" });
    firstRun();
    assert.deepEqual(
      findings.map((message) => `${message.code}: ${message.message}`),
      ["style-load: load", "generate: run"],
    );

    const secondRun = reporter.beginRun("generate");
    reporter.report({
      severity: "error",
      source: "style",
      message: "next run",
    });
    secondRun();
    assert.deepEqual(
      reporter.diagnostics.map(
        (message) => `${message.code}: ${message.message}`,
      ),
      ["style-load: load", "generate: next run"],
    );
    assert.strictEqual(
      reporter.diagnostics,
      findings,
      "the array a caller already holds stays live",
    );
  });

  it("tells the same message apart by its code", function () {
    const { reporter } = collect();

    reporter.report({ severity: "warning", source: "style", message: "same" });
    const restore = reporter.beginRun("generate");
    reporter.report({ severity: "warning", source: "style", message: "same" });
    restore();

    assert.deepEqual(
      reporter.diagnostics.map((message) => message.code),
      ["style-load", "generate"],
    );
  });

  it("attributes findings that arrive after a run to that run", function () {
    const { reporter } = collect();

    const restore = reporter.beginRun("generate");
    reporter.report({
      severity: "warning",
      source: "style",
      message: "during",
    });
    restore();
    reporter.report({ severity: "warning", source: "style", message: "late" });

    assert.deepEqual(
      reporter.diagnostics.map(
        (message) => `${message.code}:${message.message}`,
      ),
      ["generate:during", "generate:late"],
    );

    // The next run replaces the abandoned run's findings, not the load's.
    reporter.beginRun("generate");
    assert.deepEqual(reporter.diagnostics, []);
  });

  it("budgets trace lines per run and reports the truncation once", function () {
    const { sink, reporter } = collect();

    const restore = reporter.beginRun("generate");
    for (let index = 0; index < MAX_TRACE_LINES_PER_RUN + 5; index++) {
      reporter.report({
        severity: "trace",
        source: "style",
        message: `line ${index}`,
      });
    }
    restore();

    const traces = sink.filter((message) => message.severity === "trace");
    assert.lengthOf(traces, MAX_TRACE_LINES_PER_RUN);

    const notices = sink.filter((message) => message.severity === "warning");
    assert.lengthOf(notices, 1);
    assert.match(notices[0].message, /Trace output exceeded 1000 lines/);
    assert.equal(notices[0].source, "core");
    assert.equal(notices[0].code, "generate");

    // A new run gets its own budget.
    const secondRun = reporter.beginRun("generate");
    reporter.report({ severity: "trace", source: "style", message: "fresh" });
    secondRun();
    assert.isTrue(
      sink.some((message) => message.message === "fresh"),
      "the second run should not inherit the first run's budget",
    );
  });

  it("attributes messages to the run they happen in and keeps the last run code", function () {
    const { reporter } = collect();

    assert.equal(reporter.code, "style-load");
    const restore = reporter.beginRun("generate");
    assert.equal(reporter.code, "generate");
    restore();
    assert.equal(reporter.code, "generate");

    restore();
    assert.equal(reporter.code, "generate", "restoring twice is a no-op");
  });

  it("attaches style and declaration detail, and keeps distinct locations apart", function () {
    const sink: StyleMessage[] = [];
    const reporter = createStyleMessageReporter(
      (message) => sink.push(message),
      () => ({ style: { id: "probe", title: "Probe" } }),
    );
    const options = withDetail(reporter, {
      declaration: { export: "STYLE_OPTIONS", index: 0 },
    });
    const named = withDetail(options, {
      declaration: { id: "mode" },
    });

    named.report({
      severity: "warning",
      source: "params",
      message: "same text",
    });
    withDetail(reporter, {
      declaration: { export: "CITE_PARAMS", index: 1, id: "rows" },
    }).report({
      severity: "warning",
      source: "params",
      message: "same text",
    });

    assert.lengthOf(
      reporter.diagnostics,
      2,
      "detail is part of a finding's identity",
    );
    assert.deepEqual(reporter.diagnostics[0]?.detail, {
      style: { id: "probe", title: "Probe" },
      declaration: { export: "STYLE_OPTIONS", index: 0, id: "mode" },
    });
    assert.deepEqual(reporter.diagnostics[1]?.detail, {
      style: { id: "probe", title: "Probe" },
      declaration: { export: "CITE_PARAMS", index: 1, id: "rows" },
    });
  });

  it("keeps findings without a sink", function () {
    const reporter = createStyleMessageReporter();

    reporter.report({ severity: "warning", source: "style", message: "note" });

    assert.lengthOf(reporter.diagnostics, 1);
  });

  it("survives a sink that throws", function () {
    const reporter = createStyleMessageReporter(() => {
      throw new Error("sink failed");
    });

    assert.doesNotThrow(() => {
      reporter.report({ severity: "trace", source: "style", message: "step" });
      reporter.report({ severity: "error", source: "style", message: "boom" });
    });
    assert.lengthOf(reporter.diagnostics, 1);
  });
});
