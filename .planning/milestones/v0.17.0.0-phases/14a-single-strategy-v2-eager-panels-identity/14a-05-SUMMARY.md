---
phase: 14a
plan: 05
subsystem: tests
tags: [test-suite, vitest, playwright, a11y-01, kpi-22, kpi-23a, design-02, intersection-observer]
requirements: [KPI-22, KPI-23a, DESIGN-02, A11Y-01]
dependency_graph:
  requires:
    - "src/components/charts/chart-tokens.ts:CHART_AXIS_TICK (Plan 14a-01)"
    - "src/lib/queries.ts:StrategyV2Detail (Plan 14a-02)"
    - "src/components/strategy-v2/StrategyV2Shell.tsx (Plan 14a-03)"
    - "src/components/strategy-v2/{Overview,HeadlineMetrics,Drawdown,LazyPanelPlaceholder}Panel.tsx (Plan 14a-03)"
    - "src/app/strategy/[id]/v2/page.tsx (Plan 14a-04 — required for the Playwright spec to navigate)"
  provides:
    - "tests/a11y/chart-contrast.test.ts (WCAG-AA chart-axis contrast — A11Y-01)"
    - "tests/visual/strategy-v2-type-scale.test.ts (4-size / 2-weight contract — DESIGN-02)"
    - "tests/visual/strategy-v2-panel-count.test.tsx (7-panel hard count — KPI-22)"
    - "e2e/strategy-v2-partial-data.spec.ts (4 history bands — KPI-23a)"
    - "vitest.config.ts (extended include glob covering tests/a11y + tests/visual)"
    - "src/test-setup.ts (global IntersectionObserver stub)"
  affects:
    - "Phase 14a verification gates 2-5 (success criteria mechanically enforced)"
    - "Phase 14b — IntersectionObserver stub now global; lazy-panel body tests inherit it for free"
    - "Phase 14b — `seedStrategyWithHistory` helper extension required to flip e2e/strategy-v2-partial-data.spec.ts from authored-but-skipped to actively-passing in CI"
tech_stack:
  added: []
  patterns:
    - "Top-level tests/ dirs (a11y/, visual/) — explicit deviation from co-located convention, documented in CONTEXT.md"
    - "Hand-rolled WCAG luminance helper (12 lines, no `polished` dependency)"
    - "Pure-Node grep-style content scan over src/components/strategy-v2/**/*.tsx (forbidden-pattern enforcement)"
    - "JSDOM render of full StrategyV2Shell with synthetic StrategyV2Detail fixture + lightweight-charts/Recharts mocks (Pattern 5 + Pattern 6 from RESEARCH)"
    - "Playwright authored-but-not-CI-blocking via env-var test.skip (mirrors Phase 13 discovery-hide-examples-default.spec.ts)"
    - "Global IntersectionObserver stub alongside ResizeObserver stub (Open Question 5 resolution — replaces per-test stub at AllocationDashboardV2.widget-gating.test.tsx:113-124)"
key_files:
  created:
    - "tests/a11y/chart-contrast.test.ts (95 LOC)"
    - "tests/visual/strategy-v2-type-scale.test.ts (72 LOC)"
    - "tests/visual/strategy-v2-panel-count.test.tsx (132 LOC)"
    - "e2e/strategy-v2-partial-data.spec.ts (162 LOC)"
  modified:
    - "vitest.config.ts (+5 LOC: extended include glob with tests/a11y/**/*.test.ts, tests/visual/**/*.test.ts, tests/visual/**/*.test.tsx)"
    - "src/test-setup.ts (+20 LOC: IntersectionObserverStub class + globalThis assignment, mirrors ResizeObserver pattern)"
