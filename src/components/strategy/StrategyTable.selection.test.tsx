/**
 * Phase 197 / ROUTE-05 (D-04) - an allocator ticks 2 to 4 discovery rows and opens Compare with them.
 *
 * THE DEFECT. Today the only way into /compare is the factsheet's own button, so an allocator who
 * has shortlisted three strategies on a discovery category has to open each factsheet in turn and
 * cannot start a comparison from the list they are looking at.
 *
 * WHAT THIS FILE PINS. With the opt-in `selectable` prop (passed only by /discovery/[slug]) every
 * strategy row carries a checkbox named "Select {name} to compare"; from two ticks a sticky bar shows
 * the count and a "Compare (n)" link to `/compare?ids=` in TICK order; the cap is four and a fifth
 * box is disabled and says why, never silently ignored; the selection lives in table state, so it
 * survives paging, sorting, searching, the watchlist scope and the grid view; and without the prop
 * the table renders no checkbox, no bar and no status region at all (the anonymous /browse mount and
 * the owner mounts must never offer selection, T-197-14).
 *
 * ANTI-VACUITY. The ticks are made in a different order from the table's row order, so an href built
 * from table order would be RED; every behaviour has its opposite asserted beside it (one selected
 * and no bar, no `selectable` and no checkbox), so no assertion can pass by rendering nothing. The
 * clock is frozen and every fixture has a current `series_end` so plan 03's stale partition does not
 * reorder the rows.
 *
 * RED EVIDENCE. This file was written and run against the pre-change source first; the failing
 * assertions are quoted in 197-05-SUMMARY.md.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrategyTable } from "./StrategyTable";
import { compareHref } from "@/lib/compare-href";
import type { Strategy, StrategyAnalytics } from "@/lib/types";
import { installFetchMock, restoreFetchMock } from "@/test/helpers/fetch";

type StrategyWithAnalytics = Strategy & { analytics: StrategyAnalytics };

vi.mock("@/components/discovery/SimulateImpactButton", () => ({
  SimulateImpactButton: () => null,
}));

// --- Frozen clock --------------------------------------------------------

const NOW_ISO = "2026-11-08T12:00:00.000Z";
const DAY_MS = 24 * 60 * 60 * 1000;

function daysAgo(n: number): string {
  return new Date(Date.parse(NOW_ISO) - n * DAY_MS).toISOString().slice(0, 10);
}

beforeEach(() => {
  installFetchMock();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(NOW_ISO));
  try {
    window.localStorage.clear();
  } catch {
    // jsdom without storage
  }
});

afterEach(() => {
  vi.useRealTimers();
  restoreFetchMock();
});

// --- Fixtures ------------------------------------------------------------

/** Table order is Sharpe descending: Meridian, Bastion, Cobalt, Delta, Ember. */
const ROWS = [
  { id: "57e10001-0000-4000-8000-000000000001", name: "Meridian Core", sharpe: 2.5 },
  { id: "57e10001-0000-4000-8000-000000000002", name: "Bastion Carry", sharpe: 2.0 },
  { id: "57e10001-0000-4000-8000-000000000003", name: "Cobalt Basis", sharpe: 1.5 },
  { id: "57e10001-0000-4000-8000-000000000004", name: "Delta Trend", sharpe: 1.0 },
  { id: "57e10001-0000-4000-8000-000000000005", name: "Ember Spread", sharpe: 0.5 },
] as const;

const [MERIDIAN, BASTION, COBALT, DELTA, EMBER] = ROWS;

function analyticsFor(strategyId: string, over: Partial<StrategyAnalytics>): StrategyAnalytics {
  return {
    id: `an-${strategyId}`,
    strategy_id: strategyId,
    computed_at: NOW_ISO,
    computing_started_at: null,
    computation_status: "complete",
    computation_error: null,
    benchmark: null,
    cumulative_return: 0.2,
    cagr: 0.1,
    volatility: 0.2,
    sharpe: 0.8,
    sortino: 1.1,
    calmar: 0.9,
    max_drawdown: -0.1,
    max_drawdown_duration_days: 20,
    six_month_return: 0.05,
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
    trades_fetched_at: NOW_ISO,
    series_start: "2024-06-01",
    series_end: daysAgo(1),
    ...over,
  };
}

function makeRow(id: string, name: string, sharpe: number): StrategyWithAnalytics {
  return {
    id,
    name,
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
    asset_class: "crypto",
    analytics: analyticsFor(id, { sharpe }),
  };
}

function fixtures(): StrategyWithAnalytics[] {
  return ROWS.map((r) => makeRow(r.id, r.name, r.sharpe));
}

