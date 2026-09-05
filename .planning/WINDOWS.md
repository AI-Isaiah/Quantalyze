---
schema_version: 1
open_count: 29
waived_count: 0
fixed_count: 2
total_count: 31
last_updated: 2026-08-29T09:24:22.877Z
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
| 22 | 164 | unrun-verify | src/instrumentation.ts |  | Sentry token scrub proven only at wiring+transform level; a REAL captured event on a deployed token URL is unread (164-CONTEXT.md Blocker 3 mandates it) — post-deploy UAT | open |  | 2026-08-27T22:54:22.410Z |  |
| 23 | 164 | deviation | src/app/factsheet-share/gone/route.ts | 77 | 164-01 comment + test name repeat the FALSE claim that Referrer-Policy 'does not strip' the path; the header is correct, the stated reason is not. Needs a one-line correction pass. | open |  | 2026-08-27T22:54:30.377Z |  |
| 24 | 164 | unrun-verify | src/app/PlausibleScript.tsx |  | Plausible withdrawal proven in jsdom markup only; the deployed check (network panel filtered to plausible.io shows ZERO requests on a token link) is post-deploy UAT | open |  | 2026-08-27T22:54:37.686Z |  |
| 25 | 164.3 | unrun-verify | scripts/prod-body-drift-check.sh |  | VAC-04's first real-PROD execution pends the next migrations PR; the live supabase db dump path is stub-proven only | open |  | 2026-08-29T02:10:57.580Z |  |
| 26 | 164.3 | unrun-verify | scripts/test-ledger-drift-check.sh |  | VAC-08's first real-TEST execution pends the next CI run of this branch; the name-joined schema_migrations query and pg_get_functiondef read are stub-proven only (this plan may not write to the shared TEST database) | open |  | 2026-08-29T02:11:06.140Z |  |
| 27 | 164.3 | unmet-truth | scripts/mutation-runner/run.mjs | 123 | ARMS_FLOOR ships at 0 and therefore cannot fire; plan 164.3-08 must pin it from the first full-corpus measurement | fixed |  | 2026-08-29T02:54:49.352Z | 2026-08-29T08:58:19.520Z |
| 28 | 164.3 | unrun-verify | .github/workflows/ci.yml |  | sql-mutation's first ubuntu execution pends the first CI run of this branch: RESEARCH assumption A1 (PostgreSQL 16 server binaries under /usr/lib/postgresql/<major>/bin) has never been measured — the lane, the runner and the job were all built on macOS, where the probe reports no such glob. A red first run names a real portability defect. | open |  | 2026-08-29T09:24:22.877Z |  |
| 29 | 164.3 | unmet-truth | supabase/schema/baseline.sql |  | supabase/schema/baseline.sql is committed with NO staleness gate AND NO consumer. sql-function-snapshot.yml gates supabase/schema/functions/; nothing gates this file, so production can drift from it silently. CORRECTED 2026-08-29 (WR-04/G1): this entry previously said 'the lane would keep loading stale bytes as if current', which described a wiring that does not exist — scripts/local-stack/run.sh:50 reads the gitignored scripts/local-stack/baseline.sql, so `run.sh up` exits 1 FATAL and reads nothing. Phase 164.5 owns all three together: repoint run.sh, drop .gitignore:138, and build the --check gate (including a sha256 assertion against BASELINE.md's recorded hash). Mind the 2.84.2-vs-2.98.2 pg_dump formatting skew when doing so. | open |  | 2026-08-29T11:35:00.000Z |  |
| 30 | 164.3.1 | unmet-truth | src/__tests__/self-referential-oracle.test.ts |  | The Primitive-D self-referential-oracle AST gate ships REPORT-ONLY in plan 164.3.1-02 and blocks NOTHING until plan 164.3.1-08 flips it. Until that flip lands, a new self-referential assertion can enter the tree and the gate will print a finding without failing the suite. SC-5's calibration half is met (the rule was observed flagging src/__tests__/lint-sql-gates.test.ts:183-184 at HEAD before the site was fixed); the enforcing half is 08's. | open |  | 2026-09-01T18:30:00.000Z |  |
| 31 | 164.3.1 | unmet-truth | src/__tests__/self-referential-oracle.test.ts |  | MEASURED at HEAD by plan 164.3.1-02: the rule reports 23 findings across 14 files of 128 scanned, and 19 of those are one shared false-positive mechanism - the accumulator idiom (const offenders: string[] = [] -> loop pushes -> expect(offenders).toEqual([])), which CAN fail and is not a primitive-D instance. 2 are the real target and 2 are type-level contracts in types-design-tests.test.ts that genuinely cannot fail at runtime. The rule was deliberately NOT narrowed after the count was seen - tuning a detector to produce a comfortable number is itself the self-referential move this phase exists to stop. Plan 164.3.1-08 must decide explicitly: teach mutation-awareness and re-measure and re-run the fire proof, OR allowlist the 19 by their shared mechanism with the measurement recorded. Detail in 164.3.1-02-CALIBRATION.md section III.a. | open |  | 2026-09-01T18:30:00.000Z |  |

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
  },
  {
    "id": 22,
    "kind": "unrun-verify",
    "phase": "164",
    "file": "src/instrumentation.ts",
    "line": null,
    "description": "Sentry token scrub proven only at wiring+transform level; a REAL captured event on a deployed token URL is unread (164-CONTEXT.md Blocker 3 mandates it) — post-deploy UAT",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-08-27T22:54:22.410Z",
    "resolved_at": null
  },
  {
    "id": 23,
    "kind": "deviation",
    "phase": "164",
    "file": "src/app/factsheet-share/gone/route.ts",
    "line": 77,
    "description": "164-01 comment + test name repeat the FALSE claim that Referrer-Policy 'does not strip' the path; the header is correct, the stated reason is not. Needs a one-line correction pass.",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-08-27T22:54:30.377Z",
    "resolved_at": null
  },
  {
    "id": 24,
    "kind": "unrun-verify",
    "phase": "164",
    "file": "src/app/PlausibleScript.tsx",
    "line": null,
    "description": "Plausible withdrawal proven in jsdom markup only; the deployed check (network panel filtered to plausible.io shows ZERO requests on a token link) is post-deploy UAT",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-08-27T22:54:37.686Z",
    "resolved_at": null
  },
  {
    "id": 25,
    "kind": "unrun-verify",
    "phase": "164.3",
    "file": "scripts/prod-body-drift-check.sh",
    "line": null,
    "description": "VAC-04's first real-PROD execution pends the next migrations PR; the live supabase db dump path is stub-proven only",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-08-29T02:10:57.580Z",
    "resolved_at": null
  },
  {
    "id": 26,
    "kind": "unrun-verify",
    "phase": "164.3",
    "file": "scripts/test-ledger-drift-check.sh",
    "line": null,
    "description": "VAC-08's first real-TEST execution pends the next CI run of this branch; the name-joined schema_migrations query and pg_get_functiondef read are stub-proven only (this plan may not write to the shared TEST database)",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-08-29T02:11:06.140Z",
    "resolved_at": null
  },
  {
    "id": 27,
    "kind": "unmet-truth",
    "phase": "164.3",
    "file": "scripts/mutation-runner/run.mjs",
    "line": 123,
    "description": "ARMS_FLOOR ships at 0 and therefore cannot fire; plan 164.3-08 must pin it from the first full-corpus measurement",
    "status": "fixed",
    "reason": "",
    "recorded_at": "2026-08-29T02:54:49.352Z",
    "resolved_at": "2026-08-29T08:58:19.520Z"
  },
  {
    "id": 28,
    "kind": "unrun-verify",
    "phase": "164.3",
    "file": ".github/workflows/ci.yml",
    "line": null,
    "description": "sql-mutation's first ubuntu execution pends the first CI run of this branch: RESEARCH assumption A1 (PostgreSQL 16 server binaries under /usr/lib/postgresql/<major>/bin) has never been measured — the lane, the runner and the job were all built on macOS, where the probe reports no such glob. A red first run names a real portability defect.",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-08-29T09:24:22.877Z",
    "resolved_at": null
  },
  {
    "id": 29,
    "kind": "unmet-truth",
    "phase": "164.3",
    "file": "supabase/schema/baseline.sql",
    "line": null,
    "description": "supabase/schema/baseline.sql is committed with NO staleness gate AND NO consumer. sql-function-snapshot.yml gates supabase/schema/functions/; nothing gates this file, so production can drift from it silently. CORRECTED 2026-08-29 (WR-04/G1): this entry previously said 'the lane would keep loading stale bytes as if current', which described a wiring that does not exist — scripts/local-stack/run.sh:50 reads the gitignored scripts/local-stack/baseline.sql, so `run.sh up` exits 1 FATAL and reads nothing. Phase 164.5 owns all three together: repoint run.sh, drop .gitignore:138, and build the --check gate (including a sha256 assertion against BASELINE.md's recorded hash). Mind the 2.84.2-vs-2.98.2 pg_dump formatting skew when doing so.",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-08-29T11:35:00.000Z",
    "resolved_at": null
  },
  {
    "id": 30,
    "kind": "unmet-truth",
    "phase": "164.3.1",
    "file": "src/__tests__/self-referential-oracle.test.ts",
    "line": null,
    "description": "The Primitive-D self-referential-oracle AST gate ships REPORT-ONLY in plan 164.3.1-02 and blocks NOTHING until plan 164.3.1-08 flips it. Until that flip lands, a new self-referential assertion can enter the tree and the gate will print a finding without failing the suite. SC-5's calibration half is met (the rule was observed flagging src/__tests__/lint-sql-gates.test.ts:183-184 at HEAD before the site was fixed); the enforcing half is 08's.",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-09-01T18:30:00.000Z",
    "resolved_at": null
    },
  {
    "id": 31,
    "kind": "unmet-truth",
    "phase": "164.3.1",
    "file": "src/__tests__/self-referential-oracle.test.ts",
    "line": null,
    "description": "MEASURED at HEAD by plan 164.3.1-02: the rule reports 23 findings across 14 files of 128 scanned, and 19 of those are one shared false-positive mechanism - the accumulator idiom (const offenders: string[] = [] -> loop pushes -> expect(offenders).toEqual([])), which CAN fail and is not a primitive-D instance. 2 are the real target and 2 are type-level contracts in types-design-tests.test.ts that genuinely cannot fail at runtime. The rule was deliberately NOT narrowed after the count was seen - tuning a detector to produce a comfortable number is itself the self-referential move this phase exists to stop. Plan 164.3.1-08 must decide explicitly: teach mutation-awareness and re-measure and re-run the fire proof, OR allowlist the 19 by their shared mechanism with the measurement recorded. Detail in 164.3.1-02-CALIBRATION.md section III.a.",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-09-01T18:30:00.000Z",
    "resolved_at": null
    }
]
````
