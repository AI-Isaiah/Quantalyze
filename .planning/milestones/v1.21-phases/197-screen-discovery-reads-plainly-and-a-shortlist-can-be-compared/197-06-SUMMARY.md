---
phase: 197-screen-discovery-reads-plainly-and-a-shortlist-can-be-compared
plan: 06
subsystem: discovery
tags: [discovery, shared-account, admin-only, rsc-payload, clar-05, todos]
requires:
  - phase: 197
    provides: "plan 02 getSharedAccountPartners reader; plan 05 selectable discovery table"
provides:
  - "sharedAccountSentence(names) and SharedAccountNote: one string for the table row and the grid card"
  - "sharedAccountPartners prop on StrategyTable and StrategyGrid (absent means byte-identical)"
  - "discovery page wiring: reader called once, prop spread only when non-null"
  - "phase-149 pin 2c: the anonymous browse page carries neither the prop nor the reader"
  - "TODOS.md ## Phase 197 (SCREEN): four routed observations"
affects: []
tech-stack:
  added: []
  patterns: ["Conditional prop spread so a withheld prop is absent from the RSC payload, asserted with the in-operator rather than an undefined value"]
key-files:
  created:
    - src/components/strategy/SharedAccountNote.tsx
    - src/components/strategy/StrategyTable.shared-account.test.tsx
  modified:
    - src/components/strategy/StrategyTable.tsx
    - src/components/strategy/StrategyGrid.tsx
    - src/app/(dashboard)/discovery/[slug]/page.tsx
    - src/app/(dashboard)/discovery/[slug]/page.test.tsx
    - src/__tests__/phase-149-my-strategies-parity.test.ts
    - TODOS.md
key-decisions:
  - "The page holds no second admin check: the reader refuses non-admins before it creates the service-role client and returns null on any failure, so null is the single fail-closed signal and the prop is simply not passed"
  - "An admin with no sharing receives the reader's empty map and the page passes it through unchanged (it carries nothing, and only an admin ever gets a non-null result)"
  - "SharedAccountNote takes an optional className so the grid card can add its own bottom margin while the table cell keeps the plain mt-1 third line"
requirements-completed: [CLAR-05]
duration: ~40m
completed: 2026-11-08
status: complete
actuals:
  tokens: 9500
  tasks: 3
  commits: 4
commits: 4
plan_head_before: 16375967a1a5dc87630339c07cdaaa7ce2598b9e
plan_head_after: 2a4ef08a971d6435d1a932c8b7b18fd5ae811ccf
---

# Phase 197 Plan 06: Admin-only shared-account line Summary

An admin viewing a discovery category now sees, under a listing, "Shares an exchange account with A." (or "A and B.", or "A, B and n more.") when published strategies draw on the same exchange account; every other viewer gets neither the line nor the names in the page payload.

## What was built

- **Task 1 (tracer), RED `f3152dc35`, GREEN `0509acf9e`:** `SharedAccountNote.tsx` exports `sharedAccountSentence` (three UI-SPEC sentences, null for none) and `SharedAccountNote` (muted `text-micro` paragraph, no glyph, no link, title "Shown to admins only. Shares an exchange account with {all names}."). `StrategyTable` takes `sharedAccountPartners?` and renders the note as the Strategy cell's third line; the discovery page calls `getSharedAccountPartners(supabase, user, ids)` once after its parallel reads and spreads the prop only when the result is non-null.
- **Task 2, `eb3c0ee04`:** the grid card prints the same line below `SyncBadge`; the page test carries the two D-01 fail-closed cases (non-admin refusal, read failure) asserting `"sharedAccountPartners" in props === false`; phase-149 pin 2c asserts the comment-stripped browse page contains neither `sharedAccountPartners` nor `shared-account-partners` while the discovery page contains both.
- **Task 3, `2a4ef08a9`:** `## Phase 197 (SCREEN) — routed items (logged 2026-11-08)` appended to TODOS.md with `[197-VOL-SIGN-TEARSHEET-COMPARE]` (Phase 201), `[197-SYNCBADGE-SERIES-LADDER]`, `[197-PERCENTILE-COHORT-STALE]` and `[197-COMPARE-NAME-PSEUDONYMITY]` (unrouted), each with a Reading and an Owner / Trigger line and no PROD ids.

## TDD evidence (tdd="true" tasks)

