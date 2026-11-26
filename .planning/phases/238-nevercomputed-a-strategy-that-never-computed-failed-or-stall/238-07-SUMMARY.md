---
phase: 238-nevercomputed-a-strategy-that-never-computed-failed-or-stall
plan: 07
subsystem: testing
tags: [never-computed, computed_at, null-arm, proof-01, FACT-03]
status: complete
requires: [238-04, 238-06]
provides:
  - "One NEVERCOMPUTED NULL pin in each of five existing test files; no source file changed"
  - "PROOF-01 for every pin: the source NULL arm neutered on a byte backup turns it RED, the byte-identical restore turns it GREEN"
affects: [238-08, 238-09]
key-files:
  created: []
  modified:
    - src/components/strategy/SyncBadge.trade-fetch.test.tsx
    - src/components/admin/AdminTabs.test.tsx
    - src/components/strategy/FactsheetPreview.test.tsx
    - src/components/strategy/StrategyGrid.test.tsx
    - src/components/strategy/StrategyTable.stale-analytics.test.tsx
key-decisions:
  - "The AdminTabs NULL arm is overdetermined: the plan's named neuter (everComputed forced true) alone does NOT redden any NULL case, because formatRecency and formatDay also turn a null into the dash. The pin was proven with the neuter that actually reads a null as a date (see Neuter 2 to 4)"
  - "The computed_at sort pins 'where an empty-string row sorts', which is the OLD end of the key (first ascending, last descending). It is not a missing-last rule: compareWithMissingLast treats the empty string as a value, so the first draft of the case (missing-last in both directions) was wrong and was corrected against the real behaviour before commit"
requirements-completed: [FACT-03]
completed: 2026-11-26
commits: 2
plan_head_before: 6d5d29ecac6112173f1b93ea60b8bb001763b7d4
plan_head_after: e94bce619bb4807096615b5570006dc827c179ae
actuals:
  tokens: 3500
  tasks: 2
  commits: 2
---

# Phase 238 Plan 07: NEVERCOMPUTED NULL pins on five reader surfaces Summary

A later edit can no longer quietly make a never-computed row claim a compute time on the badge tooltip, the admin review card, the wizard preview, the health pill or the computed_at sort, and each pin is shown able to fail.

## What shipped

No source file changed. Commits:

- `e964db809` test(238-07): SyncBadge, six title branches (Task 1, tracer)
- `e94bce619` test(238-07): AdminTabs, FactsheetPreview, StrategyGrid, StrategyTable (Task 2; lists exactly the four test files)

| Surface (UI-SPEC) | Test file | NEVERCOMPUTED case |
|---|---|---|
| D1 SyncBadge | `SyncBadge.trade-fetch.test.tsx` | Loops six title branches (track record with no trade fetch applicable, track record binding over a recorded fetch, fetch current, stale, future, never recorded). Each renders a dated row and a `computedAt={null}` row: same visible text, same dot, same render gate, and the null tooltip equals the dated tooltip minus the ` Analytics last computed 1h ago.` suffix, with the suffix pinned present on the dated one so a null badge cannot pass vacuously |
| D6 admin card | `AdminTabs.test.tsx` | `computing`, `failed` and `pending` first-ever rows with `computed_at: null` read `Computed —`; a row holding figures with a null date also reads `Computed —` and not `just now` or `1970` |
| D2 wizard preview | `FactsheetPreview.test.tsx` | `draft`, `pending` and `verified` with `computedAt={null}`: the state's dateless caption shows (draft and pending) and no `Data from exchange API` renders in any |
| D7 HealthScore | `StrategyGrid.test.tsx` | The card's pill title for a null `computed_at` scores below a fresh compute and below a 400-day-old one (the dated pair differ, so the freshness component is live) |
| D8 sort | `StrategyTable.stale-analytics.test.tsx` | `initialSort computed_at` in both directions, input order never-then-empty and empty-then-never: the null row takes the slot a real `computed_at: ""` row takes (the old end of the key) |

Existing coverage reused, and what it did not cover: SyncBadge already had a null case (`computedAt null with a recent fetch still renders the fetch`) but only for the healthy-fetch branch, so the new loop covers the other five. AdminTabs already had the 166.5 cases, which use an insert-time default date, not NULL, so they do not pin the post-238 shape.

## PROOF-01 records (byte backups in the session scratchpad, outside the repo)

Every neuter: `cp` source to backup, edit, targeted `vitest run <file> -t NEVERCOMPUTED --maxWorkers=2`, `cp` backup back, `cmp backup source`, re-run. The passed count was above 0 on every GREEN run (a `-t` that matches nothing would show 0).

**Neuter 1 (SyncBadge)**: `const computedDate = computedAt ? new Date(computedAt) : null;` became `const computedDate = new Date(computedAt ?? now);`

```
     × NEVERCOMPUTED: track record, no trade fetch applicable — computedAt null adds no 'Analytics last computed' and changes no dot, label or render gate
     (the other five branches also RED)
      Tests  6 failed | 38 skipped (44)
cmp=0
 Test Files  1 passed (1)
      Tests  6 passed | 38 skipped (44)
```

