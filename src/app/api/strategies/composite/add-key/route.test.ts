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

// ─────────────────────────────────────────────────────────────────────────────
// 140.3-13b / SEAMUX-08 — the Sentry capture, tested through the REAL helper.
//
// ⚠️ `@sentry/nextjs` is mocked here and `@/lib/sentry-capture` is DELIBERATELY
// NOT. Mocking the helper would answer "did the call site fire" while making
// every payload assertion VACUOUS about scrubbing — the scrub lives INSIDE the
// helper (SEAMCORE-06), so a mocked helper never runs it and "no secret in the
// payload" would pass with the scrubber deleted. Inherited from `140.3-13a`.
//
// ⚠️ SECRET-BEARING, exactly like `create-with-key`: the body carries the
// caller's RAW exchange credentials, which no module-level env list can know.
// `140.3-13a`'s M78b is the receipt — with `secrets` omitted the env-derived
// redaction keeps working, so an assertion written against an env token stays
// GREEN while the per-request credential ships verbatim. The cases below assert
// against the BODY values.
//
// ⚠️ AND THIS IS THE SECOND MEMBER OF THE PAIR. `create-with-key` is the one
// CONTEXT names and the one a single-route delivery would pick; add-key is the
// multi-key path, whose funnel was silent until `140.3-13a`. Both files carry
// the same cases so a delivery that instrumented only the famous one cannot
// pass as the class.
// ─────────────────────────────────────────────────────────────────────────────
const sentryState = vi.hoisted(() => ({
  captured: [] as Array<{
    err: unknown;
    options: {
      tags?: Record<string, string>;
      extra?: Record<string, unknown>;
      level?: string;
    };
  }>,
}));

vi.mock("@sentry/nextjs", () => ({
  captureException: (err: unknown, options: Record<string, unknown>) => {
    sentryState.captured.push({
      err,
      options: options as (typeof sentryState.captured)[number]["options"],
    });
  },
}));

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
    // 140.4-13 / SEAMRIM-05 — the THIRD outcome. Absent is a genuine throttle
    // (429); "ratelimit_misconfigured" is OUR store being unreachable and must
    // answer 503.
    reason?: "ratelimit_misconfigured";
  }>
>();
// ⚠️ EXTENDED, NOT REPLACED (140.4-13 / SEAMRIM-05). See the note in
// `src/__tests__/csv-validate-route.test.ts`: the pure helpers come from
// `importActual` so this mock cannot drift from the real 503-vs-429 decision.
vi.mock("@/lib/ratelimit", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/ratelimit")>();
  return {
    userActionLimiter: {},
    checkLimit: (limiter: unknown, key: string) => checkLimitMock(limiter, key),
    rateLimitDenyJson: actual.rateLimitDenyJson,
    isRateLimitMisconfigured: actual.isRateLimitMisconfigured,
  };
});

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
 * ═══════════════════════════════════════════════════════════════════════════
 * 154-06 / WIZCONT-02 — TWIN-8: this route's 23505 arm discriminates too.
 *
 * The twin, stated: this arm and `create-with-key`'s carried the SAME
 * undifferentiated `23505 → DRAFT_ALREADY_EXISTS` mapping. Migration
 * 20260812083206 added a SECOND unique index over `api_keys`, so that mapping
 * is no longer one fact — and closing only the copy the bug was filed against
 * is how divergent twins are born. These cases pin all three branches, and the
 * pre-existing session case above pins that nothing moved for the common one.
 * ═══════════════════════════════════════════════════════════════════════════
 */
