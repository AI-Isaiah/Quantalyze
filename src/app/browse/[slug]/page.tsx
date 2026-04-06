import Link from "next/link";
import { Breadcrumb } from "@/components/layout/Breadcrumb";
import { InfoBanner } from "@/components/ui/InfoBanner";
import { StrategyTable } from "@/components/strategy/StrategyTable";
import { DISCOVERY_CATEGORIES } from "@/lib/constants";
import { getStrategiesByCategory } from "@/lib/queries";
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

  const strategies = await getStrategiesByCategory(slug);

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

      <StrategyTable
        strategies={strategies}
        categorySlug={slug}
        basePath="/browse"
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
