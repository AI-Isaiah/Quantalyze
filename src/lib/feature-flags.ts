import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Phase 19 / BACKBONE-04 + BACKBONE-05 — Next.js feature flag read seam.
 *
 * Mirrors analytics-service/services/feature_flags.py. Reads Supabase
 * kill-switch row first; falls back to PROCESS_KEY_UNIFIED_BACKBONE env var
 * on outage. In-process cache with a configurable TTL (D-4).
 *
 * Read order
 * ----------
 *   1. In-process cache (TTL from PHASE_19_STABILITY_CACHE_TTL_S, default 30s).
 *   2. Supabase `feature_flags` table — if `process_key_unified_backbone`
 *      row has `value='off'`, force OFF regardless of env var (kill-switch).
 *   3. Env var `PROCESS_KEY_UNIFIED_BACKBONE` — value 'on' enables; anything
 *      else (including absent) is OFF.
 *
 * Fail-soft semantics (H-3 mirror)
 * --------------------------------
 * When Supabase is unreachable AND env var is unset, returns false (unified
 * backbone OFF). On a transient Supabase outage where env=on, the kill-switch
 * read fails open — env decides — so the synchronous /process-key path stays
 * alive instead of flipping to a user-visible 503. A successful read shortly
 * before an outage continues to be served until the TTL expires.
 *
 * D-4 — cache TTL during stability window
 * ---------------------------------------
 * Default 30s. During the 7-day stability window after PR-B, the founder can
 * set PHASE_19_STABILITY_CACHE_TTL_S=5 in the Vercel environment to shorten
 * kill-switch propagation from 30s → 5s. Combined with the 15-min cron tick
 * the worst-case auto-rollback latency drops to ≤15min05s. After PR-D ships
 * the env var can be unset (defaults back to 30s).
 */

const KILL_SWITCH_KEY = "process_key_unified_backbone";

// Default constant for greppability (acceptance criterion in 19-05 P5-1
// `grep -q 'CACHE_TTL_MS = 30_000' src/lib/feature-flags.ts`). The runtime
// TTL is re-resolved per cache miss in resolveCacheTtlMs() so an env-var
// change during the stability window takes effect without a redeploy.
//
// M-16: this constant is load-bearing — resolveCacheTtlMs() now falls back
// to it instead of duplicating the literal `30_000`. Editing this constant
// changes the default in one place.
const CACHE_TTL_MS = 30_000;

function resolveCacheTtlMs(): number {
  const raw = process.env.PHASE_19_STABILITY_CACHE_TTL_S;
  if (!raw) return CACHE_TTL_MS;
  const parsed = parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return CACHE_TTL_MS;
  return parsed * 1_000;
}

let _cache: { value: boolean; expiresAt: number } | null = null;

export async function isUnifiedBackboneActive(): Promise<boolean> {
  const now = Date.now();
  if (_cache && _cache.expiresAt > now) return _cache.value;

  // I-API3: outage-aware cache. On Supabase failure, hold the previous cached
  // value (if any) for one TTL window so a flapping kill-switch row doesn't
  // cause unrelated callers to oscillate between env-on and env-off. Falls
  // through to envValue when there's no prior cache (cold start during
  // outage). Mirrors analytics-service/services/feature_flags.py.
  const prevCache = _cache;
  let killSwitchOff = false;
  let supabaseErrored = false;
  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("feature_flags")
      .select("value")
      .eq("flag_key", KILL_SWITCH_KEY)
      .maybeSingle();
    if (error) {
      supabaseErrored = true;
      console.warn("[feature-flags] kill-switch read failed:", error.message);
    } else if (data?.value === "off") {
      killSwitchOff = true;
    }
  } catch (err) {
    supabaseErrored = true;
    console.warn("[feature-flags] kill-switch read threw:", err);
  }

  const envValue = process.env.PROCESS_KEY_UNIFIED_BACKBONE === "on";
  const ttlMs = resolveCacheTtlMs();

  if (supabaseErrored) {
    const heldValue = prevCache ? prevCache.value : envValue;
    _cache = { value: heldValue, expiresAt: now + ttlMs };
    return heldValue;
  }

  const value = envValue && !killSwitchOff;
  _cache = { value, expiresAt: now + ttlMs };
  return value;
}

/** Test-only: clear the in-process cache. Do NOT call from production code. */
export function _resetCacheForTests(): void {
  _cache = null;
}

// Internal — exported for D-4 tests in 19-07 P7-3 (and a defensive
// regression test that documents the default TTL).
export const _internal = {
  KILL_SWITCH_KEY,
  CACHE_TTL_MS,
  resolveCacheTtlMs,
};
