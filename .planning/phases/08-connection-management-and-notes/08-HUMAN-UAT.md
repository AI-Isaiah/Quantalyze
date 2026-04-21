---
status: partial
phase: 08-connection-management-and-notes
source: [08-VERIFICATION.md]
started: 2026-04-21T11:35:00Z
updated: 2026-04-21T11:35:00Z
---

## Current Test

[awaiting human testing]

## Tests

### 1. Cross-allocator strategy-note privacy on /strategy/[id]
expected: Log in as allocator A, visit any published /strategy/[id], type a strategy note, blur to save. Log out, log in as allocator B in a separate browser session, visit the same /strategy/[id]. EXPECTED: the card renders with an empty editor (B's own note, which does not exist), NOT A's note content. RLS + server-side user-scoped fetch should enforce this; worth a live confirmation before declaring MANAGE-05 shipped to pilot LPs.
result: [pending]

### 2. OutcomesWidget lazy-fetch race on rapid expand/collapse
expected: Click an outcome row's caret to expand; before the note GET resolves, click the caret again to collapse. Expand a different outcome row. EXPECTED: only the second row's note content appears; no stale content from the first row leaks in. The BridgeOutcomeNoteSection `cancelled` flag should prevent this. Verify visually the Notes section never flashes unrelated content.
result: [pending]

### 3. Disconnect modal cascade semantics against live delete_allocator_api_key RPC
expected: On /profile?tab=exchanges, click Disconnect on a test key with historical holdings. Confirm cascade checkbox defaults UNCHECKED. Click Disconnect with checkbox unchecked → key row removed, historical allocator_holdings rows retained (query via dashboard or SQL). Reconnect, sync, get fresh holdings. Disconnect again with cascade checkbox CHECKED → key row removed AND historical allocator_holdings rows deleted. RPC call shape verified by route test; live-RPC integration worth a smoke check.
result: [pending]

## Summary

total: 3
passed: 0
issues: 0
pending: 3
skipped: 0
blocked: 0

## Gaps
