# Phase 222: ALERTTRUTH - Pattern Map

**Mapped:** 2026-11-25
**Files analyzed:** 19 new/modified (plus 4 optional fixture/comment refreshes)
**Analogs found:** 17 / 19 (2 partial: ERRC-03 live module has no precedent that runs a real handler against the lane; snapshot-wide arm pin composes two precedents)

Cite by symbol where line numbers drift. Line numbers were read at HEAD of `gsd/phase-222-alerttruth` on 2026-11-25. Every analog path is a tracked `supabase/`, `src/`, `scripts/` or `analytics-service/` source file; none is a `.gsd/capabilities` mirror.

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match |
|---|---|---|---|---|
| `supabase/migrations/2026112X..._computation_error_copy_contact_form.sql` (NEW) | migration (pure-function re-base) | transform | `20260826120000_computation_error_curated_copy.sql` (body) + `20261120120000_auth_user_has_password.sql` (newest frame, verify, ACL) | exact / role |
| `supabase/migrations/down/2026112X...-rollback.sql` (NEW, convention) | rollback | n/a | `supabase/migrations/down/20261120120000-rollback.sql` | exact |
| `supabase/schema/functions/computation_error_copy.sql` | generated snapshot | n/a | itself, `npm run schema:functions` | exact |
| `supabase/tests/test_sync_status_curated_sentence_survives.sql` | SQL gate | request-response | itself | exact |
| `supabase/tests/test_sync_status_marked_refresh_protected.sql` | SQL gate | request-response | itself | exact |
| `src/app/api/strategies/csv-finalize/route.test.ts` | vitest | file-I/O | git `026e1d761^` old parser + `src/lib/closed-sets.cohort-gate-parity.test.ts` | exact / role |
| `src/lib/wizardErrors.ts`, `src/lib/wizardErrors.test.ts` | utility + test | transform | self | exact |
| `analytics-service/services/exchange.py` | service | request-response | self | exact |
| `analytics-service/services/csv_validator.py` | service | transform | self | exact |
| `analytics-service/services/job_worker.py` | worker handler | event-driven | self + `_published_numbers_exist` in `run_derive_broker_dailies_job` | exact |
| `analytics-service/routers/portfolio.py` | router | request-response | self | exact |
| `analytics-service/tests/test_no_contact_support_copy.py` (NEW) | static AST scan | file-I/O | `tests/test_legacy_table_not_named.py` | exact |
| `analytics-service/tests/test_portfolio_benchmark_pairing.py` | test | request-response | self + `tests/test_benchmark.py` | exact |
| `analytics-service/tests/test_job_worker.py` | test | event-driven | self (two enqueue-failure cases) | exact |
| `analytics-service/tests/test_sync_trades_enqueue_failure_bridge_live.py` (NEW) | live-lane test | CRUD + RPC | `tests/test_computed_at_now_literal_live.py` + `tests/test_compute_jobs_fencing.py` helpers | partial |
| `analytics-service/tests/test_computation_error_provenance_census.py` | static census | comment-only | self | exact |
| `src/lib/portfolio-analytics-adapter.test.ts` | vitest | transform | self (~line 183) | exact |
| `SyncPreviewStep.composite.render.test.tsx`, `SyncPreviewStep.render.test.tsx` (optional) | vitest fixtures | transform | self | exact |

---

## Pattern Assignments

### 1. New migration (pure-function re-base)

**Latest filename for ordering:** `supabase/migrations/20261124120700_sanitize_user_attempt_failures.sql` (latest in the tree and on `origin/main` after `git fetch` this session). Pick a 14-digit stamp strictly after 225 PR-3's migration; re-pick from origin/main before the single CI run (`migration-policy.yml` refuses a stamp older than the PROD tip).

**Body analog: `20260826120000_computation_error_curated_copy.sql`**, the ONLY migration defining `computation_error_copy` (no later redefinition). Copy the function (lines ~263-320), change only the four sentences, keep `CANARY_162_F3_PROSE_ONLY` as a comment INSIDE the body (parity Part 2 requires it in the raw definition and absent after the `--[^\n]*` strip):
```sql
CREATE OR REPLACE FUNCTION computation_error_copy(p_error_kind TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog
AS $copy$
  -- CANARY_162_F3_PROSE_ONLY ...
  SELECT CASE p_error_kind
    WHEN 'permanent' THEN '<new permanent>'
    WHEN 'transient' THEN '<new transient>'
    WHEN 'unknown'   THEN '<new transient>'
    WHEN 'orphaned'  THEN 'Analytics stopped before it finished because the process running it went away. Nothing is wrong with this strategy — retry the sync.'
    ELSE '<new ELSE>'
  END
$copy$;
```
Leave `orphaned` byte-identical (parity Part 3 asserts `ILIKE '%retry the sync%'`, and `permanent ILIKE '%will not resolve%'`, which the new permanent text keeps).

