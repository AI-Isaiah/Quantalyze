"use client";

/**
 * Phase 09.1 D-06 + D-11 + D-18 / F4b — Holdings tab body.
 *
 * Two sections:
 *   1. **Strategies** — one row per onboarded portfolio strategy
 *      (`props.strategies` → `toStrategyRows` → `HoldingsTable strategyRows`).
 *      This is the primary surface: Strategy / Manager / Weight / Allocation /
 *      MTD / Sharpe / Max DD / Age, each row linking to the strategy factsheet.
 *      Strategy↔analytics data is real (server-projected); there is NO
 *      holding→strategy join, so raw exchange positions live in section 2.
 *   2. **Exchange Positions** — the allocator's raw synced positions, always
 *      shown with position-appropriate columns (no empty strategy columns):
 *        - a flagged-holding "Record outcome" surface
 *          (`ScenarioFlaggedHoldingsList`) when any holdings are flagged for a
 *          bridge/replacement — preserves the per-holding outcome CTA;
 *        - spot balances via the legacy `HoldingsTable` (holding columns +
 *          revoked-key handling);
 *        - open derivative positions via `OpenPositionsTable`.
 *
 * Spot vs derivative are partitioned because their `value_usd` semantics
 * differ (spot = marked equity value; derivative = notional exposure, with
 * `unrealized_pnl_usd` the equity contribution).
 */

import { useCallback, useMemo, useState } from "react";
import type {
  MyAllocationDashboardPayload,
  OwnCapitalStrategy,
} from "@/lib/queries";
import { buildHoldingRef } from "./lib/holding-outcome-adapter";
import {
  toStrategyRows,
  type StrategyRow,
} from "./lib/strategies-row-adapter";
import { HoldingsTable, type HoldingRow } from "./components/HoldingsTable";
import { AllocateDialog } from "./components/AllocateDialog";
import {
  OpenPositionsTable,
  type OpenPositionRow,
} from "./components/OpenPositionsTable";
import { ScenarioFlaggedHoldingsList } from "./ScenarioFlaggedHoldingsList";
// Phase 99 / 99-04 — DIRECT imports of the three exposure widgets. NOT routed
// through the B7b-locked widgets/index.ts WIDGET_COMPONENTS barrel (these are
// section-mounted, not part of the configurable dashboard grid).
import { ExposureByClass } from "./widgets/positions/ExposureByClass";
import { NetExposureChart } from "./widgets/positions/NetExposureChart";
import { AllocationOverTime } from "./widgets/allocation/AllocationOverTime";
import type { ExposureSectionData } from "./lib/exposure-props";
// Phase 100 / 100-04 (PI-04 + PI-05) — the two demo-hero sections mounted below
// the exposure trio, fed by the distinct `favorites` / `optimizer` / `note`
// props threaded from page.tsx (wave-1 exports from plans 100-01 / 100-02).
import { WatchlistPanel } from "./components/WatchlistPanel";
import { OptimizerPanel } from "./components/OptimizerPanel";
import { DashboardNoteCard } from "./components/DashboardNoteCard";
import type { FavoriteRow, OptimizerPrefetch } from "./lib/watchlist-read";
// Review C4 WR-01: the eligible-key rule (active, not revoked, not
// disconnected), from the pure module the Exchanges page already uses.
import { isLiveKey } from "@/lib/departed-history";

/** Honest-empty optimizer state when the prop is absent (test harnesses). */
/** A venue's display name. The exchange ids that need more than a capital. */
const VENUE_NAMES: Readonly<Record<string, string>> = {
  okx: "OKX",
  mt5: "MT5",
  sfox: "sFOX",
};

function venueName(exchange: string): string {
  const id = exchange.trim().toLowerCase();
  return VENUE_NAMES[id] ?? (id ? id.charAt(0).toUpperCase() + id.slice(1) : exchange);
}

