import { describe, it, expect, vi } from "vitest";

// The helper imports `server-only` (a Next.js build guard that throws outside an
// RSC bundle). Stub it so this unit test can import the module — the existing
// pattern in src/lib/audit.test.ts / auth.test.ts / email.test.ts.
vi.mock("server-only", () => ({}));

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  readCompositeFactsheet,
  singleKeyDataQuality,
  singleKeyBasisOpts,
  parseMtmSeriesPayload,
  readMtmSeries,
  shouldReadSingleKeyMtmSeries,
} from "./composite-read-path";
import type { ParsedMtmSeries } from "./composite-read-path";
import { buildFactsheetPayload, deriveIngestSource } from "./build-payload";
import type { DailyReturn } from "./types";

/**
 * Round-2 H-2 — the discovery detail page routed composites down the invented-
 * panel "api" arm (identical D6 failure on the other surface). Both surfaces now
 * share `readCompositeFactsheet`. This proves:
 *   1. a valid composite → sparse series + composite buildOpts (geometric method
 *      for a NULL config, MTM gate, markers);
 *   2. a data defect (missing cash headline) → null → placeholder;
 *   3. the composite, built with the forced `ingestSource:"csv"`, lands on the
 *      csv arm with NO invented panels — whereas the pre-fix classification
 *      (`deriveIngestSource(null) === "api"`) would have taken the api arm.
 */

const SPARSE_ROWS = [
  { date: "2025-08-01", daily_return: 0.01 },
  { date: "2025-08-02", daily_return: 0.02 },
  { date: "2025-08-03", daily_return: -0.03 },
  { date: "2025-08-04", daily_return: 0.04 },
  { date: "2025-08-07", daily_return: -0.05 },
  { date: "2025-08-08", daily_return: 0.06 },
];

const FULL_CASH = {
  cumulative_return: 0.05,
  volatility: 0.12,
  max_drawdown: -0.04,
  cagr: 0.31,
  sharpe: 1.4,
  sortino: 2.1,
  calmar: 3.0,
};

function mockAdmin(
  rows: { date: string; daily_return: number }[] | null,
  error: { message?: string } | null = null,
): SupabaseClient {
  const chain = {
    select: () => chain,
    eq: () => chain,
    order: () => chain,
    limit: () => Promise.resolve({ data: rows, error }),
  };
  return { from: () => chain } as unknown as SupabaseClient;
}

const DQF = {
  composite: true,
  per_key: [
    { seq: 1, first_day: "2025-08-01" },
    { seq: 2, first_day: "2025-08-07" },
  ],
  gap_spans: [{ start: "2025-08-05", end: "2025-08-06" }],
};