// --- Helpers -------------------------------------------------------------

function mount(props: Record<string, unknown> = {}, strategies = fixtures()) {
  return render(
    <StrategyTable
      key="selection"
      strategies={strategies}
      categorySlug="crypto-sma"
      userId="user-1"
      {...props}
    />,
  );
}

const box = (name: string) =>
  screen.getByRole("checkbox", { name: `Select ${name} to compare` }) as HTMLInputElement;
const bar = () => screen.queryByTestId("compare-bar");
const status = () => screen.getByTestId("selection-status");

describe("ROUTE-05 selection: a checkbox per discovery row (D-04)", () => {
  it("renders a checkbox named 'Select {name} to compare' on every row when selectable", () => {
    mount({ selectable: true });
    for (const r of ROWS) expect(box(r.name).checked).toBe(false);
    expect(screen.getAllByRole("checkbox", { name: /^Select .* to compare$/ })).toHaveLength(ROWS.length);
  });

  it("renders no checkbox, no status region and no bar without selectable", () => {
    mount();
    expect(screen.queryAllByRole("checkbox", { name: /to compare$/ })).toHaveLength(0);
    expect(screen.queryByTestId("selection-status")).toBeNull();
    expect(bar()).toBeNull();
  });
});

describe("ROUTE-05 selection: the sticky bar from two ticks (D-04)", () => {
  it("shows no bar at 0 or 1 selected, and the status region reads '' then the next step", async () => {
    const user = userEvent.setup();
    mount({ selectable: true });
    expect(bar()).toBeNull();
    expect(status().textContent).toBe("");
    await user.click(box(MERIDIAN.name));
    expect(bar()).toBeNull();
    expect(status().textContent).toBe("1 selected. Select one more to compare.");
  });

  it("shows the bar at two ticks with '2 selected' and a link to /compare in TICK order", async () => {
    const user = userEvent.setup();
    mount({ selectable: true });
    // Ticked second-ranked first: the href must follow the ticks, not the table order.
    await user.click(box(BASTION.name));
    await user.click(box(MERIDIAN.name));
    const theBar = bar();
    expect(theBar).not.toBeNull();
    expect(within(theBar!).getByText("2 selected")).toBeTruthy();
    const link = within(theBar!).getByRole("link", { name: "Compare 2 strategies" });
    expect(link.getAttribute("href")).toBe(`/compare?ids=${BASTION.id},${MERIDIAN.id}`);
    expect(link.getAttribute("href")).toBe(compareHref([BASTION.id, MERIDIAN.id]));
    expect(link.textContent).toBe("Compare (2)");
  });

  it("removes the bar when a tick is undone back to one", async () => {
    const user = userEvent.setup();
    mount({ selectable: true });
    await user.click(box(MERIDIAN.name));
    await user.click(box(BASTION.name));
    expect(bar()).not.toBeNull();
    await user.click(box(BASTION.name));
    expect(bar()).toBeNull();
    expect(box(MERIDIAN.name).checked).toBe(true);
    expect(box(BASTION.name).checked).toBe(false);
  });
});

// --- Task 2: cap, chips, Clear, focus, persistence, grid, pinned stack ---------

const CAP_TITLE = "Up to 4 strategies can be compared. Remove one to add another.";
const tick = async (user: ReturnType<typeof userEvent.setup>, ...rows: { name: string }[]) => {
  for (const r of rows) await user.click(box(r.name));
};
const chipRemove = (name: string) =>
  screen.getByRole("button", { name: `Remove ${name} from the selection` });

describe("ROUTE-05 selection: the cap of four (D-04, U-14)", () => {
  it("disables every other box at four, says why, and the link carries exactly four ids", async () => {
    const user = userEvent.setup();
    mount({ selectable: true });
    await tick(user, MERIDIAN, BASTION, COBALT, DELTA);
    const fifth = box(EMBER.name);
    expect(fifth.disabled).toBe(true);
    expect(fifth.closest("label")!.getAttribute("title")).toBe(CAP_TITLE);
    // The checked boxes stay operable and carry no cap title.
    expect(box(MERIDIAN.name).disabled).toBe(false);
    expect(box(MERIDIAN.name).closest("label")!.getAttribute("title")).toBeNull();
    // Ticking the disabled box changes nothing.
    await user.click(fifth);
    expect(fifth.checked).toBe(false);
    const link = within(bar()!).getByRole("link", { name: "Compare 4 strategies" });
    const ids = new URL(link.getAttribute("href")!, "http://x").searchParams.get("ids")!.split(",");
    expect(ids).toEqual([MERIDIAN.id, BASTION.id, COBALT.id, DELTA.id]);
    expect(within(bar()!).getByText("Up to 4. Remove one to add another.")).toBeTruthy();
    expect(status().textContent).toBe("4 selected, the maximum.");
  });

  it("re-enables the boxes and drops the cap line once one is unticked", async () => {
    const user = userEvent.setup();
    mount({ selectable: true });
    await tick(user, MERIDIAN, BASTION, COBALT, DELTA);
    await user.click(box(DELTA.name));
    expect(box(EMBER.name).disabled).toBe(false);
    expect(within(bar()!).queryByText("Up to 4. Remove one to add another.")).toBeNull();
    expect(status().textContent).toBe("3 selected for comparison.");
  });
});

