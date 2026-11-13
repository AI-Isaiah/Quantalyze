---
phase: 199-managerhome-each-role-lands-on-its-own-page-and-a-manager-has
plan: 03
subsystem: ui
tags: [degrade-warnings, copy-registry, structural-test, allocations, react]
status: complete

requires:
  - phase: 198
    provides: "the shipped key and day notes (FailingKeyExitNote, UnpricedAccountNote, DepartedHistoryNote) and ExchangesPageLink"
provides:
  - "src/lib/degrade-warnings.ts: DEGRADE_WARNINGS, ACTION_SENTENCES, WHOLE_HISTORY_IDS, degradePlainText, degradeSegments"
  - "src/components/degrade/DegradeLine.tsx: renders registry segments with labels and action links, carrying data-degrade-id"
  - "registry test that renders a fixture sample for every entry, and a per-file scan ledger test, both shown RED"
  - "My allocation's four dashboard notes registered and rewritten to name their scope and one action"
affects: [199-05, 199-15, 199-16, 199-18]

plan_head_before: 1157767ef061176922916f1da92f3276a9083efd
plan_head_after: 85675ca546a48d5c65a436b1f26ac73f7d95cc65
actuals:
  tokens: 20500
  tasks: 3
  commits: 6

tech-stack:
  added: []
  patterns:
    - "copy registry with typed per-entry text args (DegradeArgs<I>), samples keyed by id with a mapped satisfies so a missing sample is a compile error"
    - "judge function exercised on the real registry AND on synthetic bad entries (meta-arms), so the gate is shown able to fail"
    - "per-file scan ledger: comment-stripped trip-hit count plus pinned id set, vacuity fence"

key-files:
  created:
    - src/lib/degrade-warnings.ts
    - src/lib/degrade-warnings.test.tsx
    - src/components/degrade/DegradeLine.tsx
    - src/__tests__/degrade-warning-scan.test.ts
  modified:
    - "src/app/(dashboard)/allocations/AllocationDashboardV2.tsx"
    - "src/app/(dashboard)/allocations/AllocationDashboardV2.staleness.test.tsx"
    - "src/app/(dashboard)/allocations/AllocationDashboardV2.departed-history.test.tsx"
    - "src/app/(dashboard)/allocations/AllocationDashboardV2.unpriced-account.test.tsx"
    - "src/app/(dashboard)/allocations/AllocationDashboardV2.failing-key.test.tsx"

key-decisions:
  - "Never-synced staleness is its own registry id (allocation.staleness-never, scope key) beside allocation.staleness (scope day), so each id has exactly one scope the registry test can judge."
  - "DegradeLine takes id plus segments (as the plan's contract says) and the dashboard builds segments with degradeSegments(id, args); the id literal therefore appears at each render site, which is how the scan attributes it."
  - "The A-CSV link phrase is 'Upload a newer CSV' (the action sentence's own words) pointing at the shipped CSV wizard URL; the shipped link text 'upload a new CSV strategy' does not occur in the vocabulary sentence."
  - "The deselect action renders as plain text in DegradeLine until the Scenario plan (199-15) wires a handler."

patterns-established:
  - "A degrade warning is registered once; surfaces render it through DegradeLine and name its id as a string literal in the file."
  - "Group and sort in the component; the registry text function only turns key labels, ISO days and counts into segments."

requirements-completed: [ROUTE-11]

coverage:
  - id: D1
    description: "One registry holds every degrade warning's id, surface, class, scope, action and copy; its test renders a sample per entry and fails on a degrade sample naming neither its key nor its day or lacking its action sentence"
    requirement: ROUTE-11
    verification:
      - kind: unit
        ref: "src/lib/degrade-warnings.test.tsx#degrade judge: it fails on a warning that names neither a day nor a key, or no action (meta-arms)"
        status: pass
    human_judgment: false
  - id: D2
    description: "A scan test fails on an unledgered file, a hit-count change, an unknown id or an orphan entry"
    requirement: ROUTE-11
    verification:
      - kind: unit
        ref: "src/__tests__/degrade-warning-scan.test.ts#degrade warning scan: the ledger judge fails when it should (meta-arms)"
        status: pass
    human_judgment: false
  - id: D3
    description: "StalenessBanner names the day of the newest sync (or the never-synced keys) and one action, keeps its amber shell, and prints no relative age"
    requirement: ROUTE-11
    verification:
      - kind: unit
        ref: "src/app/(dashboard)/allocations/AllocationDashboardV2.staleness.test.tsx"
        status: pass
    human_judgment: false
  - id: D4
    description: "FailingKeyExitNote and UnpricedAccountNote end each clause with its action; a dead key's clause names only that key"
    requirement: ROUTE-11
    verification:
      - kind: unit
        ref: "src/app/(dashboard)/allocations/AllocationDashboardV2.failing-key.test.tsx#dead key: with two keys and one failing, the note names only the failing key"
        status: pass
      - kind: unit
        ref: "src/app/(dashboard)/allocations/AllocationDashboardV2.unpriced-account.test.tsx"
        status: pass
    human_judgment: false
  - id: D5
    description: "DepartedHistoryNote is a count-pinned whole_history entry naming no key, with the contact-form action"
    requirement: ROUTE-11
    verification:
      - kind: unit
        ref: "src/app/(dashboard)/allocations/AllocationDashboardV2.departed-history.test.tsx"
        status: pass
    human_judgment: false

