/** @vitest-environment jsdom */
/**
 * Phase 239 (CACHE-02) — the stored range resolves on the ACTIVE basis axis.
 *
 * FactsheetProvider sits above BasisProvider, so it cannot see the basis. BasisProvider
 * publishes it through ActiveBasisContext, and useXRange resolves the stored dates on
 * `basisAxisDates(payload, basis)`. Two things must hold for a range under mark_to_market
 * or smoothed_mtm to keep its days:
 *
 *   1. drift pin — `basisAxisDates` returns the same dates every consumer indexes, i.e.
 *      the dates of `useBasisSeriesView` (its Layer 1). If the two drift, a range would
 *      resolve on one axis and be drawn on another.
 *   2. MTM growth — a range set on an MTM axis keeps its MTM dates when that axis grows
 *      at the front (it would keep its indices, and so move, if it resolved on cash).
 *
 * Fixtures copy MasterBrush.basis.test.tsx's style (cash in 2020, MTM from 2031, smoothed
 * from 2032, real ISO days so a date reveals which axis it came from).
 */
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import { buildFactsheetPayload } from "@/lib/factsheet/build-payload";
import type { FactsheetPayload } from "@/lib/factsheet/types";
import { FactsheetProvider, usePayload, useXRange } from "./factsheet-context";
import { BasisProvider, useBasis, useBasisSeriesView, type Basis } from "./basis-context";
import { basisAxisDates } from "./range-dates";

const CASH_LEN = 100;
const MTM_LEN = 150;

function cashPayload(): FactsheetPayload {
  const dailyReturns = Array.from({ length: CASH_LEN }).map((_, i) => {
    const month = String((Math.floor(i / 28) % 12) + 1).padStart(2, "0");
    const day = String((i % 28) + 1).padStart(2, "0");
    return { date: `2020-${month}-${day}`, value: Math.sin(i / 9) * 0.006 };
  });
  const payload = buildFactsheetPayload(
    {
      id: "test-strategy",
      name: "Test Strategy",
      types: ["test"],
      markets: ["crypto"],
      computedAt: "2026-06-27T00:00:00Z",
      trustTier: null,
      ingestSource: "api",
    },
    dailyReturns,
  );
  if (!payload) throw new Error("buildFactsheetPayload returned null in test");
  return payload;
}

/** The ISO day `i` days after the UTC-midnight instant `baseMs`. */
function isoDayAfter(baseMs: number, i: number): string {
  return new Date(baseMs + i * 86_400_000).toISOString().slice(0, 10);
}

function bundleFrom(baseMs: number, len: number) {
  const dates = Array.from({ length: len }).map((_, i) => isoDayAfter(baseMs, i));
  const equity = Array.from({ length: len }).map((_, i) => 1 + i * 0.01);
  return { dates, strategyEquity: equity, strategyReturns: equity.map(() => 0.01) };
}

function makePayloadWithMtmBundle(mtmStartMs = Date.UTC(2031, 0, 1), len = MTM_LEN): FactsheetPayload {
  return {
    ...cashPayload(),
    seriesByBasis: { mark_to_market: bundleFrom(mtmStartMs, len) },
  } as unknown as FactsheetPayload;
}

function makePayloadWithSmoothedBundle(): FactsheetPayload {
  return {
    ...cashPayload(),
    seriesByBasis: { smoothed_mtm: bundleFrom(Date.UTC(2032, 0, 1), MTM_LEN) },
  } as unknown as FactsheetPayload;
}

function BasisSetter({ basis }: { basis: Basis }) {
  const { setBasis } = useBasis();
  useEffect(() => {
    setBasis(basis);
  }, [basis, setBasis]);
  return null;
}

function BasisReadout() {
  return <span data-testid="basis">{useBasis().basis}</span>;
}

