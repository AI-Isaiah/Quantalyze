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
 * Note: Vercel cron does not pass x-correlation-id; the cron always generates
 * a fresh UUID v4 per tick via `getCorrelationId()` (matches the
 * `sync-funding/route.ts` pattern).
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
 * Phase 18 / Pre-landing review fixes (2026-05-07):
 *   - M5: magic numbers hoisted to named constants below
 *   - M6: log prefixes split — `[CRON_DOUBLE_FAILURE]` only for double-alert
 *         failure; `[CRON_UNHANDLED_REJECTION]` for the listener path
 *   - M7: readiness check delegated to `@/lib/founder-lp/readiness` so the
 *         cron and `scripts/check-founder-lp-readiness.ts` cannot drift
 *   - M11: platform branding defaults centralized in `@/lib/platform`
 *   - R1: env-guard: skip in non-production VERCEL_ENV (preview deploys
 *         must NOT email the real founder via prod APP_URL)
 *   - R3: explicit timeout on every Resend send (was only on factsheet fetch)
 *   - R5: APP_URL host validated against an allowlist before forwarding
 *         INTERNAL_API_TOKEN (the self-fetch traverses public infra)
 *   - R6: empty-PDF guard (sub-1KB response treated as failure)
 *   - R7: max-PDF guard (Resend rejects >40MB; we cap at 25MB)
 *   - R8: Retry-After upper bound so a malicious 999999s value can't hang
 *         the lambda past its 60s ceiling
 *   - S2: HTML-escape error_class/error_message in the alert email body
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
import { checkFounderStrategyReadiness } from "@/lib/founder-lp/readiness";
import { getPlatformName, getPlatformEmail } from "@/lib/platform";

export const dynamic = "force-dynamic";
// Vercel Pro lambda ceiling for cron handlers is 60s. The internal fetch
// caps at 25s (Grok W4) so we leave plenty of headroom for Resend (15s
// per send, R3) plus a small buffer.
export const maxDuration = 60;

// -----------------------------------------------------------------------
// Magic-number hoisting (Phase 18 / M5)
// -----------------------------------------------------------------------

/** Internal factsheet fetch ceiling (well under Vercel's 60s lambda budget). */
const FETCH_TIMEOUT_MS = 25_000;
/** Per-Resend-send ceiling — prevents the lambda from dying mid-send if
 *  Resend's API hangs. Two sends total fit inside the 60s budget. */
const RESEND_TIMEOUT_MS = 15_000;
/** Default Retry-After when the upstream omits the header. */
const DEFAULT_RETRY_AFTER_S = 10;
/** Phase 18 / R8 — upper bound on Retry-After: prevents a malicious or
 *  buggy upstream from pinning the lambda past its 60s ceiling. */
const MAX_RETRY_AFTER_S = 20;
/** Phase 18 / R6 — minimum acceptable PDF size. A real factsheet is at
 *  least tens of KB; sub-1KB responses are treated as upstream failures
 *  rather than emailed as empty PDFs. */
const MIN_PDF_BYTES = 1024;
/** Phase 18 / R7 — Resend stable attachment ceiling is 40MB. Cap at 25MB
 *  so a regression in the factsheet renderer surfaces as a clear alert
 *  rather than a Resend 4xx that the dual-alert path would mis-attribute. */
const MAX_PDF_BYTES = 25_000_000;

/** Log prefix for the BOTH-alerts-failed escalation (the hard runbook trigger). */
const CRON_DOUBLE_FAILURE_PREFIX = "[CRON_DOUBLE_FAILURE]";
/** Phase 18 / M6 — distinct prefix for the unhandledRejection listener so
 *  log-based alerts can target each path independently. */
const CRON_UNHANDLED_REJECTION_PREFIX = "[CRON_UNHANDLED_REJECTION]";

/** Stable error_class strings (becomes a Sentry tag and a log filter). */
const ERROR_CLASS = {
  CONFIG: "ConfigError",
  NOT_READY: "StrategyNotReady",
  PDF_EMPTY: "PdfTooSmall",
  PDF_TOO_LARGE: "PdfTooLarge",
  TIMEOUT: "AlertTimeout",
  UNKNOWN: "UnknownError",
} as const;

