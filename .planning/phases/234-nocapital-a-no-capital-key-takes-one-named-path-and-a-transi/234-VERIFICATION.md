---
phase: 234-nocapital-a-no-capital-key-takes-one-named-path-and-a-transi
verified: 2026-11-25T13:00:00Z
status: passed
score: 9/9 must-haves verified
verified_at_sha: 4c04267733736c02d735443ad6bf8dc6c8eb38b3
drift_subjects:
  - analytics-service/services/job_worker.py
  - analytics-service/services/allocator_equity_compose.py
  - analytics-service/services/allocator_equity_derive.py
  - analytics-service/tests/test_derive_allocator_equity_job.py
  - analytics-service/tests/test_allocator_equity_no_capital_exit.py
  - analytics-service/tests/test_allocator_equity_inception.py
behavior_unverified: 0
overrides_applied: 0
re_verification: false
---

> **verified_at_sha rebound 2026-11-25 (records PR).** The verdict was issued on phase-branch commit `4e141bcc0`, which is not reachable from `main` after the squash merge. It is rebound to the merge commit `4c0426773` (#1339) so that `scripts/verification-drift-report.mjs` can diff from a reachable commit. `git diff --name-only 4e141bcc0 4c0426773 -- <drift_subjects>` is empty, and each drift subject's phase patch has the same `git patch-id` as the merge's, so the rebind changes nothing about what was verified.

# Phase 234: NOCAPITAL Verification Report

**Phase Goal:** A no-capital key takes one named path, and a transient read never drops a funded key, in the compose reader's no-capital machinery (seam S2), plus the out-of-window ruling (plan 04).
**Verified:** 2026-11-25
**Status:** passed
**Re-verification:** No, initial verification. Judged at HEAD against `234-CONTEXT.md` as corrected on 2026-11-25 (two-sided ledger band, `ledger_level_negative`, empty basis is no proof, `_compose_refused` carries counts, IN-02 exclusion).

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | SC-1 / NOCAP-01: a funded MT5 key whose stored terminal reads zero for one tick keeps `dropped_key` and is never exited as no-capital | VERIFIED | `job_worker.py` apply loop (about :17830-17841) gates every `LEDGER_PROOF_VENUES` (`{"mt5"}`) candidate on `_no_capital_ledger_level(writer_basis_raw.get(_k))`, from the key's OWN `key_inputs` row (not the stitched basis). It refuses `None` (no basis or empty day P&L) as `ledger_basis_absent`, `> DUST_NAV_FLOOR` as `ledger_level_funded`, and `< -DUST_NAV_FLOOR` as `ledger_level_negative`. Selection also refuses a terminal `< -DUST_NAV_FLOOR` as `negative_terminal`. Tracer `test_no_capital_exit_mt5_transient_zero_over_a_funded_ledger_keeps_dropped_key` drives the transient zero. Neutering the gate (`in LEDGER_PROOF_VENUES and False`) turned that tracer RED (1 failed, 113 passed with `-x`). |
| 2 | NOCAP-01 corrected scope: the band is two-sided and an empty basis is no proof | VERIFIED | Code refuses both sides. `test_no_capital_exit_mt5_ledger_far_below_zero_is_refused_as_ledger_level_negative`, `..._empty_basis_lists_are_refused_as_ledger_basis_absent` and `test_no_capital_exit_mt5_ledger_band_edges` (edges derived from `DUST_NAV_FLOOR`) exist and pass. |
| 3 | SC-2 / NOCAP-02: any `Exception` from a candidate (apply loop or compose), not only `NavReconstructionError`, leaves the previous row intact across retries | VERIFIED | Apply loop is `try/except Exception/else` and restores all seven maps from `no_capital_stored`. The compose call has a sibling `except Exception` arm, re-raised when no candidate is in play, with one revert compose on stored inputs. A `NavReconstructionError` in the revert compose goes to `_compose_refused`. `BaseException` is not caught. Each handler emits one class-only Sentry warning. Neutering the apply-loop handler to `except NavReconstructionError` turned 3 tests RED (`..._fault_in_the_apply_loop_reverts_and_keeps_the_row`, `..._reaches_sentry_as_one_class_only_event[apply_loop]`, `..._replaces_the_loops_own_counts`). Behaviour is exercised by tests (retry via `dispatch(` in the tracer), so it is not presence-only. |
| 4 | SC-3a / NOCAP-03: every fallback to `dropped_key` stores a payload flag naming why and is counted per run | VERIFIED | `NO_CAPITAL_REFUSAL_REASONS` is a closed twelve-token set with the single validator `no_capital_refusal_field`. `payload["inputs"]["no_capital_exit_refused"]` is written by the compose (`replay_refused`, `blocking_reason`, `segment_terminals_missing`) and merged in the job with its own routes (`no_stored_terminal`, `funded_terminal`, `negative_terminal`, ledger tokens, `consumes_more_than_dust`, `compose_reverted`, `candidate_exception`). Counts only, never in `degrade_reasons`, absent on a healthy run. `_persist_refusal` / `refusal_payload` and `_compose_refused` carry it (review M2). `test_derive_refusal_rows.py` and its fixture are unchanged and green. |
| 5 | SC-3b / NOCAP-04: a refused candidate leaves no residue reason (`key_inputs_mismatch`) | VERIFIED | The compose segment loop (about :762-767) sends a candidate with missing segment terminals to `fell_back` instead of adding `KEY_INPUTS_MISMATCH`. A non-candidate keeps today's behaviour. Neutering that branch (`if False:`) turned `test_hole_candidate_without_its_segment_terminals_falls_back_with_no_residue` RED in both arms (`clean-last-segment`, `blocking-last-segment`). |
| 6 | Out-of-window ruling (plan 04): a flow after the last return day on a day in the key's `tiny_base_days` is not `out_of_window_flow`; nothing else moves | VERIFIED | `replay_key_equity` counts `fd < lo or (fd > hi and fd not in stated)`. `tiny_base_days` is a new optional keyword (default none, so existing callers are unchanged). `read_tiny_base_days` is strict (malformed list raises inside the read loop's `try`, so the job takes `_permanent_corrupt_input`; absent or null reads as none). It is read for counted and departed keys (job_worker.py :17416, :17478) and threaded via `tiny_base_days_by_key` to the compose (:18277) and into the replay. Neutering to `(fd > hi)` turned four tests in `test_allocator_equity_inception.py` RED. |
| 7 | SC-4 / PROOF-01: each gate RED on neutered or pre-fix code, restored from byte backup, GREEN, recorded in the plan SUMMARYs | VERIFIED | Plan SUMMARYs 01-04 each carry RED transcripts and `cmp -s` restore records (RED/cmp counts 11/9, 7/6, 9/7, 3/2). I re-ran four neuters independently (ledger gate, apply-loop except, segment-residue branch, tiny-base scope). All went RED on the named tests, and each file was restored from a byte backup and `cmp` reported it identical. `git status` is clean after. |
| 8 | Python only, no migration, no TS/UI change | VERIFIED | `git diff 29e5448e9..HEAD --stat -- . ':!.planning'` lists exactly six files, all under `analytics-service/` (three services, three test files). |
| 9 | Safety / privacy convention: new logs, counts and Sentry events carry counts and class names only | VERIFIED | Both new Sentry captures use a static message with tags `compute_job_id` and `exception_class` only. Warnings log `type(exc).__name__` and counts, never `str(exc)`. Reader error messages name the field, never the stored value. The refusal field validator rejects unknown tokens and non-integer counts. |

