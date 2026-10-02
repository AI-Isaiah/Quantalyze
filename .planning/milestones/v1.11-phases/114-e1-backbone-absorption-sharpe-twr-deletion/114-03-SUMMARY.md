---
phase: 114-e1-backbone-absorption-sharpe-twr-deletion
plan: 03
subsystem: analytics-service (E1 backbone absorption — gated delete)
tags: [backbone, sharpe, twr, delete-gate, hasattr, tree-walk, intent-migration, keep-path]
requires: [golden-parity-gate, total_return_from_equity, sharpe_vol_status_from_backbone]
provides: [compute_twr-deleted, _compute_sharpe_and_vol-deleted, permanent-python-delete-gate, keep-path-import-proof]
affects: [115-e2-stitch]
tech-stack:
  added: []
  patterns: [hasattr-live-symbol-gate, whole-tree-token-walk, neuter-guarded-walk, method-exemption-allowed-not-required, intent-preserving-test-migration]
key-files:
  created:
    - analytics-service/tests/test_e1_delete_gate.py
  modified:
    - analytics-service/services/portfolio_metrics.py
    - analytics-service/routers/portfolio.py
    - analytics-service/tests/test_portfolio_metrics.py
    - analytics-service/tests/test_portfolio_router_audit_2026_05_07.py
    - analytics-service/tests/test_nav_twr.py
    - analytics-service/tests/test_coverage_extras.py
    - analytics-service/tests/test_e1_sharpe_twr_parity.py
decisions:
  - "Delete licensed by parity, not by grep: the 114-01 golden oracle + full suite stayed GREEN across the delete, so removal is provably behavior-preserving"
  - "Delete-gate is DUAL: a hasattr live-symbol gate (catches re-import/alias a def-site grep misses) AND a whole-tree token walk (belt-and-suspenders); both neuter-guarded (>=100 files, must-visit the two survivor modules)"
  - "equity_reconstruction.compute_twr is a same-named METHOD (E2/Phase-115) — exempted allowed-but-NOT-required (walk uses <=), so the Phase-115 deletion will not break this gate"
  - "The with-events cashflow-TWR tests have no successor BY DESIGN (every production caller passed events=[]) — the dead generality is retired on record, not silently dropped"
  - "Gate + parity files carry the tokens ONLY as concatenation-built constants and are named in each other's skip-lists; no other file may carry the literal contiguous token outside the two METHOD exemptions"
metrics:
  duration: ~30m
  completed: 2026-07-17
requirements: [BACKBONE-01]
---

# Phase 114 Plan 03: E1 Backbone Absorption — Gated Delete + Permanent Delete-Gate Summary

Executed the gated delete: removed the forward cashflow-chaining TWR scalar from
`services/portfolio_metrics.py` and the legacy Sharpe/vol helper from
`routers/portfolio.py` (both dead since 114-02), migrated every legacy-symbol
test to the backbone-derived helpers WITHOUT losing intent, proved the KEPT
cashflow/IRR surface still imports and functions, and installed the permanent
Python delete-gate that fails CI if either symbol re-enters. BACKBONE-01 clauses
2–4 are closed.

## Result: GREEN

- `tests/test_e1_delete_gate.py` — **4 passed** (live-symbol hasattr gate,
  whole-tree token walk, KEEP-path import+function smoke, process_key lazy-import).
- `tests/test_e1_sharpe_twr_parity.py` — the 114-01 golden oracle + census stay
  GREEN post-delete (legacy leg removed; permanent backbone leg + helper pins +
  the new M-0698 caplog re-pin stand).
- Migrated suites (`test_portfolio_metrics`, `test_portfolio_router_audit_2026_05_07`,
  `test_nav_twr`, `test_coverage_extras`) — all GREEN.
- Full analytics suite `pytest -q -p no:cacheprovider` — **3687 passed, 93
  skipped, 0 failed**.
- CI coverage command (`--cov=services --cov=routers --cov=main_worker
  --cov-fail-under=80`) — **exit 0, TOTAL 89.00%** (well above the 80% gate;
  deleting covered lines did not drop the denominator below the floor).

## Injection RED/GREEN proof (delete-gate is provably fail-capable)

Per the test-the-wiring rule, the gate was proven able to fail before being
trusted:

| Step | Action | Result |
|------|--------|--------|
| RED  | Injected a live token into a scratch `services/_e1_gate_injection_probe.py` (`def compute_twr(): return 1.0`) and ran `test_tree_walk_has_no_reentry_of_deleted_tokens` | **FAILED** — `AssertionError: deleted TWR-scalar token re-entered outside the Phase-115 METHOD exemption: ['services/_e1_gate_injection_probe.py']` |
| GREEN | Removed the scratch probe, re-ran `tests/test_e1_delete_gate.py` | **4 passed** |

The injection was NOT committed (`git status` after revert showed only the new,
untracked gate file). The RED path fires on the `twr_files <= _EXEMPT_TWR` subset
assertion — a re-entry outside the two Phase-115 METHOD exemptions.

## Production deletes

- **`services/portfolio_metrics.py`**: removed the whole `compute_twr` block
  (function + section banner) and trimmed the module docstring to the surviving
  cashflow/IRR path (MWR, Modified Dietz, period returns — the path the backbone
  cannot reproduce, BACKBONE-01). KEPT `_parse_date` (compute_mwr depends on it),
  the logger, and numpy/scipy/pandas (still used by compute_mwr). The docstring
  names the deletion WITHOUT the bare token (census/gate hygiene).
- **`routers/portfolio.py`**: removed the `_compute_sharpe_and_vol` def block
  (114-02 already removed every call site). The module now carries zero
  occurrences of either deletion-target token.

