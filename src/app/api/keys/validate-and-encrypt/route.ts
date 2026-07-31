import { NextRequest, NextResponse } from "next/server";
import {
  validateKey,
  encryptKey,
  AnalyticsUpstreamError,
  AnalyticsTimeoutError,
} from "@/lib/analytics-client";
import { CircuitOpenError, SeamBodyReadError } from "@/lib/seam-errors";
import { CIRCUIT_OPEN_COPY } from "@/lib/seam-copy";
// 140.3-G4 / SEAMUX-03 — reads the upstream's own machine code off a forwarded
// body so the legacy-forward arm preserves it rather than overwriting.
import { seamErrorCode } from "@/lib/seam-discriminator";
import { resilientFetch } from "@/lib/resilient-fetch";
import { captureToSentry } from "@/lib/sentry-capture";
import { scrubSeamError } from "@/lib/seam-redaction";
import { withAuth } from "@/lib/api/withAuth";
import { NO_STORE_HEADERS } from "@/lib/api/headers";
import { userActionLimiter, checkLimit, rateLimitDenyJson } from "@/lib/ratelimit";
import type { User } from "@supabase/supabase-js";

import { getCorrelationId } from "@/lib/correlation-id";
import { isSfoxEnabledServer, isMt5EnabledServer } from "@/lib/closed-sets";

/**
 * Phase 140 / SEAM-02 — pinned for clarity; declared counterpart of this
 * route's `SEAM_ROUTE_BUDGETS` row in `src/lib/resilient-fetch.ts`.
 *
 * 300 is the project's VERIFIED effective Vercel default
 * (`defaultResourceConfig.functionDefaultTimeout: 300`, read from the live
 * project settings on 2026-07-25), so declaring it here cannot RAISE this
 * route's worst-case lambda hold (threat T-140-29). It exists so the SC-4b
 * headroom invariant has an in-repo source of truth instead of a
 * dashboard-changeable assumption. This route is the widest of the five: the
 * live path spends `validate-key` then `encrypt-key` BACK TO BACK (30s + 30s,
 * they sum per request), and the dormant unified handler below nominally adds
 * a third — still 5× headroom.
 */
export const maxDuration = 300;

// Phase 140.3 / SEAMUX-01 — the breaker body is NOT declared here. It is the
// ONE constant in `@/lib/seam-copy`, imported above, which every seam emitter
// reads. The leaf's header carries the constraint that matters most on THIS
// route: the copy must never blame the user's key for an outage in which no
// request to the exchange was ever issued.

