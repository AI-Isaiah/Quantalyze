---
phase: 238-nevercomputed-a-strategy-that-never-computed-failed-or-stall
plan: 01
subsystem: ui
tags: [strategies, share-note, copy, degrade, FACT-05, vitest]
status: complete
requires: []
provides:
  - "KCS12_MINT_B_LEAD, KCS12_PUBLIC_LEAD, KCS12_PUBLIC_UNKNOWN exported copy constants"
  - "DegradeAction, the exported action renderer (was file-local Action)"
  - "ShareNoteDescriptor (text | remedy) in the /strategies page"
affects: [238-02, 238-03]
tech-stack:
  added: []
  patterns:
    - "share note resolved as a descriptor in noteFor, action always through viewerRemedyAction"
key-files:
  created: []
  modified:
    - src/lib/status-surface-copy.ts
    - src/components/degrade/DegradeLine.tsx
    - src/app/(dashboard)/strategies/page.tsx
    - src/app/(dashboard)/strategies/page.key-pill.test.tsx
key-decisions:
  - "MINT_TOKEN_NOTES, PUBLIC_URL_NOTE, recipientShareNote and recipientShareNoteFor left byte-identical (238-03 owns them; the owner pending page still reads them)"
  - "A stalled fixture must be a stitch job: isStitchStalled is stitch-only, so the single-key stalled case is api_key_id set, no members, one stitch_composite running with a 60 minute old claimed_at"
requirements-completed: [FACT-05]
duration: 25 min
completed: 2026-11-24
commits: 2
plan_head_before: 895595097d8aca03f9252d2010c8e9d76d65aaf7
plan_head_after: c6f542d38b9e8f1bc9b3eab15a08c3f76f3e8aca
actuals:
  tokens: 5900
  tasks: 2
  commits: 2
---

# Phase 238 Plan 01: Unpublished not-available share note names its remedy Summary

An unpublished /strategies row whose private link shows "not available" while nothing is running (failed, stalled, never_started) now renders the lead sentence plus the action its remedy names, through the viewer mapping, instead of telling the owner to wait.

## What was built

- `src/lib/status-surface-copy.ts`: three exported constants with KCS-id docblocks, text from the UI-SPEC Copywriting Contract. No import of `degrade-warnings` (cycle guard, grep returns 0).
- `src/components/degrade/DegradeLine.tsx`: the file-local `Action` became the exported `DegradeAction`; `Segment` calls it. Same body, no second copy.
- `src/app/(dashboard)/strategies/page.tsx`: `ShareNoteDescriptor` (`text` | `remedy`); every existing string branch wraps via `textNote`; `uncomputedNote` returns a `remedy` descriptor when `mode === "mint-token"`, `arm === "not_available"`, `kind === null`, `state !== null`, else a `text` descriptor from `recipientShareNoteFor` (published rows byte-identical). `noteFor` resolves the descriptor: `text` keeps `ContactPointerText`; `remedy` computes `shapeOf`, `ownerRemedy` (no build facts), `viewerRemedyAction({ managerSurface: isManager })` and renders `KCS12_MINT_B_LEAD`, one space, `DegradeAction`. The share `<p>` keeps its testid, `data-degrade-id` and class and stays last.
- `page.key-pill.test.tsx`: `NEVERCOMPUTED` describe (failed, stalled, never_started; full sentence, exact link count and href, four forbidden substrings absent); every `MINT_B` site and the `D-08 R-1 VARIANT` it.each re-pointed (not deleted); `RETIRED_MINT_B` kept for negative assertions, asserted `not.toBe` in the it.each body.

## Commits

- `702c455ae` feat(238-01): unpublished not-available share note names its remedy (Task 1, tracer)
- `c6f542d38` test(238-01): re-point key-pill MINT_B sites to the remedy notes (Task 2)

## Verification (measured)

