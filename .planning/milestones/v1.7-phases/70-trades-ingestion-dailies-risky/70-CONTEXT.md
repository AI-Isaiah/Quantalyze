# Phase 70: Trades Ingestion & Dailies (RISKY) - Context

**Gathered:** 2026-07-04
**Status:** Ready for planning
**Mode:** Smart discuss (`--auto` — recommendations auto-accepted per the standing decide-autonomously directive)
**⚠ RISKY PHASE** — flag for the risky-phase review gate. Inverse coin→USD conversion, funding-netting dedup, and subaccount-completeness are the milestone's silent-corruption risks (BYB-02 class: every dashboard renders green while the number is wrong).

> **⚠ RE-ANCHORED / SUPERSEDED (2026-07-05):** The LOCKED design
> `analytics-service/docs/deribit-ingestion-design.md` (grounded in the Wave-0 evidence JSON) supersedes
> three decisions below — read the design doc as authoritative where they conflict:
> - **D-02** (count gate vs 18,778 / 21,014 / 61,248) → RE-ANCHORED to a **ledger-completeness gate**
>   (`assert_ledger_complete`: every scope×currency reached continuation=null), NOT a fill-count
>   reconciliation. Wave-0 BLOCKING_FINDING proved the known totals reconcile to NO API surface.
> - **D-09** (funding = separate settlement rows + native-id dedup) → SUPERSEDED: funding is booked
>   INSIDE the `settlement` cashflow (A3), so there is NO separate funding stream and NO native-id
>   funding dedup — the single settlement sum is count-once by construction.
> - **D-11** (flip `funding_fees_exchange_check` to include deribit) → SUPERSEDED: NO migration this
>   phase (Deribit funding is never persisted to `funding_fees`; the CHECK stays 3-exchange).
>
> Traceability only — the 6-plan set already reflects the re-anchored design; the plans do not change for this.

<domain>
## Phase Boundary

A REAL Deribit key's full trading history — perps, futures, options, inverse contracts, funding — produces HONEST per-key daily returns through the ONE existing `realized+funding → CSV → compute_all_metrics` path, and Overview/Scenario/factsheet read that same source. Requirements: DRB-04..08.

**OUT of scope:** allocator-side positions / f3 Path-B lift (Phase 71); live onboarding of the 3 LTP accounts as verified strategies + rotation (Phase 72); the onboarding UI (Phase 69, shipped). This phase is the analytics-service ingestion + dailies core only.
</domain>

<decisions>
## Implementation Decisions

### ⭐ SC-1a — Subaccount completeness (CRITICAL — the silent-corruption gate)
- **D-01:** Ingestion MUST fetch history **per-subaccount**, not main-account-only. The 67-03 live harness captured only **3.5% / 4.1% / 0.8%** of the known **18,778 / 21,014 / 61,248** trade totals with `trade_max_pages_hit=false` — the LTP trading lives in the **2 subaccounts per key** (`get_subaccounts` → `count=2`). Main-account-only ingestion renders a silently-empty track record. The per-currency fetch loop iterates **subaccounts × currencies**; enumerate subaccounts via `private/get_subaccounts` and pass `subaccount_id` on the trades / transaction-log calls. **This supersedes the scout's "no subaccount fetch needed for MVP" note — that reading is WRONG against the recorded ground truth.**
- **D-02 (acceptance gate):** SC-1's count verification (per-account totals must reconcile against 18,778 / 21,014 / 61,248) is a **hard gate** — dailies are NOT trusted, and the pipeline must FAIL LOUD (not render a partial track record), until the fetched counts match the known totals within a documented tolerance. This is the DRB-04 "verified against known counts" criterion.

### SC-1b — Full trade-history fetch (DRB-04)
- **D-03:** Add a `deribit` branch to `fetch_raw_trades` (`analytics-service/services/exchange.py:1804-1812`) + implement `_fetch_raw_trades_deribit`, lifting the harness `_paginate_trades` pattern (`deribit_ground_truth.py:298-381`): `private/get_user_trades_by_currency_and_time`, per-currency, `has_more` + `cursor = last_trade.timestamp`, with the boundary-overlap stall guard (harness IN-8: `has_more=True` + `new_in_page==0` + `last_ts==cursor` → advance/stop, do not spin). Currencies are **enumerated from the account** (held/available balances), never hard-coded.
- **D-04:** Map each Deribit trade → the existing `FillRow` TypedDict (`exchange.py:517-580`) with a **unique `exchange_fill_id`** (Deribit `trade_id`) so `diff_strategy_fills` (`reconciliation.py:216+`) dedups on the `(exchange, exchange_fill_id)` primary key. Trades persist to the existing `trades` table via the existing upsert.

