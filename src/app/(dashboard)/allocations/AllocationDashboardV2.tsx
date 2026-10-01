"use client";

import { useMemo } from "react";
import type { MyAllocationDashboardPayload } from "@/lib/queries";
import { EmptyState } from "./EmptyState";
import { AlertBanner } from "./components/AlertBanner";
import { InsightStrip } from "@/components/portfolio/InsightStrip";
import EquityChartWidget from "./widgets/performance/EquityChart";
import { EquityHistoryRebuilding } from "./components/EquityHistoryRebuilding";
import { buildAllocatorPortfolioFactsheetPayload } from "@/lib/factsheet/allocator-portfolio-payload";
import {
  FactsheetProvider,
} from "@/app/factsheet/[id]/v2/factsheet-context";
import { FactsheetBody } from "@/app/factsheet/[id]/v2/FactsheetView";

/**
 * Overview = factsheet shell. Full-width blended equity curve mounted at
 * the top of the article (via the FactsheetBody `topSlot`), followed by
 * the full factsheet panel set: KpiStrip → SectionNav → ControlBar →
 * MasterBrush → Performance / Distribution / Heatmaps / Stress / Returns
 * Signatures / Streaks panels on the left, MetricsColumn on the right.
 *
 * The blended `equityDailyPoints` is the server's source of truth —
 * aggregated across every API-connected strategy in the allocator's
 * portfolio via `allocator_equity_snapshots` — so the factsheet payload
 * builder just reshapes it into a `FactsheetPayload` and the existing
 * factsheet v2 panel components render against it verbatim. The strategy
 * header is suppressed (the AllocationsTabs page header already names
 * the surface) and the demo AllocatorSection is suppressed (this IS the
 * allocator's view; demo portfolios are out of place here).
 *
 * Phase 167.1.2 / D-02 ("Hide it until correct"): all of the above is the
 * "ready" branch only. While `equityHistoryState !== "ready"` the Overview
 * renders `EquityHistoryRebuilding` in place of the curve AND the factsheet,
 * and builds no factsheet payload at all.
 */
