---
phase: 48-recharts-equitychart-final-verification
plan: 01
subsystem: charts / CI verification scaffolding
tags: [recharts, touch, a11y, lhci, wave-0, scaffold, ci]
requires:
  - "src/hooks/useBreakpoint.ts (SSR-safe two-pass breakpoint gate)"
  - "recharts 3.8.1 (<Tooltip trigger> native tap-to-pin API)"
  - "e2e/helpers/axe.ts (buildAxe WCAG-AA factory)"
provides:
  - "TouchTooltip — the ONE DRY breakpoint-gated <Tooltip trigger> shim (consumed by plan 02 across 18 charts)"
  - "@lhci/cli@0.15.1 pinned devDependency (consumed by plan 05 lighthouse-mobile job)"
  - "e2e/axe-app-wide.spec.ts scaffold (filled by plan 04)"
  - "lighthouserc.json scaffold (baselined by plan 05)"
  - "EquityChart.touch.test.tsx pending parity scaffold (satisfied by plan 03)"
affects:
  - "package.json / package-lock.json (one net-new devDep)"
tech-stack:
  added:
    - "@lhci/cli@0.15.1 (devDependency, pinned exact)"
  patterns:
    - "Breakpoint-gated Recharts trigger via a thin shared wrapper (DRY, byte-identical desktop)"
    - "Wave-0 fail-pending/skip-loudly stubs (no false-green) so nyquist sampling has a target"
key-files:
  created:
    - "src/components/charts/TouchTooltip.tsx"
    - "src/components/charts/TouchTooltip.test.tsx"
    - "e2e/axe-app-wide.spec.ts"
    - "lighthouserc.json"
    - "src/app/(dashboard)/allocations/widgets/performance/EquityChart.touch.test.tsx"
  modified:
    - "package.json"
    - "package-lock.json"
decisions:
  - "TouchTooltip implemented as a wrapper component (not a useTooltipTrigger hook) — lower per-chart diff friction across 18 files (RESEARCH Alternatives, executor discretion locked)."
  - "lighthouserc.json placeholder note carried as a strict-JSON `_comment` string field (JSON has no comment syntax; keeps `JSON.parse` verify green) with PLACEHOLDER minScore 0.5 for plan 05 to reseed."
  - "EquityChart touch scaffold uses `it.todo` (pending, visible in runner) rather than `.skip` (silent) — keeps the parity contract on the radar without failing the suite."
  - "axe-app-wide Wave-0 placeholder runs ONE public route unseeded; HAS_SEED_ENV const present but only arms the authed rows plan 04 adds (so the public scaffold proves the harness today)."
metrics:
  duration: "~10m"
  tasks_completed: 3
  files_created: 5
  files_modified: 2
  completed: 2026-06-28
---

# Phase 48 Plan 01: Wave 0 Foundation Summary

Stood up the Phase-48 Wave 0 foundation: installed the single net-new dependency `@lhci/cli@0.15.1` (pinned exact), built the one DRY `TouchTooltip` breakpoint-gated Recharts `<Tooltip trigger>` shim with both-branch test coverage, and scaffolded the three downstream Wave-0 stubs (app-wide axe spec, lighthouserc config, EquityChart touch parity test) so plans 02–05 each start against a concrete, non-false-passing target.

## What Was Built

### Task 1 — Supply-chain legitimacy gate (pre-authorized)
`@lhci/cli@0.15.1` legitimacy was pre-authorized by the orchestrator (48-RESEARCH §Package Legitimacy Audit: GoogleChrome/lighthouse-ci org, Lighthouse core-team maintainers, no postinstall). Re-verified live before install: `npm view @lhci/cli@0.15.1` shows version `0.15.1`, **empty `scripts`** (no postinstall code execution), repository `git+https://github.com/GoogleChrome/lighthouse-ci.git`. No checkpoint pause was returned (install approved).

### Task 2 — Install + TouchTooltip shim
- Installed `@lhci/cli@0.15.1` via `npm install --save-dev --save-exact` → `package.json` shows `"@lhci/cli": "0.15.1"` (no caret/tilde), `npm ls` resolves `@lhci/cli@0.15.1`.
- `src/components/charts/TouchTooltip.tsx`: a `"use client"` component importing `{ Tooltip }` from `recharts`, `type { ComponentProps }` from `react`, and `useBreakpoint` from `@/hooks/useBreakpoint`. Computes `const trigger = useBreakpoint() === "mobile" ? "click" : "hover"` and returns `<Tooltip trigger={trigger} {...props} />` (spread AFTER trigger). Wraps `<Tooltip>` ONLY — never a chart root tag — and carries no `accessibilityLayer` token, so it cannot trip the codebase-wide a11y-opt-out grep guard.
- `src/components/charts/TouchTooltip.test.tsx`: mocks `recharts` (Tooltip → div surfacing `trigger`/`formatter`/`contentStyle` as data-attrs) and `@/hooks/useBreakpoint`; 4 assertions — mobile→`click`, desktop→`hover` (byte-identical proof), tablet→`hover` (non-mobile branch), and props-spread-through. Both ternary branches exercised for the branches-72 ratchet.

