---
phase: 12-backend-metric-contracts
plan: 08
subsystem: web
tags: [supabase-rpc, lazy-fetch, single-strategy-v2, type-union, security-definer-consumer]

# Dependency graph
requires:
  - phase: 12-backend-metric-contracts
    provides: "Plan 12-02 shipped migration 087 (strategy_analytics_series sibling table + fetch_strategy_lazy_metrics RPC + upsert_strategy_analytics_series_batch RPC) and locked LazyMetricsPayload + StrategyAnalyticsSeriesKind types in src/lib/types.ts."
provides:
  - "src/lib/queries.ts.fetchStrategyLazyMetrics(strategyId, panelId): Promise<LazyMetricsPayload> — TS-side consumer for the SECURITY DEFINER fetch_strategy_lazy_metrics RPC."
  - "src/lib/queries.ts.LazyMetricsPanelId — exported type union of all 7 panel IDs (overview/equity/drawdown/returns_dist/rolling/trades/exposure) matching the SQL CASE in migration 087."
  - "Four regression tests in src/lib/queries.test.ts asserting RPC name + arg shape (p_strategy_id/p_panel_id), success pass-through, and {} fallback on both error and null-data paths."
affects: [14b-strategy-page-lazy-panels-4-7]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Consumer-side error-as-empty pattern: RPC errors are logged via console.error but never propagated to UI. Returning {} matches the visibility-miss path so a caller cannot distinguish 'private strategy' from 'transient error' (T-12-08-01 mitigation)."
    - "Type-union enforced panel id (LazyMetricsPanelId): TypeScript blocks arbitrary strings at compile time (T-12-08-02); the SQL RPC's `CASE WHEN ... ELSE ARRAY[]::TEXT[]` provides defense in depth for non-typed callers (e.g., raw curl)."
    - "Test mock extension pattern: extended the existing vi.hoisted recorders with rpcCalls + rpcResponse and added a .rpc(name, args) recorder to the createClient mock. Existing disclosure-tier tests untouched and still passing."

key-files:
  created: []
  modified:
    - "src/lib/queries.ts — LazyMetricsPayload import + LazyMetricsPanelId type union + fetchStrategyLazyMetrics consumer (73 insertions, between getStrategyDetail and getUserPortfolios)."
    - "src/lib/queries.test.ts — extended recorders + server mock with .rpc() capture, new describe block with 4 tests (67 insertions)."

key-decisions:
  - "Match the existing test file's mock convention (@/lib/supabase/server alias, vi.hoisted recorders) over the plan's draft snippet that used a relative './supabase/server' path with separate vi.fn mocks. The shared-recorder approach keeps all queries.ts tests in one mock surface and avoids two divergent patterns drifting apart."
  - "Use `data ?? {}` (nullish coalescing) for the success-path fallback rather than `data || {}`. The SECURITY DEFINER RPC returns `jsonb_build_object()` (empty object) on visibility-miss — Postgres never returns the literal `false`/`0`/empty-string for a JSONB column, so `??` is sufficient and avoids accidentally substituting `{}` for a legitimate `false`-y value (defensive: there is none in the contract, but the assertion is cheaper than the audit)."
  - "Document panel→kinds mapping inline in the JSDoc above the LazyMetricsPanelId type. Mirrors the SQL CASE in migration 087:163-176. Locking the comment next to the type (and not just in migration 087) means a contract-drift PR shows up in the same diff as the type change — a reviewer sees the SQL implication immediately."
  - "Add a second test asserting the success-path payload shape (rolling_sortino_3m series). The plan listed only arg-shape and error-fallback tests; payload pass-through is the third axis the consumer is responsible for and a regression there would silently corrupt panels 4–7."
  - "Log error metadata (code + message + strategyId + panelId) via console.error rather than the bare error object. Matches the audit.ts:267-276 pattern already established for RPC consumers — structured fields are easier to filter in production logs."

patterns-established:
  - "Pattern: SECURITY DEFINER RPC consumer in queries.ts. Wraps await supabase.rpc(...) with structured error logging + empty-result fallback that doesn't reveal visibility outcome. Reusable for the next per-panel RPC if Phase 14b's IntersectionObserver paint budget needs further per-kind splitting."
  - "Pattern: type-union panel id with inline panel→kinds JSDoc. The same pattern can be reused if Phase 14b adds more panel types or a 'subscriptions' panel."

requirements-completed: []
requirements-partial: [METRICS-15]

# Metrics
duration: ~5min
completed: 2026-04-28
---

# Phase 12 Plan 08: fetchStrategyLazyMetrics RPC consumer Summary

