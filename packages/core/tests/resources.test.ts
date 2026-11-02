import { assert } from "chai";
import { createStyle } from "../src/sandbox/createStyle";
import { createResourceRuntime } from "../src/sandbox/resources";
import type { ResolvedStyleSource, StyleHost } from "../src/host";
import { resolveHost } from "../src/host";
import type { CitationContext, StyleResult } from "../src/types/style";
import { createStyleMessageReporter } from "../src/messages";
import { renderRichTextToText } from "../src/richText/render";
import { createNodeHost } from "../dev/node-host/runtime";
import { MAX_RESOURCE_BYTES } from "@banyan/style-contract";

/**
 * Resource contract: `loadResource()` reads only declared ids, derives the
 * fixed `assets/<id>` path, bounds bytes and time, and hands the style frozen
 * instance-level data. Assets are shared, publicly maintained files, so there
 * is no path and no per-style validator.
 */

const contexts: CitationContext[] = [
  {
    id: "ctx-1",
    page: 1,
    cites: [
      {
        item: { id: "1", itemType: "book", title: "First", creators: [] },
        params: {},
      },
    ],
    params: {},
  },
];

function info(id: string): string {
  return `const INFO = {
  id: ${JSON.stringify(id)},
  title: ${JSON.stringify(id)},
  description: "",
  citationType: "intext-citation",
  creator: [],
  tags: [],
  documentation: [],
  license: "MIT",
  updated: "2026-01-01",
};`;
}

/** A `readFile` that serves an in-memory map and records every path asked for. */
function readFileReturning(
  files: Record<string, string | Uint8Array>,
  calls: string[] = [],
): (relPath: string) => Promise<Uint8Array> {
  return async (relPath) => {
    calls.push(relPath);
    const value = files[relPath];
    if (value === undefined) {
      throw new Error(`ENOENT: ${relPath}`);
    }
    return typeof value === "string" ? new TextEncoder().encode(value) : value;
  };
}

function hostWith(
  readFile?: (relPath: string) => Promise<Uint8Array>,
  resolveStyle?: (id: string) => Promise<ResolvedStyleSource | null>,
): StyleHost {
  return createNodeHost({
    ...(readFile ? { readFile } : {}),
    ...(resolveStyle ? { resolveStyle } : {}),
  });
}

function resourceStyle(id: string, declarations: string, body: string): string {
  return [info(id), `const STYLE_RESOURCES = ${declarations};`, body].join(
    "\n",
  );
}

function outcome(result: StyleResult): unknown {
  return JSON.parse(renderRichTextToText(result.citations[0]!.content));
}

const RESOURCE_REPORT = `async function generate() {
  const first = await loadResource("words");
  const second = await loadResource("words");
  const report = {
    ok: first.ok,
    reason: first.ok ? null : first.reason,
    data: first.ok ? first.data : null,
    same: first === second,
    frozen: first.ok ? Object.isFrozen(first.data) : false,
  };
  return {
    citations: contexts.map(function (context) {
      return { id: context.id, content: JSON.stringify(report) };
    }),
    bibliography: [],
  };
}`;

function reportOf(
  diagnostics: readonly { finding?: { diagnosticId?: string } }[],
) {
  return diagnostics.map((message) => message.finding?.diagnosticId);
}