describe("H-2 readCompositeFactsheet — shared composite read-path", () => {
  it("valid composite → sparse series + composite buildOpts (NULL config → geometric)", async () => {
    const out = await readCompositeFactsheet(mockAdmin(SPARSE_ROWS), {
      strategyId: "s1",
      dqf: DQF,
      metricsJsonByBasis: { cash_settlement: FULL_CASH },
      returnsDenominatorConfig: null,
    });
    expect(out).not.toBeNull();
    // Honest SPARSE series (gap days absent — never zero-filled).
    expect(out!.dailyReturns.map((d) => d.date)).toEqual(SPARSE_ROWS.map((r) => r.date));
    expect(out!.buildOpts.cumulativeMethod).toBe("geometric"); // C-1: NULL config
    // HARD-04 (#67): DQF without insufficient_window → insufficientWindow false.
    // HARD-05 (Phase 93): DQF without degraded_members → degradedMembers [].
    expect(out!.buildOpts.dataQuality).toEqual({
      composite: true,
      insufficientWindow: false,
      degradedMembers: [],
    });
    // FS-01 boundary for seq 2; FS-02 gap span threaded.
    expect(out!.buildOpts.segmentBoundaries).toEqual([
      { date: "2025-08-07", seq: 2, label: "2" },
    ]);
    expect(out!.buildOpts.missingSegments?.length).toBe(1);
  });

  it("HARD-04: dqf.insufficient_window===true → dataQuality.insufficientWindow true", async () => {
    const out = await readCompositeFactsheet(mockAdmin(SPARSE_ROWS), {
      strategyId: "s1",
      dqf: { ...DQF, insufficient_window: true },
      metricsJsonByBasis: { cash_settlement: FULL_CASH },
      returnsDenominatorConfig: null,
    });
    expect(out!.buildOpts.dataQuality).toEqual({
      composite: true,
      insufficientWindow: true,
      degradedMembers: [],
    });
  });

  it("HARD-04: malformed dqf.insufficient_window (string 'true') → insufficientWindow false (strict server-truth)", async () => {
    const out = await readCompositeFactsheet(mockAdmin(SPARSE_ROWS), {
      strategyId: "s1",
      dqf: { ...DQF, insufficient_window: "true" as unknown },
      metricsJsonByBasis: { cash_settlement: FULL_CASH },
      returnsDenominatorConfig: null,
    });
    // A non-boolean value must NEVER render the caveat (T-92-05 tampering guard).
    expect(out!.buildOpts.dataQuality).toEqual({
      composite: true,
      insufficientWindow: false,
      degradedMembers: [],
    });
  });

  it("HARD-05: dqf.degraded_members → dataQuality.degradedMembers (reason dropped)", async () => {
    const out = await readCompositeFactsheet(mockAdmin(SPARSE_ROWS), {
      strategyId: "s1",
      dqf: {
        ...DQF,
        degraded_members: [
          { seq: 2, venue: "bybit", reason: "venue_reconstruction_unavailable" },
        ],
      },
      metricsJsonByBasis: { cash_settlement: FULL_CASH },
      returnsDenominatorConfig: null,
    });
    // The server `reason` enum is dropped — only { seq, venue } reaches the render.
    expect(out!.buildOpts.dataQuality?.degradedMembers).toEqual([
      { seq: 2, venue: "bybit" },
    ]);
  });

  it("HARD-05: malformed degraded_members shapes strict-coerce to [] (T-93-03-02)", async () => {
    const malformed: unknown[] = [
      "bybit", // a string (not an array of objects)
      [{ seq: "x", venue: "bybit" }], // non-numeric seq
      [{ seq: 2 }], // missing venue
      [{ venue: "bybit" }], // missing seq
      [{ seq: Infinity, venue: "bybit" }], // non-finite seq
      [{ seq: 2, venue: "" }], // empty venue
      [42], // a number entry
      [{}], // an empty object
      {}, // not an array
    ];
    for (const degraded_members of malformed) {
      const out = await readCompositeFactsheet(mockAdmin(SPARSE_ROWS), {
        strategyId: "s1",
        dqf: { ...DQF, degraded_members: degraded_members as unknown },
        metricsJsonByBasis: { cash_settlement: FULL_CASH },
        returnsDenominatorConfig: null,
      });
      expect(out!.buildOpts.dataQuality?.degradedMembers).toEqual([]);
    }
  });

  it("HARD-05: mixed valid + junk entries keep only the well-formed records", async () => {
    const out = await readCompositeFactsheet(mockAdmin(SPARSE_ROWS), {
      strategyId: "s1",
      dqf: {
        ...DQF,
        degraded_members: [
          { seq: 2, venue: "bybit", reason: "venue_reconstruction_unavailable" },
          { seq: "x", venue: "okx" }, // junk — dropped
          { seq: 3, venue: "binance" },
        ] as unknown,
      },
      metricsJsonByBasis: { cash_settlement: FULL_CASH },
      returnsDenominatorConfig: null,
    });
    expect(out!.buildOpts.dataQuality?.degradedMembers).toEqual([
      { seq: 2, venue: "bybit" },
      { seq: 3, venue: "binance" },
    ]);
  });

  it("'simple' config → arithmetic method (Zavara override preserved)", async () => {
    const out = await readCompositeFactsheet(mockAdmin(SPARSE_ROWS), {
      strategyId: "s1",
      dqf: DQF,
      metricsJsonByBasis: { cash_settlement: FULL_CASH },
      returnsDenominatorConfig: { cumulative_method: "simple" },
    });
    expect(out!.buildOpts.cumulativeMethod).toBe("arithmetic");
  });

  it("data defect (missing cash headline) → null → placeholder", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const out = await readCompositeFactsheet(mockAdmin(SPARSE_ROWS), {
      strategyId: "s1",
      dqf: DQF,
      metricsJsonByBasis: null, // metrics_json_by_basis NULL
      returnsDenominatorConfig: null,
    });
    expect(out).toBeNull();
    err.mockRestore();
  });

  it("composite built with forced ingestSource:'csv' lands on the csv arm (NO invented panels)", async () => {
    // Pre-fix hazard: a composite has daily_returns=NULL, so the discovery page's
    // classification would take the api arm.
    expect(deriveIngestSource(null)).toBe("api");

    const out = await readCompositeFactsheet(mockAdmin(SPARSE_ROWS), {
      strategyId: "s1",
      dqf: DQF,
      metricsJsonByBasis: { cash_settlement: FULL_CASH },
      returnsDenominatorConfig: null,
    });
    const payload = buildFactsheetPayload(
      {
        id: "s1",
        name: "Composite",
        types: ["quant"],
        markets: ["crypto"],
        computedAt: "2025-08-08T00:00:00Z",
        trustTier: null,
        ingestSource: "csv", // the fix forces this for composites
      },
      out!.dailyReturns,
      out!.buildOpts,
    )!;
    expect(payload.ingestSource).toBe("csv");
    // The three invented api-only panels are ABSENT on the csv arm.
    expect("peerPercentile" in payload).toBe(false);
    expect("allocatorPortfolios" in payload).toBe(false);
    expect("eventSignatures" in payload).toBe(false);
  });
});

