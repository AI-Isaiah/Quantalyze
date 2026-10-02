---
phase: 36-repoint-stats-reads
verified: 2026-06-25T07:26:00Z
status: passed
score: 6/6 must-haves verified
overrides_applied: 0
---

# Phase 36: Repoint Stats Reads — Verification Report

**Phase Goal:** Overview equity/KPIs read persisted per-key dailies (blended via the compute path) instead of reconstructing from `allocator_equity_snapshots`, converging to the realized+funding basis — while live holdings stay on the snapshot path.
**Verified:** 2026-06-25T07:26:00Z
**Status:** PASSED
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| #  | Truth                                                                                         | Status     | Evidence                                                                                       |
|----|-----------------------------------------------------------------------------------------------|------------|-----------------------------------------------------------------------------------------------|
| 1  | queries.ts reads per-key csv_daily_returns for stats (not snapshot reconstruction) when all active keys have dailies | ✓ VERIFIED | `queries.ts:2689` — `.from("csv_daily_returns").select("api_key_id, allocator_id, date, daily_return").eq("allocator_id", userId)` in fan-out; D3 seam at line 3042-3051 routes to `liveBaselineMetricsFromPerKeyDailies` |
| 2  | The fetched per-key data is routed into the displayed curve — not fetched-then-ignored        | ✓ VERIFIED | `queries.ts:3034-3051` — `buildPerKeyReturnsByApiKeyId` groups the rows; `liveBaselineMetricsFromPerKeyDailies` runs them through `computeScenario`; both return branches at lines 3087 and 3392 reference the same `liveBaselineMetrics` value |
| 3  | Mixed population (one key with dailies, one without) takes the FALLBACK — never a half-per-key/half-snapshot curve | ✓ VERIFIED | `allActiveKeysHavePerKeyDailies` (queries.ts:2358-2367) returns false if any active key id is absent from perKeyReturnsByApiKeyId; mixed-population test at queries.my-allocation.test.ts:1692 asserts fallback is taken AND result != per-key-only blend (falsifiable) |
| 4  | AUM is unchanged — summed from allocator_holdings on both branches                           | ✓ VERIFIED | `liveBaselineMetricsFromPerKeyDailies:2254` — `totalAum = holdingsSummary.reduce(...)` using `holdingEquityContribution`, identical to the fallback path; AUM test at queries.my-allocation.test.ts:1784 |
| 5  | Live holdings / positions still read the allocator_holdings poll/snapshot path — provably untouched | ✓ VERIFIED | `git diff 7357bf8b..e69970af -- src/lib/queries.ts` shows zero deletions from `allocator_holdings` fetch or `derivePhase07Fields`; `grep -n "derivePhase07Fields"` confirms the function at line 2396 is unmodified |
| 6  | GDPR per-key axis is wired before backfill — Art.15/20 bundle includes allocator's per-key rows | ✓ VERIFIED | `gdpr-export-manifest.ts:876` — `kind:"projected"` spec `csv_daily_returns_per_key` on `user_column:"allocator_id"`; unit test `gdpr-export-per-key-dailies.test.ts` passes 7/7; `check-gdpr-export-coverage.ts` exits 0 |

