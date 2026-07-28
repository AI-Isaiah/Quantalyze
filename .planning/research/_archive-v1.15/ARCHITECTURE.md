# Architecture Research

**Domain:** v1.15 — live `api_verified` MetaTrader 5 account sync (self-hosted headless MT5 terminal + `MetaTrader5` Python pkg), integrated into the existing Quantalyze Python analytics worker + unified `derive_basis_series` backbone.
**Researched:** 2026-07-23
**Confidence:** HIGH on the internal integration surface (read directly from the shipped sFOX/deribit code); MEDIUM on the MT5 gateway hosting/concurrency specifics (verified against MT5 docs + community Wine/Docker projects, not yet exercised in this repo).

---

## The one architectural difference from sFOX (read this first)

The v1.12 sFOX foundation is the exact template for **everything downstream of the read** — the `Source` lockstep, the fail-loud adapter, the `derive_basis_series` backbone, the `api_verified` stamp, the flag gating, the constraint-widen migration. Mirror it verbatim. **~95% of v1.15 is a sFOX clone.**

The genuinely new problem is a single fact:

- `SfoxClient` is an in-process `aiohttp` client. It runs **inside** the Linux Railway worker and makes HTTPS calls out to sFOX's cloud REST API.
- The `MetaTrader5` Python package is **Windows-only and stateful** — it does not talk to a broker over REST; it talks over local IPC to a **running MT5 terminal process** that is logged into exactly **one** account. It cannot be `pip install`ed into the Linux worker and cannot run in-process.

**The elegant resolution:** stand up a **self-hosted MT5 gateway** (Wine + Windows-Python + MT5 terminal + a thin HTTP shim) that makes MT5 *look like a cloud REST API* to the worker. Then the worker's `Mt5Client` is structurally identical to `SfoxClient` — a non-ccxt, read-only, timeout-bounded HTTP client — except its base URL points at **our own gateway** instead of a vendor cloud. Once the gateway exists, the whole sFOX seam is reused unchanged.

```
sFOX (v1.12):   Linux worker ── aiohttp/HTTPS ──▶ api.sfox.com          (vendor cloud)
MT5  (v1.15):   Linux worker ── aiohttp/HTTPS ──▶ mt5-gateway (ours) ── IPC ──▶ MT5 terminal (Wine)
                                                   └── the ONE new component ──┘
```

---

## Standard Architecture

### System Overview

