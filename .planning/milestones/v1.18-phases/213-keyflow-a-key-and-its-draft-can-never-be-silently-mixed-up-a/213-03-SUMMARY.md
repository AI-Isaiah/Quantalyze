---
phase: 213-keyflow-a-key-and-its-draft-can-never-be-silently-mixed-up-a
plan: 03
subsystem: api
tags: [wizard, composite, mt5, error-codes, refusal]
requires: []
provides:
  - "COMPOSITE_MT5_UNSUPPORTED WizardErrorCode with UI-SPEC 3.3 copy, actions [expand_log] (non-recoverable)"
  - "composite/add-key refuses mt5 (any case) ahead of the MT5_ENABLED gate and every rate-limit token, validate, encrypt and RPC"
  - "composite/set-members refuses an owned mt5 key before set_wizard_composite_members; a faulted api_keys read answers 500 UNKNOWN"
affects: [213-12]
tech-stack:
  added: []
  patterns: ["named refusal ahead of a kept-dead tripwire guard", "user-scoped ownership read with explicit tenant filter before an RPC"]
key-files:
  created: []
  modified:
    - src/lib/wizardErrors.ts
    - src/lib/wizardErrors.test.ts
    - src/lib/wizardErrors.invariant.test.ts
    - src/app/api/strategies/composite/add-key/route.ts
    - src/app/api/strategies/composite/add-key/route.test.ts
    - src/app/api/strategies/composite/set-members/route.ts
    - src/app/api/strategies/composite/set-members/route.test.ts
    - src/app/(dashboard)/strategies/new/wizard/steps/MultiKeyConnectStep.tsx
decisions:
  - "Refusal sits immediately after const isMt5, so it also wins over the api_key / api_secret shape guards: a user fixing a missing-field 400 would otherwise hit the refusal next."
  - "The now-unreachable MT5_ENABLED gate and MT5 three-credential guard are KEPT with a dated UNREACHABLE comment as the tripwire (Rule 3, surgical); the add-key invariant site count therefore moves 12 to 13 while the reachable SITES rows move 12 to 11."
  - "set-members: a non-owned id returns no row and stays the RPC's own ownership answer (no ownership oracle); a read fault refuses 500 UNKNOWN, never passes."
  - "COMPOSITE_MT5_UNSUPPORTED is MIRROR_EXEMPT and added to EXPECTED_SPLIT_CODES: only add-key emits it (create-with-key is the single-key route)."
requirements-completed: [SC-3, SC-6]
metrics:
  tasks: 2
  commits: 3
  completed: 2026-11-14
status: complete
actuals:
  tokens: 21500
  tasks: 2
  commits: 3
plan_head_before: 34ea1778cc21345029b50749286409e87f6eea58
plan_head_after: 098797b47ddecef397a75a31dac52c28a9ed8422
commits: 3
coverage:
  - id: D1
    description: "composite/add-key answers 400 COMPOSITE_MT5_UNSUPPORTED for exchange mt5 (any case) with MT5_ENABLED on and off, before any limiter token, validate, encrypt or RPC"
    requirement: SC-3
    verification:
      - kind: unit
        ref: "src/app/api/strategies/composite/add-key/route.test.ts#refuses mt5 with MT5_ENABLED OFF as COMPOSITE_MT5_UNSUPPORTED ... (it.each mt5/MT5/Mt5)"
        status: pass
      - kind: unit
        ref: "src/app/api/strategies/composite/add-key/route.test.ts#refuses mt5 with MT5_ENABLED ON the same way ... (it.each mt5/MT5/Mt5)"
        status: pass
      - kind: unit
        ref: "src/app/api/strategies/composite/add-key/route.test.ts#mt5 is refused as a composite member (Phase 213 decision (c)) -> 400 COMPOSITE_MT5_UNSUPPORTED"
        status: pass
    human_judgment: false
  - id: D2
    description: "The code is a WizardErrorCode with UI-SPEC 3.3 copy, is admitted by both step rosters and renders by name, never UNKNOWN"
    requirement: SC-3
    verification:
      - kind: unit
        ref: "src/lib/wizardErrors.roster-render.test.tsx#multi-key-add/COMPOSITE_MT5_UNSUPPORTED renders its own code, never the UNKNOWN card"
        status: pass
      - kind: unit
        ref: "src/lib/wizardErrors.invariant.test.ts#composite/add-key: every emitted code is admitted by THAT ROUTE's roster, or by the alias table"
        status: pass
    human_judgment: true
    rationale: "The copy ships as UI-SPEC 3.3 wrote it (Claude's discretion, flagged for founder review)."
  - id: D3
    description: "composite/set-members refuses an owned mt5 key before the RPC, and a faulted api_keys read refuses 500 UNKNOWN"
    requirement: SC-3
    verification:
      - kind: unit
        ref: "src/app/api/strategies/composite/set-members/route.test.ts#refuses a member whose owned key is mt5 with 400 COMPOSITE_MT5_UNSUPPORTED - RPC never called"
        status: pass
      - kind: unit
        ref: "src/app/api/strategies/composite/set-members/route.test.ts#FAILS LOUD on a faulted api_keys read: 500 UNKNOWN, and the RPC is never called"
        status: pass
    human_judgment: false
