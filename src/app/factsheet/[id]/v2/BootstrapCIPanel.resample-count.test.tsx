/**
 * Phase 166.2 review round 2, SFH-R2-M2 and IN-01: the bootstrap panel must say
 * how many resamples a ratio rests on when some were dropped.
 *
 * Under founder decision D7 a resample with no Sharpe (no dispersion) or no
 * Sortino (no losing day) is dropped, not counted as 0. The CI and histogram
 * then rest on fewer draws than the caption's "2,000 resamples", and a
 * no-variance histogram's "all resamples produced X" is no longer true. A
 * reader must be told, or the interval looks better supported than it is.
 */
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { buildFactsheetPayload } from "@/lib/factsheet/build-payload";
import type { FactsheetPayload } from "@/lib/factsheet/types";

vi.mock("@/hooks/useBreakpoint", () => ({
  useBreakpoint: vi.fn(() => "desktop" as const),
}));

import { FactsheetProvider } from "./factsheet-context";
import { BootstrapCIPanel } from "./AnalyticalPanels";

function basePayload(): FactsheetPayload {
  const start = Date.UTC(2024, 0, 1);
  const daily = Array.from({ length: 400 }, (_, i) => ({
    date: new Date(start + i * 86_400_000).toISOString().slice(0, 10),
    value: Math.sin(i / 3) * 0.008 + 0.0005,
  }));
  const p = buildFactsheetPayload(
    {
      id: "bootstrap-count-fixture",
      name: "Bootstrap Count Fixture",
      types: ["test"],
      markets: ["crypto"],
      computedAt: "2026-06-27T00:00:00Z",
      trustTier: null,
      ingestSource: "csv",
    },
    daily,
  );
  if (!p) throw new Error("buildFactsheetPayload returned null");
  return p;
}

function renderWith(patch: (b: FactsheetPayload["bootstrapCI"]) => FactsheetPayload["bootstrapCI"]): string {
  const base = basePayload();
  const payload = { ...base, bootstrapCI: patch(base.bootstrapCI) } as FactsheetPayload;
  const { container, unmount } = render(
    <FactsheetProvider payload={payload} persist={false}>
      <BootstrapCIPanel />
    </FactsheetProvider>,
  );
  const text = container.textContent ?? "";
  unmount();
  return text;
}

describe("BootstrapCIPanel names the resamples a ratio rests on (SFH-R2-M2, IN-01)", () => {
  it("control: every resample has both ratios, so the caption carries no count", () => {
    const text = renderWith((b) => b);
    expect(text).toContain("2,000 stationary block-bootstrap resamples");
    expect(text).not.toMatch(/from [\d,]+ of 2,000 resamples/);
  });

  it("the caption says how many resamples have a Sharpe and a Sortino when some were dropped", () => {
    const text = renderWith((b) => ({
      ...b,
      sharpe: { ...b.sharpe, n_valid: 1987 },
      sortino: { ...b.sortino, n_valid: 1500 },
    }));
    expect(text).toContain("Sharpe from 1,987 of 2,000 resamples");
    expect(text).toContain("Sortino from 1,500 of 2,000 resamples");
  });

  it("a no-variance histogram over the surviving resamples does not claim ALL resamples produced it", () => {
    const text = renderWith((b) => ({
      ...b,
      sharpe: { ...b.sharpe, point: 1.25, hist: { lo: 1.25, hi: 1.25, bins: [], degenerate: true }, n_valid: 300 },
    }));
    expect(text).toContain("all 300 of 2,000 resamples with a Sharpe produced 1.25");
    expect(text).not.toContain("all resamples produced 1.25");
  });

  it("control: a no-variance histogram where every resample has the ratio still reads 'all resamples produced'", () => {
    const text = renderWith((b) => ({
      ...b,
      sharpe: { ...b.sharpe, point: 1.25, hist: { lo: 1.25, hi: 1.25, bins: [], degenerate: true }, n_valid: 2000 },
    }));
    expect(text).toContain("all resamples produced 1.25");
  });

  it("a payload cached before n_valid existed reads as all resamples (no count, no crash)", () => {
    const text = renderWith((b) => {
      const { n_valid: _s, ...sharpe } = b.sharpe;
      const { n_valid: _o, ...sortino } = b.sortino;
      return { ...b, sharpe, sortino };
    });
    expect(text).not.toMatch(/from [\d,]+ of 2,000 resamples/);
    expect(text).not.toContain("NaN");
  });
});
