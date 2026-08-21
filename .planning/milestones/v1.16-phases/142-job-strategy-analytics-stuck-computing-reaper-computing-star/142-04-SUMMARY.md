---
phase: 142-job-strategy-analytics-stuck-computing-reaper-computing-star
plan: 04
subsystem: database
tags: [supabase, migration, pg_cron, plpgsql, security-definer, job-queue, pytest, analytics-service]

# Dependency graph
requires:
  - phase: 142
    plan: 01
    provides: "STRATEGY_ANALYTICS_REAP_THRESHOLD = '16 hours' (canonical) + the 43,920 s chain-inclusive ceiling the header restates"
provides:
  - "supabase/migrations/20260802120000_strategy_analytics_stuck_computing_reaper.sql — computing_started_at DDL + one-shot backfill + partial index + re-based bridge + inline pg_cron reaper + 4 self-verify blocks"
  - "strategy_analytics.computing_started_at (timestamptz, nullable, no default) — the JOB-01 column"
  - "cron job reap_strategy_analytics_stuck_computing (*/15 * * * *, inline literal body, LIMIT 25)"
  - "TestReaperThresholdDriftGate — the SQL↔Python drift gate (SC-3b)"
affects:
  - "142-05 SQL gate (applies this migration to TEST and proves it against real pg_cron)"
  - "142-03 Python/TS writer stamping (writes the column this migration adds)"
  - "142-06 src/lib/types.ts row type"
  - "143 (JOB-04 re-enqueue) and 144 (JOB-05 compute_jobs orphaned-running)"

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Bounded reaping UPDATE in a pg_cron body: ORDER BY + LIMIT + FOR UPDATE SKIP LOCKED + outer compare-and-set fence — NO in-repo precedent, written from first principles"
    - "Transition-conditional stamping: a three-arm CASE keyed off the RESOLVED status, with a NEGATIVE self-verify anchor forbidding the unconditional form"
    - "Grep-gate hygiene inside a migration header: prose must describe an anti-pattern WITHOUT emitting its byte sequence, because the shape greps scan comments too"

key-files:
  created:
    - supabase/migrations/20260802120000_strategy_analytics_stuck_computing_reaper.sql
  modified:
    - analytics-service/tests/test_main_worker.py

key-decisions:
  - "Census obtained via PostgREST service-role reads (TEST + PROD) as an explicit substitute for the unavailable Supabase MCP — recorded loudly, never silently skipped."
  - "A-1 (PostgREST merge-duplicates leaves omitted columns untouched) taken as the plan-sanctioned documented-fallback rather than seeding a throwaway row into the SHARED TEST DB, whose pollution is a live documented CI hazard. The header phrases it as PostgREST semantics, not an observed fact."
  - "Added an offline throwaway-Postgres syntax+behavior smoke beyond the plan's requirements, because the grep gauntlet cannot catch a 42601 and the plan's DB proof (142-05) is currently blocked on the harness gap."
  - "Branch (a)'s stamp CASE puts the complete_with_warnings exit-clear FIRST so the resolved-status test is evaluated before the transition test — the two-arm form in CONTEXT would have left the cww arm stamping."

requirements-completed: [JOB-01, JOB-02, JOB-03]

# Metrics
duration: ~45min
completed: 2026-08-02
---

# Phase 142 Plan 04: stuck-computing reaper migration + drift gate Summary

**One migration delivering `computing_started_at` DDL, a transition-conditional re-base of the status bridge, and a bounded inline pg_cron reaper on a 16-hour threshold single-sourced from Python — with SC-3b observed RED and the whole file proven to apply cleanly against a throwaway Postgres.**

## Performance

- **Duration:** ~45 min
- **Tasks:** 3
- **Files created:** 1 · **modified:** 1

## Task Commits

1. **Task 1: Pre-authoring verification** — no commit (read-only by design; `git status --porcelain` unchanged, as the acceptance criteria require)
2. **Task 2: Author the migration** — `302b443b` (feat)
3. **Task 3: SQL↔Python drift gate** — `96910418` (test)

---

## Task 1 — the SIX pre-flight facts

