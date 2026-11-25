---
phase: "239"
slug: "surfacecache"
status: draft
nyquist_compliant: false
wave_0_complete: false
created: "2026-11-24"
---

# Phase 239 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution. Source: `239-RESEARCH.md` `## Validation Architecture`.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest (jsdom), `@testing-library/react` |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `npx vitest run src/lib/dateday.test.ts "src/app/factsheet/[id]/v2/range-dates.test.ts" "src/app/factsheet/[id]/v2/factsheet-context.provider.test.tsx"` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~30 seconds quick; full suite measured at execution |

---

## Sampling Rate

- **After every task commit:** quick run command plus the file the task touched
- **After every plan wave:** every `xRange` consumer test: `npx vitest run $(grep -rl -E "xRange|setXRange|useXRange" src --include='*.test.ts' --include='*.test.tsx')`
- **Before `/gsd-verify-work`:** full suite green
- **Max feedback latency:** 60 seconds

---

## Per-Task Verification Map

Filled by the planner per task. Requirement → test map:

| Requirement | Behavior | Automated Command | File Exists |
|-------------|----------|-------------------|-------------|
| CACHE-02 | `subtractMonths` clamps to month end | `npx vitest run src/lib/dateday.test.ts` | ✅ file, ❌ W0 arms |
| CACHE-02 | resolver: manual dates kept, strict off-axis fallback, preset ends on latest | `npx vitest run "src/app/factsheet/[id]/v2/range-dates.test.ts"` | ❌ W0 |
| CACHE-02 (SC-1) | manual range keeps dates on back and front growth; 12M preset ends on latest after front growth and rolls on back growth; shrunk-axis arm unchanged | `npx vitest run "src/app/factsheet/[id]/v2/factsheet-context.provider.test.tsx"` | ✅ file, ❌ W0 arms |
| CACHE-02 | MTM/smoothed axis: manual range keeps its dates; active-axis bridge equals the basis view's dates | `npx vitest run "src/app/factsheet/[id]/v2/MasterBrush.basis.test.tsx" "src/app/factsheet/[id]/v2/basis-context.test.tsx"` | ✅ files, ❌ W0 arms |
| CACHE-02 | `PeriodControl` 3M/6M/12M span calendar months ending on the latest day | `npx vitest run "src/app/(dashboard)/allocations/widgets/performance/"` | ❌ W0 |
| CACHE-04 | BTC row's figures reach the list unconverted and rank in one population with USD rows | `npx vitest run src/lib/queries.native-unit-ranking.test.ts src/components/strategy/StrategyTable.native-unit-ranking.test.tsx` | ❌ W0 |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `node_modules` installed in the worktree
- [ ] New and re-pinned test arms listed above, each shown RED first (PROOF-01)

---

## Manual-Only Verifications

All phase behaviors have automated verification.

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 60s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
