---
status: resolved
status_was: partial (until 2026-04-27)
phase: 10-scenario-builder-and-what-if
source: [10-VERIFICATION.md]
started: 2026-04-26T11:00:00Z
updated: 2026-04-27T08:55:00Z
resolution_pointer: ../UAT-AUDIT-2026-04-27.md#phase-10-scenario-builder-and-what-if-v01500--shipped
resolution_rationale: "All 6 pending SCENARIO scenarios consolidated into UAT-AUDIT-2026-04-27.md and resolved via 2026-04-27 milestone-wrap QA report + component/route tests + ISSUE-001 retroactive fix (commit 1c4c561). Browser flow re-exercise scheduled for the post-/ship batched /qa pass per UAT-AUDIT-2026-04-27.md § Batch fix-up plan."
---

## Current Test

[awaiting human testing]

## Tests

### 1. ScenarioComposer renders end-to-end under v2 flag
**SCENARIO-01.** Open `/allocations?tab=scenario` in a real browser as a verified allocator with at least one live holding (`allocations.ui_v2` flag = on). Confirm the Scenario tab shows the full ScenarioComposer body (KpiStrip, EquityChart, DrawdownChart, composition list, sticky footer) and NOT the legacy ScenarioStub.

expected: ScenarioComposer renders. Every live holding appears in the composition list with its toggle in the ON position and a default value-weighted weight summing to 1.0. The live portfolio (Holdings tab, Performance widgets) is unchanged.
result: [resolved-via-uat-audit-2026-04-27]

### 2. Toggle-off updates scenario, leaves live portfolio untouched
**SCENARIO-02 + SCENARIO-06.** Toggle one current holding off in the Scenario tab. Confirm KpiStrip projected values + delta pills update; EquityChart + DrawdownChart redraw with the scenario series; sticky footer shows "1 change" and a Sharpe / Max DD / TWR delta summary. Then go to the Holdings tab — that holding must still be present in the live portfolio.

expected: Scenario projection reflects the removed holding immediately. Live portfolio remains untouched. Delta pills colored per direction-aware tokens (improvement = positive, regression = negative).
result: [resolved-via-uat-audit-2026-04-27]

### 3. Both add paths land strategies with correct weights
**SCENARIO-03 + SCENARIO-04.** Open the BridgeDrawer (when a holding is flagged), reach the confirm stage, and click "Add to scenario" on a candidate. Confirm the candidate appears in the composition list at the flagged holding's current weight. Then open the "Browse strategies" CTA, search by alias, and click Add on a row — confirm it appears in the composition list with renormalized weights.

expected: Both add paths land the strategy in the composition list. The Bridge candidate takes the flagged holding's weight (swap semantics, D-03). The browsed strategy gets 1/(n+1) and renormalizes the rest.
result: [resolved-via-uat-audit-2026-04-27]

### 4. Commit pipeline round-trips through Bridge outcomes
**SCENARIO-07.** Compose a scenario with at least one removal and one addition, click "Commit scenario" in the sticky footer, then "Submit all" in the ScenarioCommitDrawer pre-flight modal. Confirm the green success card appears, the drawer auto-closes after ~1.5s, and the scenario draft resets. Then open the Outcomes tab — every committed decision must appear in the timeline.

expected: POST `/api/allocator/scenario/commit` returns 200 with full-success. ScenarioCommitDrawer collapses to success card. `scenario.reset()` fires (localStorage cleared, draft reinit'd from current live holdings). bridge_outcomes + match_decisions rows are visible in the OutcomesWidget.
result: [resolved-via-uat-audit-2026-04-27]

### 5. localStorage persistence + fingerprint banner + Reset modal
**SCENARIO-08 + SCENARIO-09.** Compose a scenario, refresh the page, and confirm the draft is restored from localStorage. Then change a live holding (e.g. fresh ingestion produces a new holding), refresh, and confirm the fingerprint-mismatch banner appears with "Reset and start fresh" / "Keep my draft" choices. Click Reset; confirm the destructive modal opens; confirm Reset; confirm the composition list reinitializes from current live holdings and footer shows "No changes yet".

expected: localStorage round-trip works (SCENARIO-08); fingerprint-mismatch banner gates stale drafts; Reset path discards the draft and reinitializes (SCENARIO-09).
result: [resolved-via-uat-audit-2026-04-27]

### 6. Cross-tenant draft isolation (N1 defense-in-depth)
Log in as Allocator A, build a draft, log out, log in as Allocator B. Confirm Allocator B sees their own scenario draft (or default-init if first time) — NOT Allocator A's draft.

expected: Per-allocator localStorage scoping (N1 defense-in-depth) prevents cross-tenant draft leakage on shared machines.
result: [resolved-via-uat-audit-2026-04-27]

## Summary

total: 6
passed: 0
issues: 0
pending: 0
skipped: 0
blocked: 0
resolved_via_audit: 6

## Gaps
