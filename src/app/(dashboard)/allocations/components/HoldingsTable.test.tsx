import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { HoldingsTable } from "./HoldingsTable";

/**
 * Phase 08 Plan 02 Task 2 — HoldingsTable tests (MANAGE-02).
 *
 * Covers the revoked-key visual treatment + allocator-scoped toggle
 * per 08-UI-SPEC.md §2 and 08-CONTEXT.md D-04 / D-05:
 *
 *   - Strikethrough + amber "Key revoked" chip for rows whose source
 *     key has sync_status='revoked'.
 *   - Toggle "Show revoked-key holdings" default ON at render time
 *     (the default comes from the caller — AllocationDashboard owns
 *     the localStorage-backed state; the component itself honours
 *     `showRevoked` verbatim).
 *   - Toggle OFF filters revoked rows from the table ONLY (caller's
 *     responsibility to NOT filter KPI / chart inputs — proved in
 *     AllocationDashboard.revoked-holdings.test.tsx T12).
 *   - Hidden-footer "{N} holding(s) hidden from revoked keys · Show all"
 *     with the Show-all button firing onShowRevokedChange(true).
 *   - Plural/singular rules for the hidden-footer count.
 */

type HoldingRow = React.ComponentProps<typeof HoldingsTable>["holdings"][number];

function makeHolding(overrides: Partial<HoldingRow> = {}): HoldingRow {
  return {
    id: "holding-default",
    venue: "binance",
    symbol: "BTC",
    holding_type: "spot",
    quantity: 1.5,
    value_usd: 90_000,
    entry_price: 60_000,
    unrealized_pnl_usd: 1_200,
    api_key_id: "key-1",
    source_key_sync_status: "complete",
    ...overrides,
  } as HoldingRow;
}

describe("HoldingsTable — revoked-key strikethrough + amber chip + toggle (08-02 / MANAGE-02)", () => {
  it("T1: 3 non-revoked holdings → no strikethrough, no amber chip anywhere", () => {
    const holdings = [
      makeHolding({ id: "h1", symbol: "BTC" }),
      makeHolding({ id: "h2", symbol: "ETH", api_key_id: "key-2" }),
      makeHolding({ id: "h3", symbol: "SOL", api_key_id: "key-3" }),
    ];
    const { container } = render(
      <HoldingsTable
        holdings={holdings}
        showRevoked={true}
        onShowRevokedChange={() => {}}
      />,
    );
    expect(screen.queryByText("Key revoked")).not.toBeInTheDocument();
    expect(container.querySelector(".line-through")).toBeNull();
  });

  it("T2: 1 of 3 revoked → that row has line-through on numeric cells + amber chip visible", () => {
    const holdings = [
      makeHolding({ id: "h1", symbol: "BTC" }),
      makeHolding({
        id: "h2",
        symbol: "ETH",
        api_key_id: "key-revoked",
        source_key_sync_status: "revoked",
      }),
      makeHolding({ id: "h3", symbol: "SOL", api_key_id: "key-3" }),
    ];
    const { container } = render(
      <HoldingsTable
        holdings={holdings}
        showRevoked={true}
        onShowRevokedChange={() => {}}
      />,
    );
    expect(screen.getByText("Key revoked")).toBeInTheDocument();
    // At least one line-through descendant (on numeric cells of the revoked row).
    expect(container.querySelectorAll(".line-through").length).toBeGreaterThan(0);
  });

  it("T3: showRevoked=false → revoked row NOT in DOM; visible-count is 2", () => {
    const holdings = [
      makeHolding({ id: "h1", symbol: "BTC" }),
      makeHolding({
        id: "h2",
        symbol: "ETH",
        source_key_sync_status: "revoked",
      }),
      makeHolding({ id: "h3", symbol: "SOL" }),
    ];
    render(
      <HoldingsTable
        holdings={holdings}
        showRevoked={false}
        onShowRevokedChange={() => {}}
      />,
    );
    expect(screen.queryByText("Key revoked")).not.toBeInTheDocument();
    // The revoked-row's symbol (ETH) MUST NOT be rendered.
    expect(screen.queryByText("ETH")).not.toBeInTheDocument();
    expect(screen.getByText("BTC")).toBeInTheDocument();
    expect(screen.getByText("SOL")).toBeInTheDocument();
  });

  it("T4: showRevoked=false + 1 hidden → footer reads '1 holding hidden from revoked keys · Show all'; clicking Show all fires onShowRevokedChange(true)", () => {
    const onChange = vi.fn();
    const holdings = [
      makeHolding({ id: "h1", symbol: "BTC" }),
      makeHolding({
        id: "h2",
        symbol: "ETH",
        source_key_sync_status: "revoked",
      }),
    ];
    render(
      <HoldingsTable
        holdings={holdings}
        showRevoked={false}
        onShowRevokedChange={onChange}
      />,
    );
    expect(
      screen.getByText(/1 holding hidden from revoked keys/),
    ).toBeInTheDocument();
    const showAll = screen.getByRole("button", { name: /Show all/i });
    fireEvent.click(showAll);
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it("T5: showRevoked=false + 2 hidden → footer uses plural 'holdings'", () => {
    const holdings = [
      makeHolding({ id: "h1", symbol: "BTC" }),
      makeHolding({
        id: "h2",
        symbol: "ETH",
        source_key_sync_status: "revoked",
      }),
      makeHolding({
        id: "h3",
        symbol: "SOL",
        source_key_sync_status: "revoked",
      }),
    ];
    render(
      <HoldingsTable
        holdings={holdings}
        showRevoked={false}
        onShowRevokedChange={() => {}}
      />,
    );
    expect(
      screen.getByText(/2 holdings hidden from revoked keys/),
    ).toBeInTheDocument();
  });

  it("T6: toggle label reads 'Show revoked-key holdings' exactly", () => {
    render(
      <HoldingsTable
        holdings={[makeHolding()]}
        showRevoked={true}
        onShowRevokedChange={() => {}}
      />,
    );
    expect(
      screen.getByLabelText("Show revoked-key holdings"),
    ).toBeInTheDocument();
  });

  it("T7: amber chip carries the --color-warning token #D97706 via inline style", () => {
    const holdings = [
      makeHolding({
        id: "h2",
        symbol: "ETH",
        source_key_sync_status: "revoked",
      }),
    ];
    render(
      <HoldingsTable
        holdings={holdings}
        showRevoked={true}
        onShowRevokedChange={() => {}}
      />,
    );
    const chip = screen.getByText("Key revoked");
    // Matches UI-SPEC §2 amber palette inline styling.
    const style = chip.getAttribute("style") ?? "";
    // Style attribute values are lowercased by jsdom during serialisation,
    // so match #d97706 case-insensitively.
    expect(style.toLowerCase()).toContain("#d97706");
    expect(style.toLowerCase()).toContain("#fef3c7");
  });
});
