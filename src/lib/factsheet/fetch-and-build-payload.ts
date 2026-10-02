/**
 * THE canonical factsheet payload builder — the ONE function both factsheet
 * lanes call. Extracted VERBATIM from `src/app/factsheet/[id]/v2/page.tsx`
 * (phase 164, ruling D-06) so a second, tokenized recipient lane can import it
 * without importing a Next.js page module.
 *
 * ⛔ NO CACHE REACH — AND THAT ABSENCE IS ENFORCED, NOT CLAIMED HERE (SL-1).
 * `src/__tests__/phase-148-owner-lane-cache-isolation.test.ts` walks this
 * module's whole TRANSITIVE import closure — 38 modules as measured 2026-08-27,
 * not this file's own bytes — and fails if ANY of them imports `next/cache` or
 * names `unstable_cache` / `revalidateTag` / `revalidatePath` / `cacheTag` /
 * `cacheLife`. The SCOPE is the fact worth knowing: a cache wrapped around a
 * read three hops down this graph discloses exactly as much as one written
 * here, and until phase 164 nothing looked past this file. The sentence that
 * stood here asserted the absence on its own authority; a comment is not a
 * control.
 *
 * WHY THE ABSENCE MATTERS — the argument the guard exists to protect. The
 * cached wrapper `buildFactsheetPayloadCached` deliberately did NOT move; it
 * stays private to `v2/page.tsx`, where the lane decision that makes it safe
 * also lives, and this module imports that page nowhere. The effective
 * `unstable_cache` key on that route carries no viewer (the id and
 * `computed_at` only), so any viewer-dependent payload routed through the
 * wrapper would be served to every later reader of that id — anonymous ones
 * included — for the full TTL. A lane needing a
 * viewer-dependent payload calls `fetchAndBuildPayload` DIRECTLY, exactly as
 * the owner lane does.
 *
 * ⛔ Do NOT re-declare this function anywhere else. `src/__tests__/phase-148-owner-lane-cache-isolation.test.ts`
 * pins this file as the canonical home: exactly one production file may declare
 * it, and every other production file that names it must import it from
 * `@/lib/factsheet/fetch-and-build-payload`. A duplicate builder would break
 * the SL-1 argument, which rests on both lanes producing the same bytes.
 */
import { createAdminClient } from "@/lib/supabase/admin";
import { captureToSentry } from "@/lib/sentry-capture";
import { displayStrategyName } from "@/lib/strategy-display";
import { isComputedAnalytics } from "@/lib/closed-sets";
import { buildFactsheetPayload, deriveIngestSource, hasBuildableSeries, MIN_FACTSHEET_SERIES_POINTS } from "./build-payload";
import type { BuildFactsheetOpts } from "./build-payload";
import { readFactsheetBenchmark } from "./benchmark-read";
import {
  CompositeSeriesReadError,
  readCompositeFactsheet,
  singleKeyDataQuality,
  readSingleKeyBasisOpts,
  readCashConventions,
} from "./composite-read-path";
import { resolveDailyReturnSeries } from "./allocator-portfolio-payload";
import { normalizeDailyReturns } from "@/lib/portfolio-math-utils";
import type { FactsheetPayload, IngestSource } from "./types";

/**
 * The visibility predicate injected into `fetchAndBuildPayload`. Structurally
 * compatible with `withPublishedOnly` and with an owner-inclusive predicate
 * partially applied to a session user id — both are `<Q>(query: Q) => Q`
 * (see src/lib/visibility.ts).
 *
 * The parameter it types is REQUIRED, deliberately with no default: the
 * builder runs on the SERVICE-ROLE admin client, where the injected predicate
 * is the ONLY gate. A default would let a call site silently make no
 * visibility decision; as written, omitting it is a compile error.
 */
export type StrategyVisibility = <Q>(query: Q) => Q;

/**
 * Phase 167.2.1 (D-07) — why a factsheet cannot build, in the probe's closed
 * vocabulary. `read_error` and `not_visible` are the admin read failing or
 * finding no row under the visibility predicate; since Phase 169 (D-41) a
 * composite's failed `csv_daily_returns` read is `read_error` too (the reader
 * throws `CompositeSeriesReadError`), because an outage is not a fact about the
 * row; `not_computed` is an analytics row that is not a terminal success;
 * `composite_unbuildable` is a composite that cannot build from what it stores
 * (a missing or untrusted headline, an empty or a short series);
 * `too_few_points` is a single-key series
 * below `MIN_FACTSHEET_SERIES_POINTS` distinct dated returns.
 * `malformed_series` (167.2.1-REVIEW-SFH M-3) is a single-key row whose stored
 * columns HOLD at least that many dated entries, but whose entries were
 * dropped as malformed (a non-finite or string value, a non-string date, a
 * non-positive wealth point) until fewer remained: a defect in what the
 * analytics writer stored, never "too few days of returns".
 */
export type NotBuildableReason =
  | "read_error"
  | "not_visible"
  | "not_computed"
  | "composite_unbuildable"
  | "too_few_points"
  | "malformed_series";

/**
 * 167.2.1-REVIEW-R2 WR-01 / SFH-R2 N-1 — the facts behind a refusal, carried
 * OUT of the resolve stage instead of captured in it when the caller is a
 * probe. `code` is the PostgREST / SQLSTATE code of a `read_error` ("none"
 * when the error had none). `gate` names the check that refused a
 * `composite_unbuildable` or `malformed_series`. `source` names the stored
 * column a `malformed_series` count was taken from (SFH-R2 N-5). Each is
 * present only on the reasons it describes. None of them identifies anyone.
 */
export type NotBuildableDetail = {
  code?: string;
  gate?: "headline" | "empty_series" | "short_series";
  source?: "daily_returns" | "returns_series";
};

/** The probe's answer: buildable, or not buildable with a typed reason. */
export type FactsheetBuildability =
  | { buildable: true }
  | ({ buildable: false; reason: NotBuildableReason } & NotBuildableDetail);

