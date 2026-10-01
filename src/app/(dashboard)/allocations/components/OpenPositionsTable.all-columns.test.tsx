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

/**
 * Phase 169 D-50 (founder UAT 2026-09-27) — a $0.42 entry / mark price read "$0",
 * a +$0.37 P&L read "+$0", and a tiny negative read as a red "−$0". Prices keep
 * their real precision, P&L shows cents, and a P&L that rounds to zero carries
 * neither a sign nor a colour. Notional is an amount and stays whole dollars.
 * Every expected string is a typed literal.
 */
describe("[169 D-50] OpenPositionsTable money cells", () => {
  // Column order pinned by NAMED_HEADERS above.
  const ENTRY = 3;
  const MARK = 4;
  const NOTIONAL = 5;
  const PNL = 6;

  function rowCells(container: HTMLElement): HTMLTableCellElement[] {
    return Array.from(
      container.querySelector("tbody")!.querySelectorAll("tr")[0].querySelectorAll("td"),
    );
  }

  it("a sub-dollar entry and mark price render at 4 significant digits; notional stays whole-dollar", () => {
    const { container } = render(
      <OpenPositionsTable
        rows={[makeRow({ entry_price: 0.4213, mark_price: 0.4213, notional_usd: 1_234.56 })]}
      />,
    );
    const cells = rowCells(container);
    expect(cells[ENTRY].textContent).toBe("$0.4213");
    expect(cells[MARK].textContent).toBe("$0.4213");
    expect(cells[NOTIONAL].textContent).toBe("$1,235");
  });

  it("a price of $1 or more renders at 2 decimals", () => {
    const { container } = render(<OpenPositionsTable rows={[makeRow()]} />);
    const cells = rowCells(container);
    expect(cells[ENTRY].textContent).toBe("$60,000.00");
    expect(cells[MARK].textContent).toBe("$72,000.00");
  });

  it("a sub-dollar P&L keeps its cents, its sign and the positive colour", () => {
    const { container } = render(
      <OpenPositionsTable rows={[makeRow({ unrealized_pnl_usd: 0.37 })]} />,
    );
    const cell = rowCells(container)[PNL];
    expect(cell.textContent).toBe("+$0.37");
    expect(cell.getAttribute("style") ?? "").toContain("var(--color-positive)");
  });

  it("a P&L that rounds to zero reads $0.00 with no sign and no colour — never a red −$0", () => {
    const { container } = render(
      <OpenPositionsTable rows={[makeRow({ unrealized_pnl_usd: -0.0001 })]} />,
    );
    const cell = rowCells(container)[PNL];
    expect(cell.textContent).toBe("$0.00");
    expect(cell.getAttribute("style") ?? "").not.toContain("color");
    // The footer total of the same one row reads the same, uncoloured.
    const footerCells = container.querySelector("tfoot")!.querySelectorAll("tr")[0].querySelectorAll("td");
    const footer = footerCells[footerCells.length - 1];
    expect(footer.textContent).toBe("$0.00");
    expect(footer.getAttribute("style") ?? "").not.toContain("color");
  });

  it("a null price and a null P&L stay the em-dash", () => {
    const { container } = render(
      <OpenPositionsTable
        rows={[makeRow({ entry_price: null, mark_price: null, unrealized_pnl_usd: null })]}
      />,
    );
    const cells = rowCells(container);
    expect(cells[ENTRY].textContent).toBe("—");
    expect(cells[MARK].textContent).toBe("—");
    expect(cells[PNL].textContent).toBe("—");
  });
});

/**
 * 2026-09-29, Phase 169 review round 1 SFH M-4. The footer total summed a
 * TRUSTED row's missing P&L as 0 and disclosed nothing (the key-trust note
 * only counts untrusted and unknown-status rows). With every P&L missing it
 * read "$0.00" in the neutral colour, a to-the-cent "flat" nobody measured
 * (D-50 made it look more exact). A total over rows with no P&L must not
 * present as an exact figure: every row missing is the em-dash, some missing
 * keeps the sum of the reported rows and says the total is partial, with the
 * count (DESIGN.md Voice: state the limitation with the number attached).
 * Typed-literal oracles.
 */
describe("[169 M-4] the footer total over rows with no P&L", () => {
  function footerTotalCell(container: HTMLElement): HTMLElement {
    const cells = container.querySelector("tfoot")!.querySelectorAll("tr")[0].querySelectorAll("td");
    return cells[cells.length - 1] as HTMLElement;
  }

  it("every P&L missing on trusted rows: the total is the em-dash, uncoloured, and the note says none is reported", () => {
    const { container, getByTestId } = render(
      <OpenPositionsTable
        rows={[
          makeRow({ id: "a", unrealized_pnl_usd: null }),
          makeRow({ id: "b", unrealized_pnl_usd: Number.NaN }),
        ]}
      />,
    );
    const total = footerTotalCell(container);
    expect(total.textContent).toBe("—");
    expect(total.getAttribute("style") ?? "").not.toContain("color");
    expect(getByTestId("open-positions-pnl-unavailable-note").textContent).toBe(
      "P&L unavailable for 2 of 2 positions.",
    );
  });

  it("a single trusted row with no P&L: the total is the em-dash, never $0.00", () => {
    const { container, getByTestId } = render(
      <OpenPositionsTable rows={[makeRow({ unrealized_pnl_usd: null })]} />,
    );
    expect(footerTotalCell(container).textContent).toBe("—");
    expect(getByTestId("open-positions-pnl-unavailable-note").textContent).toBe(
      "P&L unavailable for 1 of 1 position.",
    );
  });

  it("some P&L missing: the total sums the reported rows and is labelled partial", () => {
    const { container, getByTestId } = render(
      <OpenPositionsTable
        rows={[
          makeRow({ id: "a", unrealized_pnl_usd: 1_500 }),
          makeRow({ id: "b", unrealized_pnl_usd: -200 }),
          makeRow({ id: "c", unrealized_pnl_usd: null }),
        ]}
      />,
    );
    // 1,500 - 200 = 1,300, hand-summed over the two reported rows.
    const total = footerTotalCell(container);
    expect(total.textContent).toBe("+$1,300.00");
    expect(total.getAttribute("style") ?? "").toContain("var(--color-positive)");
    const note = getByTestId("open-positions-pnl-unavailable-note");
    expect(note.textContent).toBe("Partial total: P&L unavailable for 1 of 3 positions.");
    // Muted caption, the key-trust note's tone (D-09).
    expect(note.className).toContain("text-text-muted");
    expect(note.getAttribute("colspan")).toBe("7");
  });

  it("control: every P&L reported, including a real zero, carries no note", () => {
    const { container, queryByTestId } = render(
      <OpenPositionsTable
        rows={[
          makeRow({ id: "a", unrealized_pnl_usd: 0 }),
          makeRow({ id: "b", unrealized_pnl_usd: 250 }),
        ]}
      />,
    );
    expect(footerTotalCell(container).textContent).toBe("+$250.00");
    expect(queryByTestId("open-positions-pnl-unavailable-note")).toBeNull();
  });
});