describe("loadResource()", function () {
  it("reads assets/<id> once and hands back frozen data", async function () {
    const calls: string[] = [];
    const host = hostWith(
      readFileReturning({ "assets/words": '["a","b"]' }, calls),
    );
    const style = await createStyle(
      host,
      resourceStyle(
        "core",
        `[{ id: "words", format: "json" }]`,
        RESOURCE_REPORT,
      ),
    );

    const report = outcome(await style.generate(contexts)) as Record<
      string,
      unknown
    >;
    assert.equal(report.ok, true);
    assert.deepEqual(report.data, ["a", "b"]);
    assert.equal(report.same, true);
    assert.equal(report.frozen, true);
    assert.deepEqual(calls, ["assets/words"]);
  });

  it("reads a declared text asset", async function () {
    const host = hostWith(readFileReturning({ "assets/words": "hello" }));
    const style = await createStyle(
      host,
      resourceStyle(
        "core",
        `[{ id: "words", format: "text" }]`,
        RESOURCE_REPORT,
      ),
    );

    const report = outcome(await style.generate(contexts)) as Record<
      string,
      unknown
    >;
    assert.equal(report.data, "hello");
  });

  it("never falls back to a bare file at the style root", async function () {
    const calls: string[] = [];
    const host = hostWith(readFileReturning({ words: "hello" }, calls));
    const style = await createStyle(
      host,
      resourceStyle(
        "core",
        `[{ id: "words", format: "text" }]`,
        RESOURCE_REPORT,
      ),
    );

    const report = outcome(await style.generate(contexts)) as Record<
      string,
      unknown
    >;
    assert.equal(report.ok, false);
    assert.equal(report.reason, "missing");
    // Failures are retryable, so the two calls in the report each ask the host;
    // no call falls back to the bare `words` file at the style root.
    assert.deepEqual(calls, ["assets/words", "assets/words"]);
  });

  it("returns undeclared without calling the host", async function () {
    const calls: string[] = [];
    const host = hostWith(readFileReturning({ "assets/words": "x" }, calls));
    const style = await createStyle(
      host,
      resourceStyle(
        "core",
        `[{ id: "words", format: "text" }]`,
        `async function generate() {
  const loaded = await loadResource("other");
  return { citations: [{ id: contexts[0].id, content: loaded.ok ? "ok" : loaded.reason }], bibliography: [] };
}`,
      ),
    );

    assert.equal(
      renderRichTextToText(
        (await style.generate(contexts)).citations[0]!.content,
      ),
      "undeclared",
    );
    assert.deepEqual(calls, []);
  });

  it("returns unavailable when the host has no readFile capability", async function () {
    const style = await createStyle(
      hostWith(),
      resourceStyle(
        "core",
        `[{ id: "words", format: "text" }]`,
        RESOURCE_REPORT,
      ),
    );

    const report = outcome(await style.generate(contexts)) as Record<
      string,
      unknown
    >;
    assert.equal(report.ok, false);
    assert.equal(report.reason, "unavailable");
  });

  it("returns missing for a host read error", async function () {
    const host = hostWith(async () => {
      throw new Error("EACCES: cannot read");
    });
    const style = await createStyle(
      host,
      resourceStyle(
        "core",
        `[{ id: "words", format: "json" }]`,
        RESOURCE_REPORT,
      ),
    );

    const report = outcome(await style.generate(contexts)) as Record<
      string,
      unknown
    >;
    assert.equal(report.ok, false);
    assert.equal(report.reason, "missing");
  });

  it("reports too-large when the host refuses the read for its own size cap", async function () {
    const host = hostWith(async () => {
      throw Object.assign(new Error("file too large"), { reason: "too-large" });
    });
    const style = await createStyle(
      host,
      resourceStyle(
        "core",
        `[{ id: "words", format: "json" }]`,
        RESOURCE_REPORT,
      ),
    );

    const report = outcome(await style.generate(contexts)) as Record<
      string,
      unknown
    >;
    assert.equal(report.ok, false);
    assert.equal(report.reason, "too-large");
  });

  it("returns too-large past the core byte cap even when the host has none", async function () {
    const host = hostWith(
      readFileReturning({
        "assets/words": new Uint8Array(MAX_RESOURCE_BYTES + 1),
      }),
    );
    const style = await createStyle(
      host,
      resourceStyle(
        "core",
        `[{ id: "words", format: "json" }]`,
        RESOURCE_REPORT,
      ),
    );

    const report = outcome(await style.generate(contexts)) as Record<
      string,
      unknown
    >;
    assert.equal(report.ok, false);
    assert.equal(report.reason, "too-large");
  });

  it("returns invalid for malformed json", async function () {
    const host = hostWith(readFileReturning({ "assets/words": "{ not json" }));
    const style = await createStyle(
      host,
      resourceStyle(
        "core",
        `[{ id: "words", format: "json" }]`,
        RESOURCE_REPORT,
      ),
    );

    const report = outcome(await style.generate(contexts)) as Record<
      string,
      unknown
    >;
    assert.equal(report.ok, false);
    assert.equal(report.reason, "invalid");
  });

  it("returns invalid for malformed UTF-8", async function () {
    const host = hostWith(
      readFileReturning({ "assets/words": new Uint8Array([0xff]) }),
    );
    const style = await createStyle(
      host,
      resourceStyle(
        "core",
        `[{ id: "words", format: "text" }]`,
        RESOURCE_REPORT,
      ),
    );

    const report = outcome(await style.generate(contexts)) as Record<
      string,
      unknown
    >;
    assert.equal(report.ok, false);
    assert.equal(report.reason, "invalid");
  });

  it("reports one finding when the same failure repeats in a run", async function () {
    const host = hostWith(async () => {
      throw new Error("ENOENT");
    });
    const style = await createStyle(
      host,
      resourceStyle(
        "core",
        `[{ id: "words", format: "json" }]`,
        `async function generate() {
  const first = await loadResource("words");
  const second = await loadResource("words");
  return {
    citations: [{ id: contexts[0].id, content: (first.ok ? "ok" : first.reason) + "|" + (second.ok ? "ok" : second.reason) }],
    bibliography: [],
  };
}`,
      ),
    );

    assert.equal(
      renderRichTextToText(
        (await style.generate(contexts)).citations[0]!.content,
      ),
      "missing|missing",
    );
    assert.equal(
      style.diagnostics.filter(
        (message) => message.finding?.diagnosticId === "resource.missing",
      ).length,
      1,
    );
  });

  it("keeps a declared snapshot across runs", async function () {
    const calls: string[] = [];
    const host = hostWith(
      readFileReturning({ "assets/words": '["a"]' }, calls),
    );
    const style = await createStyle(
      host,
      resourceStyle(
        "core",
        `[{ id: "words", format: "json" }]`,
        RESOURCE_REPORT,
      ),
    );

    await style.generate(contexts);
    await style.generate(contexts);
    assert.deepEqual(calls, ["assets/words"]);
  });

  it("coalesces concurrent reads into one host read and one snapshot", async function () {
    let calls = 0;
    const host = hostWith(async () => {
      calls += 1;
      await new Promise((resolve) => setTimeout(resolve, 10));
      return new TextEncoder().encode('["a"]');
    });
    const style = await createStyle(
      host,
      resourceStyle(
        "core",
        `[{ id: "words", format: "json" }]`,
        `async function generate() {
  const both = await Promise.all([loadResource("words"), loadResource("words")]);
  return {
    citations: [{ id: contexts[0].id, content: JSON.stringify({ same: both[0] === both[1], ok: both[0].ok }) }],
    bibliography: [],
  };
}`,
      ),
    );

    const report = outcome(await style.generate(contexts)) as Record<
      string,
      unknown
    >;
    assert.equal(report.ok, true);
    assert.equal(report.same, true);
    assert.equal(calls, 1);
  });
});