/**
 * HARD-03 (#69 / Phase-90 LOW-2) — chart↔headline method drift kill. The headline
 * scalars are frozen at stitch under the worker's cumulative_method (persisted RAW
 * into `data_quality_flags.cumulative_method` — Task 1). The read-path used to
 * re-derive the chart basis LIVE from `returns_denominator_config`, so editing the
 * config after publish (without re-stitching) flipped the chart away from the
 * frozen headline. `readCompositeFactsheet` now PREFERS the persisted method, with
 * a live-derive FALLBACK so older composites (no persisted key) stay byte-identical.
 */
describe("HARD-03 readCompositeFactsheet — prefer persisted cumulative_method over live re-derive", () => {
  it("drift-kill: persisted 'simple' beats a live config that would derive geometric → arithmetic", async () => {
    const out = await readCompositeFactsheet(mockAdmin(SPARSE_ROWS), {
      strategyId: "s1",
      dqf: { ...DQF, cumulative_method: "simple" },
      metricsJsonByBasis: { cash_settlement: FULL_CASH },
      returnsDenominatorConfig: null, // live derive would be "geometric"
    });
    // The persisted frozen method wins: "simple" → "arithmetic".
    expect(out!.buildOpts.cumulativeMethod).toBe("arithmetic");
  });

  it("reverse drift-kill: persisted 'geometric' beats a live config that would derive arithmetic → geometric", async () => {
    const out = await readCompositeFactsheet(mockAdmin(SPARSE_ROWS), {
      strategyId: "s1",
      dqf: { ...DQF, cumulative_method: "geometric" },
      metricsJsonByBasis: { cash_settlement: FULL_CASH },
      returnsDenominatorConfig: { cumulative_method: "simple" }, // live derive would be "arithmetic"
    });
    expect(out!.buildOpts.cumulativeMethod).toBe("geometric");
  });

  it("older-composite fallback: absent persisted method → live re-derive (byte-identical)", async () => {
    // DQF carries NO cumulative_method — the pre-HARD-03 state of every already-
    // published composite. It must fall back to the live config derive verbatim.
    const out = await readCompositeFactsheet(mockAdmin(SPARSE_ROWS), {
      strategyId: "s1",
      dqf: DQF,
      metricsJsonByBasis: { cash_settlement: FULL_CASH },
      returnsDenominatorConfig: { cumulative_method: "simple" },
    });
    expect(out!.buildOpts.cumulativeMethod).toBe("arithmetic"); // live derive, unchanged
  });

  it("strict-literal coercion: only exact 'simple'/'geometric' honored; malformed values fall back to live (T-92-05)", async () => {
    // A tampered/garbage persisted value must NEVER independently pick a basis —
    // it defers to the live derive. Here the live config is null → "geometric", so
    // an honored-malformed bug would surface as anything other than "geometric".
    for (const bad of [true, 42, "arithmetic", {}] as unknown[]) {
      const out = await readCompositeFactsheet(mockAdmin(SPARSE_ROWS), {
        strategyId: "s1",
        dqf: { ...DQF, cumulative_method: bad },
        metricsJsonByBasis: { cash_settlement: FULL_CASH },
        returnsDenominatorConfig: null, // fallback derive → "geometric"
      });
      expect(out!.buildOpts.cumulativeMethod).toBe("geometric");
    }
  });

  it("Phase 93.1 hardening: an UNEXPECTED persisted method WARNS then falls back; absent/null stays silent", async () => {
    // A value PRESENT but outside {simple,geometric} used to silently re-derive
    // (re-opening the HARD-03 drift with no signal). It must now warn LOUD before
    // the preserved live fallback — while the legitimate older-composite path
    // (absent / null persisted key) must NOT warn.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      // 1. bogus value present → WARN once + live fallback (null config → geometric).
      const bogus = await readCompositeFactsheet(mockAdmin(SPARSE_ROWS), {
        strategyId: "s1",
        dqf: { ...DQF, cumulative_method: "bogus" },
        metricsJsonByBasis: { cash_settlement: FULL_CASH },
        returnsDenominatorConfig: null,
      });
      expect(bogus!.buildOpts.cumulativeMethod).toBe("geometric"); // fallback preserved
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0]![0]).toContain("unexpected persisted cumulative_method");

      // 2. absent key (every pre-HARD-03 composite) → NO warn, silent live fallback.
      warn.mockClear();
      const absent = await readCompositeFactsheet(mockAdmin(SPARSE_ROWS), {
        strategyId: "s1",
        dqf: { ...DQF }, // no cumulative_method key
        metricsJsonByBasis: { cash_settlement: FULL_CASH },
        returnsDenominatorConfig: { cumulative_method: "simple" },
      });
      expect(absent!.buildOpts.cumulativeMethod).toBe("arithmetic"); // live derive
      expect(warn).not.toHaveBeenCalled();

      // 3. explicit null → NO warn (legitimate fallback, not a defect).
      warn.mockClear();
      await readCompositeFactsheet(mockAdmin(SPARSE_ROWS), {
        strategyId: "s1",
        dqf: { ...DQF, cumulative_method: null },
        metricsJsonByBasis: { cash_settlement: FULL_CASH },
        returnsDenominatorConfig: null,
      });
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });
});