/**
 * 167.2.1-REVIEW-SFH M-1 — who ran the resolve stage. Every resolve log line
 * carries it, in its prefix and its payload, so a probe on /strategies never
 * reads in the logs as a factsheet build that did not happen.
 *
 * 167.2.1-REVIEW-R2 WR-01 — it also decides who CAPTURES. The stage sends a
 * Sentry event only for `"build"`: a factsheet somebody opened. A `"probe"`
 * runs once per computed row on every /strategies load, so a per-row capture
 * there sent N events per navigation for as long as a row stayed unbuildable
 * (or a pool stayed saturated). The probe returns the facts
 * (`NotBuildableDetail`) and `StrategiesPage` sends one event per page load.
 */
type ResolveCaller = "build" | "probe";

type NotBuildable = { ok: false; reason: NotBuildableReason } & NotBuildableDetail;

/**
 * A failed resolve: the builder returns null, the probe returns this reason
 * and its detail. Only the detail keys that are set are copied, so a reason
 * with none compares equal to `{ ok: false, reason }`.
 */
function notBuildable(reason: NotBuildableReason, detail: NotBuildableDetail = {}): NotBuildable {
  const out: NotBuildable = { ok: false, reason };
  if (detail.code !== undefined) out.code = detail.code;
  if (detail.gate !== undefined) out.gate = detail.gate;
  if (detail.source !== undefined) out.source = detail.source;
  return out;
}

/**
 * 167.2.1-REVIEW-SFH M-3 — how many dated return entries a stored series
 * column HOLDS, before any normalization drops a malformed one. An array
 * counts its distinct string dates, plus each entry with no string date on its
 * own (a malformed entry is still an entry the writer stored). A flat
 * `{date: value}` dict counts its keys, and a nested `{year: {MM-DD: value}}`
 * dict its inner keys. Anything else holds none.
 */
function storedEntryCount(raw: unknown): number {
  if (raw === null || typeof raw !== "object") return 0;
  if (Array.isArray(raw)) {
    const keys = new Set<string>();
    raw.forEach((entry, i) => {
      const date =
        entry !== null && typeof entry === "object" ? (entry as { date?: unknown }).date : undefined;
      keys.add(typeof date === "string" ? `date:${date}` : `entry:${i}`);
    });
    return keys.size;
  }
  let count = 0;
  for (const value of Object.values(raw)) {
    count +=
      value !== null && typeof value === "object" && !Array.isArray(value)
        ? Object.keys(value).length
        : 1;
  }
  return count;
}

/**
 * 167.2.1-REVIEW-SFH-R2 N-5 — which stored column the builder's series comes
 * from, and how many dated returns that column holds. The rule is
 * `resolveDailyReturnSeries`'s own, asked through the same
 * `normalizeDailyReturns`: `daily_returns` whenever it normalizes to at least
 * one entry, and only otherwise the `returns_series` wealth curve (N points
 * make N-1 returns). A long `returns_series` beside a short but valid
 * `daily_returns` is therefore never counted: the builder never reads it.
 * When neither column normalizes, the count is the larger of the two columns'
 * stored entries, and `source` names the column that held them.
 */
function countedSeriesColumn(
  dailyRaw: unknown,
  returnsSeriesRaw: unknown,
): { source: "daily_returns" | "returns_series"; storedReturns: number } {
  const dailyStored = storedEntryCount(dailyRaw);
  if (normalizeDailyReturns(dailyRaw).length > 0) {
    return { source: "daily_returns", storedReturns: dailyStored };
  }
  const wealthStored = storedEntryCount(returnsSeriesRaw) - 1;
  return dailyStored >= wealthStored
    ? { source: "daily_returns", storedReturns: dailyStored }
    : { source: "returns_series", storedReturns: wealthStored };
}

/**
 * 167.2.1-REVIEW-SFH M-3 — a single-key series the resolve stage refused.
 * `too_few_points` only when the column the builder reads really holds fewer
 * than `MIN_FACTSHEET_SERIES_POINTS` dated returns (`countedSeriesColumn`,
 * SFH-R2 N-5). When it holds enough and normalization left too few, the
 * stored data is malformed: the owner is not told a false "fewer than 2
 * days", and the defect is captured, since it is the analytics writer's and
 * nothing else records it. The capture names the counted column (`source`).
 * 167.2.1-REVIEW-R2 IN-02: a build's capture carries `strategy_id`, so
 * support can find the row from the event alone.
 */
function singleKeyUnbuildable(
  id: string,
  caller: ResolveCaller,
  gate: "empty_series" | "short_series",
  dailyRaw: unknown,
  returnsSeriesRaw: unknown,
  resolvedEntries: number,
): NotBuildable {
  const { source, storedReturns } = countedSeriesColumn(dailyRaw, returnsSeriesRaw);
  if (storedReturns < MIN_FACTSHEET_SERIES_POINTS) return notBuildable("too_few_points");
  // WR-01: captured for a build only; a probe carries gate and source out.
  if (caller === "build") {
    captureToSentry(new Error(`factsheet resolve: stored single-key series is malformed (${gate})`), {
      tags: { stage: "factsheet-resolve-malformed", caller, gate, source, strategy_id: id },
      extra: { storedReturns, resolvedEntries },
    });
  }
  return notBuildable("malformed_series", { gate, source });
}

/**
 * 167.2.1-REVIEW-SFH H-1 — every `composite_unbuildable` answer a BUILD
 * reaches is CAPTURED, at level warning. A failed `csv_daily_returns` read no
 * longer reaches this reason: since Phase 169 (D-41) the reader throws
 * `CompositeSeriesReadError` and the resolve stage answers it `read_error` with
 * its code. The copy sends the owner to support for this reason. The event is
 * not proof of an outage; it is what makes "contact support" answerable, and
 * 167.2.1-REVIEW-R2 IN-02 tags it with `strategy_id` so the event alone names
 * the row (before, support had to join its timestamp to the
 * `resolve(<caller>)` log line). A probe's refusal never carries an id to
 * Sentry: `StrategiesPage` aggregates it per page load, id-free. `gate`
 * names which check refused: the helper (a missing or untrusted headline,
 * `headline`), an empty series (`empty_series`) or a short one
 * (`short_series`). 167.2.1-REVIEW-R2 WR-01: a probe carries `gate` out and
 * `StrategiesPage` counts it into its one event per page load.
 */
