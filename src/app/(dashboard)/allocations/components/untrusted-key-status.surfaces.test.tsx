/** @vitest-environment jsdom */
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { HoldingsTable, type HoldingRow } from "./HoldingsTable";
import { OpenPositionsTable, type OpenPositionRow } from "./OpenPositionsTable";
import type { DesignHoldingRow } from "../lib/holdings-adapter";

// DesignHoldingsTable calls `useRouter()` at the top of its body; without the
// app-router context these renders throw before any assertion runs. Same stubs
// as the sibling HoldingsTable.all-columns.test.tsx.
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: vi.fn(),
    replace: vi.fn(),
    push: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    prefetch: vi.fn(),
  }),
  usePathname: () => "/allocations",
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: React.ReactNode;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

/**
 * Phase 167 CREDTRUST / D-16 — the money surfaces test an UNTRUSTED-STATUS
 * PREDICATE, not an equality against `revoked`.
 *
 * MEASURED DEFECT (founder decision D-16, 2026-09-22): seven hand-kept
 * equalities against the literal `revoked` — six in `HoldingsTable.tsx` (the
 * legacy stale-row filter, the legacy hidden counter, the legacy per-row flag,
 * the design-mode filter, the design-mode hidden counter, the design-mode
 * per-row flag) and one in `OpenPositionsTable.tsx`. No allow-list, no enum,
 * no closed set over the column anywhere, so EVERY other status defaulted to
 * the healthy branch. Once `167-04` made the daily poll write
 * `sign_in_failed`, a holding sourced from a key the venue has stopped
 * accepting would have rendered un-chipped and un-filtered. ⚠️ The predicate
 * does NOT keep it out of the headline AUM, which `src/lib/queries.ts` sums
 * over every holding regardless of key status (see the SFH-M2 note beside
 * `UNTRUSTED_KEY_SYNC_STATUSES`); nothing here asserts otherwise.
 *
 * ⛔ WHY THE ASSERTIONS ARE PARAMETRIZED OVER THE SET AND NOT WRITTEN TWICE.
 * The equality SHAPE is the defect, not the missing value: a fix that appended
 * `|| status === "sign_in_failed"` beside each `=== "revoked"` would reproduce
 * it for the tenth status. Each case below drives BOTH members through the
 * SAME body, so the surfaces are proven to answer a predicate rather than to
 * have had a second literal pasted in.
 *
 * The healthy control arm is in every case on purpose: the fix for "everything
 * defaults to trusted" must not be "everything defaults to untrusted", which
 * would strike through a healthy book on a value drift.
 */

/** Driven through every case body. Order is irrelevant; membership is not. */
const UNTRUSTED = ["revoked", "sign_in_failed"] as const;

/**
 * ORACLE INDEPENDENCE: typed here, never imported from the label map under
 * test. "Key revoked" is the byte-unchanged Phase 08 MANAGE-02 chip;
 * "Sign-in failed" is the pill label plan 167-03 shipped in
 * `AllocatorSyncStatus`. If a third vocabulary is ever invented for these two
 * states, this file goes RED.
 */
const CHIP_TEXT: Record<string, string> = {
  revoked: "Key revoked",
  sign_in_failed: "Sign-in failed",
};

function makeHolding(over: Partial<HoldingRow> = {}): HoldingRow {
  return {
    id: "h-1",
    venue: "binance",
    symbol: "BTC",
    holding_type: "spot",
    quantity: 1.5,
    value_usd: 90_000,
    entry_price: 60_000,
    unrealized_pnl_usd: 1_200,
    api_key_id: "key-1",
    source_key_sync_status: "complete",
    ...over,
  };
}

function makeDesignRow(over: Partial<DesignHoldingRow> = {}): DesignHoldingRow {
  return {
    id: "d-1",
    venue: "binance",
    symbol: "ETH",
    holding_type: "spot",
    strategy: "Alpha Book",
    manager: "Helios Capital",
    tag: null,
    alloc: 100_000,
    weight: 0.5,
    mtd: 0.01,
    sharpe: 1.4,
    dd: -0.05,
    age: 30,
    status: "ok",
    bridgeCandidate: false,
    ...over,
  };
}

