import { PageHeader } from "@/components/layout/PageHeader";
import { Breadcrumb } from "@/components/layout/Breadcrumb";
import { InfoBanner } from "@/components/ui/InfoBanner";
import { StrategyTable } from "@/components/strategy/StrategyTable";
import { DISCOVERY_CATEGORIES } from "@/lib/constants";
import { getStrategiesByCategory } from "@/lib/queries";

export default async function DiscoveryPage({
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
          { label: "Discovery", href: "/discovery/crypto-sma" },
          { label: meta.name },
        ]}
      />
      <PageHeader title={meta.name} />
      {meta.description && (
        <InfoBanner className="mb-6">{meta.description}</InfoBanner>
      )}
      <StrategyTable strategies={strategies} categorySlug={slug} />
    </>
  );
}
