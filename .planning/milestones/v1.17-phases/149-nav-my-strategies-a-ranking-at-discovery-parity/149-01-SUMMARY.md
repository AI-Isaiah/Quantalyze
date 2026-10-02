---
phase: 149-nav-my-strategies-a-ranking-at-discovery-parity
plan: 01
subsystem: ui
tags: [react, visibility-predicate, react-table, discovery-parity, tdd, vitest]

# Dependency graph
requires:
  - phase: 148-owner-factsheet-without-cache-disclosure
    provides: the owner factsheet lane that /factsheet/{id} resolves through for an own unpublished row (the link target this table keeps)
provides:
  - "StrategyTable `visibility` prop (closed union, literal default \"published-only\") — the ONE parameterization that lets an owner-scoped surface reuse the shared discovery table"
  - "`effectiveViewMode` derivation making grid view unreachable on the owner recipe (no notFound() dead end, no existence oracle)"
  - "StrategyFilters `showViewToggle` prop (default true) hiding the table/grid toggle group"
  - "Row-level Simulate Impact gate on `status === \"published\"`"
  - "StrategyTable.visibility.test.tsx — the first behavioral pin on the in-component publication predicate"
affects: [149-02, 149-03, 149-04, 149-05, my-strategies, discovery, browse]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Optional prop with a LITERAL default = the public invariant (Shared Pattern C) — the default expression itself is what the phase gate greps"
    - "Derive-don't-clamp: a single `effectiveViewMode` derivation rather than clamping the `viewMode` state, so a stale persisted pref cannot resurrect a dead end"
    - "RED-first spec in a NEW file when the existing suite's fixture default is a pinned literal"

key-files:
  created:
    - src/components/strategy/StrategyTable.visibility.test.tsx
  modified:
    - src/components/strategy/StrategyTable.tsx
    - src/components/strategy/StrategyFilters.tsx

key-decisions:
  - "Grid view stays discovery-only: the view toggle is HIDDEN on the owner recipe (founder ruling 2026-08-05) rather than adding the `rowLinkMode` prop RESEARCH recommended. Supersedes the UI-SPEC Inherited-anatomy row that lists view modes as inherited — for THIS surface only."
  - "The toggle is suppressed wholesale, not disabled — a disabled control would advertise a destination that 404s (no-disabled-buttons UAT direction)."
  - "Simulate Impact is gated per ROW on `status === \"published\"`, not per surface, so the gate is behavior-invariant on /discovery and /browse where every row is already published."
  - "The owner arm returns `strategies.slice()`; the in-place `result.sort(...)` would otherwise re-order the caller's prop array."

patterns-established:
  - "Pattern: parameterize a leaked in-component predicate, never delete it — deletion widens a SHARED client component for every consumer"
  - "Pattern: a new-file RED-first spec proves the DELTA (owner arm red, default arm green before and after), not the world"

requirements-completed: [NAV-01]

# Metrics
duration: 16 min
completed: 2026-08-05
---

# Phase 149 Plan 01: StrategyTable visibility parameterization Summary

**`StrategyTable` gained a closed-union `visibility` prop with the literal default `"published-only"`, so an owner-scoped surface can render its own private/draft rows through the shared discovery table while `/discovery/[slug]` and `/browse/[slug]` stay byte-behavior-identical — with grid view made unreachable and Simulate Impact gated to published rows on the owner recipe.**

## Performance

- **Duration:** 16 min
- **Started:** 2026-08-05T16:28:00Z
- **Completed:** 2026-08-05T16:44:00Z
- **Tasks:** 2
- **Files modified:** 3 (1 created, 2 modified)

## Accomplishments

- **Closed the phase's one blocking defect (RESEARCH Pitfall 1).** `StrategyTable.tsx:331` filtered to `status === "published"` *inside* the component — invisible to `withPublishedOnly`, to the `no-raw-published-predicate` AST lint rule, and to all 912 lines of `StrategyTable.test.tsx` (whose row factory hard-codes `status: "published"` at `:89`, a pinned literal). It is now branched on `visibility`, not deleted.
- **Pinned the public invariant behaviorally, RED-first.** A new 440-line spec observed 6 failures against today's source before any implementation; the 6 green cases are the invariance half and stayed green throughout.
- **Made the grid dead end unreachable by construction.** `effectiveViewMode` is derived once and routed to the sort-key selection, the scroll-cue effect dep, and the render branch; the toggle group itself is hidden via a new `showViewToggle` prop.
- **Gated Simulate Impact on row status,** verified against the service that would reject the request.
- **Zero edits to `StrategyTable.test.tsx`** — its 31 pre-existing tests passing unchanged is itself the proof that the default preserved public behavior.

## Task Commits

1. **Task 1: RED-first visibility spec — the falsifier for Pitfall 1** — `077b77b8` (test)
2. **Task 2: Parameterize visibility, suppress grid, gate Simulate — then GREEN** — `c32fab66` (feat)

**Plan metadata:** this SUMMARY (docs: complete plan)

## Observed RED output (Task 1, required by the plan)

