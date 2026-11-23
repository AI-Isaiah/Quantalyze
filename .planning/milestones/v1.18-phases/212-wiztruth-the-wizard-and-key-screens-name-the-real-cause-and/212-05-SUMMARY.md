---
phase: 212-wiztruth-the-wizard-and-key-screens-name-the-real-cause-and
plan: 05
subsystem: in-app contact pointers (auth forms, allocations drawer and optimizer card)
tags: [sc6, sc8, contact-pointer, red-on-revert, ui-copy]
requires: []
provides:
  - "ProfileForm, SignupForm, ScenarioCommitDrawer and WeightOptimizerSection render UI-SPEC SC6 rows 1-6 through ContactPointerText (topic support, newTab)"
  - "EmptyStateCard.body typed ReactNode (type only)"
affects:
  - src/components/auth/ProfileForm.tsx
  - src/components/auth/SignupForm.tsx
  - src/app/(dashboard)/allocations/components/ScenarioCommitDrawer.tsx
  - src/app/(dashboard)/allocations/components/WeightOptimizerSection.tsx
  - src/components/ui/EmptyStateCard.tsx
tech-stack:
  added: []
  patterns: ["wrap the render, not the setter, where a slot also carries upstream messages (ContactPointerText is a no-op without the phrase)"]
key-files:
  created: []
  modified:
    - src/components/auth/ProfileForm.tsx
    - src/components/auth/ProfileForm.role-lock.test.tsx
    - src/components/auth/SignupForm.tsx
    - src/components/auth/SignupForm.role-lock.test.tsx
    - src/components/auth/SignupForm.repeated-signup.test.tsx
    - src/app/(dashboard)/allocations/components/ScenarioCommitDrawer.tsx
    - src/app/(dashboard)/allocations/components/ScenarioCommitDrawer.test.tsx
    - src/app/(dashboard)/allocations/components/WeightOptimizerSection.tsx
    - src/app/(dashboard)/allocations/components/WeightOptimizerSection.test.tsx
    - src/components/ui/EmptyStateCard.tsx
key-decisions:
  - "EmptyStateCard.body widened string to ReactNode (planner decision, executed): body is only rendered as a div child, every other caller passes a string, typecheck exits 0 with no caller edits"
  - "SignupForm error slot and the drawer banner wrap the RENDER; the setters and the topLevelError IIFE still build plain strings, so Supabase error.message and non-pointer banners pass through unchanged"
status: complete
commits: 3
plan_head_before: 2c091e3b9b1fec0e0fbd92f2677ac13934eecc00
plan_head_after: 21a39461e04c2cd039d3a8b2c2495543ced979d1
actuals:
  tokens: 5300
  tasks: 3
  commits: 3
---

# Phase 212 Plan 05: In-app contact pointers link the contact form Summary

Six in-app strings that told a user to get help now render a working `/contact?topic=support` link (new tab, `rel="noopener noreferrer"`, sr-only "(opens in a new tab)") through the one `ContactPointerText` renderer, in ProfileForm, SignupForm, ScenarioCommitDrawer and WeightOptimizerSection.

## Commits

| Task | Commit | Message |
| ---- | ------ | ------- |
| 1 (tracer) | 1dc404296 | fix(212-05): ProfileForm role helper links the contact form |
| 2 | bdc27e7f9 | fix(212-05): SignupForm pointers link the contact form |
| 3 | 21a39461e | fix(212-05): allocation pointers link the contact form |

## What changed

- `ProfileForm.tsx`: the locked-role helper span keeps its element and classes; its text is row 1 through `ContactPointerText`.
- `SignupForm.tsx`: the no-user/no-session `setError` sentence is row 2; the `{error && <p>}` slot renders `error` through `ContactPointerText` (Supabase `error.message` and the other setter sentences contain no pointer phrase and render unchanged); the locked helper is row 3.
- `ScenarioCommitDrawer.tsx`: the two remediation strings are rows 4 and 5; the `commit-drawer-error` banner renders `topLevelError` through `ContactPointerText`. Banner element, `role="alert"`, ref and classes unchanged.
- `EmptyStateCard.tsx`: `body: string` to `body: ReactNode`, type import only, no render change.
- `WeightOptimizerSection.tsx`: `FAILURE_COPY.unreadable.body` is row 6; the failure `EmptyStateCard` render passes `body={<ContactPointerText .../>}`. The other two failure bodies contain no phrase and render unchanged.
- No comment, docstring or note written by this plan contains the legacy support phrase. No file under `supabase/migrations`.

