import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/layout/PageHeader";
import { Breadcrumb } from "@/components/layout/Breadcrumb";
import { StrategyForm } from "@/components/strategy/StrategyForm";
import { ApiKeyManager } from "@/components/strategy/ApiKeyManager";
import { CsvStrategyEditNote } from "@/components/strategy/CsvStrategyEditNote";
import { KeyPermissionBadge } from "@/components/connect/KeyPermissionBadge";
import type { Strategy } from "@/lib/types";
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
    .single<Strategy & { source: string | null }>();

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
          {/*
            2026-05-17 UAT: render only the panel that matches the
            strategy's actual data source. Pre-fix the page rendered
            ApiKeyManager AND CsvUpload unconditionally, so a CSV-uploaded
            strategy (`source = 'csv'`) showed an irrelevant Exchange API
            Keys panel and an offer to "Add Key" — confusing for managers
            who never connected an exchange. Mirrors the wizard's
            source-branching: 'csv' strategies own a pnl CSV, every other
            source (`legacy`, `wizard`, `admin_import`, `allocator_connected`,
            `okx`, `binance`, `bybit`) is API-key-backed.

            Note: `api_key_id` is allowed to be null even for non-CSV
            strategies (e.g. wizard-source in draft state, broker rows
            mid-finalize), so we key off `source` rather than presence of
            api_key_id. The key-scope badge stays gated on api_key_id
            since it has no live badge when the column is null.
          */}
          {strategy.source === "csv" ? (
            <CsvStrategyEditNote />
          ) : (
            <>
              <ApiKeyManager
                strategyId={strategy.id}
                currentKeyId={strategy.api_key_id}
                defaultExchange={strategy.supported_exchanges?.[0]?.toLowerCase()}
              />
              {/*
                Sprint 5 Task 5.8: live key-scope viewer. Only the strategy
                owner can reach this page (the .eq("user_id", user.id)
                filter above gates it), so it's safe to render the badge
                here without an additional ownership check — the API route
                does its own.
              */}
              {strategy.api_key_id && (
                <KeyPermissionBadge apiKeyId={strategy.api_key_id} />
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}
