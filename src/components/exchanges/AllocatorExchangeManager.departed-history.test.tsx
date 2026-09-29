import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { AllocatorExchangeManager } from "./AllocatorExchangeManager";

/**
 * Phase 167.1.2 plan 09 (D-05, D-09) — the departed-account overview.
 *
 * The founder asked for disconnected accounts to stay in the history "in an
 * overview ... that can be toggled on or off". Each departed key's card must
 * therefore say whether its history counts, until which day and why, from the
 * SAME inputs the derive job uses (first and last csv_daily_returns day, read
 * with the owner's own client), and its switch must call the owner RPC. A card
 * that guessed a day, or a switch whose failure left it flipped, would tell the
 * owner the book holds something it does not.
 */

const routerRefreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: routerRefreshMock,
    push: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    replace: vi.fn(),
    prefetch: vi.fn(),
  }),
}));

// Per-key returns days the owner's client reads: { [api_key_id]: [first, last] }.
let RETURNS_DAYS: Record<string, [string, string]> = {};
// Key ids whose key_inputs row carries a usable anchor.
let ANCHORED: Set<string> = new Set();
const csvReads: Array<{ keyId: string; ascending: boolean; limit: number }> = [];
const rpcMock = vi.fn();
const holdingsCountMock = vi.fn();

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    rpc: (name: string, args: unknown) => rpcMock(name, args),
    from: (table: string) => ({
      select: (_cols: string, _opts?: unknown) => {
        if (table === "csv_daily_returns") {
          return {
            eq: (_col: string, keyId: string) => ({
              order: (_c: string, opts: { ascending: boolean }) => ({
                limit: (n: number) => {
                  csvReads.push({ keyId, ascending: opts.ascending, limit: n });
                  const days = RETURNS_DAYS[keyId];
                  const day = days ? (opts.ascending ? days[0] : days[1]) : null;
                  return Promise.resolve({
                    data: day ? [{ date: day }] : [],
                    error: null,
                  });
                },
              }),
            }),
          };
        }
        if (table === "allocator_equity_derived") {
          return {
            in: (_col: string, kinds: string[]) =>
              Promise.resolve({
                data: kinds
                  .map((kind) => kind.replace("key_inputs:", ""))
                  .filter((id) => ANCHORED.has(id))
                  .map((id) => ({
                    kind: `key_inputs:${id}`,
                    payload: { anchor_usd: 1000 },
                  })),
                error: null,
              }),
          };
        }
        // allocator_holdings count probe (openDeleteConfirm).
        return {
          eq: () =>
            Promise.resolve(holdingsCountMock() ?? { count: 0, error: null }),
        };
      },
    }),
  }),
}));

