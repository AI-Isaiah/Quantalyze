---
phase: 259-okxarchivefills-okx-fills-older-than-fills-history-s-3-month
verified: 2026-11-28T13:00:00Z
status: human_needed
score: 4/6 must-haves verified (SC-1, SC-3, SC-4, SC-6); SC-2 gate verified but its real-data proof and SC-5 await the post-deploy PROD run
verified_at_sha: 59dcf8669dcdd5e45f5e416afb3dfdd46ec342c2
behavior_unverified: 1
drift_subjects:
  - analytics-service/services/exchange.py
  - analytics-service/services/job_worker.py
  - analytics-service/services/okx_archive_files.py
  - analytics-service/services/okx_archive_fills.py
  - analytics-service/services/okx_archive_fills_chain.py
  - analytics-service/services/okx_archive_fills_map.py
  - analytics-service/services/okx_archive_job.py
  - analytics-service/tests/test_okx_archive_fills_apply.py
  - analytics-service/tests/test_okx_archive_fills_chain.py
  - analytics-service/tests/test_okx_archive_fills_job.py
  - analytics-service/tests/test_okx_archive_fills_map.py
  - analytics-service/tests/test_okx_normalize_fill_golden.py
  - docs/runbooks/okxarchivefills-backfill.md
behavior_unverified_items:
  - truth: "SC-2: over a span both sources cover, every stored fills-history SWAP fill matches exactly one archive trade bill on tradeId with equal side, price, size, fee (and timestamp)"
    test: "Run fills_calibrate on PROD (runbook section 8) and read reconcile.strategies[*]: state equal with ts_match equal to pairs"
    expected: "Every read strategy reports state equal, ts_match == pairs, legacy unequal/absent_in_archive/unreadable all 0"
    why_human: "All committed fixtures are synthetic (round numbers; fillTime set to ts minus 1 by construction). The code compares by value and stops on any miss, and the gate was neutered RED, but whether a real bill's ts and fee sign equal the stored fills-history fill can only be measured on a real Q3 file against PROD's stored rows. ARCHIVE_TS_COLUMN is the one-line fix if ts is unequal and fillTime is equal."
human_verification:
  - test: "SC-5 PROD backfill: after ship and deploy, with the marker query first, run the runbook (docs/runbooks/okxarchivefills-backfill.md): one fills_calibrate, apply the go/no-go checklist, then backfill via the product path (sync_trades enqueue and at most two fills_apply enqueues)"
    expected: "Each affected OKX strategy's stored fills reach back to its first fill on OKX (anchor 2026-02-23 or 2026-04-30); per-strategy before/after counts reported; unrecovered spans named; second run inserts 0 rows"
    why_human: "Plan 259-09 Task 2 is a blocking PROD checkpoint by design. It needs the deployed worker, OKX's archive apply (12 per day per user, about 2 h generation) and PROD writes. Not verifiable before deploy."
  - test: "SC-2 real-data reconcile (see behavior_unverified_items): read the calibrate's reconcile block before any apply"
    expected: "state equal with ts_match == pairs for every read strategy"
    why_human: "Real-data equality of bill and fill cannot be checked from the repo."
---

# Phase 259: OKXARCHIVEFILLS Verification Report

**Phase Goal:** An OKX strategy's stored fills are complete back to its start. Fills older than `fills-history`'s 3-month reach are read from OKX's quarterly bills archive, and the spans Phase 255 NULLANCHOR could not recover are filled on PROD.
**Verified:** 2026-11-28 at `59dcf8669dcdd5e45f5e416afb3dfdd46ec342c2` (branch `gsd/phase-okxarchive`, base `9f0fb9e6a`)
**Status:** human_needed
**Re-verification:** No, initial verification

## Verdict

The code and the gates are built, wired and demonstrably able to fail. The phase goal as written ("the spans ... are filled on PROD") is a PROD outcome that cannot exist before deploy, so the verdict is `human_needed`, not `passed`. No SC is FAILED, no BLOCKER was found. Two items are open for a human: SC-5 (the PROD run, Plan 09 Task 2) and the real-data half of SC-2 (the first calibrate is the first time a real file meets the mapper).

