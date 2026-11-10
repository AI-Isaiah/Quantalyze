---
phase: 196-onestrategypage-a-strategy-has-one-page-the-factsheet-and-it
plan: 16
subsystem: ui
tags: [factsheet, advanced-disclosure, peer-ranks, terms, benchmark, tearsheet-homes, figure-gate]
status: complete

requires:
  - phase: 196
    provides: "plan 11 hasRailContent / Advanced rail, plan 13 PeerRanksSection and the verified home table, plan 19 single main landmark"
provides:
  - "readPeerRanks / withPeerRanks: the tear sheet's rank source (getPercentiles) read per request on the published lane, overlaid after the shared cache"
  - "optional FactsheetCommon.peerRanks, never stored in the cached object"
  - "PeerRanksSection mounted at the end of the Advanced Detailed metrics rail, with hasPeerRanks as its own predicate"
  - "a Benchmark row in Terms (declared value only)"
  - "FactsheetBody.tearsheet-homes.test.tsx: one arm per HEAD tear sheet item with a factsheet home"
affects: [196-21]

key-files:
  created:
    - src/lib/factsheet/peer-ranks.ts
    - src/lib/factsheet/peer-ranks.test.ts
    - "src/app/factsheet/[id]/v2/page.peer-ranks.test.tsx"
    - "src/app/factsheet/[id]/v2/FactsheetBody.peer-ranks.test.tsx"
    - "src/app/factsheet/[id]/v2/FactsheetBody.tearsheet-homes.test.tsx"
  modified:
    - src/lib/factsheet/types.ts
    - "src/app/factsheet/[id]/v2/page.tsx"
    - "src/app/factsheet/[id]/v2/FactsheetView.tsx"
    - "src/app/factsheet/[id]/v2/MandatePanels.tsx"
    - src/components/strategy/PeerRanksSection.tsx
    - "src/app/factsheet/[id]/v2/page.composite-read-error.test.tsx"

key-decisions:
  - "The ranks are read after the cached build, started before the viewer decisions and awaited after them so the read overlaps them; readPeerRanks never rejects, so the early start cannot leave an unhandled rejection"
  - "The ranks wrapper column: the Detailed metrics aside and the ranks section sit in one flex-col grid child (gap-12), so the rail's own markup is untouched"
  - "Terms Benchmark row is not gated on the variant, so the full layout (allocator mounts) shows a declared benchmark too; see Deviations"

requirements-completed: [LEAN-02, LEAN-05]

actuals:
  tokens: 52000
  tasks: 3
  commits: 3
plan_head_before: 3bd28f05a45f0ecc734353596bf28d92f448c9ea
plan_head_after: b9d291a88
---

# Phase 196 Plan 16: Peer ranks and the declared benchmark get a home on the strategy's one page Summary

The strategy's published factsheet now carries the tear sheet's five peer-relative ranks at the end of the Advanced Detailed metrics rail (same `getPercentiles` source, same `PeerRanksSection`, same 194 record gate) and a Benchmark row in Terms for a declared benchmark; a test names every HEAD tear sheet item that has a factsheet home and asserts it renders there.

## Commits

| Task | Commit | What |
|------|--------|------|
| 1 (tracer) | cb91e0802 | `peer-ranks.ts`, `PeerRanks` type, published-lane overlay in `page.tsx`, mount in the Advanced rail, `page.peer-ranks.test.tsx` (7 arms) |
| 2 | 8ea8195cc | `hasPeerRanks` exported and ORed into the Advanced rail flag; `FactsheetBody.peer-ranks.test.tsx` (8 arms), `peer-ranks.test.ts` (9 arms) |
| 3 | b9d291a88 | Terms Benchmark row; `FactsheetBody.tearsheet-homes.test.tsx` (30 arms) |

## Tracer gate (auto mode)

`<verify>` re-run end to end after Task 1: `page.peer-ranks.test.tsx`, `page.aum-gate.test.tsx`, `page.public-cache-key.test.tsx` 29 passed, `npx tsc --noEmit` clean. Tracer verified, expansion proceeded.

## Grep gates

