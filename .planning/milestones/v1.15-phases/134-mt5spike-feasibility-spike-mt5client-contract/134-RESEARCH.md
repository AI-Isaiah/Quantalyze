# Phase 134: MT5SPIKE — Feasibility spike + `Mt5Client` contract - Research

**Researched:** 2026-07-23
**Domain:** Worker-side network-client contract for a self-hosted headless MT5 terminal (`mt5linux` over RPyC) + an offline contract test suite + a live-broker feasibility spike harness
**Confidence:** HIGH on the `mt5linux`/RPyC client mechanics (source read from the 1.0.3 wheel), the sFOX/deribit mirror patterns (read from shipped code), and the offline-test strategy; MEDIUM on the exact `order_check` investor-vs-master retcode and unattended-Wine-login reliability (these are precisely the live unknowns the spike defers to `human_needed`).

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Mt5Client contract (MT5GW-02)**
- **Transport:** pure network client via `mt5linux` (`MetaTrader5(host, port)` over RPyC). The worker NEVER imports the Windows-only `MetaTrader5` package in-process — the thin client wraps the RPyC proxy behind a narrow, typed interface. Same isolation posture as SfoxClient owning its aiohttp session.
- **Surface (read-only by construction):** `login(account, password, server)`, `account_info()`, `history_deals_get(from_ts, to_ts)`, and `order_check(...)` exposed ONLY for the investor-vs-master validate probe. There is NO `order_send` on the contract — read-only is a STRUCTURAL property (mirrors the sFOX 119 A1 posture), never a probed scope claim.
- **Return discipline (fail-loud, no invented data):** every read distinguishes `None` (RPyC/terminal error → raise typed `Mt5ClientError` carrying the `last_error()` (code, text)) from `()` (honest empty result). Non-dict/degenerate shapes raise. Mirrors `SfoxApiError`.
- **Timeout-bounded:** every call is wrapped with a transport timeout well under the worker healthz budget (mirror `SFOX_REQUEST_TIMEOUT_S`≈30s; env-overridable). The RPyC 60s pipe timeout is the known ceiling and is documented as such. A hung terminal must fail loud fast, never wedge the sequential worker loop (the v1.11 WEDGE-01 failure class).
- **Materialization:** RPyC returns netref proxies; the contract materializes `account_info` and each deal to native Python dicts/JSON before returning, so callers never hold live proxies.
- **Secret hygiene:** login/investor password/server never appear in any exception message or log; response/error text scrubbed via `services.redact.scrub_freeform_string` (T-118-01 pattern).

**Offline contract test suite (MT5GW-02, load-bearing CI gate)**
- An in-memory RPyC-shaped double (no live terminal, no network, no Windows import) drives the contract: login success + auth-fail, `account_info` shape, `history_deals_get` returning `None` (→ typed raise) vs `()` (honest empty) vs a populated deal tuple, and the `order_check` investor-vs-master distinction. Green in CI so 135/136 can stub against a proven contract shape.

**Spike harness + go/no-go (MT5SPIKE-01 — live legs are human_needed)**
- A standalone `scripts/mt5_spike.py` the founder runs against a demo account, emitting a structured go/no-go report over the four unknowns: (1) unattended Wine auto-login reliability (repeated unattended login→read cycles, no human dialog-dismissal), (2) `order_check`-based investor-vs-master read-only proof WITHOUT ever calling `order_send`, (3) `history_deals_get` deal-reconstruction viability (realized profit/swap/commission/fee + `DEAL_TYPE_BALANCE` external flows; None-vs-() honesty), (4) broker-server-time-vs-UTC offset.
- **Escape hatch recorded, never papered over:** if unattended Wine login is no-go, the native-Windows-VPS fallback (identical adapter code behind the same `Mt5Client` contract) is documented as the escape hatch in the go/no-go doc.
- **Time normalization:** establish the broker-server-time vs UTC offset and document a normalization approach so deal day-bucketing lands on the correct calendar day (reuses the UTC-day-bucketing precedent from Deribit/sFOX ledger reconstruction).

**Annualization (locked upstream, restated for continuity)**
- MT5 stays on the shared traditional √252 basis (`DEFAULT_PERIODS_PER_YEAR = 252`, comparability-over-per-asset-divergence, user decision 2026-06-24). No per-asset divergence here — this phase does not touch metrics.

### Claude's Discretion
All of the above are engineering-discretion calls grounded in the SfoxClient/IngestionAdapter conventions and the ROADMAP success criteria. No user-preference grey areas required a decision.

### Deferred Ideas (OUT OF SCOPE)
- Actual live-broker feasibility proofs (the four MT5SPIKE-01 unknowns) — `human_needed`, blocked on founder demo credentials + a running gateway container. Harness + runbook land now.
- Prod gateway hosting decision (Fly vs Railway vs VPS) — Phase 139.
- `mt5` Source registration, key routes, constraint migration — Phase 135.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| **MT5GW-02** | Worker reads MT5 as a pure network client via `mt5linux` (`MetaTrader5(host, port)`), timeout-bounded, never importing the Windows-only pkg in-process; a thin contract (`login` → `account_info` + `history_deals_get` → JSON) with an OFFLINE contract test suite green in CI, so 135/136 stub against it. | Verified `mt5linux==1.0.3` client mechanics from the wheel source (constructor, `sync_request_timeout`, `conn.eval` interpolation, netref returns). Contract shape + offline-double strategy specified below (Architecture Patterns, Code Examples). Mirror templates read from shipped `sfox_client.py` / `ingestion/sfox.py`. |
| **MT5SPIKE-01** | Feasibility spike resolving four unknowns against a real broker demo/investor account: (1) unattended Wine auto-login reliability, (2) `order_check` investor-vs-master read-only proof (no `order_send`), (3) `history_deals_get` deal-reconstruction viability (`None` vs `()`; profit/swap/commission/fee + `DEAL_TYPE_BALANCE`), (4) server-time-vs-UTC offset. Documented go/no-go; native-Windows-VPS fallback if no-go. | Harness structure + go/no-go doc template + time-normalization approach are fully plannable now (below). The four LIVE proof legs are `human_needed` — see Open Questions; they cannot execute in this autonomous run (no founder demo creds, no running gateway). |
</phase_requirements>

