---
phase: 143-job-dropped-enqueue-reconciliation-sweep
plan: 03
subsystem: testing
tags: [sql-gate, vitest, pytest, ci, pg_cron, migration-content-gate, neuter-proof]

# Dependency graph
requires:
  - phase: 143-job-dropped-enqueue-reconciliation-sweep/plan-01
    provides: "the Python half of the marker contract — main_worker.dispatch_tick() reads {source, detected_at} == 'reconcile-sweep'; this plan pins it against the SQL half"
  - phase: 143-job-dropped-enqueue-reconciliation-sweep/plan-02
    provides: "the migration under test, the throwaway harness the neuter campaign runs against, and THREE measured mechanism corrections that changed how these gates had to be written"
  - phase: 142-strategy-analytics-stuck-computing-reaper
    provides: "supabase/tests/test_strategy_analytics_stuck_computing_reaper.sql — the SQL-gate template: anti-green-skip Part 1, per-part BEGIN/ROLLBACK, EXECUTE-the-deployed-body oracle, century-backdate-never-sleep, identity-scoped assertions, failure-message register"
provides:
  - "supabase/tests/test_reconcile_dropped_enqueue_sweep.sql — 4 parts, CI-discoverable by the existing sql-tests job, oracle = EXECUTE of cron.job.command"
  - "src/__tests__/reconcile-dropped-enqueue-sweep.test.ts — 11 migration-content assertions, no DB, runs in every vitest shard"
  - "analytics-service/tests/test_main_worker.py::TestReconcileSweepMarkerContract + _SWEEP_MIGRATION_NAME / _sweep_migration_path() / _sweep_cron_body()"
  - "A 12-row observed neuter table, including TWO predicted REDs that did NOT appear and ONE vacuity the campaign found in a gate this plan had just written"
affects:
  - "143-04 owns the TEST apply; until then this file's Part 1 REDs on the PR's first sql-tests run BY DESIGN"
  - "143-04 also owns the only evidence for T-143-02 (the cron role's RLS posture) and for the concurrent-race clauses, neither of which any CI gate can produce"

actuals:
  tokens: 21147      # chars/4 over the realized diff (84,589 added chars across the 3 files)
  tasks: 3
  commits: 3

tech-stack:
  added: []          # ZERO packages installed (T-143-SC)
  patterns:
    - "Per-part slicing of a SQL gate for neuter observation: under psql -v ON_ERROR_STOP=1 a Part-1 text anchor ABORTS the file, so a whole-file neuter run silently proves nothing about the behavioural parts. Cutting the committed file into per-part slices and running the ONE part each neuter targets is what makes each ARM's RED observable."
    - "Pin the OPERATOR, not the literal, when a source-scan gate looks for a value that also appears cosmetically nearby (a Sentry tag satisfied a bare-literal marker check all by itself)."

key-files:
  created:
    - supabase/tests/test_reconcile_dropped_enqueue_sweep.sql
    - src/__tests__/reconcile-dropped-enqueue-sweep.test.ts
  modified:
    - analytics-service/tests/test_main_worker.py

