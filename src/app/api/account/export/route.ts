import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { assertSameOrigin } from "@/lib/csrf";
import {
  exportLimiter,
  checkLimit,
  getClientIp,
} from "@/lib/ratelimit";
import { NO_STORE_HEADERS } from "@/lib/api/headers";
import { logAuditEvent } from "@/lib/audit";
import {
  collectUserExportBundle,
  encodeExportBundle,
  rowsForTable,
} from "@/lib/gdpr-export";

/**
 * Audit-2026-05-07 C-0022 / C-0023 (red-team c8): sanitize-loop chain.
 *
 * Migration 055 sanitize_user PRESERVES the auth.users row and only
 * anonymizes the profiles columns — it does NOT invalidate the user's
 * session. A sanitized user can log back in (the JWT remains valid)
 * and call POST /api/account/export, receiving a bundle containing
 * their pre-sanitize audit_log history and cross-party rows (which
 * sanitize_user preserves by design). GDPR Art. 17 "right to erasure"
 * silently becomes "right to keep accessing your erased data via Art.
 * 15". Defense: gate the export route on the post-sanitize sentinel
 * (`profiles.display_name = '[deleted]'`); a sanitized user gets 403
 * with a stable code so client + ops can recognise the state.
 *
 * The sentinel is set on the FIRST sanitize_user run (migration 055
 * step 1 — see migrations/20260417110538_sanitize_user.sql). A
 * subsequent sign-out hardening (separate from this PR) is the proper
 * upstream fix; this gate is defense-in-depth for the window where a
 * sanitized session token is still in circulation.
 */
const SANITIZED_DISPLAY_NAME_SENTINEL = "[deleted]";

/**
 * POST /api/account/export
 *
 * GDPR Art. 15 (right of access) + Art. 20 (data portability).
 *
 * Sprint 6 closeout Task 7.3. The route:
 *   1. Asserts same-origin + authenticated caller.
 *   2. Consumes one token from `exportLimiter` (1/day/user).
 *   3. Assembles the export bundle (see `src/lib/gdpr-export.ts` —
 *      enumerates every user_id-referencing table).
 *   4. Uploads the JSON bundle to the `gdpr-exports` bucket under
 *      `{user_id}/{uuid}.json` (migration 055 created the bucket +
 *      owner-read RLS).
 *   5. Returns a 1-hour signed URL (Supabase `createSignedUrl`).
 *   6. Emits an `account.export` audit event.
 *
 * The response is a JSON envelope, NOT the bundle inline — the bundle
 * can be up to 100MB and is served via the storage URL. The envelope
 * holds the URL, the expiry, and a summary so the client can render a
 * download link without re-fetching.
 *
 * POST vs GET: POST because the call is side-effectful (uploads a new
 * bundle per call) and the CSRF same-origin helper is POST-biased. A
 * future GET wrapper that returns the most recent bundle without
 * regenerating is tracked as a convenience follow-up.
 *
 * Audit-2026-05-07 C-0025 (api-contract c9) — idempotency trade-off
 * -----------------------------------------------------------------
 * This route is NOT idempotent. Every POST mints a fresh
 * `${user_id}/${randomUUID()}.json` object and bills a new signed URL
 * even when called twice in the same session. Combined with the
 * `exportLimiter` (1/day/user), this means a retry after a flaky
 * download burns the daily allowance — regulator-visible but practically
 * punitive.
 *
 * Trade-off documented (NOT a regression):
 *
 *   - Adding GET /api/account/export/latest that re-signs the most-
 *     recent in-bucket object without minting a new bundle is the
 *     proper convenience fix. It is intentionally OUT OF SCOPE for the
 *     C-0021/C-0022/C-0023 security closure. The retry-burn problem is
 *     real but does not violate GDPR Art. 15 (the user CAN re-export
 *     tomorrow, which is what the regulator requires).
 *
 *   - The refusal-path refunds added by audit-2026-05-07 red-team #2
 *     (size_cap_exceeded, per_table_row_cap_reached, upload_failed,
 *     sign_failed, manifest_drift) already address the dominant lockout
 *     mode: a deterministic failure on the user's data shape would
 *     otherwise permanently consume the 1/day token because the data
 *     shape doesn't change. Token refund on those branches keeps the
 *     cadence intact while preventing the per-data-shape lockout.
 *
 *   - The remaining retry-burn surface is the happy-path "user
 *     downloaded the bundle but the browser crashed before saving"
 *     case. That is the GET-wrapper's job; it is on the follow-up
 *     backlog. Until then, the documented operator action is: contact
 *     support to reset the user's exportLimiter bucket out-of-band.
 *
 * This docstring is the load-bearing acknowledgement of the trade-off.
 * A future contributor who refactors the route MUST either preserve
 * this trade-off or ship the GET wrapper — they cannot silently change
 * the contract because the contract is documented here.
 */