/**
 * Finding B (Phase 92 hardening) — the SINGLE-KEY `insufficient_window` DQ flag is
 * persisted server-side (analytics_runner.py :1839/:2367, with a passing lift
 * test) but was NEVER rendered on the factsheet: both FactsheetView-consumer
 * surfaces (the `/factsheet/[id]/v2` route + the discovery detail page) assigned
 * `buildOpts` ONLY on their composite arm, so a single-key strategy built
 * `buildOpts=undefined` → `payload.dataQuality` undefined → the FactsheetView
 * caveat gate (`payload.dataQuality?.insufficientWindow === true`) was dead for
 * single-key. `singleKeyDataQuality` is the ONE shared owner both arms now
 * delegate to (mirroring the composite `readCompositeFactsheet` "one path").
 */
describe("Finding B — singleKeyDataQuality single-key DQ opt (one owner)", () => {
  it("strict `=== true` server-truth coercion: only literal true flags the window", () => {
    // The persisted truth flags it.
    expect(singleKeyDataQuality({ insufficient_window: true })).toEqual({
      composite: false,
      insufficientWindow: true,
    });
    // Absent / null / undefined dqf → not flagged (single-key default absent-as-false).
    expect(singleKeyDataQuality({}).insufficientWindow).toBe(false);
    expect(singleKeyDataQuality(null).insufficientWindow).toBe(false);
    expect(singleKeyDataQuality(undefined).insufficientWindow).toBe(false);
    // T-92-05 tampering guard: a non-boolean value must NEVER flag the caveat.
    expect(singleKeyDataQuality({ insufficient_window: "true" }).insufficientWindow).toBe(false);
    expect(singleKeyDataQuality({ insufficient_window: 1 }).insufficientWindow).toBe(false);
    // Always single-key (`composite:false`) — behaviorally identical to absent for
    // every `=== true` composite reader, so it never trips the composite branch.
    expect(singleKeyDataQuality({ insufficient_window: true }).composite).toBe(false);
  });

  it("regression: threaded single-key opts surface insufficientWindow on the payload; the pre-fix undefined opts (buildOpts unassigned) drop it", () => {
    const series: DailyReturn[] = [
      { date: "2025-08-01", value: 0.01 },
      { date: "2025-08-02", value: 0.02 },
      { date: "2025-08-03", value: -0.01 },
      { date: "2025-08-04", value: 0.015 },
    ];
    const base = {
      id: "sk1",
      name: "Single-key",
      types: ["quant"],
      markets: ["crypto"],
      computedAt: "2025-08-04T00:00:00Z",
      trustTier: null,
      ingestSource: "csv" as const,
    };

    // PRE-FIX single-key arm: buildOpts stayed undefined → the persisted flag was
    // dropped, so the factsheet caveat could never render (Finding B).
    const preFix = buildFactsheetPayload(base, series, undefined)!;
    expect(preFix.dataQuality?.insufficientWindow).toBeUndefined();

    // FIXED single-key arm: both pages now thread singleKeyDataQuality(dqf) →
    // payload carries the server truth so the FactsheetView :876 caveat fires.
    const fixed = buildFactsheetPayload(
      base,
      series,
      { dataQuality: singleKeyDataQuality({ insufficient_window: true }) },
    )!;
    expect(fixed.dataQuality).toEqual({ composite: false, insufficientWindow: true });
  });
});

/**
 * Phase 102 (MTM-01) — singleKeyBasisOpts: the ONE single-key MTM read helper.
 * Mirrors the composite mtmGate assembly (readCompositeFactsheet :167-170) but for
 * a single-key options strategy, colocated so BOTH factsheet surfaces (the
 * `/factsheet/[id]/v2` route + the discovery detail page) consume one owner and
 * can't diverge (the "one path" lesson). Two load-bearing invariants:
 *   - F-4 (T-102-01): `mtmGate.available` is gated on `computation_status ∈
 *     {complete, complete_with_warnings}` — a failed/computing row NEVER exposes a
 *     live-looking MTM object (its payload carries NO metricsByBasis at all).
 *   - SC-4 (T-102-SC keystone): the helper threads ONLY the `mark_to_market` key,
 *     NEVER the raw `metrics_json_by_basis` column — a lingering `cash_settlement`
 *     key (composite→single stale window) would activate the build-payload.ts:243
 *     cash overlay and perturb the byte-identical cash headline.
 */