- Tracer verify `npx vitest run "src/app/(dashboard)/strategies/page.key-pill.test.tsx" -t "NEVERCOMPUTED"`: `Tests  3 passed | 77 skipped (80)`.
- Plan verify `npx vitest run "src/app/(dashboard)/strategies" src/lib/degrade-warnings.test.tsx src/__tests__/degrade-warning-scan.test.ts src/lib/status-surface-copy.test.ts src/__tests__/copy-census.test.ts src/__tests__/no-email-in-copy.test.ts`: `Test Files  60 passed (60)`, `Tests  1388 passed (1388)`. `page.merged.test.tsx` needed no edit; `degrade-warning-scan.test.ts` unchanged.
- `npm run typecheck`: exit 0. `npm run lint`: exit 0, `0 errors, 4 warnings` (all in files this plan did not touch, for example `src/lib/factsheet/composite-read-path.ts` and `src/lib/queries.stale-analytics-detail.test.ts`; not fixed, out of scope). check-planning-hygiene OK.
- `node scripts/verify-plan-anchors.mjs .../238-01-PLAN.md`: exit 0.
- Acceptance greps: KCS12 constants 3, `export function DegradeAction` 1, `DegradeAction` in page 2, `new Map<string, string>(` 0, contact-resolve sentence in test 1, degrade-warnings import in copy module 0, `expected: () => MINT_B,` 0, `RETIRED_MINT_B` 2, reload sentence in test 1.
- Nothing skipped. No PROD access.

## A7 derivation (re-pointed sites, derived by running)

Run output matched the plan list exactly: race test, "MINT-B", `s-comp`, `s-pend` -> CONTACT-RESOLVE; "IN05-ZERO-UNLINKED" -> RELOAD; "REASK" -> LINK-KEY-EDIT; it.each `stalled` -> RELOAD, `failed` -> CONTACT-RESOLVE, `never_started` -> LINK-KEY-EDIT. No disagreement.

## PROOF-01

Byte backup in a `mktemp -d` directory outside the repo; restore by `cp`, check by `cmp`; no git checkout, restore or stash used.

### Neuter A (per-state cases): `uncomputedNote` always returns the `text` descriptor

Neuter: in `page.tsx`, `if (mode === "mint-token" && arm === "not_available" && ...)` became `if (false && mode === "mint-token" && ...)`.

RED (`npx vitest run "src/app/(dashboard)/strategies/page.key-pill.test.tsx"`, filtered to result lines):

```
     × PROBE-NOT-COMPUTED (D-05, SFH M-5): the embed says complete but the builder's read says failed, so the row takes the uncomputed path, logged at warn 14ms
     × MINT-B: an unpublished row whose stitch failed permanently says the private link shows it not available and names the contact form 7ms
     × B24 a computing or pending row keeps today's note: only `failed` sets the analytics-failed note 8ms
     × IN05-ZERO-UNLINKED (167.2-REVIEW-R2 IN-05): no members read, NO linked key and a stitch on record keep the stitch rule, so a member chain row cannot answer for a possible composite 7ms
     × D-08 R-1 VARIANT stalled: only a finished state selects the finished-not-built note 7ms
     × D-08 R-1 VARIANT failed: only a finished state selects the finished-not-built note 7ms
     × D-08 R-1 VARIANT never_started: only a finished state selects the finished-not-built note 7ms
     × REASK (167.2-REVIEW-SFH M-5): a full 100-row window of cron rows re-asks once at the RPC cap and states the real arm 8ms
       × failed (permanent): the contact form, the one link on `contact form` 7ms
       × stalled (single key, a stitch heartbeat gone quiet): Resync on the edit page, the one link on `edit page` 7ms
       × never_started (no key, no members, no jobs): Change key on the edit page, one edit link 7ms
 Test Files  1 failed (1)
      Tests  11 failed | 69 passed (80)
```

