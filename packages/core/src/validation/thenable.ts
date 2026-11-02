/**
 * One thenable test for the synchronous resolution boundary.
 *
 * A style callback (`applicable` / `forcedValue` / `validate`) is contracted to
 * answer synchronously. If it returns a promise instead, the core must either
 * pass the value through (validation, so the contract mistake can be reported)
 * or consume the rejection itself (applicability/forced values, which fail
 * open). Keeping the test in one place prevents the two call sites from
 * drifting apart.
 */
export function isThenable(value: unknown): value is PromiseLike<unknown> {
  return (
    (typeof value === "object" || typeof value === "function") &&
    value !== null &&
    typeof (value as { then?: unknown }).then === "function"
  );
}

/**
 * Consume a thenable's rejection when the caller cannot await it.
 *
 * Returns whether `value` was a thenable. A resolved value needs no handling;
 * a rejection is swallowed here because an async callback is a declared
 * contract violation, not a run failure.
 */
export function drainThenable(value: unknown): boolean {
  if (!isThenable(value)) {
    return false;
  }
  void Promise.resolve(value).catch(() => {});
  return true;
}
