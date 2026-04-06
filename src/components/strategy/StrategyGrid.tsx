"use client";

import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { VerifiedBadge } from "@/components/ui/VerifiedBadge";
import { Sparkline } from "@/components/charts/Sparkline";
import { SyncBadge } from "./SyncBadge";
import { formatPercent, formatCurrency, metricColor } from "@/lib/utils";
import type { Strategy, StrategyAnalytics } from "@/lib/types";

type StrategyWithAnalytics = Strategy & { analytics: StrategyAnalytics };

interface StrategyGridProps {
  strategies: StrategyWithAnalytics[];
  categorySlug: string;
  basePath?: string;
}

export function StrategyGrid({ strategies, categorySlug, basePath = "/discovery" }: StrategyGridProps) {
  if (strategies.length === 0) {
    return (
      <div className="text-center py-12 text-text-muted text-sm">
        No strategies match your filters.
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {strategies.map((s) => (
        <Link
          key={s.id}
          href={`${basePath}/${categorySlug}/${s.id}`}
          className="block group"
        >
          <Card
            padding="sm"
            className="h-full transition-shadow hover:shadow-elevated group-hover:border-accent/30 max-[375px]:p-2.5"
          >
            {/* Header: name + badges */}
            <div className="mb-3 max-[375px]:mb-2">
              <div className="flex items-start gap-2 min-h-[44px] max-[375px]:min-h-[44px]">
                <h3 className="text-sm font-semibold text-text-primary group-hover:text-accent transition-colors leading-tight truncate min-w-0">
                  {s.name}
                </h3>
                {s.api_key_id && <VerifiedBadge className="shrink-0 mt-0.5" />}
                {s.is_example && (
                  <span className="shrink-0 mt-0.5 inline-flex items-center rounded-md bg-badge-other/10 text-badge-other px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider">
                    Example
                  </span>
                )}
              </div>
              <div className="flex flex-wrap gap-1 mt-1.5 max-[375px]:flex-col max-[375px]:gap-0.5">
                {s.strategy_types.map((t) => (
                  <Badge key={t} label={t} />
                ))}
              </div>
            </div>

            {/* Sync freshness */}
            <SyncBadge
              computedAt={s.analytics.computed_at}
              exchange={s.supported_exchanges?.[0]}
              className="mb-2"
            />

            {/* AUM / Max Capacity */}
            <div className="flex items-center gap-4 text-xs text-text-muted mb-3 max-[375px]:mb-2 max-[375px]:gap-2">
              <span>
                AUM{" "}
                <span className="text-text-secondary font-medium">
                  {formatCurrency(s.aum)}
                </span>
              </span>
              <span>
                Cap{" "}
                <span className="text-text-secondary font-medium">
                  {formatCurrency(s.max_capacity)}
                </span>
              </span>
            </div>

            {/* Sparkline */}
            <div className="mb-3 max-[375px]:mb-2">
              <Sparkline
                data={s.analytics.sparkline_returns ?? []}
                width={240}
                height={40}
                className="w-full"
              />
            </div>

            {/* Footer metrics */}
            <div className="flex items-center justify-between border-t border-border pt-2.5 min-h-[44px]">
              <div className="text-xs">
                <span className="text-text-muted">Return </span>
                <span className={`font-metric font-medium ${metricColor(s.analytics.cumulative_return)}`}>
                  {formatPercent(s.analytics.cumulative_return)}
                </span>
              </div>
              <div className="text-xs">
                <span className="text-text-muted">CAGR </span>
                <span className={`font-metric font-medium ${metricColor(s.analytics.cagr)}`}>
                  {formatPercent(s.analytics.cagr)}
                </span>
              </div>
            </div>
          </Card>
        </Link>
      ))}
    </div>
  );
}
