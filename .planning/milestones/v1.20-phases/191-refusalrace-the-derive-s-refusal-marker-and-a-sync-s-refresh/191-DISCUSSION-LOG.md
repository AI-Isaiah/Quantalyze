# Phase 191: REFUSALRACE - Discussion Log

> Audit trail only. Decisions live in 191-CONTEXT.md.

**Date:** 2026-11-04
**Areas discussed:** Retraction

## Retraction

| Option | Description | Selected |
|--------|-------------|----------|
| Small dedicated RPC (Recommended) | One service-role-only UPDATE does the retraction; Python and TS call it; `enqueue_compute_job` untouched | ✓ |
| Merge arm in enqueue_compute_job (as booked) | Retract inside the enqueue dedup; changes the busiest RPC's signature | |

**User's choice:** Small dedicated RPC (Recommended)
**Notes:** Deviates from the booked SC-2 wording; amended in the ROADMAP with the original kept as lineage.

## Claude's Discretion
- Function names, return shape, marker function form; shared contract test.

## Deferred Ideas
- Retraction inside `enqueue_compute_job`'s dedup (only if D-02's enqueue-to-retraction gap is ever observed).
