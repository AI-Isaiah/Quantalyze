---
phase: 252-deribitoptions-a-deribit-options-strategy-s-published-figure
plan: 10
subsystem: factsheet-read-path
tags: [composite, smoothed_mtm, headline-promotion, deribit-options, fail-safe, census]
status: complete
gap_closure: true
requires:
  - phase: 252
    provides: plan 09's promoted row (marker headline_basis, no mtm_gated_reason, both bases stored) and the wave-1 named withhold
provides:
  - "HEADLINE_BASIS_FLAG, HEADLINE_BASIS_SMOOTHED and the strict, reason-loses-never isSmoothedHeadlineRow in headline-basis.ts"
  - "FactsheetCommon.headlineBasis and BuildFactsheetOpts.headlineBasis (present-only)"
  - "BasisProvider initialBasis; the smoothed segment renders for a promoted row with the UI flag off"
  - "census arms 1b (promoted row agrees on every seam) and 2b (marker pinned across Python and TS)"
  - "payload cache key factsheet-v2-payload-v30"
affects: [post-deploy owner check, G252-MTM-PROMOTION closure]
plan_head_before: 7fbbf0c94c92d2e78db68f7ea9f6f86dd3136de4
plan_head_after: 7cc7e7a7b9a1585c7b77b8341ef0c79164de5198
actuals:
  tokens: 7800     # chars/4 over the added lines of the realized src diff (31322 chars)
  tasks: 3
  commits: 3       # MEASURED: git rev-list --count plan_head_before..plan_head_after (code commits; the SUMMARY docs commit follows)
tech-stack:
  added: []
  patterns:
    - "one predicate owns the promoted-row trigger; no other production file compares the marker"
    - "initial basis and segment condition read the same native payload object"
key-files:
  created: []
  modified:
    - src/lib/factsheet/headline-basis.ts
    - src/lib/factsheet/composite-read-path.ts
    - src/lib/factsheet/build-payload.ts
    - src/lib/factsheet/types.ts
    - src/lib/factsheet/composite-read-path.headline-basis.test.ts
    - src/app/factsheet/[id]/v2/basis-context.tsx
    - src/app/factsheet/[id]/v2/FactsheetView.tsx
    - src/lib/closed-sets.ts
    - src/app/factsheet/[id]/v2/FactsheetBody.smoothed-killswitch.test.tsx
    - src/__tests__/options-cash-wallet-withhold.census.test.ts
    - src/app/factsheet/[id]/v2/page.tsx
    - src/lib/factsheet/fetch-and-build-payload.ts
    - src/app/factsheet/[id]/v2/page.public-cache-key.test.tsx
    - src/app/factsheet-share/[token]/page.cache-isolation.test.tsx
key-decisions:
  - "The reason always wins over the marker: isSmoothedHeadlineRow returns false whenever isOptionsCashWalletBook is true"
  - "The predicate is NOT folded into headlineVerdict: the OG card and single-key arm call it on the top-level headline, which on a promoted row is the smoothed result"
---

# Phase 252 Plan 10: Promoted-headline surfaces (read-path half) Summary

A promoted composite's factsheet now opens on the "Smoothed mark-to-market" basis with the smoothed figures in the headline strip while `NEXT_PUBLIC_SMOOTHED_MTM_ENABLED` is off, its "Cash settlement" basis stays withheld with the wave-1 options-book sentence, and a census arm proves the list, record, constituent, verdict and card seams show the stored smoothed figures with no edit to them.

## What was built