decisions:
  - "Panel-count test ships as .test.tsx (not .test.ts as the plan's frontmatter implied) because the test renders <StrategyV2Shell /> with JSX which requires the .tsx extension under TypeScript. vitest.config.ts include glob extended to cover both .ts and .tsx for tests/visual/. Spirit of the plan preserved (top-level tests/visual/ dir, panel-count assertions intact)."
  - "Playwright spec ships authored-but-skipped: `seedStrategyWithHistory` is an in-file throwing stub. Existing seedTestAllocator / seedBridgeCandidate helpers (e2e/helpers/seed-test-project.ts) do NOT support arbitrary returns_series length — extending them is deferred to Phase 14b, per the plan's Open Question 3 + Assumption A8 fallback path. The env-var skip gate (TEST_SUPABASE_URL / TEST_SUPABASE_SERVICE_ROLE_KEY) ensures the throwing stub is never reached in CI. Local runs with the env vars set fail loudly with a clear message pointing at the helper extension."
  - "lightweight-charts mock includes both `createChart` AND `LineSeries` value-symbol export. EquityCurve.tsx:62 calls `chart.addSeries(LineSeries, ...)` so the symbol must resolve; the mock returns the string 'LineSeries' which the mocked addSeries silently ignores. Type-only imports (IChartApi, ISeriesApi, SeriesType) are erased at runtime."
metrics:
  duration: "6m 53s"
  duration_seconds: 413
  completed: "2026-04-29T10:36:51Z"
  tasks_total: 4
  tasks_completed: 4
  files_created: 4
  files_modified: 2
  lines_added: 486
  commits:
    - "eee893b chore(14a-05): extend vitest include + add IntersectionObserver stub"
    - "4d34473 test(14a-05): add chart-contrast + type-scale lint tests"
    - "67b4e46 test(14a-05): add StrategyV2Shell panel-count test (KPI-22)"
    - "86d4bfd test(14a-05): add partial-data history-band Playwright spec (KPI-23a)"
---

# Phase 14a Plan 05: Test Suite Gating Summary

**One-liner:** Lands the four-file test suite that mechanically enforces Phase 14a's verification gates — WCAG-AA chart-axis contrast (A11Y-01), 7-panel hard count via JSDOM render (KPI-22), 4-size/2-weight type-scale contract (DESIGN-02), and a Playwright partial-data history-band spec (KPI-23a). Wires the global IntersectionObserver stub for all future component tests and extends vitest config to discover the new top-level `tests/a11y/` and `tests/visual/` dirs.

## Tasks

| # | Task | Files | Commit | Status |
| - | ---- | ----- | ------ | ------ |
| 1 | vitest.config.ts include glob + IntersectionObserver stub | 2 modified | `eee893b` | Done |
| 2 | chart-contrast.test.ts + type-scale.test.ts | 2 created | `4d34473` | Done |
| 3 | strategy-v2-panel-count.test.tsx | 1 created + 1 modified | `67b4e46` | Done |
| 4 | strategy-v2-partial-data.spec.ts | 1 created | `86d4bfd` | Done |

## Test Pass Counts

| File | Tests | Status |
| ---- | ----- | ------ |
| `tests/a11y/chart-contrast.test.ts` | 2 | 2/2 pass |
| `tests/visual/strategy-v2-type-scale.test.ts` | 2 | 2/2 pass |
| `tests/visual/strategy-v2-panel-count.test.tsx` | 3 | 3/3 pass |
| `e2e/strategy-v2-partial-data.spec.ts` | 4 (Playwright list) | Authored-but-skipped (env-var gate) |

**Combined `tests/` Vitest run:** `npm test -- tests/ --run` → 3 files, 7 tests, all pass (Duration 661ms).

**Regression check (post-vitest-config-change):** `npm test -- src/lib/strategy-ui-v2-flag.test.ts --run` → 10/10 pass.

## Playwright Discovery

```
$ npx playwright test --list e2e/strategy-v2-partial-data.spec.ts
Listing tests:
  [chromium] › strategy-v2-partial-data.spec.ts:56:9 › Phase 14a — partial-data history bands (KPI-23a) › 7-day fixture …
  [chromium] › strategy-v2-partial-data.spec.ts:56:9 › Phase 14a — partial-data history bands (KPI-23a) › 30-day fixture …
  [chromium] › strategy-v2-partial-data.spec.ts:56:9 › Phase 14a — partial-data history bands (KPI-23a) › 90-day fixture …
  [chromium] › strategy-v2-partial-data.spec.ts:56:9 › Phase 14a — partial-data history bands (KPI-23a) › 365-day fixture …
Total: 4 tests in 1 file
```

## Verification (Plan §verification)

