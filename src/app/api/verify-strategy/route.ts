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
import { createClient } from "@/lib/supabase/server";
// 140.3-13a / SEAMUX-08 — the ONE lazy-Sentry helper, applied under the SINGLE
// capture policy written out in full in `src/app/api/admin/match/eval/route.ts`.
//
// ⚠️ THIS ROUTE IS THE SECRET-BEARING ONE OF THIS PLAN'S FOUR. It holds a LIVE
// user Supabase JWT (`userAccessToken`, forwarded by TS-15) and the caller's
// RAW exchange `api_key` / `api_secret` from the request body. No module-level
// env list can know those three values, so every capture below names them in
// `secrets: [...]` — that argument is the ONLY thing standing between undici's
// header-inlining (TRAP-1) and a credential leaving our infrastructure for a
// third party. `140.3-02` closed a live end-user JWT log leak one wave-set ago;
// adding an observability channel must not re-open it through Sentry instead.
import { captureToSentry } from "@/lib/sentry-capture";
// 140.4-07 / SEAMRIM-06 — the same three per-request credentials the block above
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
  // instead of sniffing prose. Mirrors 140.3-10's arm-by-arm pass on keys/sync
  // and the sibling create-with-key, which codes all five of these request-shape
  // rejections `KEY_INVALID_FORMAT` (incl. the byte-identical sfox sentence).
  // This is an UNAUTHENTICATED route: every token below is a closed-set clean
  // token — it never names an env var, hostname, or internal service.
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body", code: "KEY_INVALID_FORMAT" },
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
        code: "KEY_INVALID_FORMAT",
      },
      { status: 400 },
    );
  }

  if (!isValidEmail(email)) {
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
        code: "KEY_INVALID_FORMAT",
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
    return NextResponse.json(
      { error: "sFOX integration is not yet available.", code: "KEY_INVALID_FORMAT" },
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

  /**
   * Phase 140.3-02 / TS-15 — forward the end user's Supabase access token WHEN,
   * AND ONLY WHEN, one exists.
   *
   * ⚠️ THIS ROUTE IS PUBLIC, AND THAT IS THE WHOLE REASON THE READ IS SHAPED
   * THIS WAY. The landing-page teaser is unauthenticated by design (CSRF +
   * per-IP limit + payload validation are its only gates), but nothing stops an
   * ALREADY SIGNED-IN visitor from submitting it. Those two cases must diverge:
   *   · a session exists  → forward it, so the unified router can build a
   *     user-scoped, RLS-enforcing client for this caller.
   *   · no session        → forward NOTHING. The header is optional by
   *     construction and a fabricated one would be an elevation-of-privilege
   *     bug, not a compatibility shim. There is no fallback value here, and
   *     there must never be one.
   *
   * The read is best-effort and TOTAL: `createClient()` reads request cookies,
   * and a public endpoint must not 500 because a cookie jar was unreadable. A
   * failure degrades to the anonymous case, which is this route's normal case.
   *
   * ⚠️ The value is handed to `postProcessKey` as a VALUE, never assembled into
   * a header here, so it reaches `scrubSeamError(message, [userAccessToken])` at
   * the client's transport log site — undici embeds outgoing headers in
   * `err.message`, and this one is a live user JWT.
   */
  let userAccessToken: string | undefined;
  try {
    const authClient = await createClient();
    const {
      data: { session },
    } = await authClient.auth.getSession();
    userAccessToken = session?.access_token;
  } catch {
    // Anonymous is the expected case on this route — not worth a log line.
    userAccessToken = undefined;
  }

  /**
   * 140.3-13a / SEAMUX-08 — the per-request credentials every `captureToSentry`
   * in this handler must name.
   *
   * Declared ONCE, here, rather than re-typed at each of the four call sites:
   * four sites each remembering three values is the instance-not-class shape
   * this programme has already paid for, and the failure mode is silent — a
   * capture that forgets one still succeeds, still looks correct in review, and
   * ships the credential to a third party.
   *
   * All three are unknowable to any module-level env list:
   *   · `userAccessToken` — a LIVE end-user Supabase JWT (TS-15 forwards it, so
   *     undici can inline it into an outgoing-header error message: TRAP-1);
   *   · `api_key` / `api_secret` — the caller's RAW exchange credentials, which
   *     this handler puts in the outgoing request body.
   *
   * ⚠️ `undefined` members are harmless — `scrubSeamString` skips non-strings —
   * so the anonymous case (no session) needs no separate array.
   */
  const perRequestSecrets: readonly unknown[] = [
    userAccessToken,
    body.api_key,
    body.api_secret,
  ];

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
    // TS-15 — present ONLY when a session was readable; see the block above.
    userAccessToken,
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
