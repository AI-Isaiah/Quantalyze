"use client";

import { useState, useMemo, useCallback, useEffect, useId, useRef } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { ResponsiveTable } from "@/components/ResponsiveTable";
import { withViewTransition } from "@/lib/view-transition";
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
import { SyncBadge } from "./SyncBadge";
import { StarToggle } from "./StarToggle";
import { WatchlistTabs } from "./WatchlistTabs";
import { EmptyWatchlist } from "./EmptyWatchlist";
import { CustomizeDrawer } from "./CustomizeDrawer";
import { SimulateImpactButton } from "@/components/discovery/SimulateImpactButton";
import { OwnershipTag } from "./OwnershipTag";
import { formatPercent, formatNumber, formatCurrency } from "@/lib/utils";
import {
  isComputedAnalytics,
  deriveEmptySeriesState,
} from "@/lib/closed-sets";
import {
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
};

type TableSortKey = SortKey | "name" | "six_month_return";

type PercentileMetric = keyof PercentileMap[string];

// Factsheet KPI-label voice (mono, micro, uppercase, wide tracking) reused for
// every column header so the table header reads as a label, not another data
// row. Sortable headers layer the sort color on top of this.
const HEADER_LABEL = "text-micro font-mono uppercase tracking-[0.14em]";

// Phase 149 Delta 4 — the 147 chip BASE, copied VERBATIM from
// CoverageStateChip.tsx:58 (tokens, not the component: importing an
// allocations-scoped component into the shared discovery table would drag a
// second chip vocabulary onto /discovery). `rounded-sm` (4px) is DELIBERATE
// against the adjacent status Badge's `rounded-md` (6px): the two chip
// families encode different semantics (publication status vs data state) and
// both radii are established DESIGN.md ladder members. Do NOT harmonize.
const DATA_STATE_CHIP =
  "inline-flex items-center rounded-sm px-2 py-0.5 text-fixed-11 font-medium uppercase tracking-wide";

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
  return value >= 0 ? "text-positive" : "text-negative";
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
  return value < 0 ? "text-negative" : "text-text-primary";
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
function rowChipStatus(s: StrategyWithAnalytics): string | null {
  return s.analyticsPresent === false
    ? null
    : s.analytics.computation_status ?? null;
}

// STALE-01 — may this row occupy a POSITION in the ranking, i.e. carry a `#n`?
//
// Same predicate, same helper, as the one deciding whether its metric cells
// hold values (`shapeRowAnalytics` in lib/queries.ts) and whether it enters a
// percentile cohort (`isRankableAnalyticsRow`, Phase 159 / RANK-01). A row
// whose figures we may not show cannot be ordered by those figures either —
// otherwise the ordinal survives as a standalone claim ("this is the 3rd best
// strategy here") sourced from numbers the page just refused to print, which
// is the more authoritative half of the lie, not the lesser one.
function isRankedRow(s: StrategyWithAnalytics): boolean {
  return isComputedAnalytics(rowChipStatus(s));
}

// Priority order (50-UI-SPEC §Dense Reshape behavior 2): Strategy > Return% >
// CAGR > Sharpe > Max DD stay visible at every container width; Volatility,
// 6 Month, AUM (and the two sparkline columns, handled inline below) collapse
// first at narrow widths via the Tailwind v4 `@container` `@max-3xl:hidden`
// variant — their REAL values relocate into the per-row <details>, never a
// fabricated zero/em-dash (no-invented-data / STATE-02).
const COLUMNS: {
  key: TableSortKey;
  label: string;
  align?: "right";
  collapse?: boolean;
}[] = [
  { key: "name", label: "Strategy" },
  { key: "cumulative_return", label: "Return %", align: "right" },
  { key: "cagr", label: "CAGR", align: "right" },
  { key: "sharpe", label: "Sharpe", align: "right" },
  { key: "max_drawdown", label: "Max DD", align: "right" },
  { key: "volatility", label: "Volatility", align: "right", collapse: true },
  { key: "six_month_return", label: "6 Month", align: "right", collapse: true },
  { key: "aum", label: "AUM", align: "right", collapse: true },
];

