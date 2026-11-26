import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { assertSameOrigin } from "@/lib/csrf";
import * as approvalGate from "@/lib/api/approval-gate";
import { isUuid } from "@/lib/utils";
import { userActionLimiter, checkLimit, rateLimitDenyJson } from "@/lib/ratelimit";
import {
  classifyKeyValidationError,
  OUR_DEFECT_KEY_ERROR_CODES,
} from "@/lib/wizardErrors";
import { buildEnvelope } from "@/lib/envelope";
import { rotateKeySecret } from "@/lib/analytics-client";
import { persistRotatedMt5Secret } from "@/lib/api/rotate-key-secret";
import type { RotateSecretResponseSchema } from "@/lib/analytics-schemas";
import { getCorrelationId } from "@/lib/correlation-id";
import { NO_STORE_HEADERS } from "@/lib/api/headers";
import { scrubSeamError } from "@/lib/seam-redaction";
import { captureToSentry } from "@/lib/sentry-capture";
import type { z } from "zod";

/**
 * PATCH /api/keys/[id]/rotate-secret
 *
 * Phase 164.5.3 / MT5CREDS — D-04's credential-update path. Today a wrong MT5
 * investor password is fixable ONLY by Delete + Add Key, which destroys the
 * row's id and its entire sync history. This route lets the owner correct it
 * in place, WITHOUT ever accepting a new login or broker server (D-03) and
 * WITHOUT ever persisting a credential this server has not itself re-validated
 * against the live broker (D-04).
 *
 * Body: `{ new_secret: string }` — the NEW investor password only. There is no
 * field anywhere in the parsed body type for a login or a broker server; both
 * are recovered server-side, inside the Python seam, from the row's OWN stored
 * ciphertext. Changing the account identity is what Delete + Add Key is for.
 *
 * ⛔ CREDENTIAL HANDLING. This route never decrypts, never logs and never
 * echoes `new_secret` — it is forwarded to the Python seam over the internal
 * VPC hop and named explicitly at every `scrubSeamError`/`captureToSentry`
 * call so a stringified request init can never leak it into a log line or
 * Sentry event (SEAMCORE-06).
 *
 * ── ROUTE SKELETON, AND WHY IT IS NOT `withAuth` (CONTEXT.md decision) ──────
 *
 * `withAuth`'s handler signature is `(req, user) => Promise<NextResponse>` and
 * its wrapper does NOT forward a Next.js dynamic-route `{ params }` argument —
 * `keys/[id]/permissions/route.ts`'s own manual URL-path id parse is the
 * compatibility shim that exists because of this, and CONTEXT.md's
 * route-skeleton note says not to copy it. This route instead hand-rolls the
 * SAME stack `withAuth` composes — `assertSameOrigin`, `createClient().auth.
 * getUser()`, `approvalGate.assertProfileApproved(supabase, user.id)` (all
 * imported directly, the exact primitives `withAuth` itself calls) — combined
 * with the MODERN `{ params }: { params: Promise<{ id: string }> }` signature
 * `strategies/[id]/name/route.ts` uses. Same defended posture, modern params.
 *
 * ── ORDER, AND WHY IT IS LOAD-BEARING ────────────────────────────────────────
 *
 *   1. CSRF (assertSameOrigin)             — first line, before any query.
 *   2. Session (auth.getUser)               — 401 DASHBOARD_SIGNED_OUT.
 *   3. Profile approval (approvalGate)      — denial returned verbatim.
 *   4. UUID shape on `id`                   — 400 DASHBOARD_REQUEST_INVALID.
 *   5. Body shape on `new_secret`           — 400 NEW_SECRET_REQUIRED
 *      (field-level, stays OUT of the ErrorEnvelope system — mirrors
 *      `strategies/[id]/name`'s NAME_REQUIRED treatment: a field-level refusal
 *      lands inline at the field, not behind a correlation id). ⛔ NEVER an
 *      8-character floor — MT5 investor passwords skip the ccxt length gate,
 *      per `create-with-key/route.ts`'s own comment; non-blank is the only
 *      rule.
 *   6. Ownership + venue-shape read, via the USER-SCOPED client (RLS applies,
 *      safe for a read). Absent row or foreign `user_id` → ONE honest 404
 *      (DASHBOARD_ROW_STALE) that never distinguishes "wrong owner" from
 *      "unknown id" — mirrors `strategies/[id]/name`'s stated rationale, and
 *      is safe here for the identical reason: ownership is resolved BEFORE
 *      the venue check below ever runs, so a caller who reaches the venue
 *      arm has already proven ownership of the row it describes. A non-MT5
 *      key answers 400 KEY_UPDATE_UNSUPPORTED_VENUE BEFORE any rate limit or
 *      seam call — never a live probe burned on a shape the route can never
 *      accept.
 *   7. Rate limit AFTER validation, BEFORE the seam call — `userActionLimiter`
 *      keyed `keys-rotate-secret:<uid>`, the same bucket family and ordering
 *      every `keys/**` mutation route already uses (a rejected request never
 *      burns a token; the caller's own request shape is what dictated it).
 *   8. The Python seam call (`resilientFetch("keys-rotate-secret", ...)`,
 *      which lives in `rotateKeySecret` in src/lib/analytics-client.ts since
 *      Phase 228, shared with create-with-key's MT5 same-account arm) —
 *      decrypts the stored row, re-validates the NEW password against the
 *      live broker, re-encrypts on success. NEVER retried
 *      (`retriesOverride: 0`): this is the identical non-idempotent
 *      live-credential probe `validate-key-serialized` already refuses to
 *      retry, for the identical reason (D-07 in `resilient-fetch.ts`).
 *   9. On a non-ok seam response: extract the human message the same way
 *      `keys/[id]/permissions/route.ts`'s `seamHumanMessage` does, ALSO carry
 *      the machine `seamCode` (164.5.3 review / WR-01) as an own property on
 *      the thrown `Error`, and classify it in the catch below via
 *      `classifyKeyValidationError` — the SAME classifier
 *      `create-with-key`/`validate-and-encrypt`/`composite/add-key` already
 *      use. Because the Python endpoint lets `_validate_mt5_key`'s own
 *      exceptions propagate UNCHANGED, the MT5-specific failures require ZERO
 *      new `WizardErrorCode` entries: the classifier's existing substring
 *      cascade already recognises `AUTH_FAILED_DETAIL` /
 *      `MT5_MASTER_PASSWORD_DETAIL` / `MT5_WRONG_SERVER_DETAIL`. The
 *      service-error-shaped failures (`RATE_LIMITED`, `KEK_UNAVAILABLE`,
 *      `MT5_GATEWAY_UNCONFIGURED`) route through the carried `seamCode` into
 *      the classifier's existing `VENUE_WIRE_CODE_TO_VERDICT` rows instead of
 *      falling to the terminal UNKNOWN. ⛔ CORRECTED
 *      2026-10-07 (Phase 164.6.6.3.2 D-01): `MT5_GATEWAY_UNCONFIGURED` is now the D-31
 *      `undetermined` arm's code alone (rendering `SEAM_INTERNAL_FAULT`); the three
 *      env-gap arms answer `MT5_VALIDATION_UNCONFIGURED` and render
 *      `KEY_MT5_VALIDATION_UNCONFIGURED`, through the same `seamCode` hop. Original
 *      sentence kept as lineage. ⭐ 164.5.4-02 / D-03 added the FOURTH
 *      of that family and the only one that needed a new member:
 *      `KEY_UNDECRYPTABLE` — the stored row this endpoint must decrypt before
 *      it can re-secret anything — now routes to `KEY_MUST_BE_RECONNECTED`,
 *      whose envelope is NOT recoverable, so the founder reads the reconnect
 *      remedy instead of a Retry that re-reads the same unreadable copy. See
 *      the seam-failure throw site's own block for why the ROW and the MINT
 *      were both required. NOTHING is persisted on this branch
 *      (D-04's "a failed validation mutates nothing").
 *  10. On success: `createAdminClient()` (D-07 — `api_keys` UPDATE is fully
 *      REVOKEd from `authenticated`, so a user-scoped `.update()` would
 *      42501; the admin write is ownership-scoped by the SAME explicit
 *      `.eq("user_id", ...)` filter a user-scoped client would have relied on
 *      RLS for). The UPDATE payload carries the four ciphertext columns,
 *      `sync_error: null`, `sync_status: "idle"` (CR-01 — cleared ONLY here,
 *      in the SAME statement as the validated write, never on submission
 *      alone; see the persist arm's own comment for why `is_active` and
 *      `disconnected_at` are deliberately NOT touched), and — ONLY when the
 *      pre-read row's `venue_account_id` was NULL — the login the seam
 *      response asserts. A `23505` naming `VENUE_IDENTITY_CONSTRAINT`
 *      (Pitfall 1 — the venue-identity backfill collides with a DIFFERENT
 *      live row for the same account) retries WITHOUT the backfill once
 *      (WR-02 — the password fix and status clear must not be discarded for a
 *      collision on an OPTIONAL field), then answers a distinct 409
 *      `KEY_VENUE_ALREADY_CONNECTED` only if that retry also collides,
 *      matching Plan 02's identical arm on the create path (same code, same
 *      copy — one vocabulary for one condition). Zero updated rows (the row
 *      vanished between the read and the write) or a genuine transport/DB
 *      fault both answer `DASHBOARD_WRITE_INDETERMINATE` at 500 — reusing
 *      `strategies/[id]/name/route.ts`'s own code and sentence for "an UPDATE
 *      was sent and this arm cannot verify whether it landed" — never a
 *      silent 200.
 *
 * `code:` is written FIRST in every literal rejection body — the coverage
 * laws in this repo derive their populations with a `code:`-first predicate
 * (`wizardErrors.invariant.test.ts`, `dialog-envelope.invariant.test.ts`), so
 * an arm written `{ error, code }` is invisible to all of them.
 */

