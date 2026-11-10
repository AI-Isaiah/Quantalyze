---
phase: 199-managerhome-each-role-lands-on-its-own-page-and-a-manager-has
plan: 05
subsystem: ui
tags: [degrade-warnings, copy-registry, structural-test, allocations, missing-data-message, scan-ledger]
status: complete

requires:
  - phase: 199-03
    provides: "the degrade-warning registry, DegradeLine, the registry test and the per-file scan ledger"
  - phase: 198
    provides: "MissingDataMessage and its D-01 and D-10 wording"
provides:
  - "src/lib/degrade-warnings.ts: 7 allocation.key-gap.* entries, 10 whole_history allocation.book.* entries (count pin 1 to 10), the history-read-failed read_failure, six inventory entries, five shipped-origin action ids"
  - "MissingDataMessage rendering every line from a registry entry through DegradeLine"
  - "the scan ledger widened to the whole allocations tree, with DEFERRED_UNTIL_196 naming the three Phase 196 plan 20 files"
  - "five marker-only data-degrade-id markers and AlertBanner's alerts-check failure with the A-RELOAD action"
affects: [199-15, 199-16, 199-18]

plan_head_before: 1060e1f20c106eefa3babaa2d288c19ee1a12a49
plan_head_after: 24fb625bc6b346856a588eba66d63d8e8a1d9535
actuals:
  tokens: 22600
  tasks: 3
  commits: 6

tech-stack:
  added: []
  patterns:
    - "a structured GapCoverage argument ({ days } | { since } | null) so the registry owns the words 'no data for' and 'no data since' while the component keeps the range-expansion logic"
    - "marker on an element the file owns when a shared banner does not forward data-* props"
    - "scan judge gains a deferral set that must stay true (each deferred file exists, still hits, is not ledgered)"

key-files:
  created:
    - "src/app/(dashboard)/allocations/components/AlertBanner.test.tsx"
    - "src/app/(dashboard)/allocations/degrade-markers.test.tsx"
  modified:
    - src/lib/degrade-warnings.ts
    - src/lib/degrade-warnings.test.tsx
    - src/__tests__/degrade-warning-scan.test.ts
    - "src/app/(dashboard)/allocations/components/MissingDataMessage.tsx"
    - "src/app/(dashboard)/allocations/components/MissingDataMessage.test.tsx"
    - "src/app/(dashboard)/allocations/EmptyState.tsx"
    - "src/app/(dashboard)/allocations/components/OnboardingBanner.tsx"
    - "src/app/(dashboard)/allocations/components/AlertBanner.tsx"
    - "src/app/(dashboard)/allocations/components/ProvenanceNote.tsx"
    - "src/app/(dashboard)/allocations/components/DefaultChangeNote.tsx"
    - "src/app/(dashboard)/allocations/components/BlendHeader.tsx"
    - "src/app/(dashboard)/allocations/AllocationDashboardV2.rebuilding.test.tsx"
    - "src/app/(dashboard)/allocations/OverviewRisk.history-parity.test.tsx"
    - "src/app/(dashboard)/allocations/components/ScenarioComposer.test.tsx"

key-decisions:
  - "The five unnamed fallbacks (identity pending, duplicate account, key not syncing for several keys and for unknown keys, shared account with no working key) have no verbatim target in the plan. Executor-chosen wording: every shipped word kept, with the D-10 scope sentence placed IN FRONT. Placing it between cause and action would make the shipped 'Check it' and 'Disconnect one of them' read as pointing at the chart."
  - "Shipped sentences whose action is not in the closed vocabulary get shipped-origin ids with the origin recorded beside them (A-WAIT-IDENTITY, A-CHECK-IT, A-CHECK-THEM, A-FIX-ONE-OF-THESE, A-FIX-ONE-OF-THEM), never a near-match."
  - "history_read_failed keeps its shipped 'Reload the page to try again.' as shippedAction (action null), not A-RELOAD's 'this page'."
  - "ProvenanceNote carries its marker only for the default message; the membership variant (a caller-supplied message) is a different warning that its owner registers."

