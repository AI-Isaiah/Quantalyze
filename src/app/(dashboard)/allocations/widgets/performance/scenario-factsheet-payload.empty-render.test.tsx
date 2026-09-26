/** @vitest-environment jsdom */
/**
 * Phase 166.2 round 2, SFH-R2-M1 / code-review WR-01: the composer's factsheet
 * body for a blend with no usable observations shows "—" for every statistic,
 * never "0.00".
 *
 * Why this matters: `ScenarioComposer` mounts the real `FactsheetBody` for every
 * blend. When the engine hands back no daily returns (nothing selected, an
 * overlap under its minimum, or a non-finite return), the composer's own KpiStrip
 * reads "—" for Sharpe / Sortino. The body below it used to read "Sharpe 0.00 ·
 * Sortino 0.00 · Calmar 0.00" and a bootstrap row "all resamples produced 0.00":
 * a page that disagrees with itself and claims a measured zero where nothing was
 * measured. Founder decision D7 ("Show — everywhere") says an undefined
 * statistic stays empty end to end. The JSON case pins the same display after a
 * serialisation round trip, where NaN becomes `null`.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import type { DailyPoint } from "@/lib/portfolio-math-utils";
import type { FactsheetCsvPayload } from "@/lib/factsheet/types";
import { FactsheetProvider } from "@/app/factsheet/[id]/v2/factsheet-context";
import { FactsheetBody } from "@/app/factsheet/[id]/v2/FactsheetView";
import { buildScenarioFactsheetPayload } from "./scenario-factsheet-payload";

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

function renderBody(payload: FactsheetCsvPayload) {
  return render(
    <FactsheetProvider payload={payload} persist={false}>
      <FactsheetBody payload={payload} scenarioMode hideHeader hideAllocatorSection hideFooter={false} />
    </FactsheetProvider>,
  );
}

function section(container: HTMLElement, title: string): HTMLElement {
  const h = [...container.querySelectorAll("h3")].find(el => el.textContent === title);
  if (!h) throw new Error(`no panel titled "${title}"`);
  return h.closest("section") as HTMLElement;
}

/** The strategy-value cell of a MetricsColumn row. */
function rowValue(panel: HTMLElement, label: string): string {
  const tr = [...panel.querySelectorAll("tr")].find(
    r => r.querySelector("td")?.textContent === label,
  );
  if (!tr) throw new Error(`no row "${label}"`);
  return tr.querySelectorAll("td")[1]?.textContent ?? "";
}

const poisoned: DailyPoint[] = [
  { date: "2024-01-01", value: 0.01 },
  { date: "2024-01-02", value: Number.NaN },
  { date: "2024-01-03", value: 0.02 },
];

const CASES: Array<{ name: string; payload: () => FactsheetCsvPayload }> = [
  { name: "no daily returns", payload: () => buildScenarioFactsheetPayload({ portfolioDaily: [] }) },
  { name: "a non-finite return", payload: () => buildScenarioFactsheetPayload({ portfolioDaily: poisoned }) },
  {
    name: "no daily returns, after a JSON round trip (NaN → null)",
    payload: () =>
      JSON.parse(JSON.stringify(buildScenarioFactsheetPayload({ portfolioDaily: [] }))) as FactsheetCsvPayload,
  },
];

describe("scenario factsheet body with no observations shows '—', never 0.00 (D7)", () => {
  for (const c of CASES) {
    it(`Main Metrics, Returns and Bootstrap read "—" for ${c.name}`, () => {
      const { container } = renderBody(c.payload());

      const main = section(container, "Main Metrics");
      for (const label of ["Cumulative Return", "CAGR", "Ann. Volatility", "Sharpe", "Sortino", "Calmar"]) {
        expect(rowValue(main, label), label).toBe("—");
      }
      // No value cell in the metric rows claims a measured zero.
      const mainCells = [...main.querySelectorAll("tbody td")].map(td => td.textContent ?? "");
      expect(mainCells.filter(t => /0\.00/.test(t))).toEqual([]);

      const returns = section(container, "Returns");
      expect(rowValue(returns, "Win Rate (days)")).toBe("—");
      expect(rowValue(returns, "Profit Factor")).toBe("—");

      const risk = section(container, "Max Drawdown");
      expect(rowValue(risk, "Max Drawdown")).toBe("—");

      const boot = section(container, "Bootstrap 95% Confidence");
      expect(boot.textContent).not.toContain("all resamples produced");
      expect(boot.textContent).not.toMatch(/0\.00/);

      expect(container.innerHTML).not.toMatch(/NaN|Infinity|>null</);
    });
  }
});
