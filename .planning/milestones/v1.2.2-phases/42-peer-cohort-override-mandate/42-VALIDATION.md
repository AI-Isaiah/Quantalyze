---
phase: 42
slug: peer-cohort-override-mandate
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-06-26
---

# Phase 42 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest (jsdom + node) + @testing-library/react; live-DB RLS tests gated on `HAS_LIVE_DB` |
| **Config file** | `vitest.config.ts` (thresholds lines 82 / fns 74 / branches 72 / stmts 80) |
| **Quick run command** | `npx vitest run src/lib/factsheet/ "src/app/api/scenario/" "src/app/(dashboard)/allocations/" --no-file-parallelism` |
| **Full suite command** | `npm run test:coverage` (blocking CI gate) |
| **DB/RPC** | apply the migration to the TEST project via Supabase MCP `apply_migration`; prod auto via Supabase Migrate |

---

## Sampling Rate

- **Per task commit:** quick command on the touched dirs.
- **Per wave merge:** full suite + coverage ratchet.
- **Before verify:** full suite green + `tsc --noEmit` + the migration applied to TEST + RLS test green.

---

## Per-Task Verification Map

| Task | Wave | Requirement | Secure Behavior | Test | Command | Status |
|------|------|-------------|-----------------|------|---------|--------|
| RPC `get_verified_cohort_rank` migration | 1 | PEER-03 | aggregate-only, min-N=20, identity-stripped, REVOKE PUBLIC + auth.role() gate + SET search_path | live RLS | apply to TEST + `strategy-verifications-rls`-style test (no cross-tenant leak; <20 → empty) | ⬜ |
| `scenarioPeer` type + gate + panel | 2 | PEER-01 | csv arm only; never flip ingestSource; gate api OR (scenarioMode&&scenarioPeer) | unit | audit-c20 REPLACEMENT (peer renders, 3 synth absent, ingestSource csv) | ⬜ |
| convention pin | 2 | PEER-02 | rank uses scenarioMetrics (sample/252), NOT payload.strategyMetrics (population) | unit | assert ranking metric == engine scenarioMetrics basis; reload-stable | ⬜ |
| POST /api/scenario/peer-rank route | 2 | PEER-03 | withAuth + assertProfileApproved + checkLimit + NO_STORE; returns rank+count only | route | auth gate (401), min-N empty, no cohort distribution in response | ⬜ |
| peer panel disclosure + n<252 suppress | 3 | PEER-02 | "hypothetical · ranked vs verified" + N; n<252 → suppressed | unit (jsdom) | render assertions | ⬜ |
| mandate chips | 3 | PEER-04 | per-constituent from available fields; honest-empty; NO aggregate | unit | render: chips present/empty per constituent | ⬜ |
| own-book delta | 3 | PEER-05 | delta not percentile; maxDD sign inverted; silent-absent when no book | unit | render: signed delta, +/− prefix | ⬜ |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] Migration `20260626NNNNNN_get_verified_cohort_rank.sql` (forward-dated > 20260625120000) — SECURITY DEFINER RPC: verified cohort (strategy_verifications.trust_tier present) joined to strategy_analytics, `status='published'` defense-in-depth predicate (exclude caller's drafts), min-N=20 → returns NULL/empty, identity-stripped (rank + count only), `SET search_path = ''`, `REVOKE EXECUTE ... FROM PUBLIC`, `auth.role()` gate, self-verifying DO block. Apply to TEST via MCP.
- [ ] RLS test (HAS_LIVE_DB): owner cannot read peers' metrics; the RPC returns only aggregate rank; <20 verified → empty.
- [ ] audit-c20 REPLACEMENT test (behavioral pin swapped; type-field invariant kept).
- [ ] Route handler test (auth 401, min-N empty, no-identity, no-store).
- [ ] convention pin (ranking metric basis == engine scenarioMetrics, not population headline).
- No framework install needed.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Authed live peer panel on a real blend | PEER-01..02 | needs authed Chromium + a real verified cohort ≥20 (likely below floor with no clients → suppresses honestly) | Phase 43 / post-deploy authed canary; CI proves structure + the suppression path |

---

## Security (threat model — see 42-RESEARCH.md §Security)

- Cross-tenant metric leak → aggregate-only + identity-stripped + min-N=20 (cell-size inference) + SECURITY DEFINER with `SET search_path=''` + REVOKE PUBLIC + auth.role() gate.
- ingestSource-flip trap → `scenarioPeer` on csv arm only; audit-c20 replacement pins the 3 synth panels absent.
- Convention bias → rank on the engine's sample/252 `scenarioMetrics`, matching the cohort's quantstats basis (pinned).
- CSRF / over-fetch → POST with the caller's own metrics only; NO_STORE; rate-limited; the cohort distribution never crosses the wire (flow a).
- Caller's own drafts polluting the cohort → explicit `status='published'` predicate (defense-in-depth vs the published-OR-owner RLS).
