import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * FLOW-01 (phase 32) — portfolio-context attach-back.
 *
 * The two portfolio-context "+ Add Strategy" / "Add your first strategy"
 * controls now navigate to `/discovery/crypto-sma?portfolio=${id}`. On the
 * discovery strategy-detail page the already-mounted <AddToPortfolio> reads
 * that `?portfolio` search param (via next/navigation useSearchParams) and,
 * when the id matches one of the user's OWNED portfolios, pre-selects it so
 * adding the strategy is a single gesture into the existing
 * `portfolio_strategies.insert` path.
 *
 * Security contract (threat T-32-01): the default id is matched ONLY against
 * the RLS-scoped owned-portfolio fetch (`.eq("user_id", user.id)`). An id the
 * user does not own never appears in that set, so it can NEVER become the
 * `portfolio_id` of an insert. The unowned-id-is-a-no-op case below is the
 * non-vacuous pin for that guarantee — it fails if the pre-select wiring ever
 * matches against anything other than the owned set.
 */

const { mockInsert, mockGetUser, mockOrder, currentSearchParams } = vi.hoisted(
  () => ({
    mockInsert: vi.fn(),
    mockGetUser: vi.fn(),
    mockOrder: vi.fn(),
    currentSearchParams: { value: new URLSearchParams() },
  }),
);

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

vi.mock("next/navigation", () => ({
  useSearchParams: () => currentSearchParams.value,
}));

import { AddToPortfolio } from "./AddToPortfolio";

const TEST_USER_ID = "00000000-0000-0000-0000-aaaaaaaaaaaa";
const STRATEGY_ID = "11111111-1111-1111-1111-111111111111";
const OWNED_PORTFOLIO_ID = "22222222-2222-2222-2222-222222222222";
const OTHER_OWNED_ID = "33333333-3333-3333-3333-333333333333";
const UNOWNED_PORTFOLIO_ID = "99999999-9999-9999-9999-999999999999";

const OWNED_PORTFOLIOS = [
  { id: OWNED_PORTFOLIO_ID, name: "Aggressive blend" },
  { id: OTHER_OWNED_ID, name: "Conservative" },
];

beforeEach(() => {
  mockInsert.mockReset();
  mockGetUser.mockReset();
  mockOrder.mockReset();
  currentSearchParams.value = new URLSearchParams();
  mockGetUser.mockResolvedValue({ data: { user: { id: TEST_USER_ID } } });
  // The owned-portfolio fetch resolves to exactly the user's RLS-scoped set.
  mockOrder.mockResolvedValue({ data: OWNED_PORTFOLIOS, error: null });
  mockInsert.mockResolvedValue({ error: null });
});

describe("<AddToPortfolio> — FLOW-01 ?portfolio default-select", () => {
  it("pre-selects the OWNED portfolio from ?portfolio and attaches in one gesture", async () => {
    currentSearchParams.value = new URLSearchParams({
      portfolio: OWNED_PORTFOLIO_ID,
    });

    render(<AddToPortfolio strategyId={STRATEGY_ID} />);

    // ONE gesture: opening the dropdown is the only user action; the matching
    // owned portfolio is attached automatically.
    fireEvent.click(screen.getByRole("button", { name: /portfolio/i }));

    await waitFor(() => expect(mockInsert).toHaveBeenCalledTimes(1));
    expect(mockInsert).toHaveBeenCalledWith({
      portfolio_id: OWNED_PORTFOLIO_ID,
      strategy_id: STRATEGY_ID,
    });
  });

  it("treats a ?portfolio id the user does NOT own as a no-op (never an insert target)", async () => {
    currentSearchParams.value = new URLSearchParams({
      portfolio: UNOWNED_PORTFOLIO_ID,
    });

    render(<AddToPortfolio strategyId={STRATEGY_ID} />);

    fireEvent.click(screen.getByRole("button", { name: /portfolio/i }));

    // The owned-portfolio fetch must have resolved (so the auto-attach path
    // has had its chance to fire) — assert the dropdown rendered the owned
    // options, proving the fetch completed before we check the no-op.
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Aggressive blend" }),
      ).toBeInTheDocument(),
    );

    // No insert may target the unowned id...
    const unownedInsert = mockInsert.mock.calls.find(
      (c) => c[0]?.portfolio_id === UNOWNED_PORTFOLIO_ID,
    );
    expect(unownedInsert).toBeUndefined();
    // ...and because the id matched no owned portfolio, no auto-attach fired
    // at all — behavior degrades to the manual dropdown.
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("is unchanged with no ?portfolio param — manual selection still works", async () => {
    // No search param set (default URLSearchParams()).
    render(<AddToPortfolio strategyId={STRATEGY_ID} />);

    fireEvent.click(screen.getByRole("button", { name: /portfolio/i }));

    const option = await screen.findByRole("button", {
      name: "Aggressive blend",
    });
    // Nothing auto-attached on open.
    expect(mockInsert).not.toHaveBeenCalled();

    // Manual click still attaches via the existing handleAdd path.
    fireEvent.click(option);
    await waitFor(() => expect(mockInsert).toHaveBeenCalledTimes(1));
    expect(mockInsert).toHaveBeenCalledWith({
      portfolio_id: OWNED_PORTFOLIO_ID,
      strategy_id: STRATEGY_ID,
    });
  });
});
