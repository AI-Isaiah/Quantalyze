import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DailyPoint } from "@/lib/portfolio-math-utils";
import {
  marksStartCaption,
  marksStartLabelRendered,
  marksStartSentenceOne,
} from "@/lib/nav-marks-start";
import EquityChartWidget, { EquityChart } from "./EquityChart";
import type { TimeframeKey } from "../../lib/types";

/**
 * Phase 167.2.1.1.1 (NAVMTM) plan 10, D-08: the start-of-marks note on My
 * Allocation's Equity curve. Tests (a), (b), (c) and (e) of the approved UI-SPEC
 * ("Host tests must show, with RED first") for this host, plus the 390 px fit
 * rule it names. The widget is mounted whole (so the period tabs and the schema
 * boundary are real); the narrow cases mount the chart at an observed width.
 * Every date is synthetic.
 */

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
vi.mock("@/lib/sentry-capture", () => ({ captureToSentry: vi.fn() }));

const base = { timeframe: "1YTD" as TimeframeKey, width: 6, height: 4 };

const DAY = 86_400_000;
const FIRST_DAY = "2024-01-01";
const N = 200;
const addDays = (d: string, n: number) =>
  new Date(Date.parse(`${d}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const LAST_DAY = addDays(FIRST_DAY, N - 1); // 2024-07-18

function makeSeries(n: number): DailyPoint[] {
  const pts: DailyPoint[] = [];
  let cumulative = 1.0;
  for (let i = 0; i < n; i++) {
    pts.push({ date: addDays(FIRST_DAY, i), value: cumulative });
    cumulative *= 1 + Math.sin(i * 0.3) * 0.01 + 0.0005;
  }
  return pts;
}

const START_MID = "2024-03-01"; // inside ALL, before the 1M window
const START_RECENT = addDays(LAST_DAY, -10); // inside 1M
const FORMAT_MID = "Mar 1, 2024";

const MARKER = '[data-testid="marks-start-marker"]';
const NOTE = '[data-testid="marks-start-note"]';

function renderWidget(extra: Record<string, unknown>) {
  return render(
    <EquityChartWidget
      data={{ equityDailyPoints: makeSeries(N), ...extra } as never}
      {...base}
    />,
  );
}

function pickPeriod(name: string) {
  act(() => {
    fireEvent.click(screen.getByRole("tab", { name }));
  });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("EquityChart marks-start note, (a): start inside the visible range (period ALL)", () => {
  it("draws one solid line, the tracked 12 px uppercase label and the paragraph with S1, S2 and S3", () => {
    const { container } = renderWidget({ marksStart: START_MID });
    pickPeriod("ALL");

    const groups = container.querySelectorAll(MARKER);
    expect(groups.length).toBe(1);
    const g = groups[0];
    expect(g.getAttribute("pointer-events")).toBe("none");

    const lines = g.querySelectorAll("line");
    expect(lines.length).toBe(1);
    expect(lines[0].hasAttribute("stroke-dasharray")).toBe(false);
    expect(lines[0].getAttribute("stroke")).toBe("var(--color-text-secondary)");
    expect(lines[0].getAttribute("stroke-width")).toBe("1");
    expect(lines[0].getAttribute("x1")).toBe(lines[0].getAttribute("x2"));
    // Full plot height: from pad.t (20) down.
    expect(lines[0].getAttribute("y1")).toBe("20");

    const text = g.querySelector("text");
    expect(text, "at 960 the 12 px label fits").not.toBeNull();
    expect(text!.textContent).toBe("RECORDED EQUITY FROM MAR 1, 2024");
    expect(text!.textContent).toBe(marksStartLabelRendered(FORMAT_MID));
    expect(text!.getAttribute("font-size")).toBe("12");
    expect(text!.getAttribute("font-family")).toBe("var(--font-mono), monospace");
    expect(text!.getAttribute("letter-spacing")).toBe("0.05em");
    expect(text!.getAttribute("fill")).toBe("var(--color-text-secondary)");
    // pad.t + 16
    expect(text!.getAttribute("y")).toBe("36");

    expect(g.querySelector("title")!.textContent).toBe(marksStartSentenceOne(FORMAT_MID));

    const note = container.querySelector(NOTE)!;
    expect(note.tagName.toLowerCase()).toBe("p");
    expect(note.className).toContain("mt-2");
    expect(note.className).toContain("text-caption");
    expect(note.className).toContain("text-text-secondary");
    // (e): this chart is always the multi-account one, so S3 is present.
    expect(note.textContent).toBe(marksStartCaption(FORMAT_MID, true));
  });

  it("the marker is drawn before the series paths, so the curve lies over the line", () => {
    const { container } = renderWidget({ marksStart: START_MID });
    pickPeriod("ALL");
    const svg = container.querySelector('svg[aria-label="Equity chart"]')!;
    const children = Array.from(svg.children);
    const markerAt = children.findIndex((c) => c.matches(MARKER));
    const lastPathAt = children.map((c) => c.tagName.toLowerCase()).lastIndexOf("path");
    expect(markerAt).toBeGreaterThan(-1);
    expect(markerAt).toBeLessThan(lastPathAt);
  });
});

describe("EquityChart marks-start note, (b): none of the three outside the visible range", () => {
  it.each([
    ["before the first visible day (period 1M)", START_MID, "1M"],
    ["equal to the first visible day (period ALL)", FIRST_DAY, "ALL"],
    ["after the last visible day", addDays(LAST_DAY, 5), "ALL"],
    ["absent", undefined, "ALL"],
    ["null", null, "ALL"],
    ["malformed text", "2024-02-30", "ALL"],
    ["a malformed number through the widget", 20240301, "ALL"],
  ])("a start %s draws no line, no label and no paragraph, and the curve still renders", (_label, marksStart, period) => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { container } = renderWidget({ marksStart });
    pickPeriod(period);
    expect(container.querySelector(MARKER)).toBeNull();
    expect(container.querySelector(NOTE)).toBeNull();
    // The malformed value never blanks the card: the chart svg is drawn.
    expect(container.querySelector('svg[aria-label="Equity chart"]')).not.toBeNull();
    expect(screen.queryByText("Equity data warming up")).toBeNull();
  });

  it("a start on the last visible day still shows the note", () => {
    const { container } = renderWidget({ marksStart: LAST_DAY });
    pickPeriod("ALL");
    expect(container.querySelector(MARKER)).not.toBeNull();
    expect(container.querySelector(NOTE)).not.toBeNull();
  });
});

describe("EquityChart marks-start note, (c): follows the period", () => {
  it("switching ALL to 1M across the start hides the note, and back shows it", () => {
    const { container } = renderWidget({ marksStart: START_MID });
    pickPeriod("ALL");
    expect(container.querySelector(MARKER)).not.toBeNull();
    expect(container.querySelector(NOTE)).not.toBeNull();

    pickPeriod("1M");
    expect(container.querySelector(MARKER)).toBeNull();
    expect(container.querySelector(NOTE)).toBeNull();

    pickPeriod("ALL");
    expect(container.querySelector(MARKER)).not.toBeNull();
    expect(container.querySelector(NOTE)).not.toBeNull();
  });

  it("a start inside the 1M window shows under 1M", () => {
    const { container } = renderWidget({ marksStart: START_RECENT });
    pickPeriod("1M");
    expect(container.querySelector(MARKER)).not.toBeNull();
    expect(container.querySelector(NOTE)!.textContent).toContain("begins on");
  });
});

describe("EquityChart marks-start note at 390 px (NARROWCHARTS: no SVG text past its bound)", () => {
  function stubObservedWidth(width: number) {
    vi.stubGlobal(
      "ResizeObserver",
      class {
        private cb: ResizeObserverCallback;
        constructor(cb: ResizeObserverCallback) {
          this.cb = cb;
        }
        observe() {
          this.cb(
            [{ contentRect: { width } } as unknown as ResizeObserverEntry],
            this as unknown as ResizeObserver,
          );
        }
        unobserve() {}
        disconnect() {}
      },
    );
  }

  function renderNarrow(marksStart: string, width = 390) {
    stubObservedWidth(width);
    let utils!: ReturnType<typeof render>;
    act(() => {
      utils = render(
        <EquityChart equityDailyPoints={makeSeries(N)} marksStart={marksStart} initialPeriod="ALL" />,
      );
    });
    return utils;
  }

  it("with the line mid-plot the label is not drawn, while the line and the paragraph are", () => {
    const { container } = renderNarrow(START_MID);
    expect(container.querySelector(`${MARKER} line`)).not.toBeNull();
    expect(container.querySelector(`${MARKER} text`)).toBeNull();
    expect(container.querySelector(NOTE)).not.toBeNull();
  });

  it("every label that is drawn lies inside [pad.l, width - pad.r], on whichever side it sits", () => {
    const width = 390;
    const padL = 8;
    const padR = 64; // short y labels keep the gutter at its minimum
    let drawn = 0;
    for (let offset = 5; offset < N; offset += 9) {
      const { container, unmount } = renderNarrow(addDays(FIRST_DAY, offset), width);
      const text = container.querySelector(`${MARKER} text`);
      if (text) {
        drawn += 1;
        const anchorX = Number(text.getAttribute("x"));
        const w = (text.textContent ?? "").length * 12 * 0.65;
        const boxLeft = text.getAttribute("text-anchor") === "end" ? anchorX - w : anchorX;
        const boxRight = text.getAttribute("text-anchor") === "end" ? anchorX : anchorX + w;
        expect(boxLeft, `start +${offset}d`).toBeGreaterThanOrEqual(padL - 1e-9);
        expect(boxRight, `start +${offset}d`).toBeLessThanOrEqual(width - padR + 1e-9);
      }
      unmount();
    }
    // Positive control: the loop did draw a label near an edge, so the bound was exercised.
    expect(drawn).toBeGreaterThan(0);
  });
});

describe("EquityChart marks-start note: every other mount is unchanged", () => {
  it("a chart given no marksStart draws no marker and no paragraph", () => {
    const { container } = render(<EquityChart equityDailyPoints={makeSeries(N)} initialPeriod="ALL" />);
    expect(container.querySelector(MARKER)).toBeNull();
    expect(container.querySelector(NOTE)).toBeNull();
  });
});

describe("EquityChart marks-trailing note (SFH-2 N1): says so when the marks stopped updating", () => {
  const TRAILING = '[data-testid="marks-trailing-note"]';

  it("the widget draws one note in the uppercase tracked mono voice, whatever the period", () => {
    const { container } = renderWidget({ marksStart: START_MID, marksTrailingSince: "2024-07-10" });
    pickPeriod("1M");
    const note = container.querySelector(TRAILING)!;
    expect(note).not.toBeNull();
    expect(note.tagName.toLowerCase()).toBe("p");
    expect(note.textContent).toBe("Marks paused from Jul 10, 2024");
    for (const cls of ["mt-2", "font-mono", "uppercase", "tracking-wider", "text-text-secondary"]) {
      expect(note.className).toContain(cls);
    }
  });

  it("it needs no start: a paused day alone still says so", () => {
    const { container } = renderWidget({ marksTrailingSince: "2024-07-10" });
    expect(container.querySelector(TRAILING)).not.toBeNull();
    expect(container.querySelector(NOTE)).toBeNull();
  });

  it.each([
    ["absent", undefined],
    ["null", null],
    ["malformed text", "2024-07-32"],
    ["a malformed number", 20240710],
  ])("a %s day renders nothing new and never blanks the card", (_label, marksTrailingSince) => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { container } = renderWidget({ marksTrailingSince });
    expect(container.querySelector(TRAILING)).toBeNull();
    expect(container.querySelector('svg[aria-label="Equity chart"]')).not.toBeNull();
  });
});
