import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within, fireEvent, act } from "@testing-library/react";
import { buildFactsheetPayload } from "@/lib/factsheet/build-payload";
import type { BenchmarkPricesOpt } from "@/lib/factsheet/build-payload";
import type { DailyPrice, DailyReturn, FactsheetPayload } from "@/lib/factsheet/types";
import { flatLegReason, pairedFloorReason } from "@/lib/factsheet/joint";
import { FactsheetProvider, useXRange } from "./factsheet-context";
import { FactsheetBody } from "./FactsheetView";

/**
 * Phase 164.6.6.3.3 FACTSHEETTRUTH, D-04 (B13), UI-SPEC section 2. A strategy leg
 * with no dispersion reads "—" for Alpha (ann), Beta, Information Ratio, Up Capture
 * and Down Capture in §IV and for the strip's `α vs {cn}` and `IR vs {cn}`, with
 * exactly one muted reason line per slot. Correlation, R² and Treynor read "—" as
 * they always did; Tracking Error keeps its number (the benchmark's own volatility).
 *
 * The precedence is native-unit, then the paired floor, then flat leg, and the two
 * reasons can never co-render: each slot holds at most one `joint-*-reason`.
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
const addDays = (d: string, n: number) =>
  new Date(Date.parse(`${d}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);

const STRATEGY = {
  id: "s-164-6-6-3-3-flat-leg",
  name: "Flat Leg Strategy",
  types: ["quant"],
  markets: ["crypto"],
  computedAt: "2026-09-30T00:00:00Z",
  trustTier: null,
  assetClass: "crypto",
  ingestSource: "api" as const,
};

const START = "2026-04-27";
const N_DAYS = 30;

/** A record of `N_DAYS` zero returns against a BTC series that moves every day. */
function build(start: string = START, value: (i: number) => number = () => 0, n: number = N_DAYS): FactsheetPayload {
  const rows: DailyReturn[] = Array.from({ length: n }, (_, i) => ({ date: addDays(start, i), value: value(i) }));
  const btc: DailyPrice[] = Array.from({ length: n + 1 }, (_, i) => ({
    date: addDays(start, i - 1),
    close: 90000 + ((i * 37) % 11) * 250 + i * 3,
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

/** The value cell of a Section IV row, by its label. */
function rowCell(label: string): HTMLElement {
  const row = screen.getByText(label).closest("tr")!;
  return within(row).getAllByRole("cell")[1];
}

describe("a flat strategy leg on the factsheet (D-04, B13), Section IV", () => {
  it("the BTC block is a flat-leg block with a computed joint", () => {
    const btc = build().comparators.btc;
    expect(btc.joint).not.toBeNull();
    expect(btc.flatLeg).toBe(true);
    expect(btc.jointWithheld).toBeNull();
  });

  it("Alpha (ann), Beta, Information Ratio, Up Capture and Down Capture read \"—\"; Correlation, R² and Treynor too", () => {
    mount({ ...build(), activeComparator: "btc" });
    for (const label of ["Alpha (ann)", "Beta", "Information Ratio", "Up Capture", "Down Capture", "Correlation", "R²", "Treynor"]) {
      expect(rowCell(label).textContent, label).toBe("—");
    }
  });

  it("Tracking Error keeps its number, the benchmark's own volatility", () => {
    mount({ ...build(), activeComparator: "btc" });
    expect(rowCell("Tracking Error").textContent).toMatch(/^\d+\.\d+%$/);
  });

  it("exactly one reason line in Section IV: the flat-leg sentence, never the floor's", () => {
    mount({ ...build(), activeComparator: "btc" });
    const inFour = screen.getByText("Benchmark — vs BTC").closest("section")!;
    const own = inFour.querySelectorAll('[data-testid^="joint-"][data-testid$="-reason"]');
    expect(own).toHaveLength(1);
    expect(own[0].getAttribute("data-testid")).toBe("joint-flat-leg-reason");
    expect(own[0].textContent).toBe(
      "Alpha, beta, information ratio and capture need daily returns that vary; this record's do not.",
    );
    expect(own[0].textContent).toBe(flatLegReason("record"));
    expect(screen.queryByTestId("joint-floor-reason")).toBeNull();
  });

  it("the Alpha value cell carries no accent class (a dash is never accented)", () => {
    mount({ ...build(), activeComparator: "btc" });
    const cell = rowCell("Alpha (ann)");
    expect(cell.className).not.toMatch(/text-accent/);
    expect(cell.innerHTML).not.toMatch(/text-accent/);
  });

  it("control: a leg that varies shows numbers in §IV and no flat-leg reason", () => {
    mount({ ...build(START, i => ((i % 7) - 3) / 1000), activeComparator: "btc" });
    expect(rowCell("Beta").textContent).toMatch(/^-?\d+\.\d{2}$/);
    expect(rowCell("Alpha (ann)").textContent).toMatch(/%$/);
    expect(screen.queryByTestId("joint-flat-leg-reason")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The KPI strip (Task 2): the same "—" cells and the same one line (UI-SPEC 2).
// ---------------------------------------------------------------------------

const FLAT_SENTENCE = "Alpha, beta, information ratio and capture need daily returns that vary; this record's do not.";
const REASON_SEL = '[data-testid^="joint-"][data-testid$="-reason"]';

/** Reason elements under the strip and inside §IV, kept apart so each slot is counted on its own. */
function reasonsBySlot(): { strip: Element[]; four: Element[] } {
  const all = Array.from(document.querySelectorAll(REASON_SEL));
  const heading = screen.queryByText(/^Benchmark — vs /);
  const sectionFour = heading ? heading.closest("section") : null;
  const four = all.filter(el => sectionFour != null && sectionFour.contains(el));
  return { strip: all.filter(el => !four.includes(el)), four };
}

function stripCell(label: string): HTMLElement {
  const lab = screen.getAllByTestId("factsheet-kpi-label").find(l => l.textContent === label);
  if (!lab) throw new Error(`no strip cell ${label}`);
  return lab.parentElement!.querySelector('[data-testid="factsheet-kpi-value"]') as HTMLElement;
}

function RangeHarness({ range }: { range: readonly [number, number] }) {
  const { setXRange } = useXRange();
  return <button data-testid="zoom" onClick={() => setXRange(range)}>zoom</button>;
}

describe("a flat strategy leg on the factsheet (D-04, B13), the KPI strip", () => {
  it("BTC active: α and IR read \"—\" in the primary colour and one strip line carries the sentence", () => {
    mount({ ...build(), activeComparator: "btc" });
    for (const label of ["α vs BTC", "IR vs BTC"]) {
      const cell = stripCell(label);
      expect(cell.textContent, label).toBe("—");
      expect(cell.style.color, label).toBe("var(--color-text-primary)");
    }
    const { strip, four } = reasonsBySlot();
    expect(strip).toHaveLength(1);
    expect(strip[0].getAttribute("data-testid")).toBe("joint-flat-leg-reason");
    expect(strip[0].textContent).toBe(FLAT_SENTENCE);
    expect(four).toHaveLength(1);
  });

  it("the strip keeps its nine cells", () => {
    mount({ ...build(), activeComparator: "btc" });
    expect(screen.getAllByTestId("factsheet-kpi-value")).toHaveLength(9);
  });

  it("control: a leg that varies shows numbers in the α/IR cells and no flat-leg line anywhere", () => {
    mount({ ...build(START, i => ((i % 7) - 3) / 1000), activeComparator: "btc" });
    expect(stripCell("α vs BTC").textContent).toMatch(/%$/);
    expect(stripCell("IR vs BTC").textContent).toMatch(/^-?\d+\.\d{2}$/);
    expect(reasonsBySlot()).toEqual({ strip: [], four: [] });
  });

  it("no comparator selected: no α/IR cells and no reason line", () => {
    mount({ ...build(), activeComparator: "none" });
    expect(screen.getAllByTestId("factsheet-kpi-value")).toHaveLength(7);
    expect(reasonsBySlot()).toEqual({ strip: [], four: [] });
  });

  it("inside a selected range that is flat the line says \"the selected range's do not\"; the full record that varies had none", async () => {
    // 400 days: the first 200 vary, the rest are zero. [250, 349] is wholly flat.
    const base = build("2024-01-01", i => (i < 200 ? ((i % 7) - 3) / 1000 : 0), 400);
    expect("flatLeg" in base.comparators.btc).toBe(false);
    render(
      <FactsheetProvider payload={{ ...base, activeComparator: "btc" }} persist={false}>
        <RangeHarness range={[250, 349]} />
        <FactsheetBody payload={{ ...base, activeComparator: "btc" }} hideHeader hideAllocatorSection hideFooter />
      </FactsheetProvider>,
    );
    expect(reasonsBySlot()).toEqual({ strip: [], four: [] });
    await act(async () => {
      fireEvent.click(screen.getByTestId("zoom"));
    });
    const { strip } = reasonsBySlot();
    expect(strip).toHaveLength(1);
    expect(strip[0].textContent).toBe(flatLegReason("range"));
    expect(strip[0].textContent).toBe(
      "Alpha, beta, information ratio and capture need daily returns that vary; the selected range's do not.",
    );
    expect(stripCell("α vs BTC").textContent).toBe("—");
    expect(stripCell("IR vs BTC").textContent).toBe("—");
  });

  it("a flat leg that also sits below the paired floor shows ONLY the floor line, once per slot (the floor wins)", () => {
    // SPX pairs fewer than 10 intervals with this record (joint null) while the leg is flat.
    const base = build();
    const spx = base.comparators.spx;
    expect(spx.joint).toBeNull();
    expect(spx.jointWithheld).not.toBeNull();
    expect("flatLeg" in spx).toBe(false);
    mount({ ...base, activeComparator: "spx" });
    const { strip, four } = reasonsBySlot();
    for (const slot of [strip, four]) {
      expect(slot).toHaveLength(1);
      expect(slot[0].getAttribute("data-testid")).toBe("joint-floor-reason");
      expect(slot[0].textContent).toBe(
        pairedFloorReason("SPX", spx.jointWithheld!.paired, "record", spx.jointWithheld!.floor),
      );
    }
    expect(screen.queryByTestId("joint-flat-leg-reason")).toBeNull();
  });

  it("a flat leg under a native unit shows only the native-unit treatment, never the flat-leg line", () => {
    mount({ ...build(), returnsUnit: "BTC", activeComparator: "none" } as FactsheetPayload);
    expect(screen.queryByTestId("joint-flat-leg-reason")).toBeNull();
    const { strip, four } = reasonsBySlot();
    expect(strip).toHaveLength(0);
    expect(four).toHaveLength(1);
    expect(four[0].textContent).toMatch(/^Not measurable: /);
  });
});
