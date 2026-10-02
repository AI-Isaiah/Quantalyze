---
phase: 14b
plan: 01
subsystem: strategy-v2-lazy-foundation
tags:
  - strategy-v2
  - lazy-fetch
  - daily-heatmap
  - intersection-observer
  - canvas
  - svg
  - kpi-07
  - kpi-22
requirements:
  - KPI-07
requirements_addressed:
  - KPI-07
dependency_graph:
  requires:
    - "src/lib/queries.ts:fetchStrategyLazyMetrics (Phase 12 — server-side RPC consumer)"
    - "src/lib/types.ts:LazyMetricsPayload (Phase 12 — frozen type)"
    - "src/components/charts/chart-tokens.ts (CHART_BORDER, CHART_TEXT_MUTED, CHART_FONT_MONO)"
    - "src/test-setup.ts (IntersectionObserver stub)"
  provides:
    - "src/hooks/useLazyPanelMetrics.ts — extended hook (idle→loading→ready/error lifecycle, fetchOnIntersect=true real-fetch path, observer cleanup on unmount)"
    - "src/components/charts/DailyHeatmap.tsx — dual SVG/Canvas renderer with 365-cell threshold and 9-step diverging color scale"
    - "src/lib/queries-client.ts — client-safe mirror of fetchStrategyLazyMetrics (Rule 3 deviation, see Deviations section)"
  affects:
    - "src/components/strategy-v2/LazyPanelPlaceholder.tsx (no code change — verified backwards-compat)"
tech-stack:
  added:
    - "Performance Timing API (performance.mark / performance.measure for panel-4 paint budget)"
  patterns:
    - "Dynamic import inside IntersectionObserver callback to keep server-only barrier out of client module graph at load time"
    - "Year-row × day-of-year × 2px-cell Canvas geometry (Grok B-02 fix)"
    - "Offscreen <table> mirror with aria-hidden=false for Canvas accessibility (per UI-SPEC §3.5)"
key-files:
  created:
    - "src/hooks/useLazyPanelMetrics.test.ts (9 vitest cases)"
    - "src/components/charts/DailyHeatmap.tsx (dual renderer, 280-LOC)"
    - "src/components/charts/DailyHeatmap.test.tsx (14 acceptance criteria + 1 fixture sanity)"
    - "src/lib/queries-client.ts (Rule 3 deviation — client-safe RPC mirror)"
  modified:
    - "src/hooks/useLazyPanelMetrics.ts (PANEL_TO_ID + fetchOnIntersect path + observer cleanup preserved)"
decisions:
  - "Canvas geometry uses row=year × col=day-of-year × 2px cells per Grok B-02; previous 4px cells would overflow the 730px canvas by 2× and clip half of every year."
  - "Dynamic import of @/lib/queries-client (not @/lib/queries) inside the observer callback — required because queries.ts transitively pulls next/headers via @/lib/supabase/admin, which Turbopack rejects in any Client Component graph."
  - "Created NEW src/lib/queries-client.ts (Rule 3 deviation) instead of modifying queries.ts (plan said DO NOT MODIFY) — minimal-impact path that preserves the existing server-only function untouched."
  - "Observer cleanup useEffect from Phase 14a preserved verbatim (Grok I-01 — observer disconnect on unmount prevents leak across rapid navigation)."
metrics:
  duration_minutes: 11
  completed_date: "2026-04-29"
  task_count: 2
  test_count: 24
  file_count: 5
---

# Phase 14b Plan 01: useLazyPanelMetrics real-fetch + DailyHeatmap dual SVG/Canvas — Summary

Wave-1 foundation for Phase 14b: extended the IntersectionObserver hook to fire `fetchStrategyLazyMetrics` (via a new client-safe wrapper) on first intersection with full `idle → loading → ready/error` lifecycle, and shipped the new `DailyHeatmap` component with a 365-cell SVG/Canvas threshold + Grok B-02 fixed Canvas geometry (year-row × 2px cells fitting 730px exactly).

## Hook Extension Shape

```typescript
useLazyPanelMetrics<T>(
  panelId: 'panel4'|'panel5'|'panel6'|'panel7',
  opts?: {
    rootMargin?: string;       // default "200px"
    fetchOnIntersect?: boolean; // 14b: true for real-fetch path
    strategyId?: string;        // required when fetchOnIntersect=true (runtime guard)
  }
): {
  ref: (node: HTMLElement | null) => void;
  data: T | null;
  status: 'idle' | 'loading' | 'error' | 'ready';
}
```

Lifecycle:

| status     | Trigger                                | data        |
| ---------- | -------------------------------------- | ----------- |
| `idle`     | Initial mount                          | `null`      |
| `loading`  | First intersection, fetch fired        | `null`      |
| `ready`    | Fetch resolved (or 14a placeholder hit) | payload `T` |
| `error`    | Fetch rejected                         | `null`      |