const PAGE_SIZE = 20;

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
   * The wizard opens FRESH: that overlay has no preselect seam
   * today, and inventing one is out of this phase's scope (tracked in TODOS.md).
   */
  onFinishSetup?: () => void;
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
   * Phase 150 / OWN-05 — opens the Rename dialog. Rendered only on private and
   * draft rows (D-17): on a published row the affordance is ABSENT, not
   * disabled, because published rename is a deferred trust-surface decision and
   * there is no honest remedy to offer. Same precedent as the Simulate gate
   * below — rendering nothing beats rendering a control that cannot work.
   */
  onRename?: (s: StrategyWithAnalytics) => void;
}

// --- Range filter helper ---

function matchesRange(value: number | null | undefined, range: RangeFilter, scale: number): boolean {
  if (range.from === "" && range.to === "") return true;
  const v = value ?? 0;
  const scaled = v * scale;
  if (range.from !== "" && scaled < parseFloat(range.from)) return false;
  if (range.to !== "" && scaled > parseFloat(range.to)) return false;
  return true;
}

function matchesRangeRaw(value: number | null | undefined, range: RangeFilter): boolean {
  if (range.from === "" && range.to === "") return true;
  const v = value ?? 0;
  if (range.from !== "" && v < parseFloat(range.from)) return false;
  if (range.to !== "" && v > parseFloat(range.to)) return false;
  return true;
}

// --- Sort value getter ---

function getSortValue(s: StrategyWithAnalytics, key: TableSortKey): number | string {
  switch (key) {
    case "name":
      return s.name;
    case "aum":
      return s.aum ?? 0;
    case "computed_at":
      return s.analytics.computed_at ?? "";
    case "six_month_return":
      return s.analytics.six_month_return ?? 0;
    default:
      return (s.analytics[key as keyof StrategyAnalytics] as number) ?? 0;
  }
}

