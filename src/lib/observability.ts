import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Check for notification dispatches stuck in "queued" status beyond a threshold.
 *
 * Useful for cron jobs or admin dashboards that need to surface delivery problems.
 * Queries `notification_dispatches` for rows that have been queued longer than
 * `thresholdMinutes` (default 60).
 */
export async function checkStuckNotifications(
  supabase: SupabaseClient,
  thresholdMinutes = 60,
): Promise<{ stuck: number }> {
  const cutoff = new Date(Date.now() - thresholdMinutes * 60_000).toISOString();

  const { count, error } = await supabase
    .from("notification_dispatches")
    .select("id", { count: "exact", head: true })
    .eq("status", "queued")
    .lt("created_at", cutoff);

  if (error) {
    console.error("[observability] Failed to check stuck notifications:", error.message);
    return { stuck: 0 };
  }

  return { stuck: count ?? 0 };
}
