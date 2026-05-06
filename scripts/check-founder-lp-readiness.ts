/**
 * Phase 18 / LP-01 / Adversarial revision 2026-05-06: B1.
 *
 * Pre-flight readiness gate for the founder LP cron. Fails non-zero if the
 * founder strategy is not yet at status='published' OR if the analytics
 * worker has not finished. Run BEFORE enabling the Vercel cron schedule.
 *
 * Usage:
 *   npm run check:founder-lp-readiness
 *
 * Required env:
 *   SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL),
 *   SUPABASE_SERVICE_ROLE_KEY,
 *   FOUNDER_LP_STRATEGY_ID
 */
import { createClient } from "@supabase/supabase-js";

async function main() {
  // Accept either SUPABASE_URL (CI/Railway convention) or
  // NEXT_PUBLIC_SUPABASE_URL (Vercel/local convention) — both point at the
  // same project, and `vercel env pull` writes the `NEXT_PUBLIC_` form.
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const sid = process.env.FOUNDER_LP_STRATEGY_ID;
  if (!url || !key || !sid) {
    console.error(
      "[check-founder-lp-readiness] Missing env (need SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, FOUNDER_LP_STRATEGY_ID)",
    );
    process.exit(2);
  }
  const supabase = createClient(url, key, { auth: { persistSession: false } });
  const { data, error } = await supabase
    .from("strategies")
    .select("id, status, strategy_analytics(computation_status)")
    .eq("id", sid)
    .single();
  if (error || !data) {
    console.error(
      `[check-founder-lp-readiness] Strategy ${sid} not found:`,
      error?.message ?? "no row",
    );
    process.exit(1);
  }
  const status = (data as { status?: string }).status;
  const analyticsRaw = (data as { strategy_analytics?: unknown })
    .strategy_analytics;
  const analytics = Array.isArray(analyticsRaw) ? analyticsRaw[0] : analyticsRaw;
  const compStatus = (analytics as { computation_status?: string } | null | undefined)
    ?.computation_status;
  const failures: string[] = [];
  if (status !== "published") {
    failures.push(`strategies.status='${status}' (expected 'published')`);
  }
  if (compStatus !== "complete") {
    failures.push(
      `strategy_analytics.computation_status='${compStatus}' (expected 'complete')`,
    );
  }
  if (failures.length > 0) {
    console.error("[check-founder-lp-readiness] FAIL:");
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log(
    `[check-founder-lp-readiness] OK — strategy ${sid} ready (status='published', computation_status='complete')`,
  );
  process.exit(0);
}

main().catch((err) => {
  console.error("[check-founder-lp-readiness] unexpected error:", err);
  process.exit(2);
});
