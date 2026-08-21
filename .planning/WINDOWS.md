---
schema_version: 1
open_count: 7
waived_count: 0
fixed_count: 1
total_count: 8
last_updated: 2026-08-21T14:29:27.024Z
---

# Broken Windows Ledger

> Cross-phase defect register. With `workflow.windows_enforce` enabled, `/gsd-ship` blocks while `open_count > 0`.
> Waive with `gsd-tools windows waive <id> "<reason>"` (reason required).
> Mark fixed with `gsd-tools windows fixed <id>`.

| id | phase | kind | file | line | description | status | reason | recorded_at | resolved_at |
|----|-------|------|------|------|-------------|--------|--------|-------------|-------------|
| 1 | 145 | skipped-test | src/__tests__/csv-finalize-c14-regression.test.ts | 503 | NEW-C14-07 describe.skip — pins the dissolved upstream-body spread; Plan 05 rebuilds the c14 file (plan-sanctioned skip) | fixed |  | 2026-08-17T21:25:43.021Z | 2026-08-17T21:43:38.829Z |
| 2 | 158 | deviation | src/app/api/strategies/create-with-key/route.test.ts | 2374 | Intra-file test-order dependence in 10 specs (DEF-16-1 class, one scope inward): vi.doMock in the H-0306 block is never deregistered (vi.resetModules clears the cache, not the registry). Green in declaration order; unreachable from CI (CI never shuffles tests within a file). Discovered by the 158-04 OPS-11 sweep; see phase deferred-items.md D-158-04-1. | open |  | 2026-08-20T17:00:02.116Z |  |
| 3 | 158 | unrun-verify | .github/workflows/ci.yml | 1650 | Plan 158-06 backstop truth NOT runnable from a worktree: the five newly wired specs must each report >=1 executed (non-skipped) case in their batch on the phase PR's CI run. Wired-but-all-skip is the same false-coverage state as orphanhood. Read off the e2e + e2e-seeded Playwright per-spec output. | open |  | 2026-08-20T18:33:30.854Z |  |
| 4 | 158 | skipped-test | e2e/csv-upload-flow.spec.ts |  | Two server-side csv-validate cases self-skip on HAS_ANALYTICS_SERVICE now that plan 158-06 wired this spec into the seeded batch. /api/strategies/csv-validate forwards to the Python analytics service and NO ci.yml job sets ANALYTICS_SERVICE_URL, so the csv wizard's upload->preview->submit happy path has no executing e2e anywhere. Un-skip by provisioning ANALYTICS_SERVICE_URL + INTERNAL_API_TOKEN into the e2e-seeded job. | open |  | 2026-08-20T18:33:44.606Z |  |
| 5 | 159 | deviation | analytics-service/services/metrics.py |  | RANK-05 residual: the quantstats price-detection heuristic is closed in compute_all_metrics but still live in compute_qstats_scalars (8 scalars), _rolling_alpha_beta's rolling_greeks call, and the greeks benchmark leg. Four of the eight (ulcer_index, ulcer_performance_index, probabilistic_ratio, serenity_index) route TRANSITIVELY through to_drawdown_series/sharpe/sortino/cvar and cannot be closed by prepare_returns=False; they need P114 inline mirrors. See 159-05-SUMMARY.md section 'Residual'. | open |  | 2026-08-21T11:36:18.506Z |  |
| 6 | 159 | unrun-verify | src/app/(dashboard)/discovery/[slug]/[strategyId]/page.tsx |  | 159-03 narrowed getStrategyDetail to the discovery projection; the composite (dqf.composite===true) render branch was never exercised against real composite data — no dev-server spot-check was possible (worktree has no .env; TEST rows have null sparklines). Render one composite strategy on /discovery/<slug>/<id> before ship. | open |  | 2026-08-21T13:37:00.684Z |  |
| 7 | 159 | unmet-truth | src/lib/queries.ts |  | RANK-02's literal truth ('metrics_json absent from every anon-reachable response') does NOT hold: STRATEGY_V2_ANALYTICS_COLUMNS (anon /strategy/[id]/v2) and getFactsheetDetail (tearsheet) both project metrics_json, and data_quality_flags in v2's case. Both are load-bearing — removing them is a visual regression. Either scope RANK-02 to the splat class (as D-02 words it) or open a follow-up for an RPC/alias-set design. | open |  | 2026-08-21T13:37:00.898Z |  |
| 8 | 159 | unrun-verify | supabase/tests/test_get_verified_cohort_rank_gate.sql |  | The two GATE assertions (1: occurrence count; 4a/4b: behavioural + anti-vacuity flip) have never run ARMED: TEST receives migration 20260821120000 only after merge, so on this PR the test takes its state-adaptive SKIP path. Mitigation shipped in 4d04d719 — assertions 2a/2b/3 (SECURITY DEFINER, search_path pin, anon-EXECUTE) were moved ABOVE the skip and DO run on this PR — but the gate arms only on the first post-merge sql-tests run. Say 'would have caught', never 'did catch', until that run is green. | open |  | 2026-08-21T14:29:27.024Z |  |