const SIGNED_URL_EXPIRY_SECONDS = 60 * 60; // 1 hour, per Task 7.3 spec.
const EXPORTS_BUCKET = "gdpr-exports";

/**
 * Audit-2026-05-07 red-team R-0006 (MED c8): module-local counter of
 * refund failures. Bumped on every refund no-op-in-production AND on
 * every `resetUsedTokens` throw. Reset only by process restart. Exposed
 * via {@link getExportRefundFailureCount} for /api/health (and tests).
 *
 * Mirrors the `auditEmitTransientFailures` shape in src/lib/audit.ts so
 * a future /api/health implementation can compose both counters into
 * the same canary surface.
 */
let exportRefundFailureCount = 0;

function bumpRefundFailureCount(): void {
  exportRefundFailureCount += 1;
}

/**
 * Read the module-local refund-failure counter. Exposed for tests and
 * future /api/health wiring.
 */
export function getExportRefundFailureCount(): number {
  return exportRefundFailureCount;
}

/** Test-only reset hook. Not exported via barrel; tests import directly. */
export function __resetExportRefundFailureCountForTests(): void {
  exportRefundFailureCount = 0;
}

/**
 * Audit-2026-05-07 red-team R-0008 (MED c8): refund-bucket-wipe race.
 *
 * Upstash sliding-window's `resetUsedTokens` clears the entire bucket
 * for a key — not a single token. A user double-clicking the export
 * button (or a slow-network retry) can land two concurrent in-flight
 * POSTs. Request A: consumes the 1/day token, hits a refusal path
 * (partial bundle, upload-fail, sign-fail), refunds → bucket cleared.
 * Request B: was 429'd at the limiter (rl.success=false → 429); a
 * third click (C) now succeeds because the refund wiped the window.
 * Net: a deliberate concurrent-click attacker can drive the 1/day cap
 * above its regulatory ceiling.
 *
 * Defense: in-process serialization. Track an in-flight Promise per
 * user; the second concurrent request awaits the first's completion
 * before consuming a token, so the limiter sees the calls
 * sequentially and the refund-after-refusal lands on the correct
 * bucket state. Same-lambda only — Vercel routes concurrent invocations
 * to fresh isolates beyond a single warm container, so the protection
 * is best-effort across cold-start frontiers. A second click hitting a
 * cold isolate is the same risk as before; the same-warm-container
 * race is the dominant abuse pattern (autoclickers, double-click UI
 * bugs), and that's what this closes.
 */
const inFlightExportsByUser = new Map<string, Promise<unknown>>();

/** Test-only inspection of in-flight tracking. Returns the count. */
export function __getInFlightExportsCountForTests(): number {
  return inFlightExportsByUser.size;
}

/** Test-only reset of the in-flight map. */
export function __resetInFlightExportsForTests(): void {
  inFlightExportsByUser.clear();
}

/**
 * Audit-2026-05-07 H-0200 (code-reviewer c9): the audit row for an
 * Art. 15 export must carry the requesting IP + UA so a leaked-JWT
 * exfiltration can be reconstructed forensically. Uses the shared
 * `getClientIp` helper from `@/lib/ratelimit` (already the canonical
 * x-real-ip/x-forwarded-for parser used by rate-limit bucketing) for
 * consistency. `null` is returned in place of "unknown" so the
 * audit_log JSONB is explicit about the absence.
 */
