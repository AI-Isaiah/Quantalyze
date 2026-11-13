---
phase: 196-onestrategypage-a-strategy-has-one-page-the-factsheet-and-it
plan: 15
subsystem: routing
tags: [route-deletion, tests, factsheet, discovery]
requires: ["196-02"]
provides:
  - "No page code backs /discovery/[slug]/[strategyId]; the URL reaches the factsheet through plan 02's 308"
affects: [196-10, 196-14]
tech-stack:
  added: []
  patterns: ["a retired page's tests move to the factsheet page that now carries the same invariant, or are removed with a named reason"]
key-files:
  created: []
  modified:
    - src/__tests__/phase-147-series-resolution-guards.test.ts
    - src/lib/factsheet/build-payload.headline-source.test.ts
    - src/app/factsheet/[id]/v2/basis-context.benchmark-prices.test.tsx
    - src/app/(dashboard)/strategies/page.share-affordance.test.tsx
    - src/components/layout/DashboardChrome.test.tsx
  deleted:
    - src/app/(dashboard)/discovery/[slug]/[strategyId]/ (8 files)
key-decisions:
  - "Tests that drove the deleted page now drive FactsheetV2Page with the page.smoothed-wiring harness (unstable_cache identity, request-client signature probe, readPublicVerificationSignals stub)"
requirements-completed: [LEAN-02]
status: complete
commits: 1
plan_head_before: aab9f6a1abc16d008aea11e447054698e1767686
plan_head_after: 043c5a1cb86dc6e89ba56f174dd3af96331ee618
actuals:
  tasks: 1
  commits: 1
---

# Phase 196 Plan 15: Delete the discovery detail route tree Summary

The retired discovery detail route tree is gone (8 files, one `git rm -r`), and the five tests that imported, read or scanned it now assert against `/factsheet/[id]/v2` or no longer name the deleted page.

## Task

| Task | Name | Commit |
|------|------|--------|
| 1 | Tracer: delete the tree, move every test that loaded it | 043c5a1cb |

