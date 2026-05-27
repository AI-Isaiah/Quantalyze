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

// Sentry organizations are region-locked since the 2023 EU launch — an
// EU-region org (`region_url: https://de.sentry.io` in the auth-token JWT)
// silently returns `{ "data": [] }` (HTTP 200) from the global `sentry.io`
// host. The empty-data response masquerades as "no events", causing the
// soak gate to record 0/0 false-clean rows. Make the base host explicit
// via env so EU orgs override; default to global for back-compat with
// US-region orgs.
const SENTRY_BASE =
  process.env.SENTRY_API_BASE ?? "https://sentry.io/api/0/organizations";
const KILL_SWITCH_KEY = "process_key_unified_backbone";

/** Resilient parse for Sentry events API response. Returns a discriminated
 *  union so callers MUST handle shape failure — silent coercion to 0 would
 *  let a malformed Sentry response (incident HTML, schema rotation #3, token
 *  downgrade) silently report error_rate=0 and falsely satisfy the soak gate. */
type SentryParseResult =
  | { kind: "ok"; count: number }
  | { kind: "missing_data" };

function parseSentryCount(payload: unknown): SentryParseResult {
  if (!payload || typeof payload !== "object" || !("data" in payload)) {
    return { kind: "missing_data" };
  }
  const data = (payload as { data: unknown }).data;
  if (!Array.isArray(data)) {
    return { kind: "missing_data" };
  }
  // Empty array means "no events in window" — legitimate zero, not a parse error.
  if (data.length === 0) return { kind: "ok", count: 0 };
  const row = data[0] as Record<string, unknown> | null | undefined;
  if (!row || typeof row !== "object") return { kind: "missing_data" };
  // Sentry has rotated this twice — accept both `data[0]["count()"]` and
  // `data[0].count`. Any non-finite / negative number is a shape problem.
  const v = row["count()"] ?? row.count;
  if (typeof v !== "number" || !Number.isFinite(v) || v < 0) {
    return { kind: "missing_data" };
  }
  return { kind: "ok", count: v };
}

/** Sentry events API window — either relative (statsPeriod=Nh, anchored to
 *  now) or absolute (start/end ISO). Used by both the live and backfill paths. */
type SentryWindow =
  | { kind: "period"; hours: number }
  | { kind: "range"; start: Date; end: Date };

/** Result discriminator: callers must short-circuit on every non-ok variant
 *  via mapSentryResultToResponse() so HTTP status + reason envelope are
 *  consistent across live and backfill paths. */
type SentryFetchResult =
  | { kind: "ok"; count: number }
  | { kind: "rate_limited"; status: number; retryAfter: string | null }
  | { kind: "unreachable"; reason: "fetch_failed" | "non_2xx"; status?: number }
  | { kind: "unparseable"; status: number; sample: string };

async function fetchSentryCount(args: {
  orgSlug: string;
  sentryToken: string;
  query: string;
  window: SentryWindow;
}): Promise<SentryFetchResult> {
  const params = new URLSearchParams({ query: args.query, field: "count()" });
  if (args.window.kind === "period") {
    params.set("statsPeriod", `${args.window.hours}h`);
  } else {
    params.set("start", args.window.start.toISOString());
    params.set("end", args.window.end.toISOString());
  }
  const url = `${SENTRY_BASE}/${args.orgSlug}/events/?${params}`;

  let res: Response;
  try {
    res = await fetch(url, {
      headers: { Authorization: `Bearer ${args.sentryToken}` },
      cache: "no-store",
    });
  } catch (err) {
    console.error("[cron/phase19-error-rollup] sentry fetch threw:", err);
    return { kind: "unreachable", reason: "fetch_failed" };
  }

  if (!res.ok) {
    const retryAfter = res.headers.get("retry-after");
    const isRateLimited =
      res.status === 429 ||
      retryAfter !== null ||
      res.headers.get("x-sentry-rate-limit-remaining") !== null;
    if (isRateLimited) {
      return { kind: "rate_limited", status: res.status, retryAfter };
    }
    return { kind: "unreachable", reason: "non_2xx", status: res.status };
  }

  let payload: unknown;
  try {
    payload = await res.json();
  } catch (err) {
    const sample = await res.clone().text().catch(() => "");
    console.error(
      "[cron/phase19-error-rollup] sentry response not JSON:",
      err,
      { status: res.status, contentType: res.headers.get("content-type") },
    );
    return { kind: "unparseable", status: res.status, sample: sample.slice(0, 200) };
  }

  const parsed = parseSentryCount(payload);
  if (parsed.kind === "missing_data") {
    console.error(
      "[cron/phase19-error-rollup] sentry shape unexpected:",
      JSON.stringify(payload).slice(0, 500),
    );
    return {
      kind: "unparseable",
      status: res.status,
      sample: JSON.stringify(payload).slice(0, 200),
    };
  }
  return { kind: "ok", count: parsed.count };
}

