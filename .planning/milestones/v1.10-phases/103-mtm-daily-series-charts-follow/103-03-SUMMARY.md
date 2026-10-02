---
phase: 103-mtm-daily-series-charts-follow
plan: 03
subsystem: factsheet-read-path
tags: [typescript, nextjs, mtm, dailies-canonical, per-basis-bundle, SC-4, factsheet, rsc, MTM-04]

# Dependency graph
requires:
  - phase: 103-01
    provides: services/basis_series.py persist_basis_series (writes the mtm_daily_returns row this plan reads)
  - phase: 103-02
    provides: both derive sites persist the mtm_daily_returns series via the shared helper
provides:
  - parseMtmSeriesPayload + readMtmSeries — the shared, defensive server-side reader for the persisted MTM series (both surfaces + both arms)
  - deriveSeriesBundle — the ONE per-basis series derivation cash and MTM both call; buildFactsheetPayload emits payload.seriesByBasis.mark_to_market (own axis + own mask + every dailies-derivable panel)
  - both factsheet surfaces (route + discovery detail) thread the MTM series through one owner, gated identically to the scalar MTM object
affects: [103-04 (client charts pick the active-basis bundle via useBasis + view-merge; removes the cash-only chart caption)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "ONE per-basis derivation (deriveSeriesBundle) — cash + MTM share it; SC-4 whole-payload snapshot pins the factoring is byte-neutral for cash"
    - "Additive-only bundle: cash stays top-level, seriesByBasis is optional-absent → undefined dropped from the serialized blob → cash byte-identical (SC-4)"
    - "EXTERNAL-DATA panels (correlations/correlationMatrix) + strategyMetrics stay cash top-level; the client view-merge {...payload, ...bundle} passes them through as cash by construction — zero per-panel basis branching"
    - "Series read behind the SAME service-role deny-all-RLS + F-4 DONE gate as the scalar MTM object — no visibility widening; shared shouldReadSingleKeyMtmSeries predicate keeps the hot non-options path roundtrip-free"

key-files:
  created:
    - src/lib/factsheet/build-payload.test.ts
    - src/lib/factsheet/__snapshots__/build-payload.test.ts.snap
    - .planning/phases/103-mtm-daily-series-charts-follow/103-03-SUMMARY.md
  modified:
    - src/lib/types.ts
    - src/lib/factsheet/types.ts
    - src/lib/factsheet/build-payload.ts
    - src/lib/factsheet/composite-read-path.ts
    - src/lib/factsheet/composite-read-path.test.ts
    - src/lib/metrics-parity-helper.ts
    - src/app/factsheet/[id]/v2/page.tsx
    - src/app/(dashboard)/discovery/[slug]/[strategyId]/page.tsx

key-decisions:
  - "SC-4 pin uses a committed vitest .snap (whole-payload JSON.stringify) captured PRE-refactor over the EXPANDED panel set (single-key geometric / composite arithmetic-with-overlay+markers / ingestSource:api). The plan said 'inline snapshot'; an external .snap is the correct tool for a ~30KB payload and equally byte-exact + committed. It is the repo's first .snap (codebase had none) — deterministic here (seeded bootstrap + fixed benchmarks)."
  - "Comparator ann_vol is PASSED into deriveSeriesBundle for cash (the overlaid strategyMetrics.ann_vol) so the comparator volMatched stays byte-identical to the persisted cash overlay; MTM omits it → the comparator uses the MTM series' own computed vol (honest MTM). Neuter-confirmed load-bearing."
  - "mtm_daily_returns kind pinned as a single TS constant (MTM_DAILY_RETURNS_SERIES_KIND) cross-linking the Python KIND_MTM_DAILY_RETURNS; stale types.ts comment fixed (12→13 kinds; documents the direct service-role read vs the RPC-panel kinds)."
  - "New direct-read kind excluded from the 12-RPC-panel SIBLING_KINDS exhaustiveness in metrics-parity-helper.ts (Rule 3 blocking fix) — preserves the Python len(sibling)==12 invariant."

requirements-completed: [MTM-04]

# Metrics
duration: ~95min
completed: 2026-07-12
---

# Phase 103 Plan 03: Per-basis payload bundle (dailies-derivable stats) Summary

**`buildFactsheetPayload` now emits `payload.seriesByBasis.mark_to_market` — a full per-basis series bundle (own date axis + own gap mask + EVERY dailies-derivable panel) derived by the SAME internal `deriveSeriesBundle` as cash, read from the persisted `mtm_daily_returns` row through ONE shared defensive reader threaded into both factsheet surfaces (route + discovery) on both arms (single-key + composite), with a whole-payload SC-4 snapshot proving the cash payload is byte-identical over the expanded panel set.**

## Performance
- **Duration:** ~95 min
- **Tasks:** 3 (contract/reader → deriveSeriesBundle+emission → read-path threading)
- **Commits:** 3 feat commits
- **Files:** 8 modified + 2 created (test + snapshot)

## Task Commits
1. **Task 1 (contract + reader):** `d9b57b8d` feat(103-03): MTM series contract — types, defensive parser, shared reader
2. **Task 2 (bundle + SC-4):** `58a62e46` feat(103-03): deriveSeriesBundle factoring + seriesByBasis emission (SC-4 pinned)
3. **Task 3 (read-path threading):** `f6e09410` feat(103-03): thread readMtmSeries on both single-key surfaces (one gate)

## Full bundle field list (BasisSeriesBundle)
`dates`, `strategyReturns`, `strategyEquity`, `strategyDrawdowns`, `strategyRollingVol/Sharpe/Sortino`, `rollingWindow`, `rollingBetaWindow`, `strategyWorst10`, `comparators` (btc/spx/none), `monthlyReturns`, `dailyHeatmap`, `missingSegments`, `quantiles`, `streaks`, `calmarByYear`, `bootstrapCI`, `styleDrift`, `stressWindows`.

## Panel classification (recorded per plan)
- **DAILIES-DERIVABLE → IN the bundle** (pure function of the strategy's OWN daily series, recomputed per basis): the 3 chart tracks + rolling + worst-10 + the 2 heatmaps + **quantiles, streaks, calmarByYear, bootstrapCI, styleDrift**. `comparators` are IN the bundle purely so the MTM axis and the comparator arrays share ONE coherent date axis (Pitfall-1), not as a statistics panel.
- **MIXED → IN the bundle (stressWindows):** its strategy columns follow MTM (recomputed from the MTM stratRet); its BTC-benchmark column is basis-invariant BY CONSTRUCTION (the same BTC series aligned to the MTM date axis — no new math, not "cash held for honesty"). Neuter-confirmed the strat column differs from cash under a distinct-MTM fixture.
- **EXTERNAL-DATA → STAY CASH, NOT in the bundle:** `correlations`, `correlationMatrix` (need BTC/ETH/SPX/Gold/IEF series with no MTM equivalent). Also cash-only top-level: `strategyMetrics` (the KpiStrip's persisted-scalar overlay owns MTM there, Phase 102) and `segmentBoundaries` (composite key handoffs, basis-invariant).

## The pass-through-as-cash elegance (exploited by 103-04)
Because `correlations`/`correlationMatrix`/`strategyMetrics` are NOT in the bundle, the client view-merge `{...payload, ...bundle}` (Plan 04) yields MTM for bundle fields + cash for external fields with **ZERO per-panel branching**, and honest labeling holds by construction (the external panels physically carry cash values). No statistics panel carries a basis eyebrow today (grep clean) — 103-04 must simply not add one to the external panels.

## SC-4 cash byte-identity (keystone)
- Whole-payload `JSON.stringify` snapshot captured from the PRE-refactor code, asserted byte-identical AFTER the `deriveSeriesBundle` factoring, over the EXPANDED panel set (quantiles/streaks/calmarByYear/bootstrapCI/styleDrift/stressWindows/correlations/correlationMatrix). **Three arms** pinned: single-key geometric, composite arithmetic (with `metricsByBasis.cash_settlement` overlay + segment/gap markers), AND `ingestSource:"api"` (synthesized peer/allocator/signature panels — the plan-check SC-4 coverage warning). Verified with `CI=true` (no snapshot rewrite could mask a mismatch). `payload.seriesByBasis === undefined` when `opts.mtmSeries` absent; cash top-level fields byte-match whether the bundle is present or absent (additive-only).
- Honest-absent days stay absent (never 0.0): the sparse persisted series + the persisted Python-derived `gap_spans` (via `deriveSegmentMarkers`) are the ONLY mask; no client re-derivation, no interior gaps invented.

## Neuter-confirmations (performed, not merely claimed)
- **Structural F-4 gate:** removing the `available &&` guard on the mtmSeries spread in `singleKeyBasisOpts` → the "non-DONE status NEVER threads the MTM series" test RED. Restored → green.
- **SC-4 overlay pin load-bearing:** dropping `comparatorAnnVol: strategyMetrics.ann_vol` (letting cash use the series-computed vol) → the composite-arithmetic SC-4 snapshot RED (the comparator volMatched shifts). Restored → green.
- **Bundle follows the MTM basis:** deriving the MTM bundle from the CASH series → both the "own dates axis" emission test AND the "quantiles/calmar/streaks/styleDrift/stressWindows differ from cash" falsifiable test RED. Restored → green.

## Verification
- `CI=true npx vitest run src/lib/factsheet src/app/factsheet` → **424 passed** (40 files). Full `src/lib/factsheet` → **233 passed** (18 files). `composite-read-path.test.ts` → **56 passed**.
- `npx tsc --noEmit` clean; `npm run lint` (eslint) clean on all touched files (no react-hooks exhaustive-deps errors — server components, no hooks).
- Coverage (scoped): `build-payload.ts` 94.6/88.4/100/97.9 (stmts/branch/funcs/lines); scoped All-files 96.4/93.5/100/98.2 — well above the ratchet (82/80/74/72). Ratchet holds.
- grep gates: `seriesByBasis` in `types.ts` + `build-payload.ts`; the `mtm_daily_returns` kind reaches `composite-read-path.ts` via the pinned `MTM_DAILY_RETURNS_SERIES_KIND` constant + `src/lib/types.ts`.

## Deviations from Plan
- **[Rule 3 — Blocking] metrics-parity-helper.ts exhaustiveness.** Adding `mtm_daily_returns` to `StrategyAnalyticsSeriesKind` tripped the compile-time `_MissingSiblingKind extends never` tripwire (it pins the union to the 12 RPC-panel siblings that Python's `len(sibling)==12` counts). Fixed by excluding the direct-read kind from that exhaustiveness with a documented comment (mirrors how `equity_series_1y` is excluded by absence). No behavior change; preserves the Python invariant. Commit `d9b57b8d`.
- **SC-4 snapshot mechanism:** used a committed external `.snap` (vitest `toMatchSnapshot`) rather than a literal inline snapshot — the byte-pin intent is identical and it is the correct tool for a large payload; documented in key-decisions.
- Otherwise the plan executed as written (Rules 1/2/4 not triggered).

## Flagged for 103-04 / red team
- **Client view-merge (103-04):** merge the active-basis bundle over the cash top-level; do NOT add a basis eyebrow/label to the EXTERNAL panels (correlations/correlationMatrix) — they physically carry cash values, so honest labeling holds only if 103-04 leaves them uncaptioned. Remove the cash-only chart caption (`FactsheetView.tsx:473-474`) now that charts follow.
- **Ship-time backfill (unchanged gate, from 103-02):** existing options strategies (Zavara) have NO `mtm_daily_returns` row until a post-deploy re-derive backfill runs — `seriesByBasis` will be absent and 103-04 must fall back to cash charts with the honest caption until the backfill lands. The `${id}::${computedAt}` cache key invalidates naturally on re-derive (no cache-key bump).
- **First .snap in the repo:** the codebase had zero committed snapshot files. CI runs vitest sharded — the `.snap` is deterministic (seeded bootstrap + committed benchmark JSON). If a benchmark JSON is ever regenerated, the SC-4 snapshot would need a reviewed `-u`. Red team may want to confirm the snapshot is committed and not gitignored (verified: `git check-ignore` exit 1).
- **Threat surface:** no new endpoints/auth/schema — the series rides the SAME published/owner + deny-all-RLS gate as the scalar MTM object (T-103-06 mitigated); untrusted JSONB is strict-coerced (`parseMtmSeriesPayload`, T-103-05). No new threat flags.

## Self-Check: PASSED
- Files verified on disk: all 8 modified + `build-payload.test.ts` + `__snapshots__/build-payload.test.ts.snap` present.
- Commits verified in `git log`: `d9b57b8d`, `58a62e46`, `f6e09410` — all present on `gsd/v1.10-portfolio-intelligence-options-mtm`.
- `.planning/` artifacts correctly gitignored/local — never staged (per instructions + MEMORY).

---
*Phase: 103-mtm-daily-series-charts-follow*
*Completed: 2026-07-12*
