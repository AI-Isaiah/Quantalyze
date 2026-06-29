/**
 * `withViewTransition` — a tiny, framework-agnostic wrapper around the NATIVE
 * View Transitions API (`document.startViewTransition`).
 *
 * Phase-50 decision (STATE-04): use the native browser API from a client
 * island, NOT React's `<ViewTransition>` + the `experimental.viewTransition`
 * next.config flag. Two opt-in micro-interactions consume this — the Tabs panel
 * swap and the StrategyTable density toggle (both Wave 2) — so the lower blast
 * radius of the native path is preferred over enabling an experimental flag.
 *
 * Degradation (no motion library, no config flag):
 *   - SSR / no `document`                -> run `update()` synchronously.
 *   - `startViewTransition` unsupported  -> run `update()` synchronously.
 *   - `prefers-reduced-motion: reduce`   -> run `update()` synchronously.
 * The reduced-motion guard pairs with the globals.css
 * `::view-transition-old/new { animation-duration: 0s !important }` rule under
 * the same media query (belt and suspenders): this skips the snapshot work
 * entirely, the CSS zeroes any transition that still slips through.
 *
 * @param update A `() => void` that performs the state change to transition.
 *               The DOM mutation it triggers is what the browser crossfades.
 */
export function withViewTransition(update: () => void): void {
  if (
    typeof document !== "undefined" &&
    typeof document.startViewTransition === "function" &&
    !prefersReducedMotion()
  ) {
    document.startViewTransition(update);
    return;
  }
  // SSR, no API support, or reduced motion -> instant swap.
  update();
}

/**
 * `true` when the user has asked the OS to reduce motion. Guarded for SSR and
 * for environments (e.g. jsdom) where `matchMedia` is absent — both return
 * `false` so the caller falls through to the support/SSR checks above.
 */
function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
