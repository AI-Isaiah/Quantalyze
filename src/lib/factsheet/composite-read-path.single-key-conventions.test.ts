/**
 * Phase 169.1 plan 04 (D-83, D-30) — `readSingleKeyBasisOpts` decides a
 * single-key strategy's compounding method and day basis through the ONE
 * resolver the composite path uses, with the same tier order:
 *   1. the persisted `data_quality_flags.cumulative_method`;
 *   2. the frozen `cash_settlement` conventions echo (`options.cashConventions`);
 *   3. the live `returns_denominator_config`.
 *
 * WHY: the stored headline was computed under the frozen conventions, and the
 * live config can be edited after the run. If the single-key arm decided from the
 * config while the composite arm decided from the echo, the same edit would move
 * one page's curve and not another's (Rule 7: one decision, one place).
 *
 * The echo is PASSED IN; this owner issues no query for it, so the hot non-options
 * path still never constructs the service-role handle (composite-read-path.test.ts
 * pins that without the option; this file pins it with it).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/sentry-capture", () => ({ captureToSentry: vi.fn() }));

import { readSingleKeyBasisOpts } from "./composite-read-path";

/** A thunk that fails the test if the owner ever builds the admin handle. */
const noAdmin = () =>
  vi.fn(() => {
    throw new Error("getAdmin must not be called on the hot non-options path");
  });

/** A clean, rankable single-key analytics row carrying the seven headline scalars. */
const persistedRow = () => ({
  computation_status: "complete",
  cumulative_return: 0.32,
  volatility: 0.3,
  max_drawdown: -0.1,
  cagr: 0.7,
  sharpe: 2.1,
  sortino: 3.2,
  calmar: 7,
});

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("169.1-04 D-83 (a): readSingleKeyBasisOpts resolves through resolveMetricsConventions", () => {
  it("ECHO OVER CONFIG: an echo of simple + calendar beats a geometric config", async () => {
    const out = await readSingleKeyBasisOpts(
      noAdmin(),
      "s-1",
      null,
      null,
      "complete",
      undefined,
      { cumulative_method: "geometric" },
      { cashConventions: { cumulative_method: "simple", day_basis: "calendar" } },
    );
    expect(out.cumulativeMethod).toBe("arithmetic");
    expect("dayBasis" in out).toBe(false);
    expect(out.dataQuality?.returnsConventionOverride).toBe(true);
  });

  it("ECHO ACTIVE ONLY: an echo of geometric + active carries the active day basis and no method key", async () => {
    const out = await readSingleKeyBasisOpts(noAdmin(), "s-1", null, null, "complete", undefined, null, {
      cashConventions: { cumulative_method: "geometric", day_basis: "active" },
    });
    expect("cumulativeMethod" in out).toBe(false);
    expect(out.dayBasis).toBe("active");
    expect(out.dataQuality?.returnsConventionOverride).toBe(true);
  });

  it("CONFIG TIER: with no echo, a simple + active_day config gives arithmetic, active and the override", async () => {
    const out = await readSingleKeyBasisOpts(
      noAdmin(),
      "s-1",
      null,
      null,
      "complete",
      undefined,
      { cumulative_method: "simple", metrics_basis: "active_day" },
    );
    expect(out.cumulativeMethod).toBe("arithmetic");
    expect(out.dayBasis).toBe("active");
    expect(out.dataQuality?.returnsConventionOverride).toBe(true);
  });

  it("NEITHER: no echo and no config adds no key at all (a default row's opts are unchanged)", async () => {
    const out = await readSingleKeyBasisOpts(noAdmin(), "s-1", null, null, "complete", undefined, null, {
      cashConventions: null,
    });
    expect(out).toEqual({});
  });

  it("SAME TIER ORDER AS THE COMPOSITE ARM: a persisted geometric flag beats an echo of simple", async () => {
    const out = await readSingleKeyBasisOpts(
      noAdmin(),
      "s-1",
      { cumulative_method: "geometric" },
      null,
      "complete",
      undefined,
      { cumulative_method: "simple" },
      { cashConventions: { cumulative_method: "simple", day_basis: "calendar" } },
    );
    expect("cumulativeMethod" in out).toBe(false);
    expect(out.dataQuality?.returnsConventionOverride).toBeUndefined();
  });
});

describe("169.1-04 D-83 (a): the hot path stays free of an admin handle with the echo passed in", () => {
  it("HOT PATH: a clean non-options row with cashConventions (and with its persisted headline) never builds the handle", async () => {
    const getAdmin = noAdmin();
    const conventions = { cumulative_method: "simple", day_basis: "active" };
    const bare = await readSingleKeyBasisOpts(getAdmin, "s-1", {}, null, "complete", undefined, null, {
      cashConventions: conventions,
    });
    const withHeadline = await readSingleKeyBasisOpts(getAdmin, "s-1", {}, null, "complete", persistedRow(), null, {
      cashConventions: conventions,
    });
    expect(getAdmin).not.toHaveBeenCalled();
    // The conventions still took effect, so the absence of a read is not the
    // absence of the feature.
    expect(bare.cumulativeMethod).toBe("arithmetic");
    expect(withHeadline.dayBasis).toBe("active");
    expect(withHeadline.metricsByBasis?.cash_settlement?.cumulative_return).toBe(0.32);
  });
});
