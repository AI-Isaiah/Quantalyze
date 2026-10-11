/**
 * Phase 170.7 / Plan 01 / D-01 — StrategyTable `managerRows` prop.
 *
 * `managerRows` is the one seam by which /strategies (the manager's My
 * Strategies page, plan 06) mounts the SHARED ranking table. Present, the
 * table gains a Status column right after Strategy, and its Actions cell holds
 * an Edit link followed by a server-built slot. Absent, the three existing
 * mounts are byte-identical (pinned by StrategyTable.default-mounts.test.tsx).
 *
 * What this file protects, in the order a reader would be hurt by its loss:
 *   1. COLUMN ALIGNMENT. The Status header must sit inside the `COLUMNS.map`
 *      after the Strategy header. A header emitted after the map lands after
 *      AUM and every data cell is read under the wrong heading.
 *   2. NO DOUBLE STATUS. The in-name status badge and the ownership tag are
 *      owner-mount furniture; in manager mode Status is its own column.
 *   3. NO CONTROL THAT CANNOT WORK. A manager's page has no allocator
 *      portfolio; Simulate Impact, Mark ownership and Rename do not belong
 *      in its Actions cell.
 *   4. td count equals th count in EVERY row kind (data, empty-state,
 *      placeholder), or the columns silently misalign.
 *
 * The status label is READ FROM `Badge`, never typed, so a 170.1 COPY recase of
 * the shared label map follows without an edit here.
 *
 * `categorySlug="mgr-spec"` is distinct on purpose: the discovery prefs key is
 * read from the shared jsdom localStorage (see StrategyTable.visibility.test).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useEffect, type ReactNode } from "react";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { StrategyTable } from "./StrategyTable";
import { Badge } from "@/components/ui/Badge";
import type { Strategy, StrategyAnalytics } from "@/lib/types";
import { installFetchMock, restoreFetchMock } from "@/test/helpers/fetch";

type Row = Strategy & { analytics: StrategyAnalytics };
type ManagerRows = Record<
  string,
  { editHref: string; actions: ReactNode; note?: ReactNode }
>;

const ID_PUBLISHED = "55555555-0000-4000-8000-000000000001";
const ID_PRIVATE = "55555555-0000-4000-8000-000000000002";
const ID_PENDING = "55555555-0000-4000-8000-000000000003";
const ID_DRAFT = "55555555-0000-4000-8000-000000000004";
const ID_ARCHIVED = "55555555-0000-4000-8000-000000000005";

const NAME_PUBLISHED = "Mgr Published";
const NAME_PRIVATE = "Mgr Private";
const NAME_PENDING = "Mgr Pending";
const NAME_DRAFT = "Mgr Draft";
const NAME_ARCHIVED = "Mgr Archived";

vi.mock("@/components/discovery/SimulateImpactButton", () => ({
  SimulateImpactButton: () => <span data-testid="simulate-probe" />,
}));

function makeAnalytics(overrides?: Partial<StrategyAnalytics>): StrategyAnalytics {
  return {
    id: "an-1",
    strategy_id: "s-1",
    computed_at: "2026-01-01T00:00:00Z",
    computing_started_at: null,
    computation_status: "complete",
    computation_error: null,
    benchmark: null,
    cumulative_return: 0.42,
    cagr: 0.18,
    volatility: 0.22,
    sharpe: 1.5,
    sortino: 1.9,
    calmar: 1.1,
    max_drawdown: -0.12,
    max_drawdown_duration_days: 30,
    six_month_return: 0.21,
    sparkline_returns: [0, 1, 2, 3, 4],
    sparkline_drawdown: [0, -0.1, -0.2, -0.05, 0],
    metrics_json: null,
    returns_series: null,
    drawdown_series: null,
    monthly_returns: null,
    daily_returns: null,
    rolling_metrics: null,
    return_quantiles: null,
    trade_metrics: null,
    volume_metrics: null,
    exposure_metrics: null,
    data_quality_flags: null,
    trades_fetched_at: null,
    ...overrides,
  };
}

function makeStrategy(
  overrides: Partial<Strategy> & { id: string; name: string },
): Row {
  return {
    user_id: "u-1",
    category_id: "cat-1",
    api_key_id: null,
    description: null,
    strategy_types: ["Long-Only"],
    subtypes: ["Trend Following"],
    markets: ["Spot"],
    supported_exchanges: ["Binance"],
    leverage_range: null,
    avg_daily_turnover: null,
    aum: 1_000_000,
    max_capacity: 10_000_000,
    start_date: "2024-01-01",
    status: "published",
    is_example: false,
    benchmark: "BTC",
    created_at: "2024-01-01T00:00:00Z",
    ...overrides,
    analytics: makeAnalytics({ strategy_id: overrides.id }),
  };
}

const ROWS: Row[] = [
  makeStrategy({
    id: ID_PUBLISHED,
    name: NAME_PUBLISHED,
    status: "published",
    // A mark on a published row with a portfolio: the owner mount would render
    // an ownership tag AND a Simulate Impact button here. Manager mode renders
    // neither.
    capital_ownership: "own_capital",
  }),
  makeStrategy({ id: ID_PRIVATE, name: NAME_PRIVATE, status: "private" }),
  makeStrategy({ id: ID_PENDING, name: NAME_PENDING, status: "pending_review" }),
  makeStrategy({ id: ID_DRAFT, name: NAME_DRAFT, status: "draft" }),
  makeStrategy({ id: ID_ARCHIVED, name: NAME_ARCHIVED, status: "archived" }),
];

const slotTestId = (id: string) => `slot-${id}`;

function managerRowsFor(rows: Row[]): ManagerRows {
  return Object.fromEntries(
    rows.map((r) => [
      r.id,
      {
        editHref: `/strategies/${r.id}/edit`,
        actions: <span data-testid={slotTestId(r.id)}>slot {r.name}</span>,
      },
    ]),
  );
}

beforeEach(() => {
  installFetchMock();
  try {
    window.localStorage.clear();
  } catch {
    // jsdom may not implement clear in some configurations; non-fatal.
  }
});

afterEach(() => {
  restoreFetchMock();
});

// --- Helpers -------------------------------------------------------------

const MANAGER_HEADERS = [
  "Rank",
  "Strategy",
  "Status",
  "Created",
  "Return %",
  "CAGR",
  "Sharpe",
  "Max DD",
  "Volatility",
  "6 Month",
  "AUM",
  "Return",
  "Underwater",
  "Details",
  "Actions",
];

function renderManager(
  overrides: {
    rows?: Row[];
    managerRows?: ManagerRows;
    extra?: Record<string, unknown>;
  } = {},
) {
  const rows = overrides.rows ?? ROWS;
  return render(
    <StrategyTable
      strategies={rows}
      categorySlug="mgr-spec"
      visibility="owner-all-statuses"
      managerRows={overrides.managerRows ?? managerRowsFor(rows)}
      {...(overrides.extra ?? {})}
    />,
  );
}

/** The status label exactly as the shared Badge prints it (never typed here). */
function badgeLabel(status: string): string {
  const { container, unmount } = render(<Badge type="status" label={status} />);
  const text = (container.textContent ?? "").trim();
  unmount();
  return text;
}

