import { describe, it, expect, vi } from "vitest";

// The helper imports `server-only` (a Next.js build guard that throws outside an
// RSC bundle). Stub it so this unit test can import the module — the existing
// pattern in src/lib/audit.test.ts / auth.test.ts / email.test.ts.
vi.mock("server-only", () => ({}));

import type { SupabaseClient } from "@supabase/supabase-js";
import { readCompositeFactsheet, singleKeyDataQuality } from "./composite-read-path";
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