/** "the Binance key Main", or "a Binance key" when the key is not in the list. */
function keyPhrase(
  apiKey: { exchange: string; label: string | null } | undefined,
  venue: string,
): string {
  if (apiKey === undefined) return `a ${venueName(venue)} key`;
  const label = (apiKey.label ?? "").trim();
  return label
    ? `the ${venueName(apiKey.exchange)} key ${label}`
    : `the ${venueName(apiKey.exchange)} key`;
}

/** The UTC day before `today` (`YYYY-MM-DD`), or "" when `today` is not a day. */
function dayBefore(today: string): string {
  const ms = Date.parse(`${today}T00:00:00Z`);
  if (Number.isNaN(ms)) return "";
  return new Date(ms - 86_400_000).toISOString().slice(0, 10);
}

/**
 * Review C4 SFH-C4-08, made absolute by round 2 SFH-R2-03. One sentence per
 * key whose open positions were read on a day older than either the newest
 * read in the book, or yesterday (UTC). D-16 keeps each key's own latest read
 * on purpose ("never flat"), so a key that stopped reading (it failed, or
 * disconnected) keeps showing its last read; this says how old it is.
 *
 * Comparing only to the newest read in the book never dated a one-key book, or
 * a book whose keys are all equally stale, so a single key failing for weeks
 * showed undated positions. `today` is the reference that closes that. The
 * tolerance is one day because the daily poll runs at 04:00 UTC: between
 * midnight and the poll, a healthy key's latest read is yesterday's. So a key
 * whose last read is yesterday is not dated; one that has missed a whole day's
 * poll is. Rows without a read day (legacy payloads) say nothing. The sentence
 * sits beside the Open Positions table and names the positions it dates, since
 * the table itself carries no date column.
 */
export function openPositionReadDayNotes(
  derivativeRows: ReadonlyArray<{
    api_key_id: string;
    symbol: string;
    venue: string;
    asof?: string;
  }>,
  allRows: ReadonlyArray<{ asof?: string }>,
  apiKeys: ReadonlyArray<{ id: string; exchange: string; label: string | null }>,
  today: string,
): string[] {
  let newest = "";
  for (const r of allRows) {
    if (typeof r.asof === "string" && r.asof > newest) newest = r.asof;
  }
  // SFH-R2-03: a row is dated when it is older than the newest read in the
  // book, or older than yesterday, whichever is later.
  const yesterday = dayBefore(today);
  const datedBefore = yesterday > newest ? yesterday : newest;
  if (datedBefore === "") return [];
  const byKey = new Map<string, { asof: string; venue: string; symbols: string[] }>();
  for (const r of derivativeRows) {
    if (typeof r.asof !== "string" || r.asof >= datedBefore) continue;
    const entry = byKey.get(r.api_key_id);
    if (entry) entry.symbols.push(r.symbol);
    else byKey.set(r.api_key_id, { asof: r.asof, venue: r.venue, symbols: [r.symbol] });
  }
  const keysById = new Map(apiKeys.map((k) => [k.id, k]));
  return Array.from(byKey.entries()).map(([keyId, { asof, venue, symbols }]) => {
    const phrase = keyPhrase(keysById.get(keyId), venue);
    return `Positions from ${phrase} are as last read on ${asof}: ${symbols.join(", ")}.`;
  });
}

/**
 * The venues whose holdings poll reads open positions through ccxt: every
 * supported venue outside `NON_CCXT_VENUES` (mt5, sfox; closed_sets.py). On
 * these a sync that finishes `complete_with_warnings` has exactly one cause:
 * the derivative-side read failed and only the spot rows were saved
 * (`fetch_allocator_holdings`, allocator_positions.py; a spot failure raises
 * instead). MT5 and sFOX warnings mean something else, so they are left out.
 */
const CCXT_POSITION_VENUES: ReadonlySet<string> = new Set([
  "binance",
  "okx",
  "bybit",
  "deribit",
]);

