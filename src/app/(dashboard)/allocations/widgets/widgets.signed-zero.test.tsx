import { describe, it, expect, vi } from "vitest";
import { render, fireEvent, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type { DailyPoint } from "@/lib/portfolio-math-utils";

import EquityChartWidget, { EquityChart } from "./performance/EquityChart";
import { formatDrawdownTick, formatDrawdownTooltip } from "./performance/DrawdownChart";
import { TailRisk, tailBinLabel } from "./risk/TailRisk";
import { CorrelationMatrix } from "./risk/CorrelationMatrix";
import { formatRiskContribution, riskContributionFill } from "./risk/RiskDecomposition";
import { VarExpectedShortfall } from "./risk/VarExpectedShortfall";

// ---------------------------------------------------------------------------
// Phase 170.6 DISPLAYPOLISH plan 08 (D-02, D-03, D-06) — the allocations
// performance and risk widgets print and colour on the ROUNDED sign.
//
// Every expectation below is typed by hand. None is computed by the code under
// test. A figure that rounds to zero at the precision it prints is unsigned and
// neutral; a non-zero figure prints the digits it printed before.
// ---------------------------------------------------------------------------

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    refresh: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    prefetch: vi.fn(),
  }),
}));

/** `n` daily points, value 1 everywhere except the final one. */
function flatThenLast(n: number, last: number): DailyPoint[] {
  const pts: DailyPoint[] = [];
  const d = new Date(Date.UTC(2024, 0, 1));
  for (let i = 0; i < n; i++) {
    pts.push({ date: d.toISOString().slice(0, 10), value: i === n - 1 ? last : 1 });
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return pts;
}

/** The value span of the always-visible "Return over {period}" summary. */
function returnValueSpan(label: RegExp | string): HTMLElement {
  const wrapper = screen.getByLabelText(label);
  const spans = wrapper.querySelectorAll("span");
  return spans[spans.length - 1] as HTMLElement;
}

describe("allocations EquityChart — period return label (header)", () => {
  it("a window return of -0.00004 prints 0.00% in neither the positive nor the negative colour", () => {
    render(<EquityChart equityDailyPoints={flatThenLast(30, 0.99996)} initialPeriod="ALL" />);
    const span = returnValueSpan("Return over ALL");
    expect(span.textContent).toBe("0.00%");
    expect(span.style.color).not.toBe("var(--color-positive)");
    expect(span.style.color).not.toBe("var(--color-negative)");
  });

  it("a window return of +0.0123 prints +1.23% in the positive colour", () => {
    render(<EquityChart equityDailyPoints={flatThenLast(30, 1.0123)} initialPeriod="ALL" />);
    const span = returnValueSpan("Return over ALL");
    expect(span.textContent).toBe("+1.23%");
    expect(span.style.color).toBe("var(--color-positive)");
  });

  it("a window return of -0.0123 prints -1.23% in the negative colour", () => {
    render(<EquityChart equityDailyPoints={flatThenLast(30, 0.9877)} initialPeriod="ALL" />);
    const span = returnValueSpan("Return over ALL");
    expect(span.textContent).toBe("-1.23%");
    expect(span.style.color).toBe("var(--color-negative)");
  });
});

describe("allocations EquityChart — y ticks", () => {
  it("the baseline tick reads 0% and no tick reads +0% or -0%", () => {
    const { container } = render(
      <EquityChart equityDailyPoints={flatThenLast(30, 1.1)} initialPeriod="ALL" />,
    );
    const labels = Array.from(container.querySelectorAll("svg text")).map((t) => t.textContent ?? "");
    expect(labels).toContain("0%");
    expect(labels).not.toContain("+0%");
    expect(labels).not.toContain("-0%");
  });

  it("a non-zero tick keeps its sign and digits: a rising window has +5.0% and a falling one has -20%", () => {
    const up = render(<EquityChart equityDailyPoints={flatThenLast(30, 1.1)} initialPeriod="ALL" />);
    const upLabels = Array.from(up.container.querySelectorAll("svg text")).map((t) => t.textContent ?? "");
    expect(upLabels).toContain("+5.0%");
    up.unmount();
    const down = render(<EquityChart equityDailyPoints={flatThenLast(30, 0.6)} initialPeriod="ALL" />);
    const downLabels = Array.from(down.container.querySelectorAll("svg text")).map((t) => t.textContent ?? "");
    expect(downLabels).toContain("-20%");
  });
});

describe("allocations EquityChart — hover legend row", () => {
  it("a Portfolio row at -0.004 percent units prints 0.00% with no positive or negative colour", () => {
    const { container } = render(
      <EquityChart equityDailyPoints={flatThenLast(30, 0.99996)} initialPeriod="ALL" hideHeader />,
    );
    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
    fireEvent.mouseMove(svg!, { clientX: 960, clientY: 40 });
    // The tooltip: its first child is the date, its second the Portfolio row.
    const tooltip = screen.getByText("Jan 30, 2024").parentElement!;
    const value = tooltip.children[1].lastElementChild as HTMLElement;
    expect(value.textContent).toBe("0.00%");
    expect(value.style.color).not.toBe("var(--color-positive)");
    expect(value.style.color).not.toBe("var(--color-negative)");
  });
});

describe("allocations EquityChartWidget — header period chip", () => {
  it("a window return of -0.00004 prints 0.00% and is neither positive nor negative coloured", () => {
    render(
      <EquityChartWidget
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        data={{ equityDailyPoints: flatThenLast(60, 0.99996) } as any}
        timeframe="1YTD"
        width={6}
        height={4}
      />,
    );
    const span = returnValueSpan(/^Return over /);
    expect(span.textContent).toBe("0.00%");
    expect(span.style.color).not.toBe("var(--color-positive)");
    expect(span.style.color).not.toBe("var(--color-negative)");
  });

  it("a window return of +0.0123 prints +1.23% in the positive colour", () => {
    render(
      <EquityChartWidget
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        data={{ equityDailyPoints: flatThenLast(60, 1.0123) } as any}
        timeframe="1YTD"
        width={6}
        height={4}
      />,
    );
    const span = returnValueSpan(/^Return over /);
    expect(span.textContent).toBe("+1.23%");
    expect(span.style.color).toBe("var(--color-positive)");
  });
});

// ---------------------------------------------------------------------------
// Task 2 — drawdown chart, tail risk, correlation matrix, risk decomposition
// ---------------------------------------------------------------------------

describe("allocations DrawdownChart — tick and tooltip text", () => {
  it("a tick at -0.003 reads 0% (0 dp)", () => {
    expect(formatDrawdownTick(-0.003)).toBe("0%");
  });

  it("a tooltip at -0.00004 reads 0.00% (2 dp)", () => {
    expect(formatDrawdownTooltip(-0.00004)).toBe("0.00%");
  });

  it("a non-zero drawdown keeps its sign and digits", () => {
    expect(formatDrawdownTick(-0.2)).toBe("-20%");
    expect(formatDrawdownTooltip(-0.1234)).toBe("-12.34%");
  });
});

describe("allocations TailRisk — P5, P1 and bin labels", () => {
  const base = { timeframe: "1YTD" as const, width: 0, height: 0 };
  // 3 tail events (-3%) then 97 days at -0.04%: P5 interpolates between two -0.0004 values,
  // P1 between a -0.03 and the next -0.03 (sorted ascending, first three are the tail).
  const compositeReturns = Array.from({ length: 100 }, (_, i) => ({
    date: `2026-01-${String((i % 27) + 1).padStart(2, "0")}`,
    value: i < 3 ? -0.03 : -0.0004,
  }));

  it("P5 at -0.0004 reads P5 0.0% and P1 at -0.03 reads P1 -3.0%", () => {
    render(<TailRisk data={{ strategies: [], analytics: null, compositeReturns }} {...base} />);
    const text = screen.getByTestId("tail-risk").textContent ?? "";
    expect(text).toContain("P5 0.0%");
    expect(text).not.toContain("P5 -0.0%");
    expect(text).toContain("P1 -3.0%");
  });

  it("a bin low of -0.0004 reads 0.0% and one of -0.0312 reads -3.1%", () => {
    expect(tailBinLabel(-0.0004)).toBe("0.0%");
    expect(tailBinLabel(-0.0312)).toBe("-3.1%");
  });
});

describe("allocations CorrelationMatrix — cell text, aria-label and unchanged fill", () => {
  const base = { timeframe: "1YTD" as const, width: 0, height: 0 };

  function renderMatrix(corr: number) {
    render(
      <CorrelationMatrix
        data={{
          strategies: [
            { strategy_id: "a", alias: "Alpha" },
            { strategy_id: "b", alias: "Beta" },
          ],
          analytics: { correlation_matrix: { a: { a: 1, b: corr }, b: { a: corr, b: 1 } } },
        }}
        {...base}
      />,
    );
    // Cells in document order: [a,a], [a,b], [b,a], [b,b].
    return screen.getAllByTestId("corr-cell")[1];
  }

  it("a correlation of -0.004 prints 0.00 and its aria-label says 0.00 correlation", () => {
    const cell = renderMatrix(-0.004);
    expect(cell.textContent).toBe("0.00");
    expect(cell.getAttribute("aria-label")).toBe("Alpha and Beta: 0.00 correlation");
  });

  it("the cell FILL for -0.004 is the string it was before this plan (D-06: fills unchanged)", () => {
    // Typed by hand: 255 - 35 * 0.004 = 254.86 -> 255; 255 - 217 * 0.004 = 254.132 -> 254.
    const cell = renderMatrix(-0.004);
    expect(cell.style.backgroundColor).toBe("rgb(255, 254, 254)");
  });

  it("a correlation of -0.45 keeps its sign and digits", () => {
    const cell = renderMatrix(-0.45);
    expect(cell.textContent).toBe("-0.45");
    expect(cell.getAttribute("aria-label")).toBe("Alpha and Beta: -0.45 correlation");
  });
});

describe("allocations RiskDecomposition — tooltip and bar fill", () => {
  it("a contribution of -0.04 (percent units) reads 0.0%, never -0.0%", () => {
    expect(formatRiskContribution(-0.04)).toBe("0.0%");
  });

  it("non-zero contributions keep their sign and digits", () => {
    expect(formatRiskContribution(12.5)).toBe("12.5%");
    expect(formatRiskContribution(-3.2)).toBe("-3.2%");
  });

  it("a rounded-zero contribution is the muted colour, not red; 12.5 is the accent; -3.2 is red", () => {
    expect(riskContributionFill(-0.04)).toBe("#94A3B8");
    expect(riskContributionFill(12.5)).toBe("#1B6B5A");
    expect(riskContributionFill(-3.2)).toBe("#DC2626");
  });
});

// ---------------------------------------------------------------------------
// Task 3 — VaR & Expected Shortfall: red only when the printed figure is below zero
// ---------------------------------------------------------------------------

describe("allocations VarExpectedShortfall — tone follows the printed sign (D-03)", () => {
  const base = { timeframe: "1YTD" as const, width: 0, height: 0 };

  /** 20 composite returns that all equal `value`: VaR 95, VaR 99 and CVaR 95 all equal it. */
  function renderConstant(value: number) {
    const compositeReturns = Array.from({ length: 20 }, (_, i) => ({
      date: `2026-02-${String(i + 1).padStart(2, "0")}`,
      value,
    }));
    render(
      <VarExpectedShortfall
        data={{ strategies: [], analytics: null, compositeReturns }}
        {...base}
      />,
    );
    // The three figures, in order: VaR 95%, VaR 99%, CVaR 95%.
    const cells = screen.getByTestId("var-expected-shortfall").querySelectorAll(".font-metric");
    expect(cells).toHaveLength(3);
    return Array.from(cells) as HTMLElement[];
  }

  it("all returns +0.01: the three figures print +1.00% and none is red; each is the neutral primary text colour", () => {
    const cells = renderConstant(0.01);
    expect(cells.map((c) => c.textContent)).toEqual(["+1.00%", "+1.00%", "+1.00%"]);
    for (const c of cells) {
      expect(c.style.color).not.toBe("rgb(220, 38, 38)");
      expect(c.style.color).toBe("var(--color-text-primary)");
    }
  });

  it("all returns -0.00004: the three figures print a zero and none is red", () => {
    const cells = renderConstant(-0.00004);
    for (const c of cells) {
      // The digits "0.00%" with no minus is plan 02's formatPercent (D-02, utils.ts); this
      // plan owns the colour. The regex holds before and after plan 02 lands; the colour does not.
      expect(c.textContent).toMatch(/^[+-]?0\.00%$/);
      expect(c.style.color).not.toBe("rgb(220, 38, 38)");
      expect(c.style.color).toBe("var(--color-text-primary)");
    }
  });

  it("all returns -0.03: the three figures print -3.00% and each is red", () => {
    const cells = renderConstant(-0.03);
    expect(cells.map((c) => c.textContent)).toEqual(["-3.00%", "-3.00%", "-3.00%"]);
    for (const c of cells) {
      expect(c.style.color).toBe("rgb(220, 38, 38)");
    }
  });
});