## Permanent delete-gate (`tests/test_e1_delete_gate.py`)

- **Part A — live-symbol gate (primary):** `hasattr` proof that neither symbol
  exists on `services.portfolio_metrics` OR `routers.portfolio`. Attribute-name
  strings built by concatenation so the gate never trips its own walk.
- **Part B — whole-tree token walk:** Sharpe token in ZERO scanned files; TWR
  token ONLY in `{services/equity_reconstruction.py,
  tests/test_equity_curve_builder.py}` (allowed-but-not-required, `<=`); no line
  with BOTH `portfolio_metrics` and the TWR token. Neuter-guards: `>=100` files
  scanned + must-visit `services/portfolio_metrics.py` and `routers/portfolio.py`.
  Skip-list: the gate file itself + the 114-01 parity file (both carry tokens
  only as concatenation constants).
- **Part C — KEEP-path proof:** functional smoke (not import-only) —
  `compute_modified_dietz(100,110,[],30) ≈ 0.10`, `compute_period_returns` on a
  3-day DatetimeIndex returns the three keys finite, `compute_mwr` on a
  one-investment/one-year case `≈ 0.10` at rel 1e-2 — plus `routers.process_key`
  imports (its L1018 lazy import of `compute_period_returns` survives).

The gate file carries ZERO contiguous literal deletion-target tokens (grep-proven),
so it is invisible to both its own walk and the 114-01 caller census.

## Retired-intent register (T-114-06 mitigation — no silent intent loss)

| Legacy test / behavior | File | Disposition — where the intent now lives |
|------------------------|------|-------------------------------------------|
| `test_compute_sharpe_and_vol_*` status codes (M-0626/M-0615) | test_portfolio_router_audit | **PORTED** to `TestSharpeVolStatusFromBackbone` on `sharpe_vol_status_from_backbone` (3-tuple); ok / insufficient_history / zero_volatility kept identical |
| (new) all-NaN len≥2 → `nan_vol` no-raise | test_portfolio_router_audit | **ADDED** (`test_all_nan_returns_nan_vol_without_raising`) — the reachable status the legacy suite never covered |
| nan_mean / nan_sharpe | — | **NOT asserted** — proven-unreachable dead branches under pandas skipna (114-02) |
| `test_twr_agrees_with_compute_twr` (with-events agreement) | test_nav_twr | **REWRITTEN** as `test_twr_agrees_with_hand_derived_chain` against a literal closed-form sub-period chain; renamed off the banned token; docstrings reworded; zero bare-token hits in the file |
| M-0698 begin-value-0 WARNING | test_portfolio_metrics → parity | **RE-PINNED** as `test_total_return_from_equity_zero_first_warns_m0698` (caplog on the survivor helper, permanent class) |
| TWR None-guards / endpoint / day-0 semantics | test_portfolio_metrics, test_coverage_extras | Already pinned on `total_return_from_equity` by the 114-01/02 oracle |
| `endpoint_ratio_twr_derivation` permanent pin | parity | **RE-POINTED** from the deleted scalar to `total_return_from_equity` |
| with-events cashflow-chaining tests (mid-month deposit, day-0 drop, multi-flow, single-obs, all-subperiods-invalid, mid-period withdrawal) | test_portfolio_metrics, test_coverage_extras | **RETIRED on record** — no successor by design; every production caller passed `events=[]`, so this is the dead generality BACKBONE-01 removes (rationale in the commit + in-file comments) |
| `TestLegacyParityBaseline` (8 legacy-symbol pins) | parity | **DELETED with the symbols**; the permanent backbone leg + helper wiring pins remain the ongoing guarantee |

## Census update

`_PINNED_INVENTORY` in the 114-01 parity file was updated to the post-delete
expectation: the only files still carrying the literal tokens are the two
Phase-115 METHOD exemptions (`services/equity_reconstruction.py`,
`tests/test_equity_curve_builder.py`). The census docstring/header were reworded
from "pre-delete" to "post-delete" sweep.

## Deviations from Plan

None functional. Two hygiene follow-throughs the plan implied but did not
enumerate line-by-line:
1. A PERMANENT pin in the parity file (`test_endpoint_ratio_twr_derivation_pins_plan_02`)
   still referenced the deleted scalar — re-pointed to `total_return_from_equity`
   (caught by the parity run before commit).
2. Every migration comment/docstring was scrubbed of the bare contiguous tokens
   (the 114-02 census lesson) so the delete-gate's Part-B walk stays GREEN — no
   non-exempt file carries the literal token.

## Threat surface scan

No new network endpoints, auth paths, file access, or schema changes. Zero new
packages installed (T-114-SC accept upheld). The delete-gate is the new trust
anchor preventing dark-path re-entry (T-114-05 mitigate — hasattr + tree-walk,
injection-proven RED, neuter-guarded).

## Self-Check: PASSED

- `analytics-service/tests/test_e1_delete_gate.py` — FOUND (4 tests, 205 lines, contains hasattr + parents[1])
- `analytics-service/services/portfolio_metrics.py` — FOUND (compute_twr gone; MWR/Dietz/period-returns/_parse_date kept)
- `analytics-service/routers/portfolio.py` — FOUND (_compute_sharpe_and_vol gone)
- Commit `e711d8cd` (Task 1 — delete + migrate) — FOUND
- Commit `3fcaa5b5` (Task 2 — delete-gate) — FOUND
- Full suite 3687 passed / 0 failed; CI coverage 89.00% (exit 0); delete-gate injection-proven RED-capable then reverted
- git diff since Task-1 base touches exactly the eight files in files_modified
