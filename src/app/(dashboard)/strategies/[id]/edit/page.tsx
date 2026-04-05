import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/layout/PageHeader";
import { Breadcrumb } from "@/components/layout/Breadcrumb";
import { StrategyForm } from "@/components/strategy/StrategyForm";
import { ApiKeyManager } from "@/components/strategy/ApiKeyManager";
import { CsvUpload } from "@/components/strategy/CsvUpload";
import { redirect } from "next/navigation";

export default async function EditStrategyPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: strategy } = await supabase
    .from("strategies")
    .select("*")
    .eq("id", id)
    .eq("user_id", user.id)
    .single();

  if (!strategy) {
    return (
      <div className="text-center py-16 text-text-muted">
        Strategy not found.
      </div>
    );
  }

  return (
    <>
      <Breadcrumb
        items={[
          { label: "Strategies", href: "/strategies" },
          { label: strategy.name },
        ]}
      />
      <PageHeader title={`Edit: ${strategy.name}`} />
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2">
          <StrategyForm strategy={strategy} mode="edit" />
        </div>
        <div className="space-y-6">
          <ApiKeyManager strategyId={strategy.id} currentKeyId={strategy.api_key_id} defaultExchange={strategy.supported_exchanges?.[0]?.toLowerCase()} />
          <CsvUpload strategyId={strategy.id} />
        </div>
      </div>
    </>
  );
}
