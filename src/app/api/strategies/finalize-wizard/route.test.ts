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
  // RPC call capture.
  rpcCalls: [] as Array<{ name: string; args: Record<string, unknown> }>,
  rpcResult: { data: null as unknown, error: null as unknown },
  // Admin client api_keys lookup (api_key_id) for the after() block.
  adminApiKeyId: null as string | null,
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
                data: { api_key_id: STATE.adminApiKeyId },
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === "api_keys") {
        return {
          update: () => ({
            eq: async () => ({ data: null, error: null }),
          }),
        };
      }
      throw new Error(`unexpected admin from(${table})`);
    },
  }),
}));

vi.mock("@/lib/email", () => ({
  notifyFounderNewStrategy: async () => undefined,
  resolveManagerName: async () => "Test Manager",
}));

// next/server's `after` keeps the after-callback running outside the
// request lifetime; tests don't need to wait on it. Stub to a no-op.
vi.mock("next/server", async () => {
  const actual =
    await vi.importActual<typeof import("next/server")>("next/server");
  return {
    ...actual,
    after: (_fn: () => unknown) => {
      // intentionally do not invoke — keeps fetch mocks below from
      // bleeding into the after() block's analytics calls.
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
describe("POST /api/strategies/finalize-wizard — P470 RPC error-code mapping", () => {
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
