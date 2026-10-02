---
phase: 145-job-csv-finalize-atomicity
plan: 06
subsystem: infra
tags: [supabase-mcp, test-apply, red-green, live-verification, terminalize, human-gate]
status: complete — awaiting the Task-3 human approval to ship

# Dependency graph
requires:
  - phase: 145-03
    provides: "migration 20260819120000 (the fold) + the four re-pointed SQL gates"
  - phase: 145-04
    provides: "the (i-b) route wiring the live exercise drives"
  - phase: 145-02
    provides: "the arm-4 baseline the SC#3 diff compares against + the census the terminalize list came from"
provides:
  - "The fold LIVE on TEST, ledger version 20260819120000 (drift reconciled explicitly)"
  - "RED→GREEN observed: 3 gates RED pre-apply (verbatim recorded), 4 gates GREEN post-apply including the atomicity oracle ON THE DEPLOYED BODY"
  - "SC#3 closed by measurement: live (i-b) finalize 200 + five-relation diff CLEAN vs the arm-4 baseline (one explained harness artifact recorded)"
  - "145-TERMINALIZE.md: 18 PROD rows terminalized UPDATE-only with per-row rollback anchors; post-pass PROD orphan census 0/0"
affects: [the merge (auto-applies 20260819120000 to PROD), Phase 146]

key-decisions:
  - "Gate execution mechanism: Supabase MCP execute_sql (no local TEST_SUPABASE_DB_URL psql path exists) — parts run verbatim, writing parts inside their own BEGIN/ROLLBACK"
  - "Review deviation dispositioned in 145-TERMINALIZE.md: signal 2 (wizard_session_id present) is NULL on all 18 as an age artifact; source='csv' + zero first-hop population discriminates"
  - "Turbopack refuses a symlinked node_modules — worktree got an APFS clone instead (recorded for future worktree execution)"

# Metrics
duration: ~75 min (21:50–23:05 UTC 2026-08-17, spilling past midnight local)
completed: 2026-08-18
---

# Phase 145 Plan 06: TEST apply RED→GREEN, live exercise, SC#3 diff, terminalize

## RED→GREEN record

Pre-apply RED (all three observed verbatim, recorded in 145-REPRODUCTION.md SC#3 section):
the fold gate's designed Part-1 message; the auth guard's 42883-inside-handler RED; the
double-submit probe's raw 42883. Post-apply GREEN: fold gate Parts 1–5 (the atomicity
oracle left 0/0/0 across three tables after a mid-body class-22 fault AT THE DEPLOYED
BODY), auth guard A/B/C (exact messages; both parents gone from pg_proc), double-submit
1–4 (23505 fence, three-table rollback, cross-source control), wizard-session idempotency.

## SC#3

Live (i-b) finalize through the phase-branch route: 200 + UUID in 2425 ms; five-relation
diff against Plan 02's arm-4 baseline — identical on every field. The first run's missing
compute_jobs row was reproduced away with an 8 s `after()` flush wait and recorded as a
harness artifact (hop 5 is post-response by design; window D; 143's net).

## Terminalize

18/18 PROD rows: analytics `failed` (original incident error text preserved via COALESCE
on 15; Phase-145 reason on the 3 no-analytics rows), then `archived`. Zero DELETEs
(count-asserted). Post-pass PROD census (1)=0, (2)=0. TEST: recorded no-op (q2=0).

## D-10

`git diff origin/main...HEAD` over 20260816140000 + 20260817120000: **0 lines**. The
fold migration 20260819120000 was not edited by any Wave-4/5/6 step (executor-verified in
each SUMMARY; re-verified here by the same diff).

## Approval record

**APPROVED by the founder 2026-08-18 (AskUserQuestion, option "Approved — ship it") after
review of the evidence set: verdict + SC#3 diff, 145-TERMINALIZE.md, 145-DECISION.md
conformance, the neuter-RED tables, and the D-10 zero-diff check.** Proceeding to /ship;
the merge applies 20260819120000 to PROD.
