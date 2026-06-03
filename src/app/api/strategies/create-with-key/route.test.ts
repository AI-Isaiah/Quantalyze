/**
 * Regression test for the wizard ConnectKeyStep 502 bug.
 *
 * The Python analytics-service `/api/encrypt-key` endpoint stores all
 * credentials inside a single `api_key_encrypted` blob (envelope encryption,
 * see analytics-service/services/encryption.py:80-82) and intentionally
 * returns `api_secret_encrypted: null`. Migration 031 makes the matching
 * DB column nullable to accept this.
 *
 * The route's previous shape check `if (!api_key_encrypted ||
 * !api_secret_encrypted)` treated the intentional null as "missing" and
 * 502'd every wizard submission. This test pins the corrected check —
 * envelope-shaped responses must round-trip to a 200 with strategy_id +
 * api_key_id.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
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

vi.mock("@/lib/ratelimit", () => ({
  userActionLimiter: {},
  checkLimit: vi.fn(async () => ({ success: true })),
}));

const validateKeyMock = vi.fn();
const encryptKeyMock = vi.fn();
vi.mock("@/lib/analytics-client", () => ({
  validateKey: (...args: unknown[]) => validateKeyMock(...args),
  encryptKey: (...args: unknown[]) => encryptKeyMock(...args),
}));

const rpcMock = vi.fn();
// F6 pre-Railway idempotency fence: the route does
// `from("strategies").select(...).eq("user_id").eq("wizard_session_id").maybeSingle()`
// BEFORE validate/encrypt. Default to "no existing draft" so the existing
// happy-path tests still exercise the full Railway + RPC flow; the fence tests
// below override draftLookupMock with `mockResolvedValueOnce`.
const draftLookupMock = vi.fn(async () => ({ data: null, error: null }) as {
  data: { id: string; api_key_id: string } | null;
  error: null;
});
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    rpc: (...args: unknown[]) => rpcMock(...args),
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            maybeSingle: () => draftLookupMock(),
          }),
        }),
      }),
    }),
  }),
}));

// Pull POST after mocks so module-init reads the mocked deps.
async function importPost() {
  const mod = await import("./route");
  return mod.POST;
}

const WIZARD_SESSION_ID = "11111111-2222-4333-8444-555555555555";
const STRATEGY_ID = "ssssssss-ssss-4sss-8sss-ssssssssssss";
const API_KEY_ID = "kkkkkkkk-kkkk-4kkk-8kkk-kkkkkkkkkkkk";

const VALID_BODY = {
  exchange: "okx",
  api_key: "okx-key-with-enough-chars",
  api_secret: "okx-secret-with-enough-chars",
  passphrase: "okx-passphrase",
  label: "regression test key",
  wizard_session_id: WIZARD_SESSION_ID,
};

function makeReq(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/strategies/create-with-key", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "http://localhost:3000",
    },
    body: JSON.stringify(body),
  });
}

describe("POST /api/strategies/create-with-key — envelope-encryption shape", () => {
  beforeEach(() => {
    validateKeyMock.mockReset();
    encryptKeyMock.mockReset();
    rpcMock.mockReset();

    validateKeyMock.mockResolvedValue({
      valid: true,
      read_only: true,
      permissions: ["read"],
    });

    rpcMock.mockResolvedValue({
      data: [{ strategy_id: STRATEGY_ID, api_key_id: API_KEY_ID }],
      error: null,
    });
  });

  it("accepts api_secret_encrypted=null (envelope-encryption contract) and returns 200", async () => {
    // The Python service intentionally returns api_secret_encrypted: null
    // because all credentials are bundled inside api_key_encrypted.
    encryptKeyMock.mockResolvedValue({
      api_key_encrypted: "encrypted-blob-base64",
      api_secret_encrypted: null,
      passphrase_encrypted: null,
      dek_encrypted: null,
      nonce: null,
      kek_version: 1,
    });

    const POST = await importPost();
    const res = await POST(makeReq(VALID_BODY));

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({
      ok: true,
      strategy_id: STRATEGY_ID,
      api_key_id: API_KEY_ID,
    });
    expect(rpcMock).toHaveBeenCalledTimes(1);
    const [rpcName, rpcArgs] = rpcMock.mock.calls[0];
    expect(rpcName).toBe("create_wizard_strategy");
    expect((rpcArgs as Record<string, unknown>).p_api_key_encrypted).toBe(
      "encrypted-blob-base64",
    );
    expect((rpcArgs as Record<string, unknown>).p_api_secret_encrypted).toBeNull();
  });

  it("still 502s when api_key_encrypted itself is missing", async () => {
    encryptKeyMock.mockResolvedValue({
      api_key_encrypted: undefined,
      api_secret_encrypted: null,
      kek_version: 1,
    });

    const POST = await importPost();
    const res = await POST(makeReq(VALID_BODY));

    expect(res.status).toBe(502);
    const json = await res.json();
    expect(json.code).toBe("UNKNOWN");
    // H-0305 consistency: error bodies are uniform { code } only — no raw
    // message leaks into the response (detail is in the server log instead).
    expect(json.error).toBeUndefined();
  });
});

/**
 * P467 — scope-rejection coverage. The route MUST reject any key whose
 * scopes broaden beyond read-only. Pre-fix this code path had ZERO test
 * coverage; a regression that silently widened the accepted scopes would
 * promote a trading-capable key into a draft strategy without ever
 * failing CI. These tests pin:
 *
 *   (a) trading=true alone           → 400 + KEY_HAS_TRADING_PERMS
 *   (b) withdraw=true alone          → 400 + KEY_HAS_WITHDRAW_PERMS
 *   (c) both trading + withdraw=true → 400, withdraw classification wins
 *   (d) read_only=true (happy)       → 200 (envelope round-trip)
 *   (e) validateKey throws (network) → 502 + KEY_NETWORK_TIMEOUT
 *
 * (e) reflects the route's actual error-classification block: a thrown
 * error is caught and bucketed into a wizardErrors code, then mapped to
 * an HTTP status by fault class (H-0310). Upstream failures return 5xx
 * because the caller's request was well-formed — the exchange/upstream
 * is what failed: KEY_NETWORK_TIMEOUT and KEY_IP_ALLOWLIST → 502,
 * KEY_RATE_LIMIT → 503. Genuine client faults (e.g. KEY_INVALID_SIGNATURE)
 * stay 400.
 */
