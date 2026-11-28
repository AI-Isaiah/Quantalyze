---
phase: 257
slug: seedhold
status: secured
threats_total: 17
threats_closed: 15
threats_accepted: 2
open_threats: 0
asvs_level: 2
block_on: high
audited_at_sha: 061812620
audited: 2026-11-28
---

# Phase 257 SEEDHOLD: Security Verification

Verified against the code diff `merge-base(origin/main)..HEAD` excluding `.planning`, at HEAD `061812620`. Every row below was matched to a place in the code, not to a SUMMARY sentence. No `asvs_level` or `block_on` was supplied and `.planning/config.json` carries neither, so the defaults apply (ASVS L2, block on high). Verification depth is L2: the mitigation must address the vector at the right boundary.

## Threat Register

| Threat ID | Category | Severity | Disposition | Status | Evidence |
|-----------|----------|----------|-------------|--------|----------|
| T-257-01 | Repudiation | medium | mitigate | CLOSED | `analytics-service/tests/test_seedhold_bound.py`: verdict strings `SEEDHOLD-WALK-START` (:471) and `SEEDHOLD-BYBIT` (:1093-1213); strict `RESIDUAL_DOUBLE_FAULT` xfail (:192, applied :536, :544); PROOF-01 NEUTER block B1-B8/H1-H7/P1-P3 recorded in 257-05-SUMMARY. |
| T-257-02 | Elevation of Privilege | high | mitigate | CLOSED | `supabase/migrations/20261128120000_compute_job_seed_hold.sql`: `REVOKE ALL ... FROM PUBLIC, anon, authenticated` + `GRANT EXECUTE ... TO service_role` (STEP 2); verify block raises on any anon, authenticated or PUBLIC (grantee 0) EXECUTE (STEP 3); SQL gate arm 1 with a post-apply GRANT twin (`supabase/tests/test_compute_job_seed_hold.sql:141-175`). rls-policy-auditor and migration-reviewer reported no MEDIUM+. |
| T-257-03 | Tampering | medium | mitigate | CLOSED | Migration UPDATE predicate: `claim_token IS NOT DISTINCT FROM p_claim_token AND claim_token IS NOT NULL AND status = 'running'`. Gate arms 3, 4, 5 each carry a `RED-UNDER-M` twin that removes exactly one term (test file :208, :227, :250). |
| T-257-04 | Tampering | medium | mitigate | CLOSED | Single `UPDATE ... SET metadata = <object-coerce> \|\| jsonb_build_object('seed_hold_ms', ...)`, no read first. Arm 2 (keys survive, :186) and arm 8 (definition is one UPDATE and reads nothing first, :332) each have a twin. Worker calls only the RPC (`SEED_HOLD_RPC`, `job_worker.py`), never a direct table write. |
| T-257-05 | Denial of Service | low | accept | ACCEPTED | One integer key into metadata already bounded by `compute_jobs_metadata_size_bounded`. A raising write is caught by `except Exception` in `job_worker.py` (`_write_seed_hold` arm), logged at ERROR with the class name only, and does not change the job outcome. Behaviour documented in the migration header and in the caller comment. |
| T-257-06 | Elevation of Privilege | medium | mitigate | CLOSED | Migration: `SET search_path = public, pg_catalog`, body uses `public.compute_jobs`; verify block asserts `'search_path=public, pg_catalog' = ANY(proconfig)`; arm 1 asserts the same. Generated snapshot `supabase/schema/functions/set_compute_job_seed_hold.sql` matches. |
| T-257-07 | Denial of Service | medium | mitigate | CLOSED | Verify block reads only `pg_proc`, `proconfig`, `has_function_privilege`, `aclexplode` (no table). `node scripts/lint-migration-data-dependence.mjs` run at HEAD: `83 refusal(s), 83 allowlisted, 0 NEW`. |
| T-257-08 | Tampering | high | mitigate | CLOSED | `exchange.py` `_fetch_raw_trades_bybit`: `completed_rows.extend(window_rows)` and `completed_through[0] = req.window_end` only inside `if not items or not next_cursor` (the two natural ends); the in-flight `window_rows` is never copied into the refusal. Arm `stop-after-two-windows-*` asserts the persisted ids are exactly the completed windows (`test_seedhold_bound.py:1105-1133`); B3 neuter in 257-05-SUMMARY proves it bites. |
| T-257-09 | Tampering | high | mitigate | CLOSED | Fills ride on `BybitTradeWindowIncomplete.completed_fills`, never the return value (`exchange.py:959`, `:3588-3591`). `fetch_raw_trades` ends its `except Exception` with a bare `raise` (`exchange.py:2826`), so the same object propagates. Only readers of `completed_fills` are `job_worker.py:2897-2901` (the sync worker, `reason == "deadline"`); `services/ingestion/bybit.py:79` and `job_worker.py:1494` read no attribute and keep the all-or-nothing refusal. Reader arm goes through `fetch_raw_trades` (:1088). |
| T-257-10 | Denial of Service | low | mitigate | CLOSED | `BYBIT_SYNC_FILLS_READ_DEADLINE_S = 420.0` (`exchange.py`), consumed in `job_worker.py` as remaining budget; `test_the_bybit_sync_budget_leaves_the_persist_margin` (:1219) pins the derivation, the 420.0 value and `< BINANCE_SYNC_FILLS_READ_DEADLINE_S`. Residual above r = 0.27 s is a visible stall with no span lost; recorded in REVIEW IN-04, not booked (rule (a)). |
| T-257-11 | Information Disclosure | low | mitigate | CLOSED | New log lines in the diff carry strategy id, job id, exception class, or the budget seconds only (`job_worker.py` seed-hold read/write lines; `exchange.py` deadline WARNING). No fill content logged. REVIEW IN-07 confirms the same. |
| T-257-12 | Tampering | medium | mitigate | CLOSED | `trade_resume.parse_seed_hold`: `type(value) is int and value >= 0` (bool excluded). `load_strategy_seed_hold` returns `malformed=True` and logs ERROR; the caller lowers the seed to `_reach_anchor_ms` (`job_worker.py`, WR-01 branch). Pinned by `test_a_malformed_stored_hold_is_ignored` (:911). A claimed job's own malformed mark is treated the same way. |
| T-257-13 | Tampering | medium | mitigate + accept | CLOSED | Stronger than planned. WR-R2-01 changed a hold-read ERROR from fail-open to fail-the-attempt: `job_worker.py` returns `DispatchOutcome.FAILED` / `error_kind="transient"` before the provisional bound write and the daily store, so no `done` row can hide an earlier mark. Pinned by `TestSeedHoldMechanism::test_a_hold_read_error_fails_the_attempt_and_moves_nothing` and re-aimed hand-off arms B and D (257-REVIEW-FIX, R3 clean). The planned residual `[257-SEEDHOLD-HOLD-READ-BLIP]` no longer exists in code (see Notes). |
| T-257-14 | Information Disclosure | medium | mitigate | CLOSED | The mark is written only by the RPC into `compute_jobs.metadata` (RLS deny-all, service-role grant, arm 1). Diff adds no `data_quality_flags` key for it; the only `data_quality_flags` hit in the new tests reads the existing `phase2_fill_ingestion_failed` flag. Log lines per T-257-11. |
| T-257-15 | Tampering | medium | accept | ACCEPTED | Booked residual `[257-SEEDHOLD-DOUBLE-FAULT]` (MEDIUM, data-integrity). Logged at ERROR on every occurrence (`job_worker.py`, `could not write the seed-hold mark`). Pinned by two permanent strict expected-failure arms `okx-set-C` and `bybit-set-C` (:536, :544), which flip red if the residual is ever fixed without removing the marker. Drafted TODOS entry (DRAFT 1) is in 257-05-SUMMARY; TODOS.md has no entry in this worktree yet and is to be written by the ship PR. |
| T-257-16 | Tampering | high | mitigate | CLOSED | `git status --porcelain` is empty at HEAD. No neuter residue in `analytics-service/services` (grep for NEUTER finds only two unrelated pre-existing comments in `dispersion.py` and `job_worker.py:208`). 257-05-SUMMARY self-check: `git diff --quiet e7e58a8ac HEAD -- analytics-service/services` exits 0; the production file diff above is exactly plans 02-04's intended change. |
| T-257-17 | Repudiation | medium | mitigate | CLOSED | `RED_OK` only from a FAILED line naming the node id, `MISSING` fails the task; per-neuter results B1-B8, H1-H7, P1-P3 and the strict-xfail non-flip check for the C arms are recorded in 257-05-SUMMARY. |
| T-257-SC | Tampering | low | accept / mitigate (all five plans) | CLOSED | Diff touches no `package.json`, `package-lock.json` or `analytics-service/requirements*.txt`; no package added or upgraded. |

