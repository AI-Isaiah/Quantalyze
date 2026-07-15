/**
 * Phase 19 / BACKBONE-05 — error-rate monitor cron (ALERT-ONLY since Phase 106).
 *
 * Polls Sentry events API every 15 minutes for /api/process-key error events.
 * Computes error envelope rate (errors / total /process-key calls in same
 * tumbling window). Threshold: errorRate > 0.5% with total >= 20 → sends a
 * Resend [ALERT] email to the founder. Sub-threshold (errorRate > 0.25%) sends
 * a WARN email.
 *
 * Phase 106 (Stage B) RETIRED the auto-rollback. The unified backbone is now
 * the only path — the feature_flags kill-switch row (`process_key_unified_backbone`)
 * has zero readers and is inert. This cron NEVER writes it: flipping it would be
 * an outage, not a rollback. Post-Stage-B rollback is `git revert + redeploy`
 * (see the PR body). This monitor is purely an error-rate alerter now.
 *
 * Sentry events API shape verified by scripts/probe-sentry-events-api.sh
 * BEFORE deploy (Assumption A1). The handler parses BOTH `data[0]["count()"]`
 * and `data[0].count` for resilience to a third shape rotation.
 *
 * Pitfall 8: the outbound Sentry query MUST include `environment:production`
 * to prevent dev/preview events (e.g. CI cassette runs) from firing spurious
 * production alerts. The src/instrumentation.ts + analytics-service/
 * sentry_init.py inits both stamp environment from VERCEL_ENV — see
 * tests/integration/sentry-environment.test.ts (H-6).
 *
 * H-2: when audit_log denominator is 0 for >2 consecutive 15-min windows,
 * the cron is a silent no-op. Streak counter in feature_flags row
 * `flag_monitor_zero_denominator_streak` (a DIFFERENT row from the retired
 * kill-switch) triggers a SEV-2 alert email on the 3rd zero window.
 */
import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { safeCompare } from "@/lib/timing-safe-compare";
import { Resend } from "resend";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Sentry organizations are region-locked since the 2023 EU launch — an
// EU-region org (`region_url: https://de.sentry.io` in the auth-token JWT)
// silently returns `{ "data": [] }` (HTTP 200) from the global `sentry.io`
// host. The empty-data response masquerades as "0 errors", causing the
// auto-rollback path to never trip (`errorCount / audit_log_denominator = 0%`
// always). Make the base host explicit via env so EU orgs override; default
// to global for back-compat with US-region orgs.
const SENTRY_BASE =
  process.env.SENTRY_API_BASE ?? "https://sentry.io/api/0/organizations";

const ALERT_THRESHOLD = 0.005; // 0.5% error envelope rate
const WARN_THRESHOLD = 0.0025; // 0.25%
const MIN_SAMPLE = 20;
const ZERO_DENOMINATOR_ALERT_AFTER = 2; // alert when streak exceeds this (i.e. >=3)

const ZERO_DENOM_STREAK_KEY = "flag_monitor_zero_denominator_streak";

// M-7: alert From: header. Hoisted near other constants so a domain-rename
// (e.g. quantalyze.com → quantalyze.app) is a one-line config edit, not a
// scatter through three hard-coded literals.
const ALERT_FROM =
  process.env.RESEND_ALERT_FROM ?? "Quantalyze <alerts@quantalyze.com>";

/** Resilient parse for Sentry events API response. Probe-verified shape is
 *  `data[0]["count()"]` but Sentry has rotated this twice — also accept
 *  `data[0].count` as a fallback. Anything else returns 0 (cron will report
 *  "ok" with 0 errors; safe default — better than throwing). */
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

/**
 * M-19 helpers — extracted from `handle()` so each step is independently
 * readable. Behavior is preserved: each helper returns either a NextResponse
 * (terminal — caller returns immediately) or a numeric/structured result the
 * caller folds into the next step. Tests assert on the same JSON envelopes.
 */

type SentryFetchResult =
  | { kind: "ok"; errorCount: number }
  | { kind: "terminal"; res: NextResponse };

