---
phase: 237-factsheethonest-every-surface-shows-a-strategy-s-true-state
plan: 05
subsystem: api
tags: [og-card, share-card, held-rerun, cache-ladder, fact-02, cache-01]
requires:
  - phase: 237-factsheethonest
    provides: analyticsHold, HELD_RERUN_CACHE_CONTROL (plan 01); the OG cache ladder, figuresRendered and FAILURE_CACHE_CONTROL (plan 02)
provides:
  - the share card holding a pending or computing re-run's last figures with ANALYTICS_UPDATING_LINE
  - the held branch of the OG cache ladder (public, max-age=60, s-maxage=60, no stale-while-revalidate)
  - computeOgHeadline(rows, assetClass, persisted, recomputeOverStoredResult = false)
  - OG_CARD_VERSION "3"
affects: [237-13]
tech-stack:
  added: []
  patterns: ["hold flag feeds only isStoredResultReadable, never a gate's verdict", "flags read through effectiveDataQualityFlags, never the raw blob"]
key-files:
  created: []
  modified:
    - src/app/api/og/factsheet/[id]/route.tsx
    - src/lib/factsheet/og-metrics.ts
    - src/lib/factsheet/og-metrics.test.ts
    - src/app/api/og/factsheet/[id]/route.stored-parity.test.tsx
    - src/app/api/og/factsheet/[id]/route.cache-ttl.test.tsx
    - src/app/api/og/factsheet/[id]/route.test.tsx
key-decisions:
  - "SHORT_CACHE_CONTROL is a local alias of HELD_RERUN_CACHE_CONTROL in route.tsx: one literal source, and the OG cache constants stay defined in the route (rulings 1 and 3)"
  - "route.stale-analytics.test.tsx needed no edit: O3's computing fixture carries no cumulative_return and no success marker, so it holds no stored evidence and still prints three dashes"
requirements-completed: [FACT-02, CACHE-01]
status: complete
commits: 2
plan_head_before: 73d18d712b56f0d60f79e11db00df31cf6f19856
plan_head_after: aa304179dfca39bed24327d1fca798f6bcee1316
actuals:
  tokens: 14000
  tasks: 3
  commits: 2
---

# Phase 237 Plan 05: The share card holds a re-run Summary

**`/api/og/factsheet/[id]` now keeps a pending or computing re-run's last computed Sharpe, CAGR and Max DD on the card with the quiet Updating line, sends that held card for 60 s with no stale-while-revalidate, applies the factsheet's own refusals, and carries `OG_CARD_VERSION` "3".**

Agent branch: `worktree-agent-abf25c6f3e70937d7`. Re-based to `73d18d712b56f0d60f79e11db00df31cf6f19856` before any work (`git rev-parse HEAD` verified). Final code HEAD is `plan_head_after` above, plus this SUMMARY's own commit.

## Accomplishments

- **Admission** (`route.tsx`): the figure branch admits on `analyticsHold(analytics).admitted` instead of `isComputedAnalytics`. The hold is declared beside the NaN sentinels (not admitted, not updating) so a throw or a null row cannot render the line. `computed_at` joins the embed type and the select.
- **Updating line** (`route.tsx`): `ANALYTICS_UPDATING_LINE`, never inlined, after the figureNote div when `hold.updating && figuresRendered`; `fontSize 20`, `color #64748B`, `marginTop` 8 after a figureNote and 24 otherwise.
- **Cache ladder** (`route.tsx`): `failed || notFound || !figuresRendered` -> `FAILURE_CACHE_CONTROL`; `hold.updating` -> `SHORT_CACHE_CONTROL`; otherwise `LONG_CACHE_CONTROL`. `SHORT_CACHE_CONTROL` is a local alias of `HELD_RERUN_CACHE_CONTROL`, defined beside the other two constants with a docblock citing rulings 1 and 3.
- **Inner gates** (`og-metrics.ts`): `computeOgHeadline`'s fourth parameter `recomputeOverStoredResult` (default false) feeds `isStoredResultReadable(status, flag)` for the stored pick and `storedCashHeadlineGate`'s fourth argument. `isRankableAnalyticsRow` import removed (it was equivalent to `isComputedAnalytics`, which `isStoredResultReadable(status, false)` reduces to). The headline verdict and E2 are untouched by the flag, so the hold changes WHETHER the stored result is read, never which figures a gate shows (G1).
- **Effective flags** (`route.tsx`, `og-metrics.ts`): unit, curve method, the headline verdict and E2's `twr_chain_broken` / `insufficient_window` all read `effectiveDataQualityFlags(...).flags`. `OgPersistedScalars` gained `computed_at`.
- **`OG_CARD_VERSION` is "3"** with a dated docblock line. Its two consumers (`page.tsx` and the cache-key and figure-gate tests) import the constant; no literal needed chasing.

## Task Commits

1. Task 1 (tracer): `123e93ad9` feat(237-05): the share card holds a re-run's last figures with the Updating line under a 60 s cache
2. Tasks 2 and 3: `aa304179d` fix(237-05): the card reads unit, curve and headline verdict from the effective flags; OG_CARD_VERSION 3. Task 3 changed no tracked file (the backstop measurement is scratch only), so it has no commit of its own.

