/**
 * Phase 14a / KPI-01 — Feature-flag reader for the `/strategy/[id]/v2`
 * Single-Strategy v2 surface.
 *
 * Phase 14b default = ON (browser-side). SSR keeps returning false (the safe
 * default) — exactly mirrors the widget-state-flag.ts SSR pattern from
 * Phase 11. Consumers MUST do a two-pass mount: initial render uses the
 * SSR-safe v1 path; on `useEffect`, read this flag and upgrade to v2 if
 * it resolves true. This prevents the hydration mismatch flagged by Grok
 * B-05 for legacy users with `localStorage["strategy.ui_v2"]="false"`.
 *
 * Recommended consumer pattern (mirrors AllocationsTabs.tsx:225-243):
 *
 *   const [isV2, setIsV2] = useState(false);  // SSR-safe initial value
 *   useEffect(() => { setIsV2(isStrategyUiV2Enabled()); }, []);
 *   return isV2 ? <V2 /> : <V1 />;
 *
 * Override hierarchy (highest precedence first):
 *   - URL ?strategy_v2=on / ?strategy_v2=v2 / ?strategy_v2=true → ON for this load
 *   - URL ?strategy_v2=off / ?strategy_v2=false                  → OFF for this load
 *   - localStorage.setItem("strategy.ui_v2", "true")  → persistent ON (redundant under 14b but accepted)
 *   - localStorage.setItem("strategy.ui_v2", "false") → persistent OFF (legacy opt-out preserved)
 *   - missing / any other localStorage value → DEFAULT ON (Phase 14b flip)
 *
 * SSR safety: returns `false` (the safe default) when `typeof window ===
 * "undefined"`, avoiding hydration mismatch between server-rendered HTML and
 * client mount. The two-pass mount pattern (`useState(SSR_DEFAULT)` + `useEffect(() =>
 * isStrategyUiV2Enabled() && setState(true), [])`) is the canonical consumer
 * shape; see `AllocationsTabs.tsx:225-243` and `RESEARCH.md` Pattern 2.
 *
 * Use `isStrategyUiV2EnabledClient()` from inside `useEffect` for a
 * strongly-typed signal that the call is browser-only — it throws if
 * invoked during SSR, surfacing accidental server-side reads early.
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
  // Grok B-05 — SSR keeps returning false (safe default). Consumers do
  // a two-pass mount via useEffect to upgrade to v2 in the browser.
  // Mirrors the widget-state-flag.ts SSR pattern from Phase 11.
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

  // Fall through to localStorage. Default-ON contract for the browser:
  //   - "false" → explicit user opt-out → return false (legacy opt-out persists)
  //   - "true"  → explicit user opt-in (redundant but accepted) → return true
  //   - missing / any other value → default ON (new in Phase 14b)
  try {
    const raw = window.localStorage.getItem(STRATEGY_UI_V2_STORAGE_KEY);
    if (raw === "false") return false;
    if (raw === "true") return true;
    return true;
  } catch {
    return true;
  }
}

/**
 * Browser-only convenience wrapper around `isStrategyUiV2Enabled`. Throws in
 * SSR contexts so accidental server-side reads surface immediately rather
 * than silently returning the SSR-safe `false`.
 *
 * Call from inside a `useEffect` so the initial render uses the SSR-safe
 * default (v1) and the upgrade to v2 happens post-hydration only — exactly
 * the two-pass shape that prevents Grok B-05 hydration mismatches.
 *
 * @example
 *   useEffect(() => {
 *     setIsV2(isStrategyUiV2EnabledClient());
 *   }, []);
 */
export function isStrategyUiV2EnabledClient(
  opts?: StrategyUiV2Options,
): boolean {
  if (typeof window === "undefined") {
    throw new Error(
      "isStrategyUiV2EnabledClient called on the server. Use it from useEffect only.",
    );
  }
  return isStrategyUiV2Enabled(opts);
}