export function AllocationDashboardV2(props: MyAllocationDashboardPayload) {
  const {
    portfolio,
    holdingsSummary = [],
    hasSyncing = false,
    analytics,
    flaggedHoldings = [],
    equityDailyPoints,
    activeVenues = [],
    // NEW-C09-04 (B14, audit-2026-05-07): the payload already carries the
    // sync-freshness signal — `allKeysStale` is true when every active
    // api_key's `last_sync_at` is older than 24h, and `lastSyncAt` is the
    // newest of them. The legacy `components/KpiStrip.tsx` consumes it via
    // an `allKeysStale` prop, but the V2 Overview routes through
    // FactsheetBody, which has no equivalent dim-the-cells path. Surface
    // the signal as a non-blocking banner above the InsightStrip so the
    // allocator gets the freshness cue (and a path to retry) instead of
    // looking at full-confidence numbers computed on stale data.
    allKeysStale = false,
    lastSyncAt = null,
    // CL9 / NEW-C01-11: true when the allocator's reconstructed equity history
    // was built against an unknown absolute baseline (OKX 90-day terminus
    // clamped the funding deposit out of the fetch window). The flagged rows
    // are already excluded server-side from equityDailyPoints / KPIs; this just
    // drives the explanatory banner so the missing absolute history doesn't
    // read as a broken connection.
    equityBaselineUnknown = false,
    // DOGFOOD-1 (Phase 110.1): the honest connected-keys signal derived
    // server-side via isPerKeyDailiesEligibleKey (is_active && !revoked &&
    // !disconnected). NOT `activeVenues.length > 0`, which counts
    // soft-disconnected / revoked keys as connected and wrongly showed the
    // "connected — no positions synced yet" copy to an allocator who
    // disconnected their only key.
    hasConnectedKeys = false,
    // Phase 167.1.2 / D-02 ("Hide it until correct"): while the history is
    // rebuilt the producer withholds the curve, and neither the curve nor any
    // factsheet KPI computed from it renders.
    equityHistoryState,
    // D-06: the factsheet's return series. Empty while rebuilding.
    equityDailyReturns = [],
    // Phase 169.4 plan 02 (SC3, D-69): the database BTC closes the Overview's
    // BTC comparator is built from. Absent reads as null (the fixture path).
    btcBenchmarkPrices = null,
    equityHistoryRebuildReason = null,
    // Review C2 round 2 IN-04: the keys a key_not_syncing reason is about.
    equityHistoryNotSyncingKeyIds = [],
    // Review C4 SFH-C4-04: the ready curve left out at least one departed
    // account's history (its anchor balance is gone). False when absent.
    departedHistoryUnavailable = false,
    apiKeys = [],
  } = props;
  // Fail-closed: ONLY an explicit "ready" may show the curve. A missing field,
  // null, "" or any state added later (a destructuring default fires on
  // `undefined` alone) all read as rebuilding.
  const isRebuilding = equityHistoryState !== "ready";
  // Phase 167.1.2 / D-15 (2026-09-27, supersedes IN-01): the rebuilding copy is
  // chosen by state alone. The brand-new-book exception that swapped the panel
  // for the warm-up note on a snapshot count is removed, because under
  // "rebuilding" no number of days flips the state, so the warm-up timer would
  // be false. The Scenario composer gates its disclosure on the same state.

  const holdingsEmpty = holdingsSummary.length === 0;

  // Review C2 round 2 IN-04: resolve the producer's ids to the owner's own key
  // rows so the key_not_syncing line can name the key. An id missing from the
  // list makes the set unknown (null), and the line falls back to its unnamed
  // form rather than naming a different key.
  const notSyncingKeys = (() => {
    if (equityHistoryNotSyncingKeyIds.length === 0) return null;
    const byId = new Map(apiKeys.map((k) => [k.id, k]));
    const keys = equityHistoryNotSyncingKeyIds.map((id) => byId.get(id));
    return keys.every((k) => k !== undefined) ? keys : null;
  })();

  const factsheetPayload = useMemo(
    () =>
      // D-02: no factsheet payload (so no KPI) is built while rebuilding.
      isRebuilding
        ? null
        : buildAllocatorPortfolioFactsheetPayload(equityDailyPoints, {
            allocatorId: props.allocator_id,
            portfolioName: portfolio?.name ?? "My Portfolio",
            computedAt: analytics?.computed_at ?? null,
            markets: activeVenues,
            startDate: equityDailyPoints[0]?.date ?? null,
            aum: analytics?.total_aum ?? null,
            dailyReturns: equityDailyReturns,
            btcBenchmarkPrices,
          }),
    [
      isRebuilding,
      equityDailyPoints,
      equityDailyReturns,
      btcBenchmarkPrices,
      props.allocator_id,
      portfolio,
      analytics,
      activeVenues,
    ],
  );

  if (holdingsEmpty && !hasSyncing) {
    return (
      <div data-ui-v2-shell="true">
        {/* CL9 / NEW-C01-11: holdingsSummary (allocator_holdings) and
            equityBaselineUnknown (allocator_equity_snapshots) are independent
            sources. A terminus-clamped allocator whose holdings poll hasn't
            landed yet (first-connect race) would otherwise see only the bare
            "connect an exchange" CTA — actively wrong, since they DO have a
            connected key with reconstructed (if baseline-unknown) history.
            Surface the banner here too so the gap reads as a data-horizon
            limit, not a missing connection. */}
        {equityBaselineUnknown && (
          <BaselineUnknownBanner historyRebuilding={isRebuilding} />
        )}
        {/* DOGFOOD-1 (Phase 110.1): `hasConnectedKeys` is derived server-side
            from the canonical isPerKeyDailiesEligibleKey predicate, NOT
            `activeVenues.length > 0`. The venue set counts is_active keys
            alone, so a soft-disconnected (disconnected_at != null) or
            credential-revoked (sync_status='revoked') key would wrongly read
            as "connected — no positions synced yet". Using the honest signal,
            an allocator who disconnected their only key sees the "Connect a
            key" CTA; one with a live key but no synced positions sees the
            connected-but-empty copy. */}
        <EmptyState
          hasSyncing={false}
          hasConnectedKeys={hasConnectedKeys}
        />
      </div>
    );
  }

  const equitySlot = (
    <section
      aria-label="Portfolio equity curve"
      className="mt-6"
      data-testid="overview-equity-curve"
    >
      <EquityChartWidget
        // B21: `data` is `unknown` on WidgetProps; EquityChartWidget validates
        // it through equityChartWidgetDataSchema, so the payload passes as-is
        // (the prior `as unknown as Record<string, unknown>` double-cast is gone).
        // H-0076: width/height omitted — the chart sizes via ResponsiveContainer.
        data={props}
        timeframe="1YTD"
      />
    </section>
  );

  return (
    <div data-ui-v2-shell="true" className="relative">
      {portfolio != null && <AlertBanner portfolioId={portfolio.id} />}
      {/* NEW-C09-04 (B14): freshness banner. Renders only when every active
          API key's last_sync_at is >24h old AND the dashboard is not actively
          syncing right now (hasSyncing suppresses to avoid double-messaging
          with the in-flight SyncProgress pill). Non-blocking: the dashboard
          renders the last-known-good numbers behind it; the banner just
          signals the staleness + offers the Connect Exchange path. */}
      {allKeysStale && !hasSyncing && (
        <StalenessBanner lastSyncAt={lastSyncAt} />
      )}
      {/* CL9 / NEW-C01-11: absolute equity/drawdown history before the live
          window can't be reconstructed (positions were funded before the
          venue's data horizon). Non-blocking — live holdings + AUM behind it
          remain accurate; the trustworthy curve rebuilds as daily snapshots
          accrue. */}
      {equityBaselineUnknown && (
        <BaselineUnknownBanner historyRebuilding={isRebuilding} />
      )}
      {/* Review C4 SFH-C4-04: the derive leaves such an account out under a
          benign flag and still marks the curve trustworthy, so without this
          line a ready book reads as the whole book. Ready only: nothing is
          drawn while the history is rebuilding. */}
      {departedHistoryUnavailable && !isRebuilding && <DepartedHistoryNote />}
      <InsightStrip
        analytics={analytics}
        portfolioId={portfolio?.id ?? null}
        flaggedCount={flaggedHoldings.length}
        className="mt-3 px-1"
      />

      {isRebuilding ? (
        // D-02: replaces BOTH the curve slot and the factsheet, and is checked
        // BEFORE the warm-up fallback, so a book whose history is withheld
        // never sees the "appear once" copy. D-15: every such book, a
        // brand-new one included, gets the panel and its named reason.
        <EquityHistoryRebuilding
          reason={equityHistoryRebuildReason}
          notSyncingKeys={notSyncingKeys}
        />
      ) : factsheetPayload ? (
        <FactsheetProvider payload={factsheetPayload}>
          <FactsheetBody
            payload={factsheetPayload}
            hideHeader
            hideAllocatorSection
            hideFooter
            topSlot={equitySlot}
          />
        </FactsheetProvider>
      ) : (
        <>
          {equitySlot}
          <FactsheetWarmupNote curveDays={equityDailyPoints.length} />
        </>
      )}
    </div>
  );
}