describe("[154-06 / TWIN-8] composite/add-key — the 23505 arm discriminates", () => {
  beforeEach(() => {
    resetHappyMocks();
    sentryState.captured.length = 0;
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** `captureToSentry` fires through a lazy `import(...).then(...)` chain. */
  async function awaitCapture() {
    await vi.waitFor(() =>
      expect(sentryState.captured.length).toBeGreaterThan(0),
    );
    return sentryState.captured[sentryState.captured.length - 1];
  }

  it("the wizard-session constraint keeps a BYTE-IDENTICAL 409 body", async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: {
        code: "23505",
        message:
          'duplicate key value violates unique constraint "strategies_user_wizard_session_source_uniq"',
      },
    });

    const POST = await importPost();
    const res = await POST(makeReq(VALID_BODY));

    expect(res.status).toBe(409);
    // Byte-wise: `toEqual` on parsed JSON does not compare key order, and this
    // body is what the wizard's copy table is pinned against.
    expect(await res.text()).toBe(
      '{"code":"DRAFT_ALREADY_EXISTS","error":"A wizard session with this key is already in progress."}',
    );
    expect(sentryState.captured).toEqual([]);
  });

  it("a 23505 naming NO constraint keeps the pre-154 409 (absence is not a value)", async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: { code: "23505", message: "unique_violation" },
    });

    const POST = await importPost();
    const res = await POST(makeReq(VALID_BODY));

    expect(res.status).toBe(409);
    expect(await res.text()).toBe(
      '{"code":"DRAFT_ALREADY_EXISTS","error":"A wizard session with this key is already in progress."}',
    );
  });

  it("the VENUE-IDENTITY constraint is ALARM-ONLY here — it is unreachable, so its arrival is a premise change", async () => {
    // add_wizard_composite_key does not write venue_account_id (TWIN-7), and
    // MT5 cannot be a composite member — so this cannot fire today. If it ever
    // does, a silent 409 would bury the fact that the composite path started
    // writing venue identities.
    rpcMock.mockResolvedValue({
      data: null,
      error: {
        code: "23505",
        message:
          'duplicate key value violates unique constraint "api_keys_user_exchange_venue_account_uniq"',
      },
    });

    const POST = await importPost();
    const res = await POST(makeReq(VALID_BODY));

    expect(res.status).toBe(500);
    expect((await res.json()).code).toBe("UNKNOWN");
    const capture = await awaitCapture();
    expect(capture.options.tags?.step).toBe(
      "draft-rpc-venue-identity-unreachable",
    );
    expect(capture.options.extra?.constraint).toBe(
      "api_keys_user_exchange_venue_account_uniq",
    );
  });

  it("an UNRECOGNISED constraint fails LOUD — 500 + Sentry naming it, never the wrong 409", async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: {
        code: "23505",
        message:
          'duplicate key value violates unique constraint "api_keys_some_future_uniq"',
      },
    });

    const POST = await importPost();
    const res = await POST(makeReq(VALID_BODY));

    expect(res.status).toBe(500);
    expect((await res.json()).code).toBe("UNKNOWN");
    const capture = await awaitCapture();
    expect(capture.options.tags?.step).toBe("draft-rpc-unknown-constraint");
    expect(capture.options.extra?.constraint).toBe("api_keys_some_future_uniq");
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
    expect(validateKeyMock).toHaveBeenCalledWith("sfox", SFOX_TOKEN, "", undefined, { userId: MOCK_USER.id });
    expect(encryptKeyMock).toHaveBeenCalledWith("sfox", SFOX_TOKEN, "", undefined, { userId: MOCK_USER.id });
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
    expect(validateKeyMock).toHaveBeenCalledWith("sfox", SFOX_TOKEN, "", undefined, { userId: MOCK_USER.id });
  });

  // WR-01: mixed-case sfox is handled IDENTICALLY across all three routes —
  // case-insensitive carve-out AND canonical lowercase 'sfox' stamped into the RPC.
  it.each(["sFOX", "SFOX", "Sfox"])(
    "accepts mixed-case %s and normalizes to canonical 'sfox' (accepted with empty secret, p_exchange='sfox')",
    async (exchange) => {
      const POST = await importPost();
      const res = await POST(makeReq({ ...SFOX_BODY, exchange }));

      expect(res.status).toBe(200);
      expect(validateKeyMock).toHaveBeenCalledWith("sfox", SFOX_TOKEN, "", undefined, { userId: MOCK_USER.id });
      expect(encryptKeyMock).toHaveBeenCalledWith("sfox", SFOX_TOKEN, "", undefined, { userId: MOCK_USER.id });
      const [, rpcArgs] = rpcMock.mock.calls[0];
      expect((rpcArgs as Record<string, unknown>).p_exchange).toBe("sfox");
    },
  );

  it("STILL rejects a sfox api_secret longer than 512 chars — DoS bound kept", async () => {
    const POST = await importPost();
    const res = await POST(makeReq({ ...SFOX_BODY, api_secret: "s".repeat(513) }));

    expect(res.status).toBe(400);
    // 142.2-07 / MT5-04: the CAP is byte-unchanged; only the code it answers
    // moved off the format bucket. A length cap is not a format judgement.
    expect((await res.json()).code).toBe("KEY_INPUT_TOO_LONG");
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
      expect(json.code).toBe("KEY_VENUE_NOT_ENABLED");
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
    // 140.4-13 / SEAMRIM-05 — the FULL body and headers, byte-unchanged by the
    // chokepoint adoption. Hand-typed from the pre-adoption source: `{code,
    // error}` in THAT key order, with NO_STORE_HEADERS and Retry-After.
    // 140.4-16 / WR-03 — byte-wise, because `toEqual` on parsed JSON does NOT
    // compare key order (measured: a swap left all four receipts green). See
    // the note in `keys/sync/route.test.ts`.
    expect(await res.clone().text()).toBe(
      '{"code":"KEY_RATE_LIMIT","error":"Too many requests"}',
    );
    expect(await res.json()).toEqual({
      code: "KEY_RATE_LIMIT",
      error: "Too many requests",
    });
    expect(res.headers.get("Retry-After")).toBe("42");
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
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

  it("[140.4-13 / SEAMRIM-05] ratelimit_misconfigured → 503 and NOT the exchange-blaming KEY_RATE_LIMIT", async () => {
    checkLimitMock.mockResolvedValue({
      success: false,
      retryAfter: 60,
      reason: "ratelimit_misconfigured",
    });

    const POST = await importPost();
    const res = await POST(makeReq(VALID_BODY));

    expect(res.status).toBe(503);
    const body = await res.json();
    expect(
      body.code,
      "`KEY_RATE_LIMIT`'s copy calls the throttle exchange-side. Emitting it " +
        "for OUR store being unreachable blames the user's exchange for our " +
        "outage, on their first click, for as long as Upstash is down.",
    ).not.toBe("KEY_RATE_LIMIT");
    expect(body.code).toBe("SEAM_MISCONFIGURED");
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect(res.headers.get("Retry-After")).toBe("60");
    expect(validateKeyMock).not.toHaveBeenCalled();
    expect(encryptKeyMock).not.toHaveBeenCalled();
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("[140.4-13 / SEAMRIM-05] success → the deny arm does not fire", async () => {
    checkLimitMock.mockResolvedValue({ success: true });

    const POST = await importPost();
    const res = await POST(makeReq(VALID_BODY));

    expect(res.status).not.toBe(429);
    expect(res.status).not.toBe(503);
    expect(validateKeyMock).toHaveBeenCalled();
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
      { userId: MOCK_USER.id },
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
    // 142.2-07 / MT5-04: an ABSENT investor password is a missing field, not a
    // malformed one — same split as the create-with-key sibling.
    expect(json.code).toBe("KEY_MISSING_REQUIRED_FIELD");
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
      { userId: MOCK_USER.id },
    );
  });

  it("STILL 400s an invalid exchange value (three-layer lockstep: bogus never admitted)", async () => {
    const POST = await importPost();
    const res = await POST(makeReq({ ...MT5_BODY, exchange: "notanexchange" }));

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.code).toBe("KEY_UNSUPPORTED_VENUE");
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
      expect(json.code).toBe("KEY_VENUE_NOT_ENABLED");
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

/**
 * Phase 140 / SEAM-04 SC-5b — a circuit-breaker trip on the "+ Add another key"
 * path.
 *
 * This route shares `classifyKeyValidationError` with create-with-key, so the
 * multi-key path must produce the IDENTICAL honest 503 rather than the terminal
 * UNKNOWN/500 the substring cascade used to give a breaker trip. Pinning it here
 * as well as on the single-key route is the same drift guard the KEY_AUTH_FAILED
 * and KEY_PROBE_FAILED regressions above use: sharing a classifier is not proof
 * that both call sites actually thread the value it needs.
 *
 * `CircuitOpenError` comes from `@/lib/seam-errors` — the dependency-free leaf —
 * via a dynamic import so it resolves in the same module registry as the route.
 * The `@/lib/analytics-client` mock at the top of this file is a BARE factory
 * carrying only validateKey/encryptKey, so reaching the class through that
 * module would yield `undefined` and make `instanceof` throw inside the catch.
 */
describe("POST /api/strategies/composite/add-key — circuit-breaker trip (SEAM-04 SC-5b)", () => {
  beforeEach(resetHappyMocks);

  it("validateKey tripping the breaker → 503 SERVICE_UNAVAILABLE_RETRY, never UNKNOWN/500", async () => {
    const { CircuitOpenError } = await import("@/lib/seam-errors");
    validateKeyMock.mockRejectedValue(new CircuitOpenError(42));
    const consoleErr = vi.spyOn(console, "error").mockImplementation(() => {});

    const POST = await importPost();
    const res = await POST(makeReq(VALID_BODY));

    expect(res.status).toBe(503);
    expect(res.status).not.toBe(500);
    const json = await res.json();
    expect(json.code).toBe("SERVICE_UNAVAILABLE_RETRY");
    expect(json.code).not.toBe("UNKNOWN");
    // T-88-13 posture preserved: uniform { code } body, no raw message.
    expect(Object.keys(json)).toEqual(["code"]);
    expect(res.headers.get("Retry-After")).toBe("42");
    // Short-circuit: nothing was encrypted and no key row was minted.
    expect(encryptKeyMock).not.toHaveBeenCalled();
    expect(rpcMock).not.toHaveBeenCalled();
    consoleErr.mockRestore();
  });

  it("encryptKey tripping the breaker → the same 503 envelope (both seam calls covered)", async () => {
    const { CircuitOpenError } = await import("@/lib/seam-errors");
    encryptKeyMock.mockRejectedValue(new CircuitOpenError(7));
    const consoleErr = vi.spyOn(console, "error").mockImplementation(() => {});

    const POST = await importPost();
    const res = await POST(makeReq(VALID_BODY));

    expect(res.status).toBe(503);
    expect((await res.json()).code).toBe("SERVICE_UNAVAILABLE_RETRY");
    expect(res.headers.get("Retry-After")).toBe("7");
    expect(rpcMock).not.toHaveBeenCalled();
    consoleErr.mockRestore();
  });

  it("still classifies non-breaker errors by message (the substring cascade is intact)", async () => {
    // Negative control — see the create-with-key sibling.
    validateKeyMock.mockRejectedValue(new Error("connect ETIMEDOUT 10.0.0.1:443"));
    const consoleErr = vi.spyOn(console, "error").mockImplementation(() => {});

    const POST = await importPost();
    const res = await POST(makeReq(VALID_BODY));

    expect(res.status).toBe(502);
    expect((await res.json()).code).toBe("KEY_NETWORK_TIMEOUT");
    // Retry-After is breaker-specific — it must NOT appear on other 5xx paths.
    expect(res.headers.get("Retry-After")).toBeNull();
    consoleErr.mockRestore();
  });
});

describe("POST /api/strategies/composite/add-key — HI-02 credential redaction", () => {
  beforeEach(resetHappyMocks);

  it("the catch scrubs THIS ROUTE's per-request exchange credentials", async () => {
    // ⚠️ THE WIRING, NOT THE ROSTER, and deliberately the MIRROR of the
    // create-with-key case. These two routes share
    // `classifyKeyValidationError` precisely so the single-key and "+ Add
    // another key" paths cannot drift; their redaction must not drift either,
    // and a defect present in one and absent from the other is the
    // instance-not-class shape this programme exists to close.
    const consoleErr = vi.spyOn(console, "error").mockImplementation(() => {});
    validateKeyMock.mockRejectedValue(
      new Error(
        `fetch failed: connect ECONNREFUSED 10.0.0.1:8002 ` +
          `(x-service-key: svc, body: {"api_secret":"${VALID_BODY.api_secret}",` +
          `"passphrase":"${VALID_BODY.passphrase}"})`,
      ),
    );

    const POST = await importPost();
    await POST(makeReq(VALID_BODY));

    const logged = consoleErr.mock.calls
      .map((args) => args.map((a) => String(a)).join(" "))
      .join("\n");
    expect(logged).toContain("caught exception");
    expect(logged).not.toContain(VALID_BODY.api_secret);
    expect(logged).not.toContain(VALID_BODY.passphrase);
    // The A-10 half: never answer redaction by dropping the error.
    expect(logged).toContain("ECONNREFUSED");
    consoleErr.mockRestore();
  });
});

/**
 * 140.3-13b / SEAMUX-08 — this route captures to Sentry, under the ONE policy
 * written out in `src/app/api/admin/match/eval/route.ts`.
 *
 * ⚠️ THE BASELINE WAS ZERO, measured on the untouched tree:
 * `grep -vE '^\s*(//|\*)' route.ts | grep -c captureToSentry` read **0** here.
 * CONTEXT named this route and `create-with-key` as the two that "do not import
 * Sentry"; the real class was **9 of 15**, five times what the locked text said.
 *
 * ⚠️ DIVERGENCE-FREE BY DESIGN. Every case here has a twin in
 * `create-with-key/route.test.ts` at the same four arms. These two routes share
 * `classifyKeyValidationError` precisely so the single-key and "+ Add another
 * key" paths cannot drift; instrumenting one and reporting the class closed is
 * this programme's signature failure, so both counts are asserted per file.
 */
describe("[140.3-13b / SEAMUX-08] POST /api/strategies/composite/add-key — Sentry capture policy", () => {
  let consoleErr: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    resetHappyMocks();
    sentryState.captured.length = 0;
    consoleErr = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErr.mockRestore();
  });

  /** Wait for `captureToSentry`'s lazy `import(...).then(...)` chain. */
  async function nextCapture() {
    await vi.waitFor(() =>
      expect(
        sentryState.captured.length,
        "nothing was captured — the classifier's UNKNOWN terminal is the only place an unclassified key-connect failure is ever reported",
      ).toBeGreaterThan(0),
    );
    return sentryState.captured[sentryState.captured.length - 1];
  }

  /** Assert no capture happened, allowing the lazy chain time to have fired. */
  async function expectNoCapture() {
    await new Promise((r) => setTimeout(r, 0));
    expect(sentryState.captured).toEqual([]);
  }

  it("POSITIVE: an UNCLASSIFIED throw IS captured, with this route's OWN surface tag", async () => {
    validateKeyMock.mockRejectedValue(new Error("connect ECONNREFUSED 10.0.0.5:8002"));

    const POST = await importPost();
    const res = await POST(makeReq(VALID_BODY));
    expect(res.status).toBe(500);
    expect((await res.json()).code).toBe("UNKNOWN");

    const { err, options } = await nextCapture();
    // The surface must NOT be create-with-key's: a composite outage and a
    // single-key outage have to be tellable apart in Sentry, which is the
    // whole reason the tags are per route rather than per policy.
    expect(options.tags?.surface).toBe("strategies-composite-add-key");
    expect(options.tags?.step).toBe("unclassified-key-error");
    expect(err).toBeInstanceOf(Error);
    expect(options.extra?.exchange).toBe("okx");
  });

  it("M78b GUARD: the RAW per-request api_key / api_secret / passphrase never reach Sentry — and ECONNREFUSED survives", async () => {
    validateKeyMock.mockRejectedValue(
      new Error(
        `connect ECONNREFUSED 10.0.0.5:8002 ` +
          `(sent api_key=${VALID_BODY.api_key} api_secret=${VALID_BODY.api_secret} ` +
          `passphrase=${VALID_BODY.passphrase})`,
      ),
    );

    const POST = await importPost();
    await POST(makeReq(VALID_BODY));

    const message = ((await nextCapture()).err as Error).message;
    expect(
      message,
      "the caller's RAW exchange api_key was dispatched to Sentry (TRAP-1)",
    ).not.toContain(VALID_BODY.api_key);
    expect(
      message,
      "the caller's RAW exchange api_secret was dispatched to Sentry (TRAP-1)",
    ).not.toContain(VALID_BODY.api_secret);
    expect(
      message,
      "the caller's RAW exchange passphrase was dispatched to Sentry (TRAP-1)",
    ).not.toContain(VALID_BODY.passphrase);
    expect(
      message,
      "the syscall token was eaten by the redactor — ECONNREFUSED is the most valuable thing in a transport line",
    ).toContain("ECONNREFUSED");
  });

  it("POSITIVE: an encrypt 2xx with no api_key_encrypted IS captured as a CONTRACT violation", async () => {
    encryptKeyMock.mockResolvedValue({
      api_secret_encrypted: null,
      passphrase_encrypted: null,
      kek_version: 1,
    });

    const POST = await importPost();
    const res = await POST(makeReq(VALID_BODY));
    expect(res.status).toBe(502);

    const { err, options } = await nextCapture();
    expect(options.tags?.step).toBe("encrypt-contract");
    expect(options.extra?.returned_keys).toEqual([
      "api_secret_encrypted",
      "passphrase_encrypted",
      "kek_version",
    ]);
    expect((err as Error).message).toContain("api_key_encrypted");
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("POSITIVE: an UNRECOGNISED RPC failure IS captured (23505 / 42501 are recognised and are not)", async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: { code: "57014", message: "canceling statement due to statement timeout" },
    });

    const POST = await importPost();
    const res = await POST(makeReq(VALID_BODY));
    expect(res.status).toBe(500);

    const { options } = await nextCapture();
    expect(options.tags?.step).toBe("draft-rpc-error");
    expect(options.extra?.pg_code).toBe("57014");
  });

  it("POSITIVE: an RPC that SUCCEEDS with no usable row IS captured as a CONTRACT violation", async () => {
    rpcMock.mockResolvedValue({ data: [], error: null });

    const POST = await importPost();
    const res = await POST(makeReq(VALID_BODY));
    expect(res.status).toBe(500);

    const { options } = await nextCapture();
    expect(options.tags?.step).toBe("draft-rpc-contract");
    expect(options.extra?.row_present).toBe(false);
  });

  it("NEGATIVE: a breaker short-circuit is NEVER captured — and the breaker cell is UNDISTURBED", async () => {
    const { CircuitOpenError } = await import("@/lib/seam-errors");
    validateKeyMock.mockRejectedValue(new CircuitOpenError(42));

    const POST = await importPost();
    const res = await POST(makeReq(VALID_BODY));

    // The POSITIVE half re-pins all three properties this route mirrors from
    // create-with-key: the caught VALUE reached the shared classifier (only a
    // type check yields SERVICE_UNAVAILABLE_RETRY — a stringified error would
    // land on UNKNOWN/500), the STATUS came from the classifier, and the
    // conditional Retry-After carries the breaker's own TTL.
    expect(res.status).toBe(503);
    expect((await res.json()).code).toBe("SERVICE_UNAVAILABLE_RETRY");
    expect(res.headers.get("Retry-After")).toBe("42");
    await expectNoCapture();
  });

  it("NEGATIVE: a classified CALLER FAULT is never captured (a wrong secret is not our defect)", async () => {
    validateKeyMock.mockRejectedValue(new Error("Invalid signature for request"));

    const POST = await importPost();
    const res = await POST(makeReq(VALID_BODY));
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("KEY_INVALID_SIGNATURE");
    await expectNoCapture();
  });

  it("NEGATIVE: a classified upstream TIMEOUT is never captured (60s cold starts are documented as normal)", async () => {
    validateKeyMock.mockRejectedValue(new Error("request timeout reaching analytics"));

    const POST = await importPost();
    const res = await POST(makeReq(VALID_BODY));
    expect(res.status).toBe(502);
    expect((await res.json()).code).toBe("KEY_NETWORK_TIMEOUT");
    await expectNoCapture();
  });

  it("NEGATIVE: our own rate-limit rejection is NEVER captured (the limiter working is not a fault)", async () => {
    checkLimitMock.mockResolvedValue({ success: false, retryAfter: 30 });

    const POST = await importPost();
    const res = await POST(makeReq(VALID_BODY));
    expect(res.status).toBe(429);
    expect(validateKeyMock).not.toHaveBeenCalled();
    await expectNoCapture();
  });
});

/**
 * Phase 142.2-07 / MT5-04 (D-05) — EVERY REJECTION SITE, ONE HONEST CODE EACH.
 * The SECOND MEMBER of the class, and the reason it exists as its own table.
 *
 * ⚠️ THIS IS NOT A COPY OF THE CREATE-WITH-KEY TABLE, IT IS THE OTHER HALF OF A
 * CLASS FIX. `KEY_INVALID_FORMAT` bucketed twelve causes at BOTH wizard connect
 * routes, and a delivery that split only the famous one would leave a real user
 * — anyone adding a second key to a composite — reading the identical lie. The
 * per-guard cases are duplicated on purpose so a one-route fix cannot pass as
 * the class, exactly as this file's Sentry block is duplicated for the same
 * reason (see its header).
 *
 * ⚠️ THE mt5 ROW IS UI-UNREACHABLE FROM THIS SURFACE and is tested at ROUTE
 * level only. `MultiKeyConnectStep.tsx` carries NO MT5 card — its only `mt5`
 * mentions are two error-code strings — so no click path reaches this guard.
 * It is split for class-consistency and is covered here as a ROUTE contract; no
 * claim is made that a UI test exercises it.
 *
 * Counts, error strings and the byte-identity rule are as documented on the
 * create-with-key twin: 12 emitting guards (a raw grep says 14 and counts two
 * comment mentions), only the `code` literal moved.
 */
describe("[142.2-07 / MT5-04] composite/add-key — all 12 rejection sites, honest codes", () => {
  const LONG = "x".repeat(513);

  beforeEach(resetHappyMocks);
  beforeEach(() => {
    delete process.env.SFOX_ENABLED;
    delete process.env.MT5_ENABLED;
  });

  afterEach(() => {
    delete process.env.SFOX_ENABLED;
    delete process.env.MT5_ENABLED;
  });

  /**
   * HAND-TYPED, one row per emitting guard, in source order. Not generated from
   * the route, and not imported from the create-with-key spec: two hand-typed
   * tables that agree are evidence the routes are in lockstep; one shared table
   * would only be evidence that a constant equals itself.
   */
  const SITES: ReadonlyArray<{
    guard: string;
    body: unknown;
    env?: Record<string, string>;
    code: string;
    error: string;
  }> = [
    {
      guard: "body is not an object",
      body: null,
      code: "KEY_MISSING_REQUIRED_FIELD",
      error: "Invalid request body",
    },
    {
      guard: "exchange is not one we support",
      body: { ...VALID_BODY, exchange: "notanexchange" },
      code: "KEY_UNSUPPORTED_VENUE",
      error: "Unsupported exchange",
    },
    {
      guard: "api_key absent",
      body: {
        exchange: "binance",
        api_secret: "ccxt-secret-enough",
        wizard_session_id: WIZARD_SESSION_ID,
      },
      code: "KEY_MISSING_REQUIRED_FIELD",
      error: "api_key is required",
    },
    {
      guard: "sfox venue switch is off",
      body: {
        exchange: "sfox",
        api_key: "sfox-bearer-token-value",
        wizard_session_id: WIZARD_SESSION_ID,
      },
      code: "KEY_VENUE_NOT_ENABLED",
      error: "sFOX integration is not yet available.",
    },
    {
      // UI-UNREACHABLE from this surface (MultiKeyConnectStep has no MT5 card)
      // AND unreachable in production since MT5-01. Covered as a ROUTE contract
      // so the two routes cannot drift; NOT claimed as UI coverage.
      guard: "mt5 venue switch is off (route-level only — no MT5 card here)",
      body: {
        exchange: "mt5",
        api_key: "500123456",
        api_secret: "investor-password-123",
        passphrase: "MetaQuotes-Demo",
        wizard_session_id: WIZARD_SESSION_ID,
      },
      code: "KEY_VENUE_NOT_ENABLED",
      error: "MT5 integration is not yet available.",
    },
    {
      guard: "mt5 investor password absent (route-level only)",
      body: {
        exchange: "mt5",
        api_key: "500123456",
        passphrase: "MetaQuotes-Demo",
        wizard_session_id: WIZARD_SESSION_ID,
      },
      env: { MT5_ENABLED: "true" },
      code: "KEY_MISSING_REQUIRED_FIELD",
      error: "api_secret is required",
    },
    {
      // ⭐ THE ONE GENUINE FORMAT FAILURE on this route too.
      guard: "ccxt api_secret shorter than 8 — THE format failure",
      body: {
        exchange: "binance",
        api_key: "ccxt-key-with-enough-chars",
        api_secret: "short77",
        wizard_session_id: WIZARD_SESSION_ID,
      },
      code: "KEY_INVALID_FORMAT",
      error: "api_secret is required",
    },
    {
      guard: "OKX passphrase absent",
      body: {
        exchange: "okx",
        api_key: "okx-key-with-enough-chars",
        api_secret: "okx-secret-with-enough-chars",
        wizard_session_id: WIZARD_SESSION_ID,
      },
      code: "KEY_MISSING_REQUIRED_FIELD",
      error: "OKX requires a passphrase",
    },
    {
      guard: "wizard_session_id is not a uuid",
      body: { ...VALID_BODY, wizard_session_id: "not-a-uuid" },
      code: "KEY_MISSING_REQUIRED_FIELD",
      error: "wizard_session_id required",
    },
    {
      guard: "api_secret over the 512 cap",
      body: { ...VALID_BODY, api_secret: LONG },
      code: "KEY_INPUT_TOO_LONG",
      error: "Key or secret too long",
    },
    {
      guard: "passphrase over the 512 cap",
      body: { ...VALID_BODY, passphrase: LONG },
      code: "KEY_INPUT_TOO_LONG",
      error: "Passphrase too long",
    },
    {
      guard: "label over the 100 cap",
      body: { ...VALID_BODY, label: "L".repeat(101) },
      code: "KEY_INPUT_TOO_LONG",
      error: "Label too long",
    },
  ];

  it("the table covers every emitting guard — hand-typed count, not a derivation", () => {
    expect(SITES.length).toBe(12);
  });

  it.each(SITES)("$guard -> 400 $code", async ({ body, env, code, error }) => {
    for (const [k, v] of Object.entries(env ?? {})) process.env[k] = v;

    const POST = await importPost();
    const res = await POST(makeReq(body));

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.code).toBe(code);
    // The error string is the PRE-SPLIT one, verbatim. Only the code moved.
    expect(json.error).toBe(error);
    expect(validateKeyMock).not.toHaveBeenCalled();
    expect(encryptKeyMock).not.toHaveBeenCalled();
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("KEY_INVALID_FORMAT is left on exactly ONE guard — the negative pin", () => {
    const formatRows = SITES.filter((s) => s.code === "KEY_INVALID_FORMAT");
    expect(formatRows.map((s) => s.guard)).toEqual([
      "ccxt api_secret shorter than 8 — THE format failure",
    ]);
  });

  it("the split is real — five distinct codes where there used to be one", () => {
    const distinct = new Set(SITES.map((s) => s.code));
    expect([...distinct].sort()).toEqual([
      "KEY_INPUT_TOO_LONG",
      "KEY_INVALID_FORMAT",
      "KEY_MISSING_REQUIRED_FIELD",
      "KEY_UNSUPPORTED_VENUE",
      "KEY_VENUE_NOT_ENABLED",
    ]);
  });
});
