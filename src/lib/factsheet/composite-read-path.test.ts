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
  parseSmoothedSeriesPayload,
  readMtmSeries,
  readSmoothedSeries,
  readSingleKeyBasisOpts,
  CompositeSeriesReadError,
  shouldReadSingleKeyMtmSeries,
  shouldReadSingleKeySmoothedSeries,
  shouldReadCashSettlementSeries,
  shouldReadSingleKeyCashSeries,
  deriveHeadlineCoversFrom,
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

/**
 * Hosted Supabase's PostgREST `max_rows`: every response carries at most this
 * many rows, whatever `.limit()` asked for, with HTTP 200 and `error: null`.
 * MEASURED on PROD 2026-09-29: one strategy holds 1112 `csv_daily_returns` rows.
 */
const POSTGREST_MAX_ROWS = 1000;

type CsvRow = { date: string; daily_return: number };

/**
 * A `csv_daily_returns` query builder that answers as PostgREST does: rows in
 * date order, `.gt("date", cursor)` honoured, and every response silently
 * capped at {@link POSTGREST_MAX_ROWS}. `ignoreCursor` models a server that
 * drops the keyset filter, so every page starts from the first row again.
 */
function csvChain(
  rows: CsvRow[] | null,
  error: { message?: string; code?: string } | null = null,
  opts: { ignoreCursor?: boolean } = {},
) {
  let after: string | null = null;
  const chain = {
    select: () => chain,
    eq: () => chain,
    gt: (_column: string, value: string) => {
      if (!opts.ignoreCursor) after = value;
      return chain;
    },
    order: () => chain,
    limit: (n: number) =>
      Promise.resolve(
        error || rows === null
          ? { data: null, error }
          : {
              data: rows
                .filter((r) => after === null || r.date > after)
                .slice(0, Math.min(n, POSTGREST_MAX_ROWS)),
              error: null,
            },
      ),
  };
  return chain;
}

function mockAdmin(
  rows: CsvRow[] | null,
  error: { message?: string; code?: string } | null = null,
  opts: { ignoreCursor?: boolean } = {},
): SupabaseClient {
  return { from: () => csvChain(rows, error, opts) } as unknown as SupabaseClient;
}

/** N consecutive calendar days of synthetic returns from 2022-01-01. */
function csvDays(n: number): CsvRow[] {
  const start = Date.parse("2022-01-01T00:00:00Z");
  return Array.from({ length: n }, (_, i) => ({
    date: new Date(start + i * 86_400_000).toISOString().slice(0, 10),
    daily_return: ((i % 5) - 2) / 1000,
  }));
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
 * Phase 169 (D-41, routed from 167.2.1 D-07) — a FAILED `csv_daily_returns`
 * read must be distinguishable from a composite whose series is genuinely
 * empty. The reader used to log the error and map `sparseRows ?? []`, so an
 * outage reached the resolve stage as an empty series, which answered
 * `composite_unbuildable` (a fact about the row) and let the public factsheet
 * cache store that null for the whole analytics run. The reader now throws
 * `CompositeSeriesReadError` carrying the PostgREST / SQLSTATE code; the two
 * controls prove a SUCCESSFUL empty read still resolves exactly as before.
 */
describe("169 D-41 readCompositeFactsheet — a failed csv_daily_returns read is not an empty composite", () => {
  const input = {
    strategyId: "s1",
    dqf: DQF,
    metricsJsonByBasis: { cash_settlement: FULL_CASH },
    returnsDenominatorConfig: null,
  };

  it("a failed read rejects with CompositeSeriesReadError carrying its code, and the message names the table, never the strategy", async () => {
    const err = await readCompositeFactsheet(
      mockAdmin(null, { message: "synthetic statement timeout", code: "57014" }),
      input,
    ).then(
      () => null,
      (e: unknown) => e,
    );
    expect(err, "the read resolved: the outage was folded into an empty series").not.toBeNull();
    expect(err).toBeInstanceOf(CompositeSeriesReadError);
    expect((err as CompositeSeriesReadError).code).toBe("57014");
    expect((err as Error).name).toBe("CompositeSeriesReadError");
    expect((err as Error).message).toContain("csv_daily_returns");
    expect((err as Error).message).not.toContain(input.strategyId);
  });

  it("a failed read whose error has no code carries the code \"none\"", async () => {
    const err = await readCompositeFactsheet(mockAdmin(null, { message: "synthetic outage, no code" }), input).then(
      () => null,
      (e: unknown) => e,
    );
    expect(err, "the read resolved: the outage was folded into an empty series").not.toBeNull();
    expect(err).toBeInstanceOf(CompositeSeriesReadError);
    expect((err as CompositeSeriesReadError).code).toBe("none");
  });

  it("CONTROL: a successful EMPTY read with a valid headline resolves as before (an empty series, not a throw)", async () => {
    const out = await readCompositeFactsheet(mockAdmin([]), input);
    expect(out).not.toBeNull();
    expect(out!.dailyReturns).toEqual([]);
  });

  it("CONTROL: a successful EMPTY read with no headline still resolves null", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const out = await readCompositeFactsheet(mockAdmin([]), { ...input, metricsJsonByBasis: null });
      expect(out).toBeNull();
    } finally {
      err.mockRestore();
    }
  });
});

/**
 * Phase 169 review round 1, orchestrator-added CSV-READ-CAP. PostgREST answers
 * every read with at most `max_rows` rows (1000 on hosted Supabase), silently:
 * HTTP 200, `error: null`, a partial body. The composite read asked for
 * `.limit(20000)` in one call and ordered ascending, so a composite longer than
 * 1000 days lost its NEWEST days and the factsheet ended early with nothing
 * saying so (measured on PROD 2026-09-29: one strategy has 1112 rows). The read
 * now pages by a date keyset until a page comes back empty, and a read it
 * cannot finish is a `CompositeSeriesReadError`, never a partial series.
 */
