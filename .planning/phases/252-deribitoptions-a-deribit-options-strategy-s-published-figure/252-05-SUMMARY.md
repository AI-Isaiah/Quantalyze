---
phase: 252-deribitoptions-a-deribit-options-strategy-s-published-figure
plan: 05
subsystem: compare-and-census
tags: [compare, options-book, overlay, census, cross-language-pin, todos, proof-01]
requires: ["252-01", "252-02", "252-03", "252-04"]
provides:
  - "Compare honours the options-book withhold: a flagged column shows no stored figure and names the reason"
  - "CompareEquityOverlay no-line reason options_cash_wallet and its note"
  - "options-cash-wallet-withhold.census.test.ts: agreement, cross-language, literal and completeness arms"
  - "DEF-142.2-07 closed and deleted; [252-SINGLEKEY-OPTIONS-CASH] booked trigger-gated"
affects: []
status: complete
commits: 3
plan_head_before: 94ebc548220b48cad9ccc290d113aa5338fb0b43
plan_head_after: ec1551057312ce78c0ed9fb6cc4c51077eb2c8e8
actuals:
  tokens: 13200
  tasks: 3
  commits: 3
tech-stack:
  added: []
  patterns:
    - "an alias pair appended at one call site (194 D-15 pattern), so the shared projection constant and its exact-set pin stay untouched"
    - "the effective reason is picked by the existing fromSnapshot boolean, so usesLastSuccessSnapshot keeps its single call and the recompute-verdict census file is not edited"
    - "a census whose population is defined by a read pattern and whose exemptions are a closed reason set, each reason checked against the file it is about"
key-files:
  created:
    - src/__tests__/options-cash-wallet-withhold.census.test.ts
  modified:
    - src/app/(dashboard)/compare/page.tsx
    - src/components/strategy/CompareEquityOverlay.tsx
    - src/app/(dashboard)/compare/page.test.tsx
    - src/components/strategy/CompareEquityOverlay.test.tsx
    - TODOS.md
key-decisions:
  - "DEF-142.2-07 is CLOSED AND DELETED (see the verdict below)."
  - "A withheld Compare column is composed from EMPTY_ANALYTICS plus strategy_id, the fetched computation_status and the headline_withheld_cause marker, so cumulative return, drawdown, the matrix and the overlay get nothing to print; the annualized cells name the sentence through the record's withheldBy."
  - "SyncPreviewStep.tsx is a COVERED reader (recordFromScalars call beside mtm_gated_reason), so it is not excluded as 'wizard'. The census also fails an EXCLUDED key that a seam already covers (redundant)."
requirements-completed: []
---

# Phase 252 Plan 05: Compare honours the withhold, a census holds every surface to it, DEF-142.2-07 decided Summary

A Compare column whose effective flags generation carries `mtm_gated_reason === "unsmoothed_options_book"` now shows no stored figure: CAGR, Sharpe and Volatility print the em dash with the withheld sentence as title and sr-only text, Cumulative Return and Max Drawdown print the em dash, the overlay draws no curve and says why, and the correlation matrix gets no series for it. A census test makes "every surface agrees" and "the TS string equals the Python producer's string" failing tests. DEF-142.2-07 is closed and deleted. No migration, no stored value moves.

## What was built

- **Task 1 (tracer), commit `963765d3d`.** `compare/page.tsx`: the strategies select appends `mtm_gated_reason:data_quality_flags->>mtm_gated_reason` and `last_success_mtm_gated_reason:data_quality_flags->last_success_snapshot->flags->>mtm_gated_reason` after the `record_observations` alias, at the page's own call site (`COMPARE_ANALYTICS_COLUMNS` and its exact-set pin are untouched; `COMPARE_ANALYTICS_COLUMNS` still does not contain `mtm_gated_reason`, pinned in the page test). Inside the `strategyItems` map, right after the existing `fromSnapshot` line, `withheld = isOptionsCashWalletReason(fromSnapshot ? row?.last_success_mtm_gated_reason : row?.mtm_gated_reason)`. `usesLastSuccessSnapshot(` still has exactly one call. `withheldBy: OPTIONS_CASH_WALLET_CAUSE` goes into `figureRecord` through a conditional spread, so `CompareTable`'s existing gated cells name the reason. Both alias inputs are deleted beside the existing deletes. A withheld item's analytics is `EMPTY_ANALYTICS` plus `strategy_id`, the fetched `computation_status` and `headline_withheld_cause`; `fetched` figures and `returns_series` are not spread. `CompareEquityOverlay.tsx`: `NoLine` gains `options_cash_wallet`, `resolveLine` returns it first when `headline_withheld_cause` equals it, and the note ternary names the cash wallet. The page never compares the flag string.
- **Task 2, commit `cfb796fea`.** `options-cash-wallet-withhold.census.test.ts` (4 arms, 23 tests, below).
- **Task 3, commit `ec1551057`.** `TODOS.md`: item 7, `DEF-142.2-07`, deleted whole; item 9 and the other numbers untouched. New entry `[252-SINGLEKEY-OPTIONS-CASH]` (numbered 0.016) at the end of `## ⏳ TRIGGER-GATED`, under a `### Phase 252 (DERIBITOPTIONS) — routed items` heading so it does not read as part of the branch-protection subsection above it.

