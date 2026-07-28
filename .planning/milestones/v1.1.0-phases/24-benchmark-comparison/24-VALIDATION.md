---
phase: 24
slug: benchmark-comparison
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-06-22
---

# Phase 24 — Validation Strategy

> Per-phase validation contract. Derived from 24-RESEARCH.md §Validation Architecture + §Security Domain. Active-return math + intersection alignment + empty-state honesty are the testable invariants.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest (TS unit/route/component) |
| **Config file** | `vitest.config.ts` (coverage gate: lines 82 / stmts 80 / fns 74 / branches 72) |
| **Quick run command** | `npx vitest run <touched test file(s)>` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~30 s quick |

---

## Sampling Rate

- **After every task commit:** `npx vitest run <touched test file(s)>` (< 30 s).
- **After every plan wave:** `npm test` + `npm run typecheck` + `npm run lint`.
- **Before verify:** full suite + coverage gate green.

---

## Per-Requirement Verification Map

| Req | Behavior | Test Type | Automated Command | File Exists |
|-----|----------|-----------|-------------------|-------------|
| BENCH-01 | TE / IR / alpha / beta computed over the INNER-JOIN window, 252-annualized; matches hand-computed goldens | math (vitest) | `npx vitest run src/app/(dashboard)/allocations/lib/scenario-benchmark.test.ts` | ❌ W0 |
| BENCH-01 | Intersection alignment (scenario daily-returns ∩ benchmark dates), NOT the scenario's zero-filled union; misaligned dates excluded | math (vitest) | same | ❌ W0 |
| BENCH-01 | Below 30-day overlap (or benchmark not covering window) → honest "Benchmark comparison unavailable" empty state (2 distinct bodies); never a mismatched-window comparison | component (vitest) | `npx vitest run <benchmark section component test>` | ❌ W0 |
| BENCH-01 | Any degenerate metric (null/non-finite) → em-dash "—", never a fabricated 0 | component (vitest) | same | ❌ W0 |
| BENCH-01 | New `portfolio_daily_returns` field is ADDITIVE — `scenario.test.ts` pins do not regress | math (vitest) | `npx vitest run src/lib/scenario.test.ts` | ✅ (no regress) |
| BENCH-01 | Benchmark GET route returns BTC `[{date,value}]` daily returns, cacheable, exposes NO tenant data, requires auth (RLS SELECT USING(true)) | route (vitest) | `npx vitest run <benchmark route test>` | ❌ W0 |

---

## Wave 0 Requirements

- [ ] `src/app/(dashboard)/allocations/lib/scenario-benchmark.ts` + `.test.ts` — pure intersection-align + TE/IR/alpha/beta (reusing `computeAlphaBeta`/`computeTrackingError` from `portfolio-stats.ts`), golden-tested.
- [ ] Benchmark series GET route + `.test.ts` — BTC daily returns, Cache-Control, auth, no tenant data.
- [ ] Benchmark-section component test — overlay toggle + metrics + the two honest empty states + em-dash.
- [ ] Extend `scenario.test.ts` / `scenario-compare.test.ts` for the additive `portfolio_daily_returns` field.
- [ ] No framework install — vitest already wired.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Benchmark overlay renders + toggles live; metrics read sensibly vs a known scenario | BENCH-01 | Visual/interactive | Post-deploy /qa on the Scenario tab: toggle BTC benchmark, confirm overlay + TE/IR/alpha/beta + honest empty state when overlap < 30d |

---

## Validation Sign-Off

- [ ] All BENCH-01 behaviors have automated verify or Wave 0 deps
- [ ] No 3 consecutive tasks without automated verify
- [ ] `nyquist_compliant: true` set when tests land

**Approval:** pending
