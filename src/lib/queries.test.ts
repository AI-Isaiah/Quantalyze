import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Tests for the manager-identity redaction in `getStrategyDetail()` and
 * `getPublicStrategyDetail()`. These functions implement T4.3a from the
 * disclosure-tier plan: a strategy with `disclosure_tier='exploratory'`
 * MUST NOT leak manager bio/years/aum/linkedin to the client.
 *
 * The redaction lives in queries.ts itself (not the React component) so the
 * fix is server-side and a curl can never bypass it.
 */

// Mock the Supabase server + admin clients BEFORE importing queries.
// `vi.hoisted` lets the mock factory reach the call recorders below.
//
// The redaction logic uses TWO clients:
//   - createClient (user-scoped) reads `strategies`
//   - createAdminClient (service_role) reads `profiles` for institutional
//     manager identity, BECAUSE migration 012 REVOKE'd column SELECT on
//     bio/years_trading/aum_range from anon + authenticated. The test
//     records BOTH client surfaces and asserts that profiles is read via
//     the admin path (and never read at all for exploratory).
const recorders = vi.hoisted(() => {
  return {
    fromCalls: [] as string[], // user-client calls
    adminFromCalls: [] as string[], // admin-client calls
    strategyData: null as unknown,
    // M-1159: error the strategies-table `.single()` resolves with. Default
    // null (every existing test sees a clean resolve); set to a PostgrestError
    // shape to drive getStrategyDetailV2's error-vs-missing branch.
    strategyError: null as unknown,
    managerRowData: null as unknown,
    // RPC recorder for fetchStrategyLazyMetrics tests (Plan 12-08 / METRICS-15).
    // Each call records (rpcName, args); each test seeds a single response.
    rpcCalls: [] as Array<{ name: string; args: Record<string, unknown> }>,
    rpcResponse: { data: null as unknown, error: null as unknown },
    // Phase 13 / Plan 13-01 / DISCO-01 — `getMyWatchlist` recorder.
    // The query is `from("user_favorites").select("strategy_id").eq("user_id", uid)`;
    // it `await`s the .eq() chain (no .single() / .maybeSingle()), so the chain
    // resolves at .eq() into { data, error }. Each test seeds favoritesResponse;
    // favoritesSelectCalls captures the select projection; favoritesEqCalls
    // captures the (col, val) tuple for each .eq() call.
    favoritesResponse: { data: null as unknown, error: null as unknown },
    favoritesSelectCalls: [] as string[],
    favoritesEqCalls: [] as Array<[string, unknown]>,
    // Records the `.select(cols)` argument used against the strategies
    // table so the path-extraction contract can assert no `select *` regressions.
    strategySelectCols: [] as string[],
    // NEW-C03-03 regression: records `.eq(col, val)` calls on the strategies
    // table so we can assert the `status=published` predicate is always sent.
    strategyEqCalls: [] as Array<[string, unknown]>,
    // Phase 159 (159-03 / RANK-02) — LIST-read recorder. `getStrategiesByCategory`
    // awaits the builder itself (no `.single()`), so the strategies chain only
    // becomes a thenable when a test seeds `listRows`. Leaving it null keeps
    // every pre-existing `.single()`/`.maybeSingle()` test byte-identical — a
    // permanently-thenable chain would change how those awaits resolve.
    listRows: null as unknown[] | null,
    listError: null as unknown,
    // Phase B pr-test-analyzer F1 — captureToSentry call recorder.
    // H-0488 / Phase B follow-up: a regression that drops Sentry capture
    // from the RPC-error or shape-mismatch paths would otherwise be invisible.
    sentryCalls: [] as Array<{ err: unknown; opts: unknown }>,
  };
});

vi.mock("@/lib/sentry-capture", () => ({
  captureToSentry: (err: unknown, opts: unknown) => {
    recorders.sentryCalls.push({ err, opts });
  },
}));

const buildChain = (data: unknown, recordStrategySelect = false) => {
  const chain: Record<string, unknown> = {};
  chain.select = (cols?: string) => {
    if (recordStrategySelect && typeof cols === "string") {
      recorders.strategySelectCols.push(cols);
    }
    return chain;
  };
  chain.eq = (col: string, val: unknown) => {
    if (recordStrategySelect) {
      recorders.strategyEqCalls.push([col, val]);
    }
    return chain;
  };
  // Phase 15 (WR-04 fix) added `.order()` + `.limit()` to bound the embedded
  // strategy_verifications join to the latest row only. Both must return the
  // chain so the existing `.single()` / `.maybeSingle()` resolution still works.
  chain.order = () => chain;
  chain.limit = () => chain;
  // M-1159: only the strategies-table chain (recordStrategySelect) surfaces
  // a seeded error, so manager/other chains keep their clean-resolve contract.
  chain.single = () =>
    Promise.resolve({ data, error: recordStrategySelect ? recorders.strategyError : null });
  // `loadManagerIdentity` (the shared helper in manager-identity.ts) uses
  // `.maybeSingle()` — less fragile than `.single()` because it returns
  // `null` instead of throwing on an empty row set. The mock chain must
  // implement both so pre-existing tests (which used `.single()`) and the
  // new shared helper (which uses `.maybeSingle()`) both work.
  chain.maybeSingle = () => Promise.resolve({ data, error: null });
  // Phase 159 (159-03 / RANK-02): the LIST reads (`getStrategiesByCategory`)
  // await the builder directly. Only become a thenable when the test seeded
  // rows for that shape — see the `listRows` recorder note above.
  if (recordStrategySelect && recorders.listRows !== null) {
    chain.then = <T1, T2>(
      onFulfilled: (val: { data: unknown; error: unknown }) => T1,
      onRejected?: (err: unknown) => T2,
    ) =>
      Promise.resolve({
        data: recorders.listRows,
        error: recorders.listError,
      }).then(onFulfilled, onRejected);
  }
  return chain;
};

/**
 * Phase 13 / Plan 13-01 / DISCO-01 — Specialised chain builder for the
 * `user_favorites` table. `getMyWatchlist` calls
 * `.from("user_favorites").select("strategy_id").eq("user_id", uid)` and
 * awaits the .eq() chain itself (no .single()). The chain therefore needs
 * to be a thenable: each .eq() returns the chain (so additional filters
 * can stack), AND the chain resolves to { data, error } when awaited.
 */
const buildFavoritesChain = () => {
  type FavChain = {
    select: (cols: string) => FavChain;
    eq: (col: string, val: unknown) => FavChain;
    then: <T1, T2>(
      onFulfilled: (val: { data: unknown; error: unknown }) => T1,
      onRejected?: (err: unknown) => T2,
    ) => Promise<T1 | T2>;
  };
  const chain: FavChain = {
    select(cols: string) {
      recorders.favoritesSelectCalls.push(cols);
      return chain;
    },
    eq(col: string, val: unknown) {
      recorders.favoritesEqCalls.push([col, val]);
      return chain;
    },
    then(onFulfilled, onRejected) {
      return Promise.resolve({
        data: recorders.favoritesResponse.data,
        error: recorders.favoritesResponse.error,
      }).then(onFulfilled, onRejected);
    },
  };
  return chain;
};

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: (table: string) => {
      recorders.fromCalls.push(table);
      // Phase 13 — Plan 13-01: `getMyWatchlist` reads from "user_favorites"
      // and awaits the .eq() chain. Use the thenable favorites chain there;
      // route disclosure-tier tests through the legacy single/maybeSingle
      // chain to preserve their existing assertions.
      if (table === "user_favorites") {
        return buildFavoritesChain();
      }
      return buildChain(
        table === "strategies" ? recorders.strategyData : recorders.managerRowData,
        table === "strategies",
      );
    },
    // .rpc() recorder for fetchStrategyLazyMetrics (Plan 12-08 / METRICS-15).
    // Existing disclosure-tier tests don't touch this path; they keep working.
    rpc: (name: string, args: Record<string, unknown>) => {
      recorders.rpcCalls.push({ name, args });
      return Promise.resolve(recorders.rpcResponse);
    },
  }),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      recorders.adminFromCalls.push(table);
      return buildChain(
        table === "strategies" ? recorders.strategyData : recorders.managerRowData,
        table === "strategies",
      );
    },
  }),
}));

import {
  getStrategiesByCategory,
  getStrategyDetail,
  getPublicStrategyDetail,
  fetchStrategyLazyMetrics,
  getMyWatchlist,
  getStrategyDetailV2,
  derivePhase07Fields,
  deriveStrategyLinkedKeyIds,
  deriveStrategylessKeys,
} from "./queries";
import { equitySnapshotsToDailyPoints } from "@/lib/allocation-helpers";
import type { SupportedExchange } from "./utils";

