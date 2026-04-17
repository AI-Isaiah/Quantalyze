import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * The attestation upsert used to have `ignoreDuplicates: true` without a
 * `.select()` tail. Adding `.select()` naively to the old form would crash
 * with "no rows returned" on the duplicate-skip path — a latent footgun.
 *
 * PR 1 removes `ignoreDuplicates` and adds `.select(...).single()`. This
 * test simulates a double POST (first insert, then overwrite) and verifies
 * that the second call returns 200 with the upserted row, never 500.
 *
 * PR 3 adds CSRF Origin/Referer header validation. All happy-path POSTs
 * here include `origin: http://localhost:3000` so they pass the CSRF check
 * (NODE_ENV defaults to "test" / "development" in vitest, which trusts
 * localhost). The bottom of the file adds dedicated CSRF integration tests
 * covering missing/wrong-origin rejection.
 */

// audit.ts imports "server-only" which throws under vitest+jsdom.
vi.mock("server-only", () => ({}));

vi.mock("next/server", async () => {
  const actual = await vi.importActual<typeof import("next/server")>(
    "next/server",
  );
  return {
    ...actual,
    after: (cb: () => void | Promise<void>) => {
      void cb();
    },
  };
});

const VALID_ORIGIN = { origin: "http://localhost:3000" };

const authUser = vi.hoisted(() => ({
  id: "00000000-0000-0000-0000-000000000001",
}));

// Track how many times the attestation POST has been called so we can
// return different rows (same user_id, different timestamps) on the
// second call — simulating the idempotent re-attestation.
const supabaseState = vi.hoisted(() => ({
  callCount: 0,
  lastAttestedAt: "2026-04-07T00:00:00.000Z",
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: authUser }, error: null }),
    },
    // log_audit_event RPC stub — always succeeds.
    rpc: async () => ({ data: null, error: null }),
    from: () => {
      supabaseState.callCount += 1;
      supabaseState.lastAttestedAt = new Date().toISOString();
      const row = {
        user_id: authUser.id,
        attested_at: supabaseState.lastAttestedAt,
        version: "2026-04-07",
      };
      return {
        upsert: () => ({
          select: () => ({
            single: async () => ({ data: row, error: null }),
          }),
        }),
      };
    },
  }),
}));

describe("POST /api/attestation", () => {
  beforeEach(() => {
    supabaseState.callCount = 0;
  });

  it("returns 200 + attestation on first-time insert", async () => {
    const { POST } = await import("./route");
    const req = new NextRequest("http://localhost:3000/api/attestation", {
      method: "POST",
      headers: VALID_ORIGIN,
      body: JSON.stringify({ accepted: true }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.attestation).toEqual(
      expect.objectContaining({
        user_id: authUser.id,
        version: "2026-04-07",
      }),
    );
  });

  it("returns 200 + attestation on repeat POST (does not crash on duplicate)", async () => {
    const { POST } = await import("./route");

    // First call: insert.
    const req1 = new NextRequest("http://localhost:3000/api/attestation", {
      method: "POST",
      headers: VALID_ORIGIN,
      body: JSON.stringify({ accepted: true }),
    });
    const res1 = await POST(req1);
    expect(res1.status).toBe(200);

    // Second call: the old code path (with ignoreDuplicates + .select.single)
    // would have crashed here with "no rows returned". The fix must return
    // 200 with the existing row.
    const req2 = new NextRequest("http://localhost:3000/api/attestation", {
      method: "POST",
      headers: VALID_ORIGIN,
      body: JSON.stringify({ accepted: true }),
    });
    const res2 = await POST(req2);
    expect(res2.status).toBe(200);
    const body = await res2.json();
    expect(body.ok).toBe(true);
    expect(body.attestation).toEqual(
      expect.objectContaining({
        user_id: authUser.id,
        version: "2026-04-07",
      }),
    );
    expect(supabaseState.callCount).toBe(2);
  });

  it("returns 400 when accepted is not explicitly true", async () => {
    const { POST } = await import("./route");
    const req = new NextRequest("http://localhost:3000/api/attestation", {
      method: "POST",
      headers: VALID_ORIGIN,
      body: JSON.stringify({ accepted: false }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  // PR 3 — CSRF Origin/Referer integration coverage on this route. The unit
  // tests for the helper itself live in src/lib/csrf.test.ts; these tests
  // confirm the helper is wired up at the very top of the handler (before
  // auth + rate limit) and that callCount stays at 0 on rejection — i.e.
  // we never even open a Supabase client for a bad-origin request.
  describe("CSRF Origin/Referer enforcement", () => {
    it("returns 403 when no Origin or Referer header is present", async () => {
      const { POST } = await import("./route");
      const req = new NextRequest("http://localhost:3000/api/attestation", {
        method: "POST",
        body: JSON.stringify({ accepted: true }),
      });
      const res = await POST(req);
      expect(res.status).toBe(403);
      expect(supabaseState.callCount).toBe(0);
    });

    it("returns 403 when Origin host is not in allowlist", async () => {
      const { POST } = await import("./route");
      const req = new NextRequest("http://localhost:3000/api/attestation", {
        method: "POST",
        headers: { origin: "https://evil.example.com" },
        body: JSON.stringify({ accepted: true }),
      });
      const res = await POST(req);
      expect(res.status).toBe(403);
      expect(supabaseState.callCount).toBe(0);
    });

    it("proceeds past CSRF check with a valid Origin", async () => {
      const { POST } = await import("./route");
      const req = new NextRequest("http://localhost:3000/api/attestation", {
        method: "POST",
        headers: VALID_ORIGIN,
        body: JSON.stringify({ accepted: true }),
      });
      const res = await POST(req);
      expect(res.status).toBe(200);
      expect(supabaseState.callCount).toBe(1);
    });
  });
});
