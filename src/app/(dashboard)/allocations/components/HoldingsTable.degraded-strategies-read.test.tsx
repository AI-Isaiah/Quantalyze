import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { HoldingsTable } from "./HoldingsTable";
import { HoldingsTabPanel } from "../HoldingsTabPanel";
import { EMPTY_EXPOSURE } from "../lib/exposure-props";

/**
 * Phase 150 review WR-02 — a failed read must never render as an account-state
 * claim.
 *
 * `getOwnCapitalStrategies` and `getMyStrategies` both return `null` (never
 * `[]`) on a transient DB/RLS failure, precisely so the render layer can tell
 * "nothing marked yet" from "the fetch failed". Both failure modes degrade to
 * the SAME values a genuinely empty account produces — zero rows and
 * `hasAnyStrategies: false` — so without the `strategiesReadFailed` signal the
 * Strategies section states "No strategies yet." to an owner who has plenty,
 * and (for a positioned row that lost its own-capital tag with the marked set)
 * silently drops the Allocate affordance with no explanation on screen.
 *
 * The two definitive strings below are the FALSIFIERS: they are the copy the
 * pre-fix page produced from a `null`. Each degraded case asserts their
 * ABSENCE, and each is paired with a fetch-succeeded control asserting their
 * PRESENCE — so the cases cannot pass by rendering nothing at all.
 */

// HoldingsTable imports useRouter at module scope (the legacy design table).
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: vi.fn(),
    replace: vi.fn(),
    push: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    prefetch: vi.fn(),
  }),
  usePathname: () => "/allocations",
  useSearchParams: () => new URLSearchParams(),
}));

// The panel case below pulls the shared optimizer through next/dynamic.
vi.mock("@/components/portfolio/PortfolioOptimizer", () => ({
  default: () => <div data-testid="portfolio-optimizer-mock" />,
}));

/** The two definitive account-state claims the degraded arm must suppress. */
const NO_STRATEGIES_AT_ALL = "No strategies yet.";
const NONE_MARKED = "No strategies marked as own capital.";
const DEGRADED = /Strategies temporarily unavailable/i;

describe("HoldingsTable — WR-02 degraded strategies read", () => {
  it("a failed read renders the temporarily-unavailable notice, NOT 'No strategies yet.'", () => {
    render(
      <HoldingsTable strategyRows={[]} hasAnyStrategies={false} strategiesReadFailed />,
    );

    expect(screen.getByText(DEGRADED)).toBeInTheDocument();
    expect(screen.queryByText(NO_STRATEGIES_AT_ALL)).not.toBeInTheDocument();
    expect(screen.queryByText(NONE_MARKED)).not.toBeInTheDocument();
  });

  it("a failed read suppresses the arm-2 claim too (owner HAS strategies, marked set unknown)", () => {
    render(
      <HoldingsTable strategyRows={[]} hasAnyStrategies strategiesReadFailed />,
    );

    expect(screen.getByText(DEGRADED)).toBeInTheDocument();
    expect(screen.queryByText(NONE_MARKED)).not.toBeInTheDocument();
    expect(screen.queryByText(NO_STRATEGIES_AT_ALL)).not.toBeInTheDocument();
  });

  it("CONTROL — a SUCCESSFUL empty read still renders the definitive empty state (the arm the degraded cases must not be stealing)", () => {
    const { rerender } = render(
      <HoldingsTable
        strategyRows={[]}
        hasAnyStrategies={false}
        strategiesReadFailed={false}
      />,
    );
    expect(screen.getByText(NO_STRATEGIES_AT_ALL)).toBeInTheDocument();
    expect(screen.queryByText(DEGRADED)).not.toBeInTheDocument();

    rerender(
      <HoldingsTable
        strategyRows={[]}
        hasAnyStrategies
        strategiesReadFailed={false}
      />,
    );
    expect(screen.getByText(NONE_MARKED)).toBeInTheDocument();
    expect(screen.queryByText(DEGRADED)).not.toBeInTheDocument();
  });

  it("a failed read with rows still renders the rows — allocated money never leaves the money surface, the notice explains what may be missing", () => {
    render(
      <HoldingsTable
        strategyRows={[
          {
            id: "s-1",
            strategy: "Helios Basis",
            manager: null,
            capitalOwnership: null,
            weight: null,
            allocation: 250_000,
            mtd: null,
            sharpe: null,
            maxDd: null,
            age: 30,
          },
        ]}
        hasAnyStrategies={false}
        strategiesReadFailed
      />,
    );

    expect(screen.getByText(DEGRADED)).toBeInTheDocument();
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getByText("Helios Basis")).toBeInTheDocument();
    expect(screen.queryByText(NO_STRATEGIES_AT_ALL)).not.toBeInTheDocument();
  });

  it("HoldingsTabPanel FORWARDS the signal (a dropped forward would leave the table claiming an empty account)", () => {
    const panelProps = {
      portfolio: null,
      analytics: null,
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
      minHistoryDepthMonths: null,
      activeVenues: [],
      flaggedHoldings: [],
      matchDecisionsByHoldingRef: {},
      mandate: null,
      strategies: [],
      exposure: EMPTY_EXPOSURE,
      ownCapitalStrategies: [],
      hasAnyStrategies: false,
    } as unknown as Parameters<typeof HoldingsTabPanel>[0];

    const { rerender } = render(
      <HoldingsTabPanel {...panelProps} strategiesReadFailed />,
    );
    expect(screen.getByText(DEGRADED)).toBeInTheDocument();
    expect(screen.queryByText(NO_STRATEGIES_AT_ALL)).not.toBeInTheDocument();

    // Control through the SAME mount path: the panel is not hard-coding the
    // degraded arm.
    rerender(
      <HoldingsTabPanel {...panelProps} strategiesReadFailed={false} />,
    );
    expect(screen.getByText(NO_STRATEGIES_AT_ALL)).toBeInTheDocument();
    expect(screen.queryByText(DEGRADED)).not.toBeInTheDocument();
  });
});