- `headline-basis.ts`: `HEADLINE_BASIS_FLAG = "headline_basis"`, `HEADLINE_BASIS_SMOOTHED = "smoothed_mtm"`, `isSmoothedHeadlineRow(dqf)` (record-or-null guard, strict `===`, false whenever `isOptionsCashWalletBook(dqf)`). Docblock cites the 2026-11-25 ruling, plan 09, and why it is not folded into `headlineVerdict`.
- `composite-read-path.ts`: `applyHeadlineBasis` gains a first branch (composite arm only): a promoted row's stored CASH headline is returned as a redacted copy (every `BASIS_KPI_MAP` server key null) with quality exactly `{ headlineWithheld: true, headlineWithheldCause: "options_cash_wallet" }`. `readCompositeFactsheet` widens its `dqf` type with `headline_basis?: unknown` and sets `buildOpts.headlineBasis` (present-only) iff `isSmoothedHeadlineRow(dqf) && smoothedAvailable`. `mtmGate.reason` stays the raw `dqf.mtm_gated_reason` read.
- `types.ts` / `build-payload.ts`: `FactsheetCommon.headlineBasis?: "smoothed_mtm"` and `BuildFactsheetOpts.headlineBasis`, copied into the payload by present-only spread beside `smoothedGate`.
- `basis-context.tsx`: `BasisProvider` takes `initialBasis?: Basis` (default `"cash_settlement"`), a seed for `useState`, docblock updated.
- `FactsheetView.tsx`: the one `<BasisProvider>` mount passes `initialBasis={payload.headlineBasis ?? "cash_settlement"}`; the smoothed segment condition is `SMOOTHED_MTM_UI_ENABLED || gatePayload.headlineBasis === HEADLINE_BASIS_SMOOTHED`; Phase 134 comment rewritten.
- `closed-sets.ts`: `SMOOTHED_MTM_UI_ENABLED` docblock only.
- Census: arm 2b (marker pair parsed from `stitch_composite.py`, typed literals, planted-text anti-vacuity) and arm 1b (promoted row through every seam, marker-plus-reason fail-safe, five untrusted marker values, non-object blobs).
- Cache: `factsheet-v2-payload-v29` to `-v30` in `page.tsx` (dated bump comment), the `fetch-and-build-payload.ts` docblock quote and both pins.

## Task commits

| Task | Commit | Content |
|------|--------|---------|
| 1 (tracer) | `39f97ba26` | predicate, applyHeadlineBasis branch, readCompositeFactsheet opts, payload field, cases (a) to (e) |
| 2 | `013cfd225` | initialBasis, segment condition, docblocks, five factsheet cases |
| 3 | `7cc7e7a7b` | census arms 2b and 1b, cache key v30 |

## Verification results

- Task 1 verify command (5 files): `Test Files 5 passed (5)`, `Tests 356 passed (356)`.
- Task 2 verify command (5 files): `Test Files 5 passed (5)`, `Tests 195 passed (195)`.
- Task 3 verify command (the vitest part, directory runs included): `Test Files 1 failed | 225 passed (226)`, `Tests 2 failed | 4269 passed (4271)`. The two failures are the known local-only ones: `src/lib/factsheet/compute.conventions.test.ts` fixture B and fixture C (Node 25 float, a `skew` last-digit snapshot mismatch). The base showing them red is recorded in `252-VERIFICATION.md`; I did not re-run the base. `RiskTabPanel.book-series.test.tsx` is not under any directory in this command and did not run.
- `npm run typecheck`: exit 0. `npm run lint`: exit 0. `node scripts/verify-plan-anchors.mjs --pending`: exit 0 (`claims: 33 checked`, `OK: 9 plan file(s), no stale claims.`).

## Acceptance greps

The plan cites base `57229df98`; this worktree's base is `33d4cf863` (as in plan 09), so the diff gates were taken against `33d4cf863`. The queries/og-metrics diff gate was also run against `57229df98` and printed nothing.

| Check | Expected | Got |
|---|---|---|
| `export const HEADLINE_BASIS_FLAG = "headline_basis"` in headline-basis.ts | 1 | 1 |
| `export const HEADLINE_BASIS_SMOOTHED = "smoothed_mtm"` in headline-basis.ts | 1 | 1 |
| production files other than headline-basis.ts containing `"headline_basis"` | 0 | 0 |
| `initialBasis` in basis-context.tsx | >=2 | 3 |
| non-comment `HEADLINE_BASIS_SMOOTHED` lines in FactsheetView.tsx | >=1 | 2 (import and the condition) |
| files still containing `"factsheet-v2-payload-v29"` | 0 | 0 |
| `"factsheet-v2-payload-v30"` in page.tsx | 1 | 1 |
| edits to queries.ts, figure-record-scalars.ts, Compare page, og-metrics.ts, OG route | 0 | 0 |
| analytics-service or supabase files outside plan 09's scope | 0 | 0 |

