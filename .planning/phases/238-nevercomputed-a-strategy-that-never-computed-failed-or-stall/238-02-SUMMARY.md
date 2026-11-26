---
phase: 238-nevercomputed-a-strategy-that-never-computed-failed-or-stall
plan: 02
subsystem: ui
tags: [strategies, share-note, copy, degrade, FACT-05, vitest, proof-01]
status: complete
requires: [238-01]
provides:
  - "public-uncomputed ShareNoteDescriptor variant, resolved in noteFor from failedFacts"
  - "NEVERCOMPUTED published / role matrix / parity test blocks"
affects: [238-03]
tech-stack:
  added: []
  patterns:
    - "a published row's note takes its state only from the failedFacts read the page already makes; no jobs read added"
key-files:
  created: []
  modified:
    - src/app/(dashboard)/strategies/page.tsx
    - src/app/(dashboard)/strategies/page.key-pill.test.tsx
    - src/app/(dashboard)/strategies/page.merged.test.tsx
key-decisions:
  - "A published row with no failedFacts entry, or an unreadable state, says KCS12_PUBLIC_UNKNOWN; armOf still returns state null for it (167.2-REVIEW IN-04 stands)"
  - "The three published text notes (unknown, running, finished) render through ContactPointerText, so the contact form phrase keeps its AD-05 link like every other text note"
requirements-completed: [FACT-05]
duration: 9 min
completed: 2026-11-24
commits: 2
plan_head_before: f9bc6b98d43373b6c4c1cd73795103ae34d64619
plan_head_after: d3756932dc5551d14e9b63b833d96158cbed1c9e
actuals:
  tokens: 6000
  tasks: 2
  commits: 2
---

# Phase 238 Plan 02: Published public-link note and the role-by-action matrix Summary

A published /strategies row's public-link note no longer tells the owner to wait when nothing is running: it names its action from the compute state the page already reads for a Stale (no data yet) row, says the state-free "If no computation is running, use the contact form to have it checked" everywhere else, and adds no jobs read.

## What was built

- `page.tsx`: `ShareNoteDescriptor` gained `{ kind: "public-uncomputed" }`. `uncomputedNote` returns it for `mode === "public-url"` with `kind === null` (a published `analytics_failed` row keeps its text note). `noteFor` resolves it from `failedFacts.get(s.id)`:
  - no entry, a null state or `unreadable` -> `KCS12_PUBLIC_UNKNOWN`
  - arm `in_progress` -> the unchanged KCS12-PUBLIC words
  - state `finished` -> the existing public finished_not_built line
  - failed, stalled, never_started -> `KCS12_PUBLIC_LEAD`, one space, `DegradeAction` with `viewerRemedyAction({ managerSurface: isManager, shape })`, `shape = shapeOf(s, facts.compositeHistory)`.
  The `armOf` comment was rewritten to say what is true now. `armOf` still returns `state: null` for a published row.
- `page.key-pill.test.tsx`: typed-out `PUBLIC_UNKNOWN`; the four `PUBLIC` note sites (FIRST-COMPUTE-PUBLISHED, PUBLIC, PUBLIC-NO-READ, D-08 PUBLISHED-FINISHED) re-pointed, every `rpcCalls` `[]` assertion kept; HELD-RERUN-PUBLISHED also asserts `PUBLIC_UNKNOWN` absent. `PUBLIC` (old words) stays for the negatives.
- `page.merged.test.tsx`: `NEVERCOMPUTED published` (failed with exactly one read for the row, running, finished); `NEVERCOMPUTED role matrix` (13 table cases plus two whole-sentence pins); `NEVERCOMPUTED parity` (3 fixtures, note after detail, same action sentence). The smallest seam added in the test file only: `state.members` / `state.membersError` on the `strategy_keys` arm of the double.

## Commits

- `e2272d68c` feat(238-02): a published row's share note reads the state the page already read (Task 1, tracer)
- `d3756932d` test(238-02): role-by-action matrix and detail parity for the share note (Task 2)

## Verification (measured)

- Tracer verify (`npx vitest run ... -t "NEVERCOMPUTED|PUBLIC"`): `Tests  9 passed | 147 skipped (156)` (gate was at least 7).
- Plan verify `npx vitest run "src/app/(dashboard)/strategies" src/lib/degrade-warnings.test.tsx src/__tests__/degrade-warning-scan.test.ts src/__tests__/copy-census.test.ts src/__tests__/no-email-in-copy.test.ts`: `Test Files  59 passed (59)`, `Tests  1313 passed (1313)`.
- `npx tsc --noEmit`: exit 0. `npm run lint`: exit 0, `0 errors, 4 warnings` (the same four pre-existing warnings 238-01 reported, in files this plan did not touch). check-planning-hygiene OK.
- `node scripts/verify-plan-anchors.mjs .../238-02-PLAN.md`: exit 0.
- Acceptance greps: `public-uncomputed` in page.tsx 5; `If no computation is running, use the contact form to have it checked.` in key-pill 1; `factsheet is not available. Use the contact form to have it resolved.` in merged 1; `NEVERCOMPUTED` in merged 4; `is not available. Check its key on the Exchanges page.` 1; `is not available. A CSV strategy's data is fixed at upload.` 1; key-pill `expect(state.rpcCalls).toEqual([])` 5, all passing.
- Nothing skipped. No PROD access.
- The 390px wrap of KCS12-MINT-B-LINK-KEY-EDIT is the plan's backstop truth: no class was added, the `p` keeps `text-caption font-normal text-text-muted`, and no viewport test was added. It is not verified by this plan; the verifier should abstain to human_needed if it cannot confirm.

## Existing assertions that moved

