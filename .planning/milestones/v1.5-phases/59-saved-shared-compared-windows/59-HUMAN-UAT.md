---
status: complete
phase: 59-saved-shared-compared-windows
source: [59-VERIFICATION.md]
started: 2026-07-02
updated: 2026-07-03
disposition: closed-by-phase-61-authed-canary (see 61-VERIFICATION.md §B + 2026-07-03 addendum)
---

## Current Test

[deferred — all four items are authed-prod round-trips through the deployed SECDEF RPC /
live composer; they cannot be validated against the un-deployed local branch. Phase 61
(Authed Prod QA Canary, VERIFY-02) verifies the whole coverage-window chain live.]

## Tests

### 1. Save → reopen at owner's window (live)
expected: On authed prod /allocations, apply a window in the composer, save the scenario,
reopen it — the composer displays and recomputes at the saved window (PERSIST-01).
result: [pending — Phase 61 canary]

### 2. Shared link recomputes at owner's window (live)
expected: A minted share link opened as the recipient shows the same effective window +
metrics as the owner's view; no api_key/value_usd/holdings data anywhere in the payload
(PERSIST-02).
result: [pending — Phase 61 canary]

### 3. Pre-v1.5 saved scenario provenance note (live)
expected: Reopening a pre-v1.5 (v2, windowless) saved scenario shows the provenance note
("This saved scenario predates coverage windows — showing the common period · Show full
range") and computes at the intersection; the scenario is NOT dropped/reset (PERSIST-01).
result: [pending — Phase 61 canary]

### 4. Compare across heterogeneous windows (live)
expected: Comparing 2+ saved scenarios with different persisted windows shows each column
at its own window with the per-column `· {start}–{end}` label; the live-book column stays
on full-history union (PERSIST-03).
result: [pending — Phase 61 canary]

## Summary

total: 4
passed: 0
issues: 0
deferred: 4 (all carried to Phase 61 authed prod canary — automated 12/12 already verified)
