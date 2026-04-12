import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAdminUser } from "@/lib/admin";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/PageHeader";

export default async function ComputeJobsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (!(await isAdminUser(supabase, user))) redirect("/discovery/crypto-sma");

  const admin = createAdminClient();

  // Parallel queries for fill health indicators
  const [jobsResult, fillHealthResult, dqfResult] = await Promise.all([
    // Recent compute jobs
    admin
      .from("compute_jobs")
      .select(
        "id, strategy_id, portfolio_id, kind, status, attempts, max_attempts, last_error, error_kind, exchange, trade_count, created_at, updated_at",
      )
      .order("updated_at", { ascending: false })
      .limit(50),

    // Strategies with USE_RAW_TRADE_INGESTION but 0 fill rows:
    // Find strategies that have an api_key_id (connected exchange) but no fills
    admin.rpc("get_strategies_missing_fills"),

    // Compute_analytics jobs with position_metrics_failed
    admin
      .from("strategy_analytics")
      .select("strategy_id, data_quality_flags")
      .not("data_quality_flags", "is", null),
  ]);

  const jobs = jobsResult.data ?? [];

  // Count strategies missing fills — RPC may not exist yet, fall back gracefully
  const strategiesMissingFills = Array.isArray(fillHealthResult?.data)
    ? fillHealthResult.data.length
    : null;

  // Count analytics rows where position_metrics_failed is true
  const failedPositionMetrics = (dqfResult.data ?? []).filter((row) => {
    const flags = row.data_quality_flags as Record<string, unknown> | null;
    return flags?.position_metrics_failed === true;
  }).length;

  // Job status summary
  const statusCounts: Record<string, number> = {};
  for (const j of jobs) {
    statusCounts[j.status] = (statusCounts[j.status] ?? 0) + 1;
  }

  return (
    <>
      <PageHeader title="Compute Jobs" description="Job queue monitoring and fill health" />

      {/* Fill health indicators */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
        <HealthCard
          label="Strategies Missing Fills"
          value={strategiesMissingFills != null ? String(strategiesMissingFills) : "N/A"}
          description="API-connected strategies with 0 fill rows"
          variant={strategiesMissingFills != null && strategiesMissingFills > 0 ? "warning" : "ok"}
        />
        <HealthCard
          label="Position Metrics Failed"
          value={String(failedPositionMetrics)}
          description="Analytics rows with position_metrics_failed flag"
          variant={failedPositionMetrics > 0 ? "warning" : "ok"}
        />
        <HealthCard
          label="Recent Jobs"
          value={String(jobs.length)}
          description={Object.entries(statusCounts)
            .map(([s, c]) => `${s}: ${c}`)
            .join(", ") || "No jobs"}
          variant="neutral"
        />
      </div>

      {/* Jobs table */}
      <div className="bg-white border border-border rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-page">
                {["Kind", "Status", "Target", "Attempts", "Exchange", "Trades", "Error", "Updated"].map((h) => (
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
              {jobs.map((job) => (
                <tr key={job.id} className="border-b border-border last:border-b-0 hover:bg-gray-50 transition-colors">
                  <td className="px-3 py-2 font-metric text-xs text-text-primary">{job.kind}</td>
                  <td className="px-3 py-2">
                    <StatusBadge status={job.status} />
                  </td>
                  <td className="px-3 py-2 text-xs text-text-muted font-metric truncate max-w-[120px]">
                    {(job.strategy_id ?? job.portfolio_id ?? "—").slice(0, 8)}
                  </td>
                  <td className="px-3 py-2 font-metric text-xs text-text-secondary">
                    {job.attempts}/{job.max_attempts}
                  </td>
                  <td className="px-3 py-2 text-xs text-text-muted">{job.exchange ?? "—"}</td>
                  <td className="px-3 py-2 font-metric text-xs text-text-secondary">
                    {job.trade_count != null ? job.trade_count.toLocaleString() : "—"}
                  </td>
                  <td className="px-3 py-2 text-xs text-negative truncate max-w-[200px]" title={job.last_error ?? undefined}>
                    {job.last_error ? `${job.error_kind ?? ""}: ${job.last_error.slice(0, 60)}` : "—"}
                  </td>
                  <td className="px-3 py-2 text-xs text-text-muted font-metric">
                    {new Date(job.updated_at).toLocaleString("en-US", {
                      month: "short",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                      timeZone: "UTC",
                    })}
                  </td>
                </tr>
              ))}
              {jobs.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-3 py-8 text-center text-sm text-text-muted">
                    No compute jobs found.
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

function HealthCard({
  label,
  value,
  description,
  variant,
}: {
  label: string;
  value: string;
  description: string;
  variant: "ok" | "warning" | "neutral";
}) {
  const borderColor =
    variant === "warning"
      ? "border-warning/30 bg-warning/5"
      : variant === "ok"
        ? "border-positive/20 bg-positive/5"
        : "border-border bg-white";

  const valueColor =
    variant === "warning"
      ? "text-warning"
      : variant === "ok"
        ? "text-positive"
        : "text-text-primary";

  return (
    <div className={`rounded-lg border px-4 py-3 ${borderColor}`}>
      <p className="text-[10px] uppercase tracking-wider text-text-muted font-medium">{label}</p>
      <p className={`mt-1 text-2xl font-bold font-metric ${valueColor}`}>{value}</p>
      <p className="mt-1 text-xs text-text-muted">{description}</p>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    pending: "bg-blue-50 text-blue-700",
    running: "bg-amber-50 text-amber-700",
    done: "bg-green-50 text-positive",
    done_pending_children: "bg-green-50 text-positive",
    failed_retry: "bg-red-50 text-negative",
    failed_final: "bg-red-100 text-negative",
  };

  return (
    <span className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold ${styles[status] ?? "bg-gray-50 text-text-muted"}`}>
      {status}
    </span>
  );
}
