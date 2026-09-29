import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { DailyReturn } from "./types";
import { MTM_DAILY_RETURNS_SERIES_KIND, SMOOTHED_MTM_DAILY_RETURNS_SERIES_KIND } from "@/lib/types";
import { deriveSegmentMarkers } from "./build-payload";
import type { BuildFactsheetOpts } from "./build-payload";
import { BASIS_KPI_MAP, hasBasisHeadline } from "./basis-metrics";
import { captureToSentry } from "@/lib/sentry-capture";
import { attributionBasisFromConfig } from "@/lib/composite/compositeAttribution";
import { isComputedAnalytics, isRankableAnalyticsRow } from "@/lib/closed-sets";

/** The parsed, defensively-coerced form of an `mtm_daily_returns` series row. */
export type ParsedMtmSeries = {
  dailyReturns: DailyReturn[];
  gapSpans: Array<{ start: string; end: string }>;
};

/**
 * Phase 103 (MTM-04, T-103-05) — strict coercion of the untrusted
 * `mtm_daily_returns` JSONB payload (DB → RSC trust boundary) into a
 * {@link ParsedMtmSeries}, or `null` when the shape can't yield an MTM bundle.
 *
 * Mirrors the strict-coercion discipline of {@link singleKeyBasisOpts} /
 * {@link parseDegradedMembers} / `deriveSegmentMarkers`: a malformed/failed
 * series row degrades to "no MTM bundle → charts stay cash" (V5), NEVER a crash
 * or fabricated data. Returns null for:
 *   - a non-object / null / array payload,
 *   - a missing / non-array `rows`,
 *   - fewer than 2 VALID rows (mirrors the build-payload dedup<2 null guard —
 *     the MTM bundle needs ≥2 dated observations, same as cash).
 * Per-row: keep only `{date: string, return: finite number}`, mapping the
 * persisted `return` key to the `DailyReturn.value` field; drop invalid rows.
 * `gap_spans` is coerced defensively (non-array → [], junk entries dropped) — a
 * bad mask never invents interior gaps.
 */
export function parseMtmSeriesPayload(raw: unknown): ParsedMtmSeries | null {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  if (!Array.isArray(obj.rows)) return null;

  const dailyReturns: DailyReturn[] = [];
  for (const row of obj.rows) {
    if (row === null || typeof row !== "object" || Array.isArray(row)) continue;
    const { date, return: ret } = row as { date?: unknown; return?: unknown };
    if (typeof date !== "string" || date.length === 0) continue;
    if (typeof ret !== "number" || !Number.isFinite(ret)) continue;
    dailyReturns.push({ date, value: ret });
  }
  // FIX 4 (IN, mirrors deriveSegmentMarkers build-payload.ts:105-114): a present
  // `rows` array whose entries partially dropped is a malformed persist (the
  // Python writer always emits well-formed rows). Silently coercing loses the
  // signal, so warn — the drop behavior itself is unchanged (recoverable: charts
  // still render the surviving rows / degrade to cash).
  if (dailyReturns.length < obj.rows.length) {
    console.warn("[factsheet] parseMtmSeriesPayload — dropped malformed mtm_daily_returns rows", {
      total: obj.rows.length,
      kept: dailyReturns.length,
      dropped: obj.rows.length - dailyReturns.length,
    });
  }
  // Fewer than 2 valid rows can't build a bundle (build-payload's own dedup<2
  // guard would return null anyway) — degrade to no-bundle here so the gate is
  // structural on the read side.
  if (dailyReturns.length < 2) return null;

  const gapSpans: Array<{ start: string; end: string }> = [];
  if (Array.isArray(obj.gap_spans)) {
    for (const span of obj.gap_spans) {
      if (span === null || typeof span !== "object" || Array.isArray(span)) continue;
      const { start, end } = span as { start?: unknown; end?: unknown };
      if (typeof start !== "string" || typeof end !== "string") continue;
      gapSpans.push({ start, end });
    }
    // Same signal for a present-but-partially-dropped gap_spans array — a bad mask
    // silently losing spans would under-report interior coverage gaps.
    if (gapSpans.length < obj.gap_spans.length) {
      console.warn("[factsheet] parseMtmSeriesPayload — dropped malformed gap_spans entries", {
        total: obj.gap_spans.length,
        kept: gapSpans.length,
        dropped: obj.gap_spans.length - gapSpans.length,
      });
    }
  }
  return { dailyReturns, gapSpans };
}

/**
 * Phase 103 (MTM-04, T-103-06) — read the persisted `mtm_daily_returns` series row
 * for a strategy. `admin` MUST be the service-role handle: `strategy_analytics_series`
 * is deny-all RLS (migration 20260428120919), so ONLY the admin handle reads it —
 * the SAME visibility gate the scalar MTM object already rides (no widening; the
 * caller owns the upstream published/owner gate, exactly as the `csv_daily_returns`
 * read above). A missing or malformed row is a fact about the row and degrades to
 * `null` (charts stay cash, V5).
 *
 * Phase 169 review round 1 (WR-05 / SFH M-3): a FAILED read THROWS
 * {@link CompositeSeriesReadError} with `read: "mtm_daily_returns"`. It used to
 * degrade to `null` too, so the build succeeded without the MTM bundle and the
 * public factsheet cache stored that payload for the whole analytics run: the
 * D-41 class, on a sibling read. The resolve stage answers the throw `read_error`
 * and captures it once for a build; the old "Log at ERROR (→ Sentry)" comment was
 * false (no `console.*` reaches Sentry here: `instrumentation.ts` has no console
 * integration).
 */
export async function readMtmSeries(
  admin: SupabaseClient,
  strategyId: string,
): Promise<ParsedMtmSeries | null> {
  const { data, error } = await admin
    .from("strategy_analytics_series")
    .select("payload")
    .eq("strategy_id", strategyId)
    .eq("kind", MTM_DAILY_RETURNS_SERIES_KIND)
    .maybeSingle();
  if (error) throw new CompositeSeriesReadError(error.code || "none", error.message, "mtm_daily_returns");
  return parseMtmSeriesPayload((data as { payload?: unknown } | null)?.payload);
}

/**
 * Phase 133 (SMTM-01) — the smoothed sibling of {@link parseMtmSeriesPayload}.
 * Reuses the exact rows/gap_spans coercion (so the optional Phase-105 `nan_dates`
 * key is TOLERATED — extra keys are ignored, never a rejection), adding ONE
 * smoothed-specific guard: a PRESENT-but-wrong `basis` literal (e.g. a
 * `mark_to_market` row mistakenly stored under the smoothed kind) → null + warn,
 * so a mislabeled series can never render under the smoothed label (T-131-08).
 */
export function parseSmoothedSeriesPayload(raw: unknown): ParsedMtmSeries | null {
  if (raw !== null && typeof raw === "object" && !Array.isArray(raw)) {
    const basis = (raw as Record<string, unknown>).basis;
    // A present basis MUST be the smoothed literal; anything else is a mislabel we
    // refuse to render (absent basis is tolerated — the shared coercion still applies).
    if (basis !== undefined && basis !== "smoothed_mtm") {
      console.warn("[factsheet] parseSmoothedSeriesPayload — wrong/malformed basis literal; refusing to render a mislabeled series", {
        basis,
      });
      return null;
    }
  }
  return parseMtmSeriesPayload(raw);
}

