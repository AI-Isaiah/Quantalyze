---
phase: "205"
slug: "oneverdict-every-figure-path-follows-the-record-s-one-readab"
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
# audit-milestone §5.5 distinguishes NOT-VALIDATED (draft) from PARTIAL (validated + nyquist_compliant: false) (#2117)
status: draft
nyquist_compliant: false
wave_0_complete: false
created: "2026-11-10"
---

# Phase 205 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Source: `205-RESEARCH.md` § Validation Architecture (the decision-to-test map lives there).

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest (jsdom project) |
| **Config file** | `vitest.config.ts` (existing) |
| **Quick run command** | `npx vitest run src/__tests__/figure-parity-pages.test.tsx "src/app/factsheet/[id]/v2/StressWindowsPanel.unreadable.test.tsx" src/lib/factsheet/build-payload.test.ts src/lib/factsheet/figure-record-unreadable.test.ts src/lib/factsheet/audit-c20.test.ts` |
| **Full suite command** | `npx vitest run src/lib/factsheet "src/app/factsheet" "src/app/(dashboard)/allocations" src/__tests__/figure-parity-pages.test.tsx` (targeted factsheet scope; executors never run the whole suite) |
| **Types** | `npx tsc --noEmit` |
| **Estimated runtime** | ~5 s quick, ~130 s factsheet scope, ~21 s tsc |

---

## Sampling Rate

- **After every task commit:** quick run + `npx tsc --noEmit`
- **After every plan wave:** factsheet scope
- **Before `/gsd-verify-work`:** factsheet scope green, except the pre-existing `compute.conventions.test.ts` fixtures B and C reds measured at unmodified HEAD
- **Max feedback latency:** 130 seconds

---

## Per-Task Verification Map

Filled by the planner per task; every new data-integrity gate is shown RED by neutering the fix (byte backup copy, edit, run, copy back, `shasum` equal). Decision rows D-01..D-05 with their neuters are in `205-RESEARCH.md` § Validation Architecture.

| Task | Decision | Gate (file > case) | Automated command | Neuter that must go RED | Status |
|------|----------|--------------------|-------------------|-------------------------|--------|
| 205-01 T1 (tracer) | D-01 | `figure-parity-pages.test.tsx` > `205 D-01` absent-day bad date (`2024-07-3`, `2024-07-31x`): native and USD both readable; existing `194.2 R2 WR-01` case: both unreadable | `npx vitest run src/__tests__/figure-parity-pages.test.tsx src/lib/factsheet/figure-record-unreadable.test.ts src/lib/factsheet/build-payload.test.ts src/lib/factsheet/fetch-and-build-payload.test.ts` + `npx tsc --noEmit` | `inherit_dropped`; `second_scan_restored` (two files) | ⬜ |
| 205-01 T2 | D-01 | `figure-parity-pages.test.tsx` > one `figure-record-unreadable` report per record (interior `2026-06-31`) | `npx vitest run src/__tests__/figure-parity-pages.test.tsx src/lib/factsheet/figure-record-unreadable.test.ts` | `report_combined`; `report_first_bad_only` | ⬜ |
| 205-02 T1 | D-02 | `StressWindowsPanel.unreadable.test.tsx` > `205 D-02` interior `2024-06-31`, direct `deriveSeriesBundle` with unreadable record, MTM/smoothed bundles | `npx vitest run "src/app/factsheet/[id]/v2/StressWindowsPanel.unreadable.test.tsx" src/lib/factsheet/build-payload.test.ts ...` + tsc | `verdict_dropped` | ⬜ |
| 205-02 T2 | D-02 (+D-01) | `figure-parity-pages.test.tsx` > `205 D-02` native and USD withheld stress (`curve[1]=2024-02-30`, interior `2024-06-31`) | `npx vitest run src/__tests__/figure-parity-pages.test.tsx ...` | `verdict_dropped` | ⬜ |
| 205-03 T1 | D-03, D-04 | `StressWindowsPanel.unreadable.test.tsx` > `205 D-03` api-arm first dates `""`, `2023-13-01`, `2023-02-32`, `2024-1-5`, `2024-02-30` (readable days from 2024-10-02 so each is `dates[0]`); readable control; `audit-c20.test.ts` api control on readable dates | `npx vitest run "src/app/factsheet/[id]/v2/StressWindowsPanel.unreadable.test.tsx" src/lib/factsheet/audit-c20.test.ts ...` + tsc | `ternary_dropped` | ⬜ |
| 205-03 T2 | D-03 | `figure-parity-pages.test.tsx` > `205 D-03` api-arm curve with second point `2024-01-1`, flags null and BTC | `npx vitest run src/__tests__/figure-parity-pages.test.tsx` | `ternary_dropped` | ⬜ |
| 205-03 T3 | D-05 | `page.public-cache-key.test.tsx`, `page.cache-isolation.test.tsx` (hand-typed v23) | `npx vitest run "src/app/factsheet/[id]/v2/page.public-cache-key.test.tsx" "src/app/factsheet-share/[token]/page.cache-isolation.test.tsx"` + tsc | `key_left_v22` | ⬜ |

Correction to RESEARCH Pitfall 3 (planner, 2026-11-10): `Date.parse` rejects `2024-1-5` (NaN in this checkout); RESEARCH saw no throw because the old fixture sorted `2024-1-5` and `2024-02-30` into the interior. Plan 03 uses a fixture where all five dates are first, and the executor records the observed HEAD mode per date.

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] New cases in existing files only (`figure-parity-pages.test.tsx`, `StressWindowsPanel.unreadable.test.tsx`, a `deriveSeriesBundle` unit case)
- [ ] A readable-date helper in `audit-c20.test.ts` for the api-arm test

---

## Manual-Only Verifications

All phase behaviors have automated verification.

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 130s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
