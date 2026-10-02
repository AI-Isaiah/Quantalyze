---
phase: 03
slug: mandate-aware-scoring-engine
status: complete
nyquist_compliant: true
wave_0_complete: true
created: 2026-04-18
verified: 2026-04-18
---

# Phase 03 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Derived from `03-RESEARCH.md` §Validation Architecture (Dimensions 1–8) + §Pitfalls.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | pytest (analytics-service) + Vitest (TS schema-sync) |
| **Config file** | `analytics-service/pytest.ini` + `vitest.config.ts` |
| **Quick run command** | `cd analytics-service && pytest tests/test_match_engine.py tests/test_match_defaults.py -x -q` |
| **Full suite command** | `cd analytics-service && pytest -x -q && cd .. && npx vitest run src/__tests__/mandate-columns-schema-sync.test.ts` |
| **Estimated runtime** | ~8s quick · ~75s full |

---

## Sampling Rate

- **After every task commit:** Run quick command
- **After every plan wave:** Run full suite
- **Before `/gsd-verify-work`:** Full suite green + `supabase db push --dry-run` clean
- **Max feedback latency:** 10 seconds (quick) / 90 seconds (full)

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 03-01-W0-1 | 01 | 0 | SCORING-01..07 (scaffold) | — | Wave-0 stubs compile, red | unit stubs | `pytest tests/test_match_engine.py -k mandate_fit -x --co` | ❌ W0 | ⬜ pending |
| 03-01-W0-2 | 01 | 0 | SCORING-06 schema-sync | — | Stub schema-sync test | unit stub | `npx vitest run src/__tests__/mandate-columns-schema-sync.test.ts --reporter=basic` | ❌ W0 | ⬜ pending |
| 03-01-01 | 01 | 1 | SCORING-01 | — | ENGINE_VERSION + WEIGHTS_VERSION = v2.0.0 | unit | `pytest tests/test_match_engine.py::test_engine_version_bumped -x -q` | ❌ W0 | ⬜ pending |
| 03-01-02 | 01 | 1 | SCORING-02 | — | `mandate_fit_score` key in every score_breakdown | unit | `pytest tests/test_match_engine.py::test_mandate_fit_key_present -x -q` | ❌ W0 | ⬜ pending |
| 03-01-03 | 01 | 1 | SCORING-03 | — | max_weight taper math correct | unit | `pytest tests/test_match_engine.py -k max_weight -x -q` | ❌ W0 | ⬜ pending |
| 03-01-04 | 01 | 1 | SCORING-03 | — | correlation_ceiling degradation | unit | `pytest tests/test_match_engine.py -k correlation_ceiling -x -q` | ❌ W0 | ⬜ pending |
| 03-01-05 | 01 | 1 | SCORING-03 | — | liquidity tier-gap direction | unit | `pytest tests/test_match_engine.py -k liquidity -x -q` | ❌ W0 | ⬜ pending |
| 03-01-06 | 01 | 1 | SCORING-07 | — | style_excluded SOFT reason + relax | unit | `pytest tests/test_match_engine.py -k style_exclud -x -q` | ❌ W0 | ⬜ pending |
| 03-01-07 | 01 | 1 | SCORING-04 | — | empty mandates → mandate_fit_score = 1.0 + rank-order invariance | unit | `pytest tests/test_match_engine.py -k empty_mandates -x -q` | ❌ W0 | ⬜ pending |
| 03-01-08 | 01 | 1 | SCORING-03 | — | scoring_weight_overrides clamp + renormalize | unit | `pytest tests/test_match_engine.py -k weight_overrides -x -q` | ❌ W0 | ⬜ pending |
| 03-01-09 | 01 | 1 | SCORING-01 | — | Determinism regression (to_canonical_json) | unit | `pytest tests/test_match_engine.py -k determinism -x -q` | ❌ W0 | ⬜ pending |
| 03-01-10 | 01 | 1 | SCORING-01 | — | Golden snapshot v1→v2 pinned fixture | unit | `pytest tests/test_match_engine.py -k golden_snapshot -x -q` | ❌ W0 | ⬜ pending |
| 03-01-11 | 01 | 2 | SCORING-05/06 | — | Migration 062 applies + DO block NOTICE + schema-sync green | migration + schema | `supabase db push && npx vitest run src/__tests__/mandate-columns-schema-sync.test.ts` | ❌ W0 | ⬜ pending |
| 03-02-W0-1 | 02 | 0 | SCORING-05 | — | skip-logic test stubs compile, red | unit stubs | `pytest tests/test_match_integration.py -x --co` | ❌ W0 | ⬜ pending |
| 03-02-01 | 02 | 1 | SCORING-05 | — | engine_version mismatch → skip=False | integration | `pytest tests/test_match_integration.py::test_skip_on_engine_version_mismatch -x -q` | ❌ W0 | ⬜ pending |
| 03-02-02 | 02 | 1 | SCORING-05 | — | mandate_edited_at > computed_at → skip=False | integration | `pytest tests/test_match_integration.py::test_skip_on_mandate_edit -x -q` | ❌ W0 | ⬜ pending |
| 03-02-03 | 02 | 1 | SCORING-05 | — | force=True bypass + fresh cache → skip=True | integration | `pytest tests/test_match_integration.py::test_skip_force_and_fresh -x -q` | ❌ W0 | ⬜ pending |
| 03-02-04 | 02 | 1 | SCORING-05 (D-12 Option B) | — | compute_jobs rescore_allocator enqueue + worker dispatch | integration | `pytest tests/test_job_worker.py::test_rescore_allocator -x -q` | ❌ W0 | ⬜ pending |
| 03-02-05 | 02 | 1 | SCORING-05 (D4 per-voice-revision) | — | Worker handler reads LATEST allocator_preferences (stale-cache regression guard) | integration | `pytest tests/test_match_integration.py::test_worker_reads_latest_allocator_preferences -x -q` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `analytics-service/tests/test_match_engine.py` — extend with 20 stub tests (names above) that import the new helper `_compute_mandate_fit_score` and assert on `mandate_fit_score` key presence; stubs initially `pytest.skip("wave 0 placeholder")` or red assertions
- [ ] `analytics-service/tests/test_match_integration.py` — NEW FILE; 5 integration test stubs for `_should_skip_allocator` + RPC PERFORM + job worker dispatch, uses existing mocked-Supabase pattern from `tests/test_job_worker.py`
- [ ] `analytics-service/tests/fixtures/match_engine_v2_golden.json` — PLACEHOLDER file with `{"version": "v2.0.0", "results": []}`; filled by 03-01 golden-snapshot test on first green run (`REGENERATE_GOLDEN=1` env var)
- [ ] `analytics-service/tests/test_match_defaults.py` — extend with stubs for 5 new DEFAULT_PREFERENCES keys (`max_weight`, `correlation_ceiling`, `liquidity_preference`, `style_exclusions`, `scoring_weight_overrides`)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Migration 062 applied in production Supabase | SCORING-05 | `supabase db push` on shared env requires manual approval per merge protocol | Run `supabase db push --linked` after merge; verify NOTICE output contains "migration 062 verified"; run `supabase db remote commit` check |
| `WEIGHTS_VERSION` bumped in lockstep with `ENGINE_VERSION` | SCORING-01 | Requires visual inspection of match_engine.py constants | `grep "ENGINE_VERSION\\|WEIGHTS_VERSION" analytics-service/services/match_engine.py` → both must equal `"v2.0.0"` |
| `score_breakdown.mandate_fit_raw` shape reviewable in admin UI | (Observability — Dimension 8) | No admin UI surface in Phase 3; visual check post-deploy in admin match queue | Deploy, open admin match queue, expand a scored candidate row, confirm `score_breakdown.raw.mandate_fit_raw` dict renders without TS error |

---

## Validation Sign-Off

- [ ] All 20 scoring tasks have `<automated>` verify command or explicit Wave 0 scaffold
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify (CI runs full suite per merge — condition met structurally)
- [ ] Wave 0 covers all MISSING references (`test_match_integration.py` is new; fixtures placeholder)
- [ ] No watch-mode flags in any test command
- [ ] Feedback latency < 10s quick / 90s full
- [ ] `nyquist_compliant: true` set in frontmatter after Wave 0 lands
- [ ] Every pitfall (1–13) has a mapped test row above

**Approval:** pending
