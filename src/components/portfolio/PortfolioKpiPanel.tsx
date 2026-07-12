import {
  formatCurrency,
  formatPercent,
  formatNumber,
  metricColor,
} from "@/lib/utils";
import { KpiPanel, type KpiPanelCell } from "@/components/kpi/KpiPanel";
import type { PortfolioAnalytics } from "@/lib/types";

/**
 * Phase 100 / 100-03 (PI-06) — `PortfolioAnalytics` → `KpiPanel` adapter.
 *
 * Replaces the divergent 4-centered-Cards KPI row (deleted this plan) at its
 * sole call site `portfolios/[id]/page.tsx:291`, folding the portfolio detail
 * KPI row onto the shared `KpiPanel` primitive. Presentation adopts the
 * KpiStrip cell contract (micro uppercase muted label + Geist Mono
 * tabular-nums value); the VALUES, formatters, colors, and null → "—" behavior
 * are byte-identical to the deleted row (UI-SPEC W4 field-mapping table). AUM
 * is KEPT (real, load-bearing detail-page data); MTD stays MTD (never
 * relabeled YTD).
 */

/**
 * Lifted VERBATIM from the deleted KPI row — the pre-existing correlation risk
 * signal. ≥0.7 red is intentional pre-existing signaling flagged (not changed)
 * by UI-SPEC W4; preserved for no-regress.
 */
function correlationColor(value: number | null | undefined): string {
  if (value == null) return "text-text-muted";
  if (value >= 0.7) return "text-negative";
  if (value >= 0.4) return "text-text-secondary";
  return "text-positive";
}

interface PortfolioKpiPanelProps {
  analytics: PortfolioAnalytics;
}

export function PortfolioKpiPanel({ analytics }: PortfolioKpiPanelProps) {
  const cells: KpiPanelCell[] = [
    {
      key: "aum",
      label: "AUM",
      value: formatCurrency(analytics.total_aum),
      valueClassName: "text-text-primary",
    },
    {
      key: "mtd",
      label: "MTD TWR",
      value: formatPercent(analytics.return_mtd),
      valueClassName: metricColor(analytics.return_mtd),
    },
    {
      key: "corr",
      label: "Avg Correlation",
      value: formatNumber(analytics.avg_pairwise_correlation),
      valueClassName: correlationColor(analytics.avg_pairwise_correlation),
    },
    {
      key: "sharpe",
      label: "Portfolio Sharpe",
      value: formatNumber(analytics.portfolio_sharpe),
      valueClassName: metricColor(analytics.portfolio_sharpe),
    },
  ];

  return <KpiPanel cells={cells} />;
}
