/**
 * SR-3 (v0.17.1.4) — `/strategy/[id]/v2/page.tsx` notFound() contract.
 *
 * The v2 page is an async Server Component that calls Supabase via
 * `getStrategyDetailV2`. Mounting it in jsdom is awkward (mirrors the v1
 * page.test.tsx convention). Instead this test exercises the
 * server-component CONTRACT directly:
 *
 *   1. When `getStrategyDetailV2` returns null (strategy missing /
 *      unpublished / RLS-denied), the page MUST invoke `notFound()`.
 *   2. When it returns a result, the page MUST NOT call `notFound()`
 *      and MUST pass `detail` through to <StrategyV2Shell>.
 *
 * Both signals matter — without #1, RLS leaks would 200 with a half-rendered
 * shell; without #2, a single unmocked branch could silently 404 every
 * request.
 *
 * `notFound()` from next/navigation throws a sentinel error to short-circuit
 * the render; we mock it to throw a recognizable Error so the test can
 * assert the call site without needing the full Next.js runtime.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock notFound so we can detect invocation without invoking the real
// Next.js error-boundary machinery.
const NOT_FOUND_SENTINEL = "NEXT_NOT_FOUND";
const notFoundSpy = vi.fn(() => {
  throw new Error(NOT_FOUND_SENTINEL);
});

vi.mock("next/navigation", () => ({
  notFound: () => notFoundSpy(),
}));

// Mock the data fetcher — each test seeds the response.
const detailSpy = vi.fn();
vi.mock("@/lib/queries", () => ({
  getStrategyDetailV2: (...args: unknown[]) => detailSpy(...args),
}));

// Mock the shell so the test isn't sensitive to the full 7-panel render.
vi.mock("@/components/strategy-v2/StrategyV2Shell", () => ({
  StrategyV2Shell: ({ detail }: { detail: { strategy: { id: string } } }) => (
    <div data-testid="v2-shell" data-strategy-id={detail.strategy.id} />
  ),
}));

// Phase 170.5 plan 06 (D-07): the composite builder path is mocked; composite-joint.test.ts
// owns its behaviour. The page test pins only WHEN the page calls it.
// composite-joint.ts is `server-only` and imports the admin-backed builder; neither is
// under test here, so both are stubbed and only `withV2Joint` (pure) stays real.
vi.mock("server-only", () => ({}));
vi.mock("@/lib/factsheet/fetch-and-build-payload", () => ({
  fetchAndBuildPayloadWithReason: vi.fn(),
}));
const compositeSpy = vi.fn();
vi.mock("./composite-joint", async (importActual) => ({
  ...(await importActual<typeof import("./composite-joint")>()),
  readCompositeV2Joint: (...args: unknown[]) => compositeSpy(...args),
}));

import StrategyV2Page, { generateMetadata } from "./page";

describe("/strategy/[id]/v2/page.tsx — SR-3 notFound contract", () => {
  beforeEach(() => {
    notFoundSpy.mockClear();
    detailSpy.mockReset();
    compositeSpy.mockReset();
  });

  it("Test 1: getStrategyDetailV2 returning null invokes notFound()", async () => {
    detailSpy.mockResolvedValueOnce(null);

    await expect(
      StrategyV2Page({ params: Promise.resolve({ id: "missing-id" }) }),
    ).rejects.toThrow(NOT_FOUND_SENTINEL);

    expect(detailSpy).toHaveBeenCalledWith("missing-id");
    expect(notFoundSpy).toHaveBeenCalledTimes(1);
  });

  it("Test 2: a populated result does NOT invoke notFound()", async () => {
    detailSpy.mockResolvedValueOnce({
      strategy: { id: "abc-123", name: "Stellar L/S", start_date: "2024-01-01" },
      panel1: {
        supported_exchanges: [],
        strategy_types: [],
        subtypes: [],
        markets: [],
        leverage_range: null,
        avg_daily_turnover: null,
      },
      panel2Headline: {},
      panel2Equity: { series: null, btc_overlay: null },
      panel3: { drawdown_series: null, drawdown_episodes: null },
      panel4Inputs: {
        monthly_returns: null,
        return_quantiles: null,
        returns_series: null,
        benchmark_returns: null,
      },
      panel5Inputs: { rolling_metrics: null, sharpe: null },
      panel6Inputs: { trade_metrics: null, data_quality_flags: null },
      panel7Inputs: {
        benchmark_greeks: { alpha: null, beta: null, ir: null, treynor: null },
        correlation_analytics: { returns_series: null, metrics_json: null },
      },
      lazyKeys: ["panel4", "panel5", "panel6", "panel7"],
      history_days: 0,
    });

    const result = await StrategyV2Page({
      params: Promise.resolve({ id: "abc-123" }),
    });

    expect(result).toBeTruthy();
    expect(notFoundSpy).not.toHaveBeenCalled();
    expect(detailSpy).toHaveBeenCalledWith("abc-123");
  });
});

/**
 * Phase 170.5 plan 06 Task 2 (D-07): a composite's light-path answer is
 * `needs_builder`; the page resolves it through the factsheet builder before the
 * shell renders. Pre-170.5 the page never called a builder, so a composite's
 * greeks were whatever the stored blob said.
 */