describe("169 CSV-READ-CAP readCompositeFactsheet — the whole csv_daily_returns series, never the first 1000 rows", () => {
  const input = {
    strategyId: "s1",
    dqf: DQF,
    metricsJsonByBasis: { cash_settlement: FULL_CASH },
    returnsDenominatorConfig: null,
  };

  it("a composite longer than one PostgREST response reads every row, the newest day included", async () => {
    const rows = csvDays(1112);
    const out = await readCompositeFactsheet(mockAdmin(rows), input);
    expect(out!.dailyReturns).toHaveLength(1112);
    expect(out!.dailyReturns.at(-1)!.date).toBe(rows.at(-1)!.date);
    expect(out!.dailyReturns.map((d) => d.date)).toEqual(rows.map((r) => r.date));
  });

  it("a server that ignores the cursor is a read error, never a series with a repeated day", async () => {
    const err = await readCompositeFactsheet(mockAdmin(csvDays(1112), null, { ignoreCursor: true }), input).then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(CompositeSeriesReadError);
    expect((err as CompositeSeriesReadError).code).toBe("page_order");
  });

  it("a series past the row ceiling is a read error, never a truncated one", async () => {
    const err = await readCompositeFactsheet(mockAdmin(csvDays(20_001)), input).then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(CompositeSeriesReadError);
    expect((err as CompositeSeriesReadError).code).toBe("row_ceiling");
  });

  it("a page answering neither data nor an error is a read error, not the end of the series", async () => {
    const err = await readCompositeFactsheet(mockAdmin(null), input).then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(CompositeSeriesReadError);
    expect((err as CompositeSeriesReadError).code).toBe("no_data");
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
 * persisted server-side (the `HARD-04` lift in
 * `analytics_runner.run_csv_strategy_analytics`, with a passing lift test)
 * but was NEVER rendered on the factsheet: both FactsheetView-consumer
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

  it("FIX 4: warns (recoverable) when a present rows/gap_spans array has entries dropped; silent when clean", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      // (a) partially-dropped rows → one warn naming the row drop.
      parseMtmSeriesPayload({
        ...VALID,
        rows: [
          { date: "2025-08-01", return: 0.02 },
          { date: "", return: 0.01 }, // dropped
          { date: "2025-08-03", return: -0.04 },
        ],
      });
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0]![0]).toContain("dropped malformed mtm_daily_returns rows");
      expect(warn.mock.calls[0]![1]).toMatchObject({ total: 3, kept: 2, dropped: 1 });

      // (b) partially-dropped gap_spans → one warn naming the gap drop.
      warn.mockClear();
      parseMtmSeriesPayload({
        ...VALID,
        gap_spans: [
          { start: "2025-08-03", end: "2025-08-04" },
          { start: 3, end: "x" }, // dropped
        ],
      });
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0]![0]).toContain("dropped malformed gap_spans entries");

      // (c) fully-clean payload → NO warn (drop behavior unchanged, no false signal).
      warn.mockClear();
      parseMtmSeriesPayload(VALID);
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
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
    result: { data: { payload: unknown } | null; error: { message?: string; code?: string } | null },
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

  // 169 review round 1, WR-05 / SFH M-3: a failed read is an OUTAGE, not "no
  // series". Degrading it to null let the public cache store a payload without
  // its MTM bundle for the whole analytics run, so it now throws, as the
  // composite's csv_daily_returns read does (D-41).
  it("read error → throws CompositeSeriesReadError naming the series and its code", async () => {
    const err = await readMtmSeries(
      mockSeriesAdmin({ data: null, error: { message: "boom", code: "57014" } }),
      "s1",
    ).then(
      () => null,
      (e: unknown) => e,
    );
    expect(err, "the outage was degraded to 'no series'").toBeInstanceOf(CompositeSeriesReadError);
    expect((err as CompositeSeriesReadError).read).toBe("mtm_daily_returns");
    expect((err as CompositeSeriesReadError).code).toBe("57014");
    expect((err as Error).message).toContain("mtm_daily_returns");
    expect((err as Error).message).not.toContain("s1");
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
      return csvChain(opts.sparseRows ?? SPARSE_ROWS);
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

  // 169 review round 1, WR-05 / SFH M-3: an MTM series outage on a composite is
  // the same class as its csv outage (D-41) and is thrown, never folded into a
  // composite that builds without its MTM bundle and is then cached for the run.
  it("mtmAvailable but the MTM series read errors → throws CompositeSeriesReadError (read mtm_daily_returns)", async () => {
    const { admin } = mockAdminMulti({ mtmError: { message: "boom" } });
    const err = await readCompositeFactsheet(admin, {
      strategyId: "s1",
      dqf: DQF,
      metricsJsonByBasis: { cash_settlement: FULL_CASH, mark_to_market: MTM_HEADLINE },
      returnsDenominatorConfig: null,
    }).then(
      () => null,
      (e: unknown) => e,
    );
    expect(err, "the MTM outage was folded into a composite without its bundle").toBeInstanceOf(
      CompositeSeriesReadError,
    );
    expect((err as CompositeSeriesReadError).read).toBe("mtm_daily_returns");
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

/**
 * MED-1 (D3) — shouldReadCashSettlementSeries: the cash twin of
 * shouldReadSingleKeyMtmSeries. The single read-side status-gate that refuses a
 * stale `cash_settlement` series row left behind by ANY terminal-failure arm.
 * Truth-table mirrors the MTM block above (cash_settlement in place of
 * mark_to_market). Neuter target: drop the DONE gate (return the object check
 * alone) → RED on the failed/computing-status cases below.
 */
describe("MED-1 shouldReadCashSettlementSeries — read-side status-gate (D3 single choke point)", () => {
  const CASH = { cumulative_return: 0.42, volatility: 0.11, max_drawdown: -0.06, cagr: 0.31, sharpe: 1.4, sortino: 1.9, calmar: 0.8 };

  it("DONE + cash_settlement object → true (the only true rows)", () => {
    expect(shouldReadCashSettlementSeries({ cash_settlement: CASH }, "complete")).toBe(true);
    expect(shouldReadCashSettlementSeries({ cash_settlement: CASH }, "complete_with_warnings")).toBe(true);
  });

  it("not terminal-success → false (a stale row after ANY failure arm is never trusted)", () => {
    for (const s of ["failed", "computing", "pending", null, undefined, 0, "", "complete_x"]) {
      expect(shouldReadCashSettlementSeries({ cash_settlement: CASH }, s)).toBe(false);
    }
  });

  it("no cash_settlement object → false (malformed / wrong-shape jsonb)", () => {
    expect(shouldReadCashSettlementSeries({}, "complete")).toBe(false);
    expect(shouldReadCashSettlementSeries({ mark_to_market: CASH }, "complete")).toBe(false);
    expect(shouldReadCashSettlementSeries({ cash_settlement: null }, "complete")).toBe(false);
    expect(shouldReadCashSettlementSeries({ cash_settlement: [CASH] }, "complete")).toBe(false);
    expect(shouldReadCashSettlementSeries({ cash_settlement: 0.42 }, "complete")).toBe(false);
    expect(shouldReadCashSettlementSeries(null, "complete")).toBe(false);
    expect(shouldReadCashSettlementSeries([{ cash_settlement: CASH }], "complete")).toBe(false);
    expect(shouldReadCashSettlementSeries("garbage", "complete")).toBe(false);
  });
});

/**
 * 169 review round 2, WR-R2-03 — shouldReadSingleKeyCashSeries: the single-key
 * member of the MED-1 predicate family, which the H-1 reader (the first
 * production reader of a single-key `cash_settlement` series row) routes
 * through. The DONE half is MED-1's own: a stale series row left behind by a
 * failure arm is never read. The object half is inverted, because a single-key
 * row never carries a raw `metrics_json_by_basis.cash_settlement` object (SC-4);
 * a row that does is a composite-to-single stale window whose series belongs to
 * another run. Neuter target: drop the DONE gate → RED on the status cases.
 */
describe("WR-R2-03 shouldReadSingleKeyCashSeries — the single-key cash series read gate", () => {
  const CASH = { cumulative_return: 0.42 };

  it("DONE + no raw cash_settlement object → true", () => {
    for (const m of [null, undefined, {}, { mark_to_market: CASH }]) {
      expect(shouldReadSingleKeyCashSeries(m, "complete")).toBe(true);
      expect(shouldReadSingleKeyCashSeries(m, "complete_with_warnings")).toBe(true);
    }
  });

  it("not terminal-success → false (a stale row after ANY failure arm is never read)", () => {
    for (const s of ["failed", "computing", "pending", null, undefined, 0, "", "complete_x"]) {
      expect(shouldReadSingleKeyCashSeries(null, s)).toBe(false);
    }
  });

  it("a raw cash_settlement object → false (not a single-key row's series)", () => {
    expect(shouldReadSingleKeyCashSeries({ cash_settlement: CASH }, "complete")).toBe(false);
  });

  it("the family is disjoint: no row passes both the composite and the single-key gate", () => {
    const rows = [null, {}, { cash_settlement: CASH }, { cash_settlement: null }];
    for (const m of rows) {
      expect(shouldReadCashSettlementSeries(m, "complete") && shouldReadSingleKeyCashSeries(m, "complete")).toBe(false);
    }
  });
});

/**
 * Phase 133 (SMTM-01) — parseSmoothedSeriesPayload: the smoothed sibling of
 * parseMtmSeriesPayload. Same rows/gap_spans coercion, PLUS a defensive
 * basis-literal guard (a wrong-basis payload — e.g. a mark_to_market row stored
 * under the smoothed kind — must never render mislabeled) AND tolerance of the
 * OPTIONAL `nan_dates` payload key (basis_series.py:360-361).
 */
describe("SMTM-01 parseSmoothedSeriesPayload — smoothed-basis coercion + nan_dates tolerance", () => {
  const VALID = {
    schema: 1,
    basis: "smoothed_mtm",
    rows: [
      { date: "2025-08-01", return: 0.02 },
      { date: "2025-08-02", return: -0.01 },
      { date: "2025-08-05", return: 0.03 },
    ],
    gap_spans: [{ start: "2025-08-03", end: "2025-08-04" }],
    conventions: { periods_per_year: 365, cumulative_method: "geometric", day_basis: "calendar" },
  };

  it("valid smoothed payload → maps `return`→`value`, ascending rows + gapSpans", () => {
    const out = parseSmoothedSeriesPayload(VALID);
    expect(out).not.toBeNull();
    expect(out!.dailyReturns).toEqual([
      { date: "2025-08-01", value: 0.02 },
      { date: "2025-08-02", value: -0.01 },
      { date: "2025-08-05", value: 0.03 },
    ]);
    expect(out!.gapSpans).toEqual([{ start: "2025-08-03", end: "2025-08-04" }]);
  });

  it("TOLERATES the optional nan_dates key (Phase-105 composite-only) — parses fine", () => {
    const withNan = { ...VALID, nan_dates: ["2025-08-04"] };
    const out = parseSmoothedSeriesPayload(withNan);
    expect(out).not.toBeNull();
    expect(out!.dailyReturns.length).toBe(3);
  });

  it("IN-01 pin: an ABSENT basis key is TOLERATED (mirrors parseMtmSeriesPayload, which performs no basis check — an omitted optional field must never false-reject an otherwise-valid smoothed payload)", () => {
    // Decision (Phase-133 review fix, orchestrator-directed): the guard rejects
    // ONLY a present-but-wrong basis literal (the mislabel T-131-08 defends
    // against); absence falls through to the shared coercion. Flipping this to a
    // strict `basis === "smoothed_mtm"` requirement reddens this pin.
    const { basis: _omitted, ...noBasis } = VALID;
    const out = parseSmoothedSeriesPayload(noBasis);
    expect(out).not.toBeNull();
    expect(out!.dailyReturns.length).toBe(3);
    expect(out!.gapSpans).toEqual([{ start: "2025-08-03", end: "2025-08-04" }]);
  });

  it("WRONG basis literal (mark_to_market row under the smoothed kind) → null + warn (never a mislabeled series)", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      expect(parseSmoothedSeriesPayload({ ...VALID, basis: "mark_to_market" })).toBeNull();
      expect(parseSmoothedSeriesPayload({ ...VALID, basis: "cash_settlement" })).toBeNull();
      expect(parseSmoothedSeriesPayload({ ...VALID, basis: 42 })).toBeNull();
      expect(warn).toHaveBeenCalled();
      expect(warn.mock.calls[0]![0]).toContain("parseSmoothedSeriesPayload");
    } finally {
      warn.mockRestore();
    }
  });

  it("shares the MTM parser's guards: non-object → null, <2 valid rows → null", () => {
    for (const raw of [null, undefined, 42, "x", true, [VALID]]) {
      expect(parseSmoothedSeriesPayload(raw as unknown)).toBeNull();
    }
    expect(parseSmoothedSeriesPayload({ ...VALID, rows: [{ date: "2025-08-01", return: 0.02 }] })).toBeNull();
  });
});

/**
 * Phase 133 (SMTM-01) — readSmoothedSeries: service-role read of the
 * `smoothed_mtm_daily_returns` row, degrade-never-throw (sibling of readMtmSeries).
 */
describe("SMTM-01 readSmoothedSeries — service-role direct read + degrade", () => {
  const VALID_PAYLOAD = {
    schema: 1,
    basis: "smoothed_mtm",
    rows: [
      { date: "2025-08-01", return: 0.02 },
      { date: "2025-08-02", return: -0.01 },
    ],
    gap_spans: [],
    conventions: { periods_per_year: 365, cumulative_method: "geometric", day_basis: "calendar" },
  };

  function mockSeriesAdmin(
    result: { data: { payload: unknown } | null; error: { message?: string; code?: string } | null },
  ): { admin: SupabaseClient; kind: () => string | undefined } {
    let seenKind: string | undefined;
    const chain = {
      select: () => chain,
      eq: (col: string, val: string) => {
        if (col === "kind") seenKind = val;
        return chain;
      },
      maybeSingle: () => Promise.resolve(result),
    };
    return { admin: { from: () => chain } as unknown as SupabaseClient, kind: () => seenKind };
  }

  it("valid row → ParsedMtmSeries; queries the smoothed_mtm_daily_returns kind", async () => {
    const { admin, kind } = mockSeriesAdmin({ data: { payload: VALID_PAYLOAD }, error: null });
    const out = await readSmoothedSeries(admin, "s1");
    expect(out!.dailyReturns).toEqual([
      { date: "2025-08-01", value: 0.02 },
      { date: "2025-08-02", value: -0.01 },
    ]);
    expect(kind()).toBe("smoothed_mtm_daily_returns");
  });

  // 169 review round 1, WR-05 / SFH M-3: the smoothed sibling of the MTM case.
  it("read error → throws CompositeSeriesReadError naming the smoothed series", async () => {
    const { admin } = mockSeriesAdmin({ data: null, error: { message: "boom" } });
    const err = await readSmoothedSeries(admin, "s1").then(
      () => null,
      (e: unknown) => e,
    );
    expect(err, "the outage was degraded to 'no series'").toBeInstanceOf(CompositeSeriesReadError);
    expect((err as CompositeSeriesReadError).read).toBe("smoothed_mtm_daily_returns");
    expect((err as CompositeSeriesReadError).code).toBe("none");
  });

  it("wrong-basis row (mark_to_market payload) → null (defensive, no mislabel)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { admin } = mockSeriesAdmin({
      data: { payload: { ...VALID_PAYLOAD, basis: "mark_to_market" } },
      error: null,
    });
    expect(await readSmoothedSeries(admin, "s1")).toBeNull();
    warn.mockRestore();
  });
});

