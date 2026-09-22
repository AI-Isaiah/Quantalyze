---
phase: 167-credtrust
plan: 06
subsystem: ui
tags: [react, credential-trust, sync-status, api-keys, a11y, gap-closure]

# Dependency graph
requires:
  - phase: 167-03
    provides: "the sign_in_failed pill style and its authored helper in AllocatorSyncStatus, and the isUntrustedKeySyncStatus partition in closed-sets"
  - phase: 167-04
    provides: "the daily-poll writer that stamps sign_in_failed, and residual 2 (the D-16 class) whose ApiKeyManager half this plan closes"
provides:
  - "a manager-role owner sees the persisted untrusted credential state (Sign-in failed / Key revoked + authored helper) on that key's own card on /strategies/[id]/edit"
  - "coexistence rules R1-R6 between that pill and the card's local SyncProgress panel: no claim under a spinner, no success beside a failed sign-in, no remedy re-shows one, no key rotated or deleted during its own sync, no dead-locked controls after a failed post-add sync"
  - "167-CONTEXT D-18, which closes RESEARCH Open Question 2, a dated 167-UI-SPEC S1b amendment with a complete 9-state table, and a 167-VALIDATION row"
affects: [167-VERIFICATION, gsd-ship CHANGELOG cross-check]

# Actuals (chars/4 over the realized diff, the same scale as the plan's estimate)
actuals:
  tokens: 13403
  tasks: 3
  commits: 3
  plan_head_before: d565e864033ca4ca81937d7c019774b7a33ca428

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "A shared, guarded, FUNCTIONAL event-handler update (retireWithheldSuccess) instead of an effect or mirrored state: its guard is the derivation from the render the user clicked in, and its updater leaves every in-flight value alone."
    - "Close an overlap window with a key-scoped disabled prop read from an in-flight marker that already exists, rather than recording the attempt's inputs."
    - "An invariant that disables read is only as sound as every path that clears the marker. Enumerate the error transitions and make each one clear it."

key-files:
  created:
    - .planning/phases/167-credtrust-an-invalid-venue-credential-is-named-to-the-custom/167-06-SUMMARY.md
  modified:
    - src/components/strategy/ApiKeyManager.tsx
    - src/components/strategy/ApiKeyManager.test.tsx
    - .planning/phases/167-credtrust-an-invalid-venue-credential-is-named-to-the-custom/167-CONTEXT.md
    - .planning/phases/167-credtrust-an-invalid-venue-credential-is-named-to-the-custom/167-UI-SPEC.md
    - .planning/phases/167-credtrust-an-invalid-venue-credential-is-named-to-the-custom/167-VALIDATION.md

key-decisions:
  - "The manager-role surface is the ApiKeyManager key card on /strategies/[id]/edit (D-18). RESEARCH Open Question 2 is closed; the /profile Exchanges tab stays allocator-only and no factsheet path is touched."
  - "Only the untrusted partition mounts on the card. Every trusted-or-neutral status, error and rate_limited included, stays unrendered there."
  - "R4 and R5 disables are key-scoped (syncingKeyId === key.id), not !!syncingKeyId, and carry no status conjunct."

# ⛔ D-15b: this plan's `requirements:` are PHASE-LOCAL decision ids that collide with the global
# REQUIREMENTS.md ledger. Deliberately NOT copied into a requirements-completed field, matching
# 167-01…05. Never run requirements.mark-complete with them.

coverage:
  - id: D1
    description: "A manager's sign_in_failed / revoked key shows the existing pill and authored helper inside its own card, beside the control that fixes it; healthy statuses and null render nothing new; the raw sync_error never renders; one live region per untrusted card"
    verification:
      - kind: unit
        ref: "src/components/strategy/ApiKeyManager.test.tsx#[167-06] the persisted credential state renders on the manager's key card"
        status: pass
    human_judgment: false
  - id: D2
    description: "The card and the local sync panel never contradict each other (R1-R6)"
    verification:
      - kind: unit
        ref: "src/components/strategy/ApiKeyManager.test.tsx#coexistence with the local sync panel (R1-R6, D-18)"
        status: pass
    human_judgment: false
  - id: D3
    description: "The card renders legibly at 320px and at 200% zoom in the edit page's narrower column"
    verification: []
    human_judgment: true
    rationale: "Verification human item 4 (320px / 200% zoom render) is a visual check no unit test asserts; it now also covers this card."
  - id: D4
    description: "Whether PLACEMENT (the strategy's own edit page, current key marked) is enough to satisfy goal truth 1 without a strategy-level causal sentence"
    verification: []
    human_judgment: true
    rationale: "A goal-adequacy judgment for re-verification. The only other routes are a founder override or a new phase building a strategy-level write boundary."

