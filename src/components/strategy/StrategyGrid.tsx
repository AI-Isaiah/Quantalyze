"use client";

import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { VerifiedBadge } from "@/components/ui/VerifiedBadge";
import { Sparkline } from "@/components/charts/Sparkline";
import { sparklineColor } from "@/lib/sparkline-color";
import { SyncBadge } from "./SyncBadge";
import { TrustTierLabel } from "./TrustTierLabel";
import { HealthScore } from "./HealthScore";
import { StarToggle } from "./StarToggle";
import { formatPercent, formatCurrency, metricColor } from "@/lib/utils";
import type { Strategy, StrategyAnalytics } from "@/lib/types";

type StrategyWithAnalytics = Strategy & { analytics: StrategyAnalytics };

interface StrategyGridProps {
  strategies: StrategyWithAnalytics[];
  categorySlug: string;
  basePath?: string;
  /**
   * When present (allocator on /discovery) each card renders a top-right
   * <StarToggle> wired to the parent's watchedSet + onToggleStar. Undefined
   * on /browse (public, unauth) — cards render unchanged.
   */
  userId?: string;
  watchedSet?: Set<string>;
  onToggleStar?: (strategyId: string, nextStarred: boolean) => void;
}

export function StrategyGrid({
  strategies,
  categorySlug,
  basePath = "/discovery",
  userId,
  watchedSet,
  onToggleStar,
}: StrategyGridProps) {
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
        <div key={s.id} className="relative">
          <Link
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
                  {/* TYPE-02 truncation recovery: the tile <h3> stays
                      single-line (`truncate min-w-0`) so it keeps the
                      `min-h-[44px]` header row aligned with the badges +
                      star overlay; `title={s.name}` recovers the full,
                      REAL strategy name on hover/AT (wizardErrors.ts:481
                      warns managers that longer names truncate). The tile
                      always renders the honest {s.name} — never a fabricated
                      placeholder (STATE-02 / no-invented-data). */}
                  <h3
                    title={s.name}
                    className="text-sm font-semibold text-text-primary group-hover:text-accent transition-colors leading-tight truncate min-w-0"
                  >
                    {s.name}
                  </h3>
                  <HealthScore analytics={s.analytics} startDate={s.start_date} className="shrink-0 mt-0.5" />
                  {s.api_key_id && (
                    <VerifiedBadge
                      trustTier={s.trust_tier}
                      className="shrink-0 mt-0.5"
                    />
                  )}
                  {s.is_example && (
                    <span className="shrink-0 mt-0.5 inline-flex items-center rounded-md bg-badge-other/10 text-badge-other px-1.5 py-0.5 text-micro font-semibold uppercase tracking-wider">
                      Example
                    </span>
                  )}
                  {/* Reserve right-edge space so the absolute-positioned star
                      below never overlaps badges/title. The star is rendered
                      OUTSIDE the <Link> so its <button> is not nested in <a>. */}
                  {userId !== undefined && <span className="shrink-0 w-8 h-8" aria-hidden="true" />}
                </div>
                <div className="flex flex-wrap gap-1 mt-1.5 max-[375px]:flex-col max-[375px]:gap-0.5">
                  {s.strategy_types.map((t) => (
                    <Badge key={t} label={t} />
                  ))}
                </div>
              </div>

              {/* Phase 15 / CSV-03: trust-tier placeholder. csv_uploaded
                  renders muted text; api_verified / self_reported / null
                  render nothing — Phase 17 / DESIGN-01 fills those in. */}
              <TrustTierLabel
                trustTier={s.trust_tier}
                className="mb-1"
              />

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
                  color={sparklineColor(s.analytics.sparkline_returns ?? [])}
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
          {/* Top-right star overlay (sibling to the <Link>, NOT a child, to
              keep <button>-inside-<a> illegal markup out of the DOM). */}
          {userId !== undefined && onToggleStar && (
            <div className="absolute top-2 right-2 z-10">
              <StarToggle
                strategyId={s.id}
                name={s.name}
                starred={watchedSet?.has(s.id) ?? false}
                onToggle={onToggleStar}
                size="card"
              />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