### SC-2 — Instrument classification; options via txn-log (DRB-05)
- **D-05:** Lift `classify_instrument` (`deribit_ground_truth.py:148-165`, pure/never-raises) into a shared production module. Classify perp / future / option / combo AND linear vs inverse (`_USDC`/`_USDT`/`_EURR` marker → linear; else inverse; `-C`/`-P` → option; expiry-regex → future). Classify from the **transaction-log `instrument_name`**, not solely the trades endpoint (harness caveat: the trades endpoint under-returns; the txn-log is the more complete source).
- **D-06:** **Options + deliveries enter dailies as realized cash flows FROM THE TRANSACTION LOG** (option premium + `delivery`/`options_settlement_summary` rows are `cashflow`), NEVER through perp fill math. There must be no code path that runs an option through the perp realized-PnL computation. This is the DRB-05 "options-inclusive, options never run through perp fill math" criterion.

### SC-3 — Inverse coin→USD P&L (DRB-06 — HIGHEST RISK)
- **D-07:** Inverse (coin-margined) contract P&L is coin-denominated (`cashflow` in the base coin, e.g. ETH-PERPETUAL settles in ETH). Convert **coin→USD at the EVENT-TIME index price** (the price at the settlement/trade timestamp, NOT the current price — cross-time is category-invalid, the same class as the `broker_dailies` anchor lesson). **Sign-correct on shorts.** This is net-new math — no existing inverse-margined path exists in the codebase (all fills today are treated as USD-quoted). Unit-test against **hand-computed fixtures** (DRB-06 hard requirement): a known inverse short and long, coin cashflow → expected USD, sign verified.
- **D-08 (source of inverse realized P&L):** PREFER sourcing inverse realized P&L from the **txn-log `cashflow`/settlement** (coin) converted at event-time index, consistent with D-06 (options/deliveries also via txn-log) — rather than reconstructing coin P&L from fills. Planner/research confirms whether the txn-log carries an event-time `index_price`, or whether a separate index-price lookup (Deribit `get_index_price` at timestamp) is needed. This is a RESEARCH open question (see canonical refs).

