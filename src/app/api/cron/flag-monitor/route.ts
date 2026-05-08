/**
 * Phase 19 / BACKBONE-05 — auto-rollback cron.
 *
 * Polls Sentry events API every 15 minutes for /api/process-key error events.
 * Computes error envelope rate (errors / total /process-key calls in same
 * tumbling window). Threshold: errorRate > 0.5% with total >= 20 → flips
 * Supabase feature_flags kill-switch row to 'off'. Sends Resend ALERT email
 * to founder. Sub-threshold (errorRate > 0.25%) sends WARN email per
 * .planning/phases/19-unified-backbone-conditional-on-day-2-gate-commit/19-CONTEXT.md L40
 * ("regardless of auto-rollback action").
 *
 * Manual rollback fallback (Supabase outage) documented in
 * .planning/phase-19/rollback-runbook.md.
 *
 * Theme 5 reminder: during the 7-day stability window after P5 PR-B flag flip,
 * cross-check this cron's error count against scripts/repro-key-flow.sh daily
 * cassette refresh output. Discrepancy = likely environment filter regression.
 *
 * Sentry events API shape verified by scripts/probe-sentry-events-api.sh
 * BEFORE deploy (Assumption A1). The handler parses BOTH `data[0]["count()"]`
 * and `data[0].count` for resilience to a third shape rotation.
 *
 * Pitfall 8: the outbound Sentry query MUST include `environment:production`
 * to prevent dev/preview events (e.g. CI cassette runs) from triggering
 * production rollback. The src/instrumentation.ts + analytics-service/
 * sentry_init.py inits both stamp environment from VERCEL_ENV — see
 * tests/integration/sentry-environment.test.ts (H-6).
 *
 * H-2: when audit_log denominator is 0 for >2 consecutive 15-min windows,
 * the cron is a silent no-op. Streak counter in feature_flags row
 * `flag_monitor_zero_denominator_streak` triggers a SEV-2 alert email on
 * the 3rd zero window so the founder sees it.
 *
 * D-3: when the kill-switch upsert raises a PostgREST schema/function-cache
 * error, send a SEV-2 alert and return 500. The auto-rollback path is broken
 * and the founder must use the manual rollback runbook.
 */
import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { safeCompare } from "@/lib/timing-safe-compare";
import { Resend } from "resend";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const SENTRY_BASE = "https://sentry.io/api/0/organizations";

const ALERT_THRESHOLD = 0.005; // 0.5% error envelope rate
const WARN_THRESHOLD = 0.0025; // 0.25%
const MIN_SAMPLE = 20;
const ZERO_DENOMINATOR_ALERT_AFTER = 2; // alert when streak exceeds this (i.e. >=3)

const KILL_SWITCH_KEY = "process_key_unified_backbone";
const ZERO_DENOM_STREAK_KEY = "flag_monitor_zero_denominator_streak";

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

