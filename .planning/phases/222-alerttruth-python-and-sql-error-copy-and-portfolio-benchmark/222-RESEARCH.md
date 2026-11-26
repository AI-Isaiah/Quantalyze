# Phase 222: ALERTTRUTH - Research

**Researched:** 2026-11-25
**Domain:** error-copy truth (SQL `computation_error_copy` + Python strings), portfolio benchmark outage label, `run_sync_trades_job` enqueue-failure outcome vs the SQL status bridge
**Confidence:** HIGH on the code facts (all read at HEAD of `gsd/phase-222-alerttruth` this session); MEDIUM on two design choices flagged in Open Questions.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**ERRC-03: failed follow-on enqueue in run_sync_trades_job (founder ruling 2026-11-25, option a)**
- Return FAILED only when nothing is published to lose: the strategy has no `strategy_analytics` row at `complete` or `complete_with_warnings`. A live published strategy keeps its publish state and the next cron tick retries (the handler keeps returning DONE there). — **Reversibility:** costly — it changes the outcome the bridge `sync_strategy_analytics_status` sees on a live path for every live-API strategy.
- `EXPECTED_INERT_SITES` in `tests/test_computation_error_provenance_census.py` stays as it is (the payload stays unstamped).
- The 161.1 F1 remedy is NOT copied as-is (TODOS entry caution: `sync_trades` is not in the bridge's `is_protected` kind list, so an unconditional FAILED lands on loud branch (b)).
- Gate: a test drives the failed enqueue through the bridge and asserts the stored status and error for both cases (nothing published -> failed with the curated sentence; published -> publish state preserved), RED before the fix.

**ERRC-02: total benchmark source failure (founder ruling 2026-11-25)**
- New constant `BENCHMARK_NOTE_NO_SOURCE = "benchmark unavailable: no price source"` in `analytics-service/routers/portfolio.py`, written on the `(None, True)` exit of `get_benchmark_returns` (no price source and no recent cached day), distinct from `BENCHMARK_NOTE_STALE`.
- The page renders it in the muted treatment, not amber. A test drives both exits and tells them apart.

**ERRC-01: "contact support" copy (founder ruling 2026-11-25: plan stands)**
- Replace "contact support" with "use the contact form" (the Phase 164.6.6.3.5 wording) in every `computation_error_copy` arm (by migration) and in the five Python strings: `services/exchange.py` VALIDATION_UNEXPECTED, `services/csv_validator.py`, `services/job_worker.py` (two), `routers/portfolio.py` `_fail_vr`. — **Reversibility:** one-way — the SQL arms change by migration that auto-applies to PROD.
- The SQL ELSE arm becomes byte-equal to csv-finalize's `ENQUEUE_LOST_RACE_USER_COPY` ("Analytics could not complete for this strategy. Retry the sync, or use the contact form if this persists."); `csv-finalize/route.test.ts` reads the SQL arm instead of the hand-typed oracle.
- Permanent arm: "Analytics could not complete for this strategy, and retrying alone will not resolve it. Use the contact form if you need this strategy computed."
- `job_worker.py` "or contact support to raise the limit" becomes "use the contact form to ask for a higher limit".
- Every census the migration moves (schema snapshot `supabase/schema/functions/computation_error_copy.sql`, mutation floors, pins, parity SQL tests) moves in the same PR; migration-reviewer and rls-policy-auditor clean before merge.

**Write scope (symbol-limited; 232 OKXTRADES and 240 CONNECTTRUTH have merged)**
- `job_worker.py`: only the enqueue-failure block at the tail of `run_sync_trades_job` and the two copy strings. Not the Phase-1 store, the phase2 flag block, cursor read or `advance_fetched_cursor`.
- `csv_validator.py`: only the one copy string. `routers/portfolio.py`: the benchmark note block in `_compute_portfolio_analytics`, the constants, and `_fail_vr` copy.

**Migration lane**
- The migration PR queues behind 225's PR-3. Stop before opening the PR and before any push.

### Claude's Discretion
- How the "nothing published" check is read (one select on `strategy_analytics.computation_status` before the mark), test file layout, and frontend file holding the muted rule.

### Deferred Ideas (OUT OF SCOPE)
- The four 232 OKXTRADES leftovers in `run_sync_trades_job` (first-sync timeout losing daily P&L / Phase-1 store order; Phase-1 store under refusal flags; `daily_pnl_*` flags never cleared; drained flags never reaching `data_quality_flags`) are out of 222's goal. Founder 2026-11-25: booked as ONE new v1.22 phase, Depends on 222. (Booked as ROADMAP Phase 251 SYNCSTORE.)
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| ERRC-01 | No user-readable string in `analytics-service` or in the `computation_error_copy` arms says "contact support"; csv-finalize copy in byte parity with the SQL arm, checked by reading the SQL arm | Sections "ERRC-01 census", "SQL migration mechanics", "csv-finalize oracle", "Python strings" |
| ERRC-02 | A total benchmark source failure shows wording distinct from a stale benchmark | Section "ERRC-02" — incl. the finding that NO page renders the note today (Open Question 1) |
| ERRC-03 | A failed follow-on enqueue in `run_sync_trades_job` never leaves the strategy `complete` with no analytics | Section "ERRC-03" — incl. the published-case trap (the `failed` upsert itself changes publish state) |
</phase_requirements>

## Project Constraints (from CLAUDE.md)

- Supabase CLI in this checkout is linked to PRODUCTION; never run `db push`/`--linked`. Marker query before any write. This phase writes **no DB**; the migration auto-applies to PROD on merge once `apply-test` is green (the Production reviewer gate was removed 2026-09-23), so every review happens BEFORE merge.
- **CHANGELOG entry** is mandatory for the ship (commits-as-checklist mechanism); never write the CI-skip trailer tokens, not even to deny them. `VERSION` and `package.json` byte-equal 4-digit strings.
- **TODOS.md**: the ship PR deletes the three owned entries (`[212-CONTACT-SUPPORT-SURVIVORS]`, `[166.4.1-BENCHMARK-OUTAGE-LABEL]`, `[SYNCTRADES-ENQUEUE-DONE]`) and names them in the CHANGELOG entry; LOW/Info review survivors are NOT booked there. If a doc/test cites a closed id, fix the pointer in the same PR.
- Cite by symbol, not line numbers, in prose that will drift. Read floors by symbol from `scripts/mutation-floors.mjs`.
- `@~/.claude/CLAUDE.md` rules: root-cause, surgical changes, fail loud, tests encode WHY; never use Grok/Codex; no AI-authorship trailers in commits (memory: founder 2026-10-20) even though the harness reminder lists them. Public repo: no secrets/PROD ids/home paths in tracked text.
- Neuter protocol (PROOF-01): restore from a byte backup (`cp` back + `cmp`), never `git checkout/restore/stash` on uncommitted work.
- Agent gates include **mypy strict** for any analytics-touching change (memory).
- Always `grep -a`. `pytest` only from `analytics-service/`. A new `supabase/tests` file or arm moves several censuses — this research recommends adding NONE (see "Census plan").

## Summary

Three independent fixes plus one migration. **ERRC-01** is mostly mechanical but has a hidden SQL-gate trap: 22 SQL gate files list `20260826120000_computation_error_curated_copy.sql` in their `RED-UNDER-SETUP` apply list, and the mutation lane replays ONLY that explicit list. A new `CREATE OR REPLACE` migration is therefore invisible to the lane unless a test lists it. Exactly two gate files pin the old sentence literally (`test_sync_status_curated_sentence_survives.sql`, `test_sync_status_marked_refresh_protected.sql`); both run in two lanes (the `sql-tests` lane replays the new migration automatically; the pg-lane mutation runner does not), so their literals AND their `RED-UNDER-SETUP` lists must move together. The parity gate `test_compute_jobs_error_kind_copy_parity.sql` should NOT be touched and should NOT load the new migration (its RED-UNDER-M arms 2/A-3 and 3/F-3 mutate the OLD migration file; loading a later `CREATE OR REPLACE` would overwrite the mutation and the arms would stop biting).

**ERRC-02** is a four-line Python change plus tests, but the premise "the page renders it" is stale: the `BenchmarkComparison` card was deleted in Phase 195 TRIM (commit `3ba04e9a0`), and `adaptPortfolioAnalytics` has zero non-test callers. The wire value is still persisted (`portfolio_analytics.benchmark_comparison.note` and `data_quality.benchmark_note`), and `stale` is already `False` on every non-stale exit, so any renderer applying the old rule (amber iff `stale`) shows NO_SOURCE muted by construction. There is currently no component to edit. This needs a one-line orchestrator/founder decision (Open Question 1).

**ERRC-03**: returning FAILED is not enough on its own. In the published case the handler's existing `_mark_analytics_failed` upsert writes `computation_status='failed'` AND `computation_warned=False`; the bridge's branch (c) then resolves to plain `complete`, so a `complete_with_warnings` strategy silently loses its warning (publish state NOT preserved). For the "published -> publish state preserved" half to hold, the failed upsert must also be skipped (or made non-destructive) when published. The nothing-published half is a FAILED return whose stored sentence is the bridge's `computation_error_copy(<kind>)` (the payload stays unstamped per the ruling, so branch (b) overwrites the handler's own sentence). Which `error_kind` to return is the one design choice left open (Open Question 2).

