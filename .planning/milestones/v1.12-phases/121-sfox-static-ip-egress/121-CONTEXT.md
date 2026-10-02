# Phase 121: SFOX Static-IP egress (Fly.io) - Context

**Gathered:** 2026-07-19
**Status:** Ready for planning
**Mode:** Autonomous (infra config + a contained wiring change; the deploy is founder-ops)

<domain>
## Phase Boundary

All sFOX (and optionally ccxt) worker API traffic egresses from ONE verified static IPv4, so an
IP-whitelisted sFOX key authenticates.

In scope (SFOX-07):
- The Fly.io deployable: a $2/mo dedicated-v4 tinyproxy (forward HTTP/HTTPS proxy) in `ams`
  (geo-allowed — matches today's Railway AS400940 Amsterdam egress; US is rejected: Bybit/Binance
  403/451). Generate: Dockerfile + fly.toml + tinyproxy.conf. I generate these; the FOUNDER runs
  `fly deploy`, provisions the dedicated v4, and whitelists the IP at sFOX — ONLY after the egress
  IP is verified == the dedicated v4 from the machine (`curl ipinfo.io`). flyctl is NOT installed
  locally.
- Worker proxy wiring: BOTH ccxt exchanges (via `exchange.aiohttp_proxy` — ccxt async_support
  supports it, exchange.py base :199-207) AND `SfoxClient`'s aiohttp session (explicit `proxy=`
  ctor arg — already seamed in phase 118; aiohttp ignores `HTTPS_PROXY` without `trust_env`, and
  SfoxClient is `trust_env=False` by design). Driven by ONE env var (the proxy URL); UNSET = no
  proxy (today's direct egress, byte-identical) so this is safe to merge before the founder deploys.
- An egress-IP verification: extend `scripts/probe_exchange_egress.py` (or a sibling) so the founder
  can confirm the worker's actual egress == the dedicated v4 BEFORE whitelisting (the SFOX-07 gate).

Out of scope: the add-key wizard UI + badge + e2e (122); the sFOX reconstruction correctness (120).
</domain>

<decisions>
## Implementation Decisions

### The Fly proxy deployable
- tinyproxy in a geo-allowed region (`ams`), dedicated-v4 ($2/mo). Config: a minimal tinyproxy.conf
  (Port, Allow the Railway worker's source, Upstream none, no `Via`/no `X-Forwarded` leakage, deny
  by default + allow the worker). fly.toml pins the region `ams` + the dedicated-v4 service.
- New directory (e.g. `fly-egress-proxy/`) holding Dockerfile + fly.toml + tinyproxy.conf + a short
  README runbook for the founder (fly deploy, `fly ips allocate-v4` for the DEDICATED v4 — NOT the
  shared v4, verify, set the worker env, whitelist at sFOX).

### Worker wiring — ONE env var, UNSET = direct (safe pre-deploy)
- ONE env var (name TBD in research — e.g. `WORKER_EGRESS_PROXY_URL`). When SET, every ccxt exchange
  gets `exchange.aiohttp_proxy = <url>` in `create_exchange` (the single ccxt chokepoint — covers
  funding_fetch + job_worker callers), and every `SfoxClient` is constructed with `proxy=<url>`.
  When UNSET, behavior is BYTE-IDENTICAL to today (no proxy) — so merging before the founder deploys
  is safe and does not change prod egress.
- SfoxClient proxy: a small factory (e.g. `make_sfox_client()`) that reads the env and passes the
  proxy EXPLICITLY (never trust_env). Wire it at every SfoxClient construction site (validate branch
  routers/exchange.py, sfox_read.py, the worker sfox branch).
- ⚠️ aiohttp proxy trap (carry-forward): aiohttp ignores env proxies without `trust_env`/explicit
  `proxy=`. SfoxClient already does explicit `proxy=`; ccxt uses `aiohttp_proxy` (not env).

### Egress verification (the SFOX-07 gate)
- Extend `probe_exchange_egress.py` (stdlib-only, runs via `railway ssh`) to print the egress IP
  and assert/compare it against an expected dedicated-v4 (passed as arg/env) — so the founder's
  pre-whitelist check is one command. Fail loud if egress != expected.

### ⚠️ TOPOLOGY + COST CORRECTION (research 2026-07-19, current Fly docs — supersedes the "$2/mo dedicated v4" framing)
- The founder's "$2/mo dedicated v4" conflates TWO Fly primitives. Fly IPv4 egress is NAT'd/variable
  by default; a dedicated INBOUND v4 does NOT pin egress. BOTH are required:
  - a dedicated **inbound** v4 (`fly ips allocate-v4`, ~$2/mo) for raw-TCP reachability of the proxy, AND
  - a **static egress IP** (`fly ips allocate-egress`, ~$3.60/mo) — THIS is the address sFOX whitelists.
  - **Real cost ≈ $5.60/mo** (not $2). The founder runbook must do BOTH allocations and whitelist the
    EGRESS ip, and verify egress==that egress ip from the machine before whitelisting.
- Worker→proxy auth = tinyproxy **BasicAuth** (Railway's worker egress isn't a stable source IP, so
  an IP allow-list won't work). ENV: `WORKER_EGRESS_PROXY_URL = http://user:secret@<inbound-v4>:8888`.
  aiohttp 3.14.1 auto-derives `Proxy-Authorization` from the URL userinfo on BOTH plain-HTTP and
  HTTPS-CONNECT — so ccxt (`proxy=` with no proxy_auth) works too, zero extra plumbing.
- Credential safety: all sFOX/exchange traffic is HTTPS → aiohttp tunnels via CONNECT, TLS end-to-end,
  tinyproxy sees only `CONNECT host:443` — never the Bearer token or responses.
- Open (proven by the live egress-verify gate): does Railway allow outbound to non-443 TCP 8888? A
  443-fronted fallback is noted in RESEARCH.

### Claude's Discretion
- The tinyproxy allow/deny/no-leak-header specifics (per RESEARCH's concrete tinyproxy.conf).
- Whether to also proxy ccxt: default proxy sFOX; ccxt opt-in via the same env (don't disturb today's
  working ccxt egress unless the founder opts in). Env `WORKER_EGRESS_PROXY_URL` (RESEARCH-named).
</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `services/sfox_client.py` — already takes `proxy` ctor arg (:103/:112/:206), `trust_env=False` (:146).
- `services/exchange.py::create_exchange` (:817) — the SINGLE ccxt construction chokepoint (all ccxt
  callers: funding_fetch.py:852, job_worker.py:726 `_make_exchange_client`). Set `aiohttp_proxy` here.
- ccxt async_support base `exchange.py:199-207` — supports `self.aiohttp_proxy`.
- `scripts/probe_exchange_egress.py` — stdlib egress-region probe; extend for the IP-verify gate.
- `analytics-service/Dockerfile` — the existing Railway image (reference for the proxy Dockerfile style).

### Established Patterns
- Founder-run ops gates (flyctl not local) — generate config + a runbook; founder deploys + whitelists.
- Env-driven, UNSET = today's behavior (safe merge before deploy).

### Integration Points
- create_exchange (ccxt) + the SfoxClient construction sites (sfox) — both read the ONE proxy env.
</code_context>

<specifics>
## Specific Ideas

- Dedicated v4 (NOT shared) — a shared Fly v4 rotates / is co-tenanted; the whitelist needs a stable
  dedicated address (`fly ips allocate-v4` without `--shared`).
- Verify egress == dedicated v4 from the MACHINE (`railway ssh "... curl ipinfo.io"`) before whitelisting
  — the proxy must actually route the worker's traffic, not just exist.
</specifics>

<deferred>
## Deferred Ideas

- The actual `fly deploy` + dedicated-v4 provision + sFOX IP whitelist — FOUNDER ops (flyctl not local).
- The live SFOX-06 parity run + SFOX-02 live read that gate on this egress (120/119 human_needed legs).
- Wizard UI + badge + e2e (122).
</deferred>
