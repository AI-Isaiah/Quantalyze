/**
 * Phase 164.6.6.2.2 review WR-05: /compare's correlation matrix reads the
 * stored `returns_series` CURVE, never daily returns. Feeding curve LEVELS to a
 * Pearson makes two strategies that both trend upward correlate near +1
 * whatever their daily co-movement.
 *
 * The oracle is an independent invariant, not the implementation: two curves
 * built from daily returns that are exact mirror images around a common drift
 * (r_a = d + e_t, r_b = d - e_t) have a daily-return correlation of exactly -1,
 * while both curves rise monotonically (a level-on-level correlation is near
 * +1). The same holds for the arithmetic (`cumulative_method: "simple"`)
 * curve, where the daily return is the DIFFERENCE of two levels.
 */
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { CompareCorrelationMatrix } from "./CompareCorrelationMatrix";
import type { Strategy, StrategyAnalytics } from "@/lib/types";

const N = 120;

const DATES: string[] = Array.from({ length: N + 1 }, (_, i) =>
  new Date(Date.UTC(2025, 0, 1) + i * 86_400_000).toISOString().slice(0, 10),
);

/** Deterministic zero-mean wobble (no randomness). */
const wobble = (i: number): number => Math.sin(i * 1.3) + 0.5 * Math.cos(i * 0.41);

/** Geometric curve: w_k = w_{k-1} * (1 + r_k), seeded at 1. */
function geometricCurve(rs: number[]): number[] {
  const out = [1];
  for (const r of rs) out.push(out[out.length - 1] * (1 + r));
  return out;
}

/** Arithmetic curve: w_k = w_{k-1} + r_k, seeded at 1. */
function simpleCurve(rs: number[]): number[] {
  const out = [1];
  for (const r of rs) out.push(out[out.length - 1] + r);
  return out;
}

type Item = { strategy: Strategy; analytics: StrategyAnalytics };

function item(id: string, levels: number[], cumulativeMethod?: string): Item {
  return {
    strategy: { id, name: id } as unknown as Strategy,
    analytics: {
      returns_series: levels.map((value, i) => ({ date: DATES[i], value })),
      ...(cumulativeMethod === undefined ? {} : { cumulative_method: cumulativeMethod }),
    } as unknown as StrategyAnalytics,
  };
}

function pairCell(items: Item[]): string {
  const { container, unmount } = render(<CompareCorrelationMatrix items={items} />);
  const row = container.querySelectorAll("tbody tr")[0];
  const text = (row.querySelectorAll("td")[2] as HTMLElement).textContent ?? "";
  unmount();
  return text;
}

const DRIFT = 0.01;
const AMP = 0.006;
const eps = Array.from({ length: N }, (_, i) => AMP * wobble(i));
const mirrorA = eps.map((e) => DRIFT + e);
const mirrorB = eps.map((e) => DRIFT - e);

describe("WR-05 CompareCorrelationMatrix correlates daily returns, not curve levels", () => {
  it("two rising geometric curves with mirror-image daily returns read -1.00, not +1", () => {
    const a = geometricCurve(mirrorA);
    const b = geometricCurve(mirrorB);
    // Premise: both curves rise (the level-on-level reading would be near +1).
    expect(a[N]).toBeGreaterThan(1.5);
    expect(b[N]).toBeGreaterThan(1.5);
    expect(pairCell([item("a", a), item("b", b)])).toBe("-1.00");
  });

  it("identical daily returns on curves of different levels read +1.00", () => {
    const a = geometricCurve(mirrorA);
    const scaled = a.map((v) => v * 250);
    expect(pairCell([item("a", a), item("scaled", scaled)])).toBe("1.00");
  });

  it("a simple (arithmetic) curve is differenced, not divided: mirror-image increments read -1.00", () => {
    const a = simpleCurve(mirrorA);
    const b = simpleCurve(mirrorB);
    expect(pairCell([item("a", a, "simple"), item("b", b, "simple")])).toBe("-1.00");
  });

  it("the method is read per row: a simple curve read as geometric would not be -1.00", () => {
    // Same simple curves, flag absent (geometric default): ratios of an
    // arithmetic curve are NOT the mirror images, so the cell must differ.
    const a = simpleCurve(mirrorA);
    const b = simpleCurve(mirrorB);
    expect(pairCell([item("a", a, "simple"), item("b", b, "simple")])).not.toBe(
      pairCell([item("a", a), item("b", b)]),
    );
  });
});
