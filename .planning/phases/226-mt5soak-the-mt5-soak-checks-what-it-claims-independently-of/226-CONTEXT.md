# Phase 226: MT5SOAK — the MT5 soak checks what it claims, independently of the code it checks - Context

**Gathered:** 2026-11-23
**Status:** Ready for planning
**Mode:** autonomous smart discuss (phase agent; no founder question was needed: every grey area is a reversible technical choice inside one test script)

## Phase Boundary

One file of product code: `analytics-service/scripts/mt5_soak.py`, plus its tests in
`analytics-service/tests/test_mt5_soak.py`. No migration, no change to `services/nav_twr.py`,
`services/broker_dailies.py` or any published number. It is wave 0 and must merge before
Phase 229 MT5DERIVE2's first `nav_twr.py` change, so 229 is judged by a soak built independently of it.

Requirements: SOAK-01, SOAK-02, SOAK-03 (REQUIREMENTS.md). Source TODOS entries, which this phase
closes and must delete in its ship PR: `[164.6.6.2.3-SOAK-BTC-FLOORS]`,
`[164.6.6.2.3-SOAK-TIMED-DAYS-UNCHECKED]`, `[164.6.6.2.3-SOAK-DAY-ATTRIBUTION]`. Their "Done when"
text is part of the spec:
- BTC-FLOORS: resolve the unit with `classify_account_currency` and pass its floors to BOTH the
  `combine_mt5_deal_ledger` call and the soak's own guarded-day judgement; a `currency="BTC"` test.
- TIMED-DAYS: a timed-day NaN must be guard-explained; the timed day is recomputed by an
  independent D-17 cohort walk from the raw deals; a 1e-3 nudge to one timed day goes RED; a
  minimum checked share is enforced (1 untimed day out of 200 must not be green).
- DAY-ATTRIBUTION: the soak accumulates its own per-day trading P&L from the raw deals and
  compares it with the fold's per-day P&L day by day.

## Implementation Decisions

### Decided autonomously
- **D-01:** Unit floors source: `classify_account_currency(account currency)` from `services/account_unit`
  supplies the floors (the TODO prescribes it). Floors are configuration, not the arithmetic under
  test, so taking them from production does not break independence. Every `USD_FLOORS` read in the
  soak's judging code is replaced by the resolved unit's floors.
- **D-02:** Independence rule: the new per-day attribution walk and the timed-day cohort walk import no
  helper from `services.nav_twr`, `services.broker_dailies` or `services.mt5_deals` arithmetic. They
  read raw deal fields (time, profit, commission, swap, fee, type, position open time) and do their
  own UTC bucketing and cohort split. A test asserts the independence by inspecting the walk
  functions' source/imports (fails if a production helper name appears).
- **D-03:** Timed-day check: a timed day's published return must equal the soak's own D-17 telescoping
  cohort-walk value to `_RETURN_CHECK_TOL`; NaN must be explained by the soak's own guard reading;
  infinity and implausible values are mismatches by construction of the exact compare.
- **D-04:** Minimum checked share: `ok` additionally requires `checked / (checked + timed + guarded)` at
  or above a named constant; the planner picks the value with a measured rationale (it is a
  one-line reversible constant). Timed days that pass the exact cohort compare count as checked
  for this share if the planner judges that sound; record the reasoning.
- **D-05:** Day-attribution check: compare the soak's independent per-day P&L against the fold's
  `pnl_by_day` for every day; any day differing beyond the tolerance is a named mismatch kind
  (`day_attribution_mismatch`), and the result carries counts like the existing checks.
- **D-06:** PROOF-01: each new arm (BTC-floor, timed-day, attribution) is proven on a neutered copy of
  `mt5_soak.py`: neuter its own arm, run the named test, see RED on that arm, restore with `cp`
  from a byte backup and `cmp`, see GREEN. Edit, command, RED line, GREEN line recorded verbatim
  in the plan SUMMARY. Never `git checkout`/`restore`/`stash` on uncommitted work.

### Claude's Discretion
Plan split (one plan or one per requirement), helper names, result-dict shape for new counts,
test fixture construction. Gates every executor runs: pytest from `analytics-service/` only,
CI mypy strict on the touched files, ruff.

## Existing Code Insights

### Reusable Assets
- `_reconcile_published_returns` in `scripts/mt5_soak.py` (day classes checked/guarded/timed/flat;
  the timed branch currently rejects only infinity; guarded/inception logic reads `USD_FLOORS`).
- `_forward_nav_levels`, `_forward_terminal_nav` in the soak: the soak's own level roll.
- `services/account_unit.py`: `UnitFloors`, `USD_FLOORS`, `_NATIVE_FLOORS`, `classify_account_currency`.
- `services/nav_twr.py` `_judged_cohorts` (around line 567) documents the D-17 telescoping base
  rule; read it for the SPEC only, never import it into the soak.

### Established Patterns
- Every day class is counted; nothing is dropped silently; a run that certified nothing is `vacuous`
  and not green.
- `tests/test_mt5_soak.py` (31 tests) drives the soak with zero network via fake clients.

### Integration Points
- `reconcile_parity` calls `combine_mt5_deal_ledger` (currently without `floors`) and
  `_reconcile_published_returns`; `job_worker` passes the unit's floors in production.

## Specific Ideas
- SC1 test: a BTC account whose guarded-day verdict differs between USD floors and BTC floors.
- SC2 test: nudge one timed day's published return by 1e-3, expect a named mismatch.
- SC3 test: move one deal by one UTC day in the fold's input only, expect `day_attribution_mismatch`.

## Deferred Ideas
None.