function readRequestFingerprint(req: NextRequest): {
  ip: string | null;
  user_agent: string | null;
} {
  const rawIp = getClientIp(req.headers);
  const ip = rawIp === "unknown" ? null : rawIp;
  const user_agent = req.headers.get("user-agent") || null;
  return { ip, user_agent };
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  // CSRF defense-in-depth: reject before touching Upstash or Supabase.
  const csrfError = assertSameOrigin(req);
  if (csrfError) return csrfError;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401, headers: NO_STORE_HEADERS },
    );
  }

  // Audit-2026-05-07 red-team R-0008 (MED c8): serialize same-user
  // concurrent POSTs through an in-process Promise queue. A second
  // click within the same warm container awaits the first's full
  // resolution (including refund) before consuming a token, closing
  // the bucket-wipe race where a refund-after-refusal clears the entire
  // sliding-window so a third click rides through. See the
  // inFlightExportsByUser docstring for the threat model.
  const pending = inFlightExportsByUser.get(user.id);
  if (pending) {
    try {
      await pending;
    } catch {
      // The prior call's error is its own response; we only block on
      // its completion to serialize the token consumption.
    }
  }
  let resolveInFlight: (value: unknown) => void = () => {};
  const inFlight = new Promise((resolve) => {
    resolveInFlight = resolve;
  });
  inFlightExportsByUser.set(user.id, inFlight);
  try {
    return await handleExportRequest(req, supabase, user);
  } finally {
    resolveInFlight(undefined);
    if (inFlightExportsByUser.get(user.id) === inFlight) {
      inFlightExportsByUser.delete(user.id);
    }
  }
}

/**
 * Audit-2026-05-07 red-team R-0008: inner handler that the serialized
 * POST wrapper drives. Hoisted here so the per-user lock can wrap a
 * single function call without indenting the original logic three
 * levels deeper.
 */
