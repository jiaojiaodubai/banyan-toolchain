/**
 * Isolated style runs for untrusted styles.
 *
 * The in-process runtime (`node:vm`) is a *correctness* boundary: it isolates
 * prototypes, not compute or data. This module adds the resource boundary a
 * third-party or AI-generated style needs, by running it in a **separate
 * process** (`child_process.fork`):
 *
 * - a synchronous dead loop cannot block the caller, and a wall-clock budget
 *   kills the child (an in-process `evaluate` timeout cannot interrupt a native
 *   or tight loop for certain, and cannot free a runaway heap);
 * - the heap is capped by V8 (`--max-old-space-size`), so an out-of-memory style
 *   aborts the child instead of the CLI; V8's message is recognised and
 *   reported as a memory failure;
 * - the result is size-checked inside the child, before it crosses the boundary;
 * - the style's file access is still the `readFile` capability, confined to a
 *   read-only style directory; the sandbox has no `require`, no network and no
 *   host secrets;
 * - the child inherits the parent's `execArgv`, so whatever loader started the
 *   CLI (tsx in normal use) also starts the child — no second loader to
 *   maintain.
 *
 * The caller never trusts the child: a child that never answers is reported as
 * a timeout, not awaited forever.
 */
import { fork, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  createBanyanRuntimeError,
  isRuntimeCode,
  type Style,
  type StyleDiagnostic,
  type StyleMessage,
  type StyleOptionValues,
  type StyleResult,
} from "../banyan";
import type { ContextsInput } from "./contexts";
import type { IsolateChildReply, IsolateChildRequest } from "./isolate-child";

export interface IsolationOptions {
  /** Style source code. */
  code: string;
  /** Zotero RDF test data; the child parses it into its own library. */
  rdf?: string;
  /** Simple JSON item database; mutually exclusive with `rdf`. */
  itemsJson?: unknown;
  /** Citation contexts to generate (spec form, JSON-serialisable). */
  contexts: ContextsInput;
  /** Directory `readFile` is confined to. */
  styleDir: string;
  /** Wall-clock budget before the child is killed (default 30 s). */
  timeoutMs?: number;
  /** V8 old-generation heap limit for the child (default 256 MiB). */
  memoryMb?: number;
  /** Maximum accepted result size in bytes (default 4 MiB). */
  maxOutputBytes?: number;
  /** Synchronous `evaluate` budget inside the child. */
  evaluateTimeoutMs?: number;
  /** Values for the style's declared options. */
  styleOptions?: StyleOptionValues;
}

export interface IsolationReport {
  /** Whether the run was stopped by the wall-clock budget. */
  timedOut: boolean;
  /** Wall-clock duration of the run. */
  elapsedMs: number;
  /** Limits the run was subject to. */
  limits: {
    timeoutMs: number;
    memoryMb: number;
    maxOutputBytes: number;
  };
}

export interface IsolatedRun {
  info: Style["INFO"];
  result: StyleResult;
  messages: StyleMessage[];
  diagnostics: StyleDiagnostic[];
  libraryDiagnostics: StyleDiagnostic[];
  /** Effective option values the run used, when the style declares any. */
  styleOptions?: StyleOptionValues;
  isolation: IsolationReport;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MEMORY_MB = 256;
const DEFAULT_MAX_OUTPUT_BYTES = 4 * 1024 * 1024;
const MAX_CHILD_STDERR_BYTES = 8 * 1024;

const CHILD_ENTRY = fileURLToPath(
  new URL("./isolate-child.ts", import.meta.url),
);

/** Run a style in a resource-limited child process (see the module header). */
export async function runStyleIsolated(
  options: IsolationOptions,
): Promise<IsolatedRun> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const memoryMb = options.memoryMb ?? DEFAULT_MEMORY_MB;
  const maxOutputBytes = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
  const startedAt = Date.now();

  if (options.rdf === undefined && options.itemsJson === undefined) {
    throw new Error("runStyleIsolated needs rdf or itemsJson test data.");
  }
  if (options.rdf !== undefined && options.itemsJson !== undefined) {
    throw new Error("runStyleIsolated accepts rdf or itemsJson, not both.");
  }

  const request: IsolateChildRequest = {
    code: options.code,
    ...(options.rdf !== undefined
      ? { rdf: options.rdf }
      : { itemsJson: options.itemsJson }),
    contexts: options.contexts,
    styleDir: options.styleDir,
    evaluateTimeoutMs: options.evaluateTimeoutMs,
    styleOptions: options.styleOptions,
    maxOutputBytes,
  };

  const child: ChildProcess = fork(CHILD_ENTRY, [], {
    // Keep the loader that started this process (tsx in normal use); the V8
    // flag is the heap cap.
    execArgv: [...process.execArgv, `--max-old-space-size=${memoryMb}`],
    // The child's console is a record channel, not stdout: only stderr is kept,
    // for V8's out-of-memory report.
    stdio: ["ignore", "ignore", "pipe", "ipc"],
    windowsHide: true,
  });

  let stderr = "";
  child.stderr?.setEncoding("utf8");
  child.stderr?.on("data", (chunk: string) => {
    if (stderr.length < MAX_CHILD_STDERR_BYTES) stderr += chunk;
  });

  return new Promise<IsolatedRun>((resolve, reject) => {
    let settled = false;
    let timedOut = false;

    const finish = (action: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGKILL");
      }
      action();
    };

    const timer = setTimeout(() => {
      timedOut = true;
      finish(() =>
        reject(
          createBanyanRuntimeError(
            `The isolated style run exceeded its ${timeoutMs} ms wall-clock limit.`,
            { code: "generate-timeout" },
          ),
        ),
      );
    }, timeoutMs);

    child.on("message", (reply: IsolateChildReply) => {
      if (reply.ok) {
        finish(() =>
          resolve({
            info: reply.info,
            result: reply.result,
            messages: reply.messages,
            diagnostics: reply.diagnostics,
            libraryDiagnostics: reply.libraryDiagnostics,
            ...(reply.styleOptions ? { styleOptions: reply.styleOptions } : {}),
            isolation: {
              timedOut,
              elapsedMs: Date.now() - startedAt,
              limits: { timeoutMs, memoryMb, maxOutputBytes },
            },
          }),
        );
        return;
      }
      finish(() =>
        reject(
          createBanyanRuntimeError(
            reply.error.message,
            isRuntimeCode(reply.error.code) ? { code: reply.error.code } : {},
          ),
        ),
      );
    });

    child.on("error", (error) => {
      finish(() =>
        reject(
          createBanyanRuntimeError(
            `The isolated style run failed: ${error.message}`,
            { code: "generate" },
          ),
        ),
      );
    });

    child.on("exit", (exitCode) => {
      finish(() => {
        const memory = /out of memory/i.test(stderr);
        reject(
          createBanyanRuntimeError(
            memory
              ? `The isolated style run exceeded its ${memoryMb} MiB memory limit.`
              : `The isolated style run ended unexpectedly (exit code ${exitCode}).`,
            { code: "generate" },
          ),
        );
      });
    });

    child.send({ type: "run", payload: request }, (error) => {
      if (error) {
        finish(() =>
          reject(
            createBanyanRuntimeError(
              `The isolated style run could not be started: ${error.message}`,
              { code: "generate" },
            ),
          ),
        );
      }
    });
  });
}
