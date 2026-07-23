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
// #597 — the route force-derives asset_class:'crypto' on the freshly-created
// draft via `from("strategies").update({...}).eq("id").eq("user_id")`. Mirror
// the finalize-wizard thenable chain: update(payload) → eq → eq resolves to
// `{ error }`. updateMock captures the payload so a test can assert the derive
// fired with 'crypto'. Default resolves clean (non-blocking success path).
const assetClassUpdateMock = vi.fn((..._args: unknown[]) => ({
  eq: () => ({ eq: async () => ({ error: null }) }),
}));
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
      update: (...args: unknown[]) => assetClassUpdateMock(...args),
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
    assetClassUpdateMock.mockClear();

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

    // #597 — the draft is force-derived to 'crypto' right after creation so any
    // sync-preview compute in the wizard window annualizes √365, not the DB
    // DEFAULT 'traditional' √252. Every create-with-key strategy is API-keyed on
    // a crypto venue, so the derive is unconditional.
    expect(assetClassUpdateMock).toHaveBeenCalledTimes(1);
    expect(assetClassUpdateMock).toHaveBeenCalledWith({ asset_class: "crypto" });
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

  // FIX 3 facet a (Phase 110.1 / DOGFOOD-3) — the Python /api/validate-key
  // route returns only { valid, read_only }; it NEVER populates `permissions`.
  // So a real rejection arrives as a bare read_only:false. The pre-fix code
  // always fell through to KEY_HAS_TRADING_PERMS, asserting an UNOBSERVED trade
  // scope. This test FAILS against that: a bare read_only:false must map to the
  // honest KEY_NOT_READ_ONLY, not "trading permissions enabled". Key is still
  // rejected (still 400, never encrypted/inserted).
  it("(f) regression: bare read_only:false (NO permissions field, as Python actually returns) → KEY_NOT_READ_ONLY, not KEY_HAS_TRADING_PERMS", async () => {
    validateKeyMock.mockResolvedValue({
      valid: true,
      read_only: false,
      // permissions intentionally OMITTED — this is the real /api/validate-key
      // shape (routers/exchange.py returns only { valid, read_only }).
    });

    const POST = await importPost();
    const res = await POST(makeReq(VALID_BODY));

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.code).toBe("KEY_NOT_READ_ONLY");
    // The mislabel must be gone — we never observed a trade scope.
    expect(json.code).not.toBe("KEY_HAS_TRADING_PERMS");
    // Fail-closed preserved: still rejected, never encrypted or inserted.
    expect(rpcMock).not.toHaveBeenCalled();
    expect(encryptKeyMock).not.toHaveBeenCalled();
  });

  // FIX 3 facet b (Phase 110.1 / DOGFOOD-3) — the Python probe fail-closed
  // detail ("Could not verify the key's permission scopes…") previously fell
  // through the catch classifier to code=UNKNOWN, status=500 — reading as a
  // terminal "something went wrong, team notified" for a TRANSIENT upstream
  // blip. This test FAILS against that: it must map to a retryable 5xx with a
  // retry-flavored code.
  it("(g) regression: a 'could not verify permission scopes' probe failure → retryable 5xx + KEY_PROBE_FAILED, not 500/UNKNOWN", async () => {
    const consoleErr = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    validateKeyMock.mockRejectedValue(
      new Error("Could not verify the key's permission scopes"),
    );

    const POST = await importPost();
    const res = await POST(makeReq(VALID_BODY));

    // Retryable upstream fault, NOT a terminal 500.
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

  // DOGFOOD (2026-07-18) — a genuine exchange auth rejection. The worker's
  // AUTH_FAILED arm (services/exchange.py) raises HTTP 400 with the STABLE
  // detail "Authentication failed. Check your API key and secret." for e.g.
  // Deribit error 13004 invalid_credentials (testnet:false, a live production
  // account). Pre-fix that detail matched NO catch-classifier branch and fell
  // through to code=UNKNOWN status=500 — the terminal "something went wrong,
  // our team has been notified" screen — hiding a plain wrong/regenerated key
  // from the founder. This FAILS against that: it must surface the actionable
  // client-fault KEY_AUTH_FAILED at 400, and must NOT borrow
  // KEY_INVALID_SIGNATURE (whose copy falsely asserts the key was accepted).
  it("(h) regression: worker 'Authentication failed' (Deribit invalid_credentials) → KEY_AUTH_FAILED 400, not UNKNOWN/500", async () => {
    const consoleErr = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    validateKeyMock.mockRejectedValue(
      new Error("Authentication failed. Check your API key and secret."),
    );

    const POST = await importPost();
    const res = await POST(makeReq(VALID_BODY));

    // Client fault (bad credentials) — a 400 the user can act on, NOT the
    // terminal 500 UNKNOWN.
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.code).toBe("KEY_AUTH_FAILED");
    expect(json.code).not.toBe("UNKNOWN");
    expect(json.code).not.toBe("KEY_INVALID_SIGNATURE");
    // Fail-closed: rejected before any encryption or DB insert.
    expect(encryptKeyMock).not.toHaveBeenCalled();
    expect(rpcMock).not.toHaveBeenCalled();
    consoleErr.mockRestore();
  });
});

