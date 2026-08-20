---
phase: 136-mt5recon-equity-reconstruction
plan: 02
subsystem: api
tags: [asset-class, annualization, closed-sets, mt5, sharpe, "#597", isCryptoExchange]

# Dependency graph
requires:
  - phase: 135-mt5src
    provides: "mt5 in SUPPORTED_EXCHANGES + the three mt5-accepting key routes"
  - phase: 136-01
    provides: "Python CRYPTO_VENUES registry + √252 mutation guard (the mirror this TS subset must match)"
provides:
  - "explicit CRYPTO_EXCHANGES subset (binance/okx/bybit/deribit/sfox) — the TS mirror of Python CRYPTO_VENUES"
  - "isCryptoExchange narrowed off CRYPTO_EXCHANGES (returns false for mt5)"
  - "venue-aware asset_class stamps at create-with-key + finalize-wizard (mt5 -> 'traditional' √252)"
affects: [137-mt5conc, 138-mt5ui, "any #597 annualization surface (OG card, scenario blend, peer-rank)"]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "closed-set subset via `as const satisfies readonly SupportedExchange[]` — compile-time subset guarantee (CRYPTO_EXCHANGES ⊂ SUPPORTED_EXCHANGES)"
    - "literal-mirror test pinning a TS registry value-for-value against its Python sibling (drift guard)"
    - "venue-aware asset_class derive: resolve the linked api_keys.exchange, stamp isCryptoExchange(exchange) ? 'crypto' : 'traditional'"

key-files:
  created: []
  modified:
    - src/lib/closed-sets.ts
    - src/lib/closed-sets.test.ts
    - src/app/api/strategies/create-with-key/route.ts
    - src/app/api/strategies/create-with-key/route.test.ts
    - src/app/api/strategies/finalize-wizard/route.ts
    - src/app/api/strategies/finalize-wizard/route.test.ts
    - src/app/api/keys/sync/route.test.ts

key-decisions:
  - "CRYPTO_EXCHANGES is the crypto signal (not SUPPORTED_EXCHANGES membership); mt5 is a SUPPORTED but non-crypto venue"
  - "Single-key mt5 stamps 'traditional' at BOTH key routes; the COMPOSITE 'crypto' hardcode is consciously retained (mt5 composite member fails loud at the worker stitch unknown-venue gate — out of 136 scope)"
  - "On a finalize venue-lookup fault, apiKeyExchange=null -> isCryptoExchange(null)=false -> 'traditional' (conservative √252 default, non-destructive: worker re-derives from venue)"

patterns-established:
  - "Registry subset + literal-mirror drift guard: CRYPTO_EXCHANGES satisfies SupportedExchange[] and is pinned equal to Python CRYPTO_VENUES"
  - "Venue-aware asset_class at trust-boundary key routes replaces unconditional 'crypto' literals"

requirements-completed: [MT5RECON-02]

# Metrics
duration: ~30min
completed: 2026-07-23
---

# Phase 136 Plan 02: TS Annualization Narrowing (MT5 = √252) Summary

**MT5 now stamps `asset_class='traditional'` end-to-end on the TS side: `isCryptoExchange` is narrowed to an explicit `CRYPTO_EXCHANGES` subset (mirroring Python `CRYPTO_VENUES`) that excludes mt5, and both key routes derive the stamp venue-aware — closing the MT5 instance of the DEFERRED unknown→crypto latent bug (√365 would inflate MT5 Sharpe ~×1.20 vs peers).**

## Performance

- **Duration:** ~30 min
- **Started:** 2026-07-23T21:24:00Z
- **Completed:** 2026-07-23T21:34:00Z
- **Tasks:** 2 (both TDD)
- **Files modified:** 7

