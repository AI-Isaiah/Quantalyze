---
phase: 170-pagecopy
plan: 06
subsystem: ui
tags: [admin, match, read-only, responsive, owner-line]

requires:
  - phase: 170-01
    provides: the narrow-width viewport contract
  - phase: 170-02
    provides: the seeded layout-narrow N-MATCH row
provides:
  - /admin/match write handlers no-op below 768px
  - CSS-hidden write controls and a banner that names 768px
  - Strategy Review owner line disambiguated by email
  - Intro-requests count labelled intro made
affects: [170-08, layout-narrow N-MATCH, admin match]

actuals:
  tokens: 6479
  tasks: 2
  commits: 4

plan_head_before: 0b0b08b99f5f76931a64f19eecd0e656bc3e9ec4
plan_head_after: 338b4d61cd86944126370bb5bbecaa58e17bbe32

tech-stack:
  added: []
  patterns:
    - "readOnly = forceReadOnly || !isMd; JSX visibility stays on forceReadOnly and CSS does the hide"
    - "Button omits base inline-flex when the caller passes a bare hidden class"

key-files:
  created: []
  modified:
    - src/components/admin/AllocatorMatchQueue.tsx
    - src/components/admin/AllocatorMatchQueue.test.tsx
    - src/components/admin/CandidateDetail.tsx
    - src/components/admin/match/ShortlistCard.tsx
    - src/components/ui/Button.tsx
    - src/components/admin/AdminTabs.tsx
    - src/components/admin/AdminTabs.test.tsx
    - src/app/(dashboard)/admin/page.tsx

key-decisions:
  - "Below md, readOnly is forceReadOnly or not isMd. JSX still keys off forceReadOnly so desktop does not flash hidden; CSS hidden md:* hides the write controls."
  - "Button omits its base inline-flex when the caller passes a bare hidden class, because Tailwind v4 emits inline-flex after hidden."
  - "A display name with no email reads by {name} · Computed {recency}. Unknown is only when both are absent."

patterns-established:
  - "N-MATCH: isMd at (min-width: 768px); if (readOnly) return at the start of handleRecompute, handleDecision and guard"
  - "Owner email is its own span with text-text-muted and [overflow-wrap:anywhere]"

requirements-completed: ["SC2-MATCH", "R169-(c)", "R169-(d)"]

coverage:
  - id: D1
    description: "Below 768px, recompute, KEEP/SKIP, Send intro and the preferences recompute request send no write fetch and open no panel"
    requirement: SC2-MATCH
    verification:
      - kind: unit
        ref: "src/components/admin/AllocatorMatchQueue.test.tsx#below md, action-bar and empty-state Recompute now issue no request and Edit preferences opens no panel"
        status: pass
      - kind: unit
        ref: "src/components/admin/AllocatorMatchQueue.test.tsx#below md, shortlist Send intro and detail KEEP / SKIP / Send intro issue no request and open no panel"
        status: pass
      - kind: unit
        ref: "src/components/admin/AllocatorMatchQueue.test.tsx#below md, PreferencesPanel onRecomputeRequested does not POST recompute"
        status: pass
    human_judgment: false
  - id: D2
    description: "Write controls carry hidden plus an md display class, and the banner names 768px or wider"
    requirement: SC2-MATCH
    verification:
      - kind: unit
        ref: "src/components/admin/AllocatorMatchQueue.test.tsx#hides every write control with hidden plus an md display class, and the banner names 768px or wider"
        status: pass
    human_judgment: false
  - id: D3
    description: "At a real 390px viewport no write control is visible, and at 960px at least one is"
    requirement: SC2-MATCH
    verification: []
    human_judgment: true
    rationale: "e2e/layout-narrow.spec.ts row /admin/match — N-MATCH was not run in this session. It needs the seeded lane. Unit tests assert classes and handler no-ops, not computed style in a browser."
  - id: D4
    description: "Two strategy owners who share a display name read differently by email, with Computed and no short id"
    requirement: R169-(c)
    verification:
      - kind: unit
        ref: "src/components/admin/AdminTabs.test.tsx#disambiguates two owners who share a display name by email, and says Computed"
        status: pass
    human_judgment: false
  - id: D5
    description: "The intro-requests summary count reads N intro made, not in progress"
    requirement: R169-(d)
    verification:
      - kind: unit
        ref: "src/components/admin/AdminTabs.test.tsx#counts intro_made rows as intro made, not in progress"
        status: pass
    human_judgment: false

