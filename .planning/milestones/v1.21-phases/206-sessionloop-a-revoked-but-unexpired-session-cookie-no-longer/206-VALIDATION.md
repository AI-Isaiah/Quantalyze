---
phase: "206"
slug: "sessionloop-a-revoked-but-unexpired-session-cookie-no-longer"
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
# audit-milestone §5.5 distinguishes NOT-VALIDATED (draft) from PARTIAL (validated + nyquist_compliant: false) (#2117)
status: draft
nyquist_compliant: false
wave_0_complete: false
created: "2026-11-10"
---

# Phase 206 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest (`vitest run`) |
| **Config file** | `vitest.config.ts` (existing) |
| **Quick run command** | `npx vitest run src/proxy.test.ts` |
| **Full suite command** | `npx vitest run src/proxy.test.ts src/__tests__/role-home-call-sites.test.ts src/__tests__/check-route-contract.test.ts src/__tests__/trim-removed-surfaces.test.tsx` plus `npx tsc --noEmit -p .` and `npx eslint src/proxy.ts src/proxy.test.ts` |
| **Estimated runtime** | ~30 seconds (tsc dominates) |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run src/proxy.test.ts`
- **After every plan wave:** Run the full suite command
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 60 seconds

---

## Per-Task Verification Map

Filled by the plan (see `206-01-PLAN.md` task `<verify>` blocks). Baseline: `src/proxy.test.ts` 113 passed.

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 206-01-xx | 01 | 1 | D-01..D-05 | T-206-xx | Cookie holder with refused session renders public page, no redirect loop | unit + mutation proof | `npx vitest run src/proxy.test.ts` | ✅ (edit existing) | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Existing infrastructure covers all phase requirements.

---

## Manual-Only Verifications

All phase behaviors have automated verification. The neuter→RED→restore proof is a scripted procedure (byte backup in the session scratchpad, `shasum -a 256` before and after restore; never git checkout/restore/stash).

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 60s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
