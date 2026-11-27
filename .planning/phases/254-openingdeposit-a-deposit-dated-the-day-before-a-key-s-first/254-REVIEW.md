---
phase: 254-openingdeposit
reviewed: 2026-11-27T19:26:05Z
reviewed_at_sha: 85a01f68e47065a84a484150a298e39ae3690189
diff_base: 68c004338
depth: standard
files_reviewed: 3
files_reviewed_list:
  - analytics-service/services/allocator_equity_derive.py
  - analytics-service/services/allocator_equity_compose.py
  - analytics-service/tests/test_allocator_equity_inception.py
findings:
  critical: 0
  warning: 0
  info: 5
  total: 5
  necessity: 0
status: issues_found
---

# Phase 254: Code Review Report

**Reviewed:** 2026-11-27T19:26:05Z
**Depth:** standard (with call-site tracing into `compose_allocator_equity` and `run_derive_allocator_equity_job`)
**Files Reviewed:** 3
**Status:** issues_found (Info only, no MEDIUM or above)

## Summary

I reviewed `git diff 68c004338..HEAD -- analytics-service/` against the locked intent in
`254-CONTEXT.md` and ROADMAP `### Phase 254`. I did not re-open the accepted retention-edge
limit or the re-entry-segment edge.

**No MEDIUM, HIGH or CRITICAL finding.** What was traced and measured:

- **The `opening_run` subtraction.** `opening_run` is non-empty only when
  `history_reaches_inception` is True. The exemption runs only when it is False, so the two
  subtractions never both apply.
- **No double subtraction and no negative count.** The eve day `lo - 1` is always `< lo`.
  `fbd.get(eve, 0.0) > 0.0` implies the day is a key of `fbd`, so it was counted exactly once
  in the `fd < lo` sum before the decrement.
- **`tiny_base_days`.** The stated rule applies only to `fd > hi` and the eve is always
  `< lo`, so the two rules are disjoint. Probed: an exempted eve deposit plus a stated
  post-window flow gives `{"opening_deposit_exempted": 1}` and no reason.
- **Writer-basis mode.** `fbd` is reassigned to `w_flows` before the count, and `lo` still
  comes from the stored returns. The D1 arm discriminates this (neuter N8 goes RED).
- **Empty returns.** The whole block sits under `if ret_days:`, so behaviour is unchanged.
- **Aggregated multi-flow days.** `_flows_by_day` sums a day, so the strictly-positive test
  reads the net. Probes:
  - a net-zero eve stays out of window;
  - a net-negative eve stays out of window (B4 pins this);
  - a dust deposit on the eve is exempted but leaves an earlier real deposit counted.
- **Levels.** The change touches no level. The curve, the forward self-check and the
  emptied-stretch logic read no new state.
- **Payload.** The flag is the int `1`. `_bool_flag_tokens` keeps only `v is True`, and no
  other consumer serializes per-key flags. Measured with grep over `services/` for `.flags`.
- **Compose and job wiring.** These are unchanged. `full_history_keys` is still derived from
  `api_keys.exchange` against `FULL_HISTORY_VENUES`, and that set is unchanged (N9 pins it).
- **Commands run:**
  - pytest over every module that names the reason (`test_allocator_equity_inception`,
    `test_derive_allocator_equity_job`, `test_e2_equity_curve_layer`,
    `test_nav_marks_compose_roundtrip`, `test_tiny_base_derive_flags`): **352 passed**.
  - mypy on `allocator_equity_derive.py` and `allocator_equity_compose.py`: clean.
  - ruff on all three files: clean.
  - mypy on the test file reports six bare-`dict` `type-arg` errors. All six are on
    pre-existing helper signatures (present at the base). The test file is also outside CI's
    `mypy --strict` surface (`services/ routers/ models/ ...`). Not a finding.

Necessity rubric (`necessity-review.md`) read: there are no necessity findings. The new branch
guards a state that does occur on PROD (the Bybit key named in the CONTEXT).

## Info

Per the repo rule, LOW and Info survivors are recorded here only and never booked in `TODOS.md`.

### IN-01: The compose-wiring assertion checks the wrong variable, and its comment claims more than it proves

**File:** `analytics-service/tests/test_allocator_equity_inception.py:469-473`
**Issue:** The new assertion is placed after `not_this_key = _compose({"some-other-key"})` but
reads `other["flags"]`. Its comment says the day -1 deposit "is exempted (Phase 254)". The
payload cannot show that, because the count flag never reaches it. So the assertion proves
only that the flag does not leak as a token. It would still pass if the exemption were deleted.
The exemption itself is proven at the replay layer (A1, A2) and in the job (A3), so no gate is
missing.
**Fix:** Move the assertion directly under `other = _compose(None)`, or check both payloads.
Reword the comment to "the count flag never reaches the payload's flag tokens".