**Provenance note:** discrete in-repo values below were read this session; line anchors (cite by symbol, they drift): `routers/portfolio.py:110-112` (BENCHMARK_NOTE_*), `services/job_worker.py:1097-1099` (STRATEGY_ANALYTICS_TERMINAL_SUCCESS_STATUSES), `tests/test_computation_error_provenance_census.py:195-197` (EXPECTED_STAMPED_SITES 9, EXPECTED_EXEMPT_SITES 1, EXPECTED_INERT_SITES 1), `supabase/migrations/20260826120000_computation_error_curated_copy.sql` arms at lines 285/292/294/318 and snapshot `supabase/schema/functions/computation_error_copy.sql` lines 44/51/53/77, `scripts/mutation-floors.mjs` FILES_FLOOR/ARMS_FLOOR/WAIVED_CEILING exports.

**Primary recommendation:** Plan three independent workstreams (SQL+TS parity / Python copy+benchmark / ERRC-03 handler+live gate). Add NO new `supabase/tests` file or arm (floors and per-file census pins stay put); prove ERRC-03 with offline unit tests plus one Python live-lane module driven through the real bridge; read the SQL ELSE arm from the generated snapshot in the csv-finalize vitest (the pre-212 parser exists in git history).

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| `computation_error_copy` sentences | Database (SQL function) | — | Only value the status bridge writes to `strategy_analytics.computation_error` |
| csv-finalize lost-race sentence | API / Backend (Next route) | Database | Route writes its own constant; parity with SQL ELSE enforced by a test reading the SQL |
| Five Python strings | API / Backend (analytics-service) | — | Returned in HTTP bodies / written to `computation_error` |
| Benchmark note + outage distinction | API / Backend (analytics-service) | Database (persisted JSONB) | `_compute_portfolio_analytics` decides and persists; no live renderer (Open Question 1) |
| Enqueue-failure outcome | API / Backend (worker handler) | Database (bridge) | Handler picks DONE/FAILED; `main_worker` maps to mark RPC; bridge writes the row |

## Standard Stack

No new packages. Everything below is already pinned and in use. [VERIFIED: `analytics-service/requirements.txt` line `ccxt==4.5.89`; `.github/workflows/ci.yml` `python-version: "3.12"`]

| Tool | Version/Command | Purpose |
|------|-----------------|---------|
| pytest (CI) | `pytest -n auto --dist loadgroup --cov=services --cov=routers --cov=main_worker --cov-report=term-missing --cov-fail-under=80` (cwd `analytics-service`) | Python suite [VERIFIED: ci.yml python job] |
| mypy (CI) | `mypy --strict --follow-imports=silent --config-file=pyproject.toml services/ routers/ models/ main.py main_worker.py main_worker_healthz.py sentry_init.py` | Type gate [VERIFIED: ci.yml] |
| vitest | `npx vitest run <file>`; full `npm test` | TS tests |
| schema snapshot | `npm run schema:functions` (write), `npm run schema:functions:check` | regenerates `supabase/schema/functions/*.sql` from migrations |

**Package Legitimacy Audit:** Not applicable. This phase installs no external packages. Packages removed (SLOP): none. Packages flagged (SUS): none.

## Architecture Patterns

### Data flow (ERRC-03, the part with real moving pieces)

```
cron / keys-sync enqueues sync_trades
        |
        v
main_worker.dispatch_tick -> run_sync_trades_job (job_worker.py)
        |  Phase-1/2 store, cursor advance            (FENCED: 232/251 own)
        v
 follow-on enqueue_compute_job(derive_broker_dailies)  --- ok ---> DONE (unchanged)
        |
      raises
        v
 [NEW] read: does strategy_analytics have computation_status in
        STRATEGY_ANALYTICS_TERMINAL_SUCCESS_STATUSES ?
        |                                   |
   published                           nothing published
        |                                   |
 log + return DONE                  keep _mark_analytics_failed upsert (copy edited)
 (NO failed upsert:                 return FAILED(error_kind=<Open Q2>)
  it clears computation_warned)             |
        |                                   v
        v                          main_worker -> mark_compute_job_failed
 mark_compute_job_done                      -> bridge branch (b) (sync_trades is
 -> bridge branch (c) keeps                    not in is_protected kinds)
    complete / complete_with_warnings       -> row 'failed' + computation_error_copy(kind)
```

### Pattern: publish-state read
Reuse `STRATEGY_ANALYTICS_TERMINAL_SUCCESS_STATUSES` and the `db_read_with_retry` idiom already used by `_published_numbers_exist` in `run_derive_broker_dailies_job`. [VERIFIED: job_worker.py] The frozenset is quoted verbatim:

```python
STRATEGY_ANALYTICS_TERMINAL_SUCCESS_STATUSES: Final[frozenset[str]] = frozenset(
    {"complete", "complete_with_warnings"}
)
```

### Anti-patterns
- **Copying F1 as-is** (unconditional FAILED/permanent): lands on loud branch (b) for live strategies. Founder ruling forbids.
- **Stamping the enqueue-failure payload** with `computation_error_source/job_id`: reddens `EXPECTED_INERT_SITES = 1` in `test_computation_error_provenance_census.py` and is ruled out. Keep the five-key payload (`strategy_id, computation_status, computation_warned, computing_started_at, computation_error`) EXACTLY — the census identifies the site by that key set.
- **Loading the new migration into the parity gate's RED-UNDER-SETUP**: kills arms 2/A-3 and 3/F-3 (they mutate the old migration file).
- **A hand-typed oracle** for the SQL arm in any new gate.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Reading the SQL ELSE arm in vitest | a new parser design | the pre-212 parser, `git show 026e1d761^:src/app/api/strategies/csv-finalize/route.test.ts` (lines ~700-725) | proven; regex `/\bELSE\s*\n\s*'([^']+)'/` on `supabase/schema/functions/computation_error_copy.sql`; throws loudly at module scope on parse failure |
| Publish-state predicate | new status list | `STRATEGY_ANALYTICS_TERMINAL_SUCCESS_STATUSES` | single-sourced with the SQL view (plan 05 gate 9) |
| Regenerating the function snapshot | hand edit | `npm run schema:functions` | file is `@generated ... DO NOT EDIT BY HAND`; `schema:functions:check` is a CI gate |
| Live DB test harness | new lane plumbing | `tests/live_db_dsn.py`, `tests/live_db_transport.py::wrap_live_db_client`, helpers in `tests/test_compute_jobs_fencing.py` (`_claim_one`, `_insert_pending_sync_trades`, `_make_strategy`, `admin` fixture) and the gating idiom of `tests/test_computed_at_now_literal_live.py` | skip locally / FAIL in CI when the lane is unset; loopback guard |
| Linking "contact form" in rendered copy | any link logic | `ContactPointerText` (`src/components/contact/ContactPointerText.tsx`) matches the exact lowercase phrase `contact form` via `text.indexOf`; "Use the contact form ..." (capital U) still links | verified: case-sensitive match is on `contact form` only |

## ERRC-01 census (measured at HEAD)

### SQL: latest definition
`computation_error_copy` has exactly ONE defining migration: `supabase/migrations/20260826120000_computation_error_curated_copy.sql` (`CREATE OR REPLACE FUNCTION computation_error_copy(p_error_kind TEXT)`, `LANGUAGE sql IMMUTABLE SET search_path = pg_catalog`). No later migration redefines it. [VERIFIED: grep of all `supabase/migrations/*.sql` for `FUNCTION[^(]*computation_error_copy`]. The snapshot `supabase/schema/functions/computation_error_copy.sql` is the generated copy of it (header `-- source migration: 20260826120000_computation_error_curated_copy.sql`).

Arms that say "contact support" (verbatim, four arms):

```
WHEN 'permanent' -> 'Analytics could not complete for this strategy, and retrying alone will not resolve it. Contact support if you need this strategy computed.'
WHEN 'transient' -> 'Analytics could not complete after several automatic retries. Retry the sync, or contact support if it keeps failing.'
WHEN 'unknown'   -> 'Analytics could not complete after several automatic retries. Retry the sync, or contact support if it keeps failing.'
ELSE             -> 'Analytics could not complete for this strategy. Retry the sync, or contact support if this persists.'
```
`'orphaned'` carries no pointer ("Analytics stopped before it finished because the process running it went away. Nothing is wrong with this strategy — retry the sync.") — leave byte-identical (parity Part 3 asserts `ILIKE '%retry the sync%'` on it).

