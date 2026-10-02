# Phase 101 — Deferred / Out-of-Scope Items

## Pre-existing test failure (NOT caused by 101-01, NOT fixed)

- **Test:** `tests/test_audit.py::TestAuditTaxonomySyncWithTypeScript::test_action_literal_matches_ts_union`
- **Symptom:** `AssertionError: Python AuditAction Literal drifted from TS AuditAction union.`
- **Why out of scope:** Phase 101-01 touches only the analytics MTM derive path
  (`services/job_worker.py`, `services/stitch_composite.py`, `tests/test_mtm_single_key.py`).
  It changes no audit taxonomy code (Python `AuditAction` Literal) and no TS union file.
  The drift is deterministic and reproduces independent of this plan's commits
  (verified: none of the 3 plan commits touch any `audit` file).
- **Disposition:** SCOPE BOUNDARY — logged, not fixed. Should be triaged separately
  (regenerate/sync the audit taxonomy). Every other test in the touched surface is green
  (3631 passed, 93 skipped with only this one failure).

## Known-limitation (Fable ASSESS-3, MEDIUM-LOW) — same-anchor MTM race mislabels a transient as a coverage reason. DEFERRED to Phase 102.

- **The race:** The single-key MTM second pass deliberately REUSES the
  `account_state` anchor read once before the cash crawl
  (`job_worker.py` ~:2092 / :2273–2287, pinned by
  `test_options_book_runs_second_mtm_pass_same_anchor`). This same-anchor reuse is
  intentional — cash_settlement and mark_to_market must value the SAME terminal
  NAV to be comparable. But an event landing during the minutes-long cash crawl
  appears in the MTM rows and not the anchor → §5
  `InceptionReconciliationError` (tolerance max($1, 1e-4·NAV),
  `native_nav.py:178-180,770`). It is a subclass of `NavReconstructionError`, so it
  is caught by the MTM structural degrade tuple and stamped
  `mtm_summary_coverage_incomplete` — a permanent-SOUNDING coverage reason for what
  is actually a TRANSIENT race.
- **Why NOT fixed here (both offered options carry real risk):**
  1. *Fresh anchor for the MTM pass* (matches the composite sibling at :3334) is
     OUT: it breaks the pinned cash/MTM same-anchor consistency invariant — the two
     passes would value different terminal NAVs, defeating the whole point of the
     second pass (a comparable mark_to_market vs cash_settlement).
  2. *Reclassify the anchor-reconciliation breach as transient → propagate to
     retry the whole derive* carries REAL RISK: `InceptionReconciliationError` is
     documented in the codebase as **permanent/structural** (`native_nav.py:594`),
     and a PERSISTENT (non-race) breach would then retry-to-`failed_final`, sinking
     the HEALTHY CASH HEADLINE — directly regressing the cash-always-ships invariant
     that Fix 1 (authoritative by-basis) and Fix 2 (bounded second pass) both work
     to protect. Trading a self-healing mislabel for a potential cash outage is a
     bad trade.
- **Why deferral is safe today:** the mislabel is SELF-HEALING — `mtm_gated_reason`
  is replaced wholesale on the next clean derive (MED-3 prestamp), and the
  disabled-with-reason UI that would surface the label is Phase 102 (unshipped), so
  the misleading reason has NO live user surface today.
- **Recommended Phase-102 resolution (when the reason UI is wired):** add a DISTINCT
  transient-race reason (e.g. `mtm_anchor_race`) that STILL DEGRADES (cash ships) —
  cash-safe, and honest about the cause — rather than the risky propagate-to-retry;
  OR a bounded same-anchor re-reconciliation. Either must ship with a regression
  test that a mid-crawl event yields the transient-race reason, not a coverage stamp.
