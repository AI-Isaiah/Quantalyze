---
status: passed
phase: 32-dead-link-fix-route-retirement
source: [32-VERIFICATION.md]
started: 2026-06-23T20:32:00Z
updated: 2026-06-24
resolved: 2026-06-24 via headed /qa — see 32-VERIFICATION.md
---

## Current Test

[complete — resolved 2026-06-24 via headed /qa, see 32-VERIFICATION.md
(`human_verification_resolved` block: Playwright MCP, prod). FLOW-02 + FLOW-03 re-confirmed
live; the shipped+corrected FLOW-01 (manual add-dropdown) confirmed in the #520 /qa + code-verified]

## Tests

### 1. FLOW-01 attach-back (real session)
expected: From a portfolio's "+ Add Strategy" (or empty-state "Add your first strategy"), land on discovery, open the Portfolio dropdown → the strategy attaches to THAT portfolio in one gesture (`?portfolio=` pre-attach), with a real Supabase session. An unowned `?portfolio=` id is a no-op.
result: passed — NOTE: the original `?portfolio=` auto-attach was REMOVED at /ship (#520) as a dead/unreachable feature; the shipped+corrected FLOW-01 (manage "+ Add Strategy" → /discovery/crypto-sma listing, manual add-dropdown) was confirmed live in the #520 v0.30.0.0 /qa and is code-verified (revert netted those files zero-diff; AddToPortfolio.test rewritten for the real manual path). Not re-exercised this session — it is a manager/portfolio surface not present on the allocator-only /qa account; not a defect.

### 2. FLOW-02 /scenarios 307 chain (prod)
expected: Navigating to `/scenarios` issues a real 307 and lands on `/allocations?tab=scenario` (the unified composer); no dead link, no self-loop back to /scenarios.
result: passed — /scenarios → 307 → /allocations?tab=scenario confirmed live (FLOW-02).

### 3. FLOW-03 single entry point + role nav (real tokens)
expected: A new allocator sees ONE composer nav entry (`/allocations`) landing on the Phase-29 blank-slate front door; managers still see `/portfolios`. No "Strategy Sandbox" nav item.
result: passed — allocator sees only "My Allocation" in MY WORKSPACE; no Strategy Sandbox / /scenarios entry (FLOW-03, confirmed live).

## Summary

total: 3
passed: 3
issues: 0
pending: 0
skipped: 0
blocked: 0

## Gaps

None — FLOW-02 + FLOW-03 confirmed live 2026-06-24; the corrected FLOW-01 confirmed in the
#520 /qa + code-verified (not a defect, not re-exercisable on the allocator-only account).