**Frame analog (newest house style): `20261120120000_auth_user_has_password.sql`.**
- Header: what/why, "Reaches TEST and then PROD only through Supabase Migrate on merge", re-base statement, rollback pointer (lines 1-41).
- **Transaction style: NO `BEGIN;`/`COMMIT;`** (comment at line 35: "migration-reviewer invariant 14; Supabase wraps each migration"), `SET LOCAL lock_timeout = '3s';` (line 43). RESEARCH proposes `BEGIN; SET lock_timeout='5s';`, which is the legacy shape of 20260826120000; of the 202611* migrations only `20261124120500_poll_positions_cohort.sql` still has BEGIN/COMMIT. Follow the newest (Rule 7) and flag the divergence to migration-reviewer.
- ACL + COMMENT (lines 68-72) and the existing symmetric pair from 20260826120000 lines 333-334:
```sql
REVOKE ALL ON FUNCTION computation_error_copy(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION computation_error_copy(TEXT) TO service_role;
```
(`CREATE OR REPLACE` preserves ACLs and COMMENT; re-asserting is house style. Re-base the COMMENT text at 20260826120000 line 322.)

**Self-verify, catalogue/function-only.** Shape analogs: `20261120120000...sql` lines 80-88 and `20261124120700_sanitize_user_attempt_failures.sql` lines 280-314 (`DO $verify$ ... RAISE EXCEPTION '<one literal>' ... RAISE NOTICE ... END $verify$;`). Arm-check idiom from 20260826120000 (~lines 1306-1387):
```sql
DO $verify$
BEGIN
  IF to_regprocedure('public.computation_error_copy(text)') IS NULL THEN
    RAISE EXCEPTION 'Migration 2026112X: public.computation_error_copy(text) is missing';
  END IF;
  IF computation_error_copy('permanent') IS DISTINCT FROM '<literal>' THEN
    RAISE EXCEPTION 'Migration 2026112X: the permanent arm is not the contact-form sentence';
  END IF;
  -- same for transient, unknown, NULL (ELSE); none ILIKE '%contact support%'; orphaned unchanged;
  -- NOT has_function_privilege('anon'|'authenticated', 'public.computation_error_copy(text)', 'EXECUTE');
  -- has_function_privilege('service_role', ..., 'EXECUTE')
  RAISE NOTICE 'Migration 2026112X: computation_error_copy verified.';
END
$verify$;
```
Constraints measured from the analogs and linters:
- No application-table read in the DO block (`scripts/lint-migration-data-dependence.mjs`: refuses read-of-app-relation plus raise-on-it, no opt-out marker). Calling the IMMUTABLE function, `pg_proc`, `has_function_privilege` are all fine.
- Every `RAISE EXCEPTION` format slot is ONE string literal or dollar-quoted, never `'a' || 'b'` (`src/__tests__/raise-exception-concat-grammar.test.ts` walks all migrations). Doubled `''` apostrophes are fine (20261124120700 line 294).
- Do not write the phrase "contact support" in comments immediately above `CREATE OR REPLACE` or inside the body: the generated snapshot copies those comments (see snapshot header, it reproduces the preceding comment block). Say "the legacy support pointer". The phrase inside the verify block's `ILIKE` pattern is fine (the snapshot does not copy DO blocks).
- Keep the ELSE sentence free of apostrophes and the comment word "else" lowercase or not followed by newline+quote: the csv-finalize oracle regex is `/\bELSE\s*\n\s*'([^']+)'/`.

**Rollback analog:** `supabase/migrations/down/20261120120000-rollback.sql` lines 1-30 (manual, `psql --single-transaction -v ON_ERROR_STOP=1 -f`, marker query FIRST, "what this file undoes", ledger-row-left-in-place warning). For a re-base the body is `CREATE OR REPLACE` with the 20260826120000 text. 79 of 415 migrations carry one; `migration-policy.yml` excludes `down/**` from its added-files scan, so it is a convention not a gate.

### 2. Snapshot `supabase/schema/functions/computation_error_copy.sql`

Generated (`@generated by scripts/dump-sql-functions.ts - DO NOT EDIT BY HAND`, `-- source migration: 20260826120000_...` line changes to the new file). Regenerate with `npm run schema:functions`; `npm run schema:functions:check` is the CI gate. Do not hand-edit `supabase/schema/baseline.sql` or `baseline-carried-migrations.txt` (automated post-apply re-dump; `scripts/baseline-content-drift-check.mjs` reports DRIFT until then, a stale-baseline red counts as green).

### 3. SQL gates (RED-UNDER-SETUP lists and literals)

Each gate carries one single-line JSON comment `-- RED-UNDER-SETUP: {"apply":[...]}` listing repo-relative paths replayed IN ORDER by the pg-lane mutation runner. The `sql-tests` lane replays new migrations automatically; the mutation lane replays ONLY this list.
- `test_sync_status_curated_sentence_survives.sql` line 234: list ends `...20260826120000_computation_error_curated_copy.sql, 20260906120000_computation_error_provenance.sql, 20261003120000_sync_status_bridge_residues.sql`.
- `test_sync_status_marked_refresh_protected.sql` line 192: list ends `...20261003120000..., 20261009120000_sync_status_analytics_scope.sql, 20261023120000_sync_status_runner_stamps_computed_at.sql, 20261105120000_sync_status_protect_refused_derive.sql`.

