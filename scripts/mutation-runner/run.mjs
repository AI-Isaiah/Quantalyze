#!/usr/bin/env node
/**
 * RED-UNDER mutation runner (VAC-01, phase 164.3 plan 05).
 *
 * ============================================================================
 * CLI CONTRACT — ci.yml pastes this VERBATIM (plan 164.3-08).
 * ============================================================================
 *
 *   node scripts/mutation-runner/run.mjs                    # full corpus: supabase/tests/
 *   node scripts/mutation-runner/run.mjs --fixture-corpus   # the synthetic corpus
 *   node scripts/mutation-runner/run.mjs --self-test        # prove the exit-1 modes fire
 *   node scripts/mutation-runner/run.mjs --parse-only       # STATIC only — runs ZERO arms
 *   node scripts/mutation-runner/run.mjs --file <gate.sql>  # DIAGNOSTIC (never exits 0)
 *   node scripts/mutation-runner/run.mjs --arm "<ARM ID>"   # DIAGNOSTIC (never exits 0)
 *
 * Exit codes:
 *   0  full gate run, no defects, floors held, the runner's own counts agree
 *   1  at least one defect, a coverage floor regression, or an ABSURDITY — the
 *      runner's two independent arm tallies disagree (164.3.1-10, D-09)
 *   2  NARROWED DIAGNOSTIC RUN that found no defects. Deliberately NOT 0: a run
 *      that executed a subset of arms must never be mistakable for a passing
 *      gate. That mistake — a partial check reading as a full PASS — is
 *      SKIP-01's shape and is on this phase's own defect list.
 *   3  usage or environment error
 *
 * ⚠️ Local and CI invocations must be byte-identical in MODE. A wrapper that
 * changes the invocation changes the result.
 *
 * ============================================================================
 * WHAT DEFECT CLASS THIS EXISTS FOR
 * ============================================================================
 * Every one of the five vacuity mechanisms this phase catalogues was GREEN in
 * CI. A gate arm that cannot fail is indistinguishable from a passing one by
 * every signal a reviewer reads, so the only way to know an arm can fail is to
 * BREAK the thing it guards and watch it fail. This runner does that on every
 * push, for every annotated arm.
 *
 * Per arm: copy the corpus into scratch, apply the annotation's mutation TO THE
 * COPIES, run the lane, and require BOTH that the gate went red AND that the
 * FIRST `TEST FAILED (…)` names the annotated arm. Red-anywhere is not success
 * — "the file went red" is satisfied by a mutation that breaks something else
 * entirely, which would be a vacuous check inside the vacuity detector. That
 * first-failure discipline is also the only detector for mechanism 5 (an arm
 * made structurally unreachable by an earlier arm), which is not statically
 * decidable (D-16).
 *
 * ============================================================================
 * FOUR INVARIANTS, EACH BOUGHT BY A MEASURED FAILURE
 * ============================================================================
 *
 * 1. THE CHECKOUT IS NEVER MUTATED. Every mutation lands on a copy in a scratch
 *    dir. This eliminates the stale-byte-backup class and the shared-git-index
 *    race BY CONSTRUCTION rather than by discipline, and the run asserts
 *    `git status --porcelain` is clean before it exits.
 *
 * 2. "COULD NOT MEASURE" IS NEVER "MEASURED ZERO PROBLEMS". Every byte-edit
 *    carries a required, measured `occurrences`; a mismatch is the distinct
 *    defect kind `occurrence-mismatch` (MEASURE_FAIL) and the mutation is NOT
 *    applied. Plan 164.3-01 hit this on the first real arm: SHAPE 1c's prose
 *    locator `generation BIGINT` matches exactly once in the migration and it
 *    is the WRONG occurrence (line 828's `RETURNS TABLE`, not the CREATE TABLE
 *    at line 170, which carries two spaces). Mutating it aborts the apply, so
 *    the gate never runs. A runner without this assertion would have reported a
 *    FALSE `no-red` defect against a perfectly good arm — or mutated something
 *    else and read the resulting red as SUCCESS.
 *
 * 3. ALL ARMS RUN BEFORE ANYTHING IS REPORTED (OPS-08-F8). The runner never
 *    stops at the first failing arm. First-failure identity is asserted WITHIN
 *    an arm's run; aggregation happens ACROSS arms.
 *
 * 4. BOTH FAILURE MODES HARD-FAIL WITH EXIT 1 (D-09). A non-biting annotation
 *    and a coverage-floor regression are errors, not warnings. Branch
 *    protection is deliberately off in this repo, so a non-zero exit is the
 *    only signal that exists; softening it reproduces the status quo the phase
 *    exists to change.
 *
 * Reads files with node:fs, never shell grep (grep is silently NUL-blind here).
 * The annotation schema is documented in GRAMMAR.md.
 */
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import {
  BRANCH_HEAD_KEYWORDS,
  IDENTITY_CARRIER,
  RAISE_EXCEPTION_RE,
  maskNonCode,
  parseAnnotations,
  scanCorpus,
  tokenizeStatements,
} from "./parse.mjs";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const LANE = join(REPO_ROOT, "scripts", "pg-lane", "run.sh");
const DEFAULT_CORPUS = join(REPO_ROOT, "supabase", "tests");
const FIXTURE_CORPUS = join(REPO_ROOT, "scripts", "mutation-runner", "fixtures");

// 164.4-03 — the lane probe. `run_lane` refuses a lane with no `--apply` file,
// so the probe reuses the EXISTING core fixture rather than adding a stand-in
// nobody else applies; the gate is a two-line `DO $$` block whose only job is
// to print one marker. The markers are read off the lane's combined output, so
// they are spelled ONCE, here, and imported by nothing that re-derives them.
const LANE_PROBE_APPLY = join(REPO_ROOT, "scripts", "pg-lane", "fixtures", "01-fixture-core.sql");
const LANE_PROBE_GATE = join(FIXTURE_CORPUS, "lane-probe", "pg-cron-probe.sql");
const LANE_PROBE_AVAILABLE = "LANE-PROBE: pg_cron AVAILABLE";
const LANE_PROBE_ABSENT = "LANE-PROBE: pg_cron absent";
// The two shapes a REAL lane prints, DERIVED from the markers above rather than
// retyped, so a `--self-test` stub cannot answer with a string the production
// reader would reject (or, worse, keep answering one the reader stopped
// accepting). `psql -v VERBOSITY=verbose` streams both channels to stderr,
// which `runLane` concatenates ahead of stdout.
const PROBE_ABSENT_OUTPUT = `NOTICE:  ${LANE_PROBE_ABSENT}`;
const PROBE_AVAILABLE_OUTPUT = `ERROR:  ${LANE_PROBE_AVAILABLE}`;

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
// CURRENCY, stated where the VALUE is: RE-DERIVED 2026-09-04 by measurement
// (plan 164.4-11). Measured coverage 39 of 71 — value RAISED from 32, and this
// is the END STATE of Phase 164.4: every idiom gate file the pg-lane can reach
// is annotated and proven. The remaining 32 of the 71 are NOT silently dropped
// — the runner prints all of them by name on every run: 27 `unreachable:` (they
// raise outside the identity idiom; out of scope by founder decision, TODOS
// [REDUNDER-NONIDIOM]), 4 `lane-blocked:` (they probe pg_extension for pg_cron,
// which this lane cannot host, TODOS [REDUNDER-PGCRON]), and exactly ONE
// `pending:` — test_compute_jobs_error_kind_copy_parity.sql, which needs
// migration 20260826140000 and is owed to Phase 164.4.1 PGCRON-LANE by founder
// decision in plan 09. ⚠️ 39, NOT the 40 of SCOPE AMENDMENT #2: that amendment
// predates the deferral.
export const FILES_FLOOR = 39;

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
// CURRENCY, stated where the VALUE is — derivation, sample size, coverage and
// separation in the block immediately above; record in 164.4-11-SUMMARY.md:
// RE-DERIVED 2026-09-04 by measurement (plan 164.4-11).
// Measured biting 262 — value RAISED from 247. This is Phase 164.4's END STATE
// on today's lane; the next move is Phase 164.4.1 PGCRON-LANE, which unblocks
// the five pg_cron files.
export const ARMS_FLOOR = 262;

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
export const WAIVED_CEILING = 0;

/**
 * Every defect this runner can report. EXPORTED (SP-C02) so the CI-wiring test
 * can range over it rather than restating it: a new kind added here without a
 * `--self-test` scenario, or without a place on the reviewed
 * not-covered-by-the-self-test list, fails by name in
 * src/__tests__/mutation-runner-floors.test.ts. A list restated in a test is a
 * second thing to drift; a list the implementation owns is not.
 */
export const DEFECT_KINDS = [
  "parse",
  "parity",
  "bad-file-ref",
  "occurrence-mismatch",
  "no-red",
  "wrong-first-failure",
  "neuter-missed",
  "identity-rewrite",
  "synthesised-identity",
  "baseline",
  "restore",
  "dirty-checkout",
  "floor",
  // 164.3.1-10: the runner's OWN counts disagree (see absurdityViolations).
  // A GATE defect, not a corpus finding — kept distinct from `floor` so the
  // defect table and the CI count-recheck step can tell "the corpus regressed"
  // from "the instrument is broken" by name.
  "absurdity",
  // 2026-09-03 (164.4-03): the lane CAN host pg_cron while idiom files are
  // still classified `lane-blocked`. A GATE defect, like `absurdity` and for
  // the same reason: the deferral's stated cause has expired, so the printed
  // reason is no longer true and 100 sections would otherwise stay parked
  // behind a line nothing measures. Never in NON_BITING_DEFECT_KINDS — it is a
  // finding about the corpus's scope, not a verdict on any arm.
  "lane-blocked-stale",
  // 2026-09-02: the lane process could not be run (ENOENT / ENOBUFS / a
  // signal — see `laneSpawnFailure`). A MEASURE_FAIL: the arm was NOT judged,
  // and it is never counted as biting. Kept distinct from `absurdity` (the
  // tallies still agree) and from `wrong-first-failure` (which it used to
  // masquerade as).
  "lane-unrunnable",
];

// ---------------------------------------------------------------------------
// Byte-exact mutation primitives. Every one of them refuses to guess.
// ---------------------------------------------------------------------------

/** Non-overlapping occurrence count of a literal needle. */
export function countOccurrences(haystack, needle) {
  if (needle.length === 0) throw new Error("countOccurrences: empty needle");
  let count = 0;
  let from = 0;
  for (;;) {
    const at = haystack.indexOf(needle, from);
    if (at === -1) return count;
    count += 1;
    from = at + needle.length;
  }
}

/** Index of the nth (1-based) non-overlapping occurrence, or -1. */
function indexOfNth(haystack, needle, nth) {
  let from = 0;
  for (let i = 0; i < nth; i += 1) {
    const at = haystack.indexOf(needle, from);
    if (at === -1) return -1;
    if (i === nth - 1) return at;
    from = at + needle.length;
  }
  return -1;
}

/**
 * Apply one `edit`/`insert-after` step to file text.
 *
 * Returns `{ ok: true, text }`, or `{ ok: false, actual }` when the measured
 * occurrence count disagrees with the annotation. The caller turns that into
 * `occurrence-mismatch`, NEVER into `no-red` — see invariant 2 in the header.
 */
export function applyFileStep(text, step) {
  const needle = step.kind === "edit" ? step.find : step.anchor;
  const actual = countOccurrences(text, needle);
  if (actual !== step.occurrences) return { ok: false, actual };

  const at = indexOfNth(text, needle, step.nth);
  // Unreachable given the count matched and nth <= occurrences (the parser
  // enforces that), but an absent measurement must never read as a pass.
  if (at === -1) return { ok: false, actual };

  if (step.kind === "edit") {
    return { ok: true, text: text.slice(0, at) + step.replace + text.slice(at + needle.length) };
  }
  const end = at + needle.length;
  return { ok: true, text: text.slice(0, end) + step.text + text.slice(end) };
}

/**
 * The ONLY abort-path statement the neuter absorbs along with the RAISE.
 * Exported so a test can assert the set is exactly this, and so widening it is
 * a visible, reviewed edit rather than a regex tweak inside a loop.
 */
export const ABSORBABLE_CLEANUP = /^[ \t]*RESET[ \t]+ROLE[ \t]*;[ \t]*$/i;

/**
 * The branch-head keywords, exported so the cross-product oracle in
 * `mutation-runner-neuter.test.ts` can GENERATE its inputs from this list
 * rather than hand-listing spellings. Adding a keyword here automatically
 * widens that test's input space.
 *
 * ⭐ ONE DEFINITION (phase 164.3.1, Primitive A). The list is the TOKENIZER's
 * own, re-exported rather than restated: a list restated in a second file is a
 * second thing to drift.
 */
export const BRANCH_HEAD_WORDS = BRANCH_HEAD_KEYWORDS;

/**
 * The masking projection of SQL source: every non-code region blanked, offsets
 * and line numbers preserved, so a keyword can only be read where PostgreSQL
 * would read one.
 *
 * ⛔ R3-C01, and the reason this is a classifier rather than another needle.
 * Rounds 1 and 2 each closed the ONE spelling the reviewer demonstrated — a
 * whole-line `--` comment — and each declared the class closed. Round 3
 * reached the identical `SET ROLE` leak with three more spellings in minutes:
 * a keyword inside a single-quoted literal (`PERFORM run_sql('BEGIN');`),
 * inside a slash-star block comment reading "we then raise the exception",
 * and inside a dollar-quoted body (`EXECUTE $q$ DECLARE junk int; $q$;`).
 * Enumerating a fourth spelling is a guaranteed fourth failure, so the rule is
 * stated over the STRUCTURE of the source instead: remove everything that is
 * not code, then ask what remains.
 *
 * ⭐ SUPERSEDED IMPLEMENTATION, phase 164.3.1 (the measured history is kept, not
 * deleted). This used to be a four-regex pipeline applied ONE LINE AT A TIME,
 * with the honest scope note that a literal, block comment or dollar-quoted
 * body SPANNING lines was masked only where both delimiters appeared. That
 * line-locality is exactly what [MUT-I01] and [R4-C01] were made of, so the
 * masking is now a projection of the STATEMENT TOKENIZER's state
 * (`maskNonCode` in parse.mjs), which carries `'…'`, `"…"`, `$tag$…$tag$`,
 * `/* *\/` (nesting) and `--` ACROSS lines. There is exactly one state machine
 * in this codebase that decides what is code, and this is a view of it.
 */
export const executableText = (source) => maskNonCode(source);

/**
 * TRUE when a STATEMENT is a branch head, not when it merely MENTIONS one.
 *
 * ⛔ SUPERSEDED PREDICATE AND ITS SUPERSEDED MEASUREMENT, phase 164.3.1 — kept
 * because the history is the argument, not decoration.
 *
 * The first version was `\b(THEN|BEGIN|ELSE|…)\b` anywhere in the LINE, which
 * every non-code embedding bypassed. The second was structural but still a LINE
 * predicate, with two UNANCHORED arms:
 *
 *     /^EXCEPTION(\s+WHEN\b.*)?$/i     ← `.*` swallows trailing STATEMENTS
 *     /\b(THEN|LOOP)$/i                ← no start anchor
 *
 * Its measurement — "MEASURED 2026-08-29 against the real gate file, all 104
 * arm identities / 103 backward scans: 0 disagreements" — was true and did not
 * save it, because the disagreements it could not have found are on lines the
 * gate file does not contain: `EXCEPTION WHEN OTHERS THEN v_raised := true;
 * END;` exists SEVEN times in test_profiles_privileged_columns_locked.sql, and
 * `SET ROLE postgres; IF NOT ok THEN` is the ROADMAP's own [R4-C01] spelling.
 * Both were accepted WHOLE, so the backward scan terminated on them and every
 * statement sharing their line stayed live — a superuser session handed to
 * every later arm, silently. A measurement over one file's shapes is not a
 * measurement over the class.
 *
 * So the question is no longer asked of a LINE at all. `tokenizeStatements`
 * decomposes a compound line into its statements and marks the branch-head
 * UNITS among them; this predicate reads that mark. The unanchored arms cannot
 * be re-opened because there are no arms — the head ends where its keyword
 * ends, and the statements that follow it on the same line are separate units
 * the scan must classify on their own.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * RE-MEASURED 2026-09-01 (phase 164.3.1 plan 01 task 3), R3-C01 discipline.
 * ═══════════════════════════════════════════════════════════════════════════
 * SAMPLE: `supabase/tests/test_strategy_shares_rls.sql`, which AT THAT DATE was
 * the only annotated file in the corpus (1 of 71). Phase 164.4 has since raised
 * that count — read the live value off FILES_FLOOR, not off this sentence.
 * SAMPLE SIZE: 104 `TEST FAILED (` occurrences, 104 distinct identities, 103
 * backward scans performed (the 104th identity is the header's own syntax
 * documentation and carries no raise, so no scan runs for it).
 * COVERAGE: 103 of 103 scans compared, statement predicate vs the DELETED line
 * predicate transcribed verbatim from HEAD `e0660031` as an INDEPENDENT
 * instrument.
 * RESULT: 103 agreements, 0 disagreements. Refusals: 4 under BOTH predicates,
 * the same four arms — SERVICE-ROLE 2a/2b/2c/2d, whose branches each `EXECUTE
 * 'REVOKE EXECUTE ON FUNCTION public.create_strategy_share(UUID) FROM
 * service_role'` before raising (lines 2249 / 2254 / 2268 / 2273). Each refusal
 * is LOUD and names its statement. ZERO refusals were added by this change.
 *
 * ⚠️ WHAT THIS MEASUREMENT DOES AND DOES NOT BOUND, because the previous one at
 * this spot was true and did not save the predicate: it bounds NON-REGRESSION
 * on the shapes THIS ONE FILE contains. It says nothing about shapes it does
 * not contain — and the compound line that broke the old predicate lives in a
 * DIFFERENT file (`test_profiles_privileged_columns_locked.sql`, seven times).
 * The class is closed by CONSTRUCTION above, not by this number; the number
 * only proves the construction refuses nothing the corpus already relies on.
 * ⚠️ CURRENCY 2026-09-04 (plan 164.4-11): Phase 164.4's backfill is COMPLETE
 * at 39 of 71 files, and it annotated `test_profiles_privileged_columns_
 * locked.sql` WITHOUT neutering any of those seven compound heads — the twin
 * there is on the file's FIRST assertion, which needs no neuter. The
 * tokenizer's refusal has still never been relaxed.
 */
export const isBranchHead = (statement) => statement != null && statement.head === true;

// ⭐ `RAISE_EXCEPTION_RE` used to be declared here. It is IMPORTED from
// `parse.mjs` since 2026-09-02, because `scanCorpus` needs the identical notion
// of "an executable raise" to classify the unannotated corpus. One definition,
// two readers — never a second spelling.

/**
 * The index of the previous SIBLING statement — same nesting depth, same
 * enclosing body — or -1 at the top of the block.
 *
 * `tokenizeStatements` emits pre-order, so a preceding sibling's own nested
 * statements sit between it and `idx` and are skipped; a shallower statement
 * means the walk has reached the head of the enclosing body and must stop
 * rather than wander into the block before it.
 */
function prevSiblingIndex(statements, idx, depth) {
  for (let k = idx - 1; k >= 0; k -= 1) {
    if (statements[k].depth < depth) return -1;
    if (statements[k].depth === depth) return k;
  }
  return -1;
}

/**
 * Indices of the statements that carry `needle` and enclose no nested statement
 * that also carries it — i.e. the RAISE itself, never the `DO $$ … $$;` block
 * around it. Diagnostics and neuter ranges must name the innermost unit; a
 * container would name the whole file.
 */
function innermostCarriers(statements, needle) {
  const out = [];
  for (let i = 0; i < statements.length; i += 1) {
    if (!statements[i].text.includes(needle)) continue;
    let nested = false;
    for (let j = i + 1; j < statements.length && statements[j].depth > statements[i].depth; j += 1) {
      if (statements[j].text.includes(needle)) {
        nested = true;
        break;
      }
    }
    if (!nested) out.push(i);
  }
  return out;
}

/**
 * The statement that RAISES `needle`, or null.
 *
 * Requires the carrier to match `RAISE EXCEPTION` in its MASKING PROJECTION, so
 * neither a mention inside a literal nor a commented-out (already neutered)
 * raise qualifies — a comment is not part of any statement, so it cannot be
 * one. This also narrows a real defect in the reader it replaces: that one
 * walked back over the WHOLE file for any line matching `RAISE EXCEPTION`, so a
 * bare `TEST FAILED (` literal produced a branch anchored on an unrelated raise
 * hundreds of lines earlier. A `TEST FAILED (` that is not raised is refused at
 * parse time by GRAMMAR rule 3a and at runtime by source-location attribution
 * (3c — `attributeIdentities`; the identity nonce until 2026-09-01) — the two
 * places it is decidable.
 */
function raiseStatementIndex(statements, needle) {
  for (const i of innermostCarriers(statements, needle)) {
    if (RAISE_EXCEPTION_RE.test(statements[i].executableText)) return i;
  }
  return -1;
}

/**
 * Text flattened to ONE bounded line, for a diagnostic that must PRINT WHAT IT
 * SAW (D-12) without printing a novel. Takes a statement (its `.text`) or a
 * plain string — the one flattener every diagnostic in this file uses.
 */
function oneLine(subject) {
  const text = typeof subject === "string" ? subject : subject.text;
  const flat = text.trim().replace(/\s*\n\s*/g, " ");
  return flat.length > 200 ? `${flat.slice(0, 200)}…` : flat;
}

/**
 * Replace an arm's `RAISE EXCEPTION 'TEST FAILED (<arm>)…'` with a no-op in a
 * COPY of the gate file, so a shadowing arm cannot fire first.
 *
 * `NULL;` is substituted rather than deleting the statement, so an `IF … THEN`
 * whose only statement was the RAISE keeps a non-empty body.
 *
 * ⛔ THE FAILURE BRANCH'S TRAILING `RESET ROLE;` GOES WITH IT, AND THAT IS A
 * CORRECTNESS REQUIREMENT, NOT TIDYING. MEASURED 2026-08-29 while annotating
 * the real corpus (plan 164.3-08): `N1 3a`'s mutation neuters `N1 1a`, whose
 * failure branch reads
 *
 *     IF NOT raised OR err_msg NOT LIKE '%AT MOST ONE%' THEN
 *       RESET ROLE;
 *       RAISE EXCEPTION 'TEST FAILED (N1 1a): …';
 *     END IF;
 *
 * Neutering only the RAISE left `RESET ROLE;` executing — and the branch DOES
 * execute under that mutation, which is the whole reason the arm is neutered.
 * The session dropped from `authenticated` to the (superuser) session role for
 * the ENTIRE REST OF THE FILE, and sixteen arms later `NO-DELETE 1`'s
 * `DELETE FROM strategy_shares` succeeded because a superuser needs no grant.
 * The runner reported `wrong-first-failure: NO-DELETE 1`.
 *
 * ⚠️ It was loud HERE only by luck. A leaked superuser role makes every
 * downstream GRANT arm pass for a reason unrelated to the grant — a silent
 * vacuous PASS inside the vacuity detector, and the exact defect class Phase
 * 164.4 would inherit across seventy more files.
 *
 * The reasoning that makes this the RIGHT semantics rather than a patch: those
 * statements exist solely to restore state before ABORTING the file. Once the
 * arm is neutered the file continues, so running its abort-path cleanup is
 * wrong by construction. Only an exact `RESET ROLE;` is absorbed — nothing
 * else, so a branch that does real work is never silently swallowed.
 *
 * ⛔ WR-07 SCOPE — BOTH SIDES OF THE RAISE. The refusal below (an abort branch
 * carrying a statement the neuter cannot classify) is applied to the statements
 * BEFORE the RAISE and, since 2026-09-02, to the statements AFTER it up to the
 * branch's closer. The post-RAISE side is the same leak class from the other
 * direction: in the ORIGINAL file nothing after a `RAISE EXCEPTION` in its
 * branch ever executes, so `IF NOT ok THEN RAISE …; SET ROLE postgres; END IF;`
 * is dead code — until the RAISE is neutered, at which point `SET ROLE
 * postgres;` runs for the rest of the file with no signal. The neuter refuses
 * that shape, naming the statement, rather than leaving it live (the previous
 * behaviour) or silently commenting it out (a rewrite nobody asked for).
 */
