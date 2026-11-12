---
phase: 201-plainwords-one-name-per-concept-explained-and-the-small-inco
plan: 24
subsystem: testing
tags: [plainwords, integration, baseline-classification, stale-pins, todos, eslint-comments, clar-03, clar-04, clar-06]
requires: ["201-23"]
provides:
  - "every failing test on the merged branch classified against a pre-phase baseline and fixed by its class (27 failures in 14 files: 2 pre-existing, 0 regressions)"
  - "narrowcharts e2e fixtures carry the new fallback name; no other stale e2e literal"
  - "three Phase 197 TODOS entries closed with evidence, one Phase 196 entry restated, one egress paragraph booked"
  - "eslint.config.mjs comments no longer call the chart files frozen"
affects: []
tech-stack:
  added: []
  patterns: ["classify a failure against a base worktree before editing; a lookup that breaks is a locator change, not a pin"]
key-files:
  modified:
    - TODOS.md
    - eslint.config.mjs
    - e2e/fixtures/narrowcharts-desktop-1280.json
    - e2e/fixtures/narrowcharts-longlabels-desktop-1280.json
    - scripts/copy-census/policy.ts
    - scripts/copy-census/scan.ts
    - src/__tests__/copy-census.test.ts
    - src/lib/wizardErrors.ts
    - src/lib/allocation-helpers.ts
    - src/components/strategy/FactsheetPreview.tsx
    - src/components/layout/Sidebar.tsx
    - src/components/layout/MobileNav.test.tsx
    - src/app/(dashboard)/allocations/components/SavedScenariosList.tsx
    - src/app/(dashboard)/allocations/lib/strategies-row-adapter.ts
    - src/app/scenario-share/[token]/share-resolve.ts
decisions:
  - "A broken element lookup after a Term wrap is recorded as a locator change (the asserted value is unchanged), separate from stale pins and decision pins, with plan 201-09's deviation 2 as precedent."
  - "The stale-chip oracle is typed by hand (literals from the frozen clock) so it cannot agree with a broken date helper."
  - "The wizardErrors comment that quoted the simulator route's old terminal sentence is corrected, and its census exception row retired (36 to 35) instead of leaving a false comment pinned by the census."
status: complete
plan_head_before: 62f3d4da711df51f6fb1431b381ea9c73821e5e9
plan_head_after: 81ca4dfa6569cae0ff6cdee91e2c07c3d597d156
commits: 6
actuals:
  tokens: 42500
  tasks: 3
  commits: 6
requirements-completed: [CLAR-03, CLAR-04, CLAR-06]
metrics:
  completed: 2026-11-11
---

# Phase 201 Plan 24: integration, baseline classification and ledger close Summary

The merged Phase 201 tree passes the full suite except two snapshot arms that also fail at the pre-phase base: all 27 failures were classified against a base worktree before any edit (0 regressions), the e2e literal sweep found one stale fixture family, and the Phase 197 TODOS entries are closed against RED-proven tests.

## Task commits

The commit count below is measured from the per-plan ledger (`plan_head_before` to `plan_head_after`, 6 commits); the SUMMARY commit follows.

| Task | Commit | What |
|------|--------|------|
| 1 (tracer) | 967184cd3 | Factsheet family re-pinned (comparator-floor, no-loss-residues, FactsheetBody.basis); `allocation-helpers` and `FactsheetPreview` comments state name before codename (D-09) |
| 2 | ca0a15fbb | Dashboard, strategy and og families re-pinned; narrowcharts fixtures; stale comments |
| 2 | 6f2808adb | Stale-chip expected days typed by hand as literals |
| 2 | 6d7de6718 | `wizardErrors.ts` comment corrected; its census exception row retired (count 36 to 35) |
| 3 | fd615cb87 | `eslint.config.mjs` comments only (D-21) |
| 3 | 81ca4dfa6 | TODOS closes, restate and egress paragraph |

## Baseline

