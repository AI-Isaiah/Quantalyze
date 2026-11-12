---
phase: 201-plainwords-one-name-per-concept-explained-and-the-small-inco
plan: 26
subsystem: strategy-name-resolution
tags: [d-09, d-17, my-allocation, risk-widgets, admin-surfaces, required-viewer, security-boundary]
requires: [201-02, 201-07]
provides:
  - displayStrategyName(strategy, viewer) with a required viewer and no transitional branch
  - My allocation adapters and Risk widgets name a visible strategy before its codename
  - admin surfaces name a strategy only when it is published
  - call-sites table for every non-test resolver caller in the phase
affects: [201-15, 201-24, 201-25]
tech-stack:
  added: []
  patterns:
    - "the type system carries the visibility decision: a required viewer argument, so a new caller cannot skip it"
    - "admin is a viewer like any other: isDiscoveryVisible(row, null) on a status read, never the admin gate"
key-files:
  created:
    - src/app/(dashboard)/allocations/widgets/risk/RiskDecomposition.names.test.tsx
  modified:
    - src/app/(dashboard)/allocations/lib/holdings-adapter.ts
    - src/app/(dashboard)/allocations/lib/holdings-adapter.test.ts
    - src/app/(dashboard)/allocations/lib/strategies-row-adapter.ts
    - src/app/(dashboard)/allocations/lib/strategies-row-adapter.test.ts
    - src/lib/allocation-helpers.ts
    - src/app/(dashboard)/allocations/widgets/risk/RiskDecomposition.tsx
    - src/app/(dashboard)/allocations/widgets/risk/CorrelationMatrix.tsx
    - src/app/(dashboard)/allocations/widgets/risk/CorrelationMatrix.names.test.tsx
    - src/app/(dashboard)/allocations/components/HoldingsTable.tsx
    - src/lib/admin/match.ts
    - src/lib/admin/match.test.ts
    - src/app/(dashboard)/admin/page.tsx
    - src/components/admin/SendIntroPanel.tsx
    - src/components/admin/AllocatorMatchQueue.tsx
    - src/components/admin/AllocatorMatchQueue.test.tsx
    - src/components/admin/CandidateDetail.tsx
    - src/components/admin/match/ShortlistCard.tsx
    - src/components/admin/AdminTabs.tsx
    - src/components/admin/AdminTabs.test.tsx
    - src/lib/queries.ts
    - src/lib/queries.audit-2026-05-07.test.ts
    - src/components/strategy/PendingIntros.tsx
    - src/components/strategy/StrategyHeader.tsx
    - src/components/strategy/StrategyHeader.test.tsx
    - src/lib/strategy-display.ts
    - src/lib/strategy-display.test.ts
decisions:
  - "The Risk widgets keep their inline chains (alias, trimmed name, codename, existing fallback) and do not call the resolver: its Strategy #<id8> fallback would break the locked 'Unnamed strategy' rule."
  - "`status` on the admin row types is optional (`status?: string | null`). A row that arrives without it is not visible and keeps its codename, so a forgotten column can only withhold a name."
  - "`displayStrategyName` reads a missing viewer at runtime as not visible (`viewer?.visible === true`) so an untyped caller can only withhold a name; the type error is the real control."
metrics:
  tasks: 3
  completed: 2026-11-11
status: complete
actuals:
  tokens: 60000
  tasks: 3
  commits: 4
plan_head_before: a82abbc8724db28bcec22316b2f120c938cdd8b5
plan_head_after: 870ccac12e148e1e74376fb70f9f60ed2eb571b2
---

# Phase 201 Plan 26: One resolver with a required viewer, My allocation names before codenames, admin names only for published strategies Summary

`displayStrategyName` now takes a required `viewer`, so no caller can print a strategy name without stating why its viewer may read it. The My allocation adapters and the two Risk widgets read the name before the codename, and the five admin components name a strategy only when its `status` is published; every other admin row keeps HEAD's codename.

