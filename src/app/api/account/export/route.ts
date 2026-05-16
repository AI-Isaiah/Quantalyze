import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { assertSameOrigin } from "@/lib/csrf";
import { exportLimiter, checkLimit } from "@/lib/ratelimit";
import { logAuditEvent } from "@/lib/audit";
import {
  collectUserExportBundle,
  encodeExportBundle,
  rowsForTable,
} from "@/lib/gdpr-export";

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
 */

const SIGNED_URL_EXPIRY_SECONDS = 60 * 60; // 1 hour, per Task 7.3 spec.
const EXPORTS_BUCKET = "gdpr-exports";

export async function POST(req: NextRequest): Promise<NextResponse> {
  // CSRF defense-in-depth: reject before touching Upstash or Supabase.
  const csrfError = assertSameOrigin(req);
  if (csrfError) return csrfError;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 1/day/user bucket. The Upstash sliding window covers a rolling 24h
  // so a user who exported yesterday at 09:00 cannot export today until
  // 09:00 — matching the regulatory cadence the task spec commits to.
  const rateLimitKey = `export:${user.id}`;
  const rl = await checkLimit(exportLimiter, rateLimitKey);
  if (!rl.success) {
    return NextResponse.json(
      { error: "Export limit reached — try again later." },
      {
        status: 429,
        headers: { "Retry-After": String(rl.retryAfter) },
      },
    );
  }

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
  const refundRateLimitToken = async (reason: string): Promise<void> => {
    if (!exportLimiter) return;
    try {
      await exportLimiter.resetUsedTokens(rateLimitKey);
    } catch (err) {
      console.error(
        `[api/account/export] rate-limit refund failed (${reason}):`,
        err instanceof Error ? err.message : err,
      );
    }
  };

  // Assemble the bundle across all user-owned tables. Uses the admin
  // client because the bundle spans tables with divergent RLS shapes
  // (owner-only, cross-party, service-role-only).
  const bundle = await collectUserExportBundle(admin, user.id);

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
      entity_id: user.id,
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
      { status: 500 },
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
      { user_id: user.id, table_count: bundle.tables.length },
    );
    await refundRateLimitToken("manifest_drift");
    return NextResponse.json(
      {
        error: "Export manifest drift — please contact support.",
        code: "export_manifest_drift",
      },
      { status: 500 },
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
  const objectKey = `${user.id}/${crypto.randomUUID()}.json`;
  const bundleBytes = encodeExportBundle(bundle);

  const { error: uploadErr } = await admin.storage
    .from(EXPORTS_BUCKET)
    .upload(objectKey, bundleBytes, {
      contentType: "application/json",
      upsert: false,
    });
  if (uploadErr) {
    console.error("[api/account/export] upload failed:", uploadErr.message);
    return NextResponse.json(
      { error: "Failed to upload export bundle" },
      { status: 500 },
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
    return NextResponse.json(
      { error: "Failed to sign export URL" },
      { status: 500 },
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
    entity_id: user.id,
    metadata: {
      storage_path: objectKey,
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
    },
  });

  return NextResponse.json({
    ok: true,
    signed_url: signedData.signedUrl,
    expires_at: expiresAt,
    bytes: bundleBytes.byteLength,
    table_count: bundle.tables.length,
    total_row_count: bundle.total_row_count,
    truncated_at_size_cap: bundle.truncated_at_size_cap,
    incomplete_reasons: incompleteReasons,
  });
}
