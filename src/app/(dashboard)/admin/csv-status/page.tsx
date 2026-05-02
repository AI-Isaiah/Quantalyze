import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAdminUser } from "@/lib/admin";
import { redirect } from "next/navigation";
import Link from "next/link";
import { PageHeader } from "@/components/layout/PageHeader";

/**
 * Phase 15 / CSV-01: founder-facing per-team status surface for the
 * 10 onboarding teams' CSV submissions.
 *
 * Cross-AI revision 2026-04-30 (BLOCKER #4): the prior "queryable rows
 * only" scope was insufficient — the founder needs visibility during
 * Phase 15's 48-hour customer-onboarding window. This page surfaces
 * all flow_type='csv' strategy_verifications rows joined to the
 * submitting team's email and strategy name.
 *
 * Admin-gated (mirrors admin/compute-jobs/page.tsx auth pattern).
 * Visual: DESIGN.md compliant — 1px borders, 8px radius, DM Sans body,
 * Geist Mono for tabular numbers, no gradients, no purples.
 */
export default async function CsvStatusPage() {
  // Auth gate (mirrors admin/compute-jobs/page.tsx:7-12 verbatim).
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (!(await isAdminUser(supabase, user))) redirect("/discovery/crypto-sma");

  // Service-role client for cross-user reads (bypasses RLS).
  const admin = createAdminClient();

  // Parallel: fetch verification rows + auth.users for email lookup.
  // PostgREST cannot join auth.users directly, so we use the admin
  // listUsers() endpoint and build an id→email map client-side.
  // limit(100) caps result size — Phase 15 has 10 onboarding teams; if
  // the founder needs more, Phase 17 / DESIGN-05 can add pagination.
  const [verificationsResult, usersResult] = await Promise.all([
    admin
      .from("strategy_verifications")
      .select(
        `
          id,
          status,
          trust_tier,
          flow_type,
          created_at,
          updated_at,
          wizard_session_id,
          strategy_id,
          strategies!inner (
            id,
            name,
            user_id
          )
        `,
      )
      .eq("flow_type", "csv")
      .order("updated_at", { ascending: false })
      .limit(100),
    admin.auth.admin.listUsers({ perPage: 1000 }),
  ]);

  const rows = verificationsResult.data ?? [];
  const emailByUserId = new Map<string, string>(
    (usersResult.data?.users ?? []).map((u) => [u.id, u.email ?? "—"]),
  );

  return (
    <>
      <PageHeader
        title="CSV Submissions"
        description="Track-record uploads from quant teams (flow_type='csv', most recent first)."
      />

      <div className="bg-white border border-border rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-page">
                {[
                  "Team Email",
                  "Strategy Name",
                  "Status",
                  "Trust Tier",
                  "Submitted At",
                  "Actions",
                ].map((h) => (
                  <th
                    key={h}
                    className="px-3 py-2 text-left text-[11px] font-medium uppercase tracking-wider text-text-muted"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                // PostgREST `!inner` returns either an object or an
                // array depending on FK shape; normalize to a single
                // row defensively.
                const stratRaw = row.strategies as
                  | { id: string; name: string; user_id: string }
                  | { id: string; name: string; user_id: string }[]
                  | null;
                const strat = Array.isArray(stratRaw) ? (stratRaw[0] ?? null) : stratRaw;
                const email = strat?.user_id
                  ? (emailByUserId.get(strat.user_id) ?? "—")
                  : "—";
                const submittedAt = new Date(row.created_at).toLocaleString(
                  "en-US",
                  {
                    month: "short",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                    timeZone: "UTC",
                  },
                );
                return (
                  <tr
                    key={row.id}
                    className="border-b border-border last:border-b-0 hover:bg-gray-50 transition-colors"
                  >
                    <td className="px-3 py-2 text-xs text-text-secondary">
                      {email}
                    </td>
                    <td className="px-3 py-2 text-sm text-text-primary">
                      {strat?.name ?? "—"}
                    </td>
                    <td className="px-3 py-2">
                      <StatusBadge status={row.status} />
                    </td>
                    <td className="px-3 py-2 text-xs text-text-secondary font-metric tabular-nums">
                      {row.trust_tier}
                    </td>
                    <td className="px-3 py-2 text-xs text-text-muted font-metric">
                      {submittedAt}
                    </td>
                    <td className="px-3 py-2">
                      {strat?.id ? (
                        <Link
                          href={`/strategies/${strat.id}`}
                          className="text-xs text-accent hover:underline"
                        >
                          View factsheet →
                        </Link>
                      ) : (
                        <span className="text-xs text-text-muted">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr>
                  <td
                    colSpan={6}
                    className="px-3 py-8 text-center text-sm text-text-muted"
                  >
                    No CSV submissions yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

function StatusBadge({ status }: { status: string }) {
  // Mirrors compute-jobs/page.tsx StatusBadge palette — neutral by
  // default, validated → green positive. No new design tokens; matches
  // existing status-badge precedent without introducing accents.
  const styles: Record<string, string> = {
    draft: "bg-gray-50 text-text-muted",
    validated: "bg-green-50 text-positive",
    metrics_captured: "bg-blue-50 text-blue-700",
    encrypted: "bg-blue-50 text-blue-700",
    report_queued: "bg-amber-50 text-amber-700",
    published: "bg-green-100 text-positive",
  };
  return (
    <span
      className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold ${
        styles[status] ?? "bg-gray-50 text-text-muted"
      }`}
    >
      {status}
    </span>
  );
}
