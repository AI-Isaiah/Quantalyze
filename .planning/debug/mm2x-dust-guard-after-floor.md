---
status: diagnosed
trigger: "after 164.6.6.2 plan 14 (BTC dust floor 1e-7, D-24) shipped and deployed, a fresh MM-2x re-derive on PROD still sets data_quality_flags.dust_nav_guard = true; plan 14 VERIFICATION expected it absent"
created: 2026-10-08T20:10:00Z
updated: 2026-10-08T20:45:00Z
goal: find_root_cause_only
---

## Current Focus

hypothesis: CONFIRMED. dust_nav_guard is fired by the first ledger day (2025-10-16) alone. Its prior NAV is the backward roll's pre-inception capital NAV_0 - pnl_0 - F_0. That value is zero in exact arithmetic, so what the guard sees is a float residue in (0, 1e-7) BTC. No interior day fires.
bug_class: Bohrbug (deterministic; the sign of float noise decides which of negative/dust fires)
next_action: none (diagnose only). The fix direction is in Resolution.

reasoning_checkpoint:
  hypothesis: "Day 0 of a full-history ledger that starts with a deposit has a reconstructed prior NAV of 0 plus float noise. chain_linked_twr (nav_twr.py:485) hands it to _guard_denominator (:489), and when the noise is positive that function returns dust_nav_guard (:579), whatever the floor. Plan 14 lowered the floor from 0.001 to 1e-7, but the residue (about 1e-16) is far below both."
  confirming_evidence:
    - "PROD: the stored series runs from 2025-10-18 to 2026-10-08 with 356 rows over a 356-day span (no gaps). The derive's reconcile-delete removes every in-span day the payload lacks (job_worker.py:6630-6660), so no interior day was NaN. The only refused days are before 2025-10-18."
    - "PROD flags are exactly {dust_nav_guard, flow_dominated_guard} with no negative_nav_guard."
    - "Local repro on the MM-2x-shaped fixture (tests/test_mt5_deal_reconstruction.py _mm2x_ledger, first deposit 2025-10-16), run with BTC floors: NaN days are 2025-10-16 and 2025-10-17 and flags are {dust, flow_dominated}, matching PROD exactly. A spy on _guard_denominator shows dust firing once, on 2025-10-16 with prior NAV 3.05e-16 BTC (and 3e-8 when a 3e-8 ledger residue is injected), and flow_dominated firing on 2025-10-17 (prior 0.1, flow 1.0)."
    - "Plan 14's own test already says this: test_mt5_deal_reconstruction.py:1102 '(dust_nav_guard may be set by day 0 alone, when float noise leaves a positive 1e-17.)'"
  falsification_test: "If any day on or after 2025-10-18 were guarded, it would be absent from csv_daily_returns. It is not: 356 of 356 span days are present. If USD floors had leaked in, every day (NAV < 1000 BTC) would be dust and the series would be empty."
  fix_rationale: "Diagnose only. The defect is that the guard reads a pre-inception, zero-by-construction base as an observed dust balance."
  blind_spots: "The exact PROD residue R on 2025-10-16 is unmeasured. The deal ledger is fetched live from the MT5 bridge and is not stored (trades rows for MM-2x: 0). R is known to be in (0, 1e-7): positive because negative_nav_guard is absent, and under 1e-7 because dust fired. Whether it is float noise (about 1e-16) or a small genuine ledger residue cannot be told from the database. Also unconfirmed from PROD data: the real first deposit amounts. The 0.1/1.0 shape is the fixture's, but the fixture's dates match PROD's first stored day exactly."
  candidate_causes:
    - "code: day-0 pre-inception base passed to the dust guard (nav_twr.py:483-489) - CONFIRMED"
    - "config: BTC floors not passed on some call path (H1) - ELIMINATED"
    - "data: stale flag carried from an older row (H3) - ELIMINATED"
    - "data: genuine sub-1e-7 interior balance (H2-interior) - ELIMINATED"
  and_gate: "no. Day 0 alone is sufficient. flow_dominated_guard (day 1) is independent and separately keeps status complete_with_warnings."

## Symptoms

expected: dust_nav_guard absent after plan 14 (founder D-24: BTC dust floor 1e-7)
actual: resync 2026-10-08 19:57 UTC -> computed_at 19:58:19, complete_with_warnings, flags {csv_source, native_unit, dust_nav_guard, cumulative_method, flow_dominated_guard}; small_base_measured absent
errors: none (warning flag only)
reproduction: resync MM-2x (MT5, BTC-denominated) on PROD
started: still present after merge 886952727 deployed; the 2026-10-08 UAT already recorded it "only on days before 2025-10-18"

## Eliminated

