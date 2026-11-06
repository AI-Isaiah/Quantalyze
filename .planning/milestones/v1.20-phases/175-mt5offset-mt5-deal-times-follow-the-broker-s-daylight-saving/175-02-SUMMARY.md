---
phase: 175-mt5offset
plan: 02
status: complete
---

# 175-02 SUMMARY: broker server clock (operator)

Tasks 1 and 2 done 2026-10-27. Task 3 (R2) done 2026-11-02: the broker follows US daylight saving (`us`).

## Task 1: R1

- R1: date=2026-10-27 diff=+3h (founder, MT5 Market Watch on a ticking major FX pair).
- before: quantalyze-analytics-backfill offset=3h role=backfill
- before: quantalyze-analytics offset=3h role=interactive
- after: both services offset=3h (10800), unchanged, read back 12:39Z.
- No service was unset, so no history was written under a silent 0.
- Founder choice for the R1 = +3 branch (AskUserQuestion 2026-10-27): "Set 7200 after the flip (Recommended)". The orchestrator sets `MT5_SERVER_UTC_OFFSET_S=7200` on both services after 2026-11-01 06:00Z and before the next nightly derive; R2 confirms it or reverts it to 10800.
- Side effect told to the founder in the question: until plan 06 ships the rule, one fixed value applies to the whole re-read ledger, so 7200 moves summer-2026 deals near a UTC midnight by an hour in the nightly re-derived series; stored allocator snapshots keep their values.

## Task 2: runbooks (additive only)

- `docs/runbooks/navmtm-chain-move-go-live.md`: pre-flight P6 added after P5; a new line after Step B's re-run line says P6 is re-run when the move is on another day than the reading.
- `docs/runbooks/mt5-go-live.md` Step 2 item 3: the two variables, never both or neither, and the cross-reference to P6. The fault wording follows D-04 (transient: retries, then the automatic-retries stamp), not the plan's earlier "without a user-facing stamp".
- Verify: 0 deleted lines in both runbooks; 7 pre-flight bullets (baseline 6); `prod-prober-wiring.test.ts` 118 passed.

## Interim change after the flip (founder choice a)

- 2026-11-01 07:11Z: `MT5_SERVER_UTC_OFFSET_S` set from 10800 to 7200 on both services (quantalyze-analytics and quantalyze-analytics-backfill), after the US flip at 06:00Z and before the 2026-11-02 00:10Z chain. Read back 7200 on both; both redeployed SUCCESS at 07:11Z (backfill passes its /health healthcheck; the interactive /health answers 200). No probe start command was in effect.
- Offsets the stored MT5 history was written under, for plan 06: 10800 from 2026-07-25 to 2026-11-01 07:11Z; 7200 from 2026-11-01 07:11Z (interim, until R2 confirms or reverts it).

## Task 3: R2

- First reading 2026-11-02: +1h. The plan's table does not allow that value, so nothing was decided or set. The orchestrator asked for a re-read against UTC itself; +1 matches a comparison against Central European Time (UTC+1 since 2026-10-25) and not against UTC.
- R2: date=2026-11-02 diff=+2h (founder, re-read against UTC at 12:48Z, MT5 Market Watch on a ticking major FX pair).
- Decision (table): R1 +3 and R2 +2 give `us`. The interim 7200 is confirmed and nothing was changed.
- after-R2: quantalyze-analytics offset=2h at=2026-11-02T12:49Z
- after-R2: quantalyze-analytics-backfill offset=2h at=2026-11-02T12:49Z
- `SC-1: config=us R1=2026-10-27 +3h R2=2026-11-02 +2h`
- No A4 caveat applies; it applies only to `eu`.
- Offsets the stored MT5 history was written under, for plan 06: 10800 from 2026-07-25 to 2026-11-01 07:11Z; 7200 from 2026-11-01 07:11Z (confirmed by R2). No service was ever unset, so no history was written under 0.
- Plan verify: OK.
