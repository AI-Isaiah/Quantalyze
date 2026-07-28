# Phase 75: Deribit Dated-Flow Adapter (RISKY) - Research

**Researched:** 2026-07-06
**Domain:** Deribit txn-log external-flow dating + inverse-coin (BTC/ETH) event-time USD valuation → core `external_flows` (F_t); analytics-service Python (pandas/numpy)
**Confidence:** HIGH (all claims are `[VERIFIED: codebase grep/read]` against the shipped v1.7 Deribit modules; no external packages introduced)

## Summary

This phase converts Deribit's external cash flows from a single lifetime NET SCALAR anchor
correction into a DATED per-UTC-day list fed to the honest core `reconstruct_nav_and_twr(external_flows=...)`.
Every piece the phase needs already exists and is battle-tested from v1.7: the inverse coin→USD
valuation path (`txn_change_to_usd` + same-day `get_delivery_prices` fallback + `LedgerValuationError`
fail-loud), the shared UTC-day bucketing helper (`_row_utc_day`), the txn-type taxonomy
(`CASH_BEARING_TYPES` / `INFORMATIONAL_TYPES` / `_EXTERNAL_FLOW_TYPES`), and the core's flow contract
(`nav_twr._flows_to_daily_usd` already unpacks `(day, usd)` tuples). The work is *re-plumbing*, not
new algorithms — the locked design's own rule is "one honest valuation path, do NOT write a second
inverse-valuation routine."

The milestone's silent-corruption risk lives entirely in Q3: an inverse (BTC/ETH) flow row's `change`
is in COIN units and MUST be multiplied by the SAME-DAY settlement index at event time, failing loud
if that index is absent — never valued at 1.0, never at a current/most-recent price, never dropped.
`txn_change_to_usd` already enforces exactly this. The one genuinely NEW correctness requirement is a
plumbing gap (Finding C1 below): the crawl currently fetches the same-day settlement index ONLY for
`CASH_BEARING_TYPES` quiet days (`inverse_days_needing_index` filters on `CASH_BEARING_TYPES` at
`deribit_txn.py:483`). Deposit/withdrawal rows are `INFORMATIONAL_TYPES`, so an inverse BTC withdrawal
on a day with no settlement row would get NO index fetched and would `LedgerValuationError` the whole
job. **The settlement-index-fetch planner (`inverse_days_needing_index`) must be extended to also cover
inverse `_EXTERNAL_FLOW_TYPES` rows.** This is the single highest-risk implementation detail in the phase.

**Primary recommendation:** Add `services/external_flows.py` (`ExternalFlow = NamedTuple(utc_day_iso, usd_signed)`,
pure). Add a `deribit_dated_external_flows_usd(rows, *, supplemental_index=...) -> list[ExternalFlow]`
to `deribit_txn.py` that reuses `txn_change_to_usd` verbatim for inverse rows and buckets by `_row_utc_day`.
Extend `inverse_days_needing_index` to include inverse `_EXTERNAL_FLOW_TYPES` rows so flow days get a
settlement-index fetch. Accumulate a dated flow list on `CompletenessReport`, delete the F1 scalar
correction at `job_worker.py:1968-1979`, and pass the dated list to `combine_realized_and_funding(external_flows=...)`.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions (ROADMAP SC 1-4)
1. **The ONE dated-flow contract** — `services/external_flows.py` defines `ExternalFlow = (utc_day_iso, usd_signed)`
   (deposit +, withdrawal −), consumed by the core `reconstruct_nav_and_twr(external_flows=...)` regardless of
   venue, keyed on the SAME `_row_utc_day` UTC-day helper the realized/funding buckets use (a midnight-adjacent
   flow must not drift onto the wrong day).
2. **`deribit_linear_external_flow_usd` emits a dated per-day LIST** (no longer a net scalar). Inverse BTC/ETH flow
   rows are valued at the same-day `get_delivery_prices` settlement index via the EXISTING `txn_change_to_usd` /
   `supplemental_index` path (the P72 quiet-day fix), and **fail loud (`LedgerValuationError`) if no same-day index
   exists** — NEVER valued at 1.0, NEVER at a current/most-recent price, NEVER dropped.
