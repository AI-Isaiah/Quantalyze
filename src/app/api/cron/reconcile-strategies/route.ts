import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { safeCompare } from "@/lib/timing-safe-compare";
import { SUPPORTED_EXCHANGES } from "@/lib/utils";

/**
 * Vercel Cron — nightly (03:30 UTC), enqueue a `reconcile_strategy`
 * compute_job for every strategy whose connected API key synced within
 * the past 24 hours. The Python worker (run_reconcile_strategy_job)
 * does the two-sided fetch (exchange live fills vs DB trades), calls
 * services.reconciliation.diff_strategy_fills, upserts into
 * reconciliation_reports, and inserts a `sync_failure` portfolio_alerts
 * row when the diff is non-clean.
 *
 * Auth: Authorization: Bearer ${CRON_SECRET} — same pattern as
 * sync-funding + alert-digest. Vercel Cron dispatches GET; manual POST
 * also works for incident response.
 *
 * Schedule: "30 3 * * *" (03:30 UTC) — positioned to avoid:
 *   - 09:00 UTC alert-digest
 *   - 00:00 UTC warm-analytics (midnight)
 *   - sync-funding's 4-hour cadence (runs at 00/04/08/12/16/20, so 03:30
 *     gives ~30 min clearance from the 04:00 tick)
 *
 * See `vercel.json` crons array and migration 046.
 */

export const dynamic = "force-dynamic";

// Only strategies on exchanges we can actually reconcile against (the
// Python handler uses ccxt fetch_my_trades, which is available for all
// three supported exchanges). Avoids enqueuing jobs that would fail
// permanent at the worker's "exchange not supported" check.
const RECONCILABLE_EXCHANGES = new Set(SUPPORTED_EXCHANGES);

async function handle(req: NextRequest): Promise<NextResponse> {
  const auth = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${process.env.CRON_SECRET}`;
  if (!process.env.CRON_SECRET || !safeCompare(auth, expected)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();

  // Candidate strategies: connected, active API key, on a reconcilable
  // exchange, synced at least once in the past 24h. The last_sync_at
  // cutoff keeps the nightly batch tight — strategies idle for >1 day
  // have nothing fresh to reconcile and would waste an exchange call.
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const { data: strategies, error: fetchError } = await admin
    .from("strategies")
    .select("id, api_keys!inner(exchange, is_active, last_sync_at)")
    .eq("api_keys.is_active", true)
    .in("api_keys.exchange", Array.from(RECONCILABLE_EXCHANGES))
    .gt("api_keys.last_sync_at", cutoff);

  if (fetchError) {
    console.error("[cron/reconcile-strategies] strategy fetch failed:", fetchError);
    return NextResponse.json(
      { error: fetchError.message },
      { status: 500 },
    );
  }

  const rows = strategies ?? [];
  if (rows.length === 0) {
    return NextResponse.json({ enqueued: 0, skipped: 0 });
  }

  const results = await Promise.allSettled(
    rows.map((row) =>
      admin.rpc("enqueue_compute_job", {
        p_strategy_id: row.id,
        p_kind: "reconcile_strategy",
      }),
    ),
  );

  let enqueued = 0;
  let failed = 0;
  const errors: string[] = [];

  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    const row = rows[i];
    if (result.status === "rejected") {
      failed += 1;
      const msg = result.reason instanceof Error ? result.reason.message : String(result.reason);
      errors.push(`${row.id}: ${msg}`);
      console.error(
        `[cron/reconcile-strategies] enqueue failed for strategy=${row.id}:`,
        result.reason,
      );
    } else if (result.value.error) {
      failed += 1;
      errors.push(`${row.id}: ${result.value.error.message}`);
      console.error(
        `[cron/reconcile-strategies] enqueue failed for strategy=${row.id}:`,
        result.value.error,
      );
    } else if (result.value.data) {
      enqueued += 1;
    }
  }

  // If every enqueue failed, the cron run produced zero useful work —
  // surface that as a 500 so monitoring catches the regression instead
  // of treating an all-failed batch as a successful empty run.
  const status = enqueued === 0 && failed > 0 ? 500 : 200;
  return NextResponse.json(
    {
      enqueued,
      failed,
      total_candidates: rows.length,
      ...(errors.length > 0 ? { errors: errors.slice(0, 5) } : {}),
    },
    { status },
  );
}

export const GET = handle;
export const POST = handle;
