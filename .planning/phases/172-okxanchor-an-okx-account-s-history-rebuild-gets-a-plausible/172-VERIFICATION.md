---
status: passed
verified_at_sha: be84ed862d2285c30d7c318d52e4c6751d33e01f
drift_subjects:
  - analytics-service/services/okx_opening_balance.py
  - analytics-service/services/equity_reconstruction.py
  - analytics-service/scripts/allocator_history_probe.py
  - analytics-service/tests/_okx_bills.py
  - analytics-service/tests/test_okx_opening_balance.py
  - analytics-service/tests/test_okx_anchor_rule.py
  - analytics-service/tests/test_allocator_history_probe.py
  - analytics-service/tests/test_ana_recon_audit.py
  - analytics-service/tests/test_reconstruct_force_rebuild.py
  - analytics-service/tests/test_reconstruct_whole_account.py
---

# Phase 172 (OKXANCHOR) Verification Report

**Phase goal:** The history rebuild for an OKX-backed account finds why its balance anchor is judged implausible and either anchors correctly or refuses with the true reason.
**Branch / HEAD:** `feat/172-okxanchor` at `7cf901b87` (code reviewed over three rounds; the code changed after plan 04's SUMMARY, so this verdict rests on HEAD, not on the SUMMARYs).
**Mode:** initial verification. No database, Railway, TEST, PROD or venue access was used.
**Status:** passed (updated 2026-10-28 after plan 05). SC-1 and SC-2 hold against the code and tests. SC-3 is met: the deployed probe re-read a4 on 2026-10-28 and the outcome is recorded in `172-05-SUMMARY.md`. The first verdict (human_needed, at `7cf901b87`) is kept below as written; the SC-3 update is in its own section.

## Score

3 of 3 roadmap success criteria met (SC-1, SC-2, SC-3). 0 FAILED, 0 gaps. SC-3's outcome does not match the branch plan 03 expected (a4 stayed refused, cause `chain_break`); the founder routed that mismatch to Phase 179 OKXBILLSCHAIN. That is recorded, not a gap in this phase's SC-3, whose wording is "the outcome is recorded".

Original score at `7cf901b87`: 2 of 3 verified (SC-1, SC-2), SC-3 pending by design (human_needed).

## Checks I ran myself (from `analytics-service/`, main checkout venv)

| Check | Result |
|---|---|
| pytest: `tests/test_okx_opening_balance.py tests/test_okx_anchor_rule.py tests/test_allocator_history_probe.py tests/test_reconstruct_whole_account.py tests/test_reconstruct_force_rebuild.py tests/test_ana_recon_audit.py` | 272 passed |
| CI's mypy line (`--strict --follow-imports=silent`, services/ routers/ models/ main*.py sentry_init.py) | `Success: no issues found in 124 source files` |
| Mutation A (temp copy of HEAD, off-tree): the second-opinion gate forced to always refuse (the old behaviour) | 17 failed: the tracer and every "bills-proven opening anchors and writes" pin go RED (`DONE` expected, got a permanent `anchor_skipped_implausible` refusal) |
| Mutation B (temp copy of HEAD, off-tree): `opening_agrees` forced to always return True | 9 failed: the disagreement refusal, the audit-names-disagreement, the tolerance boundary and the comparator tests go RED |
| Scope of the production diff vs the merge-base | `services/exchange.py` untouched; the only production edits are `okx_opening_balance.py` (new), `equity_reconstruction.py` and `allocator_history_probe.py`; no `TBD/FIXME/XXX` added; no write, POST, order, withdraw or transfer call in the oracle or the probe |

## Observable truths

| # | Truth | Status | Evidence |
|---|---|---|---|
| SC-1 | The root cause of a4's `anchor_skipped_implausible` refusal is named from a read-only measurement. | VERIFIED, with a recorded weakness | See below. |
| SC-2a | An OKX account with a correct balance anchors and rebuilds. | VERIFIED | `_okx_forced_opening_check` (`equity_reconstruction.py`) is the second opinion behind the 5x trigger. When it returns `agreed`, the anchor block falls through to the unchanged anchoring `else` arm and the offset is applied. The handler-level tracer `test_a_forced_okx_rebuild_whose_bills_prove_the_opening_anchors_and_writes` drives the REAL `_fetch_and_price_window` / job handler and asserts `DONE`, rows ending at `totalEq`, and `anchor_opening_agreed` true in the completion audit. Mutation A turns it RED. |
| SC-2b | A truly implausible anchor still refuses by name. | VERIFIED | A disagreeing opening and each of the six unprovable openings (`malformed_balance`, `malformed_bills`, `chain_break`, `reach_unproven`, `unpriced_ccy`, `page_ceiling`) fail closed to the existing `anchor_skipped_implausible`, permanent, nothing written (`test_a_disagreeing_opening_refuses_by_name_and_writes_nothing`, `test_each_unprovable_opening_refuses_by_name`, and a drift test tying the case list to `OPENING_UNAVAILABLE_REASONS`). The refusal vocabulary stays the closed 15 (`test_forced_rebuild_refusal_reasons_are_a_closed_set`), and the oracle's outcome now rides the refusal and completion audits as an audit field (not a token). Mutation B turns the disagreement pins RED. |
| SC-2c | Tests go RED on the old behaviour. | VERIFIED | Plan 04's RED commit and my own mutation A both show the tracer failing on the `DONE` assertion for the right reason (the old 5x gate refusing a bills-proven opening). `test_c01_03_implausible_offset_skips_anchor` was rewritten to drive the real window call with an OKX-shaped exchange instead of restating the formula (it could not fail before). |
| SC-2d | Scope is the forced OKX path only. | VERIFIED | The helper's first statement returns `not-run` unless `require_anchor` and venue is OKX; it is reached only through the `_implausible_anchor` arm, after the terminus, partial-ticker and unreliable-replay arms. Unforced and Bybit callers make no bills call (`test_the_unforced_okx_path_skips_the_check_even_when_the_bills_would_agree`, Bybit scope pin). A venue or price-source exception propagates to the crawl's retry classification instead of becoming a permanent refusal (PD-I); a non-positive replay is not gated by the 5x arm and is unchanged (pinned; plan 05 books `172-OKX-NONPOSITIVE-REPLAY-UNGATED`). |
| SC-3 | After deploy the probe re-reads a4 and the outcome is recorded. | MET 2026-10-28 (see "SC-3 update" below); originally HUMAN_NEEDED (not yet possible) | Needs the merged and deployed code on the backfill worker and a PROD read. Plan 05 is written but unexecuted, as expected before ship. The code half is in place: the probe prints `opening_check`, `opening_residual_over_anchor`, `bills_read` and `bal_over_cashbal` for an anchored OKX member too (review round 2 WR-02, fixed), so a post-deploy re-read can record a complete-walk measurement. |

### SC-1 in detail, and what the partial walk means

Plan 03's a4 reading (`172-03-SUMMARY.md`, one account matched, refusal reproduced, `anchor_diagnostic=run`): `anchor_over_replay=11.2`, `replay_final_sign=positive`, `non_stable_share=4.54e-09`, `upl_over_anchor=0.0301`, `bot_equity_share=0`, `flip_from_flat_closes=0`, `hedge_mode_fills=0`, `negative_qty_assets=0`, `negative_stable_cash=false`, `flow_events_in_window=0`, `skipped_symbols_count=0`, `implied_opening_over_anchor=0.911`. That is read-only (probe, counts and 3-significant-figure ratios only, binding by sha256 prefixes, worker restored).

What stands: the replay-defect explanations the D-01 diagnostic exists to rule out (flip-from-flat closes, negative-quantity assets, hedge-mode fills, skipped symbols, bot equity, open profit, non-stable share) all read zero or negligible, the replay ends positive, and the opening the anchor implies is 91.1% of the anchor. By elimination the 5x gate is comparing today's balance with an in-window result that excludes money held before the 89-day window. That named cause (`money_before_window`) is a real, read-only measurement and meets SC-1's wording.

What does NOT stand: the independent bills corroboration. a4's `bills_read=100` is one page against `trades_read=1282` fills, and `bal_over_cashbal=0.932` where a complete walk must read 1.000. Review round 1 (CR-01) found this and fixed the oracle: it now demands a walk that reaches a bill older than the opening instant (an empty page is `reach_unproven`), per-currency chains that hold, and a newest bill equal to today's cash balance. The fixed oracle REFUSES the plan-03 reading's shape (`test_bills_whose_newest_balance_is_not_todays_cash_are_not_a_measurement`). So `opening_residual_over_anchor=-0.0147` and `bills_opening_over_anchor=0.925` are not valid measurements of the opening; they are the output of a walk the shipped code would reject. The cause is therefore measured by elimination and by the anchor-implied opening, but it is not yet corroborated by a complete bills reading. That corroboration is exactly what plan 05 produces.

Consequence for the tolerance: `OPENING_TOLERANCE_REL = 0.05` is the founder's recorded choice at plan 03's checkpoint (2026-10-27, "Anchor, 5% tolerance"), chosen as the smallest allowed value at least twice the (now invalid) residual. It is not a calibration on a complete walk and rests on one account. The code comment says so honestly. It is to be re-decided at plan 05 step 9b from the deployed probe's complete-walk reading (plan 05 records `tolerance-basis:` and `tolerance-founder-decision:`, and its automated gate now requires both after review round 3 WR-04; recommendation in the plan: keep 0.05 only when `opening_check=measured` and the absolute residual is under 0.025, otherwise route a follow-up).

Verdict: SC-1 is met as written (cause named from a read-only measurement) but its strongest evidence is superseded; I do not treat it as FAILED because the elimination readings are independent of the bills walk, and the phase has a built-in step (plan 05) that re-measures it. This is flagged, not hidden.

## Required artifacts

| Artifact | Status | Details |
|---|---|---|
| `analytics-service/services/okx_opening_balance.py` | VERIFIED | 475 lines. Read-only GET oracle; closed 6-token unavailable set; completeness proof (older bill reached, chain, head link); price-source faults propagate; `opening_agrees` single comparison line; tolerance 1.0 USD / 0.05. Wired: imported as `obal` in `equity_reconstruction.py` and called from the probe. |
| `analytics-service/services/equity_reconstruction.py` (`_okx_forced_opening_check`, anchor block, telemetry/merge/audit) | VERIFIED | Substantive and wired into `_fetch_and_price_window`; telemetry (`anchor_opening_agreed`, `anchor_opening_check`, two ratios) flows through the merge into the completion audit and, on a refusal, into the refusal audit. |
| `analytics-service/scripts/allocator_history_probe.py` | VERIFIED | Diagnostic runs for a refused OKX member and for an OKX member that anchored through the bills check; stays read-only (`ReadOnlySupabase`, `writes == []` asserted); record keys inside the redaction contract. |
| `analytics-service/tests/_okx_bills.py`, `test_okx_opening_balance.py`, `test_okx_anchor_rule.py` | VERIFIED | Present, substantive, and able to fail (mutations A and B). |

## Key links

| From | To | Via | Status |
|---|---|---|---|
| 5x gate (`_implausible_anchor`) | bills second opinion | `elif _implausible_anchor and (await _okx_forced_opening_check(...))[0] != "agreed"` | WIRED |
| second opinion | refusal / completion audits | `ForcedRebuildRefusedError.opening_check` / `opening_ratios`; `_merge_account_telemetry`; completion audit keys | WIRED |
| probe | oracle | `_anchor_diagnostic` calls `read_okx_opening`; only the oracle call is caught, measured ratios survive | WIRED |

## Requirements

REQUIREMENTS.md carries no IDs for this phase (`Requirements: TBD` in the ROADMAP); plans use SC-1..SC-3 as their identifiers. No orphaned requirements.

## Anti-patterns

None blocking. No `TBD/FIXME/XXX` added in the phase's source diff. Info only: the `okx_opening_balance.py` module docstring still says "NOTHING IN PRODUCTION CALLS IT in plan 01" although plan 04 wired it; stale prose, not behaviour. Review round 3 also noted the sign convention was unified (audit residual = implied minus bills, the probe's sign).