/**
 * Phase 133 (SMTM-01) — shouldReadSingleKeySmoothedSeries: the cheap DONE +
 * smoothed_mtm-object read gate (sibling of shouldReadSingleKeyMtmSeries).
 */
describe("SMTM-01 shouldReadSingleKeySmoothedSeries — cheap shared read gate", () => {
  const SM = { cumulative_return: 0.9, volatility: 0.25, max_drawdown: -0.18, cagr: 0.7, sharpe: 2.2, sortino: 2.9, calmar: 0.9 };

  it("DONE + smoothed_mtm object → true", () => {
    expect(shouldReadSingleKeySmoothedSeries({ smoothed_mtm: SM }, "complete")).toBe(true);
    expect(shouldReadSingleKeySmoothedSeries({ smoothed_mtm: SM }, "complete_with_warnings")).toBe(true);
  });

  it("not DONE → false", () => {
    for (const s of ["computing", "failed", undefined, null, "complete_x"]) {
      expect(shouldReadSingleKeySmoothedSeries({ smoothed_mtm: SM }, s)).toBe(false);
    }
  });

  it("no smoothed_mtm object → false (hot non-options path stays roundtrip-free)", () => {
    expect(shouldReadSingleKeySmoothedSeries({}, "complete")).toBe(false);
    expect(shouldReadSingleKeySmoothedSeries({ mark_to_market: SM }, "complete")).toBe(false);
    expect(shouldReadSingleKeySmoothedSeries({ smoothed_mtm: null }, "complete")).toBe(false);
    expect(shouldReadSingleKeySmoothedSeries({ smoothed_mtm: [SM] }, "complete")).toBe(false);
    expect(shouldReadSingleKeySmoothedSeries(null, "complete")).toBe(false);
    expect(shouldReadSingleKeySmoothedSeries("garbage", "complete")).toBe(false);
  });
});