````json
[
  {
    "id": 1,
    "kind": "skipped-test",
    "phase": "145",
    "file": "src/__tests__/csv-finalize-c14-regression.test.ts",
    "line": 503,
    "description": "NEW-C14-07 describe.skip — pins the dissolved upstream-body spread; Plan 05 rebuilds the c14 file (plan-sanctioned skip)",
    "status": "fixed",
    "reason": "",
    "recorded_at": "2026-08-17T21:25:43.021Z",
    "resolved_at": "2026-08-17T21:43:38.829Z"
  },
  {
    "id": 2,
    "kind": "deviation",
    "phase": "158",
    "file": "src/app/api/strategies/create-with-key/route.test.ts",
    "line": 2374,
    "description": "Intra-file test-order dependence in 10 specs (DEF-16-1 class, one scope inward): vi.doMock in the H-0306 block is never deregistered (vi.resetModules clears the cache, not the registry). Green in declaration order; unreachable from CI (CI never shuffles tests within a file). Discovered by the 158-04 OPS-11 sweep; see phase deferred-items.md D-158-04-1.",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-08-20T17:00:02.116Z",
    "resolved_at": null
  },
  {
    "id": 3,
    "kind": "unrun-verify",
    "phase": "158",
    "file": ".github/workflows/ci.yml",
    "line": 1650,
    "description": "Plan 158-06 backstop truth NOT runnable from a worktree: the five newly wired specs must each report >=1 executed (non-skipped) case in their batch on the phase PR's CI run. Wired-but-all-skip is the same false-coverage state as orphanhood. Read off the e2e + e2e-seeded Playwright per-spec output.",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-08-20T18:33:30.854Z",
    "resolved_at": null
  },
  {
    "id": 4,
    "kind": "skipped-test",
    "phase": "158",
    "file": "e2e/csv-upload-flow.spec.ts",
    "line": null,
    "description": "Two server-side csv-validate cases self-skip on HAS_ANALYTICS_SERVICE now that plan 158-06 wired this spec into the seeded batch. /api/strategies/csv-validate forwards to the Python analytics service and NO ci.yml job sets ANALYTICS_SERVICE_URL, so the csv wizard's upload->preview->submit happy path has no executing e2e anywhere. Un-skip by provisioning ANALYTICS_SERVICE_URL + INTERNAL_API_TOKEN into the e2e-seeded job.",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-08-20T18:33:44.606Z",
    "resolved_at": null
  },
  {
    "id": 5,
    "kind": "deviation",
    "phase": "159",
    "file": "analytics-service/services/metrics.py",
    "line": null,
    "description": "RANK-05 residual: the quantstats price-detection heuristic is closed in compute_all_metrics but still live in compute_qstats_scalars (8 scalars), _rolling_alpha_beta's rolling_greeks call, and the greeks benchmark leg. Four of the eight (ulcer_index, ulcer_performance_index, probabilistic_ratio, serenity_index) route TRANSITIVELY through to_drawdown_series/sharpe/sortino/cvar and cannot be closed by prepare_returns=False; they need P114 inline mirrors. See 159-05-SUMMARY.md section 'Residual'.",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-08-21T11:36:18.506Z",
    "resolved_at": null
  },
  {
    "id": 6,
    "kind": "unrun-verify",
    "phase": "159",
    "file": "src/app/(dashboard)/discovery/[slug]/[strategyId]/page.tsx",
    "line": null,
    "description": "159-03 narrowed getStrategyDetail to the discovery projection; the composite (dqf.composite===true) render branch was never exercised against real composite data — no dev-server spot-check was possible (worktree has no .env; TEST rows have null sparklines). Render one composite strategy on /discovery/<slug>/<id> before ship.",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-08-21T13:37:00.684Z",
    "resolved_at": null
  },
  {
    "id": 7,
    "kind": "unmet-truth",
    "phase": "159",
    "file": "src/lib/queries.ts",
    "line": null,
    "description": "RANK-02's literal truth ('metrics_json absent from every anon-reachable response') does NOT hold: STRATEGY_V2_ANALYTICS_COLUMNS (anon /strategy/[id]/v2) and getFactsheetDetail (tearsheet) both project metrics_json, and data_quality_flags in v2's case. Both are load-bearing — removing them is a visual regression. Either scope RANK-02 to the splat class (as D-02 words it) or open a follow-up for an RPC/alias-set design.",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-08-21T13:37:00.898Z",
    "resolved_at": null
  },
  {
    "id": 8,
    "kind": "unrun-verify",
    "phase": "159",
    "file": "supabase/tests/test_get_verified_cohort_rank_gate.sql",
    "line": null,
    "description": "The two GATE assertions (1: occurrence count; 4a/4b: behavioural + anti-vacuity flip) have never run ARMED: TEST receives migration 20260821120000 only after merge, so on this PR the test takes its state-adaptive SKIP path. Mitigation shipped in 4d04d719 — assertions 2a/2b/3 (SECURITY DEFINER, search_path pin, anon-EXECUTE) were moved ABOVE the skip and DO run on this PR — but the gate arms only on the first post-merge sql-tests run. Say 'would have caught', never 'did catch', until that run is green.",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-08-21T14:29:27.024Z",
    "resolved_at": null
  }
]
````
