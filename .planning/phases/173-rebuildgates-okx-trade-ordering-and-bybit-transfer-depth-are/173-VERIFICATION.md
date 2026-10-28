---
status: passed
verified_at_sha: 17bfd004c6907cb2cbc8d7aa232314fdcca3541c
drift_subjects:
  - analytics-service/scripts/allocator_history_probe.py
  - analytics-service/tests/test_allocator_history_probe.py
  - docs/runbooks/marksource-okx-history-correction.md
---

# Phase 173: REBUILDGATES Verification Report

**Phase goal:** The two gates that block any OKX or Bybit history rebuild are measured on the live worker: OKX's trade ordering on a multi-page read, and how far back Bybit serves deposits and withdrawals.
**Verified:** 2026-10-28, worktree `feat/173-rebuildgates`, HEAD above.
**Status:** passed (updated 2026-10-28 after plan 03, at the deployed merge 17bfd004c; the first verdict, human_needed at 8d4cde32, is kept below as written). SC-1 is met live (`okx-order: ok`, 1 reading). SC-2 is NOT met: a6's per-kind counts were taken and both read 0 at every age, which D-02 says is not a depth finding, so the gate reads `unmeasured`; the founder recorded it as unmeasured and routed it to Phase 180 BYBITFUNDING. SC-3 is met: the founder decided, "None now (Recommended)", and nothing was rebuilt. See "Post-deploy update (plan 03)" below for why `passed` stands with SC-2 routed.

**Original status (8d4cde32):** human_needed. The code half (plans 01 and 02) is verified. The LIVE half (plan 03: deployed probe on the backfill worker, gate lines, founder rebuild decision) is deliberately not executed yet. It runs after ship and deploy, and only the orchestrator and the founder can do it.
**Re-verification:** No, initial verification.

## Score

Updated 2026-10-28: SC-1 met, SC-3 met, SC-2 not met and routed by the founder to Phase 180 BYBITFUNDING (recorded, not a silent pass). 0 FAILED code truths.

Original score at 8d4cde32: Code half: 9/9 must-have truths verified (table below). Roadmap success criteria: 0/3 confirmed live, because all three are live-worker outcomes. SC-1 and SC-2 each have their measuring code verified and shipped-ready, and SC-3 is a founder decision. No `FAILED` truth, no blocker, no shipped-code finding open. `behavior_unverified`: 0 (every state-transition truth has a passing named test).

## Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | D-01: a REFUSED OKX member (any refusal token, including one outside the vocabulary) carries the raw fills-history ordering reading, so `okx_order_readings` counts it | VERIFIED | `_probe_member` refusal arm in `analytics-service/scripts/allocator_history_probe.py` awaits `_okx_order_reading` on the pre-diagnostic `calls` snapshot before the `exc.reason in FORCED_REBUILD_REFUSAL_REASONS` branch, so it also covers the out-of-vocabulary `failure_class="other"` return. Tests: `test_a_refused_okx_member_carries_an_ordering_reading`, `test_the_refused_members_ordering_read_uses_the_forced_pass_instrument_type`. |
| 2 | The instrument type comes from the snapshot taken before `_anchor_diagnostic`; raw reads never enter forced-pass counters | VERIFIED | Snapshot (`calls = list(recorder.calls)`) precedes both the ordering read and `_anchor_diagnostic` on the read and refusal arms. The raw `private_get_trade_fills_history` call goes through `client`, not the recorder's wrapped passes, and `_row_inst_types` selects types from the snapshot. Tests: `test_one_raw_order_read_per_inst_type_the_forced_pass_read_and_one_reading_per_member`, `test_the_agreed_anchors_ordering_read_uses_the_forced_pass_instrument_type`. |
| 3 | A raw ordering read that raises changes no member outcome; only the allow-listed CLASS is printed as `okx_order_failure_class` | VERIFIED | `_okx_order_reading` swallows the exception and records `classify_failure(exc)` only (message never read). Tests: `test_a_raw_order_read_that_raises_leaves_the_refusal_and_names_its_class`, `test_a_raw_order_read_that_raises_after_a_good_read_keeps_the_member_read`. |
| 4 | Every OKX member whose forced pass read trades (read, refused, `TruncatedTradeRead`) takes one ordering read; Bybit, read-nothing and other-class failures take none | VERIFIED | Truncated branch gates on `isinstance(exc, er.TruncatedTradeRead)`; `_okx_order_reading` returns `(None, "none")` for non-OKX or empty typed passes. Tests: `test_a_truncated_okx_member_carries_an_ordering_reading`, `test_no_raw_order_read_for_a_bybit_member_or_an_okx_member_that_read_nothing`, `test_no_raw_order_read_after_another_failure_or_on_a_bybit_member`. |
| 5 | `okx_order_gate` (summary) is `violated` on violations or full-page stops, `ok` only when at least one member read trades and every one has a reading, else `unmeasured` | VERIFIED | `okx_order_verdict` tests `violated` first, then `members_with_trades >= 1 and readings == members_with_trades`; `summarize` calls it with the summed counts. Off-tree mutation (below) goes RED. |
| 6 | D-02: per-kind `deposits_older_365d` / `withdrawals_older_365d` are permanent record fields; pooled `transfers_older_365d` stays; corroboration fields recorded and never open the gate; a 0 keeps that kind `unmeasured` | VERIFIED | `_probe_account` computes per-kind counts through `transfers_of_kind` + `transfers_older_than` with the pooled field's cutoff; corroboration fields (`*_in_window`, three age buckets, two before-booleans) feed no verdict. `bybit_transfers_verdict` needs both counts >= 1 and a window equal to `er.BYBIT_TRADE_TERMINUS_DAYS`; pooled count never consulted (mutation to a pooled sum goes RED). Tests: `test_the_bybit_transfers_verdict_needs_both_kinds_on_a_full_bybit_window`, `test_one_kind_older_than_a_year_keeps_the_bybit_gate_unmeasured`. |
| 7 | D-05: summary `bybit_transfers_gate` is `ok` only with at least one applicable account and every applicable account `ok`; a selection-refused account does not shut it | VERIFIED | `summarize` filters out `not-applicable` records (the `_account_record` default for a selection refusal), then `ok if applicable and all(...) else unmeasured`; `bybit_accounts_applicable` is printed. Test: `test_the_summary_bybit_gate_is_ok_only_with_an_applicable_account_and_all_applicable_ok` (parametrized); `all` -> `any` mutation goes RED. |
| 8 | Carried redaction contract: every new key declared, validated by a closed vocabulary or as a count, refused by `emit_record` outside it; no id, amount or sub-day timestamp reaches stdout | VERIFIED | New keys in `ACCOUNT_RECORD_KEYS`, `_ACCOUNT_VALIDATORS` (`_is_count`, `_is_one_of`) and the summary validators; whole-file tests pass (123). `BYBIT_TRADE_TERMINUS_DAYS` added to `DEPLOYED_ER_NAMES`, so an older deployed rebuild is refused before any decrypt. |
| 9 | PROHIBITION: no transfers-only mode (D-03); the probe writes nothing and names no writer or venue write; no CI skip token or secrets in tracked text | VERIFIED | `grep -i "transfers.only"` finds nothing in the probe; `test_the_probe_source_calls_no_writer` and `test_the_probe_source_calls_no_venue_write` pass. |

## Roadmap Success Criteria

| SC | Criterion | Status | Evidence |
|----|-----------|--------|----------|
| SC-1 | A multi-page OKX read records at least one ordering reading, so the gate reads `okx-order: ok` or `violated`, never `unmeasured` | MET 2026-10-28 (plan 03): `okx-order: ok`, `okx-order-reading: readings=1 members_with_trades=1 violations=0 passes_ended_full=0 failure_class=none`. Originally CODE VERIFIED, LIVE PENDING | The reading is now taken on the refusal arm, which was the root cause of `okx_order_readings=0` on a4. Whether a4's live read yields a reading, and whether the token is `ok` or `violated`, exists only after the deployed probe runs (plan 03 Task 1). A `unmeasured` live result would still leave SC-1 open. |
| SC-2 | Bybit deposit and withdrawal depth older than 365 days is measured per kind on a 730-day account | NOT MET 2026-10-28, routed by the founder to Phase 180 BYBITFUNDING: `bybit-transfers: unmeasured (a6)`, a6 deposits=0 withdrawals=0 older than 365 days, 0 of each in the window, oldest fill 180-364 days. Originally CODE VERIFIED, LIVE PENDING | Per-kind counts, corroboration and the strict per-account and summary gates exist and are tested. The live per-kind count on a6 (and its gate token) exists only after the deployed probe runs. Per D-02 a live 0 stays `unmeasured` and is a legitimate recorded outcome that leaves the TODOS entry open. |
| SC-3 | The gates' outcome decides, with the founder, which stored OKX and Bybit histories are rebuilt | MET 2026-10-28: `rebuild-decision: None now (Recommended)`, `rebuilds-enqueued: 0`. Originally PENDING | Plan 03 Task 2 (the AskUserQuestion, D-04, recommendation "No rebuild, book follow-ups") is not executed. Nothing in the code decides this, by design. |

## Founder Decisions D-01 to D-05

