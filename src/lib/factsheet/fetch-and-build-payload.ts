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
 * `unstable_cache` key on that route is id-ONLY, so any viewer-dependent
 * payload routed through the wrapper would be served to every later reader of
 * that id — anonymous ones included — for the full TTL. A lane needing a
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
import { displayStrategyName } from "@/lib/strategy-display";
import { isComputedAnalytics } from "@/lib/closed-sets";
import { buildFactsheetPayload, deriveIngestSource, hasBuildableSeries, MIN_FACTSHEET_SERIES_POINTS } from "./build-payload";
import type { BuildFactsheetOpts } from "./build-payload";
import { readCompositeFactsheet, singleKeyDataQuality, readSingleKeyBasisOpts } from "./composite-read-path";
import { resolveDailyReturnSeries } from "./allocator-portfolio-payload";
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
 * finding no row under the visibility predicate; `not_computed` is an analytics
 * row that is not a terminal success; `composite_unbuildable` is EVERY composite
 * failure (a missing headline, an empty or failed csv read, too few points),
 * because `readCompositeFactsheet` folds a read error into an empty series and
 * the probe cannot tell them apart; `too_few_points` is a single-key series
 * below `MIN_FACTSHEET_SERIES_POINTS` distinct dated returns.
 */
export type NotBuildableReason =
  | "read_error"
  | "not_visible"
  | "not_computed"
  | "composite_unbuildable"
  | "too_few_points";

/** The probe's answer: buildable, or not buildable with a typed reason. */
export type FactsheetBuildability =
  | { buildable: true }
  | { buildable: false; reason: NotBuildableReason };

/**
 * 167.2.1-REVIEW-SFH M-1 — who ran the resolve stage. Every resolve log line
 * carries it, in its prefix and its payload, so a probe on /strategies never
 * reads in the logs as a factsheet build that did not happen.
 */
type ResolveCaller = "build" | "probe";

