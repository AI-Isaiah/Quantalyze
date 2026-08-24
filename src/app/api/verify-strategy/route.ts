import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { assertSameOrigin } from "@/lib/csrf";
import { UI_EXCHANGE_CODES } from "@/lib/utils";
import { isSfoxEnabledServer, type SupportedExchange } from "@/lib/closed-sets";
import {
  publicIpLimiter,
  checkLimit,
  getClientIp,
  rateLimitDenyJson,
} from "@/lib/ratelimit";
import { postProcessKey } from "@/lib/process-key-client";
// 140.3-13a / SEAMUX-08 — the ONE lazy-Sentry helper, applied under the SINGLE
// capture policy written out in full in `src/app/api/admin/match/eval/route.ts`.
//
// ⚠️ THIS ROUTE IS STILL THE SECRET-BEARING ONE OF THIS PLAN'S FOUR. WHAT THE
// BOUNDARY CARRIES TODAY (Phase 146.1 / B2, 2026-08-18): the caller's RAW
// exchange `api_key` / `api_secret`, which this handler puts in the OUTGOING
// REQUEST BODY. It no longer carries a live end-user Supabase JWT — the
// `X-User-Access-Token` forward that TS-15 added was removed here because the
// only reader on the far side has zero callers (see the B2 block below the
// teaser context). No module-level env list can know a value that arrived in
// THIS request, so every capture below still names them in `secrets: [...]` —
// that argument is the ONLY thing standing between undici's header-inlining
// (TRAP-1) and a credential leaving our infrastructure for a third party.
// `140.3-02` closed a live end-user JWT log leak; adding an observability
// channel must not re-open it through Sentry instead.
import { captureToSentry } from "@/lib/sentry-capture";
// 140.4-07 / SEAMRIM-06 — the same per-request credentials the block above
// names for Sentry apply verbatim to the CONSOLE. Until this import, they were
// applied to Sentry ONLY, and the three console sites below logged the caught
// value raw — on the PUBLIC, anonymous route that declares them.
import { scrubSeamError } from "@/lib/seam-redaction";

/**
 * Phase 140 / SEAM-02 — pinned for clarity; asserted against
 * SEAM_ROUTE_BUDGETS by seam-budgets.invariant.test.
 *
 * 300 is the project's VERIFIED effective Vercel default
 * (`defaultResourceConfig.functionDefaultTimeout: 300`, read from the live
 * project settings on 2026-07-25), so declaring it here cannot raise this
 * route's worst-case lambda hold. It exists so the SC-4b headroom invariant
 * has an in-repo source of truth instead of a dashboard-changeable
 * assumption: this route spends one `process-key-sync` budget (60s — the
 * teaser runs the full pipeline INLINE), 5× headroom.
 */
