---
phase: 139-mt5golive-gateway-soak-flip
plan: 01
subsystem: analytics-ops
tags: [mt5, soak, parity, reconciliation, go-live, secret-hygiene, offline-test, MT5GOLIVE-02]

# Dependency graph
requires:
  - phase: 134-mt5-spike
    provides: "scripts/mt5_spike.py run_spike (4-leg connectivity harness) + _default_client_factory + the MT5_SPIKE_* env contract + the client_factory injectable seam"
  - phase: 136-mt5-recon
    provides: "services/broker_dailies.py combine_mt5_deal_ledger (the shipped deal-ledger→(returns,meta) combiner), mt5_deals classify_deal/deal_cash_effect/deal_utc_day allow-list, the forward-NAV-roll reconciliation + max($1,1e-6·|equity|) tolerance"
  - phase: 70-deribit-groundtruth
    provides: "scripts/deribit_ground_truth.py sanitize_evidence / assert_sanitized / _redact_secret_values / ScopeViolationError single-definition secret primitives"
provides:
  - "scripts/mt5_soak.py — the founder-runnable soak/parity runner composing run_spike (134) + combine_mt5_deal_ledger (136) + forward-NAV roll + sanitized append-to-log"
  - "reconcile_parity(): balance-anchored forward-roll vs live equity at the 136-03 tolerance, fail-loud (error≠empty, empty=INCONCLUSIVE, classification propagates)"
  - "run_soak() / main() with client_factory + utc_now injectable seams (zero-network offline path)"
  - "docs/mt5-spike-gonogo.md '## Soak log (MT5GOLIVE-02)' section (invocation + window rule + per-day human_needed table + pass rule)"
affects: [139-02, 139-03]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Compose-not-reinvent: the soak imports run_spike / combine_mt5_deal_ledger / sanitize primitives — no bespoke parity calc, no re-implemented sanitizer, no new trade surface"
    - "Balance-anchored reconstruction initial (balance − Σpnl − Σflows) so |reconstructed − equity| is NOT a vacuous self-referential identity — the negative control has real teeth"
    - "Injectable client_factory + utc_now seams (mt5_spike precedent) keep the whole suite offline (no mt5linux, no network)"

key-files:
  created:
    - analytics-service/scripts/mt5_soak.py
    - analytics-service/tests/test_mt5_soak.py
  modified:
    - analytics-service/docs/mt5-spike-gonogo.md

key-decisions:
  - "Reconstruction initial anchors to BALANCE, not equity (plan said equity). reconstruct_nav_and_twr anchors the realized terminal to anchor_nav − open_unrealized_usd == balance (nav_twr.py:800), so an equity-derived initial makes |reconstructed − equity| a mathematical identity (~0) with no teeth — the self-referential-oracle anti-pattern. Balance anchor keeps the gate honest and reddens a $2 unexplained equity drift."
  - "reconcile_parity catches ONLY Mt5ClientError (→ observation=error, parity_ok=None); Mt5DealClassificationError (a ValueError) is NOT caught so an ambiguous DEAL_TYPE propagates fail-loud (Test 5). Generic exceptions also propagate (fail loud)."
  - "Empty ledger AND no-interpretable-return ledger (deposit-only) both → observation=honest_empty, parity_ok=None (INCONCLUSIVE) — a zero-track-record run can never read green."
  - "Soak-only env is MT5_SOAK_SERVER_OFFSET_MIN ([ASSUMED A2] until founder-confirmed from leg 4 / VNC clock) + MT5_SOAK_LOG_DIR; the credential contract reuses MT5_SPIKE_* verbatim (no new credential vars)."
  - "main() exit 0 ONLY when parity_ok is True AND spike verdict != NO-GO; parity breach / INCONCLUSIVE / error all exit 1."

patterns-established:
  - "Pattern: a go-live ops verifier that COMPOSES offline-proven upstream pieces + appends one sanitized record per run, with all live seams injected so the whole thing is offline-testable and the live run is a separate human_needed checkpoint"

requirements-completed: [MT5GOLIVE-02]

# Metrics
duration: ~25min
completed: 2026-07-24
---

# Phase 139 Plan 01: MT5 go-live soak/parity runner Summary

**`scripts/mt5_soak.py` is the founder's daily go-live verifier — it composes the 134 spike legs (`run_spike`) with the 136 reconciliation (`combine_mt5_deal_ledger` + a forward-NAV roll) to prove reconstructed-equity-vs-live-`account_info().equity` parity at the exact 136-03 tolerance on the real account, fail-loud and secret-sanitized, with all live seams injected so 13 offline tests run with zero network — and the go/no-go doc now carries the per-day soak-log section the founder fills, unfilled cells reading `human_needed`.**

## Performance

- **Duration:** ~25 min
- **Started:** 2026-07-24
- **Completed:** 2026-07-24
- **Tasks:** 2 completed
- **Files:** 2 created, 1 modified

