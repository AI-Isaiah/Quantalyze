---
phase: 169-pagetruth
plan: 07
subsystem: factsheet
status: complete
tags: [factsheet, unstable_cache, composite, read-error, cache-key, SC4, SC9, R3]

requires:
  - phase: 167.2.1
    provides: "FactsheetReadError thrown from the cached callback on read_error, the resolve stage's read_error arm and the store-backed next/cache test double"
  - phase: 169-01
    provides: "the widened resolve-stage select and the persisted single-key headline (named in the v8 lineage line)"
  - phase: 169-04
    provides: "nullable return windows and optional p3y / p5y (named in the v8 lineage line)"
provides:
  - "CompositeSeriesReadError (exported, readonly code) thrown by readCompositeFactsheet on a failed csv_daily_returns read"
  - "the resolve stage maps CompositeSeriesReadError to read_error with its code (build captures once, tagged read: csv_daily_returns; probe captures nothing)"
  - "the discovery detail page catches the same class only and keeps its placeholder for that request"
  - "the factsheet cache shape key at the v8 suffix (169 D-62), with its dated lineage line and both pins moved"
affects: [169-05, 169-06, 169.1-01, 169.1-03, 169.1-04, 169.5-01]

actuals:
  tokens: 11375
  tasks: 3
  commits: 3
plan_head_before: 696dc524b1d141547cf2a42b6216b7aca70feeb5
plan_head_after: 5657c6eb65113ebc9beff5ecf4a14804bcd4076d

tech-stack:
  added: []
  patterns:
    - "An outage is thrown, a fact is returned: the reader throws a named class, only the resolve stage (and the one uncached page) catches it, and unstable_cache stores nothing on a throw"

key-files:
  created:
    - src/app/factsheet/[id]/v2/page.composite-read-error.test.tsx
  modified:
    - src/lib/factsheet/composite-read-path.ts
    - src/lib/factsheet/composite-read-path.test.ts
    - src/lib/factsheet/fetch-and-build-payload.ts
    - src/lib/factsheet/fetch-and-build-payload.test.ts
    - src/app/(dashboard)/discovery/[slug]/[strategyId]/page.tsx
    - src/app/(dashboard)/discovery/[slug]/[strategyId]/page.pending-fallback.test.tsx
    - src/app/factsheet/[id]/v2/page.tsx
    - src/app/factsheet/[id]/v2/page.public-cache-key.test.tsx
    - src/app/factsheet-share/[token]/page.cache-isolation.test.tsx

key-decisions:
  - "CompositeSeriesReadError carries the PostgREST message as `cause`, and the resolve stage logs it as errorMessage beside errorCode, so the outage log line keeps the diagnostic the reader's removed console.error used to print"
  - "The page test adds a CONTROL beside the plan's two-request case: a successful EMPTY csv read is still cached as the run's placeholder, so the fix cannot pass by stopping all caching"
  - "The discovery test adds a propagate case (a non-CompositeSeriesReadError throw from the read still rejects the page), pinned by its own neuter"

patterns-established:
  - "A red-first page seam on the real-store unstable_cache double: request 1 fails, assert nothing stored; request 2 on the same computed_at recovers and builds"

requirements-completed: [R3, SC4, SC9]

