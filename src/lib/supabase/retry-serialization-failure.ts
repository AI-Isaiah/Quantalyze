/**
 * Retry a Supabase RPC ONCE when it loses an enqueue race (Phase 164.6, OPS-08-TS).
 *
 * `_enqueue_compute_job_internal` raises SQLSTATE 40001
 * (`serialization_failure`) when an enqueue loses the in-flight race and the
 * winning job has already advanced past the in-flight statuses. Mig
 * 20260826150000 introduced the raise; its latest definition is mig
 * 20260924230827.
 *
 * ⚠️ WHETHER THIS HELPER EVER FIRES DEPENDS ON THE POSTGREST VERSION.
 *
 *   - DORMANT on PostgREST 14.x. The gateway runs every RPC in a retrying
 *     transaction and re-runs a 40001 itself, so this code never sees it. The
 *     re-run converges: the winner is terminal by then, so the second attempt
 *     enqueues a fresh job. Measured on the local-stack lane's PostgREST v14.7
 *     in Phase 164.9.3.2.1 plan 01 (race induced once and three times, HTTP
 *     200 both times), and pinned DB-side by
 *     supabase/tests/test_enqueue_race_loss_40001.sql.
 *   - LIVE on PostgREST 16 or later, which returns the 40001 to the client as
 *     HTTP 500 with `code` `40001` (PostgREST PR #4222) instead of retrying it.
 *   - It STAYS because PROD's PostgREST version can differ from the lane's,
 *     and an upgrade to 16 would otherwise turn every lost race into a
 *     failure. supabase-js always goes through PostgREST, so the version is
 *     the whole question for this helper.
 *
 * Without PostgREST in between, a raw 40001 from this raise is still seen: the
 * pg_cron SQL fan-outs `enqueue_ledger_refresh_for_strategies`,
 * `enqueue_ledger_composite_refresh` and
 * `enqueue_refresh_allocator_equity_for_all` call the enqueue directly and
 * catch `serialization_failure` themselves. That is a fact about those SQL
 * callers; this helper plays no part in it.
 *
 * The policy here is deliberately narrow:
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
