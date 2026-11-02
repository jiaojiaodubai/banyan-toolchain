/* global console, process, setTimeout, clearTimeout */
/**
 * Deterministic fuzz smoke for untrusted style input and output trees.
 *
 * Run from the repository root:
 *   pnpm fuzz
 *
 * The contract asserted here is deliberately coarse: every input must either
 * produce a valid result or reject with a known RuntimeCode; it must not hang,
 * escape the sandbox, pollute host prototypes, or leak an unhandled rejection.
 * The corpus is generated from a fixed seed so a failure is reproducible.
 */
import { DOMParser } from "linkedom";
import { createStyle } from "../src/sandbox/createStyle.ts";
import { createGenerateOutputNormalizer } from "../src/output/normalizeGenerateResult.ts";
import { isRuntimeCode } from "../src/sandbox/runtimeErrors.ts";
import { createNodeHost } from "../dev/node-host/runtime.ts";

const SEED = 0x5eed_1021;
let state = SEED >>> 0;
const random = () => {
  state = (state * 1_664_525 + 1_013_904_223) >>> 0;
  return state / 0x1_0000_0000;
};
const pick = (values) => values[Math.floor(random() * values.length)];
const chance = (probability) => random() < probability;
const repeat = (count, make) => Array.from({ length: count }, make);

const INFO = `const INFO = { id: "fuzz", title: "Fuzz", citationType: "intext-citation" };`;
const CONTEXT = { id: "ctx", page: 1, cites: [], params: {} };
const failures = [];
const rejections = [];

process.on("unhandledRejection", (reason) => {
  rejections.push(String(reason?.message ?? reason));
});

const prototypeBefore = Object.getOwnPropertyNames(Object.prototype)
  .sort()
  .join(",");
const globalsBefore = Object.getOwnPropertyNames(globalThis).sort().join(",");

function fail(label, detail) {
  failures.push(`${label}: ${detail}`);
}

function assertKnownError(label, error) {
  if (!isRuntimeCode(error?.code)) {
    fail(label, `unclassified error: ${String(error?.message ?? error)}`);
  }
}