const baseStrategy = {
  id: "strat_123",
  user_id: "user_abc",
  status: "published",
  name: "Stellar L/S",
  codename: "Stellar",
  strategy_analytics: null,
};

const fullManagerRow = {
  display_name: "Jane Doe",
  company: "Acme Capital",
  bio: "20 years trading equities",
  years_trading: 20,
  aum_range: "$50M-$100M",
  linkedin: "https://linkedin.com/in/janedoe",
};

beforeEach(() => {
  recorders.fromCalls = [];
  recorders.adminFromCalls = [];
  recorders.strategyData = null;
  // M-1159: reset the seeded strategies-table error per-test, matching every
  // sibling recorder. Without this, a test that leaves a non-PGRST116 error set
  // would leak into later strategies-table tests (getStrategyDetailV2 would
  // throw the stale error), reporting red on correct code.
  recorders.strategyError = null;
  recorders.managerRowData = null;
  recorders.rpcCalls = [];
  recorders.rpcResponse = { data: null, error: null };
  recorders.favoritesResponse = { data: null, error: null };
  recorders.favoritesSelectCalls = [];
  recorders.favoritesEqCalls = [];
  recorders.strategySelectCols = [];
  recorders.strategyEqCalls = [];
  recorders.listRows = null;
  recorders.listError = null;
  recorders.sentryCalls = [];
});

describe("getStrategyDetail — disclosure tier redaction", () => {
  it("returns null manager + does NOT query profiles for exploratory strategies", async () => {
    recorders.strategyData = {
      ...baseStrategy,
      disclosure_tier: "exploratory",
    };
    recorders.managerRowData = fullManagerRow; // would leak if hit

    const result = await getStrategyDetail("strat_123");

    expect(result).not.toBeNull();
    expect(result!.disclosureTier).toBe("exploratory");
    expect(result!.manager).toBeNull();
    // The profiles table must NEVER be queried (on either client) for an
    // exploratory strategy — that is the whole security guarantee.
    expect(recorders.fromCalls).not.toContain("profiles");
    expect(recorders.adminFromCalls).not.toContain("profiles");
    expect(recorders.fromCalls).toContain("strategies");
  });

  it("populates manager fields for institutional strategies via admin client", async () => {
    recorders.strategyData = {
      ...baseStrategy,
      disclosure_tier: "institutional",
    };
    recorders.managerRowData = fullManagerRow;

    const result = await getStrategyDetail("strat_123");

    expect(result).not.toBeNull();
    expect(result!.disclosureTier).toBe("institutional");
    expect(result!.manager).toEqual({
      display_name: "Jane Doe",
      company: "Acme Capital",
      bio: "20 years trading equities",
      years_trading: 20,
      aum_range: "$50M-$100M",
      linkedin: "https://linkedin.com/in/janedoe",
    });
    // The manager identity fetch MUST go through the admin (service_role)
    // client because migration 012 REVOKE'd column SELECT on bio/years/aum
    // from anon + authenticated. The user-scoped client must NOT be used.
    expect(recorders.adminFromCalls).toContain("profiles");
    expect(recorders.fromCalls).not.toContain("profiles");
  });

  it("defaults missing disclosure_tier to exploratory (safest fallback)", async () => {
    // No disclosure_tier on the row at all → must NOT query profiles.
    recorders.strategyData = { ...baseStrategy };
    recorders.managerRowData = fullManagerRow;

    const result = await getStrategyDetail("strat_123");

    expect(result!.disclosureTier).toBe("exploratory");
    expect(result!.manager).toBeNull();
    expect(recorders.fromCalls).not.toContain("profiles");
    expect(recorders.adminFromCalls).not.toContain("profiles");
  });
});

/**
 * NEW-C03-03 regression: getStrategyDetail must always filter by
 * status='published'. Without it, RLS allows the strategy owner to see
 * their own draft/pending_review strategies on the discovery page while
 * /factsheet/[id] correctly 404s — the two surfaces disagree on "live."
 */
describe("getStrategyDetail — status=published predicate (NEW-C03-03)", () => {
  it("sends status=published eq predicate on the strategies query", async () => {
    recorders.strategyData = {
      ...baseStrategy,
      disclosure_tier: "exploratory",
    };
    await getStrategyDetail("strat_123");
    // eq calls are recorded when recordStrategySelect=true (strategies table)
    const statusCall = recorders.strategyEqCalls.find(
      ([col]) => col === "status",
    );
    expect(statusCall).toBeDefined();
    expect(statusCall![1]).toBe("published");
  });

  it("returns null when strategy data is null (non-published strategies return null from DB)", async () => {
    // Simulate the DB returning null (e.g. a pending_review strategy whose
    // owner requests /discovery/<slug>/<id>) — the query now always gates on
    // status='published' so non-published rows return null → notFound().
    recorders.strategyData = null;
    const result = await getStrategyDetail("strat_draft");
    expect(result).toBeNull();
  });
});

/**
 * Phase 159 (159-03, RANK-02 / decision D-02) — the browse + discovery LIST
 * read is the highest-traffic ANONYMOUS `strategy_analytics` surface
 * (`/browse/[slug]` has no auth gate). RLS is ROW-level: the `analytics_read`
 * policy has no `TO` clause and cannot hide a COLUMN, so an explicit
 * projection is the only lever that keeps `daily_returns`, the whole
 * `metrics_json` blob and `data_quality_flags` out of an anon response.
 *
 * These pins capture the `.select()` STRING the function issues. They are
 * neuterable in both directions: adding an excluded column to the projection
 * constant reds the negative arm, and dropping a must-stay column reds the
 * consumer arm (which is the user-visible failure — blank sparklines and a
 * permanently-"Syncing" chip).
 */
describe("getStrategiesByCategory — RANK-02 explicit anon projection", () => {
  /**
   * Seeds an empty LIST result (the select is recorded before the early
   * return) and hands back both the full select string and the
   * `strategy_analytics (...)` embed body.
   */
  const captureSelect = async () => {
    recorders.listRows = [];
    await getStrategiesByCategory("crypto-sma");
    const cols = recorders.strategySelectCols.at(-1) ?? "";
    const embed = /strategy_analytics \(([^)]*)\)/.exec(cols)?.[1] ?? "";
    return { cols, embed };
  };

  it("issues an explicit analytics column list, never the wildcard embed", async () => {
    const { cols, embed } = await captureSelect();
    expect(cols).not.toContain("strategy_analytics (*)");
    expect(embed).not.toBe("*");
    expect(embed.length).toBeGreaterThan(0);
  });

  it("keeps every analytics field the browse list actually renders", async () => {
    const { embed } = await captureSelect();
    // Enumerated from StrategyTable at HEAD: sparklines (:1111/:1118), the
    // chip status (:899), the SyncBadge + `computed_at` sort (:299/:1051),
    // the rendered metric columns and every advanced range filter (:556-562).
    for (const column of [
      "computed_at",
      "computation_status",
      "cumulative_return",
      "cagr",
      "sharpe",
      "max_drawdown",
      "volatility",
      "six_month_return",
      "calmar",
      "sparkline_returns",
      "sparkline_drawdown",
      // Phase 163 / HONEST-08 — the badge buckets on the staler of sync- and
      // SERIES-recency, so the series' end date is now a rendered surface too.
      // Dropping it silently returns every row to "unknown", which caps the
      // badge below fresh but stops it ever NAMING a dead track record.
      "series_end",
    ]) {
      expect(embed).toContain(column);
    }
  });

  it("never projects daily_returns, the metrics_json blob, data_quality_flags, or the raw returns_series", async () => {
    const { cols, embed } = await captureSelect();
    expect(cols).not.toContain("daily_returns");
    expect(cols).not.toContain("data_quality_flags");
    // `metrics_json` may appear ONLY as the JSONB-key alias below — never as a
    // projected column (which would ship the entire blob to an anon reader).
    expect(embed).not.toMatch(/metrics_json(?!->)/);
    // Phase 163 / HONEST-08, threat T-163-09 — same rule, same reason, applied
    // to the OTHER blob. `returns_series` is a multi-year array of
    // {date,value} points; HONEST-08 needs exactly ONE date out of it, so it
    // may appear only in the arrow/alias form. A bare `returns_series` column
    // here would hand every point to every anonymous visitor to /browse — the
    // regression this pin exists to catch, mirroring the metrics_json one.
    expect(embed).not.toMatch(/returns_series(?!->)/);
  });

  it("carries the series end as an aliased LAST-element JSONB date, not the array", async () => {
    const { embed } = await captureSelect();
    // MEASURED against the TEST project 2026-08-26 (service role, both forms):
    //   select=computed_at,series_end:returns_series->-1->>date
    //     → HTTP 200, {"computed_at":"2026-04-30T…","series_end":"2026-04-29"}
    //   select=id,strategy_analytics(computed_at,series_end:returns_series->-1->>date)
    //     → HTTP 200, {"strategy_analytics":{"series_end":"2026-05-29",…}}
    // The `->0->>date` control returned the series' FIRST date on the same
    // rows, which is what proves `-1` resolves to the LAST element rather than
    // silently yielding null. `->>` (not `->`) yields the bare date text.
    expect(embed).toContain("series_end:returns_series->-1->>date");
  });

  it("carries the 3M advanced filter as an aliased JSONB key, not the blob", async () => {
    const { embed } = await captureSelect();
    // MEASURED against the TEST project 2026-08-21: this embed alias form
    // returns `{"three_month": 0.0}` (HTTP 200, a real number) — see
    // 159-03-SUMMARY. The A4 assumption held; the filter does not degrade.
    expect(embed).toContain("three_month:metrics_json->three_month");
  });
});

