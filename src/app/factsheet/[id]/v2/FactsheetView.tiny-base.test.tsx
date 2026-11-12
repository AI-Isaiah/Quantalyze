import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import type { DailyPoint } from "@/lib/portfolio-math-utils";
import type { FactsheetPayload } from "@/lib/factsheet/types";
import { buildScenarioFactsheetPayload } from "@/app/(dashboard)/allocations/widgets/performance/scenario-factsheet-payload";
import { FactsheetProvider } from "./factsheet-context";
import { FactsheetBody } from "./FactsheetView";

/**
 * Phase 188 (TINYBASE) plan 07 - D-02, D-06, SC-5: the strategy factsheet counts AND names the
 * days the rule left out because the account was nearly empty, in one muted line with the
 * threshold attached, and says nothing when there are none.
 *
 * DESIGN.md check (re-read at execution, agreement recorded in the plan SUMMARY): the muted
 * token DESIGN.md gives captions (no new colour), the existing neutral data-quality paragraph's
 * classes and border (no new size, the v2 4-size / 2-weight contract holds), no glyph, sentence
 * case, active voice, the limitation stated with its threshold, no adjective where a number
 * exists, and the day format this view already prints (`formatUnpricedDays`).
 *
 * Every expected string is an independent literal typed here (the en dash written as the
 * character itself), never built from the module under test: a test that imports its own
 * copy and threshold constants would pass on any value.
 */

vi.mock("@/lib/sentry-capture", () => ({ captureToSentry: vi.fn() }));

const lsStore = new Map<string, string>();
const localStorageMock = {
  getItem: vi.fn((k: string) => lsStore.get(k) ?? null),
  setItem: vi.fn((k: string, v: string) => {
    lsStore.set(k, v);
  }),
  removeItem: vi.fn((k: string) => {
    lsStore.delete(k);
  }),
  clear: vi.fn(() => lsStore.clear()),
  key: vi.fn(() => null),
  length: 0,
};
beforeEach(() => {
  vi.stubGlobal("localStorage", localStorageMock);
});
Object.defineProperty(window, "localStorage", {
  value: localStorageMock,
  configurable: true,
});

function makeReturnsSeries(n: number, drift = 0.0015): DailyPoint[] {
  const pts: DailyPoint[] = [];
  const d = new Date(Date.UTC(2023, 0, 1));
  for (let i = 0; i < n; i++) {
    pts.push({ date: d.toISOString().slice(0, 10), value: drift + Math.sin(i * 0.27) * 0.005 });
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return pts;
}

// n=300 (>=252) so the client-count n<252 heuristic caveat does NOT fire; single-key payload.
function tinyBasePayload(tinyBaseDays: unknown): FactsheetPayload {
  const p = buildScenarioFactsheetPayload({ portfolioDaily: makeReturnsSeries(300), benchmark: null });
  return {
    ...p,
    dataQuality: {
      composite: false,
      ...(tinyBaseDays === undefined ? {} : { tinyBaseDays }),
    },
  } as unknown as FactsheetPayload;
}

function renderBody(payload: FactsheetPayload) {
  return render(
    <FactsheetProvider payload={payload} persist={false}>
      <FactsheetBody payload={payload} scenarioMode hideAllocatorSection />
    </FactsheetProvider>,
  );
}

const NOTE = '[data-testid="factsheet-tiny-base-note"]';

describe("188 D-02, D-06 - the factsheet names the days left out on a nearly empty account", () => {
  it.each([
    [
      "two consecutive days read as one run",
      ["2026-10-27", "2026-10-28"],
      "We leave out 2 days on which an account was nearly empty (under 5% of its highest balance over the previous 30 days): Oct\u00a027,\u00a02026 – Oct\u00a028,\u00a02026.",
    ],
    [
      "one day reads singular",
      ["2026-10-27"],
      "We leave out 1 day on which an account was nearly empty (under 5% of its highest balance over the previous 30 days): Oct\u00a027,\u00a02026.",
    ],
    [
      "a run and a lone day are joined by a semicolon, every run listed",
      ["2026-10-27", "2026-10-28", "2026-11-02"],
      "We leave out 3 days on which an account was nearly empty (under 5% of its highest balance over the previous 30 days): Oct\u00a027,\u00a02026 – Oct\u00a028,\u00a02026; Nov\u00a02,\u00a02026.",
    ],
  ])("%s", (_name, days, expected) => {
    const { container } = renderBody(tinyBasePayload(days));
    const notes = container.querySelectorAll<HTMLElement>(NOTE);
    expect(notes).toHaveLength(1);
    expect((notes[0].textContent ?? "").trim()).toBe(expected);
  });

  it.each([[[]], [undefined]])("shows no note when the list is %j", (days) => {
    const { container } = renderBody(tinyBasePayload(days));
    expect(container.querySelector(NOTE)).toBeNull();
    expect(container.textContent).not.toContain("nearly empty");
  });

  // Fails if the note is switched to the warning token or given the warning glyph: a left-out day
  // is an honest steady-state fact (DESIGN.md "Muted"), not a recoverable warning, not a failure.
  it("is an information note: the muted token, no warning token, no glyph, the sibling paragraph classes", () => {
    const { container } = renderBody(tinyBasePayload(["2026-10-27", "2026-10-28"]));
    const el = container.querySelector<HTMLElement>(NOTE)!;
    expect(el.tagName).toBe("P");
    expect(el.className).toContain("text-micro");
    const style = el.getAttribute("style") ?? "";
    expect(style).toContain("var(--color-text-muted, #64748B)");
    expect(style).not.toContain("color-warning");
    expect(style).not.toContain("color-negative");
    expect(el.textContent).not.toContain("⚠");
  });

  // T-188-13: the public note carries dates and the fixed threshold only.
  it("names days and the fixed threshold only, never an amount", () => {
    const { container } = renderBody(tinyBasePayload(["2026-10-27", "2026-10-28"]));
    const text = container.querySelector<HTMLElement>(NOTE)!.textContent ?? "";
    expect(text).not.toMatch(/[$€£]|\bBTC\b|\bUSD\b|\d,\d{3}\b/);
  });
});