describe("MTM-01 singleKeyBasisOpts — F-4 gate + SC-4-safe single-key threading", () => {
  const MTM_FULL = {
    cumulative_return: 0.9,
    volatility: 0.25,
    max_drawdown: -0.18,
    cagr: 0.7,
    sharpe: 2.2,
    sortino: 2.9,
    calmar: 0.9,
  };

  it("F4-1 (F-4 gate): a non-DONE computation_status NEVER exposes a live-looking MTM object", () => {
    // Neuter check: forcing the DONE gate always-true makes this RED (available
    // true + metricsByBasis threaded on a failed/computing/undefined-status row).
    for (const status of ["failed", "computing", undefined, null, "complete_with_warnings_x"]) {
      const out = singleKeyBasisOpts({}, { mark_to_market: MTM_FULL }, status);
      expect(out.mtmGate?.available).toBe(false);
      // Structural F-4: a non-DONE row's payload carries NO MTM object at all.
      expect(out.metricsByBasis).toBeUndefined();
    }
  });

  it("F4-2: computation_status complete / complete_with_warnings → available + threaded MTM object", () => {
    for (const status of ["complete", "complete_with_warnings"]) {
      const out = singleKeyBasisOpts({}, { mark_to_market: MTM_FULL }, status);
      expect(out.mtmGate?.available).toBe(true);
      expect(out.metricsByBasis).toEqual({ mark_to_market: MTM_FULL });
    }
  });

  it("SC4-1 (stale-key hazard): a lingering cash_settlement key is NEVER threaded — only mark_to_market", () => {
    // The 101-01 "Observed-but-out-of-scope #1" composite→single stale window: the
    // raw column may still carry a cash_settlement key. Neuter check: threading the
    // raw column instead of {mark_to_market} makes this RED (a cash key survives →
    // build-payload.ts:243 overlay fires → cash headline perturbed → SC-4 breach).
    const STALE_CASH = {
      cumulative_return: 0.05,
      volatility: 0.99,
      max_drawdown: -0.5,
      cagr: 0.01,
      sharpe: 0.1,
      sortino: 0.1,
      calmar: 0.1,
    };
    const out = singleKeyBasisOpts(
      {},
      { cash_settlement: STALE_CASH, mark_to_market: MTM_FULL },
      "complete",
    );
    expect(out.metricsByBasis).toEqual({ mark_to_market: MTM_FULL });
    expect(out.metricsByBasis && "cash_settlement" in out.metricsByBasis).toBe(false);
  });

  it("HONEST-1: no MTM key + an honest reason → disabled-with-reason, no MTM object", () => {
    const out = singleKeyBasisOpts(
      { mtm_gated_reason: "mtm_summary_coverage_incomplete" },
      {}, // no mark_to_market key
      "complete",
    );
    expect(out.mtmGate).toEqual({ available: false, reason: "mtm_summary_coverage_incomplete" });
    expect(out.metricsByBasis).toBeUndefined();
  });

  it("SILENT-1: no MTM key AND no reason → EMPTY result (every non-options single-key; byte-identical)", () => {
    const out = singleKeyBasisOpts({}, {}, "complete");
    expect(out).toEqual({});
    expect("mtmGate" in out).toBe(false);
    expect("metricsByBasis" in out).toBe(false);
  });

  it("SILENT-1 (null/undefined jsonb): a null / absent metrics_json_by_basis with no reason → EMPTY", () => {
    expect(singleKeyBasisOpts(null, null, "complete")).toEqual({});
    expect(singleKeyBasisOpts(undefined, undefined, "complete")).toEqual({});
    // A non-object jsonb (string / number / array) with no reason is also EMPTY.
    expect(singleKeyBasisOpts({}, "garbage", "complete")).toEqual({});
    expect(singleKeyBasisOpts({}, [MTM_FULL], "complete")).toEqual({});
  });

  it("DEGEN-1: a present-but-degenerate MTM object (fails hasBasisHeadline) with a DONE status → unavailable, no MTM object", () => {
    // A non-finite headline (cumulative_return null) is a real data defect: DONE
    // but not displayable → available false, and NO MTM object threaded.
    const DEGEN = { ...MTM_FULL, cumulative_return: null as unknown as number };
    const out = singleKeyBasisOpts({}, { mark_to_market: DEGEN }, "complete");
    expect(out.mtmGate?.available).toBe(false);
    expect(out.metricsByBasis).toBeUndefined();
  });

  it("a non-string mtm_gated_reason is coerced to undefined (server-truth, mirrors :169)", () => {
    const out = singleKeyBasisOpts(
      { mtm_gated_reason: 42 as unknown },
      { mark_to_market: MTM_FULL },
      "complete",
    );
    // Reason drops to undefined; the MTM object is still available (DONE + headline).
    expect(out.mtmGate).toEqual({ available: true, reason: undefined });
    expect(out.metricsByBasis).toEqual({ mark_to_market: MTM_FULL });
  });

  // ---- MTM-04 (Phase 103) — 4th-param MTM series threading ----
  const SERIES: ParsedMtmSeries = {
    dailyReturns: [
      { date: "2025-08-01", value: 0.02 },
      { date: "2025-08-02", value: -0.01 },
      { date: "2025-08-05", value: 0.03 },
    ],
    gapSpans: [{ start: "2025-08-03", end: "2025-08-04" }],
  };

  it("MTM-04: available (DONE + headline) + parsed series → threads buildOpts.mtmSeries", () => {
    const out = singleKeyBasisOpts({}, { mark_to_market: MTM_FULL }, "complete", SERIES);
    expect(out.mtmGate?.available).toBe(true);
    expect(out.mtmSeries).toBe(SERIES);
  });

  it("MTM-04 (structural F-4 gate): a non-DONE status NEVER threads the MTM series, even when a parsed series is supplied", () => {
    // Neuter check: forcing the DONE gate true (or removing the `available &&`
    // guard on the mtmSeries spread) makes this RED — a failed/computing row would
    // leak a live-looking MTM SERIES bundle. The series rides the SAME F-4 gate as
    // the scalar object.
    for (const status of ["failed", "computing", undefined, null]) {
      const out = singleKeyBasisOpts({}, { mark_to_market: MTM_FULL }, status, SERIES);
      expect(out.mtmGate?.available).toBe(false);
      expect(out.mtmSeries).toBeUndefined();
    }
  });

  it("MTM-04: available but the reader returned null (degraded/failed series read) → no mtmSeries key", () => {
    const out = singleKeyBasisOpts({}, { mark_to_market: MTM_FULL }, "complete", null);
    expect(out.mtmGate?.available).toBe(true);
    expect("mtmSeries" in out).toBe(false);
  });

  it("MTM-04 (SILENT-1): a non-options single-key strategy passing a series still returns EMPTY (no MTM key/reason → {})", () => {
    // A stray series with no MTM scalar object + no reason must NOT resurrect a
    // bundle — the early SILENT-1 return keeps the payload byte-identical.
    const out = singleKeyBasisOpts({}, {}, "complete", SERIES);
    expect(out).toEqual({});
    expect("mtmSeries" in out).toBe(false);
  });
});