function compositeUnbuildable(
  id: string,
  caller: ResolveCaller,
  gate: "headline" | "empty_series" | "short_series",
): NotBuildable {
  if (caller === "build") {
    captureToSentry(new Error(`factsheet resolve: composite cannot build (${gate})`), {
      level: "warning",
      tags: { stage: "factsheet-resolve-composite", caller, gate, strategy_id: id },
    });
  }
  return notBuildable("composite_unbuildable", { gate });
}

/**
 * Phase 169 (D-41) and review round 1 (WR-05 / SFH M-3) — a persisted series
 * read FAILED: the composite's `csv_daily_returns`, or a gated MTM or smoothed
 * series read on either arm. It is an outage, never a fact about the row, so it
 * is `read_error` with its code, exactly as the strategies read above, never
 * `composite_unbuildable` and never a payload built without the series. The
 * public cached callback throws on `read_error`, so the outage is never stored
 * for the analytics run. Captured for a BUILD only (WR-01); a probe returns the
 * code. `read` names the series in the log line and the event.
 */
function seriesReadError(id: string, caller: ResolveCaller, err: CompositeSeriesReadError): NotBuildable {
  const { code, read } = err;
  const errorMessage = typeof err.cause === "string" ? err.cause : undefined;
  console.error(`[factsheet] resolve(${caller}) — ${read} read failed`, {
    id,
    caller,
    errorMessage,
    errorCode: code,
    read,
  });
  if (caller === "build") {
    // SFH L-2 (review round 1): the event carries the PostgREST message too. A
    // network failure has no code, so "(none)" alone named nothing.
    // `captureToSentry` scrubs `extra` string values.
    captureToSentry(new Error(`factsheet resolve: ${read} read failed (${code})`), {
      tags: {
        stage: "factsheet-resolve",
        caller,
        reason: "read_error",
        code,
        strategy_id: id,
        read,
      },
      extra: { errorMessage },
    });
  }
  return notBuildable("read_error", { code });
}

/**
 * Phase 167.2.1 (D-04) — THE RESOLVE STAGE, gates G0 to G4, shared by
 * `fetchAndBuildPayload` and `probeFactsheetBuildable`. It holds EVERY null exit
 * of the builder: the admin read under the injected visibility predicate (G0),
 * the terminal-success gate (G1), the series resolution and the composite read
 * (G2), the empty-series gate (G3) and the point-count gate (G4,
 * `hasBuildableSeries`, the same predicate `buildFactsheetPayload` calls). The
 * steps are the builder's own, moved here verbatim with their comments.
 * Module-private: a reader asks through the probe. `caller` labels every log
 * line (SFH M-1): `[factsheet] resolve(build)` or `resolve(probe)`.
 */
