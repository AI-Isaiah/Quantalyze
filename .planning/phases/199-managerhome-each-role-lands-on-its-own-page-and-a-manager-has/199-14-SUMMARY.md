---
phase: 199-managerhome-each-role-lands-on-its-own-page-and-a-manager-has
plan: 14
subsystem: ui
tags: [legend, strategies-list, health, status-chips, contract-test, react]
requires:
  - phase: 199-managerhome
    provides: plan 12's Health column (strategyHealthOf, healthWord, HEALTH_TONE) and plan 10's merged page
provides:
  - StrategiesLegend, a static square panel under the merged list explaining every Health word and chip
  - STRATEGY_STATUSES runtime tuple (checked both ways against Strategy status)
  - exported OwnershipTag LABELS, PIPELINE_CHIPS, VerifiedCheck, AllocatorSyncStatus pillOnly mode
  - a per-role label-coverage contract test
affects: [199-16 (strategies-list degrade-warning scan widens over the legend's warning-tone words), 199-17, 199-18 (reflow and axe sweeps anchor on the legend heading)]
actuals:
  tokens: 13600
  tasks: 2
  commits: 3
plan_head_before: 5a230e6f43d2f98354a84fd60e8a641e314fef76
plan_head_after: 16626aff0df25b1b4c1da2162a076e94361c7e7c
tech-stack:
  added: []
  patterns:
    - "legend rows are Records over the source closed sets, so a new member fails tsc until it has a sentence"
    - "chip constants live in a non-client module so a server component can read them"
key-files:
  created:
    - src/components/strategy/VerifiedCheck.tsx
  modified:
    - src/app/(dashboard)/strategies/StrategiesLegend.tsx
    - src/app/(dashboard)/strategies/StrategiesLegend.test.tsx
    - src/app/(dashboard)/strategies/page.tsx
    - src/app/(dashboard)/strategies/page.merged.test.tsx
    - src/app/(dashboard)/strategies/page.key-pill.test.tsx
    - src/components/strategy/OwnershipTag.tsx
    - src/components/strategy/StaleSeriesChip.tsx
    - src/components/strategy/StrategyTable.tsx
    - src/components/exchanges/AllocatorSyncStatus.tsx
    - src/lib/closed-sets.ts
key-decisions:
  - "Pipeline chip constants and the verified glyph moved to server-readable modules, not exported from StrategyTable (a use-client module)"
  - "Draft and Archived legend sentences corrected against the code; behaviour untouched"
requirements-completed: [ROUTE-11]
status: complete
---

# Phase 199 Plan 14: The strategies legend Summary

A static legend under the merged strategies list explains every Health word, strategy status, ownership tag, pipeline chip and key pill with the real components, thresholds interpolated from `SERIES_STALE_DAYS` / `SERIES_STALE_DAYS_TRADITIONAL`, and a contract test that fails on any rendered label with no entry.

## What was built

- **Task 1 (tracer).** `StrategiesLegend` (server-renderable, no client directive): `section#strategies-legend` labelled by `h2#strategies-legend-heading` ("Legend"), square `border border-border bg-surface px-4 py-4 mt-6`, a `@container` div that is an ANCESTOR of the grid (1 / 2 / 4 columns at the container's own `@lg` / `@4xl`). The HEALTH group renders the six UI-SPEC entries; terms come from `healthWord`, tones from `HEALTH_TONE`. Healthy reads "at most 7 days old for a crypto strategy, or 10 days for any other", Stale reads "older than ...", both interpolated from the two constants. Mounted in `page.tsx` after the table branch only (`!strategiesUnreadable && hasRows`), outside the table's `space-y-3` stack.
- **Task 2.** STATUS (`STRATEGY_STATUSES` over `Badge`), TAGS (`OwnershipTag` `LABELS`, the verified check, compact `ReturnsUnitChip`), PIPELINE (`PIPELINE_CHIPS` with `DATA_STATE_CHIP`), KEY PILLS (`UNTRUSTED_KEY_SYNC_STATUSES` through `AllocatorSyncStatus pillOnly`). Each definition table is a `Record` over its source set with `satisfies`. `STRATEGY_STATUSES` has a `satisfies` check one way and a `STRATEGY_STATUSES_COMPLETE` type the other way.
- **Contract test** (in `page.merged.test.tsx`, over the page's real Supabase double): for allocator, manager and both, a row per Health word, status, mark, chip and key pill; every label the table prints (Health cell, Status cell, chip-family spans outside links and buttons, the verified title) must be a legend `dt`. A non-vacuity block asserts the fixture really printed each word and chip.

## Verification

All commands run from the worktree.

- `node scripts/verify-plan-anchors.mjs <plan>`: OK, 10 claims, no stale claims.
- `npx vitest run "src/app/(dashboard)/strategies" src/components/strategy src/components/exchanges src/__tests__/display-sign-single-source.test.ts src/__tests__/phase-150-capital-ownership-invariant.test.ts`: 119 files, 2443 tests, all passed.
- Wider sweep `npx vitest run src/__tests__ src/components src/lib/closed-sets* src/lib/strategy-health.test.ts src/lib/complete-status-scan.test.ts "src/app/(dashboard)/allocations/components"`: 406 files passed, 2 failed. One was mine (phase-150 P1, fixed, see Deviations). The other, `src/__tests__/self-referential-oracle.test.ts` (finding at `phase-149-my-strategies-parity.test.ts:689-690`, a file this plan did not touch), is pre-existing and not caused by this plan. Not fixed (scope boundary); see Deferred Issues.
- `npx tsc --noEmit -p .`: clean.
- `npx eslint --no-cache <every touched file>`: clean. `check-admin-route-manifest`, `check-route-contract`, `check-planning-hygiene`, `check-canonical-domain`: all OK. The full-tree `npm run lint` eslint step was NOT run (its `--cache` writes into the shared node_modules symlink); eslint was scoped to the touched files.
- Acceptance greps: `strategies-legend-heading` 2 hits; `SERIES_STALE_DAYS_TRADITIONAL` 3 hits; typed `7|10 days` outside comments 0; `STRATEGY_STATUSES` in closed-sets 3 hits.
- Left to CI: no SQL, migration or analytics-service file was touched, so no SQL gate, local-stack lane or mypy check applied. `e2e/reflow-sweep-authed.spec.ts` and the axe sweep are plan 17/18 and were not run here.

gc-199-14-neuter: typed `10 days` in a byte copy of StrategiesLegend.tsx stayed GREEN while the constant was still 10 (the number matches by value, which is why the acceptance grep exists too); then `SERIES_STALE_DAYS_TRADITIONAL` set to 12 in a byte copy of freshness.ts turned StrategiesLegend.test.tsx RED, 3 failures: the interpolation case ("expected ... to contain 'at most 7 days old for a crypto strat...'"), the ladder pin ("expected 12 to be 10") and the operator case ("traditional: 11 days old reads stale: expected 'current' to be 'stale'"). Both files restored from byte backups, `cmp` identical, 12/12 green after.

gc-199-14-neuter: dropping the Archived entry (`STRATEGY_STATUSES.filter((s) => s !== "archived")`) in a byte copy of StrategiesLegend.tsx turned 5 tests RED: the contract for allocator, manager and both ("rendered labels with no legend entry: expected [ 'Archived' ] to deeply equal []") plus two legend unit cases. Restored from a byte backup, `cmp` identical, 62/62 green after.

gc-199-14-gates: vitest=green tsc=clean lint=clean (eslint scoped to touched files, the four repo check scripts OK)

## Definition checks against code (T-199-20)

Each sentence was checked against the code that produces the state. Two UI-SPEC sentences were corrected (a sentence, never behaviour):

- **Draft**: UI-SPEC "Not submitted yet. Visible only to you." Every unpublished row can mint a private link (`shareAffordanceMode` returns `mint-token` for anything not `published`), so a draft is not visible only to the owner. Now: "Not submitted yet. Visible only to you, and to anyone you send a private link."
- **Archived**: UI-SPEC "Withdrawn. Shown only on this page." The list read keeps archived rows and Discovery is published-only, but a private link still opens an unpublished row, so "only on this page" overclaims. Now: "Withdrawn from Discovery. It stays listed on this page."

Confirmed as written: Published, Pending review, Private, the six Health definitions (not_judged reasons match `strategyHealthOf` rows exactly: archived, no strategy yet, unknown verdict, unreadable key status), Own capital / Team review (`capital-ownership.ts`), the verified glyph (`trust_tier === "api_verified" || api_key_id`), BTC, Syncing (title "First metrics arrive in ~10-15 min"), No data, No strategy yet ("Finish setup" exists on the placeholder row), Key revoked and Sign-in failed (match the pill helper copy).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Chip constants cannot be exported from StrategyTable**
- **Found during:** Task 2 planning.
- **Issue:** the plan says to export the chip constants from `StrategyTable.tsx`, but that file is `"use client"`, and a server component (the legend, which the plan requires to be server-renderable) cannot read non-component exports of a client module.
- **Fix:** `PIPELINE_CHIPS` (label and tone per chip, class strings moved unchanged) lives in `StaleSeriesChip.tsx`, the non-client home of `DATA_STATE_CHIP` (the plan's own REVIEWS deferral already says the executor exports from that new home). The table renders the same classes and text from it. New file `VerifiedCheck.tsx` holds the verified glyph for the same reason, so the legend renders the real glyph instead of a re-typed SVG path. Neither file is in the plan's `files_modified`. DOM is unchanged; the StrategyTable goldens under `__fixtures__` did NOT need to change (no hand edits).
- **Files modified:** `src/components/strategy/StaleSeriesChip.tsx`, `src/components/strategy/StrategyTable.tsx`, `src/components/strategy/VerifiedCheck.tsx`
- **Commit:** 16626aff0

**2. [Rule 1 - Bug] Legend broke tests that count a label on the whole page**
- **Found during:** Task 2 verification.
- **Issue:** the legend repeats every chip label, so `page.merged.test.tsx` furniture cases that counted "Own capital" / "Draft" with `screen` went from 2 to 3, and `page.key-pill.test.tsx`'s `AllocatorSyncStatus` probe recorded the legend's two pill mounts as row pills (4 failures).
- **Fix:** the furniture cases ask `tableEl()` (the table), and the probe treats `pillOnly` as the legend's mount (no record, a `legend-pill` test id), mirroring the real component's distinct `allocator-sync-pill-static` id. `page.key-pill.test.tsx` is not in the plan's `files_modified`.
- **Commit:** 16626aff0

**3. [Rule 1 - Bug] Phase-150 invariant P1 (mark literal spelled in exactly one production file)**
- **Found during:** wider vitest sweep.
- **Issue:** the legend's `OWNERSHIP_DEFINITIONS` keyed by the spelled literals `own_capital` / `team_review`.
- **Fix:** keyed by `OWN_CAPITAL` / `TEAM_REVIEW` computed keys.
- **Commit:** 16626aff0

**4. [Test placement] Contract test lives in `page.merged.test.tsx`, not `StrategiesLegend.test.tsx`**
- The contract must render the real page so Health words come from the server computation, and the Supabase double is local to `page.merged.test.tsx`. The double gained a `keys` field (default `[]`, so no other case changes). Legend-only unit cases are in `StrategiesLegend.test.tsx`.

**5. [Process] Task 2 was not strictly red-first.** Task 1 followed RED then GREEN (commit `20f89eae3`, then `3cc146f8e`). For Task 2 the implementation and tests were written together and committed once; fail-ability is shown by the neuter above, which turned the contract RED on the exact missing label.

**6. [Design note] `AllocatorSyncStatus pillOnly`** returns the bare pill with test id `allocator-sync-pill-static` (not `allocator-sync-pill`), so a page that mounts both the rows' pills and the legend's can still tell them apart, and no helper line means no `role="status"`.

## Deferred Issues

- `src/__tests__/self-referential-oracle.test.ts` fails on `src/__tests__/phase-149-my-strategies-parity.test.ts:690` (`expect(syntheticRaw)`, same-block const declared at :689). That file is untouched by this plan; the failure is pre-existing and out of scope. Not added to the allowlist.
- `src/lib/factsheet/compute.conventions.test.ts` 2 frozen-snapshot cases (named in the brief as failing on main) were not run or touched.
- `PLACEHOLDER_KEYS_UNREADABLE` (exported by 199-10) is not referenced by this plan's text; no degrade-warning registration was needed here. The legend's warning-tone words are ledgered by 199-16.
- The legend has five groups in a four-column `@4xl` grid per the UI-SPEC, so the fifth (Key pills) wraps to a second row at that width. Taken as specified; visual check is plan 17/18's reflow sweep.

## Known Stubs

None.

## Threat Flags

None. Static copy, no new network, auth or schema surface (T-199-20 mitigated by the definition checks and the pinned thresholds above).

## Self-Check: PASSED

- FOUND: src/app/(dashboard)/strategies/StrategiesLegend.tsx, StrategiesLegend.test.tsx, src/components/strategy/VerifiedCheck.tsx
- FOUND commits (ancestors of HEAD): 20f89eae3, 3cc146f8e, 16626aff0
- Backup directory under the scratchpad removed; no untracked files left in the worktree before this summary.