async function getNumerator(args: {
  orgSlug: string;
  sentryToken: string;
}): Promise<SentryFetchResult> {
  const params = new URLSearchParams({
    statsPeriod: "15m",
    query:
      "level:error path:/api/process-key correlation_id:* environment:production",
    field: "count()",
  });
  const sentryUrl = `${SENTRY_BASE}/${args.orgSlug}/events/?${params}`;

  let sentryRes: Response;
  try {
    sentryRes = await fetch(sentryUrl, {
      headers: { Authorization: `Bearer ${args.sentryToken}` },
      cache: "no-store",
    });
  } catch (err) {
    console.warn("[cron/flag-monitor] sentry fetch threw:", err);
    return {
      kind: "terminal",
      res: NextResponse.json({ ok: false, reason: "sentry_unreachable" }),
    };
  }

  if (!sentryRes.ok) {
    // I-perf-cron: distinguish rate-limiting from outage.
    const retryAfter = sentryRes.headers.get("retry-after");
    const sentryRateLimitRemaining = sentryRes.headers.get(
      "x-sentry-rate-limit-remaining",
    );
    const sentryRateLimitReset = sentryRes.headers.get(
      "x-sentry-rate-limit-reset",
    );
    const sentryRateLimitConcurrentRemaining = sentryRes.headers.get(
      "x-sentry-rate-limit-concurrent-remaining",
    );
    const isRateLimited =
      sentryRes.status === 429 ||
      retryAfter !== null ||
      sentryRateLimitRemaining !== null ||
      sentryRateLimitConcurrentRemaining !== null;
    const reason = isRateLimited ? "sentry_rate_limited" : "sentry_unreachable";
    console.warn(
      `[cron/flag-monitor] sentry status=${sentryRes.status} reason=${reason}`,
    );
    return {
      kind: "terminal",
      res: NextResponse.json({
        ok: false,
        reason,
        status: sentryRes.status,
        ...(retryAfter ? { retry_after: retryAfter } : {}),
        ...(sentryRateLimitRemaining
          ? { rate_limit_remaining: sentryRateLimitRemaining }
          : {}),
        ...(sentryRateLimitReset
          ? { rate_limit_reset: sentryRateLimitReset }
          : {}),
      }),
    };
  }

  const sentryData = await sentryRes.json().catch(() => ({}));
  return { kind: "ok", errorCount: parseSentryCount(sentryData) };
}

async function getDenominator(args: {
  admin: ReturnType<typeof createAdminClient>;
  windowStart: Date;
}): Promise<number> {
  const { count: totalCount } = await args.admin
    .from("audit_log")
    .select("id", { count: "exact", head: true })
    .eq("entity_type", "process_key")
    .gte("created_at", args.windowStart.toISOString());
  return totalCount ?? 0;
}

async function handleZeroDenominator(args: {
  admin: ReturnType<typeof createAdminClient>;
  now: Date;
  resend: Resend | null;
  founderEmail: string | undefined;
}): Promise<NextResponse> {
  const { data: flagRow } = await args.admin
    .from("feature_flags")
    .select("value")
    .eq("flag_key", ZERO_DENOM_STREAK_KEY)
    .maybeSingle();
  const currentStreak = parseInt(flagRow?.value ?? "0", 10) || 0;
  const newStreak = currentStreak + 1;
  await args.admin.from("feature_flags").upsert(
    {
      flag_key: ZERO_DENOM_STREAK_KEY,
      value: String(newStreak),
      updated_at: args.now.toISOString(),
      updated_by: "cron/flag-monitor",
    },
    { onConflict: "flag_key" },
  );
  if (
    newStreak > ZERO_DENOMINATOR_ALERT_AFTER &&
    args.resend &&
    args.founderEmail
  ) {
    await args.resend.emails.send({
      from: ALERT_FROM,
      to: args.founderEmail,
      subject: `[H-2 SEV-2] Phase 19 flag-monitor denominator stuck at 0 for ${newStreak} windows`,
      html: `<p>The /process-key audit_log denominator has been 0 for ${newStreak} consecutive 15-min windows. Either no traffic is reaching /process-key OR the audit-write at /process-key entry is failing. Auto-rollback cannot trip in this state — investigate before traffic resumes.</p><p>Manual rollback runbook: <code>.planning/phase-19/rollback-runbook.md</code>.</p>`,
    });
  }
  return NextResponse.json({
    ok: false,
    reason: "zero_denominator",
    streak: newStreak,
  });
}