## PROOF-01 outputs (verbatim)

Every neuter was a byte copy taken first into the session scratchpad, restored by `cp`, with `cmp` exit 0, and a GREEN run after. Never git checkout, restore or stash.

Task 1, reason wins (dropped the `isOptionsCashWalletBook` conjunct from `isSmoothedHeadlineRow`; file `composite-read-path.headline-basis.test.ts`):

```
=== NEUTER reason wins: drop !isOptionsCashWalletBook conjunct
     × (b) the reason wins: a row carrying the marker AND the options-book reason is withheld as at wave 1 25ms
 FAIL  src/lib/factsheet/composite-read-path.headline-basis.test.ts > G252-MTM-PROMOTION — a promoted composite through the read path and the payload > (b) the reason wins: a row carrying the marker AND the options-book reason is withheld as at wave 1
      Tests  1 failed | 47 passed (48)
restore cmp exit 0
```

Task 1, cash withheld (deleted the new `applyHeadlineBasis` branch):

```
=== NEUTER cash withheld: delete the applyHeadlineBasis branch
     × (a) a promoted row names the smoothed headline and withholds the cash object by name 42ms
     × (c) a marker but the smoothed object is missing: cash withheld, no headlineBasis, smoothed gate closed 14ms
     × (c) a marker but the smoothed headline is not finite: cash withheld, no headlineBasis, smoothed gate closed 13ms
      Tests  3 failed | 45 passed (48)
restore cmp exit 0
```

Task 1, no basis without a smoothed object (dropped `&& smoothedAvailable`):

```
=== NEUTER no basis without smoothed object: drop && smoothedAvailable
     × (c) a marker but the smoothed object is missing: cash withheld, no headlineBasis, smoothed gate closed 18ms
     × (c) a marker but the smoothed headline is not finite: cash withheld, no headlineBasis, smoothed gate closed 14ms
      Tests  2 failed | 46 passed (48)
restore cmp exit 0
=== GREEN
      Tests  48 passed (48)
```

RED at HEAD for Task 1 (before any implementation, `-t "G252-MTM-PROMOTION"`): `Tests 3 failed | 7 passed | 38 skipped (48)`, case (a) failing on `headlineBasis` being undefined and both (c) cases on the cash object being unredacted (16361.727 not null). Case (b) is green at HEAD by design: wave 1 already withholds on the reason, and (b) pins that it stays so.

Task 2, initial basis (`<BasisProvider>` mounted without the prop; file `FactsheetBody.smoothed-killswitch.test.tsx`):

```
=== NEUTER initial basis: mount BasisProvider without the prop
     × three segments render and Smoothed mark-to-market is the active one 283ms
     × the headline strip shows the smoothed cumulative return, with no options-book sentence 285ms
      Tests  2 failed | 5 passed (7)
restore cmp exit 0
```

Task 2, segment (condition reverted to `SMOOTHED_MTM_UI_ENABLED` alone):

```
=== NEUTER segment: revert condition to SMOOTHED_MTM_UI_ENABLED alone
     × three segments render and Smoothed mark-to-market is the active one 332ms
      Tests  1 failed | 6 passed (7)
restore cmp exit 0
=== GREEN
      Tests  7 passed (7)
```

RED at HEAD for Task 2 (before the implementation): the three-segment case, the headline-strip case and the cash-view case failed (`Tests 3 failed | 4 passed (7)`); the cash-view case was then re-pointed from `getAllByText("Cum. Return")[0]` to the strip's `factsheet-kpi-value` cells and the fixture rebuilt through the real `buildFactsheetPayload`, because a hand-built scenario payload carried the client-computed cash figure the strict overlay would otherwise null.

Task 3, cross-language pin (`HEADLINE_BASIS_SMOOTHED` value changed to `"smoothed"` in `stitch_composite.py`; file `options-cash-wallet-withhold.census.test.ts`):

```
=== NEUTER cross-language pin: HEADLINE_BASIS_SMOOTHED value changed to smoothed
     × reads exactly the two producer assignments, and they equal the typed literals and the TS constants 7ms
      Tests  1 failed | 34 passed (35)
restore cmp exit 0
```

