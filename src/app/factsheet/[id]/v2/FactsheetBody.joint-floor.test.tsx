import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { buildFactsheetPayload } from "@/lib/factsheet/build-payload";
import type { BenchmarkPricesOpt } from "@/lib/factsheet/build-payload";
import type { DailyPrice, DailyReturn, FactsheetPayload } from "@/lib/factsheet/types";
import { MIN_PAIRED_OBSERVATIONS } from "@/lib/factsheet/joint";
import { FactsheetProvider } from "./factsheet-context";
import { FactsheetBody } from "./FactsheetView";

/**
 * 169.4 review round 2 (SFH-R2 MEDIUM-2). Below `MIN_PAIRED_OBSERVATIONS` the
 * comparator block builds no joint (D-69: no figure below the floor on any
 * surface). Round 1 left that as a silent drop: the KPI strip fell to 7 cells
 * and §IV vanished while the picker and chart still showed the comparator, so
 * the absence named no cause. The Allocations widget beside it names one.
 *
 * The case is the reviewer's own: a strategy starting 2026-04-27, whose SPX
 * pairing stops at the SPX fixture's last close (2026-05-08), so it pairs fewer
 * than 10 intervals with SPX while pairing 30 with BTC. With SPX active the
 * alpha/IR cells and §IV must stay, read "—", and carry the widget's sentence
 * ("this record has N"). With BTC active the figures render and no reason does.
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
  id: "s-169-4-r2-joint-floor",
  name: "Joint Floor Strategy",
  types: ["quant"],
  markets: ["crypto"],
  computedAt: "2026-09-30T00:00:00Z",
  trustTier: null,
  assetClass: "crypto",
  ingestSource: "api" as const,
};

const START = "2026-04-27";
const N_DAYS = 30;

function build(start: string = START): FactsheetPayload {
  const rows: DailyReturn[] = Array.from({ length: N_DAYS }, (_, i) => ({
    date: addDays(start, i),
    value: ((i % 7) - 3) / 1000,
  }));
  // BTC closes from the day before the first date through the last: every
  // interval pairs with BTC, so only SPX is below the floor.
  const btc: DailyPrice[] = Array.from({ length: N_DAYS + 1 }, (_, i) => ({
    date: addDays(start, i - 1),
    close: 90000 + ((i * 37) % 11) * 250,
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

function cellValue(label: string): string {
  const cell = screen.getByText(label).parentElement!;
  return cell.querySelectorAll("p")[1]?.textContent ?? "";
}

describe("below the paired floor the factsheet names the cause (169.4 review round 2, SFH-R2 MEDIUM-2)", () => {
  it("the SPX block carries the withheld marker with its paired count; the BTC block computes its joint", () => {
    const payload = build();
    const spx = payload.comparators.spx;
    expect(spx.joint).toBeNull();
    expect(spx.jointWithheld).not.toBeNull();
    expect(spx.jointWithheld!.floor).toBe(MIN_PAIRED_OBSERVATIONS);
    expect(spx.jointWithheld!.paired).toBeGreaterThan(0);
    expect(spx.jointWithheld!.paired).toBeLessThan(MIN_PAIRED_OBSERVATIONS);
    // The count is the pairing's, not the record length.
    expect(spx.jointWithheld!.paired).toBeLessThan(N_DAYS - 1);

    expect(payload.comparators.btc.joint).not.toBeNull();
    expect(payload.comparators.btc.jointWithheld).toBeNull();
  });

  it("SPX active: the α/IR cells stay and read \"—\", §IV stays with every row \"—\", and both name the paired count", () => {
    const base = build();
    const paired = base.comparators.spx.jointWithheld!.paired;
    mount({ ...base, activeComparator: "spx" });

    expect(cellValue("α vs SPX")).toBe("—");
    expect(cellValue("IR vs SPX")).toBe("—");

    const reason = `Alpha and beta need at least ${MIN_PAIRED_OBSERVATIONS} days paired with SPX; this record has ${paired}.`;
    const reasons = screen.getAllByTestId("joint-floor-reason");
    // One under the KPI strip, one in §IV.
    expect(reasons).toHaveLength(2);
    for (const r of reasons) expect(r.textContent).toBe(reason);

    expect(screen.getByText("Benchmark — vs SPX")).toBeTruthy();
    const alphaRow = screen.getByText("Alpha (ann)").closest("tr")!;
    expect(within(alphaRow).getAllByRole("cell")[1].textContent).toBe("—");
    const irRow = screen.getByText("Information Ratio").closest("tr")!;
    expect(within(irRow).getAllByRole("cell")[1].textContent).toBe("—");
  });

  it("a record wholly past the SPX fixture pairs 0 intervals: the cells read \"—\" and the reason says \"has 0\" (deliberate, as the widget's \"this book has 0\")", () => {
    const base = build("2026-06-01");
    expect(base.comparators.spx.joint).toBeNull();
    expect(base.comparators.spx.jointWithheld).toEqual({ paired: 0, floor: MIN_PAIRED_OBSERVATIONS });
    mount({ ...base, activeComparator: "spx" });
    expect(cellValue("α vs SPX")).toBe("—");
    for (const r of screen.getAllByTestId("joint-floor-reason")) {
      expect(r.textContent).toBe(`Alpha and beta need at least ${MIN_PAIRED_OBSERVATIONS} days paired with SPX; this record has 0.`);
    }
  });

  it("BTC active on the same record: the figures render and no floor reason does", () => {
    const base = build();
    mount({ ...base, activeComparator: "btc" });
    expect(cellValue("α vs BTC")).toMatch(/%$/);
    expect(screen.queryByTestId("joint-floor-reason")).toBeNull();
  });
});
