import { describe, it, expect } from "vitest";
import {
  assertNotProductionSupabaseUrl,
  assertSupabaseServiceRoleKey,
  PROD_PROJECT_REFS,
  PROD_NAME_SUBSTRINGS,
} from "./test-safety";

function makeJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(
    JSON.stringify({ alg: "HS256", typ: "JWT" }),
  ).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${header}.${body}.fake-signature`;
}

/**
 * Phase 11 review fix WR-05 — production-URL safety guard tests.
 *
 * These tests pin the contract that the e2e seed/cleanup helpers will
 * refuse to run against the production Supabase project. The guard is
 * defense-in-depth (the Plan 11-07 Task 3 BLOCKING checkpoint is the
 * primary blast-radius gate) but it MUST be reliable — a regression
 * here means a developer who fat-fingers TEST_SUPABASE_URL=prod could
 * silently mutate prod data.
 *
 * Coverage:
 *   - Throws on URL containing the prod project ref (.supabase.co).
 *   - Throws on URL containing the prod project ref in a path segment.
 *   - Throws on URL containing the prod-name substring (case-insensitive).
 *   - Does NOT throw on a clearly-test URL.
 *   - Error message includes the caller name + the matched needle.
 */
describe("assertNotProductionSupabaseUrl", () => {
  it("throws when URL contains a known production project ref subdomain", () => {
    const prodUrl = `https://${PROD_PROJECT_REFS[0]}.supabase.co`;
    expect(() => assertNotProductionSupabaseUrl(prodUrl, "test")).toThrow(
      /refusing to act against production project ref/,
    );
  });

  it("throws when URL contains a known production project ref in a path segment", () => {
    const prodUrl = `https://example.com/projects/${PROD_PROJECT_REFS[0]}/`;
    expect(() => assertNotProductionSupabaseUrl(prodUrl, "test")).toThrow(
      /refusing to act against production project ref/,
    );
  });

  it("throws when URL contains a prod-name substring (case-insensitive)", () => {
    const prodUrl = `https://${PROD_NAME_SUBSTRINGS[0].toUpperCase()}-prod.supabase.co`;
    expect(() => assertNotProductionSupabaseUrl(prodUrl, "test")).toThrow(
      /refusing to act against URL matching production-name pattern/,
    );
  });

  it("does NOT throw on a clearly-test URL", () => {
    expect(() =>
      assertNotProductionSupabaseUrl(
        "https://test-project-abc123.supabase.co",
        "test",
      ),
    ).not.toThrow();
  });

  it("does NOT throw on placeholder/local URLs", () => {
    expect(() =>
      assertNotProductionSupabaseUrl(
        "https://placeholder.supabase.co",
        "test",
      ),
    ).not.toThrow();
    expect(() =>
      assertNotProductionSupabaseUrl("http://localhost:54321", "test"),
    ).not.toThrow();
  });

  it("error message names the caller for debuggability", () => {
    const prodUrl = `https://${PROD_PROJECT_REFS[0]}.supabase.co`;
    expect(() =>
      assertNotProductionSupabaseUrl(prodUrl, "seed-test-project"),
    ).toThrow(/\[seed-test-project\]/);
    expect(() =>
      assertNotProductionSupabaseUrl(prodUrl, "cleanup-test-project"),
    ).toThrow(/\[cleanup-test-project\]/);
  });

  it("error message references Phase 11 WR-05 for grep-ability", () => {
    const prodUrl = `https://${PROD_PROJECT_REFS[0]}.supabase.co`;
    expect(() => assertNotProductionSupabaseUrl(prodUrl, "test")).toThrow(
      /Phase 11 WR-05 defense-in-depth/,
    );
  });

  it("PROD_PROJECT_REFS is non-empty (configuration sanity check)", () => {
    expect(PROD_PROJECT_REFS.length).toBeGreaterThan(0);
    // Each ref looks like a Supabase project ref: 20 alphanumeric chars.
    for (const ref of PROD_PROJECT_REFS) {
      expect(ref).toMatch(/^[a-z0-9]{20}$/);
    }
  });
});

/**
 * Regression coverage for the gotrue "User not allowed" mystery that bit
 * us once: the TEST_SUPABASE_SERVICE_ROLE_KEY GitHub secret was set to
 * the anon key by mistake, and every seed-gated e2e spec failed with a
 * cryptic message that travelled through three layers before hitting
 * the developer's eyes. The probe converts that into a clear "you
 * pasted the wrong key" error at the helper boundary.
 */
describe("assertSupabaseServiceRoleKey", () => {
  it("throws with an actionable message when the JWT role is 'anon'", () => {
    const anonKey = makeJwt({ role: "anon", iss: "supabase" });
    expect(() =>
      assertSupabaseServiceRoleKey(anonKey, "seed-test-project"),
    ).toThrow(
      /TEST_SUPABASE_SERVICE_ROLE_KEY has role="anon" but service_role is required/,
    );
  });

  it("error message tells the user where to paste the right key", () => {
    const anonKey = makeJwt({ role: "anon" });
    expect(() => assertSupabaseServiceRoleKey(anonKey, "test")).toThrow(
      /Settings → API → "service_role"/,
    );
  });

  it("throws on any non-service_role role claim, not just 'anon'", () => {
    const authenticatedKey = makeJwt({ role: "authenticated" });
    expect(() => assertSupabaseServiceRoleKey(authenticatedKey, "test")).toThrow(
      /role="authenticated"/,
    );
  });

  it("does NOT throw when the JWT carries role: 'service_role'", () => {
    const serviceKey = makeJwt({ role: "service_role", iss: "supabase" });
    expect(() => assertSupabaseServiceRoleKey(serviceKey, "test")).not.toThrow();
  });

  it("does NOT throw when the key is not a JWT (forward-compat with future formats)", () => {
    expect(() => assertSupabaseServiceRoleKey("sb_secret_abc123", "test")).not.toThrow();
    expect(() => assertSupabaseServiceRoleKey("placeholder_service_role", "test")).not.toThrow();
  });

  it("does NOT throw when the JWT payload is unparsable (graceful degradation)", () => {
    const garbageJwt = "header.not-base64-or-json.signature";
    expect(() => assertSupabaseServiceRoleKey(garbageJwt, "test")).not.toThrow();
  });

  it("does NOT throw when the JWT has no role claim (lets the API decide)", () => {
    const noRoleKey = makeJwt({ iss: "supabase", sub: "anon" });
    expect(() => assertSupabaseServiceRoleKey(noRoleKey, "test")).not.toThrow();
  });

  it("error message names the caller for debuggability", () => {
    const anonKey = makeJwt({ role: "anon" });
    expect(() =>
      assertSupabaseServiceRoleKey(anonKey, "seed-test-project"),
    ).toThrow(/\[seed-test-project\]/);
    expect(() =>
      assertSupabaseServiceRoleKey(anonKey, "cleanup-test-project"),
    ).toThrow(/\[cleanup-test-project\]/);
  });
});
