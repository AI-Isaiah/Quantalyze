import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAdminUser } from "@/lib/admin";
import { assertSameOrigin } from "@/lib/csrf";
import { adminActionLimiter, checkLimit } from "@/lib/ratelimit";
import { notifyManagerApproved } from "@/lib/email";
import { checkStrategyGate } from "@/lib/strategyGate";
import { logAuditEvent } from "@/lib/audit";

// audit-2026-05-07 P198 + P200 — see intro-request/route.ts for the rationale.
// v0.22.24.2 review-fix: handler body inlined to drop the withAdminAuth
// indirection (avoids a second createClient + getUser + isAdminUser round-trip
// per request — red-team HIGH conf 7).
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

  const rl = await checkLimit(
    adminActionLimiter,
    `admin:${user.id}:strategy-review`,
  );
  if (!rl.success) {
    return NextResponse.json(
      { error: "Too many requests" },
      {
        status: 429,
        headers: { "Retry-After": String(rl.retryAfter) },
      },
    );
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

  const admin = createAdminClient();

  const { id, action, review_note } = body;
  if (!id || !["approve", "reject"].includes(action as string)) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  let strategyData: { api_key_id: string | null; name: string; user_id: string } | null = null;

  if (action === "approve") {
    const [
      { data: strategy },
      { count: tradeCount },
      { data: earliestTrade },
      { data: latestTrade },
      { data: analytics },
    ] = await Promise.all([
      admin.from("strategies").select("api_key_id, name, user_id").eq("id", id).single(),
      admin.from("trades").select("id", { count: "exact", head: true }).eq("strategy_id", id),
      admin.from("trades").select("timestamp").eq("strategy_id", id).order("timestamp", { ascending: true }).limit(1),
      admin.from("trades").select("timestamp").eq("strategy_id", id).order("timestamp", { ascending: false }).limit(1),
      admin.from("strategy_analytics").select("computation_status, computation_error").eq("strategy_id", id).single(),
    ]);

    const gate = checkStrategyGate({
      apiKeyId: strategy?.api_key_id ?? null,
      tradeCount: tradeCount ?? 0,
      earliestTradeAt: earliestTrade?.[0]?.timestamp ? new Date(earliestTrade[0].timestamp) : null,
      latestTradeAt: latestTrade?.[0]?.timestamp ? new Date(latestTrade[0].timestamp) : null,
      computationStatus: analytics?.computation_status ?? null,
      computationError: analytics?.computation_error ?? null,
    });

    if (!gate.passed) {
      return NextResponse.json({ error: `Cannot approve: ${gate.reason}` }, { status: 400 });
    }

    strategyData = strategy as typeof strategyData;
  }

  const update = action === "approve"
    ? { status: "published", review_note: null }
    : { status: "draft", review_note: (review_note as string) || "Needs changes before approval." };

  const { error } = await admin.from("strategies").update(update).eq("id", id);

  if (error) {
    return NextResponse.json({ error: "Update failed" }, { status: 500 });
  }

  // Sprint 6 Task 7.1b — audit the approve/reject decision. Use the user-scoped
  // `supabase` client so log_audit_event resolves auth.uid() to the acting
  // admin. /review follow-up (T4-M3): truncate review_note to 2000 chars to
  // bound the audit row size.
  const REVIEW_NOTE_AUDIT_CAP = 2000;
  const rawReviewNote = (review_note as string) || null;
  const reviewNoteForAudit =
    rawReviewNote !== null
      ? rawReviewNote.slice(0, REVIEW_NOTE_AUDIT_CAP)
      : null;
  const reviewNoteTruncated =
    rawReviewNote !== null && rawReviewNote.length > REVIEW_NOTE_AUDIT_CAP;
  logAuditEvent(supabase, {
    action: action === "approve" ? "strategy.approve" : "strategy.reject",
    entity_type: "strategy",
    entity_id: id as string,
    metadata:
      action === "approve"
        ? { new_status: "published" }
        : {
            new_status: "draft",
            review_note: reviewNoteForAudit,
            review_note_truncated: reviewNoteTruncated,
          },
  });

  if (action === "approve") {
    const sd = strategyData!;
    if (sd?.user_id) {
      Promise.resolve(
        admin.from("profiles").select("email").eq("id", sd.user_id).single()
      ).then(({ data: profile }) => {
        if (profile?.email) {
          notifyManagerApproved(profile.email, sd.name, id as string);
        }
      }).catch((err) =>
        console.error(
          "[admin/strategy-review] manager-approval notify failed:",
          err?.message ?? err,
        ),
      );
    }
  }

  return NextResponse.json({ success: true });
}
