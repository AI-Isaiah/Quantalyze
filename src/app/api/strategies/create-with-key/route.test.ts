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

// ─────────────────────────────────────────────────────────────────────────────
// 140.3-13b / SEAMUX-08 — the Sentry capture, tested through the REAL helper.
//
// ⚠️ `@sentry/nextjs` is mocked here and `@/lib/sentry-capture` is DELIBERATELY
// NOT. Mocking the helper would answer "did the call site fire" while making
// every payload assertion VACUOUS about scrubbing — the scrub lives INSIDE the
// helper (SEAMCORE-06), so a mocked helper never runs it and "no secret in the
// payload" would pass with the scrubber deleted. Inherited from `140.3-13a`.
//
// ⚠️ THIS IS ONE OF THE TWO SECRET-BEARING ROUTES. The request body carries the
// caller's RAW exchange `api_key` / `api_secret` / `passphrase`, none of which
// any module-level env list can know. `140.3-13a`'s M78b showed the failure
// mode precisely: with `secrets` omitted, the env-derived token still redacted
// — so an assertion written only against it stayed GREEN — while the raw
// per-request credential went to the third party verbatim. The cases below
// therefore assert against the BODY values, not against an env token.
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

/**
 * 140.4-13 / SEAMRIM-05 — the limiter verdict this file drives the route with.
 * Hoisted so the factory closes over it; default is the ALLOW every pre-existing
 * test was written against, and the SEAMRIM-05 describe restores it.
 */
const limiter = vi.hoisted(() => ({
  result: { success: true } as
    | { success: true }
    | { success: false; retryAfter: number; reason?: "ratelimit_misconfigured" },
}));

// ⚠️ EXTENDED, NOT REPLACED. The pure helpers come from `importActual` so this
// mock cannot drift from the real 503-vs-429 decision — a hand-written double
// that always answered 429 would make this file green on the exact bug the
// plan closes.
vi.mock("@/lib/ratelimit", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/ratelimit")>();
  return {
    userActionLimiter: {},
    checkLimit: vi.fn(async () => limiter.result),
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
// `create_wizard_strategy` becomes a SERVICE-ROLE writer: `authenticated` loses
// EXECUTE and the route must reach it through `createAdminClient()`. `rpcMock`
// alone cannot see that change — it answers the same verdict whichever client
// dialled it, so "the route still uses the user-scoped client" and "the route
// was rewired" are INDISTINGUISHABLE through it and every argument assertion
// below would pass either way. `rpcCallSites` is the discriminator: each `.rpc`
// double stamps its own name before delegating to the shared verdict mock.
//
// ⚠️ WHY `userScopedRpc` DELEGATES BY DEFAULT INSTEAD OF THROWING ON SIGHT.
// A user-scoped `rpc` that threw unconditionally would red ~40 pre-existing
// cases for the width of the RED window (this file lands red on purpose between
// plan 02 and plan 04) — noise that hides the five assertions the window exists
// to observe, which is G11's failure mode pointed the other way. The throw is
// therefore ARMED by the one case whose subject it is (`userScopedRpcIsFatal`),
// and every other case keeps failing or passing for its own original reason.
// The discrimination does not depend on the throw: `rpcCallSites` records the
// wrong client whether or not the arm is live.
// ─────────────────────────────────────────────────────────────────────────────
const rpcCallSites: Array<"admin" | "user-scoped"> = [];
const userScopedRpcIsFatal = { value: false };

/** The USER-SCOPED `.rpc` — the client Phase 156 forbids for this write. */
function userScopedRpc(...args: unknown[]) {
  rpcCallSites.push("user-scoped");
  if (userScopedRpcIsFatal.value) {
    throw new Error(
      "Phase 156 / CONNECT-02: create_wizard_strategy was reached through the " +
        "USER-SCOPED supabase client (@/lib/supabase/server). It is a " +
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

/**
 * 154-06 / WIZCONT-02 — the venue-identity fence's two reads.
 *
 * `venueKeyLookupMock` answers the ADMIN read of `api_keys` by
 * (user_id, exchange, venue_account_id) WHERE disconnected_at IS NULL;
 * `venueStrategyLookupMock` answers the user-scoped `strategies` read by
 * `api_key_id`. Both default to "nothing there", so every pre-existing test
 * keeps exercising the full Railway + RPC flow unchanged.
 */
const venueKeyLookupMock = vi.fn(async () => ({ data: null, error: null }) as {
  data: { id: string } | null;
  error: { code?: string; message?: string } | null;
});
const venueStrategyLookupMock = vi.fn(async () => ({ data: null, error: null }) as {
  data: { id: string } | null;
  error: { code?: string; message?: string } | null;
});
/**
 * 154.1 / WIZCONT-02 review CR — the resolver's SECOND `strategies` read.
 *
 * `venueStrategyLookupMock` above now answers the DRAFT-SCOPED read
 * (`source='wizard'` + `status='draft'`); this one answers the follow-up that
 * runs only when that read found nothing, and whose whole job is to tell "no
 * strategy at all" apart from "a strategy that has left the draft state holds
 * this account".
 *
 * ⚠️ IT DEFAULTS TO NOTHING, which is what keeps every pre-existing case in this
 * file byte-identical: a fence that found no draft still falls through to the
 * RPC exactly as it did before, and the new refusal arm is reachable only from a
 * test that seeds this mock deliberately.
 */
const venueOwnerLookupMock = vi.fn(async () => ({ data: null, error: null }) as {
  data: { id: string; name?: unknown } | null;
  error: { code?: string; message?: string } | null;
});

/** Every `.eq()`/`.is()` filter the route applied, per builder. */
type CapturedFilters = Record<string, unknown>;
const capturedSelects: Array<{ table: string; filters: CapturedFilters }> = [];

/**
 * ⭐ THE CLIENT DOUBLE IS TABLE- AND FILTER-AWARE, and it has to be.
 *
 * The route now issues THREE distinct `select().…maybeSingle()` reads, two of
 * them against `strategies`. A double that ignored the table and the filters —
 * the shape this file used before 154-06 — would answer the session fence's
 * canned row to the venue fence's question, which is precisely the
 * wrong-row-resolution defect these tests exist to catch. Routing on the
 * filters the route ACTUALLY applied is what makes the assertions non-vacuous.
 */
function makeSelectBuilder(table: string) {
  const filters: CapturedFilters = {};
  capturedSelects.push({ table, filters });
  const node = {
    eq: (col: string, val: unknown) => {
      filters[col] = val;
      return node;
    },
    is: (col: string, val: unknown) => {
      filters[col] = val;
      return node;
    },
    order: () => node,
    limit: () => node,
    maybeSingle: () => {
      if (table === "api_keys") return venueKeyLookupMock();
      // `strategies` is read THREE times: the F6 session fence keys on
      // wizard_session_id, and the venue fence issues two reads on api_key_id.
      //
      // ⭐ 154.1 — THE TWO VENUE READS ARE ROUTED BY THE `status` FILTER, which
      // is the very filter this plan added. That coupling is deliberate: delete
      // `.eq("status","draft")` from the route and the draft-scoped read stops
      // being distinguishable here, so the seeded NON-draft row is answered to
      // the question that resolves a resumable draft — and the wedge pin below
      // reds instead of quietly re-labelling itself.
      if ("api_key_id" in filters) {
        return "status" in filters
          ? venueStrategyLookupMock()
          : venueOwnerLookupMock();
      }
      return draftLookupMock();
    },
  };
  return node;
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    // ⛔ PHASE 156 / CONNECT-02 — this `.rpc` is the WRONG DOOR and exists only
    // to be caught using it. `create_wizard_strategy` is a service-role writer;
    // reaching it from here is the user-scoped fallback the phase closes. See
    // the `rpcCallSites` docblock above for why the throw is armed per-case.
    rpc: (...args: unknown[]) => userScopedRpc(...args),
    from: (table: string) => ({
      select: () => makeSelectBuilder(table),
      update: (...args: unknown[]) => assetClassUpdateMock(...args),
    }),
  }),
}));

/**
 * 154-06 — the service-role client the venue fence needs.
 *
 * `api_keys.venue_account_id` is NOT on the column-SELECT allowlist
 * (20260410225608 + its three extensions), and Postgres requires SELECT
 * privilege on every column a query REFERENCES — a WHERE filter included — so
 * the user-scoped client structurally cannot perform this read. Same reason
 * `finalize-wizard/route.ts:1223` reads the sibling `attested_venue` through
 * the admin client.
 *
 * `adminClientThrows` drives the missing-SUPABASE_SERVICE_ROLE_KEY case. ⚠️ FOR
 * THE VENUE-IDENTITY FENCE, and only for it, that must degrade to a dark fence
 * and never to a failed submit — the DB's unique index is still the backstop,
 * so a missing credential is not a reason to fail a submit that would otherwise
 * succeed. That sentence is unchanged and the fence behaviour it describes is
 * still tested (`resolveByVenueIdentity`'s catch arm, route.ts:195-205).
 *
 * ⛔ AND IT IS THE OPPOSITE FOR THE RPC (Phase 156 / CONNECT-03). This mock now
 * serves TWO consumers: the fence's `from(...).select(...)` AND the wizard
 * RPC, because `create_wizard_strategy` becomes a service-role writer that
 * `authenticated` may not call at all. When the service key is absent the RPC
 * cannot be dialled by any client, so the honest answer is 503
 * SEAM_MISCONFIGURED with NOTHING submitted — never a silent fallback onto the
 * user-scoped client, which is precisely the door this phase closes and would
 * make every gate in it pass vacuously.
 *
 * ⚠️ NOT `importActual`-EXTENDED, deliberately, and it is the one place in this
 * file that departs from the extend-don't-replace convention at :83-91. The
 * real `@/lib/supabase/admin` exports exactly one symbol, `createAdminClient`,
 * whose whole body is "read two env vars and open a live service-role
 * connection". There is no pure helper to preserve and nothing to drift
 * against — importActual here would either throw on the missing env or open a
 * real client against a real project from a unit test.
 */
const adminClientThrows = { value: false };
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    if (adminClientThrows.value) {
      throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY for admin operations");
    }
    return {
      rpc: (...args: unknown[]) => adminRpc(...args),
      from: (table: string) => ({ select: () => makeSelectBuilder(table) }),
    };
  },
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