## What was built

- **Task 1 (tracer), My allocation.** `holdings-adapter`, `strategies-row-adapter` (both call sites) and `allocation-helpers.displayName` pass `{ visible: true }` with a comment citing the upstream redaction (`redactedName` in `queries.ts`, pinned by `queries.my-allocation.test.ts`): the redaction, not the flag, is the control. `CorrelationMatrix` (precomputed and computed paths) and `RiskDecomposition` read alias, then the trimmed name (a blank falls through), then the codename, then their existing fallbacks (`Unnamed strategy`, `?`). `HoldingsTable`'s strategy-cell comment and two adapter docblocks now state the D-17 rule (comment only).
- **Task 2, admin.** `status` is added to the match-decisions and match-candidates strategy embeds (`src/lib/admin/match.ts`), to the contact-request strategy embed (`admin/page.tsx`) and to the row types (`CandidateRow.strategies`, `Decision.strategies`, `IntroRequestRow.strategies`). `SendIntroPanel`, `AllocatorMatchQueue` (three sites), `CandidateDetail`, `ShortlistCard` and `AdminTabs` pass `{ visible: isDiscoveryVisible(row ?? {}, null) }`, each with a comment naming the admin gate as the reason the row reaches the viewer and the predicate as the decision.
- **Task 3, the rest and the type.** The flagged-candidate map passes `{ visible: true }` (its read is `withPublishedOnly`). `PendingIntros` passes `{ visible: true }` (owner rows, confirmed below). `StrategyHeader` gets a required `nameVisible` prop and forwards it; the component still has no caller and is not deleted (Rule 3). `viewer` is required in `displayStrategyName`, the transitional branch and its docblock note are deleted, and a `@ts-expect-error` arm pins the type error. `npm run typecheck` is clean, so no call site was missed.

## call-sites

One row per non-test caller of the resolver across the phase so far (plans 201-02, 201-07, 201-26). `publicNamePreview` callers are listed because they reach the resolver through it.

