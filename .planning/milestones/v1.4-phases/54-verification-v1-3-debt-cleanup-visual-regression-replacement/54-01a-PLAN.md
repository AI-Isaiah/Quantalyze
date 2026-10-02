---
phase: 54-verification-v1-3-debt-cleanup-visual-regression-replacement
plan: 01a
type: execute
wave: 1
depends_on: []
files_modified:
  - src/app/globals.css
  - eslint.config.mjs
autonomous: true
requirements: [BP-03]
must_haves:
  truths:
    - "Fixed-value text tokens exist that resolve byte-identically to EVERY raw px size present in the migratable surface (9,10,11,12,13,18,22,24,28,32,36)"
    - "Frozen chart files are exempted from no-raw-font-px via an explicit off-glob (NOT edited)"
    - "design-token-drift.test.ts stays green (fixed tokens are NOT TYPE_SCALE tiers)"
  artifacts:
    - path: "src/app/globals.css"
      provides: "Fixed-value --text-fixed-* token aliases in a plain @theme block"
      contains: "--text-fixed-10"
    - path: "eslint.config.mjs"
      provides: "Off-glob exempting the 4 frozen chart files from no-raw-font-px"
      contains: "EquityChart.tsx"
  key_links:
    - from: "migrated allocations/factsheet/component/page files (54-01b, 54-02a, 54-02b)"
      to: "src/app/globals.css @theme fixed tokens"
      via: "text-fixed-N utility classes"
      pattern: "text-fixed-(9|10|11|12|13|18|22|24|28|32|36)"
---

<objective>
Lay the BP-03 token FOUNDATION: add the fixed-value `--text-fixed-N` Tailwind token aliases (byte-identical to the current raw px) to the plain `@theme` block of globals.css, and exempt the four FROZEN chart files from `no-raw-font-px` via an ESLint off-glob (never edit them — they are in the FROZEN_ISLANDS git-diff guard).

Purpose: This is the dependency ROOT for the entire BP-03 px→token migration. The migration halves (54-01b, 54-02a, 54-02b) consume these tokens; the repo-wide `error` flip (54-05) depends on every migratable site being clean. Add ALL needed aliases here (9,10,11,12,13,18,22,24,28,32,36 — every size present per `grep -rEoh "text-\[[0-9]+px\]"`) so the migration halves NEVER touch globals.css (keeps them on disjoint file sets and parallel-safe in the same wave). Byte-identity preserved so the deferred golden re-bake (VERIFY-04) and the frozen-spine guard stay valid.
Output: fixed-value token aliases in globals.css covering every migratable px size; an ESLint off-glob for the 4 frozen chart files. NO source-file migrations in this plan.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/STATE.md
@.planning/phases/54-verification-v1-3-debt-cleanup-visual-regression-replacement/54-RESEARCH.md
@.planning/phases/54-verification-v1-3-debt-cleanup-visual-regression-replacement/54-PATTERNS.md
@.planning/phases/54-verification-v1-3-debt-cleanup-visual-regression-replacement/54-CONTEXT.md