```
┌──────────────────────────────────────────────────────────────────────┐
│                    Next.js (Vercel) — key-save boundary                │
│  ┌────────────────────┐ ┌──────────────────┐ ┌─────────────────────┐  │
│  │ validate-and-      │ │ create-with-key  │ │ composite/add-key   │  │  ← 3 routes accept 'mt5'
│  │ encrypt/route.ts   │ │ /route.ts        │ │ /route.ts           │  │    (MT5_ENABLED gate)
│  └─────────┬──────────┘ └────────┬─────────┘ └──────────┬──────────┘  │
│            │  closed-sets.ts SUPPORTED_EXCHANGES + isMt5EnabledServer  │
└────────────┼─────────────────────┼──────────────────────┼─────────────┘
             │                     │                       │
             ▼ POST /validate-key  ▼ POST /process-key      ▼ (compute_jobs enqueue)
┌──────────────────────────────────────────────────────────────────────┐
│              analytics-service — Python worker (Railway, Linux)        │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │  Source lockstep: adapter.py Literal · SUPPORTED_SOURCES ·      │  │
│  │  _FACTORIES → Mt5Adapter  (validate read-only; compute_metrics  │  │
│  │  + fetch_raw FAIL LOUD — mirrors SfoxAdapter/DeribitAdapter)    │  │
│  └───────────────┬────────────────────────────────────────────────┘  │
│  ┌───────────────▼────────────────┐   ┌────────────────────────────┐  │
│  │ job_worker._make_exchange_     │   │ broker_dailies.            │  │
│  │ client('mt5') → make_mt5_client│   │ combine_mt5_deal_ledger    │  │  ← NEW combine fn
│  │ (Mt5Client — non-ccxt HTTP)    │   │ (deals+flows → chain_      │  │    (mirrors deribit
│  │  bounded timeout + wait_for    │   │  linked_twr)               │  │    combine_native_ledger)
│  └───────────────┬────────────────┘   └─────────────┬──────────────┘  │
│                  │                                    ▼                 │
│                  │                     ┌────────────────────────────┐  │
│                  │                     │ derive_basis_series (ONE    │  │  ← REUSED unchanged
│                  │                     │ backbone) → api_verified    │  │
│                  │                     └─────────────┬──────────────┘  │
└──────────────────┼──────────────────────────────────┼─────────────────┘
                   │ aiohttp/HTTPS (bounded)            ▼
                   │                          Supabase (csv_daily_returns,
                   ▼                          strategy_verifications ...)
┌──────────────────────────────────────────────────────────────────────┐
│   MT5 GATEWAY  (NEW self-hosted service — Wine/Docker on Fly or Railway)│
│  ┌──────────────┐   serialized login queue   ┌──────────────────────┐ │
│  │ HTTP shim    │──────(one at a time)───────▶│ MT5 terminal (Wine)  │ │
│  │ (FastAPI/    │  login(acct) → account_info │ Windows-Python +     │ │
│  │  rpyc)       │  → history_deals_get → JSON │ MetaTrader5 pkg      │ │
│  │  + watchdog  │◀────────────────────────────│ (one login at a time)│ │
│  └──────────────┘                             └──────────────────────┘ │
└──────────────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

| Component | Responsibility | Implementation | New/Modified/Reused |
|-----------|----------------|----------------|---------------------|
| **MT5 gateway** | Run the Windows MT5 terminal under Wine; expose login → `account_info` + `history_deals_get` as JSON over HTTP; serialize account logins; self-heal a hung terminal | Docker image (Wine + Windows Python 3.x + MT5 terminal + FastAPI shim + supervisord + watchdog + Xvfb). Community precedent: `gmag11/MetaTrader5-Docker`, `finautica/metatrader5-docker`, `mt5linux`/`pymt5linux` (rpyc bridge) | **NEW** |
| `Mt5Client` | Non-ccxt, read-only, timeout-bounded HTTP client to the gateway; secret-scrubbed fail-loud errors; owns its aiohttp session with a bounded `aclose()` | `services/mt5_client.py` | **NEW** (structural clone of `sfox_client.py`) |
| `make_mt5_client` | The ONE construction chokepoint: reads `MT5_GATEWAY_URL` + gateway auth from env, threads them explicitly | `services/mt5_factory.py` | **NEW** (clone of `sfox_factory.py`) |
| `Mt5Adapter` | 5-method `IngestionAdapter`; `validate` read-only branch; `compute_metrics`/`fetch_raw` **fail loud** | `services/ingestion/mt5.py` | **NEW** (clone of `ingestion/sfox.py`) |
| `combine_mt5_deal_ledger` | Deal ledger + balance-op flows + `account_info.equity` anchor → daily NAV → `chain_linked_twr` | `services/broker_dailies.py` | **NEW fn** (clone of `combine_native_ledger` / `combine_sfox_balance_history`) |
| `crawl_mt5_deals` | Bounded (request-budget + `wait_for`) crawl of `history_deals_get` windows | `services/mt5_read.py` | **NEW** (clone of `sfox_read.py` crawl) |
| Source lockstep | `'mt5'` in the `Source` Literal + `SUPPORTED_SOURCES` + `_FACTORIES` + `_make_mt5_adapter` | `services/ingestion/adapter.py`, `__init__.py` | **MODIFIED** (one-line additions) |
| `derive_basis_series` | Daily returns → basis series → metrics + charts + coverage | `services/basis_series.py` | **REUSED unchanged** |
| Key-save boundary | `SUPPORTED_EXCHANGES`, `EXCHANGE_DISPLAY`, `STRATEGY_SOURCES`, `UI_EXCHANGE_CODES`, flags | `src/lib/closed-sets.ts`, `src/lib/strategy-sources.ts` | **MODIFIED** |
| Constraint-widen migration | Admit `'mt5'` across the 4 hardcoded CHECKs | `supabase/migrations/<ts>_mt5_exchange_boundary_checks.sql` | **NEW** (clone of the sfox migration) |

---

## Q1 — The MT5 execution surface

### Component: a self-hosted MT5 gateway

A **single Docker image** running four things under `supervisord`:

1. **Wine** (Windows userspace on Linux) + a Windows-build Python.
2. The **MT5 terminal** (`terminal64.exe`) installed inside the Wine prefix, launched under **Xvfb** (a virtual X server — MT5 has no true `-headless` flag, so a virtual display is required; the community Docker images do exactly this).
3. The **HTTP shim** — a small FastAPI (or rpyc, via `pymt5linux`) server that exposes the read surface.
4. A **watchdog** that pings the terminal and restarts it (and re-`initialize()`s) on a hang — the WEDGE-01 lesson applied to the terminal process.

### Interface (deliberately minimal, read-only, GET-shaped)

The shim should expose exactly what the worker needs, mirroring `SfoxClient`'s four reads. One combined endpoint is cleanest because a login + two reads is one logical transaction on a serialized terminal:

```
POST /mt5/account-history
  body: { login, investor_password, server, from_ms, to_ms }
  → 200 { account: {equity, balance, currency, leverage, ...},   # account_info()
          deals: [ {ticket, time_msc, type, entry, profit, swap, commission,
                    volume, price, symbol, ...}, ... ] }          # history_deals_get(from,to)
  → 401  auth/login rejected (bad investor creds / server)
  → 409  terminal busy (login queue full / lock acquire timeout)
  → 503  terminal unavailable (crashed / re-initializing)