/**
 * Phase 103 (MTM-04) — parseMtmSeriesPayload: the DB-JSONB → RSC trust-boundary
 * coercion (T-103-05). A malformed/failed series row must degrade to no-bundle
 * (charts stay cash, V5), never crash or fabricate.
 */
describe("MTM-04 parseMtmSeriesPayload — strict coercion of the untrusted series row", () => {
  const VALID = {
    schema: 1,
    basis: "mark_to_market",
    rows: [
      { date: "2025-08-01", return: 0.02 },
      { date: "2025-08-02", return: -0.01 },
      { date: "2025-08-05", return: 0.03 },
    ],
    gap_spans: [{ start: "2025-08-03", end: "2025-08-04" }],
    conventions: { periods_per_year: 365, cumulative_method: "geometric", day_basis: "calendar" },
  };

  it("valid payload → maps `return`→`value`, ascending rows + gapSpans", () => {
    const out = parseMtmSeriesPayload(VALID);
    expect(out).not.toBeNull();
    expect(out!.dailyReturns).toEqual([
      { date: "2025-08-01", value: 0.02 },
      { date: "2025-08-02", value: -0.01 },
      { date: "2025-08-05", value: 0.03 },
    ]);
    expect(out!.gapSpans).toEqual([{ start: "2025-08-03", end: "2025-08-04" }]);
  });

  it("non-object / array / null payloads → null", () => {
    for (const raw of [null, undefined, 42, "x", true, [VALID]]) {
      expect(parseMtmSeriesPayload(raw as unknown)).toBeNull();
    }
  });

  it("missing / non-array `rows` → null", () => {
    expect(parseMtmSeriesPayload({ ...VALID, rows: undefined })).toBeNull();
    expect(parseMtmSeriesPayload({ ...VALID, rows: "nope" })).toBeNull();
    expect(parseMtmSeriesPayload({ ...VALID, rows: {} })).toBeNull();
  });

  it("fewer than 2 VALID rows → null (mirrors the build-payload dedup<2 guard)", () => {
    expect(parseMtmSeriesPayload({ ...VALID, rows: [{ date: "2025-08-01", return: 0.02 }] })).toBeNull();
    // 3 rows but only 1 valid (bad date, non-finite return) → <2 → null.
    expect(
      parseMtmSeriesPayload({
        ...VALID,
        rows: [
          { date: "2025-08-01", return: 0.02 },
          { date: 42, return: 0.01 },
          { date: "2025-08-03", return: Infinity },
        ],
      }),
    ).toBeNull();
  });

  it("drops invalid rows but keeps ≥2 valid ones (strict per-row coercion)", () => {
    const out = parseMtmSeriesPayload({
      ...VALID,
      rows: [
        { date: "2025-08-01", return: 0.02 },
        { date: "", return: 0.01 }, // empty date — dropped
        { date: "2025-08-02", return: NaN }, // non-finite — dropped
        { date: "2025-08-03", return: -0.04 },
        "junk", // not an object — dropped
        { date: "2025-08-04", return: 0.05 },
      ],
    });
    expect(out!.dailyReturns).toEqual([
      { date: "2025-08-01", value: 0.02 },
      { date: "2025-08-03", value: -0.04 },
      { date: "2025-08-04", value: 0.05 },
    ]);
  });

  it("gap_spans coerced defensively: non-array → [], junk entries dropped", () => {
    expect(parseMtmSeriesPayload({ ...VALID, gap_spans: "nope" })!.gapSpans).toEqual([]);
    expect(parseMtmSeriesPayload({ ...VALID, gap_spans: undefined })!.gapSpans).toEqual([]);
    expect(
      parseMtmSeriesPayload({
        ...VALID,
        gap_spans: [
          { start: "2025-08-03", end: "2025-08-04" },
          { start: 3, end: "x" }, // non-string start — dropped
          "junk",
          { start: "2025-08-10" }, // missing end — dropped
        ],
      })!.gapSpans,
    ).toEqual([{ start: "2025-08-03", end: "2025-08-04" }]);
  });
});

