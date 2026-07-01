import { NextRequest, NextResponse } from "next/server";
import {
  validateKey,
  encryptKey,
  AnalyticsUpstreamError,
  AnalyticsTimeoutError,
} from "@/lib/analytics-client";
import { captureToSentry } from "@/lib/sentry-capture";
import { withAuth } from "@/lib/api/withAuth";
import { NO_STORE_HEADERS } from "@/lib/api/headers";
import { userActionLimiter, checkLimit } from "@/lib/ratelimit";
import type { User } from "@supabase/supabase-js";

// NOTE: imports preserved for the unified handler below; suppress unused-import
// lint while the unified branch is intentionally dormant (see API-2 comment).
import { isUnifiedBackboneActive } from "@/lib/feature-flags";
import { getCorrelationId } from "@/lib/correlation-id";
void isUnifiedBackboneActive;
void getCorrelationId;

const ANALYTICS_URL =
  process.env.ANALYTICS_SERVICE_URL ?? "http://localhost:8002";

export const POST = withAuth(async (req: NextRequest, user: User) => {
  const body = await req.json();
  const { exchange, api_key, api_secret, passphrase } = body;

  if (!exchange || !api_key || !api_secret) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400, headers: NO_STORE_HEADERS });
  }

  const rl = await checkLimit(userActionLimiter, `keys-validate-encrypt:${user.id}`);
  if (!rl.success) {
    return NextResponse.json(
      { error: "Too many requests" },
      { status: 429, headers: { ...NO_STORE_HEADERS, "Retry-After": String(rl.retryAfter) } },
    );
  }

  // Phase 19 / API-2 — DO NOT delegate to /process-key for validate-and-encrypt.
  //
  // Why this route is locked to the legacy path even when the unified-backbone
  // flag is on:
  // The allocator client (src/components/exchanges/AllocatorExchangeManager.tsx)
  // reads `result.api_key_encrypted` / `result.api_secret_encrypted` /
  // `result.passphrase_encrypted` / `result.dek_encrypted` / `result.nonce` /
  // `result.kek_version` from the response and persists them to api_keys.
  // The unified `/process-key` validate step returns
  // `{ ok, valid, read_only, correlation_id, step }` — there is NO encryption
  // payload. Delegating here would silently drop those fields and the
  // allocator would write all-NULL ciphertext to api_keys.
  //
  // TODO(phase-19+): once /process-key gains an encrypt branch (or a separate
  // /process-key/encrypt endpoint that returns the same envelope shape as
  // legacy encryptKey), restore the flag-gated unified handler below and
  // route through it. Tracked under the unified-encrypt deferred work item.
  return await legacyValidateAndEncryptHandler({ exchange, api_key, api_secret, passphrase });
});

/**
 * Phase 19 / BACKBONE-01 unified path. Delegates to /process-key with
 * `flow_type=onboard`. Source is taken from the request body — the wizard's
 * Connect step picks an exchange before submitting.
 */
async function _unifiedValidateAndEncryptHandler(args: {
  exchange: string;
  api_key: string;
  api_secret: string;
  passphrase?: string;
  userId: string;
}): Promise<NextResponse> {
  const internalToken = process.env.INTERNAL_API_TOKEN;
  if (!internalToken) {
    console.error("[keys/validate-and-encrypt] INTERNAL_API_TOKEN not configured");
    return NextResponse.json({ error: "Service unavailable" }, { status: 503, headers: NO_STORE_HEADERS });
  }

  const correlationId = await getCorrelationId();
  const res = await fetch(`${ANALYTICS_URL}/process-key`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${internalToken}`,
      "X-Correlation-Id": correlationId,
    },
    body: JSON.stringify({
      flow_type: "onboard",
      source: args.exchange,
      context: {
        exchange: args.exchange,
        api_key: args.api_key,
        api_secret: args.api_secret,
        passphrase: args.passphrase,
        user_id: args.userId,
        step: "validate",
      },
    }),
    cache: "no-store",
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    return NextResponse.json(err, { status: res.status, headers: NO_STORE_HEADERS });
  }
  return NextResponse.json(await res.json(), { headers: NO_STORE_HEADERS });
}

/**
 * Legacy path preserved verbatim from the pre-Phase-19 implementation.
 *
 * NOTE (M-9): this branch is the ONLY active code path on this route — the
 * unified handler is intentionally dormant pending the deferred encrypt
 * branch (see API-2 comment in POST). The deprecation date below applies to
 * the unified-handler decision, not to this function which stays around
 * until /process-key gains an encrypt step.
 */
// DEPRECATED: remove after unified encrypt branch lands (deferred from PR-D)
async function legacyValidateAndEncryptHandler(args: {
  exchange: string;
  api_key: string;
  api_secret: string;
  passphrase?: string;
}): Promise<NextResponse> {
  const { exchange, api_key, api_secret, passphrase } = args;
  try {
    // Validate and encrypt atomically to prevent TOCTOU race
    const validation = await validateKey(exchange, api_key, api_secret, passphrase);
    if (!validation.read_only) {
      return NextResponse.json({
        error: "This key has trading or withdrawal permissions. Only read-only keys are accepted.",
      }, { status: 400, headers: NO_STORE_HEADERS });
    }

    const encrypted = await encryptKey(exchange, api_key, api_secret, passphrase);
    return NextResponse.json({ ...encrypted, valid: true, read_only: true }, { headers: NO_STORE_HEADERS });
  } catch (err) {
    // F5b (R8): forward the CURATED 4xx detail from the Python validator
    // (e.g. "Invalid API credentials", "Key has IP restrictions") so the
    // user can fix their key — but never echo a raw 5xx traceback, crypto
    // internal, or contract-violation string. Mirrors the bridge / simulator
    // 4xx-forward / 5xx-redact pattern F5a established.
    if (
      err instanceof AnalyticsUpstreamError &&
      err.status >= 400 &&
      err.status < 500
    ) {
      return NextResponse.json({ error: err.message }, { status: err.status, headers: NO_STORE_HEADERS });
    }
    if (err instanceof AnalyticsTimeoutError) {
      return NextResponse.json(
        { error: "Key validation timed out. Please try again." },
        { status: 504, headers: NO_STORE_HEADERS },
      );
    }
    console.error("[keys/validate-and-encrypt] validation failed:", err);
    captureToSentry(err, { tags: { route: "api/keys/validate-and-encrypt" } });
    return NextResponse.json(
      { error: "Key validation failed. Please try again." },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }
}
