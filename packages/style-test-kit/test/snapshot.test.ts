/**
 * Snapshot behavior: deterministic serialization, match/mismatch and the
 * payload shape the CLI writes.
 */
import { expect } from "chai";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  buildSnapshotPayload,
  checkSnapshot,
  stringifyStable,
  writeSnapshot,
  type SnapshotPayload,
} from "../src/run/snapshot";
import { textToRichText, type StyleResult } from "../src/banyan";

const result = {
  citations: [{ id: "c1", content: textToRichText("hello\r\nworld") }],
  bibliography: [
    { id: "b1", type: "bibliography-entry", content: textToRichText("entry") },
  ],
} as unknown as StyleResult;

describe("snapshot serialization", () => {
  it("sorts keys and normalizes line endings", () => {
    const value = { b: 1, a: { d: ["x\r\ny"], c: true } };
    expect(stringifyStable(value)).to.equal(
      '{\n  "a": {\n    "c": true,\n    "d": [\n      "x\\ny"\n    ]\n  },\n  "b": 1\n}\n',
    );
  });

  it("builds the payload from INFO, result and diagnostics", () => {
    const payload = buildSnapshotPayload(
      { id: "s", title: "S", citationType: "intext-citation" },
      result,
      [
        {
          severity: "warning",
          source: "style",
          code: "generate",
          message: "kept finding",
        },
      ],
    );
    expect(payload.style).to.deep.equal({
      id: "s",
      title: "S",
      citationType: "intext-citation",
    });
    expect(payload.result.citations).to.have.lengthOf(1);
    expect(payload.diagnostics).to.deep.equal([
      {
        severity: "warning",
        source: "style",
        code: "generate",
        message: "kept finding",
      },
    ]);
  });

  it("tolerates a missing INFO (isolated runs may omit it)", () => {
    const payload = buildSnapshotPayload(undefined, result, []);
    expect(payload.style).to.deep.equal({
      id: undefined,
      title: undefined,
      citationType: undefined,
    });
  });

  it("checks snapshots from disk and reports diffs", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "banyan-style-test-kit-"));
    try {
      const snapshotPath = path.join(dir, "snap", "baseline.json");
      const payload: SnapshotPayload = {
        style: {},
        result: { citations: [], bibliography: [] },
        diagnostics: [],
      };
      await writeSnapshot(snapshotPath, payload);
      expect((await checkSnapshot(snapshotPath, payload)).match).to.equal(true);

      const changed: SnapshotPayload = {
        ...payload,
        diagnostics: [
          { severity: "error", source: "s", code: "c", message: "m" },
        ],
      };
      const check = await checkSnapshot(snapshotPath, changed);
      expect(check.match).to.equal(false);
      if (!check.match) expect(check.diff).to.contain("+");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("reports a missing snapshot file", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "banyan-style-test-kit-"));
    try {
      const check = await checkSnapshot(path.join(dir, "nope.json"), {
        style: {},
        result: { citations: [], bibliography: [] },
        diagnostics: [],
      });
      expect(check.match).to.equal(false);
      if (!check.match) expect(check.diff).to.contain("does not exist");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