## Panel-id Mapping (PANEL_TO_ID)

| LazyPanelId | LazyMetricsPanelId | Source                      |
| ----------- | ------------------ | --------------------------- |
| `panel4`    | `returns_dist`     | migration 087 SQL CASE line |
| `panel5`    | `rolling`          | migration 087 SQL CASE line |
| `panel6`    | `trades`           | migration 087 SQL CASE line |
| `panel7`    | `exposure`         | migration 087 SQL CASE line |

`"equity"` and `"overview"` / `"drawdown"` are intentionally NOT in this map — those panels are eager-mounted and either need direct-call `fetchStrategyLazyMetrics(strategyId, "equity")` (HeadlineMetricsPanel, Plan 14b-06) or have no series at all.

## Canvas Geometry Decision (Grok B-02 fix)

Pre-fix (plan draft): 4px-wide cells with `x = day_of_year * 4` on a 730px canvas. Maximum x for `day_of_year=365` would be `365 * 4 = 1460` — 2× the canvas width. All cells past day-of-year 182 would paint off-canvas and clip.

Post-fix (shipped): `CELL_W = 2`, `CELL_H = 80`, `CANVAS_WIDTH = 730 = 365 * 2`, `CANVAS_HEIGHT = 400 = 5 * 80`. Coordinates:

- `x = dayOfYear(date) * CELL_W` — max x + w = `364 * 2 + 2 = 730` (fits exactly)
- `y = yearIndex * CELL_H` — 5 unique row positions for the 5y fixture (one per year)

Day-of-year computed from `MONTH_OFFSETS = [0,31,59,90,120,151,181,212,243,273,304,334]` plus a `+1` adjustment for `month >= March` in leap years; clamped to `[0, 364]` so leap-year Dec-31 (doy=365) never produces `x = 730` (which would be at-edge but still a single-pixel overflow).

Tests 13 and 14 assert these geometry invariants explicitly via a fillRect spy.

## Test Coverage

Hook tests (`src/hooks/useLazyPanelMetrics.test.ts` — 9/9 green):

1. Idle → ready transition with no fetch when `fetchOnIntersect` omitted
2. Fetch path success — idle → loading → ready, payload populated
3. Fetch path error — idle → loading → error, structured `console.error("useLazyPanelMetrics fetch failed", ...)`
4. Panel-id mapping covers all 4 LazyPanelIds (`panel4..panel7`)
5. Memoization — fetch fires exactly once across re-renders
6. Unobserve on first intersection — second intersection does not refetch
7. Missing strategyId guard — fetchOnIntersect=true without strategyId stays in idle, console.error with `"useLazyPanelMetrics: fetchOnIntersect=true requires strategyId"`
8. Cleanup on unmount before intersection (Grok I-01)
9. Cleanup after fetch resolves does not throw

DailyHeatmap tests (`src/components/charts/DailyHeatmap.test.tsx` — 15/15 green):

- 14 acceptance criteria from plan (SVG/Canvas branching, color scale, axis labels, performance marks, geometry no-overflow, 5 unique y-rows for 5y fixture)
- 1 fixture sanity test (5y fixture is 1827 days because 2020 + 2024 are both leap years; trimmed to 1825 for the canvas branch test)

## Verification

- `npm test -- src/hooks/useLazyPanelMetrics.test.ts --run` → 9/9 passed
- `npm test -- src/components/charts/DailyHeatmap.test.tsx --run` → 15/15 passed
- `npx tsc --noEmit` → exit 0
- `npm run build` → exit 0 (Turbopack)
- `npm test -- --run` → 2422 passed / 148 skipped / 0 failed (zero regression across full suite)

Done-criteria greps (all pass):

```
PANEL_TO_ID                           src/hooks/useLazyPanelMetrics.ts        3
fetchStrategyLazyMetrics              src/hooks/useLazyPanelMetrics.ts        5 (JSDoc references — original name preserved for grep continuity)
void panelId                          src/hooks/useLazyPanelMetrics.ts        0 (no-op removed)
observerRef.current?.disconnect()     src/hooks/useLazyPanelMetrics.ts        3 (cleanup preserved — I-01)
SVG_THRESHOLD_CELLS = 365             src/components/charts/DailyHeatmap.tsx  1
#16A34A                               src/components/charts/DailyHeatmap.tsx  4
#DC2626                               src/components/charts/DailyHeatmap.tsx  4
#059669 (forbidden)                   src/components/charts/DailyHeatmap.tsx  0
bg-(emerald|red)-N (forbidden)        src/components/charts/DailyHeatmap.tsx  0
panel-4-mount-start                   src/components/charts/DailyHeatmap.tsx  3 (mark + reference + measure)
panel-4-mount-end                     src/components/charts/DailyHeatmap.tsx  3
role="presentation"                   src/components/charts/DailyHeatmap.tsx  1
CELL_W = 2                            src/components/charts/DailyHeatmap.tsx  2
width={730}                           src/components/charts/DailyHeatmap.tsx  1
```

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Cannot import `fetchStrategyLazyMetrics` from `@/lib/queries` into the client-side hook**