- `PHASE_BASE=19353fd1fba5c6da805b6cdecfb9580e52dd4567` (`git merge-base HEAD origin/main`; also the merge-base of `feat/201-plainwords` with `main`). `git diff PHASE_BASE..HEAD` is the phase.
- Base worktree: `git worktree add --detach <scratchpad>/base-201 PHASE_BASE`, this worktree's `node_modules` linked in, no `npm ci`. Removed at the end (`rm` of the link, then `git worktree remove`); `git worktree list` no longer shows it and the shared install is intact.
- HEAD run 1 (before any edit): `npx vitest run`: `Test Files 14 failed | 1215 passed | 20 skipped (1249)`, `Tests 27 failed | 25735 passed | 306 skipped (26068)`, `Snapshots 2 failed`. Re-run in isolation: the same 27 fail (not load flakes; the two AllocationsTabs timeouts were a missing text, see below).
- The same 14 files at the base: `Test Files 1 failed | 13 passed (14)`, `Tests 2 failed | 305 passed (307)`: only `compute.conventions.test.ts`.

## Failure table (27 tests, 14 files)

| File | Tests | Class | Evidence | Owner SUMMARY recorded it |
|------|-------|-------|----------|---------------------------|
| `src/lib/factsheet/compute.conventions.test.ts` | 2 | pre-existing | Fails at the base with byte-identical output: `skew` last digit (`-0.11360716852722537` expected, `-0.11360716852722538` received; `0.036844507138639` vs `0.036844507138638946`). `compute.ts` is not in the phase diff. Not edited. | n/a |
| `src/components/strategy/StrategyTable.default-mounts.test.tsx` + `__fixtures__/strategy-table-default-mounts.json` | 1 | stale pin | `My Watchlist` removed from `WatchlistTabs.tsx` (`My watchlist`), no added line carries the old literal. | yes, 201-17 |
| `StrategyTable.selection.test.tsx` | 1 | stale pin | `/My Watchlist/` to `/My watchlist/` (same hunk). | yes, 201-17 |
| `StrategyTable.test.tsx` | 4 (cases 1, 5, 6, 7) | stale pin | tab name to `/My watchlist/` (four) and the empty sentence `Star strategies from the All tab to track them here.` to `Use the star on a strategy in the All tab to add it to your watchlist.` (`EmptyWatchlist`). | yes, 201-17 |
| `StrategyTable.stale-series.test.tsx` | 4 | decision pin | Expected value was computed (`daysAgo(n)`, ISO). The source (`StaleSeriesChip.tsx`) is in the phase diff and now prints `formatDay(seriesEnd)`; D-11 and U-14 specify `Oct 9, 2026`. Re-pinned to hand-typed literals from the frozen clock: `Data from Oct 9, 2026` (three) and `Data from Oct 28, 2026`. | yes, 201-17 |
| `MetricsColumn.comparator-floor.test.tsx` | 1 | stale pin | The paired-floor sentence ended `SPX prices end Aug 2.`; now `Aug 2, 2024.` (U-14, `formatDay` in `MetricsColumn.tsx`). Title and expectation updated. | yes, 201-10 (owner 201-08) |
| `AllocationsTabs.connect-key-predicate.test.tsx` | 2 | stale pin | `Start a portfolio` to `Start a scenario` (`ScenarioComposer.tsx`). Presented as 5 s timeouts because the lazy-panel wait never found the text. | yes, 201-11 |
| `HoldingsTabPanel.key-read-notes.test.tsx` | 3 | stale pin | `so portfolio AUM leaves it/them out` to `allocation AUM` (`live-holdings-summary.ts`, removed `-` lines). | yes, 201-11 |
| `HoldingsTabPanel.test.tsx` | 1 | stale pin (two literals) | `Simulate Impact needs a live portfolio` to `...live allocation` (`OptimizerPanel.tsx`); placeholder `Add a private note about your allocation book` to `...your allocation — markdown supported` (`DashboardNoteCard.tsx`). | no (new) |
| `ScenarioComposer.d11.test.tsx` | 2 | stale pin plus locator change | `Max DD (blend vs book)` to `(blend vs allocation)` (`BatchDPanels.tsx`), and the row is now found by its whole label cell (the label is `TermLead` plus plain words). | no (new) |
| `FactsheetBody.basis.test.tsx` | 1 | locator change | `railValue` found the Max Drawdown panel by an exact-text `h3`; the title is now a Term (D-03), so the h3 owns no text node. Asserted values unchanged. | no (new) |
| `MetricsColumn.no-loss-residues.test.tsx` | 2 | locator change | `Calmar by Year` h3 is now `<Term>Calmar</Term> by Year` (D-01). Heading found by whole `textContent`; values unchanged. | no (new) |
| `src/app/api/og/factsheet/[id]/route.page-agreement.test.tsx` | 2 | locator change | The Main Metrics Sharpe label is a Term, so the leaf finder missed the row (value read `''`). Found by the label cell (`td` whose whole text is `Sharpe`); the `—` and number assertions are unchanged. | no (new) |
| `AllocationsTabs.onboarding.test.tsx` | 1 failing plus 3 vacuous | locator change | `getByText("Mandate quick-set")` failed because `Mandate` is now a Term. The three `queryByText(...).toBeNull()` arms of the same file had become vacuous (they would pass with the card on screen). All four now read the heading by whole text through one helper. | no (new) |

