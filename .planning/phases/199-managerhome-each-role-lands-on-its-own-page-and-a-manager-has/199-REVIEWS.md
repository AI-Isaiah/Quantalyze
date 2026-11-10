---
phase: 199
review_kind: post-merge premise re-check
reviewed_at: 2026-11-10
reviewed_head: b93a87517 (merge of origin/main into feat/199-managerhome; brings Phase 196 ONESTRATEGYPAGE #1235, Phase 197 SCREEN #1225, Phase 198 gap 198-UAT-01 #1233)
reviewer: gsd-plan-checker (static, read-only) + phase agent
---

# Phase 199 — post-merge review of the 18 plans

The plans were written on base `b9ca8b51b`. After merging origin/main, `node scripts/verify-plan-anchors.mjs`
reports 139 claims, 0 stale, so file:line anchors resolve. This review covers SEMANTIC premises that the
anchor check cannot see. No same-wave `files_modified` collision exists in any wave.

Scope of the replan: plans **02, 05, 06, 08, 09** (and the dependent wording in plan 17 and UI-SPEC row 336).
Every other plan HOLDS; their small drifts are listed at the end for the executor and need no plan change.

## Actionable findings

### R-01 (BLOCKER) — Plan 06: `DEFAULT_AUTHENTICATED_ROUTE` now has Discovery-labelled consumers

- Plan 06 flips `DEFAULT_AUTHENTICATED_ROUTE` to `ROLE_HOME_ROUTE = "/home"`, renames every importer in
  one commit, counts "5 files", and accepts on `grep -rl DEFAULT_AUTHENTICATED_ROUTE src | wc -l` = 0.
- Phase 196 added consumers whose label and meaning are Discovery, not role home:
  `src/components/factsheet/BackLink.tsx` (~:71, fallback link "Go to Discovery"),
  `src/app/browse/BrowseDiscoveryLink.tsx` (~:19, "Go to Discovery"),
  `src/lib/factsheet/origin.ts` (~:103, `backTargetFor` discovery-without-category → "Back to Discovery").
  Tests: `src/lib/factsheet/origin.test.ts`, `BackLink.test.tsx`, `src/app/browse/layout.session.test.tsx`;
  `MarketingHeaderActions.test.tsx` (~:91) asserts the constant equals `/discovery/crypto-sma`.
- Following the plan literally points "Go to Discovery"/"Back to Discovery" at `/home` (an allocator lands on
  `/allocations`), so the label lies, and the tests still pass because they compare against the constant.
- **Required change:** keep a Discovery constant (a `/discovery/crypto-sma` export, named for what it is) for
  the Discovery-labelled sites; flip only the role-home sites (proxy bounce, marketing page, marketing header,
  LoginForm fallback, and whatever else is genuinely "home"). Re-measure the importer count at HEAD
  (about 10 files excluding `default-route.ts`), replace the 0-count acceptance with a census that names
  both sets, and add `BackLink.tsx` / `BrowseDiscoveryLink.tsx` / `origin.ts` (and their tests) to
  `files_modified` only if they must change (an import rename), never to retarget them.

### R-02 (WARNING) — Plan 08: "Go to Discovery" acceptance count cannot reach 0

- Plan 08 accepts on `grep -a -rl "Go to Discovery" src/app --include='*.tsx' | grep -v -E '\.test\.|/factsheet/' | wc -l` = 0.
- HEAD measures 7 files: the six boundary targets (`src/app/error.tsx`, `src/app/not-found.tsx`,
  `(dashboard)/error.tsx`, `admin/error.tsx`, `allocations/error.tsx`, `compare/error.tsx`) plus
  `src/app/browse/BrowseDiscoveryLink.tsx`, which is a real Discovery link and must stay. Post-execution count is 1.
- **Required change:** fix the acceptance (exclude or allowlist `BrowseDiscoveryLink.tsx` by name), and make
  the `ROLE_HOME_ROUTE` census/allowlist aware of `BackLink`, `BrowseDiscoveryLink` and `origin.ts` per R-01.
  The other 08 premises hold (13 admin guards still redirect to `/discovery/crypto-sma`; six boundaries exist;
  `src/app/strategy/[id]/error.tsx` is gone as 196-18 predicted).

### R-03 (BLOCKER on wording) — Plan 05 / UI-SPEC row 336: target copy contradicts Phase 198 D-10

- Plan 05 must_haves, Task 2 and UI-SPEC ~:336 set `awaiting_derivation` to "Book return and risk are not shown
  for your whole history. They appear after the next daily recompute." and `derivation_rejected` to "Book return
  and risk are not shown for your whole history: …".
- Phase 198 gap fix 198-UAT-01 (D-10, #1233) deliberately rewrote those `BOOK_LINE` entries in
  `src/app/(dashboard)/allocations/components/MissingDataMessage.tsx`: they now say the equity chart and the
  ratios built from it are hidden, and the docblock states a book line "never names return or risk", because
  `GlancePanel` prints return and risk from live per-key figures this history does not gate.
- The planned copy would put a false statement back on the page.
- **Required change:** keep the 198 D-10 wording; add only the whole-history scope phrase and the action that
  199 D-05 requires. Update UI-SPEC row 336 and the `MissingDataMessage.test.tsx` expectations to match.
  The scan inventory in plan 05 still matches HEAD. Note `AllocationDashboardV2.tsx` now reads "This section
  needs your book's history. See the note above." and `GlancePanel` has new sr-only pointer wording; neither is
  a scan-marker problem, but re-measure.

### R-04 (WARNING) — Plan 09: factsheet `origin` on the merged list

- Phase 196 passes `origin={{ key: "strategies" }}` on the strategies page's `StrategyTable` and
  `origin={{ key: "my-strategies" }}` in `MyStrategiesSection`. `page.table.test.tsx` asserts
  `/factsheet/${id}?from=strategies`; `e2e/my-strategies.spec.ts` (~:164) asserts `?from=my-strategies`.
- Plan 09 moves `MyStrategiesSection` to `StrategiesSection`, mounts it for every role, never mentions `origin`,
  and allows page-test edits only for a `profiles` mock branch. As written the merged page emits
  `from=my-strategies` and `page.table.test` goes red.
- **Required change:** `StrategiesSection` takes an `origin` prop: `strategies` from the merged page,
  `my-strategies` from the old page until plan 13 retires it (plan 11 later folds the key). Plan 17's retarget of
  `e2e/my-strategies.spec.ts` to `/strategies` must also change `from=my-strategies` to `from=strategies`.

### R-05 (decision taken by the phase agent; record in plan 02) — Plan 02: two staleness ladders on one field

- Phase 197 added `listSeriesVerdict(seriesEnd, assetClass, nowMs)` in `src/lib/freshness.ts`: 7 days
  (`SERIES_STALE_DAYS`) for crypto, 10 days (`SERIES_STALE_DAYS_TRADITIONAL`) for traditional/null asset class,
  so a weekend plus a holiday does not flag a healthy equity strategy; it tolerates a series end up to 2 days ahead.
- Plan 02's `seriesVerdictOf` wraps the older `bucketSeriesAge` + `SERIES_STALE_DAYS` (7 for every asset) with a
  1-day future allowance, and `strategyHealthOf` takes no asset class. The manager's Health column would say
  "Stale" for a traditional/MT5 strategy at 8 days while the Discovery list calls it current until 10.
- **Decision (phase agent, CLAUDE.md Rule 7: pick the more recent, more tested pattern):** plan 02 derives the
  Stale verdict from `listSeriesVerdict` with the row's `asset_class`. This still satisfies CD-04 — it reuses
  existing constants (`SERIES_STALE_DAYS`, `SERIES_STALE_DAYS_TRADITIONAL`) and invents no threshold — and D-03,
  whose Stale word is "derived only from existing signals". `strategyHealthOf` gains the asset-class input; the
  Stale date text keeps D-03's "no data since <date>" form. Downstream plans that call `strategyHealthOf`
  (07, 12, 14) must pass `asset_class`; check their row shape carries it. Flag for the founder in the phase report.

## Executor-adaptable drift (no plan change needed; listed so the executor is not surprised)

- **07:** `StrategyTable` gained `selectable`, `nowMs`, `sharedAccountPartners`; `emptyRowColSpan` is now
  `(showStar ? 14 : 13) + (managerRows ? 2 : 0) + (selectable ? 1 : 0)`. Relative changes still apply.
- **10, 12, 13, 15, 18:** hold. Metric headers come from `DISCOVERY_COLUMNS` now (12); factsheet tree was restructured
  (`[id]/page.tsx` re-exports `v2/page.tsx`, `error.tsx`/`not-found.tsx` moved under `factsheet/[id]/`) (18).
- **11:** census predictions right (3 double-quoted `/my-strategies` literals in production files).
- **14:** `DATA_STATE_CHIP` moved from `StrategyTable.tsx` to `StaleSeriesChip.tsx` (exported there); adapt the
  "export the chip constants from StrategyTable" step and its verify-symbol line.
- **16:** `StrategyTable.tsx` has 3 `role="status"`/warning hits, not 2 (Phase 197 `selection-status` live region,
  an announcement to ledger).
- **17:** `SEEDED_SPEC_COUNT` is 23; Phase 196 deleted the four `strategy-v2` e2e specs. See R-04 for the origin query.
- **01, 03, 04:** hold.
