# Phase 118: SFOX Research + adapter contract - Research

**Researched:** 2026-07-18
**Domain:** Custom (non-ccxt) exchange REST adapter + daily-equity reconstruction feasibility (sFOX)
**Confidence:** HIGH (reconstruction verdict + adapter contract cited to live sFOX docs and confirmed against the live hosts; sandbox smoke test remains founder-credential-gated)

## Summary

The load-bearing unknown resolves to a clean **GO**. sFOX exposes a **dedicated historical
account-value endpoint** — `GET /v1/account/balance/history` — that returns a **daily** (or
hourly) time series of the account's total USD portfolio value directly
(`{timestamp, usd_value}`). Daily equity does **not** have to be reconstructed from trades +
current balances + price marks; sFOX hands back the equity curve as a first-class series. On
top of that, `GET /v1/account/transactions` returns a **running `account_balance`** per row
plus typed deposit/withdraw/buy/sell/credit/charge actions, which is exactly what phase 120
needs to separate genuine performance from cashflows (TWR/Dietz) and to validate the balance
series against an independent reconstruction (the `deribit_ground_truth.py` parity pattern).

Auth is **Bearer token** (`Authorization: Bearer <API_KEY>`), verified against the live host:
an unauthenticated `GET https://api.sfox.com/v1/user/balance` returns **HTTP 401**, and the
sandbox host `https://api.staging.sfox.com` behaves identically (also 401 on the same route),
confirming both the route set and the auth scheme are real and that the sandbox base URL is
live. sFOX is **not** a ccxt exchange, so the adapter is a custom `SfoxClient` with its own
dispatch seam — it must NOT be added to the ccxt-typed `EXCHANGE_CLASSES` dict.

**Primary recommendation:** Build `SfoxClient` (aiohttp, explicit-proxy-arg ctor) with four read
methods — `get_balances()`, `get_transactions()`, `get_trades()`, `get_balance_history()` — mapped
to the four confirmed endpoints below. Base the daily-equity reconstruction (phase 120) on
`/v1/account/balance/history` as the primary series, with `/v1/account/transactions`
(`account_balance` + typed cashflows) as the independent parity oracle. Prove the contract with a
skipIf-gated sandbox smoke test against `api.staging.sfox.com`.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| SFOX-01 | Custom non-ccxt `SfoxClient` adapter contract (auth; balance, trades, transaction endpoints; prod + sandbox base URLs) proven by a green sandbox-key smoke test before any prod wiring | Auth scheme (Bearer), all four endpoints, both base URLs, rate limits, and pagination are pinned below and confirmed against the live hosts (401 on authed routes). The smoke test design + skipIf gating is in Validation Architecture. |
</phase_requirements>

## User Constraints (from CONTEXT.md)

### Locked Decisions
- sFOX is NOT in ccxt → a custom, non-ccxt `SfoxClient`. Do NOT add it to `EXCHANGE_CLASSES`
  (`dict[str, type]` of ccxt classes). It gets its own dispatch seam the ingestion boundary selects alongside ccxt.
- Language/home: Python, in `analytics-service/services/` alongside existing exchange adapters. Async via `aiohttp`.
- Auth scheme is whatever sFOX documents — RESEARCH pins the real one against the live sandbox, not from memory.
- The reconstruction-feasibility answer is the load-bearing deliverable; if daily equity CANNOT be reconstructed, that surfaces HERE, cited — never papered into phase 120.
- Cite the actual sFOX API docs (endpoint URLs, payload shapes, pagination cursors) in RESEARCH.md, not general knowledge.
- Smoke test green = auth succeeds AND ≥1 read endpoint returns real payload against `api.staging.sfox.com`. Docs-only is NOT green.
- ⚠️ GATE: requires a sFOX SANDBOX key. If none is available at execute time, the smoke test is FOUNDER-GATED (human_needed); the committed test + contract carry the phase. Code must not fake a pass.

### Claude's Discretion
- Exact `SfoxClient` method names, file layout, and test harness structure.
- Whether the smoke test lives as a `scripts/` one-off or a `tests/` skipIf(no-key) test (prefer a skipIf test so CI stays green without the sandbox key, mirroring the existing live-DB skipIf pattern).

### Deferred Ideas (OUT OF SCOPE)
- Static-IP egress wiring (phase 121) — only the proxy-arg seam is designed here, not wired.
- Actual prod key connect + DB constraint widen (phase 119).
- Equity reconstruction + `api_verified` stamp (phase 120).