**Score:** 9/9 truths verified (0 present but behaviour-unverified).

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `analytics-service/services/allocator_equity_derive.py` | `NO_CAPITAL_REFUSAL_REASONS`, `no_capital_refusal_field`, `LEDGER_PROOF_VENUES`, `read_tiny_base_days`, `tiny_base_days` kwarg | VERIFIED | All present and substantive, wired from the compose and the job. |
| `analytics-service/services/allocator_equity_compose.py` | NOCAP-04 forced fallback, per-route counts, `tiny_base_days_by_key` | VERIFIED | The counts reach `payload["inputs"]`. |
| `analytics-service/services/job_worker.py` | ledger gate, selection tokens, two revert handlers, tiny-base reads, merged field | VERIFIED | Wired into `run_derive_allocator_equity_job`. |
| Three test files | Gates able to fail | VERIFIED | Each gate has a neuter that turns a named test RED (see truths 1, 3, 5, 6). |

### Key Link Verification

| From | To | Via | Status |
|------|----|-----|--------|
| job selection and apply loop | `payload["inputs"]["no_capital_exit_refused"]` | `no_capital_refusals` Counter, merged after compose with the compose's own counts | WIRED |
| job key-inputs read loop | `replay_key_equity` out-of-window count | `read_tiny_base_days` to `tiny_base_days_by_key` to `compose_allocator_equity` to the per-key replay call | WIRED |
| job refusal paths | refusal record | `_persist_refusal` / `_compose_refused` pass `no_capital_exit_refused` | WIRED |

