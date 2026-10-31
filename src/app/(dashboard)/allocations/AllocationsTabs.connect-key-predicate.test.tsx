/**
 * Phase 170.4 D-07. "Does this allocator have an eligible key?" is ONE
 * server-side flag, `hasConnectedKeys`. No tab may answer it from holdings,
 * portfolios or history. On 2026-10-03 PROD the same allocator was told to
 * connect a key on Overview and Scenario while holding one, and shown the
 * rebuilding panel on Risk.
 *
 * This file renders the REAL tab bodies through `AllocationsTabs` (Overview,
 * Holdings, Risk, Scenario) from ONE payload whose holdings are empty, whose
 * portfolios are empty and whose history is rebuilding. The two arms differ
 * only in `hasConnectedKeys` and in that flag's source key row (live vs
 * disconnected, the "disconnected my only key" case). Flipping them must flip
 * every tab between a connect-a-key prompt and none. `apiKeysCount` is 1 in
 * both arms so the above-tabs OnboardingBanner stays hidden and the matrix
 * measures tab bodies only.
 */
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import type { ReadonlyURLSearchParams } from "next/navigation";

// --- next/navigation: the tab is read from the mocked search params --------

vi.mock("next/navigation", () => ({
  useSearchParams: vi.fn(),
  useRouter: vi.fn(),
  usePathname: vi.fn(() => "/allocations"),
}));

import { useSearchParams, useRouter } from "next/navigation";

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: React.ReactNode;
  } & React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

// --- inert leaves: charts, drawers and the shared optimizer -----------------