## Accepted Risks Log

| ID | Threat | Severity | Rationale | Owner / next step |
|----|--------|----------|-----------|-------------------|
| `[257-SEEDHOLD-DOUBLE-FAULT]` | T-257-15 | medium | Founder ruling 2026-11-28 ("Job's private record"): bound RPC down for a whole run AND the mark write fails (or the marked run ends `failed_final`) lets the next run seed past the unread span on a set column with no stored fill. NULL columns stay covered by the Phase 232 bootstrap anchor. | Founder decision. Ship PR must write DRAFT 1 into TODOS.md. |
| T-257-05 | metadata growth | low | One integer key under an existing size check; failure is logged and non-fatal. | None. |

## Unregistered Flags

None. Each SUMMARY `## Threat Flags` section for plans 01, 04 and 05 says None (plans 02 and 03 carry no such section). Surface added by the diff is the new RPC (covered by T-257-02 to -07), the Bybit refusal payload (T-257-08, -09) and the new log lines (T-257-11, -14).

## Notes For The Ship PR (not threats, not blocking)

1. 257-05-SUMMARY's hand-over still lists `[257-SEEDHOLD-HOLD-READ-BLIP]` (DRAFT 2) as a MEDIUM to book. WR-R2-01 removed that outcome: a hold-read error now fails the attempt as transient before anything is written. Booking it would create a stale TODOS entry (TODOS.md rule (b)); do not book it, or book it only after re-measuring.
2. DRAFT 3 `[257-SEEDHOLD-MARK-REAPED]` is listed as a MEDIUM to book, while REVIEW IN-01 rated the same residual LOW (which TODOS.md rule (a) does not book). The hand-over also says the research A5 re-check against later migrations was not done and is "still due at ship". It is not a registered T-257 threat, so it does not affect this verdict, but the rating and the A5 check need settling before the entry is written.
3. Evidence is by code and artifact reading plus the migration data-dependence lint. No database, Docker or pytest was run, as instructed; the SQL gate arms and neuter results are cited from the test files and SUMMARY records, not re-executed here.