function headers(): HTMLElement[] {
  return screen.getAllByRole("columnheader");
}

function dataRow(name: string): HTMLElement {
  const link = screen.getByRole("link", { name });
  const row = link.closest("tr");
  if (!row) throw new Error(`no row for "${name}"`);
  return row;
}

function cells(row: HTMLElement): HTMLTableCellElement[] {
  return Array.from(row.querySelectorAll<HTMLTableCellElement>(":scope > td"));
}

function colSpanTotal(row: HTMLElement): number {
  return cells(row).reduce((n, td) => n + (td.colSpan || 1), 0);
}

// -------------------------------------------------------------------------

describe("StrategyTable managerRows — header order (D-01)", () => {
  it("reads Rank, Strategy, Status, Created, the Discovery metrics, then Actions last", () => {
    renderManager();
    const hs = headers();
    expect(hs).toHaveLength(MANAGER_HEADERS.length);
    MANAGER_HEADERS.forEach((name, i) => {
      // Exact-string role query: 'Return' must not match 'Return %'.
      expect(screen.getByRole("columnheader", { name })).toBe(hs[i]);
    });
  });

  it("Status is a plain header: no sort button, no aria-sort, no horizontal pin", () => {
    renderManager();
    const status = screen.getByRole("columnheader", { name: "Status" });
    expect(within(status).queryByRole("button")).toBeNull();
    expect(status.hasAttribute("aria-sort")).toBe(false);
    // Vertically sticky at z-20, one step under the pinned Strategy header's
    // z-30, and never horizontally pinned (D-07: no 170.2 pin class copied).
    expect(status.className).toContain("sticky");
    expect(status.className).toContain("z-20");
    expect(status.className).not.toContain("z-30");
    expect(status.className).not.toMatch(/(^|\s)(@3xl:)?left-/);
  });

  it("with managerRows absent the header list is the owner mount's (no Status)", () => {
    render(
      <StrategyTable
        strategies={ROWS}
        categorySlug="mgr-spec"
        visibility="owner-all-statuses"
      />,
    );
    // 2026-10-10 (170.7 plan 03, D-09): the manager list is now Status AND
    // Created wider than the owner mount, so the absent-prop count is two less.
    expect(headers()).toHaveLength(MANAGER_HEADERS.length - 2);
    expect(screen.queryByRole("columnheader", { name: "Status" })).toBeNull();
    expect(screen.queryByRole("columnheader", { name: "Created" })).toBeNull();
  });
});

describe("StrategyTable managerRows — Status cell (D-01)", () => {
  it("each row's cell right after Strategy holds the shared Badge label", () => {
    renderManager();
    for (const r of ROWS) {
      const tds = cells(dataRow(r.name));
      // 0 rank, 1 Strategy, 2 Status.
      expect(within(tds[1]).getByRole("link", { name: r.name })).toBeInTheDocument();
      expect(tds[2].textContent?.trim()).toBe(badgeLabel(r.status));
    }
    // Non-vacuity: five different statuses, five different labels.
    expect(new Set(ROWS.map((r) => badgeLabel(r.status))).size).toBe(5);
  });

  it("the Strategy cell no longer repeats the status, and carries no ownership tag", () => {
    renderManager();
    for (const r of ROWS.filter((x) => x.status !== "published")) {
      const strategyCell = cells(dataRow(r.name))[1];
      // A BADGE element reading exactly the label. The row's own name ("Mgr
      // Private") contains the label as a substring AND NowrapWords renders each
      // word as its own span, so neither text containment nor "any span" works.
      const label = badgeLabel(r.status);
      const repeats = Array.from(strategyCell.querySelectorAll("span.rounded-md")).some(
        (el) => el.textContent?.trim() === label,
      );
      expect(repeats).toBe(false);
    }
    // The published row carries a capital_ownership mark; no tag anywhere.
    expect(screen.queryByText("Own capital")).toBeNull();
    expect(screen.queryByText("Team review")).toBeNull();
  });
});

