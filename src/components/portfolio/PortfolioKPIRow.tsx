import { Card } from "@/components/ui/Card";
import { formatCurrency, formatPercent, formatNumber, metricColor } from "@/lib/utils";
import type { PortfolioAnalytics } from "@/lib/types";

function correlationColor(value: number | null | undefined): string {
  if (value == null) return "text-text-muted";
  if (value >= 0.7) return "text-negative";
  if (value >= 0.4) return "text-text-secondary";
  return "text-positive";
}

interface PortfolioKPIRowProps {
  analytics: PortfolioAnalytics;
}

export function PortfolioKPIRow({ analytics }: PortfolioKPIRowProps) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      <Card padding="sm" className="text-center">
        <p className="text-[10px] uppercase tracking-wider text-text-muted font-medium">
          AUM
        </p>
        <p className="mt-1 text-2xl font-bold font-metric text-text-primary">
          {formatCurrency(analytics.total_aum)}
        </p>
      </Card>
      <Card padding="sm" className="text-center">
        <p className="text-[10px] uppercase tracking-wider text-text-muted font-medium">
          MTD TWR
        </p>
        <p className={`mt-1 text-2xl font-bold font-metric ${metricColor(analytics.return_mtd)}`}>
          {formatPercent(analytics.return_mtd)}
        </p>
      </Card>
      <Card padding="sm" className="text-center">
        <p className="text-[10px] uppercase tracking-wider text-text-muted font-medium">
          Avg Correlation
        </p>
        <p className={`mt-1 text-2xl font-bold font-metric ${correlationColor(analytics.avg_pairwise_correlation)}`}>
          {formatNumber(analytics.avg_pairwise_correlation)}
        </p>
      </Card>
      <Card padding="sm" className="text-center">
        <p className="text-[10px] uppercase tracking-wider text-text-muted font-medium">
          Portfolio Sharpe
        </p>
        <p className={`mt-1 text-2xl font-bold font-metric ${metricColor(analytics.portfolio_sharpe)}`}>
          {formatNumber(analytics.portfolio_sharpe)}
        </p>
      </Card>
    </div>
  );
}