| Decision | Honored | Where |
|----------|---------|-------|
| D-01 read order without the anchor | Yes | Refusal arm ordering read (truth 1). |
| D-02 a 0 stays unmeasured; per-kind permanent fields; evidence for the founder only | Yes | `bybit_transfers_verdict`, per-kind fields, corroboration fields feeding no gate (truth 6). |
| D-03 full probe, no transfers-only mode | Yes | No such mode in code; static pins green (truth 9); plan 03 re-runs the full probe. |
| D-04 rebuilds decided in 173, none by default | Plan 03 only | Encoded in `173-03-PLAN.md` truths and `rebuilds-enqueued:`; not yet executed. |
| D-05 summary gate counts readable accounts, lists refused | Yes in code | `summarize` (truth 7); the `bybit-transfers-unread:` line is a plan 03 operator step. |

## Checks Run

| Check | Result |
|-------|--------|
| `pytest tests/test_allocator_history_probe.py tests/test_trade_pages.py tests/test_bybit_two_year_window.py -q` (from `analytics-service/`, main-checkout venv) | 173 passed |
| CI's `mypy --strict --follow-imports=silent --config-file=pyproject.toml services/ routers/ models/ main.py main_worker.py main_worker_healthz.py sentry_init.py` | no issues in 127 source files |
| `mypy --strict ... scripts/allocator_history_probe.py` | no issues in 1 source file |
| Off-tree mutation (temp copy of `analytics-service/` in the scratchpad; the tree was not edited). Baseline in the copy is 1 failing runbook-path test only, an artifact of the copy lacking `docs/`. | Each mutation raised failures beyond that baseline: `okx_order_verdict` violated-branch removed (RED on a named ordering test), `readings == members_with_trades` -> `readings >= 1` (RED), per-kind `and` -> `or` (RED), per-kind -> pooled sum (RED), window check removed (RED), 365-day cutoff -> 30 (RED), summary `all` -> `any` (RED on the gate-table test). The gates can fail. |

## Anti-Pattern Scan

No TBD, FIXME or XXX in the files the phase changed that is unreferenced; no stub returns on a rendered path (the probe is a CLI emitting JSON). Data flow is real: the per-kind counts derive from `_TradeRecorder.transfers`, which the rebuild's own transfer reads populate. The phase adds no UI.

## Review Closure

Four review rounds and three fixer rounds are recorded (`173-REVIEW.md` to `-4.md`, `173-SFH.md`, `173-REVIEW-FIX.md`). Round 4 states "No new defect in the code half". No shipped-code finding remains open.

Survivors, all in the plan-03 operator verify chain (the GATES_OK shell check), none in shipped code. They are MEDIUM, data-integrity of recorded evidence, and they matter only when plan 03 runs:
- R4-SFH-1 / R4 WR-01: `bybit-transfers-unread:` accepts a duplicated label that hides a refused account (compare sorted label sets), and the pasted account-record count is not compared with the summary's `accounts`, nor are duplicate record labels rejected.
- R4-SFH-2 / R4 WR-02: `sc2-met: yes`, `a4-label:` / `a6-label:` and the `okx-order-reading:` fields are not checked against the records; `bybit-transfers-evidence:` lines are shape-checked only.

Recorded honestly, not fixed here. The operator running plan 03 should hand-check these specific lines against the pasted records, or tighten the chain first.

## Post-deploy update (plan 03, 2026-10-28)