describe("/strategy/[id]/v2/page.tsx - composite builder path (Phase 170.5 D-07)", () => {
  const JOINT = {
    values: { alpha: 0.1, beta: 0.2, correlation: 0.3, ir: 0.4, treynor: 0.5 },
    status: { kind: "computed", paired: 90, flatLeg: false },
  };
  function detailWith(joint: unknown) {
    return {
      strategy: { id: "comp-1", name: "Composite", start_date: "2024-01-01" },
      panel7Inputs: {
        benchmark_greeks: { alpha: null, beta: null, ir: null, treynor: null },
        benchmark_joint: joint,
        correlation_analytics: { returns_series: null, metrics_json: null },
      },
    };
  }
  /** Find the shell element's `detail` prop in the returned tree. */
  function shellDetail(tree: unknown): { panel7Inputs: Record<string, unknown> } {
    const found: unknown[] = [];
    const walk = (n: unknown): void => {
      if (!n || typeof n !== "object") return;
      const el = n as { props?: { detail?: unknown; children?: unknown } };
      if (el.props?.detail) found.push(el.props.detail);
      const c = el.props?.children;
      if (Array.isArray(c)) c.forEach(walk);
      else walk(c);
    };
    walk(tree);
    return found[0] as { panel7Inputs: Record<string, unknown> };
  }

  beforeEach(() => {
    notFoundSpy.mockClear();
    detailSpy.mockReset();
    compositeSpy.mockReset();
  });

  it("needs_builder: readCompositeV2Joint is called once with the id and the shell receives the merged detail", async () => {
    detailSpy.mockResolvedValueOnce(detailWith({ kind: "needs_builder" }));
    compositeSpy.mockResolvedValueOnce(JOINT);
    const tree = await StrategyV2Page({ params: Promise.resolve({ id: "comp-1" }) });
    expect(compositeSpy).toHaveBeenCalledTimes(1);
    expect(compositeSpy).toHaveBeenCalledWith("comp-1");
    const detail = shellDetail(tree);
    expect(detail.panel7Inputs.benchmark_greeks).toEqual(JOINT.values);
    expect(detail.panel7Inputs.benchmark_joint).toEqual(JOINT.status);
  });

  it("a computed light-path answer does not call the builder", async () => {
    detailSpy.mockResolvedValueOnce(
      detailWith({ kind: "computed", paired: 50, flatLeg: false }),
    );
    await StrategyV2Page({ params: Promise.resolve({ id: "comp-1" }) });
    expect(compositeSpy).not.toHaveBeenCalled();
  });

  it("generateMetadata never calls the builder", async () => {
    detailSpy.mockResolvedValueOnce(detailWith({ kind: "needs_builder" }));
    await generateMetadata({ params: Promise.resolve({ id: "comp-1" }) });
    expect(compositeSpy).not.toHaveBeenCalled();
  });
});
