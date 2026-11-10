/**
 * Phase 199 / Plan 07 / D-02 — the shared table's owner-list mode carries manager furniture,
 * allocator furniture or both on the SAME row.
 *
 * WHY. The merged owner list (199-09, 199-10) mounts ONE table for every role. Before this plan
 * the mere presence of `managerRows` switched six behaviours at once (status column, created
 * column, in-name badge, ownership tag, Simulate Impact, the either-or Actions cell), so a user
 * who is both a manager and an allocator could not have both sets of controls on a row.
 *
 * WHAT IS PINNED, in the order a reader would be hurt by its loss:
 *   1. THE UNION, IN ORDER, IN ONE CELL. For role both, the Actions cell holds on one line
 *      (flex-nowrap): Edit, the server-built actions slot, Mark ownership / Change mark, Rename
 *      (a private or draft row only: the D-17 server gate), then Simulate Impact (published only).
 *   2. NO FOREIGN FURNITURE (T-199-11). A manager-only mount (no allocatorFurniture) renders no
 *      OwnershipTag, no Simulate Impact, no Mark or Rename even when the callbacks are passed; an
 *      allocator-only mount (an entry with a note only) renders no Edit link and no actions slot.
 *   3. OWNER-LIST COLUMNS ARE NOT FURNITURE. Status and Created always show and the in-name status
 *      badge never does, whichever furniture is on (UI-SPEC note 3).
 *
 * The three whole-markup owner-list goldens live in `StrategyTable.default-mounts.test.tsx` beside
 * the three public pins.
 *
 * `categorySlug="owner-list-spec"` is distinct on purpose: the discovery prefs key is read from the
 * shared jsdom localStorage.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ReactNode } from "react";
import { render, screen, within } from "@testing-library/react";
import { StrategyTable } from "./StrategyTable";
import type { Strategy, StrategyAnalytics } from "@/lib/types";
import { installFetchMock, restoreFetchMock } from "@/test/helpers/fetch";

type Row = Strategy & { analytics: StrategyAnalytics };
type ManagerRows = Record<
  string,
  { editHref?: string; actions?: ReactNode; note?: ReactNode }
>;

const ID_PUBLISHED = "77777777-0000-4000-8000-000000000001";
const ID_DRAFT = "77777777-0000-4000-8000-000000000002";
const NAME_PUBLISHED = "List Published";
const NAME_DRAFT = "List Sandbox";

vi.mock("@/components/discovery/SimulateImpactButton", () => ({
  SimulateImpactButton: () => <span data-testid="simulate-probe">Simulate Impact</span>,
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
    capital_ownership: "own_capital",
  }),
  makeStrategy({ id: ID_DRAFT, name: NAME_DRAFT, status: "draft" }),
];

const slotTestId = (id: string) => `slot-${id}`;

/** Manager furniture on every row: Edit target, the actions slot, and a note on the published row. */
const MANAGER_ENTRIES: ManagerRows = Object.fromEntries(
  ROWS.map((r) => [
    r.id,
    {
      editHref: `/strategies/${r.id}/edit`,
      actions: <span data-testid={slotTestId(r.id)}>slot {r.name}</span>,
    },
  ]),
);

/** Allocator-only: the entry carries a note and nothing else. */
const NOTE_ONLY_ENTRIES: ManagerRows = Object.fromEntries(
  ROWS.map((r) => [r.id, { note: <span>note {r.name}</span> }]),
);

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

function renderList(props: {
  managerRows: ManagerRows;
  allocatorFurniture?: boolean;
  callbacks?: boolean;
}) {
  return render(
    <StrategyTable
      strategies={ROWS}
      categorySlug="owner-list-spec"
      visibility="owner-all-statuses"
      managerRows={props.managerRows}
      allocatorFurniture={props.allocatorFurniture}
      onMarkOwnership={props.callbacks ? () => {} : undefined}
      onRename={props.callbacks ? () => {} : undefined}
    />,
  );
}

function dataRow(name: string): HTMLElement {
  const link = screen.getByRole("link", { name });
  const row = link.closest("tr");
  if (!row) throw new Error(`no row for "${name}"`);
  return row;
}

function actionsCell(row: HTMLElement): HTMLElement {
  const tds = row.querySelectorAll<HTMLElement>(":scope > td");
  return tds[tds.length - 1];
}

/** The labels of the Actions cell's controls, in DOM order. */
function controlsInOrder(cell: HTMLElement): string[] {
  const out: string[] = [];
  for (const el of Array.from(cell.querySelectorAll<HTMLElement>("a, button, [data-testid]"))) {
    const testId = el.getAttribute("data-testid") ?? "";
    if (testId.startsWith("slot-")) out.push("actions");
    else if (testId === "simulate-probe") out.push("simulate");
    else if (el.tagName === "A") out.push("edit");
    else out.push((el.textContent ?? "").trim());
  }
  return out;
}

