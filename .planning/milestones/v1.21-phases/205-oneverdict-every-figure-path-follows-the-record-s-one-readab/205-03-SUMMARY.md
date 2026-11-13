---
phase: 205-oneverdict-every-figure-path-follows-the-record-s-one-readab
plan: 03
subsystem: factsheet
tags: [figure-record, allocator-blends, api-arm, cache-key, parity]
requires: ["205-02"]
provides:
  - api-arm allocatorPortfolios null on an unreadable record
  - factsheet payload cache key v23
affects: []
tech-stack:
  added: []
  patterns: [one verdict gates every record-derived figure, never a date guard in the date math]
key-files:
  created: []
  modified:
    - src/lib/factsheet/build-payload.ts
    - src/lib/factsheet/audit-c20.test.ts
    - src/app/factsheet/[id]/v2/StressWindowsPanel.unreadable.test.tsx
    - src/__tests__/figure-parity-pages.test.tsx
    - src/app/factsheet/[id]/v2/page.tsx
    - src/lib/factsheet/fetch-and-build-payload.ts
    - src/app/factsheet/[id]/v2/page.public-cache-key.test.tsx
    - src/app/factsheet-share/[token]/page.cache-isolation.test.tsx
decisions:
  - "D-03: allocatorPortfolios is `totalRecord.unreadable ? null : [...]`; alignBlend and isoDayBefore are untouched, so a throw there on a readable record still signals a code bug"
  - "D-05: payload cache key v22 to v23 with a dated rationale; the four hand-typed key expectations read v23"
metrics:
  duration: ~25m
  completed: 2026-11-10
status: complete
requirements: [194.2-R3-WR-03]
requirements-completed: [194.2-R3-WR-03]
actuals:
  tokens: 3700
  tasks: 3
  commits: 3
plan_head_before: fefdb50a9ef871317ba7e0839a5c959df84b5336
plan_head_after: bb3c40bf1da4849684e57cceb45453d66ab80df8
coverage:
  - id: D1
    description: "An api-arm build whose first date is unparseable returns a withheld payload (record unreadable, allocatorPortfolios null, withheld stress form) instead of throwing; a readable api record keeps three blends"
    requirement: "194.2-R3-WR-03"
    verification:
      - kind: unit
        ref: "src/app/factsheet/[id]/v2/StressWindowsPanel.unreadable.test.tsx#205 D-03: the api arm withholds the allocator blends on an unreadable record"
        status: pass
    human_judgment: false
  - id: D2
    description: "The production fetch path resolves a withheld payload for an api-arm curve whose second date is 2024-01-1, with and without a BTC native unit (USD view unreadable too)"
    requirement: "194.2-R3-WR-03"
    verification:
      - kind: integration
        ref: "src/__tests__/figure-parity-pages.test.tsx#205 D-03 parity"
        status: pass
    human_judgment: false
  - id: D3
    description: "Payload cache key v23 in page.tsx with a dated rationale; pinned by two hand-typed key tests"
    requirement: "194.2-R3-WR-03"
    verification:
      - kind: unit
        ref: "src/app/factsheet/[id]/v2/page.public-cache-key.test.tsx and src/app/factsheet-share/[token]/page.cache-isolation.test.tsx"
        status: pass
    human_judgment: false
---

# Phase 205 Plan 03: the api arm withholds the allocator blends on an unreadable record Summary

On the api arm (every PROD strategy) an unreadable record now builds a payload with `allocatorPortfolios: null` instead of throwing `RangeError: Invalid time value` out of `alignBlend`'s `isoDayBefore(dates[0])` and sending `/factsheet/<id>` to the route error page; the payload cache key is bumped to v23. This closes 194.2-REVIEW-R3 WR-03 and completes the phase goal (one readability verdict on every figure path).

## Commits

| Task | Commit | Subject |
|------|--------|---------|
| 1 | c3e3b6c5e | fix(205): the api arm withholds the allocator blends on an unreadable record (D-03) |
| 2 | 6b16d0854 | test(205): an unreadable api-arm curve returns a withheld payload (D-03) |
| 3 | bb3c40bf1 | fix(205): bump the factsheet payload cache key to v23 (D-05) |

## What changed

