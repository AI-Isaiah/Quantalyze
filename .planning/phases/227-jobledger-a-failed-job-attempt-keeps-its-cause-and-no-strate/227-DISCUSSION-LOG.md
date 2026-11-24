# Phase 227: JOBLEDGER - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-11-23
**Phase:** 227-jobledger
**Areas discussed:** HEAL-03 ceiling signal, HEAL-01 dropped first enqueue, MT5D-01 attempt record storage
**Mode:** smart discuss; questions relayed to the founder by the coordinator via AskUserQuestion

---

## HEAL-03 ceiling signal

| Option | Description | Selected |
|--------|-------------|----------|
| Audit row only | Durable, outlives retention, read by query | |
| External alert only | `ops_alert.page`: log, Sentry, best-effort email | |
| Both: row + page (Recommended) | Durable row, then page | ✓ |

## HEAL-01 dropped first sync_trades enqueue

| Option | Description | Selected |
|--------|-------------|----------|
| Auto re-enqueue (Recommended) | Own sweep: key present, never synced, grace > 1h; named state only if retry fails | ✓ |
| Named state only | User-visible state, user acts | |
| Both | Re-enqueue and show state while waiting | |

## MT5D-01 attempt record storage

| Option | Description | Selected |
|--------|-------------|----------|
| New append-only table (Recommended) | One row per failed attempt, survives job pruning | ✓ |
| JSONB attempts array on compute_jobs | Simpler, lost when job rows are pruned | |

## Claude's Discretion

HEAL-02 lease/heartbeat design, HEAL-04 mechanics, HEAL-05 cohort shape, naming, test layout.

## Deferred Ideas

None.
