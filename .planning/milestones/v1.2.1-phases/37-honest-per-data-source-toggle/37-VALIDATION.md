---
phase: 37
slug: honest-per-data-source-toggle
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-06-25
---

# Phase 37 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.x (`vitest run`) + @testing-library/react + jsdom |
| **Config file** | `vitest.config.ts` (coverage ratchet: lines 82 / statements 80 / functions 74 / branches 72) |
| **Quick run command** | `npx vitest run "src/app/(dashboard)/allocations/lib/scenario-adapter.test.ts" "src/app/(dashboard)/allocations/components/ScenarioComposer.test.tsx"` |
| **Full suite command** | `npm test` (i.e. `vitest run`) — full TS suite + coverage gate in CI |
| **Estimated runtime** | ~3s for the two touched suites; full suite minutes (CI) |

---

## Sampling Rate

- **After every task commit:** Run the touched file's suite (`npx vitest run <file>`).
- **After every plan wave:** Run the three suites together (scenario-adapter + ScenarioComposer + queries.my-allocation), since the payload→adapter→composer chain spans all three.
- **Before `/gsd:verify-work`:** Full `npm test` must be green (incl. coverage ratchet).
- **Max feedback latency:** ~3s per touched suite.

---

## Per-Task Verification Map

| Task | Wave | Requirement | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|------|------|-------------|-----------------|-----------|-------------------|-------------|--------|
| Payload expose per-key fields | 1 | DSRC-01 (enabler) | No new cross-tenant read; allocator-scoped only | integration | `npx vitest run src/lib/__tests__/getMyAllocationDashboard.scenario.test.ts src/lib/queries.my-allocation.test.ts` | ✅ add cases | ⬜ pending |
| Sibling per-key adapter builder | 2 | DSRC-01 | N/A | unit | `npx vitest run "src/app/(dashboard)/allocations/lib/scenario-adapter.test.ts" -t "per-key"` | ✅ add cases | ⬜ pending |
| B4 signature + H-0132 oracle regression | 2 | DSRC-01 | Commit-oracle integrity preserved | unit (regression) | `npx vitest run "src/app/(dashboard)/allocations/lib/scenario-adapter.test.ts"` | ✅ existing | ⬜ pending |
| Data-sources toggle UI + gating | 3 | DSRC-02 | N/A | component | `npx vitest run "src/app/(dashboard)/allocations/components/ScenarioComposer.test.tsx" -t "data sources"` | ✅ add cases | ⬜ pending |
| Toggle a11y (aria-label/checked, group name) | 3 | DSRC-02 | N/A | component (a11y) | same file | ✅ add cases | ⬜ pending |
| **Honest recompute (curve + KPIs move)** | 3 | DSRC-03 | Never a cosmetic hide over a stale number | component | same file | ✅ add cases | ⬜ pending |
| All-excluded honest empty | 3 | DSRC-03 | KPIs render "—", never stale blended number | component | same file | ✅ add cases | ⬜ pending |
| Per-key units not collapsed (avg-ρ honest) | 2/3 | DSRC-03 | N/A | unit/component | scenario-dealias passthrough assertion | ✅ add case | ⬜ pending |
| Toggle ephemeral (no diff / no commit) | 3 | DSRC-03 | Toggle never leaks into commit diff | component | same file | ✅ add case | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/app/(dashboard)/allocations/lib/scenario-adapter.test.ts` — add per-key builder cases (id === api_key_id keying, equity-share weights, default selected=true, empty-series skip).
- [ ] `src/app/(dashboard)/allocations/components/ScenarioComposer.test.tsx` — add: control gating (book/blank/fallback), honest-recompute (DSRC-03 core), all-excluded empty, ephemerality (no diff), per-key no-collapse.
- [ ] `src/lib/__tests__/getMyAllocationDashboard.scenario.test.ts` + `src/lib/queries.my-allocation.test.ts` — assert the three new payload fields on BOTH return branches + `liveBaselineMetrics`/`holdingReturnsByScopeRef` byte-unchanged.

*No framework install needed — Vitest + RTL already configured.*

---

## The DSRC-03 Honesty Test (load-bearing — must FAIL on a cosmetic hide)

The single most important test: render the composer with TWO per-key sources whose return series differ
materially (key A flat/positive, key B volatile/negative). Capture `KpiStrip` props (or `scenarioMetrics`)
with both included. Toggle key B off. Assert the recomputed Sharpe / maxDD / return / equity-curve endpoint
are DIFFERENT — and specifically match an independent two-key→one-key recompute (not merely "changed").
Model on the existing T_C7 pattern (ScenarioComposer.test.tsx) which captures `KpiStrip.mock.calls`
before/after a toggle.

**A test that only asserts the row's visual state (strikethrough/opacity) would pass for a cosmetic hide —
it MUST assert the KPI/curve numbers move.** This is the test the CONTEXT Specifics flag as load-bearing.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Authed live composer toggle recompute on prod data | DSRC-02/03 | Authed SSR needs a logged-in browser (headless can't hydrate authed pages); real per-key prod series only exist post-backfill | After deploy: log into a book allocator with ≥2 eligible exchange keys, open Scenario (book mode), exclude one source, confirm the curve + KPIs visibly change and re-including restores. |

---

## Validation Sign-Off

- [x] All tasks have automated verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 5s (touched suites)
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-06-25