async function resolveFactsheetInputs(
  supabase: ReturnType<typeof createAdminClient>,
  id: string,
  visibility: StrategyVisibility,
  caller: ResolveCaller,
  // 167.2.1-REVIEW-SFH-R2 N-3: the probe's deadline aborts the admin read
  // through this signal. A build passes none, so its query is unchanged.
  signal?: AbortSignal,
) {
  const strategyQuery = supabase
    .from("strategies")
    .select(
      `id, name, codename, disclosure_tier, status, markets, strategy_types,
       description, subtypes, supported_exchanges, leverage_range, aum,
       max_capacity, avg_daily_turnover, start_date, benchmark, asset_class,
       returns_denominator_config,
       strategy_analytics ( daily_returns, returns_series, computed_at, data_quality_flags, metrics_json_by_basis, computation_status,
         cumulative_return, volatility, max_drawdown, cagr, sharpe, sortino, calmar )`,
    )
    .eq("id", id);
  const { data: strategy, error } = await visibility(
    signal ? strategyQuery.abortSignal(signal) : strategyQuery,
  )
    .maybeSingle();
  if (error && signal?.aborted) {
    // The probe already answered with its timeout; this read was cancelled by
    // that deadline, so it is not a second, separate outage.
    console.warn(`[factsheet] resolve(${caller}) — admin strategy read aborted at the probe deadline`, {
      id,
      caller,
    });
    return notBuildable("read_error", { code: "aborted" });
  }
  if (error) {
    // 167.2.1-REVIEW-SFH M-2: a failed admin read is an outage, not a data
    // fact. `console.*` does not reach Sentry in this repo (no console
    // integration in `instrumentation.ts`), so it is captured HERE, once, with
    // its PostgREST / SQLSTATE code and (167.2.1-REVIEW-R2 IN-02) the
    // `strategy_id` as tags, so the event names the row it failed on. That
    // covers every lane: the public and token builders used to render the
    // placeholder for it with no event at all, and the probe callers captured
    // a fixed message with no code.
    // 167.2.1-REVIEW-R2 WR-01: captured here for a BUILD only. Pool
    // saturation reaches this line as a returned `{ error }`, never a throw,
    // so capturing it per probe sent one event per computed row per
    // /strategies load. A probe returns the code, and the page counts it.
    const code = error.code || "none";
    console.error(`[factsheet] resolve(${caller}) — admin strategy read failed`, {
      id,
      caller,
      errorMessage: error.message,
      errorCode: code,
    });
    if (caller === "build") {
      captureToSentry(new Error(`factsheet resolve: admin strategy read failed (${code})`), {
        tags: { stage: "factsheet-resolve", caller, reason: "read_error", code, strategy_id: id },
      });
    }
    return notBuildable("read_error", { code });
  }
  if (!strategy) {
    console.warn(`[factsheet] resolve(${caller}) — admin read returned no strategy`, {
      id,
      caller,
    });
    return notBuildable("not_visible");
  }

  const analytics = Array.isArray(strategy.strategy_analytics)
    ? strategy.strategy_analytics[0]
    : strategy.strategy_analytics;

  // STALE-01 — THE SIDE DOOR. `computation_status` was already on this embed
  // (:95) and already read here, but only as an argument to
  // `readSingleKeyBasisOpts`; nothing gated the RENDER on it. The render gate
  // was `dailyReturns.length === 0`, and a failed run leaves the previous run's
  // series in `daily_returns` / `returns_series` untouched — the analytics
  // writer stamps the status and the error, not the data. So every panel on the
  // widest metric surface in the product was built from a track no finished run
  // vouches for.
  //
  // ⚠️ This page is what BOTH PDF wrappers screenshot. `/api/factsheet/[id]/pdf`
  // refuses a non-computed strategy with a 400 "Analytics not computed" and
  // then `page.goto()`s `/factsheet/[id]` — which re-exports THIS module — while
  // `/api/factsheet/[id]/tearsheet.pdf` does the same for the tearsheet. Those
  // 400s were guarding a front door beside an open side door: both target pages
  // are directly reachable URLs and neither refused anything. The wrappers are
  // unchanged; the pages now hold the same line, which is what makes the
  // wrappers' refusal mean something.
  //
  // The answer is the EXISTING one: return null, which the caller already
  // renders as the "still computing" placeholder it shows for any strategy
  // whose series has not been ingested. No new state, no new copy, nothing red
  // — and the owner lane inherits it, so an owner previewing their own draft
  // sees the same honest placeholder rather than a factsheet built on a dead
  // run. `computing` is included for the reason `shapeRowAnalytics` gives:
  // there is no honest date to show the previous run's numbers under.
  if (!isComputedAnalytics(analytics?.computation_status)) {
    console.warn(
      `[factsheet] resolve(${caller}) — analytics row is not a terminal success; withholding the payload`,
      { id, caller, computationStatus: analytics?.computation_status ?? null },
    );
    return notBuildable("not_computed");
  }

  const dailyRaw = analytics?.daily_returns;
  // resolveDailyReturnSeries handles two real-world realities at once:
  //   (a) `daily_returns` may be in one of three shapes (array of
  //       {date,value}, flat {date:value} dict, nested {year:{MM-DD:value}}).
  //   (b) analytics-service-only strategies have `daily_returns=null`; the
  //       real series lives in `returns_series` as a cumprod equity curve.
  // Both gates have to fall before we render the "still computing"
  // placeholder.
  let dailyReturns = resolveDailyReturnSeries(dailyRaw, analytics?.returns_series);
  // Phase 90 (D6) — composite discriminator is SERVER TRUTH
  // (`data_quality_flags.composite`), NEVER `apiKeyId === null` (Phase-89
  // Pitfall 1). A stitched multi-key composite has `daily_returns=NULL` (so
  // `deriveIngestSource` above classifies it "api" on the RAW column — LEFT
  // UNTOUCHED, pinned by audit-c20 RED-TEAM-H1) but its honest cash series lives
  // sparse in `csv_daily_returns`. We read that series, route the payload down
  // the csv arm with an EXPLICIT `ingestSource:"csv"` at the build call, render
  // the arithmetic running-cumulative curve, and thread the marker/basis fields.
  const dqf = analytics?.data_quality_flags as
    | { composite?: unknown; mtm_gated_reason?: unknown; per_key?: unknown; gap_spans?: unknown; insufficient_window?: unknown; cumulative_method?: unknown }
    | null
    | undefined;
  const isComposite = dqf?.composite === true;
  let compositeBuildOpts: BuildFactsheetOpts | undefined;
  // SFH HIGH-1 (169.1 review round 1): a failed `cash_settlement` conventions
  // read, on either arm. The build still runs on the config tier (D-30); this
  // is carried to the success exit, captured there and marked degraded.
  let conventionsReadFailure: { code: string; message: string } | undefined;
  if (isComposite) {
    // H-2: the composite read-path is the ONE shared `readCompositeFactsheet`;
    // since Phase 169.1 plan 01 the discovery detail page reaches it through
    // this stage rather than calling it itself (the "one path" lesson). It
    // REUSES the in-scope service-role admin `supabase` handle
    // already created above under the SAME injected `visibility` predicate
    // boundary — NO new client, NO broader privilege; the outer request-scoped
    // RLS signature probe + notFound() remains the unchanged auth gate. The
    // helper carries C-1 (config-driven method), F1/H-1 (headline gate), F2/M-1
    // (MTM gate) and the FS-01/02 markers. A null result = data defect → the
    // "still computing" placeholder below.
    let composite: Awaited<ReturnType<typeof readCompositeFactsheet>>;
    try {
      composite = await readCompositeFactsheet(supabase, {
        strategyId: id,
        dqf,
        metricsJsonByBasis: analytics?.metrics_json_by_basis,
        returnsDenominatorConfig: strategy.returns_denominator_config,
      });
    } catch (err) {
      // Phase 169 (D-41 / R3, routed from 167.2.1 D-07): a FAILED
      // `csv_daily_returns` read (or, since review round 1, a failed MTM or
      // smoothed series read) is `read_error`; see `seriesReadError`. Any other
      // throw is not this stage's to answer.
      if (!(err instanceof CompositeSeriesReadError)) throw err;
      return seriesReadError(id, caller, err);
    }
    if (!composite) return compositeUnbuildable(id, caller, "headline");
    dailyReturns = composite.dailyReturns;
    compositeBuildOpts = composite.buildOpts;
    conventionsReadFailure = composite.conventionsReadFailure;
  }
  // Warn when both daily_returns (CSV indicator) and returns_series (API
  // indicator) are populated — ambiguous provenance may mis-classify an
  // api-verified strategy as csv if the ingester later back-fills the column.
  // (IMPORTANT-3 — b06-codereview)
  if (
    Array.isArray(dailyRaw) &&
    analytics?.returns_series != null &&
    typeof analytics.returns_series === "object" &&
    Object.keys(analytics.returns_series as object).length > 0
  ) {
    console.warn(
      `[factsheet] resolve(${caller}) — both daily_returns and returns_series populated; ingestSource='csv' applied conservatively`,
      { id, caller },
    );
  }
  if (dailyReturns.length === 0) {
    console.warn(`[factsheet] resolve(${caller}) — no usable return series after normalization + equity-curve fallback`, {
      id,
      caller,
      hasAnalytics: !!analytics,
      dailyType: typeof dailyRaw,
      isArray: Array.isArray(dailyRaw),
      returnsSeriesType: typeof analytics?.returns_series,
    });
    return isComposite
      ? compositeUnbuildable(id, caller, "empty_series")
      : singleKeyUnbuildable(id, caller, "empty_series", dailyRaw, analytics?.returns_series, 0);
  }

  // G4 (Phase 167.2.1, D-04): the builder's own point-count predicate, asked
  // HERE so that every null exit of `fetchAndBuildPayload` is a failed resolve
  // and the probe never has to build to know. `buildFactsheetPayload` keeps the
  // same gate for its other caller.
  if (!hasBuildableSeries(dailyReturns)) {
    console.warn(
      `[factsheet] resolve(${caller}) — return series has fewer than the minimum distinct dated observations; withholding the payload`,
      { id, caller, isComposite, rawCount: dailyReturns.length, minimum: MIN_FACTSHEET_SERIES_POINTS },
    );
    return isComposite
      ? compositeUnbuildable(id, caller, "short_series")
      : singleKeyUnbuildable(id, caller, "short_series", dailyRaw, analytics?.returns_series, dailyReturns.length);
  }

  // Phase 169 review round 1 (WR-05 / SFH M-3): the single-key basis assembly
  // runs HERE, in the resolve stage, because its gated MTM and smoothed series
  // reads can fail, and a failed read must be `read_error` like the composite's
  // (whose reader already reads its basis series inside this stage). Past this
  // stage the build has no null exit (167.2.1-REVIEW WR-04), so an outage there
  // could only have been a throw that no lane answers, or the old degrade the
  // public cache stored for the run. A clean row with no by-basis object reads
  // no basis series (the shared cheap predicates), so the hot non-options path
  // stays free of series roundtrips; a chain-broken row reads its stored cash
  // series once (SFH H-1). Since Phase 169.1 (D-83) a BUILD also reads the
  // conventions echo once (below); a probe reads nothing here.
  //
  // MTM-01 (Phase 102): a single-key OPTIONS strategy also persists its MTM
  // basis (`metrics_json_by_basis.mark_to_market`) + an honest degrade reason.
  // The F-4 `computation_status`-DONE gate was documented as riding a
  // computed_at-bearing cache key; until 167.2.1-REVIEW WR-02 it did not (the
  // effective key was id-only). It does now: `computed_at` is a keyParts
  // member (see the header comment of `fetchAndBuildPayload`). The status bridge
  // stamps a fresh computed_at on every job transition it resolves, at job
  // start and at its end (167.2.1-REVIEW-R2 IN-01), so a status change always
  // moves the key; nothing waits on the TTL. Status is public-safe on a
  // published row (unchanged RLS boundary — the outer request-scoped signature
  // probe stays the auth gate).
  //
  // Phase 169 (SC4, D-10): the analytics row is passed too, and the embed above
  // projects its seven persisted headline scalars. The owner overlays them as
  // the cash headline for a rankable row, so this page reads the stored CAGR and
  // Sharpe that discovery, recommendations and my-strategies show.
  //
  // MTM-04 (Phase 103) + SMTM-01 (Phase 133, review WR-01): the persisted
  // `mtm_daily_returns` / `smoothed_mtm_daily_returns` series reads (so charts
  // follow the toggle) and the gate/scalar/series threading are assembled by
  // the ONE shared owner `readSingleKeyBasisOpts`. Since Phase 169.1 plan 01
  // the discovery detail page builds through this stage, so no surface keeps a
  // copy of this assembly (WR-01 was exactly a per-page inline copy
  // drifting). The reads ride the SAME
  // service-role admin `supabase` handle (deny-all RLS on
  // strategy_analytics_series — no visibility widening, same gate as the
  // scalar objects).
  let singleKeyOpts: Awaited<ReturnType<typeof readSingleKeyBasisOpts>> | undefined;
  if (!isComposite) {
    // Phase 169.1 (D-83 (a), D-30): a BUILD reads the conventions the analytics
    // service froze into the cash_settlement series row, so the curve and the day
    // basis follow what the stored headline was computed under, even when the live
    // config was edited after the run. A probe decides buildability, which does not
    // depend on the method, so /strategies probes issue no extra query; it resolves
    // from the config tier. The read never throws: a failure logs and degrades to
    // the config tier, and (SFH HIGH-1) is carried to the success exit below.
    // Same service-role handle, behind the same visibility gate.
    const cashRead = caller === "build" ? await readCashConventions(supabase, id) : null;
    if (cashRead?.failed) conventionsReadFailure = { code: cashRead.code, message: cashRead.message };
    const cashConventions = cashRead?.conventions ?? null;
    try {
      singleKeyOpts = await readSingleKeyBasisOpts(
        () => supabase,
        id,
        dqf,
        analytics?.metrics_json_by_basis,
        analytics?.computation_status,
        analytics,
        // SFH H-2 (review round 1): the config is the LAST tier of the method and
        // day basis, after the frozen echo (D-83).
        strategy.returns_denominator_config,
        // A probe never captures (167.2.1-REVIEW-R2 WR-01); a build captures a
        // persisted-headline defect once.
        { captureDefects: caller === "build", cashConventions },
      );
    } catch (err) {
      if (!(err instanceof CompositeSeriesReadError)) throw err;
      return seriesReadError(id, caller, err);
    }
  }

  // SFH HIGH-1 (169.1 review round 1): the build goes on, on the config tier
  // (D-30: a blip must not blank a factsheet), but that tier is exactly the one
  // the frozen echo exists to override, so this build can draw its curve, grid,
  // stress windows and window KPIs on a method or day basis the stored headline
  // was not computed under. It is captured HERE, at the success exit, so a
  // build that fails later in this stage (a sibling series read) sends its own
  // `read_error` event and not a second one for a payload that never ships.
  // `console.*` does not reach Sentry in this repo. Build only (WR-01): a
  // probe's answer does not depend on the method. The build result carries
  // `conventionsDegraded`, and the public cached callback in `v2/page.tsx`
  // refuses to store it.
  const conventionsDegraded = conventionsReadFailure !== undefined;
  if (conventionsReadFailure && caller === "build") {
    const { code, message } = conventionsReadFailure;
    captureToSentry(new Error(`factsheet resolve: cash_settlement conventions read failed (${code})`), {
      tags: {
        stage: "factsheet-resolve",
        caller,
        reason: "conventions_read_error",
        code,
        strategy_id: id,
        read: "cash_settlement",
      },
      // `captureToSentry` scrubs `extra` string values.
      extra: { errorMessage: message },
    });
  }

  return {
    ok: true as const,
    strategy,
    analytics,
    dqf,
    isComposite,
    dailyRaw,
    dailyReturns,
    compositeBuildOpts,
    singleKeyOpts,
    conventionsDegraded,
  };
}

