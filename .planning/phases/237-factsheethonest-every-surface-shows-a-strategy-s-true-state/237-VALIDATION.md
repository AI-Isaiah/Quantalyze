---
phase: "237"
slug: "factsheethonest"
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
status: draft
nyquist_compliant: false
wave_0_complete: false
created: "2026-11-23"
---

# Phase 237 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution. Source: `237-RESEARCH.md` `## Validation Architecture` (the requirement-to-test map and the PROOF-01 neuter map live there and are binding).

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest (jsdom default; node env opt-in per file) |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `npx vitest run <touched test paths>` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~30 seconds targeted; full suite several minutes |

---

## Sampling Rate

- **After every task commit:** the task's targeted `npx vitest run` paths, plus `npx tsc --noEmit` when a type changed
- **After every plan wave:** `npm run lint`, `npm run typecheck`, full vitest files of every touched directory
- **Before `/gsd-verify-work`:** `npm test` green, plus the censuses (`recompute-verdict-census`, `degrade-warning-scan`, `copy-census`, `complete-status-scan`, `figure-gate-census`)
- **Max feedback latency:** 60 seconds per targeted run

---

## Per-Task Verification Map

Filled by the planner per task (each task carries an `<automated>` verify). Requirement coverage target, from RESEARCH:

| Requirement | Test Type | Automated Command | File Exists | Status |
|-------------|-----------|-------------------|-------------|--------|
| FACT-01 | component | `npx vitest run src/app/factsheet/[id]/v2/MetricsColumn.withheld-panels.test.tsx src/app/factsheet/[id]/v2/FactsheetView.headline-coverage.test.tsx` | ❌ W0 / ✅ | ⬜ pending |
| FACT-02 (S2–S8b) | route / page / component | per-surface paths in RESEARCH | mixed | ⬜ pending |
| FACT-02 census | source scan | `npx vitest run src/__tests__/recompute-verdict-census.test.ts` | ❌ W0 | ⬜ pending |
| FACT-04 | page seam | `npx vitest run src/app/factsheet/[id]/v2/page.owner-trust-tier.test.tsx` | ❌ W0 | ⬜ pending |
| CACHE-01 | route + HTTP-cache double | `npx vitest run src/app/api/og/factsheet/[id]` | ❌ W0 / ✅ | ⬜ pending |
| CACHE-03 | page seam on keyed store double | `npx vitest run src/app/factsheet/[id]/v2/page.public-cache-key.test.tsx` | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `npm ci` in the worktree; re-read installed `unstable_cache` source
- [ ] `src/__tests__/recompute-verdict-census.test.ts`
- [ ] `src/app/factsheet/[id]/v2/MetricsColumn.withheld-panels.test.tsx`
- [ ] `src/app/api/og/factsheet/[id]/route.cache-ttl.test.tsx` + clock-driven HTTP-cache double
- [ ] `src/app/(dashboard)/recommendations/page.rerun-hold.test.tsx`
- [ ] `src/app/factsheet/[id]/v2/page.owner-trust-tier.test.tsx`
- [ ] `SAMPLES` entry and ledger id for `scenario.analytics-updating`

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Share card renders the Updating line legibly in the 1200×630 image | FACT-02 S5 | image layout | render `/api/og/factsheet/<held id>` locally and inspect |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 60s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
