import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import { useEffect } from "react";
import type { FactsheetPayload } from "@/lib/factsheet/types";
import { buildScenarioFactsheetPayload } from "@/app/(dashboard)/allocations/widgets/performance/scenario-factsheet-payload";

// Spy on deriveSeriesBundle AS IMPORTED BY basis-context.tsx — a thin wrapper over the real
// implementation so the levered view is genuinely computed, but every call is counted.
vi.mock("@/lib/factsheet/build-payload", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/factsheet/build-payload")>();
  return { ...actual, deriveSeriesBundle: vi.fn(actual.deriveSeriesBundle) };
});
import { deriveSeriesBundle } from "@/lib/factsheet/build-payload";
const deriveSpy = vi.mocked(deriveSeriesBundle);

import { BasisProvider, useBasisSeriesView } from "./basis-context";
import { LeverageProvider, useLeverage } from "./leverage-context";

/**
 * H-1 (Phase 107/108 Fable red team) — derive-once across all consumers.
 *
 * `useBasisSeriesView` is called from ~22 instances on one factsheet page. Before the shared
 * cache, EACH independently ran the ~235ms levered `deriveSeriesBundle` at L≠1, so dialing
 * leverage cost ~22×235ms ≈ 5s of main-thread work on stale numbers. This test renders N
 * sibling consumers of the SAME payload at L=2 and proves the levered derive runs EXACTLY
 * ONCE (shared cache) and every consumer receives the SAME object reference. Against the
 * per-instance code it fails with N derive calls / N distinct references.
 */
function makeCashSingleKey(): FactsheetPayload {
  // Cash single-key with periodsPerYear present → leverage-eligible on the default cash
  // basis, so L=2 reaches the (cached) levered deriveSeriesBundle.
  const p = buildScenarioFactsheetPayload({
    portfolioDaily: Array.from({ length: 50 }, (_, i) => ({
      date: new Date(Date.UTC(2023, 4, 1) + i * 86_400_000).toISOString().slice(0, 10),
      value: 0.0015 + Math.sin(i * 0.27) * 0.006,
    })),
    benchmark: null,
    periodsPerYear: 365,
  });
  return { ...p, periodsPerYear: 365 } as FactsheetPayload;
}

const N = 6;
let collected: FactsheetPayload[] = [];

function Probe({ payload }: { payload: FactsheetPayload }) {
  const view = useBasisSeriesView(payload);
  collected.push(view);
  return null;
}

function LeverageSetter({ value }: { value: number }) {
  const { setLeverage } = useLeverage();
  useEffect(() => {
    setLeverage(value);
  }, [value, setLeverage]);
  return null;
}

beforeEach(() => {
  collected = [];
});

describe("useBasisSeriesView — H-1 shared levered-view cache (derive once, not per consumer)", () => {
  it(`runs deriveSeriesBundle EXACTLY ONCE for ${N} consumers at L=2 and returns one shared reference`, () => {
    const payload = makeCashSingleKey();
    // Discard any derive calls from fixture construction — count only the L=2 render below.
    deriveSpy.mockClear();

    render(
      <BasisProvider>
        <LeverageProvider>
          <LeverageSetter value={2} />
          {Array.from({ length: N }, (_, i) => (
            <Probe key={i} payload={payload} />
          ))}
        </LeverageProvider>
      </BasisProvider>,
    );

    // The levered derive is pure in (payload, basis, L) → the shared cache computes it once
    // regardless of how many instances consume it. Per-instance code would call it N times.
    expect(deriveSpy).toHaveBeenCalledTimes(1);

    // Every consumer that saw L=2 received the SAME object reference (the L=1 transition
    // renders returned payload-by-reference; the single levered view is the only non-payload
    // reference collected).
    const leveredRefs = new Set(collected.filter((v) => v !== payload));
    expect(leveredRefs.size).toBe(1);
  });

  it("L=1 stays by-reference and NEVER populates the cache (SC-4 byte-identity, no derive)", () => {
    const payload = makeCashSingleKey();
    deriveSpy.mockClear();
    render(
      <BasisProvider>
        <LeverageProvider>
          {Array.from({ length: N }, (_, i) => (
            <Probe key={i} payload={payload} />
          ))}
        </LeverageProvider>
      </BasisProvider>,
    );
    // At L=1 the hook returns base BY REFERENCE (=== payload for cash) and never derives.
    expect(deriveSpy).not.toHaveBeenCalled();
    for (const v of collected) expect(v).toBe(payload);
  });
});
