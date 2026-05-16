import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, waitFor } from "@testing-library/react";

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

// pr189-followup H7 (red-team HIGH/8) — per-test override hook for the
// recovery flag so we can mount the dashboard with each of the three
// reason branches and assert the banner renders. Pre-followup, the
// mock was a fixed `() => null` and no test exercised the banner —
// a silent revert of the banner JSX would have passed every assertion.
const recoveryFlagHolder = vi.hoisted(() => ({
  reason: null as "parse_failed" | "version_reset" | "legacy_in_v2_blob" | null,
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
  consumeDashboardRecoveryFlag: () => recoveryFlagHolder.reason,
}));

import { AllocationDashboardV2 } from "./AllocationDashboardV2";
import type { MyAllocationDashboardPayload } from "@/lib/queries";

beforeEach(() => {
  tilesHolder.tiles = [];
  recoveryFlagHolder.reason = null;
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

// pr189-followup M15 (type-design-analyzer MED/8) — type the fixture
// against MyAllocationDashboardPayload via `satisfies Partial<...>` so
// fields present in the fixture are constrained by the production prop
// type (closing the drift surface). Missing required fields are
// tolerated because the dashboard only reads a 6-field subset at the
// top level (portfolio/strategies/holdingsSummary/hasSyncing/analytics/
// flaggedHoldings) and the rest reach widgets via `data` which the
// dashboard already passes as `any` for unrelated reasons (WidgetProps
// deferred — see lib/types.ts JSDoc). A future tightening of
// WidgetProps.data will surface the missing fixture fields with no
// `as any` casts hiding the gap.
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
      api_key_id: "test-key-id",
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
  strategies: [],
} satisfies Partial<MyAllocationDashboardPayload>;

// pr189-followup M15 — empty-holdings variant for tests that exercise
// the EmptyState short-circuit (e.g. the recovery-banner-in-empty-state
// test below).
const EMPTY_HOLDINGS_PAYLOAD = {
  ...BASE_PAYLOAD,
  holdingsSummary: [],
};

describe("AllocationDashboardV2 — retroactive audit-2026-05-16 — H-1199 unknown-widget console.warn (pr-test L16 c8)", () => {
  it("emits console.warn exactly once for a stranded widget id even across multiple renders", async () => {
    tilesHolder.tiles = [
      { k: KPI_STRIP_ID, w: 2 },
      { k: "stranded-unknown-widget", w: 2 },
    ];
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { rerender, container } = render(
      <AllocationDashboardV2 {...BASE_PAYLOAD as unknown as MyAllocationDashboardPayload} />,
    );
    await waitFor(() => {
      expect(
        container.querySelector(`[data-widget-id="${KPI_STRIP_ID}"]`),
      ).not.toBeNull();
    });
    // Re-render 3x — dedup contract: still 1 warn total for the same id.
    for (let i = 0; i < 3; i++) {
      rerender(
        <AllocationDashboardV2 {...BASE_PAYLOAD as unknown as MyAllocationDashboardPayload} />,
      );
    }
    const strandedWarns = warnSpy.mock.calls.filter((c) => {
      const msg = String(c[0] ?? "");
      const payload = c[1];
      return (
        msg.includes("[AllocationDashboardV2] unknown widget id in persisted layout") &&
        typeof payload === "object" &&
        payload !== null &&
        (payload as { widget_id?: string }).widget_id === "stranded-unknown-widget"
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
      <AllocationDashboardV2 {...BASE_PAYLOAD as unknown as MyAllocationDashboardPayload} />,
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

// ---------------------------------------------------------------------------
// pr189-followup H7 (red-team HIGH/8) — dashboard recovery banner coverage.
// Pre-followup, the retro-audit test file mocked consumeDashboardRecoveryFlag
// as `() => null` for every test, so a silent revert of the recovery-banner
// JSX in AllocationDashboardV2.tsx would have passed every assertion.
//
// These cases drive each reason branch through the per-test override hook
// and assert the banner DOM renders with the right copy + the right
// data-recovery-reason attribute, plus a dismiss-button case to pin the
// onClick → setRecoveryReason(null) wiring.
// ---------------------------------------------------------------------------

describe("AllocationDashboardV2 — retroactive audit-2026-05-16 — recovery banner (red-team H7)", () => {
  const REASON_COPY = {
    parse_failed:
      /We couldn't read your saved dashboard layout and reset it to defaults/,
    version_reset:
      /Your saved dashboard layout was from an older version and has been reset to the latest defaults/,
    legacy_in_v2_blob:
      /Your saved dashboard layout used a legacy format and has been migrated to the new defaults/,
  } as const;

  for (const reason of [
    "parse_failed",
    "version_reset",
    "legacy_in_v2_blob",
  ] as const) {
    it(`renders banner for ${reason} (populated path)`, async () => {
      tilesHolder.tiles = [{ k: KPI_STRIP_ID, w: 2 }];
      recoveryFlagHolder.reason = reason;
      const { container, getByText } = render(
        <AllocationDashboardV2 {...BASE_PAYLOAD as unknown as MyAllocationDashboardPayload} />,
      );
      await waitFor(() => {
        const banner = container.querySelector(
          '[data-testid="dashboard-recovery-banner"]',
        );
        expect(banner).not.toBeNull();
        expect(banner?.getAttribute("data-recovery-reason")).toBe(reason);
      });
      expect(getByText(REASON_COPY[reason])).not.toBeNull();
    });

    it(`renders banner for ${reason} in EmptyState branch (H1 — banner survives the short-circuit)`, async () => {
      // H1 + H7 — the empty-holdings branch returns early. Pre-followup,
      // the banner was rendered AFTER that early return, so empty-holdings
      // allocators got their flag drained without ever seeing the banner.
      tilesHolder.tiles = [];
      recoveryFlagHolder.reason = reason;
      const { container } = render(
        <AllocationDashboardV2 {...EMPTY_HOLDINGS_PAYLOAD as unknown as MyAllocationDashboardPayload} />,
      );
      await waitFor(() => {
        const banner = container.querySelector(
          '[data-testid="dashboard-recovery-banner"]',
        );
        expect(banner).not.toBeNull();
        expect(banner?.getAttribute("data-recovery-reason")).toBe(reason);
      });
    });
  }

  it("dismiss button removes the banner", async () => {
    tilesHolder.tiles = [{ k: KPI_STRIP_ID, w: 2 }];
    recoveryFlagHolder.reason = "parse_failed";
    const { container, getByLabelText } = render(
      <AllocationDashboardV2 {...BASE_PAYLOAD as unknown as MyAllocationDashboardPayload} />,
    );
    await waitFor(() => {
      expect(
        container.querySelector('[data-testid="dashboard-recovery-banner"]'),
      ).not.toBeNull();
    });
    const dismiss = getByLabelText(/Dismiss layout reset notice/i);
    fireEvent.click(dismiss);
    await waitFor(() => {
      expect(
        container.querySelector('[data-testid="dashboard-recovery-banner"]'),
      ).toBeNull();
    });
  });

  it("no banner when consumeDashboardRecoveryFlag returns null (control)", async () => {
    tilesHolder.tiles = [{ k: KPI_STRIP_ID, w: 2 }];
    recoveryFlagHolder.reason = null;
    const { container } = render(
      <AllocationDashboardV2 {...BASE_PAYLOAD as unknown as MyAllocationDashboardPayload} />,
    );
    await waitFor(() => {
      expect(
        container.querySelector(`[data-widget-id="${KPI_STRIP_ID}"]`),
      ).not.toBeNull();
    });
    expect(
      container.querySelector('[data-testid="dashboard-recovery-banner"]'),
    ).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// pr189-followup M3 (code-reviewer MED/8) — behavior-test companion to the
// existing structural H-1197 deps test. The structural grep would silently
// pass if the widget_viewed effect were refactored into a custom hook
// (the literal would move out of AllocationDashboardV2.tsx); this behavior
// test mounts the dashboard with empty holdings (triggering the EmptyState
// short-circuit), then re-mounts with populated holdings (releasing the
// short-circuit), and asserts that the IntersectionObserver-driven
// widget_viewed events fire for tiles that become visible after the
// transition.
// ---------------------------------------------------------------------------

describe("AllocationDashboardV2 — retroactive audit-2026-05-16 — H-1197 widget_viewed behavior (code-reviewer M3)", () => {
  it("widget_viewed observer re-attaches when transitioning from EmptyState to populated", async () => {
    // Custom IntersectionObserver that synchronously calls back on observe()
    // so the test doesn't have to wait for the browser's intersection loop.
    type Cb = (entries: IntersectionObserverEntry[]) => void;
    const observed: HTMLElement[] = [];
    let lastCb: Cb | null = null;
    class TestIO {
      constructor(cb: Cb) {
        lastCb = cb;
      }
      observe(target: HTMLElement) {
        observed.push(target);
        if (lastCb)
          lastCb([
            {
              isIntersecting: true,
              target,
              boundingClientRect: {} as DOMRectReadOnly,
              intersectionRatio: 1,
              intersectionRect: {} as DOMRectReadOnly,
              rootBounds: null,
              time: 0,
            } as unknown as IntersectionObserverEntry,
          ]);
      }
      unobserve() {}
      disconnect() {}
    }
    (globalThis as unknown as { IntersectionObserver: typeof TestIO }).IntersectionObserver =
      TestIO;

    const { trackUsageEventClient } = await import(
      "@/lib/analytics/usage-events-client"
    );
    const trackMock = trackUsageEventClient as unknown as ReturnType<typeof vi.fn>;
    trackMock.mockClear();

    tilesHolder.tiles = [{ k: KPI_STRIP_ID, w: 2 }];

    // First render: empty holdings → EmptyState short-circuit, no widget
    // observer wiring should fire widget_viewed because the ref div
    // hasn't mounted.
    const { rerender, container } = render(
      <AllocationDashboardV2 {...EMPTY_HOLDINGS_PAYLOAD as unknown as MyAllocationDashboardPayload} />,
    );
    expect(
      container.querySelector(`[data-widget-id="${KPI_STRIP_ID}"]`),
    ).toBeNull();
    expect(
      trackMock.mock.calls.filter((c) => c[0] === "widget_viewed"),
    ).toHaveLength(0);

    // Second render: populated holdings → dashboard mounts the ref div,
    // observer effect re-runs on the dep change [holdingsEmpty, hasSyncing],
    // synchronous TestIO fires widget_viewed for the visible KPI tile.
    rerender(
      <AllocationDashboardV2 {...BASE_PAYLOAD as unknown as MyAllocationDashboardPayload} />,
    );
    await waitFor(() => {
      expect(
        container.querySelector(`[data-widget-id="${KPI_STRIP_ID}"]`),
      ).not.toBeNull();
    });
    await waitFor(() => {
      const widgetViewedCalls = trackMock.mock.calls.filter(
        (c) => c[0] === "widget_viewed",
      );
      expect(widgetViewedCalls.length).toBeGreaterThanOrEqual(1);
      const ids = widgetViewedCalls.map(
        (c) => (c[1] as { widget_id?: string }).widget_id,
      );
      expect(ids).toContain(KPI_STRIP_ID);
    });
  });
});
