/**
 * Phase 166.2 T6 (D-17, D-07): /compare's correlation matrix on a
 * compounding-NAV constant yield.
 *
 * A NAV that compounds at a constant rate has daily returns whose sd is about
 * 1.3e-16, float residue, not dispersion. A Pearson that divides by that
 * residue reports a "correlation" that is pure rounding noise. The D-07
 * invariant: the pair cell for a constant-yield pick must be EXACTLY the cell
 * an all-zero pick gets (the flat-window null, rendered as an em-dash with the
 * "Insufficient data" title), because no dispersion means no correlation.
 * Controls on the other side of the floor: two noisy picks, and a cent-rounded
 * constant-yield NAV (real quantisation dispersion), keep a finite cell.
 */
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { CompareCorrelationMatrix } from "./CompareCorrelationMatrix";
import { CONSTANT_YIELDS, navConstantYield } from "@/__tests__/fixtures/dispersion-nav";
import type { Strategy, StrategyAnalytics } from "@/lib/types";

const N = 366;

/** One shared calendar so every pair overlaps on all trailing 365 days. */
const DATES: string[] = Array.from({ length: N }, (_, i) =>
  new Date(Date.UTC(2025, 0, 1) + i * 86_400_000).toISOString().slice(0, 10),
);

/** Deterministic noisy returns (no randomness). */
function noisy(phase: number): number[] {
  return Array.from(
    { length: N },
    (_, i) => 0.004 * Math.sin(i * 1.7 + phase) + 0.002 * Math.cos(i * 0.37 + 2 * phase),
  );
}

type Item = { strategy: Strategy; analytics: StrategyAnalytics };

function item(id: string, returns: number[]): Item {
  return {
    strategy: { id, name: id } as unknown as Strategy,
    analytics: {
      returns_series: returns.map((value, i) => ({ date: DATES[i], value })),
    } as unknown as StrategyAnalytics,
  };
}

/** The rendered off-diagonal cell (row 0, column 1) of a two-pick matrix. */
function pairCell(items: Item[]): { text: string; title: string | null; bg: string } {
  const { container, unmount } = render(<CompareCorrelationMatrix items={items} />);
  const row = container.querySelectorAll("tbody tr")[0];
  // td[0] is the row label; td[1] is the diagonal; td[2] is the pair.
  const td = row.querySelectorAll("td")[2] as HTMLElement;
  const out = {
    text: td.textContent ?? "",
    title: td.getAttribute("title"),
    bg: td.style.backgroundColor,
  };
  unmount();
  return out;
}

const ZERO = Array<number>(N).fill(0);

describe("T6 CompareCorrelationMatrix: a constant yield renders the all-zero pick's cell", () => {
  it("the all-zero pick's cell is the flat-window null (the reference)", () => {
    const ref = pairCell([item("flat", ZERO), item("noisy", noisy(0))]);
    expect(ref.text).toBe("—");
    expect(ref.title).toBe("Insufficient data");
  });

  it.each(Object.entries(CONSTANT_YIELDS))(
    "%s: constant-yield pick's cell equals the all-zero pick's cell",
    (_id, dailyYield) => {
      const constant = pairCell([item("flat", navConstantYield(dailyYield, N)), item("noisy", noisy(0))]);
      const zero = pairCell([item("flat", ZERO), item("noisy", noisy(0))]);
      expect(constant).toEqual(zero);
    },
  );

  it("control: two noisy picks keep a finite cell", () => {
    const cell = pairCell([item("a", noisy(0)), item("b", noisy(0.9))]);
    expect(cell.text).not.toBe("—");
    expect(Number.isFinite(Number(cell.text))).toBe(true);
    expect(cell.title).toBeNull();
  });

  it("control: a cent-rounded constant-yield NAV (real dispersion) keeps a finite cell", () => {
    const cents = navConstantYield(CONSTANT_YIELDS["apy_1pct"], N, 10_000, true);
    const cell = pairCell([item("cents", cents), item("noisy", noisy(0))]);
    expect(cell.text).not.toBe("—");
    expect(Number.isFinite(Number(cell.text))).toBe(true);
  });
});
