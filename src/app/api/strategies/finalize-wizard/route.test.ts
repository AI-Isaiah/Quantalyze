/**
 * Tests for POST /api/strategies/finalize-wizard — specifically the
 * scope-broadening defense (KEY_SCOPE_BROADENED).
 *
 * Threat model
 * ------------
 * Connect-time validation only sees the scopes that existed when the
 * user pasted their key. A user can:
 *   1. Connect a read-only key (passes /api/keys/validate-and-encrypt).
 *   2. Open the exchange dashboard and toggle Trade or Withdraw on.
 *   3. Click Submit on the wizard's SubmitStep.
 *
 * Without a live re-check at finalize the now-trading key would
 * silently get a published strategy in `pending_review`. The route
 * mitigates this by force-refreshing both cache layers (Next 60s +
 * Python 15min) and aborting with 403 + KEY_SCOPE_BROADENED if the
 * live response shows `trade=true` or `withdraw=true`.
 *
 * The tests below mock the analytics-service fetch + the user-scoped
 * Supabase client and assert:
 *   - 403 KEY_SCOPE_BROADENED when live perms show trade=true.
 *   - 403 KEY_SCOPE_BROADENED when live perms show withdraw=true.
 *   - 502 KEY_NETWORK_TIMEOUT when the probe itself fails.
 *   - 502 KEY_NETWORK_TIMEOUT when the probe returns probe_error=true.
 *   - 200 happy-path when live perms remain read-only.
 *   - The probe URL carries `force_refresh=true` and the request uses
 *     `cache: 'no-store'` so the existing TTL caches cannot mask a
 *     freshly-broadened key.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("server-only", () => ({}));

const USER = {
  id: "00000000-0000-0000-0000-000000000001",
} as unknown as import("@supabase/supabase-js").User;

vi.mock("@/lib/api/withAuth", () => ({
  withAuth:
    (h: (req: NextRequest, user: typeof USER) => unknown) =>
    (req: NextRequest) =>
      h(req, USER),
}));

vi.mock("@/lib/ratelimit", () => ({
  userActionLimiter: {},
  checkLimit: vi.fn(async () => ({ success: true })),
}));

const STATE = vi.hoisted(() => ({
  // Strategy lookup result for the user-scoped client.
  strategyRow: null as { api_key_id: string | null } | null,
  strategyError: null as { message: string } | null,
  // C-0119/H-0329 — capture user-scoped strategies SELECT filters so we
  // can assert ownership defense-in-depth (.eq('user_id', user.id)).
  strategySelectEqFilters: [] as Array<{ column: string; value: unknown }>,
  // RPC call capture (user-scoped).
  rpcCalls: [] as Array<{ name: string; args: Record<string, unknown> }>,
  rpcResult: { data: null as unknown, error: null as unknown },
  // Admin RPC capture (after() block).
  adminRpcCalls: [] as Array<{ name: string; args: Record<string, unknown> }>,
  // H-0330 — forced error returned by admin.rpc('enqueue_compute_job').
  adminEnqueueError: null as { message: string } | null,
  // Admin client api_keys lookup (api_key_id) for the after() block.
  adminApiKeyId: null as string | null,
  // H-0331 — name on the DB row (admin strategies SELECT) used by
  // the founder-notify email instead of the form input.
  adminStrategyName: "Alpha Centauri" as string | null,
  // H-0322 — forced error on admin strategies SELECT so the after()
  // keyLinkErr branch is reachable from tests.
  adminStrategiesError: null as { message: string } | null,
  // H-0323 — exchange returned by admin api_keys SELECT (unified path).
  adminApiKeysExchange: "okx" as string | null,
  // H-0323 — forced error on admin api_keys.exchange SELECT (unified
  // path) so the keyRowErr fallback branch is reachable from tests.
  adminApiKeysSelectError: null as { message: string } | null,
  // H-0331 — capture the strategy name actually passed to
  // notifyFounderNewStrategy so tests can assert it came from the DB row.
  notifyFounderCalls: [] as Array<{ name: unknown; managerName: unknown }>,
  // Phase B simplify — when true, the next/server after() mock invokes
  // the callback synchronously so tests can assert the side-effect fan-out
  // (enqueue_compute_job, api_keys touch, founder notify). The mock also
  // stores the underlying promise on `afterPromise` so `flushAfter()` can
  // await it deterministically instead of guessing microtask ticks.
  runAfterCallback: false as boolean,
  afterPromise: null as Promise<unknown> | null,
  // Phase B simplify — captureToSentry call capture so tests can assert
  // Sentry escalation paths (H-0322, H-0323, H-0327 fall-through, H-0330
  // enqueue failure) without coupling to the real Sentry transport.
  captureToSentryCalls: [] as Array<{
    err: unknown;
    options: {
      tags: Record<string, string>;
      extra?: Record<string, unknown>;
      level?: string;
    };
  }>,
  // Phase B simplify — unified-backbone flag toggleable per test.
  unifiedBackboneActive: false as boolean,
  // Phase B simplify — postProcessKey upstream body (drives the H-0327
  // guard fall-through test). null means use the legacy 200 default.
  processKeyResult: null as null | {
    ok: boolean;
    body?: unknown;
    response?: unknown;
  },
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: (table: string) => {
      if (table !== "strategies") {
        throw new Error(`unexpected user-scoped from(${table})`);
      }
      // Chainable .eq() so we can capture each filter the route applies
      // (id + user_id) and assert the belt-and-braces ownership filter.
      const buildEqChain = () => ({
        eq: (column: string, value: unknown) => {
          STATE.strategySelectEqFilters.push({ column, value });
          return buildEqChain();
        },
        maybeSingle: async () => ({
          data: STATE.strategyRow,
          error: STATE.strategyError,
        }),
      });
      return {
        select: () => buildEqChain(),
      };
    },
    rpc: async (name: string, args: Record<string, unknown>) => {
      STATE.rpcCalls.push({ name, args });
      return STATE.rpcResult;
    },
  }),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (table === "strategies") {
        return {
          select: () => ({
            eq: () => ({
              single: async () => ({
                data: STATE.adminStrategiesError
                  ? null
                  : {
                      api_key_id: STATE.adminApiKeyId,
                      name: STATE.adminStrategyName,
                    },
                error: STATE.adminStrategiesError,
              }),
            }),
          }),
        };
      }
      if (table === "api_keys") {
        return {
          // Unified-path exchange resolve uses select().eq().single();
          // after() last_sync_at touch uses update().eq().
          select: () => ({
            eq: () => ({
              single: async () => ({
                data: STATE.adminApiKeysSelectError
                  ? null
                  : { exchange: STATE.adminApiKeysExchange },
                error: STATE.adminApiKeysSelectError,
              }),
            }),
          }),
          update: () => ({
            eq: async () => ({ data: null, error: null }),
          }),
        };
      }
      throw new Error(`unexpected admin from(${table})`);
    },
    rpc: async (name: string, args: Record<string, unknown>) => {
      STATE.adminRpcCalls.push({ name, args });
      if (name === "enqueue_compute_job" && STATE.adminEnqueueError) {
        return { data: null, error: STATE.adminEnqueueError };
      }
      return { data: "fake-job-id", error: null };
    },
  }),
}));

vi.mock("@/lib/sentry-capture", () => ({
  captureToSentry: (
    err: unknown,
    options: {
      tags: Record<string, string>;
      extra?: Record<string, unknown>;
      level?: string;
    },
  ) => {
    STATE.captureToSentryCalls.push({ err, options });
  },
}));

vi.mock("@/lib/feature-flags", () => ({
  isUnifiedBackboneActive: async () => STATE.unifiedBackboneActive,
}));

vi.mock("@/lib/process-key-client", () => ({
  postProcessKey: async () =>
    STATE.processKeyResult ?? {
      ok: true,
      body: { queued: true, verification_id: "ver-1" },
    },
}));

vi.mock("@/lib/email", () => ({
  notifyFounderNewStrategy: async (name: unknown, managerName: unknown) => {
    STATE.notifyFounderCalls.push({ name, managerName });
    return undefined;
  },
  resolveManagerName: async () => "Test Manager",
}));

// next/server's `after` keeps the after-callback running outside the
// request lifetime; tests don't need to wait on it. Stub to a no-op by
// default. Tests that need to assert side-effect fan-out (H-0330
// enqueue_compute_job, etc.) set STATE.runAfterCallback=true to invoke
// the callback synchronously.
vi.mock("next/server", async () => {
  const actual =
    await vi.importActual<typeof import("next/server")>("next/server");
  return {
    ...actual,
    after: (fn: () => unknown) => {
      if (STATE.runAfterCallback) {
        // Store the promise so flushAfter() can await it deterministically.
        // A bare setImmediate flushed only one microtask tick, which left
        // races against nested awaits inside the after() callback.
        STATE.afterPromise = Promise.resolve()
          .then(fn)
          .catch(() => {});
      }
    },
  };
});

const STRATEGY_ID = "11111111-1111-4111-8111-111111111111";
const API_KEY_ID = "22222222-2222-4222-8222-222222222222";
const CATEGORY_ID = "33333333-3333-4333-8333-333333333333";

const VALID_BODY = {
  strategy_id: STRATEGY_ID,
  // STRATEGY_NAMES exposes a curated list — pull the first entry at
  // runtime so the body stays valid even as the list evolves.
  name: "" as string,
  description: "A descriptive blurb that exceeds ten chars and is plausible.",
  category_id: CATEGORY_ID,
  strategy_types: ["trend"],
  subtypes: ["breakout"],
  markets: ["BTC/USDT"],
  supported_exchanges: ["binance"],
  leverage_range: "1x-3x",
  aum: 100_000,
  max_capacity: 10_000_000,
};

function makeReq(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/strategies/finalize-wizard", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "http://localhost:3000",
    },
    body: JSON.stringify(body),
  });
}

beforeEach(async () => {
  vi.clearAllMocks();
  STATE.strategyRow = { api_key_id: API_KEY_ID };
  STATE.strategyError = null;
  STATE.strategySelectEqFilters = [];
  STATE.rpcCalls = [];
  STATE.rpcResult = { data: STRATEGY_ID, error: null };
  STATE.adminApiKeyId = API_KEY_ID;
  STATE.adminStrategyName = "Alpha Centauri";
  STATE.adminStrategiesError = null;
  STATE.adminApiKeysExchange = "okx";
  STATE.adminApiKeysSelectError = null;
  STATE.adminEnqueueError = null;
  STATE.notifyFounderCalls = [];
  STATE.adminRpcCalls = [];
  STATE.captureToSentryCalls = [];
  STATE.unifiedBackboneActive = false;
  STATE.processKeyResult = null;
  STATE.runAfterCallback = false;
  STATE.afterPromise = null;
  delete process.env.USE_COMPUTE_JOBS_QUEUE;
  process.env.INTERNAL_API_TOKEN = "test-internal-token";
  process.env.ANALYTICS_SERVICE_URL = "http://analytics.test";
  // Resolve a real allowed name for the body.
  const { STRATEGY_NAMES } = await import("@/lib/constants");
  VALID_BODY.name = STRATEGY_NAMES[0];
});

async function importPost() {
  const mod = await import("./route");
  return mod.POST;
}

function mockProbeReadOnly(): ReturnType<typeof vi.spyOn> {
  return vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(
      JSON.stringify({
        read: true,
        trade: false,
        withdraw: false,
        probe_error: false,
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    ),
  );
}

// next/server's after() mock stores the callback promise on
// STATE.afterPromise; await it directly so nested `await`s inside the
// callback (Promise.all + Promise.allSettled + chained admin RPCs) are
// fully drained before assertions, instead of racing the scheduler.
async function flushAfter(): Promise<void> {
  if (STATE.afterPromise) {
    await STATE.afterPromise;
  }
}

describe("POST /api/strategies/finalize-wizard — scope-broadening defense", () => {
  it("returns 403 KEY_SCOPE_BROADENED when the live re-check shows trade=true", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          read: true,
          trade: true,
          withdraw: false,
          probe_error: false,
          detected_at: "2026-05-05T00:00:00Z",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    const POST = await importPost();
    const res = await POST(makeReq(VALID_BODY));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.code).toBe("KEY_SCOPE_BROADENED");
    // The finalize RPC must NOT have been called — the broadened key
    // must never reach pending_review.
    expect(STATE.rpcCalls.find((c) => c.name === "finalize_wizard_strategy"))
      .toBeUndefined();

    // The probe URL must include force_refresh=true and the request
    // must use cache: 'no-store' to bypass both cache layers.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [calledUrl, calledInit] = fetchSpy.mock.calls[0];
    expect(String(calledUrl)).toContain("force_refresh=true");
    expect(String(calledUrl)).toContain(
      `/internal/keys/${API_KEY_ID}/permissions`,
    );
    expect((calledInit as RequestInit | undefined)?.cache).toBe("no-store");
    fetchSpy.mockRestore();
  });

  it("returns 403 KEY_SCOPE_BROADENED when the live re-check shows withdraw=true", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          read: true,
          trade: false,
          withdraw: true,
          probe_error: false,
          detected_at: "2026-05-05T00:00:00Z",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    const POST = await importPost();
    const res = await POST(makeReq(VALID_BODY));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.code).toBe("KEY_SCOPE_BROADENED");
    fetchSpy.mockRestore();
  });

  it("returns 502 KEY_NETWORK_TIMEOUT when the probe itself fails", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("ECONNREFUSED"));
    const consoleErr = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    const POST = await importPost();
    const res = await POST(makeReq(VALID_BODY));
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.code).toBe("KEY_NETWORK_TIMEOUT");
    // RPC must not have run — fail closed on probe errors.
    expect(STATE.rpcCalls.find((c) => c.name === "finalize_wizard_strategy"))
      .toBeUndefined();

    consoleErr.mockRestore();
    fetchSpy.mockRestore();
  });

  it("returns 502 KEY_NETWORK_TIMEOUT when the probe returns probe_error=true", async () => {
    // probe_error=true is the Python fail-CLOSED default that fires
    // when the live exchange call itself raised. We must NOT treat
    // that as KEY_SCOPE_BROADENED — the user did nothing wrong.
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          read: true,
          trade: true,
          withdraw: true,
          probe_error: true,
          detected_at: "2026-05-05T00:00:00Z",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    const POST = await importPost();
    const res = await POST(makeReq(VALID_BODY));
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.code).toBe("KEY_NETWORK_TIMEOUT");
    fetchSpy.mockRestore();
  });

  it("calls the finalize RPC and returns 200 when the live re-check stays read-only", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          read: true,
          trade: false,
          withdraw: false,
          probe_error: false,
          detected_at: "2026-05-05T00:00:00Z",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    const POST = await importPost();
    const res = await POST(makeReq(VALID_BODY));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.strategy_id).toBe(STRATEGY_ID);
    expect(body.status).toBe("pending_review");
    expect(
      STATE.rpcCalls.find((c) => c.name === "finalize_wizard_strategy"),
    ).toBeDefined();
    fetchSpy.mockRestore();
  });

  it("skips the live probe when the strategy has no api_key_id (CSV branch)", async () => {
    STATE.strategyRow = { api_key_id: null };
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const POST = await importPost();
    const res = await POST(makeReq(VALID_BODY));
    expect(res.status).toBe(200);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(
      STATE.rpcCalls.find((c) => c.name === "finalize_wizard_strategy"),
    ).toBeDefined();
    fetchSpy.mockRestore();
  });

  it("returns 404 when the strategy lookup finds no row", async () => {
    STATE.strategyRow = null;
    const POST = await importPost();
    const res = await POST(makeReq(VALID_BODY));
    expect(res.status).toBe(404);
    expect(
      STATE.rpcCalls.find((c) => c.name === "finalize_wizard_strategy"),
    ).toBeUndefined();
  });

  // audit-2026-05-07 C-0119/H-0329 — belt-and-braces ownership filter.
  // RLS on `strategies` is the primary defense, but if it ever regresses
  // the route MUST still scope the SELECT by user_id so an attacker
  // can't trigger the Railway probe + admin-client api_keys lookup on a
  // victim's strategy_id.
  it("scopes the strategies lookup with .eq('user_id', user.id) for defense-in-depth", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          read: true,
          trade: false,
          withdraw: false,
          probe_error: false,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    const POST = await importPost();
    await POST(makeReq(VALID_BODY));

    expect(STATE.strategySelectEqFilters).toContainEqual({
      column: "id",
      value: STRATEGY_ID,
    });
    expect(STATE.strategySelectEqFilters).toContainEqual({
      column: "user_id",
      value: USER.id,
    });
    fetchSpy.mockRestore();
  });
});

/**
 * P470 — RPC error-code → HTTP status mapping.
 *
 * route.ts:413-431 maps four Postgres SQLSTATE codes raised by
 * `finalize_wizard_strategy` (migration 031) onto stable HTTP statuses +
 * sanitized error bodies:
 *
 *   P0002 (no_data_found)          -> 404 "Draft not found"
 *   02000 (no_data)                -> 404 "Draft not found"
 *   42501 (insufficient_privilege) -> 403 "This draft cannot be finalized"
 *   22023 (invalid_parameter_value)-> 403 "This draft cannot be finalized"
 *   anything else                  -> 500 "Could not finalize wizard draft"
 *
 * Pre-fix this mapping table had ZERO test coverage. A regression that
 * dropped one of the codes (e.g., removed the 42501 branch) would either
 * leak the raw Postgres message to the client (P445-style PII leak) or
 * return a misleading 500 on a legitimate "not your draft" attempt.
 *
 * Each test forces the scope-broadening probe to PASS (live perms stay
 * read-only) so control reaches the RPC, then makes the RPC reject with
 * the target code. We assert (i) the HTTP status, (ii) a stable error
 * code/text, and (iii) that the raw Postgres message does NOT leak.
 */
