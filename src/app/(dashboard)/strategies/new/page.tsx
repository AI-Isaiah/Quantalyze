import { PageHeader } from "@/components/layout/PageHeader";
import { Breadcrumb } from "@/components/layout/Breadcrumb";
import { StrategyForm } from "@/components/strategy/StrategyForm";

export default function NewStrategyPage() {
  return (
    <>
      <Breadcrumb
        items={[
          { label: "Strategies", href: "/strategies" },
          { label: "New Strategy" },
        ]}
      />
      <PageHeader title="New Strategy" />
      <StrategyForm mode="create" />
    </>
  );
}