beforeEach(() => {
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
  RETURNS_DAYS = {};
  ANCHORED = new Set();
  csvReads.length = 0;
  rpcMock.mockReset();
  holdingsCountMock.mockReset();
  routerRefreshMock.mockReset();
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function makeKey(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "key-live",
    exchange: "binance",
    label: "Main Binance",
    is_active: true,
    sync_status: "complete" as string | null,
    last_sync_at: "2026-06-30T10:00:00Z",
    account_balance_usdt: 1_000,
    // Deliberately far from every returns day: the card must never read it.
    created_at: "2026-01-01T00:00:00Z",
    sync_error: null,
    last_429_at: null as string | null,
    disconnected_at: null as string | null,
    venue_account_id: null as string | null,
    account_shared_with_api_key_id: null as string | null,
    account_share_kind: null as string | null,
    history_inclusion: null as string | null,
    ...overrides,
  };
}

const LIVE = makeKey({ id: "key-live", venue_account_id: "acct-live" });

function departed(overrides: Partial<Record<string, unknown>> = {}) {
  return makeKey({
    id: "key-dep",
    label: "Old OKX",
    exchange: "okx",
    disconnected_at: "2026-06-10T15:30:00Z",
    ...overrides,
  });
}

function historyBlock(keyId: string): HTMLElement {
  return screen.getByTestId(`departed-history-${keyId}`);
}

function historySwitch(keyId: string): HTMLElement {
  return within(historyBlock(keyId)).getByRole("switch", {
    name: "Include this account's history",
  });
}

describe("AllocatorExchangeManager — departed-account history overview", () => {
  it("a disconnected key on its own account shows it counts until its disconnect day, switch on", async () => {
    RETURNS_DAYS = { "key-live": ["2026-06-01", "2026-06-30"], "key-dep": ["2026-06-01", "2026-06-12"] };
    ANCHORED = new Set(["key-dep"]);
    render(
      <AllocatorExchangeManager
        hasHoldings={true}
        initialKeys={[LIVE, departed({ venue_account_id: "acct-dep" })]}
      />,
    );
    // While the days load the line says so; it never guesses a day.
    expect(historyBlock("key-dep").textContent).toContain("Checking this key's history");
    await waitFor(() =>
      expect(historyBlock("key-dep").textContent).toContain(
        "History included until 2026-06-10.",
      ),
    );
    expect(historySwitch("key-dep").getAttribute("aria-checked")).toBe("true");
    // The first and last returns day come from one ascending and one
    // descending limit(1) read per key, through the owner's own client.
    const depReads = csvReads.filter((r) => r.keyId === "key-dep");
    expect(depReads).toEqual(
      expect.arrayContaining([
        { keyId: "key-dep", ascending: true, limit: 1 },
        { keyId: "key-dep", ascending: false, limit: 1 },
      ]),
    );
  });

  it("a disconnected key whose account is unknown is not included by default, switch off", async () => {
    RETURNS_DAYS = { "key-dep": ["2026-06-01", "2026-06-10"] };
    render(<AllocatorExchangeManager hasHoldings={true} initialKeys={[LIVE, departed()]} />);
    await waitFor(() =>
      expect(historyBlock("key-dep").textContent).toContain(
        "History not included: we cannot tell whether this key read the same exchange account as a key you still have connected. Include it if it was a different account.",
      ),
    );
    expect(historySwitch("key-dep").getAttribute("aria-checked")).toBe("false");
  });

  it("the switch calls the owner RPC, shows the new state and says the history is recomputed", async () => {
    RETURNS_DAYS = { "key-dep": ["2026-06-01", "2026-06-10"] };
    ANCHORED = new Set(["key-dep"]);
    rpcMock.mockResolvedValue({ data: true, error: null });
    render(<AllocatorExchangeManager hasHoldings={true} initialKeys={[LIVE, departed()]} />);
    await waitFor(() =>
      expect(historySwitch("key-dep").getAttribute("aria-checked")).toBe("false"),
    );
    fireEvent.click(historySwitch("key-dep"));
    await waitFor(() =>
      expect(rpcMock).toHaveBeenCalledWith("set_departed_key_history_inclusion", {
        p_api_key_id: "key-dep",
        p_inclusion: "include",
      }),
    );
    await waitFor(() =>
      expect(historySwitch("key-dep").getAttribute("aria-checked")).toBe("true"),
    );
    expect(historyBlock("key-dep").textContent).toContain("History included until 2026-06-10.");
    expect(historyBlock("key-dep").textContent).toContain(
      "Your equity history is recomputed with this change within a few minutes.",
    );

    // And back off: 'exclude'.
    fireEvent.click(historySwitch("key-dep"));
    await waitFor(() =>
      expect(rpcMock).toHaveBeenLastCalledWith("set_departed_key_history_inclusion", {
        p_api_key_id: "key-dep",
        p_inclusion: "exclude",
      }),
    );
    await waitFor(() =>
      expect(historySwitch("key-dep").getAttribute("aria-checked")).toBe("false"),
    );
    expect(historyBlock("key-dep").textContent).toContain("History not included: you excluded it.");
  });

  it("an RPC failure rolls the switch back and shows the error line", async () => {
    RETURNS_DAYS = { "key-dep": ["2026-06-01", "2026-06-10"] };
    rpcMock.mockResolvedValue({
      data: null,
      error: { code: "42501", message: "not_authenticated", details: null, hint: null },
    });
    render(<AllocatorExchangeManager hasHoldings={true} initialKeys={[LIVE, departed()]} />);
    await waitFor(() =>
      expect(historySwitch("key-dep").getAttribute("aria-checked")).toBe("false"),
    );
    fireEvent.click(historySwitch("key-dep"));
    const alert = await within(historyBlock("key-dep")).findByRole("alert");
    expect(alert.textContent).toBe(
      "Could not change this key's history: you are signed out or this key is not yours.",
    );
    expect(historySwitch("key-dep").getAttribute("aria-checked")).toBe("false");
    expect(historyBlock("key-dep").textContent).toContain("History not included: we cannot tell");
    expect(historyBlock("key-dep").textContent).not.toContain("recomputed");
  });

  it("maps a running recompose (55006) by code and renders its DETAIL and HINT", async () => {
    RETURNS_DAYS = { "key-dep": ["2026-06-01", "2026-06-10"] };
    rpcMock.mockResolvedValue({
      data: null,
      error: {
        code: "55006",
        message: "HISTORY_RECOMPOSE_IN_PROGRESS",
        details:
          "A recompose of your equity history has been running for 3 minute(s). Try again when it finishes; nothing was changed.",
        hint: "If it does not finish, a running worker reclaims a recompose that has run for more than 10 minutes and queues it again. Retry after that.",
      },
    });
    render(<AllocatorExchangeManager hasHoldings={true} initialKeys={[LIVE, departed()]} />);
    await waitFor(() =>
      expect(historySwitch("key-dep").getAttribute("aria-checked")).toBe("false"),
    );
    fireEvent.click(historySwitch("key-dep"));
    const alert = await within(historyBlock("key-dep")).findByRole("alert");
    expect(alert.textContent).toBe(
      "A recompose of your equity history has been running for 3 minute(s). Try again when it finishes; nothing was changed. If it does not finish, a running worker reclaims a recompose that has run for more than 10 minutes and queues it again. Retry after that.",
    );
    expect(historySwitch("key-dep").getAttribute("aria-checked")).toBe("false");
  });

  it("a 55006 without DETAIL or HINT falls back to a fixed sentence", async () => {
    RETURNS_DAYS = { "key-dep": ["2026-06-01", "2026-06-10"] };
    rpcMock.mockResolvedValue({
      data: null,
      error: { code: "55006", message: "HISTORY_RECOMPOSE_IN_PROGRESS", details: null, hint: null },
    });
    render(<AllocatorExchangeManager hasHoldings={true} initialKeys={[LIVE, departed()]} />);
    await waitFor(() =>
      expect(historySwitch("key-dep").getAttribute("aria-checked")).toBe("false"),
    );
    fireEvent.click(historySwitch("key-dep"));
    const alert = await within(historyBlock("key-dep")).findByRole("alert");
    expect(alert.textContent).toBe(
      "Your history is being recomputed right now. Try again in a few minutes.",
    );
  });

  it("a key that is live again (55000) says so by code, never by message", async () => {
    RETURNS_DAYS = { "key-dep": ["2026-06-01", "2026-06-10"] };
    rpcMock.mockResolvedValue({
      data: null,
      error: { code: "55000", message: "anything at all", details: null, hint: null },
    });
    render(<AllocatorExchangeManager hasHoldings={true} initialKeys={[LIVE, departed()]} />);
    await waitFor(() =>
      expect(historySwitch("key-dep").getAttribute("aria-checked")).toBe("false"),
    );
    fireEvent.click(historySwitch("key-dep"));
    const alert = await within(historyBlock("key-dep")).findByRole("alert");
    expect(alert.textContent).toBe(
      "This key is connected again, so its history always counts. Refresh the page.",
    );
  });

  it("a revoked key that was never disconnected shows the same line and switch", async () => {
    RETURNS_DAYS = { "key-live": ["2026-06-01", "2026-06-30"], "key-rev": ["2026-06-01", "2026-06-08"] };
    ANCHORED = new Set(["key-rev"]);
    render(
      <AllocatorExchangeManager
        hasHoldings={true}
        initialKeys={[
          LIVE,
          makeKey({ id: "key-rev", label: "Revoked", sync_status: "revoked", venue_account_id: "acct-rev" }),
        ]}
      />,
    );
    await waitFor(() =>
      expect(historyBlock("key-rev").textContent).toContain("History included until 2026-06-08."),
    );
    expect(historySwitch("key-rev").getAttribute("aria-checked")).toBe("true");
    // A live, working key has no history choice.
    expect(screen.queryByTestId("departed-history-key-live")).toBeNull();
  });

  it("a departed key on the same account as a live key stops the day before the live key starts", async () => {
    RETURNS_DAYS = { "key-live": ["2026-06-15", "2026-06-30"], "key-dep": ["2026-06-01", "2026-06-18"] };
    ANCHORED = new Set(["key-dep"]);
    render(
      <AllocatorExchangeManager
        hasHoldings={true}
        initialKeys={[LIVE, departed({ exchange: "binance", venue_account_id: "acct-live", disconnected_at: "2026-06-18T02:00:00Z" })]}
      />,
    );
    await waitFor(() =>
      expect(historyBlock("key-dep").textContent).toContain(
        "History included until 2026-06-14. From the next day a key you still have connected reads this account.",
      ),
    );
    // The live key's first day was read too: it bounds the departed one.
    expect(csvReads.some((r) => r.keyId === "key-live" && r.ascending)).toBe(true);
  });

  it("an included key whose saved balance is gone says its history is not available", async () => {
    RETURNS_DAYS = { "key-dep": ["2026-06-01", "2026-06-10"] };
    render(
      <AllocatorExchangeManager
        hasHoldings={true}
        initialKeys={[LIVE, departed({ venue_account_id: "acct-dep" })]}
      />,
    );
    await waitFor(() =>
      expect(historyBlock("key-dep").textContent).toContain("History not available:"),
    );
  });

  it("the delete confirm says deleting removes the account's history, and only when deleting", async () => {
    holdingsCountMock.mockReturnValue({ count: 3, error: null });
    render(<AllocatorExchangeManager hasHoldings={true} initialKeys={[LIVE]} />);
    fireEvent.click(screen.getByRole("button", { name: /Disconnect binance key/i }));
    const checkbox = await screen.findByRole("checkbox");
    const sentence =
      "Deleting also removes this account's history. Disconnect instead to keep it.";
    expect(screen.queryByText(sentence)).toBeNull();
    fireEvent.click(checkbox);
    expect(screen.getByText(sentence)).toBeTruthy();
  });
});
