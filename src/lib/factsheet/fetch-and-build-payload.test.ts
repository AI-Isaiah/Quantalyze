/**
 * Phase 167.2.1 (FACTSHEETBUILDABLE) — the unit half of the WR-02 reproduction.
 *
 * THE MISMATCH. A strategy whose `strategy_analytics.computation_status` reads
 * 'complete' is called "computed" by every owner surface, yet
 * `fetchAndBuildPayload` can still answer null for it: a single-key row with
 * fewer than 2 distinct dated returns, or a composite whose persisted
 * `cash_settlement` headline is absent (a pre-Phase-86 composite). The share
 * recipient then lands on the "not available" card while the owner was told
 * nothing. These cases reproduce that on a mocked service-role client, with a
 * CONTROL row proving the harness can build at all, so a green REPRO arm cannot
 * be a harness that never builds anything.
 *
 * The same populations are reproduced on real rows by the live-DB spec
 * `src/__tests__/factsheet-buildable-live-db.test.ts`. This file must never
 * name that spec's gate symbol: the lane-corpus walker selects files by that
 * substring, and this unit file belongs to the ordinary shards.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/sentry-capture", () => ({ captureToSentry: vi.fn() }));

type Row = Record<string, unknown>;

const fake = vi.hoisted(() => ({
  strategyResult: { data: null as unknown, error: null as unknown },
  csvRows: [] as { date: string; daily_return: number }[],
  csvError: null as unknown,
  tablesSeen: [] as string[],
  orFilters: [] as string[],
}));

vi.mock("@/lib/supabase/admin", () => {
  function builder(table: string) {
    const b: Record<string, unknown> = {};
    const self = () => b;
    b.select = self;
    b.eq = self;
    b.order = self;
    b.limit = self;
    b.or = (filter: string) => {
      fake.orFilters.push(filter);
      return b;
    };
    b.maybeSingle = async () => {
      if (table === "strategies") return fake.strategyResult;
      // strategy_analytics_series and anything else: no row.
      return { data: null, error: null };
    };
    if (table === "csv_daily_returns") {
      // The composite read awaits the builder itself after `.limit(...)`.
      b.then = (resolve: (v: unknown) => unknown) =>
        resolve(fake.csvError ? { data: null, error: fake.csvError } : { data: fake.csvRows, error: null });
    }
    return b;
  }
  return {
    createAdminClient: () => ({
      from: (table: string) => {
        fake.tablesSeen.push(table);
        return builder(table);
      },
    }),
  };
});

// Wrap the real builder in a spy, so the probe can be proven never to build.
vi.mock("./build-payload", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./build-payload")>();
  return { ...actual, buildFactsheetPayload: vi.fn(actual.buildFactsheetPayload) };
});

import {
  fetchAndBuildPayload,
  fetchAndBuildPayloadWithReason,
  probeFactsheetBuildable,
} from "./fetch-and-build-payload";
import type { NotBuildableReason } from "./fetch-and-build-payload";
import { buildFactsheetPayload } from "./build-payload";
import { captureToSentry } from "@/lib/sentry-capture";
import { withPublishedOrOwner } from "@/lib/visibility";

// Synthetic, UUID-shaped ids: `withPublishedOrOwner` fails closed on a non-UUID.
const OWNER_ID = "00000000-0000-4000-8000-0000000000a1";
const STRATEGY_ID = "00000000-0000-4000-8000-0000000000b2";
const ownerVisibility = <Q,>(q: Q): Q => withPublishedOrOwner(q, OWNER_ID);

/** N consecutive synthetic calendar days from 2024-01-02, as {date, value}. */
function points(n: number): { date: string; value: number }[] {
  const out: { date: string; value: number }[] = [];
  const start = Date.parse("2024-01-02T00:00:00Z");
  for (let i = 0; i < n; i++) {
    const date = new Date(start + i * 86_400_000).toISOString().slice(0, 10);
    out.push({ date, value: ((i % 7) - 3) / 1000 });
  }
  return out;
}

function strategyRow(analytics: Row): Row {
  return {
    id: STRATEGY_ID,
    name: "Synthetic Buildability Fixture",
    codename: null,
    disclosure_tier: null,
    status: "draft",
    markets: [],
    strategy_types: [],
    description: null,
    subtypes: [],
    supported_exchanges: [],
    leverage_range: null,
    aum: null,
    max_capacity: null,
    avg_daily_turnover: null,
    start_date: null,
    benchmark: null,
    asset_class: "crypto",
    returns_denominator_config: null,
    strategy_analytics: analytics,
  };
}

