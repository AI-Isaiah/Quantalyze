---
phase: 159
slug: rank-public-ranking-integrity
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
# audit-milestone §5.5 distinguishes NOT-VALIDATED (draft) from PARTIAL (validated + nyquist_compliant: false) (#2117)
status: validated
nyquist_compliant: true
wave_0_complete: true
created: 2026-08-21
reconstructed: 2026-08-21
---

# Phase 159 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

> ⚠️ **RECONSTRUCTED POST-EXECUTION — read this before trusting the table below.**
> The orchestrator seeded this file from the template at plan time and left every
> placeholder unfilled; the omission was caught by `159-VERIFICATION.md`, not before
> execution. The commands, runtimes and per-task rows below are the ones that were
> **actually run** during the phase (recovered from the seven plan SUMMARYs and the
> orchestrator's own gate runs), not a contract that guided it. It is therefore an
> honest record, but it did **not** function as a pre-execution sampling plan. The
> template's `{N}`-substitution also produced a nonsense "159 seconds" runtime in both
> the latency fields; real measured figures replace it.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 4.1.10 (TypeScript/React) · pytest (analytics-service, Python) · psql SQL tests (`supabase/tests/test_*.sql`, CI-only against TEST) |
| **Config file** | `vitest.config.ts` · `analytics-service/pytest.ini` · `.github/workflows/ci.yml` (SQL glob) |
| **Quick run command** | `PATH=/opt/homebrew/opt/node@22/bin:$PATH npx vitest run <file> --no-file-parallelism` · from `analytics-service/`: `python3 -m pytest -q <file>` |
| **Full suite command** | `PATH=/opt/homebrew/opt/node@22/bin:$PATH npx vitest run --no-file-parallelism` · from `analytics-service/`: `python3 -m pytest -q` |
| **Estimated runtime** | single vitest file 2–30 s · full vitest ~13–15 min (786 files) · full pytest ~147 s · `tsc --noEmit` ~60 s |

**Node 22 is mandatory** for vitest: CI runs Node 22 while local defaults to Node 25, and the
divergence produces CI-only failures that are *not* flakes (`reference_ci_node22_vs_local_node25`).
**pytest must run from `analytics-service/`** — a repo-root run misses VCR cassettes and would
issue LIVE broker calls.

---

## Sampling Rate

- **After every task commit:** the task's own `<automated>` command (single test file).
- **After every plan wave:** orchestrator re-runs the gates on the MERGED tree — never trusting a
  per-worktree green, because worktrees cannot see each other's changes. This is what caught the
  two post-merge regressions below.
- **Before verification:** full vitest + full pytest + `tsc --noEmit` + `mypy --strict` green.
- **Max feedback latency:** ~30 s at task level; ~15 min for the full-suite barrier.

---

## Per-Task Verification Map

| Plan | Wave | Requirement | Verification actually run | Type | Status |
|------|------|-------------|---------------------------|------|--------|
| 159-01 | 1 | RANK-01 (gate artifact) | 4 read-only census SELECTs against PROD `khslejtfbuezsmvmtsdn`; PII/mutation/secret greps over `159-CENSUS.md`; gitleaks | manual + static | ✅ green |
| 159-02 | 2 | RANK-01 | `src/lib/closed-sets.test.ts`, `src/lib/queries.test.ts`, `src/__tests__/critical-regressions.test.ts` (234 combined); `supabase/tests/test_get_verified_cohort_rank_gate.sql` | unit + SQL | ✅ green (SQL gate arm **UNARMED** — see below) |
| 159-03 | 3 | RANK-02 | `src/lib/queries.test.ts` + projected-row-shape render guard (T-159-10); anon-key wire replay | unit | ✅ green |
| 159-04 | 3 | RANK-06 | `closed-sets.test.ts`, `allocations/lib/scenario-compare.test.ts`, `scenario-share/[token]/share-resolve.test.ts`, `ScenarioComposer.test.tsx` (438 combined) | unit + wiring | ✅ green |
| 159-05 | 1 | RANK-05 | `analytics-service/tests/test_metrics.py` (24 `rank05` cases) + full pytest 5215 passed / 89 skipped; `mypy --strict services/metrics.py` | unit + types | ✅ green |
| 159-06 | 1 | RANK-07 | `csv-finalize` two-writer race test + siblings (175 cases across 6 suites) | unit + race | ✅ green |
| 159-07 | 1 | RANK-08, RANK-09 | `WizardClient.csv-durable-mint.test.tsx`, `src/lib/wizard/localStorage.test.ts`, `src/lib/visibility.test.ts`; full vitest in-worktree | unit + source pin | ✅ green |
| — (orchestrator) | post-merge | cross-plan | full vitest **12048 passed / 281 skipped / 0 failed**, exit 0; `tsc --noEmit` exit 0 | integration | ✅ green |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

**Two regressions were visible ONLY at the post-merge barrier** — neither executor could see them
from inside its own worktree:
1. `audit-coverage.test.ts` — 159-06's new commentary pushed an `@audit-skip` pragma outside the
   guard's 8-line window (fixed `abc99c17`, RED→GREEN drill recorded).
2. `scenario-share/[token]/page.test.tsx` — a stale `BLEND-01` expectation of `basis:252` that
   159-04 missed because its blast-radius scan used the **case-sensitive** `vitest -t "blend"`
   filter (fixed `6a9ac6b4`, plus the 252-branch coverage that flip would have deleted).

---

## Wave 0 Requirements

Existing infrastructure covered all phase requirements — no framework install, no new config, no
stub scaffolding was needed. The one genuinely new harness is the CI SQL test
`supabase/tests/test_get_verified_cohort_rank_gate.sql`, created inside plan 159-02 rather than a
Wave 0 step.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Percentile badges disappear on public discovery | RANK-01 | Requires PROD data + a rendered page; the census predicted it but no automated test may assert rank direction (SC-2) | After merge, load `/browse` and a `crypto-sma` category page anonymously; expect NO percentile badges (18 → 1 gate-passing strategy crosses the <5 floor). Remedy path: `TODOS.md` [159-SEED-01]. |
| Discovery **composite** render branch | RANK-02 | No dev-server spot-check possible from a worktree (no `.env`; TEST rows carry null sparklines → unfalsifiable) | Render one composite strategy on `/discovery/<slug>/<id>` before ship. `WINDOWS.md` residual. |
| SQL gate assertions 1 / 4a / 4b ARMED | RANK-01 | TEST receives migration `20260821120000` only AFTER merge, so the test takes its state-adaptive SKIP path on this PR | First post-merge `sql-tests` CI run. Until it is green, say "would have caught", never "did catch". Assertions 2a/2b/3 were moved above the skip (`4d04d719`) and DO run now. |
| CAS behaviour against a real PostgREST | RANK-07 | Every case runs against a mocked builder; mock fidelity rests on an in-repo production precedent, not on executed SQL | Two concurrent same-session CSV resubmits against a real `csv-finalize`; expect exactly one `applied` and one refusal. |
| Classification-conflict 409 → re-mint remedy end-to-end | RANK-08 | Client re-mint and server 409 are pinned separately; nobody drove them together | Drive a classification conflict in the wizard and confirm the 409's own remedy mints a fresh session. |
| Sharpe / volatility movement on saved + shared scenarios | RANK-06 | User-visible number movement on live surfaces; honest direction but must not surprise | Open a pre-existing shared scenario whose legs lack `asset_class`; expect vol ×1.2035 and Sharpe ÷1.2035 versus before. |
| RANK-02 scoping decision | RANK-02 | Product judgment, not a code gap: anon `/strategy/[id]/v2` and the tearsheet project `metrics_json` because it is what they render | Decide: rescope RANK-02 to the splat class (as D-02 words it) or open an RPC/alias-set follow-up. `WINDOWS.md` residual. |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references (none were missing)
- [x] No watch-mode flags
- [x] Feedback latency < 30 s at task level
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** reconstructed and approved 2026-08-21 — with the caveat in the banner above: this
file records what was run, it did not steer what was run.
