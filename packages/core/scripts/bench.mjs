/* global console */
/**
 * Minimal, deterministic-enough performance baseline.
 *
 * Run from the repository root:
 *   pnpm bench
 *
 * This is a smoke baseline, not a CI gate: wall-clock numbers depend on the
 * machine and the Node build. Record the output next to a release candidate and
 * compare medians on the same machine; do not turn this into a threshold test.
 */
import { performance } from "node:perf_hooks";
import { DOMParser } from "linkedom";
import { createStyle } from "../src/sandbox/createStyle.ts";
import { createGenerateOutputNormalizer } from "../src/output/normalizeGenerateResult.ts";
import { isZoteroField, resolveZoteroField } from "../src/schema/queries.ts";
import { createNodeHost } from "../dev/node-host/runtime.ts";

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function stats(label, values, unit = "ms") {
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return {
    label,
    unit,
    iterations: values.length,
    median: Number(median(values).toFixed(3)),
    mean: Number(mean.toFixed(3)),
    min: Number(Math.min(...values).toFixed(3)),
    max: Number(Math.max(...values).toFixed(3)),
  };
}

function parseHtml(html) {
  const document = new DOMParser().parseFromString(
    `<div id="bench-root">${html}</div>`,
    "text/html",
  );
  return document.getElementById("bench-root");
}

const INFO = `const INFO = { id: "bench", title: "Bench", citationType: "intext-citation" };`;

async function benchGenerate() {
  const style = await createStyle(
    createNodeHost(),
    `${INFO}
     function generate() {
       return {
         citations: contexts.map((context) => ({
           id: context.id,
           content: text("A short citation"),
         })),
         bibliography: [],
       };
     }`,
  );
  const contexts = Array.from({ length: 100 }, (_, index) => ({
    id: `ctx-${index}`,
    page: 1,
    cites: [],
    params: {},
  }));

  await style.generate(contexts); // warmup
  const times = [];
  for (let iteration = 0; iteration < 20; iteration += 1) {
    const started = performance.now();
    await style.generate(contexts);
    times.push(performance.now() - started);
  }
  return stats("generate: 100 citations", times);
}

function benchNormalizeDeep() {
  const normalize = createGenerateOutputNormalizer(() => parseHtml);
  const contexts = [{ id: "ctx", page: 1, cites: [], params: {} }];
  let unit = "leaf";
  for (let depth = 0; depth < 80; depth += 1) {
    unit = { type: "style", style: { bold: true }, unit };
  }
  const raw = {
    citations: [{ id: "ctx", content: unit }],
    bibliography: [],
  };

  const run = () => normalize(raw, contexts, "Bench", "intext-citation");
  run(); // warmup
  const times = [];
  for (let iteration = 0; iteration < 50; iteration += 1) {
    const started = performance.now();
    run();
    times.push(performance.now() - started);
  }
  return stats("normalize: 80 nested styles", times);
}

function benchSchemaQueries() {
  const iterations = 200_000;
  const started = performance.now();
  for (let index = 0; index < iterations; index += 1) {
    isZoteroField("publicationTitle");
    resolveZoteroField("book", "bookTitle");
  }
  const elapsed = performance.now() - started;
  return {
    label: "schema: 2 queries/iteration",
    unit: "ns/query",
    iterations,
    median: Number(((elapsed * 1_000_000) / (iterations * 2)).toFixed(1)),
    mean: Number(((elapsed * 1_000_000) / (iterations * 2)).toFixed(1)),
    min: null,
    max: null,
  };
}

const results = [
  await benchGenerate(),
  benchNormalizeDeep(),
  benchSchemaQueries(),
];
console.table(results);
