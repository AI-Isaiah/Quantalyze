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
 * Branded type carrying the contract that the value passed
 * `assertSupabaseServiceRoleKey`. The brand is purely a compile-time
 * marker — at runtime the value is still a plain string. Functions
 * that mutate prod-shaped data should accept `ServiceRoleKey` instead
 * of `string` so the type checker rejects raw env access at call
 * sites that skipped the probe.
 */
declare const ServiceRoleKeyBrand: unique symbol;
export type ServiceRoleKey = string & { readonly [ServiceRoleKeyBrand]: true };

/**
 * Catch the anon-key-pasted-as-service-role mistake at the helper
 * boundary. Without this probe, gotrue's "User not allowed" travels
 * through helper → @supabase/supabase-js → HTTP before a developer
 * sees it, with no hint that the cause is a wrong-key paste.
 *
 * The JWT payload is decoded WITHOUT signature verification — this is
 * a configuration probe, not an authentication step. Non-JWT inputs
 * (≠ 3 dot-separated parts) pass through so future Supabase key
 * formats keep working. A JWT-SHAPED string whose middle part fails
 * to base64-decode or JSON-parse is a corruption signal and throws —
 * silently degrading there hides "the secret got truncated in CI"
 * mistakes behind the same downstream "User not allowed" message
 * that the probe was added to surface.
 *
 * Asserts `key is ServiceRoleKey` so callers can pass the validated
 * value into typed sinks without re-checking.
 */
export function assertSupabaseServiceRoleKey(
  key: string,
  caller: string,
): asserts key is ServiceRoleKey {
  const parts = key.split(".");
  if (parts.length !== 3) return;
  let payload: { role?: unknown };
  try {
    const json = Buffer.from(parts[1], "base64url").toString("utf8");
    payload = JSON.parse(json) as { role?: unknown };
  } catch (cause) {
    throw new Error(
      `[${caller}] TEST_SUPABASE_SERVICE_ROLE_KEY looks like a JWT (3 dot-separated parts) but its ` +
        `payload doesn't decode — the secret is corrupted or truncated. Re-copy it from Supabase ` +
        `project Settings → API → "service_role" and update the GitHub secret.`,
      { cause: cause instanceof Error ? cause : new Error(String(cause)) },
    );
  }
  const role = typeof payload.role === "string" ? payload.role : undefined;
  if (role && role !== "service_role") {
    throw new Error(
      `[${caller}] TEST_SUPABASE_SERVICE_ROLE_KEY has role="${role}" but service_role is required. ` +
        `Open the Supabase project Settings → API → "service_role" (NOT "anon public") and paste THAT value ` +
        `into the GitHub secret TEST_SUPABASE_SERVICE_ROLE_KEY.`,
    );
  }
}
