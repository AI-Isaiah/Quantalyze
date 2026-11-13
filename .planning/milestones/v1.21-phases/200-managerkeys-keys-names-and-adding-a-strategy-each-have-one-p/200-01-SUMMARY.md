---
phase: 200-managerkeys-keys-names-and-adding-a-strategy-each-have-one-p
plan: 01
subsystem: api, ui
tags: [route, api-keys, feeds, rls-bypass, ownership, no-store, key-manager]
requires: []
provides:
  - "GET /api/keys/feeds: one ownership-checked read of every strategy each owned key feeds"
  - "additive `feeds` on GET /api/keys/[id]/memberships (both link kinds)"
  - "src/lib/key-feeds.ts: KeyFeed, sortFeeds, compositeFeedFromRow, unwrapEmbed, errorCodeTag"
  - "feeds line on every ApiKeyManager key card"
affects: [200-07, 200-09, 200-11]
tech-stack:
  added: []
  patterns:
    - "batched service-role read scoped by explicit user_id, one limiter token per list"
    - "route modules export only handlers; shared types and helpers live in src/lib"
key-files:
  created:
    - src/app/api/keys/feeds/route.ts
    - src/app/api/keys/feeds/route.test.ts
    - src/lib/key-feeds.ts
  modified:
    - src/app/api/keys/[id]/memberships/route.ts
    - src/app/api/keys/[id]/memberships/route.test.ts
    - src/__tests__/no-store-coverage.test.ts
    - src/lib/api/limiter-ordering.test.ts
    - src/components/strategy/ApiKeyManager.tsx
    - src/components/strategy/ApiKeyManager.test.tsx
decisions:
  - "A composite row whose strategy is not the caller's, or whose embed is missing, is listed in feeds with null strategy_id, name and status (the plan said null name and status; the privacy prohibition says name or id)."
  - "The card re-reads feeds after a link only when the key differs from currentKeyId (a Resync re-links the same key and changes nothing), after an add (after loadKeys) and after a completed delete; never from loadKeys or the poll."
  - "A refresh sets the state to loading so the lines go quiet until the new answer lands, instead of showing a map that may be wrong."
metrics:
  tasks: 2
  completed: 2026-11-10
status: complete
actuals:
  tokens: 18800
  tasks: 2
  commits: 5
plan_head_before: c83dc7a2d0fa9324146a77e9a23053b82666e18b
plan_head_after: 489d43db6e31452fe46885703d01e7ffba27efbd
---

# Phase 200 Plan 01: GET /api/keys/feeds and the feeds line Summary

One batched, owner-scoped server read tells every key card which strategies it feeds, single-key links and composite memberships alike, and a failed or rate-limited read says "Could not check which strategies this key feeds." instead of "Feeds no strategy.".

## What was built

- `GET /api/keys/feeds` (`src/app/api/keys/feeds/route.ts`): `withAuth`, `checkLimit(userActionLimiter, "key-feeds:<user.id>")`, then three admin reads. `api_keys` by `user_id`, `strategy_keys` by the owned ids with the coherence tripwire (stage `coherence`, counts only), `strategies` by `user_id` and the owned ids. Every owned key id is in the response (`[]` when it feeds nothing). Zero keys answer `200 { feeds: {} }` and skip the two feed reads. Any read error or non-array is `500 { error: "Lookup failed" }`, tagged by stage (`ownership`, `memberships`, `single-links`). All responses carry `NO_STORE_HEADERS`.
- `src/lib/key-feeds.ts`: `KeyFeed`, `sortFeeds` (name case-insensitive, nulls last, then `strategy_id`), `compositeFeedFromRow` (one `strategy_keys` row to a `KeyFeed` plus the owner-mismatch or dangling verdict), and `unwrapEmbed` / `errorCodeTag` moved out of the memberships route so both routes share one copy.
- `GET /api/keys/[id]/memberships`: additive `feeds` beside the unchanged `memberships`. One more admin read of `strategies`, scoped by `user_id` and the key id. Its error is a 500, never an empty `feeds`.
- `ApiKeyManager`: one `/api/keys/feeds` read on mount, rendered under every key card as `Feeds: <link>, <link>` (links to `/strategies/<id>/edit`), `Feeds no strategy.`, or the could-not-check line (amber, `text-warning`). The line has no role, so the share note's `role="note"` stays its own. Re-read only after a completed link of a different key, an add, or a delete. Ordered like `loadKeys`: an older answer, or one landing after unmount, is dropped.
- Both censuses: `keys/feeds/route.ts` added to `no-store-coverage.test.ts` (37 to 38, lineage line added) and to the NO_INPUT bucket of `limiter-ordering.test.ts`.

## TDD record

- Task 1 route: RED commit `f5740df42` (17 cases against a 501 stub, every case failed on its planned assertion, e.g. `expected 501 to be 200`), GREEN `d94e59cd9`.
- Task 1 component: written against the finished route; the RED proof is the neuter set below (the failed-read arms fail when the card prints "Feeds no strategy.").
- Task 2: RED commit `f47b22f73` (7 failing cases: `feeds` absent, 200 where 500 is expected), GREEN `489d43db6`.

