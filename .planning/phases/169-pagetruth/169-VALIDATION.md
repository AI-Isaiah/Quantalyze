---
phase: "169"
slug: "pagetruth"
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
status: draft
nyquist_compliant: false
wave_0_complete: false
created: "2026-09-27"
---

# Phase 169 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution. Source: `169-RESEARCH.md` `## Validation Architecture` (regenerated 2026-09-27).

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest (`package.json`) |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `npx vitest run <touched test files>` |
| **Full suite command** | `npm test` plus `npx tsc --noEmit -p .` |
| **Estimated runtime** | ~30 seconds quick; full suite several minutes |

---

## Sampling Rate

- **After every task commit:** run the quick command for the touched files.
- **After every plan wave:** `npm test`, `npx tsc --noEmit -p .`, `npm run lint`, and the compute-once gate `npx vitest run src/lib/return-stats.single-source.test.ts`.
- **Before `/gsd-verify-work`:** full suite green.
- **Max feedback latency:** 60 seconds for the quick command.

---

## Per-Task Verification Map

Filled from the plans' `<automated>` commands at execution; the requirement-to-test map is in `169-RESEARCH.md` `### Phase Requirements → Test Map` (SC3, SC4, SC5, SC6, SC9, R1 RISKUNIT, R2 MONEYFMT, R3 composite read error). Every fix records neuter → RED → restore in its SUMMARY.

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

New test files are created by the plan that needs them (listed in `169-RESEARCH.md` `### Wave 0 Gaps`). No framework install needed.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Each changed page reads right in the logged-in account after deploy | SC9 | needs the deployed SHA and the real account | the phase's final plan: factsheet (single-key and composite), `/portfolios/[id]` risk attribution, `/allocations` Open Positions and Holdings; width checks at 390px (iPhone 12) and desktop 200% zoom, run by the orchestrator; no 320px check (founder rule 2026-09-27) |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 60s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
