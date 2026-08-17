---
phase: 143-job-dropped-enqueue-reconciliation-sweep
plan: 04
subsystem: ops
tags: [supabase-mcp, test-db, pg_cron, railway, sentry, human-verify, force-rls, live-tick]

# Dependency graph
requires:
  - phase: 143-job-dropped-enqueue-reconciliation-sweep/plan-02
    provides: "the migration to apply, and the census part A this file appends part B to"
  - phase: 143-job-dropped-enqueue-reconciliation-sweep/plan-03
    provides: "supabase/tests/test_reconcile_dropped_enqueue_sweep.sql — Part 1 is the pre-apply RED this plan flips to GREEN"
  - phase: 143-job-dropped-enqueue-reconciliation-sweep/plan-01
    provides: "the worker-side reconcile-sweep Sentry capture whose production reachability this plan adjudicates (D-11)"
provides:
  - "The migration APPLIED to TEST (qmnijlgmdhviwzwfyzlc), PROD untouched"
  - "⭐⭐ THE L-2 / T-143-02 RESOLUTION — one real cron tick observed inserting a compute_jobs row through FORCE ROW LEVEL SECURITY. The single fact no CI gate in this repo can establish."
  - "143-CENSUS.md part B — sections (6)-(15): RED/GREEN, body byte-match, slot table, cron-role flags, the tick, SC#2 live, D-12 falsification, cleanup, D-11 verdict"
  - "TODOS.md — three items under 'Phase 143 — recorded deferrals'"
  - "A CORRECTED migration header: the return_message premise is now observed-false rather than unverified-true"
affects:
  - "Phase 144 (WR-02 orphaned-running) inherits a PROVEN cron-role write path on compute_jobs — it no longer has to re-litigate FORCE RLS"
  - "142's reaper header carries the SAME falsified return_message premise and was NOT corrected here — filed to TODOS"

actuals:
  tasks: 3
  commits: 4
  wall_clock: "~30 min including a 7-minute wait for the 09:35 UTC tick"

tech-stack:
  added: []          # ZERO packages installed (T-143-SC holds)
  patterns:
    - "Byte-match the DEPLOYED artifact against the repo (md5 of the dollar-tag span) instead of trusting that a transmitted payload was verbatim. Cheaper and stronger than careful retyping, and it is the only check that would catch either."
    - "Seed the live probe COMMITTED and namespaced, capture evidence BEFORE cleanup, then verify zero residue by re-selecting each table by the namespace."

key-files:
  created: []
  modified:
    - supabase/migrations/20260816140000_reconcile_dropped_enqueue_sweep.sql   # comment-only: D-12 correction
    - .planning/phases/143-job-dropped-enqueue-reconciliation-sweep/143-CENSUS.md
    - .planning/phases/143-job-dropped-enqueue-reconciliation-sweep/143-CONTEXT.md
    - TODOS.md

key-decisions:
  - "⭐⭐ L-2 / T-143-02 RESOLVED BY MEASUREMENT. The 09:35:00 tick inserted job 58728527 for the probe with metadata {source: reconcile-sweep, detected_at: 2026-08-17T09:35:00.061076+00:00}, created_at == tick start. The pg_cron role (postgres, rolbypassrls=true) CAN write public.compute_jobs through FORCE ROW LEVEL SECURITY. RESEARCH's A2 risk — silent zero-insert forever behind green CI — is retired."
  - "⭐ D-11 RESOLVED POSITIVELY, and the premise behind it was wrong. There is no separate worker Railway service and has not been since April: the worker loops were MERGED into the FastAPI process (main.py:80-86, after the 2026-04-20 'jobs queued but never processed' incident), dispatch_loop runs as an asyncio task in the app lifespan (main.py:271), that process has called init_sentry() since Phase 16 (main.py:69), and SENTRY_DSN IS set on it. SC#1's alert half is TRUE in production. No founder action item is owed. 143-01's init_sentry() in main_worker.main() remains correct but covers the STANDALONE path, not production."
  - "⭐ D-12 FALSIFIED AND CORRECTED IN-PHASE. return_message carried 'DO' — the command tag — not the RAISE NOTICE text. The header's own UNVERIFIED flag was discharged as FALSE and the wording replaced with the observed behaviour plus a row-count query that actually works. 142's reaper relies on the same premise and was NOT touched; filed to TODOS."
  - "PLAN DEVIATION, escalated: the pre-apply RED was captured by running the gate's Part 1 assertion directly against TEST, not as a CI run URL. The branch has never been pushed (26 commits ahead of origin/main, no remote ref) and pushing is /ship's job, not this plan's. Same assertion, same database, no harness in between — stronger as evidence, but not the artifact the plan named, so it is labelled rather than glossed. 143-03's already-observed N1b neuter covers the same condition."
  - "PLAN DEVIATION, escalated: only the executable span (file lines 468-785) was transmitted through MCP apply_migration, not the 460-line comment header. Retyping that much dense prose through a tool argument risks transcription drift — a worse failure than the omission, since comments never reach the database. Discharged by the byte-match: deployed cron.job.command and the repo dollar-tag span are both len 1860, md5 febf9bdd6dfc58aa101ed8c4345e3b29."
  - "SC#2's CORRECTED mechanism confirmed LIVE: immediately post-tick the probe returned zero rows against the deployed predicate. The zero-jobs conjunct removes the strategy once any job row exists, so a second tick never reaches the INSERT. Not the partial unique index. 143-02 measured this offline; this is the live confirmation."

