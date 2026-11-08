/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { buildFactsheetPayload } from "@/lib/factsheet/build-payload";
import type { BenchmarkPricesOpt } from "@/lib/factsheet/build-payload";
import type { DailyPrice, DailyReturn, FactsheetPayload } from "@/lib/factsheet/types";
import { figureRecord, widenedWithheldReason } from "@/lib/figure-gate";
import { FactsheetProvider } from "./factsheet-context";
import { FactsheetBody } from "./FactsheetView";

/**
 * Phase 194 review R5 WR-04 and SFH-M2 (D-17): the "could not be read" UI branches.
 *
 * A comparator whose paired span could not be read carries `jointAnnualization.unreadable`, and
 * the strip (FactsheetView KpiStrip) and the rail (MetricsColumn section IV) each turn it into the
 * reason line. If either branch is deleted or reordered the marker falls into the generic
 * `withheld` arm, which, beside a record that clears, prints a LENGTH-based reason ("...appear
 * once the record reaches 90 days. This record covers 400 days.") that contradicts the figures
 * shown. Each case asserts the sentence, and that no length-based sentence appears.
 *
 * SFH-M2: a comparator whose own covered span could not be read dashes the benchmark column; the
 * rail then names why, instead of leaving five bare dashes.
 */

vi.mock("@/lib/sentry-capture", () => ({ captureToSentry: vi.fn() }));

const lsStore = new Map<string, string>();
beforeEach(() => {
  lsStore.clear();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => lsStore.get(k) ?? null,
    setItem: (k: string, v: string) => void lsStore.set(k, v),
    removeItem: (k: string) => void lsStore.delete(k),
    clear: () => lsStore.clear(),
    key: () => null,
    length: 0,
  });
});

const DAY = 86_400_000;
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const START = "2024-01-01";
const N = 400;

const STRATEGY = {
  id: "s-194-r5-unreadable",
  name: "Unreadable Reason Strategy",
  types: ["quant"],
  markets: ["crypto"],
  computedAt: "2026-09-30T00:00:00Z",
  trustTier: null,
  assetClass: "crypto",
  ingestSource: "api" as const,
};

/** A readable 400-day crypto record that clears D-15 (the strategy's own cells show). */
function build(): FactsheetPayload {
  const rows: DailyReturn[] = Array.from({ length: N }, (_, i) => ({
    date: addDays(START, i),
    value: 0.0009 + Math.sin(i * 0.31) * 0.012 + Math.cos(i * 0.07) * 0.004,
  }));
  const btc: DailyPrice[] = Array.from({ length: N + 1 }, (_, i) => ({
    date: addDays(START, i - 1),
    close: 40000 * (1 + 0.15 * Math.sin(i * 0.05)) + ((i * 37) % 11) * 120,
  }));
  const opt: BenchmarkPricesOpt = { prices: btc, through: btc[btc.length - 1].date, dropped: [] };
  const payload = buildFactsheetPayload(STRATEGY, rows, { benchmarkPrices: opt });
  if (!payload) throw new Error("fixture must build a payload");
  return payload;
}

function mount(payload: FactsheetPayload) {
  return render(
    <FactsheetProvider payload={payload} persist={false}>
      <FactsheetBody payload={payload} hideHeader hideAllocatorSection hideFooter />
    </FactsheetProvider>,
  );
}

/** The builder's own block for a readable payload, with `over` laid on the BTC comparator. */
function withBtc(payload: FactsheetPayload, over: Partial<FactsheetPayload["comparators"]["btc"]>): FactsheetPayload {
  const { jointAnnualization: _drop, ...rest } = payload.comparators.btc;
  void _drop;
  return {
    ...payload,
    activeComparator: "btc",
    comparators: { ...payload.comparators, btc: { ...rest, ...over } },
  };
}

const LENGTH_BASED = /covers|reaches|\bhas\b/;

describe("the strip and the rail say 'could not be read' for an unreadable overlap (R5 WR-04)", () => {
  const unreadableOverlap = () => {
    const p = build();
    // The strategy's own record clears: its cells show, so only the overlap is unreadable.
    expect(p.figureRecord!.spanDays).toBe(N);
    expect(p.figureRecord!.unreadable).toBeUndefined();
    return withBtc(p, { jointAnnualization: { state: "withheld", days: 0, unreadable: true } });
  };
  const expected = () =>
    widenedWithheldReason("overlap", { ...build().figureRecord!, unreadable: true });

  it("KpiStrip: the one strip note carries the unreadable sentence, never a length", () => {
    mount(unreadableOverlap());
    const note = screen.getByTestId("strip-figure-gate-note").textContent ?? "";
    expect(note).toContain(expected());
    expect(note).toContain("could not be read");
    expect(note).not.toMatch(LENGTH_BASED);
  });

  it("MetricsColumn section IV: the joint note carries the unreadable sentence, never a length", () => {
    mount(unreadableOverlap());
    const note = screen.getByTestId("joint-annualization-note").textContent ?? "";
    expect(note).toBe(expected());
    expect(note).not.toMatch(LENGTH_BASED);
  });

  it("control: a plain withheld marker on the same cleared record still prints the length sentence (the branch, not the text, is what differs)", () => {
    const p = withBtc(build(), { jointAnnualization: { state: "withheld", days: 40 } });
    mount(p);
    expect(screen.getByTestId("joint-annualization-note").textContent).toBe(
      widenedWithheldReason("overlap", p.figureRecord!),
    );
  });
});

describe("the rail names why the benchmark column is dashed when its covered span could not be read (R5 SFH-M2)", () => {
  it("the bench note says the dates could not be read, and names the benchmark", () => {
    const p = withBtc(build(), { coveredSpanUnreadable: true });
    mount(p);
    const note = screen.getByTestId("bench-figure-gate-note").textContent ?? "";
    expect(note.startsWith(`${p.comparators.btc.shortName}: `)).toBe(true);
    expect(note).toContain("could not be read");
    expect(note).not.toMatch(LENGTH_BASED);
  });

  it("a readable block prints no such note", () => {
    mount(build());
    expect(screen.queryByTestId("bench-figure-gate-note")).toBeNull();
  });

  it("a strategy record that is itself under the minimum keeps its own reason, not the benchmark's", () => {
    const p = build();
    const short = figureRecord({ seriesStart: START, seriesEnd: addDays(START, 40), observations: null, periodsPerYear: 365 });
    mount(withBtc({ ...p, figureRecord: short }, { coveredSpanUnreadable: true }));
    expect(screen.queryByTestId("bench-figure-gate-note")).toBeNull();
  });
});
