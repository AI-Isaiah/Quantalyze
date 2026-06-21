import { describe, expect, it } from "vitest";
import {
  SAMPLE_FLOOR_OVERLAPPING_DAYS,
  SAMPLE_FLOOR_HEADING,
  belowFloorBody,
  noUsableSampleBody,
  fewStrategiesBody,
  evaluateSampleFloor,
} from "@/lib/sample-floor";

/**
 * HONEST-02 single-source pin (CONTRACT_GUARDS-registered).
 *
 * Pins the floor VALUE + EVERY gate branch (Pitfall 4 coverage defense for the
 * blocking gate: functions 74 / branches 72). The pin MUST FAIL if a future
 * feature hardcodes `60` instead of overriding per-call, or if a gate branch is
 * silently changed/dropped (Rule 9/12 fail-loud; T-22-05 drift mitigation).
 *
 * Mirrors the exhaustive degenerate-matrix style of `scenario-history.test.ts`
 * (one `it` per branch). There is NO Python distributional floor this phase, so
 * we deliberately do NOT add the `readFileSync(...match.py...)` cross-runtime
 * parity arm of `holding-outcome-adapter.test.ts` (Pitfall 3).
 */

describe("SAMPLE_FLOOR_OVERLAPPING_DAYS value pin", () => {
  it("equals 60 (HONEST-02 single source; fails loud if forked)", () => {
    expect(SAMPLE_FLOOR_OVERLAPPING_DAYS).toBe(60);
  });
});

describe("evaluateSampleFloor — ok branch (n >= floor)", () => {
  it("n above the floor → ok / reason 'ok'", () => {
    expect(evaluateSampleFloor(120)).toEqual({
      ok: true,
      n: 120,
      floor: 60,
      reason: "ok",
    });
  });

  it("n exactly at the floor → ok (>= floor passes, boundary)", () => {
    expect(evaluateSampleFloor(60)).toEqual({
      ok: true,
      n: 60,
      floor: 60,
      reason: "ok",
    });
  });
});

describe("evaluateSampleFloor — below-floor branch (finite, 0 <= n < floor)", () => {
  it("n one below the floor → below-floor / not ok", () => {
    expect(evaluateSampleFloor(59)).toEqual({
      ok: false,
      n: 59,
      floor: 60,
      reason: "below-floor",
    });
  });

  it("zero overlapping days is finite & non-negative → below-floor (not no-usable-n)", () => {
    expect(evaluateSampleFloor(0)).toEqual({
      ok: false,
      n: 0,
      floor: 60,
      reason: "below-floor",
    });
  });
});

describe("evaluateSampleFloor — no-usable-n branch (null/NaN/non-finite/negative)", () => {
  it("null → no-usable-n / not ok (treated as below-floor, never passes)", () => {
    expect(evaluateSampleFloor(null)).toEqual({
      ok: false,
      n: null,
      floor: 60,
      reason: "no-usable-n",
    });
  });

  it("undefined → no-usable-n", () => {
    expect(evaluateSampleFloor(undefined)).toEqual({
      ok: false,
      n: null,
      floor: 60,
      reason: "no-usable-n",
    });
  });

  it("NaN → no-usable-n (non-finite poison defended)", () => {
    expect(evaluateSampleFloor(NaN)).toEqual({
      ok: false,
      n: null,
      floor: 60,
      reason: "no-usable-n",
    });
  });

  it("Infinity → no-usable-n (non-finite, never passes despite > floor)", () => {
    expect(evaluateSampleFloor(Infinity)).toEqual({
      ok: false,
      n: null,
      floor: 60,
      reason: "no-usable-n",
    });
  });

  it("-Infinity → no-usable-n", () => {
    expect(evaluateSampleFloor(-Infinity)).toEqual({
      ok: false,
      n: null,
      floor: 60,
      reason: "no-usable-n",
    });
  });

  it("negative n → no-usable-n (negative is not a usable day count)", () => {
    expect(evaluateSampleFloor(-5)).toEqual({
      ok: false,
      n: null,
      floor: 60,
      reason: "no-usable-n",
    });
  });
});

describe("evaluateSampleFloor — per-call floor override (Stress/MC bring their own bar)", () => {
  it("n=30 with floor=20 → ok (override lowers the bar)", () => {
    expect(evaluateSampleFloor(30, 20)).toEqual({
      ok: true,
      n: 30,
      floor: 20,
      reason: "ok",
    });
  });

  it("n=30 with floor=40 → below-floor (override raises the bar)", () => {
    expect(evaluateSampleFloor(30, 40)).toEqual({
      ok: false,
      n: 30,
      floor: 40,
      reason: "below-floor",
    });
  });

  it("override is reported back in the verdict.floor", () => {
    expect(evaluateSampleFloor(100, 90).floor).toBe(90);
  });
});

describe("reason-body copy — names the right numbers, never fabricates", () => {
  it("below-floor body names BOTH the actual N and the floor + the feature noun", () => {
    const body = belowFloorBody(30, 60, "stress");
    expect(body).toContain("30");
    expect(body).toContain("60");
    expect(body).toContain("stress");
    // Honest absence, not "No data".
    expect(body).not.toMatch(/no data/i);
  });

  it("below-floor body honors a per-call floor in the copy", () => {
    expect(belowFloorBody(15, 40, "Monte-Carlo")).toContain("40");
  });

  it("no-usable-n body names NO number (no fabrication of a phantom N)", () => {
    const body = noUsableSampleBody();
    expect(body).not.toMatch(/\d/);
    expect(body).not.toMatch(/no data/i);
  });

  it("0/1-strategy body names the floor but no fabricated N", () => {
    const body = fewStrategiesBody(60);
    expect(body).toContain("60");
    // names the floor + the 2-strategy minimum, not a fabricated overlap N
    expect(body).toMatch(/2/);
  });

  it("heading is distinct from the correlation surface's heading", () => {
    expect(SAMPLE_FLOOR_HEADING).toBe("Not enough history for this estimate");
    expect(SAMPLE_FLOOR_HEADING).not.toBe("Not enough overlap to correlate");
  });
});
