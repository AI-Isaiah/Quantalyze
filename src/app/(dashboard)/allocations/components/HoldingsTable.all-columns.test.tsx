import { describe, it, expect, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { termDefinition } from "@/lib/glossary";
import { HoldingsTable, type HoldingRow } from "./HoldingsTable";
import type { DesignHoldingRow } from "../lib/holdings-adapter";

/**
 * TABLE-01 / SC#2 — fail-loud all-columns render guard for the two
 * highest-stakes HoldingsTable modes.
 *
 * The densest financial tables must keep EVERY material column reachable at
 * 320px (phase 46 reshapes by SCROLLING columns, never dropping them). This
 * guard pins the exact `<th>` set + count so a future `hidden` / `md:table-cell`
 * / column-`truncate` edit that drops a metric or status fails CI loudly
 * (CLAUDE.md Rule 12).
 *
 * ⚠️ Anchored on the CODE constants + verbatim `<th>` set — NOT the UI-SPEC's
 * inverted "NEW"/"DESIGN" mode names (46-RESEARCH §"the UI-SPEC mode labels are
 * INVERTED"):
 *   - LegacyHoldingsTable  → TOTAL_COLUMNS = 7
 *   - DesignHoldingsTable  → DESIGN_TOTAL_COLUMNS = 9
 *
 * Falsifiability proof (Rule 12): deleting any material `<th>` from either
 * mode in HoldingsTable.tsx makes this guard go RED. Proven once by the
 * implementer (delete → red → restore → green); recorded in 46-01-SUMMARY.md.
 */

// HoldingsTable imports useRouter/useSearchParams at module scope (the design
// mode uses router.refresh in the banner-dismiss path). Mirror the proven
// harness from HoldingsTable.strategy-rows.test.tsx.
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

// The `hidden md:table-cell truncate` anti-pattern this guard bans on any
// MATERIAL column header. A label that carries one would render a "smaller
// truth" on mobile — exactly the no-invented-data violation phase 46 forbids.
const HIDDEN_OR_TRUNCATE = /\bhidden\b|md:table-cell|\btruncate\b/;

// Sortable headers append an aria-hidden sort-direction glyph to the active
// column's text (e.g. "Allocation↓"). It is decoration, not a column — strip it
// so the ORDER assertion pins the material label set, not the transient sort
// indicator. (Column PRESENCE drop is still caught: removing a <th> removes its
// label entirely, glyph or not.)
const SORT_GLYPHS = /[↑↓▲▼]/g;

function headerLabels(thead: HTMLElement): string[] {
  return Array.from(thead.querySelectorAll("th"))
    .map((h) => (h.textContent ?? "").replace(SORT_GLYPHS, "").trim())
    .filter((t) => t.length > 0);
}

function makeLegacyHolding(over: Partial<HoldingRow> = {}): HoldingRow {
  return {
    id: "legacy-1",
    venue: "binance",
    symbol: "BTC",
    holding_type: "spot",
    quantity: 1.5,
    value_usd: 90_000,
    entry_price: 60_000,
    unrealized_pnl_usd: 1_200,
    // 167.2.1.1.1.1 D-07: a spot row with no usable mark reads "No price".
    // This builder is priced (1.5 x 60,000 = 90,000) so its assertions about a
    // priced row keep their meaning.
    mark_price_usd: 60_000,
    api_key_id: "key-1",
    source_key_sync_status: "complete",
    source_key_disconnected_at: null,
    ...over,
  };
}

function makeDesignRow(over: Partial<DesignHoldingRow> = {}): DesignHoldingRow {
  return {
    id: "design-1",
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
    // No banner / sub-row rows so the only columnheaders come from the <thead>.
    bridgeCandidate: false,
    ...over,
  };
}

describe("HoldingsTable all-columns guard — LegacyHoldingsTable (TOTAL_COLUMNS = 7)", () => {
  // VERBATIM material header set from HoldingsTable.tsx:402-410. The 7th column
  // (Notes icon) has no text label — assert it by its aria-label, not text.
  const LEGACY_NAMED_HEADERS = [
    "Venue / Symbol",
    "Type",
    "Quantity",
    "Entry price",
    "Value (USD)",
    "Unrealized P&L",
  ];

  function renderLegacy() {
    return render(
      <HoldingsTable
        holdings={[makeLegacyHolding()]}
        showRevoked={true}
        onShowRevokedChange={() => {}}
      />,
    );
  }

  it("renders EXACTLY 7 columnheaders — the 6 named material headers + the Notes icon", () => {
    const { container } = renderLegacy();
    const thead = container.querySelector("thead")!;
    const headers = within(thead).getAllByRole("columnheader");

    // Count is pinned to the code constant TOTAL_COLUMNS = 7. Dropping any
    // material <th> drops this below 7 → RED.
    expect(headers).toHaveLength(7);

    // The 6 named material headers, in order (the 7th is the icon-only Notes col).
    expect(headerLabels(thead)).toEqual(LEGACY_NAMED_HEADERS);

    // The 7th column is the Notes icon header — no text, identified by aria-label.
    expect(
      within(thead).getByRole("columnheader", { name: "Notes" }),
    ).toBeInTheDocument();
  });

  it("every named material header is present (drop-one fails loud)", () => {
    const { container } = renderLegacy();
    const thead = container.querySelector("thead")!;
    for (const name of LEGACY_NAMED_HEADERS) {
      expect(
        within(thead).getByRole("columnheader", { name }),
      ).toBeInTheDocument();
    }
  });

  it("no material header carries a hidden / md:table-cell / truncate class", () => {
    const { container } = renderLegacy();
    const thead = container.querySelector("thead")!;
    const headers = within(thead).getAllByRole("columnheader");
    for (const h of headers) {
      expect(h.className).not.toMatch(HIDDEN_OR_TRUNCATE);
    }
  });
});

describe("HoldingsTable all-columns guard — DesignHoldingsTable (DESIGN_TOTAL_COLUMNS = 9)", () => {
  // VERBATIM material header set from HoldingsTable.tsx:622-672. The 1st column
  // (Status dot) has no text label — assert it by its aria-label.
  const DESIGN_NAMED_HEADERS = [
    "Strategy",
    "Symbol",
    "Weight",
    "Allocation",
    "MTD",
    "Sharpe",
    "Max DD",
    "Age",
  ];

  function renderDesign() {
    return render(
      <HoldingsTable
        rows={[makeDesignRow()]}
        disconnectedAtByHoldingId={{}}
        revokedStatusByHoldingId={{}}
        flaggedHoldingsByRef={{}}
        showRevoked={true}
      />,
    );
  }

  it("renders EXACTLY 9 columnheaders — the Status icon + 8 named material headers", () => {
    const { container } = renderDesign();
    const thead = container.querySelector("thead")!;
    const headers = within(thead).getAllByRole("columnheader");

    // Count is pinned to the code constant DESIGN_TOTAL_COLUMNS = 9. Dropping
    // any material <th> drops this below 9 → RED.
    expect(headers).toHaveLength(9);

    // The 8 named material headers, in order (the 1st is the icon-only Status col).
    expect(headerLabels(thead)).toEqual(DESIGN_NAMED_HEADERS);

    // The 1st column is the Status icon header — no text, identified by aria-label.
    expect(
      within(thead).getByRole("columnheader", { name: "Status" }),
    ).toBeInTheDocument();
  });

  it("every named material header is present (drop-one fails loud)", () => {
    const { container } = renderDesign();
    const thead = container.querySelector("thead")!;
    for (const name of DESIGN_NAMED_HEADERS) {
      expect(
        within(thead).getByRole("columnheader", { name }),
      ).toBeInTheDocument();
    }
  });

  it("no material header carries a hidden / md:table-cell / truncate class", () => {
    const { container } = renderDesign();
    const thead = container.querySelector("thead")!;
    const headers = within(thead).getAllByRole("columnheader");
    for (const h of headers) {
      expect(h.className).not.toMatch(HIDDEN_OR_TRUNCATE);
    }
  });
});

// Plan 201-15 (D-01, D-03): "Sharpe" and "Max DD" are registered terms. Each is the
// label of a sort BUTTON, so it is Form B: the control itself is wrapped in a Tooltip
// carrying the registry text, and no second focusable (a Form A span) sits inside the
// button. The button keeps sorting; the definition shows on focus.
describe("HoldingsTable design-table headers — registered terms explain themselves (plan 201-15)", () => {
  function renderDesignHeaders() {
    return render(
      <HoldingsTable
        rows={[makeDesignRow()]}
        disconnectedAtByHoldingId={{}}
        revokedStatusByHoldingId={{}}
        flaggedHoldingsByRef={{}}
        showRevoked={true}
      />,
    );
  }

  it.each([
    ["Sharpe", "sharpe"],
    ["Max DD", "max_drawdown"],
  ] as const)("%s: keyboard focus on the sort button shows the registry definition", (label, key) => {
    vi.useFakeTimers();
    try {
      const { container } = renderDesignHeaders();
      const thead = container.querySelector("thead")!;
      const button = within(thead).getByRole("button", { name: label });
      // No focusable span nested in the button (a focusable inside a focusable).
      expect(button.querySelector("[tabindex]")).toBeNull();
      fireEvent.focus(button);
      act(() => {
        vi.advanceTimersByTime(150);
      });
      expect(screen.getByRole("tooltip").textContent).toBe(termDefinition(key));
    } finally {
      vi.runOnlyPendingTimers();
      vi.useRealTimers();
    }
  });

  it("a header that is not a registered term gets no bubble", () => {
    vi.useFakeTimers();
    try {
      const { container } = renderDesignHeaders();
      const thead = container.querySelector("thead")!;
      fireEvent.focus(within(thead).getByRole("button", { name: "MTD" }));
      act(() => {
        vi.advanceTimersByTime(150);
      });
      expect(screen.queryByRole("tooltip")).toBeNull();
    } finally {
      vi.runOnlyPendingTimers();
      vi.useRealTimers();
    }
  });
});
