---
phase: 126-factsheet-connected-key-api-verified-factsheet-render-blocki
verified: 2026-07-19T18:45:31Z
status: human_needed
score: 3/3 must-haves verified (code deliverables); FACTSHEET-02 green-proof CI-deferred
overrides_applied: 0
human_verification:
  - test: "Open the PR for gsd/v1.13-infra-worker-rebuild and confirm the `e2e-seeded` check goes GREEN (all 5 sfox-badge legs: owner edit-tag, owner factsheet badge+axe, allocator browse, admin non-owner badge, anon non-owner badge), and that the `frontend` aggregator reddens if it fails."
    expected: "`gh pr checks` shows e2e-seeded = pass and frontend = pass. This is the FACTSHEET-02 green-proof, deliberately CI-deferred by 126-03 (verify before FACTSHEET-02 is marked satisfied)."
    why_human: "No PR exists yet; the blocking e2e-seeded job runs against the TEST project in CI and cannot be executed from this verification context (TEST creds are GH secrets). The wiring is verified; only the live green run is outstanding."
  - test: "Confirm migration 20260719140000_get_published_trust_signals.sql is applied to the TEST project qmnijlgmdhviwzwfyzlc BEFORE the e2e-seeded job runs, and will auto-apply to PROD (khslejtfbuezsmvmtsdn) on merge to main."
    expected: "`get_published_trust_signals(uuid[])` exists on TEST (SECURITY DEFINER, anon EXECUTE). Without it, the RPC in readPublicVerificationSignals errors -> fail-soft null tier -> the anon/admin non-owner badge legs FAIL RED (the gate cannot false-green). Prod auto-apply is standard founder-watched."
    why_human: "Cannot query the TEST project from here (linked CLI points at PROD; TEST creds are secrets). The post-126-04 app code depends on this RPC existing on TEST for the e2e to pass."
---

# Phase 126: FACTSHEET — connected-key api_verified factsheet render + blocking e2e — Verification Report

**Phase Goal:** `/strategy/[id]` factsheet renders (or degrades gracefully with an honest state) for an `api_verified` + api_key-linked sFOX strategy, proven by a BLOCKING e2e gate.
**Verified:** 2026-07-19T18:45:31Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

The phase was RE-SCOPED mid-flight: the Wave 0 seeded repro (ran against TEST `qmnijlgmdhviwzwfyzlc` on an isolated port-3100 harness, all temp reverted) DISPROVED the original SSR-throw premise — `/strategy/[id]` returns HTTP 200, it never threw. The real defect was that the `api_verified` badge was invisible to every NON-OWNER viewer (anon public + admin), because `strategy_verifications` has no public/published SELECT policy, so the RLS-scoped verification embed returned 0 rows for non-owners → `trust_tier=null` → the badge silently vanished. This re-scope is documented, coherent, and the delivered fix addresses the ACTUAL root cause at source.

### Observable Truths

