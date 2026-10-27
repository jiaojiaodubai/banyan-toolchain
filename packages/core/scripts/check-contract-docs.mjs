/* global console, process, URL */
/**
 * Lightweight drift guard between the prose contract and the executable one.
 *
 * This intentionally checks names, not prose: every required capability and
 * every `SandboxContext` method mentioned by `dev/hostIntegration.md` must still
 * exist in `src/host.ts`. Full semantics stay in the document and tests; this
 * catches the common failure where a rename lands in code but not in the host
 * guide.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const hostSource = readFileSync(`${root}/src/host.ts`, "utf8");
const docs = readFileSync(`${root}/dev/hostIntegration.md`, "utf8");
const problems = [];

const contextBody = hostSource.match(
  /export interface SandboxContext \{([\s\S]*?)\n\}/,
)?.[1];
if (!contextBody) {
  problems.push("could not find SandboxContext in src/host.ts");
} else {
  const methods = [
    ...contextBody.matchAll(/^\s{2}([A-Za-z][\w]*)\s*(?:<[^>]+>)?\(/gm),
  ].map((match) => match[1]);
  if (methods.length < 10) {
    problems.push(
      `only found ${methods.length} SandboxContext methods; parser is stale`,
    );
  }
  for (const method of methods) {
    if (!docs.includes(method)) {
      problems.push(
        `dev/hostIntegration.md does not mention SandboxContext.${method}`,
      );
    }
  }
}

const capabilitiesBody = hostSource.match(
  /export interface RequiredHostCapabilities \{([\s\S]*?)\n\}/,
)?.[1];
if (!capabilitiesBody) {
  problems.push("could not find RequiredHostCapabilities in src/host.ts");
} else {
  const capabilities = [
    ...capabilitiesBody.matchAll(/^\s{2}([A-Za-z][\w]*)\s*\(/gm),
  ].map((match) => match[1]);
  if (!capabilities.length) {
    problems.push("could not parse RequiredHostCapabilities methods");
  }
  for (const capability of capabilities) {
    if (!docs.includes(capability)) {
      problems.push(
        `dev/hostIntegration.md does not mention capability "${capability}"`,
      );
    }
  }
}

if (problems.length) {
  console.error("Contract/documentation check failed:\n");
  for (const problem of problems) console.error(`- ${problem}`);
  process.exitCode = 1;
} else {
  console.log("Contract/documentation names are in sync.");
}
