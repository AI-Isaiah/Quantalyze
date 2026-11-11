"use client";

import {
  Fragment,
  useState,
  useMemo,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  type CSSProperties,
  type ReactNode,
} from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Tooltip } from "@/components/ui/Tooltip";
import { Term } from "@/components/ui/Term";
import { NowrapWords } from "@/components/ui/NowrapWords";
import { ResponsiveTable } from "@/components/ResponsiveTable";
import { Sparkline } from "@/components/charts/Sparkline";
import { sparklineColor } from "@/lib/sparkline-color";
import {
  StrategyFilters,
  EMPTY_ADVANCED_FILTERS,
  type SortKey,
  type SortDir,
  type ViewMode,
  type AdvancedFilters,
  type RangeFilter,
} from "./StrategyFilters";
import { StrategyGrid } from "./StrategyGrid";
import {
  buildFactsheetHref,
  type FactsheetCategorySlug,
  type FactsheetOrigin,
} from "@/lib/factsheet/origin";
import { rowRecord, annualizedCell } from "./annualized-cell";
import { DISCOVERY_COLUMNS } from "./discovery-columns";
import { SyncBadge } from "./SyncBadge";
import { SharedAccountNote } from "./SharedAccountNote";
import { DATA_STATE_CHIP, PIPELINE_CHIPS, StaleSeriesChip, notRankedReason } from "./StaleSeriesChip";
import { StarToggle } from "./StarToggle";
import { SelectCheckbox } from "./SelectCheckbox";
import { COMPARE_MAX_ITEMS, compareHref } from "@/lib/compare-href";
import { WatchlistTabs } from "./WatchlistTabs";
import { EmptyWatchlist } from "./EmptyWatchlist";
import { CustomizeDrawer } from "./CustomizeDrawer";
import { SimulateImpactButton } from "@/components/discovery/SimulateImpactButton";
import { OwnershipTag } from "./OwnershipTag";
import { VerifiedCheck } from "./VerifiedCheck";
import { ReturnsUnitChip } from "./ReturnsUnitChip";
import { parseReturnsUnit } from "@/lib/factsheet/returns-unit";
import { signTone, drawdownTone } from "@/lib/factsheet/display-sign";
import { formatPercent, formatNumber, formatCurrency, formatDay } from "@/lib/utils";
import { isComputedAnalytics, deriveEmptySeriesState } from "@/lib/closed-sets";
import { rowChipStatus } from "@/lib/strategy-health";
import { listSeriesVerdict, type ListSeriesVerdictResult } from "@/lib/freshness";
import { gateAnnualized, gatedValue, notShownLine, recordStartDay, trackMonths } from "@/lib/figure-gate";
import { compareWithMissingLast, isMissingFigure, rangeMatches } from "@/lib/list-figures";
import {
  DEFAULTS,
  useDiscoveryPrefs,
  type DiscoveryViewPreferences,
} from "@/lib/discovery-prefs";
import type { Strategy, StrategyAnalytics } from "@/lib/types";
// Type-only import — erased at compile so no server-only code from queries.ts
// (createClient, etc.) leaks into this client bundle. The percentile VALUES are
// produced by getPercentiles() on the server and passed down via the
// `percentiles` prop; this component never recomputes them.
import type { PercentileMap } from "@/lib/queries";

type StrategyWithAnalytics = Strategy & {
  analytics: StrategyAnalytics & {
    /**
     * Phase 159 (159-03 / RANK-02) — the 3M advanced filter's ONE value,
     * projected as a JSONB-key ALIAS (`three_month:metrics_json->three_month`)
     * by `getStrategiesByCategory` so the whole `metrics_json` blob never
     * reaches an anonymous reader. OPTIONAL because the owner-scoped
     * `getMyStrategies` read keeps its wildcard embed (D-02 exemption) and so
     * carries `metrics_json` instead — the filter reads the alias FIRST and
     * falls back to the blob, which is what keeps both surfaces working.
     */
    three_month?: number | null;
  };
  /**
   * Phase 149 / NAV-01 — set by `shapeRankingRows` in lib/queries.ts. `false`
   * means NO `strategy_analytics` row exists for this strategy (the shaper
   * substituted `EMPTY_ANALYTICS`, whose `computation_status` is a hardcoded
   * "pending"). That is the ONLY signal distinguishing "the job was never
   * enqueued" from "a job is genuinely running" — see the chip derivation in
   * the row map below (checker defect B-1).
   *
   * OPTIONAL so public fixtures/pages predating the field still typecheck; an
   * OMITTED field means "no signal, trust the raw status" and is NOT the same
   * as `false` (W-C). The owner path can never omit it — plan 04 types the
   * section prop as `RankedStrategyRow[]`, where it is required.
   */
  analyticsPresent?: boolean;
  /**
   * Phase 170.6.1 / DISCOVERYPHONE (SC-2, D-04) — set by
   * `getStrategiesByCategory` only: the exchange(s) this strategy's trades come
   * from (its API key's venue, distinct and lowercase). OPTIONAL: a strategy
   * with no key (CSV or demo), a read that failed, and every other mount
   * (`getMyStrategies`, fixtures) omit it, and the row then keeps its listed
   * exchange (D-05). It changes the badge LABEL and TOOLTIP only (D-07).
   */
  tradeVenues?: readonly string[];
  /** The venue read failed or was malformed: the badge shows no venue label (review WR-01). */
  tradeVenuesUnavailable?: boolean;
};

// "created_at" (170.7 / D-09) is a TABLE sort key only: it is not a `SortKey`,
// so the filter bar's Sort menu (Discovery's) never lists it. "track" (Phase 197 D-05) is
// table-only for the same reason: it is never a `SortKey`, so it can never reach the saved prefs.
type TableSortKey = SortKey | "name" | "six_month_return" | "created_at" | "track";

type PercentileMetric = keyof PercentileMap[string];

// Factsheet KPI-label voice (mono, micro, uppercase, wide tracking) reused for
// every column header so the table header reads as a label, not another data
// row. Sortable headers layer the sort color on top of this.
const HEADER_LABEL = "text-micro font-mono uppercase tracking-[0.14em]";

// 2026-10-09 Phase 170.2 SC-6 (UI-SPEC P-1) / D-06: the pinned stack is rank, star,
// then Strategy, and each pinned cell's `left` offset must equal the combined width
// of the cells to its left, or the stack overlaps itself and the Strategy cell
// covers the first pixels of Return %. The rank and star cells keep their natural,
// unconstrained widths (a table cell never renders below its content, and the
// rendered widths differ by viewport), so forcing 56 px / 44 px would move every
// column to the right of them: the desktop table must not change (D-06). The
// offsets therefore follow the widths. The two header cells are measured at
// runtime (ResizeObserver, attached in a layout effect so the first paint is
// already right) and written to two custom properties on the table frame:
//   --pin-star-left     = rank width
//   --pin-strategy-left = rank width + star width (star column shown) or rank width
// The pinned cells read them behind `@3xl:`. The frame's inline values below are
// the previous fixed offsets: the server render and the pre-measure paint are
// exactly what shipped before, and an unmeasurable table (zero-width, e.g. not
// laid out) keeps them. No measured px literal lives in this file.
const PIN_RANK_FALLBACK = "3.5rem";
const PIN_STRATEGY_FALLBACK_WITH_STAR = "6.25rem";
// Phase 197 / ROUTE-05 (D-04): the select column, one touch target wide (the checkbox's label is
// h-11 w-11). Its cells carry no horizontal padding, so the column is exactly this wide.
const PIN_SELECT_FALLBACK = "2.75rem";

// Phase 197 / ROUTE-05: when the select column shows (`selectable`) it is the FIRST pinned cell, at
// left-0, and the stack shifts right by its measured width:
//   --pin-rank-left     = select width
//   --pin-star-left     = select width + rank width
//   --pin-strategy-left = select width + rank width + star width
// A table without it sets no `--pin-rank-left` and every other value is the one above, unchanged.
function usePinnedStackOffsets(showStarColumn: boolean, showSelectColumn: boolean) {
  const [frame, setFrame] = useState<HTMLDivElement | null>(null);
  const selectThRef = useRef<HTMLTableCellElement | null>(null);
  const rankThRef = useRef<HTMLTableCellElement | null>(null);
  const starThRef = useRef<HTMLTableCellElement | null>(null);

  useLayoutEffect(() => {
    const rankTh = rankThRef.current;
    if (!frame || !rankTh) return;
    const starTh = showStarColumn ? starThRef.current : null;
    const selectTh = showSelectColumn ? selectThRef.current : null;
    const apply = () => {
      const rank = rankTh.getBoundingClientRect().width;
      const star = starTh ? starTh.getBoundingClientRect().width : 0;
      const select = selectTh ? selectTh.getBoundingClientRect().width : 0;
      // Zero width = not laid out (jsdom, display:none): keep the fallbacks.
      if (rank <= 0 || (starTh && star <= 0) || (selectTh && select <= 0)) return;
      if (selectTh) frame.style.setProperty("--pin-rank-left", `${select}px`);
      frame.style.setProperty("--pin-star-left", `${select + rank}px`);
      frame.style.setProperty("--pin-strategy-left", `${select + rank + star}px`);
    };
    apply();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(apply);
    observer.observe(rankTh);
    if (starTh) observer.observe(starTh);
    if (selectTh) observer.observe(selectTh);
    return () => observer.disconnect();
  }, [frame, showStarColumn, showSelectColumn]);

  const strategyFallback = showStarColumn ? PIN_STRATEGY_FALLBACK_WITH_STAR : PIN_RANK_FALLBACK;
  const frameStyle = (
    showSelectColumn
      ? {
          "--pin-rank-left": PIN_SELECT_FALLBACK,
          "--pin-star-left": `calc(${PIN_SELECT_FALLBACK} + ${PIN_RANK_FALLBACK})`,
          "--pin-strategy-left": `calc(${PIN_SELECT_FALLBACK} + ${strategyFallback})`,
        }
      : {
          "--pin-star-left": PIN_RANK_FALLBACK,
          "--pin-strategy-left": strategyFallback,
        }
  ) as unknown as CSSProperties;
  return { setFrame, selectThRef, rankThRef, starThRef, frameStyle };
}

// Phase 197 plan 03 — `DATA_STATE_CHIP` (the Phase 149 Delta 4 chip base, with its comment) moved
// verbatim to StaleSeriesChip.tsx so the grid can render the same chip without importing this file.

// Phase 150 / OWN-03 — the ghost text-action treatment for the owner row
// actions, taken from RemoveStrategyButton.tsx:51-57 with `hover:text-negative`
// swapped for `hover:text-text-primary` (these actions are not destructive) and
// a keyboard focus ring added. Deliberately NOT the accent-underlined
// "Finish setup →" treatment further down this file: that is the placeholder
// row's primary CTA and is meant to be louder than these.
//
// 151 review A1 — the ring is the Phase-117 / UIFIX-02 CLIP-PROOF idiom
// verbatim (`outline-none` + `ring-2 ring-inset ring-accent` + a radius for the
// ring to follow), NOT the `ring-accent/20` this first shipped with. Two
// independent reasons, both load-bearing on THESE controls specifically:
//   1. WCAG 1.4.11 (≥3:1 non-text contrast). These are borderless,
//      underline-less text buttons, so the ring is the ENTIRE focus
//      affordance — a 20%-alpha accent measures ≈1.3:1 against the row and a
//      keyboard user sees nothing at all.
//   2. WCAG 2.4.7. The row lives inside the table's `overflow-x-auto` scroll
//      container, so an outset indicator is clipped at the scroll edge; an
//      INSET box-shadow ring paints inside the element bounds and survives.
// Pinned by StrategyTable.visibility.test.tsx so `/20` cannot come back.
const GHOST_ROW_ACTION =
  "text-caption font-medium text-text-muted hover:text-text-primary transition-colors rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent";

// Maps a sortable column to its getPercentiles() metric key. Columns absent
// from this map (Strategy name, 6 Month, AUM) have no peer-percentile and never
// render a suffix — honest absence rather than a fabricated rank.
const PERCENTILE_BY_SORT_KEY: Partial<Record<TableSortKey, PercentileMetric>> = {
  cumulative_return: "cumulative_return",
  cagr: "cagr",
  sharpe: "sharpe",
  max_drawdown: "max_drawdown",
  volatility: "volatility",
};

// --- Cell color policy (v1.11 audit finding 2: restrict color to sign) -------
// Sign-carrying cells (returns / PnL) get the positive/negative token ONLY for a
// finite signed value; a null/non-finite ("—") cell is never tinted, mirroring
// the factsheet honest-absence rule.
function signColor(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "text-text-muted";
  // Rounded 2 dp sign (D-03): a value `formatPercent` prints as 0.00% is neutral.
  const tone = signTone(value, 2, 100);
  return tone === "positive" ? "text-positive" : tone === "negative" ? "text-negative" : "text-text-primary";
}

// Magnitude cells (Sharpe, CAGR) render neutral ink: the sign, when it
// matters, already survives in the printed +/- prefix, so tinting the whole
// column adds color without adding signal (color is a verdict, not a coat of
// paint). A "—"/non-finite cell stays muted, never tinted.
function magnitudeColor(value: number | null | undefined): string {
  return value == null || !Number.isFinite(value)
    ? "text-text-muted"
    : "text-text-primary";
}

// Max DD is red ONLY when it is a finite negative value (a real drawdown);
// 0 / null / non-finite render neutral rather than a blanket red column.
function drawdownColor(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "text-text-muted";
  return drawdownTone(value, 2, 100) === "negative" ? "text-negative" : "text-text-primary";
}

// Phase 149 Delta 4 — the ONE chip-state status derivation, hoisted to module
// scope in STALE-01 because the SORT comparator now needs the identical
// reading and lives outside the row map. Inlining it a second time is exactly
// the drift this hoist prevents: the row that is denied a `#n` and the row that
// is denied its metric cells must be the SAME row, always.
//
// It closes TWO defects the naive shape carried (checker B-1/B-2):
//
// (a) the eventual gate is `isComputedAnalytics` ("this row has no computed
//     metrics"), NEVER `!computed_at`. A LIVE pending/computing row carries a
//     `computed_at` DEFAULT, so a `!computed_at` gate never fires for the very
//     state it was written to catch; and EMPTY_ANALYTICS's `computed_at: ""`
//     is falsy, so that gate ALSO made every absent row chip-eligible forever.
//
// (b) the status is COERCED through `analyticsPresent`, the absent-row signal
//     shapeRankingRows preserves. Reading `computation_status` raw would read
//     EMPTY_ANALYTICS's hardcoded "pending" and spin "Syncing" FOREVER for a
//     strategy whose job was never enqueued. Coercing to null routes it into
//     the shared 16h MISSING_ROW_COMPUTING_WINDOW_MS bound in closed-sets.ts,
//     which terminates the spinner at "No data" (the same coercion precedent
//     as returns/route.ts:310-341).
//
// `=== false`, never truthiness: an OMITTED optional field means "no signal —
// trust the raw status" (W-C); only the explicit absent-row `false` coerces.
// The owner path always carries it.
// Plan 199-07: the function itself now lives in `@/lib/strategy-health` (imported
// above), so the owner list's health word and this table read the one body.

