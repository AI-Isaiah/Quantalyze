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

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
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

// ⛔ THE PREDICATE IS THE REAL ONE (153.2 review WR-03). Only the two seams this
// suite must control — the limiter handle and the async `checkLimit` call — are
// replaced; everything else, including `isRateLimitMisconfigured`, comes through
// `importOriginal`.
//
// What was here before was a hand-written double:
//   `isRateLimitMisconfigured: (rl) => rl?.misconfigured === true`
// over a fixture shape `CheckLimitResult` cannot express — the production type
// has no `misconfigured` field at all, and the real predicate reads
// `result.success === false && result.reason === "ratelimit_misconfigured"`.
// The comment beside it claimed it was "the real predicate's shape", which was
// false. The 503 arm did execute, so the row was not vacuous — but the
// DISCRIMINATION it demonstrated was one the test had authored for itself, and a
// route change that read the real discriminator would have kept it green. A
// double that cannot be wrong in the ways the original can be is not a double.
vi.mock("@/lib/ratelimit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ratelimit")>()),
  userActionLimiter: {},
  checkLimit: vi.fn(async () => ({ success: true })),
}));

const STATE = vi.hoisted(() => ({
  // Strategy lookup result for the user-scoped client.
  // 140.3-14 / TS-33 — `wizard_session_id` is OPTIONAL here on purpose: every
  // pre-existing case sets only `api_key_id`, so it reads `undefined` and the
  // route forwards NO id, which is exactly the pre-140.3-14 wire body.
  strategyRow: null as {
    api_key_id: string | null;
    wizard_session_id?: string | null;
  } | null,
  strategyError: null as { message: string } | null,
  // C-0119/H-0329 — capture user-scoped strategies SELECT filters so we
  // can assert ownership defense-in-depth (.eq('user_id', user.id)).
  strategySelectEqFilters: [] as Array<{ column: string; value: unknown }>,
  // RPC call capture (user-scoped).
  rpcCalls: [] as Array<{ name: string; args: Record<string, unknown> }>,
  rpcResult: { data: null as unknown, error: null as unknown },
  // #597 — capture the user-scoped strategies.asset_class UPDATE patch(es) so
  // tests can assert the manager's asset-class choice is persisted; the forced
  // error exercises the non-blocking log branch.
  assetClassUpdates: [] as Array<Record<string, unknown>>,
  assetClassUpdateError: null as { message: string } | null,
  // Phase 150 / OWN-03 — every user-scoped strategies UPDATE, with the .eq()
  // filters it carried. `assetClassUpdates` above records only the patch, which
  // cannot express the T-150-10 mitigation (the mark write must be pinned to
  // BOTH the finalized id and the caller's user_id — strategies_update RLS has
  // no WITH CHECK, so an un-scoped patch is the elevation-of-privilege path).
  strategyUpdates: [] as Array<{
    patch: Record<string, unknown>;
    eqs: Array<{ column: string; value: unknown }>;
  }>,
  // Forced error / rows for the capital_ownership UPDATE specifically, so the
  // degradation arm is reachable without disturbing the asset_class write.
  capitalOwnershipUpdateError: null as { message: string } | null,
  capitalOwnershipUpdateRows: [{ id: "" }] as Array<{ id: string }> | null,
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
  // 153.6-04 / PARITY-04 — the SERVER-ATTESTED venue returned by the same admin
  // api_keys SELECT (the route widened it to `select("exchange, attested_venue")`,
  // so both columns arrive on one round trip and both are drivable from a test).
  //
  // ⭐ IT IS A SEPARATE FIELD FROM `adminApiKeysExchange` ON PURPOSE, and the
  // separation IS the fixture. `exchange` is client-writable at INSERT (the
  // 20260810120000 lock only revoked UPDATE), so the two columns can DISAGREE on a
  // real row: that is the forged label. A harness that derived one from the other
  // could not express the state cluster D exists to close.
  //
  // Default mirrors `adminApiKeysExchange`'s "okx" so the baseline row is an
  // ordinary post-backfill key that agrees with itself; the NULL (legacy /
  // trigger-scrubbed) state is driven EXPLICITLY by the rows that test it.
  adminApiKeysAttestedVenue: "okx" as string | null,
  // H-0323 — forced error on admin api_keys.exchange SELECT (unified
  // path) so the keyRowErr fallback branch is reachable from tests.
  adminApiKeysSelectError: null as { message: string } | null,
  // Phase 86 (COMP-02) — strategy_keys member count for the composite dispatch
  // branch. >0 ⇒ enqueue stitch_composite; 0 ⇒ legacy sync_trades. The forced
  // error exercises the W-4 fail-CLOSED branch (surface, never enqueue).
  strategyKeysCount: 0 as number | null,
  strategyKeysCountError: null as { message: string } | null,
  // Phase 88 (ONB-01) — the ordered member list read by the composite-first
  // hoist's O-1 per-member scope-broadening loop (select api_key_id ORDER BY
  // seq). A read error fails CLOSED (never enqueue an un-enumerable composite).
  // 153.2-04 / WIZFORM-04 — the member rows carry the widened `api_keys (
  // exchange )` embed the route now selects, so a member's VENUE is drivable
  // from a test. OPTIONAL: every pre-existing row omits it, which is exactly the
  // "embed came back empty" case, and those members must still be probed.
  //
  // 153.6-04 / PARITY-04 — the embed gained `attested_venue`, and it is OPTIONAL
  // for the same reason `api_keys` itself is: a member row that carries only
  // `exchange` is a real state (a legacy row, or the shape a pre-migration schema
  // cache returns), and by the fail-toward rule it must PARSE and be PROBED rather
  // than refuse the finalize.
  strategyKeysList: [] as Array<{
    api_key_id: string | null;
    api_keys?: {
      exchange: string | null;
      attested_venue?: string | null;
    } | null;
  }> | null,
  // CR-01: typed as an open record, not `{ message: string }`. A Supabase error
  // on the NON-throwing path is a PLAIN parsed-JSON object carrying `code`,
  // `details` and `hint` as well — the fields the operator actually needs — and
  // a narrower type here would have made the "[object Object]" defect
  // unexpressible in a test.
  strategyKeysListError: null as Record<string, unknown> | null,
  // Phase 140.2-10 / SEAMCORE-10 — the `.limit(n)` argument the member read
  // carried, captured so a test can assert the fan-out is bounded AT THE QUERY
  // rather than only inside the loop. `null` means the route issued the read
  // with no `.limit()` at all, which is the pre-cap (unbounded) shape.
  strategyKeysListLimit: null as number | null,
  // F3 / F5(b) — capture strategy_analytics upserts the after() fail-closed
  // branch stamps (terminal 'failed' so the wizard poller reaches a gate; the
  // reconcile cron does NOT re-drive composites) so tests can assert the
  // strategy is NOT left silently spinning in 'pending'.
  strategyAnalyticsUpserts: [] as Array<Record<string, unknown>>,
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
  // Phase B simplify — postProcessKey upstream body (drives the H-0327
  // guard fall-through test). null means use the legacy 200 default.
  processKeyResult: null as null | {
    ok: boolean;
    body?: unknown;
    response?: unknown;
  },
  // 140.3-14 / TS-33 — every argument object handed to postProcessKey, in call
  // order. The dedupe id is only observable HERE: it is a field on the outbound
  // payload, so a test that reads the response can say nothing about it.
  processKeyCalls: [] as Array<{
    flow_type?: string;
    source?: string;
    context?: Record<string, unknown>;
    routeTag?: string;
    userId?: string;
  }>,
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
      // #597 — the route persists strategies.asset_class via a user-scoped
      // update().eq().eq() (owner-scoped) before finalize. Chainable + awaitable
      // (thenable) so `await update().eq().eq()` resolves; the route treats any
      // error as non-blocking. Records the persisted value for assertions.
      //
      // OWN-03 extends this: `.eq()` now RECORDS its filters (so the mark
      // write's owner scoping is assertable) and `.select()` is chainable on
      // an update (the mark write ends `.select("id")` to detect a zero-row
      // write — the signature of a patch that matched nobody).
      const buildUpdateChain = (record: {
        patch: Record<string, unknown>;
        eqs: Array<{ column: string; value: unknown }>;
      }) => {
        const isMarkWrite = "capital_ownership" in record.patch;
        const settle = () =>
          isMarkWrite
            ? {
                data: STATE.capitalOwnershipUpdateRows,
                error: STATE.capitalOwnershipUpdateError ?? null,
              }
            : { data: null, error: STATE.assetClassUpdateError ?? null };
        const chain = {
          eq: (column: string, value: unknown) => {
            record.eqs.push({ column, value });
            return chain;
          },
          select: () => chain,
          then: (onFulfilled: (v: unknown) => unknown) =>
            Promise.resolve(settle()).then(onFulfilled),
        };
        return chain;
      };
      return {
        select: () => buildEqChain(),
        update: (patch: Record<string, unknown>) => {
          STATE.assetClassUpdates.push(patch);
          const record = { patch, eqs: [] as Array<{ column: string; value: unknown }> };
          STATE.strategyUpdates.push(record);
          return buildUpdateChain(record);
        },
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
                  : {
                      exchange: STATE.adminApiKeysExchange,
                      // 153.6-04 — the row carries BOTH columns because the route
                      // asks for both on ONE read. The mock ignores the
                      // projection string, which is what lets the same chain serve
                      // the widened asset_class/probe read AND the narrower
                      // `resolvedSource` read further down the route.
                      attested_venue: STATE.adminApiKeysAttestedVenue,
                    },
                error: STATE.adminApiKeysSelectError,
              }),
            }),
          }),
          update: () => ({
            eq: async () => ({ data: null, error: null }),
          }),
        };
      }
      if (table === "strategy_keys") {
        // Phase 86 — composite member-count probe: select('*', {count, head}).eq()
        //   awaits directly to { count, error } (PostgREST head+count shape).
        // Phase 88 — composite-first hoist O-1 member list:
        //   select('api_key_id').eq().order('seq') resolves to { data, error }.
        // One chain serves both: it is thenable (count path) AND exposes .order
        // (list path), so `await …eq()` yields the count and `…eq().order()`
        // yields the ordered member rows.
        //
        // Phase 140.2-10 / SEAMCORE-10 — `.order()` now returns a chain that is
        // ITSELF thenable AND exposes `.limit(n)`. Both shapes must resolve:
        // the capped shape (`…order().limit(n)`) is what production issues, and
        // the un-capped shape (`await …order()`) must still resolve so that
        // REMOVING the `.limit()` (ledger row M32) fails an assertion rather
        // than crashing the route — a mutation that explodes proves nothing
        // about the property under test.
        type StrategyKeysListChain = {
          limit: (n: number) => Promise<{ data: unknown; error: unknown }>;
          then: (
            onFulfilled: (v: { data: unknown; error: unknown }) => unknown,
          ) => Promise<unknown>;
        };
        type StrategyKeysChain = {
          eq: () => StrategyKeysChain;
          order: () => StrategyKeysListChain;
          then: (
            onFulfilled: (v: {
              count: number | null;
              error: unknown;
              data: null;
            }) => unknown,
          ) => Promise<unknown>;
        };
        const listResult = () => ({
          data: STATE.strategyKeysListError ? null : STATE.strategyKeysList,
          error: STATE.strategyKeysListError,
        });
        const listChain: StrategyKeysListChain = {
          limit: async (n: number) => {
            STATE.strategyKeysListLimit = n;
            return listResult();
          },
          then: (onFulfilled) => Promise.resolve(listResult()).then(onFulfilled),
        };
        const chain: StrategyKeysChain = {
          eq: () => chain,
          order: () => listChain,
          then: (onFulfilled) =>
            Promise.resolve({
              count: STATE.strategyKeysCountError
                ? null
                : STATE.strategyKeysCount,
              error: STATE.strategyKeysCountError,
              data: null,
            }).then(onFulfilled),
        };
        return { select: () => chain };
      }
      if (table === "strategy_analytics") {
        // F3 / F5(b) — the fail-closed branch stamps a terminal 'failed' row via
        // upsert(payload, { onConflict: 'strategy_id' }).
        return {
          upsert: async (patch: Record<string, unknown>) => {
            STATE.strategyAnalyticsUpserts.push(patch);
            return { data: null, error: null };
          },
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

vi.mock("@/lib/process-key-client", () => ({
  postProcessKey: async (args: {
    flow_type?: string;
    source?: string;
    context?: Record<string, unknown>;
    routeTag?: string;
    userId?: string;
  }) => {
    // 140.3-14 / TS-33 — capture the OUTBOUND payload. Without this the
    // dedupe id is unobservable from a route test at all.
    STATE.processKeyCalls.push(args);
    return (
      STATE.processKeyResult ?? {
        ok: true,
        body: { queued: true, verification_id: "ver-1" },
      }
    );
  },
}));

/**
 * Phase 140 / SEAM-01 — control surface over the shared resilience core, which
 * the force-refresh scope-broadening probe now goes through.
 *
 * Partial mock (the 140-03 spread-`importOriginal` pattern): every export stays
 * REAL, including `resilientFetch`'s base URL, budget and `AbortSignal`, so the
 * forty-odd existing `globalThis.fetch` spies keep observing the same
 * round-trip. Only the breaker decision is driven from the test.
 */
const RF = vi.hoisted(() => ({
  breakerOpen: false as boolean,
  retryAfterS: 30 as number,
  lastCall: null as
    | { budgetKey: string; path: string; init: Record<string, unknown> }
    | null,
}));

vi.mock("@/lib/resilient-fetch", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/resilient-fetch")>();
  // The leaf is never mocked, so this is the SAME class identity the route's
  // `instanceof` branch tests against.
  const { CircuitOpenError } = await import("@/lib/seam-errors");
  return {
    ...actual,
    resilientFetch: async (
      budgetKey: Parameters<typeof actual.resilientFetch>[0],
      path: string,
      // No `= {}` default: D-08 made `init` (and its `retriesOverride`)
      // REQUIRED on the real signature, and a double that still defaulted would
      // be the one call shape production can no longer express.
      init: Parameters<typeof actual.resilientFetch>[2],
    ) => {
      RF.lastCall ={ budgetKey, path, init: init as Record<string, unknown> };
      if (RF.breakerOpen) throw new CircuitOpenError(RF.retryAfterS);
      return actual.resilientFetch(budgetKey, path, init);
    },
  };
});

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
// Phase 88 — composite member key ids (ordered by seq) for the O-1 probe loop.
const MEMBER_KEY_1 = "44444444-4444-4444-8444-444444444444";
const MEMBER_KEY_2 = "55555555-5555-4555-8555-555555555555";

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
  STATE.assetClassUpdates = [];
  STATE.assetClassUpdateError = null;
  STATE.strategyUpdates = [];
  STATE.capitalOwnershipUpdateError = null;
  STATE.capitalOwnershipUpdateRows = [{ id: STRATEGY_ID }];
  STATE.rpcCalls = [];
  STATE.rpcResult = { data: STRATEGY_ID, error: null };
  STATE.adminApiKeyId = API_KEY_ID;
  STATE.adminStrategyName = "Alpha Centauri";
  STATE.adminStrategiesError = null;
  STATE.adminApiKeysExchange = "okx";
  STATE.adminApiKeysAttestedVenue = "okx";
  STATE.adminApiKeysSelectError = null;
  STATE.strategyKeysCount = 0;
  STATE.strategyKeysCountError = null;
  STATE.strategyKeysList = [];
  STATE.strategyKeysListError = null;
  STATE.strategyKeysListLimit = null;
  STATE.strategyAnalyticsUpserts = [];
  STATE.adminEnqueueError = null;
  STATE.notifyFounderCalls = [];
  STATE.adminRpcCalls = [];
  STATE.captureToSentryCalls = [];
  STATE.processKeyResult = null;
  STATE.processKeyCalls = [];
  STATE.runAfterCallback = false;
  STATE.afterPromise = null;
  RF.breakerOpen = false;
  RF.retryAfterS = 30;
  RF.lastCall = null;
  process.env.INTERNAL_API_TOKEN = "test-internal-token";
  process.env.ANALYTICS_SERVICE_URL = "http://analytics.test";
  // Resolve a real allowed name for the body.
  const { STRATEGY_NAMES } = await import("@/lib/constants");
  VALID_BODY.name = STRATEGY_NAMES[0];
});

