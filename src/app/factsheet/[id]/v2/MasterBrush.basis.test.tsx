/** @vitest-environment jsdom */
/**
 * Phase 103 (MTM-follow, F2) — MasterBrush must follow the ACTIVE basis: the
 * sparkline equity, the date axis, the window edge labels AND the emitted xRange
 * indices all ride the basis view, not the always-cash payload.
 *
 * The phase-103 red team found MasterBrush read `usePayload()` directly, so under
 * mark_to_market it drew the CASH sparkline and labelled the window with CASH
 * dates (a cash-index-on-MTM-axis mislabel), and — because the FactsheetProvider
 * xRange clamp was sized to the cash axis length — the recent days of an MTM axis
 * LONGER than cash were PERMANENTLY unreachable. The frozen-spine diff-zero guard
 * masked all of it. This test is the NEUTER witness for both halves:
 *
 *   1. labels follow the basis  — reverting MasterBrush to `usePayload()` makes the
 *      MTM window labels show CASH dates → RED.
 *   2. widened clamp            — reverting the factsheet-context setXRange clamp to
 *      the cash length clips an MTM index past cashLen-1 → the last MTM day is
 *      unreachable → RED.
 *
 * Cash byte-identity (SC-4) is pinned both ways: under the default cash basis the
 * view returns the payload by reference, so the labels are the cash dates and the
 * clamp is the cash length exactly (the widened bound is never exercised).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import { buildFactsheetPayload } from "@/lib/factsheet/build-payload";
import type { FactsheetPayload } from "@/lib/factsheet/types";

vi.mock("@/hooks/useBreakpoint", () => ({
  useBreakpoint: vi.fn(() => "desktop" as const),
}));

import { FactsheetProvider, useXRange } from "./factsheet-context";
import { BasisProvider, useBasis, type Basis } from "./basis-context";
import { MasterBrush } from "./MasterBrush";

const CASH_LEN = 100;
const MTM_LEN = 150; // deliberately LONGER than cash → exercises the widened clamp

/**
 * A real cash payload (100 synthetic 2020 daily returns) plus a synthetic MTM
 * bundle whose date axis is LONGER (150) and carries UNIQUE, cash-distinct label
 * days (MTM from 2031-01-01, smoothed from 2032-01-01, each one day apart) so a
 * window edge label unambiguously reveals which axis the brush is reading, and
 * which index it resolved to. They are real ISO days because the brush prints
 * its edges through `formatDay` (SC-3), which reads a non-date as "—".
 */
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

function makePayloadWithMtmBundle(): FactsheetPayload {
  const payload = cashPayload();
  const mtmDates = Array.from({ length: MTM_LEN }).map((_, i) => isoDayAfter(Date.UTC(2031, 0, 1), i));
  const mtmEquity = Array.from({ length: MTM_LEN }).map((_, i) => 1 + i * 0.01);
  return {
    ...payload,
    seriesByBasis: {
      mark_to_market: {
        dates: mtmDates,
        strategyEquity: mtmEquity,
        strategyReturns: mtmEquity.map(() => 0.01),
      },
    },
  } as unknown as FactsheetPayload;
}

