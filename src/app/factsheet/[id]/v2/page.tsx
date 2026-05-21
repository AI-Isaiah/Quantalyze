import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { unstable_cache } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { displayStrategyName } from "@/lib/strategy-display";
import type { DisclosureTier } from "@/lib/types";
import { buildFactsheetPayload } from "@/lib/factsheet/build-payload";
import { resolveDailyReturnSeries } from "@/lib/factsheet/allocator-portfolio-payload";
import type { FactsheetPayload, TrustTierKind } from "@/lib/factsheet/types";
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
  const { data: strategy, error } = await supabase
    .from("strategies")
    .select(
      `id, name, codename, disclosure_tier, status, markets, strategy_types,
       description, subtypes, supported_exchanges, leverage_range, aum,
       max_capacity, avg_daily_turnover, start_date, benchmark,
       strategy_analytics ( daily_returns, returns_series, computed_at )`,
    )
    .eq("id", id)
    .eq("status", "published")
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
  const dailyReturns = resolveDailyReturnSeries(dailyRaw, analytics?.returns_series);
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

  const computedAt = analytics?.computed_at ?? new Date().toISOString();
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
      description: strategy.description ?? null,
      subtypes: strategy.subtypes ?? [],
      supportedExchanges: strategy.supported_exchanges ?? [],
      leverageRange: strategy.leverage_range ?? null,
      aum: strategy.aum ?? null,
      maxCapacity: strategy.max_capacity ?? null,
      avgDailyTurnover: strategy.avg_daily_turnover ?? null,
      startDate: strategy.start_date ?? null,
      benchmark: strategy.benchmark ?? null,
    },
    dailyReturns,
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
    ["factsheet-v2-payload-v2", id],
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
  const { data } = await supabase
    .from("strategies")
    .select("id, name, codename, description, disclosure_tier")
    .eq("id", id)
    .eq("status", "published")
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

  // Lightweight signature probe (id + name + computed_at) + verifications in
  // parallel. Strategy meta + dailyReturns are fetched INSIDE the cached
  // function so the cache key derivation doesn't serialize a multi-MB array
  // per hit. `name` / `codename` come along on the probe so the
  // payload-pending fallback below can name the strategy without a second
  // query.
  // strategy_verifications is missing from the generated database.types.ts
  // (type drift — table exists per migration 089). Route the verifications
  // query through an `unknown`-cast handle so the typed client doesn't reject
  // it; the runtime call is unchanged.
  const supabaseUntyped = supabase as unknown as {
    from: (table: "strategy_verifications") => {
      select: (cols: string) => {
        eq: (col: string, val: string) => {
          order: (col: string, opts: { ascending: boolean }) => {
            limit: (n: number) => Promise<{ data: { trust_tier: string | null; created_at: string | null }[] | null; error: unknown }>;
          };
        };
      };
    };
  };
  const [signRes, vRes] = await Promise.all([
    supabase
      .from("strategies")
      .select("id, name, codename, disclosure_tier, strategy_analytics ( computed_at )")
      .eq("id", id)
      .eq("status", "published")
      .maybeSingle(),
    supabaseUntyped
      .from("strategy_verifications")
      .select("trust_tier, created_at")
      .eq("strategy_id", id)
      .order("created_at", { ascending: false })
      .limit(1),
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
        <p className="text-[10px] font-mono uppercase tracking-[0.22em] text-text-muted">
          Institutional Factsheet · Quantalyze
        </p>
        <h1 className="mt-2 font-serif text-[28px] sm:text-[36px] leading-tight text-text-primary">
          {pendingName}
        </h1>
        <p className="mt-6 text-[13px] text-text-secondary">
          The detailed factsheet for this strategy is still computing.
          Daily-return data hasn&apos;t been ingested yet — once the
          analytics service finishes the first compute pass, the full panel
          set will render here.
        </p>
        <p className="mt-3 text-[12px] text-text-muted italic">
          If this persists for more than a few minutes, the strategy may
          have insufficient observations inside the bundled benchmark
          window (2023-04-26 onward). See the dev-server console for the
          exact gate the request fell through.
        </p>
      </article>
    );
  }

  // Trust tier is per-request (not cached with payload) so verification flips
  // don't require a payload cache bust.
  const vRows = vRes.data;
  const rawTrustTier = (vRows?.[0]?.trust_tier ?? null) as string | null;
  const trustTier: TrustTierKind | null =
    rawTrustTier === "api_verified" || rawTrustTier === "csv_uploaded" || rawTrustTier === "self_reported"
      ? rawTrustTier
      : null;
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
    interestRate: payloadWithTrust.strategyMetrics.cagr,
  };
  const jsonLdStr = JSON.stringify(jsonLd).replace(/</g, "\\u003c");

  return (
    <>
      <script type="application/ld+json">{jsonLdStr}</script>
      <FactsheetView payload={payloadWithTrust} />
    </>
  );
}
