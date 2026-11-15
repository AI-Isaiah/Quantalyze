# Phase 215: TESTREACH - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-11-15
**Phase:** 215-testreach
**Areas discussed:** 403-vs-422 split (open, founder)

---

## 403-vs-422 split (SC-7 b) — OPEN, handed to the founder

| Option | Description | Selected |
|--------|-------------|----------|
| A. Pin today | Keep today's per-arm statuses (permanent codes and our fallback 403; every other code, including CSV rule codes, 424 recoverable) and pin each arm; route any change to its own phase | ✓ |
| B. CSV to 422 | Ordinary CSV validation failures answer 422 recoverable:false; scope and auth stay 403; venue-transient stays 424 | |
| C. All ordinary failures to 422 | AUTH_FAILED, PERMISSION_DENIED and CSV codes to 422; 403 only for the write-scope arms | |

**User's choice:** A, "Pin today, book fix" (founder, 2026-11-15, relayed by the coordinator).
**Notes:** Measured at 3f29f1539: AUTH_FAILED 403/false, fallback 403/false, PARSE_ERROR 424/true, CSV_VALIDATION_FAILED 424/true.

---

## Decided autonomously

[auto] [Parity] — Q: "How do the HAS_PY_ENV cases run in CI?" → Selected: "Remove the env skip; run in the python job" (reversible technical — decided autonomously: one-line gate)
[auto] [DB-gated tests] — Q: "How do TEST_SUPABASE_DB_URL-gated cases run on the lane?" → Selected: "Resolve the DSN from LANE_DB_URL; list any that cannot run with a reason" (reversible technical — decided autonomously: harness wiring)
[auto] [App factory] — Q: "What replaces bare FastAPI() in tests?" → Selected: "Shared fixture installing production's handlers from one helper" (reversible technical — decided autonomously: test harness)
[auto] [Worker exception] — Q: "What does the worker raise instead of HTTPException?" → Selected: "Domain exception classified to the same kind and text as today" (reversible technical — decided autonomously: persisted output held constant)
[auto] [Rosters] — Q: "How are the two key-step rosters derived?" → Selected: "Per route from each route's contract, never merged" (reversible technical — decided autonomously: TS-internal)
[auto] [Cassettes] — Q: "Binance cassettes recorded or retired?" → Selected: "Retired with a recorded reason (no live keys)" (reversible technical — decided autonomously: rows re-addable)
[auto] [D-161-01] — Q: "How is the first_rule.upper() family made visible?" → Selected: "Vocabulary reads the validator's rule names, upper-cased" (reversible technical — decided autonomously: derivation only)
[auto] [Teaser alert] — Q: "How does teaser bucket saturation alert?" → Selected: "De-duplicated Sentry capture on anon-bucket refusal, limit unchanged" (reversible technical — decided autonomously: observability only)

## Claude's Discretion

None.

## Deferred Ideas

None beyond the open decision.