/**
 * Phase 159 (159-03, RANK-02 / decision D-02) — `getStrategyDetail` splatted
 * `strategy_analytics (*)`. RESEARCH Open Question 2 framed the tension as
 * "the anon /strategy/[id] page and the authed discovery detail page share
 * this function, and only one of them may see data_quality_flags", and the
 * resolution is CALLER-SCOPED projections rather than one shared list.
 *
 * ⚠️ Measured correction (159-03): at HEAD `/strategy/[id]` does NOT call this
 * function — it calls `getPublicStrategyDetail` (aliased locally through
 * `cache()`), which already carries an explicit projection. This function's
 * only production caller is the AUTHED discovery detail page. The `public`
 * variant is therefore the SAFE DEFAULT for the exported surface, not a live
 * anon path: any future anon caller gets the minimal projection unless it
 * explicitly opts into the wider discovery list.
 */
describe("getStrategyDetail — RANK-02 caller-scoped analytics projection", () => {
  const captureEmbed = async (run: () => Promise<unknown>) => {
    recorders.strategyData = { ...baseStrategy, disclosure_tier: "exploratory" };
    await run();
    const cols = recorders.strategySelectCols.at(-1) ?? "";
    return { cols, embed: /strategy_analytics \(([^)]*)\)/.exec(cols)?.[1] ?? "" };
  };

  it("public variant (the default) excludes the three columns and keeps computation_status", async () => {
    const { cols, embed } = await captureEmbed(() => getStrategyDetail("strat_123"));
    expect(cols).not.toContain("strategy_analytics (*)");
    expect(embed).not.toBe("*");
    // computation_status is MANDATORY in every variant — the detail surfaces
    // derive their still-computing placeholder from it.
    expect(embed).toContain("computation_status");
    expect(cols).not.toContain("daily_returns");
    expect(cols).not.toContain("data_quality_flags");
    // catches `metrics_json` AND `metrics_json_by_basis`, allows a `->` alias
    expect(embed).not.toMatch(/metrics_json(?!->)/);
  });

  it("discovery variant additionally projects every field the authed detail page reads", async () => {
    const { cols, embed } = await captureEmbed(() =>
      getStrategyDetail("strat_123", "crypto-sma", "discovery"),
    );
    expect(cols).not.toContain("strategy_analytics (*)");
    // Enumerated from discovery/[slug]/[strategyId]/page.tsx at HEAD:
    // daily_returns (:66) + returns_series (:69) feed resolveDailyReturnSeries;
    // data_quality_flags (:85) drives the composite/single-key branch;
    // metrics_json_by_basis + computation_status feed readSingleKeyBasisOpts;
    // computed_at drives the FreshnessChip sentinel (:149).
    for (const column of [
      "computation_status",
      "computed_at",
      "data_quality_flags",
      "daily_returns",
      "returns_series",
      "metrics_json_by_basis",
    ]) {
      expect(embed).toContain(column);
    }
  });

  /**
   * The public variant and `getPublicStrategyDetail`'s PUBLIC_ANALYTICS_COLUMNS
   * describe the SAME thing — what an anonymous reader needs from a strategy
   * detail row.
   *
   * ⚠️ WHAT THIS PINS CHANGED, and the wording is kept honest about it. It was
   * written when the two were byte-identical LITERALS, where drift between the
   * copies was the live hazard. `STRATEGY_DETAIL_PUBLIC_ANALYTICS_COLUMNS` is
   * now bound to `PUBLIC_ANALYTICS_COLUMNS` (queries.ts), so that particular
   * drift is impossible by construction and this test can no longer catch it.
   * What it still catches is the remaining failure mode, one level up: a CALL
   * SITE that stops routing through the shared constant — an inlined list at
   * the variant switch, or a widened embed in either fetcher. That is now the
   * only way these two projections can diverge, and it reds here.
   */
  it("public variant stays in lockstep with the anon factsheet projection", async () => {
    const detail = await captureEmbed(() => getStrategyDetail("strat_123"));
    const factsheet = await captureEmbed(() => getPublicStrategyDetail("strat_123"));
    const members = (embed: string) =>
      embed.split(",").map((c) => c.trim()).sort();
    expect(members(detail.embed).length).toBeGreaterThan(0);
    expect(members(detail.embed)).toEqual(members(factsheet.embed));
  });

  it("the two variants differ — data_quality_flags is the authed-only column", async () => {
    const pub = await captureEmbed(() => getStrategyDetail("strat_123"));
    const disc = await captureEmbed(() =>
      getStrategyDetail("strat_123", undefined, "discovery"),
    );
    expect(pub.embed).not.toContain("data_quality_flags");
    expect(disc.embed).toContain("data_quality_flags");
    expect(disc.embed).not.toBe(pub.embed);
  });
});

describe("getPublicStrategyDetail — disclosure tier redaction", () => {
  it("returns null manager + does NOT query profiles for exploratory strategies", async () => {
    recorders.strategyData = {
      ...baseStrategy,
      disclosure_tier: "exploratory",
    };
    recorders.managerRowData = fullManagerRow;

    const result = await getPublicStrategyDetail("strat_123");

    expect(result).not.toBeNull();
    expect(result!.disclosureTier).toBe("exploratory");
    expect(result!.manager).toBeNull();
    expect(recorders.fromCalls).not.toContain("profiles");
    expect(recorders.adminFromCalls).not.toContain("profiles");
  });

  it("populates manager fields for institutional strategies via admin client", async () => {
    recorders.strategyData = {
      ...baseStrategy,
      disclosure_tier: "institutional",
    };
    recorders.managerRowData = fullManagerRow;

    const result = await getPublicStrategyDetail("strat_123");

    expect(result!.disclosureTier).toBe("institutional");
    expect(result!.manager).toEqual({
      display_name: "Jane Doe",
      company: "Acme Capital",
      bio: "20 years trading equities",
      years_trading: 20,
      aum_range: "$50M-$100M",
      linkedin: "https://linkedin.com/in/janedoe",
    });
    expect(recorders.adminFromCalls).toContain("profiles");
    expect(recorders.fromCalls).not.toContain("profiles");
  });
});

/**
 * Plan 12-08 / METRICS-15 (consumer half): fetchStrategyLazyMetrics RPC consumer
 * tests. Phase 12 ships only the consumer + type union; Phase 14b actually calls
 * it from panels 4–7. Tests cover:
 *   1. Correct RPC name + arg shape (p_strategy_id / p_panel_id) — guards against
 *      drift from the SQL signature in migration 087.
 *   2. Pass-through of populated payload on success.
 *   3. Empty-object fallback on RPC error (T-12-08-01: never reveal strategy
 *      existence via the error path; UI sees the same shape as a private miss).
 *   4. Empty-object fallback on null data (defensive — supabase clients can
 *      return { data: null, error: null } for an empty visibility result).
 */
