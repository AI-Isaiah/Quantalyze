// Pagination: this page takes the first 200 rows ordered by pending-first
// then recency. At >200 pending requests, switch to cursor-based
// pagination (Sprint 7). The 90-day terminal-state cleanup cron referenced
// in the design note below is NOT yet implemented in migration 056 — also
// Sprint 7 (see ADR-0024 "Open questions / Sprint 7").
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAdminUser } from "@/lib/admin";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { DeletionRequestActions } from "@/components/admin/DeletionRequestActions";

/** Map a row's (completed_at, rejected_at) terminal timestamps to a
 * human-readable status label. A row has at most one terminal timestamp
 * set at a time (mutually exclusive per the admin flow in ADR-0024), so
 * the precedence here is arbitrary — completed wins if both are somehow
 * set, but that's a data-integrity bug to log rather than silently pick. */
function statusOf(row: {
  completed_at: string | null;
  rejected_at: string | null;
}): string {
  if (row.completed_at) return "Sanitized";
  if (row.rejected_at) return "Rejected";
  return "Pending";
}

/**
 * /admin/deletion-requests — admin-only list of GDPR Art. 17 deletion
 * requests with approve/reject buttons.
 *
 * Sprint 6 closeout Task 7.3. Uses `isAdminUser` (legacy gate) for the
 * page itself; the approve/reject API calls use the new
 * `withRole("admin")` wrapper — matching the pattern shipped by Task 7.2
 * for `/admin/users/`.
 *
 * Listing strategy: pending requests (neither completed nor rejected)
 * come first, then recent terminal states for audit visibility. The
 * "Pending" badge surfaces the waiting queue at a glance.
 */
export default async function AdminDeletionRequestsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (!(await isAdminUser(supabase, user))) redirect("/discovery/crypto-sma");

  const admin = createAdminClient();

  // One query returns pending + recent terminal rows. The order ensures
  // pending rows are at the top; terminal rows follow in descending
  // recency. The limit is generous — the pending queue is expected to
  // stay small, a large terminal backlog will eventually fall off via
  // the 90-day retention cron in a future migration.
  const { data: requests } = await admin
    .from("data_deletion_requests")
    .select(
      "id, user_id, requested_at, completed_at, rejected_at, rejection_reason, notes",
    )
    .order("completed_at", { ascending: true, nullsFirst: true })
    .order("rejected_at", { ascending: true, nullsFirst: true })
    .order("requested_at", { ascending: false })
    .limit(200);

  const rows = requests ?? [];

  // Batch-fetch the target profiles so we render "name + email" without
  // an N+1.
  const userIds = Array.from(new Set(rows.map((r) => r.user_id)));
  const { data: profiles } = userIds.length
    ? await admin
        .from("profiles")
        .select("id, display_name, email")
        .in("id", userIds)
    : { data: [] };
  const profileById = new Map<
    string,
    { display_name: string | null; email: string | null }
  >();
  for (const p of profiles ?? []) {
    profileById.set(p.id, {
      display_name: p.display_name ?? null,
      email: p.email ?? null,
    });
  }

  const pending = rows.filter((r) => !r.completed_at && !r.rejected_at);
  const terminal = rows.filter((r) => r.completed_at || r.rejected_at);

  return (
    <>
      <PageHeader
        title="Deletion requests"
        description={`${pending.length} pending · ${terminal.length} terminal (last 200)`}
      />

      <Card padding="sm">
        {rows.length === 0 ? (
          <p className="p-6 text-center text-text-muted text-sm">
            No deletion requests yet.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-[11px] uppercase tracking-wider text-text-muted">
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">User</th>
                  <th className="px-4 py-3 font-medium">Requested</th>
                  <th className="px-4 py-3 font-medium">Terminal at</th>
                  <th className="px-4 py-3 font-medium">Notes / reason</th>
                  <th className="px-4 py-3 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const profile = profileById.get(r.user_id);
                  const status = statusOf(r);
                  const terminalAt = r.completed_at ?? r.rejected_at;
                  return (
                    <tr
                      key={r.id}
                      className="border-b border-border last:border-0 hover:bg-page transition-colors"
                    >
                      <td className="px-4 py-3">
                        <Badge label={status} />
                      </td>
                      <td className="px-4 py-3 text-text-primary">
                        <div className="font-medium">
                          {profile?.display_name ?? "—"}
                        </div>
                        {profile?.email && (
                          <div className="text-text-muted text-xs font-mono">
                            {profile.email}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-text-secondary text-xs">
                        {new Date(r.requested_at).toLocaleString()}
                      </td>
                      <td className="px-4 py-3 text-text-secondary text-xs">
                        {terminalAt
                          ? new Date(terminalAt).toLocaleString()
                          : "—"}
                      </td>
                      <td className="px-4 py-3 text-text-secondary text-xs max-w-[240px]">
                        {r.rejection_reason || r.notes || "—"}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {!r.completed_at && !r.rejected_at && (
                          <DeletionRequestActions requestId={r.id} />
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
