import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

/**
 * Phase 170.6 plan 07 (D-02, D-03, D-05) — the allocations comparator panel, the KPI strip
 * delta pill and the Outcomes widget print a figure that rounds to zero with no sign and
 * colour it neutral. Every expected string and colour below is typed by hand; none comes
 * from the code under test.
 *
 * The composer's delta summary (`ScenarioComposer.deltaSummary`) is not exercised here: the
 * footer drops every entry whose |delta| is below the noise floor (0.01 for each of its three
 * metrics) and a delta at or above 0.01 prints at least "0.01" / "1.0%", so a printed zero
 * never reaches the footer. See the 170.6-07 SUMMARY.
 */

// ---------------------------------------------------------------- mocks

const { refreshMock, jointAlpha } = vi.hoisted(() => ({
  refreshMock: vi.fn(),
  jointAlpha: { value: 0 },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: refreshMock,
    push: vi.fn(),
    replace: vi.fn(),
    prefetch: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
  }),
}));

vi.mock("recharts", async () => {
  const actual = await vi.importActual<typeof import("recharts")>("recharts");
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
      <div style={{ width: 400, height: 300 }}>{children}</div>
    ),
  };
});

vi.mock("@/lib/sentry-capture", () => ({ captureToSentry: vi.fn() }));

// The alpha is a computed quantity; the test pins the value the callout receives and leaves
// beta and everything else real.
vi.mock("@/lib/factsheet/joint", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/factsheet/joint")>();
  return {
    ...actual,
    jointMetrics: (...args: Parameters<typeof actual.jointMetrics>) => ({
      ...actual.jointMetrics(...args),
      alpha: jointAlpha.value,
    }),
  };
});

import AlphaBetaDecomposition, {
  type AlphaBetaWidgetData,
} from "./widgets/attribution/AlphaBetaDecomposition";
import { formatSignedDelta } from "./components/KpiStrip";
import OutcomesWidget, { formatDelta } from "./widgets/outcomes/OutcomesWidget";

afterEach(() => {
  cleanup();
});

// ------------------------------------------------- Alpha comparator panel

const DAY_MS = 86_400_000;
const isoDay = (startIso: string, i: number) =>
  new Date(Date.parse(`${startIso}T00:00:00Z`) + i * DAY_MS).toISOString().slice(0, 10);

const BOOK = Array.from({ length: 60 }, (_, i) => ({
  date: isoDay("2026-08-01", i),
  value: 0.004 * Math.sin(i * 0.7) + 0.0015 * Math.cos(i * 0.31) + 0.0004,
}));
const CLOSES = Array.from({ length: 61 }, (_, i) => ({
  date: isoDay("2026-07-31", i),
  close: 60_000 * (1 + 0.03 * Math.sin(i * 0.45) + 0.0008 * i),
}));
const ALPHA_DATA = {
  strategies: [],
  analytics: null,
  equityHistoryState: "ready",
  equityDailyReturns: BOOK,
  btcBenchmarkPrices: { prices: CLOSES, through: "2026-09-29", dropped: [] as string[] },
} as AlphaBetaWidgetData;
const ALPHA_PROPS = { timeframe: "1YTD" as const, width: 6, height: 3 };

function alphaCallout(alpha: number): HTMLElement {
  jointAlpha.value = alpha;
  render(<AlphaBetaDecomposition data={ALPHA_DATA} {...ALPHA_PROPS} />);
  const el = screen.getByText("annualized").previousElementSibling as HTMLElement | null;
  expect(el).not.toBeNull();
  return el as HTMLElement;
}

