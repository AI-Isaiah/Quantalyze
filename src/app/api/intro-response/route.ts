import { NextRequest, NextResponse, after } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { assertSameOrigin } from "@/lib/csrf";
import { userActionLimiter, checkLimit } from "@/lib/ratelimit";
import { notifyAllocatorIntroStatus } from "@/lib/email";
import { logAuditEventAsUser } from "@/lib/audit";

/**
 * Audit-2026-05-07 C-0135 + C-0136 — manager-side intro response.
 *
 * Before this route existed, src/components/strategy/PendingIntros.tsx
 * wrote contact_requests directly via the Supabase browser client. Two
 * defects fell out:
 *
 *   C-0135 (silent notification drop):
 *     The notifyAllocatorIntroStatus email fires from the *admin* route
 *     (src/app/api/admin/intro-request). When a strategy manager
 *     responded via the dashboard UI, the same status transition (pending
 *     → intro_made | declined) skipped the notify path entirely, leaving
 *     allocators unaware their request had been accepted or declined.
 *
 *   C-0136 (RLS WITH CHECK gap):
 *     contact_requests' UPDATE policy filters by `strategy_id IN
 *     (managers' strategies)` but had no column-level grant and no
 *     WITH CHECK clause. A malicious manager (via crafted client) could
 *     mutate admin_note, founder_notes, allocation_amount, etc. on rows
 *     belonging to *their* strategies — including forging admin notes
 *     and falsifying allocator-facing fields.
 *
 * Fix: route manager responses through this server endpoint, which (a)
 * verifies caller is the strategy manager who owns the contact request,
 * (b) writes only `{ status, responded_at }` via a service-role client
 * after the ownership check, (c) audits the transition, (d) triggers
 * notifyAllocatorIntroStatus on every transition just like the admin
 * path.
 *
 * Companion RLS tightening (column-level grants + WITH CHECK) is tracked
 * separately as a DB migration in the ops backlog — this route delivers
 * the application-layer fix that closes C-0135 and the practical surface
 * of C-0136 (manager UI no longer can write banned columns).
 */

const RESPONSE_SCHEMA = z.object({
  id: z.string().uuid(),
  action: z.enum(["accept", "decline"]),
});

