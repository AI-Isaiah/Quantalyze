import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { AllocatorExchangeManager } from "./AllocatorExchangeManager";

/**
 * Phase 169.3 plan 03 (SC7) — /profile Exchanges counts live keys only.
 *
 * "N connected" is a claim about which keys still read an exchange account for
 * the allocator. A key whose credentials were revoked reads nothing, so counting
 * it overstates the book's sources. The card must use 167.1.2's ONE departed
 * predicate (`isLiveKey` in src/lib/departed-history.ts, D-09), the same one the
 * derive and the departed-history card read, never a third inline definition.
 * The revoked key must still be on the page: it keeps its row, its revoked pill
 * and its Disconnect control, so nothing disappears silently.
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

// A departed key's row reads its returns days and anchor; answer with nothing.
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    rpc: vi.fn(),
    from: (table: string) => ({
      select: () => {
        if (table === "csv_daily_returns") {
          return {
            eq: () => ({
              order: () => ({
                limit: () => Promise.resolve({ data: [], error: null }),
              }),
            }),
          };
        }
        if (table === "allocator_equity_derived") {
          return { in: () => Promise.resolve({ data: [], error: null }) };
        }
        return { eq: () => Promise.resolve({ count: 0, error: null }) };
      },
    }),
  }),
}));

beforeEach(() => {
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
    label: "Live Binance",
    is_active: true,
    sync_status: "complete" as string | null,
    last_sync_at: "2026-06-30T10:00:00Z",
    account_balance_usdt: 1_000,
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

const LIVE = makeKey();
const REVOKED = makeKey({
  id: "key-revoked",
  exchange: "okx",
  label: "Revoked OKX",
  sync_status: "revoked",
});
const DISCONNECTED = makeKey({
  id: "key-gone",
  exchange: "bybit",
  label: "Gone Bybit",
  disconnected_at: "2026-06-10T15:30:00Z",
});

function subtitle(): string {
  const heading = screen.getByRole("heading", { name: "Exchange connections" });
  return heading.nextElementSibling?.textContent ?? "";
}

function keyRow(label: string): HTMLElement {
  const row = screen
    .getAllByTestId("allocator-key-row")
    .find((el) => within(el).queryByText(label) !== null);
  if (!row) throw new Error(`no active key row labelled ${label}`);
  return row;
}

describe("AllocatorExchangeManager — the connected count is live keys only (SC7)", () => {
  it("live + revoked + disconnected reads '1 connected': a revoked key is not connected", () => {
    render(
      <AllocatorExchangeManager
        hasHoldings={true}
        initialKeys={[LIVE, REVOKED, DISCONNECTED]}
      />,
    );
    expect(subtitle()).toBe("1 connected · Active Allocation auto-synced");
  });

  it("an inactive key that was never disconnected is not connected either", () => {
    render(
      <AllocatorExchangeManager
        hasHoldings={null}
        initialKeys={[LIVE, makeKey({ id: "key-off", label: "Off Deribit", is_active: false })]}
      />,
    );
    expect(subtitle()).toBe("1 connected");
  });

  it("two live keys still read '2 connected'", () => {
    render(
      <AllocatorExchangeManager
        hasHoldings={true}
        initialKeys={[LIVE, makeKey({ id: "key-live-2", label: "Second Binance" })]}
      />,
    );
    expect(subtitle()).toBe("2 connected · Active Allocation auto-synced");
  });

  it("the revoked key stays on the page with its own row and Disconnect control", () => {
    render(
      <AllocatorExchangeManager
        hasHoldings={true}
        initialKeys={[LIVE, REVOKED, DISCONNECTED]}
      />,
    );
    const row = keyRow("Revoked OKX");
    expect(
      within(row).getByRole("button", { name: "Disconnect okx key" }),
    ).toBeTruthy();
    // The disconnected key keeps its own section.
    expect(screen.getByRole("heading", { name: "Disconnected" })).toBeTruthy();
    expect(screen.getByText("Gone Bybit")).toBeTruthy();
  });

  it("a lone revoked key reads '0 connected' above its row, never the empty state", () => {
    render(
      <AllocatorExchangeManager hasHoldings={false} initialKeys={[REVOKED]} />,
    );
    expect(subtitle()).toBe("0 connected · no open positions yet");
    expect(screen.queryByText("No exchanges connected yet.")).toBeNull();
    expect(keyRow("Revoked OKX")).toBeTruthy();
  });
});

/**
 * SC7, 167.1.2 D-11 / D-18 — one exchange account's balance is shown once.
 *
 * The balance on a key row is the ACCOUNT's balance. Three keys reading one
 * account used to print that number three times, so the page read as three
 * times the capital. A key 167.1.2's `accountShareNote` names as reading
 * another working key's account shows that note instead of a balance; the
 * holder alone carries the number. The note's own reader rule decides, never
 * the raw marker column: a marked key whose holder is not working counts on
 * its own (D-18), so it keeps its balance.
 *
 * A revoked key shows NO balance. Its stored balance is from its last good
 * read, and nothing on the row can date that read: `last_sync_at` is the
 * trades cursor, which a failed sync holds back, not a balance timestamp. An
 * undated number next to a revoked key reads as current, so it is dropped.
 */
