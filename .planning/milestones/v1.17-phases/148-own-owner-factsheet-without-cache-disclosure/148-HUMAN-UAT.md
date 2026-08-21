---
status: partial
phase: 148-own-owner-factsheet-without-cache-disclosure
source: [148-VERIFICATION.md]
started: 2026-08-05T13:40:00Z
updated: 2026-08-05T13:40:00Z
---

## Current Test

[awaiting human testing — all four items need a deployed runtime]

## Tests

### 1. Owner views own draft on PROD
expected: Owner GETs their own unpublished strategy's factsheet → 200, full panels, "Unpublished — only you can see this" banner above the masthead.
result: [pending]

### 2. Adversarial anon 404 (SC2 live proof)
expected: Immediately after the owner render, an anon GET of the same id → 404. The live cross-request cache proof (unit layer models unstable_cache with a spy).
result: [pending]

### 3. Wizard link end-to-end
expected: After a real finalize, the "View full factsheet →" link appears at the success step and opens the full factsheet in a new tab — never notFound().
result: [pending]

### 4. Banner visual/print conformance
expected: Banner matches UI-SPEC tokens in the browser; prints (no print-hiding class).
result: [pending]

## Summary

total: 4
passed: 0
issues: 0
pending: 4
skipped: 0
blocked: 0

## Gaps