## RED evidence

Every neuter was applied to a byte copy kept in the scratchpad (`p200-bak/01`), the test run, then the file restored with `cp -p` and `cmp` (exit 0), and the test re-run green. `git status` after each batch showed only intended changes.

- `src/app/api/keys/feeds/route.ts`, drop `.eq("user_id", user.id)` on the single-link read. FAIL: `FOREIGN-SINGLE-LINK-HIDDEN` (`expected '{"feeds":...' not to contain 'Foreign Single'`) and `ADMIN-OWNER-FILTERS` (`expected [ [ 'in', 'api_key_id', ... ] ] to deep equally contain [ 'eq', 'user_id', ... ]`). Restored.
- `src/app/api/keys/feeds/route.ts`, drop `.eq("user_id", user.id)` on the `api_keys` read. FAIL: `BOTH-KINDS`, `ADMIN-OWNER-FILTERS`, `FOREIGN-KEY-ABSENT`, `ZERO-KEYS`. Restored.
- `src/lib/key-feeds.ts`, let an owner-mismatched composite row keep its id, name and status. FAIL: `COMPOSITE-FOREIGN-REDACTED` (`expected '{"feeds":...' not to contain 'Foreign Composite'`). Restored.
- `src/app/api/keys/feeds/route.ts`, swallow the single-link read error (fall through with an empty list). FAIL: `READ-ERROR-500 (strategies)` and `NOT-ARRAY-500 (strategies)` (`expected 200 to be 500`). Restored.
- `src/components/strategy/ApiKeyManager.tsx`, render `Feeds no strategy.` in the failed/missing branch. FAIL: five `FAILED-NEVER-EMPTY` cases (fetch rejects, 500, 429, not a feeds map, malformed entry) and `MISSING-KEY-IS-UNCHECKED`. Restored.
- `ApiKeyManager.tsx`, drop the stale-answer guard (`seq === feedsSeqRef.current`). FAIL: `STALE-ANSWER-DROPPED`. Restored.
- `ApiKeyManager.tsx`, drop the re-read after a delete. FAIL: `REFRESH-AFTER-DELETE` and `STALE-ANSWER-DROPPED`. Restored.
- `ApiKeyManager.tsx`, re-read on every link including a Resync of the current key. FAIL: `ONE-READ-ON-POLL`. Restored.
- `ApiKeyManager.tsx`, drop the re-read after a link. FAIL: `REFRESH-AFTER-RE-POINT`. Restored.
- `src/app/api/keys/[id]/memberships/route.ts`, ignore the single-link read error (`if (false)`). FAIL: `FEEDS-READ-ERROR-500` and `FEEDS-NOT-ARRAY-500`. Restored.
- `src/app/api/keys/[id]/memberships/route.ts`, drop `.eq("user_id", user.id)` on the single-key read. FAIL: `FEEDS-SINGLE-SCOPED` (`expected [ [ 'api_key_id', ... ] ] to deep equally contain [ 'user_id', ... ]`). Restored.

```
gc-200-01-neuter: gate=src/app/api/keys/feeds/route.test.ts#FOREIGN-SINGLE-LINK-HIDDEN result=red restored=identical
gc-200-01-neuter: gate=src/app/api/keys/feeds/route.test.ts#FOREIGN-KEY-ABSENT result=red restored=identical
gc-200-01-neuter: gate=src/app/api/keys/feeds/route.test.ts#COMPOSITE-FOREIGN-REDACTED result=red restored=identical
gc-200-01-neuter: gate=src/app/api/keys/feeds/route.test.ts#READ-ERROR-500 result=red restored=identical
gc-200-01-neuter: gate=src/components/strategy/ApiKeyManager.test.tsx#FAILED-NEVER-EMPTY result=red restored=identical
gc-200-01-neuter: gate=src/components/strategy/ApiKeyManager.test.tsx#STALE-ANSWER-DROPPED result=red restored=identical
gc-200-01-neuter: gate=src/components/strategy/ApiKeyManager.test.tsx#REFRESH-AFTER-DELETE result=red restored=identical
gc-200-01-neuter: gate=src/components/strategy/ApiKeyManager.test.tsx#ONE-READ-ON-POLL result=red restored=identical
gc-200-01-neuter: gate=src/components/strategy/ApiKeyManager.test.tsx#REFRESH-AFTER-RE-POINT result=red restored=identical
gc-200-01-neuter: gate=src/app/api/keys/[id]/memberships/route.test.ts#FEEDS-READ-ERROR-500 result=red restored=identical
gc-200-01-neuter: gate=src/app/api/keys/[id]/memberships/route.test.ts#FEEDS-SINGLE-SCOPED result=red restored=identical
```

## Gates

- `npx tsc --noEmit -p .`: pass (no output).
- `npx vitest run src/app/api/keys src/__tests__/no-store-coverage.test.ts src/lib/api/limiter-ordering.test.ts src/components/strategy "src/app/(dashboard)/strategies/[id]/edit" src/__tests__/display-sign-single-source.test.ts src/__tests__/critical-regressions.test.ts`: 75 files, 1735/1735 passed.
- `npx eslint` over every changed file: pass.
- `node scripts/verify-plan-anchors.mjs` on the plan: `OK: 1 plan file(s), no stale claims.`
- Baseline before any edit: `ApiKeyManager.test.tsx` + `ApiKeyManager.poll.test.tsx` 187/187 passed.

