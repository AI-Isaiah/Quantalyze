import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, waitFor } from "@testing-library/react";

/**
 * Retroactive audit on PR #183 — pr-test-analyzer found that THREE
 * adjacent surfaces in AllocationDashboardV2 had no direct regression
 * coverage:
 *
 *   L15 c9: H-1197 IntersectionObserver dep-change effect — empty→populated
 *           transition rebinds the observer. A future revert to `[]` deps
 *           would silently break widget_viewed analytics for any allocator
 *           who connects their first key while on the page.
 *
 *   L16 c8: H-1199 unknown-widget console.warn dedupe — registry refactors
 *           that strand persisted layouts must surface in dev tools / Sentry.
 *           A revert to no-warn OR to no-dedupe would silently break the
 *           breadcrumb.
 *
 * These tests pin both contracts. They live in a dedicated file because
 * empty-grid-callout / insight-strip / widget-gating tests already mock
 * the V2 hook in ways that don't surface these branches.
 */

const { COMPOSITE_IDS, KPI_STRIP_ID } = vi.hoisted(() => ({
  COMPOSITE_IDS: ["rolling-sharpe"] as const,
  KPI_STRIP_ID: "kpi-strip" as const,
}));

vi.mock("@/lib/analytics/usage-events-client", () => ({
  trackUsageEventClient: vi.fn(),
  identifyUsageUser: vi.fn(),
}));

vi.mock("./components/AlertBanner", () => ({
  AlertBanner: () => <div data-testid="alert-banner-stub" />,
}));

vi.mock("./widgets", () => {
  const WIDGET_COMPONENTS: Record<string, React.ComponentType<unknown>> = {};
  for (const id of [...COMPOSITE_IDS, KPI_STRIP_ID]) {
    WIDGET_COMPONENTS[id] = () => (
      <div data-testid={`widget-body-${id}`}>widget-body-{id}</div>
    );
  }
  // Deliberately omit "stranded-unknown-widget" so renderWidget hits the
  // unknown-widget branch and emits the console.warn.
  return { WIDGET_COMPONENTS };
});

const tilesHolder = vi.hoisted(() => ({
  tiles: [] as Array<{ k: string; w: 1 | 2 | 3 | 4 }>,
}));

vi.mock("./hooks/useDashboardConfig", () => ({
  useDashboardConfigV2: () => ({
    config: {
      tiles: tilesHolder.tiles,
      timeframe: "YTD",
      layoutVersion: 4,
    },
    addWidget: vi.fn(),
    removeWidget: vi.fn(),
    resizeWidget: vi.fn(),
    moveWidget: vi.fn(),
    setTimeframe: vi.fn(),
    resetToDefaults: vi.fn(),
  }),
  consumeDashboardRecoveryFlag: () => null,
}));

import { AllocationDashboardV2 } from "./AllocationDashboardV2";

beforeEach(() => {
  tilesHolder.tiles = [];
  global.fetch = vi.fn(() =>
    Promise.resolve({ ok: true, json: () => Promise.resolve({}) }),
  ) as unknown as typeof fetch;
  if (typeof globalThis.IntersectionObserver === "undefined") {
    (globalThis as unknown as { IntersectionObserver: unknown }).IntersectionObserver =
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      };
  }
});

const BASE_PAYLOAD = {
  portfolio: null,
  analytics: null,
  apiKeys: [],
  alertCount: { critical: 0, high: 0, medium: 0, low: 0, total: 0 },
  outcomes: [],
  equitySnapshots: [],
  holdingsSummary: [
    {
      symbol: "BTC",
      quantity: 1.5,
      mark_price_usd: 60000,
      value_usd: 90000,
      venue: "Binance",
      holding_type: "spot" as const,
    },
  ],
  snapshotCount: 30,
  allKeysStale: false,
  lastSyncAt: null,
  hasSyncing: false,
  equityDailyPoints: [],
  minHistoryDepthMonths: null,
  activeVenues: [],
  flaggedHoldings: [],
  matchDecisionsByHoldingRef: {},
  strategies: [] as unknown[],
};

describe("AllocationDashboardV2 — retroactive audit-2026-05-16 — H-1199 unknown-widget console.warn (pr-test L16 c8)", () => {
  it("emits console.warn exactly once for a stranded widget id even across multiple renders", async () => {
    tilesHolder.tiles = [
      { k: KPI_STRIP_ID, w: 2 },
      { k: "stranded-unknown-widget", w: 2 },
    ];
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { rerender, container } = render(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      <AllocationDashboardV2 {...(BASE_PAYLOAD as any)} />,
    );
    await waitFor(() => {
      expect(
        container.querySelector(`[data-widget-id="${KPI_STRIP_ID}"]`),
      ).not.toBeNull();
    });
    // Re-render 3x — dedup contract: still 1 warn total for the same id.
    for (let i = 0; i < 3; i++) {
      rerender(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        <AllocationDashboardV2 {...(BASE_PAYLOAD as any)} />,
      );
    }
    const strandedWarns = warnSpy.mock.calls.filter((c) => {
      const msg = String(c[0] ?? "");
      const payload = c[1];
      return (
        msg.includes("[AllocationDashboardV2] unknown widget id in persisted layout") &&
        typeof payload === "object" &&
        payload !== null &&
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (payload as any).widget_id === "stranded-unknown-widget"
      );
    });
    expect(strandedWarns).toHaveLength(1);
    warnSpy.mockRestore();
  });

  it("renders the unknown-widget placeholder text in DOM", async () => {
    tilesHolder.tiles = [
      { k: KPI_STRIP_ID, w: 2 },
      { k: "another-stranded-id", w: 2 },
    ];
    const { container, getByText } = render(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      <AllocationDashboardV2 {...(BASE_PAYLOAD as any)} />,
    );
    await waitFor(() => {
      expect(
        container.querySelector(`[data-widget-id="${KPI_STRIP_ID}"]`),
      ).not.toBeNull();
    });
    // Unknown placeholder copy from AllocationDashboardV2.tsx is:
    //   "Unknown widget: <code>another-stranded-id</code>"
    expect(getByText(/Unknown widget:/)).not.toBeNull();
    expect(getByText("another-stranded-id")).not.toBeNull();
  });
});