/**
 * Phase 133 (SMTM-01) — singleKeyBasisOpts smoothed threading + the MEDIUM-2
 * extended-early-return edge. The smoothed sibling of the MTM-04 4th-arg threading,
 * plus the plan-check MEDIUM-2 hardening: a {smoothed_mtm}-only by-basis row (MTM
 * degraded reason-lessly) must survive the :364 early return, not be silently dropped.
 */
describe("SMTM-01 singleKeyBasisOpts — smoothed gate + series threading + extended early return", () => {
  const MTM_FULL = { cumulative_return: 0.9, volatility: 0.25, max_drawdown: -0.18, cagr: 0.7, sharpe: 2.2, sortino: 2.9, calmar: 0.9 };
  const SM_FULL = { cumulative_return: 0.6, volatility: 0.18, max_drawdown: -0.11, cagr: 0.5, sharpe: 1.9, sortino: 2.4, calmar: 0.7 };
  const SMOOTHED_SERIES: ParsedMtmSeries = {
    dailyReturns: [
      { date: "2025-08-01", value: 0.01 },
      { date: "2025-08-02", value: -0.02 },
      { date: "2025-08-05", value: 0.015 },
    ],
    gapSpans: [{ start: "2025-08-03", end: "2025-08-04" }],
  };

  it("smoothed present (DONE + headline) → smoothedGate available + smoothed_mtm metrics threaded", () => {
    const out = singleKeyBasisOpts({}, { mark_to_market: MTM_FULL, smoothed_mtm: SM_FULL }, "complete");
    expect(out.smoothedGate).toEqual({ available: true, reason: undefined });
    expect(out.metricsByBasis).toEqual({ mark_to_market: MTM_FULL, smoothed_mtm: SM_FULL });
  });

  it("smoothed available + parsed series → threads buildOpts.smoothedSeries (5th arg)", () => {
    const out = singleKeyBasisOpts(
      {},
      { mark_to_market: MTM_FULL, smoothed_mtm: SM_FULL },
      "complete",
      null,
      SMOOTHED_SERIES,
    );
    expect(out.smoothedGate?.available).toBe(true);
    expect(out.smoothedSeries).toBe(SMOOTHED_SERIES);
  });

  it("smoothed absent → smoothedGate disabled with a mapped reason (never a bare invention)", () => {
    const out = singleKeyBasisOpts(
      { mtm_gated_reason: "unsmoothed_options_book" },
      { mark_to_market: MTM_FULL },
      "complete",
    );
    expect(out.smoothedGate?.available).toBe(false);
    expect(out.smoothedGate?.reason).toBe("smoothed_basis_unavailable");
    // No smoothed_mtm scalar object threaded when unavailable.
    expect(out.metricsByBasis && "smoothed_mtm" in out.metricsByBasis).toBe(false);
  });

  it("structural gate: a non-DONE status NEVER threads the smoothed series even when supplied", () => {
    for (const status of ["failed", "computing", undefined, null]) {
      const out = singleKeyBasisOpts(
        {},
        { smoothed_mtm: SM_FULL },
        status,
        null,
        SMOOTHED_SERIES,
      );
      expect(out.smoothedGate?.available).toBe(false);
      expect(out.smoothedSeries).toBeUndefined();
    }
  });

  it("MEDIUM-2 WIRING-GUARD: a {smoothed_mtm}-only row (NO mark_to_market, NO mtm_gated_reason) survives the extended early return", () => {
    // The un-extended :364 predicate (`mtm === undefined && reason === undefined → {}`)
    // would DROP this fixture: no gate, no toggle, no series. Extending it to also check
    // the smoothed key keeps the smoothed story alive. Neuter check: restore the
    // two-term early return → this reddens (out becomes {}).
    const out = singleKeyBasisOpts(
      {},
      { smoothed_mtm: SM_FULL },
      "complete",
      null,
      SMOOTHED_SERIES,
    );
    expect(out).not.toEqual({});
    expect(out.smoothedGate).toEqual({ available: true, reason: undefined });
    expect(out.metricsByBasis).toEqual({ smoothed_mtm: SM_FULL });
    // MTM story is honestly empty here (degraded reason-lessly), not fabricated.
    expect(out.mtmGate).toEqual({ available: false, reason: undefined });
    expect(out.metricsByBasis && "mark_to_market" in out.metricsByBasis).toBe(false);
    // The read's result reaches the opts (the call-site contract, not just the helper).
    expect(out.smoothedSeries).toBe(SMOOTHED_SERIES);
  });

  it("SILENT-1 preserved: no mtm key, no reason, NO smoothed key → EMPTY (byte-identical non-options path)", () => {
    expect(singleKeyBasisOpts({}, {}, "complete")).toEqual({});
    expect(singleKeyBasisOpts({}, {}, "complete", null, SMOOTHED_SERIES)).toEqual({});
    expect(singleKeyBasisOpts(null, null, "complete", null, SMOOTHED_SERIES)).toEqual({});
  });

  it("degenerate smoothed object (fails hasBasisHeadline) with DONE → unavailable, no smoothed object", () => {
    const DEGEN = { ...SM_FULL, cumulative_return: null as unknown as number };
    const out = singleKeyBasisOpts({}, { mark_to_market: MTM_FULL, smoothed_mtm: DEGEN }, "complete", null, SMOOTHED_SERIES);
    expect(out.smoothedGate?.available).toBe(false);
    expect(out.metricsByBasis && "smoothed_mtm" in out.metricsByBasis).toBe(false);
    expect(out.smoothedSeries).toBeUndefined();
  });
});

