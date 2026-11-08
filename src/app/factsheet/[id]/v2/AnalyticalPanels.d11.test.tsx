/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render } from "@testing-library/react";
import { buildFactsheetPayload } from "@/lib/factsheet/build-payload";
import type { BenchmarkPricesOpt } from "@/lib/factsheet/build-payload";
import type { DailyPrice, DailyReturn, FactsheetPayload } from "@/lib/factsheet/types";
import type { FigureRecord } from "@/lib/figure-gate";
import { FactsheetProvider } from "./factsheet-context";
import { MetricsColumn } from "./MetricsColumn";
import { pct, ratio } from "./format";

/**
 * Phase 194 plan 15 (TRUST-05, D-04 / D-13 as superseded by D-15) - Bootstrap 95% Confidence
 * and Calmar by Year on the factsheet rail.
 *
 * Bootstrap follows the TOTAL record's verdict (a selected range never withholds; only the
 * record does): Sharpe and Sortino are annualized, Max Drawdown is not. Calmar by Year is
 * deliberately NOT gated. Each case states why it matters.
 */

vi.mock("@/lib/sentry-capture", () => ({ captureToSentry: vi.fn() }));
vi.mock("@/hooks/useBreakpoint", () => ({ useBreakpoint: vi.fn(() => "desktop" as const) }));

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
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-30T12:00:00Z"));
});
afterEach(() => {
  vi.useRealTimers();
});

const DAY = 86_400_000;
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);

const STRATEGY = {
  id: "s-194-15-analytical",
  name: "Analytical Panels Strategy",
  types: ["quant"],
  markets: ["crypto"],
  computedAt: "2026-09-30T00:00:00Z",
  trustTier: null,
  assetClass: "crypto",
  ingestSource: "api" as const,
};

const crypto = (spanDaysN: number): FigureRecord => ({ spanDays: spanDaysN, observations: null, crypto: true });

function buildWith(n: number, record: FigureRecord | null): FactsheetPayload {
  const rows: DailyReturn[] = Array.from({ length: n }, (_, i) => ({
    date: addDays("2024-01-01", i),
    value: 0.0009 + Math.sin(i * 0.31) * 0.012 + Math.cos(i * 0.07) * 0.004,
  }));
  const btc: DailyPrice[] = Array.from({ length: n + 1 }, (_, i) => ({
    date: addDays("2024-01-01", i - 1),
    close: 40000 * (1 + 0.15 * Math.sin(i * 0.05)) + ((i * 37) % 11) * 120,
  }));
  const opt: BenchmarkPricesOpt = { prices: btc, through: btc[btc.length - 1].date, dropped: [] };
  const payload = buildFactsheetPayload(STRATEGY, rows, { benchmarkPrices: opt });
  if (!payload) throw new Error("fixture must build a payload");
  return { ...payload, figureRecord: record };
}

function mount(payload: FactsheetPayload) {
  return render(
    <FactsheetProvider payload={payload} persist={false}>
      <MetricsColumn />
    </FactsheetProvider>,
  );
}

function panel(title: string): HTMLElement {
  const h = [...document.querySelectorAll("h3")].find((el) => el.textContent === title);
  const p = h?.closest("section") as HTMLElement | null;
  if (!p) throw new Error(`no panel titled "${title}"`);
  return p;
}

/** The (point, interval) cells of a Bootstrap row. */
function bootRow(label: string): [string, string] {
  const tr = [...panel("Bootstrap 95% Confidence").querySelectorAll("tbody tr")].find(
    (r) => r.querySelector("td")?.textContent === label,
  );
  if (!tr) throw new Error(`no Bootstrap row "${label}"`);
  const tds = tr.querySelectorAll("td");
  return [tds[1].textContent ?? "", tds[2].textContent ?? ""];
}

const sparklines = () => document.querySelector('[data-testid="bootstrap-sparklines"]')?.textContent ?? "";
const lowNSentence = () =>
  [...panel("Bootstrap 95% Confidence").querySelectorAll("p")].find((p) =>
    (p.textContent ?? "").includes("Bootstrap resamples are drawn from"),
  );

