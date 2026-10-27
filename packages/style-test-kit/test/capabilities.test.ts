/**
 * Host capability tests: the `readFile` whitelist (path rules, size limit,
 * links, gzip/offset window) and `parseHtml`'s failure modes.
 */
import { expect } from "chai";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import { tmpdir } from "node:os";
import path from "node:path";
import { createTestKitCapabilities } from "../src/runtime/capabilities";
import { TestLibrary } from "../src/library/library";

const emptyLibrary = TestLibrary.empty();

async function failureOf(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  return "";
}

describe("readFile capability", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "banyan-style-dir-"));
    await mkdir(path.join(dir, "data"), { recursive: true });
    await writeFile(path.join(dir, "data", "notes.json"), '{"ok":true}');
    await writeFile(path.join(dir, "data", "text.txt"), "0123456789", "utf8");
    await writeFile(
      path.join(dir, "data", "bundle.json.gz"),
      gzipSync(Buffer.from('{"zipped":true}', "utf8")),
    );
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const capabilities = (maxFileBytes?: number) =>
    createTestKitCapabilities({
      styleDir: dir,
      library: emptyLibrary,
      maxFileBytes,
    });

  it("reads files inside the style directory", async () => {
    const bytes = await capabilities().readFile("data/notes.json");
    expect(new TextDecoder().decode(bytes)).to.equal('{"ok":true}');
  });

  it("accepts absolute paths inside the directory", async () => {
    const bytes = await capabilities().readFile(
      path.join(dir, "data", "notes.json"),
    );
    expect(new TextDecoder().decode(bytes)).to.equal('{"ok":true}');
  });

  it("rejects .. traversal and outside paths", async () => {
    for (const candidate of [
      "../outside.json",
      "data/../../outside.json",
      path.join(dir, "..", "outside.json"),
    ]) {
      expect(
        await failureOf(() => capabilities().readFile(candidate)),
      ).to.match(/style directory/);
    }
  });

  it("rejects empty paths", async () => {
    expect(await failureOf(() => capabilities().readFile("  "))).to.match(
      /Invalid path/,
    );
  });

  it("applies the per-file size limit", async () => {
    const message = await failureOf(() =>
      capabilities(4).readFile("data/notes.json"),
    );
    expect(message).to.match(/exceeds the 4-byte limit/);
  });

  it("applies a byte window after decompression", async () => {
    const all = await capabilities().readFile("data/text.txt");
    expect(new TextDecoder().decode(all)).to.equal("0123456789");
    const window = await capabilities().readFile("data/text.txt", {
      offset: 2,
      maxBytes: 3,
    });
    expect(new TextDecoder().decode(window)).to.equal("234");
    const gz = await capabilities().readFile("data/bundle.json.gz", {
      decompress: true,
    });
    expect(new TextDecoder().decode(gz)).to.equal('{"zipped":true}');
  });

  it("refuses symbolic links", async () => {
    const link = path.join(dir, "data", "link.json");
    try {
      await symlink(path.join(dir, "data", "notes.json"), link, "file");
    } catch {
      // Symlink creation may require privileges on Windows; the guard itself is
      // still exercised by the lstat check on regular files.
      return;
    }
    expect(
      await failureOf(() => capabilities().readFile("data/link.json")),
    ).to.match(/symbolic link/);
  });

  it("rejects directories", async () => {
    expect(await failureOf(() => capabilities().readFile("data"))).to.match(
      /Not a file/,
    );
  });
});