```

Keep the shim **read-only by construction**: it never exposes `order_send`. Combined with the **investor password** (which the broker itself refuses trades on), read-only is a *structural* property — exactly the sFOX `read_only=True` posture (never a probed scope triple).

### How the worker's `Mt5Client` talks to it

`Mt5Client` is a near-copy of `SfoxClient`:

- Owns an `aiohttp.ClientSession` with an explicit `ClientTimeout(total=MT5_REQUEST_TIMEOUT_S)` (sFOX uses 30s; MT5's login+crawl is heavier, budget ~120–180s — the terminal may take seconds to switch accounts).
- Single `_request` chokepoint; `trust_env=False`; secret-scrubbed fail-loud (`Mt5ApiError(status, detail)` carrying the HTTP status so `401/403 → AUTH_FAILED`, `status=0 → transient`), **never** logging the investor password.
- Bounded, idempotent `aclose()`.
- Gateway auth: a shared-secret bearer header (`MT5_GATEWAY_TOKEN`) — the gateway is *our* service and must not be an open read endpoint on the internet.

`make_mt5_client(login, investor_password, server)` (the factory) reads `MT5_GATEWAY_URL` + `MT5_GATEWAY_TOKEN` once and threads them explicitly — the same "one place env becomes config" discipline as `sfox_factory`.

### Deployment topology: single gateway vs pool vs one-container-per-account

| Option | Model | Verdict |
|--------|-------|---------|
| **Single gateway, serialized login queue** ✅ **v1** | One container, one terminal; the shim holds an `asyncio.Lock` (or a small FIFO queue) around `login → read → return`. Account switching is a cheap `mt5.login(acct, pw, server)` on the same terminal. | **RECOMMENDED for v1.** Pre-revenue, few accounts, sync is a periodic cron not interactive. Simplest to build/operate. Login latency (seconds) is invisible on a background derive. |
| **Pool of K terminals behind the shim** | K containers/terminals, dispatched by a queue; the shim load-balances a request to a free terminal. | **Scale path, not v1.** Adopt when concurrent-account demand or per-sync latency forces it. The shim interface above is unchanged — only its dispatch internals grow. |
| **One container per account** | A dedicated terminal permanently logged into each account. | **REJECT.** Terminals are heavy (~200–400MB RAM + a Wine prefix each), account count is unbounded, and login-switching on a shared terminal is cheap — so per-account containers buy nothing but cost. |

**Recommendation:** ship the **single serialized gateway**. Design the `Mt5Client` ↔ shim contract so a future pool is an internal gateway change, invisible to the worker.

**Deploy target:** the gateway is a **Linux Docker image running Wine** (not literally Windows), so it deploys on any Docker host. Two realistic homes: **Fly.io** (the sFOX milestone already produced Fly Dockerfile/deploy artifacts and founder ops muscle) or **Railway as a second service** (the worker already lives there; Railway runs arbitrary Docker images). Prefer whichever the founder can operate; Fly gives cleaner isolation for a heavyweight always-on Wine container. This is a **founder-gated ops step**, exactly like the sFOX Fly egress.

---

## Q2 — Where `'mt5'` slots into the existing lockstep

Every one of these is a **one-line clone of the sfox change** (Phase 118–122). The lockstep test `test_source_literal_and_registry_agree` forces the Python triple to move together.

| Site | File | Change |
|------|------|--------|
| Source Literal | `analytics-service/services/ingestion/adapter.py` | `Source = Literal[..., "sfox", "mt5"]` |
| Registry tuple | `services/ingestion/__init__.py` | `SUPPORTED_SOURCES = (..., "sfox", "mt5")` |
| Factory | `services/ingestion/__init__.py` | add `_make_mt5_adapter()` + `_FACTORIES["mt5"]` |
| Adapter | `services/ingestion/mt5.py` (NEW) | `Mt5Adapter` — `validate` read-only branch (login probe → `read_only=True` structural); `fetch_raw` + `compute_metrics` **fail loud** (returns are ledger-backed, never fill-derived — the BYB-02 corruption guard) |
| Worker validate/close | `services/exchange.py` | `aclose_exchange` `isinstance(exchange, Mt5Client)` branch (lazy import), like the `SfoxClient` branch already there |
| Preflight construction | `services/job_worker.py::_make_exchange_client` | `if exchange_name == "mt5": return make_mt5_client(...)` — but note MT5 needs **three** credential fields (see Q3), not a single trimmed `api_key` |
| Native-returns venue | `services/job_worker.py::_NATIVE_RETURNS_VENUES` | add `"mt5"` so the ccxt USD-space combine never clobbers the reconstructed MT5 TWR |
| Crawl bound | `services/job_worker.py` | new `_MT5_CRAWL_TIMEOUT_S` sized so `mt5 + reserve ≤ _DERIVE_OUTER_BUDGET_S` (the serial-sum invariant) |
| TS exchange allowlist | `src/lib/closed-sets.ts` | `SUPPORTED_EXCHANGES = [..., "sfox", "mt5"]` + `EXCHANGE_DISPLAY.mt5 = "MetaTrader 5"` |
| TS UI offer gate | `src/lib/closed-sets.ts` | `MT5_UI_ENABLED = process.env.NEXT_PUBLIC_MT5_ENABLED === "true"`; `isMt5EnabledServer()`; append `"mt5"` to `UI_EXCHANGE_CODES` only when the flag is on |
| TS strategy source | `src/lib/strategy-sources.ts` | add `"mt5"` (paired with the migration; parity test `strategy-sources-migration-parity.test.ts`) |
| **Asset class** ⚠️ | `src/lib/closed-sets.ts::isCryptoExchange` + the Python mirror | **DIVERGENCE FROM sFOX:** MT5 is forex/CFD = **traditional (√252)**, not crypto (√365). `isCryptoExchange` currently returns `true` for *every* supported exchange. It must be narrowed to an explicit crypto subset that **excludes `'mt5'`** (the code already flags this exact future in its comment at closed-sets.ts:210-216). This propagates into `strategies.asset_class = 'traditional'` for MT5 keys. |
| Key routes | `src/app/api/keys/validate-and-encrypt/route.ts`, `create-with-key/route.ts`, `composite/add-key/route.ts` | accept `'mt5'` behind `isMt5EnabledServer()` fail-closed gate (clone the sFOX server-gate pattern) |
| Migration | `supabase/migrations/<ts>_mt5_exchange_boundary_checks.sql` (NEW) | clone `20260718182056_sfox_exchange_boundary_checks.sql` **exactly**: widen the SAME 4 CHECKs (`api_keys.exchange`, `compute_jobs.exchange`, `strategies.source`, `strategy_verifications.source`) to append `'mt5'`, each with a self-verifying `DO` block. **Deliberately skip** the same excluded CHECKs (`funding_fees`, `position_snapshots`) — MT5 has no perp funding or derivative position snapshots. |

**Read-only branch (`Mt5Adapter.validate`):** attempt a gateway `account-history` call with a tiny window. A `200` proves the investor creds authenticate AND can read → `ValidationResult(valid=True, read_only=True)` (structural). `401/403` → `AUTH_FAILED`. Transient (gateway `503`/`409`, `status=0`) → **propagate untouched** so the caller classifies it honestly. Exactly the sFOX `validate` shape (`ingestion/sfox.py:56-107`).

---

## Q3 — Data flow: MT5 reads → daily equity → the ONE backbone

### What MT5 gives you (and how it differs from sFOX)

- **`account_info()`** → current `equity`, `balance`, `currency`, `leverage`. This is the current-NAV anchor (mark-to-market, includes floating P/L) — analogous to sFOX's current equity and deribit's account summary.
- **`history_deals_get(from, to)`** → the **deal ledger**: each closed deal carries `profit`, `swap`, `commission`, `volume`, `price`, `symbol`, `type`, `entry`, plus **balance operations** (deposits/withdrawals appear as deal `type == DEAL_TYPE_BALANCE`).

MT5 has **no `balance/history` endpoint** (sFOX's `usd_value` daily series does not exist here). So MT5's data flow is **closer to deribit than sFOX**: reconstruct daily NAV from the *deal ledger* rather than reading a pre-computed equity series.

### The reconstruction (NEW: `combine_mt5_deal_ledger`)

Mirror `broker_dailies.combine_native_ledger` (deribit's txn-log ledger path):

1. **Realized daily P/L** = per-day sum of `profit + swap + commission` over non-balance deals.
2. **External flows** = the `DEAL_TYPE_BALANCE` deposits/withdrawals, dated → fed into the **numerator** of `chain_linked_twr` exactly as sFOX/deribit flows are (the flow-aware TWR the whole backbone already runs — `nav_twr.chain_linked_twr`).
3. **Anchor** = `account_info().equity` as the terminal current-NAV; roll backward on the realized-basis series (the v1.8 convention — realized-basis reconstruction, re-add current uPnL only to the reported *current* NAV, raise the `unrealized_pnl_in_anchor` DQ flag when the floating-P/L wedge is material). MT5 exposes floating P/L only for *currently open* positions, not historically — so per-day uPnL true-up is **not** available; realized-basis reconstruction + the DQ flag is the honest path (the same posture v1.8 locked for every venue).
4. Result: a daily NAV series → `chain_linked_twr` (**REUSED**) → `derive_basis_series` (**REUSED, unchanged**) → daily returns → metrics/charts/coverage → **`api_verified`** stamp.

**Currency note (NEW consideration):** MT5 accounts are denominated in the account currency (often USD, but EUR/GBP accounts exist). The reconstruction is currency-internally-consistent (returns are ratios), so a non-USD account still yields correct *returns* without FX conversion — but any USD-labelled display must either convert or honestly label the account currency. Default: compute returns in account currency (correct), surface the currency in metadata. Do not fabricate a USD NAV.

**What's new vs reused:**

| New | Reused unchanged |
|-----|------------------|
| MT5 gateway + `Mt5Client` + `mt5_factory` | `chain_linked_twr` |
| `Mt5Adapter` (fail-loud) | `derive_basis_series` (the ONE backbone) |
| `combine_mt5_deal_ledger` + `crawl_mt5_deals` | `api_verified` provenance stamp (Phase-111 tiers) |
| 3-field credential shape + asset-class=traditional | `csv_daily_returns` dual-axis persistence, coverage mask, factsheet render |

### Credential storage + encryption

MT5 auth is **three fields**, unlike sFOX's single Bearer token or ccxt's key/secret/passphrase:

- **login** (account number — an integer, identifying but not secret)
- **investor password** (the read-only password — SECRET)
- **broker server** (e.g. `"ICMarketsSC-Demo"` — required, not secret)

Store all three **KEK-encrypted** in the existing `api_keys` row (`exchange='mt5'`), reusing `services/encryption.py` unchanged. The cleanest mapping onto the existing `{api_key, api_secret, passphrase}` credential slots:

- `api_key` ← **login** (account number as string)
- `api_secret` ← **investor password**
- `passphrase` ← **broker server**

This lets `decrypt_credentials` and the whole encrypted-blob plumbing stay byte-identical; `_make_exchange_client('mt5', ...)` unpacks the three slots into `make_mt5_client(login=api_key, investor_password=api_secret, server=passphrase)`. Document the mapping loudly at that one chokepoint (a comment, like the sFOX "api_secret intentionally never passed" note at `job_worker.py:771-774`) so no one misreads `passphrase` as an OKX passphrase. **Read-only is guaranteed by the investor password itself** — the broker refuses order placement on an investor login — so it is structural, never probed.

---

## Q4 — Concurrency + reliability

The platform already learned the wedge lesson twice (v1.11 FLIP rollback, WEDGE-01). MT5 adds a *second* stateful bottleneck (the terminal) behind the *first* (the sequential worker loop). Bound **both**.

### Serialization (gateway side)

- **One terminal = one login at a time.** `initialize()` attaches to the terminal; `login(acct, pw, server)` switches the active account; deals/`account_info` read the *currently logged-in* account. There is **no concurrent multi-account** capability on a single terminal (confirmed against MT5 docs — only sequential logins are shown).
- The shim holds an `asyncio.Lock`/FIFO around the whole `login → read → return` transaction. A second request waits or gets a fast `409 busy` (worker classifies `409` as transient → retry). Never let two logins interleave — that would read account B's deals under account A's request.

### Session lifecycle

- Keep the terminal **warm** (don't relaunch per request — Wine + terminal boot is slow). `login()` per request switches accounts on the warm terminal.
- **Watchdog** (supervisord + a health ping): if `terminal_info()`/`account_info()` returns falsy or a ping hangs, kill + relaunch the terminal and re-`initialize()`. This is the WEDGE-01 pattern (heavy/blocking work must not freeze the health surface) applied to the gateway.

### The worker must never block (the core lesson)

Two nested bounds, exactly as sFOX layers them (`sfox_client.py` `SFOX_REQUEST_TIMEOUT_S` inside `job_worker.py` `_SFOX_CRAWL_TIMEOUT_S`):

1. **Transport bound (`Mt5Client`):** explicit `aiohttp.ClientTimeout` (~120–180s) so a hung gateway response fails loud fast instead of riding aiohttp's implicit 300s default into the worker's ~90s healthz budget.
2. **Crawl/handler bound (`job_worker`):** `_MT5_CRAWL_TIMEOUT_S` via `asyncio.wait_for`, sized so `mt5_crawl + post_crawl_reserve ≤ _DERIVE_OUTER_BUDGET_S` (the serial-sum-vs-outer invariant the code asserts). A hang → `asyncio.TimeoutError` → `classify_exception` → **transient** → retry (not `failed_final`). Size the bound to the crawl's *legitimate* duration (login latency + N deal-history windows), never a blind flat ceiling that manufactures false transients on large accounts (the red-team lesson at `job_worker.py:198-206`).

### Failure modes to handle

| Failure | Classification | Handling |
|---------|----------------|----------|
| Bad investor creds / wrong server | permanent (`AUTH_FAILED`) | honest `KEY_AUTH_FAILED`, no retry |
| Gateway terminal hung / restarting | transient (`503`/`status=0`) | worker retries; watchdog heals the terminal |
| Login queue contention (`409`) | transient | retry after backoff |
| Broker throttles rapid re-logins | transient | serialize + light backoff between logins on the shared terminal |
| Forex market closed (weekend) | not an error | deals still readable; `account_info` static — no special handling, just no new returns that day |
| Non-finite / malformed deal row | permanent (fail loud) | `Mt5FlowValuationError`, never coerce to 0 (the sFOX `_sfox_rows_to_usd_value_series` NaN-guard precedent at `job_worker.py:812-821`) |

---

## Q5 — Suggested build order (dependency-respecting)

```
1. MT5 GATEWAY (new infra)  ──────────────────────────┐
   Wine+MT5+HTTP shim Docker image; serialized login   │  founder-gated deploy (like sFOX Fly)
   queue; watchdog. Smoke: investor login → account_    │
   info + history_deals_get → JSON.                     │
                                                        ▼