function analyticsRow(over: Row): Row {
  return {
    daily_returns: null,
    returns_series: null,
    computed_at: "2024-03-01T00:00:00Z",
    data_quality_flags: null,
    metrics_json_by_basis: null,
    computation_status: "complete",
    ...over,
  };
}

function seed(
  row: Row | null,
  csv: { date: string; daily_return: number }[] = [],
  error: unknown = null,
) {
  fake.strategyResult = { data: row, error };
  fake.csvRows = csv;
}

beforeEach(() => {
  fake.strategyResult = { data: null, error: null };
  fake.csvRows = [];
  fake.csvError = null;
  fake.tablesSeen = [];
  fake.orFilters = [];
  vi.mocked(captureToSentry).mockClear();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("WR-02 reproduction — the owner reads 'complete' and the builder answers null", () => {
  it("REPRO-SINGLE-ONE-POINT: a complete single-key row with ONE dated return builds nothing", async () => {
    const row = strategyRow(analyticsRow({ daily_returns: [{ date: "2024-01-02", value: 0.01 }] }));
    seed(row);
    // What the owner's surfaces read: the embed's status is a terminal success.
    expect((row.strategy_analytics as Row).computation_status).toBe("complete");
    const payload = await fetchAndBuildPayload(STRATEGY_ID, ownerVisibility);
    expect(payload).toBeNull();
    expect(fake.orFilters.some((f) => f.includes(OWNER_ID))).toBe(true);
  });

  it("REPRO-COMPOSITE-PRE86: a complete composite with no persisted headline builds nothing, despite two csv rows", async () => {
    const row = strategyRow(
      analyticsRow({ data_quality_flags: { composite: true }, metrics_json_by_basis: null }),
    );
    seed(row, [
      { date: "2024-01-02", daily_return: 0.01 },
      { date: "2024-01-03", daily_return: -0.005 },
    ]);
    expect((row.strategy_analytics as Row).computation_status).toBe("complete");
    const payload = await fetchAndBuildPayload(STRATEGY_ID, ownerVisibility);
    expect(payload).toBeNull();
    expect(fake.tablesSeen).toContain("csv_daily_returns");
    expect(fake.orFilters.some((f) => f.includes(OWNER_ID))).toBe(true);
  });

  it("CONTROL-BUILDABLE: a complete single-key row with 30 dated returns builds, so the harness can build", async () => {
    seed(strategyRow(analyticsRow({ daily_returns: points(30) })));
    const payload = await fetchAndBuildPayload(STRATEGY_ID, ownerVisibility);
    expect(payload).not.toBeNull();
    expect(payload?.strategyId).toBe(STRATEGY_ID);
    expect(fake.orFilters.some((f) => f.includes(OWNER_ID))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// SC2 / D-04 / D-07 — the probe and the builder decide from ONE resolve stage.
// ---------------------------------------------------------------------------

const FULL_CASH = {
  cumulative_return: 0.05,
  volatility: 0.12,
  max_drawdown: -0.04,
  cagr: 0.31,
  sharpe: 1.4,
  sortino: 2.1,
  calmar: 3.0,
};

function csvRows(n: number): { date: string; daily_return: number }[] {
  return points(n).map((p) => ({ date: p.date, daily_return: p.value }));
}

/** A 31-point cumprod wealth curve, the shape the analytics service writes to returns_series. */
function wealthCurve(n: number): { date: string; value: number }[] {
  let w = 1;
  return points(n).map((p) => {
    w *= 1 + p.value;
    return { date: p.date, value: w };
  });
}

const composite = (over: Row) =>
  strategyRow(analyticsRow({ data_quality_flags: { composite: true }, ...over }));
const single = (over: Row) => strategyRow(analyticsRow(over));

const thirty = points(30);
const flatDict = Object.fromEntries(thirty.map((p) => [p.date, p.value]));
const nestedDict: Record<string, Record<string, number>> = {};
for (const p of thirty) {
  const [y, m, d] = p.date.split("-");
  (nestedDict[y] ??= {})[`${Number(m)}-${Number(d)}`] = p.value;
}

type Fixture = {
  name: string;
  row: Row | null;
  csv?: { date: string; daily_return: number }[];
  error?: unknown;
  /** The absolute expectation: null when a reason is named, else a payload. */
  reason: NotBuildableReason | null;
};

const PARITY: Fixture[] = [
  { name: "admin read error", row: null, error: { message: "synthetic outage", code: "XX000" }, reason: "read_error" },
  { name: "no row", row: null, reason: "not_visible" },
  { name: "status failed with a good series", row: single({ computation_status: "failed", daily_returns: thirty }), reason: "not_computed" },
  { name: "status computing", row: single({ computation_status: "computing", daily_returns: thirty }), reason: "not_computed" },
  { name: "composite, metrics_json_by_basis null", row: composite({ metrics_json_by_basis: null }), csv: csvRows(30), reason: "composite_unbuildable" },
  { name: "composite, valid headline, empty csv read", row: composite({ metrics_json_by_basis: { cash_settlement: FULL_CASH } }), csv: [], reason: "composite_unbuildable" },
  { name: "composite, valid headline, one csv row", row: composite({ metrics_json_by_basis: { cash_settlement: FULL_CASH } }), csv: csvRows(1), reason: "composite_unbuildable" },
  { name: "composite, valid headline, 30 csv rows", row: composite({ metrics_json_by_basis: { cash_settlement: FULL_CASH } }), csv: csvRows(30), reason: null },
  { name: "single-key, daily_returns and returns_series null", row: single({}), reason: "too_few_points" },
  { name: "single-key, one point", row: single({ daily_returns: [{ date: "2024-01-02", value: 0.01 }] }), reason: "too_few_points" },
  {
    name: "single-key, one point duplicated",
    row: single({ daily_returns: [{ date: "2024-01-02", value: 0.01 }, { date: "2024-01-02", value: 0.01 }] }),
    reason: "too_few_points",
  },
  {
    // 167.2.1-REVIEW-SFH M-3: two stored dated entries, one dropped as
    // malformed. "Fewer than 2 days of returns" would be false; this was
    // `too_few_points` until the review.
    name: "single-key, one finite point plus one NaN",
    row: single({ daily_returns: [{ date: "2024-01-02", value: 0.01 }, { date: "2024-01-03", value: NaN }] }),
    reason: "malformed_series",
  },
  {
    name: "single-key, three numeric-string values",
    row: single({
      daily_returns: [
        { date: "2024-01-02", value: "0.01" },
        { date: "2024-01-03", value: "0.02" },
        { date: "2024-01-04", value: "-0.01" },
      ],
    }),
    reason: "malformed_series",
  },
  {
    name: "single-key, returns_series-only curve of non-positive wealth points",
    row: single({ returns_series: points(5).map((p) => ({ date: p.date, value: 0 })) }),
    reason: "malformed_series",
  },
  {
    name: "single-key, returns_series-only curve of two wealth points (one return)",
    row: single({ returns_series: wealthCurve(2) }),
    reason: "too_few_points",
  },
  {
    // 167.2.1-REVIEW-SFH-R2 N-5: the builder reads `daily_returns` whenever it
    // normalizes to an entry, so the long wealth curve is never read and is
    // never counted. This was `malformed_series` until the fix.
    name: "single-key, one valid daily_returns point beside a long returns_series",
    row: single({ daily_returns: [{ date: "2024-01-02", value: 0.01 }], returns_series: wealthCurve(31) }),
    reason: "too_few_points",
  },
  {
    // N-5: the same shadowing, with the read column genuinely malformed.
    name: "single-key, one finite point plus one NaN beside a long returns_series",
    row: single({
      daily_returns: [{ date: "2024-01-02", value: 0.01 }, { date: "2024-01-03", value: NaN }],
      returns_series: wealthCurve(31),
    }),
    reason: "malformed_series",
  },
  {
    name: "single-key, two good points",
    row: single({ daily_returns: [{ date: "2024-01-02", value: 0.01 }, { date: "2024-01-03", value: -0.02 }] }),
    reason: null,
  },
  { name: "single-key, 30 points as an array", row: single({ daily_returns: thirty }), reason: null },
  { name: "single-key, 30 points as a flat date dict", row: single({ daily_returns: flatDict }), reason: null },
  { name: "single-key, 30 points as a nested year dict", row: single({ daily_returns: nestedDict }), reason: null },
  { name: "single-key, returns_series-only equity curve", row: single({ returns_series: wealthCurve(31) }), reason: null },
];

describe("167.2.1 SC2 — probeFactsheetBuildable agrees with fetchAndBuildPayload on every fixture", () => {
  for (const f of PARITY) {
    it(`PARITY ${f.name}: ${f.reason ?? "buildable"}`, async () => {
      seed(f.row, f.csv ?? [], f.error ?? null);
      const payload = await fetchAndBuildPayload(STRATEGY_ID, ownerVisibility);

      seed(f.row, f.csv ?? [], f.error ?? null);
      fake.tablesSeen = [];
      fake.orFilters = [];
      const buildsBefore = vi.mocked(buildFactsheetPayload).mock.calls.length;
      const probe = await probeFactsheetBuildable(STRATEGY_ID, ownerVisibility);

      // The absolute expectation, so parity cannot pass with both sides wrong.
      if (f.reason === null) {
        expect(payload).not.toBeNull();
        expect(probe).toEqual({ buildable: true });
      } else {
        expect(payload).toBeNull();
        expect(probe).toEqual({ buildable: false, reason: f.reason });
      }
      // The invariant the probe's doc comment states.
      expect(probe.buildable).toBe(payload !== null);
      // The probe is the resolve stage and nothing else: no build, no basis reads.
      expect(vi.mocked(buildFactsheetPayload).mock.calls.length).toBe(buildsBefore);
      expect(fake.tablesSeen).not.toContain("strategy_analytics_series");
      // The visibility predicate is REQUIRED and reached the probe's query.
      expect(fake.orFilters.some((flt) => flt.includes(OWNER_ID))).toBe(true);
    });
  }

  it("WR-03 WITH-REASON: the reason-carrying build answers the probe's reason from ONE resolve, on every fixture", async () => {
    for (const f of PARITY) {
      seed(f.row, f.csv ?? [], f.error ?? null);
      fake.tablesSeen = [];
      const built = await fetchAndBuildPayloadWithReason(STRATEGY_ID, ownerVisibility);
      // One resolve: the strategies row is read exactly once.
      expect(fake.tablesSeen.filter((t) => t === "strategies"), f.name).toHaveLength(1);
      expect(built.reason, f.name).toBe(f.reason);
      expect(built.payload === null, f.name).toBe(f.reason !== null);
    }
  });

  it("SFH M-1 LOG LABEL: a probe's resolve logs as a probe, never as a factsheet build, and a build logs as a build", async () => {
    const warn = vi.mocked(console.warn);
    const lines = () => warn.mock.calls.map((c) => String(c[0]));
    for (const f of PARITY.filter((x) => x.reason === "not_computed" || x.reason === "too_few_points")) {
      seed(f.row, f.csv ?? [], f.error ?? null);
      warn.mockClear();
      await probeFactsheetBuildable(STRATEGY_ID, ownerVisibility);
      expect(lines().length, f.name).toBeGreaterThan(0);
      for (const line of lines()) {
        expect(line, f.name).toContain("resolve(probe)");
        expect(line, f.name).not.toContain("fetchAndBuildPayload");
      }
      seed(f.row, f.csv ?? [], f.error ?? null);
      warn.mockClear();
      await fetchAndBuildPayload(STRATEGY_ID, ownerVisibility);
      expect(lines().some((l) => l.includes("resolve(build)")), f.name).toBe(true);
      expect(lines().some((l) => l.includes("resolve(probe)")), f.name).toBe(false);
    }
  });

  it("SFH M-2 READ-ERROR CAPTURE: a failed admin read is captured once per resolve, with its code, on the build and the probe alike", async () => {
    const outage = PARITY.find((f) => f.reason === "read_error")!;
    for (const [caller, run] of [
      ["build", () => fetchAndBuildPayload(STRATEGY_ID, ownerVisibility)],
      ["probe", () => probeFactsheetBuildable(STRATEGY_ID, ownerVisibility)],
    ] as const) {
      seed(outage.row, [], outage.error);
      vi.mocked(captureToSentry).mockClear();
      await run();
      expect(vi.mocked(captureToSentry), caller).toHaveBeenCalledTimes(1);
      expect(vi.mocked(captureToSentry).mock.calls[0][1]).toEqual({
        tags: { stage: "factsheet-resolve", caller, reason: "read_error", code: "XX000" },
      });
    }
    // A row that is simply not visible is not an outage, and is not captured.
    seed(null);
    vi.mocked(captureToSentry).mockClear();
    await fetchAndBuildPayload(STRATEGY_ID, ownerVisibility);
    expect(vi.mocked(captureToSentry)).not.toHaveBeenCalled();
  });

  it("SFH H-1 COMPOSITE CAPTURE: every composite refusal is captured once at warning, naming its gate; a short single-key series is not", async () => {
    const expectCapture = (caller: string, gate: string) => {
      expect(vi.mocked(captureToSentry)).toHaveBeenCalledTimes(1);
      expect(vi.mocked(captureToSentry).mock.calls[0][1]).toEqual({
        level: "warning",
        tags: { stage: "factsheet-resolve-composite", caller, gate },
      });
    };
    const cases: Array<[string, string]> = [
      ["composite, metrics_json_by_basis null", "headline"],
      ["composite, valid headline, empty csv read", "empty_series"],
      ["composite, valid headline, one csv row", "short_series"],
    ];
    for (const [name, gate] of cases) {
      const f = PARITY.find((x) => x.name === name)!;
      seed(f.row, f.csv ?? []);
      vi.mocked(captureToSentry).mockClear();
      await probeFactsheetBuildable(STRATEGY_ID, ownerVisibility);
      expectCapture("probe", gate);
      seed(f.row, f.csv ?? []);
      vi.mocked(captureToSentry).mockClear();
      await fetchAndBuildPayload(STRATEGY_ID, ownerVisibility);
      expectCapture("build", gate);
    }
    // The case the finding is about: a csv read OUTAGE folds into an empty
    // series, and support now has an event to look up.
    seed(composite({ metrics_json_by_basis: { cash_settlement: FULL_CASH } }));
    fake.csvError = { message: "synthetic csv outage", code: "57014" };
    vi.mocked(captureToSentry).mockClear();
    expect(await probeFactsheetBuildable(STRATEGY_ID, ownerVisibility)).toEqual({
      buildable: false,
      reason: "composite_unbuildable",
    });
    expectCapture("probe", "empty_series");
    // A single-key series that is genuinely short is a data fact: no event.
    seed(single({ daily_returns: [{ date: "2024-01-02", value: 0.01 }] }));
    fake.csvError = null;
    vi.mocked(captureToSentry).mockClear();
    await probeFactsheetBuildable(STRATEGY_ID, ownerVisibility);
    expect(vi.mocked(captureToSentry)).not.toHaveBeenCalled();
  });

  it("SFH M-3 MALFORMED CAPTURE: a malformed stored series is captured with its counts; a genuinely short one is not", async () => {
    for (const f of PARITY.filter((x) => x.reason === "malformed_series")) {
      seed(f.row);
      vi.mocked(captureToSentry).mockClear();
      await probeFactsheetBuildable(STRATEGY_ID, ownerVisibility);
      expect(vi.mocked(captureToSentry), f.name).toHaveBeenCalledTimes(1);
      const ctx = vi.mocked(captureToSentry).mock.calls[0][1] as {
        tags: Record<string, string>;
        extra: { storedReturns: number; resolvedEntries: number };
      };
      expect(ctx.tags.stage, f.name).toBe("factsheet-resolve-malformed");
      expect(ctx.tags.caller, f.name).toBe("probe");
      // SFH-R2 N-5: the capture names the column that was counted, which is
      // the one the builder reads.
      expect(ctx.tags.source, f.name).toBe(
        f.name.includes("returns_series-only") ? "returns_series" : "daily_returns",
      );
      expect(ctx.extra.storedReturns, f.name).toBeGreaterThanOrEqual(2);
      expect(ctx.extra.resolvedEntries, f.name).toBeLessThan(2);
    }
    for (const f of PARITY.filter((x) => x.reason === "too_few_points")) {
      seed(f.row);
      vi.mocked(captureToSentry).mockClear();
      await probeFactsheetBuildable(STRATEGY_ID, ownerVisibility);
      expect(vi.mocked(captureToSentry), f.name).not.toHaveBeenCalled();
    }
  });

  it("NO-NULL-AFTER-RESOLVE: every fixture the probe calls buildable builds a payload", async () => {
    let okResolves = 0;
    for (const f of PARITY) {
      seed(f.row, f.csv ?? [], f.error ?? null);
      const probe = await probeFactsheetBuildable(STRATEGY_ID, ownerVisibility);
      if (!probe.buildable) continue;
      okResolves++;
      seed(f.row, f.csv ?? [], f.error ?? null);
      expect(await fetchAndBuildPayload(STRATEGY_ID, ownerVisibility), f.name).not.toBeNull();
    }
    // The loop must have exercised the ok branch, or it proves nothing.
    expect(okResolves).toBe(PARITY.filter((f) => f.reason === null).length);
    expect(okResolves).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// 167.2.1-REVIEW WR-04 — NO-NULL-AFTER-RESOLVE, the STRUCTURAL half.
//
// The table above samples: a new null exit on a branch no fixture reaches
// (an options/MTM basis arm, an asset_class branch, a gap_spans path) would
// leave it green. The guarantee is therefore carried by the types:
// `hasBuildableSeries` narrows to `BuildableSeries`, `buildFactsheetPayload`
// is typed non-null for one, and the two build bodies past the gates declare a
// non-null return, so a `return null` added there does not compile. This scan
// pins the declarations that make that true, so a rebase cannot quietly widen
// a return type back to `| null` or add a third gate in front of the build.
// ---------------------------------------------------------------------------

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/** Return type text and body of the IMPLEMENTATION of `function name(` (overload signatures skipped). */
function implementationOf(src: string, name: string): { returnType: string; body: string } {
  const needle = `function ${name}(`;
  let from = 0;
  for (;;) {
    const at = src.indexOf(needle, from);
    if (at < 0) throw new Error(`no implementation of ${name}`);
    let i = at + needle.length;
    let depth = 1;
    while (depth > 0) {
      const c = src[i++];
      if (c === "(") depth++;
      else if (c === ")") depth--;
    }
    const brace = src.indexOf("{", i);
    const semi = src.indexOf(";", i);
    if (semi >= 0 && semi < brace) {
      from = i;
      continue; // an overload signature
    }
    const returnType = src.slice(i, brace).trim();
    let j = brace + 1;
    depth = 1;
    while (depth > 0) {
      const c = src[j++];
      if (c === "{") depth++;
      else if (c === "}") depth--;
    }
    return { returnType, body: src.slice(brace, j) };
  }
}

const RETURN_NULL = /\breturn\s+null\b/g;
const readLib = (file: string) =>
  stripComments(readFileSync(join(__dirname, file), "utf8"));

describe("167.2.1 WR-04 — NO-NULL-AFTER-RESOLVE holds by construction", () => {
  it("the one resolve-and-build answers no payload only on a failed resolve", () => {
    const src = readLib("fetch-and-build-payload.ts");
    const { body } = implementationOf(src, "resolveAndBuild");
    expect(body.match(/payload: null/g) ?? []).toHaveLength(1);
    expect(body).toMatch(/if \(!resolved\.ok\) return \{ payload: null, reason: resolved\.reason/);
    expect(body.match(RETURN_NULL) ?? []).toEqual([]);
    // Both exported builders go through it, and add no null exit of their own.
    for (const name of ["fetchAndBuildPayload", "fetchAndBuildPayloadWithReason"]) {
      const exported = implementationOf(src, name);
      expect(exported.body, name).toContain("resolveAndBuild(id, visibility)");
      expect(exported.body.match(RETURN_NULL) ?? [], name).toEqual([]);
    }
  });

  it("the build past the resolve stage declares a non-null payload and has no null exit", () => {
    const { returnType, body } = implementationOf(readLib("fetch-and-build-payload.ts"), "buildFromResolved");
    expect(returnType).toBe(": Promise<FactsheetPayload>");
    expect(body.match(RETURN_NULL) ?? []).toEqual([]);
    expect(body).toContain("buildFactsheetPayload(");
  });

  it("buildFactsheetPayload keeps exactly its two gates, and its build body declares a non-null payload", () => {
    const src = readLib("build-payload.ts");
    const gate = implementationOf(src, "buildFactsheetPayload");
    expect(gate.body.match(RETURN_NULL) ?? []).toHaveLength(2);
    expect(gate.body).toContain("hasBuildableSeries(dailyReturns)");
    expect(gate.body).toContain("return buildFromBuildableSeries(");
    const build = implementationOf(src, "buildFromBuildableSeries");
    expect(build.returnType).toBe(": FactsheetPayload");
    expect(build.body.match(RETURN_NULL) ?? []).toEqual([]);
    // The overload that makes a BuildableSeries build non-null is still there.
    expect(src).toMatch(/dailyReturns: BuildableSeries,\s*opts\?: BuildFactsheetOpts,\s*\): FactsheetPayload;/);
    expect(src).toMatch(/export function hasBuildableSeries\(rows: DailyReturn\[\]\): rows is BuildableSeries/);
  });
});
