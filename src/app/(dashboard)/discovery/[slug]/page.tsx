import { PageHeader } from "@/components/layout/PageHeader";
import { Breadcrumb } from "@/components/layout/Breadcrumb";
import { InfoBanner } from "@/components/ui/InfoBanner";
import { StrategyTable } from "@/components/strategy/StrategyTable";
import { DISCOVERY_CATEGORIES } from "@/lib/constants";
import {
  getRealPortfolio,
  getStrategiesByCategory,
  getMyWatchlist,
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
  const [strategies, portfolio, watchedSet] = await Promise.all([
    getStrategiesByCategory(slug),
    getRealPortfolio(user.id),
    getMyWatchlist(user.id),
  ]);

  const watchlistFailed = watchedSet === null;
  const initialWatchedSet = watchedSet ?? new Set<string>();

  return (
    <>
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
      <StrategyTable
        strategies={strategies}
        categorySlug={slug}
        portfolioId={portfolio?.id ?? null}
        userId={user.id}
        initialWatchedSet={initialWatchedSet}
      />
    </>
  );
}
