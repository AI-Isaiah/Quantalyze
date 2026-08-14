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
import {
  pgConstraintName,
  VENUE_IDENTITY_CONSTRAINT,
  WIZARD_SESSION_CONSTRAINTS,
} from "@/lib/api/pgConstraintName";
import {
  classifyKeyValidationError,
  OUR_DEFECT_KEY_ERROR_CODES,
} from "@/lib/wizardErrors";
import { scrubSeamError } from "@/lib/seam-redaction";
// 154 / WIZCONT-02 — read-only, owner-filtered, and used for EXACTLY ONE column.
// See `resolveByVenueIdentity` for why the user-scoped client structurally
// cannot perform this read.
import { createAdminClient } from "@/lib/supabase/admin";
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

/**
 * 154 / WIZCONT-02 — THE SECOND KEY OF THE SAME FENCE, resolved read-only.
 *
 * Answers "does this user ALREADY have a live key for this exact venue account,
 * and a strategy hanging off it?" — the question the `wizard_session_id` fence
 * cannot ask, because a re-connect from a context that lost localStorage brings
 * a BRAND NEW session token and sails straight past it (WIZCONT-02).
 *
 * ⭐ FAIL TOWARD THE EXISTING ROW. This function only ever READS. The existing
 * `api_keys` row carries `strategy_keys` membership and synced history other
 * strategies depend on, so "resolving" a collision by overwriting it would
 * orphan all of that — the DB index refuses the duplicate INSERT precisely so
 * nothing has to be overwritten (migration 20260812083206's own contract).
 *
 * ⛔ WHY THE ADMIN CLIENT, AND WHY IT IS NOT A SHORTCUT. `api_keys.venue_account_id`
 * is NOT on the column-SELECT allowlist: 20260410225608 revoked table-level
 * SELECT from `authenticated` and granted back a named list, extended since by
 * exactly three columns (`sync_error`, `last_429_at`, `disconnected_at`).
 * PostgreSQL requires SELECT privilege on every column a query REFERENCES — a
 * WHERE filter included, not just the projection — so this read is IMPOSSIBLE on
 * the user-scoped client. It would not degrade: it would answer 42501 on every
 * single call, the fence would log-and-fall-through forever, and a token-less
 * re-connect would land on a 409 instead of the existing row. That is the
 * failure this whole plan exists to remove.
 *
 * The precedent is this same flow, one phase old: the `attested_venue` read in
 * `finalize-wizard/route.ts` reaches the SIBLING non-allowlisted column through
 * `createAdminClient()` for the same structural reason (153.6-04 / PARITY-04).
 * ⭐ AND PHASE 156 HAS NOW MOVED IN THAT DIRECTION — CONNECT-REFACTOR routes this
 * route's `api_keys` INSERT through a service-role writer (the `rpcAdmin`
 * binding at the `.rpc` call below), so this read needed no unpicking.
 *
 * ⭐ AND THE OTHER HALF HAS LANDED TOO. Migration A
 * (`20260813150106_wizard_rpcs_service_role_writer.sql`) only ADMITTED a
 * `service_role` caller while leaving `authenticated`'s grant standing;
 * Migration B (`20260814120000_wizard_rpcs_revoke_authenticated.sql`) WITHDREW
 * it. `authenticated` holds no EXECUTE on `create_wizard_strategy`, and the
 * body's own gate refuses any caller whose `auth.role()` is not `service_role`,
 * so a direct PostgREST call answers 42501 and mints nothing. This route is now
 * the only POSSIBLE writer, not merely the sanctioned one.
 * ⛔ THE CEILING: the venue is the one this server observed a successful
 * read-only authentication at. NEVER "the venue cannot be forged" — any server
 * route holding `createAdminClient()` can still pass any uid and any venue
 * string, the standing `service_role` trust boundary (ADR-0001/ADR-0003).
 *
 * ⭐ THREE FILTERS, EACH LOAD-BEARING:
 *   · `.eq("user_id", …)` — the admin client BYPASSES RLS, so tenant scoping
 *     here IS this filter and nothing else. The value comes from `withAuth`'s
 *     server-side session and never from the request body.
 *   · `.eq("exchange", …)` — the index is keyed (user_id, exchange,
 *     venue_account_id); an account number is only unique WITHIN a venue.
 *   · `.is("disconnected_at", null)` — ⭐ MIRRORS THE INDEX PREDICATE EXACTLY.
 *     The partial UNIQUE is LIVE-scoped (`venue_account_id IS NOT NULL AND
 *     disconnected_at IS NULL`) because `api_keys` rows are RETAINED on
 *     disconnect (20260422101911). An app fence blind to that lifecycle would
 *     hand a re-connecting user a SOFT-DISCONNECTED key — which every cron
 *     dispatcher deliberately skips — so the new strategy would silently never
 *     sync. That is worse than the duplicate this fence prevents, and it is the
 *     exact defect the migration's HIGH-1 amendment fixed at the DB layer. The
 *     two predicates must be changed together or not at all.
 *
 * Answers `{ kind: "unresolved" }` for every "cannot resolve" case — no live
 * key, no strategy hanging off it, a read fault, or a missing service-role
 * credential. The caller then falls through to the RPC, exactly as the session
 * fence does on a failed read: the DB index still dedups, so a dark fence costs
 * correctness nothing. It never throws.
 */
