---
phase: 14a
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/components/charts/chart-tokens.ts
  - src/components/charts/EquityCurve.tsx
autonomous: true
requirements: [DESIGN-01, DESIGN-02, A11Y-01]
must_haves:
  truths:
    - "CHART_TICK_STYLE is exported from chart-tokens.ts as a const object with fontFamily, fontSize:12, fontVariantNumeric:'tabular-nums', fill:CHART_AXIS_TICK"
    - "EquityCurve.tsx no longer contains any literal #0D9488 hex"
    - "EquityCurve.tsx no longer contains the literal string 'JetBrains Mono'"
    - "Strategy series in EquityCurve renders with CHART_ACCENT (#1B6B5A) imported from chart-tokens"
  artifacts:
    - path: "src/components/charts/chart-tokens.ts"
      provides: "CHART_TICK_STYLE token + existing CHART_ACCENT/CHART_AXIS_TICK/CHART_FONT_MONO/CHART_TEXT_MUTED/CHART_BORDER"
      contains: "export const CHART_TICK_STYLE"
    - path: "src/components/charts/EquityCurve.tsx"
      provides: "Identity-audited equity-vs-benchmark chart, hex literals replaced with chart-tokens imports"
  key_links:
    - from: "src/components/charts/EquityCurve.tsx"
      to: "src/components/charts/chart-tokens.ts"
      via: "import { CHART_ACCENT, CHART_FONT_MONO, CHART_AXIS_TICK } from './chart-tokens'"
      pattern: "from \"./chart-tokens\""
---

<objective>
Land the identity baseline foundation for Phase 14a: extend `src/components/charts/chart-tokens.ts` with the new `CHART_TICK_STYLE` token (DESIGN-02 / Pitfall 14 mitigation — Recharts SVG `<text>` does not inherit `font-variant-numeric` from CSS classes) and execute the DESIGN-01 hex audit on `src/components/charts/EquityCurve.tsx` (replace bright-teal `#0D9488` with `CHART_ACCENT`, replace `'JetBrains Mono', monospace` literal with `CHART_FONT_MONO`).

This plan is the foundation for Plan 14A-03 (the new strategy-v2 panel components import `CHART_TICK_STYLE` directly) and unblocks Plan 14A-05's chart-contrast and tabular-nums tests. It is independent of Plan 14A-02 (data layer) and runs in parallel with it in Wave 1.

Purpose: Centralize the tabular-nums fix at the leaf (Recharts `<text>`) so every v2 panel chart inherits it via a single token spread, and complete the DESIGN-01 identity correction on the lone remaining hardcoded-hex chart component (`EquityCurve`) without forking it.

Output: Extended `chart-tokens.ts` (one new const export, ~10 LOC) and audited `EquityCurve.tsx` (~5 line-replacements). Zero new files.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@.planning/ROADMAP.md
@.planning/phases/14a-single-strategy-v2-eager-panels-identity/14A-CONTEXT.md
@.planning/phases/14a-single-strategy-v2-eager-panels-identity/14A-UI-SPEC.md
@.planning/phases/14a-single-strategy-v2-eager-panels-identity/14A-RESEARCH.md
@DESIGN.md
@AGENTS.md
@src/components/charts/chart-tokens.ts
@src/components/charts/EquityCurve.tsx

<interfaces>
<!-- chart-tokens.ts CURRENT exports (verified 2026-04-29). Executor uses these as-is + adds CHART_TICK_STYLE. -->

```ts
// src/components/charts/chart-tokens.ts
export const CHART_ACCENT = "#1B6B5A";
export const CHART_TEXT_SECONDARY = "#4A5568";
export const CHART_TEXT_MUTED = "#94A3B8";
export const CHART_BORDER = "#E2E8F0";
export const CHART_AXIS_TICK = "#64748B";       // Recharts axis-tick color
export const CHART_FONT_MONO = "var(--font-mono), monospace";
export const CHART_REFERENCE_DASH = "3 3";
export const CHART_TOOLTIP_STYLE = { fontSize: 12, fontFamily: CHART_FONT_MONO, borderColor: CHART_BORDER, borderRadius: 6 } as const;
```

