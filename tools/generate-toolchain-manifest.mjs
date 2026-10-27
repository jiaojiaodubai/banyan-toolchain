/**
 * Write `toolchain.manifest.json`: one revision, one schema revision, and the
 * hash of every artifact a consumer is allowed to install.
 *
 * Run after `pnpm pack:artifacts`. The manifest is the ecosystem's version key
 * while the packages themselves are not published to npm.
 */
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SCHEMA_FACTS } from "@banyan/style-contract";
import { ARTIFACT_PACKAGES, artifactFileName } from "./artifact-names.mjs";
import { hashArtifact, hashFile } from "./artifact-hash.mjs";
import { hashContractSource } from "./contract-revision.mjs";
import { sourceRevision } from "./source-revision.mjs";

const rootDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const artifactsDir = path.join(rootDir, "artifacts");

async function findArtifact(file) {
  const files = await readdir(artifactsDir);
  if (!files.includes(file)) {
    throw new Error(
      `Missing artifact ${file}; run pnpm pack:artifacts (found: ${files.join(", ") || "nothing"})`,
    );
  }
  return file;
}

const packages = {};
const packageManifests = {};
for (const [directory, name] of [
  ["core", "@banyan/core"],
  ["style-contract", "@banyan/style-contract"],
  ["eslint-plugin", "eslint-plugin-banyan-style"],
  ["style-test-kit", "@banyan/style-test-kit"],
]) {
  const manifest = JSON.parse(
    await readFile(
      path.join(rootDir, "packages", directory, "package.json"),
      "utf8",
    ),
  );
  packageManifests[name] = manifest;
  packages[name] = manifest.version;
}

const rootPackage = JSON.parse(
  await readFile(path.join(rootDir, "package.json"), "utf8"),
);
const lintPackage = packageManifests["eslint-plugin-banyan-style"];
if (!rootPackage.engines?.node) {
  throw new Error("root package.json must declare engines.node");
}
if (!lintPackage.peerDependencies?.eslint) {
  throw new Error(
    "eslint-plugin-banyan-style must declare peerDependencies.eslint",
  );
}

const artifactNames = Object.fromEntries(
  Object.entries(ARTIFACT_PACKAGES).map(([key, name]) => {
    const version = packages[name];
    if (!version) {
      throw new Error(`Missing package version for ${name}`);
    }
    return [key, artifactFileName(name, version)];
  }),
);
const contractArtifact = await findArtifact(artifactNames.contractArtifact);
const coreArtifact = await findArtifact(artifactNames.coreArtifact);
const lintArtifact = await findArtifact(artifactNames.lintArtifact);
const testKitArtifact = await findArtifact(artifactNames.testKitArtifact);
const lintBundle = "eslint-plugin-banyan-style.mjs";
const lintMetadata = "eslint-plugin-banyan-style.build.json";

const manifest = {
  toolchainRevision: sourceRevision(rootDir),
  contractRevision: hashContractSource(rootDir),
  schemaRevision: SCHEMA_FACTS.schemaRevision,
  supportedNode: rootPackage.engines.node,
  supportedEslint: lintPackage.peerDependencies.eslint,
  packages,
  artifacts: {
    contractArtifact,
    coreArtifact,
    lintArtifact,
    testKitArtifact,
    lintBundle,
    lintMetadata,
    contractArtifactSha256: await hashArtifact(
      path.join(artifactsDir, contractArtifact),
    ),
    coreArtifactSha256: await hashArtifact(
      path.join(artifactsDir, coreArtifact),
    ),
    lintArtifactSha256: await hashArtifact(
      path.join(artifactsDir, lintArtifact),
    ),
    testKitArtifactSha256: await hashArtifact(
      path.join(artifactsDir, testKitArtifact),
    ),
    lintBundleSha256: await hashFile(path.join(artifactsDir, lintBundle)),
    lintMetadataSha256: await hashFile(path.join(artifactsDir, lintMetadata)),
  },
};

await writeFile(
  path.join(rootDir, "toolchain.manifest.json"),
  `${JSON.stringify(manifest, null, 2)}\n`,
  "utf8",
);
console.log(
  `wrote toolchain.manifest.json (${manifest.toolchainRevision.slice(0, 12)}, ${manifest.schemaRevision})`,
);