/**
 * Review C4 WR-01, bound to the rows by round 2 WR-R2-03. One sentence per key
 * whose rows on screen were written by a poll that could not read its open
 * positions (`partialPositionReads`, from `fetchLatestHoldingsPerKey`). That
 * poll saved the spot rows at a newer day, so under D-16 (each key's rows at
 * its own latest read) every open position of the key is missing from the
 * table. Chosen over holding the key's latest read back to an older complete
 * day: that would also show a stale spot book, and under repeated failures an
 * arbitrarily old one.
 *
 * The line follows the poll that wrote the rows, never the key's current
 * `sync_status`. A later poll that fails (a 429, a venue error) or is still
 * running writes no rows, so the partial rows stay and so does the line. It
 * clears only when a poll writes the key's rows again. A key that is no longer
 * connected is not polled, so its sentence does not promise a sync.
 */
export function partialPositionReadNotes(
  partialReads: ReadonlyArray<{ api_key_id: string; asof: string }>,
  apiKeys: ReadonlyArray<{
    id: string;
    exchange: string;
    label: string | null;
    is_active: boolean;
    sync_status: string | null;
    disconnected_at: string | null;
  }>,
  rows: ReadonlyArray<{ api_key_id: string; venue: string }>,
): string[] {
  const keysById = new Map(apiKeys.map((k) => [k.id, k]));
  const notes: string[] = [];
  for (const { api_key_id, asof } of partialReads) {
    const key = keysById.get(api_key_id);
    const venue = key?.exchange ?? rows.find((r) => r.api_key_id === api_key_id)?.venue;
    if (venue === undefined || !CCXT_POSITION_VENUES.has(venue.trim().toLowerCase())) continue;
    const lead = `Open positions from ${keyPhrase(key, venue)} could not be read on its sync of ${asof}.`;
    notes.push(
      key !== undefined && isLiveKey(key)
        ? `${lead} Any it holds are missing below until a sync reads them.`
        : `${lead} Any it held then are missing below.`,
    );
  }
  return notes;
}

const EMPTY_OPTIMIZER: OptimizerPrefetch = {
  portfolios: [],
  defaultPortfolioId: null,
  initialSuggestions: null,
  computedAt: null,
  computationStatus: null,
};