The full deployed probe ran once on the backfill worker at main 17bfd004c (#1143, v0.133.7.0), through a temporary start-command wrapper applied with `railway redeploy --from-source`; the worker was restored to `python -m main_worker` and that deployment reached SUCCESS. Main CI on 17bfd004c first went red on `frontend-local-stack` (an edge-runtime 502 at local-stack boot, infrastructure); the re-run, CI run 40684106047 attempt 2, was green. `import-check: 0 16 True True True True`, `probe-exit: 1` (expected while a4 is refused). The records and every gate line are in `173-03-SUMMARY.md`, whose Task 1 verify printed GATES_OK after the scratch directory was deleted.

- **SC-1, met.** The summary record reads `okx_order_gate=ok` with `okx_order_readings=1` and 0 violations; the reading came from a4's refusal arm, which was this phase's root-cause fix. `sc1-met: yes`.
- **SC-2, not met.** a6's read completed (selection ok, failure_class none, member_refusal none, 203467 trades) and its transfer read found no on-chain deposit or withdrawal at any age, while it has fills 180 to 364 days old. The counts were taken per kind on the 730-day account, but a 0 is not a depth finding (D-02): the read is on-chain only, and a6 was evidently funded off-chain. The probe's own gate reads `unmeasured`. Founder 2026-10-28, verbatim: "Record, book follow-up (Recommended)" (the option: record SC-2 as unmeasured with this evidence and book a follow-up that reads Bybit internal and sub-account transfers; the gate stays shut and the TODOS entry stays open). Booked as Phase 180 BYBITFUNDING. `sc2-met: no`, recorded with that answer. The SUMMARY records a deviation: plan 03 step 8's mechanical rule would read `yes`, and the stricter reading was kept.
- **SC-3, met.** Founder 2026-10-28, verbatim: "None now (Recommended)". `rebuilds-enqueued: 0`. a4 waits on Phase 179, a6 on Phase 180.

**Why `passed` with SC-2 not met.** The precedent is Phase 172, whose SC-3 outcome did not match the plan and was routed by the founder to Phase 179 while 172 closed `passed`. The case here is weaker in one respect and is stated, not hidden: 172's SC-3 wording was "the outcome is recorded", which a mismatch still satisfies, while this SC-2 asks for the depth to be measured, and it was not. `passed` stands on three grounds. First, everything this phase can deliver was delivered: the per-kind measuring code is shipped and verified, and it ran live on the 730-day account to a complete read. Second, what stops SC-2 is not a defect in this phase's code; it is a missing data source (Bybit's off-chain and sub-account transfer endpoints), which is new scope. Third, the founder explicitly chose to record it and route it rather than hold the phase, and the routing has a booked owner (Phase 180) with success criteria, and the TODOS entry `167.2.1.1.2.1-BYBIT-TRANSFER-DEPTH-UNMEASURED` stays open and points at it. Nothing reads the Bybit gate as open. A reviewer who wants SC wording to be literal should read this phase as "passed with SC-2 routed", not as "SC-2 met".

**Plan 03 operator chain residuals (item 4 below): fixed.** Before the SUMMARY was written, the orchestrator applied the minimal fixes for R4-SFH-1, R4-SFH-2, R4 WR-01 and R4 WR-02 to plan 03's verify and `fails_when`. Each new check was shown to go RED on a planted defect (duplicated unread label, wrong a4 label, mismatched reading field, evidence line naming a3, a dropped record, `sc2-met: yes` over a failed a6 read). The evidence values themselves remain operator-copied and shape-checked only.

## Human Verification Required (original, all four resolved by plan 03 above)

### 1. Deployed probe on the backfill worker: OKX ordering (SC-1)

**Test:** After ship, deploy and green main CI, run the full deployed probe once on the backfill worker (plan 03 Task 1, orchestrator only, outside 23:30 to 00:30 UTC, worker restored afterwards).
**Expected:** The summary record's `okx_order_gate` is `ok` or `violated` AND `okx_order_readings` >= 1 (a4 carries a reading despite its `anchor_skipped_implausible` refusal). `unmeasured` means SC-1 is not met; the TODOS entry stays open.
**Why human:** Needs the live worker, live OKX and PROD data. Not reachable from a verifier.

### 2. Deployed probe: Bybit per-kind depth (SC-2)

**Test:** In the same run, read a6's record: `selection=ok`, `failure_class=none`, `member_refusal=none`, `bybit_members` >= 1, then `deposits_older_365d`, `withdrawals_older_365d`, the corroboration fields, and the summary `bybit_transfers_gate`.
**Expected:** Per-kind counts are measured and the gate token is copied from the summary. A kind at 0 stays `unmeasured` (D-02) and is recorded with the corroboration evidence for the founder to judge.
**Why human:** Live Bybit data, and a 0 is a judgment call (on-chain-only transfer read) that D-02 reserves for the founder.

### 3. Founder rebuild decision (SC-3, D-04)

**Test:** Plan 03 Task 2: show the founder both gate readings and ask once which stored OKX and Bybit histories to rebuild; recommendation is "No rebuild, book follow-ups".
**Expected:** The answer is recorded verbatim; a forced rebuild runs only on an explicit yes, one job per account, through the guarded runbook paths; otherwise `rebuilds-enqueued: 0` and TRADEPAGES D-05 carries.
**Why human:** A founder decision. Also a4's rebuild stays blocked on the OKXBILLSCHAIN follow-up regardless.

### 4. Plan 03 operator chain residuals

**Test:** Before trusting a GATES_OK print in plan 03, hand-compare the `bybit-transfers-unread:` labels, the record count against the summary `accounts`, `sc2-met`, and the evidence lines against the pasted records (R4-SFH-1/2).
**Expected:** Every pasted line matches its record exactly.
**Why human:** Known unfixed gaps in the shell check.

## Housekeeping Note (not a gap, original)

Two untracked stray files sit in the worktree: `analytics-service/S01_prod_a6_ok.md` and `analytics-service/S02_prod_a6_unmeasured.md`. They hold synthetic dry-run output (placeholder commit `aaaa...`) and are not in the phase diff. Delete them or keep them out of `git add` before ship; a `git add -A` would put probe-shaped output into the tracked tree.

---

_Verified: 2026-10-28_
_Verifier: Claude (gsd-verifier)_
