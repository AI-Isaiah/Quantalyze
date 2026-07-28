---
phase: 29
plan: 03
subsystem: allocator-composer-ui
tags: [unify-03, unify-05, ui-tag, copy-relabel, scenario-browse-drawer, saved-portfolios]
requires:
  - "Plan 02 emits is_example on GET /api/strategies/browse (co-fetched, allow-list fenced)"
provides:
  - "StrategyBrowseRow.is_example field + neutral-outline 'Example' provenance tag on example-universe rows"
  - "Merged-catalog drawer title relabel: 'Browse strategies' (dropped 'verified')"
  - "SavedScenariosList 'portfolio' copy over the unchanged scenarios CRUD"
affects:
  - "Plan 04 composer consumes the is_example-aware drawer rows (no contract change — additive optional field)"
tech-stack:
  added: []
  patterns:
    - "Neutral-outline pill recipe reused verbatim from ScenarioBuilder.tsx:288 (border-text-muted / text-text-muted) — same family as the PROJECTED honesty pill; accent stays reserved for verified/action"
    - "Copy-only relabel over byte-identical fetch routes + codec-trichotomy Open delegation + Share/Compare logic"
key-files:
  created: []
  modified:
    - "src/app/(dashboard)/allocations/components/StrategyBrowseDrawer.tsx"
    - "src/app/(dashboard)/allocations/components/StrategyBrowseDrawer.test.tsx"
    - "src/app/(dashboard)/allocations/components/SavedScenariosList.tsx"
    - "src/app/(dashboard)/allocations/components/SavedScenariosList.test.tsx"
decisions:
  - "Example tag is the neutral-outline pill, NEVER accent and NEVER a filled <Badge>: accent = verified/action (DESIGN.md LOCKED); an example strategy is provenance metadata, not a status. Verbatim recipe from ScenarioBuilder.tsx:288."
  - "Drawer title/aria/empty-state drop 'verified' (the catalog now interleaves example-universe rows); the client-side filtered memo already interleaves all rows by name with no logic change."
  - "SavedScenariosList data-testid='saved-scenario-row' kept as a CODE identifier (the tests query it verbatim, and it is not user-facing copy); only UI copy strings were relabeled to 'portfolio'."
  - "Compare helper copy 'Select 2 or more scenarios…' relabeled to 'portfolios' for UNIFY-05 consistency (surfaces the noun in user-facing UI copy), test updated in lockstep."
  - "aria-labelledby/id pair moved together to 'saved-portfolios-heading' (kept internally consistent)."
metrics:
  duration: "~5 min"
  completed: "2026-06-23T09:49:34Z"
  tasks: 2
  files: 4
  tests_passing: 44
---

# Phase 29 Plan 03: Merged-Catalog Example Tag + Portfolio Copy Summary

Tagged example-universe rows with the neutral-outline "Example" provenance pill in one merged Browse drawer titled "Browse strategies", and relabeled the saved-list UI copy to "portfolio" while the underlying scenarios CRUD routes stay byte-identical — UNIFY-03 UI tag + UNIFY-05 copy, pure UI/copy with no schema, route, or logic change.

## What Was Built

### Task 1 — Drawer: `is_example` row field + Example tag + title relabel (commit `73cb71a8`)
- Added `is_example?: boolean` to `StrategyBrowseRow` (Plan 02 emits it on the browse JSON; structurally passes through the default fetcher with no fetcher change).
- Rendered the neutral-outline "Example" pill next to the row name, gated on `s.is_example === true`, using the verbatim recipe from `ScenarioBuilder.tsx:288`: `inline-flex items-center rounded-sm border border-text-muted px-2 py-0.5 text-[10px] uppercase tracking-wide font-semibold text-text-muted`. A per-row `data-testid` (`browse-example-tag-${id}`) anchors the non-vacuous render test.
- Relabeled the drawer `aria-label` (line 373), heading (392), and empty-state copy (452) to drop "verified" — the catalog now interleaves example-universe rows.
- Add gesture + AbortController fetch lifecycle (H-0117 loud-fail / H-0082b close-reset) untouched.
- Test T16 added: the tag renders ONLY for `is_example` rows (example row tagged, verified row NOT), and asserts the neutral-outline tokens (`border-text-muted` / `text-text-muted`) with explicit `not.toContain("bg-accent")` / `not.toContain("text-accent")` — a regression to accent or a filled Badge fails loudly. Three copy assertions (aria-label, T13, H-0117) moved in lockstep.

