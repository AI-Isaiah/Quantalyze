---
phase: "241"
slug: "democreds-the-two-demo-accounts-are-gone-and-their-passwords"
status: draft
nyquist_compliant: false
wave_0_complete: false
created: "2026-11-24"
---

# Phase 241 — Validation Strategy

> Per-phase validation contract. Derived from `241-RESEARCH.md` § Validation Architecture.
> No credential literal, login, PROD id or login hash appears in this file.

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest, plus `tsx scripts/check-demo-credential-digests.ts` chained into `npm run lint` |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `npx vitest run src/__tests__/check-demo-credential-digests.test.ts --testTimeout=120000` |
| **Full suite command** | `npm run lint` + the pre-push suite list in RESEARCH § Validation Architecture |
| **Estimated runtime** | ~20 s quick (whole-tree scan ~11-17 s under load) |

## Sampling Rate

- **After every task commit:** quick command + `npx tsx scripts/check-demo-credential-digests.ts`
- **After every plan wave:** `npm run lint`, pre-push suites, gitleaks range scan
- **Before `/gsd-verify-work`:** full set green, gitleaks range scan clean
- **Max feedback latency:** 120 s

## Per-Task Verification Map

| Req | Behavior | Test Type | Automated Command | File Exists | Status |
|-----|----------|-----------|-------------------|-------------|--------|
| SECR-02 | No tracked file matches any of the four digests; one named arm per role | unit + live tree | quick command | ❌ W0 | ⬜ pending |
| SECR-02 | Same verdict on docs-only events (lint link) | lint | `npx tsx scripts/check-demo-credential-digests.ts` | ❌ W0 | ⬜ pending |
| SECR-02 | e2e spec keeps env sourcing; no quoted credential assignment | unit | `npx vitest run src/__tests__/e2e-match-queue-no-vacuous-admin-gate.test.ts` | ✅ edited | ⬜ pending |
| SECR-02 | Diff carries no secret | scan | `gitleaks git . --no-banner --redact --config .gitleaks.toml --log-opts=origin/main..HEAD` | n/a | ⬜ pending |
| SECR-01 | Pair B absent on TEST and PROD (dated); Pair A present on PROD | read-only SQL | marker query, then count-only existence query | n/a | ⬜ pending |
| SECR-01 | Delete chain passes on a Pair-B-shaped lane fixture; bystanders untouched | lane rehearsal | `scripts/local-stack/run.sh up` + fixture + rehearsal arms | ❌ W0 | ⬜ pending |
| PROOF-01 | Guard RED on a planted literal (named arm first), byte restore, GREEN | neuter | RESEARCH § PROOF-01 steps 1-7 | n/a | ⬜ pending |

## Wave 0 Requirements

- [ ] `scripts/check-demo-credential-digests.ts`
- [ ] `src/__tests__/check-demo-credential-digests.test.ts`
- [ ] `npm ci` in the worktree; Docker daemon running for the lane
- [ ] Rehearsal fixture SQL + assertion script (literal-free, kept with phase records)

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Pair A password reset | SECR-01 (narrowed) | Founder-only credential action (ruling 2026-11-24) | Founder resets it and confirms the date; recorded as human_needed until then |
| PROD Pair B delete | SECR-01 | Gated PROD write; founder go required | Coordinator go on the exact statement list, then execute and re-measure |

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 120s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
