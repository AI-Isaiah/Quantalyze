# Phase 139: MT5GOLIVE — Prod gateway stand-up + real-broker soak + flag flip - Research

**Researched:** 2026-07-24
**Domain:** Self-hosted MT5 Wine-gateway deployment (Fly/Railway/VPS) + live-ops runbook + soak/parity script + flag-flip checklist
**Confidence:** HIGH (image/ports/volume/env verified against the gmag11 repo `start.sh` + Docker Hub tags; Fly/Railway networking + volume specifics verified against current docs; the IPv4-bind-vs-IPv6-private gotcha corroborated by Railway docs + community threads)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Gateway deployment config + runbook (MT5GW-01 / MT5GOLIVE-01)**
- gmag11 `MetaTrader5-Docker` v2.3 (Wine + Windows-Python + MT5 terminal + RPyC bridge, Linux
  container). Deployment config templates for BOTH candidate hosts (Fly `fly.toml` + Railway
  config) + a docker-compose for a cheap-VPS fallback — the founder picks. Persistent `/config`
  volume; the RPyC/HTTP bridge bound to a PRIVATE network only (NEVER publicly open — the RPyC
  RCE finding from Phase 134); terminal auto-update disabled/pinned.
- **Credential isolation:** the gateway sees ONLY the secret it is syncing; broker IP-allowlisting
  (if the broker requires it) keys off the GATEWAY/VPS IP, NOT the worker egress IPs
  (worker egress is Railway static; the gateway IP is separate).
- The Windows dependency stays OUT of the Linux worker process (the worker is a pure `mt5linux`
  network client — Phase 134 contract).

**Soak / parity verification (MT5GOLIVE-02)**
- A soak verification procedure + script: reconstructed equity vs live `account_info().equity`
  parity (the Phase-136 gate) holds over the soak window on REAL prod data. Reuse `mt5_spike.py`
  (134) for the connectivity/go-no-go legs + the 136 reconciliation for parity. The founder runs
  it against the real investor account; results recorded in the go/no-go doc + a soak log.

**Flag flip (MT5GOLIVE-02)**
- **Explicit GATE-CHECK, never assumed:** the runbook enumerates the 135–138 CI gates + the soak
  parity as a checklist that MUST be green BEFORE the flip. Flip = set `MT5_ENABLED` (Railway) +
  `NEXT_PUBLIC_MT5_ENABLED` (Vercel) to `"true"` + REDEPLOY (LIVE env ops, NOT migrations —
  mirror the sFOX enable mechanics).
- **Trivial rollback:** both flags back to empty + redeploy → byte-identical dark state (the
  138 flag-OFF byte-identity guarantee makes rollback safe).
- Post-flip: a user connects an MT5 key end-to-end and its `api_verified` strategy renders live
  across factsheet/discovery/edit, proven across roles.

### Claude's Discretion
The exact runbook structure, which host template is primary vs fallback, and the soak-window
length recommendation are engineering-discretion, grounded in the STATE blocker (amd64/4GB/volume)
+ the sFOX/Railway infra precedents.

### Deferred Ideas (OUT OF SCOPE)
- The ACTUAL live execution (gateway stand-up, broker onboarding, soak run, flag flip) —
  `human_needed`, founder-gated. Runbook + config + script land now.
- Portable-mode terminal pool / multi-broker sharding (v1 is one serial terminal).
- The DEAL_TYPE ambiguous-middle (136-05) + master-rejection retcode (WR-03) live confirmations —
  fold into the same founder soak session (the live spike reveals both).
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| MT5GW-01 | Prod gmag11 v2.3 gateway stood up (Wine+terminal+RPyC, persistent `/config`, VNC install + investor login), reachable from the worker over a PRIVATE network only, terminal auto-update pinned; Windows dep out of the worker | Verified image/ports/volume/env + private-network binding options per host (Architecture Patterns, Config Templates). ⚠️ terminal auto-update CANNOT be disabled — only the image tag/digest is pinnable (Pitfall 2). |
| MT5GOLIVE-01 | Hosting decided (Fly vs Railway) + credential isolation + broker IP-allowlisting off the GATEWAY IP not worker egress + persistent config volume | Decision matrix (Fly/Railway/VPS) + credential-isolation + gateway-egress-vs-worker-egress analysis (Architecture Patterns, Pitfall 4). |
| MT5GOLIVE-02 | Real broker investor account onboarded + soaked to reconstructed-vs-live equity parity; then `MT5_ENABLED` + `NEXT_PUBLIC_MT5_ENABLED` flipped LIVE (Railway+Vercel, not migrations) after every gate green; verified in prod; rollback trivial | Soak/parity script design (reuse `mt5_spike.py` + 136 combine, tolerance max($1,1e-6·terminal)) + the exact env-set/redeploy commands + the gate-check list + rollback (Code Examples, Flag-Flip Checklist). |
</phase_requirements>

## Summary

Phase 139 is the milestone culmination and a **founder LIVE-ops phase**: all three requirements
require a hosting decision, a running Wine gateway, a real broker investor account, a soak window,
and LIVE env-flag flips that an autonomous agent cannot perform. The buildable deliverables —
a go-live RUNBOOK, deployment CONFIG TEMPLATES (Fly `fly.toml` + Railway + docker-compose VPS
fallback), a SOAK/parity SCRIPT, and a flag-flip CHECKLIST — LAND now; the live execution legs
land as `human_needed` checkpoints, exactly like 134's live spike and 136-05.

The research resolves the two things the objective flagged as hallucination-prone. First, the
gmag11 image: verified name `gmag11/metatrader5_vnc:2.3` (= `latest`, linux/amd64 only, ~1.57 GB
compressed / ~4 GB on disk, pushed ~Dec 2025), RPyC bridge on `:8001` bound to IPv4 `0.0.0.0`
(from the repo `start.sh`), noVNC on `:3000`, persistent `/config` volume, env `CUSTOM_USER` /
`PASSWORD` / `mt5server_port` / `MT5_CMD_OPTIONS`. Second — and this is the single most important
correction — **the RPyC server binds IPv4 `0.0.0.0`, while both Fly 6PN and Railway private
networking are IPv6-centric.** This drives the entire host decision (Pitfall 1).

