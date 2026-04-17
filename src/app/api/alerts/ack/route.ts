import { NextRequest, NextResponse, after } from "next/server";
import { createHash } from "crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyAlertAckToken } from "@/lib/alert-ack-token";
import { escapeHtml } from "@/lib/email";
import { publicIpLimiter, checkLimit, getClientIp } from "@/lib/ratelimit";
import { trackUsageEventServer } from "@/lib/analytics/usage-events";
import { logAuditEventAsUser } from "@/lib/audit";

/**
 * /api/alerts/ack?id=<alertId>&t=<token>
 *
 * Email-digest ack flow. Per docs/notes/alert-routing-v1.md:
 *
 *   GET  → verify HMAC + replay + state, then render a manual confirm page.
 *          Never auto-acks on GET — defeats Outlook Safe Links preloader.
 *   POST → re-verify, enforce Sec-Fetch-Site=same-origin + per-IP rate
 *          limit, flip acknowledged_at, and record the token hash in
 *          `used_ack_tokens` for one-time-use.
 *
 * Redirects (alert-routing-v1.md §"Ack token contract"):
 *   valid   → /allocations?ack=success&type=<alert_type>
 *   already → /allocations?ack=already
 *   expired → /allocations?ack=expired
 *   replay  → /allocations?ack=already  (indistinguishable from re-click)
 *
 * Uses admin client (service role) so the cross-user ack works — the email
 * link has no browser session, and the token itself is the proof of
 * ownership. RLS is bypassed deliberately; the HMAC + one-time-use +
 * rate-limit + origin triangle IS the auth surface for this route.
 */

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://quantalyze.com";

const ACK_REDIRECT = {
  expired: `${APP_URL}/allocations?ack=expired`,
  already: `${APP_URL}/allocations?ack=already`,
  success: (alertType: string) =>
    `${APP_URL}/allocations?ack=success&type=${encodeURIComponent(alertType)}`,
  error: `${APP_URL}/allocations?ack=error`,
} as const;

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

interface GuardResult {
  ok: true;
  alert: {
    id: string;
    alert_type: string;
    acknowledged_at: string | null;
    portfolio_id: string;
  };
  tokenHash: string;
}

/**
 * Shared guard rail for GET + POST. Runs the verify/replay/state checks
 * and resolves to either a redirect URL (on failure) or the alert row
 * and token hash to proceed with.
 *
 * Uses the admin client because the email link has no browser session.
 * The HMAC proves the request originated from an email we minted.
 */
async function runGuards(
  id: string,
  token: string | null,
): Promise<GuardResult | { ok: false; redirect: string }> {
  if (!id || !token) {
    return { ok: false, redirect: ACK_REDIRECT.expired };
  }

  if (!verifyAlertAckToken(id, token)) {
    return { ok: false, redirect: ACK_REDIRECT.expired };
  }

  const tokenHash = hashToken(token);
  const admin = createAdminClient();

  // Replay check — if this exact token has already been used, we
  // redirect to `already` (not `expired`, per the contract table —
  // a second click on an ack'd email should read as "done, not broken").
  const { data: used } = await admin
    .from("used_ack_tokens")
    .select("token_hash")
    .eq("token_hash", tokenHash)
    .maybeSingle();
  if (used) {
    return { ok: false, redirect: ACK_REDIRECT.already };
  }

  const { data: alert, error } = await admin
    .from("portfolio_alerts")
    .select("id, alert_type, acknowledged_at, portfolio_id")
    .eq("id", id)
    .maybeSingle();
  if (error || !alert) {
    return { ok: false, redirect: ACK_REDIRECT.expired };
  }
  if (alert.acknowledged_at) {
    return { ok: false, redirect: ACK_REDIRECT.already };
  }

  return { ok: true, alert, tokenHash };
}