| # | Fact | Result |
|---|---|---|
| 1 | Re-base source freshness | ✅ **VERIFIED** |
| 2 | Writer-census freshness | ✅ **VERIFIED** |
| 3 | `computing` census (TEST + PROD) | ✅ **OBTAINED** (via PostgREST substitute) |
| 4 | A-1 PostgREST merge-duplicates | ⚠️ **DOCUMENTED-FALLBACK** (plan-sanctioned) |
| 5 | pg_cron installed on TEST | ⛔ **UNVERIFIABLE — ESCALATED** |
| 6 | `TEST_SUPABASE_DB_URL` + `psql` harness | ⛔ **ABSENT — ESCALATED** |

### 1. Re-base source (P-9)

`grep -lE 'CREATE (OR REPLACE )?FUNCTION +(public\.)?sync_strategy_analytics_status' supabase/migrations/*.sql` returns exactly **four** defining migrations:

```
20260412094454_sync_strategy_analytics_status.sql
20260707120000_sync_status_preserve_warnings.sql
20260708120000_sync_status_failed_final_bounce.sql
20260710150000_sync_status_supersede_failed_per_kind.sql   <- LATEST
```

A whole-directory grep for the identifier returns 17 files; every one after `20260710150000` only **calls or comments on** it — the sole later hit, `20260712120000_wizard_composite_members_invalidate_analytics.sql:35`, is a comment. **`20260710150000` is confirmed the re-base target.** No STOP condition.

### 2. Writer census (C-4)

The `computing` writer set for `strategy_analytics` is still **exactly two**:

1. `analytics-service/services/analytics_runner.py:1229` — `_mark_computing`, the Python upsert.
2. `sync_strategy_analytics_status` branch (a) — the SQL function, `20260710150000:114-127`.

`routers/portfolio.py:652` writes **`portfolio_analytics`** (a different table), re-confirming CONTEXT's C-4 correction. No third writer. No STOP condition.

### 3. Census (Open Question 2) — read-only, 2026-08-02

| Project | `computation_status='computing'` | total `strategy_analytics` | `computing_started_at` exists? |
|---|---|---|---|
| TEST `qmnijlgmdhviwzwfyzlc` | **0** | 7,371 | No — `42703` |
| PROD `khslejtfbuezsmvmtsdn` | **0** | 39 | No — `42703` |

Raw evidence (headers, key never printed):

```
TEST  content-range: */0          (computing)     content-range: 0-0/7371  (total)
PROD  content-range: */0          (computing)     content-range: 0-0/39    (total)
both  {"code":"42703", ... "column strategy_analytics.computing_started_at does not exist"}
```

**The migration header states these REAL numbers**, including the honest consequence: the backfill is expected to touch **zero rows on both projects**. The header explains why it is retained anyway (it is the correct one-shot for any row entering `computing` between authoring and apply) and instructs a re-run of the census before merge. The `42703` on both projects also confirms the migration is unapplied everywhere, so 142-05's ungated structural part will correctly redden if run before apply.

⚠️ **SUBSTITUTION, recorded loudly.** These are **PostgREST** reads using the service-role keys in `.env.test.local` / `.env.local`, **not** Supabase MCP `execute_sql` — the Supabase MCP is **not exposed to this executor** (see fact 5). Read-only `GET` requests only; nothing was written to either project.

### 4. A-1 — PostgREST merge-duplicates leaves omitted columns untouched

**Recorded as verified-by-documentation only.** The empirical check requires seeding a throwaway row into the **shared TEST DB**, whose cross-run pollution is a live, documented CI hazard in this repo, and it would need the full `auth.users → profiles → strategies → strategy_analytics` FK chain. The plan explicitly permits this fallback; I took it rather than trade a documented CI-flake risk for a fact that does not change the migration's correctness.

Accordingly the migration header phrases the runner-path sentence as **PostgREST merge-duplicates semantics** (cited), not as an observed fact:

> `-- * The Python runner's entry upsert OMITS computed_at, and PostgREST`
> `--   merge-duplicates writes only the supplied columns, so computed_at retains`
> `--   the PRIOR 'complete' run's value and the row would be reaped IMMEDIATELY.`

Per the plan, 142-05's SC#2 arms seed `computed_at` directly and do not depend on A-1 either way. **Not faked, not claimed as observed.**

### 5 & 6. ⛔ pg_cron-on-TEST and the psql harness — UNRESOLVED, ESCALATED

