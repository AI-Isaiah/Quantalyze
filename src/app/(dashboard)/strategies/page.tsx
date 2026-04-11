import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { StrategyActions } from "@/components/strategy/StrategyActions";
import { ShareableLink } from "@/components/strategy/ShareableLink";
import { PendingIntros } from "@/components/strategy/PendingIntros";
import Link from "next/link";
import { redirect } from "next/navigation";

export default async function StrategiesPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Filter out wizard drafts — they belong to the wizard flow and
  // have their own Resume banner at /strategies/new/wizard. Including
  // them here would render a confusing "edit" link pointing at the
  // legacy StrategyForm, which does not understand wizard state.
  // See migration 031: `source` discriminates wizard drafts from
  // legacy / admin_import drafts. The PostgREST `.or()` filter below
  // keeps legacy drafts visible while hiding wizard-in-progress rows.
  const { data: strategies } = await supabase
    .from("strategies")
    .select("id, name, status, source, strategy_types, review_note, created_at, api_key_id")
    .eq("user_id", user.id)
    .or("source.neq.wizard,status.neq.draft")
    .order("created_at", { ascending: false });

  const strategyIds = strategies?.map((s) => s.id) ?? [];

  const { data: introRequests } = strategyIds.length > 0
    ? await supabase
        .from("contact_requests")
        .select("id, status, message, created_at, strategy_id, founder_notes, profiles!contact_requests_allocator_id_fkey(display_name, company), strategies!contact_requests_strategy_id_fkey(id, name, codename, disclosure_tier)")
        .in("strategy_id", strategyIds)
        .order("created_at", { ascending: false })
    : { data: [] };

  return (
    <>
      <PageHeader
        title="My Strategies"
        actions={
          <Link href="/strategies/new">
            <Button>New Strategy</Button>
          </Link>
        }
      />

      {introRequests && introRequests.length > 0 && (
        <PendingIntros requests={introRequests as Parameters<typeof PendingIntros>[0]["requests"]} />
      )}

      {(!strategies || strategies.length === 0) ? (
        <Card className="text-center py-12">
          <p className="text-text-muted mb-4">No strategies yet.</p>
          <Link href="/strategies/new">
            <Button>Create your first strategy</Button>
          </Link>
        </Card>
      ) : (
        <div className="space-y-3">
          {strategies.map((s) => (
            <Card key={s.id}>
              <div className="flex items-center justify-between">
                <div className="flex-1 min-w-0">
                  <Link href={`/strategies/${s.id}/edit`} className="font-medium text-text-primary hover:text-accent transition-colors">
                    {s.name}
                  </Link>
                  <div className="flex gap-1.5 mt-1">
                    {s.strategy_types.map((t: string) => (
                      <Badge key={t} label={t} />
                    ))}
                  </div>
                  {s.review_note && s.status === "draft" && (
                    <p className="mt-2 text-xs text-negative bg-negative/5 rounded px-2 py-1">
                      Review feedback: {s.review_note}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-3 ml-4">
                  {s.status === "published" && (
                    <ShareableLink strategyId={s.id} />
                  )}
                  <Badge label={s.status} type="status" />
                  <StrategyActions strategyId={s.id} status={s.status} hasApiKey={!!s.api_key_id} hasData={!!s.api_key_id} />
                  <span className="text-xs text-text-muted">
                    {new Date(s.created_at).toLocaleDateString()}
                  </span>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
