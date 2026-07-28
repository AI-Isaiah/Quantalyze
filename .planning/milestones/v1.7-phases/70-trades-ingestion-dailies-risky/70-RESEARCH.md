# Phase 70: Trades Ingestion & Dailies (RISKY) — Research

**Researched:** 2026-07-04
**Domain:** Deribit derivative ingestion (ccxt raw endpoints) → realized+funding dailies → `compute_all_metrics` (analytics-service, Python)
**Confidence:** HIGH on API mechanics & code seams (Deribit official docs + verified code landmarks); MEDIUM-LOW on two live-only facts (settlement-cashflow composition and subaccount-scope reachability) — both require a widened harness re-run before the conversion/fetch source is locked.

## Summary

Every load-bearing code seam the scout mapped VERIFIES against the source: `fetch_raw_trades` dispatch (`exchange.py:1803-1813`), `FillRow` (`exchange.py:517-547`), `EXCHANGE_CLASSES["deribit"]` (`exchange.py:788`), the `_build_match_key` fail-loud gate + `_FUNDING_BUCKET_HOURS` guard comment (`funding_fetch.py:216-276`), `combine_realized_and_funding` (`broker_dailies.py:119-134`) and its ONLY production caller `run_derive_broker_dailies_job` (`job_worker.py:1823-1862`), and the Source Literal + `SUPPORTED_SOURCES`/`get_adapter` widening points (`adapter.py:28`, `ingestion/__init__.py:93,140-145`). The dailies tail is exchange-agnostic and correct — Deribit only needs to emit the same `daily_pnl`-shaped realized records + funding rows.

The two RESEARCH open questions that gated the plan are now RESOLVED from Deribit's official API reference: **(1)** the `private/get_transaction_log` row carries an event-time `index_price` field (plus `mark_price`, `price`, and a unique integer `id`), so inverse coin→USD is `usd = cashflow_coin × index_price` with the sign carried by `cashflow` — no separate historical-index call is needed IF the field is populated on settlement rows; **(2)** BOTH `get_transaction_log` and `get_user_trades_by_currency_and_time` accept an optional `subaccount_id` parameter, and `get_subaccounts` returns each subaccount's `id` — so the fetch strategy is `enumerate subaccounts → loop subaccount_id × currency`.

TWO facts CANNOT be closed from docs+evidence alone and are flagged LOUDLY below: **(a)** the DRB-01 harness whitelist (`deribit_ground_truth.py:101-112`) did NOT capture `index_price`/`mark_price`/`id`, so we have ZERO live proof those fields are populated on `type=settlement` rows; and **(b)** Deribit documents `settlement.cashflow` as "Realized session PNL (since last settlement)" — which **bundles funding + price PnL**, contradicting the clean "funding is a separate stream" mental model and creating a real double-count risk if inverse-perp `type=trade` rows also carry cashflow. Both must be resolved by a **one-line harness whitelist widening + re-run** (Wave 0, live/Railway) BEFORE the coin→USD source and the realized/funding split are locked.

**Primary recommendation:** Productionize the harness pagination + `classify_instrument` into a shared module; drive ingestion off the **transaction log** (more complete than the trades endpoint) looping `subaccount_id × currency`; convert inverse coin→USD at the row's own `index_price` (fail loud if absent — never current price); dedup funding on native `id` via `deribit:<id>` in the existing `match_key` TEXT column (no schema change); gate the whole pipeline behind a **hard count-reconciliation to 18,778 / 21,014 / 61,248** that FAILS LOUD until totals match.

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01 (CRITICAL):** Ingestion MUST fetch history per-subaccount (`get_subaccounts` → `count=2` per key). Per-currency loop iterates **subaccounts × currencies**; enumerate via `private/get_subaccounts`, pass `subaccount_id` on trades / txn-log calls. **Supersedes the scout's "no subaccount fetch for MVP" note — that reading is WRONG against ground truth.**
- **D-02 (acceptance gate):** Per-account totals MUST reconcile to 18,778 / 21,014 / 61,248 within a documented tolerance. Pipeline FAILS LOUD (does not render a partial track record) until counts match. This is the DRB-04 "verified against known counts" criterion.
- **D-03:** Add a `deribit` branch to `fetch_raw_trades` (`exchange.py:1804-1812`) + `_fetch_raw_trades_deribit`, lifting harness `_paginate_trades` (`:298-381`): `private/get_user_trades_by_currency_and_time`, per-currency, `has_more` + `cursor=last.timestamp`, with the IN-8 boundary-overlap stall guard. Currencies enumerated from the account, never hard-coded.
- **D-04:** Map each Deribit trade → `FillRow` with a unique `exchange_fill_id` (Deribit `trade_id`) so `diff_strategy_fills` dedups on `(exchange, exchange_fill_id)`. Persist to `trades` via existing upsert.
- **D-05:** Lift `classify_instrument` into a shared production module; classify perp/future/option/combo AND linear-vs-inverse; classify from the **txn-log `instrument_name`**, not solely the trades endpoint.
- **D-06:** Options + deliveries enter dailies as realized cash flows FROM THE TRANSACTION LOG (never perp fill math). No code path runs an option through perp realized-PnL.
- **D-07:** Inverse P&L is coin-denominated; convert coin→USD at the **EVENT-TIME index price** (NOT current). Sign-correct on shorts. Unit-test against hand-computed fixtures.
- **D-08:** PREFER sourcing inverse realized P&L from the txn-log `cashflow`/settlement (coin) converted at event-time index, rather than fill reconstruction. Researcher confirms whether the txn-log carries an event-time `index_price` or a separate lookup is needed.
- **D-09:** Funding = separate `type=settlement` txn-log rows, amount in `cashflow` (coin→USD per D-07). Dedup on NATIVE-ID / exact-timestamp axis, NOT a floor bucket. Deribit MUST NOT be added to `_FUNDING_BUCKET_HOURS`.
- **D-10:** No double-count: funding enters via the funding path; must NOT also be counted in realized trade PnL. Keep the two streams disjoint at the source.
- **D-11 (migration):** Flip `funding_fees_exchange_check` to include deribit, landed TOGETHER with the native-id dedup axis + parity-test pin. Auto-applies to prod on merge → migration-reviewer + rls-policy-auditor gate before PR. Planner decides `match_key` reuse vs new column.
- **D-12:** Per-key realized + funding → `combine_realized_and_funding` → `trades_to_daily_returns_with_status` → `csv_daily_returns` → `compute_all_metrics`. NO Deribit-specific dailies/metrics path.
- **D-13:** Widen `adapter.py` `Source` Literal + `SUPPORTED_SOURCES` + `process_key`/`long_fetch` dispatch to include `deribit`; wire `_fetch_raw_trades_deribit` + Deribit funding into `long_fetch.py`.
- **D-14:** Handle `-32602 "not supported for wallet type"` (skip non-margin currencies gracefully) and `10028 too_many_requests` (backoff). Graceful skips still fire the D-02 count gate — a skip that drops below the known total FAILS LOUD.
- **D-15:** Mandatory regression tests, each failing without its fix — see Validation Architecture below.

