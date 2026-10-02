# Phase 120: SFOX Equity reconstruction + backbone - Context

**Gathered:** 2026-07-18
**Status:** Ready for planning
**Mode:** Autonomous (architecture is precedent-determined — the deribit broker-dailies ONE-path is the analog; grounded in phase-118 RESEARCH + the ingestion Protocol)

<domain>
## Phase Boundary

An ingested sFOX account becomes an `api_verified` daily-return series on the ONE unified
backbone (`derive_basis_series`), validated against live account ground truth.

In scope (SFOX-05, SFOX-06):
- sFOX balances + trades → a daily-return series that flows through the ONE unified backbone
  (`services/basis_series.py::derive_basis_series`) — NO parallel metrics path, NO sfox-special
  derive chain. Scalars/charts/coverage all derive from the same dailies.
- The reconstructed sFOX strategy carries the `api_verified` provenance stamp (Phase-111 trust
  tier), distinct from `csv`/`self_reported`.
- Degenerate input (empty account, <10 days, non-finite returns) → honest empty/gated state,
  never invented data.
- ⚠️ Reconstructed equity validated against a live sFOX account ground truth (anchor-consistency
  / parity check — the `scripts/deribit_ground_truth.py` pattern); material divergence FAILS
  LOUD (the wrong curve is never displayed).
- Register the sfox ingestion adapter in the registry (`services/ingestion/__init__.py`
  `_FACTORIES` + `SUPPORTED_SOURCES`) and add `'sfox'` to the ingestion `Source` Literal
  (`adapter.py`) — this RESOLVES the phase-119 deferral (test_source_literal_excludes_sfox flips
  to include; test_source_literal_and_registry_agree stays green because registry + Literal land
  together here). This ALSO resolves the phase-119 red-team seams F2/F7 (finalize/process/verify
  can now resolve sfox).

Out of scope (later phases): static-IP egress (121); add-key wizard UI + badge + e2e (122). The
LIVE ground-truth run on a whitelisted prod key is founder-gated on 121's egress (SFOX-06 live leg).
</domain>

<decisions>
## Implementation Decisions

### Reconstruction shape — mirror the deribit broker-dailies ONE-path
- Phase-118 RESEARCH (GO verdict): sFOX exposes `GET /v1/account/balance/history` returning a
  `{timestamp, usd_value}` daily series — sFOX's OWN pre-computed USD portfolio valuation. This
  is the un-fabricatable `api_verified` ground truth AND the daily-equity source. So sFOX
  reconstruction is a VALIDATION/STITCHING problem, NOT from-scratch pricing.
- `SfoxAdapter` mirrors `DeribitAdapter` (the analog, `services/ingestion/deribit.py`): it is a
  broker-dailies adapter. `compute_metrics` FAILS LOUD (returns flow through the dailies ONE-path,
  not fill-based metrics — same invariant deribit enforces). The daily returns derive from the
  balance-history usd_value series, fed into `derive_basis_series` (the ONE backbone).
- Cashflow separation: `GET /v1/account/transactions` returns typed Deposit/Withdraw/Buy/Sell rows
  WITH a running `account_balance` — use deposits/withdrawals as the cashflow axis so daily
  RETURNS are cashflow-neutral (TWR/Dietz), never contaminated by deposits (the perf-curve ≠
  equity-curve distinction — carry-forward from v1.11 allocator arch).

### Ground-truth parity (SFOX-06) — P115-compliant, independent oracle
- Reuse the `scripts/deribit_ground_truth.py` pattern: anchor-consistency / parity between the
  reconstructed curve and the account's own ground truth. ⚠️ P115: the parity oracle MUST be
  economically independent — validate the reconstructed dailies against the RAW balance-history
  usd_value anchors + the transactions' running `account_balance`, NEVER against the module's own
  transform of them. A material divergence FAILS LOUD (raise, no display).
- The LIVE parity run on a whitelisted prod key is founder-gated (SFOX-06 live leg — needs a real
  sFOX key + phase-121 egress). The committed harness + a fixture/sandbox parity test carry the
  code-complete gate until then (the phase-118 pattern: skipIf-gated, never faked).

### api_verified stamp (SFOX-05)
- The reconstructed sfox strategy carries `trust_tier = api_verified` (the strongest Phase-111
  tier), stamped at the same seam deribit/live-key strategies get theirs (`routers/process_key.py`
  / `ingestion/adapter.py` — confirm in research). Distinct from `csv_uploaded` / `self_reported`.

### Degenerate input — fail-loud / no invented data
- Empty account, <10 days of history, non-finite returns → honest empty/gated state (the existing
  backbone degenerate-handling; sfox uses the SAME gates, not a bespoke one). Never synthesize.

### Claude's Discretion
- Whether the sfox crawl uses the single-page reads (119) or adds a bounded multi-page crawl.
  ⚠️ IF a crawl is added, it MUST have a hard `asyncio.wait_for` per-crawl timeout (the v1.11 FLIP
  worker-wedge lesson + FLIPRETRY-01) — a slow/hanging sFOX crawl must NEVER block the worker loop.
- Exact `SfoxAdapter` method bodies + where the balance-history→dailies transform lives.
</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `services/sfox_client.py` (118) — read-only adapter (get_balances/get_trades/get_transactions/
  get_balance_history, single-page, rate-gated, proxy-seamed, fail-loud).
- `services/sfox_read.py` (119) — the 3-leg read pull.
- `services/ingestion/deribit.py` (139 lines) — THE analog: broker-dailies adapter, compute_metrics
  fails loud, ledger-backed returns.
- `services/deribit_ingest.py` — deribit ingestion (the broker-dailies ONE-path plumbing to mirror).
- `services/basis_series.py` — `derive_basis_series` (:181), `persist_basis_series` (:294): the ONE backbone.
- `scripts/deribit_ground_truth.py` (1036 lines) — the SFOX-06 parity harness pattern.
- `services/ingestion/__init__.py` — `IngestionAdapter` Protocol (:57: validate/fetch_raw/
  compute_metrics/compute_fingerprint/reconstruct_positions), `_FACTORIES` + `SUPPORTED_SOURCES`
  registry (add sfox here), `get_adapter`.

### Established Patterns
- Dailies-canonical: daily returns are the single source of truth; scalars/charts/coverage derive
  from them; toggles swap the SERIES not the scalars.
- Broker-dailies ONE-path (deribit precedent): ledger/balance-backed returns, compute_metrics
  fail-loud, never fill-based process_key metrics.
- P115: money-math oracles pin ECONOMICS (independent anchors), never the impl's own formula.

### Integration Points
- Register sfox in `_FACTORIES`/`SUPPORTED_SOURCES` + the `Source` Literal → resolves 119's deferral
  + the F2/F7 seams (finalize-wizard/process_key/verify can resolve sfox).
- `derive_basis_series` is the single funnel — sfox dailies feed it; no parallel path.
</code_context>

<specifics>
## Specific Ideas

- The balance-history `usd_value` daily series is sFOX's own valuation — treat it as the canonical
  equity anchor (research resolves whether it's a mark vs mid; phase-118 open question Q2).
- Historical depth of balance-history/transactions is docs-silent (phase-118 A1) — resolve
  empirically; affects backfill design, not the reconstruction correctness.
</specifics>

<deferred>
## Deferred Ideas

- Static-IP egress (121) — the live prod parity run gates on it.
- Add-key wizard sfox card + `api_verified` badge + e2e all roles (122).
- The phase-119 F3 (read-only label honesty) + F6 (mixed-case insert) — founder/122 items.
</deferred>
