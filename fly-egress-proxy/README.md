# fly-egress-proxy — static-IP egress proxy for sFOX (SFOX-07)

A self-contained Fly.io forward proxy (tinyproxy) that gives the Railway worker a
**single, stable, static IPv4 egress** so an IP-whitelisted sFOX key authenticates.
The worker routes sFOX (always, when the env is set) and — opt-in — ccxt traffic
through this proxy; the proxy's static egress IP is the address you whitelist at sFOX.

Everything here is **inert until you deploy it**. `flyctl` is not installed in the
build environment — these files are generated for you to run. Follow this runbook
top-to-bottom; do not skip the verify step (7) before whitelisting (8).

---

## The topology you are building (read this first)

The original "$2/mo dedicated v4" framing conflated **two different Fly primitives**.
Both are required, and — critically — **the IP sFOX whitelists is the EGRESS one, not
the inbound v4**:

| Primitive | Command | ~Cost | Role |
|-----------|---------|-------|------|
| Dedicated **inbound** v4 | `fly ips allocate-v4` | ~$2/mo | The `:8888` host the worker connects TO. A shared v4 cannot serve a raw-TCP port, so this must be dedicated. **Not** the egress IP. |
| Static **egress** IP | `fly ips allocate-egress` | ~$3.60/mo | The source IP the proxy egresses FROM. Fly egress is NAT'd/variable by default; this pins it. **This is the only address sFOX whitelists.** |

**Real running cost ≈ $5.60/mo** (verify current Fly pricing at deploy time).

> ⚠️ **The central trap:** whitelisting the dedicated *inbound* v4 at sFOX will fail
> auth — outbound egress uses a *different* IP unless you allocate the static egress
> IP. Whitelist the `allocate-egress` address, and only after step 7 verifies it.

**Credential safety:** all sFOX/ccxt traffic is HTTPS, so the worker tunnels via HTTP
`CONNECT`. TLS is end-to-end between the worker and sFOX; tinyproxy sees only
`CONNECT api.sfox.com:443` — never the Bearer token, never a response body. The proxy
is a blind pipe.

**Destination allow-list (defense-in-depth):** BasicAuth gates *who* connects;
`FilterDefaultDeny Yes` + `tinyproxy.filter` gate *where* they connect to. Only the
sFOX, ccxt-exchange, and egress-probe hosts (`api.sfox.com`, `*.bybit.com`,
`*.binance.com`, `*.okx.com`, `*.deribit.com`, `ipinfo.io`) are reachable, so a leaked
proxy credential cannot turn this public IP into an open relay to arbitrary hosts.
Adding a new venue means adding its host to `tinyproxy.filter` and redeploying.

**Residual risk (accepted, not fixed here):** the proxy BasicAuth itself travels as
plaintext over the public internet (the worker→proxy hop is plain HTTP on `:8888`,
only the *tunneled* sFOX TLS is confidential). That credential gates **only the proxy**
— never the sFOX Bearer token, which stays inside the end-to-end TLS tunnel — and it is
freely rotatable via `fly secrets set PROXY_BASIC_AUTH=...`. If proxy-credential
confidentiality on the wire is required, front tinyproxy behind a TLS handler on `443`
(see the step-7 fallback); that is the confidentiality upgrade, deliberately out of
scope for this cheap-hardening pass.

---

## Runbook

### 1. Deploy the proxy app to `ams`

```bash
cd fly-egress-proxy/
fly launch --no-deploy --region ams      # or: fly apps create quantalyze-egress-proxy
fly deploy
```

### 2. Allocate the dedicated INBOUND v4 (reachability)

```bash
fly ips allocate-v4                       # ~$2/mo — dedicated, NOT --shared
fly ips list                              # note this address → it is the :8888 host
```

> ⚠️ A **shared** v4 only routes HTTP/TLS handlers on 80/443, so it cannot serve the
> raw-TCP proxy on 8888 — that is why this allocation must be dedicated.
> ⚠️ This inbound address is **NOT** the egress IP. Whitelisting it at sFOX will fail
> auth. It is used only in `WORKER_EGRESS_PROXY_URL` below.

### 3. Allocate the static EGRESS IP (the address sFOX whitelists)

