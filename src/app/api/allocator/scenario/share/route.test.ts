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
 *   T_SH6  HASH-NOT-RAW: the create RPC's p_token_hash === hashShareToken(raw),
 *          and the raw token NEVER appears in the persisted payload
 *   T_SH7  created_by sourced from auth — never the body (the atomic RPC sets it
 *          from auth.uid() inside its body; the route passes only id + hash)
 *   T_SH8  ATOMIC revoke+mint (WR-02): generate goes through the
 *          create_scenario_share RPC (one transaction), NOT a separate
 *          pre-revoke UPDATE + INSERT
 *   T_SH9  DB error → redacted stable message (NOT raw error.message)       → 500
 *   T_SH10 NO_STORE_HEADERS on success AND error responses
 *   T_SH11 CR-01 OWNERSHIP: a scenario the caller does NOT own (ownership probe
 *          returns 0 rows) → 404, and NO share RPC is invoked (no link minted)
 *   T_SH12 CR-01: ownership probe runs against `scenarios` scoped by id BEFORE
 *          the create RPC (RLS is the tenant gate; the probe gives the 404)
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
// Mock supabase server client — a chainable query builder + an rpc() shim.
//   ownership probe: .from("scenarios").select("id").eq("id",x).maybeSingle()  → { data, error }
//   atomic mint:     .rpc("create_scenario_share", { p_scenario_id, p_token_hash }) → { data, error }
// The probe filter + the RPC args are captured so the CR-01 ownership +
// hash-not-raw + atomic-mint assertions can inspect them. There is NO separate
// pre-revoke UPDATE / INSERT any more (WR-02 folded both into the RPC).
// ---------------------------------------------------------------------------

type DbResult = { data: unknown; error: { code?: string; message: string } | null };
// Ownership probe default: the caller OWNS the scenario (one row).
let ownershipResult: DbResult = { data: { id: "scen-1" }, error: null };
// Atomic create RPC default: returns the new share row id.
let createShareResult: DbResult = { data: "share-1", error: null };
let lastRpcArgs: Record<string, unknown> | null = null;
let lastProbeEq: { col: string; val: unknown } | null = null;
const probeFromSpy = vi.fn();
const rpcSpy = vi.fn();

function buildChain(table: string) {
  return {
    // Ownership probe path: select("id").eq("id", scenarioId).maybeSingle()
    select() {
      return {
        eq: (col: string, val: unknown) => {
          lastProbeEq = { col, val };
          return {
            maybeSingle: async () => ownershipResult,
          };
        },
      };
    },
    // No insert/update on the share path any more — the RPC owns the writes.
    // A stray .insert/.update would throw here (catching a regression).
    insert() {
      throw new Error(`unexpected insert on ${table} — generate must use the atomic RPC`);
    },
    update() {
      throw new Error(`unexpected update on ${table} — generate must use the atomic RPC`);
    },
  };
}

