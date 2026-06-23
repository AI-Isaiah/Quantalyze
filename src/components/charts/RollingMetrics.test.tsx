import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { RollingMetrics } from "./RollingMetrics";

// Recharts in jsdom has zero width/height in the ResponsiveContainer which
// means the internal chart tree never renders, so we can't observe child
// components like ReferenceLine via real rendering. Replace the whole
// recharts module with plain-div stand-ins so children pass through and
// can be queried directly.
vi.mock("recharts", () => {
  function makePassthrough(name: string) {
    const Component = ({ children }: { children?: React.ReactNode }) => (
      <div data-recharts={name}>{children}</div>
    );
    Component.displayName = `RechartsMock(${name})`;
    return Component;
  }
  const NullComponent = () => null;
  NullComponent.displayName = "RechartsMockNull";
  const RefLine = ({ y, label }: { y: number; label?: { value?: string } }) => (
    <div data-testid="ref-line" data-y={y} data-label={label?.value ?? ""} />
  );
  RefLine.displayName = "RechartsMockReferenceLine";
  // WR-01 — the real Legend/Tooltip invoke their `formatter` to derive the
  // visible series text. Tooltip in jsdom never opens (no hover geometry) and
  // Legend would need a `payload`, so we invoke the formatters directly with the
  // chart's data keys and render their output. This lets a test OBSERVE the
  // user-visible label (the thing WR-01 is about) without recharts internals.
  // Existing tests never query these testids, so they are unaffected.
  const Legend = ({
    formatter,
  }: {
    formatter?: (name: string) => React.ReactNode;
  }) => <div data-testid="legend">{formatter ? formatter("sharpe_365d") : null}</div>;
  Legend.displayName = "RechartsMockLegend";
  const Tooltip = ({
    formatter,
  }: {
    formatter?: (value: number, name: string) => [string, React.ReactNode];
  }) => (
    <div data-testid="tooltip">
      {formatter ? formatter(0.5, "sharpe_365d")[1] : null}
    </div>
  );
  Tooltip.displayName = "RechartsMockTooltip";
  return {
    ResponsiveContainer: makePassthrough("ResponsiveContainer"),
    LineChart: makePassthrough("LineChart"),
    Line: NullComponent,
    XAxis: NullComponent,
    YAxis: NullComponent,
    Tooltip,
    Legend,
    ReferenceLine: RefLine,
  };
});

const sampleData = {
  sharpe_30d: [
    { date: "2024-01-01", value: 0.5 },
    { date: "2024-01-02", value: 0.6 },
  ],
};

// WR-01 — the blend panel's single accent-keyed Rolling-Sharpe series.
const sampleData365 = {
  sharpe_365d: [
    { date: "2024-01-01", value: 0.5 },
    { date: "2024-01-02", value: 0.6 },
  ],
};

describe("RollingMetrics overallSharpe prop", () => {
  it("omits ReferenceLine when overallSharpe is undefined", () => {
    render(<RollingMetrics data={sampleData} />);
    expect(screen.queryByTestId("ref-line")).toBeNull();
  });

  it("omits ReferenceLine when overallSharpe is null", () => {
    render(<RollingMetrics data={sampleData} overallSharpe={null} />);
    expect(screen.queryByTestId("ref-line")).toBeNull();
  });

  it("omits ReferenceLine when overallSharpe is NaN and shows unavailable caption (P71)", () => {
    render(<RollingMetrics data={sampleData} overallSharpe={NaN} />);
    expect(screen.queryByTestId("ref-line")).toBeNull();
    expect(
      screen.getByText("Long-run Sharpe unavailable for this strategy"),
    ).toBeDefined();
  });

  it("omits ReferenceLine when overallSharpe is Infinity and shows unavailable caption (P71)", () => {
    render(<RollingMetrics data={sampleData} overallSharpe={Infinity} />);
    expect(screen.queryByTestId("ref-line")).toBeNull();
    expect(
      screen.getByText("Long-run Sharpe unavailable for this strategy"),
    ).toBeDefined();
  });

  it("does NOT show the unavailable caption when overallSharpe is null (P71 silent path)", () => {
    render(<RollingMetrics data={sampleData} overallSharpe={null} />);
    expect(
      screen.queryByText("Long-run Sharpe unavailable for this strategy"),
    ).toBeNull();
  });

  it("does NOT show the unavailable caption when overallSharpe is undefined (P71 silent path)", () => {
    render(<RollingMetrics data={sampleData} />);
    expect(
      screen.queryByText("Long-run Sharpe unavailable for this strategy"),
    ).toBeNull();
  });

  it("renders ReferenceLine with y=0 when overallSharpe is literally 0 (finite)", () => {
    render(<RollingMetrics data={sampleData} overallSharpe={0} />);
    expect(screen.getByTestId("ref-line").getAttribute("data-y")).toBe("0");
  });

  it("renders ReferenceLine with the supplied value and avg label", () => {
    render(<RollingMetrics data={sampleData} overallSharpe={1.23} />);
    const line = screen.getByTestId("ref-line");
    expect(line.getAttribute("data-y")).toBe("1.23");
    expect(line.getAttribute("data-label")).toBe("avg");
  });

  it("does NOT show the unavailable caption when overallSharpe is finite", () => {
    render(<RollingMetrics data={sampleData} overallSharpe={1.23} />);
    expect(
      screen.queryByText("Long-run Sharpe unavailable for this strategy"),
    ).toBeNull();
  });

  it("returns null entirely when data is empty, regardless of overallSharpe", () => {
    const { container } = render(<RollingMetrics data={{}} overallSharpe={1.5} />);
    expect(container.firstChild).toBeNull();
  });
});