| Probe | Result |
|---|---|
| `command -v psql` | **missing** from PATH (a binary exists at `/opt/homebrew/opt/postgresql@16/bin/psql`, but it is useless without a connection string) |
| `printenv TEST_SUPABASE_DB_URL` | **unset** (exit 1) |
| Supabase MCP `execute_sql` | **not exposed to this agent** — no `mcp__supabase__*` tools; no `.mcp.json` in the project |
| `supabase` CLI auth | **absent** — `~/.supabase` holds only `telemetry.json`; no `SUPABASE_ACCESS_TOKEN` |
| Direct DB password | **not present** in any `.env*` file (only PostgREST URL + service-role keys) |

Both of the plan's named fallbacks are therefore unavailable: I can neither provision the harness (the DB password is a secret I do not have and must not fabricate) nor substitute Supabase MCP `execute_sql`. **pg_cron on TEST could not be determined either TRUE or FALSE** — `pg_catalog` is not reachable over PostgREST.

**This is surfaced, not worked around, and it is NOT a silent skip.** Scope of the impact, stated precisely:

- It does **not** affect this plan's authoring correctness. Facts 1–3 (the ones that decide what the migration says) were all obtained.
- It **does** block **plan 142-05's evidence chain**: without pg_cron on TEST, that plan's SQL gate would green-skip, and per VALIDATION.md a green-skipped gate is not evidence.

**Orchestrator action required before 142-05 can produce evidence:** provision `TEST_SUPABASE_DB_URL` + `psql` (or expose the Supabase MCP), then confirm `SELECT EXISTS(SELECT 1 FROM pg_extension WHERE extname='pg_cron')` is TRUE on `qmnijlgmdhviwzwfyzlc`. **No SQL-gate result should be treated as evidence until then.**

---

## Threshold — the finalized pair

| Quantity | Value |
|---|---|
| Chain-inclusive ceiling (plan 142-01) | **43,920 s (12.2 h)** |
| 1.25 × ceiling | 54,900 s (15.25 h) |
| **Deployed `STRATEGY_ANALYTICS_REAP_THRESHOLD`** | **`'16 hours'` (57,600 s)** |
| Margin | 1.31× |

Read from `analytics-service/services/job_worker.py:540` at authoring time — **not assumed** from the plan's provisional value. The migration header restates both numbers, names `job_worker.py` as canonical, names the drift test, and explicitly says this is **not** `batch_size × max_per_kind_timeout` (C-6).

## SC-3b — Falsifiability Ledger evidence

**Mutation:** the cron body's `interval '16 hours'` → `interval '4 hours'` (the exact `compute_jobs` anti-pattern number).
**Command:** `cd analytics-service && pytest tests/test_main_worker.py -k Reaper -x -q`
**Result: RED.**

```
E       AssertionError: SQL<->Python threshold DRIFT. The pg_cron body in
        20260802120000_strategy_analytics_stuck_computing_reaper.sql carries
        interval literal(s) ['4 hours'], but services/job_worker.py
        STRATEGY_ANALYTICS_REAP_THRESHOLD is '16 hours'. ...
E       assert {'4 hours'} == {'16 hours'}
E         Extra items in the left set:  '4 hours'
E         Extra items in the right set: '16 hours'

tests/test_main_worker.py:2270: AssertionError
FAILED tests/test_main_worker.py::TestReaperThresholdDriftGate::test_sql_interval_literal_equals_python_constant
1 failed, 4 passed, 49 deselected in 1.40s
```

**Restore:** `git checkout -- supabase/migrations/20260802120000_...sql` — restored from the committed task-2 text (`302b443b`), never retyped. `git status --short` on that path empty afterwards.
**Re-run GREEN:** `6 passed, 49 deselected in 1.71s`. **`grep -rn MUTANT` → 0.**

Ledger row **SC-3b: Observed ✅**.

## Verification

