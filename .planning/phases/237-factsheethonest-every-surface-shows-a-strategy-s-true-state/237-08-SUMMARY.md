---
phase: 237-factsheethonest-every-surface-shows-a-strategy-s-true-state
plan: 08
subsystem: ui
tags: [scenario-composer, returns-api, held-rerun, degrade-registry, fact-02]
requires:
  - phase: 237-factsheethonest
    provides: "plan 01: the returns API's analytics_updating boolean; plan 04: the factsheet.analytics-updating registry entry and ANALYTICS_UPDATING_LINE usage to mirror"
provides:
  - "ScenarioComposer's addedAnalyticsUpdatingById state, strict === true lazy parse, purge on removal and addedAnalyticsUpdatingByRef merged map"
  - "the S8 row line (scenario-detail-analytics-updating-{id}) in the detail note slot"
  - "registry entry scenario.analytics-updating with its SAMPLES fixture and scan ledger id"
affects: [237-13]
tech-stack:
  added: []
  patterns: ["one merged map per per-row discriminator, book wins, then lazy, then the conservative default"]
key-files:
  created: []
  modified:
    - src/app/(dashboard)/allocations/components/ScenarioComposer.tsx
    - src/app/(dashboard)/allocations/components/ScenarioComposer.test.tsx
    - src/lib/degrade-warnings.ts
    - src/lib/degrade-warnings.test.tsx
    - src/__tests__/degrade-warning-scan.test.ts
key-decisions:
  - "The book branch of the merged map reads false in this plan (strategyById.has(id) ? false : lazy ?? false), so plan 13 replaces that one false with the book field and adds its precedence cases"
  - "The render condition also requires !metricsAbsentSettled && !metricsUnavailable, so the line can never sit beside a note that says there are no figures, even if a body claims updating with no scalars"
requirements-completed: [FACT-02]
status: complete
commits: 1
plan_head_before: 73d18d712b56f0d60f79e11db00df31cf6f19856
plan_head_after: d74035b660fc1fc85335c17d3f2ff6d240a21a17
actuals:
  tokens: 5950
  tasks: 2
  commits: 1
---

# Phase 237 Plan 08: the Updating line on the composer's drawer-added rows Summary

**A drawer-added strategy whose lazily fetched returns body says `analytics_updating === true` keeps its stored figures and prints the verbatim `ANALYTICS_UPDATING_LINE` in its detail note slot (after the unpriced note, never beside the absent or unavailable notes), driven by one merged map shaped for plan 13's book-wins precedence.**

Agent branch: `worktree-agent-a1b57483f5dfb406f`. Re-based to `73d18d712b56f0d60f79e11db00df31cf6f19856` before any work (verified with `git rev-parse HEAD`). Final HEAD is the `plan_head_after` above, plus this SUMMARY's own commit.

## Accomplishments

