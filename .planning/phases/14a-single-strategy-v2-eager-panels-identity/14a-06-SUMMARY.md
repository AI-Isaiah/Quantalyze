---
phase: 14a
plan: 06
subsystem: chrome
tags: [cleanup-01, design-03, package-removal, design-decisions-log, pr-template]
requirements: [DESIGN-03, CLEANUP-01]
dependency_graph:
  requires:
    - "src/components/charts/chart-tokens.ts:CHART_TICK_STYLE / CHART_ACCENT (Plan 14a-01) — referenced in PR template"
    - "tests/visual/strategy-v2-type-scale.test.ts (Plan 14a-05) — grep-enforces the v2 4-size/2-weight contract being added to DESIGN.md decisions log"
  provides:
    - "package.json (1 line removed; @nivo/boxplot dependency dropped)"
    - "package-lock.json (24 transitive packages removed; lockfile regenerated)"
    - "DESIGN.md ## Decisions Log (UC#7 7-panel density-rule deviation + v2 4-size/2-weight type contract — 9 total entries)"
    - ".github/PULL_REQUEST_TEMPLATE.md (8-box per-chart identity checklist + Summary + Test plan + Notes)"
  affects:
    - "Phase 14a verification gates 9-10 (institutional-process artifacts now in place)"
    - "All future PRs in repo (auto-pre-populated with the per-chart identity checklist)"
    - "Phase 14b (boxplot dep is gone; lazy panels 4-7 will not need to remove it)"
tech_stack:
  added: []
  patterns:
    - "Single-file PR template at .github/PULL_REQUEST_TEMPLATE.md (per RESEARCH Pitfall 10 — preferred over multi-template directory)"
    - "Append-only edit on DESIGN.md decisions log (preserves all 7 prior rows verbatim)"
    - "Verified-zero-imports gate before npm uninstall (RESEARCH §A1 was correct: ReturnQuantiles.tsx is hand-rolled SVG, no nivo dependency)"
key_files:
  created:
    - ".github/PULL_REQUEST_TEMPLATE.md (33 LOC)"
  modified:
    - "package.json (-1 LOC: removed @nivo/boxplot dependency line)"
    - "package-lock.json (-324 LOC net: 24 transitive packages removed)"
    - "DESIGN.md (+2 LOC: 2 new rows in Decisions Log)"
decisions:
  - "Used single-file PR template at .github/PULL_REQUEST_TEMPLATE.md (per RESEARCH Pitfall 10) — auto-pre-populates all PRs without further config. Multi-template directory at .github/PULL_REQUEST_TEMPLATE/ would have required PR-creators to query-string-select a template, which the project does not need."
  - "Appended both new DESIGN.md rows verbatim from UI-SPEC §12 with date 2026-04-29 (today, per CLAUDE.md currentDate). The rationale text is the contract; not paraphrased."
  - "Single chore() commit for the npm uninstall (package.json + package-lock.json) — both files are part of the same logical change."
metrics:
  duration: "~6 minutes"
  duration_seconds: 360
  completed: "2026-04-29T10:46:23Z"
  tasks_total: 3
  tasks_completed: 3
  files_created: 1
  files_modified: 3
  commits:
    - "2907387 chore(14a-06): uninstall @nivo/boxplot (CLEANUP-01)"
    - "2246292 docs(14a-06): extend DESIGN.md decisions log with v2 contracts (DESIGN-03)"
    - "3a9533e docs(14a-06): add PR template with chart identity checklist (DESIGN-03)"
---

# Phase 14a Plan 06: Chrome Surfaces — Boxplot Cleanup + Decisions Log + PR Template Summary

