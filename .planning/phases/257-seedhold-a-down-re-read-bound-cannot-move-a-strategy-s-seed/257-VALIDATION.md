---
phase: "257"
slug: "seedhold-a-down-re-read-bound-cannot-move-a-strategy-s-seed"
status: planned
nyquist_compliant: true
wave_0_complete: false
created: "2026-11-28"
---

# Phase 257 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution. Source: `257-RESEARCH.md` `## Validation Architecture`.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | pytest 9.x (`asyncio_mode = auto`); SQL self-test corpus under `supabase/tests` for the migration |
| **Config file** | `analytics-service/pytest.ini` |
| **Quick run command** | `cd analytics-service && python3 -m pytest tests/test_seedhold_bound.py tests/test_nullanchor_bound.py -q` |
| **Full suite command** | census command in RESEARCH plus `cd analytics-service && mypy --strict --follow-imports=silent --config-file=pyproject.toml services/ routers/ models/ main.py main_worker.py main_worker_healthz.py sentry_init.py` |
| **Estimated runtime** | ~200 seconds (census) |

---

## Sampling Rate

- **After every task commit:** quick run command plus mypy strict.
- **After every plan wave:** census command plus mypy strict.
- **Before `/gsd-verify-work`:** CI `python` job command green.
- **Max feedback latency:** 200 seconds.

---

## Per-Task Verification Map

Every task below carries at least one `<automated>` verify with a `<fails_when>` (filled at planning revision 1, 2026-11-28). Commands run from the worktree root unless they start with `cd analytics-service`. `MB` is `$(git merge-base HEAD origin/main)`; the plans write it inline because shell state does not persist.

| Task | Wave | Gate (SC) | Automated command (abridged; the PLAN carries the full text) | Fails when |
|------|------|-----------|---------------------------------------------------------------|------------|
| 257-01 T1 | 1 | SC-1, SC-5 (RED on pre-fix code) | `cd analytics-service && python3 -m pytest tests/test_seedhold_bound.py -q -p no:cacheprovider -k "TestSeedHoldMatrix or TestSeedHoldHandOff or TestSeedHoldRetry"`; `git diff --quiet "$(git merge-base HEAD origin/main)" -- analytics-service/services analytics-service/routers analytics-service/models`; mypy strict | passed plus xfailed is not 40, any xpassed, or xfailed differs from the saved unmarked HEAD run's FAILED count; a production file changed |
| 257-01 T2 | 1 | SC-2, SC-5 | `cd analytics-service && python3 -m pytest tests/test_seedhold_bound.py -q -p no:cacheprovider` (47 arms); `grep -a -c "newest completed-window fill minus the 1 h overlap" .planning/ROADMAP.md` | not 47 collected, any xpassed; the SC-2 rewording missing |
| 257-02 T1 | 1 | SC-1 enabler, SC-5 (H4) | pg-lane gate without and with the migration; `node scripts/mutation-runner/run.mjs --file supabase/tests/test_compute_job_seed_hold.sql`; `node scripts/lint-sql-gates.mjs && node scripts/lint-migration-data-dependence.mjs && node scripts/lint-app-guc.mjs`; the gate carries no completion sentinel | gate not RED on arm 1 pre-migration; a twin that does not bite; H4 not RED on arm 3; a lint finding; a completion sentinel present |
| 257-02 T2 | 1 | census | `node scripts/baseline-content-drift-check.mjs` (findings 0); `npx tsx scripts/dump-sql-functions.ts --check`; `npx vitest run src/__tests__/baseline-content-drift-allowlist.test.ts src/__tests__/drift-check-scripts.test.ts` | findings not 0; snapshot stale; a failed test |
| 257-02 T3 | 1 | census | `node scripts/mutation-runner/run.mjs --parse-only`; `npx vitest run` on the four census files plus `ci-anti-skip-gate.contract.test.ts` | no `No static defects`; FILES_FLOOR differs from coverage; a failed test |
| 257-03 T1 | 2 | SC-2, SC-3 | `-k TestBybitDeadlineKeepsWhatItRead` (exactly 7 passed); the ten-file census command; mypy strict; `git diff --quiet MB -- analytics-service/services/exchange_pagination.py` and no OKX hunk in `git diff -U0 MB -- analytics-service/services/exchange.py` | not 7 passed; a census failure; a mypy error; `walk_paginated` or an OKX function changed |
| 257-03 T2 | 2 | SC-2 (timing), SC-3 | `cd analytics-service && python3 -m pytest tests/test_seedhold_bound.py tests/test_nullanchor_bound.py -q -p no:cacheprovider`; mypy strict | margin pin or the one intent-changed row fails |
| 257-04 T1 | 3 | SC-1, SC-3 | the 40 hold arms (passed plus xfailed 40, xfailed only on residual C arms); the FULL analytics suite; mypy strict | an unmarked hold arm fails; an xpass; a full-suite failure not recorded as unrelated |
| 257-04 T2 | 3 | SC-3 | `-k TestSeedHoldMechanism` (at least 15 passed); the four-file neighbour census | a mechanism or parity pin fails |
| 257-05 T1 | 4 | SC-5 (B1-B8) | `grep -a -c "^RED_OK B"`, `^MISSING`, `^restore cmp exit=0` on `$SCRATCH/257/plan05/proof.log`; `git status --porcelain -- analytics-service/services` empty | RED_OK below 13, any MISSING, restores below 8, a neuter left in place |
| 257-05 T2 | 4 | SC-5 (H1-H3, H5-H7, P1-P3) | `grep -a -c "^RED_OK H"` (at least 15), `^RED_OK P` (at least 6), `^MISSING` (0); NEUTER block present | below the counts, any MISSING, a neuter left in place, no NEUTER block |
| 257-05 T3 | 4 | SC-1 to SC-5 phase gate, SC-4 hand-over | full suite with `--cov-fail-under=80`; mypy strict; `node scripts/verify-plan-anchors.mjs` on the five plans | a failure not recorded as local-only; coverage below 80; a stale anchor |

