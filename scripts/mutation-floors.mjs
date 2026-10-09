/**
 * The mutation runner's coverage ratchets: FILES_FLOOR, ARMS_FLOOR and
 * WAIVED_CEILING, with the full dated record of every measurement that moved
 * them. Moved here VERBATIM from scripts/mutation-runner/run.mjs on 2026-10-03
 * (Phase 164.9.6, D-10); everything below this header is that section,
 * byte-for-byte.
 *
 * WHY THIS FILE IS OUTSIDE scripts/mutation-runner/: a push to main runs only
 * the SQL gate files its push touched, unless the push changes the mutation
 * machinery. Raising a floor is a ratchet beside a new gate, not a change to
 * the machinery, so on a push to main this file does NOT count as machinery.
 * On a pull request it STILL does, so a PR that raises a floor runs the FULL
 * corpus before it merges.
 *
 * READERS, each by symbol: scripts/mutation-runner/run.mjs (its default
 * parameters), the sql-mutation job's assert step in .github/workflows/ci.yml,
 * src/__tests__/mutation-runner-floors.test.ts (the stale-low ratchet) and
 * src/__tests__/gate-family-meta.test.ts (the threshold registry).
 *
 * Cite these constants by SYMBOL, never by line number and never by a value
 * restated in prose.
 */