## Observable Truths (ROADMAP success criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Archive quarters covering the older span are read; one fill stored per trade bill with the same symbol, side, price, quantity (ctVal conversion), fee, timestamp and `exchange_fill_id` as `fills-history`; archive source in `raw_data` | VERIFIED | `exchange.py` `_normalize_okx_fill` is a verbatim extraction of the live loop body (diff read hunk by hunk; golden `test_okx_normalize_fill_golden.py` recorded before the extraction). `okx_archive_fills_map.py` `_synthesize` rebuilds the fills-history object and calls that SAME helper (`_normalize_okx_fill(_synthesize(row), "SWAP", None)`), so equality is structural. `raw_data["source"] = "okx_bills_history_archive"`. Quarter plan, anchors and the write window are in `plan_fill_quarters`, `_prepare` and `_write_fills`. For PROD's range (anchors 2026-02-23 and 2026-04-30, floor about 2026-08-27, today 2026-11-28) the plan is Q1, Q2 and Q3 2026, three quarters, under `MAX_FILLS_QUARTERS = 4`. |
| 2 | Mapping proven per instType on real data; mismatch stops the write with a named class; unproven instType refused by name | PRESENT_BEHAVIOR_UNVERIFIED (gate VERIFIED, real-data proof pending) | `reconcile_window` compares tradeId, symbol, side, price, quantity, fee, fee_currency, timestamp by value plus counts, raising `fills_reconcile_miss` naming the first failing field. `_judge` refuses everything except SWAP settled in USDT as `unproven_inst_type`; unmapped subTypes, unreadable cells, unknown contract size and duplicate tradeIds each have their own class. In `fills_apply`, `_evaluate_targets` runs every target's reconcile and the `fills_legacy_mismatch` gate before `_write_fills`. I neutered the reconcile stop (G) and the legacy gate (E) in a copy: both went RED on their named arms. What is NOT proven: the fixtures are synthetic, so the first real overlap is the PROD calibrate. See human item. |
| 3 | Idempotent rerun; a quarter that is not ingested, fails to parse or fails reconciliation leaves its span unwritten and named; never a silent partial write | VERIFIED | Write uses the live upsert (`on_conflict="strategy_id,exchange,exchange_fill_id"`, `ignore_duplicates=True`, batches of 100); neutering `ignore_duplicates` to False went RED (`test_apply_writes_every_window_fill_once`). All gates run for all targets before the first write; every stop names the quarter/position/span (`info.unread_spans` reasons `over_cap`, `not_requested`, `pre_archive`, `unreachable`, `before_anchor`). A partial write stops with the transient `fills_write_failed`, batches go newest first (neuter B went RED on `test_batches_are_written_newest_first`), and the cooldown predicate leaves a transient exhaustion unanswered so the next sync re-chains. |
| 4 | The wait never blocks a `sync_trades` claim or stalls the worker; no link, `ts` or amount in a log, error text or tracked text | VERIFIED | `sync_trades` only enqueues (`chain_okx_archive_fills`, under `asyncio.timeout(30)`, in its own try/except, after the follow-on enqueue, gated on a clean fills read; neuter I, removing the gate, went RED). The fills job never sleeps out OKX's generation time: it DEFERS (`_defer_job`, attempts untouched); the only sleep is the apply pacing (`MIN_APPLY_GAP_S`). `test_wait_never_sleeps_in_claim` and `test_no_link_ts_or_amount_leaks` exist and pass. The link lives only in `repr=False` fields, fetched through `_ingest_quarter`; stops carry class, counts and days only (`_detail_text` whitelist). |
| 5 | On PROD after deploy, the affected strategies' fills reach back to each strategy's first fill; per-strategy before/after; unrecovered spans named; product path, marker query first | HUMAN_NEEDED (pending the post-deploy PROD run) | Not achievable before deploy. Plan 259-09 Task 1 (runbook `docs/runbooks/okxarchivefills-backfill.md`, 16 sections, marker query in section 4, a written six-line go/no-go checklist, manual path for quarters beyond the cap, rollback, reporting rule) is committed and I read it against the code: its go/no-go lines match what `fills_apply` enforces itself. Task 2 (PROD calibrate and backfill) is the blocking checkpoint and has not run, by design. |
| 6 | PROOF-01: each gate RED on neutered code with its named arm, restored from a byte backup, GREEN | VERIFIED | Plan 08 recorded N1-N33 (verbatim output in 259-08-SUMMARY). Because review fix rounds changed `okx_archive_fills.py` and `okx_archive_fills_chain.py` after that proof, I re-ran ten independent neuters on a scratch copy of HEAD (restored, byte-compared equal each time): write-ahead apply count, newest-first write order, `ignore_duplicates`, cooldown set emptied, legacy gate removed, calibrate allowed to write, reconcile stop swallowed, reach test inverted, seam gate on a clean fills read removed, dead-link re-apply disabled. Every one turned its named test RED (nine by named FAILED line; the cooldown neuter failed `test_cooldown_rules`-class arms with the injected rows shown). |

