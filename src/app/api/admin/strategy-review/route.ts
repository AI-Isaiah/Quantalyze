import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { withAdminAuth } from "@/lib/api/withAdminAuth";
import { notifyManagerApproved } from "@/lib/email";
import { checkStrategyGate } from "@/lib/strategyGate";
import { logAuditEvent } from "@/lib/audit";

export const POST = withAdminAuth(async (body, admin) => {
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

  // Sprint 6 Task 7.1b — audit the approve/reject decision. Use a
  // user-scoped client so log_audit_event resolves auth.uid() to the
  // acting admin (withAdminAuth hands us the service-role `admin` client
  // only). The outer handler has already verified the caller is admin.
  //
  // /review follow-up (T4-M3): truncate review_note to 2000 chars
  // before stashing it in metadata. audit_log.metadata is JSONB and
  // practically unbounded, but an admin pasting a 500KB review note
  // would bloat the audit table and break the small-row assumption the
  // rest of the audit tooling makes. We record whether truncation
  // happened in `review_note_truncated` so forensic analysis can flag
  // "the full note lives in [elsewhere]" if one ever shows up.
  const REVIEW_NOTE_AUDIT_CAP = 2000;
  const auditSupabase = await createClient();
  const rawReviewNote = (review_note as string) || null;
  const reviewNoteForAudit =
    rawReviewNote !== null
      ? rawReviewNote.slice(0, REVIEW_NOTE_AUDIT_CAP)
      : null;
  const reviewNoteTruncated =
    rawReviewNote !== null && rawReviewNote.length > REVIEW_NOTE_AUDIT_CAP;
  logAuditEvent(auditSupabase, {
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
      }).catch(() => {});
    }
  }

  return NextResponse.json({ success: true });
});
