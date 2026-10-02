---
phase: 07
slug: demo-mode-purge
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-20
revised: 2026-04-20  # per VOICES-ACCEPTED f6 + gB2
---

# Phase 07 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Derived from `07-RESEARCH.md § Validation Architecture`.
>
> **Revision note (per VOICES-ACCEPTED f6):** The term "Wave 0" previously
> conflated two concepts — YAML `wave:` frontmatter (execution scheduling
> for `/gsd-execute-phase`) and the prose "Wave 0" (test-first TDD pattern
> within a plan). This file now uses **"TDD Red gate"** for the test-first
> pattern and reserves "Wave N" for the YAML scheduling field.
>
> **Revision note (per VOICES-ACCEPTED gB2):** Plan 07-06 moved from wave=4 → wave=1
> (parallel with 07-01). The task map below reflects the new wave numbering.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest (vitest.config.ts at project root) + pytest (analytics-service/) |
| **Config file** | `vitest.config.ts` + `analytics-service/pyproject.toml` |
| **Quick run command** | `npx vitest run --reporter=verbose <path-glob>` |
| **Full suite command** | `npx vitest run && (cd analytics-service && pytest -q)` |
| **Estimated runtime** | ~45s (vitest unit) + ~20s (pytest) |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run src/lib/queries.my-allocation.test.ts src/__tests__/seed-integrity.test.ts` (quick subset — <5s)
- **After every plan wave:** Run full Vitest suite; after Plan 07-02 waves, also run `pytest analytics-service/tests/test_equity_reconstruction.py`
- **Before `/gsd-verify-work`:** Full suite (Vitest + pytest) must be green
- **Max feedback latency:** 30 seconds (quick subset command)

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 07-01-* | 01 | 1 | PURGE-02 | T-07-V4 (RLS) | Owner-only SELECT on `allocator_equity_snapshots` | integration (SQL) | `npx vitest run src/__tests__/allocator-equity-rls.test.ts` | ❌ TDD Red gate | ⬜ pending |
| 07-06-* | 06 | 1 | PURGE-05 | — | `OnboardingWizard.handleComplete()` calls only `profiles.update()`, no portfolios/allocator_holdings insert | unit (mock Supabase) | `npx vitest run src/components/auth/OnboardingWizard.noseeed.test.tsx` | ❌ TDD Red gate | ⬜ pending |
| 07-06-* | 06 | 1 | PURGE-01, PURGE-06 | — | No authenticated code path imports `src/lib/demo.ts` constants; no migration co-occurs `ON auth.users` + seed INSERT (f4) | static scan (vitest) | `npx vitest run src/__tests__/seed-integrity.test.ts` | ✅ (extend) | ⬜ pending |
| 07-02-* | 02 | 2 | PURGE-02 | T-07-V5 (idempotency) | Reconstruction job idempotent; `ON CONFLICT (allocator_id, asof) DO NOTHING`; key-scoped per f1 | unit (pytest) | `pytest analytics-service/tests/test_equity_reconstruction.py` | ❌ TDD Red gate | ⬜ pending |
| 07-02-* | 02 | 2 | PURGE-02 | T-07-V10 | Env-gated live ccxt integration (Binance/OKX/Bybit) — skipped in default CI | integration (pytest env-gated) | `QUANTALYZE_LIVE_CCXT=1 pytest analytics-service/tests/test_equity_reconstruction_live.py` | ❌ TDD Red gate | ⬜ pending |
| 07-02-* | 02 | 2 | PURGE-02 | — | Test-DB integration: enqueue → render → assert charts have non-zero series (f5 + Grok f3) | integration (pytest env-gated) | `QUANTALYZE_INTEGRATION_DB=1 pytest analytics-service/tests/test_equity_reconstruction_integration.py` | ❌ TDD Red gate | ⬜ pending |
| 07-03-* | 03 | 3 | PURGE-02, PURGE-03 | — | `getMyAllocationDashboard` returns `equitySnapshots`, `snapshotCount`, `allKeysStale`, `equityDailyPoints` (f7), `minHistoryDepthMonths` (f9), `activeVenues` (f9) | unit (mock Supabase) | `npx vitest run src/lib/queries.my-allocation.test.ts` | ✅ (extend) | ⬜ pending |
| 07-03-* | 03 | 3 | PURGE-02 | — | `equitySnapshotsToDailyPoints` adapter (f7) — forward-fill gaps | unit (vitest) | `npx vitest run src/lib/allocation-helpers.equity-adapter.test.ts` | ❌ TDD Red gate | ⬜ pending |
| 07-03-* | 03 | 3 | PURGE-03 | — | KPI strip renders `—` when `snapshotCount < 30`; values when `>=30`; venue-specific copy when minHistoryDepthMonths < 3 (f9) | unit (RTL) | `npx vitest run src/app/\\(dashboard\\)/allocations/components/KpiStrip.warmup.test.tsx` | ❌ TDD Red gate | ⬜ pending |
| 07-03-* | 03 | 3 | PURGE-03 | — | `formatPercent(null)` returns `—` (verification-only per f8) | unit (vitest) | `npx vitest run src/lib/utils.test.ts` | ❌ TDD Red gate | ⬜ pending |
| 07-04-* | 04 | 4 | PURGE-07 | — | Tab defaults to `performance` when `?tab` absent or invalid; survives reload; back/forward re-renders correctly (f3) | unit (RTL + Next) | `npx vitest run src/app/\\(dashboard\\)/allocations/AllocationsTabs.test.tsx` | ❌ TDD Red gate | ⬜ pending |
| 07-04-* | 04 | 4 | PURGE-07 | T-07-24 | Widget gating: 18 strategy-composite widgets hidden when `strategies.length === 0` (f2); charts render non-zero from mocked snapshots (Grok f1) | unit (RTL) | `npx vitest run src/app/\\(dashboard\\)/allocations/AllocationDashboard.widget-gating.test.tsx` | ❌ TDD Red gate | ⬜ pending |
| 07-05-* | 05 | 5 | PURGE-04 | — | Empty state renders when `holdingsSummary.length === 0 && !hasSyncing`; inline sync banner when `hasSyncing` | unit (RTL) | `npx vitest run src/app/\\(dashboard\\)/allocations/EmptyState.test.tsx` | ❌ TDD Red gate | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*
*Exact task IDs resolved during planner output; plan-level granularity suffices until then.*

---

## TDD Red gate tests

Per VOICES-ACCEPTED f6: "TDD Red gate" replaces the ambiguous prose-level "Wave 0" terminology. These test files are authored FIRST in their respective plans (RED state) so the implementation task drives them to GREEN.

- [ ] `src/__tests__/allocator-equity-rls.test.ts` — RLS owner/admin/service_role checks for `allocator_equity_snapshots` (PURGE-02 T-07-V4)
- [ ] `analytics-service/tests/test_equity_reconstruction.py` — happy-path + idempotency + OKX 3-month terminus + CoinGecko fallback + per-venue `history_depth_months` (f9) + aggregate-across-keys (f1) (PURGE-02)
- [ ] `analytics-service/tests/test_equity_reconstruction_live.py` — env-gated live ccxt integration per venue (f5)
- [ ] `analytics-service/tests/test_equity_reconstruction_integration.py` — test-DB end-to-end render pipeline (f5 + Grok f3)
- [ ] `src/lib/allocation-helpers.equity-adapter.test.ts` — `equitySnapshotsToDailyPoints` happy / gap-forward-fill / warm-up (f7)
- [ ] `src/lib/utils.test.ts` — `formatPercent(null)` regression guard (f8)
- [ ] `src/app/(dashboard)/allocations/components/KpiStrip.warmup.test.tsx` — warm-up `—` rendering default + venue-specific (f9) (PURGE-03)
- [ ] `src/app/(dashboard)/allocations/AllocationsTabs.test.tsx` — tab default, invalid tab fallback, Scenario stub renders, back/forward re-render (f3) (PURGE-07)
- [ ] `src/app/(dashboard)/allocations/AllocationDashboard.widget-gating.test.tsx` — 18 widgets gated when strategies=[] (f2); non-zero series from mocked snapshots (Grok f1) (PURGE-07)
- [ ] `src/app/(dashboard)/allocations/EmptyState.test.tsx` — zero holdings → empty state; syncing → inline banner (PURGE-04)
- [ ] `src/components/auth/OnboardingWizard.noseeed.test.tsx` — handleComplete asserts only `profiles.update` called (PURGE-05)

Existing infrastructure extended:
- `src/__tests__/seed-integrity.test.ts` — extend with import-graph scan for PURGE-01/PURGE-06 + f4 migration co-occurrence audit
- `src/lib/queries.my-allocation.test.ts` — extend payload shape assertions for 9 new fields (incl. equityDailyPoints, minHistoryDepthMonths, activeVenues)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Full-history backfill runtime against a live Binance testnet key | PURGE-02 | Requires real exchange credentials + network access; not reproducible in CI | Run `/gsd-qa`: connect a Binance testnet key with ≥30 days of trade history; observe `reconstruct_allocator_history` job completes within 30min timeout; verify `allocator_equity_snapshots` has rows per day from first trade forward |
| CoinGecko fallback for a deposit-only alt token | PURGE-02 | Depends on CoinGecko availability; flaky in CI | Connect a key holding a token the exchange doesn't price directly; assert `source='coingecko_fallback'` rows appear in `allocator_equity_snapshots` |
| **Live value_usd spot-check against exchange UI (VOICES-ACCEPTED f9 / Grok f4)** | PURGE-02 | Requires real exchange account + visual compare to exchange dashboard | After Phase 07 ship: connect a test read-only API key to Binance AND to OKX; observe `allocator_equity_snapshots.value_usd` for the test allocator's latest row; confirm it matches (within 5%) the portfolio value shown in each exchange's own UI. Record result in 07-02-SUMMARY.md. |
| D-10 staleness blocker visual | PURGE-03 | Requires time-travel (set last_sync_at >24h ago) and visual regression | Run `/gsd-qa` with DB fixture that backdates `api_keys.last_sync_at`; verify KPI strip greys out + "Sync your keys" banner shows |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or TDD Red gate dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] TDD Red gate covers all MISSING references (11 new test files + 2 extensions — per VOICES-ACCEPTED revisions)
- [ ] No watch-mode flags (use `vitest run`, not `vitest`)
- [ ] Feedback latency < 30s (quick subset command)
- [ ] `nyquist_compliant: true` set in frontmatter after planner wires every task to this map

**Approval:** pending (post-revision)
