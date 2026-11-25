# Phase 226: MT5SOAK - Discussion Log

**Date:** 2026-11-23
**Mode:** autonomous smart discuss (phase agent). No question was asked: every grey area is a reversible technical choice inside one test script.

## Decided autonomously

[auto] [Floors] — Q: "Where do BTC floors come from?" → Selected: "classify_account_currency's unit floors, passed to the combiner and the soak's own judgement" (reversible technical — decided autonomously: the TODO prescribes it; one call site)
[auto] [Independence] — Q: "What may the new walks import?" → Selected: "no nav_twr / broker_dailies / mt5_deals arithmetic; raw deal fields only; a test pins it" (reversible technical — decided autonomously: test-only code)
[auto] [Timed days] — Q: "How are timed days judged?" → Selected: "exact compare with the soak's own D-17 cohort walk; NaN must be guard-explained" (reversible technical — decided autonomously: soak-only logic)
[auto] [Checked share] — Q: "Minimum checked share value?" → Selected: "named constant, planner picks with measured rationale" (reversible technical — decided autonomously: one-line constant)
[auto] [Attribution] — Q: "How is day attribution checked?" → Selected: "independent per-day P&L vs fold pnl_by_day, named mismatch kind" (reversible technical — decided autonomously: soak-only logic)