async function sendErrorRateAlert(args: {
  resend: Resend | null;
  founderEmail: string | undefined;
  errorRate: number;
  errorCount: number;
  total: number;
}): Promise<NextResponse> {
  // Phase 106 (Stage B): ALERT-ONLY. The auto-rollback was retired — this
  // never writes the feature_flags kill-switch row (flipping it would be an
  // outage, not a rollback: the unified backbone is the only path). The email
  // directs the founder to investigate manually; rollback = git revert +
  // redeploy.
  if (args.resend && args.founderEmail) {
    await args.resend.emails.send({
      from: ALERT_FROM,
      to: args.founderEmail,
      subject: `[ALERT] Phase 19 backbone error rate ${(args.errorRate * 100).toFixed(2)}% — auto-rollback retired (Phase 106), investigate manually`,
      html: `<p>Error envelope rate <code>${(args.errorRate * 100).toFixed(2)}%</code> exceeded ${(ALERT_THRESHOLD * 100).toFixed(2)}% threshold over the past 15 minutes (${args.errorCount}/${args.total}).</p><p><strong>Auto-rollback was retired in Phase 106.</strong> The unified backbone is the only path and the kill-switch row is inert — this alert is informational. Investigate the error source manually; post-Stage-B rollback is <code>git revert + redeploy</code>. Runbook: <code>.planning/phase-19/rollback-runbook.md</code>.</p>`,
    });
  }

  console.warn(
    `[cron/flag-monitor] ERROR-RATE ALERT: errorRate=${args.errorRate} total=${args.total}`,
  );
  return NextResponse.json({
    ok: true,
    action: "alerted",
    errorRate: args.errorRate,
    errorCount: args.errorCount,
    total: args.total,
  });
}

async function handle(req: NextRequest): Promise<NextResponse> {
  // Auth — mirrors src/app/api/cron/sync-funding/route.ts:29-32
  const auth = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${process.env.CRON_SECRET}`;
  if (!process.env.CRON_SECRET || !safeCompare(auth, expected)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const orgSlug = process.env.SENTRY_ORG_SLUG;
  const sentryToken = process.env.SENTRY_AUTH_TOKEN;
  const founderEmail = process.env.FOUNDER_LP_REPORT_TO;
  const resendKey = process.env.RESEND_API_KEY;

  if (!orgSlug || !sentryToken) {
    console.warn(
      "[cron/flag-monitor] SENTRY_ORG_SLUG or SENTRY_AUTH_TOKEN missing — skipping",
    );
    return NextResponse.json({ ok: false, reason: "sentry_not_configured" });
  }

  const admin = createAdminClient();
  const now = new Date();
  const windowStart = new Date(now.getTime() - 15 * 60 * 1000);
  const resend = resendKey ? new Resend(resendKey) : null;

  // 1) Numerator — Sentry error event count for /api/process-key in the last
  //    15 minutes. Pitfall 8: environment:production filter prevents
  //    dev/preview events (CI cassette runs) from triggering rollback.
  const numerator = await getNumerator({ orgSlug, sentryToken });
  if (numerator.kind === "terminal") return numerator.res;
  const errorCount = numerator.errorCount;

  // 2) Denominator — Supabase audit_log /process-key entries in same window.
  //    P4 (analytics-service/routers/process_key.py) writes audit_log row at
  //    /process-key entry; this is the load-bearing source.
  const total = await getDenominator({ admin, windowStart });

  // 3) H-2 — denominator streak guard. If audit_log row count stays at 0 for
  //    >2 consecutive 15-min windows the denominator is silently broken and
  //    the cron is a no-op. Fail-open by sending a SEV-2 alert.
  if (total === 0) {
    return await handleZeroDenominator({ admin, now, resend, founderEmail });
  }

  // Reset streak on the first non-zero window. Best-effort — if the upsert
  // fails we don't escalate; the next zero window starts the count again.
  await admin.from("feature_flags").upsert(
    {
      flag_key: ZERO_DENOM_STREAK_KEY,
      value: "0",
      updated_at: now.toISOString(),
      updated_by: "cron/flag-monitor",
    },
    { onConflict: "flag_key" },
  );

  const errorRate = errorCount / total;

  // 4) Threshold logic — order matters: ALERT first, then WARN. Phase 106:
  //    the ALERT branch alerts only — it never flips the (retired) kill-switch.
  if (errorRate > ALERT_THRESHOLD && total >= MIN_SAMPLE) {
    return await sendErrorRateAlert({
      resend,
      founderEmail,
      errorRate,
      errorCount,
      total,
    });
  }

  if (errorRate > WARN_THRESHOLD && total >= MIN_SAMPLE) {
    if (resend && founderEmail) {
      await resend.emails.send({
        from: ALERT_FROM,
        to: founderEmail,
        subject: `[WARN] Phase 19 error rate ${(errorRate * 100).toFixed(2)}% — below alert threshold`,
        html: `<p>Error rate ${errorCount}/${total} = ${(errorRate * 100).toFixed(2)}% — below the ${(ALERT_THRESHOLD * 100).toFixed(2)}% alert threshold but worth a look.</p>`,
      });
    }
    return NextResponse.json({
      ok: true,
      action: "warn_sent",
      errorRate,
      errorCount,
      total,
    });
  }

  return NextResponse.json({ ok: true, errorRate, errorCount, total });
}

export const GET = handle;
export const POST = handle;
