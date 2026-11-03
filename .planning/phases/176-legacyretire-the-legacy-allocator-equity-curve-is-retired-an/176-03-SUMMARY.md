---
phase: 176-legacyretire-the-legacy-allocator-equity-curve-is-retired-an
plan: 03
subsystem: allocations-reader
tags: [queries, allocator-book, shared-keys, D-01, 181-sharedkeys, vitest]
status: complete

requires:
  - phase: 176-legacyretire
    provides: "CONTEXT D-01 (founder rule of 2026-10-31, Phase 181 absorbed)"
provides:
  - "allocatorEligibleApiKeyIds equals eligibleKeyIds in getMyAllocationDashboard: a strategy-linked key counts in its owner's allocator book"
  - "the rule stated once, in the field doc, naming eligible_key_predicate and the key-mode fan-out"
affects: [176-05 (managerSide plumbing removal), 176-08, 176-13 (legacy link filters retire with the legacy writer)]

actuals:
  tokens: 13565
  tasks: 2
  commits: 2
plan_head_before: e00141c4fc12f761131d40960509bda86cc03093
plan_head_after: 251e3479637af3b54b8b440ea4a83baf4f794feb
commits: 2

tech-stack:
  added: []
  patterns:
    - "a payload field that mirrors a server-side derive rule states the rule once in its field doc and cites the derive by symbol"

key-files:
  created: []
  modified:
    - src/lib/queries.ts
    - src/lib/queries.my-allocation.test.ts

key-decisions:
  - "Rule 7 conflict surfaced, not averaged: the 2026-10-31 founder rule (D-01) inverts Phase 151 AUM-04 and its own-capital exemption (review [4]); the newer rule governs and the old rationale comments were rewritten, with one sentence of superseded lineage kept."
  - "The strategies read still projects capital_ownership although nothing reads the mark now: left in place (surgical; a note says so) rather than changing a query shape in a reader plan."
  - "The Sentry tag value role_discriminator_read_failed is kept (dashboards may filter on it) with a comment that the name is historical."

requirements-completed: [SC-1, 181-SC-1, 181-SC-3]
---

# Phase 176 Plan 03: a strategy-linked key also counts in its owner's allocator book Summary

`allocatorEligibleApiKeyIds` in `getMyAllocationDashboard` is now `eligibleKeyIds` (one assignment, no link subtraction, no capital-mark exemption), so the TS reader agrees with what the derive already composes; the rule is stated once in the payload field doc.

## What was done

**Task 1 (tracer), commit 3c8ed0b42.** Rewrote the two describe blocks of `src/lib/queries.my-allocation.test.ts` (Phase 151 AUM-04 and own-capital review [4]) to the D-01 rule, ran them against the unchanged base (RED), then replaced the `strategyLinkedKeyIds` computation and filter with `const allocatorEligibleApiKeyIds = eligibleKeyIds;` and dropped the now-unused `isAllocatable` import (`CapitalOwnership` is still used elsewhere in the file).

**Task 2, commit 251e34796.** Rewrote the AUM-04 rationale comment block above the rule to the D-01 rule (founder quote from CONTEXT D-01, derive and fan-out parity, the link reads kept for the reconstruct note only, one sentence of Phase 151 lineage). Put the rule once in the `allocatorEligibleApiKeyIds` field doc, naming `eligible_key_predicate` in `analytics-service/services/allocator_equity_derive.py` and `enqueue_derive_broker_dailies_for_allocator_keys`. Updated `deriveStrategyLinkedKeyIds`'s doc to its two remaining callers (`deriveStrategylessKeys`, `reconstructCappedKeyIds`). Reworded the link-read console.error to "strategy-link read failed (the reconstruct note names nothing)" and pinned it in both degradation tests. Other stale prose (batch-read comment, strategies-read comment, reconstruct comment, the baseline comment about the "151 role split") was brought in line.

## Test changes (what the tests now prove)

