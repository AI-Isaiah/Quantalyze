---
phase: 200-managerkeys-keys-names-and-adding-a-strategy-each-have-one-p
plan: 07
subsystem: ui
tags: [profile, api-keys, feeds, key-manager, delete-confirm, role]
requires:
  - phase: 200-01
    provides: GET /api/keys/feeds, additive `feeds` on GET /api/keys/[id]/memberships, KeyFeed
  - phase: 200-02
    provides: key-storage copy and census that this plan must keep green
provides:
  - "Profile tab `API keys` (key `exchanges`) for manager, allocator and both"
  - "feeds line per key on the Profile key manager (active and Disconnected cards)"
  - "Disconnect / delete confirm that names the strategies the key feeds"
affects: [200-08, 200-10]
tech-stack:
  added: []
  patterns:
    - "bounded never-throw JSON reader shared by the two reads; ordered answers via a sequence ref"
key-files:
  created:
    - src/components/exchanges/AllocatorExchangeManager.feeds.test.tsx
  modified:
    - src/components/auth/ProfileTabs.tsx
    - src/components/auth/ProfileTabs.test.tsx
    - src/app/(dashboard)/profile/page.tsx
    - src/components/exchanges/ExchangesTabContent.tsx
    - src/components/exchanges/AllocatorExchangeManager.tsx
    - src/components/exchanges/AllocatorExchangeManager.test.tsx
key-decisions:
  - "No role gate on the tab: every SIGNUP_ROLES value can hold keys, so the three allocator-only gates on `exchanges` were dropped rather than replaced (no canManageKeys prop)."
  - "AEM `role` is optional and defaults to allocator (126 existing render sites, and AEM was allocator-only before); ExchangesTabContentProps.role is required, so every production path passes it."
  - "For a manager the page passes activePortfolio null and hasHoldings null (unknown), never false, so the subtitle cannot claim 'no open positions yet'."
  - "A completed Disconnect also re-reads the feeds (AEM's 'delete' is a soft disconnect), not only a hard delete."
status: complete
requirements-completed: [ROUTE-09, LEAN-04]
commits: 4
plan_head_before: 95af12c315c19875cc9c774e3894f1effd878a6e
plan_head_after: d8822bfae0aad6d81fdb65c35fb049a7c7416cf1
actuals:
  tokens: 21000
  tasks: 2
  commits: 4
---

# Phase 200 Plan 07: One key manager on Profile, with what each key feeds Summary

The Profile `exchanges` tab is now `API keys` for every role, and each key card and its Disconnect confirm name the strategies the key feeds (links per role), saying "could not check" instead of "feeds nothing" when a read fails.

## What was built

