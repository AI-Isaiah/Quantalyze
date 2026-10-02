---
phase: 54-verification-v1-3-debt-cleanup-visual-regression-replacement
plan: 01b
type: execute
wave: 2
depends_on: [54-01a]
files_modified:
  - src/app/(dashboard)/allocations/AllocationDashboardV2.tsx
  - src/app/(dashboard)/allocations/AllocationsTabs.tsx
  - src/app/(dashboard)/allocations/MandateTabPanel.tsx
  - src/app/(dashboard)/allocations/ScenarioFlaggedHoldingsList.tsx
  - src/app/(dashboard)/allocations/components/BridgeWidget.tsx
  - src/app/(dashboard)/allocations/components/HoldingDetail.tsx
  - src/app/(dashboard)/allocations/components/ScenarioBenchmarkSection.tsx
  - src/app/(dashboard)/allocations/components/ScenarioCompareTable.tsx
  - src/app/(dashboard)/allocations/components/ScenarioComposer.tsx
  - src/app/(dashboard)/allocations/components/ScenarioFooter.tsx
  - src/app/(dashboard)/allocations/components/StrategyBrowseDrawer.tsx
  - src/app/(dashboard)/allocations/components/WeightOptimizerSection.tsx
  - src/app/(dashboard)/allocations/widgets/outcomes/OutcomesWidget.tsx
  - src/app/(dashboard)/allocations/widgets/performance/ScenarioFactsheetChart.tsx
  - src/app/(dashboard)/allocations/widgets/risk/CorrelationMatrix.tsx
  - src/app/(dashboard)/allocations/widgets/risk/TailRisk.tsx
  - src/app/(dashboard)/allocations/widgets/risk/VarExpectedShortfall.tsx
  - src/app/factsheet/[id]/v2/MandatePanels.tsx
  - src/app/factsheet/[id]/v2/MetricsColumn.tsx
  - src/app/factsheet/[id]/v2/StressWindowsPanel.tsx
  - src/app/factsheet/[id]/v2/page.tsx
  - src/app/factsheet/[id]/tearsheet/page.tsx
autonomous: true
requirements: [BP-03]
scope_justification: >
  22 files exceeds the 15-file soft threshold, but every change is the SAME mechanical
  className swap (text-[Npx] -> text-fixed-N) — find-and-replace across thin component
  files, not per-file design reasoning. Per-file context cost is near-zero. Splitting
  further adds orchestration overhead with no executor-context benefit; the eslint +
  frozen-spine + GUARD-02 acceptance gates catch any miss. Accepted per the plan-checker's
  documented scope_justification alternative.
must_haves:
  truths:
    - "Every allocations/** and factsheet/** non-frozen orphan file is migrated off raw text-[Npx]"
    - "phase-52-frozen-spine-guards.test.ts stays green (EquityChart/TimeSeriesChart/HistogramChart/MasterBrush untouched, zero git-diff)"
    - "FactsheetBody GUARD-02 byte-equivalence stays green"
  artifacts:
    - path: "src/app/(dashboard)/allocations/components/ScenarioComposer.tsx"
      provides: "Allocator-journey file migrated to text-fixed-N"
      contains: "text-fixed-"
  key_links:
    - from: "migrated allocations/factsheet files"
      to: "src/app/globals.css @theme fixed tokens (from 54-01a)"
      via: "text-fixed-N utility classes"
      pattern: "text-fixed-(9|10|11|12|13|18|22|24|28|32|36)"
---

<objective>
Migrate the allocator-journey + factsheet-v2 orphan files off raw `text-[Npx]` font sizes onto the byte-identical fixed-value Tailwind tokens added in Plan 54-01a. Do NOT edit the four FROZEN chart files (they are off-globbed in 54-01a and in the FROZEN_ISLANDS git-diff guard).

