import { Breadcrumb } from "@/components/layout/Breadcrumb";
import { RequestIntroButton } from "@/components/strategy/RequestIntroButton";
import { BookIntroCall } from "@/components/strategy/BookIntroCall";
import { ShareableLink } from "@/components/strategy/ShareableLink";
import { AddToPortfolio } from "@/components/portfolio/AddToPortfolio";
import { FactsheetView } from "@/app/factsheet/[id]/v2/FactsheetView";
import { DISCOVERY_CATEGORIES } from "@/lib/constants";
import { getStrategyDetail } from "@/lib/queries";
import { displayStrategyName } from "@/lib/strategy-display";
import { KCS10_PUBLIC_SENTENCE } from "@/lib/status-surface-copy";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { captureToSentry } from "@/lib/sentry-capture";
import { buildFactsheetPayload, deriveIngestSource } from "@/lib/factsheet/build-payload";
import type { BuildFactsheetOpts } from "@/lib/factsheet/build-payload";
import {
  CompositeSeriesReadError,
  readCompositeFactsheet,
  singleKeyDataQuality,
  readSingleKeyBasisOpts,
} from "@/lib/factsheet/composite-read-path";
import { resolveDailyReturnSeries } from "@/lib/factsheet/allocator-portfolio-payload";
import type { DailyReturn, TrustTierKind, IngestSource } from "@/lib/factsheet/types";
import { notFound, redirect } from "next/navigation";

/**
 * 169-REVIEW-SFH H-3: what this page says when a factsheet series read FAILS
 * (`CompositeSeriesReadError`): a composite's `csv_daily_returns`, or since
 * review round 1 (T5) any series the single-key assembly reads (the MTM,
 * smoothed MTM or stored cash series). KCS-10's "not
 * available yet" describes the row as not ready, which is false for an outage:
 * the row may be fine and the next request reads again. Active voice with the
 * owner lane's retry remedy (KCS09-UNREADABLE, "Reload this page to try
 * again."). The public v2 lane has no counterpart: it renders KCS-10 on a
 * `read_error` by design, so this sentence lives here, next to its one caller.
 * Its home is `status-surface-copy.ts` if Phase 169.1 plan 169.1-01 does not
 * retire this page's assembly.
 */
const SERIES_READ_FAILED_SENTENCE =
  "We could not load this strategy's factsheet right now. Reload this page to try again.";

/**
 * 169-REVIEW-SFH H-3, extended to the single-key arm in review round 1 (T5): a
 * series read outage on this page is logged and captured to Sentry once
 * (`console.error` alone never reaches Sentry: `src/instrumentation.ts`
 * registers no console integration). The reader's own error is sent, so its
 * PostgREST message rides as `cause`, which `captureToSentry` folds, scrubbed,
 * into the event message. `read` is the error's own discriminant: since T1
 * (WR-05 / M-3) the composite reader can also throw for its MTM and smoothed
 * reads, so a fixed `csv_daily_returns` tag would misname those. `stage` names
 * which assembly read it.
 */
function reportSeriesReadFailure(
  err: CompositeSeriesReadError,
  strategyId: string,
  stage: "composite-read" | "single-key-read",
): void {
  console.error(
    `[discovery/strategyDetail] ${err.read} read failed, rendering the read-failure line`,
    {
      strategyId,
      stage,
      errorCode: err.code,
      errorMessage: typeof err.cause === "string" ? err.cause : undefined,
    },
  );
  captureToSentry(err, {
    level: "error",
    tags: {
      route: "discovery/strategy-detail",
      stage,
      reason: "read_error",
      code: err.code,
      strategy_id: strategyId,
      read: err.read,
    },
  });
}

