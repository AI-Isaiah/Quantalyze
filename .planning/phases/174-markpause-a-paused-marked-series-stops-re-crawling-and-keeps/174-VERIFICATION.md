---
status: passed
verified_at_sha: de7a449584d2aefa99ba3af709de988ed8ba7022
drift_subjects:
  - supabase/migrations/20261030120000_ledger_fanout_marks_paused_weekly.sql
  - supabase/schema/functions/enqueue_ledger_refresh_for_strategies.sql
  - supabase/tests/test_ledger_refresh_fanout.sql
  - scripts/pg-lane/fixtures/03-fixture-compute-jobs.sql
  - scripts/mutation-floors.mjs
  - analytics-service/services/job_worker.py
  - analytics-service/services/nav_marks.py
  - analytics-service/tests/test_nav_marks_refusal_record.py
  - analytics-service/tests/test_ledger_refresh_gates.py
  - analytics-service/tests/test_derive_broker_dailies_dualmode.py
  - docs/runbooks/ledger-refresh-go-live.md
  - docs/runbooks/navmtm-chain-move-go-live.md
  - src/__tests__/mutation-runner-floors.test.ts
  - src/__tests__/mutation-annotation-parser.test.ts
  - src/__tests__/drift-check-scripts.test.ts
  - src/__tests__/gate-family-meta.test.ts
---

# Phase 174: MARKPAUSE Verification Report

**Phase Goal:** A strategy whose marks have paused no longer triggers the hourly ledger re-crawl, and the reason a mark was refused is kept where only the owner (or an admin) can read it, never in public flags.
**Verified:** 2026-10-27, branch `feat/174-markpause`, head `de7a449584d2aefa99ba3af709de988ed8ba7022`
**Status:** passed (with two recorded warnings, neither a gap against a decision)
**Re-verification:** No, initial verification

Method: every run below used a `git archive` export of the head, outside the worktree, with the repo's existing Python virtualenv and `node_modules` linked in. No tracked file in the worktree was touched. The throwaway Postgres lane (`scripts/pg-lane/run.sh`) was the only database; nothing used `--linked`, `db push`, TEST, PROD or Railway.

## Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | D-01 / D-04 / SC-1: a strategy whose `marks_trailing_since` is 3 or more days old gets a 7-day attempt cooldown; a younger pause, a missing value and a malformed value keep 20 hours; the tick never raises on a bad value; the composite arm is untouched | VERIFIED | Body diff, single-key function of the new migration vs the 20260924120000 single-key body (extracted by the `$fanout$` markers): exactly one hunk, the `INTERVAL '20 hours'` conjunct becomes `CASE WHEN EXISTS (... ~ '^\d{4}-\d{2}-\d{2}$' AND ... <= to_char(CURRENT_DATE - 3, 'YYYY-MM-DD')) THEN INTERVAL '7 days' ELSE INTERVAL '20 hours' END`. The value is shape-tested then compared as text, so no cast can raise. The migration has one `CREATE OR REPLACE` (the single-key function), no `cron.schedule`, a catalogue-only `DO $verify$`, and re-issues the `REVOKE ALL ... FROM PUBLIC, anon, authenticated, service_role`. `enqueue_ledger_composite_refresh` is not created or altered. Lane run: `ALL 31 ARMS EXECUTED`. Arms P1 (paused 5 days, 2-day-old attempt, not enqueued), P2 (matched unpaused twin, enqueued), P3 (paused, 8-day-old attempt, re-admitted), P4 (paused yesterday, enqueued), P5 (empty-string flag, enqueued) all pass. |
| 2 | D-02 / SC-2: an owner-only `nav_mark_refusal:<api_key_id>` row in `allocator_equity_derived` carries `{token, first_seen_day, last_seen_day}`; written from the shared mark seam for strategy and key mode; first-seen preserved; cleared on a stored or found mark; token never in `data_quality_flags` | VERIFIED | `_record_nav_mark_refusal` (read-before-write keeps `first_seen_day`, upsert on `allocator_id,kind`) and `_clear_nav_mark_refusal` in `services/job_worker.py`, both never-raise (WARNING with key id and exception class name only). Called inside `_write_nav_mark_for_this_derive`: record on a refused read, clear on the already-stored branch and after `write_nav_mark`. `NAV_MARK_REFUSAL_KIND_PREFIX` lives in `nav_marks.py`. The table has `FORCE ROW LEVEL SECURITY`, owner `SELECT` policy `allocator_id = auth.uid()` for `authenticated`, and a service-role-only `FOR ALL` policy (migration 20260717233529); the `kind` column needs no migration. The only other place the token goes is the pre-existing `key_inputs:` row, which is the same owner-only table. `grep` of the analytics service finds no write of a token into `data_quality_flags`. |
| 3 | SC-3: tests go RED on the re-crawl and on a token reaching a public field | VERIFIED | Mutation runner, narrowed to the fan-out gate: `arms: 37/37/0`, `biting: 37`, `lane-invocations: 37`, every arm RED with its own identity, including P1 to P5. Python neuters on the export: dropping the record call turned `test_a_refused_strategy_mark_is_recorded_privately` RED; carrying `first_seen` as today turned `test_a_second_refusal_keeps_the_first_seen_day` RED; removing the found-mark clear turned `test_a_mark_found_already_stored_clears_the_record` RED; adding the refusal token to the strategy prestamp's `data_quality_flags` turned 17 of 25 tests RED (every `test_no_refusal_token_reaches_public_flags[<token>]` case). All restored byte-equal. |
| 4 | D-03: a documented read-only readout with its shape tested | VERIFIED | "Mark refusals (Phase 174)" section in `docs/runbooks/navmtm-chain-move-go-live.md`, a marker-first SQL form rendered by the runbook's own `form.mjs` mechanism. `test_the_runbook_readout_selects_the_worker_prefix` pins the worker prefix, that no `kind` or `allocator_id` is selected, the `api_keys` eligibility predicates and the three payload fields. I also ran the readout on the throwaway lane against a two-row fixture: the live key's row came back with count 1 and the departed key's row was excluded. |

