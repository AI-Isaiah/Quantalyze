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

  // DOGFOOD (2026-07-18) — the "+ Add another key" (multi-key) path. This route
  // shares classifyKeyValidationError with create-with-key, so a genuine
  // exchange auth rejection (Deribit 13004 invalid_credentials → the worker's
  // "Authentication failed…" detail) must surface the actionable KEY_AUTH_FAILED
  // 400 HERE too, not the terminal UNKNOWN/500 the founder originally saw when
  // adding a second key. Pins that the shared classifier is actually WIRED in.
  it("regression: worker 'Authentication failed' (Deribit invalid_credentials) → KEY_AUTH_FAILED 400, not UNKNOWN/500", async () => {
    const consoleErr = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    validateKeyMock.mockRejectedValue(
      new Error("Authentication failed. Check your API key and secret."),
    );

    const POST = await importPost();
    const res = await POST(makeReq(VALID_BODY));

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.code).toBe("KEY_AUTH_FAILED");
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

/**
 * SFOX-03 / 119-CONTEXT Q1 (LOCKED) — the SECURITY-SENSITIVE api_secret carve-out,
 * mirror of the create-with-key sibling. sFOX authenticates with a SINGLE Bearer
 * token (no api_secret). For `exchange === "sfox"` ONLY, the :81 `length < 8` gate
 * admits a missing/empty secret, normalizes it to "", and routes it through the SAME
 * validateKey/encryptKey chokepoint (trimCredential("") === "") — never a parallel
 * path. Every ccxt exchange keeps the byte-identical KEY_INVALID_FORMAT rejection for
 * a short/empty secret; the 512-char DoS bound is retained for any present secret.
 */
describe("POST /api/strategies/composite/add-key — sfox api_secret carve-out (SFOX-03)", () => {
  beforeEach(resetHappyMocks);
  // F2 (Phase 122): the carve-out only runs when the server go-live flag is ON.
  // These tests exercise the ENABLED path; the disabled default is covered by
  // the dedicated fail-closed block below.
  beforeEach(() => {
    process.env.SFOX_ENABLED = "true";
  });
  afterEach(() => {
    delete process.env.SFOX_ENABLED;
  });

  const SFOX_TOKEN = "sfox-bearer-token-value";
  const SFOX_BODY = {
    exchange: "sfox",
    api_key: SFOX_TOKEN,
    label: "sfox composite key",
    wizard_session_id: WIZARD_SESSION_ID,
  };

  it("admits sfox through isSupportedExchange and accepts NO api_secret (validateKey gets '')", async () => {
    const POST = await importPost();
    const res = await POST(makeReq(SFOX_BODY));

    expect(res.status).toBe(200);
    // Proves 119-01's SUPPORTED_EXCHANGES wiring: had the :67 gate rejected sfox
    // we'd see 400 "Unsupported exchange". The absent secret is normalized to ""
    // and passed through the SAME funnel the ccxt path uses.
    expect(validateKeyMock).toHaveBeenCalledWith("sfox", SFOX_TOKEN, "", undefined);
    expect(encryptKeyMock).toHaveBeenCalledWith("sfox", SFOX_TOKEN, "", undefined);
    const [rpcName, rpcArgs] = rpcMock.mock.calls[0];
    expect(rpcName).toBe("add_wizard_composite_key");
    expect((rpcArgs as Record<string, unknown>).p_exchange).toBe("sfox");
  });

  it.each([
    ["undefined", undefined],
    ["null", null],
    ["empty string", ""],
  ])("normalizes sfox api_secret=%s to '' through the shared chokepoint", async (_label, secret) => {
    const body: Record<string, unknown> = { ...SFOX_BODY };
    if (secret !== undefined) body.api_secret = secret;

    const POST = await importPost();
    const res = await POST(makeReq(body));

    expect(res.status).toBe(200);
    expect(validateKeyMock).toHaveBeenCalledWith("sfox", SFOX_TOKEN, "", undefined);
  });

  // WR-01: mixed-case sfox is handled IDENTICALLY across all three routes —
  // case-insensitive carve-out AND canonical lowercase 'sfox' stamped into the RPC.
  it.each(["sFOX", "SFOX", "Sfox"])(
    "accepts mixed-case %s and normalizes to canonical 'sfox' (accepted with empty secret, p_exchange='sfox')",
    async (exchange) => {
      const POST = await importPost();
      const res = await POST(makeReq({ ...SFOX_BODY, exchange }));

      expect(res.status).toBe(200);
      expect(validateKeyMock).toHaveBeenCalledWith("sfox", SFOX_TOKEN, "", undefined);
      expect(encryptKeyMock).toHaveBeenCalledWith("sfox", SFOX_TOKEN, "", undefined);
      const [, rpcArgs] = rpcMock.mock.calls[0];
      expect((rpcArgs as Record<string, unknown>).p_exchange).toBe("sfox");
    },
  );

  it("STILL rejects a sfox api_secret longer than 512 chars — DoS bound kept", async () => {
    const POST = await importPost();
    const res = await POST(makeReq({ ...SFOX_BODY, api_secret: "s".repeat(513) }));

    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("KEY_INVALID_FORMAT");
    expect(validateKeyMock).not.toHaveBeenCalled();
  });

  it("surfaces KEY_AUTH_FAILED when the worker rejects sfox auth (shared classifier)", async () => {
    const consoleErr = vi.spyOn(console, "error").mockImplementation(() => {});
    validateKeyMock.mockRejectedValue(
      new Error("Authentication failed. Check your API key and secret."),
    );

    const POST = await importPost();
    const res = await POST(makeReq(SFOX_BODY));

    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("KEY_AUTH_FAILED");
    expect(encryptKeyMock).not.toHaveBeenCalled();
    expect(rpcMock).not.toHaveBeenCalled();
    consoleErr.mockRestore();
  });

  it.each(["binance", "okx", "bybit", "deribit"])(
    "STILL rejects %s with a 7-char api_secret — KEY_INVALID_FORMAT 'api_secret is required' (ccxt unchanged)",
    async (exchange) => {
      const POST = await importPost();
      const res = await POST(
        makeReq({
          exchange,
          api_key: "ccxt-key-with-enough-chars",
          api_secret: "short77", // 7 chars
          passphrase: "pp",
          wizard_session_id: WIZARD_SESSION_ID,
        }),
      );

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.code).toBe("KEY_INVALID_FORMAT");
      expect(json.error).toBe("api_secret is required");
      expect(validateKeyMock).not.toHaveBeenCalled();
    },
  );

  it.each(["binance", "okx", "bybit", "deribit"])(
    "STILL rejects %s with an EMPTY api_secret (carve-out is sfox-only)",
    async (exchange) => {
      const POST = await importPost();
      const res = await POST(
        makeReq({
          exchange,
          api_key: "ccxt-key-with-enough-chars",
          api_secret: "",
          passphrase: "pp",
          wizard_session_id: WIZARD_SESSION_ID,
        }),
      );

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.code).toBe("KEY_INVALID_FORMAT");
      expect(json.error).toBe("api_secret is required");
      expect(validateKeyMock).not.toHaveBeenCalled();
    },
  );
});

