"use client";

/**
 * Phase 10 Plan 05 Task 2 — StrategyBrowseDrawer.
 *
 * Right slide-over (620px, max-width 96vw) for the browse-add discovery
 * surface (SCENARIO-04). Pattern-matched to BridgeDrawer (Phase 09.1 D-16)
 * for visual + a11y consistency: backdrop, panel, Esc handler, keyframe
 * animations are copied verbatim.
 *
 * Body: search input + market filter pills + strategy_types filter pills +
 * scrollable card list. Each row shows a CLIENT-SIDE-computed mandate-fit
 * chip (per RESEARCH Pitfall 7 — mandate_fit_score is engine-computed
 * into match_candidates.score_breakdown JSONB and is NOT a strategies
 * column). The chip is INFORMATIONAL only (D-08); allocators are NEVER
 * blocked from adding any verified strategy.
 *
 * Lazy fetch contract: drawer fetches /api/strategies/browse ONCE on open
 * (Plan 03's route). Filters and search apply client-side — zero round-trip
 * per filter change. Drawer stays open after add (multi-add session per
 * "Browse-add" interaction contract); row dims to "Added ✓" then
 * permanently dims at opacity 0.6.
 *
 * onAdd callback delivers an AddedStrategy-shaped object — the structural
 * contract Plan 01's scenario-state.ts addStrategyBrowse mutator expects.
 * The composer (Plan 06) wires this callback to the scenario-state hook.
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  computeMandateFitApprox,
  type AllocatorMandateForFit,
  type MandateFitTier,
} from "../lib/mandate-fit";

export type { AllocatorMandateForFit } from "../lib/mandate-fit";

/**
 * Row shape returned by GET /api/strategies/browse (Plan 03). Defined here
 * to keep the drawer self-contained — when Plan 03 ships in this branch,
 * this can be re-exported from the route handler instead.
 */
export interface StrategyBrowseRow {
  id: string;
  name: string;
  codename: string | null;
  markets: string[];
  strategy_types: string[];
  /**
   * Phase 29 (UNIFY-03 UI) — true for example-universe rows in the merged
   * catalog (`is_example = true AND status = 'published'`). Plan 02 emits this
   * from GET /api/strategies/browse; it gates the neutral-outline "Example"
   * provenance tag rendered next to the row name. Optional + absent → no tag.
   */
  is_example?: boolean;
}

/**
 * Structural contract for the onAdd callback payload — matches the shape
 * Plan 01's scenario-state.ts `AddedStrategy` expects (id + name + markets
 * + strategy_types). The composer (Plan 06) wires this directly to the
 * `addStrategyBrowse` mutator.
 */
export interface AddedStrategy {
  id: string;
  name: string;
  markets: string[];
  strategy_types: string[];
}

export interface StrategyBrowseDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  onAdd: (strategy: AddedStrategy) => void;
  allocatorMandate: AllocatorMandateForFit | null;
  /** Optional fetcher override for tests — defaults to fetch("/api/strategies/browse"). */
  fetchStrategies?: () => Promise<StrategyBrowseRow[]>;
  /**
   * Phase 110 CONTRIB-05 — the browse-list escape hatch. When provided, the
   * drawer surfaces a "Can't find it? Add your own" CTA that dispatches this
   * callback (the composer wires it to close Browse + open the
   * ContributionWizardOverlay). Absent → no CTA (optional-prop safety for mounts
   * that do not support contribution).
   */
  onAddOwn?: () => void;
}

const TIER_COPY: Record<MandateFitTier, string> = {
  green: "Strong mandate fit",
  yellow: "Partial mandate fit",
  red: "Weak mandate fit",
};

const TIER_CLASS: Record<MandateFitTier, string> = {
  green: "text-positive",
  yellow: "text-warning",
  red: "text-negative",
};

const TIER_BG: Record<MandateFitTier, string> = {
  green: "rgba(21,128,61,0.10)",
  yellow: "rgba(217,119,6,0.10)",
  red: "rgba(220,38,38,0.10)",
};

// M-0107 — memoized filter pill. With a stable `onToggle` (useCallback in the
// parent) it re-renders only when its own `pressed` flips, so a search
// keystroke no longer re-renders the entire market/type pill grid.
const FilterPill = memo(function FilterPill({
  label,
  pressed,
  onToggle,
}: {
  label: string;
  pressed: boolean;
  onToggle: (label: string) => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={() => onToggle(label)}
      className={`rounded-md border px-2 py-1 text-xs ${
        pressed
          ? "border-accent text-accent"
          : "border-border text-text-secondary"
      }`}
    >
      {label}
    </button>
  );
});

