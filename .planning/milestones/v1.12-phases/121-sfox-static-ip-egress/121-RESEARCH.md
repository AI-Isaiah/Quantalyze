# Phase 121: SFOX Static-IP egress (Fly.io) - Research

**Researched:** 2026-07-19
**Domain:** Cloud egress networking (Fly.io) + forward-proxy (tinyproxy) + Python async proxy wiring (aiohttp/ccxt)
**Confidence:** HIGH (Fly docs current; aiohttp/ccxt behavior verified against the installed source)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **The Fly proxy deployable:** tinyproxy in a geo-allowed region (`ams`), dedicated-v4 ($2/mo per
  the founder's original figure — **see the cost correction in the Summary + Assumptions Log**).
  Config: a minimal `tinyproxy.conf` (Port, restrict the worker source, no `Via`/`X-Forwarded`
  leakage, deny by default). `fly.toml` pins region `ams` + the dedicated-v4 service. New directory
  (e.g. `fly-egress-proxy/`) holding Dockerfile + fly.toml + tinyproxy.conf + a founder README runbook.
- **Worker wiring — ONE env var, UNSET = direct (safe pre-deploy):** when SET, every ccxt exchange
  gets `exchange.aiohttp_proxy = <url>` in `create_exchange` (single ccxt chokepoint); every
  `SfoxClient` is constructed with `proxy=<url>`. When UNSET, behavior is BYTE-IDENTICAL to today.
  A small factory (`make_sfox_client()`) reads the env and passes the proxy EXPLICITLY (never
  `trust_env`). Wire it at every SfoxClient construction site.
- **Egress verification (the SFOX-07 gate):** extend `probe_exchange_egress.py` (stdlib-only, runs
  via `railway ssh`) to print the egress IP and assert/compare against an expected dedicated egress
  IP. Fail loud if egress != expected.

### Claude's Discretion
- Exact env var name; the tinyproxy allow/deny specifics.
- Whether to also proxy ccxt (SFOX-07 "and optionally ccxt") — default: proxy sFOX; make ccxt opt-in
  via the same env so today's working ccxt egress isn't disturbed unless the founder opts in.

### Deferred Ideas (OUT OF SCOPE)
- The actual `fly deploy` + egress-IP provision + sFOX IP whitelist — FOUNDER ops (flyctl not local).
- The live SFOX-06 parity run + SFOX-02 live read that gate on this egress (120/119 human_needed legs).
- Wizard UI + badge + e2e (122).
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| SFOX-07 | sFOX API traffic egresses from a stable static IP (Fly.io proxy in `ams`) so an IP-whitelisted sFOX key authenticates; the actual egress IP is VERIFIED == the static IP (from the machine, `curl ipinfo.io`) before whitelisting. Worker routes both ccxt (`aiohttp_proxy`) and SfoxClient (explicit proxy). | Fly topology (§Standard Stack + §Architecture); tinyproxy.conf (§Code Examples); aiohttp CONNECT-auth proof (§Pitfall 1); wiring chokepoints (§Architecture); egress-verify (§Validation) |
</phase_requirements>

## Summary

This phase has two halves: (1) a self-contained Fly.io **forward-proxy deployable** the founder
runs, and (2) a **byte-identical-when-unset worker wiring** change that threads a proxy URL into the
two egress chokepoints already seamed in phases 118–120.

**The single most important finding — a two-IP topology, and a cost correction.** The founder's
"$2/mo dedicated v4" figure conflates two *different* Fly primitives that are both required:
- **Inbound reachability** (Railway worker → the Fly proxy over the public internet): tinyproxy
  listens on a raw-TCP custom port (8888). Fly's *shared* IPv4 only serves HTTP/TLS handlers on
  80/443, so a raw-TCP port needs a **dedicated inbound IPv4** — `fly ips allocate-v4` (~$2/mo).
  [CITED: fly.io/docs/networking/services, fly.io/docs/flyctl/ips-allocate-v4]
- **Outbound egress identity** (the Fly proxy → sFOX; the source IP sFOX whitelists): Fly IPv4
  egress is **NAT'd and varies by default** — a dedicated *inbound* v4 does NOT pin egress. To pin
  it you must allocate an **app-scoped static egress IP** — `fly ips allocate-egress` (**~$3.60/mo**).
  [CITED: fly.io/docs/networking/egress-ips]

So the real monthly cost is **~$5.60/mo (≈$2 inbound + ≈$3.60 egress)**, and **the IP sFOX
whitelists is the static *egress* IP, not the inbound dedicated v4.** This is the make-or-break fact
of the phase — plan and runbook must treat inbound and egress as two separate allocations.

**Worker-side auth: BasicAuth in the proxy URL (not an IP allow-list).** Railway does not provide a
stable worker egress IP (the very reason Railway static IP was rejected as Pro-only), so the Fly
proxy cannot allow-list the worker by source IP. The worker→proxy hop is authenticated with
**tinyproxy `BasicAuth`**, and the credentials travel inline in the ONE env var
(`http://<user>:<secret>@<inbound-ip>:8888`). Verified against the installed **aiohttp 3.14.1**
source: aiohttp derives proxy `BasicAuth` from the proxy URL's userinfo for BOTH plain-HTTP and
HTTPS-CONNECT requests (`connector._update_proxy_auth_header_and_build_proxy_req` builds the inner
proxy request from `req.proxy`, whose `update_host` sets `self.auth` from the URL userinfo). Because
ccxt sets `session.request(proxy=self.aiohttp_proxy)` with **no** `proxy_auth`, this URL-userinfo
mechanism is exactly what makes the ccxt path authenticate too — **no `proxy_auth` plumbing is
needed in either code path.** [VERIFIED: aiohttp 3.14.1 source, ccxt 4.5.64 source]

**Credential safety through the proxy is intact.** All sFOX/ccxt endpoints are HTTPS, so aiohttp
tunnels via HTTP `CONNECT`: TLS is end-to-end between the worker and sFOX, and tinyproxy sees only
`CONNECT api.sfox.com:443` — never the Bearer token or any response body. The proxy is a blind pipe.

**Primary recommendation:** Generate `fly-egress-proxy/` (Dockerfile on Alpine + tinyproxy, fly.toml
pinned to `ams` with a raw-TCP `[[services]]` on 8888, tinyproxy.conf with BasicAuth + deny-by-default
+ `DisableViaHeader Yes` + `ConnectPort 443`), plus a founder runbook that allocates BOTH a dedicated
inbound v4 AND a static egress IP. Wire the worker via ONE env var `WORKER_EGRESS_PROXY_URL` through
a `make_sfox_client()` factory (all 4 SfoxClient sites) and `create_exchange` (ccxt, opt-in). Extend
`probe_exchange_egress.py` to route through the proxy and fail loud if egress != the static egress IP.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Stable outbound source IP | Fly proxy (infra) | — | Static egress IP is a Fly network primitive; app code cannot pin a NAT |
| Worker→proxy authentication | Fly proxy (tinyproxy BasicAuth) | Worker (holds the secret in env) | Deny-by-default belongs at the proxy; the worker only presents the credential |
| Proxy selection / threading | Worker (Python) | — | `create_exchange` + `make_sfox_client()` are the ONE-place chokepoints |
| End-to-end TLS to sFOX | Worker ↔ sFOX (CONNECT tunnel) | — | HTTPS terminates at sFOX, never at the proxy — token never exposed |
| Egress-IP verification gate | Worker (probe script) + Founder (railway ssh) | Fly machine (`fly ssh` curl) | The authoritative check is the worker's realized egress THROUGH the proxy |

## Standard Stack

### Core
| Component | Version | Purpose | Why Standard |
|-----------|---------|---------|--------------|
| Fly.io app + `fly ips allocate-egress` | current | App-scoped static egress IP (the whitelisted source) | Only Fly primitive that pins outbound IPv4 [CITED: fly.io/docs/networking/egress-ips] |
| Fly.io `fly ips allocate-v4` (dedicated) | current | Public inbound reachability for a raw-TCP port | Shared v4 can't serve non-HTTP ports [CITED: fly.io/docs/networking/services] |
| tinyproxy | 1.11.x (distro) | Minimal HTTP/HTTPS-CONNECT forward proxy w/ BasicAuth | The Fly-official reference impl (`fly-apps/fly-fixed-egress-ip-proxy`) uses tinyproxy [CITED: github.com/fly-apps/fly-fixed-egress-ip-proxy] |
| aiohttp | 3.14.1 (already installed) | HTTP client for SfoxClient + ccxt; proxy + CONNECT | Already the transport; supports proxy-URL BasicAuth [VERIFIED: installed source] |
| ccxt | 4.5.64 (already installed) | Exchange client; `exchange.aiohttp_proxy` attr | `aiohttp_proxy = None` class default → unset is byte-identical [VERIFIED: installed source] |

**No new Python/JS packages.** The worker-side change adds ZERO dependencies — aiohttp and ccxt
already support proxying. tinyproxy is a distro package (`apk add tinyproxy` / `apt-get install
tinyproxy`), not a language-registry package.

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Dedicated inbound v4 + raw TCP 8888 | Fly free IPv6 + raw TCP (no inbound v4 cost) | Free, but requires Railway worker to have working IPv6 egress to the proxy — UNVERIFIED for Railway; risky. Keep v4. |
| tinyproxy BasicAuth | IP allow-list (`Allow <worker-ip>`) | Rejected: Railway worker egress IP is not stable (the reason Railway static IP was rejected) |
| tinyproxy | Squid / 3proxy / Fly `.flycast` private net | flycast (the reference repo's default) needs the CLIENT on Fly's private net; Railway is external → not usable. tinyproxy is smallest for a public+authed proxy. |

**Installation (proxy image — founder-run, generated by the plan):**
```dockerfile
FROM alpine:3.20
RUN apk add --no-cache tinyproxy
COPY tinyproxy.conf /etc/tinyproxy/tinyproxy.conf
EXPOSE 8888
CMD ["tinyproxy", "-d", "-c", "/etc/tinyproxy/tinyproxy.conf"]
```

**Version verification:** `aiohttp 3.14.1` and `ccxt 4.5.64` confirmed from the analytics-service
`.venv` dist-info / `__version__`. Fly CLI commands confirmed against current docs (fetched
2026-07-19). tinyproxy directive names confirmed against the upstream `tinyproxy.conf.in` template.

## Package Legitimacy Audit

No external language-registry packages are installed by this phase. The Fly proxy image installs
`tinyproxy` from the official Alpine (`apk`) or Debian (`apt`) distro repository — an OS package
manager with signed indexes, outside the npm/PyPI hallucination-vector surface. slopcheck (npm/PyPI)
is therefore N/A. The worker change imports only already-present `aiohttp`/`ccxt`.

| Package | Registry | Disposition |
|---------|----------|-------------|
| tinyproxy | Alpine apk / Debian apt (distro) | Approved — official distro package, signed repo |
| aiohttp 3.14.1 | (already installed) | No change |
| ccxt 4.5.64 | (already installed) | No change |

## Architecture Patterns

### System Architecture Diagram

```
                         ONE env var: WORKER_EGRESS_PROXY_URL
                         = http://USER:SECRET@<inbound-v4>:8888   (UNSET ⇒ direct, byte-identical)
                                   │
   Railway worker (AS400940, Amsterdam)
   ┌──────────────────────────────────────────────┐
   │  create_exchange(...)          make_sfox_client(...)         │
   │   └─ exchange.aiohttp_proxy=URL   └─ SfoxClient(proxy=URL)   │
   │        (ccxt, opt-in)                (sFOX, always when set) │
   └───────────────┬───────────────────────┬─────────────────────┘
                   │  HTTP CONNECT api.sfox.com:443  (+ Proxy-Authorization: Basic ...)
                   ▼                        ▼
        Fly app  fly-egress-proxy  (region = ams)
        ┌───────────────────────────────────────────┐
        │ INBOUND: dedicated v4 (fly ips allocate-v4)│  ← Railway reaches :8888 here
        │   [[services]] internal_port=8888 raw TCP  │
        │ tinyproxy: BasicAuth, deny-by-default,     │
        │   DisableViaHeader, ConnectPort 443        │
        │   (blind TLS tunnel — sees only CONNECT)   │
        │ OUTBOUND: static egress IP                 │  ← the IP sFOX whitelists
        │   (fly ips allocate-egress, ~$3.60/mo)     │
        └───────────────────┬───────────────────────┘
                            │  end-to-end TLS (Bearer token never seen by proxy)
                            ▼
                 api.sfox.com  (whitelists the static egress IP)
```

### Recommended Project Structure
```
fly-egress-proxy/          # NEW — self-contained, founder deploys
├── Dockerfile             # alpine + tinyproxy
├── fly.toml               # region ams, raw-TCP [[services]] on 8888
├── tinyproxy.conf         # BasicAuth, deny-by-default, no header leakage
└── README.md              # founder runbook: deploy, allocate BOTH IPs, verify, whitelist
analytics-service/
├── services/sfox_client.py        # UNCHANGED — proxy= ctor arg already seamed
├── services/exchange.py           # create_exchange: set exchange.aiohttp_proxy (ccxt opt-in)
├── services/sfox_factory.py       # NEW (or a helper in sfox_client) — make_sfox_client()
├── services/job_worker.py         # _make_exchange_client sfox branch → make_sfox_client()
├── routers/exchange.py            # _validate_sfox_key → make_sfox_client()
├── routers/internal.py            # finalize probe → make_sfox_client()
├── services/ingestion/sfox.py     # SfoxAdapter.validate → make_sfox_client()
└── scripts/probe_exchange_egress.py  # extend: route via proxy, assert egress == expected
```

### Pattern 1: One env var, UNSET = byte-identical
**What:** A single `WORKER_EGRESS_PROXY_URL`. When unset, `make_sfox_client()` passes `proxy=None`
(today's SfoxClient behavior) and `create_exchange` leaves `exchange.aiohttp_proxy` at its `None`
class default (today's ccxt behavior). Merging before the founder deploys changes nothing in prod.
**Why safe:** `SfoxClient.__init__` already defaults `proxy=None`; ccxt base `exchange.py:177`
declares `aiohttp_proxy = None` as the class default. [VERIFIED: installed source]

### Pattern 2: Factory reads env once, passes proxy explicitly
```python
# services/sfox_factory.py  (illustrative — plan finalizes)
import os
from services.sfox_client import SfoxClient, SFOX_PROD_BASE_URL

def worker_egress_proxy_url() -> str | None:
    url = os.getenv("WORKER_EGRESS_PROXY_URL")
    return url or None  # empty string ⇒ None (unset = direct)

def make_sfox_client(api_key: str, base_url: str = SFOX_PROD_BASE_URL) -> SfoxClient:
    # trust_env stays False inside SfoxClient; the proxy is ALWAYS explicit.
    return SfoxClient(api_key=api_key.strip(), base_url=base_url,
                      proxy=worker_egress_proxy_url())
```

### Pattern 3: ccxt opt-in in the single chokepoint
```python
# services/exchange.py::create_exchange — after `exchange = cls(config)`
proxy = os.getenv("WORKER_EGRESS_PROXY_URL")
if proxy and os.getenv("WORKER_EGRESS_PROXY_APPLIES_TO_CCXT", "").lower() in ("1", "true", "on"):
    exchange.aiohttp_proxy = proxy   # ccxt threads this into every fetch (load_markets included)
# else: aiohttp_proxy stays None (class default) — byte-identical to today
```
ccxt applies `self.aiohttp_proxy` in its base `fetch` for EVERY request (async_support
`exchange.py:200-201`), so setting it once on the instance covers `load_markets` + all fetches.
[VERIFIED: ccxt 4.5.64 source]

### Anti-Patterns to Avoid
- **Allow-listing the worker by IP.** Railway egress IP is not stable → auth breaks silently. Use
  BasicAuth.
- **Passing the secret via `HTTPS_PROXY` env + `trust_env`.** SfoxClient is `trust_env=False` by
  design; env proxies would be ignored (the documented aiohttp trap). Always pass `proxy=` explicitly.
- **Whitelisting the dedicated *inbound* v4 at sFOX.** That is not the egress IP. Whitelist the
  `fly ips allocate-egress` address, verified from the machine.
- **Exposing tinyproxy without BasicAuth on a public inbound IP.** An open relay is an abuse magnet.
  Deny-by-default + BasicAuth are load-bearing.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Forward HTTP/HTTPS proxy | A custom asyncio CONNECT relay | tinyproxy | CONNECT semantics, auth, header hygiene, timeouts are all solved + Fly-referenced |
| Proxy BasicAuth over CONNECT | Manual `Proxy-Authorization` header injection | aiohttp proxy-URL userinfo | aiohttp already derives + places it on the CONNECT req (verified) |
| Static egress IP | In-container VPN / NordVPN tunnel | `fly ips allocate-egress` | Founder already rejected VPN as fragile; Fly egress IP is a first-class primitive |

**Key insight:** Every moving part here already exists — Fly provides the static egress primitive,
aiohttp/ccxt already support proxying, and SfoxClient already has the explicit `proxy=` seam. The
phase is *config + a thin factory*, not new machinery.

## Runtime State Inventory

> Rename/refactor inventory — mostly N/A (this is additive infra + a gated wiring change), but the
> deploy-time state matters, so it is enumerated explicitly.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | None — no datastore stores the proxy URL as a key. | None. |
| Live service config | **Railway worker env** must gain `WORKER_EGRESS_PROXY_URL` (+ optional ccxt toggle) — set by the FOUNDER after deploy, NOT in git. **sFOX dashboard** must whitelist the static egress IP — founder ops, external UI. | Founder runbook step (post-verify). |
| OS-registered state | None — no Task Scheduler / launchd / cron embeds the proxy. | None. |
| Secrets/env vars | New secret: the BasicAuth credential lives inside `WORKER_EGRESS_PROXY_URL` (Railway env) and as tinyproxy `BasicAuth` on the Fly side (set via `fly secrets` or baked into the image config). Both must match. | Founder sets both; keep the secret out of git + logs. |
| Build artifacts | None on the worker side. The Fly image is a NEW, independent artifact. | None. |

**The canonical question — what still has old/unset state after merge?** Nothing: with the env
unset, the merged code egresses directly exactly as today. The proxy only takes effect once the
founder sets the env AND deploys the Fly app. Safe to merge ahead of the deploy.

## Common Pitfalls

### Pitfall 1: aiohttp ignores proxy-URL credentials (FALSE for 3.14.1 — but verify on upgrade)
**What could go wrong:** A well-known older-aiohttp gotcha is that `proxy="http://u:p@host"` had its
userinfo ignored unless you passed `proxy_auth=BasicAuth(...)`.
**Reality for THIS version:** aiohttp **3.14.1** DOES honor proxy-URL userinfo. The connector builds
the inner proxy request from `req.proxy`; that request's `update_host` sets `self.auth` from the URL
userinfo (`client_reqrep.py:1058-1059`), and `_update_proxy_auth_header_and_build_proxy_req` moves it
to `Proxy-Authorization` on BOTH the plain-HTTP path and the HTTPS-CONNECT path
(`connector.py:615-620`). [VERIFIED: installed source]
**How to avoid regressions:** A wiring unit test should assert the CONNECT auth actually reaches the
proxy (integration-level, via a local mock proxy) OR pin the aiohttp version. If aiohttp is ever
upgraded, re-verify this behavior.
**Warning sign:** proxy returns `407 Proxy Authentication Required` → the credential isn't landing.

### Pitfall 2: Dedicated inbound v4 ≠ egress IP (the phase's central trap)
**What goes wrong:** Whitelisting the `fly ips allocate-v4` address at sFOX — auth still fails
because outbound egress uses a *different*, NAT'd/variable IP.
**How to avoid:** Allocate `fly ips allocate-egress`; whitelist THAT; verify from the machine.
**Warning sign:** `curl ipinfo.io` from the Fly machine shows an IP ≠ the whitelisted one.

### Pitfall 3: Shared v4 can't serve a raw-TCP proxy port
**What goes wrong:** Relying on Fly's free shared IPv4 for tinyproxy on 8888 — shared v4 only routes
HTTP/TLS handler traffic (80/443), so the raw-TCP proxy is unreachable.
**How to avoid:** Allocate a dedicated inbound v4 and declare a handler-less `[[services]]` on 8888.

### Pitfall 4: aiohttp `trust_env` false-negative for SfoxClient
**What goes wrong:** Setting `HTTPS_PROXY` and expecting SfoxClient to pick it up — it won't
(`trust_env=False` by design). ccxt likewise uses `aiohttp_proxy`, not env.
**How to avoid:** Thread the explicit `proxy=`/`aiohttp_proxy` from the ONE env var (this phase's
whole design). Carry-forward from STATE.md — honored by the factory pattern.

### Pitfall 5: Leaking the proxy secret into logs
**What goes wrong:** The proxy URL carries the BasicAuth secret; ccxt `verbose=True` or a naive log
of the URL would expose it.
**How to avoid:** Never log the raw env value; SfoxClient already scrubs. Keep ccxt `verbose` off.

## Code Examples

### tinyproxy.conf (secure forward proxy — deny-by-default, authed, no leakage)
```conf
# fly-egress-proxy/tinyproxy.conf  — verified directive names vs upstream tinyproxy.conf.in
User tinyproxy
Group tinyproxy
Port 8888
# Bind all interfaces inside the Fly machine (Fly routes the dedicated v4 → this port).
# (Omit `Listen` to bind 0.0.0.0; Fly's edge already gates who reaches the port.)

# --- AUTH: deny-by-default. With BasicAuth set, ONLY authenticated users get through. ---
BasicAuth quantalyze CHANGE_ME_LONG_RANDOM_SECRET      # space-separated (man page form)

# --- NO source Allow lines: Railway egress IP is not stable → auth is BasicAuth, not IP. ---
# (Leaving Allow unset with BasicAuth present means "authenticated clients only".)

# --- HTTPS via CONNECT tunneling (sFOX + ccxt are all https). Restrict to 443. ---
ConnectPort 443

# --- Header hygiene / no leakage (matters for plain HTTP; CONNECT is opaque anyway) ---
DisableViaHeader Yes
# Anonymous whitelist: strip everything except what's needed on plain-HTTP requests.
Anonymous "Host"
Anonymous "Authorization"

Timeout 600
MaxClients 50
LogLevel Info
```
> Sources: upstream `tinyproxy.conf.in` (directive names) + `tinyproxy.conf(5)` man page.
> ⚠️ `BasicAuth` syntax: the upstream template + man page use **space-separated**
> (`BasicAuth user password`); some blogs show a colon form — the space form is authoritative.
> The plan should note this for the founder and keep the credential out of git (use `fly secrets`
> or an entrypoint that renders the conf from an env var).

### fly.toml (raw-TCP proxy pinned to ams)
```toml
app = "quantalyze-egress-proxy"
primary_region = "ams"

[build]
  dockerfile = "Dockerfile"

[[services]]
  internal_port = 8888
  protocol = "tcp"
  # No handlers ⇒ raw TCP pass-through to tinyproxy (Fly forwards as-is).
  [[services.ports]]
    port = 8888

[[vm]]
  size = "shared-cpu-1x"
  memory = "256mb"
```
> Source: fly.io/docs/networking/services (handler-less `[[services]]` = raw TCP forward).

### Founder runbook (the load-bearing sequence)
```bash
# 1. Deploy the proxy app to ams
fly launch --no-deploy --region ams        # or `fly apps create` + `fly deploy`
fly deploy

# 2. INBOUND reachability — dedicated v4 (raw-TCP port needs a dedicated, not shared, v4)
fly ips allocate-v4                          # ~$2/mo ; note the address → this is the :8888 host

# 3. OUTBOUND identity — the IP sFOX whitelists (SEPARATE allocation, ~$3.60/mo)
fly ips allocate-egress --region ams
fly ips list                                 # record the egress IPv4

# 4. Set the tinyproxy secret (if rendering conf from env, else baked in the image)
fly secrets set PROXY_BASIC_AUTH="quantalyze:LONG_RANDOM_SECRET"

# 5. VERIFY the machine's egress == the static egress IP BEFORE whitelisting
fly ssh console -C "curl -s https://ipinfo.io/json"     # .ip must == the allocated egress IPv4

# 6. Set the worker env on Railway (proxy takes effect only now)
#    WORKER_EGRESS_PROXY_URL=http://quantalyze:LONG_RANDOM_SECRET@<dedicated-v4>:8888
# 7. VERIFY the worker's realized egress THROUGH the proxy (the SFOX-07 gate) — see §Validation
# 8. ONLY THEN whitelist the egress IPv4 in the sFOX dashboard
```

## State of the Art

| Old Approach | Current Approach | When | Impact |
|--------------|------------------|------|--------|
| Machine-scoped egress IP (`fly machine egress-ip allocate`) | **App-scoped** static egress (`fly ips allocate-egress`) | Current Fly docs | App-scoped survives machine recreation + supports ≤64 machines; machine-scoped is deprecated. Use app-scoped. |
| aiohttp: `proxy_auth=BasicAuth(...)` param | Proxy-URL userinfo (auto-derived); `proxy_auth` deprecated toward v4 | aiohttp 3.14 | Inline userinfo is the forward-compatible path; no separate param needed. |

**Deprecated/outdated:**
- `fly machine egress-ip allocate` (the reference repo's approach) — machine-scoped, deprecated;
  prefer app-scoped `fly ips allocate-egress`.
- aiohttp `proxy_auth=` kwarg — emits a deprecation warning in 3.14; the URL-userinfo path avoids it.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Static egress IP is ~$3.60/mo and dedicated inbound v4 ~$2/mo → ~$5.60/mo total. | Summary | Cost differs; founder budget expectation off. Verify current Fly pricing at deploy. |
| A2 | Railway worker egress IP is not stable (⇒ BasicAuth not IP allow-list). | Summary | If Railway did offer a stable egress, an IP allow-list would be simpler — but BasicAuth is safe regardless. |
| A3 | `ams` static egress geolocates to NL/EU (geo-allowed, matches AS400940). | Summary | If the egress IP geolocates elsewhere, ccxt geo-blocks could reappear — verify with the probe's country field. |
| A4 | Railway worker can reach a public Fly dedicated-v4 on raw TCP 8888 (no Railway egress port restrictions). | Architecture | If Railway blocks non-standard outbound ports, use 443-fronted alternative. Verify in the live gate. |
| A5 | tinyproxy `BasicAuth` is space-separated (`user password`). | Code Examples | A colon form would 407; the man page is authoritative — verify on first deploy. |

## Open Questions

1. **Does Railway allow outbound to an arbitrary TCP port (8888)?**
   - Known: Railway egresses to the public internet for HTTPS today.
   - Unclear: whether non-443 outbound ports are unrestricted.
   - Recommendation: the live egress-verify gate (§Validation) proves this end-to-end; if 8888 is
     blocked, front tinyproxy on 443 via a TLS handler as a fallback (noted, not default).

2. **Bake the tinyproxy secret in the image vs render from `fly secrets`?**
   - Recommendation: render `tinyproxy.conf` from `PROXY_BASIC_AUTH` at container start (small
     entrypoint) so the secret never lands in the image layers or git.

## Environment Availability

| Dependency | Required By | Available (local) | Fallback |
|------------|------------|-------------------|----------|
| flyctl | Fly deploy + IP allocation | ✗ NOT installed | Founder-run ops (by design); plan generates config + runbook |
| curl | Egress verify command | ✓ | — |
| railway CLI / MCP | Worker env + `railway ssh` probe | ✓ (MCP + CLI) | — |
| aiohttp 3.14.1 / ccxt 4.5.64 | Worker proxy wiring | ✓ (in `.venv`) | — |

**Missing with no fallback:** none blocking — flyctl absence is expected (founder ops).

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | pytest (analytics-service) |
| Quick run | `cd analytics-service && python -m pytest tests/test_egress_proxy_wiring.py -q` |
| Full suite | `cd analytics-service && python -m pytest -q` (baseline: 3974 passing) |

### How the wiring is tested WITHOUT a live Fly deploy (unit/offline)
| Behavior | Test |
|----------|------|
| env SET ⇒ SfoxClient gets the proxy | `make_sfox_client()` with `WORKER_EGRESS_PROXY_URL` set → returned client `._proxy == url` |
| env UNSET ⇒ byte-identical | env unset → `make_sfox_client()._proxy is None`; `create_exchange(...).aiohttp_proxy is None` |
| ccxt opt-in gating | ccxt toggle off (even with URL set) → `aiohttp_proxy is None`; toggle on → `== url` |
| All 4 sites route through the factory | grep/AST assertion or a monkeypatched `make_sfox_client` proves each site (`routers/exchange.py`, `routers/internal.py`, `job_worker.py`, `ingestion/sfox.py`) constructs via the factory, not bare `SfoxClient(...)` |
| CONNECT auth actually reaches the proxy | integration test against a local mock proxy (or a `pytest-aiohttp` fake) asserting the `Proxy-Authorization` header lands — guards Pitfall 1 across aiohttp upgrades |
| probe fail-loud logic | unit test `probe_exchange_egress` compare logic: observed != expected ⇒ exit 1; == ⇒ exit 0 (inject `_get`) |

### Requirements → Test Map
| Req | Behavior | Type | Command | File |
|-----|----------|------|---------|------|
| SFOX-07 | env-set threads proxy into both paths; env-unset byte-identical | unit | `pytest tests/test_egress_proxy_wiring.py -x` | ❌ Wave 0 |
| SFOX-07 | proxy BasicAuth lands on CONNECT | integration | `pytest tests/test_egress_proxy_connect.py -x` | ❌ Wave 0 |
| SFOX-07 | egress-verify asserts + fails loud | unit | `pytest tests/test_probe_egress_verify.py -x` | ❌ Wave 0 |

### Founder-gated live verification (human_needed — mirrors 118/120 precedent)
The authoritative SFOX-07 gate is the worker's **realized** egress through the proxy, run from
Railway BEFORE whitelisting:
```bash
# Extend probe_exchange_egress.py: read WORKER_EGRESS_PROXY_URL + WORKER_EGRESS_EXPECTED_IP,
# route the ipinfo.io call THROUGH the proxy (urllib.request.ProxyHandler({'https': url})),
# print egress IP + country, and return exit 1 if egress != expected (fail loud).
railway ssh "cd /app && WORKER_EGRESS_PROXY_URL=... WORKER_EGRESS_EXPECTED_IP=<egress-v4> \
             python -m scripts.probe_exchange_egress --assert-egress"
# Simpler founder cross-check (no code): curl through the proxy from the worker
railway ssh "curl -s --proxy 'http://quantalyze:SECRET@<inbound-v4>:8888' https://ipinfo.io/json"
```
A mismatch (or a 407) fails the gate; the founder does NOT whitelist until egress == the static
egress IP. This is a `human_needed` gate — the harness never fakes a live pass.

### Wave 0 Gaps
- [ ] `tests/test_egress_proxy_wiring.py` — env set/unset for `make_sfox_client` + `create_exchange`
- [ ] `tests/test_egress_proxy_connect.py` — CONNECT `Proxy-Authorization` lands (mock proxy)
- [ ] `tests/test_probe_egress_verify.py` — assert/fail-loud compare logic
- [ ] `services/sfox_factory.py` (or helper) + refactor 4 SfoxClient sites to use it

## Security Domain

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | tinyproxy `BasicAuth` (deny-by-default) on the worker→proxy hop |
| V4 Access Control | yes | Proxy denies unauthenticated clients; `ConnectPort 443` limits CONNECT targets |
| V5 Input Validation | yes | Proxy URL comes from a trusted env var (Railway secret), not user input |
| V6 Cryptography | yes | End-to-end TLS preserved via CONNECT — proxy never terminates TLS, never sees the Bearer token |
| V7 Error/Logging | yes | Never log the proxy URL (carries the secret); SfoxClient already scrubs |

### Known Threat Patterns
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Open relay abuse on a public inbound IP | Spoofing / Elevation | BasicAuth + deny-by-default; no `Allow` bypass |
| Credential/token disclosure to the proxy hop | Info Disclosure | HTTPS CONNECT = end-to-end TLS; proxy sees only `CONNECT host:443` |
| Proxy secret leakage in logs | Info Disclosure | Keep secret out of git; no ccxt `verbose`; scrub URL in logs |
| Egress IP drift (whitelist silently breaks) | Denial of Service | Static egress IP (app-scoped) + the live verify gate before whitelisting |
| Header/identity leakage on plain HTTP | Info Disclosure | `DisableViaHeader Yes` + `Anonymous` whitelist (moot for CONNECT, defense-in-depth) |

## Sources

### Primary (HIGH confidence)
- Installed source: `aiohttp 3.14.1` — `client_reqrep.py:1058-1059,1181-1191`, `connector.py:597-621`
  (proxy-URL userinfo → `Proxy-Authorization` on CONNECT). `ccxt 4.5.64` —
  `async_support/base/exchange.py:199-208`, `base/exchange.py:177` (`aiohttp_proxy = None` default).
- fly.io/docs/networking/egress-ips — `fly ips allocate-egress`, ~$3.60/mo, IPv4 NAT'd/varies by default.
- fly.io/docs/networking/services — handler-less `[[services]]` = raw TCP forward.
- fly.io/docs/flyctl/ips-allocate-v4 — dedicated (no `--shared`) v4 for inbound.
- github.com/fly-apps/fly-fixed-egress-ip-proxy — Fly-official tinyproxy egress-proxy reference.
- Upstream `tinyproxy/etc/tinyproxy.conf.in` + `tinyproxy.conf(5)` man page — directive names/syntax.
- Repo: `services/sfox_client.py` (proxy seam), `services/exchange.py:817` (ccxt chokepoint),
  `services/job_worker.py:705-726`, `routers/exchange.py:66`, `routers/internal.py:231`,
  `services/ingestion/sfox.py:74`, `scripts/probe_exchange_egress.py`.

### Secondary (MEDIUM confidence)
- Fly community threads on static egress IPs; QuotaGuard Fly static-IP guide (corroborate egress NAT).

### Tertiary (LOW confidence)
- Blog posts on tinyproxy BasicAuth (conflicting space-vs-colon syntax — deferred to the man page).

## Metadata
**Confidence breakdown:**
- Worker wiring (aiohttp/ccxt proxy): HIGH — verified against installed source.
- Fly topology + commands: HIGH — current official docs (fetched 2026-07-19).
- Cost figures: MEDIUM — docs quote $3.60/mo egress; verify total at deploy (A1).
- tinyproxy directives: HIGH names / MEDIUM BasicAuth syntax form (A5).

**Research date:** 2026-07-19
**Valid until:** ~2026-08-18 (Fly pricing/CLI + aiohttp version are the volatile inputs)
