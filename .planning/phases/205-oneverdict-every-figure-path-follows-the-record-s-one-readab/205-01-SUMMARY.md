---
phase: 205-oneverdict-every-figure-path-follows-the-record-s-one-readab
plan: 01
subsystem: factsheet
tags: [figure-record, usd-view, sentry, parity]
requires: []
provides:
  - BuildFactsheetOpts.inheritedUnreadable (replaces recordSourceDates)
  - buildUsdView nativeUnreadable argument
  - own-verdict Sentry report predicate
affects: [205-02, 205-03]
tech-stack:
  added: []
  patterns: [one verdict inherited by construction, never re-scanned]
key-files:
  created: []
  modified:
    - src/lib/factsheet/build-payload.ts
    - src/lib/factsheet/fetch-and-build-payload.ts
    - src/__tests__/figure-parity-pages.test.tsx
decisions:
  - "D-01: USD record verdict = native verdict, OR'd in via inheritedUnreadable; no second date scan"
  - "Report predicate is the build's own verdict (firstBad || endsRecord.unreadable), not totalRecord"
metrics:
  duration: ~25m
  completed: 2026-11-10
status: complete
requirements: [194.2-R3-WR-01]
actuals:
  tokens: 9000
  tasks: 2
  commits: 2
plan_head_before: 240999b5f00c0442a488a445c7787fe237ba181c
plan_head_after: 05c77797a2e4ee54e94386a54c68456a26b7f877
---

# Phase 205 Plan 01: the USD view inherits the native record verdict Summary

The USD view's `figureRecord.unreadable` is now the native build's verdict threaded in as `inheritedUnreadable` and OR'd into the USD `totalRecord`, closing 194.2-REVIEW-R3 WR-01 (a bad date on an absent day no longer withholds the USD view alone); the Sentry report follows each build's own verdict, so an inherited verdict is reported once.

## Commits

| Task | Commit | Subject |
|------|--------|---------|
| 1 (tracer) | 305e0db31 | fix(205): the USD view inherits the native record verdict (D-01) |
| 2 | 05c77797a | test(205): one unreadable-record report per record (D-01) |

## What changed

- `build-payload.ts`: `recordSourceDates` opt removed, `inheritedUnreadable?: boolean` added; the fifth `firstUnreadableDate` axis and the `record_source` tuple entry removed; `totalRecord` is `{...endsRecord, unreadable: true}` when `firstBad || opts?.inheritedUnreadable`; report condition is `(firstBad || endsRecord.unreadable) && opts?.reportUnreadable`.
- `fetch-and-build-payload.ts`: `buildUsdView` takes `nativeUnreadable`, passed from `nativePayload.figureRecord?.unreadable === true`, spread into `usdOpts` as `inheritedUnreadable: true`. `nativeSeries` kept (still feeds the converter and `buildUsdViewFacts`). The USD build's own date scan is left in place.
- `figure-parity-pages.test.tsx`: new describe `205 D-01 parity ...` with a 2024 curve builder, a BTC-closes builder and a BTC-native analytics builder; an `it.each` for `2024-07-3` / `2024-07-31x` (element 200 `{date: bad, value: null}`), and a report-count case (interior `2026-06-31`, exactly one `figure-record-unreadable` call, axis `cash`, date `2026-06-31`).

## RED at HEAD (before any source edit)

`npx vitest run src/__tests__/figure-parity-pages.test.tsx -t "205 D-01"`: 2 failed, 57 skipped. Both cases failed at the USD assertion only (`payload.usdView?.payload.figureRecord?.unreadable`: `AssertionError: expected true to be falsy`, `figure-parity-pages.test.tsx:1250`); the native assertions before it passed, matching the RESEARCH probe (native false, USD true).

## Neuter evidence (D-04)

Byte backups in the scratchpad `205-01/` directory; restored by `cp`, verified by `cmp` (exit 0); never git checkout, restore or stash. After each restore the gate re-ran green.

