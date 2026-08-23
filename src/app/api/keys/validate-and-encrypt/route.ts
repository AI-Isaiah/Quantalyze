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
// 160-02 / RANK-03 — the service-role writer for the persist arm. Same factory
// the sibling connect routes use (the `createAdminClient` import in
// `create-with-key/route.ts`); it THROWS when
// SUPABASE_SERVICE_ROLE_KEY is absent, which the persist arm answers honestly.
import { createAdminClient } from "@/lib/supabase/admin";
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

/**
 * 160-02 / RANK-03 — the cap on a persist-mode `label`.
 *
 * Before this phase the label was written by the browser's own INSERT and was
 * bounded by nothing this codebase controlled. In persist mode it becomes
 * SERVER-written text rendered back into the key list, so it gets an explicit
 * length bound (ASVS V5). 120 is one notch above the sibling connect route's
 * 100-char `KEY_INPUT_TOO_LONG` label rejection in `create-with-key/route.ts`
 * because this
 * arm TRUNCATES rather than rejects — see the persist arm for why a cosmetic
 * string must not fail an already-validated connect.
 */
const MAX_KEY_LABEL_LENGTH = 120;

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
  //
  // ── 160-05 / RANK-03 — THE PERSIST DISCRIMINATOR, now a GATE rather than a
  // fork. `persist === true` is a STRICT boolean comparison and the strictness
  // is still the whole point, but what the other branch does has changed.
  //
  // During the soak window it fell through to a legacy arm that handed the
  // ciphertext back so a stale tab could INSERT for itself. That window is
  // CLOSED: `20260823120000_revoke_api_keys_insert` withdrew INSERT on
  // `api_keys` from `anon` and `authenticated`, so a stale tab's own INSERT now
  // dies at the table with a bare 42501. Serving it the ciphertext first would
  // ship encrypted key material to a browser that provably cannot do anything
  // with it — so the refusal below is both the honest answer and the narrower
  // blast radius. No arm of this route returns ciphertext to any caller.
  //
  // STRICTNESS still earns its keep: a truthy `"true"` / `1` that some future
  // caller stringified must NOT be read as consent to write a row. It lands
  // here, on the refusal, not on the writer. (threat T-160-06)
  if (body.persist !== true) {
    return NextResponse.json({
      error:
        "This page is out of date and can no longer add keys. Reload the page and try again.",
      code: "STALE_CLIENT",
    }, { status: 409, headers: NO_STORE_HEADERS });
  }
  return await legacyValidateAndEncryptHandler({ exchange: exchangeNormalized, api_key, api_secret: api_secret_normalized, passphrase, userId: user.id, label: body.label });
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
    // No retry, stated explicitly (D-08). This handler is the shape bucket C1
    // named: a HAND-PICKED budget key alongside a HAND-WRITTEN `flow_type`. The
    // audited retry verdict for a flow lives in `RETRY_SAFE_FLOW_TYPES` and is
    // read by `postProcessKey`, which this dormant handler bypasses — so it may
    // not claim that flow's retry, and now it cannot acquire one by accident
    // either.
    retriesOverride: 0,
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
 *
 * ── 160-05 / RANK-03: this function serves the PERSIST arm only. It writes
 * the `api_keys` row here on the server and returns `{ api_key_id }`. The
 * legacy ciphertext arm it briefly shared a body with is GONE — POST refuses
 * absent-discriminator bodies with `STALE_CLIENT` before reaching here, so
 * there is no longer a code path on this route that returns key material to a
 * caller.
 *
 * It stays ONE body rather than splitting: the rate limiter, the sfox/mt5
 * gates, the presence checks, the breaker arm, the curated-4xx forward, the
 * timeout arm and the scrubbed terminal arm all police this arm. Duplicating
 * the seam calls into a parallel handler is exactly how one arm silently loses
 * a control (threat T-160-09).
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
  /**
   * 160-02 / RANK-03 — the caller's optional display label, UNVALIDATED. It is
   * typed `unknown` on purpose: it arrives straight off the request body and
   * is normalized (trim + 120-char cap + server default) inside the persist
   * arm before it can become server-written text.
   */
  label?: unknown;
}): Promise<NextResponse> {
  const { exchange, api_key, api_secret, passphrase, userId, label } = args;
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

    // ⛔ 160-05 — THE LEGACY ARM WAS HERE and is deliberately not coming back.
    // It returned `{ ...encrypted, valid: true, read_only: true }` so the
    // browser could INSERT for itself. `REVOKE INSERT` closed that door at the
    // table; re-adding a ciphertext response would hand out key material no
    // caller can use. If a future caller needs the envelope, it needs a
    // service-role writer, not this route's response body.

    // ── PERSIST ARM (160-02 / RANK-03) ────────────────────────────────────
    //
    // ⭐ THE ONE BINDING. `exchange` here is the value THIS route normalized at
    // the top of POST (the sfox/mt5 canonicalization), and which `validateKey`
    // then authenticated against the live venue two statements ago. Both venue
    // columns below are written from this single local — never two reads of the
    // body, never the raw client string. A divergent `exchange` /
    // `attested_venue` pair is therefore impossible AT THE WRITER, and
    // independently impossible AT THE DB (the CHECK
    // `api_keys_attested_venue_matches_exchange`, migration 20260811210000).
    // The BEFORE INSERT scrub trigger NULLs `attested_venue` for
    // non-privileged writers but admits `service_role` by name, so the value
    // supplied here survives.
    //
    // ⛔ THE CEILING, AND DO NOT EXCEED IT. What this establishes is that the
    // venue is the one this server observed a successful read-only
    // authentication at. NEVER write "the venue cannot be forged": any server
    // route holding `createAdminClient()` can still pass any uid and any venue
    // string. That is the standing `service_role` trust boundary
    // (ADR-0001/ADR-0003) and this phase does not change it. What changes is
    // exactly this: "any browser session can forge an attestation" becomes
    // "only our own server code can". (threat T-160-07, accepted)
    const exchangeNormalized = exchange;

    // The label becomes SERVER-WRITTEN text, so it is normalized here rather
    // than trusted: trim, then CAP (not reject) at MAX_KEY_LABEL_LENGTH. The
    // cap is deliberate — a cosmetic display string must never fail a connect
    // whose credentials already validated against the live venue. An absent or
    // whitespace-only label falls back to the same server default the sibling
    // connect route uses (its own `labelOrDefault` binding in
    // `create-with-key/route.ts`).
    const labelTrimmed = typeof label === "string" ? label.trim() : "";
    const labelOrDefault =
      labelTrimmed.length > 0
        ? labelTrimmed.slice(0, MAX_KEY_LABEL_LENGTH)
        : `${exchangeNormalized} key`;

    // `createAdminClient()` THROWS when SUPABASE_SERVICE_ROLE_KEY is absent.
    // Caught HERE rather than left to the terminal arm below, which would
    // answer "Key validation failed" — a sentence that blames the user's key
    // for our own missing credential. Same posture and code as the sibling
    // connect route (its `SEAM_MISCONFIGURED` 503 arm in
    // `create-with-key/route.ts`).
    let admin: ReturnType<typeof createAdminClient>;
    try {
      admin = createAdminClient();
    } catch (adminErr) {
      const perRequestSecrets = [api_key, api_secret, passphrase];
      console.error(
        "[keys/validate-and-encrypt] persist arm unavailable — no service credential:",
        scrubSeamError(adminErr, perRequestSecrets),
      );
      captureToSentry(adminErr, {
        tags: { route: "api/keys/validate-and-encrypt", arm: "persist" },
        secrets: perRequestSecrets,
      });
      return NextResponse.json(
        { error: "Service credential unavailable", code: "SEAM_MISCONFIGURED" },
        { status: 503, headers: NO_STORE_HEADERS },
      );
    }

    // `user_id` is the withAuth session's id threaded in as `userId` (TS-04 /
    // SC7). A body-supplied uid can never reach this row: the POST handler
    // never reads one, and this function only ever sees the session value.
    // (threat T-160-05)
    //
    // @audit-skip: key connect — this INSERT replaces the browser-side INSERT
    // ApiKeyManager performed unaudited until 160-02, so moving the writer
    // server-side neither adds nor removes a forensic obligation. The
    // api_key.* connect taxonomy is the ADR-0023 follow-up tracked with the
    // sibling wizard path (the `@audit-skip: wizard draft` pragma on the
    // `create_wizard_strategy` call in `create-with-key/route.ts`), not this
    // phase.
    const { data: inserted, error: insertError } = await admin
      .from("api_keys")
      // ⛔ ORDER IS LOAD-BEARING (160 review WR-01). The ciphertext spread goes
      // FIRST so the provenance columns are written LAST and always win. With
      // the spread last, the only thing stopping an `encryptKey` response field
      // from overriding `user_id` (the tenant) or either venue column was
      // `EncryptKeyResponseSchema` being strip-mode Zod — a guarantee living two
      // modules away, in a file that has a sanctioned `.passthrough()` sibling.
      // RANK-03 is exactly the claim "the server's venue is the one written", so
      // it should not rest on a distant schema's mode. Now it rests on the
      // object literal itself: whatever `encrypted` carries, these four keys are
      // assigned after it.
      .insert({
        ...encrypted,
        user_id: userId,
        exchange: exchangeNormalized,
        attested_venue: exchangeNormalized,
        label: labelOrDefault,
      })
      .select("id")
      .single();

    if (insertError || typeof inserted?.id !== "string") {
      // Rule 12 / Pitfall 3: the fault is surfaced, and the raw PostgREST
      // message — which can echo SQLSTATE text and the offending values back —
      // is scrubbed at BOTH sinks and NEVER placed in the response body. The
      // copy is honest about what did and did not happen: the key validated,
      // the save did not.
      const perRequestSecrets = [api_key, api_secret, passphrase];
      const insertFault =
        insertError ?? new Error("api_keys insert returned no row");
      console.error(
        "[keys/validate-and-encrypt] persist INSERT failed:",
        scrubSeamError(insertFault, perRequestSecrets),
      );
      captureToSentry(insertFault, {
        tags: { route: "api/keys/validate-and-encrypt", arm: "persist" },
        secrets: perRequestSecrets,
      });
      return NextResponse.json(
        {
          error: "Your key was verified but couldn't be saved. Please try again.",
          code: "UNKNOWN",
        },
        { status: 500, headers: NO_STORE_HEADERS },
      );
    }

    // ⭐ NO CIPHERTEXT. The persist response carries the row id and the
    // validation verdict ONLY — key material stops round-tripping through the
    // browser on this path entirely (threat T-160-08). NO_STORE_HEADERS is
    // kept regardless: `api_key_id` is per-tenant.
    return NextResponse.json(
      { api_key_id: inserted.id, valid: true, read_only: true },
      { headers: NO_STORE_HEADERS },
    );
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
      // (`err.seamCode`, set by `AnalyticsUpstreamError`), UNKNOWN only when it
      // carried none. Never overwrite an upstream-carried code.
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