// ===========================================================================
// COVERAGE RATCHET (D-01, D-09)
// ===========================================================================
//
// ⚠️ THESE ARE RATCHETS PINNED AT A MEASURED VALUE, NOT ASPIRATIONS. They fail
// on REGRESSION only — never "until 71/71". A runner reporting PASS while
// covering 1.4% of the corpus is the same shape as the SKIP-that-reads-as-PASS
// on this phase's defect list, so coverage is PRINTED on every run and a drop
// below the floor is exit 1.
//
// FILES_FLOOR was MEASURED before this file existed (2026-08-29, via a
// line-start-anchored node:fs scan of supabase/tests/): 1 annotated file of 71,
// carrying 30 prose markers. A floor picked by reading the finished artifact
// always passes and would prove nothing.
//
// RE-CONFIRMED 2026-09-01 (plan 164.3.1-09, SC-6/SC-9): the same run that
// re-derived ARMS_FLOOR below printed `coverage: files 1/71` — still 1 annotated
// file of 71, still supabase/tests/test_strategy_shares_rls.sql, whose blob is
// byte-identical at the phase base and at HEAD (5ae6855f). Command, sample size
// and record are stated once in the ARMS_FLOOR block below. No value change.
//
// Phase 164.4 RAISED FILES_FLOOR as it backfilled the remaining idiom files;
// it finished on 2026-09-04 at 39 of 71 (plan 164.4-11 — see the CURRENCY
// paragraph beside the VALUE at the bottom of this chain). The blocks below are
// that backfill's dated record, in order, and are lineage.
// ⚠️ CURRENCY 2026-09-03 (plan 164.4-02): still 1. That plan raised ARMS_FLOOR
// 30 -> 45 by closing the reference file's 15 un-twinned SECTIONS, and annotated
// no NEW file, so the FILE count did not move. A batch that annotates a new file
// moves this constant; a batch that deepens an existing one does not.
// ⚠️ CURRENCY 2026-09-03 (plan 164.4-03): still 1, and the DENOMINATOR this
// phase can reach on today's lane is **40 idiom files, not 44** — SCOPE
// AMENDMENT #2, founder 2026-09-03. Four idiom files probe `pg_extension` for
// pg_cron, which the pg-lane does not host and deliberately will not; they are
// derived, printed as `lane-blocked:` and owed to TODOS [REDUNDER-PGCRON], so
// the phase's end state is `coverage: files 40/71`. This plan edited no floor.
// ⚠️ CORRECTION 2026-09-04 (plan 164.4-11, measured): that `40/71` was the best
// figure available on 2026-09-03 and it is now FALSE. The reachable end state
// is `coverage: files 39/71`. A FIFTH file, test_compute_jobs_error_kind_copy_
// parity.sql, is equally un-baselineable without pg_cron — its blocker is a
// migration in its APPLY LIST rather than its own text, so `gateNeedsPgCron`
// cannot see it and it is printed under `pending:` instead of `lane-blocked:`
// (TODOS [REDUNDER-LANEBLOCKED-BLIND]). Founder decision, plan 09: it is owed to
// Phase 164.4.1 PGCRON-LANE rather than worked around. The paragraph above stays
// as the dated record of the amendment; this line is its correction.
// ⚠️ CURRENCY 2026-09-05 (plan 164.4.1-02, measured): 164.4's `39/71` end state
// stands as its own dated record and is now HISTORY. Phase 164.4.1 put pg_cron
// on the lane, so the SCOPE AMENDMENT #2 denominator no longer binds anything:
// the deferred fifth file is annotated, `pending:` is EMPTY and the measured
// reading is `coverage: files 41/71` with 3 lane-blocked files left for plans
// 03-05. The end state of THIS phase is not restated here — read the run.
// ⚠️ CURRENCY 2026-09-05 (plan 164.4.1-06): the `41/71` above is plan 02's dated
// reading and stays as lineage; plans 03-05 then took the last three files. The
// phase's END STATE, measured by plan 05 and re-measured by this plan, is
// 44 annotated / 0 pending / 27 unreachable / 0 inert / 0 lane-blocked = 71 —
// `FILES_FLOOR` 44, `ARMS_FLOOR` 363, `WAIVED_CEILING` still 0, and
// [REDUNDER-PGCRON] RETIRED rather than deferred again. Still read the run.
// ⚠️ SUPERSEDED 2026-09-05 (phase review, after plan 06): `ARMS_FLOOR` is **361**, not
// 363. CR-01/CR-02 found three arms of test_reconcile_dropped_enqueue_sweep.sql either
// unfalsifiable or mutating the gate's own text; two were reclassified as named INVARIANTs.
// `FILES_FLOOR` stays 44 and `WAIVED_CEILING` stays 0 — the floor moved DOWN because two arms
// were never proven against a production regression. See the ARMS_FLOOR block below.
//
// ⭐ RE-DERIVED 2026-09-03 (plan 164.4-04) — THE PHASE'S FIRST *FILE* MOVE. The
// blocks above STAY as lineage: 1 was the whole annotated corpus while it was
// written. Three NEW gate files — the ledger_refresh family — were annotated to
// completion, so for the first time the FILE count moves rather than the section
// depth within one file.
//
//   VALUE        4 — read off the run's own `coverage:` line, not counted here.
//   DATE         2026-09-03, at HEAD fd600efb.
//   COMMAND      `node scripts/mutation-runner/run.mjs` -> exit 0
//                  coverage: files 4/71
//                  arms: 86/86/0   (executed/annotated/waived)
//                  biting: 86
//                  lane-invocations: 86
//                  per-arm lane time: mean 1.0s over 86 arm run(s)
//                  pending: 36 idiom file(s) without RED-UNDER
//                96 s wall clock on the authoring box.
//   COVERAGE     4 annotated gate files of 71 in supabase/tests/, namely
//                supabase/tests/test_ledger_refresh_composite_arm.sql,
//                supabase/tests/test_ledger_refresh_fanout.sql,
//                supabase/tests/test_ledger_refresh_staleness.sql and
//                supabase/tests/test_strategy_shares_rls.sql.
//   SEPARATION   Both directions driven through the real verdict loop on real
//                lanes (`runCorpus({filesFloor})`), 2026-09-03:
//                  filesFloor=4  filesAnnotated=4  floor-defects=0  SILENT
//                  filesFloor=5  filesAnnotated=4  floor-defects=1  FIRES ->
//                    `FILES_FLOOR regression: 4 annotated file(s) < floor 5`
//                So 4 is exactly the separation point, not a value below it.
//   RECORD       .planning/phases/164.4-redunder-backfill-every-sql-gate-arm-
//                gets-a-red-under-annota/164.4-04-SUMMARY.md
//
// ⭐ RE-DERIVED 2026-09-03 (plan 164.4-05) — THE SECOND FILE MOVE, and the
// largest so far. The blocks above STAY as lineage. Five NEW gate files — the
// tenant-isolation and credential-scoping batch — were annotated to completion.
//
//   VALUE        9 — read off the run's own `coverage:` line, not counted here.
//   DATE         2026-09-03, at HEAD 61d80472.
//   COMMAND      `node scripts/mutation-runner/run.mjs` -> exit 0
//                  coverage: files 9/71
//                  arms: 134/134/0   (executed/annotated/waived)
//                  biting: 134
//                  lane-invocations: 134
//                  per-arm lane time: mean 1.0s over 134 arm run(s)
//                  pending: 31 idiom file(s) without RED-UNDER
//                151 s wall clock on the authoring box (134 arm lanes plus 9
//                baseline and 9 restore legs).
//   COVERAGE     9 annotated gate files of 71 in supabase/tests/, namely
//                supabase/tests/test_capital_ownership_allocation_guard.sql,
//                supabase/tests/test_create_wizard_strategy_for_key.sql,
//                supabase/tests/test_ledger_refresh_composite_arm.sql,
//                supabase/tests/test_ledger_refresh_fanout.sql,
//                supabase/tests/test_ledger_refresh_staleness.sql,
//                supabase/tests/test_scenario_shares_rls.sql,
//                supabase/tests/test_strategy_keys_rls.sql,
//                supabase/tests/test_strategy_shares_rls.sql and
//                supabase/tests/test_wizard_composite_members.sql.
//   SEPARATION   Both directions driven through the real verdict loop on real
//                lanes (`runCorpus({filesFloor})`), 2026-09-03:
//                  filesFloor=9   filesAnnotated=9  floor-defects=0  SILENT
//                  filesFloor=10  filesAnnotated=9  floor-defects=1  FIRES ->
//                    `FILES_FLOOR regression: 9 annotated file(s) < floor 10`
//                So 9 is exactly the separation point, not a value below it.
//   RECORD       .planning/phases/164.4-redunder-backfill-every-sql-gate-arm-
//                gets-a-red-under-annota/164.4-05-SUMMARY.md
//
// ⭐ RE-DERIVED 2026-09-03 (plan 164.4-06) — THE THIRD FILE MOVE. The blocks
// above STAY as lineage. Four NEW gate files — the private-by-default /
// venue-identity / capital-ownership-column / per-key-dailies batch — were
// annotated to completion.
//
//   VALUE        13 — read off the run's own `coverage:` line, not counted here.
//   DATE         2026-09-03, at HEAD 65c4a13b.
//   COMMAND      `node scripts/mutation-runner/run.mjs` -> exit 0
//                  coverage: files 13/71
//                  arms: 163/163/0   (executed/annotated/waived)
//                  biting: 163
//                  lane-invocations: 163
//                  per-arm lane time: mean 1.0s over 163 arm run(s)
//                  pending: 27 idiom file(s) without RED-UNDER
//                197 s wall clock on the authoring box (163 arm lanes plus 13
//                baseline and 13 restore legs).
//   COVERAGE     13 annotated gate files of 71 in supabase/tests/, namely
//                supabase/tests/test_api_keys_venue_identity_uniq.sql,
//                supabase/tests/test_capital_ownership_allocation_guard.sql,
//                supabase/tests/test_capital_ownership_column.sql,
//                supabase/tests/test_create_wizard_strategy_for_key.sql,
//                supabase/tests/test_csv_daily_returns_perkey_rls.sql,
//                supabase/tests/test_ledger_refresh_composite_arm.sql,
//                supabase/tests/test_ledger_refresh_fanout.sql,
//                supabase/tests/test_ledger_refresh_staleness.sql,
//                supabase/tests/test_scenario_shares_rls.sql,
//                supabase/tests/test_strategies_private_owner_isolation.sql,
//                supabase/tests/test_strategy_keys_rls.sql,
//                supabase/tests/test_strategy_shares_rls.sql and
//                supabase/tests/test_wizard_composite_members.sql.
//   SEPARATION   Both directions driven through the real verdict loop on real
//                lanes (`runCorpus({filesFloor})`), 2026-09-03:
//                  filesFloor=13  filesAnnotated=13  floor-defects=0  SILENT
//                  filesFloor=14  filesAnnotated=13  floor-defects=1  FIRES ->
//                    `FILES_FLOOR regression: 13 annotated file(s) < floor 14`
//                So 13 is exactly the separation point, not a value below it.
//   RECORD       .planning/phases/164.4-redunder-backfill-every-sql-gate-arm-
//                gets-a-red-under-annota/164.4-06-SUMMARY.md
//
// ⭐ RE-DERIVED 2026-09-03 (plan 164.4-07) — THE FOURTH FILE MOVE. The blocks
// above STAY as lineage. Four NEW gate files — the csv-finalize atomic fold, the
// funding_fees RLS stack, the allocator derived-equity surface and the
// user_notes dashboard scope — were annotated to completion.
//
//   VALUE        17 — read off the run's own `coverage:` line, not counted here.
//   DATE         2026-09-03, at HEAD 93b37a80.
//   COMMAND      `node scripts/mutation-runner/run.mjs` -> exit 0
//                  coverage: files 17/71
//                  arms: 189/189/0   (executed/annotated/waived)
//                  biting: 189
//                  lane-invocations: 189
//                  per-arm lane time: mean 1.0s over 189 arm run(s)
//                  pending: 23 idiom file(s) without RED-UNDER
//                224 s wall clock on the authoring box (189 arm lanes plus 17
//                baseline and 17 restore legs).
//   COVERAGE     17 annotated gate files of 71 in supabase/tests/, namely
//                supabase/tests/test_allocator_equity_derived_rls.sql,
//                supabase/tests/test_api_keys_venue_identity_uniq.sql,
//                supabase/tests/test_capital_ownership_allocation_guard.sql,
//                supabase/tests/test_capital_ownership_column.sql,
//                supabase/tests/test_create_wizard_strategy_for_key.sql,
//                supabase/tests/test_csv_daily_returns_perkey_rls.sql,
//                supabase/tests/test_csv_finalize_atomic_fold.sql,
//                supabase/tests/test_funding_fees_rls.sql,
//                supabase/tests/test_ledger_refresh_composite_arm.sql,
//                supabase/tests/test_ledger_refresh_fanout.sql,
//                supabase/tests/test_ledger_refresh_staleness.sql,
//                supabase/tests/test_scenario_shares_rls.sql,
//                supabase/tests/test_strategies_private_owner_isolation.sql,
//                supabase/tests/test_strategy_keys_rls.sql,
//                supabase/tests/test_strategy_shares_rls.sql,
//                supabase/tests/test_user_notes_dashboard_scope.sql and
//                supabase/tests/test_wizard_composite_members.sql.
//   SEPARATION   Both directions driven through the real verdict loop on real
//                lanes (`runCorpus({filesFloor})`), 2026-09-03:
//                  filesFloor=17  filesAnnotated=17  floor-defects=0  SILENT
//                  filesFloor=18  filesAnnotated=17  floor-defects=1  FIRES ->
//                    `FILES_FLOOR regression: 17 annotated file(s) < floor 18`
//                So 17 is exactly the separation point, not a value below it.
//   RECORD       .planning/phases/164.4-redunder-backfill-every-sql-gate-arm-
//                gets-a-red-under-annota/164.4-07-SUMMARY.md
//
// ⭐ RE-DERIVED 2026-09-04 (plan 164.4-08) — THE FIFTH FILE MOVE, and the
// largest of the phase. The blocks above STAY as lineage. Six NEW gate files —
// the csv double-submit fold, the published trust-signal SECDEF, the
// verified-cohort rank gate, the F-4 memberKeyIds downgrade sweep, the
// scenarios owner-RLS stack and the strategy_analytics series-completeness
// carrier — were annotated to completion, 5 sections each, 30 in total.
//
//   VALUE        23 — read off the run's own `coverage:` line, not counted here.
//   DATE         2026-09-04, at HEAD 029ba435.
//   COMMAND      `node scripts/mutation-runner/run.mjs` -> exit 0
//                  coverage: files 23/71
//                  arms: 219/219/0   (executed/annotated/waived)
//                  biting: 219
//                  lane-invocations: 219
//                  per-arm lane time: mean 1.0s over 219 arm run(s)
//                  pending: 17 idiom file(s) without RED-UNDER
//                266 s wall clock on the authoring box (219 arm lanes plus 23
//                baseline and 23 restore legs).
//   COVERAGE     23 annotated gate files of 71 in supabase/tests/, namely
//                supabase/tests/test_allocator_equity_derived_rls.sql,
//                supabase/tests/test_api_keys_venue_identity_uniq.sql,
//                supabase/tests/test_capital_ownership_allocation_guard.sql,
//                supabase/tests/test_capital_ownership_column.sql,
//                supabase/tests/test_create_wizard_strategy_for_key.sql,
//                supabase/tests/test_csv_daily_returns_perkey_rls.sql,
//                supabase/tests/test_csv_finalize_atomic_fold.sql,
//                supabase/tests/test_csv_finalize_double_submit.sql,
//                supabase/tests/test_funding_fees_rls.sql,
//                supabase/tests/test_get_published_trust_signals.sql,
//                supabase/tests/test_get_verified_cohort_rank_gate.sql,
//                supabase/tests/test_ledger_refresh_composite_arm.sql,
//                supabase/tests/test_ledger_refresh_fanout.sql,
//                supabase/tests/test_ledger_refresh_staleness.sql,
//                supabase/tests/test_scenario_downgrade_sweep.sql,
//                supabase/tests/test_scenario_shares_rls.sql,
//                supabase/tests/test_scenarios_rls.sql,
//                supabase/tests/test_strategies_private_owner_isolation.sql,
//                supabase/tests/test_strategy_analytics_series_completeness.sql,
//                supabase/tests/test_strategy_keys_rls.sql,
//                supabase/tests/test_strategy_shares_rls.sql,
//                supabase/tests/test_user_notes_dashboard_scope.sql and
//                supabase/tests/test_wizard_composite_members.sql.
//   SEPARATION   Both directions driven through the real verdict loop on real
//                lanes (`runCorpus({filesFloor})`), 2026-09-04:
//                  filesFloor=23  filesAnnotated=23  floor-defects=0  SILENT
//                                                                    (267.4 s)
//                  filesFloor=24  filesAnnotated=23  floor-defects=1  FIRES ->
//                    `FILES_FLOOR regression: 23 annotated file(s) < floor 24`
//                                                                    (268.7 s)
//                So 23 is exactly the separation point, not a value below it.
//   RECORD       .planning/phases/164.4-redunder-backfill-every-sql-gate-arm-
//                gets-a-red-under-annota/164.4-08-SUMMARY.md
//
// ⭐ RE-DERIVED 2026-09-04 (plan 164.4-09) — THE SIXTH FILE MOVE, and a REDUCED
// batch. The blocks above STAY as lineage. Five NEW gate files — the
// wizard-session tenant-scope index, the wizard composite fence, the
// weight-snapshot seed SECDEF trigger, the csv-finalize auth guard and the
// resync-retry single-job substrate — were annotated to completion,
// 5 + 5 + 4 + 3 + 3 = 20 sections.
//
// ⚠️ The plan projected SIX files / 23 sections. The sixth,
// test_compute_jobs_error_kind_copy_parity.sql, is UN-BASELINEABLE on today's
// lane: the only migration that widens compute_jobs_error_kind_check to admit
// 'orphaned' hard-RAISEs when pg_cron is absent. It stays in `pending:` and is
// deferred to the plan that hosts pg_cron on the lane ([REDUNDER-PGCRON]).
// The floors below are therefore ratcheted to what the run PRINTED, not to the
// plan's arithmetic.
//
//   VALUE        28 — read off the run's own `coverage:` line, not counted here.
//   DATE         2026-09-04, at HEAD ff2a3f4a.
//   COMMAND      `node scripts/mutation-runner/run.mjs` -> exit 0
//                  coverage: files 28/71
//                  arms: 239/239/0   (executed/annotated/waived)
//                  biting: 239
//                  lane-invocations: 239
//                  per-arm lane time: mean 1.0s over 239 arm run(s)
//                  pending: 12 idiom file(s) without RED-UNDER
//                297 s wall clock on the authoring box (239 arm lanes plus 28
//                baseline and 28 restore legs).
//   COVERAGE     28 annotated gate files of 71 in supabase/tests/, namely
//                supabase/tests/test_allocator_equity_derived_rls.sql,
//                supabase/tests/test_api_keys_venue_identity_uniq.sql,
//                supabase/tests/test_capital_ownership_allocation_guard.sql,
//                supabase/tests/test_capital_ownership_column.sql,
//                supabase/tests/test_create_wizard_strategy_for_key.sql,
//                supabase/tests/test_csv_daily_returns_perkey_rls.sql,
//                supabase/tests/test_csv_finalize_atomic_fold.sql,
//                supabase/tests/test_csv_finalize_auth_guard.sql,
//                supabase/tests/test_csv_finalize_double_submit.sql,
//                supabase/tests/test_funding_fees_rls.sql,
//                supabase/tests/test_get_published_trust_signals.sql,
//                supabase/tests/test_get_verified_cohort_rank_gate.sql,
//                supabase/tests/test_ledger_refresh_composite_arm.sql,
//                supabase/tests/test_ledger_refresh_fanout.sql,
//                supabase/tests/test_ledger_refresh_staleness.sql,
//                supabase/tests/test_resync_retry_single_job.sql,
//                supabase/tests/test_scenario_downgrade_sweep.sql,
//                supabase/tests/test_scenario_shares_rls.sql,
//                supabase/tests/test_scenarios_rls.sql,
//                supabase/tests/test_strategies_private_owner_isolation.sql,
//                supabase/tests/test_strategy_analytics_series_completeness.sql,
//                supabase/tests/test_strategy_keys_rls.sql,
//                supabase/tests/test_strategy_shares_rls.sql,
//                supabase/tests/test_strategy_verifications_wizard_session_tenant_scope.sql,
//                supabase/tests/test_user_notes_dashboard_scope.sql,
//                supabase/tests/test_weight_snapshot_seed_secdef.sql,
//                supabase/tests/test_wizard_composite_fence.sql and
//                supabase/tests/test_wizard_composite_members.sql.
//   SEPARATION   Both directions driven through the real verdict loop on real
//                lanes (`runCorpus({filesFloor, armsFloor})`), 2026-09-04:
//                  filesFloor=28 armsFloor=239  defects=0  SILENT   (298.7 s)
//                  filesFloor=29 armsFloor=240  defects=2  FIRES ->
//                    `FILES_FLOOR regression: 28 annotated file(s) < floor 29`
//                    `ARMS_FLOOR regression: 239 biting arm(s) < floor 240`
//                                                                   (295.8 s)
//                So 28/239 is exactly the separation point, not a value below it.
//   RECORD       .planning/phases/164.4-redunder-backfill-every-sql-gate-arm-
//                gets-a-red-under-annota/164.4-09-SUMMARY.md
//
// ⭐ RE-DERIVED 2026-09-04 (plan 164.4-10) — batch 7, the LAST non-mixed files.
// The blocks above STAY as lineage. Four NEW gate files, 2 sections each.
//
//   VALUE        32 — read off the run's own `coverage:` line, not counted here.
//   DATE         2026-09-04, at HEAD 3a81a284. (Measured at ccc4f51e; the only
//                commit between them, 3a81a284, touches TODOS.md alone —
//                nothing the runner reads, verified with `git diff --name-only
//                ccc4f51e..HEAD -- scripts/ supabase/ src/ .github/ CLAUDE.md`
//                returning empty.)
//   COMMAND      `node scripts/mutation-runner/run.mjs` -> exit 0
//                  coverage: files 32/71
//                  arms: 247/247/0   (executed/annotated/waived)
//                  biting: 247
//                  lane-invocations: 247
//                  per-arm lane time: mean 1.0s over 247 arm run(s)
//   SAMPLE SIZE  247 arms executed, all 247 `RED (identity ok)`, 0 defects.
//                316 s wall clock, 32 baseline and 32 restore legs.
//   COVERAGE     32 annotated gate files of 71. The four added this batch are
//                supabase/tests/test_allocator_equity_pre_terminus_flag.sql,
//                supabase/tests/test_enqueue_compute_job_dedupe_non_terminal
//                  .sql,
//                supabase/tests/test_metrics_by_basis_write.sql and
//                supabase/tests/test_set_compute_job_progress.sql.
//   SEPARATION   Both directions driven through the real verdict loop on real
//                lanes (`runCorpus({filesFloor, armsFloor})`), 2026-09-04:
//                  filesFloor=32 armsFloor=247  defects=0  SILENT   (320.7 s)
//                  filesFloor=33 armsFloor=248  defects=2  FIRES ->
//                    `FILES_FLOOR regression: 32 annotated file(s) < floor 33`
//                    `ARMS_FLOOR regression: 247 biting arm(s) < floor 248`
//                                                                   (324.0 s)
//                So 32/247 is exactly the separation point, not a value below it.
//   RECORD       .planning/phases/164.4-redunder-backfill-every-sql-gate-arm-
//                gets-a-red-under-annota/164.4-10-SUMMARY.md
//
// ⭐ RE-DERIVED 2026-09-04 (plan 164.4-11) — batch 8, the SEVEN ⚠️ mixed files
// and the LAST file move of Phase 164.4. The blocks above STAY as lineage.
//
//   VALUE        39 — read off the run's own `coverage:` line, not counted here.
//   DATE         2026-09-04, at HEAD 1aaba266.
//   COMMAND      `node scripts/mutation-runner/run.mjs` -> exit 0
//                  coverage: files 39/71
//                  arms: 262/262/0   (executed/annotated/waived)
//                  biting: 262
//                  lane-invocations: 262
//                  per-arm lane time: mean 1.0s over 262 arm run(s)
//   SAMPLE SIZE  262 arms executed, all 262 `RED (identity ok)`, 0 defects.
//                358 s wall clock, 39 baseline and 39 restore legs.
//   COVERAGE     39 annotated gate files of 71. The seven added this batch are
//                supabase/tests/test_api_keys_exchange_not_user_writable.sql,
//                supabase/tests/test_api_keys_insert_not_client_writable.sql,
//                supabase/tests/test_guard_wizard_draft_updates_auth_uid.sql,
//                supabase/tests/test_profiles_privileged_columns_locked.sql,
//                supabase/tests/test_strategy_keys_publish_integrity.sql,
//                supabase/tests/test_sync_status_marked_refresh_protected.sql
//                  and
//                supabase/tests/test_wizard_session_idempotency.sql.
//                The EXACT 39-name list is pinned in
//                src/__tests__/mutation-annotation-parser.test.ts's scanCorpus
//                assertion, which is where to read it rather than here.
//   SEPARATION   Both directions driven through the real verdict loop on real
//                lanes (`runCorpus({filesFloor, armsFloor})`), 2026-09-04:
//                  filesFloor=39 armsFloor=262  defects=0  SILENT   (352.8 s)
//                  filesFloor=40 armsFloor=263  defects=2  FIRES ->
//                    `FILES_FLOOR regression: 39 annotated file(s) < floor 40`
//                    `ARMS_FLOOR regression: 262 biting arm(s) < floor 263`
//                                                                   (349.3 s)
//                So 39/262 is exactly the separation point, not a value below it.
//   RECORD       .planning/phases/164.4-redunder-backfill-every-sql-gate-arm-
//                gets-a-red-under-annota/164.4-11-SUMMARY.md
//
// ⭐ RE-DERIVED 2026-09-05 (plan 164.4.1-02) — the FIRST file move of Phase
// 164.4.1 PGCRON-LANE, on a pg-lane that now PRELOADS pg_cron (plan 01). The
// blocks above STAY as lineage.
//
//   VALUE        41 — read off the run's own `coverage:` line, not counted here.
//   DATE         2026-09-05, at HEAD f1311fbf.
//   COMMAND      `node scripts/mutation-runner/run.mjs` -> exit 1
//                  coverage: files 41/71
//                  arms: 272/272/0   (executed/annotated/waived)
//                  biting: 272
//                  lane-invocations: 272
//                  per-arm lane time: mean 1.0s over 272 arm run(s)
//                ⚠️ exit 1, and that is EXPECTED in this interval, not a
//                regression: the run carries EXACTLY ONE defect,
//                `lane-blocked-stale`, because plan 01 made pg_cron available
//                while three files are still classified `lane-blocked`. That is
//                the tripwire of success criterion 3 doing its job; it clears at
//                plan 05. Every arm still scored `RED (identity ok)`.
//   SAMPLE SIZE  272 arms executed, all 272 `RED (identity ok)`, no defect of
//                any OTHER kind. The two independent tallies AGREE: `arms:`
//                executed 272 and `lane-invocations:` 272. 371 s wall clock, 41
//                baseline and 41 restore legs beside the 272 arm lanes. The 41
//                per-file `biting` counts SUM to 272.
//   COVERAGE     41 annotated gate files of 71. The two added this batch are
//                supabase/tests/test_compute_jobs_error_kind_copy_parity.sql
//                  (3 sections — the corpus's LAST `pending:` file, blocked
//                   only through its APPLY LIST) and
//                supabase/tests/test_derive_allocator_keys_fanout.sql
//                  (7 sections — blocked through its OWN TEXT, a
//                   pg_cron-conditional RAISE NOTICE at :169).
//                Proving BOTH shapes was the point of taking these two first:
//                they are the cheapest possible check that plan 01's substrate
//                is complete in both directions. The EXACT 41-name list is
//                pinned in src/__tests__/mutation-annotation-parser.test.ts.
//   SEPARATION   Both directions driven through the real verdict loop on real
//                lanes (`runCorpus({filesFloor, armsFloor})`), 2026-09-05:
//                  filesFloor=41 armsFloor=272  defects=1  kinds=
//                    ["lane-blocked-stale"]                       (367.9 s)
//                  filesFloor=42 armsFloor=273  defects=3  kinds=
//                    ["lane-blocked-stale","floor","floor"] ->
//                    `FILES_FLOOR regression: 41 annotated file(s) < floor 42`
//                    `ARMS_FLOOR regression: 272 biting arm(s) < floor 273`
//                                                                 (368.7 s)
//                So 41/272 is exactly the separation point, not a value below
//                it — the tripwire row is present in BOTH directions and is
//                therefore not what makes the second run fire.
//   RECORD       .planning/phases/164.4.1-pgcron-lane-put-pg-cron-on-the-
//                throwaway-pg-lane-and-retire/164.4.1-02-SUMMARY.md
//
// CURRENCY, stated where the VALUE is: RE-DERIVED 2026-09-05 by measurement
// (plan 164.4.1-02). Measured coverage 41 of 71 — value RAISED from 39. The
// remaining 30 of the 71 are NOT silently dropped: the runner prints all of
// them by name on every run — 27 `unreachable:` (they raise outside the
// identity idiom; out of scope by founder decision, TODOS [REDUNDER-NONIDIOM])
// and 3 `lane-blocked:`, which plans 03-05 of this phase take. `pending:` is
// now EMPTY, measured: the one name it carried
// (test_compute_jobs_error_kind_copy_parity.sql) is annotated, which is the
// retirement of [REDUNDER-PGCRON] the founder chose over widening it. The
// 2026-09-04 block above stays as the dated record of the 39-file corpus.
//
// ⭐ RE-DERIVED 2026-09-05 (plan 164.4.1-03) — the SECOND file move of Phase
// 164.4.1 PGCRON-LANE. The blocks above STAY as lineage.
//
//   VALUE        42 — read off the run's own `coverage:` line, not counted here.
//   DATE         2026-09-05, at HEAD 65c506cd.
//   COMMAND      `node scripts/mutation-runner/run.mjs` -> exit 1
//                  coverage: files 42/71
//                  arms: 296/297/1   (executed/annotated/waived)
//                  biting: 296
//                  lane-invocations: 296
//                  per-arm lane time: mean 1.0s over 296 arm run(s)
//                ⚠️ exit 1 on TWO defects in this interval, and both are
//                deliberate rather than a regression. The first is plan 01's
//                tripwire, `lane-blocked-stale` — pg_cron is AVAILABLE while
//                two files are still classified `lane-blocked` — and it clears
//                at plan 05. The second is a `floor` defect reading
//                `WAIVED_CEILING exceeded: 1 waived arm(s) > ceiling 0`: this
//                batch met an arm with NO first-failure mutation and left it
//                loud instead of raising the ceiling, which is a founder call.
//                See the WAIVED_CEILING block below and the RED-UNDER prose at
//                `3/JOB-05` in the gate. Every arm that EXECUTED scored
//                `RED (identity ok)`.
//   SAMPLE SIZE  296 arms executed, all 296 `RED (identity ok)`, no defect of
//                any OTHER kind. The two independent tallies AGREE: `arms:`
//                executed 296 and `lane-invocations:` 296. 42 baseline and 42
//                restore legs beside the 296 arm lanes. The 42 per-file
//                `biting` counts SUM to 296.
//   COVERAGE     42 annotated gate files of 71. The one added this batch is
//                supabase/tests/test_retention_orphaned_running.sql
//                  (25 sections — the RAISE-on-absent-pg_cron spelling
//                   PATTERNS C1 calls "the one to follow", and the first file
//                   in the corpus whose Parts 2 and 3 read the DEPLOYED
//                   cron.job.command as their ORACLE and EXECUTE it).
//                The EXACT 42-name list is pinned in
//                src/__tests__/mutation-annotation-parser.test.ts.
//   SEPARATION   Both directions driven through the real verdict loop on real
//                lanes (`runCorpus({scopeDir:"supabase/tests", filesFloor,
//                armsFloor, log:()=>{}})`), 2026-09-05:
//                  filesFloor=42 armsFloor=296  defects=2  kinds=
//                    ["lane-blocked-stale","floor"]               (396.2 s)
//                  filesFloor=43 armsFloor=297  defects=4  kinds=
//                    ["lane-blocked-stale","floor","floor","floor"] ->
//                    `FILES_FLOOR regression: 42 annotated file(s) < floor 43`
//                    `ARMS_FLOOR regression: 296 biting arm(s) < floor 297`
//                                                                 (396.5 s)
//                So 42/296 is exactly the separation point, not a value below
//                it. ⭐ BOTH pre-existing rows — the tripwire AND the
//                waiver-ceiling breach — are present in BOTH directions, which
//                is what proves neither of them is what makes the second run
//                fire.
//   RECORD       .planning/phases/164.4.1-pgcron-lane-put-pg-cron-on-the-
//                throwaway-pg-lane-and-retire/164.4.1-03-SUMMARY.md
//
// CURRENCY, stated where the VALUE is: RE-DERIVED 2026-09-05 by measurement
// (plan 164.4.1-03). Measured coverage 42 of 71 — value RAISED from 41. The
// remaining 29 of the 71 are still printed by name on every run: 27
// `unreachable:` (out of scope by founder decision, TODOS [REDUNDER-NONIDIOM])
// and 2 `lane-blocked:`, which plans 04 and 05 of this phase take. `pending:`
// stays EMPTY, measured. The 2026-09-05 plan-02 block above stays as the dated
// record of the 41-file corpus.
//
// ⭐ RE-DERIVED 2026-09-05 (plan 164.4.1-04) — the THIRD file move of Phase
// 164.4.1 PGCRON-LANE. The blocks above STAY as lineage.
//
//   VALUE        43 — read off the run's own `coverage:` line, not counted here.
//   DATE         2026-09-05, at HEAD fcbc0159 plus this plan's working tree.
//   COMMAND      `node scripts/mutation-runner/run.mjs` -> exit 1
//                  coverage: files 43/71
//                  arms: 324/324/0   (executed/annotated/waived)
//                  biting: 324
//                  lane-invocations: 324
//                  per-arm lane time: mean 1.1s over 324 arm run(s)
//                ⚠️ exit 1 on exactly ONE defect, and it is plan 01's tripwire:
//                `lane-blocked-stale` — pg_cron is AVAILABLE while ONE file
//                (test_reconcile_dropped_enqueue_sweep.sql) is still classified
//                `lane-blocked`. It clears at plan 05. Any OTHER defect kind in
//                this interval is a regression. ⭐ The `floor` defect plan 03's
//                block above records is GONE: `arms:` and `biting:` are the
//                same number again and W is back to 0, because commit fcbc0159
//                RECLASSIFIED the retention gate's unfalsifiable `3/JOB-05`
//                instead of waiving it.
//   SAMPLE SIZE  324 arms executed, all 324 `RED (identity ok)`, no defect of
//                any OTHER kind. The two independent tallies AGREE: `arms:`
//                executed 324 and `lane-invocations:` 324. 43 baseline and 43
//                restore legs beside the 324 arm lanes. The 43 per-file
//                `biting` counts SUM to 324.
//   COVERAGE     43 annotated gate files of 71. The one added this batch is
//                supabase/tests/test_strategy_analytics_stuck_computing_reaper.sql
//                  (28 sections — the RAISE NOTICE 'SKIP' spelling PATTERNS C1
//                   calls the older of the two, and the largest file in the
//                   corpus whose withheld Parts would have baselined GREEN
//                   either way. Its apply list is SIZED so the baseline prints
//                   ZERO gate-owned skip lines, which is the measurement that
//                   makes its twins falsifiable at all.)
//                The EXACT 43-name list is pinned in
//                src/__tests__/mutation-annotation-parser.test.ts.
//   SEPARATION   Both directions driven through the real verdict loop on real
//                lanes (`runCorpus({scopeDir:"supabase/tests", filesFloor,
//                armsFloor, log:()=>{}})`), 2026-09-05:
//                  filesFloor=43 armsFloor=324  defects=1  kinds=
//                    ["lane-blocked-stale"]                       (442.3 s)
//                  filesFloor=44 armsFloor=325  defects=3  kinds=
//                    ["lane-blocked-stale","floor","floor"] ->
//                    `FILES_FLOOR regression: 43 annotated file(s) < floor 44`
//                    `ARMS_FLOOR regression: 324 biting arm(s) < floor 325`
//                                                                 (441.3 s)
//                So 43/324 is exactly the separation point, not a value below
//                it. ⭐ The tripwire row is present in BOTH directions, which is
//                what proves it is not what makes the second run fire.
//   RECORD       .planning/phases/164.4.1-pgcron-lane-put-pg-cron-on-the-
//                throwaway-pg-lane-and-retire/164.4.1-04-SUMMARY.md
//
// CURRENCY, stated where the VALUE is: RE-DERIVED 2026-09-05 by measurement
// (plan 164.4.1-04). Measured coverage 43 of 71 — value RAISED from 42. The
// remaining 28 of the 71 are still printed by name on every run: 27
// `unreachable:` (out of scope by founder decision, TODOS [REDUNDER-NONIDIOM])
// and 1 `lane-blocked:`, which plan 05 of this phase takes. `pending:` stays
// EMPTY, measured. The 2026-09-05 plan-03 block above stays as the dated record
// of the 42-file corpus.
//
// ⭐ RE-DERIVED 2026-09-05 (plan 164.4.1-05) — the FOURTH and LAST file move of
// Phase 164.4.1 PGCRON-LANE, and the run that CLEARS the tripwire. The blocks
// above STAY as lineage.
//
//   VALUE        44 — read off the run's own `coverage:` line, not counted here.
//   DATE         2026-09-05, at HEAD b3e13011.
//   COMMAND      `node scripts/mutation-runner/run.mjs` -> exit 0
//                  coverage: files 44/71
//                  lane-blocked: 0 file(s) …
//                  lane-probe: pg_cron AVAILABLE — lane-blocked class is STALE
//                    pending: 0 idiom file(s) without RED-UNDER —
//                  arms: 363/363/0   (executed/annotated/waived)
//                  biting: 363
//                  lane-invocations: 363
//                  per-arm lane time: mean 1.1s over 363 arm run(s)
//                  ✅ No defects. Every annotated arm bit its own arm first.
//                ⭐ EXIT 0. This is the first run since plan 01 that does NOT
//                carry `lane-blocked-stale`: the class is EMPTY because the
//                fourth and last file left it BY ANNOTATION. Nothing in the
//                classifier (`parse.mjs gateNeedsPgCron`), in the probe fixture
//                or in the probe/defect code here was touched — the defect at
//                the probe leg is gated on `laneBlockedFiles.length > 0` and
//                simply does not fire. The tripwire stays live for any FUTURE
//                unannotated pg_cron gate, and SELF-TEST 17/17 still proves it
//                on the synthetic corpus.
//                ⚠️ The `lane-probe:` sentence still reads "lane-blocked class
//                is STALE" while the class is empty. That wording is now
//                false-reading and plan 06 corrects it AT THE SOURCE; it is
//                deliberately NOT touched here, because changing what the
//                tripwire says in the same commit that clears it is exactly the
//                move this phase exists to refuse.
//   SAMPLE SIZE  363 arms executed, all 363 `RED (identity ok)`, no defect of
//                any kind. The two independent tallies AGREE: `arms:` executed
//                363 and `lane-invocations:` 363. 44 baseline and 44 restore
//                legs beside the 363 arm lanes. The 44 per-file `biting` counts
//                SUM to 363.
//   COVERAGE     44 annotated gate files of 71. The one added this batch is
//                supabase/tests/test_reconcile_dropped_enqueue_sweep.sql
//                  (39 sections — the largest file in the phase. Its Parts 2-4
//                   read the DEPLOYED cron.job.command and EXECUTE it, so the
//                   arms are behavioural rather than textual; every body twin
//                   targets 20260819150000, the LAST writer, because
//                   cron.schedule upserts by NAME and an edit to either earlier
//                   scheduling migration is overwritten. MEASURED by ablation.)
//                The EXACT 44-name list is pinned in
//                src/__tests__/mutation-annotation-parser.test.ts.
//   SEPARATION   Both directions driven through the real verdict loop on real
//                lanes (`runCorpus({scopeDir:"supabase/tests", filesFloor,
//                armsFloor, log:()=>{}})`), 2026-09-05:
//                  filesFloor=44 armsFloor=363  defects=0  SILENT  (486.4 s)
//                  filesFloor=45 armsFloor=364  defects=2  kinds=
//                    ["floor","floor"] ->
//                    `FILES_FLOOR regression: 44 annotated file(s) < floor 45`
//                    `ARMS_FLOOR regression: 363 biting arm(s) < floor 364`
//                                                                 (490.4 s)
//                So 44/363 is exactly the separation point, not a value below
//                it. ⭐ Unlike every block since plan 01, the FIRST direction is
//                now defect-FREE: there is no tripwire row left to subtract.
//   RECORD       .planning/phases/164.4.1-pgcron-lane-put-pg-cron-on-the-
//                throwaway-pg-lane-and-retire/164.4.1-05-SUMMARY.md
//
// CURRENCY, stated where the VALUE is: RE-DERIVED 2026-09-05 by measurement
// (plan 164.4.1-05). Measured coverage 44 of 71 — value RAISED from 43. This is
// PHASE 164.4.1's END STATE for the annotated corpus: `lane-blocked:` is 0 and
// `pending:` is 0, both measured, so the remaining 27 of the 71 are ALL
// `unreachable:` (out of scope by founder decision, TODOS [REDUNDER-NONIDIOM])
// and every one of them is printed by name on every run. 44 + 0 + 27 + 0 + 0 =
// 71. The 2026-09-05 plan-04 block above stays as the dated record of the
// 43-file corpus.
//
// ⭐ RE-MEASURED 2026-09-05 (review fix, findings CR-01/CR-02 of
// 164.4.1-REVIEW.md). Value UNCHANGED at 44 — the reclassification of
// `3/JOB-04` and `4/JOB-04` removed two SECTIONS from
// test_reconcile_dropped_enqueue_sweep.sql (39 -> 37) but no FILE left the
// annotated set, so `coverage:` is still 44/71. Read off the run's own line:
//   `node scripts/mutation-runner/run.mjs`
//     coverage: files 44/71
//     lane-blocked: 0 file(s) …
//     lane-probe: pg_cron AVAILABLE — lane-blocked class is empty, as a hosting lane requires
//       pending: 0 idiom file(s) without RED-UNDER —
//     arms: 361/361/0   (executed/annotated/waived)
//     biting: 361
//     lane-invocations: 361
//     per-arm lane time: mean 1.1s over 361 arm run(s)
// The paired ARMS_FLOOR move (363 -> 361) and its own separation measurement
// are in the block below.
//
// ⭐ RE-DERIVED 2026-09-06 BY MEASUREMENT (phase 164.2, plan 07). Value RAISED
// from 44 to 45 — ONE new annotated file,
// supabase/tests/test_sync_status_curated_sentence_survives.sql, the gate that
// PERFORMS a compute_jobs transition and reads the curated computation_error
// sentence back (criterion 1). The corpus also grew by one file (71 -> 72),
// which is that same file, so the OUT-of-scope classes did not move:
// 45 + 0 lane-blocked + 27 unreachable + 0 pending = 72. Every block above
// stays as dated lineage. Read off the run's own line, never typed from a
// plan's prose:
//   `node scripts/mutation-runner/run.mjs`
//     coverage: files 45/72
//     lane-blocked: 0 file(s) …
//     lane-probe: pg_cron AVAILABLE — lane-blocked class is empty, as a hosting lane requires
//       pending: 0 idiom file(s) without RED-UNDER —
//     arms: 369/369/0   (executed/annotated/waived)
//     biting: 369
//     lane-invocations: 369
//     per-arm lane time: mean 1.1s over 369 arm run(s)
//     ✅ No defects. Every annotated arm bit its own arm first.
//   SEPARATION   Measured on a real full-corpus lane run, same tree:
//                  FILES_FLOOR=46 (one higher) -> defect ->
//                    `FILES_FLOOR regression: 45 annotated file(s) < floor 46`
//                  FILES_FLOOR=45 (this value) -> 0 defects, EXIT 0
//                So 45 is the separation point, not a value below it.
// The paired ARMS_FLOOR move (361 -> 369) is in the block below.
//
// ⭐ RE-DERIVED 2026-09-07 BY MEASUREMENT (phase 164.7, plan 05). Value RAISED
// from 45 to 46 — ONE new annotated file,
// supabase/tests/test_analytics_service_settings_and_vault_tick.sql (phase
// 164.7 plan 02), the gate over public.match_engine_cron_tick() and
// public.system_settings. Its seven machine identities are 0, V1, U1, C1, R1,
// R2 and R3. The corpus also grew by exactly that one file (72 -> 73), so the
// OUT-of-scope classes did not move:
// 46 + 0 lane-blocked + 27 unreachable + 0 pending = 73. Every block above
// stays as dated lineage.
//   DATE         2026-09-07, on the phase-164.7-appsettings branch at d193e4cd
//                plus this plan's working tree (the five lineage headers of
//                Task 2 are comment-only additions to migrations and were
//                present for the two separation runs; run 1 below measured the
//                SAME 380 arms without them, which is the evidence that a
//                masthead comment moved no arm).
//   COMMAND      `node scripts/mutation-runner/run.mjs` (full corpus, macOS,
//                PGBIN=/opt/homebrew/opt/postgresql@16/bin), read off the run's
//                own lines and never typed from a plan's prose:
//                  coverage: files 46/73
//                  lane-blocked: 0 file(s) …
//                  lane-probe: pg_cron AVAILABLE — lane-blocked class is empty, as a hosting lane requires
//                    pending: 0 idiom file(s) without RED-UNDER —
//                  arms: 380/380/0   (executed/annotated/waived)
//                  biting: 380
//                  lane-invocations: 380
//                  per-arm lane time: mean 1.1s over 380 arm run(s)
//                  ✅ No defects. Every annotated arm bit its own arm first.
//   ⚠️ TWO twins in the new file are NOT the ones its plan specified, and the
//                difference was MEASURED rather than argued
//                (164.7-02-NEUTER.log): C1's planned vault-key rename made arm
//                U1 the first failure (`WRONG-ARM(U1)`), and R3's planned
//                `DROP POLICY system_settings_service_all` reported `no-red`
//                because `service_role` is BYPASSRLS — a property of every
//                `*_service_all` policy in this repository, not of that table.
//                Both were replaced with twins that bite, so all seven count.
//   SEPARATION   Measured on real full-corpus lane runs, same tree:
//                  FILES_FLOOR=47 (one higher) -> defect ->
//                    `FILES_FLOOR regression: 46 annotated file(s) < floor 47`
//                    (beside the paired ARMS_FLOOR regression)   exit 1, 528 s
//                  FILES_FLOOR=46 (this value) -> 0 defects, EXIT 0      614 s
//                So 46 is the separation point, not a value below it.
//   ⛔ THE STALE DIRECTION IS NOT THIS RUNNER'S, AND THIS PLAN MEASURED IT
//                RATHER THAN INHERITING THE EARLIER BLOCKS' WORDING. A full
//                corpus run with the floors left stale-low at 45/369 on this
//                46-file tree EXITS 0 with `✅ No defects` (531 s): the gate
//                path is `if (annotatedFiles < filesFloor)`, so a floor BELOW
//                the corpus is invisible here BY CONSTRUCTION. The lower
//                direction is caught one layer up, by
//                src/__tests__/mutation-runner-floors.test.ts, which failed on
//                that same tree with
//                  `RATCHET STALE: 46 of 73 gate files are now annotated but
//                   FILES_FLOOR is still 45. Raise FILES_FLOOR in
//                   scripts/mutation-runner/run.mjs to 46.`
//                beside the paired ARMS_FLOOR message. All three runs and both
//                vitest readings are in 164.7-05-FLOORS.log with their exit
//                codes. ⚠️ A future plan must not read "separated in both
//                directions" as "the runner reports both" — it does not, and
//                expecting it to would let a stale ratchet read as a green gate.
// The paired ARMS_FLOOR move (369 -> 380) is in the block below.
//   RECORD       .planning/phases/164.7-appsettings-every-app-guc-reader-moves-
//                to-a-mechanism-this-p/164.7-05-SUMMARY.md
// ⚠️ CURRENCY 2026-09-18 (Phase 164.1.1 PROBERCADENCE, plan 01): 46 -> 47. ONE
//                new annotated gate, supabase/tests/test_prod_prober_cadence.sql
//                (two arms, G and S — see that file's own header). MEASURED on
//                a clean-tree full-corpus lane run, READ OFF THE RUNNER'S OWN
//                OUTPUT: `coverage: files 47/74`, `arms: 397/397/0`,
//                `biting: 397`, `lane-invocations: 397` (the two independent
//                tallies AGREE), `lane-blocked: 0 file(s)`, `lane-probe:
//                pg_cron AVAILABLE`, `pending: 0`, `✅ No defects`, exit 0,
//                mean 2.0s/arm over 397 arm run(s).
//                SEPARATED in both directions on `src/__tests__/mutation-runner-floors.test.ts`'s
//                fast re-derivation (no lane needed — that test statically
//                re-scans the corpus): FILES_FLOOR=48 gives `REGRESSION: 47 of
//                74 gate files are annotated, below the pinned floor of 48` and
//                FAILS; FILES_FLOOR=46 (the stale-low direction) gives
//                `RATCHET STALE: 47 of 74 gate files are now annotated but
//                FILES_FLOOR is still 46` and FAILS; FILES_FLOOR=47 PASSES.
// ⚠️ CURRENCY 2026-09-19 (Phase 164.5.1.4 SYNCCURSOR, review WR-05): 47 -> 48.
//                ONE new annotated gate,
//                supabase/tests/test_strategy_sync_cursors_rls.sql — the
//                behavioural RLS gate over public.strategy_sync_cursors (nine
//                arms: SEED 1, GRANT 1, RLS 1-2, POLICY 1-4, RESTORE 1; see that
//                file's own header). The paired ARMS_FLOOR move (402 -> 411) is
//                in the block below.
//                ⛔ THIS ENTRY IS SEPARATED ON THE FAST VITEST RE-DERIVATION
//                ONLY, not on a full-corpus lane run — the gate's own
//                calibration (`9/9 RED (identity ok)`, `biting: 9`,
//                `lane-invocations: 9`, restore leg exit 0, `No defects`) was
//                measured by the plan that ADDED the file, and this edit only
//                absorbs it into the ratchet. Said plainly rather than implied,
//                because every entry above this one cites a lane run and a
//                reader would otherwise assume one here too.
//                MEASURED over `scanCorpus` at this commit: `filesTotal 75`,
//                `annotated 48`, `totalAnchored 411`, `waivers 0`; and
//                `--parse-only` exits 0 with `✅ No static defects`.
//                SEPARATED in both directions on
//                `src/__tests__/mutation-runner-floors.test.ts`'s fast
//                re-derivation (no lane needed — that test statically re-scans
//                the corpus): FILES_FLOOR=49 gives `REGRESSION: 48 of 75 gate
//                files are annotated, below the pinned floor of 49. Annotations
//                were removed.` and FAILS; FILES_FLOOR=47 (the stale-low
//                direction, i.e. this constant's PRE-EDIT value) gives `RATCHET
//                STALE: 48 of 75 gate files are now annotated but FILES_FLOOR is
//                still 47. Raise FILES_FLOOR in scripts/mutation-runner/run.mjs
//                to 48.` and FAILS; FILES_FLOOR=48 PASSES. WAIVED_CEILING stays
//                0 (0 waivers, corpus-wide).
//
// ⭐ RE-DERIVED 2026-09-22 (Phase 167 CREDTRUST, plan 03 Task 2) — the arrival
//                of supabase/tests/test_api_keys_sync_status_sign_in_failed.sql
//                (the D-11 arm B CHECK-widening gate, two arms), moving
//                FILES_FLOOR 48 -> 49. The paired ARMS_FLOOR move (423 -> 425)
//                is in the block below.
//                MEASURED via a full lane run,
//                `node scripts/mutation-runner/run.mjs`: `coverage: files
//                49/76`, `arms: 425/425/0`, `biting: 425`,
//                `lane-invocations: 425` (the two independent tallies AGREE),
//                `lane-blocked: 0`, `lane-probe: pg_cron AVAILABLE`,
//                `✅ No defects. Every annotated arm bit its own arm first.`,
//                exit 0. Per-file line: `test_api_keys_sync_status_sign_in_
//                failed.sql: sections 2 / judged 2 / annotated 2 / waived 0 /
//                biting 2`. WAIVED_CEILING stays 0 — no waiver was added.
//                SEPARATED on `src/__tests__/mutation-runner-floors.test.ts`'s
//                fast re-derivation, run BEFORE this edit (the pre-edit value
//                48 is the stale-low direction): `RATCHET STALE: 49 of 76 gate
//                files are now annotated but FILES_FLOOR is still 48. Raise
//                FILES_FLOOR in scripts/mutation-runner/run.mjs to 49.` FAILS
//                at the old value; FILES_FLOOR=49 PASSES.
//
// ⭐ RE-DERIVED 2026-09-24 (Phase 164.6 GATE-HYGIENE, review fix round 1) — the
//                arrival of supabase/tests/test_cron_runs_rls.sql (the
//                rls-policy-auditor's note (a): anon and a non-admin
//                authenticated user read ZERO cron_runs rows, beside an admin
//                anti-vacuity control; three arms), moving FILES_FLOOR 49 -> 50
//                and the denominator 76 -> 77. The paired ARMS_FLOOR move
//                (428 -> 445) is in the block below.
//                MEASURED via ONE full lane run with no file edited during it,
//                `node scripts/mutation-runner/run.mjs`: `scope: FULL 50/50
//                annotated files`, `coverage: files 50/77`, `arms:
//                445/445/0`, `biting: 445`, `lane-invocations: 445 … plus 50
//                baseline / 50 restore leg(s)` (the two independent tallies
//                AGREE), `lane-blocked: 0`, `lane-probe: pg_cron AVAILABLE`,
//                `unreachable: 27`, `✅ No defects. Every annotated arm bit its
//                own arm first.`, exit 0. Per-file line:
//                `test_cron_runs_rls.sql: sections 3 / judged 3 / annotated 3 /
//                waived 0 / biting 3`. WAIVED_CEILING stays 0.
//
// ⭐ RE-DERIVED 2026-09-26 (Phase 164.5.2 BRIDGELOCK, plan 03) — the arrival
//                of supabase/tests/test_mark_rpc_bridge_advisory_lock.sql (the
//                LANE-ONLY two-backend dblink gate over the per-strategy
//                bridge lock in both terminal mark RPCs, arms L1-L4), moving
//                FILES_FLOOR 50 -> 51 and the denominator 77 -> 78. The paired
//                ARMS_FLOOR move (449 -> 453) is in the block below.
//                MEASURED via full lane runs, `node scripts/mutation-runner/
//                run.mjs`: `scope: FULL 51/51 annotated files`, `coverage:
//                files 51/78`, `arms: 453/453/0`, `biting: 453`,
//                `lane-invocations: 453 … plus 51 baseline / 51 restore
//                leg(s)` (the two independent tallies AGREE), `lane-blocked:
//                0`, `lane-probe: pg_cron AVAILABLE`, `unreachable: 27`,
//                `pending: 0`. Per-file line: `test_mark_rpc_bridge_advisory_
//                lock.sql: sections 4 / judged 4 / annotated 4 / waived 0 /
//                biting 4`. The final run, at this constant, printed `✅ No
//                defects. Every annotated arm bit its own arm first.`, exit 0.
//                SEPARATED on `src/__tests__/mutation-runner-floors.test.ts`,
//                run with the pre-edit value 50 (the stale-low direction):
//                `RATCHET STALE: 51 of 78 gate files are now annotated but
//                FILES_FLOOR is still 50. Raise FILES_FLOOR in
//                scripts/mutation-runner/run.mjs to 51.` FAILS; 51 PASSES.
//                WAIVED_CEILING stays 0.
//
// ⭐ RE-DERIVED 2026-09-25 (Phase 167.1.2 ACCOUNTTRUTH, plan 03, PR B) — the
//                arrival of supabase/tests/test_api_keys_account_identity.sql,
//                the gate for migration 20260925120000 (the duplicate marker,
//                the departed-history flag and its owner RPC, the reconnect
//                named refusal; 24 arms), moving FILES_FLOOR 50 -> 51 and the
//                denominator 77 -> 78. The paired ARMS_FLOOR move (449 -> 474)
//                is in the block below.
//                MEASURED via ONE full lane run with no file edited during it,
//                constants still at 50 / 449 (the stale-low direction the
//                runner cannot see), `node scripts/mutation-runner/run.mjs`:
//                `scope: FULL 51/51 annotated files`, `coverage: files 51/78`,
//                `arms: 474/474/0`, `biting: 474`, `lane-invocations: 474 …
//                plus 51 baseline / 51 restore leg(s)` (the two independent
//                tallies AGREE), `lane-blocked: 0`, `lane-probe: pg_cron
//                AVAILABLE`, `unreachable: 27`, `✅ No defects. Every annotated
//                arm bit its own arm first.`, exit 0. Per-file line:
//                `test_api_keys_account_identity.sql: sections 24 / judged 24 /
//                annotated 24 / waived 0 / biting 24`. The stale-low direction
//                was observed in src/__tests__/mutation-runner-floors.test.ts
//                before this edit: `RATCHET STALE: 51 of 78 gate files are now
//                annotated but FILES_FLOOR is still 50.` WAIVED_CEILING stays 0.
//
// ⭐ RE-DERIVED 2026-09-26 (merge of origin/main into Phase 164.5.2
//                BRIDGELOCK) — the UNION of the two blocks above. Each side
//                added ONE new gate file over the common base (50 annotated /
//                77 total): test_mark_rpc_bridge_advisory_lock.sql (this
//                branch) and test_api_keys_account_identity.sql (origin/main).
//                Both are in the corpus, so FILES_FLOOR moves 51 -> 52 and the
//                denominator 78 -> 79. MEASURED via ONE full lane run on the
//                merged tree, `node scripts/mutation-runner/run.mjs`:
//                `scope: FULL 52/52 annotated files`, `coverage: files 52/79`,
//                with the ARMS_FLOOR union recorded in the block below.
//                WAIVED_CEILING stays 0.
//
// ⭐ RE-DERIVED 2026-09-27 (Phase 164.9.3 CLAIMPAIR, plan 05) — the arrival
//                of supabase/tests/test_claim_compute_jobs_failed_retry_pending_pair.sql
//                (the gate for migration 20260927120000: a due failed_retry
//                job beside a pending twin of the same (kind, partition)
//                never makes a claim entry point raise 23505; 15 arms over
//                the four partitions of claim_compute_jobs and both
//                claim_compute_jobs_with_priority overloads), moving
//                FILES_FLOOR 52 -> 53 and the denominator 79 -> 80. The paired
//                ARMS_FLOOR move (491 -> 506) is in the block below.
//                MEASURED via ONE full lane run with no file edited during it,
//                constants still at 52 / 491 (the stale-low direction the
//                runner cannot see), `node scripts/mutation-runner/run.mjs`:
//                `scope: FULL 53/53 annotated files`, `coverage: files 53/80`,
//                `arms: 506/506/0`, `biting: 506`, `lane-invocations: 506 …
//                plus 53 baseline / 53 restore leg(s)` (the two independent
//                tallies AGREE), `lane-blocked: 0`, `lane-probe: pg_cron
//                AVAILABLE`, `unreachable: 27`, `per-arm lane time: mean 1.2s
//                over 506 arm run(s)`, `✅ No defects. Every annotated arm bit
//                its own arm first.`, exit 0, wall clock 710 s (under the
//                20-minute `sql-mutation` ceiling). Per-file line:
//                `test_claim_compute_jobs_failed_retry_pending_pair.sql:
//                sections 9 / judged 15 / annotated 15 / waived 0 / biting 15`.
//                SEPARATED in BOTH directions: at 54 (with ARMS_FLOOR 507) a
//                full lane run exits 1 naming `FILES_FLOOR regression: 53
//                annotated file(s) < floor 54`; at 52 the runner cannot see
//                it and src/__tests__/mutation-runner-floors.test.ts FAILS
//                with `RATCHET STALE: 53 of 80 gate files are now annotated
//                but FILES_FLOOR is still 52. Raise FILES_FLOOR in
//                scripts/mutation-runner/run.mjs to 53.`; 53 PASSES. Each
//                separation edit was restored from a byte backup and proved
//                with cmp. WAIVED_CEILING stays 0.
//
// ⭐ MOVED 2026-09-29 (Phase 167.1.2 ACCOUNTTRUTH PR C2, review fix B, WR-04),
//                53 -> 54: plan 12's NEW gate file supabase/tests/test_refresh_
//                fanout_zero_snapshot_bootstrap.sql (the zero-snapshot bootstrap
//                of migration 20260928140000, 32 arms after its review rounds)
//                reached this branch without its census commits. The
//                denominator moves with it, 80 -> 81. MEASURED via ONE full lane
//                run at a6fc18e45, no file edited during it, constants still at
//                53 / 513 (the stale-low direction the runner cannot see), `node
//                scripts/mutation-runner/run.mjs`: `scope: FULL 54/54 annotated
//                files`, `coverage: files 54/81`, `arms: 545/545/0`, `biting:
//                545`, `lane-invocations: 545 … plus 54 baseline / 54 restore
//                leg(s)` (the two independent tallies AGREE), `lane-blocked: 0`,
//                `lane-probe: pg_cron AVAILABLE`, `unreachable: 27`, `per-arm
//                lane time: mean 1.3s over 545 arm run(s)`, `✅ No defects. Every
//                annotated arm bit its own arm first.`, exit 0. Per-file line:
//                `test_refresh_fanout_zero_snapshot_bootstrap.sql: sections 27 /
//                judged 32 / annotated 32 / waived 0 / biting 32`. The stale-low
//                direction was observed first in src/__tests__/mutation-runner-
//                floors.test.ts: `RATCHET STALE: 54 of 81 gate files are now
//                annotated but FILES_FLOOR is still 53.` WAIVED_CEILING stays 0.
//
// ⭐ RE-DERIVED 2026-10-01 (Phase 164.9.3.2 DEFER40001, plan 06), 54 -> 55: the
//                NEW gate supabase/tests/test_compute_job_fence_errcode.sql
//                (the gate for migration 20261001120000: the four claim-token
//                fence raises of defer_compute_job, mark_compute_job_done and
//                mark_compute_job_failed answer SQLSTATE 55006, never 40001,
//                which PostgREST would retry; 8 arms). The denominator moves
//                81 -> 82. MEASURED on the tree MERGED with origin/main
//                (c110555e2, which adds no gate file) via ONE full lane run with
//                no file edited during it, constants still at 54 / 545 (the
//                stale-low direction the runner cannot see), `node
//                scripts/mutation-runner/run.mjs`: `scope: FULL 55/55 annotated
//                files`, `coverage: files 55/82`, `arms: 553/553/0`, `biting:
//                553`, `lane-invocations: 553 … plus 55 baseline / 55 restore
//                leg(s)` (the two independent tallies AGREE), `lane-blocked: 0`,
//                `lane-probe: pg_cron AVAILABLE`, `unreachable: 27`, `per-arm
//                lane time: mean 1.2s over 553 arm run(s)`, `✅ No defects. Every
//                annotated arm bit its own arm first.`, exit 0, wall clock 784 s.
//                Per-file line: `test_compute_job_fence_errcode.sql: sections 8
//                / judged 8 / annotated 8 / waived 0 / biting 8`; every other
//                per-file row is unchanged. Stale-low direction OBSERVED at 54:
//                src/__tests__/mutation-runner-floors.test.ts FAILS with
//                `RATCHET STALE: 55 of 82 gate files are now annotated but
//                FILES_FLOOR is still 54. Raise FILES_FLOOR in
//                scripts/mutation-runner/run.mjs to 55.` Too-high direction
//                OBSERVED at 56 (with ARMS_FLOOR 554): a full lane run exits 1
//                naming `FILES_FLOOR regression: 55 annotated file(s) < floor
//                56`. Each separation edit was restored from a byte backup and
//                proved with cmp. WAIVED_CEILING stays 0.
//
// ⭐ RE-DERIVED 2026-10-02 (Phase 164.9.3.2.1 ENQ40001, plan 03), 55 -> 56: the
//                NEW gate supabase/tests/test_enqueue_race_loss_40001.sql (the
//                enqueue race-loss raise of _enqueue_compute_job_internal, latest
//                definition migration 20260924230827: R1 the induced race raises
//                SQLSTATE 40001 with the race-lost message, R2 the re-run
//                enqueues a fresh pending job once the winner is done; 2 arms).
//                The denominator moves 82 -> 83. MEASURED on the tree MERGED
//                with origin/main (f18b49f8a, already the branch's merge base, so
//                the merge was a no-op) via ONE full lane run with no file edited
//                during it, constants still at 55 / 553 (the stale-low direction
//                the runner cannot see), `node scripts/mutation-runner/run.mjs`:
//                `scope: FULL 56/56 annotated files`, `coverage: files 56/83`,
//                `arms: 555/555/0`, `biting: 555`, `lane-invocations: 555 … plus
//                56 baseline / 56 restore leg(s)` (the two independent tallies
//                AGREE), `lane-blocked: 0`, `lane-probe: pg_cron AVAILABLE`,
//                `unreachable: 27`, `per-arm lane time: mean 1.1s over 555 arm
//                run(s)`, `✅ No defects. Every annotated arm bit its own arm
//                first.`, exit 0, wall clock 761 s. Per-file line:
//                `test_enqueue_race_loss_40001.sql: sections 2 / judged 2 /
//                annotated 2 / waived 0 / biting 2`; every other per-file row is
//                unchanged. Stale-low direction OBSERVED at 55:
//                src/__tests__/mutation-runner-floors.test.ts FAILS with
//                `RATCHET STALE: 56 of 83 gate files are now annotated but
//                FILES_FLOOR is still 55. Raise FILES_FLOOR in
//                scripts/mutation-runner/run.mjs to 56.` Too-high direction
//                OBSERVED at 57 (with ARMS_FLOOR 556): a full lane run exits 1
//                with exactly two defects, one naming `FILES_FLOOR regression: 56
//                annotated file(s) < floor 57`. Each separation edit was restored
//                from a byte backup and proved with cmp. WAIVED_CEILING stays 0.
//
// ⭐ RE-DERIVED 2026-10-03 (Phase 164.5.2.1 BRIDGERESIDUE, plan 05), 56 -> 58:
//                TWO NEW gates, both against the bridge
//                sync_strategy_analytics_status as migration 20261003120000
//                defines it: supabase/tests/test_sync_status_bridge_residues.sql
//                (the COMPOSITE-REREAD and RETRY-PLAIN-COMPLETE residues and the
//                hold-the-date keep, 16 arms) and the LANE-ONLY two-backend
//                supabase/tests/test_sync_status_bridge_lock.sql (the in-bridge
//                per-strategy advisory lock, 2 arms). The denominator moves
//                83 -> 85. MEASURED on the tree MERGED with origin/main (merge
//                commit d0e1398a1 over origin/main 32771e783) via ONE full lane
//                run with no file edited during it, constants still at 56 / 556
//                (the stale-low direction the runner cannot see),
//                `node scripts/mutation-floors.mjs`: `scope: FULL 58/58
//                annotated files`, `coverage: files 58/85`, `arms: 574/574/0`,
//                `biting: 574`, `lane-invocations: 574 … plus 58 baseline / 58
//                restore leg(s)` (the two independent tallies AGREE),
//                `lane-blocked: 0`, `lane-probe: pg_cron AVAILABLE`,
//                `unreachable: 27`, `per-arm lane time: mean 1.1s over 574 arm
//                run(s)`, `✅ No defects. Every annotated arm bit its own arm
//                first.`, exit 0, wall clock 790 s. Per-file lines:
//                `test_sync_status_bridge_lock.sql: sections 2 / judged 2 /
//                annotated 2 / waived 0 / biting 2` and
//                `test_sync_status_bridge_residues.sql: sections 16 / judged 16 /
//                annotated 16 / waived 0 / biting 16`; every other per-file row is
//                unchanged. Stale-low direction OBSERVED at 56 on the merged tree:
//                src/__tests__/mutation-runner-floors.test.ts FAILS with
//                `RATCHET STALE: 58 of 85 gate files are now annotated but
//                FILES_FLOOR is still 56. Raise FILES_FLOOR in
//                scripts/mutation-floors.mjs to 58.` Too-high direction
//                OBSERVED at 59 (with ARMS_FLOOR 575): a full lane run exits 1
//                with exactly two defects, one naming `FILES_FLOOR regression: 58
//                annotated file(s) < floor 59`. The separation edit was restored
//                from a byte backup and proved with cmp (exit 0).
//                WAIVED_CEILING stays 0.
//
// RAISED 58 -> 59 2026-10-07 (Phase 164.6.6.3.5 DOMAINONE, plan 03): the new gate
// supabase/tests/test_for_quants_leads_contact_dedupe.sql (four annotated arms,
// all on `sql` steps) took the corpus from 58 to 59 annotated files. MEASURED by
// ONE full lane run of `node scripts/mutation-runner/run.mjs`, no file edited
// during it, constants at 59 / 578 (the floors equal the measurement): `scope: FULL 59/59 annotated files`,
// `coverage: files 59/86`, `arms: 578/578/0`, `biting: 578`, `lane-invocations:
// 578 ... plus 59 baseline / 59 restore leg(s)` (the two independent tallies
// AGREE), `lane-blocked: 0`, `lane-probe: pg_cron AVAILABLE`, `unreachable: 27`,
// `per-arm lane time: mean 2.6s over 578 arm run(s)`, `No defects. Every annotated
// arm bit its own arm first.`, exit 0. Per-file line:
// `test_for_quants_leads_contact_dedupe.sql: sections 4 / judged 4 / annotated 4 /
// waived 0 / biting 4`. WAIVED_CEILING stays 0.
//
// RAISED 59 -> 60 2026-10-07 (Phase 164.6.6.3.4 STATUSBRIDGE, plan 03): the new gate
// supabase/tests/test_sync_status_analytics_scope.sql (thirteen annotated arms: S1..S6,
// C1..C4, G1..G3) took the corpus from 59 to 60 annotated files. MEASURED by ONE
// full lane run of `node scripts/mutation-runner/run.mjs` on the tree merged with
// origin/main (239106dc5), no file edited during it, constants still at 59 / 578
// (the floors read the measurement, never the other way round): `scope: FULL 60/60
// annotated files`, `lane-concurrency: 4`, `coverage: files 60/87`, `arms:
// 591/591/0`, `biting: 591`, `lane-invocations: 591 ... plus 60 baseline / 60
// restore leg(s)` (the two independent tallies AGREE), `lane-blocked: 0`,
// `lane-probe: pg_cron AVAILABLE`, `unreachable: 27`, `per-arm lane time: mean
// 3.1s over 591 arm run(s)`, `No defects. Every annotated arm bit its own arm
// first.`, exit 0. Per-file line: `test_sync_status_analytics_scope.sql: sections
// 13 / judged 13 / annotated 13 / waived 0 / biting 13`. Both directions are
// recorded under ARMS_FLOOR below. WAIVED_CEILING stays 0.
// RAISED 60 -> 61 2026-10-08 (Phase 164.9.7 TRUNCATEREVOKE, merge with origin/main): the
// new gate supabase/tests/test_truncate_revoke_anon_authenticated.sql (six annotated
// arms, TRUNC 1 to TRUNC 6, all on `sql` steps; migration 20261009130000) took the
// corpus from 60 to 61 annotated files on top of Phase 164.6.6.3.4's 60. The branch had
// measured 59 -> 60 / 578 -> 584 alone; once main's STATUSBRIDGE gate arrived the two
// counts COMBINED and were re-measured, never added by hand. MEASURED by ONE full lane
// run of `node scripts/mutation-runner/run.mjs` on the merged tree, no file edited
// during it: `scope: FULL 61/61 annotated files`, `lane-concurrency: 4`, `coverage:
// files 61/88`, `arms: 605/605/0`, `biting: 605`, `lane-invocations: 605 ... plus 61
// baseline / 61 restore leg(s)` (the two independent tallies AGREE), `lane-blocked: 0`,
// `lane-probe: pg_cron AVAILABLE`, `unreachable: 27`, `per-arm lane time: mean 1.4s over
// 605 arm run(s)`, `No defects. Every annotated arm bit its own arm first.`, exit 0.
// Per-file lines: `test_truncate_revoke_anon_authenticated.sql: sections 6 / judged 6 /
// annotated 6 / waived 0 / biting 6` and `test_sync_status_analytics_scope.sql: sections
// 21 / judged 21 / annotated 21 / waived 0 / biting 21`. An EARLIER full run on the same
// frozen tree read `biting: 604` with `wrong-first-failure N1 1a` on
// test_strategy_shares_rls.sql ("the lane emitted no TEST FAILED at all") and exited 1;
// `--file supabase/tests/test_strategy_shares_rls.sql` over that gate then read 45/45/0
// biting, and the next full run read 605. That is a lane flake, not a census value, and
// it is recorded here rather than discarded. WAIVED_CEILING stays 0.
export const FILES_FLOOR = 61;