describe("fetchStrategyLazyMetrics — RPC consumer (Plan 12-08 / METRICS-15)", () => {
  it("calls the fetch_strategy_lazy_metrics RPC with the correct args", async () => {
    recorders.rpcResponse = { data: {}, error: null };
    await fetchStrategyLazyMetrics(
      "00000000-0000-0000-0000-000000000001",
      "rolling",
    );
    expect(recorders.rpcCalls).toHaveLength(1);
    expect(recorders.rpcCalls[0]).toEqual({
      name: "fetch_strategy_lazy_metrics",
      args: {
        p_strategy_id: "00000000-0000-0000-0000-000000000001",
        p_panel_id: "rolling",
      },
    });
  });

  it("returns the data field on success", async () => {
    const payload = {
      rolling_sortino_3m: [{ date: "2026-01-01", value: 1.5 }],
    };
    recorders.rpcResponse = { data: payload, error: null };
    const result = await fetchStrategyLazyMetrics("strategy-id", "rolling");
    expect(result).toEqual(payload);
  });

  it("returns empty object on RPC error", async () => {
    recorders.rpcResponse = {
      data: null,
      error: { message: "boom", code: "PGRST000" },
    };
    const result = await fetchStrategyLazyMetrics("strategy-id", "rolling");
    expect(result).toEqual({});
  });

  it("returns empty object on null data with no error", async () => {
    recorders.rpcResponse = { data: null, error: null };
    const result = await fetchStrategyLazyMetrics("strategy-id", "overview");
    expect(result).toEqual({});
  });

  // audit-2026-05-07 H-0489/H-0494: the RPC response is `any` and the
  // function previously did `(data ?? {}) as LazyMetricsPayload`, which
  // accepted ANY shape (arrays, primitives, false, 0). A typo'd panelId
  // / SECURITY DEFINER mis-return would silently corrupt every consumer
  // that destructures `payload.rolling_sortino_3m`. Reject non-plain-object
  // payloads at the boundary and collapse to `{}` to match the
  // visibility-miss contract.
  it("returns {} when RPC returns an array (non-object payload)", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    recorders.rpcResponse = { data: [1, 2, 3] as unknown, error: null };
    const result = await fetchStrategyLazyMetrics("strategy-id", "rolling");
    expect(result).toEqual({});
    expect(errSpy).toHaveBeenCalledWith(
      expect.stringContaining("unexpected RPC payload shape"),
      expect.objectContaining({ type: "array" }),
    );
    errSpy.mockRestore();
  });

  it("returns {} when RPC returns a primitive (false / number / string)", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    recorders.rpcResponse = { data: false as unknown, error: null };
    expect(await fetchStrategyLazyMetrics("strategy-id", "rolling")).toEqual({});
    recorders.rpcResponse = { data: 0 as unknown, error: null };
    expect(await fetchStrategyLazyMetrics("strategy-id", "rolling")).toEqual({});
    recorders.rpcResponse = { data: "oops" as unknown, error: null };
    expect(await fetchStrategyLazyMetrics("strategy-id", "rolling")).toEqual({});
    errSpy.mockRestore();
  });

  // Phase B pr-test-analyzer F1 — audit-2026-05-07 H-0488 contract:
  // RPC errors must escalate to Sentry, not just console.error (Vercel
  // runtime logs are not monitored continuously).
  it("captures the RPC error to Sentry with op + panel_id + rpc_code tags", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const rpcError = { message: "rls denied", code: "PGRST301" };
    recorders.rpcResponse = { data: null, error: rpcError };
    await fetchStrategyLazyMetrics("strategy-id", "rolling");
    expect(recorders.sentryCalls).toHaveLength(1);
    expect(recorders.sentryCalls[0].err).toBe(rpcError);
    expect(recorders.sentryCalls[0].opts).toEqual(
      expect.objectContaining({
        tags: expect.objectContaining({
          op: "fetchStrategyLazyMetrics",
          panel_id: "rolling",
          rpc_code: "PGRST301",
        }),
        level: "error",
      }),
    );
    errSpy.mockRestore();
  });

  it("defaults rpc_code to 'unknown' when error.code is absent", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    recorders.rpcResponse = {
      data: null,
      error: { message: "no code field" },
    };
    await fetchStrategyLazyMetrics("strategy-id", "exposure");
    expect(recorders.sentryCalls).toHaveLength(1);
    expect(
      (recorders.sentryCalls[0].opts as { tags: { rpc_code: string } }).tags
        .rpc_code,
    ).toBe("unknown");
    errSpy.mockRestore();
  });

  // Phase B silent-failure F3 + type-design F4: shape-mismatch path must
  // ALSO escalate to Sentry (a SECURITY DEFINER return-type drift was
  // previously invisible because only the error-channel went to Sentry).
  it("captures shape-mismatch (array payload) to Sentry with reason=unexpected_payload_shape", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    recorders.rpcResponse = { data: [1, 2, 3] as unknown, error: null };
    await fetchStrategyLazyMetrics("strategy-id", "rolling");
    expect(recorders.sentryCalls).toHaveLength(1);
    expect(recorders.sentryCalls[0].opts).toEqual(
      expect.objectContaining({
        tags: expect.objectContaining({
          op: "fetchStrategyLazyMetrics",
          panel_id: "rolling",
          reason: "unexpected_payload_shape",
        }),
        level: "error",
      }),
    );
    errSpy.mockRestore();
  });

  // Phase B silent-failure F2: a legitimate `null` data ("visibility miss")
  // must NOT log or escalate — only real shape regressions should.
  it("does NOT log or capture on null data (legitimate visibility miss)", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    recorders.rpcResponse = { data: null, error: null };
    await fetchStrategyLazyMetrics("strategy-id", "rolling");
    expect(errSpy).not.toHaveBeenCalled();
    expect(recorders.sentryCalls).toHaveLength(0);
    errSpy.mockRestore();
  });

  // Phase B type-design F4: unexpected keys (e.g. SQL CASE typo
  // `rollig_sortino_3m`) must be filtered out AND escalated to Sentry.
  it("filters unexpected keys from the payload and captures to Sentry", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    recorders.rpcResponse = {
      data: {
        rolling_sortino_3m: [{ date: "2026-01-01", value: 1.0 }],
        rollig_sortino_typo: [{ date: "2026-01-01", value: 99 }],
      },
      error: null,
    };
    const result = await fetchStrategyLazyMetrics("strategy-id", "rolling");
    expect(result).toEqual({
      rolling_sortino_3m: [{ date: "2026-01-01", value: 1.0 }],
    });
    expect(recorders.sentryCalls).toHaveLength(1);
    expect(recorders.sentryCalls[0].opts).toEqual(
      expect.objectContaining({
        tags: expect.objectContaining({
          op: "fetchStrategyLazyMetrics",
          panel_id: "rolling",
          reason: "unexpected_payload_keys",
        }),
      }),
    );
    expect(
      (recorders.sentryCalls[0].opts as { extra: { unexpected: string[] } })
        .extra.unexpected,
    ).toEqual(["rollig_sortino_typo"]);
    errSpy.mockRestore();
  });
});

/**
 * Phase 13 / Plan 13-01 / DISCO-01 — getMyWatchlist server-side query.
 *
 * Contract per 13-01-PLAN.md acceptance criteria:
 *   - Returns Set<string> of strategy_ids the user has starred.
 *   - On supabase error: returns empty Set (no throw — defensive against RLS
 *     surface drift; the page-level Promise.all keeps rendering the table).
 *   - Calls .from("user_favorites").select("strategy_id").eq("user_id", uid).
 *
 * Threat ref: T-13-01-04 (info disclosure) — userId comes from
 * supabase.auth.getUser() server-side, never client input. RLS on
 * user_favorites enforces user_id=auth.uid() on SELECT (migration 024).
 */
