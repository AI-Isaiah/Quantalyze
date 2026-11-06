# Phase 186: DERIVEGAPS - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in 186-CONTEXT.md; this log preserves the alternatives considered.

**Date:** 2026-11-03
**Phase:** 186-derivegaps
**Areas discussed:** Bad read, Read caps, Failing key

The four gaps already had founder answers from the 2026-11-01 booking, so only these three areas were asked.

---

## Bad read

| Option | Description | Selected |
|--------|-------------|----------|
| Hold last good, name it (Recommended) | The run writes nothing; the last good days stay; the key is named "read incomplete" | ✓ |
| Publish covered days only | Write the covered days; null and flag the oldest uncovered days | |

## Read caps

| Option | Description | Selected |
|--------|-------------|----------|
| Page to the end, refuse if still short (Recommended) | Caps raised within the crawl budget; refuse only a key that is still truncated | ✓ |
| Keep caps, refuse on hit | No cap change; any key that hits a cap is refused | |

## Failing key

| Option | Description | Selected |
|--------|-------------|----------|
| Leaves the book that day (Recommended) | History counts to the last good day, then its capital leaves as a flow; the curve stays trustworthy and the key is named | ✓ |
| Leave it out entirely | Drop the key from all days | |
| Keep flat carry, non-blocking | Carry at r=0 with an informational flag | |

## Deferred Ideas
- Bybit P&L depth 365 vs 730 days (recorded in the booking, not in scope).
