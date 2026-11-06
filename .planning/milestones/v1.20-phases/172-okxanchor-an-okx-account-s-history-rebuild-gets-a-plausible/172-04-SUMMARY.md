---
phase: 172-okxanchor-an-okx-account-s-history-rebuild-gets-a-plausible
plan: 04
subsystem: analytics-service / allocator equity reconstruction (forced OKX anchor)
tags: [okx, anchor, forced-rebuild, bills-archive, opening-balance, tolerance, mutation-proof, tdd]
requires: ["172-01", "172-03"]
provides:
  - "services/okx_opening_balance.py: OPENING_TOLERANCE_USD (1.0), OPENING_TOLERANCE_REL (0.05, the founder's recorded value) and the pure comparator opening_agrees"
  - "services/equity_reconstruction.py: _okx_forced_opening_agrees, the second opinion behind the 5x trigger on the forced OKX path, plus the anchor_opening_agreed telemetry, account-merge and completion-audit flag"
  - "tests/test_okx_anchor_rule.py: handler-level and direct-call pins of the rule, its refusals and its scope"
affects: [172-05]
tech-stack:
  added: []
  patterns: ["cheap trigger (5x gate) plus an independent second opinion (bills oracle), fail closed", "audit flag that mirrors anchor_positions_unread (OR-merge, .get default False)", "temp-copy mutation proofs via git archive"]
key-files:
  created:
    - analytics-service/tests/test_okx_anchor_rule.py
  modified:
    - analytics-service/services/okx_opening_balance.py
    - analytics-service/services/equity_reconstruction.py
    - analytics-service/tests/test_okx_opening_balance.py
    - analytics-service/tests/test_reconstruct_whole_account.py
key-decisions:
  - "Scope is the forced OKX path behind the 5x trigger only: the helper's first statement returns False for any unforced or non-OKX caller, so those paths make no bills call and behave exactly as before"
  - "The check reads its own balance row (one extra GET /api/v5/account/balance, only when the 5x gate fires on the forced OKX path) rather than sharing the anchor's response: the anchor reader is advisory and swallows every exception, the check must let a venue error propagate"
  - "No refusal token added: the closed set stays 15, no new raise site; every unprovable or disagreeing opening is refused with the existing anchor_skipped_implausible"
  - "The anchor stays the live totalEq read; an anchoring that passed only through the bills check is visible as anchor_opening_agreed true in the completion audit (not an EquityDQ member, not in _mt5_telemetry)"
requirements-completed: [SC-2]
status: complete
commits: 4
plan_head_before: 65a6d97425c7aa4e51b5b8d0dd390adc74470ddc
plan_head_after: b513c0c93de8a569368b0625a04768c3b7c82b16
actuals:
  tokens: 8500   # chars/4 over the 5-file realized diff (34067 chars of unified diff)
  tasks: 3
  commits: 4
coverage:
  - id: D1
    description: "A forced OKX rebuild whose bills prove the opening the anchor implies anchors on the forced path, ends DONE, writes rows ending at totalEq carrying the 60000 STARTING_BALANCE, and the completion audit says anchor_opening_agreed true"
    requirement: SC-2
    verification:
      - kind: integration
        ref: "analytics-service/tests/test_okx_anchor_rule.py#test_a_forced_okx_rebuild_whose_bills_prove_the_opening_anchors_and_writes"
        status: pass
    human_judgment: false
  - id: D2
    description: "A disagreeing opening and each of the six unprovable openings refuse anchor_skipped_implausible and write nothing"
    requirement: SC-2
    verification:
      - kind: integration
        ref: "analytics-service/tests/test_okx_anchor_rule.py#test_a_disagreeing_opening_refuses_by_name_and_writes_nothing"
        status: pass
      - kind: unit
        ref: "analytics-service/tests/test_okx_anchor_rule.py#test_each_unprovable_opening_refuses_by_name"
        status: pass
    human_judgment: false
  - id: D3
    description: "The tolerance equals the founder's recorded 0.05, is inclusive at the boundary and bites just outside it"
    requirement: SC-2
    verification:
      - kind: unit
        ref: "analytics-service/tests/test_okx_opening_balance.py#test_the_tolerance_is_the_measured_value"
        status: pass
      - kind: unit
        ref: "analytics-service/tests/test_okx_anchor_rule.py#test_an_opening_just_inside_the_tolerance_anchors_and_just_outside_refuses"
        status: pass
    human_judgment: false
  - id: D4
    description: "Unforced, Bybit and non-positive-replay paths make no bills call; a venue error inside the check propagates instead of becoming a permanent refusal"
    requirement: SC-2
    verification:
      - kind: unit
        ref: "analytics-service/tests/test_okx_anchor_rule.py#test_the_unforced_okx_path_skips_the_check_even_when_the_bills_would_agree"
        status: pass
      - kind: unit
        ref: "analytics-service/tests/test_okx_anchor_rule.py#test_a_rate_limit_inside_the_check_propagates_instead_of_refusing"
        status: pass
    human_judgment: false