/**
 * Phase 133 review WR-01/WR-02 — readSingleKeyBasisOpts: the ONE single-key
 * basis ASSEMBLY both render surfaces call. These pin the assembly contract
 * (predicates gate the reads; the reads' results reach the opts; the admin
 * thunk stays uncalled on the hot path and is memoized to one handle). The
 * per-PAGE call-site wiring is guarded separately by the two
 * `page.smoothed-wiring.test.tsx` files — a page bypassing this assembly
 * reddens those, not these.
 */
describe("WR-01 readSingleKeyBasisOpts — shared single-key assembly (predicates → reads → opts)", () => {
  const MTM_FULL = { cumulative_return: 0.9, volatility: 0.25, max_drawdown: -0.18, cagr: 0.7, sharpe: 2.2, sortino: 2.9, calmar: 0.9 };
  const SM_FULL = { cumulative_return: 0.6, volatility: 0.18, max_drawdown: -0.11, cagr: 0.5, sharpe: 1.9, sortino: 2.4, calmar: 0.7 };
  const seriesPayload = (basis: "mark_to_market" | "smoothed_mtm") => ({
    schema: 1,
    basis,
    rows: [
      { date: "2025-08-01", return: 0.01 },
      { date: "2025-08-02", return: -0.02 },
    ],
    gap_spans: [],
    conventions: { periods_per_year: 365, cumulative_method: "geometric", day_basis: "calendar" },
  });

  /** Admin stub serving strategy_analytics_series by kind; records reads. */
  function mockAdminByKind(byKind: Record<string, unknown>): {
    admin: SupabaseClient;
    reads: string[];
  } {
    const reads: string[] = [];
    const from = (table: string) => {
      let seenKind: string | undefined;
      const chain = {
        select: () => chain,
        eq: (col: string, val: string) => {
          if (col === "kind") seenKind = val;
          return chain;
        },
        maybeSingle: () => {
          if (table === "strategy_analytics_series" && seenKind) reads.push(seenKind);
          return Promise.resolve(
            table === "strategy_analytics_series" && seenKind && seenKind in byKind
              ? { data: { payload: byKind[seenKind] }, error: null }
              : { data: null, error: null },
          );
        },
      };
      return chain;
    };
    return { admin: { from } as unknown as SupabaseClient, reads };
  }

  it("both bases persisted + DONE → both series read and BOTH reach the opts (mtmSeries + smoothedSeries)", async () => {
    const { admin, reads } = mockAdminByKind({
      mtm_daily_returns: seriesPayload("mark_to_market"),
      smoothed_mtm_daily_returns: seriesPayload("smoothed_mtm"),
    });
    const getAdmin = vi.fn(() => admin);
    const out = await readSingleKeyBasisOpts(
      getAdmin,
      "s-1",
      {},
      { mark_to_market: MTM_FULL, smoothed_mtm: SM_FULL },
      "complete",
    );
    expect(out.mtmGate).toEqual({ available: true, reason: undefined });
    expect(out.smoothedGate).toEqual({ available: true, reason: undefined });
    expect(out.metricsByBasis).toEqual({ mark_to_market: MTM_FULL, smoothed_mtm: SM_FULL });
    expect(out.mtmSeries?.dailyReturns.length).toBe(2);
    expect(out.smoothedSeries?.dailyReturns.length).toBe(2);
    expect(reads.sort()).toEqual(["mtm_daily_returns", "smoothed_mtm_daily_returns"]);
    // Thunk memoization: ONE service-role handle regardless of read count.
    expect(getAdmin).toHaveBeenCalledTimes(1);
  });

  it("hot non-options path: no by-basis keys → getAdmin NEVER called, {} returned (byte-identical)", async () => {
    const getAdmin = vi.fn(() => {
      throw new Error("admin handle must not be constructed on the hot path");
    });
    expect(await readSingleKeyBasisOpts(getAdmin, "s-1", {}, {}, "complete")).toEqual({});
    expect(await readSingleKeyBasisOpts(getAdmin, "s-1", null, null, "complete")).toEqual({});
    expect(getAdmin).not.toHaveBeenCalled();
  });

  it("not DONE → getAdmin never called; F-4 structural (no by-basis object threaded)", async () => {
    const getAdmin = vi.fn(() => {
      throw new Error("admin handle must not be constructed when not DONE");
    });
    for (const status of ["computing", "failed", null, undefined]) {
      const out = await readSingleKeyBasisOpts(
        getAdmin,
        "s-1",
        {},
        { mark_to_market: MTM_FULL, smoothed_mtm: SM_FULL },
        status,
      );
      expect(out.mtmGate?.available).toBe(false);
      expect(out.smoothedGate?.available).toBe(false);
      expect(out.mtmSeries).toBeUndefined();
      expect(out.smoothedSeries).toBeUndefined();
    }
    expect(getAdmin).not.toHaveBeenCalled();
  });

  it("mtm-only row → only the mtm roundtrip fires; smoothed story honestly disabled", async () => {
    const { admin, reads } = mockAdminByKind({
      mtm_daily_returns: seriesPayload("mark_to_market"),
    });
    const out = await readSingleKeyBasisOpts(
      () => admin,
      "s-1",
      { mtm_gated_reason: undefined },
      { mark_to_market: MTM_FULL },
      "complete",
    );
    expect(out.mtmSeries?.dailyReturns.length).toBe(2);
    expect(out.smoothedSeries).toBeUndefined();
    expect(out.smoothedGate).toEqual({ available: false, reason: "smoothed_basis_unavailable" });
    expect(reads).toEqual(["mtm_daily_returns"]);
  });
});

