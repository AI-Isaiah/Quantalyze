---
phase: 44
slug: foundation-primitives-verification-gates
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-06-27
---

# Phase 44 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest (unit) + Playwright (e2e) |
| **Config file** | `vitest.config.ts` / `playwright.config.ts` |
| **Quick run command** | `npx vitest run <touched test file>` |
| **Full suite command** | `npm run test:coverage` (ratchet: lines 82 / stmts 80 / fns 74 / branches 72) |
| **Estimated runtime** | unit ~5–30s per file; full coverage suite ~minutes |

---

## Sampling Rate

- **After every task commit:** Run the touched unit test (`npx vitest run <file>`)
- **After every plan wave:** Run `npm run test:coverage`
- **Before `/gsd:verify-work`:** Full suite green + coverage ratchet held un-lowered
- **Max feedback latency:** ~30s per task

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| (planner fills) | | | A11Y-02 | — | N/A | unit/e2e | | | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- Existing infrastructure covers all phase requirements (vitest + Playwright already configured). New primitives add their own unit tests; new gates add their own specs.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Confirm each new e2e gate ACTUALLY ran in a real CI run (FLOW-01) | A11Y-02 | A gate added but never executed is a false-green; only a CI run proves wiring | After CI, inspect the e2e job log for the reflow/target-size spec names in the executed list |

*If none: "All phase behaviors have automated verification."*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
