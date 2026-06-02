import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { escapeHtml, notifyFounderGeneric } from "@/lib/email";
import { userActionLimiter, checkLimit } from "@/lib/ratelimit";
import { assertSameOrigin } from "@/lib/csrf";
import { logAuditEventAsUser } from "@/lib/audit";
import { NO_STORE_HEADERS } from "@/lib/api/headers";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://quantalyze.com";

/**
 * POST /api/account/deletion-request
 *
 * GDPR Art. 17 intake surface. Inserts a row into `data_deletion_requests`
 * and emails the founder. Deletion is then handled manually within the
 * 30-day SLA documented in the privacy policy. This route does NOT destroy
 * any user data on its own.
 *
 * Response envelope (200):
 *   {
 *     ok: true,
 *     request_id: string,        // uuid of the deletion-request row
 *     requested_at: string,      // ISO timestamp of the row
 *     idempotent: boolean,       // TRUE if an existing pending request was
 *                                // returned (dedup short-circuit); FALSE
 *                                // if a new row was just inserted. Clients
 *                                // SHOULD branch on this flag rather than
 *                                // the presence of `message` (legacy
 *                                // discriminator kept for back-compat).
 *     message?: string,          // optional human-readable note, present
 *                                // only on the idempotent=true branch
 *   }
 *
 * C-0019 (audit-2026-05-07): the `idempotent` flag was added because the
 * legacy two-branch envelope (with `message` as the sole discriminator)
 * forced callers to discriminate by URL or by the presence of an
 * optional string field. Adding a typed boolean lets clients
 * distinguish first-create from dedup-hit unambiguously.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  // CSRF defense-in-depth: reject before any auth/Upstash work so a bad
  // origin never costs us a Supabase round-trip or rate-limit token.
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

  // Cross-lambda rate limit so a runaway client cannot spam the founder's
  // inbox via the deletion-request notification path.
  const rl = await checkLimit(userActionLimiter, `deletion:${user.id}`);
  if (!rl.success) {
    return NextResponse.json(
      { error: "Rate limit exceeded" },
      {
        status: 429,
        headers: { ...NO_STORE_HEADERS, "Retry-After": String(rl.retryAfter) },
      },
    );
  }

  // DB-level dedup: if this user already has a pending deletion request from
  // the last 24 hours, return that one instead of inserting a duplicate row.
  // The rate limit above stops abusive bursts, but a single legitimate user
  // who clicks the button twice should not generate two founder emails.
  //
  // Schema reminder (migration 012): there is no `status` column — pending
  // means `completed_at IS NULL` — and there is no `created_at` — the
  // canonical timestamp is `requested_at`.
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data: existing } = await supabase
    .from("data_deletion_requests")
    .select("id, requested_at")
    .eq("user_id", user.id)
    .is("completed_at", null)
    .gte("requested_at", oneDayAgo)
    .order("requested_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existing) {
    return NextResponse.json(
      {
        ok: true,
        request_id: existing.id,
        requested_at: existing.requested_at,
        idempotent: true,
        message: "Deletion request already pending",
      },
      { status: 200, headers: NO_STORE_HEADERS },
    );
  }

  const { data: inserted, error } = await supabase
    .from("data_deletion_requests")
    .insert({ user_id: user.id })
    .select("id, requested_at")
    .single();

  if (error) {
    console.error("[api/account/deletion-request] Insert failed:", error);
    return NextResponse.json(
      { error: "Failed to record deletion request" },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }

  // Insert returned no error but also no row — treat as a failure so
  // we never return 200 without an accompanying audit row. "Every 200
  // implies an audit row exists" is the invariant Task 7.1a locks in
  // for GDPR Art. 17 intake specifically.
  if (!inserted?.id) {
    console.error(
      "[api/account/deletion-request] Insert returned null id with no error",
    );
    return NextResponse.json(
      { error: "Failed to record deletion request" },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }

  // Sprint 6 Task 7.1a — audit the deletion request. This is a
  // GDPR Art. 17 intake, so a forensic trail is particularly load-bearing
  // ("can we prove the user requested deletion on this date?"). Fire-and-
  // forget; does not gate the response.
  //
  // NEW-C10-01 (audit-2026-05-26 security): switched to logAuditEventAsUser
  // (service-role, JWT-immune) so the GDPR intake audit row cannot be silently
  // lost when the user's JWT expires between response flush and after() settle.
  // `inserted.id` is server-derived so the userId attribution is trusted.
  logAuditEventAsUser(createAdminClient(), user.id, {
    action: "deletion.request.create",
    entity_type: "data_deletion_request",
    entity_id: inserted.id,
    metadata: {
      requested_at: inserted.requested_at,
    },
  });

  // Fire-and-forget founder notification so the founder can begin manual
  // processing. Email failure is not fatal — the row is already persisted.
  // user.email and user.id come from auth.getUser() but escape defensively.
  const safeUserLabel = escapeHtml(user.email ?? user.id);
  const safeRequestedAt = escapeHtml(inserted.requested_at ?? "(unknown)");
  const safeRequestId = escapeHtml(inserted.id);
  void notifyFounderGeneric(
    `Account deletion requested: ${user.email ?? user.id}`,
    `<p>A user has requested account deletion.</p>
     <p><strong>User:</strong> ${safeUserLabel}<br/>
     <strong>Requested:</strong> ${safeRequestedAt}<br/>
     <strong>Request id:</strong> ${safeRequestId}</p>
     <p><a href="${APP_URL}/admin">Open admin dashboard</a></p>
     <p style="color:#666;font-size:12px;">Complete deletion within 30 days per GDPR Art. 17. Update the completed_at column when done.</p>`,
  );

  return NextResponse.json(
    {
      ok: true,
      request_id: inserted?.id,
      requested_at: inserted?.requested_at,
      idempotent: false,
    },
    { headers: NO_STORE_HEADERS },
  );
}
