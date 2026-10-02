---
phase: 20-mt5-ea-daily-returns-ingestion-approach-a
status: human_needed
verified: 2026-06-14
gate: T14/T15 manual demo-account reconcile (EA-runtime correctness — no CI harness)
---

# Phase 20 Verification — MT5 EA daily-returns ingestion (Approach A)

**Status: human_needed** — all 3 plans executed; CI-verifiable must-haves PASS; the
EA-runtime correctness (T14/T15) is gated on a one-time manual demo-account reconcile
that cannot run in CI (MQL5 under Wine, no harness) and gates *first-live-KPI trust*,
not phase CI completion.

## CI-verified (PASS)
- **T1–T13** golden-fixture ingestion/KPI tests green: `pytest tests/test_mt5_golden_fixtures.py` → 16 passed; full analytics-service suite 2634 passed @ 88.33% coverage (≥80% gate held). Oracles derived fresh from the live `compute_all_metrics`@252 on DENSE calendar-daily series (T2 deposit-day = trading return not cash-spike; T5 gap@252; T7 auto-÷100 boundary-bracket falsifiable; T9 EUR hard-fail).
- **T16** read-only CI static-check added to `.github/workflows/ci.yml`: scans `tools/mt5/**/*.{mq5,mqh}` recursively, denies low-level + CTrade-method + decl trade-mutation tokens; proven to PASS on the real EA and FAIL on synthetic `OrderSendAsync(`/`exec.Buy(` fixtures. EA re-verified read-only (incl. comments — CI grep is comment-blind).
- **No production-service changes**; annualization basis unchanged (252, product-wide); no new packages.

## Adversarial review trail
- Plan red-team (fresh context) found **C1** (calendar/annualization) → folded; user domain-correction (venues trade 365 days) → corrected to dense @ existing-252 (comparability-preserving); final GO verifier confirmed comparability code-verified.
- Post-implementation EA code review found **3 HIGH** money-path bugs CI can't catch (inception-date off-by-one, close-timing drift, multi-day-outage zero-fabrication) + MED-1 (credit field) → all root-cause fixed (commit `984430d3`); OnTimer logic re-verified by orchestrator.

## HUMAN-PENDING (gates first-live-KPI, NOT phase CI completion)
- **T14** — demo-account numeric reconcile: run the EA on a demo account through the README §"T14 worksheet" sequence (Day1 deposit → Day2 overnight → Day3 withdrawal → Day4 kill+relaunch+sleep), reconcile the EA's `daily_return` rows against MT5 history within ±ε. This is the ONLY real test of the MQL5 balance-deal classification (E5) and restart-state (A1).
- **T15** — restart-state: kill+relaunch the terminal between two days; confirm the next day's return uses the persisted `prior_close_equity`, not a fresh base.

## Commits (branch feat/phase-20-mt5-ea-ingestion)
3c7e1310, 2151f763, 9ff7271a (20-01) · 30cb1fc5, d85789cf, a0de8fc4 (20-02) · 7e62234d, 4c837246 (20-03) · 984430d3 (20-02 review fixes)
