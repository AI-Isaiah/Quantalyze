import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * Phase 256 plan 08 (D-05, SC-3) - GET /api/strategies/[id]/returns on a strategy that moved from
 * USD into a coin. WHY: the composer and other clients read `returns_unit` to decide whether to
 * convert a leg by the daily coin close. A switched strategy's `daily_returns` are the headline USD
 * series (the coin part is already converted at the stored close), so `returns_unit` MUST stay null:
 * a unit here would make a client convert a USD series a second time. The switch itself rides in a
 * separate `unit_switch` field so a client can compose the sentence from the stored days.
 * The harness (supabase, rate limit, sentry, queries mocks) is copied from route.test.ts, which
 * keeps it file-local.
 */
// audit + supabase server modules import "server-only" which throws under vitest.
vi.mock("server-only", () => ({}));

const PUBLISHED_ID = "11111111-1111-4111-8111-111111111111";

const STATE = vi.hoisted(() => ({
  authUser: {
    id: "00000000-0000-0000-0000-000000000001",
    email: "alloc@test.sec",
  } as { id: string; email: string } | null,
  // withAllocatorAuth profile lookup: defaults to an allocator row so the
  // happy-path tests pass without rewiring. R2 flips this to 'manager' to
  // exercise the 403 gate.
  profileRole: "allocator" as "allocator" | "both" | "manager" | null,
  // Whether a strategies row with the requested id EXISTS at all. false models a
  // genuinely non-existent id → the probe resolves null → 404 regardless of the
  // visibility predicate.
  publishedExists: true,
  // CONTRIB-03 owner-inclusive probe modelling. The strategies row's own
  // `status` and `user_id`. The mock's maybeSingle evaluates this row against
  // the predicate the route ACTUALLY applied (`.eq("status","published")` for
  // published-only vs `.or("status.eq.published,user_id.eq.<caller>")` for
  // owner-inclusive), so a private row owned by the caller is visible ONLY under
  // the owner-inclusive predicate — a genuine RED proof for the widening. The
  // default is a published row owned by someone else, so every pre-existing
  // (published-row) test resolves visible under BOTH predicates, unchanged.
  strategyStatus: "published" as "published" | "private" | "pending_review",
  strategyOwnerId: "99999999-9999-4999-8999-999999999999",
  // #597 part 2 (BLEND-01) — the asset_class the widened probe row carries. The
  // route forwards it on the 200 body (null models a strategy with no class /
  // a stale build that predates the widened select).
  publishedAssetClass: "crypto" as string | null,
  // Phase 126-04 — the PUBLIC trust_tier the get_published_trust_signals
  // primitive resolves for this strategy (via readPublicVerificationSignals).
  // null models a strategy with no published verification signal → trust_tier
  // null on the body (never a throw). Replaces the old RLS-embed on the probe.
  publishedTrustTier: null as string | null,
  // The strategy_analytics row the series read resolves. `null` models an
  // absent analytics row → honest empty []. data_quality_flags is the source of
  // the server-coerced is_composite boolean (strict === true, T-111-04).
  // Phase 147 / SCEN-01: `returns_series` (the analytics-service cumprod equity
  // curve — the column 27/27 real strategies actually populate) and
  // `computation_status` (the series_state discriminator) join the row shape.
  analyticsRow: { daily_returns: [] as unknown } as
    | {
        daily_returns: unknown;
        returns_series?: unknown;
        computation_status?: unknown;
        data_quality_flags?: unknown;
        // Phase 162 / HONEST-05: the co-served headline scalars. Absent from a
        // fixture models a row whose columns are unset → null on the body.
        cagr?: unknown;
        sharpe?: unknown;
        // 194.1 plan 09 (B8): the four aliased record scalars. The mock projects an
        // `alias:expr` select entry onto the fixture key named by the alias.
        series_start?: unknown;
        series_end?: unknown;
        headline_since?: unknown;
        record_observations?: unknown;
        // 256 plan 08: the two columns a held re-run's stored-result evidence reads.
        cumulative_return?: unknown;
        computed_at?: unknown;
      }
    | null,
  // Phase 147 / P5 — the strategies.created_at the route's SEPARATE lazy age
  // read resolves. It fires ONLY on the empty-series + missing-analytics-row
  // branch (the probe select stays byte-pinned by phase-84). `undefined` models
  // a read that resolves no row; `strategyCreatedAtError` models a failed read
  // (both degrade to the honest 'empty', never a permanent spinner).
  strategyCreatedAt: undefined as string | null | undefined,
  strategyCreatedAtError: null as { code: string; message: string } | null,
  // When set, the strategy_analytics read resolves with this error so the
  // route's 500 branch + redaction can be pinned.
  analyticsQueryError: null as { code: string; message: string } | null,
  observedFilters: {
    // The (legacy) withPublishedOnly predicate appends .eq("status","published")
    // to the existence probe. After CONTRIB-03 the route uses withPublishedOrOwner
    // instead, so this stays null and `ownerOrFilter` below carries the predicate.
    status: null as string | null,
    // The withPublishedOrOwner predicate appends
    // .or("status.eq.published,user_id.eq.<sessionId>") to the existence probe;
    // observing it proves the owner-inclusive gate is real (and session-keyed).
    ownerOrFilter: null as string | null,
    // The id the existence probe filtered on.
    strategiesEqId: null as string | null,
    // The strategy_id the analytics read filtered on.
    analyticsEqStrategyId: null as string | null,
    // SELECT column lists, per table.
    strategiesSelect: null as string | null,
    analyticsSelect: null as string | null,
    // Phase 147 — the SEPARATE lazy `created_at` read's select, recorded apart
    // from `strategiesSelect` so the second `from("strategies")` call cannot
    // clobber the phase-84-pinned probe assertions.
    strategiesCreatedAtSelect: null as string | null,
  },
  // True whenever the mock observes a call against EITHER catalog table. R1
  // and R2 assert this stays FALSE — bad-uuid / non-allocator must
  // short-circuit before any catalog query fires (no enumeration, no token).
  strategiesQueried: false,
  checkLimitResult: { success: true, retryAfter: 0 } as {
    success: boolean;
    retryAfter: number;
  },
  rateLimitKey: null as string | null,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({
        data: { user: STATE.authUser },
        error: null,
      }),
    },
    from: (table: string) => {
      if (table === "profiles") {
        // withAllocatorAuth role lookup chain:
        //   supabase.from('profiles').select('role').eq('id', uid).maybeSingle()
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data:
                  STATE.profileRole === null
                    ? null
                    : { role: STATE.profileRole },
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === "strategies") {
        // The owner-inclusive existence probe (CONTRIB-03):
        //   withPublishedOrOwner(
        //     from('strategies').select('...').eq('id', id), user.id,
        //   ).maybeSingle()
        // withPublishedOrOwner appends .or('status.eq.published,user_id.eq.<uid>')
        // to the same builder, so the chain has .select, .eq('id'), .or, then
        // .maybeSingle. (Pre-CONTRIB-03 it was withPublishedOnly →
        // .eq('status','published'); the mock evaluates the row against WHICHEVER
        // predicate the route applied, so the widening is a genuine RED proof.)
        STATE.strategiesQueried = true;
        // Phase 147 — this table now serves TWO distinct reads: the pinned
        // visibility probe, and the lazy `created_at` age read on the
        // missing-analytics-row branch. Each builder remembers its OWN select,
        // so the age read routes to its own maybeSingle arm and never rewrites
        // the probe's observed filters.
        let selectedCols: string | null = null;
        const isAgeRead = () => selectedCols?.includes("created_at") === true;
        const builder = {
          select: (cols: string) => {
            selectedCols = cols;
            if (cols.includes("created_at")) {
              STATE.observedFilters.strategiesCreatedAtSelect = cols;
            } else {
              STATE.observedFilters.strategiesSelect = cols;
            }
            return builder;
          },
          eq: (col: string, val: string) => {
            if (col === "status") STATE.observedFilters.status = val;
            if (col === "id" && !isAgeRead()) {
              STATE.observedFilters.strategiesEqId = val;
            }
            return builder;
          },
          or: (filter: string) => {
            STATE.observedFilters.ownerOrFilter = filter;
            return builder;
          },
          maybeSingle: async () => {
            if (isAgeRead()) {
              if (STATE.strategyCreatedAtError) {
                return { data: null, error: STATE.strategyCreatedAtError };
              }
              return {
                data:
                  STATE.strategyCreatedAt === undefined
                    ? null
                    : { created_at: STATE.strategyCreatedAt },
                error: null,
              };
            }
            // No row with this id exists at all → null (genuine 404, not a
            // visibility miss).
            if (!STATE.publishedExists) {
              return { data: null, error: null };
            }
            // Evaluate the row against the visibility predicate the route
            // ACTUALLY applied on the builder above:
            //   - owner-inclusive (.or observed): published OR caller owns it;
            //   - published-only  (.eq status observed): published ONLY.
            const callerId = STATE.authUser?.id ?? null;
            let visible = false;
            if (STATE.observedFilters.ownerOrFilter !== null) {
              visible =
                STATE.strategyStatus === "published" ||
                STATE.strategyOwnerId === callerId;
            } else if (STATE.observedFilters.status === "published") {
              visible = STATE.strategyStatus === "published";
            }
            return {
              data: visible
                ? {
                    id: PUBLISHED_ID,
                    asset_class: STATE.publishedAssetClass,
                  }
                : null,
              error: null,
            };
          },
        };
        return builder;
      }
      if (table === "strategy_analytics") {
        // The series read:
        //   from('strategy_analytics').select('daily_returns')
        //     .eq('strategy_id', id).maybeSingle()
        STATE.strategiesQueried = true;
        const builder = {
          select: (cols: string) => {
            STATE.observedFilters.analyticsSelect = cols;
            return builder;
          },
          eq: (col: string, val: string) => {
            if (col === "strategy_id") {
              STATE.observedFilters.analyticsEqStrategyId = val;
            }
            return builder;
          },
          maybeSingle: async () => {
            if (STATE.analyticsQueryError) {
              return { data: null, error: STATE.analyticsQueryError };
            }
            if (STATE.analyticsRow === null) return { data: null, error: null };
            // PROJECT to the selected columns, exactly as PostgREST does. Phase
            // 147: without this the fixture's `returns_series` would reach the
            // route even if the select never asked for it, making the SC-1
            // mutation (drop the column from the select) unfalsifiable — the
            // select-width assertion would go red but the BEHAVIOUR test would
            // stay green, which is the "tested the helper, not the wiring"
            // failure mode. A narrowed select must starve the series.
            const cols = (STATE.observedFilters.analyticsSelect ?? "")
              .split(",")
              .map((c) => c.trim())
              .filter(Boolean);
            const projected: Record<string, unknown> = {};
            for (const col of cols) {
              // PostgREST names an `alias:expr` column by its alias.
              const key = col.includes(":") ? col.slice(0, col.indexOf(":")) : col;
              if (key !== col) {
                if (key in STATE.analyticsRow) {
                  projected[key] = (STATE.analyticsRow as Record<string, unknown>)[key];
                }
                continue;
              }
              if (col in STATE.analyticsRow) {
                projected[col] = (
                  STATE.analyticsRow as Record<string, unknown>
                )[col];
              }
            }
            return { data: projected, error: null };
          },
        };
        return builder;
      }
      throw new Error(`unexpected from(${table}) on user-scoped client`);
    },
  }),
}));

