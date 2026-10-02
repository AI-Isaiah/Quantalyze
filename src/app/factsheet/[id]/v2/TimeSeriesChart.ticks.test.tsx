import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { DailyPoint } from "@/lib/portfolio-math-utils";
import type { FactsheetPayload } from "@/lib/factsheet/types";
import { buildScenarioFactsheetPayload } from "@/app/(dashboard)/allocations/widgets/performance/scenario-factsheet-payload";
import { CHART_CONFIGS } from "./chart-configs";
import { FactsheetProvider } from "./factsheet-context";
import { TimeSeriesChart } from "./TimeSeriesChart";

/**
 * Phase 169.1.1 HYDRATIONTICKS, SC-3. The factsheet daily-returns chart must
 * render the same y-axis markup on the server (Node) and in the browser
 * (Chromium), because React discards the server tree (#418) when the text of a
 * tick label differs between the two.
 *
 * Why the power of ten is stubbed rather than left native: vitest runs in Node,
 * and Node's inexact power of ten for exponents -4 and -5 is exactly what makes
 * the server's zero tick land on 0. Left native, a "zero tick is 0" assertion
 * passes on the broken code. So each render pins one engine's behaviour:
 *   - Chromium-exact: base 10 with an integer exponent returns the correctly
 *     rounded value, as Chromium 153 does for every exponent in -30..30.
 *   - Node-inexact: exponents -4 and -5 return Node 22's one-ulp-low values.
 * Every other call delegates to the real function. Only the power function is
 * stubbed: the log-scale domain code uses other Math functions for reasons
 * outside this phase, and this chart is linear.
 *
 * The series is the seeded allocator book's derived returns
 * (e2e/helpers/seed-test-project.ts, seedAllocatorBook step 4): equity
 * 100_000 * (1 + sin(i / 30) * 0.02) over 120 days, returns as consecutive
 * ratios. That is the series behind the measured React #418 span.
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
// Installed per test: vitest.config.ts sets `unstubGlobals: true`, which
// restores stubbed globals before every test.
beforeEach(() => {
  vi.stubGlobal("localStorage", localStorageMock);
});
Object.defineProperty(window, "localStorage", {
  value: localStorageMock,
  configurable: true,
});

const SEED_DAYS = 120;
const SEED_START_MS = Date.UTC(2026, 0, 1);

/** The 119 ratio returns of the seeded allocator equity curve. */
function seedDailyReturns(): DailyPoint[] {
  const curve = Array.from({ length: SEED_DAYS }, (_, i) => ({
    date: new Date(SEED_START_MS + i * 86_400_000).toISOString().slice(0, 10),
    equity: 100_000 * (1 + Math.sin(i / 30) * 0.02),
  }));
  return curve.slice(1).map((point, i) => ({
    date: point.date,
    value: point.equity / curve[i].equity - 1,
  }));
}

function seedPayload(): FactsheetPayload {
  return buildScenarioFactsheetPayload({
    portfolioDaily: seedDailyReturns(),
  }) as unknown as FactsheetPayload;
}

const dailyReturns = CHART_CONFIGS.find((c) => c.key === "dailyReturns")!;

/** Node 22's one-ulp-low powers of ten (the server's values). */
const NODE_INEXACT: Record<number, number> = {
  [-4]: 9.999999999999999e-5,
  [-5]: 9.999999999999999e-6,
};

type Regime = "chromium-exact" | "node-inexact";

function renderUnder(regime: Regime): string {
  const realPow = Math.pow;
  const spy = vi.spyOn(Math, "pow").mockImplementation((base: number, exp: number) => {
    if (base === 10 && Number.isInteger(exp)) {
      if (regime === "chromium-exact") return Number(`1e${exp}`);
      if (exp in NODE_INEXACT) return NODE_INEXACT[exp];
    }
    return realPow(base, exp);
  });
  try {
    const payload = seedPayload();
    return renderToStaticMarkup(
      <FactsheetProvider payload={payload} persist={false}>
        <TimeSeriesChart config={dailyReturns} />
      </FactsheetProvider>,
    );
  } finally {
    spy.mockRestore();
  }
}

/** The text x of a y-axis tick label: PAD.left (50) minus 6. */
const Y_LABEL_X = "44";

interface YTick {
  label: string;
  stroke: string | null;
  dash: string | null;
}

/** A y-tick group is a `<g>` holding exactly one `<line>` and one `<text>` at the y-label x. */
function yTicks(markup: string): YTick[] {
  const doc = new DOMParser().parseFromString(markup, "text/html");
  const out: YTick[] = [];
  for (const g of Array.from(doc.querySelectorAll("g"))) {
    const kids = Array.from(g.children);
    const lines = kids.filter((k) => k.tagName.toLowerCase() === "line");
    const texts = kids.filter((k) => k.tagName.toLowerCase() === "text");
    if (kids.length !== 2 || lines.length !== 1 || texts.length !== 1) continue;
    if (texts[0].getAttribute("x") !== Y_LABEL_X) continue;
    out.push({
      label: texts[0].textContent ?? "",
      stroke: lines[0].getAttribute("stroke"),
      dash: lines[0].getAttribute("stroke-dasharray"),
    });
  }
  return out;
}

describe("TimeSeriesChart daily-returns y-ticks, server vs browser (169.1.1 SC-3)", () => {
  it("non-vacuity pin: the seeded span crosses zero, so a zero tick is in play", () => {
    const labels = yTicks(renderUnder("node-inexact")).map((t) => t.label);
    expect(labels.length, "y-tick groups found in the markup").toBeGreaterThanOrEqual(3);
    expect(labels.some((l) => /^-\d/.test(l) && l !== "-0.0%"), `a negative tick in ${labels.join(" ")}`).toBe(true);
    expect(labels.some((l) => /^\+\d/.test(l) && l !== "+0.0%"), `a positive tick in ${labels.join(" ")}`).toBe(true);
  });

  it("renders byte-identical markup under the Node-inexact and Chromium-exact power of ten", () => {
    const server = renderUnder("node-inexact");
    const browser = renderUnder("chromium-exact");
    expect(yTicks(browser).map((t) => t.label)).toEqual(yTicks(server).map((t) => t.label));
    expect(browser === server, "server and browser markup must be byte-identical").toBe(true);
  });

  it("under the Chromium-exact regime the zero tick reads +0.0% and is the one solid baseline", () => {
    const ticks = yTicks(renderUnder("chromium-exact"));
    const baselines = ticks.filter(
      (t) => t.stroke === "var(--color-text-muted)" && t.dash === null,
    );
    expect(baselines.length, `baseline-styled ticks in ${ticks.map((t) => t.label).join(" ")}`).toBe(1);
    expect(baselines[0].label).toBe("+0.0%");
  });
});
