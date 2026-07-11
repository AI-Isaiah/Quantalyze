import { describe, it, expect, vi } from "vitest";

// The helper imports `server-only` (a Next.js build guard that throws outside an
// RSC bundle). Stub it so this unit test can import the module — the existing
// pattern in src/lib/audit.test.ts / auth.test.ts / email.test.ts.
vi.mock("server-only", () => ({}));

import type { SupabaseClient } from "@supabase/supabase-js";
import { readCompositeFactsheet } from "./composite-read-path";
import { buildFactsheetPayload, deriveIngestSource } from "./build-payload";

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
    expect(out!.buildOpts.dataQuality).toEqual({ composite: true, insufficientWindow: false });
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
    expect(out!.buildOpts.dataQuality).toEqual({ composite: true, insufficientWindow: true });
  });

  it("HARD-04: malformed dqf.insufficient_window (string 'true') → insufficientWindow false (strict server-truth)", async () => {
    const out = await readCompositeFactsheet(mockAdmin(SPARSE_ROWS), {
      strategyId: "s1",
      dqf: { ...DQF, insufficient_window: "true" as unknown },
      metricsJsonByBasis: { cash_settlement: FULL_CASH },
      returnsDenominatorConfig: null,
    });
    // A non-boolean value must NEVER render the caveat (T-92-05 tampering guard).
    expect(out!.buildOpts.dataQuality).toEqual({ composite: true, insufficientWindow: false });
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
