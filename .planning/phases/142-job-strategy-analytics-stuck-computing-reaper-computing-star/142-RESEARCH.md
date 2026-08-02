# Phase 142: JOB — strategy_analytics stuck-computing reaper + computing_started_at DDL — Research

**Researched:** 2026-08-02
**Domain:** Postgres DDL + pg_cron janitor over a live, money-bearing job-state table; Python writer-stamping; CI invariants
**Confidence:** HIGH on codebase reality (every claim below is a direct read at a file:line on this branch). MEDIUM on the threshold arithmetic (the correct formula is materially different from the one CONTEXT.md names — see §Threshold).

---

## Summary

This phase is **not** a clone job. The research SUMMARY and CONTEXT.md both frame it as "clone the
`reset_stalled_portfolio_analytics` twin and stamp `computing_started_at` at three writer sites."
Reading the source disproves both halves:

1. **The twin is not clonable.** `reset_stalled_portfolio_analytics` keys on `computed_at`, which is
   sound for `portfolio_analytics` because that table is **append-only** (one new row per compute run,
   `routers/portfolio.py:651` INSERTs). `strategy_analytics` is **upsert-keyed on `strategy_id`
   (UNIQUE)** and its `computed_at` is re-stamped `now()` by the status bridge on *every* job
   transition. The predicate that is correct on one table is broken in **both directions** on the other.
2. **Two of CONTEXT.md's three named writer sites are wrong.** `routers/portfolio.py:652` writes
   `portfolio_analytics`, not `strategy_analytics`. `services/job_worker.py:1853` is a **comment**.
   The real second writer is a **SQL function** — `sync_strategy_analytics_status`, branch (a) — and
   stamping it naively would reproduce the exact 106-janitor bug this phase exists to fix.

The third and largest correction: **`strategy_analytics` has no `updated_at` column.** CONTEXT.md's
backfill instruction ("stamp from `updated_at`") is not executable, and the one-off script this phase
supersedes (`reset_stuck_computing_rows.py`) selects and filters on `updated_at` — meaning it would
fail at runtime with a PostgREST `42703 undefined_column`. It is **not** a working reference
implementation and must not be treated as one.

**Primary recommendation:** Build the reaper around the **`NOT EXISTS (active compute_jobs)` clause as
the primary safety**, with `computing_started_at` as a debounce — not the other way round. Stamp the
column **conditionally on the transition into `computing`** (never unconditionally `now()`), deliver
it as a pg_cron job with a hardcoded literal threshold and no caller-controlled parameter, and clear
`computation_warned` in the same UPDATE or the status bridge will launder the reap back to
`complete_with_warnings`.

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Reaper mechanism & scheduling**
- The reaper runs as a **pg_cron-scheduled SQL function**. JOB-07 forbids heavy janitor work on
  the worker's shared asyncio event loop; pg_cron satisfies that constraint *by construction*
  rather than by discipline.
- Cadence: **every 15 minutes** — bounds how long a user stares at a spinner without hammering
  the DB. (Distinct from Phase 144's `compute_jobs` cadence; do not couple them.)
- Delivered as a **NEW migration**, layered independently of
  `20260720120000_retention_orphaned_running_window_4h.sql`. Requirements Decision #1: the two
  janitors are two distinct mechanisms; neither implies the other.
- Each run is **bounded** — an explicit `LIMIT` with deterministic ordering — so a large backlog
  cannot blow the cron slot or hold locks for an unbounded window.

**`computing_started_at` DDL & writer stamping**
- Column shape: **`timestamptz`, nullable, no default.** NULL means "not currently computing".
  A `NOT NULL DEFAULT now()` would be a 23502 timebomb against existing writers.
- **One-time backfill at migration time** for rows *currently* sitting at
  `computation_status='computing'` (stamp from `updated_at`), so rows already stranded in prod
  become reapable. Explicitly a migration-only backfill, not an ongoing fallback — the reaper
  itself must never read `updated_at`/`computed_at` (the exact mistake that forced the
  106-janitor revert).
- Enforcement is **static, not runtime**: every writer that sets
  `computation_status='computing'` also sets `computing_started_at` in the *same*
  statement/transaction, and a **CI invariant** fails if any such write site lacks the co-located
  stamp. A runtime `CHECK` constraint is rejected — a missed writer would surface as a 23514 on
  the live money path instead of a red build.
- Known writer sites to cover (grep-verified starting set; planning must re-grep for
  completeness): `analytics-service/services/analytics_runner.py:~1229`,
  `analytics-service/routers/portfolio.py:~652`, `analytics-service/services/job_worker.py:~1853`.
- `computing_started_at` is **cleared to NULL** when a row leaves `computing` (to `complete` or
  `failed`), so a stale stamp can never re-trigger the reaper.
- A `computing` row with a **NULL** stamp is a writer bug, not a stranded job: the reaper
  **skips it and emits a Sentry warning**. Fail loud, but never destructively reap a job that may
  have started seconds ago.

**Terminal state & user-facing message**
- Terminal status is **`failed`** — JOB-02 names it. No new enum value.
- The message is **our-fault attribution with a retry path**, following the copy standard settled
  in 140.3/140.5: never attribute our own janitor's action to the user or their venue. Planning
  must confirm the exact column the runner already writes failure messages into and reuse it
  rather than inventing a field.
- The reaper **terminalizes only — it never re-enqueues.** Re-enqueue is JOB-04, Phase 143.
  Keeping that out here preserves the phase boundary and avoids two mechanisms racing the same row.
- The surfaced recovery affordance is **non-destructive** (retry), per the 140.4 decision that a
  destructive control is never offered as the way forward.
- Supersedes `analytics-service/scripts/reset_stuck_computing_rows.py` — the one-off script's
  disposition (delete vs. mark superseded) is planning's call, but it must not remain as a second,
  divergent implementation of the same reap.

**Threshold derivation + JOB-07 proof**
- The staleness threshold is **re-derived from `strategy_analytics`'s own batch-tail math**
  (`batch_size × max_per_kind_timeout`). The `compute_jobs` 4h number is **not** copied — JOB-03
  makes that explicit.
- **Single source of truth:** the Python-side constant is canonical. The migration carries the
  derived literal with a comment naming its source, and a test asserts the SQL literal equals the
  Python-derived value — so drift between the two fails CI rather than silently mis-reaping.
- The CI invariant lives **beside `test_every_kind_has_watchdog_headroom`** in
  `analytics-service/tests/test_main_worker.py:~1020`, mirroring its structure: it fails if any
  relevant handler's batch-inclusive worst case exceeds the reaper threshold.
- The JOB-07 regression drives a **large synthetic backlog** and asserts worker `healthz` stays
  inside `STALE_THRESHOLD` — the WEDGE-01 crash class this janitor exists to clean up after.

### Claude's Discretion
- Exact `LIMIT` size, cron expression syntax, function naming, and SQL structure
  (SECURITY DEFINER vs. invoker) — subject to the project's migration invariants.
- The precise error-message column and copy wording, confirmed against the existing failure path.
- Whether the superseded one-off script is deleted or retained with a superseded header.

### Deferred Ideas (OUT OF SCOPE)
- `compute_jobs` orphaned-`running` DELETE→terminal UPDATE + cadence (JOB-05) — Phase 144. The
  standing TEST-DELETE / PROD-reset split is resolved there, not here.
- Dropped-enqueue reconciliation sweep and idempotent re-enqueue (JOB-04) — Phase 143.
- csv-finalize atomicity, and the reproduce-first 42501 gate (JOB-06) — Phase 145.
- Any consolidation of the `portfolio_analytics` orphan reap in `routers/cron.py` with this new
  `strategy_analytics` reaper — noted as a possible future de-duplication, out of scope here.
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description (verbatim from REQUIREMENTS.md) | Research Support |
|----|---------------------------------------------|------------------|
| **JOB-01** | `strategy_analytics` carries a dedicated writer-stamped `computing_started_at`, set in the SAME statement/transaction that sets `computation_status='computing'` — never `updated_at`/`computed_at`, the exact mistake that forced the 106-janitor revert. | §Writer Census (complete, corrected 2-site set). §Collision C-1 (`updated_at` does not exist). §Collision C-3 (the SQL bridge writer needs conditional stamping or it *becomes* the 106 bug). |
| **JOB-02** | A recurring pg_cron reaper transitions stranded `strategy_analytics` rows (stuck `computing` past threshold AND no active `compute_jobs` row) to a TERMINAL `failed` state carrying a user-recoverable message… Supersedes the one-off `reset_stuck_computing_rows.py` script. | §pg_cron Migration Pattern (exact house shape). §Superseded One-Off (its real predicate + what it gets wrong). §Terminal State & Message (`computation_error` is the column; `GATE_ANALYTICS_FAILED` already carries a non-destructive retry). §Pitfall P-4 (`computation_warned` must be cleared). |
| **JOB-03** | The reaper's staleness threshold is derived from `strategy_analytics`'s own batch-tail math (`batch_size × max_per_kind_timeout`), not copied from the `compute_jobs` 4h number, and a CI invariant (mirroring `test_every_kind_has_watchdog_headroom`) fails if any handler's real worst case exceeds it. | §Threshold Derivation — with the named symbols, the real chain topology, and the finding that the *named formula is the `compute_jobs` formula* and under-estimates this table's window by ~4×. |
| **JOB-07** | No reaper or sweep runs heavy work on the worker's shared asyncio event loop; a regression test proves a large synthetic backlog does not stall `healthz` past `STALE_THRESHOLD`. | §JOB-07 Test Mechanics — `main_worker_healthz.STALE_THRESHOLD = 90.0`, and `tests/test_worker_isolation_e2e.py` as the concrete mirror target. §Pitfall P-7: the naive form of this test **cannot fail** and needs a falsifiability design. |
</phase_requirements>

---

## Project Constraints (from CLAUDE.md / AGENTS.md)

| Directive | Source | Bearing on this phase |
|-----------|--------|-----------------------|
| Root-cause obsession; no bandaids | global CLAUDE.md Rule 6 | The `updated_at`/`computed_at` shortcut is the bandaid this phase exists to remove. |
| Surface conflicts, don't average them | Rule 7 | Two live conflicts found — §Collisions C-1..C-6 and §Conflict: migration-reviewer #14 vs repo convention. |
| Tests verify intent, not just behavior; a test that can't fail is wrong | Rule 9 | Directly binding on the JOB-07 test (P-7) and the threshold oracle (P-8). |
| Match the codebase's conventions even if you disagree | Rule 11 | Migration house style: `BEGIN; SET lock_timeout='5s'; … COMMIT;` + a self-verifying `DO $$` block. |
| Fail loud | Rule 12 | Migrations must `RAISE EXCEPTION` if pg_cron is absent, never silently skip (both existing retention migrations do this). |
| `analytics-service/` Python coverage gate is `--cov-fail-under=80` | project CLAUDE.md | New Python test files must not drop it. |
| TS coverage ratchet: lines 82 / stmts 80 / fns 74 / branches 72, **blocking** | project CLAUDE.md | Only relevant if TS files are touched (likely: `src/lib/types.ts`). |
| `AGENTS.md`: this is NOT the Next.js you know — read `node_modules/next/dist/docs/` before writing Next code | AGENTS.md | Low relevance: this phase touches no Next.js runtime surface. If `src/lib/types.ts` is edited, it is a pure type declaration. |
| Run `mypy --strict` before shipping `analytics-service` | memory `feedback_run_mypy_before_ship_analytics` | Applies if `analytics_runner.py` gains the stamp. |
| pytest MUST be run from `analytics-service/` | memory `reference_pytest_must_run_from_analytics_service_dir` | Repo-root runs miss the VCR cassette dir and make live broker calls. |
| Merging `supabase/migrations/**` to `main` AUTO-APPLIES to PROD | memory `project_supabase_migrate_auto_on_push` | Apply the new migration to the TEST project via MCP **before** merge. |

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|--------------|----------------|-----------|
| Detect & terminalize a stranded `computing` row | **Database (pg_cron + plpgsql)** | — | Structurally immune to WEDGE-01; independent of the worker liveness it backstops. Requirements "Out of Scope" table forbids worker-loop and Vercel-cron placement outright. |
| Stamp `computing_started_at` on entry to `computing` | **Database (SQL bridge branch a)** + **Python worker (`analytics_runner`)** | — | Two writers, two runtimes. Both must stamp; neither can stamp on the other's behalf. |
| Clear `computing_started_at` on exit from `computing` | **Database (bridge branches b/c)** + **Python worker** + **Next.js API (3 `failed` placeholder writers)** | — | 14 exit sites across three runtimes (§Writer Census). |
| Threshold source of truth | **Python (`analytics-service`)** | Database (derived literal + a drift test) | CONTEXT.md locks Python as canonical; the SQL carries the literal + a comment naming its source. |
| Render the terminal state to the user | **Next.js client (`SyncPreviewStep` / `useStrategySyncPoller`)** | — | Already built. This phase writes into the column those already read; **no frontend work is required**. |
| Threshold / stamp CI invariants | **pytest (`analytics-service/tests/`)** | — | Mirrors `test_every_kind_has_watchdog_headroom`. |
| Reaper behavioural gate | **`supabase/tests/test_*.sql`** (plain PL/pgSQL under `psql -v ON_ERROR_STOP=1`) | — | The only SQL layer CI actually executes (§Testing Harness). |

---

## ⚠️ Collisions Between CONTEXT.md and Codebase Reality

These are stated up front because each one invalidates a locked decision or a named coordinate.
None of them can be silently worked around.

### C-1 (CRITICAL) — `strategy_analytics` has **no `updated_at` column**

CONTEXT.md: *"One-time backfill at migration time … (stamp from `updated_at`)."* This is not executable.

Evidence: `supabase/migrations/20260405061911_initial_schema.sql:69-96` defines the table with
`computed_at TIMESTAMPTZ NOT NULL DEFAULT now()` and **no** `updated_at`. Only four columns have been
added since — `volume_metrics`, `exposure_metrics` (`20260412125725:52-53`), `computation_warned`
(`20260708120000:57-58`), `metrics_json_by_basis` (`20260710120000:134-135`). No `set_updated_at`
trigger exists for this table. `src/lib/types.ts:288-329` (the hand-maintained TS row type) likewise
has `computed_at` and no `updated_at`. **[VERIFIED: direct file read]**

**Consequence for planning:** the migration-time backfill must stamp from `computed_at`, and the
migration header must say so explicitly *and* say why `computed_at` is acceptable **only** as a
one-shot backfill anchor and never as the ongoing key (see C-2).

### C-2 (CRITICAL) — `computed_at` is broken in **both** directions, which is what makes SC#2 falsifiable

The two `computing` writers leave `computed_at` in opposite, both-wrong states:

| Writer | What it does to `computed_at` | A `computed_at`-keyed reaper would… |
|--------|-------------------------------|-------------------------------------|
| SQL bridge branch (a), `20260710150000:114-124` | `computed_at = now()` in the `ON CONFLICT DO UPDATE`, on **every** job transition for the strategy | …**never** reap (false negative) — the 106-janitor bug verbatim |
| `analytics_runner.py:1227-1232` — `.upsert({strategy_id, computation_status:"computing"}, on_conflict="strategy_id")` | Payload omits `computed_at`; a PostgREST merge-duplicates upsert only writes supplied columns, so `computed_at` **stays at the prior `complete`'s timestamp** | …reap **immediately** (false positive) — reaping a job that started seconds ago |

The second row is the more dangerous one and is **not** documented anywhere in `.planning`.
`[VERIFIED: source read for the SQL half; MEDIUM for the PostgREST partial-upsert semantics — see
Assumption A-1, which the planner should confirm empirically against the TEST DB.]`

This pair is exactly the SC#2 falsification criterion, grounded: a fresh-`computed_at` /
old-`computing_started_at` row must reap; an old-`computed_at` / fresh-`computing_started_at` row
must not.

### C-3 (CRITICAL) — the SQL bridge writer cannot stamp `now()` unconditionally

`sync_strategy_analytics_status` branch (a) (`20260710150000:113-125`) is `PERFORM`ed **in-RPC** by
`mark_compute_job_done` and `mark_compute_job_failed` (per its own `COMMENT`, `:204`), and directly by
`job_worker.dispatch` on the DEFERRED outcome. It fires whenever *any* sibling job for the strategy is
non-terminal. On a 4-hop chain (§Threshold) it fires **many times** while the row is continuously
`computing`.

If the planner adds `computing_started_at = now()` to that `ON CONFLICT DO UPDATE`, the stamp is reset
on every hop and the reaper never fires. **That is the `updated_at` bug re-implemented in a new
column.** The stamp must be conditional on the *transition* into `computing`:

- **Preferred (invariant-correct, independent of the clearing discipline):**
  `computing_started_at = CASE WHEN <resolved status> = 'computing' AND strategy_analytics.computation_status IS DISTINCT FROM 'computing' THEN now() ELSE strategy_analytics.computing_started_at END`
- **Weaker (depends on the NULL-on-exit discipline holding everywhere):**
  `COALESCE(strategy_analytics.computing_started_at, now())`

Note further that branch (a) can resolve to `complete_with_warnings` instead of `computing` (its own
`CASE`, `:117-122`). The stamp expression must key off the **resolved** status, not the branch.

### C-4 (HIGH) — two of CONTEXT.md's three writer coordinates are wrong

| CONTEXT.md claim | Reality |
|------------------|---------|
| `analytics-service/routers/portfolio.py:~652` | Writes **`portfolio_analytics`** (`insert({"portfolio_id": …, "computation_status": ComputationStatus.COMPUTING.value})`, `:651-653`). Different table, different phase's surface. **Not a `strategy_analytics` writer.** |
| `analytics-service/services/job_worker.py:~1853` | A **comment** (`"# upsert computation_status back to 'computing' / 'complete'."`). The nearest actual write is `:1890`, which writes `'failed'`. **Not a `computing` writer.** |
| `analytics-service/services/analytics_runner.py:~1229` | ✅ Correct — the single Python `computing` writer. |

The missing second writer is the SQL RPC (C-3). See §Writer Census for the audited full set.

### C-5 (HIGH) — the superseded one-off script is **broken code**, not a reference implementation

`analytics-service/scripts/reset_stuck_computing_rows.py:64` selects `"strategy_id, updated_at"` and
`:66` filters `.lt("updated_at", threshold)` on a table with no such column. Under PostgREST this
yields `42703 undefined_column`. The script is referenced nowhere except `CHANGELOG.md:9797` and its
own docstring; no test covers it. **[VERIFIED: file read + repo-wide grep]**

Its *semantics* are still the right reference (§Superseded One-Off), but the CONTEXT.md framing "its
query shape … is the reference semantics" must not be read as "it works today." Disposition
recommendation: **delete it** in this phase (nothing imports it; keeping a broken second
implementation is the divergence CONTEXT.md warns against).

### C-6 (MEDIUM) — the named threshold formula is the `compute_jobs` formula

CONTEXT.md and JOB-03 both write the formula as `batch_size × max_per_kind_timeout`. That is verbatim
the `compute_jobs` derivation from `20260720120000:24-25`. It measures how long **one claimed job**
can legitimately sit `running`. A `strategy_analytics` row sits `computing` for the whole **multi-hop
job chain**, which is a strictly larger quantity (§Threshold). Copying the *formula* is the same
mistake as copying the *number*, one level up. The planner must re-derive, not re-apply.

### C-7 (MEDIUM, informational) — Phase 144's mechanism is a primary *generator* of this phase's condition

`retention_compute_jobs_orphaned_running` **DELETEs** orphaned `running` rows
(`20260720120000:68-71`). After that delete, a strategy whose worker died mid-chain has
`strategy_analytics.computation_status='computing'` and **zero** `compute_jobs` rows — precisely the
JOB-02 predicate. CONTEXT.md correctly keeps the two janitors as separate mechanisms, but planning
should note the coupling: the daily 04:15 purge is what *manufactures* reapable rows today, and
Phase 144's DELETE→terminal-UPDATE change will **not** by itself heal them (the cron `UPDATE` does not
call `sync_strategy_analytics_status`). This reaper is still required after 144 lands.