/**
 * F2 (Phase 122 — STRUCTURAL server gate): with SFOX_ENABLED unset (default), a
 * sfox "+ Add another key" must FAIL CLOSED — a clean 400 "not yet available",
 * no live probe (validateKey), no minted composite key row. Mirrors the
 * create-with-key sibling; ccxt exchanges are unaffected by the flag.
 */
describe("POST /api/strategies/composite/add-key — sfox server gate (F2, SFOX_ENABLED off)", () => {
  beforeEach(resetHappyMocks);
  beforeEach(() => {
    delete process.env.SFOX_ENABLED;
  });

  it.each(["sfox", "sFOX", "SFOX"])(
    "fails closed for %s (400 not-available, no live probe, no key minted)",
    async (exchange) => {
      const POST = await importPost();
      const res = await POST(
        makeReq({
          exchange,
          api_key: "sfox-bearer-token-value",
          label: "sfox composite key",
          wizard_session_id: WIZARD_SESSION_ID,
        }),
      );

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.code).toBe("KEY_INVALID_FORMAT");
      expect(json.error).toBe("sFOX integration is not yet available.");
      expect(validateKeyMock).not.toHaveBeenCalled();
      expect(encryptKeyMock).not.toHaveBeenCalled();
      expect(rpcMock).not.toHaveBeenCalled();
    },
  );

  it("does NOT gate ccxt — binance runs normally with SFOX_ENABLED unset", async () => {
    const POST = await importPost();
    const res = await POST(
      makeReq({
        exchange: "binance",
        api_key: "ccxt-key-with-enough-chars",
        api_secret: "ccxt-secret-enough",
        wizard_session_id: WIZARD_SESSION_ID,
      }),
    );

    expect(res.status).toBe(200);
    expect(validateKeyMock).toHaveBeenCalled();
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

/**
 * Phase 135 (MT5SRC-03) — mt5 acceptance on the multi-key path. 'mt5' was
 * auto-widened into SUPPORTED_EXCHANGES (plan 135-02), so isSupportedExchange
 * admits it with ZERO route.ts edits — identical to the create-with-key
 * sibling. mt5 flows the api_secret-REQUIRED path (no sfox-style relaxation),
 * and a bogus exchange value is STILL rejected (TS enum → pydantic → SQL CHECK).
 */
describe("POST /api/strategies/composite/add-key — mt5 acceptance (MT5SRC-03)", () => {
  beforeEach(resetHappyMocks);
  // Acceptance = the go-live state: MT5_ENABLED=true so the server gate (added to
  // mirror validate-and-encrypt + the sfox precedent) lets the connect through.
  // The fail-closed default is covered by the dedicated block below.
  beforeEach(() => {
    process.env.MT5_ENABLED = "true";
  });
  afterEach(() => {
    delete process.env.MT5_ENABLED;
  });

  const MT5_BODY = {
    exchange: "mt5",
    api_key: "500123456", // login → api_key slot (≥8 chars)
    api_secret: "investor-password-123", // investor password → api_secret slot
    passphrase: "MetaQuotes-Demo", // broker server → passphrase slot
    label: "mt5 composite key",
    wizard_session_id: WIZARD_SESSION_ID,
  };

  it("accepts exchange=mt5 (clears isSupportedExchange) and stamps p_exchange='mt5' into add_wizard_composite_key", async () => {
    const POST = await importPost();
    const res = await POST(makeReq(MT5_BODY));

    expect(res.status).toBe(200);
    // login/api_key, investor pw/api_secret, broker server/passphrase — the
    // exact slot mapping the worker's is_mt5 branch reads back.
    expect(validateKeyMock).toHaveBeenCalledWith(
      "mt5",
      "500123456",
      "investor-password-123",
      "MetaQuotes-Demo",
    );
    const [rpcName, rpcArgs] = rpcMock.mock.calls[0];
    expect(rpcName).toBe("add_wizard_composite_key");
    expect((rpcArgs as Record<string, unknown>).p_exchange).toBe("mt5");
  });

  it("flows the api_secret-REQUIRED path — mt5 with NO api_secret is a 400 (no sfox relaxation leak)", async () => {
    const POST = await importPost();
    const res = await POST(
      makeReq({
        exchange: "mt5",
        api_key: "500123456",
        passphrase: "MetaQuotes-Demo",
        label: "mt5 composite key",
        wizard_session_id: WIZARD_SESSION_ID,
      }),
    );

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.code).toBe("KEY_INVALID_FORMAT");
    expect(json.error).toBe("api_secret is required");
    expect(validateKeyMock).not.toHaveBeenCalled();
  });

  it("accepts a SHORT (<8) mt5 login on the multi-key path — a broker account number is often 5-7 digits (RED-TEAM)", async () => {
    const POST = await importPost();
    const res = await POST(makeReq({ ...MT5_BODY, api_key: "500123" }));

    expect(res.status).toBe(200);
    expect(validateKeyMock).toHaveBeenCalledWith(
      "mt5",
      "500123",
      "investor-password-123",
      "MetaQuotes-Demo",
    );
  });

  it("STILL 400s an invalid exchange value (three-layer lockstep: bogus never admitted)", async () => {
    const POST = await importPost();
    const res = await POST(makeReq({ ...MT5_BODY, exchange: "notanexchange" }));

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.code).toBe("KEY_INVALID_FORMAT");
    expect(json.error).toBe("Unsupported exchange");
    expect(validateKeyMock).not.toHaveBeenCalled();
  });
});

/**
 * Phase 135 (MT5SRC-03) — STRUCTURAL server gate (regression for the ship-review
 * finding). Add-to-composite is a second connect path; with MT5_ENABLED unset it
 * must FAIL CLOSED — a clean 400 "not yet available", no live probe, no minted
 * composite key. Without the gate the request falls through to the Python
 * MT5_DISABLED_DETAIL gate → UNKNOWN → 500. Reddens if the gate is removed.
 * Mirrors the sfox server-gate block verbatim.
 */
describe("POST /api/strategies/composite/add-key — mt5 server gate (MT5_ENABLED off)", () => {
  beforeEach(resetHappyMocks);
  beforeEach(() => {
    delete process.env.MT5_ENABLED;
  });

  it.each(["mt5", "MT5", "Mt5"])(
    "fails closed for %s (400 not-available, no live probe, no key minted)",
    async (exchange) => {
      const POST = await importPost();
      const res = await POST(
        makeReq({
          exchange,
          api_key: "500123456",
          api_secret: "investor-password-123",
          passphrase: "MetaQuotes-Demo",
          label: "mt5 composite key",
          wizard_session_id: WIZARD_SESSION_ID,
        }),
      );

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.code).toBe("KEY_INVALID_FORMAT");
      expect(json.error).toBe("MT5 integration is not yet available.");
      expect(validateKeyMock).not.toHaveBeenCalled();
      expect(encryptKeyMock).not.toHaveBeenCalled();
      expect(rpcMock).not.toHaveBeenCalled();
    },
  );

  it("does NOT gate ccxt — binance runs normally with MT5_ENABLED unset", async () => {
    const POST = await importPost();
    const res = await POST(
      makeReq({
        exchange: "binance",
        api_key: "ccxt-key-with-enough-chars",
        api_secret: "ccxt-secret-enough",
        wizard_session_id: WIZARD_SESSION_ID,
      }),
    );

    expect(res.status).toBe(200);
    expect(validateKeyMock).toHaveBeenCalled();
  });
});
