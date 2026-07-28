# Phase 92 — Deferred Items

Items surfaced during Phase 92 (and the v1.9.1 review-fix pass) that are
intentionally OUT OF SCOPE for this phase. Recorded here so they are not lost.

## D-1 (MEDIUM, PRE-EXISTING) — guard-truncated history has no "history dropped" caveat

**Status:** deferred (pre-existing for ALL NAV_TWR_GUARD_KEYS guards, not
introduced by Phase 92). Do NOT change guard-truncation behavior as a point fix.

**Where:**
- `analytics-service/services/nav_twr.py:470` — `_last_interior_break_suffix`
  is the single source of the retained-suffix boundary: it returns only the
  maximal contiguous non-NaN run that ENDS at the last valid observation.
- `analytics-service/services/metrics.py:678` — the CAGR site consumes it
  (`_cagr_index = _last_interior_break_suffix(returns).index`), so a
  broken-chain account's cumulative_return / CAGR are computed over the retained
  suffix only.

**Description:** When any guard (e.g. `pnl_dominated_guard`, `flow_dominated_guard`,
or any interior chain break) NaN-breaks a day, `_last_interior_break_suffix`
truncates the series to the trustworthy suffix that chains back from the venue
terminal, and `metrics.py` annualizes/compounds over that suffix. This is
correct for the numbers themselves (never a mixed-basis fabrication). BUT: when
the retained suffix is still long (>90 days, so `insufficient_window` does NOT
fire) the public factsheet shows the truncated `cumulative_return` with NO caveat
telling the reader that earlier history was dropped. The displayed track record
silently omits the pre-break period. This is distinct from — and not covered by —
the HARD-04 `insufficient_window` flag (which only catches the short-suffix case)
or the per-guard DQ flags (which name *that a guard fired*, not *that history was
truncated from the displayed cumulative*).

**Why deferred:** it is a cross-cutting "guard-truncation caveat" feature that
applies uniformly to every guard in `NAV_TWR_GUARD_KEYS`, not a Phase-92
(composite blow-up / annualization-honesty) defect. A proper fix is a new DQ
signal ("history truncated at <break boundary>") surfaced through the existing
factsheet caveat surface — a scoped follow-up, not a point patch to the guard
math. No behavior change is warranted here.