/**
 * Phase 133 (SMTM-01) — readCompositeFactsheet threads the persisted smoothed series
 * and gate. Smoothed key present → smoothedGate available + series read; absent →
 * disabled gate + no roundtrip. mark_to_market handling byte-identical.
 */
describe("SMTM-01 readCompositeFactsheet — smoothed gate + gated series read", () => {
  const SM_HEADLINE = { cumulative_return: 0.6, volatility: 0.18, max_drawdown: -0.11, cagr: 0.5, sharpe: 1.9, sortino: 2.4, calmar: 0.7 };
  const SM_PAYLOAD = {
    schema: 1,
    basis: "smoothed_mtm",
    rows: [
      { date: "2025-08-01", return: 0.01 },
      { date: "2025-08-02", return: -0.02 },
      { date: "2025-08-05", return: 0.015 },
    ],
    gap_spans: [{ start: "2025-08-03", end: "2025-08-04" }],
    conventions: { periods_per_year: 365, cumulative_method: "geometric", day_basis: "calendar" },
  };

  function mockAdminSmoothed(opts: {
    smoothedPayload?: unknown;
    smoothedError?: { message?: string } | null;
  }): { admin: SupabaseClient; smoothedReads: () => number } {
    let smoothedReadCount = 0;
    const from = (table: string) => {
      if (table === "strategy_analytics_series") {
        let seenKind: string | undefined;
        const chain = {
          select: () => chain,
          eq: (col: string, val: string) => {
            if (col === "kind") seenKind = val;
            return chain;
          },
          maybeSingle: () => {
            if (seenKind === "smoothed_mtm_daily_returns") smoothedReadCount++;
            return Promise.resolve({
              data: seenKind === "smoothed_mtm_daily_returns" ? { payload: opts.smoothedPayload } : null,
              error: seenKind === "smoothed_mtm_daily_returns" ? (opts.smoothedError ?? null) : null,
            });
          },
        };
        return chain;
      }
      return csvChain(SPARSE_ROWS);
    };
    return { admin: { from } as unknown as SupabaseClient, smoothedReads: () => smoothedReadCount };
  }

  it("smoothed present → smoothedGate available + threads smoothedSeries", async () => {
    const { admin, smoothedReads } = mockAdminSmoothed({ smoothedPayload: SM_PAYLOAD });
    const out = await readCompositeFactsheet(admin, {
      strategyId: "s1",
      dqf: DQF,
      metricsJsonByBasis: { cash_settlement: FULL_CASH, smoothed_mtm: SM_HEADLINE },
      returnsDenominatorConfig: null,
    });
    expect(out!.buildOpts.smoothedGate).toEqual({ available: true, reason: undefined });
    expect(out!.buildOpts.smoothedSeries).toEqual({
      dailyReturns: [
        { date: "2025-08-01", value: 0.01 },
        { date: "2025-08-02", value: -0.02 },
        { date: "2025-08-05", value: 0.015 },
      ],
      gapSpans: [{ start: "2025-08-03", end: "2025-08-04" }],
    });
    expect(smoothedReads()).toBe(1);
  });

  it("smoothed absent → smoothedGate disabled + NO smoothed roundtrip (mark_to_market untouched)", async () => {
    const { admin, smoothedReads } = mockAdminSmoothed({ smoothedPayload: SM_PAYLOAD });
    const out = await readCompositeFactsheet(admin, {
      strategyId: "s1",
      dqf: DQF,
      metricsJsonByBasis: { cash_settlement: FULL_CASH }, // no smoothed_mtm
      returnsDenominatorConfig: null,
    });
    expect(out!.buildOpts.smoothedGate).toEqual({ available: false, reason: "smoothed_basis_unavailable" });
    expect("smoothedSeries" in out!.buildOpts).toBe(false);
    expect(smoothedReads()).toBe(0);
  });

  it("the FLAGSHIP options case: MTM gated OFF (unsmoothed_options_book) but smoothed OPEN", async () => {
    const { admin } = mockAdminSmoothed({ smoothedPayload: SM_PAYLOAD });
    const out = await readCompositeFactsheet(admin, {
      strategyId: "s1",
      dqf: { ...DQF, mtm_gated_reason: "unsmoothed_options_book" },
      metricsJsonByBasis: { cash_settlement: FULL_CASH, smoothed_mtm: SM_HEADLINE }, // no mark_to_market
      returnsDenominatorConfig: null,
    });
    // MTM stays honestly gated with its existing reason.
    expect(out!.buildOpts.mtmGate).toEqual({ available: false, reason: "unsmoothed_options_book" });
    // Smoothed opens what MTM keeps closed.
    expect(out!.buildOpts.smoothedGate).toEqual({ available: true, reason: undefined });
  });
});

