---
status: partial
phase: 151-aum-a-book-you-can-reach-and-a-size-you-can-set
source: [151-VERIFICATION.md]
started: 2026-08-07T15:55:00Z
updated: 2026-08-07T15:55:00Z
---

## Current Test

[awaiting human testing — all items are POST-DEPLOY PROD checks]

## Tests

### 1. Founder's real book reaches "From my book"
expected: On the founder's PROD account (8 active keys; 3 deribit + 3 mt5 with zero per-key dailies), the composer shows the "From my book" segment; entering book mode shows the 2 contributing keys (bybit, okx) and no partial-book note names manager-side keys. AUM pre-fills from live holdings and stays editable.
result: [pending]

### 2. MT5 holdings row lands on PROD after sync
expected: With worker `MT5_ENABLED=true`, after the 04:00 cron or a "Sync now" on an mt5 key: one holdings row per MT5 account (symbol `ACCOUNT-…`), `sync_status` is `complete` (or `complete_with_warnings` with human copy), never a raw Python AttributeError in `sync_error`.
result: [pending]

### 3. Stale sync_error clears on key 46293712-59e6-46c0-8204-5dd32afe2503
expected: After the first successful post-deploy sync, the stored "'Mt5Session' object has no attribute 'fetch_balance'" is replaced; the column never again shows raw exception text.
result: [pending]

### 4. Blank-slate manual-AUM commit completes on live RPC
expected: A blank-mode scenario with only added strategies, manual AUM set (e.g. $1,000,000), dollar sizing per strategy → "Commit scenario" succeeds against live `commit_scenario_batch` (no `portfolio_fingerprint_stale` 409); audit trail shows `_size_source: "client_manual_aum"` ranked below server truth.
result: [pending]

## Summary

total: 4
passed: 0
issues: 0
pending: 4
skipped: 0
blocked: 0

## Gaps
