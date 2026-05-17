import { NextRequest, NextResponse, after } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { assertSameOrigin } from "@/lib/csrf";
import { userActionLimiter, checkLimit } from "@/lib/ratelimit";
import { notifyAllocatorIntroStatus } from "@/lib/email";
import { logAuditEvent } from "@/lib/audit";

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

  const strategy = request.strategies as unknown as
    | { user_id: string | null; name: string | null }
    | null;
  if (!strategy || strategy.user_id !== user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Defense-in-depth: explicit column whitelist. The route only ever
  // writes status + responded_at — never admin_note, founder_notes,
  // allocation_amount, message, mandate_context, etc. This closes the
  // C-0136 application-layer surface even if RLS WITH CHECK is not yet
  // tightened.
  const admin = createAdminClient();
  const { data: updated, error: updateError } = await admin
    .from("contact_requests")
    .update({
      status: newStatus,
      responded_at: new Date().toISOString(),
    })
    .eq("id", id)
    .select("id");

  if (updateError) {
    return NextResponse.json({ error: "Update failed" }, { status: 500 });
  }
  if (!updated || updated.length === 0) {
    // Should not happen given the ownership check above, but mirrors the
    // PendingIntros defensive shape and prevents silent success.
    return NextResponse.json(
      { error: "Update did not apply" },
      { status: 500 },
    );
  }

  // Audit the manager-driven transition. Mirrors the admin route's audit
  // event shape (action="contact_request.status_change") so forensic
  // queries don't need to special-case manager vs admin actor.
  logAuditEvent(supabase, {
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
  after(async () => {
    try {
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
