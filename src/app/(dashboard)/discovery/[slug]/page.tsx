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
  // watched-set in parallel. Phase 13 / DISCO-01 widens this fan-out from
  // 2 → 3 reads — getMyWatchlist is RLS-scoped to auth.uid() and returns
  // an empty Set on transient DB error (read path is non-fatal). The
  // resulting Set hydrates StrategyTable's leading-column StarToggle
  // state on first paint, so the persisted watchlist is visible without
  // a flash-of-unstarred between SSR and client hydration.
  const [strategies, portfolio, watchedSet] = await Promise.all([
    getStrategiesByCategory(slug),
    getRealPortfolio(user.id),
    getMyWatchlist(user.id),
  ]);

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
      <StrategyTable
        strategies={strategies}
        categorySlug={slug}
        portfolioId={portfolio?.id ?? null}
        userId={user.id}
        initialWatchedSet={watchedSet}
      />
    </>
  );
}
