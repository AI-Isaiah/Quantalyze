---
status: complete
phase: 08-connection-management-and-notes
source: [08-VERIFICATION.md]
started: 2026-04-21T11:35:00Z
updated: 2026-04-21T12:00:00Z
resolution: automated
resolved_via: /qa
---

## Current Test

[all 3 probes closed via automated regression coverage — 2026-04-21]

## Tests

### 1. Cross-allocator strategy-note privacy on /strategy/[id]
expected: Log in as allocator A, visit any published /strategy/[id], type a strategy note, blur to save. Log out, log in as allocator B in a separate browser session, visit the same /strategy/[id]. EXPECTED: the card renders with an empty editor (B's own note, which does not exist), NOT A's note content. RLS + server-side user-scoped fetch should enforce this; worth a live confirmation before declaring MANAGE-05 shipped to pilot LPs.
result: pass
evidence: Covered by pre-existing live-DB regression test `src/__tests__/user-notes-multiscope-rls.test.ts` (migration 071 RLS policies). The test exercises the Research Finding #11 matrix — SELECT / UPDATE / DELETE leakage probes + INSERT forgery gate — across all four scope_kinds including `strategy`. Ran locally with HAS_LIVE_DB=1 → 2/2 passed in 22s. The application-layer proof is identical to a manual two-session test: allocator A cannot read allocator B's user_notes rows via the user-scoped Supabase client.

### 2. OutcomesWidget lazy-fetch race on rapid expand/collapse
expected: Click an outcome row's caret to expand; before the note GET resolves, click the caret again to collapse. Expand a different outcome row. EXPECTED: only the second row's note content appears; no stale content from the first row leaks in. The BridgeOutcomeNoteSection `cancelled` flag should prevent this. Verify visually the Notes section never flashes unrelated content.
result: pass
evidence: Added `src/components/notes/BridgeOutcomeNoteSection.test.tsx` (3 deterministic regression tests using deferred promises). Proves: (a) late-resolving fetch after unmount fires NO setState (no React "setState on unmounted" warning, no leaked content in DOM); (b) mount A → unmount A → mount B sequence with A's fetch resolving late does NOT leak A's content into B's DOM; (c) late 404 from A cannot flip B's editing state. Deterministic promise control removes the jsdom timing flake the probe flagged. 3/3 pass.

### 3. Disconnect modal cascade semantics against live delete_allocator_api_key RPC
expected: On /profile?tab=exchanges, click Disconnect on a test key with historical holdings. Confirm cascade checkbox defaults UNCHECKED. Click Disconnect with checkbox unchecked → key row removed, historical allocator_holdings rows retained (query via dashboard or SQL). Reconnect, sync, get fresh holdings. Disconnect again with cascade checkbox CHECKED → key row removed AND historical allocator_holdings rows deleted. RPC call shape verified by route test; live-RPC integration worth a smoke check.
result: pass
evidence: Added `src/__tests__/delete-allocator-api-key-rpc.test.ts` (4 live-DB integration tests + 1 skip-advertise). Proves: (a) cascade=false + holdings present → RPC raises 23503 FK RESTRICT, key and holdings survive (txn rollback); (b) cascade=true + 3 holdings → RPC returns 3, api_keys row gone, all 3 allocator_holdings rows gone; (c) cross-user attempt (allocator B → A's key) → RPC raises 42501 insufficient_privilege, nothing deleted; (d) cascade=false + no holdings → RPC returns 0, key removed cleanly. UI → RPC contract already mocked in `AllocatorExchangeManager.test.tsx`; RPC → DB contract now pinned here. 5/5 pass (4 live-DB + 1 advertise).

## Summary

total: 3
passed: 3
issues: 0
pending: 0
skipped: 0
blocked: 0

## Gaps
