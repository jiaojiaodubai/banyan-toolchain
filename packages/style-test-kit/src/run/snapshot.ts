/**
 * Snapshot support.
 *
 * Snapshots guard the core's default rendering implementation only — they are
 * data, kept out of prettier via `.prettierignore`, written with sorted keys,
 * LF endings and a trailing newline so formatting tools and line endings
 * cannot churn them. The comparable assertion surface across hosts is the
 * structured `RichText`; HTML appears here only as renderer regression.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Style, StyleDiagnostic, StyleResult } from "../banyan";

export interface SnapshotPayload {
  style: {
    id?: string;
    title?: string;
    citationType?: string;
  };
  result: {
    citations: unknown[];
    bibliography: unknown[];
  };
  diagnostics: Array<{
    severity: StyleDiagnostic["severity"];
    source: string;
    code: string;
    message: string;
  }>;
}

/** Build the snapshot payload of one run. */
export function buildSnapshotPayload(
  info: Partial<Style["INFO"]> | undefined,
  result: StyleResult,
  diagnostics: readonly StyleDiagnostic[],
): SnapshotPayload {
  return {
    style: {
      id: info?.id,
      title: info?.title,
      citationType: info?.citationType,
    },
    result: result as unknown as {
      citations: unknown[];
      bibliography: unknown[];
    },
    diagnostics: diagnostics.map((message) => ({
      severity: message.severity,
      source: message.source,
      code: message.code,
      message: message.message,
    })),
  };
}

/** Deterministic serialization: sorted keys, 2-space indent, LF, final newline. */
export function stringifyStable(value: unknown): string {
  const sorted = sortKeys(value);
  const normalized = JSON.stringify(
    sorted,
    (_key, replaced) =>
      typeof replaced === "string"
        ? replaced.replace(/\r\n?/g, "\n")
        : replaced,
    2,
  );
  return `${normalized}\n`;
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeys);
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(record)
        .sort()
        .map((key) => [key, sortKeys(record[key])]),
    );
  }
  return value;
}

export type SnapshotCheck = { match: true } | { match: false; diff: string };

/** Compare a payload against the snapshot file (reading it if it exists). */
export async function checkSnapshot(
  snapshotPath: string,
  payload: SnapshotPayload,
): Promise<SnapshotCheck> {
  let expected: string;
  try {
    expected = await readFile(snapshotPath, "utf8");
  } catch {
    return {
      match: false,
      diff: `Snapshot file ${snapshotPath} does not exist yet (run with --update to create it).`,
    };
  }
  const actual = stringifyStable(payload);
  if (actual === expected) {
    return { match: true };
  }
  return { match: false, diff: lineDiff(expected, actual) };
}

/** Write (or overwrite) the snapshot file. */
export async function writeSnapshot(
  snapshotPath: string,
  payload: SnapshotPayload,
): Promise<void> {
  await mkdir(path.dirname(snapshotPath), { recursive: true });
  await writeFile(snapshotPath, stringifyStable(payload), "utf8");
}

function lineDiff(expected: string, actual: string): string {
  const expectedLines = expected.split("\n");
  const actualLines = actual.split("\n");
  const lines: string[] = [];
  const max = Math.max(expectedLines.length, actualLines.length);
  let shown = 0;
  for (let index = 0; index < max && shown < 40; index++) {
    const a = expectedLines[index];
    const b = actualLines[index];
    if (a !== b) {
      lines.push(`- ${a ?? "(missing)"}`, `+ ${b ?? "(missing)"}`);
      shown += 2;
    }
  }
  return lines.join("\n");
}