metrics:
  duration: "approx. 40 min (start time not captured at launch)"
  completed: 2026-10-27
---

# Phase 172 Plan 04: the forced OKX anchor asks the bills Summary

A forced OKX rebuild that the 5x gate used to refuse now anchors when the venue's own bill balances prove the opening the anchor implies (within the founder's 5% tolerance, floor 1 USD), and still refuses `anchor_skipped_implausible`, writing nothing, when the bills disagree or cannot prove the opening.

## What was built

- `services/okx_opening_balance.py`: `OPENING_TOLERANCE_USD = 1.0`, `OPENING_TOLERANCE_REL = 0.05` (the `tolerance-rel:` line of `172-03-SUMMARY.md`, with a comment carrying the measurement date, a4's `opening_residual_over_anchor=-0.0147`, `implied_opening_over_anchor=0.911`, `bills_opening_over_anchor=0.925`, `bal_over_cashbal=0.932`, the ladder rule that chose it, and the single-account caveat), and `opening_agrees(anchor, replay_final, oracle_opening)`, one comparison line.
- `services/equity_reconstruction.py`: top-level `from services import okx_opening_balance as obal`; `_okx_forced_opening_agrees(...)` above `_fetch_and_price_window`. Its first statement is `if not require_anchor or venue.lower() != "okx":` returning False. It reads its own balance row, then `obal.read_okx_opening`; an unavailable opening logs one token-only warning and returns `False  # opening unavailable: fail closed`; otherwise it returns `opening_agrees(...)` with one `agree`/`disagree` line. It catches nothing. The anchor block's `elif _implausible_anchor` arm now also requires the check not to agree; agreement falls through to the unchanged anchoring `else`, which sets `_anchor_opening_agreed = _implausible_anchor`. The flag rides the telemetry dict, `_merge_account_telemetry` (OR-merge) and the completion audit (`.get(..., False)`), mirroring `anchor_positions_unread`.
- Tests: `tests/test_okx_anchor_rule.py` (15 tests: 10 functions, the unprovable one parametrized 6x), 3 comparator/tolerance tests in `tests/test_okx_opening_balance.py` (one parametrized), and the two merge-telemetry tests in `tests/test_reconstruct_whole_account.py` now cover the new key.

## Commits

| Task | Commit | Subject |
|---|---|---|
| 1 RED | 089d5058e | test(172-04): a forced OKX rebuild with a bills-proven opening must anchor |
| 1 GREEN | d68e4b2b1 | feat(172-04): the forced OKX anchor asks the bills before refusing a large opening |
| 2 | ea800f47d | test(172-04): an unproven or disagreeing OKX opening still refuses by name |
| 3 | b513c0c93 | test(172-04): the OKX opening check is scoped to the forced OKX path and never swallows a venue error |

## TDD evidence

RED (Task 1): the tracer in `tests/test_okx_anchor_rule.py` at commit 089d5058e, run from a `git archive` of that commit's tree, exits 1 with exactly one `FAILED ...::test_a_forced_okx_rebuild_whose_bills_prove_the_opening_anchors_and_writes` and no `ERROR` line. `semanticAssessment`: the target test executed and failed on its first assertion, `result.outcome == DispatchOutcome.DONE`, because the job was FAILED/permanent with `forced rebuild refused (anchor_skipped_implausible)`; the captured log shows the 5x arm firing (`offset=60000.00 exceeds 5x last_value=10000.00`). That is the planned reason (the old gate refusing a bills-proven opening), not an import, fixture or collection fault. The RED commit touches only the new test file. GREEN d68e4b2b1 makes it pass together with the 300-test reconstruction/probe set; the closed-set refusal pin passes unchanged. Tasks 2 and 3 are test-only over the Task 1 behaviour; their RED evidence is the mutation proofs below.

## Mutation proofs

Each mutation ran on a TEMP COPY of the committed tree (`git archive HEAD`, extracted under `<scratchpad>`), never on the working tree; `git status` of the worktree stayed clean throughout, so no byte backup or restore was needed. The pattern was confirmed to occur exactly once in the committed file before applying, and the mutated text was confirmed present afterwards.

| Id | Mutation | Run | Tests that went RED |
|---|---|---|---|
| N1 | comparator made `return True or abs(...) <= ...` (always agrees) | exit 1, 5 failed / 36 passed | `test_a_disagreeing_opening_refuses_by_name_and_writes_nothing`, `test_an_opening_just_inside_the_tolerance_anchors_and_just_outside_refuses`, `test_opening_agrees_is_inclusive_at_the_usd_floor`, `test_opening_agrees_scales_with_the_anchor[below]`, `[above]` |
| N2 | scope guard `if not require_anchor or venue.lower() != "okx":` forced to `if True:` (check never runs) | exit 1, 9 failed / 6 passed | the tracer `test_a_forced_okx_rebuild_whose_bills_prove_the_opening_anchors_and_writes`, all six `test_each_unprovable_opening_refuses_by_name[...]` cases (their log assertion needs the check to run), the tolerance boundary test, and `test_a_rate_limit_inside_the_check_propagates_instead_of_refusing` |
| N2b | (extra) the same guard forced to `if False:` (check runs for every caller) | exit 1, 1 failed / 14 passed | `test_the_unforced_okx_path_skips_the_check_even_when_the_bills_would_agree` (the archive was called) |
| N3 | tolerance replaced by `<= float("inf")` | exit 1, 5 failed / 36 passed | same five as N1, including the boundary test |
| N4 | `return False  # opening unavailable: fail closed` mapped to `return True` | exit 1, 5 failed / 5 passed | `test_each_unprovable_opening_refuses_by_name[reach_unproven]`, `[chain_break]`, `[unpriced_ccy]`, `[malformed_bills]`, `[page_ceiling]` (`[malformed_balance]` takes the helper's separate no-row return and is correctly unaffected) |
| N5 | oracle `except OpeningUnavailable as exc:` widened to `except Exception as exc:` | exit 1, 1 failed / 14 passed | `test_a_rate_limit_inside_the_check_propagates_instead_of_refusing` |

Honest limit found by N2b: the Bybit scope pin alone does not bite when the OKX guard is removed, because a Bybit exchange mock answers the OKX balance call with a non-dict and the check then fails closed to the same refusal. The unforced-path test is what bites that direction. The Bybit pin still asserts the bills method was never awaited, which would fail if a Bybit account ever read bills.

## Verification

- `tests/test_okx_anchor_rule.py tests/test_okx_opening_balance.py tests/test_reconstruct_force_rebuild.py tests/test_reconstruct_whole_account.py tests/test_ana_recon_audit.py tests/test_equity_reconstruction.py tests/test_equity_fallback.py tests/test_reconstruct_marker_writer.py tests/test_allocator_history_probe.py`: 394 passed, from `analytics-service/`. The Task 1 six-file set: 300 passed before Tasks 2 and 3 added tests.
- CI's mypy line verbatim from `analytics-service/`: `Success: no issues found in 124 source files`.
- `OPENING_TOLERANCE_REL == 0.05` equals the `tolerance-rel:` line of `172-03-SUMMARY.md`; `OPENING_TOLERANCE_USD == 1.0`.
- `grep -ac anchor_opening_agreed services/equity_reconstruction.py` is 7 (baseline 0, required at least 4). The closed-set refusal pin `test_forced_rebuild_refusal_reasons_are_a_closed_set` passes: still 15 tokens, no new raise site.
- `node scripts/verify-plan-anchors.mjs` on this plan: OK, 8 claims, no stale.
- The full analytics suite was not run here; the plan assigns it to the orchestrator before ship, and CI is authoritative.

## Deviations from Plan

None - plan executed exactly as written.

Small recorded departures that are inside the plan's latitude, not deviations: (1) the `ids` of the parametrized unprovable cases are the bare tokens, via a module-level `_UNPROVABLE_CASES` list that `test_every_unavailable_token_has_an_anchor_rule_case` compares to `obal.OPENING_UNAVAILABLE_REASONS` so the case list and the closed vocabulary cannot drift; (2) each unprovable case also asserts the check's own log line names the case's token (`opening check unavailable (<token>)`), so a case cannot pass by the 5x arm alone; (3) the scale test runs below and above the implied opening; (4) mutation N2b was added.

## Known Stubs

None.

## Threat Flags

None. The new code reads two existing GET endpoints through the existing oracle and writes nothing new; no endpoint, auth path, schema or file access was added.

## Notes for plan 05

- `172-OKX-NONPOSITIVE-REPLAY-UNGATED` is pinned by `test_a_non_positive_replay_anchors_without_the_bills_check`: a replay ending at or below zero is not gated by the 5x arm (`last_value > 0` is part of the trigger) and anchors at `totalEq` without the bills. Unchanged by this plan; plan 05 books the follow-up.
- One account (a4) is the tolerance's only basis; a second OKX account is unmeasured. No rebuild is enqueued by this phase.
- The rule adds one `GET /api/v5/account/balance` and the bills walk only when the 5x gate fires on a forced OKX rebuild.

## Self-Check: PASSED

- Files exist: `analytics-service/tests/test_okx_anchor_rule.py`, `analytics-service/services/okx_opening_balance.py`, `analytics-service/services/equity_reconstruction.py`, `analytics-service/tests/test_okx_opening_balance.py`, `analytics-service/tests/test_reconstruct_whole_account.py`.
- Commits 089d5058e, d68e4b2b1, ea800f47d and b513c0c93 are ancestors of HEAD on `feat/172-okxanchor`; `git rev-list --count 65a6d97..b513c0c9` is 4.
- All acceptance criteria re-run: comparator body is the single named line; `_okx_forced_opening_agrees` first statement and fail-closed line are present; refusal literals unchanged; RED tree fails the tracer on an assertion; GREEN tree passes; mypy passes.