export default async function StrategyDetailPage({
  params,
}: {
  params: Promise<{ slug: string; strategyId: string }>;
}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { slug, strategyId } = await params;
  const cat = DISCOVERY_CATEGORIES.find((c) => c.slug === slug);
  // Audit 2026-05-07 G11.E.7: unknown slug → 404 immediately. Avoids
  // even firing the strategy fetch for slugs not on the published list.
  if (!cat) notFound();

  // Audit 2026-05-07 G11.E.7: pass the slug to getStrategyDetail so the
  // `discovery_categories!inner(slug)` filter rejects strategy/slug
  // mismatches at the SQL layer (returns null → not-found UI). Without
  // this, /discovery/<wrong-slug>/<strategyId> renders the full chart
  // suite + RSC payload for any published strategy.
  // Phase 159 (159-03 / RANK-02): "discovery" opts this AUTHED surface into the
  // wider analytics projection — data_quality_flags, daily_returns,
  // returns_series and metrics_json_by_basis, every one of which is read below.
  // The default "public" variant deliberately omits them, so a future ANON
  // caller of getStrategyDetail cannot inherit this surface's column set.
  const result = await getStrategyDetail(strategyId, slug, "discovery");
  if (!result) notFound();

  const { strategy, analytics, disclosureTier } = result;
  // Breadcrumb still uses the pseudonym-safe label (it shows in the
  // sidebar context above the factsheet). The factsheet body itself is a
  // full-identity context and uses the real name when present.
  const breadcrumbName = displayStrategyName(strategy);
  const factsheetName =
    strategy.name ?? strategy.codename ?? breadcrumbName;
  const displayName = factsheetName;

  // analytics-service-only strategies have daily_returns=null but the
  // real cumprod equity curve in returns_series. resolveDailyReturnSeries
  // handles both shapes + the three real-world daily_returns dict layouts.
  const analyticsRow = analytics as
    | {
        daily_returns?: unknown;
        returns_series?: unknown;
        data_quality_flags?: unknown;
        metrics_json_by_basis?: unknown;
        computation_status?: unknown;
      }
    | null
    | undefined;
  const dailyRaw = analyticsRow?.daily_returns;
  let dailyReturns = resolveDailyReturnSeries(
    dailyRaw,
    analyticsRow?.returns_series,
  );

  // Derive ingestSource through the SHARED deriveIngestSource (same source of
  // truth as factsheet/[id]/v2/page.tsx). Without an explicit source,
  // buildFactsheetPayload defaults to "csv" and all gated panels (PeerPercentile,
  // AllocatorSection, Signatures) are permanently suppressed for API strategies
  // on the discovery surface. (RED-TEAM-H1)
  let ingestSource: IngestSource = deriveIngestSource(dailyRaw);

  // H-2 (Round 2): a stitched composite has daily_returns=NULL + returns_series
  // populated, so the plain path above would classify it "api" (invented
  // PeerPercentile / AllocatorSection / EventSignatures) and draw a dense-0.0
  // gap-filled series (flat-zero gap lines). Route it through the SAME shared
  // composite read-path the factsheet route uses: force ingestSource "csv"
  // (suppresses the invented panels), read the honest sparse csv_daily_returns
  // series, and thread the marker/basis/method opts. A null result = data defect
  // → the still-computing placeholder (never the api arm).
  const dqf = analyticsRow?.data_quality_flags as
    | { composite?: unknown; mtm_gated_reason?: unknown; per_key?: unknown; gap_spans?: unknown; insufficient_window?: unknown; cumulative_method?: unknown }
    | null
    | undefined;
  let buildOpts: BuildFactsheetOpts | undefined;
  // A series read outage on either arm below (`CompositeSeriesReadError`): the
  // payload is not built, and the fallback says the load failed.
  let seriesReadFailed = false;
  if (dqf?.composite === true) {
    ingestSource = "csv";
    const admin = createAdminClient();
    // Phase 169 (D-41): a FAILED `csv_daily_returns` read throws
    // `CompositeSeriesReadError`. It is caught here, and only it: this page is
    // dynamic and not cached, so the answer holds for this one request and the
    // next request reads again. Any other throw is not an outage this page can
    // name and stays the error boundary's. Phase 169.1 plan 169.1-01 removes
    // this assembly in favour of `fetchAndBuildPayload`, whose resolve stage
    // already answers the same throw as `read_error`.
    //
    // 169-REVIEW-SFH H-3: the outage is captured to Sentry, as the resolve
    // stage captures it for a build, and the page says the load failed rather
    // than KCS-10's "not available yet" (`reportSeriesReadFailure`).
    let composite: Awaited<ReturnType<typeof readCompositeFactsheet>>;
    try {
      composite = await readCompositeFactsheet(admin, {
        strategyId: strategy.id,
        dqf,
        metricsJsonByBasis: analyticsRow?.metrics_json_by_basis,
        returnsDenominatorConfig: (strategy as { returns_denominator_config?: unknown })
          .returns_denominator_config,
      });
    } catch (err) {
      if (!(err instanceof CompositeSeriesReadError)) throw err;
      reportSeriesReadFailure(err, strategy.id, "composite-read");
      seriesReadFailed = true;
      composite = null;
    }
    if (composite) {
      dailyReturns = composite.dailyReturns;
      buildOpts = composite.buildOpts;
    } else {
      // Data defect (untrusted cash headline), or the read outage caught
      // above → empty series → no payload. The fallback below tells the two
      // apart through `seriesReadFailed`.
      dailyReturns = [] as DailyReturn[];
    }
  } else {
    // HARD-04 (#67) / Finding B: single-key strategies persist
    // `insufficient_window` at the analytics_runner CAGR site too, but buildOpts
    // was assigned ONLY on the composite arm, so `payload.dataQuality` stayed
    // undefined and the FactsheetView :876 caveat never rendered single-key
    // despite the server truth. Thread it through the ONE shared owner
    // (`singleKeyDataQuality`) so this discovery surface and the factsheet route
    // can't diverge on the DQ opt (the composite "one path" lesson).
    //
    // MTM-01/MTM-04 (Phases 102/103) + SMTM-01 (Phase 133, review WR-01): the
    // single-key basis story (predicates → gated `mtm_daily_returns` /
    // `smoothed_mtm_daily_returns` reads → gate/scalar/series threading) is
    // assembled by the ONE shared owner `readSingleKeyBasisOpts`, so this
    // surface and the factsheet route cannot diverge — WR-01 was exactly this
    // page keeping an inline 4-arg copy when the smoothed 5th arg landed
    // (Smoothed segment enabled, charts permanently cash). getStrategyDetail
    // is called above with the "discovery" variant, whose explicit projection
    // (queries.ts, Phase 159/RANK-02) names `computation_status` as a MUST-STAY
    // column precisely so it still arrives on the row — it used to arrive via a
    // wildcard analytics embed, which no longer exists. Narrowing that constant
    // without this read in mind is the way to break this line silently.
    //
    // Phase 169 (SC4, D-10): the row itself is passed too, so the owner can
    // overlay its seven persisted headline scalars (the same projection carries
    // them: `PUBLIC_ANALYTICS_COLUMNS` in queries.ts). A rankable single-key row
    // therefore renders the stored CAGR and Sharpe that discovery,
    // recommendations and my-strategies show, and the payload is no longer the
    // TypeScript-only headline. A row that is not rankable keeps the computed
    // headline; that arm is reachable from this page only (the factsheet route's
    // resolve stage refuses such a row), until Phase 169.1 plan 169.1-01 moves
    // this page onto the shared build. The series rows live behind deny-all RLS,
    // so the assembly takes the service-role factory as a thunk — the handle is
    // constructed only when a cheap gate holds (hot path stays roundtrip-free).
    //
    // Phase 169 review round 1 (T5, from T1's handoff):
    //   - SFH H-2 / M-2: the strategy's `returns_denominator_config` is passed
    //     (the 7th argument, the same column the composite arm reads above), so a
    //     single-key `simple` row draws its arithmetic curve here too, and an
    //     active-day or `simple` row is flagged `returnsConventionOverride`, which
    //     withholds the leverage what-if. Without it this page kept the geometric
    //     curve and the what-if the factsheet route no longer shows.
    //   - WR-05 / M-3: the owner now THROWS `CompositeSeriesReadError` on a failed
    //     MTM, smoothed MTM or stored cash series read, where it used to degrade
    //     to cash charts. It is caught exactly as the composite arm catches it
    //     (that class only, any other throw stays the error boundary's): the
    //     outage is captured and the page says the load failed. A partial payload
    //     is not built: it would show cash charts under an MTM label as if the
    //     row had no MTM series.
    let singleKeyOpts: Awaited<ReturnType<typeof readSingleKeyBasisOpts>> | null;
    try {
      singleKeyOpts = await readSingleKeyBasisOpts(
        createAdminClient,
        strategy.id,
        dqf,
        analyticsRow?.metrics_json_by_basis,
        analyticsRow?.computation_status,
        analyticsRow,
        (strategy as { returns_denominator_config?: unknown }).returns_denominator_config,
      );
    } catch (err) {
      if (!(err instanceof CompositeSeriesReadError)) throw err;
      reportSeriesReadFailure(err, strategy.id, "single-key-read");
      seriesReadFailed = true;
      singleKeyOpts = null;
    }
    if (singleKeyOpts) {
      buildOpts = {
        ...(buildOpts ?? {}),
        dataQuality: singleKeyDataQuality(dqf),
        ...singleKeyOpts,
      };
    } else {
      // The read outage caught above → empty series → no payload, and the
      // fallback says the load failed.
      dailyReturns = [] as DailyReturn[];
    }
  }

  // RED-TEAM-H2: Never fall back to "now" for a missing computed_at — that
  // would make FreshnessChip show a green "fresh" badge for a strategy with
  // no real analytics data. Mirror the epoch sentinel from page.tsx so the
  // chip correctly signals staleness. Consistent with FINDING-5 fix.
  if (!analytics?.computed_at) {
    console.warn(
      "[discovery/strategyDetail] analytics.computed_at missing, freshness chip will show epoch",
      { strategyId },
    );
  }
  const computedAt = analytics?.computed_at ?? "1970-01-01T00:00:00Z";

  const factsheetPayload = buildFactsheetPayload(
    {
      id: strategy.id,
      name: factsheetName,
      types: strategy.strategy_types ?? [],
      markets: strategy.markets ?? [],
      computedAt,
      trustTier: (strategy.trust_tier ?? null) as TrustTierKind | null,
      ingestSource,
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

  return (
    <>
      <Breadcrumb
        items={[
          { label: "Discovery", href: "/discovery/crypto-sma" },
          { label: cat?.name ?? slug, href: `/discovery/${slug}` },
          { label: breadcrumbName },
        ]}
      />
      <div className="mb-4 flex flex-wrap items-center justify-end gap-3">
        {/* Phase 164 (SHARE-04) — `published` is a literal true here, and that
            is a claim this page can actually make: `getStrategyDetail` wraps its
            query in `withPublishedOnly` and returns null otherwise, so an
            unpublished strategy `notFound()`s above and never reaches this JSX.
            The projection deliberately omits `status` (see the comment on
            `getStrategyDetail`), so reading `strategy.status` here would yield
            `undefined` and fail CLOSED into the mint lane — a token link for a
            strategy that already has a public URL. Behaviour is unchanged; the
            site now consumes the same component contract as the other two,
            which is the whole point of the task. */}
        <ShareableLink strategyId={strategy.id} published variant="primary" />
        {disclosureTier === "institutional" && (
          <a
            href={`/factsheet/${strategy.id}/tearsheet`}
            target="_blank"
            className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-text-secondary hover:bg-page transition-colors"
          >
            Tear Sheet
          </a>
        )}
        <AddToPortfolio strategyId={strategy.id} />
        <BookIntroCall strategyName={displayName} />
        <RequestIntroButton strategyId={strategy.id} />
      </div>

      {factsheetPayload ? (
        <FactsheetView payload={factsheetPayload} />
      ) : (
        <article className="mx-auto max-w-[760px] px-4 sm:px-6 lg:px-10 py-12">
          <p className="text-micro font-mono uppercase tracking-[0.22em] text-text-muted">
            Institutional Factsheet · Quantalyze
          </p>
          <h1 className="mt-2 font-serif text-page-title leading-tight text-text-primary">
            {displayName}
          </h1>
          {/* Phase 167.2 review-fix (167.2-REVIEW WR-01): the one KCS-10
              sentence, imported from where it is authored, so this surface and
              the v2 public lane cannot diverge. The sentence it replaces
              promised a compute that may never come (a failed chain, or a
              series that cannot build, does not resolve on its own) and named
              an internal pipeline to allocators (phase 164.2 criterion 9). */}
          <p className="mt-6 text-small text-text-secondary">
            {seriesReadFailed ? SERIES_READ_FAILED_SENTENCE : KCS10_PUBLIC_SENTENCE}
          </p>
        </article>
      )}

      <div className="fixed bottom-0 left-0 right-0 md:left-[260px] z-10 border-t border-border bg-white/95 backdrop-blur-sm px-6 py-3 flex items-center justify-between">
        <p className="text-sm text-text-secondary hidden sm:block">
          Interested in{" "}
          <span className="font-medium text-text-primary">{displayName}</span>?
        </p>
        <RequestIntroButton strategyId={strategy.id} />
      </div>
    </>
  );
}
