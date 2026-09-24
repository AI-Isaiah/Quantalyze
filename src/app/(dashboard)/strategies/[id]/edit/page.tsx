import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/layout/PageHeader";
import { Breadcrumb } from "@/components/layout/Breadcrumb";
import { StrategyForm } from "@/components/strategy/StrategyForm";
import { ApiKeyManager } from "@/components/strategy/ApiKeyManager";
import { CsvStrategyEditNote } from "@/components/strategy/CsvStrategyEditNote";
import { KeyPermissionBadge } from "@/components/connect/KeyPermissionBadge";
import type { Strategy } from "@/lib/types";
import { readCompositeMemberKeyIds } from "@/lib/strategy-shape";
import { captureToSentry } from "@/lib/sentry-capture";
import type { SupabaseClient } from "@supabase/supabase-js";
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

  // Phase 167.2 / KCS-23: is this strategy a composite? Its key card must then
  // offer no control that rewrites `strategies.api_key_id` (Use & Sync, Resync,
  // Add Key), because that write silently turns a composite into a single-key
  // strategy. Read on the request client (RLS `strategy_keys_owner`) and only
  // for an API-key-backed strategy: a CSV strategy renders no key card.
  // An unreadable count is "unknown", NOT a page failure: the card then offers
  // no link control (it might be a composite) but keeps `Update password`,
  // `Delete` and each key's pill, because the "Sign-in failed" pill on
  // /strategies links here for exactly that remedy. The message is logged
  // server-side only; the card receives the shape and no error text.
  let keyShape: "single" | "composite" | "unknown" = "single";
  // 167.2-REVIEW CR-02: the member KEY IDS, not just their count, so the card
  // lists only the keys the composite reads from (KCS23-COMPOSITE says it
  // "reads from every key below"). One read gives both: the count is their
  // number.
  let compositeMemberKeyIds: string[] | undefined;
  if (strategy.source !== "csv") {
    // The generated types predate `strategy_keys`; the cast is type-only and
    // RLS still applies to this request client (see strategy-shape.ts).
    const members = await readCompositeMemberKeyIds(
      supabase as unknown as SupabaseClient,
      strategy.id,
    );
    if (members.ok) {
      keyShape = members.keyIds.length > 0 ? "composite" : "single";
      if (keyShape === "composite") compositeMemberKeyIds = members.keyIds;
    } else {
      console.error("[strategies/edit/page] composite member count failed", {
        id: strategy.id,
        message: members.message,
      });
      // 167.2-REVIEW-SFH H-2: captured like the owner factsheet's identical
      // read (`readOwnerPendingStatus`, stage "strategy-shape"), so a card
      // whose sync controls vanished is visible in production, not only in a
      // server log. The strategy id stays in the log, as that site does.
      captureToSentry(new Error(members.message), {
        tags: { route: "strategies/edit/page", stage: "strategy-shape" },
      });
      keyShape = "unknown";
    }
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
                keyShape={keyShape}
                compositeMemberKeyIds={compositeMemberKeyIds}
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