**Neuter 2 (AdminTabs, the plan's named neuter, `everComputed` forced `true`)**: did NOT redden. This is a finding, not a pass of the pin.

```
 Test Files  1 passed (1)
      Tests  4 passed | 36 skipped (40)
cmp=0
 Test Files  1 passed (1)
      Tests  4 passed | 36 skipped (40)
```

Why: with `everComputed` true the code calls `formatRecency(null)`, whose own `!iso` guard returns the dash, and under that `formatRelativeTime`'s fall-through `formatDay(null)` also returns the dash. Three arms say "dash" for a null. The plan's neuter therefore cannot show the pin able to fail, so two real neuters were run instead.

**Neuter 3 (AdminTabs, `formatRecency` guard removed)**: `if (!iso) return "—"; return formatRelativeTime(iso, Date.now());` became `return formatRelativeTime(iso ?? new Date().toISOString(), Date.now());`. Reddens the figures-held case only, as designed (the ever-computed gate still shields the realistic never-computed rows).

```
     × NEVERCOMPUTED: even a row that holds figures reads 'Computed —' when computed_at is NULL (the date arm stands alone)
      Tests  1 failed | 3 passed | 36 skipped (40)
cmp=0
 Test Files  1 passed (1)
      Tests  4 passed | 36 skipped (40)
```

**Neuter 4 (AdminTabs, both: `everComputed = true` AND the Neuter 3 edit, i.e. "a null date is read as now")**: reddens all four AdminTabs cases.

```
     × NEVERCOMPUTED: a computing first-ever row with computed_at NULL and no figures reads 'Computed —', not a date
     × NEVERCOMPUTED: a failed first-ever row with computed_at NULL and no figures reads 'Computed —', not a date
     × NEVERCOMPUTED: a pending first-ever row with computed_at NULL and no figures reads 'Computed —', not a date
     × NEVERCOMPUTED: even a row that holds figures reads 'Computed —' when computed_at is NULL (the date arm stands alone)
      Tests  4 failed | 36 skipped (40)
cmp=0
 Test Files  1 passed (1)
      Tests  4 passed | 36 skipped (40)
```

**Neuter 5 (FactsheetPreview)**: `dateLabel` built from null: `const dateLabel = \`Data from exchange API · ${formatDay(computedAt)}\`;`

```
     × draft with computedAt null shows its dateless caption and no 'Data from exchange API'
     × pending with computedAt null shows its dateless caption and no 'Data from exchange API'
     × verified with computedAt null prints no 'Data from exchange API' label either
      Tests  3 failed | 15 skipped (18)
cmp=0
 Test Files  1 passed (1)
      Tests  3 passed | 15 skipped (18)
```

**Neuter 6 (health-score)**: `freshnessScore` `if (!computedAt) return 0;` became `return 100;`

```
     × scores a null computed_at below a fresh compute AND below a 400-day-old one
      Tests  1 failed | 15 skipped (16)
cmp=0
 Test Files  1 passed (1)
      Tests  1 passed | 15 skipped (16)
```

**Neuter 7 (StrategyTable sort)**: `return s.analytics.computed_at ?? "";` became `?? "9999-12-31T00:00:00Z"`.

```
     × desc: a never-computed row takes the slot an empty-string row takes, on the old end of the key
     × asc: a never-computed row takes the slot an empty-string row takes, on the old end of the key
      Tests  2 failed | 23 skipped (25)
cmp=0
 Test Files  1 passed (1)
      Tests  2 passed | 23 skipped (25)
```

Surfaces proven: five (SyncBadge, AdminTabs, FactsheetPreview, HealthScore, sort). After every neuter `cmp` printed 0, and `git status --porcelain -- src` after the run listed only the four test files then being edited (none of the five source files).

## Verification run (load-limited, targeted)

- `npx vitest run` over the five files, `--maxWorkers=2`: Test Files 5 passed (5), Tests 143 passed (143).
- `npm run typecheck` (`tsc --noEmit`): exit 0.
- `npx eslint` over the five test files: exit 0 (no output). Not the repo-wide `npm run lint`, to respect the load limit.
- `npx tsx scripts/check-planning-hygiene.ts`: exit 0.
- After commit 2, `git status --porcelain -- src` prints nothing.

## Deviations from Plan

**1. [Rule 1 - Bug in the plan's neuter] AdminTabs neuter named by the plan does not redden the pin**
- **Found during:** Task 2 PROOF-01
- **Issue:** `everComputed` forced `true` still renders `Computed —` for a null date (formatRecency and formatDay both absorb null), so the plan's named neuter cannot demonstrate the pin able to fail.
- **Fix:** proved the pin with the neuters that read a null as a date (Neuters 3 and 4 above), and recorded the literal neuter's GREEN result verbatim (Neuter 2). No source change.
- **Commit:** `e94bce619`

**2. [Rule 1 - Bug in my first draft] sort case asserted missing-last**
- **Found during:** Task 2 first run (the asc case failed on unmodified source)
- **Issue:** `compareWithMissingLast` treats `""` as a value, so a null row sorts at the old end of the key, not after every dated row in both directions.
- **Fix:** pinned the real contract (same slot as a real `""` row, both directions, both input orders) before committing. The NULL arm exists at HEAD; no source finding.

## Known Stubs

None.

## Observations

- A first full-five-file run hit a 5000 ms test timeout and a `Failed to start forks worker` error; the host had stalled for roughly 9 minutes of that run (wall-clock gap of about an hour in the machine's uptime log). The same tests passed in the targeted runs before and after; the clean re-run is the 143-test result above. Nothing in the tests is slow (the sort case runs in tens of milliseconds).
- The HealthScore pin's test name does not contain the word NEVERCOMPUTED itself, but its describe does, so `-t NEVERCOMPUTED` matches it (1 passed).

## Threat Flags

None. No source, endpoint or schema changed. T-238-20 (a later edit dropping a NULL arm) is mitigated by the five pins above.

## Self-Check: PASSED

- Commits `e964db809` and `e94bce619` are ancestors of HEAD.
- The five test files exist and each contains `NEVERCOMPUTED`.
- `git show --name-only --format= e94bce619` lists only the four test files; `git status --porcelain -- src` is empty.