---

## `strategy_analytics` Schema Reality

**Base table** — `supabase/migrations/20260405061911_initial_schema.sql:69-96`:

```sql
CREATE TABLE strategy_analytics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  strategy_id UUID NOT NULL UNIQUE REFERENCES strategies ON DELETE CASCADE,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  computation_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (computation_status IN ('pending','computing','complete','failed')),
  computation_error TEXT,
  benchmark TEXT, cumulative_return DECIMAL, cagr DECIMAL, volatility DECIMAL,
  sharpe DECIMAL, sortino DECIMAL, calmar DECIMAL, max_drawdown DECIMAL,
  max_drawdown_duration_days INTEGER, six_month_return DECIMAL,
  sparkline_returns JSONB, sparkline_drawdown JSONB, metrics_json JSONB,
  returns_series JSONB, drawdown_series JSONB, monthly_returns JSONB,
  daily_returns JSONB, rolling_metrics JSONB, return_quantiles JSONB,
  trade_metrics JSONB, data_quality_flags JSONB
);
```

**Additive columns since:**

| Column | Migration | Shape |
|--------|-----------|-------|
| `volume_metrics`, `exposure_metrics` | `20260412125725:52-53` | `JSONB`, nullable |
| `computation_warned` | `20260708120000:57-58` | `BOOLEAN NOT NULL DEFAULT FALSE`, backfilled from `computation_status='complete_with_warnings'` |
| `metrics_json_by_basis` | `20260710120000:134-141` | `jsonb` nullable, **no default, no backfill, no SET NOT NULL** (the migration header calls a NOT NULL here "a 23502 timebomb") + a shape CHECK `strategy_analytics_metrics_by_basis_shape` |

`20260710120000:131-133` is the **exact precedent to copy** for the `computing_started_at` DDL shape
and its stated rationale. CONTEXT.md's column-shape decision matches it verbatim. **[VERIFIED]**

**`computation_status` domain** — widened by
`20260602120000_strategy_analytics_computation_status_add_complete_with_warnings.sql:43-46`:

```sql
ALTER TABLE strategy_analytics DROP CONSTRAINT IF EXISTS strategy_analytics_computation_status_check;
ALTER TABLE strategy_analytics ADD CONSTRAINT strategy_analytics_computation_status_check
  CHECK (computation_status IN ('pending','computing','complete','complete_with_warnings','failed'));
```

Pinned TS-side by `src/lib/closed-sets.ts:423` (`STRATEGY_ANALYTICS_COMPUTATION_STATUSES`) and gated by
`src/__tests__/contracts/check-zod-db-check-parity.test.ts:202-209`. **Terminal `failed` is already in
the set — this phase adds no enum value and does not touch that parity test.** **[VERIFIED]**

**RLS** — `supabase/migrations/20260405061912_rls_policies.sql:35-44`:

```sql
CREATE POLICY analytics_read ON strategy_analytics FOR SELECT USING (
  EXISTS (SELECT 1 FROM strategies s
          WHERE s.id = strategy_analytics.strategy_id
            AND (s.status = 'published' OR s.user_id = auth.uid())));
CREATE POLICY analytics_insert_deny ON strategy_analytics FOR INSERT WITH CHECK (false);
CREATE POLICY analytics_update_deny ON strategy_analytics FOR UPDATE USING (false);
```

