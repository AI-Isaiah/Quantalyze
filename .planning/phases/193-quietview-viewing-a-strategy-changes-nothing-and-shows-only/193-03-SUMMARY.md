---
phase: 193-quietview-viewing-a-strategy-changes-nothing-and-shows-only
plan: 03
subsystem: ui
tags: [factsheet, view-state, localStorage, url, d-02, trust-02]

requires: []
provides:
  - "FactsheetProvider: the visible range is session-local; a legacy ?range= and a stored range are never applied and are deleted once on hydration; the write effect carries no range and does not depend on xRange"
  - "factsheetViewStateCodec.encode drops the legacy range, so no write can carry one; decode still reads it so hydration can detect it"
affects: [193-05 range label and reset, phase 194 full-history views]

actuals:
  tokens: 4300
  tasks: 2
  commits: 2
plan_head_before: 20514ec49ecbc9a47e82345607525aeb846272bd
plan_head_after: e6348eb3b88f290eaa7fbfeb873d8b95de7f789d

tech-stack:
  added: []
  patterns: ["legacy persisted field kept decode-only so hydration can purge it; the purge goes through the storage primitive (removeStored / setValue), never raw localStorage"]

key-files:
  created: []
  modified:
    - "src/app/factsheet/[id]/v2/factsheet-context.tsx"
    - "src/app/factsheet/[id]/v2/factsheet-context.provider.test.tsx"
    - "src/app/factsheet/[id]/v2/factsheet-context.codec.test.ts"
    - "src/app/(dashboard)/allocations/widgets/performance/ScenarioFactsheetChart.tsx"

key-decisions:
  - "The codec and the factsheet-v2: key stay; range stays in PersistedState and parsePersistedFields as a decode-only legacy field, encode drops it (deleting the codec would reset every user's comparator and toggles)"
  - "The purge sits behind the hydration effect's own persist gate, so the scenario composer (persist=false) neither reads nor purges"

patterns-established:
  - "Failing assertions must not leak spies: a spy created inside the test and restored in afterEach"

requirements-completed: [TRUST-02]

duration: 15min
completed: 2026-11-07
status: complete

coverage:
  - id: D1
    description: "A legacy ?range= and a stored range are never applied (the range reads the full history) and both are deleted on hydration; cmp, cb, reg and dark survive and a stored cmp is still adopted"
    requirement: "TRUST-02"
    verification:
      - kind: unit
        ref: "src/app/factsheet/[id]/v2/factsheet-context.provider.test.tsx#Case A (ordering): a legacy ?range= AND a stored range are both deleted, neither applied; cmp/dark survive (D-02)"
        status: pass
      - kind: unit
        ref: "src/app/factsheet/[id]/v2/factsheet-context.provider.test.tsx#Case C: a blob whose only field is a legacy range is removed (key gone), nothing rewritten"
        status: pass
    human_judgment: false
  - id: D2
    description: "A pan writes no ?range= and no range field (no replaceState, no setItem); the pan itself still moves the in-memory range"
    requirement: "TRUST-02"
    verification:
      - kind: unit
        ref: "src/app/factsheet/[id]/v2/factsheet-context.provider.test.tsx#Case B: a pan writes neither a ?range= nor a range field (D-02)"
        status: pass
    human_judgment: false
  - id: D3
    description: "The codec decodes a legacy range but encode never writes one; a range-free blob round-trips byte for byte"
    requirement: "TRUST-02"
    verification:
      - kind: unit
        ref: "src/app/factsheet/[id]/v2/factsheet-context.codec.test.ts#encode never writes the legacy range (D-02)"
        status: pass
    human_judgment: false
  - id: D4
    description: "Empty visitor makes no storage write or removal and no replaceState; persist=false neither reads nor purges"
    requirement: "TRUST-02"
    verification:
      - kind: unit
        ref: "src/app/factsheet/[id]/v2/factsheet-context.provider.test.tsx#Case D (empty visitor, HEAD-green pin)"
        status: pass
      - kind: unit
        ref: "src/app/factsheet/[id]/v2/factsheet-context.provider.test.tsx#Case E (persist={false}, HEAD-green pin)"
        status: pass
    human_judgment: false
  - id: D5
    description: "In a real browser, a reload or a later visit with a range saved by an older build reads Full history, and the stored range is gone"
    requirement: "TRUST-02"
    verification: []
    human_judgment: true
    rationale: "The plan carries this as a backstop truth (UI-SPEC I-3, E2 partial); the label itself is plan 193-05 and a real older-build browser profile is not reproducible here"
---

# Phase 193 Plan 03: QUIETVIEW session-local range Summary