/**
 * Phase 169 (SC4, D-10, D-25) — readSingleKeyBasisOpts supplies the single-key
 * CASH headline from the row's persisted top-level scalars, so the factsheet
 * reads the same CAGR and Sharpe as discovery, recommendations and
 * my-strategies. The key is BUILT from the persisted scalars (never threaded
 * from the raw jsonb), only for a rankable row, and it adds no read.
 */
describe("169 D-10 readSingleKeyBasisOpts — the persisted single-key cash headline", () => {
  const PERSISTED = {
    cumulative_return: 0.42,
    volatility: 0.31,
    max_drawdown: -0.22,
    cagr: 0.12,
    sharpe: 1.5,
    sortino: 2.0,
    calmar: 0.55,
  };
  const MTM = { cumulative_return: 0.9, volatility: 0.25, max_drawdown: -0.18, cagr: 0.7, sharpe: 2.2, sortino: 2.9, calmar: 0.9 };
  /** The analytics row as a caller holds it: the seven scalars beside the other columns. */
  const row = (over: Record<string, unknown> = {}) => ({
    ...PERSISTED,
    computation_status: "complete",
    metrics_json_by_basis: null,
    data_quality_flags: {},
    ...over,
  });
  const noAdmin = () =>
    vi.fn((): SupabaseClient => {
      throw new Error("the persisted-headline arm must not construct the service-role handle");
    });

  it("rankable non-options row → cash_settlement built from the seven persisted scalars, no gates, no read", async () => {
    const getAdmin = noAdmin();
    const out = await readSingleKeyBasisOpts(getAdmin, "s-1", {}, null, "complete", row());
    expect(out).toEqual({ metricsByBasis: { cash_settlement: PERSISTED } });
    // No mtmGate / smoothedGate: FactsheetView's basis toggle stays hidden.
    expect("mtmGate" in out).toBe(false);
    expect(getAdmin).not.toHaveBeenCalled();
  });

  it.each(["failed", "computing", null, undefined])(
    "not rankable (%s) → exactly today's result: no cash key (a failed run's leftovers never overlay)",
    async (status) => {
      const out = await readSingleKeyBasisOpts(noAdmin(), "s-1", {}, null, status, row({ computation_status: status }));
      expect(out).toEqual({});
    },
  );

  it("a persisted null scalar is kept as null in the built object (strict overlay → em-dash)", async () => {
    const out = await readSingleKeyBasisOpts(noAdmin(), "s-1", {}, null, "complete", row({ sharpe: null }));
    expect(out.metricsByBasis?.cash_settlement).toEqual({ ...PERSISTED, sharpe: null });
  });

  it("scalar columns not projected (structurally absent) → no cash key, today's result", async () => {
    const out = await readSingleKeyBasisOpts(noAdmin(), "s-1", {}, null, "complete", {
      computation_status: "complete",
    });
    expect(out).toEqual({});
  });

  it("no persisted row passed (the 5-argument call) → exactly today's result", async () => {
    expect(await readSingleKeyBasisOpts(noAdmin(), "s-1", {}, null, "complete")).toEqual({});
  });

  it("options strategy: the mtm arm is unchanged and the cash headline is added beside it", async () => {
    const getAdmin = vi.fn(
      () =>
        ({
          from: () => {
            const chain = {
              select: () => chain,
              eq: () => chain,
              maybeSingle: () => Promise.resolve({ data: null, error: null }),
            };
            return chain;
          },
        }) as unknown as SupabaseClient,
    );
    const today = await readSingleKeyBasisOpts(getAdmin, "s-1", {}, { mark_to_market: MTM }, "complete");
    const out = await readSingleKeyBasisOpts(
      getAdmin,
      "s-1",
      {},
      { mark_to_market: MTM },
      "complete",
      row({ metrics_json_by_basis: { mark_to_market: MTM } }),
    );
    expect(out).toEqual({
      ...today,
      metricsByBasis: { ...today.metricsByBasis, cash_settlement: PERSISTED },
    });
    expect(out.mtmGate).toEqual({ available: true, reason: undefined });
  });

  it("a lingering raw cash_settlement key → exactly today's result (the raw object is never threaded, SC-4)", async () => {
    const raw = { cash_settlement: { ...PERSISTED, sharpe: 9.9 } };
    const out = await readSingleKeyBasisOpts(noAdmin(), "s-1", {}, raw, "complete", row({ metrics_json_by_basis: raw }));
    expect(out).toEqual(await readSingleKeyBasisOpts(noAdmin(), "s-1", {}, raw, "complete"));
    expect(out.metricsByBasis?.cash_settlement).toBeUndefined();
  });
});

