/** @vitest-environment jsdom */
/**
 * Phase 169.4 CR-01 (review round 1, + SFH MEDIUM-1): when BTC is unavailable
 * (a failed read under D-54, or BTC's last close more than 14 days before the
 * strategy's last date), every BTC trace is dropped and every equity trace is
 * kept. Before the fix the api-arm factsheet then showed, side by side:
 *   - "Returns Signatures for 7 Days Horizon (0 wins · 0 losses)",
 *   - "Win Event · of BTC" drawn as a flat 0% mean and zero-width bands,
 *   - "Win Event · of Accumulated Capital" fully populated,
 * and the cross panels "BTC events (0W · 0L)" over flat-zero lines.
 *
 * This test renders both sections from a REAL payload built with the
 * unavailable BTC marker and asserts the honest form: each panel names its own
 * N, and a view with no trace renders the em-dash state, never a chart.
 */
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { buildFactsheetPayload } from "@/lib/factsheet/build-payload";
import type { BuildFactsheetOpts } from "@/lib/factsheet/build-payload";
import type { FactsheetPayload } from "@/lib/factsheet/types";

vi.mock("@/hooks/useBreakpoint", () => ({
  useBreakpoint: vi.fn(() => "desktop" as const),
}));

import { FactsheetProvider } from "./factsheet-context";
import { SignaturesSection } from "./SignaturePanels";
import { CrossSignaturesSection } from "./CrossSignaturePanels";

const DAY = 86_400_000;
const START = Date.parse("2025-06-01T00:00:00Z");

function makePayload(opts?: BuildFactsheetOpts): FactsheetPayload & { ingestSource: "api" } {
  const dailyReturns = Array.from({ length: 200 }, (_, i) => ({
    date: new Date(START + i * DAY).toISOString().slice(0, 10),
    value: (i % 2 === 0 ? 1 : -1) * (0.004 + (i % 5) * 0.001),
  }));
  const payload = buildFactsheetPayload(
    {
      id: "cr01-strategy",
      name: "CR-01 Strategy",
      types: ["quant"],
      markets: ["crypto"],
      computedAt: "2026-09-30T00:00:00Z",
      trustTier: null,
      ingestSource: "api",
    },
    dailyReturns,
    opts,
  );
  if (!payload || payload.ingestSource !== "api") throw new Error("fixture must build on the api arm");
  return payload;
}

function renderWith(payload: FactsheetPayload, node: React.ReactElement) {
  return render(<FactsheetProvider payload={payload}>{node}</FactsheetProvider>);
}

const figureTitles = (c: HTMLElement) =>
  Array.from(c.querySelectorAll("figure > header > p")).map(p => p.textContent ?? "");

describe("CR-01: BTC unavailable — SignaturesSection", () => {
  const payload = makePayload({ benchmarkPrices: { unavailable: true } });

  it("never prints a zero count and never draws a BTC chart; the BTC panels render the em-dash state", () => {
    const { container } = renderWith(payload, <SignaturesSection />);
    const text = container.textContent ?? "";
    expect(text).not.toMatch(/0 wins/);
    expect(text).not.toMatch(/0 losses/);
    // Two horizons × {win, loss} of the benchmark: four empty panels, no svg in them.
    const empty = container.querySelectorAll("figure[data-signature-empty]");
    expect(empty).toHaveLength(4);
    for (const f of Array.from(empty)) {
      expect(f.querySelector("svg")).toBeNull();
      expect(f.textContent).toContain("—");
      expect(f.textContent).toContain("Not measurable");
    }
    // The four equity panels still chart, each naming its own event count.
    expect(container.querySelectorAll("svg")).toHaveLength(4);
  });

  it("each equity panel's title carries the equity view's own count", () => {
    const { container } = renderWith(payload, <SignaturesSection />);
    const titles = figureTitles(container);
    const sigs = payload.eventSignatures!;
    expect(titles).toContain(`Win Event · of Accumulated Capital · ${sigs.h7.winCount} events`);
    expect(titles).toContain(`Loss Event · of Accumulated Capital · ${sigs.h7.lossCount} events`);
    expect(titles).toContain(`Win Event · of Accumulated Capital · ${sigs.h1.winCount} events`);
    expect(sigs.h1.winCount).toBeGreaterThan(0);
  });
});

describe("CR-01: BTC unavailable — CrossSignaturesSection", () => {
  const payload = makePayload({ benchmarkPrices: { unavailable: true } });

  it("prints no W · L count and draws no flat-zero line: all eight cross panels render the em-dash state", () => {
    const { container } = renderWith(payload, <CrossSignaturesSection />);
    const text = container.textContent ?? "";
    expect(text).not.toMatch(/0W/);
    expect(text).not.toMatch(/0L/);
    expect(container.querySelectorAll("figure[data-signature-empty]")).toHaveLength(8);
    expect(container.querySelectorAll("svg")).toHaveLength(0);
  });
});