**Phase 12 ships the TS-side consumer for migration 087's `fetch_strategy_lazy_metrics(strategy_id, panel_id)` RPC. Phase 14b's lazy panels 4–7 now have a typed entry point — `await fetchStrategyLazyMetrics(strategyId, "rolling")` returns the per-panel `{kind: payload}` map gated by SECURITY DEFINER visibility check. METRICS-15 splits across phases: this plan ships the consumer half; the path-extraction half (replacing `select *, strategy_analytics(*)` in `getStrategyDetail`) is Phase 14a's job.**

## Performance

- **Duration:** ~5 min
- **Started:** 2026-04-28T12:45:06Z
- **Completed:** 2026-04-28T12:50:05Z
- **Tasks:** 1 (TDD: RED → GREEN; no REFACTOR needed — implementation matched final shape on first write)
- **Files modified:** 2

## Accomplishments

### TDD RED → GREEN

- **RED commit (498d83a):** added 4 failing tests asserting the consumer's contract before any implementation existed. Tests fail with `TypeError: fetchStrategyLazyMetrics is not a function` — confirming the import path is correct and the failure is on the missing implementation, not a typo. The 5 pre-existing disclosure-tier tests remain green throughout (the mock extension is purely additive).
- **GREEN commit (6e9bad7):** added `LazyMetricsPanelId` type union (7 panels) and `fetchStrategyLazyMetrics(strategyId, panelId): Promise<LazyMetricsPayload>` consumer between `getStrategyDetail` and `getUserPortfolios`. All 9 tests pass; full `npm run build` exits 0.

### Type contract locked

```typescript
export type LazyMetricsPanelId =
  | "overview"
  | "equity"
  | "drawdown"
  | "returns_dist"
  | "rolling"
  | "trades"
  | "exposure";

export async function fetchStrategyLazyMetrics(
  strategyId: string,
  panelId: LazyMetricsPanelId,
): Promise<LazyMetricsPayload>
```

The 7 panel ids match the SQL `CASE` in `supabase/migrations/087_strategy_analytics_series.sql:163-176` exactly. The JSDoc inline-documents the panel→kinds mapping so a reviewer changing one without the other sees the contradiction in the same diff.

### Security posture

- **T-12-08-01 (Information Disclosure — RPC error reveals strategy existence):** mitigated. Consumer logs the error via `console.error` with structured metadata (`{strategyId, panelId, code, message}`) but always returns `{}` to the UI. The empty-object fallback matches the visibility-miss path inside the SECURITY DEFINER RPC, so a caller observing the consumer's output cannot distinguish "private strategy I don't own" from "transient PostgREST error."
- **T-12-08-02 (Tampering — arbitrary panelId string):** mitigated. TypeScript `LazyMetricsPanelId` union blocks unknown strings at compile time; the RPC's `CASE WHEN ... ELSE ARRAY[]::TEXT[]` returns empty for unknown panel ids as defense in depth (covers untyped callers like raw curl).
- **T-12-08-03 (Tampering — TS↔SQL contract drift):** mitigated. JSDoc documents the panel→kinds mapping inline next to the type union; a coordinated change to migration 087's CASE without updating `LazyMetricsPanelId` would show up as a stale comment in code review. The `fetch_strategy_lazy_metrics` Args shape in `database.types.ts:3009-3012` (auto-regenerated from the live schema) is matched by the consumer's call.
- **T-12-08-04 (DoS — caller spams RPC every render):** accepted per plan threat model. Phase 12 ships the consumer; consumer-level memoization (React Query / SWR / useEffect deps) is Phase 14b's responsibility.

### Verification

- `npx vitest run src/lib/queries.test.ts` — 9 tests pass (5 existing disclosure-tier + 4 new lazy-metrics).
- `npm run build` — `✓ Compiled successfully in 5.1s`, TypeScript checks pass, all 73 static pages generated, no errors or warnings.
- Plan automated verify (5 grep checks) — all FOUND.

## Deviations from Plan

### Auto-fixed Adjustments

**1. [Rule 1 — Pattern Alignment] Mock convention swap to match existing tests**
- **Found during:** Step 2 (test scaffolding)
- **Issue:** Plan's draft test snippet used `vi.mock("./supabase/server", ...)` with a fresh `vi.fn()` for `mockRpc`. The existing test file uses `vi.mock("@/lib/supabase/server", ...)` with a `vi.hoisted()` recorder pattern that's shared across describe blocks.
- **Fix:** Extended the existing `recorders` hoisted object with `rpcCalls` + `rpcResponse` fields, added a `.rpc(name, args)` recorder to the existing `createClient` mock, reset the new fields in the existing `beforeEach`. The 5 pre-existing tests use the same mock surface — no break.
- **Files modified:** src/lib/queries.test.ts
- **Commit:** 498d83a

