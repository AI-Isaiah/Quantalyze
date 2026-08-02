---
phase: 142
slug: job-strategy-analytics-stuck-computing-reaper-computing-star
status: planned
nyquist_compliant: true
wave_0_complete: false
created: 2026-08-02
---

# Phase 142 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Derived from `142-RESEARCH.md` §Validation Architecture. Task IDs in the Per-Task map are filled
> in by the planner; the requirement→test rows below are already fixed and must not be renegotiated.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework (SQL)** | plain PL/pgSQL under `psql -v ON_ERROR_STOP=1` — **pgTAP is NOT installed** |
| **Framework (Python)** | pytest (`asyncio_mode = auto`) — **must be run from `analytics-service/`** |
| **Framework (TS)** | Vitest 4.1.2 |
| **Config files** | `analytics-service/pytest.ini`; `vitest.config.ts`; SQL gate wired by glob in `.github/workflows/ci.yml:830-975` |
| **Quick run command** | `cd analytics-service && pytest tests/test_main_worker.py tests/test_job_worker_csv_kind.py -x -q` |
| **Full suite command** | `cd analytics-service && pytest -q` + `npm test` + all `supabase/tests/test_*.sql` |
| **Type gate** | `cd analytics-service && mypy --strict .` ; `npm run typecheck` |
| **Estimated runtime** | quick ~30s; full pytest ~several min; full vitest ~several min |

⚠️ **Harness constraints that decide whether a test runs at all:**
- SQL/RLS gates run in CI **only** as `supabase/tests/test_*.sql`. A `*_live.py` or `skipIf`-guarded
  vitest **never runs in CI** and is not evidence.
- The SQL gate must be **MCP-applied to the TEST project (`qmnijlgmdhviwzwfyzlc`) first**, or the
  presence gate green-skips and the whole file is a no-op.
- `mypy --strict` must be run before shipping anything under `analytics-service/` — the GSD milestone
  path runs pytest only, so type errors stay latent until PR CI.

---

## Sampling Rate

- **After every task commit:** `cd analytics-service && pytest tests/test_main_worker.py tests/test_job_worker_csv_kind.py -x -q`
- **After every plan wave:** `cd analytics-service && pytest -q` + `psql "$TEST_SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/test_strategy_analytics_stuck_computing_reaper.sql` + `npm run typecheck`
- **Before `/gsd:verify-work`:** full pytest + full vitest + every `supabase/tests/test_*.sql` green, plus `mypy --strict`
- **Max feedback latency:** 30 seconds (quick run)

---

## Per-Task Verification Map

> Task IDs are assigned by the planner. The Requirement / Secure Behavior / Test Type / Command
> columns below are **fixed by research** and carry over verbatim into the planner's task rows.