**The factsheet's visible range is now session-local: every visit opens the full history, a pan or reset writes nothing, and a range an older build saved (URL or stored blob) is deleted once on load through the storage primitive, while comparator and display-toggle persistence is unchanged.**

## Performance

- **Duration:** about 15 min
- **Started:** 2026-11-07T03:05Z (approx.)
- **Completed:** 2026-11-07T03:20Z (SUMMARY committed after)
- **Tasks:** 2
- **Files modified:** 4 (0 created, 4 modified)

## Accomplishments

- Hydration effect: the `range` read, parse and `setXRangeRaw` call are gone. After the `!persist` gate, a `?range=` is deleted from the URL (pathname, remaining params and hash kept) with one `replaceState`, and a stored `range` is removed: `removeStored(EMPTY_PERSISTED)` when it was the only field, otherwise `setStoredView(<the rest>)`. `cmp`, `cb`, `reg` and `dark` reads are unchanged, and the URL still wins over storage for them.
- Write effect: `range` is out of the persisted state, the `fullRangeStr` constant and both range query-param lines are gone, and `xRange` is out of the dependency array.
- `factsheetViewStateCodec.encode` destructures `range` away as `_legacyRange`, so no caller can write a range. `PersistedState.range` and `parsePersistedFields` keep it as a decode-only legacy field.
- Comments updated in `factsheet-context.tsx` (header "Persistence:", `PersistedState`, `parsePersistedFields`, `encode`, the `persist` prop doc, two stale mentions of a sibling writing `?range`) and the persist=false bullet in `ScenarioFactsheetChart.tsx`.

## Task Commits

1. **Task 1: Tracer, the provider purge and range-free write path (RED first)** - `c1f05917c` (feat)
2. **Task 2: Remaining edges, range-dropping encode, comments, neuter and pin mutants** - `e6348eb3b` (feat)

**Plan metadata:** the SUMMARY commit that follows this file (docs).

## RED-first, neuter and pin-mutant runs

- **Task 1 RED** (tests added, no source change): provider file `3 failed | 11 passed`.
  Case A: `AssertionError: expected '10-120' to be '0-199'` (the stored range was applied).
  Case B: `AssertionError: expected "replaceState" to not be called at all, but actually been called 1 times`.
  Case C: `AssertionError: expected "vi.fn()" to be called with arguments: [ 'factsheet-v2:test-strategy' ]` (no removal).
  GREEN after the fix: `14 passed (14)`.
- **Task 2 RED** (codec arms added, encode unchanged): `2 failed | 10 passed`.
  `encode never writes the legacy range (D-02)`: `expected '{"range":"3-42","cmp":"btc","cb":"1"}' to be '{"cmp":"btc","cb":"1"}'`.
  Repointed `encode omits off (undefined) toggle keys`: `expected '{"range":"0-9","cmp":"none"}' to be '{"cmp":"none"}'`.
- **Neuter** (pre-fix provider `factsheet-context.pre` copied over, both files run): `5 failed | 21 passed`; the five failures are Cases A, B, C and both RED codec arms. The four pins pass as at HEAD. Restored from `factsheet-context.post`, `cmp` equal, rerun `26 passed (26)`.
- **HEAD-green pins, named:** (1) Case D (empty visitor), (2) Case E (`persist={false}`), (3) the codec legacy decode case `decodes a pre-B7 unversioned blob as 'ok' and still surfaces its legacy range`, (4) `encode(decode(blob).value) reproduces a range-free canonical blob byte-for-byte`. Cases D and E were also run in isolation against HEAD bytes and passed.
- **Gate-bypass mutant (Case E):** `grep -ac '^ *if (!persist) return;$'` printed 1. `diff` against `.post` showed exactly the one removed line. Provider file result: `2 failed | 12 passed`. Case E failed on `expected '{"cmp":"spx"}' to be '{"range":"10-120","cmp":"spx"}'` (the purge ran for a `persist={false}` mount), and the older `persist={false} gates BOTH reads and writes` case also failed (`expected 'none' to be 'btc'`). Restored from `.post`, `cmp` equal.
- **Unconditional URL-purge mutant (Case D):** `grep -acF 'params.has("range")'` printed 1. `diff` showed exactly one changed line (`(params.has("range") || true)`). Result: `2 failed | 12 passed`. Case D failed on `expected "replaceState" to not be called at all, but actually been called 1 times`; Case C failed the same way. Restored from `.post`, `cmp` equal.

Scratch copies live outside the repo, in the session scratchpad under `193/` (`factsheet-context.pre`, `.post`, `.mutE`, `.mutD`).

