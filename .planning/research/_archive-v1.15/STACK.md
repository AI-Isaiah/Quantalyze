# Stack Research — v1.15 MetaTrader 5 live `api_verified` account sync

**Domain:** Self-hosted headless MetaTrader 5 terminal read-path (forex/CFD `api_verified` account sync) for a Linux Python worker
**Researched:** 2026-07-23
**Confidence:** HIGH (package versions + API surface verified via Context7 + PyPI; hosting setups verified against maintained OSS images; concurrency limit corroborated by MQL5 forum + docs)

## The Core Problem (resolved up front)

The official `MetaTrader5` PyPI package ships **Windows x86-64 wheels only** — there is **no Linux wheel and no source distribution** (verified on PyPI, v5.0.5735, 2026-04-04; classifiers `Operating System :: Microsoft :: Windows`). Our worker runs on **Railway (Linux)**. So `pip install MetaTrader5` on the Railway worker **will fail / resolve nothing installable** — the package cannot run in-process on our worker.

The package is also **not a network client** on its own: it talks to a **locally running MT5 terminal.exe** over a local IPC channel. So "read an MT5 account" always means "have a running Windows MT5 terminal somewhere, and reach it." Three real ways to get that terminal running server-side, all covered below.

**Recommended setup (one-liner):** run the **`gmag11/MetaTrader5-Docker` Wine image as a normal Linux container** (on a small VPS, Fly, or Railway) — it bundles Wine + a Windows Python + the terminal + an **RPyC bridge on :8001**; our Railway worker's `Mt5Adapter` connects to it as a network client via **`mt5linux`**, does a **sequential login→read→logout loop** over the N allocator accounts (read-only investor password), and feeds deal/balance history into the existing `chain_linked_twr → derive_basis_series` backbone with the `api_verified` stamp. This keeps the Windows dependency **out of our worker process** and needs **no Windows host**.

---

## Recommended Stack

### Core Technologies

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| **`gmag11/MetaTrader5-Docker`** (Wine + KasmVNC + RPyC) | **v2.3** (2025-12) | Runs the headless MT5 terminal + a Windows Python + an RPyC server, packaged as a **Linux** container (Debian base, ~4 GB, amd64 only) | It is the maintained, batteries-included way to get a terminal running server-side WITHOUT a Windows host. Exposes RPyC on `:8001` (the `mt5linux` protocol) and a browser VNC on `:3000` for the one-time manual terminal install/login. Terminal auto-updates independently of the image. |
| **`mt5linux`** | **1.0.3** (2026-02-20) | Network client the Railway worker imports: `from mt5linux import MetaTrader5; mt5 = MetaTrader5(host, port)`. Wraps the whole `MetaTrader5` API over RPyC | Lets the Linux worker call the full MT5 Python API **as a remote client** — no Windows wheel needed on the worker. Same method names/return shapes as the official package, so the adapter code is portable if we ever move to a native Windows host. |
| **`MetaTrader5`** (official) | **5.0.5735** (2026-04-04); Python `>=3.6,<4` | The actual API implementation — runs **inside** the container's Windows-Python-under-Wine, NOT on our worker | Ground-truth API. We never `pip install` it on Railway; it lives in the container. `mt5linux` proxies to it. |
| **MT5 terminal (`terminal64.exe`)** | Auto-updated by broker | The process that actually holds the broker connection and the account session | One terminal = **one active account at a time** (load-bearing — see Concurrency). Installed once inside the container via VNC. |

### Supporting Libraries (worker-side, mostly already present)

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `rpyc` | pulled by `mt5linux` | Transport between worker and the Wine container | Transitive; pin to whatever `mt5linux==1.0.3` requires. Worker only needs the client half. |
| `pandas` | already in `analytics-service` | Turn `history_deals_get()` namedtuple tuples into a deals frame → daily realized PnL | Reuse existing dataframe → daily-returns machinery; no new dep. |
| existing backbone | in-repo | `chain_linked_twr` → `derive_basis_series`, `api_verified` provenance stamp | **Do NOT rebuild.** `Mt5Adapter` produces a daily equity/return series and hands off, exactly like `SfoxAdapter`. |

### Development / Ops Tools

