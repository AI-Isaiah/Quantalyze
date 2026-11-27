---
phase: 255-nullanchor-an-okx-bybit-or-deribit-fills-read-that-fails-aft
slug: nullanchor
status: secured
verdict: SECURED
asvs_level: 1
block_on: high
threats_total: 13
threats_closed: 13
threats_open: 0
open_non_blocking: 0
unregistered_flags: 1
audited_at_sha: 9077ed53b
diff_base: 45d7b4e5c
---

# Phase 255 NULLANCHOR: Security Verification

Retroactive verification of the declared `<threat_model>` blocks of plans 255-01, 255-02 and 255-03 against `git diff 45d7b4e5c HEAD` (HEAD 9077ed53b). Verdict **SECURED**, `threats_open: 0`. One unregistered finding (a home path in tracked text) is recorded as a non-blocking WARNING and should be cleaned before ship because the repo's own hygiene lint fails on it.

## Threat Verification

| Threat ID | Category | Severity | Disposition | Status | Evidence |
|-----------|----------|----------|-------------|--------|----------|
| T-255-01 | Repudiation | medium | mitigate | CLOSED | `analytics-service/tests/test_nullanchor_bound.py:205` carries the `NULLANCHOR-WALK-START` assertion text the RED arms must fail on; the strict marker accepts AssertionError only (255-01 SUMMARY, test file). Phase-gate rerun at HEAD: `test_nullanchor_bound.py` plus `test_binancefills_cursor.py` = 164 passed. |
| T-255-SC (x3) | Tampering | low | accept | CLOSED (accepted) | No dependency manifest in the diff (changed files: `services/exchange.py`, `services/job_worker.py`, `services/trade_resume.py`, tests, `.planning/` docs). No package installed. |
| T-255-02 | Tampering | medium | mitigate | CLOSED | `job_worker.py:2528-2543` the single `_set_bound` closure sends `p_claim_token: job.get("claim_token") if WORKER_FENCE_V2 else None`. Both writes go through it: provisional at `:2551`, epilogue at `:3127`. The orphan answer (`:2584-2599`) sets `_fills_read_skipped`, `_bound_orphaned`, `phase1_read_refused` and resets `_bound_read = False` and `_binance_read = False`, so the epilogue gate `if _bound_read and _reach_anchor_ms is not None` (`:3096`) is false and no epilogue write follows. Arm `test_an_orphan_answer_skips_the_read_the_store_and_the_epilogue_write` (`test_nullanchor_bound.py:504`). The RPC call shape is unchanged by the diff (no `p_claim_token` line added or removed; only the guard variable changed). |
| T-255-03 | Information disclosure | medium | mitigate | CLOSED | `binance_stop_below_cursor` is set at exactly two sites, both Binance-gated: `job_worker.py:3110` (`_binance_read and ...`) and `:3149-3150` (`if _binance_read:`). Arms `test_no_binance_key_on_a_non_binance_run` (`:403`) and `test_a_failed_epilogue_bound_write_sets_no_binance_flag` (`:413`). The only new key is `okx_fills_reach_clamped` (see Flag review below). |
| T-255-04 | Information disclosure | low | mitigate | CLOSED | Every edited log line in the diff names the strategy id and `type(exc).__name__` only (`job_worker.py:2565-2570`, `:3143-3149`, `:3158`); the edit removed the word "Binance" and added no argument. The one new log line (`exchange.py` Bybit deadline, in `_fetch_page`) formats a float budget only. `BybitTradeWindowIncomplete("deadline")` has static text, no digit and no venue text; the handler stores `str(e)[:200]`. `phase2_error_message` for a failed bound write is `f"re-read bound write failed ({type(exc).__name__})"` (class name only). |
| T-255-05 | Tampering (data integrity) | high | mitigate | CLOSED | `_earliest_through` off Binance (`job_worker.py:2847-2860`): `elif phase2_failed or any(key.startswith("sync_truncated_") and value ...)` appends `_walk_start_ms - 1`, so the bound is kept on `phase2_failed` and on any truthy `sync_truncated_*`. Arms `okx-set-plain` and `okx-set-trunc` (`test_okx_truncated_read_run2_walks_from_run1_walk_start`, `:272`) were seen RED then GREEN in the N3 neuter (255-03 SUMMARY). Also hardened in review-fix: a stuck full OKX page now sets `natural_break = False` (`exchange.py` two sites) so `sync_truncated_okx` is recorded instead of a clear over an unread span (arm `:646`). |
| T-255-06 | Denial of service | high | mitigate | CLOSED | Bybit anchor is `_exchange._now_ms() - BYBIT_EXECUTION_DEFAULT_LOOKBACK_DAYS * 86_400_000` (`job_worker.py` Bybit branch); `exchange.py:183` `BYBIT_EXECUTION_DEFAULT_LOOKBACK_DAYS = 365`, not the 730-day cap. Arm `test_bybit_bound_stays_inside_the_venue_history_on_a_later_clock` (`:552`) RED under N4, GREEN at HEAD. |
| T-255-07 | Denial of service | low | accept | CLOSED (accepted) | Accepted risk: first-sync retry from the reach anchor and one-hour bound creep per failed run. Integrity over liveness, identical to Binance since Phase 253 (RESEARCH Pitfalls 4 and 5). Recorded in 255-03-SUMMARY `## Ship hand-over` item list (line citing "the first-sync retry cost ... and the one-hour bound creep per failed run"). Logged here as the accepted-risk entry. |
| T-255-08 | Tampering (data integrity) | medium | transfer | CLOSED (documented) | Transfer documented in 255-03-SUMMARY `## Ship hand-over` item 2: rewrite `[253-CRON-MOVES-SEED-WHILE-BOUND-RPC-DOWN]` (scope OKX, Bybit, Deribit; trigger a bound-RPC outage longer than a cron cycle or a rollback of migration 20261126150000; owner named by the ship step) plus the founder decision item. Pending action for ship: `TODOS.md` still carries the Binance-only text (entry at `TODOS.md:259`), so the rewrite must land in the ship PR. Not a code mitigation; not blocking. |
| T-255-09 | Repudiation | medium | mitigate | CLOSED | 255-03-SUMMARY records 21 `RED_OK`, 10 `GREEN_OK`, 0 `_MISSING`, 11 `neutered occurrences=1` and 11 `restore cmp exit=0`; each of N1 to N10 has `RED_OK` lines by node id. |
| T-255-10 | Tampering | high | mitigate | CLOSED | At HEAD: `git status --porcelain` is empty after the test run; no neuter residue in `services/job_worker.py`, `services/exchange.py` or `services/trade_resume.py` (grep for neuter/PROOF markers hits only an unrelated pre-existing comment and `LEDGER_PROOF_VENUES`); the 164-arm gate is GREEN. The summary records a `cmp` exit 0 against `01c430a67` before the later review-fix commits. |

