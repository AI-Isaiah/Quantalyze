/**
 * Phase 14a / KPI-01 — Feature-flag reader for the `/strategy/[id]/v2`
 * Single-Strategy v2 surface.
 *
 * Phase 14a default = OFF. Flips to ON when Phase 14b lands the lazy bodies
 * and full coverage. Mirrors the Phase 09.1/10-06b `allocations.ui_v2`
 * precedent (`AllocationsTabs.tsx`) and the Phase 11 `widget_state_v2` reader
 * (`src/lib/widget-state-flag.ts`).
 *
 * Default OFF. Flip via:
 *   - localStorage.setItem("strategy.ui_v2", "true")  → persistent ON
 *   - URL ?strategy_v2=on / ?strategy_v2=v2 / ?strategy_v2=true → ON for this load
 *   - URL ?strategy_v2=off / ?strategy_v2=false                  → OFF for this load
 *
 * SSR safety: returns `false` (the safe default) when `typeof window ===
 * "undefined"`, avoiding hydration mismatch between server-rendered HTML and
 * client mount. The two-pass mount pattern (`useState(SSR_DEFAULT)` + `useEffect(() =>
 * isStrategyUiV2Enabled() && setState(true), [])`) is the canonical consumer
 * shape; see `AllocationsTabs.tsx:225-243` and `RESEARCH.md` Pattern 2.
 *
 * 14a usage: this reader exists; the redirect consumer (v1 → v2 auto-flip)
 * lands in 14b. In 14a the flag never causes a redirect.
 */

export const STRATEGY_UI_V2_STORAGE_KEY = "strategy.ui_v2";
export const STRATEGY_UI_V2_URL_OVERRIDE = "strategy_v2";

export interface StrategyUiV2Options {
  /**
   * URL search string (with or without leading '?'). Pass an explicit value
   * for unit-testability; the production caller can omit this and the
   * function falls through to `window.location.search`.
   */
  search?: string;
}

export function isStrategyUiV2Enabled(opts?: StrategyUiV2Options): boolean {
  // SSR-safe default OFF in Phase 14a. Flips to ON in Phase 14b.
  if (typeof window === "undefined") return false;

  // URL override wins (highest precedence). The `strategy_v2` param accepts
  // v2/true/on for ON and off/false for OFF; any other value falls through
  // to localStorage so a malformed override doesn't silently lock the flag.
  const search = opts?.search ?? window.location.search;
  const params = new URLSearchParams(search);
  const override = params.get(STRATEGY_UI_V2_URL_OVERRIDE);
  if (override === "v2" || override === "true" || override === "on") {
    return true;
  }
  if (override === "off" || override === "false") {
    return false;
  }

  // Fall through to localStorage (default OFF — Phase 14a contract).
  try {
    const raw = window.localStorage.getItem(STRATEGY_UI_V2_STORAGE_KEY);
    if (raw === "true") return true;
    return false;
  } catch {
    return false;
  }
}
