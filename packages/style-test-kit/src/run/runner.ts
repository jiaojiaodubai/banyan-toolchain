/**
 * Style execution wrapper: load code, assemble the Node host from the testkit
 * capabilities, `createStyle`, run one generate, and hand back the result plus
 * the structured messages.
 *
 * Concurrency: the core serializes generations per style instance, so callers
 * running several styles concurrently should hold one instance per style —
 * which this module's API encourages by returning the instance.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  createStyle,
  resolveStyleOptionState,
  type CitationContext,
  type StyleHost,
  type StyleInstance,
  type StyleMessage,
  type StyleMessageSink,
  type StyleOptionValues,
  type StyleResult,
} from "../banyan";
import type { TestLibrary } from "../library/library";
import { createTestKitCapabilities } from "../runtime/capabilities";
import { createNodeHost } from "../runtime/node-host";

export interface TestKitHostOptions {
  /** Test library backing the host capabilities. */
  library: TestLibrary;
  /** Directory `readFile` inside the sandbox is confined to (default cwd). */
  styleDir?: string;
  /** Sandbox `evaluate` budget (ms). */
  timeoutMs?: number;
  /** Assemble a host without the capability completeness gate. */
  assertCapabilities?: boolean;
  /** Per-file read limit for the `readFile` capability. */
  maxFileBytes?: number;
}

export interface LoadStyleOptions extends TestKitHostOptions {
  /** Style source code (read with `readStyleFile` or provided directly). */
  code: string;
  /** Optional outlet for the records as they happen (traces included). */
  messageSink?: StyleMessageSink;
  /** Async budget for one generate (ms); the core default is 15 minutes. */
  generateTimeoutMs?: number;
}

export interface RunStyleOptions extends LoadStyleOptions {
  /**
   * Values for the style's declared options (`STYLE_OPTIONS`), passed
   * to `generate(contexts, options)`. The core fills undeclared/missing ids with
   * each control's default, so a partial object is fine.
   */
  styleOptions?: StyleOptionValues;
}

export interface StyleRun {
  style: StyleInstance;
  result: StyleResult;
  /** Every message the run produced, traces included. */
  messages: StyleMessage[];
  /**
   * The effective option values the run used (declared defaults filled in,
   * `disabled` overrides applied), when the style declares option controls.
   */
  styleOptions?: StyleOptionValues;
}

export interface LoadedStyle {
  style: StyleInstance;
  /** Every message style loading produced, traces included. */
  messages: StyleMessage[];
}

/** Read a style file from disk. */
export async function readStyleFile(stylePath: string): Promise<string> {
  return readFile(stylePath, "utf8");
}

/** Assemble the testkit host for a library + style directory. */
export function createTestKitHost(options: TestKitHostOptions): StyleHost {
  const capabilities = createTestKitCapabilities({
    styleDir: path.resolve(options.styleDir ?? process.cwd()),
    library: options.library,
    maxFileBytes: options.maxFileBytes,
  });
  return createNodeHost(capabilities, {
    timeoutMs: options.timeoutMs,
    assertCapabilities: options.assertCapabilities,
  });
}

/** Load a style without running `generate()` (metadata and diagnostics only). */
export async function loadStyle(
  options: LoadStyleOptions,
): Promise<LoadedStyle> {
  const host = createTestKitHost(options);
  const messages: StyleMessage[] = [];
  const style = await createStyle(host, options.code, {
    messageSink: (message) => {
      messages.push(message);
      options.messageSink?.(message);
    },
    generateTimeoutMs: options.generateTimeoutMs,
  });
  return { style, messages };
}

/** Load a style and run one generate over the given contexts. */
export async function runStyle(
  options: RunStyleOptions,
  contexts: CitationContext[],
): Promise<StyleRun> {
  const { style, messages } = await loadStyle(options);

  const result = await style.generate(contexts, options.styleOptions);
  // Report what the style actually saw: the core resolves the same values
  // internally (defaults + applicable/forcedValue, validation off for rendering).
  const hasOptionParams = (style.STYLE_OPTIONS?.length ?? 0) > 0;
  const effectiveValues = hasOptionParams
    ? resolveStyleOptionState(style.STYLE_OPTIONS, options.styleOptions, {
        validate: false,
      }).effectiveValues
    : undefined;

  return {
    style,
    result,
    messages,
    ...(effectiveValues ? { styleOptions: effectiveValues } : {}),
  };
}