duration: 18min
completed: 2026-09-27
status: complete
---

# Phase 170 Plan 06: Admin match read-only and owner line Summary

**/admin/match write handlers no-op below 768px, the write controls are CSS-hidden, and the Strategy Review owner line is disambiguated by email**

## Performance

- **Duration:** 18 min
- **Started:** 2026-09-27T22:03:10Z
- **Completed:** 2026-09-27T22:21:30Z
- **Tasks:** 2
- **Files modified:** 8

## Accomplishments

- Below md, `handleRecompute`, `handleDecision` and `guard` return before any request. That covers the action-bar and empty-state Recompute buttons, KEEP / SKIP, both Send intro openers, and `PreferencesPanel` `onRecomputeRequested`.
- Recompute, Edit preferences and the shortlist Send intro carry `hidden md:inline-flex`. The detail action bar carries `hidden md:flex`. The banner says 768px or wider and no longer says 1024px+.
- The Strategy Review owner line is `by {name} · {email} · Computed {recency}`, email only, or `by Unknown`. The email is its own wrapping span. The intro count says `intro made`.

## Task Commits

Each task was committed atomically:

1. **Task 1: below md every /admin/match write handler is a no-op and every write control is CSS-hidden** - `cb3e6d277` (test), `6223810e7` (feat)
2. **Task 2: /admin owner line disambiguates by email with a Computed label, and the intro count says intro made** - `8a0fab3c1` (test), `338b4d61c` (feat)

**Plan metadata:** pending docs commit

## Files Created/Modified

- `src/components/admin/AllocatorMatchQueue.tsx` - `isMd`, `readOnly`, early returns, banner copy, CSS hide on both Recompute buttons and Edit preferences
- `src/components/admin/AllocatorMatchQueue.test.tsx` - below-md handler, class and banner cases
- `src/components/admin/CandidateDetail.tsx` - action bar `hidden md:flex`
- `src/components/admin/match/ShortlistCard.tsx` - send-intro button `hidden md:inline-flex`
- `src/components/ui/Button.tsx` - omit base `inline-flex` when the caller passes bare `hidden`
- `src/components/admin/AdminTabs.tsx` - owner line and `intro made` count
- `src/components/admin/AdminTabs.test.tsx` - disambiguation and count cases; synthetic `@example.test` addresses
- `src/app/(dashboard)/admin/page.tsx` - strategies embed selects `email`

## Decisions Made

- JSX render conditions stay on `forceReadOnly`. `readOnly` is the handler guard only, so a desktop first paint (server snapshot `false`) does not hide the controls. CSS does.
- Tailwind v4 generates `.inline-flex` after `.hidden`. A Button that always emits `inline-flex` would stay visible. The base display is omitted when the caller owns `hidden`.
- Name without email keeps the name. `by Unknown` is only the neither branch.

## RED at HEAD

Task 1, `npx vitest run src/components/admin/AllocatorMatchQueue.test.tsx -t N-MATCH`, 4 failed on the behavior assertions:

- `below md, action-bar and empty-state Recompute now issue no request and Edit preferences opens no panel` — recompute fetch length 1, expected 0
- `below md, shortlist Send intro and detail KEEP / SKIP / Send intro issue no request and open no panel` — decisions fetch length 2, expected 0
- `below md, PreferencesPanel onRecomputeRequested does not POST recompute` — recompute fetch length 1, expected 0
- `hides every write control with hidden plus an md display class, and the banner names 768px or wider` — Recompute classes did not include `hidden`

Task 2:

- `disambiguates two owners who share a display name by email, and says Computed` — unable to find `owner-a@example.test`
- `counts intro_made rows as intro made, not in progress` — unable to find `1 intro made` (the DOM still said `1 in progress`)

## Neuter

- Task 1: removed `if (readOnly) return` from `handleRecompute` only. The action-bar/empty recompute case and the preferences `onRecomputeRequested` case both went back to recompute fetch length 1. The line was restored. The file then passed 23 tests, with PreferencesPanel's 6.
- Task 2: the email span was replaced with the raw email string. The disambiguation case went RED (`Unable to find an element with the text: owner-a@example.test`, because the address was no longer its own element). The span was restored. AdminTabs then passed 8 tests.

## Per-route admin check

Viewport is not the authorization boundary. These handlers were read and not edited. `git diff --quiet origin/main -- src/app/api/admin/match` exits 0.

- `POST` `src/app/api/admin/match/recompute/route.ts`: `isAdminUser` returns 403 before `req.json()` and before the upstream call.
- `POST` and `DELETE` `src/app/api/admin/match/decisions/route.ts`: `isAdminUser` returns 403 before the insert and before the delete.
- `POST` `src/app/api/admin/match/send-intro/route.ts`: `isAdminUser` returns 403 before the admin client is used for any write.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Button's base inline-flex defeated `hidden`**
- **Found during:** Task 1 (CSS hide)
- **Issue:** Tailwind v4 emits `.inline-flex` after `.hidden`. `className="hidden md:inline-flex"` on `Button` left the unprefixed `inline-flex` winning, so the control stayed visible below md.
- **Fix:** `Button` omits the base display when the caller class list contains a bare `hidden`. The match tests assert the rendered class list does not contain `inline-flex`.
- **Files modified:** `src/components/ui/Button.tsx`
- **Verification:** the class test passes, and a one-off Tailwind compile showed `.hidden` before `.inline-flex`, with `md:inline-flex` inside a later media query
- **Committed in:** `6223810e7`

**2. [Rule 2 - Missing critical] Name without email does not become Unknown**
- **Found during:** Task 2 (owner line)
- **Issue:** The contract names three branches. A display name with a null email is neither "both present" nor "neither". Mapping it to Unknown would drop the name the line already showed.
- **Fix:** That row reads `by {name} · Computed {recency}` with no email span.
- **Files modified:** `src/components/admin/AdminTabs.tsx`
- **Verification:** the three contracted branches are what the new test asserts; this branch is the remaining case
- **Committed in:** `338b4d61c`

---

**Total deviations:** 2 auto-fixed (1 bug, 1 missing critical)
**Impact on plan:** Both keep the planned classes and the three contracted owner lines. No new surface, no migration.

## Issues Encountered

- `git diff --name-only origin/main -- supabase/` lists files already on `feat/170-layout` before this plan. `git diff --name-only 0b0b08b99 -- supabase/` prints nothing. This plan did not touch `supabase/`.
- The seeded `e2e/layout-narrow.spec.ts` row `/admin/match — N-MATCH` was not run here. No browser check. What was verified: vitest for the handlers, the classes and the copy; `npx tsc --noEmit -p .` clean; `npm run lint` clean (admin-route manifest 20 routes, route contract 58 pages). `npx vitest run src/components/admin/` — 10 files, 77 tests, passed.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Ready for 170-07. The N-MATCH e2e row still has to go green in CI `e2e-seeded`; the classes and the handler guard are what that row reads.

## Self-Check: PASSED

- FOUND: `src/components/admin/AllocatorMatchQueue.tsx`
- FOUND: `src/components/admin/CandidateDetail.tsx`
- FOUND: `src/components/admin/match/ShortlistCard.tsx`
- FOUND: `src/components/ui/Button.tsx`
- FOUND: `src/components/admin/AdminTabs.tsx`
- FOUND: `src/app/(dashboard)/admin/page.tsx`
- FOUND: `cb3e6d277`
- FOUND: `6223810e7`
- FOUND: `8a0fab3c1`
- FOUND: `338b4d61c`

---
*Phase: 170-pagecopy*
*Completed: 2026-09-27*