| Task ID | Plan | Wave | Requirement | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------------|-----------|-------------------|-------------|--------|
| 142-05.T1 | 05 | 3 | JOB-01 | `computing_started_at` exists, `timestamptz`, nullable, no default | SQL gate | `psql … -f supabase/tests/test_strategy_analytics_stuck_computing_reaper.sql` | ❌ W0 | ⬜ pending |
| 142-03.T3 | 03 | 2 | JOB-01 | The Python `computing` writer co-locates the stamp in the same statement | unit/AST | `cd analytics-service && pytest tests/test_computing_started_at_stamp.py -x` | ❌ W0 | ⬜ pending |
| 142-05.T1 | 05 | 3 | JOB-01 | SQL bridge branch (a) stamps on the **transition only** — a second bridge call on an already-`computing` row does NOT advance the stamp | SQL gate (both directions) | same SQL gate file | ❌ W0 | ⬜ pending |
| 142-03.T3 + 142-05.T1 | 03/05 | 2/3 | JOB-01 | The stamp is cleared to NULL on **every** exit from `computing` | SQL gate + pytest | same | ❌ W0 | ⬜ pending |
| 142-05.T1 | 05 | 3 | JOB-02 | Stranded row (past threshold, no active job) → `failed` + `computation_error` + `computation_warned=FALSE` | SQL gate, `EXECUTE`-the-deployed-cron-body oracle | same | ❌ W0 | ⬜ pending |
| 142-05.T1 | 05 | 3 | JOB-02 | `computing` row **with** an active `compute_jobs` row → **NOT** reaped | SQL gate | same | ❌ W0 | ⬜ pending |
| 142-05.T1 | 05 | 3 | JOB-02 | `computing` row with **NULL** stamp → **NOT** reaped (skip, never destructively reap) | SQL gate | same | ❌ W0 | ⬜ pending |
| 142-05.T1 | 05 | 3 | JOB-02 (SC#2) | fresh `computed_at` + old `computing_started_at` → **REAPED** | SQL gate | same | ❌ W0 | ⬜ pending |
| 142-05.T1 | 05 | 3 | JOB-02 (SC#2) | old `computed_at` + fresh `computing_started_at` → **NOT** reaped | SQL gate | same | ❌ W0 | ⬜ pending |
| 142-05.T1 | 05 | 3 | JOB-02 | Cron job registered under the expected name, at the expected cadence | SQL gate | same | ❌ W0 | ⬜ pending |
| 142-05.T1 | 05 | 3 | JOB-02 | The `LIMIT` bound holds — N+1 stranded rows ⇒ exactly N reaped in one tick | SQL gate | same | ❌ W0 | ⬜ pending |
| 142-01.T2 | 01 | 1 | JOB-03 | Threshold exceeds every relevant handler's **chain-inclusive** worst case | pytest, beside `TestWatchdogInvariant` | `cd analytics-service && pytest tests/test_main_worker.py -k Reaper -x` | ❌ W0 | ⬜ pending |
| 142-04.T3 + 142-05.T1 | 04/05 | 2/3 | JOB-03 | SQL literal == Python constant (drift gate, reads `cron.job.command`) | SQL gate + pytest | both | ❌ W0 | ⬜ pending |
| 142-01.T2 | 01 | 1 | JOB-03 | Sane upper bound on the threshold (unit-typo catcher) | pytest, mirroring `test_watchdog_threshold_has_sane_upper_bound` | same | ❌ W0 | ⬜ pending |
| 142-02.T1 | 02 | 1 | JOB-07 | No reaper identifier is reachable from `dispatch_tick` | pytest AST/grep gate | `cd analytics-service && pytest tests/test_job07_reaper_off_worker_loop.py -x` | ❌ W0 | ⬜ pending |
| 142-02.T2 | 02 | 1 | JOB-07 | Backlog ⇒ real healthz TCP probe stays 200; **control**: injected loop-blocking reap ⇒ 503 | pytest, mirroring `tests/test_worker_isolation_e2e.py:119,182` | same | ❌ W0 | ⬜ pending |
| 142-03.T2 + 142-05.T3 | 03/05 | 2/3 | cross | `computation_status` CHECK ↔ TS closed-set parity unbroken | vitest (existing) | `npx vitest run src/__tests__/contracts/check-zod-db-check-parity.test.ts` | ✅ exists | ⬜ pending |
| 142-03 + 142-05.T3 | 03/05 | 2/3 | cross | `mypy --strict` clean on `analytics-service` | type gate | `cd analytics-service && mypy --strict .` | ✅ exists | ⬜ pending |
| 142-06.T1 | 06 | 1 | JOB-01 | `StrategyAnalytics` row type carries `computing_started_at: string \| null` (T \| null, never optional) and all 9 blast-radius files compile | type gate | `npm run typecheck` | ✅ exists | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `supabase/tests/test_strategy_analytics_stuck_computing_reaper.sql` — the JOB-02 gate plus the
      SQL half of JOB-01. **Must be MCP-applied to TEST first** or the presence gate green-skips.
- [ ] `analytics-service/tests/test_computing_started_at_stamp.py` — the JOB-01 writer invariant,
      covering **both** runtimes (Python *and* the SQL function body). A Python-only gate is a false
      pass (research P-11).
- [ ] Reaper-threshold invariants added to `analytics-service/tests/test_main_worker.py`, beside
      `TestWatchdogInvariant` (JOB-03).
- [ ] `analytics-service/tests/test_job07_reaper_off_worker_loop.py` — the JOB-07 structural gate and
      the behavioural probe **with its positive control**.
- [ ] A module-level declaration of the **job-chain topology** in `analytics-service/`, so the JOB-03
      oracle reads it rather than re-deriving it.

*No framework install needed — pytest, vitest, and the psql SQL-gate harness all already exist.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| The reaped row renders as a terminal failure with a retry in the live wizard | JOB-02 | The render path (`SyncPreviewStep.tsx` + `wizardErrors.ts`) is **already shipped**; this phase verifies rather than builds it, and driving it end-to-end needs a real stranded row | On TEST: strand a `strategy_analytics` row (`computing`, old `computing_started_at`, no `compute_jobs` row), run the reaper body, reload the wizard, confirm the `GATE_ANALYTICS_FAILED` panel shows with a working retry and a `Details:` line that does not re-attribute fault |
| PROD backfill safety | JOB-01 | A one-shot data migration against live rows; census is read-only and cannot be asserted offline | Run a read-only count of `strategy_analytics` rows at `computation_status='computing'` on PROD before merging, and confirm the backfill's `computed_at` anchor produces sane stamps for them |

---

## Falsifiability Ledger

> **Coverage answers "is it verified?". This section answers "CAN the verification FAIL?"**
> Complete the Observed column at execution time.

| SC | Mutation (exact edit to production source) | Must turn RED | Observed? | Evidence |
|----|-------------------------------------------|---------------|-----------|----------|
| SC-1 | Reaper function body: `computation_status = 'failed'` → `'pending'` | `test_strategy_analytics_stuck_computing_reaper.sql` — stranded-row terminal assertion | ⬜ pending | |
| SC-1b | Reaper function body: **delete** the `computation_warned = FALSE` assignment | SQL gate — the "no false success" assertion (a reaped row must never launder to `complete_with_warnings`) | ⬜ pending | |
| SC-2 | Reaper `WHERE`: `computing_started_at < now() - <threshold>` → `computed_at < now() - <threshold>` | **Both** SC#2 direction tests in the SQL gate | ⬜ pending | |
| SC-2b | `sync_strategy_analytics_status` branch (a): replace the transition-conditional stamp with an unconditional `computing_started_at = now()` | SQL gate — "a second bridge call on an already-`computing` row does not advance the stamp". This is the C-3 trap; a naive "the writer sets the stamp" gate passes it | ⬜ pending | |
| SC-3 | The Python reaper-threshold constant: divide by 10 (below the chain-inclusive ceiling) | `pytest tests/test_main_worker.py -k Reaper` — the headroom invariant | ⬜ pending | |
| SC-3b | Change the threshold literal embedded in the migration so it no longer equals the Python constant | The SQL↔Python drift gate | ⬜ pending | |
| SC-4 | Wire the reaper identifier into `dispatch_tick` (inject the cron jobname onto the worker dispatch surface — plan 142-02 T1) | `test_job07_reaper_off_worker_loop.py` — structural absence gate | ⬜ pending | |
| SC-4b | Run a loop-blocking synchronous reap on the shared event loop (the control pair's `time.sleep` arm — plan 142-02 T2; no production edit needed, the pair IS the mutation+control) | same file — behavioral control pair: the blocking arm starves the probe (latency/503 + stale `LAST_TICK_AT`) while the yielding twin stays 200 | ⬜ pending | |
| SC-5 | `analytics_runner.py` `_mark_computing` (~:1227): delete the `computing_started_at` stamp key from the entry upsert dict (plan 142-03 m1) | `pytest tests/test_computing_started_at_stamp.py` — entry rule: literal `"computing"` ⇒ stamp present and ≠ None | ⬜ pending | |
| SC-5b | `job_worker.py` composite success write: delete the `computing_started_at: None` clear from the `headline_payload` dict literal (~:6635, consumed by the NESTED `_write_headline_and_by_basis` upsert at ~:6744 — plan 142-03 m2) | same file — exit-clear rule reached via the ast.Name payload-resolution arm; this RED doubles as the Name-arm liveness proof | ⬜ pending | |
| SC-5c | `src/app/api/keys/sync/route.ts:532`: delete `computing_started_at: null` from the failed-placeholder payload (plan 142-03 m3) | same file — TS object-literal half (the payload is built in `compositeMemberCount` and passed as an argument; only the object-literal anchor can see it) | ⬜ pending | |

*Rules:*
- **Observed means run.** "The test covers it" is not evidence. Paste the failing assertion.
- **A mutation that is skipped** (ambiguous anchor, unreachable) is recorded as skipped, **never as caught**.
- **Prefer the second member of a class.** The stamp rule is enforced at two writers and cleared at
  17 exit sites (11 Python + 2 SQL + 4 TS — RESEARCH §Writer Census B, denominator corrected from
  the original "14" during plan revision) — mutate an exit site the author did *not* have in mind.
  That is what detects an instance-fix masquerading as a class-fix.

---

## Oracle Independence

> The failure this catches: assertions that read their expected value out of the module under test,
> so the test passes for any implementation.

- [ ] No test imports a **constant** from the module it tests — expected values are **literals** in the test
- [ ] No assertion compares a value to itself via a re-export, fixture, or table under test
- [ ] Table/registry sizes are pinned to a **literal count**, not to `len(THE_TABLE)`
- [ ] Any fake/double is pinned against the real contract it stands in for (version, key shape, semantics)
- [ ] **The JOB-03 threshold oracle does not recompute the implementation's own expression**
      (research P-8). It reads the job-chain topology from a named module-level constant and pins the
      ceiling independently; a test that re-derives `batch_size × max_per_kind_timeout` cannot fail
      when that expression is the wrong one — and per C-6 it *is* the wrong one.
- [ ] **The JOB-02 SQL gate executes the deployed cron body**, not a re-typed copy of the same SQL.
      A gate that re-implements the predicate passes when the deployed predicate is wrong.

*If a self-referential oracle is deliberate, name it here and say what independently covers it:*
1. **Plan 142-01 T2** (`TestReaperThresholdInvariant`) imports `JOB_CHAIN_FOLLOW_ON` and
   `TIMEOUT_PER_KIND` from `services.job_worker` — the module under test. Compensating coverage:
   plan 01 Task 1 rewired the three production enqueue sites to READ `JOB_CHAIN_FOLLOW_ON`, so a
   wrong map changes real enqueue behavior and reddens the existing job-flow suites
   (`test_main_worker.py`, `test_job_worker_csv_kind.py`) run in the same plan's verify; the
   batch/retry inputs stay local literals (P-8); and the 6–24 h ceiling sanity band plus the
   topology-coverage asserts (keys ⊆ TIMEOUT_PER_KIND; chain ceiling ≥ all-kinds single-hop
   ceiling) guard a zeroed or under-covering map.
2. **Plan 142-04 T3** (`TestReaperThresholdDriftGate`) imports `STRATEGY_ANALYTICS_REAP_THRESHOLD`
   from `services.job_worker` — deliberate: the Python constant is DECLARED canonical and the test
   pins SQL↔Python equality, not value correctness. Compensating coverage: VALUE-correctness is
   owned by `TestReaperThresholdInvariant`'s literal-pinned chain-inclusive ceiling (SC-3), which
   does not trust the constant.

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] SQL gate MCP-applied to TEST before it is trusted as evidence
- [ ] **Every success criterion has a Falsifiability Ledger row**
- [ ] **Every ledger row is `Observed ✅` with pasted evidence, or explicitly marked skipped-with-reason**
- [ ] **Oracle Independence checklist complete**
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