describe("getMyWatchlist (Plan 13-01 / DISCO-01)", () => {
  const USER_ID = "00000000-0000-0000-0000-000000000aaa";

  it("returns a Set<string> of strategy_ids for the given user", async () => {
    recorders.favoritesResponse = {
      data: [
        { strategy_id: "cccccccc-0001-4000-8000-000000000001" },
        { strategy_id: "cccccccc-0001-4000-8000-000000000002" },
      ],
      error: null,
    };
    const result = await getMyWatchlist(USER_ID);
    expect(result).toBeInstanceOf(Set);
    if (!result) throw new Error("expected Set, got null");
    expect(result.size).toBe(2);
    expect(result.has("cccccccc-0001-4000-8000-000000000001")).toBe(true);
    expect(result.has("cccccccc-0001-4000-8000-000000000002")).toBe(true);
  });

  it("returns null when supabase reports an error (so callers can distinguish empty-state from failure)", async () => {
    recorders.favoritesResponse = {
      data: null,
      error: { message: "rls denied" },
    };
    const result = await getMyWatchlist(USER_ID);
    expect(result).toBeNull();
  });

  it("returns an empty Set when data is an empty array", async () => {
    recorders.favoritesResponse = { data: [], error: null };
    const result = await getMyWatchlist(USER_ID);
    expect(result).toBeInstanceOf(Set);
    expect((result as Set<string>).size).toBe(0);
  });

  it("queries user_favorites with select('strategy_id') and eq('user_id', uid)", async () => {
    recorders.favoritesResponse = { data: [], error: null };
    await getMyWatchlist(USER_ID);
    expect(recorders.fromCalls).toContain("user_favorites");
    expect(recorders.favoritesSelectCalls).toEqual(["strategy_id"]);
    // Single eq filter on user_id (other filters would be a security regression
    // — the function is meant to read ALL of the user's favorites).
    expect(recorders.favoritesEqCalls).toEqual([["user_id", USER_ID]]);
  });

  // audit-2026-05-07 H-0490 regression: rows with null/undefined
  // strategy_id must NOT make it into the Set. The old code did
  // `data.map((row) => row.strategy_id as string)` which let `null` /
  // `undefined` flow through as Set members; `Set.has(undefined)` then
  // returns true for any caller probing with `s.id` that itself happens
  // to be undefined, falsely flagging unrelated strategies as starred.
  it("drops rows where strategy_id is null or undefined (column-drift defence)", async () => {
    recorders.favoritesResponse = {
      data: [
        { strategy_id: "cccccccc-0001-4000-8000-000000000001" },
        { strategy_id: null },
        { strategy_id: undefined },
        { strategy_id: "" },
        { strategy_id: "cccccccc-0001-4000-8000-000000000002" },
      ],
      error: null,
    };
    const result = await getMyWatchlist(USER_ID);
    expect(result).toBeInstanceOf(Set);
    if (!result) throw new Error("expected Set, got null");
    expect(result.size).toBe(2);
    expect(result.has("cccccccc-0001-4000-8000-000000000001")).toBe(true);
    expect(result.has("cccccccc-0001-4000-8000-000000000002")).toBe(true);
    // Critically: the set must NOT contain undefined — Set.has(undefined)
    // would otherwise return true for callers probing with `s.id`
    // when `s.id` is also undefined (the false-star regression).
    expect(result.has(undefined as unknown as string)).toBe(false);
    expect(result.has(null as unknown as string)).toBe(false);
    expect(result.has("")).toBe(false);
  });

  // Phase B pr-test-analyzer F4: the typeof guard must accept ONLY
  // non-empty strings. A future regression to `if (sid != null)` would
  // re-admit numbers / booleans / arrays / objects, breaking the contract.
  it("drops rows where strategy_id is a non-string truthy value (type-drift defence)", async () => {
    recorders.favoritesResponse = {
      data: [
        { strategy_id: 123 },
        { strategy_id: true },
        { strategy_id: ["nested-id"] },
        { strategy_id: { id: "obj" } },
      ],
      error: null,
    };
    const result = await getMyWatchlist(USER_ID);
    expect(result).toBeInstanceOf(Set);
    if (!result) throw new Error("expected Set, got null");
    expect(result.size).toBe(0);
  });

  // Phase B pr-test-analyzer F10: an RLS-blocked SELECT can return
  // { data: null, error: null }. Function must collapse to an empty Set
  // (not null — null is reserved for explicit error states).
  it("returns an empty Set when data is null and error is null (RLS-block edge case)", async () => {
    recorders.favoritesResponse = { data: null, error: null };
    const result = await getMyWatchlist(USER_ID);
    expect(result).toBeInstanceOf(Set);
    expect((result as Set<string>).size).toBe(0);
  });
});

/**
 * Plan 14b-06 Task 1 — getStrategyDetailV2 panel4..7 input mappings.
 *
 * Wave-3 integration extends `StrategyV2Detail` with eager inputs for
 * Panels 4-7 (mapped from the analytics blob already fetched via the
 * existing `from('strategies').select('*, strategy_analytics (*)')` join).
 * No new RPC, no schema change, no migration.
 *
 * Tests cover:
 *   1. Interface extension (panel4Inputs / panel5Inputs / panel6Inputs / panel7Inputs)
 *   2. Mapping fidelity from analytics row to each panelNInputs sub-object
 *   3. metrics_json extraction for benchmark_returns + greeks scalars
 *   4. Pitfall 8 honored — computation_status !== 'complete' returns null
 *      everywhere
 *   5. Visibility gate preserved — unpublished strategy returns null
 *   6. Greeks long-name vs short-name fallback
 */
