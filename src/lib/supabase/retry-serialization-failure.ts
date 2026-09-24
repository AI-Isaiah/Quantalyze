/**
 * Retry a Supabase RPC ONCE when it loses an enqueue race (Phase 164.6, OPS-08-TS).
 *
 * `_enqueue_compute_job_internal` (mig 20260826150000) raises SQLSTATE 40001
 * (`serialization_failure`) when an enqueue loses the in-flight race and the
 * winning job has already advanced past the in-flight statuses. The policy
 * here is deliberately narrow:
 *
 *   - ONLY `error.code === "40001"` is retried. The SQLSTATE is the whole
 *     signal; the message riding with it is operator text. Every other error
 *     (42501, PGRST301, any other code, a null code) goes straight back to the
 *     caller's existing branch after ONE call.
 *   - EXACTLY ONCE. One user request never executes the RPC more than twice.
 *     A second 40001 is returned to the caller, whose existing failure path
 *     runs unchanged.
 *   - NO SLEEP. The 40001 is raised only after the race's winner has already
 *     advanced past the in-flight statuses, so an immediate re-issue does not
 *     collide with an in-flight row, and waiting buys nothing.
 *
 * It takes a FACTORY, never a builder. A supabase-js query builder is a
 * thenable, so awaiting the same builder a second time is not a second
 * request; calling the factory again is.
 *
 * The caller logs the retried attempt through `onRetry` (a `console.warn`) and
 * never sends it to Sentry: a retried race is an expected MVCC outcome, and
 * only a failure that survives the retry is worth an alert.
 *
 * Pure and stateless: no module-level state, so concurrent invocations each
 * get their own single-retry budget.
 */

/**
 * Call `call()`; if its result carries `error.code === "40001"`, call
 * `onRetry(first)` and return the result of calling `call()` exactly once
 * more. Any other result is returned as-is after the first call.
 */
export async function retryOnceOnSerializationFailure<
  T extends { error: { code?: string | null } | null },
>(call: () => PromiseLike<T>, onRetry: (first: T) => void): Promise<T> {
  const first = await call();
  if (first.error?.code !== "40001") return first;
  onRetry(first);
  return await call();
}
