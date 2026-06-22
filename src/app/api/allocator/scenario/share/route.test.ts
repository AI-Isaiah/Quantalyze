/**
 * Phase 25 / Plan 03 / SHARE-01 — TDD tests for POST /api/allocator/scenario/share.
 *
 * Generate a revocable read-only share link for a saved scenario. The route
 * mirrors scenario/saved/route.ts (withAllocatorAuth, B15 limiter ordering,
 * redacted envelope, NO_STORE_HEADERS) and adds the share-specific invariants:
 *
 *   T_SH1  No auth (withAllocatorAuth gate)                                 → 401
 *   T_SH2  Invalid body (missing / malformed scenario_id)                   → 400, limiter NOT called, no token minted
 *   T_SH3  Rate-limit denied                                               → 429 + Retry-After + Cache-Control
 *   T_SH4  Rate-limit misconfigured                                        → 503 + Retry-After + Cache-Control
 *   T_SH5  Success → 200, returns { url } built from NEXT_PUBLIC_APP_URL
 *   T_SH6  HASH-NOT-RAW: the insert payload's token_hash === hashShareToken(raw),
 *          and the raw token NEVER appears in the persisted payload
 *   T_SH7  created_by sourced from auth (user.id), NEVER from the body
 *   T_SH8  Pre-revoke: any prior active share for the scenario is revoked
 *          (update revoked_at where revoked_at IS NULL) BEFORE the insert
 *   T_SH9  DB error → redacted stable message (NOT raw error.message)       → 500
 *   T_SH10 NO_STORE_HEADERS on success AND error responses
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

import { hashShareToken } from "@/lib/scenario-share-token";

// `import "server-only"` (transitive via withAllocatorAuth) throws in jsdom.
vi.mock("server-only", () => ({}));

// ---------------------------------------------------------------------------
// Mock withAllocatorAuth — toggleable for the 401 path. The real wrapper drops
// the route ctx and only forwards (req, user); mirror that here.
// ---------------------------------------------------------------------------

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
// Mock supabase server client — a chainable query builder.
//   pre-revoke: .from("scenario_shares").update(p).eq("scenario_id",x).is("revoked_at",null)  → { error }
//   insert:     .from("scenario_shares").insert(p).select("id").single()                      → { data, error }
// The update + insert payloads are captured so the pre-revoke + hash-not-raw +
// created_by-from-auth assertions can inspect them.
// ---------------------------------------------------------------------------

type DbResult = { data: unknown; error: { code?: string; message: string } | null };
let insertResult: DbResult = { data: { id: "share-1" }, error: null };
let preRevokeError: { message: string } | null = null;
let lastInsertPayload: Record<string, unknown> | null = null;
let lastUpdatePayload: Record<string, unknown> | null = null;
const preRevokeEqSpy = vi.fn();
const preRevokeIsSpy = vi.fn();

function buildChain() {
  return {
    // Pre-revoke path: update(payload).eq("scenario_id", id).is("revoked_at", null)
    update(payload: Record<string, unknown>) {
      lastUpdatePayload = payload;
      return {
        eq: (col: string, val: unknown) => {
          preRevokeEqSpy(col, val);
          return {
            is: (col2: string, val2: unknown) => {
              preRevokeIsSpy(col2, val2);
              return Promise.resolve({ error: preRevokeError });
            },
          };
        },
      };
    },
    // Insert path: insert(payload).select("id").single()
    insert(payload: Record<string, unknown>) {
      lastInsertPayload = payload;
      return {
        select: () => ({
          single: async () => insertResult,
        }),
      };
    },
  };
}

const fromSpy = vi.fn(() => buildChain());
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ from: fromSpy }),
}));

// ---------------------------------------------------------------------------
// Mock rate limiter — toggleable so a deny / misconfig can be forced, and the
// call count is assertable (a 400 must NOT consume a token).
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Imports after mocks
// ---------------------------------------------------------------------------

import { POST } from "./route";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SCENARIO_ID = "11111111-1111-1111-1111-111111111111";

function mkPost(body: unknown) {
  return new NextRequest(new URL("http://localhost/api/allocator/scenario/share"), {
    method: "POST",
    headers: { "content-type": "application/json", origin: "http://localhost" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  authShouldFail = false;
  rateLimitState = "allow";
  insertResult = { data: { id: "share-1" }, error: null };
  preRevokeError = null;
  lastInsertPayload = null;
  lastUpdatePayload = null;
  process.env.NEXT_PUBLIC_APP_URL = "https://share.example.com";
});

describe("POST /api/allocator/scenario/share (Plan 25-03 SHARE-01)", () => {
  it("T_SH1 — returns 401 when the allocator gate fails", async () => {
    authShouldFail = true;
    const res = await POST(mkPost({ scenario_id: SCENARIO_ID }));
    expect(res.status).toBe(401);
  });

  it("T_SH2 — 400 on a missing / malformed scenario_id; no token minted, limiter not called", async () => {
    const missing = await POST(mkPost({}));
    expect(missing.status).toBe(400);

    const malformed = await POST(mkPost({ scenario_id: "not-a-uuid" }));
    expect(malformed.status).toBe(400);

    // A 400 must NOT burn a rate-limit token (B15 ordering) nor touch the DB.
    expect(checkLimitMock).not.toHaveBeenCalled();
    expect(fromSpy).not.toHaveBeenCalled();
  });

  it("T_SH3 — 429 + Retry-After + Cache-Control when the rate-limit denies", async () => {
    rateLimitState = "deny";
    const res = await POST(mkPost({ scenario_id: SCENARIO_ID }));
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("42");
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
  });

  it("T_SH4 — 503 + Retry-After when the rate-limit is misconfigured", async () => {
    rateLimitState = "misconfig";
    const res = await POST(mkPost({ scenario_id: SCENARIO_ID }));
    expect(res.status).toBe(503);
    expect(res.headers.get("Retry-After")).toBe("60");
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
  });

  it("T_SH5 — 200 success returns a { url } built from NEXT_PUBLIC_APP_URL", async () => {
    const res = await POST(mkPost({ scenario_id: SCENARIO_ID }));
    expect(res.status).toBe(200);
    const json = (await res.json()) as { url: string };
    expect(json.url).toMatch(/^https:\/\/share\.example\.com\/scenario-share\/.+/);
    expect(fromSpy).toHaveBeenCalledWith("scenario_shares");
    expect(checkLimitMock).toHaveBeenCalledTimes(1);
  });

  it("T_SH6 — HASH-NOT-RAW: token_hash is hashShareToken(raw), the raw token is never persisted", async () => {
    const res = await POST(mkPost({ scenario_id: SCENARIO_ID }));
    const json = (await res.json()) as { url: string };
    // Pull the raw token back out of the returned URL.
    const raw = json.url.split("/scenario-share/")[1];
    expect(raw).toBeTruthy();

    expect(lastInsertPayload).not.toBeNull();
    // The persisted value is the HASH of the raw token, never the raw token.
    expect(lastInsertPayload!.token_hash).toBe(hashShareToken(raw));
    expect(lastInsertPayload!.token_hash).not.toBe(raw);
    // No key in the persisted payload carries the raw token.
    expect(JSON.stringify(lastInsertPayload)).not.toContain(raw);
  });

  it("T_SH7 — created_by is sourced from auth (user.id), NEVER from the body", async () => {
    const res = await POST(
      mkPost({ scenario_id: SCENARIO_ID, created_by: "alloc-OTHER" }),
    );
    expect(res.status).toBe(200);
    expect(lastInsertPayload).not.toBeNull();
    expect(lastInsertPayload!.created_by).toBe("alloc-A");
    expect(lastInsertPayload!.created_by).not.toBe("alloc-OTHER");
    expect(lastInsertPayload!.scenario_id).toBe(SCENARIO_ID);
  });

  it("T_SH8 — pre-revokes any prior active share for the scenario BEFORE inserting", async () => {
    const res = await POST(mkPost({ scenario_id: SCENARIO_ID }));
    expect(res.status).toBe(200);
    // Pre-revoke is an UPDATE setting revoked_at, scoped to the scenario_id and
    // the active (revoked_at IS NULL) rows.
    expect(lastUpdatePayload).not.toBeNull();
    expect(lastUpdatePayload!.revoked_at).toEqual(expect.any(String));
    expect(preRevokeEqSpy).toHaveBeenCalledWith("scenario_id", SCENARIO_ID);
    expect(preRevokeIsSpy).toHaveBeenCalledWith("revoked_at", null);
  });

  it("T_SH9 — a DB insert error returns the redacted stable message, NOT raw error.message", async () => {
    insertResult = {
      data: null,
      error: { code: "23505", message: 'duplicate key value violates "scenario_shares_one_active"' },
    };
    const res = await POST(mkPost({ scenario_id: SCENARIO_ID }));
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.message).toBe("Couldn't create a share link. Try again.");
    expect(JSON.stringify(json)).not.toContain("scenario_shares_one_active");
  });

  it("T_SH10 — NO_STORE_HEADERS on success AND on error", async () => {
    const ok = await POST(mkPost({ scenario_id: SCENARIO_ID }));
    expect(ok.headers.get("Cache-Control")).toBe("private, no-store");

    insertResult = { data: null, error: { message: "boom" } };
    const err = await POST(mkPost({ scenario_id: SCENARIO_ID }));
    expect(err.headers.get("Cache-Control")).toBe("private, no-store");
  });
});

// ===========================================================================
// Static guards — the generate route mirrors the saved-route security posture.
// ===========================================================================

describe("scenario/share generate route — static security guards", () => {
  const routeSrc = readFileSync(join(__dirname, "route.ts"), "utf8");

  it("mints the token via mintShareToken (never an ad-hoc token)", () => {
    expect(routeSrc).toContain("mintShareToken");
  });

  it("imports the user-scoped client from @/lib/supabase/server (RLS is the tenant gate)", () => {
    expect(routeSrc).toContain('from "@/lib/supabase/server"');
  });

  it("does NOT import an admin / service-role client (owner writes stay on RLS)", () => {
    expect(routeSrc).not.toContain("@/lib/supabase/admin");
    expect(routeSrc).not.toMatch(/service[_-]?role/i);
    expect(routeSrc).not.toContain("createServiceClient");
  });
});
