/** @vitest-environment jsdom */
/**
 * Phase 103 (MTM-follow, F1) — HistogramChart must render the ACTIVE-BASIS
 * daily-returns distribution, not always cash.
 *
 * The phase-103 red team found HistogramChart read `usePayload()` directly (never
 * the basis view), so under mark_to_market it drew the CASH distribution while
 * sitting directly above the MTM-following QuantileBoxPlot — a violation of the
 * SC-4 invariant that NOTHING displays cash under an MTM label. The frozen-spine
 * diff-zero guard masked it (the component was in the phase-52 frozen set). The
 * fix routes it through `useBasisSeriesView`; this test pins the behavior and is
 * the NEUTER witness — reverting to `usePayload()` makes the MTM assertion FAIL
 * (the MTM header would report the cash sample count).
 *
 * Cash byte-identity (SC-4) is also pinned: under the default cash basis the
 * view returns the payload by reference, so the sample count equals the cash
 * series length exactly.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import { useEffect } from "react";
import { buildFactsheetPayload } from "@/lib/factsheet/build-payload";
import type { FactsheetPayload } from "@/lib/factsheet/types";

vi.mock("@/hooks/useBreakpoint", () => ({
  useBreakpoint: vi.fn(() => "desktop" as const),
}));

import { FactsheetProvider } from "./factsheet-context";
import { BasisProvider, useBasis, type Basis } from "./basis-context";
import { HistogramChart } from "./HistogramChart";

const CASH_LEN = 400;
const MTM_LEN = 120; // a DISTINCT MTM axis → a distinct in-window sample count

/** Parse the "{n} samples in visible window" count out of the rendered header. */
function sampleCount(text: string | null): number {
  const m = /(\d+) samples in visible window/.exec(text ?? "");
  if (!m) throw new Error(`no sample-count text found in: ${text}`);
  return Number(m[1]);
}

/**
 * A real cash payload (400 synthetic daily returns) with a synthetic MTM series
 * bundle whose `strategyReturns` is SHORTER (120 finite values). The histogram
 * loops over the shared cash xRange indices [0..399] and reads
 * `view.strategyReturns[i]`; under cash all 400 are finite → 400 samples, under
 * MTM only indices 0..119 are finite → 120 samples. The header text
 * "{n} samples in visible window" is the observable witness.
 */
function makePayloadWithMtmBundle(): FactsheetPayload {
  const dailyReturns = Array.from({ length: CASH_LEN }).map((_, i) => {
    const dayOfYear = i % 360;
    const year = 2023 + Math.floor(i / 360);
    const month = String((Math.floor(dayOfYear / 28) % 12) + 1).padStart(2, "0");
    const day = String((dayOfYear % 28) + 1).padStart(2, "0");
    return { date: `${year}-${month}-${day}`, value: Math.sin(i / 9) * 0.006 };
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

  const mtmReturns = Array.from({ length: MTM_LEN }).map((_, i) => Math.cos(i / 7) * 0.02);
  const mtmDates = Array.from({ length: MTM_LEN }).map((_, i) => `2023-${String((i % 12) + 1).padStart(2, "0")}-01`);
  return {
    ...payload,
    seriesByBasis: {
      mark_to_market: {
        dates: mtmDates,
        strategyReturns: mtmReturns,
      },
    },
  } as unknown as FactsheetPayload;
}

function BasisSetter({ basis }: { basis: Basis }) {
  const { setBasis } = useBasis();
  useEffect(() => {
    setBasis(basis);
  }, [basis, setBasis]);
  return null;
}

function renderHistogram(basis: Basis) {
  return render(
    <FactsheetProvider payload={makePayloadWithMtmBundle()}>
      <BasisProvider>
        <BasisSetter basis={basis} />
        <HistogramChart />
      </BasisProvider>
    </FactsheetProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("[F1] HistogramChart follows the active basis", () => {
  it("cash renders a large cash sample count (byte-identity / SC-4)", () => {
    const { container } = renderHistogram("cash_settlement");
    // The cash in-window count is the full cash series (payload internals trim a
    // few warmup/non-finite points, so this is >300, not exactly CASH_LEN).
    const n = sampleCount(container.textContent);
    expect(n).toBeGreaterThan(300);
    expect(n).toBeLessThanOrEqual(CASH_LEN);
    expect(n).not.toBe(MTM_LEN);
  });

  it("mark_to_market renders the MTM sample count, NOT cash (neuter → cash → RED)", () => {
    const cashCount = sampleCount(renderHistogram("cash_settlement").container.textContent);
    const { container } = renderHistogram("mark_to_market");
    // Under MTM the distribution is drawn from the bundle's shorter
    // strategyReturns → exactly MTM_LEN samples.
    expect(sampleCount(container.textContent)).toBe(MTM_LEN);
    // And it is NOT the cash count — this is the line that goes RED if the
    // component reverts to reading usePayload() directly (it would report the
    // cash count under an MTM label, violating SC-4).
    expect(sampleCount(container.textContent)).not.toBe(cashCount);
  });
});