| Tool | Purpose | Notes |
|------|---------|-------|
| KasmVNC (in the image, `:3000`) | One-time manual: install terminal, add broker account with **investor password**, enable auto-login | Browser-based; no VNC client needed. After first login the terminal remembers the account; RPyC `login()` can then switch accounts. |
| Docker / Railway service or Fly Machine | Host the Wine container | The image is a **Linux** container (Wine inside), so it deploys on any Linux Docker host — including Railway and Fly. It does **not** require a Windows host. |
| RPyC health probe | Liveness: worker pings `mt5.terminal_info()` before a sync run | If the terminal died/needs re-login, fail loud (mirror sFOX `KEY_AUTH_FAILED`), never emit invented data. |

## Installation

```bash
# --- Worker side (analytics-service on Railway) — network client only ---
pip install mt5linux==1.0.3        # brings rpyc; NO Windows wheel involved
# DO NOT: pip install MetaTrader5   # Windows-only wheel → unusable on Linux worker

# --- Terminal host (the Wine container) ---
docker run -d --name mt5 \
  -p 3000:3000 \      # KasmVNC (one-time install/login of the terminal)
  -p 8001:8001 \      # RPyC bridge the worker connects to (mt5linux)
  -v mt5-config:/config \   # persist the Wine prefix + terminal + saved account
  gmag11/metatrader5_vnc:2.3
# Then: open http://host:3000 → install terminal → log in with INVESTOR password.
```

Worker connection sketch (mirrors `SfoxClient` seam):

```python
from mt5linux import MetaTrader5
mt5 = MetaTrader5(host=MT5_BRIDGE_HOST, port=8001)   # network client
mt5.initialize(path=r"C:\Program Files\MetaTrader 5\terminal64.exe")
mt5.login(login=acct_login, password=investor_pw, server=broker_server)  # read-only
acct = mt5.account_info()                    # equity/balance/currency/leverage snapshot
deals = mt5.history_deals_get(date_from, date_to)   # realized PnL + external flows
mt5.shutdown()
```

## Read API Surface → backbone mapping

`account_info()` → `AccountInfo` namedtuple. Load-bearing fields:
`equity`, `balance`, `currency`, `leverage`, `profit` (open uPnL), `margin`, `margin_free`, `server`, `company`, `name`, `trade_mode`. This is a **current snapshot only — MT5 exposes no historical equity series** (same limitation family as the venues behind the v1.8 uPnL-wedge decision).

`history_deals_get(date_from, date_to, group=None)` → tuple of `TradeDeal` namedtuples. Load-bearing fields:
`ticket, time (unix s), type, entry, position_id, volume, price, commission, swap, profit, fee, symbol, comment`.
- `type == 2` (`DEAL_TYPE_BALANCE`) → **deposit/withdrawal = external cash flow** for the flow-aware TWR backbone.
- realized PnL per closing deal = `profit + swap + commission + fee`.
- **Daily equity reconstruction:** start from a balance anchor, roll forward cumulative realized PnL, treat `DEAL_TYPE_BALANCE` deals as dated external flows → daily returns → `chain_linked_twr` → `derive_basis_series`. This is exactly the sFOX/Deribit pattern; do **not** invent a new path.

`history_orders_get(...)` → `TradeOrder` tuples. Secondary (audit/attribution); not required for the equity series.
`positions_get(...)` → `TradePosition` tuples (open positions + live uPnL). Use only for a current-NAV true-up, not history.
`copy_rates_range/copy_rates_from` → OHLC bars. **Only** needed if we ever mark open positions historically (per-day uPnL true-up) — defer, same MEDIUM-confidence gate as v1.8 TWR-05.

