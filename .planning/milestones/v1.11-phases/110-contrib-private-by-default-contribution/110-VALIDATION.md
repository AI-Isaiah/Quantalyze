---
phase: 110
slug: contrib-private-by-default-contribution
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-07-16
---

# Phase 110 — Validation Strategy

> Cross-owner isolation is the load-bearing safety property — test it at BOTH the RLS layer and the request-scoped query-builder layer.

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest (TS: overlay, finalize branch, browse query) + `supabase/tests/test_*.sql` (RLS cross-owner isolation) + eslint plugin test (lint rule) |
| **Config file** | `vitest.config.ts`, `tools/eslint-plugin-quantalyze/` |
| **Quick run command** | `npx vitest run src/components src/lib/visibility.ts src/app/api/strategies/browse --no-file-parallelism` |
| **Full suite command** | `npm run test && npm run lint` |
| **Estimated runtime** | ~2–6 min TS; SQL isolation test in CI against test project |

## Sampling Rate
- After every task commit: quick vitest for the touched area
- After every wave: full suite + lint
- Before verify: full suite green + the cross-owner RLS SQL test applied to the test project (qmnijlgmdhviwzwfyzlc)
- Max feedback latency: ~6 min

## Per-Task Verification Map (skeleton — planner fills IDs)

| Task | Requirement | Secure Behavior | Test Type | Command | Status |
|------|-------------|-----------------|-----------|---------|--------|
| status-check-mig | CONTRIB-02 | `'private'` added to status CHECK; contribution finalize writes `status='private'`, never `pending_review`/`published` | sql + unit | test-proj apply + finalize unit | ⬜ |
| private-finalize | CONTRIB-02 | allocator contribution → `status='private'`, `user_id`=session, no manager_status write, no publish | unit | vitest finalize branch | ⬜ |
| browse-owner-inclusive | CONTRIB-03 | `withPublishedOrOwner` returns owner's private + all published; userId from session only | unit | vitest browse query | ⬜ |
| cross-owner-isolation | CONTRIB-04 | non-owner NEVER sees owner's `private` row — RLS layer AND query-builder layer | sql + unit | `test_*.sql` + vitest | ⬜ |
| lint-backstop | CONTRIB-04 | `.or('...user_id...')` against admin client is a lint ERROR | eslint-test | plugin rule test | ⬜ |
| overlay | CONTRIB-01/05 | wizard mounts as overlay (no navigation); onSuccess/onClose parameterized (no bounce to /strategies); "Add a Strategy" launches it; Browse CTA launches it | unit | vitest overlay + nav | ⬜ |

## Wave 0 Requirements
- [ ] New `test_*.sql` cross-owner isolation (RLS): seed two owners, assert owner B cannot read owner A's `private` strategy
- [ ] New eslint plugin rule test (clone `no-raw-published-predicate` test)
- [ ] Framework present (vitest + supabase SQL + eslint plugin) — no install

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Instructions |
|----------|-------------|------------|--------------|
| Overlay opens inline (no navigation), KPI/CSV entry works, contribution appears private in Browse for owner only | CONTRIB-01/03/05 | Full wizard-in-overlay flow best confirmed live | After deploy: as allocator, click "Add a Strategy" → overlay opens (no URL change); complete CSV/API-key + KPIs; confirm it appears in composer Browse for you, and a second account never sees it |

## Validation Sign-Off
- [ ] Every task has an automated verify or a Wave 0 test
- [ ] Cross-owner isolation proven at BOTH layers
- [ ] Lint rule fails on the bad pattern
- [ ] `nyquist_compliant: true`

**Approval:** pending
