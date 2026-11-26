---
phase: 236-figuremath-every-engine-annualizes-one-way-cvar-is-historica
plan: 09
subsystem: figure-close-out
tags: [census, reviewed-act, fleet-rederive-runbook, figures-moved, todos, freeze-check, phase-gate, og-cache]
requires: [236-07, 236-08, 236-11]
provides:
  - "FIG-01 arm in both censuses: NOT_YET_MIGRATED is empty and the named engine set (12 TS, 5 Python) passes both arms"
  - "dated Phase 236 reviewed-act blocks in phase-29 and phase-52 frozen-spine guard files naming F-5, Q1, Q2 and every moved pin"
  - "docs/runbooks/figuremath-fleet-rederive.md: the coordinator's PROD re-derive, not run"
  - "236-FIGURES-MOVED.md: every figure that moves, grouped for the CHANGELOG, with the freeze side and the OG cache measurement"
  - "TODOS.md without the four entries this phase closes"
  - "OG_CARD_VERSION 3 to 4"
affects: [ship]
key-files:
  created:
    - docs/runbooks/figuremath-fleet-rederive.md
    - .planning/phases/236-figuremath-every-engine-annualizes-one-way-cvar-is-historica/236-FIGURES-MOVED.md
  modified:
    - src/__tests__/annualization-census.test.ts
    - analytics-service/tests/test_annualization_census.py
    - src/__tests__/phase-29-frozen-spine-guards.test.ts
    - src/__tests__/phase-52-frozen-spine-guards.test.ts
    - TODOS.md
    - analytics-service/tests/test_figure_gate_span.py
    - src/lib/factsheet/og-metrics.ts
    - src/lib/factsheet/og-metrics.test.ts
    - src/lib/factsheet/record-length.ts
    - src/lib/factsheet/record-length.test.ts
    - src/app/factsheet/[id]/v2/MetricsColumn.cagr-span.test.tsx
decisions:
  - "OG_CARD_VERSION bumped 3 to 4: a rendered card is cached 24 h at the CDN plus 7 days of stale-while-revalidate, far past the one day the rule allows"
  - "The stored-figure re-derive is the product's own enqueue_compute_job for kind compute_analytics_from_csv (no exchange I/O), with a version-defined target set; enqueue_ledger_refresh_for_strategies is explicitly NOT the fleet path"
  - "The CAGR span line prints through formatDay (the repo's one UI date) because the copy census refuses a second month list"
metrics:
  completed: 2026-11-25
status: complete
actuals:
  tokens: 11235
  tasks: 3
  commits: 8
plan_head_before: c94175c8a29f4ad0bd50993cbac09479a977cd2e
plan_head_after: ee5c80bdd10a2b1880d7e1ce226d8d513e57d4a1
---

# Phase 236 Plan 09: close-out Summary

The migration lists are proven empty in both languages, the frozen spine is re-baselined as a reviewed act, the fleet re-derive is handed to the coordinator as a runbook, the figures that move are written down for the CHANGELOG, the four TODOS entries are deleted, 236 is measured to merge before 155.2 plan 12's recapture, and the phase-wide gate is green. **FIG-05 stays pending: the fleet re-derive is the coordinator's PROD write and is not recorded.**

## Commits

| Work | Commit | What |
|---|---|---|
| Task 1 (tracer) | 2eed307ce | FIG-01 arm in both censuses, the dated reviewed-act blocks in both guard files |
| OG cache | 590d347be | `OG_CARD_VERSION` 3 to 4, pinned past 3 in `og-metrics.test.ts` |
| Task 2 | 91d3b0e61 | runbook, figures-moved list, TODOS deletions, docstring repoint |
| Gate fix (plan 11 scope) | a069e0907 | the span line prints through `formatDay` (copy census rule C) |
| Task 3 | 89ea89fbe | the freeze side in the figures-moved list |
| SUMMARY (first version) | d70b324c9 | this file, as first written (counted in `commits`, which is measured over `plan_head_before..plan_head_after`) |
| Review fix | ee5c80bdd, and the commit before it | the reviewed-act blocks no longer say the constit capture writer never ran; the runbook's closing read counts rows that left the complete set, names the per-basis limit and the three freeze cases |

`actuals.tokens` is chars / 4 over the added lines of the realised diff, this SUMMARY excluded (44,940 characters). `commits` is `git rev-list --count c94175c8a..ee5c80bdd`.

## Task 1: censuses and the reviewed act

