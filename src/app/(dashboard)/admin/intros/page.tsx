import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAdminUser } from "@/lib/admin";
import { PageHeader } from "@/components/layout/PageHeader";
import { scrubPii } from "@/lib/admin/pii-scrub";

/**
 * /admin/intros — founder triage for contact_requests (intro requests).
 *
 * Surfaces every request with source (direct | bridge), replacement_for
 * context for Bridge-sourced requests, the portfolio_snapshot (PII-scrubbed)
 * computed at request time, and the current snapshot_status.
 *
 * Access: isAdminUser gate. Non-admin → redirected.
 * PII defense: portfolio_snapshot and mandate_context are scrubbed via
 * scrubPii() before render. The writer is trusted, but defense-in-depth
 * is cheap — a future caller that accidentally embeds credentials is
 * redacted here before HTML emits.
 *
 * Visual: institutional minimalism per DESIGN.md — tables only, no cards.
 */

type ContactRequestRow = {
  id: string;
  created_at: string;
  status: string;
  source: "direct" | "bridge" | null;
  replacement_for: string | null;
  snapshot_status: "pending" | "ready" | "failed" | null;
  allocator_id: string;
  strategy_id: string;
  message: string | null;
  mandate_context: unknown;
  portfolio_snapshot: unknown;
};

type StrategyRef = { id: string; name: string };

type SnapshotStrategy = { strategy_id: string; strategy_name: string; sharpe: number | null };

function snapshotField<T>(raw: unknown, key: string): T | null {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const value = (raw as Record<string, unknown>)[key];
    return value as T;
  }
  return null;
}

function formatNumber(value: number | null, fractionDigits: number): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return value.toFixed(fractionDigits);
}

function formatPct(value: number | null): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return `${(value * 100).toFixed(1)}%`;
}

