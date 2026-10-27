/**
 * Child-process entry point for isolated style runs (`./isolate.ts`).
 *
 * The child re-parses the test data and runs the style exactly like the
 * in-process path does; the only difference is the boundary around it. Results
 * are size-checked here, before they are sent back, so a pathological output
 * never has to cross the boundary to be rejected.
 *
 * Nothing is read from `process.argv`: the request arrives over IPC, and the
 * process exits once the reply is sent.
 */
import process from "node:process";
import {
  createBanyanRuntimeError,
  type Style,
  type StyleDiagnostic,
  type StyleMessage,
  type StyleOptionValues,
  type StyleResult,
} from "../banyan";
import { TestLibrary } from "../library/library";
import { buildContexts, type ContextsInput } from "./contexts";
import { runStyle } from "./runner";

export interface IsolateChildRequest {
  code: string;
  rdf?: string;
  itemsJson?: unknown;
  contexts: ContextsInput;
  styleDir: string;
  evaluateTimeoutMs?: number;
  styleOptions?: StyleOptionValues;
  maxOutputBytes: number;
}

export interface IsolateChildFailure {
  message: string;
  code?: string;
}

export type IsolateChildReply =
  | {
      ok: true;
      info: Style["INFO"];
      result: StyleResult;
      messages: StyleMessage[];
      diagnostics: StyleDiagnostic[];
      libraryDiagnostics: StyleDiagnostic[];
      styleOptions?: StyleOptionValues;
    }
  | { ok: false; error: IsolateChildFailure };

async function run(request: IsolateChildRequest): Promise<IsolateChildReply> {
  const library =
    request.rdf !== undefined
      ? TestLibrary.fromRdf(request.rdf)
      : TestLibrary.fromItemDatabase(request.itemsJson);
  const contexts = buildContexts(library, request.contexts);
  const result = await runStyle(
    {
      code: request.code,
      library,
      styleDir: request.styleDir,
      timeoutMs: request.evaluateTimeoutMs,
      styleOptions: request.styleOptions,
    },
    contexts,
  );

  const reply: IsolateChildReply = {
    ok: true,
    info: result.style.INFO,
    result: result.result,
    messages: result.messages,
    diagnostics: [...result.style.diagnostics],
    libraryDiagnostics: [...library.diagnostics],
    ...(result.styleOptions ? { styleOptions: result.styleOptions } : {}),
  };

  const bytes = Buffer.byteLength(JSON.stringify(reply), "utf8");
  if (bytes > request.maxOutputBytes) {
    throw createBanyanRuntimeError(
      `The isolated style run produced ${bytes} bytes, exceeding the ${request.maxOutputBytes}-byte output limit.`,
      { code: "generate-output" },
    );
  }
  return reply;
}

function failureOf(error: unknown): IsolateChildFailure {
  if (error instanceof Error) {
    return {
      message: error.message,
      code: (error as { code?: unknown }).code as string | undefined,
    };
  }
  return { message: String(error) };
}

process.on("message", (message: unknown) => {
  const request = (message as { type?: string; payload?: IsolateChildRequest })
    .payload;
  if (!request) {
    process.send?.({
      ok: false,
      error: { message: "Empty isolation request." },
    });
    process.exit(1);
    return;
  }
  void run(request).then(
    (reply) => {
      process.send?.(reply, () => process.exit(0));
    },
    (error: unknown) => {
      process.send?.({ ok: false, error: failureOf(error) }, () =>
        process.exit(0),
      );
    },
  );
});