| # | Truth (ROADMAP Success Criteria) | Status | Evidence |
|---|----------------------------------|--------|----------|
| 1 | The factsheet render path is ROOT-CAUSED via a seeded local repro and fixed at the source — never suppressed or worked around (FACTSHEET-01). | ✓ VERIFIED | 126-01-SUMMARY documents a live seeded repro on TEST (isolated dev server port 3100, `.next-repro` distDir, all temp reverted). Classified GENUINELY-WRONG (HTTP 200, no throw; H1–H4 throw theories refuted). Root cause pinned to the RLS layer feeding `getPublicStrategyDetail` (no public SELECT policy on `strategy_verifications`). Fixed at SOURCE: 126-01 service-role projection → 126-04 hardened to a correct-by-construction DB primitive `get_published_trust_signals` (migration `20260719140000`); `<main>` landmark added to fix the owner-leg axe defect. Not suppression — the badge is now EXPOSED to non-owners via a published-gated primitive. |
| 2 | `/strategy/[id]` renders — or degrades gracefully with an honest state — with a regression test proving degrade-not-throw (FACTSHEET-01). | ✓ VERIFIED | Page returns 200; badge renders for non-owners via `readPublicVerificationSignals` → RPC. Fail-soft honest degradation: read error → `captureToSentry(warning)` → empty map → `trust_tier=null` → badge hides → page still 200; never invents a tier (no-invented-data). Regression tests explicit & passing: `queries.public-verification.test.ts:175` (RPC error → empty map, page renders), `:227` (verification read error leaves tier null without failing the page), `:190` (non-owner sees tier even with no RLS embed). 35/35 tests pass locally on this branch. |
| 3 | `e2e/sfox-badge.spec.ts` is GREEN across all roles incl. axe AND wired into the BLOCKING `frontend` branch-protection gate — no longer advisory (FACTSHEET-02). | ✓ VERIFIED (wiring) / ⏳ green-proof CI-deferred (human) | WIRING VERIFIED: `e2e-seeded` is in the `frontend` aggregator `needs:` (ci.yml:648); skipped-as-pass is scoped to the e2e-seeded row ONLY (ci.yml:664-671), all other rows strict; anti-tamper grep guard (ci.yml:1436-1461) asserts the 3 load-bearing anchors — all present in the spec: anon leg (`:195`), admin leg (`:173`), owner axe `violations).toEqual([])` (`:150`); spec is in the explicit run list (ci.yml:1515). The gate is genuinely blocking and cannot false-green. GREEN-PROOF: CI-deferred (no PR yet) — routed to human verification. |

**Score:** 3/3 code deliverables verified. FACTSHEET-02's live green-proof is CI-deferred (human item), consistent with 126-03's documented plan.

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `supabase/migrations/20260719140000_get_published_trust_signals.sql` | Published-gated, column-scoped SECDEF trust-signal primitive; table stays owner-locked | ✓ VERIFIED | RETURNS TABLE `(strategy_id, trust_tier, status)` = column allow-list; `WHERE s.status='published'` = published-gate; SECURITY DEFINER + pinned `search_path=public, pg_temp`; `REVOKE ALL FROM PUBLIC` + `GRANT EXECUTE TO anon, authenticated, service_role`; no RLS widening on `strategy_verifications`. Self-verifying DO block asserts structure + behavioral published-gate (rolled-back seed). Application to TEST/PROD is a human item. |
| `src/lib/queries.ts` `readPublicVerificationSignals` | Single typed public-signal reader routing through the RPC (no admin client) | ✓ VERIFIED | Calls `supabase.rpc("get_published_trust_signals", {p_strategy_ids})` via a normal server client (queries.ts:336). Fail-soft on error/exception. Consumed by `getPublicStrategyDetail` (:401), `getStrategiesByCategory` (:235), `getStrategyDetail` (:544), and `/factsheet/[id]/v2`. |
| `src/app/api/strategies/[id]/returns/route.ts` | Repointed off owner-only RLS embed → non-owner tier correct | ✓ VERIFIED | Imports + calls `readPublicVerificationSignals([id])` (:265). `strategy_verifications` now only appears in explanatory comments — no live embed. |
| `src/app/(dashboard)/allocations/lib/watchlist-read.ts` | Repointed off owner-only RLS embed | ✓ VERIFIED | Imports + calls `readPublicVerificationSignals(...)` (:122). `strategy_verifications` only in comments — no live embed. |
| `src/app/strategy/[id]/page.tsx` `<main>` landmark | Exactly one `<main>` (page-body, not layout — avoids v2 double-main) | ✓ VERIFIED | Single `<main className="min-h-screen bg-page">` (:126–225) with comment explaining v2 renders its own `<main>` via StrategyV2Shell. Fixes the owner-leg axe failure. |
| `e2e/sfox-badge.spec.ts` | Non-owner (anon+admin) badge-visible legs + owner axe | ✓ VERIFIED | 5 legs: owner edit-tag, owner factsheet badge+axe, allocator browse, admin non-owner tier, anon non-owner badge. Anti-mask net = the anon+admin non-owner legs. |
| `.github/workflows/ci.yml` | e2e-seeded wired BLOCKING into frontend + anti-tamper guard | ✓ VERIFIED | See Truth 3 evidence. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|----|--------|---------|
| `readPublicVerificationSignals` | `get_published_trust_signals` RPC | `supabase.rpc(...)` | ✓ WIRED | queries.ts:336; result mapped to `{trust_tier, status}` (:350-361). |
| `getPublicStrategyDetail`/`getStrategyDetail`/`getStrategiesByCategory`/factsheet v2 | `readPublicVerificationSignals` | direct call | ✓ WIRED | 6 call sites confirmed by grep, all non-test. |
| returns route + watchlist-read | `readPublicVerificationSignals` | direct call | ✓ WIRED | Repointed off RLS embeds. |
| `frontend` aggregator | `e2e-seeded` job | `needs:` + result-loop with scoped skipped-as-pass | ✓ WIRED | ci.yml:648, 661-671; anti-tamper guard 1436-1461. |
| `e2e/sfox-badge.spec.ts` | `/strategy/[id]` authed SSR render | `page.goto('/strategy/...')` | ✓ WIRED | Spec in explicit run list (ci.yml:1515). |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| factsheet badge (VerifiedBadge/TrustTierLabel) | `strategy.trust_tier` | `readPublicVerificationSignals` → `get_published_trust_signals` RPC (published-gated DB read) | Yes for published api_verified (needs migration on TEST for the e2e run) | ✓ FLOWING (real DB primitive; not static/hardcoded) — live TEST confirmation is a human item |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Regression suite (public-verification, returns route, watchlist-read) | `vitest run` on the 3 files | 3 files / 35 tests passed | ✓ PASS |
| Non-owner badge visibility e2e | Playwright (needs seed env + TEST) | Cannot run here (seed env absent) | ? SKIP → human |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| FACTSHEET-01 | 126-01, 126-04 | Factsheet renders/degrades for api_verified sFOX strategy; connected-key provenance no longer throws | ✓ SATISFIED | Root-caused via seeded repro, fixed at source (DB primitive + `<main>`), regression tests RED-proven & passing. |
| FACTSHEET-02 | 126-03 | sfox-badge.spec.ts GREEN all roles incl. axe, wired into blocking `frontend` gate | ⏳ NEEDS HUMAN (CI) | Blocking wiring + anti-tamper guard VERIFIED; live green-proof CI-deferred (no PR yet). |

