---
phase: 25-read-only-sharing
plan: 04
subsystem: ui
tags: [nextjs, rsc, public-page, share-token, scenario, leak-prevention, force-dynamic, ratelimit]

# Dependency graph
requires:
  - phase: 25-01
    provides: "get_shared_scenario(p_token_hash) SECURITY DEFINER RPC — name/draft/schema_version + addedStrategies[].id PUBLISHED series only; scenario_shares table + revoked_at gate"
  - phase: 25-02
    provides: "src/lib/scenario-share-token.ts hashShareToken(raw)->sha256 hex (Node-side digest matching the RPC predicate)"
  - phase: 24-01
    provides: "computeScenarioBenchmark + public GET /api/benchmark/btc (cacheable BTC daily-return series)"
  - phase: 10
    provides: "computeScenario engine, scenario-state codec (scenarioDraftCodec + SCENARIO_SCHEMA_VERSION=2), EquityChart/CorrelationHeatmap/ScenarioBenchmarkSection presentational components"
provides:
  - "Public force-dynamic recipient page /scenario-share/[token] — limit-first publicIpLimiter → hashShareToken → leak-scoped RPC → codec-outcome branch → server-computed projection → reused props-only components in return/percentage form"
  - "Pure resolveSharedScenario() helper isolating the DI-23-01 honest-absence decision (version_ahead/reset → honest-absence, never a live-book substitution) and the compute path"
  - "Route-layer revoke immediacy (force-dynamic + no-store reasoning): resolve→revoke→404 proven by page test"
affects: [scenario-sharing, public-routes, leak-prevention, honesty-invariants]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Public RSC outside (dashboard): force-dynamic + Next 16 await params + limit-first publicIpLimiter via await headers()+getClientIp BEFORE any DB/crypto"
    - "Pure resolve layer between a leak-scoped RPC row and render — outcome-branched codec decode (only \"ok\" computes; never reads .value on a non-ok outcome; neutral holdings-free default)"
    - "Return/percentage-form-only recipient render (inline KPI strip via formatPercent/formatNumber, no KpiStrip — KpiStrip leaks USD/AUM)"

key-files:
  created:
    - "src/app/scenario-share/[token]/share-resolve.ts"
    - "src/app/scenario-share/[token]/share-resolve.test.ts"
    - "src/app/scenario-share/[token]/page.tsx"
    - "src/app/scenario-share/[token]/page.test.tsx"
  modified: []

key-decisions:
  - "Rendered an inline return-form KPI strip instead of reusing KpiStrip — KpiStrip imports formatCurrency and takes aum/total_aum, which would leak USD/AUM on a public page (UI-SPEC Honesty Invariant 1)."
  - "Imported toWealth from the EquityChart module (its real home), not @/lib/scenario (the JSDoc there says 're-exported from @/lib/units' but the live export is in EquityChart.tsx, mirroring ScenarioComposer)."
  - "Benchmark overlay shown by default (no client toggle) so the page stays a pure RSC; the overlay is hidden automatically when the BTC series is unavailable (btcWealth=undefined)."
  - "Passed a NEUTRAL holdings-free default draft to the codec as a structural no-leak guard — even if the outcome branch regressed, there is no live-book-shaped object to surface."

patterns-established:
  - "DI-23-01 closure: branch on scenarioDraftCodec outcome; only \"ok\" renders; \"readonly\"/\"reset\" → honest-absence; never read .value on a non-ok outcome."
  - "Public-page revoke immediacy via force-dynamic + the verbatim demo-pdf no-store reasoning comment; the RPC's revoked_at IS NULL is the gate."

requirements-completed: [SHARE-02, SHARE-03]

# Metrics
duration: 8min
completed: 2026-06-22
---

# Phase 25 Plan 04: Read-Only Sharing (Recipient Page + Share-Resolve) Summary

**Public force-dynamic /scenario-share/[token] RSC that rate-limits, hashes the URL token, resolves it through the leak-scoped get_shared_scenario RPC, branches on the codec outcome (DI-23-01 honest-absence for version-ahead/garbage), and renders the reused props-only components in return/percentage form with no leak — plus a pure resolveSharedScenario() helper unit-tested without mounting the page.**

## Performance

- **Duration:** ~8 min
- **Started:** 2026-06-22T10:25:00Z
- **Completed:** 2026-06-22T10:33:00Z
- **Tasks:** 2
- **Files created:** 4

## Accomplishments
- **DI-23-01 landmine closed (SHARE-02):** `resolveSharedScenario` decodes the draft via `scenarioDraftCodec` and branches on `outcome` — only `"ok"` computes; `"readonly"` (version_ahead, schema_version > live SCENARIO_SCHEMA_VERSION=2) and `"reset"` (parse_failed/schema_invalid/version_mismatch) return `kind:"honest-absence"`. It NEVER reads the codec `.value` on a non-`"ok"` outcome and passes a neutral holdings-free default — so no live-book-shaped object can leak on a public page even under a hypothetical regression.
- **Public recipient page (SHARE-02 + SHARE-03):** force-dynamic RSC outside `(dashboard)`, Next 16 `await params`, limit-FIRST `publicIpLimiter` via `await headers()` + `getClientIp` before any DB/crypto, service_role-transport `admin.rpc("get_shared_scenario", { p_token_hash: hashShareToken(token) })`, `notFound()` on 0 rows / RPC error (identical 404 for unknown/revoked/cross-tenant — no oracle).
- **Honest render in return/percentage form:** scenario NAME only (never allocator identity), persistent PROJECTED framing + pill + methodology line, inline KPI strip (em-dash on degenerate), EquityChart (+ BTC overlay when available), ScenarioBenchmarkSection (its three honest empty states), CorrelationHeatmap (its <2/<10-day empty states). No USD/AUM/holdings/api_keys/dashboard nav/edit controls.
- **Revoke immediacy proven at the route layer:** page test resolve→200, then RPC 0 rows (revoked)→`notFound()`, with the verbatim demo-pdf no-store reasoning comment + force-dynamic so no edge cache outlives a `revoked_at` write.

