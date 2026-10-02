---
phase: 54-verification-v1-3-debt-cleanup-visual-regression-replacement
plan: 02a
type: execute
wave: 2
depends_on: [54-01a]
files_modified:
  - src/components/strategy-v2/StrategyV2Shell.tsx
  - src/components/strategy/CompareCorrelationMatrix.tsx
  - src/components/strategy/FactsheetPreview.tsx
  - src/components/strategy/FreshnessBadge.tsx
  - src/components/strategy/HealthScore.tsx
  - src/components/strategy/HoldingFactsheet.tsx
  - src/components/strategy/ManagerIdentityPanel.tsx
  - src/components/strategy/PendingIntros.tsx
  - src/components/strategy/PercentileRankBadge.tsx
  - src/components/strategy/StarToggle.tsx
  - src/components/strategy/StrategyFilters.tsx
  - src/components/strategy/StrategyHeader.tsx
  - src/components/strategy/SyncBadge.tsx
autonomous: true
requirements: [BP-03]
must_haves:
  truths:
    - "Every src/components/strategy/** and src/components/strategy-v2/** orphan file is migrated off raw text-[Npx]"
    - "src/components/charts/WorstDrawdowns.tsx (under charts/**, already off-globbed) is NOT touched"
  artifacts:
    - path: "src/components/strategy/StrategyHeader.tsx"
      provides: "Clean strategy-tree file with zero raw text-[Npx]"
      contains: "text-fixed-"
  key_links:
    - from: "migrated strategy/strategy-v2 files"
      to: "src/app/globals.css @theme fixed tokens (from 54-01a)"
      via: "text-fixed-N utility classes"
      pattern: "text-fixed-(9|10|11|12|13|18|22|24|28|32|36)"
---

<objective>
Migrate the `src/components/strategy/**` + `src/components/strategy-v2/**` component tree off raw `text-[Npx]` onto the byte-identical `text-fixed-N` tokens added in Plan 54-01a.

Purpose: One of three parallel halves of the BP-03 source migration (alongside 54-01b allocations/factsheet and 54-02b other-components/app-pages). Together they leave zero non-frozen, non-test files carrying raw `text-[Npx]`, the precondition for the repo-wide `error` flip in Plan 54-05. These three halves touch disjoint file sets, so they run in the same wave in parallel.
Output: ~13 migrated files with zero raw `text-[Npx]`. NO globals.css edits (54-01a added every needed alias).
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/STATE.md
@.planning/phases/54-verification-v1-3-debt-cleanup-visual-regression-replacement/54-PATTERNS.md

<interfaces>
Depends on 54-01a's fixed tokens in globals.css. Mapping: `text-[Npx]` → `text-fixed-N` (token = N/16 rem, byte-identical). 54-01a added an alias for EVERY size present (9,10,11,12,13,18,22,24,28,32,36) including StrategyHeader's larger size — do NOT add or edit any alias in globals.css here (that file is owned by 54-01a; this plan must not touch it).
`src/components/charts/WorstDrawdowns.tsx` is under the existing `charts/**` off-glob — it is NOT in scope; do not touch it.
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Migrate the src/components/strategy + strategy-v2 tree</name>
  <read_first>
    - Each strategy/* and strategy-v2/* file in files_modified
    - src/app/globals.css (the @theme fixed tokens added in 54-01a — to confirm available aliases; read-only)
    - .planning/phases/54-.../54-PATTERNS.md (the text-[Npx]→text-fixed-N rule)
  </read_first>
  <action>
    Swap each raw `text-[Npx]` className in the strategy/* + strategy-v2/* files (CompareCorrelationMatrix, FactsheetPreview, FreshnessBadge, HealthScore, HoldingFactsheet, ManagerIdentityPanel, PendingIntros, PercentileRankBadge, StarToggle, StrategyFilters, StrategyHeader, SyncBadge, StrategyV2Shell) for the matching `text-fixed-N` token added in 54-01a. StrategyHeader.tsx carries a larger size (≥18px) — its alias already exists in globals.css (54-01a added all sizes), so do NOT touch globals.css; just use the existing `text-fixed-N`. Pure className swaps only — same N, byte-identical. Surgical (CLAUDE.md Rule 3).
  </action>
  <verify>
    <automated>grep -rEl "text-\[[0-9]+px\]" src/components/strategy src/components/strategy-v2 --include="*.tsx" | grep -v "\.test\." ; npx eslint "src/components/strategy/**/*.tsx" "src/components/strategy-v2/**/*.tsx"</automated>
  </verify>
  <acceptance_criteria>
    - The grep prints NO non-test file in either tree
    - `npx eslint` reports 0 `no-raw-font-px` warnings in these trees
    - `git diff --stat -- src/app/globals.css` is EMPTY (globals.css owned by 54-01a)
  </acceptance_criteria>
  <done>strategy/* and strategy-v2/* orphan files carry zero raw text-[Npx]; globals.css untouched.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| (none new) | Pure className token swaps; no runtime input, network, or DB |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-54-02-01 | Tampering | charts/WorstDrawdowns.tsx (off-globbed) wrongly touched | mitigate | Out of scope + verify grep excludes it; byte-identical rem swap elsewhere |

No high/medium threats — className migration, no new attack surface.
</threat_model>

<verification>
- Strategy + strategy-v2 grep for non-test `text-[Npx]` returns empty.
- `npx eslint` on both trees — 0 `no-raw-font-px` warnings.
- `git diff --stat -- src/app/globals.css` — empty.
</verification>

<success_criteria>
The strategy + strategy-v2 component trees are free of raw `text-[Npx]`; globals.css untouched; charts/WorstDrawdowns untouched.
</success_criteria>

<output>
Create `.planning/phases/54-verification-v1-3-debt-cleanup-visual-regression-replacement/54-02a-SUMMARY.md` when done.
</output>