- `build-payload.ts`: in the api-arm return of `buildFromBuildableSeries`, `allocatorPortfolios: [` became `allocatorPortfolios: totalRecord.unreadable ? null : [`; the three blend objects are byte-identical; a `205 D-03` comment states why (record-derived figure, `alignBlend` reached only through `portfolioFigures` inside the array literal, no guard in `alignBlend`). `allocator.ts` and `peerPercentile` are untouched (`git diff --quiet HEAD -- src/lib/factsheet/allocator.ts` exit 0).
- `audit-c20.test.ts`: `makeReadableReturns` helper added beside `makeReturns` and used only by 'api strategy: all four synthesized fields are present and non-null' (its `makeReturns(40)` dates impossible days `2024-01-32`..`2024-01-40`, so the record was unreadable). Assertions unchanged.
- `StressWindowsPanel.unreadable.test.tsx`: new describe `205 D-03` with helper `apiPayloadWithFirstDate` (300 readable days from 2024-10-02), `it.each` over the five first dates, and a readable control (`"2024-10-01"`, three blends). `payloadWithFirstDate` and its range untouched.
- `figure-parity-pages.test.tsx`: `btcNativeAnalytics` gained an optional `dataQualityFlags` argument (default unchanged); new describe `205 D-03 parity` with an `it.each` over `null` and `{ native_unit: "BTC" }` flags, curve from 2024-01-09, `curve[1].date = "2024-01-1"`.
- Cache key: `page.tsx` keyParts and a dated `Bumped v22→v23 (Phase 205 ONEVERDICT, 2026-11-10)` comment under the v21→v22 one; `fetch-and-build-payload.ts` `CACHE KEY REALITY` quote; three expectations in `page.public-cache-key.test.tsx`; `EXPECTED_KEY_PREFIX` in `page.cache-isolation.test.tsx` (hand-typed, never imported).

## RED at HEAD (before the source edit)

`npx vitest run "src/app/factsheet/[id]/v2/StressWindowsPanel.unreadable.test.tsx"`: `Tests 5 failed | 9 passed (14)` (all five new D-03 cases; the readable control passed). Observed per date, each run singly with `-t`:

gc-205-03-head: date="" mode=throws
gc-205-03-head: date="2023-13-01" mode=throws
gc-205-03-head: date="2023-02-32" mode=throws
gc-205-03-head: date="2024-1-5" mode=throws
gc-205-03-head: date="2024-02-30" mode=array

`throws` is `RangeError: Invalid time value`; `array` is `AssertionError: expected [ { key: 'sixty_forty', ...(18) }, ...(2) ] to be null` (`Date.parse` rolls `2024-02-30` to 2024-03-01, so it never threw; the record verdict still reads it unreadable). This matches the planner's pre-measurement; no other api-arm step threw once the ternary was in, so there is no `gc-205-03-extra-site`.

## Neuter evidence (D-04)

Byte backups in the scratchpad `205-03/` directory; restored by `cp`, verified by `cmp` (exit 0); never git checkout, restore or stash. After each restore the gate re-ran green.

gc-205-03-neuter: mutation=ternary_dropped scope=panel_file result=red restored=identical
- `sed` restored `allocatorPortfolios: [` without the ternary in `build-payload.ts`. RED: all five `× an api build whose first date is <date> returns a withheld payload with null blends` (`Tests 5 failed | 9 passed (14)`). cmp=0; 14/14 green after.

gc-205-03-neuter: mutation=ternary_dropped scope=parity_file result=red restored=identical
- Same mutation, parity file. RED: `× a curve whose second date is "2024-01-1" resolves withheld with no native unit` and `... with a BTC native unit`, both `RangeError: Invalid time value` (`Tests 2 failed | 62 passed (64)`). cmp=0, `git diff --quiet -- src/lib/factsheet/build-payload.ts` exit 0 after restore; 64/64 green after.

gc-205-03-neuter: mutation=key_left_v22 result=red restored=identical
- `page.tsx` keyParts literal set back to `"factsheet-v2-payload-v22"`. RED in `page.public-cache-key.test.tsx`: `× 3. the token lane does not shift the PUBLIC lane's key shape ...`, `× KEY SHAPE: the key is the shape version, the id, computed_at ...`, `× the key carries the raw stamp and a short fingerprint ...`, `× KEY SHAPE edge: a row whose analytics embed carries no status keys ...` (`Tests 4 failed | 16 passed (20)`, `Test Files 2 failed (2)`: the share-lane `page.cache-isolation.test.tsx` also went RED). cmp=0; 20/20 green after.

## Verification (exact commands, counts)