---

# Phase 213 Plan 03: MT5 cannot be a composite member (server half) Summary

Both composite routes now refuse an MT5 key with the named, non-recoverable code `COMPOSITE_MT5_UNSUPPORTED` before any write: `add-key` ahead of its flag gate and every limiter token, validate, encrypt and RPC; `set-members` through a user-scoped `api_keys` exchange read that fails loud on a fault. The multi-key step renders the code by name.

## What changed

- `wizardErrors.ts`: union member with a docblock citing decision (c), and a `WIZARD_ERROR_COPY` entry with the exact UI-SPEC 3.3 title, cause, fix[0], fix[1], `docsHref: "/security"`, `actions: ["expand_log"]` (neither `RECOVERABLE_ACTIONS` member, so `recoverable` derives false; not `request_call`). Not an alias in `SEAM_CODE_TO_WIZARD_CODE`.
- `composite/add-key/route.ts`: `if (isMt5)` returns `{ code, error }` with status 400 and `NO_STORE_HEADERS` immediately after `const isMt5`. The MT5 gate and three-credential guard carry a dated `UNREACHABLE SINCE Phase 213 decision (c), KEPT as the tripwire` comment; the 23505 venue-arm comment now cites decision (c) as the guard that makes "cannot be a composite member" true, old sentence kept as lineage in prose.
- `MultiKeyConnectStep.tsx`: the code added to `KNOWN_ADD_KEY_CODES` and `KNOWN_SET_MEMBERS_CODES` with dated row comments. Nothing else touched (plan 12 owns the roster, footer and `enterMulti`).
- `composite/set-members/route.ts`: after `createClient()` and before `set_wizard_composite_members`, `.from("api_keys").select("id, exchange").in("id", ids).eq("user_id", user.id)`. Read error: 500 `{ code: "UNKNOWN" }`, logged with the correlation id, raw error never forwarded. Any row whose exchange lower-cases to `mt5`: 400 `{ code: "COMPOSITE_MT5_UNSUPPORTED" }`. Missing row: untouched (RPC ownership answer).
- Tests: add-key's three MT5-accepted cases inverted in place and renamed "superseded by Phase 213 decision (c)"; the flag-off `it.each` now expects the refusal, with a sibling `it.each` for `MT5_ENABLED=true`, both asserting the limiter, validate, encrypt and RPC mocks were not called; `SITES` swaps two unreachable MT5 rows for one refusal row (12 to 11) with the by-design count difference stated; set-members gets four cases and a `from` chain on its mock; census literals moved.

## Task commits

1. Task 1 (tracer): `3f9a2e119` (feat)
2. Task 2 RED: `7ffad9052` (test)
3. Task 2 GREEN: `098797b47` (feat)

Tracer gate (HUMAN_VERIFY_MODE end-of-phase, automated-only verify): the Task 1 verify command was re-run before expansion, 9 files, 630 passed.

## Verification

- Task 1 verify command (9 files): 630 passed. Task 2 verify command plus both route tests and the 9 census files (10 files): 642 passed.
- `tsc --noEmit -p tsconfig.json`: clean. `npm run lint`: 0 errors, 4 warnings (all in `queries.stale-analytics-detail.test.ts`, untouched).
- `git diff --stat $(git merge-base origin/main HEAD) -- supabase/`: empty (SC-5). `scripts/verify-plan-anchors.mjs` on the plan: OK, 5 claims.
- Acceptance: non-comment `COMPOSITE_MT5_UNSUPPORTED` count in add-key route.ts and set-members route.ts both at least 1 (HEAD was 0); in add-key the first occurrence precedes the first `isMt5EnabledServer()` use; `decision (c)` count in add-key route.test.ts is 17 (expect at least 4).

## TDD (Task 2)