| Gate | Command | Result |
| ---- | ------- | ------ |
| Regression: existing flag test | `npm test -- src/lib/strategy-ui-v2-flag.test.ts --run` | exit 0, 10/10 |
| New a11y test | `npm test -- tests/a11y/chart-contrast.test.ts --run` | exit 0, 2/2 |
| New visual tests | `npm test -- tests/visual/ --run` | exit 0, 5/5 (2 type-scale + 3 panel-count) |
| All tests/ together | `npm test -- tests/ --run` | exit 0, 3 files / 7 tests |
| Playwright spec discovery | `npx playwright test --list e2e/strategy-v2-partial-data.spec.ts` | exit 0, 4 tests |
| TypeScript | `npx tsc --noEmit` | exit 0 |
| Production build | `npm run build` | exit 0 (Compiled successfully in 4.6s; 73/73 pages generated) |

## Acceptance Criteria — Cross-Task Verification

**Task 1 (vitest.config.ts + test-setup.ts):**
- `grep -n 'tests/a11y/\\*\\*/\\*.test.ts' vitest.config.ts` → 1 match ✓
- `grep -n 'tests/visual/\\*\\*/\\*.test.ts' vitest.config.ts` → 1 match ✓
- `grep -n 'src/\\*\\*/\\*.test.\\{ts,tsx\\}' vitest.config.ts` → 1 match (existing entry preserved) ✓
- `grep -n "class IntersectionObserverStub" src/test-setup.ts` → 1 match ✓
- `grep -n "globalThis as { IntersectionObserver" src/test-setup.ts` → 1 match ✓
- `grep -n "class ResizeObserverStub" src/test-setup.ts` → 1 match (existing stub preserved) ✓

**Task 2 (chart-contrast + type-scale):**
- `grep -c "getContrastRatio" tests/a11y/chart-contrast.test.ts` → 3 (helper definition + assertion + ≥2 expected) ✓
- `grep -c "toBeGreaterThanOrEqual(4.5)" tests/a11y/chart-contrast.test.ts` → 1 ✓
- `grep -cE "FORBIDDEN_TEXT_FILLS|#94A3B8|#718096" tests/a11y/chart-contrast.test.ts` → 5 (≥2 expected) ✓
- `grep -cE "FORBIDDEN_SIZES|FORBIDDEN_WEIGHTS" tests/visual/strategy-v2-type-scale.test.ts` → 4 (≥2 expected) ✓

**Task 3 (panel-count):**
- `grep -c 'expect(sections.length).toBe(7)' tests/visual/strategy-v2-panel-count.test.tsx` → 1 ✓
- `grep -c 'expect(placeholders.length).toBe(4)' tests/visual/strategy-v2-panel-count.test.tsx` → 1 ✓
- `grep -c 'vi.mock("recharts"' tests/visual/strategy-v2-panel-count.test.tsx` → 1 ✓
- `grep -c 'vi.mock("lightweight-charts"' tests/visual/strategy-v2-panel-count.test.tsx` → 1 ✓
- `grep -c "StrategyV2Shell" tests/visual/strategy-v2-panel-count.test.tsx` → 6 (import + render × 3 + describe + comment; ≥2 expected) ✓
- `grep -c "history_days: 365" tests/visual/strategy-v2-panel-count.test.tsx` → 1 ✓

**Task 4 (Playwright partial-data spec):**
- File at `e2e/strategy-v2-partial-data.spec.ts` (NOT `tests/e2e/`) ✓ (RESEARCH Pitfall 2 honored)
- `grep -c "test.skip" e2e/strategy-v2-partial-data.spec.ts` → 3 (1 describe-level skip + 2 inline references; ≥1 expected) ✓
- `grep -c "TEST_SUPABASE_URL" e2e/strategy-v2-partial-data.spec.ts` → 5 (≥1 expected) ✓
- `grep -c 'section\\[data-panel\\]' e2e/strategy-v2-partial-data.spec.ts` → 2 (≥1 expected) ✓
- `grep -c "toHaveCount(7)" e2e/strategy-v2-partial-data.spec.ts` → 1 (≥1 expected) ✓
- `grep -cE "7-day|30-day|90-day|365-day" e2e/strategy-v2-partial-data.spec.ts` → 5 (≥4 expected) ✓
- `grep -c "Awaiting more data" e2e/strategy-v2-partial-data.spec.ts` → 1 (≥1 expected) ✓
- `npx playwright test --list e2e/strategy-v2-partial-data.spec.ts` → 4 tests listed ✓

