---
phase: 185-deribitflowtime-a-deribit-day-s-return-is-measured-against-t
plan: 01
status: complete
gate: B
---

# 185-01 SUMMARY: the read-only re-crawl settles mechanism B, not A

Run 2026-11-01, about 14:50Z, by the orchestrator session, never a dispatched executor (D-03). Read-only: Supabase SELECTs and Deribit read endpoints only. Nothing was enqueued and nothing was written to any database. Keys are named A and C here, as in the ROADMAP evidence. Every value below is an ISO date, a count, a boolean, a row type or a 4-decimal ratio.

## Delivery

sc1-path: ii (founder-approved; the TRADEPAGES start-command swap on the backfill worker; start command restored at 14:54Z)

`railway ssh` had been refused twice (D-03), so the founder approved the start-command swap. The orchestrator restored the original start command at 14:54Z and recorded the restore in the debug session file. This SUMMARY did not re-read the service configuration itself.

## What ran, and what the plan asked for that did not run

The script that ran is the debug session's `r11.py` as written in round 3, not the version plan 01 Task 1 described. So some fields this plan names were not measured. They are listed here, not left out silently:

- `r_split_rows` and `r_split_lumps0` (the two P&L placements) were not measured. The script printed one split, `r_split_at_flows`, plus `r_capital_weighted`.
- `option_pnl_share` and `d15_condition` were not measured. Per-day row counts by type and instrument class were printed instead.
- The Task 1 offline self-test lines were not produced. The round-3 synthetic day (stored 3.0 against split 0.30, max capital 13x) is the offline check the debug session recorded.
- `sc1-baseline` (the founder's book reading) was not read. The ROADMAP evidence (book cumulative x3539 since 2023-06, 2025 at x1007, x54 without its 11 days of |r| > 30%) is the last recorded baseline. The replanned post-deploy reading must take its own pre-change baseline before deploy.
- The Task 3 class thresholds (`option_pnl_share >= 0.5`, `max_cap < 1.5`) could not be applied, because `option_pnl_share` was not measured. Days are classed below on the rule the debug session set for A: same-day in-and-out or an inflow before the first P&L, and a split far below the stored return.

## Readings

- Keys found: 2 of 2. Key A: 36 analysis days (2025-07-01 to 2025-08-05). Key C: 31 analysis days (the 2026 days with |r| > 0.3, each with the day before it).
- Reconstruction: `r_daylevel_check` equals `stored_r` on every printed day. `rows_pnl_over_stored_pnl` lies in [0.91, 1.10] on 21 of the 23 readable days with |r| > 0.3. The two outside are key C's marked days 2026-10-27 (-1.7389) and 2026-10-28 (0.0000).
- Days with |stored r| > 0.3: 24 (key A 7, key C 17). Days with |stored r| > 0.5: 9 (key A 5, key C 4).
- Split at flows against stored: on 20 of the 23 readable days the split is within 1% of the stored return. 1 day is lower: key A 2025-08-04. 2 days are higher, so the split makes them worse: key C 2026-03-02 (0.7076 to 1.0654) and 2026-03-17 (0.3322 to 0.4220). Key C 2026-02-02 is unreadable, because its line is truncated in the raw log.
- Same-day in-and-out: 1 of 24 days (key A 2025-08-04). An inflow before the first P&L: 0 of 24.
- Option rows (option `trade` or `delivery`) are present on 19 of the 24 days. 3 days have their row counts truncated in the raw log (key C 2026-02-02, 2026-03-02 and 2026-06-29; the last one is cut inside an option row type). The 2 days with no option rows are key C's marked days 2026-10-27 and 2026-10-28.

### Days with |stored r| > 0.5

| key | day | stored_r | r_split_at_flows | r_capital_weighted | max_cap | in_and_out | flows | cash rows (count by type/instrument) | class |
|---|---|---|---|---|---|---|---|---|---|
| A | 2025-07-13 | 3.3360 | 3.3360 | 3.3360 | 4.3402 | False | 2 out | trade/inverse_perpetual 99, trade/option 6, settlement 1 | B |
| A | 2025-07-16 | 0.6539 | 0.6539 | 0.6539 | 1.6571 | False | 1 out | trade/future 10, trade/inverse_perpetual 2, trade/option 2, settlement 2 | B |
| A | 2025-08-03 | -0.7828 | -0.7828 | -0.7828 | 1.0000 | False | none | trade/option 3 | B |
| A | 2025-08-04 | 5.2934 | 3.9344 | 2.3115 | 12.5984 | True | 1 in, 1 out | trade/option 17 | B, partly A |
| A | 2025-08-05 | 0.6663 | 0.6663 | 0.6663 | 4.1274 | False | none | trade/option 40 | B |
| C | 2026-02-28 | 1.6885 | 1.6885 | 1.6885 | 2.7599 | False | none | trade/option 1840, trade/spot 6 | B |
| C | 2026-03-02 | 0.7076 | 1.0654 | 0.7076 | 1.2476 | False | 1 out | (row counts truncated in the raw log) | B (no A signature; rows unreadable) |
| C | 2026-09-06 | 0.7116 | 0.7131 | 0.7095 | 2.0401 | False | 1 in | trade/inverse_perpetual 184, trade/option 70, settlement 1 | B |
| C | 2026-10-28 | -0.5267 | -0.5267 | -0.5267 | 1.0000 | False | none | negative_balance_fee 1 | unexplained (marked day) |

For context, key A's two days just under 0.5 behave the same way. 2025-07-02 (-0.4774) and 2025-07-11 (-0.4840) each have a split equal to the stored return and option rows.

## Verdict

sc1-verdict: B
p1-placement: not applicable (verdict B; the flow-split plans are superseded)
d15-covered: not measured (`d15_condition` was not in the script that ran)
gate: B

**Mechanism A (intraday capital) is not the cause.** On every big day except one, splitting the day at its flows gives the stored return, and there is no same-day in-and-out. The exception is key A 2025-08-04. Its split gives 3.9344 against 5.2934 stored, and it is capital-weighted at 2.3115. It has a USDC inflow and a SOL outflow on the same day. Even split, it is still far above |r| = 0.5. On key C's 2026-03-02 and 2026-03-17 the split makes the day worse.

**Mechanism B (cash-basis options) is the cause.** The big days are option trade and delivery rows booked at cash value against the cash wallet, with no flow at all on several of them. Key A 2025-08-03 (-78%) is 3 option trades and no flow. Key A 2025-08-04 (+529%) is 17 option trades. Key A 2025-07-13 (+334%) is 99 inverse-perpetual trades and 6 option trades. Key C 2026-02-28 (+169%) is 1840 option trades and no flow.

**Oddity, still to explain.** Key C 2026-10-28 is a NAV-marked day (marks run from 2026-10). Its stored return is -52.67%. The day has one `negative_balance_fee` row, and `rows_pnl_over_stored_pnl` is 0.0000. Its neighbour 2026-10-27 (+46.98%) has `rows_pnl_over_stored_pnl` -1.7389. So on these marked days the stored return does not come from the day's cash rows. The replan must explain where it comes from.

## Gate

The verdict is B, so under D-03 and SC-1 the phase replans. None of flow-split plans 185-02 to 185-05 runs. The founder's replan decision is recorded as D-04 in 185-CONTEXT.md.

The tagged scratch script, its raw output and the key-tag map stay in the orchestrator's scratchpad. None of them is in the repo, and no key tag appears in this SUMMARY.

## Start-command read-back (2026-11-03, for T-185-04)

Read-only, Railway service config of `quantalyze-analytics-backfill` (production), 2026-11-03: `startCommand: "python -m main_worker"`, `staged: null`, healthcheck `/health`. The plan 01 fallback start command is gone, and nothing is staged. The 185-02 SUMMARY read back the same command after the 14:54Z restore.
