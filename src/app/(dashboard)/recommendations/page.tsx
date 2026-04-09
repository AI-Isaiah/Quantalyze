import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card } from "@/components/ui/Card";
import { Disclaimer } from "@/components/ui/Disclaimer";
import { FreshnessBadge } from "@/components/strategy/FreshnessBadge";
import { AccreditedInvestorGate } from "@/components/legal/AccreditedInvestorGate";
import { formatPercent, formatNumber } from "@/lib/utils";
import { DISCOVERY_CATEGORIES } from "@/lib/constants";

// Mirror /discovery/layout.tsx — the attestation gate must NEVER be cached.
export const dynamic = "force-dynamic";

/**
 * Sprint 3 Track 9 — Approach B (stripped).
 *
 * Reads the latest match_batches row for the current user and surfaces the
 * top 3 candidates with their reasons text. This is the allocator-facing
 * complement to the founder-side Match Queue. No feedback loop, no save /
 * dismiss, no match-score column on Discovery — intentionally narrow scope.
 *
 * Empty state kicks in when:
 *   1. The user has no row in allocator_preferences (no mandate) → CTA to /preferences
 *   2. The mandate exists but no match_batch has been computed yet
 *
 * T9.2: requires accredited attestation, mirroring the /discovery layout gate.
 * Recommendations are themselves an investment-discovery surface, so the same
 * compliance shell applies.
 */
export default async function RecommendationsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?redirect=/recommendations");

  // Fail-closed attestation gate: any error or missing row → render the gate.
  let attestedAt: string | null = null;
  try {
    const { data: attestation, error } = await supabase
      .from("investor_attestations")
      .select("attested_at")
      .eq("user_id", user.id)
      .maybeSingle();
    if (error) {
      console.error("[recommendations] attestation lookup failed:", error.message);
      return <AccreditedInvestorGate />;
    }
    attestedAt = attestation?.attested_at ?? null;
  } catch (err) {
    console.error("[recommendations] attestation lookup threw:", err);
    return <AccreditedInvestorGate />;
  }

  if (!attestedAt) {
    return <AccreditedInvestorGate />;
  }

  // Fetch mandate via the allocator's own user client (RLS lets each user
  // read their own allocator_preferences row).
  const { data: preferences } = await supabase
    .from("allocator_preferences")
    .select("mandate_archetype, target_ticket_size_usd")
    .eq("user_id", user.id)
    .maybeSingle();

  const mandateSet = Boolean(preferences?.mandate_archetype);

  // Fetch batch meta + top-3 candidates via SECURITY DEFINER RPCs
  // (migration 019). Each RPC enforces "caller is the allocator or admin"
  // in SQL, so a non-matching caller gets an empty result set -- the page
  // can't accidentally leak cross-allocator matches via a shared batch id.
  const [batchMetaResult, recsResult] = await Promise.all([
    supabase.rpc("get_allocator_latest_batch_meta", {
      p_allocator_id: user.id,
    }),
    supabase.rpc("get_allocator_recommendations", {
      p_allocator_id: user.id,
    }),
  ]);

  if (batchMetaResult.error) {
    console.error(
      "[recommendations] get_allocator_latest_batch_meta failed:",
      batchMetaResult.error.message,
    );
  }
  if (recsResult.error) {
    console.error(
      "[recommendations] get_allocator_recommendations failed:",
      recsResult.error.message,
    );
  }

  const batch = batchMetaResult.data?.[0]
    ? {
        id: batchMetaResult.data[0].batch_id as string,
        computed_at: batchMetaResult.data[0].computed_at as string,
        candidate_count: batchMetaResult.data[0].candidate_count as number,
      }
    : null;

  // Row shape returned by `get_allocator_recommendations` (migration 019
  // RETURNS TABLE(...)). Hand-maintained because Supabase's generated
  // types aren't wired into this repo yet; any column rename in the
  // migration needs to be reflected here.
  interface RecommendationRow {
    id: string;
    strategy_id: string;
    rank: number;
    score: number;
    reasons: string[] | null;
    strategy_name: string;
    strategy_description: string | null;
    discovery_category_slug: string | null;
    cagr: number | null;
    sharpe: number | null;
    max_drawdown: number | null;
    analytics_computed_at: string | null;
  }

  const candidates: Array<{
    id: string;
    strategy_id: string;
    rank: number;
    score: number;
    reasons: string[];
    strategy: {
      id: string;
      name: string;
      description: string | null;
      category_slug: string | null;
      cagr: number | null;
      sharpe: number | null;
      max_drawdown: number | null;
      computed_at: string | null;
    };
  }> = ((recsResult.data ?? []) as RecommendationRow[]).map((row) => ({
    id: row.id,
    strategy_id: row.strategy_id,
    rank: row.rank,
    score: row.score,
    reasons: row.reasons ?? [],
    strategy: {
      id: row.strategy_id,
      name: row.strategy_name,
      description: row.strategy_description ?? null,
      category_slug: row.discovery_category_slug ?? null,
      cagr: row.cagr,
      sharpe: row.sharpe,
      max_drawdown: row.max_drawdown,
      computed_at: row.analytics_computed_at ?? null,
    },
  }));

  return (
    <>
      <PageHeader
        title="Recommendations"
        description="Top 3 strategies that fit your mandate. Updated daily."
        meta={
          batch?.computed_at ? (
            <FreshnessBadge
              computedAt={batch.computed_at}
              label="Batch"
              variant="pill"
            />
          ) : undefined
        }
      />

      {!mandateSet ? <NoMandateState /> : null}
      {mandateSet && !batch ? <NoBatchState /> : null}
      {mandateSet && batch && candidates.length === 0 ? (
        <NoCandidatesState />
      ) : null}

      {candidates.length > 0 && (
        <ol className="space-y-4">
          {candidates.map((c) => (
            <li key={c.id}>
              <RecommendationCard candidate={c} />
            </li>
          ))}
        </ol>
      )}

      <Disclaimer variant="footer" />
    </>
  );
}