## Review status

Three review rounds (code reviewer plus silent-failure hunter) and three fixer rounds are recorded in `172-REVIEW.md`; the one HIGH (a bills walk with no completeness proof) and the transient-price-fault-as-permanent-refusal were fixed and are covered by tests that go RED without the fix. No finding is left open at MEDIUM or above. The review's final line leaves the 0.05 basis as a founder re-decision at plan 05 step 9b.

## Human verification required

### 1. SC-3: post-deploy re-read of a4 (plan 05 Task 1)

**Test:** After `/gsd-ship` and `/land-and-deploy` (main CI green on the merge head with the expected check count, Railway deployed that head), run the DEPLOYED probe (no payload) on the backfill worker for a4, via plan 05's procedure (import check expecting `0 15 True 0.05 True` on a rule branch, restore the worker start command afterwards).
**Expected:** a4's record shows it anchored (`sc3: a4 anchored`, per the founder's `rule-anchors` branch) with `opening_check: measured`, a complete-walk `bills_read` consistent with `trades_read`, and `bal_over_cashbal` of 1.000; or, if the complete walk disagrees or cannot prove the opening, a named refusal recorded with its measured cause. A mismatch with the branch is a STOP for the founder. `rebuilds-enqueued: 0` (TRADEPAGES D-05).
**Why human:** needs the merged and deployed code on the worker, live OKX keys decrypted only there, and a temporary PROD start-command change; cannot be checked from the repository.

