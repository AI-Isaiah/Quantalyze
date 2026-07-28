---
phase: 114-e1-backbone-absorption-sharpe-twr-deletion
verified: 2026-07-17T16:42:35Z
status: passed
score: 3/3 must-haves verified
overrides_applied: 0
re_verification:
  # none — initial verification
---

# Phase 114: E1 backbone absorption — Sharpe/TWR deletion — Verification Report

**Phase Goal:** Allocator/scenario Sharpe and TWR derive from the ONE backbone
(`compute_all_metrics` / its co-located module `services/metrics.py`); the
duplicate `compute_twr` + `_compute_sharpe_and_vol` stack is deleted under a
golden-parity gate, with the cashflow/IRR (MWR/modified-Dietz) path KEPT and
still importable.
**Requirement:** BACKBONE-01
**Verified:** 2026-07-17T16:42:35Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

Verification was performed against the shipped code on branch
`gsd/v1.11-scenario-composer-v2-tail` (phase commits `86f3e282`, `13717bb9`,
`81d91c18`, `e711d8cd`, `3fcaa5b5`). All gates were **re-run by the verifier**
in its own process using the analytics-service venv — no SUMMARY.md claim was
taken on trust. The delete-gate's RED capability was independently
re-demonstrated by injecting a live-token probe.

### Observable Truths (ROADMAP Success Criteria — the contract)

| # | Truth | Status | Evidence |
| --- | ------- | ---------- | -------------- |
| 1 | Weighted portfolio series routes through `compute_all_metrics`; `compute_twr` + `_compute_sharpe_and_vol` deleted, gated by an INDEPENDENT golden-parity re-derivation (never blind) | ✓ VERIFIED | `hasattr` proof: both symbols absent from `services.portfolio_metrics` AND `routers.portfolio` (all four False, run live). Six call sites in `routers/portfolio.py` (L784/808/921/958/2276/2282) re-routed to `total_return_from_equity` / `sharpe_vol_status_from_backbone`; `sharpe_vol_status_from_backbone` calls `compute_all_metrics` once (metrics.py L1334). L37 import drops `compute_twr`. Golden oracle (`test_e1_sharpe_twr_parity.py`) re-derives all expectations INLINE (`r.std()·√252`, `eq[-1]/eq[0]-1`) — never calls the deleted code; day-0-divergence assertion proves the gate CAN fail (non-tautological). 18 parity+gate tests GREEN (verifier-run). |
| 2 | `compute_mwr` / `compute_modified_dietz` (cashflow/IRR the backbone cannot reproduce) KEPT + importable, proven by a post-delete import test | ✓ VERIFIED | Live `hasattr`: `compute_mwr`, `compute_modified_dietz`, `compute_period_returns` all present on `services.portfolio_metrics`. `test_e1_delete_gate.py::test_kept_cashflow_irr_helpers_import_and_function` runs FUNCTIONAL smoke (Dietz≈0.10, MWR≈0.10, period-returns 3 finite keys) — GREEN. `routers.process_key` lazy import (L1018 `compute_period_returns`) proven to survive via `test_process_key_lazy_import_of_period_returns_survives`. |
| 3 | Whole-`analytics-service`-tree caller sweep before delete + permanent Python delete-gate prevents re-entry | ✓ VERIFIED | Executable census (`test_caller_census_matches_pinned_inventory`) + Railway-scripts clean test GREEN. Permanent gate `test_e1_delete_gate.py`: Part A `hasattr` live-symbol gate (both symbols × both modules), Part B whole-tree token walk (sharpe token in ZERO files; twr token only in the 2 METHOD-exemption files; no line with both `portfolio_metrics`+twr), Part C KEEP-path proof. Neuter-guards present (≥100 files scanned; must-visit both survivor modules). **Verifier independently injected `services/_e1_gate_injection_probe.py` with a live `compute_twr` def → gate went RED (`AssertionError: deleted TWR-scalar token re-entered...`), then reverted (git clean).** |

