import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Phase 19 / BACKBONE-05 — Next.js feature flag read seam.
 *
 * Mirrors `analytics-service/services/feature_flags.py` (Python). Reads the
 * Supabase kill-switch row first; falls back to the
 * `PROCESS_KEY_UNIFIED_BACKBONE` env var on Supabase outage. 30-second
 * in-process cache.
 *
 * Read order
 * ----------
 *   1. In-process cache (TTL 30s).
 *   2. Supabase `feature_flags` table — if `process_key_unified_backbone`
 *      row has `value='off'`, force OFF regardless of env var (kill-switch).
 *   3. Env var `PROCESS_KEY_UNIFIED_BACKBONE` — value 'on' enables; anything
 *      else (including absent) is OFF.
 *
 * Fail-soft semantics
 * -------------------
 * On a transient Supabase outage where env=on, the kill-switch read fails
 * open — env decides — so the synchronous /process-key path stays alive
 * instead of flipping to a user-visible 503. Sustained outages surface in
 * Sentry via the `console.warn` at the catch site.
 */

const CACHE_TTL_MS = 30_000;
let _cache: { value: boolean; expiresAt: number } | null = null;

export async function isUnifiedBackboneActive(): Promise<boolean> {
  const now = Date.now();
  if (_cache && _cache.expiresAt > now) return _cache.value;

  // Step 1: kill-switch row check.
  let killSwitchOff = false;
  try {
    const admin = createAdminClient();
    const { data } = await admin
      .from("feature_flags")
      .select("value")
      .eq("flag_key", "process_key_unified_backbone")
      .maybeSingle();
    if (data?.value === "off") killSwitchOff = true;
  } catch (err) {
    // Fail-soft on Supabase outage: don't block on connectivity. Env decides.
    // Logged at WARN so a sustained outage is visible in Sentry.
    console.warn("[feature-flags] kill-switch read failed:", err);
  }

  // Step 2: env var.
  const envValue = process.env.PROCESS_KEY_UNIFIED_BACKBONE === "on";

  const value = envValue && !killSwitchOff;
  _cache = { value, expiresAt: now + CACHE_TTL_MS };
  return value;
}

/** Test-only: clear the in-process cache. Do NOT call from production code. */
export function _resetCacheForTests(): void {
  _cache = null;
}
