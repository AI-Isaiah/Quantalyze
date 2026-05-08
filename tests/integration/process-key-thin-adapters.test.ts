/**
 * Vitest environment override — multipart routes (csv-validate) require the
 * node environment so undici's native FormData parser is used. jsdom's
 * Request.formData() does not parse NextRequest multipart bodies correctly.
 * Mirrors the override in src/__tests__/csv-validate-route.test.ts.
 */

// @vitest-environment node

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { NextRequest } from "next/server";

/**
 * Phase 19 / BACKBONE-10 — thin-adapter integration test.
 *
 * Locks the conversion contract for the 5 (+2 csv) entry routes:
 *
 *   - flag=on  → outbound fetch to ${ANALYTICS_SERVICE_URL}/process-key with
 *                Authorization: Bearer + X-Correlation-Id and the canonical
 *                `{flow_type, source, context}` body shape.
 *   - flag=off → existing legacy code path runs (no /process-key call).
 *
 * The factsheet/[id]/pdf route is intentionally NOT covered — it stays a
 * GET-only PDF reader per Open Question 2; route-inventory.md marks it out
 * of scope.
 */

const VALID_ORIGIN = { origin: "http://localhost:3000" };
const TEST_USER = { id: "00000000-0000-0000-0000-aaaaaaaaaaaa" };
const TEST_CORRELATION_ID = "11111111-2222-3333-4444-555555555555";
const TEST_STRATEGY_ID = "11111111-1111-1111-1111-111111111111";
const TEST_API_KEY_ID = "33333333-3333-3333-3333-333333333333";

// `server-only` throws under vitest+jsdom — same pattern as other route tests.
vi.mock("server-only", () => ({}));

// Default rate-limit + ownership state can be flipped per-test.
const rateLimitResult = { success: true as boolean, retryAfter: 0 };

vi.mock("@/lib/csrf", () => ({
  assertSameOrigin: () => null,
}));

vi.mock("@/lib/ratelimit", () => ({
  publicIpLimiter: null,
  userActionLimiter: null,
  csvValidateLimiter: null,
  checkLimit: async () => rateLimitResult,
  getClientIp: () => "127.0.0.1",
}));

vi.mock("@/lib/audit", () => ({
  logAuditEvent: vi.fn(),
}));

vi.mock("@/lib/correlation-id", () => ({
  getCorrelationId: vi.fn().mockResolvedValue(TEST_CORRELATION_ID),
  CORRELATION_HEADER: "x-correlation-id",
}));

// Feature flag — flipped per-test via vi.mocked(...).mockResolvedValue.
vi.mock("@/lib/feature-flags", () => ({
  isUnifiedBackboneActive: vi.fn(),
  _resetCacheForTests: vi.fn(),
}));

// Supabase server-side user client. Returns the test user + a
// strategies-with-api-keys join for finalize-wizard's force-refresh probe path.
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: TEST_USER }, error: null }),
    },
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            single: async () => ({
              data: { id: TEST_STRATEGY_ID, user_id: TEST_USER.id },
              error: null,
            }),
          }),
          maybeSingle: async () => ({
            data: { api_key_id: TEST_API_KEY_ID },
            error: null,
          }),
          single: async () => ({
            data: { id: TEST_STRATEGY_ID, user_id: TEST_USER.id },
            error: null,
          }),
        }),
      }),
    }),
    rpc: async () => ({ data: TEST_STRATEGY_ID, error: null }),
  }),
}));

// Service-role admin client. The verify-strategy route uses it for the
// rate-limit count + UPDATE; in the unified path the count call still runs
// (rate limit precedes the flag check), so we stub it to a clean count.
//
// API-8 lookup support: the finalize-wizard / keys-sync unified branches
// resolve the actual exchange via `admin.from('api_keys').select('exchange')
// .eq('id', apiKeyId).single()` before delegating. The mock below also
// supports the verification_requests count chain via .eq().gte() and the
// strategy_verifications upsert chain via .upsert().
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          gte: async () => ({ count: 0, error: null }),
          single: async () => ({ data: { exchange: "okx" }, error: null }),
          maybeSingle: async () => ({ data: { id: "anchor" }, error: null }),
          order: () => ({
            limit: () => ({
              maybeSingle: async () => ({ data: { id: "anchor" }, error: null }),
            }),
          }),
        }),
      }),
      update: () => ({ eq: async () => ({ error: null }) }),
      upsert: async () => ({ error: null }),
    }),
    rpc: async () => ({ data: null, error: null }),
  }),
}));

