import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import type { DailyPoint } from "@/lib/portfolio-math-utils";
import type { FactsheetPayload } from "@/lib/factsheet/types";
import { buildScenarioFactsheetPayload } from "@/app/(dashboard)/allocations/widgets/performance/scenario-factsheet-payload";
import { FactsheetProvider } from "./factsheet-context";
import { FactsheetBody } from "./FactsheetView";

/**
 * Phase 190 / SC-3 (D-03, D-06; UI-SPEC FQ190-UPDATING) — the factsheet's
 * "updating" line.
 *
 * WHY these assertions matter, not just what they check:
 *
 *   1. THE LINE IS WHAT STOPS A READER TAKING STALE FIGURES FOR CURRENT ONES.
 *      Plan 03 keeps the factsheet on screen while a re-run is pending over a
 *      stored result. Without this sentence the chip's date is the only hint
 *      that the numbers are from an earlier computation. Tests 1 and 2 pin
 *      presence AND absence from `payload.analyticsUpdating` alone: a line
 *      that rendered always (or never) would let a settled factsheet claim it
 *      is updating, or an updating one claim to be settled. The expected copy
 *      is typed here, never imported, so a wording drift fails this file.
 *
 *   2. PLACEMENT KEEPS THE CHIP/RECENCY PAIR INTACT (D-162-2, F-1/F-4 of the
 *      recency-line suite). The line sits after the recency line and before the
 *      trade-fetch line. Test 3 pins both neighbours; test 4 proves the chip
 *      is still immediately followed by the recency line and serializes
 *      byte-identically with the flag on or off, which forbids the shorter
 *      implementation that renders the line inside FreshnessChip.
 *
 *   3. NO LIVE REGION. The line is server-rendered and present at load (the
 *      OwnerUnpublishedNotice precedent); an aria-live region would announce
 *      a fact that does not change within a session, and an sr-only copy would
 *      read the sentence twice. Test 5 pins both.
 *
 * Stub block mirrors FactsheetView.recency-line.test.tsx verbatim.
 */

