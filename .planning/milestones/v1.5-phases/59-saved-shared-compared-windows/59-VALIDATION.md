---
phase: 59
slug: saved-shared-compared-windows
status: populated
nyquist_compliant: true
wave_0_complete: false
created: 2026-07-02
---

# Phase 59 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest (unit/codec/route/component) + Supabase SQL tests (leak-scan) + Playwright (e2e a11y) |
| **Config file** | `vitest.config.ts` + `supabase/tests/` + `playwright.config.ts` |
| **Quick run command** | `npx vitest run <single-file>` |
| **Full suite command** | `npm run test:coverage` (full suite + BLOCKING coverage ratchet) + SQL leak-scan (CI) |
| **Estimated runtime** | ~seconds (vitest single-file); full suite + coverage minutes; SQL/e2e at wave boundaries |

---

## Sampling Rate

- **After every task commit:** the touched unit/route/codec/component test (`npx vitest run <file>`), < 60s.
- **After every plan wave:** `npm run test:coverage` (full suite + coverage gate); the leak-scan SQL test after the Plan 02 share-path change.
- **Before `/gsd:verify-work`:** full suite green + coverage above the blocking ratchet (lines 82 / statements 80 / functions 74 / branches 72); leak-scan green; the Phase-55 frozen-spine + BLEND-07 + PARITY-01 guards green (they anchor Phase 60's re-bake).
- **Max feedback latency:** < 60 seconds (unit); SQL/e2e at wave boundaries.

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 01-1 (RED) | 59-01 | 1 (W0) | PERSIST-01 | T-59-01 | v2 windowless draft decodes `ok` (NOT `reset`) + `reason: "upgraded_v2_windowless"`; corrupt-v2→reset; current+1→readonly; v3-with-window→ok(null) | unit (codec, RED-first) | `npx vitest run "src/app/(dashboard)/allocations/lib/scenario-state.test.ts"` | ✅ exists (add cases) | ⬜ pending |
| 01-2 (GREEN) | 59-01 | 1 | PERSIST-01 | T-59-01, T-59-02 | version bump 2→3 + non-destructive branch land TOGETHER; bounded-optional `window` zod field | unit (codec) | `npx vitest run "src/app/(dashboard)/allocations/lib/scenario-state.test.ts"` | ✅ exists | ⬜ pending |
| 01-3 | 59-01 | 1 | PERSIST-01 | — | v3 draft with window round-trips WHOLE through the save route (`schema_version: 3`, window not stripped) | route test | `npx vitest run "src/app/api/allocator/scenario/saved/route.test.ts"` | ✅ exists (extend) | ⬜ pending |
| 02-1 | 59-02 | 2 | PERSIST-01 | T-59-06, T-59-07 | reopen v3 seeds window from `draft.window` → recompute at saved window; upgraded-v2 → intersection + provenance note; ephemeral per-open dismissal (re-shows for another old draft) | unit (hydrate) + component | `npx vitest run "src/app/(dashboard)/allocations/hooks/useScenarioState.hydrate.test.tsx" "src/app/(dashboard)/allocations/components/ProvenanceNote.test.tsx"` | ✅ hydrate exists / ⚠️ ProvenanceNote.test.tsx NEW | ⬜ pending |
| 02-2 | 59-02 | 2 | PERSIST-02 | T-59-05 | recipient reads owner's `draft.window` VERBATIM → effective bounds == owner's; v2 shared draft resolves `ok` (not honest-absence); version-ahead fixture rebased 3→4 | unit | `npx vitest run "src/app/scenario-share/[token]/share-resolve.test.ts"` | ✅ exists (extend + rebase) | ⬜ pending |
| **02-3 (SECURITY-CRITICAL)** | 59-02 | 2 | **PERSIST-02 (no-leak)** | **T-59-04** | **window round-trips through `get_shared_scenario` AND the `api_key\|allocated_amount\|account_balance\|value_usd` over-return guard STILL holds (additive-only; negative guard NOT weakened)** | **SQL leak-scan** | **CI: `supabase/tests/test_scenario_shares_rls.sql` (ci.yml:770). Local proxy: `grep -c "api_key\|allocated_amount\|account_balance\|value_usd" supabase/tests/test_scenario_shares_rls.sql`** | ✅ exists (extend) | ⬜ pending |
| 03-1 | 59-03 | 2 | PERSIST-03 | T-59-08, T-59-09 | each column computes at its own `draft.window` POST-collapse (heterogeneous); live-book column stays windowless (union path, unchanged) | unit | `npx vitest run "src/app/(dashboard)/allocations/lib/scenario-compare.test.ts"` | ✅ exists (extend) | ⬜ pending |
| 03-2 | 59-03 | 2 | PERSIST-03 | T-59-10 | per-column `· {effective_start}–{effective_end}` label on `verdict.ok` columns (read from engine, not re-derived); suppressed on undecodable/below-floor | component | `npx vitest run "src/app/(dashboard)/allocations/components/ScenarioCompareTable.test.tsx"` | ✅ exists (extend) | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

**Security-critical row:** Task 02-3 (PERSIST-02 no-leak). The leak-scan SQL is the sole content-level
enforcement point for the shared payload — it must prove the window round-trips WITHOUT adding any
api_key / value_usd / holdings leak, keeping the existing negative guard byte-intact.

---

## Wave 0 Requirements

- [ ] **RED test (Plan 01, Task 1)** for the non-destructive v2→v3 codec branch — a v2 windowless draft
      decodes `ok` (window defaulted to intersection downstream + `reason: "upgraded_v2_windowless"`),
      NEVER `reset`. Must land BEFORE/WITH the `SCENARIO_SCHEMA_VERSION` bump — the bump alone is a
      data-loss bug. Confirmed RED against constant=2 before the GREEN task.
- [ ] **Version-ahead fixture rebase (Plan 01 Task 1 + Plan 02 Task 2):** `share-resolve.test.ts:93`
      RPC-row literal `schema_version: 3` → `4` (the inner `aheadDraft` already uses
      `SCENARIO_SCHEMA_VERSION + 1`, self-adjusting). Codec test: assert current+1 (==4) still `readonly`.
- [ ] **Leak-scan seed + assertion (Plan 02 Task 3):** seed one scenario whose draft carries a `window`;
      add a positive round-trip assertion; keep the negative over-return guard intact.
- [ ] **ProvenanceNote.test.tsx (Plan 02 Task 1):** NEW test file for the ephemeral-dismissal-recurs
      behavior (Claude's-discretion resolved to a thin `ProvenanceNote.tsx` wrapper, not a new prop on
      DefaultChangeNote — keeps the POLISH-03 localStorage dismissal untouched).
- Framework install: none — vitest + SQL-test CI + Playwright already present.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Recipient share view recomputes at owner's window live (authed prod round-trip) | PERSIST-02 | Full authed prod round-trip through the SECDEF RPC | Deferred to Phase 61 authed canary (VERIFY-02) |

*Most phase behaviors have automated verification (codec / route / SQL / component / e2e-a11y).*

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify (every task has one)
- [x] Wave 0 covers the non-destructive-upgrade RED test + the version-ahead fixture rebase
- [x] No watch-mode flags (all `vitest run`, non-watch)
- [x] Feedback latency < 60s (single-file vitest per task)
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** populated by planner 2026-07-02
