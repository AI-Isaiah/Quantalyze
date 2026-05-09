/**
 * G12.E.1 (audit 2026-05-07) regression test —
 * `Position.side`/`Position.status` runtime guard at the API boundary.
 *
 * The discovery page selects raw rows from `positions` and passes them to
 * `PerformanceReport`. Without runtime validation, a row with `side='LONG'`
 * (case drift) or `status='partial'` (a future enum addition) would satisfy
 * the TS union at compile time and crash downstream consumers that do
 * exhaustive equality checks. `parsePositionRows` validates each row,
 * drops invalid ones, and warns — so this regression is caught at the
 * trust boundary, not in PositionsTab rendering.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { parsePositionRows, PositionRowSchema, type Position } from "@/lib/types";

const validRow: Position = {
  id: "00000000-0000-0000-0000-000000000001",
  strategy_id: "11111111-1111-1111-1111-111111111111",
  symbol: "BTC-USDT",
  side: "long",
  status: "closed",
  entry_price_avg: 50000,
  exit_price_avg: 55000,
  size_base: 0.1,
  size_peak: 0.1,
  realized_pnl: 500,
  fee_total: 5,
  fill_count: 2,
  opened_at: "2026-01-01T00:00:00Z",
  closed_at: "2026-01-02T00:00:00Z",
  duration_days: 1,
  roi: 0.1,
  funding_pnl: 0,
};

const validRow2: Position = {
  ...validRow,
  id: "00000000-0000-0000-0000-000000000002",
  side: "short",
  status: "open",
  exit_price_avg: null,
  realized_pnl: null,
  closed_at: null,
  duration_days: null,
  roi: null,
};

describe("G12.E.1 — parsePositionRows runtime guard", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it("returns valid rows unchanged", () => {
    const out = parsePositionRows([validRow, validRow2]);
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual(validRow);
    expect(out[1]).toEqual(validRow2);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("drops rows with case-drift side ('LONG' instead of 'long') and warns", () => {
    const bad = { ...validRow, id: "bad-side", side: "LONG" };
    const out = parsePositionRows([validRow, bad, validRow2]);
    expect(out).toHaveLength(2);
    expect(out.map((p) => p.id)).toEqual([validRow.id, validRow2.id]);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0]?.[1]).toMatchObject({ rowId: "bad-side" });
  });

  it("drops rows with future-enum status ('partial') and warns", () => {
    const bad = { ...validRow, id: "bad-status", status: "partial" };
    const out = parsePositionRows([bad, validRow]);
    expect(out).toHaveLength(1);
    expect(out[0]?.id).toBe(validRow.id);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0]?.[1]).toMatchObject({ rowId: "bad-status" });
  });

  it("drops mixed-invalid rows: returns 2 valid + warns twice (audit spec)", () => {
    const badSide = { ...validRow, id: "bad-side", side: "LONG" };
    const badStatus = { ...validRow, id: "bad-status", status: "partial" };
    const out = parsePositionRows([validRow, badSide, badStatus, validRow2]);
    expect(out).toHaveLength(2);
    expect(out.map((p) => p.id).sort()).toEqual([validRow.id, validRow2.id].sort());
    expect(warnSpy).toHaveBeenCalledTimes(2);
  });

  it("returns [] for empty input without warning", () => {
    const out = parsePositionRows([]);
    expect(out).toEqual([]);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("drops null/undefined/non-object rows defensively", () => {
    const out = parsePositionRows([null, undefined, "not an object", 42, validRow]);
    expect(out).toHaveLength(1);
    expect(out[0]?.id).toBe(validRow.id);
    expect(warnSpy).toHaveBeenCalledTimes(4);
  });

  it("PositionRowSchema rejects missing required fields", () => {
    const incomplete = { id: "x", side: "long", status: "open" };
    expect(PositionRowSchema.safeParse(incomplete).success).toBe(false);
  });

  it("PositionRowSchema rejects non-numeric entry_price_avg (truly garbage string)", () => {
    // Adversarial-review hardening: schema now uses z.coerce.number() so
    // PostgREST's "DECIMAL-as-string" output (e.g. "50000") parses cleanly
    // — that's a feature, not a bug. But genuinely garbage strings still
    // reject so silent shape drift doesn't slip past.
    const bad = { ...validRow, entry_price_avg: "fifty thousand" };
    expect(PositionRowSchema.safeParse(bad).success).toBe(false);
  });

  // Adversarial-review regression tests (PR #138 follow-up)

  it("PositionRowSchema accepts PostgREST DECIMAL-as-string via coercion", () => {
    // PostgREST's documented behavior is to serialize NUMERIC as JSON
    // strings to preserve arbitrary precision (configurable via Accept
    // header / column-level casts). With z.coerce.number(), the schema
    // accepts both shapes — so a future PostgREST cast change does NOT
    // silently drop every row.
    const stringNumeric = {
      ...validRow,
      entry_price_avg: "50000.123456789",
      realized_pnl: "1234.56",
      roi: "0.05",
      funding_pnl: "-0.50",
    };
    const parsed = PositionRowSchema.safeParse(stringNumeric);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      // Coerced to number on the way out.
      expect(typeof parsed.data.entry_price_avg).toBe("number");
      expect(parsed.data.entry_price_avg).toBeCloseTo(50000.123456789);
      expect(parsed.data.realized_pnl).toBe(1234.56);
    }
  });

  it("PositionRowSchema rejects unknown extra fields (.strict() drift detection)", () => {
    // Adversarial-review hardening: schema is .strict() so a future
    // SELECT that picks up an extra column (e.g. `unrealized_pnl` from
    // migration 040 currently NOT selected) is loudly dropped instead
    // of silently passing through as schema drift.
    const withExtra = { ...validRow, unrealized_pnl: 0 };
    expect(PositionRowSchema.safeParse(withExtra).success).toBe(false);
  });

  it("PositionRowSchema rejects malformed opened_at ('' empty string)", () => {
    // Adversarial-review hardening: TIMESTAMPTZ is now pinned via
    // z.string().datetime({ offset: true }) — a corrupted '' would
    // previously pass through and produce NaN durations.
    const bad = { ...validRow, opened_at: "" };
    expect(PositionRowSchema.safeParse(bad).success).toBe(false);
  });

  it("parsePositionRows warning payload omits raw row contents (PII safety)", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const sensitive = {
      ...validRow,
      strategy_id: "secret-strategy-uuid-allocator-attributable",
      realized_pnl: 999999.99,
      side: "LONG", // forces validation failure
    };
    parsePositionRows([sensitive]);

    // The console.warn call MUST NOT include the row's strategy_id or
    // realized_pnl — only path/code per Zod issue.
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const callArgs = warnSpy.mock.calls[0];
    const serialized = JSON.stringify(callArgs);
    expect(serialized).not.toContain("secret-strategy-uuid-allocator-attributable");
    expect(serialized).not.toContain("999999.99");
    // But the path that failed must be present so ops can debug.
    expect(serialized).toContain("side");

    warnSpy.mockRestore();
  });
});
