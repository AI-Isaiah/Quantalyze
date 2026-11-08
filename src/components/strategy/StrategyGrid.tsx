"use client";

import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { VerifiedBadge } from "@/components/ui/VerifiedBadge";
import { Sparkline } from "@/components/charts/Sparkline";
import { sparklineColor } from "@/lib/sparkline-color";
import { SyncBadge } from "./SyncBadge";
import { SharedAccountNote } from "./SharedAccountNote";
import { StaleSeriesChip } from "./StaleSeriesChip";
import { TrustTierLabel } from "./TrustTierLabel";
import { HealthScore } from "./HealthScore";
import { StarToggle } from "./StarToggle";
import { SelectCheckbox } from "./SelectCheckbox";
import { formatPercent, formatCurrency, metricColor } from "@/lib/utils";
import { gateAnnualized, gatedValue } from "@/lib/figure-gate";
import { annualizedCell, rowRecord } from "./annualized-cell";
import { DISCOVERY_COLUMNS, type DiscoveryColumn } from "./discovery-columns";
import type { ListSeriesVerdictResult } from "@/lib/freshness";
import type { Strategy, StrategyAnalytics } from "@/lib/types";

// Phase 197 D-05 (U-07): the card footer's two labels read from the SAME map as the table header,
// so the two views of one list cannot name a column differently. "Return \u00b7 full record" and
// "CAGR \u00b7 full record \u00b7 ann." (the token only where the map says the figure is annualized).
function footerLabel(key: DiscoveryColumn["key"]): string {
  const col = DISCOVERY_COLUMNS.find((c) => c.key === key);
  if (!col) throw new Error(`discovery-columns has no entry for ${key}`);
  return [col.label, col.period, col.annualized ? "ann." : null].filter(Boolean).join(" \u00b7 ");
}
const RETURN_FOOTER_LABEL = footerLabel("cumulative_return");
const CAGR_FOOTER_LABEL = footerLabel("cagr");

type StrategyWithAnalytics = Strategy & {
  analytics: StrategyAnalytics;
  /**
   * Phase 170.6.1 / DISCOVERYPHONE (SC-2, D-04) — set by
   * `getStrategiesByCategory` only: the exchange(s) this strategy's trades come
   * from (its API key's venue, distinct and lowercase). OPTIONAL: a strategy
   * with no key (CSV or demo), a failed read and every fixture omit it, and the
   * card then keeps its listed exchange (D-05). LABEL and TOOLTIP only (D-07).
   */
  tradeVenues?: readonly string[];
  /** The venue read failed or was malformed: the badge shows no venue label (review WR-01). */
  tradeVenuesUnavailable?: boolean;
};

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
  /**
   * Phase 197 / CLAR-02 (D-03) — the table's per-row data-age verdicts, passed down rather than
   * recomputed so the card and the table row cannot disagree (the card order is already the
   * table's, since the grid renders the table's own sorted page). ABSENT renders nothing, which is
   * the owner mounts and every existing grid caller.
   */
  seriesVerdicts?: ReadonlyMap<string, ListSeriesVerdictResult>;
  /**
   * Phase 197 / ROUTE-05 (D-04) - the discovery Compare selection, in the grid view. When
   * `selectable`, each card carries the same checkbox as the table row, as an overlay SIBLING of the
   * card link (never inside the anchor), top-right and left of the star. `selectedIds` is the
   * table's selection, `selectionFull` says the cap is reached (unchecked boxes disable). ABSENT
   * renders the grid exactly as before.
   */
  selectable?: boolean;
  selectedIds?: readonly string[];
  onToggleSelected?: (strategyId: string) => void;
  selectionFull?: boolean;
  /**
   * Phase 197 / CLAR-05 (D-01, D-02) - the admin-only partner names, passed down from the table so
   * the card prints the same line as the row. ABSENT renders the grid exactly as before.
   */
  sharedAccountPartners?: Record<string, string[]>;
}