### IN-02: No arm for a net-positive mixed eve day

**File:** `analytics-service/tests/test_allocator_equity_inception.py` (B4 parametrize, around line 340)
**Issue:** B4 covers a withdrawal and a net-negative mixed day. No arm covers a deposit plus a
smaller withdrawal on the eve, whose net is positive and which should be exempted. An
implementation that required every flow on the eve to be a deposit would pass the whole suite
yet refuse that day. That would contradict the CONTEXT's "the day's net flow ... is strictly
positive".
**Fix:** Add a third B4-style arm: `[ExternalFlow(eve, 50_000.0), ExternalFlow(eve, -20_000.0)]`
→ `flags == {"opening_deposit_exempted": 1}` and no reason.

### IN-03: The canonical D-15 shape is not pinned with the exemption

**File:** `analytics-service/tests/test_allocator_equity_inception.py` (Phase 254 block)
**Issue:** In the PROD Bybit case, the eve is the funding day. The TWR writer drops that day
and stores its P&L in `dropped_day_pnl`. No arm combines that P&L with the exemption, and no
arm combines the exemption with a stated (`tiny_base_days`) post-window flow. Both were probed
ad hoc and are correct:
- with the P&L: `{'dropped_day_pnl_days': 1, 'opening_deposit_exempted': 1}`, no reason;
- with the stated flow: `{'opening_deposit_exempted': 1}`, no reason.

The logic does not depend on either input, so this is coverage only.
**Fix:** Optionally add the dropped-day-P&L arm, since it is the closest fixture to the PROD row.

### IN-04: The new `date.fromisoformat(lo)` can raise a non-`NavReconstructionError`

**File:** `analytics-service/services/allocator_equity_derive.py:1696`
**Issue:** Before this phase, the non-full-history path never parsed the first return day.
`_assert_iso_day_index` (line 388) checks the index only against `^\d{4}-\d{2}-\d{2}$`, which
admits a calendar-invalid label (for example `2026-13-45`). Such a label would now raise a
`ValueError` here, and the job would fail as `unknown` rather than through the permanent
refusal path. This is theoretical: return days are written by code, and the compose already
calls `date.fromisoformat` on the same days (`allocator_equity_compose.py:421`, `:1047`).
**Fix:** None needed. If wanted, tighten `_assert_iso_day_index` to also round-trip each label
through `date.fromisoformat`.

### IN-05: A no-capital candidate can now compose, so a book curve can change even though no key level does

**File:** `analytics-service/services/allocator_equity_derive.py:1558-1572` (docstring "No level changes (IN-02)");
consequence in `analytics-service/services/allocator_equity_compose.py:866-873`
**Issue:** `compose_allocator_equity` takes a no-capital candidate back out (`DROPPED_KEY`)
when its replay carries a blocking reason. Suppose a non-full-history candidate's only blocking
reason was the eve-deposit `out_of_window_flow`. It now stays in the book, so that book's
composed curve changes, although no per-key level does. This follows from the ruling and is
not a defect. However, the docstring's "No level changes" is a per-key statement, and the
book-level effect is neither written down nor tested.
**Fix:** Optionally add one sentence to the docstring noting the no-capital-candidate effect.

---

_Reviewed: 2026-11-27T19:26:05Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_

## Silent-failure hunt (2026-11-27) — no MEDIUM+ findings; LOW notes recorded here only

- **LOW — hole re-entry ledger double count.** `compose_allocator_equity` books a re-entry inflow of a hole-split later segment's first level (`reentry_units` loop), and a real flow dated on that same first level day is also in `ledger_flows` from `seg_flows`. A positive deposit on the day before such a segment's first return day was blocked by `out_of_window_flow` before 254 and now is not, so MWR/Dietz scalars could count it twice. Not introduced by 254 as a class: a deposit on a re-entry segment's first return day already takes the same path. No `src` reader of the payload's ledger scalars was found. Not fixed (LOW).
- **LOW — no materiality floor.** `fbd.get(opening_eve, 0.0) > 0.0` exempts any net-positive amount, including float dust from a round trip; an earlier stored dropped-day P&L does not stop the exemption. Same family as the accepted retention-edge limit. Not fixed (LOW).
- **LOW — runtime invisibility.** The count flag lives only on `KeyEquity.flags` (CONTEXT [Visibility] decision). Not fixed (LOW).
