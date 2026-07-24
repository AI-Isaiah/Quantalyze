# MT5 Gateway — Railway co-locate service (PRIMARY host template)

**This is the PRIMARY host template** (research correction 2026-07-24). The gateway
runs as a **second Railway service in the SAME Railway project as the analytics
worker** — the only option where the RPyC channel never leaves one provider's
encrypted internal mesh and **no tunnel software is introduced**. See the host
decision matrix in `docs/runbooks/mt5-go-live.md` Step 0 for why this beats Fly/VPS.

> **HARD CONSTRAINT — PRIVATE NETWORK ONLY.** The RPyC bridge (`:8001`) is an
> **unauthenticated arbitrary-remote-code channel** (Phase-134 T-134-03 finding). It
> must be reachable ONLY at `gateway.railway.internal:8001` over Railway's internal
> WireGuard mesh. **NEVER** attach a public domain to this service. **NEVER** expose
> `:8001` publicly. No exceptions.

## Service source

Deploy from a prebuilt Docker image (Railway → New Service → **Deploy from Docker
Image**):

```
Image:  gmag11/metatrader5_vnc:2.3
```

- `gmag11/metatrader5_vnc:2.3` = `latest`, **linux/amd64 only** (~1.57 GB compressed,
  ~4 GB on disk). Do NOT schedule this on an ARM instance.
- **PIN THE DIGEST at stand-up.** The `:2.3` tag can be silently re-pushed. Record the
  resolved `sha256` in the runbook provenance line and pin the service to
  `gmag11/metatrader5_vnc:2.3@sha256:<digest>` so the *base* (Wine / Windows-Python /
  RPyC bridge) is reproducible. Get the digest at stand-up with:
  ```bash
  docker buildx imagetools inspect gmag11/metatrader5_vnc:2.3   # copy the sha256
  ```
  Note: pinning the digest pins the **image base only**. The MetaTrader terminal
  binary self-updates from the broker independently of the image and CANNOT be frozen
  — the soak window is the parity-break detector (see the runbook).

## ⚠️ DUAL-STACK ENVIRONMENT REQUIREMENT (Pitfall 1 — the load-bearing gotcha)

The gmag11 `start.sh` launches the RPyC bridge as
`python3 -m mt5linux --host 0.0.0.0 -p $mt5server_port` — an **IPv4-only** bind.
Railway private networking in **legacy (pre-2025-10-16) environments is IPv6-only**;
a service that binds only `0.0.0.0` is **UNREACHABLE** over an IPv6-only
`railway.internal`, even though the container is healthy and VNC works.

**The environment hosting this gateway (and the worker) MUST be a dual-stack
environment created AFTER 2025-10-16** — these support IPv4 *and* IPv6 private
networking, so the `0.0.0.0` bind is reachable at `gateway.railway.internal` with no
image change.

**Founder A2 check — do this BEFORE stand-up:** confirm the target Railway
environment is post-2025-10-16 dual-stack. If it is a legacy IPv6-only environment,
**create a new environment** or take the **VPS + Tailscale fallback**
(`docker-compose.yml`). Do NOT flip `MT5_ENABLED` against a legacy env — the worker's
`_make_mt5_session` connect would fail `connection refused`/timeout with the flag ON.

## Persistent volume

```
Mount:  /config
```

- The Wine prefix, the MT5 terminal install, and the **saved investor login** all live
  in `/config`. Lost on any volume-less redeploy → the one-time VNC install must be
  re-run.
- Railway volumes are **single-writer, one volume per service** [ASSUMED: exact volume
  UI path — Railway → service → Settings → Volumes → "Add Volume", mount path `/config`;
  confirm in the current dashboard]. A redeploy incurs brief downtime; **never** run
  two gateway deployments against one volume (Pitfall 6). Fine for a once-daily batch
  read — schedule the sync away from expected redeploys.

## Environment variables (gateway service)

Set these on the **gateway** service. `PASSWORD` is a gateway secret — store it in the
Railway secret store, **never in git**.

