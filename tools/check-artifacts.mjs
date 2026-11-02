/**
 * Verify the checked-in manifest against the built tree.
 *
 * This is the CI gate that keeps "works in my workspace" from becoming "the
 * published asset is different": every hash, the schema revision and the lint
 * bundle boundary are re-derived here.
 */
import { readFile } from "node:fs/promises";
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
const manifest = JSON.parse(
  await readFile(path.join(rootDir, "toolchain.manifest.json"), "utf8"),
);
const failures = [];

function check(condition, message) {
  if (!condition) failures.push(message);
}

async function sha256(filePath, artifactKey) {
  if (artifactKey.endsWith("Artifact")) {
    return hashArtifact(filePath);
  }
  return hashFile(filePath);
}

for (const [key, expected] of Object.entries(manifest.artifacts)) {
  if (!key.endsWith("Sha256")) continue;
  const artifactKey = key.slice(0, -"Sha256".length);
  const file = manifest.artifacts[artifactKey];
  if (!file) {
    failures.push(`manifest has ${key} without artifacts.${artifactKey}`);
    continue;
  }
  const actual = await sha256(
    path.join(rootDir, "artifacts", file),
    artifactKey,
  ).catch(() => null);
  check(actual === expected, `${artifactKey}: hash mismatch`);
}

check(
  manifest.schemaRevision === SCHEMA_FACTS.schemaRevision,
  `manifest schemaRevision ${manifest.schemaRevision} != contract ${SCHEMA_FACTS.schemaRevision}`,
);

const contractRevision = hashContractSource(rootDir);
check(
  manifest.contractRevision === contractRevision,
  `manifest contractRevision ${manifest.contractRevision} != contract source ${contractRevision}`,
);

try {
  const expectedRevision = sourceRevision(rootDir);
  check(
    manifest.toolchainRevision === expectedRevision,
    `manifest toolchainRevision ${manifest.toolchainRevision} != source ${expectedRevision}`,
  );
} catch (error) {
  failures.push(error.message);
}

const rootPackage = JSON.parse(
  await readFile(path.join(rootDir, "package.json"), "utf8"),
);
const lintPackage = JSON.parse(
  await readFile(
    path.join(rootDir, "packages", "eslint-plugin", "package.json"),
    "utf8",
  ),
);
check(
  manifest.supportedNode === rootPackage.engines?.node,
  `manifest supportedNode ${manifest.supportedNode} != root engines.node ${rootPackage.engines?.node}`,
);
check(
  manifest.supportedEslint === lintPackage.peerDependencies?.eslint,
  `manifest supportedEslint ${manifest.supportedEslint} != lint peerDependencies.eslint ${lintPackage.peerDependencies?.eslint}`,
);

for (const [key, packageName] of Object.entries(ARTIFACT_PACKAGES)) {
  const version = manifest.packages[packageName];
  if (!version) {
    failures.push(`manifest.packages is missing ${packageName}`);
    continue;
  }
  const expected = artifactFileName(packageName, version);
  check(
    manifest.artifacts[key] === expected,
    `artifacts.${key} ${manifest.artifacts[key]} != ${expected}`,
  );
}

const corePackage = JSON.parse(
  await readFile(
    path.join(rootDir, "packages", "core", "package.json"),
    "utf8",
  ),
);
check(
  !Object.keys(corePackage.dependencies ?? {}).includes("eslint"),
  "core must not depend on ESLint",
);

const lintBundle = await readFile(
  path.join(rootDir, "artifacts", manifest.artifacts.lintBundle),
  "utf8",
);
check(
  !lintBundle.includes("@banyan/core"),
  "lint bundle must not import the core runtime",
);
check(
  !/from\s+["']eslint["']/.test(lintBundle),
  "lint bundle must not import ESLint itself",
);
check(
  lintBundle.includes("__proto__"),
  "lint bundle must inline the contract's declaration facts",
);

for (const [name, version] of Object.entries(manifest.packages)) {
  const directory = {
    "@banyan/core": "core",
    "@banyan/style-contract": "style-contract",
    "eslint-plugin-banyan-style": "eslint-plugin",
    "@banyan/style-test-kit": "style-test-kit",
  }[name];
  const packageJSON = JSON.parse(
    await readFile(
      path.join(rootDir, "packages", directory, "package.json"),
      "utf8",
    ),
  );
  check(packageJSON.version === version, `${name}: version mismatch`);
}

if (failures.length) {
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log(
    `toolchain manifest verified (${manifest.toolchainRevision.slice(0, 12)}, ${manifest.schemaRevision})`,
  );
}
