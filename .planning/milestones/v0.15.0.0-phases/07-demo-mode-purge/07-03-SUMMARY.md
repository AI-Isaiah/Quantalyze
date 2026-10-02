---
phase: 07-demo-mode-purge
plan: 03
subsystem: nextjs-server-query + react-ui
tags: [nextjs, supabase, server-query, react-testing, vitest, allocator-equity]

# Dependency graph
requires:
  - phase: 07-demo-mode-purge
    plan: 01
    provides: "allocator_equity_snapshots with history_depth_months column + 3-tier RLS + key-scoped job kinds"
  - phase: 07-demo-mode-purge
    plan: 02
    provides: "equity_reconstruction handlers populating allocator_equity_snapshots with per-venue history_depth_months"
provides:
  - "MyAllocationDashboardPayload 9 new fields: equitySnapshots, holdingsSummary, snapshotCount, allKeysStale, lastSyncAt, hasSyncing, equityDailyPoints, minHistoryDepthMonths, activeVenues"
  - "getMyAllocationDashboard reads allocator_equity_snapshots + allocator_holdings (+ count-exact head fetch for warm-up gate) via user-scoped RLS client"
  - "equitySnapshotsToDailyPoints adapter in src/lib/allocation-helpers.ts with forward-fill gap semantics (f7)"
  - "KpiStrip renders warm-up helper per null KPI cell — default 'Warming up — need N more days of synced data.' copy OR venue-specific 'Only N months of history available on {venues}' when minHistoryDepthMonths <= 3"
  - "EquityCurve + DrawdownChart accept optional equityDailyPoints prop; prefer it when present (parallel-prop f7)"
  - "formatPercent(null|undefined) regression guards pin em-dash U+2014 output (f8 verification-only — src/lib/utils.ts unchanged)"
affects: [07-04-allocations-tabbed-layout, 07-05-empty-state, 09-bridge-live-holdings]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Parallel-prop widget extension (f7) — optional equityDailyPoints prop overrides strategies-derived compute when present (including empty []), preserving fallback for Bridge allocators"
    - "Head-count Supabase select pattern — .select('*', { count: 'exact', head: true }) for snapshot warm-up gate without wasted row transfer"
    - "Shared derivePhase07Fields helper — single source of truth for allKeysStale/lastSyncAt/hasSyncing/activeVenues/minHistoryDepthMonths/holdingsSummary, invoked from both the !portfolio and portfolio-exists branches"
    - "Venue-specific warm-up copy boundary is <=3 months (inclusive of OKX's 3-month terminus, per VOICES-ACCEPTED f9)"

key-files:
  created:
    - "src/lib/allocation-helpers.equity-adapter.test.ts (84 lines, 6 test cases)"
    - "src/app/(dashboard)/allocations/components/KpiStrip.warmup.test.tsx (159 lines, 7 test cases)"
    - "src/app/(dashboard)/allocations/widgets/performance/equity-curve.equitydailypoints.test.tsx (146 lines, 6 test cases)"
  modified:
    - "src/lib/allocation-helpers.ts (+63 lines: adapter + JSDoc)"
    - "src/lib/queries.ts (+260/-11 lines: MyAllocationDashboardPayload extensions, derivePhase07Fields helper, Phase 07 parallel fetches, !portfolio branch rewrite, duplicate getUserApiKeys removal)"
    - "src/lib/queries.my-allocation.test.ts (+330 lines: mock-builder head-count support + Phase 07 tables + 10 new tests)"
    - "src/lib/utils.test.ts (+17 lines: f8 formatPercent regression guards)"
    - "src/app/(dashboard)/allocations/components/KpiStrip.tsx (+70/-1 lines: warmupCopy helper + 4 new optional props + per-cell helper render)"
    - "src/app/(dashboard)/allocations/widgets/performance/EquityCurve.tsx (+36 lines: parallel-prop branch with USD normalisation)"
    - "src/app/(dashboard)/allocations/widgets/performance/DrawdownChart.tsx (+26 lines: parallel-prop branch with running-peak drawdown)"