`NOT_YET_MIGRATED` was already `[]` in both languages (plan 04 emptied Python, plan 05 TS). The new arms (`FIG-01: NOT_YET_MIGRATED is empty and every RESEARCH section 1 engine file is an engine passing both arms`, Python `test_fig01_not_yet_migrated_is_empty_and_every_engine_passes_both_arms`) assert the list is empty, pin the engine set BY NAME independent of `CENSUS` (12 TS, 5 Python, so deleting an engine entry to dodge both arms fails by file), and run both arms over each. The phase-29 and phase-52 guard files each carry a "Phase 236 FIGUREMATH, 2026-11-25" block quoting F-5, Q1 and Q2 from CONTEXT, listing every moved pin (file, old, new, plan), stating that `regen_golden.py` was not run, that the goldens moved by hand only for `figure_defs_version`, the two span keys and the quantstats `serenity_index` key, and that `constit_parity_golden.json` `kpis.cagr` was moved by hand from the stated whole-day derivation, not from capture output (a vitest run invokes the capture writer, whose generator carries the hand-moved note so a capture run reproduces the file). No guard is deleted or inverted; no island is added or removed in phase-52.

## PROOF-01 (byte backups in the scratchpad, restored with `cp`, verified with `cmp`; verbatim)

(a) `src/__tests__/annualization-census.test.ts`: `NOT_YET_MIGRATED` set to `["src/lib/factsheet/compute.ts"]`.
```
     × FIG-01: NOT_YET_MIGRATED is empty and every RESEARCH section 1 engine file is an engine passing both arms 3ms
     × NOT_YET_MIGRATED is exact: a listed file that already passes both arms must be removed 0ms
AssertionError: an engine parked in NOT_YET_MIGRATED is an unmigrated annualizer: expected [ 'src/lib/factsheet/compute.ts' ] to deeply equal []
 Test Files  1 failed (1)
      Tests  2 failed | 8 passed (10)
RESTORED cmp OK (a)
 Test Files  1 passed (1)
      Tests  10 passed (10)
```
(e) the Python twin: `NOT_YET_MIGRATED = ["analytics-service/services/metrics.py"]`.
```
E       AssertionError: an engine parked in NOT_YET_MIGRATED is an unmigrated annualizer
E       AssertionError: already migrated: remove from NOT_YET_MIGRATED
FAILED tests/test_annualization_census.py::TestEngineArms::test_fig01_not_yet_migrated_is_empty_and_every_engine_passes_both_arms
FAILED tests/test_annualization_census.py::TestEngineArms::test_not_yet_migrated_is_exact
2 failed, 15 passed in 4.89s
RESTORED cmp OK (e)
17 passed in 4.80s
```
(b) `src/lib/closed-sets.ts` line 721 `wholeCalendarDays(firstDateMs, lastDateMs) / CALENDAR_DAYS_PER_YEAR;` replaced by `... / 366;`.
```
       × calendarYears: whole days of the first-to-last span over 365 (the CAGR clock, F-5 / Q1) 3ms
       × calendarYears floors a span with a 12-hour residue to whole days (Python Timedelta.days) 0ms
       × calendarYears keeps an emptied stretch in the span (Q1): only the first and last dates count 0ms
     × [gap-axis] calendar-span CAGR diverges from the retired count-based CAGR 2ms
     × [emptied-stretch] a month with no observations stays in the CAGR span (Q1: first to last date) 0ms
     × positive arm: a migrated engine references every constant of its must_use list 4ms
     × FIG-01: NOT_YET_MIGRATED is empty and every RESEARCH section 1 engine file is an engine passing both arms 2ms
AssertionError: expected 0.9972677595628415 to be 1 // Object.is equality
 Test Files  3 failed (3)
      Tests  7 failed | 109 passed (116)
RESTORED cmp OK (b)
 Test Files  3 passed (3)
      Tests  116 passed (116)
```
(c) `analytics-service/services/portfolio_metrics.py` line 118 `/ CALENDAR_DAYS_PER_YEAR for` replaced by `/ 366 for`.
```
E         Left contains one more item: 'analytics-service/services/portfolio_metrics.py: never uses CALENDAR_DAYS_PER_YEAR'
E         Left contains one more item: "analytics-service/services/portfolio_metrics.py: literal [] missing ['CALENDAR_DAYS_PER_YEAR']"
E       assert 0.0004600071204696188 < 1e-06
E       assert 0.0002872736636747031 < 1e-06
E       assert 0.0002872736636747031 < 1e-06
FAILED tests/test_annualization_census.py::TestEngineArms::test_positive_arm
FAILED tests/test_annualization_census.py::TestEngineArms::test_fig01_not_yet_migrated_is_empty_and_every_engine_passes_both_arms
FAILED tests/test_portfolio_metrics.py::test_mwr_known_sequence - assert 0.00...
FAILED tests/test_portfolio_metrics.py::test_mwr_single_outflow_one_year_exact_irr
FAILED tests/test_portfolio_metrics.py::test_mwr_terminal_not_double_counted_when_net_cf_nonnegative
5 failed, 34 passed in 4.99s
RESTORED cmp OK (c)
39 passed in 4.89s
```
(d) `src/lib/scenario.test.ts` line 1214 `const CAL_DAYS_PER_YEAR = 365;` replaced by `= 365.25;` (the old expected year restored).
```
     × [gap-axis] calendar-span CAGR diverges from the retired count-based CAGR 2ms
     × [emptied-stretch] a month with no observations stays in the CAGR span (Q1: first to last date) 0ms
AssertionError: expected 0.13281 to be close to 0.13290249911752894, received difference is 0.00009249911752892692, but expected 0.00005
AssertionError: expected 0.16603 to be close to 0.166155720653673, received difference is 0.00012572065367300045, but expected 0.00005
 Test Files  1 failed (1)
      Tests  2 failed | 55 passed (57)
RESTORED cmp OK (d)
 Test Files  1 passed (1)
      Tests  57 passed (57)
```
(og) `src/lib/factsheet/og-metrics.ts`: `OG_CARD_VERSION = "4"` moved back to `"3"`.
```
     × is past 3, the version whose card carried the 365.25-day year and the population sd 2ms
AssertionError: expected 3 to be greater than or equal to 4
 Test Files  1 failed (1)
      Tests  1 failed | 38 passed (39)
RESTORED cmp OK (og)
 Test Files  1 passed (1)
      Tests  39 passed (39)
```
In (b) and (c) the census positive arm and the pin fire together; in (a) and (e) the FIG-01 arm is listed first. The copy-census gate that caught plan 11's month list was RED before the fix (`unregistered: src/lib/factsheet/record-length.ts:38 rule C`) and GREEN after, so the root-cause fix was observed to bite.

