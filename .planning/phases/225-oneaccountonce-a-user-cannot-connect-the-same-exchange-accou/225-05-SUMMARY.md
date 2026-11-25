---
phase: 225-oneaccountonce-a-user-cannot-connect-the-same-exchange-accou
plan: 05
subsystem: api
tags: [wizard, create-with-key, copy-table, roster, conn-01, once-01]
requires: [225-03, 225-04]
provides:
  - "create-with-key refuses an own-draft account match from another wizard session with 409 VENUE_DRAFT_IN_PROGRESS naming the draft, from both emitting arms, through one builder"
  - "the wizard recognises the code (union, copy entry, naming arm, create-with-key roster, invariant scanner)"
affects: [225-06, 225-07, 225-08, 225-09, 225-11, 225-12]
key-files:
  modified:
    - src/app/api/strategies/create-with-key/route.ts
    - src/app/api/strategies/create-with-key/route.test.ts
    - src/lib/wizardErrors.ts
    - src/lib/wizardKeyRosters.ts
    - src/lib/wizardErrors.invariant.test.ts
    - src/lib/wizardKeyRosters.test.ts
    - src/lib/wizardErrors.roster-render.test.tsx
    - src/lib/wizardErrors.test.ts
    - src/app/(dashboard)/strategies/new/wizard/steps/ConnectKeyStep.test.tsx
key-decisions:
  - "One new wire code VENUE_DRAFT_IN_PROGRESS rather than reusing DRAFT_ALREADY_EXISTS (same-session collision, remedies act on THIS session's draft) or VENUE_ALREADY_CONNECTED (says the account backs a connected strategy, false for a draft)"
  - "actions are request_call + expand_log, never resume_draft/start_fresh: start_fresh would open the delete dialog for a draft that is not the conflicting one"
  - "The draft name rides the SAME draft read (select id, name): no new query. It is trimmed server-side and omitted, not nulled, when blank or non-string"
  - "Not added to ADD_KEY_OWN_CODES: composites are out (F-2 / Q4); a pin asserts add-key does not admit it"
  - "Same-session fence (D1) and the reuse arm (D4, flagged assumption A3) keep their deduped answer"
requirements-completed: [CONN-01, ONCE-01]
status: complete
commits: 2
plan_head_before: ca82717a5
plan_head_after: 2092d1b4ceca3b2634e5534bb88a8a2a33346a65
estimate:
  tokens: 115000
  raw_tokens: 115000
  tasks: 2
  confidence: low
actuals:
  tokens: 10750
  tasks: 2
  commits: 2
metrics:
  completed: 2026-11-24
---

# Phase 225 Plan 05: an own-draft account match is refused by name Summary

**A connect whose account is already in one of the user's own unfinished drafts (a different wizard session) now answers `409 VENUE_DRAFT_IN_PROGRESS` with the draft's name, from both the MT5 pre-validation arm and the 23505 race arm, instead of a silent `200 deduped` that dropped the new key.**

## What changed