duration: 11 min
completed: 2026-11-10
---

# Phase 199 Plan 03: Degrade-warning registry and My allocation's four notes Summary

**One degrade-warning registry (13-id action vocabulary, typed per-entry text) rendered through DegradeLine, a registry test and a per-file scan ledger that both fail on a warning naming no day, key or action, and the dashboard's four notes rewritten to name their scope and one action.**

## Accomplishments

- `src/lib/degrade-warnings.ts`: closed class, scope and surface sets, `ACTION_SENTENCES` (the UI-SPEC's twelve ids verbatim plus `A-RECONNECT-ANY-OR-WAIT`, origin recorded beside it), `WHOLE_HISTORY_IDS` pinned at 1, `labelSegments`, `degradeSegments`, `degradePlainText`, and 11 entries: `allocation.staleness`, `allocation.staleness-never`, `allocation.failing-key-{sync-failing,read-incomplete,undated}`, `allocation.unpriced-{dated,whole,history}`, `allocation.departed-history`.
- `DegradeLine`: string text, semibold `{ label }` spans, action links (exchanges via `ExchangesPageLink`, contact via `ContactPointerText` with `contactHref({ topic: "support" })`, edit with a strategy id, csv), `data-degrade-id` on the root. A label renders as a React text node, never markup; an edit action with no strategy id falls back to plain text rather than a dead link.
- StalenessBanner reads `Analytics may be stale: no exchange key has synced since {day}. Reconnect a key on the Exchanges page, or wait for the next sync.` The day is the UTC date of the newest `last_sync_at` (no client clock, so it is the same at any "now"). With no sync ever it names the active keys by `apiKeyLabelById`, sorted by label. Amber shell, `role`, test id unchanged. `formatRelativeAge` is removed.
- FailingKeyExitNote and UnpricedAccountNote keep every shipped sentence and append the action per clause kind (A-RECONNECT, A-WAIT-SYNC, A-RECONNECT-OR-WAIT; A-WAIT-CLOSE for dated and history, A-CONTACT-CHECK for whole). Containers, test ids, roles and classes are unchanged (the existing tests pin them).
- DepartedHistoryNote reads `Across your whole history, this curve leaves out at least one disconnected account, because the balance its history is measured from is not available. Use the contact form to have it checked.` It names no key (CD-09) and the contact phrase is the link.

## Evidence (CLAUDE.md Rule 9)

gc-199-03-red: Task 1, against the shipped banner (registry entry in its shipped form: relative age, no day), commit `706f1da94`. Registry test: `allocation.staleness: does not name the day Oct 3, 2026` and `allocation.staleness: lacks its action sentence verbatim` (plus the day-sentence and never-synced arms). Scan test: `ledger pins allocation.staleness, which the file no longer names` and `allocation.staleness: orphan registry entry, no ledgered file renders it`. Staleness test: `expected 'Analytics may be stale. Last successful sync was 3d ago. ...' to be 'Analytics may be stale: no exchange key has synced since May 25, 2026. ...'`, and the clock arm showed `3d ago` vs `99d ago` for two "now"s. Task 2 RED (`b6774f42c`): 21 of 30 failing-key and unpriced-account cases failed with no action appended (the dead-key case passed at once: that invariant already held and is now pinned). Task 3 RED (`b77d08294`): the departed-history note test and the whole_history pin failed.

gc-199-03-neuter: Task 1: replaced the day segment in `allocation.staleness` text with `recently` on a byte copy; registry test RED with `allocation.staleness: does not name the day Oct 3, 2026`; restored from copy, `cmp` identical.
gc-199-03-neuter: Task 2: removed the action segment from `allocation.failing-key-read-incomplete`; RED with `allocation.failing-key-read-incomplete: lacks its action sentence verbatim` (and 3 dashboard cases); restored, `cmp` identical.
gc-199-03-neuter: Task 3: removed the scope phrase `Across your whole history, ` from `allocation.departed-history`; RED with `whole_history copy lacks "whole history"` and the dashboard note test; restored, `cmp` identical.
gc-199-03-neuter: Scan test, on the real dashboard: inserted an unregistered `<p role="status">` before the InsightStrip; RED with `AllocationDashboardV2.tsx: 8 warning-styling hits, ledger pins 7`; restored, `cmp` identical.

gc-199-03-gates: vitest=green tsc=clean lint=clean

## Task Commits

1. Task 1 (tracer): `706f1da94` test (RED), `e87408a26` feat (GREEN). The tracer's `<verify>` was automated-only, so it was re-run end to end before expansion: 3 files, 37 tests green.
2. Task 2: `b6774f42c` test (RED), `36e0ea83f` feat (GREEN).
3. Task 3: `b77d08294` test (RED), `85675ca54` feat (GREEN).

## Verification run

- `node scripts/verify-plan-anchors.mjs <plan>`: OK, 13 claims, no stale.
- `npx vitest run src/lib/degrade-warnings.test.tsx src/__tests__/degrade-warning-scan.test.ts "src/app/(dashboard)/allocations"`: 184 files, 3233 tests, all passed.
- `npx tsc --noEmit`: exit 0, no output.
- `npm run lint`: 0 errors. 4 warnings in files this plan did not touch (`MetricsColumn.tsx`, `composite-read-path.ts`, `queries.stale-analytics-detail.test.ts`), pre-existing, not fixed (scope boundary). The route-contract, planning-hygiene and canonical-domain checks printed OK.
- Acceptance greps at HEAD: `Last successful sync was` 0 in the dashboard (was 1); `"allocation.staleness"` 2 in the dashboard (was 0); `data-testid="dashboard-failing-key-note"` 1; six `allocation.failing-key|unpriced` ids in the registry; `the balance that history is measured from` 0 in the dashboard (was 1); `Across your whole history` 1 in the registry.
- Not run, by the disk rules: nothing SQL-related was touched, so no local Supabase stack, sql-tests or sql-mutation lane applies. No analytics-service change, so no mypy or pytest. Nothing is left to CI beyond the normal `frontend` jobs.

## Deviations from Plan

### Auto-fixed issues

**1. [Rule 1 - Bug] Singular verb in the never-synced staleness line**
- **Found during:** Task 1
- **Issue:** the UI-SPEC target `{key labels} have not completed a sync yet` reads wrongly for one key ("Binance — Test Key have not").
- **Fix:** the text function says `has` for one label and `have` for several; with no resolvable label it says `no exchange key has completed a sync yet`. The registry test pins `have not completed a sync yet` for two labels, the staleness test pins `has` for one.
- **Files modified:** `src/lib/degrade-warnings.ts`
- **Commit:** `e87408a26`

### Process notes (no behaviour deviation)

- The plan type is `execute`, not `tdd`, but each task was run RED then GREEN as separate `test(199-03)` and `feat(199-03)` commits. The Task 1 RED commit carries the registry entry in its shipped form on purpose, so the RED is a real shipped warning rather than a made-up one.
- The scan ledger pins the dashboard's total trip-hit count at 7. That count also covers the Risk loading `role="status"` line and the factsheet warm-up note (in_progress and empty states, not degrade warnings); the ledger row's `reason` says so.

**Total deviations:** 1 auto-fixed (Rule 1 grammar). **Impact:** none beyond the one sentence's verb.

## Known limits

- The scan is a per-file ledger, not JSX containment: a new warning whose element carries none of the trip tokens and names no registry id is invisible to it, and a trip hit in an unledgered allocations file is not caught until 199-05 widens the ledger. Both are stated in the test header.
- The `deselect` action renders as plain text; 199-15 wires its handler.
- The departed note still names no key; booking the analytics-service change that would is plan 199-18's TODOS entry (CD-09).
- A-WAIT-CLOSE is kept verbatim ("It is priced once that day's BTC close is stored.") even when a dated clause covers several days; the vocabulary is closed.

## Known Stubs

None.

## Threat Flags

None. No new endpoint, auth path or schema; `DegradeLine` links only to existing routes (`/profile?tab=exchanges`, `/contact`, `/strategies/new/wizard?source=csv`, a strategy edit page). Key labels come only from the owner's own payload through `apiKeyLabelById` (T-199-04), and the dead-key test names only the failing key.

## Self-Check: PASSED

- FOUND: `src/lib/degrade-warnings.ts`, `src/lib/degrade-warnings.test.tsx`, `src/components/degrade/DegradeLine.tsx`, `src/__tests__/degrade-warning-scan.test.ts`
- FOUND commits: `706f1da94`, `e87408a26`, `b6774f42c`, `36e0ea83f`, `b77d08294`, `85675ca54`
- Acceptance greps and plan-level verification re-run at HEAD (above).
