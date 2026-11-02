/* global URL, console, process */
/**
 * Keep debt and limitation notes discoverable and consistently tagged.
 *
 * Known debt lives next to the code that carries it (a comment at the site),
 * not in a table that would drift. This check makes that convention
 * enforceable: every `DEBT(trigger):` / `LIMIT(reason):` note must name its
 * trigger and carry a message, and no competing convention may appear.
 *
 * Run: `pnpm check:debt` (part of `pnpm lint:check`, hence CI).
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SOURCE_DIRS = ["src"];
const TAG_LINE = /^\s*(?:\/\/|\*)\s*(DEBT|LIMIT|TODO)\(([^)]*)\):(.*)$/;
const INTENDED_TAG = /^\s*(?:\/\/|\*)\s*(DEBT|LIMIT|TODO)\b/;
const COMPETING = /\bFIXME\b/;
const MAX_TRIGGER_LENGTH = 60;

function listTypeScriptFiles(directory) {
  const entries = readdirSync(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...listTypeScriptFiles(path));
    } else if (entry.isFile() && entry.name.endsWith(".ts")) {
      files.push(path);
    }
  }
  return files;
}

const problems = [];
const found = new Map();

for (const sourceDir of SOURCE_DIRS) {
  for (const file of listTypeScriptFiles(join(ROOT, sourceDir))) {
    const lines = readFileSync(file, "utf8").split(/\r?\n/);
    lines.forEach((line, index) => {
      const location = `${relative(ROOT, file).replaceAll("\\", "/")}:${index + 1}`;

      if (COMPETING.test(line)) {
        problems.push(
          `${location}: FIXME is not used here; record debt as ` +
            "`DEBT(trigger): message` or fix it now.",
        );
        return;
      }

      if (!INTENDED_TAG.test(line)) {
        return;
      }

      const match = TAG_LINE.exec(line);
      if (!match) {
        problems.push(
          `${location}: malformed tag; expected \`TAG(trigger): message\`.`,
        );
        return;
      }

      const [, tag, rawTrigger, rawMessage] = match;
      const trigger = rawTrigger.trim();
      const message = rawMessage.trim();
      if (!trigger) {
        problems.push(`${location}: ${tag}() needs a non-empty trigger.`);
        return;
      }
      if (trigger.length > MAX_TRIGGER_LENGTH) {
        problems.push(
          `${location}: ${tag}() trigger exceeds ${MAX_TRIGGER_LENGTH} chars; ` +
            "keep the condition, put detail in the message.",
        );
        return;
      }
      if (!message) {
        problems.push(`${location}: ${tag}(${trigger}) needs a message.`);
        return;
      }

      const entry = `${location}: ${tag}(${trigger})`;
      if (!found.has(tag)) {
        found.set(tag, []);
      }
      found.get(tag).push(entry);
    });
  }
}

if (problems.length) {
  console.error(`Debt tag check failed (${problems.length} problem(s)):\n`);
  for (const problem of problems) {
    console.error(`- ${problem}`);
  }
  process.exitCode = 1;
} else {
  const total = [...found.values()].reduce(
    (sum, entries) => sum + entries.length,
    0,
  );
  console.log(`Debt tag check passed: ${total} tagged note(s).`);
  for (const [tag, entries] of [...found].sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    console.log(`\n${tag}`);
    for (const entry of entries) {
      console.log(`  ${entry}`);
    }
  }
}