export function neuterArm(text, arm) {
  const lines = text.split("\n");
  const needle = `${IDENTITY_CARRIER}${arm})`;
  const statements = tokenizeStatements(text);

  const raiseIdx = raiseStatementIndex(statements, needle);
  if (raiseIdx === -1) {
    const carried = statements.some((s) => s.text.includes(needle));
    return {
      text,
      found: false,
      reason: carried
        ? `no RAISE EXCEPTION precedes "${needle}"`
        : `no statement contains "${needle}"`,
    };
  }
  const raiseStmt = statements[raiseIdx];

  // Absorb the abort-path cleanup that immediately precedes the RAISE. See the
  // header: leaving `RESET ROLE;` behind leaks a superuser session into every
  // later arm. The forward scan below still starts at the RAISE — starting it
  // here would terminate on `RESET ROLE;`'s own semicolon and leave the RAISE
  // live, which is a neuter that silently did nothing.
  //
  // ⭐ Absorption is now asked of a STATEMENT, so `IF NOT ok THEN RESET ROLE;
  // RAISE …;` on ONE line absorbs correctly — the old line walk started at the
  // line BEFORE the RAISE's and could not see a cleanup sharing its line.
  let startIdx = raiseIdx;
  for (;;) {
    const p = prevSiblingIndex(statements, startIdx, raiseStmt.depth);
    if (p === -1 || !ABSORBABLE_CLEANUP.test(statements[p].text)) break;
    startIdx = p;
  }

  // ── WR-07: refuse what we cannot classify, instead of leaking it ──────────
  // The absorbed set is ONE literal statement, and the header is explicit that
  // the `RESET ROLE;` leak "was loud HERE only by luck". An abort branch that
  // reads `RESET search_path;`, `SET ROLE postgres;`, `PERFORM set_config(…)`
  // or `ROLLBACK TO SAVEPOINT s;` before its RAISE produces the identical
  // class of silent state leak into every later arm, and the old code left it
  // live with no signal at all. Phase 164.4 backfills ~70 files against this
  // primitive, which is where the luck runs out.
  //
  // So: walk from the absorb point back to the head of the enclosing branch
  // and refuse anything that is not blank, not a comment, and not absorbable.
  // A refusal surfaces as a `neuter-missed` defect — loud, named, and fixable
  // by extending the absorbable set DELIBERATELY — which is strictly better
  // than a leak that makes downstream arms pass for the wrong reason.
  //
  // MEASURED 2026-08-29 against the real corpus: all 30 arms still execute and
  // bite, so this refuses nothing that exists today.
  // RE-MEASURED 2026-09-01 under the statement predicate (sample size and
  // coverage in the `isBranchHead` block above): 103 of 103 backward scans
  // agree with the deleted line predicate, 0 disagreements, the same 4 loud
  // refusals, 0 added. Full corpus run unchanged at arms 30/30/0, biting 30.
  // ⛔ ORDER IS LOAD-BEARING (R2-C01). Classify FIRST, terminate LAST, and
  // terminate only on a unit that IS a branch head (R3-C01), never on one that
  // merely MENTIONS a branch-head keyword. Round 1 fixed the loop ORDER; round
  // 2 added `--` stripping; round 3 still reached the leak through a string
  // literal, a block comment and a dollar-quoted body, because the predicate
  // was a bare word match; round 4 ([R4-C01]) reached it through a COMPOUND
  // LINE, because the predicate — structural by then — was still asked of a
  // LINE, and a line carrying a head plus two more statements answered "yes".
  //
  // ⭐ The walk is now over STATEMENTS at the RAISE's own nesting depth. That
  // closes the compound-line direction BY CONSTRUCTION rather than by a fifth
  // spelling rule: `EXCEPTION WHEN OTHERS THEN v_raised := true; END;`
  // decomposes into a head and two statements, so the statements are seen and
  // classified instead of being swallowed by the head's regex; and
  // `SET ROLE postgres; IF NOT ok THEN` decomposes so the privileged statement
  // is classified instead of hiding behind the head that follows it.
  //
  // Comments and blank regions need no special case any more: the tokenizer
  // never emits them as statements, so there is nothing to skip. That deletes
  // the line-local `IGNORABLE_LINE` predicate rather than keeping an
  // unreachable branch around it.
  //
  // THE RULE, stated once and implemented exactly: walking back from the absorb
  // point, every STATEMENT must be ignorable (the tokenizer emits none),
  // absorbable (ABSORBABLE_CLEANUP), or a branch head that terminates the walk.
  // Any other statement — INCLUDING ONE SHARING A LINE WITH THE HEAD, ON EITHER
  // SIDE OF IT — is refused, naming the statement and its line.
  //
  // Both sides matter and for the same reason. A statement AFTER the head on
  // its line is inside the branch and is reached by the walk normally. A
  // statement BEFORE the head on its line is [R4-C01]'s own spelling —
  // `SET ROLE postgres; IF NOT ok THEN` — and it is refused because the
  // branch's boundary and the LINE's boundary disagree there. Every one of the
  // four rounds of this defect was a boundary disagreement read as agreement,
  // and this rewrite is line-oriented: it comments whole lines, splices `NULL;`
  // at a line's indent, and addresses every diagnostic by line. Accepting a
  // head whose line begins with something else means trusting a coincidence.
  // Refusing is the loud direction, and the real corpus contains no such head
  // (re-measured — see the block above).
  const refuse = (stmt) => ({
    text,
    found: false,
    reason:
      `the abort branch for "${arm}" carries an unrecognised statement before its RAISE ` +
      `(line ${stmt.startLine}: ${oneLine(stmt)}). Neutering only the RAISE would leave that ` +
      `statement executing for the rest of the file — the measured RESET ROLE class, where a ` +
      `leaked superuser session made sixteen later arms pass for a reason unrelated to their ` +
      `grants. Extend ABSORBABLE_CLEANUP deliberately, or restructure the branch.`,
  });

  for (
    let k = prevSiblingIndex(statements, startIdx, raiseStmt.depth);
    k !== -1;
    k = prevSiblingIndex(statements, k, raiseStmt.depth)
  ) {
    const stmt = statements[k];
    if (stmt.executableText.trim() === "") continue;
    if (isBranchHead(stmt)) {
      const shares = prevSiblingIndex(statements, k, stmt.depth);
      if (shares !== -1 && statements[shares].endLine === stmt.startLine) {
        return refuse(statements[shares]);
      }
      break; // structurally a branch head, and it begins its own line
    }
    return refuse(stmt);
  }

  // ── [MUT-I01]: where the RAISE ENDS ──────────────────────────────────────
  //
  // ⛔ THE DELETED READER AND WHY IT WAS DELETED RATHER THAN REPAIRED. This
  // used to be a raw character walk from the RAISE's line, tracking ONE
  // character — `'`, with the `''` escape — and nothing else. An apostrophe
  // inside a `--` comment inside the RAISE's own span therefore flipped its
  // parity, and the two parities failed DIFFERENTLY:
  //
  //   ODD  — the real terminator was swallowed, no `;` was ever found, and a
  //          perfectly legal arm was refused as `neuter-missed`. Loud, false.
  //   EVEN — parity was restored by a second apostrophe AFTER the real
  //          terminator had been swallowed, so the walk ran on and ended on a
  //          LATER statement's `;`. The neuter then commented out a statement
  //          that had to survive, and reported success. SILENT.
  //
  // A repaired walk would have to know comments, which means knowing literals,
  // dollar quotes and block comments — that is the tokenizer. So the end of the
  // RAISE is simply the end of the RAISE's STATEMENT, and the duplicate walker
  // is gone. `terminated: false` (a statement running to EOF with no `;`) keeps
  // the one refusal that was always real: an unterminated statement is a
  // MEASURE failure, not a shorter statement.
  if (!raiseStmt.terminated) {
    return { text, found: false, reason: `could not find the end of the RAISE statement for "${arm}"` };
  }

  // ── WR-07, the OTHER side: nothing may sit between the RAISE and its closer ─
  // In the original file a statement after the RAISE in its own branch never
  // executes — the RAISE aborts first. Neuter the RAISE and it does, for the
  // rest of the file, with no signal: `IF NOT ok THEN RAISE …; SET ROLE
  // postgres; END IF;` is the RESET ROLE class reached from behind. The walk
  // forward stops at the branch's closer (`END IF;`, `END LOOP;`, `END;`), at
  // the next branch head (`ELSE`, `ELSIF …`, `EXCEPTION …`) or at the end of
  // the enclosing body, and refuses anything else it meets. The tokenizer
  // emits no comments or blanks, so there is nothing to skip.
  for (let k = raiseIdx + 1; k < statements.length; k += 1) {
    const stmt = statements[k];
    if (stmt.depth > raiseStmt.depth) continue; // nested inside the RAISE's own dollar-quoted text
    if (stmt.depth < raiseStmt.depth) break; // the enclosing body ended
    if (stmt.executableText.trim() === "") continue;
    if (blockCloserKind(stmt) !== null || isBranchHead(stmt)) break;
    return {
      text,
      found: false,
      reason:
        `the abort branch for "${arm}" carries an unrecognised statement after its RAISE ` +
        `(line ${stmt.startLine}: ${oneLine(stmt)}). In the original file that statement is ` +
        `unreachable — the RAISE aborts first — so neutering the RAISE would make it execute ` +
        `for the rest of the file: the measured RESET ROLE class, from the other side. Move it ` +
        `out of the branch, or restructure the branch.`,
    };
  }

  // ── The rewrite ──────────────────────────────────────────────────────────
  //
  // The span is a STATEMENT RANGE, from the first absorbed statement through
  // the RAISE's terminator. The whole-line splice below is correct only when
  // that range aligns to line boundaries — and the real corpus does not oblige:
  // `test_profiles_privileged_columns_locked.sql:97` puts a head, a
  // `RESET ROLE;`, a RAISE and an `END IF;` on ONE line. Commenting that whole
  // line deletes every statement on it, which is P5's silent over-neuter
  // reached by a different road. So a span that starts or ends mid-line is
  // rewritten AROUND: the code before it and after it on those lines is
  // re-emitted verbatim on its own line, and only the span is commented.
  const spanStart = statements[startIdx].start;
  const spanEnd = raiseStmt.end;
  const lineHead = text.lastIndexOf("\n", spanStart - 1) + 1;
  const prefix = text.slice(lineHead, spanStart);
  const tail = text.slice(spanEnd);
  const nl = tail.indexOf("\n");
  const suffix = nl === -1 ? tail : tail.slice(0, nl);
  const rest = tail.slice(suffix.length);

  // "Is there code out here?" is asked of the SAME masking projection every
  // other decision in this file uses — not of a second `^[ \t]*--` predicate.
  // A trailing `--` comment or a `/* … */` therefore goes with the neutered
  // statement, as it always has, without this line owning its own idea of what
  // a comment is. That second idea is how [VAC04-C1]'s composing blind spot is
  // built, and there is exactly one definition of code in this file.
  const startsOnOwnLine = executableText(prefix).trim() === "";
  const endsLine = executableText(suffix).trim() === "";

  if (startsOnOwnLine && endsLine) {
    const start = statements[startIdx].startLine - 1;
    const end = raiseStmt.endLine - 1;
    const indent = (lines[start].match(/^[ \t]*/) || [""])[0];
    const replacement = [
      ...lines.slice(start, end + 1).map((l) => `-- NEUTERED(${arm}) ${l}`),
      `${indent}NULL; -- neutered ${arm} by the mutation runner`,
    ];
    lines.splice(start, end - start + 1, ...replacement);
    return { text: lines.join("\n"), found: true };
  }

  const indent = (prefix.match(/^[ \t]*/) || [""])[0];
  const commented = text
    .slice(spanStart, spanEnd)
    .split("\n")
    .map((l) => `-- NEUTERED(${arm}) ${l}`)
    .join("\n");
  const rewritten =
    text.slice(0, lineHead) +
    (startsOnOwnLine ? "" : `${prefix.replace(/[ \t]+$/, "")}\n`) +
    `${commented}\n` +
    `${indent}NULL; -- neutered ${arm} by the mutation runner` +
    (endsLine ? suffix : `\n${suffix}`) +
    rest;
  return { text: rewritten, found: true };
}

/**
 * `git status --porcelain` as a line array, or null when it could not be run.
 * Null is propagated as a MEASURE_FAIL rather than collapsing to "clean".
 */
function gitStatus() {
  const proc = spawnSync("git", ["status", "--porcelain"], { cwd: REPO_ROOT, encoding: "utf8" });
  if (proc.status !== 0 || typeof proc.stdout !== "string") return null;
  return proc.stdout.split("\n").filter((l) => l.trim().length > 0);
}

// ===========================================================================
// 164.3.1-05 — ARM IDENTITY BY SOURCE LOCATION (supersedes the R3-C02 NONCE)
// ===========================================================================
//
// ⛔ THE DEFECT THIS CLOSES, and why the mechanism it replaces could not.
//
// The runner credits an arm as BITING when the lane's output names that arm.
// Rule 3a refuses an annotation whose injected text contains the literal
// `TEST FAILED (`; SQL concatenates string literals, so the literal never has
// to appear, and substring matching could never win — `format()`, `chr()`,
// `||` and a hundred other spellings produce the same bytes at runtime.
//
// R3-C02 (2026-08-29, SUPERSEDED — kept because it is the measured history
// this design is built on) answered that by stamping a per-run random NONCE
// into every identity in the SCRATCH copy of the gate:
//
//     TEST FAILED (ANON 1a)   ->   TEST FAILED (7f3c9a1e|ANON 1a)
//
// and reading only stamped identities. An annotation could not know the nonce,
// so any `TEST FAILED (` without the stamp was, by construction, text the
// runner did not put in the gate file: `synthesised-identity`.
//
// ⛔ WHY THAT WAS NOT ENOUGH — [R4-C02], MEASURED LIVE. The nonce is a SECRET
// TRANSMITTED TO THE ATTACKER. The stamped text sits in the query text of the
// statement the gate is running, and PostgreSQL hands that text to any
// server-side code that asks for it. An `AFTER INSERT` trigger installed by a
// `sql` step needs no file read and no superuser:
//
//     CREATE FUNCTION forge() RETURNS trigger AS $f$ BEGIN
//       RAISE EXCEPTION '%', substring(current_query() from 'TEST FAILED \([^)]*\)');
//     END $f$ LANGUAGE plpgsql;
//
// MEASURED: an arm whose own raise was guarded by `IF FALSE` scored
// `RED (identity ok)` with `biting: 1`. `biting` is the quantity ARMS_FLOOR
// bounds, so that was a vacuous PASS in the headline number — the same class
// the nonce existed to close, reached THROUGH the nonce.
//
// ⭐ THE REPLACEMENT (CONTEXT D-01, locked): the identity is no longer a
// SECRET that must be kept from the SQL. It is the raise's SOURCE LOCATION,
// which the executing SQL cannot choose. Nothing is transmitted, so
// `current_query()` and `pg_stat_activity` have nothing to read.
//
// The rule is THREE-LEGGED, and all three legs are load-bearing. Measured on
// PostgreSQL 16.13 through the real `pg-lane` with `VERBOSITY=verbose`
// (2026-09-01, this checkout; RESEARCH § The Key Measurement measured the same
// shapes independently):
//
//   (a) the `psql:<file>:<line>:` prefix names the GATE SCRATCH FILE this
//       runner wrote for this lane, at the failing statement's LAST line;
//   (b) the error's CONTEXT chain is EXACTLY ONE frame, of the shape
//       `PL/pgSQL function inline_code_block line N at RAISE`, bounded by the
//       `LOCATION:` sentinel verbose emits;
//   (c) N resolves through the Primitive A tokenizer's statement spans to the
//       arm's recorded raise line:  raise_file_line = DO_start + N − 1.
//
// ⚠️ LEG (b) IS THE ONE THAT IS EASY TO OMIT AND IMPOSSIBLE TO DO WITHOUT.
// Asserting only the INNERMOST frame is forgeable. A trigger that runs
// `EXECUTE 'DO $d$' || repeat(E'\n', k) || 'BEGIN RAISE …; END $d$'` produces
// an `inline_code_block line N at RAISE` frame whose NAME AND LINE are both
// attacker-chosen, under the gate file's own `psql:` prefix — legs (a) and (c)
// both PASS. MEASURED 2026-09-01: with k = 4 the forgery landed on the genuine
// arm's exact resolved line. What the attacker cannot REMOVE is the rest of
// the chain:
//
//     CONTEXT:  PL/pgSQL function inline_code_block line 5 at RAISE   ← forged
//     SQL statement "DO $d$ … END $d$"
//     PL/pgSQL function forge_fn() line 3 at EXECUTE
//     SQL statement "INSERT INTO t VALUES (1)"
//     PL/pgSQL function inline_code_block line 3 at SQL statement
//     LOCATION:  exec_stmt_raise, pl_exec.c:3911
//
// so the chain LENGTH is the control, and `164.3.1-05-ATTRIBUTION.md` records
// it flipping to a false `RED (identity ok)` when neutered to first-frame-only.
//
// ⛔ AND LENGTH ALONE IS NOT ENOUGH EITHER (F1, 164.3.1 adversarial review,
// MEASURED LIVE 2026-09-02 on PG 16 through the real lane). The attacker cannot
// REMOVE frames from the chain, but they can PREPEND text to the MESSAGE, and
// psql prints the message's lines raw. A trigger raising
//
//     E'TEST FAILED (X)\nCONTEXT:  PL/pgSQL function inline_code_block line 5 at RAISE\nLOCATION:  exec_stmt_raise, pl_exec.c:3911'
//
// therefore prints as
//
//     psql:<gate>:9: ERROR:  P0001: TEST FAILED (X)
//     CONTEXT:  PL/pgSQL function inline_code_block line 5 at RAISE   ← message text
//     LOCATION:  exec_stmt_raise, pl_exec.c:3911                      ← message text
//     CONTEXT:  PL/pgSQL function forge_fn() line 1 at RAISE          ← the real chain
//     SQL statement "INSERT INTO t VALUES (1)"
//     PL/pgSQL function inline_code_block line 3 at SQL statement
//     LOCATION:  exec_stmt_raise, pl_exec.c:3911
//
// and a reader that takes the FIRST CONTEXT and the first LOCATION after it
// scores `RED (identity ok)` for an arm whose guard never ran. What the
// attacker cannot do is stop psql from printing the REAL fields after the
// message: libpq emits each of DETAIL / HINT / QUERY / CONTEXT / the five
// verbose-only NAME fields / LOCATION AT MOST ONCE per message, in that FIXED
// order, LOCATION LAST. So `judgeBlock` refuses any block in which a field
// name repeats, or in which LOCATION is not the final field — a forged prefix
// always produces one of the two, because the genuine fields still follow it.
//
// ⚠️ HONEST RESIDUAL, named rather than implied — the boundary MOVED, it did
// not disappear:
//
//   1. A hostile annotation can still make the database print ARBITRARY TEXT.
//      What it can no longer do is make that text ATTRIBUTABLE: every forged
//      raise arrives with a chain it did not choose, so it scores SYNTHESISED
//      or NO-IDENTITY rather than RED. A hostile annotation also remains
//      visibly hostile in review, which is the final control.
//      ⚠️ MEASURED 2026-09-01, and it is the reason the chain rule needed its
//      own dedicated fixture: RESEARCH's forgery recipe is refused TWICE over.
//      It spells the identity inside the EXECUTEd DO string, psql prints that
//      string back as a `SQL statement "…"` CONTEXT frame, and a FIELD-carried
//      identity is unattributable independently of chain length. Neutering the
//      chain rule therefore did NOT flip it — so a "proof" run on that recipe
//      alone would have passed while proving nothing about leg (b). The echo
//      is removable (the trigger can stash the text in a GUC and have the
//      forged DO read it back with current_setting()); the chain is not. The
//      chain-length proof in 164.3.1-05-ATTRIBUTION.md is run against the
//      ECHO-FREE variant for exactly that reason.
//   2. A LEGITIMATE arm whose raise is nested inside `EXECUTE`, a helper
//      function or a trigger is refused NO-IDENTITY — BY DESIGN, LOUDLY. All
//      104 corpus identities raise directly from a DO body (single frame), so
//      the passing control holds corpus-wide; GRAMMAR.md § 3c states this as a
//      164.4 authoring rule so it is a contract rather than a surprise.
//   3. The psql CONTEXT format is MEASURED on macOS / PostgreSQL 16.13 ONLY.
//      The `sql-mutation` CI job has never executed on its ubuntu host at all
//      (WINDOWS.md 28), so this parse rides an already-unobserved host. That
//      residual is INHERITED, not absorbed: `attributeIdentities` reports
//      `measureFail` when the output carries psql-shaped diagnostics it cannot
//      parse into blocks (a changed format, or a localized `FEHLER:`/`KONTEXT:`
//      build), and the runner turns that into a LOUD defect. An unparseable
//      format must never read as "no attributable arm", because that is
//      indistinguishable from a real defect — and never as a pass.

/** psql's per-message header: `psql:<path>:<line>: <SEVERITY>:  <rest>`. */
const PSQL_HEADER_RE =
  /^psql:(.*):(\d+): (ERROR|FATAL|PANIC|WARNING|NOTICE|INFO|LOG|DEBUG):  (.*)$/;

/**
 * A psql diagnostic FIELD line. `LOCATION` is verbose's end-of-block sentinel.
 *
 * The five `… NAME` fields are VERBOSE-ONLY and sit BETWEEN CONTEXT and
 * LOCATION (libpq's fixed emission order). MEASURED 2026-09-02 on PG 16 through
 * the real lane: `RAISE … USING TABLE = 't', SCHEMA = 's', COLUMN = 'c'` prints
 * `SCHEMA NAME:` / `TABLE NAME:` / `COLUMN NAME:` after the CONTEXT frame.
 * Without them here those lines were CONTINUATIONS of the CONTEXT value, so a
 * legitimate single-frame raise carrying a diagnostic name was refused with the
 * WRONG diagnosis ("chain has 4 lines") — a false SYNTHESISED against a
 * genuine arm. `STATEMENT:` is server-log-only and never reaches the client;
 * it is kept so a log-shaped line can never be mistaken for message text.
 */