/** Phase 18 / R5 — explicit allowlist of hosts the cron may forward
 *  `x-internal-token` to. Prevents a misconfigured NEXT_PUBLIC_APP_URL
 *  on a preview deploy (or a redirect through a third-party proxy) from
 *  egressing the internal token. Enforced only in production VERCEL_ENV;
 *  local + preview tolerate any host so dev/test paths keep working. */
const APP_URL_ALLOWED_HOSTS: ReadonlySet<string> = new Set([
  "quantalyze-rho.vercel.app",
  "quantalyze.com",
  "www.quantalyze.com",
]);

// NEXT_PUBLIC_APP_URL and VERCEL_ENV are read at HANDLER-CALL TIME (not
// module-load time) so tests + Vitest's `vi.resetModules()` don't bake a
// stale value into the cached module constants. Vercel injects both at
// runtime, so the cost of re-reading on every cron tick is irrelevant.
function appUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
}
function vercelEnv(): string | undefined {
  return process.env.VERCEL_ENV;
}
function isProduction(): boolean {
  return vercelEnv() === "production";
}

// -----------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------

/** HTML escape for values interpolated into the alert email body (S2). */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Promise.race-style ceiling for any awaited promise. Phase 18 / R3 —
 *  Resend's SDK has no built-in timeout so we wrap each send. */