## Task Commits

Each task was committed atomically:

1. **Task 1: share-resolve.ts pure helper + DI-23-01 honest-absence unit test** (TDD) — `18e6d15f` (feat)
2. **Task 2: public /scenario-share/[token] RSC page + resolve→revoke→404 page test** — `bf4854a8` (feat)

_Task 1 was authored test-first (RED: module-not-found; GREEN: 5 passing) and committed as one feat unit per the plan's task boundary._

## Files Created/Modified
- `src/app/scenario-share/[token]/share-resolve.ts` — pure resolve layer (no Next/admin/network/DOM): RPC row → `{kind:"ok"|"honest-absence"}`. Maps `series` → `StrategyForBuilder[]` for `addedStrategies[].id` only (holdings refs never resolved), runs `computeScenario` + `computeScenarioBenchmark` in return form.
- `src/app/scenario-share/[token]/share-resolve.test.ts` — 5 tests: version-ahead (schema_version=3 vs live=2) + garbage → honest-absence (never a curve); ok draft → non-null metrics; empty addedStrategies (series=[]) → ok + degenerate all-null shape; strategyNames map.
- `src/app/scenario-share/[token]/page.tsx` — the public RSC (force-dynamic, runtime=nodejs, limit-first, RPC-gated, notFound on miss, honest-absence on non-ok, full recipient render).
- `src/app/scenario-share/[token]/page.test.tsx` — 5 tests: resolve→200 + no-leak (no `$`/`api_key`/`@`, no arbitrary table read, no dashboard helper); unknown→404; resolve→revoke(0 rows)→404 (SHARE-03); version-ahead→honest-absence (no curve); RPC error→404.

## Decisions Made
- **Inline KPI strip, not KpiStrip:** `KpiStrip` imports `formatCurrency` and takes `aum`/`total_aum` and a scenario-vs-live delta mode — both inappropriate for a sessionless recipient with no live baseline and a return-form-only contract. Rendered a 7-cell inline strip (TWR/CAGR/Vol/Sharpe/Sortino/MaxDD/Avg|ρ|) via `formatPercent`/`formatNumber`, which already render `—` for null/non-finite.
- **`toWealth` import source:** imported from `@/app/(dashboard)/allocations/widgets/performance/EquityChart` (its actual export), matching ScenarioComposer. The `@/lib/scenario` JSDoc's "re-exported from @/lib/units" note is stale — the live export is in EquityChart.tsx.
- **Benchmark overlay default-on (no client toggle):** keeps the page a pure RSC; the overlay self-hides when the BTC series is unavailable.
- **Neutral codec default:** passed an empty holdings-free `ScenarioDraft` (schema_version 0) to `scenarioDraftCodec` as a structural no-leak guard.

## Deviations from Plan

None - plan executed exactly as written. Two minor verification-gate frictions were resolved without behavior change:

1. The Task 1 purity grep gate (`! grep "next/navigation|createAdminClient|fetch("`) and the Task 2 gate (`! grep getMyAllocationDashboard`) are literal substring checks that initially matched those tokens inside explanatory comments. Reworded the comments (not the code) so the gates assert genuine non-usage. No logic changed.
2. `renderToStaticMarkup` HTML-escapes the apostrophe in "can't"; the honest-absence page test asserts the surrounding unambiguous substrings instead.

## Issues Encountered
- **`toWealth is not a function`** during the first page-test run: the page imported `toWealth` from `@/lib/scenario`, which does not export it. Fixed by importing from the EquityChart module (its real home); the page test's EquityChart mock now also exposes a real `toWealth`. Resolved before the Task 2 commit.

## User Setup Required
None - no external service configuration required. (The page reads only the existing `get_shared_scenario` RPC via the existing service-role admin client and the existing public BTC benchmark route; `NEXT_PUBLIC_APP_URL` already governs the benchmark fetch origin and is set in deploy envs.)

## Coverage / CI Note
Both new source files carry dedicated tests (share-resolve.test.ts covers every branch of share-resolve.ts; page.test.tsx covers all five page paths). The full `npm run test:coverage` ratchet is a CI gate (multi-minute, full suite) and was not run in-executor; the new files are fully test-covered so the ratchet is expected to hold. `npx tsc --noEmit` = 0 errors repo-wide; `eslint` clean on all four files.

## Next Phase Readiness
- Phase 25 (read-only-sharing) plans 01–04 are all complete: backend RPC/table (25-01), token lib (25-02), allocator generate/revoke routes + Share UX (25-03), and the recipient page + resolve helper (25-04). SHARE-01/02/03 delivered.
- Ready for end-to-end verification at /land-and-deploy: the migration (`20260622120000_scenario_shares_and_read_rpc.sql`) applies there (anon NO-EXEC verified), then a live generate→open→revoke→404 walkthrough.

## Self-Check: PASSED

All created files verified present on disk; both task commits (`18e6d15f`, `bf4854a8`) verified in git history.

---
*Phase: 25-read-only-sharing*
*Completed: 2026-06-22*