## Accomplishments
- `reconcile_parity()` logs in → reads the equity+balance anchor → `history_deals_get(window)` → `combine_mt5_deal_ledger` → forward-rolls `NAV_t = NAV_{t-1}·(1+r_t) + F_t` from a **balance-anchored** initial → `parity_ok` iff `|reconstructed − equity| ≤ max($1, 1e-6·|equity|)`. Records equity/balance/upnl_wedge/deal_count/reconstructed/tolerance/residual + combine meta flags.
- Fail-loud honesty end to end: an `Mt5ClientError` read → `observation="error"`, `parity_ok=None` (never an empty ledger); an empty or deposit-only ledger → `observation="honest_empty"`, `parity_ok=None` (INCONCLUSIVE, never green); an unclassifiable DEAL_TYPE propagates `Mt5DealClassificationError`.
- `run_soak()` composes `run_spike` (legs 1–4) + the parity verdict + `soak_run_at`; `main()` sanitizes the whole record before any write, appends one `mt5-soak-<UTC-date>.json`, prints the summary, and exits 0 only on a genuine PASS.
- Appended the `## Soak log (MT5GOLIVE-02)` section to the go/no-go doc: invocation (MT5_SPIKE_* verbatim + the two soak knobs), the 5–10 business-day [ASSUMED A5] window rule (soak = the terminal-self-update parity-break detector), a per-day `human_needed` table, the never-green-on-empty pass rule, and the folded 136-05 / WR-03 live confirmations. Existing sections byte-unchanged.
- Full analytics regression suite green (4413 passed, 96 skipped) — no collateral.

## Task Commits

1. **Task 1 (TDD): offline-proven soak/parity runner** - `c3b05cd8` (feat) — `scripts/mt5_soak.py` + `tests/test_mt5_soak.py` (13 behaviors)
2. **Task 2: soak-log doc section + full-suite regression gate** - `d2fdb81d` (docs)

## Files Created/Modified
- `analytics-service/scripts/mt5_soak.py` (created, ~380 lines) — `reconcile_parity` / `run_soak` / `main`, composing run_spike + combine_mt5_deal_ledger + mt5_deals allow-list + deribit sanitize primitives; balance-anchored forward roll; injectable client_factory + utc_now.
- `analytics-service/tests/test_mt5_soak.py` (created, ~350 lines) — 13 offline cases: parity green, $2 negative control (verdict + non-zero exit), fail-loud read (code preserved, never empty), honest-empty INCONCLUSIVE + non-zero exit, unclassifiable-type propagation, secret sanitize on the written record, one-record-per-run log append + stdout summary, missing-env exit 3, run_soak composition, source composes-not-reimplements grep.
- `analytics-service/docs/mt5-spike-gonogo.md` (modified, append-only) — `## Soak log (MT5GOLIVE-02)`.

## Decisions Made
- **Balance-anchored reconstruction initial** instead of the plan's equity-anchored formula — see Deviations (Rule 1). This is the load-bearing correctness call: it turns a vacuous self-referential identity into a gate with real teeth.
- Only `Mt5ClientError` is caught for the `error` observation; classification and generic errors propagate (fail loud).
- Empty and deposit-only (no interpretable return) ledgers are both INCONCLUSIVE.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Reconstruction initial anchored to balance, not equity (plan's oracle was self-referential)**
- **Found during:** Task 1 (writing the RED negative-control test)
- **Issue:** The plan's prose said `initial = equity − Σtrading_pnl − Σflows` and `parity_ok iff |terminal − equity| ≤ tol`. Because the shipped `reconstruct_nav_and_twr` anchors the realized terminal to `anchor_nav − open_unrealized_usd` (== balance, nav_twr.py:800) and combine's internal initial is likewise `equity − Σpnl − Σflows` when equity==balance, forward-rolling from an equity-derived initial reproduces the anchor by algebra — `|reconstructed − equity|` is ~0 for ALL inputs. The `$2-drift` negative control (Test 2) could never redden: a pure equity drift is absorbed as uPnL and an equity-and-initial co-drift cancels. This is exactly the self-referential-oracle anti-pattern the money-math testing lesson warns against (a gate with no teeth).
- **Fix:** Anchor the forward-roll `initial` to **balance** (`balance − Σtrading_pnl − Σflows`). The realized ledger reconstructs the balance; parity to the live equity then holds only when the uPnL wedge is within tolerance, so an unexplained equity drift genuinely lands outside `max($1, 1e-6·|equity|)`. Verified: the $2-drift control reconstructs 110500.0 vs equity 110502.0, residual −2.0 > tol 1.0 → `parity_ok=False`; the consistent case residual is 0.0 → `parity_ok=True`. The `upnl_wedge = equity − balance` is recorded per run and the doc notes to soak a flat/near-flat account or account for open positions.
- **Files modified:** `analytics-service/scripts/mt5_soak.py`, `analytics-service/tests/test_mt5_soak.py`
- **Commit:** `c3b05cd8`

### Auth gates
None.

## Verification
- `cd analytics-service && python3 -m pytest tests/test_mt5_soak.py -x -q` → 13 passed.
- `cd analytics-service && python3 -m pytest -q` → 4413 passed, 96 skipped (full-suite regression gate, no collateral).
- `grep -n "from scripts.mt5_spike import" scripts/mt5_soak.py` → present (reuse, not reimplementation).
- `grep -n "combine_mt5_deal_ledger" scripts/mt5_soak.py` → present (shipped 136 combiner is the reconstruction path).
- Doc gate: `Soak log (MT5GOLIVE-02)` count == 1 and the section contains `human_needed`.

## Known Stubs
None. All live-execution surface (the actual soak RUN against a real broker account) is a `human_needed` checkpoint (plan 139-03) by design — the runner + tests + doc section land here; nothing claims a live run passed. The go/no-go doc rows are intentionally pre-filled with `human_needed` per the doc's own placeholder convention.

## Self-Check: PASSED

- mt5_soak.py, test_mt5_soak.py, 139-01-SUMMARY.md all present on disk.
- Commits c3b05cd8 (feat) + d2fdb81d (docs) present in git log.
- Soak-log section count == 1 in the go/no-go doc.
