---
phase: 50-primitive-refresh-missing-primitives
plan: 07
subsystem: admin-ui
tags: [strangler-pilot, primitives, a11y, compute-jobs, UI-03, UI-02]
requires:
  - "50-02 (Button primitive refresh)"
  - "50-03 (Table / Field / Select primitives)"
provides:
  - "Proven incremental strangler migration of ONE surface (/admin/compute-jobs) onto the primitive toolkit"
  - "A seeded, admin-gated axe gate on /admin/compute-jobs wired into CI (both FLOW-01 places)"
affects:
  - "src/components/admin/ComputeJobsTable.tsx (now renders via primitives + tokens)"
tech-stack:
  added: []
  patterns:
    - "Field-wrapped native Select primitive for filter dropdowns"
    - "Table base parts (Table/TableHead/TableBody/TableRow/TableHeaderCell/TableCell) inside the ResponsiveTable scroll/landmark wrapper"
    - "Semantic status tokens (bg-positive/10 text-positive …) replacing inline rgba/#hex"
key-files:
  created:
    - "e2e/admin-compute-jobs-axe.spec.ts"
  modified:
    - "src/components/admin/ComputeJobsTable.tsx"
    - "src/components/admin/ComputeJobsTable.test.tsx"
    - ".github/workflows/ci.yml"
decisions:
  - "Kept the local statusBadgeClass map (converted hex->semantic-token classes) rather than reusing the Badge primitive, because Badge re-labels statuses and does not cover failed_retry/failed_final/running — reuse would change the displayed status text (behavior regression)."
  - "Left the auto-refresh control as a raw <input type=checkbox> inside its <label> (NOT a new checkbox primitive) — none exists, and the byte-compat useCrossTabStorage persistence + the getByRole('checkbox', {name:/auto-refresh/i}) contract must stay unchanged. Field-wrapped only the Selects."
  - "Replaced the 3 text-[NNpx] font sites with the fluid text-micro token (10-11px tier) to avoid new no-raw-font-px WARN sites while cleaning onto --text-* tokens."
  - "Did NOT touch the page.tsx's own raw <table> — the plan scopes the pilot strictly to the ComputeJobsTable CLIENT component; migrating the server page table is out of scope (and would risk the claim-token select gate)."
metrics:
  duration: "~10m"
  completed: "2026-06-29"
  tasks: 3
  files: 4
---

# Phase 50 Plan 07: Strangler Pilot (/admin/compute-jobs) Summary

Migrated the `/admin/compute-jobs` surface (the `ComputeJobsTable` client component) off raw `<button>`/`<table>`/`<select>`/`<input>` onto the Button / Table / Field / Select primitives — behavior-identical, one surface only — and added a seeded admin-gated axe gate wired into CI, proving the primitive strangler is incremental (UI-03).

## What shipped

- **`ComputeJobsTable.tsx` migrated onto primitives + tokens** (`488b1a4f`):
  - "Load more" raw `<button>` → `<Button variant="secondary" size="sm">` (same `onClick={loadMore}` + `disabled={loading}` + label).
  - The jobs `<table>` → the Table base parts (`<th scope="col">` headers via `TableHeaderCell`, a named `<table aria-label="Compute jobs">`) inside the existing `ResponsiveTable label="Compute jobs"` wrapper. 6 columns, status badge, `font-metric tabular-nums` (via `numeric` on the Attempts cell), truncate+`title` on Target/Last Error, and the empty "No compute jobs found." row all preserved.
  - Status/kind `<select>` filters → Field-wrapped native `Select` primitive.
  - **22 inline `#hex` + 3 `text-[NNpx]` sites removed** → `--color-*` / `--text-*` token utilities (`text-caption`/`text-micro`/`text-small`, `text-text-muted/secondary/primary`, `bg-page`, `accent-accent`). `statusColor` rgba/hex → `bg-positive/10 text-positive` semantic classes.
  - `useCrossTabStorage` byte-compat `String(bool)` persistence and the `/api/admin/compute-jobs` fetch params (`limit/offset/status/kind`) are **unchanged**.

