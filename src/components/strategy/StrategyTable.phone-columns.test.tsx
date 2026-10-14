/**
 * Phase 170.6.1 DISCOVERYPHONE, plan 02 (SC-1; D-01, D-02).
 *
 * The vitest structural pin beside the SC6-DISCOVERY Playwright checks. On a
 * phone the Discovery ranking table must show EVERY column by horizontal scroll
 * (no priority collapse, no per-row "More" disclosure), and the right-edge fade
 * plus its "Scroll for more columns" hint must show only while there is more to
 * scroll, so Simulate Impact is never left under them at the scroll end.
 *
 * jsdom has no layout, so (3) defines scrollWidth / clientWidth / scrollLeft on
 * the real scroll region and dispatches the events the component listens to. The
 * fade is located by its hint text, exactly as the e2e does, so a markup rename
 * cannot make this pin vacuous.
 */

import { describe, it, expect, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { StrategyTable } from "./StrategyTable";
import type { Strategy, StrategyAnalytics } from "@/lib/types";

vi.mock("@/components/discovery/SimulateImpactButton", () => ({
  SimulateImpactButton: () => null,
}));

type StrategyWithAnalytics = Strategy & { analytics: StrategyAnalytics };

function makeStrategy(id: string, name: string): StrategyWithAnalytics {
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
    id,
    name,
    analytics: {
      id: "an-1",
      strategy_id: id,
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
    },
  };
}

const STRATEGIES = [
  makeStrategy("11111111-0000-4000-8000-000000000001", "Alpha Stellar"),
  makeStrategy("11111111-0000-4000-8000-000000000002", "Beta Voyager"),
];

const HINT = /Scroll for more columns/;

function renderTable() {
  return render(<StrategyTable strategies={STRATEGIES} categorySlug="crypto-sma" />);
}

