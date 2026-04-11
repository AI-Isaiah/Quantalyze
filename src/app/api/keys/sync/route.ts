import { NextRequest, NextResponse, after } from "next/server";
import { fetchTrades, computeAnalytics } from "@/lib/analytics-client";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { withAuth } from "@/lib/api/withAuth";
import { userActionLimiter, checkLimit } from "@/lib/ratelimit";
import type { User } from "@supabase/supabase-js";

/**
 * POST /api/keys/sync — kicks off fetchTrades + computeAnalytics
 * against the Railway analytics service using the `after()` pattern.
 * Marks `strategy_analytics.computation_status = 'computing'` via the
 * service-role client, returns 202, and runs the long work in the
 * background. Clients poll `strategy_analytics` to track progress.
 */
export const maxDuration = 300;

export const POST = withAuth(async (req: NextRequest, user: User) => {
  const rl = await checkLimit(userActionLimiter, `keys-sync:${user.id}`);
  if (!rl.success) {
    return NextResponse.json(
      { error: "Too many requests" },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter) } },
    );
  }

  const body = await req.json();
  const { strategy_id } = body;

  if (!strategy_id || typeof strategy_id !== "string") {
    return NextResponse.json({ error: "Missing strategy_id" }, { status: 400 });
  }

  // Verify ownership via the user-scoped client so we get a clean
  // 403 before ever reaching the Railway pipeline.
  const supabase = await createClient();
  const { data: strategy } = await supabase
    .from("strategies")
    .select("id, user_id")
    .eq("id", strategy_id)
    .eq("user_id", user.id)
    .single();

  if (!strategy) {
    return NextResponse.json(
      { error: "Strategy not found or not owned by you" },
      { status: 403 },
    );
  }

  // Mark the row as `computing` via the service-role client. The
  // CHECK constraint at migration 001:74 only allows the four
  // canonical states, so we reuse `computing` rather than adding a
  // distinct `syncing` value.
  const admin = createAdminClient();
  const { error: upsertErr } = await admin
    .from("strategy_analytics")
    .upsert(
      {
        strategy_id,
        computation_status: "computing",
        computation_error: null,
      },
      { onConflict: "strategy_id" },
    );
  if (upsertErr) {
    console.error(
      `[keys/sync] strategy_analytics upsert failed for ${strategy_id}:`,
      upsertErr,
    );
    return NextResponse.json(
      { error: "Could not start sync. Try again in a moment." },
      { status: 503 },
    );
  }

  after(async () => {
    try {
      await fetchTrades(strategy_id);
      // Python compute-analytics writes the terminal status directly.
      const result = await computeAnalytics(strategy_id);
      console.log(
        `[keys/sync] compute complete for strategy=${strategy_id} status=${result.status}`,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : "Sync failed";
      console.error(
        `[keys/sync] async sync failed for strategy=${strategy_id}:`,
        err,
      );
      try {
        await admin
          .from("strategy_analytics")
          .upsert(
            {
              strategy_id,
              computation_status: "failed",
              computation_error: message,
            },
            { onConflict: "strategy_id" },
          );
      } catch (updateErr) {
        console.error(
          `[keys/sync] failed to write failed-status row for strategy=${strategy_id}:`,
          updateErr,
        );
      }
    }
  });

  return NextResponse.json(
    {
      accepted: true,
      strategy_id,
      status: "syncing",
    },
    { status: 202 },
  );
});
