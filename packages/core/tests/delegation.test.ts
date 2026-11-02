import { assert } from "chai";
import { createStyle } from "../src/sandbox/createStyle";
import type {
  ResolvedStyleSource,
  StyleHost,
  StyleHostCapabilities,
} from "../src/host";
import type { CitationContext, StyleResult } from "../src/types/style";
import type { StyleInstance } from "../src/messages";
import { renderRichTextToText } from "../src/richText/render";
import { createNodeHost } from "../dev/node-host/runtime";

/**
 * Delegation contract: what `callStyle()` returns and what the caller's run
 * reports. The Node host binding is the only host here; `resolveStyle` is
 * supplied per test, so a missing or failing host is as easy to exercise as a
 * working one.
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
  {
    id: "ctx-2",
    page: 2,
    cites: [
      {
        item: { id: "2", itemType: "book", title: "Second", creators: [] },
        params: {},
      },
    ],
    params: {},
  },
];

function info(id: string, citationType = "intext-citation"): string {
  return `const INFO = {
  id: ${JSON.stringify(id)},
  title: ${JSON.stringify(id)},
  description: "",
  citationType: ${JSON.stringify(citationType)},
  creator: [],
  tags: [],
  documentation: [],
  license: "MIT",
  updated: "2026-01-01",
};`;
}

function dependencies(ids: readonly string[]): string {
  return `const STYLE_DEPENDENCIES = [${ids
    .map((id) => `{ id: ${JSON.stringify(id)} }`)
    .join(", ")}];`;
}

/** A style that answers from its own contexts, ignoring everything else. */
function guestCode(id: string, citationType = "intext-citation"): string {
  return [
    info(id, citationType),
    `function generate() {
  return {
    citations: contexts.map(function (context, index) {
      return { id: context.id, content: ${JSON.stringify(`${id}:`)} + index };
    }),
    bibliography: [
      { id: "bib", type: "bibliography-entry", content: ${JSON.stringify(
        `${id} bibliography`,
      )} },
    ],
  };
}`,
  ].join("\n");
}

/**
 * A caller that reports the failure reason in its fallback, so a test can tell
 * `unresolved` from `cycle` without reading the message.
 */
function callerCode(
  id: string,
  dependenciesIds: readonly string[],
  target: string,
): string {
  return [
    info(id),
    dependencies(dependenciesIds),
    `async function generate() {
  const result = await callStyle(${JSON.stringify(target)}, contexts);
  if (!result.ok) {
    return {
      citations: contexts.map(function (context) {
        return { id: context.id, content: "fallback:" + result.reason };
      }),
      bibliography: [],
    };
  }
  return {
    citations: contexts.map(function (context, index) {
      return { id: context.id, content: result.citations[index] };
    }),
    bibliography: result.bibliography,
  };
}`,
  ].join("\n");
}

function texts(result: StyleResult): string[] {
  return result.citations.map((citation) =>
    renderRichTextToText(citation.content),
  );
}

function hostResolving(
  sources: Record<string, string>,
): StyleHost & { resolved: string[] } {
  const resolved: string[] = [];
  return {
    runtime: createNodeHost().runtime,
    capabilities: {
      resolveStyle: async (id: string): Promise<ResolvedStyleSource | null> => {
        resolved.push(id);
        const code = sources[id];
        return code === undefined ? null : { code };
      },
    },
    resolved,
  };
}

function hostWith(capabilities: Partial<StyleHostCapabilities>): StyleHost {
  return createNodeHost(capabilities);
}

async function load(
  host: StyleHost,
  code: string,
  options: { generateTimeoutMs?: number } = {},
): Promise<StyleInstance> {
  return createStyle(host, code, options);
}

