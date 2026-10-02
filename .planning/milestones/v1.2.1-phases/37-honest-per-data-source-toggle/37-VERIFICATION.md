---
phase: 37-honest-per-data-source-toggle
verified: 2026-06-25T11:32:00Z
status: human_needed
score: 3/3 must-haves verified
overrides_applied: 0
human_verification:
  - test: "Log into a book allocator with >=2 eligible exchange keys. Open the Scenario tab (book mode). Verify the 'Data sources' control renders with one switch per connected exchange key."
    expected: "Each row shows exchange + nickname (or masked tail), aria-checked=true by default, accent-outline included state. The D3 gate must be satisfied (all active keys have per-key daily history post-backfill)."
    why_human: "Authed SSR pages cannot be hydrated by headless browse; real per-key series only exist post-backfill on a live allocator account. RTL tests substitute fixture data."
  - test: "With the 'Data sources' control visible, toggle one exchange key off. Observe the equity curve and all KPI values (Sharpe, vol, maxDD, return)."
    expected: "The curve redraws and every KPI number visibly changes to reflect only the remaining included key(s). The excluded row shows aria-checked=false, neutral outline, 'Excluded' label. No stale blended numbers remain visible."
    why_human: "Real-data numeric movement on prod per-key series cannot be asserted by automated tests, which use fixture series. The RTL honesty test proves the code path works; this confirms it on actual data."
  - test: "Toggle off ALL keys. Then re-include one."
    expected: "EmptyStateCard ('Select at least one data source') appears, all KPI slots show '—'. Re-including one key instantly restores the curve and live KPIs with no stale number. No page error."
    why_human: "All-excluded path with real data — confirms the engine's null path renders correctly in a live authenticated session."
---

# Phase 37: Honest Per-Data-Source Toggle — Verification Report

**Phase Goal:** The scenario composer can include/exclude each API key as a data source, with exclusion truly recomputing the curve + KPIs from the remaining per-key series.
**Verified:** 2026-06-25T11:32:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | `scenario-adapter.ts` keys projection units per `api_key` (per data source), not per blended book, with H-0132 oracle preserved | ✓ VERIFIED | `buildPerKeyStrategyForBuilderSet` exported at line 225 with `id === apiKeyId`; `buildStrategyForBuilderSet` at line 87 is byte-identical (git diff anchored after closing brace). 31 adapter tests pass including H-0132 oracle. |
| 2 | Composer surfaces a gated "Data sources" toggle UI (book mode + D3 gate) with one include/exclude switch per eligible API key; InfoBanner fallback on gate-not-satisfied; absent in blank mode | ✓ VERIFIED | `role="group" aria-label="Data sources" data-testid="scenario-data-sources"` at ScenarioComposer.tsx:2105–2158. Gate: `showDataSources = entryMode==='book' && payload.perKeyDailiesGateSatisfied`. InfoBanner at line 2160–2171. `role="switch" aria-checked={included}` per row. 8 data-sources test cases pass. |
| 3 | Excluding a key honestly recomputes curve + KPIs from remaining per-key series — never a cosmetic hide; all-excluded → EmptyStateCard + "—" KPIs; toggle is ephemeral (never in commit diff) | ✓ VERIFIED | `selected[s.id] = includeByApiKeyId[s.id] ?? true` in `projectionState` (line 1439), threading exclusion into the engine's `activeStrategies` filter. Single `computeScenario(` call site (line 1497; line 34 is a doc comment). `includeByApiKeyId` is a fresh `useState({})`, never written to `scenario.draft.toggleByScopeRef`. DSRC-03 honesty test (lines 3969–4021) asserts Sharpe/maxDD/twr + curve endpoint MOVE and match an independent two→one oracle recompute. Ephemerality test (lines 4136–4162) asserts `commit.disabled` remains `true` after a toggle. 203/203 targeted tests pass. |

