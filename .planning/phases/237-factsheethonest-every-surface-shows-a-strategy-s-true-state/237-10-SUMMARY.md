---
phase: 237-factsheethonest-every-surface-shows-a-strategy-s-true-state
plan: 10
subsystem: factsheet-owner-lane
tags: [factsheet, owner-lane, trust-tier, rls, fact-04]
status: complete
requires: [237-04]
provides:
  - "readOwnerTrustTier(client, strategyId): fail-soft, three-literal validated, request-client read of the owner's latest strategy_verifications tier"
  - "Lane B of /factsheet/[id]/v2 overlays the owner's own tier through withTrustTier"
affects:
  - "src/app/factsheet/[id]/v2/page.tsx"
tech-stack:
  added: []
  patterns:
    - "lane-local per-request overlay after the cached build (the ownershipMark / hasActiveShare pattern), never an input to the id-keyed cache"
    - "fail-soft owner read: console.error then captureToSentry with a stage tag, null on any failure (the readPublicVerificationSignals posture)"
key-files:
  created:
    - src/lib/factsheet/owner-trust-tier.ts
    - src/lib/factsheet/owner-trust-tier.test.ts
    - src/app/factsheet/[id]/v2/page.owner-trust-tier.test.tsx
  modified:
    - src/app/factsheet/[id]/v2/page.tsx
    - src/app/factsheet/[id]/v2/page.owner-lane.test.tsx
    - src/app/factsheet/[id]/v2/page.owner-compute-state.test.tsx
decisions:
  - "The owner tier is read inside the existing ownRow.status !== published block, next to the share-state read, so the read runs only for the session user's own unpublished row"
  - "rawTrustTier is published signal ?? owner tier ?? null, and the page's existing three-literal check still validates the result"
  - "No migration: the planner measured the owner_select policy and the authenticated SELECT grant in baseline.sql; this plan's tests use fakes, so a live-catalogue permission answer was not observed"
requirements: [FACT-04]
commits: 5
plan_head_before: 73d18d712b56f0d60f79e11db00df31cf6f19856
plan_head_after: e047658a5b43d592c96241cac0327d9c9035373e
actuals:
  tokens: 8975
  tasks: 3
  commits: 5
duration: "about 1h 10m"
completed: 2026-11-23
branch: worktree-agent-a9e8d49525c814ed2
---

# Phase 237 Plan 10: Owner sees their own data source Summary

The owner of an unpublished strategy now sees its data source: `readOwnerTrustTier` reads the latest `strategy_verifications` row with the request-scoped client on Lane B only (RLS `strategy_verifications_owner_select` is the ownership check), validates it against the three tier literals, and the page overlays it per request, so the Terms "Data source" row and the masthead pill read the real tier in the native and USD views instead of "Data source —".

`commits: 5` is measured as `git rev-list --count 73d18d712..e047658a5`: four code commits plus the first SUMMARY commit. The commit that rewrote this file is one more and is not counted, since a SUMMARY cannot count itself.

## What was built

- `src/lib/factsheet/owner-trust-tier.ts`: `readOwnerTrustTier(client, strategyId)`. Selects exactly `trust_tier, created_at`, `eq strategy_id`, `order created_at desc`, `limit 1`, `maybeSingle`. Returns the value only if it is one of the three `TrustTierKind` literals. An error result or a thrown error is logged with `console.error` (strategy id, code, message, no row content), sent to `captureToSentry` with tags `route: factsheet/v2/page`, `stage: owner-trust-tier`, and returns null. It never throws. The typed `from("strategy_verifications")` overload accepts the chain, so no cast through unknown was needed.
- `page.tsx`: `let ownerTrustTier` beside the other owner-lane lets; one `await readOwnerTrustTier(supabase, id)` inside the `ownRow.status !== "published"` block; `rawTrustTier = verificationSignals.get(id)?.trust_tier ?? ownerTrustTier ?? null`. `buildFactsheetPayloadCached`, its key and the lane order are untouched. The share route does not import the read.
- Tests: `owner-trust-tier.test.ts` (8 cases) and `page.owner-trust-tier.test.tsx` (15 cases, the real `FactsheetView` rendered, the Terms row and the pill read in both unit views).

## UI-SPEC 3.2 matrix, row by row

| Matrix row | Named test in `page.owner-trust-tier.test.tsx` |
|---|---|
| Owner, row present | `owner with a %s row: the payload, the Terms row and the pill carry it in BOTH unit views` (three tiers) |
| Owner, no row | `owner with NO verification row: tier null, Data source reads —, no pill` |
| Owner, read failed | `a PostgREST error: the page still renders, the tier is null, and the failure reaches Sentry with its stage tag`, plus `a thrown read: the page still renders with a null tier` |
| Anon or non-owner, unpublished | `anon on an unpublished strategy: 404 and the owner read is never called`, `signed-in non-owner on an unpublished strategy: 404 and the owner read is never called` |
| Share-link recipient | `a share-link recipient still reads Data source —: the share route does not import the owner read` (source assertion with a vacuity fence) |
| Any viewer, published, Lane A | `a published strategy on Lane A never asks the owner read either` |
| Published row that reaches Lane B (WR-01) | `WR-01: a PUBLISHED row that reaches Lane B keeps its published signal and the owner read is not called` |
| "owner and anon each get a test on every surface" | owner rows above render both surfaces in both views; anon is `anon on a PUBLISHED strategy with a %s published signal` (api_verified and csv_uploaded, Terms row and pill, both views) and `anon on a PUBLISHED strategy with no published signal` |