(Register rows: plan 01 has 2, plan 02 has 8, plan 03 has 3 = 13. The T-255-SC row repeats in each plan and is shown once above.)

## Additional checks requested

**1. No secrets, PROD ids, home paths or account numbers in tracked text added by this phase.** Scanned all 4790 added lines of `git diff 45d7b4e5c HEAD` (all paths) for key prefixes (sk_, AKIA, eyJ, ghp_, PEM headers), JWT shapes, connection strings, UUIDs, 20-letter Supabase project refs, emails, supabase.co, railway.app and sentry.io hostnames, account-number wording. Result: no credentials, no PROD ids, no emails, no account numbers. The only numeric matches are hand-typed epoch-millisecond fixtures. **Exception, one finding:** `255-RESEARCH.md` lines 440 and 500 (added by this phase) contain an absolute local home path (worktree quick-run command) and a dash-mangled agent scratchpad directory name that embeds the local username. See Unregistered Flags.

**2. Claim-token fence (WORKER_FENCE_V2) on every new bound RPC write.** CLOSED. The phase adds no new RPC call site: both bound writes (provisional `:2551`, epilogue `:3127`) share the one `_set_bound` closure, which sends `p_claim_token` gated by `WORKER_FENCE_V2` (`:2536-2538`, defined `:409`). The venue widening (`_bound_read`) only widens which venues reach that closure. The orphan answer disables the epilogue write (T-255-02).

**3. `okx_fills_reach_clamped` on anon-readable `strategy_analytics.data_quality_flags`.** CLOSED. The only writer is `exchange.py:3280` `_record_dq_flag("okx_fills_reach_clamped", True)`: a constant boolean `True`, key name carries no symbol, instrument, account or timestamp. It is recorded only when the OKX begin is raised to the floor. No `src/` reader forwards the raw blob (R3 review, row 3, cites `returns/route.ts:204` and `:588`), and the chained derive prestamp replaces the column, so the key survives only inside `last_success_snapshot.flags`. Pinned non-holding by arm `:912`.

**4. Logs added name no fill content or venue error text.** CLOSED. The diff adds or edits only: strategy id plus exception class name (bound write failure and clear failure), a job id on the orphan warning (pre-existing form), and `"Bybit fills read passed its %ss budget; refusing the read"` with a float. OKX stuck-cursor warnings are pre-existing; the only change to them is that the logged cursor is now a `billId` rather than a `tradeId` (a venue record id, not credential or fill content; not newly added logging).

## Review file cross-check

REVIEW (0 critical, 0 high), REVIEW-R2 (1 high, R2-CR-01 OKX `after` cursor key) fixed by `0896c039d` (`exchange.py` `new_cursor = data[-1].get("billId", "")`; docstring cites the v5 `after` definition) and confirmed in R3 (0 critical, 0 high; 2 medium, 3 low). R3-WR-02 (the clamp leaves no lasting signal and logs nothing) is an observability gap, not a declared mitigation and not a security threat; left open by the review process and not counted here.

## Unregistered Flags

| Flag | Severity | Status | Detail |
|------|----------|--------|--------|
| UF-255-01 absolute home path and scratchpad directory (with local username) in tracked text | medium (information disclosure on a public repo, project rule "no home paths") | OPEN, non-blocking at `block_on: high` | `.planning/phases/255-.../255-RESEARCH.md:440` and `:500`. `npx tsx scripts/check-planning-hygiene.ts` at HEAD reports 4 violations (ABSOLUTE-HOME-PATH, SCRATCH-HOME-PATH, 2x LOCAL-USERNAME), all in that file, so `npm run lint` goes red on the PR that carries it. Baseline `45d7b4e5c` had 0 in `.planning/phases`. Remedy: replace the path with `<user>` or a repo-relative form (the scratch directory with a placeholder). Source files are read-only for this audit, so it was not patched. |

SUMMARY `## Threat Flags` sections introduced no further attack surface beyond the registered threats.

**threats_open:** 0
