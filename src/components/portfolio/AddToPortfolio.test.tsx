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

/**
 * 151 review A3 — the REAL Postgres message the D-03-A trigger raises.
 *
 * The component splits the 23514 arm on a substring of THIS text, so a fixture
 * that omits it (`{ code: "23514" }` alone, which is what this file seeded until
 * now) makes `error.message?.includes(...)` `undefined` and can only ever reach
 * the owner-voiced fallback: the `team_review` arm — the entire point of the
 * split — never executed in a test.
 *
 * Format lifted from the migration's RAISE
 * (supabase/migrations/20260806120000_strategies_capital_ownership.sql):
 *   'strategy % cannot become a position: capital_ownership=% (required: own_capital)'
 * with `%` fed `NEW.strategy_id` and `COALESCE(v_mark, 'unmarked')`. That the
 * SQL still emits `capital_ownership=%` is pinned structurally by
 * src/__tests__/phase-150-capital-ownership-invariant.test.ts — without that
 * pin, a reword there would send every third-party allocator down the
 * owner-voiced branch with this file still green.
 */
const RAW_UUID_IN_MESSAGE = "99999999-9999-4999-8999-999999999999";
function pgCheckViolationMessage(mark: string): string {
  return `strategy ${RAW_UUID_IN_MESSAGE} cannot become a position: capital_ownership=${mark} (required: own_capital)`;
}

// Literal oracles, typed here and NEVER imported from the component or from
// `@/lib/capital-ownership` — importing the string under test would make the
// assertion agree with whatever the code says.
// 151 review I3 — the team arm gained the attributed remedy ("Its owner can
// change that mark in My Strategies"). It fires for the strategy's OWNER too
// (the trigger's team_review disjunct carries no owner conjunct), and the owner
// is the one person who CAN flip the mark, so a sentence that only states the
// refusal leaves them with no lever. The remedy is third-person on purpose: a
// third-party allocator reaches the same arm and must not be sent to a screen
// that will not contain the row.
const COPY_TEAM_REVIEW =
  "This strategy is marked as a trading team's capital under review, so it can't be added to a portfolio. Its owner can change that mark in My Strategies.";
const COPY_OWNER_REMEDY =
  "This strategy isn't marked as your own capital — mark it in My Strategies first.";

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

  it("W-6 — an UNMARKED 23514 says WHY and names the remedy, not 'Failed to add'", async () => {
    // The only check constraint on this table is the Phase-150 D-03-A trigger:
    // a position may not be created for a strategy that is not marked as the
    // owner's own capital. The generic arm would report a system fault for a
    // decision the user can reverse in one screen.
    //
    // ARM 2 of the trigger: a SELF-OWNED strategy that was never marked (every
    // pre-150 row is NULL, which the RAISE renders as `unmarked`). This reader
    // owns the row, so "mark it in My Strategies" is a remedy they can actually
    // reach.
    mockInsert.mockResolvedValue({
      error: { code: "23514", message: pgCheckViolationMessage("unmarked") },
    });

    render(<AddToPortfolio strategyId={STRATEGY_ID} />);
    fireEvent.click(screen.getByRole("button", { name: /portfolio/i }));
    fireEvent.click(await screen.findByRole("button", { name: "Aggressive blend" }));

    expect(await screen.findByText(COPY_OWNER_REMEDY)).toBeInTheDocument();
    expect(screen.queryByText(COPY_TEAM_REVIEW)).not.toBeInTheDocument();
    expect(screen.queryByText("Failed to add")).not.toBeInTheDocument();
  });

  it("W-6 — a `team_review` 23514 speaks the TEAM arm and never tells a third party to go mark a row that isn't theirs", async () => {
    // ARM 1 of the trigger fires for ANYONE — owner or third-party allocator.
    // The owner-voiced remedy is actively WRONG here: a third party cannot see
    // that strategy in My Strategies, no route lets them mark it, and the copy
    // asserts the row is theirs. So the absence of the remedy sentence is a
    // first-class assertion, not the mere complement of the positive one.
    mockInsert.mockResolvedValue({
      error: { code: "23514", message: pgCheckViolationMessage("team_review") },
    });

    render(<AddToPortfolio strategyId={STRATEGY_ID} />);
    fireEvent.click(screen.getByRole("button", { name: /portfolio/i }));
    fireEvent.click(await screen.findByRole("button", { name: "Aggressive blend" }));

    expect(await screen.findByText(COPY_TEAM_REVIEW)).toBeInTheDocument();
    expect(screen.queryByText(COPY_OWNER_REMEDY)).not.toBeInTheDocument();
    expect(screen.queryByText("Failed to add")).not.toBeInTheDocument();

    // 151 review I3 — the arm ALSO fires for the strategy's own owner, who can
    // flip the mark. Asserted as a property so a reword that keeps the tone and
    // drops the lever still reddens: the mark and the screen must both be
    // named, and the naming must stay third-person.
    const shown = (await screen.findByText(COPY_TEAM_REVIEW)).textContent ?? "";
    expect(shown).toMatch(/owner can change/i);
    expect(shown).toMatch(/My Strategies/);
    expect(shown).not.toMatch(/\byour\b/i);

    // The raw PL/pgSQL text carries an internal strategy UUID. It is the SIGNAL
    // this branch reads, never something the reader sees.
    expect(document.body.textContent).not.toContain(RAW_UUID_IN_MESSAGE);
    expect(document.body.textContent).not.toContain("capital_ownership=");
  });

  it("every OTHER insert error keeps the existing generic arm byte-identical", async () => {
    // The 23514 mapping must not widen into "any error is a mark problem":
    // an unrelated fault still reads as a fault.
    mockInsert.mockResolvedValue({ error: { code: "42501" } });

    render(<AddToPortfolio strategyId={STRATEGY_ID} />);
    fireEvent.click(screen.getByRole("button", { name: /portfolio/i }));
    fireEvent.click(await screen.findByRole("button", { name: "Aggressive blend" }));

    expect(await screen.findByText("Failed to add")).toBeInTheDocument();
    expect(screen.queryByText(/own capital/i)).not.toBeInTheDocument();
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