/**
 * Phase 103 (MTM-04, T-103-06) — readMtmSeries: service-role direct read of the
 * `mtm_daily_returns` row, degrade-never-throw on error/absent/malformed.
 */
describe("MTM-04 readMtmSeries — service-role direct read + degrade", () => {
  const VALID_PAYLOAD = {
    schema: 1,
    basis: "mark_to_market",
    rows: [
      { date: "2025-08-01", return: 0.02 },
      { date: "2025-08-02", return: -0.01 },
    ],
    gap_spans: [],
    conventions: { periods_per_year: 365, cumulative_method: "geometric", day_basis: "calendar" },
  };

  function mockSeriesAdmin(
    result: { data: { payload: unknown } | null; error: { message?: string } | null },
  ): SupabaseClient {
    const chain = {
      select: () => chain,
      eq: () => chain,
      maybeSingle: () => Promise.resolve(result),
    };
    return { from: () => chain } as unknown as SupabaseClient;
  }

  it("valid row → ParsedMtmSeries", async () => {
    const out = await readMtmSeries(mockSeriesAdmin({ data: { payload: VALID_PAYLOAD }, error: null }), "s1");
    expect(out!.dailyReturns).toEqual([
      { date: "2025-08-01", value: 0.02 },
      { date: "2025-08-02", value: -0.01 },
    ]);
  });

  it("read error → null + console.error (degrade, never throw)", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const out = await readMtmSeries(mockSeriesAdmin({ data: null, error: { message: "boom" } }), "s1");
    expect(out).toBeNull();
    expect(err).toHaveBeenCalledOnce();
    err.mockRestore();
  });

  it("missing row (maybeSingle null) → null", async () => {
    const out = await readMtmSeries(mockSeriesAdmin({ data: null, error: null }), "s1");
    expect(out).toBeNull();
  });

  it("malformed payload (garbage shape) → null (no throw)", async () => {
    const out = await readMtmSeries(mockSeriesAdmin({ data: { payload: { rows: "x" } }, error: null }), "s1");
    expect(out).toBeNull();
  });
});

/**
 * Phase 103 (MTM-04) — readCompositeFactsheet threads the persisted MTM series
 * into buildOpts ONLY when the scalar MTM gate is available, and SKIPS the extra
 * DB roundtrip entirely for a non-MTM composite.
 */