/**
 * The Overview's warm-up note, shown when there is too little history to build
 * factsheet panels from. It renders in ONE place, the "ready" branch, when the
 * factsheet builder refuses the book's returns. Phase 167.1.2 / D-15: it never
 * renders while the history is rebuilding, where no number of days changes the
 * state.
 *
 * Review C3 WR-01: the day count in the copy is derived, not chosen. The
 * builder needs two returns (`dailyReturns.length < 2` returns null in
 * `buildAllocatorPortfolioFactsheetPayload`, src/lib/factsheet/
 * allocator-portfolio-payload.ts; the threshold is an inline literal there,
 * not an export). The writer emits one return per curve day after the first
 * (`allocator_equity_compose.py::portfolio_returns`, `range(1, len(union))`),
 * and "ready" needs at least one return. So in practice the note shows beside
 * a two-day curve with one return, and the panels need three curve days.
 * Known limit: a day the writer skips (no weight, or a non-finite value) adds
 * no return, so the panels can need more than three days. "At least" stays
 * true then; the promise is a floor, never an early date.
 * `AllocationDashboardV2.warmup.test.tsx` measures the count against the real
 * builder, so a change to its threshold fails there.
 *
 * Review C3 IN-01: the count line counts the days of the curve drawn above
 * the note, in the same unit as the threshold. It used to count legacy
 * `allocator_equity_snapshots` rows, which since plan 11 have no relation to
 * the derived curve on screen.
 */
function FactsheetWarmupNote({ curveDays }: { curveDays: number }) {
  return (
    <div
      role="status"
      data-testid="overview-factsheet-warmup"
      className="mx-auto mt-8 max-w-[1100px] py-12 text-center"
    >
      <p className="text-fixed-10 font-mono uppercase tracking-[0.18em] text-text-muted">
        Portfolio factsheet
      </p>
      <p className="mt-3 text-sm text-text-secondary">
        Aggregated factsheet panels appear once at least three days of
        blended equity history are available. The data flows from
        the API keys you connect on the My Allocation page.
      </p>
      {curveDays > 0 && (
        <p className="mt-2 text-fixed-11 text-text-muted">
          {curveDays} {curveDays === 1 ? "day" : "days"} of blended equity
          history so far.
        </p>
      )}
    </div>
  );
}

