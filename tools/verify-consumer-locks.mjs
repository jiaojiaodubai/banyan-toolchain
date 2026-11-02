/**
 * Check that each sibling consumer's `toolchain.lock.json` still describes the
 * manifest in this checkout: one revision, one schema revision, the same
 * artifact hashes, and — for Banyan — the generated addon copies.
 *
 * This runs locally, not in the toolchain's standalone CI, because CI does not
 * check out the consumers. A consumer's own CI can call the same script from a
 * combined checkout.
 */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const manifest = JSON.parse(
  await readFile(path.join(rootDir, "toolchain.manifest.json"), "utf8"),
);

const consumers = [
  {
    name: "Banyan",
    root: path.resolve(rootDir, "..", "Banyan"),
    addonDir: "addon/content/styleEditor",
    artifactKeys: [
      "contractArtifact",
      "contractArtifactSha256",
      "coreArtifact",
      "coreArtifactSha256",
      "lintArtifact",
      "lintArtifactSha256",
      "lintBundle",
      "lintBundleSha256",
      "lintMetadata",
      "lintMetadataSha256",
    ],
  },
  {
    name: "banyan-styles",
    root: path.resolve(rootDir, "..", "banyan-styles"),
    artifactKeys: [
      "contractArtifact",
      "contractArtifactSha256",
      "coreArtifact",
      "coreArtifactSha256",
      "testKitArtifact",
      "testKitArtifactSha256",
      "lintArtifact",
      "lintArtifactSha256",
      "lintBundle",
      "lintBundleSha256",
    ],
  },
];

const failures = [];

function check(condition, message) {
  if (!condition) failures.push(message);
}

async function sha256(filePath) {
  const content = await readFile(filePath);
  return createHash("sha256").update(content).digest("hex");
}

for (const consumer of consumers) {
  let lock;
  try {
    lock = JSON.parse(
      await readFile(path.join(consumer.root, "toolchain.lock.json"), "utf8"),
    );
  } catch {
    console.log(`skip ${consumer.name}: no toolchain.lock.json`);
    continue;
  }

  check(
    lock.toolchainRevision === manifest.toolchainRevision,
    `${consumer.name}: revision ${lock.toolchainRevision} != ${manifest.toolchainRevision}`,
  );
  check(
    lock.contractRevision === manifest.contractRevision,
    `${consumer.name}: contract revision mismatch`,
  );
  check(
    lock.schemaRevision === manifest.schemaRevision,
    `${consumer.name}: schema revision mismatch`,
  );

  for (const [name, version] of Object.entries(lock.packages)) {
    check(
      manifest.packages[name] === version,
      `${consumer.name}: ${name} ${version} != ${manifest.packages[name]}`,
    );
  }

  for (const key of consumer.artifactKeys) {
    check(
      lock.artifacts[key] === manifest.artifacts[key],
      `${consumer.name}: artifacts.${key} mismatch`,
    );
  }

  if (consumer.addonDir) {
    for (const [file, expected] of Object.entries(lock.addonAssets ?? {})) {
      const actual = await sha256(
        path.join(consumer.root, consumer.addonDir, file),
      ).catch(() => null);
      check(actual === expected, `${consumer.name}: ${file} hash mismatch`);
    }
  }
}

if (failures.length) {
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log(
    `consumer locks verified against ${manifest.toolchainRevision.slice(0, 12)}`,
  );
}