**Score:** 4/6 truths verified. SC-2 (1 behavior-unverified: real data) and SC-5 (human) are open.

## Required Artifacts

| Artifact | Status | Details |
|----------|--------|---------|
| `analytics-service/services/okx_archive_fills_map.py` (551 lines) | VERIFIED | Pure mapper and reconcile, wired from `okx_archive_fills.py`. |
| `analytics-service/services/okx_archive_fills.py` (1436 lines) | VERIFIED | Handler, quarter plan, GET-first step, write-ahead apply count, gates, `_write_fills`. Reached from `run_okx_archive_rebuild_job` by a lazy-import fork on `metadata.mode in (fills_calibrate, fills_apply)`. |
| `analytics-service/services/okx_archive_fills_chain.py` (264 lines) | VERIFIED | Chain verdicts, account-scoped 14-day cooldown, 00:00-01:45 UTC deferral to 01:50. Wired by one seam hunk at the tail of `run_sync_trades_job`. |
| `analytics-service/services/okx_archive_files.py` | VERIFIED | `ArchiveRow` gains seven trailing defaulted raw cells; no new raise site; the pinned parser tests are unedited (`git diff base..HEAD` on `test_okx_archive_job/parse/apply/reconcile.py` is empty). |
| `analytics-service/services/exchange.py` | VERIFIED | `_normalize_okx_fill` extracted; the pager now calls it. |
| `docs/runbooks/okxarchivefills-backfill.md` | VERIFIED | Present, indexed in `docs/runbooks/README.md`. |
| `analytics-service/tests/fixtures/okx_archive/fills_q{2,3}_2026.csv` | PRESENT, synthetic | Round-number rows with the real 28-column header; not a real file (see SC-2). |

## Key Links

| From | To | Via | Status |
|------|----|-----|--------|
| `run_sync_trades_job` | `chain_okx_archive_fills` | seam hunk, own try/except, clean-fills gate | WIRED |
| `chain_okx_archive_fills` | `enqueue_compute_job` (`okx_archive_rebuild`, `{"mode": "fills_apply"}`) | `supabase.rpc` | WIRED |
| `run_okx_archive_rebuild_job` | `run_okx_archive_fills_job` | lazy-import fork | WIRED |
| `okx_archive_fills_map` | `exchange._normalize_okx_fill` | direct call | WIRED |
| `okx_archive_fills` | `okx_archive_job._ingest_quarter` (the one SSRF-safe downloader) | direct call | WIRED |
| `_write_fills` | `trades` upsert on `trades_dedup_fill` key | `supabase.table("trades").upsert(..., ignore_duplicates=True)` | WIRED |

## Data-Flow Trace

Archive CSV, parsed by `parse_archive_csv`, to `ArchiveRow`, to `map_trade_bills`, to the shared normaliser, to `reconcile_window` and `legacy_subset` against rows read from `trades`, to `_write_fills`. Every stage reads real inputs; nothing is a static return. The only synthetic element is the committed fixture data used by tests.

## Behavioral Spot-Checks and Test Evidence

| Check | Command (from `analytics-service/`) | Result |
|-------|------|--------|
| Six phase test files | `.venv/bin/python -m pytest tests/test_okx_archive_fills_{apply,chain,job,map,parse}.py tests/test_okx_normalize_fill_golden.py -q` | 230 passed |
| Typecheck | `make typecheck` | `Success: no issues found in 149 source files`, exit 0 |
| Full suite (run once) | `.venv/bin/python -m pytest tests -q` | 17864 passed, 107 skipped, 18 failed, all 18 in `tests/test_metrics.py` and `tests/test_qstats_gate.py` |
| Quantstats claim | venv has quantstats 0.0.81, `requirements.txt` pins 0.0.86 | CONFIRMED. The same two files on the phase base (`git archive 9f0fb9e6a`, same venv) fail 18 of 378. The phase did not change `services/metrics.py`, those two test files or `requirements.txt` (empty `git diff`). The 18 failure ids at HEAD are the 18 at base. Environment issue, not a phase regression. |
| Neuters (this verifier) | scratch copy, ten neuters | all RED, restored `cmp`-equal |

## Probe Execution

SKIPPED. The phase declares no `probe-*.sh`; verification is by named pytest arms and neuters.

## Requirements Coverage

No requirement IDs are mapped to this phase (ROADMAP: "none mapped"). No orphaned requirements.

## Anti-Patterns Found

No `TBD`, `FIXME` or `XXX` markers in the phase's modified files (debt-marker gate clear). No stubs: all handlers have real bodies, all gates have named RED arms. Review LOWs (L-01 to L-10, L-R2-01 to L-R2-03) are recorded in `259-REVIEW.md`, not fixed, per repo rule.