**Score:** 4/4 truths verified (0 present-but-behavior-unverified).

## Required Artifacts

| Artifact | Status | Details |
|----------|--------|---------|
| `supabase/migrations/20261030120000_ledger_fanout_marks_paused_weekly.sql` | VERIFIED | One function re-created, one hunk of difference from its base body, REVOKE re-issued, no schedule, catalogue reads only in the verify block |
| `supabase/schema/functions/enqueue_ledger_refresh_for_strategies.sql` | VERIFIED | `npm run schema:functions:check`: "SQL function snapshot is current (132 functions)"; DRIFT-05 gate (a): 132 vs 132, agree |
| `supabase/tests/test_ledger_refresh_fanout.sql` | VERIFIED | All 31 arms execute and pass; 37 mutation twins all bite |
| `scripts/pg-lane/fixtures/03-fixture-compute-jobs.sql` | VERIFIED | Adds the nullable `data_quality_flags` column the new body names; existing gates unaffected |
| `analytics-service/services/job_worker.py`, `services/nav_marks.py` | VERIFIED | Wired at the single seam; `mypy --strict` clean |
| `docs/runbooks/*.md` | VERIFIED | Both sections present and consistent with the code (see warning 2) |
| Census files (`ci.yml` sentinel table, `scripts/mutation-floors.mjs`, floors and parser tests) | VERIFIED | `ARMS_FLOOR` moves 373 to 378 in `ci.yml` and 803 to 808 in the runner; the anti-skip contract test re-derives the table and passes |

## Key Links

| From | To | Status |
|------|----|--------|
| `_write_nav_mark_for_this_derive` (refused branch) | `_record_nav_mark_refusal` | WIRED |
| `_write_nav_mark_for_this_derive` (stored branch and found branch) | `_clear_nav_mark_refusal` | WIRED |
| `nav_marks.NAV_MARK_REFUSAL_KIND_PREFIX` | worker row kind and the runbook readout's `LIKE` | WIRED (test pins the readout) |
| Fan-out cooldown `CASE` | `strategy_analytics.data_quality_flags ->> 'marks_trailing_since'` (written by the prestamp and the analytics runner) | WIRED |
| New migration | Local-stack lane replay | WIRED: `check-baseline-currency.mjs --replay-set` prints `carried=308 replay=1 marker-sha=match defects=0` and names this migration as the one newer than the dump |