/**
 * SFOX-03 / 119-CONTEXT Q1 (LOCKED) — the SECURITY-SENSITIVE api_secret carve-out.
 *
 * sFOX authenticates with a SINGLE Bearer token (no api_secret — 118-RESEARCH
 * confirmed). For `exchange === "sfox"` ONLY, the :61 `length < 8` secret gate must
 * admit a missing/empty secret, normalize it to "", and route it through the SAME
 * validateKey/encryptKey chokepoint (trimCredential("") === "") — never a parallel
 * path. Every ccxt exchange (binance/okx/bybit/deribit) keeps the byte-identical
 * KEY_INVALID_FORMAT "api_secret is required" rejection for a short/empty secret,
 * proving the relaxation weakens nothing (T-119-08/09/11). The 512-char DoS bound is
 * retained for any present sfox secret.
 */
describe("POST /api/strategies/create-with-key — sfox api_secret carve-out (SFOX-03)", () => {
  beforeEach(() => {
    validateKeyMock.mockReset();
    encryptKeyMock.mockReset();
    rpcMock.mockReset();
    assetClassUpdateMock.mockClear();
    draftLookupMock.mockReset();
    draftLookupMock.mockResolvedValue({ data: null, error: null });
    // F2 (Phase 122): the carve-out only runs when the server go-live flag is
    // ON. These tests exercise the ENABLED path; the disabled default is covered
    // by the dedicated fail-closed block below.
    process.env.SFOX_ENABLED = "true";
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

  afterEach(() => {
    delete process.env.SFOX_ENABLED;
  });

  const SFOX_TOKEN = "sfox-bearer-token-value";
  const SFOX_BODY = {
    exchange: "sfox",
    api_key: SFOX_TOKEN,
    label: "sfox key",
    wizard_session_id: WIZARD_SESSION_ID,
  };

  it("admits sfox through isSupportedExchange and accepts NO api_secret (validateKey gets '')", async () => {
    const POST = await importPost();
    const res = await POST(makeReq(SFOX_BODY));

    expect(res.status).toBe(200);
    // Proves 119-01's SUPPORTED_EXCHANGES wiring (not just the constant): had the
    // :47 gate rejected sfox we'd see 400 "Unsupported exchange" here. The absent
    // secret is normalized to "" and passed through the SAME funnel the ccxt path uses.
    expect(validateKeyMock).toHaveBeenCalledWith("sfox", SFOX_TOKEN, "", undefined);
    expect(encryptKeyMock).toHaveBeenCalledWith("sfox", SFOX_TOKEN, "", undefined);
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

  // WR-01: mixed-case sfox is handled IDENTICALLY to the validate-and-encrypt
  // allocator route — the carve-out matches case-insensitively AND the value
  // stamped into the RPC (and stored in the DB) is the canonical lowercase 'sfox'.
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

  it("stamps p_exchange='sfox' into the create_wizard_strategy RPC payload (DB CHECK admits it per 119-01)", async () => {
    const POST = await importPost();
    const res = await POST(makeReq(SFOX_BODY));

    expect(res.status).toBe(200);
    const [rpcName, rpcArgs] = rpcMock.mock.calls[0];
    expect(rpcName).toBe("create_wizard_strategy");
    expect((rpcArgs as Record<string, unknown>).p_exchange).toBe("sfox");
  });

  it("STILL rejects a sfox api_secret longer than 512 chars — DoS bound kept for the optional field", async () => {
    const POST = await importPost();
    const res = await POST(makeReq({ ...SFOX_BODY, api_secret: "s".repeat(513) }));

    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("KEY_INVALID_FORMAT");
    expect(validateKeyMock).not.toHaveBeenCalled();
  });

  it("surfaces KEY_AUTH_FAILED when the worker rejects sfox auth (shared classifier, no wizardErrors edit)", async () => {
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
          api_secret: "short77", // 7 chars — below the < 8 gate
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
 * sfox connect must FAIL CLOSED — a clean 400 "not yet available", no live
 * probe (validateKey), no saved key, no api_verified draft. The client flag
 * NEXT_PUBLIC_SFOX_ENABLED only hides the card; this proves the SERVER refuses
 * a hand-crafted sfox request. ccxt exchanges are unaffected by the flag.
 */
describe("POST /api/strategies/create-with-key — sfox server gate (F2, SFOX_ENABLED off)", () => {
  beforeEach(() => {
    validateKeyMock.mockReset();
    encryptKeyMock.mockReset();
    rpcMock.mockReset();
    draftLookupMock.mockReset();
    draftLookupMock.mockResolvedValue({ data: null, error: null });
    delete process.env.SFOX_ENABLED;
    validateKeyMock.mockResolvedValue({ valid: true, read_only: true, permissions: ["read"] });
    encryptKeyMock.mockResolvedValue({ api_key_encrypted: "encrypted-blob-base64" });
    rpcMock.mockResolvedValue({
      data: [{ strategy_id: STRATEGY_ID, api_key_id: API_KEY_ID }],
      error: null,
    });
  });

  it.each(["sfox", "sFOX", "SFOX"])(
    "fails closed for %s (400 not-available, no live probe, no key saved)",
    async (exchange) => {
      const POST = await importPost();
      const res = await POST(
        makeReq({
          exchange,
          api_key: "sfox-bearer-token-value",
          label: "sfox key",
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

/**
 * Phase 135 (MT5SRC-03) — mt5 acceptance. 'mt5' was auto-widened into
 * SUPPORTED_EXCHANGES in plan 135-02, so isSupportedExchange admits it with
 * ZERO route.ts edits. mt5 is the MIRROR-IMAGE of the sfox carve-out: it flows
 * the api_secret-REQUIRED path (no sfox-style relaxation), and an invalid
 * exchange value is STILL rejected (defense-in-depth: TS enum → pydantic
 * Literal → SQL CHECK). The worker's is_mt5 branch + its mt5_enabled_server()
 * go-dark gate are the authoritative live-probe controls behind this route.
 */
describe("POST /api/strategies/create-with-key — mt5 acceptance (MT5SRC-03)", () => {
  beforeEach(() => {
    validateKeyMock.mockReset();
    encryptKeyMock.mockReset();
    rpcMock.mockReset();
    draftLookupMock.mockReset();
    draftLookupMock.mockResolvedValue({ data: null, error: null });
    assetClassUpdateMock.mockClear();
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

  const MT5_BODY = {
    exchange: "mt5",
    api_key: "500123456", // login → api_key slot (≥8 chars)
    api_secret: "investor-password-123", // investor password → api_secret slot
    passphrase: "MetaQuotes-Demo", // broker server → passphrase slot
    label: "mt5 key",
    wizard_session_id: WIZARD_SESSION_ID,
  };

  it("accepts exchange=mt5 (clears isSupportedExchange) and stamps p_exchange='mt5' into the RPC", async () => {
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
    expect(rpcName).toBe("create_wizard_strategy");
    expect((rpcArgs as Record<string, unknown>).p_exchange).toBe("mt5");
  });

  it("flows the api_secret-REQUIRED path — mt5 with NO api_secret is a 400 (no sfox relaxation leak)", async () => {
    const POST = await importPost();
    const res = await POST(
      makeReq({
        exchange: "mt5",
        api_key: "500123456",
        passphrase: "MetaQuotes-Demo",
        label: "mt5 key",
        wizard_session_id: WIZARD_SESSION_ID,
      }),
    );

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.code).toBe("KEY_INVALID_FORMAT");
    expect(json.error).toBe("api_secret is required");
    expect(validateKeyMock).not.toHaveBeenCalled();
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