vi.mock("@/lib/sentry-capture", () => ({ captureToSentry: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

const lsStore = new Map<string, string>();
const localStorageMock = {
  getItem: vi.fn((k: string) => lsStore.get(k) ?? null),
  setItem: vi.fn((k: string, v: string) => {
    lsStore.set(k, v);
  }),
  removeItem: vi.fn((k: string) => {
    lsStore.delete(k);
  }),
  clear: vi.fn(() => lsStore.clear()),
  key: vi.fn(() => null),
  length: 0,
};
// Installed PER TEST: `vitest.config.ts` sets `unstubGlobals: true` (DEF-16-1).
beforeEach(() => {
  vi.stubGlobal("localStorage", localStorageMock);
});
Object.defineProperty(window, "localStorage", {
  value: localStorageMock,
  configurable: true,
});

const SERIES_END = "2026-05-06";
const RECENCY_PREFIX = "Track record through ";
const UPDATING_TESTID = "factsheet-analytics-updating";
// D-06 (founder, 2026-11-03). Typed here; never imported (ORACLE INDEPENDENCE).
const UPDATING_COPY =
  "Updating with the latest data. These figures are from the last completed computation.";
const UPDATING_CLASS = "mt-1 text-caption text-text-muted";
const COMPUTED_AT = `${SERIES_END}T00:00:00Z`;

function makeReturnsSeriesEndingOn(n: number, endIso: string, drift = 0.0015): DailyPoint[] {
  const end = new Date(`${endIso}T00:00:00Z`);
  const pts: DailyPoint[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(end);
    d.setUTCDate(d.getUTCDate() - i);
    pts.push({
      date: d.toISOString().slice(0, 10),
      value: drift + Math.sin((n - 1 - i) * 0.27) * 0.005,
    });
  }
  return pts;
}

const populatedPayload: FactsheetPayload = {
  ...buildScenarioFactsheetPayload({
    portfolioDaily: makeReturnsSeriesEndingOn(300, SERIES_END),
    benchmark: null,
  }),
  computedAt: COMPUTED_AT,
};

const emptySeriesPayload: FactsheetPayload = {
  ...buildScenarioFactsheetPayload({ portfolioDaily: [], benchmark: null }),
  computedAt: COMPUTED_AT,
};

/** A key-backed strategy whose trade fetch is on record, so TradeFetchLine renders. */
const TRADE_FETCH = {
  tradesFetchedAt: "2026-05-05T00:00:00Z",
  tradeFetchVenue: "okx",
} as const;

function renderFactsheet(payload: FactsheetPayload) {
  return render(
    <FactsheetProvider payload={payload} persist={false}>
      <FactsheetBody payload={payload} hideFooter />
    </FactsheetProvider>,
  );
}

function chipRoot(container: HTMLElement): HTMLElement {
  const header = container.querySelector("header");
  expect(header).not.toBeNull();
  const labelRow = header!.querySelector('[class*="tracking-[0.18em]"]');
  expect(labelRow, "FreshnessChip label row not found").not.toBeNull();
  const root = labelRow!.parentElement;
  expect(root).not.toBeNull();
  return root as HTMLElement;
}

function recencyLine(container: HTMLElement): HTMLElement | null {
  const header = container.querySelector("header");
  if (!header) return null;
  return (
    (Array.from(header.querySelectorAll("p")).find((p) =>
      (p.textContent ?? "").startsWith(RECENCY_PREFIX),
    ) as HTMLElement | undefined) ?? null
  );
}

function updatingLine(container: HTMLElement): HTMLElement | null {
  return container.querySelector(`[data-testid="${UPDATING_TESTID}"]`);
}

describe("FactsheetView — analytics updating line (phase 190 D-03 / FQ190-UPDATING)", () => {
  it("1: renders the exact copy in the muted caption tier when analyticsUpdating is true", () => {
    const { container } = renderFactsheet({ ...populatedPayload, analyticsUpdating: true });

    const line = updatingLine(container);
    expect(line, "updating line did not render").not.toBeNull();
    expect(line!.tagName).toBe("P");
    expect(line!.textContent).toBe(UPDATING_COPY);
    expect(line!.className).toBe(UPDATING_CLASS);
  });

  it("2: renders NO line when analyticsUpdating is false", () => {
    const { container } = renderFactsheet({ ...populatedPayload, analyticsUpdating: false });

    expect(container.querySelector(`[data-testid="${UPDATING_TESTID}"]`)).toBeNull();
    expect(container.textContent).not.toContain("Updating with the latest data");
  });

  it("3: sits after the recency line and before the trade-fetch line", () => {
    const withBoth = renderFactsheet({
      ...populatedPayload,
      ...TRADE_FETCH,
      analyticsUpdating: true,
    });
    const line = updatingLine(withBoth.container);
    expect(line).not.toBeNull();
    const recency = recencyLine(withBoth.container);
    expect(recency, "recency line did not render").not.toBeNull();
    expect(line!.previousElementSibling).toBe(recency);
    const next = line!.nextElementSibling;
    expect(next, "trade-fetch line did not render after the updating line").not.toBeNull();
    expect(next!.textContent).toContain("trades fetched");

    // No series, so no recency line: the updating line directly follows the chip.
    const emptySeries = renderFactsheet({ ...emptySeriesPayload, analyticsUpdating: true });
    const lineNoSeries = updatingLine(emptySeries.container);
    expect(lineNoSeries).not.toBeNull();
    expect(recencyLine(emptySeries.container)).toBeNull();
    expect(chipRoot(emptySeries.container).nextElementSibling).toBe(lineNoSeries);
  });

  it("4: leaves the chip/recency pairing intact (F-1) and the chip byte-identical (F-4)", () => {
    const on = renderFactsheet({ ...populatedPayload, analyticsUpdating: true });
    const off = renderFactsheet({ ...populatedPayload, analyticsUpdating: false });

    const recency = recencyLine(on.container);
    expect(recency).not.toBeNull();
    expect(chipRoot(on.container).nextElementSibling).toBe(recency);
    const line = updatingLine(on.container);
    expect(line, "updating line did not render").not.toBeNull();
    expect(chipRoot(on.container).contains(line)).toBe(false);

    expect(chipRoot(on.container).outerHTML).toBe(chipRoot(off.container).outerHTML);
  });

  it("5: carries no live region, no ARIA, and no screen-reader duplicate", () => {
    const { container } = renderFactsheet({ ...populatedPayload, analyticsUpdating: true });

    const line = updatingLine(container);
    expect(line).not.toBeNull();
    expect(line!.getAttribute("role")).toBeNull();
    expect(line!.getAttribute("aria-live")).toBeNull();
    expect(line!.getAttribute("aria-label")).toBeNull();

    const carriers = Array.from(container.querySelectorAll("*")).filter(
      (el) =>
        Array.from(el.childNodes).some(
          (n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? "").includes(UPDATING_COPY),
        ),
    );
    expect(carriers).toHaveLength(1);
    expect(carriers[0]).toBe(line);
  });
});