/**
 * Phase 133 (SMTM-01) — the smoothed sibling of {@link readMtmSeries}: read the
 * persisted `smoothed_mtm_daily_returns` series row. SAME service-role handle +
 * deny-all RLS posture; a missing or malformed row degrades to `null`, and a
 * FAILED read throws {@link CompositeSeriesReadError} with
 * `read: "smoothed_mtm_daily_returns"` (Phase 169 review round 1, WR-05 / SFH
 * M-3, as for MTM); parses through {@link parseSmoothedSeriesPayload}
 * (wrong-basis defensive).
 */
export async function readSmoothedSeries(
  admin: SupabaseClient,
  strategyId: string,
): Promise<ParsedMtmSeries | null> {
  const { data, error } = await admin
    .from("strategy_analytics_series")
    .select("payload")
    .eq("strategy_id", strategyId)
    .eq("kind", SMOOTHED_MTM_DAILY_RETURNS_SERIES_KIND)
    .maybeSingle();
  if (error) {
    throw new CompositeSeriesReadError(error.code || "none", error.message, "smoothed_mtm_daily_returns");
  }
  return parseSmoothedSeriesPayload((data as { payload?: unknown } | null)?.payload);
}

/**
 * Phase 169 (D-41 / R3, routed from 167.2.1 D-07) — the composite's
 * `csv_daily_returns` read FAILED. Thrown by {@link readCompositeFactsheet} so
 * an outage stays distinguishable from a genuinely empty composite (a fact
 * about the row). `code` is the PostgREST / SQLSTATE code, `"none"` when the
 * error carried none. Since review round 1 (CSV-READ-CAP) the paged read also
 * throws it with its own code when it cannot finish: `page_order` (a date that
 * did not follow the cursor), `no_data` (a page with neither rows nor an
 * error) or `row_ceiling` (more than {@link CSV_READ_MAX_ROWS} rows). The
 * message names the table, never the strategy; the PostgREST message rides as
 * `cause` for the catcher's log line.
 *
 * Phase 169 review round 1 (WR-05 / SFH M-3): the persisted MTM and smoothed
 * series reads throw it too, on a composite AND on a single-key strategy, and
 * `read` names which series failed. The class keeps the name of its first case,
 * because the discovery detail page and the resolve stage catch it by class.
 */
export type FactsheetSeriesRead =
  | "csv_daily_returns"
  | "mtm_daily_returns"
  | "smoothed_mtm_daily_returns"
  | typeof CASH_SETTLEMENT_SERIES_KIND;

/**
 * The `strategy_analytics_series.kind` of the persisted cash series row
 * (`basis_series.KIND_CASH_SETTLEMENT` in the analytics service). Read only on a
 * chain-broken single-key row, to name the span its stored headline covers
 * (Phase 169 review round 1, SFH H-1).
 */
const CASH_SETTLEMENT_SERIES_KIND = "cash_settlement" as const;

export class CompositeSeriesReadError extends Error {
  readonly code: string;
  readonly read: FactsheetSeriesRead;
  constructor(code: string, postgrestMessage?: string, read: FactsheetSeriesRead = "csv_daily_returns") {
    super(`factsheet series read failed: ${read} (${code})`, { cause: postgrestMessage });
    this.name = "CompositeSeriesReadError";
    this.code = code;
    this.read = read;
  }
}

/**
 * Phase 169 review round 1 (orchestrator-added CSV-READ-CAP) — rows per
 * `csv_daily_returns` page. PostgREST answers every read with at most its
 * `max_rows` (1000 on hosted Supabase) and says nothing when it cuts: HTTP 200,
 * `error: null`, a partial body.
 */
export const CSV_READ_PAGE_SIZE = 1000;

/**
 * The most `csv_daily_returns` rows one composite read accepts (the flat
 * T-36-03-03 ceiling the single `.limit(20000)` call used to carry). A series
 * longer than this is refused as a read error, never cut to its first rows.
 */
export const CSV_READ_MAX_ROWS = 20_000;

/**
 * Phase 169 review round 1 (orchestrator-added CSV-READ-CAP) — EVERY stored
 * `csv_daily_returns` row of one strategy, ascending by date.
 *
 * The defect this replaces. The read was one `.order("date").limit(20000)` call.
 * PostgREST capped it at 1000 rows, so a composite with more than 1000 days
 * lost its NEWEST days (ascending order keeps the oldest), and the factsheet
 * ended early with nothing on the page saying so. MEASURED on PROD 2026-09-29:
 * one strategy holds 1112 rows.
 *
 * The read here:
 *   - DATE KEYSET pages of {@link CSV_READ_PAGE_SIZE}: each page after the
 *     first asks for `date > <the newest date already read>`. `(strategy_id,
 *     date)` is UNIQUE (migration 20260819120000), so `date` is a total order
 *     under the strategy filter. A keyset is anchored to a date, so a row
 *     written between two pages cannot shift a page boundary and repeat a day,
 *     as an offset (`.range()`) page can (the `benchmark-source.ts` reasoning,
 *     169.2 review WR-03);
 *   - it stops only on an EMPTY page. Stopping on a short page would stop
 *     after the first page against any server whose cap is below the page
 *     size, which is the truncation this function exists to remove;
 *   - a date that does not strictly increase (a server that ignored the
 *     cursor), a page with neither data nor an error, and a series longer
 *     than {@link CSV_READ_MAX_ROWS} each THROW {@link CompositeSeriesReadError}.
 *     Returning what was read so far would hand the builder a partial series
 *     as if it were whole. The resolve stage answers every one of them
 *     `read_error`, which the public factsheet cache never stores (D-41).
 */
async function readCsvDailyReturns(admin: SupabaseClient, strategyId: string): Promise<DailyReturn[]> {
  const rows: DailyReturn[] = [];
  let cursor: string | null = null;
  for (;;) {
    let query = admin.from("csv_daily_returns").select("date, daily_return").eq("strategy_id", strategyId);
    if (cursor !== null) query = query.gt("date", cursor);
    const { data, error } = await query.order("date", { ascending: true }).limit(CSV_READ_PAGE_SIZE);
    if (error) throw new CompositeSeriesReadError(error.code || "none", error.message);
    if (!Array.isArray(data)) {
      throw new CompositeSeriesReadError("no_data", "a page answered neither rows nor an error");
    }
    if (data.length === 0) return rows;
    for (const r of data as Array<{ date: unknown; daily_return: unknown }>) {
      const date = r.date as string;
      if (cursor !== null && !(date > cursor)) {
        throw new CompositeSeriesReadError("page_order", `date ${String(date)} did not follow ${cursor}`);
      }
      rows.push({ date, value: r.daily_return as number });
      cursor = date;
    }
    if (rows.length > CSV_READ_MAX_ROWS) {
      throw new CompositeSeriesReadError("row_ceiling", `more than ${CSV_READ_MAX_ROWS} rows`);
    }
  }
}