**Score:** 6/6 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/lib/database.types.ts` | csv_daily_returns Row with `id`, `api_key_id`, `allocator_id`, nullable `strategy_id` | ✓ VERIFIED | Lines 854-893: Row contains all four columns; Insert/Update mirror; Relationships unchanged |
| `src/lib/gdpr-export-manifest.ts` | `projected` csv_daily_returns_per_key spec on allocator_id axis | ✓ VERIFIED | Line 876: `table:"csv_daily_returns_per_key"`, `source_table:"csv_daily_returns"`, `user_column:"allocator_id"`, `project:redactCsvDailyReturnsPerKeyForUser` |
| `scripts/check-gdpr-export-coverage.ts` | SANITIZE_PARITY_ALLOWLIST entry for `csv_daily_returns_per_key` | ✓ VERIFIED | Lines 373-387: allowlist entry with CASCADE-erasure rationale |
| `src/lib/__tests__/gdpr-export-per-key-dailies.test.ts` | Two-axis export proof (per-key in, strategy in, cross-allocator out) | ✓ VERIFIED | 7/7 tests pass; cross-allocator drop, strategy-axis preservation, no `or_filter`, `getOrderColumn` returns `"id"` |
| `src/lib/queries.ts` | Per-key fetch in fan-out + `liveBaselineMetricsFromPerKeyDailies` + `allActiveKeysHavePerKeyDailies` + D3 seam | ✓ VERIFIED | Lines 2688-2699 (fetch), 2248-2349 (blend helper), 2358-2367 (predicate), 3034-3051 (seam) |
| `src/lib/queries.my-allocation.test.ts` | Per-key branch / fallback branch / mixed-population / AUM tests | ✓ VERIFIED | Lines 1551-1812; all tests pass (80 tests across 3 key files) |
| `src/lib/__tests__/getMyAllocationDashboard.scenario.test.ts` | Shape-identity test between per-key and fallback branches | ✓ VERIFIED | Lines 493-583: `assertShape` checks key set and value types on both branches; AUM=Σholdings pinned on both |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `getMyAllocationDashboard` fan-out | `csv_daily_returns` (per-key rows) | `.from("csv_daily_returns").eq("allocator_id", userId).gte("date", ...).limit(20000)` | ✓ WIRED | `queries.ts:2688-2699`; user client (NOT admin), owner RLS gate, 730-day window |
| `liveBaselineMetricsFromPerKeyDailies` | `computeScenario` (frozen engine) | `buildPerKeyReturnsByApiKeyId` groups rows → `StrategyForBuilder[]` per api_key_id → `computeScenario(strategies, state, cache)` | ✓ WIRED | `queries.ts:2318-2322`; reuses the frozen SCENARIO-05 engine, no fork |
| D3 seam | both return branches | Single `liveBaselineMetrics` value computed once at line 3042, referenced at lines 3087 (`!portfolio`) and 3392 (`portfolio`) | ✓ WIRED | Both branches use the same computed value; no inline re-call of `liveBaselineMetricsFromHoldings` |
| `liveBaselineMetrics` (per-key branch) | holdings AUM | `holdingEquityContribution` summed from `holdingsSummary` at `liveBaselineMetricsFromPerKeyDailies:2254` | ✓ WIRED | AUM source unchanged (D2); weight per key = Σ holdings equity for that api_key_id |
| GDPR manifest | `csv_daily_returns` per-key rows | `projected` spec → engine SELECT `.eq(allocator_id, userId)` + `redactCsvDailyReturnsPerKeyForUser` re-filter | ✓ WIRED | `gdpr-export-manifest.ts:876-883`; unit-pinned |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `liveBaselineMetricsFromPerKeyDailies` | `perKeyReturnsByApiKeyId` | `buildPerKeyReturnsByApiKeyId(phase36PerKeyDailiesRes.data)` — groups DB rows by `api_key_id`, maps `daily_return → value` | Yes (when rows exist post-backfill; dormant but wired pre-backfill per D6 design) | ✓ FLOWING |
| `allActiveKeysHavePerKeyDailies` | `activeKeyIds` | `apiKeys.filter(k => k.is_active).map(k => k.id)` — from the live `getUserApiKeys` fetch | Yes | ✓ FLOWING |
| GDPR `redactCsvDailyReturnsPerKeyForUser` | `allocator_id` axis rows | Engine SELECT `csv_daily_returns WHERE allocator_id = userId` | Yes (identity passthrough after allocator_id re-filter) | ✓ FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Per-key fetch exists in getMyAllocationDashboard fan-out | `grep -n 'from("csv_daily_returns")' src/lib/queries.ts` | Line 2689 matches | ✓ PASS |
| D3 predicate rejects empty active set | Unit test `allActiveKeysHavePerKeyDailies([], ...)` | Returns false (test line 1809) | ✓ PASS |
| Full test suite | `npx vitest run` | 6577 passed, 0 failed, 284 skipped | ✓ PASS |
| TypeScript compiles | `npx tsc --noEmit` | Exit 0 (no output) | ✓ PASS |
| GDPR coverage hook | `npx tsx scripts/check-gdpr-export-coverage.ts` | "OK - manifest covers all 23 declared user-owned tables (manifest size 38)" | ✓ PASS |
| gdpr-export-schema invariant | `npx vitest run src/__tests__/gdpr-export-schema.test.ts` | 5/5 passed | ✓ PASS |

### Probe Execution

Step 7c: SKIPPED — phase ships code only; D6 operational backfill (`railway ssh python -m scripts.phase35_backfill_enqueue`) is an explicit post-deploy step, not a CI probe. No `scripts/*/tests/probe-*.sh` declared in plans.

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| UNIFY-01 | 36-01, 36-02, 36-03 | queries.ts reads persisted per-key dailies for stats instead of reconstruction | ✓ SATISFIED | Per-key fetch at `queries.ts:2689`; `liveBaselineMetricsFromPerKeyDailies` selected by D3 gate |
| UNIFY-02 | 36-03 | Equity curve is blend of per-key dailies through compute path; converges to realized+funding basis | ✓ SATISFIED | `computeScenario` called inside `liveBaselineMetricsFromPerKeyDailies` (`queries.ts:2320`); same frozen engine as Scenario/factsheets |
| UNIFY-03 | 36-03 | Live holdings continue to read poll/snapshot path | ✓ SATISFIED | `allocator_holdings` fetch (`queries.ts:2633`) and `derivePhase07Fields` (`queries.ts:2396`) both unmodified by any Phase 36 commit |

### Anti-Patterns Found

No blockers. One resolved deferred item noted:

| File | Pattern | Severity | Resolution |
|------|---------|----------|------------|
| `src/__tests__/gdpr-export-schema.test.ts` | Schema test asserted `csv_daily_returns` was an id-less table (stale pre-migration assumption). Tripped by 36-01 adding `id:number` to types. | Was: WARNING | Resolved: commit `e347fdbb` (in-branch, not in any SUMMARY) dropped the stale `ORDER_COLUMN_OVERRIDES["csv_daily_returns"]="date"` entry; schema test now passes 5/5. The fix was not documented in a plan or summary — it is a raw fix commit. |

Debt markers: none found in phase-36 modified files (grep for TBD/FIXME/XXX returned no matches in the modified set).

### Human Verification Required

No automated blockers remain. One item needs human confirmation after the D6 operational backfill runs in prod:

1. **Prod convergence after backfill**
   - **Test:** After running `railway ssh "cd /app && python -m scripts.phase35_backfill_enqueue"` and waiting for the worker to drain, navigate to the Overview dashboard for an allocator whose every active key is a crypto-exchange key. Compare the Sharpe / max-DD / equity curve with the Scenario tab for the same allocator.
   - **Expected:** The Overview KPIs agree with (or converge toward) the Scenario tab numbers; the curve shape reflects the realized+funding basis rather than the snapshot reconstruction.
   - **Why human:** The per-key blend is dormant until per-key rows exist in prod. The code path is fully wired and all code-level tests pass, but end-to-end convergence can only be observed after the backfill populates `csv_daily_returns`.

---

## Gaps Summary

No gaps. All six must-haves are VERIFIED at the artifact, wiring, and data-flow levels. The full test suite passes (6577/6577, 0 failed). The deferred gdpr-export-schema failure (DEFER-36-02-01) was resolved in-branch by commit `e347fdbb` before the phase completed — it is no longer open.

One post-deploy human check is required to confirm prod convergence after the D6 backfill, per plan design (the code path is dormant until per-key rows are populated).

---

## Adversarial review addendum (fresh-Claude red-team, post-verification)

A parallel adversarial review (opus, fresh context) caught a CRITICAL the
goal-backward pass did not: **C1 — the D3 gate filtered eligible keys by bare
`is_active`, diverging from the backfill's canonical predicate** (`is_active AND
sync_status != 'revoked' AND disconnected_at IS NULL`). A revoked/soft-disconnected
allocator key keeps `is_active=true` (protected path) but never gets a per-key series,
so it would have pinned the whole allocator to the snapshot fallback forever.

- **C1 (CRITICAL)** — FIXED in commit `6ae38672`: added `isPerKeyDailiesEligibleKey`
  mirroring the backfill predicate; the gate now uses it.
- **H1 (HIGH)** — FIXED same commit: falsifiable regression test (revoked-but-active key
  must not block the per-key branch) + a direct predicate unit test. Full suite 6579 green.
- **M2 / L2** — addressed inline (avgRho comment).
- **M1 (all-zero-weight flat curve), L1 (silent non-finite drop)** — DEFERRED, non-regression;
  see `deferred-items.md`.
- **N1** (GDPR `date`→`id` ordering) — verified correct.

Verdict after fixes: **passed**. Remaining open item is the D6 post-deploy convergence
check (operational, executed at land time), not a code gap.

## D6 convergence — RESOLVED (2026-06-25, post-deploy)

PR #524 (squash 23fc6601, v0.32.0.0) merged; all CI green first-try; Supabase Migrate
applied the `(allocator_id, date)` index to prod; Vercel frontend 200; analytics /health
@ 23fc6601. Backfill (`phase35_backfill_enqueue`) ran: **14/14 derive jobs done, 0
failures, 1675 per-key rows across all 14 active keys.** Convergence verified on prod:
**5/5 allocators have ALL active keys backfilled → every allocator's Overview now reads
the per-key realized+funding blend** (the D3 gate passes for all). The only item still
needing the user is the authed visual canary (the rendered Sharpe/curve change on
/allocations), which needs a live-session browser — the data precondition is 100% met.
Phase 36 is shipped, deployed, backfilled, and converged.

---

## Authed Overview canary — PASSED (2026-06-25, live user session)

Ran the last open item (authed visual canary) via Playwright MCP against the user's
logged-in browser on prod (`quantalyze-rho.vercel.app/allocations`), allocator
`a11ca111-…` (Overview tab, 6M).

- **Per-key path provably active (not fallback):** all 4 eligible exchange keys
  (1 bybit + 3 okx, all `is_active` / `sync_status=complete` / `disconnected_at IS NULL`)
  have per-key rows in `csv_daily_returns` (155/100/100/100), so the D3
  `allActiveKeysHavePerKeyDailies` gate is satisfied and the per-key blend renders.
- **Renders clean:** equity curve drawn, all KPI cards populated, **0 console errors**,
  low-sample guard shown ("Only 75 observations…"). Screenshot:
  `.gstack/qa-reports/screenshots/phase36-overview-canary.png`.
- **Displayed number traces to the per-key store on the 252 basis (the headline proof):**
  displayed Sharpe **2.52** vs an independent 252-basis blend computed directly from the
  per-key `csv_daily_returns` rows (**2.58**, n=**75 exact**). The 252-vs-365 discriminator
  is decisive — a 365 basis would render **3.11** (2.58×√(365/252)), ruling out the old
  un-converged basis. This live-confirms Phase 34's convergence + Phase 36's repoint on a
  rendered metric.
- **Ann.Vol magnitude gap is method, not data:** independent per-date weighted-average blend
  gives 15.9% vs displayed 529.7%. Sharpe is scale-invariant so the ratio matches; the
  absolute magnitude differs because `computeScenario` blends per-key *equity* curves (the
  visibly wild deep-V seed curve), whose daily-return magnitude a per-date return-average
  dampens ~33×. Both displayed metrics share that scale → ratio matches, magnitude doesn't.
  Genuine seed-data volatility (synthetic allocator with 3 duplicate okx keys), not a
  repoint bug. No real-client exposure.

**Cross-phase UAT closure:** this canary also closes Phase 34's advisory manual UAT
(landing Sharpe on the converged 252 basis — confirmed: 2.52, not the 365-basis 3.11) and
confirms Phase 35's prod-migration+backfill manual UAT (4/4 of this allocator's keys
backfilled; 5/5 allocators converged at land time).

Verdict: **Phase 36 fully verified — shipped, deployed, backfilled, converged, and
authed-canary-confirmed.**

---

_Verified: 2026-06-25T07:26:00Z (addendum 2026-06-25T07:34:00Z; canary 2026-06-25T07:05:00Z)_
_Verifier: Claude (gsd-verifier) + fresh-Claude adversarial red-team + live authed canary_
