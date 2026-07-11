import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderHook, act } from "@testing-library/react";
import type { ReactNode } from "react";
import type { FactsheetPayload, ComputeSummary } from "@/lib/factsheet/types";
import {
  BasisProvider,
  useBasis,
  useBasisMetrics,
  mtmDisabledReasonCopy,
} from "./basis-context";

/**
 * Phase 91 / QA-01 (CONTEXT D5) — DIRECT test for the ephemeral basis context.
 *
 * Until now basis-context.tsx was only exercised indirectly via
 * leverage-context.test.tsx (which wraps <BasisProvider> to build the L-hook
 * tree). This mirrors that analog's renderHook + wrapper + act idiom and pins,
 * in isolation:
 *   - the cash_settlement default (basis-context.tsx:43-46),
 *   - the setBasis toggle (and restore),
 *   - useBasis throwing outside its provider (mirrors leverage Test 1),
 *   - the useBasisMetrics overlay contract (cash → strategyMetrics by reference;
 *     MTM → shallow copy overlaying ONLY the seven BASIS_KPI_MAP scalars),
 *   - the closed mtmDisabledReasonCopy set (:100-108) + unknown fallback,
 *   - GUARD-04 by construction: no storage/URL/history in the source (mirrors
 *     leverage Test 6 verbatim, retargeted).
 */

// A cash-basis strategyMetrics carrying the seven mapped tsKeys plus two
// UNMAPPED keys (alpha / information_ratio) that must survive an MTM overlay.
const CASH_METRICS = {
  cum_ret: 0.1,
  ann_vol: 0.2,
  max_dd: -0.15,
  cagr: 0.08,
  sharpe: 1.1,
  sortino: 1.5,
  calmar: 0.5,
  alpha: 0.42,
  information_ratio: 0.33,
  n: 250,
} as unknown as ComputeSummary;

// The PERSISTED mark_to_market scalars keyed by the Python serverKey names. Each
// mapped scalar differs from its cash counterpart so a swap is observable.
const MTM_SCALARS = {
  cumulative_return: 0.9,
  volatility: 0.25,
  max_drawdown: -0.18,
  cagr: 0.7,
  sharpe: 2.2,
  sortino: 2.9,
  calmar: 0.9,
};

function makePayload(): FactsheetPayload {
  return {
    strategyMetrics: CASH_METRICS,
    metricsByBasis: { mark_to_market: MTM_SCALARS },
  } as unknown as FactsheetPayload;
}

function wrapper({ children }: { children: ReactNode }) {
  return <BasisProvider>{children}</BasisProvider>;
}

function useProbe(payload: FactsheetPayload) {
  const ctx = useBasis();
  const bm = useBasisMetrics(payload);
  return { ctx, bm };
}

describe("basis-context", () => {
  it("Test 1 — useBasis default is cash_settlement", () => {
    const { result } = renderHook(() => useBasis(), { wrapper });
    expect(result.current.basis).toBe("cash_settlement");
  });

  it("Test 2 — setBasis flips to mark_to_market and back", () => {
    const { result } = renderHook(() => useBasis(), { wrapper });
    expect(result.current.basis).toBe("cash_settlement");

    act(() => result.current.setBasis("mark_to_market"));
    expect(result.current.basis).toBe("mark_to_market");

    act(() => result.current.setBasis("cash_settlement"));
    expect(result.current.basis).toBe("cash_settlement");
  });

  it("Test 3 — useBasis throws outside its provider", () => {
    expect(() => renderHook(() => useBasis())).toThrow(/BasisProvider/);
  });

  it("Test 4 — cash_settlement returns strategyMetrics UNTOUCHED (same reference)", () => {
    const payload = makePayload();
    const { result } = renderHook(() => useProbe(payload), { wrapper });
    // Default is cash → the hook returns payload.strategyMetrics directly
    // (basis-context.tsx:91), same object reference, no copy.
    expect(result.current.bm.basis).toBe("cash_settlement");
    expect(result.current.bm.m).toBe(payload.strategyMetrics);
    expect(result.current.bm.m.cum_ret).toBe(0.1);
  });

  it("Test 5 — mark_to_market overlays ONLY the mapped keys; unmapped keys survive", () => {
    const payload = makePayload();
    const { result } = renderHook(() => useProbe(payload), { wrapper });

    act(() => result.current.ctx.setBasis("mark_to_market"));
    const m = result.current.bm.m as unknown as Record<string, number>;

    // Shallow COPY, not the cash object.
    expect(result.current.bm.m).not.toBe(payload.strategyMetrics);

    // Mapped scalars swap to the persisted MTM values (serverKey → tsKey).
    // ALL SEVEN BASIS_KPI_MAP keys asserted so a regression on any mapped key
    // (incl. cagr/sortino) can't slip through the overlay-coverage test.
    expect(m.cum_ret).toBe(0.9); // cumulative_return
    expect(m.ann_vol).toBe(0.25); // volatility
    expect(m.max_dd).toBe(-0.18); // max_drawdown
    expect(m.cagr).toBe(0.7);
    expect(m.sharpe).toBe(2.2);
    expect(m.sortino).toBe(2.9);
    expect(m.calmar).toBe(0.9);

    // UNMAPPED keys keep their cash value — never displayed under an MTM label.
    expect(m.alpha).toBe(0.42);
    expect(m.information_ratio).toBe(0.33);
    expect(m.n).toBe(250);
  });

  it("Test 6 — mtmDisabledReasonCopy is a closed set with an unknown fallback", () => {
    // Enumerated from basis-context.tsx:100-108 — no invented keys.
    expect(mtmDisabledReasonCopy("unsmoothed_options_book")).toBe(
      "Mark-to-market disabled: un-smoothed options book (Phase-83 daily-mark smoothing not applied)",
    );
    expect(mtmDisabledReasonCopy("mtm_basis_unavailable_for_venue")).toBe(
      "Mark-to-market unavailable for this venue.",
    );
    // Fallback: unknown reason AND undefined both hit the default arm.
    const fallback = "Mark-to-market unavailable for this composite.";
    expect(mtmDisabledReasonCopy("some_unrecognized_reason")).toBe(fallback);
    expect(mtmDisabledReasonCopy(undefined)).toBe(fallback);
    expect(mtmDisabledReasonCopy()).toBe(fallback);
  });

  it("Test 7 — GUARD-04: source has no storage/URL/cookie/history access", () => {
    const src = readFileSync(
      join(process.cwd(), "src/app/factsheet/[id]/v2/basis-context.tsx"),
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
