---
phase: 69
slug: onboarding-ux-wizard-card-setup-guide
status: planned
nyquist_compliant: true
wave_0_complete: true
created: 2026-07-04
---

# Phase 69 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Full success-criterion → test → revert-proof mapping lives in `69-RESEARCH.md` §Validation Architecture.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest (frontend TS/RTL) |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `npx vitest run src/lib/closed-sets.test.ts "src/app/(marketing)/security/page.test.tsx"` |
| **Full suite command** | `npm run test` |
| **Estimated runtime** | ~2–5 s (targeted) / full suite per CI |

---

## Sampling Rate

- **After every task commit:** Run the targeted quick command for the touched test file.
- **After every plan wave:** Run the full frontend suite (`npm run test`).
- **Before `/gsd:verify-work`:** Full suite must be green (+ `npm run lint`, `tsc`).
- **Max feedback latency:** ~5 seconds (targeted) / CI for full.

---

## Per-Task Verification Map

*Populated by the planner from `69-01-PLAN.md` `<automated>` blocks. All four target test files pre-exist (no Wave 0 install). Success-criterion mapping and revert-proofs: `69-RESEARCH.md` §Validation Architecture — every SC has a concrete vitest/RTL assertion that FAILS when the wiring is reverted.*

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 69-01 T1 (wizard card + credentialLabels; SC-1-a/b/c/d) | 69-01 | 1 | UX-01 | RTL (extend) | `npx vitest run "src/app/(dashboard)/strategies/new/wizard/steps/ConnectKeyStep.test.tsx"` | ✅ | ⬜ pending |
| 69-01 T2 (deribit-readonly SubAnchor; SC-2-a/b) | 69-01 | 1 | UX-02 | RTL (extend) | `npx vitest run "src/app/(marketing)/security/page.test.tsx"` | ✅ | ⬜ pending |
| 69-01 T3 (UI_EXCHANGE_CODES flip + VerificationForm fix + pin inversion; SC-3-a/b/c + D-08 gate) | 69-01 | 1 | UX-01, UX-02 (SC-3) | unit + RTL (invert/extend) | `npx vitest run src/lib/closed-sets.test.ts src/components/landing/__tests__/VerificationSection.test.tsx src/__tests__/contracts/check-zod-db-check-parity.test.ts --no-file-parallelism` | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

*Existing infrastructure covers all phase requirements — all four target test files exist (`ConnectKeyStep.test.tsx`, `security/page.test.tsx`, `closed-sets.test.ts`, `VerificationSection.test.tsx`). No framework install, no Wave 0 stubs. `check-zod-db-check-parity.test.ts` serves unmodified as the D-08 funding-leak backstop.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Deribit card renders + selectable in the live wizard; `/security#deribit-readonly` scrolls to the guide | UX-01, UX-02 | Visual/interaction confirmation in-browser (post-ship /qa) | Open the strategy wizard → select Deribit → confirm Client ID/Secret labels + no passphrase field; open `/security#deribit-readonly` → confirm the anchor scrolls and `account:read` is listed |

*All assertable behaviors have automated verification; the above is the post-ship /qa visual confirmation only.*

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references (none — all test files exist)
- [x] No watch-mode flags (all commands use `vitest run`)
- [x] Feedback latency < 5s (targeted)
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** planner-filled 2026-07-04 (plan 69-01, single wave)
