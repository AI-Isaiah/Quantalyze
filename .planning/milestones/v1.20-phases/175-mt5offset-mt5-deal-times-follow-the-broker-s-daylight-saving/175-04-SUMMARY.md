---
phase: 175-mt5offset-mt5-deal-times-follow-the-broker-s-daylight-saving
plan: 04
subsystem: analytics-service
tags: [mt5, dst, dry-run, counts-only, redaction, forced-rebuild]
status: complete

requires:
  - phase: 175-01
    provides: Mt5ServerClock, server_clock_for_rule, fixed_server_clock, the widened deal seam
provides:
  - "scripts/mt5offset_dry_run.py: key_shift, analyze, render_report, main - a read-only, counts-only before/after of a captured MT5 ledger under a legacy fixed offset and a target clock"
  - "a per-key verdict (rebuild / none / not measured) that names which keys' allocator snapshots need a forced rebuild"
affects: [175-06 live capture, dry run and founder-gated switch]

actuals:
  tokens: 5900
  tasks: 2
  commits: 2
plan_head_before: 4a6de94a2f5a7e57af0ced10654d856f6e047745
plan_head_after: a62a13ad78ac862bec93a5b7dcf67dc35960920c

tech-stack:
  added: []
  patterns:
    - "the same captured ledger folded twice, once per clock, and the two NAV-level series compared day by day"
    - "report speaks in capture-order ordinals and counts; the id map exists only at --map-out"

key-files:
  created:
    - analytics-service/scripts/mt5offset_dry_run.py
    - analytics-service/tests/test_mt5offset_dry_run.py
  modified: []

key-decisions:
  - "The verdict is 'rebuild' exactly when at least one NAV-level day differs (relative 1e-9, NaN equal to NaN); return-day changes are reported but do not drive the verdict, because the allocator snapshots store levels"
  - "A captured entry that cannot be folded, or a not_captured entry, is a row with verdict 'not measured' and an exception CLASS only, never a message"
  - "_scrub is imported from flowtiming_dry_run, not copied; the id map is written only where --map-out names a path"

requirements-completed: [D-03]
---

# Phase 175 Plan 04: The MT5 clock dry run Summary

A read-only, counts-only tool that folds a captured MT5 ledger under a legacy fixed offset and under a target clock (`--rule eu|us` or `--fixed-offset-s`) and reports, per key ordinal, how many deals, flow deals and days move, how many flow deals lose their instant, how many NAV-level and return days change, and a verdict that tells the founder which keys need a forced rebuild of their allocator snapshots.

## What was built

- `analytics-service/scripts/mt5offset_dry_run.py`
  - `key_shift(deals, equity, balance, currency, *, legacy_offset_s, target)`: per deal, the UTC day under the legacy integer and under the target (`deal_utc_day`); moved deals, moved external-flow deals (`classify_deal`), the union of the moved deals' days, and flow deals whose instant is `None` under the target but not under the legacy integer. Then `reconstruct_mt5_nav_levels` and `combine_mt5_deal_ledger` once per clock (floors from `classify_account_currency(currency).floors`) and a day-by-day comparison. Any exception gives `not measured` with the class name.
  - `analyze(captured, *, legacy_offset_s, target)`: walks `captured["keys"]` in capture order, `mt5-key-N`, passes `not_captured` through with its error class, keeps the ordinal-to-id map apart.
  - `render_report(analysis, *, target_label, legacy_offset_s)`: markdown header (target, legacy offset in whole hours), one table row per key, a rebuild tally, notes; the whole text through the reused `_scrub`.
  - `main`: `--captured` (required), required mutually exclusive `--rule {eu,us}` / `--fixed-offset-s`, required `--legacy-offset-s`, `--out`, `--map-out`, repeatable `--note` (scrubbed). The operator runs it once per offset the stored history was written under and unions the `rebuild` keys (plan 06); the docstring says so.
- `analytics-service/tests/test_mt5offset_dry_run.py` (13 tests, synthetic data only): winter (verdict asserted before any count), summer, ordinals and header, the US repeated hour, the unclassifiable and uncaptured error rows (class only), the CLI (report, id map, scrubbed note), the fixed-target label, four usage errors (both targets, no target, no legacy offset, unknown rule), the five-kind redaction plant, and the AST import pin.

## Tracer RED

Before the module existed, the test file failed at collection:

```
E   ImportError: cannot import name 'mt5offset_dry_run' from 'scripts' (.../analytics-service/scripts/__init__.py)
1 error in 3.10s
```

Then 3 passed once `key_shift`, `analyze` and `render_report` existed (commit 766361cbd). The tracer's verify re-ran green before Task 2 expanded.

## Neuter proof (D-03)

Byte backup taken with `cp -p` to the session scratchpad; neuter = first statement of `key_shift`'s body rebinding `target = fixed_server_clock(legacy_offset_s)`.

First neuter run (3 failed, 10 passed). The winter test's RED line names the verdict:

```
E       AssertionError: assert 'none' == 'rebuild'
FAILED tests/test_mt5offset_dry_run.py::test_winter_deposit_after_the_us_fall_change_moves_a_day_and_demands_a_rebuild
```

That run showed the CLI test passed vacuously: it asserted the bare word "rebuild", which also appears in the tally line "Keys needing a forced rebuild". Tightened to `"| mt5-key-1 | rebuild |"` (the table row). Second neuter run: 4 failed, 9 passed, the CLI test now among the failures. Restore with `cp -p` from the backup; `cmp` of backup against the script exited 0 (`cmp=0`, both restores); the NEUTER marker count in the script is 0. Green after restore: `75 passed in 10.82s` (`tests/test_mt5offset_dry_run.py` plus `tests/test_flowtiming_dry_run.py`, no skip).

## Verification

- `pytest tests/test_mt5offset_dry_run.py tests/test_flowtiming_dry_run.py`: 75 passed, 0 skipped.
- CI mypy line (verbatim, from `analytics-service/`): `Success: no issues found in 124 source files`. It does not cover `scripts/`, so the script was also run on its own with the same strict flags: `Success: no issues found in 1 source file`. CI runs no ruff on `analytics-service`, and ruff is not installed in the venv, so none was run.
- Acceptance greps: `def key_shift` 1, `from scripts.flowtiming_dry_run import` 1, `add_mutually_exclusive_group` 1.
- No database, socket, TEST, PROD or Railway access; the tool was never executed against real data.

## Deviations from Plan

None - plan executed as written. One test-strength fix found by the neuter proof itself (the vacuous CLI assertion above) is recorded under Neuter proof; it is inside the plan's own task, not a scope change.

## Known Stubs

None.

## Threat Flags

None. T-175-12 (disclosure) mitigated by ordinals, `_scrub` on every rendered string and the five-kind redaction test; T-175-13 (live-system tampering) mitigated by the AST import pin and by writing only to `--out` / `--map-out`.

## Handed on to plan 06

The tool is built and tested on synthetic ledgers only. The live capture and the run on it (once per offset the stored history was written under, then the union of `rebuild` keys) are plan 06's founder-gated steps.

## Self-Check: PASSED

- `analytics-service/scripts/mt5offset_dry_run.py` and `analytics-service/tests/test_mt5offset_dry_run.py` exist; commits 766361cbd and a62a13ad7 are ancestors of HEAD on `wt/175-p04`.
