/**
 * File resources: `STYLE_RESOURCES` plus the `loadResource()` utility.
 *
 * Declaring a resource makes the read bounded in a way the raw `readFile`
 * primitive never was: the id is known statically, the path is checked by the
 * core before a host sees it, the byte cap and the timeout are the core's own,
 * and a failure is a returned result instead of a thrown host error. Success is
 * cached for the instance's lifetime and frozen, so a run can neither re-read a
 * changing file nor leak an edit into the next run; a read that is still in
 * flight is shared, so concurrent calls see the same snapshot.
 */
import type {
  LoadResourceFailureReason,
  LoadResourceResult,
} from "../types/styleUtils";
import type { ResolvedHost } from "../host";
import type { StyleMessageReporter } from "../messages";
import type { NormalizedResource } from "../validation/resources";
import { errorMessageOf } from "./runtimeErrors";
import { isDeadlineError, withDeadline } from "./deadline";
import {
  isValidResourcePath,
  MAX_RESOURCE_BYTES,
  RESOURCE_TIMEOUT_MS,
} from "@banyan/style-contract";

export interface ResourceRuntime {
  /** Fill in what the declaration pass resolved. */
  configure(resources: NormalizedResource[] | undefined): void;
  /** Clear the per-run timeout breaker. */
  beginRun(): void;
  load(id: unknown): Promise<LoadResourceResult>;
}

export interface ResourceRuntimeParams {
  host: () => ResolvedHost;
  messages: StyleMessageReporter;
  /**
   * Async budget of one read. Defaults to `RESOURCE_TIMEOUT_MS`; the override
   * exists so tests can exercise the timeout without waiting ten seconds.
   */
  timeoutMs?: number;
}