- `ProfileTabs`: `exchanges` entry drops `allocatorOnly`, label `API keys`; `exchanges` leaves `ALLOCATOR_ONLY_KEYS` (so a manager's `?tab=exchanges` is honoured); the panel is no longer behind `isAllocator` and forwards `role`. Mandate and security stay allocator-only on all three gates.
- `profile/page.tsx`: `getUserApiKeys` loads for every role; the Active Allocation lookup and holdings count stay allocator-only; a manager gets `activePortfolio: null`, `hasHoldings: null`.
- `ExchangesTabContent` takes a required `role` and passes it to `AllocatorExchangeManager`.
- `AllocatorExchangeManager`: one `GET /api/keys/feeds` on mount and after a completed add or Disconnect/delete (ordered by a sequence ref, dropped on unmount; never from the poll or the key-list merge). `KeyFeedsLine` on both the active and the Disconnected cards: `Feeds: <links>`, `Feeds no strategy.`, or `Could not check which strategies this key feeds.` (a key missing from an OK map is could-not-check). Links: `/factsheet/<id>` for allocator, `/strategies/<id>/edit` for manager and both, a redacted composite row is named `a strategy we could not read` with no link.
- The confirm reads `feeds` from `GET /api/keys/<id>/memberships` (bounded 15 s, never throws), holds the confirm button while the read is open, drops an answer for a closed or reopened confirm, and words it by action: unticked cascade `This key feeds: A, B.`; ticked `Deleting this key: A loses its key; B loses this member.`; none `This key feeds no strategy.`; failed `Could not check which strategies this key feeds.` (warn, never block). `DELETE_REMOVES_HISTORY` is unchanged.

## TDD record

- Task 1: RED `c35508d98` (5 failing: Test 5 label, three order cases, manager deep link), GREEN `d335e3d21`.
- Task 2: RED `a5f2d7c7d` (21 of 21 new cases failing), GREEN `d8822bfae`.

## RED evidence

All neuters applied to the production file with a byte backup in the scratchpad (`p200-bak/07`), RED captured, restored with `cp -p`, `cmp` exit 0, then re-run green.

```
gc-200-07-neuter: gate=src/components/auth/ProfileTabs.test.tsx#MANAGER-DEEP-LINK change=exchanges back in ALLOCATOR_ONLY_KEYS result=red (expect(element).toHaveTextContent("API keys") at the selected tab) restored=cmp0
gc-200-07-neuter: gate=src/components/exchanges/AllocatorExchangeManager.feeds.test.tsx#FAILED-NEVER-EMPTY change=KeyFeedsLine failed branch renders FEEDS_NONE_COPY result=red (5 FAILED-NEVER-EMPTY cases + MISSING-KEY-IS-UNCHECKED) restored=cmp0
gc-200-07-neuter: gate=src/components/exchanges/AllocatorExchangeManager.feeds.test.tsx#CONFIRM-UNCHECKED change=unchecked confirm renders the neutral 'This key feeds no strategy.' result=red (3 cases: 500, rejected fetch, no feeds array) restored=cmp0
gc-200-07-neuter: gate=src/components/exchanges/AllocatorExchangeManager.feeds.test.tsx#CONFIRM-HELD-WHILE-READING change=drop deleteFeeds checking from the confirm's disabled result=red restored=cmp0
gc-200-07-neuter: gate=src/components/exchanges/AllocatorExchangeManager.feeds.test.tsx#CONFIRM-STALE-ANSWER-DROPPED change=drop the deleteFeedsSeqRef guard result=red restored=cmp0
gc-200-07-neuter: gate=src/components/exchanges/AllocatorExchangeManager.feeds.test.tsx#CONFIRM-NAMES-HARD-DELETE change=hardDelete branch forced to neutral wording result=red restored=cmp0
gc-200-07-neuter: gate=src/components/exchanges/AllocatorExchangeManager.feeds.test.tsx#STALE-ANSWER-DROPPED change=drop the feedsSeqRef guard result=red restored=cmp0
```

The first neuter attempt on `feedsSeqRef` stayed green (no test of an out-of-order answer); `STALE-ANSWER-DROPPED` was added, then seen RED. Untouched by neuter proof: the role link split (`FEEDS-LINKS-*`) and the plain-Disconnect refresh (`REFRESH-AFTER-DELETE`), which assert exact hrefs and a second feeds call.

## Gates

- `npx tsc --noEmit -p .`: pass (no output).
- `npx vitest run src/components/exchanges src/components/auth src/__tests__/key-storage-census.test.ts "src/app/(dashboard)/profile" src/__tests__/critical-regressions.test.ts`: 20 files, 488/488 passed. Baseline before edits: 8 files, 230/230 (ProfileTabs, exchanges, census).
- `npx eslint` over `src/components/exchanges`, `ProfileTabs.tsx`, `ProfileTabs.test.tsx`, `profile/page.tsx`: pass.
- `node scripts/verify-plan-anchors.mjs` on the plan: `OK: 1 plan file(s), no stale claims.`
- Acceptance greps: `API keys` in `ProfileTabs.tsx` 2 hits, `label: "Exchanges"` 0; `memberships` 2 and `/api/keys/feeds` 3 in AEM.

## Deviations from Plan

**1. [Rule 3 - Blocking] The mount feeds read reaches every existing fetch mock in AllocatorExchangeManager.test.tsx**
- **Issue:** 14 existing cases failed once the manager fetched on mount (`mockResolvedValueOnce` order consumed by the feeds read, a `globalThis.fetch not.toHaveBeenCalled` assertion, one shared single-use `Response`).
- **Fix:** a `stubFetch(mock)` helper answers `/api/keys/feeds` itself and passes everything else to the mock a test measures; ten `vi.stubGlobal("fetch", ...)` sites use it. Two cases' `expect(globalThis.fetch).not.toHaveBeenCalled()` now assert on the underlying `fetchMockDup`. No assertion's meaning changed.
- **File:** `src/components/exchanges/AllocatorExchangeManager.test.tsx`.

**2. [Rule 3 - Blocking] ProfileTabs.test.tsx mocks the Supabase browser client**
- The API keys panel now mounts `AllocatorExchangeManager` for the manager deep-link case, which builds a client on render. A stub client was added to that file.

**3. New test file instead of appending to AllocatorExchangeManager.test.tsx**
- The new cases live in `AllocatorExchangeManager.feeds.test.tsx` (its own route-aware fetch fake); `src/components/exchanges` runs both.

## Known Stubs

None.

## Threat Flags

None. No new endpoint, no schema change; both reads are plan 01's ownership-checked routes (T-200-15 mitigated: the confirm names every fed strategy or says it could not check).

## Open

- Duplication: `parseKeyFeed`, the feeds reader and `KeyFeedsLine` are re-implemented in `AllocatorExchangeManager.tsx`, copy strings verbatim from `ApiKeyManager.tsx`. `ApiKeyManager.tsx` is outside this plan and plan 08/10 may touch it; a later dedupe into one shared module is open.
- Until plan 10, a manager on this tab sees allocator-book copy ("Upload read-only exchange API keys ... Active Allocation") and Disconnect-only semantics (no manager `Delete key`, no role switch).
- The hard-delete wording shows only when the cascade box is ticked; a key with zero holdings has no box, so its Disconnect names neutrally. Plan 10's `Delete key` is where an explicit hard-delete confirm lands.

## Self-Check: PASSED

- Created and modified files exist (`AllocatorExchangeManager.feeds.test.tsx`, the five modified sources, this SUMMARY).
- Commits `c35508d98`, `d335e3d21`, `a5f2d7c7d`, `d8822bfae` are ancestors of HEAD.
- `git status` clean apart from this SUMMARY; STATE.md, ROADMAP.md, REQUIREMENTS.md untouched.
