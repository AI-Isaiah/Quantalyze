/**
 * Phase 167.2 review-fix round 1 (167.2-REVIEW WR-01): the discovery detail
 * page's fallback for a published strategy whose factsheet payload does not
 * build.
 *
 * WHY. The fallback used to promise that the full panel set "will render here"
 * once "the analytics service" finished "the first compute pass". That is a
 * promise the page cannot keep (a failed chain, or a series that cannot build,
 * never resolves on its own), and it names an internal pipeline to allocators,
 * which phase 164.2 criterion 9 forbids. KCS-10 removed the same sentence from
 * the v2 public lane; this page now says the SAME one sentence, imported from
 * the one place it is authored, so the two public surfaces cannot diverge again.
 *
 * The expected sentence is HAND-TYPED from 167.2-UI-SPEC.md § KCS-10 (KCS10-PUBLIC),
 * never imported: an import would make the oracle agree with whatever the
 * module says.
 *
 * Phase 169.1 plan 01 (D-26, D-81): the page now builds through the shared
 * `fetchAndBuildPayloadWithReason`, which reads the strategy row itself with
 * the service-role client. Every fake admin client below therefore also
 * answers that `strategies` read (`withStrategiesRead`), with the same row the
 * `getStrategyDetail` mock returns. The outage is captured by the shared
 * resolve stage now, not by the page, so the Sentry assertions pin THAT
 * capture's shape; what they pin is unchanged: exactly one event per outage,
 * with the code and the read named.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/sentry-capture", () => ({ captureToSentry: vi.fn() }));
vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw new Error("notFound");
  }),
  redirect: vi.fn(() => {
    throw new Error("redirect");
  }),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/queries", () => ({ getStrategyDetail: vi.fn() }));

import StrategyDetailPage from "./page";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getStrategyDetail } from "@/lib/queries";
import { captureToSentry } from "@/lib/sentry-capture";
import { DISCOVERY_CATEGORIES } from "@/lib/constants";

const STRATEGY_ID = "44444444-4444-4444-8444-444444444444";
const SLUG = DISCOVERY_CATEGORIES[0]!.slug;

/** Hand-typed from 167.2-UI-SPEC.md § KCS-10. */
const KCS10_PUBLIC = "The detailed factsheet for this strategy is not available yet.";

/**
 * Hand-typed, never imported (same rule as KCS10_PUBLIC above). 169-REVIEW-SFH
 * H-3: a failed read is not a row that is "not available yet"; the allocator is
 * told the load failed and how to retry, in the owner lane's unreadable voice
 * ("We could not read ...", "Reload this page to try again.").
 */
const READ_FAILED =
  "We could not load this strategy's factsheet right now. Reload this page to try again.";

/** Every string rendered anywhere in an RSC element tree, concatenated. */
/** The row the shared path's admin `strategies` read answers; set per case. */
let adminStrategyRow: Record<string, unknown> | null = null;

/** Set the `getStrategyDetail` answer AND the matching admin `strategies` row. */
function seedDetail(strategy: Record<string, unknown>, analytics: unknown, disclosureTier: unknown) {
  vi.mocked(getStrategyDetail).mockResolvedValue({ strategy, analytics, disclosureTier } as never);
  adminStrategyRow = { ...strategy, status: "published", strategy_analytics: analytics };
}

/**
 * Phase 169.1 plan 01: wrap a case's fake service-role client so it also
 * answers the shared path's `strategies` read (the row seeded above) and its
 * BTC read (an empty page: no stored history). Every other table is the
 * case's own fake.
 */
function withStrategiesRead(inner: { from: (table: string) => unknown }) {
  return {
    from: (table: string) => {
      if (table === "strategies") {
        const chain = {
          select: () => chain,
          eq: () => chain,
          maybeSingle: () => Promise.resolve({ data: adminStrategyRow, error: null }),
        };
        return chain;
      }
      if (table === "benchmark_prices") {
        const chain: Record<string, unknown> = {};
        for (const m of ["select", "eq", "gte", "lte", "lt", "gt", "order", "limit"]) chain[m] = () => chain;
        chain.then = (resolve: (v: unknown) => unknown) => resolve({ data: [], error: null });
        return chain;
      }
      return inner.from(table);
    },
  };
}

function textOf(node: unknown): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  const el = node as { props?: { children?: unknown } };
  return textOf(el.props?.children ?? null);
}