- **RED, Task 1:** with a signatures-only `SharedAccountNote` skeleton (so the failures are assertion failures, not load faults), `StrategyTable.shared-account.test.tsx` ran 9 failed / 4 passed. The 4 passing were the absence cases (no prop, empty array, empty-sentence null), which hold on a skeleton by construction; their opposite (the present cases) failed on `Unable to find an element with the text: Shares an exchange account with Beta Carry.` and `expected null to be "Shares an exchange account with A."`.
- **RED, Task 2:** the grid and phase-149 cases were written in the same RED file (grid) or added with their own neuter run (pin 2c), see below.

## Neuter evidence (data-exposure gates proven able to fail)

Byte backups `cp`'d to the session scratchpad, edited in place, restored with `cp`, `cmp` printed identical both times.

- **Page gate (T-197-15):** the conditional spread replaced by an unconditional `sharedAccountPartners={partners ?? undefined}`. Page test: 2 failed / 6 passed, both D-01 fail-closed cases: `AssertionError: expected true to be false` on `"sharedAccountPartners" in tableProps`. Restored; 8 of 8 pass.
- **Browse pin (pin 2c):** a `"shared-account-partners"` string appended to `src/app/browse/[slug]/page.tsx`. Pin run: 1 failed / 14 passed, `AssertionError: expected 'import Link from "next/link";\nimport…' not to contain 'shared-account-partners'`. Restored; 15 of 15 pass.

## Verification

- `npx vitest run src/components/strategy "src/app/(dashboard)/discovery/[slug]/page.test.tsx" src/__tests__/phase-149-my-strategies-parity.test.ts src/lib/discovery/shared-account-partners.test.ts`: 83 files, 1448 tests, all pass.
- `StrategyTable.default-mounts.test.tsx` passes and `git diff --name-only -- src/components/strategy/__fixtures__` prints nothing (byte-pin fixture untouched).
- Acceptance greps: `getSharedAccountPartners(` in the page is 1; `sharedAccountPartners` appears in the page only inside the conditional spread; banned-word grep (comment lines excluded) on `SharedAccountNote.tsx` prints 0; browse page grep prints 0; four `### [197-...]` entries under one `## Phase 197 (SCREEN)` heading, after the Phase 194 section.
- `npm run typecheck`: clean. `npm run lint`: 0 errors (the same 2 pre-existing warnings in `MetricsColumn.tsx` and `composite-read-path.ts`), all hygiene checks OK.
- `npm test` (full suite): 1226 files; 1205 passed, 20 skipped, **1 failed**: `src/lib/factsheet/compute.conventions.test.ts`, 2 snapshot cases (fixtures B and C), last-digit float differences in `skew` (`-0.11360716852722537` expected, `-0.11360716852722538` received; `0.036844507138639` vs `0.036844507138638946`). 24469 tests passed, 2 failed, 309 skipped. This plan touches nothing under `src/lib/factsheet` (`git diff 16375967a HEAD -- src/lib/factsheet` is empty); the failure is a platform floating-point difference (local Node v25.8.1) against a snapshot written elsewhere. Out of scope, recorded in `deferred-items.md`; CI's own run is the judge.

## Deviations from Plan

**1. [Ordering only] Grid rendering landed in the Task 1 GREEN commit, not Task 2.** The RED test file written for Task 1 already contained the grid cases, and leaving them red across a commit would have broken the plan's own Task 1 verify command. The Task 1 commit therefore carries the grid change; Task 2's commit carries the phase-149 pin and the page fail-closed cases remained in Task 1's page tests. Behaviour and files are exactly the plan's.

**2. [Rule 1 scope] No fix for the `compute.conventions` snapshot failure.** Pre-existing and unrelated; logged, not fixed (scope boundary).

Otherwise the plan executed as written. Additions inside its intent: an optional `className` on `SharedAccountNote` for the card's bottom margin, and a page test that the page passes a reader-supplied empty map through (an admin with no sharing).

## Known limits (recorded, not fixed)

- The four observations booked in TODOS.md, by design.
- The line is judged and rendered per row on the server's data; it is not live. A newly shared account appears on the next page load.
- Seeded e2e lane (`e2e/layout-narrow.spec.ts`, discovery specs) was not run locally; it is the PR-run gate named in the plan's verification.

## Known Stubs

None.

## Threat Flags

None beyond the plan's register: T-197-15 and T-197-16 mitigated by the conditional spread and the two fail-closed page tests (neutered RED once); T-197-17 holds by the reader's published-only read (plan 02, neutered RED there); T-197-SC no package added.

## Self-Check: PASSED

- FOUND: src/components/strategy/SharedAccountNote.tsx
- FOUND: src/components/strategy/StrategyTable.shared-account.test.tsx
- FOUND commits: f3152dc35, 0509acf9e, eb3c0ee04, 2a4ef08a9