vi.mock("@/lib/sentry-capture", () => ({ captureToSentry: vi.fn() }));
vi.mock("@/components/portfolio/InsightStrip", () => ({
  InsightStrip: () => <div data-testid="mock-insight-strip" />,
}));
vi.mock("./components/AlertBanner", () => ({
  AlertBanner: () => <div data-testid="mock-alert-banner" />,
}));
// Partial: the Scenario composer imports named helpers (`toWealth`) from the
// same module, so only the chart component is replaced.
vi.mock("./widgets/performance/EquityChart", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("./widgets/performance/EquityChart")>();
  return {
    ...actual,
    default: () => <div data-testid="mock-equity-chart" />,
    EquityChart: () => <div data-testid="mock-equity-chart" />,
  };
});
vi.mock("@/app/factsheet/[id]/v2/factsheet-context", () => ({
  FactsheetProvider: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));
vi.mock("@/app/factsheet/[id]/v2/FactsheetView", () => ({
  FactsheetBody: ({ topSlot }: { topSlot?: React.ReactNode }) => (
    <div data-testid="mock-factsheet-body">{topSlot}</div>
  ),
}));
vi.mock("@/lib/factsheet/allocator-portfolio-payload", () => ({
  buildAllocatorPortfolioFactsheetPayload: () => ({ stub: true }),
}));
vi.mock("@/components/portfolio/PortfolioOptimizer", () => ({
  default: () => <div data-testid="portfolio-optimizer-mock" />,
}));
vi.mock("./components/StrategyBrowseDrawer", () => ({
  StrategyBrowseDrawer: () => null,
}));
vi.mock("./components/ContributionWizardOverlay", () => ({
  ContributionWizardOverlay: () => null,
}));
vi.mock("./components/BridgeDrawer", () => ({ BridgeDrawer: () => null }));
vi.mock("./components/ScenarioCommitDrawer", () => ({
  ScenarioCommitDrawer: () => null,
}));

import { AllocationsTabs } from "./AllocationsTabs";
import type { MyAllocationDashboardPayload } from "@/lib/queries";
import { EMPTY_EXPOSURE, type ExposureSectionData } from "./lib/exposure-props";

type Payload = MyAllocationDashboardPayload & { exposure: ExposureSectionData };

// --- Payload P ---------------------------------------------------------------

const LIVE_KEY = {
  id: "key-a",
  exchange: "binance",
  label: "Main",
  is_active: true,
  sync_status: "complete",
  last_sync_at: null,
  account_balance_usdt: null,
  created_at: "2026-01-01T00:00:00Z",
  sync_error: null,
  last_429_at: null,
  disconnected_at: null,
};

/** The same key row after the allocator disconnected it. */
const DISCONNECTED_KEY = {
  ...LIVE_KEY,
  disconnected_at: "2026-10-01T00:00:00Z",
};

/**
 * Empty holdings, empty portfolios (the optimizer prefetch), history
 * rebuilding. Nothing here depends on the arm.
 */
const PAYLOAD_P = {
  exposure: EMPTY_EXPOSURE,
  optimizer: {
    portfolios: [],
    defaultPortfolioId: null,
    initialSuggestions: null,
    computedAt: null,
    computationStatus: null,
  },
  portfolio: null,
  analytics: null,
  strategies: [],
  alertCount: { critical: 0, high: 0, medium: 0, low: 0, total: 0 },
  outcomes: [],
  holdingsSummary: [],
  snapshotCount: null,
  allKeysStale: false,
  lastSyncAt: null,
  hasSyncing: false,
  equityDailyPoints: [],
  equityCurveSource: "legacy",
  equityHistoryState: "rebuilding",
  equityDailyReturns: [],
  equityHistoryRebuildReason: "awaiting_derivation",
  equityHistoryNotSyncingKeyIds: [],
  derivedCurveComputedAt: null,
  activeVenues: [],
  flaggedHoldings: [],
  matchDecisionsByHoldingRef: {},
  mandate: null,
  allocator_id: "00000000-0000-0000-0000-000000000000",
  liveBaselineMetrics: {
    aum: 0,
    ytdTwr: null,
    sharpe: null,
    maxDd: null,
    avgRho: null,
    equity: [],
    drawdown: [],
  },
  perKeyReturnsByApiKeyId: {},
  perKeyDailiesGateSatisfied: false,
  eligibleApiKeyIds: [],
  allocatorEligibleApiKeyIds: [],
  contributingApiKeyIds: [],
  bookEntryGateSatisfied: false,
  apiKeysCount: 1,
  mandateIsSet: true,
} as const;

/** Arm A: an eligible key. Arm B: the same key, disconnected. Nothing else differs. */
const ARM_A = {
  ...PAYLOAD_P,
  hasConnectedKeys: true,
  apiKeys: [LIVE_KEY],
} as unknown as Payload;
const ARM_B = {
  ...PAYLOAD_P,
  hasConnectedKeys: false,
  apiKeys: [DISCONNECTED_KEY],
} as unknown as Payload;

const CONNECT_LINK = /Connect Exchange/i;
const CONNECT_SENTENCE = /^Connect a read-only exchange API key/;

// A tab is rendered when its own anchor is on screen; absence assertions are
// only meaningful after that (the panels are next/dynamic chunks).
// The chunks load lazily, so a loaded CI shard can take longer than waitFor's
// 1 s default to mount one (seen on the holdings panel, PR #1005 shard 1).
const LAZY_PANEL_TIMEOUT_MS = 5000;
const TABS = [
  {
    tab: "overview",
    rendered: () => {
      expect(
        screen.queryByTestId("overview-equity-rebuilding") ??
          screen.queryByText("No positions to analyze yet."),
      ).not.toBeNull();
    },
  },
  {
    tab: "holdings",
    rendered: () => {
      expect(
        screen.getByRole("heading", { name: /Diversification Optimizer|Simulate Impact/i }),
      ).toBeTruthy();
    },
  },
  {
    tab: "risk",
    rendered: () => {
      expect(document.querySelector("[data-tab-panel='risk']")).not.toBeNull();
    },
  },
  {
    tab: "scenario",
    rendered: () => {
      expect(screen.getByText("Start a portfolio")).toBeTruthy();
    },
  },
] as const;

async function renderTab(tab: string, payload: Payload) {
  vi.mocked(useSearchParams).mockReturnValue(
    new URLSearchParams(`tab=${tab}`) as unknown as ReadonlyURLSearchParams,
  );
  render(<AllocationsTabs {...payload} />);
  return TABS.find((t) => t.tab === tab)!;
}

describe("the connect-a-key prompt follows the eligible-key flag on every tab (D-07)", () => {
  beforeEach(() => {
    vi.mocked(useRouter).mockReturnValue({
      replace: vi.fn(),
      refresh: vi.fn(),
      push: vi.fn(),
      back: vi.fn(),
      forward: vi.fn(),
      prefetch: vi.fn(),
    } as unknown as ReturnType<typeof useRouter>);
    // Scenario's saved-scenarios list reads on mount; nothing is saved.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, status: 200, json: async () => [] })),
    );
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("the two arms differ only in the flag and in that flag's source key row", () => {
    const differing = (Object.keys(ARM_A) as Array<keyof Payload>).filter(
      (k) => JSON.stringify(ARM_A[k]) !== JSON.stringify(ARM_B[k]),
    );
    expect(differing.sort()).toEqual(["apiKeys", "hasConnectedKeys"]);
    // Holdings, portfolios and history are byte-identical across the arms.
    expect(JSON.stringify(ARM_A.holdingsSummary)).toBe(
      JSON.stringify(ARM_B.holdingsSummary),
    );
    expect(ARM_A.holdingsSummary).toEqual([]);
    expect(PAYLOAD_P.optimizer.portfolios).toEqual([]);
    expect(ARM_A.equityHistoryState).toBe("rebuilding");
  });

  describe.each(TABS.map((t) => t.tab))("tab=%s", (tab) => {
    it("Arm A, an eligible key: no connect link and no connect sentence", async () => {
      const anchor = await renderTab(tab, ARM_A);
      await waitFor(anchor.rendered, { timeout: LAZY_PANEL_TIMEOUT_MS });
      expect(screen.queryByRole("link", { name: CONNECT_LINK })).toBeNull();
      expect(screen.queryByText(CONNECT_SENTENCE)).toBeNull();
    });

    it("Arm B, the only key disconnected: the tab prompts to connect one", async () => {
      const anchor = await renderTab(tab, ARM_B);
      await waitFor(anchor.rendered, { timeout: LAZY_PANEL_TIMEOUT_MS });
      expect(
        screen.getAllByRole("link", { name: CONNECT_LINK }).length,
      ).toBeGreaterThan(0);
    });
  });
});
