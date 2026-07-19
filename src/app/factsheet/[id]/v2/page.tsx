import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { unstable_cache } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { withPublishedOnly } from "@/lib/visibility";
import { displayStrategyName } from "@/lib/strategy-display";
import type { DisclosureTier } from "@/lib/types";
import { readPublicVerificationSignals } from "@/lib/queries";
import { buildFactsheetPayload, deriveIngestSource } from "@/lib/factsheet/build-payload";
import type { BuildFactsheetOpts } from "@/lib/factsheet/build-payload";
import { readCompositeFactsheet, singleKeyDataQuality, singleKeyBasisOpts, shouldReadSingleKeyMtmSeries, readMtmSeries } from "@/lib/factsheet/composite-read-path";
import { resolveDailyReturnSeries } from "@/lib/factsheet/allocator-portfolio-payload";
import type { FactsheetPayload, TrustTierKind, IngestSource } from "@/lib/factsheet/types";
import { FactsheetView } from "./FactsheetView";

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
 * Cache key = `${id}::${computedAt}` so a new analytics row automatically
 * misses cache. Tag-based revalidation handles publish/unpublish flips.
 */
async function fetchAndBuildPayload(id: string): Promise<FactsheetPayload | null> {
  const supabase = createAdminClient();
  const { data: strategy, error } = await withPublishedOnly(
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
    console.warn("[factsheet] fetchAndBuildPayload — admin probe returned no strategy", {
      id,
      hasError: !!error,
      errorMessage: error?.message,
      errorCode: error?.code,
    });
    return null;
  }

  const analytics = Array.isArray(strategy.strategy_analytics)
    ? strategy.strategy_analytics[0]
    : strategy.strategy_analytics;
  const dailyRaw = analytics?.daily_returns;
  // resolveDailyReturnSeries handles two real-world realities at once:
  //   (a) `daily_returns` may be in one of three shapes (array of
  //       {date,value}, flat {date:value} dict, nested {year:{MM-DD:value}}).
  //   (b) analytics-service-only strategies have `daily_returns=null`; the
  //       real series lives in `returns_series` as a cumprod equity curve.
  // Both gates have to fall before we render the "still computing"
  // placeholder.
  let dailyReturns = resolveDailyReturnSeries(dailyRaw, analytics?.returns_series);
  // Ingest source classifies daily_returns (CSV path) vs returns_series-only
  // (live API path). The empty-array-is-csv invariant (FINDING-1) + the
  // no-invented-data rationale (NEW-C20-01) live in deriveIngestSource — the
  // single source of truth shared with the discovery page and pinned by
  // audit-c20's RED-TEAM-H1.
  const ingestSource: IngestSource = deriveIngestSource(dailyRaw);

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
  let buildOpts: BuildFactsheetOpts | undefined;
  if (isComposite) {
    // H-2: the composite read-path is shared with the discovery detail page via
    // `readCompositeFactsheet` so the two surfaces can't diverge (the "one path"
    // lesson). It REUSES the in-scope service-role admin `supabase` handle
    // already created above under the SAME `withPublishedOnly` visibility
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
    if (!composite) return null;
    dailyReturns = composite.dailyReturns;
    buildOpts = composite.buildOpts;
  } else {
    // HARD-04 (#67) / Finding B: single-key strategies persist
    // `insufficient_window` at the analytics_runner CAGR site too, but buildOpts
    // was assigned ONLY on the composite arm, so `payload.dataQuality` stayed
    // undefined and the FactsheetView :876 caveat never rendered single-key
    // despite the server truth. Thread it through the ONE shared owner
    // (`singleKeyDataQuality`) so this route and the discovery detail page can't
    // diverge on the DQ opt (the composite "one path" lesson).
    //
    // MTM-01 (Phase 102): a single-key OPTIONS strategy also persists its MTM
    // basis (`metrics_json_by_basis.mark_to_market`) + an honest degrade reason,
    // read through the SAME shared owner (`singleKeyBasisOpts`) both surfaces use.
    // The F-4 `computation_status`-DONE gate rides the `${id}::${computedAt}` cache
    // key (:344) because a re-derive stamps a fresh computed_at; status is
    // public-safe on a published row (unchanged RLS boundary — the outer
    // request-scoped signature probe stays the auth gate). singleKeyBasisOpts
    // returns `{}` for every non-options single-key strategy → byte-identical.
    //
    // MTM-04 (Phase 103): additionally read the persisted `mtm_daily_returns`
    // series so charts follow the toggle. Gated by the SHARED cheap predicate
    // (`shouldReadSingleKeyMtmSeries`) so the hot non-options path stays
    // roundtrip-free and both surfaces read identically; the series is read via
    // the SAME service-role admin `supabase` handle (deny-all RLS on
    // strategy_analytics_series — no visibility widening, same gate as the scalar
    // MTM object) and threaded as the 4th arg. A failed/malformed row degrades to
    // no-bundle (charts stay cash).
    const mtmSeries = shouldReadSingleKeyMtmSeries(
      analytics?.metrics_json_by_basis,
      analytics?.computation_status,
    )
      ? await readMtmSeries(supabase, id)
      : null;
    buildOpts = {
      ...(buildOpts ?? {}),
      dataQuality: singleKeyDataQuality(dqf),
      ...singleKeyBasisOpts(dqf, analytics?.metrics_json_by_basis, analytics?.computation_status, mtmSeries),
    };
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
      "[factsheet] fetchAndBuildPayload — both daily_returns and returns_series populated; ingestSource='csv' applied conservatively",
      { id },
    );
  }
  if (dailyReturns.length === 0) {
    console.warn("[factsheet] fetchAndBuildPayload — no usable return series after normalization + equity-curve fallback", {
      id,
      hasAnalytics: !!analytics,
      dailyType: typeof dailyRaw,
      isArray: Array.isArray(dailyRaw),
      returnsSeriesType: typeof analytics?.returns_series,
    });
    return null;
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

function buildFactsheetPayloadCached(
  cacheKey: string,
): Promise<FactsheetPayload | null> {
  const [id] = cacheKey.split("::");
  // Per-id `factsheet-v2:${id}` tag lets admin status flips invalidate ONE
  // strategy's payload rather than busting every factsheet at once. The
  // global `factsheet-v2` tag is retained so a schema-level migration can
  // still wipe the whole surface with a single `revalidateTag` call.
  return unstable_cache(
    async () => fetchAndBuildPayload(id),
    // Cache key carries a shape-version suffix. Bump it (e.g. -v2 → -v3)
    // whenever FactsheetPayload adds non-optional fields, so unstable_cache
    // entries from the previous shape don't crash readers expecting the new
    // fields. The factsheet-v2:* tags below still revalidate old entries.
    // Bumped v2→v3: ingestSource field added in this PR. Stale v2 entries
    // lack the field; deserialized payload would have ingestSource=undefined,
    // which evaluates !== "api" and silently suppresses all gated panels
    // (PeerPercentile, AllocatorSection, Signatures) for legitimate API
    // strategies during the TTL drain window. (RED-TEAM-C1)
    // Bumped v3→v4 (Phase 90): composite payloads now carry five OPTIONAL
    // fields (segmentBoundaries / missingSegments / metricsByBasis / mtmGate /
    // dataQuality). Because they are optional-absent, a stale v3 entry
    // deserialized as v4 degrades gracefully (missing marker/basis fields → no
    // toggle / no markers during the TTL drain, never a crash) — the bump is
    // belt-and-suspenders. `computedAt` in the key busts on any re-stitch.
    // Bumped v4→v5 (Phase 90.5): payload carries optional periodsPerYear for the
    // client leverage recompute; stale v4 entries lack it -> leverage control
    // hidden (fail-closed) during the TTL drain, never a crash.
    // Bumped v5→v6 (Phase 103, F7): the low-N reliability warning now REQUIRES
    // `bootstrapCI.n` (the resample count). A stale v5 entry missing that field
    // deserializes with `n` undefined, so `n < 252` is false and the warning is
    // wrongly SUPPRESSED (for cash too) during the 1h TTL drain. Busting the shape
    // version forces a fresh build carrying `bootstrapCI.n` rather than silently
    // hiding the caveat.
    ["factsheet-v2-payload-v6", id],
    {
      revalidate: 3600,
      tags: ["factsheet-v2", `factsheet-v2:${id}`],
    },
  )();
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const supabase = await createClient();
  const { data } = await withPublishedOnly(
    supabase
      .from("strategies")
      .select("id, name, codename, description, disclosure_tier")
      .eq("id", id),
  )
    .maybeSingle();
  // Factsheet is a full-identity context: prefer the real name in the
  // <title> tag too, not just the H1. displayStrategyName redacts
  // exploratory-tier names to "Strategy #<hex>", which is correct for
  // Match Queue surfaces but wrong here — and it diverges from the H1
  // the user already sees on the page.
  const name = data?.name ?? data?.codename ?? (data ? displayStrategyName({
    id: data.id,
    name: data.name,
    codename: data.codename,
    disclosure_tier: data.disclosure_tier as DisclosureTier | null,
  }) : "Strategy");
  const description = (data?.description ?? "Institutional strategy factsheet on Quantalyze.").slice(0, 200);
  const title = `${name} — Quantalyze Factsheet`;
  // Dynamic OG image — uses the strategy-id-derived endpoint so social shares
  // get a meaningful preview card without baking PNGs at deploy time.
  const ogImage = `/api/og/factsheet/${id}`;
  return {
    title,
    description,
    robots: "noindex",
    openGraph: {
      title,
      description,
      type: "article",
      images: [{ url: ogImage, width: 1200, height: 630, alt: name }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [ogImage],
    },
  };
}

export default async function FactsheetV2Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  // Lightweight signature probe (id + name + computed_at) + the public trust
  // signal, in parallel. Strategy meta + dailyReturns are fetched INSIDE the
  // cached function so the cache key derivation doesn't serialize a multi-MB
  // array per hit. `name` / `codename` come along on the probe so the
  // payload-pending fallback below can name the strategy without a second query.
  //
  // Phase 126 (FACTSHEET-01, founder Option B — class closure): the trust_tier
  // read used to be an RLS-scoped strategy_verifications query on the request
  // client, which returned zero rows for every NON-owner viewer — so the
  // api_verified badge silently vanished on this PUBLIC factsheet for anon +
  // non-owner sessions. readPublicVerificationSignals sources it via the
  // service-role, published-scoped projection (trust_tier+status ONLY),
  // consistent with the SSR factsheet + browse. Fail-soft (logs to Sentry on a
  // read error): no signal -> null tier -> badge hides, page still renders.
  const [signRes, verificationSignals] = await Promise.all([
    withPublishedOnly(
      supabase
        .from("strategies")
        .select("id, name, codename, disclosure_tier, strategy_analytics ( computed_at )")
        .eq("id", id),
    )
      .maybeSingle(),
    readPublicVerificationSignals([id]),
  ]);

  const signature = signRes.data;
  if (signRes.error || !signature) {
    console.warn("[factsheet/v2/page] signature gate -> notFound", {
      id,
      hasError: !!signRes.error,
      errorCode: signRes.error?.code,
      errorMessage: signRes.error?.message,
      hasSignature: !!signature,
      hint: signRes.error
        ? "supabase query errored — check RLS on strategies / strategy_analytics for the calling user"
        : "no row matched (id, status='published') — strategy may be draft / archived or RLS-hidden",
    });
    notFound();
  }
  const signAnalytics = Array.isArray(signature.strategy_analytics)
    ? signature.strategy_analytics[0]
    : signature.strategy_analytics;
  const computedAt = signAnalytics?.computed_at ?? "0";

  const payload = await buildFactsheetPayloadCached(`${id}::${computedAt}`);
  if (!payload) {
    console.warn("[factsheet/v2/page] payload pending -> rendering fallback", {
      id,
      computedAt,
      hint: "buildFactsheetPayload returned null — check (a) admin client visibility on strategies row, (b) strategy_analytics.daily_returns shape, (c) series clipped to BENCH_START/BENCH_END (2023-04-26 onward) has at least 2 points",
    });
    // The strategy IS published (signature gate passed) but its analytics
    // payload couldn't be built. Render a friendly placeholder rather than
    // hard-404'ing: this is a transient state (analytics service still
    // computing) or a CSV-ingested strategy whose daily_returns are not
    // yet populated. Hard-404 only on the signature gate above.
    // Full-identity context — prefer the real name, fall back to the
    // pseudonym only when the strategy genuinely has no public name.
    const pendingName =
      signature.name ??
      signature.codename ??
      displayStrategyName({
        id: signature.id,
        name: null,
        codename: null,
        disclosure_tier: (signature.disclosure_tier ?? null) as DisclosureTier | null,
      });
    return (
      <article className="mx-auto max-w-[760px] px-4 sm:px-6 lg:px-10 py-12">
        <p className="text-fixed-10 font-mono uppercase tracking-[0.22em] text-text-muted">
          Institutional Factsheet · Quantalyze
        </p>
        <h1 className="mt-2 font-serif text-fixed-28 sm:text-fixed-36 leading-tight text-text-primary">
          {pendingName}
        </h1>
        <p className="mt-6 text-fixed-13 text-text-secondary">
          The detailed factsheet for this strategy is still computing.
          Daily-return data hasn&apos;t been ingested yet — once the
          analytics service finishes the first compute pass, the full panel
          set will render here.
        </p>
        <p className="mt-3 text-fixed-12 text-text-muted italic">
          If this persists for more than a few minutes, the strategy may
          have insufficient observations inside the bundled benchmark
          window (2023-04-26 onward). See the dev-server console for the
          exact gate the request fell through.
        </p>
      </article>
    );
  }

  // Trust tier is per-request (not cached with payload) so verification flips
  // don't require a payload cache bust. Sourced via the service-role projection
  // (readPublicVerificationSignals), which fails soft + logs to Sentry on a read
  // error — a transient drop stays visible without blanking the page (FINDING-4
  // b06-silentfailure: the silent-drop logging now lives inside the helper).
  const rawTrustTier = verificationSignals.get(id)?.trust_tier ?? null;
  const trustTier: TrustTierKind | null =
    rawTrustTier === "api_verified" || rawTrustTier === "csv_uploaded" || rawTrustTier === "self_reported"
      ? rawTrustTier
      : null;
  // Trust tier is overlaid post-build (per-request, not cached with the payload).
  // Object-spread distributes over the discriminated union and PRESERVES the
  // `ingestSource` discriminant, so the result stays a valid FactsheetApiPayload |
  // FactsheetCsvPayload — both narrowing and the no-invented-data compile error
  // survive the spread (verified: tsc 0).
  const payloadWithTrust: FactsheetPayload = { ...payload, trustTier };

  // JSON-LD FinancialProduct schema — helps Google + LLMs identify the page
  // as a structured financial-product listing. Content is server-built and
  // JSON-stringified; we additionally escape `</` to defang any name/desc
  // value attempting to close the embedded script tag.
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "FinancialProduct",
    name: payloadWithTrust.strategyName,
    description: payloadWithTrust.description ?? undefined,
    provider: { "@type": "Organization", name: "Quantalyze" },
    feesAndCommissionsSpecification: payloadWithTrust.aum != null ? `AUM ${payloadWithTrust.aum}` : undefined,
    // FINDING-7 (b06-silentfailure): Only publish CAGR as a machine-readable
    // interestRate when it is a finite number AND the strategy is API-verified.
    // NaN/Infinity serialize to null in JSON (benign but misleading), and CSV
    // strategies with short track records should not have their annualized CAGR
    // ingested by crawlers as a verified yield figure.
    interestRate:
      Number.isFinite(payloadWithTrust.strategyMetrics.cagr) &&
      payloadWithTrust.ingestSource === "api"
        ? payloadWithTrust.strategyMetrics.cagr
        : undefined,
  };
  const jsonLdStr = JSON.stringify(jsonLd).replace(/</g, "\\u003c");

  return (
    <>
      <script type="application/ld+json">{jsonLdStr}</script>
      <FactsheetView payload={payloadWithTrust} />
    </>
  );
}
