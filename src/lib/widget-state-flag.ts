/**
 * Phase 11 / Plan 04 / RISK-1 — Feature-flag reader for the WidgetState v2
 * universal rollout.
 *
 * The <WidgetState> primitive (Plan 11-04) is shipped in this phase and
 * the core widgets are wired through it via per-state
 * fixtures. The remaining long-tail renderers are NOT
 * universally re-wrapped in this phase — gating universal consumption
 * behind this flag prevents a primitive bug from regressing every
 * widget simultaneously.
 *
 * Default OFF. Flip via:
 *   - localStorage.setItem("widget_state_v2", "true")  → persistent ON
 *   - URL ?widget_state=v2                              → ON for this load
 *   - URL ?widget_state=off                             → OFF for this load
 *
 * Mirrors the Phase 09.1/10-06b `allocations.ui_v2` precedent in
 * AllocationsTabs.tsx but inverts the default (the ui_v2 flag is default
 * ON because it shipped with universal coverage from day one; this flag
 * is default OFF because RISK-1 needs the long-tail widgets to retain
 * pre-Phase-11 ad-hoc state handling until the flag flips).
 */

export const WIDGET_STATE_V2_STORAGE_KEY = "widget_state_v2";
export const WIDGET_STATE_V2_URL_OVERRIDE = "widget_state";

export interface WidgetStateV2Options {
  /**
   * URL search string (with or without leading '?'). Pass an explicit value
   * for unit-testability; the production caller can omit this and the
   * function falls through to `window.location.search`.
   */
  search?: string;
}

export function isWidgetStateV2Enabled(opts?: WidgetStateV2Options): boolean {
  // SSR-safe default OFF — there is no localStorage on the server, and
  // the long-tail widgets must keep their pre-Phase-11 behavior until a
  // browser-side flip (or URL override on a real request) flips it ON.
  if (typeof window === "undefined") return false;

  // URL override wins (highest precedence). The `widget_state` param
  // accepts v2/true/on for ON and off/false for OFF; any other value
  // falls through to localStorage so a malformed override doesn't
  // silently lock the flag.
  const search = opts?.search ?? window.location.search;
  const params = new URLSearchParams(search);
  const override = params.get(WIDGET_STATE_V2_URL_OVERRIDE);
  if (override === "v2" || override === "true" || override === "on") {
    return true;
  }
  if (override === "off" || override === "false") {
    return false;
  }

  // Fall through to localStorage (default OFF — RISK-1 mitigation).
  try {
    const raw = window.localStorage.getItem(WIDGET_STATE_V2_STORAGE_KEY);
    if (raw === "true") return true;
    return false;
  } catch {
    return false;
  }
}
