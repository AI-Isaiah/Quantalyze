/**
 * Phase 19 / BACKBONE-04 — daily Sentry error-rate rollup cron.
 *
 * Runs once per day (vercel.json schedule 30 0 * * *) during the 168h soak
 * window. Queries Sentry events API for /api/process-key error envelopes
 * over the prior 24h, computes the error rate, and upserts the daily row
 * into public.phase19_soak_daily via the phase19_soak_record_day RPC.
 *
 * Replaces the YYYY-MM-DD placeholder rows in stability-log.md with real
 * measured data. The phase-19-stability.yml workflow's exit-criteria check
 * reads phase19_soak_daily via phase19_soak_status(p_since) so the gate
 * has 7 days of evidence rather than scaffolding by ship time.
 *
 * Computes day_index from feature_flags.updated_at on the
 * `process_key_unified_backbone` row — that timestamp IS the flag_flipped_at
 * value (verified 2026-05-25). No env var or file-read needed.
 *
 * Backfill: ?date=YYYY-MM-DD ?since=ISO can backfill a specific day. The
 * underlying Sentry events API retains events well beyond 24h so days 1-2
 * can be retro-filled after deploy.
 *
 * Mirrors src/app/api/cron/flag-monitor/route.ts auth + Sentry-fetch
 * resilience (rate-limit / unreachable / shape-rotation handling).
 */
import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { safeCompare } from "@/lib/timing-safe-compare";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const SENTRY_BASE = "https://sentry.io/api/0/organizations";
const KILL_SWITCH_KEY = "process_key_unified_backbone";

/** Resilient parse for Sentry events API response. Same shape probe as
 *  flag-monitor route — Sentry has rotated this twice, so accept both
 *  `data[0]["count()"]` and `data[0].count`. */
function parseSentryCount(payload: unknown): number {
  const data =
    payload && typeof payload === "object" && "data" in payload
      ? (payload as { data: unknown }).data
      : null;
  if (!Array.isArray(data) || data.length === 0) return 0;
  const row = data[0] as Record<string, unknown>;
  const v = row?.["count()"] ?? row?.count ?? 0;
  return typeof v === "number" ? v : 0;
}

type SentryCountResult =
  | { kind: "ok"; count: number }
  | { kind: "terminal"; res: NextResponse };

async function fetchSentryCount(args: {
  orgSlug: string;
  sentryToken: string;
  query: string;
  statsPeriodHours: number;
}): Promise<SentryCountResult> {
  const params = new URLSearchParams({
    statsPeriod: `${args.statsPeriodHours}h`,
    query: args.query,
    field: "count()",
  });
  const url = `${SENTRY_BASE}/${args.orgSlug}/events/?${params}`;

  let res: Response;
  try {
    res = await fetch(url, {
      headers: { Authorization: `Bearer ${args.sentryToken}` },
      cache: "no-store",
    });
  } catch (err) {
    console.warn("[cron/phase19-error-rollup] sentry fetch threw:", err);
    return {
      kind: "terminal",
      res: NextResponse.json({ ok: false, reason: "sentry_unreachable" }),
    };
  }

  if (!res.ok) {
    const retryAfter = res.headers.get("retry-after");
    const isRateLimited =
      res.status === 429 ||
      retryAfter !== null ||
      res.headers.get("x-sentry-rate-limit-remaining") !== null;
    return {
      kind: "terminal",
      res: NextResponse.json({
        ok: false,
        reason: isRateLimited ? "sentry_rate_limited" : "sentry_unreachable",
        status: res.status,
        ...(retryAfter ? { retry_after: retryAfter } : {}),
      }),
    };
  }

  const payload = await res.json().catch(() => ({}));
  return { kind: "ok", count: parseSentryCount(payload) };
}