/**
 * Round-2 H-2 — the ONE composite read-path (D6, the milestone's "one path"
 * lesson). BOTH surfaces that render the composite factsheet — the canonical
 * `/factsheet/[id]/v2` route AND the discovery detail page
 * (`/discovery/[slug]/[strategyId]`) — route a composite through THIS helper so
 * they can't diverge. Before this existed, the discovery page had no composite
 * branch: a composite (daily_returns NULL, returns_series populated) fell through
 * `deriveIngestSource` → "api" → invented PeerPercentile / AllocatorSection /
 * EventSignatures panels + a dense-0.0-gap-filled series drawing flat-zero gap
 * lines (the exact D6 failure the factsheet route already fixed).
 *
 * Responsibilities (identical to the factsheet route's former inline block):
 *   - Read the honest SPARSE cash series from `csv_daily_returns` (gap days
 *     ABSENT, never zero-filled), every row, in date-keyset pages
 *     ({@link readCsvDailyReturns}). A read failure THROWS
 *     {@link CompositeSeriesReadError} with its PostgREST / SQLSTATE code
 *     (Phase 169, D-41), so no caller can take an outage for an empty
 *     composite: the factsheet resolve stage answers it `read_error`, which the
 *     public factsheet cache never stores. Never the api arm.
 *   - F1/H-1 gate: refuse to render when the persisted `cash_settlement` lacks a
 *     trustworthy headline (returns null → placeholder); a degenerate-but-valid
 *     composite renders (strict overlay shows null scalars as "—").
 *   - C-1: resolve the cumulative method from `returns_denominator_config`
 *     (arithmetic only for the "simple"/allocated-capital override; geometric
 *     mainline).
 *   - F2/M-1 MTM gate + FS-01/FS-02 markers threading.
 *
 * Data-access: `admin` MUST be the service-role handle. `csv_daily_returns` has
 * service_role/owner/admin RLS only (migration 20260522111839), so the admin
 * handle is the ONLY client that can read it. The CALLER is responsible for the
 * upstream published-factsheet visibility gate (the factsheet route's RLS
 * signature probe; the discovery page's `discovery_categories!inner` + auth) —
 * this helper does NOT widen visibility, it only reads the sparse series for a
 * strategy the caller already authorized.
 *
 * The caller MUST force `ingestSource: "csv"` on the buildFactsheetPayload call
 * (composites never take the invented api arm) and pass the returned `buildOpts`.
 *
 * @returns `{ dailyReturns, buildOpts }`, or `null` when the composite is a data
 *          defect (missing/untrusted cash headline) → caller renders placeholder.
 * @throws {CompositeSeriesReadError} when the `csv_daily_returns` read FAILS
 *          (an outage, never a fact about the row), so no caller can take it
 *          for an empty composite (Phase 169, D-41), and, since review round 1
 *          (WR-05), when a gated MTM or smoothed series read fails.
 */
export async function readCompositeFactsheet(
  admin: SupabaseClient,
  input: {
    strategyId: string;
    dqf:
      | {
          composite?: unknown;
          mtm_gated_reason?: unknown;
          per_key?: unknown;
          gap_spans?: unknown;
          insufficient_window?: unknown;
          degraded_members?: unknown;
          cumulative_method?: unknown;
        }
      | null
      | undefined;
    metricsJsonByBasis: unknown;
    returnsDenominatorConfig: unknown;
  },
): Promise<{ dailyReturns: DailyReturn[]; buildOpts: BuildFactsheetOpts } | null> {
  const { strategyId, dqf, metricsJsonByBasis, returnsDenominatorConfig } = input;

  // F3 / Phase 169 (D-41, routed from 167.2.1 D-07): a composite depends
  // ENTIRELY on this sparse read, and a failed read is an OUTAGE, not a fact
  // about the row. It used to be logged here and mapped to an empty series,
  // which the resolve stage answered `composite_unbuildable` and the public
  // factsheet cache stored for the whole analytics run. It now throws, so no
  // caller can take it for an empty composite; each catcher logs it (the
  // resolve stage in `fetch-and-build-payload.ts` answers `read_error` with
  // the code and captures a build once). Still never the api arm.
  const dailyReturns = await readCsvDailyReturns(admin, strategyId);

  const metricsByBasis = (metricsJsonByBasis ?? undefined) as
    | BuildFactsheetOpts["metricsByBasis"]
    | undefined;

  // F1/H-1: refuse an untrusted headline (still-computing placeholder). A
  // degenerate-but-valid composite (finite cumulative_return, some scalar null)
  // passes and renders with an honest "—".
  if (!hasBasisHeadline(metricsByBasis?.cash_settlement)) {
    console.error(
      "[factsheet] composite missing persisted cash_settlement headline — refusing to render an untrusted headline",
      { strategyId },
    );
    return null;
  }

  // C-1 / HARD-03 (#69, Phase-90 LOW-2): cumulation basis precedence —
  //   1. the PERSISTED method frozen into `data_quality_flags.cumulative_method`
  //      at stitch (Task 1), which matches the headline compute BY CONSTRUCTION;
  //   2. else the LIVE re-derive from returns_denominator_config (older composites
  //      with no persisted key — self-heals on next re-stitch, HARD-04 precedent).
  // Preferring the persisted value kills the chart↔headline drift an owner could
  // trigger by editing the config after publish without re-stitching. The
  // "simple"→"arithmetic" map is the SAME single rule `attributionBasisFromConfig`
  // encodes, applied to the RAW worker vocabulary — persisted and fallback can't
  // diverge. Strict-literal coercion (only the exact strings "simple"/"geometric"
  // honored; anything else falls back) mirrors the `=== true` server-truth
  // discipline in this file (T-92-05).
  const persisted = dqf?.cumulative_method;
  // HARD-03 hardening (Phase 93.1): an UNEXPECTED persisted value — PRESENT but
  // neither "simple" nor "geometric" — silently re-derives below, re-opening the
  // exact chart↔headline drift HARD-03 closes, with ZERO signal. It is unreachable
  // for correctly-written current data (the worker persists only the two RAW
  // literals at :3868), so surface it LOUD before the (preserved) live fallback.
  // Absent/null stays SILENT — that is the legitimate older-composite fallback
  // (no persisted key), not a defect. Warn-level per the sibling malformed-input
  // convention in build-payload.ts (deriveSegmentMarkers): recoverable, not Sentry.
  if (
    persisted !== null &&
    persisted !== undefined &&
    persisted !== "simple" &&
    persisted !== "geometric"
  ) {
    console.warn(
      "[factsheet] readCompositeFactsheet — unexpected persisted cumulative_method; falling back to live re-derive",
      { strategyId, persisted },
    );
  }
  const cumulativeMethod =
    persisted === "simple"
      ? "arithmetic"
      : persisted === "geometric"
        ? "geometric"
        : attributionBasisFromConfig(returnsDenominatorConfig);
  // F2/M-1: MTM enabled iff the mark_to_market basis is present with a finite
  // headline (locked D1 intent); the strict overlay renders degenerate scalars "—".
  const mtmAvailable = hasBasisHeadline(
    (metricsByBasis as { mark_to_market?: unknown } | undefined)?.mark_to_market,
  );
  // Phase 133 (SMTM-01): the smoothed sibling of the MTM gate — available iff the
  // persisted `smoothed_mtm` basis carries a trustworthy headline. On an options book
  // this OPENS what the MTM gate honestly keeps closed (unsmoothed_options_book).
  const smoothedAvailable = hasBasisHeadline(
    (metricsByBasis as { smoothed_mtm?: unknown } | undefined)?.smoothed_mtm,
  );
  const markers = deriveSegmentMarkers(dqf);

  // MTM-04 (Phase 103): read the persisted MTM daily series ONLY when the scalar
  // MTM basis is available (skip the extra roundtrip for every non-MTM composite);
  // thread it so buildFactsheetPayload emits the per-basis bundle. Gated exactly
  // like the scalar MTM object — the series rides the SAME published/owner + F2/M-1
  // gate, no visibility widening. A malformed row degrades to no-bundle; a FAILED
  // read throws CompositeSeriesReadError (Phase 169 review round 1, WR-05), which
  // propagates out of this reader like the csv read's.
  // Phase 133 (SMTM-01): read the persisted smoothed series ONLY when the scalar
  // smoothed gate is available (skip the roundtrip otherwise) — same gating as MTM.
  // The two reads are independent; fire them concurrently (each still gated so a
  // skipped read stays skipped — resolves to null without a roundtrip).
  const [mtmSeries, smoothedSeries] = await Promise.all([
    mtmAvailable ? readMtmSeries(admin, strategyId) : Promise.resolve(null),
    smoothedAvailable ? readSmoothedSeries(admin, strategyId) : Promise.resolve(null),
  ]);

  return {
    dailyReturns,
    buildOpts: {
      cumulativeMethod,
      segmentBoundaries: markers.segmentBoundaries,
      missingSegments: markers.missingSegments,
      metricsByBasis,
      ...(mtmSeries ? { mtmSeries } : {}),
      ...(smoothedSeries ? { smoothedSeries } : {}),
      // HARD-04 (#67): server-truth short-window flag. Strict `=== true`
      // coercion so a malformed dqf value (string/object) can never render the
      // caveat (T-92-05).
      dataQuality: {
        composite: true,
        insufficientWindow: dqf?.insufficient_window === true,
        // HARD-05 (Phase 93): strict-coerce the degraded-member records. Malformed
        // jsonb (string / non-object entries / missing seq/venue) yields [] so junk
        // renders nothing (T-92-05 / T-93-03-02). The server `reason` enum is dropped
        // — the components own the user copy.
        degradedMembers: parseDegradedMembers(dqf?.degraded_members),
      },
      mtmGate: {
        available: mtmAvailable,
        reason: typeof dqf?.mtm_gated_reason === "string" ? dqf.mtm_gated_reason : undefined,
      },
      // Phase 133 (SMTM-01): the smoothed gate. There is no persisted smoothed-reason
      // column (the worker only persists the smoothed key on a completed pass), so the
      // disabled reason is the single closed-set default — never a per-row invention.
      smoothedGate: {
        available: smoothedAvailable,
        reason: smoothedAvailable ? undefined : "smoothed_basis_unavailable",
      },
    },
  };
}