describe("getStrategyDetailV2 — Plan 14b-06 panel4..7 mappings", () => {
  const STRAT_ID = "00000000-0000-0000-0000-000000000abc";

  function buildAnalyticsRow(overrides: Record<string, unknown> = {}) {
    return {
      computation_status: "complete",
      cumulative_return: 0.42,
      cagr: 0.18,
      sharpe: 1.5,
      sortino: 2.1,
      max_drawdown: -0.12,
      volatility: 0.16,
      returns_series: [
        { date: "2024-01-01", value: 1.0 },
        { date: "2024-12-31", value: 1.42 },
      ],
      drawdown_series: [{ date: "2024-06-15", value: -0.12 }],
      monthly_returns: { "2024": { Jan: 0.01, Feb: 0.02 } },
      return_quantiles: { Daily: [-0.05, -0.01, 0, 0.01, 0.05] },
      rolling_metrics: {
        sharpe_30d: [{ date: "2024-01-01", value: 0.5 }],
        sharpe_90d: [{ date: "2024-01-01", value: 0.7 }],
        sharpe_365d: [{ date: "2024-01-01", value: 1.0 }],
      },
      trade_metrics: {
        total_positions: 100,
        open_positions: 5,
        closed_positions: 95,
        win_rate: 0.6,
        avg_roi: 0.05,
        avg_duration_days: 4.2,
        long_count: 60,
        short_count: 40,
        best_trade_roi: 0.5,
        worst_trade_roi: -0.2,
        expectancy: 0.04,
        risk_reward_ratio: 2.1,
        weighted_risk_reward_ratio: 2.0,
        sqn: 1.8,
        profit_factor_long: 1.5,
        profit_factor_short: 1.2,
      },
      metrics_json: {
        history_days: 365,
        equity_series_1y: [{ date: "2024-01-01", value: 1.0 }],
        btc_benchmark_returns: [{ date: "2024-01-01", value: 1.0 }],
        benchmark_returns: [
          { date: "2024-01-01", value: 0 },
          { date: "2024-01-02", value: 0.001 },
        ],
        alpha: 0.05,
        beta: 0.92,
        information_ratio: 0.42,
        treynor_ratio: 0.18,
        ...((overrides.metrics_json as Record<string, unknown>) ?? {}),
      },
      ...overrides,
    };
  }

  function buildStrategyRow(extra: Record<string, unknown> = {}) {
    return {
      id: STRAT_ID,
      user_id: "user-1",
      category_id: null,
      api_key_id: null,
      name: "Test Strategy",
      description: null,
      strategy_types: ["systematic"],
      subtypes: ["trend"],
      markets: ["crypto"],
      supported_exchanges: ["Binance"],
      leverage_range: "1-3x",
      avg_daily_turnover: 250000,
      aum: null,
      max_capacity: null,
      start_date: "2024-01-01",
      status: "published",
      is_example: false,
      benchmark: "BTC",
      created_at: "2024-01-01T00:00:00Z",
      strategy_analytics: buildAnalyticsRow(),
      ...extra,
    };
  }

  it("Test 1: returns panel4Inputs / panel5Inputs / panel6Inputs / panel7Inputs sub-objects", async () => {
    recorders.strategyData = buildStrategyRow();
    const result = await getStrategyDetailV2(STRAT_ID);
    expect(result).not.toBeNull();
    expect(result!.panel4Inputs).toBeDefined();
    expect(result!.panel5Inputs).toBeDefined();
    expect(result!.panel6Inputs).toBeDefined();
    expect(result!.panel7Inputs).toBeDefined();
  });

  it("Test 2: panel4Inputs maps monthly_returns / return_quantiles / returns_series from analytics", async () => {
    recorders.strategyData = buildStrategyRow();
    const result = await getStrategyDetailV2(STRAT_ID);
    expect(result!.panel4Inputs.monthly_returns).toEqual({
      "2024": { Jan: 0.01, Feb: 0.02 },
    });
    expect(result!.panel4Inputs.return_quantiles).toEqual({
      Daily: [-0.05, -0.01, 0, 0.01, 0.05],
    });
    expect(result!.panel4Inputs.returns_series).toEqual([
      { date: "2024-01-01", value: 1.0 },
      { date: "2024-12-31", value: 1.42 },
    ]);
  });

  it("Test 3: panel4Inputs.benchmark_returns reads from metrics_json.benchmark_returns", async () => {
    recorders.strategyData = buildStrategyRow();
    const result = await getStrategyDetailV2(STRAT_ID);
    expect(result!.panel4Inputs.benchmark_returns).toEqual([
      { date: "2024-01-01", value: 0 },
      { date: "2024-01-02", value: 0.001 },
    ]);
  });

  it("Test 4: panel7Inputs.benchmark_greeks reads alpha/beta/IR/Treynor from metrics_json (long names preferred)", async () => {
    recorders.strategyData = buildStrategyRow();
    const result = await getStrategyDetailV2(STRAT_ID);
    expect(result!.panel7Inputs.benchmark_greeks).toEqual({
      alpha: 0.05,
      beta: 0.92,
      ir: 0.42, // information_ratio (long name)
      treynor: 0.18, // treynor_ratio (long name)
    });
  });

  it("Test 4b: greeks fallback — short names accepted when long names absent", async () => {
    recorders.strategyData = buildStrategyRow({
      strategy_analytics: buildAnalyticsRow({
        metrics_json: {
          history_days: 365,
          alpha: 0.01,
          beta: 0.5,
          // information_ratio + treynor_ratio absent; use ir + treynor short names
          ir: 0.3,
          treynor: 0.15,
        },
      }),
    });
    const result = await getStrategyDetailV2(STRAT_ID);
    expect(result!.panel7Inputs.benchmark_greeks.ir).toBe(0.3);
    expect(result!.panel7Inputs.benchmark_greeks.treynor).toBe(0.15);
  });

  it("Test 5: panel5Inputs.rolling_metrics maps from analytics.rolling_metrics; sharpe scalar passes through", async () => {
    recorders.strategyData = buildStrategyRow();
    const result = await getStrategyDetailV2(STRAT_ID);
    expect(Object.keys(result!.panel5Inputs.rolling_metrics ?? {}).sort()).toEqual([
      "sharpe_30d",
      "sharpe_365d",
      "sharpe_90d",
    ]);
    expect(result!.panel5Inputs.sharpe).toBe(1.5);
  });

  it("Test 6: Pitfall 8 — when computation_status !== 'complete', all new fields are null/empty", async () => {
    recorders.strategyData = buildStrategyRow({
      strategy_analytics: buildAnalyticsRow({ computation_status: "pending" }),
    });
    const result = await getStrategyDetailV2(STRAT_ID);
    expect(result!.panel4Inputs.monthly_returns).toBeNull();
    expect(result!.panel4Inputs.return_quantiles).toBeNull();
    expect(result!.panel4Inputs.returns_series).toBeNull();
    expect(result!.panel4Inputs.benchmark_returns).toBeNull();
    expect(result!.panel5Inputs.rolling_metrics).toBeNull();
    expect(result!.panel5Inputs.sharpe).toBeNull();
    expect(result!.panel6Inputs.trade_metrics).toBeNull();
    expect(result!.panel7Inputs.benchmark_greeks).toEqual({
      alpha: null,
      beta: null,
      ir: null,
      treynor: null,
    });
    expect(result!.panel7Inputs.correlation_analytics.returns_series).toBeNull();
    expect(result!.panel7Inputs.correlation_analytics.metrics_json).toBeNull();
  });

  it("Test 6b (mig-20260707120000): complete_with_warnings is a terminal success — panels POPULATE (call site invokes isComputedAnalytics, not exact-match)", async () => {
    // Wiring guard, not a helper test: a warned row must render metrics, else
    // every panel goes blank for warned strategies. Reverting queries.ts:687 to
    // `=== "complete"` makes these assertions fail.
    recorders.strategyData = buildStrategyRow({
      strategy_analytics: buildAnalyticsRow({
        computation_status: "complete_with_warnings",
      }),
    });
    const result = await getStrategyDetailV2(STRAT_ID);
    expect(result!.panel4Inputs.monthly_returns).toEqual({
      "2024": { Jan: 0.01, Feb: 0.02 },
    });
    expect(result!.panel4Inputs.returns_series).toEqual([
      { date: "2024-01-01", value: 1.0 },
      { date: "2024-12-31", value: 1.42 },
    ]);
    expect(result!.panel5Inputs.sharpe).not.toBeNull();
    expect(result!.panel6Inputs.trade_metrics).not.toBeNull();
  });

  it("Test 7: visibility gate — getStrategyDetailV2 returns null when supabase reports an error", async () => {
    // No row data + the mock chain's .single() returns { data: null, error: null }
    // The function checks `error || !strategy` — when both are falsy, the
    // existing chain returns null which we reproduce by leaving strategyData null.
    recorders.strategyData = null;
    const result = await getStrategyDetailV2("nonexistent-id");
    expect(result).toBeNull();
  });

  // M-1159: getStrategyDetailV2 must NOT collapse a transient DB/transport
  // error into the same `null` it returns for a genuine 0-row miss. A clean
  // PGRST116 (no rows — also how RLS hides an invisible row) stays null so the
  // v2 page renders notFound() (404). Any OTHER error must THROW so the
  // route's error.tsx boundary (Reload + fall-back-to-v1 CTA) engages instead
  // of a misleading "Strategy Not Found". WHY it matters: a Supabase outage on
  // a real, published strategy should be a recoverable error state, never a
  // 404 that tells the allocator the strategy does not exist.
  it("Test 7b (M-1159): throws on a transient (non-PGRST116) DB error so error.tsx engages", async () => {
    recorders.strategyData = null;
    recorders.strategyError = {
      code: "57014",
      message: "canceling statement due to statement timeout",
    };
    await expect(getStrategyDetailV2("transient-err-id")).rejects.toThrow(
      /getStrategyDetailV2.*failed/,
    );
  });

  it("Test 7c (M-1159): returns null (not throw) on a clean PGRST116 0-row miss → notFound()", async () => {
    recorders.strategyData = null;
    recorders.strategyError = {
      code: "PGRST116",
      message: "JSON object requested, multiple (or no) rows returned",
    };
    const result = await getStrategyDetailV2("clean-miss-id");
    expect(result).toBeNull();
  });

  it("Test 8: panel6Inputs.trade_metrics maps from analytics.trade_metrics", async () => {
    recorders.strategyData = buildStrategyRow();
    const result = await getStrategyDetailV2(STRAT_ID);
    expect(result!.panel6Inputs.trade_metrics).not.toBeNull();
    expect(result!.panel6Inputs.trade_metrics!.total_positions).toBe(100);
    expect(result!.panel6Inputs.trade_metrics!.win_rate).toBe(0.6);
    expect(result!.panel6Inputs.trade_metrics!.expectancy).toBe(0.04);
  });

  it("Test 9: correlation_analytics carries returns_series + metrics_json subset", async () => {
    recorders.strategyData = buildStrategyRow();
    const result = await getStrategyDetailV2(STRAT_ID);
    expect(result!.panel7Inputs.correlation_analytics.returns_series).toEqual([
      { date: "2024-01-01", value: 1.0 },
      { date: "2024-12-31", value: 1.42 },
    ]);
    expect(result!.panel7Inputs.correlation_analytics.metrics_json).toBeDefined();
    expect(
      (result!.panel7Inputs.correlation_analytics.metrics_json as Record<string, unknown>)["alpha"],
    ).toBe(0.05);
  });
});

/**
 * METRICS-15 path-extraction contract.
 *
 * Locks the two halves of the SC#3b p95<50ms detail-fetch contract that
 * queries.ts:391-407 documents:
 *
 *   1. Wire shape — getStrategyDetailV2 must NEVER hit the strategies row
 *      with `select *`. The explicit STRATEGY/ANALYTICS column lists are the
 *      bandwidth win; a regression to `*` would silently double the bytes
 *      crossing the wire and miss the p95 budget under load.
 *
 *   2. In-memory unpack — the panel{1..7} mapper that runs after Supabase
 *      returns must execute well under the 50ms budget so the network is the
 *      dominant cost. Microbenchmark over a maximally-populated analytics row
 *      against a deterministic-data mock; assert p95 stays inside the budget.
 *
 * Why no LATERAL join migration: the doc comment at queries.ts:391-407
 * (and migration 087) makes explicit that PostgREST cannot project a JSONB
 * sub-tree without an RPC. The lazy fetch via fetch_strategy_lazy_metrics
 * IS the LATERAL/sibling-table architecture; the eager projection above
 * trims the surrounding bandwidth. Both halves of the contract live here.
 */
