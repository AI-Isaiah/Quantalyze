import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getClientIp } from "@/lib/ratelimit";
import { NO_STORE_HEADERS } from "@/lib/api/headers";
import { logAuditEvent } from "@/lib/audit";

/**
 * GET /api/account/export/latest — Audit-2026-05-07 C-0025 closeout.
 *
 * Convenience companion to POST /api/account/export. Re-signs the most
 * recent in-bucket bundle for the caller WITHOUT minting a new export
 * job and WITHOUT consuming a rate-limit token. The pre-fix behaviour
 * was that the ONLY way to recover from a flaky download was to re-run
 * the (rate-limited, expensive) POST, which permanently burned the
 * user's 1/day allowance on a transient network failure.
 *
 * Contract (load-bearing — see the C-0025 trade-off docstring on the
 * POST route):
 *
 *   - Auth: cookie-session via `createClient()` (mirrors POST). No CSRF
 *     check because GET is non-mutating and same-origin only matters for
 *     state-changing requests. The route does not consume tokens, does
 *     not write storage, does not emit a bundle assembly.
 *
 *   - Discovery: list `gdpr-exports` bucket scoped to the caller's
 *     `${user.id}/` prefix, sorted by `created_at` descending. The POST
 *     route writes `${user_id}/${randomUUID()}.json`, so name-based
 *     timestamp sorting is impossible — we MUST sort by storage metadata
 *     `created_at`. The bucket's owner-read RLS (migration 055) limits
 *     visibility to the caller's prefix so the admin client is used
 *     here only to keep the signing path identical to POST.
 *
 *   - Signing: `createSignedUrl` for `SIGNED_URL_EXPIRY_SECONDS` (1h,
 *     matching POST). No retry / no re-upload — if signing fails we
 *     return 500 with no side effects.
 *
 *   - 404: when the prefix is empty, the user must run POST first. The
 *     message text is part of the contract so the client can render an
 *     actionable error without parsing structured fields.
 *
 *   - Cache-Control: `private, no-store` (NO_STORE_HEADERS). A proxy
 *     cache MUST NOT retain the signed URL — it expires in 1h and the
 *     bucket key is single-tenant.
 *
 *   - Audit: emits `account.export_resigned` (NEW action) with the
 *     object_key_sha256 + ip + user_agent. Distinct from
 *     `account.export` so a forensic query can separate fresh exports
 *     from re-signs. NEVER emits `account.export` (that action implies
 *     a new bundle assembly per audit_log conventions).
 */

const SIGNED_URL_EXPIRY_SECONDS = 60 * 60; // 1 hour — matches POST.
const EXPORTS_BUCKET = "gdpr-exports";

function readRequestFingerprint(req: NextRequest): {
  ip: string | null;
  user_agent: string | null;
} {
  const rawIp = getClientIp(req.headers);
  const ip = rawIp === "unknown" ? null : rawIp;
  const user_agent = req.headers.get("user-agent") || null;
  return { ip, user_agent };
}

export async function GET(req: NextRequest): Promise<NextResponse> {
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

  const fingerprint = readRequestFingerprint(req);
  const admin = createAdminClient();

  // List the user's prefix. The POST route writes
  // `${user_id}/${randomUUID()}.json` (UUIDv4 is unsortable by recency),
  // so we sort by storage metadata `created_at` descending and take the
  // first entry.
  const { data: entries, error: listErr } = await admin.storage
    .from(EXPORTS_BUCKET)
    .list(user.id, {
      limit: 1,
      offset: 0,
      sortBy: { column: "created_at", order: "desc" },
    });
  if (listErr) {
    console.error(
      "[api/account/export/latest] list failed:",
      listErr.message,
    );
    return NextResponse.json(
      { error: "Failed to look up latest export." },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }

  const latest = entries?.[0];
  if (!latest) {
    return NextResponse.json(
      {
        error: "No prior export found. Run /api/account/export first.",
        code: "no_prior_export",
      },
      { status: 404, headers: NO_STORE_HEADERS },
    );
  }

  // Reconstruct the full object key. `list(prefix)` returns entries
  // whose `name` is the basename within that prefix — so we re-prepend
  // the user_id to match the path used by POST's upload + the bucket's
  // RLS foldername filter.
  const objectKey = `${user.id}/${latest.name}`;

  const { data: signedData, error: signedErr } = await admin.storage
    .from(EXPORTS_BUCKET)
    .createSignedUrl(objectKey, SIGNED_URL_EXPIRY_SECONDS);
  if (signedErr || !signedData?.signedUrl) {
    console.error(
      "[api/account/export/latest] sign failed:",
      signedErr?.message ?? "no signedUrl in response",
    );
    return NextResponse.json(
      { error: "Failed to sign export URL" },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }

  const expiresAt = new Date(
    Date.now() + SIGNED_URL_EXPIRY_SECONDS * 1000,
  ).toISOString();

  const objectKeyHash = crypto
    .createHash("sha256")
    .update(objectKey)
    .digest("hex");

  // Audit the re-sign. Distinct action from `account.export` because
  // this path does NOT assemble a new bundle — it re-issues a signed
  // URL for an already-stored object. A forensic query distinguishing
  // "did the controller decrypt/aggregate this user's data" from "did
  // someone re-download an existing bundle" must be able to filter on
  // action name.
  logAuditEvent(supabase, {
    action: "account.export_resigned",
    entity_type: "user",
    entity_id: user.id,
    metadata: {
      object_key_sha256: objectKeyHash,
      expires_at: expiresAt,
      bundle_created_at: latest.created_at,
      ip: fingerprint.ip,
      user_agent: fingerprint.user_agent,
    },
  });

  return NextResponse.json(
    {
      ok: true,
      signed_url: signedData.signedUrl,
      expires_at: expiresAt,
      bundle_created_at: latest.created_at,
    },
    { headers: NO_STORE_HEADERS },
  );
}