| Check | At HEAD | Now |
|-------|---------|-----|
| `peerRanks` in `types.ts` | 0 | 1 |
| `readPeerRanks` in `v2/page.tsx` | 0 | 3 (import, call, comment) |
| `PeerRanksSection` in `FactsheetView.tsx` | 0 | 2 (import, mount) |
| `hasPeerRanks` in `FactsheetView.tsx` | 0 | 3 |
| `label="Benchmark"` in `MandatePanels.tsx` | 0 | 1 |
| `  it(` in `FactsheetBody.peer-ranks.test.tsx` | file absent | 8 (plan: at least 6) |

## Home-test arm count against the home table

The verified home table in `196-13-SUMMARY.md` has 21 rows. Four are not factsheet homes (manager identity panel, contact box, Risk Disclosure: tear sheet only; the "Institutional Tear Sheet" eyebrow: no home by decision). **Factsheet-home rows: 17. `it(` arms in `FactsheetBody.tearsheet-homes.test.tsx`: 30** (plan minimum 17 + 2 = 19). The arms are finer than the rows: the hero and detail grids are one arm per figure (7), the Main metrics row is one per item (4), the trade-fetch row is three (trade-fetch line, gap lines, reconstructed ranges), the Generated row is two (footer stamp, Terms "Factsheet computed"), plus the two benchmark behavior arms.

## Neuter records (each: cp backup, RED naming the arm, cp restore, `cmp` exit 0, GREEN)

1. **Ranks read inside the shared cache, `page.tsx`.** The `readPeerRanks` call moved into the `unstable_cache` callback and overlaid there: RED, 2 arms in `page.peer-ranks.test.tsx`: `never lets the read into the object the shared cache stores` (`peerRanks entered the shared cache`) and `hands FactsheetView this strategy's entry ... scoped by that slug` (getPercentiles called twice). Restored, `cmp` 0, 7 passed.
2. **Rank gate, `PeerRanksSection.tsx`.** `percentile = percentiles[metric]` (withheld drop removed), run against both mounts: RED on the factsheet mount (`FactsheetBody.peer-ranks.test.tsx`: the 20-observation arm, the null-record arm, and the `hasPeerRanks` predicate arm) and on the tear sheet mount (`page.rank-gate.test.tsx`: the same two arms). One component, two mounts. Restored, `cmp` 0, 21 passed across the three files.
3. **Benchmark row, `MandatePanels.tsx`.** Row removed: RED, 2 arms in `FactsheetBody.tearsheet-homes.test.tsx` (`Allocation Terms: Benchmark (declared) -> a Benchmark row in Terms`, `a declared benchmark shows as a Benchmark row reading that value, inside Advanced`). Restored, `cmp` 0, 30 passed.
4. (extra) **Rail content, `FactsheetView.tsx`.** `|| hasRanks` removed from `hasRailContent`: RED, 1 arm (`counts the ranks as rail content`). Restored, `cmp` 0.

## Verification

- `npx vitest run "src/app/factsheet/[id]/v2/FactsheetBody" src/lib/factsheet/peer-ranks.test.ts "src/app/factsheet/[id]/tearsheet"`: green (97 files with `src/components/strategy`).
- `npx vitest run src/__tests__ src/app src/components src/lib/factsheet`: 940 files passed, 2 failed, 18 skipped; the 2 are the known noise (`verify-plan-anchors.test.ts` "--pending exits 0", `compute.conventions.test.ts` last-digit snapshots, Node 25 vs CI Node 22). Nothing else failed.
- `npx tsc --noEmit`: clean. `npm run lint`: 0 errors, the same 2 pre-existing warnings (`nativeUnitReason`, `isRankableAnalyticsRow`); planning-hygiene, route and admin-manifest checks OK.
- No migration, no `supabase/**` edit, no package install.

## Deviations from Plan

### Auto-fixed / recorded