const PSQL_FIELD_RE =
  /^(CONTEXT|DETAIL|HINT|QUERY|STATEMENT|SCHEMA NAME|TABLE NAME|COLUMN NAME|DATATYPE NAME|CONSTRAINT NAME|LOCATION):  (.*)$/;

/** Anything psql-prefixed at all — used only to tell "no blocks" from "no output". */
const PSQL_PREFIXED_RE = /^psql:.+:\d+: /;

/** `VERBOSITY=verbose` puts the SQLSTATE in front of the message text. */
const VERBOSE_SQLSTATE_RE = /^([0-9A-Z]{5}): ([\s\S]*)$/;

/** The ONE legal CONTEXT chain: a single direct DO-body RAISE frame. */
const SINGLE_DO_FRAME_RE = /^PL\/pgSQL function inline_code_block line (\d+) at RAISE$/;

/** Every `TEST FAILED (<id>)` occurrence, with its identity. */
const IDENTITY_RE = /TEST FAILED \(([^)]*)\)/g;
/**
 * A FRESH regex over the same grammar — the ONE definition (IN-03, 164.3.1
 * review: this file spelled it five times). `matchAll` needs a global
 * instance and `match` a non-global one; a fresh clone per call also keeps
 * the shared IDENTITY_RE's `lastIndex` out of every reader.
 */
const identityRe = (flags = "") => new RegExp(IDENTITY_RE.source, flags);

/**
 * Attribution records for every arm identity RAISED by `gateText`.
 *
 * One record per (raise statement, identity). An identity raised twice yields
 * two records and attribution accepts EITHER, because both are the runner's
 * own text — the record set is a description of the file, not a claim of
 * uniqueness.
 *
 * ⚠️ Build this from the gate copy AS THE LANE WILL RUN IT — after neuters AND
 * after every mutation `edit`, read back off disk. A mutation may legally edit
 * the gate file (the real corpus's `N1 3a` does), and psql reports the lines of
 * the bytes it actually parsed. Building from the pre-mutation text would
 * resolve against lines that no longer exist.
 *
 * `stmtEndLine`/`stmtStartLine` are the ENCLOSING TOP-LEVEL (depth 0) statement
 * — the `DO $$ … $$;` block. psql's `psql:<file>:<N>:` prefix names that
 * statement's LAST line, and PL/pgSQL's CONTEXT line is relative to its FIRST
 * (line 1 = the remainder of the `DO $$` line), which is what makes
 * `stmtStartLine + contextLine − 1 === raiseFileLine` the resolution.
 * Verified 5×: RESEARCH § The Key Measurement (2×) and this checkout's own
 * `pg-lane` measurement of gate1/gate5/gate7 (3×), 2026-09-01.
 */
export function gateAttributionRecords(gateText) {
  const statements = tokenizeStatements(gateText);
  const records = [];
  for (const idx of innermostCarriers(statements, IDENTITY_CARRIER)) {
    const stmt = statements[idx];
    // A commented-out (already neutered) raise is not a statement at all, and a
    // bare `TEST FAILED (` literal is not a raise — the same narrowing
    // `raiseStatementIndex` applies, for the same reason.
    if (!RAISE_EXCEPTION_RE.test(stmt.executableText)) continue;
    // The enclosing top-level statement: the last depth-0 statement at or
    // before this one. `tokenizeStatements` emits pre-order, so that is the
    // `DO $$ … $$;` block this raise lives inside.
    const top = statements.slice(0, idx + 1).findLast((s) => s.depth === 0);
    if (top === undefined) continue;
    for (const arm of armIdentitiesInOrder(stmt.text)) {
      records.push({
        arm,
        raiseFileLine: stmt.startLine,
        stmtStartLine: top.startLine,
        stmtEndLine: top.endLine,
      });
    }
  }
  return records;
}

/**
 * An identity's SECTION — the coverage unit the founder locked on 2026-09-02
 * (ROADMAP § SCOPE AMENDMENT: one `RED-UNDER-M` per named assertion group).
 *
 * ⛔ THE UNIT IS DERIVED FROM THE IDENTITIES, NEVER FROM THE `-- ====` BANNERS.
 * MEASURED 2026-09-02: the banner convention is not uniform across the 44 idiom
 * files — `test_reconcile_dropped_enqueue_sweep.sql`,
 * `test_strategy_analytics_stuck_computing_reaper.sql` and
 * `test_retention_orphaned_running.sql` carry 8 / 12 / 6 banners for 39 / 29 /
 * 25 sections, because there they delimit coarse "Part 1 / Part 2" blocks. A
 * count taken off banners UNDERCOUNTS, which would make a half-annotated file
 * read as complete — the exact direction this column exists to expose.
 *
 * The rule strips a trailing sub-suffix: `SHAPE 2a` -> `SHAPE 2`,
 * `TRIGGER 3d-i` -> `TRIGGER 3`, `ANON 1b-grant` -> `ANON 1`. An identity with
 * no such suffix is its own section.
 */
export const sectionOfIdentity = (id) => id.replace(/(\d)[a-z]*(-[A-Za-z]+)?$/, "$1");

/**
 * How many SECTIONS a gate file has: distinct sections over the identities the
 * runner can actually attribute.
 *
 * ⛔ Built on `gateAttributionRecords`, not on a raw scan of the file text.
 * MEASURED 2026-09-02 on the reference file: a raw `TEST FAILED (…)` sweep of
 * `test_strategy_shares_rls.sql` yields 104 identities / 36 sections, because
 * the file's own HEADER documents the idiom; the attributable set is 103 / 35.
 * The number printed beside `annotated` has to be the number an annotation
 * could ever reach, or the gap it exposes would be an artefact of the counter.
 *
 * ⚠️ 2026-09-02 (plan 164.4-01), LINEAGE: "This plan PRINTS the field. It does
 * NOT yet pin `annotated >= sections`: the reference file is 30 twins over 35
 * sections until plan 164.4-02 closes the 15, so the pin would fail on the very
 * run this plan measures."
 *
 * ⭐ ARMED 2026-09-03 (plan 164.4-02), and NOT where the line above sends you
 * (review IN-03). The durable control is SET INCLUSION — "every SECTION an
 * annotated file raises for also carries a twin" — in
 * `src/__tests__/mutation-annotation-parser.test.ts`, NOT `annotated >=
 * sections` in this runner, which a file carrying two twins on half its
 * sections satisfies while leaving the other half unarmed. Nothing in `run.mjs`
 * or in `ci.yml` compares this column to anything: it is the PRINTED EVIDENCE
 * for that vitest arm, not the arm itself. A reader looking here for the
 * arming will not find it, which is why this says so.
 */
export function gateSectionCount(gateText) {
  return new Set(gateAttributionRecords(gateText).map((r) => sectionOfIdentity(r.arm))).size;
}

/**
 * Parse lane output into psql message blocks.
 *
 * A block starts at a `psql:<path>:<line>: <SEVERITY>:  …` header and runs to
 * the next header. Within it, `CONTEXT:`/`LOCATION:`/… start FIELDS; any other
 * line continues whatever is currently open (the message, or the last field).
 * That matters: a CONTEXT chain frame quoting a multi-line `SQL statement "…"`
 * spans several unprefixed lines (MEASURED — the nested-EXECUTE forgery), so
 * counting newlines between `CONTEXT:` and `LOCATION:` is NOT frame counting.
 *
 * @returns {{ blocks: object[], lineOwner: (object|null)[], lines: string[] }}
 */
function parsePsqlBlocks(output) {
  const lines = output.split("\n");
  const blocks = [];
  const lineOwner = new Array(lines.length).fill(null);
  let block = null;
  let part = null;

  for (let i = 0; i < lines.length; i += 1) {
    const header = PSQL_HEADER_RE.exec(lines[i]);
    if (header !== null) {
      const verbose = VERBOSE_SQLSTATE_RE.exec(header[4]);
      block = {
        path: header[1],
        line: Number(header[2]),
        severity: header[3],
        sqlstate: verbose ? verbose[1] : null,
        message: verbose ? verbose[2] : header[4],
        fields: [],
      };
      blocks.push(block);
      part = { kind: "message" };
      lineOwner[i] = { block, part };
      continue;
    }
    if (block === null) continue; // preamble / stdout before any message
    const field = PSQL_FIELD_RE.exec(lines[i]);
    if (field !== null) {
      const entry = { name: field[1], value: field[2] };
      block.fields.push(entry);
      part = { kind: "field", entry };
      lineOwner[i] = { block, part };
      continue;
    }
    // Continuation of whatever is open.
    if (part.kind === "message") block.message += `\n${lines[i]}`;
    else part.entry.value += `\n${lines[i]}`;
    lineOwner[i] = { block, part };
  }
  return { blocks, lineOwner, lines };
}

/**
 * Classify EVERY `TEST FAILED (…)` occurrence in lane `output`.
 *
 * @param {string} output   combined stderr+stdout of one lane
 * @param {{gatePath: string, records: {arm:string,raiseFileLine:number,stmtStartLine:number,stmtEndLine:number}[]}} ctx
 * @returns {{
 *   sightings: {identity:string, arm:string|null, why:string, seen:string}[],
 *   firstAttributed: string|null,
 *   unattributable: {identity:string, why:string, seen:string}[],
 *   measureFail: string|null,
 *   blocks: number,
 * }}
 *
 * ⚠️ The scan covers ALL output, not just the first ERROR. `RAISE NOTICE` can
 * carry a `TEST FAILED (…)` without aborting the lane at all (MEASURED: exit 0,
 * severity NOTICE, no CONTEXT chain), which is the property the nonce design's
 * `unstampedIdentities` had and this replacement must not lose.
 */
export function attributeIdentities(output, ctx) {
  const { blocks, lineOwner, lines } = parsePsqlBlocks(output);

  // ── MEASURE_FAIL: an output grammar we do not understand ──────────────────
  // Never a silent pass, and never "no attributable arm" — an unparseable
  // format is indistinguishable from a real defect, so it gets its own name.
  let measureFail = null;
  const psqlShaped = lines.filter((l) => PSQL_PREFIXED_RE.test(l));
  if (psqlShaped.length > 0 && blocks.length === 0) {
    measureFail =
      `the lane emitted ${psqlShaped.length} psql-prefixed diagnostic line(s) that this parser ` +
      `could not read as message blocks. The CONTEXT/severity grammar is measured on macOS / ` +
      `PostgreSQL 16.13 only (WINDOWS.md 28: the sql-mutation job has never run on its CI host), ` +
      `and a localized or changed psql build would land here. FIRST UNPARSED LINE: ` +
      `${JSON.stringify(psqlShaped[0])}`;
  }

  const sightings = [];
  for (let i = 0; i < lines.length; i += 1) {
    // A fresh global instance per line (IN-03): no reader touches the shared
    // IDENTITY_RE's `lastIndex`.
    for (const match of lines[i].matchAll(identityRe("g"))) {
      const identity = match[1];
      const owner = lineOwner[i];
      const seen = oneLine(lines[i]);
      if (owner === null) {
        sightings.push({
          identity,
          arm: null,
          why: "outside any psql message block (raw stdout/stderr text)",
          seen,
        });
        continue;
      }
      if (owner.part.kind !== "message") {
        sightings.push({
          identity,
          arm: null,
          why: `carried by the ${owner.part.entry.name} field of a ${owner.block.severity} block, not by its message`,
          seen,
        });
        continue;
      }
      sightings.push(judgeBlock(identity, owner.block, ctx, seen));
    }
  }

  const firstAttributed = sightings.find((s) => s.arm !== null)?.arm ?? null;
  return {
    sightings,
    firstAttributed,
    unattributable: sightings.filter((s) => s.arm === null),
    measureFail,
    blocks: blocks.length,
    // Carried through so a diagnostic can state the EXPECTATION from the same
    // records the judgement used — two readers of one fact, never two facts.
    records: ctx.records,
  };
}

/**
 * Where a genuine raise of `identity` WOULD have to come from, in file:line
 * terms — the "expected" half of a diagnostic that must print what it saw AND
 * what it wanted (SC-7). Reads the same records the judgement used, so the two
 * halves cannot drift apart.
 */
function describeExpectedRaise(attribution, identity, gatePath) {
  const recs = (attribution.records ?? []).filter((r) => r.arm === identity);
  if (recs.length === 0) return `a raise of "${identity}" — but the gate file declares none`;
  return recs
    .map(
      (r) =>
        `${gatePath}:${r.raiseFileLine} (statement ${r.stmtStartLine}-${r.stmtEndLine}, so psql ` +
        `prefix :${r.stmtEndLine} and CONTEXT line ${r.raiseFileLine - r.stmtStartLine + 1})`,
    )
    .join(" or ");
}

/** Every identity the lane emitted and what became of it — the "what I saw" half. */
function describeSightings(attribution) {
  if (attribution.sightings.length === 0) return "none — the lane emitted no TEST FAILED (…) at all";
  return attribution.sightings
    .map((s) => `"${s.identity}" → ${s.arm === null ? `UNATTRIBUTABLE (${s.why})` : s.arm}`)
    .join("; ");
}

/** The three-legged rule, applied to one identity sighting in one block's message. */
function judgeBlock(identity, block, ctx, seen) {
  const no = (why) => ({ identity, arm: null, why, seen });

  if (block.severity !== "ERROR") {
    return no(`severity is ${block.severity}, not ERROR — a NOTICE/WARNING cannot fail an arm`);
  }
  if (block.sqlstate !== "P0001") {
    return no(
      `SQLSTATE is ${block.sqlstate === null ? "absent (is VERBOSITY=verbose set?)" : block.sqlstate}, ` +
        `not P0001 — the error is not a RAISE EXCEPTION`,
    );
  }
  // ── leg (a): the psql prefix names THIS lane's gate scratch file ──────────
  if (block.path !== ctx.gatePath) {
    return no(`raised from ${block.path}, not from this lane's gate file ${ctx.gatePath}`);
  }
  // ── F1: the block's fields must be the ones LIBPQ emitted, not message text ─
  // libpq prints every diagnostic field AT MOST ONCE per message, in a fixed
  // order, LOCATION last. A RAISE whose MESSAGE embeds `\nCONTEXT:  …\nLOCATION:
  // …` (measured live 2026-09-02 — see the 164.3.1-05 block above) prints a
  // forged CONTEXT + LOCATION pair BEFORE the real ones, so the FIRST CONTEXT
  // read alone attributes it. The genuine fields cannot be suppressed, so a
  // forged prefix always leaves either a repeated name or a field after
  // LOCATION. Checked before leg (b) because leg (b) reads `fields[contextIdx]`
  // and would otherwise read the forged one.
  const seenFields = new Set();
  for (const f of block.fields) {
    if (seenFields.has(f.name)) {
      return no(
        `duplicated diagnostic field — message-embedded forgery: "${f.name}" appears more than once in ` +
          `one psql block (fields in order: ${block.fields.map((x) => x.name).join(", ")}). libpq emits ` +
          `each field at most once, so a repeat means the RAISE's own message text spelled a field line`,
      );
    }
    seenFields.add(f.name);
  }
  const locationIdx = block.fields.findIndex((f) => f.name === "LOCATION");
  if (locationIdx !== -1 && locationIdx !== block.fields.length - 1) {
    return no(
      `duplicated diagnostic field — message-embedded forgery: LOCATION is not the FINAL field of the ` +
        `block (fields in order: ${block.fields.map((x) => x.name).join(", ")}). libpq prints LOCATION ` +
        `last, so a field after it was spelled by the RAISE's own message text`,
    );
  }
  // ── leg (b): the CONTEXT chain is EXACTLY ONE direct DO-body RAISE frame ──
  const contextIdx = block.fields.findIndex((f) => f.name === "CONTEXT");
  if (contextIdx === -1) {
    return no(
      `the error carries NO CONTEXT chain (fields: ${block.fields.map((f) => f.name).join(", ") || "none"}) ` +
        `— a PL/pgSQL RAISE always has one`,
    );
  }
  if (!block.fields.slice(contextIdx + 1).some((f) => f.name === "LOCATION")) {
    return no(
      "the CONTEXT chain is not bounded by a LOCATION sentinel — its extent is unknown, so its " +
        "frame count cannot be asserted (is VERBOSITY=verbose set on this leg?)",
    );
  }
  const chain = block.fields[contextIdx].value;
  const frame = SINGLE_DO_FRAME_RE.exec(chain.trim());
  if (frame === null) {
    const chainLines = chain.trim().split("\n");
    return no(
      `the CONTEXT chain is not EXACTLY ONE "inline_code_block line N at RAISE" frame — it has ` +
        `${chainLines.length} line(s), first: ${JSON.stringify(oneLine(chainLines[0] ?? ""))}. ` +
        `A nested EXECUTE, a helper function or a trigger forges the INNERMOST frame; it cannot ` +
        `forge the chain's LENGTH (and a message-embedded prefix is refused above, by field ` +
        `duplication)`,
    );
  }
  // ── leg (c): the frame line resolves to a raise the RUNNER's gate declares ─
  const contextLine = Number(frame[1]);
  const candidates = ctx.records.filter((r) => r.arm === identity);
  if (candidates.length === 0) {
    return no(`the gate file this lane ran declares no RAISE for "${identity}"`);
  }
  for (const rec of candidates) {
    if (block.line !== rec.stmtEndLine) continue;
    if (rec.stmtStartLine + contextLine - 1 !== rec.raiseFileLine) continue;
    return { identity, arm: identity, why: "attributed", seen };
  }
  const shown = candidates
    .map((r) => `${ctx.gatePath}:${r.raiseFileLine} (block ${r.stmtStartLine}-${r.stmtEndLine})`)
    .join(", ");
  return no(
    `source location does not match: psql reported statement end line ${block.line} and CONTEXT ` +
      `line ${contextLine} (resolving to file line ${candidates[0].stmtStartLine + contextLine - 1}), ` +
      `but "${identity}" is raised at ${shown}`,
  );
}

/**
 * Every arm identity the first-failure check could read out of `text`, sorted.
 *
 * ⛔ R2-W04. GRAMMAR rule 3 refuses a mutation that WRITES a `TEST FAILED (`
 * literal. That is one spelling of the attack. The general shape carries no
 * such literal at all — it RE-TARGETS an existing raise so a DIFFERENT arm
 * reports under the arm-under-test's ID:
 *
 *   {"kind":"edit","file":"supabase/tests/…","find":"ANON 1a): ",
 *    "replace":"N1 1a): ","occurrences":1}
 *
 * MEASURED at HEAD: the parser accepted that verbatim, and applying it moved
 * `ANON 1a` from 1 occurrence to 0 and `N1 1a` from 1 to 2. The first-failure
 * reader (`firstFailureArm` then; `attributeIdentities` since 2026-09-01)
 * would then read `N1 1a`, the runner would report `RED (identity ok)`, and
 * `biting` would rise for an arm whose own logic never ran — the exact outcome
 * rule 3 exists to prevent, reached without the literal rule 3 looks for.
 *
 * The invariant that closes the CLASS is stated over the FILE rather than over
 * the annotation's spelling: a mutation may change what the gate DOES, never
 * who it says it is, and never the condition under which it says it.
 *
 * ⛔ R3-W01 + R3-C02. The first version of this compared a SORTED MULTISET of
 * identities, which is blind in two measured ways:
 *
 *   - SWAPS. Exchanging two arms' identities leaves the sorted multiset
 *     byte-identical, so a single `edit` spanning both raises returned `null`.
 *     Combined with a step that breaks the OTHER arm, that arm then reports
 *     under the arm-under-test's ID — the outcome the rule exists to refuse,
 *     reached THROUGH the rule.
 *   - GUARD NEGATION. `IF NOT raised THEN` -> `IF TRUE THEN` preserves every
 *     identity exactly, and MEASURED against the real gate it parsed clean,
 *     applied cleanly and returned `null` from the multiset compare — while
 *     the `WITH CHECK` the arm claims to test was never evaluated.
 *
 * So the unit of the invariant is now the FAILURE BRANCH: the exact text from
 * the head of the branch enclosing a `TEST FAILED (` raise through the end of
 * that raise's statement, in FILE ORDER. A mutation must leave that ordered
 * list byte-identical. That covers identity rewrites, identity swaps
 * (position-sensitive), guard negations (the head is part of the block), and
 * injected raises carrying the literal (a new block appears).
 *
 * ⚠️ WHAT IT DOES NOT COVER, stated rather than implied: a raise INJECTED with
 * the literal spelled indirectly (`'TEST FAI' || 'LED (X)'`) is not recognised
 * as a failure branch, so it does not appear in either list. That half of the
 * class is closed at RUNTIME by the source-location attribution above, which is
 * the only place it can be closed — see `attributeIdentities`. (Until
 * 2026-09-01 that runtime closure was the identity nonce; it was superseded
 * because the nonce transmitted its secret to the server — [R4-C02].)
 *
 * MEASURED 2026-08-29 across the real corpus — 30 annotated arms, 49 file
 * steps — 0 violations. The widened rule refuses nothing that exists today.
 *
 * ⚠️ NEUTERS ARE NOT SUBJECT TO THIS, deliberately: neutering an arm removes
 * its identity ON PURPOSE. The comparison is taken across a MUTATION step
 * only, with the post-neuter text as its "before", so a branch the neuter
 * commented out is absent from both sides.
 */
export function armIdentities(text) {
  return [...text.matchAll(identityRe("g"))].map((m) => m[1]).sort();
}

/** Identities in FILE ORDER — position-sensitive, so a swap is visible. */
export function armIdentitiesInOrder(text) {
  return [...text.matchAll(identityRe("g"))].map((m) => m[1]);
}

/**
 * How far back a failure branch's head may sit from its RAISE.
 *
 * MEASURED 2026-08-29 on `supabase/tests/test_strategy_shares_rls.sql`: every
 * one of the 104 identities sits well inside this bound. EXPORTED so the REAL
 * CORPUS arm in `mutation-annotation-parser.test.ts` PINS the bound against
 * the corpus's largest measured branch (it imports this constant rather than
 * restating 40), and fails loud the day a branch grows past it.
 */
export const FAILURE_BRANCH_LOOKBACK = 40;

/**
 * A block CLOSER — `END LOOP;`, `END IF;`, `END CASE;`, `END;` — and its kind,
 * or null. A closed block sitting between a raise and its guard is ONE
 * compound statement OF the branch, not the branch's head, so the walk in
 * `failureBranches` steps OVER it to the statement that opened it and keeps
 * walking.
 *
 * CR-01 (164.3.1 review), MEASURED 2026-09-02 on `IF NOT ok THEN <block>
 * RAISE …`: with the loop closer tokenized as a head the branch was anchored
 * on `END LOOP;`; with it a plain statement the anchor only moved to the loop's
 * own `FOR … LOOP` head — and a nested `IF … END IF;` or `BEGIN … END;`
 * anchored on ITS opener the same way. In every shape `IF NOT ok THEN` →
 * `IF TRUE THEN` behind the block returned null: guard negation, invisible
 * (GRAMMAR § 3b, R3-C02 secondary). Read in the masking projection, so a
 * closer inside a literal or a comment is not one.
 */
