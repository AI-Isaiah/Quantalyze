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
  vi.mocked(getStrategyDetail).mockResolvedValue({
    strategy: {
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
    analytics: null,
    disclosureTier: "exploratory",
  } as never);
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
 * the new line and the capture fire on the outage branch only.
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
    const base = (await vi.mocked(getStrategyDetail).getMockImplementation()?.(STRATEGY_ID, SLUG, "discovery")) as {
      strategy: unknown;
      disclosureTier: unknown;
    };
    vi.mocked(getStrategyDetail).mockResolvedValue({
      strategy: base.strategy,
      analytics: {
        computed_at: "2026-09-01T00:00:00Z",
        computation_status: "complete",
        daily_returns: null,
        returns_series: null,
        data_quality_flags: { composite: true },
        metrics_json_by_basis: { cash_settlement: FULL_CASH },
      },
      disclosureTier: base.disclosureTier,
    } as never);
  }

  /** The service-role client: the csv read answers with a failed read. */
  function csvOutageAdmin() {
    const chain = {
      select: () => chain,
      eq: () => chain,
      order: () => chain,
      limit: () => Promise.resolve({ data: null, error: { message: "synthetic statement timeout", code: "57014" } }),
    };
    return { from: () => chain };
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
    return {
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
    };
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
      expect(captureToSentry).toHaveBeenCalledTimes(1);
      const [captured, options] = vi.mocked(captureToSentry).mock.calls[0]!;
      // The reader's own error is sent, so the PostgREST message rides as its
      // `cause` (169-REVIEW-SFH L-2: an event carrying only the code says
      // "(none)" for a network failure and nothing more).
      expect(captured).toBeInstanceOf(Error);
      expect((captured as Error).name).toBe("CompositeSeriesReadError");
      expect((captured as Error).cause).toBe("synthetic statement timeout");
      expect(options.level).toBe("error");
      expect(options.tags).toEqual({
        route: "discovery/strategy-detail",
        stage: "composite-read",
        reason: "read_error",
        code: "57014",
        strategy_id: STRATEGY_ID,
        read: "csv_daily_returns",
      });
    } finally {
      errSpy.mockRestore();
      warnSpy.mockRestore();
    }
  });

  it("an untrusted composite headline (no outage) keeps KCS-10 and raises no alert", async () => {
    const base = (await vi.mocked(getStrategyDetail).getMockImplementation()?.(STRATEGY_ID, SLUG, "discovery")) as {
      strategy: unknown;
      disclosureTier: unknown;
    };
    vi.mocked(getStrategyDetail).mockResolvedValue({
      strategy: base.strategy,
      analytics: {
        computed_at: "2026-09-01T00:00:00Z",
        computation_status: "complete",
        daily_returns: null,
        returns_series: null,
        data_quality_flags: { composite: true },
        // No cash_settlement headline: the reader returns null, it does not throw.
        metrics_json_by_basis: {},
      },
      disclosureTier: base.disclosureTier,
    } as never);
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
      expect(captureToSentry).not.toHaveBeenCalled();
    } finally {
      errSpy.mockRestore();
      warnSpy.mockRestore();
    }
  });

  it("any other throw from the composite read still propagates", async () => {
    await seedComposite();
    vi.mocked(createAdminClient).mockReturnValue({
      from: () => {
        throw new Error("synthetic unexpected failure");
      },
    } as never);
    await expect(
      StrategyDetailPage({ params: Promise.resolve({ slug: SLUG, strategyId: STRATEGY_ID }) }),
    ).rejects.toThrow("synthetic unexpected failure");
    expect(captureToSentry).not.toHaveBeenCalled();
  });
});
