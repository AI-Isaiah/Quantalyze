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
 * POST /api/strategies/create-with-key — atomic wizard ConnectKeyStep
 * endpoint. Validates + encrypts a read-only exchange key server-side,
 * then calls the SECURITY DEFINER `create_wizard_strategy` RPC to
 * insert both the `api_keys` and `strategies` (source='wizard',
 * status='draft') rows in one transaction. Errors are mapped to stable
 * wizardErrors.ts codes — raw server messages never reach the client.
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
  // Matches this file's existing `exchange.toLowerCase() === "okx"` convention.
  const isSfox = exchange.toLowerCase() === "sfox";

  // F2 (Phase 122 — STRUCTURAL server gate): sFOX is founder-gated until go-live.
  // The client flag NEXT_PUBLIC_SFOX_ENABLED only hides the wizard card; this
  // server flag makes a sfox CONNECT fail CLOSED (treated exactly like an
  // unsupported exchange) until SFOX_ENABLED=true is set server-side. A clean 400
  // BEFORE the rate-limit and the live validate/encrypt round-trip — never a
  // crash, never a false KEY_AUTH, never a live probe. ccxt paths are unaffected.
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
  const rl = await checkLimit(
    userActionLimiter,
    `strategies-create-with-key:${user.id}`,
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

  // F6 (H-0304/H-0311): idempotency fence BEFORE the expensive Railway
  // validate+encrypt. wizard_session_id is the client's stable idempotency
  // token (localStorage; regenerated only on an explicit draft delete). If a
  // draft already exists for this (user, session) — a double-click or browser
  // retry — return it immediately and skip the duplicate live-exchange
  // validate + key encryption, which otherwise burns the user's Railway probe
  // budget AND the exchange's per-key validate quota on every retry. The DB
  // layer (create_wizard_strategy's advisory-lock + select-existing fence and
  // the strategies_user_wizard_session_uniq backstop) still guarantees no
  // duplicate rows even if two first-time submits race past this check.
  const supabase = await createClient();
  const { data: existingDraft, error: existingDraftErr } = await supabase
    .from("strategies")
    .select("id, api_key_id")
    .eq("user_id", user.id)
    .eq("wizard_session_id", wizard_session_id)
    .maybeSingle();
  if (existingDraftErr) {
    // Fence read failed — fall through to the RPC (whose advisory-lock +
    // select-existing fence still dedups, so no duplicate draft results), but
    // surface that the cheap pre-Railway short-circuit went dark so a
    // persistent read fault is debuggable instead of silently re-charging
    // Railway validate+encrypt on every retry (Rule 12 / the file's own
    // console.error convention).
    console.error(
      "[strategies/create-with-key] idempotency fence SELECT failed; proceeding to RPC (DB fence still dedups):",
      existingDraftErr.message,
      existingDraftErr.code,
    );
  }
  if (existingDraft?.id && existingDraft.api_key_id) {
    return NextResponse.json(
      {
        ok: true,
        strategy_id: existingDraft.id,
        api_key_id: existingDraft.api_key_id,
      },
      { headers: NO_STORE_HEADERS },
    );
  }

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
      // FIX 3 (Phase 110.1 / DOGFOOD-3): the Python /api/validate-key route
      // returns only { valid, read_only }; `permissions` is optional in the
      // schema and is NOT populated by that route. So the pre-fix code, which
      // always fell through to KEY_HAS_TRADING_PERMS on a bare read_only:false,
      // asserted an UNOBSERVED trade scope ("This key has trading permissions
      // enabled"). Only claim a specific scope when the validator ACTUALLY
      // observed one (permissions present & non-empty); otherwise report the
      // honest "could not be verified as read-only". The key is STILL rejected
      // either way — only the user-facing reason changes.
      const perms = validation.permissions?.map((p) => p.toLowerCase()) ?? [];
      const code =
        perms.length === 0
          ? "KEY_NOT_READ_ONLY"
          : perms.some((p) => p.includes("withdraw"))
            ? "KEY_HAS_WITHDRAW_PERMS"
            : "KEY_HAS_TRADING_PERMS";
      return NextResponse.json(
        // H-0305 consistency: ConnectKeyStep reads `code` only (maps it to copy
        // client-side), so omit `error` — all failure bodies are uniform { code }.
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
      typeof encrypted.kek_version === "number"
        ? encrypted.kek_version
        : 1;

    // Envelope-encryption contract: the Python service stores all credentials
    // (api_key + api_secret + passphrase) inside `api_key_encrypted` as a single
    // ciphertext blob, and intentionally returns `api_secret_encrypted: null`
    // (analytics-service/services/encryption.py:80-82). Migration 031 makes the
    // matching DB column nullable to accept this. Only `api_key_encrypted` is
    // required here.
    if (!api_key_encrypted) {
      console.error(
        "[strategies/create-with-key] Railway returned unexpected encrypted payload shape",
        Object.keys(encrypted),
      );
      return NextResponse.json(
        // H-0305 consistency: uniform { code } body; detail is in the server log above.
        { code: "UNKNOWN" },
        { status: 502, headers: NO_STORE_HEADERS },
      );
    }

    // The generated types declare these RPC params as non-null strings, but
    // the underlying SQL function (per migration 031 + the envelope-encryption
    // contract above) accepts nulls for api_secret/passphrase/dek/nonce.
    // Cast the args object to satisfy the typed-client contract without
    // altering the values the DB receives.
    // @audit-skip: wizard draft — create_wizard_strategy writes draft
    // strategies + api_keys not yet user-visible. The user-visible
    // creation is audited at finalize time in
    // src/app/api/strategies/finalize-wizard/route.ts. Per audit-2026-05-07
    // P692 + ADR-0023 (taxonomy follow-up tracked separately).
    const { data, error } = await supabase.rpc("create_wizard_strategy", {
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
        "[strategies/create-with-key] RPC error:",
        error.message,
        error.code,
      );
      if (error.code === "23505") {
        return NextResponse.json(
          {
            code: "DRAFT_ALREADY_EXISTS",
            error:
              "A wizard session with this key is already in progress.",
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
        { code: "UNKNOWN", error: "Could not create draft strategy" },
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

    // #597 — force-derive 'crypto' on the freshly-created draft row. The
    // SECURITY DEFINER `create_wizard_strategy` RPC signature cannot carry
    // asset_class, so the row sits at the NOT NULL DEFAULT 'traditional' until
    // finalize force-derives it. Any compute fired during the wizard window
    // (e.g. sync-preview) would otherwise annualize a crypto strategy on √252.
    // Every create-with-key strategy is API-keyed and every supported exchange
    // (binance/okx/bybit/deribit) is a crypto venue, so 'crypto' is unconditional
    // here. Owner-scoped (RLS + belt-and-braces user_id filter). Mirrors the
    // migration backfill (api_key_id IS NOT NULL → crypto) and finalize's
    // force-derive; closes the draft-preview √252 window.
    //
    // Non-blocking on failure: the column default leaves the row on √252 until
    // finalize re-derives it to crypto, so a transient write fault must not fail
    // the whole draft creation — just surface it for debugging (Rule 12).
    // @audit-skip: non-security annualization metadata (√365 crypto / √252
    // traditional) on a draft row that is NOT user-visible until finalize (which
    // audits the user-visible creation) — mirrors the finalize-wizard skip.
    const { error: assetClassErr } = await supabase
      .from("strategies")
      .update({ asset_class: "crypto" })
      .eq("id", row.strategy_id)
      .eq("user_id", user.id);
    if (assetClassErr) {
      console.warn(
        "[strategies/create-with-key] asset_class force-derive failed (non-blocking):",
        assetClassErr.message,
        assetClassErr.code,
      );
    }

    // H-0309 / M-0346: stable `ok: true` success discriminator so the wizard
    // client (and any future caller) can branch on `data.ok` uniformly across
    // create-with-key / finalize-wizard / keys-sync, matching the csv-finalize
    // envelope already on the wire. Error bodies keep their `{ code, error }`
    // shape and are discriminated by the absence of `ok` (res.ok / HTTP status).
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
    console.error("[strategies/create-with-key] caught exception:", message);

    // Classify into a stable wizardErrors code so the client never sees the raw
    // Railway message (H-0305). The mapping is the SHARED
    // classifyKeyValidationError (src/lib/wizardErrors.ts) — the SAME one
    // composite/add-key uses — so the single-key and "+ Add another key" paths
    // can never drift, and its HTTP status distinguishes client faults (400)
    // from upstream faults (502/503) for SLO consumers (H-0310).
    const { code, status } = classifyKeyValidationError(message);
    return NextResponse.json({ code }, { status, headers: NO_STORE_HEADERS });
  }
});