Task 3, agreement (`isOptionsCashWalletBook` also true for a row carrying the marker):

```
=== NEUTER agreement: isOptionsCashWalletBook also true for a row with the marker
     × a promoted row (marker, no reason) shows the stored figures through the verdict, shaper, record, constituent and card seams 6ms
      Tests  1 failed | 34 passed (35)
restore cmp exit 0
=== GREEN
      Tests  35 passed (35)
```

Honest gaps against the plan's wording: (1) the promoted-row seams are one `it`, so the neuter reports one failing case; its first assertion (the verdict) is the one that throws, so the list and card assertions are not separately named by a run. (2) The plan names "the three-segment case" and "the Smoothed active case" as separate cases; they are one `it` here, so both Task 2 neuters fail that one case by name.

## Reader audit

Classes: (i) basis-keyed, follows the selected basis; (ii) cash-only and still withheld on a promoted row, correct; (iii) moves with the headline (reads a top-level series or scalar); (iv) disagrees. No class (iv) reader sits on a surface the ruling names, so there is no STOP.

| Reader | Reads | Class | Notes |
|---|---|---|---|
| `MetricsColumn.tsx` `isHeadlineWithheld`, `isRangeWithheld`, `useFullHistoryWithheld` | `dataQuality.headlineWithheld` and cause, ANDed with `basis === "cash_settlement"` | (i) | Withheld only on the cash basis; on a promoted row's smoothed basis the strip and rail show figures. |
| `FactsheetView.tsx` rail, EOY bars, range, relative cells | the three functions above | (i) | Same discriminator, no edit. |
| `basis-context.tsx` window gate (`headlineWithheld !== true` term) | `dataQuality.headlineWithheld` | (i) | Keyed by the active basis through the functions above. |
| `build-payload.ts` `noWindows` branch | `headlineWithheld` | (ii) | Nulls the CASH base windows on a withheld payload. The smoothed view reads its own bundle. Known limit: with no smoothed series bundle the smoothed view's windows are dashes (the safe direction) and its charts fall back to the cash curve beneath smoothed figures, the existing "Charts show the cash-settlement series" caption state. |
| `composite-read-path.ts` `applyHeadlineBasis` (composite arm) | stored cash object | (ii) | The only place the cash object is withheld; this plan's new branch. The single-key arm never sees a promoted row. |
| `page.tsx`, `types.ts` | comments and the type | n/a | No decision. |
| `src/app/api/og/factsheet/[id]/route.tsx` | `BY_BASIS_ALIASES` for the applicability question only; prints from top-level `returns_series` and the stored scalars | (iii) | Stored top-level figures, so the card shows the smoothed figures on a promoted row. No code change. |
| `og-metrics.ts` `computeOgHeadline` | top-level stored scalars, `headlineVerdict` | (iii) | Census arm 1b: finite smoothed figures for a promoted row, NaN for marker plus reason. |
| `fetch-and-build-payload.ts`, `by-basis-projection.ts` | the `BY_BASIS_ALIASES` fragment, feeds `readCompositeFactsheet` | (i) | Source of the by-basis objects; the effective flags (live or snapshot) carry the whole blob, marker included. |
| `src/lib/factsheet/json-ld.ts` | `payload.strategyMetrics.cagr` (the cash base overlay) | (iv), known safe-direction limit | On a promoted row the cash overlay is NaN, so CAGR is omitted from the structured data. Not fixed, as the plan directs. It is not a named ruling surface. |
| `(dashboard)/strategies/page.tsx`, `finalize-rerun.ts` | mention the by-basis column in comments only | n/a | No reader. |
| `SyncPreviewStep.tsx` (wizard preview) | `metrics_json_by_basis.smoothed_mtm` availability | out of scope | CONTEXT excludes the wizard preview. |
| `compositeAttribution.ts` | only `attributionBasisFromConfig` is imported (by `composite-read-path.ts` and the wizard) | n/a | No live attribution panel prints a cash by-basis figure outside the wizard. |
| `range-dates.ts`, `factsheet-context.tsx` | the active basis | (i) | Basis-keyed. |
| `CompareEquityOverlay.tsx` | `analytics.returns_series` (top level) | (iii) | Smoothed curve on a promoted row. |
| `api/factsheet/[id]/pdf/route.ts`, `api/factsheet/[id]/tearsheet.pdf/route.ts` | select `returns_series`, `daily_returns`, `cumulative_return`, flags for a readiness check, then render the factsheet page | (iii) for the check, (i) for the page | The rendered page opens a promoted row on the smoothed basis. |
| `api/strategies/[id]/returns/route.ts` | `daily_returns`, `returns_series` of `strategy_analytics` | (iii) | Top-level series. |
| `StrategyTable.tsx`, `StrategyGrid.tsx`, `discovery-columns.ts` | `sparkline_returns`, `sparkline_drawdown`, scalar aliases | (iii) | Stored top-level values. |
| `csv_daily_returns` readers (`readCsvDailyReturns` in `composite-read-path.ts`) | the cash curve | (ii) | Feeds only the factsheet's Cash settlement view, beside withheld figures, as the ruling states. Every other `csv_daily_returns` read under `src/` is the per-key allocator axis or wizard and import paths, not a promoted composite's headline. |