// Restore every vi.spyOn (notably the per-test globalThis.fetch spies) after
// each test. Some tests queue mockResolvedValueOnce values that a given code
// path may not consume; without a hard restore an unconsumed Once could leak
// into the next test's fetch. (vi.mock factory module mocks are untouched.)
afterEach(() => {
  vi.restoreAllMocks();
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

// Phase 106 Stage B: the flag-off single-key legacy dispatch was deleted, so
// `runLegacyFinalize` (the finalize RPC + after() side-effect fan-out) is now
// reachable ONLY via the composite hoist (api_key_id === null + >=1 members).
// Tests that exercise the legacy RPC error mapping / founder email / enqueue
// escalation route through it via this setup. The member re-probe uses the
// read-only fetch mock the test installs (mockProbeReadOnly), so the hoist
// proceeds to runLegacyFinalize.
function routeThroughLegacyFinalize(): void {
  STATE.strategyRow = { api_key_id: null };
  STATE.strategyKeysCount = 1;
  STATE.strategyKeysList = [{ api_key_id: MEMBER_KEY_1 }];
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

  // MT5-13 — the probe-failure split. Every non-OK probe response used to map to
  // KEY_NETWORK_TIMEOUT, whose copy says "we could not reach the exchange, try
  // again in a moment" and carries a Retry control. For a PERMANENT 4xx that is
  // wrong in both halves, and it is how a blocked MT5 submit presented as a
  // flaky network: the probe answered 400 "Unsupported exchange: mt5" on every
  // attempt, so the invited retry could never work. What matters is not which
  // status maps where in the abstract — it is that a user facing a condition
  // retries cannot clear is never handed a Retry button.
  //
  // Both arms assert the fail-CLOSED outcome is UNCHANGED (no RPC, 502): this
  // split changes the envelope only. A fix that unblocked finalize by letting an
  // unverified key through would be a security regression, not a fix.
  it.each([
    // 400 — the venue has no probe adapter (the literal MT5 case).
    { status: 400, expected: "KEY_SCOPE_CHECK_UNAVAILABLE" },
    // 422 — the api_keys row carries no exchange (the service's KEY_MISSING_EXCHANGE).
    { status: 422, expected: "KEY_SCOPE_CHECK_UNAVAILABLE" },
    // 404 — unknown key id. Permanent until someone reconnects the key.
    { status: 404, expected: "KEY_SCOPE_CHECK_UNAVAILABLE" },
    // 429 — per-key probe rate limit. Carved OUT: an identical retry clears it,
    // so the timeout copy's Retry is correct here.
    { status: 429, expected: "KEY_NETWORK_TIMEOUT" },
    // 424 — the VENUE did not answer. `retryable: true` in the service contract.
    { status: 424, expected: "KEY_NETWORK_TIMEOUT" },
    // 503 — upstream transient. Unchanged.
    { status: 503, expected: "KEY_NETWORK_TIMEOUT" },
  ])(
    "a $status probe failure surfaces $expected",
    async ({ status, expected }) => {
      const fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValue(
          new Response(JSON.stringify({ detail: "nope" }), {
            status,
            headers: { "content-type": "application/json" },
          }),
        );
      const consoleErr = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});

      const POST = await importPost();
      const res = await POST(makeReq(VALID_BODY));

      expect(res.status).toBe(502);
      expect((await res.json()).code).toBe(expected);
      // Fail CLOSED on every arm — the RPC must not have run.
      expect(
        STATE.rpcCalls.find((c) => c.name === "finalize_wizard_strategy"),
      ).toBeUndefined();

      consoleErr.mockRestore();
      fetchSpy.mockRestore();
    },
  );

  it("SEAMCORE-02: a probe whose BODY aborts still fails CLOSED", async () => {
    // The shape that used to slip through. `AbortSignal.timeout` aborts the
    // response STREAM, so headers can arrive and the body then stall: `fetch`
    // RESOLVES, and pre-fix the rejection escaped as a raw DOMException from
    // `res.json()` after the core's window had closed. The probe MUST still
    // block finalize — a key whose live scopes could not be re-checked must
    // never be promoted to pending_review (T-140-22), and a body that stalled
    // mid-stream is a probe that did not run.
    const aborted = new DOMException("aborted", "TimeoutError");
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      headers: new Headers({ "content-type": "application/json" }),
      json: () => Promise.reject(aborted),
      text: () => Promise.reject(aborted),
    } as unknown as Response);
    const consoleErr = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    const POST = await importPost();
    const res = await POST(makeReq(VALID_BODY));
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.code).toBe("KEY_NETWORK_TIMEOUT");
    // FAIL CLOSED: the finalize RPC must not have run.
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
    // Phase 106 Stage B: the finalize RPC (runLegacyFinalize) is reached via the
    // composite hoist now that the flag-off single-key dispatch is deleted.
    routeThroughLegacyFinalize();

    const POST = await importPost();
    const res = await POST(makeReq(VALID_BODY));
    expect(res.status).toBe(200);
    const body = await res.json();
    // H-0309: stable `ok: true` success discriminator, uniform with the sibling
    // create-with-key / keys-sync endpoints.
    expect(body.ok).toBe(true);
    expect(body.strategy_id).toBe(STRATEGY_ID);
    expect(body.status).toBe("pending_review");
    expect(
      STATE.rpcCalls.find((c) => c.name === "finalize_wizard_strategy"),
    ).toBeDefined();
    fetchSpy.mockRestore();
  });

  it("skips the live probe when the strategy has no api_key_id (CSV branch)", async () => {
    // CSV branch: api_key_id null + zero members → the composite hoist finds no
    // members and (Phase 106 Stage B) falls through to the unconditional unified
    // path. The live scope-broadening probe is still skipped (no api_key to
    // re-check), which is what this test pins.
    STATE.strategyRow = { api_key_id: null };
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const POST = await importPost();
    const res = await POST(makeReq(VALID_BODY));
    expect(res.status).toBe(200);
    expect(fetchSpy).not.toHaveBeenCalled();
    const body = await res.json();
    expect(body.ok).toBe(true);
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
 * [140.3-03 / SEAMUX-07] The publish gate must fail CLOSED on an UNREADABLE
 * 2xx — member 1 of 2 of the unchecked-cast class.
 *
 * THE DEFECT. `fetchLivePermissions` did `return (await res.json()) as
 * LivePermissions;` — a cast, which checks nothing at runtime — and the gate
 * below it rejects only on `livePerms.trade === true || livePerms.withdraw ===
 * true`. So a 2xx `{}`, or one renamed field, left BOTH scopes `undefined`;
 * `undefined === true` is false at both gates; the probe returned `{ ok: true }`
 * and the draft finalised to `pending_review` **with a key holding trade or
 * withdraw scope published as read-only-verified.** That contradicts the
 * fail-CLOSED doctrine this file states 40 lines above the probe.
 *
 * ⚠️ THE ENVELOPE HALF OF THIS BLOCK WAS RE-CUT — 153.2-04 / WIZFORM-04 / D-14b.
 *
 * 140.3-03 required that a parse miss join the EXISTING probe-failure arm and
 * share its envelope: "a body that could not be read is a probe that did not
 * run". The SECURITY half of that is permanent and is untouched below — both
 * conditions still fail CLOSED, and the finalize RPC still must not run on
 * either. What was wrong was the second inference: that because two conditions
 * block identically, the USER should be told the same thing about them.
 *
 * They are not the same thing. `KEY_NETWORK_TIMEOUT` says we could not reach the
 * exchange and offers a Retry. For a service that REPORTED `probe_error: true`
 * that is honest — it tried, it failed, a retry can work. For a body our own
 * schema could not parse it is false twice over: the exchange answered, and the
 * body stays unparseable until a deploy changes one side or the other. The
 * founder clicked that Retry five times against a condition of exactly this
 * shape, which is the incident WIZFORM-04 exists to close.
 *
 * So the two arms now carry DIFFERENT hand-typed literals, and both are still
 * hand-typed rather than imported — the property under test is what the user is
 * told, and importing the route's own string would make each row agree with
 * itself. The row that used to assert byte-identity now asserts the DISTINCTION,
 * which is the same coupling read from the other side.
 *
 * The last case is the ANTI-REGRESSION CONTROL. A gate that refuses everything
 * is not a fix, it is an outage, so a well-formed read-only 2xx must still
 * publish. It is deliberately in this block rather than the one above.
 */
describe("[140.3-03 / SEAMUX-07] the scope probe fails CLOSED on an unreadable 2xx", () => {
  // Hand-typed, from reading the SERVICE-REPORTED probe-failure arm — NOT
  // imported from it. This arm keeps its transient code and its Retry.
  const PROBE_FAILURE_ENVELOPE = {
    error: "Exchange permission probe failed",
    code: "KEY_NETWORK_TIMEOUT",
  };
  // 153.2-04 / D-14b — the PARSE-MISS arm, permanent and therefore
  // non-recoverable. `KEY_SCOPE_CHECK_UNAVAILABLE` carries no recoverable
  // action, so no Retry control renders at all (the structural suppression).
  const PARSE_MISS_ENVELOPE = {
    error: "Could not read the key scope response",
    code: "KEY_SCOPE_CHECK_UNAVAILABLE",
  };

  function mockProbeBody(body: unknown): ReturnType<typeof vi.spyOn> {
    return vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
  }

  it("a 2xx `{}` REFUSES the publish — it does not finalise as read-only-verified", async () => {
    const fetchSpy = mockProbeBody({});
    const consoleErr = vi.spyOn(console, "error").mockImplementation(() => {});

    const POST = await importPost();
    const res = await POST(makeReq(VALID_BODY));
    consoleErr.mockRestore();

    expect(
      res.status,
      "An empty 2xx leaves `trade`/`withdraw` undefined, and `undefined === " +
        "true` is false at BOTH gates — so pre-fix this body returned `{ok: " +
        "true}` and the draft finalised with an unverified key.",
    ).toBe(502);
    expect(await res.json()).toEqual(PARSE_MISS_ENVELOPE);
    expect(
      STATE.rpcCalls.find((c) => c.name === "finalize_wizard_strategy"),
      "The finalize RPC must NOT have run: an unreadable probe is a probe " +
        "that did not run, and a key whose live scopes could not be " +
        "re-checked must never reach pending_review (T-140-22).",
    ).toBeUndefined();
    fetchSpy.mockRestore();
  });

  it("a 2xx with `trade` RENAMED (can_trade) REFUSES the publish", async () => {
    // The exact drift a cast cannot see: the body looks plausible, carries a
    // truthful `can_trade: true`, and the gate reads the field that no longer
    // exists.
    const fetchSpy = mockProbeBody({
      read: true,
      can_trade: true,
      withdraw: false,
      probe_error: false,
      detected_at: "2026-07-27T00:00:00Z",
    });
    const consoleErr = vi.spyOn(console, "error").mockImplementation(() => {});

    const POST = await importPost();
    const res = await POST(makeReq(VALID_BODY));
    consoleErr.mockRestore();

    expect(res.status).toBe(502);
    expect(await res.json()).toEqual(PARSE_MISS_ENVELOPE);
    expect(
      STATE.rpcCalls.find((c) => c.name === "finalize_wizard_strategy"),
    ).toBeUndefined();
    fetchSpy.mockRestore();
  });

  it("a 2xx with `trade` present but NON-BOOLEAN REFUSES the publish", async () => {
    // `"false"` is a truthy string, and `"false" === true` is false — so a
    // stringly-typed emitter would have published a key it had just described
    // as trade-capable. No coercion at a security boundary.
    const fetchSpy = mockProbeBody({
      read: true,
      trade: "false",
      withdraw: false,
      probe_error: false,
      detected_at: "2026-07-27T00:00:00Z",
    });
    const consoleErr = vi.spyOn(console, "error").mockImplementation(() => {});

    const POST = await importPost();
    const res = await POST(makeReq(VALID_BODY));
    consoleErr.mockRestore();

    expect(res.status).toBe(502);
    expect(await res.json()).toEqual(PARSE_MISS_ENVELOPE);
    expect(
      STATE.rpcCalls.find((c) => c.name === "finalize_wizard_strategy"),
    ).toBeUndefined();
    fetchSpy.mockRestore();
  });

  it("[153.2-04 / D-14b] a SERVICE-REPORTED probe_error keeps the transient code — it is NOT the parse miss", async () => {
    // ⚠️ RE-CUT, not deleted. This row used to assert the parse miss and this
    // arm were BYTE-IDENTICAL. It now asserts the DISTINCTION, which is the same
    // coupling read from the other side — and it is the half a careless fix
    // would break: sweeping BOTH conditions onto the permanent code would strip
    // a correct Retry from a genuine transient upstream failure, the exact
    // inverse of the defect D-14b fixes.
    //
    // Here the SERVICE tried and told us it failed. A retry can succeed, so the
    // envelope stays recoverable.
    const fetchSpy = mockProbeBody({
      read: true,
      trade: true,
      withdraw: true,
      probe_error: true,
      detected_at: "2026-07-27T00:00:00Z",
    });

    const POST = await importPost();
    const res = await POST(makeReq(VALID_BODY));

    expect(res.status).toBe(502);
    // ⚠️ The distinction is asserted against what the ROUTE ANSWERED, never
    // against the other hand-typed literal. `PROBE_FAILURE_ENVELOPE.code !==
    // PARSE_MISS_ENVELOPE.code` would compare two constants declared thirty
    // lines apart in THIS file — true the moment they were typed, and unable to
    // fail for any change to the route. Reading `body.code` couples the claim to
    // production: collapse the two arms back onto one code and this reds by
    // name, which is the whole point of stating it separately from the
    // `toEqual` above.
    const body = await res.json();
    // ORDER IS DELIBERATE: the DISTINCTION is asserted before the full
    // `toEqual`, so a collapse of the two arms reports this explanation rather
    // than a bare `expected {…(2)} to deeply equal {…(2)}` object diff.
    expect(
      body.code,
      "The service-reported arm and the parse-miss arm must not share a code: " +
        "one is transient and keeps its Retry, the other is permanent and must " +
        "render none.",
    ).not.toBe(PARSE_MISS_ENVELOPE.code);
    expect(body).toEqual(PROBE_FAILURE_ENVELOPE);
    fetchSpy.mockRestore();
  });

  it("ANTI-REGRESSION: a well-formed 2xx read-only body still PUBLISHES", async () => {
    const fetchSpy = mockProbeBody({
      read: true,
      trade: false,
      withdraw: false,
      probe_error: false,
      detected_at: "2026-07-27T00:00:00Z",
    });
    routeThroughLegacyFinalize();

    const POST = await importPost();
    const res = await POST(makeReq(VALID_BODY));

    expect(
      res.status,
      "A gate that refuses everything is an outage, not a fix.",
    ).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.status).toBe("pending_review");
    expect(
      STATE.rpcCalls.find((c) => c.name === "finalize_wizard_strategy"),
    ).toBeDefined();
    fetchSpy.mockRestore();
  });
});

/**
 * Phase 140 / SEAM-01 + SEAM-03 — the third Railway seam on the WIZARD side.
 *
 * The force-refresh probe deliberately bypasses both cache layers, so unlike
 * the sibling `/api/keys/[id]/permissions` it crosses the seam on EVERY submit.
 * Its fail-CLOSED contract is the security property under test (T-140-22): a
 * probe that cannot run must BLOCK finalize, never wave it through. A breaker
 * trip is one more way the probe cannot run, so it must land on the blocking
 * side of that branch — with its own 503/CIRCUIT_OPEN code rather than the
 * generic 502, because "retry in 30s" is actionable and "probe failed" is not.
 */
describe("POST /api/strategies/finalize-wizard — breaker open (SEAM-04 fail-closed)", () => {
  const CIRCUIT_OPEN_COPY =
    "The analytics service is temporarily unavailable. Please try again in a moment.";

  it("blocks finalize with 503 CIRCUIT_OPEN + Retry-After when the breaker is open", async () => {
    RF.breakerOpen = true;
    // Not 30: 30 is both BREAKER_COOLDOWN_S and DEFAULT_RETRY_AFTER_S, so a
    // hardcoded value would satisfy a 30-valued assertion while forwarding
    // nothing from the breaker.
    RF.retryAfterS = 23;
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const consoleErr = vi.spyOn(console, "error").mockImplementation(() => {});

    const POST = await importPost();
    const res = await POST(makeReq(VALID_BODY));

    expect(res.status).toBe(503);
    expect(res.headers.get("Retry-After")).toBe("23");
    const raw = await res.text();
    const body = JSON.parse(raw);
    expect(body.code).toBe("CIRCUIT_OPEN");
    expect(body.error).toBe(CIRCUIT_OPEN_COPY);
    expect(raw).not.toMatch(/breaker|upstash|railway|analytics service circuit/i);

    // FAIL CLOSED — the whole point. An un-probed key must never be promoted.
    expect(
      STATE.rpcCalls.find((c) => c.name === "finalize_wizard_strategy"),
    ).toBeUndefined();
    // And the seam was genuinely not crossed.
    expect(fetchSpy).not.toHaveBeenCalled();

    consoleErr.mockRestore();
    fetchSpy.mockRestore();
  });

  it("sends the force-refresh probe through the core with the keys-permissions budget", async () => {
    const fetchSpy = mockProbeReadOnly();

    const POST = await importPost();
    const res = await POST(makeReq(VALID_BODY));
    expect(res.status).toBe(200);

    expect(RF.lastCall).not.toBeNull();
    expect(RF.lastCall!.budgetKey).toBe("keys-permissions");
    expect(RF.lastCall!.path).toBe(
      `/internal/keys/${API_KEY_ID}/permissions?force_refresh=true`,
    );
    expect(RF.lastCall!.init.method).toBe("POST");
    expect(RF.lastCall!.init.cache).toBe("no-store");
    expect(RF.lastCall!.init.headers).toMatchObject({
      "Content-Type": "application/json",
      "X-Internal-Token": "test-internal-token",
    });
    // The core owns the deadline — the caller must not pass its own.
    expect(RF.lastCall!.init.signal).toBeUndefined();

    fetchSpy.mockRestore();
  });
});

/**
 * #597 — asset-class persistence. The finalize RPC signature cannot carry
 * asset_class, so the route persists it via an owner-scoped strategies UPDATE
 * before dispatch.
 *
 * FORCE-DERIVE rule (the crux): an API-keyed strategy always persists 'crypto'
 * REGARDLESS of the submitted value — every supported exchange is a crypto
 * venue, so the picker is only meaningful for CSV uploads. Trusting the
 * submitted value would let a resumed broker draft (whose DB row carries the
 * NOT NULL DEFAULT 'traditional') silently annualize a crypto strategy on √252,
 * a regression vs the pre-#597 `api_key_id → √365` proxy. For CSV drafts
 * (api_key_id null) the submitted value is honored, coercing anything outside
 * the 'crypto'|'traditional' closed set to 'traditional' (the √252 default + DB
 * column default). Non-blocking: a failed update logs but still finalizes.
 */
describe("POST /api/strategies/finalize-wizard — #597 asset_class persistence", () => {
  function okProbe() {
    return vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({ read: true, trade: false, withdraw: false, probe_error: false }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
  }

  // THE broker-resume regression: an API-keyed draft whose row carries the DB
  // default 'traditional', submitting 'traditional', MUST still persist 'crypto'.
  // If someone reverts the route to trust the submitted value, this reddens.
  it("FORCE-DERIVES 'crypto' for an API-keyed draft even when 'traditional' is submitted", async () => {
    const fetchSpy = okProbe();
    STATE.strategyRow = { api_key_id: API_KEY_ID }; // api-keyed (broker resume)
    const POST = await importPost();
    const res = await POST(makeReq({ ...VALID_BODY, asset_class: "traditional" }));
    expect(res.status).toBe(200);
    expect(STATE.assetClassUpdates).toContainEqual({ asset_class: "crypto" });
    // The submitted 'traditional' must NOT have been persisted.
    expect(STATE.assetClassUpdates).not.toContainEqual({ asset_class: "traditional" });
    fetchSpy.mockRestore();
  });

  // MT5RECON-02 — the venue-aware single-key derive. An API-keyed draft whose
  // linked api_keys.exchange is 'mt5' must persist 'traditional' (forex/CFD √252),
  // NOT 'crypto'. This is the finalize seam that would otherwise overwrite the
  // create-with-key 'traditional' stamp back to crypto. WIRING test: neutering the
  // derive (reverting the apiKeyId arm to the unconditional 'crypto' literal)
  // persists 'crypto' → this reddens.
  it("MT5RECON-02: persists 'traditional' for an API-keyed draft on an mt5 venue", async () => {
    const fetchSpy = okProbe();
    STATE.strategyRow = { api_key_id: API_KEY_ID }; // single api-keyed draft
    STATE.adminApiKeysExchange = "mt5"; // linked key is an MT5 (forex/CFD) venue
    const POST = await importPost();
    const res = await POST(makeReq({ ...VALID_BODY, asset_class: "traditional" }));
    expect(res.status).toBe(200);
    expect(STATE.assetClassUpdates).toContainEqual({ asset_class: "traditional" });
    // The crypto default must NOT have leaked in for an mt5 venue.
    expect(STATE.assetClassUpdates).not.toContainEqual({ asset_class: "crypto" });
    fetchSpy.mockRestore();
  });

  // Regression: a crypto single-key venue stays byte-identical to today ('crypto')
  // even when 'traditional' is submitted — the force-derive still applies, keyed
  // off the venue rather than an unconditional literal.
  it("MT5RECON-02: still FORCE-DERIVES 'crypto' for a crypto (bybit) single-key venue", async () => {
    const fetchSpy = okProbe();
    STATE.strategyRow = { api_key_id: API_KEY_ID };
    STATE.adminApiKeysExchange = "bybit"; // crypto venue
    const POST = await importPost();
    const res = await POST(makeReq({ ...VALID_BODY, asset_class: "traditional" }));
    expect(res.status).toBe(200);
    expect(STATE.assetClassUpdates).toContainEqual({ asset_class: "crypto" });
    expect(STATE.assetClassUpdates).not.toContainEqual({
      asset_class: "traditional",
    });
    fetchSpy.mockRestore();
  });

  // RED-TEAM regression: when the single-key venue lookup FAULTS (transient DB
  // blip), the route must NOT overwrite the draft's stamp with the √252
  // 'traditional' default — the worker reads strategies.asset_class DIRECTLY as
  // the annualization clock (it does NOT re-derive from venue), so a blind
  // 'traditional' write would silently mis-annualize a crypto strategy (inflated
  // Sharpe). The write must be SKIPPED, leaving create-with-key's venue-aware
  // draft stamp intact. Reddens against the old unconditional 'traditional' fault
  // default.
  it("does NOT overwrite asset_class to 'traditional' when the single-key venue lookup faults", async () => {
    const fetchSpy = okProbe();
    STATE.strategyRow = { api_key_id: API_KEY_ID }; // single api-keyed draft
    STATE.adminApiKeysExchange = "bybit"; // the key IS a crypto venue…
    STATE.adminApiKeysSelectError = { message: "transient PG blip" }; // …but the lookup fails
    const POST = await importPost();
    const res = await POST(makeReq({ ...VALID_BODY, asset_class: "traditional" }));
    expect(res.status).toBe(200);
    // The fault path must SKIP the write — no 'traditional' overwrite of the
    // draft's correct venue-aware stamp.
    expect(STATE.assetClassUpdates).not.toContainEqual({
      asset_class: "traditional",
    });
    expect(STATE.assetClassUpdates).toHaveLength(0);
    fetchSpy.mockRestore();
  });

  it("persists 'crypto' for a CSV draft when the body sends asset_class: 'crypto'", async () => {
    const fetchSpy = okProbe();
    STATE.strategyRow = { api_key_id: null }; // CSV branch (probe skipped)
    const POST = await importPost();
    const res = await POST(makeReq({ ...VALID_BODY, asset_class: "crypto" }));
    expect(res.status).toBe(200);
    expect(STATE.assetClassUpdates).toContainEqual({ asset_class: "crypto" });
    fetchSpy.mockRestore();
  });

  it("coerces an invalid CSV-draft asset_class to 'traditional'", async () => {
    const fetchSpy = okProbe();
    STATE.strategyRow = { api_key_id: null }; // CSV branch — submitted value honored
    const POST = await importPost();
    await POST(makeReq({ ...VALID_BODY, asset_class: "equities" })); // garbage
    expect(STATE.assetClassUpdates).toContainEqual({ asset_class: "traditional" });
    fetchSpy.mockRestore();
  });

  it("still finalizes (200) when the asset_class update errors — non-blocking", async () => {
    const fetchSpy = okProbe();
    STATE.strategyRow = { api_key_id: null }; // CSV branch
    STATE.assetClassUpdateError = { message: "transient PG blip" };
    const POST = await importPost();
    const res = await POST(makeReq({ ...VALID_BODY, asset_class: "crypto" }));
    expect(res.status).toBe(200);
    fetchSpy.mockRestore();
  });

  // F-1(a): a MULTI-KEY composite has api_key_id=NULL (members in strategy_keys)
  // but every member venue is crypto this phase, so it must FORCE 'crypto' even
  // though the CSV-branch would otherwise honor the submitted/default 'traditional'.
  // Without this, the composite headline (venue-blend √365) and the #597 surfaces
  // (√252 off asset_class) diverge ~√(365/252). Neuter (drop the composite check)
  // → 'traditional' persists → this reddens.
  it("FORCE-DERIVES 'crypto' for a composite draft (>=1 members, api_key_id NULL) submitting 'traditional'", async () => {
    const fetchSpy = okProbe();
    STATE.strategyRow = { api_key_id: null }; // composite: no single api_key
    STATE.strategyKeysCount = 2; // >=1 member → composite
    const POST = await importPost();
    const res = await POST(makeReq({ ...VALID_BODY, asset_class: "traditional" }));
    expect(res.status).toBe(200);
    expect(STATE.assetClassUpdates).toContainEqual({ asset_class: "crypto" });
    expect(STATE.assetClassUpdates).not.toContainEqual({
      asset_class: "traditional",
    });
    fetchSpy.mockRestore();
  });
});

/**
 * Phase 106 Stage B — wizard finalize enqueue, post-cutover.
 *
 * The flag-off single-key legacy dispatch and the compute-jobs queue-off
 * arms were deleted: `runLegacyFinalize` — and therefore the
 * route-level enqueue side-effect — is now reachable ONLY via the composite
 * hoist (api_key_id === null + >=1 members), which enqueues stitch_composite
 * unconditionally. Single-key and CSV finalize delegate to the unified
 * backbone, which enqueues process_key_long worker-side (NOT from this route).
 *
 * Comprehensive composite-hoist coverage (stitch enqueue, O-1 per-member
 * re-probe, W-4/F5(b) fail-closed) lives in the "Phase 88 composite-first
 * routing" block below. These two cases pin the route-level enqueue contract.
 */
describe("POST /api/strategies/finalize-wizard — Phase 106 finalize enqueue", () => {
  it("enqueues stitch_composite unconditionally for a composite (via the hoist)", async () => {
    const fetchSpy = mockProbeReadOnly();
    routeThroughLegacyFinalize();
    STATE.runAfterCallback = true;

    const POST = await importPost();
    const res = await POST(makeReq(VALID_BODY));
    expect(res.status).toBe(200);
    await flushAfter();

    const enqueueCall = STATE.adminRpcCalls.find(
      (c) => c.name === "enqueue_compute_job",
    );
    expect(enqueueCall).toBeDefined();
    expect(enqueueCall!.args.p_kind).toBe("stitch_composite");
    expect(enqueueCall!.args.p_strategy_id).toBe(STRATEGY_ID);
    fetchSpy.mockRestore();
  });

  it("does NOT enqueue from the route on the single-key unified path (worker enqueues instead)", async () => {
    const fetchSpy = mockProbeReadOnly();
    STATE.strategyRow = { api_key_id: API_KEY_ID };
    STATE.strategyKeysCount = 0;
    STATE.runAfterCallback = true;

    const POST = await importPost();
    const res = await POST(makeReq(VALID_BODY));
    expect(res.status).toBe(200);
    await flushAfter();

    const enqueueCall = STATE.adminRpcCalls.find(
      (c) => c.name === "enqueue_compute_job",
    );
    expect(enqueueCall).toBeUndefined();
    fetchSpy.mockRestore();
  });
});

/**
 * Phase 86 (COMP-02) / Finding 6 — the unified-backbone finalize path. The
 * unified path delegates to process_key_long (single-key derive), which cannot
 * reconstruct a multi-key composite. A member-bearing composite reaching this
 * path must FAIL LOUD (stamp + reject) rather than be silently orphaned.
 */
describe("POST /api/strategies/finalize-wizard — Phase 86 unified-backbone composite guard", () => {
  it("fails LOUD (409 + terminal stamp) when a composite reaches the unified path", async () => {
    const fetchSpy = mockProbeReadOnly();
    STATE.strategyKeysCount = 2;

    const POST = await importPost();
    const res = await POST(makeReq(VALID_BODY));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.code).toBe("COMPOSITE_UNSUPPORTED_UNIFIED");

    // Terminal 'failed' stamp so the wizard poller reaches a gate.
    const stamp = STATE.strategyAnalyticsUpserts.find(
      (p) => p.computation_status === "failed",
    );
    expect(stamp).toBeDefined();
    expect(stamp!.strategy_id).toBe(STRATEGY_ID);
    // A composite must NEVER be routed to process_key_long here (no stitch job
    // either — the unified path doesn't dispatch composites this phase).
    const enqueueCall = STATE.adminRpcCalls.find(
      (c) => c.name === "enqueue_compute_job",
    );
    expect(enqueueCall).toBeUndefined();
    fetchSpy.mockRestore();
  });

  it("passes a single-key strategy (0 members) through to the unified path (200)", async () => {
    const fetchSpy = mockProbeReadOnly();
    STATE.strategyKeysCount = 0;

    const POST = await importPost();
    const res = await POST(makeReq(VALID_BODY));
    expect(res.status).toBe(200);
    // No composite failed stamp on the single-key unified path.
    const stamp = STATE.strategyAnalyticsUpserts.find(
      (p) => p.computation_status === "failed",
    );
    expect(stamp).toBeUndefined();
    fetchSpy.mockRestore();
  });

  it("fails CLOSED (503 + Sentry + stamp) on an unknowable membership count in the unified path", async () => {
    const fetchSpy = mockProbeReadOnly();
    STATE.strategyKeysCountError = { message: "count boom" };

    const POST = await importPost();
    const res = await POST(makeReq(VALID_BODY));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.code).toBe("COMPOSITE_MEMBERSHIP_UNKNOWN");

    const stamp = STATE.strategyAnalyticsUpserts.find(
      (p) => p.computation_status === "failed",
    );
    expect(stamp).toBeDefined();
    const sentry = STATE.captureToSentryCalls.find(
      (c) => c.options.tags.step === "unified-composite-probe",
    );
    expect(sentry).toBeDefined();
    fetchSpy.mockRestore();
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
    routeThroughLegacyFinalize();
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
    routeThroughLegacyFinalize();
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
/**
 * 153.1-05 / WIZFORM-02 / D-09(b) — every `validatePayload` rejection carries a
 * code the wizard can render.
 *
 * ⭐ WHY THIS DESCRIBE EXISTS AT ALL. Until this plan every arm of
 * `validatePayload` answered a correct 400 with a bare `error` string and NO
 * `code`. `SubmitStep` maps off the code alone, so all of them rendered the
 * UNKNOWN card — "We could not classify this failure" — for a rejection the
 * server had classified precisely. The defect survived a year of green tests
 * because the tests asserted the STATUS. Every `it` below therefore asserts the
 * code, and the sweep at the end asserts the CLASS: not one arm may answer
 * without one.
 *
 * ⛔ The fixtures are HAND-TYPED, never sized off the constant they test. A
 * description of `"x".repeat(MAGNITUDE_CAPS.MIN_DESCRIPTION_CHARS - 1)` would
 * agree with whatever the constant happens to be and could never fail; `"ok"`
 * is two characters because that is what the founder actually submitted, and if
 * the lower bound is ever moved below three this test SHOULD red.
 */
describe("POST /api/strategies/finalize-wizard — 153.1-05 validatePayload codes", () => {
  /** Every arm, as the payload that trips it and the code it must answer. */
  const ARMS: ReadonlyArray<{
    readonly what: string;
    readonly patch: Record<string, unknown>;
    readonly code: string;
  }> = [
    {
      what: "a non-object body",
      patch: {},
      code: "VALIDATION_FAILED",
    },
    {
      what: "a malformed strategy_id",
      patch: { strategy_id: "not-a-uuid" },
      code: "VALIDATION_FAILED",
    },
    {
      what: "a codename outside the curated list",
      patch: { name: "Not A Real Codename" },
      code: "METADATA_NAME_INVALID",
    },
    {
      what: "a missing description",
      patch: { description: undefined },
      code: "METADATA_DESCRIPTION_REQUIRED",
    },
    {
      what: "a non-string description",
      patch: { description: 12345 },
      code: "METADATA_DESCRIPTION_REQUIRED",
    },
    {
      // ⭐ THE INCIDENT, ENCODED. Two characters, hand-typed.
      what: "the founder's two-character description",
      patch: { description: "ok" },
      code: "METADATA_DESCRIPTION_TOO_SHORT",
    },
    {
      what: "a description one character over the ceiling",
      patch: { description: "x".repeat(5001) },
      code: "METADATA_DESCRIPTION_TOO_LONG",
    },
    {
      what: "a malformed category_id",
      patch: { category_id: "not-a-uuid" },
      code: "METADATA_CATEGORY_REQUIRED",
    },
    {
      what: "a negative aum",
      patch: { aum: -1 },
      code: "METADATA_AUM_INVALID",
    },
    {
      what: "a negative max_capacity",
      patch: { max_capacity: -1 },
      code: "METADATA_CAPACITY_INVALID",
    },
    {
      what: "an entry_context outside its closed set",
      patch: { entry_context: "garbage" },
      code: "VALIDATION_FAILED",
    },
    {
      what: "a capital_ownership outside its closed set",
      patch: { capital_ownership: "own_capitol" },
      code: "METADATA_CAPITAL_OWNERSHIP_INVALID",
    },
  ];

  /**
   * The first arm rejects the BODY ITSELF, so it cannot be expressed as a patch
   * over `VALID_BODY` — it needs a request whose JSON is not an object.
   */
  function bodyFor(patch: Record<string, unknown>): unknown {
    if (Object.keys(patch).length === 0) return "not an object";
    const merged: Record<string, unknown> = { ...VALID_BODY, ...patch };
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined) delete merged[k];
    }
    return merged;
  }

  it.each(ARMS)("rejects $what with 400 + $code", async ({ patch, code }) => {
    const POST = await importPost();
    const res = await POST(makeReq(bodyFor(patch) as Record<string, unknown>));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe(code);
    // The code is the RENDERABLE half; the `error` string stays the
    // developer-facing detail and must not have been dropped.
    expect(typeof body.error).toBe("string");
    // ⛔ T-153.1-16 — adding a code changes the response BODY, never the
    // DECISION. Every arm is still a gate: the RPC must not have run.
    expect(
      STATE.rpcCalls.find((c) => c.name === "finalize_wizard_strategy"),
      "The RPC ran despite an invalid payload — validation is not a gate.",
    ).toBeUndefined();
  });

  it("NOT ONE arm answers without a code (the class, not the instances)", async () => {
    // The sweep the twelve `it`s above cannot do individually: a new arm added
    // later without a code passes every assertion above by simply not being
    // listed. This one reds the moment ANY rejection on this path arrives
    // code-less — which is the state the whole route shipped in until now.
    const POST = await importPost();
    const codeless: string[] = [];
    for (const arm of ARMS) {
      const res = await POST(
        makeReq(bodyFor(arm.patch) as Record<string, unknown>),
      );
      const body = await res.json();
      if (typeof body.code !== "string" || body.code.length === 0) {
        codeless.push(arm.what);
      }
    }
    expect(
      codeless,
      `These validatePayload arms answered with no code: ${codeless.join(
        ", ",
      )}. A code-less rejection renders the UNKNOWN card ("We could not ` +
        `classify this failure") for a failure the server classified exactly. ` +
        `Give it a code AND admit that code to KNOWN_FINALIZE_CODES in the ` +
        `same commit.`,
    ).toEqual([]);
    // Positive control: if `ARMS` is ever emptied or the loop stops running,
    // `codeless` is [] and the assertion above is vacuously green.
    expect(ARMS.length).toBe(12);
  });

  it("accepts a description at EXACTLY the lower bound (the boundary is <, not <=)", async () => {
    // Hand-typed ten characters. This is the other half of the founder's
    // incident: an off-by-one here would refuse a description that satisfies
    // the rule the copy states, and the user would be told to add characters
    // they had already added.
    const fetchSpy = mockProbeReadOnly();
    const POST = await importPost();
    const res = await POST(
      makeReq({ ...VALID_BODY, description: "abcdefghij" }),
    );
    expect(res.status).toBe(200);
    fetchSpy.mockRestore();
  });
});

describe("POST /api/strategies/finalize-wizard — H-0325 dollar-amount validation", () => {
  it("rejects negative aum with 400", async () => {
    const POST = await importPost();
    const res = await POST(makeReq({ ...VALID_BODY, aum: -5_000_000 }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/aum/);
    // 153.1-05 / D-09(b) — the code, not just the status. A status-only
    // assertion is precisely what let nine code-less arms live for a year:
    // every one of them answered a correct 400 and an unrenderable body.
    expect(body.code).toBe("METADATA_AUM_INVALID");
    expect(
      STATE.rpcCalls.find((c) => c.name === "finalize_wizard_strategy"),
    ).toBeUndefined();
  });

  it("rejects aum at-or-above the 1e12 ceiling with 400 + METADATA_AUM_INVALID", async () => {
    const POST = await importPost();
    const res = await POST(makeReq({ ...VALID_BODY, aum: 1e20 }));
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("METADATA_AUM_INVALID");
  });

  it("rejects non-numeric aum (string) with 400 + METADATA_AUM_INVALID", async () => {
    const POST = await importPost();
    const res = await POST(makeReq({ ...VALID_BODY, aum: "foo" }));
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("METADATA_AUM_INVALID");
  });

  it("rejects invalid max_capacity with 400 + METADATA_CAPACITY_INVALID", async () => {
    const POST = await importPost();
    const res = await POST(makeReq({ ...VALID_BODY, max_capacity: -1 }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/max_capacity/);
    // A DIFFERENT code from aum above, on an adjacent arm with an
    // near-identical condition — the two fields are two remedies.
    expect(body.code).toBe("METADATA_CAPACITY_INVALID");
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
    routeThroughLegacyFinalize();
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
    expect(body.code).toBe("GATE_DRAFT_GONE"); // SubmitStep maps off this code
    // The raw Postgres message must not leak (P445-style hardening).
    expect(JSON.stringify(body)).not.toContain("strategy abc-uuid not found");

    fetchSpy.mockRestore();
    consoleErr.mockRestore();
  });

  it("maps 02000 (no_data) to 404 + sanitized 'Draft not found'", async () => {
    const fetchSpy = mockProbeReadOnly();
    const consoleErr = vi.spyOn(console, "error").mockImplementation(() => {});
    routeThroughLegacyFinalize();
    STATE.rpcResult = {
      data: null,
      error: { code: "02000", message: "no data returned by the query" },
    };

    const POST = await importPost();
    const res = await POST(makeReq(VALID_BODY));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("Draft not found");
    expect(body.code).toBe("GATE_DRAFT_GONE"); // SubmitStep maps off this code
    expect(JSON.stringify(body)).not.toContain("no data returned");

    fetchSpy.mockRestore();
    consoleErr.mockRestore();
  });

  it("maps 42501 (insufficient_privilege) to 403 + sanitized 'This draft cannot be finalized'", async () => {
    const fetchSpy = mockProbeReadOnly();
    const consoleErr = vi.spyOn(console, "error").mockImplementation(() => {});
    routeThroughLegacyFinalize();
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
    expect(body.code).toBe("GUARD_BLOCKED"); // SubmitStep maps off this code
    // The raw owner/user UUIDs MUST NOT leak (P445-style hardening).
    expect(JSON.stringify(body)).not.toContain("xyz-uuid");
    expect(JSON.stringify(body)).not.toContain("uid-1234");

    fetchSpy.mockRestore();
    consoleErr.mockRestore();
  });

  it("audit-2026-05-07 H-0321: maps 22023 (invalid_parameter_value) to 409 with code='DRAFT_STATE_INVALID'", async () => {
    // PRE-FIX: 22023 lumped with 42501 → 403 "This draft cannot be finalized".
    // POST-FIX: 22023 is a state mismatch (already-published, missing-fields,
    // stale-snapshot), distinct from a true permission denial. 409 lets the
    // client show a refresh nudge rather than a sign-out / no-access prompt.
    //
    // 153.1-05 / D-34 — the LITERAL was `draft_state_invalid` (lowercase) until
    // this plan. That is the one WIRE change in the D-34 reorder, and this
    // assertion is where it is pinned: lowercase can never be a
    // `WizardErrorCode`, so the 409 rendered the UNKNOWN card and its
    // RECOVERABLE copy handed the user a Retry that re-POSTed the identical
    // request against a draft the DB had already moved past. The uppercase
    // member (153.1-04) has non-recoverable copy and is admitted to
    // `KNOWN_FINALIZE_CODES` in this same commit.
    const fetchSpy = mockProbeReadOnly();
    const consoleErr = vi.spyOn(console, "error").mockImplementation(() => {});
    routeThroughLegacyFinalize();
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
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toContain("not in a finalizable state");
    expect(body.code).toBe("DRAFT_STATE_INVALID");
    // The raw status/source details must not leak (P445-style hardening).
    expect(JSON.stringify(body)).not.toContain("source=legacy");

    fetchSpy.mockRestore();
    consoleErr.mockRestore();
  });

  it("falls through to 500 + generic message for any other SQLSTATE", async () => {
    const fetchSpy = mockProbeReadOnly();
    const consoleErr = vi.spyOn(console, "error").mockImplementation(() => {});
    // A made-up unhandled code — must NOT silently 200, must NOT leak.
    routeThroughLegacyFinalize();
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
    routeThroughLegacyFinalize();
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
    STATE.processKeyResult = {
      ok: true,
      body: { queued: true, verification_id: "ver-1" },
    };

    const POST = await importPost();
    const res = await POST(makeReq(VALID_BODY));
    expect(res.status).toBe(200);
    const body = await res.json();
    // H-0309: pin the ok:true discriminator on the LIVE (unified) path, not
    // just the legacy handler.
    expect(body.ok).toBe(true);
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
    expect(body.ok).toBe(true); // H-0309: discriminator pinned on the unified dedup path
    expect(body.queued).toBe(false);
    expect(body.code).toBe("WIZARD_DUPLICATE");
    expect(body.idempotent).toBe(true);
    expect(body.verification_id).toBe("ver-existing");
    expect(body.strategy_id).toBe(STRATEGY_ID);

    fetchSpy.mockRestore();
  });

  // Phase 140.1.1 / PYAPIFIX-01 — the INVERTED contract. This test used to
  // assert the opposite ("rejects mixed envelope … with 502"); it is rewritten,
  // not deleted, because the shape it called a backbone bug is the shape the
  // backbone actually emits.
  //
  // `queued` (a job fact) and `code`/`idempotent` (a submission fact) are
  // ORTHOGONAL, and process_key.py's `_resume_duplicate_job` exists precisely
  // to produce the state where both are true: a duplicate submission whose
  // WEDGED job we re-enqueued. Rejecting it fired a 502 + Sentry on a
  // SUCCESSFUL resume. The exact body below is the fixture's P1 case
  // (analytics-service/tests/fixtures/process_key_onboard_contract.json),
  // proven equal to a real /process-key reply by
  // analytics-service/tests/test_process_key_onboard_contract.py.
  it("accepts the resumed-wedge reply (queued=true WITH code + idempotent) and returns 200", async () => {
    const fetchSpy = mockProbeReadOnly();
    const consoleErr = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    STATE.processKeyResult = {
      ok: true,
      body: {
        ok: true,
        code: "WIZARD_DUPLICATE",
        idempotent: true,
        verification_id: "ver-resumed",
        status: "draft",
        trust_tier: "api_verified",
        queued: true,
        job_state: "enqueued",
      },
    };

    const POST = await importPost();
    const res = await POST(makeReq(VALID_BODY));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.strategy_id).toBe(STRATEGY_ID);
    expect(body.status).toBe("pending_review");
    expect(body.queued).toBe(true);
    expect(body.verification_id).toBe("ver-resumed");
    // The queued=true forward arm (route.ts:1352-1361) does NOT forward
    // `code`/`idempotent`/`job_state` — pinned here so a future phase that
    // wires the duplicate copy onto this arm (TS-01's "prefer discriminating
    // on ok + job_state") sees this test, rather than silently changing what
    // wizard chrome receives.
    expect(body.code).toBeUndefined();
    expect(body.idempotent).toBeUndefined();
    expect(body.job_state).toBeUndefined();

    // The 502/Sentry contract-violation arm must NOT have fired.
    const sentryCall = STATE.captureToSentryCalls.find(
      (c) => c.options.tags.step === "unified-response-parse",
    );
    expect(sentryCall).toBeUndefined();

    consoleErr.mockRestore();
    fetchSpy.mockRestore();
  });

  // Phase 140.1.1 / PYAPIFIX-01 — the RETAINED negative. The widening is
  // scoped to the WIZARD_DUPLICATE contract, never a blanket allowance: a
  // predicate that simply stopped inspecting `code`/`idempotent` would pass
  // the test above and fail here. This is the fixture's N3 case; `idempotent`
  // is only ever emitted alongside code "WIZARD_DUPLICATE"
  // (process_key.py:680-690 sets both in the same dict literal), so an
  // `idempotent: true` beside any other code is genuine malformation and must
  // still reach the 502 + Sentry arm.
  it("still rejects idempotent:true paired with a NON-duplicate code with 502", async () => {
    const fetchSpy = mockProbeReadOnly();
    const consoleErr = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    STATE.processKeyResult = {
      ok: true,
      body: {
        ok: true,
        code: "OTHER",
        idempotent: true,
        verification_id: "ver-1",
        queued: true,
        job_state: "enqueued",
      },
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
    expect(sentryCall!.options.tags.surface).toBe("finalize-wizard");

    consoleErr.mockRestore();
    fetchSpy.mockRestore();
  });

  // Phase 140.1.1 / PYAPIFIX-01 — the second retained negative (fixture N2).
  // `typeof "" === "string"`, so an EMPTY code passes a type-only check and
  // would render an unnamed condition as a named one in wizard chrome.
  it("still rejects an EMPTY code on the duplicate arm with 502", async () => {
    const fetchSpy = mockProbeReadOnly();
    const consoleErr = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    STATE.processKeyResult = {
      ok: true,
      body: {
        ok: true,
        code: "",
        verification_id: "ver-1",
        queued: false,
        job_state: "not_applicable",
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
    routeThroughLegacyFinalize();
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

/**
 * Phase 88 (ONB-01) — composite-first finalize routing + O-1 per-member
 * scope-broadening re-probe.
 *
 * D-LOCKED (CONTEXT 2026-07-10, Option A): a strategy with >=1 strategy_keys
 * member (api_key_id NULL) ALWAYS enqueues stitch_composite via
 * runLegacyFinalize's after() arm, BEFORE and independent of the unified
 * single-key arm. The backbone is permanent-on (Phase 106), and its single-key
 * arm 409s composites (COMPOSITE_UNSUPPORTED_UNIFIED) — the hoist is what makes
 * wizard composites reach prod at all.
 *
 * The hoist engages only for api_key_id === null: composites have api_key_id
 * NULL by construction; an api_key_id-bearing strategy is definitively
 * single-key (the two are mutually exclusive). This scopes the W-4 fail-closed
 * posture to a POSSIBLE composite and leaves the single-key unified-vs-legacy
 * split byte-unchanged.
 *
 * O-1: runScopeBroadeningProbe only probes strategies.api_key_id, which is NULL
 * for composites, so composite members would otherwise skip the connect→submit
 * broadening defense the single-key path gets. The hoist re-probes EACH member
 * key (ordered by seq) before any enqueue; first failure returns the same
 * 403 KEY_SCOPE_BROADENED / 502 KEY_NETWORK_TIMEOUT codes as the single-key path.
 */
describe("POST /api/strategies/finalize-wizard — Phase 88 composite-first routing + O-1", () => {
  function readOnlyResponse(): Response {
    return new Response(
      JSON.stringify({
        read: true,
        trade: false,
        withdraw: false,
        probe_error: false,
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }
  function broadenedResponse(): Response {
    return new Response(
      JSON.stringify({
        read: true,
        trade: true,
        withdraw: false,
        probe_error: false,
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }

  it("routes a composite (api_key_id NULL, >=1 members) to stitch_composite under backbone-ON — no 409", async () => {
    // Fresh Response per call — the O-1 loop probes each member, and a shared
    // Response body can only be read once.
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () => readOnlyResponse());
    STATE.strategyRow = { api_key_id: null }; // composite
    STATE.strategyKeysCount = 2;
    STATE.strategyKeysList = [
      { api_key_id: MEMBER_KEY_1 },
      { api_key_id: MEMBER_KEY_2 },
    ];
    STATE.runAfterCallback = true;

    const POST = await importPost();
    const res = await POST(makeReq(VALID_BODY));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.status).toBe("pending_review");
    // NOT the unified rejection.
    expect(body.code).not.toBe("COMPOSITE_UNSUPPORTED_UNIFIED");

    await flushAfter();

    // runLegacyFinalize ran (the RPC fired) — proving we did NOT go unified.
    expect(
      STATE.rpcCalls.find((c) => c.name === "finalize_wizard_strategy"),
    ).toBeDefined();
    // after() enqueued stitch_composite (the composite arm), not sync_trades.
    const enqueue = STATE.adminRpcCalls.find(
      (c) => c.name === "enqueue_compute_job",
    );
    expect(enqueue).toBeDefined();
    expect(enqueue!.args.p_kind).toBe("stitch_composite");
    expect(enqueue!.args.p_strategy_id).toBe(STRATEGY_ID);
    // No composite-unsupported failed stamp (the unified path would have stamped one).
    expect(
      STATE.strategyAnalyticsUpserts.find(
        (p) => p.computation_status === "failed",
      ),
    ).toBeUndefined();
    fetchSpy.mockRestore();
  });

  it("O-1: returns 403 KEY_SCOPE_BROADENED when the FIRST member broadened — short-circuits before enqueue", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(broadenedResponse())
      .mockResolvedValue(readOnlyResponse());
    STATE.strategyRow = { api_key_id: null };
    STATE.strategyKeysCount = 2;
    STATE.strategyKeysList = [
      { api_key_id: MEMBER_KEY_1 },
      { api_key_id: MEMBER_KEY_2 },
    ];
    STATE.runAfterCallback = true;

    const POST = await importPost();
    const res = await POST(makeReq(VALID_BODY));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.code).toBe("KEY_SCOPE_BROADENED");
    // Short-circuit on the first member — only one probe fired.
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    await flushAfter();
    // Never enqueued — the broadened composite must not reach the worker.
    expect(
      STATE.adminRpcCalls.find((c) => c.name === "enqueue_compute_job"),
    ).toBeUndefined();
    // finalize RPC never ran either.
    expect(
      STATE.rpcCalls.find((c) => c.name === "finalize_wizard_strategy"),
    ).toBeUndefined();
    fetchSpy.mockRestore();
  });

  it("O-1: returns 403 when the SECOND member (ordered by seq) broadened — probes members in order", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(readOnlyResponse())
      .mockResolvedValueOnce(broadenedResponse())
      .mockResolvedValue(readOnlyResponse());
    STATE.strategyRow = { api_key_id: null };
    STATE.strategyKeysCount = 2;
    STATE.strategyKeysList = [
      { api_key_id: MEMBER_KEY_1 },
      { api_key_id: MEMBER_KEY_2 },
    ];

    const POST = await importPost();
    const res = await POST(makeReq(VALID_BODY));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.code).toBe("KEY_SCOPE_BROADENED");
    // Both members probed (first read-only, second broadened) — proves the loop
    // walks members in seq order rather than stopping at member 1.
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(
      STATE.adminRpcCalls.find((c) => c.name === "enqueue_compute_job"),
    ).toBeUndefined();
    fetchSpy.mockRestore();
  });

  it("O-1: returns 502 KEY_NETWORK_TIMEOUT when a member probe fails — no enqueue", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("ECONNREFUSED"));
    const consoleErr = vi.spyOn(console, "error").mockImplementation(() => {});
    STATE.strategyRow = { api_key_id: null };
    STATE.strategyKeysCount = 1;
    STATE.strategyKeysList = [{ api_key_id: MEMBER_KEY_1 }];

    const POST = await importPost();
    const res = await POST(makeReq(VALID_BODY));
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.code).toBe("KEY_NETWORK_TIMEOUT");
    expect(
      STATE.adminRpcCalls.find((c) => c.name === "enqueue_compute_job"),
    ).toBeUndefined();
    consoleErr.mockRestore();
    fetchSpy.mockRestore();
  });

  it("W-4: fails CLOSED (5xx, no single-key dispatch) when the composite membership count errors", async () => {
    const consoleErr = vi.spyOn(console, "error").mockImplementation(() => {});
    STATE.strategyRow = { api_key_id: null }; // possible composite
    STATE.strategyKeysCountError = { message: "count boom" };
    // The hoist blocks the single-key dispatch for a possible composite (the
    // path a count blip would silently route a possible composite through).

    const POST = await importPost();
    const res = await POST(makeReq(VALID_BODY));
    // 5xx fail-closed — never a silent single-key dispatch of a possible composite.
    expect(res.status).toBeGreaterThanOrEqual(500);
    const body = await res.json();
    expect(body.code).toBe("COMPOSITE_MEMBERSHIP_UNKNOWN");
    // Neither the single-key legacy RPC nor any enqueue fired.
    expect(
      STATE.rpcCalls.find((c) => c.name === "finalize_wizard_strategy"),
    ).toBeUndefined();
    expect(
      STATE.adminRpcCalls.find((c) => c.name === "enqueue_compute_job"),
    ).toBeUndefined();
    // compositeMemberCount stamped a terminal 'failed' before throwing.
    const failedStamp = STATE.strategyAnalyticsUpserts.find(
      (p) => p.computation_status === "failed",
    );
    expect(failedStamp).toBeDefined();
    expect(failedStamp!.strategy_id).toBe(STRATEGY_ID);
    // Surfaced to Sentry with the composite-membership-probe step.
    const sentry = STATE.captureToSentryCalls.find(
      (c) => c.options.tags.step === "composite-membership-probe",
    );
    expect(sentry).toBeDefined();
    consoleErr.mockRestore();
  });

  // Neutrality guards — the single-key path is byte-unchanged (green before AND
  // after the hoist). These pin that the composite branch never engages for an
  // api_key_id-bearing strategy.
  it("neutrality: single-key (api_key_id set, 0 members) still uses the unified path under backbone-ON", async () => {
    const fetchSpy = mockProbeReadOnly();
    STATE.strategyRow = { api_key_id: API_KEY_ID };
    STATE.strategyKeysCount = 0;

    const POST = await importPost();
    const res = await POST(makeReq(VALID_BODY));
    expect(res.status).toBe(200);
    // Single-key unified path — NO composite failed stamp.
    expect(
      STATE.strategyAnalyticsUpserts.find(
        (p) => p.computation_status === "failed",
      ),
    ).toBeUndefined();
    fetchSpy.mockRestore();
  });

  it("Phase 106 Stage B: single-key (api_key_id set, 0 members) always uses the unified path — the flag-off legacy dispatch is deleted", async () => {
    const fetchSpy = mockProbeReadOnly();
    STATE.strategyRow = { api_key_id: API_KEY_ID };
    STATE.strategyKeysCount = 0;

    const POST = await importPost();
    const res = await POST(makeReq(VALID_BODY));
    expect(res.status).toBe(200);
    // The single-key legacy finalize RPC MUST NOT fire — dispatch is unified.
    expect(
      STATE.rpcCalls.find((c) => c.name === "finalize_wizard_strategy"),
    ).toBeUndefined();
    // No composite failed stamp on the single-key unified path.
    expect(
      STATE.strategyAnalyticsUpserts.find(
        (p) => p.computation_status === "failed",
      ),
    ).toBeUndefined();
    fetchSpy.mockRestore();
  });
});

// ══════════════════════════════════════════════════════════════════════════
// Phase 140.2-10 / SEAMCORE-10 (A-06, A-29) — the composite fan-out cap.
//
// The composite branch issues ONE cache-bypassing 15 000 ms seam probe PER
// MEMBER, sequentially, and the member read had no `.limit()`. The route's
// SEAM_ROUTE_BUDGETS row declared `keys-permissions × 1`, so the budget
// invariant asserted a fixed figure against the 300 000 ms function ceiling
// regardless of N — ~20 members reached the ceiling and nothing reddened.
//
// TWO independent properties are pinned here, and neither substitutes for the
// other:
//   1. the fan-out is bounded AT THE QUERY (`.limit(<cap>)`), not merely by the
//      loop — a loop bound cannot stop the read itself from returning 10 000
//      rows, and it is the read the budget table has to be able to trust;
//   2. a list that arrives AT the cap FAILS LOUD, because the route cannot
//      distinguish "exactly <cap> members" from "more than <cap>, truncated by
//      the limit" — and proceeding on a truncated list finalises a composite
//      whose remaining member keys were never re-probed, which is the
//      connect→submit scope-broadening hazard wearing a different disguise.
//
// EVERY expected number below is hand-typed. Nothing is imported from the
// route, and nothing is derived from SEAM_ROUTE_BUDGETS: the cross-file binding
// between the cap and the declared `calls` lives in
// `src/lib/seam-budgets.invariant.test.ts`, where BOTH sides are read
// independently (the table from the module, the constant from disk).
// ══════════════════════════════════════════════════════════════════════════
describe("POST /api/strategies/finalize-wizard — SEAMCORE-10 composite fan-out cap", () => {
  function readOnlyResponse(): Response {
    return new Response(
      JSON.stringify({
        read: true,
        trade: false,
        withdraw: false,
        probe_error: false,
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }

  /** `n` distinct member rows, ordered — ids are irrelevant, the COUNT is not. */
  function membersOfLength(n: number): Array<{ api_key_id: string }> {
    return Array.from({ length: n }, (_unused, i) => ({
      api_key_id: `66666666-6666-4666-8666-${String(i).padStart(12, "0")}`,
    }));
  }

  it("bounds the member read AT THE QUERY — the read carries .limit(11) = cap + 1", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () => readOnlyResponse());
    STATE.strategyRow = { api_key_id: null }; // composite
    STATE.strategyKeysCount = 2;
    STATE.strategyKeysList = membersOfLength(2);

    const POST = await importPost();
    const res = await POST(makeReq(VALID_BODY));
    expect(res.status).toBe(200);

    // 11, hand-typed = MAX_COMPOSITE_MEMBERS + 1. The route's own constant is
    // deliberately NOT imported: an expectation read out of the module under
    // test cannot disagree with it, which is the self-referential oracle this
    // phase exists to eliminate.
    //
    // ⚠️ WHY cap + 1 AND NOT cap (ME-02). `.limit(cap)` cannot distinguish
    // "this composite has exactly cap members" from "it has more and you are
    // holding the first cap of them", so the route had to refuse at `>= cap`
    // and the usable maximum was cap - 1 — the constant was off by one from the
    // thing it names. The extra row is a TRUNCATION DETECTOR, never probed: the
    // route refuses before the loop whenever it arrives, so the fan-out this
    // assertion bounds is still cap, and SEAM_ROUTE_BUDGETS' `calls: 10` and
    // SC-4e stay exact.
    expect(
      STATE.strategyKeysListLimit,
      "The composite member read issued no .limit(). The fan-out is bounded " +
        "only by however many rows the database chooses to return, so the " +
        "declared keys-permissions call count in SEAM_ROUTE_BUDGETS is a " +
        "statement about nothing (ledger row M32).",
    ).toBe(11);
    fetchSpy.mockRestore();
  });

  it("fails LOUD when the member list OVERFLOWS the cap — no probe, no finalize, no enqueue", async () => {
    const consoleErr = vi.spyOn(console, "error").mockImplementation(() => {});
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () => readOnlyResponse());
    STATE.strategyRow = { api_key_id: null };
    // 11 = MAX_COMPOSITE_MEMBERS + 1, hand-typed: the read asks for cap + 1
    // rows, so cap + 1 coming back is PROOF the draft has more members than the
    // route can probe. That is the only reading on which a refusal is correct.
    STATE.strategyKeysCount = 11;
    STATE.strategyKeysList = membersOfLength(11);
    STATE.runAfterCallback = true;

    const POST = await importPost();
    const res = await POST(makeReq(VALID_BODY));

    // Fail CLOSED, exactly as an un-enumerable member list does.
    expect(res.status).toBe(503);
    const body = await res.json();
    // ⚠️ RE-PINNED by 140.3-14 / TS-37, NOT weakened. This assertion previously
    // read `COMPOSITE_MEMBERSHIP_UNKNOWN` — the byte this plan deliberately
    // changes — so it could not survive unmodified; the plan's "both pinned
    // cases stay unmodified" is satisfiable for the ME-02 cap-is-not-off-by-one
    // case (which asserts no code at all) and structurally impossible for this
    // one. It is STRICTLY STRONGER now: it asserts the exact new code AND the
    // absence of the transient one, so a revert of the split reddens here
    // rather than passing on a substring.
    expect(body.code).toBe("COMPOSITE_TOO_MANY_MEMBERS");
    expect(
      body.code,
      "The permanent cap refusal is answering with the TRANSIENT membership " +
        "code again, which renders 'please retry' and a Retry control for a " +
        "condition that never clears (TS-37).",
    ).not.toBe("COMPOSITE_MEMBERSHIP_UNKNOWN");
    // The wire message names the limit and the remedy, hand-typed here: this is
    // the only user-facing string a non-wizard caller of this route sees.
    expect(body.error).toContain("more than 10 keys");
    expect(body.error).toContain("Remove keys until 10 or fewer remain");

    // ZERO probes: the refusal happens BEFORE the loop, so a truncated list
    // never even spends the fan-out it could not bound.
    expect(fetchSpy).toHaveBeenCalledTimes(0);

    await flushAfter();
    // Nothing was finalised and nothing was enqueued — a composite with
    // unprobed members must not reach pending_review or the worker.
    expect(
      STATE.rpcCalls.find((c) => c.name === "finalize_wizard_strategy"),
    ).toBeUndefined();
    expect(
      STATE.adminRpcCalls.find((c) => c.name === "enqueue_compute_job"),
    ).toBeUndefined();

    // The operator gets a DISTINCT step tag. It was distinct BEFORE the user
    // half was (140.3-14 / TS-37): the log line and this tag were the only
    // places the cap was nameable while the envelope was shared. Both halves
    // now say "cap", and this assertion pins the operator one unchanged.
    const sentry = STATE.captureToSentryCalls.find(
      (c) => c.options.tags.step === "composite-member-cap",
    );
    expect(
      sentry,
      "Reaching the cap produced no Sentry event tagged " +
        "`composite-member-cap`. A truncation that finalises unprobed keys " +
        "must be alertable, not merely refused (ledger row M48).",
    ).toBeDefined();

    consoleErr.mockRestore();
    fetchSpy.mockRestore();
  });

  it("[140.3-14 / TS-37] ANTI-REGRESSION: the member-list-read arm — BYTE-IDENTICAL to the cap arm until now — KEEPS the transient code", async () => {
    // ⚠️ THE CASE THAT CATCHES A FIX APPLIED TO THE WRONG ARM, AND IT TARGETS
    // THE ARM MOST LIKELY TO BE HIT BY ONE. `finalize-wizard` emits
    // `COMPOSITE_MEMBERSHIP_UNKNOWN` at FOUR sites; exactly ONE (the cap) is a
    // permanent condition. This arm — the member-list READ failure ~40 lines
    // above the cap — returned a byte-identical envelope to the cap arm, so an
    // executor fixing "the composite membership arms" as a group, or grepping
    // the old envelope string and replacing every hit, strips a CORRECT retry
    // from a genuinely transient fault. That is the inverse of the defect
    // TS-37 fixes, and every cap-side assertion in this file stays green
    // through it.
    //
    // The other two transient arms are asserted by their own cases and by their
    // own Sentry step tags — `composite-membership-probe` (the hoist's count
    // probe) and `unified-composite-probe` (the unified arm) — so the four arms
    // are covered by four independent oracles, not one shared one.
    const consoleErr = vi.spyOn(console, "error").mockImplementation(() => {});
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () => readOnlyResponse());
    STATE.strategyRow = { api_key_id: null };
    STATE.strategyKeysCount = 3;
    STATE.strategyKeysListError = {
      code: "57014",
      message: "canceling statement due to statement timeout",
    };

    const POST = await importPost();
    const res = await POST(makeReq(VALID_BODY));

    expect(res.status).toBe(503);
    const body = await res.json();
    // Hand-typed on both sides. The transient code SURVIVES here…
    expect(body.code).toBe("COMPOSITE_MEMBERSHIP_UNKNOWN");
    // …and the permanent one must NOT have leaked onto it. A statement timeout
    // reading the member list really does clear on retry; telling that user
    // their draft holds too many keys is a fresh lie (TRAP-3).
    expect(
      body.code,
      "The permanent cap code leaked onto the transient member-list-read arm. " +
        "The split was applied to more than the one arm that is permanent.",
    ).not.toBe("COMPOSITE_TOO_MANY_MEMBERS");
    expect(body.error).toBe("Could not load composite members; please retry.");

    // Its own operator tag, distinct from the cap's — this is what makes the
    // two arms separable in Sentry as well as on the wire.
    expect(
      STATE.captureToSentryCalls.find(
        (c) => c.options.tags.step === "composite-member-list",
      ),
    ).toBeDefined();
    expect(
      STATE.captureToSentryCalls.find(
        (c) => c.options.tags.step === "composite-member-cap",
      ),
      "A member-list READ failure raised the cap alert. The two arms are no " +
        "longer separable for an operator either.",
    ).toBeUndefined();

    consoleErr.mockRestore();
    fetchSpy.mockRestore();
  });

  it("ME-02: a GENUINE 10-member composite finalises — the cap is not off by one", async () => {
    // ⚠️ THE DEAD END THIS CLOSES. `.limit(10)` plus a refusal at `>= 10` made
    // the usable maximum NINE, so the constant named MAX_COMPOSITE_MEMBERS = 10
    // was off by one from the thing it names. A user with a genuine 10-member
    // draft got a 503 COMPOSITE_MEMBERSHIP_UNKNOWN whose copy says "please
    // retry" — for a PERMANENT condition. Forever, with no path forward and no
    // explanation, and every existing >= 10-member composite became
    // un-finalizable the moment the cap shipped.
    //
    // Fetching cap + 1 separates "exactly at the cap" from "possibly
    // truncated", which `.limit(cap)` structurally cannot.
    //
    // The COPY half — this arm still shares the transient membership-unknown
    // envelope, and a permanent condition should not render a retry affordance
    // — is 140.3's fence and is recorded in 140.1-TS-OBLIGATIONS.md, not
    // authored here.
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () => readOnlyResponse());
    STATE.strategyRow = { api_key_id: null };
    STATE.strategyKeysCount = 10;
    STATE.strategyKeysList = membersOfLength(10);
    STATE.runAfterCallback = true;

    const POST = await importPost();
    const res = await POST(makeReq(VALID_BODY));
    expect(res.status).toBe(200);

    // 10, hand-typed: EVERY member is probed. A cap fix that finalised without
    // probing the tenth key would be the scope-broadening hole the O-1 loop
    // exists to close, which is worse than the dead end it replaces.
    expect(fetchSpy).toHaveBeenCalledTimes(10);

    await flushAfter();
    const enqueue = STATE.adminRpcCalls.find(
      (c) => c.name === "enqueue_compute_job",
    );
    expect(enqueue).toBeDefined();
    expect(enqueue!.args.p_kind).toBe("stitch_composite");
    fetchSpy.mockRestore();
  });

  it("does NOT fire one member below the cap — 9 members are all probed and the composite finalises", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () => readOnlyResponse());
    STATE.strategyRow = { api_key_id: null };
    STATE.strategyKeysCount = 9;
    STATE.strategyKeysList = membersOfLength(9);
    STATE.runAfterCallback = true;

    const POST = await importPost();
    const res = await POST(makeReq(VALID_BODY));
    expect(res.status).toBe(200);

    // 9, hand-typed: the cap arm is an INEQUALITY at exactly one point, and a
    // guard written `>` instead of `>=` (or `>=` at the wrong number) is
    // invisible without both sides of the boundary asserted.
    expect(fetchSpy).toHaveBeenCalledTimes(9);

    await flushAfter();
    const enqueue = STATE.adminRpcCalls.find(
      (c) => c.name === "enqueue_compute_job",
    );
    expect(enqueue).toBeDefined();
    expect(enqueue!.args.p_kind).toBe("stitch_composite");
    fetchSpy.mockRestore();
  });

  it("CR-01: a member-list read error reaches the OPERATOR LOG with its SQLSTATE, not as [object Object]", async () => {
    // ⚠️ THE WIRING, NOT THE HELPER. `seam-redaction.test.ts` pins that the leaf
    // renders a plain object; this pins that the ROUTE actually gets that
    // rendering. The two are different claims, and this phase converted six
    // sites in THIS file from `err.message` to `scrubSeamError(err)` — a
    // conversion that was a strict regression until CR-01 landed, because a
    // Supabase error on the non-throwing path is a PLAIN object and
    // `String(plainObject)` is "[object Object]".
    //
    // The route fails closed with a 503 the user is told to retry, so this log
    // line is the ONLY operator artefact for a composite that will not finalise.
    const consoleErr = vi.spyOn(console, "error").mockImplementation(() => {});
    const fetchSpy = mockProbeReadOnly();
    STATE.strategyRow = { api_key_id: null };
    STATE.strategyKeysCount = 2;
    STATE.strategyKeysListError = {
      code: "42501",
      message: "permission denied for table strategy_keys",
      details: "RLS policy strategy_keys_owner_select denied the read",
      hint: "check auth.uid() against owner_id",
    };

    const POST = await importPost();
    const res = await POST(makeReq(VALID_BODY));
    expect(res.status).toBe(503);
    expect((await res.json()).code).toBe("COMPOSITE_MEMBERSHIP_UNKNOWN");

    const logged = consoleErr.mock.calls
      .map((args) => args.map((a) => String(a)).join(" "))
      .find((line) => line.includes("composite member list read failed"));

    expect(
      logged,
      "The composite member-list read failure produced no operator log line at all.",
    ).toBeDefined();
    // Every expected substring is hand-typed above and asserted here; nothing is
    // read back out of the route or the leaf.
    expect(logged).not.toContain("[object Object]");
    expect(logged).toContain("42501");
    expect(logged).toContain("permission denied for table strategy_keys");
    expect(logged).toContain("RLS policy strategy_keys_owner_select denied the read");

    consoleErr.mockRestore();
    fetchSpy.mockRestore();
  });

  it("zero members (api_key_id NULL) never reaches the member read at all", async () => {
    const fetchSpy = mockProbeReadOnly();
    STATE.strategyRow = { api_key_id: null };
    STATE.strategyKeysCount = 0;
    STATE.strategyKeysList = [];

    const POST = await importPost();
    const res = await POST(makeReq(VALID_BODY));
    expect(res.status).toBe(200);
    // The CSV / no-member draft falls through to the unified arm without ever
    // enumerating members, so neither the read nor the cap arm engages.
    expect(STATE.strategyKeysListLimit).toBeNull();
    fetchSpy.mockRestore();
  });
});

// ══════════════════════════════════════════════════════════════════════════
// CONTRIB-02 (Phase 110) — the contribution wizard entry finalizes an allocator
// strategy to an owner-only status='private', on both the single-key API path
// and (no per-source fork) the composite path — never 'pending_review'. The
// manager flow (default / entry_context absent) stays byte-identical, and the
// admin review-notify is suppressed for a private contribution while the
// analytics enqueue is KEPT (the allocator needs KPIs in the composer).
// ══════════════════════════════════════════════════════════════════════════
describe("POST /api/strategies/finalize-wizard — CONTRIB-02 private-by-default contribution", () => {
  it("default body (no entry_context) → 200 status='pending_review' via the unified arm (byte-identical manager flow)", async () => {
    const fetchSpy = mockProbeReadOnly();
    STATE.strategyRow = { api_key_id: API_KEY_ID };
    STATE.strategyKeysCount = 0;

    const POST = await importPost();
    const res = await POST(makeReq(VALID_BODY));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("pending_review");
    // Manager single-key stays on the unified arm — legacy RPC untouched.
    expect(
      STATE.rpcCalls.find((c) => c.name === "finalize_wizard_strategy"),
    ).toBeUndefined();
    fetchSpy.mockRestore();
  });

  it("entry_context='contribution' single-key API → routes through the legacy RPC with p_terminal_status='private' and returns status='private'", async () => {
    const fetchSpy = mockProbeReadOnly();
    STATE.strategyRow = { api_key_id: API_KEY_ID };
    STATE.strategyKeysCount = 0;

    const POST = await importPost();
    const res = await POST(
      makeReq({ ...VALID_BODY, entry_context: "contribution" }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    // The response reflects the ACTUAL terminal status.
    expect(body.status).toBe("private");
    // A contribution MUST NOT ride the unified arm (which never promotes
    // strategies.status) — it must call finalize_wizard_strategy directly
    // with p_terminal_status='private' (W1 note, 110-01).
    const rpc = STATE.rpcCalls.find(
      (c) => c.name === "finalize_wizard_strategy",
    );
    expect(rpc).toBeDefined();
    expect(rpc!.args.p_terminal_status).toBe("private");
    fetchSpy.mockRestore();
  });

  it("entry_context='contribution' composite (api_key_id NULL, ≥1 member) → also finalizes 'private' (no per-source fork)", async () => {
    const fetchSpy = mockProbeReadOnly();
    STATE.strategyRow = { api_key_id: null };
    STATE.strategyKeysCount = 1;
    STATE.strategyKeysList = [{ api_key_id: MEMBER_KEY_1 }];

    const POST = await importPost();
    const res = await POST(
      makeReq({ ...VALID_BODY, entry_context: "contribution" }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("private");
    const rpc = STATE.rpcCalls.find(
      (c) => c.name === "finalize_wizard_strategy",
    );
    expect(rpc).toBeDefined();
    expect(rpc!.args.p_terminal_status).toBe("private");
    fetchSpy.mockRestore();
  });

  it("contribution: admin review-notify is SUPPRESSED but the analytics enqueue is KEPT", async () => {
    const fetchSpy = mockProbeReadOnly();
    STATE.strategyRow = { api_key_id: API_KEY_ID };
    STATE.strategyKeysCount = 0;
    STATE.adminApiKeyId = API_KEY_ID; // so the single-key sync_trades enqueue fires
    STATE.runAfterCallback = true;

    const POST = await importPost();
    const res = await POST(
      makeReq({ ...VALID_BODY, entry_context: "contribution" }),
    );
    expect(res.status).toBe(200);
    await flushAfter();

    // Review-notify suppressed — a 'private' row is never a review candidate.
    expect(STATE.notifyFounderCalls.length).toBe(0);
    // Analytics enqueue retained — the allocator needs KPIs in the composer.
    expect(
      STATE.adminRpcCalls.find(
        (c) =>
          c.name === "enqueue_compute_job" &&
          (c.args as { p_kind?: string }).p_kind === "sync_trades",
      ),
    ).toBeDefined();
    fetchSpy.mockRestore();
  });

  it("neutrality: a MANAGER composite (default entry_context) STILL fires the founder review-notify — proving the suppression is contribution-specific, not a global removal", async () => {
    const fetchSpy = mockProbeReadOnly();
    routeThroughLegacyFinalize(); // composite, default (manager) entry_context
    STATE.runAfterCallback = true;

    const POST = await importPost();
    const res = await POST(makeReq(VALID_BODY));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("pending_review");
    await flushAfter();
    // Manager path notifies the founder (byte-identical pre-phase behavior).
    expect(STATE.notifyFounderCalls.length).toBe(1);
    fetchSpy.mockRestore();
  });

  it("entry_context='garbage' → 400 at validation, never reaches the finalize RPC", async () => {
    const POST = await importPost();
    const res = await POST(
      makeReq({ ...VALID_BODY, entry_context: "garbage" }),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(String(body.error)).toContain("entry_context");
    // 153.1-05 — VALIDATION_FAILED rather than a field-level code:
    // `entry_context` is a context selector the wizard sets from which surface
    // the user entered by, never something they typed, so there is no form
    // control to route them back to (RESEARCH Q3).
    expect(body.code).toBe("VALIDATION_FAILED");
    expect(
      STATE.rpcCalls.find((c) => c.name === "finalize_wizard_strategy"),
    ).toBeUndefined();
  });
});

/**
 * Phase 140.3-14 / TS-33 — THE DEDUPE ID REACHES /process-key.
 *
 * ⚠️ WHAT WAS ACTUALLY BROKEN, stated precisely, because the obligation row
 * states it too broadly. `process_key.py` gates `idempotent_by_session` on
 * `bool(context.get("wizard_session_id"))` and mints a fresh uuid4 when the
 * caller sends none. The row says "no caller sent wizard_session_id" — that is
 * FALSE as a general statement (correction C-7 / F-2): `csv-validate` and
 * `csv-finalize` both send it in exactly this context object today, so the
 * mechanism is LIVE on the CSV path. The true scope was ONE call site,
 * `finalize-wizard`, whose payload carried no id at all — so every onboard /
 * resync ran with the dedupe off and a duplicate submit minted a second
 * verification row and a second job.
 *
 * ⚠️ ORACLE SHAPE. A dedupe is the classic vacuous-oracle subject: "no
 * duplicate appeared" is ALSO true when nothing appeared at all. Every case
 * below therefore asserts the POSITIVE — that the call fired, and fired
 * carrying the RIGHT identity — before asserting any absence.
 *
 * ── 141.2 / D-01: WHERE THE OTHER HALF OF THIS CONTRACT IS PINNED ────────────
 *
 * This describe owns the ROUTE half only: the context carries EXACTLY what the
 * draft row has — the draft's own id when the column is populated, and NOTHING
 * when it is NULL (absence forwarded as absence, never synthesised). Both
 * polarities are asserted below, and they are a contract, not an implementation
 * detail, because of what the OTHER side now does with them.
 *
 * That other side is `retriesForFlow` in `seam-retry-registry.ts`, which
 * `postProcessKey` consults at its single `resilientFetch` chokepoint. It turns
 * the absence this route forwards into `retriesOverride: 0` — an `onboard` call
 * with no usable idempotency key is refused a retry, because the server has
 * nothing to dedupe on in that state and would insert a second verification row
 * on attempt 2. So the "no key" case below is not merely tolerated downstream;
 * it now CHANGES the retry verdict.
 *
 * ⚠️ AND THIS FILE STRUCTURALLY CANNOT SEE THAT. The `vi.mock` of
 * `@/lib/process-key-client` above replaces the seam client WHOLESALE, so no
 * assertion here can ever observe `retriesOverride` — the real chokepoint is
 * never executed. That is why the retry pins live in `process-key-client.test.ts`
 * (the `retriesForFlow` cases in the D-01 describe there, which drive the REAL
 * `postProcessKey` and read the value off the captured core init), and the
 * helper's own branch table is pinned in `seam-retry-registry.test.ts`. A reader
 * who changes the context contract below must look at all three; a green run
 * here alone proves only that the route sent what the draft had.
 */
describe("POST /api/strategies/finalize-wizard — TS-33 wizard_session_id reaches the dedupe", () => {
  const DRAFT_SESSION_ID = "33333333-3333-4333-8333-333333333333";

  it("forwards the draft's OWN wizard_session_id inside the postProcessKey context", async () => {
    const fetchSpy = mockProbeReadOnly();
    STATE.strategyRow = {
      api_key_id: API_KEY_ID,
      wizard_session_id: DRAFT_SESSION_ID,
    };

    const POST = await importPost();
    const res = await POST(makeReq(VALID_BODY));
    expect(res.status).toBe(200);

    // POSITIVE, and first: the dispatch happened at all. Asserting only the
    // field's shape would pass on a route that never dispatched.
    expect(
      STATE.processKeyCalls.length,
      "finalize-wizard never called postProcessKey, so every assertion about " +
        "its payload below is vacuous.",
    ).toBe(1);

    const ctx = STATE.processKeyCalls[0].context!;
    // RIGHT IDENTITY, hand-typed on the expected side. `toBeDefined()` alone
    // would be satisfied by a route that minted its own id per request — which
    // is WORSE than sending nothing, because it keys the dedupe on a value that
    // changes on every attempt.
    expect(
      ctx.wizard_session_id,
      "The forwarded id is not the draft's own. A per-request or synthesised " +
        "id makes the dedupe strictly worse than absent (T-140.3-14-05).",
    ).toBe(DRAFT_SESSION_ID);

    // The SAME place the CSV routes put it — `context`, not a header, not a
    // top-level sibling of `flow_type`.
    expect(Object.keys(STATE.processKeyCalls[0])).not.toContain(
      "wizard_session_id",
    );
    fetchSpy.mockRestore();
  });

  it("a DUPLICATE resume sends the SAME id both times — the identity is stable, which is what makes dedupe possible", async () => {
    // ⚠️ THE BEHAVIOURAL HALF. Field-presence alone cannot distinguish a
    // caller-supplied stable id from a freshly-minted one: both are "present"
    // on a single request. Only a SECOND request can tell them apart, and the
    // duplicate resume is precisely the scenario TS-01's widened predicate was
    // bought FOR.
    const fetchSpy = mockProbeReadOnly();
    STATE.strategyRow = {
      api_key_id: API_KEY_ID,
      wizard_session_id: DRAFT_SESSION_ID,
    };

    const POST = await importPost();
    const first = await POST(makeReq(VALID_BODY));
    expect(first.status).toBe(200);

    // Second submit of the SAME draft — a double-click, a browser retry, or a
    // ⚠️ A FRESH Response per call. `mockProbeReadOnly` uses
    // `mockResolvedValue`, which hands the SAME Response object to every call —
    // and a Response body can only be read once, so the second request's scope
    // probe would throw and return 502 KEY_NETWORK_TIMEOUT before ever reaching
    // the dispatch this case is about. Two-request cases must mint a new
    // Response each time.
    fetchSpy.mockImplementation(
      async () =>
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

    // resumed wizard. Upstream now answers with the idempotent-resume envelope
    // it can only produce because the id it deduped on arrived from us.
    STATE.processKeyResult = {
      ok: true,
      body: {
        queued: false,
        verification_id: "ver-1",
        code: "WIZARD_DUPLICATE",
        idempotent: true,
      },
    };
    const second = await POST(makeReq(VALID_BODY));
    expect(second.status).toBe(200);

    // POSITIVE: both dispatches fired…
    expect(STATE.processKeyCalls.length).toBe(2);
    // …and both carried the identical id. A route minting its own would send
    // two DIFFERENT ids here and the upstream could never match them.
    expect(STATE.processKeyCalls[0].context!.wizard_session_id).toBe(
      DRAFT_SESSION_ID,
    );
    expect(
      STATE.processKeyCalls[1].context!.wizard_session_id,
      "The second submit sent a DIFFERENT wizard_session_id, so upstream can " +
        "never recognise it as a duplicate and mints a second verification row.",
    ).toBe(DRAFT_SESSION_ID);

    // The resumed-wedge path is what the caller SEES: the duplicate envelope's
    // discriminating fields survive the translation instead of being reported
    // as a fresh successful queue.
    const body = await second.json();
    expect(body.queued).toBe(false);
    expect(body.code).toBe("WIZARD_DUPLICATE");
    expect(body.idempotent).toBe(true);
    // …and it did NOT read as a brand-new dispatch.
    expect(body.verification_id).toBe("ver-1");
    fetchSpy.mockRestore();
  });

  it("a draft carrying NO session id sends NO key — absence, never a synthesised value", async () => {
    // The column is NULLABLE (migration 20260602190000). Absence must reproduce
    // the pre-140.3-14 body exactly: Python mints its own uuid4 and runs with
    // the dedupe off, which is where this route already was. Inventing one here
    // would be T-140.3-14-05.
    const fetchSpy = mockProbeReadOnly();
    STATE.strategyRow = { api_key_id: API_KEY_ID, wizard_session_id: null };

    const POST = await importPost();
    expect((await POST(makeReq(VALID_BODY))).status).toBe(200);

    expect(STATE.processKeyCalls.length).toBe(1);
    const ctx = STATE.processKeyCalls[0].context!;
    // The KEY is absent, not present-with-undefined: `JSON.stringify` drops an
    // undefined value, but `"wizard_session_id" in ctx` is the assertion that
    // actually distinguishes the two, and a conditional spread is the only
    // construction that satisfies it.
    expect(
      Object.prototype.hasOwnProperty.call(ctx, "wizard_session_id"),
      "A draft with no session id is sending the key anyway. Forward absence " +
        "as absence.",
    ).toBe(false);
    // POSITIVE control: the rest of the context is intact, so this is a
    // targeted absence and not a collapsed payload.
    expect(ctx.strategy_id).toBe(STRATEGY_ID);
    expect(ctx.step).toBe("finalize");
    fetchSpy.mockRestore();
  });

  it("the id cannot be shadowed by a same-named field arriving in the request body", async () => {
    // Spread order: `...args.payload` comes FIRST, so a client-supplied
    // `wizard_session_id` cannot displace the server-derived one. This is the
    // property that keeps the id non-attacker-controlled, which matters because
    // the dedupe index it feeds is tenant-scoped on (strategy_id,
    // wizard_session_id) — migration 20260726000225 / 140.1 PYAPI-01.
    const fetchSpy = mockProbeReadOnly();
    STATE.strategyRow = {
      api_key_id: API_KEY_ID,
      wizard_session_id: DRAFT_SESSION_ID,
    };

    const POST = await importPost();
    const res = await POST(
      makeReq({
        ...VALID_BODY,
        wizard_session_id: "44444444-4444-4444-8444-444444444444",
      }),
    );
    expect(res.status).toBe(200);

    expect(STATE.processKeyCalls.length).toBe(1);
    expect(
      STATE.processKeyCalls[0].context!.wizard_session_id,
      "A client-supplied wizard_session_id displaced the one read from the " +
        "owner-scoped draft row. The caller can now choose the dedupe key.",
    ).toBe(DRAFT_SESSION_ID);
    fetchSpy.mockRestore();
  });
});

// ══════════════════════════════════════════════════════════════════════════
// Phase 150 / OWN-03 — the capital-ownership mark
//
// The wizard now asks whose capital sits behind a key, and the answer is
// persisted as a strategy-level mark. Three properties are load-bearing:
//
//  1. The mark is written by a SEPARATE owner-scoped UPDATE after the finalize
//     RPC returns — the 13-arg SECURITY DEFINER signature is untouched. A
//     14th argument would mean a DROP/CREATE of the RPC on the wizard's
//     critical path, which is the higher-risk change (150-RESEARCH,
//     Alternatives Considered).
//  2. That non-atomicity is DELIBERATE and degrades safely: if the mark write
//     fails, the column stays NULL, and NULL is non-allocatable. A lost mark
//     costs the user a second click in the Mark dialog; a failed finalize
//     costs them the whole submission. It must never become a wizard error
//     arm — the v0.53.3.1 roster invariant means any unknown code renders the
//     UNKNOWN card.
//  3. The write is pinned to BOTH the finalized id and the caller's user_id.
//     strategies_update RLS carries no WITH CHECK, so the explicit predicate
//     is the actual boundary, not decoration (T-150-10).
// ══════════════════════════════════════════════════════════════════════════
describe("POST /api/strategies/finalize-wizard — OWN-03 capital-ownership mark", () => {
  /** The mark write, if the route made one. */
  function markWrite() {
    return STATE.strategyUpdates.find((u) => "capital_ownership" in u.patch);
  }

  it("persists capital_ownership='own_capital' with an owner-scoped UPDATE after the RPC", async () => {
    const fetchSpy = mockProbeReadOnly();
    STATE.strategyRow = { api_key_id: API_KEY_ID };
    STATE.strategyKeysCount = 0;

    const POST = await importPost();
    const res = await POST(
      makeReq({
        ...VALID_BODY,
        entry_context: "contribution",
        capital_ownership: "own_capital",
      }),
    );
    expect(res.status).toBe(200);

    // The finalize itself still happened through the untouched 13-arg RPC.
    const rpc = STATE.rpcCalls.find(
      (c) => c.name === "finalize_wizard_strategy",
    );
    expect(rpc).toBeDefined();
    expect(
      Object.keys(rpc!.args).some((k) => k.includes("capital")),
      "The mark leaked into the RPC argument list. It must ride a separate " +
        "UPDATE — the SECURITY DEFINER signature is not to be widened.",
    ).toBe(false);

    const write = markWrite();
    expect(write).toBeDefined();
    expect(write!.patch).toEqual({ capital_ownership: "own_capital" });
    // T-150-10: both predicates, or the patch could reach another user's row.
    expect(write!.eqs).toEqual([
      { column: "id", value: STRATEGY_ID },
      { column: "user_id", value: USER.id },
    ]);
    fetchSpy.mockRestore();
  });

  it("persists capital_ownership='team_review' the same way", async () => {
    const fetchSpy = mockProbeReadOnly();
    STATE.strategyRow = { api_key_id: API_KEY_ID };
    STATE.strategyKeysCount = 0;

    const POST = await importPost();
    const res = await POST(
      makeReq({
        ...VALID_BODY,
        entry_context: "contribution",
        capital_ownership: "team_review",
      }),
    );
    expect(res.status).toBe(200);

    const write = markWrite();
    expect(write).toBeDefined();
    expect(write!.patch).toEqual({ capital_ownership: "team_review" });
    expect(write!.eqs).toEqual([
      { column: "id", value: STRATEGY_ID },
      { column: "user_id", value: USER.id },
    ]);
    fetchSpy.mockRestore();
  });

  it("writes NOTHING when the body carries no capital_ownership (the column stays NULL)", async () => {
    // Absence is the manager path and every pre-Phase-150 caller. An absent
    // field must not be coerced to a default — an unasked user has not
    // answered, and NULL (non-allocatable) is the honest record of that.
    const fetchSpy = mockProbeReadOnly();
    STATE.strategyRow = { api_key_id: API_KEY_ID };
    STATE.strategyKeysCount = 0;

    const POST = await importPost();
    const res = await POST(
      makeReq({ ...VALID_BODY, entry_context: "contribution" }),
    );
    expect(res.status).toBe(200);
    expect(markWrite()).toBeUndefined();
    fetchSpy.mockRestore();
  });

  it("rejects a garbage capital_ownership with 400 BEFORE the RPC runs", async () => {
    // Closed set mirrored by the DB CHECK. Rejected at the boundary so a
    // garbled value can never reach the column that gates the money action —
    // and rejected BEFORE finalize so a bad request cannot half-succeed.
    const POST = await importPost();
    const res = await POST(
      makeReq({
        ...VALID_BODY,
        entry_context: "contribution",
        capital_ownership: "own_capitol",
      }),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    // ⚠️ 153.1-05 / D-09(b) — THIS ASSERTION USED TO PIN THE DEFECT. It read
    // `expect(body.code).toBeUndefined()`, justified by "minting a code here
    // would put a string the wizard roster does not know onto the client,
    // which renders the UNKNOWN card". True premise, backwards conclusion, and
    // the same one the source comment beside the arm carried: answering with
    // NO code does not avoid the UNKNOWN card, it guarantees it. The remedy is
    // to admit the code to `KNOWN_FINALIZE_CODES`, which this same commit
    // does. A test written the old way is worse than no test — it makes the
    // dead end a contract, so removing it would have read as a regression.
    expect(typeof body.error).toBe("string");
    expect(body.code).toBe("METADATA_CAPITAL_OWNERSHIP_INVALID");

    expect(
      STATE.rpcCalls.find((c) => c.name === "finalize_wizard_strategy"),
      "The RPC ran despite an invalid payload — validation is not a gate.",
    ).toBeUndefined();
    expect(markWrite()).toBeUndefined();
  });

  it("still finalizes 200 when the mark UPDATE errors — a lost mark degrades to NULL, never to a failed submit", async () => {
    // The deliberate non-atomicity. The user's strategy is finalized; only the
    // mark is missing, and they can set it from the Mark dialog. Turning this
    // into an error arm would throw away a successful finalize over metadata.
    const fetchSpy = mockProbeReadOnly();
    STATE.strategyRow = { api_key_id: API_KEY_ID };
    STATE.strategyKeysCount = 0;
    STATE.capitalOwnershipUpdateError = { message: "pg went away" };
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const POST = await importPost();
    const res = await POST(
      makeReq({
        ...VALID_BODY,
        entry_context: "contribution",
        capital_ownership: "own_capital",
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("private");
    expect(body.error).toBeUndefined();
    expect(body.code).toBeUndefined();

    // Silence is the real failure mode here: the mark is gone and nobody
    // knows. It must be logged with the id needed to find the row.
    const logged = errSpy.mock.calls.some(
      (c) =>
        c.join(" ").includes("capital_ownership") &&
        c.join(" ").includes(STRATEGY_ID),
    );
    expect(
      logged,
      "The mark write failed silently — no log line naming the strategy.",
    ).toBe(true);

    // 151 specialist F-3 — server-side logging is NOT enough. The user who
    // explicitly answered the capital question got a plain success screen while
    // their answer was dropped; the consequence (an unmarked strategy is
    // non-allocatable, so `Allocate…` never appears) surfaced days later as an
    // unexplained absence, and the documented remedy was discoverable only by
    // someone who already knew. The 200 body now carries a non-error sidecar so
    // the client can say so, without discarding the finalize.
    expect(body.capital_ownership_persisted).toBe(false);

    errSpy.mockRestore();
    fetchSpy.mockRestore();
  });

  it("logs a zero-row mark write (the patch matched nobody)", async () => {
    // Zero rows means the id+user_id predicate matched nothing: the row moved,
    // vanished, or was never the caller's. Same safe degradation, but it is a
    // different and more alarming story than a transport error, so it gets its
    // own log rather than passing unnoticed.
    const fetchSpy = mockProbeReadOnly();
    STATE.strategyRow = { api_key_id: API_KEY_ID };
    STATE.strategyKeysCount = 0;
    STATE.capitalOwnershipUpdateRows = [];
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const POST = await importPost();
    const res = await POST(
      makeReq({
        ...VALID_BODY,
        entry_context: "contribution",
        capital_ownership: "own_capital",
      }),
    );
    expect(res.status).toBe(200);
    expect(
      errSpy.mock.calls.some(
        (c) =>
          c.join(" ").includes("capital_ownership") &&
          c.join(" ").includes(STRATEGY_ID),
      ),
    ).toBe(true);
    // F-3 — the zero-row arm loses the mark just as completely as a transport
    // error, so it must carry the same user-facing signal.
    expect((await res.json()).capital_ownership_persisted).toBe(false);

    errSpy.mockRestore();
    fetchSpy.mockRestore();
  });

  // F-3 NON-VACUITY CONTROL. The sidecar is emitted ONLY on failure, so every
  // existing caller's response bytes are unchanged and "the flag is absent"
  // honestly means "nothing was lost". Without this control the two assertions
  // above would also pass against a field hardcoded to false.
  it("omits the capital_ownership_persisted sidecar entirely when the mark LANDS", async () => {
    const fetchSpy = mockProbeReadOnly();
    STATE.strategyRow = { api_key_id: API_KEY_ID };
    STATE.strategyKeysCount = 0;

    const POST = await importPost();
    const res = await POST(
      makeReq({
        ...VALID_BODY,
        entry_context: "contribution",
        capital_ownership: "own_capital",
      }),
    );
    expect(res.status).toBe(200);

    const body = await res.json();
    // Non-vacuity: the write really happened on this path.
    expect(markWrite()!.patch).toEqual({ capital_ownership: "own_capital" });
    expect("capital_ownership_persisted" in body).toBe(false);

    fetchSpy.mockRestore();
  });

  // ── 151 informational D7 — ONE RESPONSE CONTRACT, BOTH ARMS ──────────────
  //
  // The sidecar above is the LEGACY/contribution arm. The UNIFIED (manager) arm
  // has no mark write at all: a `capital_ownership` arriving there is dropped
  // unconditionally, and until this change it was dropped with only a
  // console.warn behind a byte-identical success body. A client that sent the
  // field and got routed to the unified arm therefore could not distinguish
  // "saved" from "discarded" — and SubmitStep's `=== false` reader (151 review
  // E8) showed plain success while the answer was gone. Same loss, same signal.
  it("D7 — the UNIFIED arm emits the same sidecar when a mark it cannot persist is sent", async () => {
    const fetchSpy = mockProbeReadOnly();
    // Single-key manager draft with no entry_context ⇒ the unified arm.
    STATE.strategyRow = { api_key_id: API_KEY_ID };
    STATE.strategyKeysCount = 0;
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const POST = await importPost();
    const res = await POST(
      makeReq({ ...VALID_BODY, capital_ownership: "own_capital" }),
    );
    expect(res.status).toBe(200);

    const body = await res.json();
    // Non-vacuity: this really is the unified arm, not the legacy one — the
    // legacy RPC never ran and no mark UPDATE was issued, which is precisely
    // why the mark is lost here.
    expect(
      STATE.rpcCalls.find((c) => c.name === "finalize_wizard_strategy"),
    ).toBeUndefined();
    expect(markWrite()).toBeUndefined();
    expect(body.queued).toBe(true);

    expect(
      body.capital_ownership_persisted,
      "The unified arm dropped the caller's mark and reported unqualified " +
        "success — the two arms no longer share one response contract.",
    ).toBe(false);

    warnSpy.mockRestore();
    fetchSpy.mockRestore();
  });

  it("D7 CONTROL — the unified arm's body is byte-unchanged when no mark was sent", async () => {
    // The sidecar must be emitted ONLY when the caller asked for a mark.
    // Without this control the assertion above would also pass against a field
    // hardcoded onto every unified response, which would make every existing
    // manager submission look like a data loss.
    const fetchSpy = mockProbeReadOnly();
    STATE.strategyRow = { api_key_id: API_KEY_ID };
    STATE.strategyKeysCount = 0;

    const POST = await importPost();
    const res = await POST(makeReq(VALID_BODY));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.queued).toBe(true);
    expect("capital_ownership_persisted" in body).toBe(false);

    fetchSpy.mockRestore();
  });

  it("D7 — the dedup-hit (queued=false) unified body carries the sidecar too", async () => {
    // The unified arm has TWO 200 shapes. The idempotent-resume envelope is the
    // one a duplicate submit lands on, and a duplicate submit is exactly when a
    // user re-sends the answer they thought was saved; leaving the sidecar off
    // this shape would make the flag depend on which 200 you happened to get.
    const fetchSpy = mockProbeReadOnly();
    STATE.strategyRow = { api_key_id: API_KEY_ID };
    STATE.strategyKeysCount = 0;
    STATE.processKeyResult = {
      ok: true,
      body: {
        queued: false,
        verification_id: "ver-dup",
        code: "WIZARD_DUPLICATE",
        idempotent: true,
      },
    };
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const POST = await importPost();
    const res = await POST(
      makeReq({ ...VALID_BODY, capital_ownership: "team_review" }),
    );
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.queued).toBe(false);
    expect(body.code).toBe("WIZARD_DUPLICATE");
    expect(body.capital_ownership_persisted).toBe(false);

    warnSpy.mockRestore();
    fetchSpy.mockRestore();
  });
});

/**
 * Phase 153.2-04 / WIZFORM-04 + MT5-14(a) — the submit path stops asking a venue
 * a question it has no answer to.
 *
 * ── WHAT WAS BROKEN ─────────────────────────────────────────────────────────
 *
 * `runScopeBroadeningProbe` demanded a ccxt per-key permissions probe on EVERY
 * submit. A venue that exposes no per-key scope endpoint cannot answer it, so
 * the seam returned a permanent failure and the route reported it as
 * `KEY_NETWORK_TIMEOUT` — "we could not reach the exchange", with a Retry. The
 * founder clicked that Retry five times against a condition that can never
 * change. The strategy was undeclarable and unsubmittable at once, which is why
 * MT5-14 and WIZFORM-04 had to ship together.
 *
 * ── WHY THESE ROWS ARE SHAPED THE WAY THEY ARE ──────────────────────────────
 *
 * ⚠️ THEY ASSERT ON THE SEAM, NOT ON THE RESPONSE. "Zero live calls on submit"
 * (D-06) is a claim about what crossed the network, and a 200 proves nothing
 * about it — a route that probed successfully and a route that never probed
 * both answer 200. `RF.lastCall` is set on EVERY `resilientFetch`, so `null` is
 * proof the chokepoint was never reached; the `globalThis.fetch` spy is asserted
 * alongside it so a future path that bypassed the core would still be seen.
 *
 * ⚠️ THE SWEEP IS DERIVED FROM THE CAPABILITY RECORD, NOT FROM A VENUE NAME. An
 * instance test over one venue is satisfied by an instance FIX (`venue === …`),
 * and an instance fix is the defect class this milestone exists to delete. The
 * sweep asks the same registry the route asks and holds every member to its
 * answer, so a second non-probing venue is covered the day its row lands and a
 * skip written as a name comparison reds here while every single-venue row
 * stays green. ⛔ The oracle is the PREDICATE over `SUPPORTED_EXCHANGES`, which
 * is a different derivation from the route's own branch — not the route's
 * behaviour compared against itself.
 */
/**
 * Proof the seam was never crossed, by both routes to it.
 *
 * 153.6-04 — hoisted out of the WIZFORM-04 `describe` so the PARITY-04 block
 * below asserts through the SAME two helpers. Two copies of "did the probe run?"
 * is how one copy quietly stops meaning it.
 */
function expectNoSeamCall(fetchSpy: ReturnType<typeof vi.spyOn>): void {
  expect(
    RF.lastCall,
    "The resilience core was entered, so a live permissions probe was issued " +
      "for a venue that has no per-key scope surface to report — the demand " +
      "WIZFORM-04 removes.",
  ).toBeNull();
  expect(fetchSpy).not.toHaveBeenCalled();
}

/** Proof the seam WAS crossed, on the keys-permissions budget. */
function expectSeamProbed(): void {
  expect(
    RF.lastCall,
    "The scope-broadening probe did NOT run. It is an ASVS V4 control: a key " +
      "broadened to trade/withdraw between Connect and Submit is caught here, " +
      "and skipping it for a venue that can answer is a real hole.",
  ).not.toBeNull();
  expect(RF.lastCall!.budgetKey).toBe("keys-permissions");
  expect(RF.lastCall!.path).toContain("/permissions?force_refresh=true");
}

describe("[153.2-04 / WIZFORM-04] the scope probe is gated on a CAPABILITY, and fails toward probing", () => {
  it("an MT5 single-key submit crosses the keys-permissions seam ZERO times (D-06)", async () => {
    STATE.adminApiKeysExchange = "mt5";
    // 153.6-04 / PARITY-04 — the key is ATTESTED as mt5, which is what a key
    // minted by the wizard RPC looks like. The capability record still governs
    // the skip; only the AUTHORITY for the venue moved from the client-writable
    // column to the server-attested one, so this row keeps its D-06 meaning and
    // gains a truthful fixture.
    STATE.adminApiKeysAttestedVenue = "mt5";
    // The read-only mock is installed DELIBERATELY: if the route still probed,
    // this row would pass on the response and fail only here. The spy is the
    // assertion, not the setup.
    const fetchSpy = mockProbeReadOnly();

    const POST = await importPost();
    await POST(makeReq(VALID_BODY));

    expectNoSeamCall(fetchSpy);
    fetchSpy.mockRestore();
  });

  it("a ccxt submit still probes, byte-identically — binance", async () => {
    STATE.adminApiKeysExchange = "binance";
    STATE.adminApiKeysAttestedVenue = "binance";
    const fetchSpy = mockProbeReadOnly();

    const POST = await importPost();
    await POST(makeReq(VALID_BODY));

    expectSeamProbed();
    fetchSpy.mockRestore();
  });

  it("[D-22] sFOX keeps the submit-time scope probe BYTE-UNCHANGED", async () => {
    // Asserted EXPLICITLY rather than left to the binance row. sFOX asserts
    // read_only structurally for a similar reason to MT5 and is the obvious
    // candidate for a careless second opt-out — but whether the ccxt probe
    // currently SUCCEEDS for it is unknown, so D-22 pins it unchanged and the
    // question is logged rather than answered.
    STATE.adminApiKeysExchange = "sfox";
    STATE.adminApiKeysAttestedVenue = "sfox";
    const fetchSpy = mockProbeReadOnly();

    const POST = await importPost();
    await POST(makeReq(VALID_BODY));

    expectSeamProbed();
    fetchSpy.mockRestore();
  });

  it("⭐ an UNRESOLVED venue is STILL probed — the control fails TOWARD probing", async () => {
    // The api_keys read faulted, so the route holds `null` for the attested
    // venue. Skipping on null would silently disable the scope-broadening
    // defence for every key whose venue read blipped — a control that fails open
    // on a transient DB error is not a control (RESEARCH Pitfall 4 / ASVS V4).
    //
    // ⛔ 153.6-04 — the failed read is ALSO why the probe gate must not inherit
    // the asset_class stamp's non-blocking leniency. That arm is allowed to shrug
    // and leave the draft's stamp alone; this one has to probe.
    STATE.adminApiKeysSelectError = { message: "transient read fault" };
    const fetchSpy = mockProbeReadOnly();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const POST = await importPost();
    await POST(makeReq(VALID_BODY));

    expectSeamProbed();
    warnSpy.mockRestore();
    fetchSpy.mockRestore();
  });

  it("an UNKNOWN venue string is STILL probed — same direction, different cause", async () => {
    // A venue the capability registry has never heard of (a code added to the
    // DB ahead of the registry). The registry's answer for "I do not know this
    // venue" must be "probe it".
    STATE.adminApiKeysExchange = "some-venue-we-have-never-heard-of";
    STATE.adminApiKeysAttestedVenue = "some-venue-we-have-never-heard-of";
    const fetchSpy = mockProbeReadOnly();

    const POST = await importPost();
    await POST(makeReq(VALID_BODY));

    expectSeamProbed();
    fetchSpy.mockRestore();
  });

  it("⭐ CLASS SWEEP: every supported venue's probe behaviour matches its capability row", async () => {
    // The oracle is the capability predicate over SUPPORTED_EXCHANGES — a
    // derivation the route does not share. An instance skip (`venue === …`)
    // plus a second non-probing row in the registry reds HERE and nowhere else.
    const { SUPPORTED_EXCHANGES, venueSupportsScopeProbe } = await import(
      "@/lib/closed-sets"
    );
    const nonProbing = SUPPORTED_EXCHANGES.filter(
      (v) => !venueSupportsScopeProbe(v),
    );
    // Anti-vacuity: a sweep over an empty opt-out set is green forever.
    expect(
      nonProbing.length,
      "No venue opts out of the probe, so this sweep proves nothing. If the " +
        "capability was removed, WIZFORM-04 was reverted.",
    ).toBeGreaterThan(0);
    expect(nonProbing.length).toBeLessThan(SUPPORTED_EXCHANGES.length);

    // ⭐ 153.6-04 / PARITY-04 — THE SWEEP DRIVES THE ATTESTATION, AND PINS THE
    // CLIENT-WRITABLE COLUMN TO A LABEL THAT CLAIMS EXEMPTION ON EVERY ITERATION.
    // `exchange` is writable by the client at INSERT (the 20260810120000 lock
    // revoked UPDATE only), so a gate that reads it can be told to skip. Holding
    // it at a non-probing label for the whole sweep means a gate reading the
    // WRONG column skips every venue — and every probing venue reds here.
    //
    // ⛔ The label is TAKEN FROM the opt-out set, never hand-named: naming a venue
    // is the instance-fix habit this sweep exists to catch, and `nonProbing` is
    // already fenced non-empty above.
    const forgedLabel = nonProbing[0];

    const POST = await importPost();
    for (const venue of SUPPORTED_EXCHANGES) {
      RF.lastCall = null;
      STATE.adminApiKeysExchange = forgedLabel;
      STATE.adminApiKeysAttestedVenue = venue;
      const fetchSpy = mockProbeReadOnly();
      await POST(makeReq(VALID_BODY));
      const shouldProbe = venueSupportsScopeProbe(venue);
      expect(
        RF.lastCall !== null,
        `attested venue "${venue}" (client label "${forgedLabel}"): the route ` +
          `${RF.lastCall ? "probed" : "skipped"} but its capability row says it ` +
          `should ${shouldProbe ? "probe" : "skip"}. The gate must read the ` +
          `CAPABILITY of the ATTESTED venue — never a venue name, and never the ` +
          `client-writable label.`,
      ).toBe(shouldProbe);
      fetchSpy.mockRestore();
    }
  });

  it("⭐ CLASS SWEEP, composite arm: the SAME gate applies per member", async () => {
    // Gating only the single-key arm would be the instance fix wearing a
    // different hat — correct for the path someone happened to test, and a live
    // per-member probe demand on the other. The member's venue arrives on the
    // widened embed; `.limit(cap + 1)` is untouched.
    const { SUPPORTED_EXCHANGES, venueSupportsScopeProbe } = await import(
      "@/lib/closed-sets"
    );
    const nonProbing = SUPPORTED_EXCHANGES.filter(
      (v) => !venueSupportsScopeProbe(v),
    );
    // Anti-vacuity, restated for THIS sweep rather than borrowed from the one
    // above: this loop now needs a non-probing label of its own, and a floor that
    // lives in the other `it` cannot fence a derivation that happens here.
    expect(
      nonProbing.length,
      "No venue opts out of the probe, so this sweep proves nothing. If the " +
        "capability was removed, WIZFORM-04 was reverted.",
    ).toBeGreaterThan(0);
    expect(nonProbing.length).toBeLessThan(SUPPORTED_EXCHANGES.length);
    // 153.6-04 — same forged-label discipline as the single-key sweep: the
    // member's client-writable `exchange` claims exemption on every iteration, so
    // a per-member gate reading it skips the whole set.
    const forgedLabel = nonProbing[0];

    const POST = await importPost();
    for (const venue of SUPPORTED_EXCHANGES) {
      RF.lastCall = null;
      STATE.strategyRow = { api_key_id: null };
      STATE.strategyKeysCount = 1;
      STATE.strategyKeysList = [
        {
          api_key_id: MEMBER_KEY_1,
          api_keys: { exchange: forgedLabel, attested_venue: venue },
        },
      ];
      const fetchSpy = mockProbeReadOnly();
      await POST(makeReq(VALID_BODY));
      expect(
        RF.lastCall !== null,
        `composite member attested "${venue}" (client label "${forgedLabel}") ` +
          `did not match its capability row.`,
      ).toBe(venueSupportsScopeProbe(venue));
      fetchSpy.mockRestore();
    }
  });

  it("a composite member whose venue could not be read is STILL probed", async () => {
    // The embed resolves null when the join comes back empty. Same fail-toward
    // rule as the single-key arm, asserted separately because it reaches the
    // gate down a different path.
    STATE.strategyRow = { api_key_id: null };
    STATE.strategyKeysCount = 1;
    STATE.strategyKeysList = [{ api_key_id: MEMBER_KEY_1, api_keys: null }];
    const fetchSpy = mockProbeReadOnly();

    const POST = await importPost();
    await POST(makeReq(VALID_BODY));

    expectSeamProbed();
    fetchSpy.mockRestore();
  });

  it("the composite member read still asks for the truncation-detector row", async () => {
    // The select was widened in this plan; the cap was NOT. `cap + 1` is a
    // truncation DETECTOR whose arrival IS the refusal, and it is pinned
    // cross-file against SEAM_ROUTE_BUDGETS. Asserted here because the two live
    // on the same query and an edit to one is an edit next to the other.
    STATE.strategyRow = { api_key_id: null };
    STATE.strategyKeysCount = 1;
    STATE.strategyKeysList = [
      { api_key_id: MEMBER_KEY_1, api_keys: { exchange: "binance" } },
    ];
    const fetchSpy = mockProbeReadOnly();

    const POST = await importPost();
    await POST(makeReq(VALID_BODY));

    expect(STATE.strategyKeysListLimit).toBe(11);
    fetchSpy.mockRestore();
  });

  it("⛔ no retry is issued on the probe path (D-07)", async () => {
    // The requirement is explicit that a naive retry multiplies the budget this
    // route is capped on and feeds breaker:railway. This fix REMOVES calls; it
    // must never multiply them. One submit, one crossing.
    STATE.adminApiKeysExchange = "binance";
    STATE.adminApiKeysAttestedVenue = "binance";
    const fetchSpy = mockProbeReadOnly();

    const POST = await importPost();
    await POST(makeReq(VALID_BODY));

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(RF.lastCall!.init.retriesOverride).toBe(0);
    fetchSpy.mockRestore();
  });
});

/**
 * Phase 153.6-04 / PARITY-04 — the probe gate stops believing the client.
 *
 * ── WHAT WAS BROKEN ─────────────────────────────────────────────────────────
 *
 * WIZFORM-04 gave the ASVS V4 scope-broadening probe a per-venue exemption and
 * read the venue off `api_keys.exchange`. Migration 20260810120000 revoked
 * client UPDATE on that column and backstopped it with a trigger — but INSERT
 * was deliberately left open (the wizard's own client-side INSERT path depends
 * on it). So the column is still client-writable at the one moment that matters:
 * a row can be created carrying a label that CLAIMS the exemption, and the gate
 * would honour it. The exemption was reachable by asking for it.
 *
 * ── THE DELIVERABLE, IN ONE SENTENCE ────────────────────────────────────────
 *
 * ⭐ The gate reads `attested_venue` — written only by the two SECURITY DEFINER
 * wizard RPCs and NULLed by a BEFORE INSERT trigger for every non-privileged
 * caller — and NOTHING else. The framing that binds is "the probe no longer
 * believes the client", not "the client can no longer lie": the write half is a
 * separate plan, and this half must hold even where that half has not reached.
 *
 * ⛔ NULL ⇒ PROBED, AND THERE IS NO FALLBACK TO `exchange`. A legacy row the
 * backfill has not reached, and a row whose client-supplied attestation the
 * trigger scrubbed, are the SAME state to this gate, and it is the state that
 * must fail TOWARD the control. Falling back to `exchange` when the attestation
 * is null would make the whole change a no-op for every row that has one — the
 * hole that never closes (RESEARCH Q4.4).
 *
 * ── WHY THESE ROWS ARE SHAPED THE WAY THEY ARE ──────────────────────────────
 *
 * ⚠️ EVERY ROW SETS THE TWO COLUMNS TO DIFFERENT VALUES. A fixture where they
 * agree cannot tell the two gates apart, and the WIZFORM-04 block above is full
 * of such fixtures by construction (they predate the distinction). Disagreement
 * is the entire experiment.
 *
 * ⚠️ ASSERTED ON THE SEAM, NOT THE RESPONSE, for the reason the WIZFORM-04
 * docblock gives: a route that probed and a route that never probed both answer
 * 200, so a status assertion would be green under the defect.
 */
describe("[153.6-04 / PARITY-04] the probe gate reads the SERVER-attested venue, never the client label", () => {
  it("⭐ a forged client label cannot buy a skip — an attested ccxt venue is PROBED", async () => {
    // THE HEADLINE ORACLE. The row claims the exempt venue in the column a
    // client can write at INSERT, and the server attested a venue that answers
    // permissions probes. The attestation wins, so the probe runs.
    STATE.adminApiKeysExchange = "mt5";
    STATE.adminApiKeysAttestedVenue = "binance";
    const fetchSpy = mockProbeReadOnly();

    const POST = await importPost();
    await POST(makeReq(VALID_BODY));

    expectSeamProbed();
    fetchSpy.mockRestore();
  });

  it("⭐ a NULL attestation is PROBED even when the client label claims the exemption", async () => {
    // The legacy-unbackfilled row and the trigger-scrubbed row look identical
    // from here, and both must be probed. ⛔ THIS ROW IS WHAT FORBIDS THE
    // FALLBACK: a gate that read `attested_venue ?? exchange` would answer "mt5"
    // here, skip, and be green on every other row in this block.
    STATE.adminApiKeysExchange = "mt5";
    STATE.adminApiKeysAttestedVenue = null;
    const fetchSpy = mockProbeReadOnly();

    const POST = await importPost();
    await POST(makeReq(VALID_BODY));

    expectSeamProbed();
    fetchSpy.mockRestore();
  });

  it("an attested non-probing venue still SKIPS — only the authority moved, not the capability", async () => {
    // ⛔ THE COUNTERWEIGHT, and it is not optional. Without it, "reads the
    // attestation" is indistinguishable from "probes unconditionally" — which
    // would pass both rows above while re-breaking every MT5 submit WIZFORM-04
    // unblocked. The capability record still governs; the client label is the
    // one that stopped mattering.
    STATE.adminApiKeysExchange = "binance";
    STATE.adminApiKeysAttestedVenue = "mt5";
    const fetchSpy = mockProbeReadOnly();

    const POST = await importPost();
    await POST(makeReq(VALID_BODY));

    expectNoSeamCall(fetchSpy);
    fetchSpy.mockRestore();
  });

  it("⭐ composite: a member's forged label cannot buy a skip either — the attestation governs", async () => {
    // The same three properties down the OTHER arm. Gating one arm is the
    // instance fix wearing a different hat, and this route has shipped exactly
    // that mistake before (WIZFORM-04's own composite gap).
    STATE.strategyRow = { api_key_id: null };
    STATE.strategyKeysCount = 1;
    STATE.strategyKeysList = [
      {
        api_key_id: MEMBER_KEY_1,
        api_keys: { exchange: "mt5", attested_venue: "binance" },
      },
    ];
    const fetchSpy = mockProbeReadOnly();

    const POST = await importPost();
    await POST(makeReq(VALID_BODY));

    expectSeamProbed();
    fetchSpy.mockRestore();
  });

  it("composite: a member with a NULL attestation is PROBED, whatever its label claims", async () => {
    STATE.strategyRow = { api_key_id: null };
    STATE.strategyKeysCount = 1;
    STATE.strategyKeysList = [
      {
        api_key_id: MEMBER_KEY_1,
        api_keys: { exchange: "mt5", attested_venue: null },
      },
    ];
    const fetchSpy = mockProbeReadOnly();

    const POST = await importPost();
    await POST(makeReq(VALID_BODY));

    expectSeamProbed();
    fetchSpy.mockRestore();
  });

  it("composite: a member with NO attestation field at all still PARSES and is PROBED", async () => {
    // The embed shape a pre-migration schema cache returns, and the shape every
    // pre-existing fixture in this file carries. It must PARSE — refusing it
    // would turn a column rollout into a composite-finalize outage — and by the
    // fail-toward rule it is probed.
    STATE.strategyRow = { api_key_id: null };
    STATE.strategyKeysCount = 1;
    STATE.strategyKeysList = [
      { api_key_id: MEMBER_KEY_1, api_keys: { exchange: "mt5" } },
    ];
    const fetchSpy = mockProbeReadOnly();

    const POST = await importPost();
    const res = await POST(makeReq(VALID_BODY));

    expect(
      res.status,
      "A member row without the attestation column was refused as a shape drift.",
    ).toBe(200);
    expectSeamProbed();
    fetchSpy.mockRestore();
  });

  it("composite: an attested non-probing member still SKIPS — the counterweight, per member", async () => {
    STATE.strategyRow = { api_key_id: null };
    STATE.strategyKeysCount = 1;
    STATE.strategyKeysList = [
      {
        api_key_id: MEMBER_KEY_1,
        api_keys: { exchange: "binance", attested_venue: "mt5" },
      },
    ];
    const fetchSpy = mockProbeReadOnly();

    const POST = await importPost();
    await POST(makeReq(VALID_BODY));

    expectNoSeamCall(fetchSpy);
    fetchSpy.mockRestore();
  });
});

/**
 * Phase 153.2-04 / WIZFORM-04 / D-14b — a permanent condition is never reported
 * as a temporary blip.
 *
 * `KEY_NETWORK_TIMEOUT`'s copy says we could not reach the exchange and its
 * envelope carries a recoverable action, so a Retry control renders. Two arms
 * that are PERMANENT used to land on it, and the Retry they offered could only
 * ever produce the same message again — the five-clicks behaviour. The parse
 * miss is covered by the SEAMUX-07 block above (re-cut there, beside the arm it
 * was split off). This block covers the configuration fault.
 */
describe("[153.2-04 / D-14b] our own configuration fault is not a network blip", () => {
  it("a missing INTERNAL_API_TOKEN answers SEAM_MISCONFIGURED (500), not KEY_NETWORK_TIMEOUT", async () => {
    delete process.env.INTERNAL_API_TOKEN;
    const fetchSpy = mockProbeReadOnly();
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const POST = await importPost();
    const res = await POST(makeReq(VALID_BODY));

    expect(
      res.status,
      "The fault is OURS, not the venue's — 500, matching how process-key-client " +
        "already answers this class. 502 would blame the upstream for our own " +
        "unset setting.",
    ).toBe(500);
    const body = await res.json();
    expect(body.code).toBe("SEAM_MISCONFIGURED");
    expect(
      body.code,
      "A setting stays wrong until a human fixes it and redeploys. Reported as " +
        "a timeout it renders a Retry whose only possible outcome is the same " +
        "message again.",
    ).not.toBe("KEY_NETWORK_TIMEOUT");

    // Nothing was attempted, so nothing could have been unreachable.
    expect(fetchSpy).not.toHaveBeenCalled();
    // And it still FAILS CLOSED: no key is promoted on a probe that did not run.
    expect(
      STATE.rpcCalls.find((c) => c.name === "finalize_wizard_strategy"),
    ).toBeUndefined();

    errSpy.mockRestore();
    fetchSpy.mockRestore();
  });

  it("the misconfiguration log carries the SETTING NAME and no secret", async () => {
    // Shared Pattern E — every error path scrubs through the one leaf. The
    // operator needs to know WHICH setting; there is no value to leak, because
    // the whole condition is that it is absent.
    delete process.env.INTERNAL_API_TOKEN;
    const fetchSpy = mockProbeReadOnly();
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const POST = await importPost();
    await POST(makeReq(VALID_BODY));

    const logged = errSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(logged).toMatch(/probe misconfigured/i);
    expect(logged).toContain("INTERNAL_API_TOKEN");

    errSpy.mockRestore();
    fetchSpy.mockRestore();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 153.2-05 / WIZFORM-02 — the limiter's two deny arms stop answering code-less.
//
// Both were on the KNOWN_CODELESS_FINALIZE_REJECTIONS ledger. A code-less
// rejection renders the UNKNOWN card — "We could not classify this failure" —
// for a failure the route classified well enough to pick a status and write a
// sentence about, AND that card's copy is recoverable, so both arms handed the
// user a Retry button: correct for a throttle, and a control that cannot work
// for a misconfiguration.
//
// ⚠️ The status and header assertions are here because the fix must be a CODE
// and nothing else — a change that also moved the status would be a wire
// change wearing a classification change's clothes.
// ═══════════════════════════════════════════════════════════════════════════
describe("[153.2-05] the rate-limit deny arms carry codes", () => {
  // ⛔ TYPED AS THE PRODUCTION RESULT (153.2 review WR-03), not
  // `Record<string, unknown>`. The predicate under test is now the real one, so
  // a fixture the production type cannot express is a compile error here rather
  // than a green row demonstrating a discrimination nobody ships.
  async function denyWith(
    rl: import("@/lib/ratelimit").CheckLimitResult,
  ) {
    const { checkLimit } = await import("@/lib/ratelimit");
    (checkLimit as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      rl,
    );
    const POST = await importPost();
    const res = await POST(makeReq(VALID_BODY));
    return { res, body: (await res.json()) as { code?: string; error?: string } };
  }

  it("a genuine throttle answers 429 RATE_LIMITED — OUR cap, not the exchange's", async () => {
    // ⛔ NOT `KEY_RATE_LIMIT`, whose copy opens "The exchange rate-limited this
    // request". This is `userActionLimiter` on our own per-user key and the
    // exchange is never contacted on this path, so that sentence would be a
    // specific lie in place of a vague one. `RATE_LIMITED` says "the cap is
    // ours, not your exchange's".
    const { res, body } = await denyWith({ success: false, retryAfter: 42 });

    expect(res.status).toBe(429);
    expect(body.code).toBe("RATE_LIMITED");
    expect(body.code).not.toBe("KEY_RATE_LIMIT");
    expect(body.error).toBe("Too many requests");
    expect(res.headers.get("Retry-After")).toBe("42");
  });

  it("a limiter MISCONFIGURATION answers 503 SEAM_MISCONFIGURED — the fault is ours", async () => {
    // The discrimination that matters: a throttle is the user hitting a cap and
    // a misconfiguration is our own setting being wrong. They already answered
    // different statuses; now they answer different classifications too, and
    // SEAM_MISCONFIGURED carries no recoverable action, so no Retry control
    // renders for a condition retrying cannot clear.
    //
    // ⭐ DRIVEN BY THE REAL DISCRIMINATOR (153.2 review WR-03): `reason:
    // "ratelimit_misconfigured"` is the field the shipped predicate reads and
    // the only one `CheckLimitResult` declares. The previous fixture said
    // `misconfigured: true` — a key production never emits — and was told apart
    // by a predicate this file had written for itself.
    const { res, body } = await denyWith({
      success: false,
      retryAfter: 60,
      reason: "ratelimit_misconfigured",
    });

    expect(res.status).toBe(503);
    expect(body.code).toBe("SEAM_MISCONFIGURED");
    expect(body.code).not.toBe("RATE_LIMITED");
    expect(body.error).toBe("Rate limiter unavailable");
    expect(res.headers.get("Retry-After")).toBe("60");
  });

  it("CONTROL — a successful limiter check reaches neither arm", async () => {
    // The positive control. Both rows above would also pass on a route that
    // denied every request, which is a far worse defect than the one being fixed.
    const fetchSpy = mockProbeReadOnly();
    const POST = await importPost();
    const res = await POST(makeReq(VALID_BODY));

    expect(res.status).not.toBe(429);
    expect(res.status).not.toBe(503);
    fetchSpy.mockRestore();
  });
});

/**
 * 153 review — THE COMPOSITE MEMBER EMBED IS VALIDATED, NOT CAST.
 *
 * The O-1 per-member scope-broadening loop used to bind its rows through
 * `(members ?? []) as unknown as Array<…>`. A double cast asserts a shape the
 * compiler has no evidence for and checks NOTHING at runtime, so a PostgREST
 * shape change degraded in SILENCE rather than failing loud.
 *
 * ⭐ THE NAMED HAZARD IS AN ARRAY-VALUED EMBED. PostgREST returns a to-one
 * embed as an object, but the same `select()` returns an ARRAY the moment the
 * relationship is read as to-many (a duplicated FK, a view swapped under the
 * table, a schema-cache reload resolving the join differently). Under the cast
 * that array satisfied the compiler, `member.api_keys?.exchange` read
 * `undefined`, EVERY member resolved to a `null` venue, and the finalize path
 * proceeded on member data it never actually had — a silent downgrade of an
 * ASVS V4 control, wearing a 200.
 *
 * ⚠️ WHY THE REFUSAL SHARES `COMPOSITE_MEMBERSHIP_UNKNOWN`. Membership we
 * cannot read is membership we cannot re-probe, which is exactly what that code
 * says. A new code would need a new rejection site, and
 * `wizardErrors.invariant.test.ts` counts those EXACTLY
 * (`EXPECTED_FINALIZE_REJECTION_SITES`). The user-facing envelope is therefore
 * shared and only the OPERATOR artefacts fork — which is the half that has to
 * discriminate, because the two incidents have different remedies.
 */
describe("[153 review] a composite member embed of an unexpected shape fails LOUD", () => {
  /**
   * The drifted read. Cast at the injection site on purpose: `STATE`'s type
   * says this cannot happen, and the whole point of the defect is that the
   * types lied about a runtime shape. A fixture the type could express would
   * not be the fixture that reproduces it.
   *
   * ⚠️ EXACTLY ONE MEMBER, and that is a measurement, not a preference. With
   * the double cast restored, a ONE-member drift answers **200** — the
   * composite finalises on member data the route never had, which is the defect
   * in its pure form. A TWO-member fixture answered 502 instead, because the
   * second member's key is not wired into the probe mock and its probe failed
   * for a reason unrelated to the drift. That 502 is a green-looking red: it
   * would have let this row pass on a route that never validated anything, just
   * by landing on a different status. One member isolates the property.
   */
  function embedAsArray(): typeof STATE.strategyKeysList {
    return [
      { api_key_id: MEMBER_KEY_1, api_keys: [{ exchange: "binance" }] },
    ] as unknown as typeof STATE.strategyKeysList;
  }

  it("⭐ refuses the finalize instead of probing members it could not read", async () => {
    const consoleErr = vi.spyOn(console, "error").mockImplementation(() => {});
    const fetchSpy = mockProbeReadOnly();
    STATE.strategyRow = { api_key_id: null }; // composite
    STATE.strategyKeysCount = 1;
    STATE.strategyKeysList = embedAsArray();

    const POST = await importPost();
    const res = await POST(makeReq(VALID_BODY));

    expect(res.status).toBe(503);
    expect((await res.json()).code).toBe("COMPOSITE_MEMBERSHIP_UNKNOWN");

    // ⛔ THE LOAD-BEARING HALF. A 503 that still probed, or still finalized,
    // would be the silent degradation with a different status code on it. Under
    // the double cast this route answered 200 and crossed the seam twice.
    expect(
      fetchSpy,
      "The route probed a member whose venue it could not actually read.",
    ).not.toHaveBeenCalled();
    expect(RF.lastCall).toBeNull();
    expect(
      STATE.rpcCalls.find((c) => c.name === "finalize_wizard_strategy"),
      "The composite was FINALIZED on member data the route never had.",
    ).toBeUndefined();

    consoleErr.mockRestore();
    fetchSpy.mockRestore();
  });

  it("names the SHAPE drift to the operator — not the read-failure sentence", async () => {
    // The two failures share one envelope, so the log line and the Sentry step
    // are the ONLY artefacts that tell an operator which incident they have.
    // Reporting a schema drift as "read failed" sends them to the RLS policy
    // and the connection pool for a fault that is in the query.
    const consoleErr = vi.spyOn(console, "error").mockImplementation(() => {});
    const fetchSpy = mockProbeReadOnly();
    STATE.strategyRow = { api_key_id: null };
    STATE.strategyKeysCount = 1;
    STATE.strategyKeysList = embedAsArray();

    const POST = await importPost();
    await POST(makeReq(VALID_BODY));

    const lines = consoleErr.mock.calls.map((args) =>
      args.map((a) => String(a)).join(" "),
    );
    const drift = lines.find((l) => l.includes("SHAPE unrecognised"));
    expect(
      drift,
      "A composite that will not finalise produced no operator line naming the shape drift.",
    ).toBeDefined();
    expect(drift).not.toContain("[object Object]");
    // The CR-01 read-failure sentence must NOT be what fired — this read did
    // not fail, it returned rows nobody can use.
    expect(
      lines.some((l) => l.includes("composite member list read failed")),
      "A shape drift was reported as a member-list READ failure.",
    ).toBe(false);

    const steps = STATE.captureToSentryCalls.map((c) => c.options.tags.step);
    expect(steps).toContain("composite-member-shape");
    expect(steps).not.toContain("composite-member-list");

    consoleErr.mockRestore();
    fetchSpy.mockRestore();
  });

  it("CONTROL — every shape production actually returns still finalises", async () => {
    // ⛔ WITHOUT THIS ROW the two above would also pass on a guard that refused
    // EVERY composite, which is a worse defect than the one being fixed. All
    // three legitimate embeds are real runtime states: PostgREST omits the key
    // in the harness's pre-existing rows, returns `null` when the FK does not
    // resolve, and returns the object on the happy path. A member with a null
    // venue is STILL PROBED by the fail-toward rule — that is not drift.
    const legitimate: Array<[string, typeof STATE.strategyKeysList]> = [
      ["embed absent", [{ api_key_id: MEMBER_KEY_1 }]],
      ["embed null", [{ api_key_id: MEMBER_KEY_1, api_keys: null }]],
      [
        "embed object",
        [{ api_key_id: MEMBER_KEY_1, api_keys: { exchange: "binance" } }],
      ],
    ];

    const POST = await importPost();
    for (const [label, list] of legitimate) {
      RF.lastCall = null;
      STATE.rpcCalls = [];
      STATE.strategyRow = { api_key_id: null };
      STATE.strategyKeysCount = 1;
      STATE.strategyKeysList = list;
      const fetchSpy = mockProbeReadOnly();

      const res = await POST(makeReq(VALID_BODY));

      expect(res.status, `"${label}" was refused as a shape drift.`).toBe(200);
      expect(
        STATE.rpcCalls.find((c) => c.name === "finalize_wizard_strategy"),
        `"${label}" did not reach the finalize RPC.`,
      ).toBeDefined();
      fetchSpy.mockRestore();
    }
  });
});