No orphaned Phase-126 requirements (REQUIREMENTS.md maps only FACTSHEET-01/02; both claimed by plans).

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| — | — | None | — | No TODO/FIXME/XXX/HACK/PLACEHOLDER in changed source files; no suppression (fail-soft is honest degradation, not a swallowed throw); `strategy_verifications` refs in returns/watchlist are comments only. |

### Human Verification Required

1. **e2e-seeded green-proof at the blocking gate** — Open the PR for `gsd/v1.13-infra-worker-rebuild`; confirm `e2e-seeded` passes (5 sfox-badge legs) and `frontend` is green. This is the FACTSHEET-02 green-proof, deliberately CI-deferred by 126-03. The gate is blocking + tamper-resistant, so it cannot false-green — it either passes or reddens.
2. **Migration on TEST (and prod auto-apply)** — Confirm `20260719140000` is applied to TEST `qmnijlgmdhviwzwfyzlc` before the e2e runs (the post-126-04 code depends on the RPC existing there) and will auto-apply to PROD on merge (founder-watched).

### Gaps Summary

No code gaps. All three ROADMAP success criteria are met at the deliverable level: (1) genuine seeded root-cause + source fix (not suppression), (2) honest fail-soft degradation with passing degrade-not-throw regression tests, (3) the e2e is wired BLOCKING into the `frontend` aggregator with correct skipped-as-pass scoping and a functioning anti-tamper guard. The only outstanding items are the CI green-proof and the TEST-migration confirmation — both legitimate, documented deferrals that surface at PR/merge time and cannot false-green the gate. Status is `human_needed` (not `gaps_found`) accordingly.

---

_Verified: 2026-07-19T18:45:31Z_
_Verifier: Claude (gsd-verifier)_