/**
 * Two-layer visibility:
 *   1. Outer `signature` probe uses the REQUEST-scoped supabase client —
 *      enforces RLS per-user. If the row isn't visible to this user, we 404
 *      before touching the cache. This is the auth gate.
 *   2. Cache-fill uses the SERVICE-ROLE admin client so cache content is
 *      visibility-deterministic. Without this, the first requester's RLS view
 *      would freeze into the cache and bleed across users with different
 *      permissions on the same row.
 *
 * The shape works because the only fields we cache come from the published
 * strategy row + its analytics — already public to anyone who can pass the
 * outer gate. If a future RLS predicate adds per-user filtering on those
 * columns, this comment is the warning sign.
 *
 * CACHE KEY REALITY (corrected phase 148; corrected again 167.2.1-REVIEW
 * WR-02). Next derives the unstable_cache key from the callback's source text,
 * the keyParts and the call's args. Until 167.2.1 the page passed a
 * `${id}::${computedAt}` string that `buildFactsheetPayloadCached` (in
 * `src/app/factsheet/[id]/v2/page.tsx`) split, discarding everything after the
 * id, so the key was id-ONLY and a fresh `computed_at` did not bust it
 * (DEF-148-A). The keyParts are now ["factsheet-v2-payload-v11", id,
 * computedAt], a `null` computedAt included. 167.2.1-REVIEW-R2 IN-01: the key
 * moves more often than "once per successful run". The status bridge
 * `sync_strategy_analytics_status` (latest definition: migration
 * 20260906120000) stamps `computed_at = now()` on every job transition it
 * resolves: branch (a), the non-terminal arm, on every call, so the move INTO
 * `computing` at job start stamps it; branch (b) on an unprotected failure;
 * and branch (c) at a successful completion. Its protected branch (b-prime)
 * writes neither status nor `computed_at`, and so
 * changes nothing the builder reads. So a status change is never served from
 * an entry keyed before it. Entries live up to revalidate=3600s only while no
 * transition happens, and the admin publish flow's
 * revalidateTag(`factsheet-v2:${id}`) still handles publish/unpublish flips.
 *
 * ⛔ Corollary: viewer/lane separation can NEVER be expressed through the
 * cache key. Nothing in it is about the viewer (`computed_at` is a property of
 * the row), so any viewer-dependent payload built through the cached wrapper
 * would be served to every subsequent reader of that id and run — including
 * anonymous ones — for the full TTL. A viewer-dependent payload must bypass
 * the cached wrapper entirely, which is why the wrapper in `v2/page.tsx`
 * hard-codes its predicate instead of accepting one.
 */