## Sentences (hand-typed in the tests, not copied from source)

- Annualized cells, title and sr-only: `Withheld: measured on the cash wallet, which leaves out open option positions.`
- Overlay note (a DRAFT for the founder visual check, owned by `/gsd-verify-work`): `<name>: measured on the cash wallet, which leaves out open option positions, so no curve is drawn.`

## The census (Task 2)

Header states the property (ROADMAP SC-3), oracle independence, how a file is read and the anti-vacuity rules. Measured at HEAD (read off the walk, not restated by hand): 26 readers of `strategy_analytics` outside tests, 7 covered, 19 excluded.

- **Arm 1, agreement.** One triggered value (read from the Python producer) driven through `headlineVerdict`, `shapeRowAnalytics`, `recordFromScalars` + `gateAnnualized`, and `parseConstituentRecord` withholds. The six other producer reasons withhold through no seam. The raw trigger string passed to the constituent parser (which keys on the cause literal only) and four untrusted flag values (case variant, padded, null, boolean) withhold through no seam.
- **Arm 2, cross-language.** Reads seven `MTM_REASON_*` assignments from `analytics-service/services/stitch_composite.py`; `MTM_REASON_OPTIONS` equals the typed literal and `OPTIONS_CASH_WALLET_REASON`; exactly one producer value passes `isOptionsCashWalletReason`. A parser self-test proves a comment line and an f-string are not read.
- **Arm 3, literal.** After comment stripping, `unsmoothed_options_book` appears in code in exactly the four allowlisted files (`headline-basis.ts`, `FactsheetView.tsx`, `basis-context.tsx`, `src/lib/factsheet/types.ts`), both directions (a stale entry fails). Self-test plants a rogue comparison and a comment-only mention.
- **Arm 4, completeness.** A reader is a `.from("strategy_analytics")` call or a `strategy_analytics (` / `strategy_analytics(` embed in comment-stripped text. Covered means a CALL (not an import) of one of six seams, or a `recordFromScalars(` call beside the token `mtm_gated_reason`. Every EXCLUDED reason is checked against its file (see below). Self-tests: uncovered reader flagged; covered, comment-only, import-only, `database.types.ts` and test files handled; every reason check fires on a planted file; a gated-upstream pointer at a covered file is accepted.

### EXCLUDED classification (seeded from the plan, adjusted by the run)

- Covered, no exclusion needed: `queries.ts`, `strategies/page.tsx`, `compare/page.tsx`, `recommendations/page.tsx`, `api/strategies/[id]/returns/route.ts`, `api/og/factsheet/[id]/route.tsx`, and `SyncPreviewStep.tsx`.
- `gated upstream: src/lib/factsheet/composite-read-path.ts` (calls `headlineVerdict` / `applyHeadlineBasis` / `isOptionsCashWalletBook`): `factsheet/[id]/v2/page.tsx`, `fetch-and-build-payload.ts`, both PDF routes.
- `out of scope: admin (CONTEXT)`: `admin/page.tsx`, `admin/compute-jobs/page.tsx`, `api/admin/strategy-review/route.ts`, `lib/admin/match.ts`, `lib/intro/snapshot.ts`.
- `out of scope: wizard (CONTEXT)`: `api/strategies/csv-finalize/route.ts` (names a figure column, so it cannot be `status only`).
- `status only` (each file names none of the nine figure columns): `api/keys/sync/route.ts`, `api/strategies/finalize-wizard/route.ts`, `lib/finalize-rerun.ts`, `hooks/useStrategySyncPoller.ts`, `ApiKeyManager.tsx`, `founder-lp/readiness.ts`.
- `deferred: blend (CONTEXT)`: `scenario-share/[token]/page.tsx`.
- `outside the ruling: honours neither the verdict nor D-15`: `api/bridge/outcome/[id]/curves/route.ts` (imports none of the four ruling modules).
- `dead: readRecordSpan has no production caller`: `lib/record-span-read.ts` (checked: no other non-test file imports `@/lib/record-span-read`; the mentions are comments).

