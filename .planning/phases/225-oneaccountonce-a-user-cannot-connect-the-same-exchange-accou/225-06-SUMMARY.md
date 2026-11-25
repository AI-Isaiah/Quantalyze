---
phase: 225-oneaccountonce-a-user-cannot-connect-the-same-exchange-accou
plan: 06
subsystem: identity
tags: [mt5, venue-server, account-identity, swap-account-slot, parity-fixture]
requires:
  - phase: 225-03
    provides: api_keys.venue_server column and its CHECK
  - phase: 225-04
    provides: public.swap_account_slot (live on PROD, catalogue gate passed)
provides:
  - normaliseVenueServer, sameVenueServer, pickSameAccountHolder (TS) and normalise_venue_server, same_venue_server, pick_same_account_holder (Python), held equal by one hand-typed fixture
  - readLiveSameLoginKeys and swapAccountSlot (TS helpers for plans 07, 08, 11)
  - swap_account_slot in the generated types and in MUTATING_RPC_NAMES
affects: [225-07, 225-08, 225-09, 225-11, 225-12]
tech-stack:
  added: []
  patterns: [hand-typed cross-runtime fixture read by both suites]
key-files:
  created:
    - analytics-service/tests/fixtures/venue_server_identity.json
    - src/lib/venue-identity.ts
    - src/lib/venue-identity.test.ts
    - analytics-service/tests/test_venue_server_identity.py
  modified:
    - analytics-service/services/account_identity.py
    - src/lib/database.types.ts
    - src/__tests__/audit-coverage.test.ts
key-decisions:
  - "Normalisation trims exactly space, tab, CR and LF (the SQL btrim set), not String.trim / str.strip(): all three implementations now agree, including on a vertical tab or a no-break space."
  - "The 128 cap counts code points (char_length), in both runtimes."
  - "swapAccountSlot normalises the server itself, so a blank or over-length value reaches the RPC as no server."
requirements-completed: [CONN-03, MT5D-08]
status: complete
actuals:
  tokens: 26000
  tasks: 2
  commits: 2
plan_head_before: ca82717a5a368c7f6c1e98d294c59202107cb27e
plan_head_after: 11256353f239969b0309a4c1a97ff2b721033096
---

# Phase 225 Plan 06: Venue server vocabulary and the slot-swap helper Summary

One broker-server rule per runtime (normalise, null-is-a-wildcard, tiered holder pick with smallest-id ties), pinned against each other by one hand-typed fixture, plus a TS read of a login's live keys and a swap helper that audits the demoted key and asks for a recompose.

## What was built

- **Fixture** `venue_server_identity.json`: 20 normalise cases, 6 same cases, 14 pick cases. Hand-typed; its `_comment` names both readers and the rule.
- **TS** `src/lib/venue-identity.ts`: the three pure functions, `readLiveSameLoginKeys` (owner, exchange, login and `disconnected_at IS NULL` filters, seven columns, ordered by id, returns the error and never logs it) and `swapAccountSlot` (RPC with login and server explicit, `p_venue_server` only when non-null; on success audits the demoted key with venue and the new holder id only, then enqueues `derive_allocator_equity`; an RPC error or throw returns `{ ok: false, error }` with no audit and no enqueue; an enqueue failure is logged with class and code only and still returns ok).
- **Python** twins in `account_identity.py`, nothing else in the module changed.
- `swap_account_slot` entry in `database.types.ts`; `"swap_account_slot"` in `MUTATING_RPC_NAMES`.

## Verification

- `npx vitest run src/lib/venue-identity.test.ts src/__tests__/audit-coverage.test.ts`: 2 files, 96 tests passed.
- `npx vitest run src/lib/venue-identity.test.ts`: 68 passed. `pytest tests/test_venue_server_identity.py`: 56 passed.
- Neighbour gates (critical-regressions, contracts, gdpr-export-schema, phase-156 wizard writer guard): 14 files, 570 tests passed.
- `npx tsc --noEmit`: clean. `npm run lint` (eslint plus the manifest, route-contract, planning-hygiene and canonical-domain checks): exit 0.
- mypy line: `Success: no issues found in 142 source files` (`mypy --strict --follow-imports=silent --config-file=pyproject.toml services/ routers/ models/ main.py main_worker.py main_worker_healthz.py sentry_init.py`). `ruff check` on the touched Python: all checks passed.

## PROOF-01 record (neuter, RED, byte restore, GREEN)