## Summary

Phase 134 is the v1.15 go/no-go gate with two separable deliverables, and the good news is that the **buildable half is fully plannable today** because the milestone-level research (`.planning/research/STACK|ARCHITECTURE|PITFALLS.md`, all 2026-07-23) already resolved the stack and I have now read the actual `mt5linux==1.0.3` wheel source to pin the exact client mechanics.

The `Mt5Client` contract is a **narrow, synchronous, read-only facade over a `mt5linux.MetaTrader5(host, port)` RPyC proxy**. Three mechanics of `mt5linux` drive every design decision and were confirmed from source: (1) the client connects via `rpyc.classic.connect(host, port)` and sets `conn._config["sync_request_timeout"] = timeout` (constructor default 300s) — this is the transport timeout knob; (2) every method string-interpolates its args into remote Python and calls `conn.eval(code)` (e.g. `f"mt5.account_info(*{args},**{kwargs})"`), so return values come back as **RPyC netref proxies** for namedtuples/tuples and MUST be materialized to native dicts before returning; (3) the underlying client exposes the FULL MT5 surface **including `order_send` and `order_check`** — so read-only is NOT automatic. `Mt5Client` must be a *narrowing* facade that composes ONLY the read methods plus `order_check` (probe-only), never wrapping `order_send`. This is the exact structural-read-only posture `SfoxClient` enforces by hardcoding the HTTP verb to GET.

The offline contract test suite is buildable with zero live dependencies: inject a fake RPyC-shaped connection double into `Mt5Client` and assert the contract — login success/auth-fail, `account_info` materialization, the load-bearing `None`(error→raise) vs `()`(honest empty) vs populated-tuple distinction on `history_deals_get`, and the `order_check` investor-vs-master branch. The spike harness (`scripts/mt5_spike.py`) and the go/no-go doc template also land now; the four LIVE proof legs are recorded as `human_needed` verification (they need founder demo credentials + a running gmag11 v2.3 container, neither available in this run).

**Primary recommendation:** Build `Mt5Client` as a synchronous narrowing facade over `mt5linux.MetaTrader5` with an injectable connection factory (`_connect`) for offline testing; enforce read-only structurally (compose read methods + `order_check` only, never `order_send`); enforce the `None`≠`()` fail-loud discipline and netref→native materialization at every read; write the offline contract suite against an injected RPyC-shaped double; land the spike harness + go/no-go template with the four live legs modeled as `human_needed`.

