---
phase: 151-aum-a-book-you-can-reach-and-a-size-you-can-set
plan: 02
subsystem: data
tags: [typescript, supabase, postgrest, vitest, ssr-payload, rls]

# Dependency graph
requires:
  - phase: 149-nav-01-my-strategies
    provides: deriveStrategylessKeys — the two-link-form covered-set this plan extracts and shares
  - phase: 37-dsrc-01
    provides: perKeyDailiesGateSatisfied + eligibleApiKeyIds — the additive per-key payload channel this plan sits beside
provides:
  - "src/lib/queries.ts deriveStrategyLinkedKeyIds(ownStrategies, strategyKeyLinks): Set<string> — the exported pure manager-role discriminator, shared by /my-strategies and the allocator book gate"
  - "MyAllocationDashboardPayload.allocatorEligibleApiKeyIds — eligible keys minus manager-side keys"
  - "MyAllocationDashboardPayload.contributingApiKeyIds — allocator-eligible keys that actually have a per-key series"
  - "MyAllocationDashboardPayload.bookEntryGateSatisfied — SOME-semantics sibling of the all-or-nothing perKeyDailiesGateSatisfied"
affects: [151-05 composer repoint (canEnterBook / usePerKeySources / dataSourceKeys), 151-04 partial-book copy]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Gate SPLIT, never gate mutation: a new SOME-semantics field beside the untouched all-or-nothing one, so the five existing consumers keep their meaning"
    - "One join, two views: the /my-strategies placeholder anti-join and the AUM-04 book gate call the SAME exported pure discriminator and cannot drift"
    - "Role, never venue: manager-side is 'linked to a live strategy', never `exchange === 'mt5'`"
    - "Narrowed one-off PostgREST builder for a table missing from database.types.ts, so the owner scope stays a literal `.eq()` instead of widening the whole client"
    - "Non-fatal role reads that degrade toward allocator eligibility — the failure mode is a reachable book, not a locked-out one"

key-files:
  created: []
  modified:
    - src/lib/queries.ts
    - src/lib/queries.test.ts
    - src/lib/queries.my-allocation.test.ts
    - src/app/(dashboard)/allocations/AllocationsTabs.test.tsx
    - src/app/(dashboard)/allocations/AllocationsTabs.addalloc.test.tsx
    - src/app/(dashboard)/allocations/AllocationsTabs.onboarding.test.tsx
    - src/app/(dashboard)/allocations/AllocationsTabs.scenario-composer.test.tsx
    - src/app/(dashboard)/allocations/AllocationsTabs.scenario-state-preservation.test.tsx
    - src/app/(dashboard)/allocations/components/ScenarioComposer.test.tsx

key-decisions:
  - "getMyAllocationDashboard had NO owner-strategies read at all (RESEARCH said it 'reads strategies but not strategy_keys' — it reads neither for the owner). Both reads were added, in the existing Promise.all so the new gate costs zero extra waves."
  - "Both new reads are NON-FATAL (never assertOk'd). A transient failure or a pre-migration PostgREST schema cache must not blank a working dashboard, and the empty-link-list fallback biases keys toward ALLOCATOR eligibility — the failure mode is an allocator who can still reach their book, which is the defect AUM-04 exists to fix."
  - "The `strategies` `.eq(\"user_id\", userId)` is load-bearing, not defence-in-depth: `strategies_read` RLS is `published OR own`, so dropping it would return the whole published universe and mark every key any manager anywhere has linked as manager-side — closing THIS allocator's gate on keys they own. Recorded in a code comment."
  - "Composer fixtures got `[] / [] / false` rather than a hand-set `true`: the payload invariant is `bookEntryGateSatisfied === contributingApiKeyIds.length > 0`, and a fixture with gate=true plus zero contributing keys cannot occur in production. 151-05 owns the meaningful values when it repoints the composer."
  - "Test 1 is an END-TO-END pin, not a pure-function pin: the six manager keys carry `api_key_id: null` on their strategy rows, so they are excludable ONLY through the new owner_id-scoped strategy_keys read. The mutation falsifier (below) proves the read is live and correctly scoped."

patterns-established:
  - "Additive SSR field checklist: declare on the payload type with the SoT-mirror docstring, emit on BOTH return branches explicitly, and pin the !portfolio branch — a field on one branch is `undefined` and every downstream `?? []` masks it"
  - "Consumer-freeze test: assert the OLD gate's behaviour in the very fixture where the NEW gate disagrees with it"

# Metrics
duration: 30min
completed: 2026-08-07
---

