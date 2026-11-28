---
phase: 257-seedhold-a-down-re-read-bound-cannot-move-a-strategy-s-seed
verified: 2026-11-28T13:55:00Z
verified_at_sha: 0618126201da4ee01515e828d46fe51de69c2fd7
status: passed
score: 4/4 verifiable-now must-haves verified (SC-1, SC-2, SC-3, SC-5); SC-4 met at ship
behavior_unverified: 0
overrides_applied: 0
drift_subjects:
  - analytics-service/services/job_worker.py
  - analytics-service/services/exchange.py
  - analytics-service/services/trade_resume.py
  - analytics-service/tests/test_seedhold_bound.py
  - analytics-service/tests/test_nullanchor_bound.py
  - analytics-service/tests/test_okxtrades_cursor.py
  - supabase/migrations/20261128120000_compute_job_seed_hold.sql
  - supabase/migrations/down/20261128120000-rollback.sql
  - supabase/schema/functions/set_compute_job_seed_hold.sql
  - supabase/tests/test_compute_job_seed_hold.sql
  - scripts/mutation-floors.mjs
  - scripts/dump-sql-functions.ts
  - scripts/baseline-content-drift-check.mjs
coincidental_reliance_items: []
---

# Phase 257: SEEDHOLD Verification Report

**Phase Goal:** A down re-read bound cannot move a strategy's seed past an unrecorded span (`[253-CRON-MOVES-SEED-WHILE-BOUND-RPC-DOWN]`), and a Bybit fills read that hits its deadline records what it read (`[255-BYBIT-DEADLINE-NO-PROGRESS]`).
**Verified:** 2026-11-28 at HEAD `0618126201da4ee01515e828d46fe51de69c2fd7` (worktree `quantalyze-257`, branch `gsd/phase-257-seedhold`)
**Status:** passed (SC-4 is met at ship, as Phase 255 did)
**Re-verification:** No, initial verification

Verified from the code and from my own runs. No SUMMARY sentence was taken as evidence. No database, no Docker.

## Goal Achievement

### Observable Truths (ROADMAP success criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| SC-1 | Two-run arm, another writer's daily row lands between a run whose provisional bound write failed and a run after the RPC recovered: run 2's walk start is at or before run 1's seed, for Binance, OKX, Bybit and Deribit, on a set column with no stored fill and on a first sync. RED at the merge-base, GREEN pins reported not forced. | VERIFIED | `TestSeedHoldMatrix` (24 arms) drives the real `run_sync_trades_job` twice per arm. At HEAD: all pass. Independent pre-fix replay (below): exactly the 7 `persistent` set/first arms (`binance-set`, `okx-set`, `okx-first`, `bybit-set`, `bybit-first`, `deribit-set`, `deribit-first`) go RED on `SEEDHOLD-WALK-START`; the 17 others (Binance first sync via the Phase 250 reach anchor, every NULL-column-with-seed arm, all 12 `once` arms) are GREEN pre-fix and stay as pins. Code: `job_worker.py` seed block reads the seed-hold mark (latest `done` `sync_trades` row plus the claimed row's own metadata) inside `if _bound_read:` (all four venues) and lowers `fills_since_ms`; the provisional-bound failure arm writes the mark through `set_compute_job_seed_hold`. |
| SC-2 | Deadline-stopped Bybit read that completed at least one window: fills persisted (not the partial window), bound = end of last completed window, run 2's walk start = newest completed-window fill minus 1 h and later than run 1's; deadline inside the first window: bound holds at the seed, no creep; run stays flagged in both. RED on origin/main. | VERIFIED | `TestBybitDeadlineKeepsWhatItRead` (7 arms) uses the real `_fetch_raw_trades_bybit` reader. Asserts persisted ids `{w1, w2}` (never `w3`), bound `== MARK_ISO`, stamp `== NEWEST_COMPLETED_FILL_ISO`, `phase2_fill_ingestion_failed` True, run 2 walk `== RUN2_WALK_AFTER_STOP_MS and > RUN1_WALK_MS`; first-window arm: persisted `set()`, bound `== RUN1_SEED_ISO` exactly, run 2 walk `== RUN1_WALK_MS`; persist-failure arm falls back to walk start minus 1 ms with no stamp. Pre-fix replay: all 7 RED on `SEEDHOLD-BYBIT`. Code: `exchange.py` tracks `completed_rows` / `completed_through` per window (complete only when the page loop ended naturally); `job_worker.py` catches the deadline refusal, persists `e.completed_fills`, `_earliest_through()` returns the mark (or the seed when none completed), cursor stamp gated by `_bybit_partial_ok`. |
| SC-3 | Binance read-through, Phase 255's SC-1 matrix and `advance_sync_cursor`'s callers do not regress, and a test pins that. | VERIFIED | Gate run 1 (below) passes `test_nullanchor_bound.py` (Phase 255 matrix), `test_binancefills_cursor.py`, `test_okxtrades_cursor.py`, `test_job_worker.py` with zero regression. Only two edits to existing suites, both dated intent notes: `test_nullanchor_bound.py` Bybit remaining-budget case 840-100 becomes 420-100 (`320.0`, behaviour unchanged), and `test_okxtrades_cursor._run_job` gains `expect_outcome` defaulting to the old `DONE` assertion. No router or `advance_sync_cursor` caller was touched (`git diff` of `routers/` is empty). Pin families P1-P3 are in the 257-05 neuter record. |
| SC-4 | `TODOS.md` entries `[253-CRON-MOVES-SEED-WHILE-BOUND-RPC-DOWN]` and `[255-BYBIT-DEADLINE-NO-PROGRESS]` deleted in the ship PR and named in its CHANGELOG entry. | MET AT SHIP | Not due now. Both entries are still in `TODOS.md` (lines 259, 272), as required before ship. See the ship hand-over notes below. |
| SC-5 | PROOF-01: each gate goes RED on pre-fix code or a neutered copy with its named arm first; restored from byte backup and GREEN. | VERIFIED | Independent pre-fix replay and an independent neuter run (below) reproduce RED-with-named-arm and GREEN-after-restore. The 257-05 SUMMARY records B1-B8, H1-H3, H5-H7, P1-P3 with `cmp exit=0`; I re-ran B1, B4, B8, H1, H2, H3 myself. SQL RPC fence neuter (H4) is recorded in the 257-02 SUMMARY from the executor's real pg-lane run; not re-run here (no database). |