Against unmodified `StrategyTable.tsx` — `npx vitest run src/components/strategy/StrategyTable.visibility.test.tsx --no-file-parallelism`:

```
 × visibility='owner-all-statuses' renders private, draft AND published rows 41ms
 × shows P82 on the mapped row under the default sharpe sort and nothing on an unmapped row 9ms
 × formats a private row's metric cells identically to a published row with the same analytics 6ms
 × links a private row to /factsheet/{id} (not the category-detail dead end) 4ms
 × hides BOTH view-toggle buttons under visibility='owner-all-statuses' 10ms
 × renders the Simulate button ONLY on the published row of an owner-scoped table 10ms

 Test Files  1 failed (1)
      Tests  6 failed | 6 passed (12)
```

The failure mode is exactly the one the plan predicted: React silently ignores an unknown prop, so every `owner-all-statuses` render dropped its private/draft rows and `rowFor("Private Nebula")` threw `no rendered row for "Private Nebula"`.

The **6 passing** cases are the SC-2 invariance half and are green before *and* after the implementation — the spec measures the delta, not the world:

- the default recipe still drops every non-published row
- the owner arm hands the memo a copy (caller's array never re-ordered)
- identical 8-header column set + `#1` rank cell under both recipes
- no percentile suffix anywhere when `percentiles` is undefined
- the default recipe keeps BOTH view-toggle buttons
- the default recipe renders a Simulate button on every (published) row

After Task 2: **12/12 green.**

## UI-SPEC toggle deviation (required by the ruling)

The 149-UI-SPEC Inherited-anatomy table lists **"view modes (table/grid)"** as inherited by the my-strategies surface. The founder/orchestrator ruling of 2026-08-05 **supersedes it for this surface only**, and this plan implements the ruling:

- A grid card links to `${basePath}/${categorySlug}/${id}` (`StrategyGrid.tsx:52-55`), which resolves through `getStrategyDetail` → `withPublishedOnly` (`queries.ts:530`) → `notFound()` for an own unpublished row. That is both a dead end and an existence oracle (RESEARCH Pitfall 3).
- RESEARCH recommended Option A (a `rowLinkMode` prop). The ruling chose **Option B — hide the toggle** — as the simplest resolution with no dead end reachable. `rowLinkMode` is explicitly **out of scope** for this phase; grid stays discovery-only.
- Implementation detail that matters for review: `effectiveViewMode` is a *derivation*, not a clamp on the `viewMode` state. The prefs-hydration effect (`StrategyTable.tsx:259`) still writes `setViewMode(prefs.view)` untouched, so a stale persisted `view: "grid"` cannot resurrect the dead end — the derivation is the single enforcement point.
- **Public surfaces keep both view modes unchanged** (`showViewToggle` defaults to `true`).

## Simulator verification citation (required by the plan)

`analytics-service/routers/simulator.py:287-290`, read at execution time:

```python
        asyncio.to_thread(
            lambda: supabase.table("strategies")
            .select("id, name, status")
            .eq("id", req.candidate_strategy_id)
            .eq("status", "published")
            .maybe_single()
            .execute()
        ),
```

The service fetches the candidate with `.eq("status","published")` and rejects anything else, so a Simulate Impact button on an own draft/private row would fail on **every** click. The row-level gate (`{s.status === "published" && …}`) renders nothing instead — the service-side predicate remains the backstop (T-149-03). On `/discovery` and `/browse` the `visibility` default already guarantees every rendered row is published, so the gate is behavior-invariant there (proved by the "still renders the Simulate button on every row of the default discovery recipe" case, and by the untouched 912-line suite staying green).

## Files Created/Modified

- `src/components/strategy/StrategyTable.visibility.test.tsx` **(created, 440 lines)** — RED-first behavioral spec: SC-1c (owner arm renders private/draft/published), memo-copy non-mutation, SC-2a column/rank parity, SC-2b percentile suffix on an own private row, SC-4c full metric set with literal formatted cells (`+42.00%` / `+18.00%` / `1.50` / `-12.00%` / `+22.00%` / `+21.00%`), SC-5a `/factsheet/{id}` link, toggle-hide (both recipes), Simulate gate (both recipes). Fixture factory + leaf stubs cloned from `StrategyTable.test.tsx` (which is NOT edited); `categorySlug="vis-spec"` dodges the documented `discovery_view_preferences` localStorage CI flake.
- `src/components/strategy/StrategyTable.tsx` **(modified)** — `visibility` prop + WHY-comment; literal destructuring default `visibility = "published-only"`; branched `filtered` memo first line with `strategies.slice()` on the owner arm; `visibility` added to the memo dep array; `effectiveViewMode` derivation routed to `effectiveSortKey`/`effectiveSortDir`, the scroll-cue effect dep and the render branch; `showViewToggle={visibility !== "owner-all-statuses"}` passthrough; `SimulateImpactButton` wrapped in the status gate.
- `src/components/strategy/StrategyFilters.tsx` **(modified)** — `showViewToggle?: boolean` prop + WHY-comment, destructured `showViewToggle = true`, toggle group wrapped in `{showViewToggle && (…)}`.

## Decisions Made

1. **Hide the toggle, don't add `rowLinkMode`** (founder ruling, recorded above). Cost: a UI-SPEC amendment for this surface. Benefit: no dead end reachable at all, and the grid's other honest-degradation problem on unpublished rows (`StrategyGrid.tsx:78-83` gates `VerifiedBadge` on `trust_tier`, null by construction for unpublished) never becomes reachable either.
2. **Suppress the toggle wholesale rather than disabling it** — a disabled control still advertises the destination.
3. **Gate Simulate per ROW, not per surface.** Per-surface would have been simpler but would have made the gate behavior-*variant* on the public surfaces; per-row is provably invariant there.
4. **Derive `effectiveViewMode` rather than clamp `viewMode`** — leaves the prefs hydration byte-unchanged and keeps one enforcement point.
5. **Placed `visibility` last in the props interface and destructuring**, matching the file's append-only prop history; the gate greps the literal, not its position.

## Deviations from Plan

None — plan executed exactly as written.

**Total deviations:** 0
**Impact on plan:** None. All plan-time claims (the `:331` site, the in-place sort hazard, the `simulator.py` published gate, the `StrategyTable.test.tsx:89` pinned fixture default) were verified against source during execution and all held.

## Issues Encountered

None. Two notes worth carrying forward:

- The RED run passes cleanly under vitest even though `visibility` was not yet a declared prop — esbuild transforms without type-checking, so the TS error does not block the RED observation. `tsc --noEmit` was run after Task 2 and is clean.
- `node_modules` was absent in the worktree and was symlinked to the main repo's install (no package manager run, zero packages installed — consistent with threat register T-149-SC).

## Verification Results

| Check | Result |
|---|---|
| `npx vitest run StrategyTable.visibility.test.tsx StrategyTable.test.tsx --no-file-parallelism` | **43 passed / 43** (2 files) |
| `npx vitest run src/components/strategy --no-file-parallelism` | **344 passed / 344** (33 files) |
| `npx tsc --noEmit -p tsconfig.json` | clean |
| `npx eslint` on all three touched files | clean |
| `grep -c 'visibility = "published-only"' StrategyTable.tsx` | `1` (exactly one, as required) |
| `grep -c 'owner-all-statuses' StrategyTable.tsx` | `4` (≥2 required: prop union, filter branch, view derivation, toggle passthrough) |
| `grep -rn 'visibility=' '(dashboard)/discovery' 'browse' --include='*.tsx'` | **0 hits** — public surfaces pass no new prop |
| `git diff --stat` scope | only the 3 files in `files_modified` |
| commit deletion check (`--diff-filter=D`) | none in either commit |

## Threat Flags

None. No new network endpoint, auth path, file-access pattern, or schema change was introduced. The three registered mitigations are all implemented as specified:

- **T-149-01** (info disclosure via default) — literal default in the destructuring + the RED-first spec's default-arm cases.
- **T-149-02** (dead-end oracle) — `effectiveViewMode` + hidden toggle; grid unreachable by construction.
- **T-149-03** (self-inflicted DoS) — row-level `status === "published"` gate; `simulator.py`'s `.eq("status","published")` remains the backstop.
- **T-149-SC** — zero packages installed.

## Known Stubs

None. No hardcoded empty values, placeholder text, or unwired components were introduced. The `visibility="owner-all-statuses"` arm has no consumer yet **by design** — plan 149-03 mounts it from `/my-strategies`; until then the prop is exercised only by its spec, and every existing call site continues to use the default.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- **Ready for 149-03** (the `/my-strategies` page): mount `<StrategyTable visibility="owner-all-statuses" … />`. No other prop change is needed for owner rows to render with the full metric set, the `#n` rank column, percentile suffixes, and `/factsheet/{id}` links.
- **Ready for 149-05** (the structural gate): assertion 1 should grep the literal `visibility = "published-only"` in `StrategyTable.tsx` (present exactly once) and assertion 2 should grep for the *absence* of `visibility=` under `src/app/(dashboard)/discovery` and `src/app/browse` (currently 0 hits).
- **No overlap with the 149-02 sibling** — `queries.ts`, the percentile core, and `Badge.tsx` were not touched.
- **Carry to phase closeout:** the UI-SPEC Inherited-anatomy row on view modes needs the amendment note recorded above.

## Self-Check: PASSED

- `src/components/strategy/StrategyTable.visibility.test.tsx` exists on disk (440 lines, min_lines 80 satisfied).
- Commit `077b77b8` found in `git log --oneline --all`.
- Commit `c32fab66` found in `git log --oneline --all`.
- Both `must_haves.artifacts.contains` literals verified present (`visibility = "published-only"`, `showViewToggle`).
- Both `must_haves.key_links` verified: the filtered-memo first line branches on `visibility === "published-only"`, and `showViewToggle={visibility !== "owner-all-statuses"}` reaches `StrategyFilters`.

---
*Phase: 149-nav-my-strategies-a-ranking-at-discovery-parity*
*Completed: 2026-08-05*