patterns-established:
  - "A line whose coverage is unknown names the key only; the key_day scope is judged on the sample, which carries a range."
  - "A text-less entry is marker-only: DegradeArgs resolves to undefined (it was never), so its sample is args: undefined."

requirements-completed: [ROUTE-11]

coverage:
  - id: D1
    description: "Every Phase 198 per-key line renders from a registry entry with its shipped words unchanged and its own data-degrade-id"
    requirement: ROUTE-11
    verification:
      - kind: unit
        ref: "src/lib/degrade-warnings.test.tsx#the Phase 198 per-key lines read word for word what shipped (199-05 Task 1)"
        status: pass
      - kind: unit
        ref: "src/app/(dashboard)/allocations/components/MissingDataMessage.test.tsx#MissingDataMessage: every gap line is rendered from a registry entry (199-05, D-04)"
        status: pass
    human_judgment: false
  - id: D2
    description: "The book-wide lines state 'for your whole history' and end on one vocabulary action, in the shipped D-10 words, and never name return or risk (whole-word)"
    requirement: ROUTE-11
    verification:
      - kind: unit
        ref: "src/lib/degrade-warnings.test.tsx#the book-wide lines name their whole-history scope and one action, in the shipped D-10 words (199-05 Task 2, OQ-2)"
        status: pass
      - kind: unit
        ref: "src/app/(dashboard)/allocations/components/MissingDataMessage.test.tsx#MissingDataMessage: book-wide lines state their whole-history scope, one action, and never return or risk (D-10, R-03)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Every warning-styling hit under the allocations tree is a registered entry or a ledgered non-warning, and a new unledgered hit fails naming both counts"
    requirement: ROUTE-11
    verification:
      - kind: unit
        ref: "src/__tests__/degrade-warning-scan.test.ts#degrade warning scan: the real scanned surfaces"
        status: pass
    human_judgment: false
  - id: D4
    description: "AlertBanner's alerts-check failure is a read_failure that reads 'Couldn't verify critical alerts. Reload this page to try again.' from the registry"
    requirement: ROUTE-11
    verification:
      - kind: unit
        ref: "src/app/(dashboard)/allocations/components/AlertBanner.test.tsx"
        status: pass
    human_judgment: false
  - id: D5
    description: "The five marker-only entries' data-degrade-id reaches the rendered DOM on the element a reader sees"
    requirement: ROUTE-11
    verification:
      - kind: unit
        ref: "src/app/(dashboard)/allocations/degrade-markers.test.tsx"
        status: pass
    human_judgment: false

duration: 16 min
completed: 2026-11-10
---

# Phase 199 Plan 05: Missing-data message registered and every remaining allocations warning inventoried Summary

**The Phase 198 missing-data message now renders every line from the degrade registry (word for word for the key lines), the book-wide lines state `for your whole history` plus one action without ever naming return or risk, and a tree-wide scan ledger accounts for every warning-styled element under `allocations/`.**

## Executor-chosen wording and changed expectations (read first)

These are the only places the plan gave no verbatim target. They are decisions, not plan text.

**Unnamed fallbacks.** Plan truth OQ-2 says these keep their shipped wording and add `for your whole history` and one action, but gives no string. Each now reads the D-10 sentence first, then the shipped sentence unchanged (the shipped action is the last sentence):

| Reason | Before (198) | After (199-05) |
|---|---|---|
| `account_identity_pending` | `We are confirming which exchange account each key reads. Each daily sync checks it again.` | `The equity chart and the ratios built from it are hidden for your whole history. ` + before |
| `duplicate_account` | `Two of your keys read the same exchange account. Disconnect one of them on the Exchanges page and the history rebuilds.` | same prefix + before |
| `key_not_syncing`, keys unknown | `One of your keys is not syncing, so we cannot confirm which exchange account it reads. Check it on the Exchanges page.` | same prefix + before |
| `key_not_syncing`, several keys | `Some of your keys are not syncing, so we cannot confirm which exchange accounts they read. Check them on the Exchanges page.` | same prefix + before |
| `shared_account_no_working_key` | `The keys that read one of your exchange accounts are all failing to sync, so that account's history stops. Fix or reconnect one of them on the Exchanges page.` | same prefix + before |

