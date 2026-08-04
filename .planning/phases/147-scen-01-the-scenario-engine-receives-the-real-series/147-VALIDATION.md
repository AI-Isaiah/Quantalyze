---
phase: 147
slug: scen-01-the-scenario-engine-receives-the-real-series
status: planned
nyquist_compliant: true
wave_0_complete: false
created: 2026-08-04
planned: 2026-08-04
---

# Phase 147 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest (TypeScript suite) |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `npx vitest run <changed test files> --no-file-parallelism` |
| **Full suite command** | `npm test` (local flakes → `--no-file-parallelism`; CI-only failures = Node 22 vs 25 skew, reproduce with `PATH=/opt/homebrew/opt/node@22/bin`) |
| **Estimated runtime** | ~300 seconds full; <30s targeted |

---

## Sampling Rate

- **After every task commit:** Run the targeted test files for the touched modules
- **After every plan wave:** Run the full vitest suite
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 300 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 01-T1 leaf extraction | 147-01 | 1 | SCEN-01 | T-147-01 | Differencing money-math pinned by untouched existing suite | unit (existing) | `npx vitest run src/lib/factsheet/allocator-portfolio-payload.test.ts --no-file-parallelism` | ✅ exists | ⬜ pending |
| 01-T2 deriveEmptySeriesState | 147-01 | 1 | SCEN-01 | T-147-02 | 16h age bound kills permanent spinner; unknown age → empty | unit (new) | `npx vitest run src/lib/closed-sets.series-state.test.ts --no-file-parallelism` | ❌ created by task | ⬜ pending |
| 02-T1 returns route | 147-02 | 2 | SCEN-01 | T-147-03/04/05 | RLS unchanged; series_state after 404 probe; T-29-02 redaction survives | route unit (extend) | `npx vitest run "src/app/api/strategies/[id]/returns/route.test.ts" --no-file-parallelism` | ✅ exists — extend R-matrix | ⬜ pending |
| 02-T2 OG route | 147-02 | 2 | SCEN-01 | T-147-06 | Published-only unchanged; image-only output | route unit (NEW file) | `npx vitest run "src/app/api/og/factsheet/[id]/route.test.tsx" --no-file-parallelism` | ❌ Wave 0 — created by task | ⬜ pending |
| 03-T1 share-resolve | 147-03 | 2 | SCEN-01 | T-147-08 | Pure layer; raw index never crosses to client | unit (extend) | `npx vitest run "src/app/scenario-share/[token]/share-resolve.test.ts" --no-file-parallelism` | ✅ exists | ⬜ pending |
| 03-T2 share page sibling read | 147-03 | 2 | SCEN-01 | T-147-07/09 | Read bounded to RPC ids; zero migrations | structural (existing gates) | `npx vitest run src/__tests__/phase-84-asset-class-flow.test.ts src/__tests__/phase-29-frozen-spine-guards.test.ts --no-file-parallelism` | ✅ exists | ⬜ pending |
| 04-T1 book path resolution | 147-04 | 2 | SCEN-01 | T-147-10/11 | returns_series + computation_status stripped from payload | unit (extend) | `npx vitest run src/lib/queries.my-allocation.test.ts --no-file-parallelism` | ✅ exists — extend | ⬜ pending |
| 04-T2 book series_state | 147-04 | 2 | SCEN-01 | T-147-12 | One shared derivation rule (deriveEmptySeriesState call count == 1 in queries.ts) | unit (extend) | same file | ✅ exists — extend | ⬜ pending |
| 05-T1 chip states | 147-05 | 3 | SCEN-01 | T-147-15 | Never-red negative assertions | component (extend) | `npx vitest run "src/app/(dashboard)/allocations/components/CoverageStateChip.test.tsx" --no-file-parallelism` | ✅ exists | ⬜ pending |
| 05-T2 composer wiring | 147-05 | 3 | SCEN-01 | T-147-13/14 | Literal-match tolerance; no client length-derivation | component (extend) | `npx vitest run "src/app/(dashboard)/allocations/components/ScenarioComposer.test.tsx" --no-file-parallelism` | ✅ exists | ⬜ pending |
| 05-T3 SC4 matrix | 147-05 | 3 | SCEN-01 | T-147-15 | UI-SPEC items 1–8 incl. no-literal-0.00 | component (extend) | same file | ✅ exists | ⬜ pending |
| 06-T1 hydration effect (P6) | 147-06 | 4 | SCEN-01 | T-147-16/17 | Idempotent refetch; no fetch storm | component (extend) | same file | ✅ exists | ⬜ pending |
| 06-T2 SC2 grep-gate | 147-06 | 4 | SCEN-01 | T-147-18 | Repo-wide bare-reader ban + allowlist pins | structural (NEW file) | `npx vitest run src/__tests__/phase-147-series-resolution-guards.test.ts --no-file-parallelism` | ❌ Wave 0 — created by task | ⬜ pending |
| 06-T3 ledger closure + full gate | 147-06 | 4 | SCEN-01 | — | Evidence completeness | full suite | `npm run test -- --no-file-parallelism && npm run lint && npx tsc --noEmit` | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