Edit pattern: (1) append the new migration path to the END of each `apply` array (only the function changes; the bridge migrations do not redefine it); (2) move the literals: `curated_sentence_survives` `c_perm TEXT := '...Contact support if you need this strategy computed.'` at line 266 (compared at lines 388, 448, 579); `marked_refresh_protected` `c_perm` at line 244, two inline `IF v_error IS DISTINCT FROM '...'` literals at lines 461 and 682, `c_perm` uses at 996 and 1283. House rule (comment at line 229): spell the sentence LITERALLY, never via `computation_error_copy(...)`. (3) Rewrite stale prose: `curated_sentence_survives` says "Copied from 20260826120000_computation_error_curated_copy.sql:285" and "The apply list is byte-identical to test_sync_status_marked_refresh_protected.sql:156 ... end at 20261003120000" (already untrue; do not leave it). (4) `RED-UNDER-M` twins: measured no change (all 16 twins in `curated_sentence_survives` edit `20261003120000_sync_status_bridge_residues.sql`; the two arm-`0a` twins in `marked_refresh_protected`, line 299, edit only header/closing COMMENT text of `20260826120000_...`). Re-run `node scripts/mutation-runner/run.mjs --file supabase/tests/<gate>` for both and read the `biting` line.

Do NOT touch `supabase/tests/test_compute_jobs_error_kind_copy_parity.sql` nor add the new migration to its setup: its RED-UNDER-M arms 2/A-3 and 3/F-3 mutate the OLD migration file and a later `CREATE OR REPLACE` would overwrite the mutation, so the annotation stops biting. 22 gate files list `20260826120000_...`; only the two above pin the text (grep of `supabase/tests` for the phrase also hits `test_first_hop_enqueue_sweep.sql`, a different function, see Out of scope).

### 4. `src/app/api/strategies/csv-finalize/route.test.ts` (oracle read from the snapshot)

Current (to replace), lines ~706-738: an "ORACLE RE-CUT 2026-11-14" comment block and
```ts
const CURATED_DEFAULT_COPY: string =
  "Analytics could not complete for this strategy. Retry the sync, or use the contact form if this persists.";
```
The route's const `ENQUEUE_LOST_RACE_USER_COPY` (`route.ts` ~2025, not exported) already equals the target ELSE text. Keep the anti-vacuity case (~lines 829-833: `length > 40`, `toContain("Retry the sync")`, `not.toMatch(/automatic/i)`) and `expect(copy).toBe(CURATED_DEFAULT_COPY)` (~893). The file imports only vitest (line 20); add `readFileSync` from `node:fs` and `resolve` from `node:path`.

**Parser to restore (git `026e1d761^:src/app/api/strategies/csv-finalize/route.test.ts`, lines ~700-725):**
```ts
const CURATED_DEFAULT_COPY: string = (() => {
  const path = resolve(process.cwd(), "supabase/schema/functions/computation_error_copy.sql");
  const sql = readFileSync(path, "utf8");
  const arm = sql.match(/\bELSE\s*\n\s*'([^']+)'/);
  if (!arm) {
    throw new Error(`WR-07 oracle: could not parse the ELSE arm out of ${path}. If the dump format changed, re-point this parse - do NOT delete it, ...`);
  }
  return arm[1];
})();
```
Module scope so a parse failure fails the whole file loudly instead of yielding `""`.

**Live precedent for reading a function snapshot in vitest:** `src/lib/closed-sets.cohort-gate-parity.test.ts` lines 1-45 (`readFileSync(join(process.cwd(), "supabase/schema/functions/get_verified_cohort_rank.sql"), "utf8")`, `matchAll` regex, a non-vacuity case `expect(inLists).toHaveLength(2)`). Same shape for the recommended snapshot-wide pin (parse every `THEN\s*\n\s*'([^']+)'` arm plus ELSE, assert 5 arms found, none matches `/contact support/i`, each non-orphaned arm contains `contact form`). Also `src/__tests__/readmit-exhaustion-predicate-parity.test.ts` (collapse whitespace, error messages name WHICH side failed to parse) and `src/lib/account-share-note.test.ts` ~lines 202-215.

Rewrite the stale prose in the same file: the "ORACLE RE-CUT" paragraph, the doc comment above the const, and the `[164.9.x]` RED-DEMO notes at the end of the describe that mention the legacy pointer.

### 5. `analytics-service/services/job_worker.py` - `run_sync_trades_job` enqueue-failure tail (ERRC-03)

