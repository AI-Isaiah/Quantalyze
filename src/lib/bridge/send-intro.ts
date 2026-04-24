/**
 * Phase 09.1 Plan 09 / D-16 + R2 accepted.
 *
 * Shared helper for the Bridge "send intro" flow (POST /api/match/decisions/holding).
 *
 * Extracted from src/app/(dashboard)/allocations/ScenarioFlaggedHoldingsList.tsx
 * (the inline `fetch("/api/match/decisions/holding", ...)` call) so the new
 * BridgeDrawer (Plan 09 Task 2) can route through the SAME endpoint without
 * a string-literal fetch URL leaking into a UI component.
 *
 * Single-source-of-truth contract: any caller that wants to record allocator
 * intent on a flagged holding (a "bridge intro") MUST go through this
 * helper. Do NOT re-introduce string-literal calls to "/api/match/decisions/holding"
 * in UI components — search for this module instead.
 *
 * The helper preserves the original ScenarioFlaggedHoldingsList wire shape
 * verbatim (POST, JSON body `{holding_ref, top_candidate_strategy_id}`,
 * 2xx → `{match_decision_id}`, 4xx → server `error` message). The existing
 * ScenarioFlaggedHoldingsList.test.tsx assertions on `global.fetch` continue
 * to see the same `/api/match/decisions/holding` call signature because the
 * helper still issues that exact request.
 */

export type SendBridgeIntroArgs = {
  /** Canonical holding scope_ref — `holding:{venue}:{symbol}:{holding_type}`. */
  holdingRef: string;
  /** Strategy id of the Bridge top candidate to record intent against. */
  topCandidateStrategyId: string;
};

export type SendBridgeIntroResult =
  | { ok: true; matchDecisionId: string }
  | { ok: false; error: string };

export async function sendBridgeIntro(
  args: SendBridgeIntroArgs,
): Promise<SendBridgeIntroResult> {
  try {
    const res = await fetch("/api/match/decisions/holding", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        holding_ref: args.holdingRef,
        top_candidate_strategy_id: args.topCandidateStrategyId,
      }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      const error =
        (body as Record<string, unknown>)?.error;
      return {
        ok: false,
        error: typeof error === "string" ? error : "This comparison isn't available.",
      };
    }
    const body = (await res.json()) as { match_decision_id?: unknown };
    if (typeof body.match_decision_id !== "string") {
      return { ok: false, error: "Malformed response from intro endpoint" };
    }
    return { ok: true, matchDecisionId: body.match_decision_id };
  } catch {
    return { ok: false, error: "Network error. Please retry." };
  }
}