Owner can SELECT; **all** authenticated writes are denied. The reaper therefore runs as
`SECURITY DEFINER` (or as pg_cron's `postgres` superuser role, which bypasses RLS). Note per the
`migration-reviewer` BYPASSRLS invariant: `service_role` bypasses RLS anyway, so these deny-policies
are not the security boundary for the writers.

**Triggers:** none on `strategy_analytics`. **[VERIFIED: grep of all 231 migrations for
`CREATE TRIGGER … ON …strategy_analytics` returned nothing]**

**Indexes:** none beyond the PK and the `strategy_id` UNIQUE. There is **no** partial
`WHERE computation_status='computing'` index (the `idx_strategy_analytics_series_payload_present` hit
in grep is on the *sibling* `strategy_analytics_series` table). The reaper's `LIMIT`-bounded scan needs
one — see §Migration Shape. **[VERIFIED]**

**Error-message column:** `computation_error TEXT`. This is the column every existing failure path
writes and every consumer reads — see §Terminal State & Message. **Do not invent a field.**

**⚠️ `src/lib/database.types.ts` is STALE.** Its `strategy_analytics` Row (`:2477-2506`) is missing
`computation_warned` and `metrics_json_by_basis`. No CI gate enforces its freshness (grep of
`package.json` + `.github/workflows/ci.yml` for `database.types` returns nothing). So a new column
does **not** require regenerating it — but the planner should decide explicitly whether to add
`computing_started_at` to the hand-maintained `src/lib/types.ts:288` interface (recommended: yes, one
line, so the drift is not widened) rather than leaving it implicit.

---

## Writer Census — the complete, audited set

Method: `grep -rn 'table("strategy_analytics")' analytics-service --include='*.py'` (39 hits, each
context-dumped), `grep -rn '"computation_status"' analytics-service --include='*.py'`,
`grep -rn "computation_status" src --include='*.ts' --include='*.tsx'`, plus a read of every migration
that writes `strategy_analytics`. **[VERIFIED]**

There is an existing in-repo census at `src/app/api/keys/sync/route.ts:41-59` ("Direct-writes audit
(D.10)"). It is **accurate but incomplete** — it lists (a) the RPC, (c) `analytics_runner.py`,
(d) `portfolio.py` (correctly noted as portfolio-only), (e) the migration-001 default, (f)
`set_wizard_composite_members`. It omits the Next.js `failed` placeholder writers and every
`job_worker.py` terminal write. Planning should update it in the same PR (it is a documented invariant
comment on a live route).

### A. Writers that set `computation_status = 'computing'` — **exactly 2**

| # | Site | Form | Can it stamp in the same statement? |
|---|------|------|--------------------------------------|
| W1 | `analytics-service/services/analytics_runner.py:1227-1232` — `_mark_computing()` inside `run_csv_strategy_analytics` | supabase-py `.upsert({...}, on_conflict="strategy_id")` (PostgREST `INSERT … ON CONFLICT DO UPDATE`) | **Yes, trivially** — add `"computing_started_at": <ts>` to the dict. ⚠️ It must be a **client-side** timestamp (`datetime.now(timezone.utc).isoformat()`); PostgREST cannot express SQL `now()` in a payload. Clock-skew between the Railway worker and Supabase becomes a (small, bounded) factor — worth one sentence in the migration header. This is an unconditional entry-write (every invocation genuinely transitions into `computing`), so an unconditional stamp is **correct here**. |
| W2 | `sync_strategy_analytics_status(uuid)` branch (a) — latest definition `supabase/migrations/20260710150000_sync_status_supersede_failed_per_kind.sql:113-125` | plpgsql `INSERT … ON CONFLICT (strategy_id) DO UPDATE` inside a `SECURITY DEFINER SET search_path = public, pg_catalog` function | **Yes**, but **only conditionally** — see C-3. Requires a `CREATE OR REPLACE FUNCTION` re-based on `20260710150000` (see §Re-basing). |

`run_csv_strategy_analytics` is reached **only** from `job_worker.py:1945-1947` (the
`compute_analytics_from_csv` handler). The trades-based HTTP `compute_analytics` route was deleted in
Stage B 106-07/08/09 and is grep-gated by `tests/test_dark_path_deleted.py` (`analytics_runner.py:1-19`
docstring). ⇒ **a W1-written `computing` row always has a live `compute_jobs` row in `running`.**
**[VERIFIED]**

### B. Writers that transition **out of** `computing` (must clear the stamp) — 14 sites

**Python — `analytics-service/services/analytics_runner.py`:**
| Line | Status written | Notes |
|------|----------------|-------|
| `:1270-1281` | `failed` | insufficient CSV history; clears `computation_warned` |
| `:1506-1508` | `complete` / `complete_with_warnings` (`csv_status`, `:1490`) | the success path |
| `:1589-1604` | `failed` | pagination truncation |
| `:1630-1642` | `failed` | malformed `returns_denominator_config` |
| `:1680-1690` | `failed` | catch-all unrecoverable |

**Python — `analytics-service/services/job_worker.py`:**
| Line | Status written | Notes |
|------|----------------|-------|
| `:1890-1905` | `failed` | follow-on enqueue failure |
| `:2326-2341` | `failed` | |
| `:2440-2453` | `failed` | |
| `:4317-4333` | `failed` | insufficient broker history |
| `:5132-5141` | `failed` | composite arm |
| `:6637`/`:6744-6746` | `complete` / `complete_with_warnings` (`composite_status`, `:6633`) | composite headline write |

**SQL — `sync_strategy_analytics_status`, `20260710150000`:**
| Line | Status written |
|------|----------------|
| `:174-181` | branch (b) → `failed` |
| `:189-200` | branch (c) → `complete` / `complete_with_warnings` |

**TypeScript (Next.js) — placeholder `failed` writers:**
| Site | Notes |
|------|-------|
| `src/app/api/strategies/finalize-wizard/route.ts:1479` and `:1541` | |
| `src/app/api/strategies/csv-finalize/route.ts:767-768` | |
| `src/app/api/keys/sync/route.ts:532-534` | |

**Also transitions out of `computing`-adjacent states (does NOT touch `computing`):**
`set_wizard_composite_members` (`20260712120000:186-189`) resets `complete`/`complete_with_warnings`
→ `pending`, explicitly scoped so it "never [touches] a computing row the worker owns" (`:197`).
No stamp handling needed.

**Partial upserts that must NOT be broken:** `job_worker.py:1702`, `:4875`, `analytics_runner.py:1555`
upsert `{strategy_id, data_quality_flags…}` only. Because PostgREST merge-duplicates writes only the
supplied columns, these do not disturb `computation_status` or a future `computing_started_at`. A
naive "add the stamp everywhere" sweep would break this. **[VERIFIED]**

### C. Planning implication for the CI stamp invariant (JOB-01)

CONTEXT.md locks a **static CI invariant** that fails if any `computing` write site lacks a co-located
stamp. With only two `computing` writers — one Python, one SQL — the invariant is cheap and should be
written to cover **both runtimes**:

- Python half: AST-walk `analytics_runner.py` (and, defensively, all of `analytics-service/`) for any
  dict literal containing `"computation_status": "computing"` and assert the same literal carries
  `"computing_started_at"`. Mirrors the AST-oracle discipline already used in
  `tests/test_limiter_identity.py` (PYAPI-03) and the `_SHAPES` AST fence (PYAPIFIX2-05).
- SQL half: read the deployed `pg_get_functiondef('sync_strategy_analytics_status(uuid)')` — the
  migration's own self-verify `DO $$` block already does exactly this at `20260710150000:213-217`, so
  the pattern is in-house. A `supabase/tests/test_*.sql` gate can assert the deployed body contains
  `computing_started_at` in branch (a).

⚠️ **A grep-only invariant would be toothless**: the SQL writer lives in a `.sql` file, not Python. An
invariant that only scans Python passes green while the larger writer is unstamped. Per memory
`feedback_gsd_subagent_write_truncates_planning` / the repo's e2e grep-gate lesson: **grep the whole
repo, not `src/` or `services/` alone.**

---

## Threshold Derivation

### The constants (named symbols the plan can cite)

| Symbol | Value | Location |
|--------|-------|----------|
| `p_batch_size` | `5` | `analytics-service/main_worker.py:470` and `:511` (both claim RPC payloads) |
| `TIMEOUT_PER_KIND` | dict, seconds | `analytics-service/services/job_worker.py:476-493` |
| — `process_key_long` | `30 * 60` | `:487` |
| — `reconstruct_allocator_history` | `30 * 60` | `:485` |
| — `stitch_composite` | `20 * 60` | `:489` |
| — `sync_trades` | `15 * 60` | `:477` |
| — `derive_broker_dailies` | `15 * 60` | `:488` |
| — `compute_analytics_from_csv` | `10 * 60` | `:478` |
| default handler timeout (unknown kind) | `5 * 60` | `job_worker.py:8090` |
| `WATCHDOG_PER_KIND_OVERRIDES` | dict, interval strings | `main_worker.py:207-243` |
| global watchdog default | `"10 minutes"` | `main_worker.py:798` (`watchdog_tick`'s `p_stale_threshold`), mirrored as `DEFAULT_WATCHDOG_INTERVAL` in the test at `tests/test_main_worker.py:1039` |
| retry backoff | attempt 1 → +30s, 2 → +2min, else → +8min | `20260505115047_mark_compute_job_atomic_status_bridge.sql:209` (RPC `COMMENT`) |
| `max_attempts` default | `3` | `job_worker.py:8171` |
| `STALE_THRESHOLD` (healthz) | `90.0` seconds | `main_worker_healthz.py:29` |
| `_HEARTBEAT_INTERVAL_S` | `30` (env `WORKER_HEARTBEAT_INTERVAL_S`), asserted `0 < x < STALE_THRESHOLD` | `main_worker.py:136-141` |

### The existing invariant to mirror

`analytics-service/tests/test_main_worker.py:994-1084`, class `TestWatchdogInvariant`, three methods:

- `test_watchdog_threshold_exceeds_handler_timeout` (`:1000`) — iterates the **overrides**.
- `test_every_kind_has_watchdog_headroom` (`:1020`) — iterates `TIMEOUT_PER_KIND` (**the source of
  truth**) and asserts `watchdog_seconds > handler_seconds` for every kind, including those taking the
  default. This is the structure JOB-03 names.
- `test_watchdog_threshold_has_sane_upper_bound` (`:1053`) — a `MAX_RATIO = 4.0` typo-catcher. Worth
  mirroring for the reaper threshold too (a `'40 hours'`-for-`'40 minutes'` typo is the same class).

Second consumer to keep consistent: `analytics-service/tests/test_job_worker_csv_kind.py:109-135`
(`test_existing_watchdog_headroom_invariant_holds`), which re-asserts the same rule with a local
`_parse_minutes` helper. **[VERIFIED]**

### The `compute_jobs` derivation (for contrast — do NOT copy)

`20260720120000:24-29`: `p_batch_size (5) × max per-kind timeout (30 min) = 2.5h`; window set to 4h
(1.5h margin). This bounds how long **one claimed row** can legitimately sit `running`. Batch claim
stamps one `claimed_at` for all 5, and dispatch is sequential (`main_worker.py:605` `for job in jobs:`).

### The `strategy_analytics` derivation (the real one)

A `strategy_analytics` row is `computing` for as long as **any** `compute_jobs` row for that strategy
is in `{pending, running, done_pending_children, failed_retry}` (bridge branch (a), `20260710150000:110-112`).
That is a **multi-hop chain**, not one job. The verified chains:

```
process_key_long (30m)                                     [routers/process_key.py, long_fetch.py]
   └─ tail_kind = derive_broker_dailies | sync_trades      [long_fetch.py:583, enqueued :592]
        sync_trades (15m)
           └─ derive_broker_dailies (15m)                  [job_worker.py:1857-1863]
                └─ compute_analytics_from_csv (10m)        [job_worker.py:4884-4889]
```
plus the standalone composite arm `stitch_composite (20m)` and the daily cron re-entry
`derive_broker_dailies` (`routers/cron.py:481-488`).

Worst-case wall clock for the longest chain, per hop:
`(p_batch_size − 1) × max_per_kind_timeout` (waiting for preceding batch members)
`+ own handler timeout` `+ retry budget (≤ 3 attempts, ≤ +8 min backoff each)`.

With 4 hops at `4 × 30 min = 120 min` of batch-tail exposure each, plus `30+15+15+10 = 70 min` of own
handler time, the ceiling is on the order of **~9 hours**, not 2.5. **The formula CONTEXT.md and
JOB-03 name (`batch_size × max_per_kind_timeout` = 2.5h) under-estimates this table's window by
roughly 4×.** A 2.5h or 4h threshold would reap live, healthy multi-hop chains — the same
false-positive class the 2h→4h widening closed on `compute_jobs`.

### ⭐ Recommended framing: the `NOT EXISTS` clause is the safety, the interval is a debounce

JOB-02's predicate is a **conjunction**: stuck past threshold **AND** no active `compute_jobs` row.
The second clause already excludes every live chain — a healthy in-flight chain, at every moment,
has a non-terminal `compute_jobs` row (each follow-on is enqueued *inside* the parent handler,
**before** it returns DONE: `job_worker.py:1865` and `:4891` both `await db_execute(_enqueue…)` ahead
of `return DispatchResult(DONE)`, and `main_worker.py` only calls `mark_compute_job_done` **after**
`dispatch` returns).

So the time threshold is not carrying the batch-tail safety — it is a **debounce over the narrow
window between "the last job flips terminal" and "the bridge writes the terminal status."** That
window is *inside one transaction* (`mark_compute_job_done` `PERFORM`s
`sync_strategy_analytics_status` in-RPC, per its `COMMENT` at `20260710150000:204`), so it is
sub-second in the happy path and bounded by a retry/network blip otherwise.

**Recommendation for the planner:** derive the threshold as the **maximum legitimate gap during which
a row can be `computing` with zero active `compute_jobs` rows**, then add margin. Enumerate the real
generators of that gap:
1. `mark_compute_job_done` succeeded but the in-RPC bridge `PERFORM` did not commit — impossible
   (same transaction), so 0.
2. The parent handler returned DONE, the follow-on enqueue **failed** — but every such arm writes
   `failed` to `strategy_analytics` itself (`job_worker.py:1890`), except `long_fetch.py:585-600`,
   which only logs. **This is the one real hole → the primary reap generator besides (3).**
3. `retention_compute_jobs_orphaned_running` DELETEd the row (C-7) — the dominant generator today.
4. A `done` / `failed_final` row aged past the 30/90-day `retention_compute_jobs_*` crons while the
   strategy_analytics row was still `computing` — pathological but possible.

Whatever number is chosen, JOB-03 still requires the CI invariant that it **exceeds** every relevant
handler's batch-inclusive worst case — so the invariant must compute the **chain-inclusive** ceiling,
not `batch_size × max(TIMEOUT_PER_KIND)`. The chain topology (which kind enqueues which) should be
lifted into a **named module-level constant** in `analytics-service/` so the test reads it rather than
re-deriving it — otherwise the oracle is self-referential (Rule 9 / memory
`feedback_economic_invariant_oracles_not_self_referential`).

### Honest scope note on the 15-minute cadence

`SyncPreviewStep.tsx:112` sets `RETRY_THRESHOLD_MS = 900_000` (15 min) as the stall backstop, and
`POLL_BACKOFF_MS` (`:123`) holds at 10s indefinitely. A **live** wizard session therefore already
escalates on its own at 15 minutes. With a threshold in the hours, this reaper **does not rescue a
live poll** — its value is the **page-refresh / return-later** path and the factsheet surface, which
is exactly what the ROADMAP success criterion says ("a wizard poll **or a page refresh** sees a real
terminal outcome"). Planning should not claim the live-poll win.

---

## pg_cron Migration Pattern in THIS Repo

### The house shape (both retention migrations, read end to end)

`supabase/migrations/20260719120000_retention_orphaned_running_compute_jobs.sql` and
`20260720120000_retention_orphaned_running_window_4h.sql`:

1. **Long prose header** — "Why this migration exists", the correctness rationale with cited
   file:line evidence, an explicit scope-discipline section ("touches ONLY the new purge cron"), and
   an idempotency note.
2. `BEGIN;` then `SET lock_timeout = '5s';`
3. A `DO $$ … END $$;` block that:
   - `SELECT EXISTS(SELECT 1 FROM pg_extension WHERE extname='pg_cron') INTO v_has_pg_cron;` and
     `RAISE EXCEPTION … USING ERRCODE='feature_not_supported'` if absent (**fail loud, never a silent
     skip**);
   - idempotent `IF EXISTS (SELECT 1 FROM cron.job WHERE jobname=…) THEN PERFORM cron.unschedule(…)`;
   - `PERFORM cron.schedule('<jobname>', '<cron expr>', $cron$ …SQL… $cron$);`
   - a closing `RAISE NOTICE`.
4. A **second, separate self-verifying `DO $$` block** that re-`SELECT command FROM cron.job` and
   `RAISE EXCEPTION` on each predicate shape it expects (`ILIKE '%status = ''running''%'`,
   `ILIKE '%interval ''4 hours''%'`, a **negative** assertion that the old value is gone,
   `ILIKE '%public.compute_jobs%'`).
5. `COMMIT;`

### Answers to the specific questions

- **`cron.schedule` invocation:** `PERFORM cron.schedule(jobname, schedule, $cron$ body $cron$)` inside
  a `DO` block. **[VERIFIED]**
- **Naming:** existing job names are snake_case and prefixed by purpose — `retention_compute_jobs_done`,
  `retention_compute_jobs_failed`, `retention_compute_jobs_orphaned_running`,
  `retention_notification_dispatches`, `resend_message_correlation_retention_90d`,
  `audit_log_hot_to_cold`, `audit_log_cold_purge`, `match_engine_cron`,
  `compute_bridge_outcome_deltas`, `api_key_rotation_reminder`. Ten jobs across 15 migrations.
  Suggested: `reap_strategy_analytics_stuck_computing` or, to match the retention family,
  `retention_strategy_analytics_stuck_computing`. **[VERIFIED]**
- **Inline statement vs named function:** the **compute_jobs retention crons use an inline literal
  body** (explicitly: "Body is a FIXED LITERAL (no interpolation, no dynamic SQL) and schema-qualified
  … so resolution is independent of the cron session search_path", `20260719120000:88-90`). The
  **portfolio_analytics reaper uses a named SECDEF function** (`reset_stalled_portfolio_analytics`,
  `20260516122247:25-56`) called from Python, **not** from pg_cron.
  **Recommendation: inline literal body.** It matches the pg_cron family, avoids the entire
  SECDEF/ACL surface (see below), and makes the deployed body directly assertable by the SQL gate
  (`EXECUTE v_command` — the oracle discipline in `supabase/tests/test_retention_orphaned_running.sql:156-158`).
  If a named function is chosen instead, see the CRITICAL-2 warning below.
- **SECURITY DEFINER usage:** repo convention is `SECURITY DEFINER SET search_path = public, pg_catalog`
  (never bare `public`, never `''`) — `sync_strategy_analytics_status` (`20260710150000:79-81`),
  `reset_stalled_portfolio_analytics` (`20260516122247:30-31`). pg_cron bodies run as the job owner
  (`postgres`) and need no SECDEF at all.
- **⛔ CRITICAL-2 precedent (binding if a named function is chosen):**
  `20260516170100_reset_stalled_portfolio_analytics_revoke_public.sql` is a whole migration whose sole
  purpose was fixing this exact shape. Quoting `:3-12`: a SECDEF reaper with a **caller-controlled
  `p_stale_threshold`** and default `PUBLIC EXECUTE` let *any authenticated user* pass
  `interval '1 second'` and flip **every tenant's** in-flight rows to `failed`. The `migration-reviewer`
  agent's invariant #20 names this incident by file. Therefore, if a function is created:
  - `REVOKE ALL ON FUNCTION … FROM PUBLIC, anon, authenticated; GRANT EXECUTE … TO service_role;`
    **in the SAME migration that CREATEs it** (invariant #20's stated fix);
  - self-verify with `PERFORM public._assert_no_public_execute('public.<fn>(…)')` — the helper exists,
    defined in `20260515205431_sec_def_public_execute_guard.sql`, used at
    `20260515210100:491`, `20260515210000:459`, `20260516160100:278`;
  - **strongly prefer a hardcoded threshold literal over a parameter** — the parameter *is* the
    attack surface.
- **Schedule hour band:** `supabase/tests/test_retention_orphaned_running.sql:107-114` asserts the cron
  **hour** field sits in `1..22` (mirroring `test_derive_allocator_keys_fanout.sql` assertion 6). A
  15-minute cadence (`*/15 * * * *`) has hour `*`, which `(split_part(schedule,' ',2))::INT` would
  fail to cast. Planning must **not** copy that assertion verbatim into the new gate — it does not
  apply to a sub-hourly schedule. Flagging it because a copy-paste here reddens CI.
- **Timestamp-prefix convention:** `YYYYMMDDHHMMSS_snake_name.sql`, enforced by
  `.github/workflows/migration-policy.yml` (a `pull_request` check on `supabase/migrations/**`) which
  rejects a newly-added migration whose timestamp is **older than the remote applied tip** unless
  listed in `.github/migrate-backdated-allowlist.txt`. Current repo tip:
  **`20260728120000_csv_finalize_double_submit_idempotency.sql`**. A new migration must be
  `> 20260728120000` — e.g. `20260802HHMMSS_…`. **[VERIFIED]**
- **WR-02 constraint check:** the standing DEFERRED decision (TEST-DELETEs / PROD-resets on
  `compute_jobs`) is scoped entirely to `public.compute_jobs`
  (`20260720120000:31-36`, memory `project_worker04_purge_delete_vs_reset_prod_outage`). It places
  **no constraint on this phase** beyond C-7's informational coupling. Phase 144 owns it.

### ⚠️ Conflict: `migration-reviewer` invariant #14 vs. the repo's actual convention

`.claude/agents/migration-reviewer.md:92-94` says "`BEGIN`/`COMMIT` should NOT appear in a migration
(Supabase wraps them)" and "`SET` (session-level) is HIGH conf ≥ 7."

**The repo does the opposite, consistently and recently:** 150 of 231 migrations open with `BEGIN;`,
including both retention crons and the latest migration on `main`
(`20260728120000`). Every one of them follows `BEGIN;` with `SET lock_timeout = '5s';`.

Per CLAUDE.md Rule 7 (surface conflicts, pick the more recent / more tested): **follow the repo
convention** (`BEGIN; SET lock_timeout='5s'; … COMMIT;`) and note the deviation for the reviewer so
the finding is pre-answered rather than re-litigated in review. Two caveats stand regardless:
`ROLLBACK` must never appear outside a `supabase/tests/` file, and `CREATE INDEX CONCURRENTLY` cannot
sit inside the transaction (invariant #5) — see §Migration Shape.

---

## Migration Shape (recommended)

Two structural notes that follow from the above:

1. **The partial index and the transaction.** The reaper's bounded scan wants
   `... ON public.strategy_analytics (computing_started_at) WHERE computation_status = 'computing'`.
   `CREATE INDEX CONCURRENTLY` **cannot** run inside the `BEGIN … COMMIT` (migration-reviewer #5;
   Supabase CLI #1437/#1769). The in-repo precedent for doing it correctly is
   `20260516170400_portfolio_analytics_computing_idx_concurrently.sql`, which splits into
   PHASE 1 (`BEGIN; … DROP …; COMMIT;`) then PHASE 2 (`CREATE INDEX CONCURRENTLY` with **no**
   transaction wrapper) then a verification `DO` block.
   For a **new** index there is no DROP, so the simplest correct option is a **plain, non-concurrent
   `CREATE INDEX`** inside the transaction — `strategy_analytics` has one row per strategy and the
   partial predicate makes the index tiny, so the brief `ACCESS EXCLUSIVE` is acceptable. If the
   planner prefers CONCURRENTLY, it must live outside the `BEGIN…COMMIT` (and migration-reviewer #18's
   DROP+CONCURRENTLY planner-blind-window finding does **not** apply, since nothing is dropped).
2. **Migration ordering within the file.** DDL → backfill → writer-side `CREATE OR REPLACE FUNCTION`
   (re-based, see below) → `cron.schedule` → self-verify `DO` block. The backfill must run **before**
   the cron is scheduled, or the first tick sees a table full of NULL stamps and (per CONTEXT.md's
   NULL-skip decision) silently skips every genuinely-stranded prod row while emitting a Sentry
   warning per row.

### ⭐ Re-basing discipline for `sync_strategy_analytics_status`

The function has **four** definitions across history:
`20260412094454` → `20260707120000` → `20260708120000` → **`20260710150000` (LATEST — re-base on this)**.

Memory `project_cross_cutting_refactor_program` and the header of `20260708120000:40-44` both spell out
the rule: *grep ALL migrations and re-base on the LATEST definition.* Getting this wrong silently
reverts the F-3/PUB-02 per-kind supersession logic (`20260710150000:145-181`) — a money-path
regression with no test that would obviously catch it. The new definition must preserve, byte-for-byte
where untouched: branch (b)'s `NOT EXISTS`-supersession subquery, the `computation_warned` reads in
branches (a) and (c), `SECURITY DEFINER`, `SET search_path = public, pg_catalog`, the
`REVOKE ALL ON FUNCTION … FROM PUBLIC, anon, authenticated` (`:207`), the `COMMENT` (which must gain
the `computing_started_at` clause), and the self-verify `DO` block (`:209+`).

---

## The Superseded One-Off (`reset_stuck_computing_rows.py`)

Full read: `analytics-service/scripts/reset_stuck_computing_rows.py` (112 lines).

**Its predicate**, per the docstring (`:3-7`) and code:
- `computation_status = 'computing'` (`:65`)
- **AND** last updated more than **5 minutes** ago (`:61`, `:66`) — via the non-existent
  `updated_at` column (C-5)
- **AND** no `compute_jobs` row for that `strategy_id` with `status IN ('pending','running','done_pending_children','failed_retry')` (`:82-89`)

That non-terminal status list is **byte-identical** to the bridge's own branch-(a) list
(`20260710150000:111-112`). ⭐ **Use that exact set** — it is the definition of "active" everywhere
else in the system, and any divergence would make the reaper and the bridge disagree about whether a
strategy is in flight.

**What it writes on reap** (`:97-102`):
```python
supabase.table("strategy_analytics").update(
    {"computation_status": "failed",
     "computation_error": "Sync was interrupted during platform upgrade. Please retry."}
).eq("strategy_id", sid).eq("computation_status", "computing").execute()
```

**Things a naive SQL reaper would miss:**
1. **The `.eq("computation_status","computing")` re-check on the UPDATE** (`:102`) — a compare-and-set
   fence against the row having advanced between the SELECT and the UPDATE. In SQL this is the
   `WHERE computation_status = 'computing'` clause; do not drop it when adding a `LIMIT`/CTE.
2. **Per-strategy filtering, not a bulk UPDATE** — it skips (and *logs*) each candidate that has an
   active job. A single bulk SQL statement with a `NOT EXISTS` gets the same result more cheaply, but
   loses the per-skip observability. Planning should decide whether the reaper reports skip counts.
3. **⚠️ What the script itself gets WRONG and must not be copied: it does not clear
   `computation_warned`.** Every other terminal-`failed` writer in the repo does
   (`analytics_runner.py:1275`, `job_worker.py:1893`, `:2330`, `:2443`, `:4321`, `:5135`, all tagged
   `SI-02 (MEDIUM-2)`). If the reap leaves `computation_warned = TRUE`, the next
   `sync_strategy_analytics_status` call for that strategy resolves branch (a) or (c) to
   `complete_with_warnings` (`20260710150000:117-121`, `:192-197`) — **laundering the reap into a
   success**. See Pitfall P-4.
4. It is idempotent by construction (its own `:14-17`) — preserve that.

**Disposition recommendation: DELETE.** Nothing imports it; no test covers it; its only reference is
a `CHANGELOG.md:9797` history line; and it is broken as written. Retaining it with a "superseded"
header keeps a second, divergent, non-executing implementation of the same reap — the exact thing
CONTEXT.md's last bullet forbids.

---

## Prior Art / Duplication Risk

### `routers/cron.py` — the `portfolio_analytics` orphan reap

`analytics-service/routers/cron.py:867-893` (CONTEXT.md's `:868-939` covers this plus the
`_guarded_recompute` in-flight check at `:924-959`).

What it does: inside the `cron_recompute` HTTP handler, before recomputing portfolios, it calls
`supabase.rpc("reset_stalled_portfolio_analytics", {"p_stale_threshold": "30 minutes"})` and logs the
reaped count; failure is non-fatal but `logger.exception`-ed to Sentry (`:885-893`).

**Does it touch `strategy_analytics`?** **No.** The RPC's body
(`20260516122247:43-50`) is `UPDATE portfolio_analytics … WHERE computation_status='computing' AND
computed_at < now() - p_stale_threshold`. The follow-on in-flight check (`:936-942`) also queries
`portfolio_analytics`. **[VERIFIED — zero overlap]**

**Overlap / race with the new reaper:** none. Different table, different predicate, different
transport. The de-duplication CONTEXT.md defers is a *cosmetic* consolidation, not a correctness
concern.

**Two things to carry across, though:**
- ⚠️ It runs **on the API service's event loop**, invoked from an HTTP route — *not* on the worker
  loop. The API service (`uvicorn main:app`, `Dockerfile:39`) and the worker (`python -m main_worker`,
  a CMD override per `Dockerfile:1-8`) are **separate Railway processes**. So this prior art does not
  violate JOB-07, and it is also not a precedent for putting the new reaper anywhere but pg_cron.
- Its threshold basis (`computed_at`, 30 min) is sound **only because `portfolio_analytics` is
  append-only** — `routers/portfolio.py:631` says "Inserts a new portfolio_analytics row (immutable
  history — no upsert)". This is the single sentence that explains why the "in-repo twin to clone" is
  not clonable onto an upsert-keyed table (C-2).

---

## Terminal State & User-Facing Message

**The column is `computation_error`.** Confirmed at both ends:

- **Writers**: every terminal-`failed` write in §Writer Census B populates it.
- **Reader (wizard)**: `src/hooks/useStrategySyncPoller.ts:199-231` selects
  `"computation_status, computation_error"` from `strategy_analytics` via the **authed** Supabase
  client (RLS `analytics_read` permits the owner) and threads both into `onStatus` / `onTerminal`.
- **Render**: `SyncPreviewStep.tsx:890-908` — on `nextStatus === "failed"` it sets
  `errorCode = "GATE_ANALYTICS_FAILED"` and `phase = "gate_failed"`, and
  `src/lib/wizardErrors.ts:1457-1463` appends `Details: ${computationError}.` to that code's `cause`.
- **Reader (factsheet / PDF)**: `src/app/api/factsheet/[id]/pdf/route.ts:231-232`,
  `tearsheet.pdf/route.ts:199-200` gate on `computation_status` ∈ {`complete`,
  `complete_with_warnings`}; `src/app/api/admin/strategy-review/route.ts:160,273` surfaces both fields
  to admins.

**The base copy already satisfies CONTEXT.md's requirements** — `wizardErrors.ts:663-673`:

```
title: "Analytics computation failed."
cause: "The analytics step failed for this draft. We cannot tell from here how much of the sync
        before it completed. The fault is in our pipeline, not at your exchange."
fix:  ["Retry the sync from this page.",
       "If it fails again, email security@quantalyze.com with your draft ID and the diagnostics below."]
actions: ["clear_and_retry", "request_call"]
```

Two consequences the planner can rely on:
1. **Our-fault attribution is already the shipped copy** ("The fault is in our pipeline, not at your
   exchange"). The reaper's `computation_error` string is appended as a *Details* line, not as
   standalone copy — it must **not** contradict or duplicate the base sentence, and must not
   re-attribute fault.
2. **A non-destructive retry is already offered.** `SyncPreviewStep.tsx:1655-1656` computes
   `kickoffRetryCanChangeTheOutcome = errorActions.includes("clear_and_retry")`, and
   `GATE_ANALYTICS_FAILED` carries that action — so `onRetry={handleKickoffRetry}` is passed
   (`:1678-1680`). **No frontend change is needed to satisfy CONTEXT.md's "non-destructive recovery
   affordance" decision.** The phase should verify this, not rebuild it.

**Recommended message shape** (Claude's discretion per CONTEXT.md), short because it lands inside
`Details: …`:
> `Analytics was interrupted before it could finish and did not recover. Retry the sync.`

It states what happened, attributes nothing to the user or their venue, names the recovery, and makes
no claim about how much of the prior work completed (the B-16/C-02 "no false claim about the user's
data" rule from SEAMUX-04). Avoid the one-off script's *"during platform upgrade"* — that is a
false-and-dated cause.

**Also required in the same UPDATE:** `computation_warned = FALSE` (Pitfall P-4) and
`computing_started_at = NULL` (CONTEXT.md's clear-on-exit rule — the reaper is itself an exit
transition and must obey its own invariant, otherwise a reaped row's stale stamp survives).

---

## JOB-07 Test Mechanics

**`STALE_THRESHOLD`**: `analytics-service/main_worker_healthz.py:29` — `STALE_THRESHOLD = 90.0`
(seconds).

**healthz implementation**: `main_worker_healthz.py` is stdlib-only (raw `asyncio.start_server`, manual
HTTP/1.1 response). `_handle_healthz` (`:32+`) computes `age = now - LAST_TICK_AT`, returns
`200 {"status":"ok",...}` when `age <= STALE_THRESHOLD`, else `503 {"status":"stale",...}`.
`LAST_TICK_AT` is written by `main_worker.dispatch_tick` at three points: after every claim RPC
(`main_worker.py:599`), at the top of each job iteration (`:616`), and by the `_heartbeat()` task
during a single long dispatch (`:643-645`, cancelled in `finally` at `:653`).

**The WEDGE-01 fix** (memory `project_stitch_composite_wedge01_fix_and_local_prod_worker`, "derive
`wait_for` + rescore `to_thread`") is the composition of the per-crawl `asyncio.wait_for` bound and
this mid-dispatch heartbeat.

### ⭐ The concrete test to mirror

**`analytics-service/tests/test_worker_isolation_e2e.py`** — read the docstring at `:1-26`; it is the
explicit WORKER-02 end-to-end proof and states its own oracle discipline ("the transition
classification is produced BY production code, the test only ASSERTS the returned DispatchResult
(P115 self-referential-oracle anti-pattern avoided)").

Reusable machinery, all in that file:
| Helper | Line | Purpose |
|--------|------|---------|
| `_free_ephemeral_port()` | `:48` | bind port 0, read assignment, release |
| `_wait_port_listening(port)` | `:62` | poll-connect until `serve_forever` |
| `_probe_healthz(port)` | `:80` | raw `GET /healthz HTTP/1.1` over TCP, 5s read guard |
| `_empty_claim_supabase()` | `:102` | MagicMock claim RPC returning `data=[]` |
| `TestHealthzTcpServerHonesty::test_healthz_stays_200_through_long_backfill` | `:119` | the positive case — shrinks `_HEARTBEAT_INTERVAL_S` to `0.02`, binds the **real** `start_healthz_server`, probes mid-dispatch, asserts `200 OK` **and** `LAST_TICK_AT > start_stamp` |
| `test_healthz_503_when_tick_stale` | `:182` | the **negative control** — forces `LAST_TICK_AT = time.time() - (STALE_THRESHOLD + 10)` and asserts `503` |

The negative control at `:182` is what makes the positive assertion falsifiable. **Any JOB-07 test
must carry an equivalent.**

### ⚠️ P-7 — the naive JOB-07 test cannot fail

CONTEXT.md locks the reaper into pg_cron. That means **there is no Python code path for a backlog to
stall**. A test that seeds "a large synthetic backlog" of stranded `strategy_analytics` rows and then
asserts `healthz` returns 200 will pass on an empty diff, pass after any refactor, and pass if
someone later moves the reaper into the worker loop *with the backlog fixture unchanged*. It is
exactly the "test that can't fail when business logic changes" Rule 9 forbids, and the
self-referential-oracle class the 140.x programme kept catching.

**Recommended falsifiable design (two halves, both cheap):**

- **Structural half (the real teeth).** An AST/grep gate asserting that no reaper identifier
  (the cron jobname, and any `reset_*strategy_analytics*` RPC name) appears in `main_worker.py`,
  `services/job_worker.py`, or any module reachable from `dispatch_tick`. Falsify by adding the call
  and observing RED. This is the same shape as the existing dark-path gate
  (`tests/test_dark_path_deleted.py`) and the `no private Limiter()` AST gate from PYAPI-03.
- **Behavioural half (the WEDGE-01 shape, with a positive control).** Mirror
  `test_worker_isolation_e2e.py`: bind the real healthz server, run `dispatch_tick` with a large
  synthetic backlog present, probe 200. Then, in the **same** test class, run a control where a
  deliberately loop-blocking synchronous reap (`time.sleep` / a tight CPU loop, *not* an `await`) is
  injected into the dispatch path, and assert the probe goes **503**. Without the control the green
  is meaningless.

Note the honest bound the file itself documents (`main_worker.py:637-641`): the heartbeat catches a
*loop-blocking* freeze but **not** a yielding single-job hang. Do not over-claim.

---

## Testing Harness Constraints

### What actually runs in CI

| Layer | Runner | Path pattern | CI job | Notes |
|-------|--------|--------------|--------|-------|
| SQL / RLS gates | `psql -v ON_ERROR_STOP=1 -f` | **`supabase/tests/test_*.sql`** | `sql-tests` in `.github/workflows/ci.yml:830-975` | ⭐ The ONLY SQL layer CI executes. Auto-discovered by glob — a new file needs **no** workflow edit. |
| Python | pytest | `analytics-service/tests/test_*.py` | `python` job | Must be run **from `analytics-service/`** (VCR cassette dir). `--cov-fail-under=80`. |
| TypeScript | Vitest 4.1.2 | `src/**/*.test.{ts,tsx}` | sharded `frontend-*` + `frontend-coverage` | Blocking coverage ratchet. |
| E2E | Playwright | `e2e/*.spec.ts` | `e2e` / `e2e-seeded` | Not needed for this phase. |

**Per memory `reference_db_test_ci_wiring`:** `*_live.py` and `skipIf`-guarded vitest **never run in
CI**. A DB-level assertion that must be enforced has to be a `supabase/tests/test_*.sql` file.

### pgTAP

**pgTAP is NOT installed.** Stated twice, authoritatively:
`supabase/tests/test_retention_orphaned_running.sql:42-44` ("pgTAP is NOT installed (CLAUDE.md). Plain
PL/pgSQL DO block, RAISE EXCEPTION on failure. No psql meta-commands.") and the `sql-tests` job comment
(`ci.yml:876-878`). **[VERIFIED]**

### How to write the reaper's DB gate

Copy `supabase/tests/test_retention_orphaned_running.sql` structurally. Its non-obvious properties:

1. **`BEGIN;` … `ROLLBACK;`** wrapping the whole file (`:54`, `:191`) — the shared TEST DB is not
   polluted. (This is the one place `ROLLBACK` is legitimate.)
2. **Two presence gates before any assertion** (`:71-83`): skip with `RAISE NOTICE` if `pg_cron` is
   absent (local dev) and if the cron job is not yet registered (test-DB lag). Without these, the gate
   reddens on every PR until the migration is MCP-applied to TEST.
3. **⭐ Oracle discipline (`:38-40`, `:156-158`): `EXECUTE v_command`** — it runs the **real deployed
   `cron.job.command`**, not a re-typed copy of the predicate. This is what makes the behavioural
   assertions pin the shipped body. Reproduce this exactly.
4. **Four-arm seed with both directions**, `:135-152`: a row that MUST be reaped, a fresh row that
   MUST survive, an out-of-scope-status row that MUST survive, and the boundary row (`3h`) whose
   survival is the RT-01 regression. **This is the template for SC#2's falsification pair** — seed a
   fresh-`computed_at`/old-`computing_started_at` row (MUST reap) and an
   old-`computed_at`/fresh-`computing_started_at` row (MUST NOT reap), plus a `computing` row WITH an
   active `compute_jobs` row (MUST NOT reap) and a `computing` row with a NULL stamp (MUST NOT reap,
   per CONTEXT.md's skip decision).
5. **Seeding real FK chains**: `auth.users` → `profiles` → `api_keys` → `compute_jobs`
   (`:119-133`). For `strategy_analytics` the chain is `auth.users` → `profiles` → `strategies` →
   `strategy_analytics` (FK `ON DELETE CASCADE`, `20260405061911:72`); `supabase/tests/test_metrics_by_basis_write.sql:63`
   shows a minimal `INSERT INTO strategy_analytics (strategy_id) VALUES (strat);`.
6. **Preflight filter**: the `sql-tests` job rejects any file containing `\!`, `\copy`, `\COPY`, `\o`
   (`ci.yml:891-935`). No psql meta-commands.
7. **Every `RAISE` format string must be a single literal** — no `||` concatenation
   (`migration-reviewer` invariant #21, SQLSTATE 42601, the PR #182 incident). Use `%` placeholders.

**Test-DB apply ordering:** per memory `project_supabase_migrate_auto_on_push`, MCP-apply the new
migration to TEST (`qmnijlgmdhviwzwfyzlc`) **before** merging, or the presence gate silently skips and
the phase ships with an unproven reaper.

---

## Don't Hand-Roll

| Problem | Don't build | Use instead | Why |
|---------|-------------|-------------|-----|
| Recurring DB janitor | A Python asyncio loop task, a Vercel cron, or a call from `main_worker` | **pg_cron**, the shape in `20260719120000`/`20260720120000` | Requirements "Out of Scope" forbids the first two by name; pg_cron makes JOB-07 true by construction. |
| "Is this strategy in flight?" | A new non-terminal status list | `status IN ('pending','running','done_pending_children','failed_retry')` — the bridge's own set, `20260710150000:111-112` | A divergent list makes the reaper and the UI status bridge disagree. |
| Cron-body assertion in a test | Re-typing the predicate into the test | `SELECT command FROM cron.job …; EXECUTE v_command;` | `test_retention_orphaned_running.sql:38-40` — the test must pin the shipped body, not the author's transcription. |
| SECDEF public-EXECUTE guard | A hand-written `has_function_privilege` block | `PERFORM public._assert_no_public_execute('public.<fn>(…)')` (`20260515205431`) | Already exists; three call sites. |
| SQL-vs-Python constant drift | A comment saying "keep in sync" | A test asserting the SQL literal equals the Python constant (CONTEXT.md locks this) | The repo has already been burned by mirrored constants (`_DERIVE_BUDGET_DEFAULT_S`, `job_worker.py:494-496`, is single-sourced for exactly this reason). |
| Timestamp on the Python upsert | A DB-side `now()` in a PostgREST payload | Client-side `datetime.now(timezone.utc).isoformat()` | PostgREST sends payload values as literals, never SQL expressions — the same trap the one-off script documents at `:56-60`. |
| Error-message field | A new column | `computation_error` | Every writer and every reader already uses it. |

**Key insight:** every mechanism this phase needs already exists in-repo, correctly implemented, on a
*different table*. The failure mode here is not "we lack a pattern" — it is **transplanting a pattern
across a table whose row lifecycle is different** (append-only vs. upsert-keyed). Every collision in
this document is an instance of that one mistake.

---

## Common Pitfalls

### P-1 — `computed_at` is not a start-time on this table (the 106-janitor bug, twice)
**What goes wrong:** a reaper keyed on `computed_at` never fires on bridge-written rows and fires
instantly on runner-written rows.
**Root cause:** C-2. **Avoid:** dedicated `computing_started_at`; the reaper must never read
`computed_at` (backfill only).
**Warning sign:** the word `computed_at` anywhere in the cron body.

### P-2 — stamping `now()` unconditionally in the SQL bridge
**What goes wrong:** the stamp resets on every job transition of a multi-hop chain; the reaper never
fires. This is the 106 bug re-implemented in a new column, and it would pass a naive "the writer sets
the stamp" CI invariant.
**Avoid:** conditional stamp on the *transition* (C-3). **Warning sign:** a bare
`computing_started_at = now()` in an `ON CONFLICT DO UPDATE`.

### P-3 — copying the `compute_jobs` batch-tail *formula*
**What goes wrong:** a 2.5h/4h threshold reaps live multi-hop chains; a healthy strategy's factsheet
is flipped to `failed` mid-compute.
**Avoid:** §Threshold. **Warning sign:** the number 4, or the literal expression
`batch_size × max_per_kind_timeout`, in the reaper's rationale.

### P-4 — not clearing `computation_warned` → the bridge launders the reap
**What goes wrong:** the reaper writes `failed`; the next `sync_strategy_analytics_status` call for
that strategy hits branch (a) or (c), reads `computation_warned = TRUE`, and resolves the row back to
`complete_with_warnings` (`20260710150000:117-121`, `:192-197`). The user's forever-spinner becomes a
**false success on a factsheet** — a money-surface defect, strictly worse than the spinner.
**Avoid:** `computation_warned = FALSE` in the reaper's UPDATE, matching every `SI-02`-tagged writer.
**Warning sign:** the reaper's `SET` list has two columns.

### P-5 — a caller-controlled `p_stale_threshold` on a SECDEF function
**What goes wrong:** `interval '1 second'` from any authenticated user flips every tenant's in-flight
rows to `failed`. This *already happened* on the sibling table
(`20260516170100_reset_stalled_portfolio_analytics_revoke_public.sql:3-12`).
**Avoid:** inline literal cron body (no function). If a function is unavoidable: hardcode the
threshold, `REVOKE`+`GRANT` in the **same** migration, `_assert_no_public_execute` in the self-verify.

### P-6 — an unbounded reaper UPDATE
**What goes wrong:** a large backlog (the prod state the one-off script was written for) makes one
cron tick hold locks over the whole table, blocking every live writer.
**Avoid:** CONTEXT.md's `LIMIT` + deterministic ordering, e.g.
`WHERE strategy_id IN (SELECT strategy_id FROM … ORDER BY computing_started_at ASC LIMIT N FOR UPDATE SKIP LOCKED)`.
`SKIP LOCKED` also prevents the tick from blocking on a row a worker is mid-writing.

### P-7 — a JOB-07 test that cannot fail
See §JOB-07 Test Mechanics. **Avoid:** structural gate + a positive control.

### P-8 — a threshold oracle that recomputes the implementation's own expression
**What goes wrong:** the invariant test evaluates the same formula the code evaluates, so it cannot
falsify a wrong formula.
**Avoid:** per CONTEXT.md's own `<specifics>` and memory
`feedback_economic_invariant_oracles_not_self_referential` — pin the *invariant* (threshold >
chain-inclusive ceiling derived from an independently-declared chain topology), with literal expected
values in the test rather than values read back from the module under test (the SEAMCORE-07 rule).

### P-9 — re-basing `sync_strategy_analytics_status` on the wrong definition
**What goes wrong:** silently reverts the F-3/PUB-02 per-kind supersession, poisoning strategies whose
member key was re-onboarded. **Avoid:** re-base on `20260710150000` (§Re-basing).

### P-10 — copying the hour-band assertion into a sub-hourly gate
`test_retention_orphaned_running.sql:110` does `(split_part(schedule,' ',2))::INT` — with `*/15 * * * *`
the hour field is `*` and the cast errors. Do not copy blindly.

### P-11 — a Python-only stamp invariant
The larger `computing` writer is SQL. A Python-only AST gate ships green with the SQL writer
unstamped. Grep/assert the **whole repo**.

---

## Code Examples (verified in-repo)

### Additive nullable column, no default, no backfill — the shape CONTEXT.md locks
```sql
-- Source: supabase/migrations/20260710120000_strategy_keys.sql:131-135
-- 5. COMP-04 stub: additive NULLABLE per-basis metrics column on strategy_analytics.
--    No DEFAULT, no backfill, NO SET NOT NULL (a 23502 timebomb on existing rows).
ALTER TABLE public.strategy_analytics
  ADD COLUMN IF NOT EXISTS metrics_json_by_basis jsonb;
```

### pg_cron schedule with fail-loud + idempotency + self-verify
```sql
-- Source: supabase/migrations/20260719120000_retention_orphaned_running_compute_jobs.sql:57-135
BEGIN;
SET lock_timeout = '5s';

DO $$
DECLARE v_has_pg_cron BOOLEAN;
BEGIN
  SELECT EXISTS(SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') INTO v_has_pg_cron;
  IF NOT v_has_pg_cron THEN
    RAISE EXCEPTION 'WORKER-04: pg_cron extension is NOT installed. ...'
      USING ERRCODE = 'feature_not_supported';
  END IF;

  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'retention_compute_jobs_orphaned_running') THEN
    PERFORM cron.unschedule('retention_compute_jobs_orphaned_running');
  END IF;

  PERFORM cron.schedule(
    'retention_compute_jobs_orphaned_running',
    '15 4 * * *',
    $cron$
    DELETE FROM public.compute_jobs
     WHERE status = 'running'
       AND claimed_at IS NOT NULL
       AND claimed_at < now() - interval '4 hours';
    $cron$
  );
  RAISE NOTICE 'WORKER-04: ... scheduled (daily 04:15 UTC, 2h window).';
END $$;

-- separate self-verifying block re-reads cron.job.command and RAISEs on each expected shape
COMMIT;
```

### The SQL `computing` writer that must be conditionally stamped
```sql
-- Source: supabase/migrations/20260710150000_sync_status_supersede_failed_per_kind.sql:113-125
IF v_nonterminal_count > 0 THEN
  INSERT INTO strategy_analytics (strategy_id, computation_status, computation_error)
  VALUES (p_strategy_id, 'computing', NULL)
  ON CONFLICT (strategy_id) DO UPDATE
     SET computation_status = CASE
           WHEN strategy_analytics.computation_status = 'complete_with_warnings'
                OR strategy_analytics.computation_warned
           THEN 'complete_with_warnings'
           ELSE 'computing'
         END,
         computation_error  = EXCLUDED.computation_error,
         computed_at        = now();          -- ⚠️ THIS is why computed_at is the wrong key
  RETURN;
END IF;
```

### The Python `computing` writer
```python
# Source: analytics-service/services/analytics_runner.py:1226-1232
# Mark computing.
def _mark_computing() -> None:
    supabase.table("strategy_analytics").upsert(
        {"strategy_id": strategy_id, "computation_status": "computing"},
        on_conflict="strategy_id",
    ).execute()
await db_execute(_mark_computing)
```

### The canonical terminal-`failed` write (note `computation_warned`)
```python
# Source: analytics-service/services/job_worker.py:1890-1905
ctx.supabase.table("strategy_analytics").upsert(
    {
        "strategy_id": strategy_id,
        "computation_status": "failed",
        # SI-02 (MEDIUM-2): clear the runner-owned warned marker on
        # every terminal 'failed' so the status bridge (branches a/c)
        # cannot resurrect a stale complete_with_warnings.
        "computation_warned": False,
        "computation_error": (
            "Analytics enqueue failed during sync. "
            "The next scheduled sync will retry — "
            "contact support if this persists."
        ),
    },
    on_conflict="strategy_id",
).execute()
```

### SQL gate oracle discipline — EXECUTE the deployed body
```sql
-- Source: supabase/tests/test_retention_orphaned_running.sql:156-164
-- ----- ASSERTION 3: EXECUTE the DEPLOYED cron body (the oracle) --------
-- Run the REAL stored command, not a re-typed predicate.
EXECUTE v_command;

SELECT count(*) INTO row_cnt FROM compute_jobs WHERE id = id_a;
IF row_cnt <> 0 THEN
  RAISE EXCEPTION 'TEST FAILED (3): orphaned >4h running row survived the purge (count=%), expected 0', row_cnt;
END IF;
```

---

## Runtime State Inventory

This is a DDL + janitor phase, not a rename, but the same discipline applies to the pg_cron and
prod-data surfaces.

| Category | Items found | Action required |
|----------|-------------|------------------|
| **Stored data** | `public.strategy_analytics` rows currently at `computation_status='computing'` in **PROD** (`khslejtfbuezsmvmtsdn`) and **TEST** (`qmnijlgmdhviwzwfyzlc`). Count unknown offline; the one-off script exists because this state was already reached in prod. | **Data migration**: the one-time backfill of `computing_started_at` from `computed_at` (C-1), *inside* the migration, *before* `cron.schedule`. Without it every existing stranded row has a NULL stamp and is skipped forever. |
| **Live service config (pg_cron)** | `cron.job` rows live in the **database**, not in git. Ten existing jobs (§pg_cron). A new `cron.schedule` is applied to PROD **automatically on merge to `main`** and to TEST only via an explicit MCP apply. | Apply to TEST via MCP before merge (`project_supabase_migrate_auto_on_push`). Verify post-merge that the job is registered on PROD (`SELECT jobname, schedule FROM cron.job`). |
| **OS-registered state** | None. Railway runs `uvicorn main:app` (API) and a CMD-override `python -m main_worker` (worker); neither gains a new registration. | None. |
| **Secrets / env vars** | None added. `TEST_SUPABASE_DB_URL` (existing GH secret) is what the `sql-tests` job needs — already wired (`ci.yml:944`). | None. |
| **Build artifacts / generated files** | `src/lib/database.types.ts` is already stale by two columns and has **no CI freshness gate**. | Decide explicitly: add `computing_started_at` to the hand-maintained `src/lib/types.ts:288` interface (recommended) and note `database.types.ts` drift, or leave both and document. Do **not** silently widen the drift. |
| **In-repo documentation that will become false** | `src/app/api/keys/sync/route.ts:41-59` ("Direct-writes audit (D.10)") is a live invariant comment listing the `computation_status` writers. | Update it in the same PR to name the stamp obligation. |

---

## Environment Availability

| Dependency | Required by | Available | Version | Fallback |
|------------|-------------|-----------|---------|----------|
| `pg_cron` extension on PROD | the reaper | ✓ (inferred) | — | none — the migration `RAISE EXCEPTION`s if absent |
| `pg_cron` on TEST project | `sql-tests` gate | **UNVERIFIED offline** | — | the gate's presence-gate `RAISE NOTICE`-skips (`test_retention_orphaned_running.sql:71-75`) |
| `psql` client in CI | `sql-tests` | ✓ | apt `postgresql-client` | none |
| `TEST_SUPABASE_DB_URL` secret | `sql-tests` | ✓ (wired, `ci.yml:944`) | — | job fails loudly if unset |
| pgTAP | — | ✗ **not installed** | — | plain PL/pgSQL `DO` + `RAISE EXCEPTION` (the established pattern) |
| pytest | Python invariants | ✓ | `analytics-service/pytest.ini` | none |
| `pandera` (local) | unrelated Python modules | ✗ locally (memory `reference_local_python_missing_pandera`) | — | `pip install 'pandera==0.32.1' --break-system-packages`; CI has it |
| Supabase MCP | TEST apply before merge | assumed ✓ | — | manual `psql` apply |

**Missing with no fallback:** none identified.
**Verification the planner must do:** confirm `pg_cron` is installed on the TEST project *before*
relying on the SQL gate as a blocking proof — otherwise it green-skips and proves nothing. This
verification should be an explicit task, not an assumption.

---

## Package Legitimacy Audit

**This phase installs no external packages.** The work is SQL (a new migration), Python edits to
`analytics-service/` (no new imports beyond stdlib `datetime`, already imported), and at most a
one-line TypeScript type addition. `slopcheck` was therefore not run and no `## Standard Stack`
table is required — consistent with the project SUMMARY's finding that v1.16 needs "zero new npm
packages and zero new infrastructure."

If planning later reaches for a package, the gate applies in full.

---

## Validation Architecture

### Test framework
| Property | Value |
|----------|-------|
| Framework (SQL) | plain PL/pgSQL under `psql -v ON_ERROR_STOP=1` — **pgTAP not installed** |
| Framework (Python) | pytest (`asyncio_mode = auto`) |
| Framework (TS) | Vitest 4.1.2 |
| Config files | `analytics-service/pytest.ini`; `vitest.config.ts`; SQL gate wired by glob in `.github/workflows/ci.yml:830-975` |
| Quick run — Python | `cd analytics-service && pytest tests/test_main_worker.py -x -q` |
| Quick run — SQL | `psql "$TEST_SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/test_<new>.sql` |
| Full suite — Python | `cd analytics-service && pytest -q` |
| Full suite — TS | `npm test` |
| Type gate | `cd analytics-service && mypy --strict .` ; `npm run typecheck` |

### Phase requirements → test map

| Req | Behavior | Test type | Automated command | Exists? |
|-----|----------|-----------|-------------------|---------|
| JOB-01 | `computing_started_at` column exists, `timestamptz` nullable, no default | SQL gate | `psql … -f supabase/tests/test_strategy_analytics_stuck_computing_reaper.sql` | ❌ Wave 0 |
| JOB-01 | The Python `computing` writer co-locates the stamp | unit/AST | `cd analytics-service && pytest tests/test_computing_started_at_stamp.py -x` | ❌ Wave 0 |
| JOB-01 | The SQL bridge branch (a) stamps on the **transition only** — a second bridge call on an already-`computing` row does **not** advance the stamp | SQL gate (behavioral, both directions) | same SQL gate file | ❌ Wave 0 |
| JOB-01 | The stamp is cleared to NULL on every exit from `computing` | SQL gate + pytest | same | ❌ Wave 0 |
| JOB-02 | Stranded row (past threshold, **no** active job) → `failed` + message + `computation_warned=FALSE` | SQL gate, `EXECUTE`-the-deployed-cron-body oracle | same SQL gate file | ❌ Wave 0 |
| JOB-02 | `computing` row **with** an active `compute_jobs` row → **NOT** reaped | SQL gate | same | ❌ Wave 0 |
| JOB-02 | `computing` row with **NULL** stamp → **NOT** reaped (Sentry warning path) | SQL gate | same | ❌ Wave 0 |
| JOB-02 (SC#2) | fresh `computed_at` + old `computing_started_at` → **REAPED** | SQL gate | same | ❌ Wave 0 |
| JOB-02 (SC#2) | old `computed_at` + fresh `computing_started_at` → **NOT** reaped | SQL gate | same | ❌ Wave 0 |
| JOB-02 | Cron job registered under the expected name, at the expected cadence | SQL gate | same | ❌ Wave 0 |
| JOB-02 | The `LIMIT` bound holds (N+1 stranded rows ⇒ exactly N reaped in one tick) | SQL gate | same | ❌ Wave 0 |
| JOB-03 | Threshold exceeds every relevant handler's **chain-inclusive** worst case | pytest, beside `TestWatchdogInvariant` | `cd analytics-service && pytest tests/test_main_worker.py -k Reaper -x` | ❌ Wave 0 |
| JOB-03 | SQL literal == Python constant (drift gate) | SQL gate (reads `cron.job.command`) + pytest | both | ❌ Wave 0 |
| JOB-03 | Sane upper bound on the threshold (unit-typo catcher) | pytest, mirroring `test_watchdog_threshold_has_sane_upper_bound` | same | ❌ Wave 0 |
| JOB-07 | No reaper identifier is reachable from `dispatch_tick` | pytest AST/grep gate | `cd analytics-service && pytest tests/test_job07_reaper_off_worker_loop.py -x` | ❌ Wave 0 |
| JOB-07 | Large synthetic backlog ⇒ real healthz TCP probe stays 200; **control**: injected loop-blocking reap ⇒ 503 | pytest, mirroring `tests/test_worker_isolation_e2e.py:119,182` | same | ❌ Wave 0 (helpers exist) |
| cross | `computation_status` CHECK ↔ TS closed-set parity unbroken | vitest (existing) | `npx vitest run src/__tests__/contracts/check-zod-db-check-parity.test.ts` | ✅ exists |
| cross | `mypy --strict` clean on `analytics-service` | type gate | `cd analytics-service && mypy --strict .` | ✅ exists |

### Sampling rate
- **Per task commit:** `cd analytics-service && pytest tests/test_main_worker.py tests/test_job_worker_csv_kind.py -x -q` (< 30 s)
- **Per wave merge:** `cd analytics-service && pytest -q` + `psql "$TEST_SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/test_<new>.sql` + `npm run typecheck`
- **Phase gate:** full pytest + full vitest + all `supabase/tests/test_*.sql` green, plus `mypy --strict`, before `/gsd:verify-work`

### Wave 0 gaps
- [ ] `supabase/tests/test_strategy_analytics_stuck_computing_reaper.sql` — JOB-02 + JOB-01 SQL half
      (**must be MCP-applied to TEST first**, or the presence gate green-skips)
- [ ] `analytics-service/tests/test_computing_started_at_stamp.py` — JOB-01 writer AST invariant
      (both runtimes)
- [ ] Reaper-threshold invariants added to `analytics-service/tests/test_main_worker.py` beside
      `TestWatchdogInvariant` (JOB-03)
- [ ] `analytics-service/tests/test_job07_reaper_off_worker_loop.py` — JOB-07 structural gate +
      behavioural probe with its positive control
- [ ] A module-level declaration of the **job-chain topology** in `analytics-service/` so the JOB-03
      oracle is not self-referential
- No framework install needed.

---

## Security Domain

| ASVS category | Applies | Standard control |
|---------------|---------|------------------|
| V2 Authentication | no | no auth surface changed |
| V3 Session Management | no | — |
| **V4 Access Control** | **yes** | The reaper mutates rows across **all tenants**. If implemented as a function: `REVOKE ALL … FROM PUBLIC, anon, authenticated` + `GRANT EXECUTE … TO service_role` in the SAME migration, self-verified with `_assert_no_public_execute`. Preferred: an inline pg_cron body, which exposes no callable surface at all. RLS on `strategy_analytics` already denies all authenticated writes (`20260405061912:43-44`), but `service_role` has BYPASSRLS so RLS is not the boundary. |
| **V5 Input Validation** | **yes** | The threshold must be a **fixed literal**, not a caller-supplied `INTERVAL`. A caller-controlled threshold on a cross-tenant reaper is a live, documented incident in this repo (`20260516170100:3-12`). |
| V6 Cryptography | no | — |

### Threat patterns for this stack

| Pattern | STRIDE | Mitigation |
|---------|--------|------------|
| Caller-controlled reaper threshold → cross-tenant mass `failed` flip + DoS on in-flight analytics | Tampering / DoS | No parameter; inline literal body; ACL locked in the creating migration |
| SECDEF function shipped with default `PUBLIC EXECUTE`, revoked in a later migration → leak window | Elevation of Privilege | `migration-reviewer` invariant #20: REVOKE in the **same** migration |
| SQL injection via a dynamic cron body | Tampering | Fixed literal, `$cron$…$cron$`, no interpolation, schema-qualified `public.strategy_analytics` — the stated rationale at `20260719120000:88-90` |
| Reap laundered back to `complete_with_warnings` → a failed compute renders as a live money surface | Tampering / Repudiation | Clear `computation_warned` (P-4). This is a **data-integrity** finding, above the founder's stopping-rule bar. |
| Unbounded UPDATE blocking live writers | DoS | `LIMIT` + deterministic ordering + `FOR UPDATE SKIP LOCKED` (P-6) |
| Sensitive data in `computation_error` | Information Disclosure | The reaper's message is a fixed literal; it echoes nothing. Existing writers already `scrub` — `job_worker.py:2330,2443` use `scrubbed`. |

---

## Assumptions Log

| # | Claim | Section | Risk if wrong |
|---|-------|---------|---------------|
| A-1 | A supabase-py `.upsert(payload, on_conflict=…)` (PostgREST `Prefer: resolution=merge-duplicates`) updates **only the columns present in the payload**, so `analytics_runner.py:1227`'s `_mark_computing` leaves `computed_at` at its prior value. | C-2, §Writer Census | If PostgREST actually re-applied the column DEFAULT on conflict, `computed_at` would be `now()` on the runner path too, and the "false positive" half of C-2 evaporates (the "false negative" half stands regardless, so the phase's conclusion is unchanged). **The planner should confirm this empirically against the TEST DB — it is a two-minute check and it is the evidence for half of SC#2.** |
| A-2 | `pg_cron` is installed on the TEST Supabase project (`qmnijlgmdhviwzwfyzlc`). | §Environment | The SQL gate `RAISE NOTICE`-skips instead of asserting, and the phase ships an unproven reaper behind a green check. Verify explicitly. |
| A-3 | `pg_cron` cron bodies execute as the job owner (typically `postgres`, a superuser) and therefore bypass RLS without needing SECDEF. | §pg_cron, §Security | If the cron ran as a lesser role, the inline-body recommendation fails and a SECDEF function becomes mandatory — which re-opens the whole CRITICAL-2 surface. Cheap to verify: the existing `DELETE FROM public.compute_jobs` cron body works today under exactly this assumption. |
| A-4 | The ~9-hour chain-inclusive worst case is derived from `p_batch_size=5`, sequential dispatch, and the 4-hop chain. It does **not** model queue depth beyond one batch, or `claim_compute_jobs` priority/partition effects. | §Threshold | The real ceiling could be higher still under load. Since the recommendation is to lean on the `NOT EXISTS` clause rather than the interval, the risk is contained — but the JOB-03 CI invariant's ceiling formula must be reviewed on its own merits, not accepted from this document. |
| A-5 | The `retention_compute_jobs_done` / `_failed` 30/90-day crons can, in principle, delete the last `compute_jobs` row for a strategy whose `strategy_analytics` is still `computing`. | §Threshold generator (4) | A pathological-only generator; if wrong, one enumerated case drops out and nothing else changes. |
| A-6 | The `sql-tests` CI job is a **blocking** check on the PR (not advisory). | §Testing Harness | Per memory `project_v1_16_review_depth_and_branch_protection_decision`, branch protection is **OFF until paying clients** — so *every* CI gate is advisory at merge. Phrase verification claims as "would have caught", never "did stop". |

---

## Open Questions

1. **Does the reaper's threshold need to be hours at all?**
   - *Known:* JOB-03 mandates a batch-tail-derived threshold and a CI invariant proving headroom.
   - *Unclear:* with the `NOT EXISTS (active job)` conjunct carrying the safety, a large interval buys
     nothing but latency (the user stares at the spinner longer). CONTEXT.md's 15-minute cadence
     implies an intent to reap *promptly*.
   - *Recommendation:* derive **both** numbers and state them separately in the migration header —
     the chain-inclusive ceiling (which the CI invariant asserts headroom against) and the actual
     deployed interval (which may be much smaller, justified by the `NOT EXISTS` clause). Do not
     let a large "safe" interval be chosen by default when the safety comes from elsewhere. This is
     a decision the planner should make explicitly, not inherit.

2. **Is the migration-time backfill from `computed_at` safe on PROD right now?**
   - *Known:* `computed_at` is `now()`-fresh on bridge-written `computing` rows and stale on
     runner-written ones (C-2).
   - *Unclear:* how many rows currently sit at `computing` in PROD and which writer produced each.
   - *Recommendation:* the backfill is one-shot and the reaper's `NOT EXISTS` clause protects live
     rows regardless, so the risk is low — but the plan should include a **read-only census query**
     against PROD/TEST (`SELECT count(*), min(computed_at), max(computed_at) FROM strategy_analytics
     WHERE computation_status='computing'`) before the migration is authored, so the header states a
     real number rather than a hypothetical.

3. **Should the reaper report skip counts / emit the Sentry warning CONTEXT.md requires?**
   - *Known:* CONTEXT.md locks "NULL stamp ⇒ skip + Sentry warning". pg_cron has no Sentry client.
   - *Unclear:* the mechanism. Options: a `RAISE WARNING` into Postgres logs (not Sentry); a
     `cron.job_run_details` row an operator reads; or a small counter table the API service reads.
   - *Recommendation:* the honest minimum is `RAISE WARNING` + a documented operator query. Do **not**
     claim "Sentry warning" in a plan or a verification artifact unless a real Sentry path is built —
     that is exactly the "copy asserts a team was notified when nothing was" defect class SEAMUX-08
     closed. Flag this to `discuss-phase` if the founder wants real Sentry delivery.

4. **`src/lib/types.ts` + `database.types.ts` drift** — add the column to the hand-maintained
   interface, regenerate the whole types file, or neither? No CI gate forces the answer.
   *Recommendation:* one-line addition to `src/lib/types.ts:288`; leave `database.types.ts` alone and
   note the pre-existing 2-column drift in TODOS.md rather than expanding scope.

---

## State of the Art

| Old approach | Current approach | When changed | Impact |
|--------------|------------------|--------------|--------|
| Manual one-off script run by an operator (`reset_stuck_computing_rows.py`) | Recurring pg_cron reaper | this phase | The script's `updated_at` reference is broken; the manual step never runs. |
| `reset_stalled_portfolio_analytics` called from a Python HTTP cron route (`routers/cron.py:876`) | pg_cron, independent of any service's liveness | v1.13 WORKER-04 onward (`20260719120000`) | The Python-invoked form shares a failure domain with the thing it backstops. |
| Reaper thresholds from the per-kind watchdog number (2h / 40 min) | Batch-tail-derived (4h for `compute_jobs`) | `20260720120000` (RT-01) | The watchdog's *silent failure* was the hole in the original rationale. |
| `computation_status='complete_with_warnings'` inferred from the status column | A dedicated runner-owned `computation_warned` BOOLEAN | `20260708120000` | Any writer of a terminal status must now also decide the marker (P-4). |
| Trades-based HTTP `compute_analytics` recompute path | Deleted; single `run_csv_strategy_analytics` entry via the worker, grep-gated | Stage B 106-07/08/09 | Guarantees a runner-written `computing` row always has a live `compute_jobs` row. |

**Deprecated / outdated in this area:**
- `analytics-service/scripts/reset_stuck_computing_rows.py` — broken (`updated_at`), superseded here.
- `src/lib/database.types.ts` `strategy_analytics` Row — stale by two columns, no CI gate.
- `.claude/agents/migration-reviewer.md` invariant #14 (no `BEGIN`/`COMMIT`) — contradicted by 150/231
  migrations including the newest; invariant #18's description of the
  `20260516170400` index as `(stalled, computing_started_at)` is also inaccurate (the real index is
  `(portfolio_id, computed_at DESC)`). Neither error changes the *other* invariants' validity.

---

## Sources

### Primary (HIGH — direct reads of this repo at 2026-08-02, branch `feat/v1.16-141-jobs-rate-retry`)
- `supabase/migrations/20260405061911_initial_schema.sql:69-96` — the `strategy_analytics` DDL
- `supabase/migrations/20260405061912_rls_policies.sql:6,35-44` — RLS
- `supabase/migrations/20260602120000_…add_complete_with_warnings.sql:42-59` — status CHECK widening
- `supabase/migrations/20260708120000_sync_status_failed_final_bounce.sql:40-58` — `computation_warned`, re-basing discipline
- `supabase/migrations/20260710120000_strategy_keys.sql:131-145` — additive-nullable column precedent
- `supabase/migrations/20260710150000_sync_status_supersede_failed_per_kind.sql` (read in full) — the LATEST `sync_strategy_analytics_status`
- `supabase/migrations/20260712120000_wizard_composite_members_invalidate_analytics.sql:186-197`
- `supabase/migrations/20260516122247_portfolio_analytics_stuck_row_reaper.sql` (full)
- `supabase/migrations/20260516170100_reset_stalled_portfolio_analytics_revoke_public.sql` (full) — CRITICAL-2
- `supabase/migrations/20260516170400_portfolio_analytics_computing_idx_concurrently.sql:25-45`
- `supabase/migrations/20260719120000_retention_orphaned_running_compute_jobs.sql` (full)
- `supabase/migrations/20260720120000_retention_orphaned_running_window_4h.sql` (full)
- `supabase/migrations/20260728120000_csv_finalize_double_submit_idempotency.sql:1-60` — current tip + house style
- `supabase/tests/test_retention_orphaned_running.sql` (full) — the gate template
- `supabase/tests/test_metrics_by_basis_write.sql:63` — minimal `strategy_analytics` seed
- `analytics-service/services/analytics_runner.py:1-19, 1166-1232, 1270-1281, 1480-1512, 1589-1690`
- `analytics-service/services/job_worker.py:470-496, 1600-1705, 1830-1905, 1929-1947, 2326-2453, 4240-4260, 4307-4333, 4855-4892, 5117-5141, 6559-6746, 8087-8175`
- `analytics-service/services/ingestion/long_fetch.py:583-607`
- `analytics-service/routers/portfolio.py:78, 153, 630-709`
- `analytics-service/routers/cron.py:478-495, 840-979`
- `analytics-service/main_worker.py:127-141, 150-243, 470, 511, 560-680, 787-798, 909, 981-984`
- `analytics-service/main_worker_healthz.py:1-80`
- `analytics-service/scripts/reset_stuck_computing_rows.py` (full)
- `analytics-service/tests/test_main_worker.py:994-1084`
- `analytics-service/tests/test_job_worker_csv_kind.py:85-135`
- `analytics-service/tests/test_worker_isolation_e2e.py:1-135, 182-206`
- `analytics-service/Dockerfile:1-8,39`; `analytics-service/railway.toml`; `analytics-service/pytest.ini`
- `src/lib/types.ts:288-329`; `src/lib/closed-sets.ts:423-431`; `src/lib/database.types.ts:2477-2545`
- `src/lib/wizardErrors.ts:663-673, 1391, 1457-1463`
- `src/hooks/useStrategySyncPoller.ts:120-235`
- `src/app/(dashboard)/strategies/new/wizard/steps/SyncPreviewStep.tsx:112,123,441,482,790,890-908,1640-1690`
- `src/app/api/keys/sync/route.ts:20-60, 461, 532-534`
- `src/app/api/strategies/{finalize-wizard,csv-finalize}/route.ts` (`computation_status` write sites)
- `src/__tests__/contracts/check-zod-db-check-parity.test.ts:190-215`
- `.github/workflows/ci.yml:830-975`; `.github/workflows/migration-policy.yml:1-80`; `.github/migrate-backdated-allowlist.txt`
- `.claude/agents/migration-reviewer.md` (full)
- `.planning/REQUIREMENTS.md`, `.planning/research/SUMMARY.md`, `.planning/STATE.md:8,34,242-306,967-969`, `.planning/codebase/TESTING.md:1-120`, `.planning/config.json`, `CLAUDE.md`, `AGENTS.md`

### Secondary (MEDIUM)
- Project memory ledger: `project_106_janitor_deferred_needs_transition_timestamp`,
  `project_worker04_purge_delete_vs_reset_prod_outage`,
  `project_stitch_composite_wedge01_fix_and_local_prod_worker`,
  `reference_db_test_ci_wiring`, `project_supabase_migrate_auto_on_push`,
  `reference_pytest_must_run_from_analytics_service_dir`, `feedback_run_mypy_before_ship_analytics`,
  `feedback_economic_invariant_oracles_not_self_referential`,
  `project_v1_16_review_depth_and_branch_protection_decision`
- PostgREST `Prefer: resolution=merge-duplicates` upsert column semantics — training knowledge, **not
  verified in this session** (Assumption A-1)

### Tertiary (LOW)
- None. No external documentation lookup was required: this phase adds no dependency and every
  mechanism has an in-repo precedent read at file:line.

---

## Metadata

**Confidence breakdown:**
- Schema & writer census: **HIGH** — exhaustive grep + per-site context dump; the corrections to
  CONTEXT.md are each grounded in a quoted line.
- pg_cron / migration pattern: **HIGH** — both retention migrations and both prior reaper migrations
  read end to end.
- Testing harness: **HIGH** — `ci.yml` `sql-tests` job read in full; pgTAP absence stated twice in-repo.
- Terminal state & message: **HIGH** — writer and reader both traced to render.
- Threshold arithmetic: **MEDIUM** — the *topology* is verified (every enqueue site read), the
  *ceiling* is a derivation not an observation (A-4), and the recommendation deliberately shifts the
  safety burden onto the `NOT EXISTS` clause rather than the number.
- `computed_at` false-positive half of C-2: **MEDIUM** — depends on A-1, which is a two-minute
  empirical check the planner should run.

**Research date:** 2026-08-02
**Valid until:** ~2026-09-01 for the schema/migration findings (stable). **Re-verify the writer census
and the `sync_strategy_analytics_status` base definition immediately before authoring the migration** —
`supabase/migrations/**` auto-applies to PROD on merge and this repo has a documented history of
`CREATE OR REPLACE` re-basing bugs.