function makePosition(over: Partial<OpenPositionRow> = {}): OpenPositionRow {
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

describe("[D-16] LegacyHoldingsTable — filter + counter + chip answer the predicate", () => {
  it.each(UNTRUSTED)("%s: the row is chipped and struck through", (status) => {
    const { container } = render(
      <HoldingsTable
        holdings={[
          makeHolding({ id: "healthy", symbol: "BTC" }),
          makeHolding({
            id: "untrusted",
            symbol: "ETH",
            api_key_id: "key-2",
            source_key_sync_status: status,
          }),
        ]}
        showRevoked={true}
        onShowRevokedChange={() => {}}
      />,
    );
    expect(screen.getByText(CHIP_TEXT[status])).toBeInTheDocument();
    expect(container.querySelectorAll(".line-through").length).toBeGreaterThan(
      0,
    );
  });

  it.each(UNTRUSTED)(
    "%s: showRevoked=false removes the row from the DOM and counts it as hidden",
    (status) => {
      render(
        <HoldingsTable
          holdings={[
            makeHolding({ id: "healthy", symbol: "BTC" }),
            makeHolding({
              id: "untrusted",
              symbol: "ETH",
              api_key_id: "key-2",
              source_key_sync_status: status,
            }),
          ]}
          showRevoked={false}
          onShowRevokedChange={() => {}}
        />,
      );
      // Filtered out of the table entirely...
      expect(screen.queryByText(CHIP_TEXT[status])).not.toBeInTheDocument();
      expect(screen.queryByText(/ETH/)).not.toBeInTheDocument();
      // ...and COUNTED, so the surface never silently drops a row. A counter
      // still keyed on `revoked` alone reports 0 here and the footer vanishes.
      expect(screen.getByText(/1 holding hidden/)).toBeInTheDocument();
      // The healthy row survives — the control arm.
      expect(screen.getByText(/BTC/)).toBeInTheDocument();
    },
  );

  it("a healthy status is untouched — no chip, no strikethrough, no hidden count", () => {
    const { container } = render(
      <HoldingsTable
        holdings={[makeHolding({ source_key_sync_status: "complete" })]}
        showRevoked={false}
        onShowRevokedChange={() => {}}
      />,
    );
    expect(container.querySelector(".line-through")).toBeNull();
    expect(screen.queryByText(/hidden/)).not.toBeInTheDocument();
    for (const label of Object.values(CHIP_TEXT)) {
      expect(screen.queryByText(label)).not.toBeInTheDocument();
    }
  });
});

describe("[D-16] DesignHoldingsTable — filter + counter + chip answer the predicate", () => {
  it.each(UNTRUSTED)("%s: the row is chipped and struck through", (status) => {
    const { container } = render(
      <HoldingsTable
        rows={[makeDesignRow({ id: "d-untrusted" })]}
        revokedStatusByHoldingId={{ "d-untrusted": status }}
        flaggedHoldingsByRef={{}}
        showRevoked={true}
        onShowRevokedChange={() => {}}
      />,
    );
    expect(screen.getByText(CHIP_TEXT[status])).toBeInTheDocument();
    expect(container.querySelectorAll(".line-through").length).toBeGreaterThan(
      0,
    );
  });

  it.each(UNTRUSTED)(
    "%s: showRevoked=false removes the row and counts it as hidden",
    (status) => {
      render(
        <HoldingsTable
          rows={[
            makeDesignRow({ id: "d-healthy", strategy: "Healthy Book" }),
            makeDesignRow({ id: "d-untrusted", strategy: "Stalled Book" }),
          ]}
          revokedStatusByHoldingId={{ "d-untrusted": status }}
          flaggedHoldingsByRef={{}}
          showRevoked={false}
          onShowRevokedChange={() => {}}
        />,
      );
      expect(screen.queryByText("Stalled Book")).not.toBeInTheDocument();
      expect(screen.getByText(/1 holding hidden/)).toBeInTheDocument();
      expect(screen.getByText("Healthy Book")).toBeInTheDocument();
    },
  );

  it("a healthy status is untouched — no chip, no strikethrough, no hidden count", () => {
    const { container } = render(
      <HoldingsTable
        rows={[makeDesignRow({ id: "d-healthy" })]}
        revokedStatusByHoldingId={{ "d-healthy": "complete" }}
        flaggedHoldingsByRef={{}}
        showRevoked={false}
        onShowRevokedChange={() => {}}
      />,
    );
    expect(container.querySelector(".line-through")).toBeNull();
    expect(screen.queryByText(/hidden/)).not.toBeInTheDocument();
  });
});

describe("[D-16] OpenPositionsTable — the derivative surface answers the predicate", () => {
  it.each(UNTRUSTED)("%s: the row is chipped and struck through", (status) => {
    const { container } = render(
      <OpenPositionsTable
        rows={[makePosition({ source_key_sync_status: status })]}
      />,
    );
    const tbody = container.querySelector("tbody")!;
    expect(within(tbody).getByText(CHIP_TEXT[status])).toBeInTheDocument();
    expect(tbody.querySelectorAll(".line-through").length).toBeGreaterThan(0);
  });

  it("a healthy status is untouched — no chip, no strikethrough", () => {
    const { container } = render(
      <OpenPositionsTable
        rows={[makePosition({ source_key_sync_status: "complete" })]}
      />,
    );
    const tbody = container.querySelector("tbody")!;
    expect(tbody.querySelector(".line-through")).toBeNull();
    for (const label of Object.values(CHIP_TEXT)) {
      expect(within(tbody).queryByText(label)).not.toBeInTheDocument();
    }
  });
});

/**
 * Phase 167.1 AUMTRUST / D-16 (amendment 2026-09-23) — the Open Positions
 * footer total "Total unrealized P&L (equity contribution)" sums EVERY
 * derivative row, including the ones struck through above with an untrusted
 * chip. The founder's rule is "keep the total and flag it" (D-03): the total
 * must not move, and a muted sentence under it names the untrusted part.
 *
 * ORACLE INDEPENDENCE: every expected string is typed literally. Neither the
 * noun constant nor the file-local formatter is imported, so a drift in either
 * turns this block RED instead of moving the oracle with it.
 */
describe("[167.1] AUMTRUST — OpenPositionsTable footer qualifier", () => {
  function footerTotal(container: HTMLElement): string {
    const tfoot = container.querySelector("tfoot")!;
    const totalRow = tfoot.querySelectorAll("tr")[0];
    const cells = totalRow.querySelectorAll("td");
    return cells[cells.length - 1].textContent ?? "";
  }

  it("tracer: a sign_in_failed position stays in the footer total and the footer says so", () => {
    const { container } = render(
      <OpenPositionsTable
        rows={[
          makePosition({ id: "pos-trusted", unrealized_pnl_usd: 1_000 }),
          makePosition({
            id: "pos-untrusted",
            unrealized_pnl_usd: 300,
            source_key_sync_status: "sign_in_failed",
          }),
        ]}
      />,
    );
    // D-03: the untrusted row is still counted — disclose, never subtract.
    expect(footerTotal(container)).toBe("+$1,300");
    expect(screen.getByTestId("open-positions-untrusted-note").textContent).toBe(
      "Includes +$300 from keys needing attention.",
    );
  });

  it.each(UNTRUSTED)(
    "%s: a single untrusted row renders the qualifier for its P&L",
    (status) => {
      render(
        <OpenPositionsTable
          rows={[makePosition({ source_key_sync_status: status })]}
        />,
      );
      expect(
        screen.getByTestId("open-positions-untrusted-note").textContent,
      ).toBe("Includes +$1,500 from keys needing attention.");
    },
  );

  it("healthy control: an all-complete table has no qualifier and a one-row footer", () => {
    const { container } = render(
      <OpenPositionsTable
        rows={[
          makePosition({ id: "pos-a" }),
          makePosition({ id: "pos-b", unrealized_pnl_usd: -200 }),
        ]}
      />,
    );
    expect(
      screen.queryByTestId("open-positions-untrusted-note"),
    ).not.toBeInTheDocument();
    expect(container.querySelector("tfoot")!.querySelectorAll("tr")).toHaveLength(1);
    expect(footerTotal(container)).toBe("+$1,300");
  });

  it("mixed table: the total is trusted + untrusted, the qualifier is the untrusted part only", () => {
    const { container } = render(
      <OpenPositionsTable
        rows={[
          makePosition({ id: "pos-t1", unrealized_pnl_usd: 2_000 }),
          makePosition({ id: "pos-t2", unrealized_pnl_usd: 500 }),
          makePosition({
            id: "pos-u1",
            unrealized_pnl_usd: 700,
            source_key_sync_status: "revoked",
          }),
          makePosition({
            id: "pos-u2",
            unrealized_pnl_usd: -100,
            source_key_sync_status: "sign_in_failed",
          }),
        ]}
      />,
    );
    // 2,000 + 500 + 700 - 100 = 3,100 (hand-summed; D-03 keeps the untrusted rows in).
    expect(footerTotal(container)).toBe("+$3,100");
    // 700 - 100 = 600: only the two untrusted rows, across both statuses.
    expect(screen.getByTestId("open-positions-untrusted-note").textContent).toBe(
      "Includes +$600 from keys needing attention.",
    );
  });

  it("negative untrusted P&L renders with the total's minus sign", () => {
    render(
      <OpenPositionsTable
        rows={[
          makePosition({
            unrealized_pnl_usd: -1_234.6,
            source_key_sync_status: "sign_in_failed",
          }),
        ]}
      />,
    );
    // The first character after "Includes " is U+2212 MINUS SIGN, not a
    // hyphen-minus: it is formatPnl's sign, the same one the total uses.
    expect(screen.getByTestId("open-positions-untrusted-note").textContent).toBe(
      "Includes −$1,235 from keys needing attention.",
    );
  });

  it("null P&L on an untrusted row still renders (D-07), and says the P&L is unavailable rather than claiming a known zero (review WR-03)", () => {
    render(
      <OpenPositionsTable
        rows={[
          makePosition({
            unrealized_pnl_usd: null,
            source_key_sync_status: "revoked",
          }),
        ]}
      />,
    );
    expect(screen.getByTestId("open-positions-untrusted-note").textContent).toBe(
      "Includes +$0 from keys needing attention (P&L unavailable for 1 position).",
    );
  });

  it("review WR-03: a known untrusted P&L beside unknown ones keeps its amount and names how many rows had none — NaN counts as unavailable too, and a trusted null row does not", () => {
    const { container } = render(
      <OpenPositionsTable
        rows={[
          makePosition({ id: "pos-t-null", unrealized_pnl_usd: null }),
          makePosition({
            id: "pos-u-known",
            unrealized_pnl_usd: 300,
            source_key_sync_status: "sign_in_failed",
          }),
          makePosition({
            id: "pos-u-null",
            unrealized_pnl_usd: null,
            source_key_sync_status: "revoked",
          }),
          makePosition({
            id: "pos-u-nan",
            unrealized_pnl_usd: Number.NaN,
            source_key_sync_status: "sign_in_failed",
          }),
        ]}
      />,
    );
    // D-03: the total is unchanged — the unknown rows still sum as 0.
    expect(footerTotal(container)).toBe("+$300");
    expect(screen.getByTestId("open-positions-untrusted-note").textContent).toBe(
      "Includes +$300 from keys needing attention (P&L unavailable for 2 positions).",
    );
  });

  it("review WR-03: a known zero untrusted P&L is a real zero and carries no unavailable note", () => {
    render(
      <OpenPositionsTable
        rows={[
          makePosition({
            unrealized_pnl_usd: 0,
            source_key_sync_status: "sign_in_failed",
          }),
        ]}
      />,
    );
    expect(screen.getByTestId("open-positions-untrusted-note").textContent).toBe(
      "Includes +$0 from keys needing attention.",
    );
  });

  it("tone: muted caption, no warning colour, no uppercase, no role (D-09)", () => {
    render(
      <OpenPositionsTable
        rows={[makePosition({ source_key_sync_status: "sign_in_failed" })]}
      />,
    );
    const cell = screen.getByTestId("open-positions-untrusted-note");
    expect(cell.className).toContain("text-text-muted");
    expect(cell.className).toContain("text-xs");
    expect(cell.className).not.toMatch(
      /warning|amber|danger|destructive|accent|uppercase/i,
    );
    expect(cell.getAttribute("role")).toBeNull();
    expect(cell.getAttribute("style")).toBeNull();
    expect(cell.getAttribute("colspan")).toBe("7");
  });
});
