---
phase: 54-verification-v1-3-debt-cleanup-visual-regression-replacement
plan: 05
subsystem: ui
tags: [eslint, design-tokens, no-raw-font-px, BP-03, frozen-spine, lint-ratchet]

# Dependency graph
requires:
  - phase: 54-01a
    provides: frozen-chart off-glob block + --text-fixed-* token aliases
  - phase: 54-01b
    provides: allocations/** + factsheet/[id]/** orphan migration off raw text-[Npx]
  - phase: 54-02a
    provides: strategy/strategy-v2 tree migration off raw text-[Npx]
  - phase: 54-02b
    provides: top-level src/app/* + component orphan migration off raw text-[Npx]
provides:
  - "no-raw-font-px is `error` repo-wide (the final BP-03 strangler flip)"
  - "Repaired frozen off-glob so the [id] dynamic-route brackets actually match (was silently inert)"
  - "Documented BP-03/FROZEN_ISLANDS conflict resolution for the milestone audit"
affects: [milestone-v1.4-audit, future-raw-px-regression, BP-03]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "ESLint flat-config `files` globs that target a literal Next.js dynamic-route segment (`[id]`) MUST backslash-escape the brackets (`\\[id\\]`) — minimatch reads an unescaped `[id]` as a character class and the glob silently never matches."
    - "BP-03 'error repo-wide' is honestly satisfied as 'error everywhere EXCEPT documented frozen-chart islands' (off-glob carve-out), not by editing the frozen files."

key-files:
  created:
    - .planning/phases/54-verification-v1-3-debt-cleanup-visual-regression-replacement/54-05-SUMMARY.md
  modified:
    - eslint.config.mjs

key-decisions:
  - "Flipped quantalyze/no-raw-font-px from warn to error repo-wide (the LAST BP-03 step) only after a hard-gated precondition proved 0 no-raw-font-px findings (warn or error) anywhere in src."
  - "Discovered + fixed a latent bug from 54-01a: the frozen off-glob for the 3 factsheet SVG charts used the literal `[id]` bracket path, which minimatch treats as a character class — so the off-glob never matched and those 3 frozen files rode the repo-wide rule. At `warn` that was invisible; at `error` it would have red CI. Escaped the brackets to `\\[id\\]`. Surgical: touched only the off-glob brackets, not the redundant per-surface error blocks."
  - "Left the now-redundant Phase-52/53 per-surface `error` ratchet blocks in place (harmless once repo-wide is error; future cleanup, not required by BP-03) — per plan <interfaces>."
  - "Did NOT edit any frozen chart file (EquityChart + 3 factsheet SVGs); did NOT migrate WorstDrawdowns (intentionally off-globbed via components/charts/**)."

patterns-established:
  - "Pattern: literal-bracket dynamic-route segments in ESLint flat-config globs need `\\[...\\]` escaping; verify each off/error glob with a single-file `npx eslint <path> --format json` finding count, not just a full-tree exit code (a non-matching off-glob is silently masked while the repo-wide rule is `warn`)."

requirements-completed: [BP-03]

# Metrics
duration: ~15min
completed: 2026-06-30
---

# Phase 54 Plan 05: BP-03 Final Flip (no-raw-font-px warn→error repo-wide) Summary

**Flipped `quantalyze/no-raw-font-px` from `warn` to `error` repo-wide and repaired the silently-inert frozen-chart off-glob (escaped the `[id]` dynamic-route brackets) so the flip passes with 0 errors while EquityChart + the 3 factsheet SVGs stay byte-identical — the last BP-03 step.**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-06-30T01:55Z
- **Completed:** 2026-06-30T02:01Z
- **Tasks:** 2
- **Files modified:** 1 (eslint.config.mjs) + 1 SUMMARY created

## Accomplishments
- `no-raw-font-px` is now `error` repo-wide — any future raw `text-[Npx]` / `fontSize: 'Npx'` in production source fails CI by construction.
- `npx eslint "src/**/*.{ts,tsx}"` exits **0** (0 errors; only 31 pre-existing, unrelated `no-unused-vars` / `react-hooks/*` / unused-disable warnings).
- Repaired a latent off-glob bug inherited from 54-01a: the 3 factsheet SVG frozen charts are now genuinely exempted (the bracket-glob was matching nothing before).
- Documented the BP-03/FROZEN_ISLANDS conflict resolution in the rationale comment for the milestone audit, so BP-03 is not read as an unmet gap.
- All locked byte-equivalence invariants stayed green (frozen-spine guard, FactsheetBody GUARD-02, design-token-drift); zero git-diff to the 4 frozen chart files + scenario.ts.

## Task Commits

1. **Task 1: Flip no-raw-font-px to error repo-wide + document the frozen exemption** - `f4a23332` (feat)
2. **Task 2: Prove the locked invariants stayed green** - no code change (proof-only task; verified via the guards run, no commit needed)

**Plan metadata:** committed with this SUMMARY (docs: complete plan)

## Files Created/Modified
- `eslint.config.mjs` - (1) flipped `quantalyze/no-raw-font-px` `"warn"`→`"error"` in the repo-wide `src/**/*.{ts,tsx}` block; (2) updated the :64-82 rationale comment to record the BP-03 flip + the documented frozen-chart island exemption (audit note); (3) escaped the `[id]` brackets in the frozen off-glob (`\\[id\\]`) so TimeSeriesChart/HistogramChart/MasterBrush are actually matched.

## Off-Glob Coverage List (all remaining raw-px sites — proven exempt)

After the flip, the only raw `text-[Npx]` sites in the tree are, and each is covered:

| File | Raw-px sites | Exempt via |
|------|-------------|-----------|
| `src/app/(dashboard)/allocations/widgets/performance/EquityChart.tsx` | 4 | frozen off-glob (no brackets — matched as written) |
| `src/app/factsheet/[id]/v2/TimeSeriesChart.tsx` | 5 | frozen off-glob (escaped `\[id\]` — fixed this plan) |
| `src/app/factsheet/[id]/v2/HistogramChart.tsx` | 4 | frozen off-glob (escaped `\[id\]` — fixed this plan) |
| `src/app/factsheet/[id]/v2/MasterBrush.tsx` | 1 | frozen off-glob (escaped `\[id\]` — fixed this plan) |
| `src/components/charts/WorstDrawdowns.tsx` | 1 | `src/components/charts/**` off-glob (recursive `**`, no brackets) |
| `src/app/factsheet/[id]/v2/BatchDPanels.peer-scenario.test.tsx` | (fixture) | test-exempt block `src/**/*.{test,spec}.{ts,tsx}` |
| `src/app/factsheet/[id]/v2/MandatePanels.scenario.test.tsx` | (fixture) | test-exempt block |
| `src/app/(dashboard)/allocations/widgets/outcomes/outcomes.test.tsx` | (fixture) | test-exempt block |

(`src/components/strategy-v2/StrategyV2Shell.tsx` matched a grep for `32px` but it is inside a COMMENT next to a `var(--text-fixed-32)` token — already migrated, 0 findings, not a raw site.)

## BP-03 Audit Note

**BP-03 success criterion 2 ("`no-raw-font-px` is `error` repo-wide") is SATISFIED as: `error` everywhere EXCEPT the documented frozen-chart islands.** The frozen EquityChart and the three chart-internal factsheet SVGs (TimeSeriesChart/HistogramChart/MasterBrush) carry raw `text-[Npx]` sites that can NEVER migrate — they are in the `FROZEN_ISLANDS` git-diff-zero list at `src/__tests__/phase-52-frozen-spine-guards.test.ts:158`, so any byte edit reds the frozen-spine guard. The CONTEXT-locked resolution of the BP-03-vs-FROZEN_ISLANDS conflict is to EXEMPT them via the `off` glob (mirroring `src/components/charts/**`), NEVER to edit them. This is the documented island carve-out, not an unmet BP-03 gap. The rationale comment in `eslint.config.mjs` (the :64-82 block) records this verbatim for the milestone auditor. No production source can author a new raw px without failing CI.

## Decisions Made
- See `key-decisions` frontmatter. Headline: hard-gated the flip on a zero-finding precondition (CLAUDE.md Rule 12 fail-loud), and root-caused the frozen off-glob never matching before flipping (CLAUDE.md Rule 6 — no bandaid).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug / Rule 3 - Blocking] Repaired the frozen off-glob `[id]` bracket-glob that silently never matched**
- **Found during:** Task 1 (precondition check before flipping)
- **Issue:** The frozen off-glob added in 54-01a listed the 3 factsheet SVG charts as `src/app/factsheet/[id]/v2/<Chart>.tsx`. ESLint flat config matches `files` with minimatch, which reads an unescaped `[id]` as a character class (one of `i`/`d`), NOT the literal dynamic-route directory `[id]`. So the off-glob never matched those files — they rode the repo-wide rule. While the rule was `warn` this was invisible (they showed as warnings, indistinguishable from the dirty baseline). At `error` (this plan's flip) it would have red CI on 3 FROZEN files that can never be edited — a blocking issue for the flip and a fail-loud STOP condition per the plan's critical constraints. The same latent bug affects the per-surface `error` ratchet blocks that list `factsheet/[id]/v2/*` files (those "clean" factsheet files were never actually escalated to error), but per the plan `<interfaces>` those blocks are redundant-and-harmless once repo-wide is error, so they were left untouched (surgical scope).
- **Fix:** Escaped the brackets to `src/app/factsheet/\\[id\\]/v2/<Chart>.tsx` in the frozen off-glob block, and added a NOTE comment explaining the minimatch character-class trap. EquityChart has no bracket segment so it was already matching.
- **Files modified:** eslint.config.mjs
- **Verification:** Per-file `npx eslint <chart> --format json` now returns 0 `no-raw-font-px` findings for all 3 factsheet charts (was 5/4/1). Full-tree precondition then showed 0 findings anywhere, so the flip was safe.
- **Committed in:** `f4a23332` (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (Rule 1/Rule 3 — a latent bug that blocked the flip).
**Impact on plan:** The fix was a hard prerequisite for the flip (CLAUDE.md Rule 12: flipping over a non-matching off-glob would have reported "done" while red-ing CI on frozen files). No scope creep — the only edit beyond the planned severity flip + comment was escaping 3 bracket-glob paths. No frozen file was touched.

## Issues Encountered
None beyond the off-glob bug documented as a deviation. The `HTMLCanvasElement getContext()` lines in the vitest run are benign jsdom Recharts noise, not failures.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- BP-03 is complete: `no-raw-font-px` is `error` repo-wide with documented frozen-chart islands. ROADMAP success criterion 2 is met.
- Frozen-spine guard + FactsheetBody GUARD-02 + design-token-drift all green; scenario.ts / FactsheetBody byte-equivalence intact (zero git-diff to the 4 frozen chart files + scenario.ts).
- Note for milestone audit: the BP-03 audit note above is the canonical statement that the frozen-chart off-glob is an intentional carve-out, not a gap.

## Self-Check: PASSED

---
*Phase: 54-verification-v1-3-debt-cleanup-visual-regression-replacement*
*Completed: 2026-06-30*