- `route.ts`: the `draft` member of `VenueIdentityResolution` carries `strategyName` (non-blank trimmed string, else null); `resolveStrategiesForKey` selects `id, name` on its existing draft read. New `venueDraftInProgressResponse(draftName)` builder (`code` first as a literal, no identity parameter, `strategy_name` omitted when blank). The D2 and D3 `deduped` bodies were replaced by calls to it. `deduped: true` emitters outside comments: 4 to 2 (the session fence and the reuse arm, both unchanged).
- `wizardErrors.ts`: union member with docblock, copy entry (title "This exchange account is already in one of your unfinished drafts."; fix bullets: finish or delete the draft then connect again, connect a different account, contact form with the correlation id before deleting anything; `fixRequires` one slot per bullet), and a code-gated `formatKeyError` arm that prepends `Your unfinished <Exchange> draft "<name>" already uses this account.` (exchange from the closed `EXCHANGE_DISPLAY` record keyed by `context.venue` with an own-property check; no exchange when the venue is absent or unknown; unnamed copy when the name is absent or blank).
- `wizardKeyRosters.ts`: `VENUE_DRAFT_IN_PROGRESS` added to `CREATE_WITH_KEY_OWN_CODES`.
- `ConnectKeyStep.tsx` needed no edit: it already forwards `strategy_name` for any code.
- Tests: five route tests flipped to 409 plus a blank/non-string name test, a trim/verbatim test and a race-arm blank-name test; invariant scanner (`codes409`, `EXPECTED_409_CODES`, emitter floor 6 to 7); frozen create-with-key roster (+1, add-key array unchanged) and an add-key-does-not-admit pin; the two copy-table size pins 103 to 104 (read off the guard's own failure message); the roster-render 409 family regex and emitter-shape fixture; a `formatKeyError` describe block (named, venue-less incl. `constructor`/`__proto__`, blank/missing, quotes and non-ASCII, scoped to the code, no Retry/resume/start_fresh); a ConnectKeyStep render block (named cause, contact and Diagnostics controls, no Retry/Resume/Start-fresh, unnamed degrade, funnel code).

## Deviations from Plan

**1. [Rule 3 - pins the plan did not list] Copy-table size pins in `wizardErrors.test.ts`**
- **Found during:** Task 2 first run (`expected 104 to be 103`, and the lockstep pin `expected 103 to be 104`)
- **Issue:** the copy table is size-pinned twice (TRAP-4 and SEAMUX-04 blocks) and a third test asserts the two literals agree. A new entry moves all three.
- **Fix:** both literals 103 to 104 with dated notes; `wizardErrors.test.ts` was already in Task 2's file list.
- **Commit:** `2092d1b4c`

**2. [Rule 3 - commit ordering] `wizardKeyRosters.test.ts` is red between the two commits**
- The frozen roster pin lives in a Task 2 file, so after the Task 1 commit (`c11af3076`) `wizardKeyRosters.test.ts` fails on `extra: ["VENUE_DRAFT_IN_PROGRESS"]` until `2092d1b4c`. The plan splits the files that way; the pair lands together in PR-2.

**3. Docs-only addition:** the stale WIZCONT-02 comment that said an own draft resolves to `deduped` now names `VENUE_DRAFT_IN_PROGRESS`.

No architectural changes, no auth gates, no checkpoints.

## Verification

- `npx vitest run` over the six touched test files: 6 files, 805 tests pass. Wider sweep (create-with-key, finalize-wizard, composite/add-key, the wizard directory, the seam invariants, the roster and copy-table tests, the preselect overlay): 62 files, 2158 tests pass.
- `npx tsc --noEmit`: clean. `npm run lint`: 0 errors; the 4 warnings are in files this plan did not touch (`MetricsColumn.tsx`, `composite-read-path.ts`, `queries.stale-analytics-detail.test.ts`), so out of scope.
- Acceptance greps: `deduped: true` outside comments = 2 (EXPECT <= 2); `VENUE_DRAFT_IN_PROGRESS` counts: route.ts 2, wizardKeyRosters.ts 1, wizardErrors.ts 3, wizardErrors.test.ts 5, ConnectKeyStep.test.tsx 4.

## PROOF-01 record (neuter, RED, `cp` byte restore, `cmp`, GREEN)

All three run on uncommitted work with `cp` backups in the scratchpad; no git checkout, restore or stash.

**A. D2 pre-validation arm** (restored the silent 200 `deduped` body in that arm only):
```
 × 225-05 CONN-01: same MT5 login + a DIFFERENT wizard_session_id is REFUSED 409 VENUE_DRAFT_IN_PROGRESS naming the own draft, never a silent 200 deduped
 × 225-05 CONN-01: a BLANK, whitespace or non-string draft name OMITS strategy_name (the wizard renders the unnamed sentence)
 × 225-05 CONN-01: the draft's name is trimmed on the wire and carried verbatim otherwise
   × ANTI-REGRESSION: a real DRAFT on the same key is still FOUND and refused by name — the fence was narrowed, not disabled
 Tests  4 failed | 170 passed (174)
RESTORED_BYTE_EQUAL_A   (cmp silent)
```
The zero-write test stays green under this neuter by design: a silent 200 also writes nothing. It pins writes, not the status; the four reds above pin the status.

**B. D3 race arm** (same neuter in the 23505 arm only):
```
 × 225-05 CONN-01: venue-identity constraint + an own DRAFT → 409 VENUE_DRAFT_IN_PROGRESS naming it, not a silent 200 deduped
 × 225-05 CONN-01: the race arm omits strategy_name for a blank draft name
 × 225-05 CONN-01: an own DRAFT on the same account → 409 VENUE_DRAFT_IN_PROGRESS naming it, not a silent 200 deduped
 Tests  3 failed | 171 passed (174)
RESTORED_BYTE_EQUAL_B   (cmp silent)
```

**C. Roster** (removed the code from `CREATE_WITH_KEY_OWN_CODES` in the `cp`-backed file):
```
 × KNOWN_CREATE_WITH_KEY_CODES equals its frozen roster member for member
 × are not equal as sets, in the direction each route's own codes make them differ
 × create-with-key: the tuple is the route's contract
 × every 409 code is a union member AND admitted by ConnectKeyStep's roster
 × renders its OWN title and the draft's name in the cause, never the UNKNOWN dead end
 × offers the contact and log controls and NO Retry, Resume or Start-fresh control
 × a blank or missing name renders the unnamed sentence, never empty quotes
 × the funnel sees the specific code, not UNKNOWN
 Tests  8 failed | 160 passed (168)
RESTORED_BYTE_EQUAL_C   (cmp silent)
```

GREEN after all three restores: 6 files, 805 tests passed.

## Known Stubs

None.

## Threat Flags

None. The only new surface is one more 409 body on an existing route; it carries the caller's own draft name (owner-scoped read) and no login, server or id (asserted in the route tests, T-225-14/T-225-15).

## Ship note for PR-2

The ship deletes `TODOS.md` entry `[167.1.2-DRAFT-CLASH-SAYS-SO]` and names it in the CHANGELOG entry.

## Self-Check: PASSED

- Commits `c11af3076` and `2092d1b4c` are ancestors of HEAD.
- All nine modified files exist; the SUMMARY is committed after this section.
