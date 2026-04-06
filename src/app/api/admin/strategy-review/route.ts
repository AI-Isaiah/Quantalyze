import { NextResponse } from "next/server";
import { withAdminAuth } from "@/lib/api/withAdminAuth";

export const POST = withAdminAuth(async (body, admin) => {
  const { id, action, review_note } = body;
  if (!id || !["approve", "reject"].includes(action as string)) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  // Data quality gate for approval (parallel queries to minimize latency)
  if (action === "approve") {
    const [
      { data: strategy },
      { count: tradeCount },
      { data: earliestTrade },
      { data: latestTrade },
      { data: analytics },
    ] = await Promise.all([
      admin.from("strategies").select("api_key_id").eq("id", id).single(),
      admin.from("trades").select("id", { count: "exact", head: true }).eq("strategy_id", id),
      admin.from("trades").select("timestamp").eq("strategy_id", id).order("timestamp", { ascending: true }).limit(1),
      admin.from("trades").select("timestamp").eq("strategy_id", id).order("timestamp", { ascending: false }).limit(1),
      admin.from("strategy_analytics").select("computation_status, computation_error").eq("strategy_id", id).single(),
    ]);

    if (!strategy?.api_key_id && (!tradeCount || tradeCount === 0)) {
      return NextResponse.json({
        error: "Cannot approve: strategy has no API key connected and no trade data uploaded.",
      }, { status: 400 });
    }

    if (!tradeCount || tradeCount < 5) {
      return NextResponse.json({
        error: `Cannot approve: strategy has only ${tradeCount ?? 0} trade(s). A minimum of 5 trades is required.`,
      }, { status: 400 });
    }

    if (earliestTrade?.length && latestTrade?.length) {
      const earliest = new Date(earliestTrade[0].timestamp);
      const latest = new Date(latestTrade[0].timestamp);
      const spanDays = (latest.getTime() - earliest.getTime()) / (1000 * 60 * 60 * 24);

      if (spanDays < 7) {
        return NextResponse.json({
          error: `Cannot approve: trades span only ${spanDays.toFixed(1)} day(s). A minimum of 7 days of trading history is required.`,
        }, { status: 400 });
      }
    }

    if (!analytics) {
      return NextResponse.json({
        error: "Cannot approve: analytics have not been computed for this strategy. Sync trades first.",
      }, { status: 400 });
    }

    if (analytics.computation_status !== "complete") {
      const detail = analytics.computation_status === "failed"
        ? ` Computation failed: ${analytics.computation_error ?? "unknown error"}.`
        : ` Current status: ${analytics.computation_status}.`;
      return NextResponse.json({
        error: `Cannot approve: analytics computation is not complete.${detail}`,
      }, { status: 400 });
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