/**
 * audit-2026-05-07 H-0330 — wizard finalize MUST enqueue the
 * sync_trades compute job (gated by USE_COMPUTE_JOBS_QUEUE) so the
 * strategy advances past computation_status='pending' on Round 2
 * cutover. Pre-fix the only enqueue lived in /api/keys/sync behind a
 * manual "Sync now" button; removing that button would orphan every
 * new wizard submission.
 *
 * Tests assert:
 *   - With the flag ON + a linked api_key, the after() block calls
 *     enqueue_compute_job exactly once with p_kind='sync_trades'.
 *   - With the flag OFF (default), no enqueue runs.
 *   - With the flag ON but no api_key (CSV branch), no enqueue runs.
 */
describe("POST /api/strategies/finalize-wizard — H-0330 enqueue_compute_job", () => {
  it("enqueues sync_trades when USE_COMPUTE_JOBS_QUEUE=true and a key is linked", async () => {
    const fetchSpy = mockProbeReadOnly();
    process.env.USE_COMPUTE_JOBS_QUEUE = "true";
    STATE.runAfterCallback = true;

    const POST = await importPost();
    const res = await POST(makeReq(VALID_BODY));
    expect(res.status).toBe(200);

    await flushAfter();

    const enqueueCall = STATE.adminRpcCalls.find(
      (c) => c.name === "enqueue_compute_job",
    );
    expect(enqueueCall).toBeDefined();
    expect(enqueueCall!.args.p_kind).toBe("sync_trades");
    expect(enqueueCall!.args.p_strategy_id).toBe(STRATEGY_ID);

    fetchSpy.mockRestore();
  });

  it("does NOT enqueue when USE_COMPUTE_JOBS_QUEUE is unset (legacy default)", async () => {
    const fetchSpy = mockProbeReadOnly();
    STATE.runAfterCallback = true;

    const POST = await importPost();
    await POST(makeReq(VALID_BODY));

    await flushAfter();

    const enqueueCall = STATE.adminRpcCalls.find(
      (c) => c.name === "enqueue_compute_job",
    );
    expect(enqueueCall).toBeUndefined();

    fetchSpy.mockRestore();
  });

  it("does NOT enqueue when the strategy has no linked api_key (CSV branch)", async () => {
    STATE.strategyRow = { api_key_id: null };
    STATE.adminApiKeyId = null;
    process.env.USE_COMPUTE_JOBS_QUEUE = "true";
    STATE.runAfterCallback = true;

    const POST = await importPost();
    await POST(makeReq(VALID_BODY));

    await flushAfter();

    const enqueueCall = STATE.adminRpcCalls.find(
      (c) => c.name === "enqueue_compute_job",
    );
    expect(enqueueCall).toBeUndefined();
  });
});

