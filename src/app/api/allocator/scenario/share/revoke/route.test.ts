/**
 * Phase 25 / Plan 03 / SHARE-03 — TDD tests for POST
 * /api/allocator/scenario/share/revoke.
 *
 * Revoke the active share for a scenario by setting revoked_at = now() (never
 * DELETE — the audit trail is preserved, CONTEXT Area 1). Owner-scoped via RLS;
 * a non-owned scenario or no active share → 404 (T-23-10: NOT 403, no existence
 * oracle). Mirrors saved/[id]/route.ts (uuid-validate-first → 400).
 *
 *   T_RV1  No auth (withAllocatorAuth gate)                         → 401
 *   T_RV2  Malformed scenario_id                                    → 400 first
 *   T_RV3  Rate-limit denied                                        → 429 + Retry-After
 *   T_RV4  Rate-limit misconfigured                                 → 503 + Retry-After
 *   T_RV5  Active owned share → sets revoked_at (UPDATE), returns 200
 *   T_RV6  0 rows (non-owned / no active share) → 404 (NOT 403)
 *   T_RV7  DB error → redacted stable message (NOT raw error.message) → 500
 *   T_RV8  NO_STORE_HEADERS on success AND error responses
 *   T_RV9  Never DELETE — the update sets revoked_at, never .delete()
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("server-only", () => ({}));

const MOCK_USER = { id: "alloc-A" } as unknown as import("@supabase/supabase-js").User;
let authShouldFail = false;

vi.mock("@/lib/api/withAllocatorAuth", () => ({
  withAllocatorAuth:
    (h: (req: NextRequest, user: typeof MOCK_USER) => unknown) => (req: NextRequest) => {
      if (authShouldFail) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { "content-type": "application/json", "Cache-Control": "private, no-store" },
        });
      }
      return h(req, MOCK_USER);
    },
}));

// ---------------------------------------------------------------------------
// Mock supabase server client — the revoke is a single chained UPDATE:
//   .from("scenario_shares").update(p).eq("scenario_id", id).is("revoked_at", null)
//     .select("id")  → { data, error }
// We resolve { data, error } at the terminal of the chain and capture the
// update payload + the .eq/.is scoping so the assertions can inspect them.
// ---------------------------------------------------------------------------

type DbResult = { data: unknown; error: { code?: string; message: string } | null };
let updateResult: DbResult = { data: [{ id: "share-1" }], error: null };
let lastUpdatePayload: Record<string, unknown> | null = null;
const eqSpy = vi.fn();
const isSpy = vi.fn();
const deleteSpy = vi.fn();

function buildChain() {
  return {
    update(payload: Record<string, unknown>) {
      lastUpdatePayload = payload;
      return {
        eq: (col: string, val: unknown) => {
          eqSpy(col, val);
          return {
            is: (col2: string, val2: unknown) => {
              isSpy(col2, val2);
              return {
                select: () => Promise.resolve(updateResult),
              };
            },
          };
        },
      };
    },
    // Present only so a (mistaken) .delete() would be observable in a test.
    delete() {
      deleteSpy();
      return {
        eq: () => ({ is: () => ({ select: () => Promise.resolve(updateResult) }) }),
      };
    },
  };
}

const fromSpy = vi.fn(() => buildChain());
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ from: fromSpy }),
}));

let rateLimitState: "allow" | "deny" | "misconfig" = "allow";
const checkLimitMock = vi.fn(async () => {
  if (rateLimitState === "allow") return { success: true };
  if (rateLimitState === "misconfig")
    return { success: false, retryAfter: 60, reason: "ratelimit_misconfigured" };
  return { success: false, retryAfter: 42 };
});
vi.mock("@/lib/ratelimit", () => ({
  userActionLimiter: {},
  checkLimit: (...args: unknown[]) => checkLimitMock(...(args as [])),
  isRateLimitMisconfigured: (rl: { success: boolean; reason?: string }) =>
    rl.success === false && rl.reason === "ratelimit_misconfigured",
}));

vi.mock("@/lib/sentry-capture", () => ({ captureToSentry: vi.fn() }));

const logAuditEventMock = vi.fn();
vi.mock("@/lib/audit", () => ({
  logAuditEvent: (...args: unknown[]) => logAuditEventMock(...args),
}));

import { POST } from "./route";

const SCENARIO_ID = "11111111-1111-1111-1111-111111111111";

function mkPost(body: unknown) {
  return new NextRequest(new URL("http://localhost/api/allocator/scenario/share/revoke"), {
    method: "POST",
    headers: { "content-type": "application/json", origin: "http://localhost" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  authShouldFail = false;
  rateLimitState = "allow";
  updateResult = { data: [{ id: "share-1" }], error: null };
  lastUpdatePayload = null;
});

describe("POST /api/allocator/scenario/share/revoke (Plan 25-03 SHARE-03)", () => {
  it("T_RV1 — returns 401 when the allocator gate fails", async () => {
    authShouldFail = true;
    const res = await POST(mkPost({ scenario_id: SCENARIO_ID }));
    expect(res.status).toBe(401);
  });

  it("T_RV2 — 400 on a malformed scenario_id", async () => {
    const res = await POST(mkPost({ scenario_id: "not-a-uuid" }));
    expect(res.status).toBe(400);
    const missing = await POST(mkPost({}));
    expect(missing.status).toBe(400);
  });

  it("T_RV3 — 429 + Retry-After when the rate-limit denies", async () => {
    rateLimitState = "deny";
    const res = await POST(mkPost({ scenario_id: SCENARIO_ID }));
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("42");
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
  });

  it("T_RV4 — 503 + Retry-After when the rate-limit is misconfigured", async () => {
    rateLimitState = "misconfig";
    const res = await POST(mkPost({ scenario_id: SCENARIO_ID }));
    expect(res.status).toBe(503);
    expect(res.headers.get("Retry-After")).toBe("60");
  });

  it("T_RV5 — an active owned share is revoked (UPDATE sets revoked_at), returns 200", async () => {
    const res = await POST(mkPost({ scenario_id: SCENARIO_ID }));
    expect(res.status).toBe(200);
    expect(fromSpy).toHaveBeenCalledWith("scenario_shares");
    expect(lastUpdatePayload).not.toBeNull();
    expect(lastUpdatePayload!.revoked_at).toEqual(expect.any(String));
    // Owner-scoped to the scenario + the active rows; RLS adds created_by.
    expect(eqSpy).toHaveBeenCalledWith("scenario_id", SCENARIO_ID);
    expect(isSpy).toHaveBeenCalledWith("revoked_at", null);
  });

  it("T_RV6 — 0 rows (non-owned / no active share) → 404, NOT 403 (no existence oracle)", async () => {
    updateResult = { data: [], error: null };
    const res = await POST(mkPost({ scenario_id: SCENARIO_ID }));
    expect(res.status).toBe(404);
    expect(res.status).not.toBe(403);
  });

  it("T_RV7 — a DB error returns the redacted stable message, NOT raw error.message", async () => {
    updateResult = {
      data: null,
      error: { code: "42P01", message: 'relation "scenario_shares" does not exist' },
    };
    const res = await POST(mkPost({ scenario_id: SCENARIO_ID }));
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.message).toBe("Couldn't revoke this link. Try again.");
    expect(JSON.stringify(json)).not.toContain("does not exist");
  });

  it("T_RV8 — NO_STORE_HEADERS on success AND on error", async () => {
    const ok = await POST(mkPost({ scenario_id: SCENARIO_ID }));
    expect(ok.headers.get("Cache-Control")).toBe("private, no-store");

    updateResult = { data: null, error: { message: "boom" } };
    const err = await POST(mkPost({ scenario_id: SCENARIO_ID }));
    expect(err.headers.get("Cache-Control")).toBe("private, no-store");
  });

  it("T_RV9 — never DELETE: the route sets revoked_at, never calls .delete()", async () => {
    await POST(mkPost({ scenario_id: SCENARIO_ID }));
    expect(deleteSpy).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// Static guards — audit-preserving revoke (never a hard delete) + RLS gate.
// ===========================================================================

describe("scenario/share/revoke route — static security guards", () => {
  const routeSrc = readFileSync(join(__dirname, "route.ts"), "utf8");

  it("never hard-deletes (preserves the audit trail) — no .delete( in the source", () => {
    expect(routeSrc).not.toContain(".delete(");
  });

  it("imports the user-scoped client from @/lib/supabase/server (RLS is the tenant gate)", () => {
    expect(routeSrc).toContain('from "@/lib/supabase/server"');
  });

  it("does NOT import an admin / service-role client", () => {
    expect(routeSrc).not.toContain("@/lib/supabase/admin");
    expect(routeSrc).not.toMatch(/service[_-]?role/i);
  });
});