describe("basisAxisDates equals the basis view's dates", () => {
  function DriftProbe() {
    const payload = usePayload();
    const view = useBasisSeriesView(payload);
    const { basis } = useBasis();
    const same = JSON.stringify(view.dates) === JSON.stringify(basisAxisDates(payload, basis));
    return <span data-testid="drift">{`${basis}:${same ? "same" : "differ"}:${view.dates[0]}`}</span>;
  }

  const cases: Array<[string, Basis, () => FactsheetPayload, string]> = [
    ["cash", "cash_settlement", makePayloadWithMtmBundle, "2020-01-01"],
    ["MTM with bundle", "mark_to_market", makePayloadWithMtmBundle, "2031-01-01"],
    ["MTM without bundle", "mark_to_market", cashPayload, "2020-01-01"],
    ["smoothed with bundle", "smoothed_mtm", makePayloadWithSmoothedBundle, "2032-01-01"],
  ];

  for (const [label, basis, build, firstDay] of cases) {
    it(`basisAxisDates equals the basis view's dates (${label})`, async () => {
      render(
        <FactsheetProvider payload={build()} persist={false}>
          <BasisProvider>
            <BasisSetter basis={basis} />
            <DriftProbe />
          </BasisProvider>
        </FactsheetProvider>,
      );
      await waitFor(() => expect(screen.getByTestId("drift").textContent).toBe(`${basis}:same:${firstDay}`));
    });
  }
});

describe("an MTM manual range keeps its MTM dates when the MTM axis grows at the front", () => {
  function MtmRangeProbe() {
    const view = useBasisSeriesView(usePayload());
    const { xRange, setXRange } = useXRange();
    return (
      <>
        <span data-testid="mtm-dates">{`${view.dates[xRange[0]]}..${view.dates[xRange[1]]}`}</span>
        <button data-testid="set" onClick={() => setXRange([10, 40] as const)}>
          set
        </button>
      </>
    );
  }

  const tree = (payload: FactsheetPayload) => (
    <FactsheetProvider payload={payload} persist={false}>
      <BasisProvider>
        <BasisSetter basis="mark_to_market" />
        <BasisReadout />
        <MtmRangeProbe />
      </BasisProvider>
    </FactsheetProvider>
  );

  it("an MTM manual range keeps its MTM dates when the MTM axis grows at the front", async () => {
    const { rerender } = render(tree(makePayloadWithMtmBundle()));
    await waitFor(() => expect(screen.getByTestId("basis").textContent).toBe("mark_to_market"));
    act(() => {
      fireEvent.click(screen.getByTestId("set"));
    });
    expect(screen.getByTestId("mtm-dates").textContent).toBe("2031-01-11..2031-02-10");
    // The MTM bundle grows 30 days at the front (from 2030-12-02); cash is unchanged.
    rerender(tree(makePayloadWithMtmBundle(Date.UTC(2030, 11, 2), MTM_LEN + 30)));
    expect(screen.getByTestId("mtm-dates").textContent).toBe("2031-01-11..2031-02-10");
  });
});

describe("the fallback range is the full range of the ACTIVE axis, not the cash axis", () => {
  function FallbackProbe() {
    const { xRange, setXRange } = useXRange();
    return (
      <>
        <span data-testid="range">{`${xRange[0]}..${xRange[1]}`}</span>
        <button data-testid="set" onClick={() => setXRange([10, 40] as const)}>
          set
        </button>
      </>
    );
  }

  const tree = (payload: FactsheetPayload) => (
    <FactsheetProvider payload={payload} persist={false}>
      <BasisProvider>
        <BasisSetter basis="mark_to_market" />
        <BasisReadout />
        <FallbackProbe />
      </BasisProvider>
    </FactsheetProvider>
  );

  it("an MTM axis longer than cash resolves to the full MTM axis with no range set, and when a manual range falls off the axis", async () => {
    const { rerender } = render(tree(makePayloadWithMtmBundle()));
    await waitFor(() => expect(screen.getByTestId("basis").textContent).toBe("mark_to_market"));
    // No range set: the whole MTM axis (150 days), not the cash-sized [0, 99] that would
    // drop the 50 most recent MTM days while reading as full history.
    expect(screen.getByTestId("range").textContent).toBe(`0..${MTM_LEN - 1}`);

    act(() => {
      fireEvent.click(screen.getByTestId("set"));
    });
    expect(screen.getByTestId("range").textContent).toBe("10..40");
    // The MTM axis now starts 20 days AFTER the stored start (2031-01-11): the range is off
    // the axis, so it falls back to the full range of that same axis.
    rerender(tree(makePayloadWithMtmBundle(Date.UTC(2031, 0, 21), MTM_LEN)));
    expect(screen.getByTestId("range").textContent).toBe(`0..${MTM_LEN - 1}`);
  });
});
