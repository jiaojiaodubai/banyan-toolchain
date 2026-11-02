import { assert } from "chai";
import { createStyle } from "../src/sandbox/createStyle";
import { createResourceRuntime } from "../src/sandbox/resources";
import type { ResolvedStyleSource, StyleHost } from "../src/host";
import type { CitationContext, StyleResult } from "../src/types/style";
import type { ReadOptions } from "../src/types/styleUtils";
import { createStyleMessageReporter } from "../src/messages";
import { renderRichTextToText } from "../src/richText/render";
import { createNodeHost } from "../dev/node-host/runtime";
import { MAX_RESOURCE_BYTES } from "@banyan/style-contract";

/**
 * Resource contract: `loadResource()` reads only declared ids, checks the path
 * itself, bounds bytes and time, and hands the style frozen instance-level data.
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
): (relPath: string, options?: ReadOptions) => Promise<Uint8Array> {
  return async (relPath, options) => {
    calls.push(relPath);
    const value = files[relPath];
    if (value === undefined) {
      throw new Error(`ENOENT: ${relPath}`);
    }
    let bytes =
      typeof value === "string" ? new TextEncoder().encode(value) : value;
    // Mirrors Gecko's `IOUtils.read`: the byte window is applied, not rejected.
    if (options?.maxBytes != null && options.maxBytes !== null) {
      bytes = bytes.subarray(0, Math.max(0, options.maxBytes));
    }
    return bytes;
  };
}

function hostWith(
  readFile?: (relPath: string, options?: ReadOptions) => Promise<Uint8Array>,
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

/** A generate() that reports the loaded value and the two cache guarantees. */
const INSPECT = `async function generate() {
  const first = await loadResource("words");
  const second = await loadResource("words");
  const report = {
    ok: first.ok,
    reason: first.ok ? null : first.reason,
    data: first.ok ? first.data : null,
    same: first === second,
    frozen: first.ok ? Object.isFrozen(first.data) : false,
  };
  if (first.ok) {
    try {
      first.data.push("mutated");
    } catch (error) {
      report.mutationBlocked = true;
    }
  }
  return {
    citations: contexts.map(function (context) {
      return { id: context.id, content: JSON.stringify(report) };
    }),
    bibliography: [],
  };
}`;

