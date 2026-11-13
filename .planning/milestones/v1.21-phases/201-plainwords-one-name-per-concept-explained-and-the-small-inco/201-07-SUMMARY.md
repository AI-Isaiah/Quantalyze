---
phase: 201-plainwords-one-name-per-concept-explained-and-the-small-inco
plan: 07
subsystem: strategy-name-resolution
tags: [d-09, d-17, u-11, tearsheet, factsheet-lanes, og-card, security-boundary]
requires: [201-02]
provides:
  - tearsheet title, H1 and manager card on the resolver (U-11 card copy)
  - factsheet pendingName, payload builder factsheetName and OG card name on the resolver
  - publicNamePreview with two equal legs
affects: [201-10, 201-25, 201-26]
tech-stack:
  added: []
  patterns:
    - "one recorded visibility fact per lane, each pinned by a test that was neutered RED"
key-files:
  modified:
    - src/components/strategy/ManagerIdentityPanel.tsx
    - src/components/strategy/ManagerIdentityPanel.test.tsx
    - src/app/factsheet/[id]/tearsheet/page.tsx
    - src/app/factsheet/[id]/tearsheet/page.test.tsx
    - src/app/factsheet/[id]/v2/page.tsx
    - src/app/factsheet/[id]/v2/page.metadata.test.tsx
    - src/app/factsheet/[id]/v2/page.owner-compute-state.test.tsx
    - src/lib/factsheet/fetch-and-build-payload.ts
    - src/lib/factsheet/fetch-and-build-payload.test.ts
    - src/app/api/og/factsheet/[id]/route.tsx
    - src/lib/strategy-display.ts
    - src/lib/strategy-display.test.ts
    - src/components/strategy/StrategyNameBlock.test.tsx
    - src/app/(dashboard)/strategies/[id]/edit/page.test.tsx
    - src/app/api/strategies/[id]/name/route.ts
decisions:
  - "The token lane is not touched: the builder passes { visible: true } for every lane, and the token lane keeps HEAD's name-first output (only a blank name now falls through to the codename)."
  - "The builder stays lane-agnostic (no lane or viewer parameter); the per-lane reasoning lives in a comment and in the lane-facts table."
  - "ManagerIdentityPanel exploratory body gets min-w-0 flex-1 and break-words so a long real name wraps inside the card (the plan's long-text backstop)."
metrics:
  tasks: 3
  completed: 2026-11-11
status: complete
actuals:
  tokens: 12000
  tasks: 3
  commits: 3
plan_head_before: 4833730c6a91bcffa63950b88272a1655330b29f
plan_head_after: a537ea53eed5cac67aa27e4cba3d5b5a6f5d3040
---

# Phase 201 Plan 07: The tearsheet, the factsheet lanes and the OG card print one name from one resolver Summary

The tearsheet now titles, headlines and describes a published strategy under its real name, its manager card says "Pseudonymous manager / Manages {name}" instead of passing the strategy name off as the manager's (U-11), the factsheet's inline name chains collapse onto `displayStrategyName`, and `publicNamePreview` returns what discovery prints. Every lane's visibility fact is recorded below and each is pinned by a test that was neutered to RED.

## What was built

- **Task 1 (tracer), `ManagerIdentityPanel` and the tearsheet.** The `strategyCodename` prop is now `strategyName` (one caller). Exploratory card: eyebrow `Manager`, h3 `Pseudonymous manager`, body `Manages {name}. The manager's identity is disclosed once an allocator requests an introduction and the manager accepts.`, badge `Exploratory`. Disclosed card: last fallback is `Name not provided`. The tearsheet computes the name with `displayStrategyName(strategy, { visible: true })` in both `generateMetadata` and the page; `isAttested`, `effectiveManager`, the identity load and the Risk Disclosure paragraph are untouched (one docblock clause reworded to the U-11 card). The old `Pseudonymous strategy` assertions in `page.test.tsx` and `ManagerIdentityPanel.test.tsx` now read the h3.
- **Task 2, the lanes.** `pendingName` (v2 page), `factsheetName` (payload builder) and the OG route's name use `displayStrategyName(row, { visible: true })`, each with a comment naming its lane's fact. The OG route's absent-row fallback `Strategy` is kept. `page.metadata.test.tsx`'s `withPublishedOnly` mock now discriminates on `status`. `page.owner-lane.test.tsx` already carried the non-owner-on-a-draft arm (arm 8: a signed-in non-owner on an unpublished id runs the owner probe, finds no row and gets `notFound()`), so it was not edited.
- **Task 3, the preview.** `publicNamePreview` computes both legs with `{ visible: true }`; the two-leg return type is unchanged, so `StrategyNameBlock` is unchanged. The `name/route.ts` docblock now states the real-name reading (Phase 201 D-09 and D-17), names Phase 150 for its own D-17 gate, and keeps admin review before publish as the control.

## lane-facts

