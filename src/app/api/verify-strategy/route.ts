import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { assertSameOrigin } from "@/lib/csrf";
import { verifyStrategy } from "@/lib/analytics-client";
import { SUPPORTED_EXCHANGES } from "@/lib/utils";
import { publicIpLimiter, checkLimit, getClientIp } from "@/lib/ratelimit";

const MAX_REQUESTS_PER_DAY = 5;

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export async function POST(req: NextRequest) {
  const csrfError = assertSameOrigin(req);
  if (csrfError) return csrfError;
  // IP rate limit before any DB or Railway work
  const ip = getClientIp(req.headers);
  const rl = await checkLimit(publicIpLimiter, `verify-strategy:${ip}`);
  if (!rl.success) {
    return NextResponse.json(
      { error: "Too many requests" },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter) } },
    );
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { email, exchange, api_key, api_secret, passphrase } = body as {
    email?: string;
    exchange?: string;
    api_key?: string;
    api_secret?: string;
    passphrase?: string;
  };

  if (!email || !exchange || !api_key || !api_secret) {
    return NextResponse.json(
      { error: "Missing required fields: email, exchange, api_key, api_secret" },
      { status: 400 },
    );
  }

  if (!isValidEmail(email)) {
    return NextResponse.json({ error: "Invalid email address" }, { status: 400 });
  }

  if (!SUPPORTED_EXCHANGES.includes(exchange as (typeof SUPPORTED_EXCHANGES)[number])) {
    return NextResponse.json(
      { error: `Unsupported exchange. Supported: ${SUPPORTED_EXCHANGES.join(", ")}` },
      { status: 400 },
    );
  }

  return await teaserVerifyStrategyHandler({
    email,
    exchange,
    api_key,
    api_secret,
    passphrase,
  });
}

/**
 * Phase 19 / PR-X4 — teaser verification path.
 *
 * Background: Phase 19's unified `/process-key` backbone was designed around
 * the wizard's multi-step flow (validate → finalize). The teaser submission
 * doesn't fit that shape — it is a one-shot synchronous probe with no
 * caller-owned `strategy_id` and no follow-up step. PR-X3's attempt to
 * shoehorn the teaser into `step='validate'` got past `MISSING_STRATEGY_ID`
 * but tripped a second contract gap: `_run_validate_only` in
 * `analytics-service/routers/process_key.py` returns no `verification_id`.
 * Two consecutive 3-minute production outages during 2026-05-14 flag-flip
 * attempts confirmed the unified pipeline is structurally wrong for teaser.
 *
 * PR-X4 walks back: the teaser route always runs this handler, regardless
 * of the `process_key_unified_backbone` kill-switch. The kill-switch still
 * gates the wizard flows that legitimately go through `/process-key`
 * (onboard / resync / csv); it just no longer gates teaser.
 *
 * What this handler does:
 *   1. Per-email 5-per-24h rate limit (DEGRADES to no-op once migration 107
 *      ships and `verification_requests` becomes a VIEW with `email` mapped
 *      to NULL; the IP-based Upstash limiter at the route entry still applies).
 *   2. Call the analytics-service `/api/verify-strategy` (Python) endpoint
 *      which (post-PR-X2) no longer writes to `verification_requests` and
 *      returns `{verification_id, status, results, matched_strategy_id,
 *      twr, sharpe, return_24h, return_mtd, return_ytd}`.
 *   3. Mint a 32-byte hex `public_token` + 24h `expires_at` (TODO: bump to
 *      90 days to match migration 107's M-6 retention window).
 *   4. Upsert `strategy_verifications` at status `published` with
 *      `metrics_snapshot` populated from the Python `results` blob. PR-X4
 *      fix: previously the upsert wrote `status='validated'` with no
 *      metrics_snapshot, so the public-status route at
 *      verify-strategy/[id]/status/route.ts returned `{status:'validated'}`
 *      with no results — teaser users never saw their score.
 *   5. UPDATE `verification_requests` for backwards-compat. After migration
 *      107 ships this UPDATE hits the INSTEAD OF trigger; the error is
 *      tolerated (warning-logged) as long as the SV upsert succeeded.
 */
