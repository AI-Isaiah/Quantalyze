---
phase: 143-job-dropped-enqueue-reconciliation-sweep
plan: 02
subsystem: database
tags: [supabase, migration, pg_cron, plpgsql, job-queue, reconciliation, census]

# Dependency graph
requires:
  - phase: 142-strategy-analytics-stuck-computing-reaper
    provides: "the migration template (header discipline, fail-loud pg_cron gate, self-verify-the-deployed-body pattern), the MATERIALIZED-CTE bound shape from its D-19 follow-up, and the non-racing split by computation_status"
  - phase: 143-job-dropped-enqueue-reconciliation-sweep/plan-01
    provides: "the Python half of the metadata marker contract — main_worker.py reads {source: 'reconcile-sweep', detected_at}; this plan writes it"
provides:
  - "supabase/migrations/20260816140000_reconcile_dropped_enqueue_sweep.sql — the ONE migration of the phase: cron job `reconcile_dropped_enqueue_sweep`, '35 * * * *', 1-hour grace, LIMIT 25, inline body, zero DDL"
  - "The SQL half of the cross-language marker contract: jsonb_build_object('source','reconcile-sweep','detected_at',now())"
  - ".planning/phases/143-.../143-CENSUS.md — TEST+PROD candidate counts, re-base freshness verdicts, CI-workflow verdicts, STOP-rule evaluation"
  - ".planning/phases/143-.../143-throwaway-harness.sql — stub schema + fake pg_cron for offline end-to-end proof (reusable by Plan 03)"
  - "Three MEASURED mechanism corrections that change how Plan 03's gates must be written (see key-decisions)"