- `npx vitest run "src/app/factsheet/[id]/v2/StressWindowsPanel.unreadable.test.tsx" src/lib/factsheet/audit-c20.test.ts src/lib/factsheet/build-payload.test.ts src/lib/factsheet/build-payload.null-honest.test.ts` (Task 1 GREEN): 4 files, 95 passed, 0 failed.
- `npx vitest run src/__tests__/figure-parity-pages.test.tsx` (Task 2): 1 file, 64 passed, 0 failed.
- `npx vitest run "src/app/factsheet/[id]/v2/page.public-cache-key.test.tsx" "src/app/factsheet-share/[token]/page.cache-isolation.test.tsx"` (Task 3): 2 files, 20 passed, 0 failed.
- `npx tsc --noEmit`: clean after Tasks 1, 2 and 3.
- `node scripts/verify-plan-anchors.mjs <205-03-PLAN.md>`: 8 claims checked, no stale.
- Plan scope, `npx vitest run src/lib/factsheet "src/app/factsheet" "src/app/factsheet-share" "src/app/(dashboard)/allocations" src/__tests__/figure-parity-pages.test.tsx`: `Test Files  1 failed | 380 passed (381)`, `Tests  2 failed | 6670 passed (6672)`.

gc-205-03-scope: failed=2 files=compute.conventions.test.ts-only

The two failures are `compute.conventions.test.ts` fixture B (zero-return days) and fixture C (interior calendar gaps), the known pre-existing failures at base; not touched.

- Api-arm fixtures outside the plan scope (`grep -rlaF 'ingestSource: "api"' src | grep -a '\.test\.'` minus the scope directories): one file, `src/app/api/og/factsheet/[id]/route.stored-parity.test.tsx`; `npx vitest run` on it: 1 file, 22 passed, 0 failed.

gc-205-03-api-fixtures: files=1 failed=0

- Readable-record payload snapshot unmoved: no `-u` run; `git diff --stat 240999b5f..HEAD -- src/lib/factsheet/__snapshots__` is empty (also empty over the whole phase branch).
- Acceptance greps: `makeReadableReturns` in `audit-c20.test.ts` = 2; `205 D-03` in the panel test >= 1; `factsheet-v2-payload-v23` in `page.public-cache-key.test.tsx` = 3 and in `page.cache-isolation.test.tsx` = 1; `Bumped v22→v23 (Phase 205 ONEVERDICT` present in `page.tsx`; `allocatorPortfolios: totalRecord.unreadable ? null : [` present; `grep -rn "payload-v22" src` is empty.

## Null rendering (D-03 truth)

`allocatorPortfolios` has no renderer: its only non-test references are its type in `types.ts` (already `AllocatorPortfolioPayload[] | null`) and its construction in `build-payload.ts`; `BatchDPanels` reads `scenarioPeer` / `scenarioOwnBookDelta` only. `null` therefore prints no false "no data" claim; there is no copy finding.

## Deviations from Plan

None - plan executed as written. Notes:
- The cache-key comment in `page.tsx` says the api arm's blends were previously thrown away "for an unparseable first date" and carried for any other unreadable record, because an interior bad date never threw (only `dates[0]` reaches `isoDayBefore`); the plan's draft wording ("changes ... to null on an unreadable record") is kept in substance.
- The worktree HEAD at start was `fefdb50a9` (the plan text cites `8ef04b130`); the Step 0 anchor check passed.
- `actuals.tokens` is chars/4 over `git diff fefdb50a9..HEAD` (14812 chars).

## Known Stubs

None.

## Threat Flags

None (no new network, auth, file or schema surface). T-205-06, T-205-07 and T-205-08 mitigated and gated as above.

## Self-Check: PASSED

- FOUND: src/lib/factsheet/build-payload.ts, src/lib/factsheet/audit-c20.test.ts, src/app/factsheet/[id]/v2/StressWindowsPanel.unreadable.test.tsx, src/__tests__/figure-parity-pages.test.tsx, src/app/factsheet/[id]/v2/page.tsx, src/lib/factsheet/fetch-and-build-payload.ts, src/app/factsheet/[id]/v2/page.public-cache-key.test.tsx, src/app/factsheet-share/[token]/page.cache-isolation.test.tsx
- FOUND commits c3e3b6c5e, 6b16d0854 and bb3c40bf1 (ancestors of HEAD); `git rev-list --count fefdb50a9..HEAD` = 3 before the docs commit.
- STATE.md, ROADMAP.md and state.json not modified.
