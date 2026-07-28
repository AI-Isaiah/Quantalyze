---
status: partial
phase: 52-per-surface-application-allocator-journey
source: [52-VERIFICATION.md]
started: 2026-06-29
updated: 2026-06-29
---

## Current Test

[awaiting human/CI execution — all deferred-by-construction: seeded CI + authed live]

## Tests

### 1. Seed-gated 2560px ultra-wide reflow sweep
expected: e2e/reflow-sweep-authed.spec.ts "2560px ultra-wide" describe runs green in CI's MA-8 seeded job (no horizontal scroll / overlap at 2560px on /allocations, ?tab=scenario, ?tab=risk, /compare). Structure CI-proven; local is typecheck-only (no network/DB in sandbox).
result: [pending — CI MA-8]

### 2. SVG chart-parity screenshot goldens
expected: Playwright screenshot goldens for FactsheetView + AnalyticalPanels after the @container grid migrations re-baseline intentionally (type-tier refresh) and pass in CI MA-8. Do NOT reflexively --update-snapshots.
result: [pending — CI MA-8]

### 3. Live authed ultra-wide visual canary
expected: authed (qa-demo@quantalyze.app) /allocations, /compare, /discovery at 2560px show the DashboardChrome isWide branch active (1920px fluid-fill, not 1280px cap), KpiStrip 5-col @lg layout, no CompareTable overflow. Needs Playwright MCP / CDP (headless browse can't hydrate authed client React).
result: [pending — authed browser]

## Summary

total: 3
passed: 0
issues: 0
pending: 3
skipped: 0
blocked: 0

## Gaps
