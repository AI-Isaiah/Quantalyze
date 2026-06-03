import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { safeCompare } from "@/lib/timing-safe-compare";
import { SUPPORTED_EXCHANGES } from "@/lib/utils";
import { getCorrelationId } from "@/lib/correlation-id";

/**
 * Vercel Cron — daily (04:00 UTC), enqueue a `sync_funding` compute_job for
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

/**
 * Stable response envelope. Every non-auth exit path returns this same flat
 * shape (M-0913/M-0915): the empty-rows, happy, and all-failed paths all carry
 * `enqueued`/`failed`/`total_candidates`, so cron-monitoring consumers parse
 * one schema. `error` (a stable code, never a raw DB message — M-0916) is
 * present only on the auth/fetch-failure paths.
 */
export type SyncFundingResponse =
  | { error: string }
  | {
      enqueued: number;
      failed: number;
      total_candidates: number;
      errors?: string[];
      errors_total?: number;
    };

// Exchanges where perpetual funding applies and our analytics worker has a
// funding_fetch normalizer. Sourced from src/lib/utils.ts SUPPORTED_EXCHANGES
// (mirrors analytics-service/services/exchange.py EXCHANGE_CLASSES).
const PERP_EXCHANGES = new Set(SUPPORTED_EXCHANGES);

async function handle(req: NextRequest): Promise<NextResponse<SyncFundingResponse>> {
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
    // M-0916: keep the raw PostgREST message (schema/column/constraint names)
    // in the log only — return a stable code so a leaked envelope can't be
    // used to map the DB surface.
    console.error("[cron/sync-funding] strategy fetch failed:", fetchError);
    return NextResponse.json(
      { error: "strategy_fetch_failed" },
      { status: 500 },
    );
  }

  const rows = strategies ?? [];
  if (rows.length === 0) {
    // M-0913/M-0915: same flat envelope as the populated path (the orphan
    // `skipped` field is dropped — nothing is ever "skipped" in this route).
    return NextResponse.json({ enqueued: 0, failed: 0, total_candidates: 0 });
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
      // A thrown rejection is a JS Error (e.g. a network blip) — its message
      // does not carry PostgREST schema/column internals, so we keep it in the
      // response for incident response (see H-1090 regression test).
      const msg = result.reason instanceof Error ? result.reason.message : String(result.reason);
      errors.push(`${row.id}: ${msg}`);
      console.error(`[cron/sync-funding] enqueue failed for strategy=${row.id}:`, result.reason);
    } else if (result.value.error) {
      failed += 1;
      // M-0916: a RESOLVED RPC error can echo PG/RPC internals (table/column/
      // constraint names) — keep the raw message in the log only and surface a
      // stable, UUID-tagged code in the response.
      errors.push(`${row.id}: enqueue_failed`);
      console.error(`[cron/sync-funding] enqueue failed for strategy=${row.id}:`, result.value.error);
    } else if (result.value.data) {
      enqueued += 1;
    } else {
      // H-1091: the RPC resolved with neither data nor error
      // (`{data: null, error: null}` — e.g. enqueue_compute_job was replaced
      // by a void-returning shim). Counting this as "enqueued" or dropping it
      // would let total_candidates !== enqueued + failed be the only signal.
      // Count it as a failure and log loudly so it's never invisible.
      failed += 1;
      errors.push(`${row.id}: enqueue_returned_null`);
      console.error(
        `[cron/sync-funding] enqueue returned null data with no error for strategy=${row.id}`,
      );
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
      // L-0050: `errors` is capped at 5 for log size; `errors_total` lets a
      // consumer detect truncation (errors_total > errors.length) without
      // re-reading worker logs.
      ...(errors.length > 0
        ? { errors: errors.slice(0, 5), errors_total: errors.length }
        : {}),
    },
    { status: allFailed ? 500 : 200 },
  );
}

export const GET = handle;
export const POST = handle;