/**
 * HARD-04 (#67) — the SINGLE-KEY counterpart of the composite `dataQuality` opt
 * built in `readCompositeFactsheet` above. A single-key strategy persists
 * `insufficient_window` — computed at the CAGR site in `metrics.compute_all_metrics`
 * and carried on the `MetricsResult.insufficient_window` FIELD, then lifted into
 * `data_quality_flags` by both runners: the `HARD-04` lift in
 * `analytics_runner.run_csv_strategy_analytics` and its mirror in
 * `job_worker.run_stitch_composite_job` — exactly like a
 * composite, but has NO composite read-path to thread it. Finding B: because the
 * factsheet route (`/factsheet/[id]/v2`) and the discovery detail page
 * (`/discovery/[slug]/[strategyId]`) each assigned `buildOpts` ONLY on their
 * composite arm, a single-key sub-90-day track record built `buildOpts=undefined`
 * → `payload.dataQuality` undefined → the FactsheetView :876 caveat NEVER rendered
 * single-key, despite the server truth being persisted (with a passing lift test).
 *
 * Both surfaces now derive the single-key opt from THIS ONE owner — mirroring the
 * composite "one path" lesson (this file's header) so the two FactsheetView
 * consumers can't diverge on a future DQ flag. `composite: false` is behaviorally
 * identical to an absent `dataQuality` for every `=== true` composite reader
 * (FactsheetView :331/:393/:724/:1048), so this adds the caveat WITHOUT touching
 * the composite branch. Strict `=== true` server-truth coercion mirrors the
 * composite path so a malformed dqf value can never render the caveat (T-92-05).
 */
export function singleKeyDataQuality(
  dqf: { insufficient_window?: unknown; twr_chain_broken?: unknown } | null | undefined,
): NonNullable<BuildFactsheetOpts["dataQuality"]> {
  return {
    composite: false,
    insufficientWindow: dqf?.insufficient_window === true,
    // Phase 169 review round 1 (SFH H-1): present only when true, with the same
    // strict `=== true` coercion, so a clean row's opt is unchanged.
    ...(dqf?.twr_chain_broken === true ? { twrChainBroken: true } : {}),
  };
}

/**
 * Phase 169 review round 1 (SFH H-1) — the first day of the span a chain-broken
 * single-key headline covers, read from the stored `cash_settlement` series row
 * payload, or `null` when the stored data cannot name it.
 *
 * Python compounds the stored `cumulative_return` and annualizes the CAGR over
 * `nav_twr._last_interior_break_suffix`: the maximal run of valid days that ends
 * at the last one, i.e. everything after the LAST interior break. On the broker
 * path the runner reindexes the series to a dense daily calendar, so a refused
 * (guard) day is NaN, and `basis_series.derive_basis_series` persists the finite
 * days as `rows` and every absent in-span day as `gap_spans`, echoing
 * `conventions.densify = "broker_nan"`. Under that echo an absent day can only be
 * a refused one, so the covered span starts at the first stored day after the
 * last gap span: the same day, from the stored data, not a recomputation.
 *
 * Any other echo cannot name it, and the answer is `null`, never a guess: a
 * `"sparse"` (user CSV) series is absent on weekends and holidays too, and a row
 * written before Phase 105 echoes nothing. No gap, or no stored day after the
 * last gap, is `null` as well.
 */
export function deriveHeadlineCoversFrom(raw: unknown): string | null {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const payload = raw as { rows?: unknown; gap_spans?: unknown; conventions?: unknown };
  const conventions = payload.conventions as { densify?: unknown } | null | undefined;
  if (conventions === null || typeof conventions !== "object" || conventions.densify !== "broker_nan") return null;
  if (!Array.isArray(payload.gap_spans) || !Array.isArray(payload.rows)) return null;
  let lastGapEnd: string | null = null;
  for (const span of payload.gap_spans) {
    const end = (span as { end?: unknown } | null)?.end;
    if (typeof end === "string" && (lastGapEnd === null || end > lastGapEnd)) lastGapEnd = end;
  }
  if (lastGapEnd === null) return null;
  let start: string | null = null;
  for (const row of payload.rows) {
    const date = (row as { date?: unknown } | null)?.date;
    if (typeof date === "string" && date > lastGapEnd && (start === null || date < start)) start = date;
  }
  return start;
}

