import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { assertSameOrigin } from "@/lib/csrf";
import { verifyStrategy } from "@/lib/analytics-client";
import { SUPPORTED_EXCHANGES } from "@/lib/utils";
import { publicIpLimiter, checkLimit, getClientIp } from "@/lib/ratelimit";
import { isUnifiedBackboneActive } from "@/lib/feature-flags";
import { postProcessKey } from "@/lib/process-key-client";

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

  // Phase 19 / BACKBONE-10 — gate behind unified-backbone flag.
  // Public-route protections (CSRF + IP rate-limit + payload validation)
  // run BEFORE the flag check so unified delegation cannot bypass them.
  if (await isUnifiedBackboneActive()) {
    return await unifiedVerifyStrategyHandler(body);
  }

  return await legacyVerifyStrategyHandler({
    email,
    exchange,
    api_key,
    api_secret,
    passphrase,
  });
}

/**
 * Phase 19 / BACKBONE-01 unified path. Delegates to /process-key with
 * `flow_type=teaser`. Source is the user-supplied exchange (already validated
 * against SUPPORTED_EXCHANGES above).
 *
 * CT-3 (army2) — the upstream `/process-key` teaser flow returns
 * `{verification_id, status, trust_tier, metrics_snapshot, fingerprint, ...}`
 * but does NOT mint a public_token. The landing-page <VerificationForm/>
 * (src/components/landing/VerificationForm.tsx:56) requires `data.public_token`
 * and throws "invalid response" otherwise. Without minting+returning here,
 * flipping the unified-backbone flag ON breaks the landing-page teaser flow
 * end-to-end. Mint a 32-byte base64url token, persist to strategy_verifications
 * with a 90-day expires_at (matching migration 107 M-6 policy window), and
 * return both fields alongside whatever the upstream emits.
 */
async function unifiedVerifyStrategyHandler(
  body: Record<string, unknown>,
): Promise<NextResponse> {
  const exchange = (body.exchange as string) ?? "okx";
  const result = await postProcessKey({
    flow_type: "teaser",
    source: exchange,
    // PR-X3 (post 2026-05-14 abortive flag flip) — the teaser flow has no
    // caller-owned `strategy_id` (the user is testing keys against the
    // universe of strategies; no strategy exists yet). The `/process-key`
    // validator at analytics-service/routers/process_key.py:568 raises
    // MISSING_STRATEGY_ID (422) unless either `context.strategy_id` OR
    // `context.step='validate'` is set. Without this marker, the kill-switch
    // gate-on state breaks every landing-page teaser submission. Mirrors
    // the same pattern used by strategies/csv-validate's unified handler
    // (route.ts:189) and keys/validate-and-encrypt.
    context: { ...body, step: "validate" },
    routeTag: "verify-strategy",
    // CT-4 (army2) — public/unauthenticated flow: pass literal 'public'
    // so the upstream rate limiter buckets all anonymous landing-page
    // traffic to a shared key, isolated from authenticated tenants.
    userId: "public",
  });
  if (!result.ok) return result.response;

  const upstream = (result.body ?? {}) as Record<string, unknown>;
  const verificationId =
    typeof upstream.verification_id === "string" ? upstream.verification_id : null;
  if (!verificationId) {
    return NextResponse.json(
      { error: "Verification service returned an invalid response" },
      { status: 502 },
    );
  }

  // CT-3: 32-byte base64url public_token + 90-day TTL persisted on the
  // strategy_verifications row. Falls back to a 502 if the persist fails so
  // the client never sees a token that isn't queryable.
  const publicToken = crypto.randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString();

  try {
    const admin = createAdminClient();
    // @audit-skip: unauthenticated public endpoint (no user session). The
    // strategy_verifications row carries no PII (only a public_token +
    // status), and audit_log requires a user_id which the unauthenticated
    // teaser caller cannot provide. Mirrors the legacy verify-strategy
    // path's @audit-skip rationale; landing-page-lead audit lands in
    // PostHog per ADR-0023 §3, not audit_log.
    const { error: persistError } = await admin
      .from("strategy_verifications")
      .update({ public_token: publicToken, expires_at: expiresAt })
      .eq("id", verificationId);
    if (persistError) {
      console.error(
        "[verify-strategy] CT-3 public_token persist failed:",
        persistError,
      );
      return NextResponse.json(
        { error: "Failed to finalize verification" },
        { status: 500 },
      );
    }
  } catch (err) {
    console.error("[verify-strategy] CT-3 public_token persist threw:", err);
    return NextResponse.json(
      { error: "Failed to finalize verification" },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ...upstream,
    verification_id: verificationId,
    public_token: publicToken,
    expires_at: expiresAt,
  });
}

/**
 * Legacy path preserved verbatim from the pre-Phase-19 implementation.
 * Runs when `isUnifiedBackboneActive()` returns false. Will be removed in a
 * follow-up cleanup PR after the 7-day stability window passes.
 */
// DEPRECATED: remove after 2026-05-15 (PR-D + 7d)
async function legacyVerifyStrategyHandler(args: {
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

  let analyticsResult: { verification_id?: string };
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
      const { error: upsertError } = await admin
        .from("strategy_verifications")
        .upsert(
          {
            id: verificationId,
            strategy_id: anchorStrategy.id,
            wizard_session_id: crypto.randomUUID(),
            status: "validated",
            trust_tier: "self_reported",
            flow_type: "teaser",
            source: exchange,
            public_token: publicToken,
            expires_at: expiresAt,
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
