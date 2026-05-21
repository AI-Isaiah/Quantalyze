import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { safeCompare } from "@/lib/timing-safe-compare";
import { SUPPORTED_EXCHANGES } from "@/lib/utils";
import { getCorrelationId } from "@/lib/correlation-id";

/**
 * Vercel Cron — every 4 hours, enqueue a `sync_funding` compute_job for
 * every strategy whose connected API key is on a perp-supporting exchange
 * (binance/okx/bybit). The Python worker does the actual fetch +
 * UPSERT into funding_fees.
 *
 * Auth: Bearer ${CRON_SECRET} — same pattern as alert-digest + the
 * analytics warmup cron. Vercel Cron dispatches GET; manual POST also
 * works for incident response.
 *
 * Schedule + secret: see `vercel.json`.
 */

export const dynamic = "force-dynamic";

// Exchanges where perpetual funding applies and our analytics worker has a
// funding_fetch normalizer. Sourced from src/lib/utils.ts SUPPORTED_EXCHANGES
// (mirrors analytics-service/services/exchange.py EXCHANGE_CLASSES).
const PERP_EXCHANGES = new Set(SUPPORTED_EXCHANGES);

async function handle(req: NextRequest): Promise<NextResponse> {
  const auth = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${process.env.CRON_SECRET}`;
  if (!process.env.CRON_SECRET || !safeCompare(auth, expected)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();

  // Find every strategy with a connected api_key on a perp-supporting
  // exchange. We pre-filter in SQL (api_keys.is_active + exchange IN
  // (...)) so the per-row enqueue loop stays small.
  const { data: strategies, error: fetchError } = await admin
    .from("strategies")
    .select("id, api_keys!inner(exchange, is_active)")
    .eq("api_keys.is_active", true)
    .in("api_keys.exchange", Array.from(PERP_EXCHANGES));

  if (fetchError) {
    console.error("[cron/sync-funding] strategy fetch failed:", fetchError);
    return NextResponse.json(
      { error: fetchError.message },
      { status: 500 },
    );
  }

  const rows = strategies ?? [];
  if (rows.length === 0) {
    return NextResponse.json({ enqueued: 0, skipped: 0 });
  }

  // Phase 18 forensic thread (Day-2 Bug #1 follow-up): Vercel Cron requests
  // don't carry an inbound x-correlation-id, so getCorrelationId() falls back
  // to a fresh UUID. One id per cron tick joins all enqueued jobs to the
  // same batch in compute_jobs.metadata->>'correlation_id'.
  const correlation_id = await getCorrelationId();

  // @audit-skip: scheduled cron tick with no acting user. Enqueuing
  // sync_funding compute jobs is platform-internal maintenance, not a
  // user-attributable action. Vercel Cron requests don't carry a JWT
  // and an audit row with NULL acting_user would be meaningless. The
  // downstream worker emits per-strategy events with platform
  // service-role attribution.
  const results = await Promise.allSettled(
    rows.map((row) =>
      admin.rpc("enqueue_compute_job", {
        p_strategy_id: row.id,
        p_kind: "sync_funding",
        p_metadata: { correlation_id },
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
      console.error(`[cron/sync-funding] enqueue failed for strategy=${row.id}:`, result.reason);
    } else if (result.value.error) {
      failed += 1;
      errors.push(`${row.id}: ${result.value.error.message}`);
      console.error(`[cron/sync-funding] enqueue failed for strategy=${row.id}:`, result.value.error);
    } else if (result.value.data) {
      enqueued += 1;
    }
  }

  // G14-005: fail loud when the cron tick enqueued zero of N candidates.
  // A 200 here masks platform-wide outages from Vercel cron alerting and
  // the run looks "successful" until allocators notice missing funding rows.
  const allFailed = rows.length > 0 && enqueued === 0;
  return NextResponse.json(
    {
      enqueued,
      failed,
      total_candidates: rows.length,
      ...(errors.length > 0 ? { errors: errors.slice(0, 5) } : {}),
    },
    { status: allFailed ? 500 : 200 },
  );
}

export const GET = handle;
export const POST = handle;
