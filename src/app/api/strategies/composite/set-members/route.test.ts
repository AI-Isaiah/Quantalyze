/**
 * Phase 88 / ONB-03 — composite set-members route (web tier).
 *
 * The wizard "Continue" handoff: re-validate the full keys[] SERVER-SIDE with
 * the SAME keyWindowsSchema the client runs (one spec, two surfaces — no forked
 * rule set), then persist membership wholesale via set_wizard_composite_members.
 * The route NEVER trusts client validation: a crafted payload that "passed" the
 * client (overlapping windows, or a key element with no api_key_id) is rejected
 * here before the RPC (T-88-16).
 *
 * seq is derived SERVER-SIDE by the RPC from window_start order — it is
 * intentionally NOT sent in p_members (Pitfall 2: one derivation, both sides
 * agree by construction).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("server-only", () => ({}));

const MOCK_USER = { id: "00000000-0000-0000-0000-aaaaaaaaaaaa" } as unknown as
  import("@supabase/supabase-js").User;

vi.mock("@/lib/api/withAuth", () => ({
  withAuth:
    (h: (req: NextRequest, user: typeof MOCK_USER) => unknown) =>
    (req: NextRequest) =>
      h(req, MOCK_USER),
}));

const checkLimitMock = vi.fn<
  (limiter: unknown, key: string) => Promise<{
    success: boolean;
    retryAfter?: number;
  }>
>();
vi.mock("@/lib/ratelimit", () => ({
  userActionLimiter: {},
  checkLimit: (limiter: unknown, key: string) => checkLimitMock(limiter, key),
}));

const rpcMock = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    rpc: (...args: unknown[]) => rpcMock(...args),
  }),
}));

async function importPost() {
  const mod = await import("./route");
  return mod.POST;
}

const STRATEGY_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const AKID1 = "a1111111-1111-4111-8111-111111111111";
const AKID2 = "a2222222-2222-4222-8222-222222222222";
const AKID3 = "a3333333-3333-4333-8333-333333333333";

// A valid Zavara-style adjacent-handoff chain (shared boundary day = NON-overlap
// under the half-open convention). All windows are in the past (2025), so the
// future-window rule never fires.
const VALID_KEYS = [
  {
    api_key_id: AKID1,
    window_start: "2025-08-01",
    window_end: "2025-10-01",
    seq: 1,
  },
  {
    api_key_id: AKID2,
    window_start: "2025-10-01",
    window_end: "2025-12-01",
    seq: 2,
  },
  {
    api_key_id: AKID3,
    window_start: "2025-12-01",
    window_end: null,
    seq: 3,
  },
];

function makeReq(body: unknown): NextRequest {
  return new NextRequest(
    "http://localhost/api/strategies/composite/set-members",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "http://localhost:3000",
      },
      body: JSON.stringify(body),
    },
  );
}

function resetHappyMocks() {
  rpcMock.mockReset();
  checkLimitMock.mockReset();
  checkLimitMock.mockResolvedValue({ success: true });
  rpcMock.mockResolvedValue({ data: 3, error: null });
}

describe("POST /api/strategies/composite/set-members — server-side re-validation (T-88-16)", () => {
  beforeEach(resetHappyMocks);

  it("rejects overlapping windows with 400 MULTI_KEY_WINDOWS_INVALID — RPC never called", async () => {
    const overlapping = [
      {
        api_key_id: AKID1,
        window_start: "2025-08-01",
        window_end: "2025-11-01",
        seq: 1,
      },
      {
        api_key_id: AKID2,
        window_start: "2025-10-01", // starts before key 1 ends → overlap
        window_end: "2025-12-01",
        seq: 2,
      },
    ];

    const POST = await importPost();
    const res = await POST(
      makeReq({ strategy_id: STRATEGY_ID, keys: overlapping }),
    );

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.code).toBe("MULTI_KEY_WINDOWS_INVALID");
    // Uniform body — no raw zod issue details echoed.
    expect(json.issues).toBeUndefined();
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("rejects a keys[] element with no api_key_id with 400 MULTI_KEY_WINDOWS_INVALID — RPC never called", async () => {
    // keyWindowsSchema keeps api_key_id OPTIONAL (the live UI accumulates
    // windows before a key is minted). The route additionally requires it: an
    // unvalidated key must never reach the membership write.
    const missingKeyId = VALID_KEYS.map((k, i) =>
      i === 1 ? { ...k, api_key_id: undefined } : k,
    );

    const POST = await importPost();
    const res = await POST(
      makeReq({ strategy_id: STRATEGY_ID, keys: missingKeyId }),
    );

    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("MULTI_KEY_WINDOWS_INVALID");
    expect(rpcMock).not.toHaveBeenCalled();
  });
});

describe("POST /api/strategies/composite/set-members — wholesale write (ONB-03)", () => {
  beforeEach(resetHappyMocks);

  it("valid 3-key handoff → set_wizard_composite_members called once, 200 { ok, member_count }", async () => {
    const POST = await importPost();
    const res = await POST(
      makeReq({ strategy_id: STRATEGY_ID, keys: VALID_KEYS }),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, member_count: 3 });

    expect(rpcMock).toHaveBeenCalledTimes(1);
    const [rpcName, rpcArgs] = rpcMock.mock.calls[0];
    expect(rpcName).toBe("set_wizard_composite_members");
    const args = rpcArgs as Record<string, unknown>;
    expect(args.p_user_id).toBe(MOCK_USER.id);
    expect(args.p_strategy_id).toBe(STRATEGY_ID);

    const members = args.p_members as Array<Record<string, unknown>>;
    expect(members).toHaveLength(3);
    members.forEach((m) => {
      expect(m).toHaveProperty("api_key_id");
      expect(m).toHaveProperty("window_start");
      expect(m).toHaveProperty("window_end");
      // seq is derived server-side — the client never sends it (Pitfall 2).
      expect(m).not.toHaveProperty("seq");
    });
    expect(members[0].api_key_id).toBe(AKID1);
    expect(members[2].window_end).toBeNull();
  });
});

describe("POST /api/strategies/composite/set-members — RPC guard mapping (T-88-15)", () => {
  beforeEach(resetHappyMocks);

  it("maps an ownership/composite-guard RAISE to a 4xx uniform { code } without echoing the message", async () => {
    const consoleErr = vi.spyOn(console, "error").mockImplementation(() => {});
    const RAW_MSG = "set_wizard_composite_members: no composite draft for the caller";
    rpcMock.mockResolvedValue({
      data: null,
      error: { code: "42501", message: RAW_MSG },
    });

    const POST = await importPost();
    const res = await POST(
      makeReq({ strategy_id: STRATEGY_ID, keys: VALID_KEYS }),
    );

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    const json = await res.json();
    expect(typeof json.code).toBe("string");
    // The raw RPC message must never reach the client (H-0305).
    expect(JSON.stringify(json)).not.toContain(RAW_MSG);
    consoleErr.mockRestore();
  });
});

describe("POST /api/strategies/composite/set-members — B15 limiter ordering", () => {
  beforeEach(resetHappyMocks);

  it("a malformed body 400s WITHOUT consuming a rate-limit token", async () => {
    const POST = await importPost();
    const res = await POST(makeReq({ strategy_id: "not-a-uuid" }));

    expect(res.status).toBe(400);
    expect(checkLimitMock).not.toHaveBeenCalled();
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("a valid body against an exhausted limiter 429s with a route-distinct key", async () => {
    checkLimitMock.mockResolvedValue({ success: false, retryAfter: 42 });

    const POST = await importPost();
    const res = await POST(
      makeReq({ strategy_id: STRATEGY_ID, keys: VALID_KEYS }),
    );

    expect(res.status).toBe(429);
    const [, limiterKey] = checkLimitMock.mock.calls[0];
    expect(limiterKey).toContain("composite-set-members");
    expect(limiterKey).toContain(MOCK_USER.id);
    expect(rpcMock).not.toHaveBeenCalled();
  });
});