describe("AllocatorExchangeManager — no balance repeats, no revoked balance (SC7)", () => {
  const HOLDER = makeKey({
    id: "key-holder",
    label: "Holder Binance",
    account_balance_usdt: 5_000,
  });
  const shared = (id: string, label: string, holder = "key-holder") =>
    makeKey({
      id,
      label,
      account_balance_usdt: 5_000,
      account_share_kind: "duplicate",
      account_shared_with_api_key_id: holder,
    });

  function readOnlyLine(label: string): string {
    const line = within(keyRow(label)).getByText(/Read-only/);
    return line.textContent ?? "";
  }

  it("three keys on one account show the balance once, on the holder; the other two name it", () => {
    render(
      <AllocatorExchangeManager
        hasHoldings={true}
        initialKeys={[HOLDER, shared("key-dup-1", "Dup One"), shared("key-dup-2", "Dup Two")]}
      />,
    );
    expect(screen.getAllByText(/Balance \$5,000/)).toHaveLength(1);
    expect(readOnlyLine("Holder Binance")).toBe("binance · Read-only · Balance $5,000");
    for (const label of ["Dup One", "Dup Two"]) {
      expect(readOnlyLine(label)).toBe("binance · Read-only");
      expect(within(keyRow(label)).getByRole("note").textContent).toBe(
        "This key reads the same exchange account as Binance — Holder Binance. Disconnect one of them.",
      );
    }
  });

  it("a marked key whose holder is revoked counts on its own and keeps its balance (D-18)", () => {
    render(
      <AllocatorExchangeManager
        hasHoldings={true}
        initialKeys={[
          makeKey({ id: "key-holder", label: "Holder Binance", sync_status: "revoked" }),
          shared("key-dup-1", "Dup One"),
        ]}
      />,
    );
    expect(readOnlyLine("Dup One")).toBe("binance · Read-only · Balance $5,000");
    expect(within(keyRow("Dup One")).queryByRole("note")).toBeNull();
  });

  it("a revoked key with a stored balance shows no balance", () => {
    render(
      <AllocatorExchangeManager
        hasHoldings={true}
        initialKeys={[LIVE, makeKey({ ...REVOKED, account_balance_usdt: 7_000 })]}
      />,
    );
    expect(readOnlyLine("Revoked OKX")).toBe("okx · Read-only");
    expect(screen.queryByText(/\$7,000/)).toBeNull();
  });

  it("a live, unshared key keeps its balance", () => {
    render(<AllocatorExchangeManager hasHoldings={true} initialKeys={[LIVE]} />);
    expect(readOnlyLine("Live Binance")).toBe("binance · Read-only · Balance $1,000");
  });
});
