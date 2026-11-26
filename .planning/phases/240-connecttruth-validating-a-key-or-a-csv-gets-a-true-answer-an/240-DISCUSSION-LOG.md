# Phase 240: CONNECTTRUTH - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-11-24
**Phase:** 240-CONNECTTRUTH
**Areas discussed:** RLIM-01 anonymous bucket, RLIM-02 CSV limits, CONN-06 month-name cells, CONN-05 validate-key code

Questions were relayed to the founder by the coordinating session (the phase agent cannot ask directly).

---

## RLIM-01 anonymous bucket

| Option | Description | Selected |
|--------|-------------|----------|
| Per-IP anonymous tier | IP hash minted at Vercel into the claim; 30/hour per IP plus an aggregate anonymous ceiling below 500/hour | ✓ |
| Raise the shared tier | One constant; a handful of IPs can still exhaust it | |
| Retire the orphaned teaser | Delete route and landing components; widens scope | |

**User's choice:** Per-IP anonymous tier, plus re-key the simulator's IP limit onto `tenant_or_platform_key`.

---

## RLIM-02 CSV limits

| Option | Description | Selected |
|--------|-------------|----------|
| CSV-scoped upstream tier | Signed scope signal; own per-tenant bucket ≥ 20/min; exempt from or own slice of the ceiling | ✓ |
| Lower the edge to fit | Simple; hurts iteration; still shares the tenant bucket | |
| Raise the tenant tier | Loosens other flows; collides with the 500/hour ceiling | |

**User's choice:** CSV-scoped tier; split csv-validate and csv-finalize edge limiters; fix the stale docblock citation.

---

## CONN-06 month-name cells

| Option | Description | Selected |
|--------|-------------|----------|
| Parse | Unambiguous reading; existing info flag | ✓ |
| Reject with a clear message | One error naming cell, row and expected format | |

**User's choice:** Parse, close `[170.1-CSV-ODD-SPELLING-REJECTED]` with a test.

---

## CONN-05 validate-key code

| Option | Description | Selected |
|--------|-------------|----------|
| Flat `{detail, code, recoverable}` on every 400 | Reuse AUTH_FAILED / MT5_WRONG_SERVER / MT5_MASTER_PASSWORD, add VENUE_DISABLED / INVALID_REQUEST, detail byte-identical | ✓ |

**User's choice:** As recommended; light touch on permanence plumbing and STATUS_CONTRACT coordinates.

## Decided autonomously

[auto] [Research] — Q: "How many analytics replicas share the memory:// limiter?" → Selected: "1 replica, 1 uvicorn worker" (reversible technical — decided autonomously: a measurement)
[auto] [Proof] — Q: "How is PROOF-01 shown?" → Selected: "neuter a byte copy, RED, cp back, cmp, GREEN, verbatim in SUMMARY" (reversible technical — decided autonomously: test-process only)

## Claude's Discretion

Exact anonymous aggregate ceiling and CSV tier numbers within the rulings; IP hash construction; code placement and test layout.

## Deferred Ideas

Retiring the orphaned teaser UI stays with `[192-ORPHANED-LANDING-VERIFY]`.
