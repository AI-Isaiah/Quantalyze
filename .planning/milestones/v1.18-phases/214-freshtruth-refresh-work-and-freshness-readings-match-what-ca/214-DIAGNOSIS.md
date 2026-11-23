# Phase 214 SC-1 Diagnosis: the 36-day MT5 series

Read-only record. Ages, dates and counts only: no strategy, key or account identifiers.
Source: PROD reads made by the orchestrator through the Supabase MCP after the marker
query (214-RESEARCH.md, "Addendum 2026-11-14", and 214-CONTEXT.md `<specifics>`), plus the
code and the Phase 214 plan 01 characterization tests.

## 1. Verdict: H1

The account's ledger has had no deal or balance-operation day since the series end
(2026-10-09). `combine_mt5_deal_ledger` emits one row per ledger-activity day, and
`gap_fill_daily_returns` fills 0.0 only between the first and the last such day
(`pd.date_range(min, max)`). So a daily derive of the unchanged ledger rewrites the same
last day, and `last_return_date` cannot advance while the account is idle.

The series is not failing. Three consecutive daily chains finishing `done` / `publish_warned`
are what an idle, ledger-complete account produces: each derive succeeds and changes nothing.

## 2. Evidence

PROD (read-only, 2026-11-14):

- The key's account currency is USD; its stored account balance is far above the $100 dust
  floor and the key is active. This leaves only H1 for the October tail (H2 needs equity under
  the floor).
- There are zero NAV-mark rows for the key. This rules out H3 (a marks-driven extension).
- The strategy's daily rows end on 2026-10-09, after a -22.6% day and two 0.0 days. The key
  syncs daily, 36 days after the series end.
- The flags are `dust_nav_guard`, `twr_chain_broken`, `insufficient_window` and
  `tiny_base_guard` (section 3 reconciles them with the balance).

Code and tests:

- `gap_fill_daily_returns` reindexes to `[first, last]` of the series it is given, so it never
  adds a trailing day. `combine_mt5_deal_ledger` calls it on the output of the core, whose index
  is the union of trading-PnL days and external-flow days.
- `analytics-service/tests/test_mt5_series_end_is_last_ledger_day.py` reproduces the shape:
  `test_withdrawal_after_blow_up_ends_series_on_withdrawal_day` (a large loss day, then two 0.0
  rows, the series ending on the withdrawal day: the PROD signature) and
  `test_idle_after_withdrawal_series_ends_on_withdrawal_day` (an idle ledger re-derived twice
  yields an identical series ending on the same day), against
  `test_series_continues_to_last_deal_day_while_account_keeps_trading`, which shows the series
  follows the ledger when it grows.
- Neuter drill (SC-7): replacing the reindex end in `gap_fill_daily_returns` with today's date
  turned all five tests RED (for example, last index `2026-11-14` where `2025-10-07` was
  expected); a byte restore turned them GREEN.

## 3. Reconciling the flags with the balance (inferred, not proven)

The flags `dust_nav_guard` and `tiny_base_guard` sit beside a stored balance far above the $100
floor, and the research case table ties those flags to the dust case (H2). This is the INFERRED
reconciliation, not a proven one:

`data_quality_flags` are whole-series flags, not tail flags. The orchestrator's read-only PROD
reading shows `tiny_base_days` listing 2026-07-31 through 2026-08-20 and `headline_since` at
2026-08-22. So the guards plausibly fired on the early pre-funding window (July to August), not
on the October tail. Those two fields (`tiny_base_days`, `headline_since`) are the source of the
inference.

The confirming reads: R2 (exactly which days the guards hit) and R7 (the worker log for the
recent derives). The attribution to the early window is not stated as fact.

## 4. Why the cap, not a fix

No money-math defect was found in code: gap fill, flow-neutral flow days, the dust guard and the
tiny-base leave-out behave as their docstrings state, and the characterization tests pin that
behaviour. The attribution of the flags to the early window is inferred, not proven (section 3).

Nothing here is changed by this plan: no file under `analytics-service/services/` is modified.
The cost of the idle case is contained by SC-2's weekly cap (plans 03 and 06), not by altering
the series.

## 5. Routed design property, not fixed here

For a ledger-complete venue, trailing flat days are never emitted, so an idle account reads
`series_behind` after 4 days. Extending such a series to the last completed server day changes
annualisation inputs. It needs a separate founder decision and is out of scope (CONTEXT; RESEARCH
addendum, decision 6). SC-2's weekly cap contains the cost.

## 6. Open residuals

Two, each with its confirming read. Neither affects SC-2's design, which triggers on the generic
no-advance signal (`series_behind` with a completed derive and an unmoved `last_return_date`),
not on a flag.

a. Why the two 0.0 rows landed on two consecutive derives, rather than on one. Two `[ASSUMED]`
   candidates from the research: (i) the MT5 terminal's history becomes visible progressively
   across logins, so each derive sees one more day; (ii) the rolled-back NAV crossed the $100
   floor on 2026-10-09 between two reads because the anchor moved. Discriminator: the worker's
   per-derive upsert row count in the Railway log (R7), for the derives on the three days
   (expected +1, +1, +0), with R1 `created_at`.

b. The flag/balance question from section 3. Confirm with R2 that the dust and tiny-base guards
   hit only the July-August window. If R2 shows them on the October tail instead, H2 re-opens and
   this diagnosis must be revised.

## 7. What SC-4 should find after deploy

This strategy stays a stale row (36 days behind at the time of reading, aging by one day a day),
now capped to a weekly derive attempt instead of a daily one. It is expected to remain stale until
its ledger has a new deal or balance operation, or until the routed design property in section 5
is decided. A different outcome (a row that stops being stale without ledger activity) would
contradict H1.