- `ScenarioComposer.tsx`: `addedAnalyticsUpdatingById` state beside `addedSeriesStateById`. The lazy fetch's `d` shape gained `analytics_updating?: unknown`, and `settle` takes a final `analyticsUpdating: boolean` argument fed `d.analytics_updating === true`, written in the same settle step as `series_state`. The removal path purges it the way it purges `series_state`.
- `addedAnalyticsUpdatingByRef` (useMemo) has `addedSeriesStateByRef`'s shape: in the book reads `false` here (the My-allocation payload has no field yet, plan 13), otherwise the lazy value, otherwise `false`. It is threaded into `CompositionList` as a prop beside `addedSeriesStateByRef`.
- The row prints `<p class="mt-2 text-xs text-text-muted" data-degrade-id="scenario.analytics-updating" data-testid="scenario-detail-analytics-updating-{id}">{ANALYTICS_UPDATING_LINE}</p>` after the `nativeUnpriced` note and before the absent note. The sentence is imported from `status-surface-copy`, never inlined. The composer reads a boolean only and calls no census-scanned verdict symbol (`figure-gate-census` green).
- Registry entry `scenario.analytics-updating` (surface scenario, class in_progress, scope none, action null), a SAMPLES fixture, a marker-only pin row in `degrade-warnings.test.tsx`, and the id on the ScenarioComposer ledger row of `degrade-warning-scan.test.ts` (the scan's `tripHits` for the file did not move, because the new `<p>` carries the marker).

## Task Commits

1. Task 1 (tracer) and Task 2's cases: `d74035b66` feat(237-08): the composer's drawer-added row says it is updating during a re-run.
   Task 2 added no further source change: its strict-parse, ordering, coexistence, purge and book-precedence cases were written red-first with Task 1 (tests before code), so they live in the one code commit. Task 2 is the PROOF-01 neutering below plus the gates.

Tracer gate: Task 1's `<verify>` re-run end to end (589 tests green across the three files) before Task 2's neuters.

## PROOF-01 (RED then GREEN, verbatim)

Backups were byte copies kept outside the repo; each restore was done with `cp` and proven with `cmp` (exit 0) before the GREEN run.

**Pre-fix (cases written first, feature absent). RED:**

```
     × S8-1 a returns body that says analytics_updating true prints the verbatim line in the row's detail, with its degrade id, and the chip reads In blend 504ms
     × S8-3 with the unpriced note also rendered, the Updating line FOLLOWS it 93ms
     × S8-6 remove then re-add purges the fetched flag: the re-added row shows no line while its retry is in flight, and none after a body that says false 105ms
     × S8-7 a strategy that is in the book takes the book value, not the lazily fetched one: false in this plan 212ms
TestingLibraryElementError: Unable to find an element by: [data-testid="scenario-detail-analytics-updating-dddddddd-1111-2222-3333-444444444444"]
 Test Files  1 failed (1)
      Tests  4 failed | 7 passed | 475 skipped (486)
```

(The seven that passed are the no-line cases, which hold vacuously before the feature exists. S8-1 failed at the line lookup, after its figure, chip and series-state assertions had passed, so the failure is the missing line and nothing earlier.)

**Neuter 1: the lazy parse stores `true` unconditionally (`d.analytics_updating === true` replaced by `true`). RED:**

```
     × S8-2 analytics_updating false is not a claim: no line (strict === true, T-237-14) 227ms
     × S8-2 analytics_updating absent is not a claim: no line (strict === true, T-237-14) 126ms
     × S8-2 analytics_updating the string 'true' is not a claim: no line (strict === true, T-237-14) 161ms
     × S8-2 analytics_updating the number 1 is not a claim: no line (strict === true, T-237-14) 142ms
     × S8-2 analytics_updating null is not a claim: no line (strict === true, T-237-14) 125ms
     × S8-6 remove then re-add purges the fetched flag: the re-added row shows no line while its retry is in flight, and none after a body that says false 341ms
 Test Files  1 failed (1)
      Tests  6 failed | 5 passed | 475 skipped (486)
```

Restored with `cp`, `cmp` exit 0, then GREEN:

```
cmp=0
 Test Files  1 passed (1)
      Tests  11 passed | 475 skipped (486)
```

**Neuter 2: the purge skipped (the `_dropUpdating` body replaced by `return prev;`). RED:**

```
     × S8-6 remove then re-add purges the fetched flag: the re-added row shows no line while its retry is in flight, and none after a body that says false 619ms
 Test Files  1 failed (1)
      Tests  1 failed | 10 passed | 475 skipped (486)
```

Restored with `cp`, `cmp` exit 0.

**Extra neuter 3 (book wins, not demanded by the plan): the book branch disabled (`strategyById.has(a.id)` ANDed with `false`). RED:**

```
     × S8-7 a strategy that is in the book takes the book value, not the lazily fetched one: false in this plan 337ms
 Test Files  1 failed (1)
      Tests  1 failed | 10 passed | 475 skipped (486)
```

Restored with `cp`, `cmp` exit 0.

**Extra neuter 4 (coexistence guard, not demanded by the plan): `!metricsAbsentSettled` replaced by `true`. RED:**

```
     × S8-4 never coexists with the metrics-absent note: a body with the flag but no figures shows the absence note and no line 184ms
 Test Files  1 failed (1)
      Tests  1 failed | 10 passed | 475 skipped (486)
```

Restored with `cp`, `cmp` exit 0, `git status --short` empty (the working tree equals the commit).

**Final GREEN (restored, byte-equal to the commit):**

```
 Test Files  4 passed (4)
      Tests  599 passed (599)
```

(composer test, `degrade-warnings.test.tsx`, `degrade-warning-scan.test.ts`, `figure-gate-census.test.ts`, `--maxWorkers=3`.)

## Gates

- `npm run typecheck`: `tsc --noEmit` exit 0, no output.
- Lint, run step by step with eslint WITHOUT `--cache` (the cache path sits inside the shared `node_modules` symlink): `eslint` over the five changed files, no findings (only the BABEL deoptimise note about the 20k-line test file's size); `check-admin-route-manifest`, `check-route-contract`, `check-planning-hygiene` (rules 1, 6, 7) and `check-canonical-domain` all print OK. A whole-`src/` eslint was not run; the changed files were.
- Acceptance greps: `ANALYTICS_UPDATING_LINE` on code lines of the composer = import plus render (2); `scenario.analytics-updating` on code lines of `degrade-warnings.ts` = 1; `analytics_updating === true` in the composer present.

## Deviations from Plan

None. The plan executed as written. One honesty note rather than a deviation: S8-5 (the metrics-unavailable case) cannot bite the `!metricsUnavailable` clause of the render condition, because a failed fetch never writes the lazy flag (`markMetricsUnavailable` does not call `settle`), so the line is already absent by construction. The clause is kept as the render guard the plan asks for ("never coexists"); the case pins the user-visible outcome, and the absent-note guard is the one a neuter can and did turn red (neuter 4).

## Known Stubs

None. The book branch's `false` is the plan's stated interim (plan 13 owns the book field), not a placeholder that reaches a user as a claim: it only means a book strategy prints no line yet.

## Threat Flags

None. Only a client-side strict boolean parse of an existing response field was added (T-237-14, mitigated and covered by S8-2's string-"true", number and null cases). No new endpoint, auth path or schema.

## Self-Check: PASSED

- `src/app/(dashboard)/allocations/components/ScenarioComposer.tsx`: FOUND
- `src/lib/degrade-warnings.ts`: FOUND
- Commit `d74035b66`: an ancestor of HEAD (the one code commit)
