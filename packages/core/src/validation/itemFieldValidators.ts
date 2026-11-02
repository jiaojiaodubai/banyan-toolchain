import { errorMessageOf } from "../sandbox/runtimeErrors";
import { isSandboxCallable, type SandboxContext } from "../host";
import { withDetail, type StyleMessageReporter } from "../messages";
import {
  ZOTERO_ITEM_TYPE_SET as ZOTERO_ITEM_TYPES,
  type ContractFinding,
} from "@banyan/style-contract";
import type { Item, ItemType } from "../types/item";
import type {
  FieldCheck,
  FieldCheckResult,
  FieldValidator,
  ItemFieldValidators,
} from "../types/style";

export type FieldCheckStatus = "pass" | "fail" | "error";
export type FieldCheckErrorReason = "thrown" | "invalid-result" | "timeout";

/** Budget for one asynchronous checker, in milliseconds. */
export const FIELD_CHECK_TIMEOUT_MS = 10_000;

/** One checker's outcome, ready to be rendered in a host report. */
export type FieldCheckEntry = {
  description: string;
  status: FieldCheckStatus;
  messages: string[];
  /** Set when `status` is `error`; the host localizes the reason. */
  error?: FieldCheckErrorReason;
};

/**
 * Internal control-flow markers: `runItemFieldValidators` catches these and
 * turns them into `FieldCheckEntry.error` reasons. They never cross the public
 * API and therefore do not need a `RuntimeCode`/`sourcePath`.
 */
class InvalidFieldCheckResultError extends Error {
  constructor() {
    super("The item field checker returned an unsupported result.");
    this.name = "InvalidFieldCheckResultError";
  }
}

/** Internal control-flow marker; see `InvalidFieldCheckResultError`. */
class FieldCheckTimeoutError extends Error {
  constructor() {
    super("The item field checker timed out.");
    this.name = "FieldCheckTimeoutError";
  }
}

/**
 * Normalize the `ITEM_FIELD_VALIDATORS` export: an object keyed by Zotero item
 * type, each value an array of `{ description, check }` entries. Invalid
 * entries are dropped with a diagnostic; the style itself still loads.
 */
export function normalizeItemFieldValidators(
  raw: unknown,
  context: SandboxContext,
  messages: StyleMessageReporter,
): ItemFieldValidators | undefined {
  if (raw === undefined || raw === null) {
    return undefined;
  }

  let exported: unknown;
  try {
    exported = context.exportValue(raw);
  } catch {
    exported = raw;
  }

  if (!isRecord(exported)) {
    warn(
      withDetail(messages, {
        declaration: { export: "ITEM_FIELD_VALIDATORS" },
      }),
      "ITEM_FIELD_VALIDATORS must be an object keyed by item type; ignored",
    );
    return undefined;
  }

  const out: ItemFieldValidators = {};

  for (const [rawType, rawEntries] of Object.entries(exported)) {
    const itemType = rawType.trim();
    const groupMessages = withDetail(messages, {
      declaration: {
        export: "ITEM_FIELD_VALIDATORS",
        group: itemType || rawType,
      },
    });
    if (!isItemType(itemType)) {
      warn(
        groupMessages,
        `ITEM_FIELD_VALIDATORS: unknown item type '${rawType}'; ignored`,
        {
          diagnosticId: "validator.group.unknown-item-type",
          path: ["ITEM_FIELD_VALIDATORS", itemType || rawType],
        },
      );
      continue;
    }
    if (!Array.isArray(rawEntries)) {
      warn(
        groupMessages,
        `ITEM_FIELD_VALIDATORS['${itemType}'] must be an array of checkers; ignored`,
        {
          diagnosticId: "validator.group.not-array",
          path: ["ITEM_FIELD_VALIDATORS", itemType],
        },
      );
      continue;
    }
    if (!rawEntries.length) {
      warn(
        groupMessages,
        `ITEM_FIELD_VALIDATORS['${itemType}'] has no checkers; ignored`,
        {
          diagnosticId: "validator.group.empty",
          path: ["ITEM_FIELD_VALIDATORS", itemType],
        },
      );
      continue;
    }

    const validators: FieldValidator[] = [];
    for (const [index, rawEntry] of rawEntries.entries()) {
      const entryMessages = withDetail(groupMessages, {
        declaration: { index },
      });
      if (!isRecord(rawEntry)) {
        warn(
          entryMessages,
          `ITEM_FIELD_VALIDATORS['${itemType}'][${index}] is not an object; ignored`,
          {
            diagnosticId: "validator.entry.not-object",
            path: ["ITEM_FIELD_VALIDATORS", itemType, index],
          },
        );
        continue;
      }

      const description =
        typeof rawEntry.description === "string"
          ? rawEntry.description.trim()
          : "";
      const namedEntryMessages = description
        ? withDetail(entryMessages, { declaration: { id: description } })
        : entryMessages;
      if (!description) {
        warn(
          namedEntryMessages,
          `ITEM_FIELD_VALIDATORS['${itemType}'][${index}] needs a non-empty string description; ignored`,
          {
            diagnosticId: "validator.description.invalid",
            path: ["ITEM_FIELD_VALIDATORS", itemType, index, "description"],
          },
        );
        continue;
      }

      const check = createHostCheck(rawEntry.check, context);
      if (!check) {
        warn(
          namedEntryMessages,
          `ITEM_FIELD_VALIDATORS['${itemType}']['${description}'] needs a check function; ignored`,
          {
            diagnosticId: "validator.check.invalid",
            path: ["ITEM_FIELD_VALIDATORS", itemType, description, "check"],
          },
        );
        continue;
      }

      validators.push({ description, check });
    }

    if (validators.length) {
      out[itemType] = validators;
    }
  }

  return Object.keys(out).length ? out : undefined;
}

