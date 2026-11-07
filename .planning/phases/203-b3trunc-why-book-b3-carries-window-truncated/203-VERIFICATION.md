---
phase: 203-b3trunc-why-book-b3-carries-window-truncated
verified: 2026-11-07T13:00:00Z
status: passed
score: 5/5 must-haves verified
verified_at_sha: 98b5a2699c8fcf7b0f4c048107c9fd5f42468d9d
drift_subjects:
  - analytics-service/services/allocator_equity_derive.py
  - analytics-service/tests/test_e2_equity_curve_layer.py
behavior_unverified: 0
overrides_applied: 0
re_verification: false
---

# Phase 203: B3TRUNC Verification Report

**Phase Goal:** Find why book b3 carries `window_truncated`, using Phase 202's evidence as input, and fix it if it is a defect (D-01: defect means fix with a RED test and post-derive evidence; intended means record the explanation and evidence and document the flag as expected; RESID-02 closes with 203 either way).
**Verified:** 2026-11-07, HEAD `98b5a2699c8fcf7b0f4c048107c9fd5f42468d9d` (branch feat/203-b3trunc, base `498217b1e`)
**Status:** passed
**Re-verification:** No, initial verification

## Verdict in one paragraph

The goal is achieved on D-01's second branch. b3 carries `window_truncated` because its seven member keys open on seven different days, and the token is one boolean over unequal member windows, classed BENIGN and absent from the blocking set. That is intended behaviour. The report's quoted rule matches the code at HEAD, the services tree is byte-identical to the base, and the committed test passes and goes RED when the rule is neutered. No defect was found, so no fix, re-derive or PROD write was owed. RESID-02's `window_truncated` half closes with this phase.

## Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | The cause is identified from code, not narrative: the token is set by one expression over the anchored keys and is true whenever any key's first or last day differs from the union's | VERIFIED | `allocator_equity_derive.py` lines 2476-2479 hold the `window_truncated = any(key_first[k] != union_days[0] or key_last[k] != union_days[-1] for k in anchored)` expression and lines 2489-2490 add the reason. Both match the quotes in 203-REPORT.md character for character. Grep for the string across `analytics-service/services`, `src` and `supabase` finds only this one file, so there is no other producer and no reader that treats it as blocking. |
| 2 | b3's windows support the explanation: seven member keys with seven distinct first days | VERIFIED | 202-07's committed `gc-c-b3-key: capture=c1` lines give first days 2023-06-28, 2024-12-07, 2025-10-17, 2025-09-27, 2026-07-29, 2026-01-23 and 2026-07-28. All seven are distinct and the report's table matches them. The committed `gc-c-b3-stored` and `gc-c-b3-truncated` lines show `window_truncated` stored, predicted and agreeing, with b3 untrusted via `out_of_window_flow` only. |
| 3 | The token is benign: it cannot make a book untrusted (the evidence for "intended, not a defect") | VERIFIED | `DegradeReason.WINDOW_TRUNCATED` sits under the BENIGN header (line 108). `_BLOCKING_REASONS` (lines 182-196) does not contain it. `_is_trustworthy` is `not (reasons & _BLOCKING_REASONS)`. The report's quoted header and frozenset match HEAD. |
| 4 | No code change was owed or made: `git diff 498217b1e..HEAD -- analytics-service/services` is empty | VERIFIED | The command printed 0 bytes. The only analytics change in the range is the test file (79 lines added, one new test function). The worktree is clean apart from the orchestrator's `STATE.md` edit and two untracked review records. |
| 5 | The committed test passes and can fail (it is a real characterization, not a vacuous one) | VERIFIED | Run from `analytics-service/` with the main checkout's venv interpreter: `services.allocator_equity_derive.__file__` resolves into the worktree, the test file gave `23 passed`, and `test_staggered_starts_common_end_carry_window_truncated_only` passed alone. I then neutered the benign classification in-process (added `WINDOW_TRUNCATED` to `_BLOCKING_REASONS`, no file edit) and the test went RED (`1 failed`). The test asserts exact reason sets, the `n_tail_days_carried == 0` shape, hand-derivable union levels and an identical-windows control. The fixer round added a common-start, early-end arm (reasons exactly `{WINDOW_TRUNCATED, STALE_MARK_CARRY}`), which covers the `key_last` half of the predicate. |

**Score:** 5/5 truths verified, 0 present-but-behavior-unverified. The trust-vs-token invariant in truth 3 is behavior-dependent and has a passing, mutation-sensitive test, so presence alone was not relied on.

## ROADMAP Success Criteria and Requirement