/**
 * 140.4-13 / SEAMRIM-05 — the SHARPEST site in the class.
 *
 * ⚠️ Before this plan a limiter MISCONFIGURATION answered 429 with
 * `code: "KEY_RATE_LIMIT"`, whose copy reads *"a transient, exchange-side
 * throttle and not a problem with your key"*. While Upstash is down that is
 * false for EVERY user on their FIRST click — our outage, blamed on the user's
 * exchange, on the step where they hand us a credential.
 *
 * The 429 half is the anti-regression: a REAL throttle still answers exactly
 * what it answered before, key order included.
 */
describe("[140.4-13 / SEAMRIM-05] POST /api/strategies/create-with-key — the limiter deny arm", () => {
  afterEach(() => {
    limiter.result = { success: true };
    vi.restoreAllMocks();
  });

  it("ratelimit_misconfigured → 503 and NOT the exchange-blaming KEY_RATE_LIMIT", async () => {
    limiter.result = {
      success: false,
      retryAfter: 60,
      reason: "ratelimit_misconfigured",
    };

    const POST = await importPost();
    const res = await POST(makeReq(VALID_BODY));

    expect(res.status).toBe(503);
    const body = await res.json();
    expect(
      body.code,
      "Our own limiter's store being unreachable must not render as the " +
        "user's exchange throttling their key.",
    ).not.toBe("KEY_RATE_LIMIT");
    expect(body.code).toBe("SEAM_MISCONFIGURED");
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect(res.headers.get("Retry-After")).toBe("60");
    expect(validateKeyMock).not.toHaveBeenCalled();
    expect(encryptKeyMock).not.toHaveBeenCalled();
  });

  it("a genuine throttle → 429 with a BYTE-IDENTICAL body and headers", async () => {
    limiter.result = { success: false, retryAfter: 42 };

    const POST = await importPost();
    const res = await POST(makeReq(VALID_BODY));

    expect(res.status).toBe(429);
    // Hand-typed from the pre-adoption source: `{code, error}` in THAT key
    // order, NO_STORE_HEADERS + Retry-After.
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
    expect(validateKeyMock).not.toHaveBeenCalled();
  });

  it("success → the deny arm does not fire", async () => {
    limiter.result = { success: true };
    validateKeyMock.mockResolvedValue({
      valid: true,
      read_only: true,
      permissions: ["read"],
    });

    const POST = await importPost();
    const res = await POST(makeReq(VALID_BODY));

    expect(res.status).not.toBe(429);
    expect(res.status).not.toBe(503);
    expect(validateKeyMock).toHaveBeenCalled();
  });
});

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
    expect(validateKeyMock).toHaveBeenCalledWith("sfox", SFOX_TOKEN, "", undefined, { userId: MOCK_USER.id });
    expect(encryptKeyMock).toHaveBeenCalledWith("sfox", SFOX_TOKEN, "", undefined, { userId: MOCK_USER.id });
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

  // WR-01: mixed-case sfox is handled IDENTICALLY to the validate-and-encrypt
  // allocator route — the carve-out matches case-insensitively AND the value
  // stamped into the RPC (and stored in the DB) is the canonical lowercase 'sfox'.
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
    // 142.2-07 / MT5-04: the CAP is byte-unchanged; only the code it answers
    // moved off the format bucket. A length cap is not a format failure.
    expect((await res.json()).code).toBe("KEY_INPUT_TOO_LONG");
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
    // Acceptance = the go-live state: MT5_ENABLED=true so the server gate (added
    // in this route to mirror validate-and-encrypt + the sfox precedent) lets the
    // connect through. The gate's fail-closed behavior is pinned in the separate
    // "mt5 server gate (MT5_ENABLED off)" block below.
    process.env.MT5_ENABLED = "true";
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
      { userId: MOCK_USER.id },
    );
    const [rpcName, rpcArgs] = rpcMock.mock.calls[0];
    expect(rpcName).toBe("create_wizard_strategy");
    expect((rpcArgs as Record<string, unknown>).p_exchange).toBe("mt5");
  });

  it("stamps asset_class='traditional' for mt5 (√252, MT5RECON-02) — NOT the crypto default", async () => {
    // MT5RECON-02: mt5 is forex/CFD = TRADITIONAL √252. The draft force-derive is
    // now venue-aware (isCryptoExchange(exchange) ? 'crypto' : 'traditional'), so
    // an mt5 draft must NOT inherit the crypto default that every crypto venue
    // gets. WIRING test: a neutered call site (reverting to the unconditional
    // 'crypto' literal) persists 'crypto' here and reddens this. The okx test
    // above pins the crypto venue stays byte-identical ('crypto').
    const POST = await importPost();
    const res = await POST(makeReq(MT5_BODY));

    expect(res.status).toBe(200);
    expect(assetClassUpdateMock).toHaveBeenCalledTimes(1);
    expect(assetClassUpdateMock).toHaveBeenCalledWith({
      asset_class: "traditional",
    });
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
    // 142.2-07 / MT5-04: an ABSENT investor password is a missing field, not a
    // malformed one. The ccxt `<8` arm below keeps KEY_INVALID_FORMAT because
    // that one really is a format judgement.
    expect(json.code).toBe("KEY_MISSING_REQUIRED_FIELD");
    expect(json.error).toBe("api_secret is required");
    expect(validateKeyMock).not.toHaveBeenCalled();
  });

  it("accepts a SHORT (<8) mt5 login — a broker account number is often 5-7 digits (RED-TEAM: mt5 login is NOT ccxt-key-shaped, so the <8 rejection must not apply)", async () => {
    const POST = await importPost();
    const res = await POST(makeReq({ ...MT5_BODY, api_key: "500123" }));

    expect(res.status).toBe(200);
    // The short login flows through to the live probe unchanged — it was NOT
    // wrongly rejected as KEY_INVALID_FORMAT by the ccxt <8 rule.
    expect(validateKeyMock).toHaveBeenCalledWith(
      "mt5",
      "500123",
      "investor-password-123",
      "MetaQuotes-Demo",
      { userId: MOCK_USER.id },
    );
  });

  it("rejects mt5 with a blank broker server/passphrase (three-credential presence, RED-TEAM)", async () => {
    const POST = await importPost();
    const res = await POST(makeReq({ ...MT5_BODY, passphrase: "" }));

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.code).toBe("KEY_MISSING_REQUIRED_FIELD");
    expect(validateKeyMock).not.toHaveBeenCalled();
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

  afterEach(() => {
    delete process.env.MT5_ENABLED;
  });
});

/**
 * Phase 135 (MT5SRC-03) — STRUCTURAL server gate (regression for the ship-review
 * finding). This is the route the wizard ConnectKeyStep actually submits to, so
 * the gate MUST live here — not only on validate-and-encrypt. With MT5_ENABLED
 * unset (the client-on/server-off half-state during a phased flag flip), an mt5
 * connect must FAIL CLOSED with a clean 400 "not yet available" BEFORE any live
 * probe (validateKey), no key saved, no draft. Without the gate the request falls
 * through to the Python /validate-key gate, whose MT5_DISABLED_DETAIL matches no
 * classifyKeyValidationError branch → UNKNOWN → 500. These tests redden if the
 * gate is removed. Mirrors the sfox server-gate block verbatim.
 */