/**
 * NEW-C09-04 (B14, audit-2026-05-07): non-blocking freshness banner.
 *
 * Renders above the InsightStrip when every active API key's `last_sync_at`
 * is older than 24h. The dashboard still renders the last-known-good
 * analytics behind it; this banner just makes the staleness observable so
 * the allocator doesn't read full-confidence numbers as fresh truth.
 *
 * Uses the warning design tokens already in DESIGN.md (`--color-warning-bg`,
 * `--color-warning-border`) — same shape as the dashboard-recovery banner
 * above so the surface stays visually coherent. Dismissal is intentionally
 * NOT supported: the staleness condition is data-driven (resolves only when
 * a key actually syncs successfully) so a one-shot dismiss would let the
 * user re-acquire the wrong mental model on the next page load.
 */
function StalenessBanner({ lastSyncAt }: { lastSyncAt: string | null }) {
  const ageCopy = formatRelativeAge(lastSyncAt);
  return (
    <div
      role="status"
      data-testid="dashboard-staleness-banner"
      className="mb-3 rounded-md border px-4 py-2 text-sm"
      style={{
        background: "var(--color-warning-bg)",
        borderColor: "var(--color-warning-border)",
        color: "var(--color-text-secondary)",
      }}
    >
      <span className="font-medium">Analytics may be stale.</span>{" "}
      <span>
        {ageCopy
          ? `Last successful sync was ${ageCopy}.`
          : "No successful sync recorded yet."}
        {" "}Use the API keys panel below to reconnect a key, or wait for
        the next scheduled sync.
      </span>
    </div>
  );
}

/**
 * CL9 / NEW-C01-11: non-blocking banner shown when the allocator's
 * reconstructed equity history was built against an unknown absolute baseline.
 *
 * On venues with a capped trade horizon (OKX's 90-day window), positions
 * funded before that horizon leave the reconstruction with no opening balance,
 * so the absolute equity level — and the drawdown / time-weighted return
 * derived from it — is unreliable for the clamped window. Those rows are
 * excluded server-side from every level-derived surface; this banner explains
 * why the absolute history is short so it doesn't read as a broken connection.
 *
 * Uses the same warning design tokens + role="status" shape as StalenessBanner
 * so the freshness/quality banners stay visually coherent. Not dismissible: the
 * condition is data-driven (resolves only as trustworthy daily-refresh rows
 * accrue), so a one-shot dismiss would let the user re-acquire the wrong mental
 * model on the next load.
 *
 * Phase 167.1.2 / D-02 (review round 1 SFH-05): while the equity history is
 * rebuilt the curve stays hidden however many snapshots accrue, so the banner
 * must not promise that "a full performance history builds up from here". The
 * rebuilding variant keeps the data-horizon explanation and drops the promise.
 */
function BaselineUnknownBanner({
  historyRebuilding,
}: {
  historyRebuilding: boolean;
}) {
  return (
    <div
      role="status"
      data-testid="dashboard-baseline-unknown-banner"
      className="mb-3 rounded-md border px-4 py-2 text-sm"
      style={{
        background: "var(--color-warning-bg)",
        borderColor: "var(--color-warning-border)",
        color: "var(--color-text-secondary)",
      }}
    >
      <span className="font-medium">Limited equity history.</span>{" "}
      <span>
        Some positions were funded before your exchange&apos;s available data
        window, so absolute equity and drawdown can&apos;t be reconstructed for
        that earlier period.{" "}
        {historyRebuilding
          ? "Your live holdings and AUM do not use that history."
          : "Your live holdings and current AUM are accurate, and a full performance history builds up from here as daily snapshots accrue."}
      </span>
    </div>
  );
}

/**
 * Review C4 SFH-C4-04. One line under the Overview's banners when the curve on
 * screen leaves out at least one disconnected account's history. The derive
 * leaves a departed key out when the history rule includes it but the balance
 * its history is measured from is gone (`departed_history_unavailable`); it
 * does not block the book, which would hold it untrustworthy forever. The
 * payload flag carries no count, so the line says "at least one". The key's
 * own card on the profile page's Exchanges tab names which account. Muted, not a warning:
 * the curve shown is correct for the accounts it covers.
 */
function DepartedHistoryNote() {
  return (
    <p
      role="status"
      data-testid="dashboard-departed-history-note"
      className="mb-3 px-1 text-sm text-text-secondary"
    >
      This curve leaves out the history of at least one disconnected account,
      because the balance that history is measured from is not available.
    </p>
  );
}

function formatRelativeAge(iso: string | null): string | null {
  if (!iso) return null;
  const ts = new Date(iso).getTime();
  if (!Number.isFinite(ts)) return null;
  const diffMs = Date.now() - ts;
  if (diffMs < 0) return "just now";
  const hours = Math.floor(diffMs / (60 * 60 * 1000));
  if (hours < 1) return "less than 1h ago";
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