**Primary recommendation:** Deploy the gateway as a **second Railway service co-located in a NEW
(dual-stack, post-2025-10-16) Railway environment with the existing worker** — this is the ONLY
option that satisfies the hard "private network only" RPyC constraint with **zero tunnel** (worker
reaches `gateway.railway.internal:8001` over Railway's encrypted WireGuard mesh) and requires no
image modification (dual-stack private networking reaches the image's `0.0.0.0` IPv4 bind).
**Fallback = a cheap amd64 VPS (Hetzner/Contabo ~€5/mo) + Tailscale**, giving a clean static
gateway IP for broker allowlisting and maximum control, at the cost of a tunnel + a second ops
surface. Fly is viable only with a Tailscale/WireGuard tunnel too (cross-provider = no shared
private net), so it offers no advantage over the VPS for this workload — document it as the
secondary fallback, not the primary. The soak script composes the existing (offline-proven)
`mt5_spike.py` harness with the Phase-136 `combine_mt5_deal_ledger` reconciliation, run daily over
a recommended 5–10 business-day window at the 136 tolerance `max($1, 1e-6·|terminal_equity|)`.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Run the MT5 terminal + RPyC bridge | Gateway container (Wine, amd64) | — | Windows-only terminal must live somewhere isolated; never in the Linux worker (134 contract) |
| Reach the terminal, read deals/equity | API / Backend (Railway worker) | — | The worker is the pure `mt5linux` network client; the derive branch (136-03) already exists |
| Private transport worker↔gateway | Infra / Networking | — | RPyC = unauthenticated RCE → must be private (Railway internal / Tailscale), never public |
| Broker connection (login/data) | Gateway container → broker | — | The TERMINAL makes the broker connection → broker sees the GATEWAY egress IP, not worker egress |
| Persist Wine prefix + terminal + saved login | Database / Storage (persistent volume) | — | `/config` must survive restarts or the one-time VNC install/login is lost |
| Server-side enable gate (validate route) | Frontend Server (Vercel) | API/Backend (Railway worker) | `MT5_ENABLED` gates BOTH `isMt5EnabledServer` (Vercel route) AND `mt5_enabled_server` (worker) |
| Client wizard card | Browser / Client (Vercel build) | — | `NEXT_PUBLIC_MT5_ENABLED` build-time inlined → redeploy mandatory |
| Soak parity verification | Ops script (founder-run) | — | Composes offline-proven harness + 136 combine against the real account |

## Standard Stack

### Core
| Component | Version | Purpose | Why Standard |
|-----------|---------|---------|--------------|
| `gmag11/metatrader5_vnc` | `2.3` (= `latest`) | Wine + Windows-Python + MT5 terminal + `mt5linux` RPyC server + noVNC, packaged as a Linux container | The maintained, batteries-included server-side terminal without a Windows host `[VERIFIED: Docker Hub tags + repo start.sh]` |
| `mt5linux` | `1.0.3` | Worker-side pure network client (already installed + supply-chain-verified + pinned in Phase 134-03) | No Windows wheel on the worker; same method names as official pkg `[VERIFIED: Phase 134-03 checkpoint]` |
| Railway (existing project `quantalyze-analytics`) | — | Host for the co-located gateway service + the worker | Zero-tunnel private networking within one project (primary recommendation) `[CITED: docs.railway.com/private-networking]` |

### Supporting (fallback hosts)
| Component | Version | Purpose | When to Use |
|-----------|---------|---------|-------------|
| Cheap amd64 VPS (Hetzner CX22 / Contabo) | ~€4–6/mo | docker-compose the gateway with a persistent named volume | Fallback: max control, clean static gateway IP, Wine prefix decoupled from PaaS lifecycle `[ASSUMED]` |
| Tailscale / WireGuard | current | Private tunnel between the Railway worker and a VPS/Fly gateway | Required for ANY off-Railway gateway (cross-provider = no shared private net) `[CITED: general]` |
| Fly.io | current | Alternative container host (amd64 + volumes + 6PN) | Secondary fallback; still needs a tunnel to the Railway worker → no advantage over VPS here `[CITED: fly.io/docs]` |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Railway co-locate (dual-stack) | Railway co-locate in a LEGACY (IPv6-only) env | Image binds IPv4 `0.0.0.0` → UNREACHABLE over IPv6-only `railway.internal` without rebuilding the image to bind `::` (Pitfall 1) |
| gmag11 Wine image | Native Windows VPS (Contabo/Vultr/QuantVPS) + official `MetaTrader5` wheel + RPyC shim | The 134 escape hatch if unattended Wine login proves flaky; identical `Mt5Client` contract, only the host swaps. ~$10–50/mo, Windows patching burden `[CITED: STACK.md]` |
| `mt5linux` RPyC bridge | Hand-rolled FastAPI-over-`MetaTrader5` shim | Narrower attack surface + auth, but net-new code; only if `mt5linux` 1.0.3 proves unstable |

**Installation (worker side — already done in 134, NO new install this phase):**
```bash
# mt5linux==1.0.3 was installed + supply-chain-verified + pinned in Phase 134-03.
# Phase 139 installs NO new worker packages. The gateway is a prebuilt Docker image
# (we run no pip install inside it).
```

**Version verification (2026-07-24):**
```
gmag11/metatrader5_vnc:2.3  → confirmed on Docker Hub (= latest, linux/amd64 only,
                              1.57 GB compressed, last pushed ~7 months / Dec 2025)
mt5linux 1.0.3              → pinned in Phase 134 (no change)
```

## Package Legitimacy Audit

**Phase 139 installs NO new packages.** The only external dependency in the read path
(`mt5linux==1.0.3`) was installed, slopcheck/supply-chain-verified, and pinned behind the
**Phase 134-03 human-verify checkpoint**. The gmag11 Docker image is a prebuilt artifact pulled by
digest/tag — we run no `pip install` inside it and add no worker requirements here.

| Package | Registry | Disposition |
|---------|----------|-------------|
| `mt5linux==1.0.3` | PyPI | Already approved + pinned (Phase 134-03). No re-install this phase. |
| `gmag11/metatrader5_vnc:2.3` | Docker Hub | Pull by tag; **pin by digest** at stand-up (record the sha256 in the runbook — Pitfall 2). Not a package-manager install. |

**Packages removed due to slopcheck [SLOP]:** none.
**Packages flagged [SUS]:** none.

## Architecture Patterns

### System Architecture Diagram

```
                            PUBLIC INTERNET (never touches RPyC)
                                        │
                          founder browser (one-time only)
                                        │  https, VNC :3000, VNC PASSWORD-gated
                                        ▼
   ┌─────────────────────────────────────────────────────────────────┐
   │  GATEWAY CONTAINER  (gmag11/metatrader5_vnc:2.3, amd64, ~4GB)     │
   │  ┌──────────────┐   ┌───────────────┐   ┌──────────────────────┐ │
   │  │ noVNC :3000  │   │ Wine + MT5     │   │ mt5linux RPyC :8001  │ │
   │  │ (install/    │──▶│ terminal64.exe │◀─▶│ --host 0.0.0.0 (IPv4)│ │
   │  │  login once) │   │ (1 active acct)│   │  UNAUTH RCE CHANNEL   │ │
   │  └──────────────┘   └───────┬────────┘   └──────────┬───────────┘ │
   │                    persistent /config volume         │            │
   │                    (Wine prefix + saved login)       │            │
   └──────────────────────────────────────────────────────┼───────────┘
                    broker connection egresses             │  PRIVATE NETWORK ONLY
                    from the GATEWAY IP  ──────────▶ BROKER │  (railway.internal  OR
                    (allowlist THIS, not worker egress)     │   Tailscale/WireGuard)
                                                            ▼
   ┌─────────────────────────────────────────────────────────────────┐
   │  RAILWAY WORKER  (analytics-service, Linux, existing)             │
   │  _make_mt5_session → Mt5Client(MT5_GATEWAY_HOST, MT5_GATEWAY_PORT)│
   │  gated by MT5_ENABLED → derive branch (136-03) → ONE backbone     │
   │  → api_verified daily series                                     │
   └─────────────────────────────────────────────────────────────────┘
                                        │
                                        ▼
   Supabase (strategy_verifications trust_tier='api_verified')  ← Vercel factsheet/discovery/edit
   Vercel: NEXT_PUBLIC_MT5_ENABLED (wizard card) + MT5_ENABLED (isMt5EnabledServer validate gate)
```

### Deliverable file structure (what LANDS this phase)
```
docs/runbooks/
└── mt5-go-live.md          # the runbook: decision matrix → stand-up → soak → gate-check → flip → rollback
deploy/mt5-gateway/          # config templates (founder picks one)
├── fly.toml                 # Fly Machine + volume + private-only (needs Tailscale to reach Railway worker)
├── railway-gateway.md       # Railway co-locate service config (PRIMARY) — dual-stack env note
└── docker-compose.yml       # cheap-VPS fallback (+ Tailscale sidecar note)
analytics-service/scripts/
└── mt5_soak.py              # soak/parity runner (reuses mt5_spike + 136 combine_mt5_deal_ledger)
analytics-service/tests/
└── test_mt5_soak.py         # offline parity-function tests (injected fake client, like mt5_spike)
analytics-service/docs/
└── mt5-spike-gonogo.md      # EXTEND with a soak-log section the founder fills per day
```

### Pattern 1: Host decision matrix (grounded in the private-net constraint)

**The load-bearing fact:** the RPyC bridge is an **unauthenticated arbitrary-remote-code channel**
(134 T-134-03) → it MUST be reachable over a private network only, never a public port. The worker
lives on Railway. That reframes CONTEXT's "Fly reuse-ops vs Railway co-locate":

| Option | Private-net to worker | Image change? | Static gateway IP | Ops surface | Verdict |
|--------|----------------------|---------------|-------------------|-------------|---------|
| **Railway co-locate, NEW dual-stack env** | `gateway.railway.internal:8001`, **zero tunnel** (same-project WireGuard mesh) | **None** (dual-stack IPv4 private reaches `0.0.0.0`) | Railway egress set (rotates; whitelist all — v1.13 lesson) | lowest (one PaaS) | **PRIMARY** |
| Railway co-locate, LEGACY IPv6-only env | `railway.internal` is IPv6-only | **YES** — must rebuild image to bind `::` (start.sh hardcodes `0.0.0.0`) | same | low + image maintenance | avoid (Pitfall 1) |
| VPS (Hetzner/Contabo amd64) + Tailscale | worker joins tailnet → gateway tailscale IP; RPyC bound to tailscale iface only | None | **VPS public IP = clean single static IP** | +VPS +tunnel | **FALLBACK** (max control, best for broker allowlisting) |
| Fly Machine + Tailscale | cross-provider → needs the SAME tunnel as VPS | None (Flycast only helps intra-Fly) | `fly ips allocate-v4` dedicated | +Fly +tunnel | secondary — no advantage over VPS here |

**Why NOT Fly as primary:** Fly 6PN / `.internal` / Flycast only bridge apps **inside Fly**. The
worker is on Railway, so a Fly gateway needs a Tailscale/WireGuard tunnel exactly like a VPS —
Fly's private-networking features buy nothing cross-provider, while adding a second PaaS. The VPS
fallback is cheaper and gives a cleaner static IP. `[VERIFIED: fly.io/docs/networking/private-networking — 6PN is org-internal only]`

**Why Railway co-locate is primary:** it is the *only* option where the RPyC channel never leaves
one provider's encrypted internal mesh and no tunnel software is introduced. The one caveat — the
dual-stack environment requirement — is a single founder check (create/confirm a post-2025-10-16
environment) rather than an image rebuild or a tunnel.

### Pattern 2: One-time VNC install + investor login (founder, `human_needed`)
1. Deploy the gateway with `/config` on a persistent volume and `CUSTOM_USER`/`PASSWORD` set.
2. Reach noVNC `:3000` **once** over a temporary/public-but-password-gated path (or SSH-tunnel /
   `railway run` port-forward). Do NOT leave `:3000` publicly exposed after install.
3. In the terminal: install → add the broker account with the **INVESTOR (read-only) password** →
   enable "save account / auto-login". The saved login persists in `/config`.
4. Verify the VNC-displayed **server clock** to confirm the broker-server-time-vs-UTC offset
   (Phase 134 leg-4 estimate → founder confirmation; feeds the 136 normalization seam).
5. Tear down public `:3000` access; from here only the worker reaches `:8001` privately.

### Pattern 3: Credential isolation + broker egress
- The gateway holds ONLY the one investor login it is syncing (v1 = one serial terminal). The
  worker passes creds per-sync via the existing `_make_mt5_session` (login→`api_key`,
  investor-pw→`api_secret`, server→`passphrase`); the VNC-saved login is the same investor account.
- **Broker IP allowlisting (if the broker requires it) keys off the GATEWAY egress IP** — the
  *terminal* makes the broker connection, not the worker. This is the opposite of the sFOX model
  (where the worker's Railway static egress is what sFOX whitelists). A VPS/Fly-dedicated IP gives
  one stable IP; Railway egress rotates within a set (whitelist all — v1.13 lesson). **Most MT5
  brokers do NOT IP-restrict investor logins** `[ASSUMED]` — confirm with the chosen broker.

### Anti-Patterns to Avoid
- **Exposing `:8001` (RPyC) on any public port or `[[services.ports]]` handler.** Unauthenticated
  RCE. Private network / tunnel only.
- **Leaving noVNC `:3000` publicly reachable after the one-time install.** Password-gated but still
  an attack surface; tear it down post-install.
- **Assuming the terminal binary is version-pinned.** Only the *image tag/digest* is pinnable; the
  terminal self-updates (Pitfall 2).
- **Flipping flags on a legacy Railway env without checking the IPv4/IPv6 bind reachability first**
  (Pitfall 1) — the worker would fail `_make_mt5_session` connects with the flag ON.
- **Treating the flag flip as a migration.** It is a LIVE env-var op on Railway + Vercel, never a
  DB migration.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Run MT5 server-side on Linux | A custom Wine+terminal+bridge image | `gmag11/metatrader5_vnc:2.3` | Maintained, batteries-included, KasmVNC install path built in |
| Worker→terminal transport | A bespoke socket protocol | `mt5linux` 1.0.3 (already pinned) | Same API shape as official pkg; portable to a Windows host |
| Private worker↔gateway hop | Public port + hand-rolled auth on RPyC | Railway internal mesh (primary) or Tailscale (fallback) | RPyC has no auth; the transport layer must provide privacy |
| Equity reconstruction in the soak | A fresh parity calc | `combine_mt5_deal_ledger` (136-01) + the 136-03 forward-NAV-roll reconciliation | The soak proves the SHIPPED gate on real data, not a parallel implementation |
| Connectivity legs of the soak | New connect/read code | `scripts/mt5_spike.py` `run_spike` (134) | Offline-proven harness; the soak reuses it verbatim |
| Secret hygiene in the soak log | Ad-hoc redaction | `sanitize_evidence` + `assert_sanitized` (deribit_ground_truth) | Single-definition primitives; the spike already reuses them |

**Key insight:** Phase 139 writes almost no new *logic* — the runbook orchestrates existing,
tested pieces (134 harness, 136 combine/reconciliation, 138 flag mechanics, sFOX flag-flip
precedent). The only new code is the thin `mt5_soak.py` runner (compose + append-to-log) and its
offline test. Everything trust-critical is already gated and tested upstream.

## Runtime State Inventory

> Rename/migration categories adapted to this LIVE-ops phase — "what runtime state must exist for go-live and survive restarts."

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | Wine prefix + MT5 terminal install + **saved investor login** live in the `/config` volume; lost on any volume-less redeploy | Persistent volume MANDATORY (Fly `[[mounts]]` / Railway single-service volume / VPS named volume); one-time VNC install re-run if lost |
| Live service config | Gateway env: `CUSTOM_USER`, `PASSWORD` (VNC), `mt5server_port=8001`. Worker env (Railway): `MT5_GATEWAY_HOST`, `MT5_GATEWAY_PORT`, `MT5_ENABLED`. Vercel env: `MT5_ENABLED`, `NEXT_PUBLIC_MT5_ENABLED`. NONE of these are in git | Set at stand-up + flip; enumerate in the checklist; rollback = empty the two ENABLED flags + redeploy |
| OS-registered state | None — no OS scheduler/pm2/launchd registration; the worker's existing cron/job loop drives the sync | None (verified — the derive branch is already wired via the existing job path, 136-03) |
| Secrets/env vars | Broker investor credentials flow per-sync from Supabase-encrypted slots (135 convention), NOT stored in the gateway image; VNC `PASSWORD` is a new gateway secret | Store gateway `PASSWORD` + `MT5_GATEWAY_HOST/PORT` in the host's secret store; never in git |
| Build artifacts | Gateway image pinned by tag `:2.3`; **record the sha256 digest** at stand-up so a silent re-tag can't change the base out from under you | Pin by digest in the runbook (Pitfall 2) |

## Common Pitfalls

### Pitfall 1: RPyC binds IPv4 `0.0.0.0`, but Fly/Railway private nets are IPv6-centric ⭐
**What goes wrong:** With the flag ON, the worker's `_make_mt5_session` cannot connect to the
gateway over the private network, even though the container is healthy and VNC works.
**Why it happens:** the gmag11 `start.sh` launches the bridge as
`python3 -m mt5linux --host 0.0.0.0 -p $mt5server_port ...` — **IPv4 only**. Railway private
networking in **legacy (pre-2025-10-16) environments is IPv6-only** and requires services to bind
`::`; Fly 6PN `.internal` is IPv6 too. A service that binds only `0.0.0.0` is unreachable over an
IPv6-only `railway.internal`. `[VERIFIED: repo start.sh + docs.railway.com/private-networking + community threads]`
**How to avoid:**
- **Primary:** use a **NEW Railway environment (created after 2025-10-16)** — these support IPv4
  *and* IPv6 private networking, so the `0.0.0.0` bind is reachable at `gateway.railway.internal`
  with no image change. Confirm the worker's environment is dual-stack (founder check).
- **VPS/Fly fallback:** Tailscale/WireGuard gives an IPv4 address on the tunnel interface; bind
  RPyC to that interface (or `0.0.0.0` behind the tunnel firewall) — the IPv4 bind is fine.
- **Last resort:** derive a thin image overriding `start.sh` to `--host ::` for a legacy IPv6-only
  Railway env.
**Warning signs:** worker logs `connection refused`/timeout to the gateway host while `:3000` VNC
and `terminal_info()` locally are healthy; `railway.internal` resolves AAAA only.

### Pitfall 2: The terminal auto-updates — you cannot "disable" it, only pin the image ⭐
**What goes wrong:** CONTEXT/ROADMAP say "terminal auto-update disabled/pinned," implying a config
switch exists. It does not.
**Why it happens:** the gmag11 README states plainly: *"MetaTrader program is updated independently
from image so you will always have latest MT5 version."* The terminal self-updates from the broker;
there is no supported flag to freeze the terminal binary. `[VERIFIED: gmag11 README]`
**How to avoid:** pin what you actually CAN pin — the **image by tag `:2.3` AND record its sha256
digest** so the *base* (Wine/Python/bridge) is reproducible. Accept terminal self-update as a
managed risk: the soak window is the detector (a terminal-update-induced parity break shows up as a
soak failure before the flip). Note this correction loudly in the runbook so a reviewer doesn't
chase a non-existent switch.
**Warning signs:** a plan task literally says "set auto-update=false" — there is no such setting.

### Pitfall 3: `NEXT_PUBLIC_MT5_ENABLED` is build-time inlined — env-set alone does nothing
**What goes wrong:** the founder sets the Vercel env var, nothing changes in the wizard.
**Why it happens:** Next inlines `NEXT_PUBLIC_*` at BUILD time; the running deploy has the old
(empty) value baked in. Exact sFOX precedent. `[VERIFIED: sfox enable mechanics memory]`
**How to avoid:** a **redeploy is MANDATORY** after setting it (`vercel redeploy <prod-url>` or
`vercel --prod` from a clean **main** checkout — never a feature branch, the CLI builds CWD).
**Warning signs:** flag set, wizard still shows no MT5 card.

### Pitfall 4: Broker allowlisting off the WRONG IP (worker egress vs gateway egress)
**What goes wrong:** the founder whitelists the worker's Railway static egress IPs (the sFOX
muscle memory), the broker still blocks the login — because the *terminal* (in the gateway) makes
the broker connection, from the GATEWAY egress IP.
**Why it happens:** the sFOX/ccxt model egresses from the worker; MT5's broker connection egresses
from the gateway container. Different IP entirely. `[VERIFIED: architecture + STACK.md integration note]`
**How to avoid:** whitelist the GATEWAY egress IP. Prefer a host that gives ONE stable IP (VPS
public IP, Fly dedicated v4). On Railway the gateway service egresses from Railway's set (rotates —
whitelist all). Most brokers don't IP-restrict investor logins `[ASSUMED]` — confirm first.
**Warning signs:** VNC manual login works (interactive, your laptop IP) but the automated
gateway-driven login is geo/IP-blocked.

### Pitfall 5: Railway "Wait for CI" silently SKIPS the redeploy on a red main flake
**What goes wrong:** the founder redeploys the worker to pick up `MT5_ENABLED=true`; the deploy is
SKIPPED because main's post-merge CI flaked red; the flag never reaches prod.
**Why it happens:** Railway "Wait for CI" is ON; a red check-suite → `skippedReason="CI check suite
failed"`. `[VERIFIED: railway analytics deploy memory]`
**How to avoid:** after the flip redeploy, verify `railway deployment list --json` shows
`status=SUCCESS` and the right `commitHash` (not SKIPPED); if skipped on a flake,
`gh run rerun <main-run-id> --failed`, or `railway up` from `analytics-service/` to force.
**Warning signs:** flag set in the Railway dashboard, worker still behaves dark.

### Pitfall 6: Volume redeploy downtime + single-writer (Railway)
**What goes wrong:** a redeploy briefly stops the gateway; a second active deployment can't mount
the same volume.
**Why it happens:** Railway volumes are single-writer; a redeploy incurs small downtime even with
healthchecks; replicas are disallowed with volumes. `[VERIFIED: docs.railway.com/reference/volumes]`
**How to avoid:** fine for a once-daily batch read — schedule the sync away from expected
redeploys; never run two gateway deployments against one volume. (Fly: a volume binds to exactly
one Machine — same single-writer reality.)

## Code Examples

### Config template — Railway gateway service (PRIMARY)
```
# deploy/mt5-gateway/railway-gateway.md — a NEW service in the SAME Railway project/env as the worker.
# Source: prebuilt Docker image (Railway "Deploy from Docker Image").
Image:        gmag11/metatrader5_vnc:2.3   # PIN the sha256 digest in the runbook
Volume:       mount /config  (Pro plan, 50GB cap; one volume per service)
Networking:   NO public domain. Reachable only at  gateway.railway.internal:8001  from the worker.
Environment (NEW dual-stack env — created after 2025-10-16 so IPv4 private reaches 0.0.0.0):
  CUSTOM_USER      = <vnc user>
  PASSWORD         = <vnc password>          # gateway secret, not in git
  mt5server_port   = 8001
Worker service (existing) env to set at flip:
  MT5_GATEWAY_HOST = gateway.railway.internal
  MT5_GATEWAY_PORT = 8001
  MT5_ENABLED      = true
# One-time VNC install: `railway run`/port-forward :3000 or a temporary public domain (tear down after).
```

### Config template — Fly (secondary fallback; needs Tailscale to reach the Railway worker)
```toml
# deploy/mt5-gateway/fly.toml
app            = "quantalyze-mt5-gateway"
primary_region = "ams"                 # geo-allowed, matches worker region family

[build]
  image = "gmag11/metatrader5_vnc:2.3" # pin digest in the runbook

[[vm]]
  size     = "shared-cpu-2x"
  memory   = "2gb"                     # ~4GB image on disk; RAM for Wine+terminal
  cpu_kind = "shared"

[[mounts]]
  source      = "mt5_config"           # `fly volumes create mt5_config --size 3`
  destination = "/config"

# NO [[services.ports]] / NO [http_service] → no public IP (Fly private-only).
# RPyC reachability to a NON-Fly worker requires a Tailscale/WireGuard sidecar in this
# machine; bind the tunnel and firewall :8001 to the tailnet only. `fly ips allocate-v4`
# gives a dedicated egress IP for broker allowlisting.
```

### Config template — cheap-VPS fallback (docker-compose + Tailscale)
```yaml
# deploy/mt5-gateway/docker-compose.yml  (Hetzner/Contabo amd64 VPS)
services:
  mt5:
    image: gmag11/metatrader5_vnc:2.3          # pin @sha256:<digest>
    restart: unless-stopped
    environment:
      CUSTOM_USER: "${VNC_USER}"
      PASSWORD:    "${VNC_PASSWORD}"
      mt5server_port: "8001"
    volumes:
      - mt5_config:/config                      # persistent Wine prefix + saved login
    ports:
      - "127.0.0.1:3000:3000"                   # VNC bound to loopback; reach via SSH tunnel only
      - "127.0.0.1:8001:8001"                   # RPyC NEVER on 0.0.0.0 of the public iface
volumes:
  mt5_config:
# Tailscale sidecar/host-daemon: the Railway worker joins the tailnet; RPyC exposed ONLY on the
# tailscale interface. Firewall drops :8001 on the public NIC. Worker → mt5:8001 over the tailnet.
```

### Soak / parity runner sketch (`scripts/mt5_soak.py`)
```python
# Composes the OFFLINE-PROVEN 134 harness + the 136 reconciliation against the REAL account.
# Run daily by the founder over the soak window; appends one sanitized record per run.
from datetime import datetime, timezone
from scripts.mt5_spike import run_spike, _default_client_factory   # 134 connectivity legs (reused)
from scripts.deribit_ground_truth import sanitize_evidence, assert_sanitized
from services.ingestion.mt5_deals import combine_mt5_deal_ledger   # 136-01 combiner (real path)

def _parity_tolerance(terminal_equity: float) -> float:
    # EXACT 136-03 gate: max($1, 1e-6 * |terminal equity|)
    return max(1.0, 1e-6 * abs(terminal_equity))

def reconcile_parity(client_factory, host, port, login, investor_pw, server) -> dict:
    """Login → account_info().equity (live anchor) + full history_deals_get → combine → forward
    NAV roll → |reconstructed − live| <= tolerance. Same economics the derive branch proves, but
    on real prod data and logged over N days. Fail-loud on None reads (never fabricate a flat)."""
    ...  # forward-roll from the deal ledger exactly as test_mt5_derive_branch.py does

def main() -> int:
    report = run_spike(env, client_factory=_default_client_factory)   # legs 1–4 (connectivity)
    report["parity"] = reconcile_parity(...)                          # the go-live parity gate
    report["soak_run_at"] = datetime.now(timezone.utc).isoformat()
    clean = sanitize_evidence(report); assert_sanitized(clean)
    # append `clean` to docs/evidence/mt5-soak-<date>.json AND the go/no-go doc soak table
    ...
```

### Flag-flip commands (LIVE env ops — exact, mirroring sFOX)
```bash
# ── 1. Railway WORKER (analytics-service dir, `railway link`-ed) ────────────────
railway variables --set MT5_ENABLED=true \
                  --set MT5_GATEWAY_HOST=gateway.railway.internal \
                  --set MT5_GATEWAY_PORT=8001
railway up            # force from repo dir on the intended clean main commit
railway deployment list --json   # VERIFY status=SUCCESS + right commitHash (NOT skipped) — Pitfall 5

# ── 2. Vercel (server gate + client card — from a clean MAIN checkout) ──────────
vercel env add MT5_ENABLED production            # isMt5EnabledServer (validate-and-encrypt route)
vercel env add NEXT_PUBLIC_MT5_ENABLED production # wizard card (BUILD-TIME → redeploy mandatory)
vercel redeploy <prod-deploy-url>                # or: vercel --prod  (builds CWD = clean main)

# ── ROLLBACK (byte-identical dark, 138 guarantee) ───────────────────────────────
railway variables --set MT5_ENABLED=          # empty
vercel env rm MT5_ENABLED production ; vercel env rm NEXT_PUBLIC_MT5_ENABLED production
# redeploy both → dormant.  (MT5_GATEWAY_HOST/PORT may stay set; harmless while MT5_ENABLED empty.)
```

### Go-live GATE-CHECK (every item green BEFORE the flip — explicit, never assumed)
```
[ ] 134  Mt5Client offline contract suite green + the four-leg spike run recorded GO
[ ] 135  test_mt5_exchange_boundary.sql green; constraint migration APPLIED + verified on PROD;
         TS route/parity vitest + Python source-lockstep green
[ ] 136  test_mt5_derive_branch.py green (incl. reconciliation gate + $2-drift negative control);
         test_process_key mt5 onboard+resync api_verified; √252 mutation guard green
[ ] 137  hung-terminal timeout, restart-on-timeout, per-terminal lock, login==expected bracket regressions green
[ ] 138  mt5-badge.spec.ts registered + green in the BLOCKING e2e-seeded list; byte-identity/envelope + go-dark tests green
[ ] SOAK reconstructed-vs-live equity parity holds every run over the window (mt5_soak.py log all within tolerance)
[ ] CI   full analytics pytest green + full vitest (coverage gate) + e2e-seeded green on main
[ ] NET  worker reaches gateway.railway.internal:8001 privately (Pitfall 1 dual-stack confirmed)
[ ] Railway deploy verified SUCCESS not SKIPPED (Pitfall 5)
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Railway private networking IPv6-only | IPv4 + IPv6 in NEW environments | 2025-10-16 | A dual-stack env reaches the image's `0.0.0.0` bind with no image change (Pitfall 1) |
| sFOX: whitelist WORKER egress | MT5: whitelist GATEWAY egress | this milestone | Different IP; the terminal makes the broker connection (Pitfall 4) |
| "pin/disable terminal auto-update" (assumed) | Pin the IMAGE tag+digest only; terminal self-updates | verified 2026-07-24 | Runbook must not chase a non-existent switch (Pitfall 2) |

**Deprecated/outdated:**
- `mt5linux` 0.1.x / `mt5-server` / `pymt5` forks — stale, superseded by `mt5linux==1.0.3`.
- The `gmag11/metatrader5_vnc:1.1` tag — lighter, NO Python/RPyC → cannot serve `mt5linux`.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The chosen broker does NOT IP-restrict investor-password logins | Pitfall 4, Pattern 3 | If it does, a rotating Railway gateway egress fails allowlisting → forces the VPS/Fly-dedicated-IP fallback |
| A2 | The worker's Railway environment can be (or is) a dual-stack env reaching `0.0.0.0` at `railway.internal` | Pitfall 1, decision matrix | If stuck legacy IPv6-only → image rebuild (`--host ::`) or the VPS/Tailscale fallback becomes primary |
| A3 | A VPS + Tailscale tunnel is acceptable ops surface for the fallback | Decision matrix | If the founder rejects a tunnel, Railway co-locate is the only tunnel-free option → A2 becomes mandatory |
| A4 | Unattended Wine auto-login proves reliable at prod stand-up (134 leg-1 GO) | whole phase | A NO-GO elects the native-Windows-VPS escape hatch (identical `Mt5Client` contract) — recorded, not papered over |
| A5 | 5–10 business days is a sufficient soak window | Soak section | Too short → a terminal-update/parity regression slips past the flip; extend if any run reddens |
| A6 | Terminal self-update will not silently break parity mid-soak | Pitfall 2 | The soak is the detector; a break reddens a run before the flip |

## Open Questions

1. **Is the worker's Railway environment dual-stack (post-2025-10-16) or legacy IPv6-only?**
   - What we know: dual-stack reaches `0.0.0.0`; legacy IPv6-only does not (Pitfall 1).
   - What's unclear: the creation date of the `quantalyze-analytics` production environment.
   - Recommendation: founder checks at stand-up; if legacy, create a new environment or use the
     VPS/Tailscale fallback. This is the single gating unknown for the PRIMARY recommendation.

2. **Does the target broker require IP allowlisting, and off which IP?**
   - What we know: it keys off the GATEWAY egress, not worker egress (Pitfall 4).
   - What's unclear: broker-specific policy.
   - Recommendation: confirm with the broker during onboarding; prefer a host with one stable IP if
     yes.

3. **Soak window length + cadence.**
   - What we know: parity must hold on real data (136 gate); terminal self-updates are a risk.
   - What's unclear: how many days is "enough."
   - Recommendation: 5–10 business days, one run/day, all within tolerance; extend on any red.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| `mt5linux` (worker) | worker RPyC client | ✓ | 1.0.3 (pinned 134) | — |
| gmag11 image | gateway | ✓ (Docker Hub) | `:2.3` amd64 | native Windows VPS + official wheel (134 escape hatch) |
| amd64 host + persistent volume | gateway | founder-provisioned | — | VPS if PaaS volume constraints bite |
| Railway dual-stack env | zero-tunnel private net (primary) | ⚠️ unconfirmed | — | VPS/Fly + Tailscale |
| Tailscale/WireGuard | off-Railway gateway private hop (fallback) | founder-provisioned | — | Railway co-locate (no tunnel) |
| `railway` CLI, `vercel` CLI, `gh` | flip + verify | ✓ (per prior milestones) | — | dashboard UI |
| Real broker investor account | soak + go-live | ⚠️ founder | — | none (hard `human_needed` blocker) |

**Missing dependencies with no fallback:**
- A real broker investor account (login + investor password + exact server string) — hard
  `human_needed`; blocks the soak and the flip.

**Missing dependencies with fallback:**
- Railway dual-stack env → VPS/Fly + Tailscale.
- gmag11 Wine image reliability → native Windows VPS (134 escape hatch, identical contract).

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | pytest (analytics-service, `--cov-fail-under=80`) + vitest (frontend) + Playwright e2e-seeded |
| Config file | `analytics-service/` pytest config; `vitest.config.ts`; `.github/workflows/ci.yml` |
| Quick run command | `cd analytics-service && pytest tests/test_mt5_soak.py -x` |
| Full suite command | `cd analytics-service && pytest` (4398+ green) + `npm run test:coverage` + e2e-seeded |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| MT5GOLIVE-02 | soak parity function reconciles reconstructed vs live equity within tolerance; fail-loud on None; negative control reddens | unit (offline, injected fake client) | `pytest tests/test_mt5_soak.py -x` | ❌ Wave 0 |
| MT5GOLIVE-02 | soak log record is secret-sanitized (no creds leak) | unit | `pytest tests/test_mt5_soak.py -k sanitize -x` | ❌ Wave 0 |
| MT5GW-01 / GOLIVE-01/02 | gateway stand-up, hosting decision, broker onboard, soak run, flag flip | **manual / `human_needed`** | founder runbook — NOT automatable | n/a (checkpoints) |
| (regression) | the SHIPPED derive/reconciliation the soak exercises | unit (already green) | `pytest tests/test_mt5_derive_branch.py -x` | ✅ |

### Sampling Rate
- **Per task commit:** `pytest tests/test_mt5_soak.py -x`
- **Per wave merge:** full analytics pytest + vitest
- **Phase gate:** full suite + e2e-seeded green before `/gsd:verify-work`; the go-live GATE-CHECK
  list green before the founder flips.

### Wave 0 Gaps
- [ ] `analytics-service/tests/test_mt5_soak.py` — covers MT5GOLIVE-02 soak parity function
      (reconcile within tolerance, fail-loud on None read, $-drift negative control, secret sanitize)
- [ ] (no framework install — pytest/vitest/e2e infra all exist)

*The founder-run legs (stand-up, onboard, soak run, flip, prod verify) are `human_needed`
checkpoints — proven by the runbook + soak-log evidence, not by CI. A skipped gate is never
claimed done.*

## Security Domain

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V1 Architecture | yes | Private-network-only RPyC; credential isolation; gateway ≠ worker trust boundary |
| V2 Authentication | yes | Investor (read-only) password only; master-password rejected at validate (135) |
| V6 Cryptography | yes | Transport privacy via WireGuard mesh (Railway internal) / Tailscale — RPyC has no auth of its own |
| V7 Secrets | yes | Broker creds from Supabase-encrypted slots per-sync; VNC `PASSWORD` in host secret store; never git; soak log sanitized |
| V10 Malicious Code / Supply Chain | yes | Image pinned by tag+digest; `mt5linux` supply-chain-verified (134-03) |
| V13 API/Config | yes | No public `:8001`; noVNC `:3000` torn down post-install; flags fail-closed |

### Known Threat Patterns for this stack
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Unauthenticated RPyC RCE reachable publicly | Elevation of Privilege | Private network / tunnel ONLY; never a public port or `[[services.ports]]` handler |
| Credential leak in soak log / errors | Information Disclosure | `sanitize_evidence` + `assert_sanitized` (reused from the spike); redact-by-value |
| Broker allowlisting misconfig → geo-block at go-live | Denial of Service | Whitelist the GATEWAY egress IP (Pitfall 4); prefer one stable IP |
| Master-password (trade-capable) login slips in | Elevation of Privilege | Structural no-`order_*` surface + validate-time `order_check` reject (135/137) |
| Flag flip on a broken transport → silent dark/failure | Denial of Service | Pitfall 1 net-check + Pitfall 5 deploy-SUCCESS verify in the gate-check |
| Terminal self-update changes parity | Tampering (integrity) | Soak window as detector; image base pinned by digest |

## Sources

### Primary (HIGH confidence)
- gmag11/MetaTrader5-Docker repo `Metatrader/start.sh` — `python3 -m mt5linux --host 0.0.0.0 -p $mt5server_port` (`mt5server_port="8001"`), IPv4 bind
- Docker Hub `gmag11/metatrader5_vnc/tags` — `:2.3` = `latest`, linux/amd64 only, 1.57 GB compressed, ~7 months old
- gmag11 README — ports 3000 (noVNC) + 8001 (RPyC), `/config` volume, `CUSTOM_USER`/`PASSWORD`/`MT5_CMD_OPTIONS`, "MetaTrader program is updated independently from image"
- docs.railway.com/reference/volumes — single volume per service, redeploy downtime, no replicas, plan size caps
- fly.io/docs/volumes + /docs/reference/configuration — `[[mounts]]` source/destination, `[[vm]]`, one-machine binding, private-only = omit `[[services.ports]]`
- fly.io/docs/networking/private-networking — 6PN/.internal is org-internal only; bind `fly-local-6pn`; Flycast for intra-Fly proxy
- Phase 134/135/136/137/138 SUMMARY + PLAN ledgers — worker env `MT5_GATEWAY_HOST/PORT`, `MT5_ENABLED`, `mt5_enabled_server`, 136 reconciliation tolerance `max($1,1e-6·terminal)`, 138 flag mechanics
- `.planning/research/STACK.md` (v1.15 milestone research, 2026-07-23) — image/mt5linux/versions, concurrency, escape hatch

### Secondary (MEDIUM confidence)
- docs.railway.com/private-networking + community threads — IPv4/IPv6 dual-stack since 2025-10-16, legacy IPv6-only requires `::` bind
- sFOX enable-mechanics memory — exact Vercel `NEXT_PUBLIC_*` build-time + redeploy precedent, Railway "Wait for CI" skip gotcha

### Tertiary (LOW confidence / [ASSUMED])
- Broker IP-allowlisting policy (A1) — broker-specific, unverified
- VPS cost ~€4–6/mo (Hetzner/Contabo) — approximate

## Metadata

**Confidence breakdown:**
- Image/ports/volume/env: HIGH — verified against repo `start.sh` + Docker Hub + README
- Host networking (IPv4-bind vs IPv6-private): HIGH — verified repo bind + Railway docs + Fly docs
- Flag-flip ops: HIGH — exact sFOX precedent + verified worker/Vercel env-var names in code
- Broker allowlisting specifics: LOW — [ASSUMED], broker-dependent
- Soak window length: MEDIUM — engineering judgment, founder-confirmable

**Research date:** 2026-07-24
**Valid until:** ~2026-08-24 (30 days; gmag11 image + Railway/Fly networking are stable, but
re-verify the Railway dual-stack env date and the image digest at stand-up)
</content>
</invoke>
