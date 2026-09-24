import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { StrategyActions } from "@/components/strategy/StrategyActions";
import { ShareableLink } from "@/components/strategy/ShareableLink";
import { AllocatorSyncStatus } from "@/components/exchanges/AllocatorSyncStatus";
// Server component: import the predicate from the NON-client module. Importing
// it from ShareableLink.tsx compiles but throws at request time.
import { isPublishedStatus } from "@/lib/share-affordance";
// Same rule for the Phase 167.2 predicates and copy: every module CALLED here
// carries no client directive. AllocatorSyncStatus is only RENDERED.
import { isUntrustedKeySyncStatus } from "@/lib/closed-sets";
import { untrustedKeyCaption } from "@/lib/status-surface-copy";
import { PendingIntros } from "@/components/strategy/PendingIntros";
import Link from "next/link";
import { redirect } from "next/navigation";

/**
 * Phase 167.2 / KCS-06 — the key-status projection this page reads. An
 * ALLOWLIST of the five columns the pill needs: `api_keys` is column-granted,
 * and the encrypted columns must never ride a wide select.
 */
const KEY_STATUS_COLUMNS = "id, exchange, sync_status, sync_error, last_sync_at";

interface KeyStatusRow {
  id: string;
  exchange: string;
  sync_status: string | null;
  sync_error: string | null;
  last_sync_at: string | null;
}

/** One S4 line: one untrusted status, the keys in it, the first key seen. */
interface UntrustedKeyLine {
  status: string;
  caption: string;
  first: KeyStatusRow;
}

/**
 * KCS-06 — the S4 lines for one row: its feeding keys that are untrusted
 * (`isUntrustedKeySyncStatus`, never a local equality), grouped by status in
 * first-seen order over `feedingKeyIds`. The pill's error, time and exchange
 * come from the first key seen in that status; the caption names every
 * distinct exchange in it. A key id with no row read (not the owner's, or the
 * read failed) contributes nothing: no guessed pill.
 */
function untrustedKeyLines(
  feedingKeyIds: readonly string[],
  keysById: ReadonlyMap<string, KeyStatusRow>,
): UntrustedKeyLine[] {
  const groups = new Map<string, KeyStatusRow[]>();
  for (const id of feedingKeyIds) {
    const key = keysById.get(id);
    if (!key || !isUntrustedKeySyncStatus(key.sync_status)) continue;
    const group = groups.get(key.sync_status);
    if (group) group.push(key);
    else groups.set(key.sync_status, [key]);
  }
  return [...groups].map(([status, keys]) => ({
    status,
    caption: untrustedKeyCaption(
      keys.map((k) => k.exchange),
      keys.length,
    ),
    first: keys[0],
  }));
}

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

  // Phase 167.2 / KCS-06 — which rows are fed by an untrusted key. Owner-scoped
  // on the request client (`api_keys_owner`); nothing here touches a factsheet
  // path. ⛔ A failed read renders NO mark (an error is not "healthy", but it
  // is not a known-bad key either, so no pill is guessed) and is logged.
  const feedingKeyIdsByStrategy = new Map<string, string[]>(
    (strategies ?? []).map((s) => [s.id, s.api_key_id ? [s.api_key_id] : []]),
  );
  const keyIds = [...new Set([...feedingKeyIdsByStrategy.values()].flat())];
  const keysById = new Map<string, KeyStatusRow>();
  if (keyIds.length > 0) {
    const { data: keyRows, error: keysError } = await supabase
      .from("api_keys")
      .select(KEY_STATUS_COLUMNS)
      .in("id", keyIds);
    if (keysError) {
      console.error("[strategies/page] api_keys read failed", keysError.message);
    } else {
      for (const key of (keyRows ?? []) as KeyStatusRow[]) keysById.set(key.id, key);
    }
  }

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
          {strategies.map((s) => {
            const keyLines = untrustedKeyLines(
              feedingKeyIdsByStrategy.get(s.id) ?? [],
              keysById,
            );
            return (
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
                    {/* Phase 164 (SHARE-04) — the status gate is GONE, and its
                        removal is the point, not a side effect. Hiding the control
                        for unpublished rows was the other half of the same
                        dishonesty class as the factsheet's 404-producing Copy
                        Link: an owner with a private strategy had no affordance at
                        all, so the product's answer to "show this to my LP" was
                        "you can't". Every row on this page belongs to the session
                        user, so an unpublished row now yields a working, revocable
                        private link instead of nothing.
                        ⛔ `StrategyActions` in the same row is untouched (D-03). */}
                    <ShareableLink
                      strategyId={s.id}
                      published={isPublishedStatus(s.status)}
                    />
                    <Badge label={s.status} type="status" />
                    <StrategyActions strategyId={s.id} status={s.status} hasApiKey={!!s.api_key_id} hasData={!!s.api_key_id} />
                    <span className="text-xs text-text-muted">
                      {new Date(s.created_at).toLocaleDateString()}
                    </span>
                  </div>
                </div>
                {/* Phase 167.2 / KCS-06 (S4) — the footer band, only when the row
                    has something to show. One line per DISTINCT untrusted status,
                    carrying the key card's own pill and helper, mounted exactly
                    as the key card mounts it. The caption names a key and the
                    pill names its state: no claim about the strategy's numbers.
                    Each mount keeps its own helper live region; on this static
                    server render they never change, so they announce nothing. */}
                {keyLines.length > 0 && (
                  <div
                    data-testid="strategy-row-footer"
                    className="mt-3 border-t border-border pt-3 space-y-2"
                  >
                    {keyLines.map((line) => (
                      <div
                        key={line.status}
                        data-testid="strategy-row-key-mark"
                        className="flex items-start justify-between gap-3"
                      >
                        <p className="text-xs text-text-muted">{line.caption}</p>
                        <AllocatorSyncStatus
                          syncStatus={line.status}
                          syncError={line.first.sync_error}
                          lastSyncAt={line.first.last_sync_at}
                          exchange={line.first.exchange}
                        />
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}
