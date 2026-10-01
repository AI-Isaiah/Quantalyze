/** @vitest-environment jsdom */
/**
 * 169.1 review-fix E (SFH-R2 MEDIUM-1, part b): the "Cumulative Returns —
 * Volatility Matched" panel is hidden when the active comparator has nothing to
 * match, as it already is when no comparator is selected.
 *
 * Why this matters: since review-fix D (strategy side) and fix E part a
 * (comparator side), a comparator block whose strategy or comparator vol is not
 * finite and > 0 carries `volMatched: null`. `resolveSeries` then pushes no
 * comparator series, so the panel kept its title and its "comparator returns
 * scaled so its ann vol equals the strategy's" subtitle while drawing the
 * strategy line alone. That chart looks real and says nothing about the skipped
 * match. It is the same degenerate panel the 2026-05-20 rule already filters for
 * `cmpKey === "none"`, for the same reason: it is the Equity Curve again.
 *
 * Where the comparator has covered returns (a summary), a one-line reason panel
 * takes its place, the same pattern as the "Rolling β — Not enough data" panel
 * beside it. A comparator with no summary (prices unavailable, the composer's
 * inert block) is hidden without it.
 *
 * The filter reads the BASIS VIEW's block, the one TimeSeriesChart draws, not
 * the cash payload's. The strategy-side null shows up on the MTM and smoothed
 * bundles (an active-day basis with fewer than two non-zero days), so the third
 * case gives the cash block a real series and only the MTM bundle a null one. A
 * filter that read the payload block would keep the panel there and fail it.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, within } from "@testing-library/react";
import { buildFactsheetPayload } from "@/lib/factsheet/build-payload";
import type { FactsheetPayload } from "@/lib/factsheet/types";
import { FactsheetProvider } from "./factsheet-context";
import { FactsheetBody } from "./FactsheetView";

vi.mock("@/lib/sentry-capture", () => ({ captureToSentry: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

const lsStore = new Map<string, string>();
beforeEach(() => {
  lsStore.clear();
  vi.stubGlobal("localStorage", {
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
  });
});

const TITLE = "Cumulative Returns — Volatility Matched";
const REASON_TITLE = "Volatility Matched — Not available";
const DAY = 86_400_000;
const START = Date.UTC(2024, 0, 1);

/** 200 consecutive calendar days from 2024-01-01, inside every bundled fixture. */
function payload200(): FactsheetPayload {
  const points = Array.from({ length: 200 }, (_, i) => ({
    date: new Date(START + i * DAY).toISOString().slice(0, 10),
    value: Math.sin(i / 9) * 0.005,
  }));
  const built = buildFactsheetPayload(
    {
      id: "volmatched-panel-test",
      name: "Vol Matched Panel Test",
      types: ["test"],
      markets: ["crypto"],
      computedAt: "2026-10-01T00:00:00Z",
      trustTier: null,
      ingestSource: "api",
    },
    points,
  );
  if (!built) throw new Error("buildFactsheetPayload returned null in test");
  return built;
}

/** The comparators with the ACTIVE block's vol-matched series withdrawn. */
function withoutVolMatch(p: FactsheetPayload): FactsheetPayload["comparators"] {
  const key = p.activeComparator;
  return {
    ...p.comparators,
    [key]: { ...p.comparators[key], volMatched: null, volMatchedLabel: null },
  };
}

function renderBody(payload: FactsheetPayload) {
  return render(
    <FactsheetProvider payload={payload} persist={false}>
      <FactsheetBody payload={payload} hideHeader hideAllocatorSection hideFooter={false} />
    </FactsheetProvider>,
  );
}

describe("the Volatility Matched panel hides when there is nothing to match (169.1 fix E)", () => {
  it("control: a comparator with a real vol-matched series shows the panel", () => {
    const payload = payload200();
    expect(payload.activeComparator).not.toBe("none");
    // The fixture must carry a real match, or the absence cases below prove nothing.
    expect(Array.isArray(payload.comparators[payload.activeComparator].volMatched)).toBe(true);
    const { queryByText } = renderBody(payload);
    expect(queryByText(TITLE)).not.toBeNull();
    expect(queryByText(REASON_TITLE)).toBeNull();
  });

  it("a selected comparator whose volMatched is null does not render the panel, and says why", () => {
    const base = payload200();
    const payload = { ...base, comparators: withoutVolMatch(base) } as FactsheetPayload;
    // The comparator has covered returns (a summary), so the reason applies.
    expect(payload.comparators[payload.activeComparator].summary).not.toBeNull();
    const { queryByText } = renderBody(payload);
    expect(queryByText(TITLE)).toBeNull();
    expect(queryByText(REASON_TITLE)).not.toBeNull();
    expect(queryByText(/no measurable volatility on this basis/)).not.toBeNull();
  });

  it("a comparator with no summary (prices unavailable) hides the panel without the volatility reason", () => {
    // The unavailable form: every series null and no summary. The picker names
    // this case already, and "no measurable volatility" would misstate it.
    const base = payload200();
    const key = base.activeComparator;
    const payload = {
      ...base,
      comparators: {
        ...base.comparators,
        [key]: { ...base.comparators[key], summary: null, volMatched: null, volMatchedLabel: null },
      },
    } as FactsheetPayload;
    const { queryByText } = renderBody(payload);
    expect(queryByText(TITLE)).toBeNull();
    expect(queryByText(REASON_TITLE)).toBeNull();
  });

  it("the filter follows the basis view: a null volMatched on the MTM bundle only hides the panel on MTM", () => {
    const base = payload200();
    const payload = {
      ...base,
      mtmGate: { available: true },
      metricsByBasis: { mark_to_market: {} },
      // The MTM bundle is the cash series with only `comparators` changed, so the
      // panel's presence can differ between the bases for that one reason.
      seriesByBasis: { mark_to_market: { ...base, comparators: withoutVolMatch(base) } },
    } as unknown as FactsheetPayload;
    const { container, queryByText } = renderBody(payload);
    // Cash: the cash block has a real match, so the panel is there.
    expect(queryByText(TITLE)).not.toBeNull();
    expect(queryByText(REASON_TITLE)).toBeNull();
    const group = container.querySelector('[role="group"][aria-label="Metrics basis"]');
    expect(group, "the basis toggle").not.toBeNull();
    fireEvent.click(within(group as HTMLElement).getByText("Mark-to-market"));
    expect(queryByText(TITLE)).toBeNull();
    expect(queryByText(REASON_TITLE)).not.toBeNull();
  });
});