export async function fetchAndBuildPayload(
  id: string,
  visibility: StrategyVisibility,
): Promise<FactsheetPayload | null> {
  return (await resolveAndBuild(id, visibility)).payload;
}

/**
 * 167.2.1-REVIEW WR-03 — one build, and WHY it produced no payload. A payload
 * carries no reason; no payload carries the resolve stage's reason.
 */
export type FactsheetBuildResult =
  | {
      payload: FactsheetPayload;
      reason: null;
      /**
       * SFH HIGH-1 (169.1 review round 1): present (and `true`) only when the
       * `cash_settlement` conventions read FAILED and the payload was built on
       * the config tier (D-30). The payload is real and renders, but it is not
       * stored by the public cache. Absent on a clean build, so a clean result
       * is unchanged.
       */
      conventionsDegraded?: true;
    }
  | { payload: null; reason: NotBuildableReason };

/**
 * 167.2.1-REVIEW WR-03 — `fetchAndBuildPayload` plus the reason its payload is
 * null, from the SAME resolve that decided it. For the owner lane of the v2
 * factsheet, whose S7 share note needs that reason: it used to build, discard
 * the reason, and run the whole resolve (the composite read included) a second
 * time through the probe, and the two runs could disagree. One resolve makes
 * the note and the payload the same answer by construction.
 *
 * `visibility` is REQUIRED for the reason `StrategyVisibility` gives. ⛔ The
 * same cache rule as `fetchAndBuildPayload`: never route it through the
 * id-keyed cached wrapper.
 */
export async function fetchAndBuildPayloadWithReason(
  id: string,
  visibility: StrategyVisibility,
): Promise<FactsheetBuildResult> {
  return resolveAndBuild(id, visibility);
}

/**
 * The one resolve-and-build both exported builders run. Phase 167.2.1 (D-04):
 * every null exit lives in the shared resolve stage; past it the build is
 * typed non-null (WR-04).
 */
