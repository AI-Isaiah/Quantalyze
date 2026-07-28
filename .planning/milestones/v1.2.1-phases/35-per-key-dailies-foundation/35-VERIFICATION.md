---
phase: 35-per-key-dailies-foundation
verified: 2026-06-24T17:30:00Z
status: passed
score: 4/4 must-haves verified
overrides_applied: 0
---

# Phase 35: Per-key dailies foundation — Verification Report

**Phase Goal:** A per-key dailies store keyed by `api_key_id` exists, the broker-dailies derive job runs per allocator exchange key on the dense ~365-row calendar, and existing keys are backfilled — under an RLS-reviewed migration.
**Verified:** 2026-06-24T17:30:00Z
**Status:** PASSED
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | DAILIES-01: `csv_daily_returns` carries an `api_key_id` axis, resolving strategy_id NOT NULL FK blocker without synthetic strategy rows | VERIFIED | `20260624120000_csv_daily_returns_per_key_axis.sql` lines 27–60: strategy_id made nullable, surrogate PK added, api_key_id + allocator_id columns added, XOR check `num_nonnulls(strategy_id, api_key_id) = 1`, two NON-partial unique indexes (strategy_date_key + api_key_date_key); no synthetic strategy INSERT anywhere in backfill or derive job |
| 2 | DAILIES-02: `run_derive_broker_dailies_job` is generalized to allocator-key-scoped, deriving realized+funding dailies per key on the dense ~365-row calendar | VERIFIED | `job_worker.py` lines 1745–1901: `is_key_mode = bool(job.get("api_key_id"))`, key branch uses `_allocator_key_preflight`, `allocator_id = ctx.key_row["user_id"]`, upserts `{api_key_id, allocator_id, strategy_id:None}` on `on_conflict="api_key_id,date"`, skips both `compute_analytics_from_csv` enqueue and `strategy_analytics` stamp; strategy path byte-unchanged |
| 3 | DAILIES-03: Existing allocator exchange keys are backfilled (script is correct and tested; prod backfill is a post-merge manual operator step) | VERIFIED | `scripts/phase35_backfill_enqueue.py` exists: targets active+non-revoked+connected keys via `.or_("sync_status.is.null,sync_status.neq.revoked")` (NULL-inclusive), builds api_key-scoped jobs with no strategy_id, pre-check guard for idempotency, atomic bulk INSERT with 23505-catch; 10-test suite in `test_phase35_backfill_enqueue.py` covers all branches |
| 4 | DAILIES-04: RLS scopes per-key dailies to the owning allocator (no cross-tenant read), proven by a test that ACTUALLY RUNS IN CI | VERIFIED | `supabase/tests/test_csv_daily_returns_perkey_rls.sql` (commit cc25bfb2): 7 assertions (A→A own row, A↛B cross-tenant, strategy-policy non-leak, B→B, B↛A, anon=0, coherence-trigger rejects mismatched allocator_id, XOR rejects both-set); no psql meta-commands (grep clean); auto-discovered by sql-tests job via `test_*.sql` glob, run under `psql -v ON_ERROR_STOP=1` with `TEST_SUPABASE_DB_URL` |