// ARMS_FLOOR — PINNED 2026-08-29 BY MEASUREMENT (plan 164.3-08), not chosen.
//
// It shipped at 0 in plan 05, which is a control that cannot fire, recorded as
// such (WINDOWS.md entry 27) because no honest full-corpus measurement existed:
// the real gate had zero RED-UNDER-M twins. That measurement now exists.
//
// MEASURED on the first green full-corpus run, 2026-08-29:
//   `node scripts/mutation-runner/run.mjs` -> exit 0
//   coverage: files 1/71
//   arms: 30/30/0  (executed/annotated/waived)
//   30 of 30 arms RED with first-failure identity ok; 0 waivers; 64s wall clock
//
// "Biting" is executed arms MINUS `no-red` and `wrong-first-failure` defects,
// which on that run was 30 - 0 = 30. The number was read off the RUN, never off
// this file — a floor picked by reading the finished artifact always passes.
//
// ⭐ RE-DERIVED 2026-09-01 UNDER THE SOUND PRIMITIVES (plan 164.3.1-09, SC-6).
// The 2026-08-29 pin above STAYS as lineage: it is not superseded, it is
// re-earned. Plans 164.3.1-01 and -05 replaced BOTH mechanisms that produce this
// number — line-based classification became statement tokenization, and the
// in-query identity nonce became source-location attribution — so 30 was correct
// by SCOPE but not yet by MECHANISM until measured again from scratch.
//
//   VALUE        30 — UNCHANGED. biting = 30 executed − 0 (no-red +
//                wrong-first-failure + synthesised-identity) = 30 − 0 = 30.
//   DATE         2026-09-01, at HEAD a305a71a.
//   COMMAND      `node scripts/mutation-runner/run.mjs` -> exit 0
//                  coverage: files 1/71
//                  arms: 30/30/0   (executed/annotated/waived)
//                  biting: 30
//                  per-arm lane time: mean 1.7s over 30 arm run(s)
//   SAMPLE SIZE  30 arms executed, all 30 `RED (identity ok)`, 0 moved from the
//                pre-phase per-arm baseline. Plus 104 identities / 103 backward
//                scans re-measured over the same file (99 accepted, 4 refused —
//                SERVICE-ROLE 2a-2d at :2249/:2254/:2268/:2273 — 0 refusals
//                added by the new primitives).
//   COVERAGE     1 annotated gate file of 71 in supabase/tests/, namely
//                supabase/tests/test_strategy_shares_rls.sql. Its blob is
//                BYTE-IDENTICAL at the phase base c2251b6d and at HEAD
//                (5ae6855f), so the INPUT was fixed and only the MECHANISM
//                moved — which is what makes "unchanged" a measurement here
//                rather than a coincidence of two different corpora.
//   RECORD       .planning/phases/164.3.1-sound-primitives-the-neuter-scan-and-
//                the-mutation-identity-c/164.3.1-09-REDERIVATION.md
//
// ⭐ Same integer, STRICTLY SMALLER admissible set. `identity ok` used to mean
// "the failure text carried this run's nonce" — a secret the gate's own SQL
// could read back through current_query(). It now means the raise's psql prefix
// names this lane's gate file at the failing statement's last line, AND the
// CONTEXT chain is exactly one `inline_code_block line N at RAISE` frame, AND N
// resolves through the tokenizer's spans to the arm's recorded raise line. A
// floor of 30 is therefore harder to satisfy than it was — the safe direction
// for a ratchet, and the fact plan 164.3.1-10 must carry with the integer.
//
// ⚠️ RATCHET, NOT A TARGET. It fails on REGRESSION only: an annotation that
// stops biting, or one deleted outright, drops the biting count below the floor
// and exits 1. It never demands more than the corpus declares. Phase 164.4
// raises it as it backfills the remaining idiom files.
// ⛔ Converting an arm to a `waiver` LOWERS the biting count and therefore trips
// this floor. That is deliberate: waiver creep is how a non-biting arm hides
// (T-164.3-21), so widening a waiver has to be an explicit, reviewed edit here.
//
// ⭐ RE-DERIVED 2026-09-03 (plan 164.4-02) — MEASURED on the full-corpus run at
// HEAD c850a790. The two pins above STAY as lineage: 30 was the whole corpus
// when it was written. This move is a COVERAGE move, not a mechanism move —
// the reference file's 15 un-twinned SECTIONS were closed, so the same file
// now declares 45 arms where it declared 30.
//
//   VALUE        45 — biting = 45 executed − 0 (no-red + wrong-first-failure +
//                synthesised-identity) = 45 − 0 = 45.
//   DATE         2026-09-03, at HEAD c850a790.
//   COMMAND      `node scripts/mutation-runner/run.mjs` -> exit 0
//                  coverage: files 1/71
//                  arms: 45/45/0   (executed/annotated/waived)
//                  biting: 45
//                  lane-invocations: 45
//                  file test_strategy_shares_rls.sql: sections 35 / judged 45 /
//                    annotated 45 / waived 0 / biting 45
//                  per-arm lane time: mean 0.9s over 45 arm run(s)
//   SAMPLE SIZE  45 arms executed, all 45 `RED (identity ok)`, 0 defects of any
//                kind. The two independent tallies AGREE: `arms:` executed 45
//                and `lane-invocations:` 45.
//   COVERAGE     STILL 1 annotated gate file of 71 in supabase/tests/, namely
//                supabase/tests/test_strategy_shares_rls.sql — no new FILE was
//                annotated, which is why FILES_FLOOR does not move. What moved
//                is SECTION coverage WITHIN that file: 20 of its 35 sections
//                carried a twin before, 35 of 35 do now.
//   SEPARATION   Both directions driven through the real verdict loop on real
//                lanes (`runCorpus({armsFloor})`), 2026-09-03:
//                  armsFloor=45  biting=45  floor-defects=0  SILENT
//                  armsFloor=46  biting=45  floor-defects=1  FIRES ->
//                    `ARMS_FLOOR regression: 45 biting arm(s) < floor 46`
//                So 45 is exactly the separation point, not a value below it.
//   RECORD       .planning/phases/164.4-redunder-backfill-every-sql-gate-arm-
//                gets-a-red-under-annota/164.4-02-SUMMARY.md
//
// ⭐ RE-DERIVED 2026-09-03 (plan 164.4-04) — MEASURED on the full-corpus run at
// HEAD fd600efb. The three pins above STAY as lineage. This move is a COVERAGE
// move like 164.4-02's, but across FILES rather than within one: the
// ledger_refresh family (15 + 15 + 11 = 41 sections) was annotated to
// completion, so 45 + 41 = 86.
//
//   VALUE        86 — biting = 86 executed − 0 (no-red + wrong-first-failure +
//                synthesised-identity) = 86 − 0 = 86.
//   DATE         2026-09-03, at HEAD fd600efb.
//   COMMAND      `node scripts/mutation-runner/run.mjs` -> exit 0
//                  coverage: files 4/71
//                  arms: 86/86/0   (executed/annotated/waived)
//                  biting: 86
//                  lane-invocations: 86
//                  file test_ledger_refresh_composite_arm.sql: sections 15 /
//                    judged 15 / annotated 15 / waived 0 / biting 15
//                  file test_ledger_refresh_fanout.sql: sections 15 /
//                    judged 15 / annotated 15 / waived 0 / biting 15
//                  file test_ledger_refresh_staleness.sql: sections 11 /
//                    judged 11 / annotated 11 / waived 0 / biting 11
//                  file test_strategy_shares_rls.sql: sections 35 / judged 45 /
//                    annotated 45 / waived 0 / biting 45
//                  per-arm lane time: mean 1.0s over 86 arm run(s)
//   SAMPLE SIZE  86 arms executed, all 86 `RED (identity ok)`, 0 defects of any
//                kind. The two independent tallies AGREE: `arms:` executed 86
//                and `lane-invocations:` 86. 96 s wall clock, 4 baseline and 4
//                restore legs beside the 86 arm lanes.
//   COVERAGE     4 annotated gate files of 71 (see the FILES_FLOOR block). 41
//                of the 86 arms are new this batch and every one of them is a
//                SECTION that had no twin before; 0 waivers were added, so
//                WAIVED_CEILING is untouched at 0.
//   SEPARATION   Both directions driven through the real verdict loop on real
//                lanes (`runCorpus({armsFloor})`), 2026-09-03:
//                  armsFloor=86  biting=86  floor-defects=0  SILENT
//                  armsFloor=87  biting=86  floor-defects=1  FIRES ->
//                    `ARMS_FLOOR regression: 86 biting arm(s) < floor 87`
//                So 86 is exactly the separation point, not a value below it.
//   RECORD       .planning/phases/164.4-redunder-backfill-every-sql-gate-arm-
//                gets-a-red-under-annota/164.4-04-SUMMARY.md
//
// ⭐ RE-DERIVED 2026-09-03 (plan 164.4-05) — MEASURED on the full-corpus run at
// HEAD 61d80472. The four pins above STAY as lineage. Another COVERAGE move
// across FILES: five NEW gate files (11 + 10 + 9 + 9 + 9 = 48 sections) were
// annotated to completion, so 86 + 48 = 134.
//
//   VALUE        134 — biting = 134 executed − 0 (no-red + wrong-first-failure +
//                synthesised-identity) = 134 − 0 = 134.
//   DATE         2026-09-03, at HEAD 61d80472.
//   COMMAND      `node scripts/mutation-runner/run.mjs` -> exit 0
//                  coverage: files 9/71
//                  arms: 134/134/0   (executed/annotated/waived)
//                  biting: 134
//                  lane-invocations: 134
//                  file test_capital_ownership_allocation_guard.sql: sections 10
//                    / judged 10 / annotated 10 / waived 0 / biting 10
//                  file test_create_wizard_strategy_for_key.sql: sections 9 /
//                    judged 9 / annotated 9 / waived 0 / biting 9
//                  file test_scenario_shares_rls.sql: sections 9 / judged 9 /
//                    annotated 9 / waived 0 / biting 9
//                  file test_strategy_keys_rls.sql: sections 9 / judged 9 /
//                    annotated 9 / waived 0 / biting 9
//                  file test_wizard_composite_members.sql: sections 11 /
//                    judged 11 / annotated 11 / waived 0 / biting 11
//                  per-arm lane time: mean 1.0s over 134 arm run(s)
//   SAMPLE SIZE  134 arms executed, all 134 `RED (identity ok)`, 0 defects of
//                any kind. The two independent tallies AGREE: `arms:` executed
//                134 and `lane-invocations:` 134. 151 s wall clock, 9 baseline
//                and 9 restore legs beside the 134 arm lanes.
//   COVERAGE     9 annotated gate files of 71 (see the FILES_FLOOR block). 48
//                of the 134 arms are new this batch and every one of them is a
//                SECTION that had no twin before; 0 waivers were added, so
//                WAIVED_CEILING is untouched at 0.
//   SEPARATION   Both directions driven through the real verdict loop on real
//                lanes (`runCorpus({armsFloor})`), 2026-09-03:
//                  armsFloor=134  biting=134  floor-defects=0  SILENT
//                  armsFloor=135  biting=134  floor-defects=1  FIRES ->
//                    `ARMS_FLOOR regression: 134 biting arm(s) < floor 135`
//                So 134 is exactly the separation point, not a value below it.
//   RECORD       .planning/phases/164.4-redunder-backfill-every-sql-gate-arm-
//                gets-a-red-under-annota/164.4-05-SUMMARY.md
//
// ⭐ RE-DERIVED 2026-09-03 (plan 164.4-06) — MEASURED on the full-corpus run at
// HEAD 65c4a13b. The five pins above STAY as lineage. Another COVERAGE move
// across FILES: four NEW gate files (8 + 7 + 7 + 7 = 29 sections) were
// annotated to completion, so 134 + 29 = 163.
//
//   VALUE        163 — biting = 163 executed − 0 (no-red + wrong-first-failure +
//                synthesised-identity) = 163 − 0 = 163.
//   DATE         2026-09-03, at HEAD 65c4a13b.
//   COMMAND      `node scripts/mutation-runner/run.mjs` -> exit 0
//                  coverage: files 13/71
//                  arms: 163/163/0   (executed/annotated/waived)
//                  biting: 163
//                  lane-invocations: 163
//                  file test_api_keys_venue_identity_uniq.sql: sections 7 /
//                    judged 7 / annotated 7 / waived 0 / biting 7
//                  file test_capital_ownership_column.sql: sections 7 /
//                    judged 7 / annotated 7 / waived 0 / biting 7
//                  file test_csv_daily_returns_perkey_rls.sql: sections 7 /
//                    judged 7 / annotated 7 / waived 0 / biting 7
//                  file test_strategies_private_owner_isolation.sql: sections 8
//                    / judged 8 / annotated 8 / waived 0 / biting 8
//                  per-arm lane time: mean 1.0s over 163 arm run(s)
//   SAMPLE SIZE  163 arms executed, all 163 `RED (identity ok)`, 0 defects of
//                any kind. The two independent tallies AGREE: `arms:` executed
//                163 and `lane-invocations:` 163. 197 s wall clock, 13 baseline
//                and 13 restore legs beside the 163 arm lanes.
//   COVERAGE     13 annotated gate files of 71 (see the FILES_FLOOR block). 29
//                of the 163 arms are new this batch and every one of them is a
//                SECTION that had no twin before; 0 waivers were added, so
//                WAIVED_CEILING is untouched at 0.
//   SEPARATION   Both directions driven through the real verdict loop on real
//                lanes (`runCorpus({armsFloor})`), 2026-09-03:
//                  armsFloor=163  biting=163  floor-defects=0  SILENT
//                  armsFloor=164  biting=163  floor-defects=1  FIRES ->
//                    `ARMS_FLOOR regression: 163 biting arm(s) < floor 164`
//                So 163 is exactly the separation point, not a value below it.
//   RECORD       .planning/phases/164.4-redunder-backfill-every-sql-gate-arm-
//                gets-a-red-under-annota/164.4-06-SUMMARY.md
//
// ⭐ RE-DERIVED 2026-09-03 (plan 164.4-07) — MEASURED on the full-corpus run at
// HEAD 93b37a80. The six pins above STAY as lineage. Another COVERAGE move across
// FILES: four NEW gate files (7 + 7 + 6 + 6 = 26 sections) were annotated to
// completion, so 163 + 26 = 189.
//
//   VALUE        189 — biting = 189 executed − 0 (no-red + wrong-first-failure +
//                synthesised-identity) = 189 − 0 = 189.
//   DATE         2026-09-03, at HEAD 93b37a80.
//   COMMAND      `node scripts/mutation-runner/run.mjs` -> exit 0
//                  coverage: files 17/71
//                  arms: 189/189/0   (executed/annotated/waived)
//                  biting: 189
//                  lane-invocations: 189
//                  file test_allocator_equity_derived_rls.sql: sections 6 /
//                    judged 6 / annotated 6 / waived 0 / biting 6
//                  file test_csv_finalize_atomic_fold.sql: sections 7 /
//                    judged 7 / annotated 7 / waived 0 / biting 7
//                  file test_funding_fees_rls.sql: sections 7 /
//                    judged 7 / annotated 7 / waived 0 / biting 7
//                  file test_user_notes_dashboard_scope.sql: sections 6 /
//                    judged 6 / annotated 6 / waived 0 / biting 6
//                  per-arm lane time: mean 1.0s over 189 arm run(s)
//   SAMPLE SIZE  189 arms executed, all 189 `RED (identity ok)`, 0 defects of
//                any kind. The two independent tallies AGREE: `arms:` executed
//                189 and `lane-invocations:` 189. 224 s wall clock, 17 baseline
//                and 17 restore legs beside the 189 arm lanes.
//   COVERAGE     17 annotated gate files of 71 (see the FILES_FLOOR block). 26
//                of the 189 arms are new this batch and every one of them is a
//                SECTION that had no twin before; 0 waivers were added, so
//                WAIVED_CEILING is untouched at 0.
//   SEPARATION   Both directions driven through the real verdict loop on real
//                lanes (`runCorpus({armsFloor})`), 2026-09-03:
//                  armsFloor=189  biting=189  floor-defects=0  SILENT (225.4 s)
//                  armsFloor=190  biting=189  floor-defects=1  FIRES ->
//                    `ARMS_FLOOR regression: 189 biting arm(s) < floor 190`
//                So 189 is exactly the separation point, not a value below it.
//   RECORD       .planning/phases/164.4-redunder-backfill-every-sql-gate-arm-
//                gets-a-red-under-annota/164.4-07-SUMMARY.md
//
// ⭐ RE-DERIVED 2026-09-04 (plan 164.4-08) — MEASURED on the full-corpus run at
// HEAD 029ba435. The seven pins above STAY as lineage. Another COVERAGE move
// across FILES: six NEW gate files (5 sections each) were annotated to
// completion, so 189 + 30 = 219.
//
//   VALUE        219 — biting = 219 executed − 0 (no-red + wrong-first-failure +
//                synthesised-identity) = 219 − 0 = 219.
//   DATE         2026-09-04, at HEAD 029ba435.
//   COMMAND      `node scripts/mutation-runner/run.mjs` -> exit 0
//                  coverage: files 23/71
//                  arms: 219/219/0   (executed/annotated/waived)
//                  biting: 219
//                  lane-invocations: 219
//                  file test_csv_finalize_double_submit.sql: sections 5 /
//                    judged 5 / annotated 5 / waived 0 / biting 5
//                  file test_get_published_trust_signals.sql: sections 5 /
//                    judged 5 / annotated 5 / waived 0 / biting 5
//                  file test_get_verified_cohort_rank_gate.sql: sections 5 /
//                    judged 5 / annotated 5 / waived 0 / biting 5
//                  file test_scenario_downgrade_sweep.sql: sections 5 /
//                    judged 5 / annotated 5 / waived 0 / biting 5
//                  file test_scenarios_rls.sql: sections 5 /
//                    judged 5 / annotated 5 / waived 0 / biting 5
//                  file test_strategy_analytics_series_completeness.sql:
//                    sections 5 / judged 5 / annotated 5 / waived 0 / biting 5
//                  per-arm lane time: mean 1.0s over 219 arm run(s)
//   SAMPLE SIZE  219 arms executed, all 219 `RED (identity ok)`, 0 defects of
//                any kind. The two independent tallies AGREE: `arms:` executed
//                219 and `lane-invocations:` 219. 266 s wall clock, 23 baseline
//                and 23 restore legs beside the 219 arm lanes.
//   COVERAGE     23 annotated gate files of 71 (see the FILES_FLOOR block). 30
//                of the 219 arms are new this batch and every one of them is a
//                SECTION that had no twin before; 0 waivers were added, so
//                WAIVED_CEILING is untouched at 0.
//   ⭐ ONE OF THE 30 WAS UNLOCKED BY A REORDER, NOT BY A WAIVER.
//                `test_get_published_trust_signals.sql` assertion 5 proves the
//                anon EXECUTE grant that assertions 1-3 need to call the
//                function at all. Behind them it was unmutatable — the revoke
//                killed assertion 1 with a raw 42501 naming no arm — and it was
//                escalated as a waiver candidate ([REDUNDER-WAIVER-01]). The
//                founder chose the root-cause fix: the precondition now runs
//                FIRST, its six executable lines relocated byte-identically
//                with the `(5)` identity unchanged, and the same revoke now
//                reports `TEST FAILED (5)` as the first failure. So this arm is
//                counted in `biting`, and WAIVED_CEILING stayed 0 rather than
//                rising to 1.
//   SEPARATION   Both directions driven through the real verdict loop on real
//                lanes (`runCorpus({armsFloor})`), 2026-09-04:
//                  armsFloor=219  biting=219  floor-defects=0  SILENT (268.1 s)
//                  armsFloor=220  biting=219  floor-defects=1  FIRES ->
//                    `ARMS_FLOOR regression: 219 biting arm(s) < floor 220`
//                                                                    (269.2 s)
//                So 219 is exactly the separation point, not a value below it.
//   RECORD       .planning/phases/164.4-redunder-backfill-every-sql-gate-arm-
//                gets-a-red-under-annota/164.4-08-SUMMARY.md
//
// ⭐ RE-DERIVED 2026-09-04 (plan 164.4-09) — THE SIXTH ARMS MOVE. The blocks
// above STAY as lineage. Twenty NEW arms across five NEW gate files, each one a
// SECTION that had no twin before.
//
//   VALUE        239 — read off the run's own `biting:` line, not counted here.
//   DATE         2026-09-04, at HEAD ff2a3f4a.
//   COMMAND      `node scripts/mutation-runner/run.mjs` -> exit 0
//                  coverage: files 28/71
//                  arms: 239/239/0   (executed/annotated/waived)
//                  biting: 239
//                  lane-invocations: 239
//                  file test_strategy_verifications_wizard_session_tenant_scope
//                    .sql: sections 5 / judged 5 / annotated 5 / waived 0 /
//                    biting 5
//                  file test_wizard_composite_fence.sql: sections 5 /
//                    judged 5 / annotated 5 / waived 0 / biting 5
//                  file test_weight_snapshot_seed_secdef.sql: sections 4 /
//                    judged 4 / annotated 4 / waived 0 / biting 4
//                  file test_csv_finalize_auth_guard.sql: sections 3 /
//                    judged 3 / annotated 3 / waived 0 / biting 3
//                  file test_resync_retry_single_job.sql: sections 3 /
//                    judged 3 / annotated 3 / waived 0 / biting 3
//                  per-arm lane time: mean 1.0s over 239 arm run(s)
//   SAMPLE SIZE  239 arms executed, all 239 `RED (identity ok)`, 0 defects of
//                any kind. The two independent tallies AGREE: `arms:` executed
//                239 and `lane-invocations:` 239. 297 s wall clock, 28 baseline
//                and 28 restore legs beside the 239 arm lanes. The 28 per-file
//                `biting` counts SUM to 239, the aggregate.
//   COVERAGE     28 annotated gate files of 71 (see the FILES_FLOOR block). 20
//                of the 239 arms are new this batch; 0 waivers were added, so
//                WAIVED_CEILING is untouched at 0.
//   ⭐ ONE OF THE 20 WAS UNLOCKED BY A GATE-STRUCTURE FIX, NOT BY A WAIVER —
//                the same precedent as [REDUNDER-WAIVER-01] above.
//                `test_resync_retry_single_job.sql` assertion (b) issued its
//                two-row INSERT with no exception handler, so its only
//                falsifying mutation — narrowing the SV unique index to
//                (strategy_id) — aborted psql with a raw 23505 and MEASURED
//                `occurrences of "TEST FAILED (" in the lane output: 0`. It was
//                escalated as a waiver candidate. The founder chose the
//                root-cause fix: the INSERT is now wrapped in the
//                `BEGIN … EXCEPTION WHEN unique_violation` idiom THAT SAME FILE
//                already uses at assertion (c), with no assertion, message or
//                identity changed. The same narrowing now reports
//                `TEST FAILED (b)` as the first failure, single-frame CONTEXT,
//                LOCATION last. So this arm is counted in `biting`, and
//                WAIVED_CEILING stayed 0 rather than rising to 1.
//   SEPARATION   Both directions driven through the real verdict loop on real
//                lanes (`runCorpus({filesFloor, armsFloor})`), 2026-09-04:
//                  armsFloor=239  biting=239  defects=0  SILENT      (298.7 s)
//                  armsFloor=240  biting=239  defects=2  FIRES ->
//                    `ARMS_FLOOR regression: 239 biting arm(s) < floor 240`
//                    (beside the paired FILES_FLOOR regression)      (295.8 s)
//                So 239 is exactly the separation point, not a value below it.
//   RECORD       .planning/phases/164.4-redunder-backfill-every-sql-gate-arm-
//                gets-a-red-under-annota/164.4-09-SUMMARY.md
//
// ⭐ RE-DERIVED 2026-09-04 (plan 164.4-10) — THE SEVENTH ARMS MOVE. The blocks
// above STAY as lineage. Eight NEW arms across four NEW gate files, each one a
// SECTION that had no twin before.
//
//   VALUE        247 — read off the run's own `biting:` line, not counted here.
//   DATE         2026-09-04, at HEAD 3a81a284 (see the FILES_FLOOR block's DATE
//                note on the intervening TODOS.md-only commit).
//   COMMAND      `node scripts/mutation-runner/run.mjs` -> exit 0
//                  coverage: files 32/71
//                  arms: 247/247/0   (executed/annotated/waived)
//                  biting: 247
//                  lane-invocations: 247
//                  file test_allocator_equity_pre_terminus_flag.sql: sections 2
//                    / judged 2 / annotated 2 / waived 0 / biting 2
//                  file test_enqueue_compute_job_dedupe_non_terminal.sql:
//                    sections 2 / judged 2 / annotated 2 / waived 0 / biting 2
//                  file test_metrics_by_basis_write.sql: sections 2 /
//                    judged 2 / annotated 2 / waived 0 / biting 2
//                  file test_set_compute_job_progress.sql: sections 2 /
//                    judged 2 / annotated 2 / waived 0 / biting 2
//                  per-arm lane time: mean 1.0s over 247 arm run(s)
//   SAMPLE SIZE  247 arms executed, all 247 `RED (identity ok)`, 0 defects of
//                any kind. The two independent tallies AGREE: `arms:` executed
//                247 and `lane-invocations:` 247. 316 s wall clock, 32 baseline
//                and 32 restore legs beside the 247 arm lanes. The 32 per-file
//                `biting` counts SUM to 247, the aggregate.
//   COVERAGE     32 annotated gate files of 71 (see the FILES_FLOOR block). 8
//                of the 247 arms are new this batch; 0 waivers were added, so
//                WAIVED_CEILING is untouched at 0. Cumulative waivers across
//                all seven arms moves: 0.
//   ⭐ ONE OF THE 8 IS LAYERED BECAUSE THE DEDUPE IT TESTS IS LAYERED, and that
//                was MEASURED, not assumed. `test_enqueue_compute_job_dedupe_
//                non_terminal.sql` arm B1 is fenced by TWO independent
//                arbiters: the RPC's optimistic look-up in 20260826150000 AND
//                the partial unique index compute_jobs_one_inflight_per_kind_
//                strategy in 20260416125430. Mutating the look-up ALONE was run
//                on the lane and measured NON-BITING — the index rejects the
//                second INSERT, `ON CONFLICT DO NOTHING` swallows it, the
//                lost-race re-read returns the SAME id, and the gate prints
//                `B1 OK: 2 calls -> 1 row` and exits 0. A single-step twin would
//                have shipped looking correct and proving nothing. B1's twin
//                therefore carries both steps. Same class as the wave-10
//                finding; second independent instance.
//   SEPARATION   Both directions driven through the real verdict loop on real
//                lanes (`runCorpus({filesFloor, armsFloor})`), 2026-09-04:
//                  armsFloor=247  biting=247  defects=0  SILENT      (320.7 s)
//                  armsFloor=248  biting=247  defects=2  FIRES ->
//                    `ARMS_FLOOR regression: 247 biting arm(s) < floor 248`
//                    (beside the paired FILES_FLOOR regression)      (324.0 s)
//                So 247 is exactly the separation point, not a value below it.
//   RECORD       .planning/phases/164.4-redunder-backfill-every-sql-gate-arm-
//                gets-a-red-under-annota/164.4-10-SUMMARY.md
//
// ⭐ RE-DERIVED 2026-09-04 (plan 164.4-11) — batch 8, the SEVEN ⚠️ mixed files
// and the LAST arms move of Phase 164.4. The blocks above STAY as lineage.
//
//   VALUE        262 — read off the run's own `biting:` line, not counted here.
//   DATE         2026-09-04, at HEAD 1aaba266.
//   COMMAND      `node scripts/mutation-runner/run.mjs` -> exit 0
//                  coverage: files 39/71
//                  arms: 262/262/0   (executed/annotated/waived)
//                  biting: 262
//                  lane-invocations: 262
//                  per-arm lane time: mean 1.0s over 262 arm run(s)
//   SAMPLE SIZE  262 arms executed, all 262 `RED (identity ok)`, 0 defects of
//                any kind. The two independent tallies AGREE: `arms:` executed
//                262 and `lane-invocations:` 262. 358 s wall clock, 39 baseline
//                and 39 restore legs beside the 262 arm lanes. The 39 per-file
//                `biting` counts SUM to 262, the aggregate.
//   COVERAGE     39 annotated gate files of 71 (see the FILES_FLOOR block). 15
//                of the 262 arms are new this batch; 0 waivers were added, so
//                WAIVED_CEILING is untouched at 0. Cumulative waivers across
//                all EIGHT arms moves: 0.
//   ⭐ THE MIXED FILES' SHADOW IS PRIVILEGE-SHAPED, and that decided every
//                twin here. These seven gates make PRIVILEGE claims, and a
//                withdrawn privilege aborts psql with `permission denied for
//                table …` — text carrying no `TEST FAILED (…)` at all, which
//                the runner scores NO-IDENTITY rather than RED. MEASURED per
//                arm on the lane. The falsifier that works is the ROW filter
//                (`api_keys_owner`, `profiles_self_update`): RLS returns zero
//                rows instead of raising, so the same broken user-visible
//                behaviour reaches the arm as a value mismatch it can name.
//   ⭐ TWO OF THE 15 ARE LAYERED, each proven layered rather than assumed.
//                `test_sync_status_marked_refresh_protected.sql` arm 0a: the
//                applied-ness id it greps appears TWICE inside the ONE function
//                COMMENT, so step 1 alone was run on the lane and measured
//                GREEN (exit 0, `ALL 16 ARMS EXECUTED`). It also targets
//                20260826120000, not the 20260825150000 its own message names —
//                six migrations stamp that comment and 20260826120000 is the
//                LAST, the re-base hazard this phase has now met five times.
//                `test_wizard_session_idempotency.sql` arm 3f: step 1 alone was
//                measured to ABORT the apply at that migration's own
//                post-verify (e2), which greps the comment-stripped body for
//                `v_auth_uid` exactly as the gate does; step 2 stands down (e2)
//                and only (e2).
//   ⭐ ONE ARM CAME BACK NO-RED AND THE APPLY LIST WAS THE DEFECT.
//                `test_profiles_privileged_columns_locked.sql` arm 1 was first
//                built without 20260405061912, which is the ONLY statement that
//                ENABLEs RLS on profiles. `profiles_self_update` was therefore
//                inert on the lane and narrowing it changed nothing. The fix
//                was the real migration, not a different mutation: a lane where
//                the object under test cannot bite is the stand-in defect this
//                phase exists to refuse.
//   SEPARATION   Both directions driven through the real verdict loop on real
//                lanes (`runCorpus({filesFloor, armsFloor})`), 2026-09-04:
//                  armsFloor=262  biting=262  defects=0  SILENT      (352.8 s)
//                  armsFloor=263  biting=262  defects=2  FIRES ->
//                    `ARMS_FLOOR regression: 262 biting arm(s) < floor 263`
//                    (beside the paired FILES_FLOOR regression)      (349.3 s)
//                So 262 is exactly the separation point, not a value below it.
//   RECORD       .planning/phases/164.4-redunder-backfill-every-sql-gate-arm-
//                gets-a-red-under-annota/164.4-11-SUMMARY.md
//
// ⭐ RE-DERIVED 2026-09-05 (plan 164.4.1-02) — the FIRST arms move of Phase
// 164.4.1 PGCRON-LANE. The blocks above STAY as lineage.
//
//   VALUE        272 — read off the run's own `biting:` line, not counted here.
//   DATE         2026-09-05, at HEAD f1311fbf.
//   COMMAND      `node scripts/mutation-runner/run.mjs` -> exit 1
//                  coverage: files 41/71
//                  arms: 272/272/0   (executed/annotated/waived)
//                  biting: 272
//                  lane-invocations: 272
//                  per-arm lane time: mean 1.0s over 272 arm run(s)
//                ⚠️ exit 1 is the EXPECTED interval state, not a regression —
//                one `lane-blocked-stale` row, the plan-01 tripwire, which
//                clears at plan 05. See the FILES_FLOOR block above.
//   SAMPLE SIZE  272 arms executed, all 272 `RED (identity ok)`, no defect of
//                any other kind. Both tallies AGREE (executed 272,
//                lane-invocations 272). 371 s wall clock, 41 baseline and 41
//                restore legs. The 41 per-file `biting` counts SUM to 272.
//   COVERAGE     41 annotated gate files of 71 (see the FILES_FLOOR block). 10
//                of the 272 arms are new this batch — 3 + 7; 0 waivers were
//                added, so WAIVED_CEILING is untouched at 0. Cumulative waivers
//                across all NINE arms moves of this phase family: 0.
//   ⭐ TWO OF THE 10 ARE LAYERED, each proven layered rather than assumed.
//                `test_derive_allocator_keys_fanout.sql` arm 2: in-flight dedup
//                for api_key jobs is defence in depth — the optimistic look-up
//                in `_enqueue_compute_job_internal` (20260420073003:392-398)
//                AND the partial unique index (:288-291). MEASURED: removing
//                EITHER alone leaves the assertion GREEN, so a single-step
//                mutation there is a `no-red`, not a falsifier. The index step
//                is scoped `kind <> 'derive_broker_dailies'` because that
//                migration's own Category-D probe (:1050-1057) still needs a
//                raw duplicate poll_allocator_positions INSERT to trip it.
//                `test_compute_jobs_error_kind_copy_parity.sql` arm 3/F-3: step
//                1 alone was RUN on the lane and measured to ABORT the apply at
//                20260826120000:1391 (`HONEST-01/F-3 verification failed: …
//                does not carry the affirmative instruction to retry`); step 2
//                re-points that one guard's needle and nothing else.
//   ⭐ ONE ARM NEEDED THE GATE'S OWN EXCEPTION IDIOM, not a waiver.
//                `test_derive_allocator_keys_fanout.sql` assertion 3 asserts a
//                coherence arm ADMITS a shape; the falsifier makes the INSERT
//                raise, and an unhandled 23514 aborts psql with a raw driver
//                error naming no arm. It was wrapped in the nested
//                `BEGIN … EXCEPTION WHEN check_violation` idiom assertion 4
//                already used — the mirror-image reason, and the same
//                root-cause-over-exception move plan 164.4-09 made.
//   ⭐ ONE ARM IS A `sql` STEP AND THAT IS FORCED, NOT PREFERRED.
//                Assertion 6 reads cron.job; 20260717233529's own STEP 6 arm
//                (g) pins `schedule = '30 5 * * *'` EXACTLY, so editing STEP 5
//                aborts the apply. The lane's --post-apply hook is where drift
//                that happens AFTER a migration self-verifies belongs — which
//                is also how a cron schedule drifts in production.
//   SEPARATION   Both directions driven through the real verdict loop on real
//                lanes (`runCorpus({filesFloor, armsFloor})`), 2026-09-05:
//                  armsFloor=272  biting=272  defects=1  kinds=
//                    ["lane-blocked-stale"]                       (367.9 s)
//                  armsFloor=273  biting=272  defects=3  kinds=
//                    ["lane-blocked-stale","floor","floor"] ->
//                    `ARMS_FLOOR regression: 272 biting arm(s) < floor 273`
//                    (beside the paired FILES_FLOOR regression)   (368.7 s)
//                So 272 is exactly the separation point, not a value below it.
//   RECORD       .planning/phases/164.4.1-pgcron-lane-put-pg-cron-on-the-
//                throwaway-pg-lane-and-retire/164.4.1-02-SUMMARY.md
//
// CURRENCY, stated where the VALUE is — derivation, sample size, coverage and
// separation in the block immediately above; record in 164.4.1-02-SUMMARY.md:
// RE-DERIVED 2026-09-05 by measurement (plan 164.4.1-02).
// Measured biting 272 — value RAISED from 262. The 2026-09-04 block above stays
// as the dated record of Phase 164.4's 262-arm end state; the next arms move is
// plan 03 of this phase.
//
// ⭐ RE-DERIVED 2026-09-05 (plan 164.4.1-03, the SECOND file move of Phase
// 164.4.1 PGCRON-LANE). The blocks above STAY as lineage.
//
//   VALUE        296 — read off the run's own `biting:` line, not counted here.
//                ⚠️ It is NOT the twin count. The corpus declares 297 twins and
//                ONE of them is a waiver, so a run bites 296. Those two numbers
//                diverged for the first time in this phase family here, and the
//                divergence is the point: see WAIVED_CEILING below.
//   DATE         2026-09-05, at HEAD 65c506cd.
//   COMMAND      `node scripts/mutation-runner/run.mjs` -> exit 1
//                  arms: 296/297/1   (executed/annotated/waived)
//                  biting: 296
//                  lane-invocations: 296
//   SAMPLE SIZE  296 arm lanes, all 296 `RED (identity ok)`; 42 baseline and 42
//                restore legs; the 42 per-file `biting` counts SUM to 296; the
//                two independent tallies (`arms:` executed and
//                `lane-invocations:`) AGREE.
//   COVERAGE     +25 sections over plan 02, all from
//                supabase/tests/test_retention_orphaned_running.sql — 8 in
//                Part 1's structural body scan, 14 in Part 2's directional
//                arms and 3 in Part 3's executed bound. 24 bite; the 25th,
//                `3/JOB-05`, is the waiver.
//                ⚠️ SHAPES MET HERE, recorded because they constrain the next
//                file: three twins are LAYERED because migration
//                20260826140000 self-verifies the body it deploys (its STEP 5
//                (d) counts 'orphaned' and ORPHANED_RUNNING_REAPED), one is
//                layered because the status scope is enforced TWICE and a
//                single-step mutation was MEASURED to be a `no-red`, and two
//                use `neuter` because the arm is dominated by this file's own
//                design (Part 1 is deliberately the free-standing RED).
//                ⛔ EVERY body twin targets 20260826140000, the LAST migration
//                to call cron.schedule for this jobname. cron.schedule upserts
//                by name, so an edit to 20260817120000's cron body is
//                OVERWRITTEN by the later call and comes back `no-red` — a
//                wrong target, never a reason for a waiver.
//   SEPARATION   Both directions driven through the real verdict loop on real
//                lanes, 2026-09-05:
//                  armsFloor=296  biting=296  defects=2  kinds=
//                    ["lane-blocked-stale","floor"]               (396.2 s)
//                  armsFloor=297  biting=296  defects=4  kinds=
//                    ["lane-blocked-stale","floor","floor","floor"] ->
//                    `ARMS_FLOOR regression: 296 biting arm(s) < floor 297`
//                    (beside the paired FILES_FLOOR regression, and beside the
//                     two rows present in BOTH directions)        (396.5 s)
//                So 296 is exactly the separation point, not a value below it.
//   RECORD       .planning/phases/164.4.1-pgcron-lane-put-pg-cron-on-the-
//                throwaway-pg-lane-and-retire/164.4.1-03-SUMMARY.md
//
// CURRENCY, stated where the VALUE is — derivation, sample size, coverage and
// separation in the block immediately above; record in 164.4.1-03-SUMMARY.md:
// RE-DERIVED 2026-09-05 by measurement (plan 164.4.1-03). Measured biting 296 —
// value RAISED from 272. ⚠️ Read the run's own `biting:` line, not this
// constant and not the `arms:` annotated field: they are no longer the same
// number. The next arms move is plan 04 of this phase.
//
// ⭐ RE-DERIVED 2026-09-05 (plan 164.4.1-04) — the THIRD file move of Phase
// 164.4.1 PGCRON-LANE. The blocks above STAY as lineage.
//
//   VALUE        324 — read off the run's own `biting:` line. ⭐ `arms:`
//                annotated, `biting:` and `lane-invocations:` are all 324
//                again: the divergence plan 03's block records was closed by
//                commit fcbc0159, which RECLASSIFIED the unfalsifiable
//                `3/JOB-05` rather than waiving it, and this batch adds no
//                waiver of its own.
//   DATE         2026-09-05, at HEAD fcbc0159 plus this plan's working tree.
//   COMMAND      `node scripts/mutation-runner/run.mjs` -> exit 1
//                  arms: 324/324/0   (executed/annotated/waived)
//                  biting: 324
//                  lane-invocations: 324
//   SAMPLE SIZE  324 arm lanes, all 324 `RED (identity ok)`; 43 baseline and 43
//                restore legs; the 43 per-file `biting` counts SUM to 324; the
//                two independent tallies (`arms:` executed and
//                `lane-invocations:`) AGREE.
//   COVERAGE     +28 sections over plan 03, all from
//                supabase/tests/test_strategy_analytics_stuck_computing_reaper.sql
//                — 5 in Part 1's structural body scan, 8 in Part 2's four
//                directional reap arms, 1 in Part 3's executed LIMIT bound, 4
//                across Part 4's stamp-transition chain, 2 in Part 5's failed
//                exit and 8 in Part 6's stamp-trigger sentinel.
//                ⚠️ SHAPES MET HERE, recorded because they constrain plan 05:
//                (a) FOUR twins are LAYERED because 20260803130000 self-verifies
//                the very body it deploys, and one more is layered because the
//                gate's own Part 1 anchor duplicates the migration's STEP 7;
//                (b) SIX twins mutate TWO migrations at once — the deployed cron
//                body or the bridge AND the stamp trigger — because those are
//                two INDEPENDENT defences of one invariant and a single-step
//                mutation is silently repaired by the other (MEASURED, and it is
//                the executable form of what the Part 4 header calls
//                defence-in-depth); (c) FIVE twins edit the GATE's own seeds and
//                drivers, which is grammar-legal and is the only honest falsifier
//                for an S-2 seed-integrity control — such an arm makes no claim
//                about production, so a production mutation cannot falsify it.
//                ⛔ EVERY Parts 2/3 body twin targets 20260803130000, the LAST
//                migration to call cron.schedule for this jobname; an edit to
//                20260802120000's or 20260803120000's cron body is OVERWRITTEN
//                and comes back `no-red`.
//                ⛔ AND ONE MEASURED BLIND SPOT, worth more than the count: a
//                `v_fn ~*` anchor reads pg_get_functiondef, which returns the
//                function's SOURCE INCLUDING COMMENTS. `1/re-base` came back
//                `no-red` on its first drive because 20260802120000:353 carries
//                the conjunct's name in a comment INSIDE the body. The twin now
//                rewrites that comment too; the residual weakness is booked in
//                the phase's deferred-items.md.
//   SEPARATION   Both directions driven through the real verdict loop on real
//                lanes, 2026-09-05:
//                  armsFloor=324  biting=324  defects=1  kinds=
//                    ["lane-blocked-stale"]                       (442.3 s)
//                  armsFloor=325  biting=324  defects=3  kinds=
//                    ["lane-blocked-stale","floor","floor"] ->
//                    `ARMS_FLOOR regression: 324 biting arm(s) < floor 325`
//                    (beside the paired FILES_FLOOR regression, and beside the
//                     tripwire row present in BOTH directions)    (441.3 s)
//                So 324 is exactly the separation point, not a value below it.
//   RECORD       .planning/phases/164.4.1-pgcron-lane-put-pg-cron-on-the-
//                throwaway-pg-lane-and-retire/164.4.1-04-SUMMARY.md
//
// CURRENCY, stated where the VALUE is — derivation, sample size, coverage and
// separation in the block immediately above; record in 164.4.1-04-SUMMARY.md:
// RE-DERIVED 2026-09-05 by measurement (plan 164.4.1-04). Measured biting 324 —
// value RAISED from 296. ⚠️ Read the run's own `biting:` line, not this
// constant. At THIS commit `arms:` annotated and `biting:` agree again, but that
// is a measurement of today's corpus and not an invariant. The next arms move is
// plan 05 of this phase, which takes the last `lane-blocked:` file.
//
// ⭐ RE-DERIVED 2026-09-05 (plan 164.4.1-05) — the FOURTH and LAST arms move of
// Phase 164.4.1 PGCRON-LANE, and the run that CLEARS the tripwire. The blocks
// above STAY as lineage.
//
//   VALUE        363 — read off the run's own `biting:` line, not counted here.
//                ⚠️ The plan PROJECTED 365. The measured number is 363, because
//                a projection is arithmetic over a reading of the file and the
//                floor is what the run printed. 324 + 39 = 363.
//   DATE         2026-09-05, at HEAD b3e13011.
//   COMMAND      `node scripts/mutation-runner/run.mjs` -> exit 0
//                  coverage: files 44/71
//                  lane-blocked: 0 file(s) …
//                  lane-probe: pg_cron AVAILABLE — lane-blocked class is STALE
//                    pending: 0 idiom file(s) without RED-UNDER —
//                  arms: 363/363/0   (executed/annotated/waived)
//                  biting: 363
//                  lane-invocations: 363
//                  per-arm lane time: mean 1.1s over 363 arm run(s)
//                  ✅ No defects. Every annotated arm bit its own arm first.
//   SAMPLE SIZE  363 arms executed, all 363 `RED (identity ok)`. The two
//                independent tallies AGREE. The 44 per-file `biting` counts SUM
//                to 363. NO defect of any kind — the `lane-blocked-stale` row
//                that every run since plan 01 carried is GONE, cleared by
//                annotating the last file rather than by touching the
//                classifier, the probe fixture or the defect's own gate.
//   COVERAGE     The 39 new arms are the whole of
//                supabase/tests/test_reconcile_dropped_enqueue_sweep.sql.
//                THIRTEEN of them are LAYERED: 20260819150000's own STEP 2
//                self-verify re-checks nearly every text anchor Part 1 makes,
//                so a single-step body mutation ABORTS THE APPLY instead of
//                reddening the arm — measured, per twin, at its site. FIVE are
//                falsified by GATE-FILE edits, each with the domination
//                measurement recorded beside it (three `IS NULL` oracle
//                preconditions Part 1 dominates, one seed-integrity control Part
//                2 dominates, and the whole-block invariant, whose value is the
//                sum of sixteen already-pinned per-arm counts).
//   SEPARATION   Both directions driven through the real verdict loop on real
//                lanes (`runCorpus({scopeDir:"supabase/tests", filesFloor,
//                armsFloor, log:()=>{}})`), 2026-09-05:
//                  armsFloor=363  biting=363  defects=0  SILENT   (486.4 s)
//                  armsFloor=364  biting=363  defects=2  kinds=
//                    ["floor","floor"] ->
//                    `ARMS_FLOOR regression: 363 biting arm(s) < floor 364`
//                    (beside the paired FILES_FLOOR regression) (490.4 s)
//                So 363 is exactly the separation point, not a value below it.
//   RECORD       .planning/phases/164.4.1-pgcron-lane-put-pg-cron-on-the-
//                throwaway-pg-lane-and-retire/164.4.1-05-SUMMARY.md
//
// CURRENCY, stated where the VALUE is — derivation, sample size, coverage and
// separation in the block immediately above; record in 164.4.1-05-SUMMARY.md:
// RE-DERIVED 2026-09-05 by measurement (plan 164.4.1-05). Measured biting 363 —
// value RAISED from 324. ⚠️ Read the run's own `biting:` line, not this
// constant. This is PHASE 164.4.1's END STATE: `lane-blocked:` and `pending:`
// are both measured 0, so there is no known idiom gate file left for the lane to
// reach. `WAIVED_CEILING` has not moved through any of the four arms moves of
// this phase, nor through the eleven of 164.4 — see its own block below.
//
// ⛔ RE-DERIVED 2026-09-05 — a LOWERING, and the first one this constant has
// ever taken. The block above STAYS as the dated record of the 363-arm corpus.
//
//   VALUE        361 — read off the run's own `biting:` line, not counted here.
//                ⚠️ It went DOWN by 2, and that is the POINT rather than a
//                regression to be worked around: review findings CR-01 and
//                CR-02 of 164.4.1-REVIEW.md established that three of the 363
//                arms in test_reconcile_dropped_enqueue_sweep.sql were being
//                falsified by mutations of THE GATE FILE'S OWN oracle lookup —
//                a mutation with no production preimage — rather than by
//                anything a migration could do.
//                  * `2/JOB-04` KEPT its identity and got a REAL production
//                    mutation instead (`DELETE FROM cron.job WHERE jobname =
//                    'reconcile_dropped_enqueue_sweep'` as a live-DB `sql`
//                    step, with 5 measured `1/JOB-04` neuters). Net 0.
//                  * `3/JOB-04` and `4/JOB-04` were RECLASSIFIED as named
//                    INVARIANTs — the same treatment `3/JOB-05`
//                    (test_retention_orphaned_running.sql, commit fcbc0159) and
//                    the reaper's Part 3 (commit 95197d28) already carry — after
//                    the domination was re-measured on a real lane by the fixer:
//                    with the Part 1 and Part 2 raises neutered and the job row
//                    deleted, the lane dies inside PART 2 on `22004: query
//                    string argument of EXECUTE is null`, naming no arm, so
//                    neither guard is reachable by any production mutation.
//                    Net -2. `WAIVED_CEILING` stays 0 — this is not a waiver.
//                A floor is a count of arms PROVEN to react to a production
//                regression. Holding it at 363 would have required keeping two
//                arms that provably do not, which is the ratchet buying a number
//                with evidence it does not have.
//   DATE         2026-09-05, on the 164.4.1 review-fix branch.
//   COMMAND      `node scripts/mutation-runner/run.mjs` -> exit 0
//                  coverage: files 44/71
//                  lane-blocked: 0 file(s) …
//                  lane-probe: pg_cron AVAILABLE — lane-blocked class is empty, as a hosting lane requires
//                    pending: 0 idiom file(s) without RED-UNDER —
//                  arms: 361/361/0   (executed/annotated/waived)
//                  biting: 361
//                  lane-invocations: 361
//                  per-arm lane time: mean 1.1s over 361 arm run(s)
//                  ✅ No defects. Every annotated arm bit its own arm first.
//   SAMPLE SIZE  361 arms executed, all 361 `RED (identity ok)`. The two
//                independent tallies AGREE: `arms:` executed 361 and
//                `lane-invocations:` 361, beside 44 baseline and 44 restore
//                legs. The 44 per-file `biting` counts SUM to 361; the only row
//                that moved is test_reconcile_dropped_enqueue_sweep.sql,
//                39 -> 37.
//   SEPARATION   Measured in BOTH directions on real lanes, same tree:
//                  ARMS_FLOOR=363 (a stale value)  -> 1 defect ->
//                    `ARMS_FLOOR regression: 361 biting arm(s) < floor 363`
//                  ARMS_FLOOR=362 (one higher)      -> 1 defect ->
//                    `ARMS_FLOOR regression: 361 biting arm(s) < floor 362`
//                  ARMS_FLOOR=361                   -> 0 defects, EXIT 0
//                ⚠️ DATED: the three lines above are the 2026-09-05 separation
//                probe at 361 arms, kept as the record that the floor was proven
//                to bite in both directions. They are NOT the live value. Phase
//                164.2 raised the corpus to 369 (one new gate file, eight twins)
//                and re-separated it on real lanes: 46/370 -> two regressions,
//                exit 1; 45/369 -> exit 0. ⛔ Read FILES_FLOOR and ARMS_FLOOR off
//                the constants themselves, never off this comment.
//                So 361 WAS exactly the separation point on 2026-09-05 — past
//                tense deliberately: the ⚠️ DATED note above supersedes it, and
//                the live value is the `export const ARMS_FLOOR` below.
//   RECORD       164.4.1-REVIEW.md findings CR-01 and CR-02, and the measured
//                refutation recorded at each arm's own site in
//                supabase/tests/test_reconcile_dropped_enqueue_sweep.sql.
//
// ⭐ RE-DERIVED 2026-09-06 BY MEASUREMENT (phase 164.2, plan 07). Value RAISED
// from 361 to 369 — EIGHT new arms, all in the one new gate file
// supabase/tests/test_sync_status_curated_sentence_survives.sql. Their MACHINE
// identities — the strings a reader greps for as `"arm":"…"` — are 0, S1, C1,
// O1, D1, P1, PC1 and R1; every one but `0` carries a trailing DIGIT on purpose
// (see that file's ⭐ WHY EVERY IDENTITY CARRIES A DIGIT block), so grepping
// `"arm":"S"` finds nothing. No existing arm moved: the three gates coupled to
// 20260906120000 in this plan gained a migration in their RED-UNDER-SETUP apply
// lists and nothing else, and their twins (0a; 1/A-3, 2/A-3, 3/F-3; the 24 of
// test_retention_orphaned_running.sql) were re-observed biting AFTER the
// coupling. The blocks above stay as dated lineage.
//   SAMPLE SIZE  369 arms executed, all 369 `RED (identity ok)`. The two
//                independent tallies AGREE: `arms:` executed 369 and
//                `lane-invocations:` 369, beside 45 baseline and 45 restore
//                legs. The 45 per-file `biting` counts SUM to 369.
//   SEPARATION   Measured on a real full-corpus lane run, same tree, in the
//                same probe that separated FILES_FLOOR above:
//                  ARMS_FLOOR=370 (one higher) -> defect ->
//                    `ARMS_FLOOR regression: 369 biting arm(s) < floor 370`
//                  ARMS_FLOOR=369 (this value) -> 0 defects, EXIT 0
//                So 369 is exactly the separation point, not a value below it.
//   RECORD       .planning/phases/164.2-curated-copy-the-curated-computation-
//                error-sentence-must-act/164.2-07-SUMMARY.md
//
// ⭐ RE-DERIVED 2026-09-07 BY MEASUREMENT (phase 164.7, plan 05). Value RAISED
// from 369 to 380 — ELEVEN new arms, from TWO sources rather than one, which is
// why this move is not a single-file backfill like the last three:
//   * SEVEN in the one new annotated file,
//     supabase/tests/test_analytics_service_settings_and_vault_tick.sql
//     (plan 02). Machine identities: 0, V1, U1, C1, R1, R2, R3 — V1 and U1 ask
//     the callable for each of its two RAISEs BY NAME, C1 is the discriminator
//     that refuses a function whose whole body is one unconditional RAISE
//     (which would pass V1 and U1 and post nothing forever — the CRON-DRIFT-01
//     outage with the sign reversed), and R1/R2/R3 are the anon read, the
//     non-admin write and the anon grant-layer hardening.
//   * FOUR in the two EXISTING ledger gate files (plan 04): arms K and L in
//     each of test_ledger_refresh_fanout.sql and
//     test_ledger_refresh_composite_arm.sql. With the existing arm A they pin
//     the whole fail-closed truth table of the switch 20260907130000 deploys:
//     row MISSING, row FALSE, read RAISES — each returns 0, each under a twin
//     that reddens it and only it.
// ⚠️ WHAT DID NOT MOVE, AND WHY IT COULD HAVE. Plan 04 RE-POINTED all 27
// pre-existing edit-kind twins in those two gates at the superseding migration
// 20260907130000_ledger_refresh_switch_to_system_flags.sql, leaving the 2
// staleness-view steps byte-identical; ten needed `nth` because that migration
// CREATE OR REPLACEs BOTH bodies. Had the re-point not happened in the SAME
// commit as the apply-list extension, those twins would have gone on mutating a
// body the new migration overwrites — `no-red` on up to 27 arms, absorbable by
// nothing, because WAIVED_CEILING is 0. Every one was re-observed biting AFTER
// the re-point, which is why this floor moves by exactly +11 and not by less.
//   DATE         2026-09-07, same tree and same probe as the FILES_FLOOR block.
//   SAMPLE SIZE  380 arms executed, all 380 `RED (identity ok)`. The two
//                independent tallies AGREE: `arms:` executed 380 and
//                `lane-invocations:` 380, beside 46 baseline and 46 restore
//                legs — 472 legs, 614 s wall clock on the authoring macOS box.
//                The 46 per-file `biting` counts SUM to 380. WAIVED_CEILING is
//                untouched at 0: eleven arms added, twenty-seven re-pointed,
//                zero waivers.
//   ⚠️ WALL CLOCK  531 s / 528 s / 614 s / 514 s across FOUR runs, and the third
//                is the outlier for a known reason: a busy-wait loop the
//                executor used to block on it burned a core beside it, which
//                that run itself reports as `per-arm lane time: mean 1.3s`
//                against 1.1s in the other three. Read the three 1.1s runs as
//                this corpus's figure. The FOURTH is the one that matters for
//                the claim "the full corpus exits 0 at this plan's final
//                commit": it is SHA-BOUND to df45db38 on a CLEAN tree, exit 0,
//                514 s. NONE of these is an ubuntu number — see the
//                timeout-minutes derivation in ci.yml, which is unchanged at 20
//                (its one permitted raise was taken on 2026-09-05 and 20 is a
//                declared CEILING).
//   SEPARATION   Measured on real full-corpus lane runs, same tree, in the same
//                probe that separated FILES_FLOOR above:
//                  ARMS_FLOOR=381 (one higher) -> defect ->
//                    `ARMS_FLOOR regression: 380 biting arm(s) < floor 381`
//                  ARMS_FLOOR=380 (that value)  -> 0 defects, EXIT 0
//                ⚠️ CURRENCY 2026-09-07 (SQL-fixer pass): 380 -> 384. The fixer
//                grew test_analytics_service_settings_and_vault_tick.sql from 7
//                arms to 11 (C3, R3, T1 and the U2 constraint arm), so the
//                corpus bites 384. RE-SEPARATED on real full-corpus lane runs:
//                  ARMS_FLOOR=385 (one higher) -> defect ->
//                    `ARMS_FLOOR regression: 384 biting arm(s) < floor 385`
//                  ARMS_FLOOR=384 (this value) -> 0 defects, EXIT 0
//                So 384 is exactly the separation point, not a value below it.
//                The STALE direction is NOT this runner's to report — see the
//                ⛔ block above FILES_FLOOR. At 369 on this tree the run exits
//                0, and it is src/__tests__/mutation-runner-floors.test.ts that
//                fails, with `The corpus declares 380 twin(s) of which 0 are
//                waivers, so a green run bites 380. ARMS_FLOOR is 369.`
//   RECORD       .planning/phases/164.7-appsettings-every-app-guc-reader-moves-
//                to-a-mechanism-this-p/164.7-05-SUMMARY.md, beside
//                164.7-05-FLOORS.log, which carries all three runs with their
//                exit codes, wall clocks and printed lines.
// ⭐ RE-DERIVED 2026-09-11 BY MEASUREMENT (phase 164.8.6 VAULTTICKFIX, plan 05).
// Value RAISED from 384 to 392 — EIGHT new arms, from THREE gate files rather
// than one, every one a RED-UNDER-M twin of one of the phase's two NEW FORWARD
// migrations (neither phase edits an applied migration; see each file's ⛔ IT IS
// A FORWARD MIGRATION header):
//   * TWO in supabase/tests/test_analytics_service_settings_and_vault_tick.sql
//     against 20260911120000_vault_tick_hardening.sql (plan 01). Machine
//     identities V2 and G1. V2 is the WHITESPACE key: it plants a single-space
//     secret and asks the callable to still RAISE `analytics_service_key missing
//     from vault` — the hole VAULTTICK-EMPTYKEY-01 names, which a `v_key IS
//     NULL` guard alone sails straight past into net.http_post. G1 hands
//     service_role EXECUTE back to the tick callable and asks the whole-grantee
//     -set assertion to refuse it (164.7-WR02-SERVICE-ROLE-EXECUTE).
//   * THREE in EACH of supabase/tests/test_ledger_refresh_fanout.sql and
//     supabase/tests/test_ledger_refresh_composite_arm.sql against
//     20260911130000_ledger_fanout_grantees_and_dormancy.sql (plan 03).
//     Identities S1, M1, M2 in both files. S1 is the `sql`-step GRANT twin that
//     proves a whole-grantee-set check bites on a lane where the migration's own
//     REVOKE is a no-op. M1/M2 are the dormancy instrument pair: with the flag
//     row ABSENT (M1) or INVISIBLE (M2) the fan-out must post ONE counted
//     cron_runs row naming the cause, which is what turns the silent dormancy of
//     164.7-DORMANCY-UNINSTRUMENTED into something a query can see.
// ⚠️ WHAT DID NOT MOVE, AND WHY IT COULD HAVE. Plan 03 RE-POINTED all 30
// pre-existing edit-kind twins in the two ledger gates at the superseding
// migration 20260911130000 IN THE SAME COMMIT as the apply-list extension (13 ->
// 15 entries in the fan-out gate, 12 -> 14 in the composite gate), and every one
// was re-observed biting AFTER the re-point — both gates 20/20/0. Split across
// two commits, up to 30 arms would have gone `no-red` against a body the new
// migration overwrites, and WAIVED_CEILING = 0 can absorb exactly none of them.
// That is why this floor moves by exactly +8 and not by less.
// ⚠️ FILES_FLOOR DOES NOT MOVE. All eight new arms land in gate files that were
// already annotated, so the corpus stays 46/73 — see the run's own
// `coverage: files 46/73`. FILES_FLOOR stays 46 and WAIVED_CEILING stays 0:
// eight arms added, thirty re-pointed, ZERO waivers.
//   DATE         2026-09-11, on a CLEAN tree at the phase's final SQL bytes.
//   SAMPLE SIZE  392 arms executed, all 392 `RED (identity ok)`. The two
//                independent tallies AGREE: `arms: 392/392/0` and
//                `lane-invocations: 392`, beside 46 baseline / 46 restore legs.
//                `lane-blocked: 0 file(s)` with `lane-probe: pg_cron AVAILABLE`
//                — the pairing the lane-blocked-stale tripwire requires.
//   SEPARATION   Measured in BOTH directions on REAL full-corpus lane runs:
//                  ARMS_FLOOR=393 (one higher) -> exit 1, EXACTLY one defect ->
//                    `ARMS_FLOOR regression: 392 biting arm(s) < floor 393`
//                  ARMS_FLOOR=392 (this value) -> 0 defects, EXIT 0
//                So 392 is exactly the separation point, not a value below it.
//                The STALE direction is NOT this runner's to report — see the
//                ⛔ block above FILES_FLOOR. At 384 on this tree the run exits
//                0, and it is src/__tests__/mutation-runner-floors.test.ts that
//                fails, with `The corpus declares 392 twin(s) of which 0 are
//                waivers, so a green run bites 392. ARMS_FLOOR is 384.`
//                ⚠️ That same stale-384 run surfaced a THIRD pin no plan named:
//                mutation-runner-floors.test.ts's `totalAnchored` prose-anchor
//                count, also 384, invisible to BOTH layers (the runner gates
//                biting arms; the ratchet pins twins - waivers). It is re-pinned
//                to 392 in the same commit, with its own dated block.
//   ⚠️ WALL CLOCK  546.3 / 547.4 / 537.8 / 542.6 / 539.2 s across the FIVE runs
//                of record on the authoring macOS box — mean per-arm lane time
//                1.1 s in every one, unchanged from 164.7's corpus, which is
//                what says the spread is noise and not a corpus that got
//                slower. FIVE and not three because TWO runs were re-taken:
//                RUN 2 tripped the runner's own clean-tree assertion when this
//                executor wrote a CURRENCY block mid-run, and RUN 3 tripped it
//                when a CONCURRENT SESSION committed two .planning/ docs
//                commits onto this branch mid-run (48b91f34 -> a0867c41). Both
//                are kept in the log rather than deleted, and both are re-taken
//                clean as RUN 2b and RUN 3b. ⛔ A mutation run asserts the
//                working tree is unchanged across its own execution, so ANY
//                concurrent writer — even one that never touches a line of SQL
//                — costs a full nine minutes of lane time. Hold the tree still.
//                ⛔ NONE of these is an ubuntu number.
//                CEILING CHECK: 392 arms x 1.1 s = 431 s of lane time, and the
//                slowest full run of record is 546 s = 9.1 min against the
//                DECLARED CEILING of `timeout-minutes: 20` on the `sql-mutation`
//                job (.github/workflows/ci.yml — cite BY SYMBOL: the
//                `sql-mutation:` job key and its own `timeout-minutes:` entry,
//                measured 2026-09-11 at :1196 and :1386 respectively; CLAUDE.md
//                and 164.8.6-RESEARCH.md §Q6 both still say :1259 / :1069, stale
//                by measurement — the [164.7-CITATION-DRIFT-01] class). Roughly
//                2.2x headroom remains. ⛔ The ceiling is NEVER raised: its one
//                permitted raise was taken on 2026-09-05. A future crossing is
//                answered by [REDUNDER-SUBSET-SPLIT].
//   RECORD       .planning/phases/164.8.6-vaulttickfix-the-forward-migration-
//                phase-164-7-earned/164.8.6-05-SUMMARY.md, beside
//                164.8.6-05-FLOORS.log, which carries all FIVE runs with their
//                exit codes, wall clocks and printed lines: RUN 1 the
//                measurement at the stale floor 384 (exit 0); RUN 2 the upper
//                separation, contaminated-and-kept (exit 1, two defects); RUN 2b
//                the clean upper separation (exit 1, EXACTLY one defect, the
//                regression line above); RUN 3 the pin, contaminated by a
//                concurrent session and kept (exit 1, zero arm defects); RUN 3b
//                the pin, clean (exit 0, `✅ No defects`).
//                ⚠️ SHA NOTE: runs 1, 2 and 2b were measured at 48b91f34 and
//                runs 3 / 3b at a0867c41. The two intervening commits touch
//                .planning/ROADMAP.md, one .gitkeep and TODOS.md and NOTHING
//                else — `git diff --stat 48b91f34..a0867c41 -- supabase/
//                scripts/ src/` is EMPTY — so the corpus and this runner are
//                byte-identical across the move and the 392 is one measurement,
//                not two that happen to agree.
//   ⚠️ CURRENCY 2026-09-17 (phase 164.5.1.1 FANOUTCOHORT, plan 01): 392 -> 393.
//                ONE new arm — arm P in test_ledger_refresh_fanout.sql, which
//                proves that a stale, otherwise-eligible strategy carrying the
//                owner-only terminal lifecycle status IS enqueued by the
//                single-key ledger fan-out. It lands in a file this corpus
//                already annotates, so FILES_FLOOR does NOT move and
//                `coverage: files 46/73` is unchanged.
//                MEASURED on a clean-tree full-corpus lane run at this plan's
//                final SQL bytes, and READ OFF THE RUNNER'S OWN OUTPUT rather
//                than derived: `arms: 393/393/0`, `biting: 393`,
//                `lane-invocations: 393` (the two independent tallies AGREE),
//                `lane-blocked: 0 file(s)`, `lane-probe: pg_cron AVAILABLE`,
//                `pending: 0`, `✅ No defects`, exit 0.
//                ⛔ NOT DERIVED BY GREP, and the difference is not academic: a
//                naive `grep -c "RED-UNDER-M:" supabase/tests/*.sql` sums to
//                404 at these bytes while the runner's biting count is 393.
//                They are different questions — the grep counts annotation
//                LINES anywhere in the corpus, including the unreachable class
//                and this file's own prose; `biting` counts arms that EXECUTED
//                and reddened THEMSELVES first. Read the runner.
//   ⚠️ CURRENCY 2026-09-17 (phase 164.5.1.1 FANOUTCOHORT, plan 02): 393 -> 394.
//                ONE new arm — arm Q in test_ledger_refresh_fanout.sql, the
//                COHORT-AGREEMENT arm: it derives the lifecycle DOMAIN from
//                `pg_get_constraintdef('strategies_status_check')` and the
//                ADMITTED set from a comment-stripped `pg_get_functiondef` of
//                the deployed fan-out, and refuses any status the catalogue
//                admits that the fan-out does not name and that is not one of
//                the two deliberate exclusions. It lands in the same
//                already-annotated file as arm P, so FILES_FLOOR does NOT move
//                and `coverage: files 46/73` is unchanged.
//                MEASURED on a full-corpus lane run at this plan's final SQL
//                bytes, and READ OFF THE RUNNER'S OWN OUTPUT rather than
//                derived: `arms: 394/394/0`, `biting: 394`,
//                `lane-invocations: 394` (the two independent tallies AGREE),
//                `lane-blocked: 0 file(s)`, `lane-probe: pg_cron AVAILABLE`,
//                `pending: 0`, `✅ No defects`, exit 0, and the per-file row
//                `test_ledger_refresh_fanout.sql: sections 22 / judged 22 /
//                annotated 22 / waived 0 / biting 22`.
//                ⛔ THE GREP GAP WIDENED AGAIN, which is the point of saying so
//                every time: the naive `grep -c "RED-UNDER-M:"` sum is 405 at
//                these bytes against a biting count of 394. It has never once
//                equalled the biting count and must never be used to derive
//                this constant.
//   ⚠️ CURRENCY 2026-09-18 (Phase 164.1.1 PROBERCADENCE, plan 01): 395 -> 397.
//                TWO new arms in a NEW file, supabase/tests/test_prod_prober_cadence.sql —
//                arm G (invert the staleness comparison so a fresh contact
//                reads as stale) and arm S (widen the ceiling so a stale
//                contact reads as fresh), each a single `edit` step against
//                20260918120000_prod_prober_cadence.sql. FILES_FLOOR moves
//                too (46 -> 47, see that constant's own CURRENCY note), unlike
//                most prior moves on this list which only added arms to an
//                already-annotated file.
//                MEASURED on a clean-tree full-corpus lane run, READ OFF THE
//                RUNNER'S OWN OUTPUT: `coverage: files 47/74`,
//                `arms: 397/397/0`, `biting: 397`, `lane-invocations: 397`
//                (the two independent tallies AGREE), `lane-blocked: 0
//                file(s)`, `lane-probe: pg_cron AVAILABLE`, `pending: 0`,
//                `✅ No defects`, exit 0, mean 2.0s/arm, and the per-file row
//                `test_prod_prober_cadence.sql: sections 3 / judged 2 /
//                annotated 2 / waived 0 / biting 2` (section 3 is the SETUP
//                block, correctly unjudged — SETUP guards are deliberately
//                not separately twinned, per this file's own header).
//                SEPARATED in both directions on
//                `src/__tests__/mutation-runner-floors.test.ts`'s fast
//                re-derivation (no lane needed): ARMS_FLOOR=398 gives `The
//                corpus declares 397 twin(s) of which 0 are waivers … ARMS_FLOOR
//                is 398` and FAILS; ARMS_FLOOR=395 (the stale-low direction,
//                i.e. this constant's PRE-EDIT value) gives the same message
//                naming 395 and FAILS; ARMS_FLOOR=397 PASSES. WAIVED_CEILING
//                stays 0 (0 waivers, corpus-wide).
// ⚠️ CURRENCY 2026-09-18 (Phase 164.1.1 PROBERCADENCE, plan 02): 397 -> 402.
//                FIVE new arms in the SAME file plan 01 added,
//                supabase/tests/test_prod_prober_cadence.sql — O1 (the
//                observer's own self-observability row, both branches), A1 (an
//                ABSENT prod_prober contact read as stale, never healthy), N1
//                (the contact read narrowed to ONE producer, never a second
//                real one), U1 (the destination's second layer, the CHECK
//                constraint dropped inside the arm's own transaction) and V1
//                (a missing Vault key producing a refusal, never a
//                null-valued header). FILES_FLOOR does NOT move — no new file,
//                `coverage: files 47/74` unchanged from plan 01.
//                MEASURED on a clean-tree full-corpus lane run, READ OFF THE
//                RUNNER'S OWN OUTPUT: `coverage: files 47/74`,
//                `arms: 402/402/0`, `biting: 402`, `lane-invocations: 402`
//                (the two independent tallies AGREE), `lane-blocked: 0
//                file(s)`, `lane-probe: pg_cron AVAILABLE`, `pending: 0`,
//                `✅ No defects`, exit 0, mean 2.0s/arm, and the per-file row
//                `test_prod_prober_cadence.sql: sections 7 / judged 7 /
//                annotated 7 / waived 0 / biting 7`.
//                SEPARATED in both directions on TWO REAL full-corpus lane
//                runs (not the fast vitest re-derivation this time — the plan
//                asked for the runner's own message by name): ARMS_FLOOR=403
//                gives `ARMS_FLOOR regression: 402 biting arm(s) < floor 403`
//                and exit 1 with EXACTLY that one defect; ARMS_FLOOR=402 (this
//                value) gives `✅ No defects` and exit 0, with
//                arms/biting/lane-invocations all reading 402. WAIVED_CEILING
//                stays 0 (0 waivers, corpus-wide).
// ⚠️ CURRENCY 2026-09-19 (Phase 164.5.1.4 SYNCCURSOR, review WR-05 +
//                round 2): 402 -> 412. TEN new arms, all in ONE NEW annotated
//                gate, supabase/tests/test_strategy_sync_cursors_rls.sql --
//                SEED 1 (the cursor row the other arms observe), GRANT 1 (the
//                migration's REVOKE deleted), RLS 1 and RLS 2 (the only two
//                `sql`-step arms: `DISABLE ROW LEVEL SECURITY` on the lane, and
//                the deny-all policy re-created `FOR SELECT` instead of
//                `FOR ALL`), POLICY 1-4 (the SAME deny-all qualifier opened from
//                four different observation points -- `USING (false)` ->
//                `USING (true)` for 1-3 and `WITH CHECK (false)` ->
//                `WITH CHECK (true)` for 4), POLICY 4 PRECONDITION (the positive
//                control proving POLICY 4 observes the POLICY and not a missing
//                GRANT) and RESTORE 1 (the gate's own trailing REVOKE deleted).
//                FILES_FLOOR DOES move with it, 47 -> 48, and the denominator
//                74 -> 75 -- see the block above. That is the difference from the
//                2026-09-18 plan-02 entry directly above, which added arms to a
//                file already in the set.
//                ⛔ THIS ENTRY SHIPPED INVERTED AND THE CORRECTION IS THE POINT.
//                It was written at 9 arms / 411 by `41e45047`, and `4919f892`
//                then added the POLICY 4 precondition arm and bumped 411 -> 412
//                WITHOUT touching this comment. The result asserted that
//                ARMS_FLOOR=412 FAILS and 411 PASSES -- the exact inverse of the
//                shipped constant -- so a reader trusting it would have LOWERED
//                the floor to 411. Lowering a floor is the one move this repo's
//                C6 rule forbids outright, and the prose beside the constant was
//                pointing at it. `[164.7-CITATION-DRIFT-01]`, recurring inside
//                the ratchet file itself.
//                ⛔ SO: NO CENSUS IS RESTATED HERE ANY MORE. A twin count, an
//                apply-step count and a needle count are RUN OUTPUTS that move
//                whenever any gate changes, and a number written beside the
//                constant it describes has now drifted from it twice. Re-derive
//                instead -- `src/__tests__/mutation-runner-floors.test.ts` prints
//                the corpus census on every run, and its failure text names the
//                value to raise the floor TO. The constant below is the only
//                authority in this file.
//                ⚠️ SEPARATION was taken on that fast vitest re-derivation,
//                NOT on a full-corpus lane run, which is a weaker reading than
//                the entry above it. The arms were calibrated ON A LANE by the
//                plan that added the file (restore leg exit 0); this edit
//                absorbs that measurement into the ratchet rather than re-taking
//                it. WAIVED_CEILING stays 0.
// ⚠️ CURRENCY 2026-09-20 (same phase, round 3): 412 -> 413. ONE further arm in
//                the same gate file: arm "0", the applied-ness gate. The gate
//                briefly shipped a `RAISE NOTICE 'SKIP:'; RETURN;` there, CI's
//                anti-skip arm refused it, and the revert to the house form
//                (RAISE EXCEPTION on the absent object) created a new SECTION
//                that mutation-annotation-parser.test.ts correctly flagged as
//                carrying no twin — an assertion never proven able to fail.
//                The twin is a `sql` DROP step, not a migration edit, because
//                the migration's own self-verify would abort on a renamed
//                CREATE and the gate would never run. Re-derived over the
//                corpus: 413 twins across 48 annotated files of 75, 0 waivers.
// ⭐ CURRENCY 2026-09-21 (Phase 164.9 plan 04, FANOUT-GLOBAL-01 closure): 413
//                -> 416. THREE new arms, each a foreign-row calibration in a
//                gate that already annotates -- FILES_FLOOR does not move.
//                `7/FANOUT-GLOBAL-01` in
//                supabase/tests/test_strategy_analytics_stuck_computing_reaper.sql
//                (narrows the reap arm's LIMIT-25 budget to 2, neutering Part
//                3's `3/arm E/JOB-02` four times); `4/FANOUT-GLOBAL-01` in
//                supabase/tests/test_retention_orphaned_running.sql (narrows
//                arm A's LIMIT-100 budget to 2, neutering Part 1's
//                `1/JOB-05/D-19` three times and Part 3's `3/JOB-05/D-19`
//                four times); `5/FANOUT-GLOBAL-01` in
//                supabase/tests/test_reconcile_dropped_enqueue_sweep.sql
//                (narrows the sweep's LIMIT-25 budget to 4 -- not 2, because
//                this file's own Part 2 seeds four simultaneously
//                heal-eligible tied candidates that a budget below 4 would
//                crowd nondeterministically -- neutering Part 1's
//                `1/JOB-04/D-08` once and Part 4's `4/JOB-04/D-08` four
//                times, plus re-basing the migration's own STEP 2 self-verify
//                so the apply itself does not abort first).
//                `supabase/tests/test_prod_prober_cadence.sql` is
//                DELIBERATELY untouched: it asserts about the cron schedule
//                itself, a global singleton, never multi-tenant data, so
//                per-run isolation is a category error there.
//                MEASURED on real pg-lane runs, each arm in isolation
//                (`--file <gate> --arm <arm>`): all three score
//                `RED (identity ok)`, exit 2, `No defects in the narrowed
//                scope.` Full-file re-runs (no `--arm` filter) on all three
//                gates: `arms: 29/29/0` (reaper, was 28/28/0),
//                `arms: 25/25/0` (retention, was 24/24/0),
//                `arms: 38/38/0` (reconcile, was 37/37/0) -- 0 defects each.
//                WAIVED_CEILING stays 0 (0 waivers, this move).
// ⭐ CURRENCY 2026-09-21 (Phase 164.9 plan 04, fix round -- section-coverage
//                gate found six sections with no twin): 416 -> 422. SIX new
//                arms, one per uncovered `TEST FAILED (...)` identity, all in
//                already-annotated files -- FILES_FLOOR does not move.
//                `7/FANOUT-GLOBAL-01/own-1` (reaper) and
//                `4/FANOUT-GLOBAL-01/own-1` (retention): reverse the deployed
//                sweep's ORDER BY from ASC to DESC at the same narrowed
//                budget, which excludes the most-dominant own row instead of
//                the least-dominant one. `7/FANOUT-GLOBAL-01/foreign`
//                (reaper) and `4/FANOUT-GLOBAL-01/foreign` (retention):
//                narrow the budget to 1 (ASC unchanged), excluding the
//                foreign row alongside the least-dominant own row, neutering
//                the less-dominant-own identity that would otherwise fire
//                first. `5/FANOUT-GLOBAL-01/own` and
//                `5/FANOUT-GLOBAL-01/foreign` (reconcile): the foreign row
//                there is sandwiched between two own ranks at EVERY LIMIT/
//                direction pair a budget >= 4 allows (budget < 4 is unsafe --
//                Part 2's own four simultaneously-tied candidates need it,
//                MEASURED: a first attempt at LIMIT 3 produced
//                WRONG-ARM(2/arm C5b/...), an unrelated Part-2 tie loser). A
//                sixth own row (a pure rank-shifter, no assertion of its own)
//                was added so the SAME LIMIT-4 mutation the base arm already
//                uses excludes the foreign row too, differentiated from the
//                base arm only by which identity is neutered.
//                MEASURED on real pg-lane runs, each arm in isolation
//                (`--file <gate> --arm <arm>`): all six score
//                `RED (identity ok)`, exit 2, `No defects in the narrowed
//                scope.` (the reconcile pair re-run twice each to confirm no
//                flakiness against Part 2's own nondeterminism). Full-file
//                re-runs (no `--arm` filter): `arms: 31/31/0` (reaper, was
//                29/29/0), `arms: 27/27/0` (retention, was 25/25/0),
//                `arms: 40/40/0` (reconcile, was 38/38/0, re-run twice) -- 0
//                defects each. WAIVED_CEILING stays 0 (0 waivers, this move).
// ⚠️ CURRENCY 2026-09-21 (phase 164.9 TESTISOLATION, plan 10): 422 -> 423. ONE
//    new arm, D1, in the EXISTING annotated file
//    supabase/tests/test_analytics_service_settings_and_vault_tick.sql — a
//    second transaction that reads the LIVE analytics destination row where the
//    database-identity marker names TEST, and measures the allow-list constraint
//    where no marker exists. So ARMS moves and FILES does not: FILES_FLOOR stays
//    48 (the file was already annotated) and WAIVED_CEILING stays 0.
//    ⚠️ Its twin is deliberately a NARROWING of the allow-list and NOT a
//    `DROP CONSTRAINT`: the drop is arm U2's twin, U2 runs FIRST in the same
//    file, and two arms cannot share one mutation because only one of them can
//    be the FIRST failure.
//
// ⭐ RE-DERIVED 2026-09-22 (Phase 167 CREDTRUST, plan 03 Task 2): 423 -> 425.
//    TWO new arms in the NEW file
//    supabase/tests/test_api_keys_sync_status_sign_in_failed.sql: arm 1
//    (revert the widened api_keys_sync_status_check to the pre-migration
//    8-value list) and arm 2 (re-type the CHECK from a stale list that lost
//    the prior value 'revoked' while still admitting 'sign_in_failed' — the
//    exact DROP+ADD-re-types-a-stale-list hazard the migration itself is
//    written to guard against). Both files AND arms move together here — the
//    file is new, not an addition to an existing one. See the FILES_FLOOR
//    block above for the full run's headline numbers (`coverage: files
//    49/76`, `arms: 425/425/0`, `biting: 425`, `lane-invocations: 425`,
//    exit 0); this entry adds only the per-file `sections 2 / judged 2 /
//    annotated 2 / waived 0 / biting 2` line and the arm-level attribution.
//
// ⭐ RE-DERIVED 2026-09-22 (Phase 167 CREDTRUST, plan 03 review fix): 425 ->
//    426. ONE new arm, 3, in the now-EXISTING annotated file
//    supabase/tests/test_api_keys_sync_status_sign_in_failed.sql. It carries
//    the mutation that the file's pre-fix SUBSTRING probe passed clean: re-type
//    the CHECK dropping 'complete' while KEEPING 'complete_with_warnings', so
//    the shorter value is lost and a bare `position('complete' …)` still finds
//    it inside the longer one. The gate's "no prior value was lost" claim was
//    blind to exactly that, and this arm is what keeps the repaired idiom
//    honest.
//    ⚠️ Arm 3 gets its OWN check (c) and its OWN `TEST FAILED (3)` identity
//    rather than riding on (2): the runner scores an arm by the FIRST
//    `TEST FAILED (…)` in the lane output, so an arm whose mutation reddened
//    (2) could never be told apart from arm 2 itself.
//    So ARMS moves and FILES does not: FILES_FLOOR stays 49 (the file was
//    already annotated by the time this arm landed) and WAIVED_CEILING stays 0.
//    MEASURED via a full lane run, `node scripts/mutation-runner/run.mjs`:
//    `coverage: files 49/76`, `arms: 426/426/0`, `biting: 426`,
//    `lane-invocations: 426` (the two independent tallies AGREE),
//    `lane-blocked: 0 file(s)`, `lane-probe: pg_cron AVAILABLE`,
//    `unreachable: 27 file(s)`, `pending: 0`,
//    `✅ No defects. Every annotated arm bit its own arm first.`, exit 0.
//    Per-file line: `test_api_keys_sync_status_sign_in_failed.sql: sections 3 /
//    judged 3 / annotated 3 / waived 0 / biting 3`. Arm 3 itself scored
//    `RED (identity ok)` — not NO-IDENTITY, so its `TEST FAILED (3)` marker is
//    the shape the runner reads.
//
// ⭐ RE-DERIVED 2026-09-24 (Phase 164.6 GATE-HYGIENE, plans 03/04, OPS-08-F2):
//    426 -> 428. TWO new arms, both named N, one in each of the
//    already-annotated supabase/tests/test_ledger_refresh_fanout.sql and
//    supabase/tests/test_ledger_refresh_composite_arm.sql: one poisoned
//    candidate beside a healthy one, proving each fan-out counts and names a
//    failed enqueue in one cron_runs row. Each twin neuters the failure count
//    (`v_failed := v_failed + 1;` -> `+ 0;`) in migration 20260924120000.
//    So ARMS moves and FILES does not: FILES_FLOOR stays 49 (both files were
//    already annotated) and WAIVED_CEILING stays 0.
//    MEASURED via a full lane run, `node scripts/mutation-runner/run.mjs`:
//    `scope: FULL 49/49 annotated files`, `coverage: files 49/76`,
//    `arms: 428/428/0`, `biting: 428`, `lane-invocations: 428` (the two
//    independent tallies AGREE), `lane-blocked: 0 file(s)`,
//    `lane-probe: pg_cron AVAILABLE`, `unreachable: 27 file(s)`, `pending: 0`.
//    Per-file lines: `test_ledger_refresh_composite_arm.sql: sections 21 /
//    judged 21 / annotated 21 / waived 0 / biting 21` and
//    `test_ledger_refresh_fanout.sql: sections 24 / judged 24 / annotated 24 /
//    waived 0 / biting 24`. Both arms N scored `RED (identity ok)`.
//    That run was taken with this constant ALREADY at 428, so it also shows the
//    floor holding at the measured value: `✅ No defects. Every annotated arm
//    bit its own arm first.`, exit 0.
//
// ⭐ RE-DERIVED 2026-09-24 (Phase 164.6 GATE-HYGIENE, review fix round 1):
//    428 -> 445, SEVENTEEN new arms. Seven in EACH ledger gate against the
//    in-place-edited migration 20260924120000 — N2 (precision), T (the
//    failed-attempt cooldown), N3 (boundary), U (the all-candidates-failed
//    raise), V1 and V2 (a failure row whose own write fails) and W (a lost
//    enqueue race is not a failure): test_ledger_refresh_fanout.sql 24 -> 31
//    and test_ledger_refresh_composite_arm.sql 21 -> 28. Plus the three arms of
//    the NEW file supabase/tests/test_cron_runs_rls.sql (ADMIN 1, ANON 1,
//    USER 1), which also moves FILES_FLOOR above.
//    MEASURED via ONE full lane run with no file edited during it,
//    `node scripts/mutation-runner/run.mjs`: `scope: FULL 50/50 annotated
//    files`, `coverage: files 50/77`, `arms: 445/445/0`, `biting: 445`,
//    `lane-invocations: 445` (the two independent tallies AGREE, plus 50
//    baseline / 50 restore legs), `lane-blocked: 0 file(s)`, `lane-probe:
//    pg_cron AVAILABLE`, `unreachable: 27 file(s)`, `per-arm lane time: mean
//    1.1s over 445 arm run(s)`, `✅ No defects. Every annotated arm bit its own
//    arm first.`, exit 0. Per-file lines: `test_ledger_refresh_composite_arm.sql:
//    sections 28 / judged 28 / annotated 28 / waived 0 / biting 28`,
//    `test_ledger_refresh_fanout.sql: sections 31 / judged 31 / annotated 31 /
//    waived 0 / biting 31`, `test_cron_runs_rls.sql: sections 3 / judged 3 /
//    annotated 3 / waived 0 / biting 3`. That run was taken with this constant
//    at 428, BELOW the corpus, which the runner cannot see by construction; the
//    stale-low direction is src/__tests__/mutation-runner-floors.test.ts's.
//
// ⭐ RE-DERIVED 2026-09-24 (Phase 164.6 GATE-HYGIENE, review fix round 2):
//    445 -> 449, FOUR new arms, and no file joined the annotated set, so
//    FILES_FLOOR does not move. One W/deadlock sub-arm in EACH ledger gate (a
//    deadlock, 40P01, is now a FAILURE and must be named; its twin puts
//    deadlock_detected back in the lost-race branch):
//    test_ledger_refresh_fanout.sql 31 -> 32 and
//    test_ledger_refresh_composite_arm.sql 28 -> 29. Plus the two WRITE arms
//    of supabase/tests/test_cron_runs_rls.sql (ANON 2, USER 2: a failure-row
//    INSERT is refused by row security), 3 -> 5. Arm U in both ledger gates
//    was INVERTED in place (the all-candidates-failed raise is gone), which
//    moves no count. MEASURED per file first, each a narrowed `--file` run
//    with every arm `RED (identity ok)`: `biting: 32`, `biting: 29`,
//    `biting: 5`. The full-run reading follows.
//    MEASURED via ONE full lane run with no file edited during it and this
//    constant ALREADY at 449, `node scripts/mutation-runner/run.mjs`: `scope:
//    FULL 50/50 annotated files`, `coverage: files 50/77`, `arms: 449/449/0`,
//    `biting: 449`, `lane-invocations: 449` (the two independent tallies
//    AGREE, plus 50 baseline / 50 restore legs), `lane-blocked: 0 file(s)`,
//    `lane-probe: pg_cron AVAILABLE`, `unreachable: 27 file(s)`, `per-arm lane
//    time: mean 1.1s over 449 arm run(s)`, `✅ No defects. Every annotated arm
//    bit its own arm first.`, exit 0. Per-file lines:
//    `test_ledger_refresh_composite_arm.sql: sections 29 / judged 29 /
//    annotated 29 / waived 0 / biting 29`, `test_ledger_refresh_fanout.sql:
//    sections 32 / judged 32 / annotated 32 / waived 0 / biting 32`,
//    `test_cron_runs_rls.sql: sections 5 / judged 5 / annotated 5 / waived 0 /
//    biting 5`.
//
// ⭐ RE-DERIVED 2026-09-26 (Phase 164.5.2 BRIDGELOCK, plan 03): 449 -> 453,
//    FOUR new arms, L1-L4, all in the NEW file
//    supabase/tests/test_mark_rpc_bridge_advisory_lock.sql (which also moves
//    FILES_FLOOR above). Each arm has one layered RED-UNDER-M twin against
//    migration 20260926120000; D-16 measured that no existing twin targets the
//    two re-based migrations (20260603120000, 20260529180000), so none is
//    shadowed.
//    SEPARATED in BOTH directions on full lane runs, each with no file edited
//    during it:
//    - stale-low, the constant at 449: the runner's own verdict names no floor
//      (it cannot see a floor below the corpus, by construction), and
//      src/__tests__/mutation-runner-floors.test.ts FAILS with `The corpus
//      declares 453 twin(s) of which 0 are waivers, so a green run bites 453.
//      ARMS_FLOOR is 449.`;
//    - too high, the constant at 454: exit 1 with exactly one defect,
//      `ARMS_FLOOR regression: 453 biting arm(s) < floor 454`;
//    - measured, the constant at 453: `scope: FULL 51/51 annotated files`,
//      `coverage: files 51/78`, `arms: 453/453/0`, `biting: 453`,
//      `lane-invocations: 453` (the two independent tallies AGREE, plus 51
//      baseline / 51 restore legs), `lane-blocked: 0 file(s)`, `lane-probe:
//      pg_cron AVAILABLE`, `unreachable: 27 file(s)`, `✅ No defects. Every
//      annotated arm bit its own arm first.`, exit 0. Per-file line:
//      `test_mark_rpc_bridge_advisory_lock.sql: sections 4 / judged 4 /
//      annotated 4 / waived 0 / biting 4`.
//    WAIVED_CEILING stays 0 — no waiver was added.
//
// ⭐ RE-DERIVED 2026-09-25 (Phase 167.1.2 ACCOUNTTRUTH, plan 03, PR B): 449 ->
//    474. TWENTY-FIVE new arms: all 24 of the NEW
//    supabase/tests/test_api_keys_account_identity.sql (ACCT-a..j, ACCT-s,
//    ACCT-f/f2/g, HIST-* and RECON-*, against migration 20260925120000), plus
//    arm 6f CCXT in the already-annotated
//    supabase/tests/test_api_keys_venue_identity_uniq.sql (7 -> 8: a second
//    live okx row on one account id is refused, and admitted once the first is
//    disconnected). FILES_FLOOR moves 50 -> 51 in the block above.
//    MEASURED per file first, each a narrowed `--file` run with every arm
//    `RED (identity ok)`: `arms: 24/24/0` and `arms: 8/8/0`, both `No defects
//    in the narrowed scope.` Then ONE full lane run with no file edited during
//    it and this constant still at 449, `node scripts/mutation-runner/run.mjs`:
//    `scope: FULL 51/51 annotated files`, `coverage: files 51/78`, `arms:
//    474/474/0`, `biting: 474`, `lane-invocations: 474` (the two independent
//    tallies AGREE, plus 51 baseline / 51 restore legs), `lane-blocked: 0
//    file(s)`, `lane-probe: pg_cron AVAILABLE`, `unreachable: 27 file(s)`,
//    `per-arm lane time: mean 1.7s over 474 arm run(s)`, `✅ No defects. Every
//    annotated arm bit its own arm first.`, exit 0. WAIVED_CEILING stays 0.
//    RE-MEASURED 2026-09-26 after merging origin/main (Phase 164.9.1, PR #860,
//    which moved no arm): one full lane run, tree frozen, constants at 51 /
//    474: `scope: FULL 51/51`, `coverage: files 51/78`, `arms: 474/474/0`,
//    `biting: 474`, `lane-invocations: 474 … plus 51 baseline / 51 restore
//    leg(s)`, `✅ No defects.`, exit 0.
//
// ⭐ RE-DERIVED 2026-09-26 (Phase 167.1.2 ACCOUNTTRUTH, plan 03, PR B pre-merge
//    review fixes): 474 -> 483. NINE new arms, all in the ALREADY-ANNOTATED
//    supabase/tests/test_api_keys_account_identity.sql (24 -> 33): ACCT-l
//    (missing holder 23503), ACCT-m (marked holder, chain and 2-cycle), ACCT-n
//    (a key that already holds another), ACCT-o (departed holder), ACCT-p
//    (contradictory holder clear), HIST-running (a toggle while the recompose
//    runs is refused), RECON-hist (reconnect resets history_inclusion),
//    RECON-tenant and RECON-other-exchange (the refusal's user and exchange
//    conjuncts), against migration 20260925120000 edited in place. No file
//    joined the annotated set, so FILES_FLOOR stays 51; WAIVED_CEILING stays 0.
//    MEASURED first on a narrowed `--file` run: `arms: 33/33/0`, `biting: 33`,
//    every arm `RED (identity ok)`, `No defects in the narrowed scope.` Then ONE
//    full lane run with no file edited during it and this constant still at
//    474, `node scripts/mutation-runner/run.mjs`: `scope: FULL 51/51 annotated
//    files`, `coverage: files 51/78`, `arms: 483/483/0`, `biting: 483`,
//    `lane-invocations: 483` (the two independent tallies AGREE, plus 51
//    baseline / 51 restore legs), `lane-blocked: 0 file(s)`, `lane-probe:
//    pg_cron AVAILABLE`, `unreachable: 27 file(s)`, `per-arm lane time: mean
//    1.1s over 483 arm run(s)`, `✅ No defects. Every annotated arm bit its own
//    arm first.`, exit 0. Per-file line: `test_api_keys_account_identity.sql:
//    sections 33 / judged 33 / annotated 33 / waived 0 / biting 33`.
//
// ⭐ RE-DERIVED 2026-09-26 (Phase 167.1.2 ACCOUNTTRUTH, PR B review round 2):
//    483 -> 484. ONE new arm, HIST-lock, in the ALREADY-ANNOTATED
//    supabase/tests/test_api_keys_account_identity.sql (33 -> 34): the recompose
//    job set_departed_key_history_inclusion hands back is locked by it (xmax of
//    the row it inserted is non-zero; its twin drops FOR UPDATE from the RPC's
//    step 3 SELECT). HIST-running's twin also gained a second edit step (the RPC
//    now tests for a running job twice), which moves steps, not arms. No file
//    joined the annotated set, so FILES_FLOOR stays 51; WAIVED_CEILING stays 0.
//    MEASURED first on a narrowed `--file` run: `arms: 34/34/0`, `biting: 34`,
//    `No defects in the narrowed scope.` Then ONE full lane run with no file
//    edited during it and this constant still at 483: `scope: FULL 51/51
//    annotated files`, `coverage: files 51/78`, `arms: 484/484/0`, `biting:
//    484`, `lane-invocations: 484` (plus 51 baseline / 51 restore legs),
//    `lane-blocked: 0 file(s)`, `lane-probe: pg_cron AVAILABLE`, `per-arm lane
//    time: mean 1.2s over 484 arm run(s)`, `✅ No defects. Every annotated arm
//    bit its own arm first.`, exit 0. Per-file line:
//    `test_api_keys_account_identity.sql: sections 34 / judged 34 / annotated
//    34 / waived 0 / biting 34`.
//
// ⭐ RE-DERIVED 2026-09-26 (Phase 167.1.2 ACCOUNTTRUTH, PR B review round 3):
//    484 -> 485. ONE new arm, HIST-retry, in the ALREADY-ANNOTATED
//    supabase/tests/test_api_keys_account_identity.sql (34 -> 35): a toggle
//    beside the caller's failed_retry recompose REUSES that row (moved to
//    now()) and never queues a pending twin of it; its twin makes the RPC's
//    failed_retry lookup find nothing (AND FALSE). HIST-enqueues' twin find
//    string moved with the enqueue call's new indentation, which moves no arm
//    or step. No file joined the annotated set, so FILES_FLOOR stays 51;
//    WAIVED_CEILING stays 0. MEASURED first on a narrowed `--file` run:
//    `arms: 35/35/0`, `biting: 35`, `No defects in the narrowed scope.` Then
//    ONE full lane run with no file edited during it and this constant still
//    at 484: `scope: FULL 51/51 annotated files`, `coverage: files 51/78`,
//    `arms: 485/485/0`, `biting: 485`, `lane-invocations: 485` (plus 51
//    baseline / 51 restore legs), `lane-blocked: 0 file(s)`, `lane-probe:
//    pg_cron AVAILABLE`, `per-arm lane time: mean 1.1s over 485 arm run(s)`,
//    `✅ No defects. Every annotated arm bit its own arm first.`, exit 0.
//    Per-file line: `test_api_keys_account_identity.sql: sections 35 / judged
//    35 / annotated 35 / waived 0 / biting 35`.
//
// ⭐ RE-DERIVED 2026-09-26 (Phase 167.1.2 ACCOUNTTRUTH, PR B review round 4):
//    485 -> 486. ONE new arm, HIST-tenant, in the ALREADY-ANNOTATED
//    supabase/tests/test_api_keys_account_identity.sql (35 -> 36): user A's
//    toggle leaves user B's failed_retry derive_allocator_equity row exactly as
//    it was; its twin drops the allocator filter from the RPC's failed_retry
//    lookup (WHERE TRUE), so A's toggle would reuse B's row. HIST-lock's and
//    HIST-enqueues' find strings moved with step 3's new loop indentation,
//    which moves no arm or step. No file joined the annotated set, so
//    FILES_FLOOR stays 51; WAIVED_CEILING stays 0. MEASURED first on a
//    narrowed `--file` run: `arms: 36/36/0`, `biting: 36`, `No defects in the
//    narrowed scope.` Then ONE full lane run with no file edited and no git
//    command run during it, and this constant still at 485: `scope: FULL
//    51/51 annotated files`, `coverage: files 51/78`, `arms: 486/486/0`,
//    `biting: 486`, `lane-invocations: 486` (plus 51 baseline / 51 restore
//    legs), `lane-blocked: 0 file(s)`, `lane-probe: pg_cron AVAILABLE`,
//    `per-arm lane time: mean 1.5s over 486 arm run(s)`, `✅ No defects. Every
//    annotated arm bit its own arm first.`, exit 0. Per-file line:
//    `test_api_keys_account_identity.sql: sections 36 / judged 36 / annotated
//    36 / waived 0 / biting 36`.
//
// ⭐ RE-DERIVED 2026-09-26 (Phase 167.1.2 ACCOUNTTRUTH, PR B review round 4
//    fixes): 486 -> 487. ONE new arm, HIST-requeued, in the ALREADY-ANNOTATED
//    supabase/tests/test_api_keys_account_identity.sql (36 -> 37): a
//    test-local BEFORE UPDATE trigger inserts a pending twin under the RPC's
//    failed_retry reuse, so the flip collides on
//    compute_jobs_one_inflight_per_kind_allocator; the RPC must answer 55006
//    HISTORY_RECOMPOSE_REQUEUED with nothing written. Its twin makes the
//    flip's handler catch division_by_zero instead of unique_violation, so the
//    raw 23505 reaches the caller. HIST-enqueues' find string moved with the
//    enqueue's new serialization_failure wrapper, which moves no arm or step.
//    No file joined the annotated set, so FILES_FLOOR stays 51;
//    WAIVED_CEILING stays 0. MEASURED first on a narrowed `--file` run:
//    `arms: 37/37/0`, `biting: 37`, `No defects in the narrowed scope.` Then
//    ONE full lane run with no file edited during it, and this constant still
//    at 486: `scope: FULL 51/51 annotated files`, `coverage: files 51/78`,
//    `arms: 487/487/0`, `biting: 487`, `lane-invocations: 487` (plus 51
//    baseline / 51 restore legs), `lane-blocked: 0 file(s)`, `lane-probe:
//    pg_cron AVAILABLE`, `per-arm lane time: mean 1.7s over 487 arm run(s)`,
//    `✅ No defects. Every annotated arm bit its own arm first.`, exit 0.
//    Per-file line: `test_api_keys_account_identity.sql: sections 37 / judged
//    37 / annotated 37 / waived 0 / biting 37`.
//
// ⭐ RE-DERIVED 2026-09-26 (merge of origin/main into Phase 164.5.2
//    BRIDGELOCK): 491, the UNION of the two lineages above. Over the common
//    base of 449, this branch added FOUR arms (L1-L4, the NEW
//    test_mark_rpc_bridge_advisory_lock.sql) and origin/main added THIRTY-EIGHT
//    (all 37 of the NEW test_api_keys_account_identity.sql plus arm 6f CCXT in
//    test_api_keys_venue_identity_uniq.sql), so 449 + 4 + 38 = 491. The two
//    sides touch disjoint gate files, so no arm is counted twice. MEASURED via
//    ONE full lane run on the merged tree, `node scripts/mutation-runner/
//    run.mjs`: `scope: FULL 52/52 annotated files`, `coverage: files 52/79`,
//    `arms: 491/491/0`, `biting: 491`, `lane-invocations: 491` (the two
//    independent tallies AGREE, plus 52 baseline / 52 restore legs),
//    `lane-blocked: 0 file(s)`, `lane-probe: pg_cron AVAILABLE`, `unreachable:
//    27 file(s)`, `pending: 0`, `per-arm lane time: mean 1.1s over 491 arm
//    run(s)`, `✅ No defects. Every annotated arm bit its own arm first.`,
//    exit 0. Per-file lines: `test_mark_rpc_bridge_advisory_lock.sql: sections
//    4 / … / biting 4`, `test_api_keys_account_identity.sql: sections 37 / … /
//    biting 37`, `test_api_keys_venue_identity_uniq.sql: sections 8 / … /
//    biting 8`.
//    WAIVED_CEILING stays 0 — no waiver was added.
//
// ⭐ RE-DERIVED 2026-09-27 (Phase 164.9.3 CLAIMPAIR, plan 05): 491 -> 506,
//    FIFTEEN new arms (C-KEY, C-PF, C-ST, C-AL, P5-KEY, P5-PF, P5-ST, P5-AL,
//    W-LOST, W-INTRO, P2-KEY, P2-PF, P2-ST, P2-AL, P2-C39), all in the NEW file
//    supabase/tests/test_claim_compute_jobs_failed_retry_pending_pair.sql
//    (which also moves FILES_FLOOR above). Each arm has one layered
//    RED-UNDER-M twin against migration 20260927120000: step 1 neuters one
//    body's clause, step 2 stands down that body's own self-verify anchor.
//    MEASURED via ONE full lane run with no file edited during it, the
//    constant still at 491: `scope: FULL 53/53 annotated files`, `coverage:
//    files 53/80`, `arms: 506/506/0`, `biting: 506`, `lane-invocations: 506`
//    (the two independent tallies AGREE, plus 53 baseline / 53 restore legs),
//    `lane-blocked: 0 file(s)`, `lane-probe: pg_cron AVAILABLE`, `unreachable:
//    27 file(s)`, `per-arm lane time: mean 1.2s over 506 arm run(s)`, `✅ No
//    defects. Every annotated arm bit its own arm first.`, exit 0, wall clock
//    710 s. Per-file line: `test_claim_compute_jobs_failed_retry_pending_pair.sql:
//    sections 9 / judged 15 / annotated 15 / waived 0 / biting 15`.
//    SEPARATED in BOTH directions, each edit restored from a byte backup and
//    proved with cmp:
//    - too high, the constant at 507 (FILES_FLOOR at 54): a full lane run
//      exits 1 with exactly two defects, `FILES_FLOOR regression: 53
//      annotated file(s) < floor 54` and `ARMS_FLOOR regression: 506 biting
//      arm(s) < floor 507`;
//    - stale-low, the constant at 505: the runner's verdict names no floor
//      (it cannot see a floor below the corpus, by construction), and
//      src/__tests__/mutation-runner-floors.test.ts FAILS with `The corpus
//      declares 506 twin(s) of which 0 are waivers, so a green run bites 506.
//      ARMS_FLOOR is 505.`;
//    - measured, the constant at 506: exit 0, `✅ No defects`.
//    WAIVED_CEILING stays 0 — no waiver was added.
//
// ⭐ RE-DERIVED 2026-09-27 (Phase 164.9.3 CLAIMPAIR, review round 1, WR-01):
//    506 -> 507, ONE new arm, W-LOWTWIN, in the ALREADY-ANNOTATED
//    supabase/tests/test_claim_compute_jobs_failed_retry_pending_pair.sql
//    (15 -> 16), so FILES_FLOOR stays 53. Its layered twin makes the 5-arg
//    CLAIMPAIR PROBE EXCLUSION block of migration 20260927120000 always false
//    and stands down v_p5_probe_anchored. MEASURED via ONE full lane run with
//    no file edited during it, the constant still at 506: `scope: FULL 53/53
//    annotated files`, `coverage: files 53/80`, `arms: 507/507/0`, `biting:
//    507`, `lane-invocations: 507` (the two independent tallies AGREE, plus 53
//    baseline / 53 restore legs), `lane-blocked: 0 file(s)`, `lane-probe:
//    pg_cron AVAILABLE`, `unreachable: 27 file(s)`, `per-arm lane time: mean
//    1.2s over 507 arm run(s)`, `✅ No defects. Every annotated arm bit its own
//    arm first.`, exit 0. Per-file line:
//    `test_claim_compute_jobs_failed_retry_pending_pair.sql: sections 10 /
//    judged 16 / annotated 16 / waived 0 / biting 16`.
//    Stale-low direction OBSERVED at 506: src/__tests__/mutation-runner-floors.test.ts
//    FAILS with `The corpus declares 507 twin(s) of which 0 are waivers, so a
//    green run bites 507. ARMS_FLOOR is 506.` The too-high direction was NOT
//    re-run at 508: the runner's own `bitingArms < armsFloor` comparison is
//    unchanged and was separated at 507 against 506 in plan 05.
//    WAIVED_CEILING stays 0 — no waiver was added.
//
// ⭐ RE-DERIVED 2026-09-27 (Phase 164.9.3 CLAIMPAIR, review round 3, WR-01,
//    founder decision D-11): 507 -> 509, TWO new arms, W-C39SIB and
//    W-C39INTRO, in the ALREADY-ANNOTATED
//    supabase/tests/test_claim_compute_jobs_failed_retry_pending_pair.sql
//    (16 -> 18), so FILES_FLOOR stays 53. Their layered twins revert the
//    5-arg throttle probe's allocator widening and re-add the intro carve-out
//    in front of its strategy EXISTS (the literal-widening form), each with
//    v_p5_probe_anchored stood down. MEASURED via ONE full lane run with no
//    file edited during it, the constant still at 507: `scope: FULL 53/53
//    annotated files`, `coverage: files 53/80`, `arms: 509/509/0`, `biting:
//    509`, `lane-invocations: 509` (the two independent tallies AGREE, plus 53
//    baseline / 53 restore legs), `lane-blocked: 0 file(s)`, `lane-probe:
//    pg_cron AVAILABLE`, `unreachable: 27 file(s)`, `per-arm lane time: mean
//    1.2s over 509 arm run(s)`, `✅ No defects. Every annotated arm bit its own
//    arm first.`, exit 0. Per-file line:
//    `test_claim_compute_jobs_failed_retry_pending_pair.sql: sections 12 /
//    judged 18 / annotated 18 / waived 0 / biting 18`.
//    Stale-low direction OBSERVED at 507: src/__tests__/mutation-runner-floors.test.ts
//    FAILS with `The corpus declares 509 twin(s) of which 0 are waivers, so a
//    green run bites 509. ARMS_FLOOR is 507.` The too-high direction was NOT
//    re-run at 510: the runner's own `bitingArms < armsFloor` comparison is
//    unchanged and was separated at 507 against 506 in plan 05.
//    WAIVED_CEILING stays 0 — no waiver was added.
// ⭐ RE-DERIVED 2026-09-27 (Phase 167.1.2 ACCOUNTTRUTH, PR C1, merge of origin/main
//    after 164.9.3 CLAIMPAIR): 509 -> 513, the UNION of two branches' arms. C1
//    added FOUR arms to supabase/tests/test_api_keys_account_identity.sql (37 ->
//    41: HIST-signin, HIST-error, HIST-inactive, HIST-nullstatus, plan 16, D-18);
//    CLAIMPAIR's 509 already counts its eighteen. FILES_FLOOR stays 53 (C1 added no
//    gate file). MEASURED via ONE full lane run on the merged tree, no file edited
//    during it: `scope: FULL 53/53 annotated files`, `coverage: files 53/80`,
//    `arms: 513/513/0`, `biting: 513`, `lane-invocations: 513` (plus 53 baseline /
//    53 restore legs), `lane-blocked: 0 file(s)`, `lane-probe: pg_cron AVAILABLE`,
//    `unreachable: 27 file(s)`, `per-arm lane time: mean 1.2s over 513 arm run(s)`,
//    `✅ No defects. Every annotated arm bit its own arm first.`, exit 0. Per-file
//    lines: `test_api_keys_account_identity.sql: ... biting 41` and
//    `test_claim_compute_jobs_failed_retry_pending_pair.sql: ... biting 18`.
//    WAIVED_CEILING stays 0.
// ⭐ MOVED 2026-09-29 (Phase 167.1.2 ACCOUNTTRUTH PR C2, review fix B, WR-04):
//    513 -> 545. THIRTY-TWO arms, all in plan 12's NEW supabase/tests/
//    test_refresh_fanout_zero_snapshot_bootstrap.sql (which also moves
//    FILES_FLOOR 53 -> 54), against migration 20260928140000. The file reached
//    this branch without its census commits, so the pins are re-measured here
//    rather than carried: the reference branch's numbers were taken against an
//    older main. MEASURED via ONE full lane run at a6fc18e45, no file edited
//    during it: `scope: FULL 54/54 annotated files`, `coverage: files 54/81`,
//    `arms: 545/545/0`, `biting: 545`, `lane-invocations: 545` (plus 54
//    baseline / 54 restore legs), `lane-blocked: 0 file(s)`, `lane-probe:
//    pg_cron AVAILABLE`, `unreachable: 27 file(s)`, `per-arm lane time: mean
//    1.3s over 545 arm run(s)`, `✅ No defects. Every annotated arm bit its own
//    arm first.`, exit 0. Per-file line: `test_refresh_fanout_zero_snapshot_
//    bootstrap.sql: sections 27 / judged 32 / annotated 32 / waived 0 / biting
//    32`. Stale-low direction OBSERVED at 513: src/__tests__/mutation-runner-
//    floors.test.ts FAILS with `The corpus declares 545 twin(s) of which 0 are
//    waivers, so a green run bites 545. ARMS_FLOOR is 513.` WAIVED_CEILING
//    stays 0 — no waiver was added.
// ⭐ RE-DERIVED 2026-10-01 (Phase 164.9.3.2 DEFER40001, plan 06): 545 -> 553.
//    EIGHT arms (D1, D1L, M1, M1L, M2, M2L, F1, F1L), all in the NEW gate
//    supabase/tests/test_compute_job_fence_errcode.sql (which also moves
//    FILES_FLOOR 54 -> 55), against migration 20261001120000. MEASURED on the
//    tree MERGED with origin/main (c110555e2) via ONE full lane run, no file
//    edited during it, constants still at 54 / 545: `scope: FULL 55/55
//    annotated files`, `coverage: files 55/82`, `arms: 553/553/0`, `biting:
//    553`, `lane-invocations: 553` (plus 55 baseline / 55 restore legs),
//    `lane-blocked: 0 file(s)`, `lane-probe: pg_cron AVAILABLE`, `unreachable:
//    27 file(s)`, `per-arm lane time: mean 1.2s over 553 arm run(s)`, `✅ No
//    defects. Every annotated arm bit its own arm first.`, exit 0. Per-file
//    line: `test_compute_job_fence_errcode.sql: sections 8 / judged 8 /
//    annotated 8 / waived 0 / biting 8`. Stale-low direction OBSERVED at 545:
//    src/__tests__/mutation-runner-floors.test.ts FAILS with `The corpus
//    declares 553 twin(s) of which 0 are waivers, so a green run bites 553.
//    ARMS_FLOOR is 545.` Too-high direction OBSERVED at 554 (with
//    FILES_FLOOR 56): a full lane run exits 1 naming `ARMS_FLOOR regression:
//    553 biting arm(s) < floor 554`; restored from a byte backup and proved
//    with cmp. WAIVED_CEILING stays 0 — no waiver was added.
// ⭐ RE-DERIVED 2026-10-02 (Phase 164.9.3.2.1 ENQ40001, plan 03): 553 -> 555.
//    TWO arms (R1, R2), both in the NEW gate
//    supabase/tests/test_enqueue_race_loss_40001.sql (which also moves
//    FILES_FLOOR 55 -> 56), against _enqueue_compute_job_internal as migration
//    20260924230827 defines it (no migration in this phase). MEASURED on the
//    tree MERGED with origin/main (f18b49f8a) via ONE full lane run, no file
//    edited during it, constants still at 55 / 553: `scope: FULL 56/56
//    annotated files`, `coverage: files 56/83`, `arms: 555/555/0`, `biting:
//    555`, `lane-invocations: 555` (plus 56 baseline / 56 restore legs),
//    `lane-blocked: 0 file(s)`, `lane-probe: pg_cron AVAILABLE`, `unreachable:
//    27 file(s)`, `per-arm lane time: mean 1.1s over 555 arm run(s)`, `✅ No
//    defects. Every annotated arm bit its own arm first.`, exit 0. Per-file
//    line: `test_enqueue_race_loss_40001.sql: sections 2 / judged 2 /
//    annotated 2 / waived 0 / biting 2`. Stale-low direction OBSERVED at 553:
//    src/__tests__/mutation-runner-floors.test.ts FAILS with `The corpus
//    declares 555 twin(s) of which 0 are waivers, so a green run bites 555.
//    ARMS_FLOOR is 553.` Too-high direction OBSERVED at 556 (with
//    FILES_FLOOR 57): a full lane run exits 1 naming `ARMS_FLOOR regression:
//    555 biting arm(s) < floor 556`; restored from a byte backup and proved
//    with cmp. WAIVED_CEILING stays 0 — no waiver was added.
// ⭐ RE-DERIVED 2026-10-02 (Phase 164.9.3.2.1 ENQ40001, review fix WR-01):
//    555 -> 556. ONE arm, R3, in the ALREADY-ANNOTATED gate
//    supabase/tests/test_enqueue_race_loss_40001.sql (2 -> 3): the race-loss
//    raise and its convergence on the api_key-target branch, its twin widening
//    the api_key look-up of migration 20260924230827 to `done`. No file joined
//    the annotated set, so FILES_FLOOR stays 56. MEASURED on ONE full lane run
//    with the constant still at 555: `scope: FULL 56/56 annotated files`,
//    `coverage: files 56/83`, `arms: 556/556/0`, `biting: 556`,
//    `lane-invocations: 556` (plus 56 baseline / 56 restore legs),
//    `per-arm lane time: mean 1.2s over 556 arm run(s)`. Per-file line:
//    `test_enqueue_race_loss_40001.sql: sections 3 / judged 3 / annotated 3 /
//    waived 0 / biting 3`. That run's only defect was `dirty-checkout`, caused by
//    comment and census edits made in the checkout while it ran. Confirmation
//    run at 556, at 7cbf8f389, no file edited during it: `arms: 556/556/0`,
//    `biting: 556`, `lane-invocations: 556`, `✅ No defects`, exit 0, 823 s.
//    Stale-low direction OBSERVED at 555:
//    src/__tests__/mutation-runner-floors.test.ts FAILS with `The corpus
//    declares 556 twin(s) of which 0 are waivers, so a green run bites 556.
//    ARMS_FLOOR is 555.` Too-high direction NOT re-run for this +1.
//    WAIVED_CEILING stays 0 — no waiver was added.
// ⭐ RE-DERIVED 2026-10-03 (Phase 164.5.2.1 BRIDGERESIDUE, plan 05): 556 -> 574.
//    EIGHTEEN arms in TWO NEW gates (which also move FILES_FLOOR 56 -> 58),
//    against sync_strategy_analytics_status as migration 20261003120000
//    defines it: 16 in supabase/tests/test_sync_status_bridge_residues.sql
//    (W1..W7 and R1..R6 for the two 164.6.7 residues, K1..K3 for the founder's
//    hold-the-date keep) and 2 in the LANE-ONLY
//    supabase/tests/test_sync_status_bridge_lock.sql (B1, B2). MEASURED on the
//    tree MERGED with origin/main (d0e1398a1) via ONE full lane run, no file
//    edited during it, constants still at 56 / 556: `scope: FULL 58/58
//    annotated files`, `coverage: files 58/85`, `arms: 574/574/0`, `biting:
//    574`, `lane-invocations: 574` (plus 58 baseline / 58 restore legs),
//    `lane-blocked: 0 file(s)`, `lane-probe: pg_cron AVAILABLE`, `unreachable:
//    27 file(s)`, `per-arm lane time: mean 1.1s over 574 arm run(s)`, `✅ No
//    defects. Every annotated arm bit its own arm first.`, exit 0. Per-file
//    lines: `test_sync_status_bridge_lock.sql: sections 2 / judged 2 /
//    annotated 2 / waived 0 / biting 2` and
//    `test_sync_status_bridge_residues.sql: sections 16 / judged 16 /
//    annotated 16 / waived 0 / biting 16`. Stale-low direction OBSERVED at 556:
//    src/__tests__/mutation-runner-floors.test.ts FAILS with `The corpus
//    declares 574 twin(s) of which 0 are waivers, so a green run bites 574.
//    ARMS_FLOOR is 556.` Too-high direction OBSERVED at 575 (with
//    FILES_FLOOR 59): a full lane run exits 1 with exactly two defects, one
//    naming `ARMS_FLOOR regression: 574 biting arm(s) < floor 575`; restored
//    from a byte backup and proved with cmp (exit 0).
//    WAIVED_CEILING stays 0 — no waiver was added.
//
// RAISED 574 -> 578 2026-10-07 (Phase 164.6.6.3.5 DOMAINONE, plan 03): FOUR arms
// from test_for_quants_leads_contact_dedupe.sql (index dropped, index re-made
// TOTAL, source CHECK dropped, and a competing total unique index that only the
// behavioural section 4 catches), measured by the same single full run recorded
// under FILES_FLOOR above: `arms: 578/578/0`, `biting: 578`. The fourth arm is
// not a flourish: mutation-annotation-parser.test.ts requires every SECTION a
// file raises for to carry a twin, and section 4 (behavioural) raises. Each arm
// was also driven by hand on the lane and read RED on its own identity first.
// WAIVED_CEILING stays 0 - no waiver was added.
//
// RAISED 578 -> 591 2026-10-07 (Phase 164.6.6.3.4 STATUSBRIDGE, plan 03): THIRTEEN arms
// from test_sync_status_analytics_scope.sql, the gate over the status bridge's
// side-kind exclusion (S1..S6), its process_key_long supersession (C1..C4) and
// the unchanged per-kind rule (G1..G3), measured by the same single full run
// recorded under FILES_FLOOR above: `arms: 591/591/0`, `biting: 591`. The census
// pins moved in the same commit: src/__tests__/mutation-runner-floors.test.ts
// (the stale-low ratchet, `totalAnchored`, the synthetic run logs),
// mutation-annotation-parser.test.ts (`armsSeen` 591, `stepsSeen` 700, needles
// 700, `filesTotal` 87, `filesAnnotated` 60), lint-sql-gates.test.ts (`scanned
// 87 file`) and gate-family-meta.test.ts (the two threshold-site strings).
// Stale-low direction OBSERVED at 59 / 578: mutation-runner-floors.test.ts FAILS
// with `RATCHET STALE: 60 of 87 gate files are now annotated but FILES_FLOOR is
// still 59` and `The corpus declares 591 twin(s) of which 0 are waivers, so a
// green run bites 591. ARMS_FLOOR is 578`. Too-high direction OBSERVED at
// ARMS_FLOOR 592 (the observation is recorded in the plan 03 SUMMARY): a full
// lane run exits 1 naming `ARMS_FLOOR regression: 591 biting arm(s) < floor
// 592`. The separation edit was restored from a byte backup and proved with cmp
// (exit 0). WAIVED_CEILING stays 0 - no waiver was added.
// RAISED 591 -> 593 2026-10-07 (Phase 164.6.6.3.4 STATUSBRIDGE, founder D-09): TWO arms,
// D9 and D10, added to the ALREADY-ANNOTATED test_sync_status_analytics_scope.sql (so
// FILES_FLOOR stays 60 and the denominator stays 87). D9: a failed side-kind job never
// stamps computed_at or blanks the sentence of a real earlier failure. D10 (guard): a
// genuine compute created after a lingering failed side job still does. MEASURED by ONE
// full lane run of `node scripts/mutation-runner/run.mjs`, no file edited during it,
// constants still at 60 / 591 (the floors read the measurement, never the other way
// round): `scope: FULL 60/60 annotated files`, `coverage: files 60/87`, `arms:
// 593/593/0`, `biting: 593`, `lane-invocations: 593 ... plus 60 baseline / 60 restore
// leg(s)` (the two tallies AGREE), `unreachable: 27`, `lane-blocked: 0`, `per-arm lane
// time: mean 1.9s over 593 arm run(s)`, `No defects.`, exit 0. Per-file line:
// `test_sync_status_analytics_scope.sql: sections 15 / judged 15 / annotated 15 /
// waived 0 / biting 15`. The census pins moved in the same commit:
// mutation-runner-floors.test.ts (`totalAnchored` and the synthetic run logs),
// mutation-annotation-parser.test.ts (`armsSeen`, `stepsSeen`, needles),
// drift-check-scripts.test.ts and ci.yml (ARMS_FLOOR=271 over the sentinel sum) and
// gate-family-meta.test.ts (the threshold-site string). WAIVED_CEILING stays 0.
// RAISED 593 -> 597 2026-10-08 (Phase 164.6.6.3.4 STATUSBRIDGE, round 3 of the founder D-09
// rework): FOUR arms, D11 to D14, added to the ALREADY-ANNOTATED
// test_sync_status_analytics_scope.sql (so FILES_FLOOR stays 60 and the denominator stays
// 87). D11: a TRANSIENT side failure (a sync_funding timeout) holds computed_at, the
// sentence, the markers and the status through every failed_retry hop. D12 (guard): a
// counting success after a side job created later failed fast still advances computed_at
// (the hold is keyed on the trigger, not on recency). D13: a failed row that carries a
// sentence stays failed. D14: no strategy_analytics row is manufactured for a side-only
// failure. MEASURED by ONE full lane run of `node scripts/mutation-runner/run.mjs`, no
// file edited during it, constants still at 60 / 593 (the floors read the measurement,
// never the other way round): `scope: FULL 60/60 annotated files`, `coverage: files
// 60/87`, `arms: 597/597/0`, `biting: 597`, `lane-invocations: 597 ... plus 60 baseline /
// 60 restore leg(s)` (the two tallies AGREE), `unreachable: 27`, `lane-blocked: 0`,
// `per-arm lane time: mean 1.6s over 597 arm run(s)`, `No defects.` Per-file line:
// `test_sync_status_analytics_scope.sql: sections 19 / judged 19 / annotated 19 / waived 0
// / biting 19`. The census pins moved in the same commit: mutation-runner-floors.test.ts,
// mutation-annotation-parser.test.ts, drift-check-scripts.test.ts, ci.yml (ARMS_FLOOR=275
// over the sentinel sum) and gate-family-meta.test.ts. WAIVED_CEILING stays 0.
// RAISED 597 -> 599 2026-10-08 (Phase 164.6.6.3.4 STATUSBRIDGE, review fix round 4,
// founder D-10): TWO arms, D15 and D16, added to the ALREADY-ANNOTATED
// test_sync_status_analytics_scope.sql (so FILES_FLOOR stays 60 and the denominator
// stays 87). D15 (CR-R3-01): a genuine recompute on a warned row that finished done while
// a side job was queued is stamped when that side job then fails. D16 (WR-R3-01): a side
// job DEFERRED back to pending, named as the trigger by the Python DEFERRED path, leaves
// the row alone, and so does its later failure. MEASURED by ONE full lane run of
// `node scripts/mutation-runner/run.mjs`, no file edited during it (a first run, during
// which ci.yml was edited, reported a dirty-checkout defect and was discarded), constants
// still at 60 / 597: `scope: FULL 60/60 annotated files`, `coverage: files 60/87`,
// `arms: 599/599/0`, `biting: 599`, `lane-invocations: 599 ... plus 60 baseline / 60
// restore leg(s)` (the two tallies AGREE), `unreachable: 27`, `lane-blocked: 0`,
// `per-arm lane time: mean 1.7s over 599 arm run(s)`, `No defects.` Per-file line:
// `test_sync_status_analytics_scope.sql: sections 21 / judged 21 / annotated 21 / waived 0
// / biting 21`. The census pins moved in the same commit. WAIVED_CEILING stays 0.
// RAISED 599 -> 605 2026-10-08 (Phase 164.9.7 TRUNCATEREVOKE, merge with origin/main): SIX
// arms from test_truncate_revoke_anon_authenticated.sql (TRUNC 1 the catalogue sweep over
// every public relation, TRUNC 2 to 4 a table postgres creates after the migration, TRUNC 5
// service_role still holding TRUNCATE on cron_runs, TRUNC 6 the SQLSTATE refusal of a
// TRUNCATE issued as authenticated), on top of main's 599 (STATUSBRIDGE, 21 arms in
// test_sync_status_analytics_scope.sql). Measured by the same single full run recorded
// under FILES_FLOOR above: `arms: 605/605/0`, `biting: 605`. Each arm was also driven on
// the pg-lane in plan 01 and read RED on its own identity first. The too-high direction
// was observed on the merged tree by accident: the full run above that bit 604 exited 1
// naming `ARMS_FLOOR regression: 604 biting arm(s) < floor 605` (the lane flake recorded
// under FILES_FLOOR). The stale-low direction was measured on the branch alone at 59 /
// 578 (`RATCHET STALE: 60 of 87 gate files are now annotated but FILES_FLOOR is still 59`). WAIVED_CEILING stays 0 - no waiver was added.
// RAISED 605 -> 610 2026-10-09 (Phase 164.9.7.1 TRIGGERREVOKE, merge with origin/main, which
// was 0 commits ahead): FIVE arms, VERB 1 to VERB 5, added to the ALREADY-ANNOTATED
// test_truncate_revoke_anon_authenticated.sql (so FILES_FLOOR stays 61, the denominator stays
// 88 and WAIVED_CEILING stays 0). VERB 1 is the catalogue sweep over every public relation
// for TRIGGER and MAINTAIN, VERB 2 a table postgres creates after the migration, VERB 3
// service_role still holding each verb on that table, VERB 4 authenticated keeping
// INSERT/UPDATE/DELETE on cron_runs, VERB 5 the SQLSTATE refusal of a CREATE TRIGGER issued as
// authenticated on profiles. Every twin is a `sql` step on TRIGGER, so stepsSeen did not move.
// MAINTAIN is NOT machine-twinned: the sql-mutation pg-lane is PostgreSQL 16, where the verb
// does not exist (founder decision D-07); its half of the gate runs on the PG17 local-stack
// lane and is held by the migration's own self-check, a manual PG17 RED and a vitest pin.
// MEASURED by ONE full lane run of `node scripts/mutation-runner/run.mjs`, no file edited
// during it, constants still at 61 / 605: `scope: FULL 61/61 annotated files`, `coverage:
// files 61/88`, `arms: 610/610/0`, `biting: 610`, `lane-invocations: 610 ... plus 61 baseline
// / 61 restore leg(s)` (the two tallies AGREE), `unreachable: 27`, `lane-blocked: 0`,
// `per-arm lane time: mean 2.0s over 610 arm run(s)`, `No defects.`, exit 0, 395 s wall clock.
// Per-file line: `test_truncate_revoke_anon_authenticated.sql: sections 11 / judged 11 /
// annotated 11 / waived 0 / biting 11`. The stale-low direction was observed first: the
// census vitest files failed with `The corpus declares 610 twin(s) of which 0 are waivers, so
// a green run bites 610. ARMS_FLOOR is 605.`
export const ARMS_FLOOR = 610;

