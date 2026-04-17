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

  // Upload to storage. Path: `{user_id}/{uuid}.json`. The owner-read
  // RLS policy in migration 055 gates by `storage.foldername(name)[1]`
  // so the user prefix MUST be the auth.uid() text.
  const objectKey = `${user.id}/${crypto.randomUUID()}.json`;
  const bundleJson = JSON.stringify(bundle);
  const bundleBytes = new TextEncoder().encode(bundleJson);

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