describe("owner-list mode, role both: the whole union on one row (D-02)", () => {
  it("a published row's Actions cell reads Edit, actions, Mark ownership, Simulate Impact, in one flex-nowrap container", () => {
    renderList({ managerRows: MANAGER_ENTRIES, allocatorFurniture: true, callbacks: true });
    const cell = actionsCell(dataRow(NAME_PUBLISHED));
    // The row carries a mark, so the control names the act of changing it.
    expect(controlsInOrder(cell)).toEqual(["edit", "actions", "Change mark…", "simulate"]);
    // ONE line: every control shares a single flex-nowrap container, so a wrapped cell never
    // doubles the row height and breaks the --row-h rhythm.
    const container = cell.querySelector<HTMLElement>(".flex-nowrap");
    expect(container).not.toBeNull();
    for (const el of Array.from(cell.querySelectorAll("a, button, [data-testid]"))) {
      expect(container!.contains(el)).toBe(true);
    }
    expect(container!.className).toContain("whitespace-nowrap");
  });

  it("a draft row reads Edit, actions, Mark ownership, Rename and no Simulate Impact (the D-17 and published-only gates)", () => {
    renderList({ managerRows: MANAGER_ENTRIES, allocatorFurniture: true, callbacks: true });
    expect(controlsInOrder(actionsCell(dataRow(NAME_DRAFT)))).toEqual([
      "edit",
      "actions",
      "Mark ownership…",
      "Rename…",
    ]);
  });

  it("the OwnershipTag renders after the name, and Status and Created show while the in-name status badge does not", () => {
    renderList({ managerRows: MANAGER_ENTRIES, allocatorFurniture: true, callbacks: true });
    const row = dataRow(NAME_PUBLISHED);
    expect(within(row).getByText("Own capital")).toBeTruthy();
    const link = within(row).getByRole("link", { name: NAME_PUBLISHED });
    const tag = within(row).getByText("Own capital");
    // The tag follows the name link in document order.
    expect(link.compareDocumentPosition(tag) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // Status and Created are real columns.
    expect(screen.getByRole("columnheader", { name: "Status" })).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "Created" })).toBeTruthy();
    // The draft row's status prints once, in the Status column, never beside its name.
    const draft = dataRow(NAME_DRAFT);
    const strategyCell = within(draft).getByRole("link", { name: NAME_DRAFT }).closest("td")!;
    expect(within(strategyCell).queryByText(/^draft$/i)).toBeNull();
    expect(within(draft).getAllByText(/^draft$/i)).toHaveLength(1);
  });
});

describe("owner-list mode, manager only: no allocator furniture (T-199-11)", () => {
  it("renders Edit and the actions slot and nothing else, even with the callbacks passed", () => {
    renderList({ managerRows: MANAGER_ENTRIES, callbacks: true });
    for (const name of [NAME_PUBLISHED, NAME_DRAFT]) {
      const row = dataRow(name);
      const id = name === NAME_PUBLISHED ? ID_PUBLISHED : ID_DRAFT;
      expect(controlsInOrder(actionsCell(row))).toEqual(["edit", "actions"]);
      expect(within(row).getByTestId(slotTestId(id))).toBeTruthy();
      expect(within(row).queryByText("Own capital")).toBeNull();
      expect(within(row).queryByTestId("simulate-probe")).toBeNull();
      expect(within(row).queryByRole("button", { name: /mark ownership|change mark|rename/i })).toBeNull();
    }
  });
});

describe("owner-list mode, allocator only: no manager furniture (T-199-11)", () => {
  it("an entry with a note only renders the tag, Mark, Rename and Simulate Impact and no Edit link or actions slot", () => {
    renderList({ managerRows: NOTE_ONLY_ENTRIES, allocatorFurniture: true, callbacks: true });
    const published = dataRow(NAME_PUBLISHED);
    expect(controlsInOrder(actionsCell(published))).toEqual(["Change mark…", "simulate"]);
    expect(within(published).getByText("Own capital")).toBeTruthy();
    expect(within(published).queryByRole("link", { name: `Edit ${NAME_PUBLISHED}` })).toBeNull();
    expect(within(published).queryByTestId(slotTestId(ID_PUBLISHED))).toBeNull();
    const draft = dataRow(NAME_DRAFT);
    expect(controlsInOrder(actionsCell(draft))).toEqual(["Mark ownership…", "Rename…"]);
    // The note rows still render: the note is the allocator list's own furniture channel.
    expect(screen.getAllByTestId("strategy-row-note")).toHaveLength(2);
  });

  it("a row with no entry at all shows an empty-of-manager cell, never another row's slot", () => {
    renderList({
      managerRows: { [ID_PUBLISHED]: MANAGER_ENTRIES[ID_PUBLISHED] },
      allocatorFurniture: true,
      callbacks: true,
    });
    const draft = dataRow(NAME_DRAFT);
    expect(within(draft).queryByRole("link", { name: `Edit ${NAME_DRAFT}` })).toBeNull();
    expect(within(draft).queryByTestId(slotTestId(ID_PUBLISHED))).toBeNull();
  });
});