beforeEach(() => {
  vi.mocked(captureToSentry).mockClear();
  vi.mocked(createClient).mockResolvedValue({
    auth: { getUser: () => Promise.resolve({ data: { user: { id: "user-1" } } }) },
  } as never);
  vi.mocked(createAdminClient).mockReturnValue(
    withStrategiesRead({
      from: (table: string) => {
        throw new Error(`unexpected table ${table}`);
      },
    }) as never,
  );
  seedDetail(
    {
      id: STRATEGY_ID,
      name: "Synthetic Strategy",
      codename: null,
      disclosure_tier: "exploratory",
      strategy_types: ["trend"],
      markets: ["BTC"],
      description: null,
      subtypes: [],
      supported_exchanges: ["binance"],
      leverage_range: null,
      aum: null,
      max_capacity: null,
      avg_daily_turnover: null,
      start_date: null,
      benchmark: null,
      asset_class: "crypto",
      trust_tier: "api_verified",
      returns_denominator_config: null,
    },
    // No analytics row: the payload cannot build, so the fallback renders.
    null,
    "exploratory",
  );
});

describe("discovery page — the fallback when the factsheet payload does not build (WR-01)", () => {
  it("says the one KCS-10 sentence, and no timing, pipeline or computing claim", async () => {
    const jsx = await StrategyDetailPage({
      params: Promise.resolve({ slug: SLUG, strategyId: STRATEGY_ID }),
    });
    const text = textOf(jsx);
    expect(text).toContain(KCS10_PUBLIC);
    expect(text).not.toMatch(/still computing/i);
    expect(text).not.toMatch(/analytics service/i);
    expect(text).not.toMatch(/compute pass/i);
    expect(text).not.toMatch(/will render here/i);
    // No read failed here, so neither the read-failure line nor an alert.
    expect(text).not.toContain(READ_FAILED);
    expect(captureToSentry).not.toHaveBeenCalled();
  });
});

/**
 * Phase 169 (D-41 / R3): the composite reader now THROWS
 * `CompositeSeriesReadError` on a failed `csv_daily_returns` read instead of
 * folding it into an empty series. This page is dynamic and not cached, so it
 * answers that one request only: it catches that class and nothing else.
 *
 * 169-REVIEW-SFH H-3: the catch used to log to `console.error` only, which
 * never reaches Sentry (`src/instrumentation.ts` registers no console
 * integration), and it rendered the KCS-10 "not available yet" sentence, which
 * tells an allocator the row is not ready when in fact the read failed. It now
 * captures to Sentry with the code as a tag, and says the load failed. A
 * composite whose headline is untrusted (the reader returns null, no throw) is
 * a fact about the row and keeps KCS-10 with no alert: the case below pins that
 * the new line and the outage capture fire on the outage branch only.
 *
 * Since 169.1 D-81 the shared resolve stage, not the page, answers the throw
 * (`read_error`) and captures it, once; the page maps the reason to the line.
 */