### Claude's Discretion

- Per-currency/subaccount concurrency (sequential vs bounded semaphore, mirroring bybit's `Semaphore(5)`).
- Exact Deribit funding match_key format (`deribit:<subaccount>:<txn_id>` vs exact-ms+instrument) — as long as native-id/exact-ts, never a bucket, cross-runtime-pinned.
- Whether inverse realized P&L comes from txn-log cashflow (preferred, D-08) vs fill reconstruction.
- Whether `funding_fees_exchange_check` widening needs a schema/column change or reuses the `match_key` text column.

### Deferred Ideas (OUT OF SCOPE)

- Allocator-side Deribit positions / f3 Path-B lift → Phase 71.
- Live onboarding of the 3 LTP accounts as verified strategies + rotation → Phase 72.
- Saved-Deribit-key display casing/icon polish → Phase 71 carry-forward.
- v2: EURR FX-exposure flag, live-Greeks view, combo-leg attribution.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| DRB-04 | Full trade history via per-currency loop (enumerated, never hard-coded) with manual `has_more` pagination — verified against 18,778/21,014/61,248 | `_paginate_trades` lift + `subaccount_id` loop resolves the >95% under-fetch; count gate design in Validation Architecture (SC-1) |
| DRB-05 | Trades classified by kind; options-inclusive — premiums+deliveries enter dailies via txn-log | `classify_instrument` VERIFIED correct (inverse vs linear); txn-log `type` taxonomy enumerated below; options never touch perp math |
| DRB-06 | Inverse coin→USD at index price at event time; sign-correct; hand-computed fixtures | `index_price` field CONFIRMED on txn-log rows; formula `usd = cashflow × index_price`; sign carried by `cashflow`. **Live gap: field-population on `settlement` rows unproven — Wave 0 probe** |
| DRB-07 | Funding from txn-log with native-id dedup — no 8h buckets, no double-count | Native `id` field CONFIRMED; `match_key` TEXT UNIQUE holds `deribit:<id>` with no schema change; `_FUNDING_BUCKET_HOURS` stays deribit-free. **Live gap: settlement cashflow may bundle funding+PnL** |
| DRB-08 | Per-key dailies through the ONE realized+funding → CSV → `compute_all_metrics` path | `combine_realized_and_funding` + `run_derive_broker_dailies_job` VERIFIED as the single path; Deribit only emits the same record shapes |
</phase_requirements>

## Project Constraints (from CLAUDE.md / AGENTS.md)

- **Python suite authority is CI (Py3.12)** — the local full pytest run segfaults (Py3.14 pandas ABI). Use targeted file lists locally; CI is the gate. (memory: `project_bmypy_local_venv_drift`, CONTEXT `code_context`)
- `mypy --strict services/ingestion/` runs in CI (Makefile `lint`) — new adapter code is type-checked; `IngestionAdapter` `@runtime_checkable` only verifies method presence.
- **Migrations under `supabase/migrations/**` auto-apply to prod on merge** (Supabase Migrate). The `funding_fees_exchange_check` flip MUST pass migration-reviewer + rls-policy-auditor before PR, and the **test project must be caught up** before sql-tests/e2e (memory: DB-lag). `uv pip sync` before Deribit work (local venv drifted to ccxt 4.5.46; pinned is 4.5.59).
- Any `match_key` format change is a **3-runtime parity contract**: Python `_build_match_key`, SQL, TS `buildFundingMatchKey` — a divergence must fail CI (`check-zod-db-check-parity.test.ts` is the existing pin for the CHECK).
- Secrets via env/Keychain only; ccxt error strings embed `&signature=<HMAC>` — always `scrub_freeform_string` before logging (existing convention in `fetch_raw_trades`).
- No `git` branch ops in subagents; feature-branch + PR workflow; version-bump both `VERSION` and `package.json`.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Subaccount enumeration | analytics-service (ccxt raw `get_subaccounts`) | — | Only the worker holds decrypted creds; main-account key sees subaccount ids |
| Full-history trade fetch | analytics-service (`_fetch_raw_trades_deribit`) | — | Per-exchange branch in `fetch_raw_trades`; worker-only network egress (Amsterdam) |
| Instrument classification | analytics-service (shared `classify_instrument`) | — | Pure function; runs over txn-log `instrument_name` |
| Inverse coin→USD conversion | analytics-service (new pure fn) | — | Net-new math; belongs beside the txn-log parser, unit-tested |
| Funding native-id dedup | Database (`funding_fees.match_key` UNIQUE) | analytics-service (key builder) | DB enforces idempotency via ON CONFLICT; producer computes the key |
| Realized+funding → dailies | analytics-service (`combine_realized_and_funding`) | — | Exchange-agnostic tail already correct |
| Daily-return persistence | Database (`csv_daily_returns`) | analytics-service (upsert) | Overview/Scenario/factsheet all read this one source |
| Exchange-value CHECK | Database (migration) | TS closed-set + parity test | Boundary parity: DB must admit exactly what TS/pydantic admit |

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `ccxt` | `4.5.59` (pinned) `[VERIFIED: requirements.txt:26]` | Deribit auth + raw endpoint access | Already used by the DRB-01 harness via raw-method fallthrough (`ex.private_get_get_transaction_log`, `..._get_user_trades_by_currency_and_time`, `..._get_subaccounts`). **Zero new dependencies** `[CITED: REQUIREMENTS.md grounding facts]` |
| `pandas` | (repo-pinned) | Daily-return series / `compute_all_metrics` input | Existing dailies tail; ascending DatetimeIndex + float64 contract |
| `supabase` (py) | (repo-pinned) | `funding_fees` / `trades` / `csv_daily_returns` upserts | Existing persistence layer |

**No new packages.** ccxt 4.5.59 ships everything. `[CITED: REQUIREMENTS.md:10]`

### Deribit endpoints used (ccxt raw methods)

| Endpoint | ccxt raw method | Role |
|----------|-----------------|------|
| `private/get_subaccounts` | `ex.private_get_get_subaccounts({"with_portfolio": ...})` | Enumerate subaccount `id`s (D-01) |
| `private/get_user_trades_by_currency_and_time` | `ex.private_get_get_user_trades_by_currency_and_time({... "subaccount_id": id})` | Per-subaccount trade fills (D-03/D-04) |
| `private/get_transaction_log` | `ex.private_get_get_transaction_log({... "subaccount_id": id})` | The complete source: realized cashflow, settlements, options, deliveries, funding (D-05/D-06/D-07/D-08) |
| `public/get_currencies` | `ex.public_get_get_currencies()` | Enumerate currencies (never hard-code) |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| txn-log `index_price` (event-time, on-row) | `public/get_index_price` at timestamp | `get_index_price` returns **only the CURRENT** index — there is no clean "index at arbitrary past timestamp" endpoint. Using it = the exact cross-time category error D-07 forbids. Use the on-row field; fail loud if absent. |
| txn-log cashflow (D-08 preferred) | Reconstruct inverse coin PnL from fills | Fill reconstruction re-derives the inverse formula Deribit already computed into `cashflow` — more surface for a sign/contract-size bug. Prefer cashflow. |
| Native `id` dedup | exact-ms timestamp + instrument key | `id` is documented "Unique record identifier" — the safest native axis. Exact-ms is the fallback if a subaccount-scoped `id` collides across subs (unlikely). |

## Package Legitimacy Audit

No external packages are installed by this phase — it uses the already-pinned `ccxt==4.5.59` and existing repo dependencies. **Package Legitimacy Gate: N/A (zero new packages).**

## Architecture Patterns

### System Architecture Diagram

```
                        ┌─────────────────────────────────────────────┐
   compute_jobs         │  run_derive_broker_dailies_job              │
   kind=derive_         │  (job_worker.py:1772-1862) — THE caller     │
   broker_dailies  ───▶ │                                             │
                        │  1. fetch_account_equity_usd (anchor)       │
                        │  2. realized = fetch_all_trades(...)   ◀──┐  │
                        │  3. funding  = fetch_funding_deribit(...) ◀┼─┐│
                        └───────────────┬──────────────────────────┘ │││
                                        │                             │││
      ┌─────────────────────────────────┘                            │││
      ▼  NEW Deribit ingestion (worker, Amsterdam egress)            │││
 ┌──────────────────────────────────────────────────────────┐       │││
 │ get_subaccounts → [sub_id_1, sub_id_2]  (+ main)          │       │││
 │   for sub_id in subs:                                     │       │││
 │     for ccy in enumerate_currencies(account):            │       │││
 │       paginate get_transaction_log(ccy, subaccount_id)   │───┐   │││
 │       paginate get_user_trades(ccy, subaccount_id)       │─┐ │   │││
 │  classify_instrument(instrument_name) per row            │ │ │   │││
 └──────────────────────────────────────────────────────────┘ │ │   │││
        │ trade rows → FillRow (exchange_fill_id=trade_id)      │ │   │││
        │              → trades table (diff_strategy_fills)     │ │   │││
        │ txn-log cashflow rows, split by `type`:               ▼ ▼   │││
        │   ├─ type=trade (spot/linear/option premium) ─ realized ────┘││  (USD or coin×index)
        │   ├─ type=settlement (inverse perp session+funding) funding ─┘│  coin×index_price → USD
        │   └─ type=delivery / options_settlement_summary ─ realized ───┘  coin×index_price → USD
        │                                                                 │
        ▼  ⛔ D-02 COUNT GATE: Σ trade rows per account ==? 18,778/21,014/61,248
        │      mismatch → FAIL LOUD (no partial track record)
        ▼
 combine_realized_and_funding (broker_dailies.py:119)
        │   realized daily_pnl records + funding_rows_to_daily_pnl_records
        ▼
 trades_to_daily_returns_with_status (transforms.py:70)  → gap_fill → float64
        ▼
 csv_daily_returns  ──▶ compute_all_metrics ──▶ Overview / Scenario / factsheet
```

File-to-implementation mapping is in Component Responsibilities (Standard Stack tables) — the diagram shows data flow only.

### Recommended Module Structure

```
analytics-service/services/
├── deribit_txn.py         # NEW — lift classify_instrument + txn-log parsing +
│                          #        coin→USD conversion (pure, no I/O, unit-tested)
├── exchange.py            # ADD _fetch_raw_trades_deribit + dispatch branch (:1812)
├── funding_fetch.py       # ADD fetch_funding_deribit + _build_deribit_match_key
│                          #     (NOT via _build_match_key — no bucket)
├── broker_dailies.py      # UNCHANGED (exchange-agnostic tail)
├── job_worker.py          # ADD deribit venue branch in run_derive_broker_dailies_job (:1839)
└── ingestion/
    ├── adapter.py         # Source Literal already includes "deribit" (:28) — verify
    └── __init__.py        # ADD "deribit" to SUPPORTED_SOURCES (:93) + _FACTORIES (:140)
```

### Pattern 1: Native-id funding dedup (bypass the bucket dispatcher)

**What:** Deribit funding must NOT route through `_build_match_key` — that function fail-loud-raises `KeyError` for any exchange not in `_FUNDING_BUCKET_HOURS` (by design, `funding_fetch.py:267-271`), and D-09 forbids adding deribit there. Build the key directly from the native record id.

**When to use:** All Deribit `type=settlement` (and any txn-log cashflow routed to the funding stream).

```python
# Source: funding_fetch.py:255-276 (the guard this MUST NOT trip) + Deribit docs (txn-log `id`)
def _build_deribit_match_key(strategy_id: str, subaccount_id: int, txn_id: int) -> str:
    # `id` is Deribit's documented "Unique record identifier" (integer) — the
    # native dedup axis. NEVER a floor bucket (BYB-02 lesson): Deribit accrues
    # funding at position events with arbitrary intra-second timestamps.
    return f"{strategy_id}:deribit:{subaccount_id}:{txn_id}"
# funding_fees.match_key is TEXT NOT NULL UNIQUE (migration 044:95) — this string
# fits with NO schema change; ON CONFLICT (match_key) DO NOTHING is idempotent.
```

### Pattern 2: Inverse coin→USD at event-time index (fail-loud, never current price)

```python
# Source: Deribit private/get_transaction_log field reference (index_price / mark_price / cashflow)
def txn_cashflow_to_usd(row: dict) -> float:
    coin = float(row["cashflow"])                     # base-coin realized amount (signed)
    if _is_linear_or_usd(row):                        # _USDC/_USDT/_EURR instrument or USD currency
        return coin                                   # already USD — TRUMP_USDC-PERPETUAL settled in USDC (evidence acct1)
    idx = row.get("index_price") or row.get("mark_price")   # EVENT-TIME price on the row
    if idx is None:
        raise ValueError(                             # D-07: never fall back to current price
            f"deribit inverse row missing event-time index/mark price: id={row.get('id')}"
        )
    return coin * float(idx)                           # sign carried by cashflow → shorts correct for free
```

### Anti-Patterns to Avoid

- **Main-account-only fetch** (the scout's MVP reading): renders <5% of trades as a complete track record. FORBIDDEN by D-01/D-02.
- **Adding `deribit` to `_FUNDING_BUCKET_HOURS`:** any bucket width silently collapses distinct continuous-funding events (BYB-02). FORBIDDEN by D-09.
- **Current-price coin→USD conversion:** category-invalid cross-time (the `broker_dailies` anchor lesson). Use the on-row `index_price`.
- **Counting a cashflow in BOTH realized and funding streams:** double-count. Partition txn-log rows by `type` into disjoint homes.
- **Running an option through perp fill math:** FORBIDDEN by D-06 — options enter as txn-log cashflow only.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Trade dedup | Custom dedup set | `diff_strategy_fills` on `(exchange, exchange_fill_id=trade_id)` | Existing PK dedup already handles overlap re-fetch |
| Funding idempotency | App-level "already seen" cache | `funding_fees.match_key` UNIQUE + ON CONFLICT | DB-enforced, survives retries/backfills |
| Daily-return math | Deribit-specific dailies | `combine_realized_and_funding` → `compute_all_metrics` | Exchange-agnostic, anchor-to-today already correct (D-12) |
| Instrument classification | New regex | `classify_instrument` (VERIFIED correct) | Already separates inverse/linear/option/future; never raises |
| Historical index price | Timestamp→index reconstruction / extra API calls | The txn-log row's own `index_price` field | Event-time, no extra call, no cross-time error |
| Pagination framework | New loop | Harness `_paginate_trades`/`_paginate_txn_log` (+ `exchange_pagination.walk_paginated` for the fan-out) | Boundary-overlap stall guard (IN-8) already solved |

**Key insight:** Almost everything is a *lift* from the committed harness, not net-new code. The only genuinely new logic is (a) the `subaccount_id` loop, (b) the coin→USD conversion, and (c) the count-reconciliation gate — and each is a small pure function that must be unit-tested.

## Runtime State Inventory

*(Rename/refactor categories — this is a feature phase, but the migration + funding_fees touch persisted state, so the relevant categories are audited.)*

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | `funding_fees.match_key` (TEXT UNIQUE) will gain `deribit:<id>` rows; `csv_daily_returns` gains Deribit per-key rows; `trades` gains Deribit fills | Code writes new rows; no migration of existing rows |
| Live service config | `funding_fees_exchange_check` CHECK constraint (`20260602180000...:59`) admits only binance/okx/bybit → must flip to include deribit | Migration (auto-applies to prod on merge) — reviewer + rls-auditor gate |
| OS-registered state | None — None. Verified: no Deribit-specific scheduler/cron beyond the existing `derive_broker_dailies` compute-job kind (reused, not new). | None |
| Secrets/env vars | `DERIBIT_CLIENT_ID` / `DERIBIT_CLIENT_SECRET` (Railway, harness) for any live verification; `BROKER_DAILIES_VIA_FUNDING` kill-switch already governs the path | None new for prod ingestion (creds arrive via the encrypted key row like other venues) |
| Build artifacts | None — pure Python, no compiled/egg artifacts changed | None |
| 3-runtime parity | `match_key` axis is pinned across Python / SQL / TS (`buildFundingMatchKey`) | If the Deribit key format touches shared logic, add/extend the parity test (D-15) |

## Common Pitfalls

### Pitfall 1: Settlement cashflow bundles funding + price PnL (DOUBLE-COUNT / MISLABEL RISK) — HIGH
**What goes wrong:** The CONTEXT model (D-09/D-10) treats Deribit funding as a clean separate stream. But Deribit documents `type=settlement` `cashflow` as **"Realized session PNL (since last settlement)"** `[CITED: docs.deribit.com .../private-get_transaction_log]` — i.e. it bundles price PnL *and* funding for the perpetual session. If inverse-perp `type=trade` rows ALSO carry nonzero `cashflow`, summing trade-cashflow + settlement-cashflow double-counts realized PnL.
**Why it happens:** Deribit realizes inverse-derivative PnL at session settlement, not per-fill; the DRB-01 whitelist never captured the fields needed to see this.
**How to avoid:** Partition txn-log rows into DISJOINT homes by `type`, and count each cashflow exactly once. For inverse perps, prefer `settlement` cashflow as the realized+funding carrier and confirm inverse-perp `trade` rows carry `cashflow==0` (or exclude them from the cash stream) via the Wave-0 probe. The realized-vs-funding *label* is cosmetic to the final daily sum (both are summed by `combine_realized_and_funding`) — the load-bearing invariant is **count-once**.
**Warning signs:** A reconciliation where Deribit dailies overshoot the account's true equity change; a unit test that sums both streams for the same instrument/session.

### Pitfall 2: `index_price` / `mark_price` unproven on `settlement` rows — HIGH
**What goes wrong:** The coin→USD conversion depends on the row carrying an event-time price. The doc lists `index_price` ("index price for the instrument during the delivery") and `mark_price` as fields, but the DRB-01 harness whitelist (`deribit_ground_truth.py:101-112`) EXCLUDED them, so there is **zero live evidence** they are populated on plain perpetual `settlement` (funding) rows.
**How to avoid:** Wave-0 harness whitelist widening (add `index_price`, `mark_price`, `price`, `id`, `trade_id`, `user_seq`) + a re-run against the 3 live keys to confirm population BEFORE locking the conversion source. Conversion code fails loud if the field is absent — never uses current price.
**Warning signs:** `index_price is None` on settlement rows in the widened evidence → conversion source must change (e.g. use `mark_price`, or pair the settlement with the instrument's settlement `price`).

### Pitfall 3: Subaccount-scope reachability with the read-only LTP keys — HIGH
**What goes wrong:** `subaccount_id` is documented as "available for main accounts with the `mainaccount` scope" `[CITED: docs.deribit.com .../private-get_user_trades_by_currency_and_time]`, and `get_subaccounts` requires `account:read`. The LTP keys' recorded scopes are `account:read trade:read wallet:read custody:read block_trade:read` (+ `name:read_MP`/`name:RO`) — `get_subaccounts` succeeded (count=2), but there is NO live proof the same key can pass `subaccount_id` and receive the subaccount's history (it may return empty or `-32602`/permission error).
**How to avoid:** Wave-0 live probe (harness): loop `subaccount_id` over `get_transaction_log`/`get_user_trades` for each enumerated sub and record the returned counts. The **D-02 count gate** is the backstop — if subaccount fetch does not reconcile to 18,778/21,014/61,248, the pipeline FAILS LOUD. If the read-only key cannot reach subaccount history at all, that is a BLOCKER for onboarding and must surface before Phase 72.
**Warning signs:** Sub-fetch returns 0 rows or an auth error; totals still <5% after looping subs.

### Pitfall 4: `-32602` / `10028` degrade must not silently drop below the count gate
**What goes wrong:** D-14 allows graceful skips for non-margin currencies (`-32602`) and rate-limit backoff (`10028`). A skip that quietly reduces fetched rows below the known total would render as "complete."
**How to avoid:** Skips are logged AND the D-02 reconciliation still runs on the final totals — a shortfall FAILS LOUD regardless of cause.

### Pitfall 5: Trades endpoint under-returns vs txn-log
**What goes wrong:** `get_user_trades_by_currency_and_time` returned 0 for accounts 1&2 while the txn-log had 650/860 trade rows. Classifying/counting off the trades endpoint alone under-represents activity.
**How to avoid:** D-05 — classify and source cash flows from the **txn-log** (`type=trade` rows carry the same `instrument_name`/`cashflow`). The trades endpoint feeds `FillRow`/`trades` persistence (D-04) but is not the completeness source of truth.

## Code Examples

### Enumerate subaccounts and loop the fetch (D-01)
```python
# Source: deribit_ground_truth.py:599-606 (get_subaccounts) + Deribit docs (subaccount_id param)
subs = await ex.private_get_get_subaccounts({"with_portfolio": "false"})
sub_ids = [int(s["id"]) for s in subs.get("result", []) if isinstance(s, dict) and "id" in s]
scopes = [None, *sub_ids]        # None = main account; then each subaccount id
for sub_id in scopes:
    for ccy in held_or_available_currencies:
        params = {"currency": ccy, "start_timestamp": start_ms, "end_timestamp": end_ms, "count": 1000}
        if sub_id is not None:
            params["subaccount_id"] = sub_id
        # paginate get_transaction_log(params) — continuation token (harness :384-435)
        # paginate get_user_trades_by_currency_and_time(params) — has_more + cursor (harness :298-381)
```

### txn-log `type` → dailies routing (D-05/D-06/D-10)
```python
# Source: Deribit txn-log `type` enum + DRB-01 evidence type_counts
REALIZED_TYPES = {"trade", "delivery", "options_settlement_summary"}   # → realized daily_pnl records
FUNDING_TYPES  = {"settlement"}                                        # → funding_fees (native-id dedup)
IGNORE_TYPES   = {"transfer", "deposit", "withdrawal", "usdc_reward",
                  "negative_balance_fee", "correction", "swap"}         # informational / non-strategy cash
# NOTE: which home `settlement` vs inverse-perp `trade` cashflow belongs to is the
# Wave-0 double-count question (Pitfall 1). The partition MUST be disjoint.
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| ccxt `fetchFundingHistory` for funding | Deribit has NO `fetchFundingHistory` → raw `get_transaction_log` only | Deribit-specific | Funding/settlement lives only in the txn-log (harness docstring) |
| 8h funding buckets | 1h buckets for binance/okx/bybit; **native-id for deribit** | BYB-02 (2026-07-04) | Continuous-funding venues need native-id, never buckets |
| `_FUNDING_BUCKET_HOURS.get(exchange, 8)` implicit fallback | Fail-loud `KeyError` for unregistered exchange | audit-2026-05-07 | Deribit MUST use a separate key builder, not this dispatcher |

**Deprecated/outdated:** The "Bybit/Binance block Railway ASN" state is RESOLVED — all four exchanges reachable from the Amsterdam worker (verified 2026-07-04, REQUIREMENTS grounding facts). Stale docs referencing it should be corrected when touched.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `index_price`/`mark_price` are POPULATED on `type=settlement` (funding) rows, not just `delivery` | Pitfall 2, Pattern 2 | Coin→USD conversion has no event-time price source; must switch to settlement `price` or a paired lookup. **Wave-0 probe resolves.** `[ASSUMED — doc lists field; live population unproven]` |
| A2 | The read-only LTP keys can pass `subaccount_id` and receive subaccount history | Pitfall 3, D-01 | Subaccount history unreachable → onboarding blocker; count gate never reconciles. **Wave-0 probe resolves.** `[ASSUMED — get_subaccounts works; subaccount_id reach unproven]` |
| A3 | Inverse-perp realized PnL is carried by `settlement` cashflow; inverse-perp `trade` rows do not also realize cash (no double-count) | Pitfall 1, routing example | Double-count of realized PnL, silently overstated returns. **Wave-0 probe (capture inverse-perp trade+settlement cashflow) resolves.** `[ASSUMED]` |
| A4 | `id` (integer) is globally unique per txn-log record and stable across re-fetch | D-09, Pattern 1 | match_key collisions or missed dedup. `[CITED: doc "Unique record identifier"]` — low risk |
| A5 | 18,778/21,014/61,248 are the true per-account trade totals to reconcile against | D-02 count gate | Gate calibrated to a wrong target; tolerance must be documented. `[CITED: DRB-01 ground truth — source of the totals is the founder's known counts]` |

**Non-empty:** A1–A3 are the load-bearing unknowns; all three collapse to a single **Wave-0 harness whitelist-widening + live re-run** on the 3 keys. The planner should schedule that probe as the first task and treat A1–A3 as `checkpoint:human-verify` gates on the recorded evidence before locking the conversion/routing design.

## Open Questions

> **Phase-70 status:** Q1 (A1) / Q2 (A2) / Q3 are all RESOLVED via the Wave-0 live probe (plan 70-01). Tolerance is delegated to the 70-03 `reconcile_trade_count` docstring; the D-02 count gate anchors the **txn-log `type=trade`** realized-stream count per account (Pitfall 5 — the trades endpoint under-returns), pinned to the Wave-0 honesty-anchor determination.

1. **Does `settlement.cashflow` bundle funding + price PnL, and do inverse-perp `trade` rows carry cashflow?** (A1/A3) — **[RESOLVED via Wave-0 probe 70-01]**
   - Known: doc says settlement cashflow = "Realized session PNL (since last settlement)"; evidence settlement sample is tiny (-5.032e-5 ETH) consistent with a near-flat funding-dominated session.
   - Unclear: the exact partition that guarantees count-once for inverse perps.
   - Recommendation: widen harness whitelist (`index_price, mark_price, price, id, trade_id, user_seq`), re-run, inspect inverse-perp trade vs settlement cashflow, THEN lock the `REALIZED_TYPES`/`FUNDING_TYPES` partition.

2. **Can the read-only LTP keys reach subaccount history via `subaccount_id`?** (A2) — **[RESOLVED via Wave-0 probe 70-01]**
   - Known: `get_subaccounts` returns count=2; `subaccount_id` is a documented param.
   - Unclear: whether these specific scopes authorize subaccount trade/txn-log reads.
   - Recommendation: harness probe loops `subaccount_id`; count gate is the backstop; escalate as a blocker if unreachable.

3. **Tolerance for the D-02 count gate.** — **[RESOLVED: tolerance delegated to the 70-03 `reconcile_trade_count` docstring; the gate reconciles the txn-log `type=trade` row count per account (not the under-returning trades endpoint — Pitfall 5), pinned to the Wave-0 honesty anchor.]** Exact-match to 18,778/21,014/61,248 vs a documented band (e.g. ±0.5% for boundary-overlap/in-flight trades). Recommendation: reconcile txn-log `type=trade` row count per account; allow a small documented tolerance for same-ms boundary overlap; FAIL LOUD outside it.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| ccxt | All Deribit calls | ✓ | 4.5.59 pinned (local drifted to 4.5.46 — `uv pip sync`) | — |
| Deribit API (Amsterdam egress) | Live count verification | ✓ | — | — (200 + authed, verified 2026-07-04) |
| `DERIBIT_CLIENT_ID/SECRET` on Railway | Wave-0 live probe + count gate | ⚠ set by founder | — | Synthetic-fixture tests are CI-runnable without it |
| Supabase test project caught-up | sql-tests/e2e for the CHECK migration | ⚠ verify before run | — | Catch up via MCP (memory: DB-lag) |

**Missing dependencies with no fallback:** Live count reconciliation (18,778/21,014/61,248) and the A1–A3 probes require the founder's Deribit creds on the worker — these are **live/harness-gated, NOT CI-runnable**.
**Missing dependencies with fallback:** All correctness logic (conversion, dedup, routing, subaccount-iteration) is covered by synthetic fixtures that ARE CI-runnable.

## Validation Architecture

*(`nyquist_validation: true` — section required.)*

### Test Framework
| Property | Value |
|----------|-------|
| Framework | pytest (`analytics-service/tests/`) |
| Config | `analytics-service/pyproject.toml` / `pytest.ini` (existing) |
| Quick run command | `cd analytics-service && python -m pytest tests/test_deribit_txn.py tests/test_funding_fetch.py -x` |
| Full suite command | CI (Py3.12) — `--cov-fail-under=80`; local full run segfaults (Py3.14 pandas ABI) → targeted file lists only |
| Cross-runtime parity | `npm test src/__tests__/contracts/check-zod-db-check-parity.test.ts` (CHECK + match_key parity) |

### Phase Requirements → Test Map
| Req | Behavior | Test type | Automated command | CI-runnable? | Revert-proof (fails without the fix) |
|-----|----------|-----------|-------------------|-------------|--------------------------------------|
| DRB-06 | inverse short: `cashflow<0 × index → USD<0` | unit (synthetic fixture) | `pytest tests/test_deribit_txn.py::test_inverse_short_coin_to_usd -x` | ✅ | Hard-coded expected USD from a hand-computed short; a missing `×index_price` or a sign flip changes the number → red |
| DRB-06 | inverse long: `cashflow>0 × index → USD>0` | unit | `...::test_inverse_long_coin_to_usd -x` | ✅ | Hand-computed long fixture; wrong sign/scale → red |
| DRB-06 | linear `_USDC` settlement passes through as USD (no ×index) | unit | `...::test_linear_settlement_is_usd -x` | ✅ | Uses TRUMP_USDC-PERPETUAL shape; if code multiplies by index it inflates → red |
| DRB-06 | missing `index_price`/`mark_price` on inverse row → raises (never current price) | unit | `...::test_missing_event_price_fails_loud -x` | ✅ | Remove the raise → returns wrong/None → red |
| DRB-07 | native-id dedup: two fetches of the same `id` → one row | unit | `pytest tests/test_funding_fetch.py::test_deribit_native_id_dedup -x` | ✅ | Same `id` twice must yield one match_key; a bucket axis would still dedup so ALSO assert distinct-intra-hour events keep distinct keys (below) |
| DRB-07 | no bucket collapse: two settlements same hour, different `id` → TWO rows | unit | `...::test_deribit_intrahour_not_collapsed -x` | ✅ | **Proven to fail under a bucket axis** — floor-bucket key would collapse both → red; native-id keeps both → green |
| DRB-07 | deribit is NOT in `_FUNDING_BUCKET_HOURS`; `_build_match_key("deribit"...)` raises | unit | `...::test_deribit_not_in_bucket_dispatcher -x` | ✅ | Adding deribit to the bucket dict → no raise → red |
| DRB-07 | no double-count: a `settlement` cashflow counted in funding is NOT also in realized | unit | `...::test_settlement_not_double_counted -x` | ✅ | Disjoint `type` partition; if `trade`∩`settlement` overlap → sum doubles → red |
| DRB-04/D-02 | **subaccount-iteration:** synthetic 2-subaccount fixture where main-only drops >90% and the count gate catches it | unit (synthetic) | `pytest tests/test_deribit_ingest.py::test_subaccount_iteration_count_gate -x` | ✅ | Main-only fetch → gate raises; sub-iterating fetch → gate passes. Neuter the sub loop → gate red |
| DRB-05 | option premium/delivery enters dailies via txn-log, NEVER perp math | unit | `...::test_option_enters_via_txnlog_not_perp -x` | ✅ | Assert an option row produces a realized daily_pnl record and never touches the inverse-perp conversion path → red if routed through perp math |
| DRB-05 | classify inverse vs linear (`ETH-PERPETUAL` vs `ETH_USDC-PERPETUAL`) | unit | `pytest tests/test_deribit_txn.py::test_classify_inverse_vs_linear -x` | ✅ | Already-correct `classify_instrument`; a regression flips the class → red |
| DRB-08 | Deribit realized+funding flows through `compute_all_metrics`, same shape as bybit/okx | integration (synthetic) | `pytest tests/test_broker_dailies.py::test_deribit_one_path_shape -x` | ✅ | Feed synthetic Deribit records → assert `csv_daily_returns` shape + a metrics dict identical in shape to a bybit fixture → red if a Deribit-specific path forks |
| DRB-11 | CHECK admits deribit; TS/pydantic/DB parity | contract (SQL + TS) | `supabase/tests/test_*.sql` + `check-zod-db-check-parity.test.ts` | ✅ (sql-tests need caught-up test DB) | Migration flip; parity test red if any runtime diverges |
| DRB-04 | **live count reconciliation to 18,778/21,014/61,248** | live probe | harness re-run on Railway (`skipIf` no live creds) | ❌ live-only | Not CI-runnable; the honesty anchor — gate FAILS LOUD until totals match |
| A1/A2/A3 | settlement composition, subaccount reach, event-price population | live probe | widened harness re-run | ❌ live-only | Wave-0 evidence artifact; `checkpoint:human-verify` before design lock |

### Sampling Rate
- **Per task commit:** `python -m pytest tests/test_deribit_txn.py tests/test_funding_fetch.py -x`
- **Per wave merge:** targeted file list across `test_deribit_*`, `test_broker_dailies.py`, `test_funding_fetch.py` + `npm test` parity contract
- **Phase gate:** CI (Py3.12) full suite green + `--cov-fail-under=80`; migration reviewer + rls-auditor + caught-up test DB before the CHECK-flip PR; **live count reconciliation recorded as evidence** (not CI) before the phase is trusted.

### Live/count-gated vs synthetic-fixture (explicit call-out)
- **CI-runnable (synthetic fixtures):** ALL of DRB-05/06/07/08 correctness, the `_FUNDING_BUCKET_HOURS` exclusion, the no-double-count partition, the CHECK parity, and — critically — the **subaccount-iteration count-gate LOGIC** (synthetic 2-sub fixture where main-only drops >90%). These prove the code is correct.
- **NOT CI-runnable (live/harness-gated, `skipIf`-no-live-creds):** the **actual** reconciliation to 18,778/21,014/61,248, and the A1–A3 probes (settlement-cashflow composition, event-price population, real subaccount reachability). These prove the code meets reality. They run on the Railway worker with the founder's read-only keys and are recorded as evidence artifacts.

### Wave 0 Gaps
- [ ] **Live probe (BLOCKING design lock):** widen `deribit_ground_truth.py` `_TXN_LOG_WHITELIST` (+`index_price, mark_price, price, id, trade_id, user_seq`) and add a `subaccount_id` loop; re-run on Railway; record evidence → resolves A1/A2/A3.
- [ ] `tests/test_deribit_txn.py` — coin→USD + classify + missing-price fixtures (DRB-05/06)
- [ ] `tests/test_funding_fetch.py` — extend for native-id dedup + intrahour-not-collapsed + bucket-exclusion (DRB-07)
- [ ] `tests/test_deribit_ingest.py` — subaccount-iteration count-gate synthetic fixture (DRB-04/D-02)
- [ ] `tests/test_broker_dailies.py` — Deribit one-path shape parity (DRB-08)
- [ ] `supabase/tests/test_funding_fees_deribit_check.sql` — CHECK admits deribit (DRB-11); confirm test DB caught up

## Security Domain

*(`security_enforcement` not disabled — included.)*

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | Read-only scope gate already enforced (DRB-03, `scope_is_read_only`) BEFORE any fetch |
| V5 Input Validation | yes | `classify_instrument` never raises on untrusted `instrument_name`; `_sanitize_raw` on raw payloads; whitelist txn-log fields |
| V6 Cryptography | no (no new crypto) | Credentials KEK-wrapped via existing `services.encryption`; no hand-rolled crypto |
| V7 Errors & Logging | yes | `scrub_freeform_string` on every ccxt error (embeds `&signature=<HMAC>`); evidence sanitizer + `assert_sanitized` for any committed artifact |
| V4 Access Control | yes | Subaccount enumeration is read-only; no write scopes present; count gate prevents partial/misattributed track records |

### Known Threat Patterns for Deribit ingestion
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Credential/signature leak in error logs | Information Disclosure | `scrub_freeform_string` before any log; belt-and-braces literal redaction (harness `_redact_secret_values`) |
| PII leak in committed evidence (username/user_id/email) | Information Disclosure | `sanitize_evidence` + `assert_sanitized` field whitelist; never widen the whitelist to raw-echo |
| Silent under-fetch rendered as complete (BYB-02 class) | Tampering (data integrity) | D-02 hard count gate — FAIL LOUD, no partial render |
| Wrong-venue CHECK admits impossible value | Tampering | `funding_fees_exchange_check` flip + 3-runtime parity test |

## Sources

### Primary (HIGH confidence)
- Deribit API reference — `private/get_transaction_log` (`index_price`/`mark_price`/`price`/`id`/`cashflow` fields; `type` enum: trade, deposit, withdrawal, settlement, delivery, transfer, swap, correction, block_trade; `subaccount_id` param) `[CITED: docs.deribit.com/api-reference/account-management/private-get_transaction_log]`
- Deribit API reference — `private/get_user_trades_by_currency_and_time` (`subaccount_id` param; `index_price`/`mark_price`/`price`/`trade_id` on trade object) `[CITED: docs.deribit.com/api-reference/trading/private-get_user_trades_by_currency_and_time]`
- Deribit API reference — `private/get_subaccounts` (subaccount `id`; `account:read` scope) `[CITED: docs.deribit.com/api-reference/account-management/private-get_subaccounts]`
- Verified code landmarks: `exchange.py:517-547,788,1803-1813`; `funding_fetch.py:216-276`; `broker_dailies.py:73-134`; `job_worker.py:1823-1862`; `transforms.py:70-118`; `adapter.py:28`; `ingestion/__init__.py:93,140-145`; migration `20260416081039:95` (match_key TEXT UNIQUE), `20260602180000:59` (CHECK) `[VERIFIED: codebase]`
- `deribit-ground-truth.md` + `drb01-deribit-ground-truth-2026-07-04.json` (live counts, type_counts, instrument mix, scope grants) `[VERIFIED: committed evidence]`

### Secondary (MEDIUM confidence)
- `REQUIREMENTS.md` grounding facts (ccxt 4.5.59 pinned; all 4 exchanges reachable; Amsterdam egress) `[CITED]`

### Tertiary (LOW confidence)
- Settlement-cashflow composition & subaccount-scope reachability inferred from doc wording — **flagged A1/A2/A3, resolved only by Wave-0 live probe.**

## Metadata

**Confidence breakdown:**
- API mechanics (endpoints, params, fields, dedup): HIGH — Deribit official docs + code cross-check.
- Code seams / integration points: HIGH — every landmark verified against source.
- Coin→USD conversion correctness: MEDIUM — formula is sound; field population on settlement rows unproven (A1).
- Subaccount fetch reachability: MEDIUM-LOW — param exists; scope authorization unproven (A2).
- Funding vs realized partition (no double-count): MEDIUM-LOW — depends on live settlement composition (A3).

**Research date:** 2026-07-04
**Valid until:** 2026-08-03 (30 days) — Deribit API stable; re-verify if ccxt pin changes or the harness re-run contradicts A1–A3.
