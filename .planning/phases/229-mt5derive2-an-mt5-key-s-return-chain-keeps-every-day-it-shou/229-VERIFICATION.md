---
phase: 229-mt5derive2-an-mt5-key-s-return-chain-keeps-every-day-it-shou
verified: 2026-11-24T21:00:00Z
status: passed
score: 5/5 must-haves verified
verified_at_sha: 2761b04be94904d07f56e560515dfcc9dbf4c25a
drift_subjects:
  - analytics-service/services/nav_twr.py
  - analytics-service/services/job_worker.py
  - analytics-service/services/allocator_equity_derive.py
  - analytics-service/services/transforms.py
  - analytics-service/services/analytics_runner.py
  - analytics-service/scripts/mt5_soak.py
  - analytics-service/tests/test_nav_twr.py
  - analytics-service/tests/test_allocator_equity_writer_basis.py
  - analytics-service/tests/test_mt5_soak.py
  - analytics-service/tests/test_job_worker.py
  - analytics-service/tests/test_transforms.py
  - analytics-service/tests/test_csv_analytics_runner.py
behavior_unverified: 0
overrides_applied: 0
human_verification: []
---

> **verified_at_sha rebound 2026-11-25 (records PR).** The verdict was issued on phase-branch commit `0771f1f3f`, which is not reachable from `main` after the squash merge. It is rebound to the merge commit `2761b04be` (#1328) so that `scripts/verification-drift-report.mjs` can diff from a reachable commit. None of the files listed in `drift_subjects` differs between the two commits (`git diff --name-only 0771f1f3f 2761b04be -- <drift_subjects>` is empty), so the rebind changes nothing about what was verified.
>
> ⛔ **CORRECTED 2026-11-25 (229 close records PR).** The parenthetical above is wrong as written. `git diff --name-only 0771f1f3f 2761b04be -- <drift_subjects>` prints `analytics-service/services/job_worker.py` and `analytics-service/tests/test_job_worker.py`, because `main` gained Phase 231 plans 03-05 (#1321) and Phase 223 (#1327) after the phase branch's base `e5759fa76`, and both touched those files. The phase's own change is identical on both sides: `git diff e5759fa76 0771f1f3f -- <file> | git patch-id --stable` equals `git diff 6e8df792a 2761b04be -- <file> | git patch-id --stable` for both files (`0eb24672…` and `29cd8c07…`). So the conclusion stands (the rebind changes nothing about what was verified); only the "is empty" claim was false. The sentence above is kept as lineage.

# Phase 229: MT5DERIVE2 Verification Report

**Phase Goal:** An MT5 key's return chain keeps every day it should, and a timed key with no writer basis never composes silently: the seam-S1 money-math gaps are fixed at their root, which moves published MT5 returns.
**Verified:** 2026-11-24 (re-verified at 0771f1f3f after the departed-key exemption 5839f0f8b and b3b034f8b; earlier readings at b43f4c786 and 5584b07b9)
**Status:** passed (human_needed until the post-merge closure of 2026-11-25 at the end of this report)
**Re-verification:** Yes, after the founder ruling "Exempt departed keys" (source commits 5839f0f8b and b3b034f8b). No gaps were open, so this is a regression and SC-4 re-check, not a gap closure.

All code-side truths hold. The one open item is the founder's live soak (ROADMAP SC-5, last sentence), which needs private MT5 credentials and was not run. No gaps found.

## Re-verification at 0771f1f3f (departed-key exemption)

Since b43f4c786 the source changed in two commits: `5839f0f8b` (`job_worker.py`, `test_allocator_equity_writer_basis.py`) and `b3b034f8b` (rewords the new log line). Commit `65e603570` recorded the founder's SCOPE NOTE ("Exempt departed keys") on the MT5D-07 RULED line in `229-CONTEXT.md` and on ROADMAP Phase 229 SC-4; `0771f1f3f` is the round-3 review. `git diff 7342bd047 HEAD -- analytics-service` touches only those two files.

**Change.** A departed key (replayed from its saved `key_inputs` row) whose row carries `writer_basis_withheld` or whose stored returns disagree with its stamp is no longer added to `withheld_by_key` or `stamp_mismatch_days_by_key`. It goes into the new set `departed_basis_unchecked`, which raises the benign token `departed_writer_basis_unchecked` (in `benign_flag_tokens`, not in `degrade_reasons`), writes `inputs.departed_writer_basis_unchecked_keys` (a count), and logs one counts-only warning ("N departed key(s) carry no writer basis or disagree with their returns stamp and are exempt from that block (229 MR-01)"). `_compare_returns_stamp` takes an optional `unchecked` set; only the departed call site passes it. The counted site (`withheld_by_key[api_key_id] = _withheld`, `_compare_returns_stamp(api_key_id, payload, returns_by_key, _basis is not None)`) and the stitch-source site (`withheld_by_key[api_key_id] = _source_withheld`) are unchanged.

**SC-4 (MT5D-07, HOLD-03, including the scope note) at HEAD: still VERIFIED, against the narrowed scope.**
- Live keys still block. The compose still raises `DegradeReason.KEY_INPUTS_MISMATCH` on `bool(withheld_by_key) or bool(stamp_mismatch_days_by_key)`. `test_a_stitch_source_or_counted_key_with_the_token_blocks_the_book[stitch-source|counted]`, `test_a_stitched_member_whose_rows_disagree_with_its_stamp_is_refused` and the same-terminal pair tests still pass.
- Departed keys are exempt as ruled. `test_a_departed_key_with_the_token_is_exempt_and_flagged_not_blocked` asserts no `key_inputs_mismatch`, the flag, the count, a clean book carrying neither, and a counts-only log (no key id, no `unpriced_days`). `test_a_departed_key_whose_rows_disagree_with_its_stamp_is_exempt_and_flagged[True|False]` asserts the flag and count appear only on a disagreeing stamp.
- The flag is non-blocking by construction: it is passed through `benign_flag_tokens`, the same channel as `departed_history_unavailable`.
- The exemption does not weaken the retry or no-history paths: the no-history pop (`withheld_by_key.pop`, `stamp_mismatch_days_by_key.pop`) and the `lagging_inputs` clause are untouched.
- MR-01 is fixed per the founder's ruling (229-REVIEW.md round 3); it is no longer an escalated limit. The earlier paragraph recording it as open is superseded by this section.

**Neuter check of the exemption (departed tests go RED).** Byte backup of `job_worker.py` in the session scratchpad, restored with `cp` and checked with `cmp` (silent) after each:
1. Replacing `departed_basis_unchecked.add(api_key_id)` at the departed token site with `withheld_by_key[api_key_id] = _departed_withheld`: `test_a_departed_key_with_the_token_is_exempt_and_flagged_not_blocked` RED (1 failed, 3 passed in the `-k departed` selection).
2. Replacing the `if unchecked is not None: ... else:` branch in `_compare_returns_stamp` with an unconditional `stamp_mismatch_days_by_key[key_id] = mismatching`: `test_a_departed_key_whose_rows_disagree_with_its_stamp_is_exempt_and_flagged[False]` RED (1 failed, 3 passed).
After both restores, the departed, stitch-source, stitched-member and counted selection is 15 passed and `git status` shows no tracked source change.

**SC-1, SC-2, SC-3: unaffected.** No commit since b43f4c786 touches `nav_twr.py`, `transforms.py`, `analytics_runner.py`, `mt5_soak.py` or the fixtures; `tests/test_nav_twr.py`, `test_transforms.py`, `test_csv_analytics_runner.py` and `test_mt5_soak.py` pass at HEAD. **SC-5**: the proof half still holds; the live soak and the 155.2 merge-order check remain the two human items, unchanged.

**Gates at 0771f1f3f (from `analytics-service/`):**
- `pytest -q -p no:cacheprovider tests/test_nav_twr.py tests/test_allocator_equity_writer_basis.py tests/test_job_worker.py tests/test_transforms.py tests/test_csv_analytics_runner.py tests/test_mt5_soak.py tests/test_derive_allocator_equity_job.py`: 909 passed, 1 skipped (the local-lane skip), 0 failed.
- CI mypy (`mypy --strict --follow-imports=silent --config-file=pyproject.toml services/ routers/ models/ main.py main_worker.py main_worker_healthz.py sentry_init.py`): `Success: no issues found in 142 source files`.
- I did not re-run the full suite.

## Re-verification at b43f4c786 (stamp-race fix)

Since 5584b07b9 the source changed in one commit, `156c56a08` (`job_worker.py` +13/-4 lines region, `test_allocator_equity_writer_basis.py`). Everything else after 5584b07b9 is .planning only (round-1 and round-2 review reports).

**Change.** `lagging_inputs` (the R2-WR-01 read-race retry) now also counts a key present in `stamp_mismatch_days_by_key` that has a stored return day. A same-terminal re-derive that revises an in-window return does not move the last day, so the old last-day check missed it and a compose reading between the derive's returns write and its `key_inputs` write blocked at once. Now every attempt before the last ends the job transient (nothing persisted), and the last attempt composes what is stored and blocks as `KEY_INPUTS_MISMATCH`.

**SC-4 (HOLD-03) against HEAD: still VERIFIED.**
- A mismatched same-terminal pair is still refused by name: on the last attempt the compose reads `bool(withheld_by_key) or bool(stamp_mismatch_days_by_key)` and raises `key_inputs_mismatch`; `test_a_same_terminal_rederive_pair_with_a_timed_day_correction_is_refused...` and `test_a_stitched_member_whose_rows_disagree_with_its_stamp_is_refused` now run on the last attempt (`_LAST_ATTEMPT`) and pass. The refusal is delayed by the retry, never lost: the claim RPC increments `attempts`, and the third run composes and blocks (round-2 code reviewer, same conclusion).
- A healthy pair is never refused or retried: `stamp_mismatch_days_by_key` is only filled when `returns_stamp_mismatch_days(...) > 0`, a stampless row is counted and not refused, and the healthy-pair and stampless tests in the suite pass.
- A key the no-history rule removes is popped from `stamp_mismatch_days_by_key` before it can count, and the new clause also requires `k in last_return_day`, so it cannot retry forever on a key with no returns.
- New test `test_a_counted_key_whose_stamp_disagrees_ends_transient_before_the_last_attempt` asserts attempts 0, 1 and 2 end FAILED/transient with no curve persisted, and the last attempt blocks. Neuter check: replacing the new `or (k in stamp_mismatch_days_by_key and k in last_return_day)` clause with `or False` turned that one test RED (1 failed, 153 passed in the file); restored from a byte backup, `cmp` silent.
- `read_writer_basis` and the compose block are untouched by the fix.

**SC-1, SC-2, SC-3: unaffected.** The commit does not touch `nav_twr.py`, `transforms.py`, `analytics_runner.py` or `mt5_soak.py`; `FLOW_TIMING_LARGE_RATIO` is still 1.0 there. `tests/test_nav_twr.py`, `test_transforms.py`, `test_csv_analytics_runner.py` and `test_mt5_soak.py` pass at HEAD. Fixtures unchanged since 5584b07b9 (the frozen spine was not touched by this commit).

**Gates at b43f4c786 (from `analytics-service/`):**
- `pytest -q -p no:cacheprovider tests/test_nav_twr.py tests/test_allocator_equity_writer_basis.py tests/test_job_worker.py tests/test_transforms.py tests/test_csv_analytics_runner.py tests/test_mt5_soak.py tests/test_derive_allocator_equity_job.py`: 909 passed, 1 skipped (the local-lane skip), 0 failed.
- CI mypy (`mypy --strict --follow-imports=silent --config-file=pyproject.toml services/ routers/ models/ main.py main_worker.py main_worker_healthz.py sentry_init.py`): `Success: no issues found in 142 source files`.
- I did not re-run the full suite; the round-1 review's 15583-test reading predates the fix.

**MR-01 (= SFH-229-01): superseded.** Open and escalated at this reading, it was fixed afterwards by the founder's ruling "Exempt departed keys"; see the section at 0771f1f3f above.

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | SC-1 (MT5D-04): a timed re-funding day into an emptied account (empty cohort 0) keeps the return chain intact; a test RED on old code drives it | VERIFIED | `nav_twr._judged_cohorts` now has `later_judged = any(cohort_pnl[k] != 0.0 for k in range(1, n_cohorts))` and skips a P&L-less cohort when `k > 0 or inception or later_judged`. 188's tiny-base test still runs after, at the `chain_linked_twr` call site. I restored the base `nav_twr.py` over the working copy: 17 tests went RED (`test_a_refund_day_is_measured_unless_it_opened_on_a_tiny_base[...]`, `test_timed_empty_cohort_zero_is_skipped_when_a_later_cohort_is_judged[...]`, `test_a_refund_into_an_emptied_mt5_account_is_published_end_to_end`, soak `test_a_refund_day_into_an_emptied_account_is_verified_by_the_soaks_own_walk`). I put the file back from a byte backup (`cmp` silent) and the run is green. |
| 2 | SC-2 (MT5D-05): an inception day's P&L is booked or carries a named flag; no day-0 P&L is dropped as NaN without one | VERIFIED | The inception branch of `chain_linked_twr` counts `abs(cur - prev - flow_t) > 1e-9 * max(abs(cur), abs(flow_t))` into `inception_day_pnl_dropped_days` and raises the bool `inception_day_pnl_dropped`. The flag is an annotation: it is in `NAV_TWR_ANNOTATION_KEYS`, not in `NAV_TWR_GUARD_KEYS`. It is carried through `_build_nav_meta`, `_merge_status_meta`, the job pre-stamp, the `DataQualityFlags` TypedDict and `run_csv_strategy_analytics`. The neuter run above also turned `test_inception_day_zero_pnl_is_flagged_by_name_never_dropped_silently[*]`, `test_a_single_inception_day_with_pnl_is_flagged`, `test_native_and_mt5_day_zero_pnl_raise_the_flag` and the annotation-completeness test RED. Flagged by name, not booked, per CONTEXT (no base to book a return on). |
| 3 | SC-3 (MT5D-06): the large-flow annotation covers a day-level flow under the previous NAV, or the founder's acceptance of the D-15 band is recorded with its reason; `FLOW_TIMING_LARGE_RATIO` not widened | VERIFIED | `229-CONTEXT.md` records the founder ruling of 2026-11-24 ("Keep 1.0, accept band"), with its reason (root fix is intraday timing, `[164.6.6.2.3-DERIBIT-INTRADAY-TIMING]`; a lower ratio has no measured fleet rationale and would change factsheet copy and the payload cache version). `FLOW_TIMING_LARGE_RATIO = 1.0` at `nav_twr.py:93`, and the phase diff does not touch that line. |
| 4 | SC-4 (MT5D-07, HOLD-03): a timed MT5 key with no writer basis is counted or blocked by a named signal, never composed silently; a same-terminal re-derive pair whose per-day returns differ is refused as well as a calendar mismatch | VERIFIED | MT5D-07: `_native_key_usd_writer_basis` returns a closed token (`WRITER_BASIS_WITHHELD_TOKENS`, 8 members) on every former `None` exit; `_convert_native_key_to_usd` carries it as `writer_basis_reason`; the store gate's `elif venue == "mt5" and timed_days > 0` stores `writer_basis_withheld` in `key_inputs`; the compose reads it at the counted, departed and stitch-source sites, pops it for a key the no-history rule removes, and raises `DegradeReason.KEY_INPUTS_MISMATCH` (a blocking reason) for the primary and fallback compose through one shared `degrade_reasons` list. Logs carry counts and the token histogram only. HOLD-03: each key-mode exit (main and short) stamps exactly the rows it upserted into `key_inputs.returns_stamp` in the same atomic upsert; the compose runs `_compare_returns_stamp` per raw key before `stitch_shared_account`; `returns_stamp_mismatch_days` uses a 1e-12 tolerance and the stamp's own window; a stampless row is counted at info and not refused. `read_writer_basis` is byte-unchanged: I hashed the function body at the phase base and at HEAD, both `acd576aa4b645c00`. Neuter run: replacing the compose's `bool(withheld_by_key) or bool(stamp_mismatch_days_by_key)` with `False` turned 10 tests RED (departed, stitch-source and counted token blocks, unknown token, quiet-day and timed-day correction pairs, stitched member, departed key). Neutering the store gate (`elif False:`) turned the holed-key and trailing-unpriced-close tests RED. Both restored by byte backup with `cmp` silent. Known limits are recorded in the ROADMAP note and REVIEW (IN-01, IN-02, IN-05). Scope narrowed by the founder ruling "Exempt departed keys" (SCOPE NOTE in 229-CONTEXT.md and ROADMAP SC-4): live counted and stitch-source keys still block; a departed key's withheld token or stale stamp is counted into the non-blocking `departed_writer_basis_unchecked` flag instead (re-verified at 0771f1f3f, neuter RED for both departed tests). |
| 5 | SC-5 (PROOF-01): each gate goes RED on pre-fix or neutered code with its named arm first, restored by `cp` and `cmp`, GREEN, recorded in the plan SUMMARY; oracles import no production helper; frozen spine never re-baselined; 226's soak run against the changed derive is recorded beside the merge | PARTIAL: proof half VERIFIED, soak half routed to human | PROOF-01 is recorded in `229-01` to `229-05` SUMMARY (grep counts of `PROOF-01`: 2, 3, 6, 2, 12) and I reproduced RED and GREEN for the three gates above. `git diff --quiet e5759fa76 -- analytics-service/tests/fixtures/` exits 0, so no fixture moved and `regen_golden.py` was not used. IN-04: `test_the_soak_walk_matches_a_hand_fraction_walk_on_the_refund_day` is the hand-fraction oracle with no production import. The live soak (`229-06` Task 2) is pending the founder: see human_verification. |

**Score:** 4/5 truths verified (SC-5's proof half is verified; its live-soak half is a human item). 0 behavior-unverified.

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `analytics-service/services/nav_twr.py` | `_judged_cohorts` rule, inception annotation, ratio unchanged | VERIFIED | Substantive, wired from `chain_linked_twr`, flags flow to meta. |
| `analytics-service/services/job_worker.py` | token plumbing, store gate, stamp at both exits, compose reads and blocks | VERIFIED | Wired at all three compose sites and both derive exits. |
| `analytics-service/services/allocator_equity_derive.py` | token set, `read_writer_basis_withheld`, stamp payload, reader and comparator; `read_writer_basis` untouched | VERIFIED | The one deleted line is the `typing` import widened with `Final`. |
| `analytics-service/services/transforms.py`, `analytics_runner.py` | present-only carry of `inception_day_pnl_dropped` | VERIFIED | Pinned by `test_transforms.py` and `test_csv_analytics_runner.py`. |
| `analytics-service/scripts/mt5_soak.py` | soak walk re-derived from the ruled cohort rule | VERIFIED | `_walk_cohorts` uses the same predicate, documented as taken from the CONTEXT text. |

### Key Link Verification

| From | To | Via | Status |
|------|----|-----|--------|
| `_native_key_usd_writer_basis` token | store gate | `_NativeKeyUsd.writer_basis_reason` to `_writer_basis_reason` to `key_inputs["writer_basis_withheld"]` | WIRED |
| derive exits | `key_inputs.returns_stamp` | `_returns_stamp_rows` set at both exits, `returns_stamp_payload` in the epilogue upsert | WIRED |
| compose read loop | `DegradeReason.KEY_INPUTS_MISMATCH` | `withheld_by_key` and `stamp_mismatch_days_by_key` into the shared `degrade_reasons` | WIRED (neuter proves it bites) |
| `chain_linked_twr` flag | `data_quality_flags` | `_build_nav_meta`, `_merge_status_meta`, pre-stamp, `run_csv_strategy_analytics` | WIRED |

### Data-Flow Trace (Level 4)

The stamp is built from `rows_payload` (the rows actually upserted) and `_measured` (the rows the short exit upserted), not from in-memory `returns`. The token comes from the branch that returned no basis. No static source. FLOWING.

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Phase test files | `pytest tests/test_nav_twr.py tests/test_allocator_equity_writer_basis.py tests/test_mt5_soak.py tests/test_transforms.py tests/test_csv_analytics_runner.py tests/test_job_worker.py -n 4` (from analytics-service) | 749 passed, 1 skipped (the local-lane skip the REVIEW names) | PASS |
| Neuter `nav_twr.py` to base | same files, base copy in place | 17 failed | RED as required; restored, `cmp` silent |
| Neuter compose block | `test_allocator_equity_writer_basis.py`, `test_job_worker.py` | 10 failed | RED as required; restored, `cmp` silent |
| Neuter store gate | same | 2 failed | RED as required; restored, `cmp` silent |
| mypy strict, the services files | `mypy --strict --follow-imports=silent` on the five touched services files | no errors in `services/`; 4 `type-arg` errors in `scripts/mt5_soak.py` | PASS for the CI scope (`services/ routers/ models/ ...`, which excludes `scripts/`); the summaries' 142-file reading is unchanged |
| Frozen spine | `git diff --quiet e5759fa76 -- analytics-service/tests/fixtures/` | exit 0 | PASS |

I did not re-run the full suite, the 15583-test reading in 229-06 SUMMARY is the executor's. The working tree is clean after the neuter runs.

### Probe Execution

No probes declared. Step 7c: not applicable.

### Requirements Coverage

| Requirement | Plan | Status | Evidence |
|-------------|------|--------|----------|
| MT5D-04 | 229-01, 229-04 | SATISFIED | Truth 1 |
| MT5D-05 | 229-02 | SATISFIED | Truth 2 |
| MT5D-06 | 229-01 | SATISFIED | Truth 3, acceptance recorded, ratio 1.0 |
| MT5D-07 | 229-03 | SATISFIED | Truth 4 |
| HOLD-03 | 229-05 | SATISFIED | Truth 4, via the compose-side stamp the ROADMAP note describes |

No orphaned requirements. `REQUIREMENTS.md` still shows these as Pending: that is ship-time bookkeeping, not a code gap.

### Anti-Patterns Found

No `TBD`, `FIXME`, `XXX` or `HACK` in the added analytics lines. One docstring mentions "the TODOS entry", which is prose, not a marker. 229-REVIEW (round 1, clean): 0 critical, 0 warning, 6 info. Its deviation (reviewers run inline, no subagent dispatch) is recorded there. I read the diff independently and agree with its triage.

### Human Verification Required

1. **226's live soak against the changed derive (229-06 Task 2).** Run `python -m scripts.mt5_soak` from `analytics-service/` on a checkout whose analytics-service tree hash is `4d6d1b215`, with the five `MT5_SPIKE_*` variables set and `MT5_SOAK_LOG_DIR` outside the repo. Expected: exit 0, with the parity verdict and `return_check` lines recorded in the 229-06 SUMMARY. Why human: private MT5 gateway and credentials.
2. **155.2 freeze at ship.** Confirm the merge lands before 155.2 plan 12's recapture or after plan 14.

### Gaps Summary

None. The five seam fixes exist, are wired, and are pinned by tests that I saw go RED when each fix was removed and GREEN when it was restored. The phase waits on the founder's live soak and on the merge-order check.

---

_Verified: 2026-11-24_
_Verifier: Claude (gsd-verifier)_


## Post-merge closure (2026-11-25)

Both human items are closed. Status moves from human_needed to passed, and SC-5 moves from PARTIAL to VERIFIED: score 5/5. The two items as they stood are kept here as lineage:

1. "229-06 Task 2: run 226's live soak (python -m scripts.mt5_soak, from analytics-service/) against the changed derive, on a checkout whose analytics-service tree hash is 4d6d1b215, with MT5_SOAK_LOG_DIR outside the repository." Expected: "exit 0; parity verdict and return_check lines (checked, timed_verified, guarded, indeterminate, mismatch_count, certified_share, ok) pasted into the 229-06 SUMMARY beside the merge. Any other exit is recorded red."
2. "At ship: re-check the 155.2 freeze." Expected: "155.2-12-SUMMARY.md is absent on origin/main (merge is before plan 12's recapture) or plan 14 is merged (after it)."

**Item 1, the live soak: CLOSED, exit 0.** The founder ran the soak on 2026-11-25 (`soak_run_at` 12:17:10Z) inside the deployed `quantalyze-analytics` Railway container, at deployed commit `549f3d9775cb517f54f9317cf62255b74043a125` (v0.133.74.0, #1334), which contains this phase's merge `2761b04be`, with `MT5_SOAK_LOG_DIR=/tmp/mt5soak` in the container. Result: `exit=0`. Parity: `parity_ok` true, `recon_ok` true, `recon_level_ok` true, `return_check_ok` true, account unit USD. `return_check`: ok true, vacuous false, checked 26, timed 0, timed_verified 0, guarded 0, flat 48, flow_only 10, indeterminate 0, mismatch_count 0, certified_share 1.0 (min 0.5), max_abs_err 1.006e-16 at tolerance 1e-9. `attribution_check` ok over 36 days, 0 mismatches. Wedge within materiality. The full reading is in `229-06-SUMMARY.md`, "Task 2". It is the coordinator's relay of the founder's run (counts only), not pasted stdout; no login, server string or balance is recorded.

Three points against the expected outcome, each judged:
- **The tree hash is not `4d6d1b215`.** The deployed analytics-service tree is `91161c544`. The plan's letter says a different hash voids the run; I judge it does not here, and record the deviation. The pin's purpose is that the soak judges this phase's code. The soak's full import closure (measured from `sys.modules` after importing it and its function-level imports from a `git archive` of `549f3d97`) is byte-identical between `4d6d1b215`, the final verified tree `4e05033e3`, the merge tree `4b87fec4f` and the deployed tree `91161c544`: `git diff --stat` over those files is empty for all three pairs. The files that differ (232, 231-06 and 240's `job_worker.py`, `exchange.py`, `rate_limit.py` and others) are not loaded by the soak. `4d6d1b215` itself was the Task 1 tree and already stale on the phase branch, which later moved `job_worker.py` (not in the soak's closure either).
- **The top-level spike verdict is INCONCLUSIVE.** It comes only from `server_time_offset`, which `_leg4_server_time_offset` in `scripts/mt5_spike.py` marks `founder_confirmation_required` on every run and which "never reads GO" by construction. The soak's exit-0 contract excludes NO-GO, not INCONCLUSIVE, so exit 0 here is the soak's pass. The expected outcome names the exit code and the parity and return_check lines; all are present. The offset reading (`raw_offset_minutes` -2435 against `server_utc_offset_min_assumed` 180) reflects a latest deal about 40 hours old, not a clock fault.
- **`timed` is 0 on this account, so the live run did not exercise the timed-key branches** (MT5D-04's timed refund day, MT5D-07's writer-basis token on a timed key). That is a limit of this reading, not a failure of the expected outcome: neither SC-5 nor 229-06 asks the live run for a timed day. The timed branches remain proven by the PROOF-01 RED/GREEN records in 229-01 to 229-05 (re-checked in this report) and the frozen fixtures.

**Item 2, the 155.2 freeze: CLOSED, satisfied.** `git ls-tree -r --name-only 2761b04be -- .planning/phases` lists `155.2-10-SUMMARY.md` and no `155.2-12-SUMMARY.md`, so plan 12's recapture had not landed when 229 merged as #1328. The same listing on `origin/main` (`8507564ef`, 2026-11-25) still has no `155.2-12-SUMMARY.md`, so the merge is before plan 12's recapture, which the freeze allows.

_Closure recorded: 2026-11-25 (records PR; orchestrator evidence, not a re-run of the verifier)._
