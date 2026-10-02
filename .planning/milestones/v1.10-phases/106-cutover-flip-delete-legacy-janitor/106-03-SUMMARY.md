---
phase: 106-cutover-flip-delete-legacy-janitor
plan: 03
status: reverted-deferred
deferred_to: "106.1"
---

# 106-03 SUMMARY — computing-janitor ⛔ REVERTED / DEFERRED → 106.1

**Status:** ⛔ REVERTED (`742cfb1c` reverts `77844ae1`+`a5e5a86a`+`190127c9`). **Deferred to Phase 106.1.**

## Why (Fable red team B-1, BLOCKER)
The janitor filtered `strategy_analytics.updated_at` — a column that **does not exist**
(table has `computed_at` only; confirmed via generated `database.types.ts` + live prod
`information_schema`). First `*/15` cron tick would 400 → 500 → alarm every 15 min forever,
reaping nothing. The wiring test mocked supabase and **pinned the phantom column**, so it
stayed green over dead code (tested-the-helper-not-the-wiring). The seed script it was
"promoted from" (`scripts/reset_stuck_computing_rows.py:65`) has the same bug — so it never
actually ran against prod either; the "promoted from a working script" premise was false.

## Why it can't be a quick fix (the 106.1 constraint)
`computed_at` is NOT a safe substitute — it tracks last **completion**, not the transition
INTO `computing`, so a strategy seconds into a resync looks days-stale and would be **reaped
mid-compute**. A correct reaper needs a real transition timestamp (new `computing_started_at`
column stamped by every `computing` writer, or `updated_at` + trigger) = **store DDL**,
which Phase 106 is fenced against. Re-implement in **106.1** (the DDL phase) with
migration-reviewer + rls-auditor + test-DB catch-up. Carry the two hardening findings:
**M-1** reap must clear `computation_warned` (SI-02 invariant); **M-2** the CAS UPDATE must
re-check staleness, not just `.eq(status,'computing')`. Threshold stays > 40-min watchdog
ceiling. See [[project_106_janitor_deferred_needs_transition_timestamp]].

## Net
Prod is NOT regressed — there is no computing-janitor there today; the main_worker
watchdogs already cover in-flight timeouts. Reverted state green: `test_cron_router.py` 40
passed, `vercel-cron-limits` 24 passed, tsc 0.