describe("POST /api/strategies/create-with-key — P467 scope-rejection paths", () => {
  beforeEach(() => {
    validateKeyMock.mockReset();
    encryptKeyMock.mockReset();
    rpcMock.mockReset();

    // Encryption + RPC stay valid; only validateKey shape varies per test.
    encryptKeyMock.mockResolvedValue({
      api_key_encrypted: "encrypted-blob-base64",
      api_secret_encrypted: null,
      passphrase_encrypted: null,
      dek_encrypted: null,
      nonce: null,
      kek_version: 1,
    });
    rpcMock.mockResolvedValue({
      data: [{ strategy_id: STRATEGY_ID, api_key_id: API_KEY_ID }],
      error: null,
    });
  });

  it("(a) rejects a key with trading scope (read_only=false, permissions=['read','trade'])", async () => {
    validateKeyMock.mockResolvedValue({
      valid: true,
      read_only: false,
      permissions: ["read", "trade"],
    });

    const POST = await importPost();
    const res = await POST(makeReq(VALID_BODY));

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.code).toBe("KEY_HAS_TRADING_PERMS");
    // Critical: the broadened key must NEVER reach the RPC.
    expect(rpcMock).not.toHaveBeenCalled();
    // Critical: the broadened key must NEVER be encrypted to disk.
    expect(encryptKeyMock).not.toHaveBeenCalled();
  });

  it("(b) rejects a key with withdraw scope (read_only=false, permissions=['read','withdraw'])", async () => {
    validateKeyMock.mockResolvedValue({
      valid: true,
      read_only: false,
      permissions: ["read", "withdraw"],
    });

    const POST = await importPost();
    const res = await POST(makeReq(VALID_BODY));

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.code).toBe("KEY_HAS_WITHDRAW_PERMS");
    expect(rpcMock).not.toHaveBeenCalled();
    expect(encryptKeyMock).not.toHaveBeenCalled();
  });

  it("(c) rejects a key with BOTH trading and withdraw scopes — withdraw classification wins", async () => {
    // Route logic: includes("withdraw") is checked first; combined-scope
    // keys must surface as KEY_HAS_WITHDRAW_PERMS so the wizard's re-key
    // copy advertises the worst-case scope.
    validateKeyMock.mockResolvedValue({
      valid: true,
      read_only: false,
      permissions: ["read", "trade", "withdraw"],
    });

    const POST = await importPost();
    const res = await POST(makeReq(VALID_BODY));

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.code).toBe("KEY_HAS_WITHDRAW_PERMS");
    expect(rpcMock).not.toHaveBeenCalled();
    expect(encryptKeyMock).not.toHaveBeenCalled();
  });

  it("(d) accepts a read-only key (read_only=true) and returns 200", async () => {
    validateKeyMock.mockResolvedValue({
      valid: true,
      read_only: true,
      permissions: ["read"],
    });

    const POST = await importPost();
    const res = await POST(makeReq(VALID_BODY));

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({
      ok: true,
      strategy_id: STRATEGY_ID,
      api_key_id: API_KEY_ID,
    });
    // Only AFTER read-only is confirmed do we encrypt + insert.
    expect(encryptKeyMock).toHaveBeenCalledTimes(1);
    expect(rpcMock).toHaveBeenCalledTimes(1);
  });

  it("(e) classifies a network failure during validateKey as KEY_NETWORK_TIMEOUT (502 upstream)", async () => {
    // The route catches anything thrown from validateKey and bucketizes
    // it into a wizardErrors code. The classifier in route.ts:249-261
    // routes "timeout" / "etimedout" strings to KEY_NETWORK_TIMEOUT.
    const consoleErr = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    validateKeyMock.mockRejectedValue(
      new Error("upstream ETIMEDOUT after 15000ms"),
    );

    const POST = await importPost();
    const res = await POST(makeReq(VALID_BODY));

    expect(res.status).toBe(502);
    const json = await res.json();
    expect(json.code).toBe("KEY_NETWORK_TIMEOUT");
    // No encryption, no RPC — the validation step short-circuited.
    expect(encryptKeyMock).not.toHaveBeenCalled();
    expect(rpcMock).not.toHaveBeenCalled();
    consoleErr.mockRestore();
  });
});