# Metrics
duration: 21min
completed: 2026-09-22
status: complete
---

# Phase 167 Plan 06: The manager's key card shows the persisted sign-in state — Summary

**A manager-role owner's `sign_in_failed` (or `revoked`) key now shows the existing amber "Sign-in failed" pill and "Update this account's credentials — they may have changed." on its own card on `/strategies/[id]/edit`, next to `Update password`. Six coexistence rules keep that pill and the card's local sync panel from ever contradicting each other.**

## Performance

- **Duration:** 21 min
- **Started:** 2026-09-22T22:50:08Z
- **Completed:** 2026-09-22T23:11:33Z
- **Tasks:** 3 of 3
- **Files modified:** 5, plus this SUMMARY

## Commits (for `/gsd-ship`'s CHANGELOG cross-check, which closes verification gap 2)

| # | sha | theme |
|---|---|---|
| 1 | `8fcab363` | **New capability** — the manager's key card mounts the existing `AllocatorSyncStatus` for an untrusted key (gap 1) |
| 2 | `76140dd7` | **Behaviour change + bug fix** — coexistence rules R1–R6 with the local `SyncProgress` panel; R6 removes a HEAD dead-lock after a failed post-add sync |
| 3 | `decfea65` | **Docs** — 167-CONTEXT D-18, the 167-UI-SPEC S1b amendment and a 167-VALIDATION row |
| 4 | this SUMMARY's commit | **Docs** — plan 167-06 SUMMARY |

## Accomplishments

- **Gap 1 closed at the surface.** `ApiKeyManager` mounts the locked `AllocatorSyncStatus` on a key card only when `isUntrustedKeySyncStatus(key.sync_status)`. It authors no copy, colour or component, and it touches no factsheet path.
- **R1:** while a key's own sync is in flight, its card shows the neutral `Syncing…` pill with a silent helper. The block stays mounted, so the live-region node is stable.
- **R2:** the panel's terminal-success render is withheld while its subject key is untrusted on the server. The error render is kept, and nothing is withheld in flight.
- **R3/R5:** one shared helper, `retireWithheldSuccess`, runs from three event handlers: the dialog's `onUpdated`, `handleDeleteKey`'s success path, and `handleAddKey` after the link. A withheld success is retired rather than re-shown once the key is fixed, deleted or superseded. The guard comes from the pre-change render, and the updater is functional.
- **R4:** a key's `Update password` is disabled for exactly its own sync. `Modal`'s `showModal()` stops the reverse order (pinned by a spy).
- **R5:** a key's `Delete` is disabled for exactly its own sync, for R4's reason.
- **R6:** `handleAddKey`'s background catch now also clears `syncingKeyId`. ⛔ **CORRECTED 2026-09-23 (167-06 fix round, see the section below):** that clear could end a DIFFERENT, still-live attempt (167-REVIEW-06 CR-01). The catch now leaves a live attempt alone; only the attempt clears its own marker.

## RED evidence (verdicts and counts only)

**Task 1, Step 1, at base `d565e864`:** 3 of 13 new cases failed: both untrusted cases and the live-region case. The 8 healthy controls and 2 leak cases passed, as the plan predicted, which is why they are proven by neuters.

**Task 2, Step 1, measured against the Task 1 commit `8fcab363`:** 9 of 15 new cases failed. They were in-flight, terminal `complete`, terminal `complete_with_warnings`, remedy after a withheld success, rotation blocked, remedy by Delete, remedy by Add Key, Delete blocked, and the R6 marker case. Six passed there:
- the three controls and the remedy-during-flight case, as the plan predicted;
- the stable-node and terminal-error cases, which the plan predicted RED (see Deviations).

### Neuters N1–N23

Protocol for each: `cp` a byte backup, apply one exact single-match edit, run the whole test file, `cp` back, then `cmp` (identical every time). Each row names the cases that went RED.