/**
 * audit-2026-05-07 H-0331 — founder email name comes from the DB row,
 * not the form input. The validated form value may diverge from the row
 * because finalize_wizard_strategy is allowed to sanitize/transform
 * names. Pulling from the row keeps the founder email and admin UI on
 * one source of truth.
 */
describe("POST /api/strategies/finalize-wizard — H-0331 founder-email canonical name", () => {
  it("uses the DB-row name when it differs from the form input", async () => {
    const fetchSpy = mockProbeReadOnly();
    STATE.adminStrategyName = "Sanitized DB Name";
    STATE.runAfterCallback = true;

    const POST = await importPost();
    await POST(makeReq(VALID_BODY));
    await flushAfter();

    expect(STATE.notifyFounderCalls.length).toBe(1);
    expect(STATE.notifyFounderCalls[0].name).toBe("Sanitized DB Name");
    fetchSpy.mockRestore();
  });

  it("falls back to the form input when the DB-row name is missing", async () => {
    const fetchSpy = mockProbeReadOnly();
    STATE.adminStrategyName = null;
    STATE.runAfterCallback = true;

    const POST = await importPost();
    await POST(makeReq(VALID_BODY));
    await flushAfter();

    expect(STATE.notifyFounderCalls.length).toBe(1);
    // VALID_BODY.name is set to STRATEGY_NAMES[0] in beforeEach.
    expect(STATE.notifyFounderCalls[0].name).toBe(VALID_BODY.name);
    fetchSpy.mockRestore();
  });
});