## Helper Extension Status

`e2e/helpers/seed-test-project.ts` was **NOT extended** in this plan. The existing helpers cover:

| Helper | Purpose | Sufficient for KPI-23a partial-data bands? |
| ------ | ------- | ------------------------------------------- |
| `seedTestAllocator()` | Fresh allocator user via service-role admin API | No — does not seed any strategy |
| `seedBridgeCandidate()` | Single placeholder published strategy | No — no `returns_series` of arbitrary length |

**Deferred to Phase 14b:** A new `seedStrategyWithHistory({ days })` export that seeds (a) a published strategy, (b) a `strategy_analytics` row with `returns_series` of exactly N days, and (c) `metrics_json` keys that pass / fail the per-panel partial-data thresholds (Panel 1 ≥1, Panel 2 strip ≥30, Panel 2 chart ≥7, Panel 3 chart ≥30). The current spec ships with an in-file throwing stub gated behind the env-var `test.skip`, so CI is never affected and local runs without env vars are skipped cleanly.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Panel-count test must use .tsx extension (JSX content)**

- **Found during:** Task 3 file creation.
- **Issue:** Plan §files (line 11) and acceptance criteria (line 540) call out `tests/visual/strategy-v2-panel-count.test.ts` (`.ts` extension). However, the plan's action block (lines 425+) ships JSX — `<StrategyV2Shell detail={FIXTURE} />`, `<div style={...}>{children}</div>` — which TypeScript only allows in `.tsx` files (without explicit `--jsx preserve` overrides). Trying to ship the file as `.ts` would have produced compile errors on every JSX expression.
- **Fix:** File created as `tests/visual/strategy-v2-panel-count.test.tsx`. `vitest.config.ts` `include` glob extended with a fourth entry `tests/visual/**/*.test.tsx` (alongside the planned `tests/visual/**/*.test.ts`). The `.test.ts` entry is preserved for future pure-Node tests in the dir.
- **Files modified:** vitest.config.ts (one extra include line); test file extension `.tsx` instead of `.ts`.
- **Behavior preserved:** All Plan §acceptance_criteria for Task 3 reference the file as `tests/visual/strategy-v2-panel-count.test.ts` in their grep targets — the file at `.tsx` satisfies them via the same path-prefix grep behavior. The 7-panel hard-count contract, the 4-placeholder contract, and the aria-label contract are all enforced exactly as the plan specifies.
- **Commit:** `67b4e46`.

**2. [Rule 2 - Missing] lightweight-charts mock must export the LineSeries value symbol**

- **Found during:** Task 3 first dry-run (before re-reading EquityCurve.tsx).
- **Issue:** The plan's draft mock for lightweight-charts exposes `addAreaSeries` and `addLineSeries` (legacy API). However, `EquityCurve.tsx:62` uses the modern API `chart.addSeries(LineSeries, ...)` where `LineSeries` is a value symbol imported from `lightweight-charts`. Without that symbol, the eager Panel 2 render path throws under JSDOM and the test fails with `LineSeries is not a function` — masking the actual panel-count assertion.
- **Fix:** Mock returns `LineSeries: "LineSeries"` (string sentinel — the mocked `addSeries` silently ignores it) AND a stubbed `addSeries: () => ({ setData, applyOptions })`. Type-only imports (`IChartApi`, `ISeriesApi`, `SeriesType`) are erased at runtime so they need no replacement. Both legacy `addAreaSeries` / `addLineSeries` are kept defensively.
- **Files modified:** `tests/visual/strategy-v2-panel-count.test.tsx` only (mock block).
- **Verification:** Test passes 3/3 with chart paths exercised (history_days=365 means cumulative chart renders, not the partial-data banner).
- **Commit:** `67b4e46`.

### Documented Decisions (no rule violation, just visible flagging)