/**
 * Run one item type's checkers against a snapshot. Checks run in declaration
 * order, each one awaited until it settles or its timeout expires; a throwing,
 * malformed, or timed-out checker becomes an `error` entry and the remaining
 * checkers still run.
 */
export async function runItemFieldValidators(
  validators: readonly FieldValidator[],
  item: Readonly<Item>,
  options: { timeoutMs?: number } = {},
): Promise<FieldCheckEntry[]> {
  const timeoutMs = options.timeoutMs ?? FIELD_CHECK_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    // Host programming error, not a style/run failure: keep it a RangeError
    // rather than inventing a RuntimeCode for a call-site mistake.
    throw new RangeError(
      "runItemFieldValidators timeoutMs must be a positive finite number.",
    );
  }

  const entries: FieldCheckEntry[] = [];
  for (const validator of validators) {
    try {
      const result = await withTimeout(
        Promise.resolve(validator.check(item)),
        timeoutMs,
      );
      entries.push(toEntry(validator, result));
    } catch (error) {
      entries.push(errorEntry(validator, error));
    }
  }
  return entries;
}

/**
 * Bridge one sandbox checker to a host callable. The result is validated once
 * it settles so the runner can trust its type; a synchronous throw or a
 * rejected promise is handled by the runner.
 */
function createHostCheck(
  raw: unknown,
  context: SandboxContext,
): FieldCheck | undefined {
  if (!isSandboxCallable(raw)) {
    return undefined;
  }

  return (item) => {
    const result = raw(context.importValue(item));
    if (isThenable(result)) {
      return Promise.resolve(result).then(normalizeFieldCheckValue);
    }
    return normalizeFieldCheckValue(result);
  };
}

function normalizeFieldCheckValue(value: unknown): FieldCheckResult {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    const message = value.trim();
    if (!message) {
      throw new InvalidFieldCheckResultError();
    }
    return message;
  }
  if (Array.isArray(value)) {
    const messages: string[] = [];
    for (const entry of value) {
      if (typeof entry !== "string" || !entry.trim()) {
        throw new InvalidFieldCheckResultError();
      }
      messages.push(entry.trim());
    }
    return messages;
  }
  throw new InvalidFieldCheckResultError();
}

function toEntry(
  validator: FieldValidator,
  result: FieldCheckResult,
): FieldCheckEntry {
  if (result === true) {
    return pass(validator);
  }
  if (result === false) {
    return fail(validator, []);
  }
  if (typeof result === "string") {
    return fail(validator, [result]);
  }
  if (result.length === 0) {
    return pass(validator);
  }
  return fail(validator, [...result]);
}

function errorEntry(
  validator: FieldValidator,
  error: unknown,
): FieldCheckEntry {
  if (error instanceof InvalidFieldCheckResultError) {
    return {
      description: validator.description,
      status: "error",
      messages: [],
      error: "invalid-result",
    };
  }
  if (error instanceof FieldCheckTimeoutError) {
    return {
      description: validator.description,
      status: "error",
      messages: [],
      error: "timeout",
    };
  }
  const message = errorMessage(error);
  return {
    description: validator.description,
    status: "error",
    messages: message ? [message] : [],
    error: "thrown",
  };
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new FieldCheckTimeoutError()),
      timeoutMs,
    );
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    "then" in value &&
    typeof value.then === "function"
  );
}

function pass(validator: FieldValidator): FieldCheckEntry {
  return { description: validator.description, status: "pass", messages: [] };
}

function fail(validator: FieldValidator, messages: string[]): FieldCheckEntry {
  return { description: validator.description, status: "fail", messages };
}

function errorMessage(error: unknown): string {
  // A checker may run in a different realm (the Node host's vm, a future
  // worker), so `instanceof Error` is not a reliable test. Read `message`
  // structurally, exactly as parameter validation and runtimeErrors do.
  if (error === undefined || error === null) return "";
  return errorMessageOf(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isItemType(value: string): value is ItemType {
  return ZOTERO_ITEM_TYPES.has(value);
}

function warn(
  messages: StyleMessageReporter,
  message: string,
  finding?: ContractFinding,
): void {
  messages.report({
    severity: "warning",
    source: "item-field-validators",
    message,
    ...(finding ? { finding } : {}),
  });
}

// Keep the author-facing result type in the emitted declaration for hosts that
// build report data from this module.
export type { FieldCheckResult };