/**
 * Review round 1, SFH H-1. On a single-key row with an INTERIOR chain break
 * (`data_quality_flags.twr_chain_broken`), Python's stored
 * `cumulative_return` and CAGR compound only the stretch AFTER the last break
 * (`nav_twr._last_interior_break_suffix`, `metrics._cagr_index`), while the
 * chart, the windows and Years Observed cover the whole series. D-25 keeps the
 * stored value (the lists show it), so the page must SAY which span the
 * headline covers. These pin the data half: the flag reaches the payload, and
 * the start of the covered span is read from the stored cash series row, never
 * guessed.
 *
 * WHY the stored row names it. On the broker path the runner reindexes the
 * series to a dense daily calendar, so a refused (guard) day becomes NaN; the
 * persisted `cash_settlement` series row (`basis_series.derive_basis_series`)
 * drops NaN from `rows` and records every absent in-span day in `gap_spans`,
 * and echoes `conventions.densify = "broker_nan"`. Under that echo an absent
 * day can only be a refused day, so the covered span starts at the first row
 * after the LAST gap span: exactly the suffix `_last_interior_break_suffix`
 * compounds. Under any other echo (a user CSV is "sparse": weekends are absent
 * too) the rows cannot name it, and the answer is null.
 */
describe("169 SFH H-1 — the span a chain-broken headline covers, read from the stored series", () => {
  const BROKER_SERIES = {
    schema: 2,
    basis: "cash_settlement",
    rows: [
      { date: "2024-01-01", return: 0.01 },
      { date: "2024-01-02", return: 0.01 },
      { date: "2024-01-04", return: 0.01 },
      { date: "2024-01-05", return: 0.01 },
      { date: "2024-01-09", return: 0.01 },
      { date: "2024-01-10", return: 0.01 },
    ],
    gap_spans: [
      { start: "2024-01-03", end: "2024-01-03" },
      { start: "2024-01-06", end: "2024-01-08" },
    ],
    conventions: { periods_per_year: 365, cumulative_method: "geometric", day_basis: "calendar", densify: "broker_nan" },
  };

  it("broker_nan series with interior gaps → the first stored day after the last gap", () => {
    expect(deriveHeadlineCoversFrom(BROKER_SERIES)).toBe("2024-01-09");
  });

  it.each([
    ["a sparse (user CSV) series, where an absent day may be a weekend", { ...BROKER_SERIES, conventions: { ...BROKER_SERIES.conventions, densify: "sparse" } }],
    ["a series with no densify echo (written before Phase 105)", { ...BROKER_SERIES, conventions: { periods_per_year: 365 } }],
    ["a series with no gap", { ...BROKER_SERIES, gap_spans: [] }],
    ["a malformed payload", { rows: "x" }],
    ["no payload", null],
  ])("%s → null (the stored data cannot name the span; never a guess)", (_label, payload) => {
    expect(deriveHeadlineCoversFrom(payload)).toBeNull();
  });

  it("singleKeyDataQuality carries the flag strictly (=== true), and is unchanged without it", () => {
    expect(singleKeyDataQuality({ twr_chain_broken: true }).twrChainBroken).toBe(true);
    expect("twrChainBroken" in singleKeyDataQuality({ twr_chain_broken: "true" })).toBe(false);
    expect(singleKeyDataQuality({})).toEqual({ composite: false, insufficientWindow: false });
  });

  const PERSISTED = {
    cumulative_return: 0.18,
    volatility: 0.3,
    max_drawdown: -0.2,
    cagr: 0.1,
    sharpe: 1.1,
    sortino: 1.6,
    calmar: 0.5,
  };
  const row = { ...PERSISTED, computation_status: "complete", metrics_json_by_basis: null };

  function seriesAdmin(answer: { data: unknown; error: { message: string; code?: string } | null }) {
    const kinds: string[] = [];
    const getAdmin = vi.fn(
      () =>
        ({
          from: () => {
            const chain = {
              select: () => chain,
              eq: (column: string, value: string) => {
                if (column === "kind") kinds.push(value);
                return chain;
              },
              maybeSingle: () => Promise.resolve(answer),
            };
            return chain;
          },
        }) as unknown as SupabaseClient,
    );
    return { getAdmin, kinds };
  }

  it("a rankable chain-broken row threads the flag and the covered span's start from the stored cash series", async () => {
    const { getAdmin, kinds } = seriesAdmin({ data: { payload: BROKER_SERIES }, error: null });
    const out = await readSingleKeyBasisOpts(getAdmin, "s-1", { twr_chain_broken: true }, null, "complete", row);
    expect(out.dataQuality).toEqual({
      composite: false,
      insufficientWindow: false,
      twrChainBroken: true,
      headlineCoversFrom: "2024-01-09",
    });
    expect(kinds).toEqual(["cash_settlement"]);
    // D-25 / SC4: the headline stays the stored value the lists show.
    expect(out.metricsByBasis?.cash_settlement).toEqual(PERSISTED);
  });

  it("a chain-broken row whose stored series cannot name the span → headlineCoversFrom null, warned", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const { getAdmin } = seriesAdmin({ data: null, error: null });
      const out = await readSingleKeyBasisOpts(getAdmin, "s-1", { twr_chain_broken: true }, null, "complete", row);
      expect(out.dataQuality?.twrChainBroken).toBe(true);
      expect(out.dataQuality?.headlineCoversFrom).toBeNull();
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("covered span"), expect.objectContaining({ strategyId: "s-1" }));
    } finally {
      warn.mockRestore();
    }
  });

  it("a failed stored-series read is a read error, never a guessed or missing span", async () => {
    const { getAdmin } = seriesAdmin({ data: null, error: { message: "boom", code: "57014" } });
    const err = await readSingleKeyBasisOpts(getAdmin, "s-1", { twr_chain_broken: true }, null, "complete", row).then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(CompositeSeriesReadError);
    expect((err as CompositeSeriesReadError).read).toBe("cash_settlement");
  });

  it("a row without the flag reads nothing and adds no dataQuality (byte-identical)", async () => {
    const getAdmin = vi.fn((): SupabaseClient => {
      throw new Error("a clean row must not construct the service-role handle");
    });
    const out = await readSingleKeyBasisOpts(getAdmin, "s-1", {}, null, "complete", row);
    expect("dataQuality" in out).toBe(false);
    expect(getAdmin).not.toHaveBeenCalled();
  });
});