Target text (CONTEXT-locked for ELSE and permanent; transient/unknown are the mechanical substitution of the locked "use the contact form" wording):
- permanent: `Analytics could not complete for this strategy, and retrying alone will not resolve it. Use the contact form if you need this strategy computed.` (parity Part 3 requires `v_permanent ILIKE '%will not resolve%'` — preserved)
- transient/unknown: `Analytics could not complete after several automatic retries. Retry the sync, or use the contact form if it keeps failing.` [ASSUMED: mechanical substitution, wording not quoted verbatim in CONTEXT]
- ELSE: `Analytics could not complete for this strategy. Retry the sync, or use the contact form if this persists.` (byte-equal to `ENQUEUE_LOST_RACE_USER_COPY` in `src/app/api/strategies/csv-finalize/route.ts`)

### SQL survivors OUTSIDE the four arms (scope flag, Open Question 3)
Found by `grep -a -i "contact support" supabase/schema`:
- `supabase/schema/functions/first_hop_enqueue_sweep.sql` constant `c_named_state_copy` (Phase 227, migration `20261124120400_first_hop_enqueue_sweep.sql`, created with plain `CREATE FUNCTION`): ends "Retry the sync, or contact support if this persists." It is written into `strategy_analytics.computation_error` (user-visible like the arms). Pinned literally at `supabase/tests/test_first_hop_enqueue_sweep.sql` (`c_sentence`), 25 `RED-UNDER-M` twins in that file, also quoted in `docs/runbooks/compute-queue.md`. Re-basing it is a second SECURITY DEFINER function rebase.
- `supabase/schema/functions/get_user_compute_jobs.sql` `user_message` ("We hit a problem we can''t retry automatically. Please contact support." / "Tried multiple times without success. Please contact support."): returned by RPC; no TS component renders `user_message` (only `src/lib/analytics-schemas.ts` zod). 
- `supabase/schema/functions/prevent_profile_role_change.sql` RAISE text ("Contact support to switch between allocator and manager accounts."): operator-shaped RAISE, no UI consumer found.
The ROADMAP SC-1 and the founder ruling name only the `computation_error_copy` arms, so these are out of the locked scope; the goal sentence ("every ... SQL error sentence a user can read") is broader. Recommend default OUT, and the orchestrator confirms.

### Where the old strings appear (every hit, excluding CHANGELOG/TODOS/.planning)
SQL gate pins (must move with the migration):
- `supabase/tests/test_sync_status_curated_sentence_survives.sql` `c_perm` (one literal, with a comment saying it was "Copied from 20260826120000_computation_error_curated_copy.sql:285").
- `supabase/tests/test_sync_status_marked_refresh_protected.sql` `c_perm` plus two inline `IF v_error IS DISTINCT FROM '...'` literals (three sites).
TS fixtures that merely *copy* DB text (not coupled; optional refresh, comments claim "verbatim"): `src/app/(dashboard)/strategies/new/wizard/steps/SyncPreviewStep.composite.render.test.tsx` (permanent fixture + a `not.toContain("Contact support if you need")` negative that is only meaningful if the fixture still carries the phrase — if the fixture is refreshed, refresh the negative to the new phrase or it becomes vacuous), `SyncPreviewStep.render.test.tsx` `GENERIC_TRANSIENT_SENTENCE` (near-miss control against the MT5 cause stamp; stays an exact-equality control either way). Stale invented fixtures with the phrase: `src/__tests__/fixtures/portfolio-analytics/computed-status-failed.json`, `ApiKeyManager.poll.test.tsx` `TIMEOUT_COPY`, `src/lib/analytics-schemas.test.ts`, `src/__tests__/compute-jobs-audit-2026-05-07-residual.test.ts` — not sentences any current code produces; leave.
Python pin of the exchange string: `src/lib/wizardErrors.ts` (the `VALIDATION_UNEXPECTED` exemption reason quotes "Detail: 'Key validation failed unexpectedly. Contact support if this persists.'") and `src/lib/wizardErrors.test.ts` ("the two EXEMPT venue codes still reach the verdicts their reasons claim" replays that exact string via `seamThrow`). BOTH must be updated with the Python edit (the replay classifies to UNKNOWN/500 regardless of wording, so the test stays green but its quoted detail becomes false).
Docs: `docs/runbooks/compute-queue.md` quotes the sweep sentence only (not the four arms).

### Python census (case-insensitive, whitespace-collapsed scan of all `analytics-service/**/*.py`) [VERIFIED by script, 7 hits]
| File | Symbol | Kind | Action |
|------|--------|------|--------|
| `services/exchange.py` | `validate_key_permissions` generic-exception arm, `result["error"]` ("Key validation failed unexpectedly. Contact support if this " "persists.") with `error_code = "VALIDATION_UNEXPECTED"` | string (split across 2 lines) | -> "Key validation failed unexpectedly. Use the contact form if this persists." [ASSUMED wording by substitution] |
| `services/csv_validator.py` | percent-form auto-normalize `info_flags` `"message"` f-string, ends "If your file was already in decimal form, contact support." | string (split across 2 f-string lines) | -> "...form, use the contact form." [ASSUMED] — touch ONLY this literal (240 CONNECTTRUTH owns the rest of the file) |
| `services/job_worker.py` | `run_sync_trades_job` `_mark_analytics_failed` payload: "Analytics enqueue failed during sync. The next scheduled sync will retry — " "contact support if this persists." | string | -> "... will retry — use the contact form if this persists." [ASSUMED] — keep the five-key payload exactly |
| `services/job_worker.py` | `run_stitch_composite_job` member-cap `_stamp_failed(...)`: "Reduce members " "or contact support to raise the limit." | string | -> "... or use the contact form to ask for a higher limit." (CONTEXT-locked) |
| `routers/portfolio.py` | `verify_strategy` `_fail_vr("Verification failed. Contact support if this persists.")` | string | -> "Verification failed. Use the contact form if this persists." [ASSUMED] |
| `services/job_worker.py` | comment in `run_derive_broker_dailies_job` ("not the permanent "Contact support" one") | COMMENT | not a user string; a naive grep would catch it |
| `tests/test_portfolio_router_audit_2026_05_07.py` | docstring line 87 | test docstring | not a user string; naive grep would catch it |

SC-1 gate shape: an `ast`-based scan (collect `ast.Constant` str values, which also reaches f-string literal pieces and implicitly concatenated literals) over non-test `analytics-service` Python, case-insensitive `contact\s+support`, so the comment and the test docstring do not trip it and the two line-split strings do. Include an anti-vacuity self-test (feed a synthetic source containing a split literal and assert it is found). None of the five strings has an existing exact-text pin (measured: no test greps them), so also add exact-text pins naming "use the contact form" for each.

### csv-finalize oracle
`ENQUEUE_LOST_RACE_USER_COPY` lives in `src/app/api/strategies/csv-finalize/route.ts` (const, ~line 2025) and already reads the target ELSE text. The oracle in `route.test.ts` is `const CURATED_DEFAULT_COPY: string = "Analytics could not complete for this strategy. Retry the sync, or use the contact form if this persists.";` preceded by a long "ORACLE RE-CUT 2026-11-14" comment saying parity is deliberately broken until the migration. Replace it with the module-scope parser (precedent in git: `026e1d761^`), reading `supabase/schema/functions/computation_error_copy.sql` via `readFileSync(resolve(process.cwd(), ...))`, and rewrite the stale comment blocks (the "ORACLE RE-CUT" paragraph, the doc comment above the const, and the `[164.9.x]` RED-DEMO notes that mention the legacy pointer near the end of that describe). Keep the existing anti-vacuity case ("the oracle is a real sentence, not an empty match"); add: ELSE parsed text is byte-equal to the route's exported/observed copy (the test reads `copyWrittenToUser()`), and (recommended) a snapshot-wide pin that no `THEN`/`ELSE` arm matches `/contact support/i` and each non-orphaned arm contains `contact form`. Read the snapshot, not the migration file (stable path, kept current by `schema:functions:check`).

