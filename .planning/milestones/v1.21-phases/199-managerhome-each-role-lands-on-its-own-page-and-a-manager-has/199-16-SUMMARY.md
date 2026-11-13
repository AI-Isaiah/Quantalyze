---
phase: 199-managerhome-each-role-lands-on-its-own-page-and-a-manager-has
plan: 16
subsystem: ui
tags: [degrade-warnings, registry, strategies-list, health-detail, scan-ledger, cd-11, vitest]
requires:
  - phase: 199-03
    provides: "the degrade-warning registry contract, DegradeLine and the scan ledger"
  - phase: 199-12
    provides: "the Health column, strategyHealthOf and the key-label caption"
  - phase: 199-14
    provides: "the strategies legend"
  - phase: 199-15
    provides: "the completed allocations scan (no deferral set)"
provides:
  - "Every non-Healthy row's note carries one registered Health detail (Analytics failed with the failed day, Stale with its day, Stale with no data yet, the untrusted-key line), after review feedback and before the share note"
  - "ownerRemedy's sentences as vocabulary ids, swept against the shipped remedies, and viewerRemedyAction, which keeps a manager on ownerRemedy and never hands an allocator-only viewer the manager-guarded edit page or CSV wizard (CD-11)"
  - "The strategies list surface walked by the scan, new/** and [id]/** excluded and pinned (NOT_D04_SUBTREES), StrategyTable.tsx by name"
affects: [199-17, 199-18]
requirements-completed: [ROUTE-11]
actuals:
  tokens: 24100
  tasks: 3
  commits: 6
plan_head_before: 1dbc4cf3c1d07941b284666e71ef80c8a46bc839
plan_head_after: 97caa74299ebf3df2844d017e3d5cfe8e157cd15
status: complete
completed: 2026-11-10
duration: 15min  # commit timestamps: first commit 17:07:02 to the SUMMARY commit 17:21:57 (+02:00); reading and design before the first commit are not counted
tech-stack:
  added: []
  patterns:
    - "An entry whose closing action depends on the viewer lists every action it may end on (`actions`); the registry judge renders its sample once per listed action"
    - "A shipped sentence a remedy function owns is quoted into the vocabulary and pinned by a sweep over the function's whole input space, not by one example"
key-files:
  created: []
  modified:
    - "src/app/(dashboard)/strategies/page.tsx"
    - "src/app/(dashboard)/strategies/StrategiesEmptyState.tsx"
    - "src/app/(dashboard)/strategies/page.merged.test.tsx"
    - "src/app/(dashboard)/strategies/page.key-pill.test.tsx"
    - "src/app/(dashboard)/strategies/page.table.test.tsx"
    - src/lib/degrade-warnings.ts
    - src/lib/degrade-warnings.test.tsx
    - src/__tests__/degrade-warning-scan.test.ts
decisions:
  - "A role-dependent closing action is one entry with an `actions` list, not one entry per sentence: nine remedies would have meant nine near-identical entries; every listed action is still judged verbatim and a sweep pins the reachable set"
  - "Stale (no data yet) is class `empty`: it names neither a key nor a day (UI-SPEC OQ-1), and the degrade judge's key-or-day rule was not loosened for it"
  - "The untrusted-key line keeps its pill and helper (UI-SPEC: unchanged) and carries the marker; its registry words are pinned to the on-screen caption and the real pill's helper by tests"
  - "An allocator-only viewer of a CSV strategy is pointed at the contact form, not the CSV action: the CSV link goes to /strategies/new/wizard, which new/layout.tsx guards for managers"
---

# Phase 199 Plan 16: the strategies list's warnings, registered Summary

Each non-Healthy strategy row now says what happened and where to go in one registered line, by the viewer's role, and the scan accounts for every warning on the strategies list surface.

## Open decisions (recommendation given; the plan's defaults were taken)

1. **A failed row with no job on record** (read succeeded, no factsheet job, e.g. done jobs purged after 30 days) prints the KCS09-UNREADABLE sentence with "Reload this page to try again", and a reload cannot fix it. The UI-SPEC calls that sentence "a fact about this read", which does not cover this case. Recommendation: for a read that succeeded with no job (`never_started`), print a different registered `read_failure` line that names no day and ends on `A-CONTACT-RESOLVE`; the page can already tell `never_started` from `unreadable`. Not done here because it is new copy outside the plan.
2. **Allocator-only CSV remedy.** A `must_haves` truth says "or the CSV action"; I used `A-CONTACT-CHECK` because the CSV action's link is manager-guarded (deviation 2). Recommendation: keep the contact form.