**Score:** 4/4 truths verified

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `supabase/migrations/20260624120000_csv_daily_returns_per_key_axis.sql` | Dual-axis schema: surrogate PK, nullable strategy_id, api_key_id + allocator_id, XOR check, two non-partial unique indexes, per-key owner RLS policy, owner-coherence trigger | VERIFIED | File exists, 176 lines; all DDL elements present + self-verifying DO block; applied to TEST project (commit a365b984) |
| `supabase/migrations/20260624120100_derive_broker_dailies_api_key_coherence.sql` | `compute_jobs_kind_target_coherence` gains api_key arm for `derive_broker_dailies` while preserving strategy arm | VERIFIED | File exists, 57 lines; both arms present (line 25: strategy arm, line 29: api_key arm); self-verifying DO block asserts both arms; applied to TEST |
| `supabase/tests/test_csv_daily_returns_perkey_rls.sql` | SQL RLS test auto-discovered by CI sql-tests job | VERIFIED | 193 lines; no banned psql meta-commands (`\!`, `\copy`, `\o`); 7 assertions using `RAISE EXCEPTION` on failure; commit cc25bfb2 |
| `analytics-service/services/job_worker.py` | Dual-mode `run_derive_broker_dailies_job` | VERIFIED | Lines 1716–1915; key-mode branch complete with authoritative allocator_id sourcing, correct conflict target, no strategy side-effects; strategy-mode byte-unchanged |
| `analytics-service/scripts/phase35_backfill_enqueue.py` | Idempotent per-key derive backfill over active/non-revoked/connected keys | VERIFIED | 186 lines; NULL-inclusive sync_status filter, pre-check guard, atomic bulk INSERT, 23505-safe, fail-loud (non-zero exit on any skip) |
| `analytics-service/tests/test_derive_broker_dailies_dualmode.py` | DAILIES-02 unit proofs (mutation-falsifiable) | VERIFIED | 272 lines; 5 tests: key-mode payload/conflict-target/allocator-wiring + no-CSV-enqueue + <2-day no-stamp; strategy-mode non-regression + <2-day failed stamp |
| `analytics-service/tests/test_phase35_backfill_enqueue.py` | DAILIES-03 unit proofs | VERIFIED | 10 tests including NULL-sync_status inclusion filter (load-bearing), api_key-scoped pre-check, idempotent skip, fail-loud branches |
| `analytics-service/tests/test_csv_daily_returns_dualaxis_live.py` | DAILIES-01 DDL live proofs | VERIFIED (skips in Python CI — correct behavior) | Gated on TEST_SUPABASE_DB_URL, which Python CI job does NOT set; skips cleanly; behavioral proofs provided by the migration's self-verifying DO block and the SQL test |
| `analytics-service/tests/test_csv_daily_returns_perkey_rls_live.py` | DAILIES-04 psycopg live RLS probe | VERIFIED (skips in Python CI — expected) | Gated on TEST_SUPABASE_DB_URL; the SQL test (`test_csv_daily_returns_perkey_rls.sql`) is the real CI gate |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| Backfill script | `compute_jobs` table | `api_key_id + kind='derive_broker_dailies'`, no strategy_id | WIRED | `phase35_backfill_enqueue.py` lines 122–130: payload sets api_key_id, kind, status, next_attempt_at; never sets strategy_id (enforced by coherence constraint) |
| `run_derive_broker_dailies_job` key-mode | `csv_daily_returns` | `on_conflict="api_key_id,date"` | WIRED | `job_worker.py` lines 1855–1866: key-mode rows carry `{api_key_id, allocator_id, strategy_id:None}`, conflict target `api_key_id,date` — resolves to `csv_daily_returns_api_key_date_key` index |
| `run_derive_broker_dailies_job` key-mode | allocator_id source | `ctx.key_row["user_id"]` (NOT job payload) | WIRED | `job_worker.py` line 1758: `allocator_id: str = ctx.key_row["user_id"]`; the owner-coherence trigger enforces this at DB write time |
| `run_derive_broker_dailies_job` strategy-mode | (non-regression) `csv_daily_returns` | `on_conflict="strategy_id,date"` | WIRED | Lines 1867–1876: strategy path produces `{strategy_id}` rows with conflict `strategy_id,date`; CSV enqueue fires after (line 1911) |
| `sql-tests` CI job | `test_csv_daily_returns_perkey_rls.sql` | `test_*.sql` glob auto-discovery | WIRED | `.github/workflows/ci.yml` line 741: `files=(supabase/tests/test_*.sql)`; preflight checks for psql meta-commands first (line 691); `psql -v ON_ERROR_STOP=1 -f "$f"` for each file (line 753) |
| Per-key RLS policy | owning allocator SELECT gate | `allocator_id = auth.uid()` | WIRED | Migration line 67–71: `CREATE POLICY csv_daily_returns_allocator_owner_select ... USING (allocator_id = auth.uid())`; strategy-owner policy leaves per-key rows invisible (NULL strategy_id never IN subquery) |

---

### DAILIES-04 CI Gate Anatomy (Critical Finding)

**The psycopg test SKIPS in the Python CI job.** The Python `pytest` step (ci.yml line 934) sets `SUPABASE_TEST_URL` and `SUPABASE_TEST_SERVICE_KEY` but does NOT set `TEST_SUPABASE_DB_URL`. The files `test_csv_daily_returns_perkey_rls_live.py` and `test_csv_daily_returns_dualaxis_live.py` both gate on `TEST_SUPABASE_DB_URL` (line 43 each: `pytestmark = pytest.mark.skipif(not os.environ.get("TEST_SUPABASE_DB_URL"), ...)`). These live tests SKIP in CI.