function SnapshotMiniTable({ title, rows }: { title: string; rows: SnapshotStrategy[] }) {
  if (rows.length === 0) {
    return (
      <div>
        <p className="text-[11px] uppercase tracking-wider text-text-muted mb-1">{title}</p>
        <p className="text-xs text-text-muted">—</p>
      </div>
    );
  }
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wider text-text-muted mb-1">{title}</p>
      <table className="text-xs">
        <tbody>
          {rows.map((r) => (
            <tr key={r.strategy_id}>
              <td className="pr-3 text-text-primary">{r.strategy_name}</td>
              <td className="font-metric tabular-nums text-text-secondary">
                {formatNumber(r.sharpe, 2)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default async function AdminIntrosPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (!(await isAdminUser(supabase, user))) redirect("/discovery/crypto-sma");

  const admin = createAdminClient();

  // Pull recent contact_requests; cap to 200 to keep the page bounded.
  const { data: requestsRaw } = await admin
    .from("contact_requests")
    .select(
      "id, created_at, status, source, replacement_for, snapshot_status, allocator_id, strategy_id, message, mandate_context, portfolio_snapshot",
    )
    .order("created_at", { ascending: false })
    .limit(200);

  const rows = (requestsRaw ?? []) as ContactRequestRow[];

  // Join: allocator profile + strategy name + replacement strategy name.
  const allocatorIds = Array.from(new Set(rows.map((r) => r.allocator_id)));
  const strategyIds = Array.from(
    new Set(
      rows
        .flatMap((r) => [r.strategy_id, r.replacement_for])
        .filter((v): v is string => typeof v === "string"),
    ),
  );

  const [profilesRes, strategiesRes] = await Promise.all([
    allocatorIds.length > 0
      ? admin
          .from("profiles")
          .select("id, display_name, email, company")
          .in("id", allocatorIds)
      : Promise.resolve({ data: [] as Array<{ id: string; display_name: string | null; email: string | null; company: string | null }> }),
    strategyIds.length > 0
      ? admin.from("strategies").select("id, name").in("id", strategyIds)
      : Promise.resolve({ data: [] as StrategyRef[] }),
  ]);

  const profiles = profilesRes.data ?? [];
  const strategies = (strategiesRes.data ?? []) as StrategyRef[];

  const profileMap = new Map(profiles.map((p) => [p.id, p]));
  const strategyMap = new Map(strategies.map((s) => [s.id, s.name]));

  return (
    <>
      <PageHeader
        title="Intro Requests"
        description="Allocator → manager introductions. Bridge-sourced rows include replacement context."
      />

      {rows.length === 0 ? (
        <p className="text-sm text-text-muted">No intro requests yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left">
                <th className="py-2 pr-4 font-medium text-text-muted text-xs uppercase tracking-wider">
                  When
                </th>
                <th className="py-2 pr-4 font-medium text-text-muted text-xs uppercase tracking-wider">
                  Allocator
                </th>
                <th className="py-2 pr-4 font-medium text-text-muted text-xs uppercase tracking-wider">
                  Strategy
                </th>
                <th className="py-2 pr-4 font-medium text-text-muted text-xs uppercase tracking-wider">
                  Source
                </th>
                <th className="py-2 pr-4 font-medium text-text-muted text-xs uppercase tracking-wider">
                  Replaces
                </th>
                <th className="py-2 pr-4 font-medium text-text-muted text-xs uppercase tracking-wider">
                  Snapshot
                </th>
                <th className="py-2 font-medium text-text-muted text-xs uppercase tracking-wider">
                  Top/Bottom 3
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const profile = profileMap.get(row.allocator_id);
                const allocatorLabel =
                  profile?.display_name ||
                  profile?.company ||
                  profile?.email ||
                  row.allocator_id;
                const strategyName = strategyMap.get(row.strategy_id) ?? row.strategy_id;
                const replacementName = row.replacement_for
                  ? strategyMap.get(row.replacement_for) ?? row.replacement_for
                  : null;

                // Scrub the snapshot server-side BEFORE render.
                const scrubbedSnapshot = scrubPii(row.portfolio_snapshot);
                const sharpe = snapshotField<number | null>(scrubbedSnapshot, "sharpe");
                const mdd = snapshotField<number | null>(scrubbedSnapshot, "max_drawdown");
                const concentration = snapshotField<number | null>(scrubbedSnapshot, "concentration");
                const alerts7d = snapshotField<number | null>(scrubbedSnapshot, "alerts_last_7d");
                const top3 =
                  snapshotField<SnapshotStrategy[]>(scrubbedSnapshot, "top_3_strategies") ?? [];
                const bottom3 =
                  snapshotField<SnapshotStrategy[]>(scrubbedSnapshot, "bottom_3_strategies") ?? [];

                const createdAtDate = new Date(row.created_at);
                const createdAtLabel = createdAtDate.toISOString().slice(0, 16).replace("T", " ");

                const source = row.source ?? "direct";
                const snapshotStatus = row.snapshot_status ?? "ready";

                return (
                  <tr key={row.id} className="border-b border-border/60 align-top">
                    <td className="py-3 pr-4 font-metric text-xs tabular-nums text-text-secondary whitespace-nowrap">
                      {createdAtLabel}
                    </td>
                    <td className="py-3 pr-4 text-text-primary">
                      <div>{allocatorLabel}</div>
                      {profile?.email && profile.email !== allocatorLabel && (
                        <div className="text-xs text-text-muted">{profile.email}</div>
                      )}
                    </td>
                    <td className="py-3 pr-4 text-text-primary">{strategyName}</td>
                    <td className="py-3 pr-4">
                      <span
                        className={
                          source === "bridge"
                            ? "text-accent text-xs uppercase tracking-wider"
                            : "text-text-muted text-xs uppercase tracking-wider"
                        }
                      >
                        {source}
                      </span>
                    </td>
                    <td className="py-3 pr-4 text-xs text-text-secondary">
                      {replacementName ?? "—"}
                    </td>
                    <td className="py-3 pr-4">
                      <div className="space-y-0.5 text-xs">
                        <div className="text-[11px] uppercase tracking-wider text-text-muted">
                          {snapshotStatus}
                        </div>
                        <div className="text-text-primary font-metric tabular-nums">
                          Sharpe {formatNumber(sharpe, 2)}
                        </div>
                        <div className="text-text-secondary font-metric tabular-nums">
                          MDD {formatPct(mdd)}
                        </div>
                        <div className="text-text-secondary font-metric tabular-nums">
                          HHI {formatNumber(concentration, 2)}
                        </div>
                        <div className="text-text-secondary font-metric tabular-nums">
                          Alerts 7d {alerts7d ?? 0}
                        </div>
                      </div>
                    </td>
                    <td className="py-3">
                      <div className="flex gap-6">
                        <SnapshotMiniTable title="Top 3" rows={top3} />
                        <SnapshotMiniTable title="Bottom 3" rows={bottom3} />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
