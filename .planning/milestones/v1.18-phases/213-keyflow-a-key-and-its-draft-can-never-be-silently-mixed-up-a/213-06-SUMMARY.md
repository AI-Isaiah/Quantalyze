---
phase: 213-keyflow-a-key-and-its-draft-can-never-be-silently-mixed-up-a
plan: 06
subsystem: ui
tags: [strategies-page, disconnect, api-keys, orphan-keys, confirm-dialog, a11y, react, vitest]

requires:
  - phase: 213-keyflow
    provides: "Plan 04: StrategyTable's optional onDisconnect prop and the placeholder row's Disconnect button; every role's orphans listed"
provides:
  - "key-feeds-confirm.ts: the feeds-aware confirm's read and wording, one implementation shared by AllocatorExchangeManager and StrategiesSection"
  - "StrategiesSection mints onDisconnect and mounts a Disconnect-only confirm (Cancel and Disconnect for every role; no Delete key, no cascade box, no holdings read)"
  - "Disconnect calls the owner-scoped RPC disconnect_allocator_api_key with the row's key id, then router.refresh(); the key row is kept"
  - "Post-success polite announcement and a focus move that never drops to body"
affects: [213-05 KEY_ORPHANED copy, 213 legend line (PIPELINE_DEFINITIONS.no_strategy_yet), 213 verification]

actuals:
  tokens: 14000
  tasks: 3
  commits: 5
plan_head_before: 2159eeacdc252e1cf78082acebc9216694da03b5
plan_head_after: f01ddd2b83343488be127389cfa46824263ba750

tech-stack:
  added: []
  patterns:
    - "A shared client helper module extracted byte-for-byte (not re-authored) so two hosts keep one wording and one read idiom"
    - "Sequence-guarded async read with an effect cleanup that bumps the sequence, so a closed or re-keyed confirm drops late answers"
    - "Focus request as a fresh object per success, consumed by one effect after the dialog has unmounted; the next neighbour is chosen from the pre-refresh list so focus survives the refresh"

key-files:
  created:
    - src/components/exchanges/key-feeds-confirm.ts
    - src/app/(dashboard)/strategies/StrategiesSection.disconnect.test.tsx
  modified:
    - src/components/exchanges/AllocatorExchangeManager.tsx
    - src/app/(dashboard)/strategies/StrategiesSection.tsx
    - src/__tests__/degrade-warning-scan.test.ts

key-decisions:
  - "Body selector is the host's existing allocatorFurniture boolean (true for allocator and both, false for manager-only). No separate role fact reaches StrategiesSection; this is the plan's stated fallback."
  - "Focus is moved to the neighbouring row's Disconnect control immediately on success (neighbour chosen from the list as it was), not after the refreshed rows arrive. The neighbour persists across the refresh, so focus stays; the immediate move also covers a refresh that is slow."
  - "Esc and the header close are ignored while in flight by the same guard the source confirm uses (state is kept). Like the source confirm, a real browser's native dialog still closes visually on Esc because Modal exposes no cancel hook; Modal was not edited."

patterns-established:
  - "The Disconnect-only variant has no delete path by construction: the host imports no delete RPC and no holdings read; the exact-buttons and NEVER-DELETES tests go RED if one is added"

requirements-completed: []