**Score:** 3/3 truths verified

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/lib/queries.ts` | Three additive payload fields on `MyAllocationDashboardPayload` + both return sites; hoisted gate const | ✓ VERIFIED | Fields at lines 1775/1784/1790. Hoisted `perKeyDailiesGateSatisfied` const at line 3125. Both return sites at lines 3176–3178 and 3487–3489. `grep -c "eligibleApiKeyIds: eligibleKeyIds"` = 2. |
| `src/lib/__tests__/getMyAllocationDashboard.scenario.test.ts` | Payload-shape pins + byte-identity guard for three new fields | ✓ VERIFIED | T_M5 compile-time shape guard + runtime liveBaselineMetrics pin; 85 tests pass (up from 79). |
| `src/lib/queries.my-allocation.test.ts` | Integration assertions for new fields on seeded per-key fixture + both-branch defaults + cross-tenant subset guard | ✓ VERIFIED | Asserts `perKeyDailiesGateSatisfied===true`, `eligibleApiKeyIds` contains seeded key, `perKeyReturnsByApiKeyId["key-A"]` byte-identical to seeded series, cross-tenant subset (keys ⊆ `apiKeys[].id`), `!portfolio` branch empty/false-default pin. |
| `src/app/(dashboard)/allocations/lib/scenario-adapter.ts` | `buildPerKeyStrategyForBuilderSet` sibling builder; `buildStrategyForBuilderSet` unchanged | ✓ VERIFIED | Exported at line 225. `id === apiKeyId`, `weights[id] = Math.max(0, equityByApiKeyId[id] ?? 0)` (raw, no normalization). No `normalize`/`sum-to-1`/`/ total` in function body. `buildStrategyForBuilderSet` at line 87 untouched. |
| `src/app/(dashboard)/allocations/lib/scenario-adapter.test.ts` | Per-key builder cases PK1–PK9 + H-0132 oracle green | ✓ VERIFIED | 31 tests pass (23 prior + 8 new PK cases). PK3 raw-weight guard: `weights.A===70, weights.B===30`, not 0.7/0.3. |
| `src/app/(dashboard)/allocations/components/ScenarioComposer.tsx` | Per-key adapter wiring, ephemeral toggle state, gated Data-sources control, projectionState thread, all-excluded/fallback shells | ✓ VERIFIED | `includeByApiKeyId` useState at line 595; `usePerKeySources` at line 1350; `projectionState` threads `selected[s.id] = includeByApiKeyId[s.id] ?? true` at line 1439; `EmptyStateCard` at line 2196; `InfoBanner` at line 2162; `data-testid="scenario-data-sources"` at line 2108. |
| `src/app/(dashboard)/allocations/components/ScenarioComposer.test.tsx` | DSRC-02 gating + a11y, DSRC-03 honesty oracle, ephemerality, all-excluded, no-collapse | ✓ VERIFIED | 86 tests pass (78 prior + 8 new data-sources cases). Load-bearing DSRC-03 honesty test at line 3969 asserts numeric KPI/curve movement vs independent oracle. Ephemerality test at line 4136 asserts `commit.disabled` stays `true`. |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `getMyAllocationDashboard` both return sites | `MyAllocationDashboardPayload.perKeyReturnsByApiKeyId/Gate/Ids` | Three field lines on `!portfolio` branch (lines 3176–3178) and main branch (lines 3487–3489) | ✓ WIRED | `grep -c "eligibleApiKeyIds: eligibleKeyIds"` returns 2. |
| `buildPerKeyStrategyForBuilderSet` | `ScenarioComposer.tsx` per-key wiring | Import at line 94; `useMemo` call at line 1340 | ✓ WIRED | Single call site; memoized on `payload.perKeyReturnsByApiKeyId` and `equityByApiKeyId`. |
| `ephemeral includeByApiKeyId useState` | `projectionState.selected[s.id]` | `selected[s.id] = includeByApiKeyId[s.id] ?? true` at line 1439, guarded by `usePerKeySources` | ✓ WIRED | Deps array at line 1471 includes `includeByApiKeyId`. |
| `showDataSources` gate | `payload.perKeyDailiesGateSatisfied + entryMode==='book'` | `const usePerKeySources = entryMode==='book' && payload.perKeyDailiesGateSatisfied` (line 1350–1351); `showDataSources = usePerKeySources` (line 1363) | ✓ WIRED | Same gate selects the per-key strategy set AND shows the control — consistent. |
| Toggle click → `handleDataSourceToggle` → `setIncludeByApiKeyId` | Engine recompute | `onClick={() => handleDataSourceToggle(k.id, !included)}` at line 2133 → state update → projectionState memo recomputes → single `computeScenario` call at line 1497 | ✓ WIRED | No second engine call site; engine not forked. |
| All-excluded → `EmptyStateCard` | `allDataSourcesExcluded` derived at line 1389 | `dataSourceKeys.every((k) => includeByApiKeyId[k.id] === false)` gating `<EmptyStateCard>` at line 2194 | ✓ WIRED | Exact copy text matches plan spec. |

---

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `ScenarioComposer.tsx` — per-key projection | `perKeyAdapterOutput.strategies` | `buildPerKeyStrategyForBuilderSet(payload.perKeyReturnsByApiKeyId, equityByApiKeyId)` where `perKeyReturnsByApiKeyId` comes from the SSR `getMyAllocationDashboard` allocator-scoped DB read at queries.ts:3107 | Yes — DB-backed `csv_daily_returns` allocator-scoped read | ✓ FLOWING |
| `ScenarioComposer.tsx` — toggle state | `includeByApiKeyId` | `useState({})` — ephemeral client state, defaults all-included | N/A (state, not a fetch) | ✓ FLOWING |
| `ScenarioComposer.tsx` — KPI output | `scenarioMetrics` | `computeScenario(deAliased.strategies, deAliased.state, dateMapCache)` at line 1497, driven by `projectionState.selected` which contains the ephemeral toggle | Yes — real engine over real per-key series | ✓ FLOWING |

---

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| `eligibleApiKeyIds` present on both return branches | `grep -c "eligibleApiKeyIds: eligibleKeyIds" src/lib/queries.ts` | 2 | ✓ PASS |
| Single engine call site (not forked) | `grep -n "computeScenario(" ScenarioComposer.tsx` | 2 lines: line 34 (doc comment), line 1497 (real call) | ✓ PASS |
| Sibling builder exported once | `grep -c "export function buildPerKeyStrategyForBuilderSet" scenario-adapter.ts` | 1 | ✓ PASS |
| No manual weight normalization in sibling | `grep "normalize\|sum.*1\|/ total" scenario-adapter.ts` (within new function) | Only comment lines forbidding it; impl is `Math.max(0, ...)` raw | ✓ PASS |
| No new `role="alert"` on honest-absence surfaces | `grep -n "role=\"alert\"" ScenarioComposer.tsx` | Lines 2033 and 2065 are pre-existing `saveError` and `fingerprintMismatch` alerts; no new alert in this phase's surfaces | ✓ PASS |
| 4-file targeted test suite | `npx vitest run` on 4 phase-37 test files | 4 files, 203 tests, 0 failed | ✓ PASS |

---

### Probe Execution

Step 7c: SKIPPED (no probe scripts declared or found in `scripts/*/tests/probe-*.sh`; phase is a frontend feature, not a migration or CLI phase).

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| DSRC-01 | 37-01-PLAN, 37-02-PLAN | Scenario adapter keys units per `api_key`, not per blended book | ✓ SATISFIED | `buildPerKeyStrategyForBuilderSet` with `id === apiKeyId`; payload exposes `perKeyReturnsByApiKeyId` on both branches; 31 + 85 + integration tests pass. |
| DSRC-02 | 37-03-PLAN | Composer surfaces per-data-source toggle UI | ✓ SATISFIED | `role="group" data-testid="scenario-data-sources"` with one `role="switch"` per eligible key; gating, InfoBanner fallback, blank-mode absence all present and tested. |
| DSRC-03 | 37-03-PLAN | Excluding a key honestly recomputes curve + KPIs | ✓ SATISFIED | `projectionState.selected` threaded from `includeByApiKeyId`; single `computeScenario` call site; DSRC-03 honesty oracle + ephemerality + all-excluded tests mutation-verified. Full `npm test` 6606 passed, 0 failed. |

---

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `ScenarioComposer.tsx` | 72 (local mirror) | `holdingEquityContributionLocal` duplicates server-only `holdingEquityContribution` | ℹ Info | Intentional and documented: `@/lib/queries` is `server-only`; importing into a `"use client"` module crashes the bundle. Comment keeps it in lockstep. Not a stub. |

No `TBD`, `FIXME`, or `XXX` markers found in the phase-modified files.

---

### Human Verification Required

The automated test suite is fully green and the code is substantively wired. The only remaining gap is live-prod verification with an authenticated allocator who has two or more eligible exchange keys post-backfill — headless browse cannot hydrate authed pages (per documented project constraint).

#### 1. Data sources control renders on prod data

**Test:** Log into a book allocator with >=2 eligible exchange keys. Open the Scenario tab (book mode). Confirm the "Data sources" control is visible below the entry-mode row.
**Expected:** One `role="switch"` row per connected exchange key, each labeled `{Exchange} — {nickname}` or `{Exchange} — ••••{last-4}`. All switches show `aria-checked="true"` (included) with accent outline by default.
**Why human:** Authed SSR cannot be hydrated by headless browse. Real per-key series on production data only exist post-Phase-35 backfill.

#### 2. Toggle off one key — KPIs and curve change

**Test:** With the "Data sources" control visible, click the switch for one exchange key.
**Expected:** The switch changes to `aria-checked="false"`, neutral outline, "Excluded" label. The equity curve redraws and every KPI (Sharpe, vol, maxDD, return) shows a different number — not the prior blended figure. No page error.
**Why human:** Real-data numeric movement on live per-key series cannot be asserted by the test fixture. RTL DSRC-03 oracle proves the code path; this confirms it on actual prod data.

#### 3. All-excluded → honest empty + re-include restores

**Test:** Toggle off every visible key. Then re-include one.
**Expected:** EmptyStateCard "Select at least one data source" appears; all KPI slots show "—". Re-including one key restores the curve and live KPIs immediately. No stale blended numbers appear at any point.
**Why human:** Requires prod per-key data and an authed session; the all-excluded engine path has test coverage but live rendering is only verifiable with real data.

---

### Gaps Summary

No code gaps. All three ROADMAP success criteria are verified in the codebase:

- DSRC-01: `buildPerKeyStrategyForBuilderSet` correctly keys units per `api_key_id` with raw equity-share weights; `buildStrategyForBuilderSet` (H-0132 oracle) is byte-identical.
- DSRC-02: The gated "Data sources" control renders per the UI-SPEC with correct a11y (`role="switch"`, `aria-checked`, `role="group" aria-label="Data sources"`), InfoBanner fallback, and blank-mode absence.
- DSRC-03: Exclusion threads through `projectionState.selected` into the single unfork'd `computeScenario` call; the load-bearing honesty test is mutation-verified (cosmetic hide turns it red); toggle is ephemeral (diffCount invariant pinned).

The `human_needed` status reflects only the authed-prod live-data UAT listed in the VALIDATION.md manual-verification section — it is not a code gap.

---

_Verified: 2026-06-25T11:32:00Z_
_Verifier: Claude (gsd-verifier)_