// STALE-01 — may this row occupy a POSITION in the ranking, i.e. carry a `#n`?
//
// The ONE displayed-row decision. The row that SHOWS its figures, the row that
// carries a `#n`, the row that sorts by those figures, the row that may claim a
// sync recency and the row that is spared the owner's Syncing / No data chip are
// the same row, decided here once (the hoist's rule: a second inline copy is the
// drift). A row whose figures we may not show cannot be ordered by those figures
// either, otherwise the ordinal survives as a standalone claim ("this is the 3rd
// best strategy here") sourced from numbers the page just refused to print.
//
// Two ways in. A terminal-success row (`isComputedAnalytics`, the helper the
// percentile cohort gate also builds on, Phase 159 / RANK-01). And, since phase
// 190 (D-02), a row RE-COMPUTING over a stored success result: the server-side
// shaper (`shapeRowAnalytics`, lib/queries.ts) decided that with the factsheet's
// own evidence rule and flagged the shaped row `analytics_updating`; this reads
// that flag and never re-derives the evidence.
//
// DELIBERATE SPLIT (phase 190 OQ-2 default, no migration): STALE-01 used to
// keep "shown figures and #n" and "percentile cohort" in lockstep. During a
// re-run they part. The row shows its last computed figures and keeps its `#n`
// (a sort position over the figures it shows), but it takes no part in a
// percentile cohort until its run succeeds: `getPercentiles` and
// `getOwnRowPercentiles` stay on `isRankableAnalyticsRow` (terminal success
// only), so the row carries no percentile suffix.
function isDisplayedRow(s: StrategyWithAnalytics): boolean {
  return isComputedAnalytics(rowChipStatus(s)) || s.analytics.analytics_updating === true;
}

function isRankedRow(s: StrategyWithAnalytics): boolean {
  return isDisplayedRow(s);
}

// Every column is always rendered, at every container width (2026-10-13 Phase
// 170.6.1 D-01). On a phone the scroll region (ResponsiveTable) carries the
// extra width, so Volatility, 6 Month, AUM and the two sparkline columns are
// reached by horizontal scroll. The earlier priority collapse (the 50-UI-SPEC
// §Dense Reshape behavior 2 container-query hide plus a per-row disclosure that
// relocated the same values) is gone: the disclosure hid four columns from a
// phone user for no gain. Cells keep their single-source values and the honest
// em-dash for a null, never a fabricated zero (no-invented-data / STATE-02).
// Phase 197 D-05: derived from the shared label map (`discovery-columns.ts`), in map order, so
// the table header and the grid footer cannot name a column differently.
const COLUMNS: {
  key: TableSortKey;
  label: string;
  period?: string;
  annualized?: boolean;
  accessibleName: string;
  tooltip?: string;
  align?: "right";
}[] = DISCOVERY_COLUMNS.flatMap((col) => (col.sortable ? [col] : []));

// Phase 197 D-05: the qualifier line under a header label. Units (the period, then "ann." or
// "not ann.") are each whitespace-nowrap so the only break point is the " \u00b7 " separator,
// which is aria-hidden; a header is at most three lines. Null when the column names no period
// (Strategy). Annualisation shows only where the map defines it (never on Track, AUM or the curves).
function renderQualifier(col: {
  period?: string;
  annualized?: boolean;
  align?: "right";
}): ReactNode {
  const units: string[] = [];
  if (col.period) units.push(col.period);
  if (col.annualized !== undefined) units.push(col.annualized ? "ann." : "not ann.");
  if (units.length === 0) return null;
  return (
    <span className={`block text-text-muted ${col.align === "right" ? "text-right" : "text-left"}`}>
      {units.map((unit, u) => (
        <Fragment key={unit}>
          {u > 0 && <span aria-hidden="true"> {"\u00b7"} </span>}
          <span className="whitespace-nowrap">{unit}</span>
        </Fragment>
      ))}
    </span>
  );
}

// The two plain (not sortable) sparkline headers, read from the same map as the sortable ones.
const PLAIN_COLUMNS = DISCOVERY_COLUMNS.filter((col) => !col.sortable);

const PAGE_SIZE = 20;

// Slack, in CSS px, when deciding the scroll region still has content to its
// right. High-DPR phones report a fractional `scrollLeft`, so a region resting
// at its true end can read 1 px short of `scrollWidth - clientWidth`; 2 px
// absorbs that without hiding the cue while a real column's width remains.
const SCROLL_CUE_EPSILON_PX = 2;

/**
 * 170.6.2 WR-01 — set on <html> by a client effect once the table has
 * hydrated and read its prefs; the e2e specs wait on it. Never rendered.
 */
const PREFS_APPLIED_ATTR = "data-strategy-table-prefs-applied";

/**
 * Phase 149 Delta 5 — one row per ACTIVE api_key that has produced no strategy
 * yet. Server-formatted: `exchangeLabel` already has EXCHANGE_DISPLAY applied
 * upstream, so this client component never owns exchange naming.
 */
export type PlaceholderKeyRow = {
  id: string;
  exchangeLabel: string;
  keyLabel: string;
};

interface StrategyTableProps {
  strategies: StrategyWithAnalytics[];
  categorySlug: string;
  basePath?: string;
  /**
   * Phase 196 / ROUTE-04 (D-01): where a row's factsheet link leads back to. The MOUNT states
   * it (a prop), the table never derives it from the URL. When absent it defaults from
   * `basePath` and `categorySlug`: `/browse` is "browse", anything else "discovery", with
   * the category slug as `cat` (the builder drops a slug that is not a discovery category).
   */
  origin?: FactsheetOrigin;
  /**
   * Sprint 6 Task 6.4: the authenticated user's single real portfolio id.
   * When present, each row renders a "Simulate Impact" button that opens
   * the PortfolioImpactPanel. When null, the button is disabled with an
   * explanatory tooltip.
   */
  portfolioId?: string | null;
  /**
   * When present (signed-in allocator on /discovery), the table renders the
   * WatchlistTabs scope switch, a leading star column, and gates the
   * <EmptyWatchlist> state on `scope === "watchlist" && watchedSet.size === 0`.
   * Undefined on /browse — table renders unchanged.
   */
  userId?: string;
  initialWatchedSet?: Set<string>;
  /**
   * Category-scoped percentile ranks from getPercentiles() in lib/queries.ts,
   * keyed by strategy id then metric. When provided, the ACTIVE sort column
   * appends a quiet `Pnn` suffix (e.g. `P82`) per row. Undefined — or a missing
   * entry, or a peer set too small to rank (getPercentiles returns null under 5
   * strategies) — renders no suffix at all (honest absence, no fabricated rank).
   */
  percentiles?: PercentileMap;
  /**
   * Phase 149 / NAV-01 — which strategy statuses this mount is allowed to
   * render. The DEFAULT `"published-only"` reproduces byte-for-byte the
   * behavior /discovery/[slug] and /browse/[slug] have had since 2eef614a: an
   * in-component `status === "published"` filter ahead of every other predicate.
   *
   * `"owner-all-statuses"` is passed ONLY by the owner-scoped /my-strategies
   * surface, whose SERVER query already narrowed the set to
   * `user_id = <session id>`. This prop therefore WIDENS NOTHING — it stops the
   * component re-filtering an already-owner-scoped set, which is why the page
   * would otherwise render "No strategies match your filters." for every
   * private/draft row (RESEARCH Pitfall 1).
   *
   * Pinned by `src/__tests__/phase-149-my-strategies-parity.test.ts` (per D:
   * the in-component published filter must be PARAMETERIZED with the published
   * DEFAULT, so the discovery surfaces are provably unchanged) and behaviorally
   * by `StrategyTable.visibility.test.tsx`. Same literal-default idiom as
   * `basePath` above — a closed string union, never a function prop (a function
   * is non-serializable across the RSC→client boundary).
   */
  visibility?: "published-only" | "owner-all-statuses";
  /**
   * Phase 170.7 / D-01 — the manager mode of this SHARED table, keyed by
   * strategy id. Present (the manager's /strategies page, together with
   * `visibility="owner-all-statuses"`), it adds a Status column right after
   * Strategy and swaps the Actions cell for an Edit link plus this row's
   * `actions` slot; it drops the in-name status badge and the ownership tag
   * (Status has its own column now) and renders no Simulate Impact, Mark
   * ownership control (a manager's page has no allocator portfolio)
   * unless `allocatorFurniture` is also set (199, D-02).
   *
   * ABSENT means byte-identical output. /discovery, /browse and /my-strategies
   * never pass it, and `StrategyTable.default-mounts.test.tsx` pins all three
   * mounts to HTML captured before this prop existed. Every manager branch in
   * this file is gated on it.
   *
   * A DATA prop of server-built elements, deliberately not a function prop: a
   * function is non-serializable across the RSC to client boundary, a
   * `ReactNode` is not (Next: server components can be passed to a client
   * component as props). `editHref` is the Edit link's target; `actions` is
   * the private-link control and the row actions, rendered once, in the one
   * Actions cell; `note` is the full-width row under a strategy's row.
   */
  managerRows?: Record<
    string,
    {
      editHref?: string;
      actions?: ReactNode;
      note?: ReactNode;
      /**
       * Phase 199 / D-03 — the row's Health, decided on the SERVER by
       * `strategyHealthOf` (server clock, the row's own asset class) and
       * reduced to what the cell prints: `healthWord(h)` and `HEALTH_TONE[h.kind]`.
       * Strings only, so it serializes across the RSC boundary and the client
       * never recomputes a freshness verdict. Absent prints the em dash.
       */
      health?: { word: string; tone: string };
    }
  >;
  /**
   * Phase 199 / D-02 — the allocator half of the owner-list furniture. `managerRows` is the
   * owner-list switch (Status and Created columns, no in-name status badge, the note row,
   * `showExamples`); this prop re-enables the controls that need an allocator portfolio inside
   * that mode: the ownership tag, Mark ownership or Change mark and Simulate Impact.
   * Edit and the actions slot are decided per ROW by the server (an entry's `editHref` and
   * `actions`), so one row can carry manager furniture, allocator furniture or both.
   *
   * ABSENT (false) means the manager-only reading shipped in 170.7: none of the allocator
   * controls render, even when `onMarkOwnership` is passed. Without `managerRows`
   * it changes nothing (the plain owner mount already shows them).
   */
  allocatorFurniture?: boolean;
  /**
   * Phase 170.7 / D-09 — seeds the TABLE sort only (the column-header sort).
   * ABSENT means Sharpe descending, so Discovery, Browse and /my-strategies
   * are byte-identical. The manager page passes
   * `{ key: "created_at", dir: "desc" }`, so a strategy created a minute ago
   * is the top row.
   *
   * The filter bar's Sort menu keeps its own `sortKey`/`sortDir` seeds:
   * `created_at` is not a `SortKey`, and that menu is Discovery's. After any
   * header click the menu and the table can already disagree today; this mount
   * starts that way.
   *
   * A seed that must survive mount: see the prefs-mirror effect, which skips
   * its sort setters when this is set. Callers pass no `userId`, so there are
   * no persisted prefs to honour.
   */
  initialSort?: { key: TableSortKey; dir: SortDir };
  /**
   * Phase 149 Delta 5 / NAV-01 — the per-KEY coverage half of the owner
   * surface. The founder's PROD census is 8 active keys → 4 strategies → 2 keys
   * with nothing derived from them: without these rows /my-strategies would
   * silently under-report the account, and the owner would have no way to tell
   * "this key produced nothing" from "this key does not exist".
   *
   * Rendered as UNRANKED subordinate rows below every ranked row. They live
   * OUTSIDE `filtered`/`paged`/`rank`, so they never shift `#n`, never enter
   * the pagination counts, and are unaffected by search/filters (they are not
   * filter results — they are coverage rows).
   *
   * The PUBLIC pages (/discovery/[slug], /browse/[slug]) pass NEITHER this nor
   * `onFinishSetup`, so both branches below are dead there.
   */
  placeholderKeys?: PlaceholderKeyRow[];
  /**
   * Phase 149 Delta 5 — opens the contribution wizard overlay in the section
   * that hosts this table. A client→client function prop: RSC pages never pass
   * it (a function is non-serializable across the RSC boundary), which is
   * precisely why the wizard is NOT imported here — importing it would drag the
   * overlay into the shared public discovery bundle.
   *
   * Phase 162 / HONEST-06 — IT CARRIES THE CLICKED ROW'S KEY ID. The paragraph
   * that stood here said the wizard "opens FRESH" because the overlay had no
   * preselect seam (founder ruling 2026-08-05). D-162-3 supersedes that: an
   * owner who clicks a placeholder row is telling us WHICH stored key they mean,
   * and dropping that id on the floor is what sent them back into the wizard's
   * credential form and, for an already-stored key, onto the `KEY_ORPHANED`
   * refusal. The id is selection intent only — the server re-proves ownership on
   * the reuse arm of `create-with-key`.
   *
   * This component still knows nothing about the wizard: it hands the host the
   * id off the row it rendered and the host owns everything downstream.
   */
  onFinishSetup?: (keyId: string) => void;
  /**
   * Phase 150 / OWN-03 — opens the Mark-ownership dialog for a row (the retro
   * path, D-09/D-11). Client→client function props, minted in
   * MyStrategiesSection for the same reason `onFinishSetup` is: a function is
   * non-serializable across the RSC→client boundary, so an RSC page cannot pass
   * one. That is also what keeps them off the public surfaces — /discovery and
   * /browse are RSCs and pass NEITHER (pin 2's negative list).
   *
   * ABSENT ⇒ the row-action cluster renders zero nodes, so the public action
   * cell is byte-identical to today.
   */
  onMarkOwnership?: (s: StrategyWithAnalytics) => void;
  /**
   * Phase 197 / CLAR-02 (D-03, RESEARCH Pitfall 6) — the server's clock, in epoch milliseconds, that
   * the stale-data verdict is judged against. The verdict changes row ORDER and row TEXT, so the
   * server render and the hydration must judge the same instant: a page that passes
   * `nowMs={Date.now()}` has it serialised once and the table seeds `mountedAtMs` from it.
   *
   * OPTIONAL. A mount that omits it (today /browse/[slug], whose page file is shared with Phase 196
   * and is not edited here) judges by the table's own once-per-mount instant, exactly as before, and
   * so still flags and orders stale rows. The residual that leaves is a whole-UTC-day one: server
   * render and hydration can disagree only across a UTC midnight, and only for a row exactly at its
   * 7 or 10 day threshold (booked as T-197-18). Pass it on that mount once 196 has landed.
   */
  nowMs?: number;
  /**
   * Phase 197 / ROUTE-05 (D-04) - turns on row selection: a leading checkbox column, the sticky
   * "Compare (n)" bar from two selected (at most four) and the grid card checkbox. Passed ONLY by
   * `/discovery/[slug]`, whose layout gates it to the allocator role: Compare requires that role
   * (UI-SPEC A-5), so `/browse/[slug]` (anonymous), `/my-strategies` and the manager `/strategies`
   * never pass it and render no checkbox, no bar and no status region.
   *
   * ABSENT means byte-identical output: the rank, star and Strategy class strings, the frame style
   * and every colspan are exactly what shipped before, and `StrategyTable.default-mounts.test.tsx`
   * pins the three default mounts to HTML captured before this prop existed. Every selection branch
   * in this file is gated on it, the way the manager branches are gated on `managerRows`.
   *
   * The selection is table state keyed by strategy id in tick order. It is never written to the URL
   * or to storage (U-13): leaving the page forgets it, and the only thing that leaves the table is
   * the Compare link's `ids`.
   */
  selectable?: boolean;
  /**
   * Phase 197 / CLAR-05 (D-01, D-02) - ADMIN-ONLY data: for each strategy id, the names of the OTHER
   * published strategies that draw on the same exchange account. The discovery page passes it only
   * when `getSharedAccountPartners` returned a map, and that reader returns null for every non-admin
   * and every failure, so for any other viewer the prop is absent from the RSC payload itself, not
   * merely hidden. ABSENT means byte-identical output on every mount. Never pass an empty object to
   * a non-admin, and never put an account identifier, key id or label in it: names only.
   */
  sharedAccountPartners?: Record<string, string[]>;
}

