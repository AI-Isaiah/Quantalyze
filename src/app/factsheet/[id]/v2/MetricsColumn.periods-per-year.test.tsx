/** @vitest-environment jsdom */
/**
 * Phase 167.1.2 plan 07 (success criterion 5b): MetricsColumn's observation
 * warning reads the payload's annualisation basis, `periodsPerYear`, and never
 * assumes 252.
 *
 * Why this matters: the allocator's book is crypto, calendar-daily and
 * annualises at 365. With a literal 252 the warning told a 300-day crypto book
 * it had 1.19 years of data and cleared the "under a year" warning at 252
 * observations, which on that book is 69% of a year. A payload WITHOUT a basis
 * hides the warning: guessing 252 on a 365 book is the defect itself.
 *
 * The Scenario arm (W2) renders the composer's own payload. Its builder resolved
 * `periodsPerYear` for its compute() calls but did not put it on the payload,
 * so hiding on an absent value would have blanked a warning the Scenario
 * surface has a basis for. Carrying the basis also makes the payload
 * leverage-eligible, and the factsheet's whole-blend LEVERAGE input must not
 * appear inside the composer, which already levers each constituent.
 *
 * The 3 Year / 5 Year rows are NOT tested here (D-14: Phase 169 plan 07 owns
 * the period look-backs and re-computes them on calendar dates).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import { buildFactsheetPayload } from "@/lib/factsheet/build-payload";
import type { FactsheetPayload } from "@/lib/factsheet/types";
import { buildScenarioFactsheetPayload } from "@/app/(dashboard)/allocations/widgets/performance/scenario-factsheet-payload";

import { FactsheetProvider } from "./factsheet-context";
import { FactsheetBody } from "./FactsheetView";
import { MetricsColumn } from "./MetricsColumn";

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

/** `n` consecutive calendar-day returns starting 2024-01-01. */
function dailies(n: number): { date: string; value: number }[] {
  const start = Date.UTC(2024, 0, 1);
  return Array.from({ length: n }, (_, i) => ({
    date: new Date(start + i * 86_400_000).toISOString().slice(0, 10),
    value: Math.sin(i / 7) * 0.01,
  }));
}

/** A real built payload with `n` observations and the given basis. `undefined`
 *  OMITS the key (destructured away), so "absent" is really absent. */
function payloadWith(n: number, periodsPerYear: number | undefined): FactsheetPayload {
  const built = buildFactsheetPayload(
    {
      id: "ppy-test",
      name: "PPY Test",
      types: ["test"],
      markets: ["crypto"],
      computedAt: "2026-09-27T00:00:00Z",
      trustTier: null,
      ingestSource: "api",
    },
    dailies(n),
  );
  if (!built) throw new Error("buildFactsheetPayload returned null in test");
  const { periodsPerYear: _drop, ...rest } = built;
  void _drop;
  return periodsPerYear === undefined
    ? (rest as FactsheetPayload)
    : ({ ...rest, periodsPerYear } as FactsheetPayload);
}

function renderColumn(payload: FactsheetPayload) {
  return render(
    <FactsheetProvider payload={payload} persist={false}>
      <MetricsColumn />
    </FactsheetProvider>,
  );
}

/** The Main Metrics observation warning, or null when it is not rendered. */
function warningText(container: HTMLElement): string | null {
  const p = [...container.querySelectorAll("p")].find((el) =>
    (el.textContent ?? "").includes("observations ("),
  );
  return p ? (p.textContent ?? "").replace(/\s+/g, " ").trim() : null;
}

describe("MetricsColumn observation warning follows payload.periodsPerYear (SC-5b)", () => {
  it("a 365 book with 300 observations reads 0.82y and names 365 observations as the threshold", () => {
    const { container } = renderColumn(payloadWith(300, 365));
    const w = warningText(container);
    expect(w).not.toBeNull();
    expect(w).toContain("Only 300 observations (0.82y)");
    expect(w).toContain("Conventional reliability threshold is ≥ 365 observations (1 year).");
    expect(w).not.toContain("252");
  });

  it("a 365 book with 400 observations shows no 'Only N observations' warning", () => {
    const { container } = renderColumn(payloadWith(400, 365));
    expect(warningText(container)).toBeNull();
    expect(container.textContent).not.toContain("Only 400 observations");
  });

  it("a 252 book with 200 observations reads 0.79y and names 252 observations as the threshold", () => {
    const { container } = renderColumn(payloadWith(200, 252));
    const w = warningText(container);
    expect(w).not.toBeNull();
    expect(w).toContain("Only 200 observations (0.79y)");
    expect(w).toContain("Conventional reliability threshold is ≥ 252 observations (1 year).");
  });

  it("a payload with NO periodsPerYear hides the warning and its threshold sentence (no 252 assumed)", () => {
    const { container } = renderColumn(payloadWith(200, undefined));
    expect(warningText(container)).toBeNull();
    expect(container.textContent).not.toContain("Conventional reliability threshold");
  });
});

describe("the Scenario surface's payload carries its basis to MetricsColumn (W2)", () => {
  it("buildScenarioFactsheetPayload at 365 with 300 observations: the warning reads 365, not hidden", () => {
    const payload = buildScenarioFactsheetPayload({
      portfolioDaily: dailies(300),
      periodsPerYear: 365,
    });
    const { container } = renderColumn(payload);
    const w = warningText(container);
    expect(w).not.toBeNull();
    expect(w).toContain("Only 300 observations (0.82y)");
    expect(w).toContain("≥ 365 observations (1 year).");
  });

  it("buildScenarioFactsheetPayload with no basis argument uses its own 252 default, not hidden", () => {
    const payload = buildScenarioFactsheetPayload({ portfolioDaily: dailies(200) });
    const { container } = renderColumn(payload);
    const w = warningText(container);
    expect(w).not.toBeNull();
    expect(w).toContain("Only 200 observations (0.79y)");
    expect(w).toContain("≥ 252 observations (1 year).");
  });

  it("the composer's factsheet body shows no whole-blend LEVERAGE input although the payload now carries a basis", () => {
    const payload = buildScenarioFactsheetPayload({
      portfolioDaily: dailies(120),
      periodsPerYear: 365,
    });
    expect(payload.periodsPerYear).toBe(365);
    const { container } = render(
      <FactsheetProvider payload={payload} persist={false}>
        <FactsheetBody payload={payload} scenarioMode hideHeader hideAllocatorSection hideFooter={false} />
      </FactsheetProvider>,
    );
    expect(container.querySelector("#leverage-factsheet")).toBeNull();
  });
});