The ROADMAP Phase 203 section states a goal and no numbered Success Criteria, so the goal sentence is the contract: find why b3 carries `window_truncated`, with 202's evidence as input. 203-REPORT.md does that and cites 202's committed result lines as input. RESID-02 (the `window_truncated` half): "explained, and fixed where it is a defect". It is explained, and there is no defect to fix. SATISFIED. The `out_of_window_flow` half was closed by Phase 202 and is correctly left alone here (b3's untrustworthiness stays attributed to `out_of_window_flow`).

## Closure of 202's `unexplained` reading

202 left the token `unexplained` because one line disagreed (b6, predicted yes, stored no). The report resolves this with 202's own D-14 closure, in which `departed_history_inclusion` excludes an unknown-account departed key by default, so b6's compose counts one key. A predictor over the counted keys makes all seven books agree. The report also warns that the member-keys predictor is near-tautological for multi-key books and must not be a gate. This is consistent with the code.

## Behavioral Spot-Checks and Probes

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Services unchanged vs base | `git diff 498217b1e..HEAD -- analytics-service/services` | empty | PASS |
| New test passes | pytest, single test, from `analytics-service/` | 1 passed | PASS |
| Whole test file passes | pytest on the file | 23 passed | PASS |
| Test can fail | in-process neuter of `_BLOCKING_REASONS` | 1 failed (RED) | PASS |
| Phase records leak-free | grep of 203-REPORT.md for uuid shapes and home paths | no matches | PASS |

No probe scripts are declared for this phase (Step 7c not applicable). Step 4/5 plan-frontmatter artifact and key-link verbs were not used: the single plan's deliverables are one test and one record, both checked directly above.

## Anti-Patterns

The only code change is a test. No TBD, FIXME or XXX markers were added to the changed test file. The diff added no stubs. The ruff F401 on an unused `KeyEquity` import is pre-existing at the base and LOW, so it was correctly not touched.

## Ruling: the unresolved RESID-02 edge probe

**Acceptable. It is not a gap in goal achievement.** The report's Limits note and the SUMMARY say the spec-less edge probe classified RESID-02 as `unclassified`, status `unresolved`, with no verification tier, and that it was carried as a flagged assumption (not auto-resolved, not dropped).

Why this does not block:

1. The probe's missing tier is a classifier outcome about the requirement's wording, not a statement about the codebase. RESID-02 asks for an explanation, and the deliverable is a record. A tier of `test` or `judgment` would only dictate how to check it, and the phase did not need a tier to be checkable.
2. Every claim in the explanation that can be checked mechanically was checked here and holds: the quoted rule against the code, the benign classification against `_BLOCKING_REASONS`, the empty services diff, and a passing, mutation-sensitive test that pins both halves of the predicate and the trust outcome.
3. The flag was carried honestly, in the report and in the SUMMARY, which is the right handling. Silent dropping or auto-resolving would have been the failure.
4. The one residual that stays genuinely open is stated by the report itself as A1: whether key C's last eleven index days are real marks or carried or filled days. The detector compares index endpoints only and cannot tell. The report labels this inferred, not read, and shows the verdict does not rest on it, since seven distinct start days make the expression true on their own. I agree with that reasoning.

This does not warrant `human_needed`. If the founder later wants key C's tail confirmed, that is a separate read-only investigation, not a defect in this phase's deliverable.

## Limits of this verification

- The live-row facts in the report (the stored flag list, `n_keys` 7, the computed-at stamp) came from one read-only PROD reading the orchestrator took. I made no PROD read and cannot re-measure it. What I could check in the repo, 202's committed stored and per-key lines, agrees with it (`window_truncated` stored, b3 untrusted, `out_of_window_flow` the only other reason). The verdict rests on the code rule and the seven distinct start days, both verified from committed evidence.
- The local replay in the report used synthetic windows shaped like b3's, which the report says itself. The committed three-key test is the checkable form.
- I did not re-run the report's file-copy neuters. I ran one independent in-process neuter and read the reviewer's account of the others. The `key_last` arm's neuter result is from the fixer round's log, not a run of mine.

## ROADMAP "Plans: 0 plans" stub

It does not matter for the verdict. The ROADMAP section was edited in this phase only to fill `Requirements` with RESID-02. Its `Plans: 0 plans` line, the TBD stub and the Progress row (`0/0`, Not started) are records bookkeeping, and a plan exists (203-01-PLAN) with a SUMMARY. Verification rests on the code and the report, not on those counters. It needs fixing at `phase complete` time by the orchestrator, before the phase is treated as closed. Per CLAUDE.md, `phase complete` also drops Progress-table Status prose, so the orchestrator should `git diff` after it runs. I did not edit the ROADMAP.

## Hygiene notes

- `203-REVIEW.md` and `203-REVIEW-DISPOSITION.md` are untracked in the worktree. They should be committed with the records, since the disposition is the evidence that no MEDIUM+ finding survived.
- Per the repo's "Completion is HISTORICAL" rule, this file uses `verified_at_sha` and `drift_subjects` only, with no `covered_files` or `covered_digest`.

## Gaps Summary

None. No truth failed, no artifact is missing or stubbed, no human-verification item remains.

---

_Verified: 2026-11-07T13:00:00Z_
_Verifier: Claude (gsd-verifier)_
