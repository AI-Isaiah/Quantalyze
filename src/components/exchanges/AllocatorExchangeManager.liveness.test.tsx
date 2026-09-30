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

  // 169.3 review round 1 WR-03 / SFH-03: with no live key the header asserts
  // nothing about the book. "no open positions yet", "auto-synced" and "first
  // sync in progress" each describe a key that reads the account, and none does.
  it("a lone revoked key reads '0 connected' above its row, never the empty state", () => {
    render(
      <AllocatorExchangeManager hasHoldings={false} initialKeys={[REVOKED]} />,
    );
    expect(subtitle()).toBe("0 connected");
    expect(screen.queryByText("No exchanges connected yet.")).toBeNull();
    expect(keyRow("Revoked OKX")).toBeTruthy();
  });
});

describe("AllocatorExchangeManager — the header suffix reads live keys only (WR-03)", () => {
  it("a lone revoked key with holdings still on file never reads 'auto-synced'", () => {
    render(<AllocatorExchangeManager hasHoldings={true} initialKeys={[REVOKED]} />);
    expect(subtitle()).toBe("0 connected");
    expect(subtitle()).not.toMatch(/auto-synced/);
  });

  it("a lone inactive key left in syncing never reads 'first sync in progress'", () => {
    render(
      <AllocatorExchangeManager
        hasHoldings={false}
        initialKeys={[makeKey({ id: "key-off", label: "Off Deribit", is_active: false, sync_status: "syncing" })]}
      />,
    );
    expect(subtitle()).toBe("0 connected");
  });

  it("an inactive key in syncing does not make a live key's book read 'first sync in progress'", () => {
    render(
      <AllocatorExchangeManager
        hasHoldings={false}
        initialKeys={[
          LIVE,
          makeKey({ id: "key-off", label: "Off Deribit", is_active: false, sync_status: "syncing" }),
        ]}
      />,
    );
    expect(subtitle()).toBe("1 connected · no open positions yet");
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

  // 169.3 review round 1 WR-02 / SFH-04: the balance and the note used two
  // different "is this key working" tests. isLiveKey rejects only revoked, the
  // note's D-18 rule also rejects sign_in_failed and error, so a failing key of
  // a duplicate pair printed the account's balance beside its working partner.
  // One rule now picks the row that reads the account: a working key first,
  // the holder before a marked key, then the lowest id. Exactly one Balance.
  it.each(["error", "sign_in_failed"])(
    "a holder in %s and a working marked key show the balance once, on the working key",
    (status) => {
      render(
        <AllocatorExchangeManager
          hasHoldings={true}
          initialKeys={[
            makeKey({ id: "key-holder", label: "Holder Binance", sync_status: status, account_balance_usdt: 5_000 }),
            shared("key-dup-1", "Dup One"),
          ]}
        />,
      );
      expect(screen.getAllByText(/Balance \$5,000/)).toHaveLength(1);
      expect(readOnlyLine("Dup One")).toBe("binance · Read-only · Balance $5,000");
      expect(readOnlyLine("Holder Binance")).toBe("binance · Read-only");
    },
  );

  it.each(["error", "sign_in_failed"])(
    "a marked key in %s reads through its working holder and shows no balance",
    (status) => {
      render(
        <AllocatorExchangeManager
          hasHoldings={true}
          initialKeys={[
            HOLDER,
            makeKey({
              id: "key-dup-1",
              label: "Dup One",
              sync_status: status,
              account_balance_usdt: 5_000,
              account_share_kind: "duplicate",
              account_shared_with_api_key_id: "key-holder",
            }),
          ]}
        />,
      );
      expect(screen.getAllByText(/Balance \$5,000/)).toHaveLength(1);
      expect(readOnlyLine("Holder Binance")).toBe("binance · Read-only · Balance $5,000");
      expect(readOnlyLine("Dup One")).toBe("binance · Read-only");
    },
  );

  it("both keys of a pair failing still show the balance once, on the holder", () => {
    render(
      <AllocatorExchangeManager
        hasHoldings={true}
        initialKeys={[
          makeKey({ id: "key-holder", label: "Holder Binance", sync_status: "error", account_balance_usdt: 5_000 }),
          makeKey({
            id: "key-dup-1",
            label: "Dup One",
            sync_status: "error",
            account_balance_usdt: 5_000,
            account_share_kind: "duplicate",
            account_shared_with_api_key_id: "key-holder",
          }),
        ]}
      />,
    );
    expect(screen.getAllByText(/Balance \$5,000/)).toHaveLength(1);
    expect(readOnlyLine("Holder Binance")).toBe("binance · Read-only · Balance $5,000");
  });

  it("a failing holder with two working marked keys shows the balance once", () => {
    render(
      <AllocatorExchangeManager
        hasHoldings={true}
        initialKeys={[
          makeKey({ id: "key-holder", label: "Holder Binance", sync_status: "error", account_balance_usdt: 5_000 }),
          shared("key-dup-2", "Dup Two"),
          shared("key-dup-1", "Dup One"),
        ]}
      />,
    );
    expect(screen.getAllByText(/Balance \$5,000/)).toHaveLength(1);
    expect(readOnlyLine("Dup One")).toBe("binance · Read-only · Balance $5,000");
  });

  it("a lone key in error keeps its balance (only a pair is collapsed)", () => {
    render(
      <AllocatorExchangeManager
        hasHoldings={true}
        initialKeys={[makeKey({ sync_status: "error" })]}
      />,
    );
    expect(readOnlyLine("Live Binance")).toBe("binance · Read-only · Balance $1,000");
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

/**
 * Founder D-74 (2026-09-30), review round 1 WR-02 / SFH-04 — the balance is
 * grouped by the 167.1.2 D-16(a) account identity (`accountIdentityTokens`),
 * not by the `duplicate` marker alone. Before D-74 a composite_member pair and
 * two unmarked keys on one venue account id each printed the account's balance
 * on both rows, so one account read as twice its capital. Now one row carries
 * it and the other rows say which. D-74 supersedes plan 03's "a live
 * composite_member key keeps its balance".
 */
describe("AllocatorExchangeManager — one balance per account identity (D-74)", () => {
  function readOnlyLine(label: string): string {
    return within(keyRow(label)).getByText(/Read-only/).textContent ?? "";
  }
  function elsewhereNote(label: string): string | null {
    return within(keyRow(label)).queryByTestId("balance-shown-elsewhere")?.textContent ?? null;
  }

  it("a composite_member pair shows the balance once, on the holder; the member names it", () => {
    render(
      <AllocatorExchangeManager
        hasHoldings={true}
        initialKeys={[
          makeKey({ id: "key-a", label: "Holder Binance", venue_account_id: "V-1", account_balance_usdt: 5_000 }),
          makeKey({
            id: "key-b",
            label: "Member Binance",
            account_balance_usdt: 5_000,
            account_share_kind: "composite_member",
            account_shared_with_api_key_id: "key-a",
          }),
        ]}
      />,
    );
    expect(screen.getAllByText(/Balance \$5,000/)).toHaveLength(1);
    expect(readOnlyLine("Holder Binance")).toBe("binance · Read-only · Balance $5,000");
    expect(elsewhereNote("Holder Binance")).toBeNull();
    expect(readOnlyLine("Member Binance")).toBe("binance · Read-only");
    expect(elsewhereNote("Member Binance")).toBe("Balance shown on Holder Binance");
  });

  it("two unmarked keys on one venue account id show the balance once, on the lowest id", () => {
    render(
      <AllocatorExchangeManager
        hasHoldings={true}
        initialKeys={[
          makeKey({ id: "key-b", label: "Second Binance", venue_account_id: "V-1", account_balance_usdt: 5_000 }),
          makeKey({ id: "key-a", label: "First Binance", venue_account_id: "V-1", account_balance_usdt: 5_000 }),
        ]}
      />,
    );
    expect(screen.getAllByText(/Balance \$5,000/)).toHaveLength(1);
    expect(readOnlyLine("First Binance")).toBe("binance · Read-only · Balance $5,000");
    expect(readOnlyLine("Second Binance")).toBe("binance · Read-only");
    expect(elsewhereNote("Second Binance")).toBe("Balance shown on First Binance");
  });

  it("a working key carries the balance before a failing twin with a lower id", () => {
    render(
      <AllocatorExchangeManager
        hasHoldings={true}
        initialKeys={[
          makeKey({ id: "key-a", label: "First Binance", venue_account_id: "V-1", sync_status: "error", account_balance_usdt: 5_000 }),
          makeKey({ id: "key-b", label: "Second Binance", venue_account_id: "V-1", account_balance_usdt: 5_000 }),
        ]}
      />,
    );
    expect(screen.getAllByText(/Balance \$5,000/)).toHaveLength(1);
    expect(readOnlyLine("Second Binance")).toBe("binance · Read-only · Balance $5,000");
    expect(elsewhereNote("First Binance")).toBe("Balance shown on Second Binance");
  });

  it("a key on a different venue account keeps its own balance and gets no note", () => {
    render(
      <AllocatorExchangeManager
        hasHoldings={true}
        initialKeys={[
          makeKey({ id: "key-a", label: "First Binance", venue_account_id: "V-1", account_balance_usdt: 5_000 }),
          makeKey({ id: "key-b", label: "Other Binance", venue_account_id: "V-2", account_balance_usdt: 3_000 }),
          makeKey({ id: "key-c", label: "Unknown Binance", venue_account_id: null, account_balance_usdt: 2_000 }),
        ]}
      />,
    );
    expect(readOnlyLine("First Binance")).toBe("binance · Read-only · Balance $5,000");
    expect(readOnlyLine("Other Binance")).toBe("binance · Read-only · Balance $3,000");
    expect(readOnlyLine("Unknown Binance")).toBe("binance · Read-only · Balance $2,000");
    expect(screen.queryAllByTestId("balance-shown-elsewhere")).toHaveLength(0);
  });

  it("a revoked key on a live key's account shows no balance and names the live row", () => {
    render(
      <AllocatorExchangeManager
        hasHoldings={true}
        initialKeys={[
          makeKey({ id: "key-a", label: "Revoked Binance", venue_account_id: "V-1", sync_status: "revoked", account_balance_usdt: 7_000 }),
          makeKey({ id: "key-b", label: "Live Twin", venue_account_id: "V-1", account_balance_usdt: 5_000 }),
        ]}
      />,
    );
    expect(screen.queryByText(/\$7,000/)).toBeNull();
    expect(readOnlyLine("Revoked Binance")).toBe("binance · Read-only");
    expect(elsewhereNote("Revoked Binance")).toBe("Balance shown on Live Twin");
    expect(readOnlyLine("Live Twin")).toBe("binance · Read-only · Balance $5,000");
  });

  it("an account whose only key is revoked shows no balance and no note", () => {
    render(
      <AllocatorExchangeManager
        hasHoldings={true}
        initialKeys={[makeKey({ ...REVOKED, venue_account_id: "V-9", account_balance_usdt: 7_000 })]}
      />,
    );
    expect(readOnlyLine("Revoked OKX")).toBe("okx · Read-only");
    expect(elsewhereNote("Revoked OKX")).toBeNull();
  });

  it("a working duplicate keeps its share note and also names the balance row", () => {
    render(
      <AllocatorExchangeManager
        hasHoldings={true}
        initialKeys={[
          makeKey({ id: "key-a", label: "Holder Binance", account_balance_usdt: 5_000 }),
          makeKey({
            id: "key-b",
            label: "Dup Binance",
            account_balance_usdt: 5_000,
            account_share_kind: "duplicate",
            account_shared_with_api_key_id: "key-a",
          }),
        ]}
      />,
    );
    expect(screen.getAllByText(/Balance \$5,000/)).toHaveLength(1);
    expect(within(keyRow("Dup Binance")).getByRole("note").textContent).toBe(
      "This key reads the same exchange account as Binance — Holder Binance. Disconnect one of them.",
    );
    expect(elsewhereNote("Dup Binance")).toBe("Balance shown on Holder Binance");
  });
});
