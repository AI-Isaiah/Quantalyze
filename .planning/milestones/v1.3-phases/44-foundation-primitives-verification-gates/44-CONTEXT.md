# Phase 44: Foundation Primitives & Verification Gates - Context

**Gathered:** 2026-06-27
**Status:** Ready for planning
**Mode:** Auto-generated (smart discuss — infrastructure phase detected: all-technical success criteria, no user-facing surface delivered this phase)

<domain>
## Phase Boundary

Build the highest-leverage shared responsive primitives ONCE and stand up the bespoke
verification gates FIRST, so phases 45–48 are "wrap + apply classes" instead of re-deriving
the recipe 40×, and are continuously checked at 320px / 400% zoom as they land.

**In scope:**
- `useBreakpoint` — thin two-pass wrapper over the existing SSR-safe `useMediaQuery`
  (server snapshot `'desktop'`, no hydration mismatch).
- `ResponsiveTable` — `overflow-x-auto` container + sr-only scroll hint.
- `ResponsiveChartFrame` — the `viewBox` + `preserveAspectRatio` + `w-full` recipe extracted
  from `TimeSeriesChart` WITHOUT breaking its parity test.
- Playwright **reflow gate** (`scrollWidth <= clientWidth`, ≤1px slop, at 320px, anchored on a
  visible content element) + **44px target-size** measurement gate, both runnable against any route.
- **zoom-meta source-scan CI guard** that fails on any `maximum-scale` / `user-scalable=no`; root
  `layout.tsx` gets an explicit zoom-permissive `viewport` export.
- All three new gates wired into BOTH the `HAS_SEED_ENV` seed-guard AND `ci.yml`, proven to
  actually execute in CI (FLOW-01); coverage ratchet held un-lowered.

**Out of scope (later phases):** applying the primitives to real surfaces (46), nav shell (45),
chart touch interaction (47/48), app-wide axe at mobile viewport + perf budget (48).

</domain>

<decisions>
## Implementation Decisions

### Claude's Discretion
Pure foundation/plumbing phase — all implementation choices are at Claude's discretion, guided by
the ROADMAP success criteria, DESIGN.md, and existing codebase conventions. The success criteria
already pin the hard constraints (two-pass SSR-safe wrapper, `'desktop'` server snapshot,
`overflow-x-auto` + sr-only hint, viewBox/preserveAspectRatio recipe, ≤1px slop, FLOW-01 dual
wiring, ratchet held). Minor presentational choices (scroll-hint wording, default chart aspect
ratio, gate route selection) decided at plan time against DESIGN.md.

### Verification gate design (locked by criteria)
- Reflow gate anchors its assertion on a visible content element so it can't false-green on a blank
  page; ≤1px slop on `scrollWidth <= clientWidth` at a 320px CSS width.
- Target-size gate measures interactive elements at ≥44px (WCAG 2.5.8 / `pointer-coarse`).
- zoom-meta guard is a source scan (not runtime) — fails the build on `maximum-scale` /
  `user-scalable=no` anywhere in a `viewport` export or `<meta name="viewport">`.
- FLOW-01: every new gate added to BOTH `HAS_SEED_ENV` (where seed-gated) and the explicit
  `ci.yml` spec list, or it silently never runs (burned twice — must be proven to execute in CI).

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/hooks/useMediaQuery.ts` — existing SSR-safe media-query hook; `useBreakpoint` wraps it.
- `src/app/factsheet/[id]/v2/TimeSeriesChart.tsx` — the reference responsive+touch SVG chart;
  source of the `ResponsiveChartFrame` recipe AND the tap-pins-crosshair pattern. Has a
  chart-parity test (`e2e/strategy-v2-chart-parity.spec.ts`) that must NOT break.
- `e2e/helpers/` — shared Playwright helpers; new gate helpers live here.
- `e2e/*-axe.spec.ts` (discovery, strategy-v2, composer, admin-csv-status, wizard) — the current
  5-route axe coverage; the new bespoke gates sit BESIDE these, never replace them.

### Established Patterns
- Two-tier Playwright in `.github/workflows/ci.yml`: an unseeded spec list (~line 1059) and a
  seed-gated list (~line 1252, MA-8 — gated on `vars.E2E_TEST_DB_CONFIGURED`). Adding a spec
  requires updating the explicit list in BOTH the spec file's `HAS_SEED_ENV` guard and ci.yml.
- Coverage ratchet enforced as Vitest thresholds in `vitest.config.ts` (lines 82 / stmts 80 /
  fns 74 / branches 72) + the blocking `frontend-coverage` CI job.
- Root `src/app/layout.tsx` currently has NO `viewport` export — SC#2 requires adding an explicit
  zoom-permissive one. No existing `maximum-scale`/`user-scalable=no` anywhere (guard green from
  the start once added).

### Integration Points
- `src/hooks/` (useBreakpoint), `src/components/` (ResponsiveTable, ResponsiveChartFrame).
- `src/app/layout.tsx` (viewport export).
- `e2e/` + `e2e/helpers/` (reflow, target-size specs), `.github/workflows/ci.yml` (wiring),
  a source-scan guard (zoom-meta) wired like the existing schema/SQL-function source guards.

</code_context>

<specifics>
## Specific Ideas

Mirror the v1.2 JOURNEY-03 lesson: a gate only earns trust once it actually RUNS in CI (that axe
gate caught 3 real bugs only after it executed). Prove each new gate executes in a real CI run,
not just that it exists.

</specifics>

<deferred>
## Deferred Ideas

None — phase scope is fixed by the four success criteria.

</deferred>
