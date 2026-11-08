/**
 * Phase 194.1 plan 01 - `recordFromScalars` turns the four aliased record scalars and an asset
 * class into the one record the figure gate judges (194 D-15 / D-17 / D-20).
 *
 * Expected states are typed by hand (oracle independence): nothing here reads a sentence or a
 * threshold out of the module under test. The three alias lists (this module, the server
 * reader, the percentile row read) are pinned equal so they cannot drift apart.
 */
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/sentry-capture", () => ({ captureToSentry: vi.fn() }));

import { RECORD_SCALAR_ALIASES, recordFromScalars } from "./figure-record-scalars";
import { RECORD_SPAN_SELECT } from "./record-span-read";
import { gateAnnualized } from "./figure-gate";

const START = "2025-01-01";

/** The last date of a record that COVERS `days` days from START (D-20: both ends counted). */
function endAfter(days: number): string {
  const d = new Date(`${START}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days - 1);
  return d.toISOString().slice(0, 10);
}

function row(days: number, observations: unknown = null) {
  return {
    series_start: START,
    series_end: endAfter(days),
    headline_since: null,
    record_observations: observations,
  };
}

describe("RECORD_SCALAR_ALIASES: one alias list, three readers", () => {
  it("equals the inner list of RECORD_SPAN_SELECT", () => {
    expect(RECORD_SPAN_SELECT).toBe(`strategy_analytics ( ${RECORD_SCALAR_ALIASES} )`);
  });

  it("equals the PERCENTILE_SPAN_COLUMNS literal in queries.ts (read from source: the constant is module-private)", () => {
    const text = readFileSync(resolve(process.cwd(), "src/lib/queries.ts"), "utf8");
    const m = /const PERCENTILE_SPAN_COLUMNS: string =\s*"([^"]+)";/.exec(text);
    expect(m, "PERCENTILE_SPAN_COLUMNS not found in src/lib/queries.ts: the pin would be vacuous").not.toBeNull();
    expect(m![1]).toBe(RECORD_SCALAR_ALIASES);
  });

  it("names exactly the four scalar aliases and never a whole blob column", () => {
    const names = RECORD_SCALAR_ALIASES.split(",").map((p) => p.trim().split(":")[0]);
    expect(names).toEqual(["series_start", "series_end", "headline_since", "record_observations"]);
    for (const whole of ["returns_series,", "metrics_json,", "data_quality_flags,"]) {
      expect(RECORD_SCALAR_ALIASES.includes(whole), `${whole} projected whole`).toBe(false);
    }
  });
});

describe("recordFromScalars: crypto is judged on its span", () => {
  it("89 covered days is withheld, 90 is short, 400 is full", () => {
    expect(gateAnnualized(recordFromScalars(row(89), "crypto"))).toBe("withheld");
    expect(gateAnnualized(recordFromScalars(row(90), "crypto"))).toBe("short");
    expect(gateAnnualized(recordFromScalars(row(400), "crypto"))).toBe("full");
  });

  it("62 stored observations over 89 days is withheld: a crypto record is judged on span, never count", () => {
    expect(gateAnnualized(recordFromScalars(row(89, 62), "crypto"))).toBe("withheld");
  });
});

describe("recordFromScalars: non-crypto is judged on its stored count", () => {
  it("59 observations is withheld, 60 is short (span 84 days)", () => {
    expect(gateAnnualized(recordFromScalars(row(84, 59), "traditional"))).toBe("withheld");
    expect(gateAnnualized(recordFromScalars(row(84, 60), "traditional"))).toBe("short");
  });

  it("no stored count over 89 days is withheld (the interim day bound)", () => {
    expect(gateAnnualized(recordFromScalars(row(89, null), "traditional"))).toBe("withheld");
  });

  it("a null or undefined asset class follows annualizationPeriods (non-crypto)", () => {
    expect(gateAnnualized(recordFromScalars(row(89, 62), null))).toBe("short");
    expect(gateAnnualized(recordFromScalars(row(89, 62), undefined))).toBe("short");
  });
});

describe("recordFromScalars: coercion matches readRecordSpan", () => {
  it("a headline_since later than series_start shortens the span to start there", () => {
    const r = recordFromScalars(
      { series_start: START, series_end: endAfter(200), headline_since: endAfter(111), record_observations: null },
      "crypto",
    );
    expect(r.spanDays).toBe(90);
  });

  it("a present but unparsable series_end is unreadable and withheld", () => {
    const r = recordFromScalars({ ...row(400), series_end: "not-a-date" }, "crypto");
    expect(r.unreadable).toBe(true);
    expect(gateAnnualized(r)).toBe("withheld");
  });

  it("a null row, and a row with every field absent, have an unknown span and read null", () => {
    for (const input of [null, undefined, {}]) {
      const r = recordFromScalars(input, "crypto");
      expect(r.spanDays).toBeNull();
      expect(gateAnnualized(r)).toBe("null");
    }
  });

  it("an absent series_end is unknown, not unreadable", () => {
    const r = recordFromScalars({ series_start: START }, "crypto");
    expect(r.spanDays).toBeNull();
    expect(r.unreadable).toBeUndefined();
  });

  it('a numeric-string count ("60") is absent, never coerced', () => {
    const r = recordFromScalars(row(84, "60"), "traditional");
    expect(r.observations).toBeNull();
    // With the count absent the day bound decides: 84 days is withheld, where a coerced 60 would be short.
    expect(gateAnnualized(r)).toBe("withheld");
  });

  it("an empty-string date is absent, and a non-finite count is absent", () => {
    const r = recordFromScalars(
      { series_start: "", series_end: endAfter(400), headline_since: "", record_observations: Number.NaN },
      "crypto",
    );
    expect(r.spanDays).toBeNull();
    expect(r.observations).toBeNull();
  });
});