**Publish-state read analog: `_published_numbers_exist` in `run_derive_broker_dailies_job` (~lines 5479-5496)**; frozenset at lines 1097-1099:
```python
STRATEGY_ANALYTICS_TERMINAL_SUCCESS_STATUSES: Final[frozenset[str]] = frozenset(
    {"complete", "complete_with_warnings"}
)
```
```python
def _published_numbers_exist() -> bool:
    res = (
        ctx.supabase.table("strategy_analytics")
        .select("computation_status, metrics_json")
        .eq("strategy_id", strategy_id)
        .maybe_single()
        .execute()
    )
    row = getattr(res, "data", None) or {}
    return isinstance(row, dict) and (
        row.get("computation_status") in STRATEGY_ANALYTICS_TERMINAL_SUCCESS_STATUSES
        or (
            row.get("computation_status") == "computing"
            and row.get("metrics_json") is not None
        )
    )

_has_numbers = await db_read_with_retry(_published_numbers_exist)
```
`db_read_with_retry` is already imported (job_worker.py line 111; defined `services/db.py:223`; retries only a gateway 504 / httpx ReadTimeout, other errors propagate on the first attempt). The `computing`+`metrics_json` arm exists because bridge branch (a) bounces a plain `complete` row to `computing` while a sibling job is in flight (review R3-01, migration 20261105120000). RESEARCH Open Question 4 recommends including it; the founder ruling names only the status pair, so the planner must record the chosen width.

**Region to edit** (from the `# Phase 18 root-cause fix` comment ~line 2836 to the final `return DispatchResult(...)` ~lines 2992-2997; nothing above that comment; Phase 251 SYNCSTORE owns the rest). Current code:
```python
_follow_on_kind = JOB_CHAIN_FOLLOW_ON["sync_trades"][0]
try:
    def _enqueue_follow_on() -> None:
        ctx.supabase.rpc("enqueue_compute_job", {"p_strategy_id": strategy_id, "p_kind": _follow_on_kind}).execute()
    await db_execute(_enqueue_follow_on)
    logger.info("sync_trades: enqueued follow-on %s for strategy %s", _follow_on_kind, strategy_id)
except Exception as exc:  # noqa: BLE001
    logger.exception("sync_trades: failed to enqueue follow-on derive_broker_dailies for strategy %s ... Error: %s", strategy_id, exc)
    try:
        def _mark_analytics_failed() -> None:
            _enqueue_failed_payload: dict[str, Any] = {
                "strategy_id": strategy_id,
                "computation_status": "failed",
                "computation_warned": False,
                "computing_started_at": None,
                "computation_error": (
                    "Analytics enqueue failed during sync. "
                    "The next scheduled sync will retry — "
                    "contact support if this persists."      # ~line 2967, ERRC-01
                ),
            }
            ctx.supabase.table("strategy_analytics").upsert(_enqueue_failed_payload, on_conflict="strategy_id").execute()
        await db_execute(_mark_analytics_failed)
    except Exception as mark_exc:  # noqa: BLE001
        logger.exception("sync_trades: failed to mark strategy_analytics as failed for strategy %s after enqueue failure — wizard may still hang. Error: %s", strategy_id, mark_exc)

return DispatchResult(outcome=DispatchOutcome.DONE, trade_count=0 if phase1_failed else len(trades))
```
Must preserve / change:
- Keep the five-key payload EXACTLY (`strategy_id, computation_status, computation_warned, computing_started_at, computation_error`): the provenance census identifies the inert site by that key set (`EXPECTED_INERT_SITES = 1`). Change only the sentence.
- In the `except`, run the publish read first. Published: `logger.exception`, return the existing DONE result, do NOT run `_mark_analytics_failed` (it writes `computation_warned: False`, which turns a `complete_with_warnings` row into plain `complete` at bridge branch (c)). Nothing published: keep the upsert and return `DispatchResult(outcome=DispatchOutcome.FAILED, error_message=<constant text, strategy_id only>, error_kind=<Open Question 2, recommended "transient">)`. If the read itself fails, RESEARCH recommends fail-safe = treat as published.
- `DispatchResult` is a frozen slots dataclass (`outcome, error_message, error_kind: ErrorKind | None, trade_count`), `job_worker.py:976`. `main_worker.dispatch_tick` maps DONE -> `mark_compute_job_done`, FAILED -> `mark_compute_job_failed` with `p_error_kind = kind or "unknown"`.
- Rewrite the long "THIS WRITE IS ERASED ONE RPC LATER" comment: it becomes false. Keep the "payload is deliberately UNSTAMPED" statement and the census pointer.
- Stitch member-cap string at ~line 12429 (`"or contact support to raise the limit."`) -> "use the contact form to ask for a higher limit." The comment at ~line 7615 quoting "Contact support" is a comment, leave it (the AST gate ignores comments).
- Conventions to copy: `# noqa: BLE001` on broad excepts, `logger.exception` with `%s` formatting, never `str(exc)` into a user field.

### 6. `analytics-service/routers/portfolio.py` (ERRC-02 and `_fail_vr`)

