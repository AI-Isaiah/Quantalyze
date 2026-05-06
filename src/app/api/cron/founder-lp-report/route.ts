/**
 * Phase 18 / LP-01 + LP-02 — Founder LP report cron.
 *
 * Vercel Cron — monthly (1st of month, 09:15 UTC; moved from 09:00 per
 * Adversarial revision B4 to avoid colliding with `/api/alert-digest` at
 * `0 9 * * *`). Internally fetches `/api/factsheet/${FOUNDER_LP_STRATEGY_ID}/pdf`
 * (passing `x-internal-token` to bypass `publicIpLimiter` on that endpoint —
 * Adversarial revision B4) and emails the resulting PDF to the founder via
 * Resend. Closes the v1.0.0 dogfood loop: every month the founder sees their
 * own LP-shaped output and notices regressions BEFORE LPs do.
 *
 * Note: Vercel cron does not pass x-correlation-id; cron always generates
 * a fresh UUID v4 per tick via getCorrelationId() (matches the
 * sync-funding/route.ts pattern at line 62).
 *
 * Adversarial revisions 2026-05-06:
 *   - B1:     Supabase precheck on strategies.status='published' +
 *             strategy_analytics.computation_status='complete'
 *   - B4:     x-internal-token header on internal fetch (factsheet bypass);
 *             schedule moved to 15 9 1 * *; double-failure
 *             [CRON_DOUBLE_FAILURE] escalation on console.error
 *   - W1:     503 retry once after Retry-After: <n>s, then fall through
 *             to dual-alert
 *   - W2:     cron always generates fresh UUID via getCorrelationId
 *             (Vercel cron does not pass x-correlation-id)
 *   - W5:     auth header validated FIRST, then getCorrelationId
 *             (matches sync-funding pattern)
 *   - W7:     captureSentry try/catch covers Sentry SDK throws —
 *             alert email still fires
 *   - Grok W4: AbortSignal with 25s timeout on internal fetch
 *             (well under Vercel's 60s lambda ceiling)
 *   - Grok W5: strategy publication precheck via createAdminClient +
 *             select status + analytics
 *
 * Auth: `Authorization: Bearer ${CRON_SECRET}` via `safeCompare`
 * (constant-time). Vercel Cron dispatches GET; manual POST also
 * works for incident response.
 *
 * Failure handling (LP-02 / Pitfall 7): each alert in its OWN try/catch
 * so a Sentry outage doesn't suppress the Resend alert and vice versa.
 * If BOTH fail, escalate via console.error with `[CRON_DOUBLE_FAILURE]`
 * prefix per B4. Silent failure prohibited.
 *
 * Schedule + env-vars: see `vercel.json` and `.env.example`.
 *
 * @audit-skip: cron-triggered LP report dispatch, no user attribution.
 * The handler reads founder strategy state and emails a PDF the founder
 * already has authority to view (status='published' factsheet).
 */
import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import { safeCompare } from "@/lib/timing-safe-compare";
import { getCorrelationId } from "@/lib/correlation-id";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
// Vercel Pro lambda ceiling for cron handlers is 60s. The internal fetch
// caps at 25s (Grok W4) so we leave plenty of headroom for Resend.
export const maxDuration = 60;

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
const PLATFORM_NAME = process.env.PLATFORM_NAME ?? "Quantalyze";
const PLATFORM_EMAIL = process.env.PLATFORM_EMAIL ?? "notifications@quantalyze.com";

async function captureSentry(
  error: unknown,
  ctx: Record<string, unknown>,
): Promise<void> {
  if (!process.env.SENTRY_DSN) return;
  const Sentry = await import("@sentry/nextjs");
  Sentry.captureException(error, {
    tags: {
      "cron-failure": "founder-lp-report",
      correlation_id: ctx.correlation_id as string,
    },
    extra: ctx,
  });
}

async function sendFailureAlert(
  resend: Resend | null,
  to: string,
  ctx: { correlation_id: string; error_class: string; error_message: string },
): Promise<void> {
  if (!resend || !to) return;
  await resend.emails.send({
    from: `${PLATFORM_NAME} <${PLATFORM_EMAIL}>`,
    to,
    subject: `[ALERT] Founder LP cron FAILED — ${new Date().toISOString().slice(0, 10)}`,
    html: `<p>The founder LP report cron failed. correlation_id=${ctx.correlation_id}</p>
           <pre style="font-family:monospace;">${ctx.error_class}: ${ctx.error_message}</pre>`,
    tags: [
      { name: "correlation_id", value: ctx.correlation_id },
      { name: "kind", value: "cron_failure_alert" },
    ],
  });
}