### Task 3 — Three Wave-0 stubs
- `e2e/axe-app-wide.spec.ts`: `HAS_SEED_ENV` const + `PUBLIC_ROUTES` `{path,anchor}[]` + `VIEWPORTS` (Desktop 1280×800, mobile 375×812) + ONE public-route placeholder test (HTTP<400 + visible-anchor gate before `buildAxe(page).analyze()`, strict `toEqual([])`). Top-of-file comment documents plan 04's job (authed rows + serious+critical embedded-factsheet filter + FLOW-01 dual-wiring). Deliberately NOT in `ci.yml` yet.
- `lighthouserc.json`: valid JSON; `ci.collect` (`startServerCommand:"npm run start"`, 5 public localhost:3000 URLs, `numberOfRuns:3`, `settings.preset:"mobile"`); `ci.assert` (`preset:"lighthouse:no-pwa"`, `categories:performance:["error",{minScore:0.5}]`); `ci.upload.target:"temporary-public-storage"`; PLACEHOLDER `_comment` marking the minScore for plan 05.
- `src/app/(dashboard)/allocations/widgets/performance/EquityChart.touch.test.tsx`: `it.todo` parity scaffold documenting the `px → clampedPx → targetEpoch → nearestIndex` chain (mirrors `handleMove` L1142-1159) plan 03 must prove. Reports 1 todo / 0 failures.

## Deviations from Plan

None — plan executed exactly as written. No Rule 1–4 deviations were needed. The only judgment call within plan latitude: `lighthouserc.json`'s placeholder note is carried as a strict-JSON `_comment` string (JSON has no comment syntax, and the Task-3 verify runs `JSON.parse`), satisfying both the "PLACEHOLDER comment marks the minScore" requirement and the valid-JSON acceptance criterion.

## Authentication Gates

None. No auth-bearing surface touched (this is presentation + CI scaffolding over a frozen engine).

## Verification Results

- `npm ls @lhci/cli` → `0.15.1` (pinned exact). ✅
- `npx vitest run src/components/charts/TouchTooltip.test.tsx` → 4 passed (both branches + spread). ✅
- `grep -c 'useBreakpoint() === "mobile" ? "click" : "hover"' TouchTooltip.tsx` → 1; `grep -c accessibilityLayer TouchTooltip.tsx` → 0; no chart root tag. ✅
- `node -e JSON.parse(lighthouserc.json)` → valid; `preset:"mobile"`, `temporary-public-storage`, PLACEHOLDER present. ✅
- `grep HAS_SEED_ENV / VIEWPORTS e2e/axe-app-wide.spec.ts` → both present; `grep -c axe-app-wide ci.yml` → 0 (plan 04 wires). ✅
- `npx playwright test e2e/axe-app-wide.spec.ts --list` → enumerates 1 test, no error. ✅
- `npx vitest run EquityChart.touch.test.tsx` → 1 todo, 0 failures. ✅
- Frozen-math/parity guards (`chart-accessibility-layer.test.ts`, `phase-31-frozen-spine-guards.test.ts`) → 7 passed, un-weakened. ✅
- Full suite `npm run test` → **571 files passed, 0 failed; 6899 tests passed, 288 skipped, 1 todo** (no new failing tests). ✅

## Known Stubs

These are INTENTIONAL Wave-0 scaffolds, each owned by a downstream plan; none false-passes:
- `e2e/axe-app-wide.spec.ts` — public-route placeholder only; full route × viewport authed matrix + ci.yml dual-wiring filled by **plan 04**.
- `lighthouserc.json` — `minScore: 0.5` is a PLACEHOLDER; baselined from a real run by **plan 05**.
- `src/app/(dashboard)/allocations/widgets/performance/EquityChart.touch.test.tsx` — `it.todo` parity test satisfied by **plan 03** (when useTapPin is wired onto EquityChart).

## Commits

- `f3dc7858` — feat(48-01): install pinned @lhci/cli + TouchTooltip breakpoint-gated trigger shim
- `7dc038a0` — test(48-01): scaffold Wave-0 stubs — axe-app-wide spec, lighthouserc, EquityChart touch test

## Self-Check: PASSED

All 5 created source/config files + the SUMMARY exist on disk; both task commits (`f3dc7858`, `7dc038a0`) exist in git history.