Constants (lines 110-112):
```python
BENCHMARK_NOTE_STALE = "benchmark unavailable: stale"
BENCHMARK_NOTE_THIN = "benchmark unavailable: fewer than 30 shared days"
BENCHMARK_NOTE_ERROR = "benchmark unavailable: computation failed"
```
Add `BENCHMARK_NOTE_NO_SOURCE = "benchmark unavailable: no price source"` beside them. Note block in `_compute_portfolio_analytics` (lines 1044-1048 and 1096-1106), current:
```python
benchmark_rets, benchmark_stale = await get_benchmark_returns("BTC", since=_bench_since)
if benchmark_rets is None or benchmark_stale:
    benchmark_note = BENCHMARK_NOTE_STALE
else: ...
if benchmark_note is not None:
    benchmark_comparison = {"symbol": "BTC", "correlation": None, "benchmark_twr": None,
        "portfolio_twr": portfolio_twr, "stale": benchmark_note == BENCHMARK_NOTE_STALE, "note": benchmark_note}
```
Split into `if benchmark_rets is None: NO_SOURCE / elif benchmark_stale: STALE / else:`. `"stale": benchmark_note == BENCHMARK_NOTE_STALE` is already False for NO_SOURCE, and `data_quality` carries `benchmark_unavailable`/`benchmark_note` from the same variable, so nothing else changes. Do not change `services/benchmark.py` (its `(None, True)` contract is pinned by `tests/test_benchmark.py` and `tests/test_benchmark_refresh.py`). `_fail_vr` at line 2827: `_fail_vr("Verification failed. Contact support if this persists.")` -> "Verification failed. Use the contact form if this persists." 236 FIGUREMATH shares this file; check its merge state at re-base.

Front-end reality (Open Question 1): no component renders `benchmark_comparison.note` today (`BenchmarkComparison.tsx` was deleted in Phase 195); `adaptPortfolioAnalytics` has no non-test caller. The wire contract plus an adapter pin is the testable surface unless the founder asks for a card.

### 7. `services/exchange.py` and `services/csv_validator.py` (literal swaps)

`exchange.py` lines 1504-1507:
```python
result["error"] = (
    "Key validation failed unexpectedly. Contact support if this "
    "persists."
)
```
-> "Key validation failed unexpectedly. Use the contact form if this persists." Keep `result["error_code"] = "VALIDATION_UNEXPECTED"`. Update both quoted copies on the TS side in the same PR: `src/lib/wizardErrors.ts` ~line 5507 (the exemption reason quoting `Detail: 'Key validation failed unexpectedly. Contact support if this ' + 'persists.'`) and `src/lib/wizardErrors.test.ts` ~line 3834 (the `seamThrow(...)` replay; stays green because classification is by code, but its quoted detail would become false).

`csv_validator.py` lines 416-423, only this literal (240 CONNECTTRUTH owns the rest of the file):
```python
"message": (
    f"Detected percent-form daily_return (median |non-zero| = "
    f"{median_abs:.2f}). Auto-normalized to decimal by dividing "
    f"every row by 100. If your file was already in decimal "
    f"form, contact support."
),
```
-> `f"form, use the contact form."`

### 8. `analytics-service/tests/test_no_contact_support_copy.py` (NEW SC-1 gate)

**Analog: `analytics-service/tests/test_legacy_table_not_named.py` lines 29-116**:
```python
ANALYTICS_ROOT = Path(__file__).resolve().parents[1]
SCAN_PATHSPECS = ("services","routers","models","scripts","main.py","main_worker.py","main_worker_healthz.py","sentry_init.py")

def _tracked_python_files() -> list[Path]:
    out = subprocess.run(["git","ls-files","-z","--",*SCAN_PATHSPECS], cwd=ANALYTICS_ROOT, check=True, capture_output=True, text=True).stdout
    return [ANALYTICS_ROOT / p for p in out.split("\0") if p.endswith(".py")]

def _offences(path):
    tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    docstrings = _docstring_constants(tree)
    for node in ast.walk(tree):
        if isinstance(node, ast.Constant) and isinstance(node.value, str) and id(node) not in docstrings: ...

assert "services/job_worker.py" in scanned, "git ls-files did not list services/job_worker.py, so the scan is vacuous"
assert "main.py" in scanned and "main_worker.py" in scanned
```
Use `re.search(r"contact\s+support", value, re.I)`. Behaviours checked: the parser merges adjacent literals (the line-split strings in `exchange.py` and the stitch cap) into one `Constant`; the csv_validator phrase sits in one `JoinedStr` `Constant` piece; `#` comments are not AST nodes (the `job_worker.py` comment at ~7615 is ignored); the test docstring in `tests/test_portfolio_router_audit_2026_05_07.py` is under `tests/`, outside the pathspecs. State the blind spot: a phrase split across an f-string interpolation boundary is not one Constant. Add an anti-vacuity self-test feeding a synthetic source with a line-split literal and an f-string piece. Add exact-text pins naming "use the contact form" for each of the five strings (none is pinned today). For argument-literal assertions, `tests/test_computation_error_curated.py` ~lines 255-300 shows the `ast.Constant` isinstance plus `ast.unparse(value)` idiom. `tests/_scan_helpers.py::_py_scan_files` (lines 118-145) is an rglob alternative but omits `models/`, `main_worker_healthz.py` and `sentry_init.py`.

### 9. `analytics-service/tests/test_portfolio_benchmark_pairing.py` (ERRC-02)