async function handle(req: NextRequest): Promise<NextResponse> {
  const auth = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${process.env.CRON_SECRET}`;
  if (!process.env.CRON_SECRET || !safeCompare(auth, expected)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const orgSlug = process.env.SENTRY_ORG_SLUG;
  const sentryToken = process.env.SENTRY_AUTH_TOKEN;
  if (!orgSlug || !sentryToken) {
    console.warn(
      "[cron/phase19-error-rollup] SENTRY_ORG_SLUG or SENTRY_AUTH_TOKEN missing — skipping",
    );
    return NextResponse.json({ ok: false, reason: "sentry_not_configured" });
  }

  const admin = createAdminClient();

  // 1) Resolve flag_flipped_at from the feature_flags row. updated_at is the
  //    canonical flip timestamp (matches the value recorded in
  //    .planning/phase-19/stability-log.md by the chore/phase-19-flag-flipped-at
  //    commit). Bail out if the soak hasn't started — there is nothing to
  //    record.
  const { data: flagRow, error: flagErr } = await admin
    .from("feature_flags")
    .select("value, updated_at")
    .eq("flag_key", KILL_SWITCH_KEY)
    .maybeSingle();
  if (flagErr) {
    console.error("[cron/phase19-error-rollup] feature_flags read failed:", flagErr);
    return NextResponse.json(
      { ok: false, reason: "feature_flags_unreachable", error: String(flagErr) },
      { status: 500 },
    );
  }
  if (!flagRow || flagRow.value !== "on" || !flagRow.updated_at) {
    return NextResponse.json({
      ok: false,
      reason: "soak_not_started",
      flag_value: flagRow?.value ?? "unset",
    });
  }
  const flipTs = new Date(flagRow.updated_at);

  // 2) Determine the target date — default to "yesterday UTC" (most recent
  //    complete 24h window). Backfill: ?date=YYYY-MM-DD overrides.
  const url = new URL(req.url);
  const dateParam = url.searchParams.get("date");
  let dateUtc: Date;
  if (dateParam) {
    const parsed = new Date(`${dateParam}T00:00:00Z`);
    if (Number.isNaN(parsed.getTime())) {
      return NextResponse.json(
        { ok: false, reason: "bad_date_param", date: dateParam },
        { status: 400 },
      );
    }
    dateUtc = parsed;
  } else {
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    dateUtc = new Date(today.getTime() - 24 * 60 * 60 * 1000);
  }
  const windowStart = dateUtc;
  const windowEnd = new Date(windowStart.getTime() + 24 * 60 * 60 * 1000);

  // 3) Reject windows entirely before the flip (would record vacuous 0/0).
  if (windowEnd <= flipTs) {
    return NextResponse.json({
      ok: false,
      reason: "window_pre_flip",
      flip_ts: flipTs.toISOString(),
      window_end: windowEnd.toISOString(),
    });
  }

  // 4) day_index — ceil((windowStart - flipDate) / 24h) + 1, clamped to [1, 14].
  //    Day 1 = first 24h after the flip.
  const flipDate = new Date(flipTs);
  flipDate.setUTCHours(0, 0, 0, 0);
  const dayIndexRaw =
    Math.floor((windowStart.getTime() - flipDate.getTime()) / (24 * 60 * 60 * 1000)) + 1;
  const dayIndex = Math.max(1, Math.min(14, dayIndexRaw));

  // 5) Sentry numerator + denominator over the same 24h window. statsPeriod
  //    is "X hours back from now" so we compute hours-from-now for the
  //    window end (today UTC) and treat that as a 24h reference window.
  //    For backfills, this counts the prior 24h from "now" — acceptable
  //    since the cron runs daily at 00:30 UTC; a one-day-old backfill
  //    queries a 48h-ago window which Sentry retains.
  //
  //    Note: Sentry's events API doesn't expose arbitrary start/end via the
  //    same `statsPeriod` shape; for backfill use `start`/`end` ISO params.
  //    Implemented below — both code paths converge on a `query` string +
  //    a count from the JSON response.
  const queryNum = `level:error path:/api/process-key environment:production`;
  const queryDen = `path:/api/process-key environment:production`;

  // For "yesterday" run (no date param), use statsPeriod=24h shorthand which
  // anchors to "now" — yields the prior 24h. For backfills, use explicit
  // start/end timestamps.
  const isBackfill = dateParam !== null;
  let errorCount: number;
  let totalCount: number;

  if (!isBackfill) {
    const num = await fetchSentryCount({
      orgSlug,
      sentryToken,
      query: queryNum,
      statsPeriodHours: 24,
    });
    if (num.kind === "terminal") return num.res;
    errorCount = num.count;

    const den = await fetchSentryCount({
      orgSlug,
      sentryToken,
      query: queryDen,
      statsPeriodHours: 24,
    });
    if (den.kind === "terminal") return den.res;
    totalCount = den.count;
  } else {
    // Backfill path — explicit start/end timestamps.
    const params = (q: string) =>
      new URLSearchParams({
        start: windowStart.toISOString(),
        end: windowEnd.toISOString(),
        query: q,
        field: "count()",
      });
    const num = await (async (): Promise<number> => {
      const res = await fetch(`${SENTRY_BASE}/${orgSlug}/events/?${params(queryNum)}`, {
        headers: { Authorization: `Bearer ${sentryToken}` },
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`sentry numerator ${res.status}`);
      return parseSentryCount(await res.json());
    })();
    const den = await (async (): Promise<number> => {
      const res = await fetch(`${SENTRY_BASE}/${orgSlug}/events/?${params(queryDen)}`, {
        headers: { Authorization: `Bearer ${sentryToken}` },
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`sentry denominator ${res.status}`);
      return parseSentryCount(await res.json());
    })();
    errorCount = num;
    totalCount = den;
  }

  // 6) Compute error rate. Guard divide-by-zero — when total is 0 the rate
  //    is 0 and the day is recorded with a note so the gate reviewer can
  //    distinguish "no traffic" from "traffic was clean".
  const errorRate = totalCount > 0 ? errorCount / totalCount : 0;
  const notes =
    totalCount === 0
      ? `no /process-key traffic in window ${windowStart.toISOString()}..${windowEnd.toISOString()}`
      : null;

  // 7) Upsert via SECDEF RPC. Admin client = service_role JWT, so the
  //    RPC's current_user check passes.
  const { data: rpcResult, error: rpcErr } = await admin.rpc(
    "phase19_soak_record_day",
    {
      p_date_utc: windowStart.toISOString().slice(0, 10),
      p_day_index: dayIndex,
      p_error_rate: Number(errorRate.toFixed(5)),
      p_total_events: totalCount,
      p_error_events: errorCount,
      p_notes: notes,
    },
  );
  if (rpcErr) {
    console.error("[cron/phase19-error-rollup] record RPC failed:", rpcErr);
    return NextResponse.json(
      { ok: false, reason: "rpc_failed", error: String(rpcErr) },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    date_utc: windowStart.toISOString().slice(0, 10),
    day_index: dayIndex,
    error_rate: Number(errorRate.toFixed(5)),
    total_events: totalCount,
    error_events: errorCount,
    notes,
    rpc: rpcResult,
  });
}

export const GET = handle;
export const POST = handle;