coverage:
  - id: D1
    description: "Disconnect on a No strategy yet row opens a two-button confirm (Cancel, Disconnect), calls disconnect_allocator_api_key with that row's key id, refreshes, and never offers or calls a delete"
    verification:
      - kind: unit
        ref: "src/app/(dashboard)/strategies/StrategiesSection.disconnect.test.tsx#TRACER: the row's Disconnect opens a confirm that disconnects that exact key through the RPC and refreshes the page"
        status: pass
      - kind: unit
        ref: "src/app/(dashboard)/strategies/StrategiesSection.disconnect.test.tsx#NEVER DELETES: no role is offered Delete key or a cascade box, and no delete RPC is called"
        status: pass
    human_judgment: false
  - id: D2
    description: "Confirm states: feeds checking holds Disconnect, an unreadable read warns with Retry and does not hold it, stale answers are dropped, an RPC error shows the alert and stays open, in-flight label and lock, role-specific body"
    verification:
      - kind: unit
        ref: "src/app/(dashboard)/strategies/StrategiesSection.disconnect.test.tsx#StrategiesSection — the Disconnect confirm's states (213-06, UI-SPEC 1.4)"
        status: pass
    human_judgment: false
  - id: D3
    description: "After success a polite announcement is made and focus lands on the next Disconnect control, else the page heading, never body"
    verification:
      - kind: unit
        ref: "src/app/(dashboard)/strategies/StrategiesSection.disconnect.test.tsx#StrategiesSection — after a successful Disconnect (213-06, UI-SPEC 1.5)"
        status: pass
    human_judgment: false
  - id: D4
    description: "AllocatorExchangeManager behaviour and its allocator-delete-* test ids are unchanged after the extraction"
    verification:
      - kind: unit
        ref: "src/components/exchanges/AllocatorExchangeManager.test.tsx and AllocatorExchangeManager.feeds.test.tsx (both pass unedited)"
        status: pass
    human_judgment: false
  - id: D5
    description: "Visual adequacy of the confirm (long key labels wrapping in the Modal title, spacing) and the focus ring on the heading fallback in a real browser"
    verification: []
    human_judgment: true
    rationale: "jsdom asserts structure, strings and document.activeElement, not rendered wrapping or the visible focus treatment; the UI-SPEC long-text and focus-ring treatment needs a human look."

duration: 35min
completed: 2026-11-14
status: complete
---

# Phase 213 Plan 06: Disconnect an orphan key from its row Summary

**A "No strategy yet" row's Disconnect now opens a Cancel/Disconnect-only confirm that calls the owner-scoped `disconnect_allocator_api_key` RPC with that row's key id, keeps the key row, refreshes the page, announces the result and parks focus on a real control.**

## Performance

- **Duration:** about 35 min (start time not recorded at launch; estimate)
- **Completed:** 2026-11-14
- **Tasks:** 3 (Tasks 2 and 3 as RED then GREEN)
- **Files modified:** 5 (2 created, 3 modified)

## Accomplishments

- Extracted `FEEDS_UNCHECKED_COPY`, `FEEDS_UNREADABLE_NAME`, `FEEDS_READ_BOUND_MS`, `parseKeyFeed`, `readJson`, `readKeyFeedsForConfirm`, `DeleteFeedsState` and `deleteFeedsNote` byte-for-byte into `src/components/exchanges/key-feeds-confirm.ts` (all exported, because the unextracted all-keys `readKeyFeeds` and the `KeyFeedsLine` still use `readJson`, `parseKeyFeed` and the two copy constants). `AllocatorExchangeManager` imports them back; its `allocator-delete-*` test ids are untouched and both of its test files pass unedited. The `console.error` prefix strings are unchanged (grep found no test pinning them outside the manager).
- `StrategiesSection` holds a `disconnectTarget` (`{ id, exchangeLabel, keyLabel }` only, resolved against the same `placeholderKeys` that rendered the row; a miss opens nothing) and mints `onDisconnect`. `DisconnectKeyConfirm` is mounted only while a target is set, keyed by its id.
- The confirm: title `Disconnect {Exchange} · {label}?` through the Modal `title` prop; allocator/both body sentence verbatim, manager-only sentence per UI-SPEC 1.4; the shared feeds note in `data-testid="allocator-delete-feeds"`; `Retry` only while unchecked; the `role="alert"` line; `Cancel` and `Disconnect` (`variant="danger"`), the latter disabled while the feeds read is open or the request is in flight, labelled `Disconnecting…` in flight. An unreadable read does not hold Disconnect.
- On success: confirm closes, `router.refresh()`, a polite `LiveRegion` (mounted unconditionally) announces `{Exchange} · {label} is disconnected. You can connect this account again.`, and focus moves to the neighbouring row's Disconnect control, else the first `h1` (given `tabIndex=-1` if it has none). `PageHeader` was not edited.

## Task Commits

1. **Task 1 (tracer): end-to-end Disconnect from the row** - `0dba4aad2` (feat)
2. **Task 2 RED: failing tests for retry, error, in-flight, role bodies** - `45cfb52a9` (test)
3. **Task 2 GREEN: Retry, alert line, in-flight lock, manager body** - `b1795bf0e` (feat)
4. **Task 3 RED: failing tests for announcement and focus** - `0f856f1ac` (test)
5. **Task 3 GREEN: announcement, focus move, degrade-scan ledger row** - `f01ddd2b8` (feat)

