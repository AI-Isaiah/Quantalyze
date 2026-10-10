/** @vitest-environment jsdom */
/**
 * Phase 164.6.6.3.3 (UI-SPEC §6; B11, B12, B14): an em-dash is never coloured or
 * weighted like a measurement.
 *
 * Why this matters: the rail marks its headline rows (Sharpe, Max Drawdown, Since
 * Inception, the rolling Sharpe, the quantile Median) in the accent colour at
 * weight 500/600 so the eye lands on the number that matters. When that number is
 * absent the cell reads "—", and a highlighted dash looks like a highlighted
 * finding: the page emphasises the one thing it cannot tell the reader. The rule
 * lives in the primitives (`Row`, `RollingRow`, `Kpi`), so every present and
 * future call site that passes `accent` is covered by one edit.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import { buildFactsheetPayload } from "@/lib/factsheet/build-payload";
import type { FactsheetPayload } from "@/lib/factsheet/types";
import { buildScenarioFactsheetPayload } from "@/app/(dashboard)/allocations/widgets/performance/scenario-factsheet-payload";

import { FactsheetProvider } from "./factsheet-context";
import { MetricsColumn } from "./MetricsColumn";
import { QuantileBoxPlotPanel } from "./DistributionPanels";

vi.mock("@/lib/sentry-capture", () => ({ captureToSentry: vi.fn() }));

const lsStore = new Map<string, string>();
beforeEach(() => {
  lsStore.clear();
  vi.stubGlobal("localStorage", {
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
  });
});

const DAY = 86_400_000;

function isoDay(i: number): string {
  return new Date(Date.UTC(2022, 0, 1) + i * DAY).toISOString().slice(0, 10);
}

/** `active` dispersing days (both signs), then `flat` days of exactly 0. */
function payloadFor(active: number, flat: number): FactsheetPayload {
  const dailyReturns = Array.from({ length: active + flat }, (_, i) => ({
    date: isoDay(i),
    value: i < active ? Math.sin(i / 7) * 0.01 + 0.0004 : 0,
  }));
  const payload = buildFactsheetPayload(
    {
      id: "dash-accent-test",
      name: "Dash Accent Test",
      types: ["test"],
      markets: ["crypto"],
      computedAt: "2026-09-26T00:00:00Z",
      trustTier: null,
      ingestSource: "api",
    },
    dailyReturns,
  );
  if (!payload) throw new Error("buildFactsheetPayload returned null in test");
  return payload;
}

/** A scenario payload with no usable daily returns: every headline scalar is NaN. */
function emptyPayload(): FactsheetPayload {
  return buildScenarioFactsheetPayload({ portfolioDaily: [] }) as unknown as FactsheetPayload;
}

function renderRail(payload: FactsheetPayload): HTMLElement {
  return render(
    <FactsheetProvider payload={payload} persist={false}>
      <MetricsColumn />
    </FactsheetProvider>,
  ).container;
}

/** The first value cell of the row labelled `label`, in the panel titled `panel`. */
function valueCell(root: HTMLElement, panel: string, label: string): HTMLElement {
  const h = [...root.querySelectorAll("h3")].find(el => el.textContent?.includes(panel));
  if (!h) throw new Error(`no panel "${panel}"`);
  const tr = [...(h.closest("section") as HTMLElement).querySelectorAll("tr")].find(
    r => r.querySelector("td")?.textContent === label,
  );
  if (!tr) throw new Error(`no row "${label}" in "${panel}"`);
  return tr.querySelectorAll("td")[1] as HTMLElement;
}

const ACCENT_ROWS: Array<[string, string]> = [
  ["Main Metrics", "Sharpe"],
  ["Max Drawdown", "Max Drawdown"],
  ["Cumulative Return", "Since Inception"],
];

describe("Row: a dash never carries accent (UI-SPEC §6, B11/B12)", () => {
  for (const [panel, label] of ACCENT_ROWS) {
    it(`${label} reads "—" in primary text at normal weight when there is no value`, () => {
      const cell = valueCell(renderRail(emptyPayload()), panel, label);
      expect(cell.textContent).toBe("—");
      expect(cell.className).toContain("text-text-primary");
      expect(cell.className).not.toContain("text-accent");
      expect(cell.className).not.toContain("font-medium");
    });

    it(`control: ${label} keeps accent and weight 500 on a finite value`, () => {
      const cell = valueCell(renderRail(payloadFor(500, 0)), panel, label);
      expect(cell.textContent).not.toBe("—");
      expect(cell.className).toContain("text-accent");
      expect(cell.className).toContain("font-medium");
    });
  }
});

describe("RollingRow: the current Sharpe dash never carries accent (B14)", () => {
  it("a trailing flat window reads Sharpe Now '—' without accent", () => {
    const cell = valueCell(renderRail(payloadFor(300, 200)), "Rolling Metrics", "Sharpe");
    expect(cell.textContent).toBe("—");
    expect(cell.className).toContain("text-text-primary");
    expect(cell.className).not.toContain("text-accent");
    expect(cell.className).not.toContain("font-medium");
  });

  it("control: an active current window keeps accent", () => {
    const cell = valueCell(renderRail(payloadFor(500, 0)), "Rolling Metrics", "Sharpe");
    expect(cell.textContent).not.toBe("—");
    expect(cell.className).toContain("text-accent");
    expect(cell.className).toContain("font-medium");
  });
});

describe("Kpi: the quantile Median takes accent only on a finite value", () => {
  function median(payload: FactsheetPayload): HTMLElement {
    const { container } = render(
      <FactsheetProvider payload={payload} persist={false}>
        <QuantileBoxPlotPanel />
      </FactsheetProvider>,
    );
    const label = [...container.querySelectorAll("p")].find(p => p.textContent === "Median");
    if (!label) throw new Error("no Median Kpi");
    return label.nextElementSibling as HTMLElement;
  }

  it('reads "—" in the primary text colour when the view has no quantiles', () => {
    const v = median(emptyPayload());
    expect(v.textContent).toBe("—");
    expect(v.style.color).toBe("var(--color-text-primary)");
  });

  it("control: keeps the accent colour on a finite median", () => {
    const v = median(payloadFor(500, 0));
    expect(v.textContent).not.toBe("—");
    expect(v.style.color).toBe("var(--color-accent)");
  });
});