**Score:** 4/4 truths checkable now verified; SC-4 deferred to ship by design. 0 present-but-behavior-unverified.

### Gates I ran

| Gate | Command | Result |
|------|---------|--------|
| pytest | `cd analytics-service && python3 -m pytest tests/test_seedhold_bound.py tests/test_nullanchor_bound.py tests/test_binancefills_cursor.py tests/test_okxtrades_cursor.py tests/test_job_worker.py -q` | `395 passed, 1 skipped, 2 xfailed` (the 2 xfails are the permanent `RESIDUAL_DOUBLE_FAULT` arms `okx-set-C` and `bybit-set-C`). `test_seedhold_bound.py` alone: `70 passed, 2 xfailed` (72 collected). |
| mypy strict | `mypy --strict --follow-imports=silent --config-file=pyproject.toml services/ routers/ models/ main.py main_worker.py main_worker_healthz.py sentry_init.py` | `Success: no issues found in 148 source files` |
| mutation parse-only | `node scripts/mutation-runner/run.mjs --parse-only` | exit 0; `coverage: files 102/129`, `arms: 0/1143/0`, `file test_compute_job_seed_hold.sql: sections 9 / annotated 9 / waived 0`, `No static defects` |
| vitest (census files the phase edited) | `gate-family-meta`, `lint-sql-gates`, `mutation-annotation-parser`, `mutation-runner-floors` | `4 files, 336 tests passed` |

### Independent pre-fix replay (SC-1 and SC-2)

Scratch copy of `analytics-service` under the session scratchpad, with `services/job_worker.py`, `services/exchange.py` and `services/trade_resume.py` replaced by `git show 1faea7aba3b765c958cd62695d9c84338c089975:<path>` (the merge-base of HEAD and origin/main). `python3 -m pytest tests/test_seedhold_bound.py --runxfail`.

Collection step: the module raises `AttributeError: module 'services.job_worker' has no attribute 'SEED_HOLD_RPC'` at import on the merge-base (its parity table references the new constants). So I appended two constant-only shims (`SEED_HOLD_RPC` to `job_worker.py`, `SEED_HOLD_KEY` to `trade_resume.py`, no behaviour) in the scratch copy only, to let it collect. Result: `50 failed, 22 passed`. The failures that matter, with their own assertion label, extracted from the junit XML:

