/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { HoldingsTable, type HoldingRow } from "./HoldingsTable";
import { OpenPositionsTable, type OpenPositionRow } from "./OpenPositionsTable";
import type { FlaggedRows } from "../lib/flagged-position-map";

/**
 * Phase 198 plan 12 (C9, OQ-7 assumed, D-02): a flagged position carries its flag
 * and its outcome action in its OWN row, so Holdings lists each position once.
 * C9 says one action opens one form, so the sub-row is keyed by ROW id and never
 * by ref: two keys' rows of one ref must not open two forms. Without the `flagged`
 * prop both tables must render exactly as before.
 */

const spotRow = (id: string, over: Partial<HoldingRow> = {}): HoldingRow => ({
  id,
  venue: "binance",
  symbol: "BTC",
  holding_type: "spot",
  quantity: 1,
  value_usd: 40_000,
  entry_price: null,
  unrealized_pnl_usd: null,
  api_key_id: "k1",
  source_key_sync_status: "complete",
  source_key_disconnected_at: null,
  ...over,
});

const perpRow = (id: string, over: Partial<OpenPositionRow> = {}): OpenPositionRow => ({
  id,
  venue: "binance",
  symbol: "BTC-PERP",
  side: "long",
  quantity: 1,
  notional_usd: 90_000,
  entry_price: 60_000,
  mark_price: 72_000,
  unrealized_pnl_usd: 1_500,
  api_key_id: "k1",
  source_key_sync_status: "complete",
  source_key_disconnected_at: null,
  ...over,
});

function flagged(ids: string[], openRowId: string | null, onToggle = vi.fn()): FlaggedRows {
  return {
    flaggedRowIds: new Set(ids),
    openRowId,
    onToggle,
    renderOutcome: (id) => <div data-testid="outcome-marker">outcome for {id}</div>,
  };
}

beforeEach(() => {
  // HoldingNoteRow is not opened here; nothing is fetched.
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) })));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

type Case = {
  name: string;
  ids: [string, string, string];
  mount: (f: FlaggedRows | undefined, hidden?: ReadonlySet<string>) => ReturnType<typeof render>;
  columns: number;
};

const SPOT_IDS: [string, string, string] = [
  "holding:binance:BTC:spot#k1",
  "holding:binance:BTC:spot#k2",
  "holding:okx:ETH:spot#k1",
];
const PERP_IDS: [string, string, string] = [
  "holding:binance:BTC-PERP:derivative#k1",
  "holding:binance:BTC-PERP:derivative#k2",
  "holding:okx:ETH-PERP:derivative#k1",
];

const CASES: Case[] = [
  {
    name: "HoldingsTable (spot)",
    ids: SPOT_IDS,
    columns: 7,
    mount: (f, hidden) =>
      render(
        <HoldingsTable
          holdings={SPOT_IDS.map((id, i) => spotRow(id, { api_key_id: `k${i}` }))}
          hiddenRowIds={hidden}
          flagged={f}
        />,
      ),
  },
  {
    name: "OpenPositionsTable (derivatives)",
    ids: PERP_IDS,
    columns: 7,
    mount: (f, hidden) =>
      render(
        <OpenPositionsTable
          rows={PERP_IDS.map((id, i) => perpRow(id, { api_key_id: `k${i}` }))}
          hiddenRowIds={hidden}
          flagged={f}
        />,
      ),
  },
];

describe.each(CASES)("$name flagged rows", ({ ids, mount, columns }) => {
  it("without the flagged prop renders no chip, no action and no sub-row", () => {
    mount(undefined);
    expect(screen.queryByText("Flagged")).toBeNull();
    expect(screen.queryByRole("button", { name: /Record outcome/ })).toBeNull();
    expect(screen.queryByTestId("flagged-outcome-row")).toBeNull();
  });

  it("marks every main row with data-position-row", () => {
    mount(undefined);
    const marked = [...document.querySelectorAll("[data-position-row]")].map((e) =>
      e.getAttribute("data-position-row"),
    );
    expect(marked).toEqual([...ids]);
  });

  it("shows the chip and the action only on flagged rows, with the disclosure wiring", () => {
    mount(flagged([ids[0], ids[1]], null));
    const rows = ids.map((id) => document.querySelector(`[data-position-row="${id}"]`) as HTMLElement);
    for (const r of rows.slice(0, 2)) {
      expect(within(r).getByText("Flagged")).toBeTruthy();
    }
    expect(within(rows[2]).queryByText("Flagged")).toBeNull();
    expect(within(rows[2]).queryByRole("button", { name: /Record outcome/ })).toBeNull();
    const button = within(rows[0]).getByRole("button", { name: "Record outcome…" });
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(button.getAttribute("aria-controls")).toBe(`flagged-outcome-${ids[0]}`);
    expect(button.className).toContain("min-h-[44px]");
  });

  it("pressing the action calls onToggle with the row id once", () => {
    const onToggle = vi.fn();
    mount(flagged([ids[1]], null, onToggle));
    fireEvent.click(screen.getByRole("button", { name: "Record outcome…" }));
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(onToggle).toHaveBeenCalledWith(ids[1]);
  });

  it("opens exactly one sub-row, under the open row, spanning every column", () => {
    // Two flagged rows of one ref on two keys: only the open one gets a sub-row.
    mount(flagged([ids[0], ids[1]], ids[0]));
    const subRows = screen.getAllByTestId("flagged-outcome-row");
    expect(subRows).toHaveLength(1);
    expect(subRows[0].id).toBe(`flagged-outcome-${ids[0]}`);
    expect(subRows[0].previousElementSibling?.getAttribute("data-position-row")).toBe(ids[0]);
    expect(subRows[0].querySelector("td")?.getAttribute("colspan")).toBe(String(columns));
    expect(within(subRows[0]).getByTestId("outcome-marker").textContent).toBe(`outcome for ${ids[0]}`);
    const open = screen
      .getAllByRole("button", { name: "Record outcome…" })
      .map((b) => b.getAttribute("aria-expanded"));
    expect(open).toEqual(["true", "false"]);
  });

  it("a row hidden by hiddenRowIds renders neither its row nor its sub-row", () => {
    mount(flagged([ids[0]], ids[0]), new Set([ids[0]]));
    expect(document.querySelector(`[data-position-row="${ids[0]}"]`)).toBeNull();
    expect(screen.queryByTestId("flagged-outcome-row")).toBeNull();
  });
});

describe("the derivatives footer ignores the flagged prop", () => {
  it("total and notes are identical with and without it", () => {
    const rows = [perpRow(PERP_IDS[0]), perpRow(PERP_IDS[1], { unrealized_pnl_usd: null })];
    const plain = render(<OpenPositionsTable rows={rows} />);
    const before = plain.container.querySelector("tfoot")?.textContent;
    plain.unmount();
    const marked = render(<OpenPositionsTable rows={rows} flagged={flagged([PERP_IDS[0]], PERP_IDS[0])} />);
    expect(marked.container.querySelector("tfoot")?.textContent).toBe(before);
    expect(before).toBeTruthy();
  });
});
