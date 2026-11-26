---
phase: 238-nevercomputed-a-strategy-that-never-computed-failed-or-stall
plan: 03
subsystem: ui
tags: [factsheet, share-note, copy, degrade, FACT-05, vitest, proof-01]
status: complete
requires: [238-01, 238-02]
provides:
  - "owner pending page note = KCS12_MINT_B_LEAD + DegradeAction(ownerRemedyAction(ownerRemedyLine))"
  - "OwnerUnpublishedPanel shareNote: string | ReactNode"
  - "KCS12-MINT-B retired from the string API; arm-aware public-url answers"
  - "NEVERCOMPUTED grep invariant, DISTINCT_FLOOR 50 -> 73"
affects: []
tech-stack:
  added: []
  patterns:
    - "a page composes lead + action itself; the string API answers the same arm with lead + contact-check so it stays total and true in every state"
key-files:
  created: []
  modified:
    - src/app/factsheet/[id]/v2/page.tsx
    - src/app/factsheet/[id]/v2/FactsheetView.tsx
    - src/app/factsheet/[id]/v2/page.owner-compute-state.test.tsx
    - src/lib/status-surface-copy.ts
    - src/lib/status-surface-copy.test.ts
    - TODOS.md
key-decisions:
  - "The composed-note walk uses every id in ANALYTICS_FAILED_ACTIONS (9: the 8 ownerRemedyAction ids plus the allocator-only A-EXCHANGES-KEY), so 18 composed notes rather than the plan's 16; /strategies can reach the ninth through viewerRemedyAction"
  - "The three lead/unknown constants were moved above MINT_TOKEN_NOTES, because MINT_TOKEN_NOTES now interpolates KCS12_MINT_B_LEAD at module evaluation (a const used before its declaration would throw)"
requirements-completed: [FACT-05]
duration: 22 min
completed: 2026-11-24
commits: 3
plan_head_before: 9375dcc877b92f64803550cda89af0bdcd0a56bc
plan_head_after: 824b4789bd3650fac1959fd45a23298eb099d7eb
actuals:
  tokens: 8600
  tasks: 3
  commits: 3
---

# Phase 238 Plan 03: Owner pending page note, retired KCS12-MINT-B, TODOS deletion Summary

The owner pending page's panel note now names the same action as the page's own KCS-09 remedy line, no input to the share-note string API can return the retired "not available yet ... once a computation succeeds" sentence, and the closed TODOS entry is deleted.

## What was built

- `v2/page.tsx`: for the kind-less `not_available` arm (and not probe-unreadable) the `shareNote` is a node: `KCS12_MINT_B_LEAD`, one space, `DegradeAction` with `id={ownerRemedyAction(ownerRemedyLine)}` and `strategyId={signature.id}`. It maps the SAME `ownerRemedyLine` object the KCS-09 remedy `p` renders. Every other case (probe-unreadable, an unbuildable kind, in-progress, unreadable) keeps its `recipientShareNoteFor` string. No viewer mapping on this lane.
- `v2/FactsheetView.tsx`: `OwnerUnpublishedPanel` `shareNote?: string | ReactNode`. A string keeps `ContactPointerText` with the support `contactHref`; any other truthy value renders as is inside the same `p` (`mt-2 text-fixed-12 text-text-muted`); a falsy value renders no element.
- `status-surface-copy.ts`: `MINT_TOKEN_NOTES.not_available` = `KCS12_MINT_B_LEAD + " " + CONTACT_CHECK_REMEDY.before`; `recipientShareNote` is arm-aware for `public-url` through `PUBLIC_URL_NOTES` (`in_progress` the unchanged KCS12-PUBLIC words, `not_available` the public lead plus contact-check, `unreadable` KCS12-PUBLIC-UNKNOWN). Totality kept with `as const satisfies Record<RecipientArm, string>`. No import from `degrade-warnings`. Docblocks rewritten.
- `status-surface-copy.test.ts`: both leads and KCS12-PUBLIC-UNKNOWN pinned character for character; KCS12-MINT-B / KCS12-PUBLIC pins re-pointed; "H-2 NO FALSE TAIL" extended to the kind-less `not_available` arm of both modes and the public unreadable arm; new `NEVERCOMPUTED grep invariant` describe (each answer and each of the 18 composed notes free of `yet`, `once a computation succeeds`, `appear there`, `wait`; composed notes free of `no computation is running`; no MODES x ARMS x (null + kinds) input returns `RETIRED_MINT_B`; KCS12-PUBLIC old words only for public-url `in_progress`); the walk adds the three constants and the composed notes.
- `page.owner-compute-state.test.tsx`: SHARE-NOTE-B re-pointed (whole sentence typed, className kept, exactly one link, remedy-line parity); SHARE-NOTE-B-SINGLE and SHARE-NOTE-B-NEVER-STARTED added; `MINT_B` renamed `RETIRED_MINT_B` and a `MINT_B_LEAD` literal added; the FULL-RENDER-NO-NOTE loop now also covers the lead.
- `TODOS.md`: the `170.1-STRATEGIES-NOTE-WAIT-WORDING` bullet and its Phase 238 ownership line deleted (3 lines). `grep -rlaI` over the repo outside `.planning`: no other pointer to the id (src, scripts, e2e, docs, CLAUDE.md, AGENTS.md all 0). Remaining mentions are in `.planning` phase artifacts and the v1.20 verification, which are historical records. CHANGELOG, VERSION, package.json untouched (the ship step names the deleted id).

