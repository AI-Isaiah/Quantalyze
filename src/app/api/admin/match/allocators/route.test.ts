import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * audit-2026-05-07 C-0041 — defense-in-depth CSRF guard on a GET that
 * exposes allocator PII (display_name, email, company). Sibling
 * /api/admin/match/{decisions,kill-switch,send-intro,recompute} POST/DELETE
 * handlers all run assertSameOrigin. The GET here was the outlier: a
 * stolen-session or token-replay probe from an off-origin context could
 * read the entire allocator roster. The check now runs BEFORE auth so a
 * cross-origin probe doesn't even reach the admin-gate (also avoids the
 * timing oracle of "auth gate slow vs CSRF gate fast").
 */

vi.mock("server-only", () => ({}));

const userState = vi.hoisted<{ current: { id: string } | null }>(() => ({
  current: null,
}));
const adminFlag = vi.hoisted(() => ({ isAdmin: false }));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({
        data: { user: userState.current },
        error: null,
      }),
    },
  }),
}));

vi.mock("@/lib/admin", () => ({
  isAdminUser: async () => adminFlag.isAdmin,
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => ({
      select: () => ({ in: async () => ({ data: [], error: null }) }),
    }),
  }),
}));

function makeReq(headers: Record<string, string>): NextRequest {
  return new NextRequest("http://localhost:3000/api/admin/match/allocators", {
    method: "GET",
    headers,
  });
}

describe("GET /api/admin/match/allocators — C-0041 same-origin guard", () => {
  beforeEach(() => {
    userState.current = { id: "admin-1" };
    adminFlag.isAdmin = true;
    vi.resetModules();
  });

  it("rejects requests missing Origin and Referer with 403 (pre-fix: leaked PII)", async () => {
    const { GET } = await import("./route");
    const res = await GET(makeReq({}));
    // Pre-fix: handler ran auth + returned the allocator list to anyone
    // whose session cookie was replayed. Post-fix: CSRF gate runs first
    // and rejects on missing Origin/Referer.
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toMatch(/Origin|Referer/i);
  });

  it("rejects requests with an off-origin Origin header with 403", async () => {
    const { GET } = await import("./route");
    const res = await GET(
      makeReq({ origin: "https://evil.example.com" }),
    );
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toMatch(/not allowed/i);
  });

  it("passes the CSRF gate when the Origin matches the allowlist (sanity)", async () => {
    const { GET } = await import("./route");
    const res = await GET(makeReq({ origin: "http://localhost:3000" }));
    // After the CSRF gate passes, the handler runs auth + DB. The mocked
    // admin returns an empty profile set → 200 with `allocators: []`.
    expect(res.status).toBe(200);
    // Block D / P1947: the success body carries allocator PII (display_name,
    // email, company) + per-allocator triage metadata — must be private,
    // no-store so a shared cache cannot leak it cross-admin/cross-tenant.
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    const body = await res.json();
    expect(body).toEqual({ allocators: [] });
  });
});

/**
 * M-0273 (testgap API2) — triage scoring + schema-error coverage.
 *
 * The triage score (needs_attention +100, is_stale +50, zero_decisions +25,
 * filter_relaxed +30) and the score-tie tiebreaker by computed_at determine
 * the ordering of the founder's daily admin-queue worklist. The scoring lives
 * 100% inside the route handler, so a subtle change (e.g. flipping the 14-day
 * threshold) would silently re-order the queue with no test failing. These
 * tests pin each rank rule + the empty short-circuit + the PGRST205 503 hint.
 *
 * Uses vi.resetModules() + vi.doMock so each test installs an admin client
 * that returns exactly the profiles / batches / decisions rows it needs.
 */
type AdminFixture = {
  profiles?:
    | { data: Array<Record<string, unknown>> | null; error: { code?: string; message?: string } | null }
    | undefined;
  batches?: Array<Record<string, unknown>>;
  prefs?: Array<Record<string, unknown>>;
  intros?: Array<Record<string, unknown>>;
};

