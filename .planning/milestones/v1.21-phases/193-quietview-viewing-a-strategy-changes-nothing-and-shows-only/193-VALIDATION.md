---
phase: "193"
slug: "quietview-viewing-a-strategy-changes-nothing-and-shows-only"
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
# audit-milestone §5.5 distinguishes NOT-VALIDATED (draft) from PARTIAL (validated + nyquist_compliant: false) (#2117)
status: draft
nyquist_compliant: false
wave_0_complete: false
created: "2026-11-06"
---

# Phase 193 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Source: `193-RESEARCH.md` § Validation Architecture.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest (jsdom) + `@testing-library/react` + `@testing-library/user-event` |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `npx vitest run "<the single test file the task touches>"` |
| **Full suite command** | `npm test && npm run typecheck && npm run lint` |
| **Estimated runtime** | ~10 seconds per file; full suite several minutes |

---

## Sampling Rate

- **After every task commit:** run the single test file the task touches
- **After every plan wave:** run every file under `src/app/factsheet/[id]/v2/`, `src/components/notes`, and `src/app/(dashboard)/allocations/components/HoldingDetail*` / `HoldingsTable.sub-row*`
- **Before `/gsd-verify-work`:** full suite must be green
- **Max feedback latency:** 10 seconds per task

---

## Per-Task Verification Map

Requirement-level map (task IDs are assigned by the plans; each plan's `<verify>` carries the exact command).

| Requirement | Behavior | Test Type | Automated Command | File Exists | Status |
|-------------|----------|-----------|-------------------|-------------|--------|
| TRUST-02 / SC-1 | Plain wheel over `TimeSeriesChart` and `HistogramChart` leaves range unchanged and is not default-prevented; Ctrl/Cmd+wheel zooms | component | `npx vitest run "src/app/factsheet/[id]/v2/TimeSeriesChart.window-gesture.test.tsx" "src/app/factsheet/[id]/v2/charts.signed-zero.test.tsx"` | ✅ extend | ⬜ pending |
| TRUST-02 / SC-1 | Existing plain-wheel tests repointed to `ctrlKey: true` (incl. `FactsheetView.headline-coverage.test.tsx`) | component | run those files | ✅ | ⬜ pending |
| TRUST-02 / SC-2 | Hydration ignores and deletes a legacy stored/URL `range`; a pan writes nothing | provider | `npx vitest run "src/app/factsheet/[id]/v2/factsheet-context.provider.test.tsx" "src/app/factsheet/[id]/v2/factsheet-context.codec.test.ts"` | ✅ extend | ⬜ pending |
| TRUST-02 / SC-2 | `Reset to full history` in `RangeEyebrow` (strip + rail), click restores full history, focus to label | component | `npx vitest run "src/app/factsheet/[id]/v2/FactsheetView.window-kpis.test.tsx" "src/app/factsheet/[id]/v2/MetricsColumn.window.test.tsx"` | ✅ extend | ⬜ pending |
| TRUST-03 / SC-3 | D-07 guard: removed strings, `MultiMarket`, demo portfolio names, `#factsheet-allocator`, nav "Allocator" absent; scenario-blend peer panel present | component | `npx vitest run "src/app/factsheet/[id]/v2/FactsheetBody.no-demo-content.test.tsx"` | ❌ W0 | ⬜ pending |
| TRUST-06 / SC-4 | Each of 4 note surfaces: open + leave → 0 PATCH, no focus; type + blur → exactly 1 PATCH | component | `npx vitest run src/components/notes "src/app/(dashboard)/allocations/components/"` | ✅ extend | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/app/factsheet/[id]/v2/FactsheetBody.no-demo-content.test.tsx` — D-07 guard (needs a firing `IntersectionObserver`; fixture without `hideAllocatorSection` / `hideFooter`)
- [ ] Wheel-gate arms for `TimeSeriesChart` and `HistogramChart`
- [ ] Provider cases for the legacy-range purge and "a pan writes nothing"
- [ ] `RangeEyebrow` reset cases
- [ ] D-10 open-and-leave arms per note surface

No framework install or config change is needed. Every new guard gets the neuter-then-RED step from a byte backup.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Read-only PROD count of empty notes before the fix (D-08) | TRUST-06 / SC-4 | PROD read via Supabase MCP; not a CI test | Marker query first, then one read-only count per MCP call; record counts and dates only in the phase dir |
| Plain wheel scrolls the page in a real browser (UI-SPEC backstop) | TRUST-02 / SC-1 | jsdom cannot prove native scroll | Browser check on a factsheet: plain wheel scrolls, range label and strip values unchanged; Ctrl/Cmd+wheel zooms |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 10s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