## Task 2: runbook, figures-moved list, TODOS

**Runbook** (`docs/runbooks/figuremath-fleet-rederive.md`): preconditions including the fresh 155.2 re-check, the marker query verbatim first, the before read (one row per non-composite strategy, scratch only) and the allocator MWR read, the traced enqueue path, the version-defined target set, a 10-strategy batch with a stop-on-first-failure rule, the verification (`figure_defs_version = 3`, `computed_at` after the enqueue time, never `last_sync_at`; it counts every non-composite strategy with an analytics row and reports `outside_complete_set`, so a failed recompute cannot leave the population and read as done), and the after read and per-figure diff for the CHANGELOG. Nothing in it was run; no database was touched.

The enqueue trace, from the code at HEAD:
- Stored strategy figures (API-key and CSV alike) come from the chain tail `compute_analytics_from_csv`: pure math over stored daily returns, no exchange I/O, 10 minute budget. Product function: `public.enqueue_compute_job(p_strategy_id, 'compute_analytics_from_csv')`. Precedent: the OKXHISTORY close-out.
- `enqueue_ledger_refresh_for_strategies()` is NOT the fleet path: stale-only, LIMIT 4 per tick and 2 per venue, 20 hour attempt cooldown (7 days under the weekly caps), enqueues `derive_broker_dailies` (an exchange crawl that chains into the same tail), dormant unless `system_flags.ledger_refresh_enabled`.
- Allocator XIRR is `allocator_equity_derived` kind `equity_curve`, `payload.scalars.mwr`, written by the crawl-free `derive_allocator_equity` compose. The daily `derive-allocator-key-dailies` cron (`enqueue_derive_broker_dailies_for_allocator_keys()`) reaches every active key and each finished derive enqueues the compose, so the allocators self-heal within a day; a forced run is `enqueue_compute_job(NULL, p_allocator_id := id, 'derive_allocator_equity')`.
- The tail rewrites the cash headline and the `cash_settlement` series row; the `mark_to_market` and `smoothed_mtm` entries of `metrics_json_by_basis` are written by the derive hop, which this path does not run. They stay on the old rules until the next derive hop and the factsheet reads computed figures for them through the per-basis version gate meanwhile. The runbook says so and reports `old_per_basis` as information, not a done gate; to move them at once the coordinator enqueues `derive_broker_dailies` for those strategies instead (it chains into the same tail).
- The batch tag `source = 'figuremath-236-rederive'` is none of the two values (`'ledger-refresh'`, `'ledger-refresh-composite'`) that the SQL status bridge, `_record_enqueue_dedup` and the worker compare exactly, so all three read the job as unmarked and agree on a failure. Each explicit enqueue is also an attempt the ledger fan-out's 20 hour cooldown reads, so the batches are timed after the daily tick.
- "No row recomputes twice" is by construction: a target is a strategy whose stored `figure_defs_version` is not 3, so any recompute (this runbook's or the nightly chain's) removes it from the set; in-flight and `failed_final` rows are skipped.

