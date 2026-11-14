---
phase: 213-keyflow-a-key-and-its-draft-can-never-be-silently-mixed-up-a
plan: 07
subsystem: wizard-errors
tags: [key-orphaned, disconnect, copy, legend, create-with-key, vitest]

requires:
  - phase: 213-keyflow
    provides: "213-02 create-with-key route and test; 213-03 wizardErrors.ts; 213-04 listing of every non-disconnected orphan; 213-06 Disconnect control on the placeholder row"
provides:
  - "KEY_ORPHANED cause and fix[1..3] name the Disconnect control on the 'No strategy yet' row (UI-SPEC Surface 2)"
  - "Route-level proof that a disconnected key stops refusing its account and the api_keys row is kept"
  - "Legend no_strategy_yet definition is the UI-SPEC 1.6 sentence"
  - "Dated CORRECTED notes on every stale KEY_ORPHANED docblock claim"
affects: [213 verification, founder review of KEY_ORPHANED wording]

actuals:
  tokens: 9500
  tasks: 3
  commits: 3
plan_head_before: a99162e5c3f5a27b0eef3705b9feef3f9e6581a4
plan_head_after: 5e00e0b2743fe284d6b29ccea69fc95dea920b74
commits: 3

tech-stack:
  added: []
  patterns:
    - "A stateful fake that models the route's filters and the DB's partial unique index independently, so a neutered filter changes what the route observes"

key-files:
  created: []
  modified:
    - src/lib/wizardErrors.ts
    - src/lib/wizardErrors.test.ts
    - src/app/api/strategies/create-with-key/route.ts
    - src/app/api/strategies/create-with-key/route.test.ts
    - src/app/(dashboard)/strategies/StrategiesLegend.tsx
    - src/app/(dashboard)/strategies/StrategiesLegend.test.tsx

key-decisions:
  - "The way-out case asserts what the route observes (the fence read carries disconnected_at null and goes on to issue no strategy or membership read), because the outcome alone (200, not KEY_ORPHANED) is identical with the filter removed: an unfiltered fence finds the disconnected key, classifies it orphaned, and the pre-RPC fence lets an orphan through to an RPC that the index no longer refuses."
  - "The retired role-conditional pin ('names it conditionally', matches if) is superseded, not deleted: the page is reachable by every role now, and the one condition still true (Finish setup only where the row offers it) is pinned as 'where that row offers'."
  - "KEY_REUSE_UNAVAILABLE's docblock paragraph that says every reader of that refusal is an allocator from /my-strategies is also stale (Phase 199 plus plan 04) but belongs to another entry; left untouched."

requirements-completed: []

coverage:
  - id: D1
    description: "After Disconnect the same account is not refused as KEY_ORPHANED through create-with-key, and the api_keys row is kept with disconnected_at set; before the disconnect it is refused"
    requirement: SC-2
    verification:
      - kind: unit
        ref: "src/app/api/strategies/create-with-key/route.test.ts#the way out opens: after Disconnect the same account is not refused as KEY_ORPHANED"
        status: pass
    human_judgment: false
  - id: D2
    description: "KEY_ORPHANED names the Disconnect control on the 'No strategy yet' row, keeps title, docsHref and actions, and points nowhere unreachable (no Profile to API keys)"
    requirement: SC-2
    verification:
      - kind: unit
        ref: "src/lib/wizardErrors.test.ts#[Phase 213 decision (b)] names the Disconnect control on the 'No strategy yet' row, and no unreachable Profile → API keys remedy"
        status: pass
      - kind: unit
        ref: "src/lib/wizardErrors.test.ts#names what the reads measured: a stored key on this account that no strategy uses (final sentence superseded by Phase 213 decision (b))"
        status: pass
    human_judgment: false
  - id: D3
    description: "Legend no_strategy_yet reads the UI-SPEC 1.6 sentence"
    requirement: SC-2
    verification:
      - kind: unit
        ref: "src/app/(dashboard)/strategies/StrategiesLegend.test.tsx#the PIPELINE group (199-14 task 2; the no_strategy_yet definition superseded by Phase 213 decision (b))"
        status: pass
    human_judgment: false
  - id: D4
    description: "No file under supabase/ changed in the phase (SC-5)"
    requirement: SC-5
    verification:
      - kind: other
        ref: "git diff --stat \"$(git merge-base origin/main HEAD)\" -- supabase/ prints nothing"
        status: pass
    human_judgment: false
  - id: D5
    description: "Exact wording of the KEY_ORPHANED cause and fix lines and the legend sentence (Claude's discretion in CONTEXT)"
    verification: []
    human_judgment: true
    rationale: "UI-SPEC Founder Review items 2 and 7 flag this copy for founder review; tests pin the text, not whether it reads well."