Tracer gate: Task 1's `<verify>` (parity, cache-ttl, og-metrics) re-run green before Task 2 expanded.

## Behaviour change for the ship notes (D-04)

A **terminal-success** row (`complete` or `complete_with_warnings`) whose live flags carry the `last_success_snapshot` key with no snapshot bound to its `computed_at` (an unbound derive prestamp) now prints **three dashes and goes no-store** on the card, matching the factsheet's own refusal. Before this plan the card drew that row's stored figures under the long cache. It is pinned by `D-04 behaviour change` in route.stored-parity. A row at rest, a legacy row with no snapshot key, and a row whose live flags carry `cumulative_method` are unchanged. A composite during a re-run also now goes no-store with dashes (it was dashes under the old ladder too, so only the header matches the factsheet's queued state).

## Existing tests

- `route.stale-analytics.test.tsx`: **no edit.** O3 (`computing`) seeds only `daily_returns`, `returns_series` and `computation_status`: no `cumulative_return`, no success marker, so `hasStoredAnalyticsResult` is false, the row is neither updating nor admitted, and it keeps printing three dashes. It is the "no stored result" control the plan asked for.
- `route.test.tsx` O4 gained `expect(select).toContain("computed_at")`.
- The parity harness `renderOgCard` gained an `analyticsOverride` argument and now also returns the card's strings and the response's `Cache-Control`. `ogStat` matches a unit card's `CAGR in BTC` label by prefix.
- Held fixtures use `cumulative_method: "geometric"` (a value `curveMethodFromFlags` recognises, so no console warning).

## PROOF-01 (RED then GREEN, verbatim)

Backups were byte copies kept in the scratchpad outside the repo; every restore was proven with `cmp` (exit 0) before the GREEN run.

**Pre-change route and og-metrics, new tests added first. RED:**

```
       × true: a computing row's STORED Sharpe, CAGR and Max DD print 12ms
       × true over a Dated computing row: stored Sharpe and Max DD print, CAGR is withheld (E2) 2ms
     × C6 - held re-run (FACT-02 / CACHE-01): the held card is short-cached, served at +30 s, and the first request after +61 s is the terminal card under the long cache 12ms
     × a pending row over a stored success: the card equals the strip, the Updating line renders and the cache is the 60 s one 661ms
     × a computing row over a stored success: the card equals the strip, the Updating line renders and the cache is the 60 s one 612ms
     × the Updating line is #64748B at 20px; marginTop 24 alone, 8 after a figureNote, and after it in order 7ms
     × held over a Dated row prints the strip's own Dated figures (G1: the hold changes WHETHER the result is read, never which figures print) 1227ms
AssertionError: expected [ …(11) ] to include '1.87'
AssertionError: expected '—' to be '0.12' // Object.is equality
AssertionError: expected [ …(11) ] to include 'Updating with the latest data. These …'
AssertionError: expected 6.368324391514288 to be 1.5 // Object.is equality
AssertionError: expected NaN to be 1.5 // Object.is equality
 Test Files  3 failed (3)
      Tests  7 failed | 65 passed (72)
```

After the Task 1 edits: `Test Files  8 passed (8)`, `Tests  121 passed (121)`.

**Neuter A: `recomputeOverStoredResult` dropped from `storedCashHeadlineGate` in og-metrics.ts. RED:**

```
       × true over a Dated computing row: stored Sharpe and Max DD print, CAGR is withheld (E2) 18ms
     × held over a Dated row prints the strip's own Dated figures (G1: the hold changes WHETHER the result is read, never which figures print) 484ms
AssertionError: expected '—' to be '0.12' // Object.is equality
AssertionError: expected NaN to be 1.5 // Object.is equality
 Test Files  2 failed (2)
      Tests  2 failed | 63 passed (65)
```

Restored (`cmp exit 0`).

**Neuter B: the held branch sends `LONG_CACHE_CONTROL` in route.tsx. RED:**

```
     × C6 - held re-run (FACT-02 / CACHE-01): the held card is short-cached, served at +30 s, and the first request after +61 s is the terminal card under the long cache 11ms
     × a pending row over a stored success: the card equals the strip, the Updating line renders and the cache is the 60 s one 458ms
     × a computing row over a stored success: the card equals the strip, the Updating line renders and the cache is the 60 s one 400ms
AssertionError: expected 'public, max-age=3600, s-maxage=86400,…' to be 'public, max-age=60, s-maxage=60'
 Test Files  2 failed (2)
      Tests  3 failed | 32 passed (35)
```

Restored (`cmp exit 0`), then `Test Files  8 passed (8)`, `Tests  121 passed (121)`.

Note: C6 fails at its FIRST header assertion (the held card's own header), so the t0+61 s arm is exercised only on the correct code. The double's mechanics are proven non-vacuous by C3 (long card served from the store at +30 s, refetched past s-maxage) and by C6 itself on the GREEN run, where the held card is served from the store at +30 s and refetched at +61 s.

**Effective flags, before the Task 2 edit (the new tests added first). RED:**

```
     × a computing row inside the derive prestamp window reads the last success's unit from its BOUND snapshot (Returns in BTC) 18ms
     × a held row inside the prestamp window reads the headline verdict from the effective flags: a snapshot Dated row prints its stored Sharpe 5ms
AssertionError: expected [ …(14) ] to include 'Quantalyze · Institutional Factsheet …'
AssertionError: expected '+0.7%' to be '—' // Object.is equality
 Test Files  1 failed (1)
      Tests  2 failed | 32 passed (34)
```

**Neuter C: route.tsx reads `native_unit` from the live `data_quality_flags` again. RED:**

```
     × a computing row inside the derive prestamp window reads the last success's unit from its BOUND snapshot (Returns in BTC) 16ms
AssertionError: expected [ …(14) ] to include 'Quantalyze · Institutional Factsheet …'
 Test Files  1 failed (1)
      Tests  1 failed | 33 passed (34)
```

Restored (`cmp exit 0`).

**Neuter D: og-metrics.ts reads the verdict and E2 from the live `persisted?.data_quality_flags` again. RED:**

```
     × a held row inside the prestamp window reads the headline verdict from the effective flags: a snapshot Dated row prints its stored Sharpe 46ms
AssertionError: expected '+0.7%' to be '—' // Object.is equality
 Test Files  1 failed (1)
      Tests  1 failed | 33 passed (34)
```

Restored (`cmp exit 0`).

**GREEN after Task 2, final targeted run:**

```
npx vitest run 'src/app/api/og/factsheet/[id]' src/lib/factsheet/og-metrics.test.ts 'src/app/factsheet/[id]/v2/page.public-cache-key.test.tsx' src/lib/analytics-hold.test.ts --maxWorkers=3
 Test Files  10 passed (10)
      Tests  172 passed (172)
```

## Worst-case card render backstop (Task 3, measured: fits)

Rendered with the REAL `next/og` `ImageResponse` through the real `GET`, from a throwaway vitest config and test kept in the scratchpad OUTSIDE the worktree (mocked Supabase read only; nothing tracked). Worst-case row: a two-line name ("Helios Quantitative Momentum Trend Fund"), a 140-unit description, a 200-day record (so the marker figureNote renders), a BTC unit and a computing status over stored evidence (so the Updating line renders).

Result: **measured: fits.** The PNG is 1200 x 630. The footer row (`quantalyze.xyz` and `verified`) sits fully inside the frame, and neither the figureNote nor the Updating line is truncated. No change to `marginTop 48` was needed, so the permitted 48 -> 32 adjustment was NOT applied.

Image: `og-render-237-05/worst-case.png` in the executing session's scratchpad (outside the repo, not tracked, may be cleared; re-render with a mocked read and the real `ImageResponse` to reproduce).

Two observations for the verifier, neither fixed (out of scope):
- Clearance is tight: the Updating line sits about 10 px above the `quantalyze.xyz` footer text. It does not overlap in the two-line case.
- A name that wraps to THREE lines overlaps the description (and then the footer). That is pre-existing (`lineHeight: 1` on an 80 px name, no cap) and unrelated to this plan; it was seen while sizing the fixture. The fonts are next/og's fallback faces, the same ones production uses, since the route loads none.

## Final gates

- `npm run typecheck`: exit 0.
- `npm run lint`: exit 0; 0 errors, 4 warnings, all in files this plan did not touch (`MetricsColumn.tsx`, `composite-read-path.ts`, `queries.stale-analytics-detail.test.ts`). Admin manifest, route contract, planning hygiene and canonical domain checks all OK.
- Acceptance greps: `analyticsHold(` in route 1; `ANALYTICS_UPDATING_LINE` in route 2; `SHORT_CACHE_CONTROL` in route 3; `isStoredResultReadable(` in og-metrics 1; `effectiveDataQualityFlags(` route 1 and og-metrics 2; `OG_CARD_VERSION = "3"` on 1 code line.
- `git status --porcelain` clean after the final commit; no scratch file tracked. No migration, no analytics-service change, no undeclared file touched.

## Deviations from Plan

None. The plan executed as written. The "no AI attribution" repo rule took precedence over the harness's attribution trailer reminder, so no trailers are on the commits. The vitest run for Task 3's render used a config in the scratchpad with `server.fs.strict: false` so the throwaway test could live outside the worktree.

## Known Stubs

None.

## Threat Flags

None. T-237-08 (held card at the CDN) is mitigated by the 60 s header with no stale-while-revalidate and proven by C6; T-237-09 (un-withholding) by the held-over-Dated and held-over-Withheld parity cases plus neuter A. `computed_at` joins a published-only read and is never printed (the response is a PNG).

## Self-Check: PASSED

- All six modified files exist; `git status` clean.
- Commits `123e93ad9` and `aa304179d` are ancestors of HEAD.