describe("callStyle() delegation", function () {
  it("returns the called style's normalized citations and bibliography", async function () {
    const host = hostResolving({ guest: guestCode("guest") });
    const style = await load(host, callerCode("host", ["guest"], "guest"));
    const result = await style.generate(contexts);

    assert.deepEqual(texts(result), ["guest:0", "guest:1"]);
    assert.deepEqual(
      result.bibliography.map((line) => renderRichTextToText(line.content)),
      ["guest bibliography"],
    );
    assert.deepEqual(host.resolved, ["guest"]);
    assert.deepEqual(style.STYLE_DEPENDENCIES, [{ id: "guest" }]);
  });

  it("reuses the private child instance across calls in one run", async function () {
    const host = hostResolving({ guest: guestCode("guest") });
    const style = await load(
      host,
      [
        info("host"),
        dependencies(["guest"]),
        `async function generate() {
  await callStyle("guest", contexts);
  const second = await callStyle("guest", contexts);
  return {
    citations: contexts.map(function (context, index) {
      return { id: context.id, content: second.citations[index] };
    }),
    bibliography: [],
  };
}`,
      ].join("\n"),
    );
    await style.generate(contexts);
    // One resolution even though the style called twice: the child is cached.
    assert.deepEqual(host.resolved, ["guest"]);
  });

  it("returns undeclared without touching the host", async function () {
    const host = hostResolving({ guest: guestCode("guest") });
    const style = await load(host, callerCode("host", [], "guest"));
    const result = await style.generate(contexts);

    assert.deepEqual(texts(result), [
      "fallback:undeclared",
      "fallback:undeclared",
    ]);
    assert.deepEqual(host.resolved, []);
    assert.equal(
      style.diagnostics.some(
        (message) => message.finding?.diagnosticId === "delegation.undeclared",
      ),
      true,
    );
  });

  it("returns unresolved when the host has no resolveStyle capability", async function () {
    const style = await load(
      hostWith({}),
      callerCode("host", ["guest"], "guest"),
    );
    const result = await style.generate(contexts);
    assert.deepEqual(texts(result), [
      "fallback:unresolved",
      "fallback:unresolved",
    ]);
  });

  it("returns unresolved when resolveStyle answers null", async function () {
    const host = hostWith({ resolveStyle: async () => null });
    const style = await load(host, callerCode("host", ["guest"], "guest"));
    assert.deepEqual(texts(await style.generate(contexts)), [
      "fallback:unresolved",
      "fallback:unresolved",
    ]);
  });

  it("returns unresolved when resolveStyle throws", async function () {
    const host = hostWith({
      resolveStyle: async () => {
        throw new Error("registry offline");
      },
    });
    const style = await load(host, callerCode("host", ["guest"], "guest"));
    assert.deepEqual(texts(await style.generate(contexts)), [
      "fallback:unresolved",
      "fallback:unresolved",
    ]);
    const finding = style.diagnostics.find(
      (message) => message.finding?.diagnosticId === "delegation.unresolved",
    );
    assert.match(finding?.message ?? "", /registry offline/);
  });

  it("refuses a direct self-call as cycle", async function () {
    const style = await load(
      hostResolving({ host: "" }),
      callerCode("host", ["host"], "host"),
    );
    assert.deepEqual(texts(await style.generate(contexts)), [
      "fallback:cycle",
      "fallback:cycle",
    ]);
  });

  it("refuses A -> B -> A as cycle", async function () {
    const host = hostResolving({
      guest: callerCode("guest", ["host"], "host"),
    });
    const style = await load(host, callerCode("host", ["guest"], "guest"));
    assert.deepEqual(texts(await style.generate(contexts)), [
      "fallback:cycle",
      "fallback:cycle",
    ]);
  });

  it("refuses a fourth style in the chain as depth", async function () {
    const host = hostResolving({
      b: callerCode("b", ["c"], "c"),
      c: callerCode("c", ["d"], "d"),
      d: guestCode("d"),
    });
    const style = await load(host, callerCode("a", ["b"], "b"));
    assert.deepEqual(texts(await style.generate(contexts)), [
      "fallback:depth",
      "fallback:depth",
    ]);
  });

  it("counts an id-less root as one level of the chain", async function () {
    // The root declares no usable INFO.id; without a slot it would let a
    // three-style chain run a fourth style, past MAX_DELEGATION_DEPTH.
    const host = hostResolving({
      b: callerCode("b", ["c"], "c"),
      c: callerCode("c", ["d"], "d"),
      d: guestCode("d"),
    });
    const root = callerCode("", ["b"], "b").replace('id: ""', "id: undefined");
    const style = await load(host, root);
    assert.deepEqual(texts(await style.generate(contexts)), [
      "fallback:depth",
      "fallback:depth",
    ]);
  });

  it("returns citation-type-mismatch instead of mixing output shapes", async function () {
    const host = hostResolving({ guest: guestCode("guest", "note-citation") });
    const style = await load(host, callerCode("host", ["guest"], "guest"));
    assert.deepEqual(texts(await style.generate(contexts)), [
      "fallback:citation-type-mismatch",
      "fallback:citation-type-mismatch",
    ]);
  });

  it("returns failed when the called generate() throws", async function () {
    const host = hostResolving({
      guest: [
        info("guest"),
        `function generate() { throw new Error("guest exploded"); }`,
      ].join("\n"),
    });
    const style = await load(host, callerCode("host", ["guest"], "guest"));
    assert.deepEqual(texts(await style.generate(contexts)), [
      "fallback:failed",
      "fallback:failed",
    ]);
    const finding = style.diagnostics.find(
      (message) => message.finding?.diagnosticId === "delegation.failed",
    );
    assert.match(finding?.message ?? "", /guest exploded/);
  });

  it("stops after the per-run call budget", async function () {
    const host = hostResolving({ guest: guestCode("guest") });
    const style = await load(
      host,
      [
        info("host"),
        dependencies(["guest"]),
        `async function generate() {
  let last = "";
  for (let index = 0; index < 17; index += 1) {
    const result = await callStyle("guest", contexts);
    last = result.ok ? "ok" : result.reason;
  }
  return {
    citations: contexts.map(function (context) {
      return { id: context.id, content: last };
    }),
    bibliography: [],
  };
}`,
      ].join("\n"),
    );
    assert.deepEqual(texts(await style.generate(contexts)), [
      "budget",
      "budget",
    ]);
    // The next run starts with a fresh budget.
    assert.deepEqual(texts(await style.generate(contexts)), [
      "budget",
      "budget",
    ]);
  });

  it("marks forwarded child findings with the chain in detail.via", async function () {
    const host = hostResolving({
      guest: [
        info("guest"),
        `function generate() {
  console.warn("guest warning");
  return {
    citations: contexts.map(function (context) {
      return { id: context.id, content: "guest" };
    }),
    bibliography: [],
  };
}`,
      ].join("\n"),
    });
    const style = await load(host, callerCode("host", ["guest"], "guest"));
    await style.generate(contexts);

    const forwarded = style.diagnostics.find(
      (message) => message.message === "guest warning",
    );
    assert.isDefined(forwarded);
    assert.deepEqual(forwarded?.detail?.via, ["host", "guest"]);
    assert.equal(forwarded?.source, "style");
  });

  it("does not deadlock when two top-level styles call each other", async function () {
    const host = hostResolving({});
    const a = await load(host, callerCode("a", ["b"], "b"));
    const b = await load(host, callerCode("b", ["a"], "a"));
    // The host resolves both to their own sources; each parent keeps a private
    // child, so the two generate queues never wait on each other.
    (host.capabilities as StyleHostCapabilities).resolveStyle = async (id) =>
      id === "b"
        ? { code: callerCode("b", ["a"], "a") }
        : { code: callerCode("a", ["b"], "b") };

    const [resultA, resultB] = await Promise.all([
      a.generate(contexts),
      b.generate(contexts),
    ]);
    // The first hop succeeds, the reverse hop is a cycle, so both runs finish
    // with a fallback instead of waiting forever.
    assert.deepEqual(texts(resultA), ["fallback:cycle", "fallback:cycle"]);
    assert.deepEqual(texts(resultB), ["fallback:cycle", "fallback:cycle"]);
  });
});

