# Phase 143: JOB — Dropped-enqueue reconciliation sweep - Pattern Map

**Mapped:** 2026-08-16
**Files analyzed:** 5 (2 new SQL, 1 new TS test, 2 modified Python)
**Analogs found:** 5 / 5 (one PARTIAL — see `## No Analog Found`)

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `supabase/migrations/<ts>_reconcile_dropped_enqueue_sweep.sql` (NEW) | migration / pg_cron janitor | batch (scheduled detect + write) | `supabase/migrations/20260802120000_strategy_analytics_stuck_computing_reaper.sql` + `20260803130000_reaper_limit_bound_materialized_cte.sql` | exact (structure) / **partial (the INSERT arm — see No Analog Found**) |
| `supabase/tests/test_reconcile_dropped_enqueue_sweep.sql` (NEW) | test (SQL gate) | batch | `supabase/tests/test_strategy_analytics_stuck_computing_reaper.sql` | exact |
| `src/__tests__/reconcile-dropped-enqueue-sweep.test.ts` (NEW) | test (migration-content) | file-I/O | `src/__tests__/compute-jobs-kind-check-csv-2026-05-25.test.ts` | exact |
| `analytics-service/main_worker.py` `main()` (MODIFY) | process bootstrap | event-driven | `analytics-service/main.py:60-69` (`init_sentry()` at module bootstrap) | role-match (sibling process) |
| `analytics-service/main_worker.py` `dispatch_tick()` (MODIFY) | worker claim loop | event-driven | `analytics-service/main.py:175-203` `_capture_secret_misconfig` (tag-then-capture inside `new_scope()`) | role-match |
| `analytics-service/tests/test_main_worker.py` (MODIFY) | test | event-driven | same file: `TestDispatchTick` (`:39-110`) + `TestReaperThresholdDriftGate` (`:2194-2300`); `tests/test_secret_misconfig_signal.py:85-110` for the Sentry spy | exact |

---

## Pattern Assignments

### `supabase/migrations/<ts>_reconcile_dropped_enqueue_sweep.sql`

**Analog:** `supabase/migrations/20260802120000_strategy_analytics_stuck_computing_reaper.sql` (690 lines)

#### ⭐ Header section structure — copy this ORDER verbatim as the template

Read from `20260802120000:1-207`. Every migration line below is a `-- ` comment. The section titles and
their underline style are the convention; reproduce them for this phase's content:

```
-- Migration: <one-line what> (<REQ IDs>, Phase <n>, <milestone>, <date>)
-- =============================================================================
--
-- Why this migration exists            <- :5-30   (the after() hole; why no in-request guard sees it)
-- -------------------------
--
-- WHERE THE VALUE LANDS (do not overclaim).   <- :23-30  (inline ALL-CAPS lead-in, not underlined)
--
-- CADENCE HONESTY.                     <- :32-36  (inline ALL-CAPS lead-in)
--
-- Threshold rationale                  <- :38-61  (the 1h derivation; explicit rejection of 16h and 4h)
-- -------------------
--
-- SAFETY vs DEBOUNCE.                  <- :63-68  (name WHICH conjunct carries safety)
--
-- CLOCK SKEW.                          <- :70-74
--
-- Backfill anchor / <Grace anchor>     <- :76-101 (the Phase-106 argument: name each rejected column
-- ---------------                                 and say HOW it is wrong, not that it is)
--
-- CENSUS AT AUTHORING TIME (read-only, <date>, via PostgREST):   <- :92-101
--
-- Scope discipline                     <- :109-123
-- ----------------
--
-- Idempotency                          <- :125-131
-- -----------
--
-- Convention deviation (pre-documented so review does not re-litigate)  <- :133-149
-- -------------------------------------------------------------------
--
-- Operator observability               <- :151-168
-- ----------------------
--
-- PROD-AUTO-APPLY WARNING              <- :170-177
-- -----------------------
```

Two paragraph shapes worth copying literally:

`20260802120000:109-120` (scope discipline + "the parameter IS the attack surface"):
```
-- This migration adds ONE column, ONE partial index, ONE cron job, and re-bases
-- ONE existing function. It does NOT touch: compute_jobs DDL or RLS, the claim
-- RPC, ... It creates NO new callable SQL surface -- the reaper is an INLINE
-- cron body, not a function, so there is no SECURITY DEFINER surface, no EXECUTE
-- grant, and no caller-suppliable threshold parameter. That is deliberate: a
-- caller-supplied INTERVAL on a cross-tenant reaping SECDEF function is the
-- 20260516170100 incident class ... The parameter IS the attack surface.
```

`20260802120000:151-163` (operator observability — the inspection query goes in the header verbatim):
```
--   SELECT d.start_time, d.status, d.return_message
--     FROM cron.job_run_details d
--     JOIN cron.job j ON j.jobid = d.jobid
--    WHERE j.jobname = 'reap_strategy_analytics_stuck_computing'
--    ORDER BY d.start_time DESC
--    LIMIT 50;
```

`20260802120000:205-207` — the prose-hygiene rule to restate:
```
-- This paragraph deliberately does NOT spell the sequence out: prose must never
-- satisfy or trip a mechanical gate, and the shape greps that guard this file
-- scan the whole text, comments included.
```

#### Body framing (`20260802120000:209-210`, `:690`)
```sql
BEGIN;
SET lock_timeout = '5s';
...
COMMIT;
```

#### Fail-loud pg_cron check + idempotent re-register (`20260802120000:434-450`)
```sql
DO $$
DECLARE
  v_has_pg_cron BOOLEAN;
BEGIN
  SELECT EXISTS(SELECT 1 FROM pg_extension WHERE extname = 'pg_cron')
    INTO v_has_pg_cron;

  IF NOT v_has_pg_cron THEN
    RAISE EXCEPTION
      'JOB-02: pg_cron extension is NOT installed. The strategy_analytics stuck-computing reaper cannot be scheduled. Install pg_cron via Supabase Dashboard -> Database -> Extensions and re-run.'
      USING ERRCODE = 'feature_not_supported';
  END IF;

  -- Idempotent unschedule-then-schedule.
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'reap_strategy_analytics_stuck_computing') THEN
    PERFORM cron.unschedule('reap_strategy_analytics_stuck_computing');
  END IF;
```
⚠️ Note the ELSE arm in `20260717233529:288` (`RAISE NOTICE 'pg_cron extension not present — skipping schedule (local dev)'`) is the OLDER, silent-skip convention. **Do not copy it** — 142 chose fail-loud (Rule 12) and this phase must match 142.

Every `RAISE` format string is a **single literal** (no `||` inside the format slot) — `:443`, `:530`.

