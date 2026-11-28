---
phase: 256-okxunitswitch
verified: 2026-11-27T23:59:00Z
status: passed
score: 7/7 must-haves verified (SC-5 read on PROD 2026-11-28; SC-7 review verdicts recorded in the orchestrator addendum); one visual UAT item stays with the founder
verified_at_sha: 9ed5cfce35eb8a97d7f1af5959474d4d39e59913
drift_subjects:
  - analytics-service/services/unit_switch.py
  - analytics-service/services/unit_switch_series.py
  - analytics-service/services/exchange.py
  - analytics-service/services/job_worker.py
  - analytics-service/services/analytics_runner.py
  - analytics-service/services/allocator_equity_compose.py
  - analytics-service/services/broker_dailies.py
  - analytics-service/services/transforms.py
  - supabase/migrations/20261127200000_strategy_analytics_unit_segments.sql
  - src/lib/factsheet/unit-segments.ts
  - src/lib/factsheet/fetch-and-build-payload.ts
  - src/lib/queries.ts
  - src/app/factsheet/[id]/v2/FactsheetView.tsx
  - src/app/factsheet/[id]/v2/TimeSeriesChart.tsx
  - src/app/factsheet/[id]/v2/chart-configs.ts
  - src/app/api/strategies/[id]/returns/route.ts
  - src/app/api/og/factsheet/[id]/route.tsx
  - src/components/strategy/UnitSwitchChip.tsx
behavior_unverified: 0
overrides_applied: 0
human_verification:
  - test: "Plan 07 visual backstop: on the founder's factsheet the break between the USD and BTC segments reads as a break on screen, in print preview and in an exported SVG."
    expected: "Two separate accent lines meeting only in x, a figcaption naming the switch."
    why_human: "Visual appearance; carried from 256-07 and 256-10 open items."
---

# Phase 256: OKXUNITSWITCH Verification Report

**Phase Goal:** An OKX account whose P&L was in USDT and which then moves into a coin is reported in USD up to the switch and in that coin after it, on every surface, and the derives that fail today end `done` and unfreeze the strategies they hold.
**Verified:** 2026-11-27, at branch gsd/phase-256-okxunitswitch HEAD (full sha in frontmatter)
**Status:** passed (2026-11-28, after the SC-5 PROD read; the chart-break visual UAT stays with the founder)
**Re-verification:** No, initial verification

Founder rulings applied as the contract (latest wins): CR-01 then R2-01 (switch day = first end-of-day at 95% coin and staying; 11-21 first coin return day for the measured account, last USD day 11-20), then R3-03 (switch back needs 7 consecutive days under 50%). Survivors R3-02, R3-04, R3-05, R3-07 and SF3-01 are Phase 261 and are not counted as gaps.

## Goal Achievement