| file | symbol | source of the visibility fact | moved by | test that fails if it changes |
|---|---|---|---|---|
| `src/app/api/strategies/browse/route.ts` | row projection | owner-inclusive query (`withPublishedOrOwner`) plus `isDiscoveryVisible(row, user.id)` | 201-02 | `route.test.ts` T12a and `CompareAddStrategy.real-name.test.tsx` (201-02 neuter RED) |
| `src/lib/queries.ts` | `normalizeEmbed` (bridge outcome embeds) | service-role read plus `isDiscoveryVisible` on each embed, viewer = `userId` | 201-02 | `queries.my-allocation.test.ts` and `queries.audit-2026-05-07.test.ts` (201-02 neuter RED) |
| `src/lib/queries.ts` | My allocation `redactedName` (no resolver call; redacts before the payload) | service-role read plus `isDiscoveryVisible(strategy, userId)` | 201-02 | `queries.my-allocation.test.ts` (201-02 extra neuter RED) |
| `src/lib/queries.ts` | flagged-candidate `nameById` | published-only query (`withPublishedOnly`), every row visible | 201-26 | `queries.audit-2026-05-07.test.ts` "flaggedHoldings.top_candidate_name is the candidate's name, ahead of its codename (D-17)" pins the printed order; the mock cannot prove the predicate, which is the `withPublishedOnly` wrapper in the read |
| `src/app/factsheet/[id]/tearsheet/page.tsx` | `generateMetadata` and page `displayName` | `withPublishedOnly` reads | 201-07 | `page.test.tsx` real-name arms |
| `src/app/factsheet/[id]/v2/page.tsx` | `publicNamePreview` for `<title>`, `pendingName` | public lane `withPublishedOnly` or owner lane `withPublishedOrOwner` | 201-07 | `page.metadata.test.tsx`, `page.owner-compute-state.test.tsx` |
| `src/lib/factsheet/fetch-and-build-payload.ts` | `factsheetName` | caller's predicate (public, owner, token) | 201-07 | `fetch-and-build-payload.test.ts` token-lane pin |
| `src/app/api/og/factsheet/[id]/route.tsx` | name | its own `withPublishedOnly` read | 201-07 | `route.public-access.test.tsx` P1 and P4 |
| `src/lib/strategy-display.ts` | `publicNamePreview` (two legs) | the caller's row; owner's own row on the edit page | 201-07 | `strategy-display.test.ts` `publicNamePreview` arms |
| `src/app/(dashboard)/strategies/[id]/edit/page.tsx` | `publicNamePreview(strategy)` | the owner's own row (`.eq("user_id", user.id)`) | 201-07 | `edit/page.test.tsx` |
| `src/app/(dashboard)/allocations/lib/holdings-adapter.ts` | holding `strategy` | payload redacted upstream (`redactedName`) | 201-26 | `holdings-adapter.test.ts` "a readable name prints ahead of the codename (D-17)" (neuter (b) RED) |
| `src/app/(dashboard)/allocations/lib/strategies-row-adapter.ts` | half 1 (position row), half 2 (marked, no position) | half 1: payload redacted upstream; half 2: `getOwnCapitalStrategies`, `.eq("user_id", userId)`, the viewer's own rows | 201-26 | `strategies-row-adapter.test.ts` "a readable name prints ahead of the codename (D-17)", "a name redacted upstream (null) falls back to the codename" and the `[DISCLOSURE]` third-party arm |
| `src/lib/allocation-helpers.ts` | `displayName` | payload redacted upstream; no production importer at HEAD, kept | 201-26 | none: no importer and no test reads it; typecheck is the only pin (recorded, not hidden) |
| `src/components/strategy/PendingIntros.tsx` | `r.strategies` | owner's own rows, confirmed: the `/strategies` page loader reads the intro requests with `.in("strategy_id", strategyIds)`, and `strategyIds` come from a read filtered `.eq("user_id", user.id)` | 201-26 | none at the component: `PendingIntros.test.tsx` has no name arm and stayed green when `visible` was set to false (checked by neuter). The fact is a loader fact, which a component test cannot hold; typecheck pins that a source is stated |
| `src/components/strategy/StrategyHeader.tsx` | header `h1` | the caller's `nameVisible` prop; **no caller at HEAD** (`grep -a -rn StrategyHeader src` finds the definition, its test and prose) | 201-26 | `StrategyHeader.test.tsx` "prints the name when the viewer can see the strategy, and the codename when not" |
| `src/components/admin/AdminTabs.tsx` | intro-request row | `status` read plus `isDiscoveryVisible(row, null)`, behind `isAdminUser` in `admin/page.tsx` | 201-26 | `AdminTabs.test.tsx` "Intro Requests tab names a strategy only when it is published (D-17)" (neuter (c) RED) |
| `src/components/admin/AllocatorMatchQueue.tsx` | candidate row, excluded row, decision-history row | `status` read plus `isDiscoveryVisible`, behind `isAdminUser` in `api/admin/match/[allocator_id]/route.ts` | 201-26 | `AllocatorMatchQueue.test.tsx` "a name only for a published strategy" (extra neuter RED) |
| `src/components/admin/CandidateDetail.tsx` | detail `h2` | same | 201-26 | same arm (extra neuter RED, 5 failed) |
| `src/components/admin/match/ShortlistCard.tsx` | card title | same | 201-26 | same arm (extra neuter RED, 5 failed) |
| `src/components/admin/SendIntroPanel.tsx` | panel header | same | 201-26 | `AllocatorMatchQueue.test.tsx` "the Send intro panel heads a draft strategy with ghost-cand" (extra neuter RED) |
| `src/app/(dashboard)/allocations/widgets/risk/CorrelationMatrix.tsx` | inline chain, two paths (no resolver call) | payload redacted upstream; alias, name, codename, `Unnamed strategy` | 201-26 | `CorrelationMatrix.names.test.tsx` "name before codename" (neuter (a) RED, computed path) |
| `src/app/(dashboard)/allocations/widgets/risk/RiskDecomposition.tsx` | inline chain (no resolver call) | payload redacted upstream; alias, name, codename, `?` | 201-26 | `RiskDecomposition.names.test.tsx` |

