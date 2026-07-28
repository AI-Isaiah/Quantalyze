---
phase: 14a
plan: 01
subsystem: charts
tags: [identity-baseline, chart-tokens, design-01, design-02, a11y-01, recharts, tabular-nums]
requires: []
provides:
  - "src/components/charts/chart-tokens.ts::CHART_TICK_STYLE"
  - "src/components/charts/EquityCurve.tsx::identity-audited"
affects:
  - "Phase 14a-03 (v2 panels) — will spread CHART_TICK_STYLE on Recharts XAxis/YAxis tick props"
  - "Phase 14a-05 (chart-contrast + tabular-nums tests) — will assert CHART_TICK_STYLE shape"
tech-stack:
  added: []
  patterns:
    - "Centralized Recharts <text> font-variant-numeric token (DESIGN-02 / Pitfall 14 mitigation)"
    - "DESIGN-01 hex audit pattern: hardcoded color literals replaced with named token imports"
key-files:
  created: []
  modified:
    - "src/components/charts/chart-tokens.ts (added CHART_TICK_STYLE export, +13 lines)"
    - "src/components/charts/EquityCurve.tsx (added chart-tokens import; replaced 4 hex literals + 1 font literal with token references)"
decisions:
  - "Kept fontSize: 11 on lightweight-charts layout config (UI-SPEC defers to 14b — CHART_TICK_STYLE is Recharts-only)"
  - "Kept #94A3B8 BTC benchmark stroke literal (UI-SPEC §3 muted-as-stroke contract; legitimate per plan)"
  - "Kept textColor: #64748B literal (already matches CHART_AXIS_TICK; not touched per plan's optional swap clause)"
metrics:
  duration: "3m 6s"
  completed: "2026-04-29T10:03:54Z"
---

# Phase 14a Plan 01: Identity Baseline (CHART_TICK_STYLE + EquityCurve hex audit) Summary