/**
 * Phase 169 review round 1 (SFH H-1) — read the stored `cash_settlement` series
 * row of a single-key strategy and name the span its headline covers. Same
 * service-role handle and deny-all RLS posture as {@link readMtmSeries}. A missing
 * row is a fact (`null`); a FAILED read throws {@link CompositeSeriesReadError}
 * (`read: "cash_settlement"`), so an outage is never rendered as "the span cannot
 * be named".
 */
async function readHeadlineCoversFrom(admin: SupabaseClient, strategyId: string): Promise<string | null> {
  const { data, error } = await admin
    .from("strategy_analytics_series")
    .select("payload")
    .eq("strategy_id", strategyId)
    .eq("kind", CASH_SETTLEMENT_SERIES_KIND)
    .maybeSingle();
  if (error) throw new CompositeSeriesReadError(error.code || "none", error.message, CASH_SETTLEMENT_SERIES_KIND);
  return deriveHeadlineCoversFrom((data as { payload?: unknown } | null)?.payload);
}

/**
 * Phase 102 (MTM-01) — the SINGLE-KEY counterpart of the composite `mtmGate`
 * assembly built inline in {@link readCompositeFactsheet} (:167-170). A single-key
 * options strategy persists its MTM basis into `metrics_json_by_basis.mark_to_market`
 * (Phase 101) plus a surviving `data_quality_flags.mtm_gated_reason` on honest
 * degrade, but — like the Finding-B `insufficient_window` flag — the single-key arm
 * of both factsheet surfaces never threaded it. This is the ONE owner both surfaces
 * (the `/factsheet/[id]/v2` route + the discovery detail page) delegate to, so they
 * can't diverge (the "one path" lesson, this file's header).
 *
 * Two load-bearing invariants (falsifiable in composite-read-path.test.ts):
 *   - F-4 (T-102-01): `available` is gated on `computationStatus ∈ {complete,
 *     complete_with_warnings}` — the EXACT terminal-success literals the runner
 *     writes (the `csv_status` assignment in
 *     `analytics_runner.run_csv_strategy_analytics`; the same pair the PDF route
 *     admits — grep `complete_with_warnings` in
 *     `src/app/api/factsheet/[id]/pdf/route.ts`).
 *     A failed/computing
 *     row NEVER exposes a live-looking MTM object: `metricsByBasis` is threaded
 *     ONLY when `available`, so the payload is structurally MTM-free otherwise.
 *   - SC-4 (T-102-SC keystone): thread ONLY the by-basis MTM keys, NEVER the raw
 *     `metrics_json_by_basis` column. A lingering raw `cash_settlement` key (a
 *     composite→single stale window; 101-01 "Observed-but-out-of-scope #1") would
 *     activate `buildFactsheetPayload`'s cash overlay with numbers no current run
 *     vouches for. The single-key `cash_settlement` key a payload DOES carry since
 *     Phase 169 (SC4, D-10) is BUILT by {@link readSingleKeyBasisOpts} from the
 *     row's persisted top-level scalars when the row is rankable; this function
 *     never produces it.
 *
 * Returns `{}` for every non-options single-key strategy (no MTM key AND no reason)
 * so the basis toggle never renders.
 * Defensive on unknown jsonb, mirroring the strict-coercion style of this file.
 */
export function singleKeyBasisOpts(
  dqf: { mtm_gated_reason?: unknown } | null | undefined,
  metricsJsonByBasis: unknown,
  computationStatus: unknown,
  mtmSeries?: ParsedMtmSeries | null,
  smoothedSeries?: ParsedMtmSeries | null,
): Pick<BuildFactsheetOpts, "metricsByBasis" | "mtmGate" | "mtmSeries" | "smoothedGate" | "smoothedSeries"> {
  // Extract a non-null non-array by-basis object under `key` from the untrusted jsonb.
  const extractBasisObject = (key: string): Record<string, number | null> | undefined => {
    if (
      metricsJsonByBasis !== null &&
      typeof metricsJsonByBasis === "object" &&
      !Array.isArray(metricsJsonByBasis)
    ) {
      const cand = (metricsJsonByBasis as Record<string, unknown>)[key];
      if (cand !== null && typeof cand === "object" && !Array.isArray(cand)) {
        return cand as Record<string, number | null>;
      }
    }
    return undefined;
  };
  // 1. Extract the persisted mark_to_market + smoothed_mtm objects.
  const mtm = extractBasisObject("mark_to_market");
  const smoothed = extractBasisObject("smoothed_mtm");
  // 2. Extract the reason iff a string (same server-truth coercion as :169).
  const reason = typeof dqf?.mtm_gated_reason === "string" ? dqf.mtm_gated_reason : undefined;
  // 3. MEDIUM-2 (plan-check): the early return now checks ALL THREE by-basis signals.
  //    Returning {} ONLY when mtm, reason, AND smoothed are absent keeps every
  //    non-options single-key path byte-identical (such rows have none of the three),
  //    while a {smoothed_mtm}-only row (MTM degraded reason-lessly) is NO LONGER
  //    silently dropped — it flows through to a constructed gate/metrics/series.
  if (mtm === undefined && reason === undefined && smoothed === undefined) return {};
  // Structural consequence: past this point the gates are ALWAYS constructed, so a
  // payload with ANY by-basis story carries mtmGate — which is what lets
  // FactsheetView's toggle-availability predicate (`payload.mtmGate != null`) stay
  // unwidened while still rendering the toggle for the {smoothed_mtm}-only edge.
  //
  // 4. F-4 DONE gate — exact runner terminal-success literals (no third success
  //    literal exists; verified against analytics_runner.py).
  const done = isComputedAnalytics(computationStatus as string | null | undefined);
  // 5. Available iff DONE and the object carries a trustworthy headline. A degraded
  //    row still reports "complete" (Phase 101-02), so BOTH gates apply per basis.
  const available = done && hasBasisHeadline(mtm);
  const smoothedAvailable = done && hasBasisHeadline(smoothed);
  // 6. Thread ONLY the available by-basis keys (F-4 structural: a failed row's payload
  //    carries NO by-basis object), and NEVER the raw jsonb's cash_settlement key
  //    (SC-4). The single-key cash key is built from the persisted top-level scalars
  //    by readSingleKeyBasisOpts, only for a rankable row (Phase 169, D-10).
  const metricsByBasis: NonNullable<BuildFactsheetOpts["metricsByBasis"]> = {};
  if (available && mtm) metricsByBasis.mark_to_market = mtm;
  if (smoothedAvailable && smoothed) metricsByBasis.smoothed_mtm = smoothed;
  const hasAnyBasisScalars = Object.keys(metricsByBasis).length > 0;
  // 7. Thread the persisted daily series ONLY when the matching basis is available AND
  //    the reader returned a parsed series (each rides its own F-4 gate). Omitted (not
  //    undefined) when absent so the SILENT-1 empty-result path stays byte-identical.
  return {
    metricsByBasis: hasAnyBasisScalars ? metricsByBasis : undefined,
    mtmGate: { available, reason },
    // No persisted smoothed-reason column exists (see FactsheetCommon.smoothedGate) —
    // the disabled reason is the single closed-set default.
    smoothedGate: {
      available: smoothedAvailable,
      reason: smoothedAvailable ? undefined : "smoothed_basis_unavailable",
    },
    ...(available && mtmSeries ? { mtmSeries } : {}),
    ...(smoothedAvailable && smoothedSeries ? { smoothedSeries } : {}),
  };
}