// Analytics-client wrappers used by the legacy paths. They throw if invoked
// in a flag=on test (which would mean the thin adapter delegated incorrectly).
vi.mock("@/lib/analytics-client", () => ({
  verifyStrategy: vi.fn(),
  validateKey: vi.fn(),
  encryptKey: vi.fn(),
  fetchTrades: vi.fn(),
  computeAnalytics: vi.fn(),
  validateCsv: vi.fn(),
}));

// next/server `after()` capture for finalize-wizard.
vi.mock("next/server", async () => {
  const actual = await vi.importActual<typeof import("next/server")>(
    "next/server",
  );
  return {
    ...actual,
    after: vi.fn(),
  };
});

import { isUnifiedBackboneActive } from "@/lib/feature-flags";

// Outbound fetch mock — every flag=on case asserts on its arguments.
let fetchCalls: Array<{ url: string; init: RequestInit }>;
const mockFetch = vi.fn(async (url: string | URL, init?: RequestInit) => {
  fetchCalls.push({ url: String(url), init: init ?? {} });
  return new Response(
    JSON.stringify({ verification_id: "v-thin-adapter", queued: false }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
});

beforeEach(() => {
  vi.clearAllMocks();
  rateLimitResult.success = true;
  rateLimitResult.retryAfter = 0;
  fetchCalls = [];
  globalThis.fetch = mockFetch as unknown as typeof globalThis.fetch;
  process.env.ANALYTICS_SERVICE_URL = "https://analytics.test";
  process.env.INTERNAL_API_TOKEN = "test-internal-token";
});

afterEach(() => {
  delete process.env.ANALYTICS_SERVICE_URL;
  delete process.env.INTERNAL_API_TOKEN;
});

function jsonReq(path: string, body: Record<string, unknown>) {
  return new NextRequest(`http://localhost:3000${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...VALID_ORIGIN },
    body: JSON.stringify(body),
  });
}

function findProcessKeyCall() {
  return fetchCalls.find((c) => c.url.endsWith("/process-key"));
}

function parseFetchBody(call: { init: RequestInit } | undefined) {
  if (!call) return null;
  return JSON.parse(call.init.body as string) as Record<string, unknown>;
}

describe("thin adapters — flag=on delegates to /process-key (BACKBONE-10)", () => {
  it("verify-strategy: flow_type=teaser, source from body.exchange", async () => {
    vi.mocked(isUnifiedBackboneActive).mockResolvedValue(true);

    const { POST } = await import("@/app/api/verify-strategy/route");
    const res = await POST(
      jsonReq("/api/verify-strategy", {
        email: "test@example.com",
        exchange: "okx",
        api_key: "k",
        api_secret: "s",
      }),
    );

    expect(res.status).toBe(200);
    const call = findProcessKeyCall();
    expect(call).toBeDefined();
    expect(call!.url).toBe("https://analytics.test/process-key");
    expect((call!.init.headers as Record<string, string>).Authorization).toBe(
      "Bearer test-internal-token",
    );
    expect(
      (call!.init.headers as Record<string, string>)["X-Correlation-Id"],
    ).toBe(TEST_CORRELATION_ID);
    const body = parseFetchBody(call);
    expect(body!.flow_type).toBe("teaser");
    expect(body!.source).toBe("okx");
  });

  // API-2: validate-and-encrypt is locked to the legacy code path even
  // when the unified-backbone flag is on, because the unified `/process-key`
  // validate step does not return the encryption envelope the allocator
  // client persists. This test documents the locked behavior — it must
  // FAIL if a future refactor reintroduces the unified delegation before
  // /process-key gains a real encrypt branch.
  it("keys/validate-and-encrypt flag=on STILL uses legacy path (API-2 lock)", async () => {
    vi.mocked(isUnifiedBackboneActive).mockResolvedValue(true);
    const analyticsClient = await import("@/lib/analytics-client");
    vi.mocked(analyticsClient.validateKey).mockResolvedValue({
      valid: true,
      read_only: true,
    });
    vi.mocked(analyticsClient.encryptKey).mockResolvedValue({
      api_key_encrypted: "enc-key",
      api_secret_encrypted: "enc-secret",
      passphrase_encrypted: null,
      dek_encrypted: "enc-dek",
      nonce: "nonce",
      kek_version: 1,
    });

    const { POST } = await import("@/app/api/keys/validate-and-encrypt/route");
    const res = await POST(
      jsonReq("/api/keys/validate-and-encrypt", {
        exchange: "binance",
        api_key: "k",
        api_secret: "s",
      }),
    );

    // /process-key MUST NOT be called for this route — the legacy
    // validateKey + encryptKey wrappers are the only path.
    expect(findProcessKeyCall()).toBeUndefined();
    expect(res.status).toBe(200);
    expect(analyticsClient.validateKey).toHaveBeenCalled();
    expect(analyticsClient.encryptKey).toHaveBeenCalled();
  });

  it("strategies/finalize-wizard: flow_type=onboard with force-refresh probe RUN BEFORE delegation", async () => {
    vi.mocked(isUnifiedBackboneActive).mockResolvedValue(true);
    // Mock the force-refresh probe response to look read-only so the route
    // proceeds to /process-key.
    mockFetch.mockImplementationOnce(
      async (url: string | URL, init?: RequestInit) => {
        fetchCalls.push({ url: String(url), init: init ?? {} });
        return new Response(
          JSON.stringify({ read: true, trade: false, withdraw: false }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      },
    );

    const { POST } = await import("@/app/api/strategies/finalize-wizard/route");
    const res = await POST(
      jsonReq("/api/strategies/finalize-wizard", {
        strategy_id: "11111111-1111-1111-1111-111111111111",
        name: "Alpha Centauri",
        description: "A reasonable description that is at least 10 chars long.",
        category_id: "22222222-2222-2222-2222-222222222222",
      }),
    );

    // Probe must come BEFORE the /process-key call (Open Question 1 —
    // scope-broadening defense retained at the thin-adapter layer).
    expect(fetchCalls.length).toBeGreaterThanOrEqual(2);
    const probeIdx = fetchCalls.findIndex((c) =>
      c.url.includes("/internal/keys/"),
    );
    const procIdx = fetchCalls.findIndex((c) =>
      c.url.endsWith("/process-key"),
    );
    expect(probeIdx).toBeGreaterThanOrEqual(0);
    expect(procIdx).toBeGreaterThan(probeIdx);

    // /process-key body shape
    const body = parseFetchBody(fetchCalls[procIdx]);
    expect(body!.flow_type).toBe("onboard");
    // API-8: source is the resolved api_keys.exchange, not hardcoded 'okx'.
    expect(body!.source).toBe("okx");
    expect(res.status).toBe(200);

    // API-9: response shape translation — when upstream returns
    // `{queued, verification_id}`, the thin adapter must hand back the
    // legacy `{strategy_id, status:'pending_review'}` shape.
    const respBody = await res.json();
    expect(respBody.strategy_id).toBe("11111111-1111-1111-1111-111111111111");
    expect(respBody.status).toBe("pending_review");
  });

  it("keys/sync: flow_type=resync — translates queued upstream to legacy 202 (I-API1)", async () => {
    vi.mocked(isUnifiedBackboneActive).mockResolvedValue(true);

    const { POST } = await import("@/app/api/keys/sync/route");
    const res = await POST(
      jsonReq("/api/keys/sync", { strategy_id: TEST_STRATEGY_ID }),
    );

    // I-API1: when /process-key returns `{queued, verification_id}`, the
    // thin adapter must translate it back to the legacy 202 + accepted +
    // strategy_id + status:syncing shape so callers reading body.strategy_id
    // keep working.
    expect(res.status).toBe(202);
    const responseBody = await res.json();
    expect(responseBody.accepted).toBe(true);
    expect(responseBody.strategy_id).toBe(TEST_STRATEGY_ID);
    expect(responseBody.status).toBe("syncing");

    const call = findProcessKeyCall();
    const body = parseFetchBody(call);
    expect(body!.flow_type).toBe("resync");
    // API-8: source is the resolved api_keys.exchange (mocked to 'okx'),
    // not a hardcoded literal.
    expect(body!.source).toBe("okx");
  });

  it("strategies/csv-validate: flow_type=csv (re-routed from /csv/validate)", async () => {
    vi.mocked(isUnifiedBackboneActive).mockResolvedValue(true);

    const formData = new FormData();
    formData.append(
      "file",
      new File(["a,b\n1,2"], "test.csv", { type: "text/csv" }),
    );
    formData.append("fmt", "daily_returns");
    formData.append(
      "wizard_session_id",
      "44444444-4444-4444-4444-444444444444",
    );

    const req = new NextRequest("http://localhost:3000/api/strategies/csv-validate", {
      method: "POST",
      headers: VALID_ORIGIN,
      body: formData,
    });

    const { POST } = await import("@/app/api/strategies/csv-validate/route");
    const res = await POST(req);

    expect(res.status).toBe(200);
    const call = findProcessKeyCall();
    expect(call).toBeDefined();
    const body = parseFetchBody(call);
    expect(body!.flow_type).toBe("csv");
    expect(body!.source).toBe("csv");
  });

  it("strategies/csv-finalize: flow_type=csv (re-routed from /csv/finalize)", async () => {
    vi.mocked(isUnifiedBackboneActive).mockResolvedValue(true);

    const { POST } = await import("@/app/api/strategies/csv-finalize/route");
    const res = await POST(
      jsonReq("/api/strategies/csv-finalize", {
        wizard_session_id: "44444444-4444-4444-4444-444444444444",
        fmt: "daily_returns",
        strategy_name: "Apollo CSV",
      }),
    );

    expect(res.status).toBe(200);
    const call = findProcessKeyCall();
    expect(call).toBeDefined();
    const body = parseFetchBody(call);
    expect(body!.flow_type).toBe("csv");
    expect(body!.source).toBe("csv");
  });
});

describe("thin adapters — flag=off preserves legacy path", () => {
  it("keys/sync flag=off does NOT call /process-key (legacy after() runs)", async () => {
    vi.mocked(isUnifiedBackboneActive).mockResolvedValue(false);

    const { POST } = await import("@/app/api/keys/sync/route");
    const res = await POST(
      jsonReq("/api/keys/sync", { strategy_id: TEST_STRATEGY_ID }),
    );

    // Legacy path still returns 202 accepted.
    expect(res.status).toBe(202);
    // /process-key MUST NOT be called when flag is off.
    expect(findProcessKeyCall()).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // I-T2 — flag=off cases for the remaining 4 thin adapters. Each asserts
  // findProcessKeyCall() is undefined AND the legacy mock IS called. Combined
  // with the existing keys/sync test above, this covers all 5 unified
  // adapters (verify-strategy, keys/sync, finalize-wizard, csv-validate,
  // csv-finalize) — validate-and-encrypt is special-cased by API-2 so its
  // flag-off behavior is identical to flag-on.
  // -------------------------------------------------------------------------
  it("I-T2a: verify-strategy flag=off does NOT call /process-key (legacy verifyStrategy runs)", async () => {
    vi.mocked(isUnifiedBackboneActive).mockResolvedValue(false);
    const analyticsClient = await import("@/lib/analytics-client");
    vi.mocked(analyticsClient.verifyStrategy).mockResolvedValue({
      verification_id: "v-legacy-it2a",
    });

    const { POST } = await import("@/app/api/verify-strategy/route");
    const res = await POST(
      jsonReq("/api/verify-strategy", {
        email: "test@example.com",
        exchange: "okx",
        api_key: "k",
        api_secret: "s",
      }),
    );

    expect(res.status).toBe(200);
    expect(findProcessKeyCall()).toBeUndefined();
    expect(analyticsClient.verifyStrategy).toHaveBeenCalled();
  });

  it("I-T2b: keys/validate-and-encrypt flag=off does NOT call /process-key", async () => {
    vi.mocked(isUnifiedBackboneActive).mockResolvedValue(false);
    const analyticsClient = await import("@/lib/analytics-client");
    vi.mocked(analyticsClient.validateKey).mockResolvedValue({
      valid: true,
      read_only: true,
    });
    vi.mocked(analyticsClient.encryptKey).mockResolvedValue({
      api_key_encrypted: "e",
      api_secret_encrypted: "e",
      passphrase_encrypted: null,
      dek_encrypted: "e",
      nonce: "n",
      kek_version: 1,
    });

    const { POST } = await import("@/app/api/keys/validate-and-encrypt/route");
    const res = await POST(
      jsonReq("/api/keys/validate-and-encrypt", {
        exchange: "okx",
        api_key: "k",
        api_secret: "s",
      }),
    );

    expect(res.status).toBe(200);
    expect(findProcessKeyCall()).toBeUndefined();
    expect(analyticsClient.validateKey).toHaveBeenCalled();
    expect(analyticsClient.encryptKey).toHaveBeenCalled();
  });

  it("I-T2c: strategies/finalize-wizard flag=off does NOT call /process-key (legacy RPC runs)", async () => {
    vi.mocked(isUnifiedBackboneActive).mockResolvedValue(false);
    // Probe still runs because the strategy has an api_key_id; mock it
    // returning read-only.
    mockFetch.mockImplementationOnce(
      async (url: string | URL, init?: RequestInit) => {
        fetchCalls.push({ url: String(url), init: init ?? {} });
        return new Response(
          JSON.stringify({ read: true, trade: false, withdraw: false }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      },
    );

    const { POST } = await import("@/app/api/strategies/finalize-wizard/route");
    const res = await POST(
      jsonReq("/api/strategies/finalize-wizard", {
        strategy_id: TEST_STRATEGY_ID,
        name: "Alpha Centauri",
        description: "A reasonable description that is at least 10 chars long.",
        category_id: "22222222-2222-2222-2222-222222222222",
      }),
    );

    expect(res.status).toBe(200);
    expect(findProcessKeyCall()).toBeUndefined();
  });

  it("I-T2d: strategies/csv-validate flag=off does NOT call /process-key (legacy validateCsv runs)", async () => {
    vi.mocked(isUnifiedBackboneActive).mockResolvedValue(false);
    const analyticsClient = await import("@/lib/analytics-client");
    vi.mocked(analyticsClient.validateCsv).mockResolvedValue({
      ok: true,
      rows: 0,
    } as unknown as Awaited<ReturnType<typeof analyticsClient.validateCsv>>);

    const formData = new FormData();
    formData.append(
      "file",
      new File(["a,b\n1,2"], "test.csv", { type: "text/csv" }),
    );
    formData.append("fmt", "daily_returns");
    formData.append("wizard_session_id", "44444444-4444-4444-4444-444444444444");
    const req = new NextRequest(
      "http://localhost:3000/api/strategies/csv-validate",
      { method: "POST", headers: VALID_ORIGIN, body: formData },
    );

    const { POST } = await import("@/app/api/strategies/csv-validate/route");
    const res = await POST(req);

    expect(res.status).toBe(200);
    expect(findProcessKeyCall()).toBeUndefined();
    expect(analyticsClient.validateCsv).toHaveBeenCalled();
  });

  it("I-T2e: strategies/csv-finalize flag=off does NOT call /process-key (legacy RPC runs)", async () => {
    vi.mocked(isUnifiedBackboneActive).mockResolvedValue(false);

    const { POST } = await import("@/app/api/strategies/csv-finalize/route");
    const res = await POST(
      jsonReq("/api/strategies/csv-finalize", {
        wizard_session_id: "44444444-4444-4444-4444-444444444444",
        fmt: "daily_returns",
        strategy_name: "Apollo CSV",
      }),
    );

    // Legacy RPC mock returns the strategy_id; status 200.
    expect(res.status).toBe(200);
    expect(findProcessKeyCall()).toBeUndefined();
  });
});

// -----------------------------------------------------------------------------
// I-T3 — INTERNAL_API_TOKEN-missing branch. Each unified-delegating route must
// return 503 (or the route-specific 503 envelope) and MUST NOT issue a fetch
// to /process-key. Validate-and-encrypt is excluded because API-2 locks it to
// the legacy path regardless.
// -----------------------------------------------------------------------------
describe("thin adapters — INTERNAL_API_TOKEN missing returns 503 (I-T3)", () => {
  it("I-T3a: verify-strategy missing token → 503, no /process-key call", async () => {
    vi.mocked(isUnifiedBackboneActive).mockResolvedValue(true);
    delete process.env.INTERNAL_API_TOKEN;
    const { POST } = await import("@/app/api/verify-strategy/route");
    const res = await POST(
      jsonReq("/api/verify-strategy", {
        email: "test@example.com",
        exchange: "okx",
        api_key: "k",
        api_secret: "s",
      }),
    );
    expect(res.status).toBe(503);
    expect(findProcessKeyCall()).toBeUndefined();
  });

  it("I-T3b: keys/sync missing token → 503, no /process-key call", async () => {
    vi.mocked(isUnifiedBackboneActive).mockResolvedValue(true);
    delete process.env.INTERNAL_API_TOKEN;
    const { POST } = await import("@/app/api/keys/sync/route");
    const res = await POST(
      jsonReq("/api/keys/sync", { strategy_id: TEST_STRATEGY_ID }),
    );
    expect(res.status).toBe(503);
    expect(findProcessKeyCall()).toBeUndefined();
  });

  it("I-T3c: strategies/finalize-wizard missing token → 503 OR 502 (probe), no /process-key call", async () => {
    vi.mocked(isUnifiedBackboneActive).mockResolvedValue(true);
    delete process.env.INTERNAL_API_TOKEN;
    // The pre-flight scope-broadening probe also needs INTERNAL_API_TOKEN —
    // its absence triggers a 502 KEY_NETWORK_TIMEOUT BEFORE the unified
    // delegation runs. Either way, /process-key MUST NOT be called.
    const { POST } = await import("@/app/api/strategies/finalize-wizard/route");
    const res = await POST(
      jsonReq("/api/strategies/finalize-wizard", {
        strategy_id: TEST_STRATEGY_ID,
        name: "Alpha Centauri",
        description: "A reasonable description that is at least 10 chars long.",
        category_id: "22222222-2222-2222-2222-222222222222",
      }),
    );
    expect([502, 503]).toContain(res.status);
    expect(findProcessKeyCall()).toBeUndefined();
  });

  it("I-T3d: strategies/csv-validate missing token → 503 envelope, no /process-key call", async () => {
    vi.mocked(isUnifiedBackboneActive).mockResolvedValue(true);
    delete process.env.INTERNAL_API_TOKEN;
    const formData = new FormData();
    formData.append(
      "file",
      new File(["a,b\n1,2"], "test.csv", { type: "text/csv" }),
    );
    formData.append("fmt", "daily_returns");
    formData.append("wizard_session_id", "44444444-4444-4444-4444-444444444444");
    const req = new NextRequest(
      "http://localhost:3000/api/strategies/csv-validate",
      { method: "POST", headers: VALID_ORIGIN, body: formData },
    );
    const { POST } = await import("@/app/api/strategies/csv-validate/route");
    const res = await POST(req);
    expect(res.status).toBe(503);
    expect(findProcessKeyCall()).toBeUndefined();
  });

  it("I-T3e: strategies/csv-finalize missing token → 503 envelope, no /process-key call", async () => {
    vi.mocked(isUnifiedBackboneActive).mockResolvedValue(true);
    delete process.env.INTERNAL_API_TOKEN;
    const { POST } = await import("@/app/api/strategies/csv-finalize/route");
    const res = await POST(
      jsonReq("/api/strategies/csv-finalize", {
        wizard_session_id: "44444444-4444-4444-4444-444444444444",
        fmt: "daily_returns",
        strategy_name: "Apollo CSV",
      }),
    );
    expect(res.status).toBe(503);
    expect(findProcessKeyCall()).toBeUndefined();
  });
});