duration: 4min
completed: 2026-11-14
status: complete
---

# Phase 213 Plan 07: The KEY_ORPHANED way out Summary

**KEY_ORPHANED now sends the reader to the "Disconnect" control on the Strategies page's "No strategy yet" row, a stateful route test proves a disconnected key stops refusing its account while the row is kept, and the legend explains the row's two actions.**

## Performance

- **Duration:** about 4 min wall clock by the host clock (start 2026-11-14T16:35Z, end 16:39Z)
- **Tasks:** 3 (Task 1 tracer)
- **Files modified:** 6

## Accomplishments

- Way-out proof (decision (b), UI-SPEC backstop row "Disconnect then reconnect"): the new route case holds one live strategy-less `api_keys` row for an MT5 account, POSTs and gets 409 `KEY_ORPHANED`, stamps `disconnected_at` the way the RPC does, POSTs again and gets 200 with the create RPC called, the fence having issued no strategy or membership read, and the row still in the fake with `disconnected_at` set and no write verb dialled on `api_keys`. Database-layer half is the existing SQL arm 6b of `supabase/tests/test_api_keys_venue_identity_uniq.sql` (CI `sql-tests`); no SQL file added.
- `KEY_ORPHANED` `cause` and `fix[1..3]` are the UI-SPEC Surface 2 strings. `title`, `fix[0]`, `docsHref`, `actions` and both `⛔` comments are untouched (`git diff` shows no `actions:` line). No Profile to API keys line (CONTEXT F3).
- Dated `⛔ CORRECTED 2026-11-14 (Phase 213 decision (b))` notes beside the `allocatorOnly` bullet, the allocator-guard and `is_active` / `sync_status` claims (this closes the plan 04 hand-off), and the "nothing we ship lets an owner of ANY role release their own stored key" sentence. The old sentences are kept as lineage. Same treatment in `route.ts` (comment only, at the `handleReuseExistingKey` docblock) and in two `route.test.ts` / `wizardErrors.test.ts` docblocks.
- Legend `no_strategy_yet` is the UI-SPEC 1.6 sentence and its pin moved with it.

## Task Commits

1. **Task 1 (tracer): way out opens, row kept** - `5289380c1` (test). Tracer gate: auto-style run with an automated-only `<verify>`; re-run at the end of the plan together with Tasks 2 and 3 (see Verification), passing. `route.ts` adds comment lines only (checked: no added line outside `//` / `*`).
2. **Task 2: KEY_ORPHANED copy and stale docblocks** - `7181c3342` (feat)
3. **Task 3: legend definition** - `5e00e0b27` (feat)

## Verification

- All three task verify commands, run together: 7 files, 670 tests passed (`route.test.ts` 168, plus `wizardErrors.test.ts`, `wizardErrors.invariant.test.ts`, `wizardErrors.roster-render.test.tsx`, the preselect refusal-class sweep, `key-storage-census.test.ts`, `StrategiesLegend.test.tsx`). Task 2's five-file run: 483 tests passed, 5 files.
- Preselect sweep (`ConnectKeyStep.preselect-refusal-class.test.tsx`) passed with the new copy unedited, so the copy names only painted controls or `KEY_ORPHANED` is outside its derived set; it was not edited either way.
- `npx tsc --noEmit -p tsconfig.json`: exit 0. `npm run lint`: 0 errors, 4 warnings (pre-existing, files this plan did not touch).
- `grep -ac "“Disconnect”" src/lib/wizardErrors.ts`: 1 (HEAD 0).
- SC-5: `git diff --stat "$(git merge-base origin/main HEAD)" -- supabase/` printed nothing.
- `node scripts/verify-plan-anchors.mjs` on this plan: OK, 4 claims.

## SC-6 neuter protocol (byte backup in the scratchpad, `cp` restore, `shasum -a 256` matched after every restore)

| Fix | Neuter | Test seen RED | Failure line |
|-----|--------|---------------|--------------|
| `route.ts` `resolveByVenueIdentity` live-only filter (sha `46d53743…`) | remove `.is("disconnected_at", null)` | `route.test.ts` "the way out opens: after Disconnect the same account is not refused as KEY_ORPHANED" (and the existing "reads the LIVE row only …") | `AssertionError: the fence found a disconnected key and went on to classify it: expected "vi.fn()" to not be called at all, but actually been called 1 times` |
| `wizardErrors.ts` fix[2] naming Disconnect (sha `1d04a969…`) | replace the line with "…choose email us." | `wizardErrors.test.ts` "[Phase 213 decision (b)] names the Disconnect control on the 'No strategy yet' row, and no unreachable Profile → API keys remedy" | `AssertionError: No fix bullet names the “Disconnect” control. … expected undefined to be defined` |
| `wizardErrors.ts` no Profile remedy (same sha) | append "Or disconnect it under Profile → API keys." | same case | `AssertionError: KEY_ORPHANED sends the user to Profile → API keys … expected [ 'profile', 'api keys' ] to deeply equal []` |
| `StrategiesLegend.tsx` new definition (sha `39d9acef…`) | restore the old one-action sentence | `StrategiesLegend.test.tsx` "renders the chips the table renders: the shared base class and the shared label and tone" | `AssertionError: expected [ …(3) ] to deeply equal [ …(3) ]` |