describe("getStrategyDetailV2 — METRICS-15 path-extraction perf contract", () => {
  const STRAT_ID = "00000000-0000-0000-0000-000000000abc";

  function buildAnalyticsRow() {
    return {
      computation_status: "complete",
      cumulative_return: 0.42,
      cagr: 0.18,
      sharpe: 1.5,
      sortino: 2.1,
      max_drawdown: -0.12,
      volatility: 0.16,
      // Heaviest realistic shapes the eager unpack must walk: 1y daily series
      // (~252 entries), 12mo monthly grid, full quantiles + rolling families,
      // trade_metrics, drawdown_series. The lazy sibling-table series live
      // outside this projection (path-extracted via fetch_strategy_lazy_metrics)
      // so they don't pad the row.
      returns_series: Array.from({ length: 252 }, (_, i) => ({
        date: new Date(2024, 0, 1 + i).toISOString().slice(0, 10),
        value: 1 + i * 0.001,
      })),
      drawdown_series: Array.from({ length: 30 }, (_, i) => ({
        date: new Date(2024, 5, 1 + i).toISOString().slice(0, 10),
        value: -0.01 * (i + 1),
      })),
      monthly_returns: {
        "2023": Object.fromEntries(
          ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"].map(
            (m, i) => [m, i * 0.005],
          ),
        ),
        "2024": Object.fromEntries(
          ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"].map(
            (m, i) => [m, i * 0.006],
          ),
        ),
      },
      return_quantiles: {
        Daily: Array.from({ length: 21 }, (_, i) => -0.05 + i * 0.005),
        Weekly: Array.from({ length: 21 }, (_, i) => -0.1 + i * 0.01),
        Monthly: Array.from({ length: 21 }, (_, i) => -0.2 + i * 0.02),
      },
      rolling_metrics: {
        sharpe_30d: Array.from({ length: 90 }, (_, i) => ({
          date: new Date(2024, 0, 1 + i).toISOString().slice(0, 10),
          value: 0.5 + i * 0.001,
        })),
        sharpe_90d: Array.from({ length: 90 }, (_, i) => ({
          date: new Date(2024, 0, 1 + i).toISOString().slice(0, 10),
          value: 0.7 + i * 0.001,
        })),
        sharpe_365d: Array.from({ length: 90 }, (_, i) => ({
          date: new Date(2024, 0, 1 + i).toISOString().slice(0, 10),
          value: 1.0 + i * 0.001,
        })),
      },
      trade_metrics: {
        total_positions: 100,
        open_positions: 5,
        closed_positions: 95,
        win_rate: 0.6,
        avg_roi: 0.05,
        avg_duration_days: 4.2,
        long_count: 60,
        short_count: 40,
        best_trade_roi: 0.5,
        worst_trade_roi: -0.2,
        expectancy: 0.04,
        risk_reward_ratio: 2.1,
        weighted_risk_reward_ratio: 2.0,
        sqn: 1.8,
        profit_factor_long: 1.5,
        profit_factor_short: 1.2,
      },
      metrics_json: {
        history_days: 365,
        equity_series_1y: Array.from({ length: 252 }, (_, i) => ({
          date: new Date(2024, 0, 1 + i).toISOString().slice(0, 10),
          value: 1 + i * 0.0005,
        })),
        btc_benchmark_returns: Array.from({ length: 252 }, (_, i) => ({
          date: new Date(2024, 0, 1 + i).toISOString().slice(0, 10),
          value: 1 + i * 0.0003,
        })),
        benchmark_returns: Array.from({ length: 252 }, (_, i) => ({
          date: new Date(2024, 0, 1 + i).toISOString().slice(0, 10),
          value: i * 0.0001,
        })),
        alpha: 0.05,
        beta: 0.92,
        information_ratio: 0.42,
        treynor_ratio: 0.18,
      },
    };
  }

  function buildStrategyRow() {
    return {
      id: STRAT_ID,
      name: "METRICS-15 perf fixture",
      start_date: "2024-01-01",
      supported_exchanges: ["Binance"],
      strategy_types: ["systematic"],
      subtypes: ["trend"],
      markets: ["crypto"],
      leverage_range: "1-3x",
      avg_daily_turnover: 250000,
      status: "published",
      strategy_analytics: buildAnalyticsRow(),
    };
  }

  it("uses an explicit column projection on the strategies row (no `select *`)", async () => {
    recorders.strategyData = buildStrategyRow();
    await getStrategyDetailV2(STRAT_ID);

    expect(recorders.strategySelectCols.length).toBeGreaterThanOrEqual(1);
    const selectCols = recorders.strategySelectCols[0];

    expect(selectCols).not.toMatch(/\*/);

    for (const col of [
      "id",
      "name",
      "start_date",
      "supported_exchanges",
      "strategy_types",
      "leverage_range",
      "avg_daily_turnover",
      "strategy_analytics",
      "metrics_json",
      "trade_metrics",
      "rolling_metrics",
      // CRITICAL: data_quality_flags MUST be in the projection. PR #106
      // added the typed AnalyticsDataQualityFlags interface and PR #107
      // added the no_linked_api_key flag, but the v2 SELECT was never
      // updated to pull the column — so PostgREST silently returned
      // rows without it and every chip both PRs added was dead in
      // production. See queries.ts:404 + the integration test below.
      "data_quality_flags",
    ]) {
      expect(selectCols).toContain(col);
    }
  });

  it("panel6Inputs.data_quality_flags maps from analytics.data_quality_flags (no chip is dead-on-arrival)", async () => {
    const strategyRow = buildStrategyRow();
    (strategyRow.strategy_analytics as Record<string, unknown>).data_quality_flags = {
      account_balance_unavailable: true,
      no_linked_api_key: false,
      trade_mix_approximation: true,
    };
    recorders.strategyData = strategyRow;

    const result = await getStrategyDetailV2(STRAT_ID);
    expect(result).not.toBeNull();
    expect(result!.panel6Inputs.data_quality_flags).not.toBeNull();
    expect(result!.panel6Inputs.data_quality_flags?.account_balance_unavailable).toBe(true);
    expect(result!.panel6Inputs.data_quality_flags?.trade_mix_approximation).toBe(true);
  });

  it("in-memory unpack p95 stays under the 50ms detail-fetch budget", async () => {
    recorders.strategyData = buildStrategyRow();

    // Warm the JIT a few times before measuring so the first iteration's
    // cold-start cost doesn't pollute the percentile.
    for (let i = 0; i < 3; i++) await getStrategyDetailV2(STRAT_ID);

    const N = 50;
    const samples: number[] = [];
    for (let i = 0; i < N; i++) {
      const t0 = performance.now();
      await getStrategyDetailV2(STRAT_ID);
      samples.push(performance.now() - t0);
    }
    samples.sort((a, b) => a - b);
    const p95 = samples[Math.floor(N * 0.95) - 1];

    // The SC#3b end-to-end budget is 50ms; this measures pure in-memory
    // unpack against a mocked Supabase chain so 100ms gives the test
    // headroom against GC pauses on noisy CI runners while still flagging
    // any 10x regression in the panel-mapper hot path.
    expect(p95).toBeLessThan(100);
  });
});