## Accomplishments
- Added `CRYPTO_EXCHANGES` (binance/okx/bybit/deribit/sfox) `as const satisfies readonly SupportedExchange[]` — a compile-time-enforced subset of `SUPPORTED_EXCHANGES`, the TS mirror of Python `closed_sets.CRYPTO_VENUES`.
- Narrowed `isCryptoExchange` to test the crypto subset (was: `SUPPORTED_EXCHANGES` membership) → `isCryptoExchange('mt5') === false`, the five crypto venues stay true.
- Made both force-derive seams venue-aware: `create-with-key` stamps `isCryptoExchange(exchange) ? 'crypto' : 'traditional'`; `finalize-wizard` resolves the linked `api_keys.exchange` and applies the same rule on the single-key arm (composite arm unchanged).
- Literal-mirror test pins `CRYPTO_EXCHANGES == CRYPTO_VENUES` member-for-member (T-136-07 drift guard); wiring tests prove the finalize path INVOKES the venue-aware derive (a neutered call site reddens).

## Task Commits

Each task was committed atomically (TDD RED → GREEN):

1. **Task 1 (RED): pin isCryptoExchange('mt5') false + CRYPTO_EXCHANGES mirror** - `929f995d` (test)
2. **Task 1 (GREEN): narrow isCryptoExchange to explicit CRYPTO_EXCHANGES subset** - `7a8b25f2` (feat)
3. **Task 2 (RED): pin mt5 -> asset_class 'traditional' at both key routes** - `d6444b3f` (test)
4. **Task 2 (GREEN): venue-aware asset_class stamps at key routes** - `54a43703` (feat)
5. **Deviation (Rule 3): resolve keys/sync composite asset_class tripwire for mt5** - `5c81707a` (test)

_Plan metadata (SUMMARY/STATE/ROADMAP) is in gitignored `.planning/` — not committed per project convention._

## Files Created/Modified
- `src/lib/closed-sets.ts` - Added `CRYPTO_EXCHANGES` subset; narrowed `isCryptoExchange` to test it; updated docstrings (MT5RECON-02).
- `src/lib/closed-sets.test.ts` - Rewrote the `#597` crypto block: five venues true / mt5 false; added CRYPTO_EXCHANGES literal-mirror + subset assertions; wizard-default now composes mt5 → √252.
- `src/app/api/strategies/create-with-key/route.ts` - Replaced unconditional `{ asset_class: 'crypto' }` with venue-aware derive; updated comment.
- `src/app/api/strategies/create-with-key/route.test.ts` - Added mt5 → 'traditional' wiring test (okx → 'crypto' regression already present).
- `src/app/api/strategies/finalize-wizard/route.ts` - Added owner-scoped `api_keys.exchange` resolve; made the apiKeyId arm venue-aware; extended the F-1b comment (worker CRYPTO_VENUES agrees by construction).
- `src/app/api/strategies/finalize-wizard/route.test.ts` - Added mt5 → 'traditional' wiring test + bybit → 'crypto' regression.
- `src/app/api/keys/sync/route.test.ts` - Updated the composite asset_class tripwire (deviation, below).