Each fact was verified at HEAD before writing (`getFactsheetDetail` goes through `withPublishedOnly`; `withTokenBearer` is `(query) => query`; the OG read goes through `withPublishedOnly`).

| lane | file | symbol | predicate that admitted the row | viewer argument | test that fails if it changes |
|---|---|---|---|---|---|
| public (factsheet v2 Lane A) | `src/app/factsheet/[id]/v2/page.tsx` | `generateMetadata` (via `publicNamePreview`) | `withPublishedOnly` on the signature read: published rows only | `{ visible: true }` (inside `publicNamePreview`) | `page.metadata.test.tsx` "a queued DRAFT row never reaches the public title" (neuter (a) RED) |
| owner (factsheet v2 Lane B) | `src/app/factsheet/[id]/v2/page.tsx` | `pendingName` | `withPublishedOrOwner(q, ownerUid)`: a published row or the viewer's own row, both visible to that viewer by `isDiscoveryVisible`; a non-owner on an unpublished id gets `notFound()` | `{ visible: true }` | `page.owner-compute-state.test.tsx` "Phase 201 D-09 ..." (whitespace arm RED under the old chain); `page.owner-lane.test.tsx` arm 8 (non-owner reaches `notFound()`, unedited) |
| token | `src/app/factsheet-share/[token]/page.tsx` | `fetchAndBuildPayload(match.strategy_id, withTokenBearer)` | `withTokenBearer`, the identity predicate: it can serve the token holder an unpublished strategy. NOT changed by this plan (no file of the token lane is touched) | `{ visible: true }` via the builder, justified by D-17: HEAD printed `name ?? codename`, and the resolver's visible order is the same for every non-blank name | `fetch-and-build-payload.test.ts` "TOKEN LANE, pinned to HEAD" (neuter (c) RED) |
| OG card | `src/app/api/og/factsheet/[id]/route.tsx` | `GET` name | its own `withPublishedOnly` read: published rows only | `{ visible: true }` | `route.public-access.test.tsx` P1 (an unpublished row renders the generic card, nothing of the row) and P4 (published renders its name), unedited; neuter (b) RED |
| payload builder | `src/lib/factsheet/fetch-and-build-payload.ts` | `factsheetName` | lane-agnostic by design (SL-1); every caller's predicate admitted the row: public `withPublishedOnly`, owner `withPublishedOrOwner`, token `withTokenBearer`. No lane or viewer parameter was added | `{ visible: true }` | `fetch-and-build-payload.test.ts` token-lane pin plus the name / whitespace / synthetic-label arms and the parameter-count arm; `phase-148-owner-lane-cache-isolation.test.ts` stays green |
| tearsheet | `src/app/factsheet/[id]/tearsheet/page.tsx` | `generateMetadata` and the page `displayName` | `getFactsheetDetail` (`withPublishedOnly`) and `fetchAndBuildPayloadWithReason(id, withPublishedOnly)`: published rows only | `{ visible: true }` | `page.test.tsx` "the real name in the title, the H1 and the manager card" arms; the OG and metadata neuters above cover the same predicate |

One behaviour delta, recorded rather than hidden: a whitespace-only `name` now falls through to the codename on the builder, the v2 pending heading and the title; at HEAD it printed the blank. A blank name names nothing, so no lane names anything HEAD did not name.

## RED proofs (neuter on a byte backup under the scratchpad `201-07/`, see the named RED, `cp -p` back, `cmp` exit 0, GREEN)

gc-201-07-neuter: gate=ManagerIdentityPanel disclosed fallback restored to the strategy name (`manager.company ?? strategyName`) (ManagerIdentityPanel.test "disclosed lane with neither display_name nor company: the heading is Name not provided, not the strategy name") result=red restored=identical
- Failing line: `npx vitest run src/components/strategy/ManagerIdentityPanel.test.tsx` printed `× disclosed lane with neither display_name nor company: the heading is Name not provided, not the strategy name`, 1 failed.

gc-201-07-neuter: gate=v2 page.tsx `generateMetadata` read without the `withPublishedOnly(` wrapper (page.metadata "a queued DRAFT row never reaches the public title") result=red restored=identical
- Failing line: `AssertionError: expected 'Hidden Draft factsheet' to be 'Strategy factsheet'`, 1 failed.

gc-201-07-neuter: gate=OG route read without the `withPublishedOnly(` wrapper (route.public-access P1, the four P5 arms, route.test O4) result=red restored=identical
- Failing line: `× P1 — an UNPUBLISHED id renders the generic card and nothing of the row (D-02, T-170.3-01)` and `AssertionError: expected [ [ 'id', …(1) ] ] to deep equally contain [ 'status', 'published' ]`, 6 failed.

gc-201-07-neuter: gate=fetch-and-build-payload.ts `factsheetName` given `{ visible: false }` (fetch-and-build-payload.test "TOKEN LANE, pinned to HEAD", "a name wins over the codename") result=red restored=identical
- Failing line: `AssertionError: expected 'SD-1' to be 'Shared Draft'`, 2 failed.