vi.mock("@/lib/ratelimit", () => ({
  userActionLimiter: { __mock: "userActionLimiter" },
  checkLimit: async (_limiter: unknown, key: string) => {
    STATE.rateLimitKey = key;
    return STATE.checkLimitResult;
  },
  // The route may import isRateLimitMisconfigured (mirroring saved/[id]); a
  // success:true / plain success:false result is never misconfigured.
  isRateLimitMisconfigured: (r: { reason?: string }) =>
    r.reason === "ratelimit_misconfigured",
}));

// The route captures the redacted DB error to Sentry instead of forwarding
// error.message. Spy so the 500-path test can pin the channel.
const captureSpy = vi.hoisted(() => vi.fn());
vi.mock("@/lib/sentry-capture", () => ({
  captureToSentry: captureSpy,
}));

// Phase 126-04: the trust_tier signal now comes from the published-gated DB
// primitive via readPublicVerificationSignals (queries.ts), NOT an owner-only
// RLS strategy_verifications embed on the probe. Mock the helper so these tests
// feed the tier directly and pin that the route routes trust_tier through it.
// (Mocking the helper also avoids the returns route transitively importing the
// large queries.ts module graph under vitest.)
const readSignalsMock = vi.hoisted(() => vi.fn());
// 188 round 2 (SFH-2): the once-per-window throttle for a rejected tiny_base_days list.
const throttleMock = vi.hoisted(() => vi.fn((_id: string, _token: string) => true));
vi.mock("@/lib/queries", () => ({
  readPublicVerificationSignals: readSignalsMock,
  shouldCaptureDerivedRowRejection: throttleMock,
}));

