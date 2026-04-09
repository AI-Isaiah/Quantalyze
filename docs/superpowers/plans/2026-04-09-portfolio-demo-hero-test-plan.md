# Test Plan: Portfolio Management Demo Hero

**Parent plan:** `2026-04-09-portfolio-management-demo-hero.md`
**Date:** 2026-04-09
**Status:** Generated from autoplan Phase 3 (Eng Review), pending implementation

This artifact lives beside the plan so reviewers can see the complete test strategy in one place. Every test listed here is on the CI gate unless marked otherwise.

---

## Test strategy summary

- **Unit tests (Vitest + jsdom):** pure derivation lib functions, adapter contract tests, component render tests with mocked analytics props.
- **Integration tests (Vitest):** `src/lib/portfolio-analytics-adapter.ts` against captured fixture JSONB blobs.
- **E2E tests (Playwright, Chromium):** public `/demo`, `/demo/founder-view`, authenticated `/portfolios/[id]`, seed integrity.
- **Screenshot regression (Playwright):** `/demo` above-the-fold at 320 / 375 / 768 / 1280px — diffs against a baseline committed to `e2e/screenshots/baseline/`.
- **Nightly cron (separate CI workflow):** PDF cold-start probe, analytics service /health probe.

**CI gate philosophy (responding to Codex eng finding H-Codex-6 + Claude M4):** every test in the "CI gate" column must run WITHOUT a seeded database. Tests requiring seeded state run locally or on nightly cron.

---

## Seed data dependencies

All demo-critical tests depend on these fixed UUIDs from `scripts/seed-demo-data.ts`:

| Constant | UUID | Used by |
|----------|------|---------|
| `ALLOCATOR_COLD` | `aaaaaaaa-0001-4000-8000-000000000001` | persona seed tests |
| `ALLOCATOR_ACTIVE` | `aaaaaaaa-0001-4000-8000-000000000002` | `/demo` primary path |
| `ALLOCATOR_STALLED` | `aaaaaaaa-0001-4000-8000-000000000003` | persona seed tests |
| `ACTIVE_PORTFOLIO_ID` | `dddddddd-0001-4000-8000-000000000001` | PDF endpoint allowlist |
| `STRATEGY_UUIDS[0..7]` | `cccccccc-0001-4000-8000-000000000001` … `008` | winner/loser fixtures |

**Drift policy:** If the seed script changes these UUIDs, `src/__tests__/seed-integrity.test.ts` fails first and the CI log tells the committer to update both the seed file and this test-plan document. No silent drift.

---

## Unit test inventory (Vitest)

Target: ≥90% branch coverage on new lib files; 100% on adapter.

### New files (one test file each)

```
src/lib/portfolio-health.test.ts        — 8 cases
src/lib/portfolio-insights.test.ts      — 10 cases (4 rules × 2 branches + 2 edge)
src/lib/winners-losers.test.ts          — 6 cases
src/lib/regime-change.test.ts           — 7 cases
src/lib/portfolio-analytics-adapter.test.ts  — 12 cases (see below)
src/lib/personas.test.ts                — 5 cases (valid + 4 hostile inputs)
src/lib/warmup-analytics.test.ts        — 4 cases
src/lib/demo-recommendations.test.ts    — 4 cases (batch[0] + batch[1] fallback)
```

### Adapter contract test cases (fixture-based)

Fixtures live in `src/__tests__/fixtures/portfolio-analytics/`:
- `complete.json` — all JSONB fields populated (realistic shape from staging dump)
- `partial-null-benchmark.json` — `benchmark_comparison: null`
- `empty-rolling-corr.json` — `rolling_correlation: {}` (fewer than 2 strategies)
- `all-null.json` — every field null except required keys
- `malformed-rolling-corr.json` — wrong shape (`{date,value}[]` instead of `Record`)
- `computed-status-failed.json` — `computation_status: "failed"` + old data
- `narrative-only.json` — only `narrative_summary` populated

Each adapter test asserts:
- Successful shape with correct types (TypeScript narrowing works)
- Partial shapes don't throw
- Malformed shapes produce AdapterError (logged at warn, not throw in production path)

### Component render tests (Testing Library)

```
src/components/portfolio/EditorialHero.test.tsx              — 4 cases
src/components/portfolio/MorningBriefing.test.tsx            — 4 cases
src/components/portfolio/WinnersLosersStrip.test.tsx         — 5 cases
src/components/portfolio/InsightStrip.test.tsx               — 6 cases
src/components/portfolio/WhatWedDoCard.test.tsx              — 4 cases
src/components/portfolio/NextFiveMillionCard.test.tsx        — 4 cases
src/components/portfolio/CounterfactualStrip.test.tsx        — 3 cases
src/components/ui/CardShell.test.tsx                         — 4 cases (all states)
```