- RED (`7ffad9052`): three of the four new cases failed against the unchanged route, each on its planned assertion: mt5 case `expected 200 to be 400`; the user-scoped read case `expected "vi.fn()" to be called with arguments: [ 'api_keys' ]`; fault case `expected 200 to be 500`. The fourth (non-owned id stays the RPC's answer) is a no-regression pin and passes before and after by design. Semantic assessment: the target ran and failed on the planned assertion, not on a load, mock or syntax fault (the other 9 tests in the file passed).
- `gsd_run check tdd-red-evidence` could not be satisfied: both the `tap` and `tap-flat` reporters for vitest embed vitest's multi-line assertion message inside the diagnostics block at column 0, which the classifier reports as `Non-TAP data in report` / `Malformed TAP` (`invalid_record`). No fabricated record was submitted; the semantic assessment above stands in. This plan is `type: execute`, so the plan-level gate sequence did not mandate the classifier.
- GREEN (`098797b47`): all 12 set-members tests pass.

## SC-6 neuter evidence (byte backup by cp to a mktemp dir in the scratchpad, restore by cp, shasum equal after every restore)

Task 1 (`MultiKeyConnectStep.tsx` sha 0d351855...; add-key `route.ts` sha 61892831...):

| Neuter | RED observed |
|---|---|
| (i) remove `COMPOSITE_MT5_UNSUPPORTED` from `KNOWN_ADD_KEY_CODES` | `wizardErrors.invariant.test.ts > composite/add-key: every emitted code is admitted by THAT ROUTE's roster, or by the alias table` and `wizardErrors.roster-render.test.tsx > multi-key-add/COMPOSITE_MT5_UNSUPPORTED renders its own code, never the UNKNOWN card` (2 failed; render case: "multi-key-add rendered UNKNOWN for wire code COMPOSITE_MT5_UNSUPPORTED") |
| (ii) delete the add-key refusal | 10 failed in `route.test.ts`: the three inverted acceptance cases, all three flag-OFF `it.each` rows, all three flag-ON `it.each` rows, and the `SITES` row `mt5 is refused as a composite member ... -> 400 COMPOSITE_MT5_UNSUPPORTED` |
| (iii) move the refusal below the `MT5_ENABLED` gate | 4 failed: the three flag-OFF `it.each` rows (`refuses mt5/MT5/Mt5 with MT5_ENABLED OFF as COMPOSITE_MT5_UNSUPPORTED, not the venue-flag code ...`) and the `SITES` row; the flag-ON rows stay green, which is the point of having both states |

Task 2 (set-members `route.ts` sha 177a486a...):

| Neuter | RED observed |
|---|---|
| (i) delete the mt5 check | `refuses a member whose owned key is mt5 with 400 COMPOSITE_MT5_UNSUPPORTED — RPC never called` (1 failed, 11 passed) |
| (ii) read-error branch falls through (`if (false && ownedError)`) | `FAILS LOUD on a faulted api_keys read: 500 UNKNOWN, and the RPC is never called (a read fault never passes)` (1 failed, 11 passed) |

## Deviations from Plan

**1. [Rule 3 - Blocking] `src/lib/wizardErrors.test.ts` edited (not in `files_modified`).** Adding a `WIZARD_ERROR_COPY` entry moved the table size from 101 to 102, which redded three pins there: the two hand-typed `EXPECTED_TABLE_SIZE` declarations (TRAP-4 and SEAMUX-04 describes) and the cross-pin "SAME literal" law. Both literals moved 101 to 102 together, each docblock extended with the dated reasoning (destructive scan: `["expand_log"]` is not destructive; honesty scan: the five forbidden fragments are absent). Values read off the guards' own failure messages. Commit `3f9a2e119`.

**2. [census, expected by the plan] `EXPECTED_SPLIT_CODES` 6 to 7 and `MIRROR_EXEMPT` gains the code**, and add-key `expectedSites` 12 to 13, each with a dated comment. The run matched the plan's expectation exactly (13 sites; split set and mirror law named the new code); no difference to record.

**3. [Rule 2 - precision] The add-key test `SITES` "the split is real" distinct-codes pin** gained `COMPOSITE_MT5_UNSUPPORTED` (five to six codes), and the describe title now reads "all 11 reachable rejection sites (12 until Phase 213 decision (c))".

**Total deviations:** 3 (1 blocking census file outside the files list, 2 expected census moves). **Impact:** none on behaviour; all in tests and census literals.

## Known Stubs

None.

## Threat Flags

None new. T-213-05 and T-213-06 mitigated (refusal before the gate and any write; tenant-filtered read, fault refuses); T-213-07 mitigated (non-owned id keeps the RPC's single answer); T-213-08 accepted as the bounded residual (direct PostgREST insert into `strategy_keys` or a direct `set_wizard_composite_members` call is not fenced, named in both route comments; to be repeated in the CHANGELOG `### Notes` at ship).

## Self-Check: PASSED

Commits 3f9a2e119, 7ffad9052 and 098797b47 are on feat/213-keyflow; all eight modified source and test files exist.