describe("StrategyTable — every column on a phone (170.6.1 SC-1)", () => {
  it("(1) no header or data cell carries a collapse class, and the table has no <details>", () => {
    renderTable();
    const cells = Array.from(
      document.querySelectorAll<HTMLElement>("table th, table td"),
    );
    expect(cells.length).toBeGreaterThan(0);
    for (const c of cells) {
      expect(c.className, "collapse class on a cell").not.toContain("@max-3xl:hidden");
      expect(c.className, "collapse class on a cell").not.toContain("@3xl:hidden");
    }
    expect(document.querySelector("table details")).toBeNull();
    expect(screen.queryByText("More")).toBeNull();
  });

  it("(2) the priority-collapse columns sit before Actions and every body row has as many cells as the header row", () => {
    renderTable();
    const labels = Array.from(document.querySelectorAll("thead tr th")).map((th) =>
      (th.textContent ?? "").trim(),
    );
    let from = -1;
    for (const l of ["Volatility", "6 Month", "AUM", "Return", "Underwater", "Actions"]) {
      const i = labels.indexOf(l);
      expect(i, `${l} header present`).toBeGreaterThan(from);
      from = i;
    }
    const rows = Array.from(document.querySelectorAll("tbody tr"));
    expect(rows).toHaveLength(STRATEGIES.length);
    for (const r of rows) {
      expect(r.querySelectorAll(":scope > td")).toHaveLength(labels.length);
    }
  });

  it("(3) the fade and hint show only while there is more to scroll, re-evaluated on resize and on scroll (D-02)", () => {
    // The shared test setup stubs ResizeObserver as a no-op, so a "resize" here
    // is the callback the component registered, invoked by hand.
    const resizeCallbacks: Array<() => void> = [];
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(cb: () => void) {
          resizeCallbacks.push(cb);
        }
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    const resize = () => {
      act(() => {
        for (const cb of resizeCallbacks) cb();
      });
    };
    try {
      assertCueTracksScroll(resize);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  function assertCueTracksScroll(resize: () => void) {
    renderTable();
    const region = screen.getByRole("region", { name: /^Strategies:/ });
    // jsdom has no layout: give the scroll region a real overflow.
    let scrollLeft = 0;
    Object.defineProperty(region, "scrollWidth", { configurable: true, value: 900 });
    Object.defineProperty(region, "clientWidth", { configurable: true, value: 360 });
    Object.defineProperty(region, "scrollLeft", {
      configurable: true,
      get: () => scrollLeft,
      set: (v: number) => {
        scrollLeft = v;
      },
    });

    // The overflow only exists after the definitions above: a resize re-measures.
    resize();
    expect(screen.queryByText(HINT), "hint at scroll start").not.toBeNull();
    expect(screen.queryByTestId("strategy-table-scroll-cue")).not.toBeNull();

    // Mid-scroll: still more to the right.
    act(() => {
      scrollLeft = 200;
      region.dispatchEvent(new Event("scroll"));
    });
    expect(screen.queryByText(HINT), "hint mid-scroll").not.toBeNull();

    // Inside the 2 px slack of the end: treated as the end (fractional scrollLeft).
    act(() => {
      scrollLeft = 900 - 360 - 1;
      region.dispatchEvent(new Event("scroll"));
    });
    expect(screen.queryByText(HINT), "hint within the epsilon of the end").toBeNull();

    // Scroll end: the fade and hint are gone.
    act(() => {
      scrollLeft = 900 - 360;
      region.dispatchEvent(new Event("scroll"));
    });
    expect(screen.queryByText(HINT), "hint at the scroll end").toBeNull();
    expect(screen.queryByTestId("strategy-table-scroll-cue")).toBeNull();

    // Scrolling back brings it back.
    act(() => {
      scrollLeft = 0;
      region.dispatchEvent(new Event("scroll"));
    });
    expect(screen.queryByText(HINT), "hint after scrolling back").not.toBeNull();

    // Resize re-evaluates too: a wider region that no longer overflows hides it.
    Object.defineProperty(region, "clientWidth", { configurable: true, value: 900 });
    resize();
    expect(screen.queryByText(HINT), "hint once nothing overflows").toBeNull();
  }

  it("(5) the cue re-measures when only the <table>'s own width changes, not just the scroll box (review WR-01 / SFH-01)", () => {
    // A re-sort, a search or a font swap widens the table while the scroll
    // container's box stays the same, so an observer on the container alone
    // never fires. Record every observed element per observer.
    const observers: Array<{ cb: () => void; targets: Element[] }> = [];
    vi.stubGlobal(
      "ResizeObserver",
      class {
        private rec: { cb: () => void; targets: Element[] };
        constructor(cb: () => void) {
          this.rec = { cb, targets: [] };
          observers.push(this.rec);
        }
        observe(target: Element) {
          this.rec.targets.push(target);
        }
        unobserve() {}
        disconnect() {}
      },
    );
    try {
      renderTable();
      const region = screen.getByRole("region", { name: /^Strategies:/ });
      let scrollLeft = 0;
      let scrollWidth = 900;
      Object.defineProperty(region, "clientWidth", { configurable: true, value: 360 });
      Object.defineProperty(region, "scrollWidth", {
        configurable: true,
        get: () => scrollWidth,
      });
      Object.defineProperty(region, "scrollLeft", {
        configurable: true,
        get: () => scrollLeft,
        set: (v: number) => {
          scrollLeft = v;
        },
      });
      // The user is at the scroll end: the cue is off.
      act(() => {
        scrollLeft = 900 - 360;
        region.dispatchEvent(new Event("scroll"));
      });
      expect(screen.queryByText(HINT), "hint at the scroll end").toBeNull();

      // The table widens (sort / search / font swap): only the table's own box
      // changed, so only an observer attached to the <table> reports it.
      const tableObservers = observers.filter((o) =>
        o.targets.some((t) => t.tagName === "TABLE"),
      );
      expect(
        tableObservers.length,
        "a ResizeObserver must observe the <table> itself",
      ).toBeGreaterThan(0);
      scrollWidth = 1100;
      act(() => {
        for (const o of tableObservers) o.cb();
      });
      expect(
        screen.queryByText(HINT),
        "hint returns once the table is wider than the region again",
      ).not.toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("(6) the cue re-measures once document.fonts is ready (a late font swap widens the table)", async () => {
    let resolveFonts: () => void = () => {};
    const ready = new Promise<void>((r) => {
      resolveFonts = r;
    });
    Object.defineProperty(document, "fonts", { configurable: true, value: { ready } });
    try {
      renderTable();
      const region = screen.getByRole("region", { name: /^Strategies:/ });
      // First measure ran with fallback-font metrics where nothing overflowed.
      expect(screen.queryByText(HINT), "no overflow at the first measure").toBeNull();
      Object.defineProperty(region, "scrollWidth", { configurable: true, value: 900 });
      Object.defineProperty(region, "clientWidth", { configurable: true, value: 360 });
      await act(async () => {
        resolveFonts();
        await ready;
      });
      expect(
        screen.queryByText(HINT),
        "hint appears after the fonts load and the table widened",
      ).not.toBeNull();
    } finally {
      delete (document as unknown as { fonts?: unknown }).fonts;
    }
  });

  it("(4) the Actions header and data cells carry a wider trailing inset (pr-8) than the px-4 of the others", () => {
    renderTable();
    const headers = Array.from(document.querySelectorAll<HTMLElement>("thead tr th"));
    const actionsIdx = headers.findIndex((h) => (h.textContent ?? "").trim() === "Actions");
    expect(actionsIdx).toBeGreaterThanOrEqual(0);
    expect(headers[actionsIdx].className).toContain("pr-8");
    const rows = Array.from(document.querySelectorAll("tbody tr"));
    for (const r of rows) {
      const td = r.querySelectorAll<HTMLElement>(":scope > td")[actionsIdx];
      expect(td.className).toContain("pr-8");
    }
    // The inset is the Actions column's alone.
    expect(headers[actionsIdx - 1].className).not.toContain("pr-8");
  });
});