const fromSpy = vi.fn((table: string) => {
  probeFromSpy(table);
  return buildChain(table);
});
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: fromSpy,
    rpc: (fn: string, args: Record<string, unknown>) => {
      rpcSpy(fn, args);
      lastRpcArgs = args;
      return Promise.resolve(createShareResult);
    },
  }),
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
  ownershipResult = { data: { id: "scen-1" }, error: null };
  createShareResult = { data: "share-1", error: null };
  lastRpcArgs = null;
  lastProbeEq = null;
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
    expect(rpcSpy).not.toHaveBeenCalled();
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
    // The ownership probe ran against `scenarios`; the mint went through the RPC.
    expect(fromSpy).toHaveBeenCalledWith("scenarios");
    expect(rpcSpy).toHaveBeenCalledWith("create_scenario_share", expect.any(Object));
    expect(checkLimitMock).toHaveBeenCalledTimes(1);
  });

  it("T_SH6 — HASH-NOT-RAW: the create RPC's p_token_hash is hashShareToken(raw), the raw token is never persisted", async () => {
    const res = await POST(mkPost({ scenario_id: SCENARIO_ID }));
    const json = (await res.json()) as { url: string };
    // Pull the raw token back out of the returned URL.
    const raw = json.url.split("/scenario-share/")[1];
    expect(raw).toBeTruthy();

    expect(lastRpcArgs).not.toBeNull();
    // The persisted value is the HASH of the raw token, never the raw token.
    expect(lastRpcArgs!.p_token_hash).toBe(hashShareToken(raw));
    expect(lastRpcArgs!.p_token_hash).not.toBe(raw);
    // No RPC arg carries the raw token.
    expect(JSON.stringify(lastRpcArgs)).not.toContain(raw);
  });

  it("T_SH7 — created_by is NEVER passed from the route/body (the RPC sets it from auth.uid())", async () => {
    const res = await POST(
      mkPost({ scenario_id: SCENARIO_ID, created_by: "alloc-OTHER" }),
    );
    expect(res.status).toBe(200);
    expect(lastRpcArgs).not.toBeNull();
    // The RPC contract carries ONLY the scenario id + the token hash; created_by
    // is sourced from auth.uid() INSIDE the function body. A forged body
    // created_by can never reach the row because the route never forwards it.
    expect(lastRpcArgs).toEqual({
      p_scenario_id: SCENARIO_ID,
      p_token_hash: expect.any(String),
    });
    expect(JSON.stringify(lastRpcArgs)).not.toContain("alloc-OTHER");
    expect(JSON.stringify(lastRpcArgs)).not.toContain("created_by");
  });

  it("T_SH8 — ATOMIC (WR-02): generate goes through the create_scenario_share RPC, NOT a separate pre-revoke UPDATE + INSERT", async () => {
    const res = await POST(mkPost({ scenario_id: SCENARIO_ID }));
    expect(res.status).toBe(200);
    // The single atomic RPC owns the revoke+mint; a separate .update / .insert
    // on scenario_shares would throw in the mock chain (the partial-write window
    // the two-statement approach left is gone).
    expect(rpcSpy).toHaveBeenCalledTimes(1);
    expect(rpcSpy).toHaveBeenCalledWith(
      "create_scenario_share",
      expect.objectContaining({ p_scenario_id: SCENARIO_ID }),
    );
  });

  it("T_SH9 — a DB error from the atomic RPC returns the redacted stable message, NOT raw error.message", async () => {
    createShareResult = {
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

    createShareResult = { data: null, error: { message: "boom" } };
    const err = await POST(mkPost({ scenario_id: SCENARIO_ID }));
    expect(err.headers.get("Cache-Control")).toBe("private, no-store");
  });

  it("T_SH11 — CR-01: a scenario the caller does NOT own → 404, and NO share is minted", async () => {
    // The RLS-scoped ownership probe returns 0 rows (maybeSingle → null) for a
    // scenario the caller does not own. The route must 404 (NOT 403 — no
    // existence oracle) and must NEVER invoke the create RPC. This is the
    // cross-tenant-disclosure fix: an attacker POSTing a victim's scenario_id
    // cannot mint a working public share link.
    ownershipResult = { data: null, error: null };
    const res = await POST(mkPost({ scenario_id: SCENARIO_ID }));
    expect(res.status).toBe(404);
    // No share link was minted for the non-owned scenario.
    expect(rpcSpy).not.toHaveBeenCalled();
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
  });

  it("T_SH12 — CR-01: the ownership probe runs against `scenarios` scoped by id BEFORE the create RPC", async () => {
    await POST(mkPost({ scenario_id: SCENARIO_ID }));
    // The probe selects from `scenarios` filtered to the requested id; RLS
    // scopes it to the caller (allocator_id = auth.uid()), so a non-owned id
    // returns 0 rows. The id-scoped filter is what makes the 404 honest.
    expect(probeFromSpy).toHaveBeenCalledWith("scenarios");
    expect(lastProbeEq).toEqual({ col: "id", val: SCENARIO_ID });
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
