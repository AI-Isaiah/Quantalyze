---
phase: 63
slug: holdings-snapshot-fallback-engine-removal
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-07-03
---

# Phase 63 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest (TS) + psql SQL tests (supabase/tests) |
| **Config file** | vitest.config.ts |
| **Quick run command** | `npx vitest run <touched test files> --no-file-parallelism` |
| **Full suite command** | `npm test` (CI shards with --coverage; ratchet 82/80/74/72) |
| **Estimated runtime** | quick ~30-90s per file · full ~2.5 min local |
| **Type gate** | `npx tsc --noEmit` |
| **Lint gate** | `npm run lint` |

---

## Sampling Rate

- **After every deletion-stage commit:** run the touched test files + `npx tsc --noEmit` (deletions surface as compile errors first)
- **After every plan wave:** full `npm test` + GUARD-03 zero-diff assert (`git diff origin/main..HEAD -- src/lib/scenario.ts src/lib/scenario-window.ts` empty)
- **Before verify-work:** full suite green + coverage above ratchet (deletion phases can DROP coverage — watch functions/branches)
- **Max feedback latency:** ~120s (quick loop)

---

## Per-Task Verification Map

*(Canonical rows land in each PLAN.md `<automated>` field; every deletion stage is
pinned by the P61 verbatim-survivor suites + the stage's own repoint tests.)*

| Task | Requirement | Secure/Honest Behavior | Automated Command |
|------|-------------|------------------------|-------------------|
| composer call-site removal | ENGINE-01 | book path = per-key units only; blank = added-only | ScenarioComposer tests + tsc |
| compare legacy-path removal | ENGINE-02 | compare engine set series-space only; Atlas golden unmoved | scenario-compare tests |
| gate=false blank fallback | ENGINE-03 | blank composer + DSRC-02 note repointed (never silently unrendered) | composer gate=false block |
| queries.ts baseline repoint | ENGINE-04 pre-req | gate=false SSR baseline → emptyDefault (honest em-dash) | queries.my-allocation tests |
| dealias retirement | ENGINE-04 | no-alias assertion green BEFORE delete; avg-\|ρ\| honesty green | reviewed re-baseline commit + full suite |
| grep-guard | ENGINE-05 | `holding:` engine-unit-id ban (identifier-precise, not blanket) | new guard test red-on-reintroduction |
| GUARD-01 prod cleanup | GUARD-01 | 2 residue holders' rows gone; 0 gate=false holders remain | orchestrator Supabase MCP step (executor has NO MCP) |

---

## Wave 0 Requirements

Existing infrastructure covers all phase requirements — no new framework. The
ENGINE-05 guard mirrors the existing readFileSync source-scan guard class.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| GUARD-01 prod row deletion + 0-holders verification | GUARD-01 | prod DB write via Supabase MCP (executor lacks MCP) | orchestrator step; re-run input-doc grounding query |
| Purified surfaces live on authed prod | (canary) | prod auth | Phase 65 GUARD-04 by design |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] No watch-mode flags
- [ ] Feedback latency < 120s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