/**
 * 154.1 / WIZCONT-02 review CR — "NOTHING TO RESUME" AND "SOMEONE ELSE HAS IT"
 * ARE NOT THE SAME ANSWER, and collapsing them to `null` is what shipped the
 * defect this type exists to make unrepresentable.
 *
 * The resolver used to return `{strategy_id, api_key_id} | null`, so the caller
 * could only ask "did you find a row?". With the draft filters added (below),
 * "no draft" would have swallowed the case that matters most — a re-connect
 * whose account is already held by a FINISHED strategy — and answered it with
 * `DRAFT_ALREADY_EXISTS`, whose copy promises a session in progress that does
 * not exist. Three states, three members:
 *
 *   · `draft`      — a resumable wizard draft. The WIZCONT-02 happy path: hand
 *                    the pair back and mark the response `deduped`.
 *   · `connected`  — the live key exists and a strategy hangs off it, but that
 *                    strategy has left `draft`. Refusable, with an honest code.
 *   · `unresolved` — genuinely nothing to say: no live key, no strategy at all,
 *                    a read fault, or no service-role credential. Fall through.
 *
 * ⛔ `strategyName` is the ONLY thing `connected` carries out. Not the id, not
 * the status, and above all not the venue account id (T-154-06-C).
 */
type VenueIdentityResolution =
  | { kind: "unresolved" }
  | { kind: "draft"; strategy_id: string; api_key_id: string }
  | { kind: "connected"; strategyName: string | null };

const UNRESOLVED: VenueIdentityResolution = { kind: "unresolved" };

