import { describe, it, expect, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { CVAR_MIN_OBS } from "@/lib/figure-conventions";
import { VarExpectedShortfall } from "./VarExpectedShortfall";
import type { TimeframeKey } from "../../lib/types";

vi.mock("@/lib/sentry-capture", () => ({ captureToSentry: vi.fn() }));

const base = { timeframe: "1YTD" as TimeframeKey, width: 0, height: 0 };

describe("VarExpectedShortfall — withWidgetBoundary wiring", () => {
  it("renders the shared error card when data fails the schema", () => {
    render(<VarExpectedShortfall data={{ strategies: 123 }} {...base} />);
    expect(screen.getByRole("alert")).toBeTruthy();
  });

  it("renders the widget for a valid composite payload", () => {
    const compositeReturns = Array.from({ length: 30 }, (_, i) => ({
      date: `2026-02-${String((i % 27) + 1).padStart(2, "0")}`,
      value: i % 4 === 0 ? -0.03 : 0.012,
    }));
    render(
      <VarExpectedShortfall
        data={{ strategies: [], analytics: null, compositeReturns }}
        {...base}
      />,
    );
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByTestId("var-expected-shortfall")).toBeTruthy();
  });
});

/**
 * Phase 236 FIG-03 (F-6, CONTEXT Q2 "Total record only"): the book's CVaR (ES95) is the dash below
 * CVAR_MIN_OBS = 60 observations of its TOTAL return record, while VaR still shows (F-6 names CVaR
 * only), and the n<10 insufficient state is kept. Every figure below is derived by hand from the
 * series' definition, never read back from the widget:
 *   - the series repeats [-0.03, 0.012, 0.012, 0.012] (a -3% day every 4th day);
 *   - n = 30: 8 losing days, k = floor(0.05 * 30) = 1, VaR95 = sorted[1] = -0.03 -> "-3.00%".
 */
function bookReturns(n: number) {
  let t = Date.parse("2026-01-01T00:00:00Z");
  return Array.from({ length: n }, (_, i) => {
    const row = { date: new Date(t).toISOString().slice(0, 10), value: i % 4 === 0 ? -0.03 : 0.012 };
    t += 86_400_000;
    return row;
  });
}

function renderBook(n: number) {
  return render(
    <VarExpectedShortfall
      data={{ strategies: [], analytics: null, compositeReturns: bookReturns(n) }}
      {...base}
    />,
  );
}

/** The value cell printed above a metric label. */
function cellAbove(label: RegExp): string {
  const cell = screen.getByText(label).closest("div.text-center") as HTMLElement;
  return within(cell).getByText(/%$|^—$/, { selector: "div.font-metric" }).textContent ?? "";
}

describe("VarExpectedShortfall - the CVaR floor on the total record (236 FIG-03)", () => {
  it("30 returns: VaR95 and VaR99 show, ES95 is the dash", () => {
    renderBook(30);
    expect(screen.queryByText("Insufficient return data for VaR calculation")).toBeNull();
    expect(cellAbove(/^VaR 95%$/)).toBe("-3.00%");
    expect(cellAbove(/^VaR 99%$/)).toBe("-3.00%");
    expect(cellAbove(/CVaR 95%/)).toBe("\u2014");
  });

  it("60 returns: ES95 shows, the mean of the 3 smallest = -3.00%", () => {
    // n = 60 is at the floor: k = floor(0.05 * 60) = 3 and the 3 smallest are -0.03 each.
    renderBook(60);
    expect(cellAbove(/CVaR 95%/)).toBe("-3.00%");
  });

  it("59 returns: ES95 is still the dash, one under the floor", () => {
    renderBook(59);
    expect(cellAbove(/CVaR 95%/)).toBe("\u2014");
  });

  it("the dash carries the floor note derived from CVAR_MIN_OBS, and a shown ES95 carries none (SFH #8)", () => {
    renderBook(CVAR_MIN_OBS - 1);
    expect(screen.getByTestId("cvar-floor-note").textContent).toBe(`Needs ${CVAR_MIN_OBS} observations`);
    cleanup();
    renderBook(CVAR_MIN_OBS);
    expect(screen.queryByTestId("cvar-floor-note")).toBeNull();
  });

  it("5 returns keeps the insufficient state", () => {
    renderBook(5);
    expect(screen.getByText("Insufficient return data for VaR calculation")).toBeTruthy();
  });
});