The one-named-key `key_not_syncing` line (`One of your keys, {label}, is not syncing ... Check it on the Exchanges page.`) is scope `key`, unchanged, and its label stays plain text as shipped.

**The four plan-given rewrites** (verbatim from the plan's behavior block; D-10 words kept, `for your whole history` inserted after `hidden`, action appended):

| Reason | Before (198 D-10) | After |
|---|---|---|
| `awaiting_derivation` | `... Until the next recompute, the equity chart and the ratios built from it are hidden.` | `... are hidden for your whole history. They appear after the next daily recompute.` (A-WAIT-RECOMPUTE) |
| `derivation_rejected` | `... so it is not shown. The equity chart and the ratios built from it are hidden.` | `... are hidden for your whole history. Use the contact form to have it checked.` (A-CONTACT-CHECK) |
| `shared_account_history_truncated` | `... to the new key's, so your history is not shown.` | same + ` The equity chart and the ratios built from it are hidden for your whole history. Use the contact form to have it checked.` (A-CONTACT-CHECK) |
| unknown reason | `The equity chart and the ratios built from it are hidden for now.` | `The equity chart and the ratios built from it are hidden for your whole history for now. Use the contact form to have it checked.` (A-CONTACT-CHECK) |

`history_read_failed`: sentence unchanged, class `read_failure`, `shippedAction` `Reload the page to try again.` (A-RELOAD says "this page", so it would have changed shipped copy).

**AlertBanner:** `Couldn't verify critical alerts.` becomes `Couldn't verify critical alerts. Reload this page to try again.` (A-RELOAD).

**Key lines (Phase 198 D-01):** no expected string in `MissingDataMessage.test.tsx` that pins a key line changed. `git diff 1060e1f20 -- MissingDataMessage.test.tsx` removes lines only where a book-line or fallback expectation moved (the table above); the key-line expectations are untouched.

## Accomplishments

- Registry: seven `allocation.key-gap.*` entries (not-syncing, sync-failing, read-incomplete, duplicate-account, shared-account-failing, identity-pending, not-syncing-one-key) taking `labels` and a structured `GapCoverage`; ten whole_history `allocation.book.*` entries; `allocation.book.history-read-failed`; the six inventory entries; `WHOLE_HISTORY_IDS` raised 1 to 10 with its reason recorded beside it.
- `MissingDataMessage.tsx`: `GapLine`, the one-named-key line and every book line render through `DegradeLine`. `BOOK_LINE` is now reason to registry id (still `satisfies Record<Exclude<..., NeedsActionReason>, DegradeId>`, so a reason moving class still fails to compile), `UNKNOWN_REASON_LINE` is the registry id. `missingDataLines` and its callers are unchanged.
- Scan test: id pattern accepts multi-segment ids (the old tail stopped at the first segment, so `allocation.key-gap.not-syncing` would have read as an orphan), a test that the pattern matches the whole of every registry id, 20 ledger rows, `DEFERRED_UNTIL_196` (exactly ScenarioComposer, HoldingsTable, WatchlistPanel), a new rule failing an unledgered undeferred file with a hit (`N warning-styling hits, ledger pins 0`), a stale-deferral rule, and `scenario` added to the scanned surfaces.
- Markers: `EmptyState` (span inside the InfoBanner), `OnboardingBanner` (the text block inside the WarningBanner), `ProvenanceNote` (default message only), `DefaultChangeNote`, `BlendHeader`. The shared `InfoBanner` and `WarningBanner` forward no data props, so a marker placed on them would vanish; `degrade-markers.test.tsx` pins that each reaches the DOM.

## Enumeration (Task 3)

Command: `grep -a -rnE 'role="status"|WarningBanner|ScopedBanner|InfoBanner|text-warning|border-warning-border|warning-bg' "src/app/(dashboard)/allocations" --include='*.ts' --include='*.tsx' | grep -v '\.test\.'`. It lists 21 files with a hit once comments are stripped, the same 21 as the plan: AllocationDashboardV2 (199-03, 7), the three deferred files, and the 17 below. The plan's table counts lines; the scan counts tokens, so the pinned numbers differ without a new file or class: EmptyState 4, OnboardingBanner 4, CoverageStateChip 6 (plan: 1, 1, 2). Counts taken from `scanSource`, which is what the ledger pins.

| File (allocations/...) | Hits | Classification |
|---|---|---|
| EmptyState.tsx | 4 | registered, `allocation.first-sync` (in_progress), marker |
| components/OnboardingBanner.tsx | 4 | registered, `allocation.onboarding` (empty), marker |
| components/AlertBanner.tsx | 1 | registered, `allocation.alerts-unverified` (read_failure), rendered through DegradeLine |
| components/ProvenanceNote.tsx | 1 | registered, `scenario.provenance` (provenance), marker, default message only |
| components/DefaultChangeNote.tsx | 1 | registered, `scenario.default-change` (composition), marker |
| components/BlendHeader.tsx | 1 | registered, `scenario.blend-header` (composition), marker |
| AllocationsTabs.tsx | 2 | ledgered, not a warning: loading skeleton, sr-only announcement |
| loading.tsx | 1 | ledgered, not a warning: loading announcement |
| components/SavedScenariosList.tsx | 1 | ledgered, not a warning: form status ("Copied") |
| components/AddAllocationFlow.tsx | 1 | ledgered, not a warning: loading skeleton |
| components/ScenarioCommitDrawer.tsx | 1 | ledgered, not a warning: form status (commit success) |
| components/OutcomeForm.tsx | 1 | ledgered, not a warning: form status ("Outcome recorded") |
| components/StrategyBrowseDrawer.tsx | 1 | ledgered, not a warning: chip colour (tone map) |
| components/CoverageTimeline.tsx | 1 | ledgered, not a warning: chart mark with its own aria-label |
| components/CoverageStateChip.tsx | 6 | ledgered, not a warning: chip |
| components/OpenPositionsTable.tsx | 1 | ledgered, not a warning: chip (`AMBER_CHIP_STYLE`) |
| components/WidgetState.tsx | 1 | ledgered, not a warning: partial pill (aria-hidden, sr-only state) |
| components/ScenarioComposer.tsx, HoldingsTable.tsx, WatchlistPanel.tsx | 21, 2, 1 | `DEFERRED_UNTIL_196` (199-15 empties it) |

The ledgered non-warning files are byte-unchanged (`git diff` shows none of them).

## Evidence (CLAUDE.md Rule 9)

gc-199-05-red: Task 1 (`1fcbdbf18`): 14 failed, the existing 68 passed. Assertions: `every sample has an entry and every entry has a sample` (16 samples against 9 entries), the vocabulary pin, and `expected  to have a length of 1 but got +0` on each `data-degrade-id="allocation.key-gap.*"` arm; the scan ledger arm failed on the pinned ids. The four registry word-for-word arms threw `degrade warning allocation.key-gap.* has no text`, the intended absence. Task 2 (`bb44323ec`): 34 failed (the four rewritten lines, the five scoped fallbacks, the read_failure, the 9 rendered whole-history cases, the count pin, the sample parity). Task 3 (`6e7d75ae7`): 8 registry/scan failures, 1 AlertBanner assertion (`expected 'Couldn't verify critical alerts.' to be 'Couldn't verify critical alerts. Rel...'`), 5 marker failures (`length 1 but got +0`).

gc-199-05-neuter: Task 1: replaced the `coverageText(...)` segment of `allocation.key-gap.not-syncing` with the literal `no data` on a byte copy; RED with 7 failures: the registry `no entry has a problem` arm (the day is no longer named), the word-for-word arm, and five `MissingDataMessage` cases (`expected 'Binance — Main: no data. Reconnect th...' to be 'Binance — Main: no complete history y...'`); restored from the copy, `cmp` identical.
gc-199-05-neuter: Task 2 (a): removed `for your whole history` from `allocation.book.derivation-rejected`; RED with the registry judge (`whole_history copy lacks "whole history"`), its word-for-word arm, and the message's scope arm (`expected 'The latest rebuild ...' to contain 'for your whole history'`); restored, `cmp` identical.
gc-199-05-neuter: Task 2 (b): replaced `returns` with `risk` in `allocation.book.awaiting-derivation`; RED with the D-10 guard arms (`D-10: no whole_history book-level sample names return or risk`, and `expected 'Your book's history is recomputed...' not to match /\b(return|risk)\b/i`); restored, `cmp` identical.
gc-199-05-neuter: Task 3: added `<p className="text-warning">` to a byte copy of `EmptyState.tsx`; RED with `src/app/(dashboard)/allocations/EmptyState.tsx: 5 warning-styling hits, ledger pins 4`; restored, `cmp` identical.

gc-199-05-gates: vitest=green tsc=clean lint=clean

## Task Commits

1. Task 1 (tracer): `1fcbdbf18` test (RED), `efa9e3707` feat (GREEN). The tracer's `<verify>` was automated-only, so it was re-run end to end before expansion: 3 files, 82 tests green, `tsc` clean.
2. Task 2: `bb44323ec` test (RED), `ebbe0b164` feat (GREEN, with the collateral tests below).
3. Task 3: `6e7d75ae7` test (RED), `24fb625bc` feat (GREEN).

## Verification run

- `node scripts/verify-plan-anchors.mjs <plan>`: OK, 9 claims, no stale.
- `npx vitest run src/__tests__/degrade-warning-scan.test.ts src/lib/degrade-warnings.test.tsx "src/app/(dashboard)/allocations" src/__tests__/display-sign-single-source.test.ts`: 187 files, 3311 tests, all passed.
- `npx tsc --noEmit`: exit 0, no output.
- `npm run lint`: 0 errors, 4 warnings, all pre-existing in files this plan did not touch (`MetricsColumn.tsx`, `composite-read-path.ts`, `queries.stale-analytics-detail.test.ts` x2). The route-contract, planning-hygiene and canonical-domain checks printed OK. (An unused `ExchangesPageLink` import this plan caused was removed before the commit.)
- Acceptance greps at HEAD: `allocation.key-gap` 7 (was 0); `for your whole history` 6 lines (was 0); lower-case D-10 sentence 1, capitalised 4; `book return|return and risk` 0 in all three files; `DEFERRED_UNTIL_196` 7 lines, `DEFERRED_UNTIL_196 =` exactly 1 (199-15's baseline greps for it); the six files each name an id, count 6; `Couldn&apos;t verify critical alerts.` in AlertBanner 0 (was 1).
- Not run, by the disk rules: nothing SQL-related or analytics-service was touched, so no local Supabase stack, sql-tests, sql-mutation, mypy or pytest applies. Nothing is left to CI beyond the normal `frontend` jobs.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Collateral tests pinned the old wording**
- **Found during:** Task 2 (collateral grep before changing copy, and a broad run of `src/app/(dashboard)/allocations`, `src/lib`, `src/__tests__`)
- **Issue:** three test files outside `files_modified` assert the rewritten sentences: `AllocationDashboardV2.rebuilding.test.tsx` (the per-reason table, `HIDDEN_FOR_NOW`, the awaiting_derivation line), `OverviewRisk.history-parity.test.tsx` (the awaiting_derivation line) and `ScenarioComposer.test.tsx` (`toContain("hidden for now")` on the unknown-reason line).
- **Fix:** each expectation updated to the new wording, typed by hand; in `rebuilding.test.tsx` the shared scope sentence is a const declared above the table that uses it.
- **Files modified:** the three files above.
- **Commit:** `ebbe0b164`

**2. [Rule 2 - Missing critical] Two new test files**
- **Found during:** Task 3
- **Issue:** AlertBanner had no test (the dashboard tests mock it), so its rewritten copy could not be shown able to fail; and the scan can only prove an id literal is in a file, not that the marker reaches the DOM on an element a reader sees.
- **Fix:** `AlertBanner.test.tsx` (5xx text and marker, 4xx silent, empty silent) and `degrade-markers.test.tsx` (the five markers, ProvenanceNote default versus membership).
- **Commit:** `6e7d75ae7` (RED), `24fb625bc` (GREEN)

**3. [Rule 3 - Blocking] The scan's id pattern could not see multi-segment ids**
- **Found during:** Task 1
- **Issue:** `ID_SOURCE` ended in `[a-z][a-z0-9-]*`, so `"allocation.key-gap.not-syncing"` never matched and every key-gap entry would read as an orphan.
- **Fix:** the tail repeats (`(?:\.[a-z][a-z0-9-]*)+`), and a test asserts the pattern matches the whole of every registry id.
- **Commit:** `1fcbdbf18`, `efa9e3707`

**4. [Rule 1 - Bug] `DegradeArgs` resolved to `never` for a text-less entry**
- **Found during:** Task 3
- **Issue:** a marker-only entry has no `text`, so its sample could not type `args`.
- **Fix:** the conditional now resolves to `undefined` when the entry has no text.
- **Files modified:** `src/lib/degrade-warnings.ts`
- **Commit:** `24fb625bc`

### Scope notes (no behaviour deviation)

- Five shipped-origin vocabulary ids were added beyond the UI-SPEC twelve and 199-03's one: A-WAIT-IDENTITY, A-CHECK-IT, A-CHECK-THEM, A-FIX-ONE-OF-THESE, A-FIX-ONE-OF-THEM. Each quotes a Phase 198 sentence word for word and records its origin beside it; the vocabulary pin test lists all 18.
- `scenario` was added to `SCANNED_SURFACES` (this plan registers three scenario entries, each rendered by a ledgered file), so a scenario entry nobody renders now fails as an orphan. 199-15 registers ScenarioComposer's entries after emptying `DEFERRED_UNTIL_196`, so it is not blocked by this.
- The one-named-key line passes `name ?? ""`, the same output as the shipped `{name}` when no label resolves.

**Total deviations:** 4 auto-fixed (1 Rule 1, 1 Rule 2, 2 Rule 3). **Impact:** the visible change beyond the plan's own targets is the five scoped fallbacks, which the plan's OQ-2 truth requires but gives no string for.

## Known limits

- A pre-existing failure sits outside this plan's files: `src/lib/factsheet/compute.conventions.test.ts` fails 2 frozen-snapshot cases (`fixture B: a series with zero-return days`, `fixture C: a series with interior calendar gaps`; `Snapshot ... mismatched`). It was seen in a broad `src/lib` run and reproduced on its own. No file this plan changed is imported by `compute()`; it was not investigated or fixed (scope boundary), and it was not compared against the base commit because that needs the main checkout.
- The same broad run reported 296 skipped tests across 679 files, none introduced here.
- The scan is still a per-file ledger, not JSX containment: a new warning whose element carries none of the trip tokens and names no registry id is invisible to it (stated in the test header).
- `shared_account_history_truncated` and `derivation_rejected` now ask for a contact-form check, which asks and does not claim to heal the history. `departed-history` still names no key (199-18 books the analytics-service change).
- Marker-only entries record class and surface but hold no copy, so the surface's own JSX is the one home of that sentence until a later plan moves it.

## Known Stubs

None.

## Threat Flags

None. No new endpoint, auth path or schema. Key labels still come only from the owner's own list through `apiKeyLabelById` (T-198-17 holds: the tests for an unlabelled and a half-labelled gap pass unchanged), and `DegradeLine` renders a label as a text node. T-199-06, T-199-07 and T-199-31 are mitigated by the count pin, the tree-wide ledger and the D-10 guard, each shown RED above.

## Self-Check: PASSED

- FOUND: `src/lib/degrade-warnings.ts`, `src/lib/degrade-warnings.test.tsx`, `src/__tests__/degrade-warning-scan.test.ts`, `AlertBanner.test.tsx`, `degrade-markers.test.tsx`, and the eight source files named in key-files.
- FOUND commits: `1fcbdbf18`, `efa9e3707`, `bb44323ec`, `ebbe0b164`, `6e7d75ae7`, `24fb625bc` (all ancestors of HEAD).
- Acceptance greps and the plan-level verification re-run at HEAD (above). `STATE.md` and `ROADMAP.md` untouched.