- **Ported the test** (`4d71628c`): the 3 auto-refresh persistence assertions stay green (the checkbox + its accessible name were deliberately untouched), plus two added DOM-shape assertions — jobs render through a real `<table>` with `scope="col"` headers (Table base), and the Load-more `<Button>` appears when the page is full (`hasMore`). 5/5 pass.

- **Axe spec + CI wiring** (`cc2935dc`): `e2e/admin-compute-jobs-axe.spec.ts` mirrors `admin-csv-status-axe.spec.ts` 1:1 (seed gate, admin login, `buildAxe(page).analyze()` → `violations.toEqual([])`, URL-pin false-green guard). **FLOW-01 satisfied**: registered in BOTH the `ci.yml` seeded MA-8 `npx playwright test` list AND its own `HAS_SEED_ENV` self-skip const. NOT added to the public/unseeded list (admin-gated surface).

## Threat model — mitigations preserved

| Threat ID | Disposition | How preserved |
|-----------|-------------|---------------|
| T-50-10 (admin gate / EoP) | mitigate | `page.tsx` `if (!(await isAdminUser(...))) redirect("/discovery/crypto-sma")` is byte-unchanged (only the CLIENT component was edited); the new axe spec runs admin-authed; the URL-pin guard fails loudly if a non-admin seed reaches the page. |
| T-50-11 (claim-token leak) | mitigate | The pilot edits the client renderer, not the page's explicit select list (which omits `claim_token`). No `select("*")` against `compute_jobs` introduced — `compute-jobs-claim-token-not-leaked.test.ts` stays green (verified). |
| T-50-04 (XSS) | mitigate | All fetched strings (`last_error`, `target`, `kind`, `status`) render as React-escaped children through the Table/Cell primitives. No `dangerouslySetInnerHTML` added. |
| T-50-SC (supply chain) | accept | The axe spec reuses the existing `buildAxe` + `seedTestAllocator` helpers; no new package added. |

## Deviations from Plan

None — plan executed as written. (No Rule 1-4 deviations triggered.) One note: the plan text referenced a non-existent `no-raw-hex` ESLint rule; the actual repo gate is the `grep -cE '#[0-9A-Fa-f]{6}' == 0` acceptance criterion plus the `no-raw-font-px` WARN rule — both satisfied (hex==0; the 3 `text-[NNpx]` sites were also cleaned to `text-micro`, adding zero new WARN sites).

## Verification

- `npx vitest run src/components/admin/ComputeJobsTable.test.tsx` → 5/5 pass.
- `npx vitest run src/__tests__/compute-jobs-claim-token-not-leaked.test.ts` → 1/1 pass (claim-token gate green).
- `grep -cE '#[0-9A-Fa-f]{6}' src/components/admin/ComputeJobsTable.tsx` → 0.
- `npx eslint` on all touched files → exit 0; `npx tsc --noEmit` → no errors.
- `npx playwright test e2e/admin-compute-jobs-axe.spec.ts --list` → collects 1 test; spec self-skips without seed env.
- `page.tsx` admin gate unchanged in the working tree (last commit predates this branch).

## Commits

- `488b1a4f` — feat(50-07): migrate ComputeJobsTable onto Button/Table/Field/Select primitives + tokens
- `4d71628c` — test(50-07): port ComputeJobsTable test to primitive DOM (BP-03)
- `cc2935dc` — test(50-07): add /admin/compute-jobs axe spec + wire into CI (FLOW-01)

## Self-Check: PASSED

All created files exist (ComputeJobsTable.tsx, ComputeJobsTable.test.tsx, admin-compute-jobs-axe.spec.ts, 50-07-SUMMARY.md) and all 3 commits (488b1a4f, 4d71628c, cc2935dc) are in the git log.