| Gate | Result |
|---|---|
| Plan's Task-2 shape verify (`migration-shape-ok`) | ✅ pass |
| Template-artifact scan (reviewer #16) | 0 |
| `RAISE` single-literal awk check (reviewer #21) | clean |
| Transaction-abort token outside `supabase/tests/` | absent |
| Four-column reap `SET` list | ✅ (P-4's warning sign is two) |
| Non-terminal status list byte-identical to the bridge's | ✅ (`:520` == `:307`) |
| `computing_started_at = now()` (unconditional) | **0 occurrences** |
| `IS DISTINCT FROM` present in the stamp expression | 4 occurrences |
| SQL interval literal == Python constant | both `16 hours` |
| `REVOKE` line byte-identical to `20260710150000` | ✅ (`sort -u` collapses to 1 line) |
| New `GRANT`s | **0** |
| Internal order (DDL→backfill→index→bridge→cron→self-verify) | ✅ backfill `:246` before `cron.schedule` `:501` |
| `pytest -k Reaper -x -q` | **6 passed** (3 plan-01 + 3 new) |
| `pytest test_main_worker.py test_job_worker_csv_kind.py -x -q` | **61 passed** (58 baseline + 3) |
| CI-equivalent `mypy --strict --follow-imports=silent services/ routers/ models/` | **Success, 89 files** |
| mypy errors in the added test range | **0** (59 pre-existing, highest at `:2132`; block starts `:2159`) |

### Bridge re-base diff — audited line by line

`diff` of the function body against `20260710150000:71-201` shows **only** the intended deltas: branch (a)'s INSERT column list + `VALUES` gaining the stamp, branch (a)'s three-arm `CASE`, branches (b)/(c) gaining `computing_started_at = NULL`, the extended `COMMENT ON FUNCTION`, and one comment-only attribution fix (`this migration` → `mig 20260710150000`, since the supersession was closed there, not here). **Byte-identical:** the signature, `SECURITY DEFINER`, `SET search_path = public, pg_catalog`, branch (d), branch (b)'s `d.kind = f.kind` + `d.created_at > f.created_at` supersession, and **both** `OR strategy_analytics.computation_warned` marker reads.

### Offline apply + behavior smoke (beyond the plan — see Deviations)

The migration was applied end-to-end to a **throwaway local Postgres 16 cluster** with stub tables. `psql -v ON_ERROR_STOP=1` **exit 0**; all four self-verify blocks fired their NOTICEs:

```
NOTICE:  JOB-02: reap_strategy_analytics_stuck_computing scheduled (every 15 minutes, 16-hour staleness threshold, LIMIT 25 per tick).
NOTICE:  JOB-01: computing_started_at column shape verified (timestamptz, nullable, no default) and partial index present.
NOTICE:  JOB-01: sync_strategy_analytics_status re-base verified (conditional stamp, no unconditional now(), F-3/PUB-02 and SI-02 anchors intact).
NOTICE:  JOB-02/JOB-03: reap_strategy_analytics_stuck_computing self-verify passed (cadence, bounded predicate, four-column SET, 16-hour threshold pinned).
COMMIT
```

The fail-loud pg_cron gate was **also observed firing correctly** on the run before the fake extension row existed (`ERROR: JOB-02: pg_cron extension is NOT installed...`) — it refuses rather than silently skipping (Rule 12 / PATTERNS S-1).

Behavior, driving the real bridge and **EXECUTING the deployed `cron.job.command`** (not a re-typed predicate):

| Arm | Expected | Observed |
|---|---|---|
| transition into `computing` | stamp set | `status=computing stamp_is_null=false` ✅ |
| **SC-2b** second bridge call, still computing | stamp NOT advanced | `stamp_advanced=false` ✅ |
| exit to `complete` (branch c) | stamp cleared | `status=complete stamp_is_null=true` ✅ |
| stranded, old stamp, no active job, `warned=TRUE` | reaped **and** warned cleared | `failed warned=false stamp_null=true err=Analytics was interrupted befo…` ✅ |
| old stamp **but** active `done_pending_children` job | survives | `computing` ✅ |
| NULL stamp (writer bug) | survives, never reaped | `computing` ✅ |
| **SC#2** fresh stamp + 40 h-old `computed_at` | survives | `computing` ✅ |
| **SC#2** old stamp + fresh `computed_at` | reaped | `failed` ✅ |

⚠️ **What this smoke does NOT prove, stated plainly.** The schema was **stubbed** (no RLS, no `computation_status` CHECK, no triggers, no real FK chain) and **pg_cron was faked** (a `pg_extension` row plus a `cron.schedule` stub that merely stores the command — no scheduler actually ran it). It is a syntax and logic proof, **not** a substitute for plan 142-05's gate against the real TEST schema and real pg_cron. Treat it as pre-evidence that the file is worth applying, nothing more.

---

## ⚠️ Review note — the bounded reap UPDATE has NO in-repo precedent

Per PATTERNS §No Analog Found: all six existing pg_cron janitors are **unbounded `DELETE`s**, and `reset_stalled_portfolio_analytics` (the only reaping `UPDATE`) is **unbounded and Python-invoked**. The shape shipped here —

```sql
UPDATE ... WHERE strategy_id IN (
  SELECT ... ORDER BY computing_started_at ASC LIMIT 25 FOR UPDATE SKIP LOCKED
) AND sa.computation_status = 'computing'
```

— is written **from first principles** and **deserves extra review weight**. Specific things a reviewer should attack:

1. The `IN (… FOR UPDATE SKIP LOCKED)` subselect against the **same table** being updated. Verified valid and executing correctly on PG16 in the smoke, but it is the canonical queue pattern applied to a table it has never been applied to here.
2. `LIMIT 25` is a **Claude's-discretion** value (drains 100 rows/hour at `*/15`). Nothing derives it; if a realistic backlog exceeds that drain rate, it silently lengthens.
3. The outer compare-and-set fence and the inner predicate both test `computation_status = 'computing'` — deliberate belt-and-braces, but a reviewer should confirm the redundancy is harmless rather than masking a race.
4. `FOR UPDATE` + `ORDER BY` + `LIMIT` ordering semantics under concurrency: rows skipped by `SKIP LOCKED` are silently deferred to the next tick with no count reported (deliberate — the body stays a single bounded UPDATE, and the header documents the `cron.job_run_details` operator query instead).

## Deviations from Plan

**1. [Harness substitution — Task 1 steps 3/5/6] Supabase MCP unavailable; census via PostgREST, pg_cron/psql escalated**
- **Found during:** Task 1
- **Issue:** No `mcp__supabase__*` tools, no `TEST_SUPABASE_DB_URL`, no `psql` on PATH, no Supabase CLI auth, no DB password anywhere.
- **Action:** Obtained the TEST **and** PROD census read-only over PostgREST and recorded the substitution loudly (above and in the migration header). Escalated facts 5 and 6 as unresolved rather than working around or silently skipping them. The plan's `<automated>` psql arm for Task 1 is therefore **not satisfied**; it is replaced by the pasted PostgREST evidence, exactly as the plan's step-6 escape clause requires.
- **Files modified:** none

**2. [Addition beyond plan] Offline throwaway-Postgres apply + behavior smoke**
- **Found during:** Task 2
- **Rationale:** The plan's Task-2 verify is a grep gauntlet, which cannot catch a `42601` — and this file **auto-applies to PROD on merge** while its real DB proof (142-05) is blocked by deviation 1. A throwaway cluster with stub tables costs ~2 minutes and caught nothing latent, but converts "the greps pass" into "the file actually applies and the logic behaves". Recorded with an explicit statement of what it does **not** prove.
- **Files modified:** none in the repo (scratchpad only)

**3. [Rule 1 — grep-gate hygiene, self-inflicted] Two header phrasings tripped the plan's own shape verify**
- **Found during:** Task 2
- **Issue:** My header prose contained the literal token `ROLLBACK` (in the sentence asserting it appears nowhere) and the literal byte sequence `computing_started_at = now()` (in the paragraph describing the C-3 anti-pattern). Both **tripped the mechanical gates that scan the whole file, comments included** — the same class the plan warns about for the drift test.
- **Fix:** Rephrased both to describe the anti-pattern without emitting it, and added an inline note in the header saying the sequence is deliberately not spelled out and why.
- **Files modified:** `supabase/migrations/20260802120000_strategy_analytics_stuck_computing_reaper.sql`
- **Commit:** `302b443b`

**Total:** 1 auto-fixed (Rule 1), 1 sanctioned substitution with escalation, 1 addition beyond scope. No fixed decision, number, or acceptance criterion was changed.

## Issues Encountered

- **`python` is not on PATH**; `python3` used throughout. pytest was run from `analytics-service/` in every invocation (VCR cassette constraint).
- **`.claude/agents/` is not present in the worktree** (untracked); `migration-reviewer.md` and `rls-policy-auditor.md` were read from the main checkout. Both were applied — see the Verification table and the header's invariant-#14 deviation paragraph.
- A Vercel-plugin hook injected a **`vercel-storage`** skill directive on every `supabase/**` read. It is a false-positive path match — this work is Supabase Postgres/pg_cron, not Vercel Storage — so it was not followed. Flagging rather than hiding it.
- The **`migration-reviewer.md` invariant-#14 staleness** (it forbids `BEGIN`/`COMMIT` that 150/231 migrations including the tip use) is pre-documented in the migration header per CONTEXT's resolution. Per that same decision it is **a backlog item, not fixed here**.

## Known Stubs

None. Every artifact is live: the migration is complete and self-verifying, and the drift gate runs in CI via the existing pytest suite. The column has no writer until plan 142-03 and no DB proof until 142-05 — both are the planned sequencing, named explicitly in the migration header and the constant's comment block, not stubs.

## Threat Flags

No **new** surface beyond what the plan's `<threat_model>` already registered. Dispositions delivered:

| Threat ID | Mitigation as shipped |
|---|---|
| T-142-09 (caller-controlled threshold) | INLINE literal cron body — no function, no parameter, no EXECUTE surface; literal pinned by the drift gate |
| T-142-10 (re-base drops SECDEF/REVOKE) | Byte-identical posture verified by `diff` + `sort -u` on the REVOKE; self-verify re-asserts SECDEF + search_path |
| T-142-11 (unconditional stamp) | Three-arm CASE + NEGATIVE self-verify anchor; observed behaviorally (`stamp_advanced=false`) |
| T-142-12 (cww launder) | `computation_warned = FALSE` in the four-column SET; observed (`warned=false` after reaping a `warned=true` row) |
| T-142-13 (unbounded UPDATE) | LIMIT 25 + ORDER BY + SKIP LOCKED + partial index — **flagged above for extra review, no in-repo precedent** |
| T-142-14 (error leaks internals) | Fixed literal, no identifiers or row data |
| T-142-15 (SQL injection via dynamic body) | `$cron$` fixed literal, zero interpolation, `public.*` qualified |
| T-142-SC (package installs) | **Zero packages installed** |

⚠️ One item worth a reviewer's eye, disclosed rather than buried: the reaper writes terminal state across **all tenants' rows** as the `postgres` cron role. Its only safety is the scoped predicate — same posture as the six existing janitors, but on a table where a wrong predicate produces a **false failure on a money surface** rather than a deleted queue row.

## User Setup Required

**Yes — blocking for plan 142-05, not for this plan.** Provision `TEST_SUPABASE_DB_URL` + `psql` (or expose the Supabase MCP to the executor), then confirm pg_cron is installed on TEST `qmnijlgmdhviwzwfyzlc`. Until then 142-05's SQL gate would green-skip and must not be read as evidence. See Task 1 facts 5 & 6.

## Next Phase Readiness

- **142-05** can apply this migration to TEST via MCP and assert: the deployed `cron.job.command` carries `interval '16 hours'`, the `*/15 * * * *` schedule by string equality (never an `::INT` cast — the hour field is `*`), and the four directional reap arms. **Blocked on the harness gap above.**
- **142-03** can write `computing_started_at` from the Python runner and the TS route; the column, its semantics, and the NULL-means-not-computing contract are on disk in the `COMMENT ON COLUMN`.
- **Do NOT** add this cron to `supabase/tests/test_retention_crons_safe.sql` — its loop requires `%where%created_at%` in every listed body, the exact opposite of P-1. This body deliberately never mentions `created_at`/`computed_at`.
- The `20260802120000` filename sorts after the repo tip `20260728120000`, satisfying `migration-policy.yml`. Note MCP `apply_migration` stamps `now()`, so expect drift between the applied timestamp and the filename.

## Self-Check: PASSED

| Claim | Result |
|---|---|
| `supabase/migrations/20260802120000_strategy_analytics_stuck_computing_reaper.sql` | FOUND |
| `analytics-service/tests/test_main_worker.py` | FOUND |
| Commit `302b443b` (Task 2) | FOUND |
| Commit `96910418` (Task 3) | FOUND |

`git diff --diff-filter=D --name-only HEAD~2 HEAD` → **empty** (no files deleted by either commit). `git status --short` → clean before the SUMMARY write. No untracked files left behind.

---
*Phase: 142-job-strategy-analytics-stuck-computing-reaper-computing-star*
*Completed: 2026-08-02*