/**
 * Adversarial revision 2026-05-06: B4 + Pitfall 7 — each alert in its own
 * try/catch; if both throw, escalate via console.error.
 */
async function dualAlert(
  resend: Resend | null,
  to: string,
  err: unknown,
  ctx: { correlation_id: string; error_class: string; error_message: string },
): Promise<void> {
  let sentryThrew = false;
  let resendThrew = false;
  try {
    await captureSentry(err, ctx);
  } catch (sentryErr) {
    sentryThrew = true;
    console.error("[cron/founder-lp-report] captureSentry threw:", sentryErr);
  }
  try {
    await sendFailureAlert(resend, to, ctx);
  } catch (resendErr) {
    resendThrew = true;
    console.error("[cron/founder-lp-report] sendFailureAlert threw:", resendErr);
  }
  if (sentryThrew && resendThrew) {
    console.error(
      `[CRON_DOUBLE_FAILURE] founder-lp-report: BOTH alerts failed. ` +
        `correlation_id=${ctx.correlation_id} ` +
        `error_class=${ctx.error_class} error_message=${ctx.error_message}`,
    );
  }
}

/**
 * Adversarial revisions 2026-05-06: B1 + Grok W5 — strategy publication precheck.
 *
 * The factsheet PDF endpoint filters on `strategies.status='published'` and
 * `strategy_analytics.computation_status='complete'`. If either column is
 * not in the expected state, the endpoint returns 404/400 and the cron
 * falls into the dual-alert path on every tick. Pre-checking against
 * Supabase before the fetch lets us tag the failure precisely (so the
 * runbook trail is short) AND short-circuit the network round-trip.
 */
async function checkStrategyReadiness(
  strategy_id: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("strategies")
    .select("id, status, strategy_analytics(computation_status)")
    .eq("id", strategy_id)
    .single();
  if (error || !data) {
    return {
      ok: false,
      reason: `strategy ${strategy_id} not found: ${error?.message ?? "no row"}`,
    };
  }
  const status = (data as { status?: string }).status;
  const analyticsRaw = (data as { strategy_analytics?: unknown }).strategy_analytics;
  const analytics = Array.isArray(analyticsRaw) ? analyticsRaw[0] : analyticsRaw;
  const compStatus = (analytics as { computation_status?: string } | null | undefined)
    ?.computation_status;
  if (status !== "published") {
    return {
      ok: false,
      reason: `strategies.status='${status}' (expected 'published') — see .planning/phase-18/founder-lp-runbook.md`,
    };
  }
  if (compStatus !== "complete") {
    return {
      ok: false,
      reason: `strategy_analytics.computation_status='${compStatus}' (expected 'complete')`,
    };
  }
  return { ok: true };
}

/**
 * Adversarial revision 2026-05-06: W1 — single 503 retry honoring
 * Retry-After. Grok W4 — 25s AbortSignal (Vercel lambda ceiling 60s,
 * factsheet endpoint maxDuration is 30s — 25s leaves a buffer).
 * B4 — passes `x-internal-token` to bypass `publicIpLimiter` on the
 * factsheet endpoint.
 */
async function fetchFactsheetPdfWithRetry(
  strategy_id: string,
  correlation_id: string,
): Promise<Response> {
  const url = `${APP_URL}/api/factsheet/${encodeURIComponent(strategy_id)}/pdf`;
  const internalToken = process.env.INTERNAL_API_TOKEN ?? "";
  const buildOptions = (): RequestInit => ({
    headers: {
      "x-correlation-id": correlation_id,
      "x-internal-token": internalToken,
    },
    signal: AbortSignal.timeout(25_000),
  });
  const first = await fetch(url, buildOptions());
  if (first.status !== 503) return first;
  const retryAfterRaw = first.headers.get("retry-after") ?? "10";
  const retryAfterSec = Math.max(1, Number.parseInt(retryAfterRaw, 10) || 10);
  await new Promise((resolve) => setTimeout(resolve, retryAfterSec * 1000));
  return await fetch(url, buildOptions());
}