describe("StrategyTable managerRows — Actions cell (D-01)", () => {
  it("holds, in order, the Edit link to editHref then the row's slot", () => {
    renderManager();
    for (const r of ROWS) {
      const row = dataRow(r.name);
      const actionsCell = cells(row).at(-1) as HTMLTableCellElement;
      const edit = within(actionsCell).getByRole("link", { name: `Edit ${r.name}` });
      expect(edit.getAttribute("href")).toBe(`/strategies/${r.id}/edit`);
      expect(edit.textContent).toBe("Edit");
      const slot = within(actionsCell).getByTestId(slotTestId(r.id));
      expect(
        edit.compareDocumentPosition(slot) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      // One line: the wrapper never wraps.
      const wrapper = edit.parentElement as HTMLElement;
      expect(wrapper.className).toContain("flex-nowrap");
      expect(wrapper.className).toContain("whitespace-nowrap");
      expect(wrapper.contains(slot)).toBe(true);
    }
  });

  it("each slot mounts exactly once", () => {
    renderManager();
    for (const r of ROWS) {
      expect(screen.getAllByTestId(slotTestId(r.id))).toHaveLength(1);
    }
  });

  it("renders no Simulate Impact, Mark ownership or Rename, even for a published own-capital row with a portfolio", () => {
    renderManager({
      extra: {
        portfolioId: "pf-1",
        onMarkOwnership: () => {},
        onRename: () => {},
      },
    });
    expect(screen.queryByTestId("simulate-probe")).toBeNull();
    expect(screen.queryByText(/Mark ownership/)).toBeNull();
    expect(screen.queryByText(/Change mark/)).toBeNull();
    expect(screen.queryByText(/Rename/)).toBeNull();
    // Non-vacuity: the same props WITHOUT managerRows do render them.
    render(
      <StrategyTable
        strategies={ROWS}
        categorySlug="mgr-spec-b"
        visibility="owner-all-statuses"
        portfolioId="pf-1"
        onMarkOwnership={() => {}}
        onRename={() => {}}
      />,
    );
    expect(screen.queryAllByTestId("simulate-probe").length).toBeGreaterThan(0);
    expect(screen.queryAllByText(/Mark ownership|Change mark/).length).toBeGreaterThan(0);
  });

  it("a row id with no managerRows entry renders an empty Actions cell and no Edit link, never another row's slot", () => {
    const partial = managerRowsFor(ROWS);
    delete partial[ID_PRIVATE];
    renderManager({ managerRows: partial });
    const actionsCell = cells(dataRow(NAME_PRIVATE)).at(-1) as HTMLTableCellElement;
    expect(actionsCell.textContent?.trim()).toBe("");
    expect(within(actionsCell).queryByRole("link")).toBeNull();
    expect(within(actionsCell).queryByTestId(/^slot-/)).toBeNull();
    // The other rows are untouched.
    expect(screen.getAllByRole("link", { name: /^Edit / })).toHaveLength(ROWS.length - 1);
  });
});

describe("StrategyTable managerRows — every row kind spans the header count (D-01)", () => {
  it("data rows: td count equals th count", () => {
    renderManager();
    const thCount = headers().length;
    for (const r of ROWS) {
      expect(colSpanTotal(dataRow(r.name))).toBe(thCount);
    }
  });

  it("the 'No strategies match your filters.' row spans the header count", () => {
    renderManager({ rows: [], managerRows: {} });
    const thCount = headers().length;
    const empty = screen.getByText("No strategies match your filters.").closest("tr");
    expect(empty).not.toBeNull();
    expect(colSpanTotal(empty as HTMLElement)).toBe(thCount);
  });

  it("a placeholder row rendered with managerRows has a Status cell and matches too", () => {
    renderManager({
      extra: {
        placeholderKeys: [{ id: "pk-1", exchangeLabel: "Binance", keyLabel: "Main" }],
        onFinishSetup: () => {},
      },
    });
    const thCount = headers().length;
    const placeholder = screen.getByText("Finish setup →").closest("tr") as HTMLElement;
    expect(placeholder).not.toBeNull();
    expect(colSpanTotal(placeholder)).toBe(thCount);
    // Status td directly after the name td, an honest em dash (no status exists).
    expect(cells(placeholder)[2].textContent?.trim()).toBe("—");
  });
});

// --- Plan 02 / D-06: the full-width note row ------------------------------
//
// A strategy's notes (review feedback, KCS-06 key lines, KCS-12 share note) are
// sentences and do not fit a cell. They render in ONE extra `<tr>` directly
// under the strategy, only when the strategy has a note. What a reader would be
// hurt by losing, in order:
//   1. ADJACENCY. The note sits directly under ITS strategy; a note row
//      attached to the wrong row says the wrong thing about a strategy.
//   2. SPAN. The one cell covers every header, or a column band is left bare.
//   3. ONE RECORD, ONE HAIRLINE. The pair shares a single bottom border.
//   4. ALIGNMENT. The note text lines up with the name at the pin step, tied to
//      the SAME variable the Strategy cells read, so a re-measured pin offset
//      moves both (a copied literal would drift silently).

const NOTE_ROW = '[data-testid="strategy-row-note"]';
const NOTED = [ID_PUBLISHED, ID_PENDING];
const noteText = (id: string) => `note for ${id}`;

function managerRowsWithNotes(rows: Row[], noted: string[]): ManagerRows {
  const base = managerRowsFor(rows);
  for (const id of noted) {
    base[id] = {
      ...base[id],
      note: <p data-testid={`note-${id}`}>{noteText(id)}</p>,
    };
  }
  return base;
}

function renderNoted() {
  return renderManager({ managerRows: managerRowsWithNotes(ROWS, NOTED) });
}

function classTokens(el: Element): string[] {
  return (el.getAttribute("class") ?? "").split(/\s+/).filter(Boolean);
}

describe("StrategyTable managerRows — note row (D-06)", () => {
  it("renders one note row per noted strategy, each directly under its own data row", () => {
    const { container } = renderNoted();
    expect(container.querySelectorAll(NOTE_ROW)).toHaveLength(NOTED.length);
    for (const r of ROWS) {
      const next = dataRow(r.name).nextElementSibling;
      if (NOTED.includes(r.id)) {
        expect(next?.getAttribute("data-testid")).toBe("strategy-row-note");
        expect(
          within(next as HTMLElement).getByTestId(`note-${r.id}`),
        ).toBeInTheDocument();
      } else {
        // No note, no note row: the next sibling is another data row or nothing.
        expect(next?.getAttribute("data-testid") ?? null).not.toBe("strategy-row-note");
      }
    }
    // Non-vacuity: both noted and un-noted rows exist.
    expect(ROWS.length).toBeGreaterThan(NOTED.length);
  });

  it("holds one cell spanning every header, around the footer block holding the note's nodes", () => {
    const { container } = renderNoted();
    const headerCount = headers().length;
    const noteRows = Array.from(container.querySelectorAll<HTMLElement>(NOTE_ROW));
    expect(noteRows).toHaveLength(NOTED.length);
    for (const row of noteRows) {
      const tds = cells(row);
      expect(tds).toHaveLength(1);
      expect(tds[0].colSpan).toBe(headerCount);
      const footer = tds[0].querySelector('[data-testid="strategy-row-footer"]');
      expect(footer).not.toBeNull();
      // The cell holds the footer block only; the note is the footer's child.
      expect(tds[0].children).toHaveLength(1);
      expect((footer as HTMLElement).children.length).toBeGreaterThan(0);
    }
  });

  it("passes the hairline to the note row: the pair has one bottom border", () => {
    const { container } = renderNoted();
    const plainRow = (() => {
      const { container: c, unmount } = render(
        <StrategyTable
          strategies={ROWS}
          categorySlug="mgr-spec-plain"
          visibility="owner-all-statuses"
        />,
      );
      const cls = (c.querySelector("tbody tr") as HTMLElement).className;
      unmount();
      return cls;
    })();
    for (const r of ROWS) {
      const row = dataRow(r.name);
      if (NOTED.includes(r.id)) {
        expect(classTokens(row)).not.toContain("border-b");
        const note = row.nextElementSibling as HTMLElement;
        const tokens = classTokens(note);
        expect(tokens).toContain("border-b");
        expect(tokens).toContain("border-border");
        expect(tokens).toContain("last:border-0");
        expect(tokens).toContain("bg-surface");
        expect(tokens).not.toContain("bg-surface-subtle");
      } else {
        // A row with no note keeps today's class string exactly.
        expect(row.className).toBe(plainRow);
      }
    }
    expect(container.querySelectorAll(NOTE_ROW)).toHaveLength(NOTED.length);
  });

  it("does not render a note row when managerRows is absent or the entry has no note", () => {
    const { container, unmount } = renderManager();
    expect(container.querySelectorAll(NOTE_ROW)).toHaveLength(0);
    unmount();
    const r2 = render(
      <StrategyTable
        strategies={ROWS}
        categorySlug="mgr-spec-b2"
        visibility="owner-all-statuses"
      />,
    );
    expect(r2.container.querySelectorAll(NOTE_ROW)).toHaveLength(0);
  });

  it("the footer block is a sticky, region-wide, caption-size block with no bg-track", () => {
    const { container } = renderNoted();
    const footers = Array.from(
      container.querySelectorAll<HTMLElement>('[data-testid="strategy-row-footer"]'),
    );
    expect(footers).toHaveLength(NOTED.length);
    for (const footer of footers) {
      const tokens = classTokens(footer);
      for (const t of [
        "sticky",
        "left-0",
        "w-[100cqw]",
        "text-caption",
        "pb-3",
        "pl-4",
        "pr-4",
        "overflow-visible",
      ]) {
        expect(tokens).toContain(t);
      }
      expect(tokens.some((t) => t.includes("bg-track"))).toBe(false);
      // No top padding: the note hugs its row.
      expect(tokens.some((t) => /(^|:)p[ty]-/.test(t))).toBe(false);
    }
  });

  it("the @3xl indent is the SAME variable the Strategy cells pin to, plus 1rem", () => {
    const { container } = renderNoted();
    const strategyTh = screen.getByRole("columnheader", { name: "Strategy" });
    const pinToken = classTokens(strategyTh).find((t) =>
      t.startsWith("@3xl:left-("),
    );
    expect(pinToken).toBeDefined();
    // `@3xl:left-(--pin-strategy-left)` -> `--pin-strategy-left`
    const variable = (pinToken as string).slice("@3xl:left-(".length, -1);
    expect(variable).toMatch(/^--pin-/);
    const footer = container.querySelector(
      '[data-testid="strategy-row-footer"]',
    ) as HTMLElement;
    const indent = classTokens(footer).filter((t) => t.startsWith("@3xl:pl-"));
    expect(indent).toEqual([`@3xl:pl-[calc(var(${variable})+1rem)]`]);
  });
});

// --- Plan 02 / D-01: the actions slot mounts once -------------------------
//
// The private-link control in the Actions cell opens a NATIVE <dialog>; on close
// the browser returns focus to the node that opened it. If the row remounted
// while the dialog was alive (a sort, a density change, a search), that node
// would be gone and focus would fall to <body> (founder UAT #4). The mechanism
// is the Fragment keyed by `s.id`: React MOVES a keyed row on a re-sort and
// keeps its subtree. This probe counts real mounts and unmounts of the slot AND
// compares DOM node identity per strategy: a row keyed by loop index re-uses the
// node at a position for a different strategy without remounting it, so the
// counters alone stay green and only the identity check turns it RED. Focus
// return itself is asserted in Playwright by plan 07.
//
// PAGE changes are narrowed on purpose, not dropped: the rows leaving the page
// unmount by construction, and that cannot reach the modal, because an open
// native dialog is modal (everything behind it is inert, so pagination is
// unreachable while it is open). The UI-SPEC's "across page changes" means this.

const probe = {
  mounts: new Map<string, number>(),
  cleanups: new Map<string, number>(),
};

function MountProbe({ id }: { id: string }) {
  useEffect(() => {
    probe.mounts.set(id, (probe.mounts.get(id) ?? 0) + 1);
    return () => {
      probe.cleanups.set(id, (probe.cleanups.get(id) ?? 0) + 1);
    };
    // Empty deps on purpose: this counts MOUNTS of the slot, not renders.
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return <span data-testid={slotTestId(id)}>probe</span>;
}

// Distinct Sharpe values so a Sharpe sort really reorders the rows; with equal
// values a re-sort moves nothing and an index key would pass vacuously.
const PROBE_ROWS: Row[] = ROWS.map((r, i) => ({
  ...r,
  analytics: makeAnalytics({ strategy_id: r.id, sharpe: 1 + i * 0.5 }),
}));

function probeManagerRows(): ManagerRows {
  return Object.fromEntries(
    PROBE_ROWS.map((r) => [
      r.id,
      {
        editHref: `/strategies/${r.id}/edit`,
        actions: <MountProbe id={r.id} />,
        // A note on every other row: the Fragment pair is what is being keyed.
        ...(PROBE_ROWS.indexOf(r) % 2 === 0
          ? { note: <p>{`note ${r.id}`}</p> }
          : {}),
      },
    ]),
  );
}

function visibleOrder(): string[] {
  return PROBE_ROWS.map((r) => r.name)
    .map((name) => ({ name, row: dataRow(name) }))
    .sort((a, b) =>
      a.row.compareDocumentPosition(b.row) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1,
    )
    .map((x) => x.name);
}

describe("StrategyTable managerRows — the actions slot mounts once (D-01)", () => {
  beforeEach(() => {
    probe.mounts.clear();
    probe.cleanups.clear();
  });

  it("mount once: a sort, a density change and a search that keeps the row never remount a slot", () => {
    renderManager({ rows: PROBE_ROWS, managerRows: probeManagerRows() });
    for (const r of PROBE_ROWS) expect(probe.mounts.get(r.id)).toBe(1);

    const before = visibleOrder();

    // Node identity per strategy. Counting mounts alone is NOT enough: a row
    // keyed by loop index keeps one component instance per POSITION and merely
    // re-points its props, so the mount counter stays at 1 while the DOM node
    // at that position now belongs to a different strategy. The opener node of
    // an open dialog is exactly such a node, so identity is the real contract.
    const slotNode = new Map(
      PROBE_ROWS.map((r) => [r.id, screen.getByTestId(slotTestId(r.id))]),
    );
    const rowNode = new Map(PROBE_ROWS.map((r) => [r.id, dataRow(r.name)]));
    // Checked after EACH step: the default sort is Sharpe descending and two
    // header clicks return to it, so only an intermediate check sees the reorder.
    const expectSameNodes = () => {
      for (const r of PROBE_ROWS) {
        expect(screen.getByTestId(slotTestId(r.id))).toBe(slotNode.get(r.id));
        expect(dataRow(r.name)).toBe(rowNode.get(r.id));
      }
    };

    // Sharpe header: ascending, then descending. The order must really change,
    // or the probe proves nothing about a reorder.
    const sharpe = screen.getByRole("button", { name: /Sharpe/ });
    fireEvent.click(sharpe);
    const afterFirst = visibleOrder();
    expect(afterFirst.join()).not.toBe(before.join());
    expectSameNodes();
    fireEvent.click(sharpe);
    const afterSecond = visibleOrder();
    expectSameNodes();
    expect(afterSecond.join()).toBe(before.join()); // back to the default order

    // Density: compact and back.
    fireEvent.click(screen.getByRole("button", { name: "Compact" }));
    fireEvent.click(screen.getByRole("button", { name: "Comfortable" }));

    // A search every probed row survives ("Mgr" is in every name).
    fireEvent.change(screen.getByPlaceholderText("Search strategies..."), {
      target: { value: "Mgr" },
    });
    for (const r of PROBE_ROWS) expect(dataRow(r.name)).toBeInTheDocument();

    for (const r of PROBE_ROWS) {
      expect(probe.mounts.get(r.id)).toBe(1);
      expect(probe.cleanups.get(r.id) ?? 0).toBe(0);
      expect(screen.getAllByTestId(slotTestId(r.id))).toHaveLength(1);
    }
    // The very same nodes, not look-alikes at the same position.
    expectSameNodes();
  });
});

// --- Plan 03 / D-09: the Created column and the newest-first default ------
//
// The founder's request (D-09): the manager's list shows the day each strategy
// was created and opens newest first, so a strategy added a minute ago is the
// top row. What a reader would be hurt by losing, in order:
//   1. THE NEW STRATEGY IS ALWAYS AT THE TOP. A strategy with no analytics has
//      nothing to rank by, and the STALE-01 partition sinks it below every
//      ranked row under a METRIC sort. Under the Created sort it is ordered by
//      a fact it does have (its date), so the partition must not apply.
//   2. THE PARTITION STILL HOLDS FOR EVERY METRIC. Exempting only the Created
//      key is the whole change; a wider exemption would file an unranked row
//      mid-table under Sharpe at an invented 0.
//   3. THE DATE IS THE UTC DAY. Not a locale string (server and browser
//      disagree), so the cell is formatIsoDay of the stored timestamp.
//   4. TD COUNT EQUALS TH COUNT in every row kind, with Created counted.

const ID_NEW = "66666666-0000-4000-8000-000000000001";
const ID_MID = "66666666-0000-4000-8000-000000000002";
const ID_OLD = "66666666-0000-4000-8000-000000000003";
const NAME_NEW = "Mgr Newest";
const NAME_MID = "Mgr Middle";
const NAME_OLD = "Mgr Oldest";

// N: newest and NO analytics yet (D-03). M: middle, Sharpe 2.0. O: oldest,
// Sharpe 1.0. Distinct Sharpe values so the Sharpe order is unambiguous.
const DATE_ROWS: Row[] = [
  {
    ...makeStrategy({
      id: ID_NEW,
      name: NAME_NEW,
      created_at: "2026-10-09T23:30:00-05:00",
    }),
    analyticsPresent: false,
    analytics: makeAnalytics({
      strategy_id: ID_NEW,
      computation_status: "pending",
      sharpe: null,
      cumulative_return: null,
    }),
  } as Row,
  {
    ...makeStrategy({ id: ID_MID, name: NAME_MID, created_at: "2026-06-01T08:00:00Z" }),
    analytics: makeAnalytics({ strategy_id: ID_MID, sharpe: 2.0 }),
  },
  {
    ...makeStrategy({ id: ID_OLD, name: NAME_OLD, created_at: "2025-02-03T00:00:00Z" }),
    analytics: makeAnalytics({ strategy_id: ID_OLD, sharpe: 1.0 }),
  },
];

/** Strategy names in the order the data rows appear (name links, row order). */
function visibleNames(): string[] {
  return screen
    .getAllByRole("link", { name: /^Mgr (Newest|Middle|Oldest)$/ })
    .map((a) => a.textContent?.trim() ?? "?");
}

function createdButton(): HTMLElement {
  return within(screen.getByRole("columnheader", { name: "Created" })).getByRole(
    "button",
    { name: /Created/ },
  );
}

describe("StrategyTable managerRows — Created cell (D-09)", () => {
  it("each row's cell right after Status reads that row's UTC day, YYYY-MM-DD", () => {
    renderManager({ rows: DATE_ROWS });
    // 0 rank, 1 Strategy, 2 Status, 3 Created. The newest row is 23:30 at -05:00,
    // i.e. already the NEXT UTC day: a string slice would print 2026-10-09.
    expect(cells(dataRow(NAME_NEW))[3].textContent?.trim()).toBe("2026-10-10");
    expect(cells(dataRow(NAME_MID))[3].textContent?.trim()).toBe("2026-06-01");
    expect(cells(dataRow(NAME_OLD))[3].textContent?.trim()).toBe("2025-02-03");
  });

  it("a malformed created_at prints an em dash, never Invalid Date", () => {
    const rows = [
      makeStrategy({ id: ID_NEW, name: NAME_NEW, created_at: "not a date" }),
    ];
    renderManager({ rows });
    expect(cells(dataRow(NAME_NEW))[3].textContent?.trim()).toBe("\u2014");
  });

  it("is Geist Mono tabular figures, not horizontally pinned", () => {
    renderManager({ rows: DATE_ROWS });
    const td = cells(dataRow(NAME_MID))[3];
    expect(td.className).toContain("font-metric");
    expect(td.className).toContain("tabular-nums");
    expect(td.className).toContain("whitespace-nowrap");
    expect(td.className).not.toMatch(/(^|\s)(@3xl:)?left-/);
  });

  it("the header is a sortable button, vertically sticky at z-20, never pinned", () => {
    renderManager({ rows: DATE_ROWS });
    const th = screen.getByRole("columnheader", { name: "Created" });
    expect(within(th).getByRole("button", { name: "Created" })).toBeInTheDocument();
    expect(th.getAttribute("aria-sort")).toBe("none");
    expect(th.className).toContain("sticky");
    expect(th.className).toContain("z-20");
    expect(th.className).not.toContain("z-30");
    expect(th.className).not.toMatch(/(^|\s)(@3xl:)?left-/);
  });

  it("with managerRows absent there is no Created header and no Created cell", () => {
    render(
      <StrategyTable
        strategies={DATE_ROWS}
        categorySlug="mgr-spec-c"
        visibility="owner-all-statuses"
      />,
    );
    expect(screen.queryByRole("columnheader", { name: "Created" })).toBeNull();
    expect(screen.queryByText("2026-06-01")).toBeNull();
  });
});

describe("StrategyTable managerRows — Created sort (D-09, D-03)", () => {
  it("sorts purely by date: newest first puts a no-analytics strategy on top, and a second click flips it", () => {
    renderManager({ rows: DATE_ROWS });
    fireEvent.click(createdButton());
    expect(visibleNames()).toEqual([NAME_NEW, NAME_MID, NAME_OLD]);
    expect(screen.getByRole("columnheader", { name: "Created" }).getAttribute("aria-sort")).toBe(
      "descending",
    );
    fireEvent.click(createdButton());
    expect(visibleNames()).toEqual([NAME_OLD, NAME_MID, NAME_NEW]);
    expect(screen.getByRole("columnheader", { name: "Created" }).getAttribute("aria-sort")).toBe(
      "ascending",
    );
  });

  it("a metric sort still sinks the unranked row below the ranked ones (STALE-01)", () => {
    renderManager({ rows: DATE_ROWS });
    fireEvent.click(createdButton()); // N, M, O
    fireEvent.click(screen.getByRole("button", { name: /Sharpe/ }));
    expect(visibleNames()).toEqual([NAME_MID, NAME_OLD, NAME_NEW]);
  });

  it("the unranked row's rank cell reads an em dash under every sort, Created included", () => {
    renderManager({ rows: DATE_ROWS });
    expect(cells(dataRow(NAME_NEW))[0].textContent?.trim()).toBe("\u2014");
    fireEvent.click(createdButton());
    expect(visibleNames()[0]).toBe(NAME_NEW);
    expect(cells(dataRow(NAME_NEW))[0].textContent?.trim()).toBe("\u2014");
    fireEvent.click(createdButton());
    expect(cells(dataRow(NAME_NEW))[0].textContent?.trim()).toBe("\u2014");
    fireEvent.click(screen.getByRole("button", { name: /Sharpe/ }));
    expect(cells(dataRow(NAME_NEW))[0].textContent?.trim()).toBe("\u2014");
  });
});

describe("StrategyTable managerRows — rank ordinals count ranked rows only (D-11)", () => {
  const rankText = (name: string) => cells(dataRow(name))[0].textContent?.trim();

  it("under Created, with an unranked row sorting first, the ranked rows read #1 and #2 and the unranked row an em dash", () => {
    renderManager({ rows: DATE_ROWS });
    fireEvent.click(createdButton());
    // Newest (no analytics) first, then the two ranked rows in date order.
    expect(visibleNames()).toEqual([NAME_NEW, NAME_MID, NAME_OLD]);
    expect(rankText(NAME_NEW)).toBe("\u2014");
    expect(rankText(NAME_MID)).toBe("#1");
    expect(rankText(NAME_OLD)).toBe("#2");
  });

  it("stays contiguous when the unranked row sorts in the middle (ascending flips the order)", () => {
    renderManager({ rows: DATE_ROWS });
    fireEvent.click(createdButton());
    fireEvent.click(createdButton()); // Oldest, Middle, Newest
    expect(visibleNames()).toEqual([NAME_OLD, NAME_MID, NAME_NEW]);
    expect(rankText(NAME_OLD)).toBe("#1");
    expect(rankText(NAME_MID)).toBe("#2");
    expect(rankText(NAME_NEW)).toBe("\u2014");
  });

  it("under a metric sort the numbers are the table positions, as on Discovery", () => {
    renderManager({ rows: DATE_ROWS }); // default Sharpe descending: Middle, Oldest, Newest
    expect(visibleNames()).toEqual([NAME_MID, NAME_OLD, NAME_NEW]);
    expect(rankText(NAME_MID)).toBe("#1");
    expect(rankText(NAME_OLD)).toBe("#2");
    expect(rankText(NAME_NEW)).toBe("\u2014");
  });
});

describe("StrategyTable managerRows — the owner's example rows are not hidden (SFH-1)", () => {
  const ID_EXAMPLE = "77777777-0000-4000-8000-000000000001";
  const NAME_EXAMPLE = "Mgr Example";

  it("an owner's is_example row is present on first render and after mount effects flush", async () => {
    const rows = [
      makeStrategy({ id: ID_EXAMPLE, name: NAME_EXAMPLE, is_example: true }),
      ...ROWS,
    ];
    await act(async () => {
      renderManager({ rows });
    });
    expect(screen.getByRole("link", { name: NAME_EXAMPLE })).toBeInTheDocument();
    expect(
      (screen.getByRole("checkbox", { name: /Hide examples/ }) as HTMLInputElement).checked,
    ).toBe(false);
  });

  it("the Hide examples checkbox still hides the row when the owner opts in", async () => {
    const rows = [makeStrategy({ id: ID_EXAMPLE, name: NAME_EXAMPLE, is_example: true }), ...ROWS];
    await act(async () => {
      renderManager({ rows });
    });
    fireEvent.click(screen.getByRole("checkbox", { name: /Hide examples/ }));
    expect(screen.queryByRole("link", { name: NAME_EXAMPLE })).toBeNull();
  });
});

describe("StrategyTable managerRows — Created counted in every row kind (D-09)", () => {
  it("data rows, the empty-state row and a placeholder row all span the header count", () => {
    renderManager({ rows: DATE_ROWS });
    const thCount = headers().length;
    expect(thCount).toBe(MANAGER_HEADERS.length);
    for (const name of [NAME_NEW, NAME_MID, NAME_OLD]) {
      expect(colSpanTotal(dataRow(name))).toBe(thCount);
    }
  });

  it("the empty-state row spans both new columns", () => {
    renderManager({ rows: [], managerRows: {} });
    const empty = screen.getByText("No strategies match your filters.").closest("tr");
    expect(colSpanTotal(empty as HTMLElement)).toBe(headers().length);
  });

  it("a placeholder row mirrors the Created cell as an honest em dash", () => {
    renderManager({
      extra: {
        placeholderKeys: [{ id: "pk-2", exchangeLabel: "Binance", keyLabel: "Main" }],
        onFinishSetup: () => {},
      },
    });
    const placeholder = screen.getByText("Finish setup \u2192").closest("tr") as HTMLElement;
    expect(colSpanTotal(placeholder)).toBe(headers().length);
    expect(cells(placeholder)[3].textContent?.trim()).toBe("\u2014");
  });
});

// --- Plan 03 / D-09: initialSort ------------------------------------------
//
// The manager page opens newest first. The prop is only worth anything if it
// SURVIVES MOUNT: a userId-less table hydrates its prefs immediately, and the
// prefs-mirror effect then writes the DEFAULTS (Sharpe descending) into the
// table sort one render after the seed. So the contract is asserted after
// effects flush, never on the first render alone.

describe("StrategyTable initialSort (D-09)", () => {
  it("opens with the newest strategy first and keeps it after mount effects flush", async () => {
    await act(async () => {
      renderManager({
        rows: DATE_ROWS,
        extra: { initialSort: { key: "created_at", dir: "desc" } },
      });
    });
    expect(visibleNames()).toEqual([NAME_NEW, NAME_MID, NAME_OLD]);
    expect(
      screen.getByRole("columnheader", { name: "Created" }).getAttribute("aria-sort"),
    ).toBe("descending");
    expect(
      screen.getByRole("columnheader", { name: "Sharpe" }).getAttribute("aria-sort"),
    ).toBe("none");
  });

  it("does not fight the user: a header click after mount sticks through a re-render", async () => {
    const props = {
      strategies: DATE_ROWS,
      categorySlug: "mgr-spec",
      visibility: "owner-all-statuses" as const,
      managerRows: managerRowsFor(DATE_ROWS),
      initialSort: { key: "created_at" as const, dir: "desc" as const },
    };
    let view!: ReturnType<typeof render>;
    await act(async () => {
      view = render(<StrategyTable {...props} />);
    });
    fireEvent.click(screen.getByRole("button", { name: /Sharpe/ }));
    expect(visibleNames()).toEqual([NAME_MID, NAME_OLD, NAME_NEW]);
    await act(async () => {
      view.rerender(<StrategyTable {...props} />);
    });
    expect(visibleNames()).toEqual([NAME_MID, NAME_OLD, NAME_NEW]);
  });

  // WR-02: the filter bar's Sort selects can only name a SortKey (no Created),
  // so on a seeded-sort mount they must not render. They would show "Sharpe"
  // over a Created-sorted table, picking Sharpe would fire no change event, and
  // the direction select would flip the Created sort under a Sharpe label.
  it("shows no filter-bar Sort selects that could disagree with the seeded Created sort", async () => {
    await act(async () => {
      renderManager({
        rows: DATE_ROWS,
        extra: { initialSort: { key: "created_at", dir: "desc" } },
      });
    });
    expect(
      screen.getByRole("columnheader", { name: "Created" }).getAttribute("aria-sort"),
    ).toBe("descending");
    expect(screen.queryByRole("combobox", { name: "Sort by" })).toBeNull();
    expect(screen.queryByRole("combobox", { name: "Sort direction" })).toBeNull();
  });

  it("without initialSort the Sort-by select is present and shows the key the table is sorted by", async () => {
    await act(async () => {
      renderManager({ rows: DATE_ROWS });
    });
    const sortBy = screen.getByRole("combobox", { name: "Sort by" }) as HTMLSelectElement;
    expect(sortBy.value).toBe("sharpe");
    expect(
      screen.getByRole("columnheader", { name: "Sharpe" }).getAttribute("aria-sort"),
    ).toBe("descending");
  });

  it("with initialSort absent the first row is the highest Sharpe, as on Discovery", async () => {
    await act(async () => {
      renderManager({ rows: DATE_ROWS });
    });
    expect(visibleNames()).toEqual([NAME_MID, NAME_OLD, NAME_NEW]);
    expect(
      screen.getByRole("columnheader", { name: "Sharpe" }).getAttribute("aria-sort"),
    ).toBe("descending");
  });
});