async function handleExportRequest(
  req: NextRequest,
  supabase: Awaited<ReturnType<typeof createClient>>,
  user: { id: string },
): Promise<NextResponse> {

  // Audit-2026-05-07 C-0022 / C-0023 (red-team c8): sanitize-loop gate.
  // A user whose profile has been anonymized via migration-055
  // `sanitize_user` (display_name='[deleted]' sentinel) must NOT be
  // able to re-mint a full PII bundle for themselves. See the
  // SANITIZED_DISPLAY_NAME_SENTINEL doc above for rationale. This is
  // defense-in-depth — the proper fix is sign-out on sanitize, but the
  // 403 here closes the window for any sanitized session token still in
  // circulation.
  //
  // We use the user-scoped supabase client (auth.uid()=caller) so the
  // RLS policy on profiles (owner-can-read) gates correctly without
  // requiring service-role privileges for the gate check.
  const { data: callerProfile } = await supabase
    .from("profiles")
    .select("display_name")
    .eq("id", user.id)
    .maybeSingle();
  if (
    callerProfile &&
    typeof callerProfile.display_name === "string" &&
    callerProfile.display_name === SANITIZED_DISPLAY_NAME_SENTINEL
  ) {
    return NextResponse.json(
      {
        error: "Account sanitized — exports unavailable.",
        code: "account_sanitized",
      },
      { status: 403, headers: NO_STORE_HEADERS },
    );
  }

  // 1/day/user bucket. The Upstash sliding window covers a rolling 24h
  // so a user who exported yesterday at 09:00 cannot export today until
  // 09:00 — matching the regulatory cadence the task spec commits to.
  const rateLimitKey = `export:${user.id}`;
  const rl = await checkLimit(exportLimiter, rateLimitKey);
  if (!rl.success) {
    // H-0015 (audit 2026-05-25): a throttled export must leave a
    // forensic trail. Pre-fix the 429 short-circuited before any
    // logAuditEvent call, so a credential-export probing storm
    // (repeated 429s) produced NO audit signal for SecOps. Emit a
    // dedicated `account.export_rate_limited` event before returning,
    // carrying the request fingerprint so the source of a probe is
    // reconstructable. Same fire-and-forget shape as the other emits
    // in this route.
    const fingerprint = readRequestFingerprint(req);
    logAuditEvent(supabase, {
      action: "account.export_rate_limited",
      entity_type: "user",
      entity_id: user.id,
      metadata: {
        retry_after: rl.retryAfter,
        ip: fingerprint.ip,
        user_agent: fingerprint.user_agent,
      },
    });
    return NextResponse.json(
      { error: "Export limit reached — try again later." },
      {
        status: 429,
        headers: {
          ...NO_STORE_HEADERS,
          "Retry-After": String(rl.retryAfter),
        },
      },
    );
  }

  // Audit-2026-05-07 H-0200 (code-reviewer c9): capture request
  // fingerprint up-front so every audit-emit path (success / refusal /
  // upload-fail / sign-fail) records identical context.
  const fingerprint = readRequestFingerprint(req);

  // Audit-2026-05-07 C-0021 (security c9): runtime assertion that the
  // bundle helper receives the auth-derived user id and ONLY that id.
  // The defense-in-depth concern is a future refactor (admin export
  // wrapper, fan-out worker) that mistakenly reuses
  // `collectUserExportBundle` against an attacker-supplied user id.
  // Holding the binding here (`const exportSubjectId = user.id`) and
  // never accepting a request-body alternative locks the helper's
  // userId parameter to the actor for the lifetime of this route.
  const exportSubjectId = user.id;

  const admin = createAdminClient();

  // Audit 2026-05-07 red-team #2 (HIGH conf-8): on refusal, refund the
  // 1/day token. Pre-fix, a user whose data hit ANY truncation cap
  // (size/row/parent-id) consumed their 1/day token, got 500, and was
  // permanently locked out — the truncation is deterministic per data
  // set, so the next day's retry hits the exact same refusal. A
  // regulator-visible GDPR Art. 15 violation. Token refund preserves
  // the rate cap (a user still cannot grind through unlimited exports)
  // while making the refusal pathway non-lockout. The refund call is
  // best-effort: if it fails (Upstash blip) the user retries tomorrow
  // — same as today's worst case.
  //
  // Audit-2026-05-07 red-team R-0006 (MED c8): the null-guard
  // silently no-ops in dev/preview. Surface that branch loudly in
  // production (a null limiter means UPSTASH env vars are missing, which
  // is a deploy misconfig the canary should detect) and bump the
  // module-local counter on every refund failure so /api/health can
  // expose it via getRefundFailureCount alongside the audit-emit
  // counter. Without the counter, a network-blip throw is swallowed and
  // a regression where the refund silently no-ops in prod would land
  // green.
  const refundRateLimitToken = async (reason: string): Promise<void> => {
    if (!exportLimiter) {
      if (process.env.VERCEL_ENV === "production") {
        console.warn(
          `[api/account/export] refund skipped (${reason}) — exportLimiter is null in production (UPSTASH misconfig).`,
        );
        bumpRefundFailureCount();
      }
      return;
    }
    try {
      await exportLimiter.resetUsedTokens(rateLimitKey);
    } catch (err) {
      bumpRefundFailureCount();
      console.error(
        `[api/account/export] rate-limit refund failed (${reason}):`,
        err instanceof Error ? err.message : err,
      );
    }
  };

  // Assemble the bundle across all user-owned tables. Uses the admin
  // client because the bundle spans tables with divergent RLS shapes
  // (owner-only, cross-party, service-role-only).
  //
  // C-0021 enforcement: pass `exportSubjectId` (the auth-derived id),
  // NEVER a request-body or path-param value.
  const bundle = await collectUserExportBundle(admin, exportSubjectId);

  // Audit 2026-05-07 (specialist apply): GDPR Art. 15 requires a
  // COMPLETE export. The route refuses to mint a signed URL whenever
  // the bundle is incomplete for ANY reason — fetch failure, size
  // cap, per-table row cap, or parent-id cap. Pre-fix the partial-
  // gate only handled fetch failures; the three truncation modes
  // shipped a 200 OK with a signed URL and advisory `incomplete_reasons`.
  // That mixed two policies on identical "incomplete export" modes:
  // "complete or nothing" for fetch errors, "partial and warn" for
  // truncation. The specialist apply extends the gate so all four
  // modes return the same refusal shape (200 OK is reserved for a
  // genuinely complete bundle). The user retries on the next rate-
  // limit window. Policy (b) — deliver a partial bundle — was
  // rejected because a regulator receiving a flagged-partial export
  // would still see it as a data-protection deficiency.
  //
  // Finding 2 (audit-2026-05-07 red-team): the failed_tables list is
  // schema reconnaissance — exposing which internal tables exist (and
  // which currently error) gives an attacker the map they need to
  // tune subsequent probes. Strip it from the client-facing body and
  // log it server-side only, correlated by a request_id the user can
  // quote to support so we can find the matching log line. The same
  // policy applies to the row-cap / size-cap / parent-id truncation
  // table lists.
  const rowCappedTables = bundle.tables
    .filter((t) => t.truncated_at_cap)
    .map((t) => t.table);
  const incompleteReasons: string[] = [];
  if (bundle.truncated_at_size_cap) {
    incompleteReasons.push(
      "size_cap_exceeded:bundle exceeded 100MB cap; oldest-first packing kept the earliest rows.",
    );
  }
  if (rowCappedTables.length > 0) {
    incompleteReasons.push(
      `per_table_row_cap_reached:${rowCappedTables.join(",")} — only the first 50000 rows are included per table.`,
    );
  }
  if (bundle.parent_id_truncated_tables.length > 0) {
    incompleteReasons.push(
      `parent_id_cap_reached:${bundle.parent_id_truncated_tables.join(",")} — only the first 2000 parent rows are included; child rows of dropped parents are missing.`,
    );
  }

  if (bundle.partial || incompleteReasons.length > 0) {
    const requestId = crypto.randomUUID();
    console.error("[api/account/export] refusing to mint signed URL — incomplete bundle:", {
      request_id: requestId,
      user_id: user.id,
      partial: bundle.partial,
      failed_tables: bundle.failed_tables,
      truncated_at_size_cap: bundle.truncated_at_size_cap,
      row_capped_tables: rowCappedTables,
      parent_id_truncated_tables: bundle.parent_id_truncated_tables,
      incomplete_reasons: incompleteReasons,
    });
    // Audit 2026-05-07 red-team #2 (HIGH conf-8): refund the 1/day
    // rate-limit token BEFORE the audit emit / response build. Refusal
    // is deterministic on data shape — without a refund the user is
    // permanently locked out of GDPR Art. 15 fulfilment by their own
    // data volume. The refund happens before audit so a subsequent
    // retry within the same lambda warm window observes the refund.
    await refundRateLimitToken(
      bundle.partial ? "export_partial" : "export_truncated",
    );

    // Audit the refusal so forensic reconstruction of "why this user
    // got 500" survives the response-body discard. The metadata is
    // also the only durable trail of which truncations occurred — if
    // a regulator later asks "did the controller ever know about this
    // user's truncation", the audit row is the answer.
    //
    // Audit 2026-05-07 red-team #1 (HIGH conf-9): the previous version
    // wrote the verbatim table-name lists (row_capped_tables,
    // parent_id_truncated_tables, incomplete_reasons strings with
    // comma-joined table names) into audit_log.metadata under
    // user_id=subject. redactAuditLogForUser retains the row (subject
    // is actor), and metadata is NOT in AUDIT_METADATA_REDACT_KEYS —
    // so the same schema reconnaissance the body strip blocked rode
    // back into the next successful export's bundle. We now strip the
    // table-name detail from the audit metadata: only the truncation
    // booleans and counts ride along. Support reproduces from
    // request_id + server log; the booleans answer "did this user hit
    // truncation" for regulator forensics without revealing which
    // internal tables. The full table-name lists remain on the
    // console.error above (server-only durable forensics).
    logAuditEvent(supabase, {
      action: "account.export_refused",
      entity_type: "user",
      entity_id: exportSubjectId,
      metadata: {
        request_id: requestId,
        partial: bundle.partial,
        truncated_at_size_cap: bundle.truncated_at_size_cap,
        // Aggregate counts only — NOT table names. The boolean per-mode
        // signals + counts give a regulator-visible "did the controller
        // know" trail without bundling internal schema reconnaissance.
        row_capped_table_count: rowCappedTables.length,
        parent_id_truncated_table_count:
          bundle.parent_id_truncated_tables.length,
        failed_table_count: bundle.failed_tables.length,
        // Audit-2026-05-07 H-0200 (code-reviewer c9): IP + UA on every
        // emit path — a stolen-token export must be reconstructable
        // even when it lands on the refusal branch.
        ip: fingerprint.ip,
        user_agent: fingerprint.user_agent,
      },
    });
    return NextResponse.json(
      {
        error: bundle.partial
          ? "Some tables failed to export. Please retry — GDPR Art. 15 requires a complete bundle."
          : "Your data exceeds export limits and a complete bundle cannot be produced automatically. Please contact support — GDPR Art. 15 requires a complete bundle.",
        code: bundle.partial ? "export_partial" : "export_truncated",
        request_id: requestId,
      },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }

  // Audit 2026-05-07 red-team #7 (MED conf-9): wire `rowsForTable`
  // into the production download path. The helper returns `null` (not
  // `[]`) when a table is missing from the bundle — schema drift /
  // manifest typo. Reading the subject's own `profiles` row through
  // the typed helper makes the null-vs-`[]` distinction load-bearing:
  // a future refactor that drops `profiles` from USER_EXPORT_TABLES
  // will return null here and surface a 500 with a deterministic
  // diagnostic, instead of silently shipping a bundle whose
  // identifying-row is missing.
  //
  // We invoke the helper on `profiles` specifically because the CI
  // coverage hook (`scripts/check-gdpr-export-coverage.ts`) pins this
  // table as user-owned via migration 005's `profiles.id = auth.users.id`
  // FK. A miss here means the manifest no longer matches the migration.
  const profilesRows = rowsForTable(bundle, "profiles");
  if (profilesRows === null) {
    console.error(
      "[api/account/export] manifest drift detected — profiles missing from bundle:",
      { user_id: exportSubjectId, table_count: bundle.tables.length },
    );
    await refundRateLimitToken("manifest_drift");
    return NextResponse.json(
      {
        error: "Export manifest drift — please contact support.",
        code: "export_manifest_drift",
      },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }

  // Upload to storage. Path: `{user_id}/{uuid}.json`. The owner-read
  // RLS policy in migration 055 gates by `storage.foldername(name)[1]`
  // so the user prefix MUST be the auth.uid() text.
  //
  // Audit 2026-05-07 (specialist apply, performance HIGH conf-9):
  // pre-apply the route ran `new TextEncoder().encode(JSON.stringify(bundle))`,
  // which re-stringified every row a second time even though
  // `collectUserExportBundle` had already serialized each row once
  // for the cumulative-size budget. For a 50,000-row table at ~800
  // bytes/row this was ~40MB of redundant CPU and ~80MB of
  // intermediate string allocations. Peak heap held the bundle
  // object + the 100MB string + the 100MB Uint8Array simultaneously
  // — ~300MB peak on a 1024MB Fluid lambda. The new
  // `encodeExportBundle` stitches the upload directly from the
  // cached per-row JSON strings stored on `ExportTablePayload.__cached_rows_json`,
  // skipping the redundant pass entirely. Peak heap drops to bundle
  // + Uint8Array (~200MB) because the intermediate JSON string is
  // never materialized.
  //
  // The true streaming refactor (pipe directly into Supabase Storage
  // multipart upload) remains queued for a follow-up sprint; the
  // single-pass encode keeps headroom within budget until then.
  const objectKey = `${exportSubjectId}/${crypto.randomUUID()}.json`;
  const bundleBytes = encodeExportBundle(bundle);

  // Audit-2026-05-07 H-0202 / H-0203 (red-team c8 / security c8):
  // do NOT persist the raw `objectKey` (containing the user_id +
  // unguessable UUID + bucket name) into audit_log.metadata. Storage
  // bucket RLS is the single point of failure for this URL space — a
  // future migration that types the foldername filter (or revokes the
  // owner-read policy) turns the audit-log CSV stream into a
  // treasure-map for an attacker enumerating historical bundle paths.
  // We store a SHA-256 hash of the object key instead: ops can still
  // reconcile a known objectKey against the audit row by hashing it
  // (operator-supplied input), but reading the audit row alone yields
  // an opaque hex that is useless without the bucket key.
  const objectKeyHash = crypto
    .createHash("sha256")
    .update(objectKey)
    .digest("hex");

  // Audit-2026-05-07 H-0202 ops-reconcile note: the raw objectKey is
  // server-only durable forensics (Vercel function logs). Ops with
  // the user's user_id can recover the objectKey from these logs and
  // rehash to find the matching audit row.
  console.info("[api/account/export] objectKey assigned", {
    user_id: exportSubjectId,
    object_key: objectKey,
    object_key_sha256: objectKeyHash,
  });

  const { error: uploadErr } = await admin.storage
    .from(EXPORTS_BUCKET)
    .upload(objectKey, bundleBytes, {
      contentType: "application/json",
      upsert: false,
    });
  if (uploadErr) {
    console.error("[api/account/export] upload failed:", uploadErr.message);
    // Audit-2026-05-07 red-team R8 (MED c8): refund the 1/day token on
    // upload failure. Pre-fix, a transient storage blip consumed the
    // user's 1/day budget — equivalent to the regulator-visible lockout
    // path the original red-team #2 already documented for the refusal
    // branches. Best-effort refund (same try/catch swallow as the
    // refusal-path refund).
    await refundRateLimitToken("upload_failed");
    // Audit-2026-05-07 H-0201 (code-reviewer c8): emit a refused-audit
    // even when the upload itself failed — the bundle WAS assembled
    // (every user-owned table was SELECTed via service_role and held
    // in memory). For a forensic question "did the controller ever
    // decrypt/aggregate user X's data?" the answer must be discoverable
    // from audit_log, not silently absorbed by the 500 response.
    logAuditEvent(supabase, {
      action: "account.export_refused",
      entity_type: "user",
      entity_id: exportSubjectId,
      metadata: {
        partial: bundle.partial,
        truncated_at_size_cap: bundle.truncated_at_size_cap,
        reason: "upload_failed",
        ip: fingerprint.ip,
        user_agent: fingerprint.user_agent,
      },
    });
    return NextResponse.json(
      { error: "Failed to upload export bundle" },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }

  // Sign for 1 hour. `createSignedUrl` returns `null` data on failure.
  // If signing fails, we MUST remove the just-uploaded object — otherwise
  // an orphan bundle sits in the bucket forever (the 1-per-day rate limit
  // means the user can't retry and trigger an `upsert: true` overwrite).
  const { data: signedData, error: signedErr } = await admin.storage
    .from(EXPORTS_BUCKET)
    .createSignedUrl(objectKey, SIGNED_URL_EXPIRY_SECONDS);
  if (signedErr || !signedData?.signedUrl) {
    console.error(
      "[api/account/export] sign failed:",
      signedErr?.message ?? "no signedUrl in response",
    );
    // Best-effort cleanup. Swallow any remove error so it doesn't shadow
    // the original signing failure — the user sees the useful "sign
    // failed" message, and the orphan (if any) is rare enough to leave
    // to the next retry cycle.
    try {
      const { error: removeErr } = await admin.storage
        .from(EXPORTS_BUCKET)
        .remove([objectKey]);
      if (removeErr) {
        console.error(
          "[api/account/export] orphan cleanup failed after sign failure:",
          removeErr.message,
        );
      }
    } catch (cleanupErr) {
      console.error(
        "[api/account/export] orphan cleanup threw after sign failure:",
        cleanupErr instanceof Error ? cleanupErr.message : cleanupErr,
      );
    }
    // Audit-2026-05-07 red-team R8 (MED c8): refund the 1/day token on
    // sign failure (same rationale as the upload-fail branch and the
    // refusal-path refund — see H-0201's audit emission below).
    await refundRateLimitToken("sign_failed");
    // Audit-2026-05-07 H-0201 (code-reviewer c8): emit a refused-audit
    // when sign-fail aborts the response — the bundle was uploaded to
    // storage (and may have been briefly visible before the orphan
    // cleanup landed). A future incident response asking "did we ever
    // serialize/store user X's data?" must find the row in audit_log.
    logAuditEvent(supabase, {
      action: "account.export_refused",
      entity_type: "user",
      entity_id: exportSubjectId,
      metadata: {
        partial: bundle.partial,
        truncated_at_size_cap: bundle.truncated_at_size_cap,
        reason: "sign_failed",
        // Hash, not raw path — see H-0202 rationale on the success
        // branch below.
        object_key_sha256: objectKeyHash,
        ip: fingerprint.ip,
        user_agent: fingerprint.user_agent,
      },
    });
    return NextResponse.json(
      { error: "Failed to sign export URL" },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }

  const expiresAt = new Date(
    Date.now() + SIGNED_URL_EXPIRY_SECONDS * 1000,
  ).toISOString();

  // Audit the export. Fire-and-forget; never gates the response.
  // entity_type 'user' per the Task 7.3 extension of ADR-0023 §4 —
  // the "entity" is the account being exported. The gate above
  // ensures `incompleteReasons` is empty here — if it were not, the
  // route would have returned 500 already. We still serialize it
  // into the audit metadata for forensic uniformity (one shape, easy
  // to query).
  logAuditEvent(supabase, {
    action: "account.export",
    entity_type: "user",
    entity_id: exportSubjectId,
    metadata: {
      // Audit-2026-05-07 H-0202 / H-0203: hash, not raw storage_path.
      // The CSV audit-log export streams this metadata back to the
      // caller; persisting the raw `${user_id}/${uuid}.json` value
      // turns a future bucket-RLS regression into a treasure-map
      // (every export ever taken, addressable by user_id). The hash
      // preserves "ops can reconcile a known objectKey to a known
      // audit row" without bundling the bucket location into the
      // long-lived audit_log payload. Operators with the original
      // objectKey (from server logs, also stored here under
      // [api/account/export]) can rehash to verify.
      object_key_sha256: objectKeyHash,
      expires_at: expiresAt,
      table_count: bundle.tables.length,
      total_row_count: bundle.total_row_count,
      truncated_at_size_cap: bundle.truncated_at_size_cap,
      incomplete_reasons: incompleteReasons,
      // Audit 2026-05-07 red-team #7: number of profiles rows observed
      // via the typed `rowsForTable` helper. Pinned to 1 on a normally-
      // built bundle (one subject = one profile row); a drift to 0 or
      // null would have failed the load-bearing check above.
      profiles_row_count: profilesRows.length,
      // Audit-2026-05-07 H-0200 (code-reviewer c9): forensic
      // fingerprint for the export call. A stolen-JWT export can be
      // reconstructed from the IP + UA on the audit row even after
      // the signed URL has expired and rolled off the response logs.
      ip: fingerprint.ip,
      user_agent: fingerprint.user_agent,
    },
  });

  return NextResponse.json(
    {
      ok: true,
      signed_url: signedData.signedUrl,
      expires_at: expiresAt,
      bytes: bundleBytes.byteLength,
      table_count: bundle.tables.length,
      total_row_count: bundle.total_row_count,
      truncated_at_size_cap: bundle.truncated_at_size_cap,
      incomplete_reasons: incompleteReasons,
    },
    { headers: NO_STORE_HEADERS },
  );
}