/**
 * GET handler — render a one-click HTML confirm page.
 *
 * Never auto-acks. The Safe-Links scanner in Outlook fetches every URL in
 * an email before the user clicks; auto-acking on GET would ack every
 * alert the moment the email arrives. The confirm page wraps a form-POST
 * so the real ack only fires on a genuine user click.
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const id = url.searchParams.get("id") ?? "";
  const token = url.searchParams.get("t");

  // Per-IP rate limit on GET as well — Outlook Safe Links and other
  // preloaders can hammer this URL on every email scan, and rendering
  // the confirm page still costs a DB roundtrip per call.
  const ip = getClientIp(req.headers);
  const rl = await checkLimit(publicIpLimiter, `alerts-ack-get:${ip}`);
  if (!rl.success) {
    return NextResponse.json(
      { error: "Too many requests" },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter) } },
    );
  }

  const guard = await runGuards(id, token);
  if (!guard.ok) {
    return NextResponse.redirect(guard.redirect, { status: 303 });
  }

  // Look up the message text for display. We already have the alert row
  // from the guard, but we need the message field too — hit the db once
  // more rather than plumb the message through the guard return type.
  const admin = createAdminClient();
  const { data: full } = await admin
    .from("portfolio_alerts")
    .select("message, alert_type")
    .eq("id", id)
    .maybeSingle();

  const safeMessage = escapeHtml(full?.message ?? "");
  const safeType = escapeHtml(full?.alert_type ?? "");
  const safeId = escapeHtml(id);
  const safeToken = escapeHtml(token ?? "");

  const html = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>Acknowledge alert — Quantalyze</title>
    <meta name="robots" content="noindex,nofollow" />
    <style>
      body { font-family: 'DM Sans', -apple-system, sans-serif; background:#F8F9FA; color:#1A1A2E; margin:0; padding:48px 24px; }
      .card { max-width:480px; margin:0 auto; background:#FFFFFF; border:1px solid #E2E8F0; border-radius:8px; padding:32px; }
      h1 { font-size:20px; margin:0 0 16px; }
      p { font-size:14px; line-height:1.5; margin:0 0 12px; color:#4A5568; }
      .type { display:inline-block; padding:2px 8px; background:#FEF2F2; color:#DC2626; font-size:11px; text-transform:uppercase; border-radius:4px; margin-bottom:16px; letter-spacing:0.04em; }
      .message { color:#1A1A2E; font-size:14px; padding:12px 16px; background:#F8F9FA; border-left:3px solid #DC2626; margin:16px 0 24px; }
      button { background:#1B6B5A; color:#FFFFFF; border:none; border-radius:6px; padding:10px 20px; font-size:14px; font-weight:500; cursor:pointer; font-family:inherit; }
      button:hover { background:#155A4B; }
    </style>
  </head>
  <body>
    <div class="card">
      <h1>Acknowledge alert</h1>
      ${safeType ? `<div class="type">${safeType}</div>` : ""}
      <div class="message">${safeMessage}</div>
      <p>Click below to mark this alert as acknowledged. This link is one-time-use.</p>
      <form method="POST" action="/api/alerts/ack?id=${safeId}&t=${safeToken}">
        <button type="submit">Acknowledge alert</button>
      </form>
    </div>
  </body>
</html>`;

  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
}

/**
 * POST handler — perform the ack. Enforces:
 *   1. HMAC verify (via runGuards).
 *   2. Replay check (via runGuards).
 *   3. Alert not already acked (via runGuards).
 *   4. Sec-Fetch-Site === 'same-origin' — browsers set this on form POSTs
 *      from our own pages. Cross-site POSTs and direct hits without the
 *      header are rejected.
 *   5. Per-IP rate limit 5/min.
 */