describe("MTM-04 readCompositeFactsheet — gated MTM series threading (one owner)", () => {
  const MTM_HEADLINE = {
    cumulative_return: 0.9,
    volatility: 0.25,
    max_drawdown: -0.18,
    cagr: 0.7,
    sharpe: 2.2,
    sortino: 2.9,
    calmar: 0.9,
  };
  const MTM_PAYLOAD = {
    schema: 1,
    basis: "mark_to_market",
    rows: [
      { date: "2025-08-01", return: 0.02 },
      { date: "2025-08-02", return: -0.01 },
      { date: "2025-08-05", return: 0.03 },
    ],
    gap_spans: [{ start: "2025-08-03", end: "2025-08-04" }],
    conventions: { periods_per_year: 365, cumulative_method: "geometric", day_basis: "calendar" },
  };

  function mockAdminMulti(opts: {
    sparseRows?: { date: string; daily_return: number }[] | null;
    mtmPayload?: unknown;
    mtmError?: { message?: string } | null;
    mtmRowNull?: boolean;
  }): { admin: SupabaseClient; mtmReads: () => number } {
    let mtmReadCount = 0;
    const from = (table: string) => {
      if (table === "strategy_analytics_series") {
        const chain = {
          select: () => chain,
          eq: () => chain,
          maybeSingle: () => {
            mtmReadCount++;
            return Promise.resolve({
              data: opts.mtmRowNull ? null : { payload: opts.mtmPayload },
              error: opts.mtmError ?? null,
            });
          },
        };
        return chain;
      }
      const chain = {
        select: () => chain,
        eq: () => chain,
        order: () => chain,
        limit: () => Promise.resolve({ data: opts.sparseRows ?? SPARSE_ROWS, error: null }),
      };
      return chain;
    };
    return { admin: { from } as unknown as SupabaseClient, mtmReads: () => mtmReadCount };
  }

  it("mtmAvailable + valid MTM row → threads buildOpts.mtmSeries (mapped series + gapSpans)", async () => {
    const { admin, mtmReads } = mockAdminMulti({ mtmPayload: MTM_PAYLOAD });
    const out = await readCompositeFactsheet(admin, {
      strategyId: "s1",
      dqf: DQF,
      metricsJsonByBasis: { cash_settlement: FULL_CASH, mark_to_market: MTM_HEADLINE },
      returnsDenominatorConfig: null,
    });
    expect(out!.buildOpts.mtmSeries).toEqual({
      dailyReturns: [
        { date: "2025-08-01", value: 0.02 },
        { date: "2025-08-02", value: -0.01 },
        { date: "2025-08-05", value: 0.03 },
      ],
      gapSpans: [{ start: "2025-08-03", end: "2025-08-04" }],
    });
    expect(mtmReads()).toBe(1);
  });

  it("NOT mtmAvailable (no mark_to_market headline) → no mtmSeries AND no MTM roundtrip", async () => {
    const { admin, mtmReads } = mockAdminMulti({ mtmPayload: MTM_PAYLOAD });
    const out = await readCompositeFactsheet(admin, {
      strategyId: "s1",
      dqf: DQF,
      metricsJsonByBasis: { cash_settlement: FULL_CASH }, // no mark_to_market
      returnsDenominatorConfig: null,
    });
    expect("mtmSeries" in out!.buildOpts).toBe(false);
    // The extra DB read is SKIPPED for every non-MTM composite.
    expect(mtmReads()).toBe(0);
  });

  it("mtmAvailable but the MTM series read errors → degrade to no mtmSeries (composite still renders)", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const { admin } = mockAdminMulti({ mtmError: { message: "boom" } });
    const out = await readCompositeFactsheet(admin, {
      strategyId: "s1",
      dqf: DQF,
      metricsJsonByBasis: { cash_settlement: FULL_CASH, mark_to_market: MTM_HEADLINE },
      returnsDenominatorConfig: null,
    });
    expect(out).not.toBeNull();
    expect("mtmSeries" in out!.buildOpts).toBe(false);
    err.mockRestore();
  });
});

/**
 * Phase 103 (MTM-04) — shouldReadSingleKeyMtmSeries: the cheap DONE + mark_to_market
 * -object predicate both single-key surfaces share to skip the DB roundtrip for the
 * hot non-options path.
 */
describe("MTM-04 shouldReadSingleKeyMtmSeries — cheap shared read gate", () => {
  const MTM = { cumulative_return: 0.9, volatility: 0.25, max_drawdown: -0.18, cagr: 0.7, sharpe: 2.2, sortino: 2.9, calmar: 0.9 };

  it("DONE + mark_to_market object → true", () => {
    expect(shouldReadSingleKeyMtmSeries({ mark_to_market: MTM }, "complete")).toBe(true);
    expect(shouldReadSingleKeyMtmSeries({ mark_to_market: MTM }, "complete_with_warnings")).toBe(true);
  });

  it("not DONE → false (no roundtrip for computing/failed)", () => {
    for (const s of ["computing", "failed", undefined, null, "complete_x"]) {
      expect(shouldReadSingleKeyMtmSeries({ mark_to_market: MTM }, s)).toBe(false);
    }
  });

  it("no mark_to_market object → false (hot non-options path stays roundtrip-free)", () => {
    expect(shouldReadSingleKeyMtmSeries({}, "complete")).toBe(false);
    expect(shouldReadSingleKeyMtmSeries({ cash_settlement: MTM }, "complete")).toBe(false);
    expect(shouldReadSingleKeyMtmSeries({ mark_to_market: null }, "complete")).toBe(false);
    expect(shouldReadSingleKeyMtmSeries({ mark_to_market: [MTM] }, "complete")).toBe(false);
    expect(shouldReadSingleKeyMtmSeries(null, "complete")).toBe(false);
    expect(shouldReadSingleKeyMtmSeries("garbage", "complete")).toBe(false);
  });
});