3. **Delete the F1 scalar anchor correction** (`equity −= net_external_flow_usd`) in `job_worker.py`. Deribit flows
   feed ONLY the NAV `F_t` term (via the core's `external_flows`) and stay EXCLUDED from the realized daily sum —
   the count-once invariant is preserved via `INFORMATIONAL_TYPES`.
4. **VCR fixtures on LTP068's known flow days:** a real BTC withdrawal becomes a correctly-signed, event-time-valued
   `F_t` on its ACTUAL day; a pure-flow day with no trading yields `r_t == 0` (flow cancels in the numerator — the
   flow-neutral TWR property proven in Phase 73).

### Claude's Discretion (grey areas — auto-decided, research to confirm mechanics)
- **Which txn-log types are external flows?** deposits / withdrawals / transfers that move cash IN/OUT — NOT trades /
  settlements (return-bearing). Research MUST enumerate the exact Deribit `type` taxonomy and which are flows vs
  return-bearing vs informational. The `change` field is authoritative (P70 re-probe); credit(+)/debit(−) sign trusted verbatim.
- **Sign mapping:** `usd_signed` follows the `change` sign (deposit credit +, withdrawal debit −). No re-derivation.
- **Single-scope:** each Deribit key = its own subaccount (STATE). Funding is settlement-bundled and is return-bearing
  (NOT a flow) — do not double-count.

### Deferred Ideas (OUT OF SCOPE)
- ccxt venue flow adapters (Binance/Bybit/OKX) + reconciliation gate — Phase 76.
- uPnL basis reconciliation — Phase 77.
- Golden parity + P72 LTP068 acceptance canary — Phase 78 (the hard gate).
- Broker→CSV guard-meta propagation gap (TODOS.md, P74) — Phase 76/78.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| FLOW-01 | One dated-flow contract `ExternalFlow = (utc_day_iso, usd_signed)` in new `services/external_flows.py` — deposit +, withdrawal −, non-USD coin→USD at the flow's event-time price. Single shape consumed by the core regardless of venue. | Q5 — the core (`nav_twr._flows_to_daily_usd`, `nav_twr.py:111-133`) already unpacks `day_raw, usd_raw = flow` and re-dates via the shared `_row_utc_day`. A `NamedTuple(utc_day_iso: str, usd_signed: float)` is drop-in. Pure, no I/O. |
| FLOW-02 | Deribit dated flows from the **in-band** txn-log `_EXTERNAL_FLOW_TYPES` rows (no extra fetch) — `deribit_linear_external_flow_usd` extended from a net scalar to a dated per-day list; inverse (BTC/ETH) flows valued via the existing `txn_change_to_usd` / `supplemental_index` / `get_delivery_prices` path; the F1 scalar anchor correction in `job_worker.py` deleted. VCR fixtures on LTP068's known flow days. | Q1 (taxonomy), Q2 (F1 site), Q3 (inverse valuation + fail-loud), Q4 (dating), Q6 (acceptance/fixtures), Finding C1 (the settlement-index-fetch gap for flow days). |
</phase_requirements>

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Flow-type classification (which txn types are flows) | Pure valuation core (`deribit_txn.py`) | — | Already the single home of `_EXTERNAL_FLOW_TYPES` / `INFORMATIONAL_TYPES`; classification must be I/O-free + revert-proof-tested. |
| Inverse coin→USD flow valuation | Pure valuation core (`deribit_txn.py::txn_change_to_usd`) | — | The ONE honest valuation path (locked); reused verbatim, never duplicated. |
| Venue-agnostic flow contract | Pure contract (`services/external_flows.py`, NEW) | — | Phase 76 ccxt adapters target it verbatim; must be pure dataclass + validation. |
| Same-day settlement-index sourcing (I/O) | Ingest/crawl (`deribit_ingest.py`) | Deribit `public/get_delivery_prices` | The only tier allowed network I/O; feeds `supplemental_index` back into the pure core. |
| Anchor + flow wiring into the return series | Worker orchestration (`job_worker.py`) | core (`nav_twr` via `broker_dailies`) | Deletes the F1 scalar; threads the dated list to `combine_realized_and_funding(external_flows=...)`. |
| NAV reconstruction + chain-linked TWR (F_t consumption) | Pure core (`nav_twr.py`) | — | Already accepts `external_flows`; unchanged by this phase (Phase 73/74 delivered it). |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Python stdlib (`datetime`, `collections`) | 3.12 (CI) | Pure classification/dating | `deribit_txn.py` imports nothing beyond stdlib+typing by design (no ccxt/pandas) so correctness tests stay network-free `[VERIFIED: deribit_txn.py:1-46]` |
| pandas | 2.2.3 | Core NAV/flow bucketing (in `nav_twr`, unchanged) | Already pinned; `_flows_to_daily_usd` uses it `[VERIFIED: nav_twr.py:37-38]` |
| numpy | 2.4.6 | Core NAV math (unchanged) | Already pinned |

**No new dependencies.** `[VERIFIED: REQUIREMENTS.md:10 "No new dependencies"]` This phase is pure re-plumbing of existing modules. Introducing `vcrpy` for Deribit is NOT recommended — see Q6 (Deribit tests use in-process stubs, not cassettes).

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Extending `inverse_days_needing_index` to cover flow rows | A separate `inverse_flow_days_needing_index` sibling | A sibling keeps the cash-bearing planner's contract crisp, but risks the two drifting on day/ccy computation. **Prefer extending** the existing function (or factoring a shared inner scan) so cash-bearing and flow days can never disagree on which days already carry an own index — mirrors the existing `_day_ccy_own_index` factoring rationale `[CITED: deribit_txn.py:422-455]`. |
| Reusing `deribit_linear_external_flow_usd` (linear-only) | New `deribit_dated_external_flows_usd` valuing BOTH linear + inverse | The linear-only fn intentionally punts inverse (`saw_unvalued_inverse_flow`); Phase 75 must value inverse. Either extend it to a dated list that also handles inverse, or add a new dated fn and retire the scalar. **Prefer a new dated fn** + delete the scalar path (cleaner deletion of F1). |

## Package Legitimacy Audit

Not applicable — this phase installs NO external packages (pure re-plumbing of in-repo modules; stack
already pinned in `analytics-service/requirements.txt`). No `slopcheck` / registry step required.

## Critical Findings (file:line evidence)

### Q1 — Deribit txn-log `type` taxonomy (RETURN-BEARING vs FLOW vs INFORMATIONAL)

`[VERIFIED: deribit_txn.py:300-380]`

| `type` | Set membership | Class | Feeds F_t? | In realized `change` sum? |
|--------|---------------|-------|-----------|---------------------------|
| `trade` | `CASH_BEARING_TYPES` | RETURN-BEARING (fees + option premium) | ❌ NO | ✅ YES |
| `settlement` | `CASH_BEARING_TYPES` | RETURN-BEARING (futures session PnL **+ perpetual funding**) | ❌ NO | ✅ YES |
| `delivery` | `CASH_BEARING_TYPES` | RETURN-BEARING (option/future expiry cash) | ❌ NO | ✅ YES |
| `liquidation` | `CASH_BEARING_TYPES` | RETURN-BEARING (forced-close PnL/fees) | ❌ NO | ✅ YES |
| `negative_balance_fee` | `CASH_BEARING_TYPES` | RETURN-BEARING (cost of carry) | ❌ NO | ✅ YES |
| `transfer` | `INFORMATIONAL_TYPES` **∩** `_EXTERNAL_FLOW_TYPES` | EXTERNAL FLOW | ✅ **YES** | ❌ NO (skipped) |
| `deposit` | `INFORMATIONAL_TYPES` **∩** `_EXTERNAL_FLOW_TYPES` | EXTERNAL FLOW | ✅ **YES** | ❌ NO (skipped) |
| `withdrawal` | `INFORMATIONAL_TYPES` **∩** `_EXTERNAL_FLOW_TYPES` | EXTERNAL FLOW | ✅ **YES** | ❌ NO (skipped) |
| `usdc_reward` | `INFORMATIONAL_TYPES` **∩** `_EXTERNAL_FLOW_TYPES` | platform yield subsidy | ⚠️ GREY (see Open Q1) | ❌ NO (skipped) |
| `swap` | `INFORMATIONAL_TYPES` only (NOT a flow) | internal cross-collateral FX (net ~0) | ❌ NO | ❌ NO (skipped) |
| `options_settlement_summary` | UNCLASSIFIED (neither set) | zero-cash recap | fail loud if nonzero `change` | fail loud if nonzero |
| `correction` | UNCLASSIFIED (neither set) | ambiguous manual adjustment | fail loud if nonzero `change` | fail loud if nonzero |
| *(any unknown type)* | UNCLASSIFIED | — | fail loud if nonzero `change` | `LedgerValuationError` `[VERIFIED: deribit_txn.py:594-601]` |

- **F_t source = `_EXTERNAL_FLOW_TYPES`** = `{transfer, deposit, withdrawal, usdc_reward}` `[VERIFIED: deribit_txn.py:339-341]`.
- **Count-once invariant is structural:** every `_EXTERNAL_FLOW_TYPES` type is ALSO in `INFORMATIONAL_TYPES`, so
  `txn_rows_to_daily_records` (the realized sum) SKIPS them (`deribit_txn.py:552-553`). A flow can therefore never
  be BOTH an F_t and in the realized sum. `CASH_BEARING_TYPES ∩ INFORMATIONAL_TYPES == ∅` is asserted at import
  `[VERIFIED: deribit_txn.py:330-332]`.
- **Funding is NOT a flow and NOT a separate type** — it is realized inside `settlement.change` `[VERIFIED: deribit_txn.py:36-39]`.
  Do not source it as F_t; do not double-count.
- **`swap` is deliberately excluded from BOTH** — internal FX, net ~0 in USD; correctly neither realized nor a flow.

### Q2 — The F1 scalar anchor correction (the deletion target)

`[VERIFIED: job_worker.py:1968-1979]`

```
1968   # F1 — correct the initial-capital anchor for net external flows...
1975   if equity is not None and not balance_error:
1976       if _completeness.saw_unvalued_inverse_flow:
1977           balance_error = True  # cannot fully value flows → DQ flag
1978       else:
1979           equity = equity - _completeness.net_external_flow_usd
```

- **What computes the net scalar today:** `deribit_ingest.py:671-673` — `deribit_linear_external_flow_usd(rows)`
  returns `(net_usd, saw_inverse)`, accumulated across every (scope, currency) into
  `CompletenessReport.net_external_flow_usd` / `.saw_unvalued_inverse_flow` `[VERIFIED: deribit_ingest.py:591-593, 671-673, 690-692]`.
- **What the scalar fn does:** sums LINEAR (USD-family) flow rows' `change` directly; sets `saw_inverse=True` for any
  inverse (BTC/ETH) flow row it CANNOT value (it has no per-row index) `[VERIFIED: deribit_txn.py:344-369]`. This is
  precisely the under-correction Phase 75 replaces with real event-time valuation.
- **Who else reads the scalar:** NOBODY else. `grep` confirms `net_external_flow_usd` / `saw_unvalued_inverse_flow`
  are consumed ONLY at `job_worker.py:1976-1979` `[VERIFIED: grep job_worker.py]`. The `CompletenessReport` fields
  feed only this site. `total_return_rows` (the C2 equity-vs-activity floor at `job_worker.py:1948-1953`) is
  SEPARATE and MUST stay.
- **Deletion plan:** remove lines 1968-1979; replace `CompletenessReport.net_external_flow_usd` (float) +
  `.saw_unvalued_inverse_flow` (bool) with a `dated_external_flows: list[ExternalFlow]` field; pass it to
  `combine_realized_and_funding(realized, funding, account_balance=equity, ..., external_flows=dated_flows)` at
  `job_worker.py:2012-2014`. The `saw_unvalued_inverse_flow → balance_error` degradation is DELETED — an unvaluable
  inverse flow now fails loud via `LedgerValuationError` (already caught permanent at `job_worker.py:1917-1942`),
  not silently degraded to heuristic capital.

### Q3 — Inverse-coin valuation (THE risk) + fail-loud site

`[VERIFIED: deribit_txn.py:178-231]` `txn_change_to_usd(row, *, fallback_index=None)`:

1. Linear / USD-family (`_row_is_linear`, checks instrument name markers `_USDC`/`_USDT`/`_EURR` OR
   `currency ∈ {USDC,USDT,USD,EURR}`) → `change` passes through unchanged (already USD) `[VERIFIED: deribit_txn.py:164-175, 198-199]`.
2. Inverse (coin-margined, currency ∈ `{BTC, ETH}`) → `change × index_price` at the row's OWN event-time
   `index_price`; if absent, `fallback_index` (the SAME-UTC-DAY per-currency settlement index); if BOTH absent →
   **`LedgerValuationError`** `[VERIFIED: deribit_txn.py:212-223]` — the fail-loud site. Also fails loud on a
   non-`{BTC,ETH}` coin currency (`deribit_txn.py:204-211`) and a non-positive index (`deribit_txn.py:225-230`).
3. The `change` SIGN is trusted verbatim (credit +/debit −), NEVER re-derived from position side `[VERIFIED: deribit_txn.py:194-196]`.

**Is a deposit/withdrawal `change` in coin units? YES — identical to a settlement row.** The txn-log is crawled
per-currency; a BTC withdrawal appears in the BTC-currency crawl with `currency="BTC"` and `change` in BTC. So
`txn_change_to_usd(flow_row, fallback_index=...)` applies DIRECTLY and correctly — no new valuation routine needed
(honors the "one honest valuation path" lock). **The only structural difference from a settlement row:** a
deposit/withdrawal row has NO `instrument_name` and NO own `index_price` (there is no traded instrument), so it
ALWAYS depends on the same-day `fallback_index` (`get_delivery_prices`) — exactly the P72 `negative_balance_fee`
quiet-day case generalized.

**Same-day index sourcing (I/O):** `deribit_ingest.py::fetch_deribit_settlement_index` pages
`public/get_delivery_prices` (`index_name={ccy}_usd`), accumulating `{date_iso: delivery_price}` (D-07-compliant
same-day mark, NOT period-end) `[VERIFIED: deribit_ingest.py:431-502]`. Fed back as `supplemental_index` keyed
`(day_iso, CCY_UPPER)` `[VERIFIED: deribit_ingest.py:630-667]`.

### Finding C1 — THE settlement-index-fetch gap for flow days (NEW correctness work; highest risk)

`[VERIFIED: deribit_txn.py:458-504]` `inverse_days_needing_index` — the planner that tells the crawl which
`(day, ccy)` pairs to fetch a settlement index for — filters on `CASH_BEARING_TYPES` at **line 483**:

```
483   if str(row.get("type", "")) not in CASH_BEARING_TYPES:
484       continue
```

Deposit/withdrawal/transfer are `INFORMATIONAL_TYPES`, NOT `CASH_BEARING_TYPES` → **an inverse BTC/ETH flow row on
a quiet day (no same-day settlement row) is INVISIBLE to this planner.** The crawl (`deribit_ingest.py:632-664`)
gates the `get_delivery_prices` fetch on `inverse_days_needing_index(rows)`, so no index is fetched for that flow
day, `supplemental_index` lacks it, and `txn_change_to_usd` raises `LedgerValuationError` — failing the WHOLE job
permanent. **Phase 75 MUST extend `inverse_days_needing_index` (or add a shared inner scan) to also emit
`(day, ccy)` for inverse rows whose `type ∈ _EXTERNAL_FLOW_TYPES` with nonzero `change` and no own same-day index.**
Without this, a real LTP068 BTC withdrawal on a no-trade day fails loud instead of valuing — the exact fabricated/
dropped-day harm inverted into a hard failure. This is the phase's most important non-obvious task.

### Q4 — Dating (shared bucketing, no midnight drift)

`[VERIFIED: deribit_txn.py:382-419]` `_row_utc_day(ts)` is the single shared UTC-day helper (epoch-ms, datetime,
and ISO-string tolerant; fails loud on an uninterpretable timestamp — never silently drops cash). `nav_twr` imports
it directly (`from services.deribit_txn import _row_utc_day`, `nav_twr.py:43`) and `_flows_to_daily_usd` re-runs
each flow's `utc_day_iso` through it (idempotent on an ISO date string) `[VERIFIED: nav_twr.py:111-133]`. Because the
realized pnl bucketing (`txn_rows_to_daily_records`, `deribit_txn.py:573`) and the flow dating use the IDENTICAL
helper, a midnight-adjacent flow lands on the SAME `t` as the pnl it offsets — Pitfall #11 is structurally closed.
The dated flow row is produced by `_row_utc_day(flow_row.get("timestamp"))` at flow-build time.

### Q5 — The dated-flow contract (`services/external_flows.py`)

Locked shape: `ExternalFlow = (utc_day_iso: str, usd_signed: float)`. The core already consumes exactly this —
`_flows_to_daily_usd` does `day_raw, usd_raw = flow` then `_row_utc_day(day_raw)` + `_coerce_float(usd_raw)`
`[VERIFIED: nav_twr.py:123-129]`. Recommended:

```python
# services/external_flows.py — PURE, I/O-free (venue-agnostic; Phase 76 ccxt adapters target it verbatim).
from typing import NamedTuple

class ExternalFlow(NamedTuple):
    """One dated external cash flow in USD. deposit/reward-in +, withdrawal −.
    utc_day_iso: 'YYYY-MM-DD' (the shared _row_utc_day day-key). usd_signed: event-time USD."""
    utc_day_iso: str
    usd_signed: float
```

- `NamedTuple` unpacks positionally as `(day, usd)` → drop-in for the core's `day_raw, usd_raw = flow`.
- Keep it PURE: no ccxt, no pandas, no I/O (mirrors `deribit_txn.py`'s import discipline). Optional light
  validation (`usd_signed` finite; `utc_day_iso` non-empty) may live here, but the core already fail-loud-coerces
  both — do not duplicate business logic, only shape.
- Do NOT put valuation in this module. Venue adapters (Deribit here, ccxt in Phase 76) produce `list[ExternalFlow]`.

### Q6 — LTP068 acceptance + fixtures (⚠️ VCR discrepancy)

**Discrepancy to surface to the planner:** CONTEXT/REQUIREMENTS say "VCR fixtures on LTP068's known flow days," but
the Deribit test infrastructure uses **in-process async STUBS** (`monkeypatch` + stub classes `_TxnLogStub`,
`_ScopeStub`, `_CurrencyStub`), NOT `vcrpy` cassettes `[VERIFIED: tests/test_deribit_ingest.py:22-68, 682-720]`.
`vcrpy`-style cassettes exist ONLY for the ccxt HTTP venues (`tests/cassettes/okx/`, `tests/cassettes/bybit/`) —
there is NO `tests/cassettes/deribit/` and NO LTP068 fixture in the repo `[VERIFIED: ls tests/cassettes]`. Deribit's
raw `private_get_*`/`public_get_*` calls are stubbed, not HTTP-recorded.

**Recommendation:** read "VCR fixtures" as **recorded synthetic fixture rows modeling LTP068's known flow days** and
follow the established stub/monkeypatch pattern — specifically mirror
`test_producer_values_quiet_inverse_day_via_settlement_index` (`tests/test_deribit_ingest.py:682`) and
`test_quiet_inverse_row_valued_via_supplemental_index` (`tests/test_deribit_txn.py:650`). LTP068's ACTUAL txn-log
rows are not in the repo; the +458% cum / 229,214% CAGR figures live only in `.planning` docs (STATE/REQUIREMENTS),
not in code `[VERIFIED: grep — no LTP068 in analytics-service/]`. Synthesize the two acceptance rows from the row
schema:
1. **Real BTC withdrawal** → a `{"type":"withdrawal","currency":"BTC","change":-0.5,"timestamp":<ms>}` row on a
   quiet day → valued at that day's `get_delivery_prices` index → a correctly-SIGNED (negative), event-time `F_t`
   on its actual UTC day.
2. **Pure-flow day (no trading)** → the flow-neutral TWR property: `r_t = (NAV_t − NAV_{t-1} − F_t)/NAV_{t-1}`;
   with no pnl, `NAV_t − NAV_{t-1} == F_t` by backward reconstruction, so `r_t == 0`
   `[VERIFIED: nav_twr.py:185-230]`. ⚠️ Caveat: this holds ONLY while `|F_t| < FLOW_DOM_RATIO·NAV_{t-1}` (=100%).
   A withdrawal that dwarfs prior NAV trips `flow_dominated_guard` → the day is NaN + `complete_with_warnings`, NOT
   `r_t==0` `[VERIFIED: nav_twr.py:233-256]`. The acceptance fixture's pure-flow day must use a flow that is
   material but under the prior NAV, or the "r_t==0" assertion is wrong for a near-total withdrawal (see Open Q2).

**Cassette/fixture location:** stub rows live inline in `tests/test_deribit_ingest.py` / `tests/test_deribit_txn.py`
(the existing pattern). If real captured rows are desired for an evidence trail, `docs/evidence/` is the precedent
(`drb01/drb02/drb03-*.json`) — but that is optional and NOT how the current tests run.

### Q7 — Pitfalls (see Common Pitfalls section)

## Architecture Patterns

### System Architecture Diagram

```
Deribit txn-log crawl (deribit_ingest.py, I/O tier)
  paginate_txn_log(scope, ccy) ──► rows[]  (per scope × currency)
        │
        ├─► inverse_days_needing_index(rows)   ◄── EXTEND: include inverse _EXTERNAL_FLOW_TYPES rows (Finding C1)
        │        │ (day, ccy) needing a same-day index
        │        ▼
        │   fetch_deribit_settlement_index(ccy)  → public/get_delivery_prices → {date: price}
        │        │
        │        ▼  supplemental_index {(day, CCY): price}
        │
        ├─► txn_rows_to_daily_records(rows, supplemental_index)   → realized daily_pnl records
        │        (CASH_BEARING only; _EXTERNAL_FLOW/INFORMATIONAL skipped → count-once)
        │
        └─► deribit_dated_external_flows_usd(rows, supplemental_index)   ◄── NEW (replaces the scalar)
                 (for each _EXTERNAL_FLOW_TYPES row: txn_change_to_usd(row, fallback_index) ; bucket by _row_utc_day)
                 → list[ExternalFlow(utc_day_iso, usd_signed)]
        │
        ▼  CompletenessReport.dated_external_flows  (replaces net_external_flow_usd + saw_unvalued_inverse_flow)
job_worker.py (orchestration)
  DELETE F1 scalar (equity −= net_external_flow_usd, :1968-1979)
  combine_realized_and_funding(realized, funding=[], account_balance=equity,
                               external_flows=dated_external_flows)   ──►
nav_twr.reconstruct_nav_and_twr(daily_pnl, anchor_nav, external_flows=...)
  NAV_{t-1} = NAV_t − pnl_t − F_t   ;   r_t = (NAV_t − NAV_{t-1} − F_t)/NAV_{t-1}
  guards: negative/dust/flow_dominated → NaN + complete_with_warnings (never substitute)
```

### Component Responsibilities
| File | Responsibility | Change in Phase 75 |
|------|----------------|--------------------|
| `services/external_flows.py` | Venue-agnostic `ExternalFlow` contract | **NEW** — pure NamedTuple + optional shape validation |
| `services/deribit_txn.py` | Pure classification + inverse valuation + dating | Add `deribit_dated_external_flows_usd`; extend `inverse_days_needing_index` for flow rows; (optionally retire `deribit_linear_external_flow_usd`) |
| `services/deribit_ingest.py` | I/O crawl + settlement-index fetch | Accumulate `dated_external_flows` on `CompletenessReport`; fetch index for flow days too |
| `services/job_worker.py` | Orchestration | DELETE F1 scalar (:1968-1979); pass `external_flows=` to `combine_realized_and_funding` |
| `services/broker_dailies.py` | `combine_realized_and_funding` | UNCHANGED — already threads `external_flows` (`broker_dailies.py:119-149`) |
| `services/nav_twr.py` | NAV + chain-linked TWR | UNCHANGED — already consumes `external_flows` (Phase 73/74) |

### Pattern: One honest valuation path
**What:** inverse flow rows reuse `txn_change_to_usd(row, fallback_index=...)` verbatim.
**When:** always for `_EXTERNAL_FLOW_TYPES` rows where `_row_is_linear` is False.
**Example:**
```python
# Source: deribit_txn.py:178-231 (reuse, do NOT reimplement)
usd = txn_change_to_usd(flow_row, fallback_index=supplemental_index.get((day, ccy)))
# linear flow → change passthrough; inverse → change × same-day index; else LedgerValuationError.
```

### Anti-Patterns to Avoid
- **A second inverse-valuation routine** — the lock forbids it; reuse `txn_change_to_usd`.
- **Valuing a coin flow at 1.0 / current / most-recent price** — `txn_change_to_usd` fails loud instead; keep it that way.
- **Re-deriving flow sign from direction** — trust `change` sign verbatim (`deribit_txn.py:194-196`).
- **Coalescing a missing `change` to 0.0** — schema-drift must fail loud (`deribit_txn.py:559-566`).
- **Silently degrading an unvaluable inverse flow to `balance_error`/heuristic capital** — the OLD scalar path did
  this via `saw_unvalued_inverse_flow`; the new path fails loud (`LedgerValuationError`) so a mis-valued day can
  never be smuggled through as a warning.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Coin→USD flow valuation | A new inverse converter | `txn_change_to_usd` (`deribit_txn.py:178`) | One honest path; already fail-loud on missing/≤0 index and unknown coin |
| UTC-day bucketing of a flow | A local date parser | `_row_utc_day` (`deribit_txn.py:382`) | Shared boundary with pnl; prevents midnight drift (Pitfall #11) |
| Same-day index fetch | A new price endpoint call | `fetch_deribit_settlement_index` (`deribit_ingest.py:431`) | D-07-compliant, paged, non-fatal-on-error, cached |
| Flow → daily F_t aggregation | A custom per-day summer | `nav_twr._flows_to_daily_usd` (`nav_twr.py:111`) | Already sums same-day flows, fail-loud coerces, shares `_row_utc_day` |
| Contract shape | A dict/ad-hoc tuple per venue | `ExternalFlow` NamedTuple | Phase 76 reuses verbatim; positional unpack matches the core |

**Key insight:** every mechanism this phase needs already shipped in v1.7/Phase 73-74 and is revert-proof-tested.
The phase's value is *deleting* the imprecise scalar and *routing* dated flows through the existing honest path —
plus the one genuinely new correctness fix (Finding C1). Net new algorithmic code should be near-zero.

## Runtime State Inventory

Not a rename/refactor/migration phase in the data-migration sense, but it DELETES a code path and changes a
data-flow contract. Runtime-state check:

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | `csv_daily_returns` rows for Deribit keys are recomputed on next sync from the txn-log; NO stored flow scalar persists. Production recompute is GATED behind Phase 78 (shadow/dual-compute). | None in P75 — values change only after the Phase 78 switch |
| Live service config | None — no external service embeds the F1 scalar | None |
| OS-registered state | None | None |
| Secrets/env vars | Deribit read-only API keys (unchanged); `_DERIBIT_EMPTY_LEDGER_FLOOR_USD` C2 floor unchanged | None |
| Build artifacts | None | None |
| In-memory contract | `CompletenessReport.net_external_flow_usd`/`saw_unvalued_inverse_flow` (floats/bool) → replaced by `dated_external_flows: list[ExternalFlow]`. Only consumer is `job_worker.py:1976-1979`. | Update the dataclass + the single consumer; grep for any test asserting the old fields |

**Nothing found** in Live service config / OS-registered / Build artifacts — verified by grep of the two field names
across `analytics-service/` (only `deribit_ingest.py` producer + `job_worker.py` consumer).

## Common Pitfalls

### Pitfall 1: The flow-day settlement-index gap (Finding C1)
**What goes wrong:** an inverse BTC/ETH withdrawal on a no-trade day gets no `get_delivery_prices` fetch →
`LedgerValuationError` fails the whole job.
**Why:** `inverse_days_needing_index` only scans `CASH_BEARING_TYPES` (`deribit_txn.py:483`); flow types are `INFORMATIONAL`.
**How to avoid:** extend the planner to include inverse `_EXTERNAL_FLOW_TYPES` rows with nonzero `change` + no own index.
**Warning signs:** a test with a BTC withdrawal on a quiet day raises `LedgerValuationError`; LTP068 real-flow-day job fails permanent.

### Pitfall 2: Double-counting a flow (count-once)
**What goes wrong:** a flow lands in BOTH the realized `change` sum AND F_t → the ±100% fabrication.
**Why:** mis-classifying a flow type into `CASH_BEARING_TYPES`, or summing `_EXTERNAL_FLOW_TYPES` rows in `txn_rows_to_daily_records`.
**How to avoid:** rely on the existing skip (`deribit_txn.py:552-553`); the new flow fn reads `_EXTERNAL_FLOW_TYPES` only; add a
regression that a flow row is absent from the realized daily_pnl AND present exactly once in the F_t list.
**Warning signs:** cumulative return doubles the flow magnitude; a day's F_t equals its pnl contribution.

### Pitfall 3: Sign errors
**What goes wrong:** a withdrawal enters F_t as positive → return inflates instead of neutralizing.
**Why:** re-deriving sign from direction instead of trusting `change`.
**How to avoid:** `usd_signed = txn_change_to_usd(row)` — `change` sign (credit +/debit −) verbatim (`deribit_txn.py:194-196`).
**Warning signs:** a withdrawal day shows a positive spike in cumulative return.

### Pitfall 4: Linear-vs-inverse misclassification
**What goes wrong:** a USDC withdrawal gets index-multiplied (inflated ~60000×), or a BTC withdrawal passes through as USD (valued at ~0.5).
**Why:** bypassing `_row_is_linear` / `txn_change_to_usd`.
**How to avoid:** route every flow through `txn_change_to_usd` — it branches linear (passthrough) vs inverse (index) correctly.
**Warning signs:** a USDC flow of $1000 becomes $60M; a 0.5 BTC withdrawal becomes −$0.50.

### Pitfall 5: Flow-dominated day ≠ r_t==0
**What goes wrong:** acceptance asserts `r_t==0` for a near-total withdrawal, but the day is `flow_dominated_guard` NaN.
**Why:** `FLOW_DOM_RATIO = 1.0` breaks the chain-link when `|F_t| ≥ NAV_{t-1}` (`nav_twr.py:254`).
**How to avoid:** the pure-flow "r_t==0" fixture must use a flow < 100% of prior NAV; assert the guard+warning for a dominating flow.
**Warning signs:** a "pure-flow day" test expects 0.0 but gets NaN + `complete_with_warnings`.

### Pitfall 6: Orphan flow day fails loud
**What goes wrong:** a flow dated outside the pnl window raises `NavReconstructionError`.
**Why:** `_align_flows` refuses to drop cash it cannot place (`nav_twr.py:136-151`).
**How to avoid:** this is CORRECT behavior — never widen it to a silent drop. Ensure flow days fall inside the return window (they will, being in-band with the same crawl).

## Code Examples

### Building the dated flow list (recommended new fn in deribit_txn.py)
```python
# Source: composes txn_change_to_usd (deribit_txn.py:178) + _row_utc_day (:382) + _EXTERNAL_FLOW_TYPES (:339)
def deribit_dated_external_flows_usd(
    rows: Sequence[Mapping[str, Any]],
    *,
    supplemental_index: Mapping[tuple[str, str], float] | None = None,
) -> list[tuple[str, float]]:   # -> list[ExternalFlow]
    by_day: dict[str, float] = defaultdict(float)
    for row in rows:
        if not isinstance(row, Mapping):
            continue
        if str(row.get("type", "")) not in _EXTERNAL_FLOW_TYPES:
            continue
        change = float(row.get("change", 0.0) or 0.0)
        if change == 0.0:
            continue
        day = _row_utc_day(row.get("timestamp"))          # fail-loud on undatable
        ccy = str(row.get("currency", "")).upper()
        fb = supplemental_index.get((day, ccy)) if supplemental_index else None
        by_day[day] += txn_change_to_usd(row, fallback_index=fb)   # inverse → LedgerValuationError if no index
    return sorted(by_day.items())
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Net-scalar anchor correction `equity −= net_external_flow_usd`; inverse flows punted to `balance_error` | Dated per-day `ExternalFlow` list in the core `F_t`; inverse flows valued at same-day index or fail loud | Phase 75 (this) | LTP068's magnitude becomes honest; no ±100% fabrication from a mis-timed/dropped inverse flow |

**Deprecated/outdated:**
- `deribit_linear_external_flow_usd` (linear-only scalar, `deribit_txn.py:344`) — superseded by the dated fn; retire
  or keep only if a caller still needs the linear net (none will after F1 deletion).

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `usdc_reward` should be treated as an external FLOW (excluded from returns) rather than return-bearing income | Q1 / Open Q1 | If a reward is really performance income, excluding it as F_t understates return; if it's a subsidy, including it in returns overstates skill. Currently `_EXTERNAL_FLOW_TYPES` includes it (flow) — a locked-by-inertia choice, not evidence-grounded for the TWR context. |
| A2 | A deposit/withdrawal row's `change` is denominated in the crawl currency's coin units (BTC/ETH) exactly like a settlement row | Q3 | If deposit `change` were already USD-denominated on an inverse subaccount, index-multiplying would inflate it ~60000×. `[ASSUMED]` from the per-currency crawl model + `change` schema; NOT confirmed against a real LTP068 inverse deposit row (none in repo). MUST be verified against a live/captured inverse deposit before the Phase 78 production switch. |
| A3 | LTP068's inflating flows are BTC withdrawals on quiet days (the acceptance scenario) | Q6 | If LTP068's flows are actually linear (USDC) or dominated by transfers, the inverse-valuation acceptance proves the mechanism but not the specific account; Phase 78 canary is the real gate. |

## Open Questions

1. **[LIVE] Is `usdc_reward` an external flow or return-bearing income?** (A1) — It is currently in
   `_EXTERNAL_FLOW_TYPES` (treated as a flow, subtracted from anchor / excluded from returns). Semantically it is a
   platform yield subsidy = income the manager earned. For flow-aware TWR, classifying it as F_t means the subsidy
   does NOT count as performance. **Recommendation:** keep the CURRENT classification (flow) for this phase to
   preserve behavior parity, and flag it explicitly for the Phase 78 golden-parity account-by-account review — do
   NOT silently re-classify. A reward is small relative to the ±100% risk; not this phase's battle.
2. **[LIVE] Does the acceptance "pure-flow day → r_t==0" hold for LTP068's largest withdrawal?** (Pitfall 5) — If the
   real inflating withdrawal is ≥100% of prior-day NAV it trips `flow_dominated_guard` (NaN + warning), not 0.0.
   **Recommendation:** author TWO acceptance cases — (a) a material-but-sub-NAV flow asserting `r_t==0`, and (b) a
   dominating flow asserting the guard fires + `complete_with_warnings`. Confirm which LTP068's real day is against
   captured rows before Phase 78.
3. **[RESOLVED] Where is the fail-loud site for an unvaluable inverse flow?** — `deribit_txn.py:216-223`
   (`txn_change_to_usd` raises `LedgerValuationError`), caught permanent at `job_worker.py:1917-1942`. No new
   handler needed; the dated-flow path inherits it.
4. **[RESOLVED] Does anything besides job_worker consume the net scalar?** — No; grep confirms sole consumer
   `job_worker.py:1976-1979`. Safe to delete + replace the `CompletenessReport` fields.
5. **[RESOLVED] Is `_row_utc_day` the shared bucketing helper?** — Yes; `nav_twr.py:43` imports it; both realized
   pnl and flows date through it → no midnight drift.
6. **[LIVE] Should real LTP068 txn-log rows be captured to `docs/evidence/` as an evidence trail?** — The tests run
   on synthetic stub rows (Q6). A captured evidence JSON (like `drb01/drb02/drb03`) would ground A2/A3 but is not
   required for CI. **Recommendation:** capture one inverse deposit + one withdrawal row to `docs/evidence/` during
   Phase 78 live canary work; synthetic fixtures suffice for Phase 75 unit/integration proof.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| CI-3.12 venv (pandas/numpy pinned) | Running the analytics suite | ✓ | 3.12 | — (local 3.14 SIGSEGVs on pandas tslibs) |
| pandas / numpy | `nav_twr` core (unchanged) | ✓ | 2.2.3 / 2.4.6 | — |
| Deribit `public/get_delivery_prices` | Same-day inverse index (I/O, live only) | ✓ (public endpoint) | — | Fail loud if a needed day is missing (never period-end price) |
| ccxt | NOT used by the pure deribit_txn/nav_twr modules | n/a | 4.5.59 pinned | — |

**Test command (CI-3.12 venv):**
```bash
/private/tmp/claude-501/-Users-helios-mammut-claude-projects-quantalyze/fcce1bd5-15ef-4e42-adb9-85cfc9ad484c/scratchpad/venv312/bin/python \
  -m pytest analytics-service/tests/test_deribit_txn.py analytics-service/tests/test_deribit_ingest.py \
  analytics-service/tests/test_nav_twr.py analytics-service/tests/test_derive_broker_dailies_dualmode.py -x
```

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | pytest (+ pytest-asyncio for the async crawl) |
| Config file | `analytics-service/` pytest config; `--cov-fail-under=80` gate |
| Quick run command | `python -m pytest tests/test_deribit_txn.py tests/test_nav_twr.py -x` (CI-3.12 venv) |
| Full suite command | `python -m pytest` in `analytics-service/` (CI-3.12 venv; ~2977 passed / 92 skipped baseline) |

### Phase Requirements → Test Map
| Req | Behavior | Test Type | Command | File Exists? |
|-----|----------|-----------|---------|-------------|
| FLOW-01 | `ExternalFlow` unpacks positionally + validates finite USD | unit | `pytest tests/test_external_flows.py -x` | ❌ Wave 0 (new module + test) |
| FLOW-02 | Inverse BTC withdrawal → correctly-signed event-time `F_t` on its actual day | unit | `pytest tests/test_deribit_txn.py -k dated_external_flow -x` | ❌ Wave 0 (extend test_deribit_txn.py) |
| FLOW-02 | Flow-day settlement index is fetched (Finding C1) | unit | `pytest tests/test_deribit_ingest.py -k flow_day_settlement -x` | ❌ Wave 0 |
| FLOW-02 | Linear (USDC) flow passes through as USD; inverse (BTC) index-multiplied | unit | `pytest tests/test_deribit_txn.py -k flow_linear_vs_inverse -x` | ❌ Wave 0 |
| FLOW-02 | Unvaluable inverse flow (no index) → `LedgerValuationError` (RISKY fail-loud) | unit | `pytest tests/test_deribit_txn.py -k flow_unvaluable_fails_loud -x` | ❌ Wave 0 |
| FLOW-02 | Count-once: a flow row is ABSENT from realized daily_pnl AND present once in F_t | unit | `pytest tests/test_deribit_txn.py -k flow_count_once -x` | ❌ Wave 0 |
| FLOW-02 | F1 scalar deleted; dated flows threaded to `combine_realized_and_funding` | integration | `pytest tests/test_derive_broker_dailies_dualmode.py -k deribit_dated_flows -x` | ❌ Wave 0 (extend) |
| FLOW-02 | LTP068 acceptance: pure-flow day → `r_t==0` (sub-NAV) / guard fires (dominating) | integration | `pytest tests/test_deribit_ingest.py -k ltp068_flow_neutral -x` | ❌ Wave 0 |

### RISKY fail-loud + no-fabricated-day proofs (mutation-honest)
Each of these MUST fail if the flow is valued at the wrong time, at 1.0, at a current price, or dropped:
1. **Sign proof** — a BTC withdrawal (`change < 0`) yields a NEGATIVE `usd_signed`; mutating the sign flips the test.
2. **Event-time valuation proof** — the `F_t` equals `change × same_day_index`; substituting a different-day index
   (or 1.0, or a current price) changes the value → test RED. Assert against the specific same-day delivery price.
3. **Dropped-flow proof** — removing the flow from the F_t list changes the reconstructed NAV / cumulative return →
   test RED (the flow-neutral property only holds if the flow is present).
4. **Fail-loud proof** — an inverse flow row with no own index AND no supplemental index raises `LedgerValuationError`
   naming the row (never returns 0.0 / passthrough).
5. **Count-once proof** — the flow contributes to `F_t` exactly once and to the realized sum zero times; neutering
   the `INFORMATIONAL_TYPES` skip makes the realized sum double-count → test RED.
6. **Flow-day index-fetch proof (C1)** — a quiet-day inverse withdrawal triggers `inverse_days_needing_index` to
   include its `(day, ccy)`; reverting the C1 extension → the withdrawal fails loud → test RED.

### Sampling Rate
- **Per task commit:** `pytest tests/test_deribit_txn.py tests/test_external_flows.py -x` (CI-3.12 venv)
- **Per wave merge:** `pytest tests/test_deribit_txn.py tests/test_deribit_ingest.py tests/test_nav_twr.py tests/test_derive_broker_dailies_dualmode.py`
- **Phase gate:** full analytics suite green + coverage ≥80% before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `tests/test_external_flows.py` — covers FLOW-01 (new module)
- [ ] `services/external_flows.py` — the new pure contract module
- [ ] Extend `tests/test_deribit_txn.py` — dated-flow fn + inverse valuation + count-once + fail-loud (FLOW-02)
- [ ] Extend `tests/test_deribit_ingest.py` — flow-day settlement-index fetch (Finding C1) + LTP068 flow-neutral acceptance
- [ ] Extend `tests/test_derive_broker_dailies_dualmode.py` — F1 deletion + dated-flow threading integration

## Security Domain

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V5 Input Validation | yes | Untrusted txn-log rows: `_coerce_float` fail-loud on non-numeric `change`/`index_price`; unknown type/currency → `LedgerValuationError` (`deribit_txn.py:57-71, 204-211`) |
| V6 Cryptography | no | — |
| V2/V3/V4 Auth/Session/Access | no | Pure valuation module; Deribit read-only keys handled upstream, unchanged |

| Threat Pattern | STRIDE | Mitigation |
|----------------|--------|------------|
| Scrubbed error leak of account-size USD into `compute_jobs.error_message` | Information Disclosure | `scrub_freeform_string` on every stamped message; no raw NAV/flow USD logged (`nav_twr.py:20-22 T-73-02`, `job_worker.py:1929`) |
| Schema-drift silent cash zeroing | Tampering | Missing `change` fails loud (`deribit_txn.py:559-566`); absent≠0 |

## Sources

### Primary (HIGH confidence — codebase, VERIFIED)
- `analytics-service/services/deribit_txn.py` — taxonomy (`:300-380`), `txn_change_to_usd` (`:178-231`),
  `inverse_days_needing_index` (`:458-504`), `_row_utc_day` (`:382-419`), `deribit_linear_external_flow_usd` (`:344-369`)
- `analytics-service/services/nav_twr.py` — `_flows_to_daily_usd` (`:111-133`), `reconstruct_nav_and_twr` (`:293-319`),
  `_guard_denominator` (`:233-256`), shared `_row_utc_day` import (`:43`)
- `analytics-service/services/deribit_ingest.py` — `fetch_deribit_settlement_index` (`:431-502`), crawl + supplemental
  wiring (`:588-693`), `CompletenessReport` (`:510-533`)
- `analytics-service/services/job_worker.py` — F1 scalar site (`:1968-1979`), LedgerValuationError catch (`:1917-1942`),
  `combine_realized_and_funding` call (`:2012-2014`)
- `analytics-service/services/broker_dailies.py` — `combine_realized_and_funding` (`:119-149`, already threads `external_flows`)
- `analytics-service/tests/test_deribit_ingest.py` / `test_deribit_txn.py` — stub/monkeypatch test pattern (`:22-68, 650, 682`)
- `.planning/REQUIREMENTS.md` (FLOW-01/02), `.planning/STATE.md` (v1.7 notes), `75-CONTEXT.md` (locked decisions)

### Secondary
- Deribit API `public/get_delivery_prices` / `private/get_transaction_log` semantics — as documented in the
  in-repo design pins (`deribit-ingestion-design.md`, referenced `deribit_txn.py:9`) and `docs/evidence/drb0{1,2,3}-*.json`

## Metadata

**Confidence breakdown:**
- Standard stack / no-new-deps: HIGH — verified against pinned requirements + module imports
- Taxonomy (Q1): HIGH — verified frozensets + disjointness asserts in source
- Inverse valuation (Q3) + fail-loud site: HIGH — verified `txn_change_to_usd` + call sites
- Finding C1 (flow-day index gap): HIGH — verified the `CASH_BEARING_TYPES` filter excludes flow types
- F1 deletion (Q2): HIGH — grep-confirmed sole consumer
- Acceptance/fixtures (Q6): MEDIUM — VCR-vs-stub discrepancy resolved by inspection; LTP068 real rows NOT in repo (A2/A3 assumed)
- `usdc_reward` classification (Open Q1): LOW — no evidence-grounded decision for the TWR context; deferred to Phase 78 review

**Research date:** 2026-07-06
**Valid until:** 2026-08-05 (stable in-repo surface; re-verify if `deribit_txn.py` / `nav_twr.py` change before planning)