describe("resource declarations", function () {
  async function declarationsOf(
    declarations: string,
    readFile = readFileReturning({ "assets/words": "hello" }),
  ) {
    const style = await createStyle(
      hostWith(readFile),
      resourceStyle("core", declarations, RESOURCE_REPORT),
    );
    return { style, report: outcome(await style.generate(contexts)) };
  }

  it("drops invalid ids before the host ever sees a path", async function () {
    for (const id of [
      "Words",
      "words.json",
      "../words",
      "words/other",
      "words words",
    ]) {
      const calls: string[] = [];
      const { report } = await declarationsOf(
        `[{ id: ${JSON.stringify(id)}, format: "text" }]`,
        readFileReturning({ "assets/words": "hello" }, calls),
      );
      assert.equal(
        (report as Record<string, unknown>).reason,
        "undeclared",
        id,
      );
      assert.deepEqual(calls, [], id);
    }
  });

  it("reports an overlong id instead of reading it", async function () {
    const calls: string[] = [];
    const { style } = await declarationsOf(
      `[{ id: "${"a".repeat(65)}", format: "text" }]`,
      readFileReturning({ "assets/words": "hello" }, calls),
    );
    assert.include(reportOf(style.diagnostics), "resource.id.invalid");
    assert.deepEqual(calls, []);
  });

  it("drops an obsolete path key but still loads assets/<id>", async function () {
    const calls: string[] = [];
    const { style, report } = await declarationsOf(
      `[{ id: "words", path: "assets/words.json", format: "text" }]`,
      readFileReturning({ "assets/words": "hello" }, calls),
    );
    assert.equal((report as Record<string, unknown>).data, "hello");
    assert.include(reportOf(style.diagnostics), "resource.path.invalid");
    assert.deepEqual(calls, ["assets/words"]);
  });

  it("drops an obsolete validate key without running it", async function () {
    const { style, report } = await declarationsOf(
      `[{ id: "words", format: "text", validate: function () { throw new Error("must not run"); } }]`,
    );
    assert.equal((report as Record<string, unknown>).data, "hello");
    assert.include(reportOf(style.diagnostics), "resource.validate.invalid");
  });

  it("reports an unknown key without dropping the resource", async function () {
    const { style, report } = await declarationsOf(
      `[{ id: "words", format: "text", note: "x" }]`,
    );
    assert.equal((report as Record<string, unknown>).data, "hello");
    assert.include(reportOf(style.diagnostics), "declaration.key.unknown");
  });

  it("re-checks the id inside the runtime, without trusting the declaration", async function () {
    const calls: string[] = [];
    const reporter = createStyleMessageReporter();
    const runtime = createResourceRuntime({
      host: () => resolveHost(hostWith(readFileReturning({}, calls))),
      messages: reporter,
    });
    runtime.configure([{ id: "../secret", format: "json" }]);
    runtime.beginRun();

    const result = await runtime.load("../secret");
    assert.equal(result.ok === false && result.reason, "invalid");
    assert.deepEqual(calls, []);
  });

  it("times out a read that never settles and fails fast afterwards", async function () {
    const reporter = createStyleMessageReporter();
    const runtime = createResourceRuntime({
      host: () =>
        resolveHost(hostWith(() => new Promise<Uint8Array>(() => {}))),
      messages: reporter,
      timeoutMs: 20,
    });
    runtime.configure([{ id: "words", format: "json" }]);
    runtime.beginRun();

    const first = await runtime.load("words");
    assert.equal(first.ok === false && first.reason, "timeout");
    const second = await runtime.load("words");
    assert.equal(second.ok === false && second.reason, "timeout");

    // A new run gives the id another chance instead of failing forever.
    runtime.beginRun();
    const third = await runtime.load("words");
    assert.equal(third.ok === false && third.reason, "timeout");
    assert.equal(
      reporter.diagnostics.filter(
        (message) => message.finding?.diagnosticId === "resource.timeout",
      ).length,
      2,
    );
  });
});