From 147-RESEARCH.md "Validation Architecture" Wave-0 gaps — each is created by the plan/task that needs it (no test references a file that will not exist by its verify step):

- [ ] `src/lib/closed-sets.series-state.test.ts` — created in 147-01 T2 (tests-first, RED observed)
- [ ] `src/app/api/og/factsheet/[id]/route.test.tsx` — created in 147-02 T2 (first-ever test for the OG route; `next/og` stubbed, no PNG render)
- [ ] Missing-analytics-row age-bound cases (P5) — added to `returns/route.test.ts` in 147-02 T1
- [ ] Harness widening in `returns/route.test.ts` — `STATE.analyticsRow` gains `returns_series` + `computation_status`; a `strategies.created_at` mock arm added for the lazy probe; `STATE.observedFilters.analyticsSelect` (already captured at `:107`) asserted to contain `returns_series` — 147-02 T1
- [ ] `src/__tests__/phase-147-series-resolution-guards.test.ts` — created in 147-06 T2 (deliberately LAST: the gate scans the FIXED tree; creating it in Wave 1 would redden the suite on the four not-yet-fixed sites)
- [x] Framework install: **none** — vitest + coverage-v8 already installed

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Founder's MT5 strategy shows its real day-count in a scenario on PROD | SCEN-01 | PROD data (strategy `4eab92b0`), live composer | Add the MT5 strategy to a scenario; overlapping-days matches stored span (expect N−1 ≈ 135 vs 136 stored — differencing consumes one day; NEVER assert 136); metrics non-zero. **Refresh the page mid-walkthrough** — the anchor must survive (P6 fix). |
| A1 composite check | SCEN-01 | PROD read (orchestrator-only; MCP stripped from subagents) | Before the walkthrough: `SELECT data_quality_flags->'composite' FROM strategy_analytics WHERE strategy_id='4eab92b0…'`. If `true`, the factsheet renders the composite `csv_daily_returns` arithmetic curve while the composer gets the differenced `returns_series` (RESEARCH P8) — re-derive the expected day-count before judging SC1, and record the divergence as known/reviewed, not a defect. |
| A2 missing-row census | SCEN-01 | PROD read | `SELECT count(*) FROM strategies s LEFT JOIN strategy_analytics a ON a.strategy_id=s.id WHERE a.strategy_id IS NULL;` — record the count in the acceptance write-up (the age bound is correct defence-in-depth regardless). |
| OG re-unfurl | SCEN-01 | CDN-owned staleness (P10) | Verify with a cache-busting query string; the corrected card appears within the 24h CDN TTL / 7d SWR window — do not call a stale unfurl a regression. |

---

## Falsifiability Ledger

> One row per success criterion. Mutation must be a semantic change to production code.
> Mutations are chosen to catch instance-fixes: SC-1's primary mutation hits the SECOND member
> of the reader class (`queries.ts`), not just the returns route.