function NoMandateState() {
  return (
    <Card className="p-8 text-center">
      <h2 className="text-lg font-semibold text-text-primary">
        Set your mandate to see recommendations
      </h2>
      <p className="mt-2 text-sm text-text-secondary max-w-md mx-auto">
        Tell us your strategy type, ticket size, and exchange preferences. The
        match engine uses this to compute personalized recommendations every
        day at 01:00 UTC.
      </p>
      <Link
        href="/preferences"
        className="mt-6 inline-flex items-center rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover transition-colors"
      >
        Set preferences →
      </Link>
    </Card>
  );
}

function NoBatchState() {
  return (
    <Card className="p-8 text-center">
      <h2 className="text-lg font-semibold text-text-primary">
        Your first batch is computing
      </h2>
      <p className="mt-2 text-sm text-text-secondary max-w-md mx-auto">
        Your mandate is set. The match engine recomputes recommendations once
        a day — your first batch will appear here after the next run.
      </p>
    </Card>
  );
}

function NoCandidatesState() {
  return (
    <Card className="p-8 text-center">
      <h2 className="text-lg font-semibold text-text-primary">
        No candidates match today
      </h2>
      <p className="mt-2 text-sm text-text-secondary max-w-md mx-auto">
        We computed a batch but none of the current strategies matched your
        mandate. Try relaxing your filters in{" "}
        <Link href="/preferences" className="underline hover:text-text-primary">
          preferences
        </Link>{" "}
        — the match engine will pick up the change on the next daily run.
      </p>
    </Card>
  );
}

function RecommendationCard({
  candidate,
}: {
  candidate: {
    rank: number;
    score: number;
    reasons: string[];
    strategy: {
      id: string;
      name: string;
      description: string | null;
      category_slug: string | null;
      cagr: number | null;
      sharpe: number | null;
      max_drawdown: number | null;
      computed_at: string | null;
    };
  };
}) {
  const { rank, reasons, strategy } = candidate;
  const primaryReason = reasons[0] ?? "Strong fit for your current mandate.";
  const categoryName = strategy.category_slug
    ? (DISCOVERY_CATEGORIES.find((c) => c.slug === strategy.category_slug)?.name ??
      strategy.category_slug)
    : null;

  const viewHref = strategy.category_slug
    ? `/discovery/${strategy.category_slug}/${strategy.id}`
    : `/strategy/${strategy.id}`;

  return (
    <Card>
      <div className="flex items-start justify-between gap-6">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-3">
            <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-accent/10 text-xs font-semibold text-accent">
              #{rank}
            </span>
            <h3 className="text-lg font-semibold text-text-primary">
              {strategy.name}
            </h3>
            {categoryName && (
              <span className="text-[10px] uppercase tracking-wider text-text-muted">
                {categoryName}
              </span>
            )}
          </div>
          <p className="mt-2 text-sm text-text-secondary leading-relaxed">
            {primaryReason}
          </p>
          {strategy.description && (
            <p className="mt-2 text-xs text-text-muted line-clamp-2">
              {strategy.description}
            </p>
          )}
          <div className="mt-3 flex items-center gap-4 text-xs">
            <Metric label="CAGR" value={formatPercent(strategy.cagr)} />
            <Metric label="Sharpe" value={formatNumber(strategy.sharpe)} />
            <Metric
              label="Max DD"
              value={formatPercent(strategy.max_drawdown)}
              negative
            />
          </div>
        </div>
        <div className="shrink-0">
          <Link
            href={viewHref}
            className="inline-flex items-center rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover transition-colors"
          >
            View strategy →
          </Link>
        </div>
      </div>
    </Card>
  );
}

function Metric({
  label,
  value,
  negative,
}: {
  label: string;
  value: string;
  negative?: boolean;
}) {
  return (
    <div className="flex items-baseline gap-1.5">
      <span className="text-[10px] uppercase tracking-wider text-text-muted">
        {label}
      </span>
      <span
        className={`font-metric font-medium ${
          negative ? "text-negative" : "text-text-primary"
        }`}
      >
        {value}
      </span>
    </div>
  );
}