## Deviations from Plan

### Auto-fixed / auto-added

**1. [Rule 2 - Missing critical functionality] Foreign and dangling composite rows carry no strategy id**
- **Found during:** Task 1 (the plan's privacy prohibition says "never returns a strategy name or id that belongs to another user").
- **Issue:** The plan's coherence tripwire lists such a row with null name and status only. Returning `strategy_id` would leak another tenant's id, and the existing `FOREIGN-STRATEGY-REDACTED` case builds the id from the name.
- **Fix:** `KeyFeed.strategy_id` is `string | null`; the redacted row has null id, name and status in both routes. The card names it "a strategy we could not read" with no link.
- **Files:** `src/lib/key-feeds.ts`, both routes, `ApiKeyManager.tsx`.
- **Commits:** `d94e59cd9`, `9f97fdc8b`, `489d43db6`.

**2. [Rule 3 - Blocking] The 14 existing memberships cases could not all stay unedited**
- **Issue:** Task 2 says the 14 cases pass unedited. Five assert the whole body with `toEqual({ memberships })`, and the admin fake threw on `from("strategies")`.
- **Fix:** The harness gained a `strategies` arm (default: no rows). The five cases (`OWN-KEY-MEMBERS`, `RLS-REGRESSION`, `EMBED-ARRAY`, `FOREIGN-STRATEGY-REDACTED`, `COHERENCE-TRIPWIRE-LOUD`) now assert the `memberships` field alone (the field the Delete confirm reads); `FOREIGN-STRATEGY-REDACTED` also pins the redacted `feeds` row. The other nine are untouched.
- **File:** `src/app/api/keys/[id]/memberships/route.test.ts`. **Commit:** `f47b22f73`.

**3. [Rule 3 - Blocking] Nine single-`Response` fetch mocks in ApiKeyManager.test.tsx**
- **Issue:** Nine `vi.fn().mockResolvedValue(new Response(...))` mocks returned ONE shared single-use `Response` for every fetch. The card's new mount read consumed its body, so the sync enqueue threw `Body is unusable` and three cases failed (`clears the syncing lock on a complete_with_warnings...`, `ANTI-REGRESSION: a well-formed 202...`, `KCS-02...`). A fourth, the B-15 case, would have kept passing for the wrong reason.
- **Fix:** a `freshResponse(template)` helper clones per call; the nine mocks use it. No assertion changed.
- **File:** `src/components/strategy/ApiKeyManager.test.tsx`. **Commit:** `9f97fdc8b`.

**4. [Plan premise] limiter-ordering has no vacuity count to bump**
- `limiter-ordering.test.ts` classifies routes in `Set`s and asserts completeness and absence of stale entries; there is no numeric count. Only `no-store-coverage.test.ts` carries one (37 to 38). Both census entries landed in the Task 1 GREEN commit, not Task 2, because `limiter-ordering` goes red the moment a `checkLimit` route exists unclassified.

**5. [Scope] Shared helpers moved to `src/lib/key-feeds.ts`**
- `unwrapEmbed` and `errorCodeTag` (copied verbatim by the plan) were moved out of the memberships route and imported by both routes, and `compositeFeedFromRow` now builds both `memberships` and `feeds` from one pass, so the redaction cannot drift between the two routes. Behaviour of `memberships` is unchanged (the nine untouched cases and five narrowed ones pass).

### Notes

- `ApiKeyManager.poll.test.tsx` needed no edit (its fetch mock answers per URL).
- No Sentry capture was added for a failed browser read: the card runs in the browser, where Sentry is a no-op (see the `readKeyCompositeMemberships` docblock). The failure is logged with its reason only; the route records its own 500s and limiter denies server-side.
- `display-sign-single-source.test.ts` was run and not edited.

## Known Stubs

None.

## Threat Flags

None beyond the plan's threat model: the new endpoint (T-200-01 to T-200-04) is covered by the owner filters, `NO_STORE_HEADERS`, the census entries and the batched limiter use.

## Deferred / Open

- Plan 11's `Change key…` picker, plan 07's allocator manager and plan 09's wizard summary consume this route and `key-feeds.ts`; none is wired here.
- A client Sentry init does not exist, so the card's feeds failures reach only the browser console (same as the Delete confirm's reads).

## Self-Check: PASSED

- FOUND: src/app/api/keys/feeds/route.ts, route.test.ts, src/lib/key-feeds.ts
- FOUND commits: f5740df42, d94e59cd9, 9f97fdc8b, f47b22f73, 489d43db6 (all ancestors of HEAD)
- `grep -a -c 'key-feeds:' src/app/api/keys/feeds/route.ts` = 1; `grep -a -c '/api/keys/feeds' ApiKeyManager.tsx` >= 1; the could-not-check sentence is in `ApiKeyManager.tsx`; `type Membership = { name: string | null; status: string | null }` still present once.