PROOF-01 neuter register (SC-5), every one through the RED_OK / `cp` back / `cmp` / GREEN_OK harness unless noted:

| Id | Site | Named arm that must go RED | Plan |
|----|------|----------------------------|------|
| B1 | reader deadline branch attaches no completed fills | `TestBybitDeadlineKeepsWhatItRead[two-windows]`, `[stop-after-two-windows-set]` | 05 |
| B2 | the completed window end is never recorded | `[two-windows]`, `[stop-after-two-windows-set]` | 05 |
| B3 | the natural-end condition becomes `True` (complete after any page) | `[stop-after-two-windows-set]` | 05 |
| B4 | `_earliest_through` Bybit branch condition becomes `False` | `[stop-inside-first-window-set]`, `[stop-after-two-windows-set]` | 05 |
| B5 | Bybit partial disjunct dropped from `advance_fetched_cursor` | `[stop-after-two-windows-set]` | 05 |
| B6 | `_fills_persist_failed = True` deleted | `[persist-fails-after-stop-set]` | 05 |
| B7 | `phase2_failed = False` after the Bybit deadline branch | `[stop-after-two-windows-set]`, `[stop-inside-first-window-set]` | 05 |
| B8 | `BYBIT_SYNC_FILLS_READ_DEADLINE_S` raised to 840.0 | the margin pin, the Bybit budget row in `test_nullanchor_bound.py` | 05 |
| H1 | the seed-hold write never calls the RPC | matrix `okx-set-persistent`, `bybit-first-persistent`, `binance-set-persistent`, `deribit-first-persistent` | 05 |
| H2 | the seed-hold term never lowers the seed | the same four matrix arms | 05 |
| H3 | reader status filter widened to `done` and `failed_final` | hand-off `okx-set-A`, `bybit-first-A` | 05 |
| H4 | SQL token predicate replaced with `AND TRUE` | SQL gate arm 3 (`TEST FAILED (3)`); plus every RED-UNDER-M twin via the mutation runner | 02 |
| H5 | fail-safe `min(` replaced with the plain seed | hand-off `okx-set-B`, `bybit-set-B` | 05 |
| H6 | the claimed row's own mark never read | retry `okx-retry-rpc-up`, `bybit-retry-rpc-down` | 05 |
| H7 | the seed-hold write also runs after a successful provisional write | `TestSeedHoldMechanism::test_a_clean_run_writes_no_seed_hold[okx]` | 05 |
| P1 | Phase 232 bootstrap anchor branch becomes `elif False:`, plus H1 | matrix `okx-nullseed-persistent`, `binance-nullseed-persistent` | 05 |
| P2 | epilogue `_set_bound` call skipped (`if not True:`), plus H1 | matrix `okx-set-once`, `bybit-first-once`, `binance-set-once` | 05 |
| P3 | Phase 250 CR-01 Binance reach-anchor branch becomes `elif False:`, plus H1 | matrix `binance-first-persistent` | 05 |

P1 to P3 pair with H1 because after plan 04 the seed-hold mark also protects every pin family; the HEAD mechanism alone leaves those arms GREEN by design (redundancy, recorded as an observation).

---

## Wave 0 Requirements

- [ ] `analytics-service/tests/test_seedhold_bound.py` — matrix, Bybit arms, pins, a fake jobs store that models status and recency.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| PROOF-01 neuter/restore | SC-5 | Requires editing source and observing RED | byte backup, neuter, RED with named arm, `cp` back, `cmp`, GREEN, recorded verbatim |
| TODOS deletion | SC-4 | Ship-time ledger edit | `grep -a -c` of both ids in `TODOS.md` is 0 |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies (12 tasks, each with at least one `<automated>` and `<fails_when>`)
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references (`analytics-service/tests/test_seedhold_bound.py` is created by 257-01 T1 before any later task reads it; no verify is marked MISSING)
- [x] No watch-mode flags
- [x] Feedback latency < 200s for the per-task quick commands; the full-suite runs in 257-04 T1 and 257-05 T3 are wave and phase gates and run longer by design (serial locally, since pytest-xdist is not installed)
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
