import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * OPS-06 (Phase 163) — "NOTHING STUCK" AND "COULD NOT TELL" ARE DIFFERENT
 * ANSWERS AND MUST HAVE DIFFERENT VALUES.
 *
 * The prior signature was `Promise<{ stuck: number }>`, and `0` meant BOTH "the
 * queue is healthy" and "the read failed, here is a placeholder". A caller
 * cannot distinguish them, so the only honest thing it could do with a zero is
 * distrust every zero — which is the same as having no monitor.
 *
 * This mirrors `DenominatorResult` in the flag-monitor cron
 * (src/app/api/cron/flag-monitor/route.ts) ON PURPOSE: the repo now has ONE
 * idiom for the zero-versus-unknown distinction rather than two spellings that
 * can drift apart. When a consumer is eventually wired up, it will already know
 * this shape.
 */
export type StuckNotificationsResult =
  | { kind: "ok"; stuck: number }
  | { kind: "indeterminate"; error: string };

/**
 * Check for notification dispatches stuck in "queued" status beyond a threshold.
 *
 * Useful for cron jobs or admin dashboards that need to surface delivery problems.
 * Queries `notification_dispatches` for rows that have been queued longer than
 * `thresholdMinutes` (default 60).
 *
 * Returns `{ kind: "ok", stuck }` only when the count is a genuine, usable
 * number. Every other outcome — a PostgREST error, or a count that came back
 * unusable — is `{ kind: "indeterminate" }` carrying the reason.
 */
export async function checkStuckNotifications(
  supabase: SupabaseClient,
  thresholdMinutes = 60,
): Promise<StuckNotificationsResult> {
  const cutoff = new Date(Date.now() - thresholdMinutes * 60_000).toISOString();

  const { count, error } = await supabase
    .from("notification_dispatches")
    .select("id", { count: "exact", head: true })
    .eq("status", "queued")
    .lt("created_at", cutoff);

  if (error) {
    console.error("[observability] Failed to check stuck notifications:", error.message);
    return { kind: "indeterminate", error: error.message };
  }

  // A null `error` does not mean a usable count. postgrest-js only populates
  // `count` when the `content-range` header parses: an absent header leaves it
  // null, and a `*/*` range makes it NaN. The old `count ?? 0` caught only the
  // first case and converted it into the healthy-queue answer — re-importing
  // the very collapse the error branch above was written to avoid, on a
  // narrower path. NaN was worse still: it is not `=== 0`, so a threshold
  // comparison against it is false in both directions and the check disarms
  // itself silently. Anything that is not a non-negative integer is a read we
  // could not complete.
  if (!Number.isInteger(count) || (count as number) < 0) {
    console.error("[observability] Stuck-notification count unusable:", count);
    return {
      kind: "indeterminate",
      error: `unusable count from notification_dispatches: ${String(count)}`,
    };
  }

  return { kind: "ok", stuck: count as number };
}
