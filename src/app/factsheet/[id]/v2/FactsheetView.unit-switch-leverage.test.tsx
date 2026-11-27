import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, act } from "@testing-library/react";
import { useEffect } from "react";
import type { DailyPoint } from "@/lib/portfolio-math-utils";
import type { FactsheetPayload } from "@/lib/factsheet/types";
import { buildScenarioFactsheetPayload } from "@/app/(dashboard)/allocations/widgets/performance/scenario-factsheet-payload";
import { parseUnitSwitch, unitSwitchLeverageReason, type UnitSegmentsView, type UnitSwitchView } from "@/lib/factsheet/unit-segments";
import { FactsheetProvider } from "./factsheet-context";
import { FactsheetBody } from "./FactsheetView";
import { useLeverage } from "./leverage-context";

/**
 * Phase 256 (OKXUNITSWITCH) plan 07, UI-SPEC surface table "Leverage control": a switched
 * strategy's leverage is held at 1x, the way the USD view's is (164.6.6.2.1 D-16).
 *
 * The intent: the headline USD series of a switched strategy contains a part converted from the
 * coin, so scaling it by L would also lever the coin price leg. The hold must therefore work at the
 * CONTEXT, not only on the input: a consumer that tries to set leverage (here a probe mounted in the
 * body, standing for any view hook or a URL-restored value) must still read 1, and every figure and
 * curve must equal the 1x render byte for byte. A payload without a switch must keep today's control.
 * Pre-fix (origin/main) the input is live, `Reset 1×` can appear and L moves every figure.
 */

vi.mock("@/lib/sentry-capture", () => ({ captureToSentry: vi.fn() }));

const lsStore = new Map<string, string>();
beforeEach(() => {
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => lsStore.get(k) ?? null,
    setItem: (k: string, v: string) => void lsStore.set(k, v),
    removeItem: (k: string) => void lsStore.delete(k),
    clear: () => lsStore.clear(),
    key: () => null,
    length: 0,
  });
});

function series(n: number): DailyPoint[] {
  const d = new Date(Date.UTC(2023, 0, 1));
  return Array.from({ length: n }, (_, i) => {
    const date = d.toISOString().slice(0, 10);
    d.setUTCDate(d.getUTCDate() + 1);
    return { date, value: 0.0015 + Math.sin(i * 0.27) * 0.005 };
  });
}

const N = 300;
const S_IDX = 280;

function plainPayload(): FactsheetPayload {
  const p = buildScenarioFactsheetPayload({ portfolioDaily: series(N), benchmark: null });
  return { ...p, periodsPerYear: 365 } as FactsheetPayload;
}

function switchedPayload(): FactsheetPayload {
  const p = plainPayload();
  const sw = parseUnitSwitch({
    coin: "BTC",
    last_usd_day: p.dates[S_IDX],
    first_coin_return_day: p.dates[S_IDX + 1],
  }) as UnitSwitchView;
  expect(sw, "the fixture switch must parse").not.toBeNull();
  const segs: UnitSegmentsView = {
    fromReturns: p.dates.slice(0, S_IDX + 1).map((date, i) => ({ date, value: p.strategyReturns[i] })),
    toReturns: p.dates.slice(S_IDX + 1).map((date) => ({ date, value: 0.004 })),
    baseDay: p.dates[S_IDX],
    unpricedDays: [],
    withheldDays: [],
  };
  return { ...p, unitSwitch: sw, unitSegments: segs } as FactsheetPayload;
}

/** What a consumer of the leverage context reads and what it tries to write (a view hook, a restored value). */
let seen: number | null = null;
function LeverageProbe({ attempt }: { attempt: number | null }) {
  const { leverage, setLeverage } = useLeverage();
  // Recorded after every commit, so `seen` is the value the context held once the attempt settled.
  useEffect(() => {
    seen = leverage;
  });
  useEffect(() => {
    if (attempt != null) setLeverage(attempt);
  }, [attempt, setLeverage]);
  return null;
}

function renderBody(payload: FactsheetPayload, attempt: number | null = null) {
  seen = null;
  return render(
    <FactsheetProvider payload={payload} persist={false}>
      <FactsheetBody payload={payload} topSlot={<LeverageProbe attempt={attempt} />} />
    </FactsheetProvider>,
  );
}

const levInput = (c: HTMLElement) => c.querySelector<HTMLInputElement>("#leverage-factsheet");
const REASON = '[data-testid="factsheet-unit-switch-leverage-reason"]';

describe("FactsheetView: leverage held at 1x for a switched strategy", () => {
  it("the input is aria-disabled, readOnly, shows 1, is greyed, keeps its tab stop, and there is no Reset 1×", () => {
    const { container, queryByText } = renderBody(switchedPayload());
    const input = levInput(container)!;
    expect(input, "the control stays in the DOM").not.toBeNull();
    expect(input.getAttribute("aria-disabled")).toBe("true");
    expect(input.readOnly).toBe(true);
    expect(input.value).toBe("1");
    expect(input.className).toContain("opacity-60");
    expect(input.className).toContain("cursor-not-allowed");
    // The tab stop is kept: a screen-reader user can reach the control and hear why it is off.
    expect(input.hasAttribute("tabindex")).toBe(false);
    expect(input.disabled).toBe(false);
    expect(queryByText("Reset 1×")).toBeNull();
  });

  it("renders the reason line from the template, naming the coin", () => {
    const payload = switchedPayload();
    const { container } = renderBody(payload);
    const reason = container.querySelector(REASON)!;
    expect(reason.textContent).toBe(unitSwitchLeverageReason(payload.unitSwitch as UnitSwitchView));
    expect(reason.textContent).toBe(
      "Leverage is off for this strategy: its USD figures include a part converted from BTC, so leverage would also lever BTC.",
    );
  });

  it("typing a leverage into the input changes nothing: it stays 1 and the body equals the 1x render", () => {
    const base = renderBody(switchedPayload());
    const baseHtml = base.container.innerHTML;
    act(() => {
      fireEvent.change(levInput(base.container)!, { target: { value: "3" } });
    });
    expect(levInput(base.container)!.value).toBe("1");
    expect(base.container.innerHTML).toBe(baseHtml);
  });

  it("a consumer that sets leverage 3 still reads 1, and every KPI, chart and caption equals the 1x render byte for byte", () => {
    const oneX = renderBody(switchedPayload());
    const oneXHtml = oneX.container.innerHTML;
    expect(seen).toBe(1);
    oneX.unmount();

    const attempted = renderBody(switchedPayload(), 3);
    expect(seen, "the context a consumer reads is held at 1").toBe(1);
    expect(attempted.container.innerHTML).toBe(oneXHtml);
    expect(attempted.container.innerHTML).not.toContain("What-if projection");
  });

  it("without a switch the control is today's: live, no reason line, and a set leverage is read and applied", () => {
    const { container, queryByText } = renderBody(plainPayload());
    const input = levInput(container)!;
    expect(input.getAttribute("aria-disabled")).toBeNull();
    expect(input.readOnly).toBe(false);
    expect(input.className).not.toContain("cursor-not-allowed");
    expect(container.querySelector(REASON)).toBeNull();
    expect(container.innerHTML).not.toContain("Leverage is off for this strategy");
    expect(queryByText("Reset 1×")).toBeNull();

    const attempted = renderBody(plainPayload(), 3);
    expect(seen).toBe(3);
    expect(attempted.container.innerHTML).toContain("What-if projection");
  });
});
