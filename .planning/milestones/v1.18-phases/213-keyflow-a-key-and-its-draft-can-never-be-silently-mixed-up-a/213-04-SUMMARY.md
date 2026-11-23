---
phase: 213-keyflow-a-key-and-its-draft-can-never-be-silently-mixed-up-a
plan: 04
subsystem: ui
tags: [strategies-page, placeholder-rows, api-keys, orphan-keys, react, vitest]

requires:
  - phase: 213-keyflow
    provides: "CONTEXT decision (b): list every orphan the venue fence refuses as KEY_ORPHANED, for every role"
provides:
  - "deriveStrategylessKeys lists every non-disconnected orphan; StrategylessKey carries finishSetupEligible and syncStatus"
  - "/strategies reads strategyless keys for manager, allocator and both; portfolio read stays allocator-only"
  - "StrategyTable placeholder row: optional onDisconnect prop, Finish setup only where eligible, revoked pill"
affects: [213-06 disconnect confirm and RPC call in StrategiesSection, 213-05 KEY_ORPHANED copy rewrite]

actuals:
  tokens: 5600
  tasks: 3
  commits: 5
plan_head_before: df94b178f296083b148441e328fd9ab548c37ecc
plan_head_after: db6c0b54b901e78c6a6682115324f4679a62d5c6

tech-stack:
  added: []
  patterns:
    - "A predicate that used to be a list filter rides each row as a boolean flag when the list must widen but a control must not"
    - "Optional host callback prop: absent means byte-identical markup, so public mounts and pinned fixtures stay untouched"

key-files:
  created: []
  modified:
    - src/lib/queries.ts
    - src/lib/queries.my-strategies.test.ts
    - src/app/(dashboard)/strategies/page.tsx
    - src/app/(dashboard)/strategies/page.merged.test.tsx
    - src/app/(dashboard)/strategies/page.key-pill.test.tsx
    - src/components/strategy/StrategyTable.tsx
    - src/components/strategy/StrategyTable.pending-chip.test.tsx
    - src/components/strategy/StrategyTable.default-mounts.test.tsx

key-decisions:
  - "Finish setup is NOT offered on a newly listed inactive or revoked orphan (flagged for founder review): the reuse arm would accept the key, but a draft over it is skipped by every cron dispatcher and never syncs."
  - "Finish setup is kept on eligible rows for a manager-only account (flagged for founder review, RESEARCH Open Question 4): no role gate exists on the routes the overlay calls and it finalizes to private."
  - "The pill is pillOnly with syncStatus alone (syncError and lastSyncAt null), because StrategylessKey carries neither; no new projection. exchange is passed as the row's exchangeLabel, which pillOnly never renders."
  - "isPerKeyDailiesEligibleKey is untouched; it is the cross-language mirror of the Python backfill."

requirements-completed: []

coverage:
  - id: D1
    description: "A manager's revoked or inactive orphan key appears on /strategies as a No strategy yet row (every role reads strategyless keys; every non-disconnected orphan listed)"
    verification:
      - kind: unit
        ref: "src/lib/queries.my-strategies.test.ts#lists every non-disconnected orphan; only a disconnected key is excluded (superseded by Phase 213 decision (b))"
        status: pass
      - kind: unit
        ref: "src/app/(dashboard)/strategies/page.merged.test.tsx#a manager's page reads the strategyless keys (superseded by Phase 213 decision (b)), renders their placeholder rows, and makes no portfolio read"
        status: pass
    human_judgment: false
  - id: D2
    description: "The placeholder row can carry a Disconnect control named for its row; Finish setup only on eligible rows; revoked pill; public and pinned owner mounts byte-identical"
    verification:
      - kind: unit
        ref: "src/components/strategy/StrategyTable.pending-chip.test.tsx#StrategyTable Phase 213 (b) — placeholder row variants"
        status: pass
      - kind: unit
        ref: "src/components/strategy/StrategyTable.default-mounts.test.tsx#the owner mount with onDisconnect passed differs from the pinned mount only in the placeholder Actions cell"
        status: pass
    human_judgment: false
  - id: D3
    description: "Visual adequacy of the new Actions cell (Disconnect beside Finish setup, muted treatment, one-line row) in a real browser"
    verification: []
    human_judgment: true
    rationale: "No test asserts rendered appearance; the UI-SPEC 1.2/1.3 treatment needs a human look. The control is not reachable end to end until plan 06 passes onDisconnect from the client host."

duration: 25min
completed: 2026-11-14
status: complete
---