describe("ROUTE-05 selection: chips, Clear and focus (D-04)", () => {
  it("renders one chip per selected strategy in tick order and removing one updates the href", async () => {
    const user = userEvent.setup();
    mount({ selectable: true });
    await tick(user, COBALT, MERIDIAN, BASTION);
    const chips = within(bar()!).getAllByRole("listitem").map((li) => li.textContent);
    expect(chips).toEqual([
      `${COBALT.name}×`,
      `${MERIDIAN.name}×`,
      `${BASTION.name}×`,
    ]);
    await user.click(chipRemove(MERIDIAN.name));
    expect(
      within(bar()!).getByRole("link", { name: "Compare 2 strategies" }).getAttribute("href"),
    ).toBe(compareHref([COBALT.id, BASTION.id]));
  });

  it("a chip x moves focus to the next chip's x, else the previous one", async () => {
    const user = userEvent.setup();
    mount({ selectable: true });
    await tick(user, MERIDIAN, BASTION, COBALT);
    await user.click(chipRemove(MERIDIAN.name));
    expect(document.activeElement).toBe(chipRemove(BASTION.name));
    await user.click(box(MERIDIAN.name));
    // Now Bastion, Cobalt, Meridian: removing the LAST chip falls back to the previous one.
    await user.click(chipRemove(MERIDIAN.name));
    expect(document.activeElement).toBe(chipRemove(COBALT.name));
  });

  it("Clear empties the selection, unmounts the bar and focuses the first visible checkbox", async () => {
    const user = userEvent.setup();
    mount({ selectable: true });
    await tick(user, COBALT, DELTA);
    await user.click(within(bar()!).getByRole("button", { name: "Clear the selection" }));
    expect(bar()).toBeNull();
    for (const r of ROWS) expect(box(r.name).checked).toBe(false);
    expect(document.activeElement).toBe(box(MERIDIAN.name));
    expect(status().textContent).toBe("");
  });

  it("removing a chip down to one unmounts the bar and focuses that strategy's checkbox", async () => {
    const user = userEvent.setup();
    mount({ selectable: true });
    await tick(user, COBALT, DELTA);
    await user.click(chipRemove(DELTA.name));
    expect(bar()).toBeNull();
    expect(document.activeElement).toBe(box(DELTA.name));
    expect(box(COBALT.name).checked).toBe(true);
  });

  it("falls back to the first visible checkbox when that strategy's row is hidden", async () => {
    const user = userEvent.setup();
    mount({ selectable: true });
    await tick(user, COBALT, DELTA);
    // Hide Delta's row with the search, then remove its chip: its checkbox is not in the DOM.
    await user.type(screen.getByPlaceholderText("Search strategies..."), "Meridian");
    await user.click(chipRemove(DELTA.name));
    expect(bar()).toBeNull();
    expect(document.activeElement).toBe(box(MERIDIAN.name));
  });
});

