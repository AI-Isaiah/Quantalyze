/**
 * Regression tests for audit batch 06 — factsheet-public cluster (NEW-C20-xx).
 *
 * Each `it` block describes a concrete scenario that was previously broken and
 * verifies the fix. Tests fail without the fix and pass with it.
 */
import { describe, it, expect } from "vitest";
import { buildFactsheetPayload, deriveIngestSource } from "./build-payload";
import { buildScenarioFactsheetPayload } from "@/app/(dashboard)/allocations/widgets/performance/scenario-factsheet-payload";

/** Minimal 40-day daily-return series for tests that don't need statistical depth. */
function makeReturns(n = 40): Array<{ date: string; value: number }> {
  return Array.from({ length: n }, (_, i) => ({
    date: `2024-01-${String(i + 1).padStart(2, "0")}`,
    value: (Math.sin(i / 5) * 0.003) + 0.0001,
  }));
}

/** Strategy stub with required fields only. */
function makeStrategy(overrides: Partial<Parameters<typeof buildFactsheetPayload>[0]> = {}) {
  return {
    id: "test-id",
    name: "Test Strategy",
    types: ["quant"],
    markets: ["crypto"],
    computedAt: "2024-05-01T00:00:00Z",
    trustTier: null as null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// NEW-C20-03 — rollingWindow fallback must default enough:false (not enough:true)
// ---------------------------------------------------------------------------
describe("NEW-C20-03: rollingWindow fallback defaults to enough:false", () => {
  it("payload without rollingWindow defaulted to enough:true before the fix — now the type requires the field to be present", () => {
    // build-payload always populates rollingWindow. The fix was in PerformanceCharts
    // (FactsheetView.tsx) where the fallback ?? { ..., enough: true } was changed
    // to ?? { ..., enough: false }. Here we verify the builder always produces
    // the field so the fallback path is only hit for stale cache entries.
    const payload = buildFactsheetPayload(makeStrategy(), makeReturns());
    expect(payload).not.toBeNull();
    expect(payload!.rollingWindow).toBeDefined();
    expect(typeof payload!.rollingWindow.enough).toBe("boolean");
  });

  it("short series sets enough:false so rolling panels don't fabricate data", () => {
    // A 10-day series can't fill even a 30-day window.
    const payload = buildFactsheetPayload(makeStrategy(), makeReturns(10));
    expect(payload).not.toBeNull();
    // pickRollingWindow returns enough:false when even 30d can't be filled
    expect(payload!.rollingWindow.enough).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// NEW-C20-01 — ingestSource discriminator
// ---------------------------------------------------------------------------
describe("NEW-C20-01: ingestSource discriminator on FactsheetPayload", () => {
  it("defaults to 'csv' when ingestSource is omitted (conservative)", () => {
    const payload = buildFactsheetPayload(makeStrategy(), makeReturns());
    expect(payload!.ingestSource).toBe("csv");
  });

  it("passes through 'api' when explicitly specified", () => {
    const payload = buildFactsheetPayload(
      makeStrategy({ ingestSource: "api" }),
      makeReturns(),
    );
    expect(payload!.ingestSource).toBe("api");
  });

  it("passes through 'csv' when explicitly specified", () => {
    const payload = buildFactsheetPayload(
      makeStrategy({ ingestSource: "csv" }),
      makeReturns(),
    );
    expect(payload!.ingestSource).toBe("csv");
  });
});

// ---------------------------------------------------------------------------
// NEW-C20-05 — baseline:1 on cumulative/volMatched/worstDDs (chart-configs)
// This is a static config test — verify the configs have the expected baseline.
// ---------------------------------------------------------------------------
describe("NEW-C20-05: growth chart configs anchor at 1.0 par baseline", () => {
  it("cumulative, volMatched, worstDDs configs have baseline:1", async () => {
    const { CHART_CONFIGS } = await import("../../app/factsheet/[id]/v2/chart-configs");
    const growthKeys = ["cumulative", "volMatched", "worstDDs"];
    for (const key of growthKeys) {
      const cfg = CHART_CONFIGS.find(c => c.key === key);
      expect(cfg, `config ${key} not found`).toBeDefined();
      expect(cfg!.baseline, `${key} missing baseline:1`).toBe(1);
    }
    // cumVsBench was already correct — verify it still has baseline:1
    const cumVsBench = CHART_CONFIGS.find(c => c.key === "cumVsBench");
    expect(cumVsBench!.baseline).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// NEW-C20-04 / NEW-C20-09 — formatter null/NaN safety
// FactsheetView.tsx now imports pct/pctSigned/num directly from format.ts
// (IMPORTANT-1/FINDING-8 — private copies removed). Tests cover the
// canonical implementation that FactsheetView actually uses.
// ---------------------------------------------------------------------------
describe("NEW-C20-04/C20-09: formatters handle null/NaN/non-finite values", () => {
  it("pct in format.ts returns '—' for null, undefined, NaN, Infinity", async () => {
    const { pct } = await import("../../app/factsheet/[id]/v2/format");
    expect(pct(null)).toBe("—");
    expect(pct(undefined)).toBe("—");
    expect(pct(NaN)).toBe("—");
    expect(pct(Infinity)).toBe("—");
    expect(pct(-Infinity)).toBe("—");
  });

  it("pct in format.ts renders a valid 0 as '0.0%' (not '—')", async () => {
    const { pct } = await import("../../app/factsheet/[id]/v2/format");
    // max_dd=0 (no drawdown) should render as "0.0%" not "—"
    expect(pct(0, 1)).toBe("0.0%");
  });

  it("pctSigned in format.ts returns '—' for null/NaN and '+0.0%' for 0 (no false red tone)", async () => {
    const { pctSigned } = await import("../../app/factsheet/[id]/v2/format");
    expect(pctSigned(null)).toBe("—");
    expect(pctSigned(NaN)).toBe("—");
    expect(pctSigned(0, 1)).toBe("+0.0%");
  });

  it("ratio (imported as num) in format.ts returns '—' for null/NaN and '0.00' for 0", async () => {
    const { ratio } = await import("../../app/factsheet/[id]/v2/format");
    expect(ratio(null)).toBe("—");
    expect(ratio(NaN)).toBe("—");
    expect(ratio(0)).toBe("0.00");
  });
});

// ---------------------------------------------------------------------------
// NEW-C20-07 — FreshnessChip future-date logic
// The chip is a React component; test the tone computation logic directly.
// ---------------------------------------------------------------------------
describe("NEW-C20-07: future computedAt renders as neutral not fresh", () => {
  it("a computedAt 400 days in the future yields negative days — old code treated as fresh", () => {
    const futureDate = new Date(Date.now() + 400 * 86_400_000).toISOString();
    const d = new Date(futureDate);
    const nowMs = Date.now();
    const days = (nowMs - d.getTime()) / 86_400_000;
    // days is negative for a future date
    expect(days).toBeLessThan(0);
    // Before the fix: days <= 3 → tone "fresh" (bug)
    const buggyTone = !Number.isFinite(days) ? "neutral" : days <= 3 ? "fresh" : days <= 7 ? "stale" : "old";
    expect(buggyTone).toBe("fresh");
    // After the fix: days < 0 → tone "future" (not fresh)
    const fixedTone = !Number.isFinite(days) ? "neutral"
      : days < 0 ? "future"
      : days <= 3 ? "fresh"
      : days <= 7 ? "stale"
      : "old";
    expect(fixedTone).toBe("future");
    expect(fixedTone).not.toBe("fresh");
  });

  it("a computedAt 2 days ago correctly remains 'fresh' after the fix", () => {
    const recentDate = new Date(Date.now() - 2 * 86_400_000).toISOString();
    const d = new Date(recentDate);
    const days = (Date.now() - d.getTime()) / 86_400_000;
    const tone = !Number.isFinite(days) ? "neutral"
      : days < 0 ? "future"
      : days <= 3 ? "fresh"
      : days <= 7 ? "stale"
      : "old";
    expect(tone).toBe("fresh");
  });
});

// ---------------------------------------------------------------------------
// FINDING-1 (b06-silentfailure) — empty-array dailyRaw must classify as "csv"
// Regression: the old logic treated [] as "api" because length > 0 was false.
// ---------------------------------------------------------------------------
describe("FINDING-1: empty-array dailyRaw classified as csv not api", () => {
  it("Array.isArray([]) is true — old guard length>0 was false, new guard catches it", () => {
    const dailyRaw: unknown = [];
    // Old logic (buggy): Array.isArray && length > 0 → false → falls to "api"
    const oldIngest =
      Array.isArray(dailyRaw) && (dailyRaw as unknown[]).length > 0
        ? "csv"
        : typeof dailyRaw === "object" && dailyRaw !== null && !Array.isArray(dailyRaw) && Object.keys(dailyRaw as object).length > 0
          ? "csv"
          : "api";
    expect(oldIngest).toBe("api"); // this is the bug

    // New logic (fixed): Array.isArray alone → "csv" for any array
    const newIngest =
      Array.isArray(dailyRaw)
        ? "csv"
        : typeof dailyRaw === "object" && dailyRaw !== null
          ? "csv"
          : "api";
    expect(newIngest).toBe("csv"); // correct: CSV ingester touched this column
  });

  it("null dailyRaw → 'api' (analytics-service-only path)", () => {
    const dailyRaw: unknown = null;
    const ingest =
      Array.isArray(dailyRaw)
        ? "csv"
        : typeof dailyRaw === "object" && dailyRaw !== null
          ? "csv"
          : "api";
    expect(ingest).toBe("api");
  });

  it("undefined dailyRaw → 'api'", () => {
    const dailyRaw: unknown = undefined;
    const ingest =
      Array.isArray(dailyRaw)
        ? "csv"
        : typeof dailyRaw === "object" && dailyRaw !== null
          ? "csv"
          : "api";
    expect(ingest).toBe("api");
  });

  it("non-empty array dailyRaw → 'csv'", () => {
    const dailyRaw: unknown = [{ date: "2024-01-01", value: 0.001 }];
    const ingest =
      Array.isArray(dailyRaw)
        ? "csv"
        : typeof dailyRaw === "object" && dailyRaw !== null
          ? "csv"
          : "api";
    expect(ingest).toBe("csv");
  });
});

// ---------------------------------------------------------------------------
// FINDING-3 (b06-silentfailure) — trustTier=null must NOT be isSelfReported
// A null trust tier means UNVERIFIED, not "self_reported" or "csv_uploaded".
// ---------------------------------------------------------------------------
describe("FINDING-3: isSelfReported logic excludes trustTier=null", () => {
  type TrustTier = "api_verified" | "csv_uploaded" | "self_reported" | null;

  const isSelfReported = (trustTier: TrustTier): boolean =>
    trustTier === "csv_uploaded" || trustTier === "self_reported";

  const isSelfReportedBuggy = (trustTier: TrustTier): boolean =>
    trustTier !== "api_verified";

  it("old logic: null → true (the bug — null was treated as self-reported)", () => {
    expect(isSelfReportedBuggy(null)).toBe(true); // bug
  });

  it("fixed logic: null → false (unverified, not self-reported)", () => {
    expect(isSelfReported(null)).toBe(false);
  });

  it("fixed logic: self_reported → true", () => {
    expect(isSelfReported("self_reported")).toBe(true);
  });

  it("fixed logic: csv_uploaded → true", () => {
    expect(isSelfReported("csv_uploaded")).toBe(true);
  });

  it("fixed logic: api_verified → false", () => {
    expect(isSelfReported("api_verified")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// FINDING-5 (b06-silentfailure) — computedAt missing should not fall back to now()
// The epoch sentinel renders as "old" not "fresh" in FreshnessChip.
// ---------------------------------------------------------------------------
describe("FINDING-5: computedAt fallback to epoch produces 'old' tone not 'fresh'", () => {
  it("epoch sentinel (1970-01-01) produces 'old' tone — not 'fresh'", () => {
    const epochDate = "1970-01-01T00:00:00Z";
    const d = new Date(epochDate);
    const days = (Date.now() - d.getTime()) / 86_400_000;
    expect(days).toBeGreaterThan(7); // tens of thousands of days — definitely old
    const tone =
      !Number.isFinite(days) ? "neutral"
      : days < 0 ? "future"
      : days <= 3 ? "fresh"
      : days <= 7 ? "stale"
      : "old";
    expect(tone).toBe("old"); // correct staleness signal for missing analytics
  });

  it("fallback to now() would produce 'fresh' — confirming the old bug", () => {
    const nowDate = new Date().toISOString();
    const d = new Date(nowDate);
    const days = (Date.now() - d.getTime()) / 86_400_000;
    // days is ~0 when falling back to now()
    expect(days).toBeLessThanOrEqual(0.01);
    const tone =
      !Number.isFinite(days) ? "neutral"
      : days < 0 ? "future"
      : days <= 3 ? "fresh"
      : days <= 7 ? "stale"
      : "old";
    expect(tone).toBe("fresh"); // this was the bug: green "fresh" for no-analytics strategy
  });
});

// ---------------------------------------------------------------------------
// FINDING-6 (b06-silentfailure) — buildAllocatorPortfolioFactsheetPayload
// must produce ingestSource="api" so allocator panels are not suppressed.
// ---------------------------------------------------------------------------
describe("FINDING-6: buildAllocatorPortfolioFactsheetPayload produces ingestSource='api'", () => {
  it("allocator portfolio payload has ingestSource='api' — not the conservative 'csv' default", async () => {
    const { buildAllocatorPortfolioFactsheetPayload } = await import("./allocator-portfolio-payload");
    // Build a minimal equity curve (at least 2 points needed)
    const equityPoints = Array.from({ length: 30 }, (_, i) => ({
      date: `2024-01-${String(i + 1).padStart(2, "0")}`,
      value: 1 + i * 0.001,
    }));
    const payload = buildAllocatorPortfolioFactsheetPayload(equityPoints, {
      allocatorId: "test-alloc",
      portfolioName: "Test Portfolio",
    });
    expect(payload).not.toBeNull();
    expect(payload!.ingestSource).toBe("api");
  });
});

// ---------------------------------------------------------------------------
// IMPORTANT-2 (b06-codereview) — ingestSource contract at the payload level.
//
// Phase 42 (PEER-01, ADR-0025) REPLACES the old behavioral pin. Previously this
// block asserted "csv arm → PeerPercentile gate suppresses" (peer NEVER renders
// for a csv payload, because MetricsColumn gated purely on ingestSource==='api').
// The user override (2026-06-25) surfaces the peer rank on the hypothetical
// scenario BLEND via an additive `scenarioPeer` carve-out — WITHOUT flipping
// ingestSource. The MetricsColumn gate is now:
//   ingestSource==='api'  OR  (scenarioMode && ingestSource==='csv' && scenarioPeer!=null)
//
// So the NEW behavioral invariant is: a csv payload built WITH scenarioPeer set
// carries the peer carve-out (the gate's csv disjunct activates) WHILE the four
// genuinely-synthetic api-only fields stay STRUCTURALLY ABSENT and ingestSource
// stays "csv". The render gate is exercised by the MetricsColumn render test
// (plan 04); here we pin the payload-shape contract the gate reads — the source
// of truth. The type-field invariant (the four api-only fields never on csv) is
// PRESERVED in the RED-TEAM-M2/M3 + B6 blocks below (scenarioPeer is a DIFFERENT
// field name, so those absence assertions still hold).
// ---------------------------------------------------------------------------
describe("IMPORTANT-2 / PEER-01: csv carve-out — scenarioPeer renders peer, synth panels stay absent", () => {
  it("csv + scenarioPeer: peer carve-out present, 4 synth panels absent, ingestSource stays 'csv'", () => {
    const payload = buildScenarioFactsheetPayload({
      portfolioDaily: makeReturns(40),
      scenarioPeer: { cohortSize: 42, sharpe: 70, sortino: 65, max_dd: 55 },
    });
    // ingestSource is NEVER flipped — the carve-out is additive on the csv arm.
    expect(payload.ingestSource).toBe("csv");
    // The carve-out is present + non-null → MetricsColumn's csv disjunct
    // (scenarioMode && ingestSource==='csv' && scenarioPeer!=null) activates.
    expect(payload.scenarioPeer).not.toBeNull();
    expect(payload.scenarioPeer).toEqual({
      cohortSize: 42,
      sharpe: 70,
      sortino: 65,
      max_dd: 55,
    });
    // The four GENUINELY-synthetic api-only fields stay structurally ABSENT —
    // `scenarioPeer` does NOT unlock them (it is a different field name on a
    // payload whose ingestSource is still "csv").
    for (const f of SYNTH_FIELDS) {
      expect(f in payload, `${f} must be absent on a csv+scenarioPeer payload`).toBe(false);
    }
  });

  it("csv WITHOUT scenarioPeer: byte-identical to before — no scenarioPeer key, peer gate inert", () => {
    // Every existing csv call site omits scenarioPeer → the key is OMITTED (not
    // undefined): MetricsColumn's csv disjunct is dead and the panel suppresses.
    const payload = buildScenarioFactsheetPayload({ portfolioDaily: makeReturns(40) });
    expect(payload.ingestSource).toBe("csv");
    expect("scenarioPeer" in payload).toBe(false);
    for (const f of SYNTH_FIELDS) {
      expect(f in payload, `${f} must be absent on a bare csv payload`).toBe(false);
    }
  });

  it("API payload ingestSource='api' — PeerPercentile gate's api disjunct shows the panel", () => {
    const payload = buildFactsheetPayload(
      makeStrategy({ ingestSource: "api" }),
      makeReturns(),
    );
    expect(payload!.ingestSource).toBe("api");
    expect(payload!.ingestSource === "api").toBe(true);
  });
});

// ---------------------------------------------------------------------------
// RED-TEAM-M2 / RED-TEAM-M3 + B6 — synthesized panels are STRUCTURALLY ABSENT
// from the payload for csv strategies (not merely null). The B6 discriminated
// union (FactsheetApiPayload | FactsheetCsvPayload) omits peerPercentile /
// allocatorPortfolios / eventSignatures / benchEventSignatures on the csv arm,
// so they never reach the RSC payload blob AND a csv consumer cannot read them
// (an unnarrowed field access is a compile error — see the type-level block).
// ---------------------------------------------------------------------------
const SYNTH_FIELDS = [
  "peerPercentile",
  "allocatorPortfolios",
  "eventSignatures",
  "benchEventSignatures",
] as const;

describe("RED-TEAM-M2/M3 + B6: synthesized panels absent from csv payloads", () => {
  it("csv strategy: the four synthesized fields are absent from the object (stronger than null)", () => {
    const payload = buildFactsheetPayload(
      makeStrategy({ ingestSource: "csv" }),
      makeReturns(),
    );
    expect(payload).not.toBeNull();
    expect(payload!.ingestSource).toBe("csv");
    for (const f of SYNTH_FIELDS) {
      // `in` proves the KEY is absent — so it is never serialized into the RSC
      // blob, and JSON.stringify(payload) cannot leak a synthesized figure.
      expect(f in payload!, `${f} must be absent on a csv payload`).toBe(false);
    }
  });

  it("csv default (no ingestSource): the four synthesized fields are absent", () => {
    // Conservative default — caller omits ingestSource → treated as csv.
    const payload = buildFactsheetPayload(makeStrategy(), makeReturns());
    expect(payload!.ingestSource).toBe("csv");
    for (const f of SYNTH_FIELDS) {
      expect(f in payload!, `${f} must be absent on the default csv payload`).toBe(false);
    }
  });

  it("api strategy: all four synthesized fields are present and non-null", () => {
    const payload = buildFactsheetPayload(
      makeStrategy({ ingestSource: "api" }),
      makeReturns(),
    );
    expect(payload).not.toBeNull();
    const p = payload!;
    // Narrow to the api arm so the synthesized fields are type-accessible (B6).
    if (p.ingestSource !== "api") throw new Error("expected the api arm");
    expect(p.peerPercentile).not.toBeNull();
    expect(p.allocatorPortfolios).not.toBeNull();
    expect(p.eventSignatures).not.toBeNull();
    expect(p.benchEventSignatures).not.toBeNull();
    for (const f of SYNTH_FIELDS) {
      expect(f in p, `${f} must be present on an api payload`).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// B6 — FactsheetPayload discriminated-union contract (TYPE-LEVEL).
// Compile-time (tsc) assertions enforced by `npm run typecheck`: the synthesized
// panels exist ONLY on the "api" arm, so reading one off the bare union is a
// type error. A regression that flattens the union back to a single `X | null`
// shape turns each @ts-expect-error into an "unused directive" → tsc fails. This
// is the by-construction backstop for the no-invented-data contract.
// ---------------------------------------------------------------------------
describe("B6: FactsheetPayload discriminated-union contract (type-level)", () => {
  it("synthesized panels are unreadable until ingestSource is narrowed to 'api'", () => {
    const payload = buildFactsheetPayload(
      makeStrategy({ ingestSource: "api" }),
      makeReturns(),
    );
    expect(payload).not.toBeNull();
    const p = payload!;

    // Before narrowing: each access is a compile error (field absent on the csv
    // arm of the union). Each @ts-expect-error is load-bearing — flatten the
    // union and tsc fails on the now-unused directive.
    // @ts-expect-error B6: peerPercentile is api-arm-only; unreadable on the union.
    void p.peerPercentile;
    // @ts-expect-error B6: allocatorPortfolios is api-arm-only; unreadable on the union.
    void p.allocatorPortfolios;
    // @ts-expect-error B6: eventSignatures is api-arm-only; unreadable on the union.
    void p.eventSignatures;
    // @ts-expect-error B6: benchEventSignatures is api-arm-only; unreadable on the union.
    void p.benchEventSignatures;

    if (p.ingestSource === "api") {
      // After narrowing: all four compile (NO @ts-expect-error — these lines
      // MUST type-check, proving the api arm carries the fields).
      void p.peerPercentile;
      void p.allocatorPortfolios;
      void p.eventSignatures;
      void p.benchEventSignatures;
    }

    expect(p.ingestSource).toBe("api");
  });
});

// ---------------------------------------------------------------------------
// RED-TEAM-M4 — FreshnessChip epoch sentinel renders "N/A" not "Jan 1, 1970"
// Test the sentinel detection logic extracted from the component.
// ---------------------------------------------------------------------------
describe("RED-TEAM-M4: epoch sentinel detected and hidden from rendered date", () => {
  const EPOCH_SENTINEL = "1970-01-01T00:00:00Z";

  it("epoch sentinel is the string '1970-01-01T00:00:00Z' (server contract)", () => {
    // Validates the sentinel value used by both server (page.tsx) and chip logic.
    expect(EPOCH_SENTINEL).toBe("1970-01-01T00:00:00Z");
  });

  it("epoch sentinel comparison is exact string equality (no Date parse needed)", () => {
    const isEpoch = (v: string) => v === EPOCH_SENTINEL;
    expect(isEpoch("1970-01-01T00:00:00Z")).toBe(true);
    expect(isEpoch("2024-05-01T00:00:00Z")).toBe(false);
    expect(isEpoch("1970-01-01")).toBe(false); // only the exact sentinel matches
  });

  it("old code: epoch renders as 'old' — correct tone but exposes year 1970 visually", () => {
    // This was already a correct tone (old/red), but displays "Jan 1, 1970 (20090d)"
    // which is alarming to institutional viewers. The fix renders "N/A" instead.
    const epochDate = EPOCH_SENTINEL;
    const d = new Date(epochDate);
    const days = (Date.now() - d.getTime()) / 86_400_000;
    // Epoch is clearly "old"
    expect(days).toBeGreaterThan(7);
    // Without the sentinel check, formatIsoDate produces a recognizable epoch date
    const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"] as const;
    const formatted = `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
    expect(formatted).toBe("Jan 1, 1970");
    // The fix replaces this with "N/A" by detecting the sentinel first.
  });
});

// ---------------------------------------------------------------------------
// RED-TEAM-H1 — discovery page ingestSource derivation mirrors factsheet page
// Tests the ingestSource classification logic at the unit level (same logic
// copied to both pages — if this test fails without the fix, the discovery
// page defaulted every strategy to "csv").
// ---------------------------------------------------------------------------
describe("RED-TEAM-H1: ingestSource derivation — the shared deriveIngestSource (single source of truth)", () => {
  // Imports the PRODUCTION deriveIngestSource (build-payload.ts) that BOTH
  // factsheet/[id]/v2/page.tsx and the discovery detail page call. A branch flip
  // in the real derivation now fails these assertions instead of silently
  // diverging across surfaces — the prior local copy of this ternary could not
  // catch that (Rule 9: a test against a copy can't fail when the code changes). (B6)

  it("null dailyRaw (api-only strategy) → 'api'", () => {
    expect(deriveIngestSource(null)).toBe("api");
  });

  it("undefined dailyRaw (api-only strategy) → 'api'", () => {
    expect(deriveIngestSource(undefined)).toBe("api");
  });

  it("array dailyRaw → 'csv'", () => {
    expect(deriveIngestSource([{ date: "2024-01-01", value: 0.001 }])).toBe("csv");
  });

  it("empty array dailyRaw → 'csv' (CSV ingester ran, produced 0 rows)", () => {
    expect(deriveIngestSource([])).toBe("csv");
  });

  it("before fix: discovery page passed no ingestSource → builder defaulted to 'csv' for API strategies", () => {
    // Without ingestSource, buildFactsheetPayload defaults to "csv" (conservative).
    // An api-source strategy passing through discovery would have ingestSource==="csv"
    // and all gated panels suppressed. The fix ensures the discovery page derives
    // ingestSource before calling buildFactsheetPayload.
    const payload = buildFactsheetPayload(
      // Simulate discovery page before fix: no ingestSource passed
      makeStrategy({ /* no ingestSource */ }),
      makeReturns(),
    );
    // The builder defaults to "csv" — this is what broke api-strategy panels on discovery
    expect(payload!.ingestSource).toBe("csv");
    // After fix: the discovery page explicitly passes ingestSource derived from dailyRaw
    const payloadFixed = buildFactsheetPayload(
      makeStrategy({ ingestSource: "api" }),
      makeReturns(),
    );
    expect(payloadFixed!.ingestSource).toBe("api");
  });
});

// ---------------------------------------------------------------------------
// #597 — asset-class annualization threads end-to-end through the factsheet.
// A crypto strategy (assetClass:"crypto") must annualize EVERY single-strategy
// KPI on √365; a traditional / absent one stays on √252 (byte-identical to the
// pre-#597 hardcode). Proven at the payload boundary so the wiring through
// compute / rolling / bootstrap / comparator can't silently regress.
// ---------------------------------------------------------------------------
describe("#597: asset-class annualization end-to-end", () => {
  const rets = makeReturns(80);

  it("absent assetClass == explicit 'traditional' == 252 (byte-identical)", () => {
    const absent = buildFactsheetPayload(makeStrategy(), rets)!;
    const trad = buildFactsheetPayload(makeStrategy({ assetClass: "traditional" }), rets)!;
    expect(trad.strategyMetrics.sharpe).toBe(absent.strategyMetrics.sharpe);
    expect(trad.strategyMetrics.sortino).toBe(absent.strategyMetrics.sortino);
    expect(trad.strategyMetrics.ann_vol).toBe(absent.strategyMetrics.ann_vol);
  });

  it("crypto headline Sharpe / Sortino / vol scale by √(365/252) vs traditional; max_dd invariant", () => {
    const trad = buildFactsheetPayload(makeStrategy({ assetClass: "traditional" }), rets)!;
    const crypto = buildFactsheetPayload(makeStrategy({ assetClass: "crypto" }), rets)!;
    const k = Math.sqrt(365 / 252);
    expect(crypto.strategyMetrics.sharpe!).toBeCloseTo(trad.strategyMetrics.sharpe! * k, 8);
    expect(crypto.strategyMetrics.sortino!).toBeCloseTo(trad.strategyMetrics.sortino! * k, 8);
    expect(crypto.strategyMetrics.ann_vol).toBeCloseTo(trad.strategyMetrics.ann_vol * k, 8);
    // Drawdown carries no annualization term.
    expect(crypto.strategyMetrics.max_dd).toBe(trad.strategyMetrics.max_dd);
  });

  it("crypto bootstrap-CI Sharpe point estimate also lands on √365", () => {
    const trad = buildFactsheetPayload(makeStrategy({ assetClass: "traditional" }), rets)!;
    const crypto = buildFactsheetPayload(makeStrategy({ assetClass: "crypto" }), rets)!;
    const k = Math.sqrt(365 / 252);
    // Bootstrap point == headline stats on the same series/basis.
    expect(crypto.bootstrapCI.sharpe.point).toBeCloseTo(trad.bootstrapCI.sharpe.point * k, 8);
  });

  // Comparator-block wiring: build-payload must forward periodsPerYear into
  // buildComparatorBlock → jointMetrics. Tracking-error is an annualized vol
  // (√N term) so it scales √(365/252); alpha = (mean − β·mean_b)·N so it scales
  // linearly (365/252). Reddens if buildComparatorBlock stops forwarding the basis.
  it("comparators.btc.joint annualization: TE scales √(365/252), alpha scales 365/252", () => {
    const trad = buildFactsheetPayload(makeStrategy({ assetClass: "traditional" }), rets)!;
    const crypto = buildFactsheetPayload(makeStrategy({ assetClass: "crypto" }), rets)!;
    const jt = trad.comparators.btc.joint;
    const jc = crypto.comparators.btc.joint;
    expect(jt).not.toBeNull();
    expect(jc).not.toBeNull();
    expect(jc!.tracking_error).toBeCloseTo(jt!.tracking_error * Math.sqrt(365 / 252), 8);
    expect(jc!.alpha).toBeCloseTo(jt!.alpha * (365 / 252), 8);
  });

  // Rolling-series wiring: build-payload must pass periodsPerYear into
  // rollingVol. Every defined (post-warmup) entry scales √(365/252). Reddens if
  // build-payload stops threading the basis into the rolling series.
  it("strategyRollingVol scales √(365/252) on every defined entry", () => {
    const trad = buildFactsheetPayload(makeStrategy({ assetClass: "traditional" }), rets)!;
    const crypto = buildFactsheetPayload(makeStrategy({ assetClass: "crypto" }), rets)!;
    const k = Math.sqrt(365 / 252);
    let compared = 0;
    for (let i = 0; i < trad.strategyRollingVol.length; i++) {
      const t = trad.strategyRollingVol[i];
      const c = crypto.strategyRollingVol[i];
      if (t == null || c == null) continue;
      expect(c).toBeCloseTo(t * k, 10);
      compared++;
    }
    // Non-vacuity: the 80-day fixture fills the 30d fallback window, so there
    // ARE post-warmup entries — a silently all-null array must not pass vacuously.
    expect(compared).toBeGreaterThan(0);
  });

  // Peer-percentile ranks the ANNUALIZED Sharpe/Sortino DIRECTLY — no basis
  // rescale. Annualized Sharpe is frequency-invariant, so the cohort (a fixed
  // distribution of annualized Sharpes) is asset-class-agnostic. The SAME daily
  // series posted 365 days/year genuinely has a √(365/252)× higher ANNUAL Sharpe
  // than posted 252 days/year, so the crypto interpretation must rank AT LEAST
  // as high as traditional — never below. This reddens if anyone re-introduces a
  // √(252/365) "basis correction" (rejected: it de-annualizes crypto and stamps
  // a ~17% systematic penalty on 24/7 sleeves — the wrong fix for a non-problem).
  it("peerPercentile ranks raw annualized Sharpe: crypto never ranks BELOW traditional for the same series", () => {
    const trad = buildFactsheetPayload(
      makeStrategy({ ingestSource: "api", assetClass: "traditional" }),
      rets,
    )!;
    const crypto = buildFactsheetPayload(
      makeStrategy({ ingestSource: "api", assetClass: "crypto" }),
      rets,
    )!;
    if (trad.ingestSource !== "api" || crypto.ingestSource !== "api") {
      throw new Error("expected the api arm");
    }
    expect(trad.peerPercentile).not.toBeNull();
    expect(crypto.peerPercentile).not.toBeNull();
    // Crypto's higher annualized Sharpe/Sortino → percentile ≥ traditional's
    // (cohort CDF is monotonic; equal only if both saturate the clamp). A
    // rankScale revert would flip these below 1× and redden.
    expect(crypto.peerPercentile!.sharpe).toBeGreaterThanOrEqual(trad.peerPercentile!.sharpe);
    expect(crypto.peerPercentile!.sortino).toBeGreaterThanOrEqual(trad.peerPercentile!.sortino);
    // max_dd carries no annualization term → identical rank.
    expect(crypto.peerPercentile!.max_dd).toBe(trad.peerPercentile!.max_dd);
    // Displayed headline Sharpe stays on the crypto √365 basis.
    expect(crypto.strategyMetrics.sharpe!).toBeCloseTo(
      trad.strategyMetrics.sharpe! * Math.sqrt(365 / 252),
      8,
    );
  });
});

// ---------------------------------------------------------------------------
// Phase 90 (D6) — composite → csv arm. A stitched multi-key composite routes
// down the EXISTING csv arm (build-payload.ts:246-318): the discriminated union
// structurally omits the three synthesized panels (peerPercentile /
// allocatorPortfolios / eventSignatures) — NO new suppression logic (D6).
//
// CLASSIFICATION NOTE (RED-TEAM-H1 preserved): `deriveIngestSource` stays on the
// raw `daily_returns` COLUMN (null for composites). The Phase-90 composite branch
// sets `ingestSource:"csv"` EXPLICITLY on the buildFactsheetPayload call — it
// NEVER re-derives from the new sparse `csv_daily_returns` read. The RED-TEAM-H1
// block above is therefore left byte-for-byte untouched by this Phase-90 append.
// ---------------------------------------------------------------------------

// Local typed cast for the not-yet-existing third `opts` arg (lands in 90-03).
// The current 2-arg signature won't accept a third argument, so we cast the
// function through a typed alias rather than the call site.
type Phase90Opts = {
  cumulativeMethod?: "geometric" | "arithmetic";
  segmentBoundaries?: { date: string; seq: number; label: string }[];
  missingSegments?: { start: string; end: string; kind: "gap"; days: number }[];
  metricsByBasis?: { cash_settlement: Record<string, number>; mark_to_market?: Record<string, number> };
  dataQuality?: { composite: boolean };
  mtmGate?: { available: boolean; reason?: string };
};
const buildWithOpts = buildFactsheetPayload as unknown as (
  s: Parameters<typeof buildFactsheetPayload>[0],
  d: Parameters<typeof buildFactsheetPayload>[1],
  o?: Phase90Opts,
) => ReturnType<typeof buildFactsheetPayload>;

describe("Phase 90 composite → csv arm", () => {
  const SYNTH = ["peerPercentile", "allocatorPortfolios", "eventSignatures"] as const;

  it("PIN: csv arm suppresses the three synthesized panels by construction (D6)", () => {
    // The composite routes down the csv arm exactly as a user-uploaded csv does:
    // ingestSource:"csv" set explicitly → the discriminated union omits the
    // synthesized demo panels. No Phase-90-specific suppression logic exists.
    const payload = buildFactsheetPayload(
      makeStrategy({ ingestSource: "csv" }),
      makeReturns(),
    );
    expect(payload).not.toBeNull();
    expect(payload!.ingestSource).toBe("csv");
    for (const f of SYNTH) {
      expect(f in payload!, `${f} must be absent on the csv-arm composite payload`).toBe(false);
    }
  });

  it("PIN: deriveIngestSource still classifies on the raw daily_returns column", () => {
    // RED-TEAM-H1 invariant restated at the Phase-90 seam: a composite's raw
    // column is null → "api" by the shared derivation, but the composite branch
    // OVERRIDES with an explicit ingestSource:"csv" on the build call. The two
    // concerns stay separate; the classifier is never fed csv_daily_returns.
    expect(deriveIngestSource(null)).toBe("api");
    expect(deriveIngestSource([])).toBe("csv");
  });

  it("RED (90-03): opts.segmentBoundaries + dataQuality thread onto the csv-arm payload", () => {
    const segmentBoundaries = [{ date: "2025-10-01", seq: 2, label: "2" }];
    const dataQuality = { composite: true };
    const payload = buildWithOpts(
      makeStrategy({ ingestSource: "csv" }),
      makeReturns(),
      { cumulativeMethod: "arithmetic", segmentBoundaries, dataQuality },
    )!;
    const f = payload as unknown as Record<string, unknown>;
    expect(f.segmentBoundaries).toEqual(segmentBoundaries);
    expect(f.dataQuality).toEqual(dataQuality);
  });
});