```
CUSTOM_USER     = <vnc user>
PASSWORD        = <vnc password>      # gateway secret, NOT in git
mt5server_port  = 8001
PIP_CONSTRAINT  = /config/mt5linux-constraint.txt   # see below — MANDATORY
```

## ⚠️ PIP_CONSTRAINT — the bridge does NOT work without it (Pitfall 5 — false-green)

`start.sh` installs `mt5linux`/`rpyc`/`numpy` **unpinned** on both the Wine and Linux
sides, and the resulting default versions leave the RPyC bridge **functionally dead
while it still logs `[7/7] server started on :8001`** — a bare TCP-connect / `LISTEN`
check passes, so this is a classic false-green. Three coordinated pins are required:

1. Copy **`deploy/mt5-gateway/mt5linux-constraint.txt`** (in this repo) to the gateway
   volume at **`/config/mt5linux-constraint.txt`**.
2. Set the gateway env var **`PIP_CONSTRAINT=/config/mt5linux-constraint.txt`**.
3. **One-time Wine numpy fix.** Because `start.sh` skips the Wine MetaTrader5/mt5linux
   reinstall when they're already present, the constraint alone does NOT downgrade the
   Wine-side numpy on an already-provisioned volume. Force it once:
   ```bash
   railway ssh --service <gateway> "s6-setuidgid abc bash -lc \
     'export WINEPREFIX=/config/.wine WINEDEBUG=-all PIP_CONSTRAINT=/config/mt5linux-constraint.txt; \
      wine python -m pip install --no-cache-dir \"numpy<2\"'"
   ```
   It persists on `/config` and survives boots (the MT5 reinstall stays skipped).

The three failure modes each pin prevents are documented inline in the constraint file.
**Verify the bridge is actually live** (not just listening) by attaching a client and
reading the account — `initialize()` must return `True` and `account_info()` must return
the real login, e.g. from inside the gateway container:
```bash
railway ssh --service <gateway> "python3 -c 'from mt5linux import MetaTrader5; \
  m=MetaTrader5(host=\"localhost\",port=8001); print(m.initialize(), m.account_info())'"
```

The **worker** carries the matching client libs: `rpyc==5.2.3` (pinned in
`analytics-service/requirements.in`, 5.x/<6) plus `mt5linux==0.1.9` installed `--no-deps`
in `analytics-service/Dockerfile`. Keep the worker rpyc on the 5.x line to match the
gateway's Wine-side rpyc-5 server.

## Environment variables (worker service — set AT FLIP, not at stand-up)

Set these on the **existing analytics-worker** service when you flip live (runbook
Step 6). They wire the worker's `_make_mt5_session` (`job_worker.py:926`) to the
gateway:

```
MT5_GATEWAY_HOST = gateway.railway.internal
MT5_GATEWAY_PORT = 8001
MT5_ENABLED      = true
```

## One-time VNC install access (torn down afterward)

Reach noVNC `:3000` **once** to install the terminal and add the investor login:

- **Preferred:** `railway run` / port-forward the `:3000` port to your laptop, or an
  SSH-tunnel [ASSUMED: exact Railway port-forward invocation — confirm current CLI].
- **Or:** a **TEMPORARY, password-gated public domain** on the gateway service that you
  **tear down immediately after install**.

**Do NOT leave `:3000` publicly reachable after install** (Pitfall / T-139-06). From
then on, only the worker reaches `:8001` privately over `gateway.railway.internal`.

## Broker egress note (Pitfall 4)

If the broker IP-allowlists, it keys off the **GATEWAY** egress IP — the *terminal*
makes the broker connection, NOT the worker. On Railway the gateway egresses from
Railway's static set which **rotates within a set → whitelist ALL** (the v1.13 lesson).
A VPS gives one stable IP if the broker requires a single address. Most brokers do NOT
IP-restrict investor logins [ASSUMED A1 — confirm with the chosen broker].
