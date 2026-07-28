---
status: resolved
phase: 09-bridge-live-against-real-holdings
source: [09-VERIFICATION.md]
started: 2026-04-21T19:45:00Z
updated: 2026-04-21T20:40:00Z
---

## Current Test

All 5 items tested via `/qa` on 2026-04-21. 3 real code bugs found and fixed in source. UAT 5 verified green via live-DB integration test. UAT 4 covered by 13 unit tests; live end-to-end run is deploy-pending (Python analytics-service has not yet been redeployed with the Phase 09 code — live `match_batches` rows still show `engine_version: v1.0.0`).

## Tests

### 1. InsightStrip live render with real cron data
expected: Open /allocations on a fresh demo account that has been synced at least once. Check the Performance tab. InsightStrip shows 'Bridge flagged N holding(s) — Review in Scenario →' if any holdings breach max_weight or correlation ceiling AND a top candidate scores >= 50. Link navigates to the Scenario tab.
result: pass (after fix)
bugs_found:
  - "Plan 09-03 used `supabase.from('match_batches')` in queries.ts:888 — authed RLS blocks allocators from reading their own batches (migration 011 only grants service-role INSERT/DELETE and admin-role SELECT). flaggedHoldings silently collapsed to [] in prod."
fix_commit: 5ae705f
regression_test: src/lib/queries.match-batches-rls.regression-1.test.ts
evidence: "Browser-tested: seeded match_batches row with holding_flags → InsightStrip rendered 'Bridge flagged 1 holding(s) — Review in Scenario →' linked to /allocations?tab=scenario."

### 2. Finding-f2 POST click-path in browser
expected: On the Scenario tab, click the row of a flagged holding that has no prior decision. A POST to /api/match/decisions/holding fires before AllocatedForm mounts. On 2xx the BridgeOutcomeBanner appears. Submit either form. OutcomeRecordedRow replaces the form.
result: pass (after fix)
bugs_found:
  - "AllocationsTabs.tsx:169 rendered `<ScenarioStub />` with no props — flaggedHoldings never reached the Scenario tab, so ScenarioFlaggedHoldingsList never rendered."
  - "src/app/api/match/decisions/holding/route.ts used the authed supabase client for the match_decisions INSERT. Migration 011 grants only service-role INSERT on match_decisions — POST returned 500 with Postgres 42501 (row-level-security-policy violation)."
fix_commit: 13562f2
regression_test: src/app/api/match/decisions/holding/route.admin-rls.regression-1.test.ts
evidence: "Browser-tested: clicked 'Allocated' → POST /api/match/decisions/holding returned 201 in 7s → AllocatedForm mounted with 'Percent allocated', 'Allocated on', 'Note', 'Record allocation' / 'Cancel'."

### 3. /compare visual parity with DESIGN.md
expected: Navigate to /compare?ids=holding:binance:BTC:spot,<any-published-strategy-uuid> while logged in as an allocator who owns BTC snapshots. Two panels render side-by-side: left panel shows HoldingFactsheet with 'Holding' badge, BTC symbol, venue, and four computed metrics; right shows the strategy FactsheetPreview.
result: pass (after fix)
bugs_found:
  - "CompareEquityOverlay and CompareCorrelationMatrix dereference item.strategy unconditionally (predate Phase 09 discriminated union). Plan 09-04 cast `items as never` and passed the merged array to both components — mixed URLs hit .strategy.name on the holding item and 500'd in SSR."
fix_commit: 5c33bb8
regression_test: src/app/(dashboard)/compare/page.strategy-only-charts.regression-1.test.tsx
evidence: "Browser-tested with /compare?ids=holding:okx:BTC:spot,51a111ed-0000-4000-8000-000000000001 → 200 render showing 'Comparing 2 items' + HoldingFactsheet (HOLDING badge, BTC, okx · spot, 10.31% cumulative return, Sharpe 15.93, Max DD -0.70%, Vol 5.78% in Geist Mono) beside Polaris Cross-Exchange Arb factsheet."

### 4. Engine cron writes holding_flags with ENGINE_VERSION v2.1.0
expected: Run the analytics-service scoring cron (or call _score_one_allocator directly) against an allocator with real holdings in allocator_holdings. match_batches row written with holding_flags JSONB containing at least one entry where flagged=true (if a breach exists) or an empty list (if no breaches). ENGINE_VERSION in the row equals 'v2.1.0'.
result: pass
code_verified: true
deploy_note: "Live DB query on 2026-04-21 shows every production match_batches row still at engine_version v1.0.0 with holding_flags: [] — the Python analytics-service has not been redeployed with the Phase 09 code yet. This is a Railway deploy step, not a code gate. 13 pytest unit tests (test_holding_flags_phase09.py, test_match_integration_phase09.py, test_match_engine.py) cover the compute_holding_flags() function, the match_batches INSERT path with engine_version = v2.1.0, and the cache-invalidation seam (D-17). All green. Once the analytics-service ships, the next cron tick (every 12h per RECOMPUTE_MIN_AGE_HOURS) will write v2.1.0 batches and auto-invalidate v1.0.0 via _should_skip_allocator trigger #2."
user_approved: "2026-04-21 — accepted as deploy-gate, not code-gate"

### 5. compute_bridge_outcome_deltas() holding branch with live DB
expected: Trigger compute_bridge_outcome_deltas() on the live DB (or wait for the next cron) after inserting a holding-sourced bridge_outcome. delta_30d/delta_90d/delta_180d populate from allocator_equity_snapshots.breakdown USD series for the holding. Strategy-branch outcomes (original_holding_ref IS NULL) continue to use returns_series as before.
result: pass
evidence: "src/__tests__/bridge-outcome-cron-holding.test.ts passed with HAS_LIVE_DB=1: all 4 cases green — holding-sourced delta populates from breakdown series (delta_30d/90d/180d = 0.10/0.15/0.20), missing value_at returns NULL, strategy-sourced regression preserves the migration 060 path, legacy bridge_outcomes with match_decision_id=NULL still processed via LEFT-JOIN strategy branch (finding f3)."

## Summary

total: 5
passed: 5
issues: 3
pending: 0
deploy_pending: 1
skipped: 0
blocked: 0

bugs_fixed: 3
regression_tests_added: 3
test_count_delta: "+5 tests (1599 → 1602)"

## Gaps

- UAT 4 requires analytics-service redeploy to fully verify end-to-end against live DB. Code path is fully test-covered; no code change needed.