coverage:
  - id: D1
    description: "A failed csv_daily_returns read of a composite rejects with CompositeSeriesReadError carrying its code ('none' when absent); a successful empty read still resolves as before (empty series with a headline, null without)"
    requirement: "R3"
    verification:
      - kind: unit
        ref: "src/lib/factsheet/composite-read-path.test.ts#169 D-41 readCompositeFactsheet — a failed csv_daily_returns read is not an empty composite"
        status: pass
    human_judgment: false
  - id: D2
    description: "The shared resolve stage answers the composite read outage read_error with its code; a build captures once with the read: csv_daily_returns tag, a probe returns the code and captures nothing; the parity table covers it"
    requirement: "R3"
    verification:
      - kind: unit
        ref: "src/lib/factsheet/fetch-and-build-payload.test.ts#PARITY composite, valid headline, csv read error: read_error"
        status: pass
      - kind: unit
        ref: "src/lib/factsheet/fetch-and-build-payload.test.ts#SFH H-1 COMPOSITE CAPTURE"
        status: pass
    human_judgment: false
  - id: D3
    description: "The public factsheet renders the placeholder for a composite read outage, stores nothing for the run, and the next request on the same computed_at builds"
    requirement: "SC4"
    verification:
      - kind: integration
        ref: "src/app/factsheet/[id]/v2/page.composite-read-error.test.tsx#COMPOSITE-READ-ERROR-NOT-CACHED"
        status: pass
    human_judgment: false
  - id: D4
    description: "The discovery detail page keeps its KCS-10 placeholder on the outage and logs the code; any other throw propagates"
    requirement: "R3"
    verification:
      - kind: integration
        ref: "src/app/(dashboard)/discovery/[slug]/[strategyId]/page.pending-fallback.test.tsx#discovery page — a composite's csv_daily_returns read outage (169 D-41)"
        status: pass
    human_judgment: false
  - id: D5
    description: "The factsheet cache shape key is at the v8 suffix with its dated lineage line, both hand-typed pins moved in the same commit"
    requirement: "SC9"
    verification:
      - kind: unit
        ref: "src/app/factsheet/[id]/v2/page.public-cache-key.test.tsx#KEY SHAPE"
        status: pass
      - kind: unit
        ref: "src/app/factsheet-share/[token]/page.cache-isolation.test.tsx#3. the token lane does not shift the PUBLIC lane's key shape"
        status: pass
    human_judgment: false
  - id: D6
    description: "Post-deploy: the deployed factsheet carries the v8 key and the deployed logs show the new resolve-stage line on a composite read outage"
    requirement: "SC9"
    verification: []
    human_judgment: true
    rationale: "Needs the deployed commit and its runtime logs; plan 169-06's browser re-check owns it"

duration: 20min
completed: 2026-09-29
---

# Phase 169 Plan 07: COMPOSITEREADERR Summary

**A composite's failed `csv_daily_returns` read now throws `CompositeSeriesReadError`, which the shared resolve stage answers `read_error` with its code, so 167.2.1's cached-callback throw keeps the outage out of the public factsheet cache for the analytics run. The discovery page keeps its placeholder for that one request, and the factsheet cache key moves v7 -> v8 once for Phase 169 (D-62).**

## Performance

- **Duration:** about 20 min
- **Started:** 2026-09-29T16:53:43Z
- **Completed:** 2026-09-29T17:13Z
- **Tasks:** 3 (Task 1 tracer, Tasks 2 and 3 auto with tdd)
- **Files modified:** 10 (1 created, 9 modified)

## Facts re-resolved at HEAD `696dc524b` before Task 1