describe("loadResource()", function () {
  it("reads a declared json resource once and hands back frozen data", async function () {
    const calls: string[] = [];
    const host = hostWith(
      readFileReturning({ "assets/words.json": '["a","b"]' }, calls),
    );
    const style = await createStyle(
      host,
      resourceStyle(
        "host",
        `[{ id: "words", path: "assets/words.json", format: "json" }]`,
        INSPECT,
      ),
    );

    const result = await style.generate(contexts);
    assert.deepEqual(outcome(result), {
      ok: true,
      reason: null,
      data: ["a", "b"],
      same: true,
      frozen: true,
      mutationBlocked: true,
    });
    // One read even though loadResource() was called twice, and the path is the
    // declared relative one.
    assert.deepEqual(calls, ["assets/words.json"]);
  });

  it("reads text and applies the declaration validator", async function () {
    const host = hostWith(readFileReturning({ "words.txt": "hello" }));
    const style = await createStyle(
      host,
      resourceStyle(
        "host",
        `[{ id: "words", path: "words.txt", format: "text", validate: function (data) { return typeof data === "string" || "expected text"; } }]`,
        INSPECT.replace('first.data.push("mutated")', "first.data.length"),
      ),
    );
    const result = await style.generate(contexts);
    assert.deepEqual(outcome(result), {
      ok: true,
      reason: null,
      data: "hello",
      same: true,
      frozen: true,
    });
  });

  it("returns undeclared without calling the host", async function () {
    const calls: string[] = [];
    const host = hostWith(readFileReturning({}, calls));
    const style = await createStyle(host, resourceStyle("host", `[]`, INSPECT));
    const result = await style.generate(contexts);
    assert.deepEqual(outcome(result), {
      ok: false,
      reason: "undeclared",
      data: null,
      same: false,
      frozen: false,
    });
    assert.deepEqual(calls, []);
  });

  it("returns unavailable when the host has no readFile capability", async function () {
    const style = await createStyle(
      hostWith(),
      resourceStyle(
        "host",
        `[{ id: "words", path: "words.json", format: "json" }]`,
        INSPECT,
      ),
    );
    assert.deepEqual(outcome(await style.generate(contexts)), {
      ok: false,
      reason: "unavailable",
      data: null,
      same: false,
      frozen: false,
    });
  });

  it("returns missing for a host read error", async function () {
    const style = await createStyle(
      hostWith(readFileReturning({})),
      resourceStyle(
        "host",
        `[{ id: "words", path: "words.json", format: "json" }]`,
        INSPECT,
      ),
    );
    assert.deepEqual(outcome(await style.generate(contexts)), {
      ok: false,
      reason: "missing",
      data: null,
      same: false,
      frozen: false,
    });
    assert.equal(
      style.diagnostics.some(
        (message) => message.finding?.diagnosticId === "resource.missing",
      ),
      true,
    );
  });

  it("reports too-large when the host refuses the read for its own size cap", async function () {
    const style = await createStyle(
      hostWith(async () => {
        throw Object.assign(new Error("host cap: file is too big"), {
          code: "host-capability",
          reason: "too-large",
        });
      }),
      resourceStyle(
        "host",
        `[{ id: "words", path: "words.json", format: "json" }]`,
        INSPECT,
      ),
    );
    assert.deepEqual(outcome(await style.generate(contexts)), {
      ok: false,
      reason: "too-large",
      data: null,
      same: false,
      frozen: false,
    });
    assert.equal(
      style.diagnostics.some(
        (message) => message.finding?.diagnosticId === "resource.too-large",
      ),
      true,
    );
  });

  it("keeps an unmarked host refusal as missing", async function () {
    const style = await createStyle(
      hostWith(async () => {
        throw Object.assign(new Error("permission denied"), {
          code: "host-capability",
        });
      }),
      resourceStyle(
        "host",
        `[{ id: "words", path: "words.json", format: "json" }]`,
        INSPECT,
      ),
    );
    assert.deepEqual(outcome(await style.generate(contexts)), {
      ok: false,
      reason: "missing",
      data: null,
      same: false,
      frozen: false,
    });
  });

  it("returns too-large past the core byte cap even when the host has none", async function () {
    const oversized = new Uint8Array(MAX_RESOURCE_BYTES + 1);
    const style = await createStyle(
      hostWith(readFileReturning({ "big.json": oversized })),
      resourceStyle(
        "host",
        `[{ id: "words", path: "big.json", format: "json" }]`,
        INSPECT,
      ),
    );
    assert.deepEqual(outcome(await style.generate(contexts)), {
      ok: false,
      reason: "too-large",
      data: null,
      same: false,
      frozen: false,
    });
  });

  it("returns invalid for malformed json", async function () {
    const style = await createStyle(
      hostWith(readFileReturning({ "words.json": "{ not json" })),
      resourceStyle(
        "host",
        `[{ id: "words", path: "words.json", format: "json" }]`,
        INSPECT,
      ),
    );
    assert.deepEqual(outcome(await style.generate(contexts)), {
      ok: false,
      reason: "invalid",
      data: null,
      same: false,
      frozen: false,
    });
  });

  it("returns invalid when validate() rejects the data", async function () {
    const style = await createStyle(
      hostWith(readFileReturning({ "words.json": '{"a":1}' })),
      resourceStyle(
        "host",
        `[{ id: "words", path: "words.json", format: "json", validate: function (data) { return Array.isArray(data) || "expected an array"; } }]`,
        INSPECT.replace('first.data.push("mutated")', "first.data.a"),
      ),
    );
    const result = await style.generate(contexts);
    assert.equal((outcome(result) as { reason: string }).reason, "invalid");
    const finding = style.diagnostics.find(
      (message) => message.finding?.diagnosticId === "resource.invalid",
    );
    assert.match(finding?.message ?? "", /expected an array/);
  });

  it("reports one finding when the same failure repeats in a run", async function () {
    const style = await createStyle(
      hostWith(readFileReturning({})),
      resourceStyle(
        "host",
        `[{ id: "words", path: "words.json", format: "json" }]`,
        `async function generate() {
  await loadResource("words");
  await loadResource("words");
  return {
    citations: contexts.map(function (context) {
      return { id: context.id, content: "done" };
    }),
    bibliography: [],
  };
}`,
      ),
    );
    await style.generate(contexts);
    assert.equal(
      style.diagnostics.filter(
        (message) => message.finding?.diagnosticId === "resource.missing",
      ).length,
      1,
    );
  });

  it("keeps a declared snapshot across runs", async function () {
    let revision = 1;
    const host = hostWith(async () => {
      const bytes = new TextEncoder().encode(JSON.stringify([revision]));
      revision += 1;
      return bytes;
    });
    const style = await createStyle(
      host,
      resourceStyle(
        "host",
        `[{ id: "words", path: "words.json", format: "json" }]`,
        INSPECT.replace('first.data.push("mutated")', "first.data[0]"),
      ),
    );

    assert.equal(
      (outcome(await style.generate(contexts)) as { data: number[] }).data[0],
      1,
    );
    assert.equal(
      (outcome(await style.generate(contexts)) as { data: number[] }).data[0],
      1,
    );
  });

  it("coalesces concurrent reads into one host read and one snapshot", async function () {
    let reads = 0;
    const host = hostWith(async () => {
      // A stateful read: without coalescing the two calls would see 1 and 2.
      reads += 1;
      const value = reads;
      await new Promise((resolve) => setTimeout(resolve, 20));
      return new TextEncoder().encode(JSON.stringify([value]));
    });
    const style = await createStyle(
      host,
      resourceStyle(
        "host",
        `[{ id: "words", path: "words.json", format: "json" }]`,
        `async function generate() {
  const both = await Promise.all([loadResource("words"), loadResource("words")]);
  const report = {
    values: both.map(function (result) {
      return result.ok ? result.data[0] : result.reason;
    }),
    same: both[0] === both[1],
    sameData: both[0].ok && both[0].data === both[1].data,
  };
  return {
    citations: contexts.map(function (context) {
      return { id: context.id, content: JSON.stringify(report) };
    }),
    bibliography: [],
  };
}`,
      ),
    );

    assert.deepEqual(outcome(await style.generate(contexts)), {
      values: [1, 1],
      same: true,
      sameData: true,
    });
    assert.equal(reads, 1);
  });
});