**1. [Plan premise false at HEAD, recorded not decided] The census arm cannot assert `repeatedMetrics` equals `[]` with Advanced open.** Plan 11's open item 1 (the Rolling Metrics tables repeat Sharpe, Sortino and Volatility) means the census reports `[sharpe, sortino, volatility]` on fixture A with Advanced open, with or without ranks; `FactsheetBody.census.test.tsx` pins it as an open item. The census arm in `FactsheetBody.peer-ranks.test.tsx` is therefore differential: with the ranks present, `repeatedMetrics`, `metricLabels`, `sections` and `smallSampleWarnings` equal the same fixture without ranks, and the five badges are present (so the equality is not vacuous). The plan's must-have "zero repeated metrics with Advanced open" stays open item 1's, not closed here.

**2. [Rule 3 - blocking] `page.composite-read-error.test.tsx` (outside the file list).** It mocks `@/lib/queries` with only the exports it needs and asserts exact Sentry capture counts; the page's new ranks read hit the missing `getPercentiles` export, was caught fail-soft by `readPeerRanks` and reported to Sentry, making its count 2 instead of 1. Added a `vi.mock("@/lib/factsheet/peer-ranks")` there (null read, identity overlay). The other nine page tests were unaffected. Commit cb91e0802.

**3. [Recorded, plan's literal instruction followed] The Terms Benchmark row is not gated on the `variant`.** The plan says "add a Term row ... rendered only when `native.benchmark` is a non-empty string". The full layout (the allocator mounts and the composer) also renders `TermsPanel`, so a declared benchmark now shows there too. Not a design decision I took: the plan names no variant, no test in the repo pinned the full layout's Terms rows against a declared benchmark, and the whole `v2` suite stayed green. If the allocator mounts are meant to stay byte-identical, the row needs `documentVariant &&`; plan 21's ship notes or the founder can call it.

**4. [Rule 3 - structure] The rail wrapper.** `MetricsColumnWithBasis` was a direct grid child; to put the ranks after it in the same right column it and `PeerRanksSection` are now wrapped in one `flex min-w-0 flex-col gap-12` div (the aside's own markup is untouched). Not visually checked (see Not measured). When the record has no observations but ranks exist, the wrapper renders the ranks alone and the rail is skipped.

### Behaviour worth the reader's eye

- `readPeerRanks` fails soft: a category read error, a thrown read, or a missing cohort all return null and the page renders without the section. The category read reports to Sentry with `area: factsheet-peer-ranks, step: category_read` (a throw reports with `step: read`); `getPercentiles` reports its own errors.
- The ranks ride onto `usdView.payload` too (like the trust tier) but the Advanced mount reads the native payload, so the unit toggle does not move them.
- A strategy with no category ranks against every published strategy (undefined slug), as the tear sheet does; the badges then carry no `in <category>` label.
- The owner lane, the share-token route and the allocator mounts carry no `peerRanks` and render no section; the JSON-LD is built from `payloadWithTrust` and a test pins it byte-identical with and without ranks.

## For plan 21's ship notes

The tear sheet's peer-relative ranks now live inside Advanced at the end of the Detailed metrics rail (published lane only, per request, never cached; the contents line still ends "Detailed metrics"), and a declared benchmark lives as a Benchmark row in Terms inside Advanced; an undeclared benchmark prints no row (the HEAD "BTC" default is not carried). Open for the founder: deviation 3 (Terms Benchmark row also shows on the full layout).

## Not measured

- No browser pass: the right-column wrapper's spacing (`gap-12` between the rail and the ranks), the ranks' look beside the rail, and the print rendering with Advanced open were not looked at. jsdom proves presence, order and gates only.
- No e2e spec run; golden `full-page-*` images for a published strategy with ranks may change (Advanced is closed by default, so the opening view is unchanged, but the printed report gains the section).
- No PROD access. The cohort query is the existing `getPercentiles`; its production latency on the factsheet request was not measured (T-196-42, accepted).

## Known Stubs

None. No TODO, placeholder or hardcoded-empty value introduced.

## Threat Flags

None. No new endpoint or trust boundary: the one new read is a published-only `strategies` select of the strategy's own category on the request client, plus the existing `getPercentiles` (T-196-40, T-196-41 mitigated as planned with neuter evidence; T-196-42 accepted).

## Self-Check: PASSED

Created and modified files exist; commits cb91e0802, 8ea8195cc and b9d291a88 are ancestors of HEAD; `git rev-list --count 3bd28f05a..HEAD` was 3 before this SUMMARY commit.
