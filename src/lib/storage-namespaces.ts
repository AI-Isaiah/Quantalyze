/**
 * Registry of localStorage key prefixes that the app writes per-user or
 * per-device. Drives the cross-account purge in `SignOutButton.tsx` and the
 * test fallback in `e2e/discovery-prefs-isolation.spec.ts` (T-13-02-01).
 *
 * Adding a new app-namespaced localStorage key? Add its prefix here OR pick a
 * key name that starts with one of the existing prefixes. A unit test
 * (`storage-namespaces.test.ts`) walks the codebase for `localStorage.setItem`
 * call sites and asserts every literal key name matches at least one entry —
 * a missed prefix breaks CI before it reaches a shared device.
 *
 * Supabase auth keys (`sb-*`) are NOT in this list — they're owned by
 * `supabase.auth.signOut()` and must persist across the purge so the SDK can
 * complete its server-side revocation handshake before redirect.
 */
export const APP_NAMESPACED_PREFIXES: readonly string[] = [
  "quantalyze-",
  "quantalyze_",
  "allocations.",
  "widget_state_",
  "discovery_",
  "discovery.",
  "admin-compute-",
] as const;

/**
 * Purge every localStorage key matching an app-namespaced prefix.
 *
 * Runs synchronously before `supabase.auth.signOut()` so the keys are gone
 * regardless of whether the auth call resolves. No-op outside the browser.
 */
export function purgeAppNamespacedStorage(): void {
  if (typeof window === "undefined") return;
  Object.keys(window.localStorage)
    .filter((k) => APP_NAMESPACED_PREFIXES.some((p) => k.startsWith(p)))
    .forEach((k) => window.localStorage.removeItem(k));
}
