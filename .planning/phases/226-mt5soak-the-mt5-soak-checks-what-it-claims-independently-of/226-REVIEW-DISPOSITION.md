# Phase 226: Review Disposition

Three review rounds, each gsd-code-reviewer in parallel with pr-review-toolkit:silent-failure-hunter
(MEDIUM and above fixed; LOW recorded here only, per CLAUDE.md "TODOS.md holds open work only" rule (a)).
Round REVIEW.md files: round 1 at `2a27f08b9`, round 2 at `f7755ed10`, round 3 at `421858342`.

Round 3 is the last review round the founder's rule allows. Its three findings were fixed and then
verified by the orchestrator against the reviewers' own repro scripts and honest fuzz (no fourth
review round): every repro reads not green, and 2,008 honest ledgers through the real combiner give
0 mismatches.

## Counts

| Severity | Found | Fixed | Recorded only |
|---|---|---|---|
| HIGH | 4 (CR-01, CR-02, CR-03, CR-04) | 4 | 0 |
| MEDIUM | 10 (WR-01..05, SFH-01..04, of which SFH-01 duplicates CR-02) | 10 | 0 |
| LOW | 11 (IN-01..IN-11) | 0 | 11 |

## Findings

| ID | Sev | Round | Disposition | Fix commit | Evidence |
|---|---|---|---|---|---|
| CR-01 | HIGH | 1 | fixed | `0c6f55e67` | deposit-only days now `flow_only`, outside share and `vacuous`; round-2 mutants killed |
| CR-02 | HIGH | 1 | fixed | `c58fbdfe0` | `ledger_day_not_published`, `published_day_outside_ledger`; truncation probes red; 2,008-ledger fuzz no false RED |
| SFH-01 | MEDIUM | 1 | fixed (duplicate of CR-02) | `c58fbdfe0` | first and last day drop tests |
| SFH-02 | MEDIUM | 1 | fixed | `43420fa12` | wedge denominator floored at dust; non-finite equity/balance is `error`; probe red |
| WR-01 | MEDIUM | 1 | fixed | `3e5317d81` | telescoping and inception cohort cases; mutants killed |
| WR-02 | MEDIUM | 1 | fixed | `50866bc82` | any import inside a `_walk_*` def fails; self-test carries both evasions |
| SFH-03 | MEDIUM | 1 | fixed | `57d38ac62` | three arms pinned; each neuter RED |
| SFH-04 | MEDIUM | 1 | fixed | `370d84528` | both tolerances pinned from both sides |
| CR-03 | HIGH | 2 | fixed | `056ff7f15` | zero-P&L trading days certify nothing; repros exit 1 |
| WR-03 | MEDIUM | 2 | fixed | `ffd9c8e35`, `1b5453bde` | float-noise indeterminate band; $100-deposit and drain probes 0 mismatches |
| CR-04 | HIGH | 3 | fixed, verified by orchestrator | `28ccdb5ae` | `indeterminate` in the share denominator; zero-base and dust-base sweeps exit 1 (share 0.33/0.14/0.08); probe1 share 0.0099 not green |
| WR-04 | MEDIUM | 3 | fixed, verified by orchestrator | `45d212a01` | band width pinned at 1e-12; base 99.995 refused as `guarded_day_not_nan` |
| WR-05 | MEDIUM | 3 | fixed, verified by orchestrator | `969faa901` | certification needs P&L above the return tolerance of the base; netzero repro vacuous, exit 1 |
| IN-01 | LOW | 1 | recorded only | — | four walk mutants not killed (open-after-close check, residual clause, zero-flow filter, instant-on-day check) |
| IN-02 | LOW | 1 | recorded only | — | attribution compares a second `_fold_mt5_deals` call, not the combiner's own fold |
| IN-03 | LOW | 1 | recorded only | — | `_parity_tolerance` and `_reconcile_published_returns` default to USD floors |
| IN-04 | LOW | 1 | recorded only | — | `timed_day_not_walked` unreachable from `reconcile_parity` (pinned by a direct-call test since SFH-03) |
| IN-05 | LOW | 1 | recorded only | — | fixed server offset only; production uses a DST clock (RESEARCH A4, predates the phase) |
| IN-06 | LOW | 1 | recorded only | — | `_walk_deal_ledger` docstring says it calls no other soak helper |
| IN-07 | LOW | 2 | recorded only | — | the 10-item mismatch list can hide coverage kinds (the count still reddens `ok`) |
| IN-08 | LOW | 2 | recorded only | — | only the first out-of-span published day is named |
| IN-09 | LOW | 2 | recorded only | — | independence checker misses `__import__` and `importlib` |
| IN-10 | LOW | 3 | recorded only | — | engineered knife edges outside the band (exactly 5% of peak; P&L exactly 10x base) false-RED a few probes |
| IN-11 | LOW | 3 | recorded only | — | `_walk_cohorts` missing from the independence test's named minimum set |

Other LOW notes from the executors: `tests/test_account_unit.py::test_dust_nav_floor_name_is_an_alias_of_the_usd_row`
still names `scripts/mt5_soak.py` as an importer of the USD dust alias (outside the phase boundary);
`_MIN_CHECKED_SHARE = 0.5` rests on fixture shares, not a live soak record; `_walk_instant_ms` is not memoized.