affects: [143-03 SQL/TS gates must not use the vacuous double-execute proof, 143-04 owns TEST apply + the live tick that alone proves the cron role's RLS posture, 144-orphaned-running-compute-jobs, 145-csv-finalize-atomicity]

actuals:
  tokens: 21849      # chars/4 over the realized diff (87,396 chars across the 3 files)
  tasks: 3
  commits: 3

tech-stack:
  added: []          # ZERO packages installed (T-143-SC)
  patterns:
    - "Offline deployed-body proof harness: stub schema + a cron.job table + cron.schedule/unschedule functions that upsert, so a migration can be APPLIED and its DEPLOYED command EXECUTED against real rows on a throwaway cluster — the only thing that falsifies a bound (grep gates cannot)"
    - "Fail-loud gate observed by construction: keep the faked pg_extension row OUT of the harness so the migration's pg_cron-absent RAISE can be observed RED before it is faked in"
    - "Anti-vacuity guard on every $cron$-body extraction — it caught a real defect where header prose formed a false delimiter pair"

key-files:
  created:
    - supabase/migrations/20260816140000_reconcile_dropped_enqueue_sweep.sql
    - .planning/phases/143-job-dropped-enqueue-reconciliation-sweep/143-CENSUS.md
    - .planning/phases/143-job-dropped-enqueue-reconciliation-sweep/143-throwaway-harness.sql
  modified: []

key-decisions:
  - "⭐ MEASURED CORRECTION 1 — SC#2 'run twice = no-op' is delivered by the PREDICATE, not by ON CONFLICT DO NOTHING. Tick 1's INSERT gives the strategy a compute_jobs row, which removes it from the zero-jobs conjunct, so tick 2's batch is empty and the INSERT is never reached. With ON CONFLICT deleted, a second sequential tick STILL raises nothing. CONTEXT/RESEARCH/PLAN all attribute SC#2 to the partial unique index; that is not the operative mechanism. ⚠️ Consequence for Plan 03: a gate that proves ON CONFLICT by executing the body twice in one session is VACUOUS."
  - "⭐ MEASURED CORRECTION 2 — FOR UPDATE SKIP LOCKED is the FIRST line of race defense, not merely a bound helper (RESEARCH explicitly said it was 'NOT about correctness'). An INSERT into compute_jobs takes an FK KEY SHARE lock on its parent strategies row, which conflicts with the batch's FOR UPDATE, so the sweep SKIPS a strategy the live enqueue path is mid-insert on. ON CONFLICT DO NOTHING is the second line and IS load-bearing: with SKIP LOCKED removed the sweep blocks on the FK lock, meets the committed row, and ON CONFLICT absorbs it. Removing BOTH is the only combination that produces 23505 at READ COMMITTED."
  - "⭐ MEASURED CORRECTION 3 — AS MATERIALIZED does not create the bound in THIS shape. Removing it still heals 25 of 26 and EXPLAIN is BYTE-IDENTICAL, because Postgres does not inline a CTE carrying a locking clause. D-19's 26-of-26 was a different shape (correlated IN-subquery re-executed per outer row); this body feeds INSERT ... SELECT FROM batch and scans the CTE once. Keyword and its self-verify gate RETAINED, but relabelled SHAPE enforcement — the bound is proven ONLY by executing against LIMIT+1 rows."
  - "DX-05 composite exclusion via NOT EXISTS strategy_keys, NOT via strategies.api_key_id IS NULL (CSV single-key strategies also have it NULL, so that discriminator would over-exclude the population being healed)."
  - "DX-06 status gate: exclude 'archived' only, include 'draft'. ⚠️ The census could NOT adjudicate this — the candidate population is empty so its status breakdown is vacuous. Recorded as resting on reasoning, not evidence."
  - "Grace anchor = MAX(csv_daily_returns.created_at), pinned POSITIVELY in the self-verify (2 required reads) rather than by a negative token gate on 'created_at', because that token is a substring of the legitimate dailies reference — a collision hazard."

patterns-established:
  - "Pattern 1: when a planned neuter does NOT produce its predicted RED, that is a FINDING about the causal model, not a pass. Both surviving neuters here were escalated into mechanism probes (a two-session race at two isolation levels; an EXPLAIN diff) until the real mechanism was measured, then the migration header was corrected to stop asserting the falsified claim."
  - "Pattern 2: prose in a migration header can BREAK a downstream gate, not just trip it. Writing the cron dollar-tag three times in the header made a non-greedy extraction regex match the prose pair and return a comment span with no INSERT — under which every negative assertion would have passed vacuously. The anti-vacuity guard is what caught it; the header now forbids writing that tag in a comment."

requirements-completed: []   # JOB-04 is NOT complete — this plan authors only; 143-03 gates it and 143-04 applies it

coverage:
  - id: D1
    description: "A strategy with dailies, zero compute_jobs rows of any kind/status, no terminal strategy_analytics row, past a 1-hour grace, gets exactly one pending compute_analytics_from_csv job carrying metadata.source='reconcile-sweep' (SC#1 detect half)"
    requirement: "JOB-04"
    verification:
      - kind: other
        ref: "throwaway PG16 cluster: apply harness + migration, seed one century-backdated orphan, EXECUTE the DEPLOYED cron.job command -> healed=1, marker=reconcile-sweep, status=pending, detected_at present"
        status: pass
    human_judgment: false
  - id: D2
    description: "In-grace, any-job-row (running/failed_final/done), terminal-analytics (complete/cww/failed), computing, composite and archived strategies are NEVER touched (SC#3)"
    requirement: "JOB-04"
    verification:
      - kind: other
        ref: "12 identity-scoped directional arms (A, A2, B, C1-C3, D1-D4, E, F) driven through the DEPLOYED body; every untouched arm asserted on ZERO marker-carrying rows for its own strategy id"
        status: pass
    human_judgment: false
  - id: D3
    description: "The per-tick heal count is bounded at 25 and the batch still drains (SC#2 bound)"
    requirement: "JOB-04"
    verification:
      - kind: other
        ref: "arm H: 26 staggered century-old candidates -> tick 1 heals exactly the 25 oldest, youngest untouched; tick 2 heals the 26th"
        status: pass
    human_judgment: false
  - id: D4
    description: "Running the sweep twice produces no duplicate job (SC#2 idempotency)"
    requirement: "JOB-04"
    verification:
      - kind: other
        ref: "arm G: two EXECUTEs of the deployed body -> exactly 1 job row for arm A; plus the three-case READ COMMITTED race establishing which clause protects what"
        status: pass
    human_judgment: false
  - id: D5
    description: "The migration is CI-gated in a way that can actually fail — SQL gate + TS content gate"
    verification: []
    human_judgment: false
    rationale: "NOT this plan's scope. Plan 03 owns supabase/tests/test_reconcile_dropped_enqueue_sweep.sql and the TS content gate. Nothing in this plan runs in CI yet."
  - id: D6
    description: "The pg_cron job ROLE can actually INSERT into compute_jobs through FORCE ROW LEVEL SECURITY + the deny-all policy (landmine L-2 / RESEARCH A2)"
    verification: []
    human_judgment: true
    rationale: "STRUCTURALLY unprovable here and unprovable by any CI gate. The throwaway harness has no RLS; the sql-tests job connects as the psql user, not the cron role. The ONLY evidence is a real tick on TEST inspected in cron.job_run_details — Plan 04 owns it as a BLOCKING pre-merge item. The census could not even read the catalog: PostgREST returns HTTP 404 PGRST205 for cron.job on both projects. Until that tick, the write path is UNPROVEN and this plan does not claim otherwise."
  - id: D7
    description: "RAISE NOTICE from a plpgsql DO block inside a cron body actually reaches cron.job_run_details.return_message on this Supabase build"
    verification: []
    human_judgment: true
    rationale: "UNVERIFIED and labelled as such in the migration header rather than asserted. It is the documented behaviour and 142 relies on it, but nobody has looked. Plan 04's live tick discharges it."

# Metrics
duration: 26min
completed: 2026-08-16
status: complete
---

# Phase 143 Plan 02: Dropped-Enqueue Reconciliation Sweep Migration Summary

**The JOB-04 sweep now exists as one inline pg_cron body that detects, by absence, the strategies whose `after()` enqueue never ran and heals them with a bounded idempotent INSERT — authored, census-backed and proven end-to-end offline, and along the way three of the phase's own stated mechanism claims were falsified by measurement and corrected rather than shipped.**

## Performance

- **Duration:** 26 min (first commit 22:59:51 → final 23:25:23, 2026-08-16)
- **Tasks:** 3 / 3
- **Commits:** 3 task commits (+1 docs commit)
- **Files changed:** 3 created, 0 modified

**`actuals.tokens` basis:** `21849` is chars/4 over the **realized diff** (87,396 chars across the three created files), per the template rule. The plan's `estimate.tokens` was 90,000 at `confidence: low` with 0 calibration samples. On the diff scale this plan came in at ~24% of estimate; measured on the full text of the files touched the two scales coincide here because all three files are new. Recorded unrounded so the next calibration compares like with like.

## ⛔ What This Plan Did NOT Do

The migration is **AUTHORED ONLY**. It was never applied to TEST (`qmnijlgmdhviwzwfyzlc`) or PROD (`khslejtfbuezsmvmtsdn`), `supabase db push` was never run, and the Supabase MCP `apply_migration` was never called. The only database it touched is a throwaway local Postgres 16 cluster in the scratchpad. **Plan 04 owns application.** Merging `supabase/migrations/**` to `main` auto-applies to PROD, so nothing here should be merged before Plan 03's gates and Plan 04's live TEST tick.

## What Was Built

### 1. `supabase/migrations/20260816140000_reconcile_dropped_enqueue_sweep.sql`

One cron job, zero DDL. The executable surface of the whole file, with comments stripped, is **160 lines**: `BEGIN;` / `SET lock_timeout` / one `DO $$` that schedules / one `DO $$` that self-verifies / `COMMIT;`. Grepping the non-comment lines for `CREATE FUNCTION|SECURITY DEFINER|CREATE POLICY|CREATE VIEW|GRANT|REVOKE|CREATE TRIGGER|CREATE INDEX|ALTER TABLE|ADD COLUMN|EXECUTE format` returns **0**.

The predicate, five conjuncts, each annotated clause-by-clause above the `cron.schedule` call:

| Conjunct | Purpose |
|---|---|
| `s.status <> 'archived'` | hygiene; `'draft'` deliberately INCLUDED (a drop victim may sit pre-terminal *because* nothing advanced it) |
| `EXISTS` dailies | D-01, source-agnostic — `csv_daily_returns` is the single canonical store post-v1.10 |
| `NOT EXISTS` **ANY** `compute_jobs` row | D-02. Kind-scoping would re-enqueue a healthy mid-chain `derive_broker_dailies` |
| `NOT EXISTS` analytics at four statuses | **THE safety conjunct.** Enumerating the excluded four defaults a future sixth CHECK value to EXCLUDED |
| `NOT EXISTS` `strategy_keys` member | composite exclusion — money safety, not optimization |
| `MAX(dailies.created_at) < now() - interval '1 hour'` | the grace window, evaluated LAST on survivors only (no index on `created_at`, and none added) |

Bound and write: `WITH batch AS MATERIALIZED (... ORDER BY the dailies MAX ASC, LIMIT 25, FOR UPDATE SKIP LOCKED)` then `INSERT INTO public.compute_jobs (strategy_id, kind, metadata) SELECT ... ON CONFLICT DO NOTHING`, then `GET DIAGNOSTICS` + a single-literal `RAISE NOTICE` carrying **a count and nothing else**.

The header reproduces 142's 14 sections in order and carries: the measured census, the empirical D-03 confirmation, both known non-coverages, the no-in-repo-precedent disclosure for the INSERT arm, the FORCE-RLS gap only a live tick can close, the invariant-#14 pre-documentation, and the 13 vacuously-satisfied invariants named explicitly rather than left for the reviewer to infer.

Self-verify (STEP 2) reads the body back out of `cron.job` and asserts: exactly one job, `'35 * * * *'` by **string** equality, 12 positive anchors, exactly 1 `AS MATERIALIZED`, exactly 2 reads of the grace anchor, and 4 negatives (`computed_at`, `updated_at`, the enqueue RPC, the IN-SELECT-LIMIT shape). Every failure message names the consequence, not the missing token.

### 2. `143-CENSUS.md` — and why "0" is a finding

**Method substitution recorded loudly (142-04 precedent):** the Supabase MCP was **not** in this executor session's tool set, so the census ran over service-role PostgREST with the predicate evaluated client-side. Counts and `content-range` headers only; no key, token or connection string appears in the artifact.

| Measure | TEST | PROD |
|---|---|---|
| HEADLINE candidates | **0** | **0** |
| STOP rule | `>200` → not fired | `>10` → not fired |
| composites among candidates | 0 | 0 |

A headline of 0 is also what a *broken* census produces, so it was decomposed:

| Step | TEST | PROD |
|---|---|---|
| strategies with any dailies | 1 | 8 |
| …with **zero** `compute_jobs` rows | 1 | 4 |
| …protected **only** by the terminal-analytics conjunct | **1** | **4** |
| …absent-or-`pending` ⇒ true candidates | 0 | 0 |

**D-03 is therefore empirically confirmed, not merely argued: on PROD, 4 of 4 zero-job strategies-with-dailies are excluded solely by that one conjunct.** Deleting it turns a 0-row first tick into a 4-row mass re-enqueue *today*, growing as the corpus ages past the 30-day `retention_compute_jobs_done` window.

Also recorded: re-base freshness re-derived by grepping ALL migrations (index `20260416125430:156`, coherence CHECK `20260717233529:168`, status CHECK `20260602120000:46` — all latest, no STOP); migration tip `20260814120000` so the filename stands; `sql-function-snapshot.yml` measured as a no-op (self-test PASS, `--check` PASS at 111 functions, before *and* after the migration landed on disk); `migration-drift-check.yml` runs but imposes no content constraint.

### 3. `143-throwaway-harness.sql`

Stub schema with every constraint the INSERT must satisfy copied **verbatim** from the real schema (status CHECK, priority CHECK, the 4-way `compute_jobs_target_xor`, the latest `compute_jobs_kind_target_coherence`, the CURRENT partial unique index, the 5-value `computation_status` CHECK, the 5-value `strategies.status` CHECK, the dailies source-xor), plus a `cron` stub whose `cron.schedule` upserts by name exactly as pg_cron does — so every gate reads the DEPLOYED command rather than a retyped copy. Its header states the fidelity limits plainly: no RLS, no triggers, no real pg_cron, therefore **no evidence about landmine L-2**.

The faked `pg_extension` row is deliberately **not** in the harness, so the fail-loud gate can be observed RED first.

## Observed-Arm Table

Every row below was **executed** against the DEPLOYED body extracted from `cron.job`, never a retyped predicate. Untouched arms are asserted identity-scoped (zero marker-carrying rows for *that* strategy id), never on global counts.

| Arm | Seed | Expected | Observed |
|---|---|---|---|
| A | orphan past grace, analytics ABSENT | HEALED | ✅ HEALED, `status=pending`, `kind=compute_analytics_from_csv`, `metadata.source=reconcile-sweep`, `detected_at` present |
| A2 | analytics row at `pending` | HEALED (D-04) | ✅ HEALED |
| B | dailies stamped `now()` (in grace) | untouched | ✅ untouched |
| C1 | a **running** `derive_broker_dailies` job | untouched (D-02 ANY-kind) | ✅ untouched |
| C2 | only a `failed_final` job | untouched | ✅ untouched |
| C3 | only a `done` job | untouched | ✅ untouched |
| D1 | analytics `complete` | untouched (D-03) | ✅ untouched |
| D2 | analytics `complete_with_warnings` | untouched | ✅ untouched |
| D3 | analytics `failed` | untouched | ✅ untouched |
| D4 | analytics `computing` (142's reaper's row) | untouched (D-04 non-racing split) | ✅ untouched |
| E | `strategy_keys` member (composite) | untouched (DX-05) | ✅ untouched |
| F | `status = 'archived'` | untouched (DX-06) | ✅ untouched |
| G | run the body **twice** | still exactly 1 job row for A | ✅ 1 row (tick 1 healed 2, tick 2 healed 0) |
| H | 26 staggered century-old candidates | tick 1 = 25 oldest, youngest untouched; tick 2 = the 26th | ✅ `healed 25` then `healed 1`, 26/26 after two ticks |

Plus the apply-time behaviours:

| Check | Expected | Observed |
|---|---|---|
| pg_cron absent | `RAISE EXCEPTION`, never a silent skip | ✅ `ERROR: JOB-04: pg_cron extension is NOT installed…` and `cron.job` count stayed **0** |
| apply with pg_cron present | exit 0, both self-verify NOTICEs | ✅ both fired |
| re-apply the whole file | still exactly ONE job row | ✅ 1 |

## Gate | Neuter | Expected RED | Observed

⚠️ **Two of the three planned neuters did NOT produce their predicted RED.** Each was escalated into a mechanism probe until the real behaviour was measured, and the migration header was then corrected to stop asserting the falsified claim. Recording these as passes would have been the exact failure this project's standing rule exists to prevent.

| Gate | Neuter | Expected RED | Observed |
|---|---|---|---|
| **SC#3 terminal-analytics** (the mass-re-enqueue tripwire) | drop `'complete'` from the exclusion list in the deployed body | arm D1 gets healed | ✅ **AS PREDICTED.** `healed 1`; arm D1 (analytics `complete`) was enqueued — the mass-re-enqueue signature. Restored from the committed file → `healed 0`, D1 untouched again. |
| **SC#2 idempotency** | replace `ON CONFLICT DO NOTHING` with a bare INSERT, then run the body twice | tick 2 raises `unique_violation` | ⚠️ **DID NOT REDDEN.** `healed 1` then `healed 0`, no error. Probe: after tick 1 the strategy has a job row, so it fails the zero-jobs conjunct — `strategies still passing the conjunct on tick 2: 0`. **Sequential re-run can never conflict; the PREDICATE is what makes it a no-op.** |
| ↳ escalation: the real race, at REPEATABLE READ | competing enqueue commits after the sweep's snapshot | neutered raises, committed survives | ⚠️ **BOTH aborted** — neutered `23505`, committed `40001 could not serialize access`. Not a valid model: pg_cron runs at READ COMMITTED (`SHOW default_transaction_isolation` → `read committed`). |
| ↳ escalation: the real race, at **READ COMMITTED** (3 cases) | (i) as shipped · (ii) `SKIP LOCKED` removed · (iii) **both** removed | isolate which clause protects | ✅ **RED FOUND at (iii).** (i) sweep SKIPS the strategy, no error — an `INSERT` into `compute_jobs` key-share-locks its parent `strategies` row, conflicting with the batch's `FOR UPDATE`. (ii) sweep blocks on that lock, meets the committed row, **`ON CONFLICT DO NOTHING` absorbs it** — no error. (iii) `ERROR: duplicate key value violates unique constraint "compute_jobs_one_inflight_per_kind_strategy"` — the tick dies. |
| **SC#2 bound** (D-19 fence) | replace `AS MATERIALIZED` with a bare `AS` | tick 1 heals 26 of 26 | ⚠️ **DID NOT REDDEN.** Still `healed 25` then `healed 1`. `EXPLAIN` output is **byte-identical** with and without the keyword (`CTE batch → Limit → LockRows → Sort`): Postgres does not inline a CTE carrying a locking clause, so the fence is already implicit. D-19's 26-of-26 was a *correlated `IN (SELECT … LIMIT n)`* re-executed per outer row; this body scans the CTE once via `INSERT … SELECT FROM batch`. |

**What was done about the two non-REDs.** The keyword and its self-verify gate are **retained** (explicit beats implicit; the fence becomes load-bearing the moment a future edit drops `FOR UPDATE`), and `ON CONFLICT DO NOTHING` is **retained** (case (ii) proves it load-bearing). What changed is the *prose*: the header no longer claims "the keyword IS the fix" or that the index delivers SC#2, and the `v_mat` failure message no longer asserts a falsehood. Commit `c57bc7c6`.

**Consequence for Plan 03 — carry this forward:** a SQL gate that "proves" `ON CONFLICT DO NOTHING` by executing the deployed body twice in one session **cannot fail** and must not be written. The falsifiable proofs are (a) arm H for the bound, (b) the three-case READ COMMITTED race for the race clauses, (c) arm D1's neuter for the safety conjunct.

## Review Agent Verdicts

⚠️ **Honest limitation, stated rather than glossed: the two agents could not be SPAWNED.** This executor session has no `Task`/`Agent` tool, so `migration-reviewer` and `rls-policy-auditor` could not be invoked as subagents. Instead both spec files were read in full and their **own mechanical checks were executed verbatim** against the migration. This is a manual application of the specs, not an agent run, and it lacks whatever judgement the agents would have added. **If the orchestrator can spawn subagents, both should still be run on this file before the PR.**

**migration-reviewer — no findings.**

| Invariant | Check | Result |
|---|---|---|
| #1 timestamp filename | `ls \| grep -vE '^[0-9]{14}_.*\.sql$'` | PASS |
| #2 backdated guard | `20260816140000` > tip `20260814120000` | PASS, no allowlist entry needed |
| #11 edit-of-applied-migration | new file; never applied anywhere | PASS — ⚠️ note `git status` shows it as `M` only because Task 3 amended a file Task 2 had already committed **on this feature branch**; the agent's process step 1 would flag that, and it is a false positive |
| #14 BEGIN/COMMIT + session `SET` | `BEGIN;` :468, `SET lock_timeout` :469, `COMMIT;` :784 | **KNOWN DEVIATION**, pre-documented in the header per Rule 11/Rule 7. The only one. No `ROLLBACK` anywhere. |
| #16 template artifacts (CRITICAL) | agent's verbatim `grep -cE '</?(content\|invoke\|function_calls\|antml:\|parameter)'` | **0** |
| #21 single-literal RAISE (CRITICAL) | agent's verbatim awk; then a stricter format-slot parser over 26 RAISE statements | PASS, 0 violations. ⚠️ The naive whole-file form produced **3 false positives on comment prose** discussing `RAISE NOTICE` — a live instance of the grep-hygiene rule; the check must strip comment lines. |
| #15 JSONB | no JSONB column added; the value is `jsonb_build_object` over two fixed literals and `now()`, no caller input | N/A |
| #3, #4, #5, #6, #7, #8, #9, #10, #12, #13, #17, #18, #19, #20 | non-comment surface grep for function/policy/view/index/trigger/column/GRANT/REVOKE/dynamic SQL | **0 matches** — all vacuously satisfied, and named as such in the header |

**rls-policy-auditor — no findings.** Zero `CREATE POLICY` / `ALTER POLICY` / `SECURITY DEFINER` / `auth.uid()` / `auth.role()` / `request.jwt.claims` / `security_invoker` in the executable surface (the 4 grep hits are header prose *about* not creating those). No RLS posture is changed by this migration.

⚠️ **The auditor's BYPASSRLS section is the L-2 frame, and its clean verdict must NOT be read as discharging L-2.** `compute_jobs` carries `FORCE ROW LEVEL SECURITY` + deny-all; whether the pg_cron job role writes through it is a property of *that role*, which no static review and no CI gate can establish. See coverage item D6.

## Deviations from Plan

**[Rule 3 — blocking issue, auto-fixed] The header's own prose broke the body-extraction gate.**
An earlier draft wrote the cron dollar-tag three times in comments. The non-greedy `\$cron\$(.*?)\$cron\$` regex — the one 143-PATTERNS specifies for Plan 03's TS and pytest gates — matched the **prose pair** and returned a span of comments containing no `INSERT`, under which every negative assertion would have passed **vacuously**. Caught only by the anti-vacuity guard in the extraction helper. Prose rewritten to avoid the literal tag; a standing warning and the incident are recorded in the header's *Prose hygiene* section. Commit `6922197f`.

**[Not rule-triggered — measurement contradicting the plan] Three mechanism claims corrected.** Detailed above and in `key-decisions`. The plan, RESEARCH and CONTEXT all attribute SC#2 idempotency to the partial unique index and the bound to the `MATERIALIZED` keyword; neither survived measurement. No behaviour changed — only claims. Commit `c57bc7c6`.

**[Not rule-triggered — census could not answer a question the plan assigned to it] DX-06.** The plan expected the candidate status breakdown to be the evidence for including `draft`/excluding `archived`. The candidate population is empty, so that breakdown is `{}` and proves nothing. Recorded as resting on the L-6 reasoning instead, in both the census artifact and the migration header.

**[Not rule-triggered — tooling] Supabase MCP unavailable**, so the census used the sanctioned PostgREST substitution. Recorded loudly per the 142-04 precedent, including the two census queries (cron role `rolbypassrls`; the cron slot listing) that are **unobtainable** by that method — HTTP 404 `PGRST205` measured on both projects.

**Zero packages installed** (T-143-SC), so no package-legitimacy checkpoint was required.

## Known Stubs

**None in the delivered migration.** No hardcoded empty values, no placeholder text, no unfinished-work markers; the template-artifact scan is clean.

Two things are **incomplete by design and owned elsewhere**, and neither is a stub:

1. **The migration is unapplied.** By design — Plan 04 owns TEST application and the live tick.
2. **No CI gate references this migration yet.** By design — Plan 03 owns `supabase/tests/test_reconcile_dropped_enqueue_sweep.sql` and the TS content gate. Until Plan 03 lands, the only enforcement is the in-migration self-verify (which runs at apply time) and the offline harness (which does not run in CI).

Two documented **non-coverages** of the mechanism itself, both deliberate, both carrying a `.planning/TODOS.md` pointer in the header: the wizard first-hop enqueue drop (no dailies at all, so indistinguishable from a brand-new strategy), and composite strategies (healing them with the CSV kind would corrupt a correct headline).

## Threat Flags

None. The migration introduces no network endpoint, no auth path, no file-access pattern and no schema change. It adds one scheduled writer to an existing table inside an existing trust boundary, which is the surface already registered as T-143-01/03/04/08/12 in the plan's threat model — all `mitigate`, all discharged in the body and the arm harness **except** T-143-02 (cron role vs FORCE RLS), which the plan itself assigns its evidence to Plan 04 and which remains open.

T-143-07 (information disclosure in a PUBLIC repo) was actively checked: the census artifact carries counts and `content-range` headers only, and the `RAISE NOTICE` in the deployed body carries a count with no identifier or row data.

## Self-Check: PASSED

Files:
- `supabase/migrations/20260816140000_reconcile_dropped_enqueue_sweep.sql` — FOUND
- `.planning/phases/143-job-dropped-enqueue-reconciliation-sweep/143-CENSUS.md` — FOUND
- `.planning/phases/143-job-dropped-enqueue-reconciliation-sweep/143-throwaway-harness.sql` — FOUND

Commits (verified present in `git log`):
- `1d36d0d6` — `docs(143-02): pre-authoring verification + read-only TEST/PROD census` — FOUND
- `6922197f` — `feat(143-02): pg_cron dropped-enqueue reconciliation sweep (JOB-04)` — FOUND
- `c57bc7c6` — `fix(143-02): correct two overclaimed mechanism statements the arm smoke falsified` — FOUND

Other:
- Post-commit deletion check on all three commits — **zero deleted files**.
- `grep -rn MUTANT` over the repo — 0 real matches (3 hits are historical prose in `STATE.md` from earlier phases describing their own scans).
- `.planning/STATE.md` frontmatter `progress:` block — **verified byte-identical to `HEAD`** (project-lifetime scope 21/15/95/91/71). ⚠️ `state.record-session` DID clobber it to phase-scoped `4/0/4/1/0`, exactly as the phase's critical rule 10 warned; it was detected by a before/after diff in the same command and restored immediately. The `state.*` handlers remain unsafe for this file.
- Final green run after every edit: apply exit 0, both self-verify NOTICEs, 13/13 arms, bound 25→1, all body-scoped anchors pass, `AS MATERIALIZED` count 1, anchor reads 2.