### SQL migration mechanics
- **Timestamp:** 14-digit `YYYYMMDDHHMMSS`; latest in the tree is `20261124120700_sanitize_user_attempt_failures.sql` (337 files). `migration-policy.yml` (PR-time) refuses a migration older than the PROD tip; pick the stamp AFTER 225 PR-3's migration and re-pick from origin/main before the single CI run (memory: "version digit re-picked before CI"). Suggested name: `2026112xxxxxxx_computation_error_copy_contact_form.sql`. [CITED: `.github/workflows/migration-policy.yml` header]
- **Body:** `BEGIN; SET lock_timeout='5s';` `CREATE OR REPLACE FUNCTION computation_error_copy(p_error_kind TEXT) RETURNS TEXT LANGUAGE sql IMMUTABLE SET search_path = pg_catalog` — same signature, NOT STRICT. Re-base from the 20260826120000 body: keep the `CANARY_162_F3_PROSE_ONLY` comment INSIDE the function body (parity Part 2 requires it in the raw definition and absent after the `--[^\n]*` strip); keep all five arms; keep the existing comments' substance but do not write the phrase "contact support" in the new body's comments (the snapshot copies comments, and a comment would trip any case-insensitive snapshot pin; say "the legacy support pointer"). `COMMENT ON FUNCTION`, then re-assert `REVOKE ALL ... FROM PUBLIC, anon, authenticated; GRANT EXECUTE ... TO service_role;` (CREATE OR REPLACE preserves ACLs, but the house style is symmetric re-assertion with a positive arm).
- **Self-verify block must be CATALOGUE/FUNCTION-ONLY** (`scripts/lint-migration-data-dependence.mjs` refuses a `DO` block that reads an application table and raises on it; it has NO opt-out). Calling the IMMUTABLE function and `pg_get_functiondef`/`has_function_privilege` are fine. Assert: each of the 4 changed arms equals its new literal; none contains `contact support` (case-insensitive); `orphaned` unchanged; `computation_error_copy(NULL) = ` ELSE text; `has_function_privilege('service_role', ..., 'EXECUTE')` true and `anon` false.
- **Auto-apply:** merge to main with a migration -> `apply-test` then PROD `apply` with no human gate (CLAUDE.md, 2026-09-23). migration-reviewer and rls-policy-auditor are required clean before merge (CONTEXT, founder rule). Neither agent definition was found in this repo (`.claude/agents` absent) or in the user agents directory listing, so their checklists were NOT observed in this research; the planner must schedule both reviews and not assume their expectations. Expectations that WERE observed: `migration-policy.yml` (timestamp vs PROD tip), `lint-migration-data-dependence.mjs` (catalogue-only self-verify), and `src/__tests__/raise-exception-concat-grammar.test.ts`, which walks EVERY migration file and fails a `RAISE` whose format slot is a `||`-concatenated literal chain — the new self-verify block's `RAISE EXCEPTION` messages must be a single literal or dollar-quoted (pass values as `%` args).