UI-SPEC 3.1 copy: the Terms row strings (`API-verified`, `CSV-uploaded (verification pending)`, `Self-reported`, `—`) and the pill strings (`API verified`, `CSV uploaded — verification pending`, `Self-reported`) are typed into the test as literals and match `MandatePanels.tsx` `tierLabel` and `TRUST_TIER_TOKENS` labels. The 3.1 "self-reported qualifier" and USD-view rows have no new markup in this plan; the USD view is covered by the both-views assertions, and the qualifier is not separately asserted here.

## PROOF-01 evidence

### 1. Owner case RED on pre-fix code (module present, page not yet calling it)

`npx vitest run --maxWorkers=3 'src/app/factsheet/[id]/v2/page.owner-trust-tier.test.tsx'` against the plan-base page (the four `FAIL` entries with their assertion line, and the totals, as printed):

```
 FAIL  |jsdom| src/app/factsheet/[id]/v2/page.owner-trust-tier.test.tsx > FACT-04 — the owner sees their own data source on an unpublished factsheet > owner with a api_verified row: the payload, the Terms row and the pill carry it in BOTH unit views
AssertionError: expected null to be 'api_verified' // Object.is equality
 FAIL  |jsdom| src/app/factsheet/[id]/v2/page.owner-trust-tier.test.tsx > FACT-04 — the owner sees their own data source on an unpublished factsheet > owner with a csv_uploaded row: the payload, the Terms row and the pill carry it in BOTH unit views
AssertionError: expected null to be 'csv_uploaded' // Object.is equality
 FAIL  |jsdom| src/app/factsheet/[id]/v2/page.owner-trust-tier.test.tsx > FACT-04 — the owner sees their own data source on an unpublished factsheet > owner with a self_reported row: the payload, the Terms row and the pill carry it in BOTH unit views
AssertionError: expected null to be 'self_reported' // Object.is equality
 FAIL  |jsdom| src/app/factsheet/[id]/v2/page.owner-trust-tier.test.tsx > FACT-04 — the owner sees their own data source on an unpublished factsheet > the owner read goes through the request client: strategy_verifications is read there and the admin client is never built
AssertionError: expected [ 'strategies', 'strategies', …(1) ] to include 'strategy_verifications'
 Test Files  1 failed (1)
      Tests  4 failed | 1 passed (5)
```

The one passing case was "owner with NO verification row", which reads null before and after, as it should. After the page change: `Test Files  2 passed (2)` / `Tests  13 passed (13)` (unit file plus page file at that point).

### 2. Unvalidated string, byte-backed neuter of `owner-trust-tier.ts`

Backup made with `cp` into the scratchpad, outside the repo. Neuter: `return (data?.trust_tier ?? null) as TrustTierKind | null;` in place of `asTrustTier(data?.trust_tier)`.

```
 FAIL  |jsdom| src/lib/factsheet/owner-trust-tier.test.ts > readOwnerTrustTier > an unknown string is null: only the three literals reach the overlay
AssertionError: expected 'gold_standard' to be null
 Test Files  1 failed (1)
      Tests  1 failed | 7 passed (8)
```

Restore by `cp`; `cmp` printed nothing and `echo cmp=$?` printed `cmp=0`. GREEN: `Test Files  1 passed (1)` / `Tests  8 passed (8)`.

### 3. Owner read moved outside the owner-lane block, byte-backed neuter of `page.tsx`

Neuter: the call removed from the unpublished-own-row block and placed straight after `signature = ownRow;`, so it runs on every signed-in Lane B pass.

```
 FAIL  |jsdom| src/app/factsheet/[id]/v2/page.owner-trust-tier.test.tsx > FACT-04 — an unpublished strategy's data source is never read for anyone but its owner > WR-01: a PUBLISHED row that reaches Lane B keeps its published signal and the owner read is not called
AssertionError: expected "vi.fn()" to not be called at all, but actually been called 1 times
 Test Files  1 failed (1)
      Tests  1 failed | 11 passed (12)
```

Restore by `cp`; `cmp=0`. GREEN: `Test Files  1 passed (1)` / `Tests  12 passed (12)` (the file had 12 cases at that point; it has 15 now). The anon and non-owner cases stay green under this neuter because `notFound()` fires before any line it moved; their zero-call assertions would fire if a future edit hoisted the read above the probe.

## Gates