- `readCompositeFactsheet` logged "composite csv_daily_returns read failed" and then mapped `sparseRows ?? []`: **CONFIRMED**.
- `resolveFactsheetInputs`' strategies-read arm returns `notBuildable("read_error", { code })` with a build-only capture tagged `{ stage: "factsheet-resolve", caller, reason: "read_error", code, strategy_id }`; an empty composite series reaches `compositeUnbuildable(id, caller, "empty_series")`: **CONFIRMED**.
- `buildFactsheetPayloadCached`'s callback throws `FactsheetReadError` on `read_error`; the page catches that class only and renders the public placeholder with `publicReadFailed`: **CONFIRMED**.
- `unbuildableNoteKindOf` returns `null` for `read_error` and `cannot_build` for `composite_unbuildable`; `COUNTED_PROBE_REASONS` counts `read_error`: **CONFIRMED** (neither file edited).
- The v7 key literal lived in exactly four files (the page's keyParts, the CACHE KEY REALITY docblock and the two pins): **CONFIRMED**.
- Next's `unstable_cache` (bundled `next/dist/server/web/spec-extension/unstable-cache.js`) awaits the callback before `cacheNewResult`, so a throw stores nothing: **CONFIRMED**, after reading `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/unstable_cache.md` as AGENTS.md asks.

Task 1 precondition: `grep FactsheetReadError page.tsx && grep '"read_error"' fetch-and-build-payload.ts && test -f fetch-and-build-payload.test.ts && test -f 169-01-SUMMARY.md && vitest (public-cache-key + fetch-and-build-payload)` exited 0 (`Test Files 2 passed (2)`, `Tests 40 passed (40)`).
Task 3 precondition: `grep p5y compute.ts && test -f 169-04-SUMMARY.md && test -f 169-01-SUMMARY.md` exited 0.

## Accomplishments

- `CompositeSeriesReadError` (exported, `readonly code`, `name = "CompositeSeriesReadError"`, message `composite series read failed: csv_daily_returns (<code>)`, naming the table and never the strategy) is thrown by `readCompositeFactsheet` when the csv read fails, with `sparseErr.code || "none"`. The reader's own `console.error` for this read is gone because the catcher logs it. The success return and the `null` (missing or untrusted headline) are unchanged. The docblock's first responsibility bullet, `@returns` and a new `@throws` say so.
- `resolveFactsheetInputs` wraps the reader in a try/catch that catches `CompositeSeriesReadError` only and rethrows anything else. It logs `[factsheet] resolve(<caller>) — composite csv_daily_returns read failed` with `{ id, caller, errorMessage, errorCode }`. For a build only, it captures `factsheet resolve: composite csv_daily_returns read failed (<code>)` with tags `{ stage: "factsheet-resolve", caller, reason: "read_error", code, strategy_id, read: "csv_daily_returns" }`. It returns `notBuildable("read_error", { code })`. The v2 page's code is untouched: its existing `read_error` throw covers the composite now.
- The discovery detail page catches `CompositeSeriesReadError` only around the reader, logs it with its code (and the id, no name), and takes the existing empty-series placeholder branch. Any other throw propagates. The comment names 169.1-01 as the plan that removes this assembly.
- Three stale comments no longer describe the fold: the `NotBuildableReason` docblock, the `compositeUnbuildable` docblock and the v2 page's accepted-residual paragraph. The last is now a dated three-line note that 169-07 closed it.
- The cache shape key moved to the v8 suffix. There is one lineage paragraph under 166.2's (`Bumped v7→v8 (Phase 169 FACTSHEETTRUTH, 169 D-62, 2026-09-27): …`). It names 169-04's nullable windows and `p3y` / `p5y`, and 169-01's persisted headline. It also says that a v7 entry would hide correct 3 Year / 5 Year rows behind 169-05's row gates, and that `revalidate` and the tag bust are stale-while-revalidate. The paragraph quotes no full key literal. KEY SHAPE, `EXPECTED_KEY_PREFIX` and the CACHE KEY REALITY docblock moved in the same commit.

## Task Commits

1. **Task 1 (tracer): the outage travels reader -> resolve stage -> cached callback as read_error.** Commit `9101dc119` (fix). Tests and implementation are in one commit, and the RED is recorded below (169-01 precedent for a tracer). Tracer gate: the Task 1 `<verify>` is automated-only and `auto_advance` is true, so it was re-run after the commit (`Tests 94 passed (94)`) and the plan continued with no checkpoint.
2. **Task 2: the parity table, the capture pins and the discovery page name the outage; the stale comments are corrected.** Commit `77fe768a5` (fix).
3. **Task 3: the cache shape key moves v7 -> v8 with both pins.** Commit `5657c6eb65113ebc9beff5ecf4a14804bcd4076d` (fix). `git show --stat` lists exactly the four files.

## RED-first and neuter evidence (SC9)

Protocol for every neuter: `cp` byte backup, hand-revert only the fix line(s), run, restore from the backup, `cmp` OK, re-run GREEN. No `git checkout --`, `git restore` or `git stash` was used.

**Task 1 RED (tests written first, run on HEAD code): 3 failed, 86 passed (89).** Every failure is on its target assertion:
- `169 D-41 readCompositeFactsheet … > a failed read rejects with CompositeSeriesReadError carrying its code, …`: `the read resolved: the outage was folded into an empty series: expected null not to be null`
- `… > a failed read whose error has no code carries the code "none"`: same message
- `COMPOSITE-READ-ERROR-NOT-CACHED`: `the outage was stored as the run's answer: expected 1 to be +0`. To show that request 2's assertion also fails on HEAD code, the store-size and capture assertions were removed temporarily from a byte copy. The test then failed with `the composite read outage was cached for the run: expected null not to be null`, and the file was restored (`cmp` OK).
- The two reader CONTROLs (a successful empty read with and without a headline) and the page CONTROL (an empty composite is still cached) were green on HEAD code, as intended.

**Task 1 neuter A (restore the fold in the reader: log and continue instead of throw):** `Tests 3 failed | 86 passed (89)`. The same three tests failed with the same messages. Restored, `cmp` OK, `89 passed`.

**Task 1 neuter B (delete the resolve stage's `instanceof CompositeSeriesReadError` catch):** `COMPOSITE-READ-ERROR-NOT-CACHED` failed with `CompositeSeriesReadError: composite series read failed: csv_daily_returns (57014)`. The throw escaped the callback as a non-`FactsheetReadError` and the page rethrew it. Restored, `cmp` OK, `2 passed`.

**Task 2, resolve-stage catch neutered again (Task 1 neuter B repeated against the new parity pins):** `Tests 4 failed | 32 passed (36)`. The failures were `PARITY composite, valid headline, csv read error: read_error`, `WR-03 WITH-REASON …`, `SFH H-1 COMPOSITE CAPTURE …` (the rewritten outage arm) and `NO-NULL-AFTER-RESOLVE …`. Restored, `cmp` OK, `36 passed`.

**Task 2 discovery RED (after Task 1, before the catch):** `renders the KCS-10 sentence and does not throw; the outage is logged with its code` failed with `CompositeSeriesReadError: composite series read failed: csv_daily_returns (57014)`. On pre-Task-1 code it also fails, on the `errorCode: "57014"` log assertion, because the old reader logged no code.
- Neuter (delete the discovery catch): the same test goes RED (`1 failed | 2 passed`). Restored, `cmp` OK, `3 passed`.
- Neuter (drop the `instanceof` rethrow guard so the catch swallows everything): `any other throw from the composite read still propagates` goes RED (`1 failed | 2 passed`). Restored, `cmp` OK.

**Task 3 RED (pins moved first, page still at v7):** `Tests 2 failed | 7 passed (9)`, failing `KEY SHAPE: …` (`expected [ [ 'factsheet-v2-payload-v7', …(2) ] ] to deeply equal [ [ 'factsheet-v2-payload-v8', …(2) ] ]`) and `3. the token lane does not shift the PUBLIC lane's key shape …` (same shape).
- Neuter (page version member set back to the v7 suffix): the same two tests failed (`2 failed | 7 passed`). Restored, `cmp` OK, `9 passed`.

## Gates (run by the executor on the Task 3 tree, before its commit)

- `npx tsc --noEmit -p .`: no output, `tsc exit=0`.
- `npm run lint`: `lint exit=0` (eslint clean; `[check-admin-route-manifest] OK — 20 admin routes`; `[check-route-contract] OK — 58 page routes`; `[check-planning-hygiene] OK — 7811 tracked files scanned`).
- `npx vitest run src/lib/factsheet src/app/factsheet src/app/factsheet-share "src/app/(dashboard)/discovery" "src/app/(dashboard)/strategies/page" src/lib/status-surface-copy.test.ts src/__tests__/phase-148-owner-lane-cache-isolation.test.ts`: `Test Files 83 passed (83)`, `Tests 1213 passed (1213)`, exit 0.
- Task 1 verify: `Test Files 3 passed (3)`, `Tests 94 passed (94)`.
- Task 2 verify 1 (same suite set as above minus factsheet-share, which `src/app/factsheet` already matches as a prefix): `Test Files 83 passed (83)`, `Tests 1213 passed (1213)`. Verify 2 (tsc): exit 0. Verify 3: `stale-fold-fab=0 stale-fold-page=0 residual=0 key-lines-touched=0`.
- Task 3 verify 1: `Test Files 11 passed (11)`, `Tests 184 passed (184)`. Verify 2: `files-still-v7=[] page-v8=1`.

## Acceptance criteria

- Task 1: `export class CompositeSeriesReadError` count 1; `instanceof CompositeSeriesReadError` in fetch-and-build-payload.ts count 1. `git diff --name-only 9101dc119^..9101dc119` over `page.public-cache-key.test.tsx` and `types.ts` is empty (the working-tree check was also run before staging, and was empty).
- Task 2: `csv read error` in fetch-and-build-payload.test.ts count 2 (≥1). `CompositeSeriesReadError` in the discovery page count 3 (≥1). `status-surface-copy.ts`, `strategies/page.tsx` and `types.ts` are untouched. Commit `77fe768a5` touches no `factsheet-v2-payload-v` line (count 0).
- Task 3: `git grep -l 'factsheet-v2-payload-v8' -- src` (rc 0) lists exactly `src/app/factsheet-share/[token]/page.cache-isolation.test.tsx`, `src/app/factsheet/[id]/v2/page.public-cache-key.test.tsx`, `src/app/factsheet/[id]/v2/page.tsx` and `src/lib/factsheet/fetch-and-build-payload.ts`. `Bumped v7` count 1, `Bumped v8` count 0, `Bumped v7 … Phase 169 FACTSHEETTRUTH` count 1. `git diff -U0 T3^..T3 page.tsx | grep -c '^-.*Bumped v6'` prints 0. `git show --stat` lists the four files. T3 = `5657c6eb65113ebc9beff5ecf4a14804bcd4076d`.

## Decisions Made

- **The PostgREST message is kept as `cause`.** The plan's log payload was `{ id, caller, errorCode }`. The removed reader log printed `errorMessage`, and the strategies-read arm prints it too. So the new resolve-stage line adds `errorMessage` read from `cause`, and the outage log keeps its diagnostic. The Sentry message and the error's own message still carry only the table and the code.
- **Two added controls.** The page test also pins that a successful EMPTY composite read is still cached as the run's placeholder. The discovery test pins that a non-outage throw still propagates. Each bites under its own neuter (above).

## Deviations from Plan

### Auto-fixed Issues

None. Every anchor the plan names held at `696dc524b`.

### Scope and process notes

- **Between the Task 1 and Task 2 commits, one existing test was red by design.** The old `SFH H-1 COMPOSITE CAPTURE` outage arm (PATTERNS B2) pinned the `empty_series` fold. It failed after Task 1 with `expected { tags: { …(6) } } to match object { tags: { caller: 'build', …(1) } }`, and Task 2 rewrote it as the plan orders. For the same window, the discovery page would have thrown on a composite read outage until Task 2's catch. Both are closed at `77fe768a5`. The branch is merged as a whole.
- **Every PARITY loop passes the new fixture field.** `seed` gained a fourth `csvError` parameter that also resets `fake.csvError`, and all seven `seed(f.row, f.csv ?? [], f.error ?? null)` calls pass `f.csvError ?? null`. Without that, the new row would have run with no error in the WITH-REASON and NO-NULL loops.
- **One commit per task.** Task 1 is a tracer, and Task 3's gate requires one four-file commit. Task 2 was also committed whole, with its RED recorded above. `workflow.tdd_mode` is false, and no `check tdd-red-evidence` record was produced for this plan.
- **Worktree commit guard.** The branch `feat/169-w2-07` is an orchestrator-named worktree branch, outside the per-agent `agent-*` namespace. The orchestrator's root pin and the protected-branch check ran before every commit. The namespace assertion was skipped, as in 169-01.
- **`node_modules` symlink.** It points at the sibling checkout the orchestrator linked, not the main checkout's, and `require.resolve('vitest')` resolved through it. It was removed (without a trailing slash) before each commit and re-linked after.

**Total deviations:** 0 auto-fixed. **Impact:** none on scope. Two controls and one log field were added, recorded as decisions.

## Issues Encountered

- `npm run lint` and `tsc` together outran the 120 s foreground limit once. They were re-run in the background and both exited 0.

## Known limits, not fixed here

- The discovery page's composite catch is interim. Phase 169.1 plan 169.1-01 removes the assembly in favour of `fetchAndBuildPayload`, whose resolve stage already answers the throw.
- A probe past its deadline still cannot abort the csv read. If that read later fails, the resolve stage now returns `read_error` into a race that has already answered, and nothing is logged beyond the resolve line. This is unchanged behaviour.
- Post-deploy (D6 above): plan 169-06 confirms the deployed page carries the v8 key and reads the new resolve-stage log line.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- 169-06 (wave 3) can re-check on the v8 key: no pre-deploy entry is served after the deploy.
- 169.5-01 finds the v8 literal in exactly the four files its Task 3 moves to v9. It also finds a lineage line that contains `Bumped v7` and neither `Bumped v8` nor the full v8 literal.

---
*Phase: 169-pagetruth*
*Completed: 2026-09-29*

## Self-Check: PASSED