`stale-pins:` 15 tests (13 in the rows marked stale pin, plus the 2 d11 tests, which are also locator changes). `decision-pins:` 4 tests (stale-series). `locator-changes:` 8 tests in 5 files (6 failing tests in FactsheetBody.basis, no-loss-residues, route.page-agreement and onboarding, plus the 2 d11 tests), and the onboarding file's 3 vacuous absence arms that did not fail. `pre-existing:` 2 tests in 1 file. 15 + 4 + 6 + 2 = 27. `regressions:` none: every non-pre-existing failure traced to a string or a Term wrap the phase wrote on purpose (D-01, D-03, D-07, D-09, D-11, U-10, U-14), and no value matched no decision.

Locator changes are a class the plan does not name. They are not stale pins (no literal was removed) and not decision pins (no expectation changed): the assertion's expected value is untouched and only how the element is found changed, the same move plan 201-09 made in its deviation 2. Each one has a neuter below.

## Pre-existing exclusion and the run of record

`npx vitest run --exclude '<file>'` does not exclude under this repo's multi-project config (both `src/lib/factsheet/compute.conventions.test.ts` and `**/compute.conventions.test.ts` still ran the file), so the plan's exclude form cannot be used. Nothing was changed in the config or the snapshot. The run of record is the plain full suite, whose only failures are the two base-identical arms:

- `npx vitest run --reporter=dot` (final, after every edit but this SUMMARY): `Test Files 1 failed | 1228 passed | 20 skipped (1249)`, `Tests 2 failed | 25760 passed | 306 skipped (26068)`, `Snapshots 2 failed`, node v25.8.1. The two failures are the `compute.conventions.test.ts` `fixture B` and `fixture C` arms.
- 20 test files and 306 tests are skipped (the live-database and local-stack lanes skip without their environment, as plan 201-02 recorded for `outcomes-join-rls.test.ts`). The skips were not measured at the base, so "no new skip" is not claimed.
- Consequence, stated plainly: Task 1's `<automated>` (`npx vitest run src/app/factsheet src/lib`) and Task 2's `npm test` exit non-zero because of those two pre-existing arms. Excluding them by path: `npx vitest run src/app/factsheet src/lib` gives `Test Files 1 failed | 434 passed (435)`, `Tests 2 failed | 9621 passed | 23 skipped`, the 2 being the same arms.

## Neuter record (RED, restore from a byte backup, `cmp` exit 0)