**Changes from the seed, all inside the closed set:** (1) `SyncPreviewStep.tsx` moved from `out of scope: wizard` to covered (it calls `recordFromScalars` with the `mtm_gated_reason` it reads from the flags), and `finalize-wizard/route.ts` is `status only` (its status check holds); (2) added a check the plan did not list: an EXCLUDED file that a seam already covers fails as `redundant`, and a `dead:` file must have no importer; (3) `admin/compute-jobs/page.tsx` also satisfies `status only` but keeps the seeded `admin` reason. No seed-covered file was found uncovered, so nothing was excluded to make the census pass.

## DEF-142.2-07 verdict (Task 3): CLOSE AND DELETE

Four reasons:

1. The entry's own subject has 0 rows for the second time. It asks whether to tighten `ledger_complete` on a broken Deribit chain, and no Deribit row is stamped `ledger_complete` with a broken chain (census 2026-11-25).
2. PROD has no single-key Deribit strategy, so tightening still affects nothing.
3. The earlier census missed 2 rows. Both are private composites stamped `composite_stitched`, a different verdict path, and that is the population this phase withholds under the named reason.
4. The remedy rule the entry carried (re-derive, never a backfill `UPDATE`) survives in item 9 of the DEF-142.2 list.

**Census reading, verbatim:** 2 total / 0 published / 0 ledger_complete; 6 rows any venue, 4 MT5, all private; trigger population 2 rows, both private composites, every composite member Deribit.

**Residual:** a future single-key Deribit strategy with a broken chain keeps `ledger_complete`, the behaviour-preserving default 142.2 plan 03 shipped. **Reopen trigger:** any Deribit row stamped `ledger_complete` that carries `twr_chain_broken`. The ship CHANGELOG entry must name this deletion and the new `[252-SINGLEKEY-OPTIONS-CASH]` entry (CLAUDE.md TODOS rule (b)); that entry is written at ship time, not here. `grep -a -rn "DEF-142.2-07"` over `src`, `scripts`, `analytics-service`, `docs`, `.github` and `CLAUDE.md` finds nothing; historic CHANGELOG and `.planning` mentions stay as lineage.

## PROOF-01 (verbatim)

### Compare, live and held flagged cases (neutered `withheld` to `false && ...`; restored by cp from a scratchpad byte backup)

```
     × a LIVE flagged row: dashes, the sentence on the annualized cells, no series for the overlay or the matrix 19ms
     × a HELD flagged row (live reason gone, last-success reason bound to computed_at) is withheld the same way 9ms
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 2 ⎯⎯⎯⎯⎯⎯⎯
 FAIL  |jsdom| src/app/(dashboard)/compare/page.test.tsx > ComparePage — an options book's column shows no figure and says why (252 plan 05) > a LIVE flagged row: dashes, the sentence on the annualized cells, no series for the overlay or the matrix
 FAIL  |jsdom| src/app/(dashboard)/compare/page.test.tsx > ComparePage — an options book's column shows no figure and says why (252 plan 05) > a HELD flagged row (live reason gone, last-success reason bound to computed_at) is withheld the same way
 Test Files  1 failed (1)
      Tests  2 failed | 60 passed (62)
cmp exit 0
 Test Files  1 passed (1)
      Tests  62 passed (62)
```