New printer of the cash by-basis object: none outside the factsheet composite arm (the OG route reads it for applicability only; the wizard preview is out of scope). No STOP.

## resetView confirmation

`resetView` in `FactsheetView.tsx` calls `resetXRange()`, `setComparator(payload.activeComparator)`, dispatches `COLLAPSIBLE_OPEN_ALL_EVENT` and tracks the event. It never touches the basis, so "Reset view" leaves a promoted row on whichever basis the viewer picked, and it needed no change. Separately, the existing line that forces `setBasis("cash_settlement")` when the viewer switches Units to USD is unchanged: on a promoted row the USD view therefore lands on the withheld cash basis, with the segment still rendered (it reads the native payload's marker).

## Existing tests whose intent changed

None. No existing assertion was edited. The cache-key pins moved their literal from v29 to v30 (the plan's instruction). The census imports line was widened, with no assertion changed.

## Verify-file substitutions

None.

## Deviations from Plan

None - plan executed as written. Notes, none a deviation: the diff gates used base `33d4cf863` (this worktree's base) with the queries/og-metrics gate repeated against `57229df98`; the Task 2 fixture is built through the real `buildFactsheetPayload` rather than the file's scenario helper, for the reason given under the Task 2 RED line.

## Threat model coverage

- T-252-30 (cash artefact under "Cash settlement" on a promoted row): `applyHeadlineBasis` composite branch; Task 1 case (a), cash-withheld PROOF-01.
- T-252-31 (crafted or stale marker un-withholds a cash row): strict equality, the reason wins; case (b), case (d), census fail-safe rows, reason-wins PROOF-01.
- T-252-32 (figures under the wrong label): one native payload object drives the seed and the segment; three-segment and active cases with two neuters.
- T-252-33 (marker drift across languages): census arm 2b with its PROOF-01.
- T-252-34 (stale cached payload): key bump to v30, every pin moved, the v29 grep reads 0.

## Known Stubs

None.

## Threat Flags

None. No new endpoint, auth path or schema change; the payload gains one optional field derived from an existing stored flag.

## Post-deploy owner check (orchestrator-owned; restated for the verifier, NOT an executor task)

After plan 09's post-deploy re-stitch reads "Pass", open the owner factsheet of the evidence composite on the deployed build. Expected: the basis control shows three segments with "Smoothed mark-to-market" active and the smoothed figures in the headline strip; "Cash settlement" prints the withheld sentence with em dashes; the share card and OG image print three figures with no withheld sentence (the 2026-11-26 decision). If plan 09's reading is "Fail", the factsheet still shows the wave-1 withhold, which is the safe state, and G252-MTM-PROMOTION stays open as plan 09 routes it.

## Self-Check: PASSED

- FOUND commits `39f97ba26`, `013cfd225`, `7cc7e7a7b`, all ancestors of HEAD.
- FOUND all 14 plan files modified, none outside the write scope; `queries.ts`, `figure-record-scalars.ts`, the Compare page, `og-metrics.ts` and the OG route are untouched.
- `STATE.md` and `ROADMAP.md` untouched.