### Task 2 — SavedScenariosList: "portfolio" copy relabel (commit `fee9f62f`)
- Relabeled per UI-SPEC §Copywriting verbatim: heading "Saved scenarios" → "Saved portfolios"; empty-state heading + body; rename `aria-label` `Rename scenario` → `Rename portfolio`; validation copy ("Enter a name to save this portfolio." / "Portfolio names are limited to 120 characters."); mutation errors ("Couldn't rename/delete this portfolio."); list-load error ("Couldn't load your saved portfolios."); compare helper ("Select 2 or more portfolios…").
- `aria-labelledby`/`id` pair moved together to `saved-portfolios-heading`.
- Fetch URLs (`/api/allocator/scenario/saved/${id}` PATCH @322, DELETE @348), the codec-trichotomy `onOpen` delegation, the Share affordance, and the "Compare selected" gate are byte-identical. The `data-testid="saved-scenario-row"` is a code identifier (tests query it verbatim) and was deliberately left unchanged.
- Share-affordance error copy ("Couldn't create a share link" / "Couldn't revoke this link") references a *link*, not a scenario/portfolio — UI-SPEC does not relabel these, so they stay verbatim.
- Tests updated in lockstep across T_SL1/T_SL4/T_SL5/T_SL7b/T_SL7c/T_SL9/T_SL12.

## Verification

- `npx vitest run StrategyBrowseDrawer.test.tsx SavedScenariosList.test.tsx` → **44 passed** (20 drawer + 24 saved-list).
- `git diff --exit-code src/lib/scenario.ts` → clean (frozen engine untouched).
- `git status --porcelain supabase/migrations/` → empty (no migration files).
- No new `/api/allocator/scenario/saved` route; the two `fetch()` call URLs are byte-identical to baseline.
- `npx tsc --noEmit` → no errors in the two modified component files.

### Acceptance-criteria greps
| Criterion | Target | Actual |
|-----------|--------|--------|
| `is_example` in drawer | ≥ 2 | 3 (type field + JSDoc + render gate) |
| `border-text-muted` in drawer | ≥ 1 | 1 (neutral-outline pill) |
| `bg-accent` in drawer (Example must not add) | no increase | 1 (pre-existing Add button @505; tag added none) |
| `Browse verified strategies` in drawer | 0 | 0 |
| `portfolio` in saved-list | ≥ 6 | 19 |
| `No saved scenarios yet` in saved-list | 0 | 0 |
| saved-route fetch URLs | unchanged | PATCH @322 / DELETE @348 byte-identical |

## Deviations from Plan

None — plan executed exactly as written. The single judgment call (relabeling the "Select 2 or more scenarios…" compare-helper copy, which UI-SPEC's table did not enumerate explicitly) falls squarely under the UNIFY-05 directive to surface the noun "portfolio" in user-facing UI copy; the test was updated in lockstep. This is copy consistency, not a deviation.

## Scope Boundary (Phase 32, NOT this plan)

No modifications to `src/lib/scenario.ts`; no migration files; no `/scenarios` redirect; no `ScenarioBuilder` delete. Those are Phase 32.

## Known Stubs

None. The diff is a UI tag + copy relabel over already-wired data; no hardcoded empty values, placeholders, or unwired components were introduced.

## Threat Flags

None. No new network endpoint, auth path, file access, or schema change. The Example tag renders `s.name` (already the `displayStrategyName` pseudonymity-safe label from Plan 02 — pseudonymity enforced server-side; the drawer never receives the raw name), adds no raw-name field, and uses no accent (T-29-11 spoofing mitigation: accent stays reserved for verified). The saved-list relabel is copy-only over unchanged RLS-scoped CRUD (T-29-10 accept).

## Self-Check: PASSED

All 4 modified code files and the SUMMARY exist on disk; both per-task commit hashes (`73cb71a8`, `fee9f62f`) are present in the git log.
