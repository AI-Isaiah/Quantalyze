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

  // Companion query for the wizard-draft Resume CTA.
  //
  // The `.or()` filter above intentionally hides wizard-in-progress rows
  // from the list (they need a different "edit" target than the legacy
  // StrategyForm). But pre-fix that hiding was total: a user who left
  // the wizard mid-flow and came back to /strategies saw "No strategies
  // yet" and lost their draft to the cleanup cron without realizing.
  // This second query surfaces a Resume banner without re-rendering the
  // hidden row inline — preserving the StrategyForm-routing safety
  // invariant while closing the dogfood UX gap (2026-05-21).
  const { data: wizardDraft } = await supabase
    .from("strategies")
    .select("id, name, created_at, review_note")
    .eq("user_id", user.id)
    .eq("source", "wizard")
    .eq("status", "draft")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  // M-0255: a rejected wizard draft is the SAME hidden row (source='wizard',
  // status='draft') but with review_note set by the admin reject path. The
  // inline list filter hides it AND the inline review_note render only fires
  // for rows that survive the filter — so the rejection + feedback were never
  // surfaced (and the cleanup cron would CASCADE-delete it). Surface it here in
  // the banner instead, preserving the StrategyForm-routing safety invariant
  // (the Resume CTA targets the wizard, which understands wizard state).
  const wizardDraftRejected = Boolean(wizardDraft?.review_note);

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

      {wizardDraft && (
        <Card
          data-testid="wizard-draft-resume-banner"
          data-rejected={wizardDraftRejected ? "true" : "false"}
          className={
            wizardDraftRejected
              ? "mb-3 border-negative/40 bg-negative/5"
              : "mb-3 border-accent/40 bg-accent/5"
          }
        >
          <div className="flex items-center justify-between gap-3">
            <div className="flex-1 min-w-0">
              {wizardDraftRejected ? (
                <>
                  <p className="text-sm font-medium text-text-primary">
                    Your strategy submission was sent back for changes.
                  </p>
                  <p className="mt-0.5 text-xs text-text-muted">
                    {wizardDraft.name
                      ? `"${wizardDraft.name}" needs revisions before it can be published.`
                      : "Your draft needs revisions before it can be published."}
                  </p>
                  <p className="mt-2 text-xs text-negative bg-negative/5 rounded px-2 py-1">
                    Review feedback: {wizardDraft.review_note}
                  </p>
                </>
              ) : (
                <>
                  <p className="text-sm font-medium text-text-primary">
                    You have an unfinished strategy draft.
                  </p>
                  <p className="mt-0.5 text-xs text-text-muted">
                    {wizardDraft.name
                      ? `"${wizardDraft.name}" — started ${new Date(wizardDraft.created_at).toLocaleDateString()}. Drafts expire after 30 days.`
                      : `Started ${new Date(wizardDraft.created_at).toLocaleDateString()}. Drafts expire after 30 days.`}
                  </p>
                </>
              )}
            </div>
            <Link href="/strategies/new/wizard">
              <Button size="sm">
                {wizardDraftRejected ? "Revise & resubmit" : "Resume draft"}
              </Button>
            </Link>
          </div>
        </Card>
      )}

      {(!strategies || strategies.length === 0) ? (
        <Card className="text-center py-12">
          {wizardDraft ? (
            <>
              <p className="text-text-muted mb-4">
                No published strategies yet — but you have a draft in progress.
              </p>
              <Link href="/strategies/new/wizard">
                <Button>Resume your draft</Button>
              </Link>
            </>
          ) : (
            <>
              <p className="text-text-muted mb-4">No strategies yet.</p>
              <Link href="/strategies/new">
                <Button>Create your first strategy</Button>
              </Link>
            </>
          )}
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