describe("RollingMetrics min-history gate (P69)", () => {
  it("suppresses ReferenceLine and shows insufficient-history caption at 364 days", () => {
    render(
      <RollingMetrics
        data={sampleData}
        overallSharpe={1.5}
        daysOfHistory={364}
      />,
    );
    expect(screen.queryByTestId("ref-line")).toBeNull();
    // Uses insufficientHistoryMessage("long-run Sharpe reference", 365, 364)
    const caption = screen.getByText(
      /Insufficient history for institutional-grade long-run Sharpe reference/,
    );
    expect(caption.textContent).toContain("have 364 days");
    expect(caption.textContent).toContain("need 365");
  });

  it("renders ReferenceLine at exactly 365 days (threshold met)", () => {
    render(
      <RollingMetrics
        data={sampleData}
        overallSharpe={1.5}
        daysOfHistory={365}
      />,
    );
    expect(screen.getByTestId("ref-line").getAttribute("data-y")).toBe("1.5");
    expect(
      screen.queryByText(
        /Insufficient history for institutional-grade long-run Sharpe reference/,
      ),
    ).toBeNull();
  });

  it("renders ReferenceLine when daysOfHistory is omitted (gate skipped)", () => {
    render(<RollingMetrics data={sampleData} overallSharpe={1.5} />);
    expect(screen.getByTestId("ref-line").getAttribute("data-y")).toBe("1.5");
  });

  it("does NOT show insufficient-history caption when overallSharpe is null even on thin history", () => {
    render(
      <RollingMetrics
        data={sampleData}
        overallSharpe={null}
        daysOfHistory={30}
      />,
    );
    expect(
      screen.queryByText(
        /Insufficient history for institutional-grade long-run Sharpe reference/,
      ),
    ).toBeNull();
  });

  it("prefers the unavailable caption over the history caption when sharpe is NaN AND history is thin", () => {
    render(
      <RollingMetrics
        data={sampleData}
        overallSharpe={NaN}
        daysOfHistory={30}
      />,
    );
    expect(screen.queryByTestId("ref-line")).toBeNull();
    expect(
      screen.getByText("Long-run Sharpe unavailable for this strategy"),
    ).toBeDefined();
    expect(
      screen.queryByText(
        /Insufficient history for institutional-grade long-run Sharpe reference/,
      ),
    ).toBeNull();
  });
});

describe("RollingMetrics seriesLabels override (WR-01)", () => {
  // The blend Rolling-Sharpe series is keyed `sharpe_365d` ONLY so it resolves
  // the CHART_ACCENT stroke via STROKE_BY_KEY. Its real window is selectable
  // (63/126/252). Without an override, the default LABELS lookup mislabels a
  // 6-month line as "365d" in BOTH the legend and the tooltip — a factsheet
  // honesty defect (WR-01). The override must drive the visible text to the
  // true window while leaving the accent-key untouched.
  it("legend text reflects the seriesLabels override, not the default 365d", () => {
    render(
      <RollingMetrics
        data={sampleData365}
        seriesLabels={{ sharpe_365d: "126d" }}
      />,
    );
    const legend = screen.getByTestId("legend");
    expect(legend.textContent).toBe("126d");
    // Falsifiable: drops to "365d" if the override is ignored (pre-WR-01 bug).
    expect(legend.textContent).not.toBe("365d");
  });

  it("tooltip text reflects the seriesLabels override, not the default 365d", () => {
    render(
      <RollingMetrics
        data={sampleData365}
        seriesLabels={{ sharpe_365d: "126d" }}
      />,
    );
    const tooltip = screen.getByTestId("tooltip");
    expect(tooltip.textContent).toBe("126d");
    expect(tooltip.textContent).not.toBe("365d");
  });

  it("falls back to the default LABELS map when seriesLabels is omitted (existing callers unchanged)", () => {
    render(<RollingMetrics data={sampleData365} />);
    expect(screen.getByTestId("legend").textContent).toBe("365d");
    expect(screen.getByTestId("tooltip").textContent).toBe("365d");
  });
});