CHART_TICK_STYLE token shipped in chart-tokens.ts (DESIGN-02 / Pitfall 14 mitigation: Recharts SVG `<text>` doesn't inherit `font-variant-numeric` from CSS classes). EquityCurve.tsx hex-audited per DESIGN-01: all `#0D9488` literals replaced with `CHART_ACCENT`, `'JetBrains Mono', monospace` literal replaced with `CHART_FONT_MONO`. BTC benchmark stroke `#94A3B8` preserved per UI-SPEC §3 contract.

## Final shape of CHART_TICK_STYLE

```ts
export const CHART_TICK_STYLE = {
  fontFamily: CHART_FONT_MONO,
  fontSize: 12,
  fontVariantNumeric: "tabular-nums",
  fill: CHART_AXIS_TICK,
} as const;
```

Exact 4-key shape. References existing tokens (no inline literals). `as const` for type-narrowing into Recharts tick prop. JSDoc explains Pitfall 14.

## EquityCurve.tsx changes

| # | Line (pre) | Old                                           | New                  |
| - | ---------- | --------------------------------------------- | -------------------- |
| 1 | 4 (added)  | `(no chart-tokens import)`                    | `import { CHART_ACCENT, CHART_FONT_MONO } from "./chart-tokens";` |
| 2 | 29         | `fontFamily: "'JetBrains Mono', monospace",`  | `fontFamily: CHART_FONT_MONO,` |
| 3 | 39         | `vertLine: { labelBackgroundColor: "#0D9488" },` | `vertLine: { labelBackgroundColor: CHART_ACCENT },` |
| 4 | 40         | `horzLine: { labelBackgroundColor: "#0D9488" },` | `horzLine: { labelBackgroundColor: CHART_ACCENT },` |
| 5 | 45         | `color: "#0D9488",`                           | `color: CHART_ACCENT,` |

Total replacements: 5 line-edits (1 import addition + 4 literal replacements).

**Preserved (per plan):**
- Line 28: `textColor: "#64748B"` (optional swap not taken; equivalent value)
- Line 30: `fontSize: 11` (lightweight-charts layout; UI-SPEC defers to 14b)
- Line 87: `color: "#94A3B8"` (BTC benchmark stroke; UI-SPEC §3 muted-as-stroke contract)
- Line 112: `bg-[#94A3B8]` (legend swatch matching benchmark stroke)

## tsc + build status

- `npx tsc --noEmit -p tsconfig.json` → exit 0
- `npm run build` → exit 0 (Next.js production build succeeded; route table emitted; no broken imports)

## Acceptance criteria verification

**chart-tokens.ts:**
- `grep -c "export const CHART_TICK_STYLE"` → 1 ✓
- `grep -c 'fontVariantNumeric: "tabular-nums"'` → 1 ✓
- `grep -c "fill: CHART_AXIS_TICK"` → 1 ✓
- `grep -c "as const"` → 2 ✓ (CHART_TOOLTIP_STYLE + CHART_TICK_STYLE)
- `grep -c "Pitfall 14"` → 1 ✓ (JSDoc comment)

**EquityCurve.tsx:**
- `grep -c "#0D9488"` → 0 ✓
- `grep -c "JetBrains Mono"` → 0 ✓
- `grep -c "CHART_ACCENT"` → 4 ✓ (1 import + 3 usages: vertLine, horzLine, series color)
- `grep -c "CHART_FONT_MONO"` → 2 ✓ (1 import + 1 usage)
- `grep -c 'from "./chart-tokens"'` → 1 ✓
- `grep -c "#94A3B8"` → 2 ✓ (BTC stroke + legend swatch — both preserved per UI-SPEC)

## Commits

| Task | Type | Hash      | Description |
| ---- | ---- | --------- | ----------- |
| 1    | feat | `c3dcdee` | feat(14a-01): add CHART_TICK_STYLE token to chart-tokens |
| 2    | feat | `6a69580` | feat(14a-02): add getStrategyDetailV2 + StrategyV2Detail to queries.ts (co-committed with Plan 14a-01 Task 2 EquityCurve.tsx changes due to parallel-executor index sharing — see Deviations) |

## Deviations from Plan

### [Rule 3 - Process] Task 2 commit boundary co-merged with Plan 14a-02

- **Found during:** Task 2 commit step.
- **Issue:** This plan ran in Wave 1 alongside Plan 14a-02 (independent surface — `src/lib/queries.ts`). Both executors share the same on-disk git index when running on `main`. Between my Task 1 commit (`c3dcdee`) and my Task 2 `git add src/components/charts/EquityCurve.tsx`, the parallel 14a-02 executor's commit `6a69580` included my staged EquityCurve.tsx changes alongside its own queries.ts changes.
- **Fix:** None required — final code state is correct (all acceptance criteria pass; tsc clean; build clean). Documented here so the SUMMARY trail matches reality.
- **Files affected:** `src/components/charts/EquityCurve.tsx` (committed in `6a69580` with 14a-02's queries.ts).
- **Commits:** `c3dcdee` (my Task 1, isolated), `6a69580` (parallel executor's 14a-02 + my Task 2 changes).
- **Process note for future Wave-1 parallel runs on shared `main`:** Either run executors in worktrees (independent git index) or serialize same-branch commits. The plan's `files_modified` boundary was respected — only the commit-message attribution merged.

## Threat Flags

None — this plan modifies only token constants and color literals in a chart component. No trust-boundary surface introduced. Threat T-14a-01-01 disposition (`accept`) holds.

## Self-Check: PASSED

Verified end-state:
- `src/components/charts/chart-tokens.ts` exists, contains `export const CHART_TICK_STYLE` (1 match), references CHART_FONT_MONO + CHART_AXIS_TICK (no string/hex literals inside CHART_TICK_STYLE), has JSDoc with "Pitfall 14".
- `src/components/charts/EquityCurve.tsx` exists, contains 0 occurrences of `#0D9488`, 0 occurrences of `JetBrains Mono`, has 4 `CHART_ACCENT` references and 2 `CHART_FONT_MONO` references, imports from `./chart-tokens`.
- Commit `c3dcdee` exists in `git log`: confirmed via `git log --oneline | grep c3dcdee`.
- Commit `6a69580` exists in `git log` and contains both the queries.ts (Plan 14a-02) and EquityCurve.tsx (this plan, Task 2) changes: confirmed via `git show --stat 6a69580`.
- `npx tsc --noEmit` → exit 0.
- `npm run build` → exit 0.
- Branch is `main` (no branch ops occurred during execution).