/**
 * F6 (H-0304/H-0311) — pre-Railway idempotency fence. A double-submit or
 * browser retry carrying the same wizard_session_id must NOT spin a second
 * live-exchange validate + key encryption; the route returns the existing
 * draft instead. Pins that the fence short-circuits BEFORE validateKey /
 * encryptKey / the create_wizard_strategy RPC.
 */
describe("POST /api/strategies/create-with-key — idempotency fence (F6 H-0304/H-0311)", () => {
  beforeEach(() => {
    validateKeyMock.mockReset();
    encryptKeyMock.mockReset();
    rpcMock.mockReset();
    draftLookupMock.mockReset();
    // Default: no existing draft (overridden per-test).
    draftLookupMock.mockResolvedValue({ data: null, error: null });
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
      data: [{ strategy_id: STRATEGY_ID, api_key_id: API_KEY_ID }],
      error: null,
    });
  });

  it("returns the existing draft and skips Railway validate+encrypt+RPC when a draft already exists for this (user, wizard_session_id)", async () => {
    draftLookupMock.mockResolvedValueOnce({
      data: { id: STRATEGY_ID, api_key_id: API_KEY_ID },
      error: null,
    });

    const POST = await importPost();
    const res = await POST(makeReq(VALID_BODY));

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({
      ok: true,
      strategy_id: STRATEGY_ID,
      api_key_id: API_KEY_ID,
    });
    // The whole point: the expensive/charged work never ran on the replay.
    expect(validateKeyMock).not.toHaveBeenCalled();
    expect(encryptKeyMock).not.toHaveBeenCalled();
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("proceeds to validate+encrypt+RPC on the first submit (no existing draft)", async () => {
    const POST = await importPost();
    const res = await POST(makeReq(VALID_BODY));

    expect(res.status).toBe(200);
    // Fence consulted, found nothing → full flow runs exactly once.
    expect(validateKeyMock).toHaveBeenCalledTimes(1);
    expect(encryptKeyMock).toHaveBeenCalledTimes(1);
    expect(rpcMock).toHaveBeenCalledTimes(1);
  });
});

/**
 * H-0306 — auth boundary. The describe blocks above mock @/lib/api/withAuth
 * to bypass auth entirely, so the unauthed branch was never executed in CI.
 * Per Rule 9 the auth boundary is the single most important invariant on a
 * mutation route. This block re-imports the route against the REAL withAuth
 * (via vi.importActual) wrapped around a Supabase client whose
 * auth.getUser() returns no user, and asserts the 401 short-circuit fires
 * BEFORE any rate-limit / validation / encryption / RPC work.
 */
describe("POST /api/strategies/create-with-key — unmocked withAuth boundary (H-0306)", () => {
  beforeEach(() => {
    vi.resetModules();
    validateKeyMock.mockReset();
    encryptKeyMock.mockReset();
    rpcMock.mockReset();
  });

  afterEach(() => {
    vi.resetModules();
  });

  it("returns 401 when the session is missing — handler never runs", async () => {
    // Real withAuth — not the bypass mock above.
    vi.doMock("@/lib/api/withAuth", async () => {
      const actual = await vi.importActual<typeof import("@/lib/api/withAuth")>(
        "@/lib/api/withAuth",
      );
      return actual;
    });
    // Supabase client with NO authenticated user → withAuth's 401 branch.
    vi.doMock("@/lib/supabase/server", () => ({
      createClient: async () => ({
        auth: {
          getUser: async () => ({ data: { user: null }, error: null }),
        },
        rpc: rpcMock,
      }),
    }));

    const { POST } = await import("./route");
    const res = await POST(makeReq(VALID_BODY));

    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toBe("Unauthorized");

    // The handler body never executed: no validation, no encryption, no RPC.
    expect(validateKeyMock).not.toHaveBeenCalled();
    expect(encryptKeyMock).not.toHaveBeenCalled();
    expect(rpcMock).not.toHaveBeenCalled();
  });
});
