import { NextRequest, NextResponse } from "next/server";
import { validateKey, encryptKey } from "@/lib/analytics-client";
import { createClient } from "@/lib/supabase/server";
import { withAuth } from "@/lib/api/withAuth";
import { userActionLimiter, checkLimit } from "@/lib/ratelimit";
import { STRATEGY_NAMES } from "@/lib/constants";
import { isUuid } from "@/lib/utils";
import { isSupportedExchange, isSfoxEnabledServer } from "@/lib/closed-sets";
import { NO_STORE_HEADERS } from "@/lib/api/headers";
import { classifyKeyValidationError } from "@/lib/wizardErrors";
import type { User } from "@supabase/supabase-js";

/**
 * POST /api/strategies/composite/add-key — the multi-key wizard's per-key
 * assembly endpoint (Phase 88 / ONB-01 + ONB-03). It is a STRUCTURAL MIRROR of
 * create-with-key/route.ts (validate + encrypt a read-only exchange key
 * server-side, then persist via a SECURITY DEFINER RPC) with exactly three
 * intentional divergences, each commented below:
 *
 *   (1) NO app-layer existing-draft short-circuit. create-with-key returns the
 *       existing draft when `strategies.api_key_id` is already set (the single-
 *       key F6 fence idiom). A composite draft carries api_key_id = NULL, so
 *       that short-circuit never applies — and it MUST NOT: the whole point of
 *       ONB-03 is that each add proceeds and mints a NEW api_keys row on the ONE
 *       draft. The RPC's own 'wizcomposite:' advisory-lock + select-existing
 *       fence supplies the DRAFT dedup (double-click safety) without blocking
 *       the per-KEY add.
 *   (2) The RPC is `add_wizard_composite_key` (same argument mapping
 *       create-with-key uses for create_wizard_strategy). It returns
 *       (strategy_id, api_key_id): the SAME strategy_id across a session, a NEW
 *       api_key_id every call.
 *   (3) NO asset_class force-derive here. finalize-wizard already force-derives
 *       'crypto' for any composite (memberCount > 0), so re-deriving on the
 *       draft row would be redundant for the composite path.
 *
 * Everything else — withAuth, input validation + length caps, B15 limiter
 * ordering (validate BEFORE spending a token), validateKey read-only
 * enforcement, encryptKey reuse, uniform { code } error classification, and the
 * H-0305 no-raw-upstream-strings posture — mirrors the analog verbatim.
 */

function pickPlaceholderCodename(): string {
  // The codename is overwritten at finalize time, so collisions during
  // the draft window are harmless.
  const index = Math.floor(Math.random() * STRATEGY_NAMES.length);
  return STRATEGY_NAMES[index];
}

