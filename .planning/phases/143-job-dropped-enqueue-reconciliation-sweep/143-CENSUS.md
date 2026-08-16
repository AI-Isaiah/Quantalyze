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