### Admin surfaces: gate, refusal test, draft arm

| surface | gate symbol | test that refuses a non-admin | draft arm |
|---|---|---|---|
| `AdminTabs` intro tab | `isAdminUser` in `src/app/(dashboard)/admin/page.tsx` | `admin/page.test.tsx` "bounces a non-admin to the role home, not to Discovery" | `AdminTabs.test.tsx`: draft, private, pending_review and archived each keep `Ghost-7` and never print `Fibonacci Ghost` |
| `AllocatorMatchQueue`, `CandidateDetail`, `ShortlistCard`, `SendIntroPanel` | `isAdminUser` in `src/app/api/admin/match/[allocator_id]/route.ts` | `route.test.ts` "returns 403 when the authenticated caller is not an admin" | `AllocatorMatchQueue.test.tsx`: draft, private, pending_review, archived and a status-less row each keep their codename in the candidate, excluded and history rows; plus the Send intro panel draft arm |

**The admin's-own-draft edge, admitted.** `isDiscoveryVisible(row, null)` treats a null viewer id as no owner, so an admin who owns a draft strategy sees its codename on the admin surfaces, which is HEAD's output. Covering it would mean shipping `user_id` to the admin client (the matcher candidate embed already selects it, the intro-request embed does not); I did not add that. Reported, not fixed.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `queries.audit-2026-05-07.test.ts` pinned the old flagged-candidate premise**
- **Found during:** Task 3 (full `src/__tests__ src/lib/queries` run)
- **Issue:** "flaggedHoldings.top_candidate_name is redacted for exploratory candidate strategies" expected the codename for a published exploratory candidate with a real name. The plan directs `{ visible: true }` at this call site (the read is `withPublishedOnly`), which is the D-17 reading, so the arm's premise (a tier rule) is the thing being retired. The file is not in the plan's `files_modified`.
- **Fix:** rewrote the arm to the D-17 premise (published candidate prints its name; a null-name candidate prints the codename) and renamed it.
- **Files modified:** `src/lib/queries.audit-2026-05-07.test.ts`
- **Commit:** e9c0b69f9

**2. [Rule 1 - Bug] Two adapter tests encoded the old tier premise**
- **Found during:** Task 1
- **Issue:** `strategies-row-adapter.test.ts` "exploratory falls back to codename, never the real name" and the `[DISCLOSURE]` third-party arm fed a real name through the adapter and expected the codename. In the payload a name the viewer cannot see is already null, so the honest fixture for the not-visible direction is `name: null`.
- **Fix:** the first arm became two (a readable name prints ahead of the codename; a null name falls back to the codename); the `[DISCLOSURE]` arm now feeds `name: null` and says why. Both files are declared.
- **Commit:** 42244cf0f

**3. [Rule 3 - Blocking] `critical-regressions.test.ts` greps `PendingIntros.tsx` for the string `contact_requests`**
- **Found during:** Task 3 (my first comment named the table). Reworded the comment to "the intro-request read"; no behaviour change.

### Scope notes (not deviations)

- `src/app/(dashboard)/admin/page.test.tsx` is not a declared file, so the admin page's `status` embed has no unit-test pin of its own. I wrote and then reverted an arm for it to honour the declared-files rule. The page's contribution is exercised only through the `AdminTabs` fixtures. Recorded as a gap.
- `status` is optional on the three admin row types rather than required, to avoid touching test fixtures outside the plan and because absent-means-withhold is the safe direction.

## RED proofs

Each neuter was applied on a byte backup under the scratchpad `201-26/`, the named RED observed, the file copied back with `cp -p`, `cmp` exit 0, GREEN.