- Every eligible key, linked by `strategies.api_key_id` or `strategy_keys`, `own_capital`, `team_review` or unmarked, is in `allocatorEligibleApiKeyIds`, in `AUM04_KEYS`/`OWN_CAPITAL_KEYS` order; a linked key carrying the only series opens `bookEntryGateSatisfied`.
- "no contributing keys" now means no series at all (gate false on absence of a series, never on a link).
- The AUM-04 [6] baseline arms keep their discriminating negative with a different rival: a disconnected key (`k-gone`) with a stale series and a holding, which the payload's raw per-key map carries but the contributing set must not. Hand-computed AUM: 105,000 over the three contributing keys, custody total 125,000.
- T-176-09 arm: a link to a disconnected owned key and a link naming a key id outside the owner's key set add nothing to the book (this arm passes at base too; it guards the mitigation, it is not part of the RED set).
- Degradation arms: a link-read failure leaves `allocatorEligibleApiKeyIds` equal to the healthy run's, the Sentry warning still fires, and the console message names the reconstruct note.

## RED-then-GREEN evidence

- Base (queries.ts unchanged, rewritten tests): `npx vitest run src/lib/queries.my-allocation.test.ts -t "allocator book"` -> `Tests  11 failed | 6 passed | 171 skipped (188)`, log `/tmp/legacyretire-03/red-at-base.log`. One failing assertion quoted from it: `AssertionError: expected [ 'k-bybit', 'k-okx' ] to deeply equal [ 'k-bybit', 'k-deribit-1', …(6) ]` (founder census END-TO-END test).
- After the one-line change: whole file `Tests  188 passed (188)`, log `/tmp/legacyretire-03/t1.log`.
- Task 2 message pin RED on the old text: `Tests  2 failed | 186 passed (188)` (`AssertionError: expected "error" to be called with arguments: [ StringContaining{...}, Anything ]`), log `/tmp/legacyretire-03/t2-red.log`; GREEN after the reword.
- Baseline of the file before any edit: `Tests  184 passed (184)`.

## Verification run

- `npx vitest run src/lib/queries.my-allocation.test.ts src/lib/queries.test.ts`: 2 files, 346 passed.
- `npx vitest run src/lib/queries` (22 files): 524 passed, 0 failed.
- `npx tsc --noEmit` and `npm run typecheck`: exit 0.
- `npx eslint src/lib/queries.ts src/lib/queries.my-allocation.test.ts`: no output.
- `node scripts/verify-plan-anchors.mjs <plan>`: OK, 7 claims.
- Acceptance greps: `strategyLinkedKeyIds.has(` and `book gate degrades to allocator-eligible` print nothing in `src/lib/queries.ts`; `eligible_key_predicate` present; `git status --porcelain` empty after the Task 2 commit.

## Deviations from Plan

None - plan executed as written. Two judgment calls inside the plan's latitude: (1) the tests' rival for the AUM-04 [6] discriminating negative moved from a manager-side key to a disconnected key, because the linked key now legitimately contributes; (2) the unused `isAllocatable` import was removed under the "remove an import only if no other use" instruction (the remaining mentions are comments only).

## Known Stubs

None.

## Threat Flags

None. T-176-09 is mitigated by construction (`eligibleKeyIds` comes from the owner's own RLS-scoped key read) and armed by the new test above.

## CHANGELOG inputs

- Changed: owners who run strategies now see their linked keys in their own allocator book (the "{N} of {M} keys not yet contributing" count, book entry, and the live-book baseline all count every eligible key). This follows what the allocator derive already composed. Supersedes Phase 151 AUM-04 and its own-capital exemption.
- Notes: the Sentry tag value `role_discriminator_read_failed` is unchanged; the link-read warning now describes the reconstruct note, since book membership no longer depends on those reads.
- Not changed: `managerSideKeyIds` / `excludedManagerSide` plumbing stays inert (plan 05 books its removal); the legacy SQL and Python link filters retire with the legacy writer (plans 08, 13).

## Self-Check: PASSED

- FOUND: src/lib/queries.ts, src/lib/queries.my-allocation.test.ts (modified)
- FOUND commits: 3c8ed0b42, 251e34796 (both ancestors of HEAD)
