---
phase: 214-freshtruth-refresh-work-and-freshness-readings-match-what-ca
plan: 04
subsystem: api
tags: [correlation-id, enqueue, dedup, ledger-refresh-marker, finalize-wizard, csv-finalize, mutation-gate]
requires: []
provides:
  - "finalize-wizard stitch_composite enqueue sends p_metadata { source, correlation_id } (SC-8)"
  - "csv-finalize compute_analytics_from_csv enqueue sends p_metadata { source, fmt, correlation_id } with the envelope's id (SC-8)"
  - "exact-object TypeScript assertions that go RED when either route stops sending the id (SC-7)"
  - "dedup gate arms FINALIZE-WIZARD-SHAPE and CSV-FINALIZE-SHAPE with source-keyed twins (18 arms)"
affects: [214-07]
tech-stack:
  added: []
  patterns: ["exact toEqual on p_metadata, not a partial toMatchObject", "source-keyed carve-out twin reusing the NO-CORRELATION find"]
key-files:
  created: []
  modified:
    - src/app/api/strategies/finalize-wizard/route.ts
    - src/app/api/strategies/finalize-wizard/route.test.ts
    - src/app/api/strategies/csv-finalize/route.ts
    - src/__tests__/csv-validate-route.test.ts
    - src/lib/ledger-refresh-marker.ts
    - supabase/tests/test_enqueue_dedup_record_retract.sql
key-decisions:
  - "Both routes send their request's correlation_id; _record_enqueue_dedup gets no SQL widening and no background path sends an id (CONTEXT SC-8, Phase 211 D11-8)"
  - "The CSV route's metadata uses opts.correlationId, the same value the success envelope returns, asserted equal to body.correlation_id"
  - "NO-CORRELATION keeps its seed, twin and assertions; only its payload label moves to a neutral uncorrelated-caller, since no route sends that shape any more"
metrics:
  duration: "about 35 minutes"
  completed: 2026-11-14
status: complete
actuals:
  tokens: 9000
  tasks: 3
  commits: 3
plan_head_before: 61b5f8581a379562ec6124db8fe4d85fe11616fd
plan_head_after: 2ab1e67fed2270625b2182e50a7b01fab99c6df0
---

# Phase 214 Plan 04: the two finalize routes send their correlation id Summary

A user-initiated stitch (finalize-wizard) or CSV analytics (csv-finalize) request that dedups onto a job a recurring ledger refresh already queued now retracts the inherited `ledger-refresh` marker in SQL, because both routes send the request's `correlation_id` in `p_metadata`.

## What was built

- `finalize-wizard/route.ts`: the `stitch_composite` enqueue's metadata is `{ source: "finalize-wizard", correlation_id: correlationId }` (request-scoped id already in scope). The `sync_trades` enqueue keeps its bare literal (grep count 1 for the bare form, 1 for the new form).
- `csv-finalize/route.ts`: the `compute_analytics_from_csv` enqueue's metadata is `{ source: "csv-finalize", fmt, correlation_id: opts.correlationId }`.
- `route.test.ts` ("via the hoist") and `csv-validate-route.test.ts` (Test 9): exact `toEqual` on `p_metadata`; Test 9 reads the response body and asserts the enqueue's id equals `body.correlation_id`, a non-empty string. The existing partial `toMatchObject` stays.
- `test_enqueue_dedup_record_retract.sql`: arms `FINALIZE-WIZARD-SHAPE` (stitch_composite, `ledger-refresh-composite` marker) and `CSV-FINALIZE-SHAPE` (compute_analytics_from_csv, `ledger-refresh` marker, `fmt` in the payload) placed after KIND-CSV, each with a prose `RED-UNDER:` and a `RED-UNDER-M` twin that adds `AND (p_metadata ->> 'source') IS DISTINCT FROM '<source>'` after the `correlation_id` conjunct (same find as NO-CORRELATION, occurrences 1). Count 16 to 18 in the header and the executed notice, both arms named in the notice and in header bullets.
- Prose: `ledger-refresh-marker.ts` JSDoc no longer calls finalize-wizard the uncorrelated residual or this helper its only retraction (comment lines only, backstop kept by D11-4); the dedup gate's header bullet and NO-CORRELATION comment block describe an uncorrelated caller no route sends, and the arm's `v_sent` source is `uncorrelated-caller`.

## Evidence

**Task 1, RED on the Phase 211 route (step 1, test added, route unchanged):**
`AssertionError: expected { source: 'finalize-wizard' } to deeply equal { source: 'finalize-wizard', …(1) }` at `route.test.ts:1871` (`- "correlation_id": "66666666-7777-8888-9999-000000000000"` missing from the received object). GREEN after the route change: 171 passed.

**Neuter N1 (finalize-wizard):** byte backup to `$TMPDIR/fw-route.ts.bak`, `correlation_id: correlationId` deleted, same `AssertionError` on "via the hoist" (1 failed, 170 passed); restored by `cp`, `cmp` exit 0.

**Task 2, RED on the Phase 211 route (csv):** `AssertionError: expected { source: 'csv-finalize', …(1) } to deeply equal { source: 'csv-finalize', …(2) }` with `- "correlation_id": "a4b61b5f-…"` missing (the non-empty-string assertions on the envelope's id passed first). GREEN after the route change: 3 files, 260 tests passed.

**Neuter N2 (csv-finalize):** byte backup to `$TMPDIR/csv-route.ts.bak`, `correlation_id: opts.correlationId` deleted, same `AssertionError` on Test 9 (1 failed, 55 passed); restored by `cp`, `cmp` exit 0.

**Dedup gate on the pg-lane** (fresh workdir under `$TMPDIR`, removed after): `ALL 18 ARMS EXECUTED`, no `TEST FAILED`, no `SKIP:`, exit 0. Re-run after Task 3: same.

**Subset mutation run** (`--subset-from`, one file): `file test_enqueue_dedup_record_retract.sql: sections 18 / judged 18 / annotated 18 / waived 0 / biting 18`; `arms: 18/18/0`; `FINALIZE-WIZARD-SHAPE` and `CSV-FINALIZE-SHAPE` each `RED (identity ok)`; `No defects in the SUBSET`. Re-run after Task 3: same per-file line.

**`lint-sql-gates`:** self-test OK (7 rules), corpus 0 findings.

**Task 3 diff (`git diff -U0 -- src/lib/ledger-refresh-marker.ts`):** one hunk, comment lines only (the `* ...` JSDoc paragraph rewritten). `grep -a -c 'D11-9 residual'` prints 0; `grep -a -c 'the recorded residual'` in the gate prints 0.

## Deviations from Plan

None - plan executed exactly as written. (`npm ci` was skipped: `node_modules` was already installed, per the dispatch notes.)

## Notes for plan 07 (not done here, by plan)

- The dedup gate's arm count is now 18 and the mutation corpus gains two annotated arms (static upper bound printed by the subset run: 857 annotated-unwaived against floor 848). The census vitest files and the floor ratchet are expected RED until plan 07 moves them.
- `TODOS.md` `211-D11-RESIDUAL-UNCORRELATED-SENDERS` is closed in code by this plan; the ship deletes the entry and names it in the CHANGELOG.

## Known Stubs

None.

## Threat Flags

None. The only new surface is the request-scoped correlation id in `compute_jobs.metadata`, covered by T-214-13 to T-214-15 (id charset enforced by `getCorrelationId`, stored as JSON, SQL predicate unchanged).

## Self-Check: PASSED

- FOUND: all six modified files; commits f418baa8f, fcbad4415, 2ab1e67fe are ancestors of HEAD.
- `STATE.md` and `ROADMAP.md` not modified.