async function resolveAndBuild(
  id: string,
  visibility: StrategyVisibility,
): Promise<FactsheetBuildResult> {
  const supabase = createAdminClient();
  const resolved = await resolveFactsheetInputs(supabase, id, visibility, "build");
  if (!resolved.ok) return { payload: null, reason: resolved.reason };
  const payload = await buildFromResolved(supabase, id, resolved);
  return resolved.conventionsDegraded
    ? { payload, reason: null, conventionsDegraded: true }
    : { payload, reason: null };
}

/** A resolve that succeeded: the inputs the build runs on. */
type ResolvedFactsheetInputs = Extract<
  Awaited<ReturnType<typeof resolveFactsheetInputs>>,
  { ok: true }
>;

/**
 * Phase 169.5's BTC read (`readFactsheetBenchmark`, its two stable log
 * messages) lives in `./benchmark-read` since Phase 169.4 plan 02 (D-77), a
 * module that does not load `server-only`, so the allocator dashboard in
 * `src/lib/queries.ts` can call the SAME read. Re-exported here so every
 * existing importer of this module keeps working unchanged.
 */
export {
  BENCHMARK_READ_FAILED_MESSAGE,
  BENCHMARK_UNAVAILABLE_MESSAGE,
  readFactsheetBenchmark,
} from "./benchmark-read";

/**
 * 167.2.1-REVIEW WR-04 — the build, past the resolve stage. Its declared
 * return type is `Promise<FactsheetPayload>`, never null: a `return null`
 * added here does not compile, and `resolved.dailyReturns` is a
 * `BuildableSeries`, for which `buildFactsheetPayload` is typed non-null. So
 * every null exit of `fetchAndBuildPayload` is a failed resolve BY
 * CONSTRUCTION, which is the invariant `probeFactsheetBuildable` rests on.
 */
async function buildFromResolved(
  supabase: ReturnType<typeof createAdminClient>,
  id: string,
  resolved: ResolvedFactsheetInputs,
): Promise<FactsheetPayload> {
  const { strategy, analytics, dqf, isComposite, dailyRaw, dailyReturns, singleKeyOpts } = resolved;

  // Ingest source classifies daily_returns (CSV path) vs returns_series-only
  // (live API path). The empty-array-is-csv invariant (FINDING-1) + the
  // no-invented-data rationale (NEW-C20-01) live in deriveIngestSource — the
  // single source of truth (the discovery page reaches it through this build
  // since Phase 169.1 plan 01) and pinned by audit-c20's RED-TEAM-H1.
  const ingestSource: IngestSource = deriveIngestSource(dailyRaw);

  let buildOpts: BuildFactsheetOpts | undefined = resolved.compositeBuildOpts;
  if (!isComposite) {
    // HARD-04 (#67) / Finding B: single-key strategies persist
    // `insufficient_window` at the analytics_runner CAGR site too, but buildOpts
    // was assigned ONLY on the composite arm, so `payload.dataQuality` stayed
    // undefined and the FactsheetView :876 caveat never rendered single-key
    // despite the server truth. Thread it through the ONE shared owner
    // (`singleKeyDataQuality`); the discovery detail page builds through this
    // same function since Phase 169.1 plan 01, so no surface can diverge on
    // the DQ opt (the composite "one path" lesson).
    //
    // The basis story (MTM / smoothed gates, scalars and series, and since
    // Phase 169 the persisted cash headline) was assembled by
    // `readSingleKeyBasisOpts` in the resolve stage (review round 1, WR-05),
    // where its series reads can answer `read_error`; see the comment there.
    buildOpts = {
      ...(buildOpts ?? {}),
      dataQuality: singleKeyDataQuality(dqf),
      ...singleKeyOpts,
    };
  }

  // Phase 169.5 (SC3, D-09): BTC from the database, one bounded read per build,
  // AFTER buildOpts is assembled so the bound spans every comparator axis.
  buildOpts = {
    ...(buildOpts ?? {}),
    benchmarkPrices: await readFactsheetBenchmark(supabase, dailyReturns, buildOpts, id),
  };

  // FINDING-5 (b06-silentfailure): Never fall back to "now" for a missing
  // computed_at — that would make FreshnessChip show a green "fresh" badge
  // for a strategy with no real analytics data. Use the epoch sentinel so
  // the chip renders "old" / staleness signal instead of a false freshness.
  if (!analytics?.computed_at) {
    console.warn(
      "[factsheet] fetchAndBuildPayload — analytics.computed_at missing, freshness chip will show epoch",
      { id },
    );
  }
  const computedAt = analytics?.computed_at ?? "1970-01-01T00:00:00Z";
  // Factsheet is a "full identity" context per the strategy-display.ts
  // contract: prefer the real name, fall back to codename, then to the
  // synthetic Strategy#id. Without this, exploratory strategies with a
  // real name (e.g. "Phoenix Protocol") get redacted to a hex prefix on
  // the factsheet even though the discovery list shows the real name.
  const factsheetName =
    strategy.name ??
    strategy.codename ??
    displayStrategyName(strategy);
  return buildFactsheetPayload(
    {
      id: strategy.id,
      name: factsheetName,
      types: strategy.strategy_types ?? [],
      markets: strategy.markets ?? [],
      computedAt,
      trustTier: null,
      // Composites route down the csv arm EXPLICITLY (suppresses the three
      // synthesized panels via the existing discriminated union — no new
      // logic). Single-key keeps the raw-column-derived classification.
      ingestSource: isComposite ? "csv" : ingestSource,
      description: strategy.description ?? null,
      subtypes: strategy.subtypes ?? [],
      supportedExchanges: strategy.supported_exchanges ?? [],
      leverageRange: strategy.leverage_range ?? null,
      aum: strategy.aum ?? null,
      maxCapacity: strategy.max_capacity ?? null,
      avgDailyTurnover: strategy.avg_daily_turnover ?? null,
      startDate: strategy.start_date ?? null,
      benchmark: strategy.benchmark ?? null,
      assetClass: strategy.asset_class ?? null,
    },
    dailyReturns,
    buildOpts,
  );
}