gc-201-07-neuter: gate=strategy-display.ts `publicNamePreview` discovery leg given `{ visible: false }` (strategy-display.test equal-legs arms, edit page.test preview arms, page.metadata "the title is the rename place's factsheet leg") result=red restored=identical
- Failing line: `AssertionError: expected 'Fibonacci Ghost' to be 'Ghost-7'` and `expected "vi.fn()" to be called with arguments`, 7 failed.

Extra, beyond the five the plan names (the plan's "see RED where the code changes behaviour"): gc-201-07-neuter: gate=builder `factsheetName` and v2 `pendingName` both restored to the old `name ?? codename ?? ...` chains (fetch-and-build-payload.test "a whitespace-only name falls through to the codename", owner-compute-state "a whitespace-only name falls through to the codename") result=red restored=identical. Failing lines: `AssertionError: expected '   ' to be 'Ghost-7'` and `expected '   ' to be 'DA-1'`, 2 failed.

An earlier attempt at neuter (a) produced a syntax error in the neutered file (a trailing comma inside a parenthesised expression), so the run was a transform failure rather than a named RED; the file was restored byte-identical (`cmp` 0) and the neuter redone with a no-op function in the wrapper's place, which produced the RED above.

gc-201-07-gates: vitest=green eslint=clean tsc=clean

Details: vitest over `src/app/factsheet`, `src/lib/factsheet`, `src/app/api/og`, `src/app/api/strategies`, `src/components/strategy`, `src/app/factsheet-share`, `src/lib/strategy-display.test.ts`, `src/app/(dashboard)/strategies`, `public-truth-census`, `figure-gate-census` and `phase-148-owner-lane-cache-isolation`: 338 files passed, 6589 tests passed. The one failing file, `src/lib/factsheet/compute.conventions.test.ts` (2 float-snapshot arms, fixtures B and C), is the known pre-existing local failure under Node 25 and is not this plan's. `npx eslint` was clean on every touched source and test file; `npm run typecheck` was clean.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Existing assertions on the retired card copy and the codename-first H1**
- **Found during:** Task 1
- **Issue:** `page.test.tsx` and `ManagerIdentityPanel.test.tsx` matched `/Pseudonymous strategy/i`, and the pending-state arm expected the H1 `STRAT-001`; the U-11 copy and the resolver make both stale by design.
- **Fix:** the assertions read the new h3 `Pseudonymous manager` and the real name `Test Strategy`. These are the plan's own behaviour changes, not a weakening: every arm still discriminates between the exploratory and disclosed lanes.
- **Files modified:** `src/app/factsheet/[id]/tearsheet/page.test.tsx`, `src/components/strategy/ManagerIdentityPanel.test.tsx`
- **Commit:** bddd2dfc6

**2. [Rule 2 - Missing critical functionality] Long real name wrapping in the exploratory card**
- **Found during:** Task 1
- **Issue:** the plan's must-have truth requires a long real name to wrap or truncate at 390px and 1440px, but the exploratory card's text column had no `min-w-0`, so an unbroken long name could push the badge out.
- **Fix:** the column gets `min-w-0 flex-1` (the disclosed lane already has it) and the body `break-words`. Classes otherwise unchanged. The visual check itself is the backstop item (no Playwright locally).
- **Files modified:** `src/components/strategy/ManagerIdentityPanel.tsx`
- **Commit:** bddd2dfc6

Otherwise the plan executed as written. `page.owner-lane.test.tsx` and `route.public-access.test.tsx` needed no edit (arm 8 and P1/P4 already carry the proofs the plan asks for); both are listed in `files_modified` for the case an edit was needed.

## Verification status

- `long-text` truth (a long real name wraps or truncates with title recovery at 390px and 1440px): backstop, not run here (no Playwright locally). The code half is in place: the exploratory column is `min-w-0 flex-1` and the body is `break-words`.

## Known Stubs

None.

## Threat Flags

None. No new endpoint, auth path or schema surface; the lane facts above are the T-201-10 mitigation record, and the U-11 copy plus the untouched `isAttested` / `effectiveManager` gate are the T-201-11 mitigation.

## Self-Check: PASSED

- Commits `bddd2dfc6`, `6d723b4ad` and `a537ea53e` are ancestors of HEAD on `wt/201-p07`.
- `grep -a -c strategyCodename` on `ManagerIdentityPanel.tsx` is 0, `Pseudonymous manager` is 1, `data?.name ?? data?.codename` in the OG route is 0, the continuation-line grep is 0 in both files, `strategy.name ?? strategy.codename` in `strategy-display.ts` is 0.
- The SUMMARY carries the `lane-facts` table (six rows), five `gc-201-07-neuter:` lines (plus one extra) and the gates line.
- STATE.md, ROADMAP.md, CHANGELOG.md, VERSION and TODOS.md were not touched.
