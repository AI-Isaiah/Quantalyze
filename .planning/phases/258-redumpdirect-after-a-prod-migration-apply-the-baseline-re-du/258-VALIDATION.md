---
phase: "258"
slug: "redumpdirect-after-a-prod-migration-apply-the-baseline-re-du"
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
status: draft
nyquist_compliant: false
wave_0_complete: false
created: "2026-11-27"
---

# Phase 258 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution. The per-criterion map, the neuter table and the Wave 0 gaps are in `258-RESEARCH.md` `## Validation Architecture`; this file is the contract that points at them.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest (wiring suites) + the script's own `--self-test` |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `node scripts/baseline-redump.mjs --self-test` |
| **Full suite command** | `npx vitest run src/__tests__/baseline-redump-wiring.test.ts src/__tests__/supabase-migrate-test-first.test.ts src/__tests__/critical-regressions.test.ts src/__tests__/contracts/ghcr-login-before-image-pull.contract.test.ts` |
| **Estimated runtime** | ~35 seconds (self-test), ~2-4 minutes (vitest files) |

---

## Sampling Rate

- **After every task commit:** Run `node scripts/baseline-redump.mjs --self-test`, plus `actionlint .github/workflows/supabase-migrate.yml` for workflow edits
- **After every plan wave:** Run the full suite command, then the adjacent six files listed in RESEARCH
- **Before `/gsd-verify-work`:** Full suite must be green, and `--self-test --with-gitleaks` green
- **Max feedback latency:** 240 seconds

---

## Per-Task Verification Map

Filled by the planner per task; every task carries an `<automated>` command with a `<fails_when>`. Success-criterion map: `258-RESEARCH.md` `### Phase Requirements to Test Map`.

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `node_modules` available in the worktree (symlink or `npm ci`)
- [ ] GREEN baseline of the four wiring files recorded before edits
- [ ] New self-test arms and retargeted wiring pins written in the same commits as the code they pin

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| A real re-dump is pushed straight to `main` | SC-1 | needs a real PROD apply or a dispatch on `main` after merge | after merge: a `workflow_dispatch` of `supabase-migrate.yml` on `main` with a stale baseline, or the next migration merge; read the `redump-push` job log and `git log origin/main` for one bot commit with the six paths |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 240s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