**One-liner:** Lands Phase 14a's three institutional-process chrome surfaces in parallel with the test-suite plan: (1) `npm uninstall @nivo/boxplot` removes 24 unused transitive packages after verifying zero imports anywhere in src/, tests/, e2e/, scripts/ (CLEANUP-01); (2) appends 2 new entries to DESIGN.md ## Decisions Log capturing the UC#7 7-panel density-rule deviation and the v2 4-size/2-weight type contract verbatim from UI-SPEC §12; (3) creates `.github/PULL_REQUEST_TEMPLATE.md` with the 8-box per-chart identity checklist (DESIGN-03), auto-applying to every future PR against the repo.

## Tasks

| # | Task | Files | Commit | Status |
| - | ---- | ----- | ------ | ------ |
| 1 | npm uninstall @nivo/boxplot (CLEANUP-01) | package.json, package-lock.json | `2907387` | Done |
| 2 | DESIGN.md decisions log + 2 new entries (DESIGN-03) | DESIGN.md | `2246292` | Done |
| 3 | .github/PULL_REQUEST_TEMPLATE.md (DESIGN-03) | .github/PULL_REQUEST_TEMPLATE.md | `3a9533e` | Done |

## Verification Snapshot

| Check | Expected | Result |
| ----- | -------- | ------ |
| `grep -c "@nivo/boxplot" package.json` | 0 | 0 |
| `grep -c "@nivo/boxplot" package-lock.json` | 0 | 0 |
| `grep -rln "@nivo/boxplot" src/ tests/ e2e/ scripts/` | 0 | 0 |
| `grep -c "UC#7 — accept 7-panel single-strategy density-rule deviation" DESIGN.md` | 1 | 1 |
| `grep -c "v2 single-strategy 4-size / 2-weight type contract" DESIGN.md` | 1 | 1 |
| `grep -c "## Decisions Log" DESIGN.md` | 1 | 1 (heading not duplicated) |
| `grep -cE "^\| 2026-04-06 \|" DESIGN.md` | ≥4 | 5 (preserved) |
| `grep -cE "^\| 2026-04-29 \|" DESIGN.md` | 2 | 2 |
| New rows appear AFTER prior last row (line 136) | true | rows at lines 137–138 |
| DESIGN.md line count delta | +2 | 136 → 138 |
| `ls .github/PULL_REQUEST_TEMPLATE.md` | exists | 33 LOC, 1504 bytes |
| `grep -c "## Identity audit (per-chart)" .github/PULL_REQUEST_TEMPLATE.md` | 1 | 1 |
| `grep -cE "^- \[ \]" .github/PULL_REQUEST_TEMPLATE.md` | ≥14 | 14 (8 chart-identity + 6 test-plan) |
| `grep -c "CHART_ACCENT" PR template` | ≥1 | 1 |
| `grep -c "CHART_TICK_STYLE" PR template` | ≥1 | 1 |
| `grep -c "CHART_BORDER" PR template` | ≥1 | 1 |
| `grep -c "CHART_TEXT_MUTED" PR template` | ≥1 | 1 |
| `grep -c "bg-card" PR template` | ≥1 | 1 |
| `grep -c -- "--color-positive" PR template` | ≥1 | 1 |
| `grep -c -- "--color-negative" PR template` | ≥1 | 1 |
| `grep -c -- "--color-track" PR template` | ≥1 | 1 |
| `grep -c "No Plotly chrome" PR template` | 1 | 1 |
| `npm run typecheck` | exit 0 | exit 0 (clean) |
| `npm run build` | exit 0 | exit 0 (Compiled successfully in 6.2s) |
| `npm test --run` | all pass | 2398 passed / 148 skipped (242 test files) |
| `npx vitest run tests/visual/strategy-v2-type-scale.test.ts` | 2/2 pass | 2/2 pass |

## Build + Test Status Post-Uninstall