**TODOS deletions.** Suites that read TODOS.md, before and after (identical):
- `npx vitest run src/__tests__/audit-coverage.test.ts src/__tests__/gate-family-meta.test.ts src/lib/closed-sets.test.ts`: before `Test Files  3 passed (3)` / `Tests  98 passed (98)`; after the same.
- from `analytics-service/`, PY086 `pytest tests/test_mt5_relogin.py tests/test_phase12_deploy.py -q -p no:cacheprovider`: before `334 passed, 1 warning in 6.63s`; after `334 passed, 1 warning in 6.17s`.

Deleted (43 lines, 0 added): the `[194-ENGINE-CONSTANTS]` entry; the `167.1.2.2.1-CAGR-EMPTY-SPAN` entry; the `### QUANTSTATS-0086-REDERIVE-01` heading and its own three paragraphs; the non-composite Backbone-bypass bullet (its text names `_compute_portfolio_analytics`, `equity_reconstruction.py`, the TS stats files and matching, no composite surface, so it was deleted whole). `- [ ]` lines in TODOS.md: **163 before, 163 after** (the deleted entries held none of their own). The QUANTSTATS heading was followed by about 590 lines of unrelated open `- [ ]` entries (old lines 500 to 1091, up to `### RANK-SPLAT-01`); they are unchanged and now begin at line 483, directly after the `UPSTASH-RATELIMIT-KEY-LOCKING-01` entry, so they sit textually under that preceding `###` heading. `git grep` for the four ids outside `.planning` and `CHANGELOG.md` exits 1 (none). `test_figure_gate_span.py`'s docstring now says the unknown-leg 252/365 asymmetry is deliberate and unowned since Phase 236; its assertions are untouched.

**OG share card cache.** Measured in the OG route: a rendered terminal card is `public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800`. A card cached under the old rules could therefore keep answering for a day at the CDN plus up to 7 days stale while revalidating, and unfurlers key by URL on their own clocks. That is more than a day, so `OG_CARD_VERSION` moved 3 to 4 with a pin (PROOF-01 (og) above). The TTL was not shortened.

## Task 3: freeze check and phase-wide gate

Freeze side, run after a fresh `git fetch origin main` (fetch exit 0):
```
T=$(git ls-tree -r --name-only origin/main -- .planning/phases/)
printf '%s\n' "$T" | grep -a -c '155.2-12-SUMMARY.md'
0
git rev-parse origin/main
0fd4e8e49788920802e345b88d41b9d414c8c404
```
236 merges BEFORE 155.2 plan 12's recapture (`155.2-12-SUMMARY.md` is absent; plan 12's PLAN file is present). Recorded in `236-FIGURES-MOVED.md` section 9 too. It is true only until 155.2 plan 12 lands, so the ship step re-checks it before the push.

Phase-wide gate on the final tree (Node 22.22.1 from the `node@22` Homebrew keg, `.nvmrc` is 22; PY086 quantstats 0.0.86), verbatim:
```
npx vitest run
 Test Files  1270 passed | 20 skipped (1290)
      Tests  27513 passed | 306 skipped (27819)
   Duration  374.30s

cd analytics-service && PY086 -m pytest -q -p no:cacheprovider -n 4
16730 passed, 93 skipped, 867 warnings in 237.21s (0:03:57)

cd analytics-service && PY086 -m mypy --strict --follow-imports=silent --config-file=pyproject.toml services/ routers/ models/ main.py main_worker.py main_worker_healthz.py sentry_init.py
Success: no issues found in 144 source files

npx tsc --noEmit -p tsconfig.json
(no output, exit 0)

npm run lint
✖ 4 problems (0 errors, 4 warnings)   (unused-var warnings in untouched files; exit 0)
[check-planning-hygiene] OK ... ROADMAP-STRUCTURE (rule 6) OK ... STATE-POSITION (rule 7) OK
```
Two earlier full runs were not green and are recorded honestly. Run 1 (after the TODOS commit, before the gate fix): `Test Files  3 failed | 1267 passed | 20 skipped (1290)`, `Tests  3 failed | 27510 passed | 306 skipped (27819)`. Only the tail of that output was kept, and it shows one failure by name: `FactsheetBody.advanced.test.tsx:179` (`lsStore.get(ADVANCED_KEY)` undefined inside a `waitFor`). The other two names were not captured. Run 1 came after the TODOS edit and before the `formatDay` fix, so the two failures run 2 names (`copy-census`, `verify-plan-anchors --pending`) were already present then; run 1 was therefore most likely those two plus the `FactsheetBody.advanced` flake. That is inferred, not measured. `FactsheetBody.advanced.test.tsx` alone on Node 22.22.1: `Test Files  1 passed (1)`, `Tests  26 passed (26)`, so it is the jsdom load-timeout flake earlier plans recorded, and it passed in runs 2 and 3. Run 2: 2 failed, both real: `copy-census.test.ts` (plan 11's hand-rolled month list in `record-length.ts:38`, fixed at the root, see Deviations) and `verify-plan-anchors.test.ts --pending` (this plan's four `verify-symbol` anchors went stale when its own TODOS and docstring edits landed; it clears once the plan has its SUMMARY, and run 3 was green with the SUMMARY present). Run 3 above is the final tree.

