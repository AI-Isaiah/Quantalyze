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

// ─────────────────────────────────────────────────────────────────────────────
// ⭐ PHASE 156 / CONNECT-02 — WHICH CLIENT REACHED THE RPC, RECORDED PER CALL.
//
// ⛔ PORTED VERBATIM IN SHAPE FROM `create-with-key/route.test.ts`, AND THAT IS
// THE POINT. `composite/add-key/route.ts:42-67` declares this route a
// STRUCTURAL MIRROR of its sibling "with exactly three intentional divergences"
// and states that everything not on that list mirrors the sibling verbatim. The
// service-role writer is not on that list, so the contract lands identically
// here — a plan 04 that fixed only the famous single-key route would otherwise
// ship the instance and leave the class, which is the defect Phase 156 exists
// to end.
//
// `add_wizard_composite_key` becomes a SERVICE-ROLE writer: `authenticated`
// loses EXECUTE and the route must reach it through `createAdminClient()`.
// `rpcMock` alone cannot see that change — it answers the same verdict
// whichever client dialled it — so `rpcCallSites` is the discriminator.
//
// ⚠️ WHY `userScopedRpc` DELEGATES BY DEFAULT INSTEAD OF THROWING ON SIGHT: a
// user-scoped `rpc` that threw unconditionally would red every pre-existing
// case in this file for the width of the RED window between plan 02 and plan
// 04 — the same noise G11 warns about, pointed the other way. The throw is
// ARMED by the one case whose subject it is; the discrimination does not depend
// on it, because `rpcCallSites` records the wrong client either way.
// ─────────────────────────────────────────────────────────────────────────────
const rpcCallSites: Array<"admin" | "user-scoped"> = [];
const userScopedRpcIsFatal = { value: false };

/** The USER-SCOPED `.rpc` — the client Phase 156 forbids for this write. */
function userScopedRpc(...args: unknown[]) {
  rpcCallSites.push("user-scoped");
  if (userScopedRpcIsFatal.value) {
    throw new Error(
      "Phase 156 / CONNECT-02: add_wizard_composite_key was reached through " +
        "the USER-SCOPED supabase client (@/lib/supabase/server). It is a " +
        "service-role writer and must be reached through createAdminClient() " +
        "(@/lib/supabase/admin) only.",
    );
  }
  return rpcMock(...args);
}

/** The SERVICE-ROLE `.rpc` — the only sanctioned writer after Phase 156. */
function adminRpc(...args: unknown[]) {
  rpcCallSites.push("admin");
  return rpcMock(...args);
}

vi.mock("@/lib/supabase/server", () => ({
  // ⛔ THE SENTENCE THAT USED TO BE HERE — "the composite add-key route calls
  // ONLY supabase.rpc" — STOPS BEING TRUE OF THIS CLIENT with Phase 156. The
  // route still makes exactly one supabase call and still makes no app-layer
  // draft SELECT (divergence (1)) and no asset_class force-derive UPDATE
  // (divergence (3)); what changes is the door. `.rpc` below is the WRONG one
  // and exists only to catch a route that still uses it — the user-scoped
  // fallback CONNECT-02 closes. The claim now belongs to the ADMIN client mock.
  createClient: async () => ({
    rpc: (...args: unknown[]) => userScopedRpc(...args),
  }),
}));

/**
 * ⭐ PHASE 156 / G11 — THE ADMIN MOCK THIS FILE HAS NEVER HAD.
 *
 * Until now nothing in this file mocked `@/lib/supabase/admin`, because the
 * composite route never touched it. The moment plan 04 makes the route call
 * `createAdminClient()`, the REAL factory runs, finds no
 * `SUPABASE_SERVICE_ROLE_KEY` in a unit-test process, and throws — reddening
 * EVERY case in this file for a reason that has nothing to do with what any of
 * them assert, drowning the real signal (G11 / Pitfall 6). The mock lands here,
 * in the same wave as the assertions, so that never happens.
 *
 * `adminClientThrows` drives the missing-service-key case, which after 156 must
 * answer 503 SEAM_MISCONFIGURED with NOTHING submitted — ⛔ never a silent
 * fallback onto the user-scoped client, which would re-open the door this phase
 * closes and make every gate in it pass vacuously.
 *
 * ⚠️ NO `from` ON THE RETURNED OBJECT, and the omission is the sibling's listed
 * divergence (1) rather than a drift: the single-key twin's admin mock also
 * serves the venue-identity fence's `from(...).select(...)`, and this route has
 * no app-layer SELECT to serve. ⚠️ NOT `importActual`-extended, for the same
 * reason as the sibling: `createAdminClient` is the module's only export and
 * its whole body opens a live service-role connection from two env vars — there
 * is no pure helper to preserve and nothing to drift against.
 */