Tracer gate: auto/default mode, `<verify>` is automated-only. Re-run at the end of the plan (the plan-level verify below), passing: `⚡ Tracer verified end-to-end — expanding`.

Staging note: the tracer slice (Task 1) deliberately shipped the target state, the feeds read and note, the held-while-reading Disconnect, the two buttons, the RPC and the refresh. Retry, the error line, the in-flight lock and the manager body were left to Task 2, so Task 2's tests could fail on a real gap against UI-SPEC 1.4 rather than pass on code Task 1 had already written.

## Verification

- Task 1 verify (4 files): 150 tests passed, including the new test file in the reported list.
- `npx vitest run "src/app/(dashboard)/strategies" src/components/exchanges src/components/strategy src/__tests__/key-storage-census.test.ts`: 130 files, 2635 tests passed.
- `npx vitest run src/__tests__` (the census directory): 187 files passed, 18 skipped (not mine), 5214 tests passed.
- `src/lib/wizardErrors.roster-render.test.tsx`, `phase-149-my-strategies-parity`, `audit-coverage`, `dollar-validation` and `src/app/api/keys`: passed.
- `npx tsc --noEmit -p tsconfig.json`: exit 0. `npm run lint`: 0 errors, 4 warnings (all in files this plan did not touch).
- `git diff --stat "$(git merge-base origin/main HEAD)" -- supabase/`: prints nothing (SC-5; no migration).
- Acceptance greps: `"disconnect_allocator_api_key"` quoted literal in `StrategiesSection.tsx`, comments excluded: 1 (HEAD was 0). `function readKeyFeedsForConfirm` in `AllocatorExchangeManager.tsx`: 0 (HEAD was 1).
- `node scripts/verify-plan-anchors.mjs` on this plan: OK, 7 claims.

## SC-6 neuter protocol (byte backup in the scratchpad, `cp` restore, `shasum -a 256` matched the backup after every restore)

| Fix | Neuter | Test seen RED | Failure line |
|-----|--------|---------------|--------------|
| RPC name (Task 1, sha `1b48df58…`) | `"disconnect_allocator_api_keyX"` | `TRACER: the row's Disconnect opens a confirm that disconnects that exact key through the RPC and refreshes the page`, and `the second row's Disconnect targets the second key` | `AssertionError: expected "vi.fn()" to be called with arguments: [ Array(2) ]` |
| Exactly two buttons (Task 1) | a third footer `Delete key` button | `TRACER: …` | `AssertionError: expected [ Array(3) ] to deeply equal [ 'Cancel', 'Disconnect' ]` |
| Held while reading (Task 2, sha `3282e4da…`) | `disabled={loading}` (drop the `checking` hold) | `CONFIRM-HELD-WHILE-READING: Disconnect stays disabled until the feeds read answers` (and `CONFIRM-RETRY`) | `AssertionError` on `expect(confirmDisconnect()).toBeDisabled()` |
| In-flight guard (Task 2) | drop `if (loading) return;` from `close` | `IN-FLIGHT: the label reads Disconnecting…, the buttons are locked, and Esc and the close button are ignored` | `AssertionError` (dialog gone after the ignored Esc and close) |
| Role body (Task 2) | `{true` in place of `{allocatorBody` | `ROLE BODIES: allocator furniture gets the source confirm's sentence, a manager-only page gets the manager sentence` | `TestingLibraryElementError: Unable to find an element with the text: We'll stop using this key. It stays on your account, marked disconnected, …` |
| Focus move (Task 3, sha `24042aa6…`) | the effect returns before focusing | `ANNOUNCES politely, and focus lands on the remaining row's Disconnect control, …` and `FOCUS FALLBACK: with no row left, focus goes to the page heading …` | `AssertionError: expected <body><div><h1></h1> …` (activeElement is body) |
| Announcement (Task 3) | `<LiveRegion message={null} />` | the same two Task 3 cases | `AssertionError` on the status region's text |

## TDD Gate Compliance

Plan type is `execute` with `tdd="true"` on Tasks 2 and 3, so the gate is advisory. RED then GREEN commits exist in order for both:

- **Task 2:** RED `45cfb52a9`. Five target tests failed on the planned assertions: `Unable to find an accessible element with the role "button" and name "Retry"` (two cases), `Unable to find an accessible element with the role "alert"`, `Unable to find an accessible element with the role "button" and name "Disconnecting…"`, `Unable to find an element with the text: We'll stop using this key. It stays on your account…`. None was an import, syntax or fixture fault. Three further cases in the same RED commit passed at RED time by design (held-while-reading, stale-answer-dropped, never-deletes): they pin behaviour the tracer slice already shipped, and their RED evidence is the neuter table above. GREEN `b1795bf0e`: 11/11.
- **Task 3:** RED `0f856f1ac`. Three failures: `Unable to find an accessible element with the role "status"` (two cases: the region did not exist) and `AssertionError: expected <body><div><h1></h1>…` (focus on body). GREEN `f01ddd2b8`: 14/14. The `tdd-red-evidence` classifier record was not produced (plan is not `type: tdd`); the semantic assessment above stands in for it.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] The degrade-warning scan ledger had no row for `StrategiesSection.tsx`**
- **Found during:** Task 3 wider run (`src/__tests__`, after the Task 1 to 3 changes)
- **Issue:** `src/__tests__/degrade-warning-scan.test.ts` walks `src/app/(dashboard)/strategies` and fails on an unledgered file with a warning-styling hit: `StrategiesSection.tsx: unledgered file has 1 warning-styling hits, ledger pins 0`. The hit is the confirm's `text-warning` class on the unreadable-feeds note.
- **Fix:** added a ledger row (`tripHits: 1`, no registry ids, reason stated: it is the shared key-feeds-confirm line, warns only, never holds the reversible Disconnect, not registered by this plan).
- **Files modified:** `src/__tests__/degrade-warning-scan.test.ts` (not in the plan's `files_modified`)
- **Verification:** 23/23 in that file; full `src/__tests__` run green.
- **Committed in:** `f01ddd2b8`

---

**Total deviations:** 1 auto-fixed (1 blocking). **Impact:** a ledger count that has to move with a new warning-styled element; no scope creep.

Task 1 left the degrade-scan census red between `0dba4aad2` and `f01ddd2b8` (the same pattern plan 04 recorded for `page.key-pill.test.tsx`); the branch is green at `f01ddd2b8`.

## Issues Encountered

- `ROADMAP.md` progress was not updated via `roadmap update-plan-progress` (optional per the dispatch contract, and known to rewrite unrelated sections); the records PR owns it. `requirements.mark-complete` skipped: SC-2 and SC-6 are phase success criteria, not REQUIREMENTS.md ids. STATE.md and state.json untouched per the contract.
- Real-browser caveat (carried from the source confirm, not introduced here): `Modal` exposes no cancel hook, so on Esc during an in-flight request the native `<dialog>` closes visually while the host keeps the target. The state guard is what is pinned.

## Known Stubs

None.

## Threat Flags

None. The confirm adds no endpoint: it calls the existing `disconnect_allocator_api_key` RPC (ownership decided by `auth.uid()` server-side, T-213-14) and the existing ownership-checked memberships route (T-213-16), and the host imports no delete path (T-213-15, pinned by the two-button and NEVER DELETES tests).

## Next Phase Readiness

Plan 04's `onDisconnect` slot is now wired, so Disconnect is reachable in the running app for every role that lists an orphan. The legend line (UI-SPEC 1.6) and the `KEY_ORPHANED` copy (plan 05) are not part of this plan. Founder review flags from UI-SPEC: the title carrying the key label, the manager-only body sentence, and the focus target after success (all implemented as specified).

## Self-Check: PASSED

Created files exist (`key-feeds-confirm.ts`, `StrategiesSection.disconnect.test.tsx`); modified files exist; commits `0dba4aad2`, `45cfb52a9`, `b1795bf0e`, `0f856f1ac`, `f01ddd2b8` are ancestors of HEAD; frontmatter `commits: 5` measured from the plan ledger (`git rev-list --count 2159eeacd..HEAD`).

---
*Phase: 213-keyflow-a-key-and-its-draft-can-never-be-silently-mixed-up-a*
*Completed: 2026-11-14*
