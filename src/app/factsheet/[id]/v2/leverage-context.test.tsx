import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderHook, act } from "@testing-library/react";
import type { ReactNode } from "react";
import type { FactsheetPayload, ComputeSummary } from "@/lib/factsheet/types";
import { compute } from "@/lib/factsheet/compute";
import { BasisProvider, useBasisMetrics } from "./basis-context";
import {
  LeverageProvider,
  useLeverage,
  useLeveragedMetrics,
} from "./leverage-context";

/**
 * Phase 90.5 (LEV-01/D2/D5) — TDD RED scaffold for the ephemeral leverage
 * context. Pins the L===1 byte-identity short-circuit, the L!==1 client
 * recompute (real compute() on scaled returns, NOT an analytic rescale), the
 * sanitizeLeverage seam (T-90.5-06), the absent-periodsPerYear fail-closed
 * branch, and GUARD-04 by construction (T-90.5-07: no storage/URL/history in
 * the source).
 */

// A deterministic daily-return series with negatives (so Sortino is finite).
function makeReturns(n: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    // Bounded pseudo-random-ish oscillation around a small positive drift.
    out.push(0.001 + 0.02 * Math.sin(i * 1.7) - 0.015 * Math.cos(i * 0.9));
  }
  return out;
}

function makeDates(n: number): string[] {
  const out: string[] = [];
  const base = Date.UTC(2023, 0, 1);
  for (let i = 0; i < n; i++) {
    out.push(new Date(base + i * 86_400_000).toISOString().slice(0, 10));
  }
  return out;
}

const N = 400;
const RETS = makeReturns(N);
const DATES = makeDates(N);

function strip(rets: number[], pY: number): ComputeSummary {
  const { eq: _eq, dd: _dd, ...summary } = compute(rets, DATES, 0, pY);
  return summary;
}

/** Minimal single-key payload fixture with a coherent strategyMetrics. */
function makePayload(periodsPerYear: number | undefined): FactsheetPayload {
  const strategyMetrics =
    periodsPerYear == null ? strip(RETS, 365) : strip(RETS, periodsPerYear);
  return {
    strategyReturns: RETS,
    dates: DATES,
    strategyMetrics,
    ...(periodsPerYear == null ? {} : { periodsPerYear }),
  } as unknown as FactsheetPayload;
}

function wrapper({ children }: { children: ReactNode }) {
  return (
    <LeverageProvider>
      <BasisProvider>{children}</BasisProvider>
    </LeverageProvider>
  );
}

function useProbe(payload: FactsheetPayload) {
  const lev = useLeverage();
  const base = useBasisMetrics(payload);
  const levered = useLeveragedMetrics(payload);
  return { lev, base, levered };
}

function relClose(a: number, b: number, tol = 1e-9): boolean {
  if (b === 0) return Math.abs(a) < tol;
  return Math.abs(a - b) / Math.abs(b) < tol;
}

describe("leverage-context", () => {
  it("Test 1 — useLeverage throws outside its provider", () => {
    expect(() => renderHook(() => useLeverage())).toThrow(/LeverageProvider/);
  });

  it("Test 2 — L=1 returns the base metrics object by reference (byte-identity)", () => {
    const payload = makePayload(365);
    const { result } = renderHook(() => useProbe(payload), { wrapper });
    // Same object reference as the cash-basis result — no recompute at L=1.
    expect(result.current.levered.m).toBe(result.current.base.m);
    expect(result.current.levered.m).toBe(payload.strategyMetrics);
  });

  it("Test 3 — L=2 recomputes: vol ~2x, Sharpe/Sortino invariant, cum is compute-truth (not 2x)", () => {
    const payload = makePayload(365);
    const { result } = renderHook(() => useProbe(payload), { wrapper });
    const base = result.current.base.m;

    act(() => result.current.lev.setLeverage(2));
    const levered = result.current.levered.m;
    const truth = strip(
      RETS.map(r => 2 * r),
      365,
    );

    expect(relClose(levered.ann_vol, 2 * base.ann_vol)).toBe(true);
    expect(relClose(levered.ann_vol, truth.ann_vol)).toBe(true);
    // Sharpe / Sortino are leverage-invariant.
    expect(relClose(levered.sharpe, base.sharpe)).toBe(true);
    expect(relClose(levered.sortino, base.sortino)).toBe(true);
    // Cumulative KPI is path-dependent: equals compute() on doubled returns,
    // NOT 2x the base cumulative.
    expect(relClose(levered.cum_ret, truth.cum_ret)).toBe(true);
    expect(relClose(levered.cum_ret, 2 * base.cum_ret)).toBe(false);
  });

  it("Test 4 — absent periodsPerYear fails closed: L=2 still returns base by reference", () => {
    const payload = makePayload(undefined);
    const { result } = renderHook(() => useProbe(payload), { wrapper });

    act(() => result.current.lev.setLeverage(2));
    // No annualization basis => hook refuses to recompute => base object.
    expect(result.current.levered.m).toBe(payload.strategyMetrics);
  });

  it("Test 5 — L=999 recompute clamps via sanitizeLeverage to 10x, not 999x", () => {
    const payload = makePayload(365);
    const { result } = renderHook(() => useProbe(payload), { wrapper });
    const base = result.current.base.m;

    act(() => result.current.lev.setLeverage(999));
    const levered = result.current.levered.m;
    expect(relClose(levered.ann_vol, 10 * base.ann_vol)).toBe(true);
    expect(relClose(levered.ann_vol, 999 * base.ann_vol)).toBe(false);
  });

  it("Test 6 — GUARD-04: source has no storage/URL/cookie/history access", () => {
    const src = readFileSync(
      join(process.cwd(), "src/app/factsheet/[id]/v2/leverage-context.tsx"),
      "utf8",
    );
    // Strip comment lines so header prose can't self-invalidate the grep.
    const code = src
      .split("\n")
      .filter(line => {
        const t = line.trim();
        return !(t.startsWith("//") || t.startsWith("*") || t.startsWith("/*"));
      })
      .join("\n");
    expect(
      /localStorage|sessionStorage|document\.cookie|history\.(push|replace)|location\.|URLSearchParams/.test(
        code,
      ),
    ).toBe(false);
  });
});
