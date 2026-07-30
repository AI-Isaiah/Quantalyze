import { NextRequest, NextResponse } from "next/server";
import { validateKey, encryptKey } from "@/lib/analytics-client";
import { createClient } from "@/lib/supabase/server";
import { withAuth } from "@/lib/api/withAuth";
import { userActionLimiter, checkLimit, rateLimitDenyJson } from "@/lib/ratelimit";
import { STRATEGY_NAMES } from "@/lib/constants";
import { isUuid } from "@/lib/utils";
import {
  isSupportedExchange,
  isSfoxEnabledServer,
  isMt5EnabledServer,
  isCryptoExchange,
} from "@/lib/closed-sets";
import { NO_STORE_HEADERS } from "@/lib/api/headers";
import { classifyKeyValidationError } from "@/lib/wizardErrors";
import { scrubSeamError } from "@/lib/seam-redaction";
// 140.3-13b / SEAMUX-08 — the ONE lazy-Sentry helper, applied under the SINGLE
// capture policy written out IN FULL in `src/app/api/admin/match/eval/route.ts`
// by `140.3-13a`. Cited, never restated.
//
// ⚠️ THIS IS ONE OF THE TWO SECRET-BEARING ROUTES OF THIS HALF. Every capture
// below names `[api_key, apiSecretNormalized, passphraseOrNull]` in `secrets`,
// the SAME three values this file's `scrubSeamError` log sites already name.
// No module-level env list can know a request-body value, so that argument is
// the only thing standing between undici's header/body inlining (TRAP-1) and a
// live exchange credential leaving our infrastructure for a third party.
// `140.3-13a`'s M78b is the receipt for omitting it: the env-derived token
// still redacted — so the obvious assertion stayed GREEN — while the raw
// per-request secret shipped verbatim.
//
// The caught value is passed UNMODIFIED: `captureToSentry` scrubs at the
// chokepoint (SEAMCORE-06), and pre-scrubbing here would hand Sentry a string,
// destroying grouping and the stack.
import { captureToSentry } from "@/lib/sentry-capture";
// The dependency-free leaf. `analytics-client` re-exports the class, but this
// route must not depend on that re-export: it is wholesale-mocked by the route
// test files, where `instanceof` against an undefined binding throws.
import { CircuitOpenError } from "@/lib/seam-errors";
import type { User } from "@supabase/supabase-js";

/**
 * POST /api/strategies/create-with-key — atomic wizard ConnectKeyStep
 * endpoint. Validates + encrypts a read-only exchange key server-side,
 * then calls the SECURITY DEFINER `create_wizard_strategy` RPC to
 * insert both the `api_keys` and `strategies` (source='wizard',
 * status='draft') rows in one transaction. Errors are mapped to stable
 * wizardErrors.ts codes — raw server messages never reach the client.
 */

/**
 * Phase 140 / SEAM-04. The Vercel default (and the project's dashboard setting
 * on 2026-07-25) already exceeds this, so declaring it cannot RAISE this route's
 * worst-case lambda hold — it exists so the headroom invariant has an in-repo
 * source of truth instead of a dashboard-changeable assumption. This route
 * spends at most two seam budgets back to back (`validate-key` then
 * `encrypt-key`), so the function deadline must comfortably exceed their sum;
 * 300s is the same figure `keys/sync` and the admin match routes declare.
 */