const BLOCK_CLOSER_RE = /^END(?:\s+(LOOP|IF|CASE))?\s*;$/i;
function blockCloserKind(statement) {
  const m = BLOCK_CLOSER_RE.exec(statement.executableText.trim());
  return m === null ? null : (m[1] ?? "BLOCK").toUpperCase();
}

/**
 * Does `statement` OPEN a block of `kind`? `IF`/`LOOP`/`BEGIN` openers are the
 * tokenizer's own heads; a `CASE` statement's opener is the plain statement
 * that begins with the word (its `WHEN … THEN` is swallowed by the tokenizer's
 * case-depth rule), so that one is keyed on the first word alone.
 */
function opensBlock(statement, kind) {
  const words = statement.executableText.trim().split(/\s+/);
  const first = words[0].toUpperCase();
  const last = words[words.length - 1].toUpperCase();
  switch (kind) {
    case "LOOP":
      return isBranchHead(statement) && last === "LOOP";
    case "IF":
      return isBranchHead(statement) && first === "IF" && last === "THEN";
    case "BLOCK":
      return isBranchHead(statement) && words.length === 1 && first === "BEGIN";
    case "CASE":
      return first === "CASE";
    default:
      return false;
  }
}

/**
 * Index of the sibling that opens the block `closerIdx` closes, nesting-aware,
 * or -1 when no opener sits among the siblings (malformed, or opened above the
 * enclosing body — the lane refuses such a file either way).
 */
function blockOpenerIndex(statements, closerIdx, depth, kind) {
  let nest = 0;
  for (
    let k = prevSiblingIndex(statements, closerIdx, depth);
    k !== -1;
    k = prevSiblingIndex(statements, k, depth)
  ) {
    if (blockCloserKind(statements[k]) === kind) {
      nest += 1;
      continue;
    }
    if (opensBlock(statements[k], kind)) {
      if (nest === 0) return k;
      nest -= 1;
    }
  }
  return -1;
}

/**
 * Every FAILURE BRANCH in `text`, in file order: `{ id, text }` where `text` is
 * the exact source from the enclosing branch head through the end of the RAISE.
 *
 * The backward walk reuses the same STATEMENT TOKENIZER `neuterArm` uses, so
 * "what counts as a branch head" has ONE definition across this file rather
 * than two that can drift apart.
 */
export function failureBranches(text) {
  const lines = text.split("\n");
  const statements = tokenizeStatements(text);
  const out = [];
  for (const idx of innermostCarriers(statements, IDENTITY_CARRIER)) {
    const stmt = statements[idx];
    // A commented-out (neutered) raise is not a statement at all, so it cannot
    // reach here — the tokenizer's masking, not a `^--` line test, is what
    // excludes it.
    if (!RAISE_EXCEPTION_RE.test(stmt.executableText)) continue;
    const m = stmt.text.match(identityRe());
    if (!m) continue;

    // Walk back to the NEAREST branch head. The guard is the load-bearing part
    // of the block: `IF NOT raised THEN` -> `IF TRUE THEN` preserves every
    // identity and every raise, and MEASURED against the real gate it passed
    // the old multiset compare while making the arm fire without evaluating
    // the property it claims to test (R3-C02, secondary).
    //
    // Intervening non-head statements (the corpus's `RESET ROLE;` abort-path
    // cleanup) are walked THROUGH, unlike `neuterArm`, which refuses them —
    // there the concern is what stays live after a rewrite, here it is only
    // where the block begins.
    //
    // BOUNDED so a raise with no enclosing branch cannot swallow the file. If
    // no head is found inside the bound the block is the raise statement alone,
    // which is the narrow direction; that is safe here only because
    // source-location attribution (`attributeIdentities`, GRAMMAR rule 3c —
    // not this function) is what closes the injection half of the class. The
    // identity nonce that used to close it was deleted in plan 05 (IN-01).
    let headLine = stmt.startLine;
    for (
      let k = prevSiblingIndex(statements, idx, stmt.depth);
      k !== -1 && stmt.startLine - statements[k].startLine <= FAILURE_BRANCH_LOOKBACK;
      k = prevSiblingIndex(statements, k, stmt.depth)
    ) {
      const closer = blockCloserKind(statements[k]);
      if (closer !== null) {
        // A closed block is walked OVER, never anchored on: its opener heads
        // the block, not the branch (CR-01). An unmatched closer ends the walk
        // at the raise alone — the narrow direction, same as the bound above.
        k = blockOpenerIndex(statements, k, stmt.depth, closer);
        if (k === -1) break;
        continue;
      }
      if (isBranchHead(statements[k])) {
        headLine = statements[k].startLine;
        break;
      }
    }

    // The raise's end is its STATEMENT's end. The second copy of the
    // single-quote-only forward walker that used to live here — the other half
    // of [MUT-I01] — is deleted, not wrapped.
    out.push({ id: m[1], text: lines.slice(headLine - 1, stmt.endLine).join("\n") });
  }
  return out;
}

/** `null` when the mutation preserved every failure branch; otherwise a description. */
export function identityRewriteDetail(before, after, file) {
  const b = failureBranches(before);
  const a = failureBranches(after);
  if (b.length === a.length && b.every((x, i) => x.text === a[i].text)) return null;

  const changed = [];
  for (let i = 0; i < Math.max(b.length, a.length); i += 1) {
    if (b[i]?.text === a[i]?.text) continue;
    changed.push(
      `#${i + 1} ${JSON.stringify(b[i]?.id ?? null)} -> ${JSON.stringify(a[i]?.id ?? null)}`,
    );
    if (changed.length === 4) break;
  }

  return (
    `MEASURE_FAIL: the mutation REWRITES a failure branch in ${file} ` +
    `(${b.length} branch(es) before, ${a.length} after; first differences: ${changed.join(", ")}). ` +
    `A mutation may change what the gate DOES; it may never change who the gate SAYS IT IS, nor ` +
    `the condition under which it says it. Re-pointing a raise makes the first-failure check ` +
    `attribute another arm's failure to this one; negating a guard makes the arm fire without ` +
    `evaluating the property it claims to test. Either way the arm would count as biting without ` +
    `its own logic ever running. Mutate the code under test, not the failure branch.`
  );
}

// ---------------------------------------------------------------------------
// Lane invocation
// ---------------------------------------------------------------------------

/**
 * The four legs a lane can be spawned for. `arm` is the only one the verdict
 * loop counts as executed; `baseline` and `restore` bracket a gate's arms, and
 * `probe` (164.4-03) runs once per lane-spawning run to ask the lane itself
 * whether it can host pg_cron. All three non-arm legs are tallied separately so
 * the cross-check below compares like with like.
 *
 * ⛔ `probe` is NEVER compared to `arms:`. `laneInvocations` stays `laneLegs.arm`
 * and the `lane-invocations:` line's text is unchanged, because ci.yml parses
 * it: widening that line would be a silent redefinition of the one number the
 * absurdity floor's exact equality is asserted on.
 */
const LANE_LEGS = ["baseline", "arm", "restore", "probe"];

/**
 * 164.3.1-10 — THE LANE RUNNER'S OWN TALLY, one counter per leg.
 *
 * ⭐ INDEPENDENCE IS THE CONTROL (SP-C05). This is incremented in exactly one
 * place — inside `runLane`, beside the `spawnSync` that actually starts a
 * lane — and read by `runCorpus` only as a snapshot delta. The verdict loop's
 * `armsExecuted` is a DIFFERENT variable in a DIFFERENT function. The two can
 * agree only if the loop really drove a lane for every arm it counted; one
 * variable incremented in two places would agree with itself by construction
 * and prove nothing. A stub that replaces `runLane` wholesale, a branch that
 * skips the call, or a short-circuit that returns a canned result all leave
 * this counter behind — which is exactly the state `absurdityViolations`
 * exists to name. Monotonic on purpose: nothing resets it, so no caller can
 * zero it to make a run look consistent.
 */
const laneTally = { baseline: 0, arm: 0, restore: 0, probe: 0 };

/**
 * 164.4-12 (review WR-02) — THE SAME TALLY, BROKEN OUT PER GATE FILE.
 *
 * ⭐ WHY THIS EXISTS. The per-file `executed` column used to be
 * `tally.executed += 1` on the line immediately after `armsExecuted += 1`. Both
 * sides of the cross-sum therefore came from ONE increment, so
 * `sum(perFile.biting) === biting` agreed with itself BY CONSTRUCTION — a
 * relation modelled on the independent `armsExecuted === laneInvocations` check
 * while having none of its independence. A control that cannot fail is the
 * exact defect this phase exists to remove, so the column was moved to the
 * lane side.
 *
 * Incremented in exactly one place — inside `runLane`, beside `laneTally`, at
 * the `spawnSync` that actually starts an arm lane — and keyed by the gate's
 * REPO-RELATIVE path, which the verdict loop hands in as `gateKey`. `runCorpus`
 * reads it only as a snapshot delta and `perFileRows` derives `executed`,
 * `judged` and `biting` from it. The per-file columns and the aggregate
 * `bitingArms` now descend from DIFFERENT counters in DIFFERENT functions, so
 * relation (3) is a second measurement rather than a restatement.
 *
 * Monotonic for the same reason `laneTally` is: nothing resets it, so no caller
 * can zero it to make a run look consistent.
 */
const laneArmGateTally = new Map();

/**
 * PURE. Why a `spawnSync` result carries no usable exit status, or null when
 * the process ran to one. Exported so the classification is pinned on its own.
 *
 * ⛔ `status` is NULL in three unrelated situations — the binary could not be
 * started at all (`error.code === "ENOENT"`, or `ENOBUFS` when the output
 * overran `maxBuffer`), the process was killed by a signal (`SIGKILL` from the
 * OOM killer, `SIGTERM` from a cancelled job), or — defensively — neither
 * an error nor a signal nor an integer status. Until 2026-09-02 `runLane` returned
 * `status: null` for all of them and the verdict loop read it as `!== 0`: a
 * lane that never ran was a `no-red`-free "red" whose output carried no
 * identity, so it surfaced as `wrong-first-failure` — a CORPUS defect named
 * for an INSTRUMENT failure. A lane the runner could not run is a MEASURE_FAIL
 * and says so.
 *
 * @returns {string|null}
 */
export function laneSpawnFailure(proc) {
  if (proc.error) {
    const code = proc.error.code ?? proc.error.message ?? String(proc.error);
    return `lane could not run: ${code}`;
  }
  if (proc.signal) return `lane could not run: ${proc.signal}`;
  if (!Number.isInteger(proc.status)) return "lane could not run: no exit status and no signal";
  return null;
}

function runLane({ workdir, applyAbs, postApplyAbs, gateAbs, leg, gateKey = null }) {
  // Refuse to guess which leg this is: an untagged lane would be an
  // unaccounted invocation, and the cross-check treats that as absurd.
  if (!LANE_LEGS.includes(leg)) throw new Error(`runLane: unknown leg ${JSON.stringify(leg)}`);
  // Same refusal, one level finer: an ARM lane with no gate key is an
  // invocation no file's column could ever account for, which would make the
  // per-file cross-sum disagree for a reason that is the runner's own bug.
  // The non-arm legs are not broken out per file, so they need no key.
  if (leg === "arm" && typeof gateKey !== "string")
    throw new Error("runLane: an arm lane needs a gateKey — an untagged arm lane is an invocation no per-file column can account for");
  const args = [LANE, "--workdir", workdir, "--apply", ...applyAbs];
  if (postApplyAbs) args.push("--post-apply", postApplyAbs);
  args.push("--gate", gateAbs);
  const started = Date.now();
  const proc = spawnSync("bash", args, { encoding: "utf8", maxBuffer: 128 * 1024 * 1024 });
  const measureFail = laneSpawnFailure(proc);
  // Counted at the spawn, after it returned: a lane is an invocation only if
  // the process was actually started, never because this function was entered
  // — and a spawn that FAILED (`proc.error`: ENOENT, ENOBUFS) started nothing,
  // so it is not counted either. A lane that started and was then signalled
  // IS counted: it ran, and the verdict loop must account for it.
  const invoked = !proc.error;
  if (invoked) {
    laneTally[leg] += 1;
    // The per-file half of the same measurement (WR-02). Keyed by the gate the
    // verdict loop named, incremented under the SAME `invoked` condition, so
    // the two tallies can never diverge for a reason other than the loop
    // miscounting — which is the whole point of keeping them apart.
    if (leg === "arm") laneArmGateTally.set(gateKey, (laneArmGateTally.get(gateKey) ?? 0) + 1);
  }
  // stderr first: psql streams RAISE output there, and ON_ERROR_STOP=1 aborts
  // at the first failing statement, so emission order is failure order.
  const output = `${proc.stderr || ""}\n${proc.stdout || ""}`;
  return { status: proc.status, output, seconds: (Date.now() - started) / 1000, measureFail, invoked };
}

// ===========================================================================
// 164.3.1-10 — THE RUNNER'S ABSURDITY FLOOR (D-09 runner half; SC-7/SC-8/SC-9)
// ===========================================================================
//
// ⛔ THE DEFECT THIS CLOSES. Until this plan `armsExecuted` was ONE tally,
// incremented in the verdict loop, and nothing compared it to what actually
// ran. A runner whose lane path was stubbed, skipped or short-circuited would
// still print `arms: 30/30/0` and `biting: 30`, clear both floors and exit 0.
// That is the `--parse-only` shape — a run that executed nothing reading as a
// full PASS — reached INSIDE the process, where the CI count-recheck step's
// executed-is-zero guard cannot see it because the number it reads is the
// one that lied. And it is VAC-08's 253-of-262 in mirror image: a gate
// holding every number needed to know its own verdict was absurd, and never
// comparing them.
//
// THE RULE — two INDEPENDENT tallies and one arithmetic invariant, all three
// printed on every run and re-asserted by the sql-mutation job's count-recheck
// step (which parses the printed `lane-invocations:` line and MEASURE_FAILs
// on its absence, so a runner that stops printing it fails CI):
//
//   armsExecuted     the verdict loop's count           (`armsExecuted += 1`)
//   laneInvocations  arm-leg lanes the LANE RUNNER itself counted at the
//                    spawn                              (`laneTally.arm`)
//   biting           executed minus the non-biting defect kinds
//
//   (1) armsExecuted === laneInvocations — EXACT, in both directions. Fewer
//       lanes than arms: arms were CLAIMED that never ran. More lanes than
//       arms: lanes ran that no verdict accounts for.
//   (2) biting <= armsExecuted — the impossible count. Trivially true of this
//       program (biting is executed minus a subset), asserted anyway because
//       the CI step reads these numbers out of a text file it did not
//       produce, and "these two cannot disagree" is worth stating about the
//       FILE (ci.yml's R2-I01 note; this is its in-process twin).
//
// ─── MEASURED (SC-9) — quoted from plan 164.3.1-09's committed record, ─────
// ─── never re-measured from memory ─────────────────────────────────────────
//   RECORD        .planning/phases/164.3.1-sound-primitives-the-neuter-scan-
//                 and-the-mutation-identity-c/164.3.1-09-REDERIVATION.md
//   DATE / HEAD   2026-09-01, HEAD a305a71a, under the statement tokenizer
//                 (plan 01) and source-location attribution (plan 05)
//   COMMAND       `node scripts/mutation-runner/run.mjs` -> exit 0
//                   coverage: files 1/71
//                   arms: 30/30/0   (executed/annotated/waived)
//                   biting: 30
//   SILENT SHAPE  executed 30 / lane arm-invocations 30 / biting 30
//                 -> 0 violations (the legitimate corpus; re-observed on the
//                 real corpus with the new line printed — 164.3.1-10-SUMMARY)
//   SAMPLE SIZE   30 arms executed, all 30 `RED (identity ok)`, 0 moved from
//                 the pre-phase per-arm baseline; 1 baseline + 1 restore leg
//   COVERAGE      1 annotated gate file of 71 in supabase/tests/
//                 (test_strategy_shares_rls.sql, blob 5ae6855f, byte-identical
//                 at the phase base and at HEAD)
//   FIRES SHAPE   the severed tally: executed 30 / invocations 0 / biting 30
//                 -> 1 violation, exit 1, all three numbers printed. Observed
//                 on the REAL runner under a byte-backed neuter of the
//                 `laneTally[leg] += 1` line, restore sha-verified
//                 (164.3.1-10-SUMMARY.md) — the WIRING fires, not only the
//                 helper (RESEARCH Pitfall 6).
//   SEPARATION    there is no threshold to tune. The legitimate shape sits at
//                 equality (30 = 30); the absurd shape sits at 30 vs 0. The
//                 "wide separation" D-10 asks of a floor is here the full
//                 width of the count, because the rule is exact rather than
//                 a ratio — a single missing lane (30 vs 29) also fires.
//
// ⚠️ WHAT THIS DOES NOT COVER, stated rather than implied: the tally counts
// SPAWNS. A lane that was started but did nothing useful (a `run.sh` that
// exited early, a cluster that never booted) is counted as an invocation;
// that half is covered by the baseline/restore GREEN legs and by
// source-location attribution, which refuse to credit an arm whose output
// carries no attributable raise. This floor bounds "did the loop drive a lane
// per arm", nothing more — and it says so.
//
// Template: scripts/test-ledger-drift-check.sh's ABSURDITY FLOOR (VAC-08) —
// diagnostic first, then the refusal, and the sentence that this is the GATE
// failing, not the thing it measures.

/**
 * PURE. Returns one evidence string per violated invariant, or [] when the
 * three counts are mutually consistent. Every string carries all three
 * numbers in a machine-readable tail and says it is the gate failing — a bare
 * conclusion is the repudiation shape SC-7 refuses.
 *
 * ⭐ 2026-09-02 (164.4-01) — TWO MORE RELATIONS, over the PER-FILE breakdown.
 * `perFile` and `armsAnnotated` are OPTIONAL: a caller that passes neither gets
 * exactly the three-count behaviour above, which is what the pure-arithmetic
 * fixtures in `mutation-runner-floors.test.ts` exercise. When they ARE passed:
 *
 *   (3) sum(perFile.biting) === biting
 *   (4) sum(perFile.annotated) === armsAnnotated
 *
 * ⭐ 164.4-12 (review WR-02) — WHAT EACH ONE IS WORTH, stated separately,
 * because until this plan the comment here claimed both were siblings of
 * relation (1) and NEITHER was.
 *
 *   (3) IS a second measurement, since this plan. `perFile.biting` descends
 *       from `laneArmGateTally` — incremented inside `runLane` at the spawn —
 *       via `perFileRows`; the aggregate `biting` descends from `armsExecuted`
 *       in the verdict loop. Two counters, two functions, exactly the
 *       independence relation (1) has, now resolved per file: a loop that
 *       counts an arm it never laned for disagrees HERE and names the file.
 *       Until 2026-09-04 `tally.executed` was incremented on the line after
 *       `armsExecuted`, so both sides came from one increment and this
 *       relation could not fail — a control that cannot fail, in the phase
 *       built to remove them.
 *
 *   (4) is NOT a second measurement, and this is not a defect to be fixed:
 *       `annotated` is a PARSE-time property and no lane observes it, so there
 *       is no independent counter to compare against. It catches a narrower
 *       thing — a twin attributed to a file the report does not list — and
 *       that is all it should be read as claiming.
 *
 * Both still catch the shape RESEARCH Pitfall 2 warns about in miniature: a
 * number that moved for a reason nothing in the report accounts for. The
 * aggregate subtracts the non-biting defect kinds GLOBALLY; the per-file column
 * subtracts the ones that NAME that file, so a defect attributed to no listed
 * file deflates one side only.
 *
 * @param {{armsExecuted: number, laneInvocations: number, biting: number,
 *          perFile?: Array<{name: string, annotated: number, biting: number}> | null,
 *          armsAnnotated?: number | null}} counts
 * @returns {string[]}
 */
export function absurdityViolations({
  armsExecuted,
  laneInvocations,
  biting,
  perFile = null,
  armsAnnotated = null,
}) {
  const tail = `(executed=${armsExecuted} lane-invocations=${laneInvocations} biting=${biting})`;
  const gate = "MEASURE_FAIL — this is the GATE failing, not the corpus:";
  const isCount = (n) => Number.isInteger(n) && n >= 0;
  // An absent or malformed measurement must never read as a consistent one.
  if (![armsExecuted, laneInvocations, biting].every(isCount)) {
    return [
      `${gate} the three counts cannot be cross-checked because at least one is not a ` +
        `non-negative integer ${tail}. An unmeasurable count is not a count of zero.`,
    ];
  }
  const out = [];
  if (armsExecuted > laneInvocations) {
    out.push(
      `${gate} the verdict loop counted ${armsExecuted} executed arm(s) but the lane runner ` +
        `spawned only ${laneInvocations} arm lane(s) ${tail}. ${armsExecuted - laneInvocations} ` +
        `arm(s) were CLAIMED without a lane ever running — the parse-only shape, reached inside ` +
        `the process. Neither \`arms:\` nor \`biting:\` above is a measurement on this run.`,
    );
  } else if (laneInvocations > armsExecuted) {
    out.push(
      `${gate} the lane runner spawned ${laneInvocations} arm lane(s) but the verdict loop counted ` +
        `only ${armsExecuted} executed arm(s) ${tail}. ${laneInvocations - armsExecuted} lane(s) ` +
        `are UNACCOUNTED for — they ran and no verdict describes what they found.`,
    );
  }
  if (biting > armsExecuted) {
    out.push(
      `${gate} biting (${biting}) exceeds executed (${armsExecuted}) ${tail}. Biting is executed ` +
        `minus a subset of the defects, so this count is impossible for one run of this program; ` +
        `either the counts were assembled from two runs or the arithmetic was tampered with.`,
    );
  }
  if (perFile !== null) {
    if (!perFile.every((r) => isCount(r.biting) && isCount(r.annotated))) {
      out.push(
        `${gate} the per-file breakdown carries a field that is not a non-negative integer ` +
          `${tail}. An unmeasurable column is not a column of zeroes.`,
      );
      return out;
    }
    const sumBiting = perFile.reduce((a, r) => a + r.biting, 0);
    if (sumBiting !== biting) {
      out.push(
        `${gate} the per-file breakdown sums to ${sumBiting} biting arm(s) but the aggregate ` +
          `reports ${biting} ${tail}, across ${perFile.length} file(s). The two are derived from ` +
          `the same run — the aggregate subtracts the non-biting defects globally, the columns ` +
          `subtract the ones naming each file — so a disagreement means a defect belongs to no ` +
          `file the loop listed, or a column was not kept.`,
      );
    }
    if (armsAnnotated !== null) {
      const sumAnnotated = perFile.reduce((a, r) => a + r.annotated, 0);
      if (!isCount(armsAnnotated) || sumAnnotated !== armsAnnotated) {
        out.push(
          `${gate} the per-file breakdown sums to ${sumAnnotated} annotated twin(s) but the ` +
            `aggregate reports ${armsAnnotated} ${tail}, across ${perFile.length} file(s). Every ` +
            `twin belongs to exactly one gate file; a gap here means twins were counted for a ` +
            `file the report does not describe.`,
        );
      }
    }
  }
  return out;
}

