---
schema_version: 1
open_count: 20
waived_count: 0
fixed_count: 1
total_count: 21
last_updated: 2026-08-26T12:32:31.476Z
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
| 9 | 159 | deviation | analytics-service/services/metrics.py |  | RANK-05 residual SUPPLEMENT (review specialist re-measurement, 2026-08-23): the open compute_qstats_scalars surface PERSISTS wrong values into the same metrics_json the phase guards — measured on the phase's own trigger fixture: ulcer_index=0.9947, common_sense_ratio=0.0, recovery_factor=2.0737, upi=2.9999, serenity_index=0.3204 for a 60-day all-winning series whose max_drawdown correctly reads 0.0. Signature sweep (in-env): recovery_factor, kelly_criterion, common_sense_ratio, cpc_index, r_squared ACCEPT prepare_returns= (kwarg-closable); ulcer_index/upi/serenity_index reach _prepare_prices transitively via to_drawdown_series (need P114 inline mirrors). Also: the region gate is structurally blind to the getattr(qs.stats, attr) dispatch at metrics.py:1815 — the follow-up must teach the scan that shape and add _rolling_alpha_beta (rolling_greeks lacks prepare_returns=False; feeds rendered chart series). Test stubs in the 2026-08-23 review transcript. | open |  | 2026-08-23T12:41:34.945Z |  |
| 10 | 160 | deviation | src/components/strategy/ApiKeyManager.tsx |  | 160-02: if (newKey) silent-skip replaced with a loud throw on a 2xx carrying no api_key_id; link+sync blocks dedented (content byte-preserved) | open |  | 2026-08-23T15:59:31.524Z |  |
| 11 | 161 | deviation | src/lib/wizardErrors.ts |  | 161-05: KEY_ORPHANED's UI-SPEC remedy bullet was replaced — no manager-facing surface can release an orphaned api_key (D-161-05-A) | open |  | 2026-08-24T11:53:32.055Z |  |
| 12 | 161 | deviation | src/app/api/strategies/create-with-key/route.ts |  | 161-05: orphaned MT5 connect waits out the full 120s validate before the KEY_ORPHANED refusal (D-161-05-B) | open |  | 2026-08-24T11:53:39.722Z |  |
| 13 | 161 | unrun-verify | .planning/phases/161-wizerr-honest-error-surfaces/161-06-PLAN.md |  | 161-06 backstop truth unverified: the rendered wait sentence's wrap/no-clipping on the E2 key-connect envelope — no renderer touched this plan | open |  | 2026-08-24T12:23:07.786Z |  |
| 14 | 161 | unrun-verify | src/app/(dashboard)/allocations/components/AllocateDialog.tsx |  | E5 residue: founder eyes-on pass on the real Allocate dialog in Safari is unverified; layout measured only in Chromium on reproduced Modal/ErrorEnvelope markup (result: scrolls, does not clip) | open |  | 2026-08-24T21:01:39.389Z |  |
| 15 | 161.1 | unrun-verify | supabase/tests/test_ledger_refresh_fanout.sql |  | Both phase SQL gates were run on a local Supabase harness, not against the real TEST project (TEST_SUPABASE_DB_URL is a CI secret, psql absent). Blocking CI sql-tests job covers this on PR. | open |  | 2026-08-25T10:34:25.695Z |  |
| 16 | 162 | deviation | src/app/(dashboard)/strategies/new/wizard/steps/SyncPreviewStep.composite.render.test.tsx |  | Composite failure envelope no longer names the failing member; restoring it needs a structured member field, not a free-text column (deferred-items.md D1) | open |  | 2026-08-25T23:20:00.011Z |  |
| 17 | 162 | unrun-verify | .planning/phases/162-honest-what-the-user-sees-is-true/162-08-PLAN.md |  | Plan 162-08 Task 1 (D-162-1) NOT EXECUTED: the PROD write lane is unreachable — the harness classifier denies reading the service-role credential (network and plain file reads are allowed; three lanes tried). 15/15 published is_example rows remain computation_status=failed since 2026-05-27; 0 recomputed, 0 unpublished, 0 touched. Also unexecuted: the repair enqueue for the 2 raw-exception-text rows. Selected mechanism plus the one unmeasured precondition (csv_daily_returns population) are recorded in 162-CENSUS.md. | open |  | 2026-08-25T23:44:15.573Z |  |
| 18 | 162 | unmet-truth | .planning/phases/162-honest-what-the-user-sees-is-true/162-08-PLAN.md |  | 162-08 backstop truth is only HALF evidenced. Code half: proven at the seam (StrategyTable.stale-analytics 16/16, both HONEST-03 guards witnessed RED by neuter+restore). Data half: absent — the 15 example rows are still failed and still published, so discovery renders no Synced badge on them but is still not honest about them. An unevidenced backstop routes to human_needed; this one must not be read as a pass. | open |  | 2026-08-25T23:44:25.891Z |  |
| 19 | 162 | deviation | src/app/(dashboard)/allocations/components/ScenarioComposer.tsx |  | RESTORED (originally recorded 2026-08-25T22:28:18.784Z by plan 162-04; lost from the ledger JSON by a concurrent-append race and re-added by 162-08). 162-04: metric pair now renders in all five C-4 states (previously hidden when both null); two existing SCEN-03 assertions updated accordingly | open |  | 2026-08-25T23:45:43.649Z |  |
| 20 | 162 | deviation | src/components/strategy/StrategyGrid.tsx | 117 | RESTORED WITH A CORRECTED REASON (originally recorded 2026-08-25T22:26:27.302Z by plan 162-03; lost from the ledger JSON by a concurrent-append race). Original text said 'SyncBadge still ungated on computation_status (is_example guard added; consumer-less component)'. Re-measured at HEAD 2026-08-26: 'consumer-less' is FALSE (StrategyTable.tsx:1421 renders StrategyGrid, and grid is discovery-only by founder ruling at StrategyTable.tsx:387-398). The real gap is narrower: the grid gate has the is_example half and lacks the hasComputedAnalytics half the table carries (StrategyTable.tsx:982-983). NOT user-visible — shapeRowAnalytics blanks computed_at to empty for non-terminal-success rows — so guard-hygiene, not blocking. Filed with full reasoning in TODOS.md under 'Phase 162 (HONEST) — plan 162-08 filings'. | open |  | 2026-08-25T23:45:55.414Z |  |
| 21 | 163 | deviation | .planning/REQUIREMENTS.md |  | SEC-02 checkbox left unchecked by plan instruction — status is the phase verifier's call | open |  | 2026-08-26T12:32:31.476Z |  |
| 21 | 163 | deviation | src/lib/freshness.ts |  | HONEST-08: the plan's stated staler-of-two rule (older date wins) was corrected to a per-subject verdict comparison — see 163-04-SUMMARY deviation 1 | open |  | 2026-08-26T12:58:42.034Z |  |

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
  },
  {
    "id": 9,
    "kind": "deviation",
    "phase": "159",
    "file": "analytics-service/services/metrics.py",
    "line": null,
    "description": "RANK-05 residual SUPPLEMENT (review specialist re-measurement, 2026-08-23): the open compute_qstats_scalars surface PERSISTS wrong values into the same metrics_json the phase guards — measured on the phase's own trigger fixture: ulcer_index=0.9947, common_sense_ratio=0.0, recovery_factor=2.0737, upi=2.9999, serenity_index=0.3204 for a 60-day all-winning series whose max_drawdown correctly reads 0.0. Signature sweep (in-env): recovery_factor, kelly_criterion, common_sense_ratio, cpc_index, r_squared ACCEPT prepare_returns= (kwarg-closable); ulcer_index/upi/serenity_index reach _prepare_prices transitively via to_drawdown_series (need P114 inline mirrors). Also: the region gate is structurally blind to the getattr(qs.stats, attr) dispatch at metrics.py:1815 — the follow-up must teach the scan that shape and add _rolling_alpha_beta (rolling_greeks lacks prepare_returns=False; feeds rendered chart series). Test stubs in the 2026-08-23 review transcript.",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-08-23T12:41:34.945Z",
    "resolved_at": null
  },
  {
    "id": 10,
    "kind": "deviation",
    "phase": "160",
    "file": "src/components/strategy/ApiKeyManager.tsx",
    "line": null,
    "description": "160-02: if (newKey) silent-skip replaced with a loud throw on a 2xx carrying no api_key_id; link+sync blocks dedented (content byte-preserved)",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-08-23T15:59:31.524Z",
    "resolved_at": null
  },
  {
    "id": 11,
    "kind": "deviation",
    "phase": "161",
    "file": "src/lib/wizardErrors.ts",
    "line": null,
    "description": "161-05: KEY_ORPHANED's UI-SPEC remedy bullet was replaced — no manager-facing surface can release an orphaned api_key (D-161-05-A)",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-08-24T11:53:32.055Z",
    "resolved_at": null
  },
  {
    "id": 12,
    "kind": "deviation",
    "phase": "161",
    "file": "src/app/api/strategies/create-with-key/route.ts",
    "line": null,
    "description": "161-05: orphaned MT5 connect waits out the full 120s validate before the KEY_ORPHANED refusal (D-161-05-B)",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-08-24T11:53:39.722Z",
    "resolved_at": null
  },
  {
    "id": 13,
    "kind": "unrun-verify",
    "phase": "161",
    "file": ".planning/phases/161-wizerr-honest-error-surfaces/161-06-PLAN.md",
    "line": null,
    "description": "161-06 backstop truth unverified: the rendered wait sentence's wrap/no-clipping on the E2 key-connect envelope — no renderer touched this plan",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-08-24T12:23:07.786Z",
    "resolved_at": null
  },
  {
    "id": 14,
    "kind": "unrun-verify",
    "phase": "161",
    "file": "src/app/(dashboard)/allocations/components/AllocateDialog.tsx",
    "line": null,
    "description": "E5 residue: founder eyes-on pass on the real Allocate dialog in Safari is unverified; layout measured only in Chromium on reproduced Modal/ErrorEnvelope markup (result: scrolls, does not clip)",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-08-24T21:01:39.389Z",
    "resolved_at": null
  },
  {
    "id": 15,
    "kind": "unrun-verify",
    "phase": "161.1",
    "file": "supabase/tests/test_ledger_refresh_fanout.sql",
    "line": null,
    "description": "Both phase SQL gates were run on a local Supabase harness, not against the real TEST project (TEST_SUPABASE_DB_URL is a CI secret, psql absent). Blocking CI sql-tests job covers this on PR.",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-08-25T10:34:25.695Z",
    "resolved_at": null
  },
  {
    "id": 16,
    "kind": "deviation",
    "phase": "162",
    "file": "src/app/(dashboard)/strategies/new/wizard/steps/SyncPreviewStep.composite.render.test.tsx",
    "line": null,
    "description": "Composite failure envelope no longer names the failing member; restoring it needs a structured member field, not a free-text column (deferred-items.md D1)",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-08-25T23:20:00.011Z",
    "resolved_at": null
  },
  {
    "id": 17,
    "kind": "unrun-verify",
    "phase": "162",
    "file": ".planning/phases/162-honest-what-the-user-sees-is-true/162-08-PLAN.md",
    "line": null,
    "description": "Plan 162-08 Task 1 (D-162-1) NOT EXECUTED: the PROD write lane is unreachable — the harness classifier denies reading the service-role credential (network and plain file reads are allowed; three lanes tried). 15/15 published is_example rows remain computation_status=failed since 2026-05-27; 0 recomputed, 0 unpublished, 0 touched. Also unexecuted: the repair enqueue for the 2 raw-exception-text rows. Selected mechanism plus the one unmeasured precondition (csv_daily_returns population) are recorded in 162-CENSUS.md.",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-08-25T23:44:15.573Z",
    "resolved_at": null
  },
  {
    "id": 18,
    "kind": "unmet-truth",
    "phase": "162",
    "file": ".planning/phases/162-honest-what-the-user-sees-is-true/162-08-PLAN.md",
    "line": null,
    "description": "162-08 backstop truth is only HALF evidenced. Code half: proven at the seam (StrategyTable.stale-analytics 16/16, both HONEST-03 guards witnessed RED by neuter+restore). Data half: absent — the 15 example rows are still failed and still published, so discovery renders no Synced badge on them but is still not honest about them. An unevidenced backstop routes to human_needed; this one must not be read as a pass.",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-08-25T23:44:25.891Z",
    "resolved_at": null
  },
  {
    "id": 19,
    "kind": "deviation",
    "phase": "162",
    "file": "src/app/(dashboard)/allocations/components/ScenarioComposer.tsx",
    "line": null,
    "description": "RESTORED (originally recorded 2026-08-25T22:28:18.784Z by plan 162-04; lost from the ledger JSON by a concurrent-append race and re-added by 162-08). 162-04: metric pair now renders in all five C-4 states (previously hidden when both null); two existing SCEN-03 assertions updated accordingly",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-08-25T23:45:43.649Z",
    "resolved_at": null
  },
  {
    "id": 20,
    "kind": "deviation",
    "phase": "162",
    "file": "src/components/strategy/StrategyGrid.tsx",
    "line": 117,
    "description": "RESTORED WITH A CORRECTED REASON (originally recorded 2026-08-25T22:26:27.302Z by plan 162-03; lost from the ledger JSON by a concurrent-append race). Original text said 'SyncBadge still ungated on computation_status (is_example guard added; consumer-less component)'. Re-measured at HEAD 2026-08-26: 'consumer-less' is FALSE (StrategyTable.tsx:1421 renders StrategyGrid, and grid is discovery-only by founder ruling at StrategyTable.tsx:387-398). The real gap is narrower: the grid gate has the is_example half and lacks the hasComputedAnalytics half the table carries (StrategyTable.tsx:982-983). NOT user-visible — shapeRowAnalytics blanks computed_at to empty for non-terminal-success rows — so guard-hygiene, not blocking. Filed with full reasoning in TODOS.md under 'Phase 162 (HONEST) — plan 162-08 filings'.",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-08-25T23:45:55.414Z",
    "resolved_at": null
  },
  {
    "id": 21,
    "kind": "deviation",
    "phase": "163",
    "file": ".planning/REQUIREMENTS.md",
    "line": null,
    "description": "SEC-02 checkbox left unchecked by plan instruction — status is the phase verifier's call",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-08-26T12:32:31.476Z",
    "resolved_at": null
  }
]
````
