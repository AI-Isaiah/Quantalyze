/** @vitest-environment jsdom */
/**
 * Phase 169.5 BENCHCOMPARE (SC3, 169 D-54 / D-64) — the page's two other method
 * notes describe the comparator alignment the numbers now use.
 *
 * Why this matters: plan 169.5-03 fixed the carried-forward claim in the Mandate
 * panels (MandatePanels.comparator-coverage.test.tsx). The same claim stood in two
 * more places a reader checks method: the correlation strip's caption and the
 * page footer's disclaimer. Since 169.5-01, every ρ is computed over the intervals
 * paired for both legs (`pairedCorr`), and no benchmark is carried across a date
 * it has no close for, so both notes described a fill the page no longer
 * performs. Each is pinned by literal here; the old wording is asserted absent.
 *
 * The wording claims no zero first day and not that every interval enters ρ: an
 * interval a benchmark lacks a close for (at an endpoint or inside it) does not.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import { buildFactsheetPayload } from "@/lib/factsheet/build-payload";
import type { FactsheetPayload } from "@/lib/factsheet/types";
import { FactsheetProvider } from "./factsheet-context";
import { FactsheetBody } from "./FactsheetView";
import { CorrelationStripPanel } from "./DistributionPanels";

vi.mock("@/lib/sentry-capture", () => ({ captureToSentry: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

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
const START = Date.UTC(2024, 0, 1);

/** 200 consecutive calendar days from 2024-01-01, inside every bundled fixture. */
function payload200(): FactsheetPayload {
  const points = Array.from({ length: 200 }, (_, i) => ({
    date: new Date(START + i * DAY).toISOString().slice(0, 10),
    value: Math.sin(i / 9) * 0.005,
  }));
  const built = buildFactsheetPayload(
    {
      id: "benchmark-method-copy-test",
      name: "Benchmark Method Copy Test",
      types: ["test"],
      markets: ["crypto"],
      computedAt: "2026-09-30T00:00:00Z",
      trustTier: null,
      ingestSource: "api",
    },
    points,
  );
  if (!built) throw new Error("buildFactsheetPayload returned null in test");
  return built;
}

const flat = (el: Element | null) => (el?.textContent ?? "").replace(/\s+/g, " ");

describe("the page's method notes describe the paired-interval comparator (SC3)", () => {
  it("the correlation strip's caption states the paired intervals, not a fill", () => {
    const payload = payload200();
    const { container } = render(
      <FactsheetProvider payload={payload} persist={false}>
        <CorrelationStripPanel />
      </FactsheetProvider>,
    );
    const text = flat(container);
    expect(text).toContain(
      "ρ measured over the strategy's own intervals, using only those each benchmark has every close for.",
    );
    expect(text).not.toMatch(/forward-fill/i);
  });

  it("the footer's disclaimer describes benchmarks the same way", () => {
    const payload = payload200();
    const { container } = render(
      <FactsheetProvider payload={payload} persist={false}>
        <FactsheetBody payload={payload} hideAllocatorSection />
      </FactsheetProvider>,
    );
    const footer = flat(container.querySelector("footer"));
    expect(footer).toContain(
      "Benchmark returns are taken from daily closes over the strategy's own intervals, never past a benchmark's last close.",
    );
    expect(footer).toContain("Risk-free rate set to 0%.");
    expect(footer).not.toMatch(/forward-fill/i);
  });
});
