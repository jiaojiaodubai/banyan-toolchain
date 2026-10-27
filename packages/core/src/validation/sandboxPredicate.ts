/**
 * Bridge style-declared callbacks (`applicable` / `forcedValue` / `validate`)
 * for core-side use.
 *
 * Arguments are imported into the style's context first, so callbacks see the
 * same shape the style sees. Applicability and forced values fail open when
 * they throw; a validator's throw is reported by resolution instead.
 */
import { isSandboxCallable, type SandboxContext } from "../host";
import { drainThenable } from "./thenable";

export type SandboxPredicate = (...args: unknown[]) => unknown;
export type SandboxResolver = (...args: unknown[]) => unknown;

export function createSandboxPredicate(
  raw: unknown,
  context: SandboxContext,
): SandboxPredicate | undefined {
  if (!isSandboxCallable(raw)) {
    return undefined;
  }

  return (...args) => {
    try {
      const result = raw(...args.map((arg) => context.importValue(arg)));
      // A predicate is a boolean question; an async answer is not one, so it
      // counts as "not visible" without leaking its rejection.
      return drainThenable(result) ? false : result;
    } catch {
      return false;
    }
  };
}

/**
 * Applicability is a boolean predicate, but only a strict `false` hides the
 * parameter: a throwing or malformed callback keeps it applicable instead of
 * silently removing an input.
 */
export function createSandboxApplicability(
  raw: unknown,
  context: SandboxContext,
): ((...args: unknown[]) => boolean) | undefined {
  if (!isSandboxCallable(raw)) {
    return undefined;
  }

  return (...args) => {
    try {
      const result = raw(...args.map((arg) => context.importValue(arg)));
      // Only a strict `false` hides the parameter. A promise is not `false`,
      // so applicability fails open, but the rejection is still consumed.
      return drainThenable(result) ? true : result !== false;
    } catch {
      return true;
    }
  };
}

/**
 * A forced-value resolver returns `T` to force the parameter, or `null` to
 * leave it free. Values cross back into the host realm; a throw is treated as
 * "no forced value" so the parameter remains editable.
 */
export function createSandboxResolver(
  raw: unknown,
  context: SandboxContext,
): SandboxResolver | undefined {
  if (!isSandboxCallable(raw)) {
    return undefined;
  }

  return (...args) => {
    try {
      const result = raw(...args.map((arg) => context.importValue(arg)));
      // A forced value cannot be awaited during resolution; an async resolver
      // leaves the parameter free and its rejection is consumed.
      if (drainThenable(result)) {
        return undefined;
      }
      return context.cloneToHost(result);
    } catch {
      return undefined;
    }
  };
}

/**
 * Validation has the same call shape as a predicate: the current value first,
 * then the scope arguments. It may return `true`, `false`, or an error string.
 * A throw is deliberately not caught here: `runValidation` turns it into an
 * invalid result with the error's message, instead of losing it as `false`.
 *
 * The raw result is returned unfolded so the shared validator can recognise a
 * promise, report "must return synchronously", and consume its rejection. Folding
 * it to `false` here would hide both the contract mistake and the rejection.
 */
export function createSandboxValidator(
  raw: unknown,
  context: SandboxContext,
): ((value: string, ...scope: unknown[]) => unknown) | undefined {
  if (!isSandboxCallable(raw)) {
    return undefined;
  }

  return (value, ...scope) =>
    raw(...[value, ...scope].map((arg) => context.importValue(arg)));
}
