---
phase: 203-b3trunc-why-book-b3-carries-window-truncated
plan: 01
subsystem: analytics-service
tags: [allocator-equity, window_truncated, characterization-test, records]
requires:
  - phase: 202-residchurn
    provides: "gc-c-b3-* result lines and the D-14 closure (b6's departed key excluded by default)"
provides:
  - "test_staggered_starts_common_end_carry_window_truncated_only, a test that pins b3's token shape and was shown able to fail"
  - "203-REPORT.md, the verdict record for RESID-02's window_truncated half"
affects: [RESID-02]
tech-stack:
  added: []
  patterns: ["neuter a byte copy of the production file, see RED, restore with cp and confirm with cmp"]
key-files:
  created:
    - .planning/phases/203-b3trunc-why-book-b3-carries-window-truncated/203-REPORT.md
  modified:
    - analytics-service/tests/test_e2_equity_curve_layer.py
key-decisions:
  - "D-01 intended branch: b3's window_truncated is expected behaviour; no code change"
  - "D-02 not triggered: no re-derive, none needed"
requirements-completed: [RESID-02]
duration: ~25 min
completed: 2026-11-07
status: complete
actuals:
  tokens: 3500
  tasks: 2
  commits: 2
plan_head_before: 2d1c62620b49f1b00ee32043684a49c2d57adaa6
plan_head_after: 5432f4d8a2e1979d4bbb65812ac333a329e3ff28
---

# Phase 203 Plan 01: Why book b3 carries window_truncated Summary

**Intended behaviour: b3's seven member keys open on seven different days, so the benign `window_truncated` token is true by construction. One test pins that shape and fails under two neuters; a short report records the evidence and closes 202's `unexplained` reading.**

## Performance

- Duration: about 25 minutes
- Tasks: 2 of 2
- Files: 1 modified (test), 1 created (report), plus this SUMMARY

## Accomplishments

- Added `test_staggered_starts_common_end_carry_window_truncated_only`: three keys opening on days 0, 1 and 2, all ending on the last day, give `degrade_reasons == {WINDOW_TRUNCATED}`, `n_tail_days_carried == 0`, trustworthy True, union levels 100000, 220000, 352000, 387200, the same with seams passed explicitly, and an identical-windows control that raises nothing.
- Wrote `203-REPORT.md` (verdict, the rule by symbol, the seven b3 windows, the local replay, the closure of 202's reading, no PROD write, an unbooked observation, limits). A1 and A2 carry the orchestrator's read-only PROD reading, labelled as derived (A1) and measured (A2).
- `allocator_equity_derive.py` is byte-identical to its backup after both neuters; `git diff -- analytics-service/services` is empty.

## Task Commits

1. Task 1 (tracer), the test: `b46ba741a` test(203-01)
2. Task 2, the report: `5432f4d8a` docs(203-01)

## Result lines

```
gc-203-baseline: filter=staggered_starts head_exit=5 file_tests=22
gc-203-neuter: mutation=never_raise result=red restored=identical
gc-203-neuter: mutation=benign_to_blocking result=red restored=identical
gc-203-green: test=test_staggered_starts_common_end_carry_window_truncated_only passed=1 file_tests=23 layer_and_writer_basis=110
gc-203-gates: mypy=clean ruff_findings=1_preexisting services_diff=empty
gc-203-verdict: cause=intended_behaviour defect=no rederive=not_needed prod_reads=1_orchestrator_readonly prod_writes=0 a1=inferred a2=measured
```

The RED output of each neuter, pasted from the run (neuters applied to the repo file with the byte copy kept in the session scratchpad, restored with `cp` and compared with `cmp`):

```
never_raise (the comparison pair replaced by False):
>       assert out.flags["window_truncated"] is True
E       assert False is True
FAILED tests/test_e2_equity_curve_layer.py::test_staggered_starts_common_end_carry_window_truncated_only
1 failed, 22 deselected in 4.72s
RESTORED_IDENTICAL_A, then: 1 passed, 22 deselected in 4.69s

benign_to_blocking (the token unioned into the blocking set inside _is_trustworthy):
>       assert out.is_trustworthy is True
E       AssertionError: assert False is True
RESTORED_IDENTICAL_B, then: 1 passed, 22 deselected in 4.70s
```

Gate outputs, from `analytics-service/`: `110 passed in 5.09s` for `tests/test_e2_equity_curve_layer.py` plus `tests/test_allocator_equity_writer_basis.py`; mypy strict over the CI surface printed `Success: no issues found in 132 source files`; `ruff check tests/test_e2_equity_curve_layer.py` printed `Found 1 error.` (the pre-existing F401 on the unused `KeyEquity` import, not this plan's to fix). `grep -ac '^def test_'` on the test file prints 23 (22 at HEAD).

## Deviations from Plan

**1. [Rule 1 - stale expectation] The verdict line records A1 and A2 as the orchestrator settled them.** The plan's verify regexp expects `prod_reads=0 ... a1=inferred a2=inferred`. After the plan was written, the orchestrator took one read-only PROD reading (marker first, PRODUCTION) and handed it to the executor: A2 is measured (`window_truncated` in the stored flag list, `n_keys` 7) and A1 is derived from the stored reason set. Writing `a2=inferred` would present a measured claim as inferred, and `prod_reads=0` would hide the orchestrator's read, so the line says `prod_reads=1_orchestrator_readonly` and `a2=measured`. The executor itself made no PROD read or write. The Task 2 automated check's exact `gc-203-verdict` regexp therefore does not match this line by design; every other check in it passes (headings, symbols, quoted lines, no uuid-shaped string, no home path, no attribution trailer, services untouched).

**2. [Orchestrator input] The report was extended beyond the plan's wording** with the stored flag-list reading, the one-sentence statement that the three-key test is a smaller form of the seven-key replay, and the A1 and A2 settlement, as the orchestrator instructed. No other change.

Otherwise the plan executed as written. The `gc-203-stop` branch did not arise: the test passed on today's code without touching `analytics-service/services/`.

## Flagged assumptions

- **Edge probe, RESID-02: `unclassified`, status `unresolved`, verification `null`.** Carried, not auto-resolved and not dropped. The rule-to-verdict link in the report and the committed test stand in for it.
- **A1:** every counted key's equity window reaches the book's last day. Inferred from the stored reason set (no `stale_mark_carry`, no `classified_rotation`); the counts themselves are not stored. The verdict does not rest on it.
- **A2:** measured by the orchestrator on the live row (`window_truncated` in the stored flag list, `n_keys` 7 under `inputs`).

## Known Stubs

None.

## Threat Flags

None. No endpoint, auth path or schema changed.

## Self-Check: PASSED

- `analytics-service/tests/test_e2_equity_curve_layer.py` contains the new test (FOUND), `203-REPORT.md` (FOUND).
- Commits `b46ba741a` and `5432f4d8a` are ancestors of HEAD (FOUND).
- `git status --porcelain -- analytics-service/services` is empty; STATE.md and ROADMAP.md were not staged or edited by this plan.