key-decisions:
  - "Venue-specific warm-up copy boundary is inclusive of 3 months (minHistoryDepthMonths <= 3), not strict < 3 as the must_haves originally wrote. OKX's trade-history cap IS 3 months; an allocator at that boundary needs the venue-specific explanation, not the generic 30-day countdown. The plan's own Test E + Test F specs explicitly feed minHistoryDepthMonths=3 and expect venue-specific copy — they are the authoritative spec and override the stricter prose."
  - "Phase 07 parallel fetches are extracted OUT of the main-branch Promise.all and into a top-level Promise.all that runs BEFORE the portfolio-exists check. This lets the !portfolio branch reuse the same three results (equity snapshots, head-count, holdings) + the apiKeys fetch instead of duplicating them, and avoids the original plan's suggestion to duplicate getUserApiKeys across branches."
  - "EquityCurve normalises snapshot USD values to cumulative-wealth multipliers (value_usd[i] / value_usd[0]) so the chart axis stays percent-of-inception and aligns with the strategies-path composite semantics. DrawdownChart computes drawdown directly from running-peak over the raw USD series since snapshot values are already cumulative."
  - "The pre-existing gdpr-export-coverage-hook test failure (allocator_equity_snapshots missing from USER_EXPORT_TABLES — inherited from 07-01) is left unfixed per scope boundary. Re-confirmed still failing from a stash-ed clean tree; logged as a 07-03 re-affirmation in .planning/phases/07-demo-mode-purge/deferred-items.md alongside the original 07-06 discovery."

patterns-established:
  - "Parallel-prop widget extension — optional prop that overrides the default data-path compute, including empty array as an explicit-override signal distinct from undefined fallback. Reusable for any future widget whose data source pivots between Phase 07 snapshot pipeline and the Phase 09 strategies path."
  - "derivePhase07Fields helper collocated with the dashboard query — keeps the !portfolio and portfolio-exists branches returning a consistent Phase 07 shape and avoids the drift risk of parallel per-branch derivations."

requirements-completed: [PURGE-02, PURGE-03]

# Metrics
duration: ~25min
completed: 2026-04-20
---

# Phase 07 Plan 03: getMyAllocationDashboard Phase 07 Rewire Summary

**Ships the dashboard query rewire — `MyAllocationDashboardPayload` gains 9 Phase 07 fields, the `!portfolio` early-return no longer skips equity, the `equitySnapshotsToDailyPoints` adapter (f7) bridges snapshots to chart widgets, `KpiStrip` renders default + venue-specific warm-up copy (f9), and `EquityCurve`/`DrawdownChart` adopt the optional `equityDailyPoints` parallel prop with snapshot-USD normalisation.**

## Performance

- **Duration:** ~25 min
- **Tasks:** 4 (all completed)
- **Files created:** 3 test files (adapter + KpiStrip warm-up + equity-chart parallel-prop)
- **Files modified:** 7 source + test files

## Accomplishments

- **Adapter layer landed (f7):** `equitySnapshotsToDailyPoints` converts `{asof, value_usd}[]` into `DailyPoint[]` with forward-fill gap handling. 6 RED-gated test cases cover happy, gap-forward-fill (2026-01-01→2026-01-05 with fill days 02/03/04 carrying value=100), warm-up, empty, single, and unsorted inputs.
- **Server query rewire:** `getMyAllocationDashboard` extracts the Phase 07 fetches (`allocator_equity_snapshots` rows + head-count + `allocator_holdings`) into a top-level `Promise.all` that runs BEFORE the portfolio-exists check. The `!portfolio` branch now spreads the full Phase 07 shape so fresh allocators with api_keys + snapshots see real equity (Phase 07 SC3). The main-branch `Promise.all` stopped duplicating `getUserApiKeys` — it reuses the first-round result.
- **Warm-up gate + venue-specific copy (f9):** `KpiStrip` accepts four new optional props (`snapshotCount`, `allKeysStale`, `minHistoryDepthMonths`, `activeVenues`) with sensible defaults so existing callers remain source-compatible. Per-cell helper renders only on null KPIs. Inclusive-of-3 boundary correctly fires venue-specific copy for OKX at its 3-month terminus.
- **Parallel-prop chart widgets (f7):** Both `EquityCurve` and `DrawdownChart` accept optional `equityDailyPoints`. Strategies-derived fallback preserved for Bridge allocators (Phase 09). Empty-array `[]` treated as explicit-override signal distinct from `undefined` fallback.
- **formatPercent regression guards (f8):** 3 new tests pin `formatPercent(null)` and `formatPercent(undefined)` to em-dash U+2014. `src/lib/utils.ts` was NOT modified — verified by git diff against baseline.
- **No existing test regression:** 1410 Vitest assertions GREEN across the full `src/` tree (up from 1394 pre-plan). Single pre-existing `gdpr-export-coverage-hook` failure persists (inherited from 07-01 migration 070, out of scope per deferred-items.md).