(The RED is the Compare column printing today's stored figures. A mid-run failure before the fixtures bound their snapshot showed the shape: `expected 'Good+25.00%' to be '—Withheld: measured on the cash walle...'`.)

### Overlay (neutered the `resolveLine` check to `false && ...`)

```
     × a marked item gets the options note and no line, no swatch 28ms
     × a marked item beside a clean one: the clean one still draws and only the marked one is noted 13ms
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 2 ⎯⎯⎯⎯⎯⎯⎯
 Test Files  1 failed (1)
      Tests  2 failed | 22 passed (24)
cmp exit 0
 Test Files  1 passed (1)
      Tests  24 passed (24)
```

Guards: `grep -a -c "usesLastSuccessSnapshot(" compare/page.tsx` is 1; `grep -a -c "isOptionsCashWalletReason(" compare/page.tsx` is 1.

### Census, completeness (removed the `isOptionsCashWalletReason` call from `compare/page.tsx`)

```
     × every reader calls a withhold seam, or sits in EXCLUDED under a reason the file still satisfies 21ms
     × anti-vacuity: the walk is non-empty and every anchor is a covered reader 2ms
AssertionError: uncovered: src/app/(dashboard)/compare/page.tsx reads strategy_analytics but calls no withhold seam and is not in EXCLUDED: expected [ Array(1) ] to deeply equal []
AssertionError: the census walked past an anchor it must cover: expected [ Array(1) ] to deeply equal []
 Test Files  1 failed (1)
      Tests  2 failed | 21 passed (23)
cmp exit 0
 Test Files  1 passed (1)
      Tests  23 passed (23)
```

### Census, cross-language (changed `MTM_REASON_OPTIONS` in `analytics-service/services/stitch_composite.py` by one character; nothing committed while changed; `git status` clean for the file after the restore)

```
 1 file changed, 1 insertion(+), 1 deletion(-)
     × reads at least seven MTM_REASON_* assignments, and MTM_REASON_OPTIONS is the typed trigger literal 16ms
     × exactly one producer value triggers the predicate, and it is MTM_REASON_OPTIONS's 4ms
     × the triggered value withholds through the verdict, the list shaper, the record carrier and the constituent parser 3ms
AssertionError: expected 'unsmoothed_options_bookx' to be 'unsmoothed_options_book' // Object.is equality
AssertionError: expected [] to deeply equal [ 'MTM_REASON_OPTIONS' ]
AssertionError: expected { kind: 'dated', since: '2026-09-01' } to deeply equal { kind: 'withheld', …(1) }
cmp exit 0
 Test Files  1 passed (1)
      Tests  23 passed (23)
```

### Census, literal (appended `export const __rogue = (r: string) => r === "unsmoothed_options_book";` to `src/lib/figure-gate.ts`)

```
     × the literal appears in code only in the closed allowlist, and every allowlisted file still has it 553ms
AssertionError: literal: src/lib/figure-gate.ts contains "unsmoothed_options_book" in code and is not in the allowlist: expected [ Array(1) ] to deeply equal []
 Test Files  1 failed (1)
      Tests  1 failed | 22 passed (23)
cmp exit 0
 Test Files  1 passed (1)
      Tests  23 passed (23)
```

## Verification run

- `npx vitest run 'src/app/(dashboard)/compare' src/components/strategy src/__tests__/options-cash-wallet-withhold.census.test.ts src/__tests__/figure-gate-census.test.ts src/__tests__/recompute-verdict-census.test.ts src/__tests__/verify-plan-anchors.test.ts src/lib/queries.test.ts`: 82 files, 1867 tests, all passed.
- `npm run typecheck`: clean. `npm run lint`: 0 errors, 4 warnings (see below), every check script OK, including `check-planning-hygiene` (also run alone: OK).
- `node scripts/verify-plan-anchors.mjs --pending`: `claims: 44 checked`, `OK: 15 plan file(s), no stale claims.`
- The TODOS.md-reading and `.planning`-reading vitest set (28 files): 6 files failed in the first combined run while `npm run typecheck` ran alongside, every failure a 5000 ms timeout or a sibling of one. Re-run without that load: `check-planning-hygiene`, `self-referential-oracle`, `ci-docs-path-filter`, `lint-sql-gates`, `oneaccountonce-delete-sql-exec` pass, and `accounttruth-census` passes (54 of 54) when run alone. Nothing in the set reads the deleted TODOS entry.
- Known local-only failures named by the brief (`compute.conventions.test.ts` fixtures B and C, `RiskTabPanel.book-series.test.tsx`) were not touched and not run.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] The page test's existing "never projects ... the data_quality_flags blob" pin rejected the two new aliases**
- **Found during:** Task 1
- **Issue:** `ALLOWED_FLAG_ALIAS_EXPRESSIONS` in `page.test.tsx` is the closed list of scalar expressions the projection may carry. The two new `->>` aliases are not on it, so the negative blob pin failed.
- **Fix:** added both expressions to the list (now nine) and updated its comment. The "bare blob still rejected" case and its per-alias loop cover them automatically.
- **Files modified:** `src/app/(dashboard)/compare/page.test.tsx`
- **Commit:** `963765d3d`

**2. [Rule 1 - Bug in my own first test draft] Held-row fixtures did not bind a snapshot**
- **Found during:** Task 1
- **Issue:** `usesLastSuccessSnapshot` binds a snapshot only when the live row carries no `cumulative_method` and the last-success `cumulative_method` alias is present and bound to `computed_at`. My first held-row fixtures omitted both, so they read as live rows.
- **Fix:** fixtures now carry `cumulative_method: null` and `last_success_cumulative_method: "geometric"`. I also replaced a case whose title contradicted its own comment with one that states the rule: a bound snapshot IS the row's generation, so its other reason wins over a live options reason.
- **Commit:** `963765d3d`

