/**
 * The package-to-tarball mapping shared by packing, manifest generation,
 * manifest checking and the artifact smoke test.
 *
 * `pnpm pack` names a tarball after the package's unscoped name plus its
 * version (`@banyan/core` -> `banyan-core-<version>.tgz`). Deriving the name
 * from the manifest's package versions keeps a stale tarball from being picked
 * just because it happens to sort first in `artifacts/`.
 */
export const ARTIFACT_PACKAGES = Object.freeze({
  contractArtifact: "@banyan/style-contract",
  coreArtifact: "@banyan/core",
  lintArtifact: "eslint-plugin-banyan-style",
  testKitArtifact: "@banyan/style-test-kit",
});

export function artifactFileName(packageName, version) {
  const unscoped = packageName.replace(/^@/, "").replaceAll("/", "-");
  return `${unscoped}-${version}.tgz`;
}