## Task Commits

Each task was committed atomically on branch `phase-07-demo-mode-purge`:

1. **Task 1: equitySnapshotsToDailyPoints adapter (f7)** — `ae34d68` (feat)
2. **Task 2: getMyAllocationDashboard Phase 07 rewire + 10 new tests** — `ad9d423` (feat)
3. **Task 3: KpiStrip warm-up + venue-specific copy + formatPercent regression (f8/f9)** — `abf4f17` (feat)
4. **Task 4: Parallel-prop equityDailyPoints on EquityCurve + DrawdownChart (f7)** — `5e4cc38` (feat)

## New Payload Shape (verbatim from src/lib/queries.ts)

```typescript
// Phase 07 / 07-03 extensions (VOICES-ACCEPTED f7 + f9)
equitySnapshots: Array<{
  asof: string;
  value_usd: number;
  breakdown: Record<string, number> | null;
  source: "exchange_primary" | "coingecko_fallback" | "mixed";
  history_depth_months: number | null;
}>;
holdingsSummary: Array<{
  symbol: string;
  quantity: number;
  mark_price_usd: number | null;
  value_usd: number;
  venue: string;
  holding_type: "spot" | "derivative";
}>;
snapshotCount: number;
allKeysStale: boolean;
lastSyncAt: string | null;
hasSyncing: boolean;
equityDailyPoints: DailyPoint[];
minHistoryDepthMonths: number | null;
activeVenues: string[];
```

## Adapter Contract (verbatim JSDoc + signature)

```typescript
/**
 * Convert per-allocator equity snapshots into the DailyPoint[] shape
 * consumed by the chart widgets (EquityCurve / DrawdownChart) via the
 * Phase 07 parallel-prop path.
 *
 * Phase 07 / VOICES-ACCEPTED f7. Mid-series gaps are forward-filled with
 * the previous day's `value_usd` (naive but safe for Phase 07 MVP — the
 * 05:00 UTC daily-refresh cron makes multi-day gaps rare in practice).
 *
 * TODO(phase-07+): Revisit to emit explicit "no-data" markers for gaps
 * longer than a threshold so the chart can break the line instead of
 * silently forward-filling. Tracked under PURGE-02 follow-ups.
 *
 * Behaviour:
 *   - Happy path: each snapshot → one DailyPoint { date, value }.
 *   - Mid-series gap: forward-fill every missing day between two
 *     snapshots with the earlier snapshot's value_usd. The later
 *     snapshot's value lands on its own asof.
 *   - Warm-up: `snapshots.length < 30` → return whatever's available.
 *     The KPI warm-up gate in KpiStrip handles the "not enough data"
 *     render; the adapter does not pad.
 *   - Empty / single / unsorted inputs are handled defensively.
 */
export function equitySnapshotsToDailyPoints(
  snapshots: Array<{ asof: string; value_usd: number }>,
): DailyPoint[]
```

## Test Count Delta

| File | New `it(...)` blocks |
|------|----------------------|
| `src/lib/allocation-helpers.equity-adapter.test.ts` | 6 (new file) |
| `src/lib/queries.my-allocation.test.ts` | +10 (total now 27; mock-builder + 10 Phase 07 tests) |
| `src/lib/utils.test.ts` | +3 (f8 regression guards) |
| `src/app/(dashboard)/allocations/components/KpiStrip.warmup.test.tsx` | 7 (new file) |
| `src/app/(dashboard)/allocations/widgets/performance/equity-curve.equitydailypoints.test.tsx` | 6 (new file) |
| **Total new `it(...)` blocks** | **32** |

## Full-Suite Vitest Pass Count

```
Test Files  141 passed | 3 skipped | 1 failed (145)
Tests       1410 passed | 65 skipped | 1 failed (1476)
```

The 1 failure is `src/__tests__/gdpr-export-coverage-hook.test.ts` (`allocator_equity_snapshots` missing from `USER_EXPORT_TABLES`) — pre-existing since migration 070 landed in 07-01; confirmed pre-existing via `git stash` and documented in `.planning/phases/07-demo-mode-purge/deferred-items.md` (both at 07-06 discovery time and re-affirmed at 07-03). Out of this plan's scope boundary.

## f8 Compliance Evidence