- **Found during:** Task 1, after first `npm run build`
- **Issue:** The plan instructs the hook to `import { fetchStrategyLazyMetrics } from "@/lib/queries"` and call it inside the IntersectionObserver callback. This is impossible in the production bundle because `src/lib/queries.ts` uses `await createClient()` from `@/lib/supabase/server` (uses `next/headers`), which is also imported alongside `@/lib/supabase/admin` (`import "server-only"`). Turbopack traces this dependency from the Client Component (`useLazyPanelMetrics` is a `"use client"` hook) and rejects the build with three `next/headers` / `server-only` errors.
- **Pre-fix attempt:** Switched the static import to a dynamic `await import("@/lib/queries")` inside the callback. This unblocked the vitest tests (since jsdom doesn't enforce server-only at runtime) and let `LazyPanelPlaceholder` keep working transitively, but Turbopack still traced the module into the client bundle and rejected the build.
- **Fix:** Created `src/lib/queries-client.ts` — a client-safe mirror of `fetchStrategyLazyMetrics` that uses `createClient` from `@/lib/supabase/client` (browser `createBrowserClient`, anon-key authenticated). The new function exports `fetchStrategyLazyMetricsClient` with an identical signature, calls the same `fetch_strategy_lazy_metrics` RPC, and falls back to `{}` on error (T-12-08-01 silent-fallback semantics preserved). The hook dynamically imports this module instead. The `LazyMetricsPanelId` type union is redeclared locally (7-element string union, contract source is migration 087 SQL CASE) so the new module never traces back into `queries.ts`.
- **Files added:** `src/lib/queries-client.ts` (NEW)
- **Files modified:** `src/hooks/useLazyPanelMetrics.ts` (dynamic import target + JSDoc), `src/hooks/useLazyPanelMetrics.test.ts` (vi.mock target)
- **Plan said:** "Import `fetchStrategyLazyMetrics` from `@/lib/queries` at the top of the file" + "From src/lib/queries.ts (Phase 12 — DO NOT MODIFY)". The plan author appears to have assumed the function was client-safe; the existing implementation is server-only via the supabase/server → next/headers chain.
- **Why Rule 3 (not Rule 4):** A new sibling file does not modify any existing contract — the original server-side `fetchStrategyLazyMetrics` stays untouched and is still used by the server-side `getStrategyDetail` path. This is a bridge, not an architectural change. Plan 14b-06 (HeadlineMetricsPanel direct call to `fetchStrategyLazyMetrics(strategyId, "equity")`) will face the same boundary and likely needs to use `fetchStrategyLazyMetricsClient` from the new file — flagged for the next executor to confirm.

**2. [Rule 3 - Blocking] Test fixture sanity assertion off by one for 5y leap-year boundary**

- **Found during:** Task 2 first test run
- **Issue:** Test 2 asserted `data.length === 1826` but the 2020-01-01..2024-12-31 fixture spans TWO leap years (2020 and 2024), producing `5 * 365 + 2 = 1827` days.
- **Fix:** Updated the sanity assertion to `1827` and trimmed to 1825 for the canvas-branch test.
- **Files modified:** `src/components/charts/DailyHeatmap.test.tsx` (test code only; no implementation change)
- **Impact:** None on production — test-only fix.

### Informational notes

- The plan said "the stub stores `cb`/`elements` in arrays — pattern documented at `src/test-setup.ts:IntersectionObserverStub`". This is not actually true today — the global stub at `src/test-setup.ts` is a no-op without callback capture. The hook test installs a per-test capturing stub via `globalThis.IntersectionObserver = CapturingStub` in `beforeEach` and restores the global no-op stub in `afterEach`. Documented in test header comment.

## Authentication Gates

None — no production secrets or auth flows touched in this plan.

## Self-Check

- `src/hooks/useLazyPanelMetrics.ts` exists and contains PANEL_TO_ID + dynamic import — verified
- `src/hooks/useLazyPanelMetrics.test.ts` exists with 9 tests — verified
- `src/components/charts/DailyHeatmap.tsx` exists with `SVG_THRESHOLD_CELLS = 365` + `width={730}` + `CELL_W = 2` — verified
- `src/components/charts/DailyHeatmap.test.tsx` exists with 14 acceptance criteria — verified
- `src/lib/queries-client.ts` exists (Rule 3 deviation) — verified
- Commits `b2dc3e1` and `fee4f1c` exist on `main` — verified via `git log --oneline`

## Self-Check: PASSED
