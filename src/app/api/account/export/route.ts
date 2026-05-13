import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { assertSameOrigin } from "@/lib/csrf";
import { exportLimiter, checkLimit } from "@/lib/ratelimit";
import { logAuditEvent } from "@/lib/audit";
import { collectUserExportBundle } from "@/lib/gdpr-export";

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

  // Issue 5 (audit-2026-05-07 follow-up): GDPR Art. 15 requires a
  // COMPLETE export. Pre-fix, a rejected fetch or PG error caused
  // `collectUserExportBundle` to silently substitute `[]` for the
  // failed table and mint a signed URL anyway — the user received a
  // bundle that LOOKED complete but was missing half its tables. We
  // chose policy (a) from the audit playbook: refuse to mint a signed
  // URL on any fetch failure. The user can retry on the next rate-
  // limit window (the limiter is sliding 24h, so a fresh export
  // attempt the next day is possible). Policy (b) — deliver a partial
  // bundle marked `partial: true` — was rejected because a regulator
  // receiving a flagged-partial export would still see it as a data-
  // protection deficiency; "complete or nothing" is the safer default.
  //
  // Finding 2 (audit-2026-05-07 red-team): the failed_tables list is
  // schema reconnaissance — exposing which internal tables exist (and
  // which currently error) gives an attacker the map they need to
  // tune subsequent probes. Strip it from the client-facing body and
  // log it server-side only, correlated by a request_id the user can
  // quote to support so we can find the matching log line.
  if (bundle.partial) {
    const requestId = crypto.randomUUID();
    console.error("[api/account/export] refusing to mint signed URL — partial bundle:", {
      request_id: requestId,
      user_id: user.id,
      failed_tables: bundle.failed_tables,
    });
    return NextResponse.json(
      {
        error:
          "Some tables failed to export. Please retry — GDPR Art. 15 requires a complete bundle.",
        code: "export_partial",
        request_id: requestId,
      },
      { status: 500 },
    );
  }

  // Upload to storage. Path: `{user_id}/{uuid}.json`. The owner-read
  // RLS policy in migration 055 gates by `storage.foldername(name)[1]`
  // so the user prefix MUST be the auth.uid() text.
  //
  // P448 (audit 2026-05-12 Lane E): pipe `JSON.stringify(bundle)`
  // directly into `TextEncoder.encode` in a single expression — the
  // intermediate string is still allocated by the JS engine, but its
  // variable lifetime ends with the encode call, so the GC can
  // reclaim it as soon as the Uint8Array is in hand. The legacy code
  // held both `bundleJson` AND `bundleBytes` in scope until the
  // upload returned, peaking at ~3× the payload size (object + JSON
  // string + bytes). A future hardening pass could replace this with
  // a true streaming serializer that writes chunks directly to a
  // ReadableStream — tracked under audit P448 follow-up.
  const objectKey = `${user.id}/${crypto.randomUUID()}.json`;
  const bundleBytes = new TextEncoder().encode(JSON.stringify(bundle));

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
  // the "entity" is the account being exported.
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
  });
}