None needed a change for a new link: the two pre-existing allocator-only container-wide `a[href*="/edit"]` negatives stayed green. They went RED under Neuter C only because the neutered note itself rendered an edit link, which is the correct behaviour of that negative.

## PROOF-01

Byte backups of `page.tsx` and `page.merged.test.tsx` in a `mktemp -d` directory outside the repo; restore by `cp`, check by `cmp`; no git checkout, restore or stash used.

### Neuter C (viewer mapping): `managerSurface: true` for the share note

Neuter: in `noteFor`, both `id={viewerRemedyAction({ remedy, managerSurface: isManager, shape })}` became `managerSurface: true` (2 sites, the remedy note and the published note).

RED (`npx vitest run "src/app/(dashboard)/strategies/page.merged.test.tsx"`, result lines):

```
     × an allocator-only viewer: the Exchanges page for a key-fed strategy, the contact form for one with no key, never the edit page 38ms
     × a transient failure takes the shape remedy for its state: a manager the Resync edit page, an allocator-only viewer the Exchanges page and never the edit page 67ms
     × allocator, single, transient failure: EXCHANGES-KEY 38ms
     × allocator, composite, transient failure: EXCHANGES… 35ms
     × allocator, unlinked, never started: CONTACT-CHECK 37ms
     × allocator, csv, never started: CONTACT-CHECK 32ms
     × an allocator-only viewer of a key-fed strategy reads the Exchanges page, as one sentence 25ms
 Test Files  1 failed (1)
      Tests  7 failed | 94 passed (101)
```

The allocator matrix cases and the two container-wide href negatives went RED; the manager and `both` cases stayed green. Restore: `cmp exit 0`. GREEN:

```
 Test Files  1 passed (1)
      Tests  101 passed (101)
```

### Neuter D (parity): the note's shape without the composite history

Neuter: in `noteFor`, `shapeOf(s, shareNote.compositeHistory)` became `shapeOf(s)`.

RED (`npx vitest run` over `page.merged.test.tsx` and `page.key-pill.test.tsx`):

```
     × IN05-ZERO-UNLINKED (167.2-REVIEW-R2 IN-05): no members read, NO linked key and a stitch on record keep the stitch rule, so a member chain row cannot answer for a possible composite 17ms
     × D-08 R-1 VARIANT stalled: only a finished state selects the finished-not-built note 10ms
     × no key, no members, a stitch on record … 33ms
 Test Files  2 failed (2)
      Tests  3 failed | 178 passed (181)
Expected: "Right now, a private link to this strategy shows that its factsheet is not available. Reload this page to try again."
Received: "Right now, a private link to this strategy shows that its factsheet is not available. Link a key with Change key… on this strategy's edit page (add one on your Profile API keys tab first if you have none) to start a new computation. Use the contact form if it does not complete."
Expected: "Reload this page to try again."
Received: "Link a key with Change key… on this strategy's edit page (add one on your Profile API keys tab first if you have none) to start a new computation. Use the contact form if it does not complete."
```

The last Expected/Received pair is the parity case `no key, no members, a stitch on record (shape depends on the composite history)`: the note drifts to LINK-KEY-EDIT while the detail stays RELOAD. This fixture was added beyond the plan's two (single-key and unlinked) because neither of those changes shape with the history. This neuter touches the unpublished remedy path only; the published path reads `facts.compositeHistory` and has no history-dependent fixture. Restore: `cmp exit 0`. GREEN: `Test Files  2 passed (2)`, `Tests  181 passed (181)`.

### Neuter E (published state): `public-uncomputed` resolved as if `failedFacts` had no entry

Neuter: at the `public-uncomputed` branch in `noteFor`, `const facts = failedFacts.get(s.id);` became `const facts = undefined as ReturnType<typeof failedFacts.get>;`.

RED:

```
     × jobs failed: the lead and the row's action sentence, from exactly one jobs read for the row 19ms
     × jobs running: the unchanged public sentence 28ms
     × jobs finished: the existing public finished-not-built line 33ms
 Test Files  1 failed | 1 passed (2)
      Tests  3 failed | 178 passed (181)
Expected: "Right now, this strategy's factsheet link shows that the factsheet is not available. Use the contact form to have it resolved."
Received: "Right now, this strategy's factsheet link shows that the factsheet is not available. If no computation is running, use the contact form to have it checked."
```

The named arm "NEVERCOMPUTED published failed" is RED first, with its two siblings; the four key-pill PUBLIC_UNKNOWN sites stay green, as they should. Restore: `cmp exit 0` (also `cmp exit 0` for the merged test file, unchanged). GREEN: `Test Files  2 passed (2)`, `Tests  181 passed (181)`.

## Deviations from Plan

None - plan executed exactly as written. Two notes that are not deviations:

- The published `KCS12_PUBLIC_UNKNOWN` text is rendered through `ContactPointerText` (and so are the running and finished texts), so its "contact form" phrase links to the support topic with the row's strategy id, as every other text note does. The plan did not say either way.
- The parity block carries a third fixture (see Neuter D) so that the parity gate can fail on a history-dependent shape.

**Total deviations:** 0.

## Known Stubs

None.

## Threat Flags

None. T-238-04 mitigated and proven by Neuter C; T-238-05 mitigated: `state.rpcCalls` for the published failed row holds `s-pub` exactly once, and the key-pill `[]` pins pass.

## Assumptions carried

- Shape `unknown` from a `seen` stitch history gives `A-RELOAD` in both the detail and the note (parity holds), which repeats on reload; recorded in 238-01, not fixed here.

## Self-Check: PASSED

- Files exist: the three modified source files and this SUMMARY.
- Commits `e2272d68c` and `d3756932d` are ancestors of HEAD; `git rev-list --count` from the ledger base gives 2.
- Acceptance criteria and plan-level verification re-run after the final edit; all green.