// ===========================================================================
// 164.4-01 — THE EXCLUSION IS PRINTED, BY NAME, ON EVERY RUN (criterion 1 as
// amended; threat T-164.4-04)
// ===========================================================================
//
// ⛔ THE DEFECT THIS CLOSES. The printed `coverage: files N/71` is a ratio over
// EVERY `.sql` in the scope dir, and the phase's own end state is BELOW 71 —
// 27 of those files raise outside the runner's identity idiom and no arm of
// theirs can be attributed at all (a further 4 are `lane-blocked:`, SCOPE
// AMENDMENT #2, so the reachable end state is `files 40/71`). A reader of a
// bare `40/71` cannot tell "31 files nobody got to yet" from "31 files this
// gate can never judge today, deliberately". That is the repudiation shape: a
// subset covered, reported as if it were the whole.
// ⚠️ CORRECTION 2026-09-04 (plan 164.4-12, review WR-V2): the ARGUMENT above
// stands unchanged; the figure it quotes does not. The reachable end state is
// `files 39/71`, not 40/71 — a FIFTH file (test_compute_jobs_error_kind_copy_
// parity.sql) is equally un-baselineable without pg_cron and prints under
// `pending:`; see the correction at the head of this file. Substitute "32
// files" for "31" in the sentence above and it reads correctly.
//
// The founder's scope amendment (2026-09-02, ROADMAP § SCOPE AMENDMENT) makes
// the exclusion explicit and makes PRINTING it a merge condition: *"the 27
// non-idiom files are OUT of scope and the runner names them in its output
// every run; a silent exclusion fails this criterion just as a missing
// annotation does."* So the runner DERIVES the classification (never a
// hand-maintained list, which would be one more claim nobody compares) and the
// `sql-mutation` count-recheck step MEASURE_FAILs when the line is absent or
// when the count it claims disagrees with the names it prints.
//
// ⭐ EVIDENCE, NOT VERDICT (SC-7). The line carries the COUNT and the NAMES.
// A count alone would be a number nobody could check; the cross-check in
// ci.yml is only possible because both are printed.
//
// MEASURED 2026-09-02 over `supabase/tests/`: 1 annotated / 43 pending /
// 27 unreachable / 0 inert = 71. The 27 match RESEARCH § Option (a)'s table
// exactly, derived independently by `classifyGateIdiom`.
//
// ⛔ FORMAT CONSTRAINT (PATTERNS § P6). `ci.yml` parses the aggregate by
// line-start prefix, first match only, and the coverage grep is `$`-ANCHORED.
// So `unreachable:` is a NEW, distinct column-0 prefix (it collides with none
// of the four existing greps) and every other new line is INDENTED.
//
// ─── CURRENCY 2026-09-03 (plan 164.4-03) ───────────────────────────────────
// The block above is LINEAGE: its dated measurement and its argument both
// stand. What moved is the end state it quotes. SCOPE AMENDMENT #2 (founder
// 2026-09-03) defers 4 of those 43 pending files — they probe `pg_extension`
// for pg_cron, which the pg-lane cannot host — so the phase's reachable end
// state is `files 40/71`, not 44/71, and the deferred four are printed under
// their OWN column-0 prefix `lane-blocked:` with their reason and TODO id
// rather than silently sitting in `  pending:` reading as unfinished work.
// RE-MEASURED 2026-09-03 over `supabase/tests/`: 1 annotated / 39 pending /
// 27 unreachable / 0 inert / 4 lane-blocked = 71.
// ⚠️ CURRENCY 2026-09-03 (plan 164.4-07): the classes are unchanged and the
// end state is still 40/71; only the annotated/pending SPLIT has moved, to
// 17 annotated / 23 pending / 27 unreachable / 0 inert / 4 lane-blocked = 71.
// ⚠️ CURRENCY 2026-09-04 (plan 164.4-12, review WR-V2) — SUPERSEDES the two
// lines above as the current reading. They stay as lineage. The end state is
// `files 39/71`, NOT 40/71: the classes are still five, but the fifth file
// test_compute_jobs_error_kind_copy_parity.sql cannot be baselined without
// pg_cron either and is owed to Phase 164.4.1 (founder decision, plan 09;
// TODOS [REDUNDER-LANEBLOCKED-BLIND]). MEASURED at this commit over
// `supabase/tests/` via `--parse-only`: 39 annotated / 1 pending /
// 27 unreachable / 0 inert / 4 lane-blocked = 71.
// Read the run's own `coverage:` and `  pending:` lines, never this sentence.
//
// ⭐ AND THE REASON CAN EXPIRE. "which the pg-lane cannot host" is a claim
// about the LANE, and nothing in the derivation measures the lane: fix
// [REDUNDER-PGCRON] tomorrow and a derived-only class would keep printing four
// blocked files forever with nothing reddening — 100 sections parked behind a
// true-looking line, which is the control-that-cannot-fail this phase exists to
// remove. So every lane-spawning run drives ONE extra lane leg (`probe`)
// through the real `laneRunner`, prints what it MEASURED on the lane as
// `lane-probe:`, and raises `lane-blocked-stale` (exit 1) the day pg_cron is
// available while the class is non-empty.

/**
 * The defect kinds that take an EXECUTED arm out of `biting`. Named once, so
 * the aggregate `bitingArms` and the per-file `biting` column cannot come to
 * mean two different things under one word.
 *
 * ⛔ `synthesised-identity` MUST be here: it is raised for an arm that DID run
 * a lane, so omitting it counts a vacuous PASS as biting — the one number
 * ARMS_FLOOR bounds. `lane-unrunnable` is NOT here: it is handled by
 * `armsUnjudged`, because the never-started case raises it without ever
 * incrementing `armsExecuted` and subtracting by kind would push biting below
 * what ran.
 */
const NON_BITING_DEFECT_KINDS = ["no-red", "wrong-first-failure", "synthesised-identity"];

/**
 * The OPEN shape of a per-file tally — the seven fields `perFileRows` derives
 * from and `logPerFileRows` prints, in ONE place.
 *
 * ⛔ Both modes build this, and a column added to only one of them is how the
 * two modes' identically-shaped lines come to mean different things. Hence one
 * constructor rather than two literals.
 *
 * ⚠️ `annotated` and `waived` are PARAMETERS, not derived here, because the two
 * modes legitimately seed them differently and unifying that would be a silent
 * behaviour change:
 *   - `runCorpus` opens the tally at 0/0 before the RED-UNDER-SETUP check and
 *     fills it in only for a file that reaches the arm loop. A file the gate
 *     `continue`s for a missing setup line therefore reads `annotated 0` — it
 *     contributed no arm to this run, and the row must not claim otherwise.
 *   - `parseOnlyCorpus` runs no lane, so its whole product IS the static count;
 *     it seeds from `parsed.structured` immediately and reports the twins a
 *     file carries even when the gate path could never run them.
 *
 * `sections` is computed from `gateText` the caller ALREADY read, so the row
 * costs no extra `readFileSync` beyond the parse.
 *
 * ⚠️ 164.4-12 (WR-02): `executed` is seeded at 0 here and is OVERWRITTEN by
 * `perFileRows` from the lane-side `laneArmGateTally`. Nothing in the verdict
 * loop increments it any more — that is the independence relation (3) rests on.
 * The field stays in the constructor so the row's shape is declared in one
 * place, not because this value is ever reported.
 */
function newPerFileTally({ name, gateRel, gateText, annotated, waived }) {
  return {
    name,
    gateRel,
    sections: gateSectionCount(gateText),
    annotated,
    waived,
    executed: 0,
    unjudged: 0,
  };
}

/**
 * The per-file rows the report prints and the absurdity floor cross-sums.
 *
 * `judged` is what the file's arms actually reached a verdict on, and it is the
 * column that makes threat T-164.4-05 visible: a file whose baseline went RED
 * is `continue`d before any arm runs, so it shows `annotated 39 / judged 0` —
 * 39 twins of coverage that measured nothing. `biting` subtracts, from that
 * file's judged arms, the non-biting defects that NAME that file.
 *
 * ⭐ 164.4-12 (review WR-02) — `executed` COMES FROM THE LANE, not from the
 * verdict loop. `laneArmSpawns` is the per-gate delta of `laneArmGateTally`,
 * incremented inside `runLane` beside the `spawnSync`. It deliberately
 * OVERWRITES the `executed: 0` the tally was constructed with, so the value the
 * caller could have influenced never survives into the row.
 *
 * That is what makes the absurdity floor's relation (3) real: `biting` here
 * descends from the lane-side counter, while the aggregate `bitingArms`
 * descends from `armsExecuted` in the verdict loop. Before this, both descended
 * from one increment and the relation could not fail.
 *
 * Defaults to an empty Map for `--parse-only`, which spawns no lane and must
 * report `judged 0` rather than borrow a count from a run that did not happen.
 */
function perFileRows(tallies, defects, laneArmSpawns = new Map()) {
  return tallies.map((t) => {
    const executed = laneArmSpawns.get(t.gateRel) ?? 0;
    const judged = executed - t.unjudged;
    const nonBiting = defects.filter(
      (d) => d.file === t.gateRel && NON_BITING_DEFECT_KINDS.includes(d.kind),
    ).length;
    return { ...t, executed, judged, biting: judged - nonBiting };
  });
}

/** One indented per-file line, in the per-item shape of the `  waived:` line. */
function logPerFileRows(rows, log) {
  for (const r of rows) {
    log(
      `  file ${r.name}: sections ${r.sections} / judged ${r.judged} / annotated ${r.annotated} / ` +
        `waived ${r.waived} / biting ${r.biting}`,
    );
  }
}

/**
 * Print the corpus classification: the excluded files by name, the DEFERRED
 * files by name with what the lane itself measured about their reason, then the
 * idiom files still awaiting annotation. Called at BOTH coverage print sites,
 * so the static mode and the gate say the same thing about the same corpus.
 *
 * `laneProbe` is `null` in every mode that spawns NO lane (`--parse-only`, and
 * a narrowed run whose `--file` matches no annotated gate). It is deliberately
 * not defaulted to "absent": a mode that measured nothing must print nothing
 * rather than assert the reassuring answer, which is the same
 * could-not-measure-is-not-measured-zero rule the NO-DEFAULTS check below
 * applies to the classes themselves.
 */
export function logCorpusClassification(corpus, log, laneProbe = null) {
  // ⛔ NO DEFAULTS. `[]` here would print `unreachable: 0 file(s)` for a corpus
  // whose derivation never ran — indistinguishable, to every reader, from a
  // corpus with nothing to exclude. That is the exact "could not measure read
  // as measured zero" shape invariant 2 of this file's header refuses, so a
  // missing class is a MEASURE_FAIL and stops the run instead of narrating a
  // full-coverage exclusion set the runner never computed.
  const { unreachableFiles, pendingFiles, inertFiles, laneBlockedFiles } = corpus;
  const missing = Object.entries({ unreachableFiles, pendingFiles, inertFiles, laneBlockedFiles })
    .filter(([, v]) => !Array.isArray(v))
    .map(([k, v]) => `${k}=${JSON.stringify(v)}`);
  if (missing.length > 0) {
    throw new Error(
      `MEASURE_FAIL — this is the GATE failing, not the corpus: logCorpusClassification was handed a ` +
        `corpus whose classification is not derivable (${missing.join(", ")}). An absent exclusion ` +
        `class is not a class with zero files in it.`,
    );
  }
  log(
    `unreachable: ${unreachableFiles.length} file(s) raise outside the runner's identity idiom — ` +
      `${unreachableFiles.join(" ")} (TODOS [REDUNDER-NONIDIOM])`,
  );
  // 164.4-03, criterion 4: an arm that cannot be given a falsifying mutation is
  // RECORDED with its reason, never silently skipped. The names are SORTED and
  // SINGLE-SPACE separated — a contract, not a style: ci.yml cross-checks the
  // claimed count against the `*.sql` tokens on this line, and the parser pin
  // asserts the exact set in this order.
  log(
    `lane-blocked: ${laneBlockedFiles.length} file(s) probe pg_extension for pg_cron, which the ` +
      `pg-lane cannot host — ${laneBlockedFiles.join(" ")} (deferred 2026-09-03, TODOS [REDUNDER-PGCRON])`,
  );
  if (laneProbe !== null) {
    // What the LANE said, not what the classification assumed. `available: null`
    // is "the probe ran and printed no marker" — already a `lane-unrunnable`
    // MEASURE_FAIL in-process, and printed here in a shape ci.yml's
    // `^lane-probe: pg_cron (absent|AVAILABLE)` grep deliberately does NOT
    // match, so the missing measurement fails there too.
    if (laneProbe.available === true) {
      log("lane-probe: pg_cron AVAILABLE — lane-blocked class is STALE");
    } else if (laneProbe.available === false) {
      log("lane-probe: pg_cron absent — lane-blocked class is current");
    } else {
      log(
        "lane-probe: UNREADABLE — the probe lane printed no LANE-PROBE marker, so pg_cron availability " +
          "was NOT measured and the lane-blocked class is unverified",
      );
    }
  }
  log(`  pending: ${pendingFiles.length} idiom file(s) without RED-UNDER — ${pendingFiles.join(" ")}`);
  // Zero today. A gate with no executable raise at all cannot fail, which is a
  // FINDING about that gate, not a coverage class — so it is printed only when
  // it exists, and it is printed loudly enough to be chased.
  if (inertFiles.length > 0) {
    log(
      `  inert: ${inertFiles.length} file(s) carry NO code-level RAISE EXCEPTION — ` +
        `${inertFiles.join(" ")} (a gate that cannot fail is a finding, not coverage)`,
    );
  }
}

/**
 * Copy the corpus into a scratch slot, PRESERVING repo-relative structure so an
 * annotation's `file` maps to its copy by path alone.
 */
function materialize(slotDir, relPaths) {
  const map = new Map();
  for (const rel of relPaths) {
    const src = join(REPO_ROOT, rel);
    if (!existsSync(src)) throw new Error(`corpus file not found: ${rel}`);
    const dst = join(slotDir, "src", rel);
    mkdirSync(dirname(dst), { recursive: true });
    copyFileSync(src, dst);
    map.set(rel, dst);
  }
  return map;
}

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

/**
 * @param {object} opts
 * @param {string} opts.scopeDir         directory whose *.sql files form the corpus
 * @param {string|null} [opts.onlyFile]  repo-relative gate path to narrow to
 * @param {string|null} [opts.onlyArm]   arm ID to narrow to
 * @param {number} [opts.filesFloor]     ratchet; overridable ONLY by --self-test
 * @param {number} [opts.armsFloor]
 * @param {number} [opts.waivedCeiling]  ceiling on waived arms; overridable ONLY by --self-test
 * @param {(o: {workdir:string, applyAbs:string[], postApplyAbs:string[], gateAbs:string, leg:string}) => {status:number|null, output:string, seconds:number, measureFail:string|null, invoked:boolean}} [opts.laneRunner]
 *        INJECTABLE lane runner, default the real `runLane`. Exists so the
 *        absurdity floor's FIRE direction and the lane-unrunnable MEASURE_FAIL
 *        can be driven through THIS function's real verdict loop and summary
 *        block without a cluster (a stub that never touches `laneTally`
 *        produces executed=N / lane-invocations=0 by construction). ⚠️ Only
 *        `--self-test` and vitest pass it; the CLI never does.
 * @param {(s:string)=>void} [opts.log]
 */
