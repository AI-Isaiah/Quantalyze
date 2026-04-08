"use client";

import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { displayStrategyName } from "@/lib/strategy-display";
import type { CandidateRow } from "@/components/admin/AllocatorMatchQueue";

export function CandidateDetail({
  candidate,
  alreadySent,
  isKept,
  isSkipped,
  isReadOnly = false,
  onSendIntro,
  onKeep,
  onSkip,
}: {
  candidate: CandidateRow;
  alreadySent: boolean;
  isKept: boolean;
  isSkipped: boolean;
  /** When true, hide all decision/intro action buttons (mobile read-only). */
  isReadOnly?: boolean;
  onSendIntro: () => void;
  onKeep: () => void;
  onSkip: () => void;
}) {
  const strategy = candidate.strategies;
  const analytics = candidate.analytics;
  const breakdown = candidate.score_breakdown;
  const raw = breakdown.raw ?? {};

  return (
    <Card>
      {/* Title + score */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1">
          <p className="text-[10px] uppercase tracking-wider text-text-muted font-medium mb-1">
            Rank {candidate.rank}
          </p>
          <h2 className="text-[20px] font-display text-text-primary">
            {displayStrategyName(strategy)}
          </h2>
          {strategy?.strategy_types && strategy.strategy_types.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {strategy.strategy_types.map((type) => (
                <span
                  key={type}
                  className="inline-flex items-center rounded border border-border bg-surface px-2 py-0.5 text-[10px] font-mono uppercase tracking-wider text-text-secondary"
                >
                  {type}
                </span>
              ))}
            </div>
          )}
        </div>
        <div className="text-right">
          <span className="font-mono tabular-nums text-[32px] text-text-primary">
            {candidate.score.toFixed(0)}
          </span>
          <div className="mt-1 h-[2px] w-[64px] bg-border ml-auto">
            <div
              className="h-full bg-accent"
              style={{ width: `${Math.min(100, candidate.score)}%` }}
            />
          </div>
        </div>
      </div>

      {/* Metrics grid */}
      <div className="mt-6 grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-3 border-t border-border pt-4">
        <Metric label="Sharpe" value={fmtNum(analytics?.sharpe)} />
        <Metric label="CAGR" value={fmtPct(analytics?.cagr)} />
        <Metric label="Volatility" value={fmtPct(analytics?.volatility)} />
        <Metric label="Max DD" value={fmtPct(analytics?.max_drawdown)} />
        <Metric label="6M return" value={fmtPct(analytics?.six_month_return)} />
        <Metric label="Total return" value={fmtPct(analytics?.cumulative_return)} />
        <Metric
          label="Manager AUM"
          value={fmtUsd(analytics?.total_aum ?? strategy?.aum)}
        />
        <Metric
          label="Track record"
          value={
            raw.track_record_days != null
              ? `${Math.floor(raw.track_record_days / 30)}mo`
              : "—"
          }
        />
        <Metric
          label="Concentration"
          value={fmtPct(raw.ticket_concentration)}
        />
      </div>

      {/* Reasons */}
      {candidate.reasons.length > 0 && (
        <div className="mt-6 border-t border-border pt-4">
          <p className="text-[10px] uppercase tracking-wider text-text-muted font-medium mb-2">
            Why this match
          </p>
          <ul className="space-y-1.5">
            {candidate.reasons.map((reason) => (
              <li key={reason} className="flex items-start gap-2 text-sm text-text-secondary">
                <span className="mt-[6px] h-1 w-1 rounded-full bg-accent shrink-0" />
                {reason}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Sub-scores */}
      <div className="mt-6 border-t border-border pt-4">
        <p className="text-[10px] uppercase tracking-wider text-text-muted font-medium mb-3">
          Score breakdown
        </p>
        <div className="space-y-2">
          {breakdown.portfolio_fit !== undefined && (
            <SubScoreBar label="Portfolio fit" value={breakdown.portfolio_fit} />
          )}
          {breakdown.preference_fit !== undefined && (
            <SubScoreBar label="Preference fit" value={breakdown.preference_fit} />
          )}
          {breakdown.track_record !== undefined && (
            <SubScoreBar label="Track record" value={breakdown.track_record} />
          )}
          {breakdown.capacity_fit !== undefined && (
            <SubScoreBar label="Capacity fit" value={breakdown.capacity_fit} />
          )}
        </div>
      </div>

      {/* Action bar — hidden in read-only mode (mobile <md). */}
      {!isReadOnly && (
        <div className="mt-6 border-t border-border pt-4 flex items-center gap-2 flex-wrap">
          {alreadySent ? (
            <div className="flex-1 text-sm text-text-muted">Intro already sent to this strategy.</div>
          ) : (
            <>
              <Button variant="primary" size="sm" onClick={onSendIntro}>
                Send intro →
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={onKeep}
                disabled={isKept}
              >
                {isKept ? "KEPT ✓" : "KEEP"}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={onSkip}
                disabled={isSkipped}
              >
                {isSkipped ? "SKIPPED" : "SKIP"}
              </Button>
            </>
          )}
        </div>
      )}

      {/* Keyboard hint — only on lg+ where shortcuts actually fire. */}
      {!isReadOnly && (
        <div className="mt-4 pt-3 border-t border-border text-[10px] font-mono uppercase tracking-wider text-text-muted hidden lg:block">
          Keyboard: j/k move · s send intro · u keep · d skip · r recompute · ? help
        </div>
      )}
    </Card>
  );
}

// ─── Subcomponents ──────────────────────────────────────────────────────

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-text-muted">{label}</p>
      <p className="mt-0.5 font-mono tabular-nums text-sm text-text-primary">{value}</p>
    </div>
  );
}

function SubScoreBar({ label, value }: { label: string; value: number }) {
  const pct = Math.max(0, Math.min(1, value));
  return (
    <div className="flex items-center gap-3">
      <span className="text-xs text-text-secondary w-[110px] shrink-0">{label}</span>
      <div className="flex-1 h-[4px] bg-border rounded-sm">
        <div
          className="h-full bg-accent rounded-sm"
          style={{ width: `${pct * 100}%` }}
        />
      </div>
      <span className="font-mono tabular-nums text-xs text-text-muted w-[32px] text-right">
        {(pct * 100).toFixed(0)}
      </span>
    </div>
  );
}

// ─── Formatters ─────────────────────────────────────────────────────────

function fmtNum(v: unknown): string {
  if (v == null || typeof v !== "number") return "—";
  return v.toFixed(2);
}

function fmtPct(v: unknown): string {
  if (v == null || typeof v !== "number") return "—";
  return `${(v * 100).toFixed(1)}%`;
}

function fmtUsd(v: unknown): string {
  if (v == null || typeof v !== "number") return "—";
  if (v >= 1e9) return `$${(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `$${(v / 1e3).toFixed(0)}k`;
  return `$${v.toFixed(0)}`;
}