## Commits

- `4710e4359` feat(238-03): owner pending page note names the remedy line's action (Task 1, tracer)
- `e6062ce6c` feat(238-03): retire KCS12-MINT-B from the string API, arm-aware public-url answers (Task 2)
- `824b4789b` chore(238-03): delete the closed 170.1-STRATEGIES-NOTE-WAIT-WORDING TODOS entry (Task 3)

## Verification (measured)

- Tracer verify `npx vitest run "src/app/factsheet/[id]/v2/page.owner-compute-state.test.tsx"`: `Tests  57 passed (57)`.
- Task 2 verify (copy test, degrade-warnings, copy-census, no-email-in-copy, owner test): `Test Files  5 passed (5)`, `Tests  343 passed (343)`.
- PR-1 gate `npx vitest run "src/app/(dashboard)/strategies" src/lib/status-surface-copy.test.ts "src/app/factsheet/[id]/v2/page.owner-compute-state.test.tsx" src/lib/degrade-warnings.test.tsx src/__tests__/degrade-warning-scan.test.ts src/__tests__/copy-census.test.ts src/__tests__/no-email-in-copy.test.ts`: `Test Files  61 passed (61)`, `Tests  1506 passed (1506)`.
- `npx tsc --noEmit`: exit 0. `npm run lint`: exit 0, `0 errors, 4 warnings` (the same four pre-existing warnings 238-01 and 238-02 reported, none in files this plan touched). check-planning-hygiene OK.
- `node scripts/verify-plan-anchors.mjs .../238-03-PLAN.md`: exit 0.
- Acceptance greps: `ownerRemedyAction` in page.tsx 2; `shareNote?: string;` in FactsheetView 0; `is not available. Use the contact form to have it resolved.` in the owner test 1; sentence `its factsheet is not available yet` in non-comment code of the copy module 0; `NEVERCOMPUTED` in the copy test at least 1; `170.1-STRATEGIES-NOTE-WAIT-WORDING` in TODOS.md 0.
- Walk size measured by setting the floor to 9999: `AssertionError: expected 73 to be greater than or equal to 9999`. `DISTINCT_FLOOR` raised from 50 to **73**. With the composed notes dropped (Neuter G) the walk is 57, so the composed notes contribute 16 distinct strings (18 composed, two of which equal the string API's `not_available` answers).
- Nothing skipped. No PROD access.

## PROOF-01

Byte backups of `status-surface-copy.ts`, `status-surface-copy.test.ts` and `v2/page.tsx` in a `mktemp -d` directory outside the repo; restore by `cp`, check by `cmp`; no git checkout, restore or stash used.

### Neuter F (grep invariant): `yet` put back into `KCS12_MINT_B_LEAD`

RED (`npx vitest run src/lib/status-surface-copy.test.ts`, result lines; the lead pin is RED first):

```
     × KCS12-MINT-B-LEAD: the private-link lead, pinned character for character 6ms
     × KCS12-MINT-B retired: the private link's not_available answer is the lead plus the contact-check remedy 1ms
     × mint-token not_available carries none of the wait phrases 1ms
     × mint-token not_available (for, null) carries none of the wait phrases 1ms
     × KCS12-MINT-B-LEAD carries none of the wait phrases 1ms
     × composed note 0 carries none of the wait phrases 0ms
     × composed note 1 carries none of the wait phrases 0ms
     × composed note 2 carries none of the wait phrases 0ms
     × composed note 3 carries none of the wait phrases 0ms
     × composed note 4 carries none of the wait phrases 0ms
     × composed note 5 carries none of the wait phrases 0ms
     × composed note 6 carries none of the wait phrases 0ms
     × composed note 7 carries none of the wait phrases 0ms
     × composed note 8 carries none of the wait phrases 0ms
 Test Files  1 failed (1)
      Tests  14 failed | 122 passed (136)
AssertionError: "yet" in: Right now, a private link to this strategy shows that its factsheet is not available yet. Use the contact form to have it checked.: expected 'right now, a private link to this strategy shows that its factsheet is not available yet. Use the contact form to have it checked.' not to contain 'yet'
```

(The `×` rows are inside the `NEVERCOMPUTED grep invariant` describe; each AssertionError names the offending string, for example `"yet" in: Right now, a private link to this strategy shows that its factsheet is not available yet. Check its key on the Exchanges page.`.)

Restore: `cmp exit 0`. GREEN:

```
 Test Files  1 passed (1)
      Tests  136 passed (136)
```

### Neuter G (walk floor): composed notes dropped from `everyRenderedString()`

RED:

```
     × the walk reached the private tables: the distinct-string count meets the design floor 4ms
AssertionError: expected 57 to be greater than or equal to 73
 Test Files  1 failed (1)
      Tests  1 failed | 135 passed (136)
```

Restore: `cmp exit 0`. GREEN:

```
 Test Files  1 passed (1)
      Tests  136 passed (136)
```

### Neuter H (owner page): the node branch disabled (`false && ...`), so the panel falls back to the arm-only string

RED (`npx vitest run "src/app/factsheet/[id]/v2/page.owner-compute-state.test.tsx"`; SHARE-NOTE-B is RED first):

```
     × SHARE-NOTE-B: a permanently failed job -> the panel's last child is KCS12-MINT-B-LEAD plus the remedy line's own action 13ms
     × SHARE-NOTE-B-SINGLE: a transient failure on a single-key strategy -> the lead plus Resync on the edit page, the same action as the remedy line 4ms
     × SHARE-NOTE-B-NEVER-STARTED: no computation on record, no key -> the lead plus the unlinked remedy's action 3ms
Expected: "Right now, a private link to this strategy shows that its factsheet is not available. Use the contact form to have it resolved."
Received: "Right now, a private link to this strategy shows that its factsheet is not available. Use the contact form to have it checked."
Expected: "Right now, a private link to this strategy shows that its factsheet is not available. Start a new computation with Resync on this strategy's edit page. Use the contact form if it does not complete."
Received: "Right now, a private link to this strategy shows that its factsheet is not available. Use the contact form to have it checked."
 Test Files  1 failed (1)
      Tests  3 failed | 54 passed (57)
```

Restore: `cmp exit 0`. GREEN:

```
 Test Files  1 passed (1)
      Tests  57 passed (57)
```

## Deviations from Plan

**1. [Rule 2 - Missing critical coverage] The composed-note walk covers 9 actions, not 8**
- **Found during:** Task 2
- **Issue:** the plan names 8 reachable action ids and 16 composed notes. `/strategies` can also put `A-EXCHANGES-KEY` after a lead (allocator-only viewer, `viewerRemedyAction`, 238-01 and 238-02), so a walk over 8 ids would leave a reachable sentence unchecked.
- **Fix:** the test iterates `ANALYTICS_FAILED_ACTIONS` (every id `ownerRemedyAction` can return plus `A-EXCHANGES-KEY`): 18 composed notes. The measured floor (73) is computed over this set.
- **Files modified:** `src/lib/status-surface-copy.test.ts`
- **Commit:** `e6062ce6c`

**2. [Rule 3 - Blocking] Lead constants moved above `MINT_TOKEN_NOTES`**
- **Issue:** `MINT_TOKEN_NOTES` and the new `PUBLIC_URL_NOTES` interpolate the lead constants at module evaluation, and 238-01 had declared those constants below the table (a `const` read before its declaration throws).
- **Fix:** the three constants and their docblocks now sit above the tables; text unchanged.
- **Commit:** `e6062ce6c`

**Total deviations:** 2 (both test or ordering mechanics; no copy changed from the UI-SPEC).

## Known Stubs

None.

## Threat Flags

None. T-238-06 mitigated: `shareNote` typed `string | ReactNode`, the node is static copy plus `DegradeAction`, both paths covered by the render test and `tsc`. T-238-07 accepted: `no-email-in-copy` green.

## Assumptions carried

- The 390px wrap of the longest composed note (KCS12-MINT-B-LEAD plus A-LINK-KEY-EDIT) on the owner pending page is not verified here: no class was added and the `p` keeps `mt-2 text-fixed-12 text-text-muted`. The verifier should abstain to human_needed if it cannot confirm.
- The ship step must name `170.1-STRATEGIES-NOTE-WAIT-WORDING` in the CHANGELOG entry (CLAUDE.md rule (b)).

## Self-Check: PASSED

- Files exist: the six modified files and this SUMMARY.
- Commits `4710e4359`, `e6062ce6c` and `824b4789b` are ancestors of HEAD; `git rev-list --count` from the ledger base gives 3.
- Acceptance criteria and the PR-1 gate re-run after the last edit; all green.
