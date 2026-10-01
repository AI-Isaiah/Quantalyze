/**
 * The Management API introspection path must never fire with a ref that is
 * not a hosted project, and never at production. Both happened or could have:
 * a loopback lane URL sent a real access token to
 * `api.supabase.com/v1/projects/http://127.0.0.1:54421/...` (2026-10-01), and
 * a production URL or SUPABASE_PROJECT_REF would have run the SQL on prod.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { PROD_PROJECT_REFS } from "@/lib/test-safety";

const TEST_REF = "abcdefghijklmnopqrst";

async function load(env: Record<string, string | undefined>) {
  vi.resetModules();
  vi.stubEnv("SUPABASE_ACCESS_TOKEN", "token-for-test");
  vi.stubEnv("SUPABASE_PROJECT_REF", env.SUPABASE_PROJECT_REF);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", env.NEXT_PUBLIC_SUPABASE_URL);
  return import("./live-db");
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("live-db introspection ref guard", () => {
  it("is off for a loopback lane URL, so the token never leaves the machine", async () => {
    const m = await load({ NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54421" });
    expect(m.SUPABASE_PROJECT_REF).toBeUndefined();
    expect(m.HAS_INTROSPECTION).toBe(false);
  });

  it("is off for the production URL", async () => {
    const m = await load({
      NEXT_PUBLIC_SUPABASE_URL: `https://${PROD_PROJECT_REFS[0]}.supabase.co`,
    });
    expect(m.HAS_INTROSPECTION).toBe(false);
  });

  it("is off for an explicit production SUPABASE_PROJECT_REF", async () => {
    const m = await load({
      SUPABASE_PROJECT_REF: PROD_PROJECT_REFS[0],
      NEXT_PUBLIC_SUPABASE_URL: `https://${TEST_REF}.supabase.co`,
    });
    expect(m.HAS_INTROSPECTION).toBe(false);
  });

  it("is off for a malformed explicit ref", async () => {
    const m = await load({ SUPABASE_PROJECT_REF: "http://127.0.0.1:54421" });
    expect(m.HAS_INTROSPECTION).toBe(false);
  });

  it("stays on for a hosted non-production project", async () => {
    const m = await load({ NEXT_PUBLIC_SUPABASE_URL: `https://${TEST_REF}.supabase.co` });
    expect(m.SUPABASE_PROJECT_REF).toBe(TEST_REF);
    expect(m.HAS_INTROSPECTION).toBe(true);
  });
});
