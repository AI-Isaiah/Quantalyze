---
phase: 54-verification-v1-3-debt-cleanup-visual-regression-replacement
plan: 02b
type: execute
wave: 2
depends_on: [54-01a]
files_modified:
  - src/components/connect/KeyPermissionBadge.tsx
  - src/components/exchanges/AllocatorExchangeManager.tsx
  - src/components/layout/MobileNav.tsx
  - src/components/layout/PageHeader.tsx
  - src/components/layout/Sidebar.tsx
  - src/components/mandate/MandateAdvancedSection.tsx
  - src/components/mandate/MandateForm.tsx
  - src/components/mandate/MandateSlider.tsx
  - src/components/notes/BridgeOutcomeNoteSection.tsx
  - src/components/notes/HoldingNoteRow.tsx
  - src/components/notes/StrategyNoteCard.tsx
  - src/components/ui/CardShell.tsx
  - src/components/ui/CollapsibleSection.tsx
  - src/components/ui/Tooltip.tsx
  - src/app/(dashboard)/recommendations/page.tsx
  - src/app/browse/[slug]/[strategyId]/page.tsx
  - src/app/browse/page.tsx
  - src/app/error.tsx
  - src/app/not-found.tsx
  - src/app/portfolio-pdf/[id]/page.tsx
  - src/app/scenario-share/[token]/page.tsx
autonomous: true
requirements: [BP-03]
scope_justification: >
  21 files exceeds the 15-file soft threshold, but every change is the SAME mechanical
  className swap (text-[Npx] -> text-fixed-N) — find-and-replace across thin component
  and page files, not per-file design reasoning. Per-file context cost is near-zero.
  Splitting further adds orchestration overhead with no executor-context benefit; the
  eslint final-flip gate (54-05) catches any miss. Accepted per the plan-checker's
  documented scope_justification alternative.
must_haves:
  truths:
    - "Every mandate/notes/layout/connect/exchanges/ui orphan component is migrated off raw text-[Npx]"
    - "Every src/app/* top-level + browse + recommendations + scenario-share + portfolio-pdf orphan page is migrated"
    - "After 54-01b + 54-02a + 54-02b, the ONLY files with raw text-[Npx] are the 4 frozen charts + WorstDrawdowns + test fixtures"
    - "WorstDrawdowns.tsx (under charts/**, already off-globbed) is NOT touched"
  artifacts:
    - path: "src/components/layout/PageHeader.tsx"
      provides: "Clean component with zero raw text-[Npx]"
      contains: "text-fixed-"
  key_links:
    - from: "migrated component/page files"
      to: "src/app/globals.css @theme fixed tokens (from 54-01a)"
      via: "text-fixed-N utility classes"
      pattern: "text-fixed-(9|10|11|12|13|18|22|24|28|32|36)"
---

<objective>
Migrate the remaining BP-03 orphan files — the rest of the `src/components/**` tree (mandate/notes/layout/connect/exchanges/ui) plus the top-level `src/app/*` orphan pages (error/not-found/browse/recommendations/scenario-share/portfolio-pdf) — off raw `text-[Npx]` onto the byte-identical `text-fixed-N` tokens added in Plan 54-01a.