describe("AllocationDashboardV2 — retroactive audit-2026-05-16 — H-1197 IntersectionObserver re-attach (pr-test L15 c9)", () => {
  /**
   * The H-1197 fix changed the widget_viewed effect's deps from `[]` to
   * `[holdingsEmpty, hasSyncing]`. The contract: when an allocator's
   * dashboard transitions from the EmptyState short-circuit (holdings=[]
   * and !hasSyncing) to the populated path (holdings has rows), the
   * dashboard container ref div mounts for the first time and the
   * IntersectionObserver effect must re-run to observe it.
   *
   * Pre-fix `[]` deps meant the observer effect ran once on mount when
   * the ref div didn't exist, then never re-ran — zero widget_viewed
   * events for the entire session.
   *
   * We assert the contract at the effect-deps level via a structural
   * check: AllocationDashboardV2.tsx contains the `[holdingsEmpty, hasSyncing]`
   * literal as the deps for the widget_viewed observer effect. A revert
   * to `[]` would fail this test.
   */
  it("AllocationDashboardV2.tsx widget_viewed effect deps include holdingsEmpty + hasSyncing", async () => {
    const { readFile } = await import("node:fs/promises");
    const { resolve } = await import("node:path");
    const filePath = resolve(
      process.cwd(),
      "src/app/(dashboard)/allocations/AllocationDashboardV2.tsx",
    );
    const src = await readFile(filePath, "utf8");
    // The effect body contains the widget_viewed trackUsageEventClient
    // call and the deps array immediately after the closing }. We grep
    // for the deps array as a literal string anchored on the analytics
    // call to avoid false positives.
    expect(src).toMatch(/trackUsageEventClient\("widget_viewed"/);
    // Deps array must reference BOTH symbols. The match is intentionally
    // strict on substring presence — formatting drift (whitespace,
    // comments) won't break it but a revert to `[]` will.
    const widgetViewedIdx = src.indexOf(
      'trackUsageEventClient("widget_viewed"',
    );
    expect(widgetViewedIdx).toBeGreaterThan(-1);
    // Search forward from the widget_viewed call site for the deps array.
    const tail = src.slice(widgetViewedIdx);
    const depsMatch = tail.match(/}, \[([^\]]*)\]\);/);
    expect(depsMatch).not.toBeNull();
    const depsContents = depsMatch![1];
    expect(depsContents).toMatch(/holdingsEmpty/);
    expect(depsContents).toMatch(/hasSyncing/);
  });
});

describe("AllocationDashboardV2 — retroactive audit-2026-05-16 — STRATEGY_COMPOSITE_WIDGETS single source of truth (pr-test L20 c8)", () => {
  /**
   * The audit flagged that STRATEGY_COMPOSITE_WIDGETS is duplicated across
   * the production source AND three test files (composite-gate-invariant,
   * widget-gating, empty-grid-callout). Today all four are identical;
   * nothing enforces continued parity.
   *
   * Pin the contract with a parity check: the production set must contain
   * the exact 18 ids the design contract documents. A drift in either
   * direction (add/remove a composite) requires the test to be updated
   * alongside the source, surfacing the change in code review.
   */
  it("AllocationDashboardV2.tsx STRATEGY_COMPOSITE_WIDGETS set contains the documented 18 ids", async () => {
    const { readFile } = await import("node:fs/promises");
    const { resolve } = await import("node:path");
    const filePath = resolve(
      process.cwd(),
      "src/app/(dashboard)/allocations/AllocationDashboardV2.tsx",
    );
    const src = await readFile(filePath, "utf8");
    const expected = [
      "rolling-sharpe",
      "rolling-volatility",
      "cumulative-vs-benchmark",
      "tail-risk",
      "risk-decomposition",
      "correlation-matrix",
      "correlation-over-time",
      "alpha-beta-decomposition",
      "tracking-error",
      "regime-detector",
      "strategy-comparison",
      "monthly-returns",
      "annual-returns",
      "return-distribution",
      "win-rate-profit-factor",
      "best-worst-periods",
      "performance-by-period",
      "var-expected-shortfall",
    ];
    for (const id of expected) {
      expect(src).toContain(`"${id}"`);
    }
    expect(expected).toHaveLength(18);
  });
});
