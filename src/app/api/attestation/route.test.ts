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
 */

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
    const req = new NextRequest("http://localhost/api/attestation", {
      method: "POST",
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
    const req1 = new NextRequest("http://localhost/api/attestation", {
      method: "POST",
      body: JSON.stringify({ accepted: true }),
    });
    const res1 = await POST(req1);
    expect(res1.status).toBe(200);

    // Second call: the old code path (with ignoreDuplicates + .select.single)
    // would have crashed here with "no rows returned". The fix must return
    // 200 with the existing row.
    const req2 = new NextRequest("http://localhost/api/attestation", {
      method: "POST",
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
    const req = new NextRequest("http://localhost/api/attestation", {
      method: "POST",
      body: JSON.stringify({ accepted: false }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });
});