export function runCorpus({
  scopeDir,
  onlyFile = null,
  onlyArm = null,
  filesFloor = FILES_FLOOR,
  armsFloor = ARMS_FLOOR,
  waivedCeiling = WAIVED_CEILING,
  laneRunner = runLane,
  log = (s) => console.log(s),
}) {
  const narrowed = Boolean(onlyFile || onlyArm);
  const corpus = scanCorpus(scopeDir);
  const defects = [];
  const addDefect = (kind, arm, file, detail) => {
    if (!DEFECT_KINDS.includes(kind)) throw new Error(`unknown defect kind ${kind}`);
    defects.push({ kind, arm, file, detail });
  };

  let armsAnnotated = 0;
  let armsWaived = 0;
  let armsExecuted = 0;
  // Arms whose lane STARTED (so both tallies count it) but could not be judged
  // — signalled, or without an exit status. Subtracted from biting beside the
  // non-biting defect kinds; never counted as biting.
  let armsUnjudged = 0;
  const waivers = [];
  const timings = [];
  // 164.4-01 — the PER-FILE view (threat T-164.4-05). `filesAnnotated` counts a
  // file whose baseline went RED exactly like one whose 39 arms all bit: the
  // arm loop is `continue`d and the file still reads as coverage. So each
  // target keeps its own tally and the report prints it. Ratchet on `biting`,
  // never on `annotated`.
  const perFileTallies = [];

  // 164.3.1-10: the lane runner's tally is read as a DELTA across this run —
  // snapshot now, subtract at the summary. Never reset: this function does not
  // write that counter, and must not, or the two tallies stop being two.
  const laneTallyBefore = { ...laneTally };
  // WR-02: the same snapshot-delta discipline, per gate. Both tallies are
  // monotonic across `runCorpus` calls (the self-test makes many), so the row
  // has to describe THIS run.
  const laneArmGateBefore = new Map(laneArmGateTally);

  let targets = corpus.annotatedFiles;
  if (onlyFile) {
    const name = onlyFile.split("/").pop();
    targets = targets.filter((f) => f === name);
    if (targets.length === 0) {
      addDefect("parse", null, onlyFile, "--file names a gate with no line-start RED-UNDER markers");
    }
  }

  // Snapshot the working tree BEFORE any lane run. The invariant is "this run
  // did not touch the checkout", NOT "the developer has no uncommitted work" —
  // conflating those would make the guard fire on every in-progress edit, and a
  // guard that always fires gets disabled, which is how controls die.
  const treeBefore = gitStatus();

  // 164.4-03 — what the LANE says about pg_cron, measured once per run.
  // `null` until measured, and it stays `null` in a run that spawns no lane at
  // all; the print site treats that as "not measured", never as "absent".
  let laneProbe = null;

  const scratchRoot = mkdtempSync(join(tmpdir(), "mutation-runner-"));
  try {
    let slot = 0;
    const nextSlot = () => {
      const dir = join(scratchRoot, `slot-${slot++}`);
      mkdirSync(dir, { recursive: true });
      return dir;
    };

    // -------------------------------------------------------------------
    // THE LANE PROBE (164.4-03, threat T-164.4-11). The `lane-blocked:` class
    // is DERIVED from the corpus, but its printed reason — "which the pg-lane
    // cannot host" — is a claim about the LANE, and the derivation never
    // measures the lane. Without this, fixing [REDUNDER-PGCRON] would leave
    // four files parked behind a line that keeps reading true.
    //
    // ⚠️ WHEN. Every run that is going to spawn a lane anyway (`targets`
    // non-empty) — which is every real gate run and every `--file/--arm`
    // diagnostic — PLUS any run whose lane-blocked class is non-empty, because
    // that class is the claim this probe exists to falsify and a run asserting
    // it must measure it. A run that is neither spawns nothing: booting a
    // throwaway cluster purely to probe would make cluster-free modes — the
    // print-contract pins in mutation-runner-floors.test.ts among them — depend
    // on a PostgreSQL install. `--parse-only` never reaches this function.
    if (targets.length > 0 || corpus.laneBlockedFiles.length > 0) {
      const probeSlot = nextSlot();
      const probe = laneRunner({
        workdir: join(probeSlot, "lane"),
        applyAbs: [LANE_PROBE_APPLY],
        postApplyAbs: null,
        gateAbs: LANE_PROBE_GATE,
        leg: "probe",
      });
      // The MARKER, not the exit status: the probe gate RAISEs on AVAILABLE (so
      // the lane exits non-zero) and NOTICEs on absent (exit 0). Reading the
      // status would conflate "pg_cron is here" with "the lane broke".
      if (probe.output.includes(LANE_PROBE_AVAILABLE)) laneProbe = { available: true };
      else if (probe.output.includes(LANE_PROBE_ABSENT)) laneProbe = { available: false };
      else {
        laneProbe = { available: null };
        addDefect(
          "lane-unrunnable",
          null,
          null,
          `MEASURE_FAIL: the pg_cron probe printed no LANE-PROBE marker — the lane was NOT measured, so ` +
            `the lane-blocked class is unverified${probe.measureFail ? ` (${probe.measureFail})` : ""}`,
        );
      }
      // THE DEFERRAL EXPIRES HERE. A class derived from the corpus meeting a
      // lane that can host pg_cron is a stale deferral, and it reddens the gate
      // until the files are annotated — the opposite of parking them forever.
      if (laneProbe.available === true && corpus.laneBlockedFiles.length > 0) {
        addDefect(
          "lane-blocked-stale",
          null,
          null,
          `MEASURE_FAIL — the lane can host pg_cron but ${corpus.laneBlockedFiles.length} idiom file(s) are ` +
            `still classified lane-blocked: ${corpus.laneBlockedFiles.join(" ")}; annotate them ` +
            `(TODOS [REDUNDER-PGCRON]) — the deferral has expired`,
        );
      }
    }

    for (const name of targets) {
      const gateAbsRepo = join(scopeDir, name);
      const gateRel = relative(REPO_ROOT, gateAbsRepo);
      // Read ONCE and threaded into both readers, rather than `parseFile`
      // reading it and `gateSectionCount` reading it again.
      const gateText = readFileSync(gateAbsRepo, "utf8");
      const parsed = parseAnnotations(gateText, { file: gateAbsRepo });
      // Opened HERE, before any `continue` below, so a file that never reaches
      // an arm still gets a printed row saying so — and seeded at 0/0 for the
      // reason `newPerFileTally` documents.
      const tally = newPerFileTally({ name, gateRel, gateText, annotated: 0, waived: 0 });
      perFileTallies.push(tally);

      for (const err of parsed.errors) addDefect("parse", null, gateRel, err.message);
      if (!parsed.parity.ok) {
        addDefect(
          "parity",
          null,
          gateRel,
          `${parsed.parity.prose} prose RED-UNDER marker(s) vs ${parsed.parity.structured} RED-UNDER-M twin(s)`,
        );
      }
      if (!parsed.setup) {
        addDefect("parse", null, gateRel, "no RED-UNDER-SETUP line — the runner refuses to guess a corpus");
        continue;
      }

      const corpusRels = [...parsed.setup.apply, gateRel];

      // Static check: an annotation may only edit files this gate declares.
      let annotations = parsed.structured;
      const badRef = new Set();
      for (const ann of annotations) {
        for (const step of ann.apply) {
          if (step.kind === "sql") continue;
          if (!corpusRels.includes(step.file)) {
            addDefect(
              "bad-file-ref",
              ann.arm,
              gateRel,
              `step targets ${step.file}, which is not in this gate's RED-UNDER-SETUP apply list`,
            );
            badRef.add(ann.arm);
          }
        }
      }

      armsAnnotated += annotations.length;
      tally.annotated = annotations.length;
      for (const ann of annotations) {
        if (ann.waiver) {
          armsWaived += 1;
          tally.waived += 1;
          waivers.push({ arm: ann.arm, file: gateRel, reason: ann.waiver });
        }
      }

      // -------------------------------------------------------------------
      // Baseline: pristine copies must go GREEN before any mutation. A broken
      // corpus fails fast, so a red caused by the corpus is never miscredited
      // to a mutation.
      // -------------------------------------------------------------------
      const baseSlot = nextSlot();
      const baseMap = materialize(baseSlot, corpusRels);
      const baseline = laneRunner({
        workdir: join(baseSlot, "lane"),
        applyAbs: parsed.setup.apply.map((r) => baseMap.get(r)),
        postApplyAbs: null,
        gateAbs: baseMap.get(gateRel),
        leg: "baseline",
      });
      log(`  baseline  ${gateRel} — exit ${baseline.status} (${baseline.seconds.toFixed(1)}s)`);
      if (baseline.measureFail !== null) {
        addDefect(
          "lane-unrunnable",
          null,
          gateRel,
          `MEASURE_FAIL: ${baseline.measureFail} — the runner could not execute the baseline lane, so ` +
            `the pristine corpus was NOT measured and no arm of this gate was judged`,
        );
        continue;
      }
      if (baseline.status !== 0) {
        addDefect(
          "baseline",
          null,
          gateRel,
          // ⚠️ This one reader is a PLAIN-TEXT needle on purpose, and it is the
          // only one left in the file. It reads no ARM IDENTITY DECISION: the
          // baseline leg runs the pristine gate with no mutation at all, so
          // there is no adversary and nothing to attribute — the string is
          // pure diagnostic, telling a human which raise fired in a corpus
          // that was supposed to be green. Nothing downstream consumes it.
          `pristine corpus did not go GREEN (exit ${baseline.status}); first failure: ${
            baseline.output.match(identityRe())?.[1] ?? "none"
          }`,
        );
        continue; // arms cannot be judged against a red baseline
      }

      // -------------------------------------------------------------------
      // Per arm.
      // -------------------------------------------------------------------
      for (const ann of annotations) {
        if (ann.waiver) continue;
        if (badRef.has(ann.arm)) continue;
        if (onlyArm && ann.arm !== onlyArm) continue;

        const armSlot = nextSlot();
        const armMap = materialize(armSlot, corpusRels);

        // Neuters first, on the GATE copy.
        let gateText = readFileSync(armMap.get(gateRel), "utf8");
        let neuterFailed = false;
        for (const entry of ann.neuter) {
          const result = neuterArm(gateText, entry.arm);
          if (!result.found) {
            addDefect("neuter-missed", ann.arm, gateRel, `could not neuter "${entry.arm}": ${result.reason}`);
            neuterFailed = true;
            break;
          }
          gateText = result.text;
        }
        if (neuterFailed) continue;

        // ⛔ 164.3.1-05: the gate text is written back VERBATIM. The R3-C02
        // nonce stamp that used to happen here is DELETED, not disabled — it
        // transmitted the runner's secret to the server inside the query text,
        // where `current_query()` handed it straight to an attacker's trigger
        // ([R4-C02], measured live). Nothing is transmitted now; the identity
        // is the raise's SOURCE LOCATION, read back off the lane's output.
        writeFileSync(armMap.get(gateRel), gateText);

        // Mutation steps, in order, on the copies.
        const sqlStatements = [];
        let measureFailed = false;
        for (const step of ann.apply) {
          if (step.kind === "sql") {
            sqlStatements.push(step.stmt);
            continue;
          }
          const target = armMap.get(step.file);
          const before = readFileSync(target, "utf8");
          const applied = applyFileStep(before, step);
          if (!applied.ok) {
            const needle = step.kind === "edit" ? step.find : step.anchor;
            addDefect(
              "occurrence-mismatch",
              ann.arm,
              gateRel,
              `MEASURE_FAIL: ${JSON.stringify(needle)} occurs ${applied.actual}x in ${step.file}, annotation claims ${step.occurrences}x — mutation NOT applied, so this arm was NOT tested`,
            );
            measureFailed = true;
            break;
          }
          const rewrite = identityRewriteDetail(before, applied.text, step.file);
          if (rewrite !== null) {
            addDefect("identity-rewrite", ann.arm, gateRel, rewrite);
            measureFailed = true;
            break;
          }
          writeFileSync(target, applied.text);
        }
        if (measureFailed) continue;

        let postApplyAbs = null;
        if (sqlStatements.length > 0) {
          postApplyAbs = join(armSlot, "post-apply.sql");
          writeFileSync(postApplyAbs, `${sqlStatements.map((s) => `${s};`).join("\n")}\n`);
        }

        const gateAbs = armMap.get(gateRel);
        const run = laneRunner({
          workdir: join(armSlot, "lane"),
          applyAbs: parsed.setup.apply.map((r) => armMap.get(r)),
          postApplyAbs,
          gateAbs,
          leg: "arm",
          // WR-02: the key the lane-side per-file tally counts under. `gateAbs`
          // points into this arm's throwaway slot and changes every arm, so the
          // stable repo-relative path is what the column has to be keyed by.
          gateKey: gateRel,
        });
        // ── the lane could not be RUN: MEASURE_FAIL, the arm was NOT judged ──
        // Handled the way `attribution.measureFail` is below: its own name,
        // never collapsed into `no-red` / `wrong-first-failure`. A lane that
        // STARTED and died (signal) counts as executed — the lane tally counted
        // its spawn, and the two tallies must keep agreeing — but never as
        // biting; one that never started counts as nothing at all.
        if (run.measureFail !== null) {
          if (run.invoked) {
            armsExecuted += 1;
            armsUnjudged += 1;
            // `tally.executed` is NOT incremented here (WR-02): the per-file
            // column is measured on the lane side, in `runLane`, which already
            // counted this spawn. `unjudged` stays a verdict-loop fact — only
            // the loop knows the arm reached no verdict.
            tally.unjudged += 1;
          }
          addDefect(
            "lane-unrunnable",
            ann.arm,
            gateRel,
            `MEASURE_FAIL: ${run.measureFail} — the runner could not execute the lane, so this arm ` +
              `was NOT judged. Neither RED nor GREEN is a measurement here; it is not counted as biting.`,
          );
          log(`  arm ${ann.arm.padEnd(24)} exit ${String(run.status).padStart(3)}  MEASURE-FAIL(lane)`);
          continue;
        }
        // The verdict loop's OWN count. Its twin is `laneTally.arm`, kept
        // inside runLane; the summary cross-checks the two (164.3.1-10).
        //
        // ⛔ WR-02: do NOT add `tally.executed += 1` back here. The per-file
        // column is derived in `perFileRows` from `laneArmGateTally` — the
        // lane-side counter — precisely so the per-file cross-sum is a SECOND
        // measurement of this line rather than a copy of it. An increment here
        // would restore the by-construction agreement the review named.
        armsExecuted += 1;
        timings.push(run.seconds);

        // ── 164.3.1-05: attribute by SOURCE LOCATION ────────────────────────
        // Records come from the gate copy AS THE LANE RAN IT — read back off
        // disk AFTER the mutation steps, because a mutation may legally edit
        // the gate file and psql reports the lines of the bytes it parsed.
        const attribution = attributeIdentities(run.output, {
          gatePath: gateAbs,
          records: gateAttributionRecords(readFileSync(gateAbs, "utf8")),
        });
        const first = attribution.firstAttributed;
        const synthesised = attribution.unattributable;
        let verdict;
        if (attribution.measureFail !== null) {
          // The output grammar itself was unreadable. This must NEVER collapse
          // into "no attributable arm" — that reads identically to a real
          // defect and would let an unobserved host pass or fail for reasons
          // nobody can diagnose from the log.
          verdict = "MEASURE-FAIL(output-grammar)";
          addDefect(
            "synthesised-identity",
            ann.arm,
            gateRel,
            `MEASURE_FAIL: ${attribution.measureFail}. This arm was NOT judged — the runner could ` +
              `not read the lane's output, so neither RED nor GREEN is a measurement here.`,
          );
        } else if (synthesised.length > 0) {
          // ── An identity the runner cannot ATTRIBUTE was SYNTHESISED ───────
          // Checked FIRST, before red/no-red, and over ALL output rather than
          // the first ERROR — a `RAISE NOTICE` can carry the identity without
          // aborting the lane at all (MEASURED: exit 0, severity NOTICE). This
          // is the arbiter that cannot be re-spelled around, because it does
          // not read the annotation's text: it reads WHERE the raise came from.
          verdict = `SYNTHESISED(${synthesised[0].identity})`;
          addDefect(
            "synthesised-identity",
            ann.arm,
            gateRel,
            `MEASURE_FAIL: the lane emitted TEST FAILED (${synthesised[0].identity}), which this ` +
              `runner's gate file did not raise. WHY IT IS NOT ATTRIBUTABLE: ${synthesised[0].why}. ` +
              `WHAT WAS SEEN: ${synthesised[0].seen}. EXPECTED, for a genuine arm: an ERROR/P0001 ` +
              `block under ${gateAbs} whose CONTEXT chain is exactly one ` +
              `"PL/pgSQL function inline_code_block line N at RAISE" frame resolving to ` +
              `${describeExpectedRaise(attribution, synthesised[0].identity, gateAbs)}. The mutation ` +
              `satisfied the DETECTOR instead of the arm. This arm is NOT counted as biting. ` +
              `Mutate the code under test, never the failure output.` +
              (synthesised.length > 1 ? ` (+${synthesised.length - 1} further unattributable sighting(s))` : ""),
          );
        } else if (run.status === 0) {
          verdict = "NO-RED";
          addDefect(
            "no-red",
            ann.arm,
            gateRel,
            "the mutation applied (occurrence count verified) but the gate still passed — this arm cannot fail",
          );
        } else if (first === null) {
          verdict = "NO-IDENTITY";
          addDefect(
            "wrong-first-failure",
            ann.arm,
            gateRel,
            `gate exited ${run.status} but no "TEST FAILED (…)" in its output was ATTRIBUTABLE to a ` +
              `raise in ${gateAbs} — the failure is not attributable to any arm. EXPECTED: an ` +
              `ERROR/P0001 block under that path whose CONTEXT chain is exactly one ` +
              `"PL/pgSQL function inline_code_block line N at RAISE" frame resolving to ` +
              `${describeExpectedRaise(attribution, ann.arm, gateAbs)}. ` +
              `SIGHTINGS: ${describeSightings(attribution)}`,
          );
        } else if (first !== ann.arm) {
          verdict = `WRONG-ARM(${first})`;
          addDefect(
            "wrong-first-failure",
            ann.arm,
            gateRel,
            `first failure was "${first}", not "${ann.arm}" — red-anywhere is not success`,
          );
        } else {
          verdict = "RED (identity ok)";
        }

        // A neuter that silently missed leaves the shadowing arm live, which
        // would make the identity check fail for the wrong reason.
        //
        // ⚠️ This reads the PLAIN identity text ANYWHERE in the output, not an
        // attributed sighting, and that direction is deliberate. Under the
        // nonce this was `stampedIdentity(...)`, which a forgery could evade;
        // now the only thing a forgery can do here is make CI FAIL for an arm
        // that was neutered — the loud direction. A neuter that truly took
        // effect leaves the raise commented out, so the gate cannot emit it.
        //
        // ⚠️ KNOWN FALSE-POSITIVE SHAPE (F5, 164.3.1 adversarial review), left
        // as is on purpose: a `RAISE NOTICE` elsewhere in the gate that ECHOES
        // the neutered arm's identity (`RAISE NOTICE 'SHAPE 3b ok'` does not,
        // but `RAISE NOTICE 'skipping TEST FAILED (SHAPE 3b)'` would) trips
        // this substring check and reports `neuter-missed` for a neuter that
        // worked. That is a loud failure against an odd gate, which is the
        // direction this check is allowed to be wrong in; it is NOT redesigned
        // into an attributed read, because an attributed read is exactly what
        // a forgery targets.
        for (const entry of ann.neuter) {
          if (run.output.includes(`${IDENTITY_CARRIER}${entry.arm})`)) {
            addDefect(
              "neuter-missed",
              ann.arm,
              gateRel,
              `neutered arm "${entry.arm}" still appeared in the output`,
            );
          }
        }

        log(
          `  arm ${ann.arm.padEnd(24)} exit ${String(run.status).padStart(3)}  ${verdict}  (${run.seconds.toFixed(1)}s)`,
        );
      }

      // -------------------------------------------------------------------
      // Restore leg (D-02): pristine copies GREEN again after the arm runs.
      // Mutations only ever touched copies, so this proves the corpus is
      // unchanged rather than merely asserting it.
      // -------------------------------------------------------------------
      const restoreSlot = nextSlot();
      const restoreMap = materialize(restoreSlot, corpusRels);
      const restore = laneRunner({
        workdir: join(restoreSlot, "lane"),
        applyAbs: parsed.setup.apply.map((r) => restoreMap.get(r)),
        postApplyAbs: null,
        gateAbs: restoreMap.get(gateRel),
        leg: "restore",
      });
      log(`  restore   ${gateRel} — exit ${restore.status} (${restore.seconds.toFixed(1)}s)`);
      if (restore.measureFail !== null) {
        addDefect(
          "lane-unrunnable",
          null,
          gateRel,
          `MEASURE_FAIL: ${restore.measureFail} — the runner could not execute the restore lane, so ` +
            `the corpus was NOT proven green after the arm runs`,
        );
      } else if (restore.status !== 0) {
        addDefect("restore", null, gateRel, `pristine corpus did not go GREEN after the arm runs (exit ${restore.status})`);
      }
    }
  } finally {
    rmSync(scratchRoot, { recursive: true, force: true });
  }

  // -----------------------------------------------------------------------
  // The checkout must be untouched (T-164.3-13).
  // -----------------------------------------------------------------------
  const treeAfter = gitStatus();
  if (treeBefore === null || treeAfter === null) {
    // An absent measurement must never read as a pass.
    addDefect("dirty-checkout", null, null, "MEASURE_FAIL: could not run `git status --porcelain` to prove the checkout was untouched");
  } else {
    const before = new Set(treeBefore);
    const after = new Set(treeAfter);
    const changed = [
      ...treeAfter.filter((l) => !before.has(l)).map((l) => `+ ${l}`),
      ...treeBefore.filter((l) => !after.has(l)).map((l) => `- ${l}`),
    ];
    if (changed.length > 0) {
      addDefect(
        "dirty-checkout",
        null,
        null,
        `the run changed the working tree — mutations must only ever touch scratch copies:\n    ${changed.join("\n    ")}`,
      );
    }
  }

  // -----------------------------------------------------------------------
  // Coverage + ratchet (D-01, D-09)
  // -----------------------------------------------------------------------
  log("");
  log(`coverage: files ${corpus.filesAnnotated}/${corpus.filesTotal}`);
  logCorpusClassification(corpus, log, laneProbe);
  log(`arms: ${armsExecuted}/${armsAnnotated}/${armsWaived}   (executed/annotated/waived)`);
  // IN-05: the number ARMS_FLOOR is actually compared against, printed under
  // its own name.
  //
  // The floor here compares `biting` — executed arms MINUS those that failed
  // to redden or reddened on the wrong arm. The CI assertion parsed `arms:
  // E/A/W` and compared raw E, then reported an "ARMS_FLOOR regression" using
  // a quantity the constant was never measured against. On a run with any
  // non-biting arm the two disagree. That is not a hole — the runner exits 1
  // on such a run first — but two meanings under one name is how a floor
  // decays into a number nobody compares. So CI now reads THIS line.
  // ⛔ R3-C02: `synthesised-identity` MUST subtract here. It is raised for an
  // arm that DID execute a lane, so without this term the arm would still be
  // counted as biting — which is the whole defect: a vacuous PASS inflating
  // the one number ARMS_FLOOR bounds.
  // ⛔ 2026-09-02: `armsUnjudged` (a lane that started and died) subtracts too
  // — its arm is in `armsExecuted` so the tallies agree, and it was never
  // judged, so it is not biting. `lane-unrunnable` defects are NOT subtracted
  // by kind: the never-started case raises one without ever incrementing
  // `armsExecuted`, and subtracting it would push biting below what ran.
  const bitingArms =
    armsExecuted - armsUnjudged - defects.filter((d) => NON_BITING_DEFECT_KINDS.includes(d.kind)).length;
  log(`biting: ${bitingArms}   (executed arms that reddened their OWN arm first — the quantity ARMS_FLOOR bounds)`);
  // 164.3.1-10: the lane runner's OWN count of arm lanes, printed beside the
  // verdict loop's `arms:` so the two can be compared — here, and again by the
  // CI count-recheck step, which parses this line and MEASURE_FAILs on its
  // absence. The non-arm legs are printed as evidence, not compared.
  const laneLegs = {
    baseline: laneTally.baseline - laneTallyBefore.baseline,
    arm: laneTally.arm - laneTallyBefore.arm,
    restore: laneTally.restore - laneTallyBefore.restore,
    // 164.4-03: carried on the RESULT as evidence, deliberately NOT on the
    // `lane-invocations:` line — ci.yml parses that line's text, and the
    // absurdity floor's exact equality is asserted on `arm` alone.
    probe: laneTally.probe - laneTallyBefore.probe,
  };
  const laneInvocations = laneLegs.arm;
  log(
    `lane-invocations: ${laneInvocations}   (arm lanes actually spawned — tallied inside runLane, ` +
      `independent of the ${armsExecuted} the verdict loop counted; plus ${laneLegs.baseline} ` +
      `baseline / ${laneLegs.restore} restore leg(s))`,
  );
  const laneArmSpawns = new Map();
  for (const [gate, total] of laneArmGateTally) {
    const delta = total - (laneArmGateBefore.get(gate) ?? 0);
    if (delta > 0) laneArmSpawns.set(gate, delta);
  }
  const fileRows = perFileRows(perFileTallies, defects, laneArmSpawns);
  logPerFileRows(fileRows, log);
  for (const w of waivers) log(`  waived: ${w.arm} — ${w.reason}`);
  if (timings.length > 0) {
    const total = timings.reduce((a, b) => a + b, 0);
    log(`per-arm lane time: mean ${(total / timings.length).toFixed(1)}s over ${timings.length} arm run(s)`);
  }

  if (narrowed) {
    log("");
    log("⚠️ NARROWED DIAGNOSTIC RUN (--file/--arm): coverage floors NOT enforced.");
    log("   This mode never exits 0, so it can never be mistaken for a passing gate.");
  } else {
    if (corpus.filesAnnotated < filesFloor) {
      addDefect(
        "floor",
        null,
        scopeDir,
        `FILES_FLOOR regression: ${corpus.filesAnnotated} annotated file(s) < floor ${filesFloor}`,
      );
    }
    if (bitingArms < armsFloor) {
      addDefect("floor", null, scopeDir, `ARMS_FLOOR regression: ${bitingArms} biting arm(s) < floor ${armsFloor}`);
    }
    // The ceiling on waivers (see WAIVED_CEILING): a waiver twin satisfies
    // parity and inflates the annotated counts without a lane ever running, so
    // the count is bounded from ABOVE here and again by the CI count-recheck
    // step, which parses the W field of the `arms:` line above.
    if (armsWaived > waivedCeiling) {
      addDefect(
        "floor",
        null,
        scopeDir,
        `WAIVED_CEILING exceeded: ${armsWaived} waived arm(s) > ceiling ${waivedCeiling}. A waiver is an ` +
          `arm the runner will never prove can fail; adding one is a reviewed edit to WAIVED_CEILING ` +
          `in scripts/mutation-runner/run.mjs, never a side effect of annotating.`,
      );
    }
  }

  // -----------------------------------------------------------------------
  // Absurdity floor (164.3.1-10, D-09): the runner's own counts must agree.
  // Applied in EVERY mode, narrowed included — a diagnostic run that miscounts
  // is no more trustworthy than a full one. See absurdityViolations.
  // -----------------------------------------------------------------------
  for (const violation of absurdityViolations({
    armsExecuted,
    laneInvocations,
    biting: bitingArms,
    perFile: fileRows,
    armsAnnotated,
  })) {
    addDefect("absurdity", null, null, violation);
  }

  // -----------------------------------------------------------------------
  // Aggregate report (OPS-08-F8): every arm ran; nothing exited early.
  // -----------------------------------------------------------------------
  log("");
  if (defects.length === 0) {
    log(narrowed ? "No defects in the narrowed scope." : "✅ No defects. Every annotated arm bit its own arm first.");
  } else {
    log(`❌ ${defects.length} defect(s):`);
    log("");
    log("  KIND                  ARM                       FILE");
    log("  --------------------  ------------------------  ----");
    for (const d of defects) {
      log(`  ${d.kind.padEnd(20)}  ${(d.arm ?? "-").padEnd(24)}  ${d.file ?? "-"}`);
      log(`      ${d.detail}`);
    }
  }

  return {
    scopeDir,
    narrowed,
    filesTotal: corpus.filesTotal,
    filesAnnotated: corpus.filesAnnotated,
    armsAnnotated,
    armsExecuted,
    armsWaived,
    // Exposed so the self-test can assert the number ARMS_FLOOR is compared
    // against, rather than re-deriving it from the defect list and agreeing
    // with the implementation by construction.
    bitingArms,
    // 164.3.1-10: the lane runner's arm-leg count this run was cross-checked
    // against, exposed for the same reason; the other legs beside it.
    laneInvocations,
    laneLegs,
    defects,
    exitCode: defects.length > 0 ? 1 : narrowed ? 2 : 0,
  };
}

/**
 * The directory a `--file <gate>` run is scoped to. IN-02 (164.3.1 review):
 * an ABSOLUTE gate path used to be joined onto cwd (`<cwd>/<abs>`), so the
 * scope pointed nowhere and the run reported "--file names a gate with no
 * line-start RED-UNDER markers" — loud (exit 1), but for the wrong reason.
 *
 * REFUSES a path that resolves OUTSIDE the repo (throws, and `main` turns that
 * into exit 3). `relative(REPO_ROOT, abs)` for such a path begins with `..`,
 * and joining that back onto REPO_ROOT would scope the run to an arbitrary
 * directory on the machine — the runner copies and executes every `*.sql` it
 * finds there.
 */
export function scopeDirForFile(onlyFile, cwd = process.cwd()) {
  const abs = isAbsolute(onlyFile) ? onlyFile : join(cwd, onlyFile);
  const rel = relative(REPO_ROOT, abs);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error(
      `--file must name a gate INSIDE the repo: ${JSON.stringify(onlyFile)} resolves to ${abs}, ` +
        `outside ${REPO_ROOT}`,
    );
  }
  return join(REPO_ROOT, dirname(rel));
}