> **⚠️ Surfaced conflict (CLAUDE.md Rule 7 — pick one, don't average):** the milestone `ARCHITECTURE.md` (2026-07-23) floated TWO transports and *preferred* an HTTP/FastAPI shim with `Mt5Client` as an **async aiohttp** client. The phase `CONTEXT.md` (also 2026-07-23, more specific + downstream) **locked the `mt5linux` RPyC transport** instead. This research follows the locked CONTEXT decision: `Mt5Client` wraps an RPyC proxy and is therefore **synchronous** (rpyc classic is blocking), NOT an async aiohttp client. The event-loop protection (`asyncio.to_thread` + `asyncio.wait_for`) lives at the Phase 136/137 worker derive seam, not inside this client. Any planner/reviewer reading the ARCHITECTURE.md HTTP-shim sketch should treat it as superseded for the client transport. (The gateway hosting question — Phase 139 — is unaffected; the gateway still runs the gmag11 Wine container, it just speaks RPyC not HTTP.)

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| MT5 terminal session + broker connection | MT5 gateway (Wine container, out-of-process) | — | Windows-only `MetaTrader5` pkg + `terminal64.exe` cannot run in the Linux worker; isolated behind RPyC |
| Worker-side read client (`Mt5Client`) | Python worker (`analytics-service`) | — | Narrow read-only facade; owns the RPyC connection lifecycle + timeout + materialization + secret scrub |
| Read-only enforcement (structural) | `Mt5Client` (facade composition) | validate branch (Phase 135) | No `order_send` wrapped; `order_check` probe-only. Investor password is the server-side guarantee; the facade is the structural one |
| Netref→native materialization | `Mt5Client` | — | Callers must never hold live RPyC proxies (CONTEXT lock) |
| Fail-loud `None`≠`()` discipline | `Mt5Client` | reconstruction (Phase 136) | An error read must never fabricate a flat/empty account |
| Deal-ledger → daily NAV reconstruction | `combine_mt5_deal_ledger` (Phase 136) | — | OUT OF SCOPE for 134; the contract just returns materialized deal dicts |
| Server-time→UTC normalization | spike (establish offset, 134) + `combine_mt5_deal_ledger` (apply, 136) | — | 134 establishes + documents the approach; 136 owns the single normalize seam |
| Offline contract test double | CI test suite (`tests/`) | — | In-memory RPyC-shaped fake; no live terminal, no Windows import |
| Live feasibility proofs (4 unknowns) | founder (`human_needed`) | spike harness (`scripts/mt5_spike.py`) | Needs demo creds + running gateway; harness lands now, proofs deferred |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `mt5linux` | 1.0.3 (2026-02-20) | The worker's network client: `from mt5linux import MetaTrader5; mt5 = MetaTrader5(host, port)`. Wraps the whole MT5 Python API over RPyC. | Only maintained package (Feb 2026) that lets a Linux process call the full MT5 API as a remote client with no Windows wheel. `[CITED: milestone STACK.md, /lucas-campagna/mt5linux Context7]` + source read this session. |
| `rpyc` | 5.2.3 (pinned by `mt5linux==1.0.3`) | Transport between worker and the Wine container | Transitive; the client uses `rpyc.classic.connect` (SlaveService). `[VERIFIED: PyPI requires_dist of mt5linux 1.0.3]` |

### Supporting (already present in `analytics-service`)
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `services.redact.scrub_freeform_string` | in-repo | Secret scrubbing of error/response text before it reaches any log/exception surface | Every `Mt5ClientError` construction (T-118-01 pattern) |
| `pytest` | in-repo | Offline contract test suite driver | The load-bearing CI gate |

### Infrastructure target (NOT installed by the worker; Phase 139 provisions)
| Component | Version | Purpose | Notes |
|-----------|---------|---------|-------|
| `gmag11/MetaTrader5-Docker` (`metatrader5_vnc`) | v2.3 (2025-12) | Linux container: Wine + Windows-Python + MT5 terminal + RPyC bridge + KasmVNC (:3000 one-time install/login) | amd64-only, ~4 GB, persistent `/config` volume. RPyC default port 18812 (constructor default); the image commonly maps 8001 — **verify the actual port at provisioning** (Phase 139). `[CITED: github.com/gmag11/MetaTrader5-Docker]` |
| `MetaTrader5` (official) | 5.0.5735 | Runs INSIDE the container's Windows-Python-under-Wine, never on the worker | `mt5linux` proxies to it. `[CITED: pypi.org/project/MetaTrader5]` |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `mt5linux` RPyC (LOCKED) | HTTP/FastAPI shim (`Mt5Client` = aiohttp async) — the milestone ARCHITECTURE.md's *preferred* option | Rejected by CONTEXT lock. Would give an async client structurally identical to SfoxClient + a narrower non-RCE attack surface, but requires hand-writing + hosting a shim; RPyC is batteries-included in gmag11 v2.3. See Surfaced Conflict above. |
| Wine container on Fly/Railway | Native Windows VPS running the official wheel + RPyC shim | The escape hatch if unattended Wine login proves no-go (MT5SPIKE-01 leg 1). Same `Mt5Client` contract; only the host swaps. |

**Installation (worker side only):**
```bash
pip install mt5linux==1.0.3        # brings rpyc==5.2.3, plumbum==1.7.0, pyparsing, numpy
# DO NOT: pip install MetaTrader5   # Windows-only wheel → unusable/uninstallable on the Linux worker
```

**Version verification (this session):** `mt5linux` latest = 1.0.3 confirmed on PyPI; version history 0.1.0 (2022) → 1.0.3 (2026-02-20); `requires_dist = numpy, plumbum==1.7.0, pyparsing<4,>=3.1.0, rpyc==5.2.3`. Wheel is pure-Python (`py3-none-any`), 4 modules, **no setup/postinstall scripts** (inspected). `[VERIFIED: pypi.org/pypi/mt5linux/json + wheel inspection]`

## Package Legitimacy Audit

> slopcheck could not be installed/run in this session (no network for the installer). Per the graceful-degradation rule, the packages below are tagged `[ASSUMED]` and the planner MUST gate the `pip install mt5linux==1.0.3` step behind a `checkpoint:human-verify` task. This is stricter than baseline, never a hard failure.

| Package | Registry | Age | Downloads | Source Repo | slopcheck | Disposition |
|---------|----------|-----|-----------|-------------|-----------|-------------|
| `mt5linux` | PyPI | ~4 yrs (0.1.0 2022 → 1.0.3 Feb 2026) | Low (niche, single-maintainer) | github.com/lucas-campagna/mt5linux | unavailable | **Approved but human-verify.** Real, actively-versioned, source read this session (pure-Python, no postinstall). Single-maintainer + low downloads = keep the checkpoint. `[ASSUMED]` |
| `rpyc` | PyPI | ~15 yrs | Very high | github.com/tomerfiliba-org/rpyc | unavailable | **Approved.** Mainstream, ancient, well-known. Transitive pin `==5.2.3`. `[ASSUMED]` pending slopcheck but effectively `[OK]` |

**Packages removed due to slopcheck [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none by slopcheck (tool unavailable); `mt5linux` self-flagged as single-maintainer/low-download — planner inserts one `checkpoint:human-verify` before its install.

**Security note beyond legitimacy:** `mt5linux` uses `rpyc.classic.connect` = **RPyC SlaveService**, a full arbitrary-remote-code channel with NO auth by default (the client literally runs `conn.execute("import MetaTrader5 as mt5")` and `conn.eval(<interpolated code>)`). This is a transport/deployment security concern, not a supply-chain one — see Security Domain.

## Architecture Patterns

### System Architecture Diagram (Phase 134 scope)

```
   OFFLINE (CI, this phase) ──────────────────────────────────────────────┐
                                                                           │
   pytest ──▶ Mt5Client(_connect=fake_rpyc_double) ──▶ FakeConn.eval(code) │
                   │                                        │              │
                   │  materialize netref→dict               │  canned:     │
                   │  None≠() fail-loud                      │  login T/F   │
                   ▼                                         │  account_info│
              assert contract                                │  deals None/ │
              (login/account_info/deals/order_check)          │  ()/populated│
                                                             │  order_check │
                                                             └──────────────┘

   LIVE (human_needed, founder runs later) ───────────────────────────────┐
                                                                           │
   scripts/mt5_spike.py ──RPyC──▶ gmag11 v2.3 container ──Wine IPC──▶ MT5  │
        │  repeated login→read cycles          (RPyC :18812/:8001)  terminal│
        │  order_check investor-vs-master                                   │
        │  history_deals_get None vs () vs deals                            │
        │  server-time vs UTC offset                                        │
        ▼                                                                   │
   go/no-go report (4 unknowns; escape hatch if login no-go) ──────────────┘
```

### Recommended Project Structure (files this phase creates/touches)
```
analytics-service/
├── services/
│   └── mt5_client.py            # NEW — Mt5Client + Mt5ClientError (narrowing RPyC facade)
├── scripts/
│   └── mt5_spike.py             # NEW — standalone live feasibility harness (human_needed to run)
└── tests/
    └── test_mt5_client_contract.py   # NEW — offline contract suite (load-bearing CI gate)
.planning/phases/134-.../
└── MT5_GONOGO.md (or similar)   # NEW — go/no-go doc TEMPLATE (founder fills live results)
```
> `services/mt5_factory.py`, `services/ingestion/mt5.py`, Source-lockstep edits, and `combine_mt5_deal_ledger` are **Phase 135/136**, not 134. Keep 134 to the contract + tests + spike + doc.

### Pattern 1: `Mt5Client` as a synchronous narrowing facade over the RPyC proxy
**What:** A thin class owning a `mt5linux.MetaTrader5` instance, exposing only read methods + `order_check`, with an injectable `_connect` for tests.
**When to use:** The whole contract. Mirror `SfoxClient`'s posture (owns transport, single fail-loud chokepoint, secret scrub, bounded lifecycle) — but synchronous, because rpyc classic is blocking.
**Key divergences from `SfoxClient`:**
- **Synchronous, not async.** No `aiohttp`, no `await`. The `asyncio.to_thread`/`asyncio.wait_for` bound is a Phase 136/137 worker-seam concern, not part of this client's API.
- **Timeout is set via the constructor** (`sync_request_timeout` on the rpyc config) not per-request, plus MT5's own `login(timeout=<ms>)` IPC ceiling. Document BOTH (see Pitfall 3).
- **Structural read-only = facade composition**, since the underlying `mt5linux` client DOES expose `order_send`/`orders_get`/`positions_get`/etc. `Mt5Client` simply never wraps `order_send` (and an ingestion-boundary `isinstance(client, Mt5Client)` guard, Phase 135, prevents smuggling a raw proxy through).

### Pattern 2: `None` (error) vs `()` (honest empty) at every read
**What:** After each `conn.eval`-backed call, `if result is None: raise Mt5ClientError(*self._last_error())`; an empty tuple/list is returned as an honest empty result; a populated result is materialized to native dicts.
**When to use:** `account_info` (None→raise), `history_deals_get` (None→raise, ()→empty, populated→materialize), `order_check` (None→raise).
**Why:** Conflating error with empty fabricates a flat account — the #1 MT5 pitfall and a `no-invented-data` violation. Mirrors `SfoxApiError` fail-loud.

### Pattern 3: Netref→native materialization
**What:** `account_info()` returns an `AccountInfo` namedtuple and `history_deals_get()` a tuple of `TradeDeal` namedtuples; over rpyc these arrive as **netref proxies** (namedtuples subclass `tuple` and are not brine-serialized by value). Call `._asdict()` and coerce to a plain `dict` (and `float()`/`int()`/`str()` the load-bearing fields) before returning; never return the proxy.
**When to use:** every read that returns a structured MT5 object.
**Note:** `last_error()` returns `(int code, str description)` — a tuple of brinable immutables — so it DOES come back by value; safe to use directly (still scrub the description).

### Pattern 4: Offline RPyC-shaped double via injectable `_connect`
**What:** `Mt5Client(host, port, *, _connect=rpyc_connect_fn)`; tests pass a fake `_connect` returning a fake connection whose `.eval(code)` / `.execute(code)` / `._config` behave like rpyc but return canned, netref-shaped doubles.
**When to use:** the entire offline contract suite — no live terminal, no network, no `MetaTrader5` import.
**Why:** the CI gate MUST be green with zero live dependencies so 135/136 stub against a proven shape.

### Anti-Patterns to Avoid
- **Wrapping `order_send` "just in case":** breaks structural read-only. Compose read methods + `order_check` only.
- **`if not deals:` truthiness check:** conflates `None` (error) with `()` (empty). Use `is None`.
- **Returning the raw netref:** callers would hold a live proxy that dies with the connection and leaks the transport. Materialize.
- **Async `aiohttp` client:** that was the superseded ARCHITECTURE.md HTTP-shim design; CONTEXT locked RPyC (sync).
- **Putting server-time→UTC conversion in the client:** 134 only *establishes and documents* the offset; the single normalize seam is Phase 136 (`combine_mt5_deal_ledger`). The client returns raw `time`/`time_msc` (server-time epoch) verbatim.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| RPyC transport + timeout | A raw socket protocol to the terminal | `mt5linux.MetaTrader5` (owns `rpyc.classic.connect` + `sync_request_timeout`) | It's the sanctioned bridge; matches the official API method-for-method |
| Fail-loud client posture | A new error/retry model | Clone `SfoxClient`/`SfoxApiError` posture (single chokepoint, secret scrub, bounded close) | Shipped, red-teamed, reviewer-legible ("sFOX adapter over RPyC") |
| Secret scrubbing | A bespoke redactor | `services.redact.scrub_freeform_string` | T-118-01 pattern; already handles URL-userinfo/JWT/bearer shapes |
| Deal-ledger → NAV | Any reconstruction in the client | `combine_mt5_deal_ledger` mirroring `combine_native_ledger` (Phase 136) | 134's client just returns materialized deal dicts; reconstruction is fail-loud money-math for a later phase |
| External-flow classification | A new flow model | `services/external_flows.py` `ExternalFlow`/`USD_FAMILY` (Phase 136) | `DEAL_TYPE_BALANCE` deals feed the existing flow-aware TWR |

**Key insight:** ~95% of the milestone is a verbatim sFOX-seam clone; Phase 134's only genuinely new surface is the RPyC-transport client and its offline double. Everything downstream reuses the ONE backbone unchanged.

## Common Pitfalls

### Pitfall 1: `None` vs `()` conflated → fabricated flat account (highest correctness severity for this phase)
**What goes wrong:** `history_deals_get` / `account_info` / `login` signal failure by returning `None`/`False`; `history_deals_get` returns `()` for an honest-empty window. A truthiness check treats an error as "zero deals" and stamps a flat/empty account.
**Why it happens:** cloud-API mental models (exceptions/HTTP codes) ported onto an API whose only error channel is `last_error()`, which must be read *immediately* (the next call overwrites it).
**How to avoid:** in `Mt5Client`, every falsy/`None` return → capture `last_error()` FIRST, then raise `Mt5ClientError(code, scrub(text))`; `()`/empty → honest empty result; populated → materialize. This is the load-bearing offline-test assertion.
**Warning signs:** `if not deals:`; no `last_error()` call in the client; suspiciously flat equity.

### Pitfall 2: Structural read-only not enforced (the underlying client exposes `order_send`)
**What goes wrong:** `mt5linux.MetaTrader5` exposes `order_send`, `order_check`, `positions_get`, `orders_get`, etc. If `Mt5Client` inherits/forwards these, a caller can trade through the read session — a trust-integrity violation for the whole `api_verified` value prop.
**Why it happens:** the facade "conveniently" proxies unknown attributes, or wraps the full surface.
**How to avoid:** compose ONLY `login`, `account_info`, `history_deals_get`, `order_check` (probe), `shutdown`. NO `__getattr__` passthrough. NO `order_send` wrapper. Add the ingestion-boundary `isinstance` guard in Phase 135. Read-only is also server-enforced by the investor password (Guest Mode), but the facade is the structural guarantee.
**Warning signs:** an `order_*` symbol (other than `order_check`) anywhere in `mt5_client.py`; a generic attribute-forwarding facade.

### Pitfall 3: Two timeouts, and getting their ordering wrong
**What goes wrong:** there are TWO independent timeouts and they interact:
- **rpyc `sync_request_timeout`** — set via the `mt5linux` constructor `timeout=` (default 300s); how long the worker waits for a remote round-trip before rpyc raises.
- **MT5 IPC pipe timeout** — `initialize(timeout=<ms>)` / `login(timeout=<ms>)`, default 60000ms (the "Pipe server didn't answer in 60 sec" ceiling), enforced inside the container.
If the rpyc timeout is *shorter* than the MT5 login IPC timeout, rpyc aborts mid-handshake; if the rpyc timeout is left at 300s, a hung terminal blocks the calling thread for 5 minutes — far past the ~90s healthz budget.
**How to avoid:** set the rpyc `sync_request_timeout` to ~30s (env-overridable, mirror `SFOX_REQUEST_TIMEOUT_S`) AND pass an explicit MT5 `login(timeout=<ms>)` strictly *below* it (e.g. 20000ms), so MT5 fails its own pipe first and rpyc surfaces a clean error rather than a raw abort. Document both in the client. The outer `asyncio.to_thread`+`asyncio.wait_for` bound (Phase 136/137) is what actually protects the event loop — this client is synchronous and blocking by nature.
**Warning signs:** login "randomly" times out at 300s; healthz latency spikes correlated with an MT5 read.

### Pitfall 4: `order_check` may NOT cleanly distinguish investor vs master (this is a live unknown, not a solved fact)
**What goes wrong:** the plan assumes `order_check` returns a distinct retcode on an investor (read-only) login vs a master login. But `order_check` primarily validates *margin/funds*, not trade *permission* — on some brokers it may return `retcode=0` (done) even for an investor login, and the read-only refusal only surfaces at `order_send` (retcode 10027, which we must NEVER call). The reliable read-only signals may instead be `account_info().trade_allowed == False` and/or a specific `order_check` retcode — this varies by broker and is exactly MT5SPIKE-01 leg 2.
**How to avoid:** design the probe to inspect BOTH `order_check(...).retcode`/`.comment` AND `account_info().trade_allowed`, and treat the *combination* as the investor-vs-master signal; the spike harness records the actual observed retcodes per broker so Phase 135 can encode the real rule. Mark the exact retcode `[ASSUMED]` until the live leg runs. NEVER call `order_send` to "just check."
**Warning signs:** a hard-coded "retcode==X means investor" with no live evidence; any `order_send` call.

### Pitfall 5: Server-time vs UTC (establish in 134, apply in 136)
**What goes wrong:** `history_deals_get(from, to)` request datetimes are interpreted as **UTC**, but returned `time`/`time_msc` are **broker server-time epoch** (commonly UTC+2/+3, DST-shifting). Mixing them offsets the query window and buckets deals into the wrong calendar day.
**How to avoid (this phase):** the spike establishes the offset empirically (compare a deal's returned `time` against a known UTC reference, or read it from `symbol_info_tick`/terminal), records it per broker in the go/no-go doc, and documents the normalize-to-UTC-before-bucketing approach (reusing the Deribit/sFOX UTC-day-bucketing precedent). The client itself returns raw server-time epochs verbatim — the single conversion seam is Phase 136.
**Warning signs:** deals near midnight landing a day early/late; day-count off-by-one vs the broker statement.

### Pitfall 6: Unattended Wine auto-login flakiness (the core go/no-go, live)
**What goes wrong:** community reports repeatedly note "manual login works, automated login fails" — a timing/IPC race the terminal hides behind a GUI. A cold terminal, a first-run dialog, or a Wine/Xvfb hiccup makes `initialize()`/`login()` hang or return `False`.
**How to avoid (this phase):** the harness exercises *repeated unattended login→read cycles* (no human dialog-dismissal) and records the success rate → the go/no-go determination. If no-go, the native-Windows-VPS fallback (identical `Mt5Client` contract) is the documented escape hatch. This leg is `human_needed`.
**Warning signs:** login works via interactive VNC/ssh but fails on the automated path; intermittent 60s IPC timeouts.

## Code Examples

### The `mt5linux==1.0.3` client mechanics (verified from wheel source this session)
```python
# Source: mt5linux/metatrader5.py (mt5linux-1.0.3-py3-none-any.whl, read 2026-07-23)
class MetaTrader5(object):
    def __init__(self, host="localhost", port=18812, timeout=300):
        self.__conn = rpyc.classic.connect(host, port)      # SlaveService (RCE channel, no auth)
        self.__conn._config["sync_request_timeout"] = timeout  # <-- the transport timeout knob
        self.__conn.execute("import MetaTrader5 as mt5")     # remote import
        self.__conn.execute("import datetime")

    def account_info(self, *args, **kwargs):
        code = f"mt5.account_info(*{args},**{kwargs})"        # args interpolated into remote code
        return self.__conn.eval(code)                        # returns a NETREF proxy for namedtuples

    def history_deals_get(self, *args, **kwargs):
        code = f"mt5.history_deals_get(*{args},**{kwargs})"
        response = self.__conn.eval(code)                    # None (error) | () (empty) | netref tuple
        # ... (1.0.3 does some conversion; treat the return as possibly-netref and materialize)

    def last_error(self, *args, **kwargs):
        code = f"mt5.last_error(*{args},**{kwargs})"
        return self.__conn.eval(code)                        # (int, str) — by value, safe
# Methods present include order_send + order_check (full surface) — DO NOT wrap order_send.
```

### `Mt5Client` contract sketch (Phase 134 target — synchronous, narrowing, fail-loud)
```python
# services/mt5_client.py  (sketch; mirrors SfoxClient posture over RPyC)
import os
from typing import Any, Callable
from services.redact import scrub_freeform_string

MT5_REQUEST_TIMEOUT_S = float(os.getenv("MT5_REQUEST_TIMEOUT_S", "30"))   # rpyc sync_request_timeout
MT5_LOGIN_TIMEOUT_MS  = int(os.getenv("MT5_LOGIN_TIMEOUT_MS", "20000"))   # MT5 IPC ceiling < rpyc

class Mt5ClientError(RuntimeError):
    """Fail-loud typed error carrying MT5 (code, text). Secrets NEVER in the message."""
    def __init__(self, code: int, detail: str) -> None:
        self.code = code
        super().__init__(f"MT5 client error (code={code}): {scrub_freeform_string(detail)}")

class Mt5Client:
    """Read-only narrowing facade over mt5linux.MetaTrader5 (RPyC). Synchronous by construction.
    Composes ONLY read methods + order_check (probe). NO order_send — read-only is STRUCTURAL."""
    def __init__(self, host: str, port: int, *, _connect: Callable[..., Any] | None = None,
                 request_timeout_s: float = MT5_REQUEST_TIMEOUT_S) -> None:
        connect = _connect or _default_connect          # injectable for offline tests
        self._mt5 = connect(host=host, port=port, timeout=request_timeout_s)
        self._closed = False

    def _raise_last(self) -> None:                       # capture last_error() IMMEDIATELY
        err = self._mt5.last_error()
        code, text = (err[0], err[1]) if err else (0, "unknown")
        raise Mt5ClientError(int(code), str(text))

    def login(self, login: int, password: str, server: str) -> None:
        ok = self._mt5.login(login, password=password, server=server, timeout=MT5_LOGIN_TIMEOUT_MS)
        if not ok:
            self._raise_last()                           # bad creds / wrong server → typed raise

    def account_info(self) -> dict:
        info = self._mt5.account_info()
        if info is None:
            self._raise_last()
        return _materialize(info)                        # netref namedtuple -> native dict

    def history_deals_get(self, from_ts, to_ts) -> list[dict]:
        deals = self._mt5.history_deals_get(from_ts, to_ts)
        if deals is None:                                # ERROR (never () — that's honest empty)
            self._raise_last()
        return [_materialize(d) for d in deals]          # () -> [] honest empty; else materialize

    def order_check(self, request: dict) -> dict:        # PROBE ONLY (investor-vs-master); no send
        res = self._mt5.order_check(request)
        if res is None:
            self._raise_last()
        return _materialize(res)

    def close(self) -> None:                             # bounded/idempotent (mirror aclose)
        if self._closed:
            return
        self._closed = True
        try:
            self._mt5.shutdown()
        except Exception:
            pass                                         # a close error must not mask caller errors

def _materialize(obj: Any) -> dict:
    """netref namedtuple/dict -> native dict. Fail loud on a degenerate shape."""
    if hasattr(obj, "_asdict"):
        return {str(k): _coerce(v) for k, v in obj._asdict().items()}
    raise Mt5ClientError(0, "MT5 returned a non-namedtuple/degenerate shape")
```

### Offline contract test double (Phase 134 CI gate — no live terminal)
```python
# tests/test_mt5_client_contract.py  (sketch)
class _FakeNamedTuple:
    def __init__(self, **fields): self._f = fields
    def _asdict(self): return dict(self._f)              # emulate a netref namedtuple

class _FakeConn:
    def __init__(self, scenario): self._s = scenario; self._config = {}
    def execute(self, code): pass
    # driven by the scenario the test wants (login ok/fail, deals None/()/populated, retcodes)

def _connect_factory(scenario):
    def _connect(host, port, timeout): return _FakeMt5(scenario)
    return _connect

def test_history_deals_none_is_error_not_empty():
    c = Mt5Client("h", 1, _connect=_connect_factory({"deals": None, "last_error": (1, "IPC fail")}))
    with pytest.raises(Mt5ClientError):                  # None => raise (NEVER a flat account)
        c.history_deals_get(0, 1)

def test_history_deals_empty_is_honest_empty():
    c = Mt5Client("h", 1, _connect=_connect_factory({"deals": ()}))
    assert c.history_deals_get(0, 1) == []               # () => honest empty

def test_account_info_materialized_to_native_dict():
    c = Mt5Client("h", 1, _connect=_connect_factory(
        {"account": _FakeNamedTuple(login=123, equity=1000.0, currency="USD", trade_allowed=False)}))
    info = c.account_info()
    assert isinstance(info, dict) and info["equity"] == 1000.0   # not a proxy

def test_login_failure_raises_typed_error_no_secret():
    c = Mt5Client("h", 1, _connect=_connect_factory({"login": False, "last_error": (134, "no money")}))
    with pytest.raises(Mt5ClientError) as e:
        c.login(123, password="s3cr3t", server="Broker-Demo")
    assert "s3cr3t" not in str(e.value)                  # secret hygiene

def test_no_order_send_surface():
    assert not hasattr(Mt5Client, "order_send")          # structural read-only
```

### Spike harness + go/no-go doc structure (Phase 134 lands; live legs human_needed)
```python
# scripts/mt5_spike.py  (standalone; founder runs against a demo/investor account)
#   emits structured JSON/markdown over the FOUR unknowns:
#   1. unattended_login: N repeated login->read cycles, no human dialog -> success_rate, go/no-go
#   2. read_only_proof:  order_check(...).retcode + comment + account_info().trade_allowed
#                        (NEVER order_send) -> investor-vs-master signal, per-broker
#   3. deal_reconstruction: history_deals_get over a window -> None vs () vs populated;
#                        presence of profit/swap/commission/fee + DEAL_TYPE_BALANCE rows
#   4. server_time_offset: compare a deal 'time' epoch vs known UTC -> offset (+DST note)
#   Prints an explicit GO / NO-GO verdict per leg; if leg 1 = NO-GO, prints the
#   native-Windows-VPS escape-hatch note (identical Mt5Client contract).
```
Go/no-go doc template sections: **Environment** (broker, server string, container image + port, image build/pin) · **Leg 1 unattended login** (cycles run, success rate, verdict, escape-hatch trigger) · **Leg 2 read-only proof** (observed `order_check` retcode/comment, `trade_allowed`, verdict) · **Leg 3 deal reconstruction** (deal count, fields present, None-vs-() behavior observed, history depth) · **Leg 4 server-time offset** (measured offset, DST note, normalization approach) · **Overall verdict + fallback decision**.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Legacy MT5 Expert Advisor pushing daily returns (`self_reported`, fabricatable) | Live read-only investor-login sync via self-hosted terminal → `api_verified` | v1.15 (this milestone) | The whole reason for the milestone; 134 is its first gate |
| Run `MetaTrader5` in-process | Out-of-process Wine gateway + `mt5linux` RPyC client | 2026-07-23 (founder-locked) | Windows dep stays out of the Linux worker |
| `mt5linux` 0.1.x (2022) / `mt5-server` / `pymt5` forks | `mt5linux==1.0.3` (Feb 2026) | 2026 | Maintained; same method names/shapes as official pkg |

**Deprecated/outdated:**
- `pip install MetaTrader5` on the Linux worker: Windows-only wheel, no Linux dist — resolves to nothing installable.
- MetaApi.cloud / broker Manager API: founder-rejected 2026-07-23 (trust/lock-in/wrong permission model).

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `order_check().retcode` (combined with `account_info().trade_allowed`) reliably distinguishes an investor (read-only) login from a master login WITHOUT `order_send` | Pitfall 4, MT5SPIKE-01 leg 2 | Read-only proof mechanism must change; Phase 135 validate branch depends on the real signal. Resolved by the live spike. |
| A2 | Unattended Wine auto-login is reliable enough (gmag11 v2.3) for a cron worker | Pitfall 6, MT5SPIKE-01 leg 1 | If no-go, milestone pivots to the native-Windows-VPS escape hatch (same contract). Core go/no-go. |
| A3 | `mt5linux==1.0.3` returns namedtuples as materializable objects exposing `._asdict()` over rpyc (netref) | Pattern 3, Code Examples | If rpyc returns a different proxy shape, `_materialize` needs `rpyc.classic.obtain()` instead. Low risk (namedtuple `_asdict` is standard); confirm against the live bridge. |
| A4 | The gmag11 v2.3 RPyC port is 18812 (constructor default) or 8001 (common image map) | Standard Stack | Wrong port = connection refused; verify at Phase 139 provisioning. Not load-bearing for offline work. |
| A5 | Broker retains enough investor-login deal history for reconstruction; a fresh login warms it promptly | MT5SPIKE-01 leg 3, Open Questions | Truncated history → honest coverage-masking in Phase 136, not a 134 blocker. |
| A6 | The RPyC 60s figure in CONTEXT is MT5's IPC pipe timeout, distinct from rpyc's 300s `sync_request_timeout` | Pitfall 3 | If conflated, the timeout config is mis-set; documented explicitly to prevent it. Verified from wheel source. |

## Open Questions

1. **Does `order_check` distinguish investor vs master, and with which exact retcode(s)?** (A1)
   - What we know: `order_check` exists and does not place an order; investor is server-side read-only; `order_send` on investor → retcode 10027.
   - What's unclear: whether `order_check` itself returns a distinct retcode, or whether we must rely on `account_info().trade_allowed`.
   - Recommendation: `human_needed` — spike harness records observed retcodes/comments/`trade_allowed` per broker; Phase 135 encodes the real rule. NEVER call `order_send`.

2. **Is unattended Wine auto-login reliable enough for a cron worker?** (A2)
   - What we know: community "manual works, automated fails" timing-race reports; gmag11 v2.3 is the maintained image.
   - What's unclear: the actual repeated-cycle success rate on a real broker demo.
   - Recommendation: `human_needed` — the core go/no-go; harness runs N repeated unattended login→read cycles; escape hatch = native Windows VPS.

3. **What is the broker's server-time→UTC offset (and DST behaviour)?** (A5-adjacent)
   - What we know: MT5 request datetimes are UTC-interpreted; returned `time` is server-time epoch (commonly UTC+2/+3).
   - What's unclear: the exact offset for the target broker; whether it DST-shifts.
   - Recommendation: `human_needed` — spike measures it empirically; 134 documents the normalize approach, 136 owns the single seam.

4. **How far back does a fresh investor login warm deal history; do target brokers cap it?** (A5)
   - Recommendation: `human_needed` — spike records history depth; Phase 136 handles truncation via honest coverage-masking + balance reconciliation.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| `mt5linux` (worker install) | `Mt5Client` transport | ✗ (not yet installed) | target 1.0.3 | none — must install (gated by human-verify checkpoint) |
| `rpyc` | transitive transport | ✗ (via mt5linux) | 5.2.3 (pinned) | none |
| Python 3 (worker) | client + tests | ✓ | project runtime | — |
| `pytest` + `services.redact` | offline contract suite | ✓ | in-repo | — |
| gmag11 v2.3 gateway container (running) | LIVE spike legs only | ✗ | v2.3 | native Windows VPS (escape hatch) |
| Founder demo/investor credentials | LIVE spike legs only | ✗ | — | none — legs are `human_needed` |

**Missing dependencies with no fallback:**
- Founder demo credentials + running gateway → the four live spike proofs are `human_needed`; they do not block the buildable half (contract + offline tests + harness + doc).

**Missing dependencies with fallback:**
- Unattended Wine login (if no-go) → native-Windows-VPS path, same `Mt5Client` contract.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | pytest (analytics-service Python suite; `--cov-fail-under=80` gate) |
| Config file | `analytics-service/` pytest config (existing) |
| Quick run command | `cd analytics-service && pytest tests/test_mt5_client_contract.py -x` |
| Full suite command | `cd analytics-service && pytest` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| MT5GW-02 | `login` failure → typed raise, no secret leak | unit | `pytest tests/test_mt5_client_contract.py -k login_failure -x` | ❌ Wave 0 |
| MT5GW-02 | `account_info` netref → native dict | unit | `pytest tests/test_mt5_client_contract.py -k account_info -x` | ❌ Wave 0 |
| MT5GW-02 | `history_deals_get` `None`→raise, `()`→[], populated→materialize | unit | `pytest tests/test_mt5_client_contract.py -k history_deals -x` | ❌ Wave 0 |
| MT5GW-02 | `order_check` investor-vs-master branch (probe only) | unit | `pytest tests/test_mt5_client_contract.py -k order_check -x` | ❌ Wave 0 |
| MT5GW-02 | structural read-only (no `order_send` surface) | unit | `pytest tests/test_mt5_client_contract.py -k no_order_send -x` | ❌ Wave 0 |
| MT5SPIKE-01 | four live proofs | manual (`human_needed`) | `python scripts/mt5_spike.py` (founder, against demo) | ❌ Wave 0 (harness) |

### Sampling Rate
- **Per task commit:** `pytest tests/test_mt5_client_contract.py -x`
- **Per wave merge:** `cd analytics-service && pytest`
- **Phase gate:** full suite green + the four live legs recorded as `human_needed` (never claimed passed) before `/gsd:verify-work`.

### Wave 0 Gaps
- [ ] `tests/test_mt5_client_contract.py` — offline contract suite (covers MT5GW-02)
- [ ] `services/mt5_client.py` — `Mt5Client` + `Mt5ClientError` (the unit under test)
- [ ] `scripts/mt5_spike.py` — live harness (MT5SPIKE-01; execution `human_needed`)
- [ ] go/no-go doc template — the founder fills live results
- [ ] Framework install: `pip install mt5linux==1.0.3` — **behind a `checkpoint:human-verify` task** (slopcheck unavailable this session)

## Security Domain

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | Investor password login; read-only server-enforced; wrong-server distinguishable from bad-password (Phase 135) |
| V3 Session Management | yes | One terminal = one active login; per-terminal serialization + login-bracket assertion (Phase 137) |
| V4 Access Control | yes | Structural read-only facade (no `order_send`); investor password only |
| V5 Input Validation | yes | Fail-loud on degenerate/non-namedtuple shapes; `None`≠`()`; no invented data |
| V6 Cryptography | yes (Phase 135) | Credentials KEK-encrypted via existing `services/encryption.py` — never hand-rolled |
| V9 Communications | **yes (134-critical)** | **RPyC SlaveService is an unauthenticated arbitrary-remote-code channel** — the bridge MUST be private-network-only |

### Known Threat Patterns for {mt5linux/RPyC + Wine gateway}
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| RPyC `classic`/SlaveService = remote code execution, no auth by default | Elevation of Privilege / Tampering | Bridge reachable ONLY over a private network (Railway internal / WireGuard / SSH tunnel); NEVER a public port. Document as a hard constraint for Phase 139. |
| Investor password interpolated into remotely-eval'd code (`f"mt5.login(*{args}...)"`) | Information Disclosure | `repr()` in the f-string escapes string args; still, keep the channel private and NEVER log the interpolated `code`. Client scrubs all error text. |
| Full-access (master) password mistakenly supplied | Elevation of Privilege | Validate-time investor-vs-master probe (A1) → reject master, never persist; structural no-`order_send` facade. |
| Secret in exception/log surface | Information Disclosure | `Mt5ClientError` scrubs via `scrub_freeform_string`; login/password/server never in any message. |
| Hung terminal wedges the sequential worker | Denial of Service | rpyc `sync_request_timeout` ~30s + MT5 login IPC timeout < it; outer `to_thread`+`wait_for` at the derive seam (Phase 136/137). |

## Sources

### Primary (HIGH confidence)
- `mt5linux==1.0.3` wheel source (`mt5linux/metatrader5.py`, `__init__.py`) — read this session: `rpyc.classic.connect`, `sync_request_timeout`, `conn.eval` interpolation, full method list incl. `order_send`/`order_check`, constructor defaults (host=localhost, port=18812, timeout=300).
- PyPI JSON `pypi.org/pypi/mt5linux/json` — version 1.0.3 (2026-02-20), `requires_dist` (rpyc==5.2.3, plumbum==1.7.0, pyparsing, numpy), version history.
- Shipped repo code (HIGH): `analytics-service/services/sfox_client.py` (fail-loud posture, timeout knob, secret scrub, bounded aclose), `services/ingestion/sfox.py` (structural read-only validate + `KEY_AUTH_FAILED`), `services/ingestion/adapter.py` (Protocol + dataclasses + `Source` Literal), `services/sfox_factory.py`, `services/sfox_read.py` (`_SFOX_CRAWL_MAX_REQUESTS`, `wait_for` seam), `services/deribit_ingest.py`/`deribit_txn.py` (`ExternalFlow`, ledger reconstruction the 136 mirror follows), `tests/test_mt5_golden_fixtures.py` (√252 basis already pinned).
- Milestone research `.planning/research/STACK.md|ARCHITECTURE.md|PITFALLS.md|SUMMARY.md` (2026-07-23, HIGH bar Wine-ops MEDIUM) — stack decision, gateway topology, 14-pitfall catalogue.
- `.planning/REQUIREMENTS.md`, `ROADMAP.md`, `STATE.md`, phase `134-CONTEXT.md` — locked decisions + success criteria.

### Secondary (MEDIUM confidence)
- `github.com/gmag11/MetaTrader5-Docker` v2.3 (via milestone STACK.md) — Wine+RPyC+KasmVNC image, ports, persistent `/config`.
- `pypi.org/project/MetaTrader5` (via milestone STACK.md) — 5.0.5735, Windows-only wheel.
- MQL5 docs (via milestone research) — `initialize`/`login`/`history_deals_get`/`account_info` semantics, `last_error`, IPC pipe timeout.

### Tertiary (LOW confidence — flagged for the live spike)
- `order_check` investor-vs-master retcode behaviour (A1) — no authoritative confirmation; resolved by MT5SPIKE-01 leg 2.
- Unattended Wine login reliability (A2) — community-reported timing race; resolved by MT5SPIKE-01 leg 1.
- Broker server-time offset + history depth (A5) — broker-specific; resolved by the spike.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — `mt5linux` 1.0.3 mechanics read from source; deps verified on PyPI.
- Architecture (contract shape + offline double): HIGH — mirrors shipped sFOX code; mechanics confirmed.
- Pitfalls: HIGH on `None`≠`()`, structural read-only, dual-timeout, secret hygiene; MEDIUM on the live-only unknowns (order_check signal, Wine login, server offset) — explicitly deferred to `human_needed`.
- Security (RPyC RCE channel): HIGH — confirmed the client uses SlaveService `conn.eval`.

**Research date:** 2026-07-23
**Valid until:** ~2026-08-22 (30 days; `mt5linux`/gmag11 are slow-moving, but re-verify the gmag11 port + `mt5linux` version at Phase 139 provisioning).
</content>
</invoke>