**The REAL CI gate is `supabase/tests/test_csv_daily_returns_perkey_rls.sql`** (commit cc25bfb2). The `sql-tests` job (ci.yml lines 612–756) auto-discovers all `test_*.sql` files, runs a preflight rejecting `\!`/`\copy`/`\o` meta-commands (the file has none), then runs each under `psql "$TEST_SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f "$f"`. The SQL test asserts all 7 isolation properties via `RAISE EXCEPTION`. Exit non-zero from any assertion fails the `sql-tests` job. This is the functional DAILIES-04 gate and it runs in CI.

---

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `scripts/phase35_backfill_enqueue.py` | 110 | `payload: list[dict]` — untyped dict (not a `TypedDict`) | INFO | Matches the `phase12_backfill_enqueue.py` precedent exactly; scripts are excluded from mypy gate (ci.yml line 913 gates only `services/ routers/ models/`); not a regression |
| `test_derive_broker_dailies_dualmode.py` | multiple | `with patches[0], patches[1], ...` chained context managers | INFO | Functional but verbose; not a stub; all tests mutably verify the correct branch is taken |

No TBD/FIXME/XXX debt markers in phase-35 files. No stubs, no empty returns, no hollow props.

---

### Strategy-Path Non-Regression

The migration explicitly re-creates `csv_daily_returns_strategy_date_key` as a NON-partial unique index (lines 55–57), preserving the `on_conflict=strategy_id,date` upsert path used by `persist_csv_daily_returns` and the paginated CSV reader. The self-verifying DO block (migration line 153–157) confirms both non-partial unique indexes exist after the migration. The existing `TestNoRedundantIndex` test was rewritten to assert the post-ALTER 3-index set. Strategy-mode in `run_derive_broker_dailies_job` is byte-unchanged (confirmed by unit test `test_strategy_mode_unchanged_conflict_target_and_enqueue`).

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| DAILIES-01 | 35-01-PLAN.md | Per-key axis on csv_daily_returns, no synthetic strategy rows | SATISFIED | Migration DDL + XOR check + no INSERT into strategies anywhere |
| DAILIES-02 | 35-02-PLAN.md | Dual-mode derive job, key-scoped upsert | SATISFIED | job_worker.py lines 1745–1901 + 5-test dualmode suite |
| DAILIES-03 | 35-03-PLAN.md | Backfill existing exchange keys | SATISFIED | phase35_backfill_enqueue.py + 10-test unit suite; prod backfill is a post-merge manual step (documented in 35-VALIDATION.md Manual-Only) |
| DAILIES-04 | 35-01-PLAN.md | RLS scopes per-key dailies to owning allocator, proven by test | SATISFIED | SQL RLS test (7 assertions, CI-auto-discovered, runs via sql-tests job) |

---

### Human Verification Required

None. All four success criteria are verifiable from code and configuration. The prod backfill run (post-merge manual operator step via `railway ssh`) is explicitly out of scope for this gate (documented in 35-VALIDATION.md Manual-Only section).

---

### Gaps Summary

No gaps. All four DAILIES success criteria are met by substantive, wired, data-flowing artifacts:

- DAILIES-01: The schema change is complete and structural (surrogate PK, nullable strategy_id, api_key_id + allocator_id columns, XOR check, two non-partial unique indexes). No synthetic strategy rows are created anywhere.
- DAILIES-02: The derive job dual-mode branch is complete and mutation-falsifiable unit tests confirm the correct conflict target and allocator_id sourcing.
- DAILIES-03: The backfill script is correct, idempotent, NULL-sync_status-inclusive, and fully tested. The actual prod data population is a documented post-merge operator step, not a gate for this phase.
- DAILIES-04: The psycopg live tests skip in Python CI (TEST_SUPABASE_DB_URL is not set there), but this is the expected and correct behavior. The SQL test `supabase/tests/test_csv_daily_returns_perkey_rls.sql` is the real CI gate — auto-discovered by the `sql-tests` job, contains no banned psql meta-commands, and asserts all 7 required isolation properties under `psql -v ON_ERROR_STOP=1`.

---

_Verified: 2026-06-24T17:30:00Z_
_Verifier: Claude (gsd-verifier)_
