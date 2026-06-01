/**
 * Registry of localStorage key prefixes that the app writes per-user or
 * per-device. Drives the cross-account purge in `SignOutButton.tsx` and the
 * test fallback in `e2e/discovery-prefs-isolation.spec.ts` (T-13-02-01).
 *
 * Adding a new app-namespaced localStorage key? Add its prefix here OR pick a
 * key name that starts with one of the existing prefixes. Enforcement is the
 * manual `KNOWN_APP_KEYS` inventory in `SignOutButton.test.tsx`: it seeds one
 * representative key per prefix (and per documented raw-storage exception) and
 * asserts the sign-out purge removes exactly the app-namespaced ones. Most app
 * keys now flow through `useCrossTabStorage({ key })` rather than a raw
 * `localStorage.setItem` literal, so keep that inventory in step when you add a
 * prefix here — a missed entry means a key survives a shared-device sign-out.
 * (The B25 raw-`localStorage` lint ban is the planned automated capstone.)
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
  "factsheet-v2:",
  "factsheet-collapse:",
] as const;

/**
 * Purge every localStorage key matching an app-namespaced prefix.
 *
 * Runs synchronously before `supabase.auth.signOut()` so the keys are gone
 * regardless of whether the auth call resolves. No-op outside the browser.
 *
 * B7 sanctioned-exception: this is the cross-account purge walker — it
 * enumerates ALL localStorage keys and removes the namespaced ones. It cannot
 * route through `useCrossTabStorage` (a single typed key+codec hook); operating
 * over the whole keyspace IS its job. Exempts the file from the B25
 * `no-raw-localstorage` rule (it is the storage-layer infrastructure the rule
 * points other code toward, not drift).
 */
export function purgeAppNamespacedStorage(): void {
  if (typeof window === "undefined") return;
  Object.keys(window.localStorage)
    .filter((k) => APP_NAMESPACED_PREFIXES.some((p) => k.startsWith(p)))
    .forEach((k) => window.localStorage.removeItem(k));
}