// ---------------------------------------------------------------------------
// --parse-only: the STATIC half of the gate. No cluster, no mutation.
// ---------------------------------------------------------------------------
//
// Added by plan 164.3-08 because annotating 30 real arms needs a sub-second
// answer to "is every prose marker twinned, and does every needle still match
// the bytes it claims?". Booting a cluster per arm to learn that a JSON object
// is malformed is a 65-second answer to a 50-millisecond question.
//
// ⛔ THIS MODE IS NOT THE GATE AND MUST NEVER BE WIRED INTO CI AS ONE. It runs
// ZERO arms, so it cannot observe a non-biting annotation — the defect the
// whole phase exists to detect. It exits 0 on a clean parse (unlike
// --file/--arm, which exit 2) because it checks the WHOLE corpus rather than a
// subset, and its own contract is a static one it fully discharges. The
// mechanism that stops it being mistaken for the gate is not this comment: the
// CI job asserts the printed `arms:` line shows an EXECUTED count at or above
// ARMS_FLOOR, and this mode always prints 0 executed. Swap the invocation and
// that assertion fails.
//
// It DOES measure `occurrences` against the real bytes. That is a static
// measurement, not a mutation, and it is what catches the plan-01 prose-locator
// hazard (a needle that drifted, or was never there) without a cluster.
export function parseOnlyCorpus({ scopeDir, log = (s) => console.log(s) }) {
  const corpus = scanCorpus(scopeDir);
  const defects = [];
  const addDefect = (kind, arm, file, detail) => {
    if (!DEFECT_KINDS.includes(kind)) throw new Error(`unknown defect kind ${kind}`);
    defects.push({ kind, arm, file, detail });
  };

  let armsAnnotated = 0;
  let armsWaived = 0;
  const waivers = [];
  // Same per-file view as the gate path, with the two lane-dependent columns
  // pinned at 0 — this mode runs no lane, so nothing is judged and nothing
  // bites. Printing them as 0 rather than omitting the columns keeps the two
  // modes' line shape identical, which is what lets one regex read both.
  const perFileTallies = [];

  for (const name of corpus.annotatedFiles) {
    const gateAbsRepo = join(scopeDir, name);
    const gateRel = relative(REPO_ROOT, gateAbsRepo);
    // Read ONCE and threaded into both readers, as in the gate path.
    const gateText = readFileSync(gateAbsRepo, "utf8");
    const parsed = parseAnnotations(gateText, { file: gateAbsRepo });
    // Seeded from the static parse, not 0/0: this mode runs no lane, so the
    // twins a file carries ARE its whole product. See `newPerFileTally`.
    const tally = newPerFileTally({
      name,
      gateRel,
      gateText,
      annotated: parsed.structured.length,
      waived: parsed.structured.filter((a) => a.waiver).length,
    });
    perFileTallies.push(tally);

    for (const err of parsed.errors) addDefect("parse", null, gateRel, err.message);
    if (!parsed.parity.ok) {
      addDefect(
        "parity",
        null,
        gateRel,
        `${parsed.parity.prose} prose RED-UNDER marker(s) vs ${parsed.parity.structured} RED-UNDER-M twin(s)`,
      );
    }
    log(
      `  ${gateRel}: ${parsed.parity.prose} prose / ${parsed.parity.structured} twin(s) / ` +
        `${parsed.structured.filter((a) => a.waiver).length} waiver(s)`,
    );

    armsAnnotated += parsed.structured.length;
    for (const ann of parsed.structured) {
      if (ann.waiver) {
        armsWaived += 1;
        waivers.push({ arm: ann.arm, file: gateRel, reason: ann.waiver });
      }
    }

    if (!parsed.setup) {
      addDefect("parse", null, gateRel, "no RED-UNDER-SETUP line — the runner refuses to guess a corpus");
      continue;
    }
    for (const rel of parsed.setup.apply) {
      if (!existsSync(join(REPO_ROOT, rel))) {
        addDefect("bad-file-ref", null, gateRel, `RED-UNDER-SETUP names a file that does not exist: ${rel}`);
      }
    }

    const corpusRels = [...parsed.setup.apply, gateRel];
    // WR-02 (164.3.1 review): MODE IDENTITY. `runCorpus` re-reads each target
    // after writing a step, so step N sees step N-1's output. This mode used
    // to count every step against the PRISTINE repo file, so a LAYERED
    // annotation (GRAMMAR Shape 3) whose second needle exists only after the
    // first was a MEASURE_FAIL here and clean in the real run. The text is
    // threaded forward per file, per annotation, exactly as the real run and
    // the REAL CORPUS arm in mutation-annotation-parser.test.ts do — and, as
    // there, the first step that cannot be applied ends the annotation.
    const buffers = new Map();
    for (const ann of parsed.structured) {
      buffers.clear();
      for (const step of ann.apply) {
        if (step.kind === "sql") continue;
        if (!corpusRels.includes(step.file)) {
          addDefect(
            "bad-file-ref",
            ann.arm,
            gateRel,
            `step targets ${step.file}, which is not in this gate's RED-UNDER-SETUP apply list`,
          );
          continue;
        }
        const target = join(REPO_ROOT, step.file);
        if (!existsSync(target)) {
          addDefect("bad-file-ref", ann.arm, gateRel, `step targets a file that does not exist: ${step.file}`);
          continue;
        }
        const needle = step.kind === "edit" ? step.find : step.anchor;
        if (!buffers.has(step.file)) buffers.set(step.file, readFileSync(target, "utf8"));
        const before = buffers.get(step.file);
        const actual = countOccurrences(before, needle);
        if (actual !== step.occurrences) {
          addDefect(
            "occurrence-mismatch",
            ann.arm,
            gateRel,
            `MEASURE_FAIL: ${JSON.stringify(needle)} occurs ${actual}x in ${step.file}, annotation claims ${step.occurrences}x`,
          );
          break;
        }
        // R2-W04: identity rewriting is decidable WITHOUT a lane, so refuse it
        // here too. `--parse-only` is what CI runs on platforms with no
        // database, and an annotation that re-points a raise must not have to
        // wait for a lane to be caught.
        const applied = applyFileStep(before, step);
        if (!applied.ok) break;
        const rewrite = identityRewriteDetail(before, applied.text, step.file);
        if (rewrite !== null) {
          addDefect("identity-rewrite", ann.arm, gateRel, rewrite);
          break;
        }
        buffers.set(step.file, applied.text);
      }
    }
  }

  log("");
  log(`coverage: files ${corpus.filesAnnotated}/${corpus.filesTotal}`);
  logCorpusClassification(corpus, log);
  log(`arms: 0/${armsAnnotated}/${armsWaived}   (executed/annotated/waived)`);
  logPerFileRows(perFileRows(perFileTallies, defects), log);
  for (const w of waivers) log(`  waived: ${w.arm} — ${w.reason}`);
  log("");
  log("⚠️ STATIC PARSE ONLY — ZERO arms executed. This is NOT the gate: it cannot");
  log("   observe a non-biting annotation. Run `node scripts/mutation-runner/run.mjs`.");
  log("");

  if (defects.length === 0) {
    log("✅ No static defects. Every prose marker has a twin and every needle still matches.");
  } else {
    log(`❌ ${defects.length} static defect(s):`);
    log("");
    for (const d of defects) {
      log(`  ${d.kind.padEnd(20)}  ${(d.arm ?? "-").padEnd(24)}  ${d.file ?? "-"}`);
      log(`      ${d.detail}`);
    }
  }

  return {
    scopeDir,
    filesTotal: corpus.filesTotal,
    filesAnnotated: corpus.filesAnnotated,
    armsAnnotated,
    armsWaived,
    defects,
    exitCode: defects.length > 0 ? 1 : 0,
  };
}

// ---------------------------------------------------------------------------
// --self-test: prove BOTH exit-1 modes actually fire (D-09), machine-checked;
// and, since 164.3.1-11, drive the REGRESSION CORPUS — every measured instance
// of the phase-164.3.1 primitives as a permanent lane-driven arm (SC-1).
//
// ⚠️ The `N/M` scenario headers are a COUNTED set. Before adding or removing a
// scenario, grep for the current denominator across run.mjs, src/__tests__
// (with -a) and .github/workflows and renumber every spelling in one edit — a
// stale count makes this self-test lie about its own coverage.
// ---------------------------------------------------------------------------

const SELFTEST_DIR = join(FIXTURE_CORPUS, "selftest");

function expect(condition, message) {
  if (!condition) {
    console.error(`SELF-TEST FAIL: ${message}`);
    return false;
  }
  console.log(`  ok — ${message}`);
  return true;
}

/**
 * "no defect of these kinds" — the ONE spelling every ABSENCE assertion in
 * `selfTest()` uses.
 *
 * ⛔ NEVER spell an absence as `!defects.some((x) => x.kind === "<k>")`. The
 * coverage extractor in `src/__tests__/mutation-runner-floors.test.ts` scans
 * `selfTest()`'s SOURCE — comments included — for `kind === "<k>"` and treats
 * every match as a kind the self-test EXERCISES. An absence proves only that a
 * kind did NOT appear, so crediting it would be a vacuity inside the vacuity
 * gate: the kind would keep reading as covered after its one POSITIVE arm was
 * renamed or deleted. Going through the kind LIST keeps the extractor honest by
 * construction rather than by each author remembering.
 *
 * `where` narrows the absence further (a detail regex); it defaults to "any
 * defect of that kind at all".
 */
function noDefectOfKind(defects, kinds, where = () => true) {
  return !defects.some((x) => kinds.includes(x.kind) && where(x));
}