- `src/lib/utils.ts` was NOT modified by this plan. Verified: `git log --oneline src/lib/utils.ts` returns the same pre-Phase-07 commit as head; the literal guard `if (value == null) return "—"` is present at line 8 and passes the acceptance `grep`.
- Regression test file `src/lib/utils.test.ts` added 3 new lines of `it(...)` blocks (17 lines total including blank lines + comment) that pin the em-dash output to character code 0x2014 for `null` and `undefined` inputs.

## Example Rendered Warm-up Copy (per venue case)

| Case | Inputs | Rendered copy |
|------|--------|---------------|
| Default (no venue context) | snapshotCount=10, minHistoryDepthMonths=null, activeVenues=[] | `Warming up — need 20 more days of synced data.` |
| Binance-only (24-month retention) | snapshotCount=10, minHistoryDepthMonths=24, activeVenues=['Binance'] | `Warming up — need 20 more days of synced data.` |
| Bybit-only (24-month retention) | snapshotCount=10, minHistoryDepthMonths=24, activeVenues=['Bybit'] | `Warming up — need 20 more days of synced data.` |
| OKX-only (3-month terminus) | snapshotCount=10, minHistoryDepthMonths=3, activeVenues=['OKX'] | `Only 3 months of history available on OKX` |
| Mixed Binance + OKX (min=3) | snapshotCount=5, minHistoryDepthMonths=3, activeVenues=['Binance','OKX'] | `Only 3 months of history available on Binance, OKX` |
| Stale (any count, allKeysStale=true) | allKeysStale=true, cagr=null | `—` (no sub-line — 07-05 WarningBanner carries stale copy page-level) |

## Decisions Made

### Inclusive 3-month venue boundary

The plan's `must_haves` described the venue-specific trigger as `minHistoryDepthMonths < 3`, but the plan's own Test-E and Test-F specs explicitly feed `minHistoryDepthMonths=3` and expect the venue-specific copy. OKX's trade-history cap IS 3 months — an allocator sitting AT the boundary needs the venue-specific explanation, not the generic countdown. Implemented `<= 3` boundary; tests are the authoritative spec.

### Shared derivePhase07Fields helper + top-level parallel fetches

Rather than duplicate the snapshot/count/holdings query + the derivation code across `!portfolio` and portfolio-exists branches (per the plan's literal suggestion), both branches now consume a shared `derivePhase07Fields()` helper fed by a single top-level `Promise.all` that runs before the portfolio-exists check. Removes drift risk and a wasted duplicate `getUserApiKeys` fetch inside the main branch.

### EquityCurve USD-to-wealth normalisation

Snapshot `value_usd` is absolute USD (e.g. $10,000 → $11,000), not a cumulative wealth multiplier (1.0 → 1.10). The chart's composite axis is percent-of-inception to match the existing strategies-derived semantics; the adapter now divides by the first snapshot's value before feeding the chart so the axis stays visually aligned when an allocator switches from pure-equity to mixed-strategy views (post-Phase-09).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 — Bug] Inclusive 3-month venue boundary**
- **Found during:** Task 3 (KpiStrip warm-up)
- **Issue:** Plan's must_haves said `minHistoryDepthMonths < 3` but Test E + Test F feed `minHistoryDepthMonths=3` and expect venue-specific copy. Strict-less-than would fail both tests and misfire the UX for OKX-only allocators (OKX IS capped at 3 months — the venue-specific copy exists precisely for that case).
- **Fix:** Implemented as `<= 3` with an inline comment explaining why. Matches the plan's own test spec (which is authoritative).
- **Files modified:** src/app/(dashboard)/allocations/components/KpiStrip.tsx
- **Committed in:** `abf4f17`

**2. [Rule 3 — Blocking] Removed duplicate getUserApiKeys call in main branch**
- **Found during:** Task 2 (dashboard rewire)
- **Issue:** The plan suggested adding the Phase 07 parallel fetches to the existing main-branch Promise.all. But `getUserApiKeys(userId)` was already needed BEFORE the portfolio-exists check (so the `!portfolio` branch can compute `allKeysStale` / `hasSyncing` / `activeVenues`). Keeping the main-branch call too would fire a duplicate RLS-guarded query per request.
- **Fix:** Moved Phase 07 fetches AND `getUserApiKeys` into a top-level `Promise.all` that runs before the portfolio-exists check. Removed the duplicate `getUserApiKeys` line from the main-branch Promise.all; reused the top-level result.
- **Files modified:** src/lib/queries.ts
- **Committed in:** `ad9d423`

**Total deviations:** 2 (both auto-fixed in their owning task commits).

## Threat surface handled