# Phase 213 Plan 04: Orphan keys listed for every role, placeholder row ready for Disconnect Summary

**/strategies now lists every non-disconnected orphan key for manager, allocator and both, and the "No strategy yet" row can carry a Disconnect control named for its key (the confirm and RPC are plan 06).**

## Performance

- **Duration:** about 25 min (start time not recorded at launch; estimate)
- **Completed:** 2026-11-14T15:57Z
- **Tasks:** 3 (Task 2 as RED then GREEN)
- **Files modified:** 8

## Accomplishments

- `deriveStrategylessKeys` filters on `disconnected_at == null` (the venue fence's live-key test) instead of `isPerKeyDailiesEligibleKey`. Inactive and revoked-but-connected orphans are listed; disconnected keys are not. The predicate rides each row as `finishSetupEligible`, and `syncStatus` rides beside it. The predicate body is untouched (diff against merge-base shows no change to it).
- The page calls `getStrategylessActiveKeys(user.id)` for every role in one `Promise.all` with the allocator-only `getRealPortfolio`. A manager makes no portfolio read. A `null` read still renders the degrade line (T-199-25).
- `StrategyTable` placeholder row: optional `finishSetupEligible?` / `syncStatus?` on `PlaceholderKeyRow`, optional `onDisconnect?` on the props. Without `onDisconnect` the Actions cell is byte-identical (the pinned owner-mount string is unchanged). With it, the ranked rows' `flex flex-nowrap items-center justify-end gap-3 whitespace-nowrap` container holds `Finish setup →` (only if `finishSetupEligible !== false`) then a `GHOST_ROW_ACTION` button, visible text `Disconnect`, `aria-label` `Disconnect {Exchange} · {label}`, never disabled. An untrusted `syncStatus` shows the existing `AllocatorSyncStatus` static key pill in the strategy cell.

## Task Commits

1. **Task 1 (tracer): manager's revoked orphan appears** - `67479c23f` (feat)
2. **Task 2 RED: failing tests for the row variants** - `da16ba891` (test)
3. **Task 2 GREEN: Disconnect slot, eligibility gate, pill** - `ab505ba40` (feat)
4. **Task 2/1 follow-up: key-pill suites answer the new read** - `4909a98a4` (test)
5. **Task 3: page row facts reach the table; zero-orphan manager** - `db6c0b54b` (test)

Tracer gate: auto/default mode with an automated-only `<verify>`; re-run at the end of the plan, passing (see Verification). Task 1's own verify (3 files, 95 tests) passed before its commit.

## Verification

- `npx vitest run src/lib/queries.my-strategies.test.ts "src/app/(dashboard)/strategies" src/components/strategy src/__tests__/phase-149-my-strategies-parity.test.ts src/lib/queries.test.ts`: 123 files, 2530 tests passed (phase-149 pin 8 included).
- `npx tsc --noEmit -p tsconfig.json`: exit 0, no output.
- `npm run lint`: 0 errors; 4 warnings, all in files this plan did not touch (`composite-read-path.ts`, `queries.stale-analytics-detail.test.ts`).
- `git diff --stat "$(git merge-base origin/main HEAD)" -- supabase/`: prints nothing (SC-5).
- `node scripts/verify-plan-anchors.mjs` on this plan: OK, 6 claims.

## SC-6 neuter protocol (byte backup in the scratchpad, `cp` restore, `shasum -a 256` matched after every restore)

| Fix | Neuter | Test seen RED | Failure line |
|-----|--------|---------------|--------------|
| `queries.ts` widened list filter (sha `3d204f10…`) | restore `.filter(isPerKeyDailiesEligibleKey)` | `queries.my-strategies.test.ts` "lists every non-disconnected orphan; only a disconnected key is excluded (superseded by Phase 213 decision (b))" | `AssertionError: expected [ 'eligible' ] to deeply equal [ 'inactive', 'revoked', 'eligible' ]` |
| `page.tsx` ungated placeholder read (sha `66270796…`) | restore `isAllocator ? getStrategylessActiveKeys(...) : []` | `page.merged.test.tsx` "a manager's page reads the strategyless keys (superseded by Phase 213 decision (b)), renders their placeholder rows, and makes no portfolio read" | `AssertionError: expected last "vi.fn()" call to have been called with [ 'u-1' ]` |
| `StrategyTable.tsx` eligibility gate (sha `e0741d82…`) | render Finish setup regardless (`true ? (`) | `pending-chip.test.tsx` "an ineligible key with onDisconnect shows Disconnect only, no Finish setup" (and "without onDisconnect an ineligible row renders no control at all") | `AssertionError: Old key: expected <button type="button" …(1)></button> to be null` |
| `StrategyTable.tsx` click wiring | `onClick={() => {}}` in place of `onDisconnect(p.id)` | `pending-chip.test.tsx` "clicking Disconnect calls onDisconnect with that row's key id" | `AssertionError: expected "vi.fn()" to be called 1 times, but got 0 times` |
| `page.tsx` row-field pass-through (sha `66270796…`) | drop `finishSetupEligible` / `syncStatus` from `placeholderRows` | `page.merged.test.tsx` "Phase 213 (b): a revoked orphan reaches the rendered table with the static key pill and no Finish setup; …" | `TestingLibraryElementError: Unable to find an element by: [data-testid="allocator-sync-pill-static"]` |

TDD gate for Task 2: RED commit `da16ba891` (7 pending-chip cases plus the default-mounts case failing on the planned assertions: `Unable to find an accessible element with the role "button" and name …Disconnect…`, `expected <button> to be null`, `Unable to find an element by: [data-testid="allocator-sync-pill-static"]`, `expected [] to deeply equal [ 5 ]`; none were import, syntax or fixture faults), then GREEN `ab505ba40`. Plan type is `execute`, so the `tdd-red-evidence` classifier record was not produced; the semantic assessment above stands in for it.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `page.key-pill.test.tsx` broke on the manager page's new read**
- **Found during:** Task 2 (wider run of `src/app/(dashboard)/strategies`, after Task 1's page change)
- **Issue:** its comment said "Role is manager in every case below, so the allocator-only reads never run". A manager page now runs the strategyless-key read, whose three tables the suite's Supabase double records, so two call-census cases (`api_keys` six-column allowlist, `strategy_keys` union) failed.
- **Fix:** answered `getStrategylessActiveKeys` with `[]` in the suite's existing `@/lib/queries` mock (the file's own idiom for reads its double does not model) and stated the supersession in the comment, in place.
- **Files modified:** `src/app/(dashboard)/strategies/page.key-pill.test.tsx` (not in the plan's `files_modified`)
- **Verification:** 120 files / 2351 tests in `src/components/strategy` + `src/app/(dashboard)/strategies` passed.
- **Committed in:** `4909a98a4`. Task 1's commit `67479c23f` therefore left that suite red for the two commits between it and this one; the branch is green at `4909a98a4` and after.

---

**Total deviations:** 1 auto-fixed (1 blocking). **Impact:** a consequence of the superseded Phase 199 gate; no scope creep.

## Issues Encountered

- `ROADMAP.md` progress was not updated via `roadmap update-plan-progress` (optional per the dispatch contract, and it is known to rewrite unrelated sections); the records PR owns it. `requirements.mark-complete` skipped: the plan's SC-2 / SC-6 are phase success criteria, not REQUIREMENTS.md ids. STATE.md and state.json untouched per the contract.

## Hand-offs

- **Plan 05 (KEY_ORPHANED copy):** the stale docblock in `src/lib/wizardErrors.ts` (`KEY_ORPHANED` section) still says "`getStrategylessActiveKeys` filters on `is_active` and `sync_status !== "revoked"` … a revoked-but-not-disconnected key is refused here and listed nowhere" and that the page is allocator-guarded. Both are now false (this plan). It is in plan 05's declared scope (dated `CORRECTED 2026-11-14 (Phase 213)` note); this plan did not touch it.
- **Plan 06:** passes `onDisconnect` from `StrategiesSection` and owns the confirm and RPC. Until then no mount passes it, so Disconnect is not yet reachable in the running app.
- **Founder review flags:** the two `Finish setup →` measured decisions above.

## Known Stubs

None. (`onDisconnect` is deliberately an optional prop with no host yet; plan 06 wires it.)

## Threat Flags

None. The only new read surface is `getStrategylessActiveKeys` for manager accounts, already covered by T-213-09 (user-scoped client, `.eq("user_id", userId)` and `.eq("owner_id", userId)` unchanged).

## Next Phase Readiness

Ready for plan 06: the table has the `onDisconnect` slot and every role's orphans are listed.

## Self-Check: PASSED

All eight modified files exist; commits `67479c23f`, `da16ba891`, `ab505ba40`, `4909a98a4`, `db6c0b54b` are ancestors of HEAD; SUMMARY frontmatter `commits: 5` measured from the plan ledger (`git rev-list --count`).

---
*Phase: 213-keyflow-a-key-and-its-draft-can-never-be-silently-mixed-up-a*
*Completed: 2026-11-14*
