import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { assertSameOrigin } from "@/lib/csrf";
import { SUPPORTED_EXCHANGES } from "@/lib/utils";
import { publicIpLimiter, checkLimit, getClientIp } from "@/lib/ratelimit";
import { postProcessKey } from "@/lib/process-key-client";

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export async function POST(req: NextRequest) {
  const csrfError = assertSameOrigin(req);
  if (csrfError) return csrfError;
  // IP rate limit before any DB or Railway work.
  // B15 limit-first: public/unauthenticated per-IP surface — rate-limit BEFORE
  // body validation is intentional (reject a scraper/flood cheaply before
  // parsing). See limiter-ordering.test.ts PUBLIC_IP_EXCEPTION.
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

  const { email, exchange, api_key, api_secret } = body as {
    email?: string;
    exchange?: string;
    api_key?: string;
    api_secret?: string;
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

  // Phase 106 Stage B (D2): the unified backbone is the sole verify path.
  // Public-route protections (CSRF + IP rate-limit + payload validation) run
  // above, before delegation. The former flag-off legacyVerifyStrategyHandler
  // arm was deleted — isUnifiedBackboneActive()===false is dormant with the
  // ratified prod pins.
  return await unifiedVerifyStrategyHandler(body);
}

/**
 * H-04 (red-team HIGH): sanitize a metrics_snapshot value received from the
 * Railway process-key service before returning it to an unauthenticated caller.
 *
 * Allowed leaf types: number | string | boolean | null.
 * Arrays and plain objects are walked recursively; any leaf that does not
 * satisfy the allowed types is replaced with null so the shape is preserved
 * without leaking opaque blobs.
 *
 * This is intentionally strict: a Railway regression that embeds an object
 * with sensitive fields (api_key, tokens, etc.) inside a metric key produces
 * null at that key rather than a passthrough.
 */
function sanitizeMetricsSnapshot(value: unknown): unknown {
  if (
    value === null ||
    typeof value === "number" ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(sanitizeMetricsSnapshot);
  }
  if (typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      result[k] = sanitizeMetricsSnapshot(v);
    }
    return result;
  }
  // Drop functions, symbols, undefined, etc.
  return null;
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
  // PR-X5 (2026-05-15) security fix — DO NOT spread the raw body into
  // context. This endpoint is unauthenticated public input. Spreading
  // would let an attacker pre-supply `strategy_id`, `wizard_session_id`,
  // `user_id`, `step`, etc. The Python dispatch at process_key.py only
  // injects the sentinel anchor when those fields are absent, so a
  // pre-supplied strategy_id bypasses the sentinel — writing an SV row
  // anchored to an arbitrary (possibly victim-owned) strategy with
  // attacker-controlled metrics_snapshot. Defense in depth: allowlist
  // the fields the teaser flow actually needs. Python further enforces
  // unconditional overwrite for flow_type='teaser' (process_key.py).
  const teaserContext: Record<string, unknown> = {
    email: body.email,
    exchange: body.exchange,
    api_key: body.api_key,
    api_secret: body.api_secret,
  };
  if (body.passphrase !== undefined) {
    teaserContext.passphrase = body.passphrase;
  }
  const result = await postProcessKey({
    flow_type: "teaser",
    source: exchange,
    // PR-X5 — the PR-X3 workaround `step: "validate"` is no longer
    // needed because process_key.py injects the sentinel teaser-anchor
    // strategy_id (migration 132) for `flow_type === "teaser"` BEFORE
    // the step check. With it stripped, the unified pipeline runs
    // end-to-end and returns `verification_id` + `status: "published"`.
    context: teaserContext,
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

  // M-03 (red-team MEDIUM): createAdminClient() was moved outside try/catch
  // to "fail loud" on config errors. But in this unauthenticated public route
  // an unhandled throw produces a framework-caught 500 that may expose the
  // stack trace or env var name to callers. Use explicit catch-and-rethrow
  // with a structured 500 body so config failures are loud in logs/Sentry
  // without leaking internals to the unauthenticated browser.
  let admin: ReturnType<typeof createAdminClient>;
  try {
    admin = createAdminClient();
  } catch (configErr) {
    console.error("[verify-strategy] createAdminClient config error:", configErr);
    return NextResponse.json(
      { error: "Verification service misconfigured" },
      { status: 500 },
    );
  }
  // @audit-skip: unauthenticated public endpoint (no user session). The
  // strategy_verifications row carries no PII (only a public_token +
  // status), and audit_log requires a user_id which the unauthenticated
  // teaser caller cannot provide. Mirrors the legacy verify-strategy
  // path's @audit-skip rationale; landing-page-lead audit lands in
  // PostHog per ADR-0023 §3, not audit_log.
  //
  // NEW-C35-02 (red-team M conf=8): force trust_tier="self_reported" for the
  // teaser flow, flag-invariant. The upstream /process-key sets "api_verified"
  // for any non-csv source (teaser is always a real exchange), but an unproven
  // landing-page key has not been verified against a real strategy — badging it
  // "api_verified" violates the no-invented-data trust chain. Override the tier
  // to "self_reported" here so the persisted grade is identical regardless of
  // which backbone path executed.
  // @audit-skip: unauthenticated public endpoint — no user_id available (see full rationale above).
  try {
    const { error: persistError } = await admin
      .from("strategy_verifications")
      .update({
        public_token: publicToken,
        expires_at: expiresAt,
        trust_tier: "self_reported",
      })
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

  // NEW-C35-01 (red-team H conf=8): never spread the raw upstream body.
  // The upstream /process-key teaser response includes `encrypted_credentials`
  // (KEK-wrapped api_key/secret/passphrase), `fingerprint`, and other internal
  // fields. Spreading them all echoed credential ciphertext to an unauthenticated
  // browser. Mirror the legacy path's explicit allowlist — return only the fields
  // the landing form actually needs.
  const responseBody: Record<string, unknown> = {
    verification_id: verificationId,
    public_token: publicToken,
    expires_at: expiresAt,
  };
  // H-04 (red-team HIGH): metrics_snapshot was passed through as `unknown`
  // with no shape validation. If the Railway process-key service embeds
  // sensitive fields (api_key, api_secret, internal tokens) inside
  // metrics_snapshot — due to a bug or compromise — they would leak to
  // unauthenticated browsers. The allowlist for the outer response body
  // provides no protection for nested objects.
  //
  // Fix: walk metrics_snapshot and allow ONLY numeric, boolean, string, null,
  // or arrays/objects whose leaves also satisfy those types. Any key whose
  // value is a nested object or array is recursively sanitised; any non-
  // primitive leaf that is not a number/string/boolean/null is dropped.
  // This enforces the invariant "metrics are numbers/strings" at this
  // boundary regardless of the Railway service's internals.
  if (upstream.metrics_snapshot !== undefined) {
    responseBody.metrics_snapshot = sanitizeMetricsSnapshot(upstream.metrics_snapshot);
  }
  // status is informational and contains no credentials.
  if (typeof upstream.status === "string") {
    responseBody.status = upstream.status;
  }
  return NextResponse.json(responseBody);
}
