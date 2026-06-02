import { NextRequest, NextResponse, after } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAdminUser } from "@/lib/admin";
import { assertSameOrigin } from "@/lib/csrf";
import { adminActionLimiter, checkLimit, rateLimitDenyJson } from "@/lib/ratelimit";
import { notifyAllocatorIntroStatus } from "@/lib/email";
import { logAuditEventAsUser } from "@/lib/audit";
import { captureToSentry } from "@/lib/sentry-capture";

const VALID_STATUSES = ["pending", "intro_made", "completed", "declined"] as const;

// audit-2026-05-07 P197 + P200 — admin POST surface keeps the CSRF + rate-limit
// imports + calls directly in the route file so the CI grep gate in
// src/__tests__/admin-csrf-ratelimit-grep.test.ts can verify defense-in-depth
// at the route layer.
//
// Review-fix v0.22.24.2 (red-team HIGH conf 7): handler body inlined to drop
// the withAdminAuth indirection. The outer POST proves the user is admin and
// applies the rate limit; we then parse the body and create the service-role
// admin client locally instead of re-running auth via withAdminAuth.
//
// Order:
//   1. assertSameOrigin            (cheap reject, no DB)
//   2. createClient + getUser      (one auth round-trip)
//   3. unauth → 401 immediately    (no rate-limit consumed by anonymous callers)
//   4. isAdminUser → non-admin 403 (closes timing oracle on admin-status)
//   5. checkLimit keyed on verified admin user.id (bucket can no longer be
//                                   polluted by non-admin user_ids)
//   6. parse JSON body
//   7. createAdminClient (service-role) for privileged DB writes
//   8. business logic — uses already-resolved admin client + audit context
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

  // P444 (audit-2026-05-07) — 403 body says "Forbidden", not "Unauthorized".
  if (!(await isAdminUser(supabase, user))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    const parsed = await req.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return NextResponse.json(
        { error: "Request body must be a JSON object" },
        { status: 400 },
      );
    }
    body = parsed as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  // B9 boundary-validation parity (M-1143 sibling): validate with a Zod schema.
  // The defect this closes: `admin_note` was written into
  // contact_requests.admin_note (unbounded TEXT, L84-91 below) with NO length
  // cap. `.max(2000)` rejects an oversized note at the boundary (fail-loud 400)
  // before the DB write. id/status semantics preserved (non-empty id + the
  // existing VALID_STATUSES enum). Parse stays BEFORE the rate limiter (B15b).
  const parsed = z
    .object({
      id: z.string().min(1),
      status: z.enum(VALID_STATUSES),
      admin_note: z.string().max(2000).optional(),
    })
    .safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const { id, status, admin_note } = parsed.data;

  // B15b (audit-2026-05-07): rate-limit AFTER input validation so a
  // malformed/invalid body (rejected 400 above) never consumes one of the
  // admin's adminActionLimiter tokens.
  // PR-2 full-file reviewer #6 (2026-05-28): 503 on rate-limit misconfig
  // so an Upstash outage surfaces on SRE health dashboards instead of
  // masquerading as throttled organic admin traffic. (See rateLimitDenyJson.)
  const rl = await checkLimit(
    adminActionLimiter,
    `admin:${user.id}:intro-request`,
  );
  if (!rl.success) return rateLimitDenyJson(rl);

  const admin = createAdminClient();

  const update: Record<string, unknown> = {
    status,
    responded_at: new Date().toISOString(),
  };

  if (typeof admin_note === "string") {
    update.admin_note = admin_note;
  }

  // Red-team 2026-05-17 (mirrors the manager-route TOCTOU close, CRITICAL
  // conf 9): admin UPDATE must guard on the prior pending state so a
  // concurrent manager response via /api/intro-response cannot be
  // overwritten by this admin write. Without the guard, a manager's
  // intro_made|declined transition between the body-parse and this write
  // would be clobbered by the admin's new status, and the audit row
  // would record the admin as the actor on a row whose true terminal
  // state was set by the manager. Affected-rows=0 surfaces as 409
  // (request resolved elsewhere) instead of 200 silent overwrite. We
  // intentionally retain admin-to-admin idempotency (writing the same
  // intro_made twice by the same admin is rare and already guarded by
  // the pre-status check the UI surfaces).
  const { data: updated, error } = await admin
    .from("contact_requests")
    .update(update)
    .eq("id", id)
    .eq("status", "pending")
    .select("id");

  if (error) {
    // PR-1 background-reviewer H3 (2026-05-28): log code + message so a
    // future supabase-driver schema-drift bug isn't a bare 500. Matches
    // the SRE-forensics shape used in scenario-commit's rpcErr block.
    console.error("[admin/intro-request] update failed:", {
      user_id: user.id,
      code: error.code,
      message: error.message,
    });
    return NextResponse.json({ error: "Update failed" }, { status: 500 });
  }
  if (!updated || updated.length === 0) {
    return NextResponse.json(
      {
        error:
          "Request already resolved elsewhere. Refresh to see the latest status.",
      },
      { status: 409 },
    );
  }

  // Sprint 6 Task 7.1b — audit the admin-driven status transition. B4b: the
  // status UPDATE above rides the service-role `admin` client (RLS-bypassing),
  // so the audit emits via the service path with the explicit acting-admin id
  // (log_audit_event_service) — JWT-immune, not the user-JWT auth.uid() path
  // which can drop in the post-response after() window.
  //
  // audit-2026-05-07 H-0240: pre-fix the metadata recorded only
  // `new_status / has_note`. Add prior_status, note_length, and the
  // acting admin's user id so a forensic reader can reconstruct the
  // transition without joining contact_requests history.
  logAuditEventAsUser(admin, user.id, {
    action: "contact_request.status_change",
    entity_type: "contact_request",
    entity_id: id as string,
    metadata: {
      new_status: status as string,
      // Security L conf=9 (2026-05-28 specialist): the literal "pending" is
      // honest IFF the UPDATE filter at L110 remains exactly
      // `.eq("status", "pending")`. The 409 short-circuit at L116-124
      // guarantees we only reach this audit emit when one row matched the
      // filter, so `prior_status === "pending"` is provable from the code
      // shape — NOT from data. If a future maintainer broadens the guard
      // (e.g. `.in("status", ["pending", "queued"])`), this literal will
      // claim "pending" for rows that were "queued". Hardened in a
      // follow-up by either pre-fetching status or using a SECDEF RPC that
      // RETURNS the OLD row.
      prior_status: "pending",
      has_note: typeof admin_note === "string" && admin_note.length > 0,
      note_length:
        typeof admin_note === "string" ? admin_note.length : 0,
      admin_user_id: user.id,
    },
  });

  if (status !== "pending") {
    // C-0039 (audit-2026-05-07): register the fire-and-forget notify via
    // Next 15+ after() so the Vercel runtime stays alive until the email
    // send + lookup queries flush. The previous Promise.resolve(...).then()
    // form returned the response without keeping the function instance
    // alive, so on Vercel the worker could exit before notifyAllocator
    // IntroStatus completed, intermittently dropping the notification.
    // Mirrors the sibling fire-and-forget pattern in
    // src/app/api/intro-response/route.ts.
    after(async () => {
      try {
        const { data: request } = await admin
          .from("contact_requests")
          .select("allocator_id, strategy_id")
          .eq("id", id)
          .single();
        if (!request) return;
        const [{ data: allocator }, { data: strategy }] = await Promise.all([
          admin.from("profiles").select("email").eq("id", request.allocator_id).single(),
          admin.from("strategies").select("name").eq("id", request.strategy_id).single(),
        ]);
        if (allocator?.email && strategy?.name) {
          await notifyAllocatorIntroStatus(allocator.email, strategy.name, status as string);
        }
      } catch (err) {
        // PR-2 silent-failure-hunter F3 (2026-05-28): promoted to
        // captureToSentry so a regression in the allocator-notify side-
        // effect (DB blip on profiles/strategies lookup, email-provider
        // 5xx) is observable on the alert path. The admin has already
        // received a 200 by the time after() runs.
        console.error(
          "[admin/intro-request] allocator-status notify failed:",
          err instanceof Error ? err.message : err,
        );
        captureToSentry(err, {
          tags: {
            area: "admin/intro-request",
            side_effect: "allocator_notify",
          },
          extra: { request_id: String(id), new_status: String(status) },
          level: "warning",
        });
      }
    });
  }

  return NextResponse.json({ success: true });
}
