/** @vitest-environment jsdom */
import { describe, it, expect } from "vitest";
import { render, within } from "@testing-library/react";
import { OpenPositionsTable, type OpenPositionRow } from "./OpenPositionsTable";

/**
 * TABLE-01 / SC#2 — fail-loud all-columns render guard for OpenPositionsTable.
 *
 * OpenPositionsTable got the same phase-46 `<ResponsiveTable>` wrap as its
 * HoldingsTable / ScenarioCompareTable / CorrelationMatrix siblings, but unlike
 * them it had no column-presence guard — a gap the ship-review caught. It is a
 * dense 7-column derivatives table where every column is material (notional vs
 * unrealized-P&L is the whole point of splitting this surface out). Phase 46
 * reshapes by SCROLLING columns, never dropping them, so this guard pins the
 * exact `<th>` set + count: a future `hidden` / `md:table-cell` / `truncate`
 * edit that hides a column on mobile fails CI loudly (CLAUDE.md Rule 12).
 *
 * Falsifiability: delete any `<th>` from OpenPositionsTable.tsx:132-142 → RED.
 */

// Bans the column-hiding anti-pattern on any material header — a label that
// carried one would render a "smaller truth" on mobile (phase 46 forbids it).
const HIDDEN_OR_TRUNCATE = /\bhidden\b|md:table-cell|\btruncate\b/;

// VERBATIM material header set from OpenPositionsTable.tsx:132-142, in order.
// The `&amp;` entity renders as `&` in textContent → "Unrealized P&L".
const NAMED_HEADERS = [
  "Venue / Symbol",
  "Side",
  "Quantity",
  "Entry",
  "Mark",
  "Exposure (notional)",
  "Unrealized P&L",
];

function makeRow(over: Partial<OpenPositionRow> = {}): OpenPositionRow {
  return {
    id: "pos-1",
    venue: "binance",
    symbol: "BTC-PERP",
    side: "long",
    quantity: 1.25,
    notional_usd: 90_000,
    entry_price: 60_000,
    mark_price: 72_000,
    unrealized_pnl_usd: 1_500,
    api_key_id: "key-1",
    source_key_sync_status: "complete",
    ...over,
  };
}

function headerLabels(thead: HTMLElement): string[] {
  return Array.from(thead.querySelectorAll("th"))
    .map((h) => (h.textContent ?? "").trim())
    .filter((t) => t.length > 0);
}

describe("OpenPositionsTable all-columns guard (7 material columns)", () => {
  it("renders EXACTLY 7 columnheaders, in order (drop-one fails loud)", () => {
    const { container } = render(<OpenPositionsTable rows={[makeRow()]} />);
    const thead = container.querySelector("thead")!;

    expect(within(thead).getAllByRole("columnheader")).toHaveLength(7);
    expect(headerLabels(thead)).toEqual(NAMED_HEADERS);
  });

  it("every named material header is present", () => {
    const { container } = render(<OpenPositionsTable rows={[makeRow()]} />);
    const thead = container.querySelector("thead")!;
    for (const name of NAMED_HEADERS) {
      expect(
        within(thead).getByRole("columnheader", { name }),
      ).toBeInTheDocument();
    }
  });

  it("no material header carries a hidden / md:table-cell / truncate class", () => {
    const { container } = render(<OpenPositionsTable rows={[makeRow()]} />);
    const thead = container.querySelector("thead")!;
    for (const h of within(thead).getAllByRole("columnheader")) {
      expect(h.className).not.toMatch(HIDDEN_OR_TRUNCATE);
    }
  });
});
