import { PageHeader } from "@/components/layout/PageHeader";
import { Breadcrumb } from "@/components/layout/Breadcrumb";
import { InfoBanner } from "@/components/ui/InfoBanner";
import { StrategyTable } from "@/components/strategy/StrategyTable";
import { DISCOVERY_CATEGORIES } from "@/lib/constants";
import { getRealPortfolio, getStrategiesByCategory } from "@/lib/queries";
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

  // Fetch the user's single real portfolio in parallel with strategies so
  // the StrategyTable can wire the "Simulate Impact" row-action against
  // a concrete portfolio. Null is a valid state — the button then renders
  // disabled with an explanatory tooltip.
  const [strategies, portfolio] = await Promise.all([
    getStrategiesByCategory(slug),
    getRealPortfolio(user.id),
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
      />
    </>
  );
}
