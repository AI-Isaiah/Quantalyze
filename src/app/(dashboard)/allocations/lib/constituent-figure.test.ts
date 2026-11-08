/**
 * 194.1 plan 09 (census B8) — the per-constituent figure verdict, tested outside the composer.
 *
 * Intent: an added strategy's CAGR and Sharpe are judged on THAT strategy's own total record. A book
 * strategy's record beats a lazy one (as the book's values do), an unknown record shows the stored
 * figure as today, and a withheld record never lets the raw number reach a formatter.
 *
 * Spans are hand-counted: the verdict thresholds are 90 covered days (crypto, calendar) and 60
 * observations (non-crypto); the figure is short between that bar and one year.
 */
import { describe, it, expect, vi } from "vitest";
import {
  constituentCell,
  constituentFigure,
  parseConstituentRecord,
  UNKNOWN_CONSTITUENT_FIGURE,
} from "./constituent-figure";

describe("parseConstituentRecord", () => {
  it("keeps finite numbers and reads crypto true only for the boolean true", () => {
    expect(
      parseConstituentRecord({ figure_span_days: 40, figure_observations: 38, figure_crypto: true }),
    ).toEqual({ spanDays: 40, observations: 38, crypto: true });
  });

  it("reads a string, NaN, Infinity or absent span and count as null", () => {
    for (const bad of ["40", Number.NaN, Number.POSITIVE_INFINITY, null, undefined]) {
      const r = parseConstituentRecord({ figure_span_days: bad, figure_observations: bad });
      expect(r.spanDays, String(bad)).toBeNull();
      expect(r.observations, String(bad)).toBeNull();
    }
  });

  it('reads "true" and 1 as not crypto, and an empty body as the unknown record', () => {
    expect(parseConstituentRecord({ figure_crypto: "true" }).crypto).toBe(false);
    expect(parseConstituentRecord({ figure_crypto: 1 }).crypto).toBe(false);
    expect(parseConstituentRecord({})).toEqual({ spanDays: null, observations: null, crypto: false });
  });
});

describe("parseConstituentRecord — figure_unreadable (R2 WR-01)", () => {
  // The route cannot null the pair for an unreadable record (the panel would read two nulls as "no
  // computed metrics"), so it serves the values and this flag; the gate must withhold on it even when
  // the span and count would otherwise clear.
  it("reads figure_unreadable true as an unreadable record, and the verdict is withheld", () => {
    const record = parseConstituentRecord({
      figure_span_days: 800,
      figure_observations: 800,
      figure_crypto: true,
      figure_unreadable: true,
    });
    expect(record.unreadable).toBe(true);
    expect(constituentFigure(undefined, { cagr: 0.5, sharpe: 2.1, record }).figureState).toBe("withheld");
  });

  it("reads false, a string, 1 or absent as a readable record (no unreadable key at all)", () => {
    for (const v of [false, "true", 1, null, undefined]) {
      const r = parseConstituentRecord({ figure_span_days: 400, figure_crypto: true, figure_unreadable: v });
      expect(r, String(v)).toEqual({ spanDays: 400, observations: null, crypto: true });
    }
  });
});

describe("constituentFigure", () => {
  const BOOK_40 = { figure_span_days: 40, figure_observations: null, figure_crypto: true };
  const LAZY_400 = {
    cagr: 0.5,
    sharpe: 2.1,
    record: { spanDays: 400, observations: null, crypto: true },
  };
  const LAZY_40 = {
    cagr: 0.5,
    sharpe: 2.1,
    record: { spanDays: 40, observations: null, crypto: true },
  };

  it("a book strategy wins over a settled lazy entry: a 40-day book beats a 400-day lazy record", () => {
    const f = constituentFigure(BOOK_40, LAZY_400);
    expect(f.figureState).toBe("withheld");
    expect(f.figureRecord).toEqual({ spanDays: 40, observations: null, crypto: true });
  });

  it("a book strategy wins the other way too: a 400-day book beats a 40-day lazy record", () => {
    const f = constituentFigure(
      { figure_span_days: 400, figure_observations: null, figure_crypto: true },
      LAZY_40,
    );
    expect(f.figureState).toBe("full");
  });

  it("a book strategy with no figure scalars is an unknown record, not the lazy one", () => {
    const f = constituentFigure({}, LAZY_40);
    expect(f.figureState).toBe("null");
    expect(f.figureRecord).toEqual({ spanDays: null, observations: null, crypto: false });
  });

  it("with no book strategy, a settled lazy entry's record decides", () => {
    expect(constituentFigure(undefined, LAZY_40).figureState).toBe("withheld");
    expect(constituentFigure(undefined, LAZY_400).figureState).toBe("full");
    expect(
      constituentFigure(undefined, {
        cagr: 1,
        sharpe: 1,
        record: { spanDays: 200, observations: null, crypto: true },
      }).figureState,
    ).toBe("short");
  });

  it("unavailable, undefined, or a settled entry with no record is the unknown record", () => {
    for (const lazy of ["unavailable" as const, undefined, { cagr: 0.5, sharpe: 2.1 }]) {
      expect(constituentFigure(undefined, lazy)).toBe(UNKNOWN_CONSTITUENT_FIGURE);
    }
    expect(UNKNOWN_CONSTITUENT_FIGURE.figureState).toBe("null");
  });

  it("a non-crypto record is decided by its observation count", () => {
    const f = constituentFigure(
      { figure_span_days: 120, figure_observations: 59, figure_crypto: false },
      undefined,
    );
    expect(f.figureState).toBe("withheld");
  });
});

describe("constituentCell", () => {
  it("never passes a withheld figure's raw value to the formatter", () => {
    const fmt = vi.fn((v: number | null) => (v == null ? "—" : `v=${v}`));
    const withheld = constituentFigure(
      { figure_span_days: 40, figure_observations: null, figure_crypto: true },
      undefined,
    );
    constituentCell(2.1, withheld, fmt);
    expect(fmt).toHaveBeenCalledTimes(1);
    expect(fmt).toHaveBeenCalledWith(null);
    expect(fmt).not.toHaveBeenCalledWith(2.1);
  });

  it("passes the value through for a full or unknown record", () => {
    const fmt = vi.fn((v: number | null) => String(v));
    expect(constituentCell(2.1, UNKNOWN_CONSTITUENT_FIGURE, fmt)).toBe("2.1");
    const full = constituentFigure(
      { figure_span_days: 400, figure_observations: null, figure_crypto: true },
      undefined,
    );
    expect(constituentCell(2.1, full, fmt)).toBe("2.1");
  });
});