export async function POST(req: NextRequest) {
  const csrfError = assertSameOrigin(req);
  if (csrfError) return csrfError;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rl = await checkLimit(userActionLimiter, `intro-response:${user.id}`);
  if (!rl.success) {
    return NextResponse.json(
      { error: "Too many requests" },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter) } },
    );
  }

  const rawBody = await req.json().catch(() => null);
  const parsed = RESPONSE_SCHEMA.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request body", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const { id, action } = parsed.data;
  const newStatus = action === "accept" ? "intro_made" : "declined";

  // Ownership check: caller must be the manager (strategies.user_id) of
  // the strategy referenced by contact_requests.strategy_id. Use the
  // user-scoped client so RLS gates the lookup — a non-manager will see
  // no row even if they crafted a guessed id.
  const { data: request, error: lookupError } = await supabase
    .from("contact_requests")
    .select("id, strategy_id, status, allocator_id, strategies!contact_requests_strategy_id_fkey(user_id, name)")
    .eq("id", id)
    .maybeSingle();

  if (lookupError) {
    return NextResponse.json({ error: "Failed to load request" }, { status: 500 });
  }
  if (!request) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Red-team 2026-05-17 (red-team:join-shape-cast-fragile, MED conf 8):
  // The select uses an FK hint targeting a to-one relationship, so the
  // runtime shape SHOULD be a single object. Guard against the supabase-js
  // inference flipping to ARRAY on a future schema change / version bump
  // — that would silently invert the ownership check (`strategy.user_id`
  // is undefined on an array) and 403 every legitimate manager. Surface
  // it as a 500 with a stable [api/intro-response] diagnostic instead.
  const rawStrategy = request.strategies as unknown;
  if (
    rawStrategy !== null &&
    (Array.isArray(rawStrategy) || typeof rawStrategy !== "object")
  ) {
    console.error(
      "[api/intro-response] unexpected join shape on request.strategies",
      { typeof: typeof rawStrategy, isArray: Array.isArray(rawStrategy) },
    );
    return NextResponse.json(
      { error: "Unexpected join shape" },
      { status: 500 },
    );
  }
  const strategy = rawStrategy as
    | { user_id: string | null; name: string | null }
    | null;
  if (!strategy || strategy.user_id !== user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Red-team 2026-05-17 (red-team:notify-replay-amplification, HIGH conf
  // 9): re-check the prior status from the user-scoped lookup BEFORE the
  // admin update. If a replay/double-fire arrives after the row already
  // transitioned to a terminal state, short-circuit with 409 so we don't
  // re-write responded_at, re-emit an audit row, or re-fire the allocator
  // notification email. This is the cheap belt; the .eq('status','pending')
  // guard on the UPDATE below is the suspenders (TOCTOU close).
  if (request.status !== "pending") {
    return NextResponse.json(
      { error: "Request already resolved" },
      { status: 409 },
    );
  }

  // Defense-in-depth: explicit column whitelist. The route only ever
  // writes status + responded_at — never admin_note, founder_notes,
  // allocation_amount, message, mandate_context, etc. This closes the
  // C-0136 application-layer surface even if RLS WITH CHECK is not yet
  // tightened.
  //
  // Red-team 2026-05-17 (red-team:toctou-status-overwrite, CRITICAL conf
  // 9): the UPDATE WHERE clause MUST include `.eq('status','pending')`.
  // Without it, a concurrent admin call to /api/admin/intro-request can
  // transition the row to intro_made|completed between the L87 lookup and
  // this write — the manager's `declined` would then clobber the admin's
  // terminal state. With the guard, the second writer's update affects 0
  // rows and we surface 409 (request already resolved) instead of
  // overwriting + double-emitting + double-notifying.
  const admin = createAdminClient();
  const { data: updated, error: updateError } = await admin
    .from("contact_requests")
    .update({
      status: newStatus,
      responded_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("status", "pending")
    .select("id");

  if (updateError) {
    return NextResponse.json({ error: "Update failed" }, { status: 500 });
  }
  if (!updated || updated.length === 0) {
    // Red-team 2026-05-17: zero affected rows after the
    // `.eq('status','pending')` guard means another writer (admin route
    // or a parallel tab) already resolved the request. Return 409 with
    // copy that tells the manager to refresh — NOT 500 — so the UI can
    // distinguish "resolved elsewhere, refresh" from "DB error, retry".
    return NextResponse.json(
      {
        error:
          "Request already resolved. Refresh to see the latest status.",
      },
      { status: 409 },
    );
  }

  // Audit the manager-driven transition. Mirrors the admin route's audit
  // event shape (action="contact_request.status_change") so forensic
  // queries don't need to special-case manager vs admin actor.
  //
  // Red-team 2026-05-17 (red-team:audit-after-jwt-expiry, HIGH conf 8):
  // emit via logAuditEventAsUser(admin, user.id, ...) — NOT logAuditEvent
  // on the user-scoped client. The user-scoped client carries the
  // caller's JWT, and after() runs the RPC AFTER the response flushes;
  // the JWT may have expired by then (1h Supabase default), causing the
  // RPC to raise permission_denied and the audit_log row to be silently
  // dropped (re-thrown as unhandled rejection — see src/lib/audit.ts
  // L486-500). logAuditEventAsUser routes through the service-role RPC
  // log_audit_event_service with the user.id captured at request time,
  // immune to JWT expiry.
  logAuditEventAsUser(admin, user.id, {
    action: "contact_request.status_change",
    entity_type: "contact_request",
    entity_id: id,
    metadata: {
      new_status: newStatus,
      actor_role: "manager",
    },
  });

  // C-0135 fix: notify the allocator on every manager-driven transition.
  // Same notify call as the admin route, lifted from
  // src/app/api/admin/intro-request/route.ts. Fire-and-forget via after()
  // so the response isn't gated on the email round-trip.
  //
  // Red-team 2026-05-17 (red-team:null-allocator-id-silent-skip, MED conf
  // 8): legacy rows may have allocator_id=null; supabase-js translates
  // .eq('id', null) into 'id IS NULL' which silently returns nothing.
  // Guard explicitly so the skip is logged with a stable [api/intro-
  // response] prefix — otherwise the missing allocator notification has
  // no audit signal at all.
  after(async () => {
    try {
      if (!request.allocator_id) {
        console.warn(
          "[api/intro-response] skip notify — allocator_id is null on contact_request",
          { contact_request_id: id },
        );
        return;
      }
      const { data: allocator } = await admin
        .from("profiles")
        .select("email")
        .eq("id", request.allocator_id)
        .single();
      if (allocator?.email && strategy.name) {
        await notifyAllocatorIntroStatus(
          allocator.email,
          strategy.name,
          newStatus,
        );
      }
    } catch (err) {
      console.error(
        "[api/intro-response] allocator-status notify failed:",
        err instanceof Error ? err.message : err,
      );
    }
  });

  return NextResponse.json({ success: true });
}
