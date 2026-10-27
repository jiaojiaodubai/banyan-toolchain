/**
 * Run one canonical fixture through the static and runtime executors and return
 * the diagnostic identifiers each produced. The fixture never compares English
 * prose or source locations; those belong to the executor.
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import js from "@eslint/js";
import { ESLint } from "eslint";
import {
  createBanyanStyleConfig,
  diagnosticIdFor,
} from "eslint-plugin-banyan-style";
import {
  createStyle,
  createTestKitHost,
  TestLibrary,
} from "@banyan/style-test-kit";

export interface Fixture {
  id: string;
  description: string;
  source: string[];
  expect: {
    runtime: string[];
    lint: string[];
  };
}

const fixtureDir = fileURLToPath(new URL("../fixtures/", import.meta.url));

export async function loadFixtures(): Promise<Fixture[]> {
  const files = (await readdir(fixtureDir))
    .filter((file) => file.endsWith(".json"))
    .sort();
  return Promise.all(
    files.map(async (file) => {
      const raw = await readFile(path.join(fixtureDir, file), "utf8");
      return JSON.parse(raw) as Fixture;
    }),
  );
}

function fixtureSource(fixture: Fixture): string {
  return fixture.source.join("\n");
}

const coreEntry = fileURLToPath(import.meta.resolve("@banyan/core"));
const typingsDir = path.join(path.dirname(coreEntry), "types");

export interface LintOutcome {
  ids: string[];
  unmapped: string[];
}

export async function lintFixture(fixture: Fixture): Promise<LintOutcome> {
  const eslint = new ESLint({
    overrideConfigFile: true,
    overrideConfig: [
      js.configs.recommended,
      createBanyanStyleConfig({ typingsDir }),
    ],
  });
  const [result] = await eslint.lintText(fixtureSource(fixture), {
    filePath: "style.js",
  });
  const ids: string[] = [];
  const unmapped: string[] = [];
  for (const message of result?.messages ?? []) {
    if (!message.ruleId?.startsWith("banyanStyle/")) continue;
    const id = diagnosticIdFor(message.ruleId, message.messageId);
    if (!id) {
      unmapped.push(
        `${message.ruleId}/${message.messageId ?? "(no messageId)"}`,
      );
      continue;
    }
    ids.push(id);
  }
  return { ids, unmapped };
}

export async function runtimeFixture(fixture: Fixture): Promise<string[]> {
  const host = createTestKitHost({
    library: TestLibrary.empty(),
    styleDir: process.cwd(),
  });
  const style = await createStyle(host, fixtureSource(fixture));
  return style.diagnostics
    .filter(
      (message) =>
        message.finding &&
        ["params", "field-presets", "item-field-validators"].includes(
          message.source,
        ),
    )
    .map((message) => message.finding!.diagnosticId);
}