export const POST = withAuth(async (req: NextRequest, user: User) => {
  const body = await req.json();
  const { exchange, api_key, api_secret, passphrase } = body;

  // SECURITY-SENSITIVE carve-out (119-CONTEXT Q1, LOCKED): sFOX authenticates with a
  // SINGLE Bearer token and carries NO api_secret (118-RESEARCH confirmed). For sfox
  // ONLY, the token is stored as api_key and the absent secret is normalized to "".
  // This relaxes credential PRESENCE for exactly one exchange — every ccxt exchange
  // (binance/okx/bybit/deribit) still requires a secret below, byte-identically. The
  // empty secret flows through the SAME validateKey/encryptKey trim chokepoint
  // (`trimCredential` in analytics-client.ts; trimCredential("") === ""), never a parallel path.
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
  // ── Phase 140.3-G4 / SEAMUX-03 — a machine code on EVERY error arm this
  // route emits, so a client discriminates the fault on a stable token instead
  // of sniffing prose. The four request-shape rejections all answer
  // KEY_INVALID_FORMAT (create-with-key's exact token for the same facts, two
  // of them byte-identical sentences). Response bodies only — this route's
  // request body carries RAW key material (SEAMCORE-06).
  if (isSfox && !isSfoxEnabledServer()) {
    return NextResponse.json(
      { error: "sFOX integration is not yet available.", code: "KEY_INVALID_FORMAT" },
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
      { error: "MT5 integration is not yet available.", code: "KEY_INVALID_FORMAT" },
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
      { error: "Missing required fields", code: "KEY_INVALID_FORMAT" },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  if (!exchange || !api_key || (!isSfox && !api_secret)) {
    return NextResponse.json({ error: "Missing required fields", code: "KEY_INVALID_FORMAT" }, { status: 400, headers: NO_STORE_HEADERS });
  }

  const rl = await checkLimit(userActionLimiter, `keys-validate-encrypt:${user.id}`);
  if (!rl.success) {
    // 140.4-13 / SEAMRIM-05 — deny through the chokepoint so a limiter
    // misconfiguration answers 503. The 429 body is the builder's default,
    // byte-identical to what was inlined here; NO_STORE_HEADERS is kept.
    //
    // 140.3-G4 / SEAMUX-03 — the builder's DEFAULT deny bodies are codeless, so
    // pass overrides carrying the byte-identical sentence PLUS a code (exactly
    // keys/sync:136-158 / create-with-key:240-243). KEY_RATE_LIMIT (not
    // RATE_LIMITED) because this is the key-connect family and its two
    // already-coded siblings both chose it — one fact, one token within the
    // family. SEAM_MISCONFIGURED on the 503 outage arm.
    return rateLimitDenyJson(rl, {
      headers: NO_STORE_HEADERS,
      throttledBody: { error: "Too many requests", code: "KEY_RATE_LIMIT" },
      misconfiguredBody: {
        error: "Rate limiter unavailable",
        code: "SEAM_MISCONFIGURED",
      },
    });
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
  // TS-04 / SC7 — `userId` is threaded into the legacy handler (rather than
  // re-derived inside it) so the tenant identity provably comes from THIS
  // route's withAuth session and cannot drift to a body field.
  return await legacyValidateAndEncryptHandler({ exchange: exchangeNormalized, api_key, api_secret: api_secret_normalized, passphrase, userId: user.id });
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
    // 140.3-G4 / SEAMUX-03 — a missing internal token is OUR config fault
    // (SEAM_MISCONFIGURED). This handler is DORMANT (zero callers); coded anyway
    // so a reviver inherits the correct behaviour, not the 2026 codeless one.
    return NextResponse.json({ error: "Service unavailable", code: "SEAM_MISCONFIGURED" }, { status: 503, headers: NO_STORE_HEADERS });
  }

  const correlationId = await getCorrelationId();
  // Phase 140 / SEAM-01 (threat T-140-19). This call used to be a RAW fetch
  // against a route-local analytics base-URL constant, with NO timeout at all —
  // the last unbounded Vercel→Railway call. (That constant's name is
  // deliberately not spelled out: the greps and the Wave-4 ESLint rule that
  // prove it is gone would otherwise match this very comment.) It is dormant
  // today — this handler has zero callers — which is exactly why it was routed
  // through the core rather than left alone: whoever revives it inherits a
  // budget and the breaker automatically, instead of re-introducing an
  // unbounded hang that holds a Vercel concurrency slot until the function
  // ceiling. Headers and body are preserved verbatim; only the transport
  // changed.
  const res = await resilientFetch("process-key-unified-dormant", "/process-key", {
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
    // SEAMCORE-02, same distinction as every other seam body read: an absent or
    // unparseable body keeps the `{}` fallback; an ABORT does not become a
    // fabricated body, because the core has already recorded it as a breaker
    // failure. This handler is dormant (zero callers today) and is fixed anyway
    // — leaving one member of the class unfixed is the instance-not-class
    // defect this programme has paid for repeatedly, and whoever revives it
    // inherits the correct behaviour rather than the 2026 one.
    const err = await res.json().catch((readErr: unknown) => {
      if (readErr instanceof SeamBodyReadError) throw readErr;
      return {};
    });
    // 140.3-G4 / SEAMUX-03 — forward the upstream body but ensure it carries a
    // TOP-LEVEL code: preserve the upstream's own (`body.code`, else
    // `seamErrorCode(body)`), falling back to UNKNOWN only when it genuinely
    // carried none. NEVER overwrite an upstream-carried code. (Dormant handler.)
    const forwardBody =
      typeof err === "object" && err !== null
        ? (err as Record<string, unknown>)
        : {};
    const forwardCode =
      (typeof forwardBody.code === "string" && forwardBody.code) ||
      seamErrorCode(forwardBody) ||
      "UNKNOWN";
    return NextResponse.json(
      { ...forwardBody, code: forwardCode },
      { status: res.status, headers: NO_STORE_HEADERS },
    );
  }
  // The success-arm read propagates its typed failure to this handler's caller,
  // deliberately: there is no caller to give a softer answer to.
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
  /**
   * TS-04 / SC7 — the caller's authenticated `user.id`, taken from the POST
   * handler's `withAuth` session. Required, so this dormant-but-live path
   * cannot be the one member of the class that stays on a platform bucket.
   */
  userId: string;
}): Promise<NextResponse> {
  const { exchange, api_key, api_secret, passphrase, userId } = args;
  try {
    // Validate and encrypt atomically to prevent TOCTOU race
    const validation = await validateKey(exchange, api_key, api_secret, passphrase, { userId });
    if (!validation.read_only) {
      // DOGFOOD-3: after the Task-1 Python fix, genuine scope rejections and
      // probe failures arrive as curated 4xx details via the F5b forward below
      // (137-143). This branch only fires on an unknown-cause read_only:false
      // 200 that carried no error, so it must NOT assert trade/withdraw scopes
      // it never observed — the key is still rejected, only the reason stays
      // honest.
      // 140.3-G4 / SEAMUX-03 — KEY_NOT_READ_ONLY (union member; its docblock
      // describes this exact fact: read-only unconfirmed, no write scope observed).
      return NextResponse.json({
        error: "This key could not be verified as read-only. Only read-only keys are accepted.",
        code: "KEY_NOT_READ_ONLY",
      }, { status: 400, headers: NO_STORE_HEADERS });
    }

    const encrypted = await encryptKey(exchange, api_key, api_secret, passphrase, { userId });
    return NextResponse.json({ ...encrypted, valid: true, read_only: true }, { headers: NO_STORE_HEADERS });
  } catch (err) {
    // Phase 140 / SEAM-04 — the breaker arm, FIRST among the typed arms.
    //
    // On THIS route the cascade was not merely the wrong status: a breaker trip
    // used to surface as "Key validation failed. Please try again.", telling
    // the user their credentials are at fault when no request ever left Vercel.
    // 503 + a cooldown is both honest and actionable.
    //
    // ⚠️ Placement: INSIDE the handler chain, downstream of `withAuth` and the
    // rate limiter (threat T-140-20) — a breaker-aware branch above the auth
    // gate would turn "is Railway degraded right now?" into an unauthenticated
    // oracle.
    //
    // ⚠️ `CircuitOpenError` comes from the dependency-free leaf
    // `@/lib/seam-errors`, never through `@/lib/analytics-client`: this route's
    // test mocks that module wholesale, and a class read through a mocked
    // module is `undefined` — `err instanceof undefined` throws a TypeError
    // from inside this very catch block (threat T-140-30).
    //
    // No `captureToSentry`: a breaker trip is a shared infrastructure state,
    // so capturing would emit one event per request for the whole cooldown
    // window. Same stance as the 4xx-forward and 504 arms below.
    if (err instanceof CircuitOpenError) {
      console.error(
        `[keys/validate-and-encrypt] circuit open — short-circuited, retry in ${err.retryAfterS}s`,
      );
      // 140.3-G4 / SEAMUX-03 — CIRCUIT_OPEN, the wire token process-key-client
      // emits for this fact and the client-side map already recognises. The
      // CIRCUIT_OPEN_COPY sentence and Retry-After header stay byte-unchanged.
      return NextResponse.json(
        { error: CIRCUIT_OPEN_COPY, code: "CIRCUIT_OPEN" },
        {
          status: 503,
          headers: {
            ...NO_STORE_HEADERS,
            // Same pairing as this route's own 429 arm.
            "Retry-After": String(err.retryAfterS),
          },
        },
      );
    }
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
      // 140.3-G4 / SEAMUX-03 — preserve the upstream's own machine code
      // (`err.seamCode`, analytics-client.ts:119), UNKNOWN only when it carried
      // none. Never overwrite an upstream-carried code.
      return NextResponse.json(
        { error: err.message, code: err.seamCode ?? "UNKNOWN" },
        { status: err.status, headers: NO_STORE_HEADERS },
      );
    }
    if (err instanceof AnalyticsTimeoutError) {
      // 140.3-G4 / SEAMUX-03 — UPSTREAM_TIMEOUT (the wire token for OUR analytics
      // hop timing out; NOT KEY_NETWORK_TIMEOUT, which asserts the EXCHANGE was
      // unreachable — a fact not observed here).
      return NextResponse.json(
        { error: "Key validation timed out. Please try again.", code: "UPSTREAM_TIMEOUT" },
        { status: 504, headers: NO_STORE_HEADERS },
      );
    }
    // SEAMCORE-06 / T-140.2-08-03 — THE credential-bearing path. This route's
    // request body carries the RAW exchange `api_key`, `api_secret` and
    // `passphrase`; a wrapper that stringifies the request init into a message,
    // or an undici error that inlines the outgoing headers, puts them straight
    // into this line and into Sentry. No module-level env list can know them,
    // so they are named explicitly at both sinks.
    const perRequestSecrets = [api_key, api_secret, passphrase];
    console.error(
      "[keys/validate-and-encrypt] validation failed:",
      scrubSeamError(err, perRequestSecrets),
    );
    captureToSentry(err, {
      tags: { route: "api/keys/validate-and-encrypt" },
      secrets: perRequestSecrets,
    });
    // 140.3-G4 / SEAMUX-03 — UNKNOWN, the repo's terminal/unclassified fallback
    // (create-with-key's terminal precedent).
    return NextResponse.json(
      { error: "Key validation failed. Please try again.", code: "UNKNOWN" },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }
}