# Phase 151 Plan 02: Split book-entry gate (AUM-04) Summary

Extracted the Phase-149 two-link-form role discriminator into an exported pure
`deriveStrategyLinkedKeyIds`, wired two owner-scoped SSR reads into
`getMyAllocationDashboard`, and emitted three additive payload fields
(`allocatorEligibleApiKeyIds` / `contributingApiKeyIds` /
`bookEntryGateSatisfied`) on both return branches — so an owner who is also a
manager can reach their own 2-of-8-key book while `perKeyDailiesGateSatisfied`
and its five consumers stay byte-unchanged.

## What Was Built

**Task 1 — the shared discriminator.** `deriveStrategyLinkedKeyIds(ownStrategies,
strategyKeyLinks): Set<string>` is the `covered` Set construction lifted out of
`deriveStrategylessKeys`, which now delegates to it. Its docstring carries the
three rulings that make it correct: ROLE-not-VENUE (an `exchange === "mt5"`
predicate is the named wrong-fix class — the founder's three deribit keys are
equally manager-side), BOTH link forms (`strategies.api_key_id` direct plus the
`strategy_keys` composite, where Alpha Centauri holds 3 keys with
`api_key_id: null`), and W-4 archived-is-not-coverage. Five census-pinned tests
in `queries.test.ts`, including a no-drift pin proving `deriveStrategylessKeys`
still returns exactly the 2 bare keys.

**Task 2 — the gate split.** `getMyAllocationDashboard` gained two reads inside
the existing `Promise.all`: the owner's `strategies` (`id, api_key_id, status`,
scoped `.eq("user_id", userId)`) and the composite `strategy_keys` links (scoped
`.eq("owner_id", userId)` — note the owner-column asymmetry) through a narrowed
one-off builder, because `strategy_keys` is absent from `database.types.ts`.
After the existing gate hoist it subtracts the manager keys, filters to keys with
a non-empty per-key series, and asks a SOME question. All three results ride both
return branches.

## Task Commits

| Task | Gate | Commit | Description |
| ---- | ---- | ------ | ----------- |
| 1 | RED | `0b2a6b71` | 5 census pins for `deriveStrategyLinkedKeyIds` (4 failed: not a function) |
| 1 | GREEN | `d8e5a337` | Extract the exported pure discriminator; `deriveStrategylessKeys` delegates |
| 2 | RED | `f82e0244` | Mock surface + 5 gate-split pins (5 failed: fields undefined on both branches) |
| 2 | GREEN | `2506a9b4` | Two owner-scoped reads, three additive fields on both branches, 6 fixture files |
| — | docs | `925325a5` | Record why the `strategies` owner-scope is load-bearing, not defence-in-depth |

## Verification

- `npx vitest run src/lib/queries.test.ts src/lib/queries.my-allocation.test.ts src/lib/queries.my-strategies.test.ts --no-file-parallelism` → **143 passed**.
- `npx vitest run "src/app/(dashboard)/allocations"` → **122 files / 1690 tests passed** (the fixture edits break nothing).
- `npm run typecheck` → exit 0. `npm run lint` → 0 errors (1 pre-existing `EquityChart.tsx` exhaustive-deps warning, untouched).

**Grep gates:**
- `export function deriveStrategyLinkedKeyIds` → exactly 1; `deriveStrategylessKeys` calls it and no longer holds its own `new Set<string>([` literal.
- `bookEntryGateSatisfied` ×4, `allocatorEligibleApiKeyIds` ×7, `contributingApiKeyIds` ×7 in `queries.ts`.
- The dashboard's `strategy_keys` builder scopes `.eq("owner_id",` (not `user_id`).
- `git diff src/lib/queries.ts` shows ZERO `+`/`-` lines touching `allActiveKeysHavePerKeyDailies`, the `const perKeyDailiesGateSatisfied` computation, or the `liveBaselineMetrics` ternary.

**Mutation falsifier (observed once, then reverted).** Flipping the
`strategy_keys` builder to `.eq("user_id", userId)` turned 3 of the 5 Task-2
tests RED with `expected [ 'k-bybit', 'k-deribit-1', …(6) ] to deeply equal
[ 'k-bybit', 'k-okx' ]` — the six manager keys stayed un-excluded because the
seeded link rows carry `owner_id`, not `user_id`. Reverting returned all 5 to
green. The new read is live and its scoping is load-bearing, not decorative.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `getMyAllocationDashboard` had no owner-strategies read to widen**