### Observable Truths (ROADMAP success criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Switch date derived from data, never hard-coded; two differently shaped accounts give their own dates; the founder's account gives the ruled date; a missing or ambiguous date refuses by a named reason | VERIFIED | `derive_unit_switch` in `services/unit_switch.py` reads only census and end-of-day holdings; closed `UNIT_SWITCH_REFUSALS` (10 tokens, each with a defining test). `test_differently_shaped_account_derives_its_own_dates` and `test_founder_shaped_account_derives_its_switch_from_data` (S = 2026-11-20, first coin day 2026-11-21, per the superseding R2-01 ruling) pass. The original "11-15" wording is superseded by CR-01 and R2-01 as recorded in the ROADMAP and CONTEXT. |
| 2 | Two-unit series stored with each segment's unit named; design recorded; boundary day carried once in one unit | VERIFIED | `strategy_analytics.unit_segments` jsonb (object CHECK) is on main under migration 20261127200000 (present at this HEAD, untouched by the branch); `_unit_segments_payload` in `job_worker.py` writes it; key mode carries it additively in `key_inputs`. `split_daily_pnl_at_switch` puts every day in exactly one unit; `test_boundary_oracle_each_day_is_in_exactly_one_unit` passes. |
| 3 | Every reader states its rule; no cross-unit return, vol, drawdown or correlation on a mixed series; each reader has a test that is RED on origin/main | VERIFIED | Headline is one whole-history USD series (`unit_switch_series.py`), so Python readers (runner, wealth_returns, matching, match, portfolio, simulator) read plain USD: one named test each in `test_okx_unit_switch_readers.py` (each first asserts the derive ends DONE, which main refuses). Chart draws two separate native segments (`TimeSeriesChart.unit-switch.test.tsx`), leverage held at 1x (`FactsheetView.unit-switch-leverage.test.tsx`), KPI note, masthead, list chip, OG note, returns API fields, composites suppressed. The static-pin readers that were already correct on main have no pre-fix RED by design (plan 08 reachability table, 256-10 caveat 4). |
| 4 | BTC fee bills booked in the BTC segment; the 11 bills no longer trip `daily_pnl_non_usd_okx` for this account; a never-switching account and any other coin still refuse by name | VERIFIED | `_okx_book_switched_coin` in `exchange.py`; coin amounts never enter `daily_totals`; `unit_switch` defaults to None and only `run_derive_broker_dailies_job` passes it (AST call-site pin `test_only_the_derive_may_pass_unit_switch`; my grep finds the single call at the derive); `test_a_bill_in_any_other_coin_still_refuses_even_beside_a_switched_one`, no-resolver byte-identical refusal, `coin_without_price_source` for non-BTC. All pass. |
| 5 | The 7 nightly failures end `done` after deploy and the 3 strategies unfreeze, read from PROD | VERIFIED (2026-11-28, PROD) | See "SC-5 post-deploy read (2026-11-28)" below: 7 of 7 derives `done`, 0 strategies still on `read_refusal_kept_figures`, switch BTC / 2026-11-20 / 2026-11-21 stored on all 3, `unit_segments` present on all 3, key inputs 4 with `unit_segments` and 0 with `native_unit`, census `coin=BTC coin_bills=11 coin_days=2`. |
| 6 | Reversal of part of 232-03's VREAD-06 recorded with reason in `232-CONTEXT.md` and the ROADMAP | VERIFIED (with a stale-date warning) | Dated note in `232-CONTEXT.md` (reason: one OKX account froze 3 strategies and failed 7 nightly derives) and the ROADMAP "The part this phase reverses" bullet. See warning 1. |
| 7 | PROOF-01 per gate (RED with named arm, byte-backup restore, GREEN); migration through migration-reviewer and rls-policy-auditor with no MEDIUM+ | VERIFIED for PROOF-01; migration-review verdicts NOT RECORDED | `256-10-SUMMARY.md` indexes 42 gate rows across plans 01-09 plus the SQL CHECK, each with first FAILED line, silent cmp and GREEN; four caveats stated honestly. The migration is DDL/catalogue-only, `256-SECURITY.md` closes T-256-04/05/06 (31/31 threats). The two agent verdicts are not in any artifact (human item 2). |

**Score:** 7/7 truths verified (SC-5 read on PROD 2026-11-28). 0 behavior-unverified: the boundary, persistence-after-ageing, switch-back and fail-closed invariants are each exercised by a named passing test.

### Behavioral Spot-Checks (run by this verifier at the HEAD above)

| Check | Command | Result | Status |
|---|---|---|---|
| Unit-switch, series, derive, fetch, key-mode, readers, ccy, runner, dual-mode, refusal rows, analytics_runner | pytest, 11 files from `analytics-service/` | 567 passed | PASS |
| Neighbouring derive / key-mode / marks / okx / tiny-base / teaser / deribit files | pytest, 16 files | 524 passed | PASS |
| SQL gate census pin flagged red in 256-10 open item 2 | `tests/test_sql_gate_scoped_updates.py` | 4 passed (the map already carries the unit_segments file; the main checkout has the migration) | PASS |
| mypy, CI path set (`make typecheck` paths) | `mypy services/ routers/ models/ main.py main_worker.py main_worker_healthz.py sentry_init.py` | Success: no issues found in 148 source files | PASS |
| Unit-switch vitest files plus touched suites (17 files) | `npx vitest run` | 565 passed | PASS |
| TypeScript | `npm run typecheck` | exit 0, no diagnostics | PASS |
| Wider TS regression sweep (factsheet dir and neighbours) | `npx vitest run` on those directories | Whole-directory runs exceeded the time budget and under parallel load 6 files (FactsheetBody.advanced/basis, FactsheetView.headline-coverage/kpistrip/window-kpis, compute.conventions) showed failures. Re-run in isolation: 374 passed, 2 failed, the two being `compute.conventions` fixtures B and C snapshot mismatches, which also fail on the main checkout (pre-existing, 256-10 open item 8). The load-time failures did not reproduce. The rest of the directory sweep was not completed | PASS for the unit-switch files; sweep INCOMPLETE (CI is the backstop) |