**Annualization (per #597 + PROJECT.md):** MT5 = forex/CFD = traditional asset class → **√252 for risk** (Sharpe/vol), calendar-day clock for return/CAGR. lot→USD notional, swap/commission are real costs already in the deals.

## Concurrency Reality (load-bearing for architecture)

- **One terminal instance = one *active* account at a time.** A terminal can *store* many accounts, but only one is live. The official Python API does **not** support multiple accounts bound to one terminal simultaneously (verified: MQL5 forum + docs).
- `mt5.login(login, password, server)` **switches** the active account/server within a running terminal (logout-implied). So one terminal can serve N accounts **sequentially**, across different brokers/servers, as long as the terminal can resolve each broker server.
- **Recommended model — sequential login loop on ONE terminal:** this sync is a **once-daily batch read** (like sFOX), not real-time. For each allocator MT5 key: `login → account_info + history_deals_get → next login`. N accounts = N sequential logins in one container. Simple, cheap, no pool.
- **Scale-out only if needed:** if login-churn latency or per-broker session stickiness becomes a problem, run a **small pool of portable-mode terminals** (`terminal64.exe /portable`, separate data folders → separate RPyC ports), sharded by broker. MT5 tolerates ~24–28 stable instances per host (32 hard cap) — far more than the near-term account count. **Do not** go one-container-per-account (4 GB image each = wasteful) until account volume forces it.
- **Serialize access:** because a login switches the whole terminal's active account, the worker must **not** interleave two accounts against the same terminal concurrently. Guard the sync with a per-terminal lock (the daily-batch cadence makes this trivial).

## Alternatives Considered (hosting the terminal)

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| Wine Docker image (`gmag11`) on a Linux host | **Native Windows VPS** (Contabo/Vultr/QuantVPS Windows, ~$10–50/mo) running the official `MetaTrader5` wheel + a small RPyC/FastAPI shim | Choose this if Wine proves flaky with a specific broker's terminal build, or you want the vendor-supported (non-Wine) path. Higher cost, Windows patching burden, but zero Wine risk. Same adapter code (mt5linux points at the shim). |
| Wine Docker image on **Railway/Fly** (Linux container) | Wine Docker image on a **cheap dedicated VPS** (Hetzner CX22 ~€4/mo, Contabo) | Use a VPS if you want a persistent Wine prefix + terminal auto-updates decoupled from Railway's ephemeral filesystem and per-usage billing. A persistent volume is mandatory either way (the terminal install + saved investor login must survive restarts). |
| `mt5linux` RPyC bridge | `gmag11` image's built-in DataBridge / a hand-rolled FastAPI-over-`MetaTrader5` shim | Only if `mt5linux` 1.0.3 shows instability; the shim gives you full control of the read surface and a narrower attack surface. |

**Rough cost:** cheapest viable = **~€4–6/mo** (Hetzner/Contabo Linux VPS running the Wine container) or fold into existing Railway/Fly spend. A native Windows VPS path is **~$10–50/mo**. All are trivial next to the trust value of `api_verified`.

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| `pip install MetaTrader5` on the Railway worker | **Windows-only wheel, no Linux dist** — resolves to nothing installable; the whole "run in-process on our Linux worker" idea is a dead end | `mt5linux` network client → Wine-container terminal |
| **MetaApi.cloud** (`metaapi.cloud` SDK) | Founder explicitly rejected (2026-07-23). Vendor lock-in, per-account SaaS pricing, sends account creds to a third party — defeats the self-host trust story | Self-hosted terminal + `MetaTrader5`/`mt5linux` |
| **Broker Manager API** (`mt5manager` / MT5 Manager/Gateway API) | Server-side API for **brokers** operating an MT5 server, not for investors reading their own account; wrong trust/permission model, not obtainable per allocator | Investor-password read via the terminal API |
| **Master password** login | Full trade rights — violates read-only invariant | **Investor password only** (read-only: sees status/history, cannot trade). Assert read-only STRUCTURALLY like sFOX. |
| Real-time tick/position streaming, EA push, order endpoints | Out of scope (live account *sync*, not report ingest or trading); the legacy EA push is the `self_reported` path we're **superseding** | Once-daily batch: `account_info` + `history_deals_get` → backbone |
| A new equity/returns pipeline | The ONE `chain_linked_twr → derive_basis_series` backbone already exists and is the whole point | Reuse it; `Mt5Adapter` mirrors `SfoxAdapter` and hands off a daily series |
| `mt5linux` legacy `0.1.x` / abandoned forks (`mt5-server`, `pymt5`) | Stale (2022-era), API drift, no maintenance | `mt5linux==1.0.3` (Feb 2026) |

## Stack Patterns by Variant

**If account volume stays small (≤ a few dozen, near-term):**
- ONE Wine container, ONE terminal, **sequential login/logout** batch loop.
- Because a daily read tolerates serial logins and this is the lowest-cost, lowest-op-surface setup.

**If login-churn latency or per-broker stickiness bites:**
- Small **pool of portable-mode terminals** (`/portable`, distinct data dirs + RPyC ports), sharded by broker; worker load-balances across ports with a per-terminal lock.
- Because portable mode is the sanctioned MT5 multi-instance mechanism (≤~24–28 stable/host).

**If Wine proves unreliable for a specific broker build:**
- Move that broker to a **native Windows VPS** running the official wheel behind the same RPyC/shim contract.
- Because the adapter talks a stable client protocol; only the host swaps.

## Version Compatibility

| Package A | Compatible With | Notes |
|-----------|-----------------|-------|
| `MetaTrader5==5.0.5735` | Python 3.6–3.14 (Windows) | Runs **inside** the container's Windows Python only. |
| `mt5linux==1.0.3` | Python 3 (worker side); RPyC to the container | Same method names/shapes as official `MetaTrader5` → `Mt5Adapter` code is host-agnostic. |
| `gmag11/metatrader5_vnc:2.3` | amd64 only; Debian base; ~4 GB | **No ARM** — pick an amd64 host (Railway/Fly/most VPS default to amd64; avoid ARM instances). Needs a **persistent volume** for `/config` (Wine prefix + terminal + saved investor login). |
| RPyC bridge | worker ↔ container | Keep the bridge on a private network / internal Railway networking; the investor password + open RPyC port must not be publicly reachable. |

## Integration Points into the Existing Worker

1. **`Source` lockstep** — add `"mt5"` to the `Source` Literal (`analytics-service/services/ingestion/adapter.py:45`) **and** `SUPPORTED_SOURCES`/`_FACTORIES` (`analytics-service/services/ingestion/__init__.py`) together, exactly as `sfox`/`deribit` did (there is a pinned `test_source_literal_and_registry_agree`).
2. **`Mt5Adapter`** — mirror `SfoxAdapter`: a thin `Mt5Client` (mt5linux RPyC seam, proxy-able host/port) + adapter that builds the daily series from deals/balance history and hands to `derive_basis_series` with `api_verified`. `compute_metrics` fail-loud (metrics come from the backbone, not the adapter).
3. **Worker `validate_key`** — read-only branch: `login()` with investor password, assert success, honest `KEY_AUTH_FAILED` on failure; no write/scope probe (structural read-only, like sFOX).
4. **Key routes + DB** — the 3 Vercel key routes accept `mt5`; constraint-widening migration admits `'mt5'` across the exchange CHECKs (mirror the sFOX migration).
5. **Flag-gating** — `MT5_ENABLED`/`NEXT_PUBLIC_MT5_ENABLED`, ships OFF (byte-identical when off), like sFOX.
6. **Egress/networking** — worker → RPyC bridge on a **private** hop (not the public static-egress path). The broker connection is made by the *terminal*, so broker-side IP allowlisting (if any) keys off the **container/VPS** IP, not our worker egress IPs — a different consideration than the sFOX Fly-egress model. Flag this for the infra phase.

## Sources

- `/lucas-campagna/mt5linux` (Context7) — `account_info` `AccountInfo` fields, `history_deals_get` `TradeDeal` fields, `login()` signature, `initialize(path=...)` — HIGH
- https://pypi.org/project/MetaTrader5/ — v5.0.5735 (2026-04-04), Windows-x86-64-only wheels, Python >=3.6,<4 — HIGH
- https://pypi.org/project/mt5linux/ — v1.0.3 (2026-02-20), Wine+RPyC bridge, maintenance cadence — HIGH
- https://github.com/gmag11/MetaTrader5-Docker — v2.3 (2025-12), Wine+KasmVNC+RPyC :8001 / VNC :3000, Debian ~4 GB amd64, persistent `/config` — MEDIUM/HIGH (maintained OSS)
- https://www.mql5.com/en/docs/python_metatrader5 — official API index (account_info, history_deals_get, history_orders_get, positions_get, copy_rates_*) — HIGH
- https://www.metatrader5.com/en/terminal/help/startworking/authorization — master vs **investor** (read-only) password semantics — HIGH
- https://www.mql5.com/en/forum/478406 + /438447 + /463221 — one-active-account-per-terminal, portable-mode multi-instance, ~24–28 stable/32 cap — MEDIUM (community, corroborated by docs)
- https://www.quantvps.com/blog/how-to-open-multiple-mt5-terminals-on-same-vps — portable multi-terminal ops — MEDIUM

---
*Stack research for: self-hosted headless MT5 read-path (forex/CFD `api_verified` sync)*
*Researched: 2026-07-23*