<!-- EquityCurve.tsx hardcoded-hex line-items (per RESEARCH.md Pitfall 9, verified 2026-04-29):
  - Line 28: `textColor: "#64748B"` ← already correct (matches CHART_AXIS_TICK); LEAVE as-is OR replace with token import for consistency
  - Line 29: `fontFamily: "'JetBrains Mono', monospace"` ← MUST replace with CHART_FONT_MONO
  - Line 30: `fontSize: 11` ← LEAVE (lightweight-charts API; 11→12 is a non-blocking nicety, NOT a Phase 14a contract)
  - Line 39: `labelBackgroundColor: "#0D9488"` ← MUST replace with CHART_ACCENT
  - Line 40: `labelBackgroundColor: "#0D9488"` ← MUST replace with CHART_ACCENT (likely same property on second axis)
  - Line 45: `color: "#0D9488"` ← strategy series color; MUST replace with CHART_ACCENT
  - Line 87: `color: "#94A3B8"` ← BTC benchmark stroke; CORRECT (muted-as-stroke contract); LEAVE
-->
</interfaces>
</context>

<tasks>

<task type="auto" tdd="false">
  <name>Task 1: Extend chart-tokens.ts with CHART_TICK_STYLE</name>
  <files>src/components/charts/chart-tokens.ts</files>
  <read_first>
    - src/components/charts/chart-tokens.ts (MUST read current file before editing — confirms existing exports and ordering)
    - .planning/phases/14a-single-strategy-v2-eager-panels-identity/14A-UI-SPEC.md §2 "CHART_TICK_STYLE token" (verbatim spec)
  </read_first>
  <behavior>
    - CHART_TICK_STYLE is exported from chart-tokens.ts
    - The exported value is a `const`-asserted object with EXACTLY 4 keys: `fontFamily`, `fontSize`, `fontVariantNumeric`, `fill`
    - `fontFamily` references `CHART_FONT_MONO` (NOT a literal string)
    - `fontSize` is the number `12` (NOT 11; UI-SPEC §2 4-size consolidation explicitly moves axis ticks 11px → 12px)
    - `fontVariantNumeric` is the literal string `"tabular-nums"` (camelCase React prop; SVG resolves to `font-variant-numeric: tabular-nums`)
    - `fill` references `CHART_AXIS_TICK` (NOT a literal hex)
    - JSDoc comment explains Pitfall 14 (Recharts `<text>` doesn't inherit `font-variant-numeric` from parent CSS class) and is the centralized fix for DESIGN-02
  </behavior>
  <action>
Append the following block to `src/components/charts/chart-tokens.ts` AFTER the existing `CHART_TOOLTIP_STYLE` export (line 23). Do NOT modify any existing export. Do NOT change line endings or import order.

```ts
/**
 * Recharts <text> SVG elements don't inherit font-variant-numeric from a
 * parent CSS class. Spread this object directly on <XAxis tick={...}> /
 * <YAxis tick={...}> so chart axis ticks render in tabular-nums.
 *
 * Pitfall 14 mitigation. Centralized fix for DESIGN-02. fontSize: 12 matches
 * the v2 caption tier (DESIGN.md 12px caption) — well within WCAG AA at
 * #64748B on #FFFFFF (4.85:1).
 */
export const CHART_TICK_STYLE = {
  fontFamily: CHART_FONT_MONO,
  fontSize: 12,
  fontVariantNumeric: "tabular-nums",
  fill: CHART_AXIS_TICK,
} as const;
```

Do NOT write CHART_TICK_STYLE before the existing exports — `CHART_FONT_MONO` and `CHART_AXIS_TICK` must be in scope above it. Append at end of file.
  </action>
  <verify>
    <automated>npx tsc --noEmit -p tsconfig.json 2>&amp;1 | grep -i "chart-tokens" || echo "TYPECHECK_OK"</automated>
  </verify>
  <acceptance_criteria>
    - `grep -n "export const CHART_TICK_STYLE" src/components/charts/chart-tokens.ts` returns exactly 1 match
    - `grep -n "fontVariantNumeric: \"tabular-nums\"" src/components/charts/chart-tokens.ts` returns exactly 1 match
    - `grep -n "fontSize: 12," src/components/charts/chart-tokens.ts` returns exactly 1 match (the new token; pre-existing CHART_TOOLTIP_STYLE also has `fontSize: 12,` so total may be 2 — must include the new occurrence inside CHART_TICK_STYLE block)
    - `grep -n "fill: CHART_AXIS_TICK" src/components/charts/chart-tokens.ts` returns exactly 1 match
    - `grep -n "fontFamily: CHART_FONT_MONO" src/components/charts/chart-tokens.ts` returns at least 1 match (CHART_TOOLTIP_STYLE already has it; new CHART_TICK_STYLE adds another so total ≥ 2)
    - `grep -c "as const" src/components/charts/chart-tokens.ts` returns at least 2 (existing CHART_TOOLTIP_STYLE + new CHART_TICK_STYLE)
    - `grep -c "Pitfall 14" src/components/charts/chart-tokens.ts` returns at least 1 (the JSDoc comment)
    - `npx tsc --noEmit` exits 0 (no new type errors)
  </acceptance_criteria>
  <done>CHART_TICK_STYLE export present, references existing tokens (no string literals), tsc clean.</done>
</task>

<task type="auto" tdd="false">
  <name>Task 2: DESIGN-01 hex audit on EquityCurve.tsx</name>
  <files>src/components/charts/EquityCurve.tsx</files>
  <read_first>
    - src/components/charts/EquityCurve.tsx (MUST read full file to confirm line numbers for `#0D9488` and `'JetBrains Mono'` occurrences — line 39 might be `labelBackgroundColor` while line 40 is a different prop; the executor must read the actual file rather than assume the RESEARCH.md line numbers are byte-accurate)
    - src/components/charts/chart-tokens.ts (post-Task-1 state — confirms CHART_ACCENT and CHART_FONT_MONO are imported tokens to use)
    - .planning/phases/14a-single-strategy-v2-eager-panels-identity/14A-RESEARCH.md Pitfall 9 (line-by-line audit guidance)
  </read_first>
  <behavior>
    - All occurrences of literal `"#0D9488"` are replaced with `CHART_ACCENT` (imported from `./chart-tokens`)
    - All occurrences of the literal string `'JetBrains Mono', monospace` (or equivalent — `"'JetBrains Mono', monospace"` with various quote styles) are replaced with `CHART_FONT_MONO` (imported from `./chart-tokens`)
    - The line at ~87 with `color: "#94A3B8"` (BTC benchmark stroke) MUST be left unchanged — that's the muted-as-stroke contract (legitimate per UI-SPEC §3 "Benchmark stroke")
    - The line at ~28 with `textColor: "#64748B"` MAY optionally be replaced with `CHART_AXIS_TICK` for consistency (executor's choice — both are equivalent values; the verification only requires `#0D9488` and `JetBrains Mono` removal)
    - All edits preserve existing function signatures and behavior — this is a pure cosmetic-token swap, no logic changes
    - Imports of `CHART_ACCENT` and `CHART_FONT_MONO` from `./chart-tokens` are added if not already present
  </behavior>
  <action>
1. Read the current full content of `src/components/charts/EquityCurve.tsx`.
2. Identify the existing import line(s) from `./chart-tokens` (if any). If `CHART_ACCENT` and `CHART_FONT_MONO` are not already in the import list, extend the existing import statement (e.g. change `import { CHART_AXIS_TICK } from "./chart-tokens";` to `import { CHART_ACCENT, CHART_AXIS_TICK, CHART_FONT_MONO } from "./chart-tokens";`). If there is no existing chart-tokens import, ADD a new import line near the top of the file: `import { CHART_ACCENT, CHART_FONT_MONO } from "./chart-tokens";`
3. Replace EVERY literal `"#0D9488"` with `CHART_ACCENT` (no quotes — the imported identifier). Use Edit tool with `replace_all: true` semantics — manually verify each occurrence by reading the file.
4. Replace EVERY occurrence of the literal `"'JetBrains Mono', monospace"` (and any alternate-quote variant like `'\\'JetBrains Mono\\', monospace'`) with `CHART_FONT_MONO` (no quotes — the imported identifier).
5. DO NOT touch the line containing `color: "#94A3B8"` (BTC benchmark stroke — UI-SPEC §3 explicitly preserves this).
6. DO NOT change `fontSize: 11` to `12` on the lightweight-charts `layout` config — UI-SPEC notes this is a 14b-or-later concern; lightweight-charts axis ticks are NOT covered by `CHART_TICK_STYLE` (which is Recharts-only).
7. Run `npm run typecheck` and `npm run build` to confirm no broken imports.
  </action>
  <verify>
    <automated>grep -c "#0D9488" src/components/charts/EquityCurve.tsx; grep -c "JetBrains Mono" src/components/charts/EquityCurve.tsx</automated>
  </verify>
  <acceptance_criteria>
    - `grep -c "#0D9488" src/components/charts/EquityCurve.tsx` returns exactly `0`
    - `grep -c "JetBrains Mono" src/components/charts/EquityCurve.tsx` returns exactly `0`
    - `grep -n "CHART_ACCENT" src/components/charts/EquityCurve.tsx` returns at least 2 matches (one in the import, at least one usage in the body)
    - `grep -n "CHART_FONT_MONO" src/components/charts/EquityCurve.tsx` returns at least 2 matches (one in the import, at least one usage in the body)
    - `grep -n "from \"./chart-tokens\"" src/components/charts/EquityCurve.tsx` returns exactly 1 match (single import statement, possibly extended)
    - `grep -c "#94A3B8" src/components/charts/EquityCurve.tsx` returns at least 1 (the BTC benchmark stroke at ~line 87 is preserved)
    - `npx tsc --noEmit` exits 0
    - `npm run build` exits 0
  </acceptance_criteria>
  <done>EquityCurve renders with CHART_ACCENT for strategy series + crosshair label background; CHART_FONT_MONO for axis-tick font family; BTC benchmark stroke preserved at #94A3B8; tsc + build clean.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| (none — this plan modifies only token files and a chart component; no input crossing trust boundaries) | n/a |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-14a-01-01 | I | EquityCurve color literals | accept | Cosmetic-only change; no data exposure surface; pre-existing chart logic unchanged. |
</threat_model>

<verification>
- `npx tsc --noEmit` exits 0
- `npm run build` exits 0
- `grep -c "#0D9488" src/components/charts/EquityCurve.tsx` returns 0
- `grep -c "CHART_TICK_STYLE" src/components/charts/chart-tokens.ts` returns at least 1 (the export declaration; the JSDoc comment may add additional matches)
</verification>

<success_criteria>
1. `CHART_TICK_STYLE` exported from `chart-tokens.ts` with the exact 4-key shape (fontFamily, fontSize:12, fontVariantNumeric:'tabular-nums', fill:CHART_AXIS_TICK).
2. `EquityCurve.tsx` contains zero `#0D9488` and zero `JetBrains Mono` literals; uses `CHART_ACCENT` and `CHART_FONT_MONO` from `./chart-tokens` instead.
3. `npm run build` passes; no broken imports.
</success_criteria>

<output>
After completion, create `.planning/phases/14a-single-strategy-v2-eager-panels-identity/14a-01-SUMMARY.md` describing:
- Final shape of CHART_TICK_STYLE
- Total lines changed in EquityCurve.tsx (count of replacements)
- tsc + build status
</output>