/**
 * 167.2.1-REVIEW-SFH-R2 N-3 — how long one buildability probe may take before
 * it answers "could not check". Chosen from repo evidence:
 * - The probe is one admin read of the strategy row, plus a csv read for a
 *   composite. On real rows, the live-DB lane measured it at 14 to 20 ms
 *   (`167.2.1-01-SUMMARY.md`, PROBE-SINGLE / -COMPOSITE / -CONTROL). 5 s
 *   leaves more than two orders of magnitude for a cold pool or a large
 *   composite, so it fires only on a real stall.
 * - The repo's other status probe with a deadline uses the same bound, for
 *   the same reason: `MOUNT_PROBE_TIMEOUT_MS` in the wizard's
 *   `SyncPreviewStep` ("a healthy read answers well inside a second; 5 s
 *   leaves room for a cold route"). The
 *   render-path side fetch in `scenario-share/[token]/page.tsx`
 *   (`BENCHMARK_FETCH_TIMEOUT_MS`) is tighter at 2.5 s, but it guards an
 *   optional overlay, not the row's own answer.
 * - /strategies runs the probes `PROBE_CONCURRENCY` at a time, so the stall
 *   one page load can suffer is bounded by ceil(computed rows / 4) x 5 s,
 *   not by the platform's function timeout, which would kill the request
 *   before the page's one Sentry event is sent.
 */
export const FACTSHEET_PROBE_DEADLINE_MS = 5_000;

/**
 * 167.2.1-REVIEW-SFH-R2 N-3 — a probe that did not answer within its
 * deadline. Named, so a caller counts it as its own outcome and never mistakes
 * it for a code defect.
 */
export class FactsheetProbeTimeoutError extends Error {
  readonly deadlineMs: number;
  constructor(deadlineMs: number) {
    super(`factsheet probe: no answer within ${deadlineMs} ms`);
    this.name = "FactsheetProbeTimeoutError";
    this.deadlineMs = deadlineMs;
  }
}

/**
 * Phase 167.2.1 (D-04, D-09) — can this strategy's factsheet build, answered by
 * the builder's own code without building it. It creates the same service-role
 * client and runs the SAME resolve stage `fetchAndBuildPayload` runs, and
 * nothing else: no build, no compute. Since review round 1 (WR-05) the resolve
 * stage holds the gated MTM and smoothed series reads of a single-key row, as
 * it already held a composite's, so the probe reads them too for a row that
 * carries a by-basis object, and answers a failed one `read_error` exactly as
 * the build does. A row with no by-basis object reads no series.
 *
 * INVARIANT: every null exit of `fetchAndBuildPayload` lives in that shared
 * resolve stage, so `probe.buildable === (fetchAndBuildPayload(id, v) !== null)`
 * for the same id, predicate and rows. DOMAIN: this holds for a builder that
 * does not throw. A throw in the build is not a null exit, and the probe
 * cannot see it; the page's own error handling owns that case. A FAILED series
 * read is no longer such a throw: it is `read_error` on both sides.
 * So "buildable" means "no null exit", not "renders" (167.2.1-REVIEW IN-03): a
 * share note chosen from this answer is silent about a builder throw at the
 * recipient's request, which is outside the note's domain.
 * WHAT HOLDS IT (167.2.1-REVIEW WR-04, corrected). The invariant is
 * structural, not sampled: `buildFromResolved` and `buildFromBuildableSeries`
 * declare a non-null return, and the resolved series is a `BuildableSeries`,
 * so a `return null` added past the resolve stage FAILS TO COMPILE.
 * `fetch-and-build-payload.test.ts` pins those declarations and the two gates
 * of `buildFactsheetPayload` by source scan (a widened return type or a third
 * gate is RED there), and samples the behaviour with the parity table. A
 * rebase that needs a new null exit moves it INTO the resolve stage, never
 * special-cases the probe (the D-09 post-rebase rule).
 *
 * `visibility` is REQUIRED for the reason `StrategyVisibility` gives: on the
 * service role the predicate is the only row gate. The probe does not catch a
 * throw; the caller maps a throw to "unreadable" (D-05). A probe past its
 * deadline rejects with `FactsheetProbeTimeoutError` (SFH-R2 N-3). The
 * deadline aborts the strategies read. It cannot abort a composite's
 * `csv_daily_returns` read, which `readCompositeFactsheet` issues without a
 * signal, nor a gated MTM or smoothed series read, so those may finish in the
 * background after the probe has answered.
 *
 * ⛔ Never route this probe through the cached wrapper
 * `buildFactsheetPayloadCached` (D-11): its key carries no viewer, so it would
 * serve one viewer's answer to every later reader of that id.
 */
export async function probeFactsheetBuildable(
  id: string,
  visibility: StrategyVisibility,
  deadlineMs: number = FACTSHEET_PROBE_DEADLINE_MS,
): Promise<FactsheetBuildability> {
  // 167.2.1-REVIEW-SFH-R2 N-3: the probe answers within `deadlineMs` or
  // rejects with a `FactsheetProbeTimeoutError`, and the deadline aborts the
  // admin strategies read so the abandoned request stops.
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new FactsheetProbeTimeoutError(deadlineMs));
    }, deadlineMs);
  });
  const answer = (async (): Promise<FactsheetBuildability> => {
    const supabase = createAdminClient();
    const resolved = await resolveFactsheetInputs(supabase, id, visibility, "probe", controller.signal);
    if (!resolved.ok) {
      // WR-01: the reason and its detail, never captured here (see ResolveCaller).
      const { ok: _ok, ...refusal } = resolved;
      return { buildable: false, ...refusal };
    }
    return { buildable: true };
  })();
  try {
    // `Promise.race` subscribes to both, so the loser's rejection is handled.
    return await Promise.race([answer, deadline]);
  } finally {
    clearTimeout(timer);
  }
}