describe("AlphaBetaDecomposition — the Alpha callout follows the rounded sign (D-02, D-03)", () => {
  it("Alpha -0.0004 prints 0.0% in the neutral tone, not -0.0% in red", () => {
    const el = alphaCallout(-0.0004);
    expect(el.textContent).toBe("0.0%");
    expect(el.className).toContain("text-text-primary");
    expect(el.className).not.toContain("text-negative");
    expect(el.className).not.toContain("text-positive");
  });

  it("Alpha 0 prints 0.0% in the neutral tone, not +0.0% in green", () => {
    const el = alphaCallout(0);
    expect(el.textContent).toBe("0.0%");
    expect(el.className).toContain("text-text-primary");
    expect(el.className).not.toContain("text-positive");
  });

  it("Alpha 0.0123 prints +1.2% in the positive tone", () => {
    const el = alphaCallout(0.0123);
    expect(el.textContent).toBe("+1.2%");
    expect(el.className).toContain("text-positive");
  });

  it("Alpha -0.0123 prints -1.2% in the negative tone", () => {
    const el = alphaCallout(-0.0123);
    expect(el.textContent).toBe("-1.2%");
    expect(el.className).toContain("text-negative");
  });
});

// ------------------------------------------------------ KPI delta pill

describe("KpiStrip.formatSignedDelta — a delta that rounds to zero carries no sign (D-02)", () => {
  it("a ratio delta that prints zero is 0.00 whatever its raw sign", () => {
    expect(formatSignedDelta(-0.004, "sharpe")).toBe("0.00");
    expect(formatSignedDelta(0.004, "sharpe")).toBe("0.00");
    expect(formatSignedDelta(0, "sharpe")).toBe("0.00");
  });

  it("a percent delta that prints zero is 0.0%", () => {
    expect(formatSignedDelta(-0.0004, "twr")).toBe("0.0%");
    expect(formatSignedDelta(0.0004, "twr")).toBe("0.0%");
  });

  it("non-zero deltas keep their digits and the ASCII plus / U+2212 minus convention", () => {
    expect(formatSignedDelta(0.012, "twr")).toBe("+1.2%");
    expect(formatSignedDelta(-0.012, "twr")).toBe("−1.2%");
    expect(formatSignedDelta(0.25, "sharpe")).toBe("+0.25");
    expect(formatSignedDelta(-0.25, "sortino")).toBe("−0.25");
  });

  it("a missing delta is a dash", () => {
    expect(formatSignedDelta(null, "twr")).toBe("—");
  });
});

// --------------------------------------------------------- Outcomes widget

describe("OutcomesWidget.formatDelta — text and tone follow the rounded 1 dp value (D-02, D-03)", () => {
  it("-0.0004 is 0.0% neutral", () => {
    expect(formatDelta(-0.0004)).toEqual({ text: "0.0%", tone: "neutral" });
  });
  it("0 is 0.0% neutral", () => {
    expect(formatDelta(0)).toEqual({ text: "0.0%", tone: "neutral" });
  });
  it("0.012 is +1.2% positive", () => {
    expect(formatDelta(0.012)).toEqual({ text: "+1.2%", tone: "positive" });
  });
  it("-0.012 is -1.2% negative", () => {
    expect(formatDelta(-0.012)).toEqual({ text: "-1.2%", tone: "negative" });
  });
  it("null is Pending neutral", () => {
    expect(formatDelta(null)).toEqual({ text: "Pending", tone: "neutral" });
  });
});

type MockStrategy = { id: string; name: string };
function makeOutcome(overrides: Record<string, unknown> & { id: string }) {
  return {
    strategy_id: "s-repl",
    match_decision_id: "md-1",
    kind: "allocated",
    percent_allocated: 12,
    allocated_at: "2026-03-01",
    rejection_reason: null,
    note: null,
    delta_30d: 0.04,
    delta_90d: null,
    delta_180d: null,
    estimated_delta_bps: null,
    estimated_days: null,
    needs_recompute: false,
    created_at: "2026-03-01T00:00:00Z",
    replacement_strategy: { id: "s-repl", name: "Crypto Momentum LP" } as MockStrategy,
    match_decision: {
      original_strategy: { id: "s-orig", name: "Legacy Equity LP" } as MockStrategy,
    },
    ...overrides,
  };
}

function renderWidget(outcomes: Array<ReturnType<typeof makeOutcome>>) {
  return render(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    <OutcomesWidget data={{ outcomes } as any} timeframe="1YTD" width={1200} height={300} />,
  );
}

beforeEach(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).fetch = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({
      original: [
        { date: "2026-03-01", nav: 100 },
        { date: "2026-03-10", nav: 98 },
      ],
      replacement: [
        { date: "2026-03-01", nav: 100 },
        { date: "2026-03-10", nav: 102 },
      ],
      allocated_at: "2026-03-01",
    }),
  });
});