describe("Bootstrap 95% Confidence - follows the total record (D-04)", () => {
  it("withheld: Sharpe and Sortino print a dash for point and interval and neither sparkline is drawn; Max Drawdown row and sparkline stay", () => {
    // Why it matters: Sharpe and Sortino are annualized, so a 60-day record must not print a CI
    // for them; Max Drawdown is not annualized, so it keeps its real interval.
    const payload = buildWith(61, crypto(60));
    mount(payload);
    expect(bootRow("Sharpe")).toEqual(["—", "[—, —]"]);
    expect(bootRow("Sortino")).toEqual(["—", "[—, —]"]);
    const dd = payload.bootstrapCI.max_dd;
    expect(bootRow("Max Drawdown")).toEqual([pct(dd.point, 2), `[${pct(dd.lo, 2)}, ${pct(dd.hi, 2)}]`]);
    expect(bootRow("Max Drawdown")[0]).not.toBe("—");
    const lines = sparklines();
    expect(lines).not.toContain("Sharpe");
    expect(lines).not.toContain("Sortino");
    expect(lines).toContain("Max DD");
    // A withheld ratio has no resamples by design: the caption must not call that "dropped".
    expect(panel("Bootstrap 95% Confidence").textContent).not.toContain("no resample has a");
  });

  it("full (400-day record): the point, the interval and all three sparklines are as the payload carries them", () => {
    const payload = buildWith(401, crypto(400));
    mount(payload);
    const s = payload.bootstrapCI.sharpe;
    expect(bootRow("Sharpe")).toEqual([ratio(s.point), `[${ratio(s.lo)}, ${ratio(s.hi)}]`]);
    expect(bootRow("Sharpe")[0]).not.toBe("—");
    const lines = sparklines();
    expect(lines).toContain("Sharpe");
    expect(lines).toContain("Sortino");
    expect(lines).toContain("Max DD");
  });
});

describe("Bootstrap 95% Confidence - the low-observation sentence is muted (D-13, A-194-D13-01)", () => {
  it("short record with 180 resample observations: the sentence is muted with no warning colour and no glyph, its words unchanged", () => {
    // Why it matters: it is a short-record warning, and D-13 says those become one muted note.
    // A-194-D13-01: the trigger (n under 252) and the words are kept; only the style moves.
    const base = buildWith(201, crypto(200));
    mount({ ...base, bootstrapCI: { ...base.bootstrapCI, n: 180 } });
    const p = lowNSentence();
    expect(p).toBeDefined();
    expect(p!.className).toContain("text-text-muted");
    expect(p!.getAttribute("style") ?? "").not.toContain("warning");
    expect(p!.textContent).not.toContain("⚠");
    expect(p!.textContent).toBe(
      "Bootstrap resamples are drawn from 180 observations. CI width is wide and may understate true uncertainty below 252 days (1 year).",
    );
  });

  it("full record with 400 observations: no low-observation sentence", () => {
    mount(buildWith(401, crypto(400)));
    expect(lowNSentence()).toBeUndefined();
  });
});

describe("Calmar by Year - deliberately NOT gated (A-194-D13-02)", () => {
  it("on a 60-day record every row still prints its Return, Max DD and Calmar, and the partial-year marker keeps its warning colour", () => {
    // A-194-D13-02: per-year Calmar is a calendar-year return over that year's drawdown, not an
    // annualized figure, so a 60-day record shows it while the headline Calmar is withheld.
    // Its amber partial-year marker is a comparability caveat (a stub year is not comparable to
    // a full one), not a short-record warning, so D-13's muting does not apply to it.
    const payload = buildWith(61, crypto(60));
    expect(payload.calmarByYear.length).toBeGreaterThan(0);
    expect(payload.calmarByYear.some((r) => Number.isFinite(r.calmar))).toBe(true);
    mount(payload);
    // The headline Calmar on the same rail IS withheld: the pin is about the contrast.
    const mainCalmar = [...panel("Main Metrics").querySelectorAll("tr")].find(
      (r) => r.querySelector("td")?.textContent === "Calmar",
    );
    expect(mainCalmar?.querySelectorAll("td")[1].textContent).toBe("—");

    const rows = [...panel("Calmar by Year").querySelectorAll("tbody tr")];
    expect(rows).toHaveLength(payload.calmarByYear.length);
    rows.forEach((tr, i) => {
      expect(tr.querySelectorAll("td")[3].textContent).toBe(ratio(payload.calmarByYear[i].calmar));
    });
    expect(rows.some((tr) => tr.querySelectorAll("td")[3].textContent !== "—")).toBe(true);

    const marker = panel("Calmar by Year").querySelector('span[title^="Only"]');
    expect(marker).not.toBeNull();
    expect(marker!.getAttribute("style") ?? "").toContain("--color-warning");
    expect(panel("Calmar by Year").textContent).toContain("Years with < 200 trading days are partial");
  });
});