- gc-201-24-neuter: gate=`AllocationsTabs.onboarding.test.tsx` absence arms. `AllocationsTabs.tsx` `showMandateQuickSet` changed to `props.apiKeysCount === 0` (ignores the saved mandate). RED: `× apiKeysCount=0 + mandateIsSet=true → OnboardingBanner ONLY (mandate already saved)`, `Tests 1 failed | 3 passed (4)`. Restored `cp -p`, `cmp` exit 0, `4 passed`.
- gc-201-24-neuter: gate=`StrategyTable.stale-series.test.tsx` chip day. `StaleSeriesChip.tsx` printing the raw ISO day (`Data from ${seriesEnd}`). RED: four arms, `Unable to find an element with the text: Data from Oct 9, 2026` (and `Oct 28, 2026`). Restored, `cmp` exit 0, `29 passed`.
- gc-201-24-neuter: gate=`MetricsColumn.no-loss-residues.test.tsx`. `AnalyticalPanels.tsx` Calmar cell `(r.calmar ?? 0).toFixed(2)` in place of `ratio(r.calmar)`. RED: `the no-drawdown year reads "—", the drawdown year a number` (fresh payload and cache round trip), `Tests 2 failed | 16 passed (18)`. Restored, `cmp` exit 0.
- gc-201-24-neuter: gate=`FactsheetBody.basis.test.tsx` STEP-3 parity. `MetricsColumn.tsx` Max Drawdown rail value `pct(m.max_dd - 0.05, 2)`. RED: `STEP-3 PARITY (F3): the rail §I displays the PERSISTED seven`, `Tests 1 failed | 36 passed (37)`. Restored, `cmp` exit 0.
- gc-201-24-neuter: gate=`route.page-agreement.test.tsx`. `MetricsColumn.tsx` Sharpe row value `"0.00"`. RED: `a compounding constant yield reads '—' on the OG card AND on the page, never 0.00`, `Tests 1 failed | 1 passed (2)`. Restored, `cmp` exit 0.
- gc-201-24-neuter: gate=`ScenarioComposer.d11.test.tsx`. `BatchDPanels.tsx` Max DD delta `value={null}`. RED: both `a malformed first/last own-book date withholds the Sharpe delta ... KEEPS the panel's Max DD`, `Tests 2 failed | 24 passed (26)`. Restored, `cmp` exit 0.
- gc-201-24-neuter: gate=`copy-census.test.ts` stale-exception direction (natural RED, not a manual neuter). Correcting the `wizardErrors.ts` comment before retiring its row gave `stale: exception rule A src/lib/wizardErrors.ts "arm, here with 'Portfolio impact simulation failed.' and code UNKNOWN." matches no live hit` and the two count pins failing (`expected ... length 36 but got 35`); after the row, the typed row and the pinned count moved together the census reads `remaining files=0 A=0 B=0 C=0 exceptions=35`.

The literal re-pins (13 stale-pin tests) bite by construction: each asserts a string the source now prints, and the full run failed on the old string.

## cross-plan-pins, open-joins and name-chains-unexpected: resolutions