Probe Execution: no probe declared by the plans; SKIPPED. Data-flow (Level 4): the derive writes the headline from real bills, holdings and stored BTC closes (no static return); the panel and API read the stored columns (`queries.ts` projection pins, `fetch-and-build-payload` test).

### Requirements Coverage

ROADMAP Requirements: TBD. No REQUIREMENTS.md ids are mapped to this phase; none orphaned.

### Anti-Patterns Found

None blocking. No TBD, FIXME or XXX added in any non-test source file of the branch. The branch changes no CHANGELOG, VERSION, TODOS or package.json (those are written at ship time).

### Human Verification Required

See frontmatter: (1) SC-5 post-deploy read; (2) record the plan 02 migration-reviewer and rls-policy-auditor verdicts; (3) the plan 07 visual backstop. Also carried from the plans for UI review: the date format `Nov 20, 2026` via `formatCloseDay` instead of the founder's yearless form, plan 08's chip `aria-hidden` choice, and legend and tooltip copy.

### Warnings (non-blocking, fix before or at ship)

1. **Stale switch days in the SC-5 read procedure and in 232-CONTEXT.** `256-10-SUMMARY.md` post-deploy step 4 expects `last_usd_day = 2026-11-14` and `first_coin_return_day = 2026-11-15`, and the `232-CONTEXT.md` "CORRECTED" paragraph (plus the ROADMAP "Cause." bullet's "The derived switch is: last USD return day 2026-11-14 ...") still state the pre-CR-01 dates. The code, tests and the R2-01 ruling give 2026-11-20 and 2026-11-21 for the measured shape. A post-deploy reader following step 4 literally would mark a correct deploy as a mismatch. Correct the expected days in 256-10-SUMMARY step 4 and add a dated superseded-by-R2-01 line to the 232-CONTEXT note (the ROADMAP already says CR-01 and R2-01 supersede it further down).
2. 256-10-SUMMARY open item 3: the new SQL gate was proven on the pg-lane and the mutation runner, not on the local-stack lane; the CI `sql-tests` run on the merged PR-1 is the first baseline-stack run (PR-1 is merged, so this is read from CI, not a code gap).

### Gaps Summary

No code gap. The goal is achieved in the codebase for every criterion that can be read before deploy: the switch is derived from data with named refusals, the headline is one whole-history USD series with the coin part converted at stored daily closes, the two native segments are stored with units named and drawn as a real break, the coin fee bills no longer trip the refusal for a switched coin while every other path still refuses by name, and every changed reader has a test. Status is human_needed only because SC-5 needs the PROD deploy plus a nightly derive, the migration-review verdicts are not recorded, and one visual backstop remains.

---

_Verified: 2026-11-27_
_Verifier: Claude (gsd-verifier)_


## Orchestrator addendum (SC-7 review verdicts and the stale-date warning)
- SC-7 migration review, recorded here: the plan-02 migration (shipped as `20261127200000_strategy_analytics_unit_segments.sql`, PR #1402) passed migration-reviewer with 0 CRITICAL / HIGH / MEDIUM (one LOW, a wrong comment about the CHECK scan, fixed before merge) and rls-policy-auditor with 0 findings (the column inherits exactly `returns_series`' visibility; no view, column-list grant or SECURITY DEFINER reader returns it). Both ran before #1402 merged. The verdicts are also in the #1402 PR body and the v0.133.108.0 CHANGELOG entry.
- Warning 1 resolved: the 232-CONTEXT note, the ROADMAP "Cause." bullet and 256-10-SUMMARY's post-deploy step 4 now carry dated CORRECTED notes giving the derived switch as last USD day 2026-11-20, first BTC day 2026-11-21.
- Warning 3 (visual break check on screen, print preview, exported SVG) stays a human UAT item.

## SC-5 post-deploy read (2026-11-28)

Run on PROD at the coordinator's instruction ("PROD writes through the product's own paths are founder-authorized, so don't wait for 05:30Z"). The marker query named PRODUCTION before the write. The 7 derives (4 key mode, 3 strategy mode) were enqueued at 11:25Z through `enqueue_compute_job`, the same call the nightly cron makes, with a dated idempotency key. Counts, booleans and the two switch days only; no ids or amounts are written here (public repo).

| Step (256-10-SUMMARY procedure) | Expected | Read |
|---|---|---|
| 1 Marker | PRODUCTION | PRODUCTION |
| 2 Job census | 4 key-mode and 3 strategy-mode `done`, none `failed_final` | 4 and 3 `done`, 0 `failed_final`. All 3 strategy-mode jobs and 1 key-mode job finished between 11:27Z and 11:31Z. The 11:28Z backfill-worker redeploy (main's #1412 merge) orphaned 3 key-mode jobs mid-batch; the 30-minute stall sweep reset them at 11:58Z and attempt 2 ended `done` by 12:04Z. That was a deploy restart, not a phase defect. |
| 3 Standing refusal | 0 strategies whose latest derive carries `read_refusal_kept_figures` | 0 (all 3 latest derives `done`) |
| 4 Stored switch | `coin = BTC`, last USD day 2026-11-20, first BTC day 2026-11-21, `unit_segments` not null, on all 3 | true on all 3; `computation_status` complete on all 3 |
| 5 Census (Railway log) | `coin=BTC coin_bills=11` | `OKX unit switch read: coin=BTC coin_bills=11 coin_days=2` (RESEARCH A1 confirmed) |
| 7 Key inputs | 4 with `unit_segments`, 0 with `native_unit` | 4 and 0 |

Departures from the written procedure, stated plainly:
- Step 6 (a second run after a nightly derive) has NOT run yet. This verdict rests on one manually enqueued run, as the coordinator instructed. The first unattended confirmation is the strategy-mode cron at about 00:10Z and the key-mode cron at 00:40Z on 2026-11-29. Read their `status` then.
- Earlier the same day, before the manual run, the 00:10Z strategy-mode and 00:40Z key-mode nightly derives ended `failed_final` with the old `daily_pnl_non_usd_okx` refusal (the analytics service picked up PR-2's code later that morning). Step 2 counts only the jobs created after the deploy.

Headline figures (whole record in USD, the founder's ruling), before = frozen figures computed 2026-11-26 under the refusal, after = 2026-11-28:

| Strategy | Cumulative | CAGR | Sharpe | Max drawdown | Volatility |
|---|---|---|---|---|---|
| A | 21.41 % -> 2.64 % | 46.9 % -> 5.2 % | 1.33 -> 0.35 | -10.15 % -> -9.83 % | 32.6 % -> 20.2 % |
| B | 21.86 % -> 2.99 % | 41.7 % -> 5.2 % | 1.24 -> 0.35 | -10.15 % -> -10.80 % | 31.8 % -> 20.9 % |
| C | 21.44 % -> 2.63 % | 29.7 % -> 3.5 % | 1.09 -> 0.29 | -10.15 % -> -11.52 % | 26.9 % -> 16.9 % |

Reconciliation, for one strategy (the other two share the account): from the first stored NAV mark (2026-10-26) on, the new daily series reproduces the account's own USD NAV marks exactly on every segment checked (10-26 to 11-14, 11-14 to 11-20, 11-20 to 11-23, 11-23 to 11-27; four ratios equal to four decimals). The window from the first mark to 11-27 compounds to +8.5 %, and the BTC segment since the switch to -6.3 %. Everything before the first mark compounds to -5.4 % (rows before 2026-08-02, which the derive did not rewrite: -0.2 %; 08-02 to 10-26, which it rewrote from bills on a base anchored at the first mark per R2-02: -5.2 %). No pre-derive copy of the old series survives, so the roughly 19-point fall in the headline cannot be split exactly between the BTC move after the switch and the re-anchored pre-mark history. The lower volatility (about 0.6x) fits a larger equity base under the re-anchored history. This is recorded as an open question for the founder, not as a gap.

Finding, routed rather than fixed: the key has no NAV marks for 2026-11-24, 11-25 and 11-26 (those nights' derives failed, and a past day's mark cannot be read from a live balance). The derive logs `gaps=3` and deletes those three dates, so the 11-27 row carries the whole 11-23 to 11-27 move (no P&L is lost; the ratio matches the marks). But a 4-day return is booked as one daily return, and the three days appear in neither `withheld_days` nor `unpriced_days`. Candidate for Phase 261 UNITSWITCHEDGES.
