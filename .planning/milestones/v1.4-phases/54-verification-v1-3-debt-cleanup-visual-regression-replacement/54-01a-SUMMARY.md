---
phase: 54-verification-v1-3-debt-cleanup-visual-regression-replacement
plan: 01a
subsystem: design-tokens / lint-ratchet
tags: [BP-03, tailwind-v4, theme-tokens, eslint, frozen-islands, byte-identity]
requires:
  - "src/app/globals.css plain @theme spine (Phase 49 / DS-02)"
  - "eslint.config.mjs no-raw-font-px repo-wide warn (DS-04)"
  - "phase-52 FROZEN_ISLANDS git-diff guard"
provides:
  - "Fixed-value --text-fixed-N token aliases (9,10,11,12,13,18,22,24,28,32,36) byte-identical to text-[Npx]"
  - "ESLint off-glob exempting the 4 frozen chart files from no-raw-font-px"
affects:
  - "54-01b / 54-02a / 54-02b (consume text-fixed-N as pure className swaps)"
  - "54-05 (repo-wide no-raw-font-px error flip — depends on every migratable site clean + off-globs in place)"
tech-stack:
  added: []
  patterns:
    - "Tailwind v4 @theme fixed-value token alias (byte-identity, NOT fluid clamp)"
    - "ESLint off-glob for git-diff-frozen files (exempt-not-edit)"
key-files:
  created: []
  modified:
    - "src/app/globals.css"
    - "eslint.config.mjs"
decisions:
  - "Fixed aliases live in the PLAIN @theme block (sibling to --text-micro), NOT @theme inline, NOT TYPE_SCALE — the drift gate iterates TYPE_SCALE only, so they need no reconciliation."
  - "All 11 migratable px sizes aliased here (not just the small ones) so the migration halves never touch globals.css and stay on disjoint file sets (parallel-safe in one wave)."
  - "Frozen chart files exempted via off-glob (EquityChart + 3 factsheet SVG), NEVER edited — the CONTEXT-locked BP-03/FROZEN conflict resolution; the off-glob block was added BEFORE the src/components/charts/** block because EquityChart is not under that tree."
  - "no-raw-font-px repo-wide rule left at warn — the warn→error flip is Plan 54-05, NOT this plan."
metrics:
  duration: ~15m
  completed: 2026-06-30
---

# Phase 54 Plan 01a: BP-03 Token Foundation Summary

Laid the BP-03 byte-identity foundation: added the 11 fixed-value `--text-fixed-N` Tailwind aliases (byte-identical to every raw `text-[Npx]` size in the migratable surface) to the plain `@theme` block of `globals.css`, and exempted the 4 git-diff-frozen chart files from `no-raw-font-px` via an ESLint off-glob (never editing them).

## What Was Built

### Task 1 — Fixed-value token aliases + frozen-chart off-glob

- **`src/app/globals.css`** — Added 11 `--text-fixed-N: (N/16)rem` aliases as siblings to the existing `--text-micro` line in the PLAIN `@theme` block (`:135-144`). A fresh grep (`text-\[[0-9]+px\]` across `src`) confirmed exactly the planner-predicted set is present: 9 (×32), 10 (×87), 11 (×65), 12 (×18), 13 (×25), 18 (×2), 22 (×8), 24 (×1), 28 (×3), 32 (×5), 36 (×1). Each token carries a `= Npx @16px root — byte-identical to text-[Npx]` comment, plus a block comment explaining why they are byte-identity (fixed, not fluid `clamp`) and why they are deliberately outside `TYPE_SCALE`. `@theme inline` was NOT touched.
- **`eslint.config.mjs`** — Added a NEW off-glob config block (mirroring the existing `src/components/charts/**` shape) listing exactly the 4 FROZEN chart files with `rules: { "quantalyze/no-raw-font-px": "off" }`:
  - `src/app/(dashboard)/allocations/widgets/performance/EquityChart.tsx` (FROZEN_ISLANDS, lives outside `src/components/charts/**` so needs an explicit entry)
  - `src/app/factsheet/[id]/v2/TimeSeriesChart.tsx`
  - `src/app/factsheet/[id]/v2/HistogramChart.tsx`
  - `src/app/factsheet/[id]/v2/MasterBrush.tsx`
  - The block carries a comment explaining the FROZEN_ISLANDS git-diff guard (`phase-52-frozen-spine-guards.test.ts:158`) and the CONTEXT-locked BP-03/FROZEN conflict resolution. It was inserted BEFORE the `src/components/charts/**` block.

## Verification

| Check | Result |
|-------|--------|
| `grep -cE "^\s*--text-fixed-[0-9]+:" src/app/globals.css` | **11** (one alias per migratable px size) |
| All 11 sizes present (9,10,11,12,13,18,22,24,28,32,36) | confirmed via `grep -oE` sort |
| `grep "fixed" src/lib/design-tokens/typography.ts` | **empty** (fixed tokens NOT in TYPE_SCALE) |
| `grep -c "EquityChart.tsx" eslint.config.mjs` | **1** (inside the off-glob block) |
| `npx vitest run tests/a11y/design-token-drift.test.ts` | **26/26 passed** (drift gate unaffected) |
| `npx vitest run src/__tests__/phase-52-frozen-spine-guards.test.ts` | **9/9 passed** (no frozen file edited) |
| `npx eslint eslint.config.mjs src/app/globals.css` | **exit 0, 0 errors** (config lints clean; globals.css is CSS so "File ignored" — expected) |
| Off-glob active | `EquityChart.tsx` reports **0** `no-raw-font-px` findings despite raw px sites |
| Rule still active elsewhere | `OutcomesWidget.tsx` still **warns** on raw px (rule not globally disabled) |
| `git status --short` | only `eslint.config.mjs` + `src/app/globals.css` modified — no frozen file touched |

## Deviations from Plan

None — plan executed exactly as written. The grep re-confirmed the planner's exact size set, so no scope adjustment was needed.

## Known Stubs

None. This is a token/config foundation; no UI, no data sources.

## Threat Flags

None. Pure CSS-token + ESLint-config edits — no new network endpoints, auth paths, file access, or schema changes. The two STRIDE register threats (T-54-01-01 frozen-file tampering, T-54-01-02 TYPE_SCALE drift) were both mitigated as planned: frozen files exempted-not-edited (frozen-spine guard green), fixed tokens added outside TYPE_SCALE (drift test green).

## Self-Check: PASSED

- `src/app/globals.css` — FOUND (modified, 11 fixed tokens present)
- `eslint.config.mjs` — FOUND (modified, EquityChart.tsx off-glob present)
- Both guard tests green; no frozen file edited; commit hash recorded below.