export function StrategyGrid({
  strategies,
  categorySlug,
  basePath = "/discovery",
  userId,
  watchedSet,
  onToggleStar,
  seriesVerdicts,
  selectable = false,
  selectedIds,
  onToggleSelected,
  selectionFull = false,
  sharedAccountPartners,
}: StrategyGridProps) {
  const showSelect = selectable && onToggleSelected !== undefined;
  if (strategies.length === 0) {
    return (
      <div className="text-center py-12 text-text-muted text-sm">
        No strategies match your filters.
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {strategies.map((s) => {
        // 194 review V-a: the same row record and verdict as the table's CAGR cell, so a
        // short record is a dash with its reason here too, and `<1y` marks a cleared
        // record under a year (D-15, D-69).
        const record = rowRecord(s);
        const gate = gateAnnualized(record);
        const cagrShown = gatedValue(s.analytics.cagr, gate);
        const seriesVerdict = seriesVerdicts?.get(s.id);
        return (
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
                  {/* Phase 170.6.1.1 (census G): the badge follows the public
                      trust signal, not api_key_id. Public rows no longer carry
                      the key id (anon cannot read it); VerifiedBadge renders
                      only for trust_tier api_verified. */}
                  <VerifiedBadge
                    trustTier={s.trust_tier}
                    className="shrink-0 mt-0.5"
                  />
                  {s.is_example && (
                    <span className="shrink-0 mt-0.5 inline-flex items-center rounded-md bg-badge-other/10 text-badge-other px-1.5 py-0.5 text-micro font-semibold uppercase tracking-wider">
                      Example
                    </span>
                  )}
                  {/* Reserve right-edge space so the absolute-positioned star
                      below never overlaps badges/title. The star is rendered
                      OUTSIDE the <Link> so its <button> is not nested in <a>. */}
                  {userId !== undefined && (
                    <span
                      className={`shrink-0 h-8 ${showSelect ? "w-20" : "w-8"}`}
                      aria-hidden="true"
                    />
                  )}
                </div>
                <div className="flex flex-wrap gap-1 mt-1.5 max-[375px]:flex-col max-[375px]:gap-0.5">
                  {s.strategy_types.map((t) => (
                    <Badge key={t} label={t} />
                  ))}
                  {/* Phase 197 / CLAR-02 (U-03): the same amber data-date chip as the table row,
                      under the badge row. The table's map holds a verdict for displayed rows only. */}
                  {seriesVerdict && (
                    <StaleSeriesChip
                      verdict={seriesVerdict.verdict}
                      seriesEnd={s.analytics.series_end}
                      ageDays={seriesVerdict.ageDays}
                      thresholdDays={seriesVerdict.thresholdDays}
                    />
                  )}
                </div>
              </div>

              {/* Phase 15 / CSV-03: trust-tier placeholder. csv_uploaded
                  renders muted text; api_verified / self_reported / null
                  render nothing — Phase 17 / DESIGN-01 fills those in. */}
              <TrustTierLabel
                trustTier={s.trust_tier}
                className="mb-1"
              />

              {/* Sync freshness.
                  Phase 162 / HONEST-03, UI-SPEC C-6 — suppressed on
                  `is_example` rows, matching StrategyTable's
                  `mayClaimSyncRecency` gate: the "Example" chip above already
                  carries a demo seed's identity, and nothing syncs it, so a
                  "Synced …" date beside it is a claim with no referent. Both
                  render paths are covered so the class cannot re-open through
                  whichever one a future page mounts. */}
              {!s.is_example && (
                <SyncBadge
                  computedAt={s.analytics.computed_at}
                  /* HONEST-08 — same rows, same projection, same duty as the
                     table: the card judges the staler of job- and
                     series-recency. Both render paths are covered so the class
                     cannot re-open through whichever one a future page
                     mounts. */
                  seriesEnd={s.analytics.series_end ?? null}
                  /* Phase 167.1.2.2.2 / SC-4, D-07 — the trade-fetch claim is
                     the cron's own record (`trades_fetched_at`), seen by every
                     viewer (D-06).
                     F3 — the venue that decides the STATE is the api-key
                     exchange or NULL, never `supported_exchanges`, and here it
                     is NULL. A recorded fetch time still reads current or
                     stale; only the never-fetched case becomes "no claim", the
                     cautious direction.
                     Phase 170.6.1 / D-05, D-07 — the card now also carries the
                     key's venue (`tradeVenues`, read through the published-only
                     function), which the badge uses for its LABEL and TOOLTIP
                     only. `tradeFetchVenue` stays NULL: feeding the state's
                     venue is TRADESYNC's decision. */
                  tradesFetchedAt={s.analytics.trades_fetched_at ?? null}
                  tradeFetchVenue={null}
                  exchange={s.supported_exchanges?.[0]}
                  tradeVenues={s.tradeVenues ?? null}
                  listedExchanges={s.supported_exchanges ?? null}
                  tradeVenuesUnavailable={s.tradeVenuesUnavailable ?? false}
                  className="mb-2"
                />
              )}
              {/* Phase 197 / CLAR-05: one line below SyncBadge, admin viewers only. */}
              <SharedAccountNote names={sharedAccountPartners?.[s.id] ?? []} className="mb-2" />

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
              <div className="flex items-center justify-between border-t border-border pt-2.5 min-h-[44px] max-[375px]:flex-col max-[375px]:items-start max-[375px]:justify-center max-[375px]:gap-1">
                <div className="text-xs">
                  <span className="text-text-muted">{RETURN_FOOTER_LABEL} </span>
                  <span className={`font-metric font-medium ${metricColor(s.analytics.cumulative_return, "percent")}`}>
                    {formatPercent(s.analytics.cumulative_return)}
                  </span>
                </div>
                <div className="text-xs">
                  <span className="text-text-muted">{CAGR_FOOTER_LABEL} </span>
                  <span className={`font-metric font-medium ${metricColor(cagrShown, "percent")}`}>
                    {annualizedCell(formatPercent(cagrShown), gate, record)}
                  </span>
                </div>
              </div>
            </Card>
          </Link>
          {/* Top-right star overlay (sibling to the <Link>, NOT a child, to
              keep <button>-inside-<a> illegal markup out of the DOM). */}
          {/* Phase 197 / ROUTE-05: the select checkbox, a sibling of the <Link> for the same reason,
              top-right and left of the star (the star is 32 wide at right-2, so right-10). */}
          {showSelect && (
            <div className="absolute top-0.5 right-10 z-10">
              <SelectCheckbox
                strategyId={s.id}
                name={s.name}
                checked={selectedIds?.includes(s.id) ?? false}
                atCap={selectionFull}
                onToggle={onToggleSelected}
              />
            </div>
          )}
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
        );
      })}
    </div>
  );
}