key-decisions:
  - "⭐ PLAN DEVIATION, escalated: the plan's Part 3 was specified as an SC#2 idempotency proof via two EXECUTEs in one session. Plan 02 had already MEASURED that shape to be VACUOUS. Part 3 was written anyway — a second tick must not double-enqueue, and that is worth a gate — but it is LABELLED IN THE FILE as a DOUBLE-MUTATION observable with the three single-neuter outcomes spelled out, and its header states that the race clauses have NO CI gate at all. Both single neuters were run to confirm the labelling rather than trusted."
  - "⭐ PLAN DEVIATION, escalated: the plan's neuter (6) (bare INSERT -> Part 3 REDs) and neuter (7) (MATERIALIZED removed -> Part 4 REDs with 26 healed) are BOTH FALSE, as Plan 02 measured. Both were executed anyway and both were GREEN in isolation, independently reconfirming 143-02's corrections 1 and 3 in Plan 03's own frame. Substitute neuters that DO redden were added and observed: N6b (ON CONFLICT + zero-jobs conjunct both removed -> 23505) and N7b (LIMIT 25 removed -> the 26th healed on tick 1)."
  - "⭐ The neuter campaign found a REAL VACUITY in a gate this plan had committed 10 minutes earlier: the Python half of the marker contract asserted the bare literal \"reconcile-sweep\", which the emission's own Sentry TAG satisfied, so changing the load-bearing COMPARISON left it green. Fixed to pin `== \"reconcile-sweep\"` and re-observed RED (commit f62c3866)."
  - "Part 1 carries NO pg_cron skip arm, per the plan. An absent extension is a loud EXCEPTION with an explanatory message rather than a bare 42P01 from the catalog read — a legible RED, still never a green skip."
  - "The four excluded computation_status values are asserted AS A SET in the TS gate, not as four substring probes. That catches an ADDED status (e.g. 'pending', which would excise the very population being healed) as loudly as a removed one; four substring probes would not."
  - "The gate file's header deliberately does NOT name the psql meta-commands the CI preflight refuses. Drafting it that way would have made the gate REFUSE ITSELF — the preflight scans the whole file, comments included. Caught before the first commit by running the preflight greps verbatim."

patterns-established:
  - "Pattern 1: a SQL gate's cheap text anchors MASK its behavioural arms during neuter observation. Fail-fast ordering is right for CI but wrong for proof, so the neuter run must isolate the part under observation. Without this, six of eight neuters here would have been recorded as 'RED' while Parts 2-4 had never executed once under a broken body."
  - "Pattern 2: prove body-scoping from what is ALREADY TRUE before staging an experiment. The migration header carries computed_at x4, updated_at x5, enqueue_compute_job x6 and SECURITY DEFINER x3 while its cron body carries zero of each — so the gates being green IS the scoping proof; a whole-file grep would be red right now. The staged prose probe then re-confirmed it for the two tokens not already present."

requirements-completed: []   # JOB-04 is NOT complete — 143-04 owns the TEST apply and the live tick