export const maxDuration = 300;

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

  // SECURITY-SENSITIVE carve-out (119-CONTEXT Q1, LOCKED): sFOX authenticates with a
  // SINGLE Bearer token and carries NO api_secret (118-RESEARCH confirmed). For sfox
  // ONLY, the token is stored as api_key and the absent secret is normalized to "".
  // This relaxes the secret presence/length requirement for exactly one exchange —
  // every ccxt exchange (binance/okx/bybit/deribit) keeps the byte-identical <8-char
  // KEY_INVALID_FORMAT rejection below. Security-reviewed (T-119-08/09/11). The empty
  // secret flows through the SAME trim/validate/encrypt chokepoint
  // (`trimCredential` in analytics-client.ts; trimCredential("") === ""), not a parallel path.
  // Matches this file's existing `exchange.toLowerCase() === "okx"` convention.
  const isSfox = exchange.toLowerCase() === "sfox";
  // Computed BEFORE the api_key/api_secret shape checks (RED-TEAM): mt5's slots
  // are login/investor-password/broker-server, not ccxt-shaped, so the checks
  // must be mt5-aware from the start.
  const isMt5 = exchange.toLowerCase() === "mt5";

  // ccxt API keys are long secrets; an MT5 login is a short broker ACCOUNT NUMBER
  // (commonly 5-8 digits — a demo/spike account is frequently < 8), so mt5 requires
  // only a NON-BLANK login, mirroring the validate-and-encrypt mt5 shape. Without
  // this carve-out a legitimate short MT5 login is wrongly rejected here as
  // KEY_INVALID_FORMAT — and this is the route the wizard submits to, so the two
  // routes MUST NOT diverge (RED-TEAM). sfox + every ccxt venue keep the byte-
  // identical <8 rejection.
  if (
    typeof api_key !== "string" ||
    (isMt5 ? api_key.trim().length === 0 : api_key.length < 8)
  ) {
    return NextResponse.json(
      { code: "KEY_INVALID_FORMAT", error: "api_key is required" },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

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

  // Phase 135 (MT5SRC-03) — STRUCTURAL server gate, mirroring the sfox arm above
  // and the identical gate in /api/keys/validate-and-encrypt. This is the route
  // the wizard ConnectKeyStep actually submits to, so the gate MUST live here too:
  // without it, an mt5 CONNECT in the documented client-on/server-off half-state
  // (NEXT_PUBLIC_MT5_ENABLED=true, MT5_ENABLED unset) falls through to the Python
  // /validate-key gate, whose MT5_DISABLED_DETAIL string matches no
  // classifyKeyValidationError branch → UNKNOWN → 500. The clean 400 below fails
  // CLOSED before the live validate/encrypt round-trip. isMt5EnabledServer() is
  // strict `MT5_ENABLED === "true"`. ccxt/sfox paths are unaffected (isMt5 false).
  if (isMt5 && !isMt5EnabledServer()) {
    return NextResponse.json(
      { code: "KEY_INVALID_FORMAT", error: "MT5 integration is not yet available." },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  // MT5 three-credential defense-in-depth (RED-TEAM — mirror of validate-and-encrypt):
  // mt5 requires ALL THREE non-blank slots (login/api_key, investor password/
  // api_secret, broker server/passphrase). The generic <8 secret check below is
  // ccxt-shaped and is skipped for mt5 (an investor password is broker-set and can
  // be short); this check is the mt5 presence enforcement instead. The worker's
  // is_mt5 branch remains the authoritative live enforcement.
  if (
    isMt5 &&
    (typeof api_secret !== "string" ||
      api_secret.trim().length === 0 ||
      typeof passphrase !== "string" ||
      passphrase.trim().length === 0)
  ) {
    return NextResponse.json(
      { code: "KEY_INVALID_FORMAT", error: "api_secret is required" },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  if (!isSfox && !isMt5 && (typeof api_secret !== "string" || api_secret.length < 8)) {
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
    // 140.4-13 / SEAMRIM-05 — deny through the chokepoint so a limiter
    // misconfiguration answers 503 instead of the 429 below.
    //
    // ⚠️ THIS IS THE SHARPEST SITE IN THE CLASS. `KEY_RATE_LIMIT`'s copy tells
    // the user the throttle is "a transient, exchange-side throttle and not a
    // problem with your key". While Upstash is down that was emitted to EVERY
    // user on their FIRST click — our outage, blamed on their exchange. The
    // 429 body is UNCHANGED (`{code, error}` in that order, NO_STORE_HEADERS +
    // Retry-After) because it is the correct answer to a REAL throttle; what
    // changed is that a misconfiguration no longer reaches it.
    return rateLimitDenyJson(rl, {
      headers: NO_STORE_HEADERS,
      throttledBody: { code: "KEY_RATE_LIMIT", error: "Too many requests" },
      misconfiguredBody: {
        code: "SEAM_MISCONFIGURED",
        error: "Rate limiter unavailable",
      },
    });
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
      scrubSeamError(existingDraftErr),
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
      // TS-04 / SC7 — the SERVER-derived identity from withAuth's session, so
      // the Python limiter buckets this call to this tenant. Never a body field.
      { userId: user.id },
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
      // TS-04 / SC7 — same server-derived identity. Key-connect spends TWO
      // tokens per attempt, so both halves must land in the same tenant bucket.
      { userId: user.id },
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
    // (the envelope-encryption return in analytics-service/services/encryption.py). Migration 031 makes the
    // matching DB column nullable to accept this. Only `api_key_encrypted` is
    // required here.
    if (!api_key_encrypted) {
      // 140.3-13b / SEAMUX-08 — the CONTRACT-VIOLATION half of the policy: a 2xx
      // whose body cannot be used. `encryptKey` already Zod-validated the
      // response, so reaching here means the contract itself drifted — the one
      // party who can fix it is us, and the caller only sees a 502.
      //
      // A SYNTHETIC Error: the raw `encrypted` payload is ciphertext material
      // and is never handed to a third party. Only its KEY NAMES go in `extra`,
      // exactly as the console line beside it already does.
      captureToSentry(
        new Error(
          "create-with-key: encrypt 2xx returned no api_key_encrypted",
        ),
        {
          tags: { surface: "strategies-create-with-key", step: "encrypt-contract" },
          extra: { returned_keys: Object.keys(encrypted) },
          secrets: [api_key, apiSecretNormalized, passphraseOrNull],
        },
      );
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
        scrubSeamError(error),
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
      // 140.3-13b / SEAMUX-08 — THE TERMINAL, UNCLASSIFIED RPC ARM. The two
      // branches above are Postgres conditions we already recognise and already
      // answer with their own status (23505 → 409 a real duplicate; 42501 → 403
      // a deliberate refusal, the DB analogue of a forwarded 4xx). Anything else
      // is a fault in a SECURITY DEFINER function only we can fix, and the user
      // is looking at a 500 with no explanation. `140.3-13a` applied the same
      // reading to `verify-strategy`'s persist arms.
      captureToSentry(error, {
        tags: { surface: "strategies-create-with-key", step: "draft-rpc-error" },
        extra: { pg_code: error.code },
        secrets: [api_key, apiSecretNormalized, passphraseOrNull],
      });
      return NextResponse.json(
        { code: "UNKNOWN", error: "Could not create draft strategy" },
        { status: 500, headers: NO_STORE_HEADERS },
      );
    }

    const row = Array.isArray(data) ? data[0] : data;
    if (!row?.strategy_id || !row?.api_key_id) {
      // 140.3-13b / SEAMUX-08 — CONTRACT VIOLATION, the DB-side twin of the
      // encrypt arm above: the RPC reported SUCCESS (no `error`) and returned a
      // body we cannot use. The key has already been validated and encrypted at
      // this point, so the caller has spent both seam budgets and gets nothing.
      captureToSentry(
        new Error("create-with-key: create_wizard_strategy succeeded with no usable row"),
        {
          tags: { surface: "strategies-create-with-key", step: "draft-rpc-contract" },
          extra: {
            row_present: row !== null && row !== undefined,
            has_strategy_id: Boolean(row?.strategy_id),
            has_api_key_id: Boolean(row?.api_key_id),
          },
          secrets: [api_key, apiSecretNormalized, passphraseOrNull],
        },
      );
      return NextResponse.json(
        { code: "UNKNOWN", error: "RPC returned no rows" },
        { status: 500, headers: NO_STORE_HEADERS },
      );
    }

    // #597 — force-derive the asset class on the freshly-created draft row. The
    // SECURITY DEFINER `create_wizard_strategy` RPC signature cannot carry
    // asset_class, so the row sits at the NOT NULL DEFAULT 'traditional' until
    // finalize force-derives it. Any compute fired during the wizard window
    // (e.g. sync-preview) would otherwise annualize on the wrong clock.
    //
    // MT5RECON-02: the stamp is now VENUE-AWARE — a crypto venue
    // (binance/okx/bybit/deribit/sfox) is 'crypto' (√365, byte-identical to
    // before), but mt5 is forex/CFD = 'traditional' (√252). "Every supported
    // exchange is crypto" is no longer true (mt5 joined SUPPORTED_EXCHANGES in
    // Phase 135), so `isCryptoExchange` (narrowed to the explicit CRYPTO_EXCHANGES
    // subset) is the single source of truth here. Owner-scoped (RLS +
    // belt-and-braces user_id filter). Mirrors finalize's venue-aware derive; an
    // mt5 draft annualized on √365 would inflate its Sharpe ~×1.20 vs peers.
    //
    // Non-blocking on failure: the column default leaves the row on √252 until
    // finalize re-derives it, so a transient write fault must not fail the whole
    // draft creation — just surface it for debugging (Rule 12).
    // @audit-skip: non-security annualization metadata (√365 crypto / √252
    // traditional) on a draft row that is NOT user-visible until finalize (which
    // audits the user-visible creation) — mirrors the finalize-wizard skip.
    const { error: assetClassErr } = await supabase
      .from("strategies")
      .update({
        asset_class: isCryptoExchange(exchange) ? "crypto" : "traditional",
      })
      .eq("id", row.strategy_id)
      .eq("user_id", user.id);
    if (assetClassErr) {
      console.warn(
        "[strategies/create-with-key] asset_class force-derive failed (non-blocking):",
        scrubSeamError(assetClassErr),
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
    // SEAMCORE-06 / HI-02 — THROUGH THE LEAF, with this route's PER-REQUEST
    // secrets named.
    //
    // This catch wraps `validateKey` / `encryptKey`, the two calls whose request
    // bodies carry the raw exchange `api_key`, `api_secret` and `passphrase`,
    // and whose outgoing headers carry `X-Service-Key` and the minted
    // `X-Tenant-Claim`. undici embeds those headers in `err.message` and, in one
    // shape, in `err.name`. No module-level env list can know the body values,
    // so they are named explicitly, exactly as `validate-and-encrypt` does.
    //
    // It used to log `err.message` raw. The exposure was narrower than at
    // `validate-and-encrypt` only because `analytics-client` replaces the undici
    // message with a static NOT_REACHABLE_MESSAGE before it reaches here — a
    // property of a DIFFERENT file's catch ordering, not of this route. Any
    // direct throw, any `AnalyticsUpstreamError` echoing a request field, or any
    // refactor of that client re-opens it.
    console.error(
      "[strategies/create-with-key] caught exception:",
      scrubSeamError(err, [api_key, apiSecretNormalized, passphraseOrNull]),
    );

    // Classify into a stable wizardErrors code so the client never sees the raw
    // Railway message (H-0305). The mapping is the SHARED
    // classifyKeyValidationError (src/lib/wizardErrors.ts) — the SAME one
    // composite/add-key uses — so the single-key and "+ Add another key" paths
    // can never drift, and its HTTP status distinguishes client faults (400)
    // from upstream faults (502/503) for SLO consumers (H-0310).
    //
    // Phase 140 / SEAM-04: pass the caught VALUE, not `message`. The classifier
    // branches on `err instanceof CircuitOpenError` before its substring
    // cascade, and pre-stringifying here would destroy the type — sending a
    // breaker trip to the terminal UNKNOWN/500 ("something went wrong, our team
    // has been notified") during an infra outage.
    const { code, status } = classifyKeyValidationError(err);

    // 140.3-13b / SEAMUX-08 — THE TERMINAL ARM, expressed the only way it CAN be
    // expressed at this route.
    //
    // ⚠️ THIS ROUTE HAS NO LADDER OF TYPED `catch` BRANCHES to fall off the end
    // of — the shared `classifyKeyValidationError` IS the ladder, and its own
    // terminal is `{code:"UNKNOWN", status:500}`. So "the arm reached when the
    // caught value matched no typed branch" is, here, exactly `code ===
    // "UNKNOWN"`. Reading the classifier's verdict is what makes the policy
    // mechanical at this site instead of a re-implementation of its cascade.
    //
    // Everything the classifier DID recognise is excluded for free and for the
    // policy's own reasons: `SERVICE_UNAVAILABLE_RETRY` is the breaker
    // short-circuit, `KEY_NETWORK_TIMEOUT` the timeout, and every
    // `KEY_INVALID_SIGNATURE` / `KEY_AUTH_FAILED` / `KEY_MT5_*` verdict is a
    // caller fault. None is our defect and none should page anyone.
    //
    // ⚠️ PLACEMENT IS DELIBERATE — AFTER the classify call and BEFORE the
    // `headers` computation, so this route's breaker cell (CONTEXT: "the best in
    // the audit") is left exactly as it was: the caught VALUE still reaches the
    // shared classifier unmodified, the status is still derived from the
    // classifier, and the conditional `Retry-After` below still branches on the
    // same `err instanceof CircuitOpenError`.
    if (code === "UNKNOWN") {
      captureToSentry(err, {
        tags: { surface: "strategies-create-with-key", step: "unclassified-key-error" },
        extra: { exchange: exchangeNormalized },
        secrets: [api_key, apiSecretNormalized, passphraseOrNull],
      });
    }

    // Mirror the `Retry-After` the resilience core already publishes on its own
    // 503 envelope, so a breaker trip is retryable by contract and not just by
    // copy. `retryAfterS` is the breaker cooldown TTL — the only dynamic value
    // CircuitOpenError exposes, and the same class of information
    // `rateLimitDenyJson` already returns.
    const headers =
      err instanceof CircuitOpenError
        ? { ...NO_STORE_HEADERS, "Retry-After": String(err.retryAfterS) }
        : NO_STORE_HEADERS;
    return NextResponse.json({ code }, { status, headers });
  }
});