### 2. Re-decide the 0.05 tolerance on the complete-walk reading (plan 05 step 9b)

**Test:** From a4's re-read record write `tolerance-basis:` and ask the founder to keep or re-set `OPENING_TOLERANCE_REL`, recording `tolerance-founder-decision:`.
**Expected:** keep 0.05 only if `opening_check=measured` and the absolute residual is under 0.025; otherwise route a follow-up constant change. Plan 05 changes no code, so the shipped constant stays 0.05 until that follow-up.
**Why human:** a founder decision on a single-account basis; plan 03's -0.0147 residual came from a partial walk (`bills_read=100`) that the fixed oracle refuses.

### 3. Ledger close and routed items (plan 05 Task 2)

**Test:** Close `167.2.1.1.2.1-OKX-ANCHOR-IMPLAUSIBLE` with the dated reading and SC-3 outcome; book `172-OKX-NONPOSITIVE-REPLAY-UNGATED` and `172-OKX-OPENING-TOLERANCE-ONE-ACCOUNT`.
**Expected:** a ledger entry whose residual comes from `tolerance-basis:` and names -0.0147 only as the superseded partial-walk reading.
**Why human:** operator ledger edit that follows the post-deploy run.

## SC-3 update (2026-10-28, plan 05)

The orchestrator ran the deployed probe once on the backfill worker at main `c9458d7b4`, which contains this phase's merge `b3225373a` (PR #1136, main CI green, 4 runs). Evidence is `172-05-SUMMARY.md`:

