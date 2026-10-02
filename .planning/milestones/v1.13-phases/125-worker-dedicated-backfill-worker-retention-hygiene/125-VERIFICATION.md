---
phase: 125-worker-dedicated-backfill-worker-retention-hygiene
verified: 2026-07-19T15:31:10Z
status: human_needed
score: 4/4 must-have codebase deliverables verified (2 automated-live, 2 code-landed; 4 founder LIVE/ops legs pending)
overrides_applied: 0
re_verification:
  previous_status: none
  previous_score: none
human_verification:
  - test: "WORKER-01 — dedicated backfill worker Railway cutover"
    expected: "A second Railway SERVICE (not a replica) in quantalyze-analytics/production runs `python -m main_worker` with WORKER_CLAIM_ROLE=backfill and SUPABASE_SERVICE_KEY; healthz 200; logs show p_kind_include=BACKFILL_KINDS. The existing worker is flipped to WORKER_CLAIM_ROLE=interactive and redeployed (verify commitHash + /health; Railway skips deploys on red main CI); logs show p_kind_exclude=BACKFILL_KINDS."
    why_human: "LIVE Railway topology op — no repo mechanism executes it. Code foundation (role-split claim args, fail-loud role validation, out-of-role refusal safety net, kind-filter claim RPC mig 20260719073701 prod-applied) is landed and wired; only the runtime service stand-up/flip is founder-executable. 123-03 precedent."
  - test: "WORKER-03 — cron reschedule (`cron.schedule('derive-allocator-key-dailies', '30 5 * * *')`)"
    expected: "Founder LIVE SQL op executed LAST, gated on cutover Steps 1–5 green (pilot/E2/full backfill — Phase 127/129 territory). Verify: SELECT jobname, schedule, active FROM cron.job WHERE jobname='derive-allocator-key-dailies'; shows 30 5 * * *."
    why_human: "Founder LIVE SQL op, deliberately NOT a migration (auto-apply + a skipped worker deploy would re-wedge prod verbatim). Runbook Step 6 documents it precisely. EXPECTED to remain OPEN at phase close — its preconditions are downstream-phase gates."
  - test: "WORKER-04 — prod auto-apply watch of migration 20260719120000"
    expected: "On merge to main, migration 20260719120000 auto-applies to PROD khslejtfbuezsmvmtsdn; founder watches the run and confirms the retention_compute_jobs_orphaned_running cron.job row appears (schedule 15 4 * * *)."
    why_human: "Prod migration auto-apply is a founder-watched runtime event at ship time (memory: supabase migrations auto-apply on merge to main)."
  - test: "WORKER-04 — fence-test CI flake proof"
    expected: "The PR's serial `python` CI job (test_compute_jobs_fencing.py + test_drain_semantics.py) runs green against the now-clean shared TEST DB, and stays green across repeated runs — proving the daily orphan re-accumulation flake is dead."
    why_human: "Requires TEST_SUPABASE_DB_URL, not configured in the local/verifier session — EXPLICITLY CI-deferred (documented, not a silent skip). The observable 'flake stops re-firing' clause of success criterion #4 can only be confirmed by CI runs against the shared TEST DB."
---

# Phase 125: WORKER — dedicated backfill worker + retention hygiene — Verification Report

**Phase Goal:** A derived-equity backfill can NEVER wedge live analytics — it runs bounded, batched, off-hours, on its OWN worker — and the test-DB compute_jobs pollution flake is killed at its root.
**Verified:** 2026-07-19T15:31:10Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