## Assessment of the open MEDIUM M-R2-01 / SFH N1

**Finding:** an exhausted `link_expired` (and the other unanswered transient classes) does not start the 14-day cooldown, so each daily sync can re-chain a new `fills_apply` whose per-job apply count starts at 0. Worst case 2 applies per dead quarter per day, up to 8 of the account's 12 daily applies, and it shares that budget with the OKXHISTORY daily-returns rebuild.

**Effect on the goal: not a blocker, a budget risk, and I agree with booking it.**
- It writes no wrong data and cannot corrupt fills; the upsert is idempotent and every gate still runs.
- It needs OKX to keep serving a dead link after a re-apply (unmeasured RESEARCH A4). OKX documents that a quarter applied within 30 days need not be applied again, so the likelier world is that a re-apply answers "existing" and the link is regenerated or reused.
- For the PROD backfill itself the manual runbook path is used, and the runbook states the dead-link re-apply cost; the three needed quarters (Q1 to Q3 2026) stay inside the cap, so the first run's worst case is 2 applies per quarter.
- The residual risk is operational: if A4 holds, expect the apply budget to be spent repeatedly after deploy until OKX drops the entries (about 30 days). The calibrate's `quarters[*].applies` and `last_error` rows make that visible. The one-line fix (remove `link_expired` from `_UNANSWERED_STOP_CLASSES` and adjust the binding test) is recorded in the review.
- A separate observation, no new defect: a strategy whose real first fill is more than 2 days after its first daily return never satisfies `fills_reach_anchor`, so it re-chains every 14 days (a `done` job starts the cooldown). That is bounded and idempotent.

## Human Verification Required

### 1. SC-5: PROD calibrate and backfill (blocking checkpoint, Plan 259-09 Task 2)

**Test:** After merge and a green deploy of the worker carrying Phase 259, run the runbook: marker query first, then one `fills_calibrate`, the six-line go/no-go, then the backfill through the product path.
**Expected:** each strategy's earliest stored fill reaches back to about its anchor (2026-02-23 or 2026-04-30), fills before and after reported per strategy, spans that stay unrecovered named, a rerun stores 0 new rows.
**Why human:** needs the deployed worker, OKX's archive generation and PROD writes.

### 2. SC-2 real-data reconcile (part of the same calibrate)

**Test:** Read `compute_jobs.metadata -> member_progress -> reconcile`.
**Expected:** `state: equal` and `ts_match == pairs` per read strategy; `legacy.unequal/absent_in_archive/unreadable == 0`.
**Why human:** the fixtures are synthetic; the bill-to-fill timestamp and fee-sign equality is first measured here. If `ts_match` is 0 while `fill_time_match == pairs`, the fix is `ARCHIVE_TS_COLUMN` in `okx_archive_fills_map.py`, a founder-decided code change.

### Note on automatic activation

The chain is live from the deploy of the worker: the first clean OKX `sync_trades` may start a `fills_apply` before any calibrate. Its gates are the calibrate's gates plus `fills_legacy_mismatch`, so it writes only when they pass. The runbook's first step (section 7) is to look for and read such a job.

## Ship-readiness note (added after the orchestrator's follow-up, status unchanged)

No pre-ship gap remains: every must-have that can be verified before deploy is verified, and the code fails closed (a mismatching real file writes nothing and names the class), so shipping ahead of the PROD run risks no bad data. Status stays `human_needed` because the two open items are not housekeeping: SC-5 is the phase goal's PROD outcome, and SC-2's real-data reconcile is an unmeasured external fact that can still require a code change (`ARCHIVE_TS_COLUMN`). Phase 255's `passed` with SC-3 pending-at-ship was a ship-PR edit (a TODOS deletion) under the shipper's own control; that is a different kind of item. Whether to ship while these two are open is a decision for the orchestrator or founder, recorded with the ship, not a verifier status. **Owner of both post-deploy items: plan 259-09 Task 2** (PROD calibrate, go/no-go, backfill, per-strategy before/after report); the records PR closes them by recording its results and, only then, moving this phase to `passed`.

## Gaps Summary

No gaps. Nothing is failed or stubbed. The phase is complete as code and awaits its PROD run.

Housekeeping note: while preparing a scratch copy I rsynced `analytics-service/` into a scratchpad directory (`.../scratchpad/copy/`) that already held an older repo copy from another agent in this session, which overwrote same-named root entries there. It is session scratch only; no tracked file was touched.

---

_Verified: 2026-11-28_
_Verifier: Claude (gsd-verifier)_
