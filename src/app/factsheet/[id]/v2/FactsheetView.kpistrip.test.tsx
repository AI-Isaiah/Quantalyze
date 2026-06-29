import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import type { DailyPoint } from "@/lib/portfolio-math-utils";
import { buildScenarioFactsheetPayload } from "@/app/(dashboard)/allocations/widgets/performance/scenario-factsheet-payload";
import { FactsheetProvider } from "./factsheet-context";
import { FactsheetBody } from "./FactsheetView";

/**
 * Phase 52-06 / TYPE-04 / TYPE-02 / APPLY-01 — the FactsheetView KPI strip is
 * migrated from VIEWPORT breakpoints (`lg:grid-cols-9`) to CSS `@container`
 * queries so its column count reflows on ITS OWN width, not the window's, and
 * its raw `text-[Npx]` sizes are migrated onto the fluid `--text-*` tier spine.
 *
 * The three behaviors (52-06-PLAN Task 1 <behavior>):
 *   1. The KPI-strip region carries `@container`; its column count responds to
 *      container width via `@`-prefixed variants (NOT `lg:grid-cols-9`), with the
 *      `grid-cols-3` mobile fallback kept as a container-narrow variant.
 *   2. Every KPI metric VALUE cell keeps `font-mono tabular-nums` (alignment
 *      preserved under the fluid tier); the KPI LABEL keeps its
 *      `text-ellipsis whitespace-nowrap` bounded-label affordance (the
 *      AUDIT-classified legitimate clip at FactsheetView:647 — not removed).
 *   3. The factsheet shell stays `max-w-[1440px]` (measure NOT raised to 1920),
 *      and no fabricated zero appears for a degenerate metric (the body mounts
 *      honestly — the existing FactsheetBody.degenerate matrix stays green).
 *
 * Renders the REAL KpiStrip via the REAL FactsheetBody (mirrors the
 * FactsheetBody.degenerate.test.tsx render idiom + its localStorage/sentry stubs)
 * so the assertions gate the live DOM the route ships, not a copy.
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
vi.stubGlobal("localStorage", localStorageMock);
Object.defineProperty(window, "localStorage", {
  value: localStorageMock,
  configurable: true,
});

function makeReturnsSeries(n: number, drift = 0.0015): DailyPoint[] {
  const pts: DailyPoint[] = [];
  const d = new Date(Date.UTC(2023, 0, 1));
  for (let i = 0; i < n; i++) {
    pts.push({
      date: d.toISOString().slice(0, 10),
      value: drift + Math.sin(i * 0.27) * 0.005,
    });
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return pts;
}

function renderBody() {
  const payload = buildScenarioFactsheetPayload({
    portfolioDaily: makeReturnsSeries(300),
    benchmark: null,
  });
  return render(
    <FactsheetProvider payload={payload} persist={false}>
      <FactsheetBody payload={payload} scenarioMode hideAllocatorSection />
    </FactsheetProvider>,
  );
}

describe("FactsheetView KPI strip — @container + fluid-type migration (52-06 / TYPE-04)", () => {
  it("Test 1 — the KPI strip is its OWN container-query context (@container) and steps columns by @-prefixed variants, NOT lg:grid-cols-9", () => {
    const { container } = renderBody();

    // The KPI strip grid is the element carrying both `grid` and `@container`.
    const gridHosts = Array.from(
      container.querySelectorAll<HTMLElement>(".\\@container"),
    );
    expect(gridHosts.length).toBeGreaterThan(0);

    // The KPI-strip grid: a grid host whose column variants are @-prefixed.
    const kpiGrid = gridHosts.find(
      (el) =>
        el.className.includes("grid") &&
        /@[\w[\]-]*:grid-cols-\d/.test(el.className),
    );
    expect(
      kpiGrid,
      "the KPI strip must be a @container grid with @-prefixed grid-cols variants",
    ).toBeDefined();

    // The viewport breakpoint must be gone — column count now keys off the
    // CONTAINER width (the StrategyTable @container idiom), not the window.
    expect(kpiGrid!.className).not.toMatch(/\blg:grid-cols-9\b/);
    // The narrow mobile fallback is preserved as a container-narrow base.
    expect(kpiGrid!.className).toMatch(/\bgrid-cols-3\b/);
    // Size containment would collapse the strip's block size to 0 (Pitfall 1) —
    // the bare inline-size `@container` is deliberate.
    expect(kpiGrid!.className).not.toContain("@container-size");
  });

  it("Test 2 — every KPI VALUE cell keeps font-mono tabular-nums; the KPI LABEL keeps its text-ellipsis whitespace-nowrap bounded-label clip", () => {
    const { container } = renderBody();
    const gridHosts = Array.from(
      container.querySelectorAll<HTMLElement>(".\\@container"),
    );
    const kpiGrid = gridHosts.find(
      (el) =>
        el.className.includes("grid") &&
        /@[\w[\]-]*:grid-cols-\d/.test(el.className),
    )!;
    expect(kpiGrid).toBeDefined();

    // The KPI tiles are the direct children of the grid.
    const tiles = Array.from(kpiGrid.children) as HTMLElement[];
    expect(tiles.length).toBeGreaterThan(0);

    for (const tile of tiles) {
      const ps = Array.from(tile.querySelectorAll("p"));
      expect(ps.length).toBe(2); // label + value
      const [labelEl, valueEl] = ps;
      // VALUE cell: fixed glyph advance so the column aligns under the fluid tier.
      expect(valueEl.className).toContain("font-mono");
      expect(valueEl.className).toContain("tabular-nums");
      // VALUE cell keeps whitespace-nowrap (no wrap mid-number).
      expect(valueEl.className).toContain("whitespace-nowrap");
      // LABEL cell: the legitimate bounded-label clip is preserved (AUDIT :647).
      expect(labelEl.className).toContain("text-ellipsis");
      expect(labelEl.className).toContain("whitespace-nowrap");
    }
  });

  it("Test 3 — the factsheet shell stays max-w-[1440px] (measure NOT raised to 1920) and the body mounts with no fabricated NaN/Infinity", () => {
    const { container } = renderBody();
    const shell = container.querySelector(".factsheet-v2-shell");
    expect(shell).not.toBeNull();
    expect((shell as HTMLElement).className).toContain("max-w-[1440px]");
    expect((shell as HTMLElement).className).not.toContain("max-w-[1920px]");
    // Honesty floor: a degenerate metric formats to "—", never a fabricated 0.
    const html = container.innerHTML;
    expect(html).not.toContain("NaN");
    expect(html).not.toContain("Infinity");
  });
});
