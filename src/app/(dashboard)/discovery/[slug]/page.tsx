import { PageHeader } from "@/components/layout/PageHeader";
import { Breadcrumb } from "@/components/layout/Breadcrumb";
import { InfoBanner } from "@/components/ui/InfoBanner";
import { DISCOVERY_CATEGORIES } from "@/lib/constants";

export default async function DiscoveryPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const cat = DISCOVERY_CATEGORIES.find((c) => c.slug === slug);
  const meta = cat ?? { name: slug, slug, description: "" };

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
      <div className="rounded-xl border border-border bg-surface p-8 text-center text-text-muted">
        Strategy table coming in Step 4
      </div>
    </>
  );
}
