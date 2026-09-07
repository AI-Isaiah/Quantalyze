---
schema_version: 1
open_count: 35
waived_count: 0
fixed_count: 10
total_count: 45
last_updated: 2026-09-07T10:18:29.567Z
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
| 21 | 163 | deviation | .planning/REQUIREMENTS.md |  | SEC-02 checkbox left unchecked by plan instruction — status is the phase verifier's call | fixed |  | 2026-08-26T12:32:31.476Z | 2026-09-05T17:36:27.539Z |
| 22 | 164 | unrun-verify | src/instrumentation.ts |  | Sentry token scrub proven only at wiring+transform level; a REAL captured event on a deployed token URL is unread (164-CONTEXT.md Blocker 3 mandates it) — post-deploy UAT | open |  | 2026-08-27T22:54:22.410Z |  |
| 23 | 164 | deviation | src/app/factsheet-share/gone/route.ts | 77 | 164-01 comment + test name repeat the FALSE claim that Referrer-Policy 'does not strip' the path; the header is correct, the stated reason is not. Needs a one-line correction pass. | open |  | 2026-08-27T22:54:30.377Z |  |
| 24 | 164 | unrun-verify | src/app/PlausibleScript.tsx |  | Plausible withdrawal proven in jsdom markup only; the deployed check (network panel filtered to plausible.io shows ZERO requests on a token link) is post-deploy UAT | open |  | 2026-08-27T22:54:37.686Z |  |
| 25 | 164.3 | unrun-verify | scripts/prod-body-drift-check.sh |  | VAC-04's first real-PROD execution pends the next migrations PR; the live supabase db dump path is stub-proven only | open |  | 2026-08-29T02:10:57.580Z |  |
| 26 | 164.3 | unrun-verify | scripts/test-ledger-drift-check.sh |  | VAC-08's first real-TEST execution pends the next CI run of this branch; the name-joined schema_migrations query and pg_get_functiondef read are stub-proven only (this plan may not write to the shared TEST database) | open |  | 2026-08-29T02:11:06.140Z |  |
| 27 | 164.3 | unmet-truth | scripts/mutation-runner/run.mjs | 123 | ARMS_FLOOR ships at 0 and therefore cannot fire; plan 164.3-08 must pin it from the first full-corpus measurement | fixed |  | 2026-08-29T02:54:49.352Z | 2026-08-29T08:58:19.520Z |
| 28 | 164.3 | unrun-verify | .github/workflows/ci.yml |  | sql-mutation's first ubuntu execution pends the first CI run of this branch: RESEARCH assumption A1 (PostgreSQL 16 server binaries under /usr/lib/postgresql/<major>/bin) has never been measured — the lane, the runner and the job were all built on macOS, where the probe reports no such glob. A red first run names a real portability defect. | fixed |  | 2026-08-29T09:24:22.877Z | 2026-09-05T17:36:27.645Z |
| 29 | 164.3 | unmet-truth | supabase/schema/baseline.sql |  | supabase/schema/baseline.sql is committed with NO staleness gate AND NO consumer. sql-function-snapshot.yml gates supabase/schema/functions/; nothing gates this file, so production can drift from it silently. CORRECTED 2026-08-29 (WR-04/G1): this entry previously said 'the lane would keep loading stale bytes as if current', which described a wiring that does not exist — scripts/local-stack/run.sh:50 reads the gitignored scripts/local-stack/baseline.sql, so `run.sh up` exits 1 FATAL and reads nothing. Phase 164.5 owns all three together: repoint run.sh, drop .gitignore:138, and build the --check gate (including a sha256 assertion against BASELINE.md's recorded hash). Mind the 2.84.2-vs-2.98.2 pg_dump formatting skew when doing so. | open |  | 2026-08-29T11:35:00.000Z |  |
| 30 | 164.3.1 | unmet-truth | src/__tests__/self-referential-oracle.test.ts |  | The Primitive-D self-referential-oracle AST gate ships REPORT-ONLY in plan 164.3.1-02 and blocks NOTHING until plan 164.3.1-08 flips it. Until that flip lands, a new self-referential assertion can enter the tree and the gate will print a finding without failing the suite. SC-5's calibration half is met (the rule was observed flagging src/__tests__/lint-sql-gates.test.ts:183-184 at HEAD before the site was fixed); the enforcing half is 08's. | fixed |  | 2026-09-01T18:30:00.000Z | 2026-09-05T17:36:27.743Z |
| 31 | 164.3.1 | unmet-truth | src/__tests__/self-referential-oracle.test.ts |  | MEASURED at HEAD by plan 164.3.1-02: the rule reports 23 findings across 14 files of 128 scanned, and 19 of those are one shared false-positive mechanism - the accumulator idiom (const offenders: string[] = [] -> loop pushes -> expect(offenders).toEqual([])), which CAN fail and is not a primitive-D instance. 2 are the real target and 2 are type-level contracts in types-design-tests.test.ts that genuinely cannot fail at runtime. The rule was deliberately NOT narrowed after the count was seen - tuning a detector to produce a comfortable number is itself the self-referential move this phase exists to stop. Plan 164.3.1-08 must decide explicitly: teach mutation-awareness and re-measure and re-run the fire proof, OR allowlist the 19 by their shared mechanism with the measurement recorded. Detail in 164.3.1-02-CALIBRATION.md section III.a. | fixed |  | 2026-09-01T18:30:00.000Z | 2026-09-05T17:36:27.843Z |
| 32 | 164.4.1 | deviation | supabase/tests/test_reconcile_dropped_enqueue_sweep.sql |  | 5 of 39 sections use GATE-FILE falsifiers (3 oracle preconditions dominated by Part 1, 1 seed-integrity control dominated by Part 2 arm A, 1 sum-of-pinned-counts whole-block invariant); each carries its domination measurement at the site | fixed |  | 2026-09-05T10:00:09.888Z | 2026-09-05T14:57:19.045Z |
| 33 | 164.1 | todo | scripts/prod-prober/arms/pyapi06.mjs |  | PYAPI-06 arm does not classify a 401 carrying SERVICE_KEY_ABSENT in response to a PRESENT-but-wrong key (the service conflating absent with mismatched); it needs a 21st defect kind and DEFECT_KINDS is pinned at 20 by the plan-05 wiring test. Limit is documented in the arm header; plan 02's Python-half neuter test is the control. | open |  | 2026-09-05T21:56:43.339Z |  |
| 34 | 164.1 | deviation | scripts/prod-prober/arms/cron-obs.mjs |  | cron-obs: an UNPARSABLE (non-null, non-empty) pg_net.ttl falls back to the documented 6h default with a printed note, rather than being a measure-fail — so a malformed TTL leaves the 3h scan window unclamped in the one direction that under-reports (pruned responses read as missing). Deliberate fail-open with a loud print; revisit if a real TTL ever fails to parse. | open |  | 2026-09-05T22:52:35.873Z |  |
| 35 | 164.1 | deviation | scripts/prod-prober/arms/cron-drift.mjs |  | cron-drift: hygieneViolations never runs on a WITHHELD manifest row (command_withheld: true), by design — the row was read by a human at capture time. The gap is that a reviewer could withhold a row precisely to keep a dirty command out of the gate's reach; nothing mechanical prevents that. captureManifest still refuses to WRITE a dirty row, so the gap only opens if someone hand-edits the committed manifest. | open |  | 2026-09-05T22:52:35.974Z |  |
| 36 | 164.1 | deviation | scripts/prod-prober/run.mjs |  | makeScrubber (plan 01) replaces EVERY occurrence of a requiredEnv VALUE anywhere in the output, with no minimum length. MEASURED during plan 03: with a one-character SUPABASE_DB_PASSWORD ('z') the log line 'cron-drift: database marker = quantalyze-fixture-db' printed as 'quantaly<redacted>e-fixture-db'. Fail-SAFE (it over-redacts, never under-redacts) and unreachable with a realistic credential, but it can mangle unrelated text. Out of plan 03's task scope (plan 01 owns the scrubber); recorded rather than fixed. | open |  | 2026-09-05T22:53:36.531Z |  |
| 37 | 164.1 | deviation | scripts/prod-prober/run.mjs |  | makeScrubber over the mt5 arm's requiredEnv redacts ORDINARY WORDS in a live run. The mt5 arm must declare RAILWAY_PROJECT_ID / RAILWAY_MT5_SERVICE / RAILWAY_ENVIRONMENT as requiredEnv (D-06: an absent one is credential-absent, and they are 3 of the 10 slots the live run reports), but their LIVE values are 'production' and 'mt5-gateway' — short, common strings. MEASURED at plan 04: a defect detail carrying the CLI's stderr printed as 'the <redacted> relay refused the <redacted> session'. Fail-SAFE (over-redacts, never under-redacts) but it degrades the mt5-ssh-transport diagnostic, which is the one row an operator reads when the transport is broken. Extends WINDOWS entry 36 (plan 03's one-char case) with a value that is realistic rather than pathological. Not fixed here: the scrubber is plan 01's and classifying names as secret-vs-identifier is a change to a security control, out of this plan's task scope. ⭐ CLOSED 2026-09-06: fixed by NON_SECRET_ENV (run.mjs) — an allowlist BY NAME of the three Railway public identifiers, all GitHub vars that already appear verbatim in prod-prober.yml. Proven by self-test scenario 51, which uses the REAL live values ('mt5-gateway', 'production') and a SHORT secret; neutering the allowlist skip reproduces this entry's exact string and the scenario goes RED. ⛔ Entry 36 is left OPEN ON PURPOSE: a minimum-length exemption would have been fail-OPEN on a short real secret, so the mangling it describes is the deliberate fail-safe cost. | fixed |  | 2026-09-05T23:24:29.360Z |  |
| 38 | 164.1 | unrun-verify | .github/workflows/prod-prober.yml |  | prod-prober.yml has NEVER been dispatched: plan 05 was instructed not to touch live infrastructure, so the credential-assert step, the supabase link + masked pooler export, the checksum-verified Railway CLI install and all four live arms are unexecuted on a GitHub-hosted runner. Whether the stored workspace-scoped RAILWAY_API_TOKEN authenticates railway ssh non-interactively from a hosted runner is likewise unmeasured (CONTEXT's own open question). Plan 164.1-06 owns the single first dispatch. | open |  | 2026-09-05T23:44:43.987Z |  |
| 39 | 164.2 | unrun-verify | supabase/tests/test_sync_status_curated_sentence_survives.sql |  | The new gate is UNRUN on shared TEST and will report TEST FAILED (0) there from this PR's first CI run, alongside plan 06's TEST FAILED (0c), until 20260906120000_computation_error_provenance.sql is hand-applied to TEST. Nothing applies migrations to TEST (sql-tests has no apply step; the migrate workflow is PROD-only), so this is EXPECTED and is NOT a coupling regression - the three coupled gates' arms never read the new columns and stay green. Remedy booked as [164.2-TEST-APPLY-PROVENANCE] in TODOS.md: the which-database marker query against TEST_SUPABASE_DB_URL FIRST, then psql -f, never supabase db push (this checkout's CLI is linked to PROD). | open |  | 2026-09-06T17:20:07.111Z |  |
| 40 | 164.2 | deviation | .planning/WINDOWS.md |  | This ledger refused every append during phase 164.2 - plans 06, 07 and 10 each recorded their deviations in their SUMMARY instead. Cause, found by the orchestrator 2026-09-06: row 37's RENDERED TABLE cell carried a closing paragraph (the NON_SECRET_ENV fix, dated 2026-09-06) that the FENCED JSON description did not, so the two sides disagreed and the writer refused. The table was hand-edited without the JSON. Repaired by syncing the JSON description to the table text (a clean prefix, +568 chars); no table cell was hand-edited, and the repair was validated by asserting the prefix invariant before writing. Lesson: hand-editing the rendered table silently disables the ledger for every later phase. | open |  | 2026-09-06T17:20:07.208Z |  |
| 41 | 164.2.1 | deviation | src/app/(dashboard)/allocations/components/ContributionWizardOverlay.sessionid-fence.test.tsx |  | Plan 01 deviated (Rule 3): the spec installs explicit storage doubles instead of the preselect spec's guarded clear — on Node 25 window.localStorage.setItem is not a function, writeWizardState swallows it, and the seed silently never existed (SC-1c was passing vacuously). Fixed and pinned by an applied-ness probe; recorded, not open. | fixed |  | 2026-09-07T02:08:54.153Z | 2026-09-07T02:09:16.275Z |
| 42 | 164.2.1 | deviation | .planning/phases/164.2.1-sessionid-fence/164.2.1-02-PLAN.md |  | Plan 02 deviated (Rule 3): 8 pre-existing LOCAL-USERNAME violations (the local machine username inside home-directory paths) in this phase's own 01-PLAN/02-PLAN/RESEARCH artifacts reddened check-planning-hygiene and therefore the full suite. Introduced by planning commit bedda506, an ancestor of plan 02's base; wave 1 never ran the full suite so it had not surfaced. The scanner derives its needle from the live USER, so on CI (USER=runner) it never fires - a local-only gate. Fixed at the cause with the repo's own <user> placeholder convention (9 existing .planning files already carry /Users/<user>/ and -Users-<user>-, including <automated> verify commands). Planning artifacts only; no source file, test, criterion or verify command was weakened. Recorded, not open. | fixed |  | 2026-09-07T02:28:20.652Z | 2026-09-07T02:28:47.667Z |
| 43 | 164.2.1 | unmet-truth | src/app/(dashboard)/allocations/components/ScenarioCommitDrawer.test.tsx |  | FLAKY under full-suite load — a green full suite is therefore not a reliable truth on this file. 'focus management — pre-flight portal + failure transition > submitting → failure transition moves focus to the error banner' failed once in npm test (843 passed \| 1 failed), then passed on an immediate identical re-run (844 passed \| 14217 tests, exit 0). NOT a 164.2.1 regression, MEASURED not assumed: the file is UNTOUCHED by this phase (git diff --name-only vs merge-base is empty), it is 49/49 green in isolation, and it was green in the pre-wave full run. jsdom focus assertions are timing-sensitive and this component animates. Recorded so the next person who sees a lone red here does not bisect a phase that did not cause it, and so the underlying timing dependence is not mistaken for noise forever. | open |  | 2026-09-07T07:02:20.270Z |  |
| 44 | 164.7 | unrun-verify | .github/workflows/ci.yml |  | sql-gate-lint's two new app-GUC steps have never run on ubuntu; the corpus step is RED by design (12 findings/5 files) until 164.7-05 annotates the tree, so no push or workflow_dispatch is permitted before then | open |  | 2026-09-07T10:11:28.312Z |  |
| 45 | 164.7 | deviation | supabase/tests/test_analytics_service_settings_and_vault_tick.sql |  | MEASURED: a DROP POLICY <t>_service_all mutation twin is UNFALSIFIABLE repo-wide — service_role is BYPASSRLS on the pg-lane and on Supabase, so every *_service_all policy is belt-and-braces and no twin of that shape can bite (no-red R3, 164.7-02-NEUTER.log Part B2). Any existing arm relying on one is worth re-measuring. | open |  | 2026-09-07T10:18:29.567Z |  |

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
    "status": "fixed",
    "reason": "",
    "recorded_at": "2026-08-26T12:32:31.476Z",
    "resolved_at": "2026-09-05T17:36:27.539Z"
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
    "status": "fixed",
    "reason": "",
    "recorded_at": "2026-08-29T09:24:22.877Z",
    "resolved_at": "2026-09-05T17:36:27.645Z"
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
    "status": "fixed",
    "reason": "",
    "recorded_at": "2026-09-01T18:30:00.000Z",
    "resolved_at": "2026-09-05T17:36:27.743Z"
  },
  {
    "id": 31,
    "kind": "unmet-truth",
    "phase": "164.3.1",
    "file": "src/__tests__/self-referential-oracle.test.ts",
    "line": null,
    "description": "MEASURED at HEAD by plan 164.3.1-02: the rule reports 23 findings across 14 files of 128 scanned, and 19 of those are one shared false-positive mechanism - the accumulator idiom (const offenders: string[] = [] -> loop pushes -> expect(offenders).toEqual([])), which CAN fail and is not a primitive-D instance. 2 are the real target and 2 are type-level contracts in types-design-tests.test.ts that genuinely cannot fail at runtime. The rule was deliberately NOT narrowed after the count was seen - tuning a detector to produce a comfortable number is itself the self-referential move this phase exists to stop. Plan 164.3.1-08 must decide explicitly: teach mutation-awareness and re-measure and re-run the fire proof, OR allowlist the 19 by their shared mechanism with the measurement recorded. Detail in 164.3.1-02-CALIBRATION.md section III.a.",
    "status": "fixed",
    "reason": "",
    "recorded_at": "2026-09-01T18:30:00.000Z",
    "resolved_at": "2026-09-05T17:36:27.843Z"
  },
  {
    "id": 32,
    "kind": "deviation",
    "phase": "164.4.1",
    "file": "supabase/tests/test_reconcile_dropped_enqueue_sweep.sql",
    "line": null,
    "description": "5 of 39 sections use GATE-FILE falsifiers (3 oracle preconditions dominated by Part 1, 1 seed-integrity control dominated by Part 2 arm A, 1 sum-of-pinned-counts whole-block invariant); each carries its domination measurement at the site",
    "status": "fixed",
    "reason": "",
    "recorded_at": "2026-09-05T10:00:09.888Z",
    "resolved_at": "2026-09-05T14:57:19.045Z"
  },
  {
    "id": 33,
    "kind": "todo",
    "phase": "164.1",
    "file": "scripts/prod-prober/arms/pyapi06.mjs",
    "line": null,
    "description": "PYAPI-06 arm does not classify a 401 carrying SERVICE_KEY_ABSENT in response to a PRESENT-but-wrong key (the service conflating absent with mismatched); it needs a 21st defect kind and DEFECT_KINDS is pinned at 20 by the plan-05 wiring test. Limit is documented in the arm header; plan 02's Python-half neuter test is the control.",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-09-05T21:56:43.339Z",
    "resolved_at": null
  },
  {
    "id": 34,
    "kind": "deviation",
    "phase": "164.1",
    "file": "scripts/prod-prober/arms/cron-obs.mjs",
    "line": null,
    "description": "cron-obs: an UNPARSABLE (non-null, non-empty) pg_net.ttl falls back to the documented 6h default with a printed note, rather than being a measure-fail — so a malformed TTL leaves the 3h scan window unclamped in the one direction that under-reports (pruned responses read as missing). Deliberate fail-open with a loud print; revisit if a real TTL ever fails to parse.",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-09-05T22:52:35.873Z",
    "resolved_at": null
  },
  {
    "id": 35,
    "kind": "deviation",
    "phase": "164.1",
    "file": "scripts/prod-prober/arms/cron-drift.mjs",
    "line": null,
    "description": "cron-drift: hygieneViolations never runs on a WITHHELD manifest row (command_withheld: true), by design — the row was read by a human at capture time. The gap is that a reviewer could withhold a row precisely to keep a dirty command out of the gate's reach; nothing mechanical prevents that. captureManifest still refuses to WRITE a dirty row, so the gap only opens if someone hand-edits the committed manifest.",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-09-05T22:52:35.974Z",
    "resolved_at": null
  },
  {
    "id": 36,
    "kind": "deviation",
    "phase": "164.1",
    "file": "scripts/prod-prober/run.mjs",
    "line": null,
    "description": "makeScrubber (plan 01) replaces EVERY occurrence of a requiredEnv VALUE anywhere in the output, with no minimum length. MEASURED during plan 03: with a one-character SUPABASE_DB_PASSWORD ('z') the log line 'cron-drift: database marker = quantalyze-fixture-db' printed as 'quantaly<redacted>e-fixture-db'. Fail-SAFE (it over-redacts, never under-redacts) and unreachable with a realistic credential, but it can mangle unrelated text. Out of plan 03's task scope (plan 01 owns the scrubber); recorded rather than fixed.",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-09-05T22:53:36.531Z",
    "resolved_at": null
  },
  {
    "id": 37,
    "kind": "deviation",
    "phase": "164.1",
    "file": "scripts/prod-prober/run.mjs",
    "line": null,
    "description": "makeScrubber over the mt5 arm's requiredEnv redacts ORDINARY WORDS in a live run. The mt5 arm must declare RAILWAY_PROJECT_ID / RAILWAY_MT5_SERVICE / RAILWAY_ENVIRONMENT as requiredEnv (D-06: an absent one is credential-absent, and they are 3 of the 10 slots the live run reports), but their LIVE values are 'production' and 'mt5-gateway' — short, common strings. MEASURED at plan 04: a defect detail carrying the CLI's stderr printed as 'the <redacted> relay refused the <redacted> session'. Fail-SAFE (over-redacts, never under-redacts) but it degrades the mt5-ssh-transport diagnostic, which is the one row an operator reads when the transport is broken. Extends WINDOWS entry 36 (plan 03's one-char case) with a value that is realistic rather than pathological. Not fixed here: the scrubber is plan 01's and classifying names as secret-vs-identifier is a change to a security control, out of this plan's task scope. ⭐ CLOSED 2026-09-06: fixed by NON_SECRET_ENV (run.mjs) — an allowlist BY NAME of the three Railway public identifiers, all GitHub vars that already appear verbatim in prod-prober.yml. Proven by self-test scenario 51, which uses the REAL live values ('mt5-gateway', 'production') and a SHORT secret; neutering the allowlist skip reproduces this entry's exact string and the scenario goes RED. ⛔ Entry 36 is left OPEN ON PURPOSE: a minimum-length exemption would have been fail-OPEN on a short real secret, so the mangling it describes is the deliberate fail-safe cost.",
    "status": "fixed",
    "reason": "",
    "recorded_at": "2026-09-05T23:24:29.360Z",
    "resolved_at": null
  },
  {
    "id": 38,
    "kind": "unrun-verify",
    "phase": "164.1",
    "file": ".github/workflows/prod-prober.yml",
    "line": null,
    "description": "prod-prober.yml has NEVER been dispatched: plan 05 was instructed not to touch live infrastructure, so the credential-assert step, the supabase link + masked pooler export, the checksum-verified Railway CLI install and all four live arms are unexecuted on a GitHub-hosted runner. Whether the stored workspace-scoped RAILWAY_API_TOKEN authenticates railway ssh non-interactively from a hosted runner is likewise unmeasured (CONTEXT's own open question). Plan 164.1-06 owns the single first dispatch.",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-09-05T23:44:43.987Z",
    "resolved_at": null
  },
  {
    "id": 39,
    "kind": "unrun-verify",
    "phase": "164.2",
    "file": "supabase/tests/test_sync_status_curated_sentence_survives.sql",
    "line": null,
    "description": "The new gate is UNRUN on shared TEST and will report TEST FAILED (0) there from this PR's first CI run, alongside plan 06's TEST FAILED (0c), until 20260906120000_computation_error_provenance.sql is hand-applied to TEST. Nothing applies migrations to TEST (sql-tests has no apply step; the migrate workflow is PROD-only), so this is EXPECTED and is NOT a coupling regression - the three coupled gates' arms never read the new columns and stay green. Remedy booked as [164.2-TEST-APPLY-PROVENANCE] in TODOS.md: the which-database marker query against TEST_SUPABASE_DB_URL FIRST, then psql -f, never supabase db push (this checkout's CLI is linked to PROD).",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-09-06T17:20:07.111Z",
    "resolved_at": null
  },
  {
    "id": 40,
    "kind": "deviation",
    "phase": "164.2",
    "file": ".planning/WINDOWS.md",
    "line": null,
    "description": "This ledger refused every append during phase 164.2 - plans 06, 07 and 10 each recorded their deviations in their SUMMARY instead. Cause, found by the orchestrator 2026-09-06: row 37's RENDERED TABLE cell carried a closing paragraph (the NON_SECRET_ENV fix, dated 2026-09-06) that the FENCED JSON description did not, so the two sides disagreed and the writer refused. The table was hand-edited without the JSON. Repaired by syncing the JSON description to the table text (a clean prefix, +568 chars); no table cell was hand-edited, and the repair was validated by asserting the prefix invariant before writing. Lesson: hand-editing the rendered table silently disables the ledger for every later phase.",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-09-06T17:20:07.208Z",
    "resolved_at": null
  },
  {
    "id": 41,
    "kind": "deviation",
    "phase": "164.2.1",
    "file": "src/app/(dashboard)/allocations/components/ContributionWizardOverlay.sessionid-fence.test.tsx",
    "line": null,
    "description": "Plan 01 deviated (Rule 3): the spec installs explicit storage doubles instead of the preselect spec's guarded clear — on Node 25 window.localStorage.setItem is not a function, writeWizardState swallows it, and the seed silently never existed (SC-1c was passing vacuously). Fixed and pinned by an applied-ness probe; recorded, not open.",
    "status": "fixed",
    "reason": "",
    "recorded_at": "2026-09-07T02:08:54.153Z",
    "resolved_at": "2026-09-07T02:09:16.275Z"
  },
  {
    "id": 42,
    "kind": "deviation",
    "phase": "164.2.1",
    "file": ".planning/phases/164.2.1-sessionid-fence/164.2.1-02-PLAN.md",
    "line": null,
    "description": "Plan 02 deviated (Rule 3): 8 pre-existing LOCAL-USERNAME violations (the local machine username inside home-directory paths) in this phase's own 01-PLAN/02-PLAN/RESEARCH artifacts reddened check-planning-hygiene and therefore the full suite. Introduced by planning commit bedda506, an ancestor of plan 02's base; wave 1 never ran the full suite so it had not surfaced. The scanner derives its needle from the live USER, so on CI (USER=runner) it never fires - a local-only gate. Fixed at the cause with the repo's own <user> placeholder convention (9 existing .planning files already carry /Users/<user>/ and -Users-<user>-, including <automated> verify commands). Planning artifacts only; no source file, test, criterion or verify command was weakened. Recorded, not open.",
    "status": "fixed",
    "reason": "",
    "recorded_at": "2026-09-07T02:28:20.652Z",
    "resolved_at": "2026-09-07T02:28:47.667Z"
  },
  {
    "id": 43,
    "kind": "unmet-truth",
    "phase": "164.2.1",
    "file": "src/app/(dashboard)/allocations/components/ScenarioCommitDrawer.test.tsx",
    "line": null,
    "description": "FLAKY under full-suite load — a green full suite is therefore not a reliable truth on this file. 'focus management — pre-flight portal + failure transition > submitting → failure transition moves focus to the error banner' failed once in npm test (843 passed | 1 failed), then passed on an immediate identical re-run (844 passed | 14217 tests, exit 0). NOT a 164.2.1 regression, MEASURED not assumed: the file is UNTOUCHED by this phase (git diff --name-only vs merge-base is empty), it is 49/49 green in isolation, and it was green in the pre-wave full run. jsdom focus assertions are timing-sensitive and this component animates. Recorded so the next person who sees a lone red here does not bisect a phase that did not cause it, and so the underlying timing dependence is not mistaken for noise forever.",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-09-07T07:02:20.270Z",
    "resolved_at": null
  },
  {
    "id": 44,
    "kind": "unrun-verify",
    "phase": "164.7",
    "file": ".github/workflows/ci.yml",
    "line": null,
    "description": "sql-gate-lint's two new app-GUC steps have never run on ubuntu; the corpus step is RED by design (12 findings/5 files) until 164.7-05 annotates the tree, so no push or workflow_dispatch is permitted before then",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-09-07T10:11:28.312Z",
    "resolved_at": null
  },
  {
    "id": 45,
    "kind": "deviation",
    "phase": "164.7",
    "file": "supabase/tests/test_analytics_service_settings_and_vault_tick.sql",
    "line": null,
    "description": "MEASURED: a DROP POLICY <t>_service_all mutation twin is UNFALSIFIABLE repo-wide — service_role is BYPASSRLS on the pg-lane and on Supabase, so every *_service_all policy is belt-and-braces and no twin of that shape can bite (no-red R3, 164.7-02-NEUTER.log Part B2). Any existing arm relying on one is worth re-measuring.",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-09-07T10:18:29.567Z",
    "resolved_at": null
  }
]
````