| Threat ID | Status | Code-level mitigation |
|-----------|--------|-----------------------|
| T-07-10 (cache leak across allocators) | mitigated | `getMyAllocationDashboard` wrapped in React `cache()` — per-request scope only; no process-wide memoisation. |
| T-07-11 (stale displayed as fresh) | mitigated | `allKeysStale` gate computed server-side; KpiStrip renders `—` when true. 07-05 adds the page-level WarningBanner (separate plan). |
| T-07-12 (tampered lastSyncAt) | accept | `apiKeys` comes from `getUserApiKeys(userId)` which is RLS-scoped to the caller's own session; shape is trusted within this trust zone. |
| T-07-13 (forward-fill masks missing data) | accept | Forward-fill is explicit per VOICES-ACCEPTED f7; JSDoc carries the TODO. Warm-up KPI gate (`snapshotCount < 30`) is the authoritative "not enough data" signal. |

No new threat surface introduced — `allocator_equity_snapshots` + `allocator_holdings` reads run through the user-scoped client and honour the owner-only RLS policies established by 07-01 + Phase 06.

## Issues Encountered

- **Inclusive 3-month boundary** (documented above as Deviation 1). Plan prose vs plan test spec contradicted; tests won.
- **No other issues.** Typecheck clean (`npx tsc --noEmit`), full Vitest suite GREEN on everything this plan touches, no Phase 5/9 regressions.

## User Setup Required

None. All changes are in the Next.js server-component + client-component layer; no new env vars, no new migrations, no new worker config.

## Next Phase Readiness

- **07-04 (Tabbed layout):** Unblocked. `AllocationsTabs` can now consume the 9 new payload fields; `AllocationDashboard.widget-gating.test.tsx` (per f2) can gate the 20+ strategy-composite widgets on `data.strategies.length > 0` and rely on the KPI/Equity/Drawdown/Insight core rendering from the new Phase 07 inputs.
- **07-05 (Empty state + WarningBanner):** Unblocked. `allKeysStale` + `hasSyncing` + `activeVenues` feed the stale banner; `snapshotCount` drives the warm-up banner; `minHistoryDepthMonths` + `activeVenues` let the banner mention the specific venue under 3-month terminus when relevant.
- **Phase 09 (Bridge Live):** Unchanged contract. `strategies`, `portfolio`, and `analytics` fields are preserved verbatim on the payload; the new Phase 07 fields land alongside them.

### Deferred items

- Pre-existing `gdpr-export-coverage-hook` failure — `allocator_equity_snapshots` missing from `USER_EXPORT_TABLES` since 07-01 migration 070 landed. Logged in `.planning/phases/07-demo-mode-purge/deferred-items.md` with 07-03 re-confirmation. One-line fix; deferred until a dedicated follow-up that can properly verify the GDPR export route actually emits the table's rows.

## Self-Check: PASSED

- FOUND: src/lib/allocation-helpers.ts (adapter + JSDoc)
- FOUND: src/lib/allocation-helpers.equity-adapter.test.ts (6 tests GREEN)
- FOUND: src/lib/queries.ts (9 new payload fields, derivePhase07Fields helper, !portfolio branch rewritten)
- FOUND: src/lib/queries.my-allocation.test.ts (27 tests, 10 new GREEN)
- FOUND: src/lib/utils.test.ts (3 new f8 regression tests GREEN; src/lib/utils.ts UNMODIFIED)
- FOUND: src/app/(dashboard)/allocations/components/KpiStrip.tsx (4 new props + warmupCopy helper + per-cell render)
- FOUND: src/app/(dashboard)/allocations/components/KpiStrip.warmup.test.tsx (7 tests GREEN)
- FOUND: src/app/(dashboard)/allocations/widgets/performance/EquityCurve.tsx (equityDailyPoints prop + USD normalisation)
- FOUND: src/app/(dashboard)/allocations/widgets/performance/DrawdownChart.tsx (equityDailyPoints prop + running-peak drawdown)
- FOUND: src/app/(dashboard)/allocations/widgets/performance/equity-curve.equitydailypoints.test.tsx (6 tests GREEN)
- FOUND commit: ae34d68 (feat — Task 1 adapter)
- FOUND commit: ad9d423 (feat — Task 2 dashboard rewire)
- FOUND commit: abf4f17 (feat — Task 3 KpiStrip + formatPercent guards)
- FOUND commit: 5e4cc38 (feat — Task 4 parallel-prop charts)

---
*Phase: 07-demo-mode-purge*
*Completed: 2026-04-20*
