/**
 * Reject a promise that takes too long, without cancelling it.
 *
 * The core's delegation and resource budgets both need the same two facts:
 * which error a timeout is (so it can be mapped to a `reason` instead of a
 * generic failure) and a rejection the abandoned promise cannot leak. Like
 * `withGenerateTimeout`, this only abandons the wait; the underlying work keeps
 * running and its eventual settlement is consumed here.
 */
export class DeadlineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DeadlineError";
  }
}

export function isDeadlineError(value: unknown): value is DeadlineError {
  return value instanceof DeadlineError;
}

export function withDeadline<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => {
        reject(new DeadlineError(message));
      },
      Math.max(0, timeoutMs),
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