### Census plan (what moves, what does not) [all measured]
| Item | Moves? | Detail |
|------|--------|--------|
| `supabase/schema/functions/computation_error_copy.sql` | YES | regenerate with `npm run schema:functions`; `-- source migration:` line changes to the new file. `schema:functions:check` (CI `sql-function-snapshot.yml`) gates it |
| `supabase/schema/baseline.sql`, `baseline-carried-migrations.txt`, `BASELINE.md` | NO (same PR) | The lane REPLAYS migrations the marker does not carry (D-F); the marker lists carried files only through `20261124120700...`. Re-dump is automated AFTER the PROD apply (`redump-dump`/`redump-pr` jobs, e.g. #1317, #1326). Do not hand-edit the dump |
| `scripts/baseline-content-drift-check.mjs` | no edit | will report `DRIFT computation_error_copy/1` until the post-apply re-dump; precedent comments say "EXPECTED until that re-dump, and NO allowlist row was added". `COMPARED_FLOOR = 144` unchanged (no function added). Stale-baseline drift red counts as green (founder policy) |
| `scripts/mutation-floors.mjs` (`FILES_FLOOR = 93`, `ARMS_FLOOR = 1020`, `WAIVED_CEILING = 0` at HEAD) | NO if no SQL arm/file is added | read by symbol, never trust these numbers |
| `RED-UNDER-M` twins of the two pinned gates | NO change needed (MEASURED) | `test_sync_status_curated_sentence_survives.sql`: all 16 twins edit `20261003120000_sync_status_bridge_residues.sql`, none the copy migration. `test_sync_status_marked_refresh_protected.sql`: two twins (arm `0a`) edit `20260826120000_computation_error_curated_copy.sql` but only its header comment text (`PROTECTED MARKED REFRESH (mig 20260825150000, Phase 161.1 CR-01)`) and a closing comment string, never an arm; a later copy-only migration does not override them. Re-run `node scripts/mutation-runner/run.mjs --file <gate>` for both after the edit to confirm every arm still bites |
| `RED-UNDER-SETUP` of the two pinned gates | YES | append the new migration file (after `20260826120000_...` in the list order; end of list is safe since only the function is redefined) in BOTH `test_sync_status_curated_sentence_survives.sql` and `test_sync_status_marked_refresh_protected.sql`. Without it the pg-lane applies only the old migration and the NEW literals fail the mutation runner's baseline GREEN check |
| `test_compute_jobs_error_kind_copy_parity.sql` | NO | do not edit, do not add the new migration to its setup. Its Part 3 asserts `permanent ILIKE '%will not resolve%'` and `orphaned ILIKE '%retry the sync%'` — both survive the new text |
| per-file section/arm pins (`src/__tests__/mutation-runner-floors.test.ts`, `mutation-annotation-parser.test.ts`) | NO (partly unverified) | they pin per-file section/judged/annotated/biting counts and annotated-file lists (read at the cited lines); the grep found no pin of a SETUP list's CONTENTS for these three files, but the full vitest suite is the verifier — run it, do not rely on this row |
| `ci.yml` "ALL N ARMS EXECUTED" sentinels | NO | literals only |
| `sql-gate-lint` (`node scripts/lint-sql-gates.mjs --self-test`, 7 rules), `lint-migration-data-dependence`, `check-baseline-currency --replay-set` | run, no edit | new migration is function-only; self-verify catalogue-only |
| sentinel in `docs/sql-gate-lineage.md` | no | |

If the orchestrator widens scope to `first_hop_enqueue_sweep` (Open Question 3), then `test_first_hop_enqueue_sweep.sql`'s `c_sentence` and its SETUP list move too, and that file's 25 RED-UNDER-M twins need a bite re-check; plan it as a separate, later step.

## ERRC-02 (benchmark)

**Exits of `get_benchmark_returns`** (`analytics-service/services/benchmark.py`) [VERIFIED]: (a) fresh cache hit -> `(series, False)`; (b) fetched-and-merged covers the window -> `(series, False)`; (c) fetched but window not covered -> `(series, True)` ("Serving it flagged stale"); (d) fetch raised, recent cache within 48h -> `(fallback series, True)` via `_stale_cache_fallback`; (e) fetch raised and no recent cached day -> `(None, True)` ("All benchmark sources failed: ... Returning None."). ERRC-02 is exit (e). Do NOT change the service's return contract (`tests/test_benchmark.py::test_get_benchmark_returns_returns_none_when_all_sources_fail`, `test_cache_older_than_48h_and_failed_fetch_still_answer_none`, and `tests/test_benchmark_refresh.py` all pin `(None, True)`).

**Router block** (`analytics-service/routers/portfolio.py`, `_compute_portfolio_analytics`) [VERIFIED]: constants

```python
BENCHMARK_NOTE_STALE = "benchmark unavailable: stale"
BENCHMARK_NOTE_THIN = "benchmark unavailable: fewer than 30 shared days"
BENCHMARK_NOTE_ERROR = "benchmark unavailable: computation failed"
```
and `if benchmark_rets is None or benchmark_stale: benchmark_note = BENCHMARK_NOTE_STALE`. The comparison dict then carries `"stale": benchmark_note == BENCHMARK_NOTE_STALE` and `"note": benchmark_note`; `data_quality` carries `"benchmark_unavailable": benchmark_note is not None` and `"benchmark_note": benchmark_note`. Fix: add `BENCHMARK_NOTE_NO_SOURCE = "benchmark unavailable: no price source"`; split the condition (`if benchmark_rets is None: NO_SOURCE; elif benchmark_stale: STALE`). `stale` becomes `False` for NO_SOURCE with no further edit (the `==` already makes it True only for STALE). Persisted: `portfolio_analytics.benchmark_comparison` (JSONB, no CHECK on `note`) and `data_quality.benchmark_note` (no SQL/TS closed set — grep of migrations/tests found none). Persist payload: `update_payload` in `_compute_portfolio_analytics` carries `"benchmark_comparison": benchmark_comparison` (routers/portfolio.py ~line 1266) and the `data_quality` dict. `generate_narrative` (`services/portfolio_optimizer.py`) emits benchmark wording ONLY on `analytics.get("benchmark_error")` ("Benchmark comparison unavailable"), i.e. the exception exit, never for stale or no-source, so it is not a user-visible surface for this change. Strategy-level `analytics_runner.py` writes a different `benchmark_note` ("Benchmark data unavailable.") for strategies — a separate surface, out of ERRC-02.

**Frontend (measured, contradicts CONTEXT's integration list):** `src/lib/portfolio-analytics-adapter.ts` `parseBenchmarkComparison` passes `note` through (conditional key) and `src/lib/types.ts` has the type, but `adaptPortfolioAnalytics` has NO non-test caller and no component reads `benchmark_comparison`. The card that did (`src/components/portfolio/BenchmarkComparison.tsx`: `note` rendered `stale ? "text-warning bg-warning-bg border border-warning-border ..." : "text-text-muted"`) was deleted in Phase 195 TRIM (`3ba04e9a0`). ScenarioComposer/ScenarioBenchmarkSection use client-side BTC closes from `/api/benchmark/btc/prices` and have no relation to this note; the factsheet PDF route tests only mention "benchmark unavailable" in a strategy name. DESIGN.md muted = `--color-text-muted` #64748B ("steady-state, honest-empty"); warning amber = "transient/recoverable" — an outage with no cached day is not transient-recoverable by the user, consistent with muted.

**Existing tests:** `analytics-service/tests/test_portfolio_benchmark_pairing.py` `TestNamedBenchmarkNotes` — `test_missing_benchmark_writes_the_named_stale_note` currently pins the exact conflation (`_compute(sb, benchmark=None, stale=True)` expects `NOTE_STALE` and `"stale": True`). It must be rewritten (it is the gate that "fails on today's single label"). `test_benchmark_crash_keeps_own_numbers...` uses `benchmark=None, stale=True` only as a no-arithmetic reference (still fine; it reads total_return_twr). Service-level exits: `tests/test_benchmark.py` (patches `services.benchmark.get_supabase`, `fetch_btc_daily_prices`, `db_execute`, `_utc_now`; helpers `_supabase_returning`, `_cache_rows`, `httpx_error`).
**Test shape recommended** (satisfies "drives both exits and tells them apart"): a new class in `test_portfolio_benchmark_pairing.py` that patches only the SOURCE layer (as `test_benchmark.py` does) so the REAL `get_benchmark_returns` produces exit (d) vs exit (e), runs `_compute_portfolio_analytics`, and asserts `note` is STALE/`stale True` vs NO_SOURCE/`stale False`, plus `benchmark_twr is None`, `partial_data is False` for both, and that the two notes differ. Also update `NOTE_*` constants there to import-or-quote the new constant.

## ERRC-03 (enqueue failure)

**Current tail** (`run_sync_trades_job`, `services/job_worker.py`, after the cursor epilogue): `_follow_on_kind = JOB_CHAIN_FOLLOW_ON["sync_trades"][0]`; `try: await db_execute(_enqueue_follow_on)`; `except Exception as exc:` logs, then `_mark_analytics_failed` upserts the five-key payload (`computation_status: "failed"`, `computation_warned: False`, `computing_started_at: None`, `computation_error: "Analytics enqueue failed during sync. The next scheduled sync will retry — contact support if this persists."`) with `on_conflict="strategy_id"`; function ends `return DispatchResult(outcome=DispatchOutcome.DONE, trade_count=0 if phase1_failed else len(trades))`. A very long comment block ("THIS WRITE IS ERASED ONE RPC LATER ...") documents the defect; rewrite it to the new truth (it will be false after the fix), keeping the "payload is deliberately UNSTAMPED" statement and the census pointer. Edit nothing above the `# Phase 18 root-cause fix` enqueue block.

**Bridge facts** (`supabase/schema/functions/sync_strategy_analytics_status.sql`, last re-based by `20261105120000_sync_status_protect_refused_derive.sql`) [VERIFIED]:
- `is_protected` is true only for (i) a `derive_broker_dailies` job with `read_refusal_kept_figures='true'` and figures, or (ii) `metadata->>'source' IN ('ledger-refresh','ledger-refresh-composite')` AND kind IN (`derive_broker_dailies`, `compute_analytics_from_csv`, `stitch_composite`) AND `v_publish_healthy`. A `sync_trades` job is never protected -> failed_final lands on branch (b).
- Branch (b): `INSERT ... VALUES (p_strategy_id, 'failed', computation_error_copy(v_latest_kind), NULL, NULL, NULL) ON CONFLICT DO UPDATE` — the writer's own sentence survives only when `computation_error_source = 'writer' AND computation_error_job_id = v_latest_job_id`; the payload is unstamped, so the bridge's `computation_error_copy(kind)` is what is stored ("the curated sentence"). Branch (b) clears `computing_started_at`.
- Branch (c) (all jobs done, no failure live): status `CASE ... WHEN complete_with_warnings OR computation_warned THEN 'complete_with_warnings' ELSE 'complete'`; `computation_error = NULL`; writes **no** `computed_at` (Phase 166.5), so the old "fresh vintage" claim in the TODOS entry no longer applies.
- `mark_compute_job_failed`: `permanent` -> `failed_final` on the first failure; `transient`/`unknown` -> `failed_retry` until `attempts >= max_attempts` then `failed_final`; kinds outside transient/permanent/unknown raise.
- A later `done` of the same (strategy, kind) supersedes a prior `failed_final` (per-kind created_at supersession), so a `permanent` sync_trades failure self-heals on the next successful sync.

**The published-case trap (measured by reading the code):** today, even though DONE is returned, `_mark_analytics_failed` has ALREADY set `computation_status='failed'`, `computation_warned=False`, `computing_started_at=NULL` on a published row. Branch (c) then reads `computation_warned` False and status 'failed' -> resolves to plain `'complete'`. A `complete_with_warnings` strategy therefore silently becomes `complete`; the figures survive but the publish state does not. Therefore the "published -> publish state preserved" half requires NOT executing the failed upsert in the published case (log the failure at ERROR and return DONE). Gate must seed `complete_with_warnings` in that case so a regression is visible.

**Edge (flag for the planner; MEASURED from the code comments, not executed):** `job_worker.py` (the "publish ORACLE" comment in `run_derive_broker_dailies_job`) states that bridge branch (a) "preserves 'complete_with_warnings'; it does NOT preserve plain 'complete'", and the bridge runs on EVERY mark RPC for the strategy. So a non-side job's mark (a derive/compute from an overlapping chain, or a ledger-refresh) landing while this `sync_trades` job is still `running` bounces a plain `complete` row to `computing`; the sync then reads `computing`, the verbatim predicate calls it unpublished, the FAILED path runs, and branch (b) unpublishes exactly the row the ruling protects. Whether such overlap occurs on PROD cron timing was NOT measured. The bridge's own published oracle treats a `computing` row WITH `metrics_json` as published (branch (a) can bounce a `complete` row to `computing`; see `_published_numbers_exist` in `run_derive_broker_dailies_job`, "Review R3-01"). The founder's ruling names only `complete`/`complete_with_warnings`. Following the ruling verbatim means a published strategy observed at `computing` with figures would take the FAILED path and be unpublished by branch (b). Reading `computing`+`metrics_json` as published too is a one-line extension of the same oracle and is the safer reading; it deviates from the ruling's literal wording, so it needs the orchestrator/founder (Open Question 4). Whatever the answer, the live gate must include a PLAIN `complete` published case and a `computing`-with-`metrics_json` case so the choice is pinned.

**Read semantics:** do the publish read inside the `except` arm, via `db_read_with_retry` (precedent). If the read itself fails: recommended fail-safe = treat as published (log `logger.exception`, return DONE, write nothing), so a read hiccup can never unpublish a live strategy; this equals today's DONE behaviour. [ASSUMED: planner/orchestrator to confirm.]

**Return value** (nothing-published): `DispatchResult(outcome=DispatchOutcome.FAILED, error_message=<constant operator text, scrubbed, no ids beyond strategy_id like the F1 return>, error_kind=<Open Question 2; recommended "transient">)`. `main_worker.py` (`dispatch_tick`) maps FAILED -> `mark_compute_job_failed` with `p_error_kind = kind or "unknown"` and DONE -> `mark_compute_job_done` [VERIFIED: main_worker.py `dispatch_tick` DONE/FAILED branches]. F1 precedent (derive insufficient-history exit, `run_derive_broker_dailies_job`) returns `error_kind="permanent"` for a different cause (an idle account does not grow history by retrying); that reasoning does not transfer to a transient enqueue fault. The follow-on kind in the diagram is `JOB_CHAIN_FOLLOW_ON["sync_trades"][0]`; its definition read this session is `"sync_trades": ("derive_broker_dailies",)` at `analytics-service/services/job_worker.py:1046` (dict opens at :1042).

**Existing offline tests that pin the old outcome (must be rewritten, not just extended)** in `analytics-service/tests/test_job_worker.py`: `test_sync_trades_enqueue_failure_does_not_fail_job` (asserts `DispatchOutcome.DONE`) and `test_enqueue_failure_marks_strategy_analytics_failed` (asserts DONE plus the failed upsert shape incl. `computation_warned is False`). Both use `mock_ctx.supabase = MagicMock()` — a new `.select().eq().maybe_single().execute()` read on a bare MagicMock returns a truthy MagicMock, so each case must script the publish read explicitly (one case with `data={"computation_status": "complete_with_warnings"}`, one with `None`/`{}`).

**Census file:** `tests/test_computation_error_provenance_census.py` — `EXPECTED_STAMPED_SITES: Final[int] = 9`, `EXPECTED_INERT_SITES: Final[int] = 1`, `PROVENANCE_INERT_KEYS` = {`strategy_id`, `computation_status`, `computation_warned`, `computing_started_at`, `computation_error`}. Keep the payload key set unchanged and nothing moves. Its header comment ("the handler returns DispatchOutcome.DONE ... When that lands, this site is re-stamped") becomes stale prose; update the comment only (founder ruling: counts stay).

**Test harness for "drive the failed enqueue through the bridge" (answer to Q5):** the bridge is plpgsql, so a real run needs a database. There is a live-lane Python harness precedent (psycopg + real PostgREST on the local-stack lane, gated by `LANE_DB_URL` / `SUPABASE_TEST_URL` / `SUPABASE_TEST_SERVICE_KEY`; skips locally when unset, FAILS in CI; loopback and stock-comment guards in `tests/live_db_dsn.py`; helpers in `tests/test_compute_jobs_fencing.py`; example `tests/test_computed_at_now_literal_live.py`). The CI `python` job boots that lane, so a live module runs in CI. Recommended: ONE new live module (e.g. `tests/test_sync_trades_enqueue_failure_bridge_live.py`) that seeds a throwaway auth user + strategy (own rows only), a `sync_trades` job row claimed through the real claim RPC, wraps the lane client in a thin proxy whose `.rpc("enqueue_compute_job")` raises and whose `.table(...)` and every other RPC pass through (stub only the persist RPC names the offline tests stub), runs the real `run_sync_trades_job` (patching `_exchange_preflight`, `fetch_all_trades`, `fetch_usdt_balance` exactly as the offline tests do), then applies the SAME mapping `dispatch_tick` uses (DONE -> `mark_compute_job_done`, FAILED -> `mark_compute_job_failed` with the result's kind and the job's `claim_token`) and reads `strategy_analytics`. Case A: no row -> expect `computation_status == 'failed'` and `computation_error` equal to a literal copy of the curated sentence for the chosen kind (spelled literally, never `computation_error_copy(...)`, per the house rule in the bridge tests); seed the job row with `attempts = max_attempts` if the kind is transient. Case B: seeded `complete_with_warnings` row with `computation_warned=True` -> expect status still `complete_with_warnings`, `computation_error IS NULL`. Offline unit tests cover outcome/kind/upsert shape without a lane. FALLBACK if driving the real handler against the lane proves impractical (UNPROVEN recipe: the handler's persist RPCs and `_exchange_preflight` are stubbed in the offline tests, but nobody has run the real handler against the lane client): capture `DispatchResult` and the exact `strategy_analytics` upsert payload OFFLINE with the existing mock harness, then replay that payload as a real upsert and apply the same mark RPC (`mark_compute_job_done` / `mark_compute_job_failed`) on the lane and read the row. That still drives the real bridge and the real stored row. Do NOT add a new `supabase/tests` file for this (it would move FILES_FLOOR/ARMS_FLOOR and the per-file census pins for no extra coverage).

## Runtime State Inventory

This is a string-replacement phase; the canonical question is what still carries the old string after every file is updated.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | **`strategy_analytics.computation_error` rows already written on PROD (and `portfolio_analytics.benchmark_comparison.note` / `data_quality.benchmark_note` JSON) keep the old sentences.** The migration changes the function only; the bridge writes the copy at transition time, so existing `failed` rows keep "contact support" until their next failure/recompute. The count of affected rows is UNMEASURED (no PROD read was made; the read would be MCP-first, marker query first, counts only). Stored benchmark notes: old rows keep "benchmark unavailable: stale" even where the true cause was an outage; they refresh on the next portfolio compute | **Founder question:** backfill (a data UPDATE would be a PROD write and a second migration that must be data-tolerant per `lint-migration-data-dependence`) or leave until the next recompute/failure. Default: leave, record in CHANGELOG, optionally measure the count read-only first |
| Live service config | Railway analytics deploy: the five Python strings and the ERRC-03 handler change reach users only after the Railway redeploy of the merged SHA (deploys only after main CI is green); until then PROD runs the old strings and the old DONE outcome while the new SQL copy is already live | none in code; sequence note for the ship/land step |
| OS-registered state | None — verified: no cron/launchd/task embeds these sentences. `scripts/prod-prober/cron-manifest.json` quotes only the reaper's own sentence ("Analytics was interrupted before it could finish and did not recover. Retry the sync."), which is not changed. pg_cron jobs call functions, not these literals | none |
| Secrets / env vars | None — verified: no secret or env var name references these strings | none |
| Build artifacts / installed packages | `supabase/schema/functions/computation_error_copy.sql` (regenerate), `supabase/schema/baseline.sql` (carries the old arms until the automated post-apply re-dump; do not hand-edit), the Python venv/CI image (no stale artifact); `.next`/coverage output irrelevant | regenerate the snapshot; leave baseline to the re-dump |

## Common Pitfalls

### Pitfall 1: SQL gate literal moves but the mutation lane does not see the new migration
**What goes wrong:** the two pinned gates go RED in the mutation runner's baseline step (old function body in the pg-lane) while green in `sql-tests` (replay).
**How to avoid:** append the new migration to both files' `RED-UNDER-SETUP`; run `node scripts/mutation-runner/run.mjs --file supabase/tests/<file>` (DIAGNOSTIC mode, exits non-zero by design; read the `biting` line) for both.
**Warning signs:** `occurrence-mismatch`/baseline-not-GREEN defects naming those files.

### Pitfall 2: Touching the parity gate
Adding the new migration to `test_compute_jobs_error_kind_copy_parity.sql`'s setup makes its arm 2/A-3 and 3/F-3 mutations (edits to the OLD migration file) no-ops -> "annotation does not bite", exit 1. Leave that file alone.

### Pitfall 3: The canary token
Dropping `CANARY_162_F3_PROSE_ONLY` from the new function body reds parity Part 2 in the `sql-tests` lane (full replay sees the new body). Keep it as a comment inside the body.

### Pitfall 4: Snapshot parser vs comments
The vitest `ELSE` regex must not match prose. Keep any comment word "ELSE" lowercase or not followed by a newline + quote, and keep the ELSE arm's sentence free of apostrophes (`[^']+`).

### Pitfall 5: Returning FAILED while still running the destructive upsert in the published case
See ERRC-03 trap. Skip the upsert when published.

### Pitfall 6: Making the benchmark note change a frontend task
There is no renderer; do not resurrect `BenchmarkComparison.tsx` without a decision (Phase 195 deleted `/portfolios`). See Open Question 1.

### Pitfall 7: Wizard exemption text drift
`wizardErrors.ts` and `wizardErrors.test.ts` quote the exchange.py string; update both with the Python edit.

### Pitfall 8: Naive grep gates
SC-1 on raw grep trips on the `job_worker.py` comment and the test docstring and misses split literals; use the AST scan.

## Code Examples

### csv-finalize oracle parser (restore; Source: git `026e1d761^:src/app/api/strategies/csv-finalize/route.test.ts`)
```ts
const CURATED_DEFAULT_COPY: string = (() => {
  const path = resolve(process.cwd(), "supabase/schema/functions/computation_error_copy.sql");
  const sql = readFileSync(path, "utf8");
  const arm = sql.match(/\bELSE\s*\n\s*'([^']+)'/);
  if (!arm) throw new Error(`WR-07 oracle: could not parse the ELSE arm out of ${path}. ...`);
  return arm[1];
})();
```
(`readFileSync`/`resolve` imports were `import { readFileSync } from "node:fs"` and `resolve` from `node:path` in that file.)

### Router benchmark split (shape)
```python
BENCHMARK_NOTE_NO_SOURCE = "benchmark unavailable: no price source"
...
benchmark_rets, benchmark_stale = await get_benchmark_returns("BTC", since=_bench_since)
if benchmark_rets is None:
    benchmark_note = BENCHMARK_NOTE_NO_SOURCE      # exit (e): (None, True)
elif benchmark_stale:
    benchmark_note = BENCHMARK_NOTE_STALE          # exits (c)/(d)
else:
    ...
```

## State of the Art
| Old | Current | Impact |
|-----|---------|--------|
| csv-finalize oracle parsed from SQL (pre-Phase 212) | hand-typed (212, parity deliberately broken) | 222 restores the SQL read |
| Bridge stamped `computed_at` on branch (c) | runner-only stamp (166.5) | the TODOS "fresh vintage" claim is obsolete; the remaining erasure is status/error/warned |
| `BenchmarkComparison` card renders the note | card deleted (195 TRIM) | no live renderer |

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | transient/unknown arm wording "Retry the sync, or use the contact form if it keeps failing." | ERRC-01 | wording not quoted verbatim in CONTEXT; founder may prefer different text |
| A2 | exchange.py / csv_validator / `_mark_analytics_failed` / `_fail_vr` replacement sentences by mechanical substitution | ERRC-01 Python table | wording drift vs founder intent ("two judgement strings as proposed" in the discussion log are not recorded verbatim) |
| A3 | recommended `error_kind` and fail-safe read behaviour in ERRC-03 | ERRC-03, Open Q2 | changes the stored sentence and retry cost |
| A5 | the live-lane harness recipe (proxy client around the real handler) works as described | ERRC-03 | fall back to the capture-and-replay recipe |
| A6 | overlap of a non-side job mark with a running sync_trades is possible on PROD cron timing | ERRC-03 edge | if impossible, the status-pair predicate is sufficient |
| A4 | no UI consumer of `get_user_compute_jobs.user_message` / the role-change RAISE (grep only) | ERRC-01 survivors | if a consumer exists those arms are in scope |

## Open Questions

1. **ERRC-02 has no page to render the muted note.** `BenchmarkComparison.tsx` was deleted (195 TRIM); `adaptPortfolioAnalytics` has no caller. What we know: Python wire will carry `stale: false` + the new note (muted under the old rule by construction). Unclear: whether the founder's "page renders it muted" is satisfied by the wire contract + an adapter-level test (recommended: pin in `portfolio-analytics-adapter.test.ts` that a NO_SOURCE comparison round-trips `stale:false` and the note, so any renderer applying "amber iff stale" shows muted), or requires resurrecting a card. Recommendation: wire + adapter pin, record the finding in the SUMMARY and CHANGELOG, delete the TODOS entry; ask the orchestrator to confirm.
2. **Which `error_kind` for the nothing-published FAILED, i.e. which sentence is "the curated sentence"?** FOUNDER PICK NEEDED. Measured: `main_worker` sends `p_error_kind = kind or "unknown"`, and the payload stays unstamped, so what is stored is `computation_error_copy(kind)` for kind in permanent / transient / unknown. NEITHER the handler's own sentence (the bridge overwrites it on branch (b)) NOR the ELSE sentence (reachable only for NULL/unmodelled kinds, which `mark_compute_job_failed` refuses) can be the stored text. Options: (i) `permanent`: immediate `failed_final`, stored text "...retrying alone will not resolve it. Use the contact form if you need this strategy computed." — UNTRUE for this failure (the next successful sync supersedes the `failed_final`, and a user retry works), so it must not be the default in a phase about true-cause copy. (ii) `transient` (or `unknown`): `mark_compute_job_failed` reads `attempts`/`max_attempts` off the job row (`IF p_error_kind = 'permanent' THEN failed_final ELSIF v_attempts >= v_max_attempts THEN failed_final ELSE failed_retry`, `supabase/schema/functions/mark_compute_job_failed.sql` lines ~82-89), so a live gate that seeds the job row with `attempts = max_attempts` terminalises it with ONE FAILED mark and the stored text is the honest "Analytics could not complete after several automatic retries. Retry the sync, or use the contact form if it keeps failing." In production the job would instead be retried (re-running the exchange sync up to `max_attempts`, each re-attempting the enqueue) and the row reads `computing` between attempts; bounded to never-published strategies by the ruling. RECOMMENDATION: (ii) `transient`, with the founder confirming the stored sentence and the retry cost. The testability objection to (ii) does not hold.
3. **Scope of "every SQL error sentence".** `first_hop_enqueue_sweep.c_named_state_copy` (user-visible `computation_error`) says "contact support" and was added after the TODOS census (Phase 227). Recommendation: default OUT of this migration (locked decision names the `computation_error_copy` arms; re-basing a second SECURITY DEFINER function widens blast radius and its 25-arm gate); the orchestrator should confirm and, if deferred, book a TODOS entry in the ship PR.
4. **Published oracle width** (status pair only, per the ruling, vs also `computing`+`metrics_json`). Unmeasured whether the overlap occurs on PROD; the bridge's own oracle includes `computing`+`metrics_json`. Recommendation: include it (safer; strictly narrows the FAILED path), flagged as a deviation from the ruling's wording for confirmation.
5. **Optional TS fixture refresh** (composite/transient fixtures that claim to be "verbatim" from the migration). Recommend refreshing the two `SyncPreviewStep` fixtures and the paired negative assertion so the "copied verbatim" comments stay true.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node | vitest, tsx, mutation runner | yes | v25.8.1 (engines >=22) | — |
| `node_modules` in the worktree | vitest | yes | present | — |
| Python 3.12 + pinned deps | pytest/mypy as CI | no `.venv` in this worktree; global python is 3.14.3 with ccxt 4.5.64 (NOT the pinned 4.5.89) | — | `cd analytics-service && make install` (3.12 venv via `uv`, `uv` present at /opt/homebrew/bin/uv); sibling worktrees have a working 3.12.13 venv with ccxt 4.5.89 (do not use the main checkout's) |
| Docker (daemon) | `scripts/local-stack/run.sh up` lane for live Python gates | yes (Server running, 0 containers) | 29.9.2 | skip locally; CI runs it |
| Supabase CLI | local-stack lane | yes | on PATH (linked to PROD: never `db push`) | — |
| PostgreSQL 16 binaries | `scripts/pg-lane/run.sh` mutation runner | yes | `/opt/homebrew/opt/postgresql@16/bin` (`--print-pgbin` OK) | pg_cron must be preloaded; lane handles it |
| psql | SQL gates | yes | /opt/homebrew/bin/psql | — |

**Missing with fallback:** pinned Python venv (create it). Nothing blocks.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Frameworks | pytest 9 (CI py3.12, asyncio_mode=auto) in `analytics-service/`; vitest at repo root; psql SQL gates via the local-stack lane (`sql-tests`) and pg-lane mutation runner |
| Config | `analytics-service/pytest.ini`, `vitest.config.ts`, `scripts/mutation-runner/` |
| Quick run | `cd analytics-service && .venv/bin/pytest tests/<file>.py -x -q`; `npx vitest run <file>` |
| Full suite | CI commands in Standard Stack; `npm test`; `node scripts/mutation-runner/run.mjs` (full, exits 0 only with no defects) |

### Phase Requirements -> Test Map
| Req | Behaviour | Type | Command | File |
|-----|-----------|------|---------|------|
| ERRC-01 | no Python user string says contact support; each names the contact form | pytest (AST scan + exact pins) | `cd analytics-service && .venv/bin/pytest tests/test_no_contact_support_copy.py -x` | NEW (Wave 0) |
| ERRC-01 | snapshot arms: none says contact support; each non-orphaned arm names the contact form | vitest | `npx vitest run src/app/api/strategies/csv-finalize/route.test.ts` (or a sibling pin) | extend existing |
| ERRC-01 | csv-finalize copy byte-equals the SQL ELSE arm, oracle READ from `supabase/schema/functions/computation_error_copy.sql` | vitest | `npx vitest run src/app/api/strategies/csv-finalize/route.test.ts` | exists, rewrite oracle |
| ERRC-01 | live function returns the new permanent sentence through the bridge | SQL gates (literal moved) | CI `sql-tests`; locally `bash scripts/local-stack/run.sh up` then `psql -v ON_ERROR_STOP=1 -f supabase/tests/test_sync_status_curated_sentence_survives.sql` and `..._marked_refresh_protected.sql` | exist, edit literals + setup lists |
| ERRC-01 | snapshot not drifted | script | `npm run schema:functions:check` | exists |
| ERRC-01 | wizardErrors exemption quote updated | vitest | `npx vitest run src/lib/wizardErrors.test.ts` | exists, edit |
| ERRC-02 | (None,True) exit -> NO_SOURCE note, `stale False`; (series,True) exit -> STALE, `stale True`; distinct | pytest | `cd analytics-service && .venv/bin/pytest tests/test_portfolio_benchmark_pairing.py tests/test_benchmark.py -x` | exists, rewrite one case, add a class |
| ERRC-02 | adapter round-trips NO_SOURCE with `stale:false` | vitest | `npx vitest run src/lib/portfolio-analytics-adapter.test.ts` | exists, add case |
| ERRC-03 | published -> DONE and no failed upsert; nothing published -> FAILED(kind) with unchanged five-key payload | pytest (offline) | `cd analytics-service && .venv/bin/pytest tests/test_job_worker.py -k enqueue_failure -x` | exists, rewrite two cases |
| ERRC-03 | through the real bridge: A -> `failed` + curated sentence; B `complete_with_warnings` preserved | pytest live lane | `cd analytics-service && LANE_DB_URL=... SUPABASE_TEST_URL=... SUPABASE_TEST_SERVICE_KEY=... .venv/bin/pytest tests/test_sync_trades_enqueue_failure_bridge_live.py -x` (skips locally without the lane, FAILS in CI without it) | NEW (Wave 0) |
| ERRC-03 | payload census unchanged | pytest | `cd analytics-service && .venv/bin/pytest tests/test_computation_error_provenance_census.py -x` | exists, comment-only edit |
| all | mypy strict | mypy | CI command above | — |

### Sampling Rate
- Per task commit: the single named test file for that task.
- Per wave merge: `pytest tests/test_job_worker.py tests/test_portfolio_benchmark_pairing.py tests/test_benchmark.py tests/test_computation_error_provenance_census.py tests/test_live_db_reach_roster.py`, `npx vitest run src/app/api/strategies/csv-finalize src/lib/wizardErrors.test.ts src/lib/portfolio-analytics-adapter.test.ts`, mypy, `npm run schema:functions:check`, `node scripts/lint-sql-gates.mjs --self-test`, `node scripts/lint-migration-data-dependence.mjs`.
- Phase gate: full pytest + vitest + the two mutation-runner `--file` runs green; then the review lane (migration-reviewer + rls-policy-auditor clean).

### PROOF-01 plan (neuter target -> expected named RED -> restore by `cp` + `cmp`)
| Gate | Neuter | Expected first RED |
|------|--------|--------------------|
| Python SC-1 AST scan | re-insert "Contact support" into the `services/exchange.py` string (byte backup first) | scan names `services/exchange.py` |
| Python exact pins | revert one of the five strings | that string's pin names it |
| csv-finalize parity | edit the SQL snapshot ELSE arm (or the route constant) by one word | parity case fails with the two strings in the diff; the anti-vacuity case stays green |
| snapshot arm pin | restore "contact support" in the `permanent` arm of the snapshot copy | pin names the `permanent` arm |
| SQL literal gates (lane) | in the migration, revert the `permanent` arm | `test_sync_status_curated_sentence_survives.sql` raises on its `c_perm` check; `RED-UNDER-M` runs prove the setup list loads the new file |
| ERRC-02 router | restore `or benchmark_stale` single-label condition | the "distinct exits" test fails naming NO_SOURCE vs STALE |
| ERRC-03 offline | restore unconditional `DispatchOutcome.DONE` | nothing-published case fails (outcome); then separately remove the published guard (always FAILED, or always upsert) | published case fails (outcome / upsert present) |
| ERRC-03 live | same neuters | Case A reads `complete`/NULL (the lie); Case B reads `complete` instead of `complete_with_warnings` |
Record each RED output verbatim in the plan SUMMARY (SC-6).

### Wave 0 Gaps
- [ ] `analytics-service/tests/test_no_contact_support_copy.py` — ERRC-01 Python gate
- [ ] `analytics-service/tests/test_sync_trades_enqueue_failure_bridge_live.py` — ERRC-03 through-the-bridge gate (reuse `live_db_dsn`/fencing helpers; no roster entry needed because it is lane-runnable)
- [ ] pinned Python venv in the worktree (`make install`)
- Existing infrastructure covers the rest.

## Security Domain

`security_enforcement` is not set to false in `.planning/config.json` (absent = enabled).

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2/V3 Authentication/Session | no | — |
| V4 Access Control | yes (SQL function ACL) | re-assert `REVOKE ALL ... FROM PUBLIC, anon, authenticated; GRANT EXECUTE ... TO service_role` and assert it in the self-verify block; function stays non-SECURITY-DEFINER, `SET search_path = pg_catalog` |
| V5 Input Validation | yes | `computation_error_copy` takes a KIND, never an error string (range = fixed literals); keep it. Python error text stays constant; never `str(exc)` into user fields |
| V7 Error handling / logging | yes | user copy carries no operator detail; operator `error_message` for the FAILED return is a constant with the strategy id only (as F1) |
| V6 Cryptography | no | — |

| Threat | STRIDE | Mitigation |
|--------|--------|------------|
| Free text reaching `computation_error` | Tampering/Info disclosure | fixed-literal arms; unchanged signature and totality (NULL -> ELSE) |
| Over-revoked/under-revoked EXECUTE after rebase | Elevation | symmetric ACL re-assertion + positive/negative verify arms |
| Public-repo leakage in docs/SUMMARY | Info disclosure | no PROD ids, secrets or home paths in tracked text |
| A systematic enqueue fault unpublishing live strategies | Denial of service (availability) | the published guard (DONE, no destructive upsert) |

## Write-scope fences (answer to Q6)
- **Edit in `services/job_worker.py`:** the enqueue-failure block from the `# Phase 18 root-cause fix` comment through the final `return DispatchResult(...)` of `run_sync_trades_job` (the `_follow_on_kind` try/except, `_mark_analytics_failed`, the long comment), and the single literal in `run_stitch_composite_job`'s `_max_members` branch (`_stamp_failed(...)` "or contact support to raise the limit").
- **DO NOT touch:** the Phase-1 daily-P&L store, the phase2 flag block (`needs_flag_write`, `phase2_*`, `phase1_failed_at`), the cursor read, `advance_fetched_cursor`, `_advance_cursor` / `advance_sync_cursor` epilogue — Phase 251 SYNCSTORE (ROADMAP: "Depends on: Phase 222 (it reorders `run_sync_trades_job`)") and the merged 232 OKXTRADES work own them. `phase1_failed` is READ by the final return; leave the expression `trade_count=0 if phase1_failed else len(trades)` as is on the DONE path.
- **`services/csv_validator.py`:** only the `"message"` f-string literal in the percent-form auto-normalize block (240 CONNECTTRUTH merged; nothing else).
- **`routers/portfolio.py`:** the `BENCHMARK_NOTE_*` constants, the note block in `_compute_portfolio_analytics`, and the `_fail_vr("Verification failed. ...")` literal in `verify_strategy` (236 FIGUREMATH shares the file; verify its merge state at re-base time).
- **`services/exchange.py`:** only the `VALIDATION_UNEXPECTED` `result["error"]` literal.
- **Comment-only edits** (optional, outside the fence strictly): the `job_worker.py` comment that quotes "Contact support" in the derive handler. Prefer leaving it and using the AST scan.

## Sources

### Primary (HIGH — read this session)
- `supabase/migrations/20260826120000_computation_error_curated_copy.sql` (function def, ACL, comment), `supabase/schema/functions/computation_error_copy.sql`, `supabase/schema/functions/sync_strategy_analytics_status.sql` (is_protected, branches b / b-prime / c), `supabase/schema/functions/mark_compute_job_failed.sql`
- `supabase/tests/test_compute_jobs_error_kind_copy_parity.sql`, `test_sync_status_curated_sentence_survives.sql`, `test_sync_status_marked_refresh_protected.sql`
- `analytics-service/services/job_worker.py`, `services/benchmark.py`, `routers/portfolio.py`, `services/exchange.py`, `services/csv_validator.py`, `main_worker.py`, `tests/test_job_worker.py`, `tests/test_portfolio_benchmark_pairing.py`, `tests/test_benchmark.py`, `tests/test_computation_error_provenance_census.py`, `tests/conftest.py`, `tests/live_db_dsn.py`, `tests/test_computed_at_now_literal_live.py`, `tests/test_live_db_reach_roster.py`
- `src/app/api/strategies/csv-finalize/route.ts` + `route.test.ts`, `src/components/contact/ContactPointerText.tsx`, `src/lib/portfolio-analytics-adapter.ts` + test, `src/lib/wizardErrors.ts` (+test), `DESIGN.md`
- `.github/workflows/ci.yml` (python job, sql-tests), `.github/workflows/migration-policy.yml`, `supabase/schema/BASELINE.md`, `scripts/lint-migration-data-dependence.mjs`, `scripts/baseline-content-drift-check.mjs`, `scripts/mutation-runner/GRAMMAR.md`, `scripts/mutation-floors.mjs`
- git history: `026e1d761` (Phase 212, old oracle parser), `3ba04e9a0` (Phase 195, `BenchmarkComparison.tsx` deletion)
### Secondary / Tertiary
- None (no web sources needed; no external packages).

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH (no new packages)
- Architecture / census: HIGH (greps and file reads at HEAD; floors read by symbol only)
- Pitfalls: HIGH for SQL-lane and published-case traps (derived from reading the code paths); MEDIUM for Open Questions 2 and 4 (design choices)

**Research date:** 2026-11-25
**Valid until:** 2026-12-02 (the migration lane order and 225 PR-3 move the latest-migration timestamp; re-measure floors and the latest migration filename at PR time)
