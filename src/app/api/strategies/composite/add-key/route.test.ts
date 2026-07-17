/**
 * Phase 88 / ONB-01 + ONB-03 — composite add-key route (web tier).
 *
 * This route is a structural mirror of create-with-key/route.ts: withAuth →
 * input validation → B15 limiter ordering → Railway validateKey read-only
 * enforcement → encryptKey → RPC → uniform { code } errors. The ONE divergence
 * that matters for behaviour is the RPC: it calls `add_wizard_composite_key`,
 * which lazily mints the ONE api_key_id=NULL composite draft per
 * (user, wizard_session_id) and ALWAYS inserts a fresh api_keys row — so the
 * 2nd/3rd add in one session returns the SAME strategy_id with a NEW
 * api_key_id (ONB-03). There is NO app-layer existing-draft short-circuit (the
 * composite draft carries api_key_id NULL; the single-key F6 fence idiom does
 * not apply — each add must proceed).
 *
 * These tests pin: read-only enforcement before any storage (T-88-14), ONB-03
 * per-key add, the 23505 single-key-draft-collision map, B15 limiter ordering,
 * and the credential-leak posture (T-88-13: uniform { code } bodies, no cred
 * values in logs).
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

const validateKeyMock = vi.fn();
const encryptKeyMock = vi.fn();
vi.mock("@/lib/analytics-client", () => ({
  validateKey: (...args: unknown[]) => validateKeyMock(...args),
  encryptKey: (...args: unknown[]) => encryptKeyMock(...args),
}));

const rpcMock = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  // The composite add-key route calls ONLY supabase.rpc — no app-layer
  // draft SELECT (no F6 short-circuit) and no asset_class force-derive UPDATE.
  createClient: async () => ({
    rpc: (...args: unknown[]) => rpcMock(...args),
  }),
}));

async function importPost() {
  const mod = await import("./route");
  return mod.POST;
}

const WIZARD_SESSION_ID = "11111111-2222-4333-8444-555555555555";
const STRATEGY_ID = "ssssssss-ssss-4sss-8sss-ssssssssssss";
const API_KEY_ID_1 = "k1111111-kkkk-4kkk-8kkk-kkkkkkkkkkkk";
const API_KEY_ID_2 = "k2222222-kkkk-4kkk-8kkk-kkkkkkkkkkkk";

const VALID_BODY = {
  exchange: "okx",
  api_key: "okx-key-with-enough-chars",
  api_secret: "okx-secret-with-enough-chars",
  passphrase: "okx-passphrase",
  label: "composite key 1",
  wizard_session_id: WIZARD_SESSION_ID,
};

function makeReq(body: unknown): NextRequest {
  return new NextRequest(
    "http://localhost/api/strategies/composite/add-key",
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
  validateKeyMock.mockReset();
  encryptKeyMock.mockReset();
  rpcMock.mockReset();
  checkLimitMock.mockReset();
  checkLimitMock.mockResolvedValue({ success: true });
  validateKeyMock.mockResolvedValue({
    valid: true,
    read_only: true,
    permissions: ["read"],
  });
  encryptKeyMock.mockResolvedValue({
    api_key_encrypted: "encrypted-blob-base64",
    api_secret_encrypted: null,
    passphrase_encrypted: null,
    dek_encrypted: null,
    nonce: null,
    kek_version: 1,
  });
  rpcMock.mockResolvedValue({
    data: [{ strategy_id: STRATEGY_ID, api_key_id: API_KEY_ID_1 }],
    error: null,
  });
}

describe("POST /api/strategies/composite/add-key — read-only enforcement (T-88-14)", () => {
  beforeEach(resetHappyMocks);

  it("rejects a trading-scope key with 400 KEY_HAS_TRADING_PERMS before encrypt/RPC", async () => {
    validateKeyMock.mockResolvedValue({
      valid: true,
      read_only: false,
      permissions: ["read", "trade"],
    });

    const POST = await importPost();
    const res = await POST(makeReq(VALID_BODY));

    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("KEY_HAS_TRADING_PERMS");
    expect(encryptKeyMock).not.toHaveBeenCalled();
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("rejects a withdraw-scope key with 400 KEY_HAS_WITHDRAW_PERMS (withdraw wins)", async () => {
    validateKeyMock.mockResolvedValue({
      valid: true,
      read_only: false,
      permissions: ["read", "trade", "withdraw"],
    });

    const POST = await importPost();
    const res = await POST(makeReq(VALID_BODY));

    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("KEY_HAS_WITHDRAW_PERMS");
    expect(encryptKeyMock).not.toHaveBeenCalled();
    expect(rpcMock).not.toHaveBeenCalled();
  });

  // FIX 3 (Phase 110.1 / DOGFOOD-3) — class-closure on the composite sibling.
  // A bare read_only:false (the real /api/validate-key shape, which never
  // returns `permissions`) must not assert an unobserved trade scope.
  it("regression (FIX 3): bare read_only:false with NO permissions → KEY_NOT_READ_ONLY, not KEY_HAS_TRADING_PERMS", async () => {
    validateKeyMock.mockResolvedValue({
      valid: true,
      read_only: false,
      // permissions omitted — the real routers/exchange.py shape.
    });

    const POST = await importPost();
    const res = await POST(makeReq(VALID_BODY));

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.code).toBe("KEY_NOT_READ_ONLY");
    expect(json.code).not.toBe("KEY_HAS_TRADING_PERMS");
    expect(encryptKeyMock).not.toHaveBeenCalled();
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("regression (FIX 3 facet b): a 'could not verify permission scopes' probe failure → retryable 5xx + KEY_PROBE_FAILED, not 500/UNKNOWN", async () => {
    const consoleErr = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    validateKeyMock.mockRejectedValue(
      new Error("Could not verify the key's permission scopes"),
    );

    const POST = await importPost();
    const res = await POST(makeReq(VALID_BODY));

    expect(res.status).toBeGreaterThanOrEqual(502);
    expect(res.status).toBeLessThan(504);
    expect(res.status).not.toBe(500);
    const json = await res.json();
    expect(json.code).toBe("KEY_PROBE_FAILED");
    expect(json.code).not.toBe("UNKNOWN");
    expect(encryptKeyMock).not.toHaveBeenCalled();
    expect(rpcMock).not.toHaveBeenCalled();
    consoleErr.mockRestore();
  });

  it("accepts a read-only key: encrypts then calls add_wizard_composite_key", async () => {
    const POST = await importPost();
    const res = await POST(makeReq(VALID_BODY));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      strategy_id: STRATEGY_ID,
      api_key_id: API_KEY_ID_1,
    });
    expect(encryptKeyMock).toHaveBeenCalledTimes(1);
    expect(rpcMock).toHaveBeenCalledTimes(1);
    const [rpcName, rpcArgs] = rpcMock.mock.calls[0];
    expect(rpcName).toBe("add_wizard_composite_key");
    const args = rpcArgs as Record<string, unknown>;
    expect(args.p_user_id).toBe(MOCK_USER.id);
    expect(args.p_wizard_session_id).toBe(WIZARD_SESSION_ID);
    expect(args.p_api_key_encrypted).toBe("encrypted-blob-base64");
    expect(args.p_api_secret_encrypted).toBeNull();
  });
});

describe("POST /api/strategies/composite/add-key — ONB-03 per-key add", () => {
  beforeEach(resetHappyMocks);

  it("2nd add same session returns SAME strategy_id with a NEW api_key_id", async () => {
    rpcMock.mockReset();
    rpcMock
      .mockResolvedValueOnce({
        data: [{ strategy_id: STRATEGY_ID, api_key_id: API_KEY_ID_1 }],
        error: null,
      })
      .mockResolvedValueOnce({
        data: [{ strategy_id: STRATEGY_ID, api_key_id: API_KEY_ID_2 }],
        error: null,
      });

    const POST = await importPost();
    const res1 = await POST(makeReq(VALID_BODY));
    const res2 = await POST(
      makeReq({ ...VALID_BODY, label: "composite key 2" }),
    );

    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);
    const j1 = await res1.json();
    const j2 = await res2.json();
    // Same composite draft…
    expect(j1.strategy_id).toBe(STRATEGY_ID);
    expect(j2.strategy_id).toBe(STRATEGY_ID);
    // …but a distinct key each add proceeds (ONB-03 — no short-circuit).
    expect(j1.api_key_id).toBe(API_KEY_ID_1);
    expect(j2.api_key_id).toBe(API_KEY_ID_2);
    expect(j1.api_key_id).not.toBe(j2.api_key_id);
    expect(rpcMock).toHaveBeenCalledTimes(2);
  });

  it("maps a 23505 (session already holds a single-key draft) to 409 DRAFT_ALREADY_EXISTS", async () => {
    const consoleErr = vi.spyOn(console, "error").mockImplementation(() => {});
    rpcMock.mockResolvedValue({
      data: null,
      error: { code: "23505", message: "unique_violation" },
    });

    const POST = await importPost();
    const res = await POST(makeReq(VALID_BODY));

    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("DRAFT_ALREADY_EXISTS");
    consoleErr.mockRestore();
  });
});

describe("POST /api/strategies/composite/add-key — B15 limiter ordering", () => {
  beforeEach(resetHappyMocks);

  it("a malformed body 400s WITHOUT consuming a rate-limit token", async () => {
    const POST = await importPost();
    const res = await POST(makeReq({ exchange: "not-an-exchange" }));

    expect(res.status).toBe(400);
    expect(checkLimitMock).not.toHaveBeenCalled();
  });

  it("a valid body against an exhausted limiter 429s with a route-distinct key", async () => {
    checkLimitMock.mockResolvedValue({ success: false, retryAfter: 42 });

    const POST = await importPost();
    const res = await POST(makeReq(VALID_BODY));

    expect(res.status).toBe(429);
    expect((await res.json()).code).toBe("KEY_RATE_LIMIT");
    // Route-distinct limiter key so composite adds don't share the single-key
    // bucket.
    const [, limiterKey] = checkLimitMock.mock.calls[0];
    expect(limiterKey).toContain("composite-add-key");
    expect(limiterKey).toContain(MOCK_USER.id);
    // Rate-limited before any Railway spend.
    expect(validateKeyMock).not.toHaveBeenCalled();
    expect(encryptKeyMock).not.toHaveBeenCalled();
    expect(rpcMock).not.toHaveBeenCalled();
  });
});

describe("POST /api/strategies/composite/add-key — credential posture (T-88-13)", () => {
  beforeEach(resetHappyMocks);

  it("on upstream failure returns a uniform { code } body and never logs credential values", async () => {
    const consoleErr = vi.spyOn(console, "error").mockImplementation(() => {});
    validateKeyMock.mockRejectedValue(
      new Error("upstream ETIMEDOUT after 15000ms"),
    );

    const POST = await importPost();
    const res = await POST(makeReq(VALID_BODY));

    expect(res.status).toBe(502);
    const json = await res.json();
    // Uniform body — only { code }, no raw upstream string, no echoed creds.
    expect(json.code).toBe("KEY_NETWORK_TIMEOUT");
    expect(json.error).toBeUndefined();
    expect(json.api_key).toBeUndefined();
    expect(json.api_secret).toBeUndefined();

    // No console.error argument may carry a credential value.
    const logged = consoleErr.mock.calls.flat().map(String).join("\n");
    expect(logged).not.toContain(VALID_BODY.api_key);
    expect(logged).not.toContain(VALID_BODY.api_secret);
    expect(logged).not.toContain(VALID_BODY.passphrase);
    consoleErr.mockRestore();
  });
});
