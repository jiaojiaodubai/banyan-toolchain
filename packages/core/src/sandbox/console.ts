/**
 * The `console` a style sees, installed by the core so one call means the same
 * thing on every host:
 *
 * - `log` / `debug` / `trace` (and `dir`, `dirxml`, `table`) are the trace
 *   stream: budgeted per run, never kept.
 * - `info` / `warn` / `error` are findings, readable through
 *   `style.diagnostics`.
 * - `assert` reports like `error` when its condition is false.
 * - The remaining methods (`count`, `time`, `group`, …) do nothing.
 *
 * Nothing here throws and nothing returns a value a caller may depend on.
 */
import type { SandboxContext } from "../host";
import type { StyleMessageReporter, StyleSeverity } from "../messages";

/** A single call cannot flood a host: values and lines are cut at these. */
const MAX_ARGUMENTS = 20;
const MAX_VALUE_LENGTH = 2_000;
const MAX_LINE_LENGTH = 8_000;

/** Console method -> severity. Only `info` and above are kept as findings. */
const CONSOLE_SEVERITIES = {
  debug: "trace",
  log: "trace",
  trace: "trace",
  dir: "trace",
  dirxml: "trace",
  table: "trace",
  info: "info",
  warn: "warning",
  error: "error",
} as const satisfies Record<string, StyleSeverity>;

/** Familiar methods with no meaning inside a style; kept so calls cannot throw. */
const SILENT_METHODS = [
  "clear",
  "count",
  "countReset",
  "group",
  "groupCollapsed",
  "groupEnd",
  "time",
  "timeLog",
  "timeEnd",
] as const;

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength)}...[truncated ${value.length - maxLength} chars]`;
}

function formatValue(value: unknown): string {
  let formatted: string;
  if (typeof value === "string") {
    formatted = value;
  } else if (
    typeof value === "number" ||
    typeof value === "boolean" ||
    value == null
  ) {
    formatted = String(value);
  } else {
    try {
      formatted = JSON.stringify(value);
    } catch {
      formatted = String(value);
    }
  }
  return truncate(formatted ?? String(value), MAX_VALUE_LENGTH);
}

/** One console call as one line, with the arguments a host could not show. */
function formatLine(values: readonly unknown[]): string {
  const visible = values.slice(0, MAX_ARGUMENTS);
  const omitted = values.length - visible.length;
  const suffix = omitted > 0 ? ` ...[${omitted} more args]` : "";
  return truncate(
    `${visible.map(formatValue).join(" ")}${suffix}`,
    MAX_LINE_LENGTH,
  );
}

function noop(): undefined {
  return undefined;
}

export function installStyleConsole(
  context: SandboxContext,
  reporter: StyleMessageReporter,
): void {
  const styleConsole = context.createObject();

  for (const [name, severity] of Object.entries(CONSOLE_SEVERITIES)) {
    context.defineFunction(styleConsole, name, (...values: unknown[]) => {
      reporter.report({
        severity,
        source: "style",
        message: formatLine(values),
      });
      return undefined;
    });
  }

  context.defineFunction(
    styleConsole,
    "assert",
    (condition: unknown, ...values: unknown[]) => {
      if (!condition) {
        reporter.report({
          severity: "error",
          source: "style",
          message: formatLine(["Assertion failed", ...values]),
        });
      }
      return undefined;
    },
  );

  for (const name of SILENT_METHODS) {
    context.defineFunction(styleConsole, name, noop);
  }

  context.defineGlobal("console", styleConsole);
}
