/** @vitest-environment jsdom */
/**
 * Phase 166.2 review round 3: a statistic that does not exist reads "—" on the
 * factsheet's metrics column, beside the sibling rows that already say "—" for
 * the same absence (founder decision D7, "Show — everywhere").
 *
 * Why this matters: a book that never lost a day has no Profit Factor (gross
 * gain over a gross loss of 0 is infinite). Printing "0.00" shows the worst
 * possible profit factor for the best possible record, directly above
 * "Omega (θ=0) —", which is the same number. A year with no drawdown has no
 * Calmar either, and printing "0.00" there contradicts the headline Calmar "—"
 * in the same column. Each case runs through the real `buildFactsheetPayload`
 * and the real `MetricsColumn`, with a control book that has losses, and again
 * after a JSON round trip (the payload cache turns NaN into null).
 */
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { buildFactsheetPayload } from "@/lib/factsheet/build-payload";
import type { FactsheetPayload } from "@/lib/factsheet/types";

import { FactsheetProvider } from "./factsheet-context";
import { MetricsColumn } from "./MetricsColumn";

function isoDay(i: number, start = Date.UTC(2022, 0, 1)): string {
  return new Date(start + i * 86_400_000).toISOString().slice(0, 10);
}

function payloadFrom(values: number[], start?: number): FactsheetPayload {
  const payload = buildFactsheetPayload(
    {
      id: "no-loss-residue-test",
      name: "No Loss Residue Test",
      types: ["test"],
      markets: ["crypto"],
      computedAt: "2026-09-26T00:00:00Z",
      trustTier: null,
      ingestSource: "api",
    },
    values.map((value, i) => ({ date: isoDay(i, start), value })),
  );
  if (!payload) throw new Error("buildFactsheetPayload returned null in test");
  return payload;
}

/** 400 days, every one a gain, and dispersing: a real Sharpe, no losing day. */
const NO_LOSS = Array.from({ length: 400 }, (_, i) => 0.0005 + Math.abs(Math.sin(i / 5)) * 0.004);
/** 400 days of both signs: losing days and a drawdown exist. */
const TWO_SIDED = Array.from({ length: 400 }, (_, i) => Math.sin(i / 7) * 0.01 + 0.0004);

/** Round-trips the payload through JSON, as the payload cache does (NaN → null). */
function viaCache(p: FactsheetPayload): FactsheetPayload {
  return JSON.parse(JSON.stringify(p)) as FactsheetPayload;
}

/** Renders the column once; returns a reader of a panel row's value cell. */
function renderColumn(payload: FactsheetPayload): (panel: string, label: string) => string {
  const { getAllByText } = render(
    <FactsheetProvider payload={payload}>
      <MetricsColumn />
    </FactsheetProvider>,
  );
  return (panel: string, label: string) => {
    const heading = getAllByText(panel, { selector: "h3" })[0];
    const section = heading.closest("section") as HTMLElement;
    const row = [...section.querySelectorAll("tbody tr")].find(
      tr => tr.querySelector("td")?.textContent === label,
    );
    if (!row) throw new Error(`no "${label}" row in panel "${panel}"`);
    return row.querySelectorAll("td")[1]?.textContent ?? "";
  };
}

describe("HI3-01: a book with no losing day has no Profit Factor", () => {
  it("precondition: the no-loss book has no losing day and a real Sharpe", () => {
    expect(NO_LOSS.every(r => r > 0)).toBe(true);
    const p = payloadFrom(NO_LOSS);
    expect(Number.isFinite(p.strategyMetrics.sharpe)).toBe(true);
    expect(p.strategyMetrics.omega_ratio).toBeNull();
  });

  for (const [name, wrap] of [
    ["fresh payload", (p: FactsheetPayload) => p],
    ["after the JSON cache round trip", viaCache],
  ] as const) {
    it(`reads "—" in Returns and in Extended Metrics, beside Omega "—" (${name})`, () => {
      const read = renderColumn(wrap(payloadFrom(NO_LOSS)));
      expect(read("Extended Metrics", "Omega (θ=0)")).toBe("—");
      expect(read("Extended Metrics", "Profit Factor")).toBe("—");
      expect(read("Returns", "Profit Factor")).toBe("—");
      // tail × profit factor: no left tail on a book that never lost, so "—".
      expect(read("Extended Metrics", "Common-sense Ratio")).toBe("—");
    });

    it(`control: a book with losing days keeps a finite Profit Factor equal to Omega (${name})`, () => {
      const read = renderColumn(wrap(payloadFrom(TWO_SIDED)));
      const pf = read("Extended Metrics", "Profit Factor");
      expect(pf).toMatch(/^\d+\.\d{2}$/);
      expect(read("Returns", "Profit Factor")).toBe(pf);
      expect(read("Extended Metrics", "Omega (θ=0)")).toBe(pf);
    });
  }
});