async function handle(req: NextRequest): Promise<NextResponse> {
  // Adversarial revision 2026-05-06: W5 — auth FIRST, then correlation_id.
  // Matches sync-funding/route.ts:27-32 exactly.
  const auth = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${process.env.CRON_SECRET}`;
  if (!process.env.CRON_SECRET || !safeCompare(auth, expected)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const correlation_id = await getCorrelationId();

  // Adversarial revision 2026-05-06: B4 + Phase 18 / WR-01 follow-up
  // (WR-02): defensive global unhandled-rejection handler. Registered
  // INSIDE handle() (not at module scope) and removed in `finally` so
  // each lambda invocation attaches exactly one listener. Module-scope
  // registration leaked listeners across warm-starts and Vitest's
  // repeated `await import("./route")` in route.test.ts, polluting all
  // unhandled rejections in the same Node process with the
  // [CRON_DOUBLE_FAILURE] founder-lp-report prefix.
  const onUnhandledRejection = (reason: unknown) => {
    console.error(
      "[CRON_DOUBLE_FAILURE] unhandledRejection in founder-lp-report:",
      reason,
    );
  };
  const supportsProcessEvents =
    typeof process !== "undefined" &&
    typeof process.on === "function" &&
    typeof process.off === "function";
  if (supportsProcessEvents) {
    try {
      process.on("unhandledRejection", onUnhandledRejection);
    } catch {
      // never block the request on listener registration
    }
  }

  try {
    const strategy_id = process.env.FOUNDER_LP_STRATEGY_ID;
    const recipient = process.env.FOUNDER_LP_REPORT_TO ?? process.env.ADMIN_EMAIL ?? "";
    const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

    if (!strategy_id || !recipient || !resend) {
      const ctx = {
        correlation_id,
        error_class: "ConfigError",
        error_message:
          `missing FOUNDER_LP_STRATEGY_ID=${!!strategy_id} ` +
          `FOUNDER_LP_REPORT_TO=${!!recipient} ` +
          `RESEND_API_KEY=${!!resend}`,
      };
      console.error("[cron/founder-lp-report] config error:", ctx);
      await dualAlert(resend, recipient, new Error(ctx.error_message), ctx);
      return NextResponse.json({ ok: false, ...ctx }, { status: 500 });
    }

    // Adversarial revision 2026-05-06: B1 + Grok W5 — strategy publication precheck.
    const readiness = await checkStrategyReadiness(strategy_id);
    if (!readiness.ok) {
      const ctx = {
        correlation_id,
        strategy_id,
        error_class: "StrategyNotReady",
        error_message: readiness.reason,
      };
      console.error("[cron/founder-lp-report] strategy not ready:", ctx);
      await dualAlert(resend, recipient, new Error(ctx.error_message), ctx);
      return NextResponse.json({ ok: false, ...ctx }, { status: 500 });
    }

    try {
      const pdfRes = await fetchFactsheetPdfWithRetry(strategy_id, correlation_id);
      if (!pdfRes.ok) {
        throw new Error(
          `factsheet PDF fetch failed: ${pdfRes.status} ${pdfRes.statusText}`,
        );
      }
      // Pitfall 6 — Buffer.from(arrayBuffer) for the Resend attachment encoding.
      const pdfBuffer = Buffer.from(await pdfRes.arrayBuffer());
      const monthLabel = new Date().toLocaleString("en-US", {
        month: "long",
        year: "numeric",
      });

      await resend.emails.send({
        from: `${PLATFORM_NAME} <${PLATFORM_EMAIL}>`,
        to: recipient,
        subject: `Founder LP report — ${monthLabel}`,
        html: `<p>Monthly LP factsheet attached.</p>
               <p style="color:#666;font-size:12px;">correlation_id: ${correlation_id}</p>`,
        attachments: [
          {
            filename: `founder-lp-${monthLabel.replace(/\s/g, "-")}.pdf`,
            content: pdfBuffer,
            contentType: "application/pdf",
          },
        ],
        tags: [
          { name: "correlation_id", value: correlation_id },
          { name: "kind", value: "founder_lp_report" },
        ],
      });

      return NextResponse.json({
        ok: true,
        correlation_id,
        strategy_id,
        pdf_bytes: pdfBuffer.length,
        sent_to: recipient,
      });
    } catch (err) {
      const ctx = {
        correlation_id,
        strategy_id,
        error_class: err instanceof Error ? err.constructor.name : "UnknownError",
        error_message: err instanceof Error ? err.message : String(err),
      };
      console.error("[cron/founder-lp-report] failure:", ctx);
      await dualAlert(resend, recipient, err, ctx);
      return NextResponse.json({ ok: false, ...ctx }, { status: 500 });
    }
  } finally {
    if (supportsProcessEvents) {
      try {
        process.off("unhandledRejection", onUnhandledRejection);
      } catch {
        // best-effort cleanup; never block the response
      }
    }
  }
}

export const GET = handle;
export const POST = handle;