// WAIVED_CEILING — PINNED 2026-09-02 BY MEASUREMENT (164.3.1 red team), not
// chosen. A CEILING, not a floor: it fails when the corpus carries MORE waivers
// than were measured.
//
// ⛔ THE HOLE IT CLOSES. A waiver is a counted twin, so a prose marker paired
// with `{"arm":…,"waiver":…}` satisfies parity, raises `filesAnnotated` and
// `armsAnnotated`, never spawns a lane, never lowers `biting`, and exits 0.
// ARMS_FLOOR cannot see it: converting an EXISTING arm to a waiver lowers
// biting and trips the floor, but ADDING a new prose marker with a waiver twin
// adds nothing to biting and lowers nothing. Annotated-file coverage could be
// inflated across all 70 unannotated files with zero new arms and every floor
// green. So the waiver count is bounded from above, here and in ci.yml's
// count-recheck step (which parses the W field of `arms: E/A/W` against this
// constant, read from this file the way it reads ARMS_FLOOR).
//
// MEASURED 2026-09-02 at HEAD 8969513e:
//   `node scripts/mutation-runner/run.mjs --parse-only` -> exit 0
//     coverage: files 1/71
//     arms: 0/30/0   (executed/annotated/waived)   ← 0 waivers
//   independently: a node:fs scan of supabase/tests/*.sql for line-start
//   `RED-UNDER-M:` lines carrying `"waiver":` -> 0 (the pin in
//   src/__tests__/mutation-runner-floors.test.ts re-derives this on every run,
//   in lockstep with FILES_FLOOR / ARMS_FLOOR: drift in EITHER direction fails).
//
// ⚠️ Raising it is a deliberate, reviewed edit: each new waiver is an arm the
// runner will never prove can fail (T-164.3-21), and the reason string on the
// twin is the only evidence that it cannot be mutated into failing.
//
// ⚠️ CURRENCY 2026-09-04 (plan 164.4-11, the LAST batch of Phase 164.4): still
// 0, and the value is UNEDITED. The 2026-09-02 measurement above stays as the
// dated record of a 30-arm corpus; the corpus is now 262 arms across 39 files
// and the run's own `arms: 262/262/0` still reports W = 0. Cumulative waivers
// across all EIGHT arms moves of this phase: 0. Two arms came close and BOTH
// were resolved by a root-cause fix instead of an exception — plan 08's
// trust-signal anon-EXECUTE assertion by REORDERING the precondition ahead of
// its dependants (TODOS [REDUNDER-WAIVER-01]), and plan 09's resync-retry
// assertion (b) by wrapping its INSERT in the exception idiom the same file
// already used. Read the run's own `arms:` W field, never this constant, for
// what the corpus actually carries.
//
// ⚠️ CURRENCY 2026-09-05 (plan 164.4.1-02, the first file move of Phase
// 164.4.1): still 0, and the value is UNEDITED. The corpus is now 272 arms
// across 41 files and the run's own `arms: 272/272/0` still reports W = 0.
// Cumulative waivers across all NINE arms moves: 0. This batch came close once
// and it was closed by a root-cause fix rather than an exception — the derive
// gate's assertion 3 was wrapped in the exception idiom assertion 4 in the SAME
// FILE already used, so an unhandled 23514 that named no arm became a
// `TEST FAILED (3)` that does. The measurement lines above stay as lineage.
//
// ⛔ CURRENCY 2026-09-05 (plan 164.4.1-03, the second file move of Phase
// 164.4.1): STILL 0, and the value is UNEDITED — but for the first time in this
// phase family the corpus BREACHES it, on purpose and loudly. The run reports
// `arms: 296/297/1` and a `floor` defect reading `WAIVED_CEILING exceeded: 1
// waived arm(s) > ceiling 0`.
// The waived arm is `3/JOB-05` in
// supabase/tests/test_retention_orphaned_running.sql, and the refusal is
// MEASURED rather than argued. That file carries THREE copies of one
// registration guard — Part 1's, then `2/JOB-05`, then this one — each
// dominated by the one before it. For the third to be the FIRST failure, Part 2
// must PASS (so cron.job.command was non-NULL when it read) while Part 3 reads
// NULL, which needs cron.job to change between two reads separated only by a
// transaction Part 2 rolls back. Two routes were driven on real lanes and both
// failed in ways worth recording: suppressing `2/JOB-05` with `neuter` does not
// work because it is Part 2's PRECONDITION rather than a duplicate raise (the
// lane then exits 3 on `22004: query string argument of EXECUTE is null`, which
// names no arm), and a cron body that unschedules ITSELF does not work because
// the unschedule is transactional (Part 3 reads the row back and dies on
// `XX000: could not find valid entry for job`). Adding a `RETURN` after Part 2's
// RAISE to fix the control flow is refused by this runner itself, deliberately
// (`neuterArm` will not neuter a branch carrying a statement after its RAISE).
// ⛔ SO THE CEILING WAS LEFT AT 0. Raising it to 1 and restructuring the gate's
// three-deep guard are both founder calls (164.4.1-CONTEXT decision 3: "a plan
// that needs a waiver is a plan that needs a checkpoint"), and neither is this
// plan's to make. Cumulative waivers across the phase family's TEN arms moves:
// 1, all of it here. The measurement lines above stay as lineage.
//
// ⛔ CURRENCY 2026-09-05 (plan 164.4.1-04, the third file move): STILL 0, the
// value is STILL UNEDITED, and the breach the block above records is GONE. The
// run reports `arms: 324/324/0` and NO `floor` defect. The founder call the
// plan-03 block escalated was answered by commit fcbc0159 with a THIRD option
// neither side of the question offered: `3/JOB-05` was RECLASSIFIED — its
// `TEST FAILED (` identity was removed, so an unfalsifiable raise stops
// claiming to be a falsifiable assertion and is not a section at all — rather
// than waived or deleted. Nothing was loosened.
// ⭐ THIS PLAN MET THE SAME SHAPE AGAIN and took the same route, which is what
// makes it a precedent rather than a one-off. Section `3` of
// supabase/tests/test_strategy_analytics_stuck_computing_reaper.sql is the
// third copy of that file's registration guard, dominated by Part 1b's
// `1/JOB-02` and then by Part 2's `2`. Both escape routes were driven on real
// lanes on 2026-09-05 and both failed, in the SAME two ways the retention gate
// did: unschedule post-apply with the dominators neutered leaves Part 2 dying
// at its EXECUTE on `22004: query string argument of EXECUTE is null`
// (CONTEXT: inline_code_block line 103 at EXECUTE), and a self-unscheduling
// cron body leaves Parts 1a/1b/2 all printing OK while Part 3's SECOND tick
// dies on `XX000: could not find valid entry for job
// 'reap_strategy_analytics_stuck_computing'`. Neither error carries a
// `TEST FAILED (…)`. The guard was reclassified in place, with the measurement
// written beside it. Cumulative waivers across the phase family's ELEVEN arms
// moves: ZERO, through THREE root-cause fixes (a REORDER, an exception-idiom
// wrap, and now twice a reclassification) and no exception. The measurement
// lines above stay as lineage.
// ⭐ CURRENCY 2026-09-05 (plan 164.4.1-05, the LAST arms move of this phase).
// Still 0, and this time WITHOUT a reclassification: all THIRTY-NINE sections of
// supabase/tests/test_reconcile_dropped_enqueue_sweep.sql bit their own arm
// first on the FIRST proof run (`arms: 39/39/0`, `biting: 39`). Five of them
// needed a GATE-FILE falsifier rather than a production one — the three `IS
// NULL` oracle preconditions, the Part 3 seed-integrity control and the
// whole-block invariant — and each carries the measurement showing WHY no
// production mutation can reach it ahead of its dominator. ⛔ A gate-file
// falsifier is not a waiver and must not be read as one: the arm still RAISES,
// still names itself FIRST, and is still counted in `biting`. Cumulative waivers
// across the phase family's FIFTEEN arms moves: ZERO.
export const WAIVED_CEILING = 0;