| Source | Item | Resolution |
|--------|------|------------|
| 201-05 | `open-joins: none` | Nothing to pick up. |
| 201-08 | cross-plan-pins none | n/a (full suite is the gate; nothing failed in its files). |
| 201-09 | cross-plan-pins none | n/a |
| 201-10 | `MetricsColumn.comparator-floor` `Aug 2.` | stale pin, fixed (table above). |
| 201-11 | `AllocationsTabs.connect-key-predicate` `Start a portfolio` | stale pin, fixed. |
| 201-11 | `HoldingsTabPanel.key-read-notes` and `live-holdings-summary.test.ts` `portfolio AUM leaves it out` | key-read-notes fixed; `live-holdings-summary.test.ts` already carried the new string and passes. |
| 201-11 | `ScenarioCommitDrawer.test.tsx`, `SavedScenariosList.tsx`, `scenario/commit/route.ts` portfolio wording | route already says `Your allocation changed since you started this scenario`; the drawer test's fixture string updated to match (it passed before, a fixture only); `SavedScenariosList.tsx` comment updated. |
| 201-12 | narrowcharts fixtures keep `My Portfolio` | fixed (below). Its other listed families (`ScenarioComposer*`, `SavedScenariosList*`, `HoldingsTabPanel.*`, `AddAllocationFlow.*`, `PortfolioImpactPanel.*`) ran in the full suite; only `HoldingsTabPanel` and `ScenarioComposer.d11` failed (fixed). `allocator-portfolio-payload*` matches the old strings but is another surface, untouched. |
| 201-13, 201-14 | cross-plan-pins none | n/a |
| 201-15 | `MissingDataMessage.test.tsx`, `AllocationsTabs.*`, `GlancePanel.*`, `lib/dust.test.ts`, `lib/book-figures.test.ts` | all pass at HEAD; the `AllocationsTabs.*` failures were plan 11's literals above. |
| 201-16 | `glossary.test.ts` tautological discovery arm | retired by plan 201-23; passes. |
| 201-17 | the five StrategyTable pins | fixed (table above). |
| 201-18, 19, 20, 22, 28, 29, 31, 32 | none | n/a |
| 201-21 | `ScenarioCommitDrawer.test.tsx:454` fixture string | updated (above). |
| 201-21 | `PreferencesPanel.tsx` `Failed to save preferences` | no longer present at HEAD (plan 201-20 renamed it); nothing to do. |
| 201-21 | `wizardErrors.ts` and `simulator/route.ts` comments quoting the old simulator failure sentence | `route.ts` has no such comment at HEAD. `wizardErrors.ts` quoted `'Portfolio impact simulation failed.'` as the route's own terminal sentence; the route says `Allocation impact simulation failed.`. The first quote in that comment (`'Portfolio impact simulation failed'`, the Python `detail`, unchanged in `analytics-service/routers/simulator.py`) stays. Comment corrected and its census exception row retired (see decisions). |
| 201-21 | `scenario-share/[token]/page.tsx:387` and `SavedScenariosList.tsx:265` `private book sources` | `page.tsx` already reads `private allocation sources`; the two comments in `SavedScenariosList.tsx` and `share-resolve.ts` updated. (Other `live-book boundary` uses in `share-resolve.ts` name a concept and were left.) |
| 201-27 | `ScenarioComposer.save.test.tsx` and `scenario-share/[token]/page.test.tsx` old strings | no hits at HEAD for `Enter a name to save this portfolio`, `Portfolio names are limited` or `PROJECTED — hypothetical, not a live book`. |
| 201-28 | `ScenarioComposer.tsx:6811` prose, `InsightStrip` `Bridge flagged` | the census reports 0 hits for the retired word (plan 201-33); no failing test. |
| 201-30 | comments quoting `Open Bridge` at `Sidebar.tsx:257` and `MobileNav.test.tsx:21` | comments now name the `Review replacements` card; the Sidebar's allocator-destination comment names `Scenario` (D-07) instead of `Bridge`. |
| 201-23 | `scripts/copy-census/scan.ts` header (`a ledger's pending count`) and `StrategyTable.manager-rows.test.tsx:718` (`formatIsoDay`) | comments corrected (`the hit count for a file`; `formatDay ... its UTC day (D-11)`). |
| 201-02 name-chains | `FactsheetPreview` `strategyName` prop doc | corrected to the displayed name (D-09); comment only. |
| 201-02 name-chains-unexpected | `watchlist-read.ts:31`, `StrategyNameBlock.tsx:14` | neutral comments, not name positions; no change. |
| 201-02 name-chains-unexpected | `strategies-row-adapter.ts:233, 276`, `holdings-adapter.ts:222`, `allocation-helpers.ts:25, 33` | name before codename already in place (plan 201-26: the payload nulls `name` for a strategy the viewer cannot see, `{ visible: true }` says so, and the resolver is name, codename, `Strategy #id`); the codename passed in is the fallback leg, not a name position. The stale comments in `allocation-helpers.ts` (11, 12) and `strategies-row-adapter.ts` (the "third-party exploratory row" sentence) now state the D-09 order. |
| 201-02 | `codename-first-baseline: 3` | re-measured: the plan's grep prints `0` (D-09 / D-17). |

## stale-e2e (W4 sweep)

Two throwaway scripts (not committed) collected quoted literals, JSX text runs and 10-character text runs from every removed line of `git diff PHASE_BASE..HEAD` over non-test `src/` files (983 removed runs; 530 not re-added) and ran `grep -a -rn -F` for each over `e2e/` and `tests/`.

- `e2e/fixtures/narrowcharts-desktop-1280.json` (13 labels) and `narrowcharts-longlabels-desktop-1280.json` (14): `My Portfolio` to `My allocation`. The label comes from `AllocationDashboardV2.tsx` `portfolio?.name ?? "My allocation"` (plan 201-12); a grep over `supabase/`, `e2e/helpers`, `analytics-service` and `scripts` finds no seeded portfolio name, so the seeded allocator takes the fallback. The composer surface's `Scenario` labels did not change. Hand-edited, not regenerated: no Playwright runs here, so these are proven only by grep and CI.
- Different uses, left: `Correlation ceiling` (`e2e/mandate-form.spec.ts`; the label still exists at `MandateForm.tsx:347`), `Bridge` (only `seedBridgeCandidate`, a seed helper name, and file comments), `Portfolio` and `Preferences` (`describe` titles, not locators), `short`, `long`, `unit`, `factsheet` and similar common words inside comments or code.
- A direct grep of `e2e/` for text locators on the retired words, `Start a portfolio`, `Open Bridge`, `Saved portfolios`, `My Watchlist`, `Key checked`, `Data from`: no stale hit (`Start a scenario` is already what the specs use).
- Nothing under `tests/`.