async function teaserVerifyStrategyHandler(args: {
  email: string;
  exchange: string;
  api_key: string;
  api_secret: string;
  passphrase?: string;
}): Promise<NextResponse> {
  const { email, exchange, api_key, api_secret, passphrase } = args;

  // Rate limit: max 5 requests per email per 24h
  const admin = createAdminClient();
  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const { count, error: countError } = await admin
    .from("verification_requests")
    .select("id", { count: "exact", head: true })
    .eq("email", email)
    .gte("created_at", twentyFourHoursAgo);

  if (countError) {
    console.error("[verify-strategy] Rate limit check failed:", countError);
    return NextResponse.json({ error: "Service unavailable" }, { status: 503 });
  }

  if ((count ?? 0) >= MAX_REQUESTS_PER_DAY) {
    return NextResponse.json(
      { error: "Rate limit exceeded. Maximum 5 verification requests per 24 hours." },
      { status: 429 },
    );
  }

  /**
   * Python `/api/verify-strategy` response shape (post-PR-X2):
   *   verification_id     — UUID generated locally by Python (uuid.uuid4())
   *   results             — JSONB blob with twr/sharpe/equity_curve/etc.
   *   matched_strategy_id — UUID of closest correlated published strategy, or null
   *   plus top-level twr / sharpe / return_24h / return_mtd / return_ytd
   *
   * `VerifyStrategyResponseSchema` (`src/lib/analytics-schemas.ts`) declares
   * `verification_id` as the only required field and uses `.passthrough()`,
   * so the extra fields flow through this typed alias without runtime parse
   * failure.
   */
  let analyticsResult: {
    verification_id?: string;
    results?: Record<string, unknown> | null;
    matched_strategy_id?: string | null;
  };
  try {
    analyticsResult = await verifyStrategy({
      email,
      exchange,
      api_key,
      api_secret,
      ...(passphrase ? { passphrase } : {}),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Verification service error";
    console.error("[verify-strategy] Analytics service error:", message);
    return NextResponse.json({ error: message }, { status: 502 });
  }

  const verificationId = analyticsResult.verification_id;
  if (!verificationId) {
    return NextResponse.json(
      { error: "Verification service returned an invalid response" },
      { status: 502 },
    );
  }

  const publicToken = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  // Phase 19 / BACKBONE-04 step (a) — `phase-19-shim-step-a` repoint.
  //
  // The legacy verification_requests UPDATE (public_token + expires_at) is
  // re-pointed to strategy_verifications. C-5: strategy_verifications has 5
  // NOT NULL columns + a strategy_id FK to strategies(id) ON DELETE CASCADE,
  // so the upsert constructs a complete row. The teaser flow has no caller-
  // owned strategies row, so we resolve the FK using the same backfill
  // pattern migration 107 STEP 2 uses (find the most recent strategies row).
  // If no strategies row exists at all (cold-start prod), the upsert is
  // skipped — the legacy verification_requests UPDATE preserves runtime
  // correctness during the PR-A → PR-D window. After migration 107 ships
  // (PR-D), the verification_requests VIEW reads from strategy_verifications
  // and the legacy UPDATE becomes a no-op via INSTEAD OF triggers.
  let strategyVerificationsUpserted = false;
  try {
    const { data: anchorStrategy } = await admin
      .from("strategies")
      .select("id")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (anchorStrategy?.id) {
      // C-5: every NOT NULL column populated; FK satisfied via anchor row.
      // @audit-skip: unauthenticated public endpoint (no user session). The
      // strategy_verifications row is the canonical write target post-PR-A
      // for the landing-page teaser flow; the row carries no PII (only a
      // public_token + status), and audit_log requires a user_id which the
      // unauthenticated caller cannot provide. Follow-up landing-page-lead
      // audit lands in PostHog per ADR-0023 §3, not audit_log.
      // PR-X4: status='published' (was 'validated' which the public-status
      // route does NOT recognize as terminal → results never surface).
      // The [id]/status route at line 107 accepts BOTH 'complete' (legacy
      // VR shape) AND 'published' (canonical SV terminal per migration 103).
      //
      // metrics_snapshot: PR-X4 fix — was null, leaving the user with a
      // status row but no score on the public-status URL. The Python
      // verify_strategy endpoint returns the full results blob in
      // `analyticsResult.results` (sanitize_metrics output). Include
      // matched_strategy_id alongside since it's not a first-class SV
      // column.
      const metricsSnapshot = analyticsResult.results
        ? {
            ...analyticsResult.results,
            matched_strategy_id: analyticsResult.matched_strategy_id ?? null,
          }
        : null;
      const { error: upsertError } = await admin
        .from("strategy_verifications")
        .upsert(
          {
            id: verificationId,
            strategy_id: anchorStrategy.id,
            wizard_session_id: crypto.randomUUID(),
            status: "published",
            trust_tier: "self_reported",
            flow_type: "teaser",
            source: exchange,
            public_token: publicToken,
            expires_at: expiresAt,
            metrics_snapshot: metricsSnapshot,
          },
          { onConflict: "id" },
        );
      if (upsertError) {
        // Don't fail the request — the legacy UPDATE below preserves
        // correctness. Surface to Sentry via console.error so the
        // stability-log can spot trends.
        console.error(
          "[verify-strategy] phase-19-shim-step-a strategy_verifications upsert failed:",
          upsertError,
        );
      } else {
        strategyVerificationsUpserted = true;
      }
    } else {
      console.warn(
        "[verify-strategy] phase-19-shim-step-a skipped — no strategies row available to anchor FK",
      );
    }
  } catch (svErr) {
    console.error(
      "[verify-strategy] phase-19-shim-step-a strategy_verifications upsert threw:",
      svErr,
    );
  }

  // Phase 19 stability-window dual-write: keep the legacy UPDATE alive
  // until migration 107 ships (PR-D). After that, this UPDATE hits the
  // VIEW + INSTEAD OF UPDATE trigger which raises a guard error — by
  // then the upsert above is canonical. The pragma below is the same
  // ADR-0023 §3 reasoning as the upsert above (unauthenticated teaser).
  // @audit-skip: unauthenticated public endpoint (no user session). The
  // verification_requests row is internal-state plumbing for the landing-
  // page "verify my track record" flow; audit_log requires a user_id and
  // this caller has none. Follow-up landing-page-lead audit lands in
  // PostHog per ADR-0023 §3, not audit_log.
  const { error: updateError } = await admin
    .from("verification_requests")
    .update({ public_token: publicToken, expires_at: expiresAt })
    .eq("id", verificationId);

  if (updateError && !strategyVerificationsUpserted) {
    // Only fail if BOTH writes failed — the strategy_verifications upsert
    // is the new canonical target; if it succeeded, the request is fine.
    console.error("[verify-strategy] Failed to set public token:", updateError);
    return NextResponse.json({ error: "Failed to finalize verification" }, { status: 500 });
  }
  if (updateError) {
    console.warn(
      "[verify-strategy] legacy verification_requests UPDATE failed (strategy_verifications upsert OK):",
      updateError,
    );
  }

  return NextResponse.json({ verification_id: verificationId, public_token: publicToken });
}