describe("HI3-02: Calmar by Year reads \"—\" for a year with no drawdown", () => {
  /** 2022 every day a dispersing gain (no drawdown), then 2023 two-sided. */
  const TWO_YEARS = Array.from({ length: 730 }, (_, i) =>
    i < 365 ? 0.0005 + Math.abs(Math.sin(i / 5)) * 0.004 : Math.sin(i / 7) * 0.01 + 0.0004,
  );

  function calmarCells(payload: FactsheetPayload): Record<string, string> {
    const { getAllByText } = render(
      <FactsheetProvider payload={payload}>
        <MetricsColumn />
      </FactsheetProvider>,
    );
    const section = getAllByText("Calmar by Year", { selector: "h3" })[0].closest("section") as HTMLElement;
    const out: Record<string, string> = {};
    for (const tr of section.querySelectorAll("tbody tr")) {
      const tds = tr.querySelectorAll("td");
      // Year cell may carry a partial-year marker; the Calmar cell is the fourth.
      out[(tds[0].textContent ?? "").slice(0, 4)] = tds[3].textContent ?? "";
    }
    return out;
  }

  it("precondition: 2022 has no drawdown and 2023 has one", () => {
    const p = payloadFrom(TWO_YEARS);
    const rows = p.calmarByYear;
    expect(rows.map(r => r.year)).toEqual(["2022", "2023"]);
    expect(rows[0].max_dd).toBe(0);
    expect(rows[1].max_dd).toBeLessThan(0);
  });

  for (const [name, wrap] of [
    ["fresh payload", (p: FactsheetPayload) => p],
    ["after the JSON cache round trip", viaCache],
  ] as const) {
    it(`the no-drawdown year reads "—", the drawdown year a number (${name})`, () => {
      const cells = calmarCells(wrap(payloadFrom(TWO_YEARS)));
      expect(cells["2022"]).toBe("—");
      expect(cells["2023"]).toMatch(/^-?\d+\.\d{2}$/);
    });
  }
});

describe("WR3-01: Skew and Kurtosis read \"—\" for a series with no dispersion", () => {
  /** A compounding constant yield: no dispersion, so no standardised moments. */
  const CONSTANT = Array.from({ length: 400 }, () => 0.0002);

  for (const [name, wrap] of [
    ["fresh payload", (p: FactsheetPayload) => p],
    ["after the JSON cache round trip", viaCache],
  ] as const) {
    it(`Main Metrics and Extended Metrics read "—" beside Sharpe "—" (${name})`, () => {
      const read = renderColumn(wrap(payloadFrom(CONSTANT)));
      expect(read("Main Metrics", "Sharpe")).toBe("—");
      expect(read("Main Metrics", "Skew")).toBe("—");
      expect(read("Main Metrics", "Kurtosis")).toBe("—");
      expect(read("Extended Metrics", "Skew")).toBe("—");
      expect(read("Extended Metrics", "Kurtosis (excess)")).toBe("—");
    });

    it(`control: a dispersing book keeps a numeric Skew and Kurtosis (${name})`, () => {
      const read = renderColumn(wrap(payloadFrom(TWO_SIDED)));
      expect(read("Main Metrics", "Skew")).toMatch(/^[+-]\d+\.\d{2}$/);
      expect(read("Main Metrics", "Kurtosis")).toMatch(/^-?\d+\.\d{2}$/);
    });
  }
});

describe("SFH-R3 MEDIUM-2: Avg Loss reads \"—\" for a book with no losing day (and Avg Win for one with no winning day)", () => {
  /** Every day a small dispersing loss: no winning day. */
  const NO_WIN = NO_LOSS.map(r => -r / 10);

  for (const [name, wrap] of [
    ["fresh payload", (p: FactsheetPayload) => p],
    ["after the JSON cache round trip", viaCache],
  ] as const) {
    it(`no losing day: Avg Loss "—", Avg Win a gain (${name})`, () => {
      const read = renderColumn(wrap(payloadFrom(NO_LOSS)));
      expect(read("Max Drawdown", "Avg Loss")).toBe("—");
      expect(read("Max Drawdown", "Avg Win")).toMatch(/^\+\d+\.\d{2}%$/);
      expect(read("Extended Metrics", "Avg Win / Avg Loss")).toBe("—");
    });

    it(`no winning day: Avg Win "—", Avg Loss a loss (${name})`, () => {
      const read = renderColumn(wrap(payloadFrom(NO_WIN)));
      expect(read("Max Drawdown", "Avg Win")).toBe("—");
      expect(read("Max Drawdown", "Avg Loss")).toMatch(/^-\d+\.\d{2}%$/);
      expect(read("Extended Metrics", "Avg Win / Avg Loss")).toBe("—");
    });

    it(`control: a two-sided book keeps both averages and their ratio (${name})`, () => {
      const read = renderColumn(wrap(payloadFrom(TWO_SIDED)));
      expect(read("Max Drawdown", "Avg Win")).toMatch(/^\+\d+\.\d{2}%$/);
      expect(read("Max Drawdown", "Avg Loss")).toMatch(/^-\d+\.\d{2}%$/);
      expect(read("Extended Metrics", "Avg Win / Avg Loss")).toMatch(/^\d+\.\d{2}×$/);
    });
  }
});
