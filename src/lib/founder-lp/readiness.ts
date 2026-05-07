/**
 * Phase 18 / LP-01 — shared founder LP readiness check.
 *
 * Both the cron route (`src/app/api/cron/founder-lp-report/route.ts`)
 * and the pre-flight script (`scripts/check-founder-lp-readiness.ts`)
 * must agree on what "ready to email" means: published strategy with a
 * complete analytics row. Hosted in one module so /ship's pre-flight
 * gate cannot drift from the cron's runtime gate.
 *
 * Behavior contract:
 *   ok=true  → strategy.status='published' AND analytics.computation_status='complete'
 *   ok=false → reason string suitable for Sentry tagging + Resend body.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { extractAnalytics } from "@/lib/queries";

export type ReadinessResult =
  | { ok: true; name: string | null }
  | { ok: false; reason: string };

export async function checkFounderStrategyReadiness(
  supabase: SupabaseClient,
  strategy_id: string,
): Promise<ReadinessResult> {
  const { data, error } = await supabase
    .from("strategies")
    .select("id, name, status, strategy_analytics(computation_status)")
    .eq("id", strategy_id)
    .single();
  if (error || !data) {
    return {
      ok: false,
      reason: `strategy ${strategy_id} not found: ${error?.message ?? "no row"}`,
    };
  }
  const status = (data as { status?: string }).status;
  // WR-04 — canonical extractAnalytics handles both array and object shapes
  // returned by Supabase embedded relations. Keeps cron + pre-flight in
  // lock-step with the factsheet endpoint.
  const analytics = extractAnalytics(
    (data as { strategy_analytics?: unknown }).strategy_analytics,
  );
  if (status !== "published") {
    return {
      ok: false,
      reason: `strategies.status='${status}' (expected 'published') — see .planning/phase-18/founder-lp-runbook.md`,
    };
  }
  // Phase 18 / round-2 (Claude adv conf 5) — distinguish "no analytics
  // row" from "still computing". Pre-fix, a missing FK row produced
  // `computation_status='undefined'` literally in the runbook trail, which
  // misled operators into looking for a value that the column doesn't have.
  if (analytics === null || analytics === undefined) {
    return {
      ok: false,
      reason:
        `strategy_analytics row missing for strategy ${strategy_id} — analytics worker has not run yet`,
    };
  }
  const compStatus = analytics.computation_status;
  if (compStatus !== "complete") {
    return {
      ok: false,
      reason: `strategy_analytics.computation_status='${compStatus}' (expected 'complete')`,
    };
  }
  return {
    ok: true,
    name: (data as { name?: string | null }).name ?? null,
  };
}