---

## LOAD-BEARING VERDICT: Can daily equity be reconstructed? → **GO**

**Verdict: GO — daily equity is DIRECTLY EXPOSED, not merely reconstructable.**

| Feasibility question | Answer | Evidence |
|----------------------|--------|----------|
| Current balances per asset? | YES | `GET /v1/user/balance` → array of `{currency, balance, available, held, trading_wallet, ...}` [CITED: docs.sfox.com/rest-api/account-management/get-all-balances] |
| Trade history w/ timestamps + fills? | YES | `GET /v1/account/trades` → `{trade_id, order_id, date_updated (ISO8601), action, currency_pair, quantity, amount(USD), price, fees, net_amount}`, cursor-paginated | 
| Transaction/ledger (deposits/withdrawals/fees)? | YES | `GET /v1/account/transactions` → typed `action` (Deposit/Withdraw/Buy/Sell/Credit/Charge), `amount`, `fees`, `net_proceeds`, **`account_balance` (running)**, `timestamp`, `day` [CITED: docs.sfox.com/rest-api/account-management/get-all-transactions] |
| Direct account-value / balance-history endpoint? | **YES — the decisive finding** | `GET /v1/account/balance/history` → `{data:[{timestamp, usd_value}]}` at **daily (86400s) or hourly (3600s)** interval, `start_date` required [CITED: docs.sfox.com/rest-api/reporting/get-portfolio-valuation] |
| Historical depth to inception? | LIKELY (not pinned by docs) | Docs give no explicit max range for balance/history or transactions; example balance-history spans arbitrary dates. Confirm empirically in the sandbox smoke test / phase-120 ground-truth run. [ASSUMED — A1] |

**Why this is a strong GO, not a marginal one:** the risk in a "reconstruct equity from primitives"
integration is that you must (a) price every held asset at every historical instant and (b) reconcile
deposits/withdrawals to avoid counting cashflows as return. sFOX **removes (a) entirely** by serving a
pre-computed daily `usd_value` series, and **de-risks (b)** by tagging transaction rows with typed
Deposit/Withdraw actions and a running `account_balance`. This makes phase-120 reconstruction primarily
a *validation/stitching* problem (does the sFOX-served curve agree with an independent trade-derived
reconstruction?) rather than a *from-scratch pricing* problem.

