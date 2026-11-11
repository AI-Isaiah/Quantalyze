/** @vitest-environment jsdom */
/**
 * Phase 201 plan 08 (D-03, D-19, D-20): a specialist term in the metrics rail explains itself
 * where it appears, and not in print.
 *
 * WHY it exists. The rail prints Omega, Ulcer index, Common-sense ratio and a dozen more terms a
 * reader cannot be expected to know. The glossary registry owns one definition per term; the
 * rail's job is only to put the registry's `Term` trigger on each label. A row that loses its
 * `term` prop looks identical on screen, so nothing but this file notices: it opens each
 * trigger by keyboard focus (the D-19 path) and compares the bubble with the registry text. The
 * print arm proves the tearsheet's `PlainTerms` switch leaves the rail with no trigger at all
 * (D-20), because a dotted underline and a tab stop on paper are noise.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, fireEvent, act, screen, within } from "@testing-library/react";
import { termDefinition, type TermKey } from "@/lib/glossary";
import { PlainTerms } from "@/components/ui/Term";
import { FactsheetProvider } from "./factsheet-context";
import { MetricsColumn, type MetricsPart } from "./MetricsColumn";
import { censusPayloadA } from "./test-fixtures/census-payloads";

vi.mock("@/lib/sentry-capture", () => ({ captureToSentry: vi.fn() }));
vi.mock("@/hooks/useBreakpoint", () => ({ useBreakpoint: vi.fn(() => "desktop" as const) }));
vi.setConfig({ testTimeout: 60_000 });

Object.defineProperty(document.documentElement, "clientWidth", { configurable: true, get: () => 1024 });
Object.defineProperty(document.documentElement, "clientHeight", { configurable: true, get: () => 768 });

afterEach(() => {
  vi.useRealTimers();
});

function mount(part: MetricsPart, plain = false) {
  const rail = <MetricsColumn part={part} />;
  return render(
    <FactsheetProvider payload={censusPayloadA()} persist={false}>
      <article id="factsheet-main">{plain ? <PlainTerms>{rail}</PlainTerms> : rail}</article>
    </FactsheetProvider>,
  );
}

/** Focus a trigger and let the 150 ms open delay pass; return the bubble text. */
function openByFocus(trigger: Element): string {
  vi.useFakeTimers();
  fireEvent.focus(trigger);
  act(() => {
    vi.advanceTimersByTime(150);
  });
  const text = screen.getByRole("tooltip").textContent ?? "";
  fireEvent.blur(trigger);
  act(() => {
    vi.advanceTimersByTime(300);
  });
  vi.useRealTimers();
  return text;
}

describe("tracer: Omega in the Extended metrics rail (D-03, D-19)", () => {
  it("renders Omega as a data-term trigger whose focus opens the registry definition", () => {
    const { container } = mount("detailed");
    const trigger = container.querySelector('[data-term="omega"]');
    expect(trigger, "the Omega row has no Term trigger").not.toBeNull();
    expect(trigger!.textContent).toBe("Omega (θ=0)");
    expect(openByFocus(trigger!)).toBe(termDefinition("omega"));
  });
});

/**
 * One registered row per panel, so a panel whose rows lose their `term` prop fails here and not
 * in a reader's hover. The labels are the rail's own text; the key is the registry's.
 */
const PANEL_ROWS: Array<{ panel: string; part: MetricsPart; label: string; key: TermKey }> = [
  { panel: "Main metrics", part: "main", label: "Profit Factor", key: "profit_factor" },
  { panel: "Main metrics", part: "main", label: "Longest DD (days)", key: "dd_duration" },
  { panel: "Main metrics", part: "main", label: "Skew", key: "skew" },
  { panel: "Rolling metrics", part: "detailed", label: "Sharpe", key: "sharpe" },
  { panel: "Rolling metrics", part: "detailed", label: "Volatility", key: "volatility" },
  { panel: "Extended metrics", part: "detailed", label: "Ulcer Index", key: "ulcer_index" },
  { panel: "Extended metrics", part: "detailed", label: "Common-sense Ratio", key: "common_sense_ratio" },
  { panel: "Extended metrics", part: "detailed", label: "Tail Ratio (P95/|P5|)", key: "tail_ratio" },
  { panel: "Extended metrics", part: "detailed", label: "Avg Win / Avg Loss", key: "avg_win_loss" },
  { panel: "Benchmark", part: "detailed", label: "Treynor", key: "treynor" },
  { panel: "Benchmark", part: "detailed", label: "Up Capture", key: "up_capture" },
  { panel: "Benchmark", part: "detailed", label: "R²", key: "r_squared" },
];

describe("every rail panel explains its registered labels (D-01, D-03, D-19)", () => {
  it.each(PANEL_ROWS)("$panel: $label opens the $key definition", ({ part, label, key }) => {
    const { container } = mount(part);
    const trigger = [...container.querySelectorAll(`[data-term="${key}"]`)].find((el) => el.textContent === label);
    expect(trigger, `no ${key} trigger reading "${label}"`).toBeDefined();
    expect(openByFocus(trigger!)).toBe(termDefinition(key));
  });

  it("the Max Drawdown panel title and its row are both triggers, and the title text is unchanged", () => {
    const { container } = mount("all");
    const title = [...container.querySelectorAll("h3")].find((h) => h.textContent === "Max Drawdown");
    expect(title, "the Max Drawdown panel title changed").toBeDefined();
    expect(title!.querySelector('[data-term="max_drawdown"]')).not.toBeNull();
  });
});

describe("the print switch (D-20)", () => {
  it("leaves no data-term in the rail inside PlainTerms, and keeps the Omega label text", () => {
    const withTerms = mount("detailed");
    expect(withTerms.container.querySelectorAll("[data-term]").length, "control: the rail has triggers").toBeGreaterThan(0);
    withTerms.unmount();
    const { container } = mount("detailed", true);
    expect(container.querySelectorAll("[data-term]")).toHaveLength(0);
    expect(within(container).getByText("Omega (θ=0)")).toBeTruthy();
  });
});