### SC-4 — Funding native-id dedup, no bucket, no double-count (DRB-07)
- **D-09:** Funding = separate `type=settlement` transaction-log rows, amount in `cashflow` (coin-denominated → convert coin→USD per D-07). Ingest from the txn-log (`_paginate_txn_log`, `deribit_ground_truth.py:384-435`, continuation token). Dedup on a **NATIVE-ID / exact-timestamp axis** — a Deribit-specific match_key built from the txn-log record id (or exact-ms timestamp + instrument), **NOT a floor bucket**. Deribit MUST NOT be added to `_FUNDING_BUCKET_HOURS` — the existing guard comment (`funding_fetch.py:~209-220`) stays; this is the BYB-02 lesson (a continuous-funding venue's bucket silently collapses distinct events).
- **D-10:** No double-count: funding settlement cashflow enters dailies via the funding path; it must NOT also be counted in realized trade PnL (funding is a distinct txn-log type from trades). The combine step (`combine_realized_and_funding`) already sums the two disjoint streams — keep them disjoint at the source.
- **D-11 (migration):** This flips `funding_fees_exchange_check` (`20260602180000...:59`) to **include deribit** — the migration Phase 68 explicitly deferred to Phase 70, landed TOGETHER with the native-id dedup axis and its parity-test pin. Auto-applies to prod on merge (Supabase Migrate) → **migration-reviewer + rls-policy-auditor gate before PR** (memory rule). Planner decides whether the existing `match_key` text column holds `deribit:<txn_id>` (no schema change) or a new column/convention is needed.

### SC-5 — The ONE compute path (DRB-08)
- **D-12:** Per-key realized + funding → `combine_realized_and_funding` (`broker_dailies.py:119-134`) → `trades_to_daily_returns_with_status` (anchor-to-today, `transforms.py:70-224`) → `csv_daily_returns` → `compute_all_metrics` (`metrics.py:352-415`; requires ascending DatetimeIndex + float64). Overview/Scenario/factsheet all read `csv_daily_returns` — same honest source. NO Deribit-specific dailies/metrics path.
- **D-13 (Source widening):** Widen `adapter.py` `Source` Literal + `SUPPORTED_SOURCES` + the `process_key`/`long_fetch` dispatch to include `deribit` (68-CONTEXT OQ2 explicitly parked this widening for Phase 70). Implement the Deribit ingestion adapter / wire `_fetch_raw_trades_deribit` + Deribit funding into `long_fetch.py` (`services/ingestion/long_fetch.py:46-338`, `get_adapter(source)`).

### Error handling
- **D-14:** Handle `-32602 "not supported for wallet type"` (skip non-margin currencies like LINK/BCH/AVAX/ADA gracefully — observed in 67-03) and `10028 too_many_requests` (rate-limit backoff). Per-subaccount/per-currency errors degrade gracefully, BUT the D-02 count-verification gate still fires — a graceful skip that drops the count below the known total FAILS LOUD, never renders as complete.

### Testing (the RISKY-phase silent-corruption guard)
- **D-15:** Mandatory regression tests, each failing without its fix: (a) inverse coin→USD hand-computed fixtures, sign-correct short + long (DRB-06); (b) funding native-id dedup — no floor-bucket collapse, no double-count vs realized (DRB-07), proven to fail under a bucket axis; (c) subaccount-iteration proof — a synthetic 2-subaccount fixture where main-account-only would drop >90% and the count gate catches it (DRB-04/D-02); (d) options-as-cashflow — an option premium/delivery enters dailies via txn-log, NEVER perp math (DRB-05); (e) the ONE-path test — Deribit realized+funding flows through `compute_all_metrics` producing the same shape as bybit/okx (DRB-08). Cross-runtime parity for any match_key change (3 runtimes: Python `_build_match_key`, SQL, TS `buildFundingMatchKey`). Live/count-verification against 18,778/21,014/61,248 is a harness/live-gated check (skipIf-no-live-DB), NOT CI-runnable — but the synthetic subaccount fixture IS.

### Claude's Discretion
- Per-currency/subaccount concurrency (sequential vs bounded semaphore, mirroring bybit's `Semaphore(5)`).
- Exact Deribit funding match_key format (`deribit:<subaccount>:<txn_id>` vs exact-ms+instrument) — as long as it's native-id/exact-ts, never a bucket, and cross-runtime-pinned.
- Whether inverse realized P&L comes from txn-log cashflow (preferred, D-08) vs fill reconstruction.
- Whether `funding_fees_exchange_check` widening needs a schema/column change or reuses the `match_key` text column.
</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### The recorded ground truth (design against this — it is live-validated, authoritative)
- `analytics-service/docs/deribit-ground-truth.md` — the DRB-01 answers + the **CRITICAL subaccount under-fetch finding** (3.5/4.1/0.8% vs 18,778/21,014/61,248; funding = separate `type=settlement` cashflow rows; inverse coin margin; instrument mix options+inverse_perpetual+spot; classify from txn-log; errors `-32602`/`10028`). This supersedes any scout claim to the contrary.
- `analytics-service/docs/evidence/drb01-deribit-ground-truth-2026-07-04.json` — sanitized per-account evidence (counts, instrument samples, subaccount observation).

### The harness to lift into production
- `analytics-service/scripts/deribit_ground_truth.py` — `_paginate_trades` (:298-381), `_paginate_txn_log` (:384-435), `classify_instrument` (:148-165), per-currency enum + `get_subaccounts` (:550-606). Phase 70 productionizes these.

### The ONE dailies path (do not fork)
- `analytics-service/services/broker_dailies.py` — `funding_rows_to_daily_pnl_records` (:73-104), `combine_realized_and_funding` (:119-134), anchor-to-today docstring (:1-37).
- `analytics-service/services/transforms.py` — `trades_to_daily_returns_with_status` (:70-224, anchor-to-today reconstruction).
- `analytics-service/services/metrics.py` — `compute_all_metrics` (:352-415, input contract: ascending DatetimeIndex + float64).

### Trade fetch + funding + dedup seams
- `analytics-service/services/exchange.py` — `fetch_raw_trades` dispatch (:1775-1827, ADD deribit at :1812), `FillRow` (:517-580), `EXCHANGE_CLASSES` deribit (:788), `create_exchange` passphrase (:792-819).
- `analytics-service/services/exchange_pagination.py` — `walk_paginated` + `ProviderPaginationContract` (:54-102, `inst_types` fan-out for linear/inverse) — the pagination framework to reuse.
- `analytics-service/services/funding_fetch.py` — `_FUNDING_BUCKET_HOURS` + guard comment (:~209-220, deribit stays EXCLUDED), `_build_match_key`, upsert-on-match_key.
- `analytics-service/services/reconciliation.py` — `diff_strategy_fills` (:216+, primary dedup on `exchange_fill_id`).
- `analytics-service/services/ingestion/long_fetch.py` (:46-338) + `adapter.py` (`Source` Literal + `get_adapter`) — widen for deribit.
- `analytics-service/services/key_permissions.py` — `detect_deribit_permissions` (:308-380, production-ready; scope gate already done in P68).
- `supabase/migrations/20260602180000_funding_fees_exchange_check.sql` — the CHECK that flips to include deribit this phase.

### Prior phase decisions
- `.planning/phases/68-boundary-wiring-key-validation/68-CONTEXT.md` — OQ2 (Source widening = Phase 70), the funding-exclusion deferral (`_FUNDING_BUCKET_HOURS` + `funding_fees_exchange_check` flip TOGETHER here), scope semantics.

### Open research questions (for the researcher)
- Event-time index price for inverse coin→USD: does the txn-log carry `index_price` at the event, or is a `get_index_price`-at-timestamp lookup needed? What's the coin→USD convention for ETH/BTC-margined settlements?
- Exact `type` values for funding vs option-settlement vs delivery in the txn-log, and the native record-id field for the dedup key.
- Does `private/get_user_trades_by_currency_and_time` / `get_transaction_log` accept a `subaccount_id` param, or must the harness re-auth per subaccount key? (67-03 saw 2 subaccounts per KEY.)
</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- The whole dailies tail (`combine_realized_and_funding` → `transforms` → `compute_all_metrics`) is exchange-agnostic and already correct — Deribit only needs to produce the same `{timestamp, side, price, order_type:"daily_pnl"}` record shape (funding) + realized records.
- `FillRow` + `diff_strategy_fills` primary-key dedup already handle trade persistence — Deribit just needs a unique `exchange_fill_id`.
- `detect_deribit_permissions` + `EXCHANGE_CLASSES["deribit"]` + passphrase support already exist (Phase 06 + 68) — construction and scope validation are done.
- `classify_instrument` + the pagination patterns exist in the harness — lift, don't reinvent.

### Established Patterns
- Per-exchange fetch is a branch in `fetch_raw_trades` + a `_fetch_raw_trades_<ex>` function using `walk_paginated` with a `ProviderPaginationContract`. Bybit already fans out linear+inverse categories (`inst_types`) — the closest analog for Deribit's inverse handling.
- Funding dedup is a `match_key` + `ON CONFLICT` upsert; the axis is per-venue (bucket for hourly venues, native-id for continuous Deribit).

### Integration Points
- `long_fetch.py` `get_adapter(source)` dispatches ingestion per source → widen `Source` + add the Deribit path.
- Migration auto-applies to prod on merge (Supabase Migrate) — the `funding_fees_exchange_check` flip must pass migration-reviewer + rls-auditor; test project must be caught up before sql-tests/e2e (memory: DB-lag).
- Full pytest suite segfaults locally (Py3.14 pandas ABI) — use targeted file lists; CI (Py3.12) is the full-suite authority (memory).
</code_context>

<specifics>
## Specific Ideas
- The subaccount finding is the load-bearing risk: a track record that silently captures <5% of trades is worse than none. The count-verification gate (18,778/21,014/61,248) is the phase's honesty anchor.
- Inverse coin→USD at EVENT-TIME index (not current) — the same cross-time category error the `broker_dailies` anchor-shift lesson already burned us on.
- Funding native-id dedup, never a bucket — the BYB-02 lesson applied to a continuous-funding venue.
</specifics>

<deferred>
## Deferred Ideas
- Allocator-side Deribit positions (lift f3 Path-B `DeribitNotSupportedError`, derivative positions render) — Phase 71.
- Live onboarding of the 3 LTP accounts as 3 verified strategies + secret rotation — Phase 72.
- Saved-Deribit-key display casing/icon polish (ApiKeyManager/SyncBadge/ScenarioComposer/queries) — Phase 71 carry-forward from P69 review.

None — discussion stayed within phase scope.
</deferred>

---

*Phase: 70-trades-ingestion-dailies-risky*
*Context gathered: 2026-07-04*