**3. [Plan seed adjustment, within the closed set] `SyncPreviewStep.tsx` is covered, not excluded.** See the classification above. Plus two extra census checks (`redundant`, and an importer check for `dead:`), both of which can fail.

**4. [Placement] The `[252-SINGLEKEY-OPTIONS-CASH]` entry sits under its own `###` heading at the end of the trigger-gated section** so it does not read as part of the branch-protection subsection. The entry text carries "the date logged is the ship date" as the plan asked, and its heading date is the execution date, 2026-11-25. The ship should confirm or replace that date in its CHANGELOG entry.

**5. [Acceptance wording] `DEF-142.2-09` count stays 1.** The new entry refers to "item 9 of the DEF-142.2 list" rather than the id, so the plan's guard count holds.

## Deferred Issues / out of scope

- `npm run lint` prints four warnings in files this plan did not touch: unused `nativeUnitReason` in `src/app/factsheet/[id]/v2/MetricsColumn.tsx`, unused `isRankableAnalyticsRow` in `src/lib/factsheet/composite-read-path.ts`, and two unused constants in `src/lib/queries.stale-analytics-detail.test.ts`. The first two files were edited by earlier 252 plans; the warnings are not new output of plan 05 and were not fixed here (scope boundary). The orchestrator may want plan 01 or 02 to confirm the first two are theirs.
- Compare draws no curve for a flagged column (RESEARCH Q8, planner discretion). The overlay note wording is a draft. Both are for the founder visual check in `/gsd-verify-work`.

## Known Stubs

None. No hard-coded empty value flows to UI beyond the deliberate blanked analytics of a withheld column, which is the feature.

## Threat Flags

None. The only new select surface is two `->>` closed-vocabulary scalars (T-252-12, mitigated: both inputs are deleted before any item is built, pinned by the "no item carries an alias input" case, which now lists both keys). T-252-13 (silent surface drift) is mitigated by the completeness and cross-language arms.

## Ship-time orchestrator checkpoint: PROD count (PLACEHOLDER, NOT RUN BY THIS EXECUTOR)

> **To be filled by the orchestrator at ship time, before the CHANGELOG entry is written.** Executors have no PROD access. Run the marker query first and confirm it names PROD. Then run one read-only count of `strategy_analytics` rows by `data_quality_flags->>mtm_gated_reason`, grouped by `strategies.status`, with each flagged composite's member venues (through `strategy_keys` to `api_keys.exchange`) and the count of MT5 members (expected 0). One statement per call, no write. Paste the reading verbatim under a dated heading here and into the ship CHANGELOG entry. If a published row or an MT5 member appears, stop the ship and route it to the founder: CONTEXT's "no published figure moves in wave 1" would no longer hold.
>
> ### PROD reading, 2026-11-25 (taken by the orchestrator, Supabase MCP, read-only)
>
> Marker query first: it named PRODUCTION. Rows carrying any `mtm_gated_reason`: 2, both `unsmoothed_options_book`, both `status = private`. Composite member venues: deribit only. MT5 composite members: 0. No published row and no MT5 member, so the ship proceeds.

## Ship notes for the CHANGELOG entry

- Name the `DEF-142.2-07` deletion with the census reading above, and the new `[252-SINGLEKEY-OPTIONS-CASH]` entry.
- Paste the PROD reading from the placeholder above.
- Mixed composites, accepted at planning (RESEARCH Open Question 5): a composite with any Deribit options member is withheld as a whole, including the contribution of its members on other venues, because its stored headline is measured on that member's cash wallet.

## Self-Check: PASSED

- `src/__tests__/options-cash-wallet-withhold.census.test.ts` exists; `compare/page.tsx`, `CompareEquityOverlay.tsx`, both test files and `TODOS.md` carry the changes above.
- Commits `963765d3d`, `cfb796fea` and `ec1551057` are ancestors of HEAD; `git rev-list --count` over the ledger base gives 3.
- Acceptance counts: `isOptionsCashWalletReason(` in `compare/page.tsx` 1; `usesLastSuccessSnapshot(` 1; `options_cash_wallet` in the overlay at least 1; the last-success alias line 1; `DEF-142.2-07` in `TODOS.md` 0; `DEF-142.2-09` 1; `252-SINGLEKEY-OPTIONS-CASH` 1.