describe("resource declarations", function () {
  it("drops an escaping path before readFile is ever called", async function () {
    for (const path of [
      "../secret.json",
      "/etc/passwd",
      "assets\\words.json",
      "https://example.com/words.json",
      "assets/words\0.json",
    ]) {
      const calls: string[] = [];
      const host = hostWith(readFileReturning({}, calls));
      const style = await createStyle(
        host,
        resourceStyle(
          "host",
          `[{ id: "words", path: ${JSON.stringify(path)}, format: "json" }]`,
          INSPECT,
        ),
      );
      const result = await style.generate(contexts);
      assert.equal(
        (outcome(result) as { reason: string }).reason,
        "undeclared",
        path,
      );
      assert.deepEqual(calls, [], path);
      assert.equal(
        style.diagnostics.some(
          (message) =>
            message.finding?.diagnosticId === "resource.path.invalid",
        ),
        true,
        path,
      );
    }
  });

  it("re-checks the path inside the runtime, without trusting the host", async function () {
    const calls: string[] = [];
    const reporter = createStyleMessageReporter();
    const host = createNodeHost({
      readFile: readFileReturning({}, calls),
    });
    const runtime = createResourceRuntime({
      host: () => ({
        runtime: host.runtime,
        capabilities: host.capabilities ?? {},
      }),
      messages: reporter,
    });
    // A declaration that skipped normalization entirely: the runtime still
    // refuses it and never calls readFile.
    runtime.configure([
      { id: "words", path: "../secret.json", format: "json" },
    ]);
    const result = await runtime.load("words");

    assert.deepEqual(result, {
      ok: false,
      reason: "invalid",
      message:
        "loadResource('words'): '../secret.json' is not a plain relative path inside the style directory",
    });
    assert.deepEqual(calls, []);
  });

  it("times out a read that never settles and fails fast afterwards", async function () {
    const reporter = createStyleMessageReporter();
    const host = createNodeHost({
      readFile: () => new Promise<Uint8Array>(() => {}),
    });
    const runtime = createResourceRuntime({
      host: () => ({
        runtime: host.runtime,
        capabilities: host.capabilities ?? {},
      }),
      messages: reporter,
      timeoutMs: 20,
    });
    runtime.configure([{ id: "words", path: "words.json", format: "json" }]);
    runtime.beginRun();

    const first = await runtime.load("words");
    assert.equal(first.ok === false && first.reason, "timeout");
    const second = await runtime.load("words");
    assert.equal(second.ok === false && second.reason, "timeout");

    // A new run gives the id another chance instead of failing forever.
    runtime.beginRun();
    const third = await runtime.load("words");
    assert.equal(third.ok === false && third.reason, "timeout");
    // The first attempt reports the timeout, the two later ones report the
    // breaker; identical text is deduplicated, so two findings remain.
    assert.equal(
      reporter.diagnostics.filter(
        (message) => message.finding?.diagnosticId === "resource.timeout",
      ).length,
      2,
    );
  });
});

describe("resource isolation across delegation", function () {
  it("resolves a delegated style's resource in its own directory", async function () {
    const parentCalls: string[] = [];
    const guestCalls: string[] = [];
    const parentHost = createNodeHost({
      readFile: readFileReturning({ "words.txt": "parent words" }, parentCalls),
      resolveStyle: async (id) =>
        id === "guest"
          ? {
              code: [
                info("guest"),
                `const STYLE_RESOURCES = [{ id: "words", path: "words.txt", format: "text" }];`,
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
                { "words.txt": "guest words" },
                guestCalls,
              ),
            }
          : null,
    });

    const style = await createStyle(
      parentHost,
      resourceStyle(
        "host",
        `[{ id: "words", path: "words.txt", format: "text" }]`,
        `const STYLE_DEPENDENCIES = [{ id: "guest" }];
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
    assert.deepEqual(parentCalls, ["words.txt"]);
    assert.deepEqual(guestCalls, ["words.txt"]);
  });

  it("reports unavailable for a delegated style whose host supplies no readFile", async function () {
    const guestSource = [
      info("guest"),
      `const STYLE_RESOURCES = [{ id: "words", path: "words.txt", format: "text" }];`,
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
        readFile: readFileReturning({ "words.txt": "parent words" }),
        resolveStyle: async () => ({ code: guestSource }),
      }),
      [
        info("host"),
        `const STYLE_DEPENDENCIES = [{ id: "guest" }];`,
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