const adminClientThrows = { value: false };
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    if (adminClientThrows.value) {
      throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY for admin operations");
    }
    return {
      rpc: (...args: unknown[]) => adminRpc(...args),
    };
  },
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

  it("170.1.2 WR-04: a blank label is stored with the venue display name, never the lowercase code", async () => {
    const POST = await importPost();
    const res = await POST(makeReq({ ...VALID_BODY, label: "   " }));

    expect(res.status).toBe(200);
    const [, rpcArgs] = rpcMock.mock.calls[0];
    expect((rpcArgs as Record<string, unknown>).p_label).toBe("OKX key");
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
    // MT5 cannot be a composite member (Phase 213 decision (c): this route
    // refuses `mt5` with COMPOSITE_MT5_UNSUPPORTED ahead of every write) — so this
    // cannot fire today. If it ever
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

  // 167.1.2 D-04 — the composite path stays EXEMPT by construction, measured in
  // 167.1.2-CONTEXT.md (D-04: two live composite members CAN sit on one venue
  // account over disjoint windows, i.e. a key rotation inside a composite). Now
  // that `/api/validate-key` returns a ccxt `venue_account_id`, this pins that
  // the composite RPC is still handed NO identity, so the venue-identity index
  // cannot refuse a member add, and that its 23505 arm is unchanged.
  it("[167.1.2 D-04] a validation carrying a venue_account_id still passes NO identity to add_wizard_composite_key", async () => {
    validateKeyMock.mockResolvedValue({
      valid: true,
      read_only: true,
      venue_account_id: "100000001",
    });

    const POST = await importPost();
    const res = await POST(makeReq(VALID_BODY));

    expect(res.status).toBe(200);
    const [rpcName, rpcArgs] = rpcMock.mock.calls[0];
    expect(rpcName).toBe("add_wizard_composite_key");
    expect(rpcArgs as Record<string, unknown>).not.toHaveProperty("p_venue_account_id");
    expect(JSON.stringify(rpcArgs)).not.toContain("100000001");
  });

  it("[167.1.2 D-04] the venue-identity 23505 still takes the unreachable arm when the validation carried an id", async () => {
    validateKeyMock.mockResolvedValue({
      valid: true,
      read_only: true,
      venue_account_id: "100000001",
    });
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
    expect(capture.options.tags?.step).toBe("draft-rpc-venue-identity-unreachable");
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
    //
    // ⚠️ 164.2-05 / criterion 4 — INVERTED PIN. The code was `KEY_RATE_LIMIT`,
    // and the route's own comment recorded the debt in as many words: "its copy
    // calls the throttle 'exchange-side'. That sentence is FALSE for our own
    // limiter and honestly rewording it is plan 140.4-12's change, not this
    // one." 140.4-12 never made it; this plan pays the debt. The bucket is
    // keyed `strategies-composite-add-key:<uid>` — ours, per USER — so no
    // exchange is involved and `KEY_RATE_LIMIT`'s "try a different exchange
    // account" is a remedy that cannot work. `RATE_LIMITED` already said "the
    // cap is ours, not your exchange's".
    //
    // ⛔ The KEY ORDER, `Retry-After` and `Cache-Control` are all unchanged.
    // Only the token moved, and the byte-wise assertion is what proves that.
    expect(await res.clone().text()).toBe(
      '{"code":"RATE_LIMITED","error":"Too many requests"}',
    );
    expect(await res.json()).toEqual({
      code: "RATE_LIMITED",
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
    // ⚠️ 164.2-05 — THE HISTORICAL PIN ABOVE IS KEPT AND A LIVE ONE ADDED
    // BESIDE IT, because this plan made the old one satisfiable by a code the
    // route can no longer produce. Once `add-key` stopped emitting
    // `KEY_RATE_LIMIT` from its own source, `not.toBe("KEY_RATE_LIMIT")` became
    // a test that cannot fail — vacuous, and indistinguishable from a guard.
    // Deleting it would lose the record of what this case was written to
    // defend, so it stays as the historical pin and the assertion below carries
    // the claim forward onto the code the throttled arm NOW answers.
    expect(
      body.code,
      "a limiter whose STORE is unreachable answered `RATE_LIMITED` — our own " +
        "cap. The user did not hit any cap: nothing was counted, because the " +
        "counter is down. Telling them to wait and retry is a remedy for a " +
        "state they are not in, and it hides the outage from the canary " +
        "exactly as the exchange-blaming code used to.",
    ).not.toBe("RATE_LIMITED");
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
 * Phase 135 (MT5SRC-03) — mt5 on the multi-key path. SUPERSEDED 2026-11-14 by
 * Phase 213 decision (c): "MT5 cannot be a composite member". The three cases
 * that asserted an mt5 add was ACCEPTED are INVERTED in place below, each renamed
 * "superseded by Phase 213 decision (c)", never deleted: the same three request
 * shapes now prove the refusal. The unsupported-exchange case is untouched.
 *
 * ⚠️ MT5_ENABLED stays "true" here on purpose. This is the go-live state the old
 * acceptance cases ran in, and the point of decision (c) is that the answer is
 * the same with the flag on. The flag-off half lives in the block after this one.
 */
describe("POST /api/strategies/composite/add-key — mt5 acceptance (MT5SRC-03), superseded by Phase 213 decision (c)", () => {
  beforeEach(resetHappyMocks);
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

  function expectRefusedBeforeAnyWork() {
    expect(checkLimitMock).not.toHaveBeenCalled();
    expect(validateKeyMock).not.toHaveBeenCalled();
    expect(encryptKeyMock).not.toHaveBeenCalled();
    expect(rpcMock).not.toHaveBeenCalled();
  }

  it("refuses exchange=mt5 with COMPOSITE_MT5_UNSUPPORTED and mints no key (superseded by Phase 213 decision (c): was 'accepts exchange=mt5')", async () => {
    const POST = await importPost();
    const res = await POST(makeReq(MT5_BODY));

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.code).toBe("COMPOSITE_MT5_UNSUPPORTED");
    expectRefusedBeforeAnyWork();
  });

  it("refuses an mt5 add with NO api_secret as COMPOSITE_MT5_UNSUPPORTED, not a missing-field 400 (superseded by Phase 213 decision (c): was 'flows the api_secret-REQUIRED path')", async () => {
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
    // The refusal is about the VENUE, so it must win over the shape guards: a
    // user fixing the "missing field" this used to report would then hit the
    // refusal on the next try.
    expect(json.code).toBe("COMPOSITE_MT5_UNSUPPORTED");
    expectRefusedBeforeAnyWork();
  });

  it("refuses a SHORT (<8) mt5 login the same way (superseded by Phase 213 decision (c): was 'accepts a SHORT mt5 login')", async () => {
    const POST = await importPost();
    const res = await POST(makeReq({ ...MT5_BODY, api_key: "500123" }));

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.code).toBe("COMPOSITE_MT5_UNSUPPORTED");
    expectRefusedBeforeAnyWork();
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
 * Phase 135 (MT5SRC-03) — STRUCTURAL server gate. SUPERSEDED 2026-11-14 by Phase
 * 213 decision (c): with the flag OFF an mt5 add is now refused as
 * COMPOSITE_MT5_UNSUPPORTED, ahead of the gate, rather than KEY_VENUE_NOT_ENABLED.
 * The gate itself is KEPT in the route as a tripwire (see its comment) and is
 * unreachable, so this block pins the answer that replaced it in BOTH flag states:
 * the refusal must not depend on `MT5_ENABLED`, which is what would make the
 * moved-below-the-gate neuter RED here.
 */
describe("POST /api/strategies/composite/add-key — mt5 server gate (MT5_ENABLED off), superseded by Phase 213 decision (c)", () => {
  beforeEach(resetHappyMocks);
  afterEach(() => {
    delete process.env.MT5_ENABLED;
  });

  const MT5_FLAG_BODY = (exchange: string) => ({
    exchange,
    api_key: "500123456",
    api_secret: "investor-password-123",
    passphrase: "MetaQuotes-Demo",
    label: "mt5 composite key",
    wizard_session_id: WIZARD_SESSION_ID,
  });

  it.each(["mt5", "MT5", "Mt5"])(
    "refuses %s with MT5_ENABLED OFF as COMPOSITE_MT5_UNSUPPORTED, not the venue-flag code (superseded by Phase 213 decision (c): was 400 not-available)",
    async (exchange) => {
      delete process.env.MT5_ENABLED;
      const POST = await importPost();
      const res = await POST(makeReq(MT5_FLAG_BODY(exchange)));

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.code).toBe("COMPOSITE_MT5_UNSUPPORTED");
      expect(json.error).not.toBe("MT5 integration is not yet available.");
      expect(checkLimitMock).not.toHaveBeenCalled();
      expect(validateKeyMock).not.toHaveBeenCalled();
      expect(encryptKeyMock).not.toHaveBeenCalled();
      expect(rpcMock).not.toHaveBeenCalled();
    },
  );

  it.each(["mt5", "MT5", "Mt5"])(
    "refuses %s with MT5_ENABLED ON the same way (Phase 213 decision (c): the answer does not depend on the flag)",
    async (exchange) => {
      process.env.MT5_ENABLED = "true";
      const POST = await importPost();
      const res = await POST(makeReq(MT5_FLAG_BODY(exchange)));

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.code).toBe("COMPOSITE_MT5_UNSUPPORTED");
      expect(checkLimitMock).not.toHaveBeenCalled();
      expect(validateKeyMock).not.toHaveBeenCalled();
      expect(encryptKeyMock).not.toHaveBeenCalled();
      expect(rpcMock).not.toHaveBeenCalled();
    },
  );

  it("does NOT gate ccxt — binance runs normally with MT5_ENABLED unset", async () => {
    delete process.env.MT5_ENABLED;
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
        "nothing was captured — OUR_DEFECT_KEY_ERROR_CODES is the whole population this route reports, and it is the only place an our-defect key-connect failure is ever reported",
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

  /**
   * [153.7-03 / WIZFORM-02-CLASS] the mt5-gateway family, ON THIS ROUTE — the
   * TWIN of the case at the same arm in `create-with-key/route.test.ts`.
   *
   * ⚠️ THE TWIN IS THE POINT, and it is deliberately not "covered" by the other
   * file. The verdict is ONE row in shared `wizardErrors.ts`, so it reached
   * both routes at once and there was no one-route half-fix to catch. What a
   * shared-table test cannot see is a future ROUTE-LOCAL change that re-opens
   * the path here alone — and this catch block names the live example itself:
   * pre-stringifying the caught value before classification sends a breaker
   * trip to the terminal UNKNOWN/500 instead of the retryable 503. Fixing one
   * path of a byte-identical pair is this milestone's most repeated mistake, so
   * the alarm is installed on both.
   *
   * ⛔ The assertions are byte-identical to the twin's on purpose. A divergence
   * here would mean the two routes had stopped answering the same wire code the
   * same way, which is the fact worth failing on.
   */
  it("[153.7-03] MT5_GATEWAY_UNREACHABLE renders SERVICE_UNREACHABLE/503, and is NOT captured as unclassified", async () => {
    validateKeyMock.mockRejectedValue(
      Object.assign(
        new Error("The MetaTrader gateway is not responding. Try again shortly."),
        {
          name: "AnalyticsUpstreamError",
          status: 503,
          seamCode: "MT5_GATEWAY_UNREACHABLE",
          dependency: "mt5-gateway",
        },
      ),
    );

    const POST = await importPost();
    const res = await POST(makeReq(VALID_BODY));

    expect(res.status).toBe(503);
    const json = await res.json();
    expect(json.code).toBe("SERVICE_UNREACHABLE");
    expect(json.code).not.toBe("UNKNOWN");
    // ⛔ NOT `SERVICE_UNAVAILABLE_RETRY` — its "nothing was submitted" is
    // knowable for a breaker that DECLINED to send and false-by-construction
    // for a socket connect that WAS attempted and never answered.
    expect(json.code).not.toBe("SERVICE_UNAVAILABLE_RETRY");
    expect(encryptKeyMock).not.toHaveBeenCalled();
    expect(rpcMock).not.toHaveBeenCalled();
    // ⚠️ "Classified" is no longer the predicate for silence — see the
    // OUR-DEFECT twin below, which is the other half of this pair.
    await expectNoCapture();
  });

  /**
   * ⭐ 212-04 / SC3 — a BARE upstream 401/403 (our own service key refused, no
   * seam envelope, `seamCode` null) answers SEAM_MISCONFIGURED/500 on this
   * route too, the twin of `create-with-key/route.bare-401.test.ts`. Before this
   * the classifier's cascade ended in UNKNOWN for it while
   * `validate-and-encrypt` alone read the status. 212 review WR-04: this answer
   * IS captured. SEAM_MISCONFIGURED is a member of `OUR_DEFECT_KEY_ERROR_CODES`,
   * because a stale service key or internal token must keep paging now that its
   * verdict no longer lands on the paged terminal UNKNOWN.
   */
  it.each([401, 403])(
    "[212-04] a bare upstream %i answers SEAM_MISCONFIGURED/500, writes nothing, and IS captured (212 WR-04)",
    async (upstreamStatus) => {
      validateKeyMock.mockRejectedValue(
        Object.assign(new Error("Unauthorized"), {
          name: "AnalyticsUpstreamError",
          status: upstreamStatus,
          seamCode: null,
        }),
      );

      const POST = await importPost();
      const res = await POST(makeReq(VALID_BODY));

      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.code).toBe("SEAM_MISCONFIGURED");
      expect(json.code).not.toBe("UNKNOWN");
      expect(encryptKeyMock).not.toHaveBeenCalled();
      expect(rpcMock).not.toHaveBeenCalled();
      const { options } = await nextCapture();
      expect(options.tags?.surface).toBe("strategies-composite-add-key");
      expect(options.tags?.step).toBe("unclassified-key-error");
    },
  );

  /**
   * ⭐ 153.7 review WR-02, ON THIS ROUTE — the TWIN of the case at the same arm
   * in `create-with-key/route.test.ts`, and duplicated for the same reason every
   * other pair in these two files is: the predicate lives in ONE shared set, but
   * only a test that runs THIS handler can see a route-local re-narrowing of it.
   *
   * `INTERNAL` is `validate_key_permissions`' bare `except Exception` escape.
   * 153.7-02 gave it a verdict row — right for the user — and silently moved it
   * out of the `code === "UNKNOWN"` capture arm, which is wrong for us. It pages
   * again, and it must keep paging on BOTH key routes.
   */
  it("[WR-02] an INTERNAL seam fault renders SEAM_INTERNAL_FAULT/500 AND IS STILL captured — it is our defect", async () => {
    validateKeyMock.mockRejectedValue(
      Object.assign(
        new Error(
          "Something went wrong on our side while checking this key. Nothing is wrong with your key.",
        ),
        {
          name: "AnalyticsUpstreamError",
          status: 500,
          seamCode: "INTERNAL",
        },
      ),
    );

    const POST = await importPost();
    const res = await POST(makeReq(VALID_BODY));

    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.code).toBe("SEAM_INTERNAL_FAULT");
    expect(json.code).not.toBe("UNKNOWN");
    expect(encryptKeyMock).not.toHaveBeenCalled();
    expect(rpcMock).not.toHaveBeenCalled();

    const { err, options } = await nextCapture();
    expect(options.tags?.surface).toBe("strategies-composite-add-key");
    expect(options.tags?.step).toBe("unclassified-key-error");
    expect(options.extra?.exchange).toBe("okx");
    expect(err).toBeInstanceOf(Error);
  });
  /**
   * 164.6.5 review round 1 / WR-06 + SFH-08. A wedged gateway terminal is the
   * SHARED terminal every MT5 client validates against, and its card tells the
   * user "tell us" — so it must reach an operator. Before this row the
   * recognised verdict was outside `OUR_DEFECT_KEY_ERROR_CODES` and this route
   * paged nobody, the same silence WR-02 above removed for `INTERNAL`.
   * The mock carries what the seam throws: the wire code on `seamCode`.
   */
  it("[164.6.5 WR-06] a wedged MT5 terminal renders KEY_MT5_TERMINAL_UNRESPONSIVE/500 AND IS captured — it is our terminal", async () => {
    validateKeyMock.mockRejectedValue(
      Object.assign(
        new Error("The MetaTrader terminal we use to check this key is not answering."),
        {
          name: "AnalyticsUpstreamError",
          status: 500,
          seamCode: "MT5_TERMINAL_UNRESPONSIVE",
          dependency: "mt5-gateway",
        },
      ),
    );

    const POST = await importPost();
    const res = await POST(makeReq(VALID_BODY));

    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.code).toBe("KEY_MT5_TERMINAL_UNRESPONSIVE");
    expect(encryptKeyMock).not.toHaveBeenCalled();
    expect(rpcMock).not.toHaveBeenCalled();

    const { options } = await nextCapture();
    expect(options.tags?.surface).toBe("strategies-composite-add-key");
    expect(options.tags?.step).toBe("unclassified-key-error");
  });

  /**
   * 164.6.6.3.2 D-07 — the add-key twin of the create-with-key case. An unset
   * validation gateway is our operator configuration and must page from EVERY
   * key route; removing the wizard code from `OUR_DEFECT_KEY_ERROR_CODES` leaves
   * `src/lib` green, so this route test is the gate for this route.
   */
  it("[164.6.6.3.2 D-07] an unconfigured validation gateway renders KEY_MT5_VALIDATION_UNCONFIGURED/500 AND IS captured", async () => {
    validateKeyMock.mockRejectedValue(
      Object.assign(
        new Error("The MetaTrader validation gateway is not set up."),
        {
          name: "AnalyticsUpstreamError",
          status: 500,
          seamCode: "MT5_VALIDATION_UNCONFIGURED",
          dependency: "mt5-gateway",
        },
      ),
    );

    const POST = await importPost();
    const res = await POST(makeReq(VALID_BODY));

    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.code).toBe("KEY_MT5_VALIDATION_UNCONFIGURED");
    expect(json.code).not.toBe("UNKNOWN");
    expect(encryptKeyMock).not.toHaveBeenCalled();
    expect(rpcMock).not.toHaveBeenCalled();

    const { options } = await nextCapture();
    expect(sentryState.captured).toHaveLength(1);
    expect(options.tags?.surface).toBe("strategies-composite-add-key");
    expect(options.tags?.step).toBe("unclassified-key-error");
  });

  /**
   * 164.6.6.3.2 D-02 — NO-PAGE TWIN. A busy terminal is contention, recoverable
   * in a minute; a genuinely missed scrub pages from its own alert.
   */
  it("[164.6.6.3.2 D-02] a busy MT5 terminal renders KEY_MT5_TERMINAL_BUSY/424 and is NOT captured", async () => {
    validateKeyMock.mockRejectedValue(
      Object.assign(
        new Error("The MetaTrader check is briefly busy."),
        {
          name: "AnalyticsUpstreamError",
          status: 424,
          seamCode: "MT5_TERMINAL_BUSY",
          recoverable: true,
        },
      ),
    );

    const POST = await importPost();
    const res = await POST(makeReq(VALID_BODY));

    expect(res.status).toBe(424);
    const json = await res.json();
    expect(json.code).toBe("KEY_MT5_TERMINAL_BUSY");
    expect(json.code).not.toBe("UNKNOWN");
    expect(encryptKeyMock).not.toHaveBeenCalled();
    expect(rpcMock).not.toHaveBeenCalled();
    await expectNoCapture();
  });

  /**
   * Phase 218 (SELFHEAL) — the BUSY twin's sibling. The owed gate's refusal after an
   * unhealed inline scrub answers `MT5_TERMINAL_NOT_READY`; the Python scrub already pages
   * per cause, so it is not captured here and its copy never claims an alert.
   */
  it("[218] a not-ready MT5 terminal renders KEY_MT5_TERMINAL_NOT_READY/424 and is NOT captured", async () => {
    validateKeyMock.mockRejectedValue(
      Object.assign(
        new Error("Our MetaTrader terminal could not be made ready for this check."),
        {
          name: "AnalyticsUpstreamError",
          status: 424,
          seamCode: "MT5_TERMINAL_NOT_READY",
          recoverable: true,
        },
      ),
    );

    const POST = await importPost();
    const res = await POST(makeReq(VALID_BODY));

    expect(res.status).toBe(424);
    const text = await res.text();
    const json = JSON.parse(text);
    expect(json.code).toBe("KEY_MT5_TERMINAL_NOT_READY");
    expect(json.code).not.toBe("UNKNOWN");
    expect(text).not.toContain("been alerted");
    expect(text.toLowerCase()).not.toContain("busy");
    expect(encryptKeyMock).not.toHaveBeenCalled();
    expect(rpcMock).not.toHaveBeenCalled();
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
describe("[142.2-07 / MT5-04] composite/add-key — all 11 reachable rejection sites (12 until Phase 213 decision (c)), honest codes", () => {
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
      // Phase 213 decision (c) (2026-11-14): ONE row replaces the two MT5 rows
      // that stood here ("mt5 venue switch is off" and "mt5 investor password
      // absent"). Both guards are now UNREACHABLE: the refusal answers every mt5
      // request first, flag on or off, so neither the KEY_VENUE_NOT_ENABLED gate
      // nor the three-credential guard can fire. The source KEEPS both as a
      // tripwire, so the route's emitting-site count (13, pinned in
      // wizardErrors.invariant.test.ts) and this reachable-row count (11) differ
      // BY DESIGN. The flag-on/flag-off proof lives in the mt5 describes above.
      guard: "mt5 is refused as a composite member (Phase 213 decision (c))",
      body: {
        exchange: "mt5",
        api_key: "500123456",
        api_secret: "investor-password-123",
        passphrase: "MetaQuotes-Demo",
        wizard_session_id: WIZARD_SESSION_ID,
      },
      code: "COMPOSITE_MT5_UNSUPPORTED",
      error: "MT5 accounts cannot be part of a multi-key strategy.",
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
    // 12 → 11 (Phase 213 decision (c)): the two unreachable MT5 rows became one.
    expect(SITES.length).toBe(11);
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

  it("the split is real — six distinct codes where there used to be one (five, plus COMPOSITE_MT5_UNSUPPORTED from Phase 213 decision (c))", () => {
    const distinct = new Set(SITES.map((s) => s.code));
    expect([...distinct].sort()).toEqual([
      "COMPOSITE_MT5_UNSUPPORTED",
      "KEY_INPUT_TOO_LONG",
      "KEY_INVALID_FORMAT",
      "KEY_MISSING_REQUIRED_FIELD",
      "KEY_UNSUPPORTED_VENUE",
      "KEY_VENUE_NOT_ENABLED",
    ]);
  });
});

/**
 * ⭐ PHASE 156 / CONNECT-REFACTOR — the post-156 contract of the composite
 * wizard write, written down BEFORE the route implements it (plan 04 owns the
 * route).
 *
 * ⛔ EVERY CASE BELOW IS EXPECTED TO FAIL UNTIL PLAN 04 LANDS, and every one of
 * them is the SAME case as its sibling in `create-with-key/route.test.ts`,
 * differing only in the RPC name and the composite argument names. ⛔ The twin
 * does not get the weaker oracle: both halves of the CONNECT-02 venue binding —
 * the three-way identity assertion AND the literal `"binance"` anchor — land
 * here too. `route.ts:42-67` declares that every behaviour not on its
 * three-item divergence list mirrors the sibling verbatim; the service-role
 * writer is not on that list.
 *
 * ⚠️ WHAT "FAILS FOR THE RIGHT REASON" MEANS HERE. The route ALREADY passes
 * `p_user_id: user.id` and the already-normalised `exchangeNormalized`, so
 * CONNECT-02's and CONNECT-03b's argument claims are true today and cannot red
 * on their own account. What is false today is WHICH CLIENT carries those
 * arguments, so each case asserts the client FIRST, with a named message, and
 * the argument claims behind it.
 *
 * ⚠️ Every name carries the literal token `156` so the intended failures can be
 * grepped out of a failure list rather than inferred from an exit code — a
 * `node_modules`-less worktree exits 1 exactly as a failing test does.
 */
describe("[156 / CONNECT-02 + CONNECT-03] composite/add-key — the service-role writer contract", () => {
  /** A uid the CALLER supplies. It must reach nothing. */
  const ATTACKER_UID = "beefbeef-beef-4eef-8eef-beefbeefbeef";

  /**
   * ⚠️ `binance`, spelled out, and it is load-bearing. See the literal-anchor
   * assertion below for why a body that agrees with itself is not enough.
   */
  const BINANCE_BODY = {
    exchange: "binance",
    api_key: "binance-key-with-enough-chars",
    api_secret: "binance-secret-with-enough-chars",
    label: "156 contract key",
    wizard_session_id: WIZARD_SESSION_ID,
  };

  beforeEach(() => {
    resetHappyMocks();
    adminClientThrows.value = false;
    userScopedRpcIsFatal.value = false;
    rpcCallSites.length = 0;
    sentryState.captured.length = 0;
  });

  afterEach(() => {
    adminClientThrows.value = false;
    userScopedRpcIsFatal.value = false;
    vi.restoreAllMocks();
  });

  it("156 — add_wizard_composite_key is reached through the ADMIN (service-role) client", async () => {
    const POST = await importPost();
    const res = await POST(makeReq(BINANCE_BODY));

    expect(res.status).toBe(200);
    expect(
      rpcCallSites,
      "CONNECT-02: after Phase 156 `authenticated` holds no EXECUTE on " +
        "add_wizard_composite_key, so the ONLY client that can perform this " +
        "write is createAdminClient(). Recorded call sites:",
    ).toEqual(["admin"]);
    const [rpcName] = rpcMock.mock.calls[0];
    expect(rpcName).toBe("add_wizard_composite_key");
  });

  it("156 — the USER-SCOPED client is never the one that reaches it (armed, not inferred)", async () => {
    // ⭐ THE ANTI-VACUITY HALF OF THE CASE ABOVE. Arming the user-scoped double
    // makes the wrong client FATAL rather than merely unrecorded, so a route
    // that kept the fallback cannot answer 200 by accident and be read as
    // rewired. This is `156-VALIDATION.md` SC2 Mutation A's oracle, applied to
    // the twin: re-point the `.rpc` receiver at the user-scoped binding and
    // this case reds.
    const consoleErr = vi.spyOn(console, "error").mockImplementation(() => {});
    userScopedRpcIsFatal.value = true;

    const POST = await importPost();
    const res = await POST(makeReq(BINANCE_BODY));

    expect(
      rpcCallSites.filter((s) => s === "user-scoped"),
      "CONNECT-02: the user-scoped supabase client must never carry this " +
        "write. Every entry below is a call that went through the wrong door.",
    ).toEqual([]);
    expect(res.status).toBe(200);
    consoleErr.mockRestore();
  });

  it('156 — the venue WRITTEN is the venue VALIDATED: three-way identity, anchored on the literal "binance"', async () => {
    const POST = await importPost();
    const res = await POST(makeReq(BINANCE_BODY));

    expect(res.status).toBe(200);
    expect(
      rpcCallSites,
      "CONNECT-02: the venue coupling is only a guarantee if the writer is " +
        "the service-role client — a user-scoped call carries the same three " +
        "values and proves nothing about the door they went through.",
    ).toEqual(["admin"]);

    const [, rpcArgs] = rpcMock.mock.calls[0];
    const pExchange = (rpcArgs as Record<string, unknown>).p_exchange;
    const validatedVenue = validateKeyMock.mock.calls[0][0];
    const encryptedVenue = encryptKeyMock.mock.calls[0][0];

    // (a) IDENTITY — the right oracle for the COUPLING claim, because it holds
    // for every venue and does not have to be re-typed when one is added.
    expect(
      pExchange,
      "CONNECT-02: the value written as p_exchange must be the SAME value the " +
        "server successfully authenticated against.",
    ).toBe(validatedVenue);
    expect(pExchange).toBe(encryptedVenue);

    // (b) LITERAL ANCHOR — ⛔ KEEP BOTH. Identity alone is satisfied by ANY
    // value so long as all three agree, so a normalisation defect that
    // corrupted `exchangeNormalized` BEFORE all three consumers would keep (a)
    // green forever (`156-VALIDATION.md` SC2, Mutation C, which is exactly that
    // mutation). The literal alone would re-introduce the per-venue brittleness
    // (a) exists to avoid. Neither half can see what the other sees.
    expect(
      pExchange,
      "CONNECT-02: the body said binance; a shared corruption that agreed with " +
        "itself would satisfy the identity assertion above and still write the " +
        "wrong venue.",
    ).toBe("binance");
    expect(validatedVenue).toBe("binance");
  });

  it("156 — p_user_id is withAuth's user.id, and NO request-body field can reach it", async () => {
    // ⭐ THIS IS NOW THE SOLE OWNERSHIP BINDING. Phase 156 deletes `auth.uid()`
    // from both RPC bodies (`156-MEASUREMENTS.md` A2: it is NULL under a
    // service-role client, so any surviving check is a permanent silent no-op),
    // and the DB therefore stops comparing p_user_id to anything.
    //
    // ⚠️ THE COMPOSITE IS THE SHARPER HALF OF THIS PAIR.
    // `test_wizard_composite_fence.sql` Part 3b is the ONE cross-user-elevation
    // assertion this repo runs in CI against either wizard RPC, and Phase 156
    // makes it vacuous — it keeps passing on the ROLE gate while the guarantee
    // it names (T-88-03) leaves the database entirely (`156-PATTERNS.md`
    // Finding B). Its honest re-cut points at this case. A stale pointer here
    // is a silent single point of failure.
    const POST = await importPost();
    const res = await POST(
      makeReq({
        ...BINANCE_BODY,
        user_id: ATTACKER_UID,
        p_user_id: ATTACKER_UID,
      }),
    );

    expect(res.status).toBe(200);
    expect(
      rpcCallSites,
      "CONNECT-03b: the ownership binding is only meaningful on the writer " +
        "that actually holds EXECUTE.",
    ).toEqual(["admin"]);

    const [, rpcArgs] = rpcMock.mock.calls[0];
    const args = rpcArgs as Record<string, unknown>;
    expect(
      args.p_user_id,
      "CONNECT-03b: p_user_id must come from withAuth's verified session.",
    ).toBe(MOCK_USER.id);
    expect(args.p_wizard_session_id).toBe(WIZARD_SESSION_ID);
    // ⛔ And the caller's value must not have landed ANYWHERE on the wire — not
    // in a differently-named parameter, not smuggled into the label. Asserted
    // over the whole argument object so a parameter added later is covered
    // without anyone remembering to extend this test.
    expect(
      JSON.stringify(args),
      "CONNECT-03b: a body-supplied uid reached the service-role writer, " +
        "which has BYPASSRLS — this is the elevation T-156-05 names.",
    ).not.toContain(ATTACKER_UID);
  });

  it("156 — a MISSING SUPABASE_SERVICE_ROLE_KEY answers 503 SEAM_MISCONFIGURED and submits NOTHING", async () => {
    // ⛔ NOT a 200, NOT a 500, and NOT a success by any other path. A 200 means
    // a user-scoped fallback survived somewhere.
    //
    // 503 + SEAM_MISCONFIGURED is the code this route ALREADY emits for a
    // server-side misconfiguration (route.ts:258-265, wizardErrors.ts:430 and
    // :2166-2183, ratelimit.ts:325-326). ⛔ No new member is minted into the
    // wizard code union — `EXPECTED_TABLE_SIZE` pins it and PARITY-05's ledger
    // polices it.
    const consoleErr = vi.spyOn(console, "error").mockImplementation(() => {});
    adminClientThrows.value = true;

    const POST = await importPost();
    const res = await POST(makeReq(BINANCE_BODY));

    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.code).toBe("SEAM_MISCONFIGURED");
    expect(
      rpcMock,
      "T-156-07: the copy for SEAM_MISCONFIGURED promises 'nothing was " +
        "submitted and nothing was changed'. That must be literally true.",
    ).not.toHaveBeenCalled();
    expect(rpcCallSites).toEqual([]);
    consoleErr.mockRestore();
  });
});

/**
 * ⭐ 161-06 / WIZERR-05 — THE TWIN RELAY. The mirror image of the
 * `[161-06 / WIZERR-05]` describe in `create-with-key/route.test.ts`.
 *
 * ⚠️ ASSERTED PER ROUTE, ON PURPOSE. WIZERR-05 says "BOTH key-route catches",
 * and the two catches are the single most repeated one-route half-fix in this
 * milestone. An aggregate assertion over the pair — or a test that only
 * exercised the shared helper — would let either route drop its call and stay
 * green. So each case names its route in its title, and the numbers here
 * (15, from `RETRY_AFTER_SECONDS["supabase"]`) deliberately differ from the
 * sibling's (30, mt5-gateway): a cross-wired fixture cannot pass both.
 *
 * `retryAfterSeconds` is duck-typed off the caught value with `typeof`, never
 * `instanceof` — the `@/lib/analytics-client` mock at the top of this file is a
 * bare factory, so the class is `undefined` here and an `instanceof` in the
 * route would throw from inside the catch. These mocks reproduce the real shape
 * the seam now throws.
 */
describe("[161-06 / WIZERR-05] composite/add-key — the Retry-After relay", () => {
  beforeEach(resetHappyMocks);

  /** The seam's 503 as it now arrives, wait included. */
  function seamUnreachable(retryAfterSeconds: number | null) {
    return Object.assign(
      new Error("The MetaTrader gateway is not responding. Try again shortly."),
      {
        name: "AnalyticsUpstreamError",
        status: 503,
        seamCode: "MT5_GATEWAY_UNREACHABLE",
        dependency: "mt5-gateway",
        retryAfterSeconds,
      },
    );
  }

  it("[composite/add-key] a seam 503 carrying a wait relays that exact value", async () => {
    validateKeyMock.mockRejectedValue(seamUnreachable(15));
    const consoleErr = vi.spyOn(console, "error").mockImplementation(() => {});

    const POST = await importPost();
    const res = await POST(makeReq(VALID_BODY));

    // ⚠️ ARM PROOF FIRST — without this the header assertion would go green
    // against a fixture that returned before ever reaching the catch.
    expect(res.status).toBe(503);
    expect((await res.json()).code).toBe("SERVICE_UNREACHABLE");

    expect(
      res.headers.get("Retry-After"),
      "The '+ Add another key' path must relay the upstream's wait exactly as " +
        "the single-key path does. Fixing one route of this pair and not the " +
        "other is the failure this case exists to name.",
    ).toBe("15");
    consoleErr.mockRestore();
  });

  it("[composite/add-key] a seam 503 with NO advertised wait sends NO header (TRAP-3)", async () => {
    validateKeyMock.mockRejectedValue(seamUnreachable(null));
    const consoleErr = vi.spyOn(console, "error").mockImplementation(() => {});

    const POST = await importPost();
    const res = await POST(makeReq(VALID_BODY));

    expect(res.status).toBe(503);
    expect((await res.json()).code).toBe("SERVICE_UNREACHABLE");

    expect(
      res.headers.get("Retry-After"),
      "ABSENT, not empty and not zero — the upstream advertised nothing, so " +
        "this response advertises nothing.",
    ).toBeNull();
    expect(res.headers.get("Retry-After")).not.toBe("0");
    consoleErr.mockRestore();
  });

  it("[composite/add-key] STALENESS: a wait never outlives the response that carried it", async () => {
    // ⭐ THE IDEMPOTENCY/CONCURRENCY QUESTION, MADE CONCRETE. If the relayed
    // value were held anywhere outside the caught error — a module-level
    // binding, a closure, a memo — the SECOND call would re-advertise the
    // FIRST call's wait. That is a false sentence about how long to wait, and
    // it is worse than no sentence: the user waits on a number that describes
    // an attempt that is already over.
    const consoleErr = vi.spyOn(console, "error").mockImplementation(() => {});
    const POST = await importPost();

    validateKeyMock.mockRejectedValue(seamUnreachable(15));
    const first = await POST(makeReq(VALID_BODY));
    expect(first.headers.get("Retry-After")).toBe("15");

    // Same handler, same process, same module instance — only the upstream's
    // answer changed.
    validateKeyMock.mockRejectedValue(seamUnreachable(null));
    const second = await POST(makeReq(VALID_BODY));

    expect(second.status).toBe(503);
    expect(
      second.headers.get("Retry-After"),
      "The second attempt's upstream advertised nothing. A '15' here would be " +
        "the first attempt's wait riding along on a response it does not " +
        "describe — carried by state this relay must not have.",
    ).toBeNull();
    consoleErr.mockRestore();
  });

  it("[composite/add-key] PRECEDENCE: a breaker trip stamps the breaker's own wait, and exactly one value", async () => {
    // Two failure modes can now advertise a duration and they mean different
    // things: the breaker's cooldown is OURS (nothing was sent), the seam's
    // wait is the UPSTREAM's (something was sent and answered). When the
    // breaker is open no request leaves this process, so its cooldown is the
    // only wait that describes what happens next.
    const { CircuitOpenError } = await import("@/lib/seam-errors");
    const tripped = Object.assign(new CircuitOpenError(42), {
      // A wait from a previous, unrelated upstream failure, deliberately
      // attached to the breaker error to prove the branch cannot double-stamp.
      retryAfterSeconds: 15,
    });
    validateKeyMock.mockRejectedValue(tripped);
    const consoleErr = vi.spyOn(console, "error").mockImplementation(() => {});

    const POST = await importPost();
    const res = await POST(makeReq(VALID_BODY));

    expect((await res.json()).code).toBe("SERVICE_UNAVAILABLE_RETRY");
    expect(res.headers.get("Retry-After")).toBe("42");
    // `Headers.get` comma-joins repeated values, so a comma here IS the
    // double-stamp this shape is built to make impossible.
    expect(res.headers.get("Retry-After")).not.toContain(",");
    expect(res.headers.get("Retry-After")).not.toBe("15");
    consoleErr.mockRestore();
  });

  /**
   * ⭐ 161-REVIEW / WR-01 — the fractional guard, ON THIS ROUTE TOO.
   *
   * This describe's own docblock says why this is not a duplicate: a law about
   * the shared helper cannot see a route that stopped calling it, and "fix one
   * of the pair" is this milestone's most repeated mistake. The fraction here
   * (1.5) deliberately differs from the sibling's (0.5), following this file's
   * standing rule that a cross-wired fixture must not be able to pass both.
   */
  it("[composite/add-key] a FRACTIONAL wait is not a delta-seconds — it is omitted, never relayed", async () => {
    validateKeyMock.mockRejectedValue(seamUnreachable(1.5));
    const consoleErr = vi.spyOn(console, "error").mockImplementation(() => {});

    const POST = await importPost();
    const res = await POST(makeReq(VALID_BODY));

    // ⚠️ ARM PROOF FIRST — the null assertion below is satisfiable by a
    // fixture that never reached the catch.
    expect(res.status).toBe(503);
    expect((await res.json()).code).toBe("SERVICE_UNREACHABLE");

    expect(
      res.headers.get("Retry-After"),
      "`parseRetryAfterSeconds` returns `Number(raw)`, so an intervening " +
        "proxy answering `Retry-After: 1.5` crossed the seam intact and was " +
        "relayed onto our own wire. RFC-9110 delta-seconds is an integer.",
    ).toBeNull();
    expect(res.headers.get("Retry-After")).not.toBe("1.5");
    expect(res.headers.get("Retry-After")).not.toBe("2");
    consoleErr.mockRestore();
  });
});
