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
 *
 * Exit codes:
 *   0 — strategy is ready (published + analytics complete)
 *   1 — strategy is not ready (data state failure; details on stderr)
 *   2 — misconfigured (missing env, unexpected exception)
 *
 * Phase 18 / M7 + M8 — readiness query delegated to the shared helper at
 * `@/lib/founder-lp/readiness` so the cron and pre-flight script cannot
 * drift on either the SELECT shape or the analytics-extraction path.
 */
import { createClient } from "@supabase/supabase-js";
import { checkFounderStrategyReadiness } from "@/lib/founder-lp/readiness";

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
  const readiness = await checkFounderStrategyReadiness(supabase, sid);
  if (!readiness.ok) {
    console.error("[check-founder-lp-readiness] FAIL:");
    console.error(`  - ${readiness.reason}`);
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
