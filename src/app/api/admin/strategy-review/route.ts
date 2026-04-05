import { NextResponse } from "next/server";
import { withAdminAuth } from "@/lib/api/withAdminAuth";

export const POST = withAdminAuth(async (body, admin) => {
  const { id, action, review_note } = body;
  if (!id || !["approve", "reject"].includes(action as string)) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  // Block approval if strategy has no data (no API key AND no trades)
  if (action === "approve") {
    const { data: strategy } = await admin
      .from("strategies")
      .select("api_key_id")
      .eq("id", id)
      .single();

    if (!strategy?.api_key_id) {
      // Check if trades exist (CSV upload)
      const { count } = await admin
        .from("trades")
        .select("id", { count: "exact", head: true })
        .eq("strategy_id", id);

      if (!count || count === 0) {
        return NextResponse.json({
          error: "Cannot approve: strategy has no API key connected and no trade data uploaded.",
        }, { status: 400 });
      }
    }
  }

  const update = action === "approve"
    ? { status: "published", review_note: null }
    : { status: "draft", review_note: (review_note as string) || "Needs changes before approval." };

  const { error } = await admin.from("strategies").update(update).eq("id", id);

  if (error) {
    return NextResponse.json({ error: "Update failed" }, { status: 500 });
  }

  return NextResponse.json({ success: true });
});
