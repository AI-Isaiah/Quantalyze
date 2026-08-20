---
phase: 126
slug: factsheet-connected-key-api-verified-factsheet-render-blocki
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-07-19
---

# Phase 126 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest (unit/component) + Playwright (e2e, seed-gated) |
| **Config file** | `vitest.config.ts` + `playwright.config.ts` |
| **Quick run command** | `npx vitest run app/strategy/[id]/VerificationBoundary.test.tsx` |
| **Full suite command** | `npm run test` (vitest sharded) + `npx playwright test e2e/sfox-badge.spec.ts` |
| **Estimated runtime** | ~90s vitest slice; e2e seed-gated (skips if `E2E_TEST_DB_CONFIGURED` unset) |

---

## Sampling Rate

- **After every task commit:** run the touched vitest file(s).
- **After every plan wave:** full vitest slice + `npx playwright test e2e/sfox-badge.spec.ts` (if seed DB configured; else note skip).
- **Before verify:** vitest green; e2e green locally OR explicitly CI-deferred to `e2e-seeded`.
- **Max feedback latency:** ~90s.

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 126-00-xx | 00 | 0 | FACTSHEET-01 | — | seeded repro pins the exact SSR throw line before any fix | manual-repro | dev server + seeded api_verified+sfox strategy render | ❌ W0 | ⬜ pending |
| 126-01-xx | 01 | 1 | FACTSHEET-01 | — | root-cause fix at source; genuine bug fixed (not suppressed) | unit | `npx vitest run app/strategy/[id]/VerificationBoundary.test.tsx` | ❌ W0 | ⬜ pending |
| 126-01-xx | 01 | 1 | FACTSHEET-01 | — | transient provenance failure degrades to honest state, whole page still renders (unstable_catchError boundary) | component | `npx vitest run app/strategy/[id]/VerificationBoundary.test.tsx` | ❌ W0 | ⬜ pending |
| 126-02-xx | 02 | 1 | FACTSHEET-01 | — | `<main>` landmark present on v1 /strategy/[id] → axe landmark-one-main passes | e2e-axe | `npx playwright test e2e/sfox-badge.spec.ts` | ❌ W0 | ⬜ pending |
| 126-03-xx | 03 | 2 | FACTSHEET-02 | — | sfox-badge spec green owner/allocator/admin + axe; wired BLOCKING into `frontend` aggregator (skipped=pass) | e2e+ci | `npx playwright test e2e/sfox-badge.spec.ts` + ci.yml `frontend` needs includes e2e-seeded | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] **Seeded local repro** (mandatory) — reproduce the exact `/strategy/[id]` SSR throw for the `api_verified`+connected-sfox-key strategy and record the throwing file:line. If the local seed DB / dev env cannot be configured in-session, state that explicitly and fall back to the research's static-analysis hypothesis (authed `user_notes`/`StrategyNoteCard` sidecar) — never claim the repro ran.
- [ ] `app/strategy/[id]/VerificationBoundary.test.tsx` — regression test that FAILS without the fix (degrade-not-throw).

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Seeded SSR throw repro | FACTSHEET-01 | needs dev server + seeded test DB (`E2E_TEST_DB_CONFIGURED`) | run dev server, visit the seeded sfox api_verified strategy as owner, capture the throw |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers the repro + regression test
- [ ] No watch-mode flags
- [ ] Feedback latency < 90s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