describe("discovery page — a composite's csv_daily_returns read outage (169 D-41)", () => {
  const FULL_CASH = {
    cumulative_return: 0.05,
    volatility: 0.12,
    max_drawdown: -0.04,
    cagr: 0.31,
    sharpe: 1.4,
    sortino: 2.1,
    calmar: 3.0,
  };

  /** Re-seed the detail read as a published composite with a valid headline. */
  async function seedComposite() {
    const base = (await vi.mocked(getStrategyDetail).getMockImplementation()?.(STRATEGY_ID, SLUG)) as {
      strategy: unknown;
      disclosureTier: unknown;
    };
    seedDetail(
      base.strategy as Record<string, unknown>,
      {
        computed_at: "2026-09-01T00:00:00Z",
        computation_status: "complete",
        daily_returns: null,
        returns_series: null,
        data_quality_flags: { composite: true },
        metrics_json_by_basis: { cash_settlement: FULL_CASH },
      },
      base.disclosureTier,
    );
  }

  /** The service-role client: the csv read answers with a failed read. */
  function csvOutageAdmin() {
    const chain = {
      select: () => chain,
      eq: () => chain,
      order: () => chain,
      limit: () => Promise.resolve({ data: null, error: { message: "synthetic statement timeout", code: "57014" } }),
    };
    return withStrategiesRead({ from: () => chain });
  }

  /**
   * The service-role client: the csv read succeeds with rows.
   *
   * 169 review round 1 (CSV-READ-CAP): the reader pages by a date keyset. Each
   * page after the first adds `.gt("date", cursor)`, and the read stops only on
   * an empty page. So this fake honours the cursor, as the one in
   * `v2/page.composite-read-error.test.tsx` does. A fake that ignores it
   * re-serves the first page, which the reader correctly refuses as
   * `page_order`, an outage this case is not about.
   */
  function csvRowsAdmin() {
    const rows = [
      { date: "2026-08-01", daily_return: 0.01 },
      { date: "2026-08-02", daily_return: -0.005 },
      { date: "2026-08-03", daily_return: 0.002 },
    ];
    return withStrategiesRead({
      from: () => {
        let after: string | null = null;
        const chain = {
          select: () => chain,
          eq: () => chain,
          gt: (_column: string, value: string) => {
            after = value;
            return chain;
          },
          order: () => chain,
          limit: () =>
            Promise.resolve({ data: rows.filter((r) => after === null || r.date > after), error: null }),
        };
        return chain;
      },
    });
  }

  it("says the load failed, never KCS-10, and does not throw", async () => {
    await seedComposite();
    vi.mocked(createAdminClient).mockReturnValue(csvOutageAdmin() as never);
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const jsx = await StrategyDetailPage({
        params: Promise.resolve({ slug: SLUG, strategyId: STRATEGY_ID }),
      });
      const text = textOf(jsx);
      expect(text).toContain(READ_FAILED);
      expect(text).not.toContain(KCS10_PUBLIC);
      expect(text).not.toContain("\u2014");
      // The console line stays (the helper's contract: the caller logs, Sentry
      // is additive), with the code.
      expect(errSpy).toHaveBeenCalledWith(
        expect.stringContaining("csv_daily_returns"),
        expect.objectContaining({ errorCode: "57014" }),
      );
    } finally {
      errSpy.mockRestore();
      warnSpy.mockRestore();
    }
  });

  it("reports the outage to Sentry once, with the code as a tag", async () => {
    await seedComposite();
    vi.mocked(createAdminClient).mockReturnValue(csvOutageAdmin() as never);
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await StrategyDetailPage({
        params: Promise.resolve({ slug: SLUG, strategyId: STRATEGY_ID }),
      });
      // Exactly once: the shared resolve stage captures a build's outage
      // (`seriesReadError`), and the page adds no second event (169.1 D-81).
      expect(captureToSentry).toHaveBeenCalledTimes(1);
      const [captured, options] = vi.mocked(captureToSentry).mock.calls[0]!;
      expect(captured).toBeInstanceOf(Error);
      expect((captured as Error).message).toBe("factsheet resolve: csv_daily_returns read failed (57014)");
      expect(options.tags).toEqual({
        stage: "factsheet-resolve",
        caller: "build",
        reason: "read_error",
        code: "57014",
        strategy_id: STRATEGY_ID,
        read: "csv_daily_returns",
      });
      // The PostgREST message rides on the event too (169-REVIEW-SFH L-2: an
      // event carrying only the code says "(none)" for a network failure and
      // nothing more).
      expect(options.extra).toEqual({ errorMessage: "synthetic statement timeout" });
    } finally {
      errSpy.mockRestore();
      warnSpy.mockRestore();
    }
  });

  it("an untrusted composite headline (no outage) keeps KCS-10 and raises no outage alert", async () => {
    const base = (await vi.mocked(getStrategyDetail).getMockImplementation()?.(STRATEGY_ID, SLUG)) as {
      strategy: unknown;
      disclosureTier: unknown;
    };
    seedDetail(
      base.strategy as Record<string, unknown>,
      {
        computed_at: "2026-09-01T00:00:00Z",
        computation_status: "complete",
        daily_returns: null,
        returns_series: null,
        data_quality_flags: { composite: true },
        // No cash_settlement headline: the reader returns null, it does not throw.
        metrics_json_by_basis: {},
      },
      base.disclosureTier,
    );
    vi.mocked(createAdminClient).mockReturnValue(csvRowsAdmin() as never);
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const jsx = await StrategyDetailPage({
        params: Promise.resolve({ slug: SLUG, strategyId: STRATEGY_ID }),
      });
      const text = textOf(jsx);
      expect(text).toContain(KCS10_PUBLIC);
      expect(text).not.toContain(READ_FAILED);
      // No outage event. The one event is the shared resolve stage's
      // warning-level record of a composite that cannot build (167.2.1 SFH
      // H-1), which every lane of the shared path raises for this row since
      // 169.1 D-26 put this page on it; it is not a read_error alert.
      expect(captureToSentry).toHaveBeenCalledTimes(1);
      const [, options] = vi.mocked(captureToSentry).mock.calls[0]!;
      expect(options.level).toBe("warning");
      expect(options.tags).toEqual({
        stage: "factsheet-resolve-composite",
        caller: "build",
        gate: "headline",
        strategy_id: STRATEGY_ID,
      });
    } finally {
      errSpy.mockRestore();
      warnSpy.mockRestore();
    }
  });

  it("any other throw from the composite read still propagates", async () => {
    await seedComposite();
    vi.mocked(createAdminClient).mockReturnValue(
      withStrategiesRead({
        from: () => {
          throw new Error("synthetic unexpected failure");
        },
      }) as never,
    );
    await expect(
      StrategyDetailPage({ params: Promise.resolve({ slug: SLUG, strategyId: STRATEGY_ID }) }),
    ).rejects.toThrow("synthetic unexpected failure");
    expect(captureToSentry).not.toHaveBeenCalled();
  });
});