export function StrategyTable({
  strategies,
  categorySlug,
  basePath = "/discovery",
  portfolioId = null,
  userId,
  initialWatchedSet,
  percentiles,
  visibility = "published-only",
  placeholderKeys,
  onFinishSetup,
  onMarkOwnership,
  onRename,
}: StrategyTableProps) {
  const reactId = useId();
  const tabIdBase = `watchlist${reactId}`;
  const panelId = `strategy-list${reactId}`;
  const [search, setSearch] = useState("");
  const [showExamples, setShowExamples] = useState(true);
  const [sortKey, setSortKey] = useState<SortKey>("sharpe");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [viewMode, setViewMode] = useState<ViewMode>("table");
  const [advancedFilters, setAdvancedFilters] = useState<AdvancedFilters>(EMPTY_ADVANCED_FILTERS);
  const [page, setPage] = useState(0);

  // Phase 149 / NAV-01 — the SINGLE enforcement point for "grid view is
  // unreachable on the owner surface". A grid card links to
  // `${basePath}/${categorySlug}/${id}` (StrategyGrid.tsx:52-55), which resolves
  // through getStrategyDetail → withPublishedOnly (queries.ts:530) →
  // notFound() for an own unpublished row — a 404 dead end AND an existence
  // oracle (RESEARCH Pitfall 3). Founder ruling 2026-08-05: keep grid
  // DISCOVERY-ONLY and hide the toggle here rather than adding a `rowLinkMode`
  // passthrough. Deriving (instead of clamping `viewMode` itself) is deliberate:
  // the prefs-hydration effect below still writes `setViewMode(prefs.view)`, so
  // a stale persisted `view:"grid"` would otherwise resurrect the dead end.
  // Public surfaces keep both view modes — this collapses to `viewMode` there.
  const effectiveViewMode = visibility === "owner-all-statuses" ? "table" : viewMode;

  // STATE-03 dense reshape — table-scoped density ("comfortable" = the :root
  // 44px/16px default, "compact" = the [data-strategy-table][data-density="tight"]
  // 36px/12px step from globals.css). This data-density attribute lands on the
  // TABLE ROOT only (never <body>), so it cannot leak into the allocator
  // dashboard's global body[data-density] knob (RESEARCH Q2 / globals.css §50).
  const [density, setDensity] = useState<"comfortable" | "compact">("comfortable");

  // Visible scroll-cue gate. The cue (and the ResponsiveTable aria announcement
  // it pairs with) is only meaningful when the table actually overflows its
  // horizontal scroll container. Measured from the scroll container on mount,
  // resize, and whenever the rendered column set changes (density/paging).
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const [isOverflowing, setIsOverflowing] = useState(false);

  // Column header sort (uses a superset of SortKey)
  const [tableSortKey, setTableSortKey] = useState<TableSortKey>("sharpe");
  const [tableSortDir, setTableSortDir] = useState<SortDir>("desc");

  // Capture wall-clock time at mount for the track-record filter (stable across renders)
  const [mountedAtMs] = useState(() => Date.now());

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
    setSortKey(prefs.sort.key);
    setSortDir(prefs.sort.dir);
    setTableSortKey(prefs.sort.key);
    setTableSortDir(prefs.sort.dir);
    setShowExamples(!prefs.hide_examples);
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  // STATE-04 — the row-height change cross-fades via the native View-Transition
  // helper (250ms crossfade), falling back to an instant swap under
  // prefers-reduced-motion / no-API support / SSR. No-op when the value is
  // already active so a repeat click doesn't trigger a needless snapshot. The
  // closure reads the current `density` each render (useCallback dep), so the
  // guard is correct without an updater-function side effect.
  const handleDensityChange = useCallback(
    (next: "comfortable" | "compact") => {
      if (density === next) return;
      withViewTransition(() => setDensity(next));
    },
    [density],
  );

  function handleColumnSort(key: TableSortKey) {
    if (tableSortKey === key) {
      setTableSortDir(tableSortDir === "asc" ? "desc" : "asc");
    } else {
      setTableSortKey(key);
      setTableSortDir("desc");
    }
    setPage(0);
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

  const filtered = useMemo(() => {
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

    // Advanced: capital ranges (raw dollar values)
    result = result.filter((s) => matchesRangeRaw(s.aum, advancedFilters.aum));
    result = result.filter((s) => matchesRangeRaw(s.max_capacity, advancedFilters.maxCapacity));

    // Advanced: performance ranges (analytics are decimal ratios, user enters %)
    // For percentage filters: user enters e.g. "50" meaning 50%, stored as 0.5
    result = result.filter((s) => matchesRange(s.analytics.cumulative_return, advancedFilters.cumulativeReturn, 100));
    result = result.filter((s) => matchesRange(s.analytics.cagr, advancedFilters.cagr, 100));
    result = result.filter((s) => matchesRange(s.analytics.max_drawdown, advancedFilters.maxDrawdown, 100));
    result = result.filter((s) => matchesRange(s.analytics.volatility, advancedFilters.volatility, 100));
    result = result.filter((s) => matchesRangeRaw(s.analytics.sharpe, advancedFilters.sharpe));
    result = result.filter((s) => matchesRange(s.analytics.six_month_return, advancedFilters.sixMonth, 100));
    result = result.filter((s) => matchesRangeRaw(s.analytics.calmar, advancedFilters.calmar));

    // 3M: from the aliased JSONB key when present, else the metrics_json blob.
    //
    // Phase 159 (159-03 / RANK-02): the ANON list read
    // (`getStrategiesByCategory`) no longer ships the whole `metrics_json`
    // blob — it projects this one key as `three_month:metrics_json->three_month`
    // (MEASURED against TEST: the embed alias returns a real number). The
    // OWNER read (`getMyStrategies`) keeps its wildcard embed under the D-02
    // exemption and still carries the blob. Reading the alias first with a
    // blob fallback is what keeps the filter identical on BOTH surfaces —
    // dropping the fallback would silently degrade /my-strategies.
    if (advancedFilters.threeMonth.from !== "" || advancedFilters.threeMonth.to !== "") {
      result = result.filter((s) => {
        const mj = s.analytics.metrics_json as Record<string, number> | null;
        const val = s.analytics.three_month ?? mj?.three_month ?? null;
        return matchesRange(val, advancedFilters.threeMonth, 100);
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
      // Sinking these rows below every ranked one is ALSO what keeps `#n`
      // contiguous: `rank` is derived from the paged index (`page * PAGE_SIZE
      // + i + 1`), so ranked rows may only be numbered while they occupy an
      // unbroken prefix of the list. Interleave one unranked row and either it
      // steals an ordinal or, if skipped, leaves a hole in the sequence.
      //
      // NOT direction-aware and NOT exempted for the `name` column: a row is
      // subordinate because of what is KNOWN about it, not because of which
      // header the visitor last clicked. This is the same subordination rule
      // the Phase 149 Delta 5 placeholder rows follow — render below the
      // ranking, never shift it.
      const aRanked = isRankedRow(a);
      const bRanked = isRankedRow(b);
      if (aRanked !== bRanked) return aRanked ? -1 : 1;

      const aVal = getSortValue(a, effectiveSortKey);
      const bVal = getSortValue(b, effectiveSortKey);

      if (aVal < bVal) return effectiveSortDir === "asc" ? -1 : 1;
      if (aVal > bVal) return effectiveSortDir === "asc" ? 1 : -1;
      return 0;
    });

    return result;
  }, [strategies, visibility, search, showExamples, advancedFilters, sortKey, sortDir, tableSortKey, tableSortDir, effectiveViewMode, mountedAtMs, scope, watchedSet]);

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const paged = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

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
  // density / page / view-mode / row-count changes (each can grow or shrink the
  // table). The cue is purely a visible hint — its SR equivalent is the
  // ResponsiveTable region aria-label, so this only drives the aria-hidden cue.
  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) {
      setIsOverflowing(false);
      return;
    }
    const measure = () => {
      const node = scrollContainerRef.current;
      if (node) setIsOverflowing(node.scrollWidth > node.clientWidth);
    };
    measure();
    // ResizeObserver tracks the container's own box (container-query-correct);
    // guard for jsdom / older runtimes where it is absent.
    if (typeof ResizeObserver !== "undefined") {
      const ro = new ResizeObserver(measure);
      ro.observe(el);
      return () => ro.disconnect();
    }
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [density, page, effectiveViewMode, paged.length]);

  // Column count for the "no rows" placeholder. Leading rank column (1) +
  // Strategy + Return% + CAGR + Sharpe + Max DD (5). Priority-collapsed but
  // still in the DOM (CSS @max-3xl:hidden): Volatility + 6 Month + AUM + Return
  // spark + Underwater spark (5). Plus the per-row Details disclosure column (1)
  // and Actions (1) = 13; +1 leading star column when userId is present.
  const showStarColumn = userId !== undefined;
  const emptyRowColSpan = showStarColumn ? 14 : 13;

  const showEmptyWatchlist = scope === "watchlist" && watchedSet.size === 0;

  // Quiet Geist-Mono percentile suffix (e.g. `P82`) appended to the ACTIVE sort
  // column only. Honest absence: no percentiles prop, no metric mapping for the
  // sorted column, or a missing/non-finite entry → renders nothing.
  const pctSuffix = (s: StrategyWithAnalytics, colKey: TableSortKey) => {
    if (!percentiles || tableSortKey !== colKey) return null;
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
        {showEmptyWatchlist ? (
          <EmptyWatchlist />
        ) : effectiveViewMode === "table" ? (
          <div
            data-strategy-table=""
            data-density={density === "compact" ? "tight" : undefined}
            className="relative border border-border bg-surface"
          >
            {/* Density control \u2014 table-SCOPED (drives the data-density on this
                root only, never <body>, so it cannot flip the allocator
                dashboard). Wrapped through withViewTransition for the
                reduced-motion-safe row-height crossfade (STATE-04). */}
            <div className="flex items-center justify-end border-b border-border px-4 py-2">
              <div
                role="group"
                aria-label="Table density"
                className="inline-flex overflow-hidden rounded-lg border border-border"
              >
                <button
                  type="button"
                  aria-pressed={density === "comfortable"}
                  onClick={() => handleDensityChange("comfortable")}
                  className={`px-3 py-1 text-caption transition-colors ${
                    density === "comfortable"
                      ? "bg-page text-accent"
                      : "text-text-muted hover:text-text-primary"
                  }`}
                >
                  Comfortable
                </button>
                <button
                  type="button"
                  aria-pressed={density === "compact"}
                  onClick={() => handleDensityChange("compact")}
                  className={`border-l border-border px-3 py-1 text-caption transition-colors ${
                    density === "compact"
                      ? "bg-page text-accent"
                      : "text-text-muted hover:text-text-primary"
                  }`}
                >
                  Compact
                </button>
              </div>
            </div>

            {/* ResponsiveTable is the SINGLE scroll region \u2014 it owns the
                role=region + unique aria-label landmark (the SR scroll-affordance
                announcement) and, via `className`, doubles as the @container
                containment context for the priority-collapse. `scrollRef` lets
                the visible cue measure the real scroll box. */}
            <ResponsiveTable
              label="Strategies"
              className="@container"
              scrollRef={scrollContainerRef}
            >
              <table className="w-full text-body">
                <thead>
                  <tr className="border-b border-border">
                    {/* Leading rank column — the sticky-left corner (z-30). Not
                        sortable: rank is derived from the ACTIVE sort, so sorting
                        by it is meaningless. Its visible glyph is "#"; the
                        accessible name is the sr-only "Rank". */}
                    <th
                      scope="col"
                      className={`sticky left-0 top-0 z-30 w-14 bg-surface px-2 py-3 text-right ${HEADER_LABEL} text-text-muted`}
                    >
                      <span className="sr-only">Rank</span>
                      <span aria-hidden="true">#</span>
                    </th>
                    {showStarColumn && (
                      <th
                        scope="col"
                        className={`sticky left-14 top-0 z-30 w-11 bg-surface px-2 py-3 text-left ${HEADER_LABEL} text-text-muted`}
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
                      const isFirstCol = i === 0;
                      const stickyLeft = isFirstCol
                        ? showStarColumn
                          ? "sticky left-[6.25rem] top-0 z-20 bg-surface border-r border-border"
                          : "sticky left-14 top-0 z-20 bg-surface border-r border-border"
                        : "sticky top-0 z-20 bg-surface";
                      const sortedHere = tableSortKey === col.key;
                      return (
                        <th
                          key={col.key}
                          scope="col"
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
                          className={`${stickyLeft} px-4 py-3 ${col.align === "right" ? "text-right" : "text-left"} ${col.collapse ? "@max-3xl:hidden" : ""}`}
                        >
                          {/* The sort control is a real <button> so it is
                              keyboard-operable (WCAG 2.1.1) \u2014 the prior click-only
                              <th> could not be sorted from the keyboard. The
                              actively-sorted header darkens to text-text-primary
                              so the sort target is scannable. */}
                          <button
                            type="button"
                            onClick={() => handleColumnSort(col.key)}
                            className={`-mx-1 inline-flex items-center gap-1 rounded px-1 transition-colors select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${HEADER_LABEL} ${sortedHere ? "text-text-primary" : "text-text-muted hover:text-text-primary"}`}
                          >
                            {col.label}
                            {sortedHere && (
                              <span aria-hidden="true">{tableSortDir === "asc" ? "\u2191" : "\u2193"}</span>
                            )}
                          </button>
                        </th>
                      );
                    })}
                    <th className={`sticky top-0 z-20 bg-surface px-4 py-3 text-left ${HEADER_LABEL} text-text-muted @max-3xl:hidden`}>Return</th>
                    <th className={`sticky top-0 z-20 bg-surface px-4 py-3 text-left ${HEADER_LABEL} text-text-muted @max-3xl:hidden`}>Underwater</th>
                    {/* Details disclosure column \u2014 surfaces the collapsed values
                        at narrow widths; the header is a screen-reader label. */}
                    <th scope="col" className={`sticky top-0 z-20 bg-surface px-4 py-3 text-left ${HEADER_LABEL} text-text-muted @3xl:hidden`}>
                      <span className="sr-only">Details</span>
                    </th>
                    <th className={`sticky top-0 z-20 bg-surface px-4 py-3 text-right ${HEADER_LABEL} text-text-muted`}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {paged.map((s, i) => {
                    // Rank is 1-based within the ACTIVE sort order, continuous
                    // across pages (page 2 row 1 = #21). Re-derived every render
                    // from the paged index, so it re-numbers when the sort flips.
                    const rank = page * PAGE_SIZE + i + 1;
                    // Compute each collapsible cell's value ONCE so the visible
                    // cell and the relocated <details> render the IDENTICAL real
                    // value via the honest-null formatters \u2014 never a fabricated
                    // 0/\u2014/demo number (no-invented-data / STATE-02 / T-50-09).
                    const volatilityText = formatPercent(s.analytics.volatility);
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
                    const hasComputedAnalytics = isComputedAnalytics(chipStatus);
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
                    // Both callbacks are ABSENT on every public mount, so this
                    // is `null` on /discovery and /browse and the action cell
                    // there is byte-identical to today.
                    // D-17: the rename affordance mirrors the SERVER gate
                    // exactly (the route's UPDATE filters to these two
                    // statuses), rather than "not published" — an archived row
                    // is not renameable either, and a render gate that is wider
                    // than the write gate produces a control that 404s.
                    const isRenameable =
                      s.status === "private" || s.status === "draft";
                    const ownerRowActions =
                      onMarkOwnership || (onRename && isRenameable) ? (
                        <span
                          className={`inline-flex items-center gap-3 ${s.status === "published" ? "mr-3" : ""}`}
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
                          {onRename && isRenameable && (
                            <button
                              type="button"
                              onClick={() => onRename(s)}
                              className={GHOST_ROW_ACTION}
                            >
                              Rename…
                            </button>
                          )}
                        </span>
                      ) : null;
                    return (
                      <tr
                        key={s.id}
                        className="group border-b border-border last:border-0 transition-colors"
                        style={{ height: "var(--row-h)" }}
                      >
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
                        <td className="sticky left-0 z-10 w-14 bg-surface px-2 py-3 text-right align-middle font-mono tabular-nums text-caption text-text-muted">
                          {hasComputedAnalytics ? `#${rank}` : "—"}
                        </td>
                        {showStarColumn && (
                          <td className="sticky left-14 z-10 w-11 bg-surface px-2 py-3 align-middle">
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
                          className={`sticky z-10 bg-surface px-4 py-3 border-r border-border ${showStarColumn ? "left-[6.25rem]" : "left-14"}`}
                        >
                          <div className="flex items-center gap-1.5">
                            <Link
                              href={`/factsheet/${s.id}`}
                              className="font-medium text-text-primary hover:text-accent transition-colors"
                            >
                              {s.name}
                            </Link>
                            {s.api_key_id && (
                              <span title="Verified via exchange API" className="text-accent">
                                <svg className="h-4 w-4" viewBox="0 0 16 16" fill="currentColor">
                                  <path d="M8 0a8 8 0 110 16A8 8 0 018 0zm3.78 5.22a.75.75 0 00-1.06 0L7 8.94 5.28 7.22a.75.75 0 00-1.06 1.06l2.25 2.25a.75.75 0 001.06 0l4.25-4.25a.75.75 0 000-1.06z" />
                                </svg>
                              </span>
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
                            {s.status !== "published" && (
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
                            {visibility === "owner-all-statuses" && (
                              <OwnershipTag mark={s.capital_ownership} />
                            )}
                          </div>
                          <div className="flex items-center gap-2 mt-1">
                            <div className="flex gap-1">
                              {s.strategy_types.map((t) => (
                                <Badge key={t} label={t} />
                              ))}
                            </div>
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
                                add UI. And the claim is false, not merely
                                stale: the SQL status bridge re-stamps
                                `computed_at = now()` on the `failed` and
                                `computing` branches (migration
                                20260710150000:179 / :125), so on a failed row
                                that date marks the FAILURE while the figures
                                beside it come from an earlier run — "Synced
                                <the moment we failed to sync>".

                                Belt-and-braces with `shapeRowAnalytics`
                                (lib/queries.ts), which already blanks
                                `computed_at` for these rows server-side. Kept
                                as well as, not instead of: this component is
                                exported and mounted by three pages, one of them
                                anonymous, and it must not be capable of
                                printing a sync date it cannot justify no matter
                                who hands it rows. */}
                            {mayClaimSyncRecency && (
                              <SyncBadge computedAt={s.analytics.computed_at} exchange={s.supported_exchanges?.[0]} />
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
                                  className={`${DATA_STATE_CHIP} text-warning bg-warning-bg border border-warning-border`}
                                >
                                  Syncing
                                </span>
                              ) : (
                                <span className={`${DATA_STATE_CHIP} text-text-muted bg-track`}>
                                  No data
                                </span>
                              ))}
                          </div>
                        </td>
                        {/* Return / 6 Month carry a sign → sign-tinted (green/red)
                            only for a finite value. CAGR / Sharpe are magnitudes →
                            neutral ink. Max DD is red only when finitely negative.
                            The percentile suffix rides the ACTIVE sort column. */}
                        <td className={`px-4 py-3 text-right font-metric tabular-nums group-hover:bg-page/50 transition-colors ${signColor(s.analytics.cumulative_return)}`}>
                          {formatPercent(s.analytics.cumulative_return)}
                          {pctSuffix(s, "cumulative_return")}
                        </td>
                        <td className={`px-4 py-3 text-right font-metric tabular-nums group-hover:bg-page/50 transition-colors ${magnitudeColor(s.analytics.cagr)}`}>
                          {formatPercent(s.analytics.cagr)}
                          {pctSuffix(s, "cagr")}
                        </td>
                        <td className={`px-4 py-3 text-right font-metric tabular-nums group-hover:bg-page/50 transition-colors ${magnitudeColor(s.analytics.sharpe)}`}>
                          {formatNumber(s.analytics.sharpe)}
                          {pctSuffix(s, "sharpe")}
                        </td>
                        <td className={`px-4 py-3 text-right font-metric tabular-nums group-hover:bg-page/50 transition-colors ${drawdownColor(s.analytics.max_drawdown)}`}>
                          {formatPercent(s.analytics.max_drawdown)}
                          {pctSuffix(s, "max_drawdown")}
                        </td>
                        <td className="px-4 py-3 text-right font-metric tabular-nums text-text-secondary group-hover:bg-page/50 transition-colors @max-3xl:hidden">
                          {volatilityText}
                          {pctSuffix(s, "volatility")}
                        </td>
                        <td className={`px-4 py-3 text-right font-metric tabular-nums group-hover:bg-page/50 transition-colors @max-3xl:hidden ${signColor(s.analytics.six_month_return)}`}>
                          {sixMonthText}
                        </td>
                        <td className="px-4 py-3 text-right font-metric tabular-nums text-text-secondary group-hover:bg-page/50 transition-colors @max-3xl:hidden">
                          {aumText}
                        </td>
                        <td className="px-4 py-3 group-hover:bg-page/50 transition-colors @max-3xl:hidden" data-testid="sparkline-cell-returns">
                          <Sparkline
                            data={s.analytics.sparkline_returns ?? []}
                            color={sparklineColor(s.analytics.sparkline_returns ?? [])}
                            data-testid="sparkline-returns"
                          />
                        </td>
                        <td className="px-4 py-3 group-hover:bg-page/50 transition-colors @max-3xl:hidden" data-testid="sparkline-cell-drawdown">
                          <Sparkline
                            data={s.analytics.sparkline_drawdown ?? []}
                            color="var(--color-negative)"
                            fill
                          />
                        </td>
                        {/* Priority-collapse detail \u2014 only shown once the
                            columns above collapse (@3xl:hidden = visible below
                            the 3xl container width). Relocates the SAME real
                            values (volatilityText/sixMonthText/aumText) computed
                            once above; sparklines relocate too. */}
                        <td className="px-4 py-3 align-top group-hover:bg-page/50 transition-colors @3xl:hidden">
                          <details className="text-caption text-text-secondary">
                            <summary className="cursor-pointer select-none text-text-muted hover:text-text-primary">
                              More
                            </summary>
                            <dl className="mt-2 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1">
                              <dt className="text-text-muted">Volatility</dt>
                              <dd className="text-right font-metric tabular-nums">{volatilityText}</dd>
                              <dt className="text-text-muted">6 Month</dt>
                              <dd className={`text-right font-metric tabular-nums ${signColor(s.analytics.six_month_return)}`}>{sixMonthText}</dd>
                              <dt className="text-text-muted">AUM</dt>
                              <dd className="text-right font-metric tabular-nums">{aumText}</dd>
                              <dt className="text-text-muted">Return</dt>
                              <dd className="flex justify-end">
                                <Sparkline
                                  data={s.analytics.sparkline_returns ?? []}
                                  color={sparklineColor(s.analytics.sparkline_returns ?? [])}
                                />
                              </dd>
                              <dt className="text-text-muted">Underwater</dt>
                              <dd className="flex justify-end">
                                <Sparkline
                                  data={s.analytics.sparkline_drawdown ?? []}
                                  color="var(--color-negative)"
                                  fill
                                />
                              </dd>
                            </dl>
                          </details>
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
                        <td className="px-4 py-3 text-right group-hover:bg-page/50 transition-colors">
                          {ownerRowActions}
                          {s.status === "published" && (
                            <SimulateImpactButton
                              candidateStrategyId={s.id}
                              candidateName={s.name}
                              portfolioId={portfolioId}
                            />
                          )}
                        </td>
                      </tr>
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
                        <td className="sticky left-0 z-10 w-14 bg-surface-subtle px-2 py-3 text-right align-middle font-mono tabular-nums text-caption text-text-muted">
                          —
                        </td>
                        {/* The owner surface passes no `userId`, so this is
                            dead today — but rendering it keeps the placeholder
                            td count equal to the header th count in EVERY
                            configuration, so a future watchlist-enabled owner
                            table cannot silently misalign these columns. */}
                        {showStarColumn && (
                          <td className="sticky left-14 z-10 w-11 bg-surface-subtle px-2 py-3 align-middle" />
                        )}
                        <td
                          className={`sticky z-10 bg-surface-subtle px-4 py-3 border-r border-border ${showStarColumn ? "left-[6.25rem]" : "left-14"}`}
                        >
                          <div className="flex items-center gap-1.5">
                            {/* No link: no strategy exists, so there is no
                                factsheet to reach. */}
                            <span className="text-small text-text-muted">
                              {p.exchangeLabel} · {p.keyLabel}
                            </span>
                          </div>
                          <div className="flex items-center gap-2 mt-1">
                            <span className={`${DATA_STATE_CHIP} text-text-muted bg-track`}>
                              No strategy yet
                            </span>
                          </div>
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
                        <td className="px-4 py-3 text-right font-metric tabular-nums @max-3xl:hidden">
                          <span className="text-text-muted">—</span>
                        </td>
                        <td className="px-4 py-3 text-right font-metric tabular-nums @max-3xl:hidden">
                          <span className="text-text-muted">—</span>
                        </td>
                        <td className="px-4 py-3 text-right font-metric tabular-nums @max-3xl:hidden">
                          <span className="text-text-muted">—</span>
                        </td>
                        <td className="px-4 py-3 @max-3xl:hidden" />
                        <td className="px-4 py-3 @max-3xl:hidden" />
                        <td className="px-4 py-3 align-top @3xl:hidden" />
                        <td className="px-4 py-3 text-right">
                          <button
                            type="button"
                            onClick={onFinishSetup}
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
                when the table overflows its scroll container. aria-hidden: it
                pairs with (never replaces) the ResponsiveTable region aria-label,
                so SR users are not double-announced (STATE-03 / 50-UI-SPEC). */}
            {isOverflowing && (
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-y-0 right-0 flex items-end justify-end rounded-r-sm bg-gradient-to-l from-surface to-transparent pb-3 pr-3 pl-12"
              >
                <span className="text-caption text-text-muted">
                  Scroll for more columns &rarr;
                </span>
              </div>
            )}
          </div>
        ) : (
          <StrategyGrid
            strategies={paged}
            categorySlug={categorySlug}
            basePath={basePath}
            userId={userId}
            watchedSet={watchedSet}
            onToggleStar={onToggleStar}
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