Each component test renders with a mocked analytics prop (from fixture) and asserts:
- Happy path renders correct text
- Empty state is handled per spec (FIX 2.2 state table)
- Stale badge shows when `analytics.computation_status !== 'complete'`
- No console errors

### Updated tests
- `src/__tests__/analytics-format.test.ts` — may need updates after the `rolling_correlation` type fix in PR 0. Audit before merging.

---

## E2E test inventory (Playwright, Chromium)

### New files

**`e2e/demo-public.spec.ts`** — CI gate
- ✅ Status 200 on `/demo`
- ✅ Editorial hero text present ("Beat BTC" or equivalent)
- ✅ Product descriptor present
- ✅ Portfolio numbers rendered (not "—")
- ✅ "Download IC Report" button present and clickable (does NOT block on PDF generation, just asserts click)
- ✅ No console errors (filter out known Next 16 hydration warnings per `smoke.spec.ts` convention)
- ✅ Responsive at 320×568 (iPhone 5): hero fits, no horizontal scroll
- ✅ Responsive at 375×667 (iPhone SE): hero fits above fold
- ✅ Responsive at 1280×800: full evidence panel visible
- ✅ Persona query param: `?persona=cold`, `?persona=stalled`, `?persona=active` each render without error
- ✅ Hostile persona param: `?persona=<script>` defaults to active silently

**`e2e/demo-founder-view.spec.ts`** — CI gate
- ✅ Status 200 on `/demo/founder-view`
- ✅ Read-only banner present
- ✅ `AllocatorMatchQueue` renders
- ✅ Keyboard shortcuts NOT fire (try pressing `j`/`k`/`d`/`s`/`r`/`↵` and assert no state change)

**`e2e/portfolio-dashboard.spec.ts`** — local only (requires auth seed)
- Login → `/portfolios/{ACTIVE_PORTFOLIO_ID}`
- Assert all 7 wired chart components mount
- Strategy breakdown table has rows
- Optimizer card loads (no hang)
- Stale fallback: mock analytics with `computation_status: failed` and assert stale badge appears
- No console errors

**`e2e/portfolio-pdf-demo.spec.ts`** — CI gate (does NOT require auth)
- POST to `/api/demo/portfolio-pdf/{ACTIVE_PORTFOLIO_ID}` with valid signed token
- Assert 200 + `Content-Type: application/pdf`
- Assert PDF size > 1KB
- Assert timing < 25s (generous — covers cold start)
- Then with invalid token → 401
- Then with non-allowlisted ID → 404
- Then with 15 rapid requests → 429 on some

**`e2e/portfolio-pdf-authenticated.spec.ts`** — local only
- Login → GET `/api/portfolio-pdf/{ACTIVE_PORTFOLIO_ID}`
- Assert 200 + `Content-Type: application/pdf`
- Without login → 401

### Screenshot regression (Playwright)

**`e2e/demo-screenshot.spec.ts`** — CI gate
- Navigate to `/demo` at 320/375/768/1280
- Take screenshots
- Diff against `e2e/screenshots/baseline/demo-{width}.png`
- Threshold: 2% pixel difference (Playwright default `toHaveScreenshot` with `maxDiffPixelRatio: 0.02`)
- **Baseline refresh protocol:** If a PR intentionally changes the /demo layout, run `npx playwright test --update-snapshots` locally and commit the updated baselines. PR description must note the intentional change.
- **Baseline location:** `e2e/screenshots/baseline/` (committed to git)
- **CI failure artifact:** diff images uploaded via existing `actions/upload-artifact@v4` (already in `.github/workflows/ci.yml:92-98`)

### Seed integrity

**`src/__tests__/seed-integrity.test.ts`** — CI gate
- Mocks Supabase client (no real DB hit)
- Imports `STRATEGY_PROFILES` from `scripts/seed-demo-data.ts`
- Asserts: 3 allocators (cold/active/stalled), 8 strategies, 1 portfolio, 3 memberships
- Asserts: strategy UUIDs match the fixed constants
- Asserts: `generatePortfolioAnalyticsJSONB` (new in PR 11) produces deterministic output for the same seed

---

## Nightly cron tests (separate workflow)

A new `.github/workflows/nightly.yml` (added in PR 14) runs:

**`e2e/pdf-coldstart.spec.ts`** — nightly only
- Starts a fresh Next.js server (simulates cold start)
- First request to `/api/demo/portfolio-pdf/{ACTIVE_PORTFOLIO_ID}` with valid token
- Asserts < 30s (cold start budget)
- Asserts no 504 on warm path (second request)