requirements-completed: []   # JOB-04 deliberately NOT ticked — see below

# Metrics
duration: ~30min
completed: 2026-08-17
---

# Phase 143 Plan 04: apply to TEST + the live-tick proof — Summary

**The evidence no local run and no CI gate can produce: the migration is live on TEST, and one real
`35 * * * *` tick was observed healing a seeded orphan — resolving the phase's highest-risk unknown
by measurement rather than inference.**

## What was executed, and by whom

Plan 04 was dispatched to a `gsd-executor` first. It **correctly refused and escalated**: the
Supabase MCP tools are stripped from subagents, its precondition said so, and every fallback was
either forbidden (`supabase db push`), absent (`psql` not installed), or already measured dead
(PostgREST returns 404 on `cron.*`). Nothing was written and nothing was applied. The plan then ran
in the orchestrator session, which is the only session holding the MCP — exactly as the precondition
prescribed.

## The result that matters

| | |
|---|---|
| tick | `2026-08-17 09:35:00.061575+00` → `09:35:00.186637+00`, `succeeded`, 125 ms |
| healed job | `58728527-5cfc-4660-bb00-e0dfecc60bf7` |
| strategy | `de19555f-…` (the seeded probe) |
| kind / status | `compute_analytics_from_csv` / `pending` |
| metadata | `{"source": "reconcile-sweep", "detected_at": "2026-08-17T09:35:00.061076+00:00"}` |
| created_at | `09:35:00.061076+00` — identical to tick start |

**The cron role can write `public.compute_jobs` through `FORCE ROW LEVEL SECURITY.`** Both halves of
the cross-language marker contract carry the exact values `main_worker.dispatch_tick` reads. Full
evidence in `143-CENSUS.md` part B §(11).

## Evidence bundle (all in 143-CENSUS.md part B)

| # | Item | Result |
|---|---|---|
| 6 | Pre-apply RED | ✅ observed — `job is NOT registered` (method deviation labelled) |
| 7 | Apply via MCP | ✅ `success`; STEP 2 self-verify passed inside the apply |
| 8 | Deployed-body integrity | ✅ **byte-identical**, md5 `febf9bdd…`, len 1860 both sides |
| 9 | Post-apply GREEN + slots | ✅ jobid 18, `35 * * * *`, active; no collision |
| 10 | Cron role (paper half) | `postgres`, `rolbypassrls=true` — same role as the live janitors |
| 11 | **The live tick** | ✅ **L-2 RESOLVED** |
| 12 | SC#2 live | ✅ probe left the predicate; zero-jobs conjunct confirmed |
| 13 | D-12 | ⛔ **premise FALSE** — `return_message` = `DO`; header corrected |
| 14 | Cleanup | ✅ zero residue on all five checks |
| 15 | D-11 worker DSN | ✅ **RESOLVED POSITIVELY** — worker is merged, DSN set |

## Things you should know

1. **JOB-04 is deliberately NOT marked complete.** The mechanism is proven on TEST, but the
   requirement's value lands only once it is live on PROD, and merging is `/ship`'s act, not this
   plan's. Ticking it here would be the false-completion class this project keeps closing.

2. **The first PROD tick after merge will enqueue ZERO jobs** — the census puts the standing
   candidate population at 0 on both projects. That is the safe outcome, and it means the merge
   produces **no positive evidence**. Proof of function is the offline harness (143-02), the CI gate
   (143-03) and this live TEST tick — never PROD quietness. Re-run the census before merge; the
   numbers are a snapshot.

3. **142's reaper carries the same falsified `return_message` premise** and was not corrected — it
   is outside this phase's scope and is filed to TODOS. Anyone reading that header today is reading
   an unobserved claim.

4. **TEST retains the registered cron job** (jobid 18) by design. It ticks hourly at `:35`. TEST has
   no worker, so anything it enqueues is never drained — bounded by construction, since a job row of
   any status removes the strategy from the predicate forever after. Standing population is 0.

5. **The `checkpoint:human-verify` (Task 3) has NOT been discharged.** Its `resume-signal` is a human
   typing "approved" to authorize `/ship`. The evidence bundle it asks the reviewer to check is
   assembled and above; the authorization itself is owed and is the phase's remaining gate.

## Not done

- No push, no PR, no merge. Nothing has touched PROD.
- The CI RED→GREEN pair exists as direct-against-TEST observations, not CI run URLs (see the
  deviation note above).
