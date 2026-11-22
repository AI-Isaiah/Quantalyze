---
phase: "157"
slug: "founder-confirm-the-observations-only-the-founder-can-make-are-made"
status: draft
nyquist_compliant: false
wave_0_complete: false
created: "2026-11-23"
---

# Phase 157 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Node built-in `node:test` + `node:assert` (no install). The repo's vitest suite is not touched. |
| **Config file** | none |
| **Quick run command** | `node --check .planning/phases/157-*/157-STAGING-KIT.js && node --test .planning/phases/157-*/157-STAGING-KIT.smoke.mjs` |
| **Full suite command** | quick run, plus the hygiene greps in 157-RESEARCH.md "Validation Architecture", plus the repo's `.planning`-reading checks (`npm run lint` planning-hygiene rules) |
| **Estimated runtime** | ~5 seconds (quick) |

---

## Sampling Rate

- **After every task commit:** Run the quick command
- **After every plan wave:** Run the full suite command
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 10 seconds

---

## Per-Task Verification Map

Filled by the planner per task; the requirement-to-test map is in 157-RESEARCH.md "Phase Requirements -> Test Map".

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 157-01-xx | 01 | 1 | FCONF-02, FCONF-03 | T-157-xx | matched writes never reach the network (fail closed) | node smoke | quick run | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `157-STAGING-KIT.js`: the kit, exposing its router under a test flag
- [ ] `157-STAGING-KIT.smoke.mjs`: the router run against canned Requests

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Resume banner, then Resume lands on the draft's step | FCONF-01 | founder observation by definition | 157-FOUNDER-SCRIPT.md |
| Amber recomputing block seen on the real wizard | FCONF-02 | founder observation | 157-FOUNDER-SCRIPT.md |
| Four 153.7 copy members seen; no Retry on SEAM_INTERNAL_FAULT | FCONF-03 | founder observation; copy and visual judgement | 157-FOUNDER-SCRIPT.md |
| MM2 investor password rotated; gate 1 re-read after a post-rotation sync | FCONF-04 | broker credential is the founder's; waits for 155.2's last live read | 157-FOUNDER-SCRIPT.md, rotation section |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 10s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