/** A failed resolve: the builder returns null, the probe returns this reason. */
function notBuildable(reason: NotBuildableReason): { ok: false; reason: NotBuildableReason } {
  return { ok: false, reason };
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
) {
  const { data: strategy, error } = await visibility(
    supabase
      .from("strategies")
      .select(
        `id, name, codename, disclosure_tier, status, markets, strategy_types,
       description, subtypes, supported_exchanges, leverage_range, aum,
       max_capacity, avg_daily_turnover, start_date, benchmark, asset_class,
       returns_denominator_config,
       strategy_analytics ( daily_returns, returns_series, computed_at, data_quality_flags, metrics_json_by_basis, computation_status )`,
      )
      .eq("id", id),
  )
    .maybeSingle();
  if (error || !strategy) {
    console.warn(`[factsheet] resolve(${caller}) — admin read returned no strategy`, {
      id,
      caller,
      hasError: !!error,
      errorMessage: error?.message,
      errorCode: error?.code,
    });
    return notBuildable(error ? "read_error" : "not_visible");
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
  if (isComposite) {
    // H-2: the composite read-path is shared with the discovery detail page via
    // `readCompositeFactsheet` so the two surfaces can't diverge (the "one path"
    // lesson). It REUSES the in-scope service-role admin `supabase` handle
    // already created above under the SAME injected `visibility` predicate
    // boundary — NO new client, NO broader privilege; the outer request-scoped
    // RLS signature probe + notFound() remains the unchanged auth gate. The
    // helper carries C-1 (config-driven method), F1/H-1 (headline gate), F2/M-1
    // (MTM gate) and the FS-01/02 markers. A null result = data defect → the
    // "still computing" placeholder below.
    const composite = await readCompositeFactsheet(supabase, {
      strategyId: id,
      dqf,
      metricsJsonByBasis: analytics?.metrics_json_by_basis,
      returnsDenominatorConfig: strategy.returns_denominator_config,
    });
    if (!composite) return notBuildable("composite_unbuildable");
    dailyReturns = composite.dailyReturns;
    compositeBuildOpts = composite.buildOpts;
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
    return notBuildable(isComposite ? "composite_unbuildable" : "too_few_points");
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
    return notBuildable(isComposite ? "composite_unbuildable" : "too_few_points");
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
 * CACHE KEY REALITY (corrected phase 148 — the previous claim here was false).
 * The `cacheKey` string the page passes in is split at "::" and everything
 * after the id is DISCARDED (`buildFactsheetPayloadCached`, which stays in
 * `src/app/factsheet/[id]/v2/page.tsx`). The
 * effective unstable_cache key is id-ONLY: Next derives it from the callback's
 * source text plus the keyParts ["factsheet-v2-payload-v6", id] and an empty
 * args array. So a fresh `strategy_analytics.computed_at` does NOT bust this
 * cache — entries live the full revalidate=3600s, or until the admin publish
 * flow calls revalidateTag(`factsheet-v2:${id}`). Tag-based revalidation is
 * what actually handles publish/unpublish flips. (The resulting staleness
 * window is a known, logged item — see TODOS.md, phase 148 — deliberately not
 * fixed here.)
 *
 * ⛔ Corollary: viewer/lane separation can NEVER be expressed through the
 * cacheKey string. Appending a suffix yields the SAME entry, so any
 * viewer-dependent payload built through the cached wrapper would be served to
 * every subsequent reader — including anonymous ones — for the full TTL. A
 * viewer-dependent payload must bypass the cached wrapper entirely, which is
 * why the wrapper in `v2/page.tsx` hard-codes its predicate instead of
 * accepting one.
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
  | { payload: FactsheetPayload; reason: null }
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
  return { payload: await buildFromResolved(supabase, id, resolved), reason: null };
}

/** A resolve that succeeded: the inputs the build runs on. */
type ResolvedFactsheetInputs = Extract<
  Awaited<ReturnType<typeof resolveFactsheetInputs>>,
  { ok: true }
>;

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
  const { strategy, analytics, dqf, isComposite, dailyRaw, dailyReturns } = resolved;

  // Ingest source classifies daily_returns (CSV path) vs returns_series-only
  // (live API path). The empty-array-is-csv invariant (FINDING-1) + the
  // no-invented-data rationale (NEW-C20-01) live in deriveIngestSource — the
  // single source of truth shared with the discovery page and pinned by
  // audit-c20's RED-TEAM-H1.
  const ingestSource: IngestSource = deriveIngestSource(dailyRaw);

  let buildOpts: BuildFactsheetOpts | undefined = resolved.compositeBuildOpts;
  if (!isComposite) {
    // HARD-04 (#67) / Finding B: single-key strategies persist
    // `insufficient_window` at the analytics_runner CAGR site too, but buildOpts
    // was assigned ONLY on the composite arm, so `payload.dataQuality` stayed
    // undefined and the FactsheetView :876 caveat never rendered single-key
    // despite the server truth. Thread it through the ONE shared owner
    // (`singleKeyDataQuality`) so this route and the discovery detail page can't
    // diverge on the DQ opt (the composite "one path" lesson).
    //
    // MTM-01 (Phase 102): a single-key OPTIONS strategy also persists its MTM
    // basis (`metrics_json_by_basis.mark_to_market`) + an honest degrade reason.
    // The F-4 `computation_status`-DONE gate was documented as riding a
    // computed_at-bearing cache key; it does NOT — the effective key is id-only
    // and a re-derive does not bust it (see the corrected header comment above).
    // The gate is still correct, it just drains on the TTL / publish tag rather
    // than on a fresh computed_at. Status is public-safe on a published row
    // (unchanged RLS boundary — the outer
    // request-scoped signature probe stays the auth gate). The assembly returns
    // `{}` for every non-options single-key strategy → byte-identical.
    //
    // MTM-04 (Phase 103) + SMTM-01 (Phase 133, review WR-01): the persisted
    // `mtm_daily_returns` / `smoothed_mtm_daily_returns` series reads (so charts
    // follow the toggle) and the gate/scalar/series threading are assembled by
    // the ONE shared owner `readSingleKeyBasisOpts` — the SAME assembly the
    // discovery detail page calls, so the two surfaces cannot diverge (WR-01 was
    // exactly a per-page inline copy drifting). The reads ride the SAME
    // service-role admin `supabase` handle (deny-all RLS on
    // strategy_analytics_series — no visibility widening, same gate as the
    // scalar objects), gated by the shared cheap predicates so the hot
    // non-options path stays roundtrip-free. A failed/malformed row degrades to
    // no-bundle (charts stay cash).
    buildOpts = {
      ...(buildOpts ?? {}),
      dataQuality: singleKeyDataQuality(dqf),
      ...(await readSingleKeyBasisOpts(
        () => supabase,
        id,
        dqf,
        analytics?.metrics_json_by_basis,
        analytics?.computation_status,
      )),
    };
  }

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
 * Phase 167.2.1 (D-04, D-09) — can this strategy's factsheet build, answered by
 * the builder's own code without building it. It creates the same service-role
 * client and runs the SAME resolve stage `fetchAndBuildPayload` runs, and
 * nothing else: no basis reads, no compute.
 *
 * INVARIANT: every null exit of `fetchAndBuildPayload` lives in that shared
 * resolve stage, so `probe.buildable === (fetchAndBuildPayload(id, v) !== null)`
 * for the same id, predicate and rows. DOMAIN: this holds for a builder that
 * does not throw. A throw in the basis reads or the build is not a null exit,
 * and the probe cannot see it; the page's own error handling owns that case.
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
 * throw; the caller maps a throw to "unreadable" (D-05).
 *
 * ⛔ Never route this probe through the id-keyed cached wrapper
 * `buildFactsheetPayloadCached` (D-11): an id-only cache key would serve one
 * viewer's answer to every later reader of that id.
 */
export async function probeFactsheetBuildable(
  id: string,
  visibility: StrategyVisibility,
): Promise<FactsheetBuildability> {
  const supabase = createAdminClient();
  const resolved = await resolveFactsheetInputs(supabase, id, visibility, "probe");
  if (!resolved.ok) return { buildable: false, reason: resolved.reason };
  return { buildable: true };
}