/**
 * audit-2026-05-07 H-0325/H-0326 — dollar-amount fail-LOUD validation.
 *
 * Pre-fix, invalid aum / max_capacity values (negative, NaN, > 1e12,
 * non-number) were silently coerced to NULL and the strategy finalized
 * with missing AUM. That produced "Verified by Quantalyze" factsheets
 * with zero AUM — at minimum bad UX, at worst regulatory exposure.
 *
 * Contract: client must send a finite number in [0, 1e12) or omit the
 * field entirely (null / undefined). Invalid values now return 400.
 */
describe("POST /api/strategies/finalize-wizard — H-0325 dollar-amount validation", () => {
  it("rejects negative aum with 400", async () => {
    const POST = await importPost();
    const res = await POST(makeReq({ ...VALID_BODY, aum: -5_000_000 }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/aum/);
    expect(
      STATE.rpcCalls.find((c) => c.name === "finalize_wizard_strategy"),
    ).toBeUndefined();
  });

  it("rejects aum at-or-above the 1e12 ceiling with 400", async () => {
    const POST = await importPost();
    const res = await POST(makeReq({ ...VALID_BODY, aum: 1e20 }));
    expect(res.status).toBe(400);
  });

  it("rejects non-numeric aum (string) with 400", async () => {
    const POST = await importPost();
    const res = await POST(makeReq({ ...VALID_BODY, aum: "foo" }));
    expect(res.status).toBe(400);
  });

  it("rejects invalid max_capacity with 400", async () => {
    const POST = await importPost();
    const res = await POST(makeReq({ ...VALID_BODY, max_capacity: -1 }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/max_capacity/);
  });

  it("accepts omitted aum (undefined / null)", async () => {
    const fetchSpy = mockProbeReadOnly();

    const POST = await importPost();
    const bodyNoAum: Record<string, unknown> = { ...VALID_BODY };
    delete bodyNoAum.aum;
    const res = await POST(makeReq(bodyNoAum));
    expect(res.status).toBe(200);
    fetchSpy.mockRestore();
  });
});

describe("POST /api/strategies/finalize-wizard — P470 RPC error-code mapping", () => {
  it("maps P0002 (no_data_found) to 404 + sanitized 'Draft not found'", async () => {
    const fetchSpy = mockProbeReadOnly();
    const consoleErr = vi.spyOn(console, "error").mockImplementation(() => {});
    STATE.rpcResult = {
      data: null,
      // Raw Postgres-style message; must NOT leak to the client.
      error: { code: "P0002", message: "finalize_wizard_strategy: strategy abc-uuid not found" },
    };

    const POST = await importPost();
    const res = await POST(makeReq(VALID_BODY));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("Draft not found");
    // The raw Postgres message must not leak (P445-style hardening).
    expect(JSON.stringify(body)).not.toContain("strategy abc-uuid not found");

    fetchSpy.mockRestore();
    consoleErr.mockRestore();
  });

  it("maps 02000 (no_data) to 404 + sanitized 'Draft not found'", async () => {
    const fetchSpy = mockProbeReadOnly();
    const consoleErr = vi.spyOn(console, "error").mockImplementation(() => {});
    STATE.rpcResult = {
      data: null,
      error: { code: "02000", message: "no data returned by the query" },
    };

    const POST = await importPost();
    const res = await POST(makeReq(VALID_BODY));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("Draft not found");
    expect(JSON.stringify(body)).not.toContain("no data returned");

    fetchSpy.mockRestore();
    consoleErr.mockRestore();
  });

  it("maps 42501 (insufficient_privilege) to 403 + sanitized 'This draft cannot be finalized'", async () => {
    const fetchSpy = mockProbeReadOnly();
    const consoleErr = vi.spyOn(console, "error").mockImplementation(() => {});
    STATE.rpcResult = {
      data: null,
      error: {
        code: "42501",
        message:
          "finalize_wizard_strategy: strategy xyz-uuid is not owned by user uid-1234",
      },
    };

    const POST = await importPost();
    const res = await POST(makeReq(VALID_BODY));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe("This draft cannot be finalized");
    // The raw owner/user UUIDs MUST NOT leak (P445-style hardening).
    expect(JSON.stringify(body)).not.toContain("xyz-uuid");
    expect(JSON.stringify(body)).not.toContain("uid-1234");

    fetchSpy.mockRestore();
    consoleErr.mockRestore();
  });

  it("maps 22023 (invalid_parameter_value) to 403 + sanitized 'This draft cannot be finalized'", async () => {
    const fetchSpy = mockProbeReadOnly();
    const consoleErr = vi.spyOn(console, "error").mockImplementation(() => {});
    STATE.rpcResult = {
      data: null,
      error: {
        code: "22023",
        message:
          "finalize_wizard_strategy: strategy abc has source=legacy (expected wizard)",
      },
    };

    const POST = await importPost();
    const res = await POST(makeReq(VALID_BODY));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe("This draft cannot be finalized");
    // The raw status/source details must not leak (P445-style hardening).
    expect(JSON.stringify(body)).not.toContain("source=legacy");

    fetchSpy.mockRestore();
    consoleErr.mockRestore();
  });

  it("falls through to 500 + generic message for any other SQLSTATE", async () => {
    const fetchSpy = mockProbeReadOnly();
    const consoleErr = vi.spyOn(console, "error").mockImplementation(() => {});
    // A made-up unhandled code — must NOT silently 200, must NOT leak.
    STATE.rpcResult = {
      data: null,
      error: { code: "XX001", message: "internal_error: oops at line 42" },
    };

    const POST = await importPost();
    const res = await POST(makeReq(VALID_BODY));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("Could not finalize wizard draft");
    expect(JSON.stringify(body)).not.toContain("oops at line 42");

    fetchSpy.mockRestore();
    consoleErr.mockRestore();
  });
});

/**
 * Phase B simplify — H-0328 probe-error log token sanitization.
 *
 * The probe-error catch block in route.ts:273-292 must NEVER write the raw
 * error object to console.error: some undici/fetch error stringifications
 * include the outgoing request init, which carries
 * `X-Internal-Token: $INTERNAL_API_TOKEN`. Landing that in Vercel runtime
 * logs is a P445-style secrets-in-logs vulnerability — readable by any
 * team member with log access.
 *
 * This test was a gap in the original H-0328 commit. A regression that
 * swaps `safeMessage` for `${probeErr}` would pass every other test today.
 */
describe("POST /api/strategies/finalize-wizard — H-0328 probe-error log sanitization", () => {
  it("does NOT leak INTERNAL_API_TOKEN substrings into the probe-error log", async () => {
    // Build a probe error whose message AND name embed the live token, as
    // a stack-trace dump would in the wild.
    const leaky = new Error(
      "permissions probe failed: outgoing init carried X-Internal-Token: test-internal-token",
    );
    leaky.name = "TokenLeakingError(test-internal-token)";
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(leaky);
    const consoleErr = vi.spyOn(console, "error").mockImplementation(() => {});

    const POST = await importPost();
    const res = await POST(makeReq(VALID_BODY));
    expect(res.status).toBe(502);

    // Aggregate everything console.error received and assert the token
    // substring never appears, regardless of which argument site leaks it.
    const errArgs = consoleErr.mock.calls
      .map((args) => args.map((a) => String(a)).join(" "))
      .join("\n");
    expect(errArgs).not.toContain("test-internal-token");
    // Sanity: the safe formatter still emits something useful.
    expect(errArgs).toMatch(/permissions probe failed/);

    consoleErr.mockRestore();
    fetchSpy.mockRestore();
  });
});

/**
 * Phase B simplify — H-0322 Sentry escalation when admin strategies
 * SELECT (api_key_id, name) fails inside after().
 *
 * The keyLinkErr branch was added by H-0322 to prevent a transient PG blip
 * from silently skipping the last_sync_at touch (Sprint-2 cleanup would
 * then treat the key as abandoned and GC it). The original commit logged
 * + escalated to Sentry but the escalation chain had no behavioral test.
 */
describe("POST /api/strategies/finalize-wizard — H-0322 Sentry escalation on keyLinkErr", () => {
  it("captures the admin strategies error to Sentry and still fires the founder email", async () => {
    const fetchSpy = mockProbeReadOnly();
    const consoleWarn = vi
      .spyOn(console, "warn")
      .mockImplementation(() => {});
    STATE.adminStrategiesError = { message: "transient PG blip" };
    STATE.runAfterCallback = true;

    const POST = await importPost();
    const res = await POST(makeReq(VALID_BODY));
    expect(res.status).toBe(200);
    await flushAfter();

    const sentryCall = STATE.captureToSentryCalls.find(
      (c) => c.options.tags.side_effect === "api_key_id_lookup",
    );
    expect(sentryCall).toBeDefined();
    expect(sentryCall!.options.tags.surface).toBe("finalize-wizard-after");
    expect(sentryCall!.options.extra?.strategy_id).toBe(STRATEGY_ID);

    // The founder email is independent of keyLinkErr and must still run
    // (resilience: a failed lookup must not silently mute the founder).
    expect(STATE.notifyFounderCalls.length).toBe(1);

    consoleWarn.mockRestore();
    fetchSpy.mockRestore();
  });
});

/**
 * Phase B simplify — H-0323 / unified-path Sentry escalation when admin
 * api_keys.exchange SELECT fails.
 *
 * Phase B-1 added captureToSentry to mirror the H-0322 pattern. Without
 * Sentry, a transient PG blip silently routes a Binance/Bybit key through
 * the OKX-specific code path with only a console.warn line — not
 * alertable on Vercel.
 */
describe("POST /api/strategies/finalize-wizard — H-0323 Sentry escalation on keyRowErr", () => {
  it("captures the api_keys.exchange error to Sentry and falls back to 'okx'", async () => {
    const fetchSpy = mockProbeReadOnly();
    const consoleWarn = vi
      .spyOn(console, "warn")
      .mockImplementation(() => {});
    STATE.unifiedBackboneActive = true;
    STATE.adminApiKeysSelectError = { message: "stale snapshot" };

    const POST = await importPost();
    const res = await POST(makeReq(VALID_BODY));
    // Unified path returns the postProcessKey envelope translated; the
    // status code here just needs to not be 5xx (we're testing the
    // exchange-resolve branch, not the unified response shape).
    expect(res.status).toBe(200);

    const sentryCall = STATE.captureToSentryCalls.find(
      (c) => c.options.tags.step === "unified-exchange-resolve",
    );
    expect(sentryCall).toBeDefined();
    expect(sentryCall!.options.tags.surface).toBe("finalize-wizard");
    expect(sentryCall!.options.extra?.strategy_id).toBe(STRATEGY_ID);
    expect(sentryCall!.options.extra?.api_key_id).toBe(API_KEY_ID);

    consoleWarn.mockRestore();
    fetchSpy.mockRestore();
  });
});

/**
 * Phase B simplify — H-0327 type-guard fall-through.
 *
 * When the upstream /process-key body doesn't match the onboard shape
 * (rename, partial deploy, AI gateway shape drift, proxy strip), the
 * route MUST surface the contract violation as a 502 + Sentry rather
 * than passing the opaque body through with status 200 — the wizard
 * client would otherwise read `body.strategy_id === undefined` and
 * pretend the submission succeeded.
 */
describe("POST /api/strategies/finalize-wizard — H-0327 unified contract violation", () => {
  it("returns 502 + Sentry when upstream `queued` is a string instead of boolean", async () => {
    const fetchSpy = mockProbeReadOnly();
    const consoleErr = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    STATE.unifiedBackboneActive = true;
    STATE.processKeyResult = {
      ok: true,
      body: { queued: "yes", verification_id: "ver-1" },
    };

    const POST = await importPost();
    const res = await POST(makeReq(VALID_BODY));
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toMatch(/unexpected response/i);

    const sentryCall = STATE.captureToSentryCalls.find(
      (c) => c.options.tags.step === "unified-response-parse",
    );
    expect(sentryCall).toBeDefined();
    expect(sentryCall!.options.extra?.strategy_id).toBe(STRATEGY_ID);

    consoleErr.mockRestore();
    fetchSpy.mockRestore();
  });

  it("returns 502 when upstream body has no `queued` field at all", async () => {
    const fetchSpy = mockProbeReadOnly();
    const consoleErr = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    STATE.unifiedBackboneActive = true;
    STATE.processKeyResult = {
      ok: true,
      body: { verification_id: "ver-1" },
    };

    const POST = await importPost();
    const res = await POST(makeReq(VALID_BODY));
    expect(res.status).toBe(502);

    consoleErr.mockRestore();
    fetchSpy.mockRestore();
  });

  it("returns 200 + translated envelope when upstream matches the onboard shape", async () => {
    const fetchSpy = mockProbeReadOnly();
    STATE.unifiedBackboneActive = true;
    STATE.processKeyResult = {
      ok: true,
      body: { queued: true, verification_id: "ver-1" },
    };

    const POST = await importPost();
    const res = await POST(makeReq(VALID_BODY));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.strategy_id).toBe(STRATEGY_ID);
    expect(body.status).toBe("pending_review");
    expect(body.queued).toBe(true);
    expect(body.verification_id).toBe("ver-1");

    fetchSpy.mockRestore();
  });

  // Phase C simplify — discriminated union test: WIZARD_DUPLICATE envelope.
  // queued=false branch must surface `code` and `idempotent` so wizard chrome
  // routes the duplicate copy on the idempotent-resume path.
  it("returns 200 + WIZARD_DUPLICATE envelope when upstream queued=false", async () => {
    const fetchSpy = mockProbeReadOnly();
    STATE.unifiedBackboneActive = true;
    STATE.processKeyResult = {
      ok: true,
      body: {
        queued: false,
        code: "WIZARD_DUPLICATE",
        idempotent: true,
        verification_id: "ver-existing",
      },
    };

    const POST = await importPost();
    const res = await POST(makeReq(VALID_BODY));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.queued).toBe(false);
    expect(body.code).toBe("WIZARD_DUPLICATE");
    expect(body.idempotent).toBe(true);
    expect(body.verification_id).toBe("ver-existing");
    expect(body.strategy_id).toBe(STRATEGY_ID);

    fetchSpy.mockRestore();
  });

  // Phase C simplify — discriminated guard: a mixed envelope
  // (queued=true + code/idempotent set) is a backbone bug, NOT a valid
  // shape. Wizard chrome would otherwise treat it as both "queued" AND
  // "duplicate" and double-process. Reject with 502 + Sentry.
  it("rejects mixed envelope (queued=true with code field) with 502", async () => {
    const fetchSpy = mockProbeReadOnly();
    const consoleErr = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    STATE.unifiedBackboneActive = true;
    STATE.processKeyResult = {
      ok: true,
      body: {
        queued: true,
        verification_id: "ver-1",
        code: "WIZARD_DUPLICATE",
      },
    };

    const POST = await importPost();
    const res = await POST(makeReq(VALID_BODY));
    expect(res.status).toBe(502);

    const sentryCall = STATE.captureToSentryCalls.find(
      (c) => c.options.tags.step === "unified-response-parse",
    );
    expect(sentryCall).toBeDefined();

    consoleErr.mockRestore();
    fetchSpy.mockRestore();
  });

  // Phase C simplify — queued=true without verification_id is also a
  // contract violation (Python always returns it on the queued branch).
  it("rejects queued=true with missing verification_id with 502", async () => {
    const fetchSpy = mockProbeReadOnly();
    const consoleErr = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    STATE.unifiedBackboneActive = true;
    STATE.processKeyResult = {
      ok: true,
      body: { queued: true },
    };

    const POST = await importPost();
    const res = await POST(makeReq(VALID_BODY));
    expect(res.status).toBe(502);

    consoleErr.mockRestore();
    fetchSpy.mockRestore();
  });

  // Phase C simplify — queued=false without code is also a contract
  // violation (Python always returns `code: "WIZARD_DUPLICATE"` on the
  // dedup-hit branch).
  it("rejects queued=false with missing code with 502", async () => {
    const fetchSpy = mockProbeReadOnly();
    const consoleErr = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    STATE.unifiedBackboneActive = true;
    STATE.processKeyResult = {
      ok: true,
      body: { queued: false, verification_id: "ver-1" },
    };

    const POST = await importPost();
    const res = await POST(makeReq(VALID_BODY));
    expect(res.status).toBe(502);

    consoleErr.mockRestore();
    fetchSpy.mockRestore();
  });
});