- `TestSeedHoldMatrix`, 7 arms RED, each `AssertionError: SEEDHOLD-WALK-START`: `binance-set-persistent`, `okx-set-persistent`, `okx-first-persistent`, `bybit-set-persistent`, `bybit-first-persistent`, `deribit-set-persistent`, `deribit-first-persistent`. No other matrix arm fails; the 17 GREEN pins are exactly the ones 257-01 reported GREEN.
- `TestSeedHoldHandOff` A and C arms (OKX and Bybit, set column and first sync, 8 arms): `SEEDHOLD-WALK-START`. `TestSeedHoldRetry` `*-retry-rpc-up/down` (4): `SEEDHOLD-WALK-START`.
- `TestBybitDeadlineKeepsWhatItRead`, 7 of 7 RED, each `AssertionError: SEEDHOLD-BYBIT`.
- No arm in the SC-1 matrix, A, C, retry or SC-2 sets failed on AttributeError, ImportError, NameError or a premise.
- Not on the gate's own walk-start label, and expected: hand-off B and D arms fail on `the job ended DONE, expected FAILED` (they assert the review-round fix WR-R2-01 that a hold read error fails the attempt as transient; they did not exist at plan 01), the `older-rows-retry-mark` arms fail on a `SEEDHOLD-PREMISE` (the mark is never written pre-fix), the mechanism arms fail because the mechanism is absent, and the two parity arms fail with `FileNotFoundError` because the scratch copy has no `supabase/schema/` snapshot. None of these is an SC-1 or SC-2 arm.

### Independent neuter run (SC-5)

On a separate scratch copy of HEAD, each neuter applied with an exactly-once search, run, restored from a byte backup, `filecmp` identical, rerun:

| Neuter | RED arms (first four named) | Restored |
|--------|----------------------------|----------|
| B1 `completed_fills = []` | `Bybit[two-windows]`, `Bybit[stop-after-two-windows-set]` | GREEN |
| B4 `elif _bybit_deadline_stop...` to `elif False:` | `Bybit[stop-after-two-windows-*]`, first-window arms | GREEN |
| B8 budget 420 to 840 | `test_the_bybit_sync_budget_leaves_the_persist_margin`, `TestBybitReadDeadline[bybit-320.0]` | GREEN |
| H1 `_hold_owned = True` (mark write removed) | 38 arms incl. `binance-set-persistent`, `okx-set-persistent`, `okx-first-persistent`, `bybit-set-persistent` | GREEN |
| H2 `if _hold_terms and min(...) < fills_since_ms:` to `if False:` | 34 arms, same matrix arms | GREEN |
| H3 `.eq("status","done")` to `.in_(done, failed_final)` | `HandOff[okx-set-A]`, `[okx-first-A]`, `[bybit-set-A]`, `[bybit-first-A]` | GREEN |