function truncate(text: string, limit = 300): string {
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

/**
 * Whether a host read failed because the host's own size cap refused it.
 *
 * The contract does not define a code for this, so the marker is optional and
 * only hosts that can tell the difference set it; anything else stays
 * `missing`, which is the honest generic answer.
 */
function hostSaysTooLarge(error: unknown): boolean {
  return (
    !!error &&
    typeof error === "object" &&
    (error as { reason?: unknown }).reason === "too-large"
  );
}

/** Freeze parsed data all the way down; JSON data cannot be cyclic. */ function deepFreeze<
  T,
>(value: T): T {
  if (!value || typeof value !== "object") {
    return value;
  }
  if (Object.isFrozen(value)) {
    return value;
  }
  Object.freeze(value);
  for (const nested of Object.values(value as Record<string, unknown>)) {
    deepFreeze(nested);
  }
  return value;
}

export function createResourceRuntime(
  params: ResourceRuntimeParams,
): ResourceRuntime {
  let declarations: NormalizedResource[] | undefined;
  // Successes are instance-level: a resource is a snapshot for the lifetime of
  // the style instance, and the host rebuilds the instance to pick up a change.
  const loaded = new Map<string, unknown>();
  // In-flight reads are shared, not duplicated: two concurrent calls must observe
  // one read and therefore one snapshot, even if the host read is stateful or the
  // file changes between two reads.
  const pending = new Map<string, Promise<LoadResourceResult>>();
  // Timeouts are the one failure that is not retried, because the abandoned
  // host read may still be running.
  const timedOut = new Set<string>();

  const report = (
    reason: LoadResourceFailureReason,
    message: string,
    id: string,
  ): void => {
    params.messages.report({
      severity: "warning",
      source: "resources",
      message,
      finding: {
        // Every reason here is a registered runtime-only resource id.
        diagnosticId: `resource.${reason}`,
        path: [id],
        data: { id, reason },
      },
    });
  };

  const fail = (
    reason: LoadResourceFailureReason,
    message: string,
    id: string,
    reported = false,
  ): LoadResourceResult => {
    if (!reported) {
      report(reason, message, id);
    }
    return { ok: false, reason, message };
  };

  /**
   * One read: host call, byte and time bounds, decode, parse, validate, cache.
   *
   * `load()` calls this at most once per id while a read is in flight, so the
   * instance can only ever cache one shape of a declared resource.
   */
  const read = async (
    id: string,
    declared: NormalizedResource,
  ): Promise<LoadResourceResult> => {
    const readFile = params.host().capabilities.readFile;
    if (!readFile) {
      return fail(
        "unavailable",
        `loadResource('${id}'): the host does not provide the "readFile" capability`,
        id,
      );
    }
    // The declaration was checked already; re-checking here is the runtime's
    // own defence, and it keeps the host's `readFile` from ever seeing a path
    // that could escape the style directory.
    if (!isValidResourcePath(declared.path)) {
      return fail(
        "invalid",
        `loadResource('${id}'): '${declared.path}' is not a plain relative path inside the style directory`,
        id,
      );
    }

    let bytes: Uint8Array;
    const timeoutMs = params.timeoutMs ?? RESOURCE_TIMEOUT_MS;
    try {
      bytes = await withDeadline(
        readFile(declared.path, { maxBytes: MAX_RESOURCE_BYTES + 1 }),
        timeoutMs,
        `Reading '${declared.path}' took longer than ${timeoutMs} ms.`,
      );
    } catch (error) {
      if (isDeadlineError(error)) {
        timedOut.add(id);
        // The abandoned host read must not become the next run's snapshot.
        pending.delete(id);
        return fail(
          "timeout",
          `loadResource('${id}'): reading '${declared.path}' took longer than ${timeoutMs} ms; it is skipped for the rest of this run`,
          id,
        );
      }
      // A host may refuse a read because of its own size cap. That is not a
      // missing file, and reporting it as one sends the author looking for the
      // wrong problem.
      if (hostSaysTooLarge(error)) {
        return fail(
          "too-large",
          `loadResource('${id}'): '${declared.path}' was refused by the host's size limit: ${truncate(
            errorMessageOf(error),
          )}`,
          id,
        );
      }
      return fail(
        "missing",
        `loadResource('${id}'): '${declared.path}' could not be read: ${truncate(
          errorMessageOf(error),
        )}`,
        id,
      );
    }

    if (bytes.byteLength > MAX_RESOURCE_BYTES) {
      return fail(
        "too-large",
        `loadResource('${id}'): '${declared.path}' is larger than the ${MAX_RESOURCE_BYTES}-byte limit`,
        id,
      );
    }

    let text: string;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      return fail(
        "invalid",
        `loadResource('${id}'): '${declared.path}' is not valid UTF-8`,
        id,
      );
    }

    let data: unknown = text;
    if (declared.format === "json") {
      try {
        data = JSON.parse(text) as unknown;
      } catch (error) {
        return fail(
          "invalid",
          `loadResource('${id}'): '${declared.path}' is not valid JSON: ${truncate(
            errorMessageOf(error),
          )}`,
          id,
        );
      }
    }

    // Freeze before the validator runs: a validator is read-only by contract,
    // and the cache must not be something a later run can edit.
    deepFreeze(data);
    if (declared.validate) {
      const verdict = declared.validate(data);
      if (verdict !== true) {
        const message =
          typeof verdict === "string" && verdict.trim()
            ? truncate(verdict)
            : "validate() returned false";
        return fail(
          "invalid",
          `loadResource('${id}'): '${declared.path}' did not pass validate(): ${message}`,
          id,
        );
      }
    }

    loaded.set(id, data);
    return { ok: true, data };
  };

  const load = async (idRaw: unknown): Promise<LoadResourceResult> => {
    const id = typeof idRaw === "string" ? idRaw.trim() : "";
    const declared = declarations?.find((resource) => resource.id === id);
    if (!declared) {
      return fail(
        "undeclared",
        `loadResource('${id}'): '${id}' is not declared in STYLE_RESOURCES`,
        id,
      );
    }
    if (timedOut.has(id)) {
      return fail(
        "timeout",
        `loadResource('${id}'): a previous read of '${id}' timed out in this run`,
        id,
      );
    }
    if (loaded.has(id)) {
      return { ok: true, data: loaded.get(id) };
    }
    const inFlight = pending.get(id);
    if (inFlight) {
      return inFlight;
    }

    const promise = read(id, declared);
    pending.set(id, promise);
    const settle = () => {
      if (pending.get(id) === promise) {
        pending.delete(id);
      }
    };
    // A failure is retryable by a later call, so the entry goes away on either
    // settlement; every caller already awaiting `promise` still gets its result.
    promise.then(settle, settle);
    return promise;
  };

  return {
    configure(resources) {
      declarations = resources;
      loaded.clear();
      pending.clear();
      timedOut.clear();
    },
    beginRun() {
      timedOut.clear();
    },
    load,
  };
}