// Phase 164.6.6.2 plan 09 (D-18, D-22, D-23): the BTC closes the route converts a
// native leg with, read through plan 08's DB-only `readBtcCloses`. Mocked so a
// test picks the price window (or a read failure) and counts the reads.
const btcClosesMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/factsheet/benchmark-source", async (importActual) => ({
  ...(await importActual<typeof import("@/lib/factsheet/benchmark-source")>()),
  readBtcCloses: btcClosesMock,
}));

function makeRequest(id: string): NextRequest {
  return new NextRequest(
    `http://localhost:3000/api/strategies/${id}/returns`,
    {
      method: "GET",
      headers: { origin: "http://localhost:3000" },
    },
  );
}

function ctx(id: string): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id }) };
}

beforeEach(() => {
  STATE.authUser = {
    id: "00000000-0000-0000-0000-000000000001",
    email: "alloc@test.sec",
  };
  STATE.profileRole = "allocator";
  STATE.publishedExists = true;
  STATE.strategyStatus = "published";
  STATE.strategyOwnerId = "99999999-9999-4999-8999-999999999999";
  STATE.publishedAssetClass = "crypto";
  STATE.publishedTrustTier = null;
  // The published-gated primitive resolves the tier keyed by strategy_id.
  readSignalsMock.mockReset();
  readSignalsMock.mockImplementation(async (ids: readonly string[]) => {
    const out = new Map<
      string,
      { trust_tier: string | null; status: string | null }
    >();
    if (STATE.publishedTrustTier !== null) {
      for (const id of ids) {
        out.set(id, { trust_tier: STATE.publishedTrustTier, status: "verified" });
      }
    }
    return out;
  });
  btcClosesMock.mockReset();
  btcClosesMock.mockResolvedValue(null);
  STATE.analyticsRow = { daily_returns: [] };
  STATE.analyticsQueryError = null;
  STATE.strategyCreatedAt = undefined;
  STATE.strategyCreatedAtError = null;
  STATE.observedFilters = {
    status: null,
    ownerOrFilter: null,
    strategiesEqId: null,
    analyticsEqStrategyId: null,
    strategiesSelect: null,
    analyticsSelect: null,
    strategiesCreatedAtSelect: null,
  };
  STATE.strategiesQueried = false;
  STATE.checkLimitResult = { success: true, retryAfter: 0 };
  STATE.rateLimitKey = null;
});