describe("POST /api/strategies/create-with-key — mt5 server gate (MT5_ENABLED off)", () => {
  beforeEach(() => {
    validateKeyMock.mockReset();
    encryptKeyMock.mockReset();
    rpcMock.mockReset();
    draftLookupMock.mockReset();
    draftLookupMock.mockResolvedValue({ data: null, error: null });
    delete process.env.MT5_ENABLED;
    validateKeyMock.mockResolvedValue({ valid: true, read_only: true, permissions: ["read"] });
    encryptKeyMock.mockResolvedValue({ api_key_encrypted: "encrypted-blob-base64" });
    rpcMock.mockResolvedValue({
      data: [{ strategy_id: STRATEGY_ID, api_key_id: API_KEY_ID }],
      error: null,
    });
  });

  it.each(["mt5", "MT5", "Mt5"])(
    "fails closed for %s (400 not-available, no live probe, no key saved)",
    async (exchange) => {
      const POST = await importPost();
      const res = await POST(
        makeReq({
          exchange,
          api_key: "500123456",
          api_secret: "investor-password-123",
          passphrase: "MetaQuotes-Demo",
          label: "mt5 key",
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

  it.each(["1", "TRUE", "yes", " true"])(
    "stays fail-closed for a non-exact MT5_ENABLED=%s (strict === 'true')",
    async (flag) => {
      process.env.MT5_ENABLED = flag;
      const POST = await importPost();
      const res = await POST(
        makeReq({
          exchange: "mt5",
          api_key: "500123456",
          api_secret: "investor-password-123",
          passphrase: "MetaQuotes-Demo",
          label: "mt5 key",
          wizard_session_id: WIZARD_SESSION_ID,
        }),
      );

      expect(res.status).toBe(400);
      expect(validateKeyMock).not.toHaveBeenCalled();
      delete process.env.MT5_ENABLED;
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
 * ═══════════════════════════════════════════════════════════════════════════
 * 154-06 / WIZCONT-02 — ONE FENCE, TWO KEYS.
 *
 * THE DEFECT. The F6 fence above keys on `wizard_session_id`, a localStorage
 * token. Re-connecting the SAME credentials from a context that LOST that token
 * — a different browser, cleared storage, a fresh session — arrives with a NEW
 * session id, misses the fence entirely, and mints a second strategy plus a
 * second encrypted `api_keys` row for credentials we already hold. The block
 * above proves the first key works; every case here is about the second.
 *
 * ⭐ THE ORACLES ARE INVARIANTS, NOT THE IMPLEMENTATION'S OWN VALUES. The
 * expected ids are the ones the FIXTURE put in the database double, hand-typed
 * constants — never a value read back out of the route's response and compared
 * to itself. The "no writes" assertions are call-count assertions on the write
 * doubles, which fail if the dedup path ever learns to write.
 * ═══════════════════════════════════════════════════════════════════════════
 */
describe("[154-06 / WIZCONT-02] create-with-key — the venue-identity fence", () => {
  /** The row that is ALREADY in the database when the user re-connects. */
  const EXISTING_KEY_ID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
  const EXISTING_STRATEGY_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
  /** A DIFFERENT wizard session — the whole point: the token is gone. */
  const OTHER_SESSION_ID = "99999999-8888-4777-8666-555555555555";
  const MT5_LOGIN = "500123456";

  const MT5_RECONNECT_BODY = {
    exchange: "mt5",
    api_key: MT5_LOGIN,
    api_secret: "investor-password-123",
    passphrase: "MetaQuotes-Demo",
    label: "mt5 key",
    wizard_session_id: OTHER_SESSION_ID,
  };

  beforeEach(() => {
    process.env.MT5_ENABLED = "true";
    adminClientThrows.value = false;
    capturedSelects.length = 0;
    sentryState.captured.length = 0;
    validateKeyMock.mockReset();
    encryptKeyMock.mockReset();
    rpcMock.mockReset();
    draftLookupMock.mockReset();
    venueKeyLookupMock.mockReset();
    venueStrategyLookupMock.mockReset();
    venueOwnerLookupMock.mockReset();
    assetClassUpdateMock.mockClear();

    // No draft for THIS session — the token-less re-entry the fence must catch.
    draftLookupMock.mockResolvedValue({ data: null, error: null });
    // Nothing found by venue identity unless a test says otherwise.
    venueKeyLookupMock.mockResolvedValue({ data: null, error: null });
    venueStrategyLookupMock.mockResolvedValue({ data: null, error: null });
    venueOwnerLookupMock.mockResolvedValue({ data: null, error: null });

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
    delete process.env.MT5_ENABLED;
    vi.restoreAllMocks();
  });

  /** The database already holds a LIVE mt5 key for this login, with a strategy. */
  function seedExistingVenueRow() {
    venueKeyLookupMock.mockResolvedValue({
      data: { id: EXISTING_KEY_ID },
      error: null,
    });
    venueStrategyLookupMock.mockResolvedValue({
      data: { id: EXISTING_STRATEGY_ID },
      error: null,
    });
  }

  it("THE BUG: same MT5 login + a DIFFERENT wizard_session_id resolves to the EXISTING row, not a second draft", async () => {
    seedExistingVenueRow();

    const POST = await importPost();
    const res = await POST(makeReq(MT5_RECONNECT_BODY));

    expect(res.status).toBe(200);
    // The ids are the SEEDED ones — the row that was already there.
    expect(await res.json()).toEqual({
      ok: true,
      strategy_id: EXISTING_STRATEGY_ID,
      api_key_id: EXISTING_KEY_ID,
      deduped: true,
    });
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
  });

  it("FAILS TOWARD THE EXISTING ROW: the dedup path issues ZERO writes and never re-encrypts", async () => {
    // ⭐ THE INVARIANT THAT MATTERS MOST. The existing api_keys row carries
    // strategy_keys membership and synced history other strategies depend on,
    // so "resolving" the collision by overwriting it would orphan all of that.
    // Overwriting is also the cheap, plausible implementation — which is
    // exactly why it is pinned by call count rather than by reading the row.
    seedExistingVenueRow();

    const POST = await importPost();
    await POST(makeReq(MT5_RECONNECT_BODY));

    expect(rpcMock).not.toHaveBeenCalled();
    expect(assetClassUpdateMock).not.toHaveBeenCalled();
    // And the fence short-circuits BEFORE the charged seam calls, like the F6
    // fence does — a re-connect must not burn a Railway probe or the venue's
    // validate quota.
    expect(validateKeyMock).not.toHaveBeenCalled();
    expect(encryptKeyMock).not.toHaveBeenCalled();
  });

  it("reads the LIVE row only — the fence filters disconnected_at IS NULL, mirroring the index predicate", async () => {
    // A predicate blind to the lifecycle would hand back a SOFT-DISCONNECTED
    // key, which every cron dispatcher deliberately skips — a strategy that
    // silently never syncs, worse than the duplicate this fence prevents.
    seedExistingVenueRow();

    const POST = await importPost();
    await POST(makeReq(MT5_RECONNECT_BODY));

    const keyRead = capturedSelects.find((s) => s.table === "api_keys");
    expect(keyRead, "the fence must read api_keys").toBeTruthy();
    expect(keyRead!.filters).toEqual({
      user_id: MOCK_USER.id,
      exchange: "mt5",
      venue_account_id: MT5_LOGIN,
      disconnected_at: null,
    });
  });

  it("trims the login so a stray space cannot make the dedup MISS (agrees with the RPC's NULLIF(btrim(…)))", async () => {
    seedExistingVenueRow();

    const POST = await importPost();
    await POST(makeReq({ ...MT5_RECONNECT_BODY, api_key: `  ${MT5_LOGIN}  ` }));

    const keyRead = capturedSelects.find((s) => s.table === "api_keys");
    expect(keyRead!.filters.venue_account_id).toBe(MT5_LOGIN);
  });

  it("threads p_venue_account_id into the RPC when the fence finds nothing (first connect)", async () => {
    const POST = await importPost();
    const res = await POST(makeReq(MT5_RECONNECT_BODY));

    expect(res.status).toBe(200);
    const [, rpcArgs] = rpcMock.mock.calls[0];
    expect((rpcArgs as Record<string, unknown>).p_venue_account_id).toBe(
      MT5_LOGIN,
    );
  });

  it("a first connect is NOT reported as deduped", async () => {
    const POST = await importPost();
    const res = await POST(makeReq(MT5_RECONNECT_BODY));

    // The vacuity fence for every `deduped: true` assertion above: the marker
    // must be ABSENT on the ordinary path, or those assertions prove nothing.
    expect(await res.json()).toEqual({
      ok: true,
      strategy_id: STRATEGY_ID,
      api_key_id: API_KEY_ID,
    });
  });

  it("an ORPHANED key (no strategy hangs off it) falls through to the RPC rather than inventing a pair", async () => {
    venueKeyLookupMock.mockResolvedValue({
      data: { id: EXISTING_KEY_ID },
      error: null,
    });
    venueStrategyLookupMock.mockResolvedValue({ data: null, error: null });

    const POST = await importPost();
    const res = await POST(makeReq(MT5_RECONNECT_BODY));

    expect(res.status).toBe(200);
    expect(rpcMock).toHaveBeenCalledTimes(1);
    const json = await res.json();
    expect(json.deduped).toBeUndefined();
    // ⛔ And it must never pair the orphaned key with an unrelated strategy.
    expect(json.api_key_id).toBe(API_KEY_ID);
  });

  it("a fence READ FAULT falls through to the RPC and never 500s (the DB index still dedups)", async () => {
    const consoleErr = vi.spyOn(console, "error").mockImplementation(() => {});
    venueKeyLookupMock.mockResolvedValue({
      data: null,
      error: { code: "42501", message: "permission denied for table api_keys" },
    });

    const POST = await importPost();
    const res = await POST(makeReq(MT5_RECONNECT_BODY));

    expect(res.status).toBe(200);
    expect(rpcMock).toHaveBeenCalledTimes(1);
    expect(consoleErr).toHaveBeenCalled();
  });

  it("the SECOND read faulting degrades the same way — a live key with an unreadable strategy still submits", async () => {
    // The fence issues TWO reads and only the FIRST one's fault arm was pinned.
    // This is the other one: `api_keys` answered a live row, then the
    // user-scoped `strategies` resolve failed (an RLS blip, a PostgREST 503).
    // The dangerous implementations are both plausible — 500 the submit, or
    // treat the error-as-value's `data: null` as "no strategy" and hand back a
    // half-resolved pair — so the assertions pin the honest third option: log,
    // fall through, let the DB index be the backstop. `deduped` must be ABSENT,
    // because nothing was actually resolved.
    const consoleErr = vi.spyOn(console, "error").mockImplementation(() => {});
    venueKeyLookupMock.mockResolvedValue({
      data: { id: EXISTING_KEY_ID },
      error: null,
    });
    venueStrategyLookupMock.mockResolvedValue({
      data: null,
      error: { code: "42501", message: "permission denied for table strategies" },
    });

    const POST = await importPost();
    const res = await POST(makeReq(MT5_RECONNECT_BODY));

    expect(res.status).toBe(200);
    expect(rpcMock).toHaveBeenCalledTimes(1);
    const json = await res.json();
    expect(json.deduped).toBeUndefined();
    expect(json.strategy_id).toBe(STRATEGY_ID);
    expect(json.api_key_id).toBe(API_KEY_ID);
    // Rule 12 — a dark fence that says nothing is indistinguishable from a
    // fence that found nothing, and only one of those is a bug worth paging on.
    expect(consoleErr).toHaveBeenCalled();
  });

  it("[156 / CONNECT-03] a MISSING service-role credential fails CLOSED on the MT5 path too — 503, nothing submitted", async () => {
    // ⛔ THIS CASE'S EXPECTATION WAS INVERTED BY PHASE 156, and the inversion is
    // the reason plan 02 lands before plan 04. It previously read "degrades to a
    // dark fence, never to a failed submit" and asserted 200 + one RPC call.
    // That was correct while the RPC rode the USER-SCOPED client: the fence
    // needed the service key, the write did not, so a missing key cost only the
    // fence. After 156 the write needs it too — `authenticated` has no EXECUTE —
    // so there is no client left to submit with. Leaving this case as it stood
    // would have made the file GREEN on a route that kept a user-scoped
    // fallback, i.e. green on the bug (Pitfall 5).
    //
    // ⭐ The fence's OWN dark-degradation is unchanged and still tested — by the
    // READ-FAULT cases above (`a fence READ FAULT falls through to the RPC`),
    // which reach the fence with a healthy admin client and a failing SELECT.
    // That is the arm that still describes the fence; this one never did.
    const consoleErr = vi.spyOn(console, "error").mockImplementation(() => {});
    adminClientThrows.value = true;

    const POST = await importPost();
    const res = await POST(makeReq(MT5_RECONNECT_BODY));

    expect(res.status).toBe(503);
    expect((await res.json()).code).toBe("SEAM_MISCONFIGURED");
    expect(rpcMock).not.toHaveBeenCalled();
    expect(consoleErr).toHaveBeenCalled();
  });

  it("NON-MT5 venues leave the arm INERT: no api_keys read, no p_venue_account_id on the wire", async () => {
    // The ccxt adapter's ValidationResult carries no account-identity field, so
    // there is nothing to stamp and the whole arm must be a no-op for them.
    const POST = await importPost();
    const res = await POST(makeReq(VALID_BODY));

    expect(res.status).toBe(200);
    expect(capturedSelects.some((s) => s.table === "api_keys")).toBe(false);
    expect(venueKeyLookupMock).not.toHaveBeenCalled();
    const [, rpcArgs] = rpcMock.mock.calls[0];
    expect(rpcArgs as Record<string, unknown>).not.toHaveProperty(
      "p_venue_account_id",
    );
    expect((await res.json()).deduped).toBeUndefined();
  });

  it("⛔ NO ARM EVER ECHOES THE LOGIN BACK TO THE BROWSER", async () => {
    // T-154-06-C. Asserted across the arms that can carry a body on the MT5
    // path, by stringifying the WHOLE response — a field added later is caught
    // without anyone remembering to extend this test.
    seedExistingVenueRow();
    const POST = await importPost();
    const deduped = await POST(makeReq(MT5_RECONNECT_BODY));
    expect(await deduped.text()).not.toContain(MT5_LOGIN);

    venueKeyLookupMock.mockResolvedValue({ data: null, error: null });
    const created = await POST(makeReq(MT5_RECONNECT_BODY));
    expect(await created.text()).not.toContain(MT5_LOGIN);

    rpcMock.mockResolvedValue({
      data: null,
      error: {
        code: "23505",
        message:
          'duplicate key value violates unique constraint "api_keys_user_exchange_venue_account_uniq"',
        details: `Key (user_id, exchange, venue_account_id)=(x, mt5, ${MT5_LOGIN}) already exists.`,
      },
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const conflicted = await POST(makeReq(MT5_RECONNECT_BODY));
    expect(await conflicted.text()).not.toContain(MT5_LOGIN);
  });

  /**
   * 154.1 / WIZCONT-02 REVIEW CR — THE FENCE MUST NOT RESUME A FINISHED
   * STRATEGY.
   *
   * ⚠️ WHY NOTHING ABOVE CAUGHT THIS. Every case in the parent describe seeds a
   * DRAFT-shaped row: `seedExistingVenueRow` answers the strategy read with an
   * id and says nothing about `source` or `status`, so a resolver reading
   * `strategies` with NO draft filters and a resolver reading it WITH them are
   * indistinguishable to all of them. The shipped resolver had none — it carried
   * only `user_id` + `api_key_id`, ordered OLDEST FIRST — while every sibling
   * reader of a wizard draft carries `source='wizard'` AND `status='draft'`
   * (`strategies/draft/[id]/route.ts` applies both on its preflight and AGAIN on
   * its DELETE, precisely so a status flip cannot clobber a promoted strategy).
   *
   * WHAT THAT COST, END TO END, on the exact flow WIZCONT-02 exists for:
   *   1. connect MT5 login X, finish the wizard → the strategy is
   *      `pending_review` and the key is live with `venue_account_id = X`;
   *   2. re-connect the same account from a context that lost the token;
   *   3. the fence answers `{ok:true, deduped:true}` pointing at the FINALIZED
   *      strategy, and the wizard resumes onto a non-draft;
   *   4. the overlay path then calls `finalize_wizard_strategy`, which RAISES
   *      `invalid_parameter_value` on its `v_current_status <> 'draft'` check →
   *      409, and a refresh re-runs the same dedup, so the user is wedged with
   *      no way forward;
   *   5. the manager path has no draft guard at all → 200, with the metadata the
   *      user just typed silently discarded.
   *
   * Both halves come from ONE missing pair of filters, which is why the pins
   * below are written against the FILTERS and against the arm's OUTCOME rather
   * than against either downstream symptom.
   */
  describe("[154.1] a FINALIZED strategy is not a draft to resume", () => {
    /** The name the user gave the strategy that already holds this account. */
    const EXISTING_STRATEGY_NAME = "Helios Momentum";

    /**
     * The database state the bug needs: a LIVE key for this login, NO wizard
     * draft hanging off it, and a strategy that has moved past `draft`.
     *
     * ⭐ The two strategy reads are seeded SEPARATELY on purpose. The
     * draft-scoped read finding nothing while the unscoped one finds a row IS
     * the situation — seeding one row for both questions would be exactly the
     * conflation that hid the defect.
     */
    function seedFinalizedOwner(name: unknown = EXISTING_STRATEGY_NAME) {
      venueKeyLookupMock.mockResolvedValue({
        data: { id: EXISTING_KEY_ID },
        error: null,
      });
      // `source='wizard' AND status='draft'` matches nothing: the row promoted.
      venueStrategyLookupMock.mockResolvedValue({ data: null, error: null });
      venueOwnerLookupMock.mockResolvedValue({
        data: { id: EXISTING_STRATEGY_ID, name },
        error: null,
      });
    }

    it("THE WEDGE PIN: a pending_review strategy on the live key is NOT returned as deduped", async () => {
      // ⭐ THE ASSERTION THAT MUST RED IF EITHER FILTER IS DELETED. Without
      // `.eq("source","wizard")` / `.eq("status","draft")` the oldest-first read
      // resolves onto this very row and the route answers 200 + `deduped:true`,
      // handing the wizard a non-draft to finalize.
      seedFinalizedOwner();

      const POST = await importPost();
      const res = await POST(makeReq(MT5_RECONNECT_BODY));

      const body = await res.clone().json();
      expect(
        body.deduped,
        "the fence resumed a strategy that has LEFT the draft state — " +
          "finalize then refuses it with a 409 a refresh reproduces exactly",
      ).toBeUndefined();
      expect(body.strategy_id).toBeUndefined();
      expect(res.status).not.toBe(200);
    });

    it("the draft-scoped read carries BOTH filters every sibling draft reader carries", async () => {
      seedFinalizedOwner();

      const POST = await importPost();
      await POST(makeReq(MT5_RECONNECT_BODY));

      const draftScoped = capturedSelects.find(
        (s) => s.table === "strategies" && "status" in s.filters,
      );
      expect(
        draftScoped,
        "no draft-scoped `strategies` read was issued at all — the resolver is " +
          "back to asking 'any strategy on this key?'",
      ).toBeTruthy();
      expect(draftScoped!.filters).toEqual({
        user_id: MOCK_USER.id,
        api_key_id: EXISTING_KEY_ID,
        source: "wizard",
        status: "draft",
      });
    });

    it("answers the HONEST code — never DRAFT_ALREADY_EXISTS, whose every clause is false here", async () => {
      seedFinalizedOwner();

      const POST = await importPost();
      const res = await POST(makeReq(MT5_RECONNECT_BODY));

      expect(res.status).toBe(409);
      const body = await res.json();
      expect(
        body.code,
        '"A wizard session with this key is already in progress" sends the ' +
          "user hunting for a draft that does not exist, and offers to delete " +
          "one that is not there.",
      ).not.toBe("DRAFT_ALREADY_EXISTS");
      expect(body.code).toBe("VENUE_ALREADY_CONNECTED");
      expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    });

    it("names the strategy that is in the way — the user's OWN row, read through RLS", async () => {
      seedFinalizedOwner();

      const POST = await importPost();
      const res = await POST(makeReq(MT5_RECONNECT_BODY));

      // Byte-wise: `toEqual` on parsed JSON does not compare key order, and this
      // body is what `ConnectKeyStep`'s reader and the copy table are pinned
      // against.
      expect(await res.text()).toBe(
        '{"code":"VENUE_ALREADY_CONNECTED","error":"This account is already connected to an existing strategy.","strategy_name":"Helios Momentum"}',
      );
    });

    it("⛔ never echoes the login back, on the refusal arm too", async () => {
      // T-154-06-C extended to the arm this plan adds. Stringify the WHOLE
      // response so a field added later is caught without anyone remembering.
      seedFinalizedOwner();

      const POST = await importPost();
      const res = await POST(makeReq(MT5_RECONNECT_BODY));

      expect(await res.text()).not.toContain(MT5_LOGIN);
    });

    it("a non-string name degrades to NO name rather than a stringified surprise", async () => {
      // `strategies.name` is NOT NULL at the database, so this is about the
      // SHAPE we were handed: a read that drifted must not put `[object Object]`
      // into a sentence the user reads.
      seedFinalizedOwner({ unexpected: "shape" });

      const POST = await importPost();
      const res = await POST(makeReq(MT5_RECONNECT_BODY));

      expect(res.status).toBe(409);
      // OMITTED, not nulled: the wire then carries exactly what a pre-154.1
      // error body carried, and the client's "absence means we were not told"
      // rule is a property of the request rather than of a serializer.
      expect(await res.text()).toBe(
        '{"code":"VENUE_ALREADY_CONNECTED","error":"This account is already connected to an existing strategy."}',
      );
    });

    it("GROUNDS THE COPY'S SERVER-STATE CLAIM: the refusal writes nothing and spends no seam budget", async () => {
      // `VENUE_ALREADY_CONNECTED`'s copy says "Nothing new was created and the
      // existing strategy was left exactly as it was". The copy-honesty guard in
      // `wizardErrors.test.ts` admits a server-state claim only when it is
      // OBSERVABLE, and this is the observation: the arm returns before the RPC,
      // before both charged Railway calls, and before the asset-class write.
      seedFinalizedOwner();

      const POST = await importPost();
      await POST(makeReq(MT5_RECONNECT_BODY));

      expect(rpcMock).not.toHaveBeenCalled();
      expect(assetClassUpdateMock).not.toHaveBeenCalled();
      expect(validateKeyMock).not.toHaveBeenCalled();
      expect(encryptKeyMock).not.toHaveBeenCalled();
    });

    it("ANTI-REGRESSION: a real DRAFT on the same key still dedups — the fence was narrowed, not disabled", async () => {
      // The vacuity fence for the whole block above. If the filters were added
      // in a way that made the draft read match nothing, every assertion here
      // would still pass while WIZCONT-02 itself silently stopped working.
      seedExistingVenueRow();

      const POST = await importPost();
      const res = await POST(makeReq(MT5_RECONNECT_BODY));

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        ok: true,
        strategy_id: EXISTING_STRATEGY_ID,
        api_key_id: EXISTING_KEY_ID,
        deduped: true,
      });
      // And the second read is never even issued: a resumable draft answers the
      // question outright.
      expect(venueOwnerLookupMock).not.toHaveBeenCalled();
    });

    it("an ORPHANED key is still an orphan — 'no strategy at all' must not become a refusal", async () => {
      // The other side of the discrimination this plan adds. Both reads find
      // nothing, so we claim nothing: fall through and let the DB index be the
      // backstop, exactly as before.
      venueKeyLookupMock.mockResolvedValue({
        data: { id: EXISTING_KEY_ID },
        error: null,
      });
      venueStrategyLookupMock.mockResolvedValue({ data: null, error: null });
      venueOwnerLookupMock.mockResolvedValue({ data: null, error: null });

      const POST = await importPost();
      const res = await POST(makeReq(MT5_RECONNECT_BODY));

      expect(res.status).toBe(200);
      expect(rpcMock).toHaveBeenCalledTimes(1);
      expect((await res.json()).deduped).toBeUndefined();
    });

    it("the OWNER read faulting falls through to the RPC — a refusal is never invented from an error", async () => {
      // Rule 12 applied to the new read: an unreadable `strategies` table means
      // we cannot tell an orphan from a finished owner, and refusing on that
      // would 409 a submit that should have succeeded.
      const consoleErr = vi.spyOn(console, "error").mockImplementation(() => {});
      venueKeyLookupMock.mockResolvedValue({
        data: { id: EXISTING_KEY_ID },
        error: null,
      });
      venueStrategyLookupMock.mockResolvedValue({ data: null, error: null });
      venueOwnerLookupMock.mockResolvedValue({
        data: null,
        error: { code: "42501", message: "permission denied for table strategies" },
      });

      const POST = await importPost();
      const res = await POST(makeReq(MT5_RECONNECT_BODY));

      expect(res.status).toBe(200);
      expect(rpcMock).toHaveBeenCalledTimes(1);
      expect((await res.json()).deduped).toBeUndefined();
      expect(consoleErr).toHaveBeenCalled();
    });

    it("THE RACE ARM ANSWERS THE SAME FACT: 23505 + a finalized owner is not DRAFT_ALREADY_EXISTS either", async () => {
      // The 23505 arm re-runs the SAME resolver, so it inherits the
      // discrimination — but "inherits" is a claim about wiring, and wiring is
      // what this pins. Before the fix this path answered the draft-shaped 409
      // for a user whose account is held by a finished strategy.
      vi.spyOn(console, "error").mockImplementation(() => {});
      rpcMock.mockResolvedValue({
        data: null,
        error: {
          code: "23505",
          message:
            'duplicate key value violates unique constraint "api_keys_user_exchange_venue_account_uniq"',
        },
      });
      // The pre-RPC fence sees nothing (the row appeared during the request);
      // the re-read after the collision sees the finished owner.
      venueKeyLookupMock
        .mockResolvedValueOnce({ data: null, error: null })
        .mockResolvedValue({ data: { id: EXISTING_KEY_ID }, error: null });
      venueStrategyLookupMock.mockResolvedValue({ data: null, error: null });
      venueOwnerLookupMock.mockResolvedValue({
        data: { id: EXISTING_STRATEGY_ID, name: EXISTING_STRATEGY_NAME },
        error: null,
      });

      const POST = await importPost();
      const res = await POST(makeReq(MT5_RECONNECT_BODY));

      expect(res.status).toBe(409);
      const body = await res.json();
      expect(body.code).toBe("VENUE_ALREADY_CONNECTED");
      expect(body.strategy_name).toBe(EXISTING_STRATEGY_NAME);
    });
  });

  describe("the 23505 arm discriminates (TWIN-8)", () => {
    beforeEach(() => {
      vi.spyOn(console, "error").mockImplementation(() => {});
    });

    it("venue-identity constraint + resolvable → 200 deduped with the EXISTING ids", async () => {
      // The race the app fence cannot win: the row appeared between the fence
      // read and the RPC. The DB caught it; we resolve toward the existing row.
      rpcMock.mockResolvedValue({
        data: null,
        error: {
          code: "23505",
          message:
            'duplicate key value violates unique constraint "api_keys_user_exchange_venue_account_uniq"',
        },
      });
      venueKeyLookupMock
        .mockResolvedValueOnce({ data: null, error: null })
        .mockResolvedValue({ data: { id: EXISTING_KEY_ID }, error: null });
      venueStrategyLookupMock.mockResolvedValue({
        data: { id: EXISTING_STRATEGY_ID },
        error: null,
      });

      const POST = await importPost();
      const res = await POST(makeReq(MT5_RECONNECT_BODY));

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        ok: true,
        strategy_id: EXISTING_STRATEGY_ID,
        api_key_id: EXISTING_KEY_ID,
        deduped: true,
      });
    });

    it("venue-identity constraint + UNRESOLVABLE → the existing 409, not a new code", async () => {
      rpcMock.mockResolvedValue({
        data: null,
        error: {
          code: "23505",
          message:
            'duplicate key value violates unique constraint "api_keys_user_exchange_venue_account_uniq"',
        },
      });
      // Nothing resolvable on the re-read (orphan / dark fence).
      venueKeyLookupMock.mockResolvedValue({ data: null, error: null });

      const POST = await importPost();
      const res = await POST(makeReq(MT5_RECONNECT_BODY));

      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({
        code: "DRAFT_ALREADY_EXISTS",
        error: "A wizard session with this key is already in progress.",
      });
    });

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
      // Byte-wise: `toEqual` on parsed JSON does not compare key order, and the
      // pre-154 body is what the wizard's copy table is pinned against.
      expect(await res.text()).toBe(
        '{"code":"DRAFT_ALREADY_EXISTS","error":"A wizard session with this key is already in progress."}',
      );
    });

    it("a 23505 naming NO constraint keeps the pre-154 409 (absence is not a value)", async () => {
      rpcMock.mockResolvedValue({
        data: null,
        error: { code: "23505", message: "dup" },
      });

      const POST = await importPost();
      const res = await POST(makeReq(VALID_BODY));

      expect(res.status).toBe(409);
      expect(await res.text()).toBe(
        '{"code":"DRAFT_ALREADY_EXISTS","error":"A wizard session with this key is already in progress."}',
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
      // `captureToSentry` fires through a lazy `import(...).then(...)` chain,
      // so the capture lands a tick later — same wait the SEAMUX-08 block uses.
      await vi.waitFor(() =>
        expect(sentryState.captured.length).toBeGreaterThan(0),
      );
      const capture = sentryState.captured.at(-1);
      expect(capture?.options.tags?.step).toBe("draft-rpc-unknown-constraint");
      expect(capture?.options.extra?.constraint).toBe(
        "api_keys_some_future_uniq",
      );
    });
  });
});

/**
 * Phase 140 / SEAM-04 SC-5b — a circuit-breaker trip during key-connect.
 *
 * When the Vercel→Railway breaker is OPEN, the shared resilience core throws
 * `CircuitOpenError` WITHOUT issuing a request. Before this phase that error
 * matched none of `classifyKeyValidationError`'s substring branches and fell
 * through to `{code:"UNKNOWN", status:500}` — the wizard rendered "something
 * went wrong, our team has been notified" during an infra outage, with no retry
 * affordance. These tests pin the honest 503 instead.
 *
 * The class is imported from `@/lib/seam-errors` (the dependency-free leaf) via
 * a DYNAMIC import taken from the same module registry as `importPost()`. The
 * `@/lib/analytics-client` mock above is a BARE factory — the class is not on
 * it, so routing `instanceof` through that module would compare against
 * `undefined` and throw from inside the route's catch block. The dynamic form
 * additionally survives the `vi.resetModules()` in the describe below, which
 * would otherwise leave a static import bound to a stale class object.
 */
describe("POST /api/strategies/create-with-key — circuit-breaker trip (SEAM-04 SC-5b)", () => {
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
    // H-0305 posture is unchanged: uniform { code } body, no raw message.
    expect(Object.keys(json)).toEqual(["code"]);
    // The breaker cooldown is the ONE dynamic value the class exposes, and it is
    // the same class of information rateLimitDenyJson already publishes.
    expect(res.headers.get("Retry-After")).toBe("42");
    // Short-circuit means nothing downstream ran and nothing was stored.
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
    // The key was validated but never persisted — the RPC never ran.
    expect(rpcMock).not.toHaveBeenCalled();
    consoleErr.mockRestore();
  });

  it("HI-02: the catch scrubs THIS ROUTE's per-request exchange credentials", async () => {
    // ⚠️ THE WIRING, NOT THE ROSTER. `seam-log-coverage.test.ts` proves this
    // file is now scanned; this proves the catch actually redacts. Both are
    // needed: the scan is a source predicate and cannot see runtime bytes.
    //
    // This catch wraps validateKey/encryptKey, whose request bodies carry the
    // raw exchange credentials and whose outgoing headers carry X-Service-Key.
    // undici embeds those headers in `err.message`. Until HI-02 this site
    // logged `err.message` raw; the exposure was narrow only because a
    // DIFFERENT file (analytics-client) happens to replace the undici message
    // first — a property of that file's catch ordering, not of this route.
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
    // The A-10 half: redacting must not answer by dropping the error. The
    // syscall token is the most valuable thing in this line.
    expect(logged).toContain("ECONNREFUSED");
    consoleErr.mockRestore();
  });

  it("still classifies non-breaker errors by message (the substring cascade is intact)", async () => {
    // Negative control. If the route ever stopped threading the error object
    // and started passing something else, the first two tests could pass while
    // every message-classified path silently collapsed to UNKNOWN.
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

/**
 * ⭐ PHASE 156 / CONNECT-REFACTOR — the post-156 contract of the wizard write,
 * written down BEFORE the route implements it (plan 04 owns the route).
 *
 * ⛔ EVERY CASE BELOW IS EXPECTED TO FAIL UNTIL PLAN 04 LANDS. That is the
 * point: `route.test.ts:229-238`'s docblock previously asserted that a missing
 * service key "must degrade to a dark fence and never to a failed submit" — a
 * sentence that is true of the venue fence and becomes FALSE of the RPC. A test
 * suite written after the route would have passed on a route that kept a
 * user-scoped fallback, which is the bug (Pitfall 5).
 *
 * ⚠️ WHAT "FAILS FOR THE RIGHT REASON" MEANS HERE, case by case. The route
 * ALREADY passes `p_user_id: user.id` and the already-normalised
 * `exchangeNormalized`, so CONNECT-02's and CONNECT-03b's argument claims are
 * true today and CANNOT red on their own account — the plan says so ("no new
 * plumbing is needed for the identity — only a new assertion"). What is false
 * today is WHICH CLIENT carries those arguments, so each case asserts the
 * client FIRST, with a named message, and the argument claims behind it. In the
 * red window they red on the client; in the green window every assertion runs.
 *
 * ⚠️ Every name carries the literal token `156` so the intended failures can be
 * grepped out of a failure list rather than inferred from an exit code — a
 * `node_modules`-less worktree exits 1 exactly as a failing test does.
 */
describe("[156 / CONNECT-02 + CONNECT-03] create-with-key — the service-role writer contract", () => {
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
    adminClientThrows.value = false;
    userScopedRpcIsFatal.value = false;
    rpcCallSites.length = 0;
    capturedSelects.length = 0;
    sentryState.captured.length = 0;
    validateKeyMock.mockReset();
    encryptKeyMock.mockReset();
    rpcMock.mockReset();
    draftLookupMock.mockReset();
    assetClassUpdateMock.mockClear();

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

  afterEach(() => {
    adminClientThrows.value = false;
    userScopedRpcIsFatal.value = false;
    vi.restoreAllMocks();
  });

  it("156 — create_wizard_strategy is reached through the ADMIN (service-role) client", async () => {
    const POST = await importPost();
    const res = await POST(makeReq(BINANCE_BODY));

    expect(res.status).toBe(200);
    expect(
      rpcCallSites,
      "CONNECT-02: after Phase 156 `authenticated` holds no EXECUTE on " +
        "create_wizard_strategy, so the ONLY client that can perform this " +
        "write is createAdminClient(). Recorded call sites:",
    ).toEqual(["admin"]);
    const [rpcName] = rpcMock.mock.calls[0];
    expect(rpcName).toBe("create_wizard_strategy");
  });

  it("156 — the USER-SCOPED client is never the one that reaches it (armed, not inferred)", async () => {
    // ⭐ THE ANTI-VACUITY HALF OF THE CASE ABOVE. Arming the user-scoped double
    // makes the wrong client FATAL rather than merely unrecorded, so a route
    // that kept the fallback cannot answer 200 by accident and be read as
    // rewired. This is `156-VALIDATION.md` SC2 Mutation A's oracle: re-point the
    // `.rpc` receiver at the user-scoped binding and this case reds.
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
    // and the DB therefore stops comparing p_user_id to anything. What used to
    // be defence-in-depth at the route is the whole control after this phase —
    // see `156-PATTERNS.md` Finding B, whose re-cut of the composite fence's
    // Part 3b points at this very case.
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
    // ⛔ NOT a 200, NOT a 500, and NOT a success by any other path. `binance`
    // is deliberate: it exercises a venue with NO identity fence, so the only
    // thing the service key is needed for here is the WRITE. A 200 means a
    // user-scoped fallback survived somewhere.
    //
    // 503 + SEAM_MISCONFIGURED is the code the two wizard routes ALREADY emit
    // for a server-side misconfiguration (route.ts:504-511, wizardErrors.ts:430
    // and :2166-2183, ratelimit.ts:325-326). ⛔ No new member is minted into the
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

/**
 * 140.3-13b / SEAMUX-08 — this route captures to Sentry, under the ONE policy
 * written out in `src/app/api/admin/match/eval/route.ts`.
 *
 * ⚠️ THE BASELINE WAS ZERO, measured on the untouched tree:
 * `grep -vE '^\s*(//|\*)' route.ts | grep -c captureToSentry` read **0** here.
 * CONTEXT named this route and `composite/add-key` as the two that "do not
 * import Sentry"; the real class was **9 of 15**. `140.3-13a` closed four,
 * this plan closes five, and these two — the ones everybody knew about — were
 * deliberately left to the second half so the pair everyone names would not be
 * the only pair delivered.
 *
 * ⚠️ WHAT MUST NOT MOVE. This route's breaker cell is "the best in the audit"
 * (CONTEXT) and is a TEMPLATE, not a fix target. Its three properties — the
 * caught VALUE reaching the shared classifier, the status derived from the
 * classifier, and the conditional `Retry-After` — are re-pinned by the negative
 * case below, so an observability edit that disturbed any of them would redden
 * here as well as in the SEAM-04 block above.
 */
describe("[140.3-13b / SEAMUX-08] POST /api/strategies/create-with-key — Sentry capture policy", () => {
  let consoleErr: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // ⚠️ THE H-0306 BLOCK ABOVE LEAKS. It registers `vi.doMock` for
    // `@/lib/api/withAuth` (the REAL one) and for `@/lib/supabase/server` (a
    // client with NO authenticated user), and a `doMock` registration OUTLIVES
    // the `vi.resetModules()` in its own afterEach — reset clears the module
    // registry, not the mock registry. Every case below re-imports `./route`,
    // so without re-registering the file-top factories here they would all
    // answer 401 and each "NEGATIVE: … is never captured" case would pass
    // VACUOUSLY: no capture, because the handler never ran at all. Found by
    // measuring, not by reasoning — the first run was 10 × 401.
    vi.resetModules();
    vi.doMock("@/lib/api/withAuth", () => ({
      withAuth:
        (h: (req: NextRequest, user: typeof MOCK_USER) => unknown) =>
        (req: NextRequest) =>
          h(req, MOCK_USER),
    }));
    vi.doMock("@/lib/supabase/server", () => ({
      createClient: async () => ({
        rpc: (...args: unknown[]) => rpcMock(...args),
        from: () => ({
          select: () => ({
            eq: () => ({ eq: () => ({ maybeSingle: () => draftLookupMock() }) }),
          }),
          update: (...args: unknown[]) => assetClassUpdateMock(...args),
        }),
      }),
    }));

    validateKeyMock.mockReset();
    encryptKeyMock.mockReset();
    rpcMock.mockReset();
    assetClassUpdateMock.mockClear();
    draftLookupMock.mockClear();
    sentryState.captured.length = 0;
    consoleErr = vi.spyOn(console, "error").mockImplementation(() => {});

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

  it("POSITIVE: an UNCLASSIFIED throw IS captured, with this route's tags", async () => {
    // A message matching NO branch of classifyKeyValidationError's cascade —
    // the terminal `{code:"UNKNOWN", status:500}` verdict.
    validateKeyMock.mockRejectedValue(new Error("connect ECONNREFUSED 10.0.0.5:8002"));

    const POST = await importPost();
    const res = await POST(makeReq(VALID_BODY));
    expect(res.status).toBe(500);
    expect((await res.json()).code).toBe("UNKNOWN");

    const { err, options } = await nextCapture();
    expect(options.tags?.surface).toBe("strategies-create-with-key");
    expect(options.tags?.step).toBe("unclassified-key-error");
    // The Error TYPE survives — `captureToSentry` rebuilds an Error rather than
    // stringifying, so Sentry keeps its grouping and stack.
    expect(err).toBeInstanceOf(Error);
    expect(options.extra?.exchange).toBe("okx");
  });

  it("M78b GUARD: the RAW per-request api_key / api_secret / passphrase never reach Sentry — and ECONNREFUSED survives", async () => {
    // ⚠️ THE ASSERTION IS AGAINST THE BODY VALUES, NOT AN ENV TOKEN. That is
    // the whole lesson of 140.3-13a's M78b: dropping `secrets` leaves the
    // env-derived redaction working, so a test written against
    // INTERNAL_API_TOKEN stays GREEN while the caller's live exchange
    // credentials ship verbatim to a third party.
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
      "the caller's RAW exchange api_key was dispatched to Sentry — undici inlines request material into err.message (TRAP-1)",
    ).not.toContain(VALID_BODY.api_key);
    expect(
      message,
      "the caller's RAW exchange api_secret was dispatched to Sentry (TRAP-1)",
    ).not.toContain(VALID_BODY.api_secret);
    expect(
      message,
      "the caller's RAW exchange passphrase was dispatched to Sentry (TRAP-1)",
    ).not.toContain(VALID_BODY.passphrase);
    // OVER-redaction: destroying the syscall token replaces one incident with
    // two, and a one-sided test ships that state green.
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
    // Only the KEY NAMES of the ciphertext payload — never its values.
    expect(options.extra?.returned_keys).toEqual([
      "api_secret_encrypted",
      "passphrase_encrypted",
      "kek_version",
    ]);
    expect((err as Error).message).toContain("api_key_encrypted");
    // The RPC never ran, so nothing was persisted on a broken contract.
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

    // ⚠️ THE POSITIVE HALF re-pins all THREE properties of the breaker cell the
    // plan forbids disturbing: the caught VALUE reached the shared classifier
    // (only a type check can yield SERVICE_UNAVAILABLE_RETRY — a stringified
    // error would land on UNKNOWN/500), the STATUS came from the classifier,
    // and the conditional `Retry-After` carries the breaker's own TTL.
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

  it("NEGATIVE: a duplicate-draft 409 and a permission-denied 403 are recognised RPC outcomes, not faults", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { code: "23505", message: "dup" } });
    const POST = await importPost();
    const dup = await POST(makeReq(VALID_BODY));
    expect(dup.status).toBe(409);
    await expectNoCapture();

    rpcMock.mockResolvedValue({ data: null, error: { code: "42501", message: "denied" } });
    const denied = await POST(makeReq(VALID_BODY));
    expect(denied.status).toBe(403);
    await expectNoCapture();
  });

  it("NEGATIVE: a 400 input rejection is never captured, and never reaches the seam at all", async () => {
    const POST = await importPost();
    const res = await POST(makeReq({ ...VALID_BODY, api_key: "short" }));
    expect(res.status).toBe(400);
    expect(validateKeyMock).not.toHaveBeenCalled();
    await expectNoCapture();
  });

  /**
   * [153.7-03 / WIZFORM-02-CLASS] the mt5-gateway family, ON THIS ROUTE.
   *
   * ⚠️ WHY A ROUTE-LOCAL TEST FOR A FIX THAT IS NOT ROUTE-LOCAL. The verdict
   * lives in ONE row of `VENUE_WIRE_CODE_TO_VERDICT` in shared
   * `wizardErrors.ts`, so it reached this route and `composite/add-key` in the
   * same commit — there was never a one-route half-fix to catch. What CAN
   * still happen is a future route-local change that quietly re-opens the path:
   * the add-key catch's own comment names the live example, pre-stringifying
   * the caught value before classification, which sends a breaker trip to the
   * terminal UNKNOWN/500 instead of the retryable 503. A shared-table test
   * cannot see that; only a test that runs THIS handler can. Fixing one path
   * of a byte-identical pair is this milestone's single most repeated mistake,
   * so both routes carry the alarm and the twin case is deliberately written
   * to the same shape.
   *
   * The mock reproduces what the seam really throws: the wire code on
   * `seamCode` and the emitter's own `detail=` sentence as the message, both
   * read from `_connect_and_probe` in the exchange router.
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
    // The whole point, stated as its own assertion so the failure names it.
    expect(json.code).not.toBe("UNKNOWN");
    // ⛔ NOT `SERVICE_UNAVAILABLE_RETRY`. Its copy says nothing was submitted —
    // knowable for a breaker that DECLINED to send, false-by-construction for a
    // socket connect that WAS attempted and never answered. That trap is
    // written into the shared table beside the row this asserts.
    expect(json.code).not.toBe("SERVICE_UNAVAILABLE_RETRY");
    // Fail-closed: classified before any encryption or DB insert.
    expect(encryptKeyMock).not.toHaveBeenCalled();
    expect(rpcMock).not.toHaveBeenCalled();
    // A classified verdict that is NOT our defect must not fire the capture, or
    // the noise this route was quiet about comes back for a failure we now
    // answer precisely. ⚠️ "Classified" is no longer the predicate — see the
    // OUR-DEFECT case below, which is the other half of this pair.
    await expectNoCapture();
  });

  /**
   * ⭐ 153.7 review WR-02 — CLASSIFYING A FAULT BETTER IS NOT A REASON TO STOP
   * HEARING ABOUT IT.
   *
   * Until 153.7-02, a seam throw carrying `seamCode: "INTERNAL"` fell off the
   * classifier's cascade to `UNKNOWN` and PAGED. That plan gave it a verdict row
   * resolving to `SEAM_INTERNAL_FAULT` — an unambiguous improvement for the user
   * — and, as a side effect nobody wrote down, moved it out of the
   * `code === "UNKNOWN"` capture arm. `INTERNAL` is `validate_key_permissions`'
   * bare `except Exception` escape: the single most page-worthy thing this seam
   * can answer, and it went silent on the Next side in a commit whose test
   * asserted the silence.
   *
   * ⛔ THE ASSERTION IS THE CAPTURE, NOT THE CODE. The verdict half is already
   * covered by the shared-table replay in `wizardErrors.test.ts`; what only a
   * route test can see is whether THIS handler still reports it. Both are
   * asserted here so a future re-narrowing of the predicate reds by name rather
   * than by an absence nobody is looking at.
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
    // The user still gets the honest card, not "we could not classify this".
    expect(json.code).toBe("SEAM_INTERNAL_FAULT");
    expect(json.code).not.toBe("UNKNOWN");
    // Fail-closed: no key was stored, which is what the card promises.
    expect(encryptKeyMock).not.toHaveBeenCalled();
    expect(rpcMock).not.toHaveBeenCalled();

    // ⭐ THE HALF THAT REGRESSED. A recognised OUR-DEFECT verdict must still
    // reach Sentry with this route's tags.
    const { err, options } = await nextCapture();
    expect(options.tags?.surface).toBe("strategies-create-with-key");
    expect(options.tags?.step).toBe("unclassified-key-error");
    expect(options.extra?.exchange).toBe("okx");
    expect(err).toBeInstanceOf(Error);
  });
});

/**
 * Phase 142.2-07 / MT5-04 (D-05) — EVERY REJECTION SITE, ONE HONEST CODE EACH.
 *
 * ⚠️ WHAT THIS REPLACES, AND WHY IT IS A TABLE. This route answered
 * `KEY_INVALID_FORMAT` at ALL TWELVE input-validation guards. Eleven of them
 * were not format failures — a malformed body, an unsupported venue, a missing
 * login, two venue switches, a missing investor password, a missing OKX
 * passphrase, a missing session id and three length caps — and every one
 * rendered "This does not look like a valid API key for the selected exchange"
 * with Binance hex-length advice. A founder who submitted a COMPLETE MT5 form
 * was told their key format was wrong.
 *
 * ⚠️ THE ARM THE FOUNDER HIT IS NOW UNREACHABLE. MT5-01 set the server-side
 * switch, so the mt5 arm can no longer fire in production. It is covered here
 * anyway, and the row says so: a fix aimed only at the instance would have
 * repaired a line that cannot fire while eleven siblings kept lying. The CLASS
 * is the subject, not the instance.
 *
 * THE COUNT IS 12, NOT 14. `grep -c KEY_INVALID_FORMAT` on the route returned 14
 * before the split; `grep -c 'code: "KEY_INVALID_FORMAT"'` returned 12. The
 * delta is two COMMENT mentions of the code. The table below is the emitting
 * population, one row per guard, and the same 12 is pinned from disk in
 * `wizardErrors.invariant.test.ts`.
 *
 * The `error` string on every row is the one that shipped BEFORE this plan and
 * is asserted verbatim: only the `code` literal was allowed to move. A row whose
 * error string changed would mean the guard itself was edited, which is exactly
 * what this plan is not allowed to do (V5 — changing validation posture under
 * cover of a copy fix).
 */
describe("[142.2-07 / MT5-04] create-with-key — all 12 rejection sites, honest codes", () => {
  const LONG = "x".repeat(513);

  beforeEach(() => {
    validateKeyMock.mockReset();
    encryptKeyMock.mockReset();
    rpcMock.mockReset();
    draftLookupMock.mockReset();
    draftLookupMock.mockResolvedValue({ data: null, error: null });
    delete process.env.SFOX_ENABLED;
    delete process.env.MT5_ENABLED;
  });

  afterEach(() => {
    delete process.env.SFOX_ENABLED;
    delete process.env.MT5_ENABLED;
  });

  /**
   * HAND-TYPED, one row per emitting guard, in source order. Deliberately NOT
   * generated from the route: an expectation derived from its own subject
   * cannot fail when the subject changes.
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
      // UNREACHABLE IN PRODUCTION since MT5-01 set the server switch. Covered
      // because the CLASS is the subject: this is the arm the founder hit, and
      // a split that skipped it would leave the class open at the very site
      // that proved it was broken.
      guard: "mt5 venue switch is off (unreachable post-MT5-01)",
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
      guard: "mt5 investor password absent",
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
      // ⭐ THE ONE GENUINE FORMAT FAILURE. The only guard of the twelve that
      // judges the SHAPE of a value, and the reason KEY_INVALID_FORMAT's copy
      // (Binance secrets are 64 hex characters, etc.) is true again now that
      // the other eleven have moved off it.
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
    // Pinned as the LITERAL 12. Comparing `SITES.length` to itself is an
    // expectation that reads its own subject and can never fail, and 14 would
    // pin the raw-grep fiction that counted two comment mentions as emitters.
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
    // Every one of these rejects BEFORE the live probe, which is what makes the
    // new copy's "nothing was sent to the exchange" claim observable rather
    // than asserted.
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
    // The defect in one line: before the split this set had exactly ONE member
    // for twelve distinct causes. A regression that re-merged any pair shrinks
    // it, and the failure names which code disappeared.
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