## Deviations from Plan

**1. [Rule 1 - bug owned by plan 236-11] The CAGR span line carried its own month list.** Found by the phase-wide gate: `copy-census.test.ts` rule C refused `MONTHS = ["Jan", ...]` in `src/lib/factsheet/record-length.ts`. The repo has one UI date (`formatDay`, Phase 201 D-11). Fixed at the root, not by adding an exception row (which would have moved the pinned exception count and contradicted D-11): `formatCagrSpan` now prints through `formatDay`, so the line reads `CAGR over Mar 14, 2024 to Nov 2, 2025 (598 days)` with the helper's no-break spaces instead of `14 Mar 2024 ... 02 Nov 2025`. The expected strings in `record-length.test.ts` and `MetricsColumn.cagr-span.test.tsx` were rewritten from that format as literals (not read off the engine); the day counts are unchanged. Commit a069e0907. This is a display-format change of a line plan 11 introduced in this same unmerged phase; nothing shipped carried the old format.

**2. [Rule 2 - missing decision] OG card cache.** Plan 02 left the `OG_CARD_VERSION` bump open and the brief asked for a measurement; done (bump 3 to 4) with a pinning test in `og-metrics.test.ts`, a file the plan did not list.

**3. [Plan wording] Task 1's empty-list arm already held.** The lists were already empty, so the new arms prove emptiness and pin the engine set by name rather than shrinking anything.

**4. [Environment] Node.** The default `node` on this machine is 25.8.1; the whole-repo run used the 22.22.1 keg on `PATH` for that command only.

**5. [Runbook scope note] One line about composites.** The runbook says nothing about composite or Binance legs beyond the selection filter `lrs.is_composite = FALSE` and one scope sentence ("out of scope per F-2"); the plan said to say nothing, but a target query that did not exclude composites would enqueue the wrong kind for them.

No architectural changes, no auth gates, no package installs, no database access.

## Known limits

- `.planning/REQUIREMENTS.md` (FIG-01, FIG-03, FIG-04, FIG-05 rows) and `.planning/STATE.md` (line 1111) still name the deleted TODOS ids. They are historical records and outside this plan's verify scope; left as they are. No requirement was marked complete here, and FIG-05 stays pending.

- The runbook's SQL forms were written against the baseline schema and function bodies at HEAD and were not executed (no PROD access by instruction). The coordinator runs the marker query first and reads the `targets` count before the first write.
- The recompute job carries no ledger-refresh marker (same as the OKXHISTORY recompute), so a failure on a published strategy takes the runner's loud path; the batch size 10 and the stop rule exist for that.
- `FactsheetBody.*` / `FactsheetView.*` jsdom tests are load-sensitive (5 s timeout) under a full-suite run; they pass in isolation and in the green run.

## Known Stubs

None.

## Threat Flags

None. T-236-19 (re-derive run from a plan) mitigated: the runbook is the only artifact and no write was run. T-236-20 mitigated: the open-entry count is 163 before and after, and only the heading and its own paragraphs went. T-236-21 mitigated: both guard blocks name each moved pin and `regen_golden.py` was never run. T-236-24 mitigated: the freeze check read 0 on a fresh `origin/main`.

## Self-Check: PASSED

Created files exist (`docs/runbooks/figuremath-fleet-rederive.md`, `236-FIGURES-MOVED.md`); commits 2eed307ce, 590d347be, 91d3b0e61, a069e0907, 89ea89fbe and ee5c80bdd are ancestors of HEAD; `commits: 8` is measured from the plan ledger (`c94175c8a..ee5c80bdd`); `git status --short` is clean apart from this SUMMARY; `STATE.md` and `ROADMAP.md` were not edited.