| N | neuter | RED (failed / 57, or / 42 for Task 1) | failing case(s) |
|---|---|---|---|
| N1 | mount condition constant `false` | 3 / 42 | both untrusted cases, live-region case |
| N2 | mount condition constant `true` | 9 / 42 | all 8 healthy controls, live-region case |
| N3 | render `key.sync_error` in the wrapper | 2 / 42 | both leak cases |
| N8 | wrapper gets `role="status"` | 1 / 42 | live-region case |
| N4 | drop the in-flight override | 1 | R1 in flight |
| N5 | mount also requires not-in-flight | 2 | R1 in flight, R1 stable live region |
| N6 | drop the R2 conjunct | 5 | R2 complete, R2 complete_with_warnings, R3 remedy, R5 remedy by Delete, R5 remedy by Add Key |
| N7 | withhold whenever the subject is untrusted (terminal-success test replaced by `true`) | 12 | incl. R1 in flight (its `sync-progress` assertion), R1 stable, R2 terminal error |
| N9 | `onUpdated` a no-op | 4 | R3 control, R3 remedy, R3 during flight, plus the pre-existing 164.5.3 "successful password update calls loadKeys()" case |
| N10 | `onUpdated` back to a bare re-read (drop R3) | 1 | R3 remedy after a withheld success |
| N11 | the updater ignores `prev`, always `idle` | 1 | R3 remedy during flight |
| N12 | drop the helper's untrusted-subject guard | 3 | all three controls (Update password, Delete, Add Key) |
| N13 | remove `Update password`'s `disabled` | 2 | R4 rotation blocked, R6 marker (its in-flight precondition) |
| N14 | widen it to `!!syncingKeyId` | 2 | R4 rotation blocked, R3 during flight |
| N15 | `Modal.tsx`: non-modal open instead of `showModal()` | 1 | R4 rotation blocked (the spy assertion). `Modal.tsx` restored by `cmp`; the Task 2 untouched-path diff was then empty |
| N16 | key the disable to `lastAttemptedKeyId` | 3 | R4 rotation blocked, R3 remedy, R3 control |
| N17 | remove the call in `handleDeleteKey` | 1 | R5 remedy by Delete |
| N18 | replace it with a guard re-derived from the filtered list | 1 | R5 remedy by Delete |
| N19 | remove `Delete`'s `disabled` | 2 | R5 Delete blocked, R6 marker (precondition) |
| N20 | widen it to `!!syncingKeyId` | 1 | R5 Delete blocked |
| N21 | key it to `lastAttemptedKeyId` | 2 | R5 Delete blocked, R5 remedy by Delete |
| N22 | remove the call in `handleAddKey` | 1 | R5 remedy by Add Key |
| N23 | remove R6's marker clear | 1 | R6 marker case |

All 23 neuters were observed RED and restored byte-identical.

## Gate tails (pasted)

- Task 1 verify: `Test Files  2 passed (2)` / `Tests  91 passed (91)` / `OK`. It was re-run after commit as the tracer gate, with the same result.
- Task 2 verify: `Test Files  6 passed (6)` / `Tests  225 passed (225)`, then `tsc --noEmit` and eslint clean, then `untouched-paths diff, must be empty:` (empty) / `OK`.
- Task 3 verify: `d18 True s1b True val True placeholder_hits 0` / `Task 1 commit: 8fcab363 | on the first-parent chain: True | commits from it to HEAD: 3 | paths: 5`, the five `files_modified` paths, then `[check-planning-hygiene] OK — … none carry the local username or an absolute home path …` / `OK`.
- `npm run lint`: exit 0. It printed `[check-admin-route-manifest] OK`, `[check-route-contract] OK` and `[check-planning-hygiene] OK`.
- Full suite, `npm run test:coverage`: `Tests  15123 passed | 280 skipped`, and `Test Files  1 failed | 863 passed | 19 skipped`. The one failing file is environmental (see Issues). Re-run with coverage reported on failure: All files 87.25 statements / 82.12 branches / 84.31 functions / 89.23 lines. Every metric clears the `vitest.config.ts` thresholds, and no threshold error was printed.
- `complete-status-scan` and the roster-render census are green and unedited. `ApiKeyManager.tsx` still carries exactly 1 exact-match comparison against the complete status.
- No verify string had to be split. All three ran exactly as written and the worktree guard accepted them.

## Residuals and limits, restated