// ---------------------------------------------------------------------------
// FLIPRETRY-03 (Phase 123): the derived↔legacy display flip, pinned at the
// derivePhase07Fields WIRING level (the call-site-invokes-it rule — the
// integration flip through getMyAllocationDashboard is already pinned in
// queries.my-allocation.test.ts; this proves the ONE producer site itself).
//
// The two cases feed a BYTE-IDENTICAL derived curve differing ONLY in the
// persisted `is_trustworthy` flag, so the flip is attributable to that flag
// alone. Deleting the `is_trustworthy !== true` guard in
// extractTrustworthyDerivedCurve would make the FAIL case render 'derived' —
// neuter-proof.
// ---------------------------------------------------------------------------
describe("derivePhase07Fields — is_trustworthy → equityCurveSource flip (FLIPRETRY-03)", () => {
  const SNAPSHOTS = [
    {
      asof: "2026-03-10",
      value_usd: 10_000,
      breakdown: null,
      source: "exchange_primary" as const,
      history_depth_months: 24,
      pre_terminus_balance_unknown: false,
    },
    {
      asof: "2026-03-11",
      value_usd: 10_100,
      breakdown: null,
      source: "exchange_primary" as const,
      history_depth_months: 24,
      pre_terminus_balance_unknown: false,
    },
  ];

  // A dense, well-formed derived curve — the payload the worker persists.
  const DERIVED_CURVE = [
    { date: "2026-03-10", equity_usd: 100_500.5 },
    { date: "2026-03-11", equity_usd: 100_900.25 },
  ];

  const COMPUTED_AT = "2026-03-11T05:30:00Z";

  function derivedRow(isTrustworthy: boolean) {
    return {
      payload: {
        curve: DERIVED_CURVE,
        flags: [],
        degrade_reasons: [],
        is_trustworthy: isTrustworthy,
      } as Record<string, unknown>,
      computed_at: COMPUTED_AT,
    };
  }

  function callWith(derivedEquityRow: {
    payload: unknown;
    computed_at: string | null;
  } | null) {
    return derivePhase07Fields(
      [],
      SNAPSHOTS,
      SNAPSHOTS.length,
      [],
      false,
      derivedEquityRow,
    );
  }

  it("PASS: a trustworthy well-formed curve renders 'derived' and maps the payload directly", () => {
    const result = callWith(derivedRow(true));

    expect(result.equityCurveSource).toBe("derived");
    // The dense curve is mapped DIRECTLY ({date, equity_usd} → {date, value}) —
    // no snapshot forward-fill adapter.
    expect(result.equityDailyPoints).toEqual(
      DERIVED_CURVE.map((p) => ({ date: p.date, value: p.equity_usd })),
    );
    expect(result.derivedCurveComputedAt).toBe(COMPUTED_AT);
  });

  it("FAIL: the BYTE-IDENTICAL curve with is_trustworthy=false renders 'legacy' and falls back to the snapshot render", () => {
    const result = callWith(derivedRow(false));

    expect(result.equityCurveSource).toBe("legacy");
    // Falls back to the legacy forward-fill render over the snapshots — NOT the
    // derived curve.
    expect(result.equityDailyPoints).toEqual(
      equitySnapshotsToDailyPoints(
        SNAPSHOTS.map((s) => ({ asof: s.asof, value_usd: s.value_usd })),
      ),
    );
    // computed_at is suppressed when the curve is not shown.
    expect(result.derivedCurveComputedAt).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Phase 151 / 151-02 Task 1 (AUM-04) — `deriveStrategyLinkedKeyIds`
// ---------------------------------------------------------------------------
/**
 * This is THE manager-role discriminator for the allocator book gate. The
 * question it answers is a ROLE question — "is this key already feeding a live
 * strategy the owner runs as a manager?" — never a VENUE question. An
 * `exchange === "mt5"` predicate is the named wrong-fix class (ROADMAP +
 * CONTEXT): the founder's three deribit keys are equally manager-side (they
 * hang off the Alpha Centauri composite), and a future manager-side bybit key
 * would slip straight through a venue test.
 *
 * The fixtures below are the founder's PROD census (2026-08-05): 8 active keys
 * → 4 live strategies → exactly 2 bare allocator keys. Three strategies carry
 * their key directly (`strategies.api_key_id`); Alpha Centauri carries three
 * keys through `strategy_keys` and has `api_key_id: null`. An `api_key_id`-only
 * implementation returns 3 members instead of 6 and the census test goes RED —
 * and, because AUM-04 SUBTRACTS this set from the allocator's eligible keys, a
 * discriminator that over-covers would silently close the book gate on keys the
 * allocator can legitimately reach.
 */
type CensusKeyFixture = {
  id: string;
  exchange: SupportedExchange;
  label: string;
  is_active: boolean;
  sync_status: string | null;
  disconnected_at: string | null;
};

/** An eligible key per `isPerKeyDailiesEligibleKey`. */
function censusKey(id: string, exchange: SupportedExchange): CensusKeyFixture {
  return {
    id,
    exchange,
    label: `Key ${id}`,
    is_active: true,
    sync_status: "connected",
    disconnected_at: null,
  };
}

const CENSUS_KEYS: CensusKeyFixture[] = [
  censusKey("k-bybit", "bybit"),
  censusKey("k-okx", "okx"),
  censusKey("k-deribit-1", "deribit"),
  censusKey("k-deribit-2", "deribit"),
  censusKey("k-deribit-3", "deribit"),
  censusKey("k-mt5-1", "mt5"),
  censusKey("k-mt5-2", "mt5"),
  censusKey("k-mt5-3", "mt5"),
];

const CENSUS_STRATEGIES: Array<{
  id: string;
  api_key_id: string | null;
  status: string;
}> = [
  { id: "mt5-a", api_key_id: "k-mt5-1", status: "private" },
  { id: "mt5-b", api_key_id: "k-mt5-2", status: "published" },
  { id: "mt5-c", api_key_id: "k-mt5-3", status: "draft" },
  // Alpha Centauri — the 3-key deribit composite (no direct column).
  { id: "alpha", api_key_id: null, status: "private" },
];

const CENSUS_LINKS: Array<{ strategy_id: string; api_key_id: string }> = [
  { strategy_id: "alpha", api_key_id: "k-deribit-1" },
  { strategy_id: "alpha", api_key_id: "k-deribit-2" },
  { strategy_id: "alpha", api_key_id: "k-deribit-3" },
];

describe("deriveStrategyLinkedKeyIds — the shared manager-role discriminator (Phase 151 / AUM-04)", () => {
  it("covers BOTH link forms: the direct api_key_id column AND a strategy_keys row", () => {
    const covered = deriveStrategyLinkedKeyIds(
      [
        { id: "s1", api_key_id: "k1", status: "active" },
        // The composite: no direct column, reachable only via strategy_keys.
        { id: "s2", api_key_id: null, status: "private" },
      ],
      [{ strategy_id: "s2", api_key_id: "k2" }],
    );

    expect(covered.has("k1")).toBe(true);
    expect(covered.has("k2")).toBe(true);
    expect(covered.size).toBe(2);
  });

  it("archived is NOT coverage (W-4 ruling) — via either link form", () => {
    // Direct link to an archived strategy.
    const direct = deriveStrategyLinkedKeyIds(
      [{ id: "s1", api_key_id: "k1", status: "archived" }],
      [],
    );
    expect(direct.has("k1")).toBe(false);

    // Composite link to an archived strategy.
    const composite = deriveStrategyLinkedKeyIds(
      [{ id: "alpha", api_key_id: null, status: "archived" }],
      [{ strategy_id: "alpha", api_key_id: "k4" }],
    );
    expect(composite.has("k4")).toBe(false);

    // Controls: the byte-identical fixtures at a LIVE status ARE coverage —
    // without this pair both assertions above would also pass on an
    // implementation that ignored every strategy row.
    expect(
      deriveStrategyLinkedKeyIds(
        [{ id: "s1", api_key_id: "k1", status: "private" }],
        [],
      ).has("k1"),
    ).toBe(true);
    expect(
      deriveStrategyLinkedKeyIds(
        [{ id: "alpha", api_key_id: null, status: "private" }],
        [{ strategy_id: "alpha", api_key_id: "k4" }],
      ).has("k4"),
    ).toBe(true);
  });

  it("drops a strategy_keys row whose strategy_id is not in the live-strategy set", () => {
    // Defence in depth: the reads are owner-scoped, but a dangling link must
    // never suppress a key's allocator eligibility.
    const covered = deriveStrategyLinkedKeyIds(
      [{ id: "s1", api_key_id: null, status: "private" }],
      [{ strategy_id: "someone-elses", api_key_id: "k1" }],
    );

    expect(covered.has("k1")).toBe(false);
    expect(covered.size).toBe(0);
  });

  it("founder census: 6 of 8 keys are manager-side; the bybit + okx allocator keys are NOT", () => {
    const covered = deriveStrategyLinkedKeyIds(CENSUS_STRATEGIES, CENSUS_LINKS);

    expect(covered.size).toBe(6);
    expect([...covered].sort()).toEqual([
      "k-deribit-1",
      "k-deribit-2",
      "k-deribit-3",
      "k-mt5-1",
      "k-mt5-2",
      "k-mt5-3",
    ]);
    // The falsifier that matters for AUM-04: the allocator's own two keys must
    // survive the subtraction, or the book gate can never open.
    expect(covered.has("k-bybit")).toBe(false);
    expect(covered.has("k-okx")).toBe(false);
  });

  it("no drift: deriveStrategylessKeys still returns exactly the 2 bare census keys after the extraction", () => {
    // The extraction changed ZERO behavior for the /my-strategies consumer —
    // both views of "strategy-linked" now come from one join and cannot drift.
    const result = deriveStrategylessKeys(
      CENSUS_KEYS,
      CENSUS_STRATEGIES,
      CENSUS_LINKS,
    );

    expect(result.map((k) => k.id)).toEqual(["k-bybit", "k-okx"]);
  });
});
