---
status: partial
phase: 150-own-03-the-wizard-asks-whose-capital-this-is
source: [150-VERIFICATION.md]
started: 2026-08-07T00:20:00Z
updated: 2026-08-07T00:20:00Z
---

## Current Test

[awaiting human testing]

## Tests

### 1. Allocator wizard — the question, the default, the cull
expected: At allocator key-add the capital question renders first in the categorization step, defaults to team_review, copy is crisp; culled fields sit behind an optional disclosure; finalize persists the mark (wizard→RPC→post-RPC mark UPDATE live, not mocked).
result: [pending]

### 2. Manager wizard — no question, identical step
expected: A manager onboarding a key never sees the capital question; the server no-op arm logs its warn only when a mark unexpectedly reaches the unified arm.
result: [pending]

### 3. ⚠️ HIGHEST RISK — zero-portfolio allocator allocates
expected: An allocator with NO real portfolio allocates to a marked own-capital strategy from Holdings; the lazy-provisioning arm mints the is_test=false portfolio (RLS INSERT check, partial unique index, and the SECDEF seed-trigger repair all hold at runtime); the position and its weight_snapshots companion row land.
result: pass — browser-driven 2026-08-07 (localhost dev server against TEST DB, fresh sentinel allocator with zero portfolios). Holdings STRATEGIES panel rendered the marked strategy with the Own-capital tag, honest em-dashes and "— not allocated"; AllocateDialog accepted $250,000; row flipped to 100.00% / $250,000 / 0d / "Edit allocation…". DB verified: is_test=false portfolio minted by lazy provisioning, position row landed through the D-03-A trigger, weight_snapshots companion row seeded (the write that 42501'd before migration 20260806130000). Evidence: .gstack/qa-reports/screenshots/uat3-*.png

### 4. Flip own→team with a live allocation
expected: Marking a strategy team_review while a position is live shows the 409 confirm arm naming the amount; confirming runs ONE transaction (position removed + mark set); cancel leaves everything untouched; no silent removal.
result: pass — browser-driven 2026-08-07. Mark dialog on /my-strategies row; picking the team option surfaced the confirm arm naming the exact $250,000 allocation with the destructive action styled red and a safe default; confirming flipped the mark AND removed the position in one RPC transaction (DB: capital_ownership=team_review, 0 positions). Row re-rendered with the muted Team-review tag. Evidence: .gstack/qa-reports/screenshots/uat4-*.png

### 5. Rename coherence + pseudonymity + published absence
expected: Owner rename of a private/draft strategy renders coherently on my-strategies, own Browse rows, owner factsheet and holdings alias; public codename/disclosure redaction is byte-untouched; a published strategy shows no rename affordance; anon-after-owner-view cache isolation holds.
result: pass (core arc) — browser-driven 2026-08-07. Rename dialog states the pseudonymity contract in its own copy ("Only you see this name. Public surfaces keep showing the codename."); rename persisted (DB: name updated, codename untouched, status private) and renders on /my-strategies. Published-absence + cache-isolation arms rest on the verifier's code-level confirmation (rename route 404s non-private/draft; lane state kept out of the shared public cache) — no published fixture was owned by the UAT user. Minor observation: the row needed a reload to show the new name on the dev server.

### 6. TEST database state
expected: Both migrations applied to TEST and the three DB test files green there.
result: pass — resolved by orchestrator evidence 2026-08-06/07: `apply_migration` runs for 20260806120000 (initial + rev3) and 20260806130000 all succeeded with their self-verify DO-blocks (which RAISE on any missing piece); test_capital_ownership_column.sql, test_capital_ownership_allocation_guard.sql (incl. cases 7d–7i) and test_weight_snapshot_seed_secdef.sql each ran exception-free against qmnijlgmdhviwzwfyzlc via MCP execute_sql. CI sql-tests re-enforces at PR time.

## Summary

total: 6
passed: 4
issues: 0
pending: 2
skipped: 0
blocked: 0

## Gaps