async function resolveByVenueIdentity(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  exchangeNormalized: string,
  venueAccountId: string,
  secrets: readonly unknown[],
): Promise<VenueIdentityResolution> {
  let liveKeyId: string | null = null;

  try {
    const admin = createAdminClient();
    const { data: liveKey, error: liveKeyErr } = await admin
      .from("api_keys")
      .select("id")
      .eq("user_id", userId)
      .eq("exchange", exchangeNormalized)
      .eq("venue_account_id", venueAccountId)
      .is("disconnected_at", null)
      .maybeSingle();

    if (liveKeyErr) {
      // Same posture as the session fence's failed read (Rule 12): surface that
      // the cheap pre-Railway short-circuit went dark, then fall through.
      // ⛔ The error is scrubbed WITH this request's secrets because a PostgREST
      // error can echo the filter values back — and one of those filter values
      // is the login. Per-request candidates are redacted regardless of length
      // (the MIN_REDACTABLE_SECRET_LENGTH floor applies to ENV candidates only),
      // so a 6-digit MT5 login is genuinely removed and not merely reported.
      console.error(
        "[strategies/create-with-key] venue-identity fence SELECT failed; proceeding to RPC (DB index still dedups):",
        scrubSeamError(liveKeyErr, secrets),
        liveKeyErr.code,
      );
    }
    liveKeyId = typeof liveKey?.id === "string" ? liveKey.id : null;
  } catch (adminErr) {
    // `createAdminClient()` THROWS when SUPABASE_SERVICE_ROLE_KEY is absent.
    // A missing credential must not 500 a connect that would otherwise succeed:
    // the DB index is still the backstop, so the honest degradation is a dark
    // fence plus a loud log — never a failed submit.
    console.error(
      "[strategies/create-with-key] venue-identity fence unavailable; proceeding to RPC (DB index still dedups):",
      scrubSeamError(adminErr, secrets),
    );
    return UNRESOLVED;
  }

  if (!liveKeyId) return UNRESOLVED;

  // ⭐ BACK ONTO THE USER-SCOPED CLIENT, DELIBERATELY. `strategies` has no
  // column-grant obstacle, so this read does not need the admin client — and
  // routing it through RLS means the row we hand back is provably the caller's
  // own even if the owner filter above were ever weakened. Defence in depth at
  // zero cost.
  //
  // ⭐ 154.1 REVIEW CR — `source` AND `status` ARE THE TWO FILTERS THIS READ WAS
  // MISSING, and every sibling reader of a wizard draft already carries both
  // (`strategies/draft/[id]/route.ts` applies them on its preflight AND again on
  // the DELETE, precisely so a TOCTOU flip cannot clobber a promoted strategy).
  // Without them, oldest-first ordering resolves a re-connect onto the user's
  // ALREADY-FINALIZED strategy and hands the wizard a non-draft to resume:
  // `finalize_wizard_strategy` then raises `invalid_parameter_value` on its
  // `v_current_status <> 'draft'` check, which is a 409 that a page refresh
  // re-runs identically — permanently wedged — while the manager path finalizes
  // 200 and silently discards the typed metadata. Both halves of that come from
  // ONE missing pair of filters, so they are added here rather than guarded for
  // downstream.
  //
  // ⛔ THE ORDERING STAYS OLDEST-FIRST and is now scoped to drafts. Oldest first:
  // `strategies.api_key_id` carries no UNIQUE, so if a row ever shares a key the
  // ORIGINAL is the one to continue with — and a fence that picked
  // non-deterministically would be untestable.
  const { data: draftRow, error: draftRowErr } = await supabase
    .from("strategies")
    .select("id")
    .eq("user_id", userId)
    .eq("api_key_id", liveKeyId)
    .eq("source", "wizard")
    .eq("status", "draft")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (draftRowErr) {
    console.error(
      "[strategies/create-with-key] venue-identity strategy resolve failed; proceeding to RPC (DB index still dedups):",
      scrubSeamError(draftRowErr, secrets),
      draftRowErr.code,
    );
    return UNRESOLVED;
  }

  if (draftRow?.id) {
    return { kind: "draft", strategy_id: draftRow.id, api_key_id: liveKeyId };
  }

  // ⭐ NO DRAFT IS NOT YET AN ANSWER. Two very different situations reach this
  // line and the caller must be able to tell them apart:
  //   · nothing hangs off the key at all (an orphan, e.g. its draft was
  //     deleted) — fall through, let the RPC's INSERT trip the index and let the
  //     23505 arm answer;
  //   · a strategy DOES hold this account and has simply left `draft` — the case
  //     the filters above just started excluding, and the one that must be
  //     refused with a sentence that is true.
  // Collapsing them here is exactly the defect being closed, one level down.
  //
  // ⛔ NO `status`/`source` FILTER ON THIS READ, deliberately: it exists to
  // observe the rows the draft read cannot see. `name` is on the caller's own
  // row through RLS + the explicit owner filter, and it is the ONLY column that
  // leaves this function for the browser.
  const { data: ownerRow, error: ownerRowErr } = await supabase
    .from("strategies")
    .select("id, name")
    .eq("user_id", userId)
    .eq("api_key_id", liveKeyId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (ownerRowErr) {
    // Same posture as every other read fault here: we cannot tell which of the
    // two situations we are in, so we claim neither (Rule 12).
    console.error(
      "[strategies/create-with-key] venue-identity owner resolve failed; proceeding to RPC (DB index still dedups):",
      scrubSeamError(ownerRowErr, secrets),
      ownerRowErr.code,
    );
    return UNRESOLVED;
  }

  if (!ownerRow?.id) return UNRESOLVED;

  return {
    kind: "connected",
    // `strategies.name` is NOT NULL at the database, so the guard is about the
    // SHAPE we were handed rather than about the column: a non-string here means
    // the read drifted, and a name we cannot vouch for must become "no name"
    // rather than a stringified surprise in user-facing copy.
    strategyName: typeof ownerRow.name === "string" ? ownerRow.name : null,
  };
}

/**
 * 154.1 / WIZCONT-02 review CR — THE ONE REFUSAL BODY, built once for BOTH arms.
 *
 * `resolveByVenueIdentity` is consulted twice (the pre-RPC fence and the 23505
 * race arm), so its `connected` answer has two emitting sites. TWIN-8 is this
 * file's own record of what happens when one 23505 fact grows a second meaning
 * and only one copy learns about it, so the body lives in one function and the
 * arms call it.
 *
 * ⛔ `strategy_name` IS OMITTED, NOT NULLED, when there is no name. The wire then
 * carries exactly what a pre-154.1 error body carried, and the client's
 * "absence means we were not told" rule (`WizardErrorContext.strategyName`) is a
 * property of the request rather than of a serializer dropping `null`.
 *
 * ⛔ AND THE VENUE ACCOUNT ID NEVER APPEARS HERE. It is not a parameter of this
 * function, which is the structural reason rather than a promise (T-154-06-C).
 */
function venueAlreadyConnectedResponse(strategyName: string | null): NextResponse {
  return NextResponse.json(
    {
      code: "VENUE_ALREADY_CONNECTED",
      error: "This account is already connected to an existing strategy.",
      ...(strategyName === null ? {} : { strategy_name: strategyName }),
    },
    { status: 409, headers: NO_STORE_HEADERS },
  );
}

export const POST = withAuth(async (req: NextRequest, user: User) => {
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json(
      { code: "KEY_MISSING_REQUIRED_FIELD", error: "Invalid request body" },
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
      { code: "KEY_UNSUPPORTED_VENUE", error: "Unsupported exchange" },
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
  // this carve-out a legitimate short MT5 login is wrongly rejected here as a
  // missing api_key — and this is the route the wizard submits to, so the two
  // routes MUST NOT diverge (RED-TEAM). sfox + every ccxt venue keep the byte-
  // identical <8 rejection.
  // (142.2-07 / MT5-04: this guard's code is now KEY_MISSING_REQUIRED_FIELD.
  // The sentence named the old bucket code, which would have made this comment
  // the ONLY remaining claim in the file that a missing login is a format
  // problem.)
  if (
    typeof api_key !== "string" ||
    (isMt5 ? api_key.trim().length === 0 : api_key.length < 8)
  ) {
    return NextResponse.json(
      { code: "KEY_MISSING_REQUIRED_FIELD", error: "api_key is required" },
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
      { code: "KEY_VENUE_NOT_ENABLED", error: "sFOX integration is not yet available." },
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
      { code: "KEY_VENUE_NOT_ENABLED", error: "MT5 integration is not yet available." },
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
      { code: "KEY_MISSING_REQUIRED_FIELD", error: "api_secret is required" },
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
      { code: "KEY_MISSING_REQUIRED_FIELD", error: "OKX requires a passphrase" },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  if (!isUuid(wizard_session_id)) {
    return NextResponse.json(
      { code: "KEY_MISSING_REQUIRED_FIELD", error: "wizard_session_id required" },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  if (api_key.length > 512 || apiSecretNormalized.length > 512) {
    return NextResponse.json(
      { code: "KEY_INPUT_TOO_LONG", error: "Key or secret too long" },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }
  if (typeof passphrase === "string" && passphrase.length > 512) {
    return NextResponse.json(
      { code: "KEY_INPUT_TOO_LONG", error: "Passphrase too long" },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }
  if (typeof label === "string" && label.length > 100) {
    return NextResponse.json(
      { code: "KEY_INPUT_TOO_LONG", error: "Label too long" },
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
  // ⚠️ PHASE 156 — THIS BINDING SURVIVES ON PURPOSE, and its consumers are now a
  // short closed list: this idempotency fence, `resolveByVenueIdentity`'s
  // owner-scoped `strategies` reads, and the `asset_class` force-derive at the
  // end. All three are owner-scoped work that RLS should keep policing. The one
  // thing it no longer carries is the `create_wizard_strategy` write — that is
  // `rpcAdmin`'s, and routing it back here would re-open CONNECT-02.
  // (⛔ The composite twin's identical-looking binding WAS deleted, because
  // there the RPC was its only consumer. Do not "mirror" that deletion here.)
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

  /**
   * ── WIZCONT-02: ONE FENCE, TWO KEYS ──────────────────────────────────────
   *
   * The fence above keys on `wizard_session_id`, the client's localStorage
   * token. That is the right key for a double-click and the WRONG key for the
   * bug this closes: a re-connect from a context that LOST the token arrives
   * with a fresh session id, misses the fence entirely, and mints a second
   * strategy plus a second encrypted `api_keys` row for credentials we already
   * hold. This is the second key of the SAME fence, sitting beside the first
   * and sharing its failure posture exactly.
   *
   * ⭐ NARROW BY LOCKED DECISION, AND THE NARROWNESS IS THE HONEST PART. Only a
   * venue that hands back a STABLE NON-SECRET ACCOUNT ID at validation can be
   * fenced this way, and today that is MT5 alone: the broker login, which
   * `analytics-service/services/mt5_probe.py` asserts against the gateway. The
   * ccxt adapter's `ValidationResult` dataclass
   * (`analytics-service/services/ingestion/adapter.py`) carries NO
   * account-identity field at all, so every ccxt venue has nothing to stamp,
   * stays NULL, and the partial index excludes it. Recorded as a residual in
   * REQUIREMENTS.md rather than papered over.
   *
   * ⛔ ONE CAPTURE POINT, NOT A VENUE LITERAL SPRINKLED DOWNSTREAM. `isMt5` is
   * consulted here and nowhere below; every arm past this line is
   * venue-NEUTRAL and gated purely on `venueAccountId != null`. When a second
   * venue starts exposing an identity, this one expression changes.
   *
   * ⛔ AND NEVER `?? ""`. The login is `.trim()`ed to agree with the RPC's own
   * `NULLIF(btrim(p_venue_account_id), '')` normalisation, so a stray space
   * cannot make the dedup MISS. A blank is not an identity — `''` is non-NULL
   * and the partial index would govern it, collapsing two GENUINELY DIFFERENT
   * accounts onto one row (silent wrong-account attribution, the exact inverse
   * of this fence's purpose). The `api_keys_venue_account_id_nonblank` CHECK
   * refuses it at the DB, and the guard at :119 already rejected a blank MT5
   * login with a 400 long before here — so this expression cannot produce one.
   */
  const venueAccountId = isMt5 ? api_key.trim() : null;

  if (venueAccountId) {
    const venueMatch = await resolveByVenueIdentity(
      supabase,
      user.id,
      exchangeNormalized,
      venueAccountId,
      // The login doubles as a credential SLOT even though the column value is
      // non-secret by definition — err toward scrubbing it out of telemetry.
      [api_key, apiSecretNormalized, passphraseOrNull, venueAccountId],
    );
    if (venueMatch.kind === "draft") {
      // ⭐ `deduped` IS ADDITIVE AND APPEARS ON THIS ARM ONLY. The session-fence
      // arm above stays byte-identical: the common case (a double-click) is
      // already safe, already silent, and gets no new UI. This arm is the one
      // the user cannot otherwise explain — they pressed Connect and did not
      // get a new strategy — so it is the one that earns a line on screen.
      // ⛔ The identity itself never crosses back (UI-SPEC / T-154-06-C).
      return NextResponse.json(
        {
          ok: true,
          strategy_id: venueMatch.strategy_id,
          api_key_id: venueMatch.api_key_id,
          deduped: true,
        },
        { headers: NO_STORE_HEADERS },
      );
    }
    if (venueMatch.kind === "connected") {
      // 154.1 REVIEW CR — REFUSE, AND SAY WHY TRUTHFULLY. This account is held
      // by a strategy that is no longer a draft, so there is nothing to resume
      // and nothing to continue: resuming onto it is what wedged the wizard
      // (`finalize_wizard_strategy` refuses a non-draft with a 409 a refresh
      // reproduces exactly) and what let the manager path finalize 200 while
      // discarding the metadata the user had just typed.
      //
      // ⛔ NOT `DRAFT_ALREADY_EXISTS`. Its copy — "A wizard session with this
      // key is already in progress" — is false in every clause here, and it
      // sends the user hunting for a draft that does not exist.
      //
      // ⭐ SHORT-CIRCUITS BEFORE THE CHARGED SEAM CALLS, exactly like the two
      // resolve arms above it: a refusal we can make from rows we already read
      // must not first burn a Railway probe and the venue's validate quota.
      return venueAlreadyConnectedResponse(venueMatch.strategyName);
    }
  }

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

    /**
     * ⭐ PHASE 156 / CONNECT-02 — THE WRITE LEAVES THE BROWSER'S CREDENTIAL.
     *
     * `create_wizard_strategy` is a service-role writer as of Migration A
     * (`20260813150106_wizard_rpcs_service_role_writer.sql`) and a
     * service-role-ONLY writer as of Migration B
     * (`20260814120000_wizard_rpcs_revoke_authenticated.sql`): the value written
     * as `p_exchange` is only a guarantee if the server is the one that wrote
     * it, and while a browser could once dial the RPC with a venue of its
     * choosing — making the closed-set gate, the `validateKey` read-only verdict
     * and the `encryptKey` binding above all bypassable — `authenticated` now
     * holds no EXECUTE on it. This binding is what makes the route the writer.
     * ⛔ THE CEILING: the venue is the one this server observed a successful
     * read-only authentication at. NEVER "the venue cannot be forged" — any
     * server route holding `createAdminClient()` can still pass any uid and any
     * venue string, the standing `service_role` trust boundary
     * (ADR-0001/ADR-0003).
     *
     * ⛔ TWO ADMIN CLIENTS NOW LIVE IN THIS FILE, WITH OPPOSITE FAILURE
     * POSTURES, AND THAT IS DELIBERATE — do not unify them.
     *   · `resolveByVenueIdentity`'s `admin` (:170) is FAIL-SOFT: a missing
     *     credential degrades to a dark fence and the connect still succeeds,
     *     because the partial UNIQUE index is a real backstop for the duplicate
     *     it prevents.
     *   · This one is FAIL-HARD: there is no backstop for a write that never
     *     happened, and the only alternative — falling back to the user-scoped
     *     `supabase` — re-opens the exact door Phase 156 exists to close and
     *     would make every gate in it pass vacuously.
     * Hence a DISTINCT name (`rpcAdmin`), a distinct scope, and a distinct
     * lifetime from the fence's `admin`.
     *
     * 503 `SEAM_MISCONFIGURED` is the code both this route (:504-511) and its
     * composite twin already emit for a server-side misconfiguration, so no new
     * member is minted into the wizard code union. It does not blame the user's
     * key, and its copy's promise — nothing submitted, nothing changed — is
     * literally true here: this returns BEFORE any RPC attempt.
     */
    let rpcAdmin: ReturnType<typeof createAdminClient>;
    try {
      rpcAdmin = createAdminClient();
    } catch (adminErr) {
      // Rule 12 — fail LOUD. Scrubbed with this request's own secrets, the same
      // way the fence at :200-203 logs its own miss; only the outcome differs.
      console.error(
        "[strategies/create-with-key] no service-role credential for the wizard write; refusing the submit (nothing was written):",
        scrubSeamError(adminErr, [
          api_key,
          apiSecretNormalized,
          passphraseOrNull,
        ]),
      );
      return NextResponse.json(
        { code: "SEAM_MISCONFIGURED", error: "Service credential unavailable" },
        { status: 503, headers: NO_STORE_HEADERS },
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
    const { data, error } = await rpcAdmin.rpc("create_wizard_strategy", {
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
      // 154 / WIZCONT-02 — the 12th parameter (20260812083206). The RPC stamps
      // it as `NULLIF(btrim(…), '')` inside the SECURITY DEFINER body, which is
      // the only writer whose value survives the api_keys_scrub_venue_account_id
      // trigger. NULL for every venue that exposes no stable non-secret account
      // id, which is every ccxt venue today.
      //
      // ⛔ WHAT THIS DOES NOT BUY, STATED SO NOBODY LATER ASSUMES IT DOES.
      //
      // The REACHABILITY half is now CLOSED (Phase 156 / CONNECT-02, CONNECT-05):
      // this call rides `rpcAdmin`, and `20260814120000` withdrew
      // `authenticated`'s EXECUTE, so /rest/v1/rpc/create_wizard_strategy is
      // unreachable from a browser session and the ONLY value this parameter can
      // carry is the one the server derived above.
      //
      // ⛔ AND THE OTHER HALF DID NOT MOVE AT ALL — 156 RESTATED IT, it did not
      // close it. The RPC still does not validate the parameter and there is NO
      // in-database oracle for a venue account id: nothing in the database can
      // ask MT5 whether this login is real. The stored value is "what the server
      // passed", NEVER "what the venue confirmed". It raises the floor for the
      // ACCIDENTAL token-less re-entry this fence is about, and it is not an
      // anti-forgery control. This is the residual CR-01 class that survives
      // Phase 156, at exactly this scope and no wider — logged in `TODOS.md`
      // under "Phase 156 (CONNECT)". ⚠️ Distinct from TODOS **A-3**, which is
      // about this value's SHAPE (a login is unique only within a broker
      // server); this is about its PROVENANCE.
      //
      // ⚠️ DEPLOY ORDER: migration 20260812083206 must be LIVE before the
      // deployment carrying this line. PostgREST resolves rpc() by named
      // parameters — against the cached 11-parameter function this call answers
      // PGRST202 and EVERY connect-a-key submit fails. (It is live on PROD and
      // TEST as of 2026-08-12; the hazard is recorded for the next signature
      // change, not open today.)
      //
      // OMITTED rather than sent as null when there is no identity, so the
      // wire carries exactly what every pre-154 caller carried and the
      // parameter's own `DEFAULT NULL` supplies the value — the additive
      // guarantee is then a property of the request, not of a serializer
      // dropping `undefined`.
      ...(venueAccountId === null ? {} : { p_venue_account_id: venueAccountId }),
    });

    if (error) {
      console.error(
        "[strategies/create-with-key] RPC error:",
        // 154 / WIZCONT-02 — the request's own secrets are named here now, and
        // the reason is new with this plan: a 23505's `details` carries the
        // OFFENDING KEY VALUES, and for the venue-identity index one of those
        // values is the MT5 login. Per-request candidates are redacted
        // regardless of length (the MIN_REDACTABLE_SECRET_LENGTH floor is for
        // ENV candidates only), so a short broker login is genuinely removed
        // from this line rather than merely reported as unredactable.
        scrubSeamError(error, [
          api_key,
          apiSecretNormalized,
          passphraseOrNull,
          venueAccountId,
        ]),
        error.code,
      );
      if (error.code === "23505") {
        /**
         * 154 / WIZCONT-02 (TWIN-8) — A 23505 IS NO LONGER ONE FACT.
         *
         * Until migration 20260812083206 this route saw exactly one unique
         * violation, so mapping every 23505 to DRAFT_ALREADY_EXISTS was true.
         * There are now two, they mean different things, and the copy for one
         * is simply wrong for the other. Read the name Postgres itself quoted
         * (from `message` only — see `pgConstraintName` for why never
         * `details`) and answer the fact that actually occurred.
         */
        const constraint = pgConstraintName(error);

        if (constraint === VENUE_IDENTITY_CONSTRAINT) {
          // THE RACE ARM. The fence above missed — two first-time submits
          // raced, or the key was created between the fence read and the RPC —
          // and the DB caught what the app could not. ⭐ FAIL TOWARD THE
          // EXISTING ROW: re-run the same resolver and hand back the row that
          // is already there. Never a write, never an overwrite; the existing
          // api_keys row carries strategy_keys membership and synced history.
          const venueMatch = venueAccountId
            ? await resolveByVenueIdentity(
                supabase,
                user.id,
                exchangeNormalized,
                venueAccountId,
                [api_key, apiSecretNormalized, passphraseOrNull, venueAccountId],
              )
            : UNRESOLVED;
          if (venueMatch.kind === "draft") {
            return NextResponse.json(
              {
                ok: true,
                strategy_id: venueMatch.strategy_id,
                api_key_id: venueMatch.api_key_id,
                deduped: true,
              },
              { headers: NO_STORE_HEADERS },
            );
          }
          if (venueMatch.kind === "connected") {
            // 154.1 REVIEW CR — the SAME refusal as the pre-RPC arm, through the
            // SAME builder. Re-running the resolver is what makes this arm free:
            // it inherits the draft/non-draft discrimination without a second
            // implementation, so the race cannot answer a different sentence
            // from the fence for an identical database.
            //
            // ⭐ Reaching here means the INSERT was refused by the index and
            // rolled back by Postgres, so the "nothing new was created" clause
            // in this code's copy holds on this arm too — and on stronger ground
            // than on the pre-RPC one.
            return venueAlreadyConnectedResponse(venueMatch.strategyName);
          }
          // Unresolvable: the colliding key exists but no strategy hangs off it
          // (an orphan), or the resolver is dark. Fall through to the 409 below
          // — honest enough for a race, and deliberately NOT a new
          // WizardErrorCode: minting one would move the copy-table pins
          // (EXPECTED_TABLE_SIZE) for a state the user cannot act on
          // differently anyway.
          // (154.1: the code minted for the `connected` arm above deliberately
          // does NOT extend to this one. Here we could not establish that a
          // strategy holds the account at all, and asserting it would be the
          // same class of unearned claim in the opposite direction.)
        } else if (
          constraint !== null &&
          !WIZARD_SESSION_CONSTRAINTS.has(constraint)
        ) {
          // ⛔ A NAMED CONSTRAINT WE DO NOT RECOGNISE — FAIL LOUD, NEVER
          // MIS-REPORT. Answering DRAFT_ALREADY_EXISTS here would tell the user
          // a specific, checkable thing that is false, and would bury the
          // arrival of a new constraint on this path in a 409 nobody reads.
          // The name is safe to log and to tag: it comes from `message`, which
          // Postgres composes from catalog names only.
          console.error(
            "[strategies/create-with-key] 23505 named an UNRECOGNISED constraint:",
            constraint,
          );
          captureToSentry(error, {
            tags: {
              surface: "strategies-create-with-key",
              step: "draft-rpc-unknown-constraint",
            },
            extra: { pg_code: error.code, constraint },
            secrets: [
              api_key,
              apiSecretNormalized,
              passphraseOrNull,
              venueAccountId,
            ],
          });
          return NextResponse.json(
            { code: "UNKNOWN", error: "Could not create draft strategy" },
            { status: 500, headers: NO_STORE_HEADERS },
          );
        }
        // The wizard-session fence, or a 23505 whose message named no
        // constraint at all. ⭐ BYTE-IDENTICAL to the pre-154 arm — an
        // unparseable name is the UNKNOWN case and must keep the behaviour that
        // shipped, not invent a new one from an absence.
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
    // Most of what the classifier DID recognise is excluded for free and for
    // the policy's own reasons: `SERVICE_UNAVAILABLE_RETRY` is the breaker
    // short-circuit, `KEY_NETWORK_TIMEOUT` the timeout, and every
    // `KEY_INVALID_SIGNATURE` / `KEY_AUTH_FAILED` / `KEY_MT5_*` verdict is a
    // caller fault. None of those is our defect and none should page anyone.
    //
    // ⭐ BUT "RECOGNISED" STOPPED MEANING "NOT OURS" AT 153.7-02, WHICH IS WHY
    // THE PREDICATE IS A SET AND NO LONGER `code === "UNKNOWN"` (153.7 review
    // WR-02). That plan gave `INTERNAL` and `ADAPTER_INIT_FAILED` verdict rows
    // resolving to `SEAM_INTERNAL_FAULT`. Both are OUR defect by the Python
    // emitter's own words — `INTERNAL` is literally `validate_key_permissions`'
    // unclassified-exception escape — and before that commit both resolved to
    // `UNKNOWN` and PAGED. Classifying a fault better is not a reason to stop
    // hearing about it, so the population is now named explicitly in
    // `OUR_DEFECT_KEY_ERROR_CODES` (shared, one set, both key routes) instead of
    // being inferred from the classifier's terminal. The sentence above and the
    // code below now say the same thing again.
    //
    // ⚠️ PLACEMENT IS DELIBERATE — AFTER the classify call and BEFORE the
    // `headers` computation, so this route's breaker cell (CONTEXT: "the best in
    // the audit") is left exactly as it was: the caught VALUE still reaches the
    // shared classifier unmodified, the status is still derived from the
    // classifier, and the conditional `Retry-After` below still branches on the
    // same `err instanceof CircuitOpenError`.
    if (OUR_DEFECT_KEY_ERROR_CODES.has(code)) {
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