- `sc3: a4 refused anchor_skipped_implausible (chain_break)`. The bills walk read 1489 bills with `bal_over_cashbal=1`, and the oracle returned `opening_check=unavailable`, `opening_unavailable_reason=chain_break`: a per-currency running balance does not close. The forced path failed closed with the existing token, as SC-2's "a truly implausible anchor still refuses by name" requires of an unprovable opening.
- `sc3-expected: anchored`, `sc3-matches-branch: no`. The STOP went to the founder: `sc3-founder-decision: Record, route a follow-up (Recommended)`. Booked as Phase 179 OKXBILLSCHAIN.
- `tolerance-basis: opening_check=unavailable reason=chain_break residual=field-absent bills_read=1489 bal_over_cashbal=1`; `tolerance-founder-decision: Keep 0.05, re-decide later (Recommended)`. The shipped 0.05 can only fire on a measured opening; Phase 179 re-decides it.
- `rebuilds-enqueued: 0`, `worker-restored: yes`.

What this changes for SC-1: plan 03's `money_before_window` rested on a partial walk the shipped oracle refuses. The complete walk did not corroborate it: it could not prove the opening at all. SC-1's elimination readings still stand (this run: `anchor_over_replay=14.1`, `implied_opening_over_anchor=0.929`, replay-defect readings zero or negligible), so the cause of the 5x trigger is still money held before the window by elimination. Why the bills chain does not close is a new, separate question, and Phase 179 owns it. SC-1 stays met as written, with this weaker footing stated.

Recorded deviations (all in `172-05-SUMMARY.md`): `import-check: 0 16 True 0.05 True` against the plan's expected `0 15` (Phase 171 deployed first and added the 16th refusal token; the plan's automated verify fails on that one check and nothing else); `deployed-commit:` is the head that ran (`c9458d7b4`), not the merge sha; a first attempt at 07:46Z never ran the probe; the a4 ledger entry stays open with a pointer to Phase 179 in place of a "Closed" sentence.

## Gaps summary

No gaps. SC-1 and SC-2 hold with tests that can fail in both directions, and SC-3's outcome is recorded. The original verdict at `7cf901b87` was human_needed only because SC-3 could not run before deploy. That step has now run, and its mismatch is routed by the founder to Phase 179.

---

_Verified: 2026-10-27_
_Verifier: Claude (gsd-verifier)_