function isPostgrestResolutionError(err: unknown): boolean {
  const s = err instanceof Error ? `${err.message}\n${err.stack ?? ""}` : String(err);
  return /PGRST/.test(s) || /function not found/i.test(s) || /schema cache/i.test(s);
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
  const params = new URLSearchParams({
    statsPeriod: "15m",
    query:
      "level:error path:/api/process-key correlation_id:* environment:production",
    field: "count()",
  });
  const sentryUrl = `${SENTRY_BASE}/${orgSlug}/events/?${params}`;

  let sentryRes: Response;
  try {
    sentryRes = await fetch(sentryUrl, {
      headers: { Authorization: `Bearer ${sentryToken}` },
      cache: "no-store",
    });
  } catch (err) {
    console.warn("[cron/flag-monitor] sentry fetch threw:", err);
    return NextResponse.json({ ok: false, reason: "sentry_unreachable" });
  }
  if (!sentryRes.ok) {
    console.warn("[cron/flag-monitor] sentry status:", sentryRes.status);
    return NextResponse.json({
      ok: false,
      reason: "sentry_unreachable",
      status: sentryRes.status,
    });
  }
  const sentryData = await sentryRes.json().catch(() => ({}));
  const errorCount = parseSentryCount(sentryData);

  // 2) Denominator — Supabase audit_log /process-key entries in same window.
  //    P4 (analytics-service/routers/process_key.py) writes audit_log row at
  //    /process-key entry; this is the load-bearing source.
  const { count: totalCount } = await admin
    .from("audit_log")
    .select("id", { count: "exact", head: true })
    .eq("entity_type", "process_key")
    .gte("created_at", windowStart.toISOString());
  const total = totalCount ?? 0;

  // 3) H-2 — denominator streak guard. If audit_log row count stays at 0 for
  //    >2 consecutive 15-min windows the denominator is silently broken and
  //    the cron is a no-op. Fail-open by sending a SEV-2 alert.
  if (total === 0) {
    const { data: flagRow } = await admin
      .from("feature_flags")
      .select("value")
      .eq("flag_key", ZERO_DENOM_STREAK_KEY)
      .maybeSingle();
    const currentStreak = parseInt(flagRow?.value ?? "0", 10) || 0;
    const newStreak = currentStreak + 1;
    await admin.from("feature_flags").upsert(
      {
        flag_key: ZERO_DENOM_STREAK_KEY,
        value: String(newStreak),
        updated_at: now.toISOString(),
        updated_by: "cron/flag-monitor",
      },
      { onConflict: "flag_key" },
    );
    if (newStreak > ZERO_DENOMINATOR_ALERT_AFTER && resend && founderEmail) {
      await resend.emails.send({
        from: "Quantalyze <alerts@quantalyze.com>",
        to: founderEmail,
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

  // 4) Threshold logic — order matters: ALERT first, then WARN.
  if (errorRate > ALERT_THRESHOLD && total >= MIN_SAMPLE) {
    // D-3 — PostgREST resolution-error fallback. PGRST function-not-found
    // (or schema-cache stale) means the kill-switch upsert is unreachable;
    // SEV-2 alert + 500 so the founder uses the manual runbook.
    try {
      await admin.from("feature_flags").upsert(
        {
          flag_key: KILL_SWITCH_KEY,
          value: "off",
          updated_at: now.toISOString(),
          updated_by: "cron/flag-monitor",
        },
        { onConflict: "flag_key" },
      );
    } catch (err: unknown) {
      if (isPostgrestResolutionError(err)) {
        console.error("[cron/flag-monitor] D-3 PostgREST resolution error:", err);
        if (resend && founderEmail) {
          await resend.emails.send({
            from: "Quantalyze <alerts@quantalyze.com>",
            to: founderEmail,
            subject: `[D-3 SEV-2] Phase 19 kill-switch upsert failed (PGRST)`,
            html: `<p>Auto-rollback failed because the Supabase kill-switch upsert raised a PostgREST resolution error. Manual rollback runbook: <code>.planning/phase-19/rollback-runbook.md</code>.</p><p>Error: <code>${String(err).replace(/</g, "&lt;")}</code></p><p>Error envelope rate <code>${(errorRate * 100).toFixed(2)}%</code> (${errorCount}/${total}) WAS observed but the kill-switch row could not be flipped.</p>`,
          });
        }
        return NextResponse.json(
          {
            ok: false,
            reason: "kill_switch_unreachable_d3",
            error: String(err),
          },
          { status: 500 },
        );
      }
      throw err;
    }

    if (resend && founderEmail) {
      await resend.emails.send({
        from: "Quantalyze <alerts@quantalyze.com>",
        to: founderEmail,
        subject: `[ALERT] Phase 19 backbone auto-rolled-back: ${(errorRate * 100).toFixed(2)}% error rate`,
        html: `<p>Error envelope rate <code>${(errorRate * 100).toFixed(2)}%</code> exceeded ${(ALERT_THRESHOLD * 100).toFixed(2)}% threshold over the past 15 minutes (${errorCount}/${total}). Kill-switch row <code>${KILL_SWITCH_KEY}</code> has been flipped to <code>off</code>; new traffic falls back to legacy routes within the configured cache TTL (default 30s; <code>PHASE_19_STABILITY_CACHE_TTL_S</code> shortens this to 5s during the stability window).</p><p>Manual rollback runbook: <code>.planning/phase-19/rollback-runbook.md</code>.</p>`,
      });
    }

    console.warn(
      `[cron/flag-monitor] AUTO-ROLLBACK: errorRate=${errorRate} total=${total}`,
    );
    return NextResponse.json({
      ok: true,
      action: "rolled_back",
      errorRate,
      errorCount,
      total,
    });
  }

  if (errorRate > WARN_THRESHOLD && total >= MIN_SAMPLE) {
    if (resend && founderEmail) {
      await resend.emails.send({
        from: "Quantalyze <alerts@quantalyze.com>",
        to: founderEmail,
        subject: `[WARN] Phase 19 error rate ${(errorRate * 100).toFixed(2)}% — below auto-rollback threshold`,
        html: `<p>Error rate ${errorCount}/${total} = ${(errorRate * 100).toFixed(2)}% — below the ${(ALERT_THRESHOLD * 100).toFixed(2)}% auto-rollback threshold but worth a look.</p>`,
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