## Unrequested comment edits (listed, per the surgical-changes rule)

Comment-only: `src/app/scenario-share/[token]/share-resolve.ts` (one phrase), `src/app/(dashboard)/allocations/components/SavedScenariosList.tsx` (one phrase), `src/app/(dashboard)/allocations/lib/strategies-row-adapter.ts` (one sentence), `src/lib/allocation-helpers.ts`, `src/components/strategy/FactsheetPreview.tsx`, `src/components/layout/Sidebar.tsx`, `src/components/layout/MobileNav.test.tsx`, `src/components/strategy/StrategyTable.manager-rows.test.tsx`, `scripts/copy-census/scan.ts`, `src/lib/wizardErrors.ts`. Each was named by a recorded pin or a stale-comment finding above. `src/lib/wizardErrors.ts` is the one with a gate consequence (census row retired).

## eslint.config.mjs (D-21)

Task 3 start: `HEAD=6d7de6718796d884f821450987afb2eee2f51847` (the file equals `git show HEAD:eslint.config.mjs`). Task commit `fd615cb87`. `git diff 6d7de6718..HEAD -- eslint.config.mjs`: `31 insertions(+), 29 deletions(-)`, and every changed line is a comment (a filter for non-comment changed lines prints 0; the config still loads as 22 entries).

Before (the BP-03 audit note and the off-glob note):

```
//     BP-03 AUDIT NOTE — "error repo-wide" is satisfied as "error
//     everywhere EXCEPT the documented frozen-chart islands". The frozen
//     EquityChart (...) and the three chart-internal factsheet SVGs
//     (TimeSeriesChart/HistogramChart/MasterBrush) carry raw `text-[Npx]`
//     sites that can NEVER migrate: they are in the FROZEN_ISLANDS
//     git-diff-zero list at phase-52-frozen-spine-guards.test.ts:158, so
//     any byte edit reds the frozen-spine guard. ... NEVER to edit them.
```

After:

```
//     BP-03 AUDIT NOTE — "error repo-wide" is satisfied as "error
//     everywhere EXCEPT the chart files that still carry raw px". ...
//     sites. They were frozen islands when this block was written; they have
//     since LEFT the `FROZEN_ISLANDS` git-diff-zero list in
//     src/__tests__/phase-52-frozen-spine-guards.test.ts by reviewed edits
//     (the reasons are written beside that list; read the current members
//     there, by symbol, not from this comment). The raw px sites remain, so
//     the `off` glob below stays: it is what keeps the repo-wide `error`
//     flip passing for them. ...
```

The second off-glob block, the allocations and factsheet "frozen" remarks and the `[id]` escaping note were corrected the same way ("chart files", "they carry raw px"). The four chart files still carry raw px (`text-[Npx]` counts 5, 5, 4 and 1), which is why the glob stays. The current `FROZEN_ISLANDS` members are not restated (cite by symbol). No rule changed.

## TODOS.md

