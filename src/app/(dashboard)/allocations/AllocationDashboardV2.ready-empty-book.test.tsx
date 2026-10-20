import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { AllocationDashboardV2 } from "./AllocationDashboardV2";
import type { MyAllocationDashboardPayload } from "@/lib/queries";

// ---------------------------------------------------------------------------
// Phase 167.1.2.1.2 plan 02 (D-04, SC-4) — a ready, all-closed book renders the
// Overview's curve and factsheet, not the connected-but-empty card.
//
// Why this matters: the equity history of a book whose positions are all
// closed is real (the owner traded, the curve is their record), and the Risk
// tab already rendered its figures for it. The Overview alone said "No
// positions to analyze yet." over a history it could draw (170.4 goal: the two
// tabs never disagree about one payload). UI-SPEC precedence table row 3: with
// an eligible key, history exactly "ready" and an empty book, figures win.
//
// What stays as it was, and is pinned below so a later edit cannot widen the
// change: 170.4 D-09 (no eligible key: the connect-a-key card whatever the
// history state) and the fail-closed rebuilding panel for any state other than
// an explicit "ready".
// ---------------------------------------------------------------------------

const { buildPayload } = vi.hoisted(() => ({
  buildPayload: vi.fn(),
}));

vi.mock("@/lib/sentry-capture", () => ({ captureToSentry: vi.fn() }));
vi.mock("@/components/portfolio/InsightStrip", () => ({
  InsightStrip: () => <div data-testid="mock-insight-strip" />,
}));
vi.mock("./components/AlertBanner", () => ({
  AlertBanner: () => <div data-testid="mock-alert-banner" />,
}));
vi.mock("./widgets/performance/EquityChart", () => ({
  default: () => <div data-testid="mock-equity-chart" />,
}));
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
  buildAllocatorPortfolioFactsheetPayload: buildPayload,
}));

beforeEach(() => {
  // Default: the builder accepts the book's returns. The warm-up arm flips it.
  buildPayload.mockReturnValue({ stub: true });
});

afterEach(() => {
  cleanup();
  buildPayload.mockReset();
});

const BASE = {
  portfolio: null,
  strategies: [],
  analytics: null,
  apiKeys: [],
  holdingsSummary: [],
  flaggedHoldings: [],
  equityDailyPoints: [],
  equityDailyReturns: [],
  equitySnapshots: [],
  activeVenues: [],
  perKeyReturnsByApiKeyId: {},
  contributingApiKeyIds: [],
  allocator_id: "alloc-1",
  allKeysStale: false,
  lastSyncAt: null,
  hasSyncing: false,
  equityBaselineUnknown: false,
  hasConnectedKeys: true,
  equityHistoryState: "ready",
  equityHistoryRebuildReason: null,
  equityHistoryNotSyncingKeyIds: [],
} as const;

function payload(over: Partial<Record<string, unknown>> = {}) {
  return { ...BASE, ...over } as unknown as MyAllocationDashboardPayload;
}

describe("Overview of a ready, all-closed book (D-04 / SC-4)", () => {
  it("eligible key + ready + empty book: the curve and the factsheet render, never the empty card", () => {
    render(<AllocationDashboardV2 {...payload()} />);

    expect(screen.getByTestId("overview-equity-curve")).toBeInTheDocument();
    expect(screen.getByTestId("mock-factsheet-body")).toBeInTheDocument();
    expect(screen.queryByText("No positions to analyze yet.")).toBeNull();
    expect(screen.queryByTestId("overview-equity-rebuilding")).toBeNull();
  });

  it("eligible key + ready + empty book, factsheet builder refuses: the curve plus the warm-up note, never the empty card (E1 empty)", () => {
    buildPayload.mockReturnValue(null);
    render(<AllocationDashboardV2 {...payload()} />);

    expect(screen.getByTestId("overview-equity-curve")).toBeInTheDocument();
    expect(screen.getByTestId("overview-factsheet-warmup")).toBeInTheDocument();
    expect(screen.queryByText("No positions to analyze yet.")).toBeNull();
    expect(screen.queryByTestId("overview-equity-rebuilding")).toBeNull();
  });
});

describe("neighbouring states keep their answer (guards, not proof of D-04)", () => {
  it("no eligible key + empty book + ready history: the connect-a-key card, no curve (170.4 D-09)", () => {
    render(
      <AllocationDashboardV2
        {...payload({ hasConnectedKeys: false, equityHistoryState: "ready" })}
      />,
    );

    expect(
      screen.getByRole("link", { name: /Connect Exchange/ }),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("overview-equity-curve")).toBeNull();
    expect(screen.queryByTestId("overview-equity-rebuilding")).toBeNull();
  });

  // Fail-closed (T-167.1.2.1.2-04): only an explicit "ready" may draw the curve.
  // An empty book must not open a door the populated book keeps shut.
  it.each([
    ["undefined", undefined],
    ["null", null],
    ["an empty string", ""],
    ["rebuilding", "rebuilding"],
    ["an unrecognised state", "weird"],
  ])(
    "eligible key + empty book + history %s: the rebuilding panel, no curve (fail-closed)",
    (_label, state) => {
      render(
        <AllocationDashboardV2 {...payload({ equityHistoryState: state })} />,
      );

      expect(screen.getByTestId("overview-equity-rebuilding")).toBeInTheDocument();
      expect(screen.queryByTestId("overview-equity-curve")).toBeNull();
      expect(screen.queryByText("No positions to analyze yet.")).toBeNull();
    },
  );
});