**2. [Rule 2 — Defensive Logging] Structured error metadata over bare error object**
- **Found during:** Step 1 (consumer implementation)
- **Issue:** Plan's draft snippet did `console.error("fetchStrategyLazyMetrics RPC error:", error)`. That dumps the raw PostgrestError object — useful in dev, noisy and hard to filter in production logs.
- **Fix:** Logged structured fields `{strategyId, panelId, code: error.code, message: error.message}`. Matches the established pattern in `src/lib/audit.ts:267-276` for RPC consumers.
- **Files modified:** src/lib/queries.ts
- **Commit:** 6e9bad7

**3. [Rule 1 — Test Coverage] Added a fourth test for null-data with no error**
- **Found during:** Step 2 (test scaffolding)
- **Issue:** Plan listed 3 tests (arg shape + success + error fallback). The contract surface has a fourth axis: `{data: null, error: null}` — defensive against a supabase client returning null without an error (which can happen for visibility-miss RPCs that resolve to an empty payload but return no rows). Without the test, a future refactor that drops the `?? {}` would silently break.
- **Fix:** Added a fourth test `"returns empty object on null data with no error"` that seeds `{data: null, error: null}` and asserts `result === {}`. The `data ?? {}` clause in the implementation guarantees this.
- **Files modified:** src/lib/queries.test.ts
- **Commit:** 498d83a

### Plan-as-drafted vs reality reconciliations

- Plan said "(or extend an existing file if one exists)" for the test file — `src/lib/queries.test.ts` already exists with disclosure-tier tests. Extended it; did NOT create a new file.
- Plan's draft consumer used `data ?? ({} as LazyMetricsPayload)`. The committed version uses `(data ?? {}) as LazyMetricsPayload` — semantically identical, but the cast applies to the fallback expression as a whole. Net effect identical; readability marginally improved.
- Frontmatter declared `requirements: [METRICS-15]` but METRICS-15 splits across phases per the plan's own success criteria ("METRICS-15 RPC consumer half is shipped (path-extraction half is Phase 14a)"). REQUIREMENTS.md line 71 explicitly says: "_Implementation lands in Plan 12-08; Plan 12-02 ships the lazy-fetch RPC it consumes._" — but the path-extraction in `getStrategyDetail()` is Phase 14a's job. **METRICS-15 is therefore tracked under `requirements-partial` in this SUMMARY's frontmatter, not `requirements-completed`.** The checkbox in REQUIREMENTS.md stays unchecked until Phase 14a lands the path-extraction half.

## Threat Flags

None. The consumer routes through an existing SECURITY DEFINER RPC with internal visibility check — no new trust boundary, no new auth path, no new schema. The plan's threat register covers all four threats and dispositions.

## Self-Check: PASSED

**Files verified to exist:**
- `src/lib/queries.ts` — `fetchStrategyLazyMetrics` exported (line ~302); FOUND.
- `src/lib/queries.test.ts` — `fetchStrategyLazyMetrics` test block (line ~218); FOUND.
- `.planning/phases/12-backend-metric-contracts/12-08-SUMMARY.md` — this file; FOUND.

**Commits verified to exist:**
- `498d83a` test(12-08): add failing tests for fetchStrategyLazyMetrics consumer (RED) — FOUND.
- `6e9bad7` feat(12-08): implement fetchStrategyLazyMetrics RPC consumer (GREEN) — FOUND.

**Acceptance criteria from plan:**
- [x] `fetchStrategyLazyMetrics(strategyId, panelId)` exported from `src/lib/queries.ts`
- [x] `LazyMetricsPanelId` type union with all 7 panel IDs (overview/equity/drawdown/returns_dist/rolling/trades/exposure)
- [x] RPC called with `p_strategy_id` + `p_panel_id` params
- [x] Vitest tests pass (4 tests in the describe block; 9 total in the file)
- [x] `npm run build` exits 0

**TDD gate compliance:**
- [x] RED gate: `test(12-08): add failing tests for fetchStrategyLazyMetrics consumer (RED)` — commit 498d83a
- [x] GREEN gate: `feat(12-08): implement fetchStrategyLazyMetrics RPC consumer (GREEN)` — commit 6e9bad7
- [ ] REFACTOR gate: not needed — implementation matched final shape on first write; no cleanup required.