export const maxDuration = 300;

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
    // 140.4-13 / SEAMRIM-05 — the 503-vs-429 decision is the CHOKEPOINT'S, not
    // this route's. Before this, every deny here was a 429, so an Upstash
    // outage told an anonymous visitor evaluating us for the first time that
    // THEY were being throttled. `rateLimitDenyJson` answers 503 on
    // `ratelimit_misconfigured` so the outage reaches the canary instead.
    //
    // No options: this route's genuine 429 body and headers ALREADY are the
    // builder's defaults — `{error: "Too many requests"}` with `Retry-After`
    // and nothing else (it is the one seam route with no NO_STORE_HEADERS).
    // Byte-identical by construction rather than by transcription.
    return rateLimitDenyJson(rl);
  }

  // ── Phase 140.3-G4 / SEAMUX-03 — a machine code on EVERY arm this PUBLIC
  // teaser route emits, so a client discriminates the fault on a stable token
  // instead of sniffing prose. This is an UNAUTHENTICATED route: every token
  // below is a closed-set clean token — it never names an env var, hostname, or
  // internal service.
  //
  // ── 161-09 / WIZERR-08 — THE FIVE REQUEST-SHAPE ARMS STOP SHARING ONE CODE.
  // They all answered `KEY_INVALID_FORMAT`, mirroring create-with-key before
  // 142.2 split that code into four. Only ONE of the five is a format failure.
  //
  //   · unreadable body      → KEY_MISSING_REQUIRED_FIELD. The union comment
  //     defines that code as covering exactly "a field the form requires
  //     arrived empty, OR the body was not a readable object".
  //   · missing fields       → KEY_MISSING_REQUIRED_FIELD.
  //   · malformed email      → KEY_INVALID_FORMAT, RETAINED. A present value
  //     whose SHAPE is wrong is a format failure, and none of the four split
  //     codes is true of it: it is not missing, not a venue property, not a
  //     length cap. ⚠️ `KEY_INVALID_FORMAT`'s union comment reserves "exactly
  //     ONE emitter per route" for the two WIZARD connect routes and their
  //     `api_secret.length < 8` ccxt check. That rule is about those routes;
  //     this is a different route with different facts, and forcing a FALSE
  //     code here to satisfy a rule written about other routes would be the
  //     defect this phase exists to remove, wearing a compliance badge.
  //   · unsupported exchange → KEY_UNSUPPORTED_VENUE.
  //   · sfox server gate     → KEY_VENUE_NOT_ENABLED (see the F3 note at the arm).
  //
  // ⛔ CODES ONLY ON THIS ROUTE (threat T-161-27). Every SENTENCE below is
  // byte-identical, and that is not caution — it is the disclosure boundary
  // itself. MEASURED at HEAD, 2026-08-24: the only consumer,
  // `src/components/landing/VerificationForm.tsx`, renders
  // `human_message ?? error ?? "Verification failed"` and NEVER READS `code`.
  // The two occurrences of the word "code" in that file are both in comments.
  // So on this route the code channel is machine-only and the sentence is the
  // sole public disclosure surface: re-coding an arm cannot widen what an
  // anonymous caller learns, and moving a sentence would.
  //
  // ⚠️ KEY ORDER IS DELIBERATELY LEFT AS `{ error, code }` HERE, unlike the
  // sibling `keys/validate-and-encrypt`, which 161-09 reordered to `code:`-first.
  // Every coverage law in this repo derives its population with a `code:`-first
  // predicate, so these nine arms are invisible to all of them — MEASURED at
  // HEAD: the derivation over this file returns ZERO. That is recorded rather
  // than fixed because no law watches this route and no consumer reads its
  // codes, so a reorder here would be churn on a PUBLIC route whose diff the
  // threat register (T-161-27) requires to stay minimal and auditable. The day
  // a law or a consumer arrives, the reorder comes with it.
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body", code: "KEY_MISSING_REQUIRED_FIELD" },
      { status: 400 },
    );
  }

  const { email, exchange, api_key, api_secret } = body as {
    email?: string;
    exchange?: string;
    api_key?: string;
    api_secret?: string;
  };

  if (!email || !exchange || !api_key || !api_secret) {
    return NextResponse.json(
      {
        error: "Missing required fields: email, exchange, api_key, api_secret",
        code: "KEY_MISSING_REQUIRED_FIELD",
      },
      { status: 400 },
    );
  }

  if (!isValidEmail(email)) {
    // 161-09 / WIZERR-08 — `KEY_INVALID_FORMAT` is KEPT here, deliberately, and
    // this is the split landing CORRECTLY rather than the split failing. A
    // present value whose shape is wrong is the one fact on this route that IS
    // a format failure. See the fact→code mapping in the block above for why
    // the "one emitter per route" rule does not reach this route.
    return NextResponse.json(
      { error: "Invalid email address", code: "KEY_INVALID_FORMAT" },
      { status: 400 },
    );
  }

  // F3 (Phase 122): gate this PUBLIC/unauthenticated teaser verify on the
  // user-facing OFFERED set (UI_EXCHANGE_CODES — what the landing VerificationForm
  // actually presents), NOT the wider key-save allowlist SUPPORTED_EXCHANGES.
  // SUPPORTED_EXCHANGES was widened to admit sfox (119/122) for the AUTHENTICATED
  // wizard key-save; leaking it here (a) DISCLOSED sfox in the error enum to anon
  // callers pre-launch, and (b) half-accepted sfox (this route allowed it, then the
  // Python teaser flow rejects source=sfox with a confusing 422). Gating on the
  // offered set gives sfox a clean "Unsupported exchange" and stops the disclosure
  // until SFOX_ENABLED flips the offer on. The disclosed enum tracks the offer.
  if (!UI_EXCHANGE_CODES.includes(exchange as SupportedExchange)) {
    return NextResponse.json(
      {
        error: `Unsupported exchange. Supported: ${UI_EXCHANGE_CODES.join(", ")}`,
        code: "KEY_UNSUPPORTED_VENUE",
      },
      { status: 400 },
    );
  }

  // Structural server gate (parity with the 3 authenticated key routes): fail
  // CLOSED on the SERVER go-live flag, not just the client offer flag. With
  // NEXT_PUBLIC_SFOX_ENABLED=true but SFOX_ENABLED unset (the documented
  // half-state), UI_EXCHANGE_CODES above would admit sfox; this ensures the
  // public teaser cannot forward a live sfox key-process before go-live either.
  if (exchange.toLowerCase() === "sfox" && !isSfoxEnabledServer()) {
    // 161-09 / WIZERR-08 + F3 — `KEY_VENUE_NOT_ENABLED`, because it is TRUE of
    // this fact: we SUPPORT sfox, it is not open here yet. The alternative,
    // `KEY_UNSUPPORTED_VENUE`, carries the copy "We do not support that
    // exchange" — false of a venue we do support, and chosen only to guard
    // against a hypothetical future leak. Trading a present falsehood for a
    // future one is the wrong trade in a phase about false sentences.
    //
    // THE DISCLOSURE IS BOUNDED BY ORDERING, not by the code. The
    // UI_EXCHANGE_CODES gate above runs FIRST, so this arm is reachable ONLY
    // when sfox IS in the offered set — the documented NEXT_PUBLIC_SFOX_ENABLED
    // on / SFOX_ENABLED off half-state. It cannot name a venue the landing form
    // was not already offering. That ordering is pinned by a test, not
    // inherited: reversing the two gates reddens it.
    //
    // ⚠️⚠️ LATENT HAZARD, RECORDED SO A FUTURE CONSUMER MUST RE-DECIDE RATHER
    // THAN INHERIT. `KEY_VENUE_NOT_ENABLED`'s copy entry reads "This exchange is
    // not open on Quantalyze yet." No anonymous surface maps this route's codes
    // to wizard copy today (measured: VerificationForm never reads `code`), so
    // nothing renders it. The DAY any anonymous surface starts translating
    // these codes into `WIZARD_ERROR_COPY`, that sentence WOULD leak a
    // coming-soon signal about an unlaunched venue, and F3 must be re-decided
    // AT THAT MOMENT — not assumed settled because this line already existed.
    return NextResponse.json(
      { error: "sFOX integration is not yet available.", code: "KEY_VENUE_NOT_ENABLED" },
      { status: 400 },
    );
  }

  // Phase 106 Stage B (D2): the unified backbone is the sole verify path.
  // Public-route protections (CSRF + IP rate-limit + payload validation) run
  // above, before delegation. The former flag-off legacyVerifyStrategyHandler
  // arm was deleted; the kill-switch reader was deleted in 106-10 (backbone
  // permanent-on).
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
 * (the `<VerificationForm/>` in src/components/landing/VerificationForm.tsx) requires `data.public_token`
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

  /**
   * 146.2 / R2 (2026-08-19) — THE request-body credentials, enumerated ONCE.
   *
   * ⛔ A NEW BODY CREDENTIAL IS ADDED HERE AND NOWHERE ELSE. Both consumers
   * below derive from this object: the outgoing `teaserContext` (what LEAVES)
   * and `perRequestSecrets` (what gets SCRUBBED before crossing to Sentry).
   * Typing a credential directly into either one is the defect this shape
   * exists to prevent.
   *
   * ⚠️ WHY THE STRUCTURE, not just a third literal. 146.1 left
   * `perRequestSecrets` naming `api_key`/`api_secret` while `teaserContext`
   * forwarded a `passphrase` as well. On OKX / KuCoin / Coinbase that
   * passphrase is a first-class exchange credential — key + secret + passphrase
   * IS the account — and undici inlines the outgoing body into `err.message`
   * (TRAP-1), so it crossed to a third party in the clear from all four capture
   * sites below. Two hand-maintained lists over one set drift; one declaration
   * with two derived readers cannot.
   *
   * ⚠️ THIS IS STILL AN ALLOWLIST, so PR-X5 below holds. The keys are literals
   * written here, never keys taken from the caller's body — the spread cannot
   * introduce a field an attacker named.
   */
  const bodyCredentials = {
    api_key: body.api_key,
    api_secret: body.api_secret,
    passphrase: body.passphrase,
  };

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
    // The wire shape is UNCHANGED: a credential the caller omitted is dropped
    // rather than sent as `undefined` (which `JSON.stringify` in
    // `process-key-client` would drop anyway). The filter generalises the
    // old `if (body.passphrase !== undefined)` conditional to every member,
    // so the omission rule does not have to be re-typed per credential.
    ...Object.fromEntries(
      Object.entries(bodyCredentials).filter(([, v]) => v !== undefined),
    ),
  };

  /**
   * Phase 146.1 / B2 (2026-08-18) — THE FORWARD WAS REMOVED HERE, at BOTH sites.
   *
   * This block used to read the request's Supabase session and hand the
   * resulting LIVE end-user JWT to `postProcessKey` (which set it as
   * `X-User-Access-Token`) and to `perRequestSecrets` below. The v1.19 xhigh
   * review measured the far side: the only Python reader,
   * `services/db.py get_user_scoped_supabase`, has ZERO production callers, and
   * the `not hasattr(..., "get_user_scoped_supabase")` gate in
  // `analytics-service/tests/test_process_key.py` actively PINS that
   * non-use. Nothing in `analytics-service` reads the header at all.
   *
   * ⚠️ THIS ROUTE IS PUBLIC, so the removal is strictly a reduction. The old
   * shape was session-conditional precisely because a FABRICATED value on an
   * unauthenticated route would be elevation of privilege; forwarding NOTHING
   * on every path is the same guarantee with no live credential in flight. The
   * `verify-strategy` "no session forwards nothing" seam case is retained and
   * unchanged — it is the proof the inversion did not simply delete assertions.
   *
   * The 140.2 obligation that justified the forward is DISCHARGED BY
   * SUBSTITUTION, not abandoned: the ownership pre-check is already shipped as
   * the explicit Python `strategies` id+user_id filter
   * (`_caller_owns_strategy` in `analytics-service/routers/process_key.py`). See
   * `.planning/phases/140.1-.../140.1-TS-OBLIGATIONS.md` TS-15 for the dated
   * superseding note and the NOT-TAKEN option (b).
   *
   * ⛔ The header name STAYS on `resilient-fetch.ts`'s CREDENTIAL_HEADER_NAMES
   * scrub enumeration on purpose — that scrub DERIVES its per-request secrets
   * from the outgoing headers, so it covers whatever this seam carries next.
   */

  /**
   * 140.3-13a / SEAMUX-08 — the per-request credentials every `captureToSentry`
   * in this handler must name.
   *
   * Declared ONCE, here, rather than re-typed at each of the four call sites:
   * four sites each remembering the same values is the instance-not-class shape
   * this programme has already paid for, and the failure mode is silent — a
   * capture that forgets one still succeeds, still looks correct in review, and
   * ships the credential to a third party.
   *
   * ⛔ THIS ARRAY MUST NOT SHRINK AND MUST NOT BE DELETED, AND IT IS NO LONGER
   * WRITTEN OUT BY HAND. Phase 146.1 / B2 removed ONE member
   * (`userAccessToken`) because the route stopped forwarding it, NOT because
   * per-request scrubbing stopped mattering — and in doing so it left behind an
   * enumeration that READ complete ("both remaining members") while naming two
   * of the three credentials actually in flight. 146.2 / R2 replaced the
   * hand-written array with `Object.values(bodyCredentials)`, the SAME
   * declaration the outgoing body is built from, so the two can no longer
   * disagree about what the caller sent.
   *
   * All THREE members are unknowable to any module-level env list:
   *   · `api_key` / `api_secret` / `passphrase` — the caller's RAW exchange
   *     credentials, which this handler puts in the outgoing request BODY.
   *     undici inlines that body into `err.message` (TRAP-1) and nothing in
   *     `SEAM_SECRET_ENV_NAMES` can reach a value that arrived in the request.
   *     On OKX / KuCoin / Coinbase the `passphrase` is not an extra: it is the
   *     third of three credentials that together ARE the account.
   *
   * ⚠️ `undefined` members are harmless — `scrubSeamString` skips non-strings —
   * so a body field the caller omitted needs no separate array. That is why the
   * scrub array takes every member UNCONDITIONALLY while the outgoing body
   * still omits the absent ones.
   */
  const perRequestSecrets: readonly unknown[] = Object.values(bodyCredentials);

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

  /**
   * Phase 140.3-02 / TS-12 + TS-14 — SUCCESS IS DECIDED BY THE ENVELOPE'S OWN
   * `ok`, NEVER BY SNIFFING A FIELD AND NEVER BY THE STATUS.
   *
   * ⚠️ WHY NOT THE STATUS (fold-in M-6 from the 140.1 code review). `validate-only`
   * answers **200 with `ok:false`** where `_scope_rejected` answers **403**, on the
   * IDENTICAL `not val.valid` predicate. It was judged a deliberate carve-out, but
   * it contradicts the contract and `STATUS_CONTRACT.md` records the exception
   * nowhere. A consumer branching on STATUS is therefore wrong on one of the two
   * paths no matter which status it picks. Branching on `ok` is correct on both.
   * Do NOT "simplify" this back to a status check.
   *
   * ⚠️ WHY NOT `verification_id`. This used to read
   * `typeof upstream.verification_id === "string"` and call that success. The
   * Python terminal-success builder's own docstring names THIS site as the shape
   * consumers used to SNIFF, and adds `ok: true` + an explicit `code: null` so
   * they stop. A sniff cannot tell a success carrying an id from a FAILURE
   * carrying one — and treating the latter as success mints a queryable
   * public_token and publishes a teaser factsheet for a key the exchange rejected.
   *
   * ⚠️ THE SHAPE GUARD BELOW IS NOT DEAD — a FINDING against TS-12's premise,
   * recorded here rather than silently satisfied. TS-12 called the 502 fallback's
   * rejection case dead and said to delete the guard. Its REJECTION trigger IS
   * dead: a rejection now returns at `!result.ok` above and never reaches here.
   * Its DRIFT trigger is not. A 2xx whose body lost `verification_id` still
   * arrives, and without the guard this route answers 200 with a public_token
   * persisted against `.eq("id", null)` — a token queryable against no row. That
   * is the "silent success on failure" defect this phase exists to close, and the
   * exact twin of the `isUuid` guard TS-13 explicitly says to KEEP one route over.
   * So the guard stays; only its RATIONALE narrows, and both halves are named in
   * the log line so an operator can tell which one fired.
   */
  const verificationId =
    typeof upstream.verification_id === "string" ? upstream.verification_id : null;
  if (upstream.ok !== true || !verificationId) {
    // 140.3-13a / SEAMUX-08 — the CONTRACT-VIOLATION half of the capture policy
    // (`admin/match/eval/route.ts`). A 2xx we cannot use is not a caller fault
    // and not an expected infrastructure condition: either the upstream said
    // `ok:false` on a 2xx, or its terminal-success builder dropped
    // `verification_id`. Both are drift in a contract only we can fix, and
    // neither produces any other alert — the caller just sees a 502.
    //
    // A SYNTHETIC Error, deliberately: the raw upstream body carries
    // `encrypted_credentials` and is never handed to Sentry, exactly as the
    // console line below already refuses to log it.
    captureToSentry(
      new Error("verify-strategy: upstream 2xx is not a usable verification"),
      {
        tags: { surface: "verify-strategy", step: "upstream-contract" },
        extra: {
          ok: String(upstream.ok),
          upstream_code:
            typeof upstream.code === "string" ? upstream.code : null,
          has_verification_id: verificationId !== null,
        },
        secrets: perRequestSecrets,
      },
    );
    console.error(
      "[verify-strategy] upstream 2xx is not a usable verification:",
      {
        // Diagnostics only — never the body, which carries encrypted_credentials.
        ok: upstream.ok,
        upstream_code: typeof upstream.code === "string" ? upstream.code : null,
        has_verification_id: verificationId !== null,
        correlation_id:
          typeof upstream.correlation_id === "string"
            ? upstream.correlation_id
            : null,
      },
    );
    // SEAMUX-03: an answer ARRIVED (a 2xx) that we could not recognise —
    // UNKNOWN, the repo's terminal/unclassified fallback. NOT SERVICE_UNREACHABLE
    // ("we sent it and never got an answer" — false here) nor
    // UPSTREAM_NETWORK_ERROR (no transport fault occurred).
    return NextResponse.json(
      { error: "Verification service returned an invalid response", code: "UNKNOWN" },
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
    // 140.3-13a / SEAMUX-08 — TERMINAL, UNCLASSIFIED. 🔴 The comment above
    // ALREADY promised this fault would be "loud in logs/Sentry", and until
    // this line the Sentry half of that sentence was false: `grep -c
    // captureToSentry` on this file read 0. The claim is now true rather than
    // removed, because a service-role client that will not construct is a
    // permanent config fault that takes the whole anonymous teaser down and
    // nothing else reports it.
    //
    // `secrets` names all three per-request credentials: a Supabase client
    // constructor error can inline the key it was handed, and this handler is
    // holding the caller's raw exchange material at the same time.
    captureToSentry(configErr, {
      tags: { surface: "verify-strategy", step: "admin-client-config" },
      level: "fatal",
      secrets: perRequestSecrets,
    });
    console.error(
      "[verify-strategy] createAdminClient config error:",
      scrubSeamError(configErr, perRequestSecrets),
    );
    // SEAMUX-03: OUR configuration fault (a service-role client that will not
    // construct), nothing the caller did — SEAM_MISCONFIGURED (union member).
    return NextResponse.json(
      { error: "Verification service misconfigured", code: "SEAM_MISCONFIGURED" },
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
      // 140.3-13a / SEAMUX-08 — TERMINAL, UNCLASSIFIED. The verification ran and
      // succeeded upstream; only OUR write of the public_token failed, so the
      // user is told "Failed to finalize" for work that already happened. There
      // is no typed branch above this and no other alert on the path.
      captureToSentry(persistError, {
        tags: { surface: "verify-strategy", step: "public-token-persist" },
        secrets: perRequestSecrets,
      });
      console.error(
        "[verify-strategy] CT-3 public_token persist failed:",
        scrubSeamError(persistError, perRequestSecrets),
      );
      // SEAMUX-03: a Supabase write about US failed (the verification succeeded
      // upstream; only our public_token write did not) — VERIFY_PERSIST_FAILED,
      // a new route token on the keys/sync DRAFT_LOOKUP_FAILED precedent. The
      // thrown twin below carries the SAME token (same fact ⇒ same token).
      return NextResponse.json(
        { error: "Failed to finalize verification", code: "VERIFY_PERSIST_FAILED" },
        { status: 500 },
      );
    }
  } catch (err) {
    // The THROWN twin of the arm above — a transport failure reaching Supabase
    // rather than a returned PostgrestError. Same policy arm, same secrets, and
    // separately captured because the two are separately reachable.
    captureToSentry(err, {
      tags: { surface: "verify-strategy", step: "public-token-persist-threw" },
      secrets: perRequestSecrets,
    });
    console.error(
      "[verify-strategy] CT-3 public_token persist threw:",
      scrubSeamError(err, perRequestSecrets),
    );
    // SEAMUX-03: the THROWN twin of the returned-error arm above — same fact
    // (our persist write failed), same token.
    return NextResponse.json(
      { error: "Failed to finalize verification", code: "VERIFY_PERSIST_FAILED" },
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