describe("callStyle() timeouts", function () {
  const STUCK = [
    info("guest"),
    `async function generate() { await new Promise(function () {}); }`,
  ].join("\n");

  it("abandons a stuck child, keeps the run alive and recovers on the next run", async function () {
    let attempt = 0;
    const host = hostWith({
      resolveStyle: async (id) => {
        attempt += 1;
        return {
          code: id === "guest" && attempt === 1 ? STUCK : guestCode("guest"),
        };
      },
    });
    const style = await load(host, callerCode("host", ["guest"], "guest"), {
      generateTimeoutMs: 1500,
    });

    const first = await style.generate(contexts);
    assert.deepEqual(texts(first), ["fallback:timeout", "fallback:timeout"]);
    assert.equal(
      style.diagnostics.some(
        (message) => message.finding?.diagnosticId === "delegation.timeout",
      ),
      true,
    );

    // The instance was discarded, so the next run resolves and loads it again.
    const second = await style.generate(contexts);
    assert.deepEqual(texts(second), ["guest:0", "guest:1"]);
  });

  it("fails fast for the rest of the run after one timeout", async function () {
    const host = hostWith({
      resolveStyle: async () => ({ code: STUCK }),
    });
    const style = await load(
      host,
      [
        info("host"),
        dependencies(["guest"]),
        `async function generate() {
  const first = await callStyle("guest", contexts);
  const second = await callStyle("guest", contexts);
  const reason = second.ok ? "ok" : second.reason;
  return {
    citations: contexts.map(function (context) {
      return { id: context.id, content: (first.ok ? "ok" : first.reason) + "/" + reason };
    }),
    bibliography: [],
  };
}`,
      ].join("\n"),
      { generateTimeoutMs: 1500 },
    );
    assert.deepEqual(texts(await style.generate(contexts)), [
      "timeout/timeout",
      "timeout/timeout",
    ]);
  });

  it("bounds a resolveStyle() that never settles by the run deadline", async function () {
    const host = hostWith({
      resolveStyle: () => new Promise<ResolvedStyleSource | null>(() => {}),
    });
    const style = await load(host, callerCode("host", ["guest"], "guest"), {
      generateTimeoutMs: 1200,
    });

    const started = Date.now();
    const result = await style.generate(contexts);
    const elapsed = Date.now() - started;

    // The run finishes with the caller's fallback instead of being killed by its
    // own generate timeout: resolution gave up first and left the reserve.
    assert.deepEqual(texts(result), ["fallback:timeout", "fallback:timeout"]);
    assert.isAtLeast(elapsed, 900);
    assert.isBelow(elapsed, 1200);
    const finding = style.diagnostics.find(
      (message) =>
        message.finding?.diagnosticId === "delegation.timeout" &&
        /resolve and load/.test(message.message),
    );
    assert.isDefined(finding);
  });

  it("fails fast when a second call would await the same unresolved host", async function () {
    let resolutions = 0;
    const host = hostWith({
      resolveStyle: () => {
        resolutions += 1;
        return new Promise<ResolvedStyleSource | null>(() => {});
      },
    });
    const style = await load(
      host,
      [
        info("host"),
        dependencies(["guest"]),
        `async function generate() {
  const first = await callStyle("guest", contexts);
  const started = Date.now();
  const second = await callStyle("guest", contexts);
  const parts = [
    first.ok ? "ok" : first.reason,
    second.ok ? "ok" : second.reason,
    Date.now() - started,
  ];
  return {
    citations: contexts.map(function (context) {
      return { id: context.id, content: parts.join("/") };
    }),
    bibliography: [],
  };
}`,
      ].join("\n"),
      { generateTimeoutMs: 1200 },
    );

    const [first] = texts(await style.generate(contexts));
    const [reason, secondReason, elapsed] = (first ?? "").split("/");
    assert.equal(reason, "timeout");
    assert.equal(secondReason, "timeout");
    assert.isBelow(Number(elapsed), 100);
    // The abandoned promise is not joined again: the host is asked once.
    assert.equal(resolutions, 1);
  });
});
