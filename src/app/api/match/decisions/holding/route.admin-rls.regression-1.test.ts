import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// `import "server-only"` (transitive via @/lib/analytics/onboarding-funnel)
// throws in jsdom — stub it so route imports resolve under test.
vi.mock("server-only", () => ({}));

// Phase 11 / Plan 03 — onboarding marker stamp is non-blocking analytics.
vi.mock("@/lib/analytics/onboarding-funnel", () => ({
  stampOutcomeMarker: vi.fn(async () => undefined),
}));

/**
 * Regression: UAT-02 (Phase 09) — POST /api/match/decisions/holding must use
 * the admin client (service role) for the match_decisions INSERT.
 *
 * What broke: Plan 09-03's route.ts used the authed `supabase` client for the
 * insert. Migration 011 only grants service-role INSERT on match_decisions —
 * authed allocators cannot insert even their own rows. In production, clicking
 * "Allocated" on a flagged holding returned 500 "failed to record decision"
 * with Postgres 42501 row-level-security-policy violation.
 *
 * This test seeds the authed supabase mock WITHOUT a match_decisions insert
 * handler. If the route regresses back to supabase.from('match_decisions'),
 * it will throw because .insert is not a function on the default {} fallback
 * returned by the mock. The admin mock holds the only working insert surface.
 *
 * Found by /qa browser testing on 2026-04-21 — clicking Allocated from
 * ScenarioFlaggedHoldingsList against live demo allocator.
 */

const MOCK_USER = { id: "alloc-1" } as unknown as import("@supabase/supabase-js").User;

vi.mock("@/lib/api/withAuth", () => ({
  withAuth:
    (h: (req: NextRequest, user: typeof MOCK_USER) => unknown) =>
    (req: NextRequest) =>
      h(req, MOCK_USER),
}));

const authedFromSpy = vi.fn();
const adminFromSpy = vi.fn();
const adminInsertSpy = vi.fn();

// Authed supabase: only the read gates work; match_decisions path intentionally absent.
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: (table: string) => {
      authedFromSpy(table);
      if (table === "allocator_holdings") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                eq: () => ({
                  eq: () => ({
                    limit: () => ({
                      maybeSingle: async () => ({
                        data: { id: "h-1" },
                        error: null,
                      }),
                    }),
                  }),
                }),
              }),
            }),
          }),
        };
      }
      if (table === "strategies") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: { id: "s-1" },
                  error: null,
                }),
              }),
            }),
          }),
        };
      }
      // CRITICAL: no match_decisions handler — if route regresses to authed
      // client the test explodes, catching the RLS regression at CI time.
      return {};
    },
  }),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      adminFromSpy(table);
      if (table === "match_decisions") {
        return {
          insert: (row: unknown) => {
            adminInsertSpy(row);
            return {
              select: () => ({
                single: async () => ({
                  data: { id: "new-dec-uuid" },
                  error: null,
                }),
              }),
            };
          },
        };
      }
      return {};
    },
  }),
}));

vi.mock("@/lib/audit", () => ({
  logAuditEvent: vi.fn(),
  logAuditEventAsUser: vi.fn(),
}));

import { POST } from "./route";

function mkReq(body: unknown) {
  return new NextRequest(
    new URL("http://localhost/api/match/decisions/holding"),
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}

describe("POST /api/match/decisions/holding — admin-client insert regression", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("UAT-02 regression: match_decisions INSERT uses admin client, not authed supabase", async () => {
    const res = await POST(
      mkReq({
        holding_ref: "holding:okx:BTC:spot",
        top_candidate_strategy_id: "11111111-2222-4333-8444-555555555555",
      }),
    );
    const body = await res.json();
    expect(res.status).toBe(201);
    expect(body).toEqual({ match_decision_id: "new-dec-uuid" });

    // Admin client handled the insert.
    expect(adminFromSpy).toHaveBeenCalledWith("match_decisions");
    expect(adminInsertSpy).toHaveBeenCalledTimes(1);

    // Authed client was used ONLY for ownership + strategy gates — never
    // for match_decisions. If the route regresses back to supabase.from(),
    // the authed mock returns {} and .insert would be undefined — throwing
    // synchronously before the admin insert ever runs.
    expect(authedFromSpy).toHaveBeenCalledWith("allocator_holdings");
    expect(authedFromSpy).toHaveBeenCalledWith("strategies");
    expect(authedFromSpy).not.toHaveBeenCalledWith("match_decisions");
  });
});
