import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ReadonlyURLSearchParams } from "next/navigation";

/**
 * Phase 11 / 11-05 / Task 3 — AllocationsTabs onboarding integration.
 *
 * Asserts the visibility predicates for S1 (OnboardingBanner) and S2
 * (MandateQuickSetCard) when rendered by AllocationsTabs:
 *   1. apiKeysCount=0, mandateIsSet=false → S1 + S2 BOTH render above tabs
 *   2. apiKeysCount=0, mandateIsSet=true  → S1 only (S2 hidden by gate)
 *   3. apiKeysCount=1, mandateIsSet=false → NEITHER render
 *   4. apiKeysCount=5, mandateIsSet=true  → NEITHER render (hidden by D-02)
 */

// --- next/navigation mocks --------------------------------------------------

const mockReplace = vi.fn();
const mockRefresh = vi.fn();
const mockPush = vi.fn();

vi.mock("next/navigation", async () => {
  return {
    useSearchParams: vi.fn(),
    useRouter: vi.fn(),
    usePathname: vi.fn(() => "/allocations"),
  };
});

import { useSearchParams, useRouter } from "next/navigation";

// --- Panel/body stubs (mirrors AllocationsTabs.test.tsx) --------------------

vi.mock("./AllocationDashboardV2", () => ({
  AllocationDashboardV2: () => (
    <div data-testid="overview-v2">OVERVIEW_V2_BODY</div>
  ),
}));

vi.mock("./HoldingsTabPanel", () => ({
  HoldingsTabPanel: () => <div data-testid="holdings-body">HOLDINGS_BODY</div>,
}));

vi.mock("./OutcomesTabPanel", () => ({
  OutcomesTabPanel: () => <div data-testid="outcomes-body">OUTCOMES_BODY</div>,
}));

vi.mock("./MandateTabPanel", () => ({
  MandateTabPanel: () => <div data-testid="mandate-body">MANDATE_BODY</div>,
}));

vi.mock("./RiskTabPanel", () => ({
  RiskTabPanel: () => <div data-testid="risk-body">RISK_BODY</div>,
}));

vi.mock("./ScenarioStub", () => ({
  ScenarioStub: () => <div data-testid="scenario-body">SCENARIO_BODY</div>,
}));

vi.mock("./components/ScenarioComposer", () => ({
  ScenarioComposer: () => (
    <div data-testid="scenario-body">SCENARIO_COMPOSER_BODY</div>
  ),
}));

// next/link → plain <a> for the OnboardingBanner CTA
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

// --- Import after mocks -----------------------------------------------------

import { AllocationsTabs } from "./AllocationsTabs";
import type { MyAllocationDashboardPayload } from "@/lib/queries";
import { EMPTY_EXPOSURE, type ExposureSectionData } from "./lib/exposure-props";

// --- Stub props -------------------------------------------------------------

function basePayload(
  overrides: Partial<
    MyAllocationDashboardPayload & { exposure: ExposureSectionData }
  > = {},
): MyAllocationDashboardPayload & { exposure: ExposureSectionData } {
  return {
    exposure: EMPTY_EXPOSURE,
    portfolio: null,
    analytics: null,
    strategies: [],
    apiKeys: [],
    alertCount: { critical: 0, high: 0, medium: 0, low: 0, total: 0 },
    outcomes: [],
    equitySnapshots: [],
    holdingsSummary: [],
    snapshotCount: 0,
    allKeysStale: false,
    lastSyncAt: null,
    hasSyncing: false,
    equityDailyPoints: [],
    equityCurveSource: "legacy",
    derivedCurveComputedAt: null,
    minHistoryDepthMonths: null,
    equityBaselineUnknown: false,
    activeVenues: [],
    hasConnectedKeys: false,
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
    // Phase 37 / DSRC-01 — per-key channel additive fields (empty/false defaults).
    perKeyReturnsByApiKeyId: {},
    perKeyDailiesGateSatisfied: false,
    eligibleApiKeyIds: [],
    apiKeysCount: 0,
    mandateIsSet: false,
    ...overrides,
  };
}

function setSearchParams(query: string): void {
  vi.mocked(useSearchParams).mockReturnValue(
    new URLSearchParams(query) as unknown as ReadonlyURLSearchParams,
  );
}

describe("AllocationsTabs — Phase 11 / 11-05 onboarding visibility", () => {
  beforeEach(() => {
    mockReplace.mockReset();
    mockRefresh.mockReset();
    mockPush.mockReset();
    vi.mocked(useRouter).mockReturnValue({
      replace: mockReplace,
      refresh: mockRefresh,
      push: mockPush,
      back: vi.fn(),
      forward: vi.fn(),
      prefetch: vi.fn(),
    } as unknown as ReturnType<typeof useRouter>);
    setSearchParams("");
  });

  it("apiKeysCount=0 + mandateIsSet=false → BOTH OnboardingBanner and MandateQuickSetCard render above tabs", () => {
    render(
      <AllocationsTabs
        {...basePayload({ apiKeysCount: 0, mandateIsSet: false })}
      />,
    );
    expect(
      screen.getByText("Connect your exchange to see real performance"),
    ).toBeInTheDocument();
    expect(screen.getByText("Mandate quick-set")).toBeInTheDocument();
    // Existing tabs still render below.
    expect(screen.getByRole("tab", { name: "Overview" })).toBeInTheDocument();
  });

  it("apiKeysCount=0 + mandateIsSet=true → OnboardingBanner ONLY (mandate already saved)", () => {
    render(
      <AllocationsTabs
        {...basePayload({ apiKeysCount: 0, mandateIsSet: true })}
      />,
    );
    expect(
      screen.getByText("Connect your exchange to see real performance"),
    ).toBeInTheDocument();
    expect(screen.queryByText("Mandate quick-set")).toBeNull();
  });

  it("apiKeysCount=1 + mandateIsSet=false → NEITHER renders (D-02 hides both once first key connects)", () => {
    render(
      <AllocationsTabs
        {...basePayload({ apiKeysCount: 1, mandateIsSet: false })}
      />,
    );
    expect(
      screen.queryByText("Connect your exchange to see real performance"),
    ).toBeNull();
    expect(screen.queryByText("Mandate quick-set")).toBeNull();
    // Existing tabs still render — additive nudge surface only.
    expect(screen.getByRole("tab", { name: "Overview" })).toBeInTheDocument();
  });

  it("apiKeysCount=5 + mandateIsSet=true → NEITHER renders, tabs unchanged", () => {
    render(
      <AllocationsTabs
        {...basePayload({ apiKeysCount: 5, mandateIsSet: true })}
      />,
    );
    expect(
      screen.queryByText("Connect your exchange to see real performance"),
    ).toBeNull();
    expect(screen.queryByText("Mandate quick-set")).toBeNull();
    expect(screen.getByRole("tab", { name: "Overview" })).toBeInTheDocument();
  });
});