Deleted by the commit (exactly the plan's `files_deleted`): `loading.tsx`, `page.tsx`, `page.aum-gate.test.tsx`, `page.metadata.test.tsx`, `page.one-path.test.tsx`, `page.pending-fallback.test.tsx`, `page.smoothed-wiring.test.tsx`, `page.usd-trust.test.tsx`, all under `src/app/(dashboard)/discovery/[slug]/[strategyId]/`. `git show --first-parent --diff-filter=D --name-only HEAD` lists only those eight paths.

## Moved tests (one row per changed arm)

| Test | Arm | Disposition |
|------|-----|-------------|
| `phase-147-series-resolution-guards.test.ts` | `allowlist` existence list | removed the deleted page's row (the other seven surfaces stay) |
| same | "REFERENCE discovery strategy page resolves its series THROUGH the shared builder, never its own assembly" | retargeted: the "never its own assembly" pin (`buildFactsheetPayload(`, `resolveDailyReturnSeries(`, `readCompositeFactsheet(`, `readSingleKeyBasisOpts(`, `readFactsheetBenchmark(` absent) now sits in the existing "REFERENCE factsheet v2 page" arm, which already pinned the shared-builder positive. The v2 page holds the invariant at HEAD (measured: none of the five calls appear in it). The discovery positive pin (shared builder import) was a duplicate of the v2 arm and is not kept separately |
| `build-payload.headline-source.test.ts` | "same row through both call shapes" (169 D-10) | retargeted: second caller is `FactsheetV2Page` (cached wrapper over the same `fetchAndBuildPayloadWithReason` resolve stage) instead of the deleted page; mocks `next/cache` (identity) and `readPublicVerificationSignals`, request client returns the signature probe |
| `basis-context.benchmark-prices.test.tsx` | two D-23 BTC-read-failure arms ("reader answers ok:false", "client throws") | retargeted to `FactsheetV2Page` with the same harness; same assertions (`benchmarkPrices` unavailable form, comparator unavailable block, `console.error` carries `BENCHMARK_READ_FAILED_MESSAGE`, no extra Sentry capture) |
| `strategies/page.share-affordance.test.tsx` | `SITES` drift pin | dropped the deleted page; the strategies page row is unchanged; describe title now says "two sites" |
| `DashboardChrome.test.tsx` | `ALLOWED` map and its carve-out comment | dropped the deleted page's `max-w-[760px]` row and its comment bullet; every other row kept (plan 14 drops the `StrategyV2Shell` row) |

Equivalents for the six deleted in-tree tests that already exist on the factsheet page: `page.aum-gate`, `page.metadata`, `page.usd-trust`, `page.smoothed-wiring`, `page.composite-read-error` and `page.stale-analytics` under `src/app/factsheet/[id]/v2/`. Removed with no factsheet counterpart: the `page.one-path` "probe parity" arms and the discovery-only slug guard, because the contract they pinned (a discovery page that renders iff `probeFactsheetBuildable` says buildable, and a slug that 404s) belongs to the deleted page; the factsheet page's own payload path is the single shared builder pinned by phase-147 above.

## Verification

- Task vitest command (5 files): 96 passed, 0 failed.
- `npx tsc --noEmit`: clean.
- `npm run check:route-contract`: `OK - 51 page routes, all declared in the manifest.` (no STALE, MISSING-REDIRECT or UNCLASSIFIED).
- Wider run `src/__tests__`, `src/components/layout`, `src/app/(dashboard)`: 9472 passed, 1 failed; the one failure is the known sibling-SUMMARY noise (`verify-plan-anchors` "--pending exits 0").
- Precondition: `grep -a -c 'redirectFrom: "/discovery/:slug/:strategyId"' src/lib/routing/route-contract-manifest.ts` returned 1 before any edit.

Grep gates (HEAD before, after), non-comment lines matching `discovery/\[slug\]/\[strategyId\]/page`:

| File | Before | After |
|------|--------|-------|
| phase-147-series-resolution-guards.test.ts | 2 | 0 |
| build-payload.headline-source.test.ts | 1 | 0 |
| basis-context.benchmark-prices.test.tsx | 1 | 0 |
| strategies/page.share-affordance.test.tsx | 1 | 0 |
| DashboardChrome.test.tsx | 1 | 0 |

`find "src/app/(dashboard)/discovery/[slug]/[strategyId]" -type f | wc -l`: 8 before, 0 after.

## RED evidence (neuter, backed up with cp, restored, cmp)

1. Retargeted phase-147 pin: appended a non-comment `buildFactsheetPayload(1)` to `src/app/factsheet/[id]/v2/page.tsx`. RED, `REFERENCE factsheet v2 page still resolves its series THROUGH that builder`: "the factsheet page assembles the factsheet itself: expected [ 'buildFactsheetPayload(' ] to deeply equal []". Restored, `cmp` identical.
2. Retargeted headline-source arm: neutered the analytics-row argument to `readSingleKeyBasisOpts` in `fetch-and-build-payload.ts`. RED, `169 D-10 - both factsheet callers render the persisted CAGR and Sharpe`: "expected 0.1569... to be 0.12" (the TypeScript headline instead of the persisted one). Restored, `cmp` identical.

Not neutered: the two benchmark-prices error arms (assertions copied unchanged onto the new driver; the arms were green before and after) and the two tree-scan edits (`ALLOWED`, `SITES`), which fail both ways by construction.

## Exclusion-row result (Phase 194.1 census)

`grep` for `redirected by 196` under `src/__tests__` finds only `figure-gate-census.test.ts`, whose redirected rows name `src/app/strategy/[id]/page.tsx` and the v2-only panels; none names a file this plan deletes, so no exclusion row was removed.

## Deviations from Plan

None. The plan's decision rule (retarget if the same invariant is asserted on the factsheet page, otherwise remove with a reason) was applied as written; a `getStrategyDetail` mock in two tests was replaced by the `readPublicVerificationSignals` stub the factsheet page reads (Rule 3, required by the retarget).

## Notes for later plans

- `src/app/factsheet/[id]/v2/FactsheetView.tsx:35` and `src/lib/factsheet/composite-read-path.ts` still carry comment-only mentions of the deleted page or of "three sites" (left untouched, surgical); plan 05 or 10 may reword the FactsheetView comment if they edit that block.
- Library modules the deleted page imported (`BookIntroCall`, etc.) are left for plan 14's orphan sweep.
- No PROD access was needed or used; nothing here depends on PROD data.

## Known Stubs

None.

## Self-Check: PASSED

- `find "src/app/(dashboard)/discovery/[slug]/[strategyId]" -type f` prints nothing.
- Commit `043c5a1cb` is an ancestor of HEAD.
- The five moved tests exist and pass.