/**
 * Phase B simplify — H-0330 enqueue_compute_job failure → Sentry path.
 *
 * The "enqueues on success" path is covered above. This block exercises
 * the rejection chain: enqueue_compute_job returns an error → run()
 * throws → Promise.allSettled marks the side effect rejected → the loop
 * escalates to Sentry. Without this test, dropping the throw would land
 * strategies in compute_status='pending' forever (with only the 24h
 * reconcile-strategies cron as a backstop).
 */
describe("POST /api/strategies/finalize-wizard — H-0330 enqueue failure escalation", () => {
  it("escalates enqueue_compute_job failures to Sentry without breaking 200", async () => {
    const fetchSpy = mockProbeReadOnly();
    const consoleWarn = vi
      .spyOn(console, "warn")
      .mockImplementation(() => {});
    process.env.USE_COMPUTE_JOBS_QUEUE = "true";
    STATE.adminEnqueueError = { message: "duplicate key value" };
    STATE.runAfterCallback = true;

    const POST = await importPost();
    const res = await POST(makeReq(VALID_BODY));
    expect(res.status).toBe(200);
    await flushAfter();

    const sentryCall = STATE.captureToSentryCalls.find(
      (c) =>
        c.options.tags.side_effect === "enqueue_sync_trades_job" &&
        c.options.tags.surface === "finalize-wizard-after",
    );
    expect(sentryCall).toBeDefined();

    // Founder email must still fire — side effects are independent.
    expect(STATE.notifyFounderCalls.length).toBe(1);

    consoleWarn.mockRestore();
    fetchSpy.mockRestore();
  });
});
