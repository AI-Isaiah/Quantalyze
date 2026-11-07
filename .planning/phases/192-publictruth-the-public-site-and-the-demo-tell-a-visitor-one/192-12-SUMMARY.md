---
phase: 192-publictruth-the-public-site-and-the-demo-tell-a-visitor-one
plan: 12
subsystem: admin-match-queue
tags: [demo-retirement, D-11, AllocatorMatchQueue, console-filter]
requires: ["192-07"]
provides:
  - "AllocatorMatchQueue takes only allocatorId and always reads /api/admin/match/<id>"
  - "console-filter helper and tests on the neutral example path /api/example/flaky"
affects:
  - src/components/admin/AllocatorMatchQueue.tsx
  - src/lib/playwright-console-filter.ts
tech-stack:
  added: []
  patterns: []
key-files:
  created: []
  modified:
    - src/components/admin/AllocatorMatchQueue.tsx
    - src/components/admin/AllocatorMatchQueue.test.tsx
    - src/lib/playwright-console-filter.ts
    - src/lib/playwright-console-filter.test.ts
    - src/app/api/admin/match/[allocator_id]/route.ts
    - src/lib/admin/match.ts
    - src/app/api/strategies/browse/route.ts
    - src/app/api/admin/partner-import/route.ts
key-decisions:
  - "Test fixtures in the other describes (structural guard, 170.1.2 D-01) dropped the demo props too, because the plan's own acceptance grep requires 0 matches in the test file"
requirements-completed: [ROUTE-03]
status: complete
commits: 2
plan_head_before: 40574c28a9232b8fe39d4a4501986a5d3444fbcf
plan_head_after: 92d7693d34f133e655b59fb84a54c3219515c91c
actuals:
  tokens: 12000
  tasks: 2
  commits: 2
completed: 2026-11-07
---

# Phase 192 Plan 12: Admin queue loses its demo mode Summary

AllocatorMatchQueue is now admin-only (props: `allocatorId`), the console-filter helper documents its lesson on `/api/example/flaky`, and four comments no longer describe the deleted `/api/demo/match` lane.

## Commits

| Task | Commit | What |
|------|--------|------|
| 1 (tracer) | `8534f26c5` | `forceReadOnly` and `sourceApiPath` removed; docblock rewritten; demo read-only cases removed from the tests |
| 2 | `92d7693d3` | helper docblock + fixtures neutral; four comment-only edits |

## Task 1

Caller check (`git grep -n "AllocatorMatchQueue" -- src` minus the component and its test): the only production caller is `src/app/(dashboard)/admin/match/[allocator_id]/page.tsx:55`, `<AllocatorMatchQueue allocatorId={allocator_id} />`. The other hits are `import type { CandidateRow | AllocatorPreferences }` lines, a `vi.mock` in `page.metadata.test.tsx` that stubs it as `() => null`, and comments. No caller passes a removed prop, so no checkpoint.

Component changes: `readOnly = !isMd`; shortcut-help effect returns on `!isLg` only, deps `[isLg]`; fetch `/api/admin/match/${allocatorId}`, deps `[allocatorId]`; demo banner and its now-unused `ScopedBanner` import deleted; breadcrumb on `profile`; mobile banner and the two action-bar and empty-state button blocks unconditional; heading fallback `display_name`, `company`, `email`, "Unknown allocator"; `readOnly`/`isReadOnly` attributes on `ShortlistCard`/`CandidateDetail` dropped (both default false).

Test changes: describe "C-0126 demo read-only" replaced by describe "allocator profile absent" holding the profile-null case (fetch mocked at the admin path, asserts the GET URL); case "the public read-only demo never falls back to the email in the heading" deleted; header docblock rewritten.

Neuter-and-restore proof for the below-768px guard (T-192-28). With `const readOnly = !isMd;` replaced by `const readOnly = false;`:

```
Tests  4 failed | 21 passed (25)
 x below md, action-bar and empty-state Recompute now issue no request and Edit preferences opens no panel
 x below md, shortlist Send intro and detail KEEP / SKIP / Send intro issue no request and open no panel
 x SFH-170-05: preferences opened at md then narrowed below md disable Save, say why, and write nothing
 x SFH-170-05: a confirmed recompute after narrowing below md mid-save is refused visibly, not dropped
```

All four are in describe "N-MATCH read-only below md". Restored from a scratchpad byte backup, `cmp` silent, then `Tests 25 passed (25)`.

Tracer gate (auto mode): `<verify>` re-run after the commit, 34 passed (25 + CandidateDetail 9), so expansion proceeded.

## Task 2

- Console-filter test count: 9 passed at HEAD before, 9 passed after (same cases, same assertions). RED proof: removing the URL arm (`|| error.url.includes(needle)`) fails 2 cases ("filters a 500 on /api/example/flaky when the URL field matches", "combines ignoreTextIncludes and ignoreTextOrUrlIncludes"); restored byte-equal, `cmp` silent, 9 passed.
- Comment-only edits: the four route and builder files, verified in `git show --format= 92d7693d3 -- <file>`: every changed line starts with `//`, ` *` or `/*` after the marker. Commit sha for the record: `92d7693d3`.

