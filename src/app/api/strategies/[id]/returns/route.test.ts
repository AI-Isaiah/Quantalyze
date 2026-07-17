import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * Phase 29 / Plan 29-01 — Tests for GET /api/strategies/[id]/returns
 *
 * The scoped lazy-returns route supplies ONE published strategy's
 * `daily_returns` series under the RLS-scoped server client. It is the
 * data-supply backbone for UNIFY-04 (a catalog-added strategy must move the
 * projection — RESEARCH reason #2: `payload.strategies` is book-only, so a
 * browse-added strategy currently contributes `[]` and is warm-up-gated out).
 *
 * Coverage matrix (RESEARCH Validation Architecture, UNIFY-04 server side):
 *   R1  — 400 on a malformed (non-uuid) id, BEFORE auth + rate-limit run
 *         (the strategies / analytics query NEVER fires — short-circuit proof)
 *   R2  — 403 when the caller role is not allocator/both (gate runs before
 *         any DB query)
 *   R3  — 404 when the published-existence probe finds no row (unpublished /
 *         non-existent / cross-tenant / not-readable-under-RLS) + NO_STORE
 *   R4  — 200 + { daily_returns: DailyPoint[] } on a published strategy whose
 *         strategy_analytics row carries a daily_returns array
 *   R4b — 200 + a flattened, date-sorted DailyPoint[] when daily_returns is the
 *         TYPED nested year-keyed record ({ "2022": { "01-10": r } }, types.ts:
 *         304). WR-05 silent-data-loss guard: a bare Array.isArray cast drops
 *         this real series to [] (the bug the book path already normalizes away)
 *   R5  — 200 + { daily_returns: [] } when the analytics row is absent
 *   R5b — 200 + { daily_returns: [] } when daily_returns is a non-array
 *         (honest empty, never fabricated)
 *   R6  — 500 static envelope on a DB error: body.error is a FIXED string
 *         (NOT the raw error.message); captureToSentry called with
 *         tags.route === "api/strategies/returns"; Cache-Control private,no-store
 *   R7  — 429 + Retry-After when checkLimit returns success:false, keyed per user
 *   R7b — 503 + Retry-After when the limiter is MISCONFIGURED (reason=
 *         'ratelimit_misconfigured') — a canary/health-check must see an outage,
 *         not a throttle (the 503 vs 429 distinction the route comment justifies)
 *   R8  — Non-vacuity: the route uses withPublishedOnly on the strategies probe
 *         (observe .eq("status","published")), and NO createAdminClient is
 *         imported/called (the mock exposes only the RLS createClient; an admin
 *         import would not resolve to anything wired here).
 *
 * The supabase mock drives `from('profiles')` (so withAllocatorAuth runs
 * end-to-end), `from('strategies')` (the published-existence probe), and
 * `from('strategy_analytics')` (the series read). Mirrors the browse/route.test
 * harness verbatim, extended with the two new table arms.
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
  // Phase 111 / CONSTIT-02 — the strategy_verifications rows the widened probe
  // embed carries. The route picks the most-recent by created_at and forwards
  // its trust_tier (null when no rows). Defaults to empty (→ trust_tier null).
  publishedVerifications: [] as Array<{
    trust_tier: string;
    status: string;
    created_at: string;
  }>,
  // The strategy_analytics row the series read resolves. `null` models an
  // absent analytics row → honest empty []. data_quality_flags is the source of
  // the server-coerced is_composite boolean (strict === true, T-111-04).
  analyticsRow: { daily_returns: [] as unknown } as
    | { daily_returns: unknown; data_quality_flags?: unknown }
    | null,
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
        const builder = {
          select: (cols: string) => {
            STATE.observedFilters.strategiesSelect = cols;
            return builder;
          },
          eq: (col: string, val: string) => {
            if (col === "status") STATE.observedFilters.status = val;
            if (col === "id") STATE.observedFilters.strategiesEqId = val;
            return builder;
          },
          or: (filter: string) => {
            STATE.observedFilters.ownerOrFilter = filter;
            return builder;
          },
          maybeSingle: async () => {
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
                    strategy_verifications: STATE.publishedVerifications,
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
            return { data: STATE.analyticsRow, error: null };
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
  STATE.publishedVerifications = [];
  STATE.analyticsRow = { daily_returns: [] };
  STATE.analyticsQueryError = null;
  STATE.observedFilters = {
    status: null,
    ownerOrFilter: null,
    strategiesEqId: null,
    analyticsEqStrategyId: null,
    strategiesSelect: null,
    analyticsSelect: null,
  };
  STATE.strategiesQueried = false;
  STATE.checkLimitResult = { success: true, retryAfter: 0 };
  STATE.rateLimitKey = null;
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/strategies/[id]/returns", () => {
  it("R1 — malformed (non-uuid) id → 400 BEFORE auth/rate-limit, no catalog query", async () => {
    const { GET } = await import("./route");
    const res = await GET(makeRequest("not-a-uuid"), ctx("not-a-uuid"));
    expect(res.status).toBe(400);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    const body = await res.json();
    expect(body.error).toMatch(/invalid/i);
    // The 400 short-circuits before auth, the limiter, and any DB query.
    expect(STATE.strategiesQueried).toBe(false);
    expect(STATE.rateLimitKey).toBe(null);
  });

  it("R2 — non-allocator caller (role='manager') → 403, no catalog query", async () => {
    STATE.profileRole = "manager";
    const { GET } = await import("./route");
    const res = await GET(makeRequest(PUBLISHED_ID), ctx(PUBLISHED_ID));
    expect(res.status).toBe(403);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    const body = await res.json();
    expect(body.error).toMatch(/allocator/i);
    // The allocator gate runs upstream of any catalog read — the series must
    // not leak by accident.
    expect(STATE.strategiesQueried).toBe(false);
  });

  it("R3 — published-existence probe finds no row → 404 (no existence leak) + NO_STORE", async () => {
    STATE.publishedExists = false;
    const { GET } = await import("./route");
    const res = await GET(makeRequest(PUBLISHED_ID), ctx(PUBLISHED_ID));
    expect(res.status).toBe(404);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    const body = await res.json();
    expect(body.error).toMatch(/not found/i);
    // The probe fired (and filtered on the requested id) but matched nothing.
    expect(STATE.observedFilters.strategiesEqId).toBe(PUBLISHED_ID);
    // No daily_returns leaks on the 404 path.
    expect(JSON.stringify(body)).not.toContain("daily_returns");
  });

  it("R4 — published strategy with a daily_returns array → 200 + { daily_returns }", async () => {
    const series = [
      { date: "2022-01-10", value: -0.007462 },
      { date: "2022-01-11", value: 0.0031 },
    ];
    STATE.analyticsRow = { daily_returns: series };
    const { GET } = await import("./route");
    const res = await GET(makeRequest(PUBLISHED_ID), ctx(PUBLISHED_ID));
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    const body = await res.json();
    expect(body.daily_returns).toEqual(series);
    // The series read filtered on the requested strategy_id.
    expect(STATE.observedFilters.analyticsEqStrategyId).toBe(PUBLISHED_ID);
  });

  it("R4b — TYPED nested year-keyed record → 200 + flattened, date-sorted series (WR-05 guard)", async () => {
    // The canonical stored shape (types.ts:304) is a year → MM-DD → return
    // nested record. The route reads strategy_analytics.daily_returns RAW from
    // the DB (no queries.ts flattening), so this shape reaches it directly. A
    // bare `Array.isArray(raw) ? raw : []` would drop this real series to [];
    // normalizeDailyReturns flattens + zero-pads + date-sorts it.
    STATE.analyticsRow = {
      daily_returns: {
        "2022": { "01-11": 0.0031, "01-10": -0.007462 },
      },
    };
    const { GET } = await import("./route");
    const res = await GET(makeRequest(PUBLISHED_ID), ctx(PUBLISHED_ID));
    expect(res.status).toBe(200);
    const body = await res.json();
    // Real returns are preserved (NOT dropped to []) and emerge date-sorted.
    expect(body.daily_returns).toEqual([
      { date: "2022-01-10", value: -0.007462 },
      { date: "2022-01-11", value: 0.0031 },
    ]);
  });

  it("R4c — #597 BLEND-01: the widened probe forwards asset_class on the 200 body (published rows only), null when unset", async () => {
    // The widened `.select("id, asset_class")` probe row carries the strategy's
    // public classification; the route forwards it so a drawer-added, NON-book
    // strategy can feed the composer's blend basis. This is the runtime pin for
    // "the response body carries asset_class" (the type is compile-pinned via
    // ReturnsResponse; this proves the VALUE flows from the probe row).
    STATE.publishedAssetClass = "crypto";
    const { GET } = await import("./route");
    const res = await GET(makeRequest(PUBLISHED_ID), ctx(PUBLISHED_ID));
    expect(res.status).toBe(200);
    let body = await res.json();
    expect(body.asset_class).toBe("crypto");
    // The probe select was widened to include asset_class (non-vacuous — the
    // route reads it from the SAME published-gated probe, not a second query).
    // Phase 111 / CONSTIT-02 also embeds strategy_verifications on the SAME probe.
    expect(STATE.observedFilters.strategiesSelect).toContain("asset_class");
    expect(STATE.observedFilters.strategiesSelect).toContain("strategy_verifications");

    // A strategy with no class (or a stale build) → null, never fabricated.
    STATE.publishedAssetClass = null;
    const res2 = await GET(makeRequest(PUBLISHED_ID), ctx(PUBLISHED_ID));
    body = await res2.json();
    expect(body.asset_class).toBeNull();
  });

  it("R9 — CONSTIT-02: forwards trust_tier (most-recent verification) + is_composite on the 200 body", async () => {
    STATE.publishedVerifications = [
      { trust_tier: "self_reported", status: "pending", created_at: "2026-01-01T00:00:00Z" },
      { trust_tier: "api_verified", status: "verified", created_at: "2026-06-01T00:00:00Z" },
    ];
    STATE.analyticsRow = { daily_returns: [], data_quality_flags: { composite: true } };
    const { GET } = await import("./route");
    const res = await GET(makeRequest(PUBLISHED_ID), ctx(PUBLISHED_ID));
    expect(res.status).toBe(200);
    const body = await res.json();
    // most-recent created_at wins (D-04 latest-verification pick)
    expect(body.trust_tier).toBe("api_verified");
    expect(body.is_composite).toBe(true);
    // The analytics read was widened to fetch data_quality_flags for the
    // is_composite derivation.
    expect(STATE.observedFilters.analyticsSelect).toContain("data_quality_flags");
  });

  it("R9b — CONSTIT-02: missing verification row → trust_tier null (never a 500)", async () => {
    STATE.publishedVerifications = [];
    STATE.analyticsRow = { daily_returns: [] };
    const { GET } = await import("./route");
    const res = await GET(makeRequest(PUBLISHED_ID), ctx(PUBLISHED_ID));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.trust_tier).toBeNull();
    expect(body.is_composite).toBe(false);
  });

  it("R9c — CONSTIT-02: is_composite is strict === true; malformed flags coerce to false + raw blob never ships (T-111-03/04)", async () => {
    for (const flags of [null, {}, { composite: "true" }, { composite: 1 }]) {
      STATE.analyticsRow = { daily_returns: [], data_quality_flags: flags };
      const { GET } = await import("./route");
      const res = await GET(makeRequest(PUBLISHED_ID), ctx(PUBLISHED_ID));
      const body = await res.json();
      expect(body.is_composite).toBe(false);
    }
    // Info-disclosure guard: the raw flags blob (venue detail) never reaches the
    // client — only the boolean projection.
    STATE.analyticsRow = {
      daily_returns: [],
      data_quality_flags: { composite: true, degraded_members: ["okx:BTC"] },
    };
    const { GET } = await import("./route");
    const res = await GET(makeRequest(PUBLISHED_ID), ctx(PUBLISHED_ID));
    const body = await res.json();
    expect(body.is_composite).toBe(true);
    expect(JSON.stringify(body)).not.toContain("data_quality_flags");
    expect(JSON.stringify(body)).not.toContain("degraded_members");
  });

  it("R5 — absent analytics row → 200 + { daily_returns: [] } (honest empty)", async () => {
    STATE.analyticsRow = null;
    const { GET } = await import("./route");
    const res = await GET(makeRequest(PUBLISHED_ID), ctx(PUBLISHED_ID));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.daily_returns).toEqual([]);
  });

  it("R5b — non-array daily_returns → 200 + { daily_returns: [] } (never fabricated)", async () => {
    STATE.analyticsRow = { daily_returns: null };
    const { GET } = await import("./route");
    const res = await GET(makeRequest(PUBLISHED_ID), ctx(PUBLISHED_ID));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.daily_returns).toEqual([]);
  });

  it("R6 — DB error → 500 static envelope (raw error.message NOT forwarded) + Sentry", async () => {
    STATE.analyticsQueryError = { code: "PGRST500", message: "boom-secret-detail" };
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { GET } = await import("./route");
    const res = await GET(makeRequest(PUBLISHED_ID), ctx(PUBLISHED_ID));
    expect(res.status).toBe(500);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    const body = await res.json();
    // The body is a fixed envelope; the raw Postgres detail never leaks.
    expect(body.error).toBe("Failed to load returns");
    expect(JSON.stringify(body)).not.toContain("boom-secret-detail");
    expect(captureSpy).toHaveBeenCalledWith(
      expect.objectContaining({ code: "PGRST500" }),
      expect.objectContaining({ tags: { route: "api/strategies/returns" } }),
    );
    consoleSpy.mockRestore();
  });

  it("R7 — rate-limited → 429 + Retry-After, keyed per user", async () => {
    STATE.checkLimitResult = { success: false, retryAfter: 30 };
    const { GET } = await import("./route");
    const res = await GET(makeRequest(PUBLISHED_ID), ctx(PUBLISHED_ID));
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("30");
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    const body = await res.json();
    expect(body.error).toBe("Too many requests");
    // Per-user key: the limiter is keyed on the authenticated user, not the id.
    expect(STATE.rateLimitKey).toBe(
      "returns:00000000-0000-0000-0000-000000000001",
    );
  });

  it("R7b — misconfigured limiter → 503 + Retry-After (canary sees an outage, not a throttle)", async () => {
    // A misconfigured/unreachable limiter must surface as a 503 (service
    // unavailable), NOT a 429 (throttle): a health/canary check distinguishes
    // "rate limiter is down" from "this caller is being throttled". A
    // regression that collapses this branch into the plain 429 would make an
    // outage look like normal throttling.
    STATE.checkLimitResult = {
      success: false,
      retryAfter: 5,
      reason: "ratelimit_misconfigured",
    } as typeof STATE.checkLimitResult & { reason: string };
    const { GET } = await import("./route");
    const res = await GET(makeRequest(PUBLISHED_ID), ctx(PUBLISHED_ID));
    expect(res.status).toBe(503);
    expect(res.headers.get("Retry-After")).toBe("5");
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    const body = await res.json();
    expect(body.error).toMatch(/unavailable/i);
  });

  it("R8 — non-vacuity: existence probe is owner-inclusive (withPublishedOrOwner, session-keyed) + no admin client", async () => {
    const { GET } = await import("./route");
    const res = await GET(makeRequest(PUBLISHED_ID), ctx(PUBLISHED_ID));
    expect(res.status).toBe(200);
    // CONTRIB-03: withPublishedOrOwner appended
    // .or("status.eq.published,user_id.eq.<sessionId>") to the probe — the
    // owner-inclusive gate is observably present and keyed on the AUTHENTICATED
    // session id (never a request param), NOT a vacuous "include more" filter.
    expect(STATE.observedFilters.ownerOrFilter).toBe(
      "status.eq.published,user_id.eq.00000000-0000-0000-0000-000000000001",
    );
    // The legacy published-only .eq("status","published") is gone.
    expect(STATE.observedFilters.status).toBeNull();
    // The probe selects only `id` (existence check, no over-fetch).
    expect(STATE.observedFilters.strategiesSelect).toContain("id");
    // The series read selects only daily_returns.
    expect(STATE.observedFilters.analyticsSelect).toContain("daily_returns");
    // The route reaches the catalog via the RLS createClient mock above. There
    // is NO createAdminClient mock — an admin import would resolve to nothing
    // wired and the happy path would not produce a 200. The 200 here proves
    // the RLS path is the one in use (T-29-04: admin client structurally absent).
  });

  // ── CONTRIB-03 contribute→compose loop closure ─────────────────────────────
  // Browse became owner-inclusive (withPublishedOrOwner) so an allocator's OWN
  // not-yet-published contribution appears in the composer Browse drawer and is
  // addable. The returns route MUST admit that same owner-own private row, or
  // adding it silently 404s and warm-up-gates the strategy out of the blend —
  // the exact contribute→compose case v1.11 is built for. R10/R11 join the two
  // sides the reviewer named ("nobody joined browse-owner-inclusive to
  // returns-published-only"): the join is asymmetric until the probe widens.
  it("R10 — allocator requesting THEIR OWN private strategy's returns → 200 + series (fails today: published-only 404s it)", async () => {
    // The strategy is the caller's own contribution: status='private', owned by
    // the authenticated allocator. Under the OLD published-only probe this row
    // is invisible → 404 → the composer permanently warm-up-gates it. Under the
    // owner-inclusive probe the owner sees their own row → 200 + the series.
    STATE.strategyStatus = "private";
    STATE.strategyOwnerId = STATE.authUser!.id;
    const series = [
      { date: "2026-07-10", value: 0.0012 },
      { date: "2026-07-11", value: -0.0004 },
    ];
    STATE.analyticsRow = { daily_returns: series };
    const { GET } = await import("./route");
    const res = await GET(makeRequest(PUBLISHED_ID), ctx(PUBLISHED_ID));
    expect(res.status).toBe(200);
    const body = await res.json();
    // The owner's own private analytics series flows through (analytics_read RLS
    // is ALSO owner-inclusive: published OR user_id=auth.uid()).
    expect(body.daily_returns).toEqual(series);
  });

  it("R11 — a DIFFERENT owner's private strategy still 404s (no cross-tenant existence leak)", async () => {
    // Same private status, but owned by SOMEONE ELSE. The owner-inclusive
    // predicate names ONLY the caller's id, so a non-owner unpublished row
    // matches neither leg → null → 404 (never a 403-with-info oracle).
    STATE.strategyStatus = "private";
    STATE.strategyOwnerId = "77777777-7777-4777-8777-777777777777";
    STATE.analyticsRow = { daily_returns: [{ date: "2026-07-10", value: 0.9 }] };
    const { GET } = await import("./route");
    const res = await GET(makeRequest(PUBLISHED_ID), ctx(PUBLISHED_ID));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toMatch(/not found/i);
    // No series (and no existence detail) leaks on the cross-tenant 404 path.
    expect(JSON.stringify(body)).not.toContain("daily_returns");
  });
});