- **Found during:** Task 2
- **Issue:** The plan's step (1) said to "ensure the existing `strategies` read
  projects `id, api_key_id, status`", inheriting RESEARCH's claim that the
  dashboard "currently reads `strategies` but not `strategy_keys`". It reads
  neither for the owner — the only `strategies` reads in the function are the
  `withPublishedOnly` flagged-candidate lookup and the `portfolio_strategies`
  embed, and neither is owner-scoped or projects `status`.
- **Fix:** Added the owner-scoped read alongside the `strategy_keys` one, in the
  same `Promise.all` batch, per the plan's no-waterfall requirement.
- **Files modified:** `src/lib/queries.ts`
- **Commit:** `2506a9b4`

**2. [Rule 3 - Blocking] Six payload-literal fixtures failed to typecheck**

- **Found during:** Task 2
- **Issue:** Adding three required fields to `MyAllocationDashboardPayload` broke
  every test that builds the payload as a full object literal (5 `AllocationsTabs.*`
  fixtures and `ScenarioComposer.test.tsx`'s `makePayload`) — `tsc --noEmit` failed
  with TS2322 in 6 files. Out of the plan's declared `files_modified`, but a direct
  and unavoidable consequence of the change.
- **Fix:** Added the three fields to each base fixture. All five `AllocationsTabs`
  fixtures already declare `perKeyDailiesGateSatisfied: false` and
  `eligibleApiKeyIds: []`, so `[] / [] / false` follows unambiguously. The
  `perKeyUnitsPayload` helper (a real per-key book) got the honest mirror:
  allocator-eligible = contributing = the unit ids, gate = `units.length > 0`.
- **Files modified:** the 6 test files listed above
- **Commit:** `2506a9b4`

### Judgement Calls

**Composer base fixture set to `false`, not `true`.** `makePayload` in
`ScenarioComposer.test.tsx` declares `perKeyDailiesGateSatisfied: true` with
`eligibleApiKeyIds: []` (vacuously true — `allActiveKeysHavePerKeyDailies([])`).
Mirroring that as `bookEntryGateSatisfied: true` would have produced a fixture
violating the field's own invariant (gate true with zero contributing keys), which
cannot occur in production and would be a booby trap for 151-05's repoint. The
fixture carries a comment saying so and pointing at `perKeyUnitsPayload` as the
real-book alternative. **151-05 will need to give the composer's book-mode tests
meaningful values for these three fields when it repoints `canEnterBook` —
today's `false` preserves current behaviour because nothing reads them yet.**

### Not Deviations

The MT5 sync-semantics drift from hotfix #667 did not apply: no fixture in scope
models an MT5 key as sync-errored. The AUM-04 census fixtures model all eight keys
as healthy (`sync_status: "synced"` / `"connected"`), which matches current
behaviour.

## Threat Flags

| Flag | File | Description |
|------|------|-------------|
| threat_flag: information-disclosure | `src/lib/queries.ts` | The new owner `strategies` read is a trust boundary the plan's register did not enumerate (it listed only `strategy_keys`). `strategies_read` RLS is `status='published' OR user_id = auth.uid()`, so the literal `.eq("user_id", userId)` is the load-bearing control rather than defence-in-depth — dropping it returns the whole published universe and marks every key any manager anywhere has linked as manager-side, closing THIS allocator's book gate on keys they own. Mitigated by the literal `.eq` plus a code comment recording the reasoning (`925325a5`). **Coverage gap, logged not fixed:** no test currently fails if the `.eq("user_id", …)` is dropped — the mock fixtures seed only `user-1` rows, so a cross-tenant row would be needed to make it falsifiable. The `strategy_keys` half IS falsifiable (mutation observed above). |

T-151-03 (elevation of privilege on the `strategy_keys` builder) is mitigated as
planned: one narrowed builder, literal `.eq("owner_id", userId)`, client never
widened. T-151-04 (honesty of `liveBaselineMetrics`) is mitigated as planned and
pinned by the consumer-freeze test.

## Known Stubs

None. All three fields are computed from real reads on both branches; the `[]` /
`false` values on the fresh-allocator path are honest empty-success, not
placeholders.

## Self-Check: PASSED

All four claimed files exist on disk and all six claimed commits resolve in
`git log`.

## TDD Gate Compliance

Both tasks ran the full RED → GREEN cycle with the failure observed before any
implementation, and both gates are visible in git log as separate `test(...)` then
`feat(...)` commits. No REFACTOR commit was needed — the extraction in Task 1 was
itself the structural change, and it is covered by the no-drift pin.
