import type { ESLint, Linter } from "eslint";

export interface BanyanStyleConfigOptions {
  /** Glob patterns for style scripts; defaults to every `.js` file. */
  files?: string[];
  /**
   * Directory holding the generated `styleUtils.d.ts` and `unit.d.ts`.
   * Defaults to the module directory, which is where Banyan copies the linter
   * next to the typings in its runtime data directory.
   */
  typingsDir?: string;
  /** Additional host globals merged after the Banyan author globals. */
  globals?: Linter.Globals;
  /** `STYLE_OPTIONS` warning threshold, 1-16; defaults to 12. */
  warnCount?: number;
}

/** CSL name variables; mirrored from the core schema. */
export const CSL_NAME_VARIABLES: ReadonlySet<string>;

/** Keys an item field preset must never target, in normalized form. */
export const PRESET_DENIED_KEYS: ReadonlySet<string>;

/** Zotero UI label (flattened, lowercase) to item field name. */
export const ITEM_FIELD_LABELS: ReadonlyMap<string, string>;

/** Keys a Banyan item never carries. */
export const ITEM_FIELDS_NOT_CARRIED: readonly string[];

/** Stable rule/messageId -> contract diagnostic mapping. */
export const RULE_MESSAGE_DIAGNOSTICS: Readonly<Record<string, string>>;

/** Resolve one ESLint report to its contract diagnostic, if mapped. */
export function diagnosticIdFor(
  ruleId: string | null | undefined,
  messageId: string | null | undefined,
): string | undefined;

/**
 * Build the shared flat-config fragment: author globals, the plugin object and
 * the recommended rule levels. Combine it with a base config such as
 * `js.configs.recommended` and file-specific overrides.
 */
export function createBanyanStyleConfig(
  options?: BanyanStyleConfigOptions,
): Linter.Config;

declare const plugin: ESLint.Plugin;

export default plugin;
