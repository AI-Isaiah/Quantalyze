# Phase 191: REFUSALRACE - Research

**Researched:** 2026-11-04
**Domain:** atomic JSONB merge into `compute_jobs.metadata` (PostgreSQL SECURITY DEFINER RPCs), called from the Python worker (supabase-py) and two Next.js route handlers (supabase-js); SQL gate corpus, mutation runner and CI census maintenance.
**Confidence:** HIGH for what the three writers do today, the house migration pattern and the census list (all read this session). MEDIUM for the CI behaviour of a function-adding PR (precedent-derived, not run: this worktree has no `node_modules`). Items needing a decision are in `## Assumptions Log` and `## Open Questions`.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** The retraction is a new, small, service-role-only SQL function that does the whole retraction in ONE `UPDATE`: drop `source` only when it is a ledger-refresh marker (`ledger-refresh`, `ledger-refresh-composite`), add `refresh_marker_retracted = <old source>` and `correlation_id = <caller's id>`, preserve every other key, and match no `done` row. It reports what it did (retracted with the marker, or not, and why) so the callers keep today's outcomes, log lines and error contracts. Python and TypeScript both call it; their read-modify-write bodies go away. `enqueue_compute_job` is NOT changed. Founder 2026-11-04, AskUserQuestion: "Small dedicated RPC (Recommended)". **This deviates from the ROADMAP booking's SC-2 wording ("a merge arm in `enqueue_compute_job` for the retraction"), which is updated to match.** Reason given in the question: `enqueue_compute_job` runs on every enqueue path, and changing its signature has a history of overload and ACL drift in this repo. — **Reversibility:** one-way — a new function in a PROD migration; undoing it needs a follow-up migration.
- **D-02:** The gap between `enqueue_compute_job` returning a deduped id and the retraction running stays as it is today (it existed before this phase and is not the race this phase closes). Recorded so a reviewer does not read it as missed.
- **D-03:** The marker is written by one JSONB merge statement (`metadata = COALESCE(metadata, '{}') || '{"read_refusal_kept_figures": true}'`), through a service-role-only SQL function or an equivalent single-statement write; the planner picks the form. The write still goes through `_stamp_io` with `_STAMP_OP_REFUSAL_MARKER_WRITE`, and a write that did not land still fails the job TRANSIENT with nothing else written (Phase 186 R3-02). Founder's booked SC-2, unchanged.
- **D-04:** Each writer gets a test that goes RED on today's replace behaviour (neuter, see RED, restore from a byte backup). A SQL gate interleaves the two writes (and a claim-style additive write) and asserts every key survives (SC-3). New SQL arms move the censuses (ARMS_FLOOR, SENTINEL_FLOOR, scoped-update counts): grep them all.
- **D-05:** SC-1 is a read-only PROD count (marker query first and alone): jobs carrying `read_refusal_kept_figures`, jobs carrying `refresh_marker_retracted`, and any row carrying both. Recorded before any code change. Counts only, no ids.

### Claude's Discretion

- Function names, return shape, and whether the marker uses its own function or a narrow generic merge.
- Whether the TypeScript and Python callers share one result contract test.

### Deferred Ideas (OUT OF SCOPE)

- Moving the retraction into `enqueue_compute_job`'s dedup (closes D-02's gap too). Not chosen (D-01); book it only if D-02's gap is ever observed.

