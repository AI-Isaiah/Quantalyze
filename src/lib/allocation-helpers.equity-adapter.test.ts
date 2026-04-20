import { describe, it, expect } from "vitest";
import { equitySnapshotsToDailyPoints } from "./allocation-helpers";

/**
 * Tests for the Phase 07 / VOICES-ACCEPTED f7 equity-snapshot → DailyPoint
 * adapter.
 *
 * The adapter turns `allocator_equity_snapshots` rows ({asof, value_usd})
 * into the DailyPoint[] shape consumed by EquityCurve / DrawdownChart via
 * the parallel-prop path. Mid-series gaps are forward-filled with the
 * previous day's value_usd (explicit choice — see f7).
 */
describe("equitySnapshotsToDailyPoints", () => {
  it("happy path: dense daily snapshots → one DailyPoint per snapshot preserving date + value", () => {
    const snapshots = [
      { asof: "2026-01-01", value_usd: 100 },
      { asof: "2026-01-02", value_usd: 110 },
      { asof: "2026-01-03", value_usd: 120 },
      { asof: "2026-01-04", value_usd: 125 },
      { asof: "2026-01-05", value_usd: 130 },
      { asof: "2026-01-06", value_usd: 140 },
      { asof: "2026-01-07", value_usd: 150 },
    ];
    const out = equitySnapshotsToDailyPoints(snapshots);
    expect(out).toHaveLength(7);
    expect(out[0]).toEqual({ date: "2026-01-01", value: 100 });
    expect(out[6]).toEqual({ date: "2026-01-07", value: 150 });
    // Values in order
    expect(out.map((p) => p.value)).toEqual([100, 110, 120, 125, 130, 140, 150]);
  });

  it("mid-series gap: forward-fills missing days with previous day's value", () => {
    const snapshots = [
      { asof: "2026-01-01", value_usd: 100 },
      { asof: "2026-01-05", value_usd: 200 },
    ];
    const out = equitySnapshotsToDailyPoints(snapshots);
    expect(out).toHaveLength(5);
    expect(out[0]).toEqual({ date: "2026-01-01", value: 100 });
    // Forward-filled days use the previous day's value (100)
    expect(out[1]).toEqual({ date: "2026-01-02", value: 100 });
    expect(out[2]).toEqual({ date: "2026-01-03", value: 100 });
    expect(out[3]).toEqual({ date: "2026-01-04", value: 100 });
    // The next real snapshot uses its own value (200)
    expect(out[4]).toEqual({ date: "2026-01-05", value: 200 });
  });

  it("warm-up: returns whatever's available (3 snapshots → 3 points, no padding)", () => {
    const snapshots = [
      { asof: "2026-01-01", value_usd: 100 },
      { asof: "2026-01-02", value_usd: 110 },
      { asof: "2026-01-03", value_usd: 115 },
    ];
    const out = equitySnapshotsToDailyPoints(snapshots);
    expect(out).toHaveLength(3);
    expect(out).toEqual([
      { date: "2026-01-01", value: 100 },
      { date: "2026-01-02", value: 110 },
      { date: "2026-01-03", value: 115 },
    ]);
  });

  it("empty input: returns []", () => {
    expect(equitySnapshotsToDailyPoints([])).toEqual([]);
  });

  it("single snapshot: returns single DailyPoint", () => {
    const out = equitySnapshotsToDailyPoints([{ asof: "2026-01-01", value_usd: 100 }]);
    expect(out).toEqual([{ date: "2026-01-01", value: 100 }]);
  });

  it("unsorted input: sorts ascending before emitting (defensive)", () => {
    const snapshots = [
      { asof: "2026-01-03", value_usd: 300 },
      { asof: "2026-01-01", value_usd: 100 },
      { asof: "2026-01-02", value_usd: 200 },
    ];
    const out = equitySnapshotsToDailyPoints(snapshots);
    expect(out).toHaveLength(3);
    expect(out.map((p) => p.date)).toEqual([
      "2026-01-01",
      "2026-01-02",
      "2026-01-03",
    ]);
    expect(out.map((p) => p.value)).toEqual([100, 200, 300]);
  });
});
