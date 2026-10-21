/**
 * Phase 170.1.2 D-01 — /portfolios/[id]/manage reads words, not ids or raw
 * enum values. (The tab title is pinned in page.metadata.test.tsx.)
 *
 * - a strategy with no name reads "Unnamed strategy" in the card and in the
 *   name RemoveStrategyButton is given; no part of its strategy_id is shown
 * - relationship_status renders through relationshipStatusLabel; the raw value
 *   still keys the badge colour
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const PORTFOLIO_ID = "33333333-3333-3333-3333-333333333333";
const UNNAMED_ID = "abcdef12-0000-4000-8000-000000000001";
const NAMED_ID = "99999999-0000-4000-8000-000000000002";

vi.mock("next/navigation", () => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`unexpected redirect to ${to}`);
  }),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: {
      getUser: async () => ({ data: { user: { id: "user-1" } }, error: null }),
    },
  })),
}));

vi.mock("@/lib/sentry-capture", () => ({ captureToSentry: vi.fn() }));

const queries = vi.hoisted(() => ({
  getPortfolioDetail: vi.fn(),
  getPortfolioStrategies: vi.fn(),
  getAllocationEvents: vi.fn(),
}));
vi.mock("@/lib/queries", () => queries);

// Client children have their own suites; they render as inert stubs here. The
// remove button stub exposes the strategyName it was handed.
vi.mock("@/components/portfolio/MigrationWizard", () => ({
  MigrationWizardButton: () => null,
}));
vi.mock("@/components/portfolio/AllocationEventForm", () => ({
  AllocationEventForm: () => null,
}));
vi.mock("@/components/portfolio/RemoveStrategyButton", () => ({
  RemoveStrategyButton: ({
    strategyId,
    strategyName,
  }: {
    strategyId: string;
    strategyName: string;
  }) => <span data-testid={`remove-${strategyId}`}>{strategyName}</span>,
}));

import ManagePortfolioPage from "./page";

type Row = {
  strategy_id: string;
  relationship_status: string | null;
  allocated_amount: number | null;
  current_weight: number | null;
  strategies: { id: string; name: string } | null;
};

function row(over: Partial<Row>): Row {
  return {
    strategy_id: NAMED_ID,
    relationship_status: "connected",
    allocated_amount: null,
    current_weight: null,
    strategies: { id: NAMED_ID, name: "Alpha Carry" },
    ...over,
  };
}

async function renderPage(rows: Row[]) {
  queries.getPortfolioDetail.mockResolvedValue({ id: PORTFOLIO_ID, name: "Core Book" });
  queries.getPortfolioStrategies.mockResolvedValue(rows);
  queries.getAllocationEvents.mockResolvedValue([]);
  const ui = await ManagePortfolioPage({ params: Promise.resolve({ id: PORTFOLIO_ID }) });
  return render(ui);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("/portfolios/[id]/manage names (D-01)", () => {
  it("a strategy with no name reads 'Unnamed strategy' and is removed under that name, never its id", async () => {
    const { container } = await renderPage([
      row({ strategy_id: UNNAMED_ID, strategies: null }),
    ]);
    expect(screen.getAllByText("Unnamed strategy").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByTestId(`remove-${UNNAMED_ID}`)).toHaveTextContent("Unnamed strategy");
    expect(container.textContent).not.toContain("abcdef12");
  });

  it("a named strategy keeps its own name", async () => {
    await renderPage([row({})]);
    expect(screen.getAllByText("Alpha Carry").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByTestId(`remove-${NAMED_ID}`)).toHaveTextContent("Alpha Carry");
    expect(screen.queryByText("Unnamed strategy")).toBeNull();
  });
});

describe("/portfolios/[id]/manage relationship status (D-01)", () => {
  it("connected and paused read as words; the raw lowercase value is absent", async () => {
    await renderPage([
      row({ strategy_id: "s1", relationship_status: "connected", strategies: { id: "s1", name: "One" } }),
      row({ strategy_id: "s2", relationship_status: "paused", strategies: { id: "s2", name: "Two" } }),
      row({ strategy_id: "s3", relationship_status: "exited", strategies: { id: "s3", name: "Three" } }),
    ]);
    expect(screen.getByText("Connected")).toBeInTheDocument();
    expect(screen.getByText("Paused")).toBeInTheDocument();
    expect(screen.getByText("Exited")).toBeInTheDocument();
    expect(screen.queryByText("connected")).toBeNull();
    expect(screen.queryByText("paused")).toBeNull();
    expect(screen.queryByText("exited")).toBeNull();
  });

  it("a null or unknown value reads 'Unknown status'", async () => {
    await renderPage([
      row({ strategy_id: "s1", relationship_status: null, strategies: { id: "s1", name: "One" } }),
      row({ strategy_id: "s2", relationship_status: "retired", strategies: { id: "s2", name: "Two" } }),
    ]);
    expect(screen.getAllByText("Unknown status")).toHaveLength(2);
    expect(screen.queryByText("retired")).toBeNull();
  });

  it("the badge for 'connected' still carries the positive colour class", async () => {
    await renderPage([row({})]);
    expect(screen.getByText("Connected").className).toContain("text-positive");
  });
});