Backups made with `cp` into the scratchpad, restored with `cp`, checked with `cmp` (silent). No git checkout, restore or stash was used.

1. **TS wildcard.** `sameVenueServer` neutered to `return a === b;`. RED: `× null vs srv-a is same=true`, `× srv-a vs null is same=true`, `× fence: a null-server row is picked for any server`, `× fence: a null new server picks a server-stamped row`, `× tier 2 tie: two null-server rows, the smallest id wins`, `× after_index_refusal still prefers a null-server row over a different one`, plus the reversed-row twins. Restore: `cmp` silent. GREEN: `Tests  56 passed (56)` (the Task 1 file state).
2. **Python wildcard.** `same_venue_server` neutered to `return a == b`. RED: `FAILED tests/test_venue_server_identity.py::test_same_venue_server[None-srv-a]`, `[srv-a-None]`, `test_pick_same_account_holder[fence: a null-server row is picked for any server]`, `[fence: a null new server picks a server-stamped row]`, `[tier 2 tie: two null-server rows, the smallest id wins]`, `[after_index_refusal still prefers a null-server row over a different one]`, plus the row-order twins. Restore: `cmp` silent. GREEN: `56 passed`.
3. **Owner filter (T-225-16).** The `.eq("user_id", args.userId)` line removed from `readLiveSameLoginKeys`. RED: `× filters on owner, exchange, login and liveness, selects exactly the seven columns, orders by id`, `Tests  1 failed | 67 passed (68)`. Restore: `cmp` silent. GREEN: `Tests  68 passed (68)`.

Task 2 followed RED first: with the helpers absent the new behaviour tests failed with `TypeError: readLiveSameLoginKeys is not a function` (12 failed of 68) before the implementation was restored.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Normalisation trims the SQL character set, not `trim()` / `strip()`**
- **Found during:** Task 1 (orchestrator directive plus plan 04 round-1 fix, SF-M4)
- **Issue:** The plan's A1 chose `trim().toLowerCase()` and `.strip().lower()`. Both strip a vertical tab, a form feed and (JS and Python) Unicode spaces that the SQL `btrim(x, E' \t\r\n')` in `swap_account_slot` and `api_keys_venue_server_valid` keeps. A server such as `"\u000bSrv"` would then normalise to a different identity in the app than in the database.
- **Fix:** Both twins trim exactly space, tab, CR, LF, so TS, Python and SQL agree. The fixture pins `"\u000bSrv"` and `" Srv"` as untrimmed, and a lone vertical tab as a kept (non-blank) value, matching the CHECK.
- **Files modified:** src/lib/venue-identity.ts, analytics-service/services/account_identity.py, the fixture
- **Commit:** 6650c1e70

**2. [Rule 1 - Bug] The 128 cap counts code points**
- **Issue:** `char_length` in the CHECK counts code points; a JS `.length` would count UTF-16 units and treat 65 emoji as over the cap.
- **Fix:** TS counts `[...text].length`, Python `len`. Pinned by a direct test in each suite (128 kept, 129 null).
- **Commit:** 6650c1e70

**3. [Rule 2 - Missing critical functionality] `swapAccountSlot` normalises the server it is handed**
- **Issue:** The round-1 review (SF-M4) asked the PR-2 callers to cap the server before the RPC. Doing it once in the helper means no caller can forward a blank or over-length value as a refusal token.
- **Fix:** `normaliseVenueServer` is applied inside the helper; a null result omits `p_venue_server`. Pinned by a test.
- **Commit:** 11256353f

### Process notes

- Task 1 is `type="tracer"`; its verify block (both suites and mypy) was run end to end and passed before Task 2 started, so the expansion ran on a proven slice.
- No `<threat_model>` mitigation was skipped: T-225-16 (owner filter, pinned and PROOF-01d), T-225-17 (the helper forwards only caller-supplied ids; the RPC refuses another owner), T-225-18 (audit metadata is venue and holder id only; no raw error is logged, enqueue logs carry the key id and an error code only).

## Known Stubs

None. Nothing calls `readLiveSameLoginKeys` or `swapAccountSlot` yet (plans 07, 08, 11 do), by design; the audit-coverage gate passes on the tree.

## Threat Flags

None. No new endpoint, auth path or schema change; the helpers use the existing service-role RPC.

## Self-Check: PASSED

Files present: venue_server_identity.json, venue-identity.ts, venue-identity.test.ts, test_venue_server_identity.py. Commits 6650c1e70 and 11256353f are on `worktree-agent-225-06`.
