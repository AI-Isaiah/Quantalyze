import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * Regression tests for FIX-LIST P163 / atomic ID G8.F.1.
 *
 * Migration 023 added a partial UNIQUE index on `portfolios(user_id) WHERE
 * is_test=false`. CreatePortfolioForm previously inserted with no `is_test`
 * column, which let DEFAULT false take effect → every 2nd Create attempt
 * for an existing user triggered Postgres SQLSTATE 23505 with the form's
 * generic "Failed to create portfolio. Please try again." toast.
 *
 * Post-fix the form explicitly sets `is_test=true` so the partial UNIQUE
 * index does not apply, matching the v0.4.0 product semantics where the
 * /portfolios surface is a "Build collections of strategies for
 * comparison" builder — not the user's real book.
 */

// jsdom does not implement HTMLDialogElement.showModal()/close(); the
// Modal component calls them in a useEffect when `open` flips. Stub them
// to make the modal-open path observable in component tests.
if (typeof HTMLDialogElement !== "undefined") {
  if (!HTMLDialogElement.prototype.showModal) {
    HTMLDialogElement.prototype.showModal = function showModal() {
      this.setAttribute("open", "");
      // Cast through unknown to set the readonly `open` getter under jsdom.
      (this as unknown as { open: boolean }).open = true;
    };
  }
  if (!HTMLDialogElement.prototype.close) {
    HTMLDialogElement.prototype.close = function close() {
      this.removeAttribute("open");
      (this as unknown as { open: boolean }).open = false;
    };
  }
}

const { mockInsert, mockGetUser, mockRouterRefresh } = vi.hoisted(() => ({
  mockInsert: vi.fn(),
  mockGetUser: vi.fn(),
  mockRouterRefresh: vi.fn(),
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: {
      getUser: mockGetUser,
    },
    from: (_table: string) => ({
      insert: mockInsert,
    }),
  }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mockRouterRefresh }),
}));

import { CreatePortfolioForm } from "./CreatePortfolioForm";

const TEST_USER_ID = "00000000-0000-0000-0000-aaaaaaaaaaaa";

beforeEach(() => {
  mockInsert.mockReset();
  mockGetUser.mockReset();
  mockRouterRefresh.mockReset();
  mockGetUser.mockResolvedValue({ data: { user: { id: TEST_USER_ID } } });
});

async function openModalAndSubmit(name = "My scenario") {
  render(<CreatePortfolioForm />);
  // Two "Create Portfolio" buttons render via the modal trigger; click the
  // first one to open the modal.
  fireEvent.click(screen.getAllByRole("button", { name: /create portfolio/i })[0]);
  const nameInput = await screen.findByLabelText(/name/i);
  fireEvent.change(nameInput, { target: { value: name } });
  // Submit the form via the visible "Create" button (not the trigger).
  fireEvent.click(screen.getByRole("button", { name: /^create$/i }));
}

describe("<CreatePortfolioForm> — G8.F.1 is_test discipline", () => {
  it("inserts new portfolios with is_test=true so migration 023's partial UNIQUE index does not collide", async () => {
    mockInsert.mockResolvedValue({ error: null });

    await openModalAndSubmit("Aggressive blend");

    await waitFor(() => expect(mockInsert).toHaveBeenCalledTimes(1));
    const insertedRow = mockInsert.mock.calls[0][0];
    expect(insertedRow).toMatchObject({
      user_id: TEST_USER_ID,
      name: "Aggressive blend",
      // The contract under test: is_test must be true so the partial
      // UNIQUE index `(user_id) WHERE is_test=false` from migration 023
      // is not engaged. A future regression that drops or flips this
      // field will re-introduce the v0.22 23505 dead-end on every 2nd
      // Create attempt.
      is_test: true,
    });
    expect(mockRouterRefresh).toHaveBeenCalled();
  });

  it("surfaces a friendly message instead of a generic toast on the 23505 unique-violation path", async () => {
    // Defense-in-depth assertion: even though is_test=true should never
    // hit 23505 in production today, the error mapper must remain so a
    // future revert / refactor that touches is_test produces a useful
    // toast instead of "Please try again." retry-loop UX.
    mockInsert.mockResolvedValue({
      error: { code: "23505", message: "duplicate key value violates unique constraint" },
    });

    await openModalAndSubmit();

    await waitFor(() =>
      expect(
        screen.getByText(/already have a portfolio with this configuration/i),
      ).toBeInTheDocument(),
    );
    expect(mockRouterRefresh).not.toHaveBeenCalled();
  });

  it("falls back to the generic copy for non-23505 insert errors", async () => {
    mockInsert.mockResolvedValue({
      error: { code: "08000", message: "connection failure" },
    });

    await openModalAndSubmit();

    await waitFor(() =>
      expect(
        screen.getByText(/Failed to create portfolio\. Please try again\./i),
      ).toBeInTheDocument(),
    );
  });
});
