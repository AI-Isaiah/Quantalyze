---
phase: 203-b3trunc-why-book-b3-carries-window-truncated
reviewed: 2026-11-07T12:30:00Z
depth: standard
files_reviewed: 8
files_reviewed_list:
  - analytics-service/tests/test_e2_equity_curve_layer.py
  - .planning/phases/203-b3trunc-why-book-b3-carries-window-truncated/203-REPORT.md
  - .planning/phases/203-b3trunc-why-book-b3-carries-window-truncated/203-01-SUMMARY.md
  - .planning/phases/203-b3trunc-why-book-b3-carries-window-truncated/203-01-PLAN.md
  - .planning/phases/203-b3trunc-why-book-b3-carries-window-truncated/203-CONTEXT.md
  - .planning/phases/203-b3trunc-why-book-b3-carries-window-truncated/203-PATTERNS.md
  - .planning/phases/203-b3trunc-why-book-b3-carries-window-truncated/203-RESEARCH.md
  - .planning/phases/203-b3trunc-why-book-b3-carries-window-truncated/203-VALIDATION.md
findings:
  critical: 0
  warning: 0
  info: 0
  total: 0
status: clean
---

# Phase 203: Code Review Report

**Reviewed:** 2026-11-07T12:30:00Z
**Depth:** standard
**Files Reviewed:** 8
**Status:** clean

Scope: `git diff 498217b1e..HEAD`. Severity threshold: MEDIUM and above only. LOW/INFO items were not recorded, by instruction.

## Summary

The only code change is `test_staggered_starts_common_end_carry_window_truncated_only` in `analytics-service/tests/test_e2_equity_curve_layer.py`. Everything else is phase records. No MEDIUM or higher finding.

### The test

- **It pins the claim.** Three keys open on days 0, 1 and 2 and all end on the last day. The test asserts all of these:
  - `window_truncated` is True.
  - `n_tail_days_carried == 0` and `rotated_out_keys == []`.
  - `degrade_reasons` equals exactly `{WINDOW_TRUNCATED}`.
  - `is_trustworthy` is True.
  - The same reasons and trust hold with explicit seams.
  - A control with identical windows raises nothing.

  The exact-set assertion means it cannot pass vacuously: a missing token fails it, and so does any extra token.
- **It can go red.**
  - Never-raise: the `window_truncated` expression in `allocator_equity_curve` (`services/allocator_equity_derive.py`) is the only producer of the token. Grep finds no other assignment in `services/`, `job_worker.py` included. Replacing it with `False` therefore breaks the first token assertion.
  - Benign-to-blocking: I re-ran this one myself in-process, by adding `WINDOW_TRUNCATED` to the module's `_BLOCKING_REASONS`, with no source edit. It went RED on the trust assertion.
  - The file passes at HEAD: `23 passed`.
- **The expected levels are right.** I derived them by hand against `allocator_equity_curve`:
  - A key contributes 0 before its first day.
  - Each key's backward roll ends at its own anchor: A = 100000/110000/121000/133100, B = 110000/121000/133100 from day 1, C = 110000/121000 from day 2.
  - The union sums are therefore 100000, 220000, 352000 and 387200.
- **The seams arm is sound.** `segment_coverage` puts no seam between {A}, {A,B} and {A,B,C}, because the covering sets overlap. So `seams=[]` goes down the explicit-seams cross-check path and leaves `unclassified` empty. That matches what the test asserts.
- **It fits the file's style.** It reuses `_DAYS`, `_flat_returns` and `_ZERO_FLOW_ANCHOR`, takes the same function-local import as the C3 test next to it, and has a WHY docstring.

### The report

Its claims about the code are accurate at HEAD:

- **The quoted code matches HEAD byte for byte.** That covers the `window_truncated` expression, the `reasons.add(DegradeReason.WINDOW_TRUNCATED)` line, the BENIGN header of `DegradeReason`, the whole `_BLOCKING_REASONS` literal, and the `_is_trustworthy` behaviour.
- **The compose path is described correctly.** `compose_allocator_equity` calls `allocator_equity_curve(per_key_equity, seams=list(seg.seams) + exit_seams)`. It then does `reasons |= alloc.degrade_reasons` and `flag_tokens |= _bool_flag_tokens(alloc.flags)`. The payload carries `sorted(r.value for r in reasons)` and `_is_trustworthy(frozenset(reasons))`. `_bool_flag_tokens` keeps only values that are `True`, so the count and list flags are never stored. `inputs.n_keys` is `len({parent[k] for k in anchored_keys})`. It counts distinct keys, since `parent` maps hole-segment units back to their key.
- **A1's inference holds.** Nothing in compose or `job_worker.py` removes a reason after the curve call. A departed key gets an exit seam, so it would show up as `classified_rotation`. A key that only the coverage rotates out would show up as `unclassified_rotation`. A key carried past its last day would raise `stale_mark_carry`. The stored row carries none of the three, so the inference is sound as stated, and the report correctly labels it as inferred.
- **The b3 window table matches 202's evidence.** It agrees with 202-07's `gc-c-b3-key: capture=c1` lines, and the seven first days are all distinct.
- **No reader treats the token as blocking.** No TS or SQL reader branches on `window_truncated` or on the `degraded` flag token, so "the token is never the reason a book is untrusted" holds end to end.

### Leak scan

I scanned all phase records in the diff, plus the ROADMAP and STATE hunks. There are:

- no UUID-shaped strings, no account numbers and no DB URLs;
- no credential-shaped strings (`eyJ`, `sk_`, long hex) and no user home paths.

The only hex is git commit SHAs. The `@~/.claude/gsd-core/...` lines in `203-01-PLAN.md` are the standard GSD execution-context includes and name no user. Keys and books appear only as labels (C, k4 … k35, b2 … b7).

---

_Reviewed: 2026-11-07T12:30:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
