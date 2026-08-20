---
phase: 144-job-wr-02-orphaned-running
plan: 03
subsystem: infra
tags: [pg-cron, supabase-mcp, test-apply, live-tick, prod-apply, merge, census]
status: complete

# Dependency graph
requires:
  - phase: 144-01
    provides: "migration 20260817120000 (the two-arm terminalizer, frozen cron body md5 4432bc62bfa1bde8affe69204ef3b3ac) + the same-commit test_retention_orphaned_running.sql rewrite"
  - phase: 144-02
    provides: "the TS migration-content gate in every vitest shard + JOB-08 WON'T-FIX paper trail"
provides:
  - "The terminalizer LIVE on TEST (jobid 19) and PROD (jobid 34), byte-identical to the repo span — 3-way md5 match"
  - "144-CENSUS.md §5-§7 — three successive real :50 ticks against a live 402-row fixture: arm-B positive (6/6), arm-A negative control at real scale, bound HOLDS (exactly 100) matching a pre-registered byte-for-byte prediction, bound PROGRESSES (resumes at a microsecond tie), conservation 402 throughout"
  - "PR #688 merged (squash 9e1bc3f2) — the one-way PROD apply, executed under the founder's 'apply once ready' directive"
affects: [Phase 145 (depends on 144 complete), retention job family, any future orphaned-running edit]

# Tech tracking
tech-stack:
  added: []
  patterns: ["pre-registered prediction: checksum the expected target set BEFORE apply, match after", "jobname (not jobid) as the stable cron identity across re-registration"]

key-files:
  created:
    - .planning/phases/144-job-wr-02-orphaned-running/144-CENSUS.md
  modified: []

key-decisions:
  - "Merge = PROD apply, per founder directive 'without asking me. You can apply once ready'; readiness defined as full CI green (22/22 on PR #688)"
  - "Backlog draining explicitly NOT a merge gate — the TEST fixture holds ~196 arm-A rows post-tick-3 and will drain at ≤100/hour by design"

patterns-for-future-work:
  - "A cron job registered seconds after its own minute-mark misses that tick silently — schedule verification and first-tick verification are separate checks an hour apart"

# Metrics
duration: ~6h wall clock (spanning TEST apply 12:44 UTC → PROD tick 19:50 UTC, three tick-waits included)
completed: 2026-08-17
---

# Phase 144 Plan 03: TEST apply, three live ticks, PROD merge + first-tick verification

**The two-arm terminalizer is live on both projects, byte-identical to the repo, with the
LIMIT-100 bound proven to HOLD and PROGRESS against a real 402-row backlog — and the PROD
apply verified through its first tick.**

## Evidence bundle (all in 144-CENSUS.md unless noted)

| # | Claim | Evidence |
|---|-------|----------|
| 1 | Pre-apply PROD re-census: nothing to sweep | §1 — running 0, pending 0 (SC#4 re-measure at HEAD) |
| 2 | TEST fixture was real scale, not staged | §2 — 402 running rows (396 claimed + 6 NULL-claim), corrected from a falsified "6" census |
| 3 | NULL-claim rows are test residue, not a worker bug | §3 — attributed to `test_compute_jobs_fencing.py` on five independent attributes + a control (lifetimes 45–276 ms vs real min 4.576 s) |
| 4 | TEST apply byte-exact | §4 — jobid 11 → 19, jobname stable, body md5 `4432bc62bfa1bde8affe69204ef3b3ac` == repo dollar-tag span |
| 5 | Arm B positive at tick 1 | §5 — all 6 immortal NULL-claim rows terminalized, `next_attempt_at` stamped (B3), `error_kind='permanent'` |
| 6 | Arm A zero at tick 1 was CORRECT | §5 — the 396 rows were 3h47m old (claimed 12:05 by 9 CI workers), inside the 4h window; an unplanned negative control at real scale that falsified my own "arm-A targets" claim |
| 7 | Bound HOLDS | §6 — tick 2 moved EXACTLY 100 rows, oldest-first; the moved id-set md5 `caf7fb80f21e28c85ab1a365f7f3de69` matched the pre-apply prediction byte-for-byte |
| 8 | Bound PROGRESSES | §7 — tick 3 moved 100 MORE, disjoint ids, resuming at the microsecond tie 12:05:29.794561; conservation 402 across all ticks |
| 9 | Merge gates | PR #688: 22/22 checks green including `sql-tests` (4/4 parts) and `e2e-seeded`; vitest 11,873 passed after the one real failure (version-drift gate) was fixed |
| 10 | PROD apply byte-exact | post-merge query: jobid 29 → 34, jobname stable, `'50 * * * *'`, body 1396 bytes, md5 `4432bc62…` — 3-way match (repo = TEST = PROD) |
| 11 | First PROD tick | §8 (appended post-merge) — see below |

## The one-way door, and how it was walked

Merging `supabase/migrations/**` to main auto-applies to PROD. The founder authorized this
in advance ("without asking me. You can apply once ready"); readiness was defined as full CI
green. Sequence executed: suite green → release commit 7049fb6a (VERSION 0.64.0.0) → PR #688
via REST (GitHub GraphQL partial outage) → CI 22/22 → squash merge 9e1bc3f2 → ledger row
`20260817120000` confirmed → cron row verified by JOBNAME (jobid moved 29 → 34, exactly the
per-project drift the corrected header predicts).

Timing note: the PROD job registered seconds after 18:50:00 UTC, so the 18:50 tick was
silently missed — first real tick 19:50. Recorded as a pattern: schedule-verification and
first-tick-verification are separate checks.

## Deviations from plan

- The plan's human gate before merge was superseded by the founder's explicit in-session
  directive; the CI-green readiness bar was kept.
- Tick observations doubled as claim-falsification: the census "6", the arm-A-targets
  paragraph, and the jobid-continuity header claim were each corrected in place when a
  measurement contradicted them (see CENSUS §2, §5; migration header).

## Operator handoff

- TEST keeps draining at ≤100 rows/hour until its ~196 remaining arm-A rows are gone; no
  action needed. The stale-`pending` TEST backlog is JOB-08 WON'T-FIX territory (TODOS).
- PROD steady state: both arms should stay at zero; any nonzero `orphaned_running_reaped`
  count in `failed_final.last_error` is a real worker-loss signal, visible and Sentry-adjacent
  — that visibility is the phase's entire point.

## §8 — First PROD tick (appended post-merge)

**Observed 2026-08-17: runid 5721, started 19:50:00.101627+00, `succeeded`, 9 ms, return
"DO".** Post-tick census: `running` = 0, `orphaned_running_reaped` rows = 0 — the janitor
swept NOTHING, exactly as the pre-merge census predicted (PROD had zero candidates in either
arm). This is the negative control, NOT proof of healing at scale — that proof lives in the
three TEST ticks (§5–§7 of 144-CENSUS.md), where the sweep ran against 402 real rows.

Deploy chain, fully verified: squash 9e1bc3f2 → migration ledger row → cron re-registered
by JOBNAME (jobid 29 → 34) byte-exact → main CI green (the `e2e-seeded` cancellation was
the known `shared-test-db` concurrency eviction; the rerun of run 32056935208 succeeded) →
Railway deployment e9fb6f47 SUCCESS on commit 9e1bc3f2 at 19:30:26Z → first tick clean.
