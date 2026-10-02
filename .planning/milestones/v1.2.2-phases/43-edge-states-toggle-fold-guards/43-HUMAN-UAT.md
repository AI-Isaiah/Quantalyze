---
status: partial
phase: 43-edge-states-toggle-fold-guards
source: [43-VERIFICATION.md]
started: 2026-06-26
updated: 2026-06-26
---

## Current Test

[awaiting human testing — deferred-by-construction post-deploy authed canaries;
automated structure is CI-proven (4/4 GUARDs verified, full suite 6768 green,
coverage ratchet green, axe e2e CI-wired). Headless browse cannot hydrate authed
pages, and nothing is deployed yet — these run post-deploy on a logged-in browser.]

## Tests

### 1. Live folded layout
expected: On a multi-key seeded authed account at /allocations?tab=scenario, the
"Data sources" CollapsibleSection renders as a factsheet-shaped section above the
factsheet body (compose + read on one surface), with the mount-seam padding
correct (no compound vertical gap). Structure (section present, no storageKey,
role=group rows) is unit-proven; this confirms the visual seam + ordering on a
real multi-key render.
result: [pending]

### 2. Live footer gate threading
expected: On the composer composed surface, the "Page 1 / 1" page-stamp is ABSENT
while the disclaimer still renders — confirming `scenarioMode={true}` threads
correctly through the real ScenarioFactsheetChart → FactsheetBody → FactsheetFooter
chain (not just unit-test mocks). The real /factsheet/[id]/v2 route still shows
the stamp (byte-identity, GUARD-02-pinned).
result: [pending]

## Summary

total: 2
passed: 0
issues: 0
pending: 2
skipped: 0
blocked: 0

## Gaps