## Tests added

- `ProfileForm.role-lock.test.tsx`: row 1 text, href, target, rel, no `@`.
- `SignupForm.role-lock.test.tsx`: row 3 helper link (this file does not drive `signUp` for an error, so it holds the helper case only).
- `SignupForm.repeated-signup.test.tsx` (the file that already drives `signUp` through `fillForm`): row 2 no-user case, plus a control where `error.message` renders as plain text with no `a` element.
- `ScenarioCommitDrawer.test.tsx`: row 4 inside the over-recorded describe, row 5 inside the partial describe, full banner text hand-typed.
- `WeightOptimizerSection.test.tsx`: row 6 body link plus the LiveRegion `role="alert"` still announcing the heading; a control that the 503 body renders with no link.
- All expected strings are hand-typed, include the sr-only suffix that sits inside the link text, and assert no `@`.
- One test-harness note: in jsdom `getByRole("link", { name })` computes the accessible name as `contact form(opens in a new tab)` (no space between the inline spans), so the ProfileForm case matches `/^contact form\s?\(opens in a new tab\)$/`; the text-content assertion pins the exact spaced string.

## SC8 RED-on-revert evidence

Each neuter: file backed up with `cp` to the scratchpad, old string restored, tests run, backup `cp`d back, `cmp` exit 0, rerun GREEN. No git checkout, restore or stash.

- **Task 1** (ProfileForm helper reverted to the legacy sentence): 1 failed, 3 passed of 4. RED case: `the locked-role helper links the contact form in a new tab (SC6 row 1)`, `AssertionError: expected 'Set at signup. Contact support to cha...' to be 'Set at signup. Use the contact form (...'`. `cmp` 0, rerun 4 passed.
- **Task 2** (both SignupForm strings reverted at once): 2 failed, 11 passed of 13. RED cases: `SC6 row 3: the locked helper links the contact form in a new tab` and `SC6 row 2: the no-user/no-session failure links the contact form in a new tab`. `cmp` 0, `src/components/auth/` rerun: 63 passed.
- **Task 3** (drawer under-recorded string and WeightOptimizer unreadable body reverted together): 2 failed, 72 passed of 74. RED cases: `SC6 row 5: the under-recorded banner links ...` and `SC6 row 6: the unreadable-answer card body links ...`. Then, separately, the drawer over-recorded string reverted: 1 failed, 55 passed of 56, RED case `SC6 row 4: the over-recorded banner links ...`. Both `cmp` exit 0 (drawer, weight optimizer), rerun 74 passed.
- Not separately neutered: the `ContactPointerText` wrap at the render sites. Reverting only the wrap while the strings keep the phrase leaves plain text with no `a`, which the same link assertions would catch; the string neuters above were the planned proof.

## Verification

- `npx vitest run src/components/auth/` plus the two allocations test files: 13 files, 137 passed.
- `npm run typecheck`: exit 0 (EmptyStateCard callers unchanged).
- Scoped census `grep -i 'contact support'` over ProfileForm, SignupForm, ScenarioCommitDrawer, WeightOptimizerSection: 0 (HEAD was 6).
- `git diff --stat 2c091e3b9..HEAD -- supabase/migrations`: empty (SC7).
- `node scripts/verify-plan-anchors.mjs` on this PLAN: 8 claims, OK.
- The long-text backstop (320px wrap of the rewritten sentences in the narrow hosts) is not measured here; it is marked `verification: backstop` in the plan and the markup is unchanged inline text plus one inline link.

## Deviations from Plan

None - plan executed exactly as written. (The jsdom accessible-name note above is a test-harness detail, not a plan change.)

## Known Stubs

None.

## Threat Flags

None. New surface is three outbound new-tab links to the public `/contact` route, covered by T-212-13 (rel asserted in every case) and T-212-14 (hrefs come only from `contactHref`, no `@` in rendered text asserted).

## Self-Check: PASSED

- Commits 1dc404296, bdc27e7f9, 21a39461e are ancestors of HEAD; `git rev-list --count 2c091e3b9..HEAD` was 3 before this SUMMARY commit.
- All ten `files_modified` paths exist and are committed; `git status` showed no tracked modifications after the last task commit.
- STATE.md and ROADMAP.md untouched.