describe("ROUTE-05 selection: the selection survives the list changing (U-13)", () => {
  function many(n: number): StrategyWithAnalytics[] {
    return Array.from({ length: n }, (_, i) =>
      makeRow(
        `57e20001-0000-4000-8000-${String(i + 1).padStart(12, "0")}`,
        `Row ${String(i + 1).padStart(2, "0")} Fund`,
        5 - i * 0.1,
      ),
    );
  }

  it("keeps a page-1 selection across paging, a sort, and a search that hides the rows", async () => {
    const user = userEvent.setup();
    mount({ selectable: true }, many(25));
    await tick(user, { name: "Row 01 Fund" }, { name: "Row 02 Fund" });
    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.queryByRole("checkbox", { name: "Select Row 01 Fund to compare" })).toBeNull();
    expect(within(bar()!).getByText("2 selected")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Previous" }));
    expect(box("Row 01 Fund").checked).toBe(true);
    // Name sort descending moves Row 01 and Row 02 off page 1: they are no longer on screen, still
    // selected, and still in the bar.
    await user.click(screen.getByRole("button", { name: "Strategy" }));
    expect(screen.queryByRole("checkbox", { name: "Select Row 02 Fund to compare" })).toBeNull();
    expect(within(bar()!).getByText("2 selected")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(box("Row 02 Fund").checked).toBe(true);
    expect(box("Row 01 Fund").checked).toBe(true);
    await user.type(screen.getByPlaceholderText("Search strategies..."), "Row 25");
    expect(screen.queryByRole("checkbox", { name: "Select Row 01 Fund to compare" })).toBeNull();
    expect(within(bar()!).getByText("2 selected")).toBeTruthy();
    // The hidden strategy still has its chip.
    expect(chipRemove("Row 01 Fund")).toBeTruthy();
  });

  it("keeps the selection through the watchlist scope switch and the grid view", async () => {
    const user = userEvent.setup();
    mount({ selectable: true });
    await tick(user, MERIDIAN, BASTION);
    await user.click(screen.getByRole("tab", { name: /My Watchlist/ }));
    expect(within(bar()!).getByText("2 selected")).toBeTruthy();
    await user.click(screen.getByRole("tab", { name: /All/ }));
    await user.click(screen.getByRole("button", { name: "Grid view" }));
    expect(box(MERIDIAN.name).checked).toBe(true);
    expect(box(BASTION.name).checked).toBe(true);
    expect(box(COBALT.name).checked).toBe(false);
    expect(within(bar()!).getByText("2 selected")).toBeTruthy();
  });
});

describe("ROUTE-05 selection: the grid checkbox and the pinned stack (D-04)", () => {
  it("renders the grid checkbox as an overlay sibling of the card link, never inside it", async () => {
    const user = userEvent.setup();
    mount({ selectable: true });
    await user.click(screen.getByRole("button", { name: "Grid view" }));
    for (const r of ROWS) {
      const input = box(r.name);
      expect(input.closest("a")).toBeNull();
      const card = input.closest("label")!.parentElement!.parentElement!;
      expect(card.querySelector("a")).not.toBeNull();
    }
    // Ticking in the grid drives the same selection and the same bar.
    await user.click(box(COBALT.name));
    await user.click(box(MERIDIAN.name));
    expect(
      within(bar()!).getByRole("link", { name: "Compare 2 strategies" }).getAttribute("href"),
    ).toBe(compareHref([COBALT.id, MERIDIAN.id]));
  });

  it("pins select at 0 and shifts rank onto --pin-rank-left when selectable", () => {
    const { container } = mount({ selectable: true });
    const heads = Array.from(container.querySelectorAll("thead th")).slice(0, 3);
    expect(heads[0].className).toContain("@3xl:left-0");
    expect(heads[0].className).toContain("w-11");
    expect(heads[1].className).toContain("@3xl:left-(--pin-rank-left)");
    expect(heads[2].className).toContain("@3xl:left-(--pin-star-left)");
    const frame = container.querySelector("[data-strategy-table]") as HTMLElement;
    expect(frame.style.getPropertyValue("--pin-rank-left")).toBe("2.75rem");
    // No measured px literal: before a measure the offsets are rem calcs, never a px figure.
    expect(frame.style.getPropertyValue("--pin-star-left")).not.toMatch(/px/);
  });

  it("without selectable the rank header keeps @3xl:left-0 and the frame has no select offset", () => {
    const { container } = mount();
    const heads = Array.from(container.querySelectorAll("thead th"));
    expect(heads[0].className).toContain("@3xl:left-0");
    expect(heads[0].className).not.toContain("--pin-rank-left");
    expect(heads.some((h) => h.textContent === "Select to compare")).toBe(false);
    const frame = container.querySelector("[data-strategy-table]") as HTMLElement;
    expect(frame.style.getPropertyValue("--pin-rank-left")).toBe("");
  });

  it("counts the select column in the empty-row colspan", async () => {
    const user = userEvent.setup();
    const { container } = mount({ selectable: true });
    await user.type(screen.getByPlaceholderText("Search strategies..."), "zzz-no-match");
    const empty = container.querySelector("tbody td[colspan]") as HTMLElement;
    const plain = render(
      <StrategyTable key="plain" strategies={[]} categorySlug="x" userId="user-1" />,
    ).container.querySelector("tbody td[colspan]") as HTMLElement;
    expect(Number(empty.getAttribute("colspan"))).toBe(Number(plain.getAttribute("colspan")) + 1);
  });
});
