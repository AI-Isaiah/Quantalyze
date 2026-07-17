import Link from "next/link";
import { Breadcrumb } from "@/components/layout/Breadcrumb";
import { InfoBanner } from "@/components/ui/InfoBanner";
import { StrategyTable } from "@/components/strategy/StrategyTable";
import { DISCOVERY_CATEGORIES } from "@/lib/constants";
import { getStrategiesByCategory, getPercentiles } from "@/lib/queries";
import type { Metadata } from "next";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const cat = DISCOVERY_CATEGORIES.find((c) => c.slug === slug);
  const name = cat?.name ?? slug;
  return {
    title: `${name} — Browse Verified Strategies — Quantalyze`,
    description: cat?.description ?? "Exchange-verified quant strategies.",
  };
}

export default async function PublicCategoryPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const cat = DISCOVERY_CATEGORIES.find((c) => c.slug === slug);
  const meta = cat ?? { name: slug, slug, description: "" };

  // Category-scoped peer-percentile ranks fetched alongside the rows so the
  // StrategyTable's active-sort-column `Pnn` suffix renders. getPercentiles
  // returns null for a peer set under 5 strategies (or on a transient DB/RLS
  // error) → passed as undefined so the table renders no suffix (honest
  // absence), never a fabricated rank.
  const [strategies, percentiles] = await Promise.all([
    getStrategiesByCategory(slug),
    getPercentiles(slug),
  ]);

  return (
    <>
      <Breadcrumb
        items={[
          { label: "Browse", href: "/browse" },
          { label: meta.name },
        ]}
      />

      <h1 className="text-2xl font-bold tracking-tight text-text-primary mb-2">
        {meta.name}
      </h1>
      {meta.description && (
        <InfoBanner className="mb-6">{meta.description}</InfoBanner>
      )}

      {/* F9 M-0475/M-0476 — key by slug so a client-side category change
          remounts StrategyTable. Without it, navigating /browse/crypto-sma →
          /browse/equity-sma reuses the same instance; its prefs-mirror effect
          (gated on prefsHydrated, which never re-toggles on a key flip) would
          leave view/sort/showExamples pointing at the previous category. */}
      <StrategyTable
        key={`browse:${slug}`}
        strategies={strategies}
        categorySlug={slug}
        basePath="/browse"
        percentiles={percentiles ?? undefined}
      />

      <div className="mt-8 rounded-xl border border-border bg-page p-5 text-center">
        <p className="text-sm text-text-secondary">
          Sign up for full analytics, detailed performance reports, and to
          request introductions.
        </p>
        <Link
          href="/signup"
          className="mt-3 inline-flex items-center rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover transition-colors"
        >
          Sign up free
        </Link>
      </div>
    </>
  );
}