Purpose: This clears the two largest orphan trees (allocations: ~75 sites, factsheet-v2: ~67 sites) while preserving byte-identity so the deferred golden re-bake (VERIFY-04) and the frozen-spine guard stay valid. Together with 54-02a/54-02b it leaves zero non-frozen, non-test files carrying raw `text-[Npx]` — the precondition for the repo-wide `error` flip in Plan 54-05.
Output: ~22 migrated source files with zero raw `text-[Npx]`. NO globals.css / eslint.config.mjs edits (54-01a added every needed alias).
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
@.planning/phases/54-verification-v1-3-debt-cleanup-visual-regression-replacement/54-CONTEXT.md

<interfaces>
Depends on 54-01a's fixed tokens in globals.css. Mapping: `text-[Npx]` → `text-fixed-N` (token = N/16 rem, byte-identical). 54-01a added an alias for EVERY size present (9,10,11,12,13,18,22,24,28,32,36), so every swap in this plan has a token waiting — do NOT add or edit any alias in globals.css here (that file is owned by 54-01a; this plan must not touch it).
The drift test (tests/a11y/design-token-drift.test.ts:117) iterates Object.entries(TYPE_SCALE) ONLY, so the fixed-* tokens are invisible to it.
The 4 FROZEN chart files (EquityChart.tsx, TimeSeriesChart.tsx, HistogramChart.tsx, MasterBrush.tsx) are off-globbed in 54-01a — never open them to edit.
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Migrate the allocations/** non-frozen orphan files</name>
  <read_first>
    - Each allocations file in files_modified (read before editing; EquityChart.tsx is EXCLUDED — never open to edit)
    - src/app/(dashboard)/allocations/components/HoldingsTable.tsx (an already-clean sibling at error — the target end-state pattern)
    - src/app/globals.css (the @theme fixed tokens added in 54-01a — to confirm available aliases; read-only, do not edit)
    - .planning/phases/54-.../54-PATTERNS.md (globals.css section — the text-[Npx]→text-fixed-N rule)
  </read_first>
  <action>
    For every allocations/** file in this plan's files_modified (NOT EquityChart.tsx — it is frozen + off-globbed), replace each raw `text-[Npx]` className token with the corresponding `text-fixed-N` utility added in Plan 54-01a. This is a pure className string swap — same N, byte-identical render. Every size already has an alias (54-01a added all 11) — do NOT touch globals.css. Touch NOTHING else in these files (CLAUDE.md Rule 3 — surgical). For `ScenarioComposer.tsx` (17 sites) and `OutcomesWidget.tsx` (29 sites) work methodically site-by-site. After editing, `grep -En "text-\[[0-9]+px\]"` each file must return zero. The `scenario.ts`/`FactsheetBody` byte-equivalence guard is NOT in this tree, but `ScenarioComposer` renders an inner EquityChart — confirm you edited only ScenarioComposer's own classNames, not EquityChart's.
  </action>
  <verify>
    <automated>grep -rEl "text-\[[0-9]+px\]" "src/app/(dashboard)/allocations" --include="*.tsx" | grep -v EquityChart | grep -v "\.test\." | grep -v "\.spec\." ; npx eslint "src/app/(dashboard)/allocations/**/*.tsx"</automated>
  </verify>
  <acceptance_criteria>
    - The grep above prints NO non-frozen, non-test allocations file (all migrated)
    - `npx eslint` on the allocations tree reports 0 errors and 0 `no-raw-font-px` warnings except inside EquityChart.tsx (off-globbed)
    - `git diff --stat -- "src/app/(dashboard)/allocations/widgets/performance/EquityChart.tsx"` is EMPTY (frozen file untouched)
    - `git diff --stat -- src/app/globals.css` is EMPTY (globals.css owned by 54-01a, not touched here)
  </acceptance_criteria>
  <done>All allocations/** non-frozen orphan files are on text-fixed-N tokens; EquityChart.tsx and globals.css have zero git-diff.</done>
</task>

<task type="auto">
  <name>Task 2: Migrate the factsheet/[id]/** non-frozen orphan files</name>
  <read_first>
    - Each factsheet file in files_modified (TimeSeriesChart/HistogramChart/MasterBrush are EXCLUDED — never open to edit)
    - src/app/factsheet/[id]/v2/FactsheetView.tsx (already-clean sibling at error — target pattern)
    - src/app/factsheet/[id]/v2/FactsheetBody.tsx and its GUARD-02 innerHTML test (confirm none of the files in this plan touch FactsheetBody's byte-locked output)
  </read_first>
  <action>
    For every factsheet file in this plan's files_modified (NOT TimeSeriesChart/HistogramChart/MasterBrush — frozen + off-globbed), swap each raw `text-[Npx]` for the matching `text-fixed-N` utility added in 54-01a. `MetricsColumn.tsx` (31 sites) and `MandatePanels.tsx` (15 sites) and `StressWindowsPanel.tsx` (12 sites) are the heavy files — work site-by-site. `factsheet/[id]/v2/page.tsx` and `factsheet/[id]/tearsheet/page.tsx` are lighter. The locked invariant is `FactsheetBody` byte-equivalence on the GUARD-02 surface — none of the files here ARE FactsheetBody, but verify the GUARD-02 innerHTML test stays green after migration. Do NOT touch globals.css (every alias already exists from 54-01a). Surgical edits only.
  </action>
  <verify>
    <automated>grep -rEl "text-\[[0-9]+px\]" "src/app/factsheet" --include="*.tsx" | grep -vE "(TimeSeriesChart|HistogramChart|MasterBrush)" | grep -v "\.test\." ; npx vitest run src/app/factsheet/[id]/v2/ 2>/dev/null || npx eslint "src/app/factsheet/**/*.tsx"</automated>
  </verify>
  <acceptance_criteria>
    - The grep above prints NO non-frozen, non-test factsheet file
    - The FactsheetBody GUARD-02 innerHTML test passes (byte-equivalence intact)
    - `git diff --stat` shows zero changes to TimeSeriesChart.tsx / HistogramChart.tsx / MasterBrush.tsx
    - `git diff --stat -- src/app/globals.css` is EMPTY
  </acceptance_criteria>
  <done>All factsheet/** non-frozen orphan files are on text-fixed-N tokens; the 3 frozen chart-internal SVG files have zero git-diff; GUARD-02 green.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| (none new) | Pure className edits; no runtime input, no network, no DB |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-54-01-01 | Tampering | Frozen chart files (EquityChart + 3 SVG) | mitigate | Never edited; phase-52-frozen-spine-guards git-diff guard stays green (zero-diff asserted in acceptance criteria) |
| T-54-01-02 | Tampering | FactsheetBody byte-locked output | accept | None of this plan's files ARE FactsheetBody; GUARD-02 innerHTML test re-run as a tripwire |

No high/medium threats — className migration, no new attack surface.
</threat_model>

<verification>
- `npx eslint "src/**/*.{ts,tsx}"` — no NEW errors introduced (rule still `warn` repo-wide until 54-05); allocations + factsheet trees show 0 `no-raw-font-px` warnings except inside the 4 off-globbed frozen files.
- `npx vitest run tests/a11y/design-token-drift.test.ts src/__tests__/phase-52-frozen-spine-guards.test.ts` — both green.
- `git diff --stat` on the 4 frozen files + globals.css — empty.
</verification>

<success_criteria>
allocations/** and factsheet/** non-frozen orphans carry zero raw `text-[Npx]`; the 4 frozen chart files and globals.css are untouched (zero git-diff); drift + frozen-spine + GUARD-02 guards all green.
</success_criteria>

<output>
Create `.planning/phases/54-verification-v1-3-debt-cleanup-visual-regression-replacement/54-01b-SUMMARY.md` when done.
</output>
