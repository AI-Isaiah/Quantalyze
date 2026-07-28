---
phase: 76-binance-bybit-okx-flow-adapters-reconciliation-gate
plan: 03
subsystem: analytics
tags: [dq-02, nav-twr, reconciliation, identity-residual, terminus-segmentation, flow-coverage, wallet-scope, fail-loud, tdd]

# Dependency graph
requires:
  - phase: 73-nav-twr-core
    provides: "reconstruct_nav_and_twr backward-roll identity (NAV_{t-1}=NAV_t−pnl_t−F_t), NavReconstructionError, _align_flows, _build_nav_meta / NavTWRMeta guard-flag channel, complete_with_warnings convention"
  - phase: 76-01
    provides: "shared ccxt transfer-fetch path (the I/O side 76-04 uses to derive the hit_terminus / flow_coverage_start_day coverage signal this gate consumes)"
provides:
  - "services/nav_twr.py::reconcile_flow_residual — pure DQ-02 construction-sanity residual (terminal − reconstructed_start − Σpnl − Σflows) that raises NavReconstructionError on a dropped/mis-valued flow OR a wrong-scope anchor; tolerance max($1, 1e-6·|terminal|); wired as an internal self-check in reconstruct_nav_and_twr"
  - "services/nav_twr.py::apply_flow_coverage_terminus — standalone pure terminus segmentation: NaNs pre-terminus days (refuses pre-terminus TWR) + flags flow_coverage_incomplete → complete_with_warnings; None = SC-4 no-op; transient (no start-day) never segments (WR-04)"
  - "services/nav_twr.py::flow_coverage_terminus_day + per-venue retention constants (OKX 90 / Bybit 365 / Binance None) — the pure seam 76-04 wires to derive the coverage signal"
  - "flow_coverage_incomplete key on NavTWRMeta (76-04 lifts it into DataQualityFlags)"
affects: [76-04 ccxt wire + DQ-02 apply, DQ-02]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Construction-sanity residual as a mutation detector: reconstructed_start is derived from the ACTUAL rolled NAV while Σpnl/Σflows sum the INPUTS, so a roll that corrupts the start cannot cancel itself — a dropped flow or wrong-scope anchor reddens loud (never a silent mis-attribution)"
    - "Standalone post-combine terminus segmentation (NOT threaded through transforms.py) so the high-blast-radius shared path stays untouched and the Phase 74 byte-identity pins stay trivially GREEN"
    - "Reuse the existing NavTWRMeta guard-flag channel + complete_with_warnings — no parallel status system (RESEARCH anti-pattern)"
    - "Per-venue retention as NAMED data (OKX 90 / Bybit 365 / Binance None), so a >retention-old deposit SEGMENTS + flags gracefully rather than the residual hard-failing on merely-missing (vs mis-rolled) capital"

key-files:
  created: []
  modified:
    - analytics-service/services/nav_twr.py
    - analytics-service/tests/test_nav_twr.py

key-decisions:
  - "The identity residual is self-consistent by construction, so it catches a DROPPED/MIS-VALUED flow (roll bug) and a WRONG-SCOPE anchor (terminal vs the true reconstructable start), but NOT a merely-MISSING old deposit — that is the terminus segmentation's job. Both mechanisms implemented; they are complementary (RESEARCH Q3/OpenQuestion 3)"
  - "reconstructed_start passed to the internal reconcile is derived from nav.iloc[0] (the rolled series) − pnl_0 − F_0, the same value chain_linked_twr uses as the day-0 denominator; deriving it from the roll is what makes the self-check reveal a roll-math bug (revert-proof: a monkeypatched flow-dropping roll makes reconstruct_nav_and_twr raise)"
  - "Bybit deposit-history retention named 365 with an explicit job_worker.py:1988 'Bybit last 365 days' citation because the exact deposit window is LOW-confidence; 365 over-segments (the safe direction) rather than hard-failing on the residual (plan W2)"
  - "flow_coverage_incomplete named distinctly from the curve-level equity pre_terminus_balance_unknown flag so the flow-coverage suspect and the equity-level suspect stay distinguishable, while both ride the same complete_with_warnings channel"

patterns-established:
  - "DQ-02 gate lives PURE in nav_twr.py (residual math + segmentation decision + per-venue retention); 76-04 supplies the I/O-derived coverage signal, exactly as it will supply the price index"

requirements-completed: []  # DQ-02 ADVANCED (pure gate built); 76-04 wires the I/O coverage signal + applies apply_flow_coverage_terminus to complete DQ-02
---

# Phase 76 Plan 03: DQ-02 Identity Residual + Terminus Segmentation Summary

**One-liner:** Pure DQ-02 reconciliation gate in `nav_twr.py` — a construction-sanity identity residual that fails loud on a dropped/mis-valued flow or a wrong-scope anchor (tolerance `max($1, 1e-6·|terminal|)`), plus standalone terminus segmentation that refuses pre-terminus TWR over a flow-coverage retention gap and flags `complete_with_warnings` instead of attributing the missing capital to performance.

## What Was Built

Two complementary pure mechanisms, both fail-loud, both mutation-honest, wired into the Phase 73 core without touching `transforms.py` or `job_worker.py`:

1. **`reconcile_flow_residual(terminal_nav, reconstructed_start, daily_pnl, flows_by_day) -> float`** — the identity `terminal − reconstructed_start − Σpnl − Σflows`, ~0 by construction of the backward roll. `Σpnl`/`Σflows` are summed from the INPUTS (not the rolled NAV), so a roll that drops/mis-values a flow — or a terminal anchor scoped to a different capital pool (wrong Binance SPOT/USDⓈ-M or Bybit FUND/UNIFIED wallet) — pushes the residual past `max($1, 1e-6·|terminal|)` and raises `NavReconstructionError`. The raise message carries no raw NAV/flow USD (T-76-03-LEAK). Wired as an INTERNAL self-check inside `reconstruct_nav_and_twr` (with `reconstructed_start` derived from the actual rolled `nav`), so a real roll bug reddens loud.

2. **`apply_flow_coverage_terminus(returns, flow_coverage_start_day) -> (returns, flags)`** — a STANDALONE helper 76-04 applies post-combine. When a terminus is set and later than the first return day, the pre-terminus window is NaN'd (pre-terminus TWR REFUSED — never fabricated) and `flow_coverage_incomplete` is flagged → `complete_with_warnings`. `None` → returns unchanged, no flag (SC-4 byte-identity for fully-covered / flow-less / no-cap venues). A transient fetch error is NEVER a start-day signal (it bubbles retryable at the I/O layer), so a blip cannot over-truncate (WR-04 / T-76-03-TRANS).

3. **`flow_coverage_terminus_day(venue, *, first_return_day, now_utc)`** + per-venue constants **OKX 90 / Bybit 365 / Binance None** (`FLOW_TERMINUS_DAYS_BY_VENUE`) — the pure seam 76-04 wires to derive the coverage signal. A >365-day-old Bybit deposit segments gracefully; Binance (no cap) never segments.

4. **`flow_coverage_incomplete: bool`** added to `NavTWRMeta` (total=False); `_build_nav_meta` stamps it and downgrades the status hint to `complete_with_warnings` — reusing the existing DQ flag channel, no parallel status system.

## How It Maps to the Threat Register

| Threat | Mitigation delivered |
|--------|----------------------|
| T-76-03-DROP (silent dropped flow) | `reconcile_flow_residual` raises when the roll drops/mis-values a flow; proven RED by an inline flow-dropping mutant + a monkeypatched flow-dropping roll inside `reconstruct_nav_and_twr` |
| T-76-03 W3 (wrong wallet scope) | An anchor 20% below the true reconstructable capital breaches tolerance → raises; interim safety net for the P78-deferred wallet-scope confirmation |
| T-76-03-GAP (mis-attributed retention gap) | `apply_flow_coverage_terminus` NaNs pre-terminus days + flags; proven RED by asserting the segmented cumulative excludes the fabricated pre-terminus returns |
| T-76-03-TRANS (over-truncation) | Segments ONLY on a set start-day signal; `None` (transient) never segments |
| T-76-03-LEAK (account-size leak) | The residual raise message is generic — no raw NAV/flow USD |

## Deviations from Plan

None — plan executed exactly as written. TDD RED (14 failing proofs, ImportError) → GREEN (implementation) → full suite. No Rule 1–4 deviations; no auth gates.

## Tests (14 added, all mutation-honest)

Identity residual (holds-by-construction, dropped-flow RED, internal-wiring revert-proof via monkeypatch, wallet-scope W3 RED, relative-tolerance scaling), terminus segmentation (NaN+flag, remove-segment-fabricates RED, None no-op, before-first-day no-op, transient no-segment, meta lift to complete_with_warnings), per-venue constants (W2) + `flow_coverage_terminus_day` derivation + compose-into-segmentation.

## Verification

- `pytest tests/test_nav_twr.py -q` → **30 passed** (16 baseline pins + 14 new; all Phase 73 pins stay GREEN).
- Full analytics suite (CI-3.12 venv312) → **3072 passed, 92 skipped** (3058 baseline + 14; no pre-existing test reddened — Phase 73/74/75 byte-identity pins intact).
- `mypy --strict services/nav_twr.py` → clean.

## Scope Discipline

`nav_twr.py` + `test_nav_twr.py` ONLY. `transforms.py`, `job_worker.py`, `ccxt_flows.py`, `analytics_runner` untouched (file ownership; 76-04 wires the I/O coverage signal + applies the gate + lifts `flow_coverage_incomplete` into `DataQualityFlags`).

## Known Stubs

None. Both mechanisms are complete pure functions; the I/O coverage signal that feeds `apply_flow_coverage_terminus` / `flow_coverage_terminus_day` is 76-04's documented responsibility (not a stub — a wiring boundary).

## Commits

- `a4ed98fe` test(76-03): add failing DQ-02 reconciliation-gate proofs (RED)
- `ed350e08` feat(76-03): DQ-02 identity residual + terminus segmentation (pure) (GREEN)

## TDD Gate Compliance

RED gate (`test(76-03)` @ a4ed98fe) precedes GREEN gate (`feat(76-03)` @ ed350e08). No test passed unexpectedly during RED (collection ImportError until the symbols existed). No REFACTOR commit needed.

## Self-Check: PASSED

- FOUND: analytics-service/services/nav_twr.py (reconcile_flow_residual, apply_flow_coverage_terminus, flow_coverage_terminus_day, flow_coverage_incomplete, OKX_DEPOSIT_TERMINUS_DAYS present)
- FOUND: analytics-service/tests/test_nav_twr.py (14 new DQ-02 tests)
- FOUND: commit a4ed98fe (RED)
- FOUND: commit ed350e08 (GREEN)
