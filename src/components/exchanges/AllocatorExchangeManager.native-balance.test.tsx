import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { AllocatorExchangeManager } from "./AllocatorExchangeManager";

/**
 * Phase 164.6.6.2.1 plan 15 (D-07, D-17, D-02, D-21) — the key card's balance
 * line for a native-unit (BTC) account. UI-SPEC section E is the contract.
 *
 * A BTC account's truth is its BTC balance; the USD value is derived, so it
 * follows the native amount behind a `≈`, and it names the close it was priced
 * at. Every expected string below is a hand-typed literal: the oracle is the
 * spec text, never the component's own formatter.
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
    id: "key-btc",
    exchange: "deribit",
    label: "Deribit BTC",
    is_active: true,
    sync_status: "complete" as string | null,
    last_sync_at: "2026-10-09T10:00:00Z",
    account_balance_usdt: null as number | null,
    created_at: "2026-10-01T00:00:00Z",
    sync_error: null,
    last_429_at: null as string | null,
    disconnected_at: null as string | null,
    venue_account_id: null as string | null,
    account_shared_with_api_key_id: null as string | null,
    account_share_kind: null as string | null,
    history_inclusion: null as string | null,
    account_currency: "BTC" as string | null,
    account_balance_native: 0.4213 as number | string | null,
    account_balance_usdt_close_date: null as string | null,
    ...overrides,
  };
}

function renderKeys(keys: ReturnType<typeof makeKey>[]) {
  return render(<AllocatorExchangeManager hasHoldings={true} initialKeys={keys} />);
}

function keyRow(label: string): HTMLElement {
  const row = screen
    .getAllByTestId("allocator-key-row")
    .find((el) => within(el).queryByText(label) !== null);
  if (!row) throw new Error(`no active key row labelled ${label}`);
  return row;
}

/** The `<p>` carrying `{exchange} · Read-only · Balance …` for a row. */
function line(label: string): HTMLElement {
  return within(keyRow(label)).getByText(/Read-only/);
}

/** Every element inside the line that carries a `title`. */
function titledIn(el: HTMLElement): HTMLElement[] {
  return Array.from(el.querySelectorAll<HTMLElement>("[title]"));
}

describe("AllocatorExchangeManager — a native BTC key's balance (D-07, D-17)", () => {
  it("priced: the BTC amount, then the dated USD value, with the stored-close title", () => {
    renderKeys([
      makeKey({
        account_balance_native: 0.4213,
        account_balance_usdt: 26_099.54,
        account_balance_usdt_close_date: "2026-10-08",
      }),
    ]);
    const el = line("Deribit BTC");
    expect(el.textContent).toBe(
      "deribit · Read-only · Balance 0.4213 BTC · ≈ $26,100 at Oct 8 close",
    );
    const titled = titledIn(el);
    expect(titled).toHaveLength(1);
    expect(titled[0].getAttribute("title")).toBe(
      "Converted from BTC at the stored daily BTC close for Oct 8, 2026.",
    );
    expect(titled[0].textContent).toBe(" · Balance 0.4213 BTC · ≈ $26,100 at Oct 8 close");
  });

  it("unpriced: the BTC amount alone, no ≈ $ date or dash, with the not-stored title", () => {
    renderKeys([
      makeKey({
        account_balance_native: 0.4213,
        account_balance_usdt: null,
        account_balance_usdt_close_date: null,
      }),
    ]);
    const el = line("Deribit BTC");
    expect(el.textContent).toBe("deribit · Read-only · Balance 0.4213 BTC");
    expect(el.textContent).not.toMatch(/[≈$—]/);
    const titled = titledIn(el);
    expect(titled).toHaveLength(1);
    expect(titled[0].getAttribute("title")).toBe(
      "No USD value yet: the latest daily BTC close is not stored.",
    );
  });

  it("a USD value with NO stored close date renders the unpriced form, never a viewer-clock date", () => {
    renderKeys([
      makeKey({
        account_balance_native: 0.4213,
        account_balance_usdt: 26_099.54,
        account_balance_usdt_close_date: null,
      }),
    ]);
    const el = line("Deribit BTC");
    expect(el.textContent).toBe("deribit · Read-only · Balance 0.4213 BTC");
    expect(el.textContent).not.toMatch(/[≈$]|close/);
    expect(titledIn(el)[0].getAttribute("title")).toBe(
      "No USD value yet: the latest daily BTC close is not stored.",
    );
  });

  it("a close date with no USD value is also the unpriced form", () => {
    renderKeys([
      makeKey({
        account_balance_native: 0.4213,
        account_balance_usdt: null,
        account_balance_usdt_close_date: "2026-10-08",
      }),
    ]);
    expect(line("Deribit BTC").textContent).toBe("deribit · Read-only · Balance 0.4213 BTC");
  });

  it("the date shown is the stored one, not yesterday's by the viewer's clock", () => {
    vi.useFakeTimers();
    try {
      // Viewer's clock says Dec 25; the stored close is Oct 8.
      vi.setSystemTime(new Date("2026-12-25T12:00:00Z"));
      renderKeys([
        makeKey({
          account_balance_native: 1.5,
          account_balance_usdt: 90_000,
          account_balance_usdt_close_date: "2026-10-08",
        }),
      ]);
      const el = line("Deribit BTC");
      expect(el.textContent).toBe(
        "deribit · Read-only · Balance 1.50 BTC · ≈ $90,000 at Oct 8 close",
      );
      expect(el.textContent).not.toContain("Dec");
    } finally {
      vi.useRealTimers();
    }
  });

  it("no native balance read: `Balance —` with no title", () => {
    renderKeys([makeKey({ account_balance_native: null })]);
    const el = line("Deribit BTC");
    expect(el.textContent).toBe("deribit · Read-only · Balance —");
    expect(titledIn(el)).toHaveLength(0);
  });

  it("PostgREST numeric delivered as the string \"0.4213\" renders the same as 0.4213", () => {
    renderKeys([
      makeKey({
        account_balance_native: "0.4213",
        account_balance_usdt: 26_099.54,
        account_balance_usdt_close_date: "2026-10-08",
      }),
    ]);
    expect(line("Deribit BTC").textContent).toBe(
      "deribit · Read-only · Balance 0.4213 BTC · ≈ $26,100 at Oct 8 close",
    );
  });
});