/**
 * Phase 133 review (WR-01/WR-02) — the ONE single-key basis ASSEMBLY both
 * FactsheetView surfaces (`/factsheet/[id]/v2` + `/discovery/[slug]/[strategyId]`)
 * call. It owns the WHOLE single-key basis story end-to-end: the cheap
 * should-read predicates → the gated `mtm_daily_returns` / `smoothed_mtm_daily_returns`
 * roundtrips → the {@link singleKeyBasisOpts} gate/scalar/series threading.
 *
 * Why it exists: {@link singleKeyBasisOpts} alone is only the LAST step; each page
 * used to inline the predicate+read steps itself, and when Phase 133 added the
 * smoothed sibling the discovery page's inline copy silently kept the old 4-arg
 * call — the Smoothed segment rendered ENABLED there while its charts stayed cash
 * PERMANENTLY (WR-01). With the assembly hoisted here, a page cannot thread the
 * scalars without the series: the two surfaces are identical by construction, and
 * a future fourth basis lands on both pages automatically.
 *
 * `getAdmin` is a thunk (not a client) so the hot non-options path — no by-basis
 * object, or not DONE — never even CONSTRUCTS the service-role handle (preserving
 * the discovery page's lazy `createAdminClient()` posture, byte-identical). It is
 * memoized: at most ONE handle is created per call regardless of how many basis
 * series are read. The handle MUST be service-role: `strategy_analytics_series` is
 * deny-all RLS (see {@link readMtmSeries}); the caller owns the upstream
 * published/owner visibility gate, exactly as before the hoist.
 *
 * Phase 169 (SC4, D-10, D-25: "calculate Sharpe once; every page reads it") — the
 * single-key arm now ALSO overlays the persisted headline, so the factsheet's CAGR
 * and Sharpe agree with discovery, recommendations and my-strategies, which read
 * the same stored `strategy_analytics` scalars. `persistedRow` is the analytics row
 * the caller already holds; its seven {@link BASIS_KPI_MAP} top-level scalars become
 * `metricsByBasis.cash_settlement` (values as persisted, a null kept as null so the
 * strict overlay renders "—"), which `buildFactsheetPayload` overlays exactly as it
 * does for a composite. See {@link persistedCashHeadline} for the gates: the row must
 * be rankable (`isRankableAnalyticsRow`, the predicate recommendations uses), because
 * a failed run leaves the previous run's scalars behind and they must not render.
 * The factsheet resolve stage's G1 gate already refuses a non-computed row, so the
 * not-rankable arm is reached from the discovery detail page only, until Phase 169.1
 * plan 169.1-01 moves that page onto the shared build. It adds no read for a clean
 * row, so the admin thunk posture above is unchanged there; a chain-broken row
 * (review round 1, SFH H-1) reads its stored `cash_settlement` series once, to name
 * the span its headline covers, and returns `dataQuality` with that start date.
 * Omitting `persistedRow` keeps the pre-169 result.
 *
 * Review round 1 (SFH H-2): `returnsDenominatorConfig` is the strategy's
 * `returns_denominator_config`. The Python single-key runner computes the stored
 * headline under it (a `simple` config stores the SUM of the returns, with an
 * arithmetic CAGR and drawdown), so the curve must be drawn on the same method or
 * the stored "Since Inception" and the equity curve drift apart with every period.
 * The method is resolved with the composite's own rule
 * ({@link attributionBasisFromConfig}: arithmetic only for `simple`), and returned as
 * `cumulativeMethod` only when it is arithmetic, so a geometric strategy's opts are
 * unchanged. Omitting the config keeps the geometric default; the discovery detail
 * page does not pass it yet (reported to its owner, until 169.1-01).
 *
 * `options.captureDefects` (default true) decides whether the persisted-headline
 * defects below reach Sentry (review round 1, WR-01 / SFH M-1 / SFH H-1). They are
 * always logged. The factsheet resolve stage passes `false` for a probe: /strategies
 * probes every computed row on every load, and a per-row capture there is the
 * event storm 167.2.1-REVIEW-R2 WR-01 removed. A build captures once.
 *
 * @throws {CompositeSeriesReadError} when a gated MTM or smoothed series read FAILS
 *          (review round 1, WR-05); the factsheet resolve stage answers it `read_error`.
 */
export async function readSingleKeyBasisOpts(
  getAdmin: () => SupabaseClient,
  strategyId: string,
  dqf:
    | { mtm_gated_reason?: unknown; insufficient_window?: unknown; twr_chain_broken?: unknown }
    | null
    | undefined,
  metricsJsonByBasis: unknown,
  computationStatus: unknown,
  persistedRow?: Record<string, unknown> | null,
  returnsDenominatorConfig?: unknown,
  options: { captureDefects?: boolean } = {},
): Promise<
  Pick<
    BuildFactsheetOpts,
    | "metricsByBasis"
    | "mtmGate"
    | "mtmSeries"
    | "smoothedGate"
    | "smoothedSeries"
    | "cumulativeMethod"
    | "dataQuality"
  >
