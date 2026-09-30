import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { buildFactsheetPayload, type BuildFactsheetOpts } from "@/lib/factsheet/build-payload";
import { BTC_DAILY } from "@/lib/factsheet/benchmarks";
import type { FactsheetPayload } from "@/lib/factsheet/types";
import { FactsheetProvider, useActiveComparator } from "./factsheet-context";
import { ComparatorPicker } from "./ComparatorPicker";

// Regression: "None" radio was removed in favor of toggle-off semantics.
// Clicking the active comparator chip clears it to "none"; clicking a
// different chip selects it. Found by /qa on 2026-05-20.

function makePayload(opts?: BuildFactsheetOpts) {
  // 200 days of synthetic returns — long enough to clear every internal
  // length threshold (benchmark window, rolling window, etc).
  const dailyReturns = Array.from({ length: 200 }).map((_, i) => ({
    date: `2024-${String(((i / 28) | 0) + 1).padStart(2, "0")}-${String(
      (i % 28) + 1,
    ).padStart(2, "0")}`,
    value: Math.sin(i / 9) * 0.005,
  }));
  const payload = buildFactsheetPayload(
    {
      id: "test-strategy",
      name: "Test Strategy",
      types: ["test"],
      markets: ["crypto"],
      computedAt: "2026-05-20T00:00:00Z",
      trustTier: null,
    },
    dailyReturns,
    opts,
  );
  if (!payload) throw new Error("buildFactsheetPayload returned null in test");
  return payload;
}

function CurrentComparator() {
  const { key } = useActiveComparator();
  return <span data-testid="active-comparator">{key}</span>;
}

function renderPicker(payload: FactsheetPayload = makePayload()) {
  return render(
    <FactsheetProvider payload={payload}>
      <ComparatorPicker />
      <CurrentComparator />
    </FactsheetProvider>,
  );
}

describe("ComparatorPicker", () => {
  it("renders BTC and SPX chips with no 'None' option", () => {
    renderPicker();
    expect(screen.getByRole("button", { name: /BTC/ })).toBeDefined();
    expect(screen.getByRole("button", { name: /SPX/ })).toBeDefined();
    expect(screen.queryByRole("button", { name: /None/i })).toBeNull();
  });

  it("starts with the payload's activeComparator pressed", () => {
    renderPicker();
    expect(screen.getByRole("button", { name: /BTC/ })).toHaveProperty(
      "ariaPressed",
      "true",
    );
    expect(screen.getByRole("button", { name: /SPX/ })).toHaveProperty(
      "ariaPressed",
      "false",
    );
  });

  it("clicking a different chip swaps the active comparator", () => {
    renderPicker();
    fireEvent.click(screen.getByRole("button", { name: /SPX/ }));
    expect(screen.getByTestId("active-comparator").textContent).toBe("spx");
    expect(screen.getByRole("button", { name: /SPX/ })).toHaveProperty(
      "ariaPressed",
      "true",
    );
    expect(screen.getByRole("button", { name: /BTC/ })).toHaveProperty(
      "ariaPressed",
      "false",
    );
  });

  it("clicking the active chip toggles off to 'none'", () => {
    renderPicker();
    fireEvent.click(screen.getByRole("button", { name: /BTC/ }));
    expect(screen.getByTestId("active-comparator").textContent).toBe("none");
    expect(screen.getByRole("button", { name: /BTC/ })).toHaveProperty(
      "ariaPressed",
      "false",
    );
    expect(screen.getByRole("button", { name: /SPX/ })).toHaveProperty(
      "ariaPressed",
      "false",
    );
  });
});

// Phase 169.5 (SC3, 169 D-09 / D-21 / D-52): the active comparator's coverage is
// stated in words under the chips. The strategy axis of makePayload() ends on
// 2024-08-04 (a Sunday). A comparator whose last close is earlier is dated, so a
// reader never takes an em-dash window or a line that stops short for a flat
// market; a failed BTC read says so instead of rendering a silent blank.
describe("ComparatorPicker coverage caption", () => {
  const CAPTION = /prices (through|unavailable)/;

  it("dates BTC when its prices end before the strategy's last date", () => {
    const cutoff = "2024-07-25";
    renderPicker(
      makePayload({
        benchmarkPrices: {
          prices: BTC_DAILY.filter(p => p.date <= cutoff),
          through: cutoff,
          dropped: [],
        },
      }),
    );
    expect(screen.getByText("BTC prices through Jul 25, 2024")).toBeDefined();
  });

  it("shows no caption when BTC covers the strategy's last date", () => {
    const payload = makePayload();
    expect(payload.comparators.btc.through).toBe("2024-08-04");
    renderPicker(payload);
    expect(screen.queryByText(CAPTION)).toBeNull();
  });

  it("says BTC prices are unavailable on the unavailable form (a failed read)", () => {
    const payload = makePayload({ benchmarkPrices: { unavailable: true } });
    expect(payload.comparators.btc.through).toBeNull();
    expect(payload.comparators.btc.summary).toBeNull();
    renderPicker(payload);
    expect(screen.getByText("BTC prices unavailable")).toBeDefined();
  });

  it("shows no caption when `through` is absent (a hand-built block, D-21)", () => {
    const cutoff = "2024-07-25";
    const payload = makePayload({
      benchmarkPrices: {
        prices: BTC_DAILY.filter(p => p.date <= cutoff),
        through: cutoff,
        dropped: [],
      },
    });
    // Same stale block, minus the field: absent means "no coverage information",
    // never the unavailable sentence and never a guessed date.
    const { through: _omit, ...handBuilt } = payload.comparators.btc;
    void _omit;
    renderPicker({ ...payload, comparators: { ...payload.comparators, btc: handBuilt } });
    expect(screen.queryByText(CAPTION)).toBeNull();
  });

  // Review WR-01: coverage is read on SPX's own (weekday) calendar. Its last close on
  // or before Sunday 2024-08-04 is Friday 2024-08-02, and no SPX trading day lies in
  // (Fri, Sun], so SPX is fully covered: no caption, and the windows are numbers.
  it("shows no SPX caption when SPX's Friday close covers a strategy ending that weekend", () => {
    const payload = makePayload();
    expect(payload.comparators.spx.through).toBe("2024-08-02");
    expect(payload.comparators.spx.summary!.mtd).not.toBeNull();
    renderPicker(payload);
    expect(screen.queryByText(CAPTION)).toBeNull(); // BTC active and fully covered
    fireEvent.click(screen.getByRole("button", { name: /SPX/ }));
    expect(screen.queryByText(CAPTION)).toBeNull();
  });

  it("dates SPX when an SPX trading day lies after its last close", () => {
    const payload = makePayload();
    // Wednesday 2024-07-31: Thu 08-01 and Fri 08-02 are SPX days with no close.
    renderPicker({
      ...payload,
      comparators: { ...payload.comparators, spx: { ...payload.comparators.spx, through: "2024-07-31" } },
    });
    fireEvent.click(screen.getByRole("button", { name: /SPX/ }));
    expect(screen.getByText("SPX prices through Jul 31, 2024")).toBeDefined();
  });

  it("shows no caption when no comparator is active", () => {
    renderPicker(makePayload({ benchmarkPrices: { unavailable: true } }));
    fireEvent.click(screen.getByRole("button", { name: /BTC/ }));
    expect(screen.getByTestId("active-comparator").textContent).toBe("none");
    expect(screen.queryByText(CAPTION)).toBeNull();
  });
});