```bash
fly ips allocate-egress --region ams      # ~$3.60/mo — app-scoped, survives machine recreation
fly ips list                              # record the static EGRESS IPv4 → whitelist THIS at sFOX
```

Total running cost ≈ **$5.60/mo** (inbound ~$2 + egress ~$3.60). Confirm current Fly
pricing at deploy — the figures above are the researched estimate.

### 4. Set the BasicAuth secret (never committed — rendered at container start)

```bash
SECRET=$(openssl rand -hex 32)            # long random secret; keep it out of chat/logs
fly secrets set PROXY_BASIC_AUTH="quantalyze:${SECRET}"
```

The proxy image ships with placeholders only; `entrypoint.sh` renders the real config
from `PROXY_BASIC_AUTH` on every start and fails loud if it is missing. The tinyproxy
`BasicAuth` line is space-separated (`user password`) — the entrypoint handles that;
you always provide the value in `user:secret` form here.

### 5. Machine-side egress sanity check

```bash
fly ssh console -C "curl -s https://ipinfo.io/json"
```

The `ip` field MUST equal the step-3 static egress IPv4, and `country` MUST be `NL`/EU.
If it geolocates elsewhere, ccxt geo-blocks (Bybit/Binance 403/451) could reappear —
stop and investigate before continuing.

### 6. Point the Railway worker at the proxy

In the Railway dashboard (worker service → Variables), set:

```
WORKER_EGRESS_PROXY_URL=http://quantalyze:<secret>@<inbound-v4>:8888
```

- Use the **inbound v4** from step 2 as the host (NOT the egress IP), port `8888`, and
  the `user:secret` from step 4 as the BasicAuth userinfo.
- Optional ccxt opt-in: `WORKER_EGRESS_PROXY_APPLIES_TO_CCXT=true` (default OFF, so
  today's working ccxt egress is undisturbed unless you opt in).
- For the SFOX-06 live-parity run, `scripts/sfox_ground_truth.py` reads the same URL via
  `SFOX_GROUND_TRUTH_PROXY`.
- Never paste this URL into chat or logs — it carries the secret.

### 7. THE SFOX-07 GATE — verify the worker's realized egress BEFORE whitelisting

Run the probe from the worker itself; it must print the proxied egress IP and exit 0:

```bash
railway ssh "cd /app && python -m scripts.probe_exchange_egress --expect <egress-ipv4>"
```

A mismatch or a `407 Proxy Authentication Required` fails loud (plan 121-02 ships the
`--expect` flag). No-code cross-check through the proxy — reuse the
`WORKER_EGRESS_PROXY_URL` **already set on the worker** (step 6) so the secret is never
retyped on the command line or captured in shell history:

```bash
# Single-quote the outer string so $WORKER_EGRESS_PROXY_URL expands inside the
# worker shell (where it is set), NOT locally — the secret stays off your terminal.
railway ssh 'cd /app && curl -s --proxy "$WORKER_EGRESS_PROXY_URL" https://ipinfo.io/json'
```

> ⚠️ Never paste the literal `http://user:secret@host:8888` onto a command line — it
> lands in shell history and `ps`/`railway` logs. Always reference the env var, or use
> the `--expect` probe above (which reads the URL from the env and redacts it in output).

> **Fallback (not the default):** if the connection to `<inbound-v4>:8888` cannot be
> established at all, Railway may block outbound non-443 TCP. In that case, front
> tinyproxy on 443 via a TLS handler and route through it — documented as a fallback
> only; 8888 raw-TCP is the primary path.

### 8. ONLY after step 7 passes: whitelist the EGRESS IP at sFOX

In the sFOX dashboard, whitelist the **step-3 static EGRESS IPv4** (never the inbound
v4). The key now authenticates because the worker's traffic egresses from that one
verified static IP.

---

## Why this order matters

Whitelisting before verifying realized egress can silently lock the sFOX key to the
wrong IP — and because Fly egress is NAT'd by default, "the machine exists" is not proof
that "the worker's traffic actually leaves via the static egress IP." The step-7 probe
is your one-command proof that the whole path (worker → proxy BasicAuth → static egress)
resolves to the exact address you are about to whitelist. Verify first, whitelist second.