describe("resource isolation across delegation", function () {
  it("resolves a delegated style's assets/<id> in its own directory", async function () {
    const parentCalls: string[] = [];
    const guestCalls: string[] = [];
    const parentHost = createNodeHost({
      readFile: readFileReturning(
        { "assets/words": "parent words" },
        parentCalls,
      ),
      resolveStyle: async (id) =>
        id === "guest"
          ? {
              code: [
                info("guest"),
                `const STYLE_RESOURCES = [{ id: "words", format: "text" }];`,
                `async function generate() {
  const loaded = await loadResource("words");
  return {
    citations: contexts.map(function (context) {
      return { id: context.id, content: loaded.ok ? loaded.data : "missing" };
    }),
    bibliography: [],
  };
}`,
              ].join("\n"),
              readFile: readFileReturning(
                { "assets/words": "guest words" },
                guestCalls,
              ),
            }
          : null,
    });

    const style = await createStyle(
      parentHost,
      resourceStyle(
        "host",
        `[{ id: "words", format: "text" }]`,
        `const STYLE_DEPENDENCIES = ["guest"];
async function generate() {
  const own = await loadResource("words");
  const guest = await callStyle("guest", contexts);
  return {
    citations: contexts.map(function (context) {
      return {
        id: context.id,
        content: (own.ok ? own.data : "missing") + " | " + (guest.ok ? plainText(guest.citations[0]) : guest.reason),
      };
    }),
    bibliography: [],
  };
}`,
      ),
    );

    const result = await style.generate(contexts);
    assert.equal(
      renderRichTextToText(result.citations[0]!.content),
      "parent words | guest words",
    );
    assert.deepEqual(parentCalls, ["assets/words"]);
    assert.deepEqual(guestCalls, ["assets/words"]);
  });

  it("reports unavailable for a delegated style whose host supplies no readFile", async function () {
    const guestSource = [
      info("guest"),
      `const STYLE_RESOURCES = [{ id: "words", format: "text" }];`,
      `async function generate() {
  const loaded = await loadResource("words");
  return {
    citations: contexts.map(function (context) {
      return { id: context.id, content: loaded.ok ? loaded.data : loaded.reason };
    }),
    bibliography: [],
  };
}`,
    ].join("\n");
    const style = await createStyle(
      createNodeHost({
        readFile: readFileReturning({ "assets/words": "parent words" }),
        resolveStyle: async () => ({ code: guestSource }),
      }),
      [
        info("host"),
        `const STYLE_DEPENDENCIES = ["guest"];`,
        `async function generate() {
  const guest = await callStyle("guest", contexts);
  return {
    citations: contexts.map(function (context) {
      return { id: context.id, content: guest.ok ? plainText(guest.citations[0]) : guest.reason };
    }),
    bibliography: [],
  };
}`,
      ].join("\n"),
    );

    const result = await style.generate(contexts);
    // The child kept the parent's readFile removed and returned `unavailable`
    // from its own loadResource(), which is a successful delegation result.
    assert.equal(
      renderRichTextToText(result.citations[0]!.content),
      "unavailable",
    );
  });
});