export const maxDuration = 300;

interface RotateSecretBody {
  new_secret?: unknown;
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const csrfError = assertSameOrigin(req);
  if (csrfError) return csrfError;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json(
      { code: "DASHBOARD_SIGNED_OUT", error: "unauthorized" },
      { status: 401, headers: NO_STORE_HEADERS },
    );
  }

  const denied = await approvalGate.assertProfileApproved(supabase, user.id);
  if (denied) return denied;

  const { id } = await params;
  if (!isUuid(id)) {
    return NextResponse.json(
      { code: "DASHBOARD_REQUEST_INVALID", error: "id must be a UUID" },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  let body: RotateSecretBody;
  try {
    body = (await req.json()) as RotateSecretBody;
  } catch (err) {
    // MEDIUM (164.5.3 review) — `scrubSeamError` redacts EXACT-VALUE secret
    // matches; it CANNOT help here. A `JSON.parse` `SyntaxError` embeds an
    // ARBITRARY WINDOW of the raw body chosen by V8 — a FRAGMENT, not the
    // full body, and not (yet) the known `new_secret` value, since parsing is
    // what failed. Measured on node v25.8.1:
    // `JSON.parse('[{"new_secret":"…QZ9X4K"},]')` throws `Unexpected token
    // ']', ...""},]" is not valid JSON` — a fragment of the secret — and the
    // FULL raw body is NOT itself a substring of that message, so
    // `scrubSeamString`'s exact-match check (`out.includes(candidate.value)`)
    // would never fire on it even if handed the raw body as a per-request
    // secret (confirmed: a request already 400s here with the JSON body
    // never reaching a scrubbable form). The safe answer for THIS one catch
    // site is to log the error's TYPE only — computed into its own binding
    // BEFORE the console call so neither the bare `err` identifier nor its
    // `.message`/`.name`/`.stack` text ever reaches a log sink (`.constructor`
    // is not one of `seam-log-coverage.test.ts`'s TEXT_CARRYING_PROPERTIES,
    // and correctly so — a class name carries no part of the parsed body).
    // The type is the entire actionable diagnostic value a malformed-JSON 400
    // needs anyway; the client already learns "invalid json" from the body.
    const bodyParseFailureKind = err instanceof Error ? err.constructor.name : typeof err;
    console.error(
      "[api/keys/[id]/rotate-secret] body parse failed:",
      bodyParseFailureKind,
      { userId: user.id },
    );
    return NextResponse.json(
      { code: "DASHBOARD_REQUEST_INVALID", error: "invalid json" },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  // D-03: the ONLY credential field this route reads is `new_secret`. There is
  // no login or broker-server field anywhere in `RotateSecretBody` for a
  // caller to even attempt to supply. Non-blank is the only gate — ⛔ never an
  // 8-character floor (MT5 investor passwords skip the ccxt format check, per
  // `create-with-key/route.ts`'s own comment on the same fact).
  if (typeof body.new_secret !== "string" || body.new_secret.trim().length === 0) {
    return NextResponse.json(
      { code: "NEW_SECRET_REQUIRED", error: "invalid secret" },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }
  const newSecret = body.new_secret;

  // Ownership + venue-shape read, via the USER-SCOPED client (RLS applies,
  // safe to use for a read). `disconnected_at` and `is_active` are read ONLY
  // to decide whether the persist write below returns the key to live (167.1.2
  // C4 review CR-01); neither is ever written by this route.
  const { data: keyRow, error: keyErr } = await supabase
    .from("api_keys")
    .select("id, user_id, exchange, venue_account_id, disconnected_at, is_active")
    .eq("id", id)
    .maybeSingle();

  if (keyErr) {
    console.error(
      "[api/keys/[id]/rotate-secret] ownership lookup failed:",
      scrubSeamError(keyErr),
    );
    return NextResponse.json(
      { code: "DASHBOARD_WRITE_INDETERMINATE", error: "internal error" },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }
  if (!keyRow || keyRow.user_id !== user.id) {
    // ONE honest 404 — never distinguishes wrong owner from unknown id.
    return NextResponse.json(
      { code: "DASHBOARD_ROW_STALE", error: "key not found" },
      { status: 404, headers: NO_STORE_HEADERS },
    );
  }
  if (keyRow.exchange !== "mt5") {
    // Safe to disclose: ownership of THIS row is already confirmed above, so
    // this only tells the caller the venue of a row they already own.
    return NextResponse.json(
      {
        code: "KEY_UPDATE_UNSUPPORTED_VENUE",
        error: "Only MT5 keys support password rotation.",
      },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  const rl = await checkLimit(userActionLimiter, `keys-rotate-secret:${user.id}`);
  if (!rl.success) {
    // CR-03 (164.5.3 review) — `rateLimitDenyJson`'s bare fallback body carries
    // NO `code`. `UpdateMt5SecretDialog` reads `body?.code`, gets `undefined`,
    // and renders the UNKNOWN envelope — "we cannot tell you whether your last
    // action took effect", with a Retry — both false for a cap we imposed
    // ourselves, and the Retry re-trips the same bucket. Supply both bodies so
    // the dialog can recognise its own route's throttle, mirroring
    // `strategies/create-with-key/route.ts`'s identical arm.
    return rateLimitDenyJson(rl, {
      headers: NO_STORE_HEADERS,
      throttledBody: { code: "RATE_LIMITED", error: "Too many requests" },
      misconfiguredBody: {
        code: "SEAM_MISCONFIGURED",
        error: "Rate limiter unavailable",
      },
    });
  }

  const correlationId = await getCorrelationId();

  let parsed: z.infer<typeof RotateSecretResponseSchema>;
  try {
    // Phase 228: the seam call, its non-ok arm (seamCode, status and name
    // carried as own properties) and the schema parse moved VERBATIM into
    // `rotateKeySecret` (src/lib/analytics-client.ts), shared with the MT5
    // same-account arm of create-with-key. The catch below is unchanged.
    parsed = await rotateKeySecret({ keyId: id, userId: user.id, newSecret, correlationId });
  } catch (err) {
    // D-04: NOTHING is persisted on this branch — the classifier below only
    // ever produces a response, never a write.
    const perRequestSecrets = [newSecret];
    console.error(
      "[api/keys/[id]/rotate-secret] validation failed:",
      scrubSeamError(err, perRequestSecrets),
    );
    const { code, status } = classifyKeyValidationError(err);
    // 164.6.5 review round 2 / R2-SFH-10 — page OUR OWN defects, exactly as
    // `create-with-key` and `composite/add-key` do at their twin arm, and on
    // the SAME shared set (`OUR_DEFECT_KEY_ERROR_CODES`), so the three key
    // routes cannot disagree about what pages. Before this, a wedged gateway
    // terminal (`KEY_MT5_TERMINAL_UNRESPONSIVE`) reached through THIS route went
    // only to `console.error`, while the comment beside the Python probe's
    // `logger.error` said the Next-side key routes page it.
    //
    // ⚠️ One wedged validate therefore produces TWO Sentry events: the Python
    // probe's `logger.error` and this capture. Recorded as noise and KEPT: each
    // carries context the other lacks (the terminal's IPC code there; which
    // key route the user was on here), and neither side can see whether the
    // other's reporting is wired.
    if (OUR_DEFECT_KEY_ERROR_CODES.has(code)) {
      captureToSentry(err, {
        tags: { surface: "keys-rotate-secret", step: "unclassified-key-error" },
        extra: { exchange: keyRow.exchange },
        secrets: perRequestSecrets,
      });
    }
    const envelope = buildEnvelope(code, correlationId);
    return NextResponse.json(envelope, { status, headers: NO_STORE_HEADERS });
  }

  // ── PERSIST ARM (D-07) ──────────────────────────────────────────────────
  // `api_keys` UPDATE is fully REVOKEd from `authenticated` with no re-grant
  // (migration 20260810120000) — a user-scoped `.update()` here would 42501,
  // not degrade gracefully. `createAdminClient()` THROWS when
  // SUPABASE_SERVICE_ROLE_KEY is absent, caught here rather than left to
  // crash, same posture as `validate-and-encrypt`'s persist arm.
  let admin: ReturnType<typeof createAdminClient>;
  try {
    admin = createAdminClient();
  } catch (adminErr) {
    console.error(
      "[api/keys/[id]/rotate-secret] persist arm unavailable — no service credential:",
      scrubSeamError(adminErr, [newSecret]),
    );
    captureToSentry(adminErr, {
      tags: { route: "api/keys/[id]/rotate-secret", arm: "persist" },
      secrets: [newSecret],
    });
    return NextResponse.json(
      { code: "SEAM_MISCONFIGURED", error: "Service credential unavailable" },
      { status: 503, headers: NO_STORE_HEADERS },
    );
  }

  // Phase 228: the owner-scoped UPDATE (filtered on `id` + `user_id` +
  // `exchange = 'mt5'`), the venue_account_id backfill fence, the 23505 retry,
  // the zero-row check and the audit moved into `persistRotatedMt5Secret`
  // (src/lib/api/rotate-key-secret.ts), shared with create-with-key's MT5
  // same-account arm. CR-01, WR-02, WR-03, 167.1.2 C4 and Phase 225 W4 are
  // explained there, beside the code. Each typed result maps to the literal
  // this route answered before the move.
  // @audit-skip: the api_key.rotate_secret audit lands inside persistRotatedMt5Secret (src/lib/api/rotate-key-secret.ts), in the same function as its UPDATE.
  const persisted = await persistRotatedMt5Secret({
    admin,
    supabase,
    userId: user.id,
    keyId: id,
    keyRow,
    parsed,
  });

  if (persisted.kind === "holder_read_failed") {
    const holderReadSecrets = [newSecret, parsed.venue_account_id];
    console.error(
      "[api/keys/[id]/rotate-secret] same-account holder read failed; refusing the rotate (nothing was written):",
      scrubSeamError(persisted.error, holderReadSecrets),
    );
    captureToSentry(persisted.error, {
      tags: { route: "api/keys/[id]/rotate-secret", arm: "persist", step: "holder-read" },
      secrets: holderReadSecrets,
    });
    return NextResponse.json(
      {
        code: "UNKNOWN",
        error: "We could not check whether this account is already connected. Please try again.",
      },
      { status: 503, headers: NO_STORE_HEADERS },
    );
  }
  if (persisted.kind === "venue_collision") {
    // Pitfall 1 — same code and copy as the create path's identical arm: one
    // vocabulary for one condition.
    return NextResponse.json(
      {
        code: "KEY_VENUE_ALREADY_CONNECTED",
        error: "You already have a connected key for this account.",
      },
      { status: 409, headers: NO_STORE_HEADERS },
    );
  }
  if (persisted.kind === "write_failed") {
    console.error(
      "[api/keys/[id]/rotate-secret] persist UPDATE failed:",
      scrubSeamError(persisted.error),
    );
    return NextResponse.json(
      { code: "DASHBOARD_WRITE_INDETERMINATE", error: "internal error" },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }
  if (persisted.kind === "write_zero_rows") {
    // The row vanished (or changed venue) between the ownership read and the
    // write — reusing DASHBOARD_ROW_STALE would misreport a row this request
    // just proved it owns as "not found".
    console.error(
      "[api/keys/[id]/rotate-secret] persist UPDATE matched zero rows after a validated seam success",
    );
    return NextResponse.json(
      { code: "DASHBOARD_WRITE_INDETERMINATE", error: "internal error" },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }

  return NextResponse.json({ ok: true }, { headers: NO_STORE_HEADERS });
}