/** Map a non-ok SentryFetchResult to a NextResponse with the correct HTTP
 *  status so Vercel Cron monitoring can alert on non-2xx. The previous
 *  blanket-200 envelope hid Sentry outages until the post-168h gate ran. */
function mapSentryResultToResponse(
  result: Exclude<SentryFetchResult, { kind: "ok" }>,
): NextResponse {
  switch (result.kind) {
    case "rate_limited":
      return NextResponse.json(
        {
          ok: false,
          reason: "sentry_rate_limited",
          status: result.status,
          ...(result.retryAfter ? { retry_after: result.retryAfter } : {}),
        },
        { status: 429 },
      );
    case "unreachable":
      return NextResponse.json(
        {
          ok: false,
          reason: "sentry_unreachable",
          ...(result.status ? { status: result.status } : {}),
        },
        { status: 502 },
      );
    case "unparseable":
      return NextResponse.json(
        {
          ok: false,
          reason: "sentry_unparseable",
          status: result.status,
          sample: result.sample,
        },
        { status: 502 },
      );
  }
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
    // Production config drift — return 500 so Vercel Cron alerts fire on
    // non-2xx. console.warn alone goes nowhere visible.
    console.error(
      "[cron/phase19-error-rollup] SENTRY_ORG_SLUG or SENTRY_AUTH_TOKEN missing — soak rollup will record nothing until restored",
    );
    return NextResponse.json(
      { ok: false, reason: "sentry_not_configured" },
      { status: 500 },
    );
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
    // soak_not_started AND soak_rolled_back are both "skip" cases that the
    // operator expects daily — keep them at 200 so they don't page. The bash
    // gate's exit-7 branch catches the rolled-back case explicitly.
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

  // 4) day_index — floor((windowStart - flipDate) / 24h) + 1.
  //    Day 1 = the calendar day on which the flip occurred (flipDate's UTC).
  //    Fail loud on out-of-bounds — the previous silent Math.max/min clamp
  //    masked window_pre_flip-by-half and post-soak backfills. Both deserve
  //    explicit operator signal.
  const flipDate = new Date(flipTs);
  flipDate.setUTCHours(0, 0, 0, 0);
  const dayIndexRaw =
    Math.floor((windowStart.getTime() - flipDate.getTime()) / (24 * 60 * 60 * 1000)) + 1;
  if (dayIndexRaw < 1) {
    return NextResponse.json({
      ok: false,
      reason: "window_pre_flip",
      day_index_raw: dayIndexRaw,
      flip_date: flipDate.toISOString().slice(0, 10),
      window_start: windowStart.toISOString().slice(0, 10),
    });
  }
  if (dayIndexRaw > 14) {
    return NextResponse.json({
      ok: false,
      reason: "window_post_soak",
      day_index_raw: dayIndexRaw,
      flip_date: flipDate.toISOString().slice(0, 10),
      window_start: windowStart.toISOString().slice(0, 10),
    });
  }
  const dayIndex = dayIndexRaw;

  // 5) Sentry numerator + denominator over the same 24h window. Live path
  //    uses statsPeriod=24h (anchored to now, drift ≤cron-interval) while
  //    backfill uses explicit start/end. Both flow through fetchSentryCount
  //    so the error envelope (rate_limited / unreachable / unparseable) is
  //    consistent across paths. If windowStart straddles the flip (backfill
  //    for the flip-day itself), clamp the Sentry start to flipTs so the
  //    measurement excludes pre-flip traffic.
  const queryNum = `level:error path:/api/process-key environment:production`;
  const queryDen = `path:/api/process-key environment:production`;

  const isBackfill = dateParam !== null;
  const window: SentryWindow = isBackfill
    ? {
        kind: "range",
        start: windowStart.getTime() < flipTs.getTime() ? flipTs : windowStart,
        end: windowEnd,
      }
    : { kind: "period", hours: 24 };

  const num = await fetchSentryCount({ orgSlug, sentryToken, query: queryNum, window });
  if (num.kind !== "ok") return mapSentryResultToResponse(num);
  const errorCount = num.count;

  const den = await fetchSentryCount({ orgSlug, sentryToken, query: queryDen, window });
  if (den.kind !== "ok") return mapSentryResultToResponse(den);
  const totalCount = den.count;

  // 6) Compute error rate. Guard divide-by-zero — when total is 0 the rate
  //    is 0 and the day is recorded with a note so the gate reviewer can
  //    distinguish "no traffic" from "traffic was clean".
  const errorRate = totalCount > 0 ? errorCount / totalCount : 0;
  const notes =
    totalCount === 0
      ? `no /process-key traffic in window ${windowStart.toISOString()}..${windowEnd.toISOString()}`
      : null;

  // 7) Upsert via SECDEF RPC. Admin client = service_role JWT, so the
  //    RPC's auth.role() check passes.
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