gc-205-01-neuter: mutation=inherit_dropped result=red restored=identical
- Removed `|| opts?.inheritedUnreadable` from `totalRecord`. RED line: `× 194.2 R2 WR-01: a malformed date at an interior curve point is unreadable on the native AND the USD view ...` and the same for the last curve point (`Tests 2 failed | 57 passed (59)`). cmp=0.

gc-205-01-neuter: mutation=second_scan_restored result=red restored=identical
- Re-added a fifth `firstUnreadableDate` axis fed by a temporary opt, fed from `nativeSeries.map((p) => p.date)` in `buildUsdView` (both files backed up and restored). RED line: `× an interior absent-day curve point dated 2024-07-3 reads readable on the native AND the USD view` and the `2024-07-31x` twin (`Tests 2 failed | 57 passed (59)`). cmp=0 for both files; 59/59 green after.

gc-205-01-neuter: mutation=report_combined result=red restored=identical
- Report condition set back to `totalRecord.unreadable && opts?.reportUnreadable`. RED line: `AssertionError: expected [ [ …(2) ], [ …(2) ] ] to have a length of 1 but got 2` (`× an interior bad date is reported to Sentry exactly once ...`; `Tests 1 failed | 71 passed (72)`). cmp=0.

gc-205-01-neuter: mutation=report_first_bad_only result=red restored=identical
- Report condition set to `firstBad && opts?.reportUnreadable`. RED line: `× a malformed headline start (chain-broken suffix) is unreadable and reported too` in `figure-record-unreadable.test.ts` (`Tests 1 failed | 71 passed (72)`). cmp=0; 72/72 green after.

## Verification (exact commands, counts)

- `npx vitest run src/__tests__/figure-parity-pages.test.tsx src/lib/factsheet/figure-record-unreadable.test.ts src/lib/factsheet/build-payload.test.ts src/lib/factsheet/fetch-and-build-payload.test.ts` (after Task 1): 4 files, 224 passed, 0 failed.
- `npx vitest run src/__tests__/figure-parity-pages.test.tsx src/lib/factsheet/figure-record-unreadable.test.ts` (after Task 2): 2 files, 72 passed, 0 failed.
- `npx tsc --noEmit`: clean (no output).
- Readable-record payload snapshot unmoved: no `-u` run; `git diff --stat -- src/lib/factsheet/__snapshots__` empty.
- Plan scope, `npx vitest run src/lib/factsheet "src/app/factsheet" "src/app/(dashboard)/allocations" src/__tests__/figure-parity-pages.test.tsx`: `Test Files 1 failed | 380 passed (381)`, `Tests 2 failed | 6657 passed (6659)`.

gc-205-01-scope: failed=2 files=compute.conventions.test.ts-only

The two failures are `compute.conventions.test.ts` fixture B (zero-return days) and fixture C (interior calendar gaps), the known pre-existing failures at base commit 240999b5f; not touched, not new.

## Deviations from Plan

None - plan executed as written. Notes: the worktree HEAD at start was `240999b5f` (the plan text cites `8ef04b130`); the Step 0 anchor check passed (12 claims, no stale). A doc comment in `build-payload.ts` refers to the removed axis as "source-dates axis" rather than by the old opt name, so `grep recordSourceDates src` returns nothing.

## Known residual (unchanged, per plan)

None remaining (205 WR-01). The USD build sends no `figure-record-unreadable` event whenever it inherits an unreadable native verdict (`!opts?.inheritedUnreadable` on the report condition), including for a malformed first curve point (`recordSeriesStart`), which is the native record's first date copied verbatim. The `headlineSince` arm this note named cannot occur in production: the USD build is never handed `headlineCoversFrom`. Both arms of the once-only gate are pinned in `src/__tests__/figure-parity-pages.test.tsx`.

## Known Stubs

None.

## Threat Flags

None (no new network, auth, file or schema surface). T-205-01 and T-205-02 mitigated and gated as above.

## Self-Check: PASSED

- FOUND: src/lib/factsheet/build-payload.ts, src/lib/factsheet/fetch-and-build-payload.ts, src/__tests__/figure-parity-pages.test.tsx
- FOUND commits 305e0db31 and 05c77797a (ancestors of HEAD)
- STATE.md, ROADMAP.md and state.json not modified.