- Final targeted run, after the last test edit: `npx vitest run --maxWorkers=3 src/lib/factsheet/owner-trust-tier.test.ts 'src/app/factsheet/[id]/v2/page' src/__tests__/phase-148-owner-lane-cache-isolation.test.ts 'src/app/factsheet-share/[token]'` gave `Test Files  17 passed (17)` / `Tests  306 passed (306)`.
- `npm run typecheck`: exit 0.
- `npx eslint src/` (no cache): `0 errors, 4 warnings`. The four are unused-var warnings in `MetricsColumn.tsx`, `composite-read-path.ts` and `queries.stale-analytics-detail.test.ts`, none touched by this plan. `check-admin-route-manifest`, `check-route-contract`, `check-planning-hygiene` and `check-canonical-domain` all printed OK.
- Wider guard sweep: every test file that mentions `strategy_verifications` or `readPublicVerificationSignals`, references `v2/page`, or reads `.planning` (89 files): 87 passed, 2 failed. `check-planning-hygiene.test.ts` timed out at 5000 ms under load and passed 71 of 71 when re-run alone. The other failure is the pre-existing one below.

## Harness edits (Task 3)

| Harness | Edited | Why |
|---|---|---|
| `page.owner-lane.test.tsx` | yes | the request-client fake had no `order`/`limit`; test 9 pins the exact request-client select count, now 4, and the new read's projection is pinned at `trust_tier, created_at`; the stale "count at 3" comment is corrected. No assertion weakened |
| `page.owner-compute-state.test.tsx` | yes | same missing chain; the fail-soft read reported a Sentry error that tripped its `captureToSentry` call-count assertions. The fake now answers `strategy_verifications` with no row and no error |
| `page.viewer-chrome.test.tsx` | no | stayed green |
| `page.peer-ranks.test.tsx` | no | stayed green |

None of the seven unreachable harnesses went red and none was edited. `git diff --name-only 73d18d712..HEAD` lists only the six files above plus this record.

## Deviations from Plan

1. **[TDD commit scope] No separate RED commit for Task 1.** Task 1 is `tdd="true"`, and `tdd.md` expects a `test(...)` RED commit before the `feat(...)` commit. RED was run and recorded (proof 1 above, against the plan-base page) but the test and the implementation landed in one `feat(237-10)` commit, `e61f97e75`. The plan's type is `execute`, not `tdd`, so the plan-level gate sequence does not apply, but the task-level contract was not met in git history. Not rewritten.
2. **[Rule 2 - gap in the matrix] Anon surface tests on a published strategy added.** UI-SPEC 3.2 asks for owner and anon tests on every surface where the tier renders. Task 2's behaviour list had only the anon 404 case, so a follow-up commit (`e047658a5`) adds the anon published-lane cases that read the Terms row and the pill in both views.

## Deferred Issues (found in the 237 wave-1 base, not caused by this plan)

- **`src/__tests__/phase-150-capital-ownership-invariant.test.ts` P10 fails at the plan base, before any of this plan's edits.** `AssertionError: expected 532 to be less than 400` at `callback.length` of the `unstable_cache` callback in `v2/page.tsx`. It fails identically with `page.tsx` swapped for its base copy (`73d18d712`), so it is not caused by this plan. Plan 04 (`f9b95a08e`) grew that callback with the `price_read_failed` throw. The orchestrator needs to decide whether to raise the 400 bound; that test file is not declared by this plan, so it was not edited.
- **`src/lib/factsheet/compute.conventions.test.ts` fixtures B and C fail with `Snapshot ... mismatched`.** No file in its import path changed in this plan, or in the 237 wave-1 merges (`git diff 4f0e9edc1 73d18d712` in `src/lib` touches `fetch-and-build-payload.ts`, `analytics-hold.ts` and `degrade-warnings.ts`, not `compute.ts`). `compute.ts` last moved in Phase 194 (`959ef9820`, 2026-11-08). The failure was not run at the plan base, so whether it predates 237 is unverified.

## Known Stubs

None.

## Threat Flags

None. The one new read is the one the plan's threat model names (T-237-16 to T-237-19), and each mitigation is asserted: request client only (admin client never built, asserted), exact projection (recorded-chain unit test and owner-lane test 9), owner lane only (anon, non-owner, WR-01 and Lane A zero-call cases), per-request overlay (phase-148 isolation tests green), three-literal validation (unit case).

## Self-Check: PASSED

Run after the last code commit:

- `src/lib/factsheet/owner-trust-tier.ts`, `src/lib/factsheet/owner-trust-tier.test.ts`, `src/app/factsheet/[id]/v2/page.owner-trust-tier.test.tsx`: all FOUND.
- Commits `e61f97e75`, `3d1e97e02`, `218251bc8`, `e047658a5` pass `git merge-base --is-ancestor <hash> HEAD`.
- Acceptance greps: `readOwnerTrustTier(` code occurrences in `page.tsx` = 1; `trust_tier, created_at` in the module = 1; `createAdminClient` in the module = 0.