describe("GET /api/admin/match/allocators — M-0273 triage scoring", () => {
  beforeEach(() => {
    userState.current = { id: "admin-1" };
    adminFlag.isAdmin = true;
    vi.resetModules();
  });

  /** Install an admin client whose per-table responses match the fixture. */
  function mockAdminClient(fx: AdminFixture): void {
    const profilesResp = fx.profiles ?? {
      data: fx.profiles === undefined ? [] : null,
      error: null,
    };
    vi.doMock("@/lib/supabase/admin", () => ({
      createAdminClient: () => ({
        from: (table: string) => {
          if (table === "profiles") {
            return { select: () => ({ in: async () => profilesResp }) };
          }
          if (table === "match_batches") {
            return {
              select: () => ({
                in: () => ({
                  order: async () => ({ data: fx.batches ?? [], error: null }),
                }),
              }),
            };
          }
          if (table === "allocator_preferences") {
            return {
              select: () => ({ in: async () => ({ data: fx.prefs ?? [], error: null }) }),
            };
          }
          if (table === "match_decisions") {
            return {
              select: () => ({
                eq: () => ({
                  in: () => ({
                    order: async () => ({ data: fx.intros ?? [], error: null }),
                  }),
                }),
              }),
            };
          }
          throw new Error(`unexpected from(${table})`);
        },
      }),
    }));
  }

  function okReq(): NextRequest {
    return makeReq({ origin: "http://localhost:3000" });
  }

  const ALLOC_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const ALLOC_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

  function profile(id: string): Record<string, unknown> {
    return {
      id,
      display_name: `Alloc ${id.slice(0, 4)}`,
      company: "Co",
      email: `${id.slice(0, 4)}@x.test`,
      role: "allocator",
      preferences_updated_at: null,
    };
  }

  it("short-circuits to { allocators: [] } when no allocator profiles exist", async () => {
    mockAdminClient({ profiles: { data: [], error: null } });
    const { GET } = await import("./route");
    const res = await GET(okReq());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ allocators: [] });
  });

  it("sets needs_attention=true (score>=100) when candidate_count>0 AND no intro in >14 days", async () => {
    const old = new Date(Date.now() - 20 * 86_400_000).toISOString();
    mockAdminClient({
      profiles: { data: [profile(ALLOC_A)], error: null },
      // fresh batch (not stale): computed just now, has candidates.
      batches: [
        {
          id: "batch-1",
          allocator_id: ALLOC_A,
          computed_at: new Date().toISOString(),
          mode: "auto",
          candidate_count: 3,
          filter_relaxed: false,
        },
      ],
      intros: [{ allocator_id: ALLOC_A, created_at: old }],
    });
    const { GET } = await import("./route");
    const res = await GET(okReq());
    const body = await res.json();
    const a = body.allocators[0];
    expect(a.needs_attention).toBe(true);
    expect(a.triage_score).toBeGreaterThanOrEqual(100);
    expect(a.is_stale).toBe(false);
    expect(a.zero_decisions).toBe(false);
  });

  it("adds +50 when the latest batch is stale (>48h since recompute)", async () => {
    const old = new Date(Date.now() - 20 * 86_400_000).toISOString();
    const staleBatchAt = new Date(Date.now() - 72 * 3_600_000).toISOString();
    mockAdminClient({
      profiles: { data: [profile(ALLOC_A)], error: null },
      batches: [
        {
          id: "batch-1",
          allocator_id: ALLOC_A,
          computed_at: staleBatchAt,
          mode: "auto",
          candidate_count: 3,
          filter_relaxed: false,
        },
      ],
      intros: [{ allocator_id: ALLOC_A, created_at: old }],
    });
    const { GET } = await import("./route");
    const res = await GET(okReq());
    const a = (await res.json()).allocators[0];
    expect(a.is_stale).toBe(true);
    // needs_attention (100) + is_stale (50) = 150.
    expect(a.triage_score).toBe(150);
  });

  it("adds +30 when the latest batch has filter_relaxed=true", async () => {
    const recent = new Date(Date.now() - 5 * 86_400_000).toISOString();
    mockAdminClient({
      profiles: { data: [profile(ALLOC_A)], error: null },
      batches: [
        {
          id: "batch-1",
          allocator_id: ALLOC_A,
          computed_at: new Date().toISOString(),
          mode: "auto",
          candidate_count: 3,
          filter_relaxed: true,
        },
      ],
      // recent intro (<14d) so needs_attention stays false → isolate the +30.
      intros: [{ allocator_id: ALLOC_A, created_at: recent }],
    });
    const { GET } = await import("./route");
    const res = await GET(okReq());
    const a = (await res.json()).allocators[0];
    expect(a.needs_attention).toBe(false);
    expect(a.is_stale).toBe(false);
    expect(a.zero_decisions).toBe(false);
    // filter_relaxed (+30) only.
    expect(a.triage_score).toBe(30);
  });

  it("scores zero_decisions (+25) when an allocator has never received an intro", async () => {
    mockAdminClient({
      profiles: { data: [profile(ALLOC_A)], error: null },
      // no batch → needs_attention false (batch===undefined); no intro → zero_decisions.
      batches: [],
      intros: [],
    });
    const { GET } = await import("./route");
    const res = await GET(okReq());
    const a = (await res.json()).allocators[0];
    expect(a.zero_decisions).toBe(true);
    expect(a.days_since_last_intro).toBeNull();
    expect(a.triage_score).toBe(25);
  });

  it("breaks a triage_score tie by computed_at descending (more-recent batch first)", async () => {
    // Both allocators score identically (is_stale +50 + zero_decisions +25
    // = 75; candidate_count 0 → needs_attention false). The tiebreaker must
    // rank the allocator with the more-recent batch first. Both batches are
    // >48h old so both are stale; only the computed_at recency differs.
    const older = new Date(Date.now() - 10 * 86_400_000).toISOString();
    const newer = new Date(Date.now() - 3 * 86_400_000).toISOString();
    mockAdminClient({
      profiles: { data: [profile(ALLOC_A), profile(ALLOC_B)], error: null },
      batches: [
        {
          id: "batch-a",
          allocator_id: ALLOC_A,
          computed_at: older,
          mode: "auto",
          candidate_count: 0,
          filter_relaxed: false,
        },
        {
          id: "batch-b",
          allocator_id: ALLOC_B,
          computed_at: newer,
          mode: "auto",
          candidate_count: 0,
          filter_relaxed: false,
        },
      ],
      intros: [],
    });
    const { GET } = await import("./route");
    const res = await GET(okReq());
    const allocators = (await res.json()).allocators as Array<{
      id: string;
      triage_score: number;
    }>;
    // Same score (both stale+zero_decisions) → tiebreaker by recency.
    expect(allocators[0].triage_score).toBe(allocators[1].triage_score);
    expect(allocators[0].id).toBe(ALLOC_B); // newer computed_at ranks first
    expect(allocators[1].id).toBe(ALLOC_A);
  });

  it("returns 503 with the migration-011 hint when the profiles select returns PGRST205", async () => {
    mockAdminClient({
      profiles: {
        data: null,
        error: { code: "PGRST205", message: "schema cache miss" },
      },
    });
    const { GET } = await import("./route");
    const res = await GET(okReq());
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toMatch(/migration 011/i);
  });
});
