import { PageHeader } from "@/components/layout/PageHeader";
import { Breadcrumb } from "@/components/layout/Breadcrumb";
import { InfoBanner } from "@/components/ui/InfoBanner";
import { StrategyTable } from "@/components/strategy/StrategyTable";
import { DISCOVERY_CATEGORIES } from "@/lib/constants";
import {
  getRealPortfolio,
  getStrategiesByCategory,
  getMyWatchlist,
  getPercentiles,
} from "@/lib/queries";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

export default async function DiscoveryPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { slug } = await params;
  const cat = DISCOVERY_CATEGORIES.find((c) => c.slug === slug);
  const meta = cat ?? { name: slug, slug, description: "" };

  // Fetch strategies, the user's single real portfolio, and the user's
  // watched-set in parallel. getMyWatchlist returns null on a transient
  // DB / RLS error so the page can render a "Watchlist temporarily
  // unavailable" notice instead of silently rendering every star as empty
  // (which would let the user re-toggle a row they already starred).
  // getPercentiles is category-scoped and joins the same parallel fetch so the
  // StrategyTable's active-sort-column `Pnn` suffix renders. It returns null for
  // a peer set under 5 strategies (or on a transient DB/RLS error) → passed as
  // undefined so the table renders no suffix (honest absence, never a
  // fabricated rank).
  const [strategies, portfolio, watchedSet, percentiles] = await Promise.all([
    getStrategiesByCategory(slug),
    getRealPortfolio(user.id),
    getMyWatchlist(user.id),
    getPercentiles(slug),
  ]);

  const watchlistFailed = watchedSet === null;
  const initialWatchedSet = watchedSet ?? new Set<string>();

  return (
    // Data surface fluid-fill: fill toward ~1920px then center (Phase 52
    // APPLY-01 / TYPE-03). (dashboard)/layout.tsx does NOT cap width, so the
    // cap goes here at the page shell. The accredited-investor attestation
    // gate stays in discovery/layout.tsx (force-dynamic) — untouched.
    <div className="mx-auto max-w-[1920px]">
      <Breadcrumb
        items={[
          { label: "Discovery", href: "/discovery/crypto-sma" },
          { label: meta.name },
        ]}
      />
      <PageHeader title={meta.name} />
      {meta.description && (
        <InfoBanner className="mb-6">{meta.description}</InfoBanner>
      )}
      {watchlistFailed && (
        <div
          role="status"
          aria-live="polite"
          className="mb-6 rounded-lg border border-border bg-card px-4 py-3 text-sm text-text-secondary"
        >
          Watchlist temporarily unavailable — your starred strategies may not
          appear. Refresh to retry.
        </div>
      )}
      {/* F9 M-0475/M-0476 — key by (user, slug) so a client-side category
          change remounts StrategyTable. Without it, navigating between
          /discovery/[slug] pages reuses the instance; its prefs-mirror effect
          (gated on prefsHydrated, which never re-toggles on the useDiscoveryPrefs
          key flip) would leave view/sort/showExamples on the prior category's
          saved prefs until a full reload. A remount re-runs the mirror cleanly
          for the new scope. */}
      <StrategyTable
        key={`${user.id}:${slug}`}
        strategies={strategies}
        categorySlug={slug}
        portfolioId={portfolio?.id ?? null}
        userId={user.id}
        initialWatchedSet={initialWatchedSet}
        percentiles={percentiles ?? undefined}
      />
    </div>
  );
}