### Data-Flow Trace (Level 4)

| Artifact | Variable | Source | Real data | Status |
|----------|----------|--------|-----------|--------|
| ledger gate | `writer_basis_raw[_k]` | the key's own stored `key_inputs` row (flows plus composed day P&L) | yes | FLOWING |
| out-of-window count | `tiny_base_days_by_key` | stored `key_inputs.tiny_base_days` (the writer line at job_worker.py about :10210 is untouched) | yes | FLOWING |

### Behavioral Spot-Checks and Test Runs

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Phase suites | `pytest -q -p no:cacheprovider tests/test_derive_allocator_equity_job.py tests/test_allocator_equity_no_capital_exit.py tests/test_allocator_equity_inception.py tests/test_derive_refusal_rows.py` from `analytics-service/` | `257 passed, 3 warnings` | PASS |
| CI strict mypy | `mypy --strict --follow-imports=silent --config-file=pyproject.toml services/ routers/ models/ main.py main_worker.py main_worker_healthz.py sentry_init.py` | `Success: no issues found in 143 source files` | PASS |
| Four independent neuters (PROOF-01 reproduction) | see truth 7 | all RED on the named tests, restored byte-identical | PASS |

### Probe Execution

Step 7c: SKIPPED (the phase declares no probe scripts).

### Requirements Coverage

| Requirement | Source Plan | Status | Evidence |
|-------------|-------------|--------|----------|
| NOCAP-01 | 234-02 (plus review fixes 87463035f, 681a307d8, 11e3727f0) | SATISFIED | truths 1, 2 |
| NOCAP-02 | 234-03 (plus 041e42e0d) | SATISFIED | truth 3 |
| NOCAP-03 | 234-01 (plus 6dc860523) | SATISFIED | truth 4 |
| NOCAP-04 | 234-01 | SATISFIED | truth 5 |

All four IDs appear in plan frontmatter and in `.planning/REQUIREMENTS.md`; there are no orphaned IDs. The REQUIREMENTS checkboxes and traceability rows still read Pending. Closing them belongs to the ship step, not to the code.

### Anti-Patterns Found

None blocking. In the six phase files, `TBD`, `FIXME` and `XXX` are absent from the diff. The two `except Exception` handlers are deliberate, annotated, and covered by tests.

### Known Limits and Info Items (not gaps)

- The ledger proof has a stated limit in CONTEXT: a missing deposit whose other deals net to about zero still passes. A native-BTC MT5 key with a small non-zero native terminal adds a bounded extra term (RESEARCH A7). Both live exits are USD keys.
- Round-2 Info items stay recorded in `234-REVIEW.md` only (IN-A, IN-B, IN-C, IN-03, IN-04, IN-05), per repo rule.
- IN-02 (a working `nonpositive` key with inputs and no return rows takes `dropped_key` uncounted) is excluded from the NOCAP-03 set by decision, since it never reaches candidate selection.
- Ship-time obligations (not code gaps): delete the four closed TODOS entries and name them in the CHANGELOG, tick REQUIREMENTS and ROADMAP, and honour the 155.2 freeze. At verification time `155.2-12-SUMMARY.md` is still absent from origin/main, so 234 must merge before 155.2 plan 12's recapture or after plan 14.

### Human Verification Required

None. The PROD founder gate (both live MT5 exits pass the proof, level about -1.6e-11, re-measured against the two-sided predicate) is recorded in CONTEXT, and I did not repeat that read.

### Gaps Summary

No gaps. Every roadmap success criterion and every requirement is backed by code at HEAD and by a test that goes RED when the gate is neutered.

---

_Verified: 2026-11-25_
_Verifier: Claude (gsd-verifier)_