gc-201-26-neuter: gate=CorrelationMatrix computed path restored to codename-first (CorrelationMatrix.names "computed path: a readable name beats the codename") result=red restored=identical
- Failing line: `× computed path: a readable name beats the codename`, 1 failed, 8 passed.

gc-201-26-neuter: gate=holdings-adapter given `{ visible: false }` (holdings-adapter.test "a readable name prints ahead of the codename (D-17)") result=red restored=identical
- Failing lines: `× a readable name prints ahead of the codename (D-17)`, `× institutional-tier rows surface canonical name when codename is absent`, `× resolves strategy from strategies[].alias with fallback to .name ...`, 3 failed.

gc-201-26-neuter: gate=AdminTabs `{ visible: true }` in the intro call (AdminTabs.test "a draft strategy keeps its codename and never prints its name", plus private, pending_review, archived) result=red restored=identical
- Failing lines: five failed (the four status arms and the older "does NOT leak an exploratory-tier strategy name" arm).

gc-201-26-neuter: gate=strategy-display `viewer` optional again (typecheck on strategy-display.test "the viewer argument is required") result=red restored=identical
- Failing line: `src/lib/strategy-display.test.ts(64,5): error TS2578: Unused '@ts-expect-error' directive.`

Extra neuters, beyond the four the plan names (same discipline, restored identical, none changes the count above): `StrategyHeader` forwarding `{ visible: true }` (header test 1 failed); `match.ts` embeds without `status` (`match.test.ts` "reads the strategy's status in the candidate and decision embeds (D-17)" 1 failed); `CandidateDetail`, `ShortlistCard` and `AllocatorMatchQueue` each with `visible` forced true (5 failed in `AllocatorMatchQueue.test.tsx` each); `SendIntroPanel` forced true (1 failed, the Send intro panel draft arm, which I added after finding that neuter initially left every test green); `PendingIntros` forced false (stayed green: the gap recorded in the table).

## Verification

- `codename-first: 0` (the plan's codename-first grep; 3 at HEAD, the 201-02 `codename-first-baseline`). Plan 201-24 re-checks it.
- `displayStrategyName(<single argument>)` grep: 0; `@ts-expect-error` in `strategy-display.test.ts`: 1; `nameVisible` in `StrategyHeader.tsx`: 3; `isDiscoveryVisible(` in each of the five admin components: at least 1.
- `node scripts/verify-plan-anchors.mjs` on this plan: OK, 12 claims.
- Full `npx vitest run`: 1214 files passed, 1 failed. The only failures are the 2 known pre-existing float-snapshot arms in `src/lib/factsheet/compute.conventions.test.ts` under local Node 25 (fixtures B and C), which this plan does not touch.

census-neutral: checked

Every string literal this plan adds or changes outside a comment is a call argument or a select column list: `{ visible: ... }` objects and the word `status` in three PostgREST select strings. None contains a retired word, a registered term label or a date. The fallbacks `Unnamed strategy` and `?` are untouched, and no JSX text changed (new JSX content is comments only). `public-truth-census.test.tsx` and `figure-gate-census.test.ts` pass.

gc-201-26-gates: vitest=green eslint=clean tsc=clean

(vitest green apart from the 2 pre-existing `compute.conventions` arms named above; `npx eslint` clean on every touched source and test file; `npm run typecheck` clean.)

## Known Stubs

None. `StrategyHeader` has no caller at HEAD (recorded in the table), and `allocation-helpers.displayName` has no production importer; both are kept, not stubs.

## Threat Flags

None. No new endpoint, auth path or schema change. The three added select columns (`status`) are read behind the existing admin gates and never reach the browser as a name.

## Self-Check: PASSED

- FOUND: src/app/(dashboard)/allocations/widgets/risk/RiskDecomposition.names.test.tsx
- FOUND: 42244cf0f, 471ac3a45, e9c0b69f9, 870ccac12 (all ancestors of HEAD)