export function StrategyBrowseDrawer({
  isOpen,
  onClose,
  onAdd,
  allocatorMandate,
  fetchStrategies,
  onAddOwn,
}: StrategyBrowseDrawerProps) {
  const [strategies, setStrategies] = useState<StrategyBrowseRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [activeMarkets, setActiveMarkets] = useState<Set<string>>(new Set());
  const [activeTypes, setActiveTypes] = useState<Set<string>>(new Set());
  const [recentlyAdded, setRecentlyAdded] = useState<Set<string>>(new Set());
  const [permanentlyDimmed, setPermanentlyDimmed] = useState<Set<string>>(
    new Set(),
  );
  const drawerRef = useRef<HTMLDivElement>(null);
  // Review-pass P2 fix — track active "Added ✓ → permanently dimmed"
  // setTimeout ids so the close-reset effect AND unmount can clear them
  // before they fire. Without this, an allocator who dismisses the drawer
  // within the 2s window would see the permanentlyDimmed state mutate
  // AFTER the drawer's transient state was already cleared.
  const dimTimerIdsRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());

  // Fetch on open — single round-trip per drawer activation.
  // Review-pass P2 fix — switch from a `cancelled` flag to AbortController
  // so the underlying fetch is actually aborted on close/unmount, not just
  // its result ignored. Custom fetcher overrides (used in tests) don't get
  // the signal — they continue to use the cancellation flag.
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    const controller = new AbortController();
    /* eslint-disable react-hooks/set-state-in-effect */
    setLoading(true);
    setError(null);
    /* eslint-enable react-hooks/set-state-in-effect */
    const loader =
      fetchStrategies ??
      (async () => {
        const res = await fetch("/api/strategies/browse", {
          signal: controller.signal,
        });
        if (!res.ok) {
          throw new Error(`Failed to load strategies (${res.status})`);
        }
        const json = (await res.json()) as { strategies?: StrategyBrowseRow[] };
        return json.strategies ?? [];
      });
    loader()
      .then((rows) => {
        if (cancelled) return;
        setStrategies(rows);
        setLoading(false);
      })
      .catch((e: unknown) => {
        // H-0117 (loud-fail) — `cancelled` is the ONLY signal that the abort
        // was our own cleanup (close/unmount). When cancelled is true the
        // controller.abort() above intentionally tore down the request, so
        // dropping silently is correct. But a flaky-proxy / mid-flight
        // AbortError arrives with cancelled === false: previously the
        // `e.name === "AbortError"` early-return swallowed it WITHOUT clearing
        // `loading` or setting `error`, wedging the drawer in "Loading…"
        // forever. Past this guard, every error — AbortError included — is a
        // genuine load failure and must surface the distinct error state.
        if (cancelled) return;
        console.error("[StrategyBrowseDrawer] strategy load failed", e);
        setError(
          e instanceof Error ? e.message : "Couldn't load strategies",
        );
        setLoading(false);
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [isOpen, fetchStrategies]);

  // Esc handler + state reset on close. Mirrors BridgeDrawer:59-74 pattern.
  // Review-pass P2 fix — clear any in-flight "Added ✓" → dim setTimeouts
  // when the drawer closes, so they can't mutate state after the transient
  // bookkeeping was already wiped.
  useEffect(() => {
    if (!isOpen) {
      /* eslint-disable react-hooks/set-state-in-effect */
      setSearch("");
      setActiveMarkets(new Set());
      setActiveTypes(new Set());
      setRecentlyAdded(new Set());
      setPermanentlyDimmed(new Set());
      // H-0082(b) — also reset the fetch-result trio. The drawer stays mounted
      // while closed (renders null), so WITHOUT this a reopen's first render
      // flashes the PREVIOUS session's stale `strategies`/`error` for one frame
      // before the fetch effect re-runs and flips to Loading. Resetting to the
      // initial state makes a reopen behave identically to a first open: the
      // documented "close and reopen" recovery path now actually clears a
      // prior error instead of showing it stale.
      setStrategies([]);
      setError(null);
      setLoading(false);
      /* eslint-enable react-hooks/set-state-in-effect */
      // Drain pending dim timers so they don't fire post-close.
      for (const id of dimTimerIdsRef.current) clearTimeout(id);
      dimTimerIdsRef.current.clear();
      return;
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [isOpen, onClose]);

  // Review-pass P2 fix — unmount cleanup. The close-reset path above
  // covers the open→close transition, but a parent unmounting while
  // isOpen=true would orphan timers. This effect runs once on mount and
  // its cleanup runs once on unmount, draining whatever remains.
  useEffect(() => {
    const timers = dimTimerIdsRef.current;
    return () => {
      for (const id of timers) clearTimeout(id);
      timers.clear();
    };
  }, []);

  // M-0106 — derive the filter-pill lists + the filtered+tier rows in memos so
  // a search keystroke (or any unrelated re-render — e.g. the recentlyAdded /
  // permanentlyDimmed dim-timers) doesn't rebuild two Sets + two sorts + a full
  // filter pass + a per-row computeMandateFitApprox (which itself builds a
  // `new Set(prefs)`). Hooks must run unconditionally → above the `!isOpen`
  // early return.
  const allMarkets = useMemo(
    () => Array.from(new Set(strategies.flatMap((s) => s.markets))).sort(),
    [strategies],
  );
  const allTypes = useMemo(
    () =>
      Array.from(new Set(strategies.flatMap((s) => s.strategy_types))).sort(),
    [strategies],
  );
  const q = search.trim().toLowerCase();
  // Filtered rows carry their precomputed mandate-fit `tier` so it isn't
  // recomputed per-row in JSX on every render (only when the filter inputs or
  // the mandate change).
  const filtered = useMemo(
    () =>
      strategies
        .filter((s) => {
          if (q) {
            const nameMatch = s.name.toLowerCase().includes(q);
            const codenameMatch = (s.codename ?? "").toLowerCase().includes(q);
            if (!nameMatch && !codenameMatch) return false;
          }
          if (
            activeMarkets.size > 0 &&
            !s.markets.some((m) => activeMarkets.has(m))
          ) {
            return false;
          }
          if (
            activeTypes.size > 0 &&
            !s.strategy_types.some((t) => activeTypes.has(t))
          ) {
            return false;
          }
          return true;
        })
        .map((s) => ({ s, tier: computeMandateFitApprox(s, allocatorMandate) })),
    [strategies, q, activeMarkets, activeTypes, allocatorMandate],
  );

  // M-0107 — stable per-kind toggle handlers (functional setState, no Set dep)
  // so the memoized FilterPill children re-render only when their own `pressed`
  // flips, not on every keystroke.
  const toggleMarket = useCallback(
    (m: string) =>
      setActiveMarkets((prev) => {
        const next = new Set(prev);
        if (next.has(m)) next.delete(m);
        else next.add(m);
        return next;
      }),
    [],
  );
  const toggleType = useCallback(
    (t: string) =>
      setActiveTypes((prev) => {
        const next = new Set(prev);
        if (next.has(t)) next.delete(t);
        else next.add(t);
        return next;
      }),
    [],
  );

  if (!isOpen) return null;

  function handleAdd(s: StrategyBrowseRow) {
    onAdd({
      id: s.id,
      name: s.name,
      markets: s.markets,
      strategy_types: s.strategy_types,
    });
    setRecentlyAdded((prev) => {
      const next = new Set(prev);
      next.add(s.id);
      return next;
    });
    // Review-pass P2 fix — track the timer id so the close-reset and
    // unmount paths can clear it. Self-removes from the tracking set on
    // fire so memory doesn't leak across many adds in one session.
    const timerId = setTimeout(() => {
      dimTimerIdsRef.current.delete(timerId);
      setRecentlyAdded((prev) => {
        const next = new Set(prev);
        next.delete(s.id);
        return next;
      });
      setPermanentlyDimmed((prev) => {
        const next = new Set(prev);
        next.add(s.id);
        return next;
      });
    }, 2000);
    dimTimerIdsRef.current.add(timerId);
  }

  function clearAllFilters() {
    setSearch("");
    setActiveMarkets(new Set());
    setActiveTypes(new Set());
  }

  return (
    <>
      {/* Backdrop — click dismisses (always onClose; no race lock during loading) */}
      <div
        onClick={onClose}
        aria-hidden="true"
        data-testid="browse-drawer-backdrop"
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(15,23,42,0.32)",
          zIndex: 100,
          animation: "bd-fade 160ms ease",
        }}
      />
      {/* Drawer panel — 620px wide (matches DESIGN.md container widths). */}
      <div
        ref={drawerRef}
        role="dialog"
        aria-label="Browse strategies"
        aria-modal="true"
        style={{
          position: "fixed",
          top: 0,
          right: 0,
          bottom: 0,
          width: 620,
          maxWidth: "96vw",
          background: "var(--surface, white)",
          boxShadow: "-8px 0 20px rgba(0,0,0,0.08)",
          zIndex: 101,
          animation: "bd-slide 220ms ease",
          overflowY: "auto",
          padding: 24,
        }}
      >
        <div className="flex items-center justify-between">
          <div className="text-lg font-semibold text-text-primary">
            Browse strategies
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close drawer"
            className="text-text-muted hover:text-text-primary"
          >
            ×
          </button>
        </div>

        <input
          type="search"
          placeholder="Search by name or codename"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="mt-4 w-full rounded-md border border-border px-3 py-2 text-sm focus:border-accent focus:outline-none"
        />

        <div
          className="mt-3 flex flex-wrap gap-2"
          aria-label="Markets filter"
        >
          {allMarkets.map((m) => (
            <FilterPill
              key={m}
              label={m}
              pressed={activeMarkets.has(m)}
              onToggle={toggleMarket}
            />
          ))}
        </div>
        <div
          className="mt-2 flex flex-wrap gap-2"
          aria-label="Strategy types filter"
        >
          {allTypes.map((t) => (
            <FilterPill
              key={t}
              label={t}
              pressed={activeTypes.has(t)}
              onToggle={toggleType}
            />
          ))}
        </div>

        <div className="mt-6">
          {loading && (
            <div className="py-12 text-center text-sm text-text-muted">
              Loading…
            </div>
          )}
          {error && (
            <div role="alert" className="py-4 text-sm text-negative">
              Couldn&apos;t load strategies — close and reopen the drawer.
            </div>
          )}
          {!loading && !error && strategies.length === 0 && (
            <div className="py-12 text-center text-sm text-text-muted">
              No strategies are live yet.
              <div className="mt-1 text-xs">
                Check back as strategy authors complete verification.
              </div>
            </div>
          )}
          {!loading &&
            !error &&
            strategies.length > 0 &&
            filtered.length === 0 && (
              <div className="py-12 text-center text-sm text-text-muted">
                No strategies match your filters.
                <button
                  type="button"
                  onClick={clearAllFilters}
                  className="ml-2 text-accent underline"
                >
                  Clear filters
                </button>
              </div>
            )}
          <ul className="grid gap-2">
            {filtered.map(({ s, tier }) => {
              const dimmed = permanentlyDimmed.has(s.id);
              const justAdded = recentlyAdded.has(s.id);
              return (
                <li
                  key={s.id}
                  className={`rounded-lg border border-border p-3 ${
                    dimmed ? "opacity-60" : ""
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium text-text-primary">
                          {s.name}
                        </span>
                        {/* Phase 29 (UNIFY-03 UI) — example-universe provenance
                            tag. Neutral-outline pill (same family as the
                            PROJECTED honesty pill). NEVER accent and NEVER a
                            filled <Badge>: accent = verified/action; an example
                            strategy is provenance metadata, not a status. */}
                        {s.is_example === true && (
                          <span
                            data-testid={`browse-example-tag-${s.id}`}
                            className="inline-flex items-center rounded-sm border border-text-muted px-2 py-0.5 text-fixed-10 uppercase tracking-wide font-semibold text-text-muted"
                          >
                            Example
                          </span>
                        )}
                      </div>
                      <div className="mt-1 text-xs text-text-muted">
                        {s.codename ?? ""}
                        {s.codename && s.markets.length > 0 ? " · " : ""}
                        {s.markets.join(" · ")}
                      </div>
                      <span
                        className={`mt-2 inline-block rounded px-2 py-0.5 text-fixed-11 font-medium ${TIER_CLASS[tier]}`}
                        style={{ background: TIER_BG[tier] }}
                      >
                        {TIER_COPY[tier]}
                      </span>
                    </div>
                    <button
                      type="button"
                      disabled={justAdded}
                      onClick={() => handleAdd(s)}
                      className="rounded-md bg-accent px-3 py-1.5 text-xs text-white hover:bg-accent/90 disabled:opacity-50"
                      data-testid={`browse-add-${s.id}`}
                    >
                      {justAdded ? "Added ✓" : "Add"}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>

          {/*
            Phase 110 CONTRIB-05 — the browse-list escape hatch. Rendered beneath
            the results/empty/no-results/error states (all live in this block) so
            it reads as "if none of these are it, add your own". A restrained
            text button separated by a hairline (DESIGN.md — never a second
            accent-fill competing with the row Add buttons). Client action only —
            no href; the composer opens the ContributionWizardOverlay.
          */}
          {onAddOwn && (
            <div className="mt-6 border-t border-border pt-4 text-center">
              <button
                type="button"
                onClick={onAddOwn}
                data-testid="browse-add-own"
                className="text-sm text-accent underline-offset-2 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
              >
                Can&apos;t find it? Add your own
              </button>
            </div>
          )}
        </div>
      </div>

      <style jsx>{`
        @keyframes bd-fade {
          from {
            opacity: 0;
          }
          to {
            opacity: 1;
          }
        }
        @keyframes bd-slide {
          from {
            transform: translateX(100%);
          }
          to {
            transform: translateX(0);
          }
        }
      `}</style>
    </>
  );
}
