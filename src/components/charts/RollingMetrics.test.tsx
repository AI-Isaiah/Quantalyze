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
  return {
    ResponsiveContainer: makePassthrough("ResponsiveContainer"),
    LineChart: makePassthrough("LineChart"),
    Line: NullComponent,
    XAxis: NullComponent,
    YAxis: NullComponent,
    Tooltip: NullComponent,
    Legend: NullComponent,
    ReferenceLine: RefLine,
  };
});

const sampleData = {
  sharpe_30d: [
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

  it("omits ReferenceLine when overallSharpe is NaN", () => {
    render(<RollingMetrics data={sampleData} overallSharpe={NaN} />);
    expect(screen.queryByTestId("ref-line")).toBeNull();
  });

  it("omits ReferenceLine when overallSharpe is Infinity", () => {
    render(<RollingMetrics data={sampleData} overallSharpe={Infinity} />);
    expect(screen.queryByTestId("ref-line")).toBeNull();
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

  it("returns null entirely when data is empty, regardless of overallSharpe", () => {
    const { container } = render(<RollingMetrics data={{}} overallSharpe={1.5} />);
    expect(container.firstChild).toBeNull();
  });
});