The first neuter was run twice: on the first run the new case was red on its `disconnected_at: null` filter assertion; the assertions were then reordered so the behavioral one (no strategy lookup issued for a disconnected key) fires first, and the table records that run. The way-out case cannot be witnessed red on its status or body assertions: with the filter removed the fence finds the disconnected row, classifies it orphaned, and the pre-RPC fence passes an orphan through to an RPC that the (modelled) index no longer refuses, so the response is the same 200. The read-side assertions are what bite, and the case's docblock says so.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `venueKeyLookupMock` could not see the filters the route applied**
- **Found during:** Task 1
- **Issue:** the plan asks for a fake whose query "actually filters its rows" by `.is("disconnected_at", null)`, but the shared mock was `async () => …` and `makeSelectBuilder` called it with no arguments.
- **Fix:** `makeSelectBuilder` now passes `filters` and the mock accepts an optional `_filters`, the idiom `reuseKeyAdminLookupMock` already uses. Every other case ignores the argument.
- **Files modified:** `src/app/api/strategies/create-with-key/route.test.ts` (in the plan's file list)
- **Verification:** 168 tests pass.
- **Committed in:** `5289380c1`

**2. [Rule 1 - Bug in test premise] The plan's neuter expectation needed a different assertion**
- **Found during:** Task 1 SC-6
- **Issue:** the plan expects the new case to go RED "on its second POST" from the removed filter. Status and body do not change (see the SC-6 note), so asserting only those would have stayed green under the neuter.
- **Fix:** the case also asserts the fence issued no strategy, owner or membership read after the disconnect, and that the key read carried `disconnected_at: null`. That is RED under the neuter.
- **Committed in:** `5289380c1`

**3. [Rule 2 - stale pins on superseded copy] Four `wizardErrors.test.ts` cases moved**
- **Found during:** Task 2
- **Issue:** the cause literal, the IN-02 regex, the "names it conditionally" `\bif\b` pin and the 201 D-07 verbatim sentence all pinned the retired copy.
- **Fix:** updated in place with the supersession stated in each case name and a dated comment; the conditional pin became "where that row offers", and a new case pins the Disconnect naming and the absence of a Profile to API keys remedy (the plan's acceptance bar; the new case is what the Disconnect-line neuter reddens).
- **Files modified:** `src/lib/wizardErrors.test.ts` (the file contains one deliberate NUL byte; edited with a byte-preserving script, count still 1)
- **Committed in:** `7181c3342`

**Total deviations:** 3 (1 blocking, 1 test-premise, 1 stale-pin update). **Impact:** no scope creep; all inside the plan's six files.

## Issues Encountered

- `roadmap update-plan-progress` was not run (optional per the dispatch contract; it is known to rewrite unrelated sections) and `requirements.mark-complete` was skipped: SC-2, SC-5 and SC-6 are phase success criteria, not REQUIREMENTS.md ids. STATE.md and state.json untouched per the contract.

## Hand-offs

- **Founder review:** the exact KEY_ORPHANED cause and fix[1..3] wording (UI-SPEC Founder Review item 2) and the legend sentence (item 7) were taken verbatim from the UI-SPEC.
- **Not touched, still stale:** the `KEY_REUSE_UNAVAILABLE` docblock paragraph arguing that every reader of that refusal is an allocator who arrived from `/my-strategies` (it predates Phase 199 and plan 04). It belongs to a different entry and is outside this plan's scope.

## Known Stubs

None.

## Threat Flags

None. No new endpoint, auth path or schema surface; the copy names no account id or credential (T-213-18, key-storage census passes).

## Next Phase Readiness

SC-2's copy and way-out proof hold; SC-5 holds. Ready for the remaining plans of the phase.

## Self-Check: PASSED

All six modified files exist; commits `5289380c1`, `7181c3342`, `5e00e0b27` are ancestors of HEAD; frontmatter `commits: 3` measured from the plan ledger (`git rev-list --count a99162e5c..HEAD`).

---
*Phase: 213-keyflow-a-key-and-its-draft-can-never-be-silently-mixed-up-a*
*Completed: 2026-11-14*