**3. Playwright spec ships authored-but-skipped (per plan's explicit Open Question 3 + Assumption A8 fallback path)**

- **Plan instruction:** "if the helper does NOT support arbitrary returns_series length, document the deviation in SUMMARY and proceed with whatever seeding the helper supports OR mark the test as authored-but-skipped pending a Phase 14b helper extension" (PLAN.md line 567).
- **Decision:** Authored-but-skipped. Reason: extending `e2e/helpers/seed-test-project.ts` to seed strategies with arbitrary `returns_series` lengths is non-trivial (requires inserting `strategy_analytics` rows with `metrics_json` keys matching the per-panel thresholds) and is part of Phase 14b's broader lazy-panel body fixture work. Shipping the spec authored-but-skipped now means Phase 14b just has to land the helper, no spec rewrite.
- **Risk:** Until Phase 14b, the KPI-23a partial-data contract is enforced only at unit-test level (banner-trigger predicates inside the panel components — covered by future component tests in 14a-03 follow-ups). The Playwright spec exists and lists 4 tests for `npx playwright test --list`, but actually running it requires the env vars + helper.
- **Recovery path:** Phase 14b extends `seedStrategyWithHistory` in `e2e/helpers/seed-test-project.ts`, removes the throwing-stub function from the spec, and replaces it with the helper import. The describe-level `test.skip(!HAS_SEED_ENV, …)` gate stays — it's the project's standard authored-but-not-CI-blocking pattern (mirrors discovery-hide-examples-default.spec.ts).

## Authentication Gates

None — this plan ships test files only. No external services, no API keys, no auth flow.

## Threat Model Compliance

| Threat | Disposition | Implementation |
| ------ | ----------- | -------------- |
| T-14a-05-01 (Information disclosure via test fixture) | mitigate | Synthetic UUIDs only (`"test-uuid"`, `"user-1"`); no production data referenced. The Playwright spec uses `TEST_SUPABASE_URL` (test instance, NOT production); the seed helper itself enforces this via `assertNotProductionSupabaseUrl` (Phase 11 WR-05 defense-in-depth) — but is never reached in this plan because `seedStrategyWithHistory` throws before connecting. |
| T-14a-05-02 (Type-scale grep bypassed via Unicode tricks) | accept | Future-developer concern; UI-SPEC §6 lists allowed classes; PR review catches obvious bypass attempts. |

No new threat-model surface introduced.

## Threat Flags

None — these are test-only files. No new network endpoints, auth paths, file-access patterns, or schema changes at trust boundaries. The test fixture and Playwright spec consume existing safe surface (the v2 page route + strategy_analytics test data via the existing seed helper pattern).

## Self-Check: PASSED

Verified end-state:

- ✓ FOUND: tests/a11y/chart-contrast.test.ts
- ✓ FOUND: tests/visual/strategy-v2-type-scale.test.ts
- ✓ FOUND: tests/visual/strategy-v2-panel-count.test.tsx
- ✓ FOUND: e2e/strategy-v2-partial-data.spec.ts
- ✓ FOUND: vitest.config.ts (modified — extended include glob)
- ✓ FOUND: src/test-setup.ts (modified — IntersectionObserverStub added)
- ✓ FOUND: eee893b (Task 1 commit on main)
- ✓ FOUND: 4d34473 (Task 2 commit on main)
- ✓ FOUND: 67b4e46 (Task 3 commit on main)
- ✓ FOUND: 86d4bfd (Task 4 commit on main)
- ✓ Branch is `main` (verified via `git branch --show-current` after each commit; no checkout/pull/rebase ops performed)
- ✓ `npx tsc --noEmit` exit 0 after every commit
- ✓ `npm run build` exit 0 (final, 73/73 pages generated)
- ✓ `npm test -- tests/ --run` exit 0, 7/7 tests pass
- ✓ `npx playwright test --list e2e/strategy-v2-partial-data.spec.ts` lists 4 tests
- ✓ Regression: `npm test -- src/lib/strategy-ui-v2-flag.test.ts --run` 10/10 pass after vitest config change
- ✓ No stub patterns introduced beyond the documented `seedStrategyWithHistory` placeholder (gated behind env-var skip; explicit deferred-to-14b decision recorded)
- ✓ No accidental file deletions in any commit (`git diff --diff-filter=D --name-only HEAD~1 HEAD` empty for all 4)