/**
 * Phase 169 review round 1, T5 (from T1's handoff). The single-key arm calls
 * `readSingleKeyBasisOpts`, which since T1 (WR-05 / M-3) THROWS
 * `CompositeSeriesReadError` on a failed MTM, smoothed MTM or stored cash
 * series read. Uncaught, that reached this page's error boundary: an options
 * strategy's detail page broke on one timeout, and no alert named the read.
 * It was then caught exactly as the composite arm caught it; since 169.1 D-81
 * the shared resolve stage answers it `read_error` and captures it once.
 *
 * The same call now receives the strategy's `returns_denominator_config`
 * (SFH H-2 / M-2), so a `simple` single-key row draws the arithmetic curve its
 * stored headline was computed on, and the leverage what-if is withheld on it,
 * as the factsheet route already does.
 */
describe("discovery page — the single-key arm's series reads and returns convention (169 review T5)", () => {
  /** 40 dated daily returns, alternating +2% / -2%: Σr and Π(1+r) diverge. */
  const DAILY = Array.from({ length: 40 }, (_, i) => ({
    date: new Date(Date.UTC(2026, 6, 1 + i)).toISOString().slice(0, 10),
    value: i % 2 === 0 ? 0.02 : -0.02,
  }));

  async function seedSingleKey(opts: { metricsJsonByBasis: unknown; config: unknown }) {
    const base = (await vi.mocked(getStrategyDetail).getMockImplementation()?.(STRATEGY_ID, SLUG)) as unknown as {
      strategy: Record<string, unknown>;
      disclosureTier: unknown;
    };
    seedDetail(
      { ...base.strategy, returns_denominator_config: opts.config },
      {
        computed_at: "2026-09-01T00:00:00Z",
        computation_status: "complete",
        daily_returns: DAILY,
        returns_series: null,
        data_quality_flags: {},
        metrics_json_by_basis: opts.metricsJsonByBasis,
        // The seven persisted headline scalars the shared path's admin embed
        // carries (Phase 169 SC4, D-10): a rankable row overlays them.
        cumulative_return: 0.0,
        volatility: 0.3,
        max_drawdown: -0.04,
        cagr: 0.0,
        sharpe: 0.1,
        sortino: 0.2,
        calmar: 0.0,
      },
      base.disclosureTier,
    );
  }

  /** The service-role client: every `strategy_analytics_series` read fails. */
  function seriesOutageAdmin() {
    return withStrategiesRead({
      from: (table: string) => {
        if (table !== "strategy_analytics_series") throw new Error(`unexpected table ${table}`);
        const chain = {
          select: () => chain,
          eq: () => chain,
          maybeSingle: () =>
            Promise.resolve({ data: null, error: { message: "synthetic statement timeout", code: "57014" } }),
        };
        return chain;
      },
    });
  }

  /** The FactsheetView element's payload prop, or null when the fallback rendered. */
  function findPayload(node: unknown): Record<string, unknown> | null {
    if (node == null || typeof node !== "object") return null;
    if (Array.isArray(node)) {
      for (const child of node) {
        const hit = findPayload(child);
        if (hit) return hit;
      }
      return null;
    }
    const el = node as { props?: { payload?: unknown; children?: unknown } };
    if (el.props?.payload != null) return el.props.payload as Record<string, unknown>;
    return findPayload(el.props?.children ?? null);
  }

  it("an MTM series read outage says the load failed, captures once with the read named, and does not throw", async () => {
    await seedSingleKey({
      metricsJsonByBasis: { mark_to_market: { cumulative_return: 0.01 } },
      config: null,
    });
    vi.mocked(createAdminClient).mockReturnValue(seriesOutageAdmin() as never);
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const jsx = await StrategyDetailPage({
        params: Promise.resolve({ slug: SLUG, strategyId: STRATEGY_ID }),
      });
      const text = textOf(jsx);
      expect(findPayload(jsx), "a payload was built without the MTM series it names").toBeNull();
      expect(text).toContain(READ_FAILED);
      expect(text).not.toContain(KCS10_PUBLIC);
      // Once, by the shared resolve stage (169.1 D-81), with the read named.
      expect(captureToSentry).toHaveBeenCalledTimes(1);
      const [captured, options] = vi.mocked(captureToSentry).mock.calls[0]!;
      expect((captured as Error).message).toBe("factsheet resolve: mtm_daily_returns read failed (57014)");
      expect(options.tags).toEqual({
        stage: "factsheet-resolve",
        caller: "build",
        reason: "read_error",
        code: "57014",
        strategy_id: STRATEGY_ID,
        read: "mtm_daily_returns",
      });
      expect(options.extra).toEqual({ errorMessage: "synthetic statement timeout" });
    } finally {
      errSpy.mockRestore();
      warnSpy.mockRestore();
    }
  });

  it("any other throw from the single-key read still propagates", async () => {
    await seedSingleKey({
      metricsJsonByBasis: { mark_to_market: { cumulative_return: 0.01 } },
      config: null,
    });
    vi.mocked(createAdminClient).mockReturnValue(
      withStrategiesRead({
        from: () => {
          throw new Error("synthetic unexpected failure");
        },
      }) as never,
    );
    await expect(
      StrategyDetailPage({ params: Promise.resolve({ slug: SLUG, strategyId: STRATEGY_ID }) }),
    ).rejects.toThrow("synthetic unexpected failure");
    expect(captureToSentry).not.toHaveBeenCalled();
  });

  it("a `simple` returns_denominator_config draws the arithmetic curve and withholds the leverage what-if", async () => {
    await seedSingleKey({ metricsJsonByBasis: null, config: { cumulative_method: "simple" } });
    // 169.1 SFH HIGH-1: a build reads the `cash_settlement` conventions echo,
    // and a FAILED read is now captured. The default double throws on that
    // table, so it answers here as a real empty read (no echo row, a fact), and
    // the config tier decides without an outage in play.
    vi.mocked(createAdminClient).mockReturnValue(
      withStrategiesRead({
        from: (table: string) => {
          if (table !== "strategy_analytics_series") throw new Error(`unexpected table ${table}`);
          const chain: Record<string, unknown> = {};
          chain.select = () => chain;
          chain.eq = () => chain;
          chain.maybeSingle = () => Promise.resolve({ data: null, error: null });
          return chain;
        },
      }) as never,
    );
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const payload = findPayload(
        await StrategyDetailPage({ params: Promise.resolve({ slug: SLUG, strategyId: STRATEGY_ID }) }),
      );
      expect(payload).not.toBeNull();
      expect((payload!.dataQuality as { returnsConventionOverride?: unknown }).returnsConventionOverride).toBe(true);
      // Arithmetic: the curve ends at 1 + Σr = 1 exactly (20 × +2% and 20 × -2%).
      // Geometric would end at (1.02 × 0.98)^20 ≈ 0.99203.
      const equity = payload!.strategyEquity as number[];
      expect(equity[equity.length - 1]).toBeCloseTo(1, 12);
      expect(captureToSentry).not.toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("CONTROL: with no returns_denominator_config the curve is geometric and no override is flagged", async () => {
    await seedSingleKey({ metricsJsonByBasis: null, config: null });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const payload = findPayload(
        await StrategyDetailPage({ params: Promise.resolve({ slug: SLUG, strategyId: STRATEGY_ID }) }),
      );
      expect(payload).not.toBeNull();
      expect((payload!.dataQuality as { returnsConventionOverride?: unknown } | undefined)?.returnsConventionOverride).toBeUndefined();
      const equity = payload!.strategyEquity as number[];
      expect(equity[equity.length - 1]).toBeCloseTo(Math.pow(1.02 * 0.98, 20), 12);
    } finally {
      warnSpy.mockRestore();
    }
  });
});