export function HoldingsTabPanel(
  // `favorites` / `optimizer` / `note` are ADDITIVE (100-04). Optional here so
  // the panel renders honest-empty in harnesses that don't supply them; page.tsx
  // always threads all three (SC-4).
  props: MyAllocationDashboardPayload & {
    exposure: ExposureSectionData;
    favorites?: FavoriteRow[];
    optimizer?: OptimizerPrefetch;
    note?: { initialContent: string; initialLastSavedAt: Date | null };
    /**
     * Phase 150 / OWN-03 — the viewer's own-capital-MARKED strategies
     * (`getOwnCapitalStrategies`, server-side in page.tsx). The second half of
     * the D-12-A union: a marked strategy with no position yet has no
     * `portfolio_strategies` row, so it cannot arrive on `props.strategies`.
     * Optional so harnesses render honest-empty.
     */
    ownCapitalStrategies?: OwnCapitalStrategy[];
    /**
     * D-15 empty-state arm-2/arm-3 discriminator — does the viewer have ANY
     * strategies at all? Sourced from `getMyStrategies` server-side and passed
     * as a NAMED signal; "zero own-capital rows" and "zero strategies" are
     * different facts and only the data layer knows the second one.
     */
    hasAnyStrategies?: boolean;
    /**
     * Review WR-02 — did EITHER of the two strategies reads fail? Both return
     * `null` (never `[]`) on a transient DB/RLS failure, and page.tsx consumes
     * that distinction here rather than collapsing it: on failure the row set
     * below is INCOMPLETE (marked rows missing, positioned rows reading as
     * unmarked), so the table must say so instead of making a claim about the
     * account. Defaults to false — a harness that supplies nothing is not
     * asserting a failure.
     */
    strategiesReadFailed?: boolean;
  },
) {
  const holdingsSummary = useMemo(() => props.holdingsSummary ?? [], [props.holdingsSummary]);
  const flaggedHoldings = props.flaggedHoldings ?? [];
  const matchDecisionsByHoldingRef = props.matchDecisionsByHoldingRef ?? {};
  const apiKeys = useMemo(() => props.apiKeys ?? [], [props.apiKeys]);
  const strategies = useMemo(() => props.strategies ?? [], [props.strategies]);
  const ownCapitalStrategies = useMemo(
    () => props.ownCapitalStrategies ?? [],
    [props.ownCapitalStrategies],
  );

  // Phase 100 / 100-04 — additive section inputs (honest-empty when absent).
  const favorites = useMemo(() => props.favorites ?? [], [props.favorites]);
  const optimizer = props.optimizer ?? EMPTY_OPTIMIZER;
  const note = props.note ?? { initialContent: "", initialLastSavedAt: null };
  // Real cross-link: the watchlist "Suggested" chip lights up ONLY for favorites
  // that are ALSO a current optimizer suggestion. [] when nothing is computed.
  const suggestedIds = useMemo(
    () => (optimizer.initialSuggestions ?? []).map((s) => s.strategy_id),
    [optimizer.initialSuggestions],
  );

  const [showRevoked, setShowRevoked] = useState(true);

  // ── Section 1: the D-12-A UNION row set — own-capital MARKED strategies ∪
  //    this book's POSITIONS, joined by strategy id. Both halves are named
  //    explicitly: the marked half is what the allocator clicks `Allocate…` on
  //    (it has no position yet), and the position half is why no allocated
  //    money vanishes from the surface when nobody has answered the capital
  //    question for it. No holding involvement (raw positions render in
  //    section 5 below).
  const strategyRows = useMemo(
    () =>
      toStrategyRows({
        strategies: ownCapitalStrategies,
        positions: strategies,
      }),
    [ownCapitalStrategies, strategies],
  );

  // ── The Allocate / Edit dialog host. Row identity is all it needs: `row.id`
  //    IS the strategy id, and NO portfolio id is sourced or threaded (rev-4 /
  //    D-03-B — the allocation route derives the caller's real book from the
  //    session and lazily provisions it, so `props.portfolio` being null is not
  //    a dead end and there is no remedy state to render).
  const [dialog, setDialog] = useState<{
    mode: "allocate" | "edit";
    strategyId: string;
    strategyName: string;
    currentAmount: number | null;
  } | null>(null);

  const handleAllocate = useCallback((row: StrategyRow) => {
    setDialog({
      mode: "allocate",
      strategyId: row.id,
      strategyName: row.strategy,
      currentAmount: null,
    });
  }, []);

  const handleEditAllocation = useCallback((row: StrategyRow) => {
    setDialog({
      mode: "edit",
      strategyId: row.id,
      strategyName: row.strategy,
      currentAmount: row.allocation,
    });
  }, []);

  const spotHoldings = useMemo(
    () => holdingsSummary.filter((h) => h.holding_type === "spot"),
    [holdingsSummary],
  );
  const derivativeHoldings = useMemo(
    () => holdingsSummary.filter((h) => h.holding_type === "derivative"),
    [holdingsSummary],
  );

  // ── Map api_key.id → sync_status. A key PRESENT with a null status maps to
  //    'unknown', which the tables read as trusted (the legitimate no-status
  //    case). A key MISSING from the list (it dropped the key, e.g. an
  //    unsupported exchange) is a different state: Phase 167.1 review round 2
  //    WR-05 flags it as `source_key_missing` below, because the composer
  //    names those holdings with `UNKNOWN_KEY_STATUS_SET_NOUN` and this tab is
  //    where the reader looks for them.
  const keyStatusById = useMemo(() => {
    const m = new Map<string, string>();
    for (const k of apiKeys) {
      m.set(k.id, k.sync_status ?? "unknown");
    }
    return m;
  }, [apiKeys]);

  // ── spot rows for the legacy holding-column table (Exchange Positions).
  //    source_key_sync_status drives the revoked-key chip.
  const spotHoldingRows = useMemo<HoldingRow[]>(
    () =>
      spotHoldings.map((h) => {
        const ref = buildHoldingRef({
          venue: h.venue,
          symbol: h.symbol,
          holding_type: h.holding_type,
        });
        const status = h.api_key_id
          ? keyStatusById.get(h.api_key_id) ?? "unknown"
          : "unknown";
        return {
          id: ref,
          venue: h.venue,
          symbol: h.symbol,
          holding_type: "spot",
          quantity: h.quantity,
          value_usd: h.value_usd,
          entry_price: h.entry_price ?? null,
          unrealized_pnl_usd: h.unrealized_pnl_usd ?? null,
          api_key_id: h.api_key_id,
          source_key_sync_status: status,
          source_key_missing: !keyStatusById.has(h.api_key_id),
        };
      }),
    [spotHoldings, keyStatusById],
  );

  const openPositionRows = useMemo<OpenPositionRow[]>(
    () =>
      derivativeHoldings.map((h) => {
        const ref = buildHoldingRef({
          venue: h.venue,
          symbol: h.symbol,
          holding_type: h.holding_type,
        });
        const status = h.api_key_id
          ? keyStatusById.get(h.api_key_id) ?? "unknown"
          : "unknown";
        return {
          id: ref,
          venue: h.venue,
          symbol: h.symbol,
          side: h.side ?? "flat",
          quantity: h.quantity,
          notional_usd: h.value_usd,
          entry_price: h.entry_price ?? null,
          mark_price: h.mark_price_usd,
          unrealized_pnl_usd: h.unrealized_pnl_usd ?? null,
          api_key_id: h.api_key_id,
          source_key_sync_status: status,
          source_key_missing: !keyStatusById.has(h.api_key_id),
        };
      }),
    [derivativeHoldings, keyStatusById],
  );

  // SFH-R2-03: the UTC day the tab was opened, the absolute reference the
  // read-day note dates rows against. UTC so it matches `asof`, which the poll
  // stamps in UTC.
  const [today] = useState(() => new Date().toISOString().slice(0, 10));
  const readDayNotes = useMemo(
    () => openPositionReadDayNotes(derivativeHoldings, holdingsSummary, apiKeys, today),
    [derivativeHoldings, holdingsSummary, apiKeys, today],
  );

  const partialPositionReads = useMemo(
    () => props.partialPositionReads ?? [],
    [props.partialPositionReads],
  );
  const partialReadNotes = useMemo(
    () => partialPositionReadNotes(partialPositionReads, apiKeys, holdingsSummary),
    [partialPositionReads, apiKeys, holdingsSummary],
  );

  const allocatorPreferences = props.mandate
    ? { max_weight: props.mandate.max_weight }
    : null;

  // Phase 170.2 (SC-1, UI-SPEC H-1, H-2): a bare `grid` has an implicit `auto`
  // track, which sizes to the widest table's MIN-CONTENT, so every ResponsiveTable
  // scroller below grows with its table and #main-content scrolls sideways
  // instead. `grid-cols-1` is `minmax(0, 1fr)`: the track can shrink, and each
  // table scrolls inside its own region. The root AND the three nested section
  // grids need it (RESEARCH measured that the root alone leaves the nested ones
  // blowing out). No overflow-x-hidden and no px max-w: they would hide the
  // table instead of containing it (UI-SPEC scroller rule 4).
  return (
    <div data-tab-panel="holdings" className="grid grid-cols-1 gap-8">
      {/* Section 1 — onboarded strategies (renders its own "Strategies" header). */}
      <HoldingsTable
        strategyRows={strategyRows}
        hasAnyStrategies={props.hasAnyStrategies ?? false}
        strategiesReadFailed={props.strategiesReadFailed ?? false}
        onAllocate={handleAllocate}
        onEditAllocation={handleEditAllocation}
      />
      {/* Keyed on the row + mode so reopening the dialog for a different row
          (or flipping allocate↔edit) remounts it with a fresh prefill rather
          than showing the previous row's amount. */}
      {dialog && (
        <AllocateDialog
          key={`${dialog.mode}:${dialog.strategyId}`}
          open
          onClose={() => setDialog(null)}
          mode={dialog.mode}
          strategyId={dialog.strategyId}
          strategyName={dialog.strategyName}
          currentAmount={dialog.currentAmount}
        />
      )}

      {/* Section 2 — Exposure (PI-01/02/03). Sits directly after Strategies per
          the 99-UI-SPEC placement (the 100-04 Watchlist/Notes sections now follow
          it, before Exchange Positions). Additive: fed by the distinct `exposure`
          prop; renders honest-empty when the trio is empty. */}
      <section aria-label="Exposure" className="grid grid-cols-1 gap-4">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-text-primary">
          Exposure
        </h3>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <ExposureByClass snapshot={props.exposure.snapshot} />
          <NetExposureChart {...props.exposure.netSeries} />
          <div className="lg:col-span-2">
            <AllocationOverTime {...props.exposure.allocationSeries} />
          </div>
        </div>
      </section>

      {/* Section 3 — Watchlist & Optimizer (PI-05). Mounts directly BELOW the
          exposure trio per the 100-UI-SPEC composition. Additive: fed by the
          distinct `favorites` / `optimizer` props; each panel renders honest-empty
          when its data is empty (zero fabricated rows). The two panels reflow on
          THIS section's own width (stacked <1024px) via a @container host on a
          SEPARATE ancestor from the @5xl:grid-cols-2 variant — the CompareTable
          idiom (DESIGN.md 2026-06-29). The parent grid's gap-8 gives the 32px
          section gap the UI-SPEC pins. */}
      <section aria-label="Watchlist & Optimizer" className="grid grid-cols-1 gap-4">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-text-primary">
          Watchlist &amp; Optimizer
        </h3>
        <div className="@container">
          <div className="grid grid-cols-1 gap-6 @5xl:grid-cols-2">
            <WatchlistPanel favorites={favorites} suggestedIds={suggestedIds} />
            <OptimizerPanel prefetch={optimizer} />
          </div>
        </div>
      </section>

      {/* Section 4 — Notes (PI-04), full-width. DashboardNoteCard owns its own
          "Notes" heading + autosave; the <section> is an aria landmark only (no
          duplicate section heading). */}
      <section aria-label="Notes">
        <DashboardNoteCard
          initialContent={note.initialContent}
          initialLastSavedAt={note.initialLastSavedAt}
        />
      </section>

      {/* Section 5 — raw exchange positions (always shown). */}
      <section className="grid grid-cols-1 gap-4">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-text-primary">
          Exchange Positions
        </h3>
        {flaggedHoldings.length > 0 ? (
          <ScenarioFlaggedHoldingsList
            flaggedHoldings={flaggedHoldings}
            matchDecisionsByHoldingRef={matchDecisionsByHoldingRef}
            // Matches the Scenario-tab wiring (ScenarioStub): existing outcomes
            // are not pre-loaded here; the banner's server-side eligibility
            // check gates double-recording.
            existingOutcomesByHoldingRef={{}}
            allocatorPreferences={allocatorPreferences}
          />
        ) : null}
        <HoldingsTable
          holdings={spotHoldingRows}
          showRevoked={showRevoked}
          onShowRevokedChange={setShowRevoked}
        />
        <OpenPositionsTable rows={openPositionRows} />
        {partialReadNotes.map((note) => (
          <p
            key={note}
            data-testid="open-positions-partial-read-note"
            className="text-xs text-text-muted"
          >
            {note}
          </p>
        ))}
        {readDayNotes.map((note) => (
          <p
            key={note}
            data-testid="open-positions-read-day-note"
            className="text-xs text-text-muted"
          >
            {note}
          </p>
        ))}
      </section>
    </div>
  );
}
