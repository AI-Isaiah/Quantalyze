import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { assertSameOrigin } from "@/lib/csrf";
import { exportLimiter, checkLimit } from "@/lib/ratelimit";
import { logAuditEvent } from "@/lib/audit";
import { collectUserExportBundle, encodeExportBundle } from "@/lib/gdpr-export";

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
  const rl = await checkLimit(exportLimiter, `export:${user.id}`);
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
    // Audit the refusal so forensic reconstruction of "why this user
    // got 500" survives the response-body discard. The metadata is
    // also the only durable trail of which truncations occurred — if
    // a regulator later asks "did the controller ever know about this
    // user's truncation", the audit row is the answer.
    logAuditEvent(supabase, {
      action: "account.export_refused",
      entity_type: "user",
      entity_id: user.id,
      metadata: {
        request_id: requestId,
        partial: bundle.partial,
        truncated_at_size_cap: bundle.truncated_at_size_cap,
        row_capped_tables: rowCappedTables,
        parent_id_truncated_tables: bundle.parent_id_truncated_tables,
        incomplete_reasons: incompleteReasons,
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