("Restored GREEN" in the scratch runs reads `2 failed, 160 passed, 2 xfailed`: the 2 failures are the two parity arms that need the repo's `supabase/schema` snapshot, absent in the scratch copy and unrelated to the neuter. In the worktree they pass.)

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `analytics-service/services/job_worker.py` | seed-hold read term, mark write on bound-write failure, Bybit deadline persist and bound | VERIFIED | Substantive, wired into `run_sync_trades_job`, exercised by the real-job arms |
| `analytics-service/services/exchange.py` | `BybitTradeWindowIncomplete.completed_fills` / `read_through_ms`, per-window completion tracking, `BYBIT_SYNC_FILLS_READ_DEADLINE_S = 420` | VERIFIED | The reader arms use the real function |
| `analytics-service/services/trade_resume.py` | `SEED_HOLD_KEY`, `parse_seed_hold`, `load_strategy_seed_hold` (done rows only, ordered by `claimed_at`) | VERIFIED | Sole caller is `job_worker.py`; `claimed_at` exists in `baseline.sql` |
| `supabase/migrations/20261128120000_compute_job_seed_hold.sql` | one fenced single-UPDATE merge RPC, service-role only | VERIFIED by reading | SECDEF, pinned `search_path`, REVOKE names PUBLIC, anon, authenticated, claim token must be non-NULL and equal, `status = 'running'`, NULL or negative floor raises 22023, catalogue-only verify block. Sorts after `20261127220100`. SQL behaviour not re-executed here (no database); the 9-arm gate is recorded as run on the throwaway pg-lane by 257-02 and runs in CI `sql-tests` and `sql-mutation` at ship |
| rollback, function snapshot, SQL gate, census | present | VERIFIED | `down/20261128120000-rollback.sql`, `supabase/schema/functions/set_compute_job_seed_hold.sql`, `supabase/tests/test_compute_job_seed_hold.sql` (9 arms, 9 twins), floors 102 and 1143 consistent with `--parse-only` |

### Key Link Verification

| From | To | Via | Status |
|------|----|-----|--------|
| `run_sync_trades_job` bound-write failure arm | `set_compute_job_seed_hold` RPC | `SEED_HOLD_RPC`, params `p_job_id`, `p_claim_token`, `p_floor_ms` | WIRED. Python-to-SQL parity pinned by `test_parity_with_the_generated_snapshot` and a self-test that the pin can fail |
| next run's seed block | mark on latest `done` row and own claimed row | `load_strategy_seed_hold` plus `job["metadata"]` | WIRED. Read error fails the attempt as transient before any write (WR-R2-01); malformed mark floors the seed at the reach (WR-01) |
| Bybit reader deadline refusal | worker persist and epilogue bound | `e.completed_fills`, `e.read_through_ms`, `_earliest_through()` | WIRED |

### Requirements Coverage

None mapped (routed review survivors). Both survivors are addressed in code and arms; their TODOS entries delete at ship.

### Anti-Patterns Found

No `TBD`, `FIXME` or `XXX` in any added line of the phase diff (`git diff <merge-base>..HEAD` over `analytics-service`, `supabase`, `scripts`, `src`). No stubs: every flagged path is exercised by an arm that fails under its neuter.

### Review status

`257-REVIEW.md` (R1), `257-REVIEW-R2.md`, `257-REVIEW-R3.md`: R1 WR-01, WR-02 fixed (`cf5da34d7`, `614276e13`), R2 WR-R2-01 fixed (`235634140`), R3 status `clean` with 3 Info items. WR-03 (the double-fault residual) is rated MEDIUM by review and booked at ship per the founder ruling. A `257-SECURITY.md` (status `secured`, 0 open) appeared in the phase directory during this verification; it is untracked and I did not audit it.

### Residuals the phase deliberately leaves (not gaps)

These are inside the founder's ruling of 2026-11-28 and CONTEXT criterion (d), and each is pinned or named, so none fails a truth. They must be booked at ship, not forgotten:

1. **`[257-SEEDHOLD-DOUBLE-FAULT]` (MEDIUM, data-integrity).** The bound RPC down AND the seed-hold write failing (or the marked run ending `failed_final`) in one run, on a set column with no stored fill, still lets the next run seed past the span. Pinned by two strict `RESIDUAL_DOUBLE_FAULT` arms (`okx-set-C`, `bybit-set-C`, both xfail under my pytest run). The two first-sync C arms are GREEN. This is the one place the goal sentence "whatever daily rows were stored in between" is not unconditionally true; it holds under every single-fault shape.
2. **`[257-SEEDHOLD-MARK-REAPED]` (MEDIUM, low likelihood).** The 30-day `done` reaper deletes the mark with its row.
3. Bybit persist-after-deadline margin rests on an unmeasured PostgREST round trip `r` (documented derivation: margin 119 s at 0.2 s, break-even about 0.27 s). Failure mode is a loud handler cancel with the provisional bound intact, not a lost span.

### Ship hand-over notes for the caller

- SC-4: delete the two TODOS entries and name them in the CHANGELOG entry. Book the residuals above.
- The 257-05 SUMMARY's CHANGELOG draft and TODOS drafts are stale against the review fixes: DRAFT 2 `[257-SEEDHOLD-HOLD-READ-BLIP]` was closed by WR-01 and WR-R2-01 (a hold read error now fails the attempt as transient, a malformed mark floors the seed at the reach), so it should not be booked and the CHANGELOG `### Notes` line listing it should go. The "fail-open `load_strategy_seed_hold`" wording in the draft is also out of date (it now fails closed).
- A migration ship: the reviewer gate the founder required (migration-reviewer and rls-policy-auditor, no MEDIUM+) is cited as pending in the 257-02 and 257-05 SUMMARYs and as passed only by a one-line mention in REVIEW; confirm the two agents' verdicts before merge. Re-check that `20261128120000` still sorts after the PROD ledger tip and the other open phases' migrations at the ship re-base (I could not read PROD).
- After the PROD apply, the baseline re-dump must clear the `snapshot-only` `NAME_SET_RATCHET` row for `set_compute_job_seed_hold`; until then `baseline-content-drift` carries exactly one expected `SNAPSHOT_MISSING` finding (recorded in `scripts/baseline-content-drift-check.mjs`).
- Per CLAUDE.md, this file uses `verified_at_sha` and `drift_subjects`; `covered_files` and `covered_digest` are not written.

### Human Verification Required

None for this phase's must-haves. CI-bound items at ship (not human checks): `sql-tests` and `sql-mutation` executing the new 9-arm SQL gate on the lane, and the shared-TEST then PROD apply of the migration.

### Gaps Summary

No gaps. SC-1, SC-2, SC-3 and SC-5 hold against code I read and ran; SC-4 is a ship-time deliverable.

---

_Verified: 2026-11-28T13:55:00Z_
_Verifier: Claude (gsd-verifier)_