## Acceptance criteria (measured)

| Criterion | Result |
|-----------|--------|
| `grep -c forceReadOnly` component | 0 (baseline 15) |
| `grep -c sourceApiPath` component | 0 (baseline 5) |
| `grep -c -E 'forceReadOnly\|sourceApiPath\|api/demo/match'` test | 0 (baseline 25 lines) |
| `grep -c 'Actions disabled on the public demo'` component | 0 |
| `grep -c 'profile: null'` test | 3 (at least 1) |
| `grep -ci demo` console-filter source / test | 0 / 0 (baselines 4 / 16) |
| `demo/match` in the route, browse, partner-import files | 0 / 0 / 0 |
| `Match-queue and the public demo` in `src/lib/admin/match.ts` | 0 |

Test counts: AllocatorMatchQueue 28 before, 25 after (3 demo cases removed: two of the C-0126 describe, one email-heading; the profile-absent case kept).

## Gates

- `npx vitest run` on the three plan files: 25 + 9 + 9 = 43 passed. Wider run over every test that imports or reads a changed file (audit-coverage, audit-fanout-integration, mandate-columns-schema-sync, no-store-coverage, redteam-b02-regressions, seed-integrity, strategy-analytics-match-columns-schema-sync, the admin match page and route directories, `src/components/admin`, limiter-ordering, seam-venue-vocabulary invariant, console-filter): 32 files, 450 passed, 2 skipped (pre-existing skips, not mine).
- `npx tsc --noEmit`: exit 0.
- `npx eslint` on the 8 touched files: exit 0, no output.
- `npm run lint`: 0 errors, 2 warnings, both unused-variable warnings in `src/app/factsheet/[id]/v2/MetricsColumn.tsx` and `src/lib/factsheet/composite-read-path.ts` (Phase 193 fence; not touched here). Planning-hygiene, route-contract and admin-route-manifest checks OK.
- Not run: Playwright e2e (needs a seeded environment not available in this worktree).

## Deviations from Plan

**1. [Rule 3 - Blocking] Other describes in the test file also passed the demo props.** The structural-guard cases and the 170.1.2 D-01 `mountPayload` helper mounted with `forceReadOnly` and `sourceApiPath="/api/demo/match"`, and the plan's acceptance grep needs 0 matches in the file. They now mount `<AllocatorMatchQueue allocatorId={ALLOCATOR_ID} />`; their assertions are unchanged and pass. Also dropped the stale `forceReadOnly` mention in the matchMedia comment.

**2. [Rule 1 - Bug in the test] "Unknown allocator" case.** "a profile with no display_name heads the queue 'Unknown allocator', not '(unknown)'" relied on the read-only mode hiding the email. In admin mode the fixture's email would head the queue, so the fixture now also nulls `email` and the title says "no display_name, company or email". It still proves the final fallback; the email-fallback case above it still proves the email arm.

**Total deviations:** 2 auto-fixed. **Impact:** test-file only, no production behaviour beyond the plan.

## Residue (for plan 192-10 to book; classified, not touched)

- `ShortlistCard` `readOnly` and `CandidateDetail` `isReadOnly` props: no caller passes them now; kept per the plan's decision note, each with its own tests.
- `analytics-service/routers/match.py:221,1828` and `analytics-service/tests/test_match_router.py:2084,2890`: comments naming the deleted endpoint (analytics-service change needs mypy and a Railway deploy, per plan).
- `e2e/demo-public.spec.ts:44,303,307`: names `/api/demo/match` in an ignore entry and imports the console-filter helper. Belongs to the demo-page deletion (plan 192-11 territory); the helper API is unchanged so the import still compiles.
- `src/proxy.test.ts:224,225,357`: `/demo/match/...` and `/api/demo/match/...` path fixtures (plan 192-11 proxy-entry deletion).
- `docs/superpowers/plans/2026-04-09-portfolio-management-demo-hero.md:154`: historical plan doc mentioning `forceReadOnly`; not edited.
- `partner-import/route.ts` lines naming a "cap-intro demo sprint", "re-run during a demo" and "demo-day re-run window": unrelated sales-demo prose, left in place.
- Fixture strings "Demo Allocator", "Demo Capital", `demo@example.com` in the queue test payload: neutral fixture data, not the retired feature; left.

## Threat model

T-192-28 mitigated (the neuter proof above). T-192-29: the email fallback now applies on the admin-only page, the only caller. T-192-SC: no package installed.

## Known Stubs

None.

## Self-Check: PASSED

Files edited exist; commits `8534f26c5` and `92d7693d3` are ancestors of HEAD; `git rev-list --count` from the recorded base prints 2; STATE.md and ROADMAP.md untouched.
