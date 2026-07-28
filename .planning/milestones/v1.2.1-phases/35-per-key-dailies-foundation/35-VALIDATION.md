---
phase: 35
slug: per-key-dailies-foundation
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-06-24
---

# Phase 35 — Validation Strategy

> Prod migration + RLS tenant-isolation + prod backfill. The RLS cross-tenant test and the
> strategy-path-unaffected proof are the hard gates.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | pytest (analytics-service) + SQL/RLS tests (sql-tests harness) + vitest (TS, if touched) |
| **Config file** | `analytics-service/pytest.ini` |
| **Quick run command** | `cd analytics-service && python -m pytest tests/ -k "daily_returns or derive_broker or compute_jobs" -q` |
| **Full suite command** | `cd analytics-service && python -m pytest -q` + the SQL/RLS test suite |
| **Estimated runtime** | ~60–120 seconds (pytest) |

---

## Sampling Rate

- **After every task commit:** Run the affected pytest (`-k daily_returns` / `-k derive_broker`).
- **After the migration:** Apply to the TEST project (`qmnijlgmdhviwzwfyzlc`) via Supabase MCP `apply_migration`, then run the RLS cross-tenant + unique-index tests against it.
- **Before `/gsd:verify-work`:** Full analytics suite green + migration-reviewer + rls-policy-auditor both PASS.
- **Max feedback latency:** ~120 seconds.

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|--------|
| 35-mig | 01 | 1 | DAILIES-01 | RLS-tenant | csv_daily_returns gains api_key_id + allocator_id + XOR check; PK→surrogate; 2 non-partial unique indexes; legacy rows pass CHECK | sql | apply to TEST + `pytest -k daily_returns_live` | ⬜ |
| 35-rls | 01 | 1 | DAILIES-04 | RLS-tenant | allocator A cannot SELECT allocator B's per-key rows (authenticated probe); service-role writes still work | sql/rls | RLS cross-tenant test + rls-policy-auditor | ⬜ |
| 35-uniq | 01 | 1 | DAILIES-01 | — | NULLs-distinct: many strategy_id-NULL rows coexist; existing on_conflict=strategy_id,date upsert still resolves | unit/sql | rewritten `TestNoRedundantIndex` + upsert test | ⬜ |
| 35-job | 02 | 2 | DAILIES-02 | — | dual-mode `run_derive_broker_dailies_job`: api_key_id payload → dense-365 realized+funding upsert keyed (api_key_id,date), strategy_id NULL; strategy path byte-unchanged | unit | `pytest -k derive_broker` | ⬜ |
| 35-enq | 02 | 2 | DAILIES-02 | — | `derive_broker_dailies` api_key-scoped arm added to compute_jobs_kind_target_coherence; enqueue_compute_job(p_api_key_id) queues it | sql/unit | coherence-constraint test | ⬜ |
| 35-bf | 03 | 3 | DAILIES-03 | — | backfill script enqueues key-scoped derive for all active non-revoked exchange keys; idempotent (pre-check guard, 23505-safe) | unit | `pytest -k backfill` (dry-run/mock) | ⬜ |

*Status: ⬜ pending · ✅ green · ❌ red*

---

## Wave 0 Requirements

- [ ] Rewrite `tests/test_persist_csv_daily_returns_live.py::TestNoRedundantIndex` — it asserts `index_names == ["csv_daily_returns_pkey"]` and WILL break under the PK→surrogate + 2-unique-index change. Update to assert the new index set (surrogate pkey + the two unique indexes), keeping the "no redundant index" intent.
- [ ] RLS cross-tenant test fixture (two allocators, two keys) for the per-key owner policy.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Prod migration applies cleanly + backfill enqueues real keys | DAILIES-03 | Requires prod creds + Railway worker | Post-merge: apply via Supabase Migrate, run `railway ssh "cd /app && python -m scripts.<backfill>"`, confirm per-key rows appear for ≥1 real key. Non-blocking for the PR (TEST-project apply + RLS test are the gate). |

---

## Validation Sign-Off

- [ ] migration-reviewer PASS + rls-policy-auditor PASS (criterion-4 gate)
- [ ] RLS cross-tenant test green (no A→B read)
- [ ] strategy-path-unaffected proof green (existing CSV upsert + paginated read intact)
- [ ] dual-mode derive job test green; strategy mode byte-unchanged
- [ ] full analytics suite green; mypy --strict clean
- [ ] `nyquist_compliant: true` set after execution

**Approval:** pending
