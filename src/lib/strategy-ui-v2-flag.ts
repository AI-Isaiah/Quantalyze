/**
 * Feature-flag reader for the `/strategy/[id]/v2` surface.
 *
 * Default = ON browser-side. SSR returns false to keep the server-rendered
 * HTML on the v1 path; consumers do a two-pass mount and upgrade to v2 in
 * `useEffect`. This avoids the hydration mismatch that would otherwise fire
 * when SSR and client disagreed on which path to render.
 *
 * Consumer pattern (mirrors AllocationsTabs.tsx:225-243):
 *
 *   const [isV2, setIsV2] = useState(false);
 *   useEffect(() => { setIsV2(isStrategyUiV2Enabled()); }, []);
 *   return isV2 ? <V2 /> : <V1 />;
 *
 * Override hierarchy (highest precedence first):
 *   - URL ?strategy_v2=on|v2|true   → ON for this load
 *   - URL ?strategy_v2=off|false    → OFF for this load
 *   - localStorage "strategy.ui_v2.v17" = "true"  → persistent ON
 *   - localStorage "strategy.ui_v2.v17" = "false" → persistent OFF
 *   - missing / any other value     → DEFAULT ON
 *
 * The storage key is versioned (`.v17`) so the next cutover can bump to
 * `.v18` and silently retire stale opt-outs without paging users into a
 * 404 on the removed v1 route.
 *
 * Use `isStrategyUiV2EnabledClient()` from inside `useEffect` to surface
 * accidental SSR reads — it throws on the server instead of silently
 * returning the SSR-safe `false`.
 */

/** Versioned storage key. Bump on each cutover to retire stale opt-outs. */
export const STRATEGY_UI_V2_STORAGE_KEY = "strategy.ui_v2.v17";
/** Legacy unversioned key — exported for migration tooling/tests, not read at runtime. */
export const STRATEGY_UI_V2_LEGACY_STORAGE_KEY = "strategy.ui_v2";
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
  // SSR returns the safe default (false) so server HTML always picks v1.
  // The browser-side two-pass mount upgrades to v2 in useEffect.
  if (typeof window === "undefined") return false;

  // URL override wins. A malformed override falls through to localStorage
  // so it doesn't silently lock the flag in either direction.
  const search = opts?.search ?? window.location.search;
  const params = new URLSearchParams(search);
  const override = params.get(STRATEGY_UI_V2_URL_OVERRIDE);
  if (override === "v2" || override === "true" || override === "on") {
    return true;
  }
  if (override === "off" || override === "false") {
    return false;
  }

  // Default-ON: only an explicit "false" opts out. Normalize case +
  // whitespace before comparison so "FALSE", " false ", "true\n" are
  // honored instead of dropping silently to the default.
  try {
    const raw = window.localStorage.getItem(STRATEGY_UI_V2_STORAGE_KEY);
    const norm = raw?.trim().toLowerCase();
    if (norm === "false") return false;
    if (norm === "true") return true;
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