> {
  let admin: SupabaseClient | undefined;
  const resolveAdmin = () => (admin ??= getAdmin());
  // MTM-04 (Phase 103): read the persisted MTM series only when the SHARED cheap
  // predicate holds — a malformed row degrades to no-bundle (charts stay cash); a
  // FAILED read throws CompositeSeriesReadError (Phase 169 review round 1, WR-05).
  // Phase 133 (SMTM-01): the smoothed sibling read, identically gated. The two reads
  // are independent; fire them concurrently (each still gated so a skipped read stays
  // skipped — resolves to null without a roundtrip). resolveAdmin memoizes
  // synchronously, so a shared client is created at most once.
  const [mtmSeries, smoothedSeries] = await Promise.all([
    shouldReadSingleKeyMtmSeries(metricsJsonByBasis, computationStatus)
      ? readMtmSeries(resolveAdmin(), strategyId)
      : Promise.resolve(null),
    shouldReadSingleKeySmoothedSeries(metricsJsonByBasis, computationStatus)
      ? readSmoothedSeries(resolveAdmin(), strategyId)
      : Promise.resolve(null),
  ]);
  const basisOpts = singleKeyBasisOpts(dqf, metricsJsonByBasis, computationStatus, mtmSeries, smoothedSeries);
  const arithmetic = attributionBasisFromConfig(returnsDenominatorConfig) === "arithmetic";
  const opts = arithmetic ? { ...basisOpts, cumulativeMethod: "arithmetic" as const } : basisOpts;
  // `dataQuality` is returned ONLY when this owner has something to add to it: it is
  // the single-key opt both callers already set from `singleKeyDataQuality(dqf)` and
  // spread this result over, so a clean row's opts stay unchanged.
  const addedQuality: Partial<NonNullable<BuildFactsheetOpts["dataQuality"]>> = {};
  // Review round 1 (SFH M-2): the stored headline was computed under a returns
  // convention TypeScript does not reproduce (a `simple` sum, or an active-day
  // Sharpe and volatility; `compute()` has no active-day basis). The client
  // leverage re-derive could not continue it from L=1, so the payload says so and
  // `leverageEligibleFor` withholds the what-if, as it does for a composite.
  if (arithmetic || activeDayMetricsBasis(returnsDenominatorConfig)) addedQuality.returnsConventionOverride = true;
  const captureDefects = options.captureDefects ?? true;
  const cashHeadline = persistedCashHeadline(
    strategyId,
    persistedRow,
    metricsJsonByBasis,
    computationStatus,
    captureDefects,
  );
  const withHeadline = cashHeadline
    ? { ...opts, metricsByBasis: { ...(opts.metricsByBasis ?? {}), cash_settlement: cashHeadline } }
    : opts;
  // Review round 1 (SFH H-1): on a chain-broken row the stored headline covers only
  // the stretch after the last break, and it is still the value shown (D-25, SC4).
  // Name the start of that span from the stored cash series, so the page can say it.
  if (cashHeadline && dqf?.twr_chain_broken === true) {
    const headlineCoversFrom = await readHeadlineCoversFrom(resolveAdmin(), strategyId);
    if (headlineCoversFrom === null) {
      console.warn(
        "[factsheet] readSingleKeyBasisOpts — a chain-broken headline's covered span cannot be named from the stored cash series",
        { strategyId },
      );
      if (captureDefects) {
        captureToSentry(new Error("factsheet: chain-broken headline span cannot be named"), {
          level: "warning",
          tags: { stage: "factsheet-persisted-headline", reason: "covered_span_unnamed", strategy_id: strategyId },
        });
      }
    }
    addedQuality.headlineCoversFrom = headlineCoversFrom;
  }
  if (Object.keys(addedQuality).length === 0) return withHeadline;
  return { ...withHeadline, dataQuality: { ...singleKeyDataQuality(dqf), ...addedQuality } };
}

/**
 * Review round 1 (SFH M-2) — the `returns_denominator_config` asks for active-day
 * risk metrics (`metrics_basis: "active_day"`, the analytics service's
 * `metrics_day_basis` → `active`): volatility, Sharpe and Sortino over non-zero
 * days only. Strict literal match, as {@link attributionBasisFromConfig} is.
 */
function activeDayMetricsBasis(raw: unknown): boolean {
  return (
    raw !== null &&
    typeof raw === "object" &&
    (raw as { metrics_basis?: unknown }).metrics_basis === "active_day"
  );
}

/**
 * Phase 169 (SC4, D-10) — the single-key `cash_settlement` headline, BUILT from the
 * analytics row's persisted top-level scalars. Returns `undefined` (the caller keeps
 * the TypeScript headline, as before Phase 169) when:
 *   - no row was passed;
 *   - the row is not rankable: a `failed` or `computing` row still carries the
 *     previous run's scalars, and rendering them is the STALE-01 class;
 *   - the raw `metrics_json_by_basis` already carries a `cash_settlement` object: a
 *     lingering composite→single key (SC-4 in {@link singleKeyBasisOpts}). D-10 applies
 *     the persisted headline only where that key is absent, and the raw object itself
 *     is never threaded. It is warned with the strategy id (SFH M-1);
 *   - the row does not carry the seven {@link BASIS_KPI_MAP} keys: a caller whose select
 *     stopped projecting them would otherwise overlay seven em-dashes. That is a code
 *     defect, so it is logged with `reason: "missing_keys"` and the missing keys, and
 *     captured to Sentry (`console.*` does not reach Sentry in this repo).
 *
 * Review round 1 (WR-01 / SFH M-1): the gate is STRUCTURAL only. It used to be
 * {@link hasBasisHeadline}, which also needs a finite `cumulative_return`, so a
 * rankable row storing a null one (Python `_safe_float` persists null for a
 * non-finite value) fell back to the whole TypeScript headline, CAGR and Sharpe
 * included, while the lists show the stored values: the SC4 split D-25 removes. It
 * logged that refusal with `missing: []`, naming nothing. Now a stored null renders
 * "—" under the strict overlay, as the lists do; a rankable row storing no finite
 * `cumulative_return` is a data defect and is warned and captured at `warning` with
 * the non-finite keys. A lone null `sortino` / `calmar` (no losing day, no drawdown)
 * is legitimate and is neither warned nor captured. The discovery detail page runs
 * this per request (it is not cached), so a defective row captures on each of its
 * views there until Phase 169.1 plan 169.1-01 moves that page onto the shared build.
 */
function persistedCashHeadline(
  strategyId: string,
  persistedRow: Record<string, unknown> | null | undefined,
  metricsJsonByBasis: unknown,
  computationStatus: unknown,
  captureDefects: boolean,
): Record<string, number | null> | undefined {
  if (persistedRow == null) return undefined;
  if (!isRankableAnalyticsRow({ computation_status: computationStatus as string | null | undefined })) {
    return undefined;
  }
  if (metricsJsonByBasis !== null && typeof metricsJsonByBasis === "object" && !Array.isArray(metricsJsonByBasis)) {
    const rawCash = (metricsJsonByBasis as Record<string, unknown>).cash_settlement;
    if (rawCash !== null && typeof rawCash === "object" && !Array.isArray(rawCash)) {
      console.warn(
        "[factsheet] readSingleKeyBasisOpts — a single-key row carries a raw metrics_json_by_basis.cash_settlement object; keeping the computed headline",
        { strategyId },
      );
      return undefined;
    }
  }
  const missing = BASIS_KPI_MAP.filter(({ serverKey }) => !(serverKey in persistedRow)).map((k) => k.serverKey);
  if (missing.length > 0) {
    console.error(
      "[factsheet] readSingleKeyBasisOpts — the analytics select did not project the persisted headline; keeping the computed one",
      { strategyId, reason: "missing_keys", missing },
    );
    if (captureDefects) {
      captureToSentry(new Error("factsheet: persisted headline not projected (missing_keys)"), {
        tags: { stage: "factsheet-persisted-headline", reason: "missing_keys", strategy_id: strategyId },
        extra: { missing },
      });
    }
    return undefined;
  }
  const cumulativeReturn = persistedRow.cumulative_return;
  if (typeof cumulativeReturn !== "number" || !Number.isFinite(cumulativeReturn)) {
    const nonFinite = BASIS_KPI_MAP.filter(({ serverKey }) => {
      const v = persistedRow[serverKey];
      return typeof v !== "number" || !Number.isFinite(v);
    }).map((k) => k.serverKey);
    console.warn(
      "[factsheet] readSingleKeyBasisOpts — a rankable row stores no finite cumulative_return; its headline renders the em-dash there",
      { strategyId, reason: "non_finite_cumulative_return", computationStatus, nonFinite },
    );
    if (captureDefects) {
      captureToSentry(new Error("factsheet: rankable row stores a non-finite cumulative_return"), {
        level: "warning",
        tags: { stage: "factsheet-persisted-headline", reason: "non_finite_cumulative_return", strategy_id: strategyId },
        extra: { computationStatus, nonFinite },
      });
    }
  }
  // Review round 1 (IN-02): typed as it is, `number | null`, with no cast. A
  // persisted null (a stored Sortino with no losing day) stays null on purpose,
  // and the strict overlay renders it "—", as the lists do. A value PostgREST
  // did not answer as a number is carried as null, which the overlay renders
  // the same way.
  const headline: Record<string, number | null> = {};
  for (const { serverKey } of BASIS_KPI_MAP) {
    const v = persistedRow[serverKey];
    headline[serverKey] = typeof v === "number" ? v : null;
  }
  return headline;
}