// --- Range filter and sort: the D-09 missing-figure contract ---
//
// Phase 194 plan 06 (D-09). The range filter is `rangeMatches` and the sort is
// `compareWithMissingLast` (lib/list-figures.ts): a missing figure (null, non-finite,
// or an annualised figure the gate withholds) never matches an active range and sorts
// after every finite value in both directions. This file substitutes no number for a
// missing figure.

/** The annualised keys the D-15 gate withholds, as the list reads them. */
type GatedKey = "cagr" | "sharpe" | "volatility" | "calmar";

/** A stored annualised figure as the list may use it: null when the row's record withholds it. */
function gatedMetric(s: StrategyWithAnalytics, key: GatedKey): number | null {
  return gatedValue(s.analytics[key], gateAnnualized(rowRecord(s)));
}

// --- Sort value getter ---

function getSortValue(s: StrategyWithAnalytics, key: TableSortKey): number | string | null {
  switch (key) {
    case "name":
      return s.name;
    case "aum":
      return s.aum ?? null;
    case "computed_at":
      return s.analytics.computed_at ?? "";
    case "six_month_return":
      return s.analytics.six_month_return ?? null;
    case "track":
      // Phase 197 D-05: the covered-day span the 194 gate reads (D-20), never an observation
      // count. Null (unknown) sorts last in both directions through compareWithMissingLast.
      // An unreadable record (present but malformed date) is unknown too: the gate refuses to
      // read its length, so the sort must not order by the generous full-series span (197 WR-01).
      return rowRecord(s).unreadable ? null : rowRecord(s).spanDays;
    case "created_at":
      // ISO timestamps compare chronologically as strings. A missing date
      // sorts as "" (oldest), never as an invented date.
      return s.created_at ?? "";
    case "cagr":
    case "sharpe":
    case "volatility":
      return gatedMetric(s, key);
    default:
      return (s.analytics[key as keyof StrategyAnalytics] as number | null | undefined) ?? null;
  }
}

