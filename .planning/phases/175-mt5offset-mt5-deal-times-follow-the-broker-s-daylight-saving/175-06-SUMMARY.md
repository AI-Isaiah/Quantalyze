---
phase: 175-mt5offset-mt5-deal-times-follow-the-broker-s-daylight-saving
plan: 06
subsystem: operations
tags: [switch, D-01, D-03, D-05, D-06]
requires: ["175-01", "175-02", "175-03", "175-04", "175-05"]
provides:
  - "both worker services bucket MT5 deals by the measured US daylight-saving rule"
status: complete
---

# Phase 175 Plan 06: switch to the measured rule

Both worker services now read `MT5_SERVER_TIME_RULE=us`, and `MT5_SERVER_UTC_OFFSET_S` is deleted on both. The first MT5
derive after the switch ended `done` with no configuration fault.

## Founder decisions

- **D-05 (2026-11-03), "Count, then switch":** the forced rebuild of the legacy allocator snapshots is void. Phase 176
  dropped `allocator_equity_snapshots` and retired `reconstruct_allocator_history`. The allocator curve is the derived one,
  recomposed from the per-key dailies that the nightly derive re-buckets.
- **D-06 (2026-11-03), "Switch 175 without the count":** the live ledger capture needs `railway ssh` into
  `quantalyze-analytics-backfill`. It fails after authentication on both analytics services. Giving the container user a
  home directory (#1190, v0.133.18.3) did not change that. The founder chose to switch without the before-count.

## Task 1: capture and before/after, not run (D-06)

No capture, no restarts and no dry-run tables. D-03's "before" is not met, by founder decision. The evidence is the
first derive after the switch.

## Task 2: approval

The founder's approval is D-06 above. The configuration is plan 02's SC-1, `config=us`. Nothing is rebuilt (D-05).

## Task 3: switch and first derive (2026-11-03, `/tmp/175-06/ops.log`)

```
switch: quantalyze-analytics-backfill rule=us offset=null at=2026-11-03T13:38:28Z
switch: quantalyze-analytics rule=us offset=null at=2026-11-03T13:38:36Z
first-derive: done=1 failed=0 config_fault=0
rebuild: void (D-05, legacy table dropped by 176)
```

- **Order on each service:** the rule was set with deploys skipped, then the offset was deleted. The delete triggered
  one deployment that carried the rule only, so no instance booted with both settings. A redeploy followed. Both
  services were `SUCCESS` at about 13:39Z, and their logs show no clock-configuration message and no traceback.
- **First derive:** one `derive_broker_dailies` for one active MT5 key, enqueued at 13:40:33Z through
  `public.enqueue_compute_job` (marker query first: PRODUCTION). It ended `done` at 13:41:18Z on attempt 1 with no
  `error_kind`. The remaining MT5 keys re-bucket at the next nightly derive (00:40Z).

## Known limits

- **A2:** a broker that changes clocks at a different weekend moment than the US rule is an hour off for deals stamped
  in between.
- **Transition hour:** a flow in a transition hour keeps its own day without an instant (RESEARCH Pitfall 5, counted by
  the existing warning).
- **Live server-clock check:** it stays with Phase 155 / MT5-06. This phase does not close it.
- **Days moved:** not counted (D-06). The changed days show up as the derived curves recompose.

## Self-Check: PASSED

`/tmp/175-06/ops.log` carries two switch lines, the first-derive line with `config_fault=0` and the void-rebuild line. It
contains no uuid and no home path.