coverage:
  - id: D1
    description: "SC#1 detect — a strategy with dailies past grace, zero compute_jobs rows and no strategy_analytics row gets exactly one pending compute_analytics_from_csv job carrying metadata.source='reconcile-sweep' and detected_at"
    requirement: "JOB-04"
    verification:
      - kind: integration
        ref: "supabase/tests/test_reconcile_dropped_enqueue_sweep.sql Part 2 arms A + A2 (EXECUTE of the deployed cron.job.command)"
        status: pass
    human_judgment: false
  - id: D2
    description: "SC#3 — in-grace, any-job (running/failed_final/done), terminal-analytics (complete/cww/failed), computing, composite and archived strategies are NEVER touched"
    requirement: "JOB-04"
    verification:
      - kind: integration
        ref: "Part 2 arms B, C1-C3, D1-D4, E, F + the whole-block invariant; four of them OBSERVED RED under N2/N3/N4/N5 with the part run in isolation"
        status: pass
    human_judgment: false
  - id: D3
    description: "SC#2 bound — the per-tick heal count is capped at 25 and the batch still drains"
    requirement: "JOB-04"
    verification:
      - kind: integration
        ref: "Part 4: 26 staggered century-old seeds -> tick 1 heals the 25 oldest with the youngest untouched, tick 2 heals the 26th. OBSERVED RED under N7b (LIMIT removed)."
        status: pass
    human_judgment: false
  - id: D4
    description: "The deployed body's shape cannot drift silently — jobname, cadence, five conjuncts, four excluded statuses, marker keys, bound and race clauses, and the rejected shapes"
    requirement: "JOB-04"
    verification:
      - kind: integration
        ref: "SQL gate Part 1 (against the DEPLOYED body in cron.job) + src/__tests__/reconcile-dropped-enqueue-sweep.test.ts (11 tests, against the migration file)"
        status: pass
    human_judgment: false
  - id: D5
    description: "SC#1 alert — the metadata marker the SQL stamps equals the marker main_worker.py reads (D-11 cross-language contract)"
    requirement: "JOB-04"
    verification:
      - kind: unit
        ref: "analytics-service/tests/test_main_worker.py::TestReconcileSweepMarkerContract::test_cron_body_marker_matches_worker_literal — OBSERVED RED under a SQL-side key rename, a Python-side key rename AND a Python-side value change"
        status: pass
    human_judgment: false
  - id: D6
    description: "SC#2 idempotency under a CONCURRENT race — that ON CONFLICT DO NOTHING and FOR UPDATE SKIP LOCKED actually protect the sweep against the live enqueue path"
    verification: []
    human_judgment: true
    rationale: "⛔ NOT COVERED BY ANY CI GATE, and this plan does not claim otherwise. The proof needs TWO concurrent sessions at READ COMMITTED; supabase/tests/*.sql runs in ONE psql session, so it is structurally inexpressible there. The only evidence is the three-case experiment recorded in 143-02-SUMMARY.md, which is an offline measurement and not a gate. What IS gated is deletion of either clause (Part 1 text anchors, both observed RED). Part 3's header says this in the file rather than leaving a green to imply coverage."
  - id: D7
    description: "The pg_cron job ROLE can write compute_jobs through FORCE ROW LEVEL SECURITY (T-143-02 / landmine L-2)"
    verification: []
    human_judgment: true
    rationale: "STRUCTURALLY unprovable here. The sql-tests job connects as the psql user, not the cron role, and the throwaway harness has no RLS at all. The only evidence is ONE REAL TICK on TEST inspected in cron.job_run_details — Plan 04 owns it as a BLOCKING pre-merge item. Stated in the gate file header, not just here."
  - id: D8
    description: "The gates behave against the REAL TEST schema (real RLS, real triggers, real pg_cron)"
    verification: []
    human_judgment: true
    rationale: "The neuter campaign ran against Plan 02's throwaway harness plus a local addendum, which has no RLS, no real scheduler and minimal table shapes. The real-schema run is the CI sql-tests job after Plan 04 applies. Until then Part 1 REDs by design and Parts 2-4 have never executed against the real schema."

# Metrics
duration: 26min
completed: 2026-08-16
status: complete
---

# Phase 143 Plan 03: JOB-04 CI Gates + Neuter Proof Summary

**Three CI-visible gates now stand behind the dropped-enqueue sweep — a SQL gate that EXECUTEs the deployed cron body against seeded fixtures, a no-DB migration-content gate, and a cross-language marker contract — and running the neuter campaign properly turned up three things the plan had wrong and one vacuity in a gate this plan had itself written ten minutes earlier.**

## Performance

- **Duration:** 26 min (first commit 23:43:32 → final 23:59:31, 2026-08-16)
- **Tasks:** 3 / 3
- **Commits:** 3 task commits (+1 docs commit)
- **Files changed:** 2 created, 1 modified

**`actuals.tokens` basis:** `21147` is chars/4 over the **realized diff** (84,589 added chars across the three files), per the template rule. The plan's `estimate.tokens` was 90,000 at `confidence: low` with 0 calibration samples — so on the diff scale this came in at ~24% of estimate, the same ratio Plan 02 recorded (21,849 vs 90,000). Two samples now agree, which suggests the estimator for this phase is working on a different scale rather than being randomly high. Recorded unrounded.

## What Was Built

### 1. `supabase/tests/test_reconcile_dropped_enqueue_sweep.sql` (808 lines)

Four parts, discovered by the **existing** `sql-tests` job via its `supabase/tests/test_*.sql` glob — no new CI job, no new concurrency group (`ci.yml:895-901` forbids it).

