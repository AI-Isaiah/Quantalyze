# Phase 143 — Pre-authoring verification + read-only census (Plan 02, Task 1)

**Run:** 2026-08-16
**Scope:** read-only. Nothing was written to any database. No migration was applied anywhere.
**Projects:** TEST `qmnijlgmdhviwzwfyzlc`, PROD `khslejtfbuezsmvmtsdn`

> ⚠️ This repo is PUBLIC and `.planning/` is TRACKED. This file therefore carries **counts and shapes
> only** — no strategy ids, no user ids, no emails, no keys, no tokens, no connection strings.

---

## Method (stated explicitly, 142-04 style)

**Supabase MCP `execute_sql` was NOT available in this executor session.** The tool set exposed to this
agent contained no `mcp__supabase__*` / `mcp__plugin_supabase__*` functions (project-scoped MCP servers are
not inherited by spawned subagents). The primary method named in the plan was therefore unavailable.

**Substitution used: service-role PostgREST reads, computing the predicate client-side** — the sanctioned
fallback, and the same substitution 142-04 recorded. Credentials were read from `.env.test.local` (TEST) and
`.env.local` (PROD) by a scratchpad script that loads them into memory and prints **counts only**; no key was
ever echoed, logged, or written to disk outside the process.

Mechanics:

- `GET /rest/v1/<table>?select=...` with `Prefer: count=exact` + `Range: 0-0` for total-row evidence
  (the `content-range` response header is pasted verbatim below).
- Full id-projections pulled with 1000-row pagination for `strategies(id,status)`,
  `strategy_analytics(strategy_id,computation_status)`, `compute_jobs(strategy_id)` and
  `strategy_keys(strategy_id)`.
- Per-survivor existence probes on `csv_daily_returns?strategy_id=eq.<id>&limit=1`.
- The predicate (RESEARCH `## Environment Availability` query 1) was then evaluated **in JS**, not in SQL.

**What this substitution cannot do — stated rather than glossed:**

- RESEARCH census query **(5)** (`SELECT j.jobname, j.username, r.rolbypassrls, r.rolsuper FROM cron.job j
  JOIN pg_roles r ...`) and query **(6)** (`SELECT jobid, jobname, schedule, active FROM cron.job`) are
  **UNOBTAINABLE by this method**. PostgREST resolves names in exposed schemas only; the `cron` schema and
  `pg_catalog` are not exposed. Measured, not assumed:
  - `GET /rest/v1/job` → **HTTP 404** `{"code":"PGRST205", ... "Could not find the table 'public.job'"}` on both projects.
  - `GET /rest/v1/job_run_details` → **HTTP 404** `PGRST205` on both projects.
  - (`public.cron_runs` DOES resolve — HTTP 200 — but it is an unrelated **application** table written by the
    Next.js match-engine route, not `cron.job_run_details`. It is not a substitute and was not used as one.)
