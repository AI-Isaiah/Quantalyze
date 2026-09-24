/**
 * Phase 167.2 — the ONE client read of whether a factsheet-chain job is in
 * flight for a strategy, shared by the key card's pre-attempt gate
 * (167.2-REVIEW CR-01 / WR-06) and the sync panel's terminal gates (KCS-18,
 * and since the review fix round also WR-03 and SFH M-3).
 *
 * It reads the existing owner-scoped `/api/strategies/[id]/sync-progress`
 * projection once. Lifted from `SyncProgress`'s `jobQueueSaysChainSettled`
 * (plan 167.2-10), whose fail-closed reading it keeps exactly:
 *   - `settled` only for a real read (HTTP ok, a JSON object, not `degraded`,
 *     `jobStatus` null or a string) whose `jobStatus` is not in flight per
 *     `isFactsheetJobInFlight`. `jobStatus` null means no factsheet-chain job
 *     is visible; `failed_final` and `done` are finished chains.
 *   - `in_flight` for a real read whose `jobStatus` is in flight (pending,
 *     running, failed_retry, done_pending_children).
 *   - `unreadable` for everything else: a limiter 429, a 5xx, a body that does
 *     not parse, a rejected fetch, the route's DEGRADED body (which since SFH
 *     M-4 also covers a non-array RPC answer, a window full at the cap and an
 *     out-of-domain status), or no answer within `CHAIN_JOB_READ_BOUND_MS`.
 * It never throws.
 *
 * Its own module (no client directive needed: it renders nothing) so the key
 * card can import it without importing the panel, and so a test of the card
 * can replace it without replacing `fetch` for every other request.
 */
import { isFactsheetJobInFlight } from "@/lib/compute-state";

export type ChainJobRead =
  | { kind: "settled"; jobStatus: string | null }
  | { kind: "in_flight"; jobStatus: string }
  // 167.2-REVIEW-R2 IN-04 / SFH-R2 R2-L1: `persistent` is true only for the
  // route's DETERMINISTIC degrade causes (`degradedReason`), where a retry
  // reads the same answer; the key card then names support rather than
  // promising "in a moment".
  | { kind: "unreadable"; reason: string; persistent?: boolean };

/**
 * How long one read may take. The same class of request as the key card's
 * other bounded reads (`TERMINAL_REREAD_BOUND_MS`, `BASELINE_READ_BOUND_MS`):
 * one owner-scoped request with no timeout of its own. Before the review fix
 * round the panel's read was unbounded, which held its one-in-flight guard
 * for as long as the request stayed open.
 */
export const CHAIN_JOB_READ_BOUND_MS = 15_000;

export async function readChainJobState(strategyId: string): Promise<ChainJobRead> {
  let boundTimer: ReturnType<typeof setTimeout> | undefined;
  try {
    const bound = new Promise<"timed_out">((resolve) => {
      boundTimer = setTimeout(() => resolve("timed_out"), CHAIN_JOB_READ_BOUND_MS);
    });
    const read = (async (): Promise<ChainJobRead> => {
      let body: unknown;
      try {
        const res = await fetch(
          `/api/strategies/${encodeURIComponent(strategyId)}/sync-progress`,
          { cache: "no-store" },
        );
        if (!res.ok) return { kind: "unreadable", reason: `HTTP ${res.status}` };
        body = await res.json();
      } catch (err) {
        return {
          kind: "unreadable",
          reason: err instanceof Error ? err.message : String(err),
        };
      }
      if (typeof body !== "object" || body === null || Array.isArray(body)) {
        return { kind: "unreadable", reason: "the body is not the projection" };
      }
      const projection = body as {
        jobStatus?: unknown;
        degraded?: unknown;
        degradedReason?: unknown;
      };
      if (projection.degraded === true) {
        return projection.degradedReason === "window_full" ||
          projection.degradedReason === "bad_status"
          ? {
              kind: "unreadable",
              reason: `degraded read (${projection.degradedReason})`,
              persistent: true,
            }
          : { kind: "unreadable", reason: "degraded read" };
      }
      if (projection.jobStatus !== null && typeof projection.jobStatus !== "string") {
        return { kind: "unreadable", reason: "the body carries no jobStatus" };
      }
      return isFactsheetJobInFlight(projection.jobStatus)
        ? { kind: "in_flight", jobStatus: projection.jobStatus as string }
        : { kind: "settled", jobStatus: projection.jobStatus };
    })();
    const outcome = await Promise.race([read, bound]);
    if (outcome === "timed_out") {
      return {
        kind: "unreadable",
        reason: `no answer within ${CHAIN_JOB_READ_BOUND_MS} ms`,
      };
    }
    return outcome;
  } finally {
    clearTimeout(boundTimer);
  }
}