export function StrategyTable({
  strategies,
  categorySlug,
  basePath = "/discovery",
  origin,
  portfolioId = null,
  userId,
  initialWatchedSet,
  percentiles,
  visibility = "published-only",
  managerRows,
  allocatorFurniture = false,
  initialSort,
  placeholderKeys,
  onFinishSetup,
  onMarkOwnership,
  nowMs,
  selectable = false,
  sharedAccountPartners,
}: StrategyTableProps) {
  // The cast is safe by construction: `buildFactsheetHref` re-validates `cat` against
  // DISCOVERY_CATEGORIES and drops anything else (a mount on a non-category slug).
  const linkOrigin: FactsheetOrigin = origin ?? {
    key: basePath === "/browse" ? "browse" : "discovery",
    cat: categorySlug as FactsheetCategorySlug,
  };
  const reactId = useId();
  const tabIdBase = `watchlist${reactId}`;
  const panelId = `strategy-list${reactId}`;
  const [search, setSearch] = useState("");
  // 170.6.2 / D-06 — start where the prefs-mirror effect lands for an anonymous
  // mount, so SSR and the first paint carry no example row. `managerRows` keeps
  // true (170.7 SFH-1).
  const [showExamples, setShowExamples] = useState(
    () => !!managerRows || !DEFAULTS.hide_examples,
  );
  const [sortKey, setSortKey] = useState<SortKey>("sharpe");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [viewMode, setViewMode] = useState<ViewMode>("table");
  const [advancedFilters, setAdvancedFilters] = useState<AdvancedFilters>(EMPTY_ADVANCED_FILTERS);
  const [page, setPage] = useState(0);

  // Phase 149 / NAV-01 — the SINGLE enforcement point for "grid view is
  // unreachable on the owner surface". A grid card USED TO link to
  // `${basePath}/${categorySlug}/${id}`, which resolved
  // through getStrategyDetail → withPublishedOnly (queries.ts:530) →
  // notFound() for an own unpublished row — a 404 dead end AND an existence
  // oracle (RESEARCH Pitfall 3). Founder ruling 2026-08-05: keep grid
  // DISCOVERY-ONLY and hide the toggle here rather than adding a `rowLinkMode`
  // passthrough. Deriving (instead of clamping `viewMode` itself) is deliberate:
  // the prefs-hydration effect below still writes `setViewMode(prefs.view)`, so
  // a stale persisted `view:"grid"` would otherwise resurrect the dead end.
  // Public surfaces keep both view modes — this collapses to `viewMode` there.
  const effectiveViewMode = visibility === "owner-all-statuses" ? "table" : viewMode;

  // Visible scroll-cue gate. The cue (and the ResponsiveTable aria announcement
  // it pairs with) is only meaningful while the table has MORE to scroll to the
  // right (2026-10-13 Phase 170.6.1 D-02): once the region is scrolled to its
  // end the fade and hint go, so they never sit over the last column. Measured
  // from the scroll container on mount, resize, scroll, and whenever the
  // rendered column set changes (paging).
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const [hasMoreToScroll, setHasMoreToScroll] = useState(false);

  // 2026-10-09 Phase 170.2 SC-6: pinned-stack offsets that follow the measured
  // rank and star header widths (see usePinnedStackOffsets).
  const { setFrame, selectThRef, rankThRef, starThRef, frameStyle } =
    usePinnedStackOffsets(userId !== undefined, selectable);
  // The rank cells pin at left-0 unless the select column is first, then after it. Each rank cell
  // below writes both class strings out in full: the default string stays a literal in the source
  // (the pin in StrategyTable.test.tsx reads it there) and Tailwind sees both.

  // Column header sort (uses a superset of SortKey)
  const [tableSortKey, setTableSortKey] = useState<TableSortKey>(
    initialSort?.key ?? "sharpe",
  );
  const [tableSortDir, setTableSortDir] = useState<SortDir>(
    initialSort?.dir ?? "desc",
  );

  // Capture wall-clock time at mount for the track-record filter (stable across renders)
  // Phase 197 D-03: seeded from the page's server instant when it passes one (`nowMs`), else the
  // client clock, as it always was.
  const [mountedAtMs] = useState(() => nowMs ?? Date.now());

  // Phase 197 / CLAR-02 (D-03) — ONE verdict per row per mount, read by the sort, the `#n` ordinals,
  // the percentile suffix and the chip, so none of them can disagree about whether a row is current
  // (the STALE-01 "one hoisted predicate" rule). The field is the newest stored return day
  // (`series_end`); `computed_at` and `trades_fetched_at` are never read. Judged on the PUBLISHED-ONLY
  // mounts (/discovery, /browse) and null elsewhere: the owner mounts keep today's ranking (U-04).
  const seriesVerdicts = useMemo(() => {
    if (visibility !== "published-only") return null;
    const verdicts = new Map<string, ListSeriesVerdictResult>();
    for (const s of strategies) {
      // Displayed rows only: an undisplayed row has no figures, no series to date and no `#n`, and
      // the grid reads this map as "which cards carry a chip", so it must not hold a verdict for a
      // row that shows nothing. The comparator only asks about rows that are BOTH ranked.
      if (isDisplayedRow(s)) {
        verdicts.set(s.id, listSeriesVerdict(s.analytics.series_end, s.asset_class, mountedAtMs));
      }
    }
    return verdicts;
  }, [strategies, visibility, mountedAtMs]);
  // The one predicate for "current": true when the verdict is off (owner mounts) so every row there
  // stays rankable exactly as before.
  const isCurrentRow = useCallback(
    (s: StrategyWithAnalytics) =>
      seriesVerdicts === null || seriesVerdicts.get(s.id)?.verdict === "current",
    [seriesVerdicts],
  );

  // Watchlist scope + watched-set. Hydrated from the SSR initialWatchedSet
  // so the leading star column reflects persisted state without a flash.
  // onToggleStar applies an optimistic flip; StarToggle reverts via the
  // same callback on a server failure, keeping this state in lock-step.
  const [scope, setScope] = useState<"all" | "watchlist">("all");
  const [watchedSet, setWatchedSet] = useState<Set<string>>(
    () => initialWatchedSet ?? new Set<string>(),
  );

  const onToggleStar = useCallback((strategyId: string, nextStarred: boolean) => {
    setWatchedSet((prev) => {
      const next = new Set(prev);
      if (nextStarred) next.add(strategyId);
      else next.delete(strategyId);
      return next;
    });
  }, []);

  // Phase 197 / ROUTE-05 (D-04, U-13) - the selection, strategy ids in tick order. Table state only:
  // never the URL, never storage. The cap is enforced HERE as well as by the disabled boxes, so a
  // fifth id cannot enter the selection (and so the Compare link) by any path.
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const toggleSelected = useCallback((strategyId: string) => {
    setSelectedIds((prev) => {
      if (prev.includes(strategyId)) return prev.filter((id) => id !== strategyId);
      if (prev.length >= COMPARE_MAX_ITEMS) return prev;
      return [...prev, strategyId];
    });
  }, []);

  // Focus after a selection change that unmounts the control that held it (Clear, a chip x, the bar
  // itself). The handler records HOW to find the target; the effect runs it once the new DOM is
  // committed. Targets are found by `data-select-for` / `data-chip-remove-for`, which are rendered
  // only when `selectable`, inside the list panel.
  const listRef = useRef<HTMLDivElement | null>(null);
  const pendingFocus = useRef<(() => HTMLElement | null) | null>(null);
  const selectBoxes = () =>
    Array.from(listRef.current?.querySelectorAll<HTMLElement>("[data-select-for]") ?? []);
  const checkboxFor = (strategyId: string) =>
    selectBoxes().find((el) => el.dataset.selectFor === strategyId) ?? null;
  const chipRemoveFor = (strategyId: string) =>
    Array.from(listRef.current?.querySelectorAll<HTMLElement>("[data-chip-remove-for]") ?? []).find(
      (el) => el.dataset.chipRemoveFor === strategyId,
    ) ?? null;
  useEffect(() => {
    const resolve = pendingFocus.current;
    if (!resolve) return;
    pendingFocus.current = null;
    resolve()?.focus();
  }, [selectedIds]);

  // Clear: the bar unmounts, so focus goes to the first visible row's checkbox.
  const clearSelection = () => {
    pendingFocus.current = () => selectBoxes()[0] ?? null;
    setSelectedIds([]);
  };
  // A chip x: focus the next chip's x, else the previous one. When fewer than two remain the bar
  // unmounts, and focus goes to that strategy's checkbox when its row is visible (a filter or the
  // page can hide it), else to the first visible checkbox.
  const removeFromSelection = (strategyId: string) => {
    const at = selectedIds.indexOf(strategyId);
    const remaining = selectedIds.filter((id) => id !== strategyId);
    if (remaining.length >= 2) {
      const target = remaining[at] ?? remaining[at - 1];
      pendingFocus.current = () => chipRemoveFor(target);
    } else {
      pendingFocus.current = () => checkboxFor(strategyId) ?? selectBoxes()[0] ?? null;
    }
    setSelectedIds(remaining);
  };
  const selectedAtCap = selectedIds.length >= COMPARE_MAX_ITEMS;
  // A chip names its strategy from the PROP, so a selected strategy a filter or the scope hides
  // still has its name in the bar.
  const strategyNameById = useMemo(
    () => new Map(strategies.map((st) => [st.id, st.name])),
    [strategies],
  );

  // useDiscoveryPrefs(undefined, slug) is a safe no-op on the persistence
  // path — /browse callers (no userId) never write to localStorage.
  const { prefs, setPrefs, hydrated: prefsHydrated } = useDiscoveryPrefs(
    userId,
    categorySlug,
  );
  const [customizeOpen, setCustomizeOpen] = useState(false);
  const [draftPrefs, setDraftPrefs] = useState<DiscoveryViewPreferences>(prefs);

  // Mirror prefs into legacy state slots once on hydration. Gating on
  // `prefsHydrated` only (not `prefs`) prevents a post-Save re-render from
  // clobbering user-driven column-sort or view-toggle changes that haven't
  // been persisted yet.
  //
  // F9 M-0475/M-0476 — "once on hydration" is per-MOUNT, not per-session. On a
  // client-side category navigation (/discovery/crypto-sma → /discovery/equity-sma)
  // useDiscoveryPrefs returns the new slug's prefs, but `prefsHydrated` stays
  // true across the key flip, so this effect would NOT re-fire and the legacy
  // view/sort/showExamples state would stay pinned to the previous category.
  // The fix lives at the call sites: both /discovery/[slug] and /browse/[slug]
  // now pass `key={(user,)slug}` so a scope change REMOUNTS this component and
  // this effect re-runs cleanly for the new scope. Do not relax that key
  // without re-introducing a slug-aware re-mirror here.
  useEffect(() => {
    if (!prefsHydrated) return;
    setViewMode(prefs.view);
    // 2026-10-10 (170.7 / D-09) — an `initialSort` mount keeps its seeded sort.
    // A userId-less table hydrates IMMEDIATELY (`useDiscoveryPrefs` runs
    // `useCrossTabStorage` with `enabled: false`, whose `isHydrated` starts
    // true), so this effect fires on the first mount and would write the
    // DEFAULTS (Sharpe descending) over the seed one render later: the
    // manager's newest-first order would flash and then vanish, and a strategy
    // with no analytics would sink to the bottom. `initialSort` callers pass
    // no `userId`, so there are no persisted prefs to honour. View mode and
    // hide-examples mirroring are unchanged.
    if (!initialSort) {
      setSortKey(prefs.sort.key);
      setSortDir(prefs.sort.dir);
      setTableSortKey(prefs.sort.key);
      setTableSortDir(prefs.sort.dir);
    }
    // 2026-10-11 (170.7 / SFH-1) — a `managerRows` mount keeps `showExamples`
    // true. `hide_examples` defaults to true for an allocator who should not
    // land on example strategies, but on the manager's own list every row is
    // the owner's, so the default would silently drop their own `is_example`
    // strategies from /strategies with no count shown. The checkbox still
    // works; only the Discovery preference is not applied here.
    if (!managerRows) {
      setShowExamples(!prefs.hide_examples);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefsHydrated]);

  // 170.6.2 WR-01 — the client-only hydration signal for the e2e specs. Since
  // D-06 the server HTML already renders "Hide examples" checked, so
  // `toBeChecked()` no longer proves React hydrated, and a keypress sent
  // before hydration is lost. An effect runs only after this component has
  // hydrated and its prefs have been read, so it is the one honest "ready"
  // mark. It lives on <html>, never inside the table: the default-mounts byte
  // pin compares `container.innerHTML` after effects, and the server HTML must
  // not carry it either. Declared after the prefs-mirror effect so the mirror
  // has already run in the same commit. Pinned by
  // StrategyTable.prefs-applied.test.tsx.
  useEffect(() => {
    if (!prefsHydrated) return;
    const root = document.documentElement;
    root.setAttribute(PREFS_APPLIED_ATTR, "true");
    return () => root.removeAttribute(PREFS_APPLIED_ATTR);
  }, [prefsHydrated]);

  const handleOpenCustomize = useCallback(() => {
    setDraftPrefs(prefs);
    setCustomizeOpen(true);
  }, [prefs]);

  const handleSavePrefs = useCallback(() => {
    setPrefs(draftPrefs);
    // Apply the saved prefs to the legacy state slots immediately so the
    // visible view reflects the change without a refresh. Without this the
    // hydration effect — gated on `prefsHydrated` only — leaves the table
    // showing the previous view/sort/hide-examples until reload.
    setViewMode(draftPrefs.view);
    setSortKey(draftPrefs.sort.key);
    setSortDir(draftPrefs.sort.dir);
    setTableSortKey(draftPrefs.sort.key);
    setTableSortDir(draftPrefs.sort.dir);
    setShowExamples(!draftPrefs.hide_examples);
    setPage(0);
    setCustomizeOpen(false);
  }, [draftPrefs, setPrefs]);

  const handleCloseCustomize = useCallback(() => {
    setCustomizeOpen(false);
  }, []);

  function handleColumnSort(key: TableSortKey) {
    if (tableSortKey === key) {
      setTableSortDir(tableSortDir === "asc" ? "desc" : "asc");
    } else {
      setTableSortKey(key);
      setTableSortDir("desc");
    }
    setPage(0);
  }

  // Phase 197 D-05: a sortable metric header is two lines inside the sort button, a label line
  // (sort glyph after it) and, when the column names a period, a qualifier line. Each qualifier
  // unit is whitespace-nowrap, so the only place it can break is the " \u00b7 " separator and a
  // header is at most three lines. `aria-label` carries the UI-SPEC accessible name explicitly
  // (inline sr-only fragments compute differently in jsdom and browsers); the visible label text
  // is contained in it (WCAG 2.5.3). The Tooltip wraps the button, so hover or keyboard focus of
  // the sort control shows the definition; on touch, tapping still sorts.
  function renderSortHeader(col: (typeof COLUMNS)[number], sortedHere: boolean) {
    const right = col.align === "right";
    const qualifier = renderQualifier(col);
    const button = (
      <button
        type="button"
        onClick={() => handleColumnSort(col.key)}
        aria-label={col.accessibleName}
        className={`-mx-1 inline-flex ${qualifier ? `flex-col ${right ? "items-end" : "items-start"}` : "items-center gap-1"} rounded px-1 transition-colors select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${HEADER_LABEL} ${sortedHere ? "text-text-primary" : "text-text-muted hover:text-text-primary"}`}
      >
        <span className="inline-flex items-center gap-1">
          {col.label}
          {sortedHere && (
            <span aria-hidden="true">{tableSortDir === "asc" ? "\u2191" : "\u2193"}</span>
          )}
        </span>
        {qualifier}
      </button>
    );
    return col.tooltip ? <Tooltip content={col.tooltip}>{button}</Tooltip> : button;
  }

  // Sync top-bar sort changes to column sort
  function handleSortKeyChange(key: SortKey) {
    setSortKey(key);
    setTableSortKey(key);
    setPage(0);
  }

  function handleSortDirChange(dir: SortDir) {
    setSortDir(dir);
    setTableSortDir(dir);
    setPage(0);
  }

  const { rows: filtered, missingExcluded, notShownLabels } = useMemo(() => {
    // Phase 149 / NAV-01 — the in-component publication predicate, now
    // parameterized rather than deleted (deleting it would widen the SHARED
    // component for /discovery and /browse, the roadmap's leak trap).
    // ⚠️ `.slice()` is mandatory on the owner arm: `result.sort(...)` below
    // mutates in place and `strategies` is in this memo's dep array, so handing
    // back the prop array would re-order the caller's data.
    let result =
      visibility === "published-only"
        ? strategies.filter((s) => s.status === "published")
        : strategies.slice();

    // Watchlist scope narrows FIRST — restricting to starred strategies
    // before search/advanced/sort/paging avoids paginating across all
    // strategies only to discover the visible page is empty.
    if (scope === "watchlist") {
      result = result.filter((s) => watchedSet.has(s.id));
    }

    if (!showExamples) {
      result = result.filter((s) => !s.is_example);
    }

    // Search
    if (search) {
      const q = search.toLowerCase();
      result = result.filter((s) => s.name.toLowerCase().includes(q));
    }

    // Advanced: types
    if (advancedFilters.types.length > 0) {
      result = result.filter((s) =>
        s.strategy_types.some((t) => advancedFilters.types.includes(t))
      );
    }

    // Advanced: subtypes
    if (advancedFilters.subtypes.length > 0) {
      result = result.filter((s) =>
        s.subtypes.some((t) => advancedFilters.subtypes.includes(t))
      );
    }

    // Advanced: markets
    if (advancedFilters.markets.length > 0) {
      result = result.filter((s) =>
        s.markets.some((m) => advancedFilters.markets.includes(m))
      );
    }

    // Advanced: exchanges
    if (advancedFilters.exchanges.length > 0) {
      result = result.filter((s) =>
        s.supported_exchanges.some((e) =>
          advancedFilters.exchanges.some((f) => f.toLowerCase() === e.toLowerCase())
        )
      );
    }

    // Advanced: min track record
    if (advancedFilters.minTrackRecord !== "") {
      const minDays = parseInt(advancedFilters.minTrackRecord, 10);
      result = result.filter((s) => {
        if (!s.start_date) return false;
        const start = new Date(s.start_date);
        const daysSince = (mountedAtMs - start.getTime()) / (1000 * 60 * 60 * 24);
        return daysSince >= minDays;
      });
    }

    // Advanced: every range filter, in ONE pass through `rangeMatches` (D-09).
    // Analytics are decimal ratios and the user types a percentage ("50" means 50%,
    // stored as 0.5), hence scale 100 on the percentage keys. A missing figure (null,
    // or an annualised figure the row's record withholds) never matches an active
    // range, a range containing 0 included. Each distinct row that an active range
    // filter excluded because its figure is missing is counted once, for the
    // "Not shown" line; a row out of range by value alone is not.
    //
    // 3M: from the aliased JSONB key when present, else the metrics_json blob.
    // Phase 159 (159-03 / RANK-02): the ANON list read (`getStrategiesByCategory`)
    // projects this one key as `three_month:metrics_json->three_month` (MEASURED
    // against TEST: the embed alias returns a real number); the OWNER read
    // (`getMyStrategies`) keeps its wildcard embed under the D-02 exemption and
    // still carries the blob. Alias first with a blob fallback keeps the filter
    // identical on BOTH surfaces.
    const rangeSpecs: {
      label: string;
      range: RangeFilter;
      scale: number;
      value: (s: StrategyWithAnalytics) => number | null | undefined;
    }[] = [
      { label: "AUM", range: advancedFilters.aum, scale: 1, value: (s) => s.aum },
      { label: "Max capacity", range: advancedFilters.maxCapacity, scale: 1, value: (s) => s.max_capacity },
      { label: "Return %", range: advancedFilters.cumulativeReturn, scale: 100, value: (s) => s.analytics.cumulative_return },
      { label: "CAGR", range: advancedFilters.cagr, scale: 100, value: (s) => gatedMetric(s, "cagr") },
      { label: "Max DD", range: advancedFilters.maxDrawdown, scale: 100, value: (s) => s.analytics.max_drawdown },
      { label: "Volatility", range: advancedFilters.volatility, scale: 100, value: (s) => gatedMetric(s, "volatility") },
      { label: "Sharpe", range: advancedFilters.sharpe, scale: 1, value: (s) => gatedMetric(s, "sharpe") },
      { label: "6 Month", range: advancedFilters.sixMonth, scale: 100, value: (s) => s.analytics.six_month_return },
      { label: "Calmar", range: advancedFilters.calmar, scale: 1, value: (s) => gatedMetric(s, "calmar") },
      {
        label: "3 Month",
        range: advancedFilters.threeMonth,
        scale: 100,
        value: (s) => {
          const mj = s.analytics.metrics_json as Record<string, number> | null;
          return s.analytics.three_month ?? mj?.three_month ?? null;
        },
      },
    ];
    const activeSpecs = rangeSpecs.filter((spec) => spec.range.from !== "" || spec.range.to !== "");
    let missingExcluded = 0;
    const missingLabels = new Set<string>();
    if (activeSpecs.length > 0) {
      result = result.filter((s) => {
        let keep = true;
        let missing = false;
        for (const spec of activeSpecs) {
          const v = spec.value(s);
          if (isMissingFigure(v)) {
            missing = true;
            missingLabels.add(spec.label);
          }
          if (!rangeMatches(v, spec.range, spec.scale)) keep = false;
        }
        if (missing) missingExcluded += 1;
        return keep;
      });
    }

    // Sort - in table mode use column sort, in grid mode use top-bar sort
    const effectiveSortKey = effectiveViewMode === "table" ? tableSortKey : sortKey;
    const effectiveSortDir = effectiveViewMode === "table" ? tableSortDir : sortDir;

    result.sort((a, b) => {
      // STALE-01 — the UNRANKED partition, ahead of every column comparison
      // and DELIBERATELY independent of `effectiveSortDir`.
      //
      // A row with no computed analytics has nothing to sort BY: its KPIs
      // arrive nulled (shapeRowAnalytics, lib/queries.ts) and `getSortValue`
      // coerces every null to 0, which would file it silently mid-table —
      // above every strategy with a negative Sharpe — as though 0 were its
      // measured value. That is a fabricated position, and flipping the sort
      // direction would march it to the opposite end, making the fabrication
      // look like data.
      //
      // Sinking these rows below every ranked one is ALSO what makes the `#n`
      // ordinal a RANK under a metric sort: the ranked rows occupy an unbroken
      // prefix, so "the 3rd ranked row" is also "the 3rd row". (Since 170.7 /
      // D-11 `rankOrdinals` counts ranked rows only, so the Created sort,
      // which interleaves, still numbers them #1, #2, #3 without a hole.)
      //
      // NOT direction-aware and NOT exempted for the `name` column: a row is
      // subordinate because of what is KNOWN about it, not because of which
      // header the visitor last clicked. This is the same subordination rule
      // the Phase 149 Delta 5 placeholder rows follow — render below the
      // ranking, never shift it.
      //
      // 2026-10-10 (170.7 / D-09) — EXCEPT under the Created sort. There a row
      // is ordered by a fact it DOES have, its creation date, so subordinating
      // it would fabricate a position the other way: a strategy created a
      // minute ago, with no analytics yet, would sit below every older ranked
      // one, and "a new strategy is always at the top" would be false for the
      // one strategy that needs it. Every metric key keeps the partition.
      if (effectiveSortKey !== "created_at") {
        const aRanked = isRankedRow(a);
        const bRanked = isRankedRow(b);
        if (aRanked !== bRanked) return aRanked ? -1 : 1;

        // Phase 197 / CLAR-02 (D-03, U-08) — the STALE partition, the second one, directly after the
        // ranked partition and ahead of every column comparison. A displayed row whose newest return
        // day is older than its threshold (or unreadable) sorts after EVERY current displayed row.
        //
        // Direction-independent for the reason the partition above is: a row is subordinate because
        // of what is KNOWN about its data, not because of which header was clicked last. Flipping
        // Sharpe to ascending must not march a dormant strategy to the top.
        //
        // NOT exempted for `name` or `track`: those are orderings of a fact the row has, but the
        // list's claim is "current strategies first, then the ones that stopped reporting", and a
        // name sort that interleaved them would put a dead strategy between two live ones. Stale
        // rows keep their position BETWEEN themselves by the active sort, as undisplayed rows do.
        //
        // Unreached under `created_at`: that sort exists only on the manager mount, where
        // `isCurrentRow` is always true. The exemption is moot, recorded rather than re-decided.
        if (aRanked && bRanked) {
          const aCurrent = isCurrentRow(a);
          const bCurrent = isCurrentRow(b);
          if (aCurrent !== bCurrent) return aCurrent ? -1 : 1;
        }
      }

      // D-09: a missing figure (null, or withheld) sorts after every finite value in
      // BOTH directions and two missing rows keep their prior order. Equally
      // direction-independent as the partition above, and for the same reason: a
      // position is not a measurement, and flipping the sort must not march a row
      // the figure of which we do not have to the other end.
      return compareWithMissingLast(
        getSortValue(a, effectiveSortKey),
        getSortValue(b, effectiveSortKey),
        effectiveSortDir,
      );
    });

    // Deterministic label order (the filter order), not the order rows were visited.
    const notShownLabels = activeSpecs.map((spec) => spec.label).filter((l) => missingLabels.has(l));
    return { rows: result, missingExcluded, notShownLabels };
  }, [strategies, visibility, search, showExamples, advancedFilters, sortKey, sortDir, tableSortKey, tableSortDir, effectiveViewMode, mountedAtMs, scope, watchedSet, isCurrentRow]);

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const paged = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  // 170.7 / D-11 — the `#n` ordinal of each RANKED row: its 1-based position
  // among the ranked rows only, in table order, counted over the FULL filtered
  // and sorted list so the numbering continues across pages (page 2's first
  // ranked row follows page 1's last). An unranked row has no entry and prints
  // an em dash.
  //
  // Under every metric key the STALE-01 partition above makes the ranked rows
  // an unbroken prefix, so this equals the old paged index (`page * PAGE_SIZE
  // + i + 1`) and Discovery / Browse are unchanged. Only the Created sort
  // interleaves unranked rows; deriving the ordinal from the paged index there
  // would leave a hole (`—, #2, #3`) or hand an unranked row an ordinal.
  const rankOrdinals = useMemo(() => {
    const ordinals = new Map<string, number>();
    let next = 0;
    for (const s of filtered) {
      // Phase 197 / CLAR-02 (U-09): a stale or age-unknown row is not ranked, so it takes no ordinal.
      if (isRankedRow(s) && isCurrentRow(s)) ordinals.set(s.id, ++next);
    }
    return ordinals;
  }, [filtered, isCurrentRow]);

  // Phase 149 Delta 5 — deliberately derived OUTSIDE `filtered`/`paged`/`rank`
  // (the UI-SPEC subordination rule): `#n`, `totalPages` and the pagination
  // footer counts must never read these rows, or a bare key would renumber the
  // owner's ranked strategies and inflate "Showing 1–N of N".
  //
  // They render on the LAST page only, so paging through ranked rows does not
  // repeat them. `page >= totalPages - 1` also covers the empty-set case
  // (`totalPages === 0`, since `0 >= -1`), which is exactly the account that
  // has keys but no strategies at all.
  const placeholders = placeholderKeys ?? [];
  const showPlaceholders = placeholders.length > 0 && page >= totalPages - 1;

  // STATE-03 scroll-cue gate. Measure the scroll container's overflow whenever
  // the rendered layout can change width: on mount, on viewport resize, and on
  // page / view-mode / row-count changes (each can grow or shrink the
  // table). The cue is purely a visible hint — its SR equivalent is the
  // ResponsiveTable region aria-label, so this only drives the aria-hidden cue.
  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) {
      setHasMoreToScroll(false);
      return;
    }
    const measure = () => {
      const node = scrollContainerRef.current;
      if (node)
        setHasMoreToScroll(
          node.scrollLeft + node.clientWidth <
            node.scrollWidth - SCROLL_CUE_EPSILON_PX,
        );
    };
    measure();
    // The cue must also re-evaluate as the user scrolls, not only when the box
    // resizes (D-02). Passive: it never calls preventDefault.
    el.addEventListener("scroll", measure, { passive: true });
    // 2026-10-14 Phase 170.6.1 review WR-01 / SFH-01: a web-font swap lands after
    // the first measure and widens the table without resizing the scroll box, so
    // re-measure once the fonts have loaded. `document.fonts` is absent in jsdom
    // and older runtimes.
    let fontsCancelled = false;
    void document.fonts?.ready.then(() => {
      if (!fontsCancelled) measure();
    });
    // ResizeObserver tracks the container's own box (container-query-correct);
    // guard for jsdom / older runtimes where it is absent.
    if (typeof ResizeObserver !== "undefined") {
      const ro = new ResizeObserver(measure);
      ro.observe(el);
      // 2026-10-14 Phase 170.6.1 review WR-01 / SFH-01: also observe the
      // `<table>` itself. A re-sort, a search or a font swap changes the table's
      // content width but not the scroll container's box, so observing `el`
      // alone left the cue stale (hidden while columns were still off-screen).
      const table = el.querySelector("table");
      if (table) ro.observe(table);
      return () => {
        fontsCancelled = true;
        ro.disconnect();
        el.removeEventListener("scroll", measure);
      };
    }
    window.addEventListener("resize", measure);
    return () => {
      fontsCancelled = true;
      window.removeEventListener("resize", measure);
      el.removeEventListener("scroll", measure);
    };
  }, [page, effectiveViewMode, paged.length]);

  // Column count for the "no rows" placeholder. Leading rank column (1) +
  // Strategy + Return% + CAGR + Sharpe + Max DD (5), then Volatility + 6 Month
  // + AUM + Return spark + Underwater spark (5), Track (1, Phase 197 D-05), and Actions (1) = 13; +1
  // leading star column when userId is present, and +2 (Status and Created)
  // when managerRows is set (170.7 / D-01, D-09), +1 more for Health (199-12, D-03).
  // 2026-10-13 Phase 170.6.1 D-01: one fewer column than before, because the
  // per-row disclosure column is gone (13 -> 12, star 14 -> 13). Phase 197 D-05 adds Track
  // (12 -> 13, star 13 -> 14).
  const showStarColumn = userId !== undefined;
  // Phase 197 / ROUTE-05: +1 leading select column when `selectable`.
  const emptyRowColSpan = (showStarColumn ? 14 : 13) + (managerRows ? 3 : 0) + (selectable ? 1 : 0);

  const showEmptyWatchlist = scope === "watchlist" && watchedSet.size === 0;

  // The D-09 excluded-count line, or null at 0. The sentence is `notShownLine`'s.
  const notShownText = notShownLine(missingExcluded, notShownLabels);
  const notShownStatus = notShownText ? (
    <p
      role="status"
      aria-live="polite"
      className="px-4 mt-2 text-caption text-text-muted"
      data-testid="figures-not-shown"
    >
      {notShownText}
    </p>
  ) : null;

  // Quiet Geist-Mono percentile suffix (e.g. `P82`) appended to the ACTIVE sort
  // column only. Honest absence: no percentiles prop, no metric mapping for the
  // sorted column, or a missing/non-finite entry → renders nothing.
  const pctSuffix = (s: StrategyWithAnalytics, colKey: TableSortKey) => {
    if (!percentiles || tableSortKey !== colKey) return null;
    // Phase 197 / CLAR-02 (U-09): a percentile is a ranking claim, so a row with no `#n` (stale,
    // age-unknown or undisplayed) carries none either.
    if (!rankOrdinals.has(s.id)) return null;
    const metric = PERCENTILE_BY_SORT_KEY[colKey];
    if (!metric) return null;
    const p = percentiles[s.id]?.[metric];
    if (p == null || !Number.isFinite(p)) return null;
    // Clamp to 1..99: getPercentiles emits 0..100, but "P0"/"P100" are edge
    // artifacts that read as nonsense in a rank hint. Fixed-width right-aligned
    // span so the suffix never varies the sorted figure's position — the
    // Numbers Contract (digits align in a column) must hold on this surface.
    const shown = Math.min(99, Math.max(1, Math.round(p)));
    return (
      <span className="ml-1 inline-block min-w-[3ch] text-right align-baseline text-micro font-mono tabular-nums text-text-muted">
        P{shown}
      </span>
    );
  };

  // Phase 197 / ROUTE-05 - the sr-only status line (UI-SPEC screen-reader table).
  const selectionStatusText =
    selectedIds.length === 0
      ? ""
      : selectedIds.length === 1
        ? "1 selected. Select one more to compare."
        : selectedIds.length >= COMPARE_MAX_ITEMS
          ? `${selectedIds.length} selected, the maximum.`
          : `${selectedIds.length} selected for comparison.`;

  return (
    <div>
      <StrategyFilters
        search={search}
        onSearchChange={(s) => { setSearch(s); setPage(0); }}
        showExamples={showExamples}
        onToggleExamples={() => {
          // Functional update so the handler reads the current `showExamples`
          // value at fire time, not the value captured when the click handler
          // closure was created. Defends against a hydration race where the
          // hydration effect at line 162-171 queues a `setShowExamples`
          // between the click being scheduled and the closure invoking the
          // setter — the stale closure would otherwise flip back to the
          // pre-hydration value. Tied to the e2e flake documented in
          // e2e/discovery-hide-examples-default.spec.ts:103-117.
          setShowExamples((v) => !v);
          setPage(0);
        }}
        sortKey={sortKey}
        onSortKeyChange={handleSortKeyChange}
        sortDir={sortDir}
        onSortDirChange={handleSortDirChange}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        showViewToggle={visibility !== "owner-all-statuses"}
        // WR-02: the filter bar's Sort selects cannot name Created, so on a
        // seeded-sort mount they would disagree with the table. The column
        // headers are the one sort control there.
        showSort={!initialSort}
        advancedFilters={advancedFilters}
        onAdvancedFiltersChange={(f) => { setAdvancedFilters(f); setPage(0); }}
        leadingSlot={
          userId !== undefined ? (
            <WatchlistTabs
              scope={scope}
              onScopeChange={(s) => { setScope(s); setPage(0); }}
              count={watchedSet.size}
              idBase={tabIdBase}
              panelId={panelId}
            />
          ) : undefined
        }
        onOpenCustomize={
          userId !== undefined ? handleOpenCustomize : undefined
        }
      />

      <div
        id={panelId}
        ref={listRef}
        {...(userId !== undefined
          ? {
              role: "tabpanel",
              "aria-labelledby":
                scope === "watchlist"
                  ? `${tabIdBase}-tab-watchlist`
                  : `${tabIdBase}-tab-all`,
            }
          : {})}
      >
        {/* Phase 194 plan 06 (D-09, UI-SPEC "List contract" item 4) — ONE status
            line above the scroll region saying how many rows an active range
            filter hid because their figure is missing. Never two: when the filter
            empties the table the same line renders beneath the empty message
            instead. Absent at 0. */}
        {!showEmptyWatchlist && (paged.length > 0 || effectiveViewMode === "grid") && notShownStatus}
        {showEmptyWatchlist ? (
          <EmptyWatchlist />
        ) : effectiveViewMode === "table" ? (
          <div
            data-strategy-table=""
            ref={setFrame}
            style={frameStyle}
            className="relative isolate border border-border bg-surface"
          >
            {/* ResponsiveTable is the SINGLE scroll region \u2014 it owns the
                role=region + unique aria-label landmark (the SR scroll-affordance
                announcement) and, via `className`, doubles as the @container
                containment context for the @3xl Strategy-name pinning. `scrollRef` lets
                the visible cue measure the real scroll box. */}
            <ResponsiveTable
              label="Strategies"
              className="@container"
              scrollRef={scrollContainerRef}
            >
              <table className="w-full text-body">
                <thead>
                  <tr className="border-b border-border">
                    {/* Phase 197 / ROUTE-05 (D-04) - the leading select column, only when
                        `selectable`. 44px (the checkbox's touch target), no visible text: the
                        accessible name is the sr-only "Select to compare", the star header's idiom. */}
                    {selectable && (
                      <th
                        ref={selectThRef}
                        scope="col"
                        className={`sticky @3xl:left-0 top-0 z-30 w-11 bg-surface px-0 py-3 text-left ${HEADER_LABEL} text-text-muted`}
                      >
                        <span className="sr-only">Select to compare</span>
                      </th>
                    )}
                    {/* Leading rank column — the sticky-left corner (z-30). Not
                        sortable: rank is derived from the ACTIVE sort, so sorting
                        by it is meaningless. Its visible glyph is "#"; the
                        accessible name is the sr-only "Rank". */}
                    <th
                      ref={rankThRef}
                      scope="col"
                      className={
                        selectable
                          ? `sticky @3xl:left-(--pin-rank-left) top-0 z-30 w-14 bg-surface px-2 py-3 text-right ${HEADER_LABEL} text-text-muted`
                          : `sticky @3xl:left-0 top-0 z-30 w-14 bg-surface px-2 py-3 text-right ${HEADER_LABEL} text-text-muted`
                      }
                    >
                      <span className="sr-only">Rank</span>
                      <span aria-hidden="true">#</span>
                    </th>
                    {showStarColumn && (
                      <th
                        ref={starThRef}
                        scope="col"
                        className={`sticky @3xl:left-(--pin-star-left) top-0 z-30 w-11 bg-surface px-2 py-3 text-left ${HEADER_LABEL} text-text-muted`}
                      >
                        <span className="sr-only">Watchlist</span>
                      </th>
                    )}
                    {COLUMNS.map((col, i) => {
                      // The Strategy-name column (the first non-star column) is
                      // the sticky first column. When the star column is present
                      // it is the corner cell (z-30); otherwise the name header is
                      // the corner. Sticky-left + opaque bg + a right hairline so
                      // it reads as pinned on horizontal scroll (Pattern 3).
                      // The Strategy-name column is now the SECOND sticky column
                      // (the leading rank column owns left-0 / the z-30 corner).
                      // It pins to the right of the rank column (and the star
                      // column when present) so the identity stays visible on
                      // horizontal scroll.
                      // 2026-10-09 Phase 170.2 D-05: the RANK and STAR offsets sit
                      // behind @3xl:, so below the table's own 48rem width those two
                      // scroll away with the row.
                      // 2026-10-14 Phase 170.6.1 D-09 (supersedes 170.6.1 D-03 and
                      // reverses 170.2 D-05 for this one column): the Strategy
                      // column is ALSO pinned below @3xl, at left-0 with its
                      // hairline, so every row stays identifiable while the table
                      // scrolls. D-01 put every column in the scrolling region, and
                      // the old collapse was keyed to the container, so with the
                      // sidebar open laptops up to about 1100 px show them all too;
                      // without a pinned name the scroll end shows Simulate Impact
                      // on a row whose name is off-screen (review WR-02). Rank and
                      // star stay unpinned there: pinning them as well would spend
                      // about 100 px of a 343 px phone region on an ordinal and a
                      // star, and the name needs no offset from them because they
                      // scroll out from under it (it is later in the DOM at the
                      // same z-index).
                      const isFirstCol = i === 0;
                      // 2026-10-09 Phase 170.2 X-1 / P-1: the pinned Strategy header
                      // is z-30, level with the rank and star headers. At z-20 it
                      // tied with the scrolling header cells after it, which paint
                      // over it (later in the DOM) as they scroll under it. Its
                      // offset follows the measured rank (+ star) widths whether or
                      // not the star column shows: --pin-strategy-left already
                      // accounts for it. Every other header stays z-20.
                      const stickyLeft = isFirstCol
                        ? "sticky left-0 @3xl:left-(--pin-strategy-left) top-0 z-30 bg-surface border-r border-border"
                        : "sticky top-0 z-20 bg-surface";
                      const sortedHere = tableSortKey === col.key;
                      return (
                        <Fragment key={col.key}>
                          <th
                            scope="col"
                            // Phase 197 D-05: the column header carries the same accessible name as
                            // its sort button (label + period + annualisation). Name-from-content
                            // over the two visible lines concatenates without separators in some
                            // engines ("Returnfull record"), so the cell a reader hears for a
                            // figure is set explicitly, once, from the shared map.
                            aria-label={col.accessibleName}
                            // aria-sort exposes the current sort state to assistive
                            // tech (WCAG 4.1.2) \u2014 the visual \u2191/\u2193 glyph alone is not an
                            // accessible cue.
                            aria-sort={
                              sortedHere
                                ? tableSortDir === "asc"
                                  ? "ascending"
                                  : "descending"
                                : "none"
                            }
                            className={`${stickyLeft} px-4 py-3 ${col.align === "right" ? "text-right" : "text-left"}`}
                          >
                            {/* The sort control is a real <button> so it is
                                keyboard-operable (WCAG 2.1.1) \u2014 the prior click-only
                                <th> could not be sorted from the keyboard. The
                                actively-sorted header darkens to text-text-primary
                                so the sort target is scannable. */}
                            {renderSortHeader(col, sortedHere)}
                          </th>
                          {/* Phase 170.7 / D-01 — the manager Status column, emitted
                              INSIDE the map right after the Strategy header
                              (index 0), never after the map: a header placed
                              after COLUMNS.map lands after AUM and every data
                              cell is read under the wrong heading. A plain
                              header: not sortable (no button, no aria-sort),
                              vertically sticky at z-20 like every scrolling
                              header, and never horizontally pinned, so it
                              scrolls under the Strategy header's z-30. */}
                          {i === 0 && managerRows && (
                            <th
                              scope="col"
                              className={`sticky top-0 z-20 bg-surface px-4 py-3 text-left ${HEADER_LABEL} text-text-muted`}
                            >
                              Status
                            </th>
                          )}
                          {/* Phase 199 / D-03 — the Health column, directly after
                              Status and before Created. A plain header like
                              Status: not sortable (no button, no aria-sort),
                              vertically sticky at z-20, never horizontally
                              pinned. */}
                          {i === 0 && managerRows && (
                            <th
                              scope="col"
                              className={`sticky top-0 z-20 bg-surface px-4 py-3 text-left ${HEADER_LABEL} text-text-muted`}
                            >
                              Health
                            </th>
                          )}
                          {/* 170.7 / D-09 — the manager Created column, right
                              after Status. Built like a COLUMNS header (same
                              aria-sort derivation, same sort button and
                              glyph) so it sorts from the keyboard, but vertical
                              sticky only: z-20, never horizontally pinned, so
                              it scrolls under the Strategy header's z-30. */}
                          {i === 0 && managerRows && (
                            <th
                              scope="col"
                              aria-sort={
                                tableSortKey === "created_at"
                                  ? tableSortDir === "asc"
                                    ? "ascending"
                                    : "descending"
                                  : "none"
                              }
                              className="sticky top-0 z-20 bg-surface px-4 py-3 text-left"
                            >
                              <button
                                type="button"
                                onClick={() => handleColumnSort("created_at")}
                                className={`-mx-1 inline-flex items-center gap-1 rounded px-1 transition-colors select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${HEADER_LABEL} ${tableSortKey === "created_at" ? "text-text-primary" : "text-text-muted hover:text-text-primary"}`}
                              >
                                Created
                                {tableSortKey === "created_at" && (
                                  <span aria-hidden="true">{tableSortDir === "asc" ? "\u2191" : "\u2193"}</span>
                                )}
                              </button>
                            </th>
                          )}
                        </Fragment>
                      );
                    })}
                    {PLAIN_COLUMNS.map((col) => (
                      <th
                        key={col.key}
                        aria-label={col.accessibleName}
                        className={`sticky top-0 z-20 bg-surface px-4 py-3 text-left ${HEADER_LABEL} text-text-muted`}
                      >
                        {/* Phase 201 plan 16 (D-01, U-06): a plain header is Form A, so it has a keyboard path.
                            The sort headers stay Form B (the Tooltip around their button). */}
                        {col.term ? <Term k={col.term} context="discovery">{col.label}</Term> : col.label}
                        {renderQualifier(col)}
                      </th>
                    ))}
                    <th className={`sticky top-0 z-20 bg-surface pl-4 pr-8 py-3 text-right ${HEADER_LABEL} text-text-muted`}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {paged.map((s) => {
                    // Rank is 1-based among the RANKED rows in the ACTIVE sort
                    // order, continuous across pages (D-11). Re-derived with the
                    // sort, so it re-numbers when the sort flips.
                    const rank = rankOrdinals.get(s.id);
                    // Compute each cell's value ONCE, as the single source of
                    // what it renders, via the honest-null formatters \u2014 never a fabricated
                    // 0/\u2014/demo number (no-invented-data / STATE-02 / T-50-09).
                    const record = rowRecord(s);
                    const gate = gateAnnualized(record);
                    const cagrShown = gatedValue(s.analytics.cagr, gate);
                    const sharpeShown = gatedValue(s.analytics.sharpe, gate);
                    const volatilityShown = gatedValue(s.analytics.volatility, gate);
                    // Phase 197 D-05: volatility can never be negative, so it carries no sign (DESIGN.md Numbers Contract).
                    const volatilityText = formatPercent(volatilityShown, 2, { signed: false });
                    // Phase 197 D-05 - Track: months of record from the SAME covered-day span
                    // the 194 gate reads, titled with the first and last day it counts. The
                    // first day is `recordStartDay`, the rule `figureSpan` itself calls.
                    // An unreadable record is an unknown length, as the withheld figures beside it say (197 WR-01).
                    const trackSpan = record.unreadable ? null : record.spanDays;
                    const trackShown = trackMonths(trackSpan);
                    const { series_start: trackFirst, series_end: trackLast, headline_since: trackHeadline } = s.analytics;
                    const trackTitle =
                      trackSpan != null && trackFirst && trackLast
                        ? `${formatNumber(trackSpan, 0)} days of record, ${formatDay(recordStartDay({ seriesStart: trackFirst, headlineSince: trackHeadline }))} to ${formatDay(trackLast)}.`
                        : undefined;
                    const sixMonthText = formatPercent(s.analytics.six_month_return);
                    const aumText = formatCurrency(s.aum);
                    // Phase 149 Delta 4 — the chip-state status, from the ONE
                    // module-scope derivation (`rowChipStatus`, hoisted in
                    // STALE-01 so the sort comparator reads the identical
                    // value). See that helper for the two defects the naive
                    // shape carried.
                    const chipStatus = rowChipStatus(s);
                    const chipState = deriveEmptySeriesState(
                      chipStatus,
                      s.created_at ?? null,
                    );
                    const hasComputedAnalytics = isDisplayedRow(s);
                    // Phase 197 / CLAR-02: this row's data-age verdict (null on the owner mounts).
                    const seriesVerdict = seriesVerdicts?.get(s.id) ?? null;
                    const notRankedText =
                      hasComputedAnalytics && seriesVerdict
                        ? notRankedReason(seriesVerdict.verdict, seriesVerdict.thresholdDays)
                        : null;
                    // Phase 162 / HONEST-03, UI-SPEC C-6 — an `is_example` row
                    // NEVER claims a sync recency, whatever its status. The
                    // "Example" chip already carries the row's identity, and a
                    // "Synced …" date on a demo seed is a freshness claim about
                    // a thing nobody is syncing — the surface that sat stale for
                    // three months. Written as ONE decided predicate extending
                    // `hasComputedAnalytics` rather than an inline `&&` at the
                    // render site (STALE-01 discipline: one predicate per
                    // claim). Deliberately NOT folded into
                    // `hasComputedAnalytics` itself: that value also gates the
                    // rank cell and the owner pending chip, and an example row
                    // with real computed analytics still earns both.
                    const mayClaimSyncRecency =
                      hasComputedAnalytics && !s.is_example;
                    // Phase 150 / OWN-03 + OWN-05 — the owner row-action
                    // cluster, assembled HERE rather than inline in the action
                    // cell. That placement is deliberate: pin 7 of
                    // phase-149-my-strategies-parity.test.ts asserts that
                    // `s.status === "published"` survives within 300
                    // comment-stripped characters BEFORE `<SimulateImpactButton`,
                    // and a multi-branch cluster written inline between them
                    // would push the guard out of that window and redden the pin
                    // with a misleading message.
                    //
                    // The callback is ABSENT on every public mount, so this
                    // is `null` on /discovery and /browse and the action cell
                    // there is byte-identical to today.
                    // Phase 200 / D-09: no Rename… here. The edit page is the
                    // one rename place, so this cluster is the ownership mark only.
                    // Phase 199 / D-02 — in owner-list mode (`managerRows` set) the
                    // allocator controls need `allocatorFurniture`, so a manager-only
                    // list never shows a control that needs an allocator portfolio,
                    // whatever callbacks the mount passes (T-199-11). The `mr-3`
                    // belongs to the inline mount only: the owner-list cell is a flex
                    // row whose own gap spaces the controls.
                    const allocatorControls = !managerRows || allocatorFurniture;
                    const ownerRowActions =
                      allocatorControls && onMarkOwnership ? (
                        <span
                          className={`inline-flex items-center gap-3 ${s.status === "published" && !managerRows ? "mr-3" : ""}`}
                        >
                          {onMarkOwnership && (
                            <button
                              type="button"
                              onClick={() => onMarkOwnership(s)}
                              className={GHOST_ROW_ACTION}
                            >
                              {/* The label names the ACT, and an unmarked row
                                  is not "changing" anything — the retro path
                                  exists precisely because the question was
                                  never asked of these rows. */}
                              {s.capital_ownership
                                ? "Change mark…"
                                : "Mark ownership…"}
                            </button>
                          )}
                        </span>
                      ) : null;
                    // Simulate Impact, built once and placed by the Actions cell. The
                    // publication guard sits directly before the mount (pin 7 of
                    // phase-149-my-strategies-parity.test.ts reads it from here), and
                    // owner-list mode adds the allocator gate (199 / D-02).
                    const simulateImpact =
                      s.status === "published" && allocatorControls ? (
                        <SimulateImpactButton
                          candidateStrategyId={s.id}
                          candidateName={s.name}
                          portfolioId={portfolioId}
                        />
                      ) : null;
                    // 170.7 / D-06 — a note follows the data row only when this
                    // strategy has one. The data row then hands its bottom
                    // hairline to the note row, so the pair reads as one record
                    // with one rule under it. Every other row keeps today's
                    // class string exactly (managerRows absent => no note).
                    const rowNote = managerRows?.[s.id]?.note;
                    const hasNote = Boolean(rowNote);
                    return (
                      // Keyed by s.id (never the loop index): the pair, and the
                      // row's actions slot inside it, must keep their identity
                      // across a sort and a search, so the
                      // private-link modal's native dialog keeps its opener node
                      // (D-01, founder UAT #4).
                      <Fragment key={s.id}>
                      <tr
                        className={
                          hasNote
                            ? "group transition-colors"
                            : "group border-b border-border last:border-0 transition-colors"
                        }
                        style={{ height: "var(--row-h)" }}
                      >
                        {/* Phase 197 / ROUTE-05 (D-04) - the select cell. A placeholder row never
                            gets one (below it is an empty cell that only keeps the td count). */}
                        {selectable && (
                          <td className="sticky @3xl:left-0 z-10 w-11 bg-surface px-0 py-3 align-middle">
                            <SelectCheckbox
                              strategyId={s.id}
                              name={s.name}
                              checked={selectedIds.includes(s.id)}
                              atCap={selectedAtCap}
                              onToggle={toggleSelected}
                            />
                          </td>
                        )}
                        {/* Sticky rank cell — solid bg-surface (NOT the
                            translucent row hover) so scrolled cells don't bleed
                            through, matching the sticky identity column.

                            STALE-01 — a row with no computed analytics gets NO
                            ordinal. `#n` is not decoration; it is the loudest
                            claim in the row ("3rd best here"), and since Phase
                            159 / RANK-01 stopped emitting a percentile for
                            these rows it is now an UNHEDGED one — the bare
                            ordinal reads as more authoritative than the `#n
                            Pnn` pair it replaced. Its source is the sort over
                            KPIs this row does not have.

                            The em-dash is the SAME honest-absence glyph the
                            metric cells beside it use (DESIGN.md: "a metric
                            that cannot be computed says so with a dash. Never
                            0, never blank, never a fabricated value"), in the
                            cell's existing muted ink — no new token, no new
                            chip, nothing red. Absence is not an error: the
                            Phase 149 rule that a public row must never be
                            shouted at is honoured by saying LESS here, not by
                            adding a public error state. */}
                        <td
                          className={
                            selectable
                              ? "sticky @3xl:left-(--pin-rank-left) z-10 w-14 bg-surface px-2 py-3 text-right align-middle font-mono tabular-nums text-caption text-text-muted"
                              : "sticky @3xl:left-0 z-10 w-14 bg-surface px-2 py-3 text-right align-middle font-mono tabular-nums text-caption text-text-muted"
                          }
                          title={notRankedText ?? undefined}
                        >
                          {rank !== undefined ? `#${rank}` : "—"}
                          {/* Phase 197 / CLAR-02 (U-08): the em dash on a displayed stale or
                              age-unknown row says why, to a screen reader as well as on hover. An
                              undisplayed row keeps today's plain dash. */}
                          {notRankedText && <span className="sr-only">{notRankedText}</span>}
                        </td>
                        {showStarColumn && (
                          <td className="sticky @3xl:left-(--pin-star-left) z-10 w-11 bg-surface px-2 py-3 align-middle">
                            <StarToggle
                              strategyId={s.id}
                              name={s.name}
                              starred={watchedSet.has(s.id)}
                              onToggle={onToggleStar}
                              size="table"
                            />
                          </td>
                        )}
                        {/* Sticky first data column \u2014 solid bg-surface, NOT the
                            translucent hover:bg-page/50, so scrolled cells do not
                            bleed through (Pitfall 5). */}
                        <td
                          className="sticky left-0 z-10 max-w-[60cqw] bg-surface px-4 py-3 border-r border-border @3xl:left-(--pin-strategy-left) @3xl:max-w-none"
                        >
                          <div className="flex items-center gap-1.5">
                            <Link
                              href={buildFactsheetHref(s.id, linkOrigin)}
                              className="font-medium text-text-primary hover:text-accent transition-colors"
                            >
                              <NowrapWords text={s.name} />
                            </Link>
                            {/* Phase 170.6.1.1 (census G): public rows
                                (getStrategiesByCategory) no longer carry
                                api_key_id because anon cannot read it, so the
                                public check follows the trust tier. The
                                owner's own rows (getMyStrategies,
                                authenticated) still carry the key, and the
                                published-gated trust RPC returns no tier for
                                an unpublished draft, so dropping the key half
                                would take the check off an owner's drafts. */}
                            {(s.trust_tier === "api_verified" || s.api_key_id) && (
                              <VerifiedCheck />
                            )}
                            {/* Phase 149 Delta 3 — the owner's own non-published
                                rows say so, muted (absence of publication is a
                                FACT, not an error: publication is admin-gated
                                and the owner has no one-click remedy, so amber
                                would falsely promise one — DESIGN.md
                                semantic-color gate). NO visibility gate is
                                needed and none is wanted: a `published-only`
                                row set can never contain a row this fires on,
                                so the branch is provably dead on /discovery and
                                /browse by the DATA, not by a second predicate
                                that could drift from the first. Muted-only ink
                                comes from Badge's status maps (Badge.tsx). A
                                "Published" chip is deliberately absent —
                                absence of a marker IS "published". */}
                            {!managerRows && s.status !== "published" && (
                              <Badge type="status" label={s.status} />
                            )}
                            {/* Phase 150 / OWN-03 — the ownership mark, in the
                                same Badge family as the status chip beside it.
                                ⛔ THE VISIBILITY GATE IS LOAD-BEARING, unlike
                                the status marker above: public rows arrive here
                                with `capital_ownership` POPULATED (shapeRankingRows
                                spreads the whole strategy row), so an ungated
                                mount would render the owner's mark to anonymous
                                /browse and /discovery readers — UI-SPEC invariant
                                3 says public surfaces show zero pixels of this
                                phase for non-owners (T-150-39). Same guard family
                                as the Delta-4 chips below; public mounts never
                                pass `visibility`, so the pinned "published-only"
                                default keeps them tag-free. An UNMARKED row
                                renders nothing — OwnershipTag returns null, and
                                absence is honest. */}
                            {visibility === "owner-all-statuses" &&
                              (!managerRows || allocatorFurniture) && (
                              <OwnershipTag mark={s.capital_ownership} />
                            )}
                          </div>
                          <div className="flex items-center @max-3xl:flex-wrap gap-2 mt-1">
                            <div className="flex flex-wrap gap-1">
                              {/* Phase 164.6.6.2.1 (D-05, D-12) — a native-unit
                                  (BTC) strategy says so, first in the badge row,
                                  so a BTC return is never read as a USD one.
                                  Never on the name Link row, and no width class
                                  on the pinned cell (UI-SPEC D). A null,
                                  malformed or lower-case unit renders nothing,
                                  so a USD row's DOM is unchanged. */}
                              <ReturnsUnitChip
                                unit={parseReturnsUnit(s.analytics.native_unit)}
                                variant="compact"
                              />
                              {s.strategy_types.map((t) => (
                                <Badge key={t} label={t} className="whitespace-nowrap" />
                              ))}
                            </div>
                            {/* Phase 197 / CLAR-02 (D-03, U-03) — the amber
                                data-date chip, after the strategy-type badges
                                and before the sync badge. Only a displayed row
                                can be non-current (an undisplayed row has no
                                series to date), and `seriesVerdicts` is null
                                on the owner mounts, so those render nothing. */}
                            {hasComputedAnalytics && seriesVerdict && (
                              <StaleSeriesChip
                                verdict={seriesVerdict.verdict}
                                seriesEnd={s.analytics.series_end}
                                ageDays={seriesVerdict.ageDays}
                                thresholdDays={seriesVerdict.thresholdDays}
                              />
                            )}
                            {/* W-B — an uncomputed row must never claim
                                "Synced …": EMPTY_ANALYTICS's `computed_at: ""`
                                is falsy so absent rows were already badge-null,
                                but a LIVE job's computed_at DEFAULT would
                                render one. The SyncBadge component itself is
                                untouched.

                                STALE-01 — the gate is now UNCONDITIONAL. It
                                previously read `visibility !==
                                "owner-all-statuses" || hasComputedAnalytics`,
                                whose left disjunct is true on every PUBLIC
                                mount — so the badge rendered there always, and
                                the honesty rule W-B states applied to exactly
                                the audience least able to check it. Dropping
                                that disjunct removes a false claim; it does not
                                add UI. And the claim was false, not merely
                                stale: the SQL status bridge then re-stamped
                                `computed_at = now()` on the `failed` and
                                `computing` branches (migration
                                20260710150000:179 / :125), so on a failed row
                                that date marked the FAILURE while the figures
                                beside it came from an earlier run — "Synced
                                <the moment we failed to sync>". (Since Phase
                                166.5 the bridge writes no date and the
                                analytics runner stamps it on its success write
                                only, so that pairing no longer arises; the gate
                                stays as written.)

                                Belt-and-braces with `shapeRowAnalytics`
                                (lib/queries.ts), which already blanks
                                `computed_at` for these rows server-side. Kept
                                as well as, not instead of: this component is
                                exported and mounted by three pages, one of them
                                anonymous, and it must not be capable of
                                printing a sync date it cannot justify no matter
                                who hands it rows. */}
                            {mayClaimSyncRecency && (
                              <SyncBadge
                                computedAt={s.analytics.computed_at}
                                /* HONEST-08 — the row HAS this fact: the
                                   ranked projection carries the series' last
                                   date as a scalar alias
                                   (`series_end:returns_series->-1->>date`), so
                                   this surface can and must judge the track
                                   record alongside the job. `?? null` covers
                                   the reads that predate the alias — absent
                                   means unknown, which the resolver caps below
                                   fresh rather than treating as fine. */
                                seriesEnd={s.analytics.series_end ?? null}
                                /* Phase 167.1.2.2.2 / SC-4, D-07 — the
                                   trade-fetch claim is the cron's own record,
                                   seen by every viewer (D-06). F3 — the venue
                                   that decides the STATE is the api-key
                                   exchange or NULL, never
                                   `supported_exchanges`, and here it is NULL.
                                   A recorded fetch time still reads current or
                                   stale; only never-fetched turns into "no
                                   claim", the cautious direction.
                                   Phase 170.6.1 / D-05, D-07 — the row now
                                   also carries the key's venue
                                   (`tradeVenues`, read through the
                                   published-only function), which the badge
                                   uses for its LABEL and TOOLTIP only. That is
                                   why `tradeFetchVenue` stays NULL: feeding the
                                   state's venue is TRADESYNC's decision, and
                                   would turn a null-stamp row into "No trade
                                   fetch recorded yet". */
                                tradesFetchedAt={s.analytics.trades_fetched_at ?? null}
                                tradeFetchVenue={null}
                                exchange={s.supported_exchanges?.[0]}
                                tradeVenues={s.tradeVenues ?? null}
                                listedExchanges={s.supported_exchanges ?? null}
                                tradeVenuesUnavailable={s.tradeVenuesUnavailable ?? false}
                              />
                            )}
                            {/* Phase 149 Delta 4 — the honest pending chip fills
                                the slot SyncBadge leaves empty. Gated on
                                `visibility` so public surfaces are
                                byte-identical: a PUBLISHED row awaiting a
                                recompute must not grow a chip on /discovery
                                (149-UI-SPEC States invariant). Amber = the
                                system recovers this on its own; muted = honest
                                steady-state absence. Red is forbidden for
                                both — absence is not an error. */}
                            {visibility === "owner-all-statuses" &&
                              !hasComputedAnalytics &&
                              (chipState === "computing" ? (
                                <span
                                  title="First metrics arrive in ~10–15 min"
                                  aria-label="Syncing — first metrics arrive in ~10–15 min"
                                  className={`${DATA_STATE_CHIP} ${PIPELINE_CHIPS.syncing.tone}`}
                                >
                                  {PIPELINE_CHIPS.syncing.label}
                                </span>
                              ) : (
                                <span className={`${DATA_STATE_CHIP} ${PIPELINE_CHIPS.no_data.tone}`}>
                                  {PIPELINE_CHIPS.no_data.label}
                                </span>
                              ))}
                          </div>
                          {/* Phase 197 / CLAR-05 (D-01, D-02) — the admin-only
                              third line. The map exists only for an admin
                              viewer (the page passes it only then), so for
                              every other mount this is a lookup on undefined
                              and renders nothing. */}
                          <SharedAccountNote names={sharedAccountPartners?.[s.id] ?? []} />
                        </td>
                        {/* Phase 170.7 / D-01 — the manager Status cell, directly
                            after the Strategy cell so it lines up with the
                            header emitted after index 0 of COLUMNS.map. The
                            SAME Badge the in-name marker uses (suppressed in
                            manager mode above), so the label stays in one
                            map. Not collapsed below @3xl: status is
                            first-order information. */}
                        {managerRows && (
                          <td className="px-4 py-3 whitespace-nowrap group-hover:bg-page/50 transition-colors">
                            <Badge type="status" label={s.status} />
                          </td>
                        )}
                        {/* Phase 199 / D-03 — the Health cell. The server decided
                            the word and its tone; this only prints them. One
                            line (whitespace-nowrap): `Stale (no data since
                            Oct 31, 2026)` is long, and the table scrolls. A row
                            the page passed no health for prints the em dash,
                            never a guessed word. */}
                        {managerRows && (
                          <td className="px-4 py-3 whitespace-nowrap group-hover:bg-page/50 transition-colors">
                            {managerRows[s.id]?.health ? (
                              <span
                                className={`whitespace-nowrap text-caption font-semibold ${managerRows[s.id].health?.tone}`}
                              >
                                {managerRows[s.id].health?.word}
                              </span>
                            ) : (
                              <span className="text-text-muted">{"\u2014"}</span>
                            )}
                          </td>
                        )}
                        {/* 170.7 / D-09 — the manager Created cell, right after
                            Status. The UTC day through the one helper, never
                            a locale string (server and browser would disagree
                            and the table is a client component). */}
                        {managerRows && (
                          <td className="px-4 py-3 whitespace-nowrap font-metric tabular-nums text-text-secondary group-hover:bg-page/50 transition-colors">
                            {formatDay(s.created_at)}
                          </td>
                        )}
                        {/* Phase 197 D-05 — the Track cell: whole months of record from the
                            covered-day span the 194 gate reads (`rowRecord(s).spanDays`, D-20),
                            emitted after the manager Status/Created cells so it lines up with
                            its header (index 1 of the label map). No tone: a short record is a
                            fact, not a verdict. An unknown span is the em dash, never blank. */}
                        <td
                          className={`px-4 py-3 text-right font-metric tabular-nums ${typeof trackShown === "number" ? "text-text-secondary" : "text-text-muted"} group-hover:bg-page/50 transition-colors`}
                          title={trackTitle}
                        >
                          {trackShown == null ? "\u2014" : typeof trackShown === "number" ? formatNumber(trackShown, 0) : trackShown}
                        </td>
                        {/* Return / 6 Month carry a sign → sign-tinted (green/red)
                            only for a finite value. CAGR / Sharpe are magnitudes →
                            neutral ink. Max DD is red only when finitely negative.
                            The percentile suffix rides the ACTIVE sort column. */}
                        <td className={`px-4 py-3 text-right font-metric tabular-nums group-hover:bg-page/50 transition-colors ${signColor(s.analytics.cumulative_return)}`}>
                          {formatPercent(s.analytics.cumulative_return)}
                          {pctSuffix(s, "cumulative_return")}
                        </td>
                        <td className={`px-4 py-3 text-right font-metric tabular-nums group-hover:bg-page/50 transition-colors ${magnitudeColor(cagrShown)}`}>
                          {annualizedCell(formatPercent(cagrShown), gate, record)}
                          {gate !== "withheld" && pctSuffix(s, "cagr")}
                        </td>
                        <td className={`px-4 py-3 text-right font-metric tabular-nums group-hover:bg-page/50 transition-colors ${magnitudeColor(sharpeShown)}`}>
                          {annualizedCell(formatNumber(sharpeShown), gate, record)}
                          {gate !== "withheld" && pctSuffix(s, "sharpe")}
                        </td>
                        <td className={`px-4 py-3 text-right font-metric tabular-nums group-hover:bg-page/50 transition-colors ${drawdownColor(s.analytics.max_drawdown)}`}>
                          {formatPercent(s.analytics.max_drawdown)}
                          {pctSuffix(s, "max_drawdown")}
                        </td>
                        <td className={`px-4 py-3 text-right font-metric tabular-nums ${volatilityShown == null ? "text-text-muted" : "text-text-secondary"} group-hover:bg-page/50 transition-colors`}>
                          {annualizedCell(volatilityText, gate, record)}
                          {gate !== "withheld" && pctSuffix(s, "volatility")}
                        </td>
                        <td className={`px-4 py-3 text-right font-metric tabular-nums group-hover:bg-page/50 transition-colors ${signColor(s.analytics.six_month_return)}`}>
                          {sixMonthText}
                        </td>
                        <td className="px-4 py-3 text-right font-metric tabular-nums text-text-secondary group-hover:bg-page/50 transition-colors">
                          {aumText}
                        </td>
                        <td className="px-4 py-3 group-hover:bg-page/50 transition-colors" data-testid="sparkline-cell-returns">
                          <Sparkline
                            data={s.analytics.sparkline_returns ?? []}
                            color={sparklineColor(s.analytics.sparkline_returns ?? [])}
                            data-testid="sparkline-returns"
                          />
                        </td>
                        <td className="px-4 py-3 group-hover:bg-page/50 transition-colors" data-testid="sparkline-cell-drawdown">
                          <Sparkline
                            data={s.analytics.sparkline_drawdown ?? []}
                            color="var(--color-negative)"
                            fill
                          />
                        </td>
                        {/* Phase 149 / NAV-01 — Simulate Impact is gated on the
                            row's publication status. VERIFIED
                            analytics-service/routers/simulator.py:287-290: the
                            service fetches the candidate filtered to published
                            status and rejects anything else, so a button on an
                            own draft/private row would fail on EVERY click.
                            Rendering nothing beats rendering a button that
                            cannot work (the no-disabled-buttons UAT direction).
                            Behavior-invariant on /discovery and /browse, where
                            the visibility default already guarantees every row
                            is published. */}
                        <td className="pl-4 pr-8 py-3 text-right group-hover:bg-page/50 transition-colors">
                          {/* Phase 170.7 / D-01, 199 / D-02 — owner-list mode: Edit,
                              this row's server-built slot, Mark ownership or
                              Change mark, then Simulate Impact, on ONE
                              line (a wrapped Actions cell doubles the row height
                              and breaks the --row-h rhythm). Each piece renders
                              only when its furniture is on: Edit and the slot
                              when the entry carries them, the allocator controls
                              only under `allocatorFurniture`, because a manager's
                              page has no allocator portfolio and a control that
                              cannot work is worse than none. A missing id shows
                              an empty cell, never another row's slot. */}
                          {managerRows ? (
                            <div className="flex flex-nowrap items-center justify-end gap-3 whitespace-nowrap">
                              {managerRows[s.id]?.editHref && (
                                <Link
                                  href={managerRows[s.id].editHref as string}
                                  aria-label={`Edit ${s.name}`}
                                  className={`${GHOST_ROW_ACTION} inline-flex items-center pointer-coarse:min-h-[44px]`}
                                >
                                  Edit
                                </Link>
                              )}
                              {managerRows[s.id]?.actions}
                              {ownerRowActions}
                              {simulateImpact}
                            </div>
                          ) : (
                            ownerRowActions
                          )}
                          {!managerRows && simulateImpact}
                        </td>
                      </tr>
                      {hasNote && (
                        // 170.7 / D-06 — the full-width note row. One cell spans
                        // every header; the inner block is as wide as the
                        // visible scroller (`cqw` resolves against the
                        // ResponsiveTable @container region) and sticks to its
                        // left edge, so a sentence-length note stays in view at
                        // any scrollLeft. From @3xl its text lines up with the
                        // strategy name above: the merged Strategy offset (the
                        // same variable the Strategy cells pin to) plus the
                        // cell's 1rem padding. No bg-track (chip-contrast pin),
                        // no hover tint, no top padding: the note hugs its row.
                        <tr
                          data-testid="strategy-row-note"
                          className="bg-surface border-b border-border last:border-0"
                        >
                          <td colSpan={emptyRowColSpan} className="p-0">
                            <div
                              data-testid="strategy-row-footer"
                              className="sticky left-0 w-[100cqw] space-y-2 pb-3 pl-4 pr-4 @3xl:pl-[calc(var(--pin-strategy-left)+1rem)] overflow-visible text-caption"
                            >
                              {rowNote}
                            </div>
                          </td>
                        </tr>
                      )}
                      </Fragment>
                    );
                  })}
                  {/* Phase 149 Delta 5 — three arms, in the order they matter:
                      (a) the public pages pass NO placeholders, so
                          `placeholders.length === 0` is always true there and
                          this reduces to today's `paged.length === 0`
                          (byte-identical);
                      (b) on the owner surface, filters that exclude every
                          ranked row still surface the message — the set really
                          WAS filtered (`strategies.length > 0`);
                      (c) a genuinely strategy-less account with bare keys gets
                          NO message: nothing was filtered, so "No strategies
                          match your filters." would be a lie. */}
                  {paged.length === 0 &&
                    (strategies.length > 0 || placeholders.length === 0) && (
                    <tr>
                      <td colSpan={emptyRowColSpan} className="px-4 py-8 text-center text-text-muted">
                        No strategies match your filters.
                        {notShownStatus}
                      </td>
                    </tr>
                  )}
                  {/* Placeholder rows render AFTER the filter-empty message
                      (checker W-5): they are NOT filter results, they are
                      key-coverage rows unaffected by search/filters, so the
                      message about the filtered set belongs above them.
                      Mirrors the ranked row's td sequence exactly so the
                      columns align — hover tint and pctSuffix dropped (there is
                      no data to hover-scan and no rank to compare). */}
                  {showPlaceholders &&
                    placeholders.map((p) => (
                      <tr
                        key={p.id}
                        className="bg-surface-subtle border-b border-border last:border-0"
                        style={{ height: "var(--row-h)" }}
                      >
                        {selectable && (
                          <td className="sticky @3xl:left-0 z-10 w-11 bg-surface-subtle px-0 py-3 align-middle" />
                        )}
                        <td
                          className={
                            selectable
                              ? "sticky @3xl:left-(--pin-rank-left) z-10 w-14 bg-surface-subtle px-2 py-3 text-right align-middle font-mono tabular-nums text-caption text-text-muted"
                              : "sticky @3xl:left-0 z-10 w-14 bg-surface-subtle px-2 py-3 text-right align-middle font-mono tabular-nums text-caption text-text-muted"
                          }
                        >
                          —
                        </td>
                        {/* The owner surface passes no `userId`, so this is
                            dead today — but rendering it keeps the placeholder
                            td count equal to the header th count in EVERY
                            configuration, so a future watchlist-enabled owner
                            table cannot silently misalign these columns. */}
                        {showStarColumn && (
                          <td className="sticky @3xl:left-(--pin-star-left) z-10 w-11 bg-surface-subtle px-2 py-3 align-middle" />
                        )}
                        <td
                          className="sticky left-0 z-10 bg-surface-subtle px-4 py-3 border-r border-border @3xl:left-(--pin-strategy-left)"
                        >
                          <div className="flex items-center gap-1.5">
                            {/* No link: no strategy exists, so there is no
                                factsheet to reach. */}
                            <span className="text-small text-text-muted">
                              {p.exchangeLabel} · {p.keyLabel}
                            </span>
                          </div>
                          <div className="flex items-center gap-2 mt-1">
                            <span className={`${DATA_STATE_CHIP} ${PIPELINE_CHIPS.no_strategy_yet.tone}`}>
                              {PIPELINE_CHIPS.no_strategy_yet.label}
                            </span>
                          </div>
                        </td>
                        {/* 170.7 / D-01 — keeps the placeholder td count equal to
                            the th count when the manager Status column shows.
                            No strategy exists, so no status: an honest em dash. */}
                        {managerRows && (
                          <td className="px-4 py-3">
                            <span className="text-text-muted">—</span>
                          </td>
                        )}
                        {/* Phase 199 / D-03 — and the Health cell: no strategy,
                            nothing to judge. */}
                        {managerRows && (
                          <td className="px-4 py-3">
                            <span className="text-text-muted">—</span>
                          </td>
                        )}
                        {/* 170.7 / D-09 — and the Created cell: no strategy,
                            no creation date. */}
                        {managerRows && (
                          <td className="px-4 py-3">
                            <span className="text-text-muted">—</span>
                          </td>
                        )}
                        {/* Phase 197 D-05 — the Track cell: no series, so no record
                            length. Keeps the td count equal to the th count. */}
                        <td className="px-4 py-3 text-right font-metric tabular-nums">
                          <span className="text-text-muted">—</span>
                        </td>
                        {/* Every metric cell is an honest em-dash: there is no
                            run, no series, nothing to average. A 0 / 0.00 /
                            +0.0% here would be invented data (SC-4). */}
                        <td className="px-4 py-3 text-right font-metric tabular-nums">
                          <span className="text-text-muted">—</span>
                        </td>
                        <td className="px-4 py-3 text-right font-metric tabular-nums">
                          <span className="text-text-muted">—</span>
                        </td>
                        <td className="px-4 py-3 text-right font-metric tabular-nums">
                          <span className="text-text-muted">—</span>
                        </td>
                        <td className="px-4 py-3 text-right font-metric tabular-nums">
                          <span className="text-text-muted">—</span>
                        </td>
                        <td className="px-4 py-3 text-right font-metric tabular-nums">
                          <span className="text-text-muted">—</span>
                        </td>
                        <td className="px-4 py-3 text-right font-metric tabular-nums">
                          <span className="text-text-muted">—</span>
                        </td>
                        <td className="px-4 py-3 text-right font-metric tabular-nums">
                          <span className="text-text-muted">—</span>
                        </td>
                        <td className="px-4 py-3" />
                        <td className="px-4 py-3" />
                        <td className="pl-4 pr-8 py-3 text-right">
                          <button
                            type="button"
                            // 162-06 / HONEST-06 — THIS row's key id, read off
                            // the row being rendered. The bare `onClick=
                            // {onFinishSetup}` this replaces handed the click
                            // event to a zero-arg callback, so every row said
                            // the same thing: "open the wizard", with no way to
                            // tell which key was clicked.
                            onClick={() => onFinishSetup?.(p.id)}
                            className="text-small text-accent underline underline-offset-2"
                          >
                            Finish setup →
                          </button>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </ResponsiveTable>

            {/* Visible scroll cue \u2014 a right-edge gradient fade + hint, shown ONLY
                while the table has more to scroll to the right. aria-hidden: it
                pairs with (never replaces) the ResponsiveTable region aria-label,
                so SR users are not double-announced (STATE-03 / 50-UI-SPEC). */}
            {hasMoreToScroll && (
              <div
                aria-hidden="true"
                data-testid="strategy-table-scroll-cue"
                className="pointer-events-none absolute inset-y-0 right-0 flex items-end justify-end rounded-r-sm bg-gradient-to-l from-surface to-transparent pb-3 pr-3 pl-12"
              >
                <span className="whitespace-nowrap text-caption text-text-muted">
                  Scroll for more columns &rarr;
                </span>
              </div>
            )}
          </div>
        ) : (
          <StrategyGrid
            strategies={paged}
            origin={linkOrigin}
            userId={userId}
            watchedSet={watchedSet}
            onToggleStar={onToggleStar}
            seriesVerdicts={seriesVerdicts ?? undefined}
            selectable={selectable}
            selectedIds={selectable ? selectedIds : undefined}
            onToggleSelected={selectable ? toggleSelected : undefined}
            selectionFull={selectedAtCap}
            sharedAccountPartners={sharedAccountPartners}
          />
        )}

        {!showEmptyWatchlist && totalPages > 1 && (
          <div className="flex items-center justify-between mt-4 text-sm text-text-muted">
            <span>
              Showing {page * PAGE_SIZE + 1}&ndash;{Math.min((page + 1) * PAGE_SIZE, filtered.length)} of {filtered.length}
            </span>
            <div className="flex gap-2">
              <button
                onClick={() => setPage(page - 1)}
                disabled={page === 0}
                className="px-3 py-1 rounded border border-border bg-surface text-text-secondary disabled:opacity-40"
              >
                Previous
              </button>
              <button
                onClick={() => setPage(page + 1)}
                disabled={page >= totalPages - 1}
                className="px-3 py-1 rounded border border-border bg-surface text-text-secondary disabled:opacity-40"
              >
                Next
              </button>
            </div>
          </div>
        )}

        {/* Phase 197 / ROUTE-05 (D-04) - the screen-reader line is ALWAYS mounted while selection is
            on (a live region must exist before its text changes to be announced), and the bar
            below it renders from two selected. */}
        {selectable && (
          <p
            role="status"
            aria-live="polite"
            data-testid="selection-status"
            className="sr-only"
          >
            {selectionStatusText}
          </p>
        )}
        {selectable && selectedIds.length >= 2 && (
          <div
            data-testid="compare-bar"
            className="@container sticky bottom-0 z-40 mt-4 border border-border bg-surface px-4 py-2 shadow-card"
          >
            <div className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                <span className="text-body text-text-secondary">{selectedIds.length} selected</span>
                {/* The chips (and the cap line that follows them) show from the bar's own @2xl
                    width; under it the bar is the count and the two buttons on one line. */}
                <ul className="hidden min-w-0 flex-wrap items-center gap-2 @2xl:flex">
                  {selectedIds.map((id) => {
                    const chipName = strategyNameById.get(id);
                    if (chipName === undefined) return null;
                    return (
                      <li
                        key={id}
                        className="inline-flex min-w-0 items-center gap-1 rounded-sm border border-border bg-surface px-2 py-1 text-caption text-text-primary"
                      >
                        <span className="max-w-64 truncate" title={chipName}>
                          {chipName}
                        </span>
                        <button
                          type="button"
                          aria-label={`Remove ${chipName} from the selection`}
                          data-chip-remove-for={id}
                          onClick={() => removeFromSelection(id)}
                          className="inline-flex items-center justify-center rounded-sm px-1 text-text-muted hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent pointer-coarse:min-h-[44px] pointer-coarse:min-w-[44px]"
                        >
                          <span aria-hidden="true">&times;</span>
                        </button>
                      </li>
                    );
                  })}
                  {selectedAtCap && (
                    <li className="text-caption text-text-muted">
                      Up to {COMPARE_MAX_ITEMS}. Remove one to add another.
                    </li>
                  )}
                </ul>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <Button
                  type="button"
                  variant="ghost"
                  size="md"
                  aria-label="Clear the selection"
                  onClick={clearSelection}
                >
                  Clear
                </Button>
                <Link
                  href={compareHref(selectedIds)}
                  aria-label={`Compare ${selectedIds.length} strategies`}
                  className="inline-flex items-center justify-center rounded-md font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 bg-accent text-white hover:bg-accent-hover min-h-[44px] px-4 py-2.5 text-body"
                >
                  Compare ({selectedIds.length})
                </Link>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Drawer is owned here so the page doesn't thread props through;
          only rendered when signed in. */}
      {userId !== undefined && (
        <CustomizeDrawer
          open={customizeOpen}
          onClose={handleCloseCustomize}
          draft={draftPrefs}
          setDraft={setDraftPrefs}
          persisted={prefs}
          onSave={handleSavePrefs}
        />
      )}
    </div>
  );
}