Pin to rewrite: `TestNamedBenchmarkNotes.test_missing_benchmark_writes_the_named_stale_note` (lines 297-313):
```python
result = await _compute(sb, benchmark=None, stale=True)
assert result["benchmark_comparison"] == {"symbol": "BTC", "correlation": None, "benchmark_twr": None,
    "portfolio_twr": result["total_return_twr"], "stale": True, "note": NOTE_STALE}
```
Constants at lines 215-217 (`NOTE_STALE`, `NOTE_THIN`, `NOTE_ERROR`; add `NOTE_NO_SOURCE`). Helpers: `_two_strategy_fake()` (249), `_seven_day_btc` (261), `_compute(sb, *, benchmark, stale)` (267-273, patches `portfolio_mod.get_benchmark_returns`), class decorator `@pytest.mark.usefixtures("_fresh_semaphore", "_router_pinned_in_sys_modules")` (276). `test_benchmark_crash_keeps_own_numbers_and_writes_a_fixed_note` uses `benchmark=None, stale=True` only as an arithmetic-free reference and is unaffected.

**Source-layer exits (copy from `tests/test_benchmark.py`):** exit (e) `(None, True)`: lines 128-146 patch `services.benchmark.get_supabase` to raise `RuntimeError("cache unavailable")` and `services.benchmark.fetch_btc_daily_prices` to raise. Exit (d) stale-with-series: lines ~429-445 `patch("services.benchmark._utc_now", return_value=_NOW)`, `get_supabase` -> `_supabase_returning(_cache_rows(list(range(1, 16))))`, `db_execute` -> `_run_sync`, `fetch_btc_daily_prices` -> `AsyncMock(side_effect=httpx_error())`. Cache older than 48h gives `(None, True)` through the cache path (lines 452-463, `_cache_rows(list(range(3, 23)))`). In the new test patch only the source layer so the REAL `get_benchmark_returns` produces each exit under `patch.object(portfolio_mod, "get_supabase", return_value=sb)`, then assert (d) -> STALE / `stale True`, (e) -> NO_SOURCE / `stale False`, `benchmark_twr is None`, `partial_data is False`, and `NOTE_STALE != NOTE_NO_SOURCE`.

**TS pin:** extend `src/lib/portfolio-analytics-adapter.test.ts` ~lines 181-214 ("carries a string benchmark note and drops a non-string or absent one") with `stale: false, note: "benchmark unavailable: no price source"` round-tripping through `parseBenchmarkComparison` (`src/lib/portfolio-analytics-adapter.ts` lines 141-156: `note` conditional key, `stale: asBoolean(v.stale)`).

### 10. `analytics-service/tests/test_job_worker.py` (offline ERRC-03)

Rewrite both: `test_sync_trades_enqueue_failure_does_not_fail_job` (line 3055, asserts DONE) and `test_enqueue_failure_marks_strategy_analytics_failed` (line 3123, asserts DONE + failed upsert shape incl. `computation_warned is False`). Harness to copy:
```python
mock_ctx = MagicMock(); mock_ctx.exchange = mock_exchange; mock_ctx.supabase = MagicMock()
mock_ctx.strategy_row = {"id": "strat-hang", "user_id": "user-1"}
mock_ctx.key_row = {"id": "key-1", "exchange": "okx", "last_sync_at": None, "user_id": "user-1"}
def _rpc(name, payload):
    if name == "enqueue_compute_job": raise RuntimeError("simulated enqueue infra failure")
    stub = MagicMock(); stub.execute.return_value = MagicMock(data=5); return stub
mock_ctx.supabase.rpc.side_effect = _rpc
# _table(name) records every .upsert(payload, **kwargs) into upsert_calls; keeps update().eq().execute() working
with patch("services.job_worker._exchange_preflight", new=AsyncMock(return_value=mock_ctx)), \
     patch("services.job_worker.fetch_all_trades", new=AsyncMock(return_value=[{"test": "trade"}])), \
     patch("services.job_worker.fetch_usdt_balance", new=AsyncMock(return_value=10000.0)), \
     patch("services.job_worker.db_execute", new=AsyncMock(side_effect=lambda fn: fn())), \
     patch("services.job_worker._RAW_TRADE_INGESTION_ENABLED", False):
    result = await run_sync_trades_job(job)
```
Traps: a bare `MagicMock` supabase returns a truthy MagicMock for the new `.select().eq().maybe_single().execute()` read, so script it per case (`data={"computation_status": "complete_with_warnings"}` published; `None`/`{}` nothing published; plus a plain `complete` case and a `computing`+`metrics_json` case so the oracle width is pinned). These tests patch only `services.job_worker.db_execute`; `grep db_read_with_retry tests/test_job_worker.py` found no existing patch for it, and `db_read_with_retry` lives in `services/db.py`, so confirm in the first run which symbol the new read goes through and patch accordingly. Assert outcome, `error_kind`, no `strategy_analytics` upsert in the published case (`upsert_calls == []`), and the five-key payload with the new sentence in the nothing-published case.

### 11. `analytics-service/tests/test_sync_trades_enqueue_failure_bridge_live.py` (NEW live gate)