## What was built

**Task 1 (tracer), RED `91388d874`, GREEN `3c58bb94a`.**

- `strategies.analytics-failed` (degrade, scope day): "The last computation, on {day}, did not produce figures. {action}". `strategies.compute-status-unreadable` (read_failure, A-RELOAD): the shipped KCS09-UNREADABLE sentence plus its remedy's words.
- The day is the factsheet job's `claimed_at`, else `created_at` (UTC day). `readRecipientArm` now also returns `jobDay` and the composite history, taken from the same `selectFactsheetJob` selection `deriveComputeState` used. `armOf` keeps one read per row (a memo), so a failed unpublished row's share note and its detail share one read. A published failed row, which IN-04 skips for the share note, gets its own `readOwnerComputeJobs` call (`failedFactsOf`); only Analytics-failed rows are read. `readOwnerComputeJobs(` in `page.tsx` went from 1 (rebased reading, recorded before the edit) to 2.
- A manager and `both` keep `ownerRemedy`. Its eight remedy ids map to vocabulary ids (`ownerRemedyAction`); six sentences are new vocabulary ids quoted word for word (`A-OWNER-RELOAD`, `A-RESYNC-EDIT`, `A-LINK-KEY-EDIT`, `A-COMPOSITE-CONTACT`, `A-CSV-FIXED`, plus `A-EXCHANGES-KEY` from the UI-SPEC's "Check its key on the Exchanges page."). `viewerRemedyAction` replaces only the `KCS21-*` shape remedies for an allocator-only viewer.
- The judge renders every action an entry lists (`actions` + the sample's `argsFor`), so a variant that drops its sentence fails by name.
- Scan ledger row for `page.tsx`.

**Task 2, RED `b5ece7697`, GREEN `34c90907f`.**

- `strategies.stale` (degrade, day): "No new data since {day}. {action}"; actions: `A-CSV` (CSV, manager), `A-EDIT` (API or composite, manager and both), `A-EXCHANGES-KEY` (API or composite, allocator only), `A-CONTACT-CHECK` (CSV, allocator only).
- `strategies.stale-no-data` (empty): "No figures yet, and no computation is running. {remedy}", the never-started `ownerRemedy` for a manager; `A-EXCHANGES-KEY` or `A-CONTACT-CHECK` for an allocator-only viewer. No jobs are read for these rows.
- `strategies.key-problem` (degrade, key): the shipped caption (`untrustedKeyCaption`) then the pill's helper, as the vocabulary ids `A-READD-KEY` and `A-UPDATE-CREDENTIALS` (the `REVOKED_HELPER` and `CREDENTIAL_FAILED_HELPER` sentences). The marker sits on the existing `strategy-row-key-mark` div; the pill and its helper are untouched. A test renders the real `AllocatorSyncStatus` and fails if either helper stops being the registry's sentence; a page test pins the on-screen caption and helper. A key is named once per note (counted).

**Task 3, RED `c9c0d60ed`, GREEN `97caa7429`.**

- `strategies.list-unreadable` and `strategies.placeholder-keys-unreadable` (read_failure, A-RELOAD), `strategies.key-status-unreadable` (read_failure, shipped action `Open a strategy to see its keys.` carried as `shippedAction`, OQ-3). Their words are pinned equal to `STRATEGIES_LIST_UNREADABLE`, `PLACEHOLDER_KEYS_UNREADABLE` and `KEY_STATUS_UNREADABLE_NOTE`. `page.tsx` renders none of the three constants directly now (greps below).
- Marker-only: `strategies.share-note` (share_status, on `strategy-row-share-note`), `strategies.empty` (empty, the manager card in both variants), `strategies.empty-allocator` (empty, `StrategiesEmptyState`). Shipped JSX and test ids unchanged.
- The scan walks `src/app/(dashboard)/strategies/**` except `NOT_D04_SUBTREES` (`new`, `[id]`, each with its reason, pinned to exactly those two), plus `StrategyTable.tsx` by name; `strategies-list` joins `SCANNED_SURFACES`, so a list entry no file renders is an orphan.

## Inventory, re-measured after the rebase (plan's command, tests excluded)

```
src/app/(dashboard)/strategies/page.tsx:1214:  <p className="rounded px-2 py-1 text-caption font-normal text-warning bg-warning/5">
src/app/(dashboard)/strategies/page.tsx:1332:  role="status"
src/app/(dashboard)/strategies/page.tsx:1371:  <p className="mt-2 text-xs text-warning">
src/components/strategy/StrategyTable.tsx:1318:  role="status"
src/components/strategy/StrategyTable.tsx:2416:  role="status"
```

Excluded subtrees (listed separately): 32 hits in 9 files under `strategies/new/**` and `strategies/[id]/**`, all wizard and form warnings, not scanned.

Per-item classification:

| File | Item | Class | Decision |
|---|---|---|---|
| page.tsx:1214 | row-note review feedback | not a warning | ledgered: a reviewer's own words |
| page.tsx:1371 | wizard-draft banner Review feedback line | not a warning | ledgered, same reason |
| page.tsx:1332 | just-submitted line | not a warning | ledgered: announcement of the viewer's own submit |
| page.tsx | STRATEGIES_LIST_UNREADABLE card, KEY_STATUS_UNREADABLE_NOTE, placeholder-key line | read_failure | registered |
| page.tsx | share note, manager empty card | share_status, empty | registered, marker |
| page.tsx | Health detail lines, untrusted-key line | degrade, empty | registered (Tasks 1 and 2) |
| StrategiesEmptyState.tsx | allocator-only empty state | empty | registered, marker |
| StrategyTable.tsx:1318 | `figures-not-shown` | **flagged** | ledgered: the Phase 194 figure-gate count line, carried forward unchanged (CONTEXT "Carried forward"). It does say figures are not shown and names no key or day, so it is NOT registered here |
| StrategyTable.tsx:2416 | `selection-status` | not a warning | ledgered: sr-only selection announcement |
| StrategiesSection.tsx | no warning sentence | none | 0 hits, nothing to ledger |
| StrategiesLegend.tsx | none | none | 0 hits (see deviation 6), nothing to ledger |
| loading.tsx, error.tsx, layout.tsx, comparison-note.ts | none | none | 0 hits |

## Verification

All commands in the worktree.

- `node scripts/verify-plan-anchors.mjs <plan>`: OK, 10 claims, no stale (before the first edit and at the tracer gate).
- Precondition: `grep -a -c "strategies-legend-heading" .../StrategiesLegend.tsx` printed 2; `grep -a -c "DEFERRED_UNTIL_196 =" src/__tests__/degrade-warning-scan.test.ts` printed 0.
- RED seen first for each task: Task 1 registry 7 failed, scan 1 failed, merged-page 8 failed; Task 2 registry 8, page 9; Task 3 registry 6, page 5, scan 1.
- Tracer gate (auto mode), `npx vitest run "src/app/(dashboard)/strategies" src/lib/degrade-warnings.test.tsx src/__tests__/degrade-warning-scan.test.ts`: 53 files, 1086 passed. Log: `Tracer verified end-to-end — expanding`.
- Final: `npx vitest run "src/app/(dashboard)/strategies" src/lib/degrade-warnings.test.tsx src/__tests__/degrade-warning-scan.test.ts src/components/strategy`: 114 files, 2292 passed.
- Repo-wide census `npx vitest run src/__tests__`: 180 files passed, 18 skipped (273 tests skipped: the live-DB and RLS suites, no database here), 4862 passed. Same as the base; no new failure. `src/lib/factsheet/compute.conventions.test.ts` (2 pre-existing frozen-snapshot failures) was not run or touched.
- `npx tsc --noEmit -p .`: exit 0.
- Lint, as its parts: `npx eslint --no-cache` on all eight touched `.ts`/`.tsx` files: exit 0; `tsx scripts/check-admin-route-manifest.ts`, `check-route-contract.ts`, `check-planning-hygiene.ts`, `check-canonical-domain.ts`: all exit 0. **Not run:** `npm run lint`'s full-tree `eslint --cache src/` (the brief forbids it: its cache writes into the shared `node_modules` symlink).
- Acceptance greps: `"strategies.analytics-failed"` 1, `"strategies.key-problem"` 1, `"strategies.stale"` 1 in `degrade-warnings.ts`; `readOwnerComputeJobs(` in `page.tsx` 2 (was 1); `STRATEGIES_LIST_UNREADABLE` 0 (HEAD 2); `KEY_STATUS_UNREADABLE_NOTE` 0 (HEAD 3, one was a comment, reworded); `NOT_D04_SUBTREES` 8 in the scan test; `"strategies.empty-allocator"` 1 in `StrategiesEmptyState.tsx`.
- Left to CI: nothing in `supabase/`, `analytics-service/` or SQL was touched, so no SQL gate, mypy or local-stack lane applies. The full-tree eslint and the e2e lanes were not run locally.

gc-199-16-neuter: page.tsx on a byte copy, the published failed row's `readOwnerComputeJobs` skipped (read forced to fail): 5 merged-page cases went RED (the published case, the unreadable-day case, both CD-11 allocator cases, the manager CSV case); restored from the copy, `cmp` identical, 53/53 GREEN.

gc-199-16-neuter: page.tsx on a byte copy, the allocator-only Stale action routed to `A-EDIT`: the Stale API-strategy case went RED (an edit-page link for an allocator-only viewer); restored, `cmp` identical.

gc-199-16-neuter: degrade-warnings.ts on a byte copy, `viewerRemedyAction` returning `ownerRemedyAction` for every viewer (allocator-only routed through ownerRemedy): 4 cases went RED (the registry sweep that no allocator-only remedy links a manager route, and three page cases: failed API strategy, failed CSV strategy, Stale no-data by role); restored, `cmp` identical, 123/123 GREEN.

gc-199-16-neuter: StrategiesSection.tsx (an unledgered file) on a byte copy, a `text-warning` paragraph appended: the scan went RED naming `src/app/(dashboard)/strategies/StrategiesSection.tsx: unledgered file has 1 warning-styling hits, ledger pins 0`; restored, `cmp` identical.

gc-199-16-neuter: degrade-warning-scan.test.ts on a byte copy, a third entry added to `NOT_D04_SUBTREES`: the pin (`expected [ 'new', '[id]', 'neuter' ] to deeply equal [ 'new', '[id]' ]`) and the walk case went RED; restored, `cmp` identical, 19/19 GREEN.

gc-199-16-gates: vitest=green tsc=clean lint=clean (lint = scoped eslint on touched files plus the four non-eslint lint scripts; the full-tree eslint step was not run, see above)

## Deviations from Plan

**1. [Rule 3 - decision] One entry per Health kind with an `actions` list, not one entry per action sentence.** *Found during:* Task 1. *Issue:* the registry has one `action` per entry and the judge needs its sentence verbatim, but the Analytics failed detail ends on one of nine sentences by role, shape and compute state. *Fix:* `DegradeEntry.actions` (optional) lists every sentence an entry may end on, `Sample.argsFor` builds the args for each, and the judge renders every one; two sweeps pin the reachable set (every `ownerRemedy` output over all states, shapes and build facts maps to a same-words vocabulary id; every `viewerRemedyAction` result for a never-started row is on `strategies.stale-no-data`'s list). Eight vocabulary ids were added, each quoting shipped copy or a UI-SPEC target line with its origin beside it, and the vocabulary pin was updated. `DegradeLine.tsx` was not touched.

**2. [Rule 3 - CD-11, flagged] An allocator-only viewer of a CSV strategy gets the contact form, not the CSV action.** The plan says "the CSV action". That link is `/strategies/new/wizard?source=csv`, and `strategies/new/layout.tsx` calls `requireRolePage(..., "manager")`, so the link would bounce an allocator-only viewer, which is what CD-11 forbids. `A-CONTACT-CHECK` opens for every role. A manager and `both` keep the CSV remedy and its link. If the founder wants the CSV action for that role anyway, it is a one-line change in `viewerRemedyAction` and the Stale branch plus two test expectations.

**3. [Rule 3 - decision] Stale (no data yet) is class `empty`, not `degrade`.** The plan's behaviour line gives its sentence but no scope; the sentence names neither a key nor a day (UI-SPEC OQ-1, the dateless form), so a degrade entry would fail the CD-05 judge. I did not weaken the judge.

**4. [Rule 3 - decision] The Key problem line is a marker plus pinned words, not rendered through `DegradeLine`.** `key_links` allows "rendered through DegradeLine or carrying data-degrade-id". The pill already prints the helper, so a `DegradeLine` carrying it too would print it twice, and the UI-SPEC says the pill and helper are unchanged. The registry text (caption plus helper) is pinned to the on-screen caption and to the real `AllocatorSyncStatus` helper by tests, so it cannot drift.

**5. [Rule 3] The UI-SPEC's "If it still trades, " prefix on the Stale action is not in the copy.** Task 2's behaviour line gives the action alone ("the edit-page action"), and the vocabulary's `A-EDIT` sentence is "Check its key on the edit page." with a capital C, which cannot follow a lowercase prefix verbatim. The plan's wording was followed.

**6. [Rule 3 - measurement] The re-measured inventory differs from the plan's table.** `StrategiesLegend.tsx` has 0 trip hits (the plan expected the Health and chip tones; they come from `HEALTH_TONE` and `StaleSeriesChip`, outside the walked files), so it needs no ledger row and is covered by the unledgered-hit rule. `StrategyTable.tsx` has 2 hits, both `role="status"` (`figures-not-shown` and `selection-status`); the SYNCING chip and Health cell tone are not in the file's trip hits. The excluded subtrees carry 32 hits in 9 files, not 8. Each difference was classified by the plan's rules.

**7. [Rule 3 - collateral test edits outside `files_modified`].** `page.key-pill.test.tsx`: the IN-04 case "a published row whose analytics failed ... reads no jobs" now asserts exactly one jobs read (for the detail's day) and the unreadable sentence beside the unchanged share note; the "renders the note after any key lines" case now expects the detail line before the share note. `page.table.test.tsx`: a draft's note order now reads feedback, Health detail (Stale, no data yet), share note. Each pins the same intent as before with the new line in it.

**8. [Rule 1/2 - known limits, recorded not fixed.]** (a) A failed row whose jobs read succeeds with no job on record (done jobs are purged after 30 days) has no day, so it prints the KCS09-UNREADABLE sentence, as the UI-SPEC's "day cannot be read" rule says; its reload remedy cannot help in that case. A test pins that no day is invented. (b) The selected job is the newest factsheet job, so an Analytics failed row with a re-run already queued names that job's day; Health still reads Analytics failed because the stored row does. (c) A Stale (no data yet) row reads no jobs, so its shape uses `resolveStrategyShape`'s default composite history (the pre-M-7 behaviour); an RLS-fabricated zero member count could show the unlinked remedy for a composite. Both (b) and (c) are narrow and neither prints a wrong day.

**9. Plan-ledger setup.** `gsd-plan-head-before-199-16` was written before the first edit, with value `1dbc4cf3c` (the verified fork point).

**Total deviations:** 9 (four design decisions, one flagged CD-11 substitution, one measurement difference, one collateral-test edit, one recorded-limits group, one bookkeeping). **Impact:** none on scope; every Health detail names its day or its remedy by role and every warning on the list is registered or ledgered.

## Authentication Gates

None.

## Known Stubs

None. (Scanned the modified source files: no hardcoded empties flowing to UI, no placeholder text added. The three marker-only entries carry no `text` by design.)

## Threat Flags

None. T-199-26 is mitigated as planned (list-surface walk, two-entry pinned exclusion, an unledgered file fails, neuter evidence). T-199-27 is mitigated: the published failed row's read is the same owner-scoped `get_user_compute_jobs` RPC over the viewer's own strategy id, and a failed read renders the unreadable sentence, never another row's day (T-199-SC unchanged: no installs).

## Self-Check: PASSED

- Commits 91388d874, 3c58bb94a, b5ece7697, 34c90907f, c9c0d60ed and 97caa7429 are on `worktree-agent-199-16` (`git merge-base --is-ancestor` checked); `commits: 6` measured with `git rev-list --count` from the ledger base.
- All eight modified files exist; no untracked files remain in the worktree; backups removed from the scratchpad.
