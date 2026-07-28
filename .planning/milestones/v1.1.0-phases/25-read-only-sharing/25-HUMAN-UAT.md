---
status: partial
phase: 25-read-only-sharing
source: [25-VERIFICATION.md]
started: 2026-06-22
updated: 2026-06-22
---

## Current Test

[awaiting human testing — these are post-deploy validations; run at /ship + /qa after the migration applies to the test project (sql-tests CI) and to prod (Supabase Migrate workflow). Live DB + a real browser are required; they cannot run during an autonomous build.]

## Tests

### 1. Live generate → open → revoke → 404 (SHARE-01/02/03 end-to-end)
expected: As an allocator, generate a share link for a saved scenario; open it in a logged-out/incognito browser and see the read-only projection + correlation; revoke it; reload the link and get a 404 immediately (no edge-cache resurrection). Requires the migration applied to a live DB + cross-tab/incognito browser.
result: [pending]

### 2. Recipient page visual + no-leak (SHARE-02)
expected: The recipient page shows scenario name + PROJECTED framing + equity/KPIs/correlation in return/percentage form. It shows NO absolute AUM dollar value, NO holdings, NO api_keys, NO allocator identity, NO peer/percentile panel, NO editing/save controls, NO dashboard nav. Conforms to 25-UI-SPEC.md.
result: [pending]

### 3. Clipboard copy behaviour (SHARE-01)
expected: Clicking Share copies the full URL and shows "Link copied!"; on a real browser where clipboard permission is denied/slow, the honest copy-failure path fires (no false success). navigator.clipboard timing differs from JSDOM.
result: [pending]

## Summary

total: 3
passed: 0
issues: 0
pending: 3
skipped: 0
blocked: 0

## Gaps

(none — automated must-haves 3/3 verified; these 3 items are post-deploy validations only)