**Gating, client, seed, cleanup analog: `analytics-service/tests/test_computed_at_now_literal_live.py`** (224 lines):
```python
SUPABASE_URL = os.getenv("SUPABASE_TEST_URL"); SUPABASE_KEY = os.getenv("SUPABASE_TEST_SERVICE_KEY")
_LOOPBACK_HOSTS = frozenset({"127.0.0.1", "localhost", "::1"})
def _require_loopback_lane(url): ...  # pytest.fail unless host is loopback
def _need_supabase(): ...             # skip locally when unset; pytest.fail when CI == "true"
def _lane_client(): ...               # create_client + http2=False session rebuild + wrap_live_db_client(client)
```
Seed own rows only: `admin.auth.admin.create_user({"email": f"p...-{tag}@quantalyze.test", "password": uuid.uuid4().hex, "email_confirm": True})` (the lane trigger creates the profile), `admin.table("strategies").insert({"user_id": user_id, "name": ...})`, `admin.table("strategy_analytics").upsert({...}, on_conflict="strategy_id")`; cleanup in `finally` (delete strategy then `admin.auth.admin.delete_user`). Include a guard self-test like `test_loopback_guard_refuses_every_non_lane_host`.

**Job rows, claim, mark RPCs analog: `analytics-service/tests/test_compute_jobs_fencing.py`** (3217 lines; read ranges only): `_insert_pending_sync_trades(admin, strategy_id)` lines 1679-1689; `_make_strategy(admin)` 1692-1706; `_claim_one(admin, worker_id, *, want_job_id, kind)` 883-946 (keyword-only `want_job_id` and `kind="sync_trades"` keep the global backlog out of the batch); `_rpc_retry_timeout` 767; mark call shape lines 1257-1262:
```python
admin.rpc("mark_compute_job_failed", {"p_job_id": job_id, "p_error": "...", "p_error_kind": "permanent", "p_claim_token": token}).execute()
```
(done: `admin.rpc("mark_compute_job_done", {"p_job_id": job_id, "p_claim_token": token})`); read back `admin.table("compute_jobs").select("status, error_kind, last_error").eq("id", job_id).single().execute().data`. Prefer the `create_user` seed over the fencing file's `_seed_user_id` (reuses any existing profile, wrong for an empty local lane). For `transient`, seed the job row with `attempts = max_attempts` so ONE FAILED mark terminalises it (`mark_compute_job_failed`: permanent -> failed_final; otherwise failed_retry until `attempts >= max_attempts`) and the bridge lands on branch (b).