describe("OutcomesWidget — KPI cell and row cell follow the rounded sign (D-02, D-03)", () => {
  it("an average realized delta of -0.0004 prints 0.0% in the neutral colour, not red", () => {
    renderWidget([makeOutcome({ id: "o1", delta_30d: -0.0004 })]);
    const kpi = screen.getAllByText("0.0%").find((n) => n.className.includes("text-fixed-22"));
    expect(kpi).toBeDefined();
    const style = kpi!.getAttribute("style") ?? "";
    expect(style).toContain("1A1A2E");
    expect(style).not.toContain("DC2626");
    expect(style).not.toContain("15803D");
  });

  it("an average realized delta of 0 prints 0.0% in the neutral colour, not +0.0% in green", () => {
    renderWidget([makeOutcome({ id: "o1", delta_30d: 0 })]);
    const kpi = screen.getAllByText("0.0%").find((n) => n.className.includes("text-fixed-22"));
    expect(kpi).toBeDefined();
    const style = kpi!.getAttribute("style") ?? "";
    expect(style).toContain("1A1A2E");
    expect(style).not.toContain("15803D");
  });

  it("a row cell of -0.0004 prints 0.0% with the primary text colour, not #DC2626", () => {
    renderWidget([makeOutcome({ id: "o1", delta_30d: -0.0004 })]);
    const cell = screen.getAllByText("0.0%").find((n) => n.className.includes("text-fixed-13"));
    expect(cell).toBeDefined();
    const style = cell!.getAttribute("style") ?? "";
    expect(style).toContain("--delta-color: #1A1A2E");
    expect(style).not.toContain("DC2626");
    expect(style).not.toContain("15803D");
  });

  it("non-zero cells keep their text and colour: +1.2% green, -1.2% red", () => {
    renderWidget([
      makeOutcome({ id: "up", delta_30d: 0.012 }),
      makeOutcome({ id: "down", delta_30d: -0.012 }),
    ]);
    const up = screen.getAllByText("+1.2%").find((n) => n.className.includes("text-fixed-13"));
    const down = screen.getAllByText("-1.2%").find((n) => n.className.includes("text-fixed-13"));
    expect(up!.getAttribute("style")).toContain("15803D");
    expect(down!.getAttribute("style")).toContain("DC2626");
  });
});

describe("OutcomesWidget — the expanded column bar follows the rounded sign (D-03)", () => {
  async function barOf(delta30: number, printed: string) {
    renderWidget([makeOutcome({ id: "o1", delta_30d: delta30 })]);
    fireEvent.click(screen.getByRole("button", { name: /Expand outcome detail/ }));
    await waitFor(() => {
      expect(screen.getAllByText("Window open").length).toBeGreaterThanOrEqual(2);
    });
    // the 30d column's value node is the only non-pending column; its card holds the bar.
    const valueNode = screen
      .getAllByText(printed)
      .find((n) => n.className.includes("text-fixed-24"));
    expect(valueNode).toBeDefined();
    const card = valueNode!.closest("div.rounded-lg") as HTMLElement;
    const bar = card.querySelector("div.h-1 > div") as HTMLElement;
    return { bar, valueNode: valueNode! };
  }

  it("a column delta of -0.0004 draws the muted bar and the muted value, not negative", async () => {
    const { bar, valueNode } = await barOf(-0.0004, "0.0%");
    expect(bar.getAttribute("style")).toContain("var(--color-text-muted)");
    expect(bar.getAttribute("style")).not.toContain("var(--color-negative)");
    expect(valueNode.textContent).toBe("0.0%");
  });

  it("a column delta of 0.012 draws the positive bar", async () => {
    const { bar } = await barOf(0.012, "+1.2%");
    expect(bar.getAttribute("style")).toContain("var(--color-positive)");
  });

  it("a column delta of -0.012 draws the negative bar", async () => {
    const { bar } = await barOf(-0.012, "-1.2%");
    expect(bar.getAttribute("style")).toContain("var(--color-negative)");
  });
});
