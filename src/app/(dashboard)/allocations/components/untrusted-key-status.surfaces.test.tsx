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
 * accepting would have rendered un-chipped, un-filtered and counted in the
 * headline AUM.
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