- **Consequence:** landmine **L-2** (does the pg_cron job role bypass `compute_jobs`' FORCE-RLS deny-all?)
  is **NOT discharged by this census** and must not be read as discharged. It remains exactly where RESEARCH
  A2 put it: the only proof is a REAL tick on TEST inspected in `cron.job_run_details`, which **Plan 04**
  owns as a blocking pre-merge item.
- **pg_cron presence** on TEST/PROD is likewise INFERRED, not measured here: migration `20260802120000`
  (Phase 142) carries the same fail-loud `RAISE EXCEPTION ... feature_not_supported` gate this migration
  will carry, and it has been applied to PROD (merge to `main` auto-applies). If pg_cron were absent, that
  apply would have failed. Sound inference; recorded as inference.

---

## (1) Re-base freshness — the standing grep-ALL-migrations rule

All three targets were re-derived this session by grepping **every** file under `supabase/migrations/`.

| Object | Latest definition found | Expected (per RESEARCH) | Verdict |
|---|---|---|---|
| `compute_jobs_one_inflight_per_kind_strategy` | `supabase/migrations/20260416125430_contact_request_metadata.sql:156` | `20260416125430:156` | ✅ **FRESH** — no newer definition |
| `compute_jobs_kind_target_coherence` | `supabase/migrations/20260717233529_allocator_equity_derived_surface.sql:168` | `20260717233529:168-181` | ✅ **FRESH** — no newer definition |
| `strategy_analytics.computation_status` CHECK | `supabase/migrations/20260602120000_strategy_analytics_computation_status_add_complete_with_warnings.sql:46` | `20260602120000:46` | ✅ **FRESH** — no newer definition |

**No STOP fired.** Detail:

- `compute_jobs_one_inflight_per_kind_strategy` has exactly **two** definition sites repo-wide:
  `20260411144407:179` (ORIGINAL, explicitly `DROP INDEX IF EXISTS`-ed at `20260416125430:154`) and
  `20260416125430:156` (CURRENT). Every one of the other 11 hits is a comment or a sibling-index `COMMENT ON`
  (`20260418194206:147,157`, `20260420073003:294`, `20260528061155:14,141,318`, `20260601193000:169`,
  `20260603120000:88,256`, `20260719073701:141`, `20260411144407:972`, `20260416125430:162,267`). Current
  definition read verbatim this session:

  ```
  CREATE UNIQUE INDEX compute_jobs_one_inflight_per_kind_strategy
    ON compute_jobs (strategy_id, kind)
    WHERE strategy_id IS NOT NULL
      AND kind <> 'compute_intro_snapshot'
      AND status IN ('pending', 'running', 'done_pending_children');
  ```

- `compute_jobs_kind_target_coherence` has 14 `ADD CONSTRAINT` sites; the newest 14-digit prefix is
  `20260717233529`. (`supabase/migrations/down/*-rollback.sql` sites are rollback artifacts, not forward
  definitions, and `20260420073003:1127` is commented-out.) The arm this migration's INSERT must satisfy,
  read verbatim: `((kind = ANY (ARRAY[... 'compute_analytics_from_csv' ...])) AND (strategy_id IS NOT NULL)
  AND (portfolio_id IS NULL) AND (allocator_id IS NULL))`. A strategy-scoped `compute_analytics_from_csv`
  INSERT with the other target columns defaulting to NULL satisfies it.

- `computation_status`: the two older 4-value CHECKs (`20260405061911:74`, `20260407075303:31` — the latter
  is `portfolio_analytics`, a different table) are superseded by the 5-value CHECK at `20260602120000:46`.
  The two hits in `20260712120000` are predicates in a trigger body, not CHECK definitions.

---

## (2) Migration tip — DX-01 filename verdict

Repo tip on disk, newest 8:

```
20260806120000_strategies_capital_ownership.sql
20260806130000_seed_weight_snapshot_secdef.sql
20260808120000_strategies_user_id_index.sql
20260810120000_lock_api_keys_exchange_column.sql
20260811210000_api_keys_attested_venue.sql
20260812083206_api_keys_venue_account_id.sql
20260813150106_wizard_rpcs_service_role_writer.sql
20260814120000_wizard_rpcs_revoke_authenticated.sql   <-- TIP
```

`20260816140000` > `20260814120000`. ✅ **DX-01's planned filename stands unchanged; no bump needed.**
`20260816140000_reconcile_dropped_enqueue_sweep.sql` satisfies `migration-policy.yml`'s newer-than-remote-tip
rule (`:190-272`), which compares the 14-digit prefix of each **newly added** file against a freshly-queried
`MAX(version) FROM supabase_migrations.schema_migrations`. (The workflow queries the REMOTE tip at PR time,
so the on-disk tip is a lower bound, not the authority — but the on-disk tip is `20260814120000` and PROD
cannot be ahead of the repo without tripping `migration-drift-check.yml` first.)

---

## (3) CI workflow verdicts (RESEARCH A7 — both were UNREAD at research time; both read this session)

| Workflow | Triggers on `supabase/migrations/**`? | Effect on a cron-only migration (no function, no DDL) | Verdict |
|---|---|---|---|
| `.github/workflows/sql-function-snapshot.yml` | yes (`pull_request` + `push` to main, `paths: supabase/migrations/**`) | Runs `npx tsx scripts/dump-sql-functions.ts --check`. **SCOPE is functions only** — stated in its own header: *"SCOPE: functions only. Tables/columns/policies/triggers evolve via incremental ALTERs that text-replay can't reconstruct"*. It text-replays `CREATE OR REPLACE FUNCTION` bodies into `supabase/schema/functions/<name>.sql` and fails if the committed snapshot is stale. This migration creates **no function**, so it contributes nothing to the replay. | **Expected NO-OP — and VERIFIED by running it, not assumed.** See "(3a) measured" below. |
| `.github/workflows/migration-drift-check.yml` | yes (`pull_request` to main, `paths: supabase/migrations/**`) | Runs `supabase db push --include-all --dry-run` against the linked PROD project, then requires that every pending timestamp in the dry-run output be one this PR **added**. It applies nothing (`--dry-run`). A newly added, never-applied migration is exactly the expected shape. | **WILL RUN, and is expected GREEN** provided no pre-existing drift. It is a repo-vs-prod timestamp gate, imposing no content constraint on a cron-only migration. |

Two related workflows for completeness: `migration-policy.yml` (the newer-than-tip gate, §2 above) also
runs; `supabase-migrate.yml` is the apply path and is **not** this plan's business — Plan 04 owns TEST
application and merge-to-main auto-applies to PROD.

### (3a) sql-function-snapshot — MEASURED, not assumed

The gate was executed locally both **before** authoring the migration and **after** the migration file
existed on disk, using the same command CI runs:

```
npx tsx scripts/dump-sql-functions.ts --self-test   -> PASS (both runs)
npx tsx scripts/dump-sql-functions.ts --check       -> PASS (both runs), snapshot NOT stale
```

Result recorded in `143-02-SUMMARY.md`. The no-op verdict is therefore an observation, not an inference.

---

## (4) CENSUS PART A — the numbers

### Raw table sizes (`content-range` headers, verbatim)

| Table | TEST `qmnijlgmdhviwzwfyzlc` | PROD `khslejtfbuezsmvmtsdn` |
|---|---|---|
| `strategies` | `0-0/8091` | `0-0/46` |
| `strategy_analytics` | `0-0/8073` | `0-0/42` |
| `compute_jobs` (all) | `0-0/2825` | `0-0/1660` |
| `compute_jobs` `strategy_id IS NOT NULL` | `0-0/6` | `0-0/311` |
| `compute_jobs` `strategy_id IS NULL` | `0-0/2819` | `0-0/1349` |
| `csv_daily_returns` (all) | `0-0/1964` | `0-0/7319` |
| `csv_daily_returns` `strategy_id IS NOT NULL` | `0-0/560` | `0-0/2790` |
| `csv_daily_returns` `strategy_id IS NULL` (per-key axis rows) | `0-0/1404` | `0-0/4529` |
| `strategy_keys` | 6 rows | 3 rows |

For calibration against 142's census (`20260802120000:92-96`, dated 2026-08-02): TEST held 7,371
`strategy_analytics` rows then and holds **8,073** now; PROD held 39 then and holds **42** now. Consistent
drift; no anomaly.

### The predicate, evaluated (RESEARCH query 1 — grace conjunct deliberately omitted)

> `dailies present` ∧ `zero compute_jobs rows (ANY kind, ANY status)` ∧
> `no strategy_analytics row at ('computing','complete','complete_with_warnings','failed')`

| Measure | TEST | PROD |
|---|---|---|
| **HEADLINE candidate count** | **0** | **0** |
| by `strategies.status` | — (empty population) | — (empty population) |
| analytics ABSENT vs `pending` | ABSENT 0 / `pending` 0 | ABSENT 0 / `pending` 0 |
| **composite exposure among candidates** (`strategy_keys` member) | **0** | **0** |
| archived among candidates | 0 | 0 |
| **FIRST-TICK POPULATION after all exclusions** | **0** | **0** |

### ⭐ Anti-vacuity decomposition — why "0" is a finding, not an empty query

A headline of 0 on both projects is exactly the result a *broken* census would also produce, so the
predicate was decomposed conjunct-by-conjunct. It is **not** vacuous:

| Step | TEST | PROD |
|---|---|---|
| DISTINCT strategies with **any** `csv_daily_returns` row | **1** | **8** |
| …of which have **zero** `compute_jobs` rows | **1** | **4** |
| …of THOSE, protected **only** by the terminal-analytics conjunct | **1** | **4** |
| …of THOSE, absent-or-`pending` analytics ⇒ **true candidates** | **0** | **0** |

Each conjunct is doing observable work, and the last one is where the population goes to zero.

### ⭐⭐ D-03 is EMPIRICALLY CONFIRMED, not merely argued

CONTEXT's D-03 asserts that the terminal-`strategy_analytics` conjunct is the **only** thing protecting
healthy retention-aged strategies, because `retention_compute_jobs_done` DELETEs `done` rows at 30 days
(current body `20260515113853:192-200`). The census measures that claim directly:

- **PROD: 4 of 4** strategies that have dailies and zero `compute_jobs` rows are healthy — every one of them
  is excluded **solely** by the terminal-analytics conjunct.
- **TEST: 1 of 1**, same shape.

**Deleting or weakening that conjunct turns a 0-row first tick into a 4-row mass re-enqueue on PROD today**,
and the number grows monotonically as the corpus ages past the 30-day retention window. This is the
mass-re-enqueue tripwire, measured on the live corpus rather than reasoned about — it goes in the migration
header and its gate's failure message names the incident.

### ⚠️ DX-06 (status gate): the census CANNOT supply the evidence the plan expected

The plan (DX-06) expected the candidate status breakdown to be the evidence for including `draft` and
excluding `archived`. **The candidate population is empty, so that breakdown is `{}` and proves nothing.**
Recorded as a limitation rather than dressed up.

Closest available evidence — the status distribution of the near-population and of every strategy with
dailies at all:

| Slice | TEST | PROD |
|---|---|---|
| near-population (dailies + zero jobs) by status | `{"pending_review": 1}` | `{"pending_review": 4}` |
| ALL strategies-with-dailies by status | `{"pending_review": 1}` | `{"private": 4, "pending_review": 4}` |
| composites among all strategies-with-dailies | 0 | **1** |

Observations that DO follow:

1. **Zero `archived` rows anywhere in the dailies-bearing population** on either project. Excluding
   `archived` is therefore free today — it costs nothing and is pure forward hygiene. Keep DX-06's
   exclusion, and say in the header that it is hygiene rather than a measured need.
2. **Zero `draft` rows** in the population either — so including `draft` costs nothing measurable today
   and is retained on the L-6 argument (a drop victim may sit at a pre-terminal status *precisely because*
   nothing advanced it), not on census evidence. Stated honestly: **DX-06 rests on reasoning, not on this
   census.**
3. **PROD has 1 composite carrying dailies.** It is currently protected by a terminal analytics row, so it
   is not a candidate today — but it is a live instance of exactly the L-3 / DX-05 false-positive
   population, one terminal-write failure away from being enqueued the wrong kind. The
   `NOT EXISTS strategy_keys` conjunct is guarding a real row, not a hypothetical one.

---

## (5) STOP RULES — evaluated

| Rule | Threshold | Observed | Verdict |
|---|---|---|---|
| PROD headline count | STOP if `> 10` | **0** | ✅ **not fired** |
| TEST headline count | STOP if `> 200` | **0** | ✅ **not fired** |

Neither STOP fired; Task 2 proceeds.

**Two consequences worth carrying into the header rather than celebrating:**

1. **The first tick after merge enqueues ZERO jobs on PROD.** The sweep ships as a genuine no-op against
   today's corpus. That is the *safe* outcome, but it also means the merge itself produces **no positive
   evidence** that the mechanism works end-to-end in production. The proof of function has to come from the
   throwaway-cluster arms (Plan 02 Task 3), the CI SQL gate (Plan 03), and Plan 04's live TEST tick — not
   from PROD behavior.
2. **T-143-12 (TEST stale-pending feed) is bounded at 0 today.** TEST has no worker, so sweep-inserted
   `pending` rows are never drained and nothing sweeps stale `pending` (JOB-08). With a candidate count of
   0 the sweep contributes nothing to the CI-flake backlog. The mechanism is still self-limiting by
   construction — a job row of ANY status excludes the strategy forever after, so the ceiling is one row per
   candidate ever — but the current contribution is measurably zero.

---

## Secret-material check

```
grep -riE "service_role|eyJ|postgres://|postgresql://|SUPABASE_SERVICE_ROLE_KEY=" 143-CENSUS.md
```

Run at authoring time; the only matches are inside this fenced code block itself (the grep pattern), which
is the check, not a secret. No key, token, JWT, DSN or connection string appears in this file. Project refs
(`qmnijlgmdhviwzwfyzlc`, `khslejtfbuezsmvmtsdn`) are already published throughout `.planning/` and in
migration headers; they are identifiers, not credentials.

---

## Summary of verdicts

- Re-base targets: **all three FRESH** — no re-derivation needed.
- Migration filename `20260816140000_reconcile_dropped_enqueue_sweep.sql`: **valid**, sorts after tip
  `20260814120000`.
- `sql-function-snapshot.yml`: **no-op** for this migration (measured).
- `migration-drift-check.yml`: **runs**, expected green, imposes no content constraint.
- Census: **0 candidates on both projects**, decomposed and shown non-vacuous.
- D-03's safety claim: **empirically confirmed** (PROD 4/4, TEST 1/1 protected solely by the conjunct).
- DX-06: retained, but on **reasoning not census evidence** — stated as such.
- DX-05: guarding a **real** composite row on PROD (1 composite carries dailies).
- L-2 (cron role RLS posture) and the cron-slot listing: **NOT obtainable by this method** — HTTP 404
  measured. Plan 04 owns both.
- STOP rules: **neither fired.**

---

# CENSUS PART B — applied to TEST, and the live tick

**Gathered:** 2026-08-17, in the orchestrator session (Supabase MCP is stripped from subagents —
Plan 04's precondition predicted this and it held; the blocked executor escalated rather than
substituting `supabase db push`).

Project: TEST `qmnijlgmdhviwzwfyzlc`. PROD `khslejtfbuezsmvmtsdn` was **NOT** touched.

## (6) Pre-apply RED — observed

Ran the SQL gate's Part 1 assertion directly against TEST before applying. Verbatim server error:

```
ERROR:  P0001: TEST FAILED (1/JOB-04): pg_cron IS installed but the
reconcile_dropped_enqueue_sweep job is NOT registered. Migration 20260816140000 is
unapplied to this project.
```

⚠️ Method deviation, recorded rather than smoothed: the plan asked for this RED as a **CI run URL**
on the PR branch. No PR exists — the branch has never been pushed (`git ls-remote origin
feat/v1.19-job-rate` empty; 26 commits ahead of `origin/main`), and pushing is `/ship`'s job, not
this plan's. Running the gate's own assertion against the real target is a **stronger** observation
than a CI proxy (same assertion, same database, no harness in between), but it is not the artifact
the plan named. 143-03 additionally holds an already-observed neuter (`N1b`: pg_cron present,
migration unapplied) for the same condition.

## (7) Apply — via Supabase MCP `apply_migration`

- Result: `{"success": true}`. The migration's own STEP 2 self-verify ran **inside** the apply and
  passed; it RAISEs on any failure, so success is a positive signal, not an absence of one.
- ⚠️ **Timestamp drift, expected and NOT "fixed":** MCP `apply_migration` stamps the ledger entry
  with `now()`, so the recorded name diverges from the repo filename
  `20260816140000_reconcile_dropped_enqueue_sweep.sql`. This is the known PR-Y2 rename class. The
  repo file was **not** renamed.
- ⚠️ **Deviation: the 460-line comment header was not transmitted.** Only the executable span
  (`BEGIN`…`COMMIT`, file lines 468–785) went through the MCP argument. Reason: retyping that much
  dense prose through a tool argument risks transcription drift, which would be a worse failure
  than the omission — comments never reach the database. **Discharged by measurement**, see (8).

## (8) Deployed-body integrity — byte-identical

| Source | length | md5 |
|---|---|---|
| repo `$cron$` span | 1860 | `febf9bdd6dfc58aa101ed8c4345e3b29` |
| TEST `cron.job.command` | 1860 | `febf9bdd6dfc58aa101ed8c4345e3b29` |

The artifact every gate asserts on is identical on both sides, so (7)'s omission has no effect on
what is deployed. Anti-vacuity guard applied to the extraction (the span must contain the INSERT).

## (9) Post-apply GREEN + slot check (census query 6)

Part 1 passes: exactly one job, cadence `35 * * * *`, `active = true`, `jobid = 18`.

| jobid | jobname | schedule |
|---|---|---|
| 2 | audit_log_cold_purge | `5 3 * * *` |
| 4 | retention_compute_jobs_done | `20 3 * * *` |
| 6 | audit_log_hot_to_cold | `0 3 * * *` |
| 7 | retention_notification_dispatches | `10 3 * * *` |
| 8 | retention_compute_jobs_failed | `30 3 * * *` |
| 9 | derive-allocator-key-dailies | `30 5 * * *` |
| 11 | retention_compute_jobs_orphaned_running | `15 4 * * *` |
| 12 | reap_strategy_analytics_stuck_computing | `*/15 * * * *` |
| **18** | **reconcile_dropped_enqueue_sweep** | **`35 * * * *`** |

DX-05 confirmed **live**: minute 35 is clear of the reaper's quarter-hour grid and of every other
registered slot.

## (10) Cron role — census query 5 (the PAPER half of L-2)

| jobname | username | rolbypassrls | rolsuper |
|---|---|---|---|
| reap_strategy_analytics_stuck_computing | postgres | **true** | false |
| **reconcile_dropped_enqueue_sweep** | **postgres** | **true** | false |
| retention_compute_jobs_orphaned_running | postgres | **true** | false |

`BYPASSRLS` overrides `FORCE ROW LEVEL SECURITY`, and the sweep runs as the **same role** as the two
janitors already known to write `compute_jobs` on a schedule. Predicts the write lands — but this is
still catalog inspection, i.e. inference. (11) is the measurement.

## (11) ⭐⭐ THE LIVE TICK — L-2 / T-143-02 RESOLVED EMPIRICALLY

Probe seeded **committed** (a rolled-back seed is invisible to the cron session), namespaced
`reconcile-143-live-`, dailies backdated 100 years. Shape at seed time: 2 dailies, **0** compute_jobs,
**0** strategy_analytics, **0** strategy_keys — the arm-A orphan. It landed at `status='draft'`, which
incidentally exercises DX-06's decision to **include** drafts.

Tick, from the header's own inspection query run verbatim:

```
start_time      2026-08-17 09:35:00.061575+00
end_time        2026-08-17 09:35:00.186637+00   (125 ms)
status          succeeded
return_message  DO
```

The healed row, captured **before** cleanup:

```
id           58728527-5cfc-4660-bb00-e0dfecc60bf7
strategy_id  de19555f-245f-4b09-a9b3-b6310108ddc8   (the probe)
kind         compute_analytics_from_csv
status       pending
metadata     {"source": "reconcile-sweep",
              "detected_at": "2026-08-17T09:35:00.061076+00:00"}
created_at   2026-08-17 09:35:00.061076+00          (== tick start)
```

**VERDICT: the pg_cron role CAN write `public.compute_jobs` through FORCE ROW LEVEL SECURITY.**
RESEARCH's A2 risk — silent zero-insert forever behind green CI — is **retired by measurement**, not
by inference. This is the one fact no CI gate can establish (sql-tests connects as the psql user,
never the cron role). Both halves of the cross-language marker contract carry the exact values
`main_worker.dispatch_tick` reads.

## (12) SC#2, observed live

Immediately after the tick, the probe re-evaluated against the deployed predicate returned **zero
rows** — it had left the candidate set. This is the *corrected* mechanism confirmed on a real
database: the **zero-jobs conjunct** removes the strategy once any job row exists, so a second tick
never reaches the INSERT. Not the partial unique index. (143-02 measured this offline; this is the
live confirmation.)

## (13) D-12 — the `return_message` premise is FALSE, and the header now says so

`return_message` carried **`DO`** — the last statement's command tag, not the session NOTICE stream.
So the run log proves a tick **ran** and **succeeded**, but carries **no healed count**. The header's
authoring-time claim (flagged UNVERIFIED at the time) was corrected in this plan rather than left
standing; operators are pointed at the row-count query instead.

## (14) Cleanup — verified zero residue

| check | rows |
|---|---|
| strategies named `reconcile-143-live-probe` | 0 |
| `auth.users` matching `reconcile-143-live-%@invalid.local` | 0 |
| profiles `reconcile-143-live` | 0 |
| compute_jobs with `metadata->>'source' = 'reconcile-sweep'` | 0 |
| orphaned csv_daily_returns | 0 |

The shared TEST project retains **only** the intentionally-registered cron job (jobid 18).

## (15) D-11 — worker `SENTRY_DSN`: RESOLVED POSITIVELY

Measured against live Railway (presence and length only; **no value was read or copied**).

The plan and CONTEXT both assumed a separate worker service. **There isn't one, and there hasn't been
since April.** The `quantalyze-analytics` project has ONE service, and the worker loops were merged
into the FastAPI process — `main.py:80-86`: *"Previously main_worker.py ran these as a separate
Railway service; merging them eliminates the 'forgot to deploy the worker' failure mode (incident
2026-04-20 → 2026-04-22, jobs queued but never processed)."* `dispatch_loop` runs as an asyncio task
in the app lifespan (`main.py:271`).

- That process calls `init_sentry()` at import (`main.py:69`, since Phase 16).
- `SENTRY_DSN` **is set** on the service. `MT5_ENABLED=true` and `MT5_GATEWAY_HOST` sit on the same
  service, independently confirming it is the worker.
- ⇒ **SC#1's alert half is TRUE in production.** No founder action item is owed.
- 143-01's `init_sentry()` in `main_worker.main()` is still correct and not dead code, but covers the
  **standalone** path (`python -m main_worker`, `npm run worker:dev`, a future re-split) — not the
  production path. Do not read it as evidence that production was previously unalerted; it was not.

## Summary of Part B verdicts

- Applied to TEST; **PROD untouched**. Deployed body **byte-identical** to the repo.
- Gate RED (pre-apply) → GREEN (post-apply), both observed; RED method deviates from the plan's
  CI-run-URL and is labelled, not glossed.
- **L-2 / T-143-02 RESOLVED by measurement** — the highest-risk unknown in the phase.
- SC#2's corrected mechanism confirmed live.
- **D-12 premise falsified**; header corrected in-phase.
- **D-11 resolved positively**; the "separate worker service" premise was wrong, not the DSN.
- Probe cleaned up with zero residue.