| SC | Mutation (exact edit to production source) | Must turn RED | Observed? | Evidence |
|----|-------------------------------------------|---------------|-----------|----------|
| SC-1 | `src/lib/queries.ts` getMyAllocationDashboard projection: pass `undefined` instead of `analyticsObj.returns_series` to `resolveDailyReturnSeries` (**second class member**) | `queries.my-allocation.test.ts` SC1-book case (payload daily_returns collapses to []) | ✅ observed 2026-08-04 (147-04 T1) | 2 failed / 2 passed. SC1-book: `AssertionError: expected [] to have a length of 3 but got +0` at `queries.my-allocation.test.ts:2615`; raw-forward guard: `TypeError: Cannot read properties of undefined (reading 'value')` at `:2673`. Reverted; full file 80/80 green after revert. |
| SC-1(route) | `returns/route.ts`: remove `returns_series` from the analytics select string | `route.test.ts` SC1 case + select-width assertion | ⬜ pending — run in 147-02 T1 | |
| SC-2 | Plant a bare `daily_returns` select (no `returns_series`) in `src/lib/queries.ts` — a second site the gate author did not hand-pick | BOTH layers of `phase-147-series-resolution-guards.test.ts` (repo scan + allowlist pin) | ⬜ pending — run in 147-06 T2 (non-vacuity, recorded in docstring + commit message) | |
| SC-3 | `returns/route.ts`: replace the resolver call with `normalizeDailyReturns(row?.returns_series)` (forward the wealth index raw) | `route.test.ts` SC3 case — day one becomes ≈ 1.0 (+100%) and length becomes N, not N−1 | ⬜ pending — run in 147-02 T1 | |
| SC-3(share) | `share-resolve.ts`: revert the loop to the pre-147 `normalizeDailyReturns(s.daily_returns)` | `share-resolve.test.ts` SC1-share + SC3-share cases | ⬜ pending — run in 147-03 T1 | |
| SC-4 | Composer tolerance narrowing: map `"empty"` to `"computing"` | `ScenarioComposer.test.tsx` empty-note case (NO DATA chip becomes SYNCING) | ⬜ pending — run in 147-05 T2 | |
| SC-4(book) | `queries.ts`: hard-code the terminal-empty arm of the series_state derivation to `"computing"` | `queries.my-allocation.test.ts` state-empty-terminal case | ✅ observed 2026-08-04 (147-04 T2) | 2 failed / 6 passed. state-empty-terminal: `AssertionError: expected 'computing' to be 'empty'` at `queries.my-allocation.test.ts:2714`; the 16h missing-row bound also fell (`:2723`, 17h-old row stayed 'computing'). Reverted; 84/84 green after revert. |

*Each mutation is run by the task named in its row, immediately after that task's tests go GREEN: apply mutation → observe RED → revert → paste evidence here. 147-06 T3 refuses to close while any row is pending.*

---

## Oracle Independence

- [ ] No test imports a **constant** from the module it tests — expected values are **literals** in the test (16h boundary = literal `57600000`; `MISSING_ROW_COMPUTING_WINDOW_MS` never imported by its own tests)
- [ ] No assertion compares a value to itself via a re-export, fixture, or table under test
- [ ] Table/registry sizes are pinned to a **literal count**, not to `len(THE_TABLE)` (chip ladder test enumerates all 5 states explicitly)
- [ ] Any fake/double is pinned against the real contract it stands in for (next/og stub records constructor args; supabase mock captures select strings)

*Standing project rule honored: the SC-3 wealth-index oracle is the hand-computed literal expectation `[0.05, −0.1, 0.1]` for the fixture curve `[1.0, 1.05, 0.945, 1.0395]` — never re-derived by calling `equityCurveToDailyReturns` inside a test. Day-count assertions use N−1 (RESEARCH P4), never a hard-coded 136.*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies — **planner: satisfied, every task carries an automated command**
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify — **planner: satisfied**
- [ ] Wave 0 covers all MISSING references — **planner: satisfied (see Wave 0 table; gate deliberately last)**
- [ ] No watch-mode flags — **planner: all commands are `vitest run`**
- [ ] Feedback latency < 300s
- [ ] **Every success criterion has a Falsifiability Ledger row** — 7 rows across 4 SCs
- [ ] **Every ledger row is `Observed ✅` with pasted evidence, or explicitly marked skipped-with-reason** — closed by 147-06 T3
- [ ] **Oracle Independence checklist complete** — closed by 147-06 T3
- [ ] `nyquist_compliant: true` set in frontmatter — **set at planning (every task has automated verify)**

**Approval:** pending execution (147-06 T3 is the closing gate)