#### The `cron.schedule` call + inline body (`20260802120000:501-528`)
```sql
  PERFORM cron.schedule(
    'reap_strategy_analytics_stuck_computing',
    '*/15 * * * *',
    $cron$
    ...
    $cron$
  );

  RAISE NOTICE 'JOB-02: reap_strategy_analytics_stuck_computing scheduled (every 15 minutes, 16-hour staleness threshold, LIMIT 25 per tick).';
END $$;
```
The commentary block immediately ABOVE the `PERFORM cron.schedule` (`:452-500`) annotates the body
clause-by-clause ("The SET list is FOUR columns, and all four are load-bearing", "Predicate safety, in
order:", "Bounded run"). Reproduce that structure for this phase's predicate conjuncts.

#### The MATERIALIZED-CTE LIMIT fence (`20260803130000:132-155`) — the shape to reuse
```sql
    WITH batch AS MATERIALIZED (
      SELECT s.strategy_id
        FROM public.strategy_analytics s
       WHERE s.computation_status = 'computing'
         AND s.computing_started_at IS NOT NULL
         AND s.computing_started_at < now() - interval '16 hours'
         AND NOT EXISTS (
               SELECT 1
                 FROM public.compute_jobs cj
                WHERE cj.strategy_id = s.strategy_id
                  AND cj.status IN ('pending', 'running', 'done_pending_children', 'failed_retry')
             )
       ORDER BY s.computing_started_at ASC
       LIMIT 25
       FOR UPDATE SKIP LOCKED
    )
    UPDATE public.strategy_analytics sa
       SET ...
      FROM batch
     WHERE sa.strategy_id = batch.strategy_id
       AND sa.computation_status = 'computing';
```
Here the tail becomes `INSERT INTO public.compute_jobs (...) SELECT ... FROM batch ON CONFLICT DO NOTHING;`
(see `## No Analog Found` — that tail has no in-repo precedent).

#### Terminal self-verify block, positive AND negative anchors (`20260802120000:634-688`)
```sql
DO $$
DECLARE
  v_command  TEXT;
  v_schedule TEXT;
BEGIN
  SELECT command, schedule
    INTO v_command, v_schedule
    FROM cron.job WHERE jobname = 'reap_strategy_analytics_stuck_computing';

  IF v_command IS NULL THEN
    RAISE EXCEPTION 'JOB-02 verification failed: reap_strategy_analytics_stuck_computing cron job missing after schedule';
  END IF;

  -- STRING equality, never a ::INT cast on a schedule field.
  IF v_schedule IS DISTINCT FROM '*/15 * * * *' THEN
    RAISE EXCEPTION 'JOB-02 verification failed: reaper cron schedule is not the expected */15 * * * * cadence';
  END IF;

  -- Positive anchors on the DEPLOYED body.
  IF v_command NOT ILIKE '%public.strategy_analytics%' THEN
    RAISE EXCEPTION 'JOB-02 verification failed: reaper body is not schema-qualified to public.strategy_analytics';
  END IF;
  ...
  -- NEGATIVE anchors.
  IF v_command ILIKE '%computed_at%' THEN
    RAISE EXCEPTION 'JOB-02 verification failed: reaper body references computed_at, which the status bridge re-stamps on every job transition — the row would never be reaped (the Phase 106 janitor bug)';
  END IF;

  RAISE NOTICE 'JOB-02/JOB-03: ... self-verify passed (...).';
END $$;
```
Each failure message NAMES THE CONSEQUENCE, not just the missing token. Copy that register.

Plus the single-job assertion and the MATERIALIZED counter from `20260803130000:172-190`:
```sql
  SELECT count(*) INTO v_count
    FROM cron.job WHERE jobname = 'reap_strategy_analytics_stuck_computing';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'D-19 verification failed: expected exactly ONE cron job named ..., found %.', v_count;
  END IF;

  v_mat := (length(v_command) - length(replace(upper(v_command), 'AS MATERIALIZED', ''))) / length('AS MATERIALIZED');
  IF v_mat <> 2 THEN
    RAISE EXCEPTION 'D-19 verification failed: the deployed body carries % MATERIALIZED batch CTEs, expected 2 ...', v_mat;
  END IF;

  IF v_command ~* 'IN\s*\(\s*SELECT[^)]*LIMIT' THEN
    RAISE EXCEPTION 'D-19 verification failed: the deployed body still binds a bounded batch through an IN (SELECT ... LIMIT ...) subquery. That is the exact un-hashable-subplan shape this migration removes.';
  END IF;
```
(For this phase `v_mat` must be **1**, one arm.)

---

### `supabase/tests/test_reconcile_dropped_enqueue_sweep.sql`

**Analog:** `supabase/tests/test_strategy_analytics_stuck_computing_reaper.sql` (925 lines)

#### Per-part transaction framing (never a whole-file `BEGIN`) — `:308-309`, `:451`
```sql
BEGIN;
SET LOCAL lock_timeout = '5s';
DO $$
...
END
$$;
ROLLBACK;
```

#### pg_cron availability gate + oracle fetch (`:325-334`)
```sql
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE NOTICE 'SKIP Part 2: pg_cron not installed here; the deployed-body oracle is unavailable (local dev only).';
    RETURN;
  END IF;

  SELECT command INTO v_command
    FROM cron.job WHERE jobname = 'reap_strategy_analytics_stuck_computing';
  IF v_command IS NULL THEN
    RAISE EXCEPTION 'TEST FAILED (2): reap_strategy_analytics_stuck_computing cron job is missing while pg_cron is installed.';
  END IF;
```

#### FK seed chain (`:336-351`) — reusable verbatim
```sql
  -- FK chain: strategy_analytics.strategy_id -> strategies.id -> profiles.id -> auth.users.id
  INSERT INTO auth.users (id, email)
    VALUES (v_user, 'sa-reaper-arms-' || v_user || '@invalid.local');
  INSERT INTO public.profiles (id, display_name)
    VALUES (v_user, 'sa-reaper-arms') ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.strategies (user_id, name)
    VALUES (v_user, 'sa-reaper-arm-a') RETURNING id INTO v_a;
  ...
  v_seeded := ARRAY[v_a, v_b, v_c, v_d];
```
and a `compute_jobs` seed (`:373-375`):
```sql
  INSERT INTO public.compute_jobs
    (kind, strategy_id, status, priority, attempts, next_attempt_at, claim_token, claimed_at)
  VALUES ('compute_analytics_from_csv', v_c, 'running', 'normal', 1, now(), gen_random_uuid(), now());
```

#### ⭐ How elapsed time is crossed WITHOUT sleeping — backdate the seed (`:323`, `:359-366`)
```sql
  v_fresh    TIMESTAMPTZ := now();
...
  -- arm A: stranded A CENTURY (isolation by construction ...)
  INSERT INTO public.strategy_analytics
    (strategy_id, computation_status, computation_warned, computing_started_at, computed_at)
  VALUES (v_a, 'computing', TRUE, v_fresh - interval '100 years', v_fresh);

  -- arm B: stamp FRESH (the in-grace control)
  VALUES (v_b, 'computing', FALSE, v_fresh, v_fresh - interval '100 days');
```
Three rules that travel with this idiom:
- The century-old epoch is **isolation by construction**: it guarantees the seed wins the deployed
  `ORDER BY <anchor> ASC LIMIT n` budget on the shared TEST project (`:355-358`, `:498-502`). It replaced
  cross-tenant neutralizing `UPDATE`s, which were DELETED in 142.1/D-18. Do not reintroduce them.
- The anchor column must therefore be **directly writable by the test's INSERT**
  (`csv_daily_returns.created_at` is `NOT NULL DEFAULT now()` and is writable — the gate can seed it).
- Frozen clock: inside one part `now()` is CONSTANT, so never assert by comparing two `now()`-derived
  values; seed a **sentinel** instead (`:114-123`, `:573-579`).

#### Running the REAL deployed body as oracle (`:396-399`)
```sql
  -- ----- THE ORACLE: run the REAL deployed body -------------------------
  EXECUTE v_command;
```
Never re-type the predicate in the test.

#### Identity-scoped LIMIT-bound part (`:454-554`) — the shape for SC#2
Seed `LIMIT + 1` staggered candidates, name `v_youngest := v_seeded[1]`, then:
```sql
  FOR i IN 1..26 LOOP
    INSERT INTO public.strategies (user_id, name)
      VALUES (v_user, 'sa-reaper-limit-' || i::text) RETURNING id INTO v_strat;
    v_seeded := array_append(v_seeded, v_strat);
    ... VALUES (v_strat, 'computing', FALSE,
            v_fresh - interval '100 years' - (i * interval '1 minute'), v_fresh);
  END LOOP;

  EXECUTE v_command;                                   -- tick 1: BOUNDED
  SELECT count(*) INTO v_cnt FROM ... WHERE strategy_id = ANY (v_seeded)
     AND strategy_id <> v_youngest AND computation_status = 'failed';
  IF v_cnt <> 25 THEN RAISE EXCEPTION 'TEST FAILED (3/arm E/JOB-02): ...', v_cnt; END IF;
  -- v_youngest must still be untouched
  EXECUTE v_command;                                   -- tick 2: PROGRESSING
  -- v_youngest is now healed, all 26 terminal
```
Assertions are **identity-scoped** (`= ANY (v_seeded)`), never global counts (`:453-467`, P-5).

#### Failure-message register (`:407`, `:410`, `:527`)
Each message states requirement id, arm, and the user/business consequence:
> `'TEST FAILED (2/arm A/SI-02): the reap did not clear computation_warned (got %). The status bridge will launder this failure into complete_with_warnings on its next call -- a FALSE SUCCESS on a money surface.'`

For this phase the terminal-analytics arm's message must name the **mass-re-enqueue incident**.

Note: pgTAP is NOT installed — assertions are plain `RAISE EXCEPTION`; a clean run prints NOTICEs only.

---

### `src/__tests__/reconcile-dropped-enqueue-sweep.test.ts`

**Analog:** `src/__tests__/compute-jobs-kind-check-csv-2026-05-25.test.ts` (137 lines)

**Imports + path constants** (`:1-3`, `:32-36`):
```ts
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";

const REPO_ROOT = join(__dirname, "..", "..");
const MIGRATIONS_DIR = join(REPO_ROOT, "supabase", "migrations");
const FIX_FILENAME = "20260525074649_compute_jobs_kind_check_extend_csv.sql";
const FIX_PATH = join(MIGRATIONS_DIR, FIX_FILENAME);
```

**Header comment convention** (`:5-30`): incident/root-cause narrative, then a numbered list of exactly
what the test asserts, then the line `// Pure text-based — no live DB required.`

**Oracle independence — literals declared LOCALLY, never imported** (`:38-54`):
```ts
// Kinds admitted by compute_jobs_kind_check in prod BEFORE this fix,
// as captured via pg_get_constraintdef during the 2026-05-25 investigation.
const PRIOR_KINDS = ["sync_trades", "compute_analytics", ...];
```

**Scoped-body assertion (prose must not satisfy the gate)** (`:77-94`):
```ts
    // Locate the ADD CONSTRAINT body so the assertion can't accidentally
    // match a commented-out kind elsewhere in the file.
    const addMatch = sql.match(/ADD\s+CONSTRAINT\s+compute_jobs_kind_check\s+CHECK[\s\S]*?;/i);
    expect(addMatch, "ADD CONSTRAINT ... body not found").not.toBeNull();
    const body = addMatch![0];
```
For this phase the scoping regex is `/\$cron\$([\s\S]*?)\$cron\$/` with the same anti-vacuity
`expect(match).not.toBeNull()` guard.

**Forward-drift sweep over LATER migrations** (`:104-136`) — the pattern that keeps the gate honest when a
follow-up migration re-registers the cron:
```ts
    const FIX_TS = "20260525074649";
    const files = readdirSync(MIGRATIONS_DIR)
      .filter((f) => /^\d{14}_.*\.sql$/.test(f))
      .filter((f) => f.split("_")[0] > FIX_TS)
      .sort();
    for (const f of files) { ... }
```

**Self-verify-block assertion** (`:96-102`):
```ts
    expect(sql).toMatch(/DO\s+\$\$/);
    expect(sql).toMatch(/RAISE\s+EXCEPTION/i);
```

---

### `analytics-service/main_worker.py` — `main()` (Sentry bootstrap)

**⚠️ No analog inside `main_worker.py`** — RESEARCH.md L-1 confirms the file has zero Sentry references.
The analog is the **sibling process** `analytics-service/main.py`.

**Analog (bootstrap):** `analytics-service/main.py:60-69`
```python
# Phase 16 / OBSERV-04 + OBSERV-05 — initialize sentry-sdk[fastapi] AFTER
# configure_logging() (so structlog is wired before any sentry import side
# effects) and BEFORE app = FastAPI() ...
from sentry_init import init_sentry

init_sentry()
```

**Analog (module-level import discipline):** `analytics-service/main.py:16-20` — load-bearing for testability
```python
# PYAPI-06 — imported as a MODULE (not `from sentry_sdk import capture_message`)
# so the operator-signal captures below resolve through `main.sentry_sdk` and can
# be spied on in tests. Importing the module has no side effects; `init_sentry()`
# further down is what configures it.
import sentry_sdk
```

**Insertion point in `main_worker.main()`** (`main_worker.py:961-972`) — after `logging.basicConfig(...)`,
before `validate_kek_on_startup()`:
```python
async def main() -> None:
    """Entry point. Validates KEK, sets signal handlers, runs all loops."""
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(name)s %(levelname)s %(message)s",
    )

    logger.info("Worker starting as %s", WORKER_ID)

    # Fail fast if KEK is bad — worker cannot process any jobs without it
    validate_kek_on_startup()
```

---

### `analytics-service/main_worker.py` — `dispatch_tick()` (the capture)

**Analog (capture idiom):** `analytics-service/main.py:195-203`
```python
    try:
        with sentry_sdk.new_scope() as scope:
            scope.set_tag("config_fault", fault)
            scope.set_tag("config_secret", secret_name)
            sentry_sdk.capture_message(
                f"Platform secret {secret_name} is {fault}", level="error"
            )
    except Exception:
        pass
```
Note the two conventions carried in its docstring (`:186-188`): *"Follows `services/audit.py:441`'s
tag-then-capture shape, with the `new_scope()` isolation ... so the tags do not leak onto unrelated
events. The whole emit is wrapped in try/except: a Sentry transport failure must never turn a config
warning into a 500."* The try/except wrap is load-bearing here too — a Sentry failure must not fail a job.

**Analog (tag/extra vocabulary):** `src/app/api/strategies/csv-finalize/route.ts:833-837`
```ts
captureToSentry(enqueueErr, {
  tags: { surface: "csv-finalize", step: "csv-analytics-enqueue" },
  extra: { strategy_id: strategyId, correlation_id: opts.correlationId },
});
```

**Insertion point** (`main_worker.py:606-626`) — inside `for job in jobs:`, after
`claim_token = job.get("claim_token")` (`:625`) and **before** the `try:` at `:626` that owns the
`_heartbeat` task's `try/finally`:
```python
    for job in jobs:
        main_worker_healthz.LAST_TICK_AT = time.time()
        ...
        claim_token = job.get("claim_token")
        try:
```
Comment register to match: every non-obvious line in this loop carries a `# <REQ-ID>:` comment naming the
incident it exists for (`# FLIPRETRY-04: ...` `:607`, `# audit-2026-05-07 P97 / G12.A.2 (mig 117): ...`
`:618`).

---

### `analytics-service/tests/test_main_worker.py`

**Analog A — `dispatch_tick` unit test with a mocked supabase** (`:39-99`):
```python
class TestDispatchTick:
    @pytest.mark.asyncio
    async def test_three_jobs_all_done(self) -> None:
        jobs = [
            {"id": f"job-{i}", "kind": "sync_trades", "strategy_id": f"s-{i}"}
            for i in range(3)
        ]
        mock_supabase = MagicMock()
        claim_chain = MagicMock()
        claim_chain.execute.return_value = MagicMock(data=jobs)
        mark_chain = MagicMock()
        mark_chain.execute.return_value = MagicMock(data=None)

        def _rpc_side_effect(name: str, params: dict):
            if name == "claim_compute_jobs_with_priority":
                return claim_chain
            return mark_chain

        mock_supabase.rpc.side_effect = _rpc_side_effect

        with patch("main_worker.get_supabase", return_value=mock_supabase), \
             patch("main_worker.dispatch",
                   new=AsyncMock(return_value=DispatchResult(outcome=DispatchOutcome.DONE))):
            await dispatch_tick("worker-test-2")
```
Seed the claimed job with `"metadata": {"source": "reconcile-sweep", "detected_at": ...}` to drive the
new assertion.

**Analog B — the Sentry spy** (`tests/test_secret_misconfig_signal.py:98-109`):
```python
@pytest.fixture
def sentry_spy(monkeypatch: pytest.MonkeyPatch) -> Iterator[_FakeSentry]:
    import main

    spy = _FakeSentry()
    monkeypatch.setattr(main, "sentry_sdk", spy)
```
with the fake's own discipline comment (`:88-90`): *"Anything the real SDK exposes that our code does not
call must NOT be silently invented — an AttributeError here is a genuine test failure."*
For this phase: `monkeypatch.setattr(main_worker, "sentry_sdk", spy)` — which is exactly why the module
must be imported as a module (see above).

**Analog C — asserting `main()` calls a specific function.** There is **no existing test that asserts
`main_worker.main()` calls anything** (grep for `await main(` in `analytics-service/tests/` returns
nothing). The nearest is `tests/test_encryption.py:121-138`, which tests
`validate_kek_on_startup()` in isolation with a docstring naming its call site
(`"""validate_kek_on_startup runs at every service boot (main.py:80)."""`) — i.e. the repo currently
documents the wiring in prose rather than pinning it. **That is exactly the gap RESEARCH.md L-1 says is
load-bearing here**: the capture test mocks the SDK and stays green with `init_sentry()` removed. The new
test must actually call `main_worker.main()` (with `asyncio.gather` / the loops patched) and assert
`init_sentry` was invoked. Write it from first principles and say so in the docstring.

**Analog D — the migration-content pytest gate** (`:2194-2243`), including the anti-vacuity guard:
```python
_REAPER_MIGRATION_NAME = "20260803130000_reaper_limit_bound_materialized_cte.sql"

def _reaper_migration_path() -> pathlib.Path:
    return (pathlib.Path(__file__).resolve().parents[2]
            / "supabase" / "migrations" / _REAPER_MIGRATION_NAME)

def _reaper_cron_body() -> str:
    src = _reaper_migration_path().read_text(encoding="utf-8")
    match = re.search(r"\$cron\$(.*?)\$cron\$", src, flags=re.DOTALL)
    assert match is not None, (...)
    body = match.group(1)
    # Anti-vacuity guard (PATTERNS S-5): if the extraction silently returns
    # nothing, every negative assertion below would pass by default.
    assert "UPDATE public.strategy_analytics" in body, (
        "extracted $cron$ body does not contain the reaping UPDATE — the "
        "extraction is broken, so the assertions below prove nothing. ...")
    return body
```
⚠️ RESEARCH.md's "Don't Hand-Roll" table says do **NOT** add a Python threshold constant for the 1-hour
grace — a mirrored constant with no production consumer is a *decorative* drift gate. So copy the
`_cron_body()` extraction idiom but not `TestReaperThresholdDriftGate`'s SQL↔Python equality assertion.

---

## Shared Patterns

### Neutering proof (the standing founder rule "a test that CANNOT FAIL is worse than none")

**Source of the recorded form:** `143-RESEARCH.md` `## Validation Architecture` → `### Neutering proof —
what to break for each assertion` (a table of `Gate | Neuter | Expected RED`), and in code as the
anti-vacuity assertion embedded in the extraction helper (`test_main_worker.py:2237-2243`, quoted above)
plus the in-file record of a retrofit that closed a vacuity
(`test_strategy_analytics_stuck_computing_reaper.sql:573-579`, "⚠️ RETROFITTED in Phase 142.1 (D-18 part
2) ... this part would have gone green over a value it never wrote").

**Apply to:** every new test in this phase. The recording convention is: (1) the `Gate | Neuter | Expected
RED` table lives in the phase SUMMARY, (2) each mechanically-fragile gate carries an inline anti-vacuity
assertion in the code, (3) the reason for any retrofit is written INTO the test file as a `⚠️` block naming
the phase/defect id.

### Anti-green-skip in the SQL gate

**Source:** `supabase/tests/test_strategy_analytics_stuck_computing_reaper.sql:45-60` — Part 1 is
DELIBERATELY UNGATED and MUST FAIL when the migration is unapplied (its TDD RED proof). Behavioural parts
that need the deployed cron body `RAISE NOTICE 'SKIP ...'` only on `pg_cron` absence (local dev), never on
the object under test being absent.
**Apply to:** the new `supabase/tests/test_*.sql`.

### Grep-gate hygiene: prose must neither satisfy nor trip the gate

**Source:** `test_main_worker.py:2219-2224` and `20260802120000:205-207`.
**Apply to:** the TS gate, the pytest gate, and the migration header (which MUST discuss rejected anchor
columns in prose while a gate greps for their absence in the `$cron$` body).

### CI-visibility constraint

**Source:** `.github/workflows/ci.yml:833` (`sql-tests`), `:882-885` (`concurrency: shared-test-db`),
`:951-1000` (preflight rejecting `\!`, `\copy`, `\COPY`, `\o`).
**Apply to:** the SQL gate — add it to the EXISTING `sql-tests` job by filename discovery
(`supabase/tests/test_*.sql`). ⛔ Do not add a new CI job with its own concurrency group (`ci.yml:895-901`).
⛔ Do not add this cron to `supabase/tests/test_retention_crons_safe.sql` — that file's loop asserts every
listed body matches `%where%created_at%`.

---

## No Analog Found

| File / element | Role | Data Flow | Reason |
|---|---|---|---|
| The `INSERT INTO public.compute_jobs ... ON CONFLICT DO NOTHING` tail of the cron body | migration (cron write arm) | batch | **No pg_cron body in this repo INSERTs into `compute_jobs` directly.** Measured this session: (a) `retention_compute_jobs_done` / `_failed` / `_orphaned_running` are `DELETE`s (`20260515113853:192-200`, `20260515210200:250-259`, `20260719120000:98-104`); (b) the only `INSERT`s appearing inside `$cron$` bodies anywhere target `audit_log_cold` (`20260417110539:217`, `20260515113853:155`, `20260515210200:182`) and `notification_dispatches` (`20260417110539:337`); (c) the fan-out crons write `compute_jobs` **indirectly** through a SECDEF function calling `enqueue_compute_job` in a per-row loop (`20260717233529:243-251`, mirroring `20260420213754:314-361`). |

**Closest partial analog, and why it must NOT be copied wholesale** — `20260717233529:234-252`:
```sql
    FOR v_key IN SELECT ak.id AS api_key_id FROM api_keys ak WHERE ... LOOP
      BEGIN
        PERFORM enqueue_compute_job(
          p_strategy_id     := NULL,
          p_kind            := 'derive_broker_dailies',
          p_idempotency_key := 'derive-dailies-' || v_key.api_key_id::text || '-' || v_today,
          p_api_key_id      := v_key.api_key_id
        );
      EXCEPTION WHEN unique_violation THEN
        NULL; -- already in-flight for this key (per (api_key_id, kind) index); benign
      END;
    END LOOP;
```
Three reasons this is the wrong template for Phase 143, all pinned by RESEARCH.md §2:
1. It calls `enqueue_compute_job`, whose race-loss arm `RAISE`s `serialization_failure`
   (`20260716090000:162-171`) / `NO_DATA_FOUND` — **neither of which its `WHEN unique_violation` handler
   catches**, so that error aborts the whole tick, loses the healed count and skips the rest of the batch.
2. It is a row-at-a-time `FOR` loop with no `LIMIT` — incompatible with the D-19 MATERIALIZED-CTE bound
   CONTEXT.md locks in.
3. It routes through a `SECURITY DEFINER` function, which CONTEXT.md explicitly forbids ("no new callable
   SQL surface — the sweep is an INLINE cron body").

**Consequence for the planner:** the INSERT arm is written from first principles and deserves extra review
weight — exactly the disclosure 142 made for its own bounded UPDATE (`20260802120000:485-487`: *"Bounded
run (no in-repo precedent for a bounded reaping UPDATE ... so this shape is written from first principles
and deserves extra review weight)"*). Reproduce that disclosure verbatim in style for the INSERT arm, and
note that the only proof the cron ROLE can write `compute_jobs` under `FORCE ROW LEVEL SECURITY` is a real
TEST tick inspected in `cron.job_run_details` (RESEARCH.md L-2 / A2) — the `sql-tests` gate runs as the
psql user, not the cron role.

Secondary gap: **no existing pytest asserts `main_worker.main()` calls anything** (Analog C above).

---

## Metadata

**Analog search scope:** `supabase/migrations/**`, `supabase/tests/**`, `src/__tests__/**`,
`analytics-service/{main.py, main_worker.py, sentry_init.py, tests/**}`
**Files read this session:** 11 (targeted, non-overlapping ranges)
**Pattern extraction date:** 2026-08-16
