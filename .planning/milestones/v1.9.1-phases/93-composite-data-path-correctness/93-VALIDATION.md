---
phase: 93
slug: composite-data-path-correctness
status: approved
nyquist_compliant: true
wave_0_complete: true
created: 2026-07-11
---

# Phase 93 — Validation Strategy

> Per-phase validation contract. Derived from `93-RESEARCH.md` § "Validation
> Architecture". All three fixes are additive / persisted-preferred → existing
> composites + single-key stay byte-identical (parity pins are load-bearing).
> Offline where possible; the HARD-05 ccxt reconstruction + HARD-02 display
> branch carry a documented **non-blocking live corroboration gate** (Railway
> ccxt canary / preserved composite), NOT an offline blocker.

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | pytest 7.x (analytics-service) + vitest (frontend route/render/helper) |
| **Config file** | `analytics-service/pytest.ini` / `vitest.config.ts` |
| **Quick run** | `cd analytics-service && .venv/bin/python -m pytest tests/test_stitch_composite_job.py -x -q` + `npx vitest run src/lib/factsheet src/app/api/strategies/composite` |
| **Full suite** | `cd analytics-service && .venv/bin/python -m pytest -n auto --dist loadgroup -q` + `npx vitest run` |
| **Pinned venv** | Py3.12.13 + pandas 3.0.3 (local Py3.14 SIGSEGVs on pandas) |

## Sampling Rate
- After every task commit: the quick command for the touched layer.
- After every wave: full suite + parity set.
- Before verify-work: parity pins green (composite + single-key byte-identical).

## Per-Requirement Test Map

| Req | Test seam | Type |
|-----|-----------|------|
| HARD-02 | `set-members/route.test.ts` (pin FIRST member `window_start` VALUE, not just existence) + offline `handleContinue` mapping test + display-read regression | vitest |
| HARD-03 | stitch-persist test (`cumulative_method` in merged_flags, drop-stale) + `composite-read-path.test.ts` prefer-persisted-with-fallback + parity | pytest + vitest |
| HARD-05 | rejection-removed test (ccxt member no longer PERMANENT fail) + visible-DQ-degrade test + reconstruct fixture (offline) + no-CHECK verify | pytest |
| SC-4 | `test_composite_headline_parity.py`, `test_stitch_composite_job.py`, `test_golden_parity.py`, `test_metrics_parity.py`, `compositeAttribution.test.ts` | pytest + vitest |

## Manual-Only / Live Corroboration (non-blocking)

| Behavior | Req | Why | Gate |
|----------|-----|-----|------|
| ccxt (Bybit/OKX/Binance) composite reconstructs honestly on real keys | HARD-05 | Needs a real ccxt crawl | Railway ccxt canary — documented corroboration, mirrors SC-3 piece 3; does NOT block offline closure |
| First-key window survives in the live wizard | HARD-02 | Write path proven correct offline; the display branch needs the preserved live composite | Non-blocking; offline tests pin the contract |

## Wave 0
Existing infra covers all requirements — `test_stitch_composite_job.py`, `set-members/route.test.ts`, `composite-read-path.test.ts`, parity suite already exist. No new framework.

## Sign-Off
- [ ] Parity pins green (composite + single-key byte-identical)
- [ ] HARD-02/03/05 each have a regression test that fails without the fix
- [ ] No migration introduced (verified additive DQ-jsonb; no CHECK rejects new keys)
- [ ] Live corroboration gates documented as non-blocking

**Approval:** approved (autonomous, 2026-07-11)