**`e2e/analytics-health-probe.spec.ts`** — nightly only (only if `ANALYTICS_URL` env set)
- GET `${ANALYTICS_URL}/health`
- Asserts 200
- Alerts via Slack on failure (webhook URL in env)

---

## CI workflow updates (PR 13)

`.github/workflows/ci.yml` line 83 changes from:
```yaml
npx playwright test e2e/auth.spec.ts e2e/smoke.spec.ts
```
to:
```yaml
npx playwright test \
  e2e/auth.spec.ts \
  e2e/smoke.spec.ts \
  e2e/demo-public.spec.ts \
  e2e/demo-founder-view.spec.ts \
  e2e/portfolio-pdf-demo.spec.ts \
  e2e/demo-screenshot.spec.ts
```

The nightly cron workflow is NEW in PR 14.

---

## Test data provenance

Every test that loads analytics data must declare its source:
- **Fixture JSONB:** committed to `src/__tests__/fixtures/portfolio-analytics/`. Source: captured from staging Supabase on 2026-04-09, sanitized.
- **Seed-generated:** mulberry32 deterministic output, same PRNG as `scripts/seed-demo-data.ts`.
- **Mocked:** explicit `vi.mock(...)` with inline shape. Never use `any`.

---

## Verification commands (manual dogfood)

Before each PR merges, the author runs:
```bash
# Local — assumes seeded dev Supabase
npm run typecheck
npm run lint
npm test
npm run test:e2e
npx playwright test e2e/demo-screenshot.spec.ts --update-snapshots   # only if layout changed
```

Before the friend meeting day:
```bash
# Staging smoke
curl -sf https://staging.quantalyze.com/demo | grep -o "editorial hero text" || echo "FAIL"
curl -sf https://staging.quantalyze.com/demo?persona=cold | grep -o "editorial hero text" || echo "FAIL"
curl -sf https://staging.quantalyze.com/demo/founder-view > /dev/null && echo "OK" || echo "FAIL"
# PDF cold-start probe
time curl -sf "https://staging.quantalyze.com/api/demo/portfolio-pdf/{ACTIVE_PORTFOLIO_ID}?token={valid}" -o /tmp/demo.pdf && ls -lh /tmp/demo.pdf
```

---

## Risk-to-test mapping

For each eng finding in Phase 3, which test catches it:

| Eng Finding | Test that catches regression |
|-------------|-----------------------------|
| C1 wrong `rolling_correlation` type | `portfolio-analytics-adapter.test.ts` (malformed case) |
| C2 missing ResizeObserver | Every component render test that imports a chart |
| C3 two-batch fallback dropped | `demo-recommendations.test.ts` (batch[1] case) |
| C-Codex-1 IC PDF CTA auth-gated | `portfolio-pdf-demo.spec.ts` (asserts public access) |
| C-Codex-2 JSONB contract wrong | Adapter fixture tests (all 7 fixtures) |
| H1 test plan missing | This document |
| H2 existing tests need updates | `analytics-format.test.ts` audit (manual, pre-PR-0) |
| H-Codex-3 stale fallback not implemented | `portfolio-dashboard.spec.ts` (stale fallback case) |
| H-Codex-4 persona is user input | `personas.test.ts` (5 hostile inputs) |
| H-Codex-5 seed missing analytics | `seed-integrity.test.ts` |
| H-Codex-6 CI doesn't run demo specs | CI workflow grep verification |
| H5 persona validation | `personas.test.ts` |
| H6 5th fetch sequential | Code review of PR 9 (no specific test) |
| M1 CardShell prop type | `CardShell.test.tsx` |
| M2 bundle bloat | PR description bundle-size note (no automated gate yet) |
| M3 partial JSONB coverage | Adapter fixture tests |
| M4 seed integrity | `seed-integrity.test.ts` |
| M5 admin client boundary | Code review (file-top comment) |
| M6 MorningBriefing duplicate | TypeScript import check (shared component) |
| M-Codex-7 CardShell contradiction | DESIGN.md rule + `CardShell.test.tsx` |
| M-Codex-8 warmup operationally weak | `warmup-analytics.test.ts` + Vercel cron config |

Every finding has a test or explicit code review gate. Zero silent failures.

---

## Maintenance notes

- This document is a living artifact. Update it when:
  - A new test file is added/removed
  - Seed UUIDs change
  - CI grep pattern changes
  - A new fixture is captured
- **Owner:** the author of PR 0 (type adapter + test setup) is the initial maintainer. Ownership rolls forward with whoever touches the largest number of test files per sprint.