- hypothesis: H1, a step runs the TWR/guard without BTC floors, so the USD 1000 default applies
  evidence: job_worker.py:5610-5616 passes floors=_mt5_unit.floors to combine_mt5_deal_ledger. That reaches broker_dailies.py reconstruct_nav_and_twr(floors=floors), which calls chain_linked_twr(floors=floors) (nav_twr.py:976), which calls _guard_denominator(prev, flow_t, floors.dust_nav) (nav_twr.py:489). The derive's `meta` is set only by the combine (no other TWR call merges into it before the prestamp). compute_analytics_from_csv does not re-run any guard; it only carries the prestamped keys (analytics_runner.py:1955-1958). Data check: with the USD floor every BTC day would be dust and csv_daily_returns would be empty, but it holds 356 rows.
  timestamp: 2026-10-08T20:30:00Z
- hypothesis: H3, the flag is stale or merged from an older row
  evidence: the prestamp builds a fresh dict (job_worker.py:6858 `{"csv_source": True}` plus this derive's meta keys) and its upsert replaces the JSONB wholesale (:7114-7120). The CSV run also rebuilds wholesale (analytics_runner.py:1923) and copies only guard keys present in that fresh prestamp. The current code reproduces the exact flag set on the MM-2x ledger shape.
  timestamp: 2026-10-08T20:30:00Z
- hypothesis: H2-interior, some interior day has a genuine prior NAV in (0, 1e-7) BTC around the withdrawal
  evidence: every calendar day from 2025-10-18 to 2026-10-08 is stored (356 of 356). The reconcile-delete would have removed any NaN day inside the derive's span. No day on or after 2025-10-18 is guarded.
  timestamp: 2026-10-08T20:30:00Z

## Evidence

- timestamp: 2026-10-08T20:15:00Z
  checked: PROD strategy_analytics for MM-2x (marker true)
  found: flags {csv_source, native_unit BTC, dust_nav_guard, cumulative_method geometric, flow_dominated_guard}; computed_at 19:58:19
  implication: dust and flow_dominated fired in this derive's meta; negative did not
- timestamp: 2026-10-08T20:18:00Z
  checked: PROD csv_daily_returns for MM-2x
  found: 356 rows, 2025-10-18 to 2026-10-08, span 356 days, 0 null; newest row updated 19:58:11; 0 trades rows (deal ledger not stored)
  implication: no interior guarded day; the refused days are only those before 2025-10-18
- timestamp: 2026-10-08T20:25:00Z
  checked: job_worker.py writer (:6600-6660)
  found: upsert the payload, then delete every in-span calendar day the payload does not carry
  implication: a stored row's absence is exactly a NaN or absent derive day, so the 356/356 count is authoritative
- timestamp: 2026-10-08T20:35:00Z
  checked: local repro (scratchpad repro.py), combine_mt5_deal_ledger on the _mm2x_ledger fixture with BTC floors, spying on _guard_denominator
  found: for terminal 0.0096 / 5e-4 / 3e-6 and anchor residue 0 or +/-1e-17: dust fired on 2025-10-16 (prior 3.05e-16) and flow_dominated fired on 2025-10-17 (prior 0.1, flow 1.0); NaN days 2025-10-16 and 2025-10-17. With a +3e-8 residue, dust fired on 2025-10-16 with prior 3e-8.
  implication: the PROD flag set is reproduced exactly; dust comes from day 0's pre-inception residue, not from the floor's level
- timestamp: 2026-10-08T20:40:00Z
  checked: PROD strategy_analytics census (marker true)
  found: 24 csv_source rows; 8 carry dust_nav_guard, 9 carry negative_nav_guard, 12 carry either
  implication: consistent with a cross-venue day-0 noise class whose sign picks negative vs dust. Not proven per row.

## Resolution

root_cause: services/nav_twr.py:483-489 (chain_linked_twr). For a full-history ledger (prev0=None), day 0's prior NAV is the reconstructed pre-inception capital `cur - pnl0 - flow_t`. It is exactly 0 for an account whose history starts with its first deposit, so float evaluation leaves a residue of about 1e-16. That residue goes to _guard_denominator (:550-584), which labels it negative_nav_guard (residue <= 0) or dust_nav_guard (:579, 0 < residue < floor) by sign alone. For MM-2x the residue is positive, so day 2025-10-16 (the first deposit) is flagged dust. Plan 14 changed the floor (0.001 -> 1e-7), but a zero base is below any positive floor, so the floor change could never clear it. The verification expectation was wrong: it reasoned only about interior balances, though plan 14's own test (test_mt5_deal_reconstruction.py:1102) records the day-0 case.
fix: (not applied; diagnose only) Recommended: treat day 0 of a full-history reconstruction as the inception day. When prev0 is None and |NAV_0 - pnl_0 - F_0| <= floors.residual_abs_tol (zero within the unit's reconciliation tolerance), emit NaN for day 0 and raise no guard flag (or, if the founder wants it visible, a non-warning annotation outside NAV_TWR_GUARD_KEYS). Scope it to full-history combiners (MT5 / ledger_complete) through an explicit keyword, so retention-windowed venues, whose day-0 base is real capital, keep today's behaviour. Separately: flow_dominated_guard on 2025-10-17 (a 1.0 deposit on a 0.1 base) also forces complete_with_warnings, so plan 14's "computation_status stays complete" is unreachable for this ledger until the founder decides whether an early top-up deposit is a warning.
verification: n/a (diagnose only)
files_changed: []