afterEach(() => {
  vi.clearAllMocks();
});


const SWITCH_FLAGS = {
  composite: false,
  unit_switch: { coin: "BTC", last_usd_day: "2026-11-14", first_coin_return_day: "2026-11-15" },
};
const USD_DAILY = [
  { date: "2026-11-13", value: 0.01 },
  { date: "2026-11-14", value: -0.02 },
  { date: "2026-11-15", value: 0.03 },
];

async function call() {
  const { GET } = await import("./route");
  const res = await GET(makeRequest(PUBLISHED_ID), ctx(PUBLISHED_ID));
  expect(res.status).toBe(200);
  return res.json();
}

describe("GET /api/strategies/[id]/returns - 256 unit switch (SC-3)", () => {
  it("a switched strategy keeps returns_unit null and returns the three switch fields", async () => {
    STATE.analyticsRow = {
      daily_returns: USD_DAILY,
      computation_status: "complete",
      data_quality_flags: SWITCH_FLAGS,
    };
    const body = await call();
    expect(body.unit_switch).toEqual({
      coin: "BTC",
      last_usd_day: "2026-11-14",
      first_coin_return_day: "2026-11-15",
    });
    expect(body.returns_unit).toBeNull();
    // The series is the headline USD series, served as stored: nothing to convert a second time.
    expect(body.daily_returns).toEqual(USD_DAILY);
    expect(body.daily_returns_usd).toBeNull();
    expect(body.native_unpriced).toBe(false);
    // No coin closes are read for a switched strategy (the conversion already happened in the derive).
    expect(btcClosesMock).not.toHaveBeenCalled();
  });

  it("an unswitched response has NO unit_switch key, so it is byte-identical to the one before", async () => {
    STATE.analyticsRow = {
      daily_returns: USD_DAILY,
      computation_status: "complete",
      data_quality_flags: { composite: false },
    };
    const body = await call();
    expect("unit_switch" in body).toBe(false);
  });

  it("a native BTC strategy is unaffected: returns_unit BTC and no unit_switch key", async () => {
    btcClosesMock.mockResolvedValue({
      prices: [
        { date: "2026-11-13", close: 60000 },
        { date: "2026-11-14", close: 61000 },
        { date: "2026-11-15", close: 62000 },
      ],
      dropped: [] as string[],
      through: "2026-11-15",
    });
    STATE.analyticsRow = {
      daily_returns: USD_DAILY,
      computation_status: "complete",
      data_quality_flags: { native_unit: "BTC" },
    };
    const body = await call();
    expect(body.returns_unit).toBe("BTC");
    expect("unit_switch" in body).toBe(false);
  });

  it.each([
    ["days two apart", { coin: "BTC", last_usd_day: "2026-11-14", first_coin_return_day: "2026-11-16" }],
    ["a lower-case coin", { coin: "btc", last_usd_day: "2026-11-14", first_coin_return_day: "2026-11-15" }],
    ["USD as the coin", { coin: "USD", last_usd_day: "2026-11-14", first_coin_return_day: "2026-11-15" }],
    ["a missing day", { coin: "BTC", last_usd_day: "2026-11-14" }],
    ["a string instead of an object", "BTC"],
  ])("%s: malformed reads as absent, never a partial switch", async (_label, bad) => {
    STATE.analyticsRow = {
      daily_returns: USD_DAILY,
      computation_status: "complete",
      data_quality_flags: { composite: false, unit_switch: bad },
    };
    const body = await call();
    expect("unit_switch" in body).toBe(false);
    expect(body.returns_unit).toBeNull();
  });

  it("the raw flags blob and every other key of the switch object never ship", async () => {
    STATE.analyticsRow = {
      daily_returns: USD_DAILY,
      computation_status: "complete",
      data_quality_flags: {
        composite: false,
        secret_internal: "x",
        unit_switch: { ...SWITCH_FLAGS.unit_switch, switch_day: "2026-11-14", debug: "y" },
      },
    };
    const body = await call();
    expect(Object.keys(body.unit_switch).sort()).toEqual(["coin", "first_coin_return_day", "last_usd_day"]);
    expect("data_quality_flags" in body).toBe(false);
    expect(JSON.stringify(body)).not.toContain("secret_internal");
  });

  it("a held re-run inside the derive prestamp window serves the LAST success's switch (effective flags, RESEARCH Pitfall 2)", async () => {
    // The prestamp replaced the live flags with no unit_switch; the snapshot bound to the row's
    // computed_at carries the success's. Read from the live flags the switch would vanish while the
    // stored (switched) numbers are served.
    const HELD_AT = "2026-11-20T10:00:00.000Z";
    STATE.analyticsRow = {
      daily_returns: USD_DAILY,
      cumulative_return: 0.0059,
      computed_at: HELD_AT,
      computation_status: "computing",
      cagr: 0.18,
      sharpe: 1.6,
      series_start: "2026-11-13",
      series_end: "2026-11-15",
      record_observations: 3,
      data_quality_flags: {
        last_success_snapshot: {
          computed_at: HELD_AT,
          flags: { cumulative_method: "geometric", unit_switch: SWITCH_FLAGS.unit_switch },
        },
      },
    };
    const body = await call();
    expect(body.analytics_updating).toBe(true);
    expect(body.unit_switch).toEqual({
      coin: "BTC",
      last_usd_day: "2026-11-14",
      first_coin_return_day: "2026-11-15",
    });
    expect(JSON.stringify(body)).not.toContain("last_success_snapshot");
  });
});
