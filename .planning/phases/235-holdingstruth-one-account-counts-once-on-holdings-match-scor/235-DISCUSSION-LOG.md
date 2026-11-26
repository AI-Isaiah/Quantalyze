# Phase 235: HOLDINGSTRUTH - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-11-26
**Phase:** 235-holdingstruth
**Mode:** smart discuss (autonomous), run by a background phase agent with no founder channel. No hard-to-reverse question arose (no migration, no public contract, no new dependency).

## HOLD-04 note (product wording)

| Option | Description | Selected |
|--------|-------------|----------|
| Keep rows, one-line disclosure | The booked fix in 170.4-DASHBOARD-MARKER-READ-SILENT | ✓ (Claude's Discretion, founder may override) |
| Hide the affected key's rows | Would blank Holdings on a read outage, which the reader's comment forbids | |

## Decided autonomously

[auto] [HOLD-01] — Q: "Throw inside keyAccountOf or check in each caller?" → Selected: "In keyAccountOf, plus strict accountByKey lookups in the two dollar callers" (reversible technical — decided autonomously: internal helpers)
[auto] [HOLD-01] — Q: "Extra query in the per-key reader for rows outside the identity read?" → Selected: "No; rows are read per identity key" (reversible technical — decided autonomously: a query can be added locally)
[auto] [HOLD-02] — Q: "Group-level marker day or per-key filter only?" → Selected: "Marker as a reading day, account newest = max over keys" (reversible technical — decided autonomously: one function)
[auto] [HOLD-02] — Q: "Where does the shared case live?" → Selected: "JSON fixture replayed by TS and pytest" (reversible technical — decided autonomously: test-only)
[auto] [HOLD-04] — Q: "Sentry level and tags?" → Selected: "warning, area tag" (reversible technical — decided autonomously: one call site)
[auto] [HOLD-05] — Q: "Payload shape for attributed ids?" → Selected: "server-built extra field, owner ids only" (reversible technical — decided autonomously: internal payload)
