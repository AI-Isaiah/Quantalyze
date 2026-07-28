# Phase 114: E1 backbone absorption — Sharpe/TWR deletion - Context

**Gathered:** 2026-07-17
**Status:** Ready for planning
**Mode:** Auto-generated (infrastructure phase — golden-gated refactor/deletion, no user-facing behavior change)

<domain>
## Phase Boundary

The allocator/scenario Sharpe and TWR derive from the ONE backbone
(`compute_all_metrics`); the duplicate `analytics-service/services/portfolio_metrics.py`
Sharpe/TWR stack is deleted under a golden-parity gate, with the cashflow/IRR
path (MWR / modified-Dietz) kept and still importable.

This is a byte-identical consolidation: displayed Sharpe/TWR numbers MUST NOT
change (golden-parity re-derivation is the gate). No new user-facing behavior.
</domain>

<decisions>
## Implementation Decisions

### Claude's Discretion
All implementation choices are at Claude's discretion — this is a pure
infrastructure/refactor phase gated by golden parity. Use the ROADMAP goal,
success criteria, the P111 parity lock (interpretation **A** = fixed-weight-per-key,
cashflow-neutral), and codebase conventions to guide decisions.

### Non-negotiables (from ROADMAP success criteria)
- The weighted portfolio series routes through `compute_all_metrics`; `compute_twr`
  and `_compute_sharpe_and_vol` are DELETED — gated by an **independent** golden-parity
  re-derivation (never a blind delete; the golden must be derived by a separate path,
  not the code being deleted).
- `compute_mwr` / `compute_modified_dietz` (cashflow/IRR — the backbone canNOT reproduce
  it, per BACKBONE-01) are KEPT and still importable; proven by a post-delete import test.
- A whole-`analytics-service/`-tree caller sweep (INCL. Railway one-off scripts and the
  UNGUARDED `scripts/phase12_backfill_enqueue.py` zombie-trap) runs BEFORE the delete, and
  a permanent Python delete-gate prevents re-entry of the deleted symbols.
</decisions>

<code_context>
## Existing Code Insights

### Deletion target
- `analytics-service/services/portfolio_metrics.py`:
  - `compute_twr` (L64) — DELETE
  - `_compute_sharpe_and_vol` — DELETE
  - `compute_mwr` (L158), `compute_modified_dietz` (L243), `compute_period_returns` (L290) — KEEP

### Callers to re-route or update (whole-tree sweep result)
- `analytics-service/routers/portfolio.py` — production caller; re-route to backbone
- `analytics-service/services/equity_reconstruction.py` — caller (also E2/Phase-115 territory)
- Tests referencing the deleted fns: `tests/test_portfolio_metrics.py`,
  `test_portfolio_router_audit_2026_05_07.py`, `test_nav_twr.py`,
  `test_coverage_extras.py`, `test_equity_curve_builder.py`

### Backbone (the single source)
- `compute_all_metrics` is the unified backbone entry (v1.10 Backbone Unification);
  Sharpe/vol/TWR must be read from it. Dailies are canonical → derive metrics from the
  series (see feedback: dailies-canonical-unified-derive).

### Integration / gate points
- Permanent delete-gate pattern already exists for JS (backbone/CONSTIT-04 whole-repo
  grep gate); mirror it for Python (fail CI if `compute_twr`/`_compute_sharpe_and_vol`
  reappear as live symbols).
- Test-project MCP catch-up + geo/egress unaffected (no exchange calls in this phase).
</code_context>

<specifics>
## Specific Ideas

Golden-parity gate must be an INDEPENDENT re-derivation (e.g. a pandas oracle in
`analytics-service/tests/`, mirroring the P111 CONSTIT-05 parity oracle
`test_constit_blend_parity.py`), NOT the soon-to-be-deleted code checking itself.
</specifics>

<deferred>
## Deferred Ideas

- E2 allocator equity reconstruction (the `equity_reconstruction.py` caller's deeper
  cashflow/stitch work) is Phase 115 — this phase only re-routes/keeps its imports,
  it does not rebuild reconstruction.
</deferred>
