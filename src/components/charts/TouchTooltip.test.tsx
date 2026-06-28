/** @vitest-environment jsdom */
/**
 * Phase 48 / CHART-01b — TouchTooltip breakpoint-gated trigger shim.
 *
 * The shim injects the Recharts `<Tooltip trigger>` from useBreakpoint:
 *   mobile  → "click"  (tap-to-show/pin)
 *   desktop → "hover"  (Recharts default → desktop BYTE-IDENTICAL to today)
 *
 * Test plan — one `it` per BRANCH of the trigger ternary so the coverage
 * ratchet (branches 72, vitest.config.ts) covers this NEW viewport conditional,
 * each arm falsifiable:
 *  1. useBreakpoint()==="mobile"  → rendered <Tooltip> receives trigger="click"
 *  2. useBreakpoint()==="desktop" → rendered <Tooltip> receives trigger="hover"
 *     (the byte-identical-desktop proof — must equal Recharts' own default)
 *  3. tablet (the non-mobile arm via a second value) → trigger="hover"
 *  4. caller props (formatter / contentStyle) spread through to <Tooltip>
 *     unchanged (the shim adds trigger, mutates nothing else)
 *
 * recharts is mocked (jsdom gives ResponsiveContainer zero geometry so the
 * real Tooltip never mounts) with a passthrough that records the props it
 * received onto data-* attributes, mirroring RollingMetrics.test.tsx's mock
 * idiom. useBreakpoint is mocked per-arm, mirroring useTapPin.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

// Mock recharts Tooltip to a div that surfaces the props it received. The real
// Tooltip needs a Recharts chart context + hover geometry that jsdom lacks.
vi.mock("recharts", () => {
  const Tooltip = (props: {
    trigger?: string;
    formatter?: unknown;
    contentStyle?: { fontSize?: number };
  }) => (
    <div
      data-testid="tooltip"
      data-trigger={props.trigger ?? ""}
      data-has-formatter={props.formatter ? "yes" : "no"}
      data-content-fontsize={props.contentStyle?.fontSize ?? ""}
    />
  );
  Tooltip.displayName = "RechartsMockTooltip";
  return { Tooltip };
});

// Mock the single gate. Each test arms its return value.
vi.mock("@/hooks/useBreakpoint", () => ({ useBreakpoint: vi.fn() }));

import { TouchTooltip } from "./TouchTooltip";
import { useBreakpoint } from "@/hooks/useBreakpoint";

const mockedUseBreakpoint = vi.mocked(useBreakpoint);

describe("[CHART-01b] TouchTooltip — breakpoint-gated <Tooltip trigger>", () => {
  beforeEach(() => {
    mockedUseBreakpoint.mockReset();
  });

  it("renders trigger=\"click\" when the breakpoint is mobile (tap-to-pin arm)", () => {
    mockedUseBreakpoint.mockReturnValue("mobile");
    render(<TouchTooltip />);
    expect(screen.getByTestId("tooltip").getAttribute("data-trigger")).toBe(
      "click",
    );
  });

  it("renders trigger=\"hover\" when the breakpoint is desktop (byte-identical proof)", () => {
    mockedUseBreakpoint.mockReturnValue("desktop");
    render(<TouchTooltip />);
    // Must equal Recharts' own default trigger so the desktop render is
    // unchanged from today (no <TouchTooltip> on a desktop = the same <Tooltip>).
    expect(screen.getByTestId("tooltip").getAttribute("data-trigger")).toBe(
      "hover",
    );
  });

  it("renders trigger=\"hover\" on tablet (the non-mobile branch)", () => {
    mockedUseBreakpoint.mockReturnValue("tablet");
    render(<TouchTooltip />);
    expect(screen.getByTestId("tooltip").getAttribute("data-trigger")).toBe(
      "hover",
    );
  });

  it("spreads caller props (formatter, contentStyle) through to <Tooltip> unchanged", () => {
    mockedUseBreakpoint.mockReturnValue("desktop");
    const formatter = (v: number) => [String(v), "label"] as [string, string];
    render(
      <TouchTooltip
        formatter={formatter}
        contentStyle={{ fontSize: 12, borderColor: "#E2E8F0" }}
      />,
    );
    const el = screen.getByTestId("tooltip");
    // The shim adds `trigger` and forwards everything else verbatim.
    expect(el.getAttribute("data-trigger")).toBe("hover");
    expect(el.getAttribute("data-has-formatter")).toBe("yes");
    expect(el.getAttribute("data-content-fontsize")).toBe("12");
  });
});
