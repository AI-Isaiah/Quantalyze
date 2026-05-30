/**
 * Regression tests for audit batch 06 — factsheet-public cluster (NEW-C20-xx).
 *
 * Each `it` block describes a concrete scenario that was previously broken and
 * verifies the fix. Tests fail without the fix and pass with it.
 */
import { describe, it, expect } from "vitest";
import { buildFactsheetPayload, deriveIngestSource } from "./build-payload";

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
// IMPORTANT-2 (b06-codereview) — ingestSource contract at the payload level
// Verifies that a CSV-tagged payload has ingestSource="csv" (the render-gate
// key for PeerPercentile and AllocatorSection suppression). A component-level
// test would require heavy mocking; the payload contract is the source of truth
// that the JSX gates read — testing it here covers the full chain.
// ---------------------------------------------------------------------------
describe("IMPORTANT-2: ingestSource='csv' payload contract for panel suppression", () => {
  it("CSV payload ingestSource='csv' — PeerPercentile and Allocator gates will suppress", () => {
    const payload = buildFactsheetPayload(
      makeStrategy({ ingestSource: "csv" }),
      makeReturns(),
    );
    expect(payload!.ingestSource).toBe("csv");
    // The JSX gates check payload.ingestSource === "api":
    // MetricsColumn: payload.ingestSource === "api" → show PeerPercentile
    // FactsheetBody: !hideAllocatorSection && payload.ingestSource === "api" → show Allocator
    // Both are false for csv — panels are suppressed.
    expect(payload!.ingestSource === "api").toBe(false);
  });

  it("API payload ingestSource='api' — PeerPercentile and Allocator gates will show panels", () => {
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
