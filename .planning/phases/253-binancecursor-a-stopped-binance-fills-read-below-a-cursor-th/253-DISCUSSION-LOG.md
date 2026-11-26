# Phase 253: BINANCECURSOR - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-11-26
**Phase:** 253-binancecursor
**Areas discussed:** Cursor fix design, Stop predicate, Signal durability, Records and switch
**Mode:** stage agent with no founder access; every selection below was auto-taken on the recommended option.

---

## Cursor fix design

| Option | Description | Selected |
|--------|-------------|----------|
| Lower-able per-key column | `advance_sync_cursor` (or a sibling RPC) may lower `api_keys.last_fetched_trade_timestamp` to a bounded stop stamp | |
| Seed rule distrusting the column | Already exists (Phase 232 `min(column, fill high-water)`), does not close the gap because the high-water is strategy-wide | |
| Per-strategy re-read bound | Stop bound kept per strategy, seed takes the min with it; research decides against the three-step interleave arm | ✓ (recommended default, research confirms) |

**User's choice:** [auto] research decides, with the interleave arm locked as discriminator; default lean per-strategy.
**Notes:** a sibling strategy's clean run advances a lowered per-key column again.

## Stop predicate

| Option | Description | Selected |
|--------|-------------|----------|
| R3 WR-01 predicate, plus raised reads | earliest complete-through vs next walk start; `phase2_fill_ingestion_failed` joins | ✓ |
| R3 WR-01 predicate only | stop and partial only | |

**User's choice:** [auto] recommended.

## Signal durability

| Option | Description | Selected |
|--------|-------------|----------|
| (a) Carry all sync-time `binance_*` keys through derive and CSV rebuild, cleared by the next sync not raising them | | ✓ |
| (a') Carry only `binance_stop_below_cursor` | | |
| (b) Accept the WARNING log as the only lasting signal | contradicts SC-3 | |

**User's choice:** [auto] recommended.

## Records and switch

| Option | Description | Selected |
|--------|-------------|----------|
| Switch stays off; comment + TODOS + CHANGELOG in ship PR | per SC-4 and founder ruling 2026-11-26 | ✓ |

**User's choice:** [auto] fixed by the roadmap.

## Claude's Discretion
- Names of the new column/table/RPC and test files; helper sharing.

## Deferred Ideas
- Carrying `sync_truncated_*` through the derive.
- A per-strategy fills cursor for every venue.
