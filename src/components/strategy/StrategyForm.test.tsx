import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { StrategyForm } from "./StrategyForm";
import type { Strategy } from "@/lib/types";

/**
 * H-0405 (audit-2026-05-07) — StrategyForm must not leak raw Postgres error
 * text into the user-facing banner.
 *
 * The strategies insert/update used to pipe `error.message` straight into
 * setError. A SQLSTATE 42501 RLS / SECURITY DEFINER trigger RAISE (e.g. the
 * cross-tenant api_key_id guard from migration 028/029) embeds two UUIDs and
 * the migration name in that message — a privilege-escalation hint and
 * internal-schema disclosure shown verbatim to the end user. The fix routes
 * every DB error through toUserFacingStrategyError(), which returns one of two
 * intent-specific messages and never echoes the raw text.
 *
 * WHY this matters (Rule 9): the banner is the only consumer of the error
 * state, so the test pins the redaction at the rendered-UI boundary — the exact
 * place the leak was visible. We assert the safe copy renders AND the sensitive
 * tokens (UUIDs, migration name, column names) do NOT.
 */

const routerPushMock = vi.fn();
const routerRefreshMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: routerPushMock,
    refresh: routerRefreshMock,
    back: vi.fn(),
    forward: vi.fn(),
    replace: vi.fn(),
    prefetch: vi.fn(),
  }),
}));

// Controls what `.from("strategies").update(...).eq(...)` resolves to.
let strategiesUpdateResult: { error: { code?: string; message?: string } | null } = {
  error: null,
};

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: {
      getUser: () =>
        Promise.resolve({ data: { user: { id: "user-a" } }, error: null }),
    },
    from: (table: string) => {
      if (table === "discovery_categories") {
        return {
          select: () => ({
            order: () => Promise.resolve({ data: [], error: null }),
          }),
        };
      }
      if (table === "strategies") {
        return {
          update: () => ({
            eq: () => Promise.resolve(strategiesUpdateResult),
          }),
        };
      }
      throw new Error(`unexpected from(${table})`);
    },
  }),
}));

const EDIT_STRATEGY = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Momentum Alpha",
  description: "desc",
  category_id: "cat-1",
  strategy_types: ["systematic"],
  subtypes: [],
  markets: ["crypto"],
  supported_exchanges: ["binance"],
  leverage_range: null,
  aum: null,
  max_capacity: null,
  api_key_id: "key-1",
} as unknown as Strategy;

beforeEach(() => {
  routerPushMock.mockClear();
  routerRefreshMock.mockClear();
  strategiesUpdateResult = { error: null };
  // jsdom lacks HTMLDialogElement methods the <Modal> uses on mount.
  if (!HTMLDialogElement.prototype.showModal) {
    HTMLDialogElement.prototype.showModal = function showModal() {
      this.setAttribute("open", "");
    };
  }
  if (!HTMLDialogElement.prototype.close) {
    HTMLDialogElement.prototype.close = function close() {
      this.removeAttribute("open");
    };
  }
});

afterEach(() => {
  vi.clearAllMocks();
});

function submitEditForm() {
  render(<StrategyForm mode="edit" strategy={EDIT_STRATEGY} />);
  fireEvent.click(screen.getByRole("button", { name: /save changes/i }));
}

describe("StrategyForm — H-0405 error redaction", () => {
  it("redacts a 42501 cross-tenant trigger message to a safe banner (no UUIDs / migration name)", async () => {
    strategiesUpdateResult = {
      error: {
        code: "42501",
        message:
          "api_key_id 11111111-1111-1111-1111-111111111111 does not belong to user 22222222-2222-2222-2222-222222222222 (cross-tenant linkage blocked by migration 028/029)",
      },
    };
    submitEditForm();

    expect(
      await screen.findByText("You can only link API keys you own."),
    ).toBeInTheDocument();
    // The raw leak must be gone from the rendered UI.
    expect(screen.queryByText(/cross-tenant linkage blocked/)).not.toBeInTheDocument();
    expect(screen.queryByText(/migration 028/)).not.toBeInTheDocument();
    expect(screen.queryByText(/11111111-1111-1111/)).not.toBeInTheDocument();
    expect(routerPushMock).not.toHaveBeenCalled();
  });

  it("redacts any other raw DB error to a generic message (no column/constraint text)", async () => {
    strategiesUpdateResult = {
      error: {
        code: "23502",
        message: 'null value in column "name" violates not-null constraint',
      },
    };
    submitEditForm();

    expect(
      await screen.findByText("Couldn't save your strategy. Please try again."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/not-null constraint/)).not.toBeInTheDocument();
    expect(screen.queryByText(/violates/)).not.toBeInTheDocument();
  });

  it("navigates on success and shows no error banner (happy path preserved)", async () => {
    strategiesUpdateResult = { error: null };
    submitEditForm();

    await waitFor(() => expect(routerPushMock).toHaveBeenCalledWith("/strategies"));
    expect(
      screen.queryByText("Couldn't save your strategy. Please try again."),
    ).not.toBeInTheDocument();
  });
});