export const POST = withAuth(async (req: NextRequest, user: User) => {
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json(
      { code: "KEY_INVALID_FORMAT", error: "Invalid request body" },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  const {
    exchange,
    api_key,
    api_secret,
    passphrase,
    label,
    wizard_session_id,
  } = body as Record<string, unknown>;

  if (typeof exchange !== "string" || !isSupportedExchange(exchange)) {
    return NextResponse.json(
      { code: "KEY_INVALID_FORMAT", error: "Unsupported exchange" },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  if (typeof api_key !== "string" || api_key.length < 8) {
    return NextResponse.json(
      { code: "KEY_INVALID_FORMAT", error: "api_key is required" },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  // SECURITY-SENSITIVE carve-out (119-CONTEXT Q1, LOCKED): sFOX authenticates with a
  // SINGLE Bearer token and carries NO api_secret (118-RESEARCH confirmed). For sfox
  // ONLY, the token is stored as api_key and the absent secret is normalized to "".
  // This relaxes the secret presence/length requirement for exactly one exchange —
  // every ccxt exchange (binance/okx/bybit/deribit) keeps the byte-identical <8-char
  // KEY_INVALID_FORMAT rejection below. Security-reviewed (T-119-08/09/11). The empty
  // secret flows through the SAME trim/validate/encrypt chokepoint
  // (analytics-client.ts:169; trimCredential("") === ""), not a parallel path.
  // Mirrors the create-with-key sibling and this file's `exchange.toLowerCase() ===
  // "okx"` convention.
  const isSfox = exchange.toLowerCase() === "sfox";

  // F2 (Phase 122 — STRUCTURAL server gate): sFOX is founder-gated until go-live.
  // The client flag NEXT_PUBLIC_SFOX_ENABLED only hides the wizard card; this
  // server flag makes a sfox CONNECT fail CLOSED (treated exactly like an
  // unsupported exchange) until SFOX_ENABLED=true is set server-side. A clean 400
  // BEFORE the rate-limit and the live validate/encrypt round-trip — never a
  // crash, never a false KEY_AUTH, never a live probe. Mirrors the create-with-key
  // sibling verbatim; ccxt paths are unaffected.
  if (isSfox && !isSfoxEnabledServer()) {
    return NextResponse.json(
      { code: "KEY_INVALID_FORMAT", error: "sFOX integration is not yet available." },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  if (!isSfox && (typeof api_secret !== "string" || api_secret.length < 8)) {
    return NextResponse.json(
      { code: "KEY_INVALID_FORMAT", error: "api_secret is required" },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  // sfox: absent/empty secret → ""; ccxt: already a validated string above (no-op).
  const apiSecretNormalized: string =
    typeof api_secret === "string" ? api_secret : "";

  if (
    exchange.toLowerCase() === "okx" &&
    (typeof passphrase !== "string" || passphrase.length === 0)
  ) {
    return NextResponse.json(
      { code: "KEY_INVALID_FORMAT", error: "OKX requires a passphrase" },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  if (!isUuid(wizard_session_id)) {
    return NextResponse.json(
      { code: "KEY_INVALID_FORMAT", error: "wizard_session_id required" },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  if (api_key.length > 512 || apiSecretNormalized.length > 512) {
    return NextResponse.json(
      { code: "KEY_INVALID_FORMAT", error: "Key or secret too long" },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }
  if (typeof passphrase === "string" && passphrase.length > 512) {
    return NextResponse.json(
      { code: "KEY_INVALID_FORMAT", error: "Passphrase too long" },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }
  if (typeof label === "string" && label.length > 100) {
    return NextResponse.json(
      { code: "KEY_INVALID_FORMAT", error: "Label too long" },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  // Rate-limit consumed only AFTER all input validation passes, so a
  // malformed request (rejected above with 400) does not burn one of the
  // caller's own tokens (B15 limiter-ordering: auth -> validate -> limit).
  // Route-distinct limiter key so composite adds don't share the single-key
  // create-with-key bucket.
  const rl = await checkLimit(
    userActionLimiter,
    `strategies-composite-add-key:${user.id}`,
  );
  if (!rl.success) {
    return NextResponse.json(
      { code: "KEY_RATE_LIMIT", error: "Too many requests" },
      {
        status: 429,
        headers: { ...NO_STORE_HEADERS, "Retry-After": String(rl.retryAfter) },
      },
    );
  }

  // DIVERGENCE (1): NO existing-draft short-circuit. create-with-key does a
  // `from("strategies").select("id, api_key_id")...maybeSingle()` fence here and
  // returns the existing draft when api_key_id is already set. For a composite
  // the draft's api_key_id is NULL by construction and each add must proceed to
  // mint a NEW key (ONB-03), so that short-circuit is intentionally omitted. The
  // RPC's 'wizcomposite:' advisory-lock + select-existing fence supplies the
  // DRAFT dedup (double-click safety) without blocking the per-key add.
  const supabase = await createClient();

  const exchangeNormalized = exchange.toLowerCase();
  const passphraseOrNull =
    typeof passphrase === "string" && passphrase.length > 0 ? passphrase : null;
  const labelOrDefault =
    typeof label === "string" && label.trim().length > 0
      ? label.trim()
      : `${exchangeNormalized} key`;

  // validate + encrypt are TOCTOU-safe back-to-back on the server side.
  try {
    const validation = await validateKey(
      exchangeNormalized,
      api_key,
      apiSecretNormalized,
      passphraseOrNull ?? undefined,
    );

    if (!validation.read_only) {
      // FIX 3 (Phase 110.1 / DOGFOOD-3) — same honest treatment as the sibling
      // create-with-key route. /api/validate-key returns only { valid,
      // read_only }; `permissions` is never populated, so the old fall-through
      // asserted an UNOBSERVED trade scope on every bare read_only:false. Only
      // claim a specific scope when one was actually observed; otherwise report
      // the honest KEY_NOT_READ_ONLY. Key is STILL rejected either way.
      const perms = validation.permissions?.map((p) => p.toLowerCase()) ?? [];
      const code =
        perms.length === 0
          ? "KEY_NOT_READ_ONLY"
          : perms.some((p) => p.includes("withdraw"))
            ? "KEY_HAS_WITHDRAW_PERMS"
            : "KEY_HAS_TRADING_PERMS";
      return NextResponse.json(
        // H-0305 consistency: the client reads `code` only, so omit `error` —
        // all failure bodies are uniform { code }.
        { code },
        { status: 400, headers: NO_STORE_HEADERS },
      );
    }

    // encryptKey() validates the response against EncryptKeyResponseSchema
    // (Zod) before returning — the fields below are already correctly typed
    // by the schema; no runtime casts needed (H-0308).
    const encrypted = await encryptKey(
      exchangeNormalized,
      api_key,
      apiSecretNormalized,
      passphraseOrNull ?? undefined,
    );

    // Railway returns the encrypted payload using DB-native column
    // names (api_key_encrypted, api_secret_encrypted, etc.).
    const api_key_encrypted = encrypted.api_key_encrypted;
    const api_secret_encrypted = encrypted.api_secret_encrypted ?? null;
    const passphrase_encrypted = encrypted.passphrase_encrypted ?? null;
    const dek_encrypted = encrypted.dek_encrypted ?? null;
    const nonce = encrypted.nonce ?? null;
    const kek_version =
      typeof encrypted.kek_version === "number" ? encrypted.kek_version : 1;

    // Envelope-encryption contract: the Python service stores all credentials
    // (api_key + api_secret + passphrase) inside `api_key_encrypted` as a single
    // ciphertext blob, and intentionally returns `api_secret_encrypted: null`
    // (analytics-service/services/encryption.py:80-82). Migration 031 makes the
    // matching DB column nullable to accept this. Only `api_key_encrypted` is
    // required here.
    if (!api_key_encrypted) {
      console.error(
        "[strategies/composite/add-key] Railway returned unexpected encrypted payload shape",
        Object.keys(encrypted),
      );
      return NextResponse.json(
        // H-0305 consistency: uniform { code } body; detail is in the server log above.
        { code: "UNKNOWN" },
        { status: 502, headers: NO_STORE_HEADERS },
      );
    }

    // The generated types declare these RPC params as non-null strings, but
    // the underlying SQL function accepts nulls for api_secret/passphrase/dek/
    // nonce (envelope-encryption contract above). Cast the args object to
    // satisfy the typed-client contract without altering the values the DB
    // receives.
    // DIVERGENCE (2): the composite RPC. `add_wizard_composite_key`'s signature
    // is column-for-column identical to create_wizard_strategy, so this call
    // site is a drop-in sibling — it lazily mints the ONE api_key_id=NULL
    // composite draft per (user, session) and ALWAYS inserts a fresh api_keys
    // row, returning (strategy_id, api_key_id).
    // @audit-skip: wizard draft — add_wizard_composite_key writes draft
    // strategies + api_keys not yet user-visible. The user-visible creation is
    // audited at finalize time in
    // src/app/api/strategies/finalize-wizard/route.ts.
    const { data, error } = await supabase.rpc("add_wizard_composite_key", {
      p_user_id: user.id,
      p_exchange: exchangeNormalized,
      p_label: labelOrDefault,
      p_api_key_encrypted: api_key_encrypted,
      p_api_secret_encrypted: api_secret_encrypted as string,
      p_passphrase_encrypted: passphrase_encrypted as unknown as string,
      p_dek_encrypted: dek_encrypted as unknown as string,
      p_nonce: nonce as unknown as string,
      p_kek_version: kek_version,
      p_placeholder_name: pickPlaceholderCodename(),
      p_wizard_session_id: wizard_session_id,
    });

    if (error) {
      console.error(
        "[strategies/composite/add-key] RPC error:",
        error.message,
        error.code,
      );
      if (error.code === "23505") {
        // The session already holds a SINGLE-KEY draft (api_key_id set) — the
        // composite draft predicate can't match it, so the INSERT trips
        // strategies_user_wizard_session_uniq. Surface it loud (never silently
        // convert a single-key session into a composite).
        return NextResponse.json(
          {
            code: "DRAFT_ALREADY_EXISTS",
            error: "A wizard session with this key is already in progress.",
          },
          { status: 409, headers: NO_STORE_HEADERS },
        );
      }
      if (error.code === "42501") {
        return NextResponse.json(
          {
            code: "UNKNOWN",
            error: "Permission denied. Please sign out and back in.",
          },
          { status: 403, headers: NO_STORE_HEADERS },
        );
      }
      return NextResponse.json(
        { code: "UNKNOWN", error: "Could not add composite key" },
        { status: 500, headers: NO_STORE_HEADERS },
      );
    }

    const row = Array.isArray(data) ? data[0] : data;
    if (!row?.strategy_id || !row?.api_key_id) {
      return NextResponse.json(
        { code: "UNKNOWN", error: "RPC returned no rows" },
        { status: 500, headers: NO_STORE_HEADERS },
      );
    }

    // DIVERGENCE (3): NO asset_class force-derive. create-with-key updates the
    // freshly-created single-key draft to asset_class:'crypto' here so any
    // in-wizard compute annualizes √365. For the composite path finalize-wizard
    // already force-derives 'crypto' for memberCount > 0, so re-deriving on the
    // draft row would be redundant — omitted.

    // H-0309 / M-0346: stable `ok: true` success discriminator so the wizard
    // client can branch on `data.ok` uniformly. Error bodies keep their
    // { code, error } shape and are discriminated by the absence of `ok`.
    return NextResponse.json(
      {
        ok: true,
        strategy_id: row.strategy_id,
        api_key_id: row.api_key_id,
      },
      { headers: NO_STORE_HEADERS },
    );
  } catch (err) {
    // Log the raw message server-side only — never forward it to the client.
    // Raw Railway/exchange strings can contain partial secrets or internal
    // service details (H-0305).
    const message = err instanceof Error ? err.message : "Validation failed";
    console.error("[strategies/composite/add-key] caught exception:", message);

    // Classify into a stable wizardErrors code so the client never sees the raw
    // Railway message (H-0305). The mapping is the SHARED
    // classifyKeyValidationError (src/lib/wizardErrors.ts) — the SAME one
    // create-with-key uses — so the "+ Add another key" multi-key path and the
    // single-key path can never drift, and its HTTP status distinguishes client
    // faults (400) from upstream faults (502/503) for SLO consumers (H-0310).
    const { code, status } = classifyKeyValidationError(message);
    return NextResponse.json({ code }, { status, headers: NO_STORE_HEADERS });
  }
});
