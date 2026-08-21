---
phase: 158
slug: ops-ci-a-merge-means-a-deploy
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
# audit-milestone §5.5 distinguishes NOT-VALIDATED (draft) from PARTIAL (validated + nyquist_compliant: false) (#2117)
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-08-20
---

# Phase 158 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 4.1.10 (`vitest.config.ts`), pytest (run ONLY from `analytics-service/` with `python3` — VCR cassettes), Playwright (`playwright.config.ts`), plain-SQL gates (`supabase/tests/test_*.sql` via `sql-tests`), GitHub Actions itself (probe/watcher workflows, verified via `gh` CLI 2.92.0) |
| **Config file** | `vitest.config.ts`, `playwright.config.ts`, `analytics-service/` pytest defaults |
| **Quick run command** | `npx vitest run "src/app/(dashboard)/strategies/new/wizard/steps/MultiKeyConnectStep.test.tsx"` / `cd analytics-service && python3 -m pytest tests/test_compute_jobs_fencing.py -x -q` / `npx playwright test e2e/<spec>.spec.ts` |
| **Full suite command** | `npm run test` (⚠️ valid ONLY in a worktree without `.env.test.local` — with it, ~274 live-DB reds are BY DESIGN) / `cd analytics-service && python3 -m pytest` |
| **Estimated runtime** | targeted runs < 120s; full vitest ~10-15 min; full pytest ~10 min |

⚠️ CI is Node 22 vs local Node 25 — `PATH=/opt/homebrew/opt/node@22/bin:$PATH` reproduces CI-only vitest behavior. GSD worktrees fork WITHOUT `node_modules` — `npm ci` first.

---

## Sampling Rate

- **After every task commit:** Run that task's `<automated>` gate (each is < 120s except the live probe polls)
- **After every plan wave:** Full vitest in a clean worktree + full pytest from `analytics-service/`; `npm run lint` before any push
- **Before `/gsd-verify-work`:** Full suites green + the three live-CI verifications queued for the PR/post-merge window (see Manual-Only)
- **Max feedback latency:** ~120 seconds for local gates; live-CI gates are event-bound (PR runs / post-merge dispatches)

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 158-01-01 | 01 | 1 | OPS-01 | T-158-04 | probe never attaches red to main HEAD (branch-filtered trigger) | CI probe | `gh run list --workflow=mutex-probe.yml … conclusion` (RED then GREEN observed) | ❌ W0 (`mutex-probe.yml`) | ⬜ pending |
| 158-01-02 | 01 | 1 | OPS-01 | T-158-01/02/03 | DSN never echoed; fork no-op arm | grep/yaml | comment-filtered shared-test-db grep == 0; `pg_advisory_lock(61616158)` ×3; js-yaml parse | ✅ (ci.yml) | ⬜ pending |
| 158-01-03 | 01 | 1 | OPS-02 | — | skip tolerated only fork/dispatch | grep/yaml | needs+loop-row greps + dispatch-arm grep | ✅ (ci.yml) | ⬜ pending |
| 158-02-01 | 02 | 1 | OPS-01 | T-158-05/06/07 | env-into-script; exit-0 doctrine; issues:write only | yaml/grep/gh | yaml parse + permission greps + `gh label list` | ❌ W0 (watcher yml) | ⬜ pending |
| 158-02-02 | 02 | 1 | OPS-01 | T-158-08 | secret NAMES only in public runbook | grep | runbook content greps + credentialed-DSN negative grep | ❌ W0 (runbook) | ⬜ pending |
| 158-03-01 | 03 | 1 | OPS-04 | — | tests target TEST ref only | pytest+grep | region-scoped `"claimed_at"` greps + `python3 -m pytest tests/test_compute_jobs_fencing.py` | ✅ | ⬜ pending |
| 158-03-02 | 03 | 1 | OPS-04 | T-158-09/10 | PROD-ref refusal OBSERVED; zero deletions | negative-exec+grep | PROD-URL invocation exits non-zero; deletion/cron negative greps | ❌ W0 (drain script) | ⬜ pending |
| 158-03-03 | 03 | 1 | OPS-04 | T-158-11/12/13 | evidence carries counts only (public repo) | grep | before/after/idempotency/PR#674 greps on evidence file | ❌ W0 (evidence) | ⬜ pending |
| 158-04-01 | 04 | 1 | OPS-11 | — | honest sweep in env-clean tree | grep | ≥10 `sequence.seed=` rows in evidence | ❌ W0 (evidence) | ⬜ pending |
| 158-04-02 | 04 | 1 | OPS-11 | T-158-15 | RED→GREEN pin or mechanism citation | vitest+grep | isolation run green + closure grep | ✅ | ⬜ pending |
| 158-05-01 | 05 | 1 | OPS-03 | — | no phantom coverage (≥1 executed case/file) | playwright | combined 4-spec run, per-file counts | ✅ | ⬜ pending |
| 158-05-02 | 05 | 1 | OPS-03 | T-158-16/17/18 | own-seed assertions; href-scoped selectors | playwright+grep | seeded run + HAS_SEED_ENV/selector greps | ❌ W0 (`my-strategies.spec.ts`) | ⬜ pending |
| 158-06-01 | 06 | 2 | OPS-03 | T-158-19/20 | list-only diff; MA-8 both halves | grep/yaml | exactly-once per-spec counts + yaml parse | ✅ (ci.yml) | ⬜ pending |
| 158-06-02 | 06 | 2 | OPS-03 | T-158-21 | decisions recorded, no secrets | grep | ≥16 `[158-OPS-03]` TODOS lines + decision-artifact greps | ❌ W0 (decision doc) | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `.github/workflows/mutex-probe.yml` — created BY plan 158-01 task 1 (the tracer); OPS-01 serialization proof
- [ ] `.github/workflows/main-ci-cancelled-watcher.yml` — created BY plan 158-02 task 1
- [ ] `scripts/drain-test-compute-backlog.ts` — created BY plan 158-03 task 2
- [ ] `e2e/my-strategies.spec.ts` — created BY plan 158-05 task 2

All four Wave-0 gaps from 158-RESEARCH.md are creation tasks inside Wave-1 plans (the missing files ARE the deliverables); no separate scaffold wave is needed. The session-mode DSN go/no-go is the tracer's first observable (plan 158-01 task 1).

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Live both-polarity aggregator proof | OPS-02 | needs a real `pull_request` CI run (branch pushes don't trigger ci.yml) | On the phase PR: temporary commit with a failing `supabase/tests/test_ci_gate_probe.sql` → `frontend` FAILURE with `sql-tests=failure`; revert; post-merge `gh workflow run ci.yml` → green with `sql-tests=skipped` tolerated |
| 3-run cross-run serialization drill | OPS-01 | `workflow_dispatch` requires the file on the default branch | Post-merge: `gh workflow run mutex-probe.yml` ×3; all conclusions == `success` (never "not failure"); job windows non-overlapping via `gh api …/runs/<id>/jobs` |
| Watcher issue create/comment cycle | OPS-01 | `workflow_run`/dispatch only fire from the default branch | Post-merge: `gh workflow run main-ci-cancelled-watcher.yml -f run_id=31273384829` twice → issue created then commented; close it |
| #616 closure on mechanism | OPS-01 | PR merge event | Phase PR body carries `Closes #616` + the mechanism paragraph (eviction layer removed + silence layer removed) |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 120s for local gates (live-CI gates event-bound by nature)
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