- `197-STRATEGY-NAME-PSEUDONYM-01`: closed 2026-11-11 (D-09, D-17), naming `route.test.ts` T12a, T12a-draft, T12d, T29-merge, T29-merge-control, `CompareAddStrategy.real-name.test.tsx` (two arms), the tearsheet page test and the `page.metadata.test.tsx` draft arm, each RED-proven in the 201-02, 201-07 and 201-26 SUMMARYs.
- `[197-VOL-SIGN-TEARSHEET-COMPARE]`: closed (D-15, D-25) on the `figure-parity-pages.test.tsx` CompareTable exact-text arm (neutered RED in 201-04). The close states what is and is not pinned: the tearsheet's Ann. Vol already printed through `pct` (no plus) at the phase base, so only `CompareTable` carried the sign; the tearsheet's unsigned non-zero text holds by construction, with value parity and the unsigned zero test-pinned.
- `[197-COMPARE-NAME-PSEUDONYMITY]`: closed on the founder decision "Real name everywhere" (D-09) and what the three surfaces print; worded as agreement by reads and tests, not as one resolver call (`CompareTable.tsx` makes none).
- `196-STYLE-DRIFT-CENSUS-BLIND-01`: restated, stays OPEN. Plan 201-09 edited `BatchDPanels.tsx` (the Term key), but the counter and the two small-sample notes are unchanged and no per-half decision was recorded, so the close condition was not met.
- `167.1.2.2-BYBIT-STATIC-EGRESS`: dated Phase 201 paragraph (F-12, U-29 deferred, A-12) from plan 201-32's `todos-egress:` line; names `/security#egress-ips` and U-29; no address literal. Entry open, gate unchanged.
- Acceptance greps, checked inside each entry's own section (header to the next `###`, because a `-A30` window reaches the neighbouring entry's `CLOSED 2026-11-10` and passes with no edit): each of the three Phase 197 sections holds exactly one `CLOSED 2026-11-11`; the 196 entry holds `Restated 2026-11-11`; the egress section holds `/security#egress-ips` and `U-29` and no dotted-quad address in the added text.

## Gates (final state)

Pasted outputs, repo-relative paths only.

