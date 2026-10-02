/**
 * Phase 09 / finding g4 + LIVE-03. Holding-side factsheet card for /compare.
 *
 * Rendered by CompareTable when item.kind === 'holding'. Parity with
 * FactsheetPreview.tsx (strategy side): DM Sans labels, Geist Mono
 * numerics, 1px border, 8px radius per DESIGN.md.
 *
 * Four institutional metrics: cumulative_return, sharpe, max_drawdown, vol.
 * Missing metrics render "—" (em-dash) per institutional convention —
 * explicit-missing, never zero.
 *
 * Phase 167.1.2 / D-13: while the equity history is rebuilt the item carries
 * no analytics, and the card shows a short note in place of the four metrics.
 * Fail-closed: only an explicit `historyState === "ready"` with analytics
 * present renders numbers.
 */
import type { HoldingCompareItem } from "@/app/(dashboard)/compare/lib/holding-compare-adapter";

function fmtPct(v: number | null): string {
  if (v === null || !Number.isFinite(v)) return "—";
  return `${(v * 100).toFixed(2)}%`;
}

function fmtNum(v: number | null): string {
  if (v === null || !Number.isFinite(v)) return "—";
  return v.toFixed(2);
}

export function HoldingFactsheet({ item }: { item: HoldingCompareItem }) {
  const { venue, symbol, holding_type } = item;
  const analytics =
    item.historyState === "ready" && item.analytics != null
      ? item.analytics
      : null;
  return (
    <div
      data-testid="holding-factsheet"
      className="rounded-lg border border-border bg-surface p-6 flex flex-col gap-4"
    >
      <div className="flex items-start justify-between">
        <div>
          <span className="inline-block text-fixed-10 uppercase tracking-wider text-text-muted font-medium px-2 py-0.5 rounded-sm bg-page mb-2">
            Holding
          </span>
          <h3 className="font-display text-2xl text-text-primary">{symbol}</h3>
          <p className="text-sm text-text-secondary">
            {venue} · {holding_type}
          </p>
        </div>
      </div>

      {analytics === null ? (
        <p
          data-testid="holding-factsheet-rebuilding"
          className="max-w-prose text-sm text-text-secondary"
        >
          Return, Sharpe, max drawdown and volatility for this holding are
          hidden while your equity history is rebuilt. The history they are
          computed from could count one exchange account twice when more than
          one key reads it, and it reads buying or selling more of the holding
          as a gain or loss.
        </p>
      ) : (
        <dl className="grid grid-cols-2 gap-4">
          <div>
            <dt className="text-fixed-10 uppercase tracking-wider text-text-muted">
              Cumulative return
            </dt>
            <dd className="font-mono text-lg text-text-primary">
              {fmtPct(analytics.cumulative_return)}
            </dd>
          </div>
          <div>
            <dt className="text-fixed-10 uppercase tracking-wider text-text-muted">
              Sharpe
            </dt>
            <dd className="font-mono text-lg text-text-primary">
              {fmtNum(analytics.sharpe)}
            </dd>
          </div>
          <div>
            <dt className="text-fixed-10 uppercase tracking-wider text-text-muted">
              Max drawdown
            </dt>
            <dd className="font-mono text-lg text-text-primary">
              {fmtPct(analytics.max_drawdown)}
            </dd>
          </div>
          <div>
            <dt className="text-fixed-10 uppercase tracking-wider text-text-muted">
              Vol (annualized)
            </dt>
            <dd className="font-mono text-lg text-text-primary">
              {fmtPct(analytics.vol)}
            </dd>
          </div>
        </dl>
      )}
    </div>
  );
}