- `npm run typecheck` — clean exit (0). No TypeScript errors.
- `npm run build` — `✓ Compiled successfully in 6.2s` followed by `✓ Generating static pages using 9 workers (73/73) in 169ms`. All 73 pages generated; `/strategy/[id]/v2` route present.
- `npm test --run` — `Test Files: 242 passed | 12 skipped (254). Tests: 2398 passed | 148 skipped (2546). Duration: 26.96s.` Same pass count as pre-uninstall — zero regressions introduced by the package removal, confirming `@nivo/boxplot` was unused.
- `npx vitest run tests/visual/strategy-v2-type-scale.test.ts` — 2/2 pass. The grep-lint test that enforces the 4-size/2-weight contract still passes after DESIGN.md edits.

## Bundle Size Delta (Informational)

The Next.js v16 build output for this project does not include per-route JS sizes by default — the route table omits the bundle-size column. The expected delta from the plan was ~80KB gzipped saved on chart-bearing routes; the delta is informational and not gated (no CI-gated bundle-size assertion in 14a per CONTEXT.md "Deferred Ideas"). What we *can* confirm:

- `npm uninstall @nivo/boxplot` reported `removed 24 packages, changed 2 packages, audited 925 packages` — 24 transitive packages dropped (boxplot + its `@nivo/core`, `@nivo/colors`, `@nivo/scales`, `d3-format`, `d3-shape`, etc., scoped only to boxplot's dependency tree since `@nivo/colors` was not used elsewhere).
- `node_modules/@nivo/` directory is now empty / absent.
- Any chart route that previously paid for the lazy chunk that included nivo helpers will be lighter; exact delta requires bundle-analyzer instrumentation which is not part of this plan's scope.

## DESIGN.md Line Count Delta

- Pre-edit: 136 lines (last row of decisions log: `2026-04-27 | Formalized --space-grid-gap: 10px ...`).
- Post-edit: 138 lines (two new rows appended at lines 137-138, both dated 2026-04-29).
- Delta: exactly +2 lines. No other content changed.
- Confirmation: `git diff --stat DESIGN.md` reported `1 file changed, 2 insertions(+)`.

## .github/PULL_REQUEST_TEMPLATE.md Confirmation

- File created (`create mode 100644 .github/PULL_REQUEST_TEMPLATE.md` per `git commit` output) — was not editing an existing template; the directory previously contained only `workflows/`.
- 33 lines, 1504 bytes.
- Sections: `## Summary`, `## Test plan` (6 checkboxes), `## Identity audit (per-chart)` (8 checkboxes — the verbatim UI-SPEC §10 list), `## Notes`.
- Token references: `CHART_ACCENT`, `CHART_TICK_STYLE`, `CHART_BORDER`, `CHART_TEXT_MUTED`, `bg-card`, `--color-positive`, `--color-negative`, `--color-track` — all written as inline-code spans.
- GitHub auto-recognizes `.github/PULL_REQUEST_TEMPLATE.md` without further config; the next PR opened against this repo will pre-populate with this template.

## Deviations from Plan

None — plan executed exactly as written. The plan's frontmatter specified line 135 as the existing last row of DESIGN.md decisions log, but the actual last row was at line 136 (a 1-line off-by-one in the plan annotation, not an inaccuracy in the content). Append behavior was unchanged: insert AFTER the prior final row, regardless of which line number that was.

The plan's "Optional, manual" bundle-size capture was attempted; the Next.js v16 build does not surface per-route sizes in the standard `next build` output, so the size delta is recorded narratively in this SUMMARY (informational only — not a gate).

## Auth Gates

None — no authentication or external service interaction was required by this plan.

## Self-Check: PASSED

- File `.github/PULL_REQUEST_TEMPLATE.md` exists: FOUND
- File `DESIGN.md` modified (line count 138, was 136): FOUND
- File `package.json` modified (no @nivo/boxplot): FOUND
- Commit `2907387` (chore: npm uninstall): FOUND in `git log --all`
- Commit `2246292` (docs: DESIGN.md decisions log): FOUND in `git log --all`
- Commit `3a9533e` (docs: PR template): FOUND in `git log --all`
- Branch state at end: `main` (unchanged from start)
- All 4 success criteria from PLAN met (verified via the table above)