/**
 * Phase 103 (MTM-04) — the cheapest honest predicate deciding whether a single-key
 * strategy should incur the `mtm_daily_returns` DB roundtrip. Mirrors
 * {@link singleKeyBasisOpts}' F-4 gate: the raw `metrics_json_by_basis` carries a
 * `mark_to_market` OBJECT AND `computation_status` is DONE. Both factsheet surfaces
 * (the `/factsheet/[id]/v2` route + the discovery detail page) call THIS one
 * predicate so they can't diverge on when to read (the "one path" lesson).
 *
 * It is deliberately CHEAPER than the full `hasBasisHeadline` gate: a degenerate
 * mark_to_market object (present key, no finite headline) may pass here and waste
 * ONE read — but `singleKeyBasisOpts` still applies the full `available` gate
 * before threading, so a false-positive here NEVER leaks a bundle. This keeps the
 * hot non-options path (no mark_to_market key, or not DONE) roundtrip-free.
 */
export function shouldReadSingleKeyMtmSeries(
  metricsJsonByBasis: unknown,
  computationStatus: unknown,
): boolean {
  const done = isComputedAnalytics(computationStatus as string | null | undefined);
  if (!done) return false;
  if (
    metricsJsonByBasis === null ||
    typeof metricsJsonByBasis !== "object" ||
    Array.isArray(metricsJsonByBasis)
  ) {
    return false;
  }
  const mtm = (metricsJsonByBasis as Record<string, unknown>).mark_to_market;
  return mtm !== null && typeof mtm === "object" && !Array.isArray(mtm);
}

/**
 * Phase 133 (SMTM-01) — the smoothed sibling of {@link shouldReadSingleKeyMtmSeries}:
 * the cheap DONE + `smoothed_mtm`-object predicate deciding whether to incur the
 * `smoothed_mtm_daily_returns` DB roundtrip. Same cheaper-than-hasBasisHeadline
 * posture — a false positive wastes ONE read but `singleKeyBasisOpts` still applies
 * the full `available` gate before threading. Keeps the hot non-options path
 * roundtrip-free.
 */
export function shouldReadSingleKeySmoothedSeries(
  metricsJsonByBasis: unknown,
  computationStatus: unknown,
): boolean {
  const done = isComputedAnalytics(computationStatus as string | null | undefined);
  if (!done) return false;
  if (
    metricsJsonByBasis === null ||
    typeof metricsJsonByBasis !== "object" ||
    Array.isArray(metricsJsonByBasis)
  ) {
    return false;
  }
  const smoothed = (metricsJsonByBasis as Record<string, unknown>).smoothed_mtm;
  return smoothed !== null && typeof smoothed === "object" && !Array.isArray(smoothed);
}

/**
 * MED-1 (Phase 105, D3) — the cash twin of {@link shouldReadSingleKeyMtmSeries}
 * and the SINGLE read-side choke point that decides whether a persisted
 * `cash_settlement` series row may be trusted. It returns true ONLY when
 * `computation_status ∈ {complete, complete_with_warnings}` (the exact
 * terminal-success literals the runner writes) AND `metrics_json_by_basis`
 * carries a non-null non-array `cash_settlement` OBJECT.
 *
 * Why this exists NOW with no production caller: a pre-seam terminal-failure arm
 * nulls the scalars (`metrics_json_by_basis=None`, `computation_status='failed'`)
 * and `return`s BEFORE the persist seam, so a stale `cash_settlement` series row
 * can OUTLIVE its authoritative-NULL scalar — the `<2-interpretable-days` arm
 * (`job_worker.py:2790-2821`), `_stamp_deribit_analytics_failed` (`:2096`), NAV-error
 * arms, and a `BROKER_DAILIES_VIA_FUNDING=false` rollback orphan (LOW-3). A
 * DONE-gate at the READ point is a single choke point that refuses EVERY such
 * arm — including future ones — whereas arm-by-arm heal-deletes silently regress
 * the instant a new arm is added and one is missed (the exact MED-1 bug class).
 *
 * Contract (locked in 105-FOLD-DECISION.md, D3 caveat a): the Phase-106 cash
 * reader — the FIRST caller — MUST route through the `shouldReadCashSettlementSeries`
 * predicate family (this fn + its MTM twin) before trusting a cash series row. No caller exists in Phase 105 by design (the
 * predicate + status-gate is the guarantee; per LOW-4 the INERT-read grep
 * tripwire is NOT — it misses a reader imported via a constant).
 *
 * Deliberately CHEAPER than the full `hasBasisHeadline` gate, mirroring the MTM
 * twin: a degenerate cash_settlement object may pass here; the eventual reader
 * still applies its own trust gate before surfacing a number.
 */
export function shouldReadCashSettlementSeries(
  metricsJsonByBasis: unknown,
  computationStatus: unknown,
): boolean {
  const done = isComputedAnalytics(computationStatus as string | null | undefined);
  if (!done) return false;
  if (
    metricsJsonByBasis === null ||
    typeof metricsJsonByBasis !== "object" ||
    Array.isArray(metricsJsonByBasis)
  ) {
    return false;
  }
  const cash = (metricsJsonByBasis as Record<string, unknown>).cash_settlement;
  return cash !== null && typeof cash === "object" && !Array.isArray(cash);
}

/**
 * HARD-05 (Phase 93) — strict coercion of the server `degraded_members` DQ list
 * into the closed render shape `{ seq, venue }[]`. A degraded member is a composite
 * member EXCLUDED from the stitch (a ccxt venue not yet reconstructed). ONLY an
 * array whose entries are objects carrying a finite numeric `seq` and a non-empty
 * string `venue` survive; anything else (a string, a number entry, a `{}`, a
 * non-finite seq) is dropped so malformed jsonb renders nothing (T-92-05 /
 * T-93-03-02). The server `reason` enum is intentionally DROPPED here — it is
 * server vocabulary; the render surfaces own the user-facing copy.
 */
export function parseDegradedMembers(raw: unknown): Array<{ seq: number; venue: string }> {
  if (!Array.isArray(raw)) return [];
  const out: Array<{ seq: number; venue: string }> = [];
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) continue;
    const { seq, venue } = entry as { seq?: unknown; venue?: unknown };
    if (typeof seq !== "number" || !Number.isFinite(seq)) continue;
    if (typeof venue !== "string" || venue.length === 0) continue;
    out.push({ seq, venue });
  }
  return out;
}