Purpose: The third of three parallel halves of the BP-03 source migration (alongside 54-01b and 54-02a). After all three, zero non-frozen, non-test files carry raw `text-[Npx]` — the precondition for the repo-wide `error` flip in Plan 54-05. The three halves touch disjoint file sets, so they run in the same wave in parallel.
Output: ~21 migrated files with zero raw `text-[Npx]`. NO globals.css edits (54-01a added every needed alias).
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
Depends on 54-01a's fixed tokens in globals.css. Mapping: `text-[Npx]` → `text-fixed-N` (token = N/16 rem, byte-identical). 54-01a added an alias for EVERY size present (9,10,11,12,13,18,22,24,28,32,36) including the larger heading sizes used by browse/error/not-found/scenario-share/recommendations and PageHeader — do NOT add or edit any alias in globals.css here (that file is owned by 54-01a; this plan must not touch it).
`src/components/charts/WorstDrawdowns.tsx` is under the existing `charts/**` off-glob — NOT in scope; do not touch it.
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Migrate mandate + notes + layout + connect + exchanges + ui components</name>
  <read_first>
    - Each mandate/*, notes/*, layout/*, connect/*, exchanges/*, ui/* file in files_modified
    - src/app/globals.css (@theme fixed tokens from 54-01a — read-only)
  </read_first>
  <action>
    Swap each raw `text-[Npx]` for its `text-fixed-N` token across: mandate (MandateAdvancedSection, MandateForm, MandateSlider), notes (BridgeOutcomeNoteSection, HoldingNoteRow, StrategyNoteCard), layout (MobileNav, PageHeader, Sidebar), connect (KeyPermissionBadge), exchanges (AllocatorExchangeManager), ui (CardShell, CollapsibleSection, Tooltip). PageHeader.tsx carries a larger size — its alias already exists in globals.css (54-01a added all sizes), so do NOT touch globals.css. `Tooltip.tsx` and `CardShell.tsx` are shared primitives — verify the swap does not alter any byte-locked snapshot (run the touched component's unit test if one exists). Surgical only.
  </action>
  <verify>
    <automated>grep -rEl "text-\[[0-9]+px\]" src/components/mandate src/components/notes src/components/layout src/components/connect src/components/exchanges src/components/ui --include="*.tsx" | grep -v "\.test\." | grep -v WorstDrawdowns ; npx eslint "src/components/mandate/**" "src/components/notes/**" "src/components/layout/**" "src/components/connect/**" "src/components/exchanges/**" "src/components/ui/**"</automated>
  </verify>
  <acceptance_criteria>
    - The grep prints NO non-test file across these six trees
    - `npx eslint` reports 0 `no-raw-font-px` warnings in these trees
    - `git diff --stat -- src/app/globals.css` is EMPTY (globals.css owned by 54-01a)
  </acceptance_criteria>
  <done>mandate/notes/layout/connect/exchanges/ui orphan files carry zero raw text-[Npx]; charts/WorstDrawdowns + globals.css untouched.</done>
</task>

<task type="auto">
  <name>Task 2: Migrate the top-level src/app/* orphan pages</name>
  <read_first>
    - src/app/error.tsx, src/app/not-found.tsx, src/app/browse/page.tsx, src/app/browse/[slug]/[strategyId]/page.tsx, src/app/(dashboard)/recommendations/page.tsx, src/app/scenario-share/[token]/page.tsx, src/app/portfolio-pdf/[id]/page.tsx
    - src/app/globals.css (@theme fixed tokens from 54-01a — read-only)
  </read_first>
  <action>
    Swap each raw `text-[Npx]` for its `text-fixed-N` token across the listed app pages. browse/page.tsx, error.tsx, not-found.tsx, scenario-share, and recommendations carry the larger heading sizes (22/28/32/36px) — their aliases already exist in globals.css (54-01a added all sizes), so do NOT touch globals.css. `portfolio-pdf/[id]/page.tsx` renders to a PDF — confirm the fixed-token swap (which is byte-identical) does not perturb its layout; the size in rem is identical so PDF output is unchanged. After this task (together with 54-01b + 54-02a), the only files in the repo carrying raw `text-[Npx]` must be: the 4 off-globbed frozen chart files, charts/WorstDrawdowns.tsx (off-globbed), and `.test.tsx`/`.spec.tsx` fixtures (off-globbed for tests).
  </action>
  <verify>
    <automated>grep -rEl "text-\[[0-9]+px\]" src --include="*.tsx" --include="*.ts" | grep -vE "(EquityChart|TimeSeriesChart|HistogramChart|MasterBrush|WorstDrawdowns)" | grep -vE "\.(test|spec)\.(ts|tsx)$"</automated>
  </verify>
  <acceptance_criteria>
    - After 54-01b + 54-02a are also done, the repo-wide grep prints NOTHING (zero non-frozen, non-test raw text-[Npx] sites remain anywhere). If 54-01b/54-02a have not yet landed in the same branch, this grep may still list THEIR files — that is expected; this plan owns only the listed component + page files. Confirm none of THIS plan's files_modified appears in the grep output.
    - `npx eslint` over this plan's files shows 0 `no-raw-font-px` warnings
    - `git diff --stat -- src/app/globals.css` is EMPTY
  </acceptance_criteria>
  <done>Every component/page orphan file owned by this plan is migrated; combined with 54-01b + 54-02a the repo is clean for the 54-05 error flip.</done>
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
| T-54-02-01 | Tampering | Shared ui primitives (Tooltip/CardShell) + portfolio-pdf render | accept | Byte-identical rem swap; touched-component unit tests re-run as tripwires |

No high/medium threats — token/className migration, no new attack surface.
</threat_model>

<verification>
- This plan's files: grep for non-frozen, non-test `text-[Npx]` returns none of them.
- `npx eslint` over this plan's trees + pages — 0 `no-raw-font-px` warnings.
- `npx vitest run` — coverage ratchet stays green; no snapshot/byte test regressed.
- `git diff --stat -- src/app/globals.css` — empty.
</verification>

<success_criteria>
The mandate/notes/layout/connect/exchanges/ui components and the top-level app pages owned by this plan are free of raw `text-[Npx]`; globals.css untouched. Combined with 54-01b + 54-02a, the entire repo is free of raw `text-[Npx]` outside the documented off-globbed frozen-chart islands and test fixtures — the precondition for Plan 54-05's repo-wide `error` flip is met.
</success_criteria>

<output>
Create `.planning/phases/54-verification-v1-3-debt-cleanup-visual-regression-replacement/54-02b-SUMMARY.md` when done.
</output>