## Decisions Made
- **Crypto signal = CRYPTO_EXCHANGES membership**, not SUPPORTED_EXCHANGES. `mt5` clears the key-save allowlist but is forex/CFD = traditional √252.
- **Composite arm stays `'crypto'` at both keys/sync and finalize-wizard** (per plan scope): an mt5 composite member fails LOUD at the worker stitch unknown-venue gate. The worker's √365-vs-asset_class cross-check reads Python `CRYPTO_VENUES` (also excludes mt5), so the TS and worker sides agree by construction.
- **Finalize venue-lookup fault → 'traditional'** (conservative √252 default). Non-destructive: write is non-blocking and the worker re-derives asset_class from the venue; a transient blip can only under-state (never over-state) the crypto clock.
- **MetadataStep.tsx left untouched** (Rule 3, per plan): mt5 becomes UI-unlocked, acceptable since the MT5 wizard is dark behind `NEXT_PUBLIC_MT5_ENABLED` (Phase 138) and finalize's venue-aware derive is authoritative.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Resolved the keys/sync composite asset_class tripwire for mt5**
- **Found during:** Task 2 (regression sweep of `isCryptoExchange` consumers)
- **Issue:** `src/app/api/keys/sync/route.test.ts` carries a UAT tripwire that pins `SUPPORTED_EXCHANGES` to the 5-venue crypto set and reddens "the instant the supported set changes, forcing whoever adds the venue to review the composite `asset_class='crypto'` hardcode." Phase 135 added mt5 to `SUPPORTED_EXCHANGES`, so this test was **already red on the branch** (verified at `e1574a35`, before my commits). STATE.md line 79 confirms Phase 135 deliberately deferred the √252 divergence to "Phase 136 / MT5RECON-02", making this plan the owner of the resolution. This file is not in the plan's `files_modified`, but leaving CI red violates fail-loud.
- **Fix:** Updated the tripwire to pin the 6-venue key-save set (incl. mt5) plus `CRYPTO_EXCHANGES` (mt5 excluded), and rewrote the comment to record the MT5RECON-02 conscious review: single-key venue-aware (this plan); composite `'crypto'` hardcode deliberately retained (mt5 composite fails loud at the worker). The keys/sync composite *code* was intentionally NOT changed — the plan scopes the composite arm as staying `'crypto'`. The test still reddens on the next venue addition.
- **Files modified:** src/app/api/keys/sync/route.test.ts
- **Verification:** `npx vitest run src/app/api/keys/sync/route.test.ts` → 19 passed; eslint clean.
- **Committed in:** `5c81707a`

---

**Total deviations:** 1 auto-fixed (1 blocking / pre-existing canary on MT5RECON-02's surface)
**Impact on plan:** No scope creep beyond the requirement. Only a test expectation was updated to record the conscious review the tripwire was designed to force; no product-code change outside the plan's declared files.

## Issues Encountered
- **Self-inflicted stash contamination during the regression sweep (recovered, zero data loss):** while confirming the tripwire was pre-existing, a `git stash push -- src/` found no changes (working tree clean post-commit) so a subsequent `git stash pop` popped a **foreign** stash (phase-83 smoothed-mtm WIP), producing merge conflicts in 4 unrelated files (TODOS.md, factsheet v2 page, composite-read-path .ts/.test.ts). Recovered by `git checkout HEAD -- <the 4 files>`; the foreign stash was preserved intact (`git stash list` still shows stash@{0}). Lesson reinforced (MEMORY): the stash stack is shared across worktrees/branches — never `git stash pop` blind. My 5 commits were never at risk (all changes were committed before the sweep).

## Threat Flags
None — no new security surface. The exchange value is already zod-validated at route entry (`exchangeEnum`); this plan only changes the asset_class metadata derived from it (T-136-05/06/07 mitigations satisfied: closed-set allow-list, traditional stamp, literal mirror test).

## Self-Check: PASSED
- `src/lib/closed-sets.ts` contains `CRYPTO_EXCHANGES` — FOUND
- `isCryptoExchange('mt5') === false` — verified green in closed-sets.test.ts
- create-with-key + finalize-wizard import `isCryptoExchange`; no unconditional `crypto` literal remains in the create-with-key update call — FOUND
- Commits `929f995d`, `7a8b25f2`, `d6444b3f`, `54a43703`, `5c81707a` — all in `git log`
- `npx tsc --noEmit` clean; 157 tests green across closed-sets + create-with-key + finalize-wizard + keys/sync + scenario-adapter

## Next Phase Readiness
- TS annualization surface now honest for MT5 (√252). Python side (136-01) already excludes mt5 from CRYPTO_VENUES; the two registries are pinned equal.
- Phase 137 (MT5CONC) and 138 (MT5UI) unblocked from this seam. No blockers.

---
*Phase: 136-mt5recon-equity-reconstruction*
*Completed: 2026-07-23*