- **Placement, not copy.** The sentence names the credential and the remedy. It does not say "your factsheet stopped updating because…". The tie to the factsheet is PLACEMENT: the strategy's own edit page, with its current key marked by `Resync`. No signal ties a strategy's staleness to a key's failure (D-02, D-03). If re-verification judges placement insufficient for goal truth 1, the routes left are a founder override or a new phase that builds a strategy-level write boundary.
- **R4 closes the in-flight rotation window.** Lineage: plan revision 1 said closing it needed an attempt-tied record. That was wrong. The window exists only if the attempt and the rotation overlap, and existing state prevents the overlap.
- **R5 extends the retirement to `Delete` and `Add Key`, and `Delete` takes R4's in-flight disable.** Lineage: plan revision 2 retired on `Update password` only, so a withheld success re-appeared once its key was deleted or superseded.
- **R6 clears the marker in the post-add background catch.** At HEAD, a post-add sync that failed while another key's sync was in flight left every `Resync` and `Use & Sync` disabled until a reload. ⛔ **CORRECTED 2026-09-23:** R6 was right about the dead-lock and wrong that clearing the marker was safe. The plan's rationale, that once the marker is clear the abandoned attempt cannot show a success "because nothing polls it any more", fails when the post-add failure lands while the tracked attempt is still awaiting its own enqueue: its 202 then resumes polling with no marker. See the correction section below.
- **Healthy-key behaviour changes, stated rather than implied.** A key's `Update password` and `Delete` are disabled during that key's own sync, as its `Resync` already was. R6 changes behaviour only in the race where HEAD dead-locked. Otherwise a healthy key's card and panel behave as before, including across an `Update password`, a `Delete` of another key and an `Add Key`, as the three controls pin.
- **Named residual 1: the post-add sync bypasses the one sync slot.** `handleAddKey` moves the panel's subject to the new key while another key's attempt may still be polling. Between two healthy keys this shows as a premature "Up to date". ⚠️ **The UNTRUSTED-key variant can show a success beside a "Sign-in failed" pill.** Key J is untrusted and syncing. The user adds a key, `lastAttemptedKeyId` moves to the healthy new key, and J's later success then shows beside J's pill. R6 closes the dead-lock half. The subject half needs the post-add sync routed through the tracked slot, which changes the add flow `SEAMUX-05` pins. It stays routed, not fixed. ⭐ **NARROWED 2026-09-23:** the subject no longer moves while a tracked attempt is live, so this untrusted-key variant is closed. What remains (routed to 167.2) is that the post-add sync is still outside the slot: its failure while another attempt is live reaches only the console, and its own outcome is never polled.
- **The `handleAddKey` guard can be stale.** It reads the subject's trust status as of the submit click. A re-read landing during the validate or link awaits can make it stale. Only a success line is affected, because the updater is functional. This is recorded in the call-site docblock and in D-18.
- **Named residual 2: a change made in another tab arrives only through a re-read.** That is the load-error `Retry`, or the terminal-success arm's re-read, and either can lift R2's withhold. Closing it is a redesign of R2.
- **167-04-SUMMARY residual 2, partially closed.** The `ApiKeyManager` half is closed: the component answers the persisted status through `isUntrustedKeySyncStatus`, and its `SyncProgress` check against `idle` was always local state. `HoldingsTabPanel`'s `keyStatusById` stays open and out of scope.
- **Verification human item 4 now also covers this card.** That is the render at 320px and at 200% zoom. This card's column is narrower than the `/profile` table.

## Correction 2026-09-23 — the 167-06 fix round (167-REVIEW-06 and the silent-failure review)

⛔ **The sections above are the record as shipped and are kept as lineage.** This section says what
was wrong in them and what replaced it.

**The root cause, one defect with two routes.** The in-flight marker `syncingKeyId`, and the
terminal handling in `handleSyncStatusChange`, were scoped to no attempt, so something that did not
belong to the tracked sync could end it. The attempt then ran on in `computing` with no marker, and
R1's, R4's and R5's windows re-opened for its own key.
- **Route A (167-REVIEW-06 CR-01):** R6's marker clear in the post-add background catch ended a
  different attempt that was still awaiting its own enqueue.
- **Route B:** `SyncProgress` polls while `syncing`, before the attempt's own `/api/keys/sync` has
  answered, so a slow enqueue let the poll read the strategy's PREVIOUS analytics row and its
  terminal status ended the attempt. This one pre-dates 167-06; it is recorded in D-18's R4 lineage.

**The fix, inside `ApiKeyManager` only.** A `SyncAttempt` record is registered in `handleSyncTrades`
before any await. `endAttempt` is the one place the marker is cleared, and it acts only for the
live attempt. `handleSyncStatusChange` ignores every poll status until the attempt's own enqueue
has resolved, and ignores reads while a terminal success's re-read settles. The post-add catch never
touches a live attempt, and `handleAddKey` no longer moves `lastAttemptedKeyId` while one is live.
`SyncProgress` and `useStrategySyncPoller` are unchanged: the in-component fix closes Route B,
because the component can tell a pre-enqueue read from a post-enqueue one and the poller cannot.