function selfTest() {
  const quiet = () => {};
  let pass = true;

  // ⚠️ EVERY SCENARIO PASSES AN EXPLICIT `armsFloor`, and that is required for
  // the checks to measure what they name. The synthetic corpora carry 2 arms;
  // the REAL ARMS_FLOOR is 189 (measured 2026-09-03, plan 164.4-07). Inheriting
  // the default would add a spurious `floor` defect to every scenario below and
  // break check 6 outright, so each states the floor appropriate to ITS corpus.
  // Check 5 is where an ARMS_FLOOR regression is proven to fire — the mode that
  // could not be proven at all while the floor was 0.
  //
  // ⛔ THE SAME IS NOW TRUE OF `filesFloor`, AND IT BIT (plan 164.4-04). While
  // the real FILES_FLOOR was 1 it happened to equal the fixture corpus's own
  // annotated-file count, so scenarios 5 and 6 could inherit it and stay green
  // by COINCIDENCE. The phase's first FILE move (1 -> 4) turned that coincidence
  // into `FILES_FLOOR regression: 1 annotated file(s) < floor 4` in a scenario
  // about ARMS_FLOOR and in the green-corpus scenario. Every whole-corpus
  // scenario therefore states its OWN `filesFloor`, exactly as it states its own
  // `armsFloor` and `waivedCeiling`; a self-test that moves when a production
  // floor moves is measuring the constant, not the mechanism.
  console.log("=== SELF-TEST 1/17: a non-biting annotation must exit 1 with `no-red` ===");
  const a = runCorpus({ scopeDir: SELFTEST_DIR, onlyFile: "nonbiting-gate.sql", armsFloor: 0, log: quiet });
  pass =
    expect(a.exitCode === 1, `exit code is 1 (got ${a.exitCode})`) &&
    expect(
      a.defects.some((d) => d.kind === "no-red" && d.arm === "NONBITE 1"),
      'the defect table names NONBITE 1 with kind "no-red"',
    ) &&
    pass;

  console.log("=== SELF-TEST 2/17: a FILES_FLOOR regression must exit 1 with `floor` ===");
  // ⚠️ The fixture corpus carries ONE waiver (MINI 3), so every whole-corpus
  // scenario states `waivedCeiling: 1` — its own measured number — exactly as
  // it states its own armsFloor. Scenario 5 is where the ceiling is proven to
  // FIRE, by stating 0 against that same corpus.
  const b = runCorpus({ scopeDir: FIXTURE_CORPUS, filesFloor: 99, armsFloor: 0, waivedCeiling: 1, log: quiet });
  pass =
    expect(b.exitCode === 1, `exit code is 1 (got ${b.exitCode})`) &&
    expect(
      b.defects.some((d) => d.kind === "floor" && /FILES_FLOOR regression/.test(d.detail)),
      "the defect table names a FILES_FLOOR regression",
    ) &&
    pass;

  console.log("=== SELF-TEST 3/17: reddening the WRONG arm must exit 1 with `wrong-first-failure` ===");
  const c = runCorpus({ scopeDir: SELFTEST_DIR, onlyFile: "wrong-identity-gate.sql", armsFloor: 0, log: quiet });
  pass =
    expect(c.exitCode === 1, `exit code is 1 (got ${c.exitCode})`) &&
    expect(
      c.defects.some(
        (d) => d.kind === "wrong-first-failure" && d.arm === "WRONGID 2b" && d.detail.includes("WRONGID PIN"),
      ),
      'the defect names WRONGID 2b and reports "WRONGID PIN" as the actual first failure',
    ) &&
    pass;

  console.log("=== SELF-TEST 4/17: a wrong `occurrences` must exit 1 with MEASURE_FAIL, NOT `no-red` ===");
  const d = runCorpus({ scopeDir: SELFTEST_DIR, onlyFile: "occurrence-mismatch-gate.sql", armsFloor: 0, log: quiet });
  pass =
    expect(d.exitCode === 1, `exit code is 1 (got ${d.exitCode})`) &&
    expect(
      d.defects.some((x) => x.kind === "occurrence-mismatch" && x.arm === "OCCMISS 1"),
      'the defect table names OCCMISS 1 with kind "occurrence-mismatch"',
    ) &&
    expect(
      noDefectOfKind(d.defects, ["no-red"]),
      'no "no-red" defect is reported — an unmeasurable mutation is not a non-biting arm',
    ) &&
    pass;

  // ⭐ THE MODE PLAN 05 COULD NOT PROVE. While ARMS_FLOOR was 0 no regression
  // could be constructed, so `--self-test` shipped exercising only the
  // FILES_FLOOR half of D-09's floor mode. Now that the floor is a measured 30
  // this check exists, and it is what stops the pinned floor from decaying back
  // into a constant nobody compares to anything.
  console.log(
    "=== SELF-TEST 5/17: an ARMS_FLOOR regression must exit 1 with `floor`, and so must a WAIVED_CEILING excess ===",
  );
  // waivedCeiling 0 against a corpus carrying 1 waiver: the ceiling's FIRE
  // direction, in the same run as the ARMS_FLOOR one. Both are `floor` defects
  // and each must be distinguishable BY NAME from the other two.
  const f = runCorpus({ scopeDir: FIXTURE_CORPUS, filesFloor: 1, armsFloor: 99, waivedCeiling: 0, log: quiet });
  pass =
    expect(f.exitCode === 1, `exit code is 1 (got ${f.exitCode})`) &&
    expect(
      f.defects.some((x) => x.kind === "floor" && /ARMS_FLOOR regression/.test(x.detail)),
      "the defect table names an ARMS_FLOOR regression",
    ) &&
    expect(
      f.defects.some((x) => x.kind === "floor" && /WAIVED_CEILING exceeded: 1 waived arm\(s\) > ceiling 0/.test(x.detail)),
      "the defect table names a WAIVED_CEILING excess with both numbers — 1 waived arm against a ceiling of 0",
    ) &&
    expect(
      noDefectOfKind(f.defects, ["floor"], (x) => /FILES_FLOOR/.test(x.detail)),
      "no FILES_FLOOR defect — the three bounds are reported distinguishably",
    ) &&
    pass;

  console.log("=== SELF-TEST 6/17: the green fixture corpus must exit 0 ===");
  const e = runCorpus({ scopeDir: FIXTURE_CORPUS, filesFloor: 1, armsFloor: 2, waivedCeiling: 1, log: quiet });
  pass =
    expect(e.exitCode === 0, `exit code is 0 (got ${e.exitCode}; defects: ${JSON.stringify(e.defects)})`) &&
    expect(e.armsExecuted === 2, `2 arms executed (got ${e.armsExecuted})`) &&
    // 164.3.1-10: the lane runner's OWN tally counted through REAL lanes, and
    // it agrees with the verdict loop — the absurdity floor's SILENT direction
    // proven on the wiring, not on the pure function alone.
    expect(
      e.laneInvocations === 2,
      `the lane runner itself counted 2 arm lanes (got ${e.laneInvocations}) — the cross-check's second, independent tally`,
    ) &&
    expect(e.armsWaived === 1, `1 arm waived (got ${e.armsWaived})`) &&
    pass;

  // ⭐ R2-W04. GRAMMAR rule 3 refused ONE spelling — a mutation that WRITES a
  // first-failure literal. The general shape writes no such literal: it
  // re-points an EXISTING raise so another arm reports under the arm-under-
  // test's ID, and it parsed clean against the real gate file at HEAD. The
  // fixture's annotation deliberately carries no failure literal in either its
  // needle or its replacement, so this check can only pass on the CONTENT
  // invariant (`identityRewriteDetail`) and not on the spelling rule.
  console.log("=== SELF-TEST 7/17: rewriting an arm IDENTITY must exit 1 with `identity-rewrite` ===");
  const g = runCorpus({ scopeDir: SELFTEST_DIR, onlyFile: "identity-rewrite-gate.sql", armsFloor: 0, log: quiet });
  pass =
    expect(g.exitCode === 1, `exit code is 1 (got ${g.exitCode})`) &&
    expect(
      g.defects.some((x) => x.kind === "identity-rewrite" && x.arm === "IDREWRITE 1"),
      'the defect table names IDREWRITE 1 with kind "identity-rewrite"',
    ) &&
    expect(
      g.armsExecuted === 0,
      `the arm never reached a lane (executed ${g.armsExecuted}) — a rewritten identity is refused BEFORE it can be counted as biting`,
    ) &&
    expect(
      noDefectOfKind(g.defects, ["no-red", "wrong-first-failure"]),
      'no "no-red" or "wrong-first-failure" defect — a refused mutation is not a non-biting arm',
    ) &&
    pass;

  console.log("");
  console.log("=== SELF-TEST 8/17: SYNTHESISING an identity must exit 1 with `synthesised-identity` ===");
  const h = runCorpus({
    scopeDir: SELFTEST_DIR,
    onlyFile: "synthesised-identity-gate.sql",
    armsFloor: 0,
    log: quiet,
  });
  pass =
    expect(h.exitCode === 1, `exit code is 1 (got ${h.exitCode})`) &&
    expect(
      h.defects.some((x) => x.kind === "synthesised-identity" && x.arm === "SYNTH 1"),
      'the defect table names SYNTH 1 with kind "synthesised-identity"',
    ) &&
    expect(
      h.armsExecuted === 1,
      `the arm DID reach a lane (executed ${h.armsExecuted}) — this mode is caught at RUNTIME, not at parse time, which is the whole point`,
    ) &&
    expect(
      h.bitingArms === 0,
      `the arm is NOT counted as biting (biting ${h.bitingArms}) — a synthesised identity must not inflate the quantity ARMS_FLOOR bounds`,
    ) &&
    pass;

  // ⭐ 164.3.1-11 — THE REGRESSION CORPUS, PRIMITIVE A (SC-1). Every measured
  // instance of "an accepted neuter leaves privileged state live" is a
  // PERMANENT arm here, driven through REAL lanes on every PR. Each scenario
  // was proven able to RED by neutering ITS fix in this file and observing the
  // failure (164.3.1-11-CORPUS-PROOFS.md) — a corpus entry that cannot fail is
  // itself a Primitive-D instance, so the proof is part of the entry.
  console.log("");
  console.log(
    "=== SELF-TEST 9/17: [R4-C01] the P3 compound HEAD must be REFUSED as `neuter-missed` naming `SET ROLE postgres;`, beside an ACCEPTED P1-shape neuter ===",
  );
  // armsFloor 1 states the corpus's own number: exactly ONE arm can bite — the
  // control BEHIND P1 — because the refused arm never lanes. ⚠️ It is INERT
  // here: a narrowed (onlyFile) run enforces NO floor (see `narrowed` above),
  // so the control's survival is asserted DIRECTLY on bitingArms below, never
  // through the floor.
  const i = runCorpus({ scopeDir: SELFTEST_DIR, onlyFile: "compound-head-gate.sql", armsFloor: 1, log: quiet });
  const compoundRefusal = i.defects.find((x) => x.kind === "neuter-missed" && x.arm === "BEHIND HEAD");
  pass =
    expect(i.exitCode === 1, `exit code is 1 (got ${i.exitCode})`) &&
    expect(
      compoundRefusal !== undefined && compoundRefusal.detail.includes('could not neuter "COMPOUND HEAD"'),
      'the defect table names BEHIND HEAD with kind "neuter-missed", refusing its neuter of COMPOUND HEAD',
    ) &&
    expect(
      compoundRefusal !== undefined &&
        compoundRefusal.detail.includes("unrecognised statement before its RAISE") &&
        compoundRefusal.detail.includes("SET ROLE postgres;"),
      "the refusal NAMES `SET ROLE postgres;` as the statement sharing the head's line — [R4-C01]'s own spelling, classified instead of swallowed",
    ) &&
    expect(
      i.armsExecuted === 1 && i.laneInvocations === 1,
      `only the control reached a lane (executed ${i.armsExecuted}, lanes ${i.laneInvocations}) — a refused neuter never runs, so a live SET ROLE postgres; can never reach a lane`,
    ) &&
    expect(
      i.bitingArms === 1 && !i.defects.some((x) => x.arm === "BEHIND P1"),
      `the PASSING CONTROL scored RED (identity ok) (biting ${i.bitingArms}): the P1 EXCEPTION-compound line decomposed and its neuter was ACCEPTED — the classifier is not refusing every compound line`,
    ) &&
    expect(
      i.defects.length === 1,
      `exactly one defect (got ${i.defects.length}: ${JSON.stringify(i.defects.map((x) => [x.kind, x.arm]))}) — no no-red, no wrong-first-failure, no floor: a refused neuter is not a lane result`,
    ) &&
    pass;

  console.log("");
  console.log(
    "=== SELF-TEST 10/17: [MUT-I01] an apostrophe in a `--` comment inside a RAISE must neither refuse the neuter (P4) nor over-neuter the statement after it (P5) ===",
  );
  // armsFloor 2 states the corpus's own number: both annotated arms must bite.
  // ⚠️ INERT in a narrowed run (no floor is enforced) — the count is asserted
  // DIRECTLY on bitingArms below.
  //
  // A defect-free NARROWED run exits 2, never 0 (run.mjs header: a subset run
  // must never be mistakable for a passing gate). 2 with an empty defect table
  // is therefore the GREEN shape for this scenario; 0 here would mean the
  // narrowed guard itself had been lost.
  const j = runCorpus({ scopeDir: SELFTEST_DIR, onlyFile: "comment-parity-gate.sql", armsFloor: 2, log: quiet });
  pass =
    expect(
      j.exitCode === 2 && j.defects.length === 0,
      `narrowed run is GREEN: exit code 2 with an empty defect table (got ${j.exitCode}; defects: ${JSON.stringify(j.defects)})`,
    ) &&
    expect(
      noDefectOfKind(j.defects, ["neuter-missed"]),
      "P4 (odd parity, LOUD): no `neuter-missed` — the apostrophe inside `-- don't worry` did not produce a spurious \"could not find the end of the RAISE statement\"",
    ) &&
    expect(
      noDefectOfKind(j.defects, ["wrong-first-failure"]),
      "P5 (even parity, SILENT): no `wrong-first-failure` — the `END IF;` after the RAISE's terminator SURVIVED the neuter (a swallowed closer is a syntax error the lane reports as NO-IDENTITY; since the post-RAISE refusal of 2026-09-02 the closer is the only thing left in the branch to swallow)",
    ) &&
    expect(
      j.armsExecuted === 2 && j.bitingArms === 2 && j.laneInvocations === 2,
      `both arms laned and bit (executed ${j.armsExecuted}, biting ${j.bitingArms}, lanes ${j.laneInvocations}) — BEHIND ODD and BEHIND EVEN each scored RED (identity ok) behind a correctly neutered P4/P5 arm`,
    ) &&
    pass;

  // ⭐ 164.3.1-11 — THE REGRESSION CORPUS, PRIMITIVE B (SC-1 + SC-3). Every
  // measured instance of "an arm counts toward biting without executing" is a
  // PERMANENT arm here, each with its PASSING CONTROL in the SAME run (CONTEXT
  // D-02: an attribution that refuses everything also passes a forgery test,
  // so a genuine arm must score RED (identity ok) beside the refusals). The
  // two entries fail under DIFFERENT neuters of `judgeBlock`: the
  // current_query() trigger is refused by its FIRST frame (`forge_fn()`), the
  // echo-free nested-EXECUTE forgery ONLY by the chain's LENGTH — which is
  // what makes them two entries and not one (164.3.1-11-CORPUS-PROOFS.md).
  // Both fixtures are promoted VERBATIM from 164.3.1-05-ATTRIBUTION.md § 3.
  console.log("");
  console.log(
    "=== SELF-TEST 11/17: [R4-C02] a current_query() trigger re-raising the identity must be SYNTHESISED, with the genuine arm RED (identity ok) beside it ===",
  );
  // armsFloor 1 states the corpus's own number: only the genuine control can
  // bite. INERT in a narrowed run — the control is asserted on bitingArms.
  const k = runCorpus({ scopeDir: SELFTEST_DIR, onlyFile: "current-query-forge-gate.sql", armsFloor: 1, log: quiet });
  const cqForge = k.defects.find((x) => x.kind === "synthesised-identity" && x.arm === "FORGE 1");
  pass =
    expect(k.exitCode === 1, `exit code is 1 (got ${k.exitCode})`) &&
    expect(
      cqForge !== undefined,
      'the defect table names FORGE 1 with kind "synthesised-identity" — the R4-C02 trigger that scored RED (identity ok) with biting 1 under the nonce is REFUSED under source-location attribution',
    ) &&
    expect(
      cqForge !== undefined && cqForge.detail.includes("not EXACTLY ONE") && cqForge.detail.includes("forge_fn()"),
      "the refusal names the chain rule and the trigger frame `forge_fn()` — leg (b) refused it by its FIRST frame, before chain length was even needed",
    ) &&
    expect(
      k.armsExecuted === 2 && k.bitingArms === 1 && !k.defects.some((x) => x.arm === "CTRL 1"),
      `the PASSING CONTROL scored RED (identity ok) in the SAME run (executed ${k.armsExecuted}, biting ${k.bitingArms}) — the attribution is not refusing everything`,
    ) &&
    expect(
      k.defects.length === 1,
      `exactly one defect (got ${k.defects.length}: ${JSON.stringify(k.defects.map((x) => [x.kind, x.arm]))})`,
    ) &&
    pass;

  console.log("");
  console.log(
    "=== SELF-TEST 12/17: the nested-EXECUTE DO forgery AIMED at the genuine raise line must be SYNTHESISED by chain LENGTH alone, with the genuine arm RED (identity ok) beside it ===",
  );
  // armsFloor 1: as in the current_query() re-raise scenario — stated,
  // inert here, asserted on bitingArms.
  const l = runCorpus({ scopeDir: SELFTEST_DIR, onlyFile: "nested-execute-forge-gate.sql", armsFloor: 1, log: quiet });
  const forge2 = l.defects.find((x) => x.kind === "synthesised-identity" && x.arm === "FORGE 2");
  const forge3 = l.defects.find((x) => x.kind === "synthesised-identity" && x.arm === "FORGE 3");
  // THE AIM, read off the FIXTURE'S OWN BYTES rather than off the refusal
  // text: FORGE 3's genuine RAISE must be the 5th line of its DO statement, so
  // the forged `line 5` frame really resolves to it (leg (c) PASSES) and the
  // chain rule is the only thing left refusing. `detail.includes("line 5")`
  // alone would keep passing after a reshape that moved the raise, with the
  // proof silently decayed into a leg-(c) refusal (fixture header, PADDING).
  const forge3Record = gateAttributionRecords(
    readFileSync(join(SELFTEST_DIR, "nested-execute-forge-gate.sql"), "utf8"),
  ).find((r) => r.arm === "FORGE 3");
  const forge3Aimed =
    forge3Record !== undefined && forge3Record.raiseFileLine - forge3Record.stmtStartLine + 1 === 5;
  pass =
    expect(
      forge3Aimed,
      `AIM (fixture bytes): FORGE 3's RAISE is the 5th line of its DO statement — raiseFileLine ${forge3Record?.raiseFileLine} − stmtStartLine ${forge3Record?.stmtStartLine} + 1 === 5 — so the forged \`line 5\` frame resolves to it and legs (a)+(c) genuinely pass`,
    ) &&
    expect(l.exitCode === 1, `exit code is 1 (got ${l.exitCode})`) &&
    expect(
      forge2 !== undefined && forge3 !== undefined,
      'the defect table names BOTH FORGE 2 and FORGE 3 with kind "synthesised-identity"',
    ) &&
    expect(
      forge3 !== undefined &&
        forge3.detail.includes("not EXACTLY ONE") &&
        forge3.detail.includes("inline_code_block line 5 at RAISE"),
      "FORGE 3 was AIMED — its forged first frame reads `inline_code_block line 5 at RAISE`, the genuine arm's own resolved line (legs (a) and (c) PASS) — and the chain's LENGTH refused it",
    ) &&
    expect(
      forge3 !== undefined && !forge3.detail.includes("further unattributable sighting"),
      "FORGE 3 is ECHO-FREE (a single sighting): the chain rule stands ALONE, so a neuter proof on it cannot be rescued by a second control",
    ) &&
    expect(
      forge2 !== undefined && forge2.detail.includes("further unattributable sighting"),
      "FORGE 2 is DOUBLE-GUARDED (its echoed `SQL statement` frame is a second, field-carried sighting) — the measured reason FORGE 3 exists (164.3.1-05-ATTRIBUTION.md § 5)",
    ) &&
    expect(
      l.armsExecuted === 3 && l.bitingArms === 1 && !l.defects.some((x) => x.arm === "CTRL 1"),
      `the PASSING CONTROL scored RED (identity ok) in the SAME run (executed ${l.armsExecuted}, biting ${l.bitingArms})`,
    ) &&
    expect(
      l.defects.length === 2,
      `exactly two defects (got ${l.defects.length}: ${JSON.stringify(l.defects.map((x) => [x.kind, x.arm]))})`,
    ) &&
    pass;

  // ⭐ F1 (164.3.1 adversarial review, 2026-09-02) — THE MESSAGE-EMBEDDED
  // FORGERY. FORGE 2/3 forge the innermost FRAME and are refused by chain
  // LENGTH; this one forges the whole CONTEXT + LOCATION PAIR inside the RAISE
  // MESSAGE, so the forged chain IS one frame long and every leg passes. What
  // refuses it is the shape libpq cannot help printing afterwards: the REAL
  // CONTEXT + LOCATION, making a field name repeat. Its refusal is asserted
  // under its OWN name — never the shared "not EXACTLY ONE frame" string,
  // which a chain-length refusal would also satisfy.
  console.log("");
  console.log(
    "=== SELF-TEST 13/17: [F1] a RAISE whose MESSAGE embeds a forged CONTEXT + LOCATION pair must be SYNTHESISED by field DUPLICATION, with the genuine arm RED (identity ok) beside it ===",
  );
  // armsFloor 1: as in the current_query() re-raise scenario — stated,
  // inert here, asserted on bitingArms.
  const m = runCorpus({ scopeDir: SELFTEST_DIR, onlyFile: "message-embedded-forge-gate.sql", armsFloor: 1, log: quiet });
  const forge4 = m.defects.find((x) => x.kind === "synthesised-identity" && x.arm === "FORGE 4");
  const forge4Record = gateAttributionRecords(
    readFileSync(join(SELFTEST_DIR, "message-embedded-forge-gate.sql"), "utf8"),
  ).find((r) => r.arm === "FORGE 4");
  const forge4Aimed =
    forge4Record !== undefined && forge4Record.raiseFileLine - forge4Record.stmtStartLine + 1 === 8;
  pass =
    expect(
      forge4Aimed,
      `AIM (fixture bytes): FORGE 4's RAISE is the 8th line of its DO statement — raiseFileLine ${forge4Record?.raiseFileLine} − stmtStartLine ${forge4Record?.stmtStartLine} + 1 === 8 — so the forged \`line 8\` frame resolves to it and legs (a), (b) AND (c) all pass on the forged pair`,
    ) &&
    expect(m.exitCode === 1, `exit code is 1 (got ${m.exitCode})`) &&
    expect(
      forge4 !== undefined,
      'the defect table names FORGE 4 with kind "synthesised-identity" — the message-embedded forgery is NOT scored RED (identity ok)',
    ) &&
    expect(
      forge4 !== undefined && forge4.detail.includes("duplicated diagnostic field — message-embedded forgery"),
      "the refusal names the DUPLICATED FIELD, under its own name — not the chain-length rule, which this forgery satisfies",
    ) &&
    expect(
      forge4 !== undefined && forge4.detail.includes("CONTEXT, LOCATION, CONTEXT"),
      "the refusal prints the field order it saw, beginning CONTEXT, LOCATION, CONTEXT — the forged pair followed by the real chain",
    ) &&
    expect(
      m.armsExecuted === 2 && m.bitingArms === 1 && !m.defects.some((x) => x.arm === "CTRL 1"),
      `the PASSING CONTROL scored RED (identity ok) in the SAME run and FORGE 4 is NOT biting (executed ${m.armsExecuted}, biting ${m.bitingArms})`,
    ) &&
    expect(
      m.defects.length === 1,
      `exactly one defect (got ${m.defects.length}: ${JSON.stringify(m.defects.map((x) => [x.kind, x.arm]))})`,
    ) &&
    pass;

  // ⭐ 164.3.1-10's absurdity floor, FIRE direction, THROUGH THE WIRING. Until
  // 2026-09-02 this was proven only by a one-off byte-backed neuter recorded in
  // a SUMMARY. A stub lane runner that never touches `laneTally` is injected
  // through `runCorpus`'s real verdict loop and summary block: executed=N with
  // lane-invocations=0 by construction, and the loop must call it absurd. No
  // cluster is needed, so this scenario cannot flake on one.
  console.log("");
  console.log(
    "=== SELF-TEST 14/17: a lane runner that never spawns (the severed tally) must exit 1 with `absurdity` naming executed=N lane-invocations=0 ===",
  );
  // 164.4-03: every injected lane runner must answer the `probe` leg, or the
  // run reports the probe printed no marker — a MEASURE_FAIL by design, so a
  // stub that silently stops measuring the lane cannot pass quietly.
  const stubLane = ({ leg }) =>
    leg === "probe"
      ? { status: 0, output: PROBE_ABSENT_OUTPUT, seconds: 0, measureFail: null, invoked: true }
      : { status: 0, output: "", seconds: 0, measureFail: null, invoked: true };
  const n = runCorpus({ scopeDir: SELFTEST_DIR, onlyFile: "nonbiting-gate.sql", armsFloor: 0, laneRunner: stubLane, log: quiet });
  const absurd = n.defects.find((x) => x.kind === "absurdity");
  pass =
    expect(n.exitCode === 1, `exit code is 1 (got ${n.exitCode})`) &&
    expect(
      n.armsExecuted >= 1 && n.laneInvocations === 0,
      `the verdict loop counted ${n.armsExecuted} executed arm(s) while the lane tally saw 0 — the severed shape, reached through the real loop`,
    ) &&
    expect(
      absurd !== undefined && absurd.detail.includes(`executed=${n.armsExecuted} lane-invocations=0`),
      `the defect table carries an "absurdity" defect naming executed=${n.armsExecuted} lane-invocations=0 (got ${JSON.stringify(absurd?.detail ?? null)})`,
    ) &&
    expect(
      absurd !== undefined && /GATE failing, not the corpus/.test(absurd.detail),
      "the absurdity defect says it is the GATE failing, not the corpus",
    ) &&
    pass;

  // ⭐ 2026-09-02 — a lane the runner COULD NOT RUN is a MEASURE_FAIL, not a
  // corpus defect. Pre-fix, `spawnSync`'s `error`/`signal` were never read:
  // `status: null` fell through `!== 0` and the arm was reported as
  // `wrong-first-failure` (no identity in an empty output) — an instrument
  // failure wearing a corpus defect's name — and the lane tally still counted
  // a spawn that never happened. Driven through the injectable runner with
  // the exact shape `runLane` returns for ENOENT.
  console.log("");
  console.log(
    "=== SELF-TEST 15/17: a lane that could not be RUN (ENOENT) must exit 1 with `lane-unrunnable` saying the arm was NOT judged — never `wrong-first-failure`, never biting ===",
  );
  const deadLane = ({ leg }) => {
    if (leg === "arm")
      return { status: null, output: "", seconds: 0, measureFail: "lane could not run: ENOENT", invoked: false };
    if (leg === "probe")
      return { status: 0, output: PROBE_ABSENT_OUTPUT, seconds: 0, measureFail: null, invoked: true };
    return { status: 0, output: "", seconds: 0, measureFail: null, invoked: true };
  };
  const o = runCorpus({ scopeDir: SELFTEST_DIR, onlyFile: "nonbiting-gate.sql", armsFloor: 0, laneRunner: deadLane, log: quiet });
  const dead = o.defects.find((x) => x.kind === "lane-unrunnable" && x.arm === "NONBITE 1");
  pass =
    expect(o.exitCode === 1, `exit code is 1 (got ${o.exitCode})`) &&
    expect(
      dead !== undefined && dead.detail.includes("lane could not run: ENOENT") && dead.detail.includes("this arm was NOT judged"),
      'the defect table names NONBITE 1 with kind "lane-unrunnable", carrying the spawn error and "this arm was NOT judged"',
    ) &&
    expect(
      noDefectOfKind(o.defects, ["wrong-first-failure", "no-red", "absurdity"]),
      "no wrong-first-failure, no-red or absurdity — an unrunnable lane is neither a corpus finding nor a tally disagreement (a spawn that never happened is counted by neither tally)",
    ) &&
    expect(
      o.armsExecuted === 0 && o.laneInvocations === 0 && o.bitingArms === 0,
      `nothing executed, nothing spawned, nothing biting (executed ${o.armsExecuted}, lanes ${o.laneInvocations}, biting ${o.bitingArms})`,
    ) &&
    pass;

  // ⭐ 2026-09-02 (164.4-01, threat T-164.4-01) — a twin that mutates a pg-lane
  // STAND-IN proves the fixture author's guess, not production, and would be
  // counted as biting anyway. Refused at PARSE time, like rule 3a, so the
  // annotation never becomes a twin.
  //
  // The fixture deliberately LISTS the stand-in in its own `RED-UNDER-SETUP`,
  // so `bad-file-ref` — which refuses a step naming a file outside the apply
  // list — cannot be what fires. That is asserted below: without it the
  // scenario could pass on the wrong rule. No cluster is needed; the refusal is
  // static and the file is `continue`d long before a lane.
  console.log("");
  console.log(
    "=== SELF-TEST 16/17: a twin targeting a pg-lane STAND-IN FIXTURE must be refused at parse time with `parse` naming the stand-in — never `no-red`, never `bad-file-ref` ===",
  );
  const q = runCorpus({
    scopeDir: SELFTEST_DIR,
    onlyFile: "fixture-target-gate.sql",
    armsFloor: 0,
    log: quiet,
  });
  const refused = q.defects.find((x) => x.kind === "parse" && /stand-in fixture/.test(x.detail));
  pass =
    expect(q.exitCode === 1, `exit code is 1 (got ${q.exitCode})`) &&
    expect(
      refused !== undefined,
      `a "parse" defect names the stand-in (got ${JSON.stringify(q.defects.map((x) => x.kind))})`,
    ) &&
    expect(
      refused !== undefined && /scripts\/pg-lane\/fixtures/.test(refused.detail),
      "the refusal PRINTS the forbidden prefix rather than a bare verdict",
    ) &&
    expect(
      noDefectOfKind(q.defects, ["no-red"]),
      'no "no-red" defect — a refused annotation is malformed, not a non-biting arm',
    ) &&
    expect(
      // ⚠️ Through the kind LIST rather than an equality on `x.kind`, on
      // purpose — see `noDefectOfKind`, which every absence assertion in this
      // function now goes through for the same reason.
      noDefectOfKind(q.defects, ["bad-file-ref"]),
      "no `bad-file-ref` — the stand-in IS in this gate's apply list, so the target rule is what fired, not the apply-list rule",
    ) &&
    expect(
      q.armsAnnotated === 0 && q.armsExecuted === 0,
      `the refused annotation was never counted as a twin (annotated ${q.armsAnnotated}, executed ${q.armsExecuted})`,
    ) &&
    pass;

  // ⭐ 2026-09-03 (164.4-03, threat T-164.4-11) — THE DEFERRAL MUST BE ABLE TO
  // EXPIRE. The `lane-blocked:` class is derived from the corpus, but its
  // printed reason ("which the pg-lane cannot host") is a claim about the LANE.
  // Fix [REDUNDER-PGCRON] and a derived-only class would keep printing four
  // blocked files with nothing reddening — 100 sections parked behind a line
  // that still reads true, which is precisely the control-that-cannot-fail this
  // phase exists to remove.
  //
  // Driven as an A/B through the injectable lane runner: the SAME corpus, the
  // SAME stub, and the probe leg's MARKER as the only difference. AVAILABLE →
  // exit 1 with `lane-blocked-stale`; absent → exit 0 with no defect at all. No
  // cluster is needed, so this cannot flake on one.
  console.log("");
  console.log(
    "=== SELF-TEST 17/17: a lane that CAN host pg_cron while idiom files are still classified lane-blocked must exit 1 with `lane-blocked-stale` — and the same corpus with an absent probe must exit 0 ===",
  );
  const LANE_BLOCKED_DIR = join(SELFTEST_DIR, "lane-blocked");
  const probeLane = (available) => ({ leg }) =>
    leg === "probe"
      ? {
          status: available ? 3 : 0,
          output: available ? PROBE_AVAILABLE_OUTPUT : PROBE_ABSENT_OUTPUT,
          seconds: 0,
          measureFail: null,
          invoked: true,
        }
      : { status: 0, output: "", seconds: 0, measureFail: null, invoked: true };
  // filesFloor 0: this corpus is DELIBERATELY all-unannotated (the pair exists
  // to be classified, not executed), so the real FILES_FLOOR would add a
  // spurious `floor` defect and mask the one defect under test.
  const stale = runCorpus({
    scopeDir: LANE_BLOCKED_DIR,
    filesFloor: 0,
    armsFloor: 0,
    laneRunner: probeLane(true),
    log: quiet,
  });
  const current = runCorpus({
    scopeDir: LANE_BLOCKED_DIR,
    filesFloor: 0,
    armsFloor: 0,
    laneRunner: probeLane(false),
    log: quiet,
  });
  const expired = stale.defects.find((x) => x.kind === "lane-blocked-stale");
  pass =
    expect(
      // AIM: without a non-empty lane-blocked class the rule cannot fire at
      // all, and both arms would pass vacuously. Asserted from the fixture
      // bytes before either verdict is read.
      scanCorpus(LANE_BLOCKED_DIR).laneBlockedFiles.join(" ") === "lane-blocked-gate.sql",
      `AIM (fixture bytes): the scenario corpus classifies exactly lane-blocked-gate.sql as lane-blocked (got ${JSON.stringify(scanCorpus(LANE_BLOCKED_DIR).laneBlockedFiles)})`,
    ) &&
    expect(stale.exitCode === 1, `AVAILABLE: exit code is 1 (got ${stale.exitCode})`) &&
    expect(
      expired !== undefined && expired.detail.includes("lane-blocked-gate.sql"),
      `the defect table carries a "lane-blocked-stale" defect NAMING the still-classified file (got ${JSON.stringify(expired?.detail ?? null)})`,
    ) &&
    expect(
      expired !== undefined && /the deferral has expired/.test(expired.detail),
      "the defect says the DEFERRAL HAS EXPIRED and points at TODOS [REDUNDER-PGCRON], rather than reporting a bare count",
    ) &&
    expect(
      stale.defects.length === 1,
      `exactly one defect on the AVAILABLE arm (got ${stale.defects.length}: ${JSON.stringify(stale.defects.map((x) => x.kind))})`,
    ) &&
    expect(
      // The CONTROL. Same corpus, same stub, only the probe marker differs —
      // so the exit code is attributable to the measurement and nothing else.
      current.exitCode === 0 && noDefectOfKind(current.defects, ["lane-blocked-stale"]),
      `absent: the SAME corpus with an absent-marker probe exits 0 with no lane-blocked-stale defect (got exit ${current.exitCode}, defects ${JSON.stringify(current.defects.map((x) => x.kind))})`,
    ) &&
    pass;

  console.log("");
  if (pass) {
    console.log(
      "=== SELF-TEST PASSED: both floor modes, the waiver ceiling, the wrong-identity mode, MEASURE_FAIL, the absurdity floor, the stand-in target refusal, the stale-deferral probe and the 164.3.1-11 regression corpus all fire ===",
    );
    return 0;
  }
  console.error("=== SELF-TEST FAILED ===");
  return 1;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function main(argv) {
  let scopeDir = DEFAULT_CORPUS;
  let onlyFile = null;
  let onlyArm = null;
  let parseOnly = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--self-test") return selfTest();
    else if (arg === "--parse-only") parseOnly = true;
    else if (arg === "--fixture-corpus") scopeDir = FIXTURE_CORPUS;
    else if (arg === "--file") {
      onlyFile = argv[++i];
      if (!onlyFile) {
        console.error("ERROR: --file needs a gate path");
        return 3;
      }
      try {
        scopeDir = scopeDirForFile(onlyFile);
      } catch (err) {
        console.error(`ERROR: ${err.message}`);
        return 3;
      }
    } else if (arg === "--arm") {
      onlyArm = argv[++i];
      if (!onlyArm) {
        console.error("ERROR: --arm needs an arm ID");
        return 3;
      }
    } else {
      console.error(`ERROR: unknown argument ${JSON.stringify(arg)}`);
      console.error(
        "Usage: node scripts/mutation-runner/run.mjs [--fixture-corpus] [--file <gate.sql>] [--arm <ID>] [--parse-only] [--self-test]",
      );
      return 3;
    }
  }

  if (parseOnly) {
    if (onlyFile || onlyArm) {
      console.error("ERROR: --parse-only is a whole-corpus static check and does not combine with --file/--arm");
      return 3;
    }
    console.log(`mutation-runner: STATIC PARSE, scope ${relative(REPO_ROOT, scopeDir) || "."}`);
    return parseOnlyCorpus({ scopeDir }).exitCode;
  }

  if (!existsSync(LANE)) {
    console.error(`ERROR: the pg-lane is missing at ${LANE}`);
    return 3;
  }

  console.log(`mutation-runner: scope ${relative(REPO_ROOT, scopeDir) || "."}`);
  return runCorpus({ scopeDir, onlyFile, onlyArm }).exitCode;
}

if (process.argv[1] && process.argv[1].endsWith("run.mjs")) {
  process.exit(main(process.argv.slice(2)));
}