async function withDeadline(promise, label, milliseconds = 3_000) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`hung for ${milliseconds}ms`)),
          milliseconds,
        );
      }),
    ]);
  } catch (error) {
    if (error?.message?.startsWith("hung for")) {
      fail(label, error.message);
      return undefined;
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function assertResultShape(label, result) {
  if (
    !result ||
    !Array.isArray(result.citations) ||
    !Array.isArray(result.bibliography)
  ) {
    fail(label, "resolved without a citations/bibliography result");
  }
}

const payloads = [
  "&constructor;&toString;&valueOf;&hasOwnProperty;",
  "Use <b/> here",
  '<span title="a > b">quoted</span>',
  `${"<b>".repeat(120)}deep${"</b>".repeat(120)}`,
  "x".repeat(20_001),
  "<br>line one\nline two",
  "<b>unclosed",
  "&amp;&#x41;&#65;&unknown;",
];

async function fuzzStyleCase(index) {
  const label = `style#${index}`;
  const payload = pick(payloads);
  const mode = Math.floor(random() * 6);
  let code;
  let contexts = [CONTEXT];

  if (mode === 0) {
    // Syntax / contract failure: must be style-load or style-contract.
    code = pick([
      "const INFO = {}; function generate( {",
      INFO,
      `const INFO = { citationType: "nonsense" }; function generate() {}`,
    ]);
  } else if (mode === 1) {
    // Normal content with hostile markup/entity payload.
    code = `${INFO}
      function generate() {
        return {
          citations: [{ id: "ctx", content: ${JSON.stringify(payload)} }],
          bibliography: [],
        };
      }`;
  } else if (mode === 2) {
    // Cyclic generate output: clone must fail instead of hanging/escaping.
    code = `${INFO}
      function generate() {
        const out = { citations: [], bibliography: [] };
        out.self = out;
        return out;
      }`;
  } else if (mode === 3) {
    // Throwing thenable: bridge must reject, not hang.
    code = `${INFO}
      function generate() {
        return { then() { throw new Error("fuzz thenable"); } };
      }`;
  } else if (mode === 4) {
    // Async rejection with a non-Error value.
    code = `${INFO}
      async function generate() {
        throw { message: "fuzz async rejection", code: "generate" };
      }`;
  } else {
    // Invalid context shape should be rejected before style execution.
    code = `${INFO}
      function generate() {
        return { citations: [], bibliography: [] };
      }`;
    contexts = pick([
      [{ id: "", page: 1, cites: [], params: {} }],
      [{ id: "ctx", page: Number.NaN, cites: [], params: {} }],
      [{ id: "ctx", page: 1, cites: null, params: {} }],
    ]);
  }

  try {
    const style = await withDeadline(
      createStyle(createNodeHost(), code, { generateTimeoutMs: 200 }),
      `${label}/create`,
    );
    if (!style) return;
    try {
      const result = await withDeadline(
        style.generate(contexts),
        `${label}/generate`,
      );
      if (result) assertResultShape(label, result);
    } catch (error) {
      assertKnownError(`${label}/generate`, error);
    }
  } catch (error) {
    assertKnownError(`${label}/create`, error);
  }
}

function randomUnit(depth = 0) {
  if (depth > 7 || chance(0.35)) {
    return pick([
      "text",
      "",
      "&amp;",
      "&constructor;",
      "x".repeat(50),
      "<b>not markup in a Unit</b>",
      0,
      false,
    ]);
  }

  const kind = Math.floor(random() * 8);
  const child = () => randomUnit(depth + 1);
  switch (kind) {
    case 0:
      return {
        type: "group",
        units: repeat(1 + Math.floor(random() * 3), child),
      };
    case 1:
      return { type: "affix", unit: child(), prefix: "(", suffix: ")" };
    case 2:
      return {
        type: "fall",
        units: repeat(1 + Math.floor(random() * 3), child),
      };
    case 3:
      return {
        type: "when",
        condition: chance(0.5),
        trueUnit: child(),
        elseUnit: child(),
      };
    case 4:
      return {
        type: "text-case",
        form: pick([
          "lower",
          "upper",
          "title",
          "sentence",
          "name",
          "small-caps",
        ]),
        ignoreWords: pick([[], ["DNA"], ["der"]]),
        unit: child(),
      };
    case 5:
      return {
        type: "style",
        style: pick([{}, { italic: true }, { color: "red" }]),
        unit: child(),
      };
    case 6:
      return {
        type: "link",
        link: pick(["https://example.test", "javascript:alert(1)"]),
        unit: child(),
      };
    default:
      return { value: pick(["leaf", "&amp;", "x".repeat(100)]) };
  }
}

function fuzzNormalizeCase(index) {
  const label = `normalize#${index}`;
  const contexts = [{ ...CONTEXT }];
  const normalize = createGenerateOutputNormalizer(() => (html) => {
    const document = new DOMParser().parseFromString(
      `<div id="fuzz-root">${html}</div>`,
      "text/html",
    );
    return document.getElementById("fuzz-root");
  });
  const raw = {
    citations: [{ id: "ctx", content: randomUnit() }],
    bibliography: [],
  };
  try {
    const result = normalize(raw, contexts, "Fuzz", "intext-citation");
    assertResultShape(label, result);
  } catch (error) {
    assertKnownError(label, error);
  }
}

const styleRuns = Number(process.env.FUZZ_STYLE_CASES ?? 60);
const normalizeRuns = Number(process.env.FUZZ_NORMALIZE_CASES ?? 80);
for (let index = 0; index < styleRuns; index += 1) {
  await fuzzStyleCase(index);
}
for (let index = 0; index < normalizeRuns; index += 1) {
  fuzzNormalizeCase(index);
}

await new Promise((resolve) => setTimeout(resolve, 50));

const prototypeAfter = Object.getOwnPropertyNames(Object.prototype)
  .sort()
  .join(",");
const globalsAfter = Object.getOwnPropertyNames(globalThis).sort().join(",");
if (prototypeAfter !== prototypeBefore) {
  fail("host", "Object.prototype changed during fuzz");
}
if (globalsAfter !== globalsBefore) {
  fail("host", "host global names changed during fuzz");
}
if (rejections.length) {
  fail("host", `unhandled rejections: ${rejections.join("; ")}`);
}

const summary = {
  seed: SEED,
  styleRuns,
  normalizeRuns,
  failures,
  unhandledRejections: rejections,
};
console.log(JSON.stringify(summary, null, 2));
if (failures.length) {
  process.exitCode = 1;
}