**Also fixed in the round:** the healthy-control case now asserts zero live regions on and inside
each healthy card (WR-01); a terminal success is shown only after its re-read, and a failed
re-read keeps it withheld and shows the load-error banner; that banner shows while the Add Key form
is open; `Delete` requires exactly one removed row; the bottom error line is hidden only when it
repeats the error panel's message. IN-01 and IN-02 are comment corrections. The regression cases,
their neuters and the gate tails are in the fix round's own report and commit.

**Named limits of the scoping, not fixed** (D-18): a stale read AFTER the enqueue, before the worker
writes `computing`, can still end an attempt with the previous run's result (pre-existing; needs a
`computed_at` comparison in the poll); and an enqueue that never answers now spins until the route's
`maxDuration` ends it, because the poll's cap arrives pre-enqueue and is ignored.

## Decisions Made

- The orchestrator's two info-level notes were applied as doc-only edits:
  - (a) D-18 and this SUMMARY state the untrusted-key variant of the post-add residual.
  - (b) The `handleAddKey` call site of `retireWithheldSuccess` carries a docblock line recording that its guard reads trust status as of the submit click. It sits beside the cross-tab residual.
- `requirements-completed` is deliberately omitted, per D-15b. That matches 167-01…05.

## Deviations from Plan

**1. [Ordering] Task 2's implementation was written before its tests, and its RED was measured afterwards against the Task 1 commit.**
- **Found during:** Task 2.
- **What was done:** I backed up the implemented `ApiKeyManager.tsx`, put the Task 1 committed version in place, ran the new cases (9 of 15 RED, listed above), and restored the implementation with `cp`, verified by `cmp`.
- **Why it still counts:** the measurement is the same one Step 1 asks for, "which cases fail at the Task 1 commit". Every new assertion is also independently proven by N4–N23.
- **Commit:** `76140dd7`.

**2. [Plan expectation corrected] Two cases the plan listed as RED at the Task 1 commit pass there.**
- **The stable-node case:** Task 1 already mounts the block statically, so the node is trivially stable before R1. It is proven able to fail by N5.
- **The terminal-error case:** the plan listed it in neither group. Task 1 already renders both regions on error. It is proven able to fail by N7.
- Neither is a test defect. The prediction was.

**3. [Rule 2, test hygiene] Two test cases carry more than the plan specified.**
- `rotate()` and `deleteKey()` assert the dialog actually OPENED before submitting. Without that, a disabled card button (N14, N16, N21) could still reach an always-rendered dialog body in jsdom.
- The R4 spy asserts `showModal` was called on the Update password dialog specifically (`mock.contexts`), not merely called.

---

**Total deviations:** 3. One was an ordering deviation, with RED measured equivalently. One corrects the plan's prediction and changes no behaviour. One strengthens test hygiene.
**Impact on plan:** none on scope. Every file stayed within `files_modified`.

## Issues Encountered

- **`src/__tests__/gdpr-export-coverage-hook.test.ts` fails at module load in this worktree.** It checks for the pinned tsx at `<worktree>/node_modules/.bin/tsx` by ABSOLUTE path. A harness worktree has no `node_modules` of its own, because packages resolve by walking up. The file runs 0 tests and throws `MEASURE_FAIL` before any arm. This plan does not cause it and does not touch it.
  - It is not recorded in `deferred-items.md`: that would add a sixth path to this plan's commits, against the five-path contract Task 3's verify pins.
  - It is surfaced here instead for the orchestrator. In the main checkout, where `node_modules/.bin/tsx` exists, the suite should load normally.
- `npm run test:coverage` exits 1 because of that one file. Vitest then skips the coverage report by default, so the thresholds were measured on a second run with the coverage report forced on failure.

## User Setup Required

None. No external service configuration is required.

## Next Phase Readiness

- Gap 1 is closed at the surface, and gap 2 (the stale CHANGELOG entry) is left to `/gsd-ship`'s CHANGELOG mechanism. The commit table above is the checklist it maps.
- Re-verification should judge the placement-not-copy residual (coverage D4) and run human item 4 on this card (D3).

## Self-Check: PASSED

- All five modified files were FOUND on disk.
- Commits `8fcab363`, `76140dd7` and `decfea65` were FOUND in `git log`.
- The Task 3 verify confirmed that the commits from Task 1 to HEAD touch exactly the five `files_modified` paths. None of the three other-phase working-tree files entered any commit.

---
*Phase: 167-credtrust*
*Completed: 2026-09-22*