export async function POST(req: NextRequest) {
  const url = new URL(req.url);
  const id = url.searchParams.get("id") ?? "";
  const token = url.searchParams.get("t");

  // Sec-Fetch-Site check BEFORE the DB guards — an attacker POSTing
  // from a phishing page should never touch our replay table.
  const site = req.headers.get("sec-fetch-site");
  if (site !== "same-origin") {
    return NextResponse.redirect(ACK_REDIRECT.expired, { status: 303 });
  }

  // Per-IP rate limit (5/min via publicIpLimiter). Bucket key is prefixed
  // so this limiter doesn't share a window with the PDF route.
  const ip = getClientIp(req.headers);
  const rl = await checkLimit(publicIpLimiter, `alerts-ack:${ip}`);
  if (!rl.success) {
    return NextResponse.json(
      { error: "Too many requests" },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter) } },
    );
  }

  const guard = await runGuards(id, token);
  if (!guard.ok) {
    return NextResponse.redirect(guard.redirect, { status: 303 });
  }

  const admin = createAdminClient();

  // @audit-skip: internal one-time-use token tracking. The used_ack_tokens
  // row exists purely to block replay of the HMAC-signed email link; it
  // is not a user-visible state change. The user-intent audit event is
  // the alert.acknowledge emission below.
  const { error: insertError } = await admin
    .from("used_ack_tokens")
    .insert({ token_hash: guard.tokenHash, alert_id: guard.alert.id });
  if (insertError) {
    // Unique-violation = concurrent second submission = replay.
    if (
      insertError.code === "23505" ||
      /duplicate key/i.test(insertError.message ?? "")
    ) {
      return NextResponse.redirect(ACK_REDIRECT.already, { status: 303 });
    }
    console.error("[alerts/ack] used_ack_tokens insert failed:", insertError);
    return NextResponse.redirect(ACK_REDIRECT.error, { status: 303 });
  }

  // Flip the alert. Scoped by id AND acknowledged_at IS NULL so a race
  // between two legitimate tabs lands exactly one write.
  const { error: updateError } = await admin
    .from("portfolio_alerts")
    .update({ acknowledged_at: new Date().toISOString() })
    .eq("id", guard.alert.id)
    .is("acknowledged_at", null);
  if (updateError) {
    console.error("[alerts/ack] portfolio_alerts update failed:", updateError);
    return NextResponse.redirect(ACK_REDIRECT.error, { status: 303 });
  }

  // Resolve the portfolio owner id ONCE and share it across both the
  // audit emission (Task 7.1b) and the usage-funnel event (Task 5.5).
  // Previously these did two separate lookups for the same (portfolio_id)
  // → (user_id) mapping.
  //
  // Failure semantics preserved:
  //   - Audit: skip emission on null user_id (do NOT attribute to NULL).
  //   - Funnel: fall back to `alert:<id>` synthetic distinctId.
  // A try/catch around the lookup keeps both paths non-blocking; a
  // warning is logged only for the audit-side concern so the operator
  // signal is unchanged.
  let ownerUserId: string | null = null;
  try {
    const { data: portfolioRow } = await admin
      .from("portfolios")
      .select("user_id")
      .eq("id", guard.alert.portfolio_id)
      .maybeSingle();
    if (portfolioRow?.user_id) {
      ownerUserId = portfolioRow.user_id as string;
    }
  } catch (err) {
    console.warn(
      "[alerts/ack] audit-resolve portfolio owner failed (non-blocking):",
      err,
    );
  }

  // Sprint 6 Task 7.1b — audit the email-path ack. This route runs with
  // the admin (service-role) client because the email link carries no
  // JWT; the HMAC token is the proof of the acting user. We resolve the
  // portfolio owner id from portfolio_alerts.portfolio_id → portfolios.user_id
  // and emit via logAuditEventAsUser (which calls log_audit_event_service,
  // migration 058 — service_role-only EXECUTE). If the lookup failed we
  // skip the emission rather than attribute to a NULL user_id.
  if (ownerUserId) {
    logAuditEventAsUser(admin, ownerUserId, {
      action: "alert.acknowledge",
      entity_type: "alert",
      entity_id: guard.alert.id,
      metadata: {
        source: "email",
        alert_type: guard.alert.alert_type,
      },
    });
  }

  // Sprint 5 Task 5.5 — usage funnel event for the email-ack path.
  // The email link has no browser session, so we reuse the allocator id
  // resolved above. If the lookup failed (deleted portfolio, etc.) we
  // still fire with a synthetic distinctId of `alert:<id>` so the funnel
  // count stays accurate. Wrapped in `after` (≈ Vercel waitUntil) so the
  // runtime doesn't reap the post-response PostHog roundtrip.
  const distinctId = ownerUserId ?? `alert:${guard.alert.id}`;
  after(async () => {
    await trackUsageEventServer("alert_acknowledged", distinctId, {
      alert_id: guard.alert.id,
      alert_type: guard.alert.alert_type,
      source: "email",
    });
  });

  return NextResponse.redirect(ACK_REDIRECT.success(guard.alert.alert_type), {
    status: 303,
  });
}