The phase splits into an automated-provable spine (WORKER-02 hardening proof + WORKER-04 root-cause code) and a founder LIVE/ops spine (WORKER-01 Railway cutover, WORKER-03 cron reschedule, prod migration watch, fence-flake CI proof). Every codebase deliverable is present, substantive, and wired. No stubs, no missing artifacts, no unreferenced debt markers, no anti-smuggling violations. The remaining work is exclusively founder LIVE/ops legs that no repo mechanism can execute — correctly modeled human_needed, not gaps (123-03 precedent, and matches the ROADMAP's explicit "founder-run legs modeled as human_needed inside their phases" contract).

### Observable Truths (ROADMAP Success Criteria)

| # | Truth | Status | Evidence |
| --- | ------- | ---------- | -------------- |
| 1 (WORKER-01) | Derived-equity backfill claimed ONLY by a dedicated worker; sequential prod worker structurally cannot claim it | ✓ CODE VERIFIED / ⏸ LIVE human_needed | `main_worker.py:163` `_claim_kind_args` returns `p_kind_include=BACKFILL_KINDS` (backfill) vs `p_kind_exclude=BACKFILL_KINDS` (interactive); `_validate_claim_role` fail-loud (`:146`); out-of-role refusal safety net (`:488-497`, returns empty on legacy 2-arg claim under role=backfill); kind-filter claim RPC mig `20260719073701` present + prod-applied. Live Railway two-service cutover = founder op (runbook Steps 0–2). |
| 2 (WORKER-02) | A deliberately-hung crawl times out via `asyncio.wait_for` END-TO-END, worker stays live, per-job `LAST_TICK_AT` keeps healthz honest | ✓ VERIFIED | `tests/test_worker_isolation_e2e.py` RAN BY VERIFIER → **4 passed in 2.02s**. Hangs the REAL cash-pass crawl (`build_deribit_native_ledger`) on an unset Event; PRODUCTION `_BROKER_CRAWL_TIMEOUT_S` bound (`job_worker.py:2391/2649`) returns `outcome=FAILED, error_kind="transient"`; test asserts ONLY the returned DispatchResult (P115 anti-pattern avoided). Real healthz TCP server on ephemeral port answers 200 mid-backfill / 503 when stale over a raw socket. Regression-first: removing the bound hangs the test. |
| 3 (WORKER-03) | Batched/off-hours + cron reschedule executed as a founder LIVE SQL op with a written runbook step — NEVER a migration | ✓ RUNBOOK VERIFIED / ⏸ LIVE human_needed | `docs/runbooks/flipretry-derived-equity-go-live.md` Step 6 (`:131-145`) pins `cron.schedule('derive-allocator-key-dailies','30 5 * * *')` as a hand-run LIVE op with the re-wedge rationale for why it must NOT be a migration. Anti-smuggling: 0 non-comment `derive-allocator-key-dailies` in mig `20260719120000`. Live reschedule = founder op, gated on Steps 1–5. |
| 4 (WORKER-04) | Orphaned `running` compute_jobs purged on a retention schedule; the recurring `python` fence-test CI flake stops re-firing | ✓ CODE VERIFIED / ⏸ prod-apply + fence-proof human_needed | Migration `20260719120000` (`DELETE ... status='running' AND claimed_at < now()-interval '2 hours'`, 04:15 UTC, fail-loud pg_cron guard, self-verifying DO block, inherits `retention_delete_guard` 100k backstop). RED-guarded test `test_retention_orphaned_running.sql` EXECUTEs the DEPLOYED `cron.job.command` as oracle (not a re-typed predicate) + presence-gated skips. Sorts last → CI glob auto-discovers, auto-applies to prod. TEST runtime application claimed in 125-03 (not independently re-queryable here — no MCP execute tool / no local TEST DB URL). Fence-flake proof explicitly CI-deferred. |

**Score:** 4/4 must-have codebase deliverables verified. Truth 2 is fully verified including live behavior (automated). Truths 1, 3, 4 have their codebase deliverable verified with a founder LIVE/ops leg pending (human_needed) — none FAILED.

### Required Artifacts

| Artifact | Expected | Status | Details |
| -------- | ----------- | ------ | ------- |
| `supabase/migrations/20260719120000_retention_orphaned_running_compute_jobs.sql` | Recurring purge cron, 2h window, prod-safe, self-verifying | ✓ VERIFIED | 127 lines; BEGIN/lock_timeout, fail-loud pg_cron guard (`feature_not_supported`), idempotent unschedule-then-schedule, fixed-literal schema-qualified `$cron$` body, terminal predicate self-verify. Sorts last. |
| `supabase/tests/test_retention_orphaned_running.sql` | RED-guarded behavioral SQL test, deployed-command oracle | ✓ VERIFIED | 163 lines; two presence gates (NOTICE-skip), 3 assertion blocks; behavioral section seeds 3 rows on 3 distinct api_keys (avoids partial-unique collision), EXECUTEs `v_command` (the shipped body), asserts orphan gone / fresh survives / done survives; `ROLLBACK`. Plain PL/pgSQL (no pgTAP per CLAUDE.md). |
| `analytics-service/tests/test_worker_isolation_e2e.py` | E2E WORKER-02 proof, real seams, non-self-referential oracle | ✓ VERIFIED | 409 lines; 4 tests, all pass (ran). Binds REAL healthz server on ephemeral port; drives REAL dispatch against a genuinely-hung crawl; asserts only production-returned DispatchResult; role-disjointness proven at helper + wiring level. Zero production-file edits. |
| `docs/runbooks/flipretry-derived-equity-go-live.md` | Extended with dedicated-worker env contract + retention/ordering + reschedule step | ✓ VERIFIED | Step 0 topology-confirm; Step 1 env-contract table (CMD `python -m main_worker`, `WORKER_CLAIM_ROLE=backfill`, `SUPABASE_SERVICE_KEY` NOT `_ROLE_KEY`, replicas-cannot-split fact); Phase-125 retention subsection; Step 6 reschedule-as-LIVE-op preserved. |

### Key Link Verification

| From | To | Via | Status | Details |
| ---- | --- | --- | ------ | ------- |
| e2e test | production wait_for bound | `monkeypatch.setattr(job_worker,"_BROKER_CRAWL_TIMEOUT_S",0.05)` + hung real crawl | ✓ WIRED | Shrinks the REAL constant; production owns classification; symbol confirmed at `job_worker.py:239/2391/2649`. |
| e2e test | real healthz TCP server | `start_healthz_server` on ephemeral port, raw `asyncio.open_connection` probe | ✓ WIRED | `start_healthz_server`/`STALE_THRESHOLD`/`LAST_TICK_AT` confirmed in `main_worker_healthz.py`. |
| e2e test | role-split claim seam | `dispatch_tick` → `_claim_kind_args(WORKER_CLAIM_ROLE)` | ✓ WIRED | `main_worker.py:475` calls `_claim_kind_args`; test asserts payloads on the RPC call, not just the helper. |
| SQL test | deployed cron body | `EXECUTE v_command` (from `cron.job.command`) | ✓ WIRED | Oracle is the shipped body, not a transcription. |
| migration | prod (auto-apply) | CI `sql-tests`/migration glob, sorts last | ✓ WIRED | Auto-discovers + auto-applies on merge (founder watch = human leg). |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
| -------- | ------- | ------ | ------ |
| WORKER-02 e2e proof passes | `.venv/bin/python -m pytest tests/test_worker_isolation_e2e.py -q` | `4 passed in 2.02s` | ✓ PASS |
| Phase 125 commits exist | `git cat-file -t` on 5fda9b86, ee79d5f4, 51bbc4dc, d0c8791a, 1f50b60b | all `commit` | ✓ PASS |
| Anti-smuggling (reschedule not in migration) | non-comment `derive-allocator-key-dailies` count in mig | `0` | ✓ PASS |
| Migration sorts last | `ls supabase/migrations \| tail` | `20260719120000_...` after `20260719073701_...` | ✓ PASS |
| TEST cron.job registered + version drift + guard green | Supabase MCP / psql on TEST `qmnijlgmdhviwzwfyzlc` | Not runnable here (no MCP execute tool, TEST_SUPABASE_DB_URL unset) | ? SKIP → human/CI |
| Fence tests green vs clean TEST DB | `python -m pytest test_compute_jobs_fencing.py test_drain_semantics.py` | Requires TEST DB URL | ? SKIP → CI (deferred) |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
| ----------- | ---------- | ----------- | ------ | -------- |
| WORKER-01 | 125-04 | Backfill on its OWN dedicated worker (role + kind-filtered claim RPC) | Code SATISFIED / LIVE cutover NEEDS HUMAN | Role-split code + refusal safety net + claim RPC landed & wired; runbook cutover; Railway service stand-up = founder op |
| WORKER-02 | 125-02 | Every crawl hard-bounded, proven e2e; healthz honest | ✓ SATISFIED | e2e test ran 4/4; real seams; non-self-referential oracle |
| WORKER-03 | 125-04 | Batched/off-hours + cron reschedule as founder LIVE op, NOT a migration | Runbook SATISFIED / LIVE op NEEDS HUMAN | Step 6 pins `30 5 * * *` as hand-run; anti-smuggling clean |
| WORKER-04 | 125-01, 125-03 | Orphaned `running` purged on retention schedule; fence flake stops | Code SATISFIED / prod-apply + fence-proof NEEDS HUMAN/CI | Migration + RED-guarded test verified; TEST apply claimed 125-03; fence proof CI-deferred |

No orphaned requirements — all four WORKER IDs are claimed by phase plans.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
| ---- | ---- | ------- | -------- | ------ |
| — | — | None (no unreferenced TBD/FIXME/XXX; no stubs; no smuggled reschedule) | — | — |

**Note (not an anti-pattern, documented threat_flag):** `job_worker.py` anchor-read hang (`:2321`) classifies `error_kind="unknown"` rather than `"transient"` — both retryable, no wedge/data-loss risk. The e2e test honestly hangs the cash-pass crawl (the seam that genuinely classifies `"transient"`) rather than asserting `"transient"` against a path that yields `"unknown"`. This is correct oracle discipline; the anchor-read classification gap is flagged in 125-02 SUMMARY for a future `classify_exception` branch, out of scope here.

### Human Verification Required

1. **WORKER-01 dedicated-worker Railway cutover** — stand up a second backfill SERVICE (`python -m main_worker`, `WORKER_CLAIM_ROLE=backfill`, `SUPABASE_SERVICE_KEY`), flip the existing worker to `interactive`, redeploy. Expected: both healthz 200; interactive logs `p_kind_exclude=BACKFILL_KINDS`, backfill logs `p_kind_include=BACKFILL_KINDS`. LIVE Railway op — 123-03 precedent, expected OPEN at close.
2. **WORKER-03 cron reschedule** — `cron.schedule('derive-allocator-key-dailies','30 5 * * *')` executed LAST, gated on Steps 1–5. Expected: `cron.job` shows `30 5 * * *`. Founder LIVE SQL op, deliberately not a migration. Expected OPEN at close.
3. **WORKER-04 prod migration auto-apply watch** — on merge, confirm `retention_compute_jobs_orphaned_running` cron appears on prod `khslejtfbuezsmvmtsdn` (`15 4 * * *`). Founder-watched at ship.
4. **WORKER-04 fence-test CI flake proof** — the serial `python` CI job runs green (and stays green) against the now-clean shared TEST DB. Explicitly CI-deferred (missing local TEST DB URL) — the observable "flake stops re-firing" clause can only close in CI.

### Gaps Summary

No gaps. Every codebase deliverable for all four requirements exists, is substantive, is wired, and passes its automated proof where one exists (WORKER-02 ran 4/4; the RED-guarded SQL test and migration are correct and self-verifying). The migration keeps the WORKER-03 reschedule correctly OUT of any auto-applying migration (anti-smuggling verified). The only outstanding items are four founder LIVE/ops legs — the Railway two-service cutover (WORKER-01), the LIVE cron reschedule (WORKER-03), the prod migration auto-apply watch (WORKER-04), and the fence-flake CI proof (WORKER-04) — all of which are correctly modeled human_needed (no repo mechanism can execute them; two are explicitly gated on downstream phases per 123-03 precedent). Status is therefore human_needed, not gaps_found.

**Independent-verification caveat:** the WORKER-04 TEST-project runtime state (cron registered `15 4 * * *`, schema_migrations version drift corrected to `20260719120000`, guard asserting green, one-time cleanup no-op) is claimed in 125-03 but could not be independently re-queried from this verifier session — no Supabase MCP execute tool is exposed here and `TEST_SUPABASE_DB_URL` is unset. The migration + guard-test artifacts themselves are verified correct in-repo; the live TEST-DB state rests on 125-03's evidence and folds into the prod-apply + fence-proof human legs above.

---

_Verified: 2026-07-19T15:31:10Z_
_Verifier: Claude (gsd-verifier)_
