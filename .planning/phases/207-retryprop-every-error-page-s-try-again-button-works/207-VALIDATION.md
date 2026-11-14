---
phase: "207"
slug: "retryprop-every-error-page-s-try-again-button-works"
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
# audit-milestone §5.5 distinguishes NOT-VALIDATED (draft) from PARTIAL (validated + nyquist_compliant: false) (#2117)
status: draft
nyquist_compliant: false
wave_0_complete: false
created: "2026-11-14"
---

# Phase 207 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest + @testing-library/react (jsdom project) |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `npx vitest run src/__tests__/error-boundaries-retry.test.tsx --project jsdom` |
| **Full suite command** | `npx vitest run src/app src/__tests__/error-boundaries-retry.test.tsx --project jsdom && npx tsc --noEmit -p .` |
| **Estimated runtime** | ~45 seconds (tsc dominates) |

---

## Sampling Rate

- **After every task commit:** Run the quick run command
- **After every plan wave:** Run the full suite command
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 60 seconds

---

## Per-Task Verification Map

Filled by the planner per task. Each task maps to SC-1 (no `unstable_retry` under `src/app`) or SC-2
(every boundary, mounted in Next's real `ErrorBoundary`, calls `retry` on Try again), plus D-08 (the
new test goes RED when one boundary is reverted from a byte backup, then GREEN after restore).

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/__tests__/error-boundaries-retry.test.tsx` — covers SC-1 and SC-2 (verified design in 207-RESEARCH.md)

---

## Manual-Only Verifications

All phase behaviors have automated verification. (Not reproduced in a running app; the proof is
Next's own `ErrorBoundary` mounted in jsdom.)

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 60s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