(Specifics section of CONTEXT, also binding: keep `sync_strategy_analytics_status`'s `is_protected` reading `metadata->>'source'` unchanged, so the retraction still removes `source` itself; the parity pin between `LEDGER_REFRESH_JOB_SOURCES` in Python and TypeScript must also cover the marker set the SQL function uses; migrations re-base on the latest definitions, SECURITY DEFINER with pinned search_path, EXECUTE revoked from PUBLIC/anon/authenticated and granted to service_role only; migration-reviewer and rls-policy-auditor clean before merge.)
</user_constraints>

<phase_requirements>
## Phase Requirements

ROADMAP lists `**Requirements**: TBD`, so no REQ ids exist. The phase-local success criteria are the contract:

| ID | Description | Research Support |
|----|-------------|------------------|
| SC-1 | Read-only PROD count recorded before any code change | `## SC-1 and SC-5 SQL` |
| SC-2 | Both writers merge; each has a test RED on today's replace behaviour (amended by D-01: dedicated RPC) | `## Architecture Patterns`, `## Code Examples`, `## Validation Architecture` |
| SC-3 | A concurrency test interleaves the two writes; both keys survive | `## Pattern 3`, `## Validation Architecture` |
| SC-4 | Migration passes migration-reviewer and rls-policy-auditor | `## Security Domain`, `## CI behaviour of a function-adding PR` |
| SC-5 | After deploy, read-only PROD reading confirms no regression | `## SC-1 and SC-5 SQL` |
</phase_requirements>

## Project Constraints (from CLAUDE.md)

- **Which database am I on:** the CLI in this checkout is linked to PRODUCTION. Run `SELECT shobj_description(oid,'pg_database') AS which_database FROM pg_database WHERE datname=current_database();` first and alone before any statement. Never `db push` from here. `current_database()` is `postgres` on both projects and proves nothing.
- **SQL gate integrity:** `sql-mutation` mutates every `RED-UNDER` arm; `sql-gate-lint` has seven rules (`node scripts/lint-sql-gates.mjs --self-test`); floors are read by symbol from `scripts/mutation-floors.mjs`, never from prose; `WAIVED_CEILING` is 0 and no waiver may be added.
- **Migrations auto-apply to PROD after `apply-test` succeeds, with no human stop** (CLAUDE.md 2026-09-23 correction). Every review a migration needs happens BEFORE merge.
- **TEST is a schema-only copy of PROD's catalogue:** a migration DO block that reads data and raises can refuse on TEST and block a PROD deploy. The migration's verify block must be catalogue-only.
- **CHANGELOG discipline:** every ship writes a unified `## [X.Y.Z.B] - date` entry before the push, in the same commit as the VERSION bump; `VERSION` and `package.json` byte-equal 4-digit strings; never run `npm version`. Never write the CI-skip trailer tokens in a commit message or PR body.
- **Public repo:** no secrets, PROD ids, uuids, home paths or account numbers in tracked text; never quote a credential-shaped literal in CHANGELOG prose.
- **`drift_subjects`, not `covered_files`/`covered_digest`** in any VERIFICATION frontmatter; never list `TODOS.md`, `CHANGELOG.md`, `VERSION`, `package.json`.
- **Memory (founder):** PROD reads and writes are authorized; marker query first; `supabase db query --linked -f <file>` (a leading `--` comment breaks the inline form). Executors Sonnet; gsd-code-reviewer Opus; migrations need migration-reviewer + rls-policy-auditor clean before merge. Neuter, see RED, restore from a byte backup (never `git checkout/restore/stash` on uncommitted work). A ship branch must change nothing under `.planning`. `grep -a`. A new `supabase/tests` file moves several censuses: grep them all. pytest only from `analytics-service/`. CI mypy strict belongs in every analytics-touching brief. No AI authorship trailers in commits (founder 2026-10-20), which overrides the attribution reminder.
- **Next.js:** AGENTS.md says read `node_modules/next/dist/docs/` before writing Next code. This phase touches no Next page or route shape, only the body of a `src/lib` helper and its two callers' tests.

## Summary

Three code paths write `compute_jobs.metadata` by reading the object, changing keys and writing the whole object back; PostgREST `update({metadata: ...})` replaces the column. They are: the Python refusal marker (`analytics-service/services/job_worker.py:5305-5326`), the Python retraction (`analytics-service/services/ingestion/long_fetch.py:67-205`) and the TypeScript retraction (`src/lib/ledger-refresh-marker.ts`, called by `src/app/api/keys/sync/route.ts:406` and `src/app/api/strategies/finalize-wizard/route.ts:2343`). Those are the only non-SQL writers (grep of every `compute_jobs` update in `analytics-service` and `src`). The two SQL writers, the claim RPC and `set_compute_job_progress`, already merge with `||`. PostgreSQL READ COMMITTED re-evaluates a blocked UPDATE against the committed row version it waited for, so a single `UPDATE ... SET metadata = <expression over metadata>` is race-free against any other single-statement writer.

The fix is one migration with two service-role-only SECURITY DEFINER functions (recommended names `retract_ledger_refresh_marker(uuid, text) RETURNS jsonb` and `mark_compute_job_kept_figures(uuid) RETURNS boolean`), both callers reduced to one `rpc()` call, an outcome contract that lets each caller reproduce today's log lines and error contracts, one new SQL gate with an interleaving arm, a live two-connection probe as the genuine concurrency proof, and a long but fully enumerable list of census edits. The house precedent for the whole shape is `set_compute_job_progress` (migration `20260712130000`) for the function and `20261029120000` (NAVMTM, commit `bc913db76`) for the gate-and-census file set.

**Primary recommendation:** ship ONE migration `20261106120000_refusalrace_metadata_merge_rpcs.sql` with the two functions, a catalogue-only verify block and a rollback under `supabase/migrations/down/`; add ONE new gate `supabase/tests/test_compute_job_metadata_merge.sql` (about 10 arms, `ALL N ARMS EXECUTED`); cut both Python writers and the TS twin over to the RPCs; prove the race with a psycopg two-connection live probe; ship as migration PR first, callers second (readers-first precedent), because migrations auto-apply with no human stop and the Railway and Vercel deploys are not ordered against it.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Atomic merge of `read_refusal_kept_figures` into a job's metadata | Database / Storage (SQL function) | API / Backend (Python worker calls it via `_stamp_io`) | Only SQL can express `jsonb ||`; PostgREST cannot. The statement's atomicity is the whole fix. |
| Atomic retraction (drop `source`, add `refresh_marker_retracted`, `correlation_id`, never `done`) | Database / Storage (SQL function) | API / Backend (worker) and Frontend Server (two Next route handlers) | One UPDATE with the guards in its WHERE; the callers only interpret the reported outcome. |
| Which marker set counts as a ledger refresh | Database (literal list in the function) | Python `LEDGER_REFRESH_JOB_SOURCES`, TS `LEDGER_REFRESH_JOB_SOURCES` | Third copy of the set; parity-pinned by tests (three copies today: Python, TS, SQL bridge). |
| Mapping outcome to log line / Sentry / throw | API / Backend (Python helper) and Frontend Server (TS helper) | — | Error contracts differ by language and stay per-caller (D-01). |
| Proof the writes cannot undo each other | Database (SQL gate + PG row-lock semantics) | CI live-DB probe (psycopg) | Offline Python/vitest doubles are mirrors, not proof (the NAVMTM live-probe header says exactly this). |
| Status bridge reading the marker | Database (`sync_strategy_analytics_status`, unchanged) | — | Out of scope; must keep reading `metadata->>'source'` and `read_refusal_kept_figures`. |

## Standard Stack

No new packages. Everything below already exists in the repo.

### Core

| Component | Where | Purpose | Why standard |
|-----------|-------|---------|--------------|
| PostgreSQL `jsonb ||` and `jsonb - text` | migration | merge and key delete in one UPDATE | [CITED: postgresql.org/docs/current/functions-json.html] "Concatenating two objects generates an object containing the union of their keys, taking the second object's value when there are duplicate keys"; "`jsonb - text` Deletes a key (and its value) from a JSON object, or matching string value(s) from a JSON array" |
| PostgreSQL READ COMMITTED UPDATE semantics | the reason one statement suffices | [CITED: postgresql.org/docs/current/transaction-iso.html] "If the first updater commits, the second updater will ignore the row if the first updater deleted it, otherwise it will attempt to apply its operation to the updated version of the row. The search condition of the command (the `WHERE` clause) is re-evaluated to see if the updated version of the row still matches the search condition." |
| supabase-py `supabase.rpc(name, args).execute()` → `.data` | Python callers | [VERIFIED: analytics-service/services/job_worker.py:12287-12294] `supabase.rpc("set_compute_job_progress", {...}).execute()` and `analytics-service/services/okx_archive_job.py:2453-2454` `answer = response.data` for an RPC declared `RETURNS jsonb` (`supabase/schema/functions/apply_okx_archive_rebuild.sql:15`) |
| supabase-js `admin.rpc(name, args)` → `{ data, error }` | TS helper | [VERIFIED: src/app/api/keys/sync/route.ts:349-356] `await admin.rpc("enqueue_compute_job", {...})` |
| `scripts/pg-lane/run.sh` + `scripts/mutation-runner/run.mjs` | SQL gate execution and mutation proof | [VERIFIED: scripts/pg-lane/README.md CLI contract; scripts/mutation-runner/run.mjs:9-15 usage block] |
| vitest, pytest + mypy strict | tests | existing |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Two narrow functions | One generic `merge_compute_job_metadata(p_job_id, p_patch jsonb)` | Narrower is safer: a generic merge can write `source`, the key the status bridge's `is_protected` keys on. Narrow functions also let the marker key be a SQL literal that a parity test pins. Recommend narrow. |
| `RETURNS jsonb` outcome object | `RETURNS TABLE(outcome text, marker text)` | A TABLE return arrives as a list in `.data`; a jsonb object arrives as a dict, and there is a Python precedent for jsonb (`apply_okx_archive_rebuild`). Recommend jsonb. |
| psycopg direct write from Python | — | Not available: the worker uses supabase-py only; psycopg is used by lane probes (`scripts/probe_composite_claimtime.py`) and live tests, not by the service. |

**Installation:** none. **Package Legitimacy Audit:** not applicable, no package is installed.

## Architecture Patterns

### System Architecture Diagram

```
 derive_broker_dailies handler (Python worker)
   refusal over published figures, final            Sync / resync / wizard finalize
        |                                                   |
        | _stamp_io(op=_STAMP_OP_REFUSAL_MARKER_WRITE)      | enqueue_compute_job  --> deduped job id (existing row,
        v                                                   |                          caller metadata discarded)
 rpc mark_compute_job_kept_figures(job)                     v
        |                                    Python: _retract_refresh_marker_on_reuse   TS: retractInheritedRefreshMarker
        |                                                   \                           /
        |                                                    rpc retract_ledger_refresh_marker(job, correlation_id)
        v                                                    v
 +------------------------------ compute_jobs row (metadata jsonb) ------------------------------+
 |  ONE UPDATE each:                                                                              |
 |   marker : metadata = <object-or-{}> || {read_refusal_kept_figures: true}                      |
 |   retract: metadata = (metadata - 'source') || {refresh_marker_retracted: <old>, correlation_id}|
 |            WHERE id AND status <> 'done' AND metadata->>'source' IN (ledger-refresh markers)   |
 |   claim RPC (existing): metadata = metadata || {unified_backbone_at_claim}   (additive, unchanged)|
 |   set_compute_job_progress (existing): metadata = metadata || {member_progress...}             |
 |  Row lock + READ COMMITTED re-evaluation: concurrent statements serialise, no key is lost.     |
 +-----------------------------------------------------------------------------------------------+
        |                                                    |
        v                                                    v
 mark_compute_job_failed -> sync_strategy_analytics_status   outcome jsonb {outcome, marker, status}
 (unchanged; reads source / read_refusal_kept_figures)         retracted | done | no_marker | no_row
                                                              -> each caller keeps its own log / Sentry / throw
```

### Recommended Project Structure (files to create or change)

```
supabase/migrations/20261106120000_refusalrace_metadata_merge_rpcs.sql          NEW
supabase/migrations/down/20261106120000-rollback.sql                             NEW
supabase/schema/functions/retract_ledger_refresh_marker.sql                      NEW (generated: npm run schema:functions)
supabase/schema/functions/mark_compute_job_kept_figures.sql                      NEW (generated)
supabase/tests/test_compute_job_metadata_merge.sql                               NEW (SC-3 gate)
analytics-service/services/job_worker.py            _mark_job_kept_figures closure (5305-5326) -> one rpc
analytics-service/services/ingestion/long_fetch.py  _retract_refresh_marker_on_reuse (67-205) -> one rpc + outcome mapping
src/lib/ledger-refresh-marker.ts                    retractInheritedRefreshMarker -> one rpc + outcome mapping
tests: see "Tests that pin the writers today"
census files: see "Every census a new gate file and two functions move"
```

### Pattern 1: the house shape of a new service-role-only SECURITY DEFINER function

Read this session: `supabase/migrations/20260712130000_set_compute_job_progress.sql` (a fenced jsonb merge, the closest precedent), `20261019120000_get_published_trade_venues.sql` (plain `CREATE FUNCTION`, catalogue-only verify, COMMENT, rollback file), `20261105120000_sync_status_protect_refused_derive.sql` (latest migration; REVOKE/GRANT and verify idiom).

- **Timestamp:** the latest file in `supabase/migrations` is `20261105120000_sync_status_protect_refused_derive.sql` (also the last line of `supabase/schema/baseline-carried-migrations.txt`, so it is carried by the dump). Next free: `20261106120000`. Checked: no local branch other than an old backup branch adds a migration beyond origin/main, and `supabase/migrations/down` ends at `20261105120000-rollback.sql`. The backdated-migration policy (`.github/workflows/migration-policy.yml`) compares a PR's added file to PROD's tip, so the name must sort after PROD's tip [ASSUMED: PROD tip is at most 20261105120000; not queried].
- **Header:** `SET LOCAL lock_timeout = '3s';` (as `20261103120000` and `20261105120000` do). The latest migration has no explicit `BEGIN`/`COMMIT` ("Supabase wraps each migration in one implicit transaction"); older ones (`20261019120000`, `20260712130000`) have them. Follow the latest.
- **Plain `CREATE FUNCTION public.<name>`**, not `CREATE OR REPLACE`: both names are new (no file in `supabase/schema/functions` matches `retract|marker|kept|refusal|merge`; no migration defines them), so "a collision must fail loud instead of replacing someone else's body" (`20261019120000` header).
- **`LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog`**, objects schema-qualified `public.compute_jobs`.
- **ACL:** `REVOKE ALL ON FUNCTION public.<name>(<args>) FROM PUBLIC, anon, authenticated;` then `GRANT EXECUTE ON FUNCTION ... TO service_role;`. ⛔ Naming `anon` and `authenticated` explicitly matters: Supabase default privileges grant EXECUTE to those roles directly, so `FROM PUBLIC` alone leaves them with it. The lane fixture `scripts/pg-lane/fixtures/07-fixture-supabase-default-privileges.sql` exists to make that falsifiable. Precedent line: `REVOKE ALL ON FUNCTION set_compute_job_progress(UUID, UUID, JSONB) FROM PUBLIC, anon, authenticated;` / `GRANT EXECUTE ON FUNCTION set_compute_job_progress(UUID, UUID, JSONB) TO service_role;` (migration `20260712130000`).
- **COMMENT:** a plain `COMMENT ON FUNCTION public.<name>(<args>) IS '...';` for a NEW function (as `get_published_trade_venues` and `set_compute_job_progress`). I found no repo rule named "guarded COMMENT". The nearest thing is the `DO $comment$ ... to_regprocedure ... position(stale IN current) ... EXECUTE format('COMMENT ON FUNCTION ... IS %L')` block in `20261105120000`, which exists only to edit an existing comment and is not needed here.
- **Verify block:** catalogue-only (`pg_proc.prosecdef`, `proconfig`, `has_function_privilege`, `aclexplode` for PUBLIC), no table read, so it applies on schema-only TEST ([164.8-DATA-DEPENDENT-MIGRATION-ESCAPE], CLAUDE.md). Copy the `get_published_trade_venues` verify shape; assert service_role HAS EXECUTE and anon, authenticated and PUBLIC do not.
- **prod-body-ack:** NOT needed. It acknowledges overwriting an existing PROD body. VAC-04 (`scripts/prod-body-drift-check.sh`) treats a name absent from PROD as "a NEW function (pass)", measured by two independently derived name indexes. Do not add the pragma.
- **Rollback:** `supabase/migrations/down/20261106120000-rollback.sql`, shaped like `down/20261019120000-rollback.sql` (header explaining it is manual and never pushed, the ledger-row warning, `DROP FUNCTION IF EXISTS public.<name>(<args>)` for both, a catalogue check). Order note for the header: revert the callers first. A caller whose RPC vanished fails loud: the marker write then fails the job TRANSIENT (refusal path retries), the retraction fails logged and non-fatal.
- **Down-file contents the rollback must not break:** nothing else depends on the new functions in SQL.

### Pattern 2: a caller reduced to one RPC plus an outcome map

Python marker closure, inside the existing `_stamp_io` call (keep `op=_STAMP_OP_REFUSAL_MARKER_WRITE`, keep it BEFORE the sentence upsert at `job_worker.py:5329-5365`):

```python
# Sketch only. The RPC name is a proposal; the key/op/ordering are today's.
def _mark_job_kept_figures() -> None:
    resp = ctx.supabase.rpc("mark_compute_job_kept_figures", {"p_job_id": job.get("id")}).execute()
    if getattr(resp, "data", None) is not True:     # zero rows = did not land (see Open Question 2)
        raise RuntimeError("kept-figures marker did not land")
await _stamp_io(lambda: db_execute(_mark_job_kept_figures), op=_STAMP_OP_REFUSAL_MARKER_WRITE, **_stamp_io_args)
```

`RuntimeError` is not in `_READ_PROGRAMMING_ERRORS` (`job_worker.py:3388-3397`: `AssertionError, AttributeError, ImportError, IndexError, KeyError, NameError, TypeError, ZeroDivisionError`), so `_stamp_io` converts it into `StampIOUnavailable` (TRANSIENT) exactly as it converts the `RuntimeError("db down")` the existing test injects. Do not raise a `KeyError`/`TypeError`/`AssertionError`: those re-raise unchanged as `unknown`.

TS helper after the change (the body shrinks to one call and a switch; keep the exported name, the `retractionFailureCode` function and the thrown-`Error`-with-`cause` contract):

```ts
const { data, error } = await admin.rpc("retract_ledger_refresh_marker", { p_job_id: jobId, p_correlation_id: correlationId });
if (error) throw new Error("compute_jobs marker retraction failed", { cause: error });
// outcome "retracted" -> { retracted: true, marker }; "done" | "no_marker" -> { retracted: false };
// "no_row" -> throw (today's "row not readable" anomaly); anything else -> throw (fail loud).
```

### Pattern 3: the SQL function bodies (proposed)

```sql
-- retraction: ONE UPDATE does the work; the classification SELECT runs only on a miss.
CREATE FUNCTION public.retract_ledger_refresh_marker(p_job_id uuid, p_correlation_id text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE v_marker text; v_status text; v_source text; v_found boolean;
BEGIN
  UPDATE public.compute_jobs
     SET metadata = (metadata - 'source')
                    || jsonb_build_object('refresh_marker_retracted', metadata->>'source',
                                          'correlation_id', p_correlation_id)
   WHERE id = p_job_id
     AND status <> 'done'
     AND (metadata ->> 'source') IN ('ledger-refresh', 'ledger-refresh-composite')
  RETURNING metadata->>'refresh_marker_retracted' INTO v_marker;
  IF FOUND THEN RETURN jsonb_build_object('outcome','retracted','marker',v_marker); END IF;
  SELECT status, metadata->>'source', true INTO v_status, v_source, v_found
    FROM public.compute_jobs WHERE id = p_job_id;
  IF v_found IS NOT TRUE THEN RETURN jsonb_build_object('outcome','no_row'); END IF;
  IF v_status = 'done' THEN RETURN jsonb_build_object('outcome','done','status',v_status,
       'marker', CASE WHEN v_source IN ('ledger-refresh','ledger-refresh-composite') THEN v_source END); END IF;
  RETURN jsonb_build_object('outcome','no_marker','status',v_status);
END $$;
```

Notes on the shape (each is a deliberate choice, not decoration):
- Write the marker test as `(metadata ->> 'source') IN ('ledger-refresh', 'ledger-refresh-composite')`, the same text form the bridge uses, so the existing TS oracle regex `->>\s*'source'\)\s*IN\s*\(([^)]*)\)` (`src/lib/ledger-refresh-marker.test.ts`, `parseSqlLedgerRefreshSourceLists`) parses it from the new snapshot with no new parser.
- In the SET expression every reference to `metadata` reads the row version the statement locked, which is what makes it safe (READ COMMITTED quote above). In `RETURNING`, `metadata` is the NEW row, so the old marker is read back from `refresh_marker_retracted`.
- `metadata ->> 'source'` on NULL, an array or a scalar yields NULL, so none of those match the IN list. `metadata - 'source'` is therefore only ever evaluated on an object. That reproduces today's "null/array metadata is not a marker" behaviour (TS test `never rewrites a job without a ledger-refresh marker (%s)`: another source, null metadata, array metadata).
- `status <> 'done'` mirrors the existing `.neq("status","done")` filter (PostgREST `neq`), including that `done_pending_children`, `failed_final` and the rest ARE retracted. Status set: [VERIFIED: supabase/schema/baseline.sql:1965] `("status" = ANY (ARRAY['pending'::"text", 'running'::"text", 'done'::"text", 'done_pending_children'::"text", 'failed_retry'::"text", 'failed_final'::"text"]))`.
- `p_correlation_id` NULL yields a JSON null `correlation_id`, which is what Python writes today when it passes `None`; Python's default is `""` (`long_fetch.py:220` `correlation_id = metadata.get("correlation_id", "")`).
- The marker function:

```sql
CREATE FUNCTION public.mark_compute_job_kept_figures(p_job_id uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
BEGIN
  UPDATE public.compute_jobs
     SET metadata = CASE WHEN jsonb_typeof(metadata) = 'object' THEN metadata ELSE '{}'::jsonb END
                    || jsonb_build_object('read_refusal_kept_figures', true)
   WHERE id = p_job_id;
  RETURN FOUND;
END $$;
```

  The `jsonb_typeof` guard is not in D-03's literal `COALESCE(metadata, '{}') ||`. It matters: `'{"a":"b"}'::jsonb || '42'::jsonb` returns an ARRAY, and an array `||` an object appends to the array [CITED: postgresql.org functions-json "All other cases are treated by converting a non-array input into a single-element array"]. Today's Python guards with `_meta if isinstance(_meta, dict) else {}` (`job_worker.py:5321`), so a non-object column is replaced by a fresh object. The guard keeps that parity and keeps `metadata->>'source'` meaningful for the bridge. [ASSUMED: `jsonb_typeof` returns `'object'` for objects and `'null'` for a JSON null; the gate arm for non-object metadata is what proves it.]

### Anti-Patterns to Avoid

- **A read before the write in either caller.** Any `select` of `metadata` followed by a write reintroduces the window. After the change a caller must issue no `table("compute_jobs").select/update` for this purpose; the RED test asserts exactly that.
- **`REVOKE ... FROM PUBLIC` alone** (see ACL note).
- **Changing `enqueue_compute_job`** (D-01) or the `sync_strategy_analytics_status` body (it keeps reading `source`).
- **Fencing the marker on `claim_token` without a decision.** Today's marker write is unfenced (`.eq("id", job.get("id"))` only). `set_compute_job_progress` is fenced, so a fence is the house instinct, but a fenced no-op changes outcomes (see Open Question 4).
- **Adding a waiver** to `WAIVED_CEILING`, or widening `NAME_SET_RATCHET`/the content-drift allowlist to make a gate green (both files forbid it in their own headers).

## The three writers today (exact current contract)

### 1. Refusal marker, `analytics-service/services/job_worker.py`

- Constants [VERIFIED: job_worker.py:3614 and :3621]: `_STAMP_OP_REFUSAL_MARKER_WRITE = "mark the refused job as having kept the figures"` and `READ_REFUSAL_KEPT_FIGURES_KEY: Final[str] = "read_refusal_kept_figures"`. The comment at :3616-3620 calls the literal "a CROSS-LANGUAGE CONTRACT with that migration" (20261105120000).
- Site [VERIFIED: job_worker.py:5290-5327]: guarded by `if keep_numbers and final_refusal:`; closure `_mark_job_kept_figures()` does `select("metadata").eq("id", job.get("id")).maybe_single().execute()`, takes `_row.get("metadata")` if it is a dict (else `{}`), then `update({"metadata": {**_meta, READ_REFUSAL_KEPT_FIGURES_KEY: True}}).eq("id", job.get("id")).execute()`. Run as `await _stamp_io(lambda: db_execute(_mark_job_kept_figures), op=_STAMP_OP_REFUSAL_MARKER_WRITE, **_stamp_io_args)`. It runs BEFORE `_upsert_error_only` (the sentence).
- Failure contract: any exception from the closure (the read or the write) becomes `StampIOUnavailable` (TRANSIENT) via `_stamp_io` (`job_worker.py:3624-3715`) with one ERROR line and one capture, and nothing after it runs (no sentence). A zero-row UPDATE is silent success today (no `.data` check).
- Retryable refusals write nothing (`final_refusal` false).

### 2. Python retraction, `analytics-service/services/ingestion/long_fetch.py:67-205`

- Sync function, called inside the tail's `try:` at `long_fetch.py:770` with `correlation_id` defaulting to `""` (:220). It raises on any read/update exception, which the caller logs as `process_key_long.enqueue_tail_failed` (:~775).
- Flow: `if not job_id: return`; late-import `LEDGER_REFRESH_JOB_SOURCES` (`job_worker.py:1149-1153`: `LEDGER_REFRESH_SINGLE_KEY_SOURCE: Final[str] = "ledger-refresh"`, `LEDGER_REFRESH_COMPOSITE_SOURCE: Final[str] = "ledger-refresh-composite"`, `LEDGER_REFRESH_JOB_SOURCES: Final[frozenset[str]] = frozenset({LEDGER_REFRESH_SINGLE_KEY_SOURCE, LEDGER_REFRESH_COMPOSITE_SOURCE})`); select `metadata` `maybe_single`; a missing row or non-dict metadata or `source` not in the set is a QUIET return; else build `{k:v for k,v in metadata.items() if k != "source"}` plus `retracted["refresh_marker_retracted"] = marker` and `retracted["correlation_id"] = correlation_id`; `update({"metadata": retracted}).eq("id", job_id).neq("status", "done")`.
- Outcomes and exact log events (structlog, `log = structlog.get_logger("quantalyze.analytics.long_fetch")`):
  - `.data` non-empty list → `log.warning("process_key_long.refresh_marker_retracted", job_id=str(job_id), marker=marker)`, return.
  - zero rows → re-read `status`; `done` → `log.info("process_key_long.refresh_marker_retraction_skipped_done", job_id=..., marker=...)`, return.
  - otherwise `log.error("process_key_long.refresh_marker_retraction_matched_no_row", job_id, marker, status)` plus ONE tagged `sentry_sdk.capture_message("process_key_long.refresh_marker_retraction_matched_no_row: the job vanished before the marker could be retracted", level="error")` inside `new_scope()` with tags `compute_job_id` and `refresh_marker`, all wrapped so a Sentry failure logs `process_key_long.refresh_marker_retraction_sentry_failed` and never raises (:200-205).

### 3. TS retraction, `src/lib/ledger-refresh-marker.ts`

- `retractInheritedRefreshMarker(admin, jobId, correlationId): Promise<{retracted:false}|{retracted:true; marker:string}>`; `!jobId` → `{retracted:false}` with no DB call.
- Read `select("metadata, status").eq("id", jobId).maybeSingle()`: read error → `throw new Error("compute_jobs metadata read failed", { cause })`; no row → `throw new Error("compute_jobs row not readable for the job enqueue_compute_job just returned; an inherited marker may still be in place")`; `status === "done"` → `{retracted:false}` with no UPDATE; non-object/array metadata or a `source` that is not a string in `MARKER_SET` → `{retracted:false}`.
- Update `.update({metadata:{...rest, refresh_marker_retracted: source, correlation_id}}).eq("id").neq("status","done").select("id")`: update error → `throw new Error("compute_jobs metadata update failed", { cause })`; zero rows → re-read status (`"compute_jobs status re-read failed"` on error), `done` → `{retracted:false}`, else `throw new Error(\`compute_jobs metadata update matched no row; the inherited ${source} marker was NOT retracted\`)`.
- `retractionFailureCode(err)` reads `err.cause.code` and returns `"none"` otherwise (kept unchanged).
- Callers: `keys/sync/route.ts:406` (budget race `MARKER_RETRACTION_BUDGET_MS`, tags `keys-sync.composite_refresh_marker_retract`, `..._timeout`, `..._late`) and `finalize-wizard/route.ts:2343` (own try/catch, tags `surface: "finalize-wizard-after"`, `side_effect: "composite_refresh_marker_retract"`). Neither route changes.

### Contract that survives, and the one that cannot

| Today | After (one RPC) |
|---|---|
| Python quiet on missing row at the first read | `no_row` outcome. Python must pick: quiet (parity with its first-read arm) or loud (parity with its "vanished between read and write" arm). See Open Question 3; recommendation loud. |
| TS throws "not readable" on missing row | `no_row` → same throw, same message |
| Zero-row UPDATE while the job still exists and is not `done` (the read-to-write window) → TS throws "matched no row", Python error + Sentry | Unreachable by construction: one UPDATE has no gap. Those arms and their tests are retired deliberately, not silently |
| `done` row | `done` outcome; Python logs `...skipped_done` only when the row carries a marker (the function returns `marker` for a done marked row); TS returns `{retracted:false}` |
| PostgREST error | `.error` set (TS) / exception from `.execute()` (Python): TS throws with `cause`; Python propagates to the tail's `try:` as today |

## Tests that pin the writers today

**Python (`analytics-service/tests`, run from `analytics-service/`; baseline: the two files below pass 160 tests in 8.67 s on this tree).**
- `test_derive_broker_dailies_dualmode.py`: `_build_ctx` (:64-158) records `capture["updates"]` for `compute_jobs` updates and `capture["rpc_calls"]` as `(name, payload)`; `TestStrategyModeRefusal._refuse` (:2618-2688, `live_job_metadata`, `break_the_job_marker_write` which sets `tbl.update.side_effect = RuntimeError("db down")`). Pins: `test_where_numbers_exist_the_refusal_is_error_only_and_keeps_them` (:2693-2753, asserts `capture["updates"] == [{"table":"compute_jobs","payload":{"metadata":{READ_REFUSAL_KEPT_FIGURES_KEY: True}},"filters":{"eq:id":"j-st"}}]` and that the update precedes the strategy_analytics upsert via `capture["ops"]`), `test_the_job_marker_is_merged_into_the_live_metadata_not_written_over_it` (:2756-2772, asserts the replace payload `{**live, KEY: True}`), `test_a_refusal_on_a_job_a_users_sync_now_took_over_is_marked_too` (:2774-2799), `test_a_retryable_refusal_over_published_figures_writes_nothing_to_the_row` (asserts `capture["updates"] == []`), `test_a_final_refusal_writes_the_marker_before_the_sentence` (:2832-2860), `test_a_marker_that_did_not_land_fails_the_job_transient_and_writes_no_sentence` (:2862-2876, `pytest.raises(StampIOUnavailable)`).
  ⚠️ `_assert_nothing_else_written` (:2690-2697) asserts `capture["rpc_calls"] == []`. After the change the marker IS an rpc call, so that helper (and every caller of it) must filter out the new RPC name. This breaks on the first run; plan for it.
- `test_ledger_refresh_reuse_collision.py`: `_Queue` double (:97-155) reproduces dedup (returns the existing id, discards `p_metadata`) and `_queue_supabase` (:158-257) implements `compute_jobs` select/update chains with `after_next_read` hooks and a `.neq` filter, and an `rpc` branch only for `enqueue_compute_job`. `TestRetractionHelper` (:~795-880: single-key retracted, composite retracted, unmarked left alone, null metadata left alone, `done` not rewritten, `running` still retracted), `TestRetractionAuditTrailTellsTheTruth` (:~883-1010: retracted line only when a row matched, `finishes between read and write`, `vanishes between read and write` is an error with a Sentry capture, Sentry transport failure never masks), the end-to-end `test_tail_enqueue_that_deduped_onto_a_refresh_retracts_the_marker` (:~358-395), and `TestNoStrayEnqueueLostItsReadBack.test_tail_enqueue_captures_the_returned_job_id` (:~1822-1840, `inspect.getsource` asserts `"tail_job_id = supabase.rpc("` and `"_retract_refresh_marker_on_reuse("` are in `run_process_key_long_job`). The queue double needs an `rpc("retract_ledger_refresh_marker")` branch that mirrors the function contract; the `after_next_read` interleave hooks stop being reachable (no read exists) and those cases become outcome-mapping cases.
- `test_ledger_refresh_composite_nondestructive.py` and `test_stamp_io_exhaustive.py` only seed `refresh_marker_retracted` into a live row for the honour sites; they are unaffected.
- Other `long_fetch` tests (`test_long_fetch.py`, `test_long_fetch_follow_on_guard.py`, `test_mt5_derive_branch.py`) mock `rpc` to return `data=None`, so `_retract` returns at `if not job_id` and they stay green.
- `scripts/probe_composite_claimtime.py:772-781` is a lane probe that simulates the TS retraction with a raw single UPDATE `(COALESCE(metadata,'{}'::jsonb) - 'source') || jsonb_build_object('refresh_marker_retracted', %s::text, 'correlation_id', %s::text)`. It is not a test of the helper; it can keep its raw SQL, or call the real function (optional).

**vitest.**
- `src/lib/ledger-refresh-marker.test.ts`: `fakeAdmin` models only the `from("compute_jobs")` select/update/neq/select chains (:114-185) and throws on any other table; cases from "the Python oracle is the two real markers" through `retractionFailureCode`. The parity oracles live here (`parsePythonLedgerRefreshSources`, `parseSqlLedgerRefreshSourceLists`, with the exact-count pin `expect(lists.length, ...).toBe(3)` for the bridge snapshot at `supabase/schema/functions/sync_strategy_analytics_status.sql`).
- `src/app/api/keys/sync/route.test.ts`: the hoisted `computeJobsRead`/`computeJobsUpdateResult`/`mockComputeJobsUpdate` and the `table === "compute_jobs"` mock (:62-76, :270-304) drive the `[161.1-D13]` describe (:892-1110: both markers rewritten, unmarked never rewritten, failed retraction never changes the 202 and is LOUD, 5 s budget, late rejection tag, in-time failure reported once). `mockRpc` already serves `enqueue_compute_job`; the retraction must become an RPC branch there.
- `src/app/api/strategies/finalize-wizard/route.test.ts`: `STATE.computeJobsRow/ReadError/UpdateError/Updates` (:118-124, :499-560, :787-790) and the describe at :2815-2900, plus :5576-5593 (a skipped run retracts nothing). Same conversion.
- `src/__tests__/audit-coverage.test.ts`: see Pitfall 6.

### How each writer's test goes RED on today's replace behaviour

Offline doubles cannot prove concurrency; they can prove SHAPE, which is what fails on replace. Neuter by restoring the old body from a byte backup (never `git checkout/stash`).
- **Python marker:** assert `capture["rpc_calls"]` contains exactly one `("mark_compute_job_kept_figures", {"p_job_id": "j-st"})`, `capture["updates"] == []`, and no `compute_jobs` `select` (extend `_build_ctx`'s table mock to record selects). Today's code issues a select and an update and no rpc, so all three fail. Keep the ordering assertion (rpc before the strategy_analytics upsert) via `capture["ops"]`, recording rpc in `ops`. Keep `test_a_marker_that_did_not_land...` by making the rpc raise, and add the zero-row case (`data` False) if Open Question 2 is accepted.
- **Python retraction:** extend the `_Queue` double so any `compute_jobs` table access from the helper raises "read-modify-write attempted", and implement the RPC branch with the function's contract. Assert one RPC call, zero table calls. Under today's code the table path trips the sentinel. Keep the outcome-mapping cases (retracted → warning line, done-and-marked → info line, no_marker → no log, no_row → chosen behaviour, exception propagates).
- **TS:** make `fakeAdmin.from` throw `unexpected from(compute_jobs)`, add `rpc`, assert one call with `{p_job_id, p_correlation_id}`, map the four outcomes, `error` → throw with `cause` (reuse `retractionFailureCode` test), unknown outcome → throw. Today's code calls `from` and throws.
- **The interleave proof is SQL, not mocks** (next section).

## SC-3: the interleaving gate

### Gate file style (follow `test_api_key_nav_marks.sql` and `test_set_compute_job_progress.sql`)

- New file `supabase/tests/test_compute_job_metadata_merge.sql` (auto-discovered by the `test_*.sql` glob that `sql-tests` runs on the local-stack lane; no pgTAP; plain `DO` blocks; no psql meta-commands; whole file inside `BEGIN; ... ROLLBACK;`; seed with `gen_random_uuid()` and `@invalid.local` emails; `pg_temp` helper functions only return values).
- Arms in order, each with a `TEST FAILED (N)` identity raised DIRECTLY in the DO body (the runner reads an identity only from a single-frame `inline_code_block` raise) and a sentinel `RAISE NOTICE 'ALL N ARMS EXECUTED (1,...,N)'` at the foot before ROLLBACK. Each arm carries a prose `RED-UNDER:` and a machine twin `RED-UNDER-M: {"arm":"..","apply":[{"kind":"edit","file":"supabase/migrations/20261106120000_refusalrace_metadata_merge_rpcs.sql","find":"...","replace":"...","occurrences":1}]}` whose `occurrences` is MEASURED (GRAMMAR rule 2). Suggested arms (N is fixed by the final file; about 10):
  1. Catalogue/ACL: both functions SECURITY DEFINER, `search_path=public, pg_catalog`, service_role EXECUTE, anon/authenticated/PUBLIC none. Twin: widen the GRANT to `service_role, authenticated`.
  2. Marker merges into live metadata: seed `source`, `correlation_id`, `unified_backbone_at_claim`, `member_progress`; after the call all survive, `read_refusal_kept_figures` is `true`, function returns `true`. Twin: drop the merge (assign the single-key object).
  3. Marker on NULL / JSON null / array metadata yields a fresh object; unknown job id returns `false` and writes nothing. Twin: remove the `jsonb_typeof` guard.
  4. Retraction of EACH marker (`ledger-refresh`, `ledger-refresh-composite`): `source` gone, `refresh_marker_retracted` = old source, `correlation_id` set, every other key kept, outcome `retracted` with `marker`. Twin: narrow the IN list to one marker.
  5. Not a marker (other source, NULL metadata, array metadata): outcome `no_marker`, `to_jsonb(row)` byte-identical. Twin: delete the marker predicate.
  6. `done` row: outcome `done`, row byte-identical; `running`, `done_pending_children`, `failed_final`, `pending` are retracted. Twin: delete `status <> 'done'`.
  7. Missing row / NULL id: outcome `no_row`.
  8. THE INTERLEAVING (SC-3): on one row, apply marker and retraction in both orders; end state equal and containing every key from both. Twin: make the marker function replace the column.
  9. Three-way, all six permutations of {marker, retraction, claim-style additive write}. The claim-style statement is the claim RPC's own expression, copied: `metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('unified_backbone_at_claim', ...)` (`supabase/schema/functions/claim_compute_jobs_with_priority.sql:410-416`). Twin: make the retraction rebuild the object from a stale copy.
  10. Control (anti-vacuity): the old read-then-replace sequence, run in the same harness, DOES lose a key. Proves the harness can tell the two behaviours apart.
  11. (optional) `p_correlation_id` NULL writes a JSON null; metadata near the 8192-byte cap raises `23514` loudly rather than truncating.
- `RED-UNDER-SETUP: {"apply":[...]}` for the mutation lane: copy `test_set_compute_job_progress.sql:63` and append the new migration: `scripts/pg-lane/fixtures/01-fixture-core.sql`, `15-fixture-auth-role.sql`, `02-fixture-sanitize-tables.sql`, `03-fixture-compute-jobs.sql`, `07-fixture-supabase-default-privileges.sql`, `supabase/migrations/20260411144407_compute_jobs_queue.sql`, `scripts/pg-lane/fixtures/04-fixture-compute-jobs-targets.sql`, then the new migration (the claim-token fencing migration is NOT needed because these functions never touch `claim_token`; add `20260515114555_compute_jobs_claim_token_fencing.sql` only if an arm seeds a claim token). Never target a pg-lane stand-in fixture with a mutation (GRAMMAR rule 4).
- The gate must carry no `UPDATE strategy_analytics` (see census item 9), must not create a table named like a migration table (sql-gate-lint R5/R6/R7), and must catch `P0001`-style raises only by the identity idiom. Run `node scripts/lint-sql-gates.mjs --self-test` and `node scripts/lint-sql-gates.mjs`.

### Honest limit, and the genuine concurrency proof

A single-session SQL gate proves order independence and the guards, not true concurrency. The concurrency claim rests on the PostgreSQL READ COMMITTED rule quoted above. To demonstrate it, add a Python live probe (psycopg, two connections), modelled on `analytics-service/tests/test_upsert_strategy_analytics_series_batch_privilege.py` (`HAS_LIVE_DB`/`TEST_SUPABASE_DB_URL` idiom) and `test_nav_marks_writer_live.py` (loopback-only guard, skip locally when the lane is unset, `pytest.fail` when `CI == "true"`): connection A begins and calls the marker function (row locked, uncommitted); connection B calls the retraction (blocks); A commits; B proceeds and re-evaluates; assert the row holds both keys and the claim-style key seeded earlier. Run it also in reverse. `tests/conftest.py` groups any module whose source contains `TEST_SUPABASE_DB_URL`/`HAS_LIVE_DB` onto the serialized worker automatically. Offline pytest/vitest doubles are explicitly "a mirror" (that probe's own docstring); do not present them as the race proof. A second small probe through PostgREST (the `SUPABASE_TEST_URL` idiom) would also prove the `jsonb` return arrives as a dict in `.data` for supabase-py.

## Every census a new gate file and two functions move

Measured on this tree (HEAD of `feat/191-refusalrace`). **Method:** do not hand-compute. Make the change, run the pinning tests, read each `expected X to be Y`, and move the pin to the measured value in the same commit, writing the measurement into the adjacent comment (the repo's `⭐ CURRENCY` convention). The list below is the complete set of sites the NAVMTM precedent commit `bc913db76` touched for "one new annotated gate file, N arms, one new function", re-checked against current values.

| # | Census | File and symbol | Current | After (F = new gate file, N = its arms, K = new functions) |
|---|---|---|---|---|
| 1 | mutation runner files floor | `scripts/mutation-floors.mjs` `FILES_FLOOR` (:1336) | 79 | 80 |
| 2 | mutation runner arms floor | `scripts/mutation-floors.mjs` `ARMS_FLOOR` (:3377) | 791 | 791+N |
| 3 | waiver ceiling | `WAIVED_CEILING` (:3491) | 0 | 0 (never add a waiver) |
| 4 | ci.yml sentinel files | `.github/workflows/ci.yml` `SENTINEL_FLOOR` (:5244) | 26 | 27 |
| 5 | ci.yml sentinel arms | `.github/workflows/ci.yml` `ARMS_FLOOR` (:5245), its derivation sum comment, and the contiguous `#   test_<name>.sql   N` table above it (file-name order, no blank or differently indented line inside it) | 405 | 405+N; add the row |
| 6 | pin of the two ci.yml values | `src/__tests__/drift-check-scripts.test.ts` the test at :4821 greps `"SENTINEL_FLOOR=26"` and `"ARMS_FLOOR=405"` (:5081, :5092) | 26 / 405 | 27 / 405+N (also its title string) |
| 7 | sentinel table re-derivation | `src/__tests__/contracts/ci-anti-skip-gate.contract.test.ts` | re-derives from corpus | no edit; goes red until #4/#5 are right |
| 8 | gate-family pins | `src/__tests__/gate-family-meta.test.ts` keys `"scripts/mutation-floors.mjs :: FILES_FLOOR=79"` (:944) and `"... ARMS_FLOOR=791"` (:945) | 79 / 791 | 80 / 791+N |
| 9 | runner-output pins | `src/__tests__/mutation-runner-floors.test.ts` `totalAnchored` (:754) and the GREEN_LOG echoes `scope: FULL 79/79`, `coverage: files 79/106`, `arms: 791/791/0`, `biting: 791`, `lane-invocations: 791 ... plus 79 baseline / 79 restore`, `mean 1.6s over 791 arm run(s)`, `791 arm lane(s) spawned`, `reports 791`, `executed=791 ...` and the derived strings at :1821, :1880, :2185-2191, :2379, :2421, :2736, :2785-3029, :3098, :3162, :3201, :3353, :3492, :3500 | 791 / 79 / 106 | 791+N / 80 / 107. `grep -nE '791|79/79|79/106|79 baseline' src/__tests__/mutation-runner-floors.test.ts` |
| 10 | annotation parser pins | `src/__tests__/mutation-annotation-parser.test.ts` `armsSeen` (:1109) 791, `stepsSeen` (:1151) 888, `needles.length` (:2109) 888, `corpus.filesTotal` (:2716, :3373) 106, `corpus.filesAnnotated` (:2805) 79 plus the by-name `annotatedFiles` list (:2806-), `annotatedFiles` `toHaveLength` (:3418) 79 | as listed | armsSeen 791+N, steps/needles 888+N (NAVMTM: 11 arms moved steps 905→916), filesTotal 107, filesAnnotated/annotatedFiles 80 and add `test_compute_job_metadata_merge.sql` to the list |
| 11 | sql-gate-lint file count | `src/__tests__/lint-sql-gates.test.ts` `expect(res.out).toMatch(/scanned 106 file/)` (:1175) | 106 | 107 |
| 12 | baseline content drift | `scripts/baseline-content-drift-check.mjs` `COMPARED_FLOOR` (:293) | 132 | 132+K = 134 |
| 13 | name-set ratchet | `scripts/dump-sql-functions.ts` `NAME_SET_RATCHET`: add one `snapshot-only` row per new function (`name`, `side`, `capturedAt`, `clearedBy` "a regeneration of supabase/schema/baseline.sql taken AFTER 20261106120000_... has applied to PROD", `reason`); the post-apply re-dump turns them `ratchet-stale` and they are DELETED | 0 rows for this phase | +2 rows |
| 14 | function snapshots | `supabase/schema/functions/<name>.sql` generated by `npm run schema:functions`; verify with `npm run schema:functions:check` | 130 files | 132 files |
| 15 | scoped-update census | `analytics-service/tests/test_sql_gate_scoped_updates.py` | counts only `UPDATE (public.)?strategy_analytics` | no change if the new gate has no such UPDATE; the gate updates only `compute_jobs` |
| 16 | audit allowlist | `src/__tests__/audit-coverage.test.ts` `MUTATING_RPC_NAMES` | lacks the new name | add `retract_ledger_refresh_marker` (Pitfall 6) |
| 17 | parity pins | `src/lib/ledger-refresh-marker.test.ts` and a new pytest | see below | extend |
| 18 | TS generated types | `src/lib/database.types.ts` ("GENERATED FILE — do not hand-edit") | no entry | leave to the next types regeneration; the helper takes an untyped `SupabaseClient` so it compiles without it |
| 19 | release files | `CHANGELOG.md`, `VERSION`, `package.json` (byte-equal 4-digit), `TODOS.md` entry `[186-REFUSAL-MARKER-RMW-RACE]` closure note (dated CORRECTED line that D-01 replaced "a merge arm in enqueue_compute_job"), stale doc text: the `RESIDUAL` paragraphs in `long_fetch.py`'s docstring (:100-111) and `ledger-refresh-marker.ts`'s JSDoc ("The real closure is a merge arm in `enqueue_compute_job`"), and the comment at `job_worker.py:5304` ("A read-modify-write, because PostgREST replaces the column") | | |

`baseline.sql`, `BASELINE.md` and `baseline-carried-migrations.txt` are NOT edited in the feature PR: the post-apply re-dump moves them together (see `chore(release): v0.133.1.1 — baseline re-dump after the PROD apply of bc913db7`).

If the founder prefers fewer census edits, the alternative is to add the new arms to the already-annotated `test_set_compute_job_progress.sql` (same subject: a compute_jobs metadata merge RPC). That removes rows 1, 4, 5 (if it carries no sentinel), 6, 10 (files), 11 and part of 9, but couples an unrelated migration's setup list to the new one and shares its older `Part N` identity idiom. Recommendation stays: a new file, because its subject, setup list and sentinel are its own and every census edit is mechanical and test-guarded.

## CI behaviour of a function-adding PR

- **`sql-tests`** replays the PR's own new migration on top of the committed dump (Decision F, CLAUDE.md "D-F"): `supabase/schema/baseline-carried-migrations.txt` ends at `20261105120000_sync_status_protect_refused_derive.sql`, so the new file is the only replay and its corpus gates run against the PR's schema.
- **`sql-mutation`** on the PR applies each annotated arm's twin to the new migration on the pg-lane; a push to `main` runs a subset or none (`scripts/sql-gate-subset.mjs`: the gates whose `RED-UNDER-SETUP` loads a changed migration), and `sql-mutation-nightly.yml` is the full-corpus backstop. The new gate lists the new migration, so it is in the subset on the merge push.
- **`sql-function-snapshot.yml` (`snapshot-drift`)** runs `dump-sql-functions.ts --check`: the snapshot files must be regenerated, and DRIFT-05 gate (a) fails a migration-only function name unless a `NAME_SET_RATCHET` `snapshot-only` row exists. [ASSUMED from the NAVMTM diff; not run here because the worktree has no `node_modules`.]
- **`baseline-content-drift` (a step of `sql-gate-lint` in `ci.yml`)** WILL report `SNAPSHOT_MISSING` for each new function until the post-apply baseline re-dump. [VERIFIED: in a scratch copy of `scripts/` and `supabase/schema/` outside the repo, adding one new snapshot file made `node scripts/baseline-content-drift-check.mjs` print `SNAPSHOT_MISSING zz_probe_fn/1 ... no CONTENT_DRIFT_ALLOWLIST row pins this disagreement` and `findings 1`.] The repo accepts this class: `ci.yml` (:2348) says "tolerated baseline-content drift (DRIFT / SNAPSHOT_MISSING rows)" does not force a FULL mutation run on the next push, and the founder's standing rule is that stale-baseline drift red counts as green. Do NOT add an allowlist row to silence it (the script's header forbids it).
- **VAC-04** (`migration-drift-check.yml` → `scripts/prod-body-drift-check.sh`): new names are "measured absent — a NEW function (pass)". **`migration-policy.yml`**: backdate check against PROD's tip. **VAC-08** (`test-db-drift`) sees the migration only after `apply-test`; on a PR it can be red by construction until merge. **`supabase-migrate.yml`**: `apply-test` then PROD `apply` automatically.
- **Deploy ordering hazard:** the migration auto-applies after merge with no human stop, while the analytics service deploys to Railway only after main CI is green and Vercel deploys the TS change on its own clock. A caller deployed before the migration finds no RPC: the marker write fails the job TRANSIENT (retries), the retraction logs/Sentry non-fatally. See Open Question 1.

## SC-1 and SC-5 SQL

Run the marker query FIRST AND ALONE; read the answer; only then run the counts. Save the counts file with NO leading `--` comment (the inline form breaks on it). Counts only. Columns [VERIFIED: supabase/schema/baseline.sql:1930-1953]: `id`, `kind`, `status`, `metadata jsonb`, `created_at`, `updated_at`, `last_error`.

```sql
SELECT shobj_description(oid,'pg_database') AS which_database FROM pg_database WHERE datname=current_database();
```

```sql
WITH j AS (SELECT status, kind, metadata, last_error FROM public.compute_jobs)
SELECT
  count(*) AS retained_jobs,
  count(*) FILTER (WHERE jsonb_exists(metadata, 'read_refusal_kept_figures')) AS jobs_with_read_refusal_kept_figures,
  count(*) FILTER (WHERE jsonb_exists(metadata, 'refresh_marker_retracted')) AS jobs_with_refresh_marker_retracted,
  count(*) FILTER (WHERE jsonb_exists(metadata, 'read_refusal_kept_figures')
                     AND jsonb_exists(metadata, 'refresh_marker_retracted')) AS jobs_with_both,
  count(*) FILTER (WHERE (metadata ->> 'source') IN ('ledger-refresh', 'ledger-refresh-composite')) AS jobs_still_marked_refresh
FROM j;
```

`jsonb_exists(jsonb, text)` is the function behind the `?` operator, used here so no `?` placeholder character is involved. Caveat to record next to the reading: `retention_compute_jobs_done` reaps `done` rows at 30 days and `retention_compute_jobs_failed` at 90 (`supabase/migrations/20260417110539_retention_crons.sql:88-89`), so the counts describe retained jobs only; a lost race leaves no trace, so zero is not proof of absence.

SC-5 (after the migration and both callers are live; same marker-first rule): rerun the counts above, then two catalogue/count reads:

```sql
SELECT p.proname, p.prosecdef,
       has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_exec,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_exec,
       has_function_privilege('service_role', p.oid, 'EXECUTE') AS service_role_exec
FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
  AND p.proname IN ('retract_ledger_refresh_marker', 'mark_compute_job_kept_figures');
```

```sql
SELECT count(*) AS marker_write_failures
FROM public.compute_jobs
WHERE last_error LIKE '%mark the refused job as having kept the figures%';
```

Expected: two rows with `prosecdef` true, `anon_exec` false, `authenticated_exec` false, `service_role_exec` true; `marker_write_failures` not rising after the deploy (the `_STAMP_OP_REFUSAL_MARKER_WRITE` text rides `compute_jobs.last_error` through `StampIOUnavailable`); the two key counts no lower than SC-1's unless retention reaped rows.

## Parity pin: extending LEDGER_REFRESH_JOB_SOURCES to the SQL function

- Current: `src/lib/ledger-refresh-marker.test.ts` parses Python's `LEDGER_REFRESH_JOB_SOURCES` from `job_worker.py` and the bridge snapshot's `(… ->> 'source') IN (…)` lists, and compares both with the TS tuple. The anti-vacuity pin `expect(PYTHON_LEDGER_REFRESH_JOB_SOURCES.size).toBe(2)` and the "a marker added to one side alone turns the case RED" demos are the template.
- Extend: add a describe that reads `supabase/schema/functions/retract_ledger_refresh_marker.sql`, runs the existing `parseSqlLedgerRefreshSourceLists`, asserts an EXACT list count (1) and equality with `LEDGER_REFRESH_JOB_SOURCES`, plus a widened-copy RED demo. Python gets its own direct pin (new pytest reading the same snapshot via `Path(__file__).resolve().parents[2]`, the way `test_sql_gate_scoped_updates.py` does) so Python-to-SQL is no longer only transitive through TS.
- Also pin the marker key: a hand-typed `"read_refusal_kept_figures"` asserted equal to `READ_REFUSAL_KEPT_FIGURES_KEY` and present in BOTH the bridge snapshot (`'read_refusal_kept_figures'` is read as `f.metadata->>'read_refusal_kept_figures'` and `pj.metadata->>...`, `20261105120000` verify block) and the new marker function snapshot. Today the constant's doc comment calls the literal a cross-language contract but no test pins it (tests import the constant, so they cannot catch a typo).
- Pin the outcome vocabulary the same way: `retracted`, `done`, `no_marker`, `no_row` as constants in each language, regex-parsed from the function snapshot.
- Also add a static migration-source privilege test in the spirit of `test_upsert_strategy_analytics_series_batch_privilege.py` (regexes for the REVOKE naming PUBLIC, anon, authenticated, the service_role GRANT, SECURITY DEFINER and the pinned search_path). Cheap, offline, runs even when the SQL lane is skipped.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---|---|---|---|
| Atomic key merge/delete in a JSON column | read-modify-write in app code, advisory locks, retries | `jsonb ||` / `jsonb - text` inside one UPDATE | PG re-evaluates the SET expression on the committed row version; nothing app-side can match that |
| Telling "done" from "no marker" from "no row" | a second round trip from the caller | the function's outcome object | one place decides, both languages map it |
| Proving a gate can fail | a hand-run neuter | `RED-UNDER-M` twins run by `scripts/mutation-runner` | the runner is the only thing that re-executes the claim on every push |
| Counting arms/files | arithmetic in prose | run the pinning tests and copy the measured value | the repo's censuses were wrong in prose four times (CLAUDE.md "Current reading") |
| The marker set | a fourth hand-written list | the same `(metadata ->> 'source') IN (...)` text form + the parity pin | existing oracle regexes parse it |

**Key insight:** this phase adds no mechanism. The two existing merge writers (claim, progress) prove the pattern; the work is making the remaining writers join them, then keeping the many pinned numbers honest.

## Common Pitfalls

1. **`_assert_nothing_else_written` fails on the first run.** It asserts `capture["rpc_calls"] == []` (`test_derive_broker_dailies_dualmode.py:2697`); the marker is now an rpc. Filter by name there and in any similar assertion in tests that drive the final refusal.
2. **Non-object metadata.** `jsonb || jsonb` on an array or scalar yields an array. Use the `jsonb_typeof` guard in the marker function (Pattern 3); arm 3 proves it.
3. **`metadata` in `RETURNING` is the new row.** Read the old marker back from `refresh_marker_retracted`, not from `source`.
4. **REVOKE without naming anon/authenticated** leaves Supabase default grants in place. Name them; assert with `has_function_privilege` for each role; the pg-lane fixture 07 makes the mutation falsifiable.
5. **8192-byte cap.** `compute_jobs_metadata_size_bounded` (`octet_length(metadata::text) <= 8192`, baseline.sql:1963) applies to the merged value. A job near the cap makes the merge raise 23514, loudly, where today's replace would also have raised. Not a new failure mode, but the marker still fails the job TRANSIENT in that case.
6. **The audit-coverage pragma goes decorative.** `src/__tests__/audit-coverage.test.ts` decides that a route's call to `retractInheritedRefreshMarker` is a mutation by running `moduleExportMutates` on the helper's body, which detects `.from(...).update(...)` chains and the names in `MUTATING_RPC_NAMES` (:~377-). After the cut-over the helper has only a `.rpc(...)`; unless the new RPC name is added to `MUTATING_RPC_NAMES`, the helper stops counting as a mutator and the `@audit-skip` pragmas above the two route call sites (`finalize-wizard/route.ts:~2342`; keys/sync) stop being evaluated. The SEC-03 comment in that array records the exact failure ("its ABSENCE here is what made the pragma decorative"). Add the name, and keep an `@audit-skip` comment above the `.rpc(` in the helper. [ASSUMED from reading `moduleExportMutates`; run the test to confirm.]
7. **Stale prose.** Three comments assert that the real closure is "a merge arm in `enqueue_compute_job`": `long_fetch.py` docstring, `ledger-refresh-marker.ts` JSDoc, the TODOS entry. Leaving them contradicts D-01. Rewrite them in the same change; do not leave a "RESIDUAL" paragraph describing a race that no longer exists, but do keep D-02's gap (dedup-to-retraction) described as unchanged.
8. **`done` plus marker log parity.** Python logs `refresh_marker_retraction_skipped_done` only when the row carried a marker. Return the marker for a done marked row, or the log line changes.
9. **`ALL N ARMS EXECUTED` and the table.** The sentinel count, the ci.yml table row and `ARMS_FLOOR` are three separate edits; the contract test re-derives them and reds on any mismatch. Table rows must stay contiguous and in file-name order.
10. **Mutation twins that mutate the wrong thing.** Each `occurrences` must be measured against the final migration text; a find that matches twice or zero times is refused at parse time. Write the migration first, then the twins.
11. **No `node_modules` in this worktree.** `npx vitest`, `tsx` (`npm run schema:functions`) and `npm run lint` need `npm ci` first. pytest runs from the analytics venv.
12. **Never write the CI-skip trailer tokens** in a commit or PR body (CLAUDE.md), and do not put the PROD marker query output, ids or home paths in tracked text.

## Code Examples

Verbatim contract values used above (each appears in the files cited):
- `_STAMP_OP_REFUSAL_MARKER_WRITE = "mark the refused job as having kept the figures"` (job_worker.py:3614)
- `READ_REFUSAL_KEPT_FIGURES_KEY: Final[str] = "read_refusal_kept_figures"` (job_worker.py:3621)
- `LEDGER_REFRESH_SINGLE_KEY_SOURCE: Final[str] = "ledger-refresh"` and `LEDGER_REFRESH_COMPOSITE_SOURCE: Final[str] = "ledger-refresh-composite"` (job_worker.py:1149-1150)
- `retracted["refresh_marker_retracted"] = marker` and `retracted["correlation_id"] = correlation_id` (long_fetch.py:131-132)
- claim additive write: `metadata    = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('unified_backbone_at_claim', COALESCE(metadata->>'unified_backbone_at_claim', ...` (claim_compute_jobs_with_priority.sql:410-412)
- progress merge: `SET metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('member_progress', p_progress, 'member_progress_at', to_jsonb(now()))` (set_compute_job_progress.sql:21-27)

The new function names, the `p_*` argument names and the outcome strings (`retracted`, `done`, `no_marker`, `no_row`) are this research's PROPOSALS, not facts about the repo; the planner may rename them, keeping the three places in sync (migration, both callers, the parity pins).

Python outcome mapping skeleton (sync helper, keeps today's signature and "never raise on telemetry"):

```python
res = supabase.rpc("retract_ledger_refresh_marker", {"p_job_id": job_id, "p_correlation_id": correlation_id}).execute()
out = getattr(res, "data", None)
outcome = out.get("outcome") if isinstance(out, dict) else None
if outcome == "retracted":  log.warning("process_key_long.refresh_marker_retracted", job_id=str(job_id), marker=out.get("marker"))
elif outcome == "done" and out.get("marker"): log.info("process_key_long.refresh_marker_retraction_skipped_done", job_id=str(job_id), marker=out.get("marker"))
elif outcome == "no_row": ...  # the matched_no_row error line + the one tagged Sentry capture (Open Question 3)
elif outcome in ("done", "no_marker"): pass
else: raise RuntimeError("unrecognised retraction outcome")   # fail loud; the tail's try: logs enqueue_tail_failed
```

## State of the Art

| Old approach | Current approach | When | Impact |
|---|---|---|---|
| PostgREST read-modify-write of `metadata` | single-statement `||` merge in a SECURITY DEFINER RPC (claim 20260515+, progress 20260712) | existing | this phase extends it to the last three writers |
| Prose censuses | floors read by symbol and re-derived by contract tests | 164.3 → | edit pins from measured output only |
| Human reviewer gate on PROD apply | none (removed 2026-09-23) | CLAUDE.md | review before merge, two-PR ordering for readers-first |

## Runtime State Inventory

Not a rename or migration of stored values: no stored string changes. The only persisted state touched is existing `compute_jobs.metadata` rows, whose keys keep their names and values. Stored data: none to migrate (retained jobs keep their current metadata; new merges add keys exactly as today). Live service config: none. OS-registered state: none. Secrets/env vars: none (no new env var; callers use the existing service client). Build artifacts: none, except regenerating `supabase/schema/functions/*.sql` and, later, `src/lib/database.types.ts` by the founder's types workflow.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `jsonb_typeof` returns `'object'` for objects and `'null'` for JSON null; the guard form is right | Pattern 3 | Marker arm 3 would red in the gate, caught before merge |
| A2 | supabase-js returns a `jsonb` RPC result as a plain object in `data` (Python precedent verified, TS not) | Pattern 2 | TS outcome mapping reads `undefined`; caught by the PostgREST live probe or the first TS test against a real lane |
| A3 | PROD's migration tip is at most `20261105120000`, so `20261106120000` passes the backdate policy | Pattern 1 | `migration-policy` red; rename the file |
| A4 | A function-adding PR's `baseline-content-drift` SNAPSHOT_MISSING red is accepted as green by the founder's standing rule | CI behaviour | The PR would be held for a re-dump; ship notes should say so |
| A5 | `dump-sql-functions.ts --check` requires one `snapshot-only` ratchet row per new function (NAVMTM precedent, not run here) | census #13 | `snapshot-drift` red with a named row; add it |
| A6 | `moduleExportMutates` stops flagging the helper once it only calls an unlisted RPC | Pitfall 6 | If it still flags, adding the name is harmless |
| A7 | Deploy order is not guaranteed between migration apply, Railway and Vercel | CI behaviour | If it is guaranteed, one PR is safe; two PRs cost nothing but a merge |
| A8 | Unfenced marker write is the desired parity (D-03 says nothing else changes) | Open Question 4 | A stale worker could mark a re-claimed job; same as today |

## Open Questions (RESOLVED)

All seven were resolved after this research (CONTEXT `## Decisions`, founder 2026-11-04): Q1 by D-06, Q2 by D-07, Q3 by D-08, Q4 to Q7 by D-09. Each question below carries its resolution tag; the original text is kept as lineage.

1. **[RESOLVED: D-06, two PRs, migration first] One PR or two?** The migration auto-applies to PROD with no human stop, and nothing orders it against the Railway and Vercel deploys. Precedent: readers-first PR-A (migration) then PR-B (callers) for `get_published_trade_venues` (170.6.1) and NAVBREACH. Recommendation: two PRs (migration + gate + snapshots + ratchets first; callers + test conversions second), each landed on its own green. If one PR is chosen, the failure window is a TRANSIENT-retried marker write and a logged, non-fatal retraction.
2. **[RESOLVED: D-07, require a confirmed write] Tighten "landed" to `data === true`?** Today a zero-row marker UPDATE is silent success; `RETURN FOUND` makes "did not land" observable, matching Phase 186 R3-02's wording ("a marker that did not land fails the job TRANSIENT"). D-03 says nothing else changes, so this is a small tightening that needs the founder's or planner's nod. Recommendation: tighten, with its own test.
3. **[RESOLVED: D-08, loud] Python on `no_row`.** Today a missing row at the first read is quiet, and a row that vanishes between read and write is error + Sentry; one outcome now covers both. Recommendation: loud (keeps the existing `matched_no_row` line and capture, all existing vanish tests, and matches the TS twin, which already treats it as an anomaly).
4. **[RESOLVED: D-09, unfenced] Fence the marker on `claim_token`?** Parity says no (the existing write is `eq("id")` only; D-03 "nothing else changes"). Recommendation: unfenced; a fence would add a fenced-no-op outcome and a new failure mapping, and belongs in its own phase if wanted.
5. **[RESOLVED: D-09, wanted] Live two-connection probe.** Recommended as the real SC-3 proof (above). It adds one pytest file on the python job's local-stack lane. Confirm it is wanted; otherwise SC-3 rests on the SQL gate plus the PostgreSQL semantics quote.
6. **[RESOLVED: D-09, new file] Gate placement.** New file (recommended) vs arms in `test_set_compute_job_progress.sql` (fewer census edits).
7. **[RESOLVED: D-09, copied expression] Claim interplay beyond a stand-in.** Arm 9 uses the claim RPC's expression copied into the gate. Binding it to the real function needs `claim_compute_jobs_with_priority`'s long setup list; the existing claim gates already prove its additivity. Recommendation: stand-in plus a catalogue arm only if the planner finds the setup list cheap.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|---|---|---|---|---|
| node / npm | vitest, `tsx` scripts, hygiene lint | yes | node 25.8.1 | n/a |
| `node_modules` in this worktree | `npx vitest`, `npm run schema:functions`, `npm run lint` | NO (`ls node_modules` empty) | n/a | `npm ci` in the worktree (plan it as Wave 0) |
| psql, pg_ctl (PostgreSQL) | `scripts/pg-lane/run.sh`, mutation runner | yes (`/opt/homebrew/bin`) | not probed | CI's pg-lane |
| pg_cron on the lane | not needed by this gate | n/a | — | — |
| docker | local-stack lane, live probes, `scripts/local-stack/run.sh` | CLI present, daemon not verified | 29.9.2 client | run the live probe in CI only |
| supabase CLI | SC-1/SC-5 reads (orchestrator) | yes (`~/.local/bin/supabase`), linked to PROD | pinned 2.98.2 in `migration-policy.yml` | — |
| Python venv | pytest, mypy | yes (analytics venv; pytest ran: 160 passed) | — | — |

Missing with fallback: `node_modules` (run `npm ci` from the worktree; do not reach into another worktree). Missing with no fallback: none.

## Validation Architecture

`workflow.nyquist_validation` is `true` in `.planning/config.json`.

### Test Framework

| Property | Value |
|----------|-------|
| Frameworks | pytest (analytics-service), vitest (`src/**`), plain-SQL gates run by psql on the pg-lane and the local-stack lane, mypy strict |
| Config files | `analytics-service/pyproject.toml`, `vitest.config.ts`, `scripts/mutation-floors.mjs` |
| Quick run (Python) | from `analytics-service/`: `<venv>/bin/python -m pytest tests/test_derive_broker_dailies_dualmode.py tests/test_ledger_refresh_reuse_collision.py -q -p no:cacheprovider` (baseline 160 passed) |
| Quick run (TS) | `npx vitest run src/lib/ledger-refresh-marker.test.ts src/app/api/keys/sync/route.test.ts src/app/api/strategies/finalize-wizard/route.test.ts` (after `npm ci`) |
| SQL gate (one file) | `bash scripts/pg-lane/run.sh --workdir <scratch-dir> --apply <RED-UNDER-SETUP list in order> --gate supabase/tests/test_compute_job_metadata_merge.sql` |
| Mutation proof (one file) | `node scripts/mutation-runner/run.mjs --file supabase/tests/test_compute_job_metadata_merge.sql` (diagnostic, never exits 0); the real floors need the full `node scripts/mutation-runner/run.mjs`, one run, no file edited during it |
| mypy (CI line verbatim, from `analytics-service/`) | `mypy --strict --follow-imports=silent --config-file=pyproject.toml services/ routers/ models/ main.py main_worker.py main_worker_healthz.py sentry_init.py` |
| Full suites | `npm test`; pytest full suite from `analytics-service/` (the `python` job enforces `--cov-fail-under=80`); `npm run lint`; `npm run typecheck` |

### Phase Requirements → Test Map

| Req | Behavior | Test type | Automated command | File exists? |
|-----|----------|-----------|-------------------|-------------|
| SC-1 | PROD counts recorded before code | read-only PROD query (orchestrator) | marker query alone, then the counts SQL via `supabase db query --linked -f` | counts file: Wave 0 |
| SC-2 marker | one rpc, no select/update, ordered before the sentence, failure → TRANSIENT, retryable writes nothing | pytest | `pytest tests/test_derive_broker_dailies_dualmode.py -k "refusal or marker"` | exists, to convert |
| SC-2 Python retraction | one rpc, zero table access, 4 outcomes mapped, exceptions propagate | pytest | `pytest tests/test_ledger_refresh_reuse_collision.py` | exists, to convert |
| SC-2 TS retraction | one rpc, 4 outcomes, error → throw with cause, no `from()` | vitest | `npx vitest run src/lib/ledger-refresh-marker.test.ts` and the two route tests | exists, to convert |
| SC-2 RED-on-replace | each converted test fails against the old body | neuter, see RED, restore from byte backup | restore old writer from a backup, run the three commands above, expect failures, restore, `cmp` silent, rerun green | procedure |
| SC-2 parity | marker set (3 copies), marker key, outcome vocabulary | vitest + pytest | `npx vitest run src/lib/ledger-refresh-marker.test.ts`; new pytest reading the snapshot | extend/new |
| SC-3 | interleaving keeps every key; guards; ACL | SQL gate | pg-lane command above; sentinel `ALL N ARMS EXECUTED` | `supabase/tests/test_compute_job_metadata_merge.sql`: Wave 0 |
| SC-3 true concurrency | two connections, row lock, both keys survive | pytest live probe (psycopg) | `pytest tests/test_<probe>_live.py` on the local-stack lane (skips locally, fails in CI if unset) | new |
| SC-3 gate bites | each arm reds on its own twin | mutation runner | `node scripts/mutation-runner/run.mjs --file ...` then one full run | annotations: Wave 0 |
| SC-4 | migration/RLS review; ACL; verify block | agents + CI | migration-reviewer and rls-policy-auditor clean; `sql-function-snapshot`, `migration-policy` green | at review |
| SC-5 | post-deploy PROD reading | read-only PROD query | the SC-5 SQL above | after deploy |

### Sampling Rate

- **Per task commit:** the touched file's quick run plus mypy for any Python edit.
- **Per wave merge:** the five pinning vitest files (census items 6-11), `node scripts/lint-sql-gates.mjs`, `node scripts/baseline-content-drift-check.mjs`, `npm run schema:functions:check`, the full pytest file set for `job_worker`/`long_fetch`.
- **Phase gate:** full vitest, full pytest (coverage gate), one full mutation-runner run for the floors, mypy, `npm run lint`, then `/gsd-verify-work`.

### Wave 0 Gaps

- [ ] `npm ci` in the worktree (vitest, tsx, lint).
- [ ] `supabase/tests/test_compute_job_metadata_merge.sql` (SC-3 gate, annotations after the migration text is final).
- [ ] the psycopg live-probe pytest (SC-3 concurrency).
- [ ] pytest for the Python-to-SQL marker-set, marker-key and outcome-vocabulary pins; static migration privilege test.
- [ ] SC-1 counts file saved outside tracked text with no secrets or ids.
- [ ] Capture the red-state measurements for each census pin ("expected X to be Y") as the change lands.

## Security Domain

`security_enforcement` is absent from config, so it is treated as enabled.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---|---|---|
| V2 Authentication | no | no new auth surface |
| V3 Session Management | no | — |
| V4 Access Control | yes | SECURITY DEFINER + `REVOKE ALL ... FROM PUBLIC, anon, authenticated` + `GRANT EXECUTE ... TO service_role`; catalogue verify and a gate arm assert `has_function_privilege` per role |
| V5 Input Validation | yes | typed arguments (`uuid`, `text`); the marker set and the written keys are SQL literals; `correlation_id` is stored as a JSON string, never interpolated or executed |
| V6 Cryptography | no | none |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---|---|---|
| Mutable `search_path` on a SECURITY DEFINER function | Elevation | `SET search_path = public, pg_catalog` and schema-qualified objects |
| Default Supabase grants expose a new `public` function to anon/authenticated via PostgREST | Elevation | explicit REVOKE naming both roles; ACL arm; static migration test |
| A generic merge RPC lets a caller write `source` | Tampering | narrow functions with fixed keys; the retraction never writes `source` |
| Forged retraction to flip a user's job from "protected" to loud | Tampering | service_role only; the retraction direction is the LOUD direction by design (161.1 D13) |
| Marker write on a job that is not the caller's | Tampering | service-role-only; unfenced by parity (Open Question 4) |

## Sources

### Primary (HIGH confidence, read this session)
- Repo files: `analytics-service/services/job_worker.py` (:1145-1156, :3560-3715, :5230-5420, :12270-12320), `analytics-service/services/ingestion/long_fetch.py` (:1-205, :706-810), `src/lib/ledger-refresh-marker.ts`, `src/lib/ledger-refresh-marker.test.ts`, `src/app/api/keys/sync/route.ts`, `src/app/api/strategies/finalize-wizard/route.ts`, the three Python test files named above, `supabase/schema/functions/{claim_compute_jobs_with_priority,set_compute_job_progress}.sql`, `supabase/migrations/{20260712130000,20261019120000,20261105120000}_*.sql` and their `down/` files, `supabase/schema/baseline.sql` (compute_jobs DDL), `scripts/{baseline-content-drift-check.mjs,dump-sql-functions.ts,mutation-floors.mjs,prod-body-drift-check.sh}`, `.github/workflows/{ci.yml,sql-function-snapshot.yml,migration-policy.yml}`, `src/__tests__/{drift-check-scripts,gate-family-meta,mutation-annotation-parser,mutation-runner-floors,lint-sql-gates,audit-coverage}.test.ts`, `src/__tests__/contracts/ci-anti-skip-gate.contract.test.ts`, `scripts/mutation-runner/GRAMMAR.md`, `scripts/pg-lane/README.md`, `supabase/tests/{test_api_key_nav_marks,test_set_compute_job_progress}.sql`, commit `bc913db76` (NAVMTM) for the census file set.
- [PostgreSQL: Transaction Isolation, Read Committed](https://www.postgresql.org/docs/current/transaction-iso.html) and [JSON Functions and Operators](https://www.postgresql.org/docs/current/functions-json.html), fetched this session.
- A pytest run on this tree: `160 passed` for `tests/test_ledger_refresh_reuse_collision.py` and `tests/test_derive_broker_dailies_dualmode.py`.
- A scratch-copy run of `scripts/baseline-content-drift-check.mjs` (outside the repo) showing SNAPSHOT_MISSING fails for an added snapshot file.

### Secondary / Tertiary
- None. No web search was needed; no external library is involved.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH, nothing new.
- Writers' contracts and pinning tests: HIGH, read line by line.
- House migration pattern: HIGH for function/ACL/verify/rollback; MEDIUM for the exact CI reaction to a function-adding PR (precedent-derived).
- Census list: MEDIUM-HIGH, complete per the NAVMTM precedent and current values grepped, but exact numbers must be re-measured by running the pinning tests.
- Pitfalls: HIGH.

**Research date:** 2026-11-04
**Valid until:** 2026-11-11 (the census values and floors move with every merge to main; re-measure at plan time)
