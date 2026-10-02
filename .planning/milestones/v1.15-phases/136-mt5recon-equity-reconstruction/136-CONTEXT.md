# Phase 136: MT5RECON — Equity reconstruction → backbone → api_verified - Context

**Gathered:** 2026-07-23
**Status:** Ready for planning
**Mode:** Autonomous smart-discuss (money-math phase; decisions locked by roadmap + prior backbone conventions; engineering-discretion only)

<domain>
## Phase Boundary

A connected MT5 account becomes an HONEST `api_verified` daily-return series through the ONE
backbone: the deal ledger is classified correctly, external cash flows are folded against the
live `account_info().equity` anchor, annualization is TRADITIONAL √252, and the reconstruction
reconciles to live equity within tolerance. Built + tested against the Phase-134 `Mt5Client`
CONTRACT (offline double) — NO live broker (that is the 134 human_needed spike / Phase 139).

NOT in this phase: concurrency/terminal-lifecycle hardening (137); UI/badge (138); go-live (139).
</domain>

<decisions>
## Implementation Decisions

### combine_mt5_deal_ledger (MT5RECON-01) — mirror `combine_native_ledger`
- New `combine_mt5_deal_ledger` mirroring deribit's `combine_native_ledger`
  (`services/broker_dailies.py:174`): fold `history_deals_get` realized
  `profit`/`swap`/`commission`/`fee` + `DEAL_TYPE_BALANCE` external cash flows against the
  `account_info().equity` anchor → daily returns → the ONE `derive_basis_series` backbone
  (`services/basis_series.py:190`) with the `api_verified` provenance stamp.
- **A deposit day NEVER reads as a return spike** — external flows (`DEAL_TYPE_BALANCE`) are
  removed from the return numerator via the flow-adjusted daily formula (the MT5-EA golden-fixture
  convention: `(equity_close - net_external_flows - prior_close) / prior_close`).
- **Unclassifiable deal type FAILS LOUD** (the deribit-`correction` lesson,
  [[project_deribit_correction_txn_type_unhandled]]): every `DEAL_TYPE` maps to
  realized-cost / external-flow / excluded, and an unknown type raises rather than being silently
  dropped or coerced to a flow.
- **Wire through Mt5Adapter.compute_metrics/fetch_raw** — the Phase-135 fail-loud RAISE stubs are
  now IMPLEMENTED to route through the broker-dailies ONE-path (never a fill-based MetricsSnapshot —
  the BYB-02 corruption class).

### Fail-loud error contract end-to-end (MT5RECON-01)
- `initialize`/`login` False → typed raise carrying `last_error()`; `history_deals_get` `None`
  (error) distinguished from `()` (honest empty) at every read (reuse the Phase-134 `Mt5Client`
  discipline). NO failure path fabricates data.

### Traditional √252 annualization (MT5RECON-02) — close the unknown→crypto trap
- MT5 annualizes as a TRADITIONAL asset class: √252 risk, `asset_class='traditional'` STAMPED.
- `isCryptoExchange` (`src/lib/closed-sets.ts`) + the Python asset-class annualization path
  (`services/metrics.py`, `services/ingestion/adapter.py`) NARROWED to EXCLUDE `'mt5'`. This is
  the explicit guard against the DEFERRED unknown→crypto latent bug
  ([[project_blend_annualization_unknown_assetclass_optimistic]]): an MT5 series must NOT fall
  through to √365.
- Also fixes the Phase-135 note: `create-with-key` hardcoding `asset_class:'crypto'` — MT5 must
  stamp `traditional`.
- **Mutation-style fixture test:** a test FAILS if an MT5 series ever annualizes on √365
  (Sharpe/vol/CAGR don't flip to the crypto basis). RISK=√252 frequency; RETURN/CAGR=CALENDAR
  ([[project_597_asset_class_annualization]]).

### Reconciliation to live equity (MT5RECON-03) — ground-truth parity gate
- Reconstructed equity reconciles to `account_info().equity` within a DEFINED tolerance (the
  ground-truth parity gate).
- A material uPnL wedge raises the fail-loud DQ flag (the v1.8 realized-basis convention —
  realized ledger vs live mark-to-market equity can diverge by open-position uPnL; beyond
  tolerance it is flagged, not silently reconciled).
- A missing-history window renders as HONEST coverage-masked absence — NEVER a fabricated flat
  account ([[feedback_no_invented_data]]).

### Oracle discipline (money-math — NON-NEGOTIABLE)
- Test oracles pin the ECONOMICS, not the implementation's own formula
  ([[feedback_economic_invariant_oracles_not_self_referential]]): zero-cash-rotation ⇒ external
  flow F=0; hand-derived daily returns from the flow-adjusted formula written as literals; a
  deposit day's return computed BY HAND. A fixture regenerated from the SUT's own helpers can mask
  a money bug — do not do it.

### Claude's Discretion
The reconciliation tolerance value, the exact DEAL_TYPE→classification table, and the DQ-flag
threshold are engineering-discretion, grounded in the deribit/sFOX precedents and the v1.8
realized-basis convention.
</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets / Analogs
- `services/broker_dailies.py:174` `combine_native_ledger` — the deribit template to mirror as
  `combine_mt5_deal_ledger`.
- `services/basis_series.py:190` `derive_basis_series` — the ONE backbone every source routes
  through.
- `services/equity_reconstruction.py`, `services/nav_twr.py`, `services/audit.py` — reconstruction
  + reconciliation + DQ-flag precedents.
- `services/deribit_txn.py` — the fail-loud unclassifiable-type ('correction') lesson.
- `services/ingestion/mt5.py` (Phase 135 `Mt5Adapter`, currently fail-loud RAISE) — now implemented.
- `services/mt5_client.py` (Phase 134) — `account_info().equity`, `history_deals_get`, fail-loud
  None≠() discipline.
- `tests/test_mt5_golden_fixtures.py` — the MT5 √252 basis + flow-adjusted daily oracle precedent.
- `src/lib/closed-sets.ts` `isCryptoExchange`; `services/metrics.py` asset-class annualization.

### Established Patterns
- Dailies canonical → derive everything ([[feedback_dailies_canonical_unified_derive]]); broker
  returns via `chain_linked_twr` → `derive_basis_series`, never a fill-based snapshot (BYB-02).
- asset-class annualization: crypto √365 / traditional √252 ([[project_597_asset_class_annualization]]).

### Integration Points
- `Mt5Adapter.compute_metrics`/`fetch_raw` (implement the 135 RAISE stubs); the `derive_basis_series`
  backbone; the api_verified provenance stamp; TS `isCryptoExchange` + Python asset-class path.
</code_context>

<specifics>
## Specific Ideas
- Watch the DEFERRED quantstats price-detection Sharpe bug
  ([[project_quantstats_price_detection_sharpe_bug]]): a reconstructed all-non-negative return
  series with a >100% day can be mis-read by quantstats as prices → wrong Sharpe. Reconstruction
  must feed returns unambiguously (the strategy-analytics path is the open one).
- v1.8 realized-basis convention governs realized-ledger-vs-live-equity uPnL divergence.
</specifics>

<deferred>
## Deferred Ideas
- Live-broker reconciliation against a real account → Phase-134 human_needed spike / Phase 139.
- Concurrency / terminal wedge hardening → Phase 137.
- The master-rejection retcode confirmation (WR-03) → Phase 139 go-live gate.
</deferred>