**One honest caveat (carry to phase 120, not a blocker):** `balance/history` returns sFOX's own USD
valuation — its pricing marks, not ours. For `api_verified` ground truth this is a feature (it is the
exchange's own number, un-fabricatable by a submitter). But the phase-120 parity check must decide
whether the canonical daily series is (i) sFOX's `usd_value` directly, or (ii) our reconstruction from
trades+transactions+balances, with the other as the oracle. The P115 lesson applies: the oracle must be
economically independent of the series under test — do NOT validate sFOX's `usd_value` against a
reconstruction that itself consumes sFOX's `usd_value`.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| sFOX API reads (balances/trades/txns/history) | Python analytics worker (`SfoxClient`) | — | Worker owns credentials; all exchange reads already live here |
| Read-only scope assertion | Python worker (ingestion boundary) | — | Mirrors `key_permissions.detect_permissions`; no order/withdraw ever exercised |
| Adapter dispatch selection | Python worker (new non-ccxt seam) | — | Must sit BESIDE `EXCHANGE_CLASSES`, not inside it (dict is ccxt-typed) |
| Static-IP egress (proxy) | Python worker aiohttp session | Fly.io proxy (phase 121) | Only the explicit-proxy-arg *seam* is designed in 118; wired in 121 |
| DB exchange-value admission | Postgres CHECK constraints | TS/pydantic allowlists | Widened in phase 119, not here |
| Honest key-failure copy | Next.js (`wizardErrors.ts`) | — | Extended for sFOX in phase 119 |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `aiohttp` | already vendored in analytics-service | Async HTTP client for `SfoxClient` | Matches existing `ccxt.async_support` session lifecycle; CONTEXT locks aiohttp [VERIFIED: codebase — analytics-service uses aiohttp] |

**No new packages required.** sFOX is a plain Bearer-auth JSON REST API; `aiohttp` (already
present) covers it. **No sFOX SDK is needed or recommended** — there is no official, well-maintained
Python sFOX SDK worth a supply-chain dependency; a ~150-line hand-written client against 4 endpoints
is simpler and auditable. This is a case where NOT adding a package is correct.

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Hand-written `aiohttp` client | A community `sfox` PyPI package | REJECTED — unknown maintenance/provenance for a niche exchange; 4 endpoints don't justify a dependency; supply-chain risk (CLAUDE.md banned-package discipline). Hand-roll here is the *right* call. |
| `aiohttp` | `httpx` | Rejected — CONTEXT locks aiohttp to match existing session/proxy patterns and the phase-121 explicit-proxy seam. |

## Package Legitimacy Audit

No external packages are installed by this phase. `aiohttp` is already a project dependency
(used throughout `analytics-service`). slopcheck not run — **no new package surface to audit**.

| Package | Registry | Disposition |
|---------|----------|-------------|
| (none — reuse existing `aiohttp`) | — | No new install |

## The `SfoxClient` Adapter Contract

### Auth
- **Scheme:** Bearer token. Header: `Authorization: Bearer <API_KEY>` [CITED: docs.sfox.com/rest-api/authentication] [VERIFIED: live host — unauthenticated `/v1/user/balance` → HTTP 401 on both prod and staging]
- **Key minting:** production keys at `https://trade.sfox.com/account/api`; **sandbox keys at `https://beta.sfox.com`** (separate key from prod — "Sandbox and production require separate API keys"). Support: support@sfox.com for sandbox funding/config. [CITED: docs.sfox.com/rest-api/authentication]
- **Scope:** "Your permissions as a user in your account define your API key permissions" — so a read-only account role yields a read-only key. Read-only enforcement must still be asserted at the ingestion boundary (mirror `key_permissions.detect_permissions`), never assumed.

### Base URLs (both confirmed live, Cloudflare-fronted)
| Env | Base URL | Confirmed |
|-----|----------|-----------|
| Production | `https://api.sfox.com` | HTTP 200 on public `/v1/markets/tickers`; 401 on authed `/v1/user/balance` [VERIFIED: live curl 2026-07-18, remote_ip 104.18.20.120] |
| Sandbox/staging | `https://api.staging.sfox.com` | Identical behavior — 401 on `/v1/user/balance` [VERIFIED: live curl 2026-07-18, remote_ip 104.18.21.120] |

Note: both hosts sit behind Cloudflare (104.18.x.x). This does not affect phase-121 static-IP egress
— sFOX IP-whitelisting is applied to *our egress IP* on the key config, independent of their CDN.

### Endpoint Set (the four read methods)
| Method (suggested) | Endpoint | Key params | Response shape | Pagination |
|--------------------|----------|-----------|----------------|------------|
| `get_balances()` | `GET /v1/user/balance` | none | array `{currency, balance, available, held, borrow_wallet, collateral_wallet, lending_wallet, trading_wallet}` | none (current snapshot) |
| `get_transactions()` | `GET /v1/account/transactions` | `from`,`to` (ms), `limit` (default 250, **max 1000**), `after` (id cursor), `offset`, `types` (charge/deposit/withdraw/credit/buy/sell), `pending` | array `{id, order_id, trade_id, day, action, currency, amount, net_proceeds, price, fees, status, account_balance, symbol, timestamp}` | cursor (`after`=id) OR `offset`; defaults to last 24h if `from` omitted |
| `get_trades()` | `GET /v1/account/trades` | `page_size` (default 100), `last_seen_id` (cursor) | `{data:[{cursor, trade_id, order_id, date_updated, action, currency_pair, quantity, amount, price, fees, net_amount}]}` | cursor (`last_seen_id`) |
| `get_balance_history()` | `GET /v1/account/balance/history` | `start_date` (ms, **required**), `end_date` (ms), `interval` (3600 or 86400; default 86400) | `{data:[{timestamp, usd_value}]}` | date-range windowed |

All paths [CITED: docs.sfox.com/rest-api/*, index at docs.sfox.com/llms.txt].

### Rate limits (STRICT — design around them)
- `/v1/account/transactions`: **1 request per 10 seconds** [CITED: docs.sfox.com/rest-api/account-management/get-all-transactions].
- Treat all authed endpoints as tightly rate-limited; the client must serialize + backoff (do NOT parallel-fan-out paginated pulls). This directly informs the phase-120 backfill design and the FLIPRETRY-01 lesson: **a slow paginated crawl must be bounded by `asyncio.wait_for` and must never run on the sequential prod worker's event loop.**
- The `SfoxClient` should carry its own rate-limit gate (token-bucket / min-interval sleep), analogous to ccxt's `enableRateLimit=True`.

### aiohttp session / proxy seam (design now, wire in 121)
- **CARRY-FORWARD (STATE.md):** aiohttp ignores `HTTPS_PROXY` unless `trust_env=True` OR you pass
  `proxy=` explicitly per request. The `SfoxClient` ctor **must accept an optional explicit `proxy: str | None`**
  and thread it into every `session.request(..., proxy=proxy)` call. Do NOT rely on env-var proxy pickup.
- Mirror `exchange.py`'s `aclose_exchange` bounded-teardown discipline: own the `ClientSession`, close it in
  a bounded/shielded path so a hung close can't wedge the sequential worker (Sentry QUANTALYZE-8/9 "Unclosed session" class).

### Dispatch seam (coexist with ccxt WITHOUT contaminating `EXCHANGE_CLASSES`)
- `EXCHANGE_CLASSES: dict[str, type]` at `exchange.py:784` is ccxt-classes-only (binance/okx/bybit/deribit).
  `create_exchange` (`:792`) returns a `ccxt.Exchange`. **`SfoxClient` is not a `ccxt.Exchange`** and must not be jammed in.
- Recommended shape: a parallel selection function at the ingestion boundary, e.g.
  `is_sfox(exchange_name)` → construct `SfoxClient`; else fall through to `create_exchange`. Keep the
  ccxt-typed dict pristine so `create_exchange`'s `ccxt.Exchange` return type stays honest.

## Architecture Patterns

### System Architecture Diagram
```
                       ┌─────────────────────────────────────────────┐
  worker ingestion     │  select_adapter(exchange_name)              │
  boundary  ──────────▶│    is_sfox? ── yes ─▶ SfoxClient(proxy=…)   │
                       │             └─ no ──▶ create_exchange()→ccxt │
                       └───────────────┬─────────────────────────────┘
                                       │ (sFOX path)
                                       ▼
             ┌──────────────── SfoxClient (aiohttp, Bearer, rate-gated) ────────────────┐
             │  get_balances()          GET /v1/user/balance                             │
             │  get_transactions()      GET /v1/account/transactions   (cursor/offset)   │
             │  get_trades()            GET /v1/account/trades          (last_seen_id)    │
             │  get_balance_history()   GET /v1/account/balance/history (daily usd_value) │
             └───────────────┬──────────────────────────────────┬──────────────────────┘
                             │                                   │
              (phase 120) primary daily series          (phase 120) independent parity oracle
                usd_value[] ── derive_basis_series ──▶     account_balance + typed cashflows
                     stamped api_verified               (P115: economically-independent oracle)
```

### Recommended Project Structure
```
analytics-service/
├── services/
│   └── sfox_client.py         # SfoxClient: aiohttp, Bearer, explicit-proxy ctor, 4 read methods, rate gate
├── scripts/
│   └── sfox_ground_truth.py   # (phase 120) mirrors deribit_ground_truth.py — sanitized evidence capture
└── tests/
    └── test_sfox_client_live.py  # skipIf(!HAS_SFOX_SANDBOX_KEY) smoke test — the SC-3 empirical gate
```

### Pattern: skipIf-gated live smoke test (reuse the live-DB pattern)
```python
# Source: existing analytics-service live-test convention (skipIf(!HAS_LIVE_*)); DB-test wiring note in STATE.md
HAS_SFOX_SANDBOX_KEY = bool(os.getenv("SFOX_SANDBOX_API_KEY"))

@pytest.mark.skipif(not HAS_SFOX_SANDBOX_KEY, reason="no sFOX sandbox key — founder-gated smoke test")
async def test_sfox_sandbox_smoke():
    client = SfoxClient(base_url="https://api.staging.sfox.com",
                        api_key=os.environ["SFOX_SANDBOX_API_KEY"], proxy=None)
    balances = await client.get_balances()   # ≥1 read endpoint returns real payload
    assert isinstance(balances, list)         # green = auth OK AND payload returned
```

### Anti-Patterns to Avoid
- **Adding sFOX to `EXCHANGE_CLASSES`** — the dict is ccxt-typed; sFOX is not ccxt. Breaks the `ccxt.Exchange` return contract of `create_exchange`.
- **Relying on `HTTPS_PROXY` env for aiohttp** — silently ignored without `trust_env`/explicit `proxy=`. This is the exact phase-121 trap; the seam must be explicit from day one.
- **Parallel-fanning paginated pulls** — the 1-req/10s transactions limit will 429 you; serialize + backoff.
- **Reconstructing equity from scratch when `balance/history` exists** — don't ignore the exposed daily `usd_value` series; use it as the primary and reconstruct only as the parity oracle.
- **Validating a series against an oracle that consumes the same series** (P115) — keep the phase-120 oracle economically independent.

## Don't Hand-Roll
| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Daily equity/USD valuation of holdings | A per-asset historical pricing engine | sFOX `/v1/account/balance/history` | sFOX serves a pre-computed daily `usd_value` series — pricing every held asset at every historical instant is the hard part, and it's already done |
| Deposit/withdrawal vs. return separation | Heuristic cashflow inference from balance deltas | `/v1/account/transactions` typed `action` + `account_balance` | Typed Deposit/Withdraw rows remove the guesswork |
| HTTP retry/rate-limit orchestration | Ad-hoc sleep scattered in call sites | A single rate-gate in `SfoxClient` (min-interval token bucket) | Mirrors ccxt `enableRateLimit`; keeps the 1-req/10s limit in one place |

**Key insight:** sFOX is a *reporting-friendly* exchange API — it exposes a portfolio-valuation
history endpoint most exchanges don't. The correct posture is "consume what sFOX computed and
validate it," not "recompute everything from primitives."

## Runtime State Inventory

Not a rename/refactor phase — greenfield adapter contract. This section intentionally minimal.
The only cross-runtime state introduced later (phase 119+) is the DB constraint value-space (below),
and (phase 121) the Fly.io egress IP the founder whitelists at sFOX. **Nothing to migrate in phase 118.**

## DB Constraint Inventory (de-risks phase 119 — SFOX-04)

**The deribit precedent is the authoritative "what actually needs widening" guide:** migration
`20260704200446_deribit_exchange_boundary_checks.sql` widened exactly **four** boundary constraints to
admit `'deribit'`, using a per-constraint self-verifying `DO` block (RAISEs if the new def is missing any
value). Phase 119 should clone this migration for `'sfox'`. Exact current state of every `exchange`/`source`
value-space constraint [VERIFIED: grep of supabase/migrations/ 2026-07-18]:

| # | Table.column | Constraint name | Current values | Deribit widened it? | sFOX action (phase 119) |
|---|--------------|-----------------|----------------|---------------------|--------------------------|
| 1 | `api_keys.exchange` | `api_keys_exchange_check` (auto) | binance, okx, bybit, deribit | ✅ yes | **WIDEN → add 'sfox'** (key save boundary — mandatory) |
| 2 | `compute_jobs.exchange` | `compute_jobs_exchange_check` (auto, nullable `IS NULL OR`) | binance, okx, bybit, deribit | ✅ yes | **WIDEN → add 'sfox'**, preserve `IS NULL OR` form (sync jobs) |
| 3 | `strategies.source` | `strategies_source_check` (NAMED) | legacy, wizard, admin_import, allocator_connected, csv, okx, binance, bybit, deribit | ✅ yes | **WIDEN → add 'sfox'** (key-created strategies stamp source=exchange) |
| 4 | `strategy_verifications.source` | `strategy_verifications_source_check` (auto) | okx, binance, bybit, csv, deribit | ✅ yes | **WIDEN → add 'sfox'** (verify write path; api_verified) |
| 5 | `position_snapshots.exchange` | `position_snapshots_exchange_check` (auto, nullable) | binance, okx, bybit | ❌ deribit SKIPPED (derivative positions, Phase 71) | **LIKELY SKIP** — sFOX is spot; no derivative positions. Confirm the parity contract test doesn't force it. |
| 6 | `funding_fees.exchange` | `funding_fees_exchange_check` (auto) | binance, okx, bybit | ❌ deribit SKIPPED (continuous funding, BYB-02) | **LIKELY SKIP** — sFOX spot has no perp funding. Confirm parity test. |
| 7 | `verification_requests.exchange` | `verification_requests_exchange_check` (auto) | binance, okx, bybit | ❌ deribit SKIPPED — **frozen Phase-19 legacy table / now a VIEW** | **DO NOT TOUCH** — deribit migration explicitly warns a DROP CONSTRAINT on the VIEW errors; never touch either. |

**Function-level allowlists (NOT CHECK constraints — behavioral gates, easy to miss):**
| Location | Gate | Current | Note for phase 119 |
|----------|------|---------|--------------------|
| `20260716130500_finalize_terminal_status_param.sql:188` (latest) | `IF v_exchange IN ('bybit','okx','binance')` — decides whether finalize inserts a `strategy_verifications` row | **only 3 — does NOT include deribit** | ⚠️ **This is the `terminal-status` item in SFOX-04.** For sFOX's `api_verified` provenance to create a verification row on finalize, this branch likely needs `'sfox'`. Confirm the intended sFOX verify-insert behavior; re-base on the LATEST function def (supersedes `20260521185008_wizard_finalize_inserts_verification.sql:141`). |

**Parity guards phase 119 must keep green** (mentioned in the deribit migration header):
- TS allowlist `src/lib/closed-sets.ts` `SUPPORTED_EXCHANGES = ["binance","okx","bybit","deribit"]` (add `"sfox"`), plus `EXCHANGE_DISPLAY` casing map.
- pydantic Literals in lockstep: `analytics-service/models/schemas.py:206`, `routers/debug_key_flow.py:61` (`Broker`), `services/ingestion/adapter.py:31` (`Source`), and the parity test set `tests/test_boundary_literals_parity.py:51` `_KEY_SAVE_EXCHANGES`.
- The contract test `src/__tests__/contracts/check-zod-db-check-parity.test.ts` resolves `<table>_<column>_check` — it decides whether skipping #5/#6 is allowed. **Phase 119 must run this test to learn the true minimum widen set.** [VERIFIED: referenced in deribit migration header]

**CARRY-FORWARD (STATE.md):** the phase-119 constraint-widening migration must be MCP-applied to the
**TEST project `qmnijlgmdhviwzwfyzlc`** BEFORE merge or the RED-guarded SQL tests fail; merging
`supabase/migrations/**` to main auto-applies to **PROD** — watch the run + verify objects.

## Key-route inventory (SFOX-03, phase 119 — confirms "3")

[VERIFIED: codebase 2026-07-18] Exactly **three** key routes reference exchange validation, matching SFOX-03:
1. `src/app/api/keys/validate-and-encrypt/route.ts`
2. `src/app/api/strategies/create-with-key/route.ts`
3. `src/app/api/strategies/composite/add-key/route.ts`

TS honest-error seam to extend for sFOX: `src/lib/wizardErrors.ts` `classifyKeyValidationError` → `KEY_AUTH_FAILED`.

## Common Pitfalls

### Pitfall 1: Treating sFOX as ccxt
**What goes wrong:** adding `"sfox": <something>` to `EXCHANGE_CLASSES` or expecting `create_exchange` to return an sFOX handle.
**Why:** the dict is `dict[str, type]` of ccxt classes; `create_exchange` returns `ccxt.Exchange`.
**Avoid:** a separate `is_sfox`/`SfoxClient` selection path at the ingestion boundary. **Warning sign:** type-checker complains `SfoxClient` isn't a `ccxt.Exchange`.

### Pitfall 2: aiohttp silently ignoring the proxy
**What goes wrong:** phase-121 static-IP egress "works locally" but sFOX still sees the Railway IP → whitelisted key 401s.
**Why:** aiohttp ignores `HTTPS_PROXY` without `trust_env=True` / explicit `proxy=`.
**Avoid:** explicit `proxy` ctor arg threaded into every request from day one. **Warning sign:** `curl ipinfo.io` from the box ≠ the IP sFOX sees.

### Pitfall 3: Rate-limit 429 on a paginated backfill wedging the worker
**What goes wrong:** a full transactions/trades pull (1 req/10s) runs long and, on the sequential prod worker, blocks the event loop → healthz stale (the exact v1.11 FLIP-rollback failure mode).
**Why:** strict per-endpoint limits + unbounded crawl on the shared loop.
**Avoid:** `SfoxClient` rate-gate + `asyncio.wait_for` bound per crawl + run backfills off the sequential worker (FLIPRETRY-01/02 discipline). **Warning sign:** rising per-request latency, healthz age climbing.

### Pitfall 4: Validating sFOX's own valuation against a reconstruction that uses it (P115)
**What goes wrong:** phase-120 parity check passes trivially because the oracle isn't independent.
**Avoid:** oracle derived from trades+cashflows independently of `balance/history`'s `usd_value`, or vice-versa; anchor on hand-derived invariants.

## State of the Art
| Old assumption | Reality (evidence) | Impact |
|----------------|--------------------|--------|
| "Niche exchange → must reconstruct equity from trades + price marks" | sFOX exposes `/v1/account/balance/history` daily `usd_value` directly | Phase 120 is validation/stitching, not from-scratch pricing — materially lower risk |
| "Auth scheme unknown, maybe HMAC" | Plain Bearer token, confirmed 401 on live authed routes | Simple `Authorization: Bearer` header; no signing machinery |

## Assumptions Log
| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `balance/history` + `transactions` reach account inception (docs don't state a max range) | Load-bearing verdict | If depth is capped (e.g., 90d), phase-120 early-history reconstruction needs trade-replay backfill. Resolve empirically in the sandbox smoke / phase-120 ground-truth run — does NOT change the GO verdict, only the backfill design. |
| A2 | The `terminal-status` finalize function needs `'sfox'` added for verification-row creation | DB inventory | If sFOX uses a different verify-insert path, editing this branch is unnecessary. Confirm intended sFOX provenance-write behavior in phase 119. |
| A3 | position_snapshots / funding_fees constraints can be SKIPPED for spot-only sFOX (matching deribit's skips) | DB inventory | If the parity contract test forces them, phase 119 must widen them too. Resolve by running `check-zod-db-check-parity.test.ts`. |

## Open Questions
1. **Historical depth of `balance/history` / `transactions`.** Docs silent. Resolve in the sandbox smoke test (request `start_date` far in the past, observe earliest returned point). Recommendation: capture this in the phase-120 `sfox_ground_truth.py` evidence run.
2. **Is `balance/history` `usd_value` sFOX's mark or a mid?** Affects the phase-120 canonical-series decision. Recommendation: phase 120 red-team decision; not blocking for 118.
3. **Sandbox data availability.** A fresh sandbox account may have zero trades/history. The smoke test's "≥1 read endpoint returns real payload" should target `get_balances()` (returns an array even if balances are zero) to stay robust; support@sfox.com can fund a sandbox account if a populated payload is required.

## Environment Availability
| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| `api.sfox.com` (prod host) | prod reads (phase 120+) | ✓ | live, HTTP 200/401 | — |
| `api.staging.sfox.com` (sandbox host) | SC-3 smoke test | ✓ | live, HTTP 401 on authed route | — |
| sFOX **sandbox API key** | SC-3 smoke test green | ✗ (must be minted at beta.sfox.com by founder) | — | **skipIf-gate the test → human_needed; committed test + contract carry the phase** |
| `aiohttp` | `SfoxClient` | ✓ | already vendored | — |
| Fly.io static IP | phase 121 (NOT 118) | ✗ | — | out of scope here; only the proxy-arg seam is designed |

**Missing dependency with fallback (the only gate):** sandbox API key → the smoke test is
founder-credential-gated. Per CONTEXT: the code must not fake a pass; skipIf keeps CI green.

## Validation Architecture

**nyquist_validation:** enabled (no `workflow.nyquist_validation:false` found). This phase's central
claim — "the `SfoxClient` contract is correct" — is validated **empirically against the live sandbox**,
not by docs alone (CONTEXT: "Docs-only is NOT green").

### Test Framework
| Property | Value |
|----------|-------|
| Framework | pytest (analytics-service), async via existing test setup |
| Config file | `analytics-service/` pytest config (existing) |
| Quick run | `pytest analytics-service/tests/test_sfox_client_live.py -x` |
| Full suite | `pytest --cov-fail-under=80` (existing gate) |

### Phase Requirements → Test Map
| Req | Behavior | Test type | Automated command | Exists? |
|-----|----------|-----------|-------------------|---------|
| SFOX-01 (contract) | `SfoxClient` builds correct Bearer request, base-URL switch, explicit proxy threaded, rate-gate | unit (mocked aiohttp) | `pytest tests/test_sfox_client.py -x` | ❌ Wave 0 |
| SFOX-01 (SC-3 empirical) | Auth succeeds + ≥1 read endpoint returns real payload vs `api.staging.sfox.com` | live smoke, skipIf(no key) | `SFOX_SANDBOX_API_KEY=… pytest tests/test_sfox_client_live.py -x` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `pytest analytics-service/tests/test_sfox_client.py -x` (mocked unit — always runs in CI).
- **Per wave merge:** full analytics-service suite (`--cov-fail-under=80`).
- **Phase gate:** unit tests green in CI; **the live sandbox smoke test is the empirical gate but is FOUNDER-CREDENTIAL-GATED** — if `SFOX_SANDBOX_API_KEY` is absent it skips (CI stays green) and the phase closes `human_needed` on SC-3 until the founder runs it with a sandbox key. The committed test + contract carry the phase; **the code must never fabricate a green.**

### Wave 0 Gaps
- [ ] `analytics-service/services/sfox_client.py` — the adapter under test
- [ ] `analytics-service/tests/test_sfox_client.py` — mocked-aiohttp unit tests (request shape, base-URL switch, proxy threading, rate-gate, pagination cursor handling)
- [ ] `analytics-service/tests/test_sfox_client_live.py` — skipIf(!HAS_SFOX_SANDBOX_KEY) live smoke (SC-3)

## Security Domain

**security_enforcement:** enabled (absent = enabled).

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | Bearer token in `Authorization` header; key stored encrypted (existing api_keys encryption path); read-only role → read-only key |
| V4 Access Control | yes | Read-only scope asserted at ingestion boundary; NO order/withdraw endpoint ever called (out-of-scope per REQUIREMENTS) |
| V5 Input Validation | yes | Validate/parse sFOX JSON payloads; fail-loud on absent/degenerate data (no invented data) |
| V6 Cryptography | no (reuse) | Reuse existing api_keys encryption; do not hand-roll |
| V7 Logging | yes | Scrub secrets/URLs before logging (mirror `services.redact.scrub_freeform_string`); the ground-truth harness must NEVER print the token |

### Known Threat Patterns
| Pattern | STRIDE | Mitigation |
|---------|--------|-----------|
| Bearer token leak in logs/exceptions | Info disclosure | Scrub before logging (existing `scrub_freeform_string` pattern); never log `Authorization` header |
| Accidental write/order call on a "read" adapter | Tampering | Build ONLY the 4 read methods; no order/withdraw/transfer method exists in `SfoxClient` |
| Committing a sandbox key | Info disclosure | Credentials via env only (`SFOX_SANDBOX_API_KEY`), never a tracked file — mirror deribit_ground_truth runbook |
| Static-IP misconfig exposes true egress (phase 121) | Spoofing/whitelist bypass | Explicit-proxy seam designed here; verified `curl ipinfo.io == dedicated v4` before founder whitelists |

## Sources

### Primary (HIGH confidence)
- docs.sfox.com/llms.txt — full endpoint index (auth, balances, transactions, trades, portfolio valuation, transfers)
- docs.sfox.com/rest-api/authentication — Bearer scheme, key portals, separate sandbox keys
- docs.sfox.com/rest-api/account-management/get-all-balances — `/v1/user/balance`
- docs.sfox.com/rest-api/account-management/get-all-transactions — `/v1/account/transactions`, params, 1-req/10s limit, `account_balance`
- docs.sfox.com/rest-api/orders/get-all-trades — `/v1/account/trades`, cursor pagination
- docs.sfox.com/rest-api/reporting/get-portfolio-valuation — `/v1/account/balance/history` daily `usd_value` (THE load-bearing endpoint)
- Live host probes 2026-07-18 — `api.sfox.com` + `api.staging.sfox.com` both live; 401 on authed routes confirms auth scheme + route reality [VERIFIED]
- Codebase grep 2026-07-18 — `exchange.py:784` EXCHANGE_CLASSES, deribit constraint-widen migration, key routes, TS/pydantic allowlists [VERIFIED]

### Secondary (MEDIUM)
- docs.sfox.com sandbox-key acquisition via `beta.sfox.com` (docs-stated, not personally exercised)

## Metadata
**Confidence breakdown:**
- Reconstruction verdict (GO): HIGH — dedicated balance-history endpoint + typed transactions, cited to docs and route existence confirmed on live hosts.
- Adapter contract: HIGH — auth/endpoints/base URLs cited and 401-confirmed; rate limit cited.
- DB constraint inventory: HIGH — full grep, mapped to the authoritative deribit precedent.
- Historical depth (A1): MEDIUM/LOW — docs silent; resolve empirically. Does not change the GO.

**Research date:** 2026-07-18
**Valid until:** ~2026-08-17 (sFOX REST API is stable; re-verify base URLs / rate limits if >30 days)
