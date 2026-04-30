/**
 * Phase 11 review fix WR-05 — production-URL safety guard for E2E
 * service-role helpers.
 *
 * The e2e seed/cleanup helpers use TEST_SUPABASE_* env vars to mutate
 * a dedicated test Supabase project. If a developer accidentally points
 * those env vars at production, the helpers would happily mutate prod
 * data (auth.admin.createUser / deleteUser cascades irreversibly).
 *
 * The Plan 11-07 Task 3 BLOCKING checkpoint is the primary blast-radius
 * gate. This module is defense-in-depth: refuse to run if the URL
 * matches a known production pattern (project ref or name substring).
 *
 * NOT in src/lib/supabase/ — this is a test-tooling concern, not a
 * runtime auth concern; we keep it isolated so the runtime client code
 * doesn't gain a "production check" surface.
 */

/**
 * Production Supabase project refs. A URL like
 * `https://khslejtfbuezsmvmtsdn.supabase.co` is the prod backend; under
 * NO circumstances should a seed/cleanup helper run against it.
 *
 * Refs are derived from .env.local (NEXT_PUBLIC_SUPABASE_URL).
 */
export const PROD_PROJECT_REFS = ["khslejtfbuezsmvmtsdn"] as const;

/**
 * Paranoid name-substring guard against future prod project renames.
 * Matched case-insensitively.
 */
export const PROD_NAME_SUBSTRINGS = ["quantalyze"] as const;

/**
 * Throw if `url` matches a known production Supabase URL pattern.
 *
 * @param url   The Supabase URL the helper is about to use.
 * @param caller A short label for the throw message (so the developer
 *               can tell which helper refused).
 */
export function assertNotProductionSupabaseUrl(
  url: string,
  caller: string,
): void {
  for (const ref of PROD_PROJECT_REFS) {
    if (url.includes(`${ref}.supabase.co`) || url.includes(`/${ref}/`)) {
      throw new Error(
        `[${caller}] refusing to act against production project ref "${ref}". ` +
          `Set TEST_SUPABASE_URL to the dedicated test Supabase project, NOT prod. ` +
          `(Phase 11 WR-05 defense-in-depth.)`,
      );
    }
  }
  const lower = url.toLowerCase();
  for (const needle of PROD_NAME_SUBSTRINGS) {
    if (lower.includes(needle)) {
      throw new Error(
        `[${caller}] refusing to act against URL matching production-name pattern "${needle}". ` +
          `Set TEST_SUPABASE_URL to the dedicated test Supabase project. ` +
          `(Phase 11 WR-05 defense-in-depth.)`,
      );
    }
  }
}

/**
 * Pre-call probe that converts a downstream "User not allowed" gotrue
 * rejection into a clear, actionable message at the helper boundary.
 *
 * Supabase service-role keys are JWTs whose payload carries
 * `role: "service_role"`. The matching anon key carries `role: "anon"`.
 * Pasting the anon key into the service-role secret slot is a common
 * setup mistake — the Supabase JS client accepts it without complaint
 * and surfaces a cryptic "User not allowed" only when the first
 * `auth.admin.*` call hits gotrue. That signal travels through three
 * layers (helper → @supabase/supabase-js → gotrue HTTP) before the
 * developer sees it, with no hint that the cause is a wrong key.
 *
 * We decode the JWT payload (no signature verification — we are
 * catching configuration errors, not authenticating) and refuse if
 * the role claim is anything other than `service_role`. Non-JWT
 * inputs are ignored so future Supabase key formats degrade
 * gracefully to the existing downstream error.
 */
export function assertSupabaseServiceRoleKey(
  key: string,
  caller: string,
): void {
  const parts = key.split(".");
  if (parts.length !== 3) return;
  let payload: { role?: unknown };
  try {
    const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
    const json =
      typeof Buffer !== "undefined"
        ? Buffer.from(padded, "base64").toString("utf8")
        : atob(padded);
    payload = JSON.parse(json) as { role?: unknown };
  } catch {
    return;
  }
  const role = typeof payload.role === "string" ? payload.role : undefined;
  if (role && role !== "service_role") {
    throw new Error(
      `[${caller}] TEST_SUPABASE_SERVICE_ROLE_KEY has role="${role}" but service_role is required. ` +
        `Open the Supabase project Settings → API → "service_role" (NOT "anon public") and paste THAT value ` +
        `into the GitHub secret TEST_SUPABASE_SERVICE_ROLE_KEY. ` +
        `(Phase 11 WR-05 defense-in-depth — converts gotrue's "User not allowed" into an actionable message.)`,
    );
  }
}