- `npm run lint`: exit 0, `0 errors, 4 warnings` (the four are pre-existing: `nativeUnitReason` unused in `MetricsColumn.tsx` is present at the base, and `composite-read-path.ts` and `queries.stale-analytics-detail.test.ts` have no commit in the phase). Then `[check-admin-route-manifest] OK`, `[check-route-contract] OK — 48 page routes`, `[check-planning-hygiene] OK — 11352 tracked files scanned`, `ROADMAP-STRUCTURE (rule 6) OK`, `STATE-POSITION (rule 7) OK`, `[check-canonical-domain] OK`.
- `node scripts/verify-plan-anchors.mjs --pending` (the CI mode): `claims: 7 checked`, `OK: 1 plan file(s), no stale claims.` (the only pending plan is this one). `--self-test`: `SELF-TEST OK`.
- `node scripts/verify-plan-anchors.mjs <all 201-*-PLAN.md>` (the plan's glob form): `claims: 238 checked`, `FAIL: 16 stale claim(s) across 34 plan file(s)`, and it fails identically against the canonical plan copies. All 16 are `symbol-absent` claims about code a Phase 201 plan removed on purpose (the symbol is present at the base and absent at HEAD in every case): `FULL_RECORD_BASIS`, `METRIC_TOOLTIPS`, `formatIsoDay`, `formatAbsoluteDate`, `strategyCodename`, `MONTH_HEADERS`, `formatIsoMonth`, `formatCalendarDate`, `savePreferences`, and `toLocaleDateString` in `BridgeWidget.tsx`, `SyncProgress.tsx` and `SavedScenariosList.tsx` (plans 01, 03, 07, 10, 11, 13, 14, 15, 16, 17, 18, 27). A plan is a claim about the pre-execution tree, so an executed plan cannot satisfy the all-plans form; the form the repo runs in CI (`--pending`) is green. This is why Task 3's `<automated>` as written exits non-zero.
- Planning-reading and regression guards (`npx vitest run` on `phase-52-frozen-spine-guards`, `check-planning-hygiene`, `verify-plan-anchors`, `contracts/ci-docs-path-filter.contract`, `critical-regressions`, `figure-gate-census`, `factsheet-census/count`, `figure-parity-pages`, `public-truth-census`, `copy-census`): `Test Files 10 passed (10)`, `Tests 531 passed (531)`.
- Codename-first count: the plan's grep prints `0` (3 at the phase base).
- `npx tsx scripts/copy-census/run.ts --summary`: `remaining files=0 A=0 B=0 C=0 exceptions=35` (plan 201-23 recorded 36; the one row retired here is the stale `wizardErrors.ts` quote).
- Full suite: see Baseline and the run of record above.

## reported-not-edited

None of the Phase 201 SUMMARYs recorded a `reported-not-edited:` item that names a file needing a change; every one says none. This plan edited none of `ApiKeyManager.tsx`, `ConfirmKeyChangeDialog.tsx`, `e2e/api-key-flow.spec.ts` or `e2e/sync-analytics-flow.spec.ts`.

One item for the orchestrator, carried from plan 201-18's deviation 2 (not a `reported-not-edited:` line): plan 18 kept a one-line `formatDay` change in `src/components/strategy/ApiKeyManager.tsx` (the "Key checked" stamp) made by an interrupted executor in commit d78f7f5be, after phase 200's PR was already in the base. Decision for the orchestrator: keep it (the copy census needs it to reach zero pending) or drop it and give plan 18 an `ApiKeyManager.tsx` exception. This plan did not touch it.

## Human verification

No Playwright, screen reader or browser ran here. Three checks remain for a person:

1. **KPI-strip underline (plan 201-12 `human-verify:`, UI-SPEC backstop "overflow").** Overview tab at 390px and 1440px: the dotted Term underline on YTD TWR, Sharpe, Max DD 12m and Avg |rho| must not collide with the delta pill or the caption under the label.
2. **Long real names (plan 201-15 `human-verify:`, UI-SPEC backstop "long-text").** The browse drawer, the Add allocation search rows, the tearsheet manager card and the compare search rows with a long real strategy name at 390px and 1440px: the name wraps or truncates, the full name is recoverable by `title`, and the codename line appears only when it differs from the name.
3. **VoiceOver on a Term trigger (UI-SPEC backstop "populated").** On a Form A trigger (a bare label, e.g. Sharpe) and a Form B trigger (a term inside a heading or `<summary>`, e.g. Calmar by Year or Max Drawdown): focus announces the label and then the definition.
4. The two narrowcharts fixtures (`My allocation`) are proven only by grep and CI (`e2e-seeded`); if that run reds on a label, regenerate them on the local-stack lane with the commands in the `layout-narrow.spec.ts` header.

## Deviations from Plan

**1. [Rule 3 - Blocking] The plan's exclude form cannot run.** `--exclude` is ignored by the multi-project vitest config. Run of record is the plain full suite with the two base-identical failures named; nothing in the config or the snapshot was touched.

**2. [Rule 1 - Test could not fail] Three vacuous absence arms.** `AllocationsTabs.onboarding.test.tsx` had three `queryByText("Mandate quick-set") ... toBeNull()` arms that passed with the card present once `Mandate` became a Term. Fixed with the helper and neutered RED. A scan of the corpus for the same shape (an absence assertion on a multi-word string led by a registered term label, absent as a contiguous string from non-test source) found no other instance.

**3. [Rule 2 - Stale claim] `wizardErrors.ts` comment and its census exception.** The plan's census (plan 201-23) pinned 36 exceptions, one of them quoting the route's old terminal sentence. Correcting the comment retired that row and the pinned count moved to 35, in the same commit, with the census reading 0 hits.

**4. [Finding] The all-plans anchor check cannot pass after execution** (16 `symbol-absent`, table above). The CI mode is green.

**5. [Finding] The `[197-VOL-SIGN-TEARSHEET-COMPARE]` Reading was partly stale** (the tearsheet already printed volatility unsigned at the base); recorded in the close.

No Rule 4 stops. No auth gates. No phase-200 file edited.

## Known Stubs

None.

## Threat Flags

None. Test, fixture, comment and ledger edits only; no endpoint, auth path or schema change.

## Self-Check: PASSED

- Files created: `.planning/phases/201-plainwords-one-name-per-concept-explained-and-the-small-inco/201-24-SUMMARY.md` (this file).
- Commits `967184cd3`, `ca0a15fbb`, `6f2808adb`, `6d7de6718`, `fd615cb87` and `81ca4dfa6` are ancestors of HEAD (`git merge-base --is-ancestor`).
- `git worktree list` shows no base worktree; `ApiKeyManager.tsx`, `ConfirmKeyChangeDialog.tsx`, the two e2e specs, `STATE.md` and `ROADMAP.md` are not in `git diff --name-only plan_head_before..HEAD`.
