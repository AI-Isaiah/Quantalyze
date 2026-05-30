import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { z } from "zod";
import { withWidgetBoundary, type BaseWidgetProps } from "./widget-boundary";
import type { TimeframeKey } from "../../lib/types";

vi.mock("@/lib/sentry-capture", () => ({ captureToSentry: vi.fn() }));
import { captureToSentry } from "@/lib/sentry-capture";

const schema = z.object({ value: z.number() });
type Data = z.infer<typeof schema>;

function Inner({ data }: { data: Data } & BaseWidgetProps) {
  return <div data-testid="inner">value={data.value}</div>;
}

const base = { timeframe: "1YTD" as TimeframeKey, width: 0, height: 0 };

describe("withWidgetBoundary", () => {
  beforeEach(() => vi.clearAllMocks());

  it("valid data renders the inner widget with typed data", () => {
    const W = withWidgetBoundary(schema, Inner, { area: "test-valid" });
    render(<W data={{ value: 42 }} {...base} />);
    expect(screen.getByTestId("inner").textContent).toContain("value=42");
    expect(captureToSentry).not.toHaveBeenCalled();
  });

  it("non-null malformed data renders the error state and reports once", () => {
    const W = withWidgetBoundary(schema, Inner, { area: "test-invalid" });
    render(<W data={{ value: "nope" }} {...base} />);
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.queryByTestId("inner")).toBeNull();
    expect(captureToSentry).toHaveBeenCalledTimes(1);
  });

  it("null data does not report (the not-loaded-yet path)", () => {
    const W = withWidgetBoundary(schema, Inner, { area: "test-null" });
    render(<W data={null} {...base} />);
    expect(captureToSentry).not.toHaveBeenCalled();
    // schema-invalid (null is not the object shape) → default error state
    expect(screen.getByRole("alert")).toBeTruthy();
  });

  it("onInvalid='empty' shows the empty state instead of error", () => {
    const W = withWidgetBoundary(schema, Inner, {
      area: "test-empty",
      onInvalid: "empty",
      empty: { title: "Warming up" },
    });
    render(<W data={{ value: "x" }} {...base} />);
    expect(screen.getByText("Warming up")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("contains an inner render throw via the error boundary", () => {
    const Boom = (_props: { data: Data } & BaseWidgetProps) => {
      throw new Error("boom");
    };
    const W = withWidgetBoundary(schema, Boom, { area: "test-throw" });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    render(<W data={{ value: 1 }} {...base} />);
    expect(screen.getByRole("alert")).toBeTruthy();
    spy.mockRestore();
  });

  it("recovers from a contained throw when data changes (resetKey)", () => {
    const Cond = ({ data }: { data: Data } & BaseWidgetProps) => {
      if (data.value < 0) throw new Error("neg");
      return <div data-testid="ok">ok-{data.value}</div>;
    };
    const W = withWidgetBoundary(schema, Cond, { area: "test-reset" });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { rerender } = render(<W data={{ value: -1 }} {...base} />);
    expect(screen.getByRole("alert")).toBeTruthy();
    rerender(<W data={{ value: 5 }} {...base} />);
    expect(screen.getByTestId("ok").textContent).toContain("ok-5");
    spy.mockRestore();
  });
});