Each failure received the retired sentence, for example `Received: "Right now, a private link to this strategy shows that its factsheet is not available yet. The numbers appear there once a computation succeeds."` against the expected remedy sentence. The three NEVERCOMPUTED cases and the five re-pointed tests (eight it/it.each rows) went RED; the other 69 stayed green.

Restore: `cmp "$BK/page.tsx" "src/app/(dashboard)/strategies/page.tsx"` -> `cmp exit 0`. GREEN:

```
 Test Files  1 passed (1)
      Tests  80 passed (80)
```

### Neuter B (viewer mapping on this path): raw `ownerRemedyAction(remedy)` instead of `viewerRemedyAction(...)`

Neuter: in `noteFor`, `id={viewerRemedyAction({ remedy, managerSurface: isManager, shape })}` became `id={ownerRemedyAction(remedy)}` (import added for the neuter only).

RED (`npx vitest run "src/app/(dashboard)/strategies"`): key-pill stayed green (manager viewer); the named tests are both in `page.merged.test.tsx`:

```
     × an allocator-only viewer: the Exchanges page for a key-fed strategy, the contact form for one with no key, never the edit page 88ms
     × a transient failure takes the shape remedy for its state: a manager the Resync edit page, an allocator-only viewer the Exchanges page and never the edit page 128ms
 FAIL  |jsdom| src/app/(dashboard)/strategies/page.merged.test.tsx > the Stale (no data yet) detail takes the never-started remedy by role (199-16 Task 2, D-03, CD-11) > an allocator-only viewer: the Exchanges page for a key-fed strategy, the contact form for one with no key, never the edit page
AssertionError: expected <a …(2)></a> to be null
 FAIL  |jsdom| src/app/(dashboard)/strategies/page.merged.test.tsx > the Stale (no data yet) detail reads the row's REAL compute state (199 review SFH-03) > a transient failure takes the shape remedy for its state: a manager the Resync edit page, an allocator-only viewer the Exchanges page and never the edit page
AssertionError: expected <a …(2)></a> to be null
 Test Files  1 failed | 54 passed (55)
      Tests  2 failed | 1110 passed (1112)
```

Restore: `cmp exit 0`. GREEN:

```
 Test Files  55 passed (55)
      Tests  1112 passed (1112)
```

## Deviations from Plan

None - plan executed exactly as written. Two notes that are not deviations:

- The plan's stalled fixture hint ("one key job running") needed a stitch job, because `isStitchStalled` is stitch-only (`process_key_long` never reads stalled). The fixture is a linked key, no members, one `stitch_composite` running with a 60 minute old `claimed_at`; shape resolves `single`, so it names `A-RESYNC-EDIT`.
- Task 1's commit left 8 re-pointable tests red until Task 2's commit (the plan splits them across the two tasks); the final tree is fully green.

**Total deviations:** 0.

## Known Stubs

None that block the plan goal. `KCS12_PUBLIC_LEAD` and `KCS12_PUBLIC_UNKNOWN` have no consumer in this plan by design; plan 238-02 (same PR) consumes them.

## Threat Flags

None. T-238-01 mitigated and proven by Neuter B; T-238-02 reuses `DegradeAction` (encoded strategy id, one contact encoder); T-238-03 `no-email-in-copy` green.

## Assumptions carried (from the plan, unchanged)

- Health `Updating` can sit beside a remedy note for an unpublished row whose embed is pending while its jobs read failed or stalled; the note carries no "no computation is running", so it stays true. Recorded, not fixed.
- Shape `unknown` from a `seen` stitch history with no key and no members gives `A-RELOAD`, which repeats on reload; shared with the `strategies.stale-no-data` detail. Book only if a review raises it to MEDIUM+.

## Self-Check: PASSED

- Files exist: the four modified source files and this SUMMARY.
- Commits `702c455ae` and `c6f542d38` are ancestors of HEAD; `git rev-list --count` from the ledger base gives 2.
- Acceptance criteria and plan-level verification re-run after the final test edit; all green.