describe("CR-01: BTC present — every panel charts and names its own N", () => {
  const payload = makePayload();

  it("SignaturesSection: eight charts, BTC panels titled with the benchmark-view count", () => {
    const { container } = renderWith(payload, <SignaturesSection />);
    expect(container.querySelectorAll("figure[data-signature-empty]")).toHaveLength(0);
    expect(container.querySelectorAll("svg")).toHaveLength(8);
    const sigs = payload.eventSignatures!;
    expect(sigs.h7.benchWinCount).toBeGreaterThan(0);
    expect(figureTitles(container)).toContain(`Win Event · of BTC · ${sigs.h7.benchWinCount} events`);
  });

  it("CrossSignaturesSection: eight charts, each titled with both populations' counts", () => {
    const { container } = renderWith(payload, <CrossSignaturesSection />);
    expect(container.querySelectorAll("svg")).toHaveLength(8);
    const s = payload.eventSignatures!.h1;
    const b = payload.benchEventSignatures!.h1;
    expect(figureTitles(container)).toContain(
      `Win Event · of Accumulated Capital · ${s.winCount} strategy / ${b.winCount} BTC events`,
    );
  });
});

/**
 * Phase 169.4 review round 2 CR-01 (+ SFH-R2 MEDIUM-1): both signature payloads
 * are BTC by construction (`build-payload.ts` `computeEventSignatures(stratRet,
 * btcAligned, …)` and `benchEventSignatures` from `btcAligned`). Before the fix
 * the panels took their label from the ACTIVE comparator, so with SPX picked
 * they read "Win Event · of SPX · 86 events" over BTC trajectories, and during a
 * BTC outage the em-dash reason blamed "SPX prices". These tests pick SPX through
 * `activeComparator` (the provider seeds the picker from it) and assert that no
 * rendered string names SPX, and that an outage is named as an outage.
 */
describe("R2 CR-01: the signatures are BTC whatever comparator is active", () => {
  const spxActive = (p: FactsheetPayload) => ({ ...p, activeComparator: "spx" as const });

  it("SignaturesSection with SPX active labels its benchmark panels BTC and never names SPX", () => {
    const payload = makePayload();
    const { container } = renderWith(spxActive(payload), <SignaturesSection />);
    expect(container.textContent ?? "").not.toContain("SPX");
    const sigs = payload.eventSignatures!;
    expect(figureTitles(container)).toContain(`Win Event · of BTC · ${sigs.h7.benchWinCount} events`);
    expect(figureTitles(container)).toContain(`Loss Event · of BTC · ${sigs.h7.benchLossCount} events`);
  });

  it("CrossSignaturesSection with SPX active names BTC in its subtitle, legend and counts, never SPX", () => {
    const payload = makePayload();
    const { container } = renderWith(spxActive(payload), <CrossSignaturesSection />);
    const text = container.textContent ?? "";
    expect(text).not.toContain("SPX");
    expect(text).toContain("BTC-indexed mean");
    expect(text).toContain("BTC events");
    const s = payload.eventSignatures!.h1;
    const b = payload.benchEventSignatures!.h1;
    expect(figureTitles(container)).toContain(
      `Win Event · of BTC · ${s.benchWinCount} strategy / ${b.benchWinCount} BTC events`,
    );
  });

  it("BTC outage with SPX active: every empty signature panel names the BTC outage, not SPX and not window completeness", () => {
    const payload = makePayload({ benchmarkPrices: { unavailable: true } });
    const { container } = renderWith(spxActive(payload), <SignaturesSection />);
    expect(container.textContent ?? "").not.toContain("SPX");
    const empty = Array.from(container.querySelectorAll("figure[data-signature-empty]"));
    expect(empty).toHaveLength(4);
    for (const f of empty) {
      expect(f.textContent).toContain("Not measurable: BTC prices are unavailable right now.");
      expect(f.textContent).not.toContain("±14-day window");
    }
  });

  it("BTC outage with SPX active: all eight cross panels name the BTC outage, not SPX and not window completeness", () => {
    const payload = makePayload({ benchmarkPrices: { unavailable: true } });
    const { container } = renderWith(spxActive(payload), <CrossSignaturesSection />);
    expect(container.textContent ?? "").not.toContain("SPX");
    const empty = Array.from(container.querySelectorAll("figure[data-signature-empty]"));
    expect(empty).toHaveLength(8);
    for (const f of empty) {
      expect(f.textContent).toContain("Not measurable: BTC prices are unavailable right now.");
      expect(f.textContent).not.toContain("±14-day window");
    }
  });

  it("BTC outage with BTC active: the reason is the outage, the same cause the allocator panel names", () => {
    const payload = makePayload({ benchmarkPrices: { unavailable: true } });
    const { container } = renderWith(payload, <SignaturesSection />);
    for (const f of Array.from(container.querySelectorAll("figure[data-signature-empty]"))) {
      expect(f.textContent).toContain("Not measurable: BTC prices are unavailable right now.");
    }
  });
});