describe("AllocatorExchangeManager — USD-family keys keep today's line (D-02)", () => {
  it.each([
    ["USD currency", { account_currency: "USD", account_balance_native: null }],
    ["null currency", { account_currency: null, account_balance_native: null }],
    ["malformed currency", { account_currency: "btc", account_balance_native: 0.4213 }],
  ])("%s: ` · Balance $12,345`, no title on any span", (_name, extra) => {
    renderKeys([makeKey({ account_balance_usdt: 12_345, ...extra })]);
    const el = line("Deribit BTC");
    expect(el.textContent).toBe("deribit · Read-only · Balance $12,345");
    expect(titledIn(el)).toHaveLength(0);
    expect(el.querySelector("span")).toBeNull();
  });

  it("a USD-family key with no balance still reads `Balance —`", () => {
    renderKeys([
      makeKey({ account_currency: null, account_balance_native: null, account_balance_usdt: null }),
    ]);
    expect(line("Deribit BTC").textContent).toBe("deribit · Read-only · Balance —");
  });
});

describe("AllocatorExchangeManager — an unpriced day never moves the balance (UI-SPEC E)", () => {
  // Two unmarked working keys on ONE exchange account (same venue account id),
  // A with the lower id. A is native with a BTC balance and, on an unpriced
  // day, no USD value; B holds a USD balance. The bearer is the first key that
  // holds a balance, then the lowest id. Before this rule A ranked as "no
  // balance" on an unpriced day and the balance jumped to B's row.
  const A = (usd: number | null) =>
    makeKey({
      id: "key-a",
      label: "Key A",
      venue_account_id: "V-1",
      account_balance_native: 0.4213,
      account_balance_usdt: usd,
      account_balance_usdt_close_date: usd == null ? null : "2026-10-08",
    });
  const B = makeKey({
    id: "key-b",
    label: "Key B",
    venue_account_id: "V-1",
    account_currency: null,
    account_balance_native: null,
    account_balance_usdt: 5_000,
  });

  it("A (native balance, USD null) stays the bearer, exactly as when A is priced", () => {
    const { unmount } = renderKeys([A(26_099.54), B]);
    expect(line("Key A").textContent).toBe(
      "deribit · Read-only · Balance 0.4213 BTC · ≈ $26,100 at Oct 8 close",
    );
    expect(line("Key B").textContent).toBe("deribit · Read-only");
    unmount();

    renderKeys([A(null), B]);
    expect(line("Key A").textContent).toBe("deribit · Read-only · Balance 0.4213 BTC");
    expect(line("Key B").textContent).toBe("deribit · Read-only");
    expect(screen.getByTestId("balance-shown-elsewhere").textContent).toBe(
      "Balance shown on Key A",
    );
    expect(screen.queryByText(/\$5,000/)).toBeNull();
  });

  it("a native key with neither a native nor a USD balance ranks as no balance (unchanged)", () => {
    renderKeys([{ ...A(null), account_balance_native: null }, B]);
    // B alone holds a balance, so B bears it; A names it.
    expect(line("Key B").textContent).toBe("deribit · Read-only · Balance $5,000");
    expect(line("Key A").textContent).toBe("deribit · Read-only");
    expect(screen.getByTestId("balance-shown-elsewhere").textContent).toBe(
      "Balance shown on Key B",
    );
  });
});