async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${ms}ms`)),
      ms,
    );
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** Phase 18 / R5 — verify NEXT_PUBLIC_APP_URL host before forwarding the
 *  internal token. Enforced in production; opt-out for local/preview so
 *  dev paths keep working. */
function isAppUrlAllowed(url: string): boolean {
  if (!isProduction()) return true;
  try {
    const u = new URL(url);
    return APP_URL_ALLOWED_HOSTS.has(u.host);
  } catch {
    return false;
  }
}

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
  // Phase 18 / S2 — escape user/upstream-controlled fields before HTML
  // interpolation. Today every error_message originates from server-side
  // strings, but a future caller wrapping a user-controlled error must
  // not be able to render arbitrary HTML in the founder's inbox.
  const safeClass = escapeHtml(ctx.error_class);
  const safeMessage = escapeHtml(ctx.error_message);
  const safeCid = escapeHtml(ctx.correlation_id);
  const send = resend.emails.send({
    from: `${getPlatformName()} <${getPlatformEmail()}>`,
    to,
    subject: `[ALERT] Founder LP cron FAILED — ${new Date().toISOString().slice(0, 10)}`,
    html: `<p>The founder LP report cron failed. correlation_id=${safeCid}</p>
           <pre style="font-family:monospace;">${safeClass}: ${safeMessage}</pre>`,
    tags: [
      { name: "correlation_id", value: ctx.correlation_id },
      { name: "kind", value: "cron_failure_alert" },
    ],
  });
  await withTimeout(send, RESEND_TIMEOUT_MS, "sendFailureAlert");
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
  // Phase 18 / R10 (red team 2026-05-07) — bound `error_message` so an
  // upstream multi-MB error string (e.g., a Supabase echo of the full
  // request body) cannot bloat the Sentry event or trip Resend's body
  // size limit, which would push the failure into the SECOND failure
  // branch and surface a [CRON_DOUBLE_FAILURE] line that incorrectly
  // accuses Sentry of also having gone down.
  const safeCtx = {
    ...ctx,
    error_message:
      ctx.error_message.length > 2048
        ? ctx.error_message.slice(0, 2048) + "...[truncated]"
        : ctx.error_message,
  };
  let sentryThrew = false;
  let resendThrew = false;
  try {
    await captureSentry(err, safeCtx);
  } catch (sentryErr) {
    sentryThrew = true;
    console.error("[cron/founder-lp-report] captureSentry threw:", sentryErr);
  }
  try {
    await sendFailureAlert(resend, to, safeCtx);
  } catch (resendErr) {
    resendThrew = true;
    console.error("[cron/founder-lp-report] sendFailureAlert threw:", resendErr);
  }
  if (sentryThrew && resendThrew) {
    console.error(
      `${CRON_DOUBLE_FAILURE_PREFIX} founder-lp-report: BOTH alerts failed. ` +
        `correlation_id=${safeCtx.correlation_id} ` +
        `error_class=${safeCtx.error_class} error_message=${safeCtx.error_message}`,
    );
  }
}

/**
 * Adversarial revision 2026-05-06: W1 — single 503 retry honoring
 * Retry-After. Grok W4 — 25s AbortSignal (Vercel lambda ceiling 60s,
 * factsheet endpoint maxDuration is 30s — 25s leaves a buffer).
 * B4 — passes `x-internal-token` to bypass `publicIpLimiter` on the
 * factsheet endpoint. R8 — Retry-After capped to MAX_RETRY_AFTER_S.
 */
async function fetchFactsheetPdfWithRetry(
  strategy_id: string,
  correlation_id: string,
): Promise<Response> {
  const url = `${appUrl()}/api/factsheet/${encodeURIComponent(strategy_id)}/pdf`;
  // Phase 18 / WR-03 — omit the header entirely when INTERNAL_API_TOKEN
  // is unset rather than sending `x-internal-token: ""`. The factsheet
  // endpoint correctly rejects empty-token bypass via its
  // `internalEnv.length > 0` gate, but always sending the header masks
  // config drift: a missing env var silently degrades to public-IP
  // rate limiting against the shared Vercel egress IP, so the cron can
  // be starved by alert-digest bursts on the same region. Omitting the
  // header makes the bypass path engaged-or-not deterministic across
  // deploys; the dual-alert path will surface the resulting 429s
  // consistently instead of intermittently.
  //
  // Phase 18 / R5 — additionally REFUSE to forward the token if APP_URL
  // host is not in the production allowlist. Defense in depth against
  // env misconfiguration leaking the token to a third-party host.
  const internalToken = process.env.INTERNAL_API_TOKEN;
  const buildOptions = (): RequestInit => {
    const headers: Record<string, string> = {
      "x-correlation-id": correlation_id,
    };
    const tokenForwardable =
      typeof internalToken === "string" &&
      internalToken.length > 0 &&
      isAppUrlAllowed(url);
    if (tokenForwardable) {
      headers["x-internal-token"] = internalToken as string;
    }
    return {
      headers,
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    };
  };
  const first = await fetch(url, buildOptions());
  if (first.status !== 503) return first;
  const retryAfterRaw = first.headers.get("retry-after") ?? String(DEFAULT_RETRY_AFTER_S);
  const parsed = Number.parseInt(retryAfterRaw, 10);
  const retryAfterSec = Math.min(
    MAX_RETRY_AFTER_S,
    Math.max(1, Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_RETRY_AFTER_S),
  );
  await new Promise((resolve) => setTimeout(resolve, retryAfterSec * 1000));
  return await fetch(url, buildOptions());
}

async function handle(req: NextRequest): Promise<NextResponse> {
  // Adversarial revision 2026-05-06: W5 — auth FIRST, then correlation_id.
  // Matches the sync-funding cron pattern.
  const auth = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${process.env.CRON_SECRET}`;
  if (!process.env.CRON_SECRET || !safeCompare(auth, expected)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const correlation_id = await getCorrelationId();

  // Phase 18 / R1 — preview/deploy environment guard. Vercel cron only
  // fires on production by default, but a manual POST against a preview
  // deploy with NEXT_PUBLIC_APP_URL inherited from production would
  // (a) fetch the prod factsheet PDF using prod INTERNAL_API_TOKEN,
  // (b) email the real founder, and (c) emit Sentry/log events tagged
  // with the preview commit SHA. Refuse early.
  const env = vercelEnv();
  if (env !== undefined && env !== "production") {
    return NextResponse.json(
      {
        ok: false,
        skipped: "non-production",
        vercel_env: env,
        correlation_id,
      },
      { status: 200 },
    );
  }

  // Adversarial revision 2026-05-06: B4 + Phase 18 / WR-01 follow-up
  // (WR-02): defensive global unhandled-rejection handler. Registered
  // INSIDE handle() (not at module scope) and removed in `finally` so
  // each lambda invocation attaches exactly one listener. Module-scope
  // registration leaked listeners across warm-starts and Vitest's
  // repeated `await import("./route")` in route.test.ts, polluting all
  // unhandled rejections in the same Node process with the
  // [CRON_UNHANDLED_REJECTION] founder-lp-report prefix.
  const onUnhandledRejection = (reason: unknown) => {
    console.error(
      `${CRON_UNHANDLED_REJECTION_PREFIX} unhandledRejection in founder-lp-report:`,
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

    // Phase 18 / silent-prod-misconfig (Claude adversarial 2026-05-07) —
    // when running in production VERCEL_ENV, fall through to localhost is
    // never the right behavior. Catch the unset NEXT_PUBLIC_APP_URL early
    // so the dual-alert ctx tags it precisely instead of surfacing as a
    // generic ECONNREFUSED 30 days later.
    const appUrlIsSet =
      typeof process.env.NEXT_PUBLIC_APP_URL === "string" &&
      process.env.NEXT_PUBLIC_APP_URL.length > 0;

    if (!strategy_id || !recipient || !resend || (isProduction() && !appUrlIsSet)) {
      const ctx = {
        correlation_id,
        error_class: ERROR_CLASS.CONFIG,
        error_message:
          `missing FOUNDER_LP_STRATEGY_ID=${!!strategy_id} ` +
          `FOUNDER_LP_REPORT_TO=${!!recipient} ` +
          `RESEND_API_KEY=${!!resend} ` +
          `NEXT_PUBLIC_APP_URL=${appUrlIsSet}`,
      };
      console.error("[cron/founder-lp-report] config error:", ctx);
      await dualAlert(resend, recipient, new Error(ctx.error_message), ctx);
      return NextResponse.json({ ok: false, ...ctx }, { status: 500 });
    }

    // Adversarial revision 2026-05-06: B1 + Grok W5 — strategy publication precheck.
    // Phase 18 / M7 — delegated to the shared `checkFounderStrategyReadiness`
    // helper so the cron and `scripts/check-founder-lp-readiness.ts` cannot drift.
    const supabase = createAdminClient();
    const readiness = await checkFounderStrategyReadiness(supabase, strategy_id);
    if (!readiness.ok) {
      const ctx = {
        correlation_id,
        strategy_id,
        error_class: ERROR_CLASS.NOT_READY,
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
      // Phase 18 / R6 — empty-PDF guard. A 200 OK with a near-zero-byte
      // body (e.g. CDN edge cache hit on a stale empty response, or an
      // upstream proxy that strips the body but preserves status) must
      // not be emailed as a "successful" empty PDF.
      if (pdfBuffer.length < MIN_PDF_BYTES) {
        const err = new Error(
          `factsheet PDF too small: ${pdfBuffer.length} bytes ` +
            `(min ${MIN_PDF_BYTES})`,
        );
        Object.assign(err, { name: ERROR_CLASS.PDF_EMPTY });
        throw err;
      }
      // Phase 18 / R7 — max-PDF guard. Resend's stable attachment limit
      // is ~40MB; we cap at 25MB so the alert path tags the failure
      // cleanly rather than relying on Resend's own 4xx + the dual-alert
      // path's coarser error-class attribution.
      if (pdfBuffer.length > MAX_PDF_BYTES) {
        const err = new Error(
          `factsheet PDF too large: ${pdfBuffer.length} bytes ` +
            `(max ${MAX_PDF_BYTES})`,
        );
        Object.assign(err, { name: ERROR_CLASS.PDF_TOO_LARGE });
        throw err;
      }
      const monthLabel = new Date().toLocaleString("en-US", {
        month: "long",
        year: "numeric",
      });

      const successSend = resend.emails.send({
        from: `${getPlatformName()} <${getPlatformEmail()}>`,
        to: recipient,
        subject: `Founder LP report — ${monthLabel}`,
        html: `<p>Monthly LP factsheet attached.</p>
               <p style="color:#666;font-size:12px;">correlation_id: ${escapeHtml(correlation_id)}</p>`,
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
      // Phase 18 / R3 — bound the Resend send so a hung API call cannot
      // exhaust the lambda's 60s budget without writing a response.
      await withTimeout(successSend, RESEND_TIMEOUT_MS, "successSend");

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
        error_class:
          err instanceof Error
            ? // PDF guards set err.name; otherwise use the constructor name.
              err.name && err.name !== "Error"
              ? err.name
              : err.constructor.name
            : ERROR_CLASS.UNKNOWN,
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