**Score:** 3/3 truths verified

### Task-directed deep checks (from verify_context)

| # | Check | Status | Evidence |
| --- | ----- | ------ | -------- |
| 1 | Sharpe/TWR derive from backbone; `compute_twr`+`_compute_sharpe_and_vol` hasattr-absent; no live caller | ✓ VERIFIED | See Truth 1. Grep confirms remaining `compute_twr` occurrences are ONLY: parity-file comments (skip-listed), `test_equity_curve_builder.py` + `equity_reconstruction.py` (same-named METHOD, Phase-115 exempt). `_compute_sharpe_and_vol` only in parity-file docstrings. |
| 2 | Golden-parity oracle INDEPENDENT + GREEN; non-tautological; day-0 divergence pinned | ✓ VERIFIED | Oracle computes every expectation inline from raw numpy/pandas; `test_day0_exclusion_divergence` asserts `cumulative_return` ≠ legacy endpoint TWR and reconciles the exact `(1+r_0)` factor. Pre-delete legacy≡oracle leg was GREEN (114-01 SUMMARY: rel 0.0) — correct golden-gated-delete methodology; permanent backbone≡oracle leg stands and is GREEN now. |
| 3 | MWR/modified-Dietz kept + importable (incl. process_key lazy import); nan_vol degrades gracefully (no prod-500); monkeypatch proof holds | ✓ VERIFIED | See Truth 2. `sharpe_vol_status_from_backbone` has two pre-backbone guards (`len<=1`→insufficient_history, `pd.isna(std)`→nan_vol). `test_sharpe_vol_status_degenerate_all_nan_no_raise` + `test_degenerate_paths_never_call_the_backbone` (monkeypatch `compute_all_metrics`→raise) GREEN — degenerate paths structurally never reach the pipeline. |
| 4 | Permanent delete-gate real (injection-proven RED-capable, self-neuter-guarded); equity_reconstruction METHOD exempted | ✓ VERIFIED | Verifier-run injection → RED (see Truth 3). `_EXEMPT_TWR` uses `<=` (allowed-but-not-required, so Phase-115 deletion won't break it); METHOD exemption documented in-file with STITCH-02 pointer. Neuter-guards asserted live-passing. |
| 5 | Full analytics-service suite passes + coverage ≥80 | ✓ VERIFIED | Verifier-run `pytest --cov=services --cov=routers --cov=main_worker --cov-fail-under=80`: **3687 passed, 93 skipped, 0 failed**, TOTAL **89.00%**, exit 0. Matches SUMMARY. |

### Required Artifacts

| Artifact | Expected | Status | Details |
| -------- | ----------- | ------ | ------- |
| `services/metrics.py` | `total_return_from_equity` + `sharpe_vol_status_from_backbone` | ✓ VERIFIED | Both defined (L1240, L1278), substantive, imported+used at 6 call sites, 97% file coverage |
| `services/portfolio_metrics.py` | Cashflow/IRR only (MWR/Dietz/period_returns/_parse_date); TWR gone | ✓ VERIFIED | `compute_twr` block removed (-102 lines); 5 defs remain, all cashflow/IRR; 98% coverage |
| `routers/portfolio.py` | Six legacy call sites re-routed; legacy def deleted | ✓ VERIFIED | 6 helper call sites; `_compute_sharpe_and_vol` def gone; import trimmed |
| `tests/test_e1_sharpe_twr_parity.py` | Independent golden oracle + census | ✓ VERIFIED | 368 lines; inline oracle; census + railway-clean tests; permanent backbone/helper pins |
| `tests/test_e1_delete_gate.py` | Permanent re-entry gate + KEEP import/function | ✓ VERIFIED | 205 lines; hasattr gate + tree walk + KEEP smoke; injection-proven RED (verifier) |

### Key Link Verification

| From | To | Via | Status | Details |
| ---- | --- | --- | ------ | ------- |
| `routers/portfolio.py` | `services.metrics` helpers | import + 6 re-routed call sites | ✓ WIRED | L34-35 import; L784/808/921/958/2276/2282 usage |
| `sharpe_vol_status_from_backbone` | `compute_all_metrics` | single internal call (post-guards) | ✓ WIRED | metrics.py L1334; ok-path oracle-matched at rel 1e-12 |
| `test_e1_delete_gate.py` | survivor modules | live-symbol `hasattr` assertions | ✓ WIRED | both symbols × both modules asserted |
| `test_e1_delete_gate.py` | whole tree | pathlib walk, concatenated tokens, ≥100-file guard | ✓ WIRED | `parents[1]` walk; injection→RED proven |

### Behavioral Spot-Checks / Probe Execution

| Behavior | Command | Result | Status |
| -------- | ------- | ------ | ------ |
| Parity oracle + delete-gate | `pytest tests/test_e1_sharpe_twr_parity.py tests/test_e1_delete_gate.py -q` | 18 passed | ✓ PASS |
| Delete-gate RED capability | inject `services/_e1_gate_injection_probe.py` (`def compute_twr`) → run tree-walk | FAILED as expected, reverted clean | ✓ PASS |
| Symbol presence | `python -c hasattr(...)` on both modules | deleted=False×4, kept=True×3 | ✓ PASS |
| Full suite + coverage gate | `pytest --cov=... --cov-fail-under=80` | 3687 passed, 0 failed, 89.00%, exit 0 | ✓ PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
| ----------- | ---------- | ----------- | ------ | -------- |
| BACKBONE-01 | 114-01/02/03 | E1 Sharpe/TWR onto the one backbone; duplicate stack deleted golden-gated; cashflow/IRR kept | ✓ SATISFIED | All 3 ROADMAP success criteria VERIFIED above |

### Anti-Patterns Found

None. No unreferenced debt markers (TBD/FIXME/XXX) in any modified analytics file. Diff scope is exactly the 9 files declared across the three plans (+790/-357). No stub returns, no orphaned code. The remaining `compute_twr` textual occurrences are all legitimate (skip-listed oracle comments + the Phase-115 METHOD exemption), and the gate provably enforces this.

### Human Verification Required

None. This is an infrastructure/refactor phase with a byte-identical mandate (no user-facing behavior change). Every success criterion is programmatically verifiable and was re-run by the verifier. The byte-parity guarantee is enforced by the full suite passing with zero test-assertion edits in the re-route wave (114-02) plus the independent golden oracle.

### Gaps Summary

No gaps. The phase goal is genuinely achieved:
- The duplicate Sharpe/TWR stack is deleted (hasattr-proven absent, not merely grep-absent).
- The deletion was gated by a genuinely INDEPENDENT, non-tautological golden oracle (inline re-derivation; day-0 divergence asserted to prove the gate can fail).
- The cashflow/IRR path is kept and proven to FUNCTION post-delete (not import-only), including the process_key lazy-import wiring.
- The permanent delete-gate is real and RED-capable (verifier-injected probe triggered the failure), neuter-guarded, with the equity_reconstruction METHOD correctly exempted allowed-but-not-required.
- Full suite green (3687/0) and coverage 89% clears the 80% gate.

**Adversarial note on the "TWR from co-located helper" question:** TWR is computed by `total_return_from_equity` (an endpoint-ratio helper co-located in `services/metrics.py`, the backbone module) rather than read out of the `MetricsResult` dict. This is a deliberate byte-identical choice — the oracle asserts `cumulative_return` differs from legacy TWR by the day-0 factor, so reading `cumulative_return` would change displayed numbers. The phase goal (as stated in verify_context) explicitly names "its co-located module `services/metrics.py`", so this satisfies the single-source-in-the-backbone-module contract and is NOT a goal-miss.

---

_Verified: 2026-07-17T16:42:35Z_
_Verifier: Claude (gsd-verifier)_
