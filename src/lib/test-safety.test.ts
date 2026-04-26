import { describe, it, expect } from "vitest";
import {
  assertNotProductionSupabaseUrl,
  PROD_PROJECT_REFS,
  PROD_NAME_SUBSTRINGS,
} from "./test-safety";

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
