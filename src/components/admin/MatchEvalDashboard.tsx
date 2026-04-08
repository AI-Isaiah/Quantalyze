"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";

interface WeeklyRow {
  week_start: string;
  intros: number;
  hits_top_3: number;
  hits_top_10: number;
  hit_rate_top_3: number;
  hit_rate_top_10: number;
}

interface MissedRow {
  allocator_id: string;
  strategy_id: string;
  created_at: string;
  rank_if_any: number | null;
  reason: string;
}

interface EvalMetrics {
  window_days: number;
  intros_shipped: number;
  hits_top_3: number;
  hits_top_10: number;
  hit_rate_top_3: number;
  hit_rate_top_10: number;
  weekly: WeeklyRow[];
  missed: MissedRow[];
}

export function MatchEvalDashboard() {
  const [metrics, setMetrics] = useState<EvalMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lookback, setLookback] = useState(28);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/match/eval?lookback_days=${lookback}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Failed to load metrics");
      }
      setMetrics(await res.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [lookback]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <Card className="text-center py-10">
        <p className="text-sm text-text-muted">Loading eval metrics...</p>
      </Card>
    );
  }
  if (error) {
    return (
      <Card className="border-negative/40">
        <p className="text-sm text-negative">{error}</p>
        <Button variant="secondary" size="sm" onClick={load} className="mt-3">
          Retry
        </Button>
      </Card>
    );
  }
  if (!metrics) return null;

  return (
    <div className="space-y-6">
      {/* Nav breadcrumb */}
      <nav className="flex items-center gap-2 text-sm text-text-muted">
        <Link href="/admin/match" className="hover:text-text-primary">
          Match queue
        </Link>
        <span>/</span>
        <span className="text-text-primary">Eval</span>
      </nav>

      {/* Lookback selector */}
      <div className="flex items-center gap-2">
        <span className="text-xs text-text-muted">Window:</span>
        {[7, 28, 90].map((n) => (
          <button
            key={n}
            onClick={() => setLookback(n)}
            className={`rounded-md border px-3 py-1.5 text-xs font-mono uppercase tracking-wider transition-colors ${
              lookback === n
                ? "border-accent bg-accent/10 text-accent"
                : "border-border bg-surface text-text-secondary hover:border-border-focus"
            }`}
          >
            {n}d
          </button>
        ))}
      </div>

      {/* KPI row with hairline dividers */}
      <div className="grid grid-cols-2 md:grid-cols-4 divide-x divide-border border-y border-border">
        <Kpi
          label="Intros shipped"
          value={metrics.intros_shipped.toString()}
          subtitle={`Last ${metrics.window_days} days`}
        />
        <Kpi
          label="Hit rate top-3"
          value={`${(metrics.hit_rate_top_3 * 100).toFixed(0)}%`}
          subtitle={`${metrics.hits_top_3} / ${metrics.intros_shipped}`}
        />
        <Kpi
          label="Hit rate top-10"
          value={`${(metrics.hit_rate_top_10 * 100).toFixed(0)}%`}
          subtitle={`${metrics.hits_top_10} / ${metrics.intros_shipped}`}
        />
        <Kpi
          label="Graduation gate"
          value={metrics.hit_rate_top_3 >= 0.4 ? "YES" : "NO"}
          subtitle="40% top-3 + 20+ intros"
        />
      </div>

      {/* Weekly breakdown (text table instead of a chart for v1) */}
      {metrics.weekly.length > 0 && (
        <Card>
          <h2 className="text-base font-semibold text-text-primary mb-3">
            Weekly hit rate
          </h2>
          <table className="w-full">
            <thead>
              <tr className="border-b border-border text-left">
                <th className="py-2 text-[11px] uppercase tracking-wider text-text-muted font-semibold">
                  Week
                </th>
                <th className="py-2 text-right text-[11px] uppercase tracking-wider text-text-muted font-semibold">
                  Intros
                </th>
                <th className="py-2 text-right text-[11px] uppercase tracking-wider text-text-muted font-semibold">
                  Hits top-3
                </th>
                <th className="py-2 text-right text-[11px] uppercase tracking-wider text-text-muted font-semibold">
                  Hit rate
                </th>
              </tr>
            </thead>
            <tbody>
              {metrics.weekly.map((w) => (
                <tr key={w.week_start} className="border-b border-border">
                  <td className="py-2 text-sm font-mono text-text-primary">
                    {w.week_start}
                  </td>
                  <td className="py-2 text-sm text-right font-mono tabular-nums text-text-primary">
                    {w.intros}
                  </td>
                  <td className="py-2 text-sm text-right font-mono tabular-nums text-text-primary">
                    {w.hits_top_3}
                  </td>
                  <td className="py-2 text-sm text-right font-mono tabular-nums text-text-primary">
                    {(w.hit_rate_top_3 * 100).toFixed(0)}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {/* Missed intros */}
      {metrics.missed.length > 0 && (
        <Card>
          <h2 className="text-base font-semibold text-text-primary mb-1">
            Intros the algorithm missed
          </h2>
          <p className="text-xs text-text-muted mb-3">
            These are intros you shipped where the strategy wasn&apos;t in the
            top-3 of the most recent batch. Use this list to tune preferences or
            retrain the engine over time.
          </p>
          <table className="w-full">
            <thead>
              <tr className="border-b border-border text-left">
                <th className="py-2 text-[11px] uppercase tracking-wider text-text-muted font-semibold">
                  Date
                </th>
                <th className="py-2 text-[11px] uppercase tracking-wider text-text-muted font-semibold">
                  Allocator
                </th>
                <th className="py-2 text-[11px] uppercase tracking-wider text-text-muted font-semibold">
                  Strategy
                </th>
                <th className="py-2 text-right text-[11px] uppercase tracking-wider text-text-muted font-semibold">
                  Rank
                </th>
                <th className="py-2 text-[11px] uppercase tracking-wider text-text-muted font-semibold">
                  Why
                </th>
              </tr>
            </thead>
            <tbody>
              {metrics.missed.map((m) => (
                <tr
                  key={`${m.allocator_id}-${m.strategy_id}-${m.created_at}`}
                  className="border-b border-border"
                >
                  <td className="py-2 text-xs font-mono text-text-muted">
                    {new Date(m.created_at).toLocaleDateString()}
                  </td>
                  <td className="py-2 text-xs font-mono text-text-secondary">
                    {m.allocator_id.slice(0, 8)}
                  </td>
                  <td className="py-2 text-xs font-mono text-text-secondary">
                    {m.strategy_id.slice(0, 8)}
                  </td>
                  <td className="py-2 text-xs text-right font-mono text-text-primary">
                    {m.rank_if_any ?? "—"}
                  </td>
                  <td className="py-2 text-xs text-text-muted">{m.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {metrics.intros_shipped === 0 && (
        <Card className="text-center py-10">
          <h3 className="text-base font-semibold text-text-primary">
            Your hit-rate dashboard isn&rsquo;t ready yet
          </h3>
          <p className="mt-2 text-sm text-text-secondary max-w-lg mx-auto">
            Ship 5+ introductions from the Match Queue and this view will
            compare the algorithm&rsquo;s ranking to the intros you actually
            sent — so you can see where the signal holds up and where the
            model is blind.
          </p>
          <p className="mt-1 text-xs text-text-muted">
            Intros shipped in the last {metrics.window_days} days:{" "}
            <span className="font-mono tabular-nums text-text-primary">
              {metrics.intros_shipped}
            </span>
          </p>
          <div className="mt-4">
            <Link
              href="/admin/match"
              className="inline-flex items-center text-sm font-medium text-accent hover:text-accent-hover"
            >
              Open the Match Queue →
            </Link>
          </div>
        </Card>
      )}
    </div>
  );
}

function Kpi({ label, value, subtitle }: { label: string; value: string; subtitle: string }) {
  return (
    <div className="px-4 py-4">
      <p className="text-[10px] uppercase tracking-wider text-text-muted font-medium">
        {label}
      </p>
      <p className="mt-1 font-mono tabular-nums text-[32px] text-text-primary">
        {value}
      </p>
      <p className="mt-1 text-xs text-text-muted">{subtitle}</p>
    </div>
  );
}