## Final gates

- `npx vitest run` on the provider, codec, `FactsheetBody.guard04-no-bleed`, `SignOutButton` files: 4 files, 32 tests passed, 0 failed, 0 skipped.
- `npx vitest run src/app/factsheet "src/app/(dashboard)/allocations/widgets/performance" "src/app/(dashboard)/allocations/components/ScenarioComposer"` (every neighbour that mounts this provider, including the scenario composer): 130 files, 2155 tests passed, 0 failed, 0 skipped. The plan names "ScenarioFactsheetChart tests"; no test file carries that name, so the files that import the chart or the composer were run instead.
- `npx tsc --noEmit`: exit 0, no output.
- `npm run lint`: 0 errors, 2 warnings, both unused-variable warnings in files this plan did not touch (`MetricsColumn.tsx`, `src/lib/factsheet/composite-read-path.ts`; pre-existing, out of scope). The planning-hygiene, route and domain checks that follow ESLint all printed OK.
- Plan Task 1 and Task 2 acceptance greps: `removeStored` present; `params.set("range"`, `const rangeRaw` and `}, [xRange, comparator` absent; `_legacyRange` present; the composer comment no longer names `?range=`; the provider byte-matches `.post`.

## Decisions Made

None beyond the plan: D-02 and the codec-stays decision were settled in CONTEXT and the plan.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Test spies leaked across cases in the D-02 describe**
- **Found during:** Task 1 (RED run)
- **Issue:** A first draft restored the `replaceState` spy only at the end of each test and then lost its `afterEach` restore in an edit. A spy left installed by a failed case collected the next case's URL reset, so Case D read as red at HEAD although it is HEAD-green in isolation.
- **Fix:** each case creates the spy inside the test, before render (so the file-level URL reset is never counted), and one `afterEach` restores it whether the assertions passed or not.
- **Files modified:** `src/app/factsheet/[id]/v2/factsheet-context.provider.test.tsx`
- **Commit:** `c1f05917c`

**2. [Rule 3 - Lint] The `react-hooks/set-state-in-effect` disable comment moved**
- Anticipated by plan step 4: with the range block gone, the rule named `setComparator`, so the existing hydration-pattern disable comment now sits on that line. Nothing else changed to satisfy lint.
- **Commit:** `c1f05917c`

**3. Two extra comment corrections (no behaviour)**
- Two comments said the sibling Overview factsheet writes `?range` to the `/allocations` URL (the persist prop doc and the RT2 hydration comment), and one named a "URL full-range sentinel" on `fullRange`. All three are false after D-02 and were corrected in the same file the plan already edits. `src/app/factsheet/[id]/v2/factsheet-context.codec.test.ts`'s header comment was corrected the same way.
- **Commit:** `e6348eb3b`

**Total deviations:** 3 (1 test-harness bug, 1 anticipated lint move, 1 comment pass). **Impact:** none on the plan's behaviour or scope.

## Issues Encountered

None open. Cases A, B and C wait on real 250 ms timers (400 ms sleeps), as the plan specifies; the provider file runs in about 3 s.

## Known Stubs

None.

## Threat Flags

None. The change removes a read of a user-controlled query parameter and a storage field; it adds no endpoint, auth path or schema. T-193-06 (a crafted `?range=` link shows the full history) and T-193-07 (the stored blob is purged and `encode` cannot write `range`) are covered by Cases A and C and the codec arm; T-193-08 is unchanged (`stripPoisonKeys` still runs in `decode`, existing `__proto__` case green).

## Human check still open (backstop)

On a browser profile that holds a `factsheet-v2:<id>` blob with a `range` saved by an older build, and on a link carrying `?range=`, a reload should open the full history, drop `range` from the address bar (other params and the hash kept), and drop it from the blob in devtools (the key itself when it was the only field). The visible label wording belongs to plan 193-05. Not run here: it needs an older-build browser profile.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

SC-2 second half is done. Plan 193-05 (range label and reset) can rely on the range always starting at the full history. STATE.md and ROADMAP.md were not touched, per the orchestrator's instruction.

## Self-Check: PASSED

- FOUND: `src/app/factsheet/[id]/v2/factsheet-context.tsx`, `factsheet-context.provider.test.tsx`, `factsheet-context.codec.test.ts`, `src/app/(dashboard)/allocations/widgets/performance/ScenarioFactsheetChart.tsx`
- FOUND commits: `c1f05917c`, `e6348eb3b` (ancestors of HEAD)

---
*Phase: 193-quietview-viewing-a-strategy-changes-nothing-and-shows-only*
*Completed: 2026-11-07*
