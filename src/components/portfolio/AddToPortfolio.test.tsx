import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * <AddToPortfolio> — the discovery-detail control that attaches a strategy to
 * one of the user's portfolios.
 *
 * Opening the dropdown fetches the user's OWNED portfolios (RLS-scoped via
 * `.eq("user_id", user.id)`); clicking one inserts into `portfolio_strategies`.
 * A PK collision (23505) surfaces "Already in portfolio" rather than an error,
 * making the add idempotent from the user's perspective.
 *
 * (Phase 32 FLOW-01 explored a `?portfolio=` auto-attach that pre-selected the
 * originating portfolio, but the param could not survive the discovery
 * listing → strategy-detail navigation — the listing's StrategyTable links to
 * /factsheet, which never mounts this component — so that dead plumbing was
 * removed. The manual dropdown below is the real, working attach path.)
 */

const { mockInsert, mockGetUser, mockOrder } = vi.hoisted(() => ({
  mockInsert: vi.fn(),
  mockGetUser: vi.fn(),
  mockOrder: vi.fn(),
}));

// Table-aware supabase client mock: `portfolios` resolves the owned-portfolio
// fetch (.select().eq().order()), `portfolio_strategies` exposes .insert().
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: { getUser: mockGetUser },
    from: (table: string) => {
      if (table === "portfolio_strategies") {
        return { insert: mockInsert };
      }
      // portfolios — owned-portfolio fetch chain
      return {
        select: () => ({
          eq: () => ({
            order: mockOrder,
          }),
        }),
      };
    },
  }),
}));

import { AddToPortfolio } from "./AddToPortfolio";

const TEST_USER_ID = "00000000-0000-0000-0000-aaaaaaaaaaaa";
const STRATEGY_ID = "11111111-1111-1111-1111-111111111111";
const OWNED_PORTFOLIO_ID = "22222222-2222-2222-2222-222222222222";
const OTHER_OWNED_ID = "33333333-3333-3333-3333-333333333333";

const OWNED_PORTFOLIOS = [
  { id: OWNED_PORTFOLIO_ID, name: "Aggressive blend" },
  { id: OTHER_OWNED_ID, name: "Conservative" },
];

beforeEach(() => {
  mockInsert.mockReset();
  mockGetUser.mockReset();
  mockOrder.mockReset();
  mockGetUser.mockResolvedValue({ data: { user: { id: TEST_USER_ID } } });
  // The owned-portfolio fetch resolves to exactly the user's RLS-scoped set.
  mockOrder.mockResolvedValue({ data: OWNED_PORTFOLIOS, error: null });
  mockInsert.mockResolvedValue({ error: null });
});

describe("<AddToPortfolio>", () => {
  it("opens the dropdown, lists owned portfolios, and attaches on selection", async () => {
    render(<AddToPortfolio strategyId={STRATEGY_ID} />);

    // Nothing fetched or inserted until the dropdown is opened.
    expect(mockInsert).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /portfolio/i }));

    const option = await screen.findByRole("button", { name: "Aggressive blend" });
    // Opening must not auto-attach anything — the user chooses.
    expect(mockInsert).not.toHaveBeenCalled();

    fireEvent.click(option);
    await waitFor(() => expect(mockInsert).toHaveBeenCalledTimes(1));
    expect(mockInsert).toHaveBeenCalledWith({
      portfolio_id: OWNED_PORTFOLIO_ID,
      strategy_id: STRATEGY_ID,
    });
    expect(await screen.findByText("Added!")).toBeInTheDocument();
  });

  it("treats a duplicate (PK 23505) as idempotent — 'Already in portfolio', not an error", async () => {
    mockInsert.mockResolvedValue({ error: { code: "23505" } });

    render(<AddToPortfolio strategyId={STRATEGY_ID} />);
    fireEvent.click(screen.getByRole("button", { name: /portfolio/i }));
    fireEvent.click(await screen.findByRole("button", { name: "Conservative" }));

    await waitFor(() =>
      expect(mockInsert).toHaveBeenCalledWith({
        portfolio_id: OTHER_OWNED_ID,
        strategy_id: STRATEGY_ID,
      }),
    );
    expect(await screen.findByText("Already in portfolio")).toBeInTheDocument();
    // The "Failed to add" error copy must NOT appear for a duplicate.
    expect(screen.queryByText("Failed to add")).not.toBeInTheDocument();
  });

  it("shows the empty-state create link when the user owns no portfolios", async () => {
    mockOrder.mockResolvedValue({ data: [], error: null });

    render(<AddToPortfolio strategyId={STRATEGY_ID} />);
    fireEvent.click(screen.getByRole("button", { name: /portfolio/i }));

    expect(await screen.findByText(/No portfolios yet/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Create one/i })).toHaveAttribute(
      "href",
      "/portfolios",
    );
    expect(mockInsert).not.toHaveBeenCalled();
  });
});
