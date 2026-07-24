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

import { getCorrelationId } from "@/lib/correlation-id";
import { isSfoxEnabledServer, isMt5EnabledServer } from "@/lib/closed-sets";

const ANALYTICS_URL =
  process.env.ANALYTICS_SERVICE_URL ?? "http://localhost:8002";

export const POST = withAuth(async (req: NextRequest, user: User) => {
  const body = await req.json();
  const { exchange, api_key, api_secret, passphrase } = body;

  // SECURITY-SENSITIVE carve-out (119-CONTEXT Q1, LOCKED): sFOX authenticates with a
  // SINGLE Bearer token and carries NO api_secret (118-RESEARCH confirmed). For sfox
  // ONLY, the token is stored as api_key and the absent secret is normalized to "".
  // This relaxes credential PRESENCE for exactly one exchange — every ccxt exchange
  // (binance/okx/bybit/deribit) still requires a secret below, byte-identically. The
  // empty secret flows through the SAME validateKey/encryptKey trim chokepoint
  // (analytics-client.ts:169; trimCredential("") === ""), never a parallel path.
  // Security-reviewed (T-119-08/09/11).
  // WR-01: match sfox case-INSENSITIVELY, aligning with the create-with-key /
  // composite-add-key siblings (`exchange.toLowerCase() === "sfox"`). A caller
  // submitting the EXCHANGE_DISPLAY casing ("sFOX"/"SFOX") must hit the same
  // carve-out these routes do, not fall through to a spurious "Missing required
  // fields" 400.
  const isSfox = typeof exchange === "string" && exchange.toLowerCase() === "sfox";
  // MT5 is the MIRROR-IMAGE of the sfox carve-out (Phase 135 / MT5SRC-03):
  // where sfox RELAXES api_secret presence, mt5 REQUIRES all three credential
  // slots (login → api_key, investor password → api_secret, broker server →
  // passphrase — the slot mapping the worker's is_mt5 branch reads back). Match
  // case-INSENSITIVELY and forward the CANONICAL lowercase 'mt5' downstream: the
  // api_keys DB CHECK admits only lowercase 'mt5' and the Python /validate-key
  // intercept is an exact `== "mt5"` match, so a mixed-case value must
  // NORMALIZE, not pass through raw. ccxt exchanges are forwarded verbatim.
  const isMt5 = typeof exchange === "string" && exchange.toLowerCase() === "mt5";
  // Forward the CANONICAL lowercase 'sfox' downstream: the api_keys DB CHECK
  // admits only lowercase 'sfox' and the Python /validate-key intercept is an
  // exact `== "sfox"` match, so a mixed-case value must NORMALIZE, not pass
  // through raw. Normalization is keyed on sfox ONLY — every ccxt exchange is
  // forwarded verbatim, so ccxt behavior is byte-identical.
  const exchangeNormalized = isSfox ? "sfox" : isMt5 ? "mt5" : exchange;
  const api_secret_normalized =
    isSfox && typeof api_secret !== "string" ? "" : api_secret;

  // F2 (Phase 122 — STRUCTURAL server gate): sFOX is founder-gated until go-live.
  // The client flag NEXT_PUBLIC_SFOX_ENABLED only hides the wizard card; this
  // server flag makes a sfox CONNECT fail CLOSED until SFOX_ENABLED=true is set
  // server-side. Return a clean, honest 4xx BEFORE the rate-limit and the live
  // validate/encrypt round-trip — never a crash, never a false KEY_AUTH_FAILED,
  // never a live probe. ccxt exchanges are entirely unaffected (isSfox is false).
  if (isSfox && !isSfoxEnabledServer()) {
    return NextResponse.json(
      { error: "sFOX integration is not yet available." },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  // Phase 135 (MT5SRC-03) — STRUCTURAL server gate, mirroring the sfox F2 arm
  // above. isMt5EnabledServer() is strict `MT5_ENABLED === "true"` (closed-sets.ts,
  // NOT NEXT_PUBLIC): until go-live (Phase 139) an mt5 CONNECT fails CLOSED with
  // an honest 400 BEFORE the rate-limit and the live validate/encrypt round-trip —
  // never a crash, never a false KEY_AUTH_FAILED, never a live probe. This is
  // defense-in-depth: the worker's own mt5_enabled_server() gate + MT5_DISABLED_DETAIL
  // sit behind it, but the TS gate fires first so no probe is even attempted.
  // ccxt/sfox exchanges are unaffected (isMt5 is false).
  if (isMt5 && !isMt5EnabledServer()) {
    return NextResponse.json(
      { error: "MT5 integration is not yet available." },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  // Phase 135 (MT5SRC-03) — three-credential defense-in-depth, the MIRROR-IMAGE
  // of the sfox api_secret RELAXATION. MT5 requires ALL THREE non-blank slots
  // (login/api_key, investor password/api_secret, broker server/passphrase);
  // reject a manifestly-incomplete mt5 connect BEFORE any worker call so it
  // never burns a live probe. The worker's is_mt5 branch is the AUTHORITATIVE
  // enforcement (a login without a server fails) — this is a fail-fast, not a
  // replacement for it. Placed before the generic presence check below so the
  // passphrase requirement (which that check treats as OKX-optional) is pinned.
  if (
    isMt5 &&
    (typeof api_key !== "string" ||
      api_key.trim().length === 0 ||
      typeof api_secret !== "string" ||
      api_secret.trim().length === 0 ||
      typeof passphrase !== "string" ||
      passphrase.trim().length === 0)
  ) {
    return NextResponse.json(
      { error: "Missing required fields" },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  if (!exchange || !api_key || (!isSfox && !api_secret)) {
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
  return await legacyValidateAndEncryptHandler({ exchange: exchangeNormalized, api_key, api_secret: api_secret_normalized, passphrase });
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
      // DOGFOOD-3: after the Task-1 Python fix, genuine scope rejections and
      // probe failures arrive as curated 4xx details via the F5b forward below
      // (137-143). This branch only fires on an unknown-cause read_only:false
      // 200 that carried no error, so it must NOT assert trade/withdraw scopes
      // it never observed — the key is still rejected, only the reason stays
      // honest.
      return NextResponse.json({
        error: "This key could not be verified as read-only. Only read-only keys are accepted.",
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