Assertions: case A (nothing published) -> `strategy_analytics.computation_status == 'failed'`, `computation_error` equal to a LITERAL copy of the curated sentence (never `computation_error_copy(...)`); case B `complete_with_warnings` + `computation_warned=True` -> still `complete_with_warnings`, `computation_error IS NULL`; plus plain `complete` and `computing`+`metrics_json`. After the handler returns, apply the `dispatch_tick` mapping (DONE -> `mark_compute_job_done`; FAILED -> `mark_compute_job_failed` with `result.error_kind or "unknown"` and the job's `claim_token`).

Roster: `tests/test_live_db_reach_roster.py` keeps `CANNOT_RUN_ON_LANE` (`"<module file>::<test function>" -> reason`) for live cases the lane cannot run; this module is lane-runnable, no entry. Add NO `supabase/tests` file (it moves FILES_FLOOR/ARMS_FLOOR and per-file census pins).

Unproven: no test runs a real `run_*_job` handler against the lane client. Recipe: a thin proxy over the lane client whose `.rpc("enqueue_compute_job")` raises and passes everything else through, with `_exchange_preflight`, `fetch_all_trades`, `fetch_usdt_balance` patched as in item 10. RESEARCH fallback: capture `DispatchResult` plus the upsert payload offline, replay the payload as a real upsert on the lane, apply the same mark RPC, read the row.

### 12. `tests/test_computation_error_provenance_census.py`

Comment-only: keep `EXPECTED_STAMPED_SITES = 9`, `EXPECTED_EXEMPT_SITES = 1`, `EXPECTED_INERT_SITES = 1` (~lines 195-197) and `PROVENANCE_INERT_KEYS`. The module docstring bullet "P1 - `job_worker.run_sync_trades_job._mark_analytics_failed` ... returns `DispatchOutcome.DONE`, so the bridge reaches it on branch (c)" goes stale and is the only edit.

---

## Shared Patterns

### One curated sentence per layer, byte-equal across layers
SQL `computation_error_copy` is the only value the bridge writes to `strategy_analytics.computation_error` (fixed literals, NOT STRICT so NULL hits ELSE, `SET search_path = pg_catalog`, `service_role`-only EXECUTE). TS `ENQUEUE_LOST_RACE_USER_COPY` (`csv-finalize/route.ts` ~2025) must equal the SQL ELSE arm, enforced by the vitest reading the snapshot. Python uses fixed literals, never `str(exc)` (see `PORTFOLIO_COMPUTE_FAILED_COPY` and the `BENCHMARK_NOTE_*` comment in `routers/portfolio.py`).
Founder-fixed wording: "use the contact form" / "Use the contact form" (Phase 164.6.6.3.5); `ContactPointerText` (`src/components/contact/ContactPointerText.tsx`) links the lowercase phrase `contact form` via `indexOf`, so a capital U sentence start still links.
- permanent: "Analytics could not complete for this strategy, and retrying alone will not resolve it. Use the contact form if you need this strategy computed."
- ELSE: "Analytics could not complete for this strategy. Retry the sync, or use the contact form if this persists."
- transient/unknown (assumption A1, mechanical substitution, not quoted verbatim in CONTEXT): "Analytics could not complete after several automatic retries. Retry the sync, or use the contact form if it keeps failing."

### Catalogue-only migration self-verify
Source: `20261120120000_auth_user_has_password.sql` lines 74-88; `20261124120700_sanitize_user_attempt_failures.sql` lines 277-314. Apply to the new migration. `scripts/lint-migration-data-dependence.mjs` (no opt-out) and `src/__tests__/raise-exception-concat-grammar.test.ts` (single-literal RAISE slots) both gate it.

### SQL gate setup lists
One-line `-- RED-UNDER-SETUP: {"apply":[...]}` per gate; the mutation lane replays only that list, `sql-tests` replays all migrations the dump does not carry (D-F; `supabase/schema/baseline-carried-migrations.txt` ends at `20261124120700...`). Append, do not reorder.

### Static AST scan with an anti-vacuity guard
Sources: `tests/test_legacy_table_not_named.py`, `tests/test_raw_5xx_census.py` (multiplicity-preserving roster), `tests/_scan_helpers.py`. A scan listing files via `git ls-files` must assert a known file is in the list.

### Live-lane gating
`tests/test_computed_at_now_literal_live.py` (`_need_supabase`, `_require_loopback_lane`, `_lane_client`); psycopg modules resolve the DSN through `tests/live_db_dsn.py` (`SHARED_TEST_DSN_VAR` is scanned by `test_live_db_reach_roster.py`; never read the shared-TEST DSN directly). Local: skip when unset; CI: `pytest.fail` when unset.

### Neuter protocol (PROOF-01)
Byte backup via `cp`, neuter, observe the named RED, restore via `cp` and verify with `cmp`; never `git checkout/restore/stash` on uncommitted work. Per-gate neuter targets: RESEARCH "PROOF-01 plan".

### Python write-scope fence
Edit only the symbols CONTEXT/RESEARCH name. `job_worker.py`: the enqueue-failure block and the stitch member-cap literal. Never the Phase-1 store, phase2 flag block, cursor read, `advance_fetched_cursor`, or the `phase1_failed` expression on the DONE path (Phase 251 SYNCSTORE depends on 222).

---

## No Analog Found

| File | Role | Data Flow | Reason |
|---|---|---|---|
| Live-lane harness running a REAL `run_sync_trades_job` through a lane client proxy | test | event-driven + CRUD | Every live module calls RPCs/tables directly; none runs a worker handler. Use the proxy recipe or the capture-and-replay fallback (item 11). |
| Muted rendering of the NO_SOURCE note | component | transform | No live consumer of `benchmark_comparison.note` (card deleted in Phase 195). Wire contract plus adapter pin only, unless the founder asks for a component. |
| Snapshot-wide "no arm says contact support" pin | test | file-I/O | No per-arm sweep of `computation_error_copy.sql` exists; compose `closed-sets.cohort-gate-parity.test.ts` and the git-history ELSE parser. |

## Out of scope but adjacent (default OUT, RESEARCH Open Question 3)
SQL survivors beyond the `computation_error_copy` arms: `supabase/schema/functions/first_hop_enqueue_sweep.sql` `c_named_state_copy` (Phase 227; written into `strategy_analytics.computation_error`; pinned at `supabase/tests/test_first_hop_enqueue_sweep.sql` `c_sentence`; quoted in `docs/runbooks/compute-queue.md` ~line 502), `get_user_compute_jobs.sql` `user_message`, `prevent_profile_role_change.sql` RAISE. TS mentions that are comments only: `src/lib/gdpr-export.ts` ~379, `src/lib/factsheet/fetch-and-build-payload.ts` ~229, `CsvSubmitStep.upstream-arm.test.tsx` ~40, `wizardErrors.ts` ~2003. Stale invented TS fixtures (leave): `src/__tests__/fixtures/portfolio-analytics/computed-status-failed.json`, `ApiKeyManager.poll.test.tsx`, `src/lib/analytics-schemas.test.ts`, `src/__tests__/compute-jobs-audit-2026-05-07-residual.test.ts`. Optional refresh (RESEARCH Q5): the two `SyncPreviewStep` render-test fixtures and the paired negative `not.toContain("Contact support if you need")`, which goes vacuous if the fixture is refreshed without it.

## Metadata

**Analog search scope:** `supabase/migrations` (+ `down`), `supabase/schema/functions`, `supabase/tests`, `analytics-service/{services,routers,tests}`, `src/app/api/strategies/csv-finalize`, `src/lib`, `src/__tests__`, `scripts` lint scripts, git history (`026e1d761^`).
**Files scanned:** about 45 (large files read by targeted range: `job_worker.py` ~12.4k lines, `test_compute_jobs_fencing.py` 3217 lines, `20260826120000_computation_error_curated_copy.sql` 1393 lines).
**Pattern extraction date:** 2026-11-25