## Behavioral Spot-Checks and Commands Run

| Check | Command (from the right directory) | Result |
|-------|------------------------------------|--------|
| Python tests | `cd analytics-service && python -m pytest tests/test_nav_marks_refusal_record.py tests/test_ledger_refresh_gates.py tests/test_derive_broker_dailies_dualmode.py -q` | 96 passed |
| mypy as CI runs it | `cd analytics-service && mypy --strict --follow-imports=silent --config-file=pyproject.toml services/ routers/ models/ main.py main_worker.py main_worker_healthz.py sentry_init.py` | Success: no issues found in 123 source files |
| SQL gate on the throwaway lane | `scripts/pg-lane/run.sh` with the file's own `RED-UNDER-SETUP` apply list | `ALL 31 ARMS EXECUTED (A, B, C, D, E, F, G, H, I, J, K, L, M1, M2, N, N2, N3, P, P1, P2, P3, P4, P5, Q, R, S1, T, U, V1, V2, W)` |
| Mutation runner, narrowed | `node scripts/mutation-runner/run.mjs --file supabase/tests/test_ledger_refresh_fanout.sql` | 37/37 biting; the one reported defect, `dirty-checkout`, is an artefact of the export not being a git checkout at that moment, and the narrowed mode never exits 0 by design |
| SQL gate lint | `node scripts/lint-sql-gates.mjs` | 107 files scanned, 0 findings, 0 measure-fails, 0 allowlist errors |
| Function snapshot | `npm run schema:functions:check` | current, 132 functions |
| Baseline replay set | `node scripts/check-baseline-currency.mjs --replay-set` | carried=308 replay=1 marker-sha=match defects=0 |
| Vitest | `mutation-runner-floors`, `mutation-annotation-parser`, `drift-check-scripts`, `gate-family-meta` | all pass (399 tests); `contracts/ci-anti-skip-gate.contract.test.ts` also 33 passed |
| Lint | `npm run lint` | 0 errors; 2 warnings in two files this phase does not touch (unused vars); planning-hygiene, route and domain checks OK |

Note on one early red: the first vitest run in the export failed two `drift-check-scripts` tests because the export was not yet a git repository. After committing the export they passed (905 of 905 in that file). Not a product defect.

## Requirements Coverage

The roadmap entry lists `Requirements: TBD`; no requirement ids to map. Success criteria 1 to 3 and decisions D-01 to D-04 are the contract and are covered above.

## Anti-Patterns

No `TBD`, `FIXME` or `XXX` marker in any file the phase changed outside `.planning`. No stub, hollow wiring or hardcoded empty data on the new code paths.

## Warnings (recorded, not gaps)

1. **The token-set guard is not pinned by any test.** `_record_nav_mark_refusal` begins with `if token not in MARK_REFUSAL_TOKENS: ... return`. Replacing that condition with `if False:` leaves all 25 tests in `test_nav_marks_refusal_record.py` GREEN. I confirmed by a one-off test that the guard works today (an out-of-set token writes nothing), but nothing fails if it is removed. D-02 says the worker validates the token; it does, but the guard is defence in depth, since `build_mark_read` only returns members of the closed set and `test_nav_marks_reads.py` already pins that. Severity LOW. A single test with a patched `build_mark_read` returning an out-of-set string would close it.
2. **Runbook arm range is one short.** `docs/runbooks/ledger-refresh-go-live.md` says "Arms P1 to P4"; the gate has P1 to P5 (P5 is the malformed-value arm added in round 2). Documentation only.

## Skipped or Not Run

- The full `node scripts/mutation-runner/run.mjs` (all gates) was not run; only the fan-out gate was, narrowed, plus the census tests that guard the floors. The phase's SUMMARY records one full run; I did not repeat it.
- The full Python suite and the full vitest suite were not run; only the named files.
- No PROD or TEST measurement (for example the count of PROD strategies currently carrying `marks_trailing_since`) was made, by instruction.

## Human Verification

None required. The migration's PROD apply and the baseline re-dump that follows it are post-merge operations outside this verification.

## Gaps Summary

None. All four truths hold with executed evidence, and the neuter runs show the gates can fail where the decisions say they must.

---

_Verified: 2026-10-27_
_Verifier: Claude (gsd-verifier)_