| Part | What it does | Framing |
|---|---|---|
| 1 | STRUCTURAL, **ungated** — reads the deployed body out of `cron.job` and asserts 20 anchors | no transaction; catalog reads only |
| 2 | 12 directional arms driven through `EXECUTE v_command` | own `BEGIN` / `SET LOCAL lock_timeout` / `ROLLBACK` |
| 3 | sequential re-run | same |
| 4 | the bound — 26 staggered century-old seeds, two ticks | same |

**Part 1 is the designed TDD RED.** It carries no pg_cron skip arm, so on the PR's first `sql-tests` run — before Plan 04 applies the migration to TEST — it fails with a message naming the open hole rather than a green skip. Both of its RED shapes were observed (see the neuter table, rows N1a/N1b).

Discipline carried from the 142 gate: no whole-file `BEGIN` (psql's nested `BEGIN` creates no savepoint, so the first inner `ROLLBACK` would end the outer transaction and every later part would AUTOCOMMIT seeds onto the **shared** TEST project); all assertions identity-scoped to the part's own seeds (`= ANY (v_seeded)`, never a global count or a global empty state); isolation by construction via century-backdated `csv_daily_returns.created_at` rather than the cross-tenant neutralizing `UPDATE`s deleted in 142.1/D-18; zero sleeps; zero `now()`-vs-`now()` comparisons; every failure message names the **consequence**, not the missing token.

### 2. `src/__tests__/reconcile-dropped-enqueue-sweep.test.ts` (404 lines, 11 tests)

Pure text, no DB, runs in every vitest shard. Extracts the `$cron$` body with the anti-vacuity guard, then asserts the five conjuncts, the bound, the race clauses, the marker, and the negative anchors **on the body only**; jobname/cadence/unschedule on the whole file; and a forward-drift sweep asserting no LATER migration re-registers the jobname.

The four excluded `computation_status` values are asserted **as a set**, parsed out of the `IN (...)` clause — not as four substring probes. That is strictly stronger: it reddens on an **added** status too, and adding `'pending'` would excise the largest slice of the population the sweep exists to heal.

### 3. `TestReconcileSweepMarkerContract` (+171 lines in `test_main_worker.py`)

`_SWEEP_MIGRATION_NAME` / `_sweep_migration_path()` / `_sweep_cron_body()` mirroring the reaper helpers, plus one test pinning the three marker literals on **both** sides — the SQL body's `jsonb_build_object` and `inspect.getsource(main_worker.dispatch_tick)`.

Deliberately **not** copied from `TestReaperThresholdDriftGate`: its SQL↔Python interval equality. No Python consumer reads the 1-hour grace, so mirroring it into a constant would be a decorative drift gate — a number nothing executes, guarded against a number nothing reads (RESEARCH "Don't Hand-Roll"). The marker literals *are* read on both sides, which is what makes this contract load-bearing.

## Gate | Neuter | Expected RED | Observed

Every row was **executed**. Body neuters mutate the **deployed** `cron.job.command` (never the repo file) and are restored by re-applying the committed migration; file neuters mutate the file and are restored with `git checkout --`, never retyped.

⚠️ **Read the "isolated" column.** The first campaign pass ran the whole gate file per neuter and reported eight REDs — but under `psql -v ON_ERROR_STOP=1` **Part 1's text anchors abort the file**, so six of those eight reddened in Part 1 and the behavioural arms in Parts 2–4 had never executed once under a broken body. Fail-fast ordering is correct for CI and wrong for proof. The campaign was re-run with the committed gate sliced mechanically into per-part files, running the ONE part each neuter targets. Both results are below, because recording only the first pass would have been a table of REDs that proved nothing about the arms.

| # | Gate | Neuter | Expected RED | Observed (whole file) | Observed (part isolated) |
|---|---|---|---|---|---|
| N1a | SQL Part 1 | run against a DB with **no pg_cron** | Part 1 REDs, never skips | ✅ `TEST FAILED (1/JOB-04): pg_cron is NOT installed on this database…` | — |
| N1b | SQL Part 1 | pg_cron **present**, migration **unapplied** (the designed CI RED) | Part 1 REDs naming the open hole | ✅ `TEST FAILED (1/JOB-04): pg_cron IS installed but the reconcile_dropped_enqueue_sweep job is NOT registered.` | — |
| N2 | SC#3 terminal-analytics (mass-re-enqueue tripwire) | drop `'complete'` from the exclusion list | arm D1 healed | ✅ RED — but in **Part 1's text anchor** | ✅ **RED at arm D1**: `a strategy with a COMPLETE strategy_analytics row was healed (1 sweep-marked jobs). This is THE MASS-RE-ENQUEUE INCIDENT.` |
| N3 | SC#3 has-a-job (D-02) | kind-scope the `NOT EXISTS` to `compute_analytics_from_csv` | arm C1 healed | ✅ RED at arm C1 (Part 1 has no anchor for this) | ✅ **RED at arm C1**: `a strategy with a RUNNING derive_broker_dailies job was healed… re-enqueues a HEALTHY IN-FLIGHT CHAIN` |
| N4 | SC#3 composite (DX-05/D-09) | remove the `strategy_keys` conjunct | arm E healed | ✅ RED in Part 1 | ✅ **RED at arm E**: `a COMPOSITE strategy… was healed… SILENT CORRUPTION OF A CORRECT ROW ON A MONEY SURFACE` |
| N5 | SC#3 in-grace | remove the grace conjunct | arm B healed | ✅ RED in Part 1 | ✅ **RED at arm B**: `a strategy whose dailies landed THIS INSTANT was healed… it would fire on every healthy CSV finalize` |
| N6 | SC#2 idempotency | remove `ON CONFLICT DO NOTHING` **alone** | plan predicted Part 3 REDs on `unique_violation` | RED in Part 1's text anchor only | ⚠️ **GREEN.** `healed 1` then `healed 0`, no error. **The plan's prediction is false**, exactly as 143-02 measured: tick 1's INSERT removes the strategy from the zero-jobs conjunct, so tick 2's batch is empty and the INSERT is never reached. Independently reconfirmed here. |
| N6b | SC#2 idempotency (substitute) | remove `ON CONFLICT DO NOTHING` **and** the zero-jobs conjunct | Part 3 REDs on 23505 | — | ✅ **RED**: `duplicate key value violates unique constraint "compute_jobs_one_inflight_per_kind_strategy"` |
| N7 | SC#2 bound (D-19 fence) | remove `AS MATERIALIZED` **alone** | plan predicted Part 4 REDs with 26 healed on tick 1 | RED in Part 1's counter only | ⚠️ **GREEN.** Still `healed 25` then `healed 1`. **The plan's prediction is false**, exactly as 143-02 measured: Postgres does not inline a CTE carrying a locking clause, so the fence is already implicit in this shape. |
| N7b | SC#2 bound (substitute) | remove `LIMIT 25` | the 26th healed on tick 1 | — | ✅ **RED at Part 4**: `my YOUNGEST seeded orphan — the 26th, sitting outside a 25-row budget — was healed on tick 1` |
| N8 | TS content gate | flip an excluded-status literal in the body (`'failed'` → `'failed_final'`) | vitest REDs naming the set mismatch | ✅ **RED**: `the terminal-analytics exclusion list is ["complete","complete_with_warnings","computing","failed_final"], expected exactly [… "failed"]` — `1 failed \| 10 passed` | — |
| N9 | marker contract, **SQL** half | `jsonb_build_object('source',` → `('src',` | pytest REDs | ✅ **RED**: `the sweep body does not stamp the 'source' metadata KEY.` | — |
| N9b | marker contract, **Python** half | `_meta.get("source")` → `_meta.get("origin")` | pytest REDs | ✅ **RED**: `main_worker.dispatch_tick() no longer reads the 'source' key…` | — |
| N9c | marker contract, **Python** value | `== "reconcile-sweep"` → `== "reconcile_sweep"` | pytest REDs | ⛔ **GREEN — a real vacuity, see below.** Re-run after the fix: ✅ **RED**. | — |

Plus the three **anti-vacuity guards** in `_sweep_cron_body()`, each observed firing by re-pointing `_SWEEP_MIGRATION_NAME` and restoring from a saved copy:

| Guard | Pointed at | Observed |
|---|---|---|
| file exists | `99999999999999_does_not_exist.sql` | ✅ `the JOB-04 sweep migration is missing at …must move in the SAME commit (P-7)` |
| `$cron$` block present | `20260405061911_initial_schema.sql` | ✅ `…has no $cron$...$cron$ block` |
| extraction not vacuous | `20260803130000_reaper_limit_bound_materialized_cte.sql` (has a `$cron$` body, wrong content) | ✅ `extracted $cron$ body does not contain the healing INSERT — the extraction is broken, so the assertions below prove nothing` |

## ⛔ The vacuity the campaign found in this plan's own gate

`TestReconcileSweepMarkerContract` was committed in `a74b3e46` asserting that the string `"reconcile-sweep"` appeared somewhere in `dispatch_tick`'s source. **Changing the load-bearing comparison to `== "reconcile_sweep"` left it GREEN** — because the emission also passes the same string as a Sentry tag (`scope.set_tag("surface", "reconcile-sweep")`), and that cosmetic line satisfied the check by itself. The tag decorates an event; the comparison decides whether an event is emitted at all.

Fixed in `f62c3866` to pin `== "reconcile-sweep"`, re-run under the identical neuter, **RED**. The reason is written into the test as a comment so the looser form is not "simplified" back in.

This is the standing rule working: the neuter was run, the predicted RED did not appear, and that was treated as a finding rather than quietly recorded as a pass.

## Body-scoping: proven from what was already true, then re-confirmed

The plan asked for a staged experiment (append a rejected token as prose, re-run, still green). The stronger proof was already sitting there:

| Token | occurrences in the migration **file** | occurrences in the `$cron$` **body** |
|---|---|---|
| `computed_at` | 4 | 0 |
| `updated_at` | 5 | 0 |
| `enqueue_compute_job` | 6 | 0 |
| `SECURITY DEFINER` | 3 | 0 |

All four are forbidden by body-scoped negative anchors and all four are legitimately discussed at length in the header — so **the gates being green is itself the proof**; a whole-file grep would be red right now. The staged probe was then run anyway for the two tokens *not* already present (`CREATE FUNCTION` and an `IN (SELECT … LIMIT)` shape appended as a comment): both gates stayed green, and the migration was restored byte-identical from committed text.

## Deviations from Plan

**1. [Escalated — the plan specified a gate Plan 02 had proven vacuous] Part 3's framing.**
The plan's Task 1 called Part 3 the SC#2/D-10 idempotency proof ("two EXECUTEs → exactly one job row"). Plan 02's MEASURED CORRECTION 1 says that shape cannot fail. Part 3 was written — a second tick must never double-enqueue, and it also pins that the row is not delete-and-reinserted, which the count alone would miss — but the file **labels it a DOUBLE-MUTATION observable** and enumerates the three single-neuter outcomes in its header. Both single neuters (N6, N7) were executed to confirm the labelling rather than trusted. Nothing in the file claims Part 3 proves `ON CONFLICT DO NOTHING`.

**2. [Escalated — two of the plan's nine predicted REDs are false] Neuters (6) and (7).**
Executed as written; both GREEN in isolation, independently reconfirming 143-02's corrections 1 and 3. Substitutes that *do* redden were added and observed (N6b, N7b). N7b is the real bound proof and the row that matters: **no amount of grepping for `AS MATERIALIZED` detects a missing `LIMIT`** — only executing the deployed body against LIMIT+1 rows does, which is the whole D-19 lesson.

**3. [Not rule-triggered — method] The neuter campaign had to be re-run per-part.**
See the ⚠️ note above the table. Six of eight whole-file REDs landed in Part 1's text anchors, which under `ON_ERROR_STOP=1` abort the file. Recording those as the arms' REDs would have been precisely the "asserted, not observed" failure the plan forbids.

**4. [Rule 3 — blocking issue, auto-fixed before the first commit] The gate header would have made the gate refuse itself.**
The first draft named the four psql meta-commands the `sql-tests` preflight rejects, in prose explaining that the file contains none of them. The preflight (`ci.yml:951-1000`) scans the **whole file, comments included**, and its patterns matched three of those mentions. Caught by running the preflight greps verbatim before committing; the paragraph now describes the rule and points at `ci.yml` without spelling any token. This is the mirror image of Plan 02's own prose-hygiene incident, and both are now recorded in the file.

**5. [Not rule-triggered — tooling] The throwaway harness needed a local addendum.**
Plan 02's `143-throwaway-harness.sql` models `api_keys` and `strategy_keys` minimally (only what the predicate reads). Plan 03's composite arm is written against the **real** schema, which has NOT NULL `owner_id`/`window_start`/`seq` plus a SECURITY DEFINER owner-coherence trigger. Rather than weaken the gate to fit the harness — which would mean proving a different file from the one CI runs — a throwaway addendum in the scratchpad raises both stub tables to the real column set and installs the real trigger. The addendum is **not committed**; the harness is untouched.

**6. [Not rule-triggered — beyond the plan] Three extra neuters.**
N9b and N9c neuter the **Python** half of the cross-language contract, which the plan's neuter (9) did not cover — and N9c is what found the vacuity. N1a/N1b split the plan's neuter (1) into its two distinct REDs. A contract gate that only ever neuters one side proves only that side.

**Zero packages installed** (T-143-SC), so no package-legitimacy checkpoint was required.

## ⛔ What Is NOT Covered — stated plainly

1. **The cron role's RLS posture (T-143-02 / L-2).** `compute_jobs` carries `FORCE ROW LEVEL SECURITY` + deny-all. The `sql-tests` job connects as the psql user; the harness has no RLS at all. **No CI gate can produce this evidence.** One real tick on TEST inspected in `cron.job_run_details` is the only proof — Plan 04, blocking.
2. **Concurrent-race behaviour.** `ON CONFLICT DO NOTHING` and `FOR UPDATE SKIP LOCKED` need two sessions to falsify. `supabase/tests/*.sql` runs in one. What is gated is their **deletion** (Part 1 anchors, both observed RED); their **behaviour** rests on the offline three-case READ COMMITTED experiment in 143-02-SUMMARY.md, which is a measurement and not a gate. Part 3's header says so in the file.
3. **Real-schema behaviour.** Parts 2–4 have run only against the harness + addendum: no RLS, no real scheduler, no `compute_jobs_set_updated_at_trigger`, minimal table shapes. The real-schema run is CI `sql-tests` **after** Plan 04 applies.
4. **That the sweep alert reaches Sentry.** `SENTRY_DSN` on the worker's Railway service is still unverified (Plan 01 coverage D4). This plan pins the contract's two halves to each other; it cannot make a DSN exist.

## Known Stubs

**None.** No hardcoded empty values, no placeholder text, no TODO/FIXME introduced, no template artifacts. `grep -rn MUTANT` over `supabase/`, `src/` and `analytics-service/` → **0**.

The one thing incomplete by design is the SQL gate's Part 1 RED on the PR's first `sql-tests` run. That is not a stub — it is the plan's stated success criterion, and Plan 04 clears it by applying the migration to TEST.

## Verification Run

| Check | Command | Result |
|---|---|---|
| SQL gate, intact harness | `psql -v ON_ERROR_STOP=1 -f supabase/tests/test_reconcile_dropped_enqueue_sweep.sql` | ✅ `PSQL_EXIT=0`, all four Part-OK notices |
| CI preflight, verbatim | the four `grep -nE` patterns from `ci.yml:951-1000` | ✅ `bad=0` |
| Plan Task 1 verify | the plan's `bash -c` structural check | ✅ exit 0; 3 `BEGIN` / 3 `ROLLBACK` / 3 `SET LOCAL` statements (the `grep -c` of 4 and 5 includes header prose) |
| TS gate | `npx vitest run src/__tests__/reconcile-dropped-enqueue-sweep.test.ts` | ✅ `11 passed` |
| eslint on the new TS file | `npx eslint src/__tests__/reconcile-dropped-enqueue-sweep.test.ts` | ✅ exit 0 |
| pytest, plan-scoped | `cd analytics-service && python3 -m pytest tests/test_main_worker.py -q` | ✅ `60 passed` (59 baseline + 1 new) |
| **Full analytics-service suite** | `cd analytics-service && python3 -m pytest -q` | ✅ `5178 passed, 96 skipped in 120.84s` (5177 baseline + 1 new) |
| **Full vitest suite** | `npx vitest run` | ✅ `782 files passed, 19 skipped; 11864 tests passed, 287 skipped in 173.32s` — no `--no-file-parallelism` needed |
| `mypy --strict` (test file) | `python3 -m mypy --strict --follow-imports=silent tests/test_main_worker.py` | ✅ `61 errors` — **identical to the HEAD baseline** (same errors, line numbers shifted by the one added import). Zero new, zero new type-ignore. |
| `mypy --strict` (worker) | `python3 -m mypy --strict --follow-imports=silent main_worker.py` | ✅ `9 errors` — identical to Plan 01's recorded baseline; this plan did not modify it |
| Tree clean after every restore | `git status --short` | ✅ empty before the final green run |

All pytest runs were executed **from `analytics-service/` using `python3`** (a repo-root run misses the VCR cassettes and would make live broker calls).

⚠️ **Local Node is 25.8.1; CI runs Node 22.** A CI-only vitest failure would not automatically be a flake. The gate is pure `node:fs` + `node:path` text work with no version-sensitive surface, so the risk is low — but it is untested on 22 and recorded as such rather than assumed.

⛔ **The migration was NOT applied to TEST or PROD.** `supabase db push` was never run and the Supabase MCP `apply_migration` was never called. The only database touched is a throwaway local Postgres 16 cluster in the scratchpad, since stopped. **Plan 04 owns application.**

## Threat Flags

None. The three files introduce no network endpoint, no auth path, no schema change and no new file-access pattern beyond reading `supabase/migrations/*.sql` from the repo. Threat-model dispositions discharged: **T-143-03** (arm D1 + N2 observed), **T-143-04** (arm E + N4 observed), **T-143-13** (per-part BEGIN/ROLLBACK, identity-scoped assertions, century-backdated seeds, zero cross-tenant UPDATEs), **T-143-14** (zero meta-commands, preflight run verbatim), **T-143-15** (anti-vacuity guards on every extraction, all three observed firing; Part 1 deliberately ungated; every neuter observed, including the two that did not redden and the one that found a vacuity), **T-143-SC** (zero packages installed). **T-143-02 remains OPEN and is Plan 04's**, exactly as the plan assigned it.

## Self-Check: PASSED

Files:
- `supabase/tests/test_reconcile_dropped_enqueue_sweep.sql` — FOUND
- `src/__tests__/reconcile-dropped-enqueue-sweep.test.ts` — FOUND
- `analytics-service/tests/test_main_worker.py` — FOUND (modified; `TestReconcileSweepMarkerContract` present, 60 tests collected)

Commits (verified present in `git log`):
- `d38c6f12` — `test(143-03): CI-visible SQL gate executing the deployed JOB-04 sweep body` — FOUND
- `a74b3e46` — `test(143-03): migration-content gate + cross-language marker contract for JOB-04` — FOUND
- `f62c3866` — `fix(143-03): pin the marker COMPARISON, not the bare literal — the neuter found it` — FOUND

Other:
- Post-commit deletion check across all three commits — **zero deleted files**.
- `grep -rn MUTANT` over `supabase/`, `src/`, `analytics-service/` — **0**.
- `.planning/STATE.md` frontmatter `progress:` block — see the note in the state-update section below; diffed before and after every `state.*` call.
