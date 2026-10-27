/**
 * Static linting for Banyan style sources.
 *
 * The rules and the author globals live in `eslint-plugin-banyan-style`, the
 * package the Banyan plugin and the styles repository use. The core's generated
 * `dist/types` directory is the default source of the `StyleUtils` globals, so
 * the test kit does not need a second copy of the author typings.
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import js from "@eslint/js";
import { ESLint } from "eslint";
import { createBanyanStyleConfig } from "eslint-plugin-banyan-style";

export interface LintStyleOptions {
  /** File name the linter sees; defaults to `style.js`. */
  filePath?: string;
  /** Directory with `styleUtils.d.ts` and `unit.d.ts`; defaults to core's types. */
  typingsDir?: string;
  /** `STYLE_OPTIONS` warning threshold, 1-16; defaults to the package's 12. */
  warnCount?: number;
}

export interface StyleLintMessage {
  ruleId: string | null;
  severity: 1 | 2;
  message: string;
  line?: number;
  column?: number;
  endLine?: number;
  endColumn?: number;
}

let cachedCoreTypingsDir: string | undefined;

function resolveCoreTypingsDir(): string {
  if (cachedCoreTypingsDir) {
    return cachedCoreTypingsDir;
  }

  const coreEntry = fileURLToPath(import.meta.resolve("@banyan/core"));
  const typingsDir = path.join(path.dirname(coreEntry), "types");
  if (!existsSync(path.join(typingsDir, "styleUtils.d.ts"))) {
    throw new Error(
      `Cannot find the generated style typings in ${typingsDir}; pass typingsDir explicitly.`,
    );
  }
  cachedCoreTypingsDir = typingsDir;
  return typingsDir;
}

/** Lint one style source with the same rules Banyan itself uses. */
export async function lintStyleSource(
  code: string,
  options: LintStyleOptions = {},
): Promise<StyleLintMessage[]> {
  const requestedPath = options.filePath ?? "style.js";
  const isAbsolute = path.isAbsolute(requestedPath);
  const eslint = new ESLint({
    // ESLint ignores files outside its base path. When the caller passes an
    // absolute path (the CLI does), lint relative to that directory instead.
    cwd: isAbsolute ? path.dirname(requestedPath) : process.cwd(),
    overrideConfigFile: true,
    overrideConfig: [
      js.configs.recommended,
      createBanyanStyleConfig({
        typingsDir: options.typingsDir ?? resolveCoreTypingsDir(),
        ...(options.warnCount ? { warnCount: options.warnCount } : {}),
      }),
    ],
  });

  const [result] = await eslint.lintText(code, {
    filePath: isAbsolute ? path.basename(requestedPath) : requestedPath,
  });
  return (result?.messages ?? []).map((message) => ({
    ruleId: message.ruleId,
    severity: message.severity === 2 ? 2 : 1,
    message: message.message,
    line: message.line,
    column: message.column,
    endLine: message.endLine,
    endColumn: message.endColumn,
  }));
}