2. Mt5Client + mt5_factory  ────────────────────────────
   non-ccxt read-only HTTP client to the gateway;        depends on #1's contract
   bounded transport timeout; secret-scrubbed fail-loud;
   bounded aclose(); gateway shared-secret auth.
   Green smoke test against the gateway.
        │
        ├────────────────────────────┬──────────────────────────────┐
        ▼                            ▼                                │
3. SOURCE LOCKSTEP + KEY-SAVE     4. EQUITY RECONSTRUCTION            │
   Mt5Adapter (fail-loud) +          combine_mt5_deal_ledger +       │
   Literal/SUPPORTED_SOURCES/         crawl_mt5_deals +               │
   _FACTORIES; validate read-only;    _make_exchange_client('mt5') +  │  both depend on #2
   closed-sets.ts + strategy-         _NATIVE_RETURNS_VENUES += mt5 + │
   sources.ts; 3-field credential     _MT5_CRAWL_TIMEOUT_S.           │
   mapping; asset-class=traditional   → chain_linked_twr →            │
   (narrow isCryptoExchange);         derive_basis_series →           │
   4-CHECK migration; 3 key routes;   api_verified stamp.             │
   MT5_ENABLED / NEXT_PUBLIC flags.   Ground-truth parity check.      │
        │                            │                                │
        └──────────────┬─────────────┘                                │
                       ▼                                              │