// Phase 133 (SMTM-01) — the FLAGSHIP options shape: a smoothed bundle LONGER than
// cash and NO mark_to_market bundle (MTM gated OFF, smoothed serving the charts). The
// F2.3 clamp must consult the smoothed bundle length (its own third max() term),
// otherwise the recent smoothed days past the cash length are permanently unreachable.
const SMTM_LEN = 150;
function makePayloadWithSmoothedBundle(): FactsheetPayload {
  const payload = cashPayload();
  const smDates = Array.from({ length: SMTM_LEN }).map((_, i) => isoDayAfter(Date.UTC(2032, 0, 1), i));
  const smEquity = Array.from({ length: SMTM_LEN }).map((_, i) => 1 + i * 0.01);
  return {
    ...payload,
    seriesByBasis: {
      smoothed_mtm: {
        dates: smDates,
        strategyEquity: smEquity,
        strategyReturns: smEquity.map(() => 0.01),
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

/** Drives a single setXRange after mount so the clamp behaviour is observable. */
function XRangeDriver({ to }: { to: readonly [number, number] }) {
  const { setXRange, xRange } = useXRange();
  useEffect(() => {
    setXRange(to);
  }, [setXRange, to]);
  return <div data-testid="xr">{`${xRange[0]}-${xRange[1]}`}</div>;
}

function renderBrush(
  basis: Basis,
  opts: { payload?: FactsheetPayload; drive?: readonly [number, number] } = {},
) {
  return render(
    <FactsheetProvider payload={opts.payload ?? makePayloadWithMtmBundle()} persist={false}>
      <BasisProvider>
        <BasisSetter basis={basis} />
        {opts.drive && <XRangeDriver to={opts.drive} />}
        <MasterBrush />
      </BasisProvider>
    </FactsheetProvider>,
  );
}

/**
 * The brush header renders "{formatDay(start)} – {formatDay(end)}" in a dedicated
 * `.normal-case` span. Scope to that span so the sparkline's year-tick <text>
 * labels never pollute the match.
 */
function edgeLabels(container: HTMLElement): { start: string; end: string } {
  const span = container.querySelector(".normal-case");
  const text = span?.textContent ?? "";
  const m = /^(.+?) – (.+)$/.exec(text.trim());
  if (!m) throw new Error(`no brush edge labels found in: ${text}`);
  return { start: m[1], end: m[2] };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("[F2] MasterBrush follows the active basis", () => {
  it("cash labels the window with CASH dates (byte-identity / SC-4)", () => {
    const { container } = renderBrush("cash_settlement");
    const { start, end } = edgeLabels(container);
    // Cash axis → 2020 dates on both edges, never a 2031 MTM day.
    expect(start).toBe("Jan 1, 2020");
    expect(end).toBe("Apr 16, 2020");
  });

  it("mark_to_market labels the window with MTM dates, NOT cash (neuter → cash → RED)", () => {
    const { container } = renderBrush("mark_to_market");
    const { start } = edgeLabels(container);
    // Under MTM the start edge reads the bundle's own axis (2031-01-01), never the
    // cash 2020 date. This is the line that reddens if MasterBrush reverts to
    // usePayload() (it would label the window with cash dates under MTM).
    expect(start).toBe("Jan 1, 2031");
    expect(start).not.toContain("2020");
  });

  it("widened clamp: an MTM index past the cash length is REACHABLE (neuter clamp → RED)", async () => {
    // Drive the window end to the LAST MTM index (149), which is past the cash
    // length (99). With the widened setXRange clamp this resolves to index 149
    // (May 30, 2031); the old cash-sized clamp clips it to 99 (Apr 10, 2031),
    // the permanently-unreachable bug.
    const { container } = renderBrush("mark_to_market", { drive: [0, MTM_LEN - 1] });
    await waitFor(() => {
      const { end } = edgeLabels(container);
      expect(end).toBe("May 30, 2031");
    });
  });

  it("no bundle: cash clamp is strictly cash-sized (widening is a no-op — byte-identity)", async () => {
    // For every single-key / cash-only factsheet (no MTM series bundle) the
    // widened bound = max(cashLen, 0) = cashLen, so setXRange([0, 9999]) clamps to
    // the cash length exactly — byte-identical to today. This is the guarantee
    // that the F2.3 widening never perturbs a bundle-less payload.
    const cash = cashPayload();
    const cashLen = cash.dates.length;
    const { getByTestId } = renderBrush("cash_settlement", { payload: cash, drive: [0, 9999] });
    await waitFor(() => {
      expect(getByTestId("xr").textContent).toBe(`0-${cashLen - 1}`);
    });
  });

  it("SMTM-01 widened clamp: a SMOOTHED index past the cash length is REACHABLE (neuter the third max() term → RED)", async () => {
    // The flagship options shape: a smoothed bundle LONGER than cash, NO MTM bundle.
    // Drive the window end to the LAST smoothed index (149), past the cash length
    // (99). With the third max() term (seriesByBasis.smoothed_mtm.dates.length) this
    // resolves to index 149 (May 29, 2032); without it the cash-sized clamp clips to 99 (Apr 9, 2032) (the
    // permanently-unreachable recent-days bug the F2.3 comment documents).
    const { container } = renderBrush("smoothed_mtm", {
      payload: makePayloadWithSmoothedBundle(),
      drive: [0, SMTM_LEN - 1],
    });
    await waitFor(() => {
      const { end } = edgeLabels(container);
      expect(end).toBe("May 29, 2032");
    });
  });
});