<interfaces>
The byte-identity mapping (16px root): each `text-[Npx]` migrates to `text-fixed-N` where the token = N/16 rem.
- text-[9px]  → --text-fixed-9: 0.5625rem
- text-[10px] → --text-fixed-10: 0.625rem
- text-[11px] → --text-fixed-11: 0.6875rem
- text-[12px] → --text-fixed-12: 0.75rem
- text-[13px] → --text-fixed-13: 0.8125rem
- text-[18px] → --text-fixed-18: 1.125rem
- text-[22px] → --text-fixed-22: 1.375rem
- text-[24px] → --text-fixed-24: 1.5rem
- text-[28px] → --text-fixed-28: 1.75rem
- text-[32px] → --text-fixed-32: 2rem
- text-[36px] → --text-fixed-36: 2.25rem
These go in the PLAIN `@theme` block of globals.css (the one at :135-144, NOT `@theme inline`).
ALL 11 sizes above are present in the repo (confirmed via `grep -rEoh "text-\[[0-9]+px\]" src --include="*.tsx" --include="*.ts" | sort -u`). Add an alias for EVERY one so 54-01b/54-02a/54-02b are pure className swaps that never edit globals.css.
The drift test (tests/a11y/design-token-drift.test.ts:117) iterates Object.entries(TYPE_SCALE) ONLY, so a --text-fixed-* token that is NOT a TYPE_SCALE key is invisible to it — do NOT add fixed-* to TYPE_SCALE.
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Add fixed-value token aliases + frozen-chart off-glob</name>
  <read_first>
    - src/app/globals.css (the plain @theme block at :130-144 — the fluid spine)
    - src/lib/design-tokens/typography.ts (TYPE_SCALE — must NOT gain fixed-* keys)
    - tests/a11y/design-token-drift.test.ts (:117, :124 — confirm it iterates TYPE_SCALE only)
    - eslint.config.mjs (:82 repo-wide warn; :193-199 existing charts/** off-glob shape)
    - .planning/phases/54-.../54-PATTERNS.md (globals.css @theme section; eslint off-glob section)
  </read_first>
  <action>
    First `grep -rEoh "text-\[[0-9]+px\]" src --include="*.tsx" --include="*.ts" | sort -u` to re-confirm every px size actually present (expect 9,10,11,12,13,18,22,24,28,32,36). In the PLAIN `@theme` block of src/app/globals.css (sibling to the existing `--text-micro` line), add one `--text-fixed-N: (N/16)rem;` alias for EACH px size present — ALL 11 of them (9,10,11,12,13,18,22,24,28,32,36), not just the small ones. Adding every size here means the migration halves (54-01b/54-02a/54-02b) are pure className swaps that never need to touch globals.css. Each token comment must state "= Npx @16px root — byte-identical to text-[Npx]". Do NOT touch `@theme inline`. Do NOT add these keys to TYPE_SCALE in src/lib/design-tokens/typography.ts (keeps design-token-drift.test.ts green per the locked decision — the drift test only iterates TYPE_SCALE tiers). In eslint.config.mjs, add a NEW config block (mirroring the existing `src/components/charts/**` off-glob at :193-199) whose `files` array lists exactly the 4 FROZEN chart files: `src/app/(dashboard)/allocations/widgets/performance/EquityChart.tsx`, `src/app/factsheet/[id]/v2/TimeSeriesChart.tsx`, `src/app/factsheet/[id]/v2/HistogramChart.tsx`, `src/app/factsheet/[id]/v2/MasterBrush.tsx`, with `rules: { "quantalyze/no-raw-font-px": "off" }`. Add a comment block stating WHY (FROZEN_ISLANDS git-diff guard — phase-52-frozen-spine-guards.test.ts:158 — these can never migrate; this is the CONTEXT-locked BP-03/FROZEN conflict resolution). Do NOT yet flip the repo-wide rule to error (that is Plan 54-05).
  </action>
  <verify>
    <automated>npx vitest run tests/a11y/design-token-drift.test.ts && npx eslint eslint.config.mjs src/app/globals.css</automated>
  </verify>
  <acceptance_criteria>
    - `grep -c "text-fixed-" src/app/globals.css` returns ≥11 (one alias per migratable px size: 9,10,11,12,13,18,22,24,28,32,36)
    - `grep "fixed" src/lib/design-tokens/typography.ts` returns nothing (fixed tokens NOT in TYPE_SCALE)
    - `grep -c "EquityChart.tsx" eslint.config.mjs` ≥1 inside an off-glob block
    - design-token-drift.test.ts passes (drift gate unaffected)
  </acceptance_criteria>
  <done>Fixed token aliases for ALL 11 migratable px sizes exist in the plain @theme block; the 4 frozen chart files are off-globbed; TYPE_SCALE and the drift test are untouched/green. No source files were migrated (that is 54-01b/54-02a/54-02b).</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| (none new) | Pure CSS-token + ESLint-config edits; no runtime input, no network, no DB |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-54-01-01 | Tampering | Frozen chart files (EquityChart + 3 SVG) | mitigate | Off-glob exemption instead of edit; phase-52-frozen-spine-guards git-diff guard stays green (zero-diff asserted downstream in 54-05) |
| T-54-01-02 | Tampering | TYPE_SCALE drift gate | mitigate | Fixed tokens added OUTSIDE TYPE_SCALE; design-token-drift.test.ts re-run as a tripwire in this plan |

No high/medium threats — token/config foundation, no new attack surface.
</threat_model>

<verification>
- `npx eslint eslint.config.mjs src/app/globals.css` — config + globals lint clean.
- `npx vitest run tests/a11y/design-token-drift.test.ts` — green (TYPE_SCALE untouched).
- `grep -c "text-fixed-" src/app/globals.css` ≥ 11 (every migratable size aliased).
</verification>

<success_criteria>
Fixed-value tokens cover every migratable px size (all 11); the 4 frozen chart files are off-globbed; TYPE_SCALE and the drift test are untouched/green. The migration halves can now run as pure className swaps that never touch globals.css.
</success_criteria>

<output>
Create `.planning/phases/54-verification-v1-3-debt-cleanup-visual-regression-replacement/54-01a-SUMMARY.md` when done.
</output>
