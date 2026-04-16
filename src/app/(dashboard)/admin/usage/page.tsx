import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAdminUser } from "@/lib/admin";
import { PageHeader } from "@/components/layout/PageHeader";
import {
  dailyFunnel,
  widgetViews,
  sessionHeatmap,
  type SessionHeatmapRow,
} from "@/lib/admin/usage-metrics";

/**
 * /admin/usage — allocator usage funnel page.
 *
 * Three sections, tables only (no cards), per DESIGN.md institutional
 * minimalism. PostHog is the data source for all three queries; if it
 * is unreachable the helpers return an empty shape with `error` set
 * and we render a small "PostHog unavailable" notice in place of the
 * table.
 *
 * Admin gate mirrors `/admin/intros` — both legacy email match and the
 * `profiles.is_admin` column are accepted.
 */

export const dynamic = "force-dynamic"; // PostHog data must not be ISR'd

function NoticeBox({ message }: { message: string }) {
  return (
    <div className="rounded-md border border-border/60 bg-surface px-4 py-3 text-sm text-text-secondary">
      {message}
    </div>
  );
}

export default async function AdminUsagePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (!(await isAdminUser(supabase, user))) redirect("/discovery/crypto-sma");

  const admin = createAdminClient();

  const [funnel, widgets, heatmap] = await Promise.all([
    dailyFunnel(30),
    widgetViews(30),
    sessionHeatmap(14),
  ]);

  // Heatmap join: PostHog returns rows keyed by distinct_id (which is
  // the auth user id for identified users). Look up profile labels in
  // one batch query. Anonymous distinct_ids stay as their raw id —
  // they're useful signal for diagnosing identify() gaps.
  let heatmapRows: SessionHeatmapRow[] = heatmap.rows;
  if (heatmapRows.length > 0) {
    const ids = heatmapRows.map((r) => r.email).filter((s) => s.length > 0);
    const { data: profiles } = await admin
      .from("profiles")
      .select("id, email, display_name")
      .in("id", ids);
    const idToLabel = new Map<string, string>();
    for (const p of profiles ?? []) {
      idToLabel.set(
        p.id as string,
        (p.email as string) ||
          (p.display_name as string) ||
          (p.id as string),
      );
    }
    heatmapRows = heatmapRows.map((r) => ({
      ...r,
      email: idToLabel.get(r.email) ?? r.email,
    }));
  }

  return (
    <>
      <PageHeader
        title="Usage Analytics"
        description="Allocator engagement funnel sourced from PostHog. session_count is mirrored server-side in user_metadata."
      />

      {/* ───── Section 1: Daily funnel ───── */}
      <section className="mb-12">
        <h2 className="font-display text-2xl text-text-primary mb-3">
          Daily funnel (30d)
        </h2>
        {funnel.error ? (
          <NoticeBox message={`PostHog unavailable: ${funnel.error}`} />
        ) : funnel.rows.length === 0 ? (
          <p className="text-sm text-text-muted">No usage events yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left">
                  <th className="py-2 pr-4 font-medium text-text-muted text-xs uppercase tracking-wider">
                    Day
                  </th>
                  <th className="py-2 pr-4 font-medium text-text-muted text-xs uppercase tracking-wider text-right">
                    session_start
                  </th>
                  <th className="py-2 pr-4 font-medium text-text-muted text-xs uppercase tracking-wider text-right">
                    widget_viewed
                  </th>
                  <th className="py-2 pr-4 font-medium text-text-muted text-xs uppercase tracking-wider text-right">
                    intro_submitted
                  </th>
                  <th className="py-2 pr-4 font-medium text-text-muted text-xs uppercase tracking-wider text-right">
                    bridge_click
                  </th>
                  <th className="py-2 font-medium text-text-muted text-xs uppercase tracking-wider text-right">
                    alert_acknowledged
                  </th>
                </tr>
              </thead>
              <tbody>
                {funnel.rows.map((row) => (
                  <tr key={row.day} className="border-b border-border/60">
                    <td className="py-2 pr-4 font-metric text-xs tabular-nums text-text-secondary whitespace-nowrap">
                      {row.day}
                    </td>
                    <td className="py-2 pr-4 text-text-primary font-metric tabular-nums text-right">
                      {row.session_start}
                    </td>
                    <td className="py-2 pr-4 text-text-primary font-metric tabular-nums text-right">
                      {row.widget_viewed}
                    </td>
                    <td className="py-2 pr-4 text-text-primary font-metric tabular-nums text-right">
                      {row.intro_submitted}
                    </td>
                    <td className="py-2 pr-4 text-text-primary font-metric tabular-nums text-right">
                      {row.bridge_click}
                    </td>
                    <td className="py-2 text-text-primary font-metric tabular-nums text-right">
                      {row.alert_acknowledged}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ───── Section 2: Widget views ───── */}
      <section className="mb-12">
        <h2 className="font-display text-2xl text-text-primary mb-3">
          Widget views (30d)
        </h2>
        {widgets.error ? (
          <NoticeBox message={`PostHog unavailable: ${widgets.error}`} />
        ) : widgets.rows.length === 0 ? (
          <p className="text-sm text-text-muted">No widget_viewed events yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left">
                  <th className="py-2 pr-4 font-medium text-text-muted text-xs uppercase tracking-wider">
                    Widget id
                  </th>
                  <th className="py-2 pr-4 font-medium text-text-muted text-xs uppercase tracking-wider text-right">
                    Views
                  </th>
                  <th className="py-2 font-medium text-text-muted text-xs uppercase tracking-wider text-right">
                    Unique allocators
                  </th>
                </tr>
              </thead>
              <tbody>
                {widgets.rows.map((row) => (
                  <tr key={row.widget_id} className="border-b border-border/60">
                    <td className="py-2 pr-4 text-text-primary">{row.widget_id}</td>
                    <td className="py-2 pr-4 text-text-primary font-metric tabular-nums text-right">
                      {row.views}
                    </td>
                    <td className="py-2 text-text-primary font-metric tabular-nums text-right">
                      {row.unique_allocators}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ───── Section 3: Session heatmap ───── */}
      <section>
        <h2 className="font-display text-2xl text-text-primary mb-3">
          Session heatmap (14d)
        </h2>
        {heatmap.error ? (
          <NoticeBox message={`PostHog unavailable: ${heatmap.error}`} />
        ) : heatmapRows.length === 0 ? (
          <p className="text-sm text-text-muted">No session_start events yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left">
                  <th className="py-2 pr-4 font-medium text-text-muted text-xs uppercase tracking-wider">
                    Allocator
                  </th>
                  {heatmap.days.map((d) => (
                    <th
                      key={d}
                      className="py-2 pr-2 font-medium text-text-muted text-[10px] uppercase tracking-wider text-right whitespace-nowrap"
                    >
                      {d.slice(5)}
                    </th>
                  ))}
                  <th className="py-2 font-medium text-text-muted text-xs uppercase tracking-wider text-right">
                    Total
                  </th>
                </tr>
              </thead>
              <tbody>
                {heatmapRows.map((row) => (
                  <tr key={row.email} className="border-b border-border/60">
                    <td className="py-2 pr-4 text-text-primary text-xs whitespace-nowrap">
                      {row.email}
                    </td>
                    {heatmap.days.map((d) => (
                      <td
                        key={d}
                        className="py-2 pr-2 font-metric tabular-nums text-text-secondary text-right text-xs"
                      >
                        {row.by_day[d] ?? 0}
                      </td>
                    ))}
                    <td className="py-2 text-text-primary font-metric tabular-nums text-right">
                      {row.total}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