5. UI + E2E  ──────────────────────────────────────────              │
   flag-gated add-key card + picker + investor-password              │  depends on #3
   read-only setup guide + api_verified badge; e2e all roles.        │
                       │                                              │
                       ▼                                              ▼
6. GO-LIVE OPS (founder-gated) ─────────────────────────────────────
   Deploy gateway; provision investor creds; set MT5_ENABLED +
   NEXT_PUBLIC_MT5_ENABLED; live parity acceptance. Ships flag-OFF
   until then (the sFOX Foundation close pattern).
```

**Critical path:** 1 → 2 → 4 → 6 (the read + reconstruction + go-live). #3 and #5 run parallel-ish once #2 lands. **#1 is the long pole** (new infra, Wine/Docker fiddliness) and is founder-gated — start it first, in isolation, because everything else stubs against its HTTP contract.

---

## Scaling Considerations

| Scale | Architecture Adjustments |
|-------|--------------------------|
| few accounts (v1) | Single gateway, single terminal, serialized login queue. Login-switch latency invisible on background derives. |
| tens of accounts / faster sync | Pool of K warm terminals behind the same shim; queue-dispatch to a free terminal. Worker contract unchanged. |
| many concurrent + latency-sensitive | Horizontal gateway replicas; sticky nothing (login per request is stateless-per-transaction); the bottleneck stays terminal count, so scale terminals not shims. |

### Scaling Priorities

1. **First bottleneck:** the single terminal's serialized login queue — if syncs pile up, one hung login stalls the queue. Mitigated by the watchdog + `409` fast-fail + worker retry. Fix by moving to a pool.
2. **Second bottleneck:** Wine container RAM (each terminal ~200–400MB). Pooling multiplies this; size the host accordingly before adding terminals.

---

## Anti-Patterns

### Anti-Pattern 1: Trying to run `MetaTrader5` in the Linux worker
**What people do:** `pip install MetaTrader5` into `analytics-service` and call it in-process like ccxt/sFOX.
**Why it's wrong:** the package is Windows-only and requires a running terminal process; it will not import on Linux, and even under Wine it cannot share the worker's event loop safely.
**Do this instead:** the out-of-process gateway. The worker only ever speaks HTTP to it.

### Anti-Pattern 2: Fill-based `compute_metrics` for MT5
**What people do:** normalize MT5 deals into `Trade` fills and run the shared `EquityCurveBuilder` metrics.
**Why it's wrong:** the BYB-02 corruption class — a silently-empty/wrong track record. MT5 returns are ledger-backed (deals + balance flows → NAV → TWR), not fill-derived.
**Do this instead:** `Mt5Adapter.compute_metrics` and `fetch_raw` **fail loud** (mirror `SfoxAdapter`); returns flow through `combine_mt5_deal_ledger` → the backbone.

### Anti-Pattern 3: Treating MT5 as crypto (√365)
**What people do:** inherit the "all supported exchanges are crypto" shortcut in `isCryptoExchange`.
**Why it's wrong:** MT5 is forex/CFD — a weekday market. √365 would inflate Sharpe/vol.
**Do this instead:** narrow `isCryptoExchange` to an explicit crypto subset excluding `'mt5'`; stamp `asset_class='traditional'` (#597 √252). The code already anticipated this exact narrowing.

### Anti-Pattern 4: Unbounded gateway calls / one login per terminal boot
**What people do:** call the gateway with aiohttp's default timeout, or relaunch the terminal per request.
**Why it's wrong:** a hung terminal wedges the sequential worker (the v1.11/WEDGE-01 class); per-request terminal boot is minutes of Wine startup.
**Do this instead:** warm terminal + `login()` switch; nested `ClientTimeout` + `asyncio.wait_for` bounds; watchdog-healed terminal; `TimeoutError → transient` retry.

---

## Integration Points

### External Services

| Service | Integration Pattern | Notes |
|---------|---------------------|-------|
| MT5 gateway (self-hosted) | `Mt5Client` aiohttp/HTTPS to `MT5_GATEWAY_URL`, shared-secret bearer auth, bounded timeout | The ONE new component; Wine/Docker on Fly or Railway; founder-gated deploy |
| Broker MT5 server | via the gateway's `login(acct, pw, server)` — investor password only | Read-only by construction; brokers may throttle rapid re-logins |

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| Next.js key routes ↔ worker | existing `/validate-key` + `/process-key` + `compute_jobs` enqueue | `'mt5'` admitted behind `isMt5EnabledServer()` fail-closed gate |
| `job_worker` ↔ `Mt5Client` | direct call via `_make_exchange_client('mt5')` chokepoint | 3-field credential unpack; bounded `wait_for` |
| `combine_mt5_deal_ledger` ↔ `derive_basis_series` | daily NAV Series → the ONE backbone | REUSED unchanged; `_NATIVE_RETURNS_VENUES` prevents the ccxt combine clobbering the MT5 TWR |
| `Mt5Adapter` ↔ Source registry | `_FACTORIES["mt5"]` lazy import; lockstep with the `Source` Literal | `test_source_literal_and_registry_agree` enforces it |

---

## Sources

- Internal (HIGH): shipped sFOX foundation — `services/sfox_client.py`, `services/sfox_factory.py`, `services/ingestion/sfox.py`, `services/ingestion/adapter.py` + `__init__.py`, `services/broker_dailies.py` (`combine_sfox_balance_history`, `combine_native_ledger`), `services/job_worker.py` (crawl bounds, `_NATIVE_RETURNS_VENUES`, `_make_exchange_client`, `_sfox_rows_to_usd_value_series`), `services/sfox_read.py`; `src/lib/closed-sets.ts`, `src/lib/strategy-sources.ts`; `supabase/migrations/20260718182056_sfox_exchange_boundary_checks.sql`; `.planning/PROJECT.md` (v1.15 milestone + key decisions).
- MT5 Python API (MEDIUM): [login() docs](https://www.mql5.com/en/docs/python_metatrader5/mt5login_py), [history_deals_get() docs](https://www.mql5.com/en/docs/python_metatrader5/mt5historydealsget_py), [account_info() docs](https://www.mql5.com/en/docs/python_metatrader5/mt5accountinfo_py) — confirm three-field login, sequential-only account switching, terminal requirement, investor-password read-only.
- Wine/Docker hosting precedent (MEDIUM): [gmag11/MetaTrader5-Docker](https://github.com/gmag11/MetaTrader5-Docker), [finautica/metatrader5-docker](https://github.com/finautica/metatrader5-docker), [mt5linux](https://pypi.org/project/mt5linux) / [pymt5linux](https://github.com/hpdeandrade/pymt5linux) (rpyc bridge pattern), [MT5 on Linux via Docker + Python](https://medium.com/@asc686f61/use-mt5-in-linux-with-docker-and-python-28cdf1867d95).

---
*Architecture research for: v1.15 MetaTrader 5 live api_verified account sync*
*Researched: 2026-07-23*
